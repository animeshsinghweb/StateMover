# Changelog

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
