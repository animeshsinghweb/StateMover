# Changelog

## 1.2.1

**Fixes the popup hanging or coming up blank.**

- Every call into the page is now bounded by a timeout. A page whose main thread is busy used to leave the popup stuck on "Reading page..." with no way out; it now reports what happened after a few seconds and offers **Try again**.
- Detects a tab the browser discarded to reclaim memory, which is what happens when a lot of tabs are open, and offers **Reload the tab** instead of failing against a page that is no longer there.
- The saved selection and the page read now run in parallel, and neither can block the other. Sync storage, the slowest thing the popup touched, is no longer on the startup path at all: the 1.1 key migration runs once and is cached locally.
- Failures are reported with the reason and a way to recover, rather than a silent or blank popup. Nothing can leave the popup empty any more.
- Listing keys is around seven times faster and allocates nothing extra: sizes are read from string length rather than by encoding every value, which used to copy the whole store just to measure it. Sizes now match the browser's own quota accounting.
- One delegated listener for the key list instead of four per row, so filtering a long list no longer churns hundreds of closures per keystroke.
- Very long key lists render the first 400 rows with a note, instead of building thousands of DOM nodes.

## 1.2.0

**Rewritten popup.**

- Keys are now picked from a live checkbox list of what is actually on the page, with sizes, sorting, and a filter box. The comma-separated text field is gone.
- Expand any key to preview its value, pretty-printed when it is JSON.
- Selections are saved per origin and persist automatically - no "Save keys" button.
- Added **Download .json** and **Load file...** alongside clipboard copy/paste.
- Added an optional "reload the page after import" step.
- Replaced every `alert()` with in-popup toasts. Nothing interrupts the page any more.
- Clear message on pages where extensions cannot run (`chrome://`, add-on stores) instead of a silent no-op.
- Light and dark themes; keyboard focus styles throughout.

**Under the hood.**

- Export builds the snapshot in the popup via `navigator.clipboard`, instead of injecting a hidden `<textarea>` and calling the deprecated `document.execCommand("copy")` on the page.
- Snapshots no longer duplicate `localStorage` values into a legacy `data` field, halving payload size. Version 1.1 snapshots still import.
- Values are fetched lazily; opening the popup only reads key names and sizes.
- Injection failures are caught and surfaced instead of being swallowed.
- New custom logo, replacing the third-party stock icon.
- Firefox support via `manifest.firefox.json`, plus `scripts/build.sh` to produce store-ready zips.

## 1.1

- Added `sessionStorage` support alongside `localStorage`.
- Added a key browser and a JSON preview for selected keys.

## 1.0

- Export and import a fixed list of `localStorage` keys through the clipboard.
