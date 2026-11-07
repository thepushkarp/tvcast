# TV UI polish

Preview: http://127.0.0.1:18847/#/tv

The preview uses a simulated TV. Refresh to load current source changes.

## Checklist

- [x] Center the playback toggle and use play/pause icons.
- [x] Show elapsed / total time on the left and minus-prefixed remaining time on the right.
- [x] Link the playing title to its Library detail page.
- [x] Show IMDb votes beside the detail heading rating, film language codes with tooltips, character names beside actors, and links to film collections in the library.
- [x] Show verified English Wikipedia links from cached Wikidata sitelinks.
- [x] Filter by film language or collection, including No collection, and open a fresh language filter from its detail-page code.
- [x] Use icons for remote navigation and common actions, with accessible names and tooltips.
- [x] Use one mute toggle with a red active state.
- [x] Place power in the remote header and retain two-click confirmation.
- [x] Place a visibly labeled Stop casting action at the right of the playback controls; stack it below on narrow screens while keeping play/pause centered.
- [x] Hide the healthy connection message; retain connection errors. Pairing indicates remote authorization.
- [x] Keep the subtitle picker and add/remove file icons on one row.
- [x] Leave 12px above a nonempty subtitle note; empty notes take no space.
- [x] Leave 12px between the token form and its ratings note in Settings.
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

- All 168 Python tests pass with Apple's Python and the development Python; all 11 catalogue JavaScript tests pass.
- Simulated browser checks cover playback, mute, seeking, remote navigation, power confirmation, unavailable states, connection errors and history removal/clearing.
- Dropdown checks cover keyboard navigation, typeahead, Escape/Tab dismissal, disabled subtitle tracks and library controls. Dropdown keys do not send TV remote commands.
- Seek and volume hover previews leave playback/volume unchanged; timestamps and values are clamped to the slider bounds. Skip labels do not overlap their icons.
- Layout checks cover 320, 390, 720 and 1440 px widths.
- Desktop checks cover 1440 × 800 and 1440 × 967. Queue and History lists scroll independently with stationary headings, actions, remote, player and full-width footer. Directional buttons retain equal width and height.
- Library detail checks confirm one poster watched toggle, one primary queue action, padded secondary actions and a simulated queue request.
- Detail checks cover inline votes, optional Wikipedia links, language tooltips and filtering, character names, and film collections. Language and collection menus combine with other filters, support No collection, and retain selections after reload; clearing restores the full library.
- Playback checks cover elapsed / total time during seeking and title navigation with keyboard focus preserved during polling. Subtitle notes keep a 12px gap when present and no space when empty, including visible burn controls in both themes at all checked widths.
- Connection dialog checks cover desktop/mobile layout, unchanged list heights, Escape/close-button dismissal and focus return to the info button.
- Three-row checks confirm the third item is fully visible, the fourth is below the scroll boundary, wrapped titles fit, and list scrolling leaves headings stationary. The dialog opens without a Close tooltip.
- Real TV commands have not been exercised. Backend history endpoints require the running service to load the updated Python source.
