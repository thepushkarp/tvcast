"""IMDb downloads are synthetic; cache, expiry and failure behavior use real local files."""
import gzip
import http.client
import io
import json
import os
import tempfile
import time
import unittest
import urllib.error
from unittest import mock

from tvcast import ratings as ratingsmod
from tvcast.ratings import REFRESH_SECONDS, Ratings

DATA = b"tconst\taverageRating\tnumVotes\ntt0000001\t7.4\t123\ntt0000002\t8.1\t456\n"


class RatingsTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.ratings = Ratings(directory.name)

    def update(self, imdb_id='tt0000001', data=DATA):
        self.ratings.enqueue(imdb_id)
        with mock.patch.object(ratingsmod.urllib.request, 'urlopen',
                               return_value=io.BytesIO(gzip.compress(data))) as request:
            self.ratings.refresh()
        return request

    def test_keyless_download_local_new_matches_and_offline_restart(self):
        self.ratings.enqueue('tt0000003')
        request = self.update()
        request.assert_called_once_with(ratingsmod.DATASET_URL, timeout=30)
        self.assertEqual(self.ratings.get('tt0000001'), (7.4, 123))
        self.assertEqual(self.ratings.get('tt0000003'), (None, 0))
        self.assertNotIn('tt0000002', self.ratings.values)
        with mock.patch.object(ratingsmod.urllib.request, 'urlopen', side_effect=AssertionError('network')):
            self.ratings.enqueue('tt0000002')
            self.ratings.refresh()
            self.assertEqual(self.ratings.get('tt0000002'), (8.1, 456))
            reloaded = Ratings(self.ratings.directory)
            for imdb_id in ('tt0000001', 'tt0000002', 'tt0000003'):
                reloaded.enqueue(imdb_id)
                self.assertEqual(reloaded.get(imdb_id), self.ratings.get(imdb_id))
            self.assertFalse(reloaded.status()['pending'])

    def test_daily_refresh_replaces_scores_and_removed_ratings(self):
        self.update()
        self.ratings.enqueue('tt0000001')
        self.assertFalse(self.ratings.status()['pending'])
        old = time.time() - REFRESH_SECONDS - 1
        self.ratings.updated_at = old
        os.utime(self.ratings.dataset, (old, old))
        request = self.update(data=DATA.replace(b'tt0000001\t7.4\t123\n', b''))
        self.assertEqual(request.call_count, 1)
        self.assertEqual(self.ratings.get('tt0000001'), (None, 0))

    def test_download_failure_keeps_old_scores_and_backs_off(self):
        self.update()
        self.ratings.updated_at = 0
        os.utime(self.ratings.dataset, (0, 0))
        self.ratings.enqueue('tt0000001')
        for error in (urllib.error.URLError('offline'), http.client.IncompleteRead(b'partial')):
            with mock.patch.object(ratingsmod.urllib.request, 'urlopen', side_effect=error), \
                 self.assertRaisesRegex(RuntimeError, 'Cannot update IMDb'):
                self.ratings.refresh()
        self.assertEqual(self.ratings.get('tt0000001'), (7.4, 123))
        self.assertIn('five minutes', self.ratings.status()['error'])
        self.ratings.enqueue('tt0000002')
        self.assertFalse(self.ratings.status()['pending'])
        reloaded = Ratings(self.ratings.directory)
        self.assertEqual(reloaded.get('tt0000001'), (7.4, 123))

    def test_invalid_download_never_replaces_good_dataset_or_scores(self):
        self.update()
        with open(self.ratings.dataset, 'rb') as source:
            previous = source.read()
        for data in (b'not gzip', gzip.compress(b'wrong header\n'),
                     gzip.compress(DATA.replace(b'7.4', b'nan')), gzip.compress(DATA)[:-4]):
            with self.subTest(data=data[:15]):
                self.ratings.updated_at = self.ratings.retry_at = 0
                os.utime(self.ratings.dataset, (0, 0))
                self.ratings.enqueue('tt0000001')
                with mock.patch.object(ratingsmod.urllib.request, 'urlopen', return_value=io.BytesIO(data)), \
                     self.assertRaises(RuntimeError):
                    self.ratings.refresh()
                with open(self.ratings.dataset, 'rb') as source:
                    self.assertEqual(source.read(), previous)
                self.assertEqual(self.ratings.get('tt0000001'), (7.4, 123))
        self.ratings.retry_at = 0
        self.update()
        self.assertIsNone(self.ratings.status()['error'])

    def test_corrupt_caches_rebuild_and_download_size_is_bounded(self):
        self.update()
        with open(self.ratings.cache, 'w') as output:
            json.dump({'updated_at': 'invalid', 'ratings': {}}, output)
        reloaded = Ratings(self.ratings.directory)
        self.assertIn('Cannot read', reloaded.status()['error'])
        reloaded.enqueue('tt0000001')
        with mock.patch.object(ratingsmod.urllib.request, 'urlopen', side_effect=AssertionError('network')):
            reloaded.refresh()
        self.assertEqual(reloaded.get('tt0000001'), (7.4, 123))
        self.ratings.updated_at = 0
        os.utime(self.ratings.dataset, (0, 0))
        with mock.patch.object(ratingsmod, 'MAX_DOWNLOAD_BYTES', 8), self.assertRaises(RuntimeError):
            self.update()
        self.assertEqual(self.ratings.get('tt0000001'), (7.4, 123))

    def test_matches_arriving_during_download_are_not_lost(self):
        self.ratings.enqueue('tt0000001')
        def response(*args, **kwargs):
            self.ratings.enqueue('tt0000002')
            return io.BytesIO(gzip.compress(DATA))
        with mock.patch.object(ratingsmod.urllib.request, 'urlopen', side_effect=response) as request:
            self.ratings.refresh()
            self.assertTrue(self.ratings.status()['pending'])
            self.ratings.refresh()
            self.assertEqual(request.call_count, 1)
        self.assertEqual(self.ratings.get('tt0000002'), (8.1, 456))
        self.assertFalse(self.ratings.status()['pending'])
