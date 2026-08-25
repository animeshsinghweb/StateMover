# Privacy Policy

**State Mover** does not collect, transmit, sell, or share any data.

## What the extension reads

When you open the popup, State Mover reads the `localStorage` and
`sessionStorage` **key names and sizes** of the tab you are looking at, so it
can list them. It reads a key's **value** only when you expand that key to
preview it, or when you export a snapshot that includes it.

## What the extension stores

One thing, in your browser's own extension storage: the list of key names you
ticked, grouped by site origin, so the popup can restore your selection next
time. This never leaves your browser and contains no values - only key names.

## What the extension sends

Nothing. State Mover has no server, no analytics, no telemetry, no remote code,
and no host permissions. It cannot make network requests.

Exported snapshots go to your clipboard or to a file you choose to download.
Where they go from there is entirely up to you.

## Permissions

| Permission | Purpose |
| --- | --- |
| `activeTab` | Temporary access to the tab you are on, granted only when you click the toolbar icon. |
| `scripting` | Run the read/write snippet in that tab. |
| `storage` | Save your per-origin key selection locally. |
| `clipboardWrite` | Copy a snapshot to your clipboard. |

## Contact

Open an issue at <https://github.com/animeshsinghweb/StateMover/issues>.

_Last updated: 25 August 2026._
