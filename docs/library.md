# Your library

The panel opens to **Library**. Videos come from `~/Movies` by default. Manage folders in
**Settings**; Add folder sits above the scrollable folder list. Removing a folder from the catalogue
never deletes its files. Close Settings or Correct match with the close button, Escape, or a click
outside the dialog. New files are found
automatically within a minute. **Rescan** or `tv open` checks immediately.

**Grid** is the default view; the list/grid icons switch views. Search by title or year and choose
a sort: title starts A–Z, runtime shortest first, year newest first, and TMDB score highest first.
Search shows matching movies directly, including those in collections beneath the current location.
Those results show their collection name; clearing the search restores the chosen folder view.
The direction arrow reverses that order; unknown values remain last. View and sorting preferences
are remembered in this browser. The theme button cycles through **Auto**, **Light** and **Dark**;
Auto follows the Mac's appearance setting, and the chosen mode is remembered.
Icon labels appear on hover or keyboard focus; Escape dismisses the label.

The genre menu and searchable actor/director picker filter the movies at the current location.
Sort, genre and watched menus follow the chosen appearance. Clear a person filter with the single
clear button inside its field. Watched status and **Show subfolders as collections** sit beside the
actor/director picker; all controls stay visible as the toolbar wraps in narrow windows. Each
single-select menu shows its current selection without a separate filter chip. Choose All genres
or All movies to clear that selection, or use **Clear filters** to reset all filters.
**Needs attention**
groups unmatched or ambiguous films, metadata errors and matched films without posters. Its count
covers the current location and its subfolders; deliberate **Leave unmatched** choices are excluded.
The control stays hidden when no issues remain unless the filter is active. In narrow windows,
collection cards form a compact horizontal strip so movie artwork remains near the top.
On a movie's detail page, selecting a genre, director or cast member opens a fresh Library browse
for that selection, without retaining a title search that could hide related films. Returning
from details or TV controls otherwise restores the search, filters and scroll position.

### Collections and subfolders

**Show subfolders as collections** is on by default. The current location shows collection folders first,
then its movies. Open a collection to browse its contents and use the breadcrumbs to go back.
Turn this off to show all movies recursively beneath the current location. The choice is remembered.
Opening a collection starts at the top; browser Back restores the previous location's scroll position.
Search and Needs attention show matching movies directly across subfolders in either mode.

A folder containing one main movie is shown as that movie, even when it also contains subtitles
or extras. Grouping folders such as **Saga** and **Trilogy** remain collections. Nested
collections work the same way; a grouping folder with a loose movie and child movie folders keeps
both its own movie and its child collections. These controls change browsing, not files on disk.

### Playback and watched status

The play icon opens the original file in its default macOS application. Set that application in
Finder’s **Get Info → Open with → Change All** for each video type you use. Local playback does
not update TV Cast’s watched status or TV resume point, and does not interrupt casting.

The cast icon switches to **TV** and starts the movie. With no selected TV, choose one or use
**Find TVs**; the requested movie stays pending until selection or cancellation. Failed casts
show **Retry**. The TV tab contains the playback controls and queue, not another catalogue.

The watched/unwatched toggle sits beside **Play on TV** on the detail page. Covers show a green
check corner for watched films and a blue circle corner for unwatched films, with hover labels.
In Library and on movie pages, the corner is a keyboard-accessible button that toggles watched status.
**Undo** appears
for eight seconds after a change and remains available while it has keyboard focus. Press ⌘Z
(Ctrl+Z) outside a text field to undo the change. Toggling or
undoing watched status preserves the TV resume point.
Open a movie’s detail page to reveal its file in Finder, correct its
metadata match, or add it to the TV queue. IMDb and Letterboxd icons open in new tabs and
show their names on hover. Known identifiers link to the film directly; missing identifiers use
a labelled title/year search. Finishing a later TV playback can mark it watched again.
Separate editions are separate entries; renaming or moving a
file gives it a new identity and does not migrate its personal state or manual match.

**Runtime** is measured from the file with `ffprobe` (`brew install ffmpeg`). TMDB runtime is a
separate reference on the detail page: extended cuts may differ. Missing file durations stay
unknown rather than borrowing the database or TV playback duration.

### Movie information

In **Settings**, paste a **TMDB API Read Access Token** from your
[TMDB API settings](https://www.themoviedb.org/settings/api). The token stays in an owner-only file
beside TV Cast’s metadata cache and is never returned to the browser after saving. Requests send
movie titles and years for matching, not paths or video contents. A saved credential appears as
a read-only masked field; **Replace token** opens an editable field with **Save token** and
**Cancel**. **Remove token** clears the saved credential while retaining downloaded information.

Movie information and posters download in the background and remain available offline. Matching
checks complete search results for a unique title/original-title and year, including verified
alternate titles and explicit edition labels. An adjacent release year is accepted only when
TMDB records a release in the filename’s year. Ambiguous movies show the reason on their detail
page and need a manual choice. Use **Correct match** to
search by title and optional year, select a result, or **Leave unmatched**. Manual choices survive
rescans. **Refresh metadata**, beside Rescan in the Library heading, refreshes the library's
information and posters without replacing manual matches or explicit Leave unmatched choices.
**Refresh metadata** on a movie's detail page refreshes only that movie. Change an explicit
Leave unmatched choice through Correct match first.

Downloads use three background workers and share cached results for editions of the same film.
Provider outages and rate limits pause fetching and retry automatically after a delay. Other
fetch failures retry after five minutes; unmatched titles are checked again daily and when the
matching rules change. Cached information stays available throughout. **Refresh metadata** retries
immediately, subject to provider rate limits. Replace an invalid token in Settings. Successfully
cached information has no automatic expiry.

Genres, synopsis, director, leading cast and scores come from TMDB. Scores are labelled TMDB;
vote counts appear in the detail view. Without a token, files remain searchable and playable
using their filename titles and locally measured runtime.

**Skipped Movies/TV — macOS restricted access** means that subfolder could not be read.
Other folders are still scanned. Keep ordinary video files in a separate readable folder.

## Folder layout

```
Movies/
├── Some Film (2001)/                 one video in a folder: the folder name is the title
│   ├── some.film.2001.1080p.mkv
│   └── some.film.2001.1080p.srt      subtitles: named like the video
├── Some Saga/                        a folder of movie folders is a collection
│   ├── Part One (1999)/part.one.mp4
│   └── Part Two (2002)/part.two.mp4
└── Another.Film.2010.mp4             a loose file: the file name is the title
```

- **Titles:** dots and `[tags]` are cleaned up, and a year like `(2001)` is pulled out.
- **Subtitles:** see [Subtitles](#subtitles).
- **Skipped:** samples, extras folders (Featurettes, Extras, Trailers, …) and hidden files.
- **File types:** mp4, m4v, mov, mkv, avi, webm, ts, m2ts, mpg, mpeg, wmv.

## Subtitles

Subtitle files work on Samsung TVs: `.srt`, `.ass`, `.ssa` and `.vtt`, in any language. TV Cast
also sends them the ways Android TV renderers (Sony, Philips, Kodi) read them. Some TVs show
none of them; for those TV Cast burns the subtitles into the picture (see
[TVs that show no subtitle files](#tvs-that-show-no-subtitle-files)). TV Cast lists these files for a video:

- files named like it, beside it or in `Subs/`: `Film.srt`, `Film.en.srt`, `Film.fr.forced.srt`, `Film.en.sdh.ass`;
- files in `Subs/Film/` (episode packs);
- for a video alone in its folder, every other subtitle file beside it and in `Subs/`.

The language and SDH, forced and commentary flags come from the file name. The language can be
a code (`en`, `eng`) or a name (`English`). `hi` straight after a language means
hearing-impaired; on its own it means Hindi.

**What plays by default:**

1. the subtitles you last chose for that movie, including Off;
2. otherwise, subtitles inside the video file, which the TV shows by itself;
3. otherwise, a file beside the video named exactly like it (`Film.srt`, `Film.ass`, …);
4. otherwise, none. Choose one in the panel or with `tv subs`.

**While a movie plays:** the panel's **Subtitles** menu switches files instantly on a Samsung;
other TVs reload the video where it is, with a pause of a few seconds. **Add file…**
attaches any subtitle file on your Mac to the movie; TV Cast remembers it, and **Remove** detaches
it. From the terminal:

```sh
tv subs                     # list them; * marks the one showing
tv subs french              # switch by language, number or part of the name
tv subs off                 # or on
tv subs --add ~/Downloads/film.en.srt
tv open dune --subs ~/Downloads/dune.srt    # or --subs french, --subs off
```

**Subtitles inside the video** (MKV and MP4 tracks) are shown and switched by the TV itself:
use its own subtitle menu. A subtitle file chosen in TV Cast replaces them, and TV Cast's
**Off** doesn't hide them.

**Blu-ray image subtitles** (PGS) inside the video may not show at all. Convert them to a text
file with an OCR tool such as Subtitle Edit, or burn them into the picture. Burning in re-encodes
the whole video:

```sh
ffmpeg -i in.mkv -filter_complex "[0:v][0:s:0]overlay[v]" -map "[v]" -map 0:a:0 -c:a copy out.mp4
```

Text files in other encodings (Windows-1252, UTF-16) work. If a file shows the wrong
characters, save it as UTF-8.

### TVs that show no subtitle files

Some TVs' players show no subtitle file in any form TV Cast can send, nor the tracks inside
videos. Tested: a Philips Smart 4 Google TV, whose renderer is "Skyworth Media Renderer". On
such TVs TV Cast draws the chosen subtitle file into the picture. That re-encodes the video
(HEVC, on the Mac's media engine), so it needs `ffmpeg` (`brew install ffmpeg`) and the Command
Line Tools. Dolby Vision becomes HDR10.

`tv tvs` shows how each TV gets subtitles. TV Cast picks it for known TVs; change it with
`tv subs --mode auto|file|burn` or **Subtitles on this TV** in the panel.

There are two ways to play burned-in subtitles, both seekable with the TV's remote:

- **HLS** starts in seconds. TV Cast encodes the movie in 6-second segments as the TV asks for
  them, a little ahead of where it plays; a seek waits a few seconds for its segment. The Mac
  keeps encoding while you watch, and the audio is re-encoded as Dolby Digital Plus 5.1.
- **Copy** is the whole movie written once, in the background, in about a third of its running
  time. It then plays like any file: no waiting and no work for the Mac. The audio is kept, except
  TrueHD and DTS, which MP4 or most TVs can't take; those become Dolby Digital Plus. Copies are
  about as big as the movie and stay in `~/Movies/TV Cast subtitles` (which the library skips)
  until you delete them. A copy cut short when TV Cast stops is deleted the next time it starts.

`tv open` plays the copy when there is one, otherwise HLS:

```sh
tv burn dune                # make a copy in the background; tv status shows how far
tv open dune                # the copy if it's ready, else HLS
tv open dune --hls          # HLS even if there is a copy
tv open dune --copy         # the copy only (starts making one if there's none)
tv burn --list              # copies and the space they take
tv burn --delete dune       # delete the copy; the movie stays
```

In the panel, **Make copy** and **Delete copy** sit under the subtitles while a movie plays.

## Resume and queue

- A movie resumes a few seconds before where you stopped. Use **Start over on TV** on the detail
  page or `tv open … --from-start` to begin again.
- Past 95% counts as watched.
- **Add to TV queue** on the detail page adds a movie without starting it. Use **Play queue** to
  start, **Play next** to skip, the arrows to reorder, or the cross to remove an entry. **Clear**
  leaves the current movie playing.
- The next queued movie starts when the current cast finishes. Stop, TV changes and disconnections
  leave the remaining queue intact. An empty queue ends playback.
- The queue survives restarts. Unavailable videos stay listed; reconnect their folder and rescan,
  or remove them. Failed playback keeps the entry for retry.
- The Mac stays awake while a movie plays. Closing the lid still puts it to sleep.

## Videos the TV can't play

With `ffprobe` installed (`brew install ffmpeg`), each video is checked once. A video the TV likely
can't decode shows a compatibility note on its detail page and asks before trying to cast.

The most common case is DTS or TrueHD audio on Samsung TVs, which plays silent. To fix a file,
convert just its audio:

```sh
ffmpeg -i in.mkv -map 0:v:0 -map 0:a:0 -c:v copy -c:a ac3 -b:a 640k out.mkv
```
