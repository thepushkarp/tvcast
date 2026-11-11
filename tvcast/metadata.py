"""Bounded background movie enrichment; catalogue reads use only local cached data."""
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

from .ratings import Ratings

MATCH_VERSION = 2  # Increment when matching rules change so cached negative results are rechecked.
MATCH_RETRY_SECONDS = 24 * 60 * 60
ERROR_RETRY_SECONDS = 5 * 60
MAX_SEARCH_PAGES = 25
CACHE_FIELDS = {"imdb_id", "wikidata_id", "wikipedia_url", "languages", "collection", "characters", "certification"}
# US MPA ratings in increasing strictness. TMDB also reports "NR" (not rated), which is stored as
# no certification so it groups with films that have none, rather than appearing as a badge.
CERTIFICATIONS = ("G", "PG", "PG-13", "R", "NC-17")
# TMDB release types in preference order: theatrical, then limited theatrical. Other types (digital,
# physical, TV, premiere) are used only when no theatrical release carries a certification.
CERTIFICATION_RELEASE_TYPES = (3, 2)
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
        self.ratings = Ratings(self.directory)
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
            return {"configured": bool(self.token), "pending": len(self.pending), "error": self.error,
                    "ratings": self.ratings.status()}

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
            if data:
                # Older TMDB caches contain scores. Only IMDb may populate the catalogue rating.
                data["score"], data["vote_count"] = self.ratings.get(data.get("imdb_id"))
            return match, data

    def enqueue(self, movie, refresh=False):
        with self.lock:
            match, data = self.info(movie)
            self.ratings.enqueue(data.get("imdb_id"))
            if not self.token or self.auth_failed or movie.path in self.pending or match.get("source") == "none":
                return
            now = time.time()
            if self.paused:
                if now < self.pause_until:
                    return
                self.paused = False
            incomplete_cache = bool(data and not CACHE_FIELDS.issubset(data))
            if not refresh:
                status = match.get("status")
                if data and status != "error" and not incomplete_cache:
                    return
                retry_after = ERROR_RETRY_SECONDS if status == "error" else MATCH_RETRY_SECONDS
                retry_at = match.get("retry_at", match.get("checked_at", 0) + retry_after)
                if status in ("unmatched", "error") and match.get("matcher_version") == MATCH_VERSION \
                        and now < retry_at:
                    return
                refresh = status == "error"
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
            if not refresh and CACHE_FIELDS.issubset(self.cache.get(tmdb_id, {})):
                return self.cache[tmdb_id]
            return self._fetch(tmdb_id)

    @staticmethod
    def certification(release_dates):
        """The US age rating from TMDB release dates, or None when absent or not rated."""
        rated = [(release.get("type"), release["certification"].strip().upper())
                 for region in (release_dates.get("results") or [])
                 if isinstance(region, dict) and region.get("iso_3166_1") == "US"
                 for release in (region.get("release_dates") or []) if isinstance(release, dict)
                 and isinstance(release.get("certification"), str)
                 and release["certification"].strip().upper() in CERTIFICATIONS]
        # A stable sort keeps TMDB's order among releases of the same preferred type.
        rated.sort(key=lambda item: CERTIFICATION_RELEASE_TYPES.index(item[0])
                   if item[0] in CERTIFICATION_RELEASE_TYPES else len(CERTIFICATION_RELEASE_TYPES))
        return rated[0][1] if rated else None

    @staticmethod
    def wikipedia(wikidata_id):
        params = {"action": "wbgetentities", "ids": wikidata_id, "props": "sitelinks/urls",
                  "sitefilter": "enwiki", "format": "json"}
        req = urllib.request.Request("https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode(params),
            headers={"Accept": "application/json",
                     "User-Agent": "TV-Cast (https://github.com/thepushkarp/tvcast)"})
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                data = response.read(1024 * 1024 + 1)
            if len(data) > 1024 * 1024:
                raise ValueError("Oversized Wikidata response")
            entity = json.loads(data)["entities"][wikidata_id]
            link = entity.get("sitelinks", {}).get("enwiki")
            if link is None:
                return None
            url = link["url"]
            if not isinstance(url, str) or not re.fullmatch(r"https://en\.wikipedia\.org/wiki/[^\s?#]+", url):
                raise ValueError("Invalid English Wikipedia article URL")
            return url
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as e:
            raise RuntimeError("Cannot fetch the Wikipedia link for %s; check your connection or try Refresh metadata. Retrying in five minutes."
                               % wikidata_id) from e

    def _fetch(self, tmdb_id):
        data = self.request("movie/%d" % tmdb_id, {"append_to_response": "credits,external_ids,release_dates", "language": "en-US"})
        if data.get("id") != tmdb_id or not isinstance(data.get("title"), str):
            raise RuntimeError("TMDB returned invalid movie details; try Refresh metadata")
        credits = data.get("credits") or {}
        if not isinstance(credits, dict):
            raise RuntimeError("TMDB returned invalid credits; try Refresh metadata")
        imdb_id = data.get("imdb_id")
        if not isinstance(imdb_id, str) or not re.fullmatch(r"tt\d+", imdb_id):
            imdb_id = None
        external_ids = data.get("external_ids") or {}
        if not isinstance(external_ids, dict):
            raise RuntimeError("TMDB returned invalid external IDs; try Refresh metadata")
        wikidata_id = external_ids.get("wikidata_id")
        if not isinstance(wikidata_id, str) or not re.fullmatch(r"Q[1-9]\d*", wikidata_id):
            wikidata_id = None
        languages = {}
        for language in data.get("spoken_languages") or []:
            if isinstance(language, dict) and isinstance(language.get("iso_639_1"), str) \
                    and re.fullmatch(r"[a-z]{2}", language["iso_639_1"]):
                code = language["iso_639_1"]
                name = language.get("english_name") or language.get("name")
                languages[code] = {"code": code, "name": name if isinstance(name, str) and name else code.upper()}
        original_language = data.get("original_language")
        if not languages and isinstance(original_language, str) and re.fullmatch(r"[a-z]{2}", original_language):
            languages[original_language] = {"code": original_language, "name": original_language.upper()}
        release_dates = data.get("release_dates") or {}
        if not isinstance(release_dates, dict):
            raise RuntimeError("TMDB returned invalid release dates; try Refresh metadata")
        collection = data.get("belongs_to_collection")
        collection = {"id": collection["id"], "name": collection["name"]} \
            if isinstance(collection, dict) and type(collection.get("id")) is int and collection["id"] > 0 \
            and isinstance(collection.get("name"), str) and collection["name"].strip() else None
        cast = [p for p in (credits.get("cast") or [])[:8] if isinstance(p, dict) and isinstance(p.get("name"), str)]
        result = {"tmdb_id": tmdb_id, "imdb_id": imdb_id, "wikidata_id": wikidata_id,
                  "title": data["title"], "year": self.year(data),
                  "original_title": data.get("original_title") or "", "overview": data.get("overview") or "",
                  "languages": list(languages.values()), "collection": collection,
                  "certification": self.certification(release_dates),
                  "characters": {p["name"]: p["character"] for p in cast if isinstance(p.get("character"), str) and p["character"]},
                  "genres": [g["name"] for g in (data.get("genres") or []) if isinstance(g, dict) and isinstance(g.get("name"), str)],
                  "directors": [p["name"] for p in (credits.get("crew") or []) if isinstance(p, dict) and p.get("job") == "Director" and isinstance(p.get("name"), str)],
                  "cast": [p["name"] for p in cast]}
        # An absent Wikipedia URL means the lookup still needs to run; null means no article.
        # Retain a verified link during outages only while the film's Wikidata ID is unchanged.
        with self.lock:
            previous = self.cache.get(tmdb_id, {})
            if not wikidata_id:
                result["wikipedia_url"] = None
            elif previous.get("wikidata_id") == wikidata_id and "wikipedia_url" in previous:
                result["wikipedia_url"] = previous["wikipedia_url"]
            # Text remains available when artwork or Wikipedia fails. The worker records the
            # error and retries enrichment without blocking catalogue reads.
            atomic_json(os.path.join(self.directory, "%d.json" % tmdb_id), result)
            self.cache[tmdb_id] = result
        self.ratings.enqueue(imdb_id)
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
        if wikidata_id:
            url = self.wikipedia(wikidata_id)
            with self.lock:
                result = dict(result, wikipedia_url=url)
                atomic_json(os.path.join(self.directory, "%d.json" % tmdb_id), result)
                self.cache[tmdb_id] = result
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
            if tmdb_id and (refresh or not CACHE_FIELDS.issubset(self.cache.get(tmdb_id, {}))):
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
