"""Metadata uses synthetic provider replies; no credentials or network access are needed."""
import io
import json
import os
import threading
import tempfile
import unittest
import urllib.error
import urllib.parse
from types import SimpleNamespace
from unittest import mock
from concurrent.futures import ThreadPoolExecutor

from tvcast import metadata as metadatamod
from tvcast.metadata import Metadata, ProviderUnavailable
from tvcast.state import State


class MetadataTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.state = State(os.path.join(tmp.name, 'state.json'))
        self.metadata = Metadata(self.state)
        self.metadata.configure('test-token')
        self.movie = SimpleNamespace(path=os.path.join(tmp.name, 'Film.mp4'), title='Example', year=2001)
        self.candidate = {'id': 1, 'title': 'Example', 'original_title': 'Example', 'year': 2001}
        self.details = {'id': 1, 'imdb_id': 'tt1234567', 'title': 'Example', 'release_date': '2001-01-01', 'runtime': 120,
                        'vote_count': 20, 'vote_average': 8.0, 'genres': [{'name': 'Drama'}],
                        'credits': {'crew': [{'name': 'Director', 'job': 'Director'}], 'cast': [{'name': 'Actor'}]}}

    def test_unique_match_cache_and_offline_reload(self):
        with mock.patch.object(self.metadata, 'search', return_value={'results': [self.candidate], 'more': False}), \
             mock.patch.object(self.metadata, 'request', return_value=self.details):
            self.metadata.enrich(self.movie, {}, False)
        match, data = self.metadata.info(self.movie)
        self.assertEqual(match['tmdb_id'], 1)
        self.assertEqual(data['imdb_id'], 'tt1234567')
        self.assertEqual((data['directors'], data['genres']), (['Director'], ['Drama']))
        reloaded = Metadata(State(self.state.path))
        with mock.patch.object(reloaded, 'request', side_effect=AssertionError('offline')):
            self.assertEqual(reloaded.info(self.movie)[1], data)
            reloaded.enqueue(self.movie)
            self.assertTrue(reloaded.jobs.empty())
        self.assertEqual(os.stat(self.metadata.credentials).st_mode & 0o777, 0o600)
        self.assertNotIn('test-token', json.dumps(self.metadata.status()))

    def test_older_cache_gains_external_ids_without_blocking_offline_reads(self):
        self.state.update_movie(self.movie.path, match={'tmdb_id': 1, 'source': 'manual', 'status': 'matched'})
        self.metadata.cache[1] = {'tmdb_id': 1, 'title': 'Cached title'}
        self.metadata.enqueue(self.movie)
        job = self.metadata.jobs.get_nowait()
        self.assertEqual(self.metadata.info(self.movie)[1]['title'], 'Cached title')
        with mock.patch.object(self.metadata.jobs, 'get', side_effect=[job, SystemExit]), \
             mock.patch.object(self.metadata, 'request', return_value=dict(self.details, imdb_id=None)):
            with self.assertRaises(SystemExit):
                self.metadata.run()
        self.assertIsNone(self.metadata.info(self.movie)[1]['imdb_id'])
        self.assertIsNone(self.metadata.info(self.movie)[1]['wikipedia_url'])
        self.metadata.enqueue(self.movie)
        self.assertTrue(self.metadata.jobs.empty())

    def test_languages_collection_and_characters_are_cached_without_changing_name_filters(self):
        details = dict(self.details, spoken_languages=[None, {'iso_639_1': 'en', 'english_name': 'English'},
            {'iso_639_1': 'hi', 'name': 'हिन्दी'}, {'iso_639_1': 'en', 'english_name': 'English'}, {'iso_639_1': 'bad'}],
            belongs_to_collection={'id': 42, 'name': 'Example Collection'},
            credits={'cast': [{'name': 'Actor', 'character': 'The Hero'}, {'name': 'Another', 'character': None}]})
        with mock.patch.object(self.metadata, 'request', return_value=details):
            data = self.metadata.fetch(1)
        self.assertEqual(data['languages'], [{'code': 'en', 'name': 'English'}, {'code': 'hi', 'name': 'हिन्दी'}])
        self.assertEqual(data['collection'], {'id': 42, 'name': 'Example Collection'})
        self.assertEqual(data['cast'], ['Actor', 'Another'])
        self.assertEqual(data['characters'], {'Actor': 'The Hero'})
        reloaded = Metadata(State(self.state.path))
        self.assertEqual(reloaded.cache[1], data)
        with mock.patch.object(self.metadata, 'request', return_value=dict(self.details, original_language='en',
                spoken_languages=None, belongs_to_collection={'id': -1, 'name': 'Invalid'})):
            data = self.metadata.fetch(1)
        self.assertEqual(data['languages'], [{'code': 'en', 'name': 'EN'}])
        self.assertIsNone(data['collection'])
        self.assertEqual(data['characters'], {})

    def test_us_certification_prefers_theatrical_and_ignores_unrated_or_other_regions(self):
        def releases(*regions):
            return dict(self.details, release_dates={'results': [
                {'iso_3166_1': code, 'release_dates': entries} for code, entries in regions]})
        cases = [
            (releases(('GB', [{'type': 3, 'certification': '15'}]),
                      ('US', [{'type': 4, 'certification': 'PG'}, {'type': 3, 'certification': 'NR'},
                              {'type': 3, 'certification': ' pg-13 '}, {'type': 2, 'certification': 'R'}])), 'PG-13'),
            (releases(('US', [None, {'type': 3, 'certification': ''}, {'type': 6, 'certification': 'R'}])), 'R'),
            (releases(('GB', [{'type': 3, 'certification': 'PG'}]), ('US', [{'type': 3, 'certification': 'NR'}])), None),
            (self.details, None),
        ]
        for details, expected in cases:
            with self.subTest(expected=expected), mock.patch.object(self.metadata, 'request', return_value=details):
                self.assertEqual(self.metadata.fetch(1)['certification'], expected)
        self.assertIsNone(Metadata(State(self.state.path)).cache[1]['certification'])
        with mock.patch.object(self.metadata, 'request', return_value=dict(self.details, release_dates=['invalid'])), \
             self.assertRaisesRegex(RuntimeError, 'invalid release dates'):
            self.metadata.fetch(1)

    def test_wikipedia_uses_english_sitelink_and_persists_offline(self):
        url = 'https://en.wikipedia.org/wiki/Example_(film)'
        details = dict(self.details, external_ids={'wikidata_id': 'Q123'})
        response = {'entities': {'Q123': {'sitelinks': {'enwiki': {'url': url}}}}}
        self.state.update_movie(self.movie.path, match={'tmdb_id': 1, 'source': 'manual', 'status': 'matched'})
        with mock.patch.object(self.metadata, 'request', return_value=details) as tmdb, \
             mock.patch('urllib.request.urlopen', return_value=io.BytesIO(json.dumps(response).encode())) as wikidata:
            self.metadata.enrich(self.movie, self.state.movie(self.movie.path)['match'], False)
        tmdb.assert_called_once_with('movie/1', {'append_to_response': 'credits,external_ids,release_dates', 'language': 'en-US'})
        request = wikidata.call_args.args[0]
        self.assertEqual(urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query), {
            'action': ['wbgetentities'], 'ids': ['Q123'], 'props': ['sitelinks/urls'],
            'sitefilter': ['enwiki'], 'format': ['json']})
        self.assertIsNone(request.get_header('Authorization'))
        self.assertIn('TV-Cast', request.get_header('User-agent'))
        self.assertEqual(wikidata.call_args.kwargs['timeout'], 10)
        reloaded = Metadata(State(self.state.path))
        with mock.patch('urllib.request.urlopen', side_effect=AssertionError('offline')):
            data = reloaded.info(self.movie)[1]
            self.assertEqual((data['wikidata_id'], data['wikipedia_url']), ('Q123', url))
            reloaded.enqueue(self.movie)
            self.assertTrue(reloaded.jobs.empty())

    def test_missing_wikipedia_article_and_invalid_ids_are_cached_without_repeated_lookups(self):
        self.state.update_movie(self.movie.path, match={'tmdb_id': 1, 'source': 'manual', 'status': 'matched'})
        for qid in (None, 'Q0', 'Q123/../../bad', 'Q123'):
            with self.subTest(qid=qid), \
                 mock.patch.object(self.metadata, 'request', return_value=dict(self.details, external_ids={'wikidata_id': qid})), \
                 mock.patch('urllib.request.urlopen', return_value=io.BytesIO(b'{"entities":{"Q123":{"sitelinks":{}}}}')) as request:
                data = self.metadata.fetch(1)
                self.assertIsNone(data['wikipedia_url'])
                self.assertEqual(request.call_count, int(qid == 'Q123'))
                self.metadata.enqueue(self.movie)
                self.assertTrue(self.metadata.jobs.empty())

    def test_wikipedia_rejects_unsafe_links_and_malformed_or_oversized_replies(self):
        replies = [b'{broken', b'{}', b'x' * (1024 * 1024 + 1)]
        for url in ('http://en.wikipedia.org/wiki/Film', 'https://en.wikipedia.org.evil/wiki/Film',
                    'https://en.wikipedia.org@evil.test/wiki/Film', 'javascript:alert(1)',
                    'https://en.wikipedia.org/wiki/', 'https://en.wikipedia.org/wiki/Film\n'):
            replies.append(json.dumps({'entities': {'Q123': {'sitelinks': {'enwiki': {'url': url}}}}}).encode())
        for reply in replies:
            with self.subTest(reply=reply[:100]), \
                 mock.patch('urllib.request.urlopen', return_value=io.BytesIO(reply)), \
                 self.assertRaisesRegex(RuntimeError, 'Wikipedia link for Q123.*Refresh metadata'):
                self.metadata.wikipedia('Q123')

    def test_wikipedia_outage_keeps_text_posters_and_links_for_the_same_identity_and_retries(self):
        now = 1_000_000
        old_url = 'https://en.wikipedia.org/wiki/Example_(film)'
        for qid in ('Q123', 'Q456'):
            with self.subTest(qid=qid):
                expected = {'tmdb_id': 1, 'source': 'manual', 'status': 'matched'}
                self.state.update_movie(self.movie.path, match=expected)
                self.metadata.cache[1] = dict(self.details, wikidata_id='Q123', wikipedia_url=old_url)
                details = dict(self.details, poster_path='/poster.jpg', external_ids={'wikidata_id': qid})
                def provider(request, **kwargs):
                    if isinstance(request, str) and request.startswith('https://image.tmdb.org/'):
                        return io.BytesIO(b'\xff\xd8\xffposter')
                    raise OSError('offline')
                with mock.patch.object(metadatamod.time, 'time', return_value=now), \
                     mock.patch.object(self.metadata, 'request', return_value=details), \
                     mock.patch('urllib.request.urlopen', side_effect=provider):
                    with self.assertRaisesRegex(RuntimeError, 'Wikipedia link for ' + qid):
                        self.metadata.enrich(self.movie, expected, True)
                failed, cached = Metadata(State(self.state.path)).info(self.movie)
                self.assertEqual((failed['status'], cached['title']), ('error', 'Example'))
                self.assertTrue(os.path.isfile(self.metadata.poster(1)))
                self.assertEqual(cached.get('wikipedia_url'), old_url if qid == 'Q123' else None)
                self.assertEqual('wikipedia_url' in cached, qid == 'Q123')
                with mock.patch.object(metadatamod.time, 'time', return_value=now + 299):
                    self.metadata.enqueue(self.movie)
                    self.assertTrue(self.metadata.jobs.empty())
                with mock.patch.object(metadatamod.time, 'time', return_value=now + 301):
                    self.metadata.enqueue(self.movie)
                    job = self.metadata.jobs.get_nowait()
                    response = {'entities': {qid: {'sitelinks': {}}}}
                    with mock.patch.object(self.metadata.jobs, 'get', side_effect=[job, SystemExit]), \
                         mock.patch.object(self.metadata, 'request', return_value=dict(details, poster_path=None)), \
                         mock.patch('urllib.request.urlopen', return_value=io.BytesIO(json.dumps(response).encode())):
                        with self.assertRaises(SystemExit):
                            self.metadata.run()
                recovered, cached = self.metadata.info(self.movie)
                self.assertEqual(recovered['status'], 'matched')
                self.assertIsNone(cached['wikipedia_url'])

    def test_ambiguous_wrong_year_and_missing_year_stay_unmatched(self):
        for results, more, year in [([self.candidate, dict(self.candidate, id=2)], False, 2001),
                                    ([dict(self.candidate, year=2002)], False, 2001),
                                    ([self.candidate], True, 2001), ([self.candidate], False, None)]:
            self.movie.year = year
            self.state.update_movie(self.movie.path, match={})
            with mock.patch.object(self.metadata, 'search', return_value={'results': results, 'more': more}), \
                 mock.patch.object(self.metadata, 'request', return_value={'results': [], 'titles': []}), \
                 mock.patch.object(self.metadata, 'fetch') as fetch:
                self.metadata.enrich(self.movie, {}, False)
                fetch.assert_not_called()
            self.assertEqual(self.metadata.info(self.movie)[0]['status'], 'unmatched')

    def test_paginated_matching_deduplicates_ids_and_rejects_later_collision(self):
        candidate = dict(self.details, original_title='Example')
        for second_id, expected in ((1, 1), (2, None)):
            with self.subTest(second_id=second_id):
                pages = []
                def provider(path, params=None):
                    self.assertEqual(path, 'search/movie')
                    page = params.get('page', 1)
                    pages.append(page)
                    return {'results': [dict(candidate, id=1 if page == 1 else second_id)], 'total_pages': 2}
                with mock.patch.object(self.metadata, 'request', side_effect=provider):
                    matched, reason = self.metadata.find_match(self.movie)
                self.assertEqual(matched, expected)
                self.assertIn(2, pages)
                if expected is None:
                    self.assertTrue(reason)

    def test_edition_labels_retry_the_clean_title(self):
        self.movie.year = 2005
        candidate = dict(self.details, title='Example Film', original_title='Example Film', release_date='2005-04-01')
        for suffix in ('EXTENDED', 'UNRATED'):
            with self.subTest(suffix=suffix):
                self.movie.title = 'Example Film ' + suffix
                queries = []
                def provider(path, params=None):
                    self.assertEqual(path, 'search/movie')
                    queries.append(params['query'])
                    return {'results': [candidate] if params['query'] == 'Example Film' else [], 'total_pages': 1}
                with mock.patch.object(self.metadata, 'request', side_effect=provider):
                    matched, _ = self.metadata.find_match(self.movie)
                self.assertEqual(matched, 1)
                self.assertIn('Example Film', queries)

    def test_adjacent_year_requires_an_actual_release_in_filename_year(self):
        for title, year in (('123', 2006), ('Example Feature', 2009)):
            for confirmed in (True, False):
                with self.subTest(title=title, confirmed=confirmed):
                    self.movie.title, self.movie.year = title, year
                    candidate = dict(self.details, title=title, original_title=title, release_date='%d-03-01' % (year + 1))
                    def provider(path, params=None):
                        if path == 'search/movie':
                            return {'results': [candidate], 'total_pages': 1}
                        self.assertEqual(path, 'movie/1/release_dates')
                        release_year = year if confirmed else year + 1
                        return {'results': [{'iso_3166_1': 'FR', 'release_dates': [
                            {'release_date': '%d-12-09T00:00:00.000Z' % release_year}]}]}
                    with mock.patch.object(self.metadata, 'request', side_effect=provider):
                        matched, reason = self.metadata.find_match(self.movie)
                    self.assertEqual(matched, 1 if confirmed else None)
                    if not confirmed:
                        self.assertTrue(reason)

    def test_same_title_and_year_remains_ambiguous_with_a_reason(self):
        self.movie.title, self.movie.year = 'Shared Title', 1997
        candidate = dict(self.details, title='Shared Title', original_title='Shared Title', release_date='1997-01-01')
        with mock.patch.object(self.metadata, 'request', return_value={
                'results': [candidate, dict(candidate, id=2)], 'total_pages': 1}):
            self.metadata.enrich(self.movie, {}, False)
        match, data = self.metadata.info(self.movie)
        self.assertEqual(match['status'], 'unmatched')
        self.assertTrue(match['reason'])
        self.assertEqual(match['matcher_version'], metadatamod.MATCH_VERSION)
        self.assertGreater(match['checked_at'], 0)
        self.assertFalse(data)

    def test_alias_can_identify_one_of_several_same_year_candidates(self):
        self.movie.title = 'Example Saga Episode IX - The Final Chapter'
        self.movie.year = 2019
        candidate = dict(self.details, title='Example Saga: The Final Chapter',
                         original_title='Example Saga: The Final Chapter', release_date='2019-12-18')
        def provider(path, params=None):
            if path == 'search/movie':
                return {'results': [candidate, dict(candidate, id=2, title='Different Film', original_title='Different Film')], 'total_pages': 1}
            if path == 'movie/1/alternative_titles':
                return {'titles': [{'title': 'Example Saga: Episode IX – The Final Chapter'}]}
            self.assertEqual(path, 'movie/2/alternative_titles')
            return {'titles': [{'title': 'Unrelated Film'}]}
        with mock.patch.object(self.metadata, 'request', side_effect=provider):
            matched, _ = self.metadata.find_match(self.movie)
        self.assertEqual(matched, 1)

    def test_unique_episode_title_matches_provider_alias(self):
        self.movie.title = 'Example Saga Episode IX - The Final Chapter'
        self.movie.year = 2019
        candidate = dict(self.candidate, title='Example Saga: The Final Chapter',
                         original_title='Example Saga: The Final Chapter', year=2019)
        aliases = {'titles': [None, {'title': 'Example Saga: Episode IX – The Final Chapter'}]}
        with mock.patch.object(self.metadata, 'search', return_value={'results': [candidate], 'more': False}), \
             mock.patch.object(self.metadata, 'request', return_value=aliases) as request, \
             mock.patch.object(self.metadata, 'fetch') as fetch:
            self.metadata.enrich(self.movie, {}, False)
        request.assert_called_once_with('movie/1/alternative_titles')
        fetch.assert_called_once_with(1, refresh=False)
        self.assertEqual(self.metadata.info(self.movie)[0]['tmdb_id'], 1)

    def test_single_search_result_still_needs_a_matching_title_or_alias(self):
        candidate = dict(self.candidate, title='Something Else', original_title='Something Else')
        with mock.patch.object(self.metadata, 'search', return_value={'results': [candidate], 'more': False}), \
             mock.patch.object(self.metadata, 'request', return_value={'titles': [{'title': 'Unrelated Film'}]}), \
             mock.patch.object(self.metadata, 'fetch') as fetch:
            self.metadata.enrich(self.movie, {}, False)
        fetch.assert_not_called()
        self.assertEqual(self.metadata.info(self.movie)[0]['status'], 'unmatched')

    def test_manual_correction_wins_over_inflight_search_and_rescan(self):
        def search(*args, **kwargs):
            self.metadata.correct(self.movie, 2)
            return {'results': [self.candidate], 'more': False}
        with mock.patch.object(self.metadata, 'search', side_effect=search), mock.patch.object(self.metadata, 'fetch') as fetch:
            self.metadata.enrich(self.movie, {}, False)
            fetch.assert_not_called()
        self.assertEqual(self.metadata.info(self.movie)[0]['tmdb_id'], 2)
        self.metadata.correct(self.movie, None)
        self.metadata.enqueue(self.movie, refresh=True)
        self.assertEqual(self.metadata.info(self.movie)[0]['source'], 'none')

    def test_failed_provider_requests_are_actionable_and_do_not_echo_token(self):
        for code in (401, 429, 503):
            self.metadata.configure('test-token')
            error = urllib.error.HTTPError('https://example.invalid/test-token', code, 'test-token', {}, io.BytesIO())
            with mock.patch('urllib.request.urlopen', side_effect=error), self.assertRaises(RuntimeError) as caught:
                self.metadata.request('movie/1')
            error.close()
            self.assertNotIn('test-token', str(caught.exception))
            if code in (401, 429):
                with mock.patch('urllib.request.urlopen') as request, self.assertRaises(RuntimeError):
                    self.metadata.request('movie/1')
                request.assert_not_called()

    def test_poster_paths_cannot_escape_cache(self):
        for path in ('../credentials.json', '1/../../secret', '-1', 'foo', '1.jpg'):
            self.assertIsNone(self.metadata.poster(path))
        with mock.patch.object(self.metadata, 'request', return_value=dict(self.details, poster_path='/../../secret.jpg')):
            with self.assertRaisesRegex(RuntimeError, 'poster path'):
                self.metadata.fetch(1)

    def test_concurrent_editions_share_a_single_fetch(self):
        gate = threading.Barrier(3)
        self.metadata.cache[1] = {'tmdb_id': 1, 'imdb_id': 'tt1234567', 'title': 'Older cache'}
        def get():
            gate.wait(timeout=3)
            return self.metadata.fetch(1, refresh=False)
        details = dict(self.details, external_ids={'wikidata_id': 'Q123'})
        response = b'{"entities":{"Q123":{"sitelinks":{"enwiki":{"url":"https://en.wikipedia.org/wiki/Example"}}}}}'
        with mock.patch.object(self.metadata, 'request', return_value=details) as request, \
             mock.patch('urllib.request.urlopen', return_value=io.BytesIO(response)) as wikidata:
            with ThreadPoolExecutor(max_workers=3) as pool:
                results = list(pool.map(lambda _: get(), range(3)))
            self.assertEqual(request.call_count, 1)
            self.assertEqual(wikidata.call_count, 1)
            self.assertEqual(results[0], results[2])

    def test_provider_outage_keeps_match_retryable_and_cached_correction_is_ready(self):
        with mock.patch.object(metadatamod.time, 'time', return_value=1_000_000), \
             mock.patch.object(self.metadata, 'search', side_effect=ProviderUnavailable('offline')):
            with self.assertRaisesRegex(ProviderUnavailable, 'offline'):
                self.metadata.enrich(self.movie, {}, False)
        failed = self.metadata.info(self.movie)[0]
        self.assertEqual(failed['status'], 'error')
        self.assertEqual(failed['matcher_version'], metadatamod.MATCH_VERSION)
        self.assertGreaterEqual(failed['retry_at'], failed['checked_at'] + 60)
        self.metadata.cache[1] = {'tmdb_id': 1, 'title': 'Example'}
        self.metadata.correct(self.movie, 1)
        self.assertEqual(self.metadata.info(self.movie)[0]['status'], 'matched')

    def test_poster_failure_retries_after_delay_even_with_cached_text(self):
        now = 1_000_000
        expected = {'tmdb_id': 1, 'source': 'auto', 'status': 'matched'}
        self.state.update_movie(self.movie.path, match=expected)
        details = dict(self.details, poster_path='/poster.jpg')
        with mock.patch.object(metadatamod.time, 'time', return_value=now), \
             mock.patch.object(self.metadata, 'request', return_value=details), \
             mock.patch('urllib.request.urlopen', side_effect=OSError('offline')):
            with self.assertRaisesRegex(RuntimeError, 'poster'):
                self.metadata.enrich(self.movie, expected, True)
        failed, cached = self.metadata.info(self.movie)
        self.assertEqual((failed['status'], cached['title']), ('error', 'Example'))
        self.assertIsNone(self.metadata.poster(1))
        with mock.patch.object(metadatamod.time, 'time', return_value=now + 299):
            self.metadata.enqueue(self.movie)
            self.assertTrue(self.metadata.jobs.empty())
        with mock.patch.object(metadatamod.time, 'time', return_value=now + 301):
            self.metadata.enqueue(self.movie)
            job = self.metadata.jobs.get_nowait()
            with mock.patch.object(self.metadata.jobs, 'get', side_effect=[job, SystemExit]), \
                 mock.patch.object(self.metadata, 'request', return_value=details) as request, \
                 mock.patch('urllib.request.urlopen', return_value=io.BytesIO(b'\xff\xd8\xffposter')):
                with self.assertRaises(SystemExit):
                    self.metadata.run()
        request.assert_called_once()
        self.assertTrue(os.path.isfile(self.metadata.poster(1)))
        recovered = self.metadata.info(self.movie)[0]
        self.assertEqual(recovered['status'], 'matched')
        self.assertNotIn('error', recovered)
        self.assertNotIn('retry_at', recovered)

    def test_transient_refresh_failure_keeps_cached_data_and_retry_intent(self):
        now = 1_000_000
        expected = {'tmdb_id': 1, 'source': 'manual', 'status': 'matched'}
        self.state.update_movie(self.movie.path, match=expected)
        self.metadata.cache[1] = {'tmdb_id': 1, 'imdb_id': None, 'title': 'Cached title'}
        with mock.patch.object(metadatamod.time, 'time', return_value=now), \
             mock.patch.object(self.metadata, 'request', side_effect=ProviderUnavailable('offline')):
            with self.assertRaisesRegex(ProviderUnavailable, 'offline'):
                self.metadata.enrich(self.movie, expected, True)
        failed, cached = self.metadata.info(self.movie)
        self.assertEqual((failed['status'], cached['title']), ('error', 'Cached title'))
        with mock.patch.object(metadatamod.time, 'time', return_value=now + 59):
            self.metadata.enqueue(self.movie)
            self.assertTrue(self.metadata.jobs.empty())
        with mock.patch.object(metadatamod.time, 'time', return_value=now + 61):
            self.metadata.enqueue(self.movie)
            job = self.metadata.jobs.get_nowait()
            with mock.patch.object(self.metadata.jobs, 'get', side_effect=[job, SystemExit]), \
                 mock.patch.object(self.metadata, 'request', return_value=self.details) as request:
                with self.assertRaises(SystemExit):
                    self.metadata.run()
        request.assert_called_once()
        recovered, cached = self.metadata.info(self.movie)
        self.assertEqual((recovered['source'], recovered['status'], cached['title']), ('manual', 'matched', 'Example'))
        self.assertNotIn('retry_at', recovered)

    def test_queued_cached_refresh_survives_another_jobs_provider_pause(self):
        now = 1_000_000
        self.state.update_movie(self.movie.path, match={'tmdb_id': 1, 'source': 'manual', 'status': 'matched'})
        self.metadata.cache[1] = {'tmdb_id': 1, 'imdb_id': None, 'title': 'Cached title'}
        self.metadata.enqueue(self.movie, refresh=True)
        job = self.metadata.jobs.get_nowait()
        self.metadata.paused = True
        self.metadata.pause_until = self.metadata.retry_at = now + 120
        self.metadata.error = 'TMDB is rate limiting requests'
        with mock.patch.object(metadatamod.time, 'time', return_value=now), \
             mock.patch.object(self.metadata.jobs, 'get', side_effect=[job, SystemExit]), \
             mock.patch.object(self.metadata, 'request') as request:
            with self.assertRaises(SystemExit):
                self.metadata.run()
        request.assert_not_called()
        self.assertEqual(self.metadata.info(self.movie)[1]['title'], 'Cached title')
        with mock.patch.object(metadatamod.time, 'time', return_value=now + 119):
            self.metadata.enqueue(self.movie)
            self.assertTrue(self.metadata.jobs.empty())
        with mock.patch.object(metadatamod.time, 'time', return_value=now + 121):
            self.metadata.enqueue(self.movie)
            job = self.metadata.jobs.get_nowait()
            with mock.patch.object(self.metadata.jobs, 'get', side_effect=[job, SystemExit]), \
                 mock.patch.object(self.metadata, 'request', return_value=self.details) as request:
                with self.assertRaises(SystemExit):
                    self.metadata.run()
        request.assert_called_once()
        recovered, cached = self.metadata.info(self.movie)
        self.assertEqual((recovered['source'], recovered['status'], cached['title']), ('manual', 'matched', 'Example'))
        self.assertNotIn('retry_at', recovered)

    def test_negative_cache_retries_after_upgrade_or_expiry_but_keeps_manual_decisions(self):
        now = 1_000_000
        cases = [
            ({'source': 'auto', 'status': 'unmatched', 'checked_at': now}, True),
            ({'source': 'auto', 'status': 'unmatched', 'matcher_version': metadatamod.MATCH_VERSION, 'checked_at': now - 10}, False),
            ({'source': 'auto', 'status': 'unmatched', 'matcher_version': metadatamod.MATCH_VERSION, 'checked_at': now - 86401}, True),
            ({'source': 'auto', 'status': 'error', 'matcher_version': metadatamod.MATCH_VERSION, 'checked_at': now - 10}, False),
            ({'source': 'auto', 'status': 'error', 'matcher_version': metadatamod.MATCH_VERSION, 'checked_at': now - 301}, True),
            ({'source': 'none', 'status': 'unmatched', 'checked_at': 0}, False),
        ]
        with mock.patch.object(metadatamod.time, 'time', return_value=now):
            for match, queued in cases:
                with self.subTest(match=match):
                    self.state.update_movie(self.movie.path, match=match)
                    self.metadata.enqueue(self.movie)
                    self.assertEqual(not self.metadata.jobs.empty(), queued)
                    if queued:
                        self.metadata.jobs.get_nowait()
                        self.metadata.jobs.task_done()
                        self.metadata.pending.clear()
            self.metadata.cache[1] = {'tmdb_id': 1, 'imdb_id': None, 'wikidata_id': None, 'wikipedia_url': None,
                                      'languages': [], 'collection': None, 'characters': {}, 'certification': None,
                                      'title': 'Example'}
            self.state.update_movie(self.movie.path, match={'tmdb_id': 1, 'source': 'manual', 'status': 'matched'})
            self.metadata.enqueue(self.movie)
            self.assertTrue(self.metadata.jobs.empty())

    def test_transient_provider_pause_expires_without_retrying_bad_credentials(self):
        now = 1_000_000
        with mock.patch.object(metadatamod.time, 'time', return_value=now):
            self.metadata.enqueue(self.movie)
            job = self.metadata.jobs.get_nowait()
            with mock.patch.object(self.metadata.jobs, 'get', side_effect=[job, SystemExit]), \
                 mock.patch.object(self.metadata, 'request', side_effect=ProviderUnavailable('offline')):
                with self.assertRaises(SystemExit):
                    self.metadata.run()
            self.assertGreaterEqual(self.metadata.pause_until, now + 60)
            self.metadata.enqueue(self.movie)
            self.assertTrue(self.metadata.jobs.empty())
        with mock.patch.object(metadatamod.time, 'time', return_value=now + 61):
            self.metadata.enqueue(self.movie)
            self.assertFalse(self.metadata.jobs.empty())
            self.metadata.jobs.get_nowait()
            self.metadata.jobs.task_done()
            self.metadata.pending.clear()
        self.metadata.auth_failed = True
        with mock.patch.object(metadatamod.time, 'time', return_value=now + 86400):
            self.metadata.enqueue(self.movie)
            self.assertTrue(self.metadata.jobs.empty())

    def test_manual_correction_fetches_after_provider_pause(self):
        self.metadata.paused = True
        self.metadata.error = 'offline'
        self.metadata.correct(self.movie, 1)
        job = self.metadata.jobs.get_nowait()
        with mock.patch.object(self.metadata.jobs, 'get', side_effect=[job, SystemExit]), \
             mock.patch.object(self.metadata, 'request', return_value=self.details) as request:
            with self.assertRaises(SystemExit):
                self.metadata.run()
        request.assert_called_once()
        match, data = self.metadata.info(self.movie)
        self.assertEqual((match['source'], match['status'], data['title']), ('manual', 'matched', 'Example'))

    def test_null_provider_fields_and_corrupt_cache_do_not_break_browsing(self):
        with mock.patch.object(self.metadata, 'request', return_value={'results': [None, dict(self.details, overview=None, original_title=None)]}):
            result = self.metadata.search('Example')['results'][0]
            self.assertEqual((result['overview'], result['original_title']), ('', ''))
        with mock.patch.object(self.metadata, 'request', return_value=dict(self.details, genres=None, credits=None)):
            self.assertEqual(self.metadata.fetch(1)['genres'], [])
        with open(os.path.join(self.metadata.directory, '1.json'), 'w') as f:
            f.write('{broken')
        reloaded = Metadata(self.state)
        self.assertIn('Cannot read cached', reloaded.status()['error'])
        self.assertEqual(reloaded.info(self.movie)[1], {})


if __name__ == '__main__':
    unittest.main()
