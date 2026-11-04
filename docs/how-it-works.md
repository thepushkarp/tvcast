# How it works

For developers. Details live in the module docstrings and comments; this page is the map.

## The big picture

```
 tv (terminal) ─┐
                ├─ HTTP ─▶ daemon on 127.0.0.1:8827 (login service local.tvcast)
 web panel ─────┘            │
                             ├─ 1. SSDP search ─────────────▶ any DLNA TV on the network
                             ├─ 2. UPnP SOAP: play, seek… ──▶ the selected TV
                             ├◀ 3. the TV downloads the video from the stream server (:8828)
                             ├─ 4. WebSocket (:8002) ───────▶ Samsung only: keys, typing
                             └─ 5. REST (:8001) ───────────▶ Samsung only: app status and launch
```

One daemon owns all state. The panel and the `tv` command are both thin clients of its HTTP API,
so they never disagree.

## Code map

| File | Job |
|---|---|
| `tv` | Entry script. Adds the repo to `sys.path` and calls `cli.main()`. |
| `tvcast/launcher.py` | Installed `tv` entry point and login-service bootstrap, using Apple's isolated Python. |
| `tvcast/cli.py` | The `tv` command: API client, plus `daemon`, `install`, `uninstall` and `shortcut`. |
| `tvcast/app.py` | The daemon: TV selection, playback tracking, resume points, API actions. |
| `tvcast/server.py` | HTTP handlers: the stream server and the panel API. |
| `tvcast/discovery.py` | Finds TVs (SSDP) and reads their device descriptions. |
| `tvcast/upnp.py` | SOAP calls to the TV: play, pause, seek, volume, Samsung subtitles. |
| `tvcast/samsung.py` | Samsung remote: pairing, keys, typing, apps. |
| `tvcast/library.py` | Folder scanning, logical collection paths, titles, codec and subtitle-track checks (ffprobe), native pickers. |
| `tvcast/subtitles.py` | Subtitle files: finding and labelling them, converting `.ass/.ssa/.vtt` and UTF-16 to SubRip. |
| `tvcast/state.py` | The JSON state file, including the ordered playback queue. |
| `tvcast/panel.html` | Shared page and TV controls; TV status polls every 2 s while the TV tab is visible (10 s when the browser tab is backgrounded). |
| `tvcast/library.js`, `catalogue.js`, `library.css` | Shared Library UI, pure filtering/sorting, hash navigation and styling. Catalogue polls every 2.5 s outside the TV tab (10 s in the background). |
| `tvcast/people-picker.js`, `people-picker.css` | Searchable actor/director combobox with keyboard navigation and theme-aware suggestions. |
| `tvcast/metadata.py` | Three bounded background TMDB workers, conservative matching and local metadata/poster cache. |
| `tvcast/shortcut.icns` | Icon of the `tv shortcut` app, built from `docs/images/shortcut-icon.svg` with `rsvg-convert` and `iconutil`. |

## Local catalogue and playback

`GET /api/health` checks the daemon without a TV request; `tv ui` uses it before opening the panel.
`GET /api/library` and `/api/movies/<id>` read local state, cached metadata and ffprobe results.
They do not probe files or contact TMDB or a TV. Existing `/api/status` remains the TV/CLI API.

A separate worker rescans the library every minute and queues due metadata retries. The scanner
indexes readable main movies recursively. Each movie has a logical `collection_path`:
single-film release directories collapse into their movie, while grouping directories remain
browseable. Show subfolders as collections is on by default and shows immediate collection folders
and movies. Turning it off flattens movies beneath the selected location. Folder navigation and filters operate on the local
catalogue without moving files or triggering a network request.

Hash routes retain the library location and filters. Selecting a person or genre on a detail page
starts a fresh matching browse. Grid is the initial view; view, sorting and Auto/Light/Dark theme
preferences are stored in the browser. Theme selection is applied before the first paint. Bundled
Lucide SVGs supply the toolbar and playback icons.

Library mutations use the same protected POST convention as TV controls. `open_local` and
`reveal` resolve known movie IDs server-side and call macOS `open` with an argument list.
`watched` changes only the shared watched flag; playback progress merges under the state lock.

Metadata matching is stored per file in `state.json`. `metadata/` beside that file holds
`credentials.json` (mode 0600), movie JSON keyed by TMDB ID, and cached JPEG posters. The browser
receives only whether a credential is configured; its read-only mask is not the saved token. Manual
matches win over in-flight automatic lookups. Three workers run separately from probing and
playback, with per-TMDB-ID locks deduplicating concurrent editions. Provider-wide failures pause
fetching with a retry deadline. Cached refresh requests retain their retry intent while queued.
Authentication failures wait for a replacement credential; transient failures resume automatically
through periodic scans. Negative matches carry a matcher version and retry timestamp. Automatic
matching enumerates at most 25 search pages, deduplicates IDs and leaves truncated searches
unmatched. It accepts exact titles or provider aliases, cleans explicit edition suffixes on a
fallback query, and verifies adjacent years against provider release dates. Library-wide
and per-movie refreshes preserve manual matches and explicit Leave unmatched choices. Posters are
served by validated numeric IDs, never by arbitrary paths. The bundled TMDB SVG is sourced from the
[official documentation logo](https://files.readme.io/29c6fee-blue_short.svg).

## Playing a movie on TV

```
open → SetAVTransportURI (video URL + title + the chosen subtitle file)
     → Play            retried while the TV answers "701: not ready"
     → Seek            to the resume point
     → subtitles on    Samsung only; X_ControlCaption also switches files later
then every 2 s: ask the TV where it is; past 30 s, save the position every 10 s
when it ends: mark progress, then play the next queued movie if there is one
```

TVs are stored by their device ID (UDN), not their IP address, so a new address from the router
doesn't lose the TV or its pairing.

## Things that look odd but are on purpose

- **Apple's `/usr/bin/python3` only (3.9, standard library).** The TV connects *to* the Mac to
  download the video, and the macOS firewall lets Apple-signed programs accept that without a
  prompt. A background service can't answer a prompt. The installed CLI re-executes through
  this interpreter; the login service points to the bootstrap inside the installed package.
- **`-I` and the `sys.path` line in `tv`.** Isolated mode ignores the user's Python environment,
  but it also drops the script's own folder from the import path. The packaged launcher adds
  its installation directory explicitly, so Apple's Python can load it from a uv/pipx environment.
- **Never restart mid-movie.** The TV gives up when its stream connection drops. `tv install`
  refuses while something plays, and the panel page is read from disk on every load, so UI edits
  need no restart.
- **Not in Documents, Desktop or Downloads.** macOS silently blocks login services from those
  folders, so `tv install` refuses them.
- **Nothing is saved under 30 s.** The TV may still report a position near 0 before it applies the
  resume Seek, and a rejected Seek leaves it playing from the top. Those readings can't be resume
  points, and saving one would erase the point being resumed. Start over, finishing a short clip
  or passing 30 s lifts this for the rest of that load. The panel's History follows the same rule:
  it is ordered by the time of the last save, so a brief open doesn't appear there.
- **Retrying Play/Seek on errors 701 and 711.** TVs load a new video in the background and reject
  commands until ready. A Samsung can also call a resume target "Illegal seek target" (711) just
  after playback starts, even one it accepts on the next load.
- **Queue consumption after loading.** Entries leave the queue only after playback loads, so
  failed requests can be retried. A playback lock serializes starts, stops and TV selection with
  the monitor's queue advancement; status and queue edits remain responsive during TV requests.
- **Samsung extras.** The `CaptionInfo.sec` header (the TV asks for it with
  `getcaptionInfo.sec: 1`) and `sec:` tags attach subtitles. MKV files go out to Samsungs as
  `video/x-mkv`, and to other TVs as the registered `video/x-matroska`. Subtitles need an explicit
  "enable" after loading.
- **Subtitle files on Android TVs (untested on one).** DLNA has no subtitle standard, so the
  chosen file goes out every common way, after what Universal Media Server's renderer profiles
  and Kodi's source show:
  - a `text/srt` `res`, which Kodi's and BubbleUPnP's renderers list as a track;
  - the Samsung tags and header, which Philips Android TVs read;
  - `pv:subtitleFileUri`/`pv:subtitleFileType` on the video's `res`, which UMS sends to Sony and
    others. Samsungs don't get these, so their requests stay as tested.

  These players take a file only with the video, so switching loads the video again at its
  position. A fresh `Playback` replaces the current one, so the monitor doesn't read the reload's
  brief stop as the movie ending.
- **One subtitle file per load, any file after.** Measured on a 2021 Samsung (AU7500):
  - The player registers only the first `CaptionInfoEx` it gets, so only the chosen file goes out.
  - `X_ControlCaption Enable` with any caption URL, even one never sent, fetches and draws it at
    once. That is how files switch mid-movie, with no reload.
  - The player draws tracks embedded in MKV/MP4 itself (the first one by default) and lists them
    in its own menu, but not in `X_GetCaptionState`. TV Cast can't see or switch them.
  - An enabled file replaces an embedded track. `Disable` hides a file but never an embedded
    track.
  - UTF-8 (no BOM) draws accents and Devanagari, and Windows-1252 also draws correctly. So `.srt`
    files go out as they are, and only UTF-16 and the `.ass/.ssa/.vtt` conversions are rewritten,
    keeping their text bytes. Converted copies are cached in `subtitles/` beside `state.json`.
- **Remote apps by ID.** Samsung TVs ignore the "list installed apps" request, so known app IDs are
  checked with at most four requests at a time. REST launches use an empty POST, then wait up to
  10 s for `visible: true`; `running` alone can mean a background app. Unconfirmed launches show
  an error. App titles, the current HDMI input and apps outside the known list are not reported.

## Security

- The panel API listens on 127.0.0.1 only and checks the `Host` header. Commands also need an
  `X-TVCast: 1` header, so other websites can't drive your TV.
- The stream server only answers the selected TV's IP address.
- Everything from the network is untrusted. Discovery accepts only `http://` URLs on the device's
  own host, reads at most 1 MB, and rejects XML with a DTD (Apple's Python has no defence
  against XML bombs).
- Samsung pairing pins the TV's certificate. A paired TV only moves to a new address when its old
  address stops answering, exactly one device claims to be it, and that device presents the
  pinned certificate. A device forwarding to the real TV can't pass the first check, because
  forwarding needs the TV still reachable. Any TV claimed by two addresses at once is ignored.
- App status and launch use Samsung's unauthenticated REST API on the local network.
- `state.json` holds the pairing token and is readable only by you.

Not protected: anything on your network can pretend to be an *unpaired* TV, and anything holding
the selected TV's IP address can download library videos. Traffic on the LAN is unencrypted.

## Development

```sh
/usr/bin/python3 -m unittest discover -s tests -t .      # no TV or external network needed
node --test tests/test_catalogue.cjs                      # pure catalogue filtering/sorting
./tv daemon --port 18828 --panel-port 18827 --state /tmp/tvcast-dev/state.json --library ~/some/videos
./tv status --panel-port 18827                            # talk to that test daemon
```

A test daemon picks the real TV automatically if it's the only one on the network, so don't play
anything from it unless you mean to. After changing Python code, run `tv install` to restart the
service.
