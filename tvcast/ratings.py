"""Keyless IMDb ratings; one background worker owns the compressed dataset and cache."""
import gzip
import http.client
import json
import math
import os
import re
import tempfile
import threading
import time
import urllib.request
import zlib

DATASET_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz"
REFRESH_SECONDS = 24 * 60 * 60
RETRY_SECONDS = 5 * 60
MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024
MAX_DATASET_BYTES = 128 * 1024 * 1024
IMDB_ID = re.compile(r"tt\d+", re.ASCII)


def valid_rating(value):
    return (value is None or isinstance(value, list) and len(value) == 2
            and type(value[0]) in (int, float) and math.isfinite(value[0]) and 1 <= value[0] <= 10
            and type(value[1]) is int and value[1] > 0)


def read_ratings(path, wanted):
    """Scan through EOF to validate gzip integrity, retaining only requested IDs.

    Explicit nulls remember unrated titles so every scan doesn't reparse the dataset.
    Bounds cover both oversized downloads and decompression without loading the TSV.
    """
    ratings = dict.fromkeys(wanted)
    with gzip.open(path, "rt", encoding="utf-8") as source:
        header = source.readline(128)
        if header != "tconst\taverageRating\tnumVotes\n":
            raise ValueError("unexpected ratings header")
        size, rows = len(header), 0
        while True:
            line = source.readline(128)
            if not line:
                break
            size += len(line)
            if size > MAX_DATASET_BYTES or not line.endswith("\n"):
                raise ValueError("oversized or incomplete ratings data")
            imdb_id, score, votes = line.rstrip("\n").split("\t")
            value = [float(score), int(votes)]
            if not IMDB_ID.fullmatch(imdb_id) or not valid_rating(value):
                raise ValueError("invalid rating entry")
            if imdb_id in ratings:
                ratings[imdb_id] = value
            rows += 1
        if not rows:
            raise ValueError("empty ratings dataset")
    return ratings


class Ratings:
    def __init__(self, directory):
        self.directory = directory
        self.dataset = os.path.join(directory, "imdb-ratings.tsv.gz")
        self.cache = os.path.join(directory, "imdb-ratings.json")
        self.lock = threading.Lock()
        self.wake = threading.Event()
        self.wanted = set()
        self.values = {}
        self.updated_at = self.retry_at = 0
        self.pending = False
        self.error = None
        self.invalid_dataset = False
        try:
            with open(self.cache) as source:
                data = json.load(source)
            stamp, values = data["updated_at"], data["ratings"]
            if (type(stamp) not in (int, float) or not math.isfinite(stamp) or stamp < 0
                    or not isinstance(values, dict) or any(
                        not IMDB_ID.fullmatch(key) or not valid_rating(value) for key, value in values.items())):
                raise ValueError("invalid ratings cache")
            self.updated_at, self.values = stamp, values
        except FileNotFoundError:
            pass
        except (OSError, ValueError, KeyError, TypeError):
            self.error = "Cannot read cached IMDb ratings; ratings will be rebuilt automatically"

    def get(self, imdb_id):
        if not isinstance(imdb_id, str):
            return None, 0
        with self.lock:
            value = self.values.get(imdb_id)
            return tuple(value) if value else (None, 0)

    def status(self):
        with self.lock:
            return {"pending": self.pending, "error": self.error}

    def enqueue(self, imdb_id=None):
        with self.lock:
            if isinstance(imdb_id, str) and IMDB_ID.fullmatch(imdb_id):
                self.wanted.add(imdb_id)
            if (not self.wanted or self.pending or time.time() < self.retry_at
                    or time.time() - self.updated_at < REFRESH_SECONDS and self.wanted <= self.values.keys()):
                return
            self.pending = True
            self.wake.set()

    def refresh(self):
        """Run one queued update; failures preserve published ratings and retry after a delay."""
        temporary = None
        try:
            with self.lock:
                wanted = self.wanted | self.values.keys()
            os.makedirs(self.directory, exist_ok=True)
            try:
                stamp = os.path.getmtime(self.dataset)
            except FileNotFoundError:
                stamp = 0
            path = self.dataset
            if self.invalid_dataset or time.time() - stamp >= REFRESH_SECONDS:
                with tempfile.NamedTemporaryFile(dir=self.directory, suffix=".gz.tmp", delete=False) as output:
                    temporary = path = output.name
                    with urllib.request.urlopen(DATASET_URL, timeout=30) as response:
                        size = 0
                        while True:
                            chunk = response.read(64 * 1024)
                            if not chunk:
                                break
                            size += len(chunk)
                            if size > MAX_DOWNLOAD_BYTES:
                                raise ValueError("oversized ratings download")
                            output.write(chunk)
                stamp = os.path.getmtime(path)
            try:
                values = read_ratings(path, wanted)
            except (OSError, EOFError, ValueError, zlib.error):
                # A corrupt local snapshot needs a fresh download on the next retry.
                self.invalid_dataset = True
                raise
            if temporary:
                os.replace(temporary, self.dataset)
                temporary = None
            with open(self.cache + ".tmp", "w") as output:
                os.fchmod(output.fileno(), 0o600)
                json.dump({"updated_at": stamp, "ratings": values}, output)
            os.replace(self.cache + ".tmp", self.cache)
            with self.lock:
                self.values, self.updated_at = values, stamp
                self.error, self.retry_at, self.invalid_dataset = None, 0, False
        except (OSError, EOFError, ValueError, zlib.error, http.client.HTTPException) as error:
            with self.lock:
                self.error = f"Cannot update IMDb ratings ({error}). Retrying in five minutes."
                self.retry_at = time.time() + RETRY_SECONDS
            raise RuntimeError(self.error) from error
        finally:
            if temporary:
                os.unlink(temporary)
            with self.lock:
                self.pending = False
            # IDs can arrive while parsing. Queue another local pass for any that were missed.
            self.enqueue()

    def run(self):
        while True:
            self.wake.wait()
            self.wake.clear()
            try:
                self.refresh()
            except RuntimeError:
                # refresh exposes the failure through status and applies a retry delay.
                continue
