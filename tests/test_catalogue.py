"""Catalogue boundaries: local reads, default-player handoff, persistence and HTTP guards."""
import argparse
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

from tvcast import app as appmod
from tvcast.library import scan_library
from tvcast.server import PanelHandler
from tvcast.state import State


class CatalogueTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name
        self.file = os.path.join(self.root, 'Example (2001) $quote.mp4')
        with open(self.file, 'wb') as f:
            f.write(b'fixture')
        with mock.patch.object(appmod, 'ThreadingHTTPServer'):
            self.app = appmod.App(argparse.Namespace(port=0, panel_port=0,
                state=os.path.join(self.root, 'state.json'), library=[self.root]))
        self.app.movies, _, _ = scan_library([self.root])
        self.movie = self.app.movies[0]
        self.app.by_id = {self.movie.id: self.movie}

    def test_catalogue_is_local_and_uses_file_runtime(self):
        self.app.state.update_movie(self.file, position=75, duration=9000, watched=True,
                                   match={'tmdb_id': 1, 'source': 'manual'})
        self.app.state.set_probe(self.file, {'size': self.movie.size, 'mtime': self.movie.mtime,
            'info': {'duration': 3600, 'subtitles': [], 'video': ['h264'], 'audio': ['aac']}})
        self.app.metadata.cache[1] = {'tmdb_id': 1, 'imdb_id': 'tt0000001', 'title': 'Matched title',
                                      'year': 2001, 'score': 9.9, 'vote_count': 10,
                                      'wikidata_id': 'Q123', 'wikipedia_url': 'https://en.wikipedia.org/wiki/Example'}
        self.app.metadata.ratings.values['tt0000001'] = [7.4, 123]
        with mock.patch.object(appmod, 'tv_status', side_effect=AssertionError('TV queried')), \
             mock.patch.object(appmod, 'probe', side_effect=AssertionError('probed in request')), \
             mock.patch.object(self.app.metadata, 'request', side_effect=AssertionError('TMDB queried')), \
             mock.patch('urllib.request.urlopen', side_effect=AssertionError('network in catalogue')):
            m = self.app.catalogue()['library'][0]
        self.assertEqual((m['file_runtime_s'], m['saved_duration']), (3600, 9000))
        self.assertEqual((m['score'], m['vote_count']), (7.4, 123))
        self.assertEqual((m['wikidata_id'], m['wikipedia_url']), ('Q123', 'https://en.wikipedia.org/wiki/Example'))
        self.assertEqual((m['title'], m['file_title'], m['position']), ('Matched title', 'Example', 75))

    def test_missing_imdb_rating_never_falls_back_to_cached_tmdb_score(self):
        self.app.state.update_movie(self.file, match={'tmdb_id': 1, 'source': 'manual'})
        for imdb_id in ('tt0000001', None):
            self.app.metadata.cache[1] = {'tmdb_id': 1, 'imdb_id': imdb_id, 'score': 9.9, 'vote_count': 10}
            m = self.app.catalogue()['library'][0]
            self.assertEqual((m['score'], m['vote_count']), (None, 0))

    def test_cached_imdb_match_enqueues_ratings_without_a_tmdb_token(self):
        self.app.state.update_movie(self.file, match={'tmdb_id': 1, 'source': 'manual'})
        self.app.metadata.cache[1] = {'tmdb_id': 1, 'imdb_id': 'tt0000001'}
        self.app.metadata.enqueue(self.movie)
        self.assertTrue(self.app.metadata.ratings.status()['pending'])
        self.assertTrue(self.app.metadata.jobs.empty())

    def test_local_open_and_reveal_use_known_files_and_preserve_state(self):
        self.app.state.update_movie(self.file, position=500, watched=False)
        before = self.app.state.movie(self.file)
        with mock.patch.object(appmod.subprocess, 'run', return_value=mock.Mock(returncode=0)) as run:
            self.app.control('open_local', {'id': self.movie.id})
            self.assertEqual(run.call_args.args[0], ['/usr/bin/open', self.file])
            self.app.control('reveal', {'id': self.movie.id})
            self.assertEqual(run.call_args.args[0], ['/usr/bin/open', '-R', self.file])
            for bad in ('../secret', '/tmp/movie.mp4', 'unknown'):
                with self.assertRaises(ValueError):
                    self.app.control('open_local', {'id': bad})
            self.assertEqual(run.call_count, 2)
        self.assertEqual(self.app.state.movie(self.file), before)
        self.assertIsNone(self.app.current)
        os.unlink(self.file)
        with self.assertRaisesRegex(ValueError, 'unavailable'):
            self.app.control('open_local', {'id': self.movie.id})

    def test_catalogue_handles_poster_removed_during_refresh(self):
        self.app.state.update_movie(self.file, match={'tmdb_id': 1, 'source': 'manual'})
        self.app.metadata.cache[1] = {'tmdb_id': 1, 'title': 'Example'}
        removed_poster = os.path.join(self.app.metadata.directory, '1.jpg')
        with mock.patch.object(self.app.metadata, 'poster', return_value=removed_poster):
            self.assertIsNone(self.app.catalogue()['library'][0]['poster'])

    def test_catalogue_exposes_collection_ancestors_but_not_release_folders(self):
        collection = os.path.join(self.root, 'Saga')
        trilogy = os.path.join(collection, 'Trilogy')
        release = os.path.join(trilogy, 'Part One (2001)')
        os.makedirs(release)
        with open(os.path.join(release, 'film.mp4'), 'wb') as f:
            f.write(b'fixture')
        self.app.movies, _, _ = scan_library([self.root])
        catalogue = self.app.catalogue()
        folders = {folder['id']: folder for folder in catalogue['folders']}
        self.assertEqual(set(folders), {collection, trilogy})
        self.assertEqual(folders[collection]['parent'], self.root)
        self.assertEqual(folders[trilogy]['parent'], collection)
        self.assertEqual({movie['collection_path'] for movie in catalogue['library']}, {self.root, trilogy})

    def test_refresh_all_retries_cached_matches_and_preserves_manual_exclusions(self):
        with self.assertRaisesRegex(ValueError, 'Token'):
            self.app.control('metadata_refresh_all', {})
        self.app.metadata.configure('test-token')
        self.app.metadata.cache[1] = {'tmdb_id': 1, 'title': 'Example'}
        self.app.state.update_movie(self.file, match={'tmdb_id': 1, 'source': 'manual', 'status': 'matched'})
        self.app.metadata.paused = True
        self.app.control('metadata_refresh_all', {})
        movie, expected, refresh = self.app.metadata.jobs.get_nowait()
        self.assertEqual((movie.id, expected['tmdb_id'], refresh), (self.movie.id, 1, True))
        self.assertFalse(self.app.metadata.paused)
        self.app.metadata.pending.clear()
        self.app.metadata.correct(self.movie, None)
        self.app.control('metadata_refresh_all', {})
        self.assertTrue(self.app.metadata.jobs.empty())

    def test_watched_and_playback_merge_without_losing_other_fields(self):
        self.app.state.update_movie(self.file, position=500, duration=1000, watched=False, match={'tmdb_id': 1})
        self.app.control('watched', {'id': self.movie.id, 'watched': True})
        self.app.state.save_progress(self.file, 510, 1000, False, 1)
        self.assertTrue(self.app.state.movie(self.file)['watched'])
        self.app.control('watched', {'id': self.movie.id, 'watched': False})
        saved = self.app.state.movie(self.file)
        self.assertEqual((saved['position'], saved['duration'], saved['match']), (510, 1000, {'tmdb_id': 1}))
        self.app.state.save_progress(self.file, 999, 1000, True, 2)
        self.assertTrue(State(self.app.state.path).movie(self.file)['watched'])
        with self.assertRaises(ValueError):
            self.app.control('watched', {'id': self.movie.id, 'watched': 'false'})

    def test_history_removal_preserves_movie_data_and_can_be_recorded_again(self):
        other = os.path.join(self.root, 'Disconnected.mp4')
        preserved = dict(position=500, duration=1000, watched=True, match={'tmdb_id': 1})
        self.app.state.update_movie(self.file, updated=10, **preserved)
        self.app.state.update_movie(other, updated=20, position=100)
        with self.assertRaises(ValueError):
            self.app.control('history_remove', {'id': 'missing'})
        self.assertEqual(self.app.state.movie(self.file)['updated'], 10)
        self.app.control('history_remove', {'id': self.movie.id})
        self.assertEqual(State(self.app.state.path).movie(self.file), preserved)
        self.assertEqual(self.app.state.movie(other)['updated'], 20)
        self.app.state.save_progress(self.file, 510, 1000, False, 30)
        self.assertEqual(self.app.state.movie(self.file)['updated'], 30)
        self.app.control('history_clear', {})
        saved = State(self.app.state.path)
        self.assertEqual(saved.movie(self.file), dict(preserved, position=510))
        self.assertEqual(saved.movie(other), {'position': 100})
        self.assertTrue(os.path.isfile(self.file))

    def test_http_local_endpoints_and_mutation_guards(self):
        handler = type('TestPanel', (PanelHandler,), {'app': self.app, 'log_message': lambda *args: None})
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        port = server.server_port
        self.app.panel_hosts = {'127.0.0.1:%d' % port}
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base = 'http://127.0.0.1:%d' % port
        with mock.patch.object(self.app, 'status', side_effect=AssertionError('TV status queried')):
            for route in ('health', 'library', 'movies/' + self.movie.id):
                with urllib.request.urlopen(base + '/api/' + route) as r:
                    self.assertEqual(r.status, 200)
            for path, content_type in (('/library.js', 'text/javascript'), ('/library.css', 'text/css'),
                                       ('/icons.svg', 'image/svg+xml')):
                with urllib.request.urlopen(base + path) as r:
                    self.assertEqual(r.headers.get_content_type(), content_type)
                    self.assertTrue(r.read())
        for path, headers, body in [('/api/' + action, {}, b'{}') for action in
                                    ('watched', 'history_remove', 'history_clear', 'open_local', 'reveal', 'metadata_configure',
                                     'metadata_match', 'metadata_refresh_all')] + [
                                    ('/api/health', {'Host': 'attacker.invalid'}, None),
                                    ('/library.js/../state.py', {}, None),
                                    ('/%2e%2e/state.py', {}, None),
                                    ('/api/posters/../credentials.json', {}, None)]:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(urllib.request.Request(base + path, data=body, headers=headers))
            self.assertIn(caught.exception.code, (403, 404))
            caught.exception.close()
        removed_poster = os.path.join(self.app.metadata.directory, '1.jpg')
        with mock.patch.object(self.app.metadata, 'poster', return_value=removed_poster):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(base + '/api/posters/1')
            self.assertEqual(caught.exception.code, 404)
            caught.exception.close()
        req = urllib.request.Request(base + '/api/watched', data=json.dumps({'id': self.movie.id, 'watched': True}).encode(), headers={'X-TVCast': '1'})
        with urllib.request.urlopen(req) as r:
            self.assertEqual(json.load(r), {'ok': True})


if __name__ == '__main__':
    unittest.main()
