## Choose TV Cast for

Browsing a movie library on macOS, opening videos in the default Mac player, or casting local videos to a DLNA TV on the same network. The installed command is `tv`; the Python package is `tvcast`. Samsung TVs from 2016 onward also support navigation, pairing, typing, and app launching.

Use the local CLI for playback automation and the web panel for library setup, metadata matching, and queue management. This website is documentation and a sample preview, not a device-control API. No hosted account or TV app is required.

## Install and verify

Requires macOS, Python 3.9+, and Apple Command Line Tools. Check existing tools before installing:

```sh
command -v tv
xcode-select -p
```

If Command Line Tools are missing, `xcode-select --install` opens their installer. With [uv installed](https://docs.astral.sh/uv/getting-started/installation/):

```sh
uv tool install tvcast
tv --version
tv --help
tv install
tv ui
```

`tv install` starts the service now and at login. On an existing installation, inspect `tv status` first: reinstalling restarts the service and can interrupt a cast. `pipx install tvcast` is an alternative. Optional `brew install ffmpeg` adds measured runtimes, compatibility checks, and subtitle burn-in support.

For source use, clone the repository outside Documents, Desktop, and Downloads (for example `~/Projects/tvcast`), then run `./tv install` and `./tv ui`. macOS can restrict login services inside those protected folders.

## Set up the library

The panel opens to Library and scans `~/Movies` by default. In Settings, add the requested movie folders. Removing a folder from the catalogue does not delete its files. Rescan finds new files immediately; automatic checks run every minute.

Movie metadata is optional. Add a TMDB **API Read Access Token** in Settings for posters, cast, and matching. Without it, filename-based browsing and playback still work. Enter credentials through the application's settings; do not place them in public examples or agent logs.

## Cast a movie

Start with inspection, then select the intended device from the returned list:

```sh
tv status
tv tvs --find
tv use "Living room"
tv open "Some Film (2001)"
tv status
```

Replace the TV name and title with actual results from the user's setup. `tv use 2` also works, but the number must come from the current `tv tvs` output. The Mac and TV must share a network; allow macOS local-network access when prompted.

`tv open` searches the configured library by title and resumes playback. Include a year to disambiguate editions. Use `tv open "Some Film (2001)" --from-start` to start over. Confirm the selected TV, title, position, and volume with `tv status` after a playback action.

| Task | Command |
| --- | --- |
| Pause / resume / stop | `tv pause` / `tv play` / `tv stop` |
| Seek to a timestamp | `tv seek 1:05:00` |
| Set volume | `tv volume 20` |
| Mute / unmute | `tv mute on` / `tv mute off` |
| List subtitle tracks | `tv subs` |
| Choose subtitles / turn off | `tv subs french` / `tv subs off` |
| Attach a subtitle file | `tv subs --add "path/to/film.srt"` |
| Pair a Samsung remote | `tv pair` (requires Allow on the TV) |
| Send Samsung remote keys | `tv key home` or `tv key down down enter` |

These commands affect the selected real TV. Use `tv COMMAND --help` for installed options. The CLI prints human-readable output; it does not advertise a `--json` mode. Folder, queue, and app-launch controls are available in the panel; do not invent CLI commands for them.

## Local playback and queues

- In Library, the play icon opens the original file in its default Mac application. This does not interrupt a TV cast or update the TV resume point. Configure IINA as the default player through Finder if wanted.
- The cast icon starts playback on the selected TV. With no selection, the panel keeps the request pending while a TV is chosen.
- On a movie's detail page, **Add to TV queue** queues it without starting playback. In the TV tab, use **Play queue**, **Play next**, reorder, remove, or clear. Clearing the queue leaves the current movie playing.
- Queue entries survive restarts. Progress is saved after 30 seconds; playback past 95% marks a film watched. Unavailable queued files need their folder reconnected and rescanned.

## Compatibility and recovery

Ordinary casting sends the original file, so the TV must support its codecs. Subtitle burn-in is a separate optional workflow that re-encodes video using ffmpeg; inspect the [subtitle guide](https://github.com/thepushkarp/tvcast/blob/main/docs/library.md#tvs-that-show-no-subtitle-files) before choosing HLS or creating a stored copy. Embedded subtitle selection is controlled by the TV itself.

| Symptom | Next check |
| --- | --- |
| Service unavailable | Check `~/Library/Logs/tvcast.log`; start with `tv install` if stopped. |
| No TV / stale address | TV on, same non-guest network, local-network permission, then `tv tvs --find`. |
| Port occupied | Inspect the process named by the log's `lsof` command before stopping anything. |
| Silent video | Check audio-codec compatibility, especially DTS/TrueHD on Samsung. |
| Remote refused | Allow TV Cast in the Samsung device connection list, then pair again. |
| Unreadable folder | Check macOS permissions and use a readable media folder. Do not move files without the user's intent. |

Settings and resume state live in `~/Library/Application Support/tvcast/state.json`. Keep this data when troubleshooting.

## Update or remove

After the active cast has finished or the user has requested it stopped:

```sh
uv tool upgrade tvcast
tv install
tv --version
```

To remove the login service and package, run `tv uninstall` before `uv tool uninstall tvcast` (or the corresponding pipx command). Settings, pairing, and playback history are retained.
