<div align="center">

<img src="icons/icon-128.png" width="88" height="88" alt="State Mover">

# State Mover

**Move `localStorage` and `sessionStorage` between environments in two clicks.**

Pick the keys that matter, copy them as a JSON snapshot, paste them into another
origin. No accounts, no servers, no network calls.

[Website](https://animeshsinghweb.github.io/StateMover/) · [Guide](https://animeshsinghweb.github.io/StateMover/guide.html) · [Install](#install) · [Snapshot format](#snapshot-format) · [Build](#build-from-source)

</div>

---

## Why

Signing in again on every environment is tedious. When the thing you actually
need is a session token, a feature-flag blob, or a saved UI state, the fastest
path is to lift those exact keys from a page where they already exist and drop
them onto the page where you need them.

State Mover does that, and nothing else.

## Features

- **Browse the page's storage** - every `localStorage` and `sessionStorage` key on the active tab, with its size, sorted and filterable.
- **Pick with checkboxes** - no more typing comma-separated key names.
- **Peek before you copy** - expand any key to see its value, pretty-printed if it is JSON.
- **Selections remember the origin** - the keys you tick on `app.staging.example.com` stay ticked the next time you open the popup there.
- **Copy or download** - put a snapshot on the clipboard, or save it as a timestamped `.json` file.
- **Import with an optional reload** - apply a snapshot and refresh the tab in one action.
- **Reads nothing you did not select** - key names and sizes are listed; values are only fetched when you expand a row or export.
- **Light and dark** - follows the browser theme.

## Install

### From source (all browsers)

```bash
git clone https://github.com/animeshsinghweb/StateMover.git
cd StateMover
./scripts/build.sh
```

That writes two ready-to-load folders, one per engine:

- `dist/chromium/` - Chrome, Edge, Brave, Opera, Vivaldi
- `dist/firefox/` - Firefox

> **Load unpacked wants a folder, not a zip.** The `.zip` files next to those
> folders are for uploading to the stores; no browser will accept one here. If
> the file picker greys them out, that is why - select the folder instead.

| Browser | Steps |
| --- | --- |
| Chrome / Brave / Vivaldi | `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the **`dist/chromium`** folder |
| Edge | `edge://extensions` → enable **Developer mode** → **Load unpacked** → select the **`dist/chromium`** folder |
| Opera | `opera://extensions` → enable **Developer mode** → **Load unpacked** → select the **`dist/chromium`** folder |
| Firefox 142+ | `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select **`dist/firefox/manifest.json`** |

Firefox's picker is a *file* picker rather than a folder picker, so point it at
the `manifest.json` inside `dist/firefox/`. It also accepts
`dist/state-mover-<version>-firefox.zip` if you prefer.

Chromium browsers can also read the repo root directly - `manifest.json` sits at
the top level - so **Load unpacked** on the clone itself works without building.
Firefox cannot, because it needs `manifest.firefox.json` renamed into place,
which is exactly what the build step does.

Temporary add-ons in Firefox are unloaded when you close the browser. Chromium
browsers keep an unpacked extension until you remove it.

### From a store

Not listed yet. Until then, build from source above, or grab a package from the
[latest release](https://github.com/animeshsinghweb/StateMover/releases/latest).

The project site has a longer [usage guide](https://animeshsinghweb.github.io/StateMover/guide.html), the
[privacy policy](https://animeshsinghweb.github.io/StateMover/privacy.html) and the [terms](https://animeshsinghweb.github.io/StateMover/terms.html).

## How it works

1. Open the tab whose storage you want to copy and click the State Mover icon.
2. Tick the keys you need, in the `localStorage` and/or `sessionStorage` tab.
3. **Copy snapshot** (or **Download .json**).
4. Switch to the target tab, open State Mover, paste into the import box, and hit **Apply snapshot**.

The popup runs a short script in the active tab to read and write storage. That
script only ever touches the keys you selected.

### Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Grants access to the current tab only, only while the popup is open, only after you click the toolbar icon. |
| `scripting` | Runs the read/write snippet in that tab. |
| `storage` | Remembers which keys you ticked, per origin. |
| `clipboardWrite` | Puts the snapshot on your clipboard. |

There is no host permission, no background service worker, and no network
access. Nothing leaves your machine - see the [privacy policy](https://animeshsinghweb.github.io/StateMover/privacy.html).

## Snapshot format

```json
{
  "__localStorageTransfer__": true,
  "version": 2,
  "origin": "https://app.example.com",
  "exportedAt": "2026-08-25T10:15:00.000Z",
  "local":   { "currentUser": "{\"id\":42}" },
  "session": { "tempState": "{\"step\":3}" }
}
```

Values are stored exactly as the browser stores them: strings. Snapshots written
by version 1.1 - which put `localStorage` values in a flat `data` field - still
import correctly.

## Build from source

```bash
./scripts/build.sh
```

Produces three archives in `dist/`:

- `state-mover-<version>-chromium.zip` - Chrome, Edge, Brave, Opera, Vivaldi
- `state-mover-<version>-firefox.zip` - Firefox
- `state-mover-<version>-source.zip` - source archive for the Firefox add-on review

To check the packages against Mozilla's add-on validator before submitting
anywhere:

```bash
unzip -q dist/state-mover-*-firefox.zip -d /tmp/sm-ff
npx web-ext lint --source-dir /tmp/sm-ff
```

To regenerate the icons after editing `assets/logo.svg`:

```bash
./scripts/make-icons.sh
```

Both scripts are plain Bash. There is no build toolchain, no dependencies, and
no bundler - the extension ships the source files as-is.

## Project layout

```
assets/      logo sources (logo.svg, and logo-small.svg for 16-32 px)
icons/       generated PNGs
scripts/     build.sh, make-icons.sh
src/         popup.html, popup.css, popup.js
manifest.json          Chromium (MV3)
manifest.firefox.json  Firefox (MV3 + gecko settings)
```

## License

[MIT](LICENSE)
