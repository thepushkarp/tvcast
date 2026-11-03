"""Bounded background TMDB enrichment; catalogue reads use only local cached data."""
import json
import os
import queue
import re
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

MATCH_VERSION = 2  # Increment when matching rules change so cached negative results are rechecked.
MATCH_RETRY_SECONDS = 24 * 60 * 60
ERROR_RETRY_SECONDS = 5 * 60
MAX_SEARCH_PAGES = 25
EDITION_SUFFIX = re.compile(
    r"[\s\[(\-:]+(?:(?:extended|unrated|uncut|remastered)(?:\s+(?:edition|cut|version))?"
    r"|director['’]?s\s+cut|theatrical\s+cut)(?:\s*(?:and|&|\+)\s*(?:unrated|uncut))?[\s\])]*$", re.I)


class ProviderUnavailable(RuntimeError):
    """A provider-wide failure; pause enrichment instead of failing every queued movie."""


def normalized(value):
    return "".join(c for c in unicodedata.normalize("NFKD", value).casefold() if c.isalnum())


def atomic_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w") as f:
        os.fchmod(f.fileno(), 0o600)
        json.dump(value, f)
    os.replace(path + ".tmp", path)


def read_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except ValueError as e:
        raise RuntimeError("Cannot read metadata cache %s: %s" % (path, e)) from e


class Metadata:
    def __init__(self, state):
        self.state = state
        self.directory = os.path.join(os.path.dirname(os.path.abspath(state.path)), "metadata")
        self.credentials = os.path.join(self.directory, "credentials.json")
        self.token = ""
        self.lock = threading.RLock()
        self.jobs = queue.Queue()
        self.pending = set()
        self.cache = {}
        self.fetch_locks = {}
        self.error = None
        self.paused = False
        self.pause_until = 0
        self.retry_at = 0
        self.auth_failed = False
        try:
            credentials = read_json(self.credentials, {})
            if not isinstance(credentials, dict) or not isinstance(credentials.get("token", ""), str):
                raise RuntimeError("Invalid credential format")
            self.token = credentials.get("token", "")
        except RuntimeError:
            self.error = "Cannot read the saved TMDB credential; enter it again in Settings"
        if os.path.isdir(self.directory):
            for name in os.listdir(self.directory):
                if re.fullmatch(r"[1-9]\d*\.json", name):
                    try:
                        data = read_json(os.path.join(self.directory, name), {})
                        if not isinstance(data, dict):
                            raise RuntimeError("Invalid cache format")
                        self.cache[int(name[:-5])] = data
                    except RuntimeError:
                        self.error = "Cannot read cached TMDB movie %s; use Refresh metadata in the Library" % name[:-5]

    def status(self):
        with self.lock:
            return {"configured": bool(self.token), "pending": len(self.pending), "error": self.error}

    def configure(self, token):
        if not isinstance(token, str) or len(token) > 4096 or any(c.isspace() for c in token):
            raise ValueError("Enter a TMDB API Read Access Token without whitespace")
        with self.lock:
            atomic_json(self.credentials, {"token": token})
            self.token, self.error, self.auth_failed, self.retry_at = token, None, False, 0
            self.paused = False

    def retry_missing(self, movies):
        with self.lock:
            self.paused = False
        for movie in movies:
            match, data = self.info(movie)
            if not data or match.get("status") == "error":
                self.enqueue(movie, refresh=True)

    def request(self, path, params=None):
        with self.lock:
            token, retry_at, auth_failed = self.token, self.retry_at, self.auth_failed
        if not token:
            raise ProviderUnavailable("Add a TMDB Read Access Token in Settings to fetch movie information")
        if auth_failed:
            raise ProviderUnavailable("TMDB rejected the token; replace it in Settings")
        if time.time() < retry_at:
            raise ProviderUnavailable("TMDB is rate limiting requests; movie information will retry automatically")
        url = "https://api.themoviedb.org/3/" + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token,
                                                   "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                data = response.read(4 * 1024 * 1024 + 1)
            if len(data) > 4 * 1024 * 1024:
                raise RuntimeError("TMDB returned an oversized response")
            result = json.loads(data)
            if not isinstance(result, dict):
                raise RuntimeError("TMDB returned invalid movie information; try Refresh metadata")
            return result
        except urllib.error.HTTPError as e:
            with self.lock:
                if e.code in (401, 403):
                    if self.token == token:
                        self.auth_failed = True
                    raise ProviderUnavailable("TMDB rejected the token; replace it in Settings") from e
                if e.code == 429:
                    delay = e.headers.get("Retry-After", "60")
                    self.retry_at = time.time() + (max(60, min(int(delay), 3600)) if delay.isdigit() else 60)
                    raise ProviderUnavailable("TMDB is rate limiting requests; movie information will retry automatically") from e
                if e.code >= 500:
                    raise ProviderUnavailable("TMDB is unavailable; movie information will retry automatically") from e
            raise RuntimeError("TMDB request failed (HTTP %d); try Refresh metadata" % e.code) from e
        except (OSError, ValueError) as e:
            # Do not include provider exceptions: a request or response can contain credentials.
            raise ProviderUnavailable("Cannot fetch TMDB information; check your connection. Movie information will retry automatically") from e

    def search(self, title, year=None, page=1):
        if not isinstance(title, str) or not title.strip() or len(title) > 300:
            raise ValueError("Enter a movie title (up to 300 characters)")
        params = {"query": title.strip(), "language": "en-US"}
        if page > 1:
            params["page"] = page
        if year not in (None, ""):
            if not str(year).isdigit() or not 1800 <= int(year) <= 2200:
                raise ValueError("Year must be between 1800 and 2200")
            params["year"] = int(year)
        data = self.request("search/movie", params)
        results = [{"id": m["id"], "title": m.get("title") or "", "original_title": m.get("original_title") or "",
                    "year": self.year(m), "overview": m.get("overview") or ""}
                   for m in (data.get("results") or []) if isinstance(m, dict) and type(m.get("id")) is int and m["id"] > 0
                   and isinstance(m.get("title"), str) and isinstance(m.get("original_title") or "", str)
                   and isinstance(m.get("overview") or "", str)]
        return {"results": results, "more": data.get("total_pages", 1) > page}

    def _search_all(self, title, year):
        results = {}
        for page in range(1, MAX_SEARCH_PAGES + 1):
            data = self.search(title, year, page)
            results.update((movie["id"], movie) for movie in data["results"])
            if not data["more"]:
                return list(results.values()), True
        return list(results.values()), False

    def find_match(self, movie):
        if not movie.year:
            return None, "A release year is needed for automatic matching. Use Correct match."
        queries = [movie.title]
        clean_title = EDITION_SUFFIX.sub("", movie.title).strip(" -:([")
        if clean_title and clean_title != movie.title:
            queries.append(clean_title)
        for query in queries:
            candidates, complete = self._search_all(query, movie.year)
            if not complete:
                return None, "Too many search results to confirm a unique movie. Use Correct match."
            title = normalized(query)
            exact = [m for m in candidates if title in (normalized(m["title"]), normalized(m["original_title"]))]
            matches = [m for m in exact if m["year"] == movie.year]
            if len(matches) == 1:
                return matches[0]["id"], None
            if len(matches) > 1:
                return None, "Multiple movies have this title and year. Use Correct match to choose one."
            # Festival premieres and general releases can fall in adjacent years. Require
            # an actual release record for the filename's year, rather than guessing ±1.
            for candidate in exact:
                if candidate["year"] and abs(candidate["year"] - movie.year) == 1:
                    releases = self.request("movie/%d/release_dates" % candidate["id"])
                    if any(self.year(release) == movie.year for region in (releases.get("results") or [])
                           if isinstance(region, dict) for release in (region.get("release_dates") or [])
                           if isinstance(release, dict)):
                        matches.append(candidate)
            if len(matches) == 1:
                return matches[0]["id"], None
            if len(matches) > 1:
                return None, "Multiple movies match this title and release year. Use Correct match."
            same_year = [m for m in candidates if m["year"] == movie.year]
            if len(same_year) <= 5:
                for candidate in same_year:
                    aliases = self.request("movie/%d/alternative_titles" % candidate["id"])
                    if any(isinstance(alias, dict) and isinstance(alias.get("title"), str)
                           and normalized(alias["title"]) == title for alias in (aliases.get("titles") or [])):
                        matches.append(candidate)
            if len(matches) == 1:
                return matches[0]["id"], None
            if len(matches) > 1:
                return None, "Multiple movies use this alternate title and year. Use Correct match."
        return None, "No unique title and release-year match was found. Use Correct match."

    @staticmethod
    def year(movie):
        value = str(movie.get("release_date") or "")[:4]
        return int(value) if value.isdigit() else None

    def info(self, movie):
        with self.lock:
            match = self.state.movie(movie.path).get("match", {})
            data = dict(self.cache.get(match.get("tmdb_id"), {}))
            return match, data

    def enqueue(self, movie, refresh=False):
        with self.lock:
            match, data = self.info(movie)
            if not self.token or self.auth_failed or movie.path in self.pending or match.get("source") == "none":
                return
            now = time.time()
            if self.paused:
                if now < self.pause_until:
                    return
                self.paused = False
            incomplete_cache = bool(data and "imdb_id" not in data)
            if not refresh:
                status = match.get("status")
                if data and status != "error" and not incomplete_cache:
                    return
                retry_after = ERROR_RETRY_SECONDS if status == "error" else MATCH_RETRY_SECONDS
                retry_at = match.get("retry_at", match.get("checked_at", 0) + retry_after)
                if status in ("unmatched", "error") and match.get("matcher_version") == MATCH_VERSION \
                        and now < retry_at:
                    return
                refresh = incomplete_cache or status == "error"
            self.pending.add(movie.path)
            self.jobs.put((movie, dict(match), refresh))

    def correct(self, movie, tmdb_id):
        if tmdb_id is not None and (type(tmdb_id) is not int or tmdb_id <= 0):
            raise ValueError("Choose a valid TMDB movie or Leave unmatched")
        with self.lock:
            self.paused = False
            self.state.update_movie(movie.path, match={"tmdb_id": tmdb_id,
                "source": "manual" if tmdb_id else "none",
                "status": "matched" if tmdb_id in self.cache else "pending" if tmdb_id else "unmatched"})
        self.enqueue(movie)

    def poster(self, tmdb_id):
        if not re.fullmatch(r"[1-9]\d*", str(tmdb_id)):
            return None
        path = os.path.join(self.directory, str(tmdb_id) + ".jpg")
        return path if os.path.isfile(path) else None

    def fetch(self, tmdb_id, refresh=True):
        # Editions can resolve to the same film concurrently. Serialize by provider ID so a
        # second edition reuses the first result and cannot overwrite its temporary poster.
        with self.lock:
            lock = self.fetch_locks.setdefault(tmdb_id, threading.Lock())
        with lock:
            if not refresh and tmdb_id in self.cache:
                return self.cache[tmdb_id]
            return self._fetch(tmdb_id)

    def _fetch(self, tmdb_id):
        data = self.request("movie/%d" % tmdb_id, {"append_to_response": "credits", "language": "en-US"})
        if data.get("id") != tmdb_id or not isinstance(data.get("title"), str):
            raise RuntimeError("TMDB returned invalid movie details; try Refresh metadata")
        credits = data.get("credits") or {}
        if not isinstance(credits, dict):
            raise RuntimeError("TMDB returned invalid credits; try Refresh metadata")
        imdb_id = data.get("imdb_id")
        if not isinstance(imdb_id, str) or not re.fullmatch(r"tt\d+", imdb_id):
            imdb_id = None
        result = {"tmdb_id": tmdb_id, "imdb_id": imdb_id, "title": data["title"], "year": self.year(data),
                  "original_title": data.get("original_title") or "", "overview": data.get("overview") or "",
                  "genres": [g["name"] for g in (data.get("genres") or []) if isinstance(g, dict) and isinstance(g.get("name"), str)],
                  "directors": [p["name"] for p in (credits.get("crew") or []) if isinstance(p, dict) and p.get("job") == "Director" and isinstance(p.get("name"), str)],
                  "cast": [p["name"] for p in (credits.get("cast") or [])[:8] if isinstance(p, dict) and isinstance(p.get("name"), str)],
                  "tmdb_runtime_min": data.get("runtime"), "vote_count": data.get("vote_count", 0),
                  "score": data.get("vote_average") if data.get("vote_count") else None}
        # Persist useful text even when downloading artwork fails. The worker exposes that error
        # and a manual refresh retries it without losing the cached movie information.
        with self.lock:
            atomic_json(os.path.join(self.directory, "%d.json" % tmdb_id), result)
            self.cache[tmdb_id] = result
        poster = data.get("poster_path")
        if poster:
            if not re.fullmatch(r"/[A-Za-z0-9_-]+\.jpg", poster):
                raise RuntimeError("TMDB returned an unsupported poster path")
            try:
                with urllib.request.urlopen("https://image.tmdb.org/t/p/w500" + poster, timeout=15) as response:
                    image = response.read(8 * 1024 * 1024 + 1)
                if len(image) > 8 * 1024 * 1024 or not image.startswith(b"\xff\xd8\xff"):
                    raise RuntimeError("TMDB returned an invalid poster image")
                path = os.path.join(self.directory, "%d.jpg" % tmdb_id)
                with open(path + ".tmp", "wb") as f:
                    f.write(image)
                os.replace(path + ".tmp", path)
            except OSError as e:
                raise RuntimeError("Cannot download the poster; try Refresh metadata when online") from e
        else:
            path = self.poster(tmdb_id)
            if path:
                os.unlink(path)
        return result

    def enrich(self, movie, expected, refresh):
        try:
            tmdb_id = expected.get("tmdb_id")
            reason = None
            if not tmdb_id:
                tmdb_id, reason = self.find_match(movie)
            match = dict(expected, tmdb_id=tmdb_id, source=expected.get("source", "auto"),
                         status="matched" if tmdb_id else "unmatched", matcher_version=MATCH_VERSION,
                         checked_at=time.time())
            match.pop("error", None)
            match.pop("reason", None)
            match.pop("retry_at", None)
            if reason:
                match["reason"] = reason
            with self.lock:
                # Network replies belong to the match that requested them. A manual correction
                # during that request must win, even if the older request subsequently fails.
                if self.state.movie(movie.path).get("match", {}) != expected:
                    return
                self.state.update_movie(movie.path, match=match)
                expected = match
            if tmdb_id and (refresh or tmdb_id not in self.cache):
                self.fetch(tmdb_id, refresh=refresh)
        except ProviderUnavailable as e:
            self._record_failure(movie, expected, str(e), max(self.retry_at, time.time() + 60))
            raise
        except (RuntimeError, OSError, ValueError, KeyError, TypeError) as e:
            message = str(e) if isinstance(e, RuntimeError) else "Cannot update movie metadata; check the cache and try Refresh metadata"
            self._record_failure(movie, expected, message, time.time() + ERROR_RETRY_SECONDS)
            raise RuntimeError(message) from e

    def _record_failure(self, movie, expected, message, retry_at):
        with self.lock:
            if self.state.movie(movie.path).get("match", {}) == expected:
                self.state.update_movie(movie.path, match=dict(expected, status="error", error=message,
                                        matcher_version=MATCH_VERSION, checked_at=time.time(), retry_at=retry_at))

    def run(self):
        while True:
            movie, expected, refresh = self.jobs.get()
            with self.lock:
                credential = self.token
            try:
                with self.lock:
                    if self.paused:
                        # A queued refresh must survive a provider outage even when its older
                        # cache is usable; otherwise future scans see the cache and skip it.
                        if refresh:
                            self._record_failure(movie, expected,
                                self.error or "Movie information is paused and will retry automatically",
                                max(self.pause_until, self.retry_at, time.time() + 60))
                        continue
                self.enrich(movie, expected, refresh)
                with self.lock:
                    if not self.paused:
                        self.error = None
            except Exception as e:
                # Keep the worker alive on malformed provider responses. Expose failure rather
                # than silently leaving the remainder of the queue permanently unprocessed.
                message = str(e) if isinstance(e, RuntimeError) else "Cannot update movie metadata; check the cache and try Refresh metadata"
                with self.lock:
                    if self.token == credential:
                        self.error = message
                        if isinstance(e, ProviderUnavailable):
                            self.paused = True
                            self.pause_until = max(self.retry_at, time.time() + 60)
            finally:
                with self.lock:
                    self.pending.discard(movie.path)
                    current = self.state.movie(movie.path).get("match", {})
                    if credential != self.token:
                        self.enqueue(movie, refresh=True)
                    elif current != expected and current.get("status") == "pending":
                        self.enqueue(movie)
                self.jobs.task_done()
