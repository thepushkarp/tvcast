# TV UI polish

Preview: http://127.0.0.1:18847/#/tv

The preview uses a simulated TV. Refresh to load current source changes.

## Checklist

- [x] Center the playback toggle and use play/pause icons.
- [x] Show elapsed time and a minus-prefixed remaining time, without total duration.
- [x] Use icons for remote navigation and common actions, with accessible names and tooltips.
- [x] Use one mute toggle with a red active state.
- [x] Place power in the remote header and retain two-click confirmation.
- [x] Place a visibly labeled Stop casting action at the right of the playback controls; stack it below on narrow screens while keeping play/pause centered.
- [x] Hide the healthy connection message; retain connection errors. Pairing indicates remote authorization.
- [x] Keep the subtitle picker and add/remove file icons on one row.
- [x] Remove individual viewing-history entries and clear all history, preserving files, resume positions and watched flags.
- [x] Give Resume and Play again equal button dimensions.
- [x] Use themed dropdowns throughout, including TV selection, subtitle mode and subtitle tracks.
- [x] Show the timestamp under the pointer when hovering over the seek bar.
- [x] Place 10s/30s labels below the skip arrows, with no overlap.
- [x] Use one compact toolbar for “Casting to”, the TV picker and Find TVs.
- [x] Remove the redundant Playing/Paused label above the movie title.
- [x] Match the volume slider to the seek bar and preview the hovered volume percentage.
- [x] Scroll only the Queue and History movie lists on desktop; keep section headings and actions outside the scroll areas.
- [x] Show up to three complete rows per list, measuring wrapped titles; allow the page to grow when those rows exceed the viewport.
- [x] Reserve space beside each section's scrollbar so actions and focus rings stay clear of the scroll track.
- [x] Place the footer below both columns at the full site width; preserve natural page scrolling on mobile.
- [x] Keep directional buttons square and the center button circular at every breakpoint; use a wider remote and place secondary keys beside navigation in shorter desktop windows.
- [x] Remove the typing and input panel from the remote.
- [x] Open connection and stream details from an info icon in the remote header; keep the close control accessible without an automatic tooltip.
- [x] Add padding to secondary library actions and move Add to TV queue into the main action row; retain the watched toggle on the poster.
- [x] Finish desktop/mobile, light/dark and interaction checks for the final UI.

## Verification

- All 155 Python tests pass with Apple's Python and the development Python; all 9 catalogue JavaScript tests pass.
- Simulated browser checks cover playback, mute, seeking, remote navigation, power confirmation, unavailable states, connection errors and history removal/clearing.
- Dropdown checks cover keyboard navigation, typeahead, Escape/Tab dismissal, disabled subtitle tracks and library controls. Dropdown keys do not send TV remote commands.
- Seek and volume hover previews leave playback/volume unchanged; timestamps and values are clamped to the slider bounds. Skip labels do not overlap their icons.
- Layout checks cover 320, 390, 720 and 1440 px widths.
- Desktop checks cover 1440 × 800 and 1440 × 967. Queue and History lists scroll independently with stationary headings, actions, remote, player and full-width footer. Directional buttons retain equal width and height.
- Library detail checks confirm one poster watched toggle, one primary queue action, padded secondary actions and a simulated queue request.
- Connection dialog checks cover desktop/mobile layout, unchanged list heights, Escape/close-button dismissal and focus return to the info button.
- Three-row checks confirm the third item is fully visible, the fourth is below the scroll boundary, wrapped titles fit, and list scrolling leaves headings stationary. The dialog opens without a Close tooltip.
- Real TV commands have not been exercised. Backend history endpoints require the running service to load the updated Python source.
