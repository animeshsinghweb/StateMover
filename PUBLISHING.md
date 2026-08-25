# Publishing State Mover

State Mover targets every major desktop browser. There are only **three** stores
to submit to - the rest install from one of those three.

| Browser | Where users get it | You submit? |
| --- | --- | --- |
| Chrome | Chrome Web Store | ✅ Yes |
| Brave | Chrome Web Store (built in) | ❌ No |
| Vivaldi | Chrome Web Store (built in) | ❌ No |
| Arc / Chromium forks | Chrome Web Store | ❌ No |
| Opera | Opera add-ons, **or** Chrome Web Store via Opera's "Install Chrome Extensions" add-on | ⚪ Optional |
| Edge | Microsoft Edge Add-ons | ✅ Yes |
| Firefox | addons.mozilla.org (AMO) | ✅ Yes |

Brave, Vivaldi and Arc all point at the Chrome Web Store, so one Chrome
submission covers them. Edge can technically install from the Chrome Web Store
too, but only after the user flips a setting - a native Edge listing is worth
the ten minutes it costs, and it is free.

---

## 0. Build the packages

```bash
./scripts/build.sh
```

This writes to `dist/`:

- `state-mover-<version>-chromium.zip` → Chrome, Edge, Opera
- `state-mover-<version>-firefox.zip` → Firefox
- `state-mover-<version>-source.zip` → Firefox source-code archive

Then validate before you upload anything. Mozilla's linter catches manifest
mistakes that every store cares about, not just Firefox:

```bash
unzip -q dist/state-mover-*-firefox.zip -d /tmp/sm-ff && npx web-ext lint --source-dir /tmp/sm-ff
```

The Firefox package should come back with zero errors, warnings and notices.
Running it against the Chromium package will report a missing add-on ID and
missing `data_collection_permissions` - both are Firefox-only requirements, and
both are exactly why there is a separate `manifest.firefox.json`.

---

## 1. Chrome Web Store

**Cost:** one-time US$5 developer registration fee. No renewal, no per-extension charge.
**Review time:** usually under a few days for a small, permission-light extension.

1. Sign in at the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) with the Google account you want to own the listing. Use one you will keep.
2. Pay the one-time registration fee and complete **account verification** (email + publisher contact details). Google will not publish anything until the contact email is verified.
3. **New item** → upload `state-mover-<version>-chromium.zip`.
4. Fill in the listing:
   - **Category:** Developer Tools
   - **Description:** the "Why" and "Features" sections of [README.md](README.md) work as-is
   - **Icon:** `icons/icon-128.png`
   - **Screenshots:** 1280×800 or 640×400 PNG, at least one. Screenshot the popup on a real app with a few keys ticked.
   - **Privacy policy URL:** point at the raw [PRIVACY.md](PRIVACY.md) on GitHub, or publish it to GitHub Pages.
5. Complete the **Privacy practices** tab. This is where most first submissions stall. For State Mover:
   - Single purpose: *"Copy selected localStorage and sessionStorage keys from one page and apply them to another."*
   - Justify each permission - the table in [PRIVACY.md](PRIVACY.md) is written to be pasted here.
   - Tick **"I do not sell or transfer user data to third parties"**, **"...not using or transferring for purposes unrelated to the item's single purpose"**, and **"...not for creditworthiness or lending"**.
   - Data collection: declare **none**. State Mover has no network access.
6. Submit for review.

**Things that get a submission rejected:** a permission with no justification, a
missing or unreachable privacy-policy URL, a description that reads like keyword
stuffing, or screenshots that do not show the actual extension.

## 2. Microsoft Edge Add-ons

**Cost:** free - there is no registration fee for the Edge extension program.
**Review time:** typically a few business days, occasionally up to a week or two.

1. Register at [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/) with a Microsoft account, and enrol in the **Microsoft Edge program**. Do not confuse this with the paid Windows *app* developer account - the Edge extension program is separate and free.
2. **New extension** → upload the same `state-mover-<version>-chromium.zip`. Edge runs Chromium, so the Chrome package works unchanged.
3. Fill in the listing (same copy, same assets as Chrome). Edge wants at least one 1366×768 screenshot.
4. Under **Availability**, pick your markets. "All markets" is fine.
5. Under **Properties**, set category **Developer tools**, and supply the privacy policy URL.
6. Submit.

Edge reviews tend to be pickier about the *description matching the actual
behaviour*, so keep the listing literal.

## 3. Firefox Add-ons (AMO)

**Cost:** free.
**Review time:** automated validation is instant; human review of a small extension is usually days.

1. Sign in at [addons.mozilla.org/developers](https://addons.mozilla.org/developers/).
2. **Submit a New Add-on** → *On this site* (listed) → upload `state-mover-<version>-firefox.zip`.
3. The Firefox package is not interchangeable with the Chromium one. It carries `manifest.firefox.json`, which adds:
   - `browser_specific_settings.gecko.id` - required for MV3 signing
   - `strict_min_version: "142.0"` - the floor for Mozilla's data-consent manifest key
   - `data_collection_permissions: { "required": ["none"] }` - **mandatory** for all new extensions submitted since 3 November 2025. Omitting it fails validation.
4. Upload `state-mover-<version>-source.zip` when asked for source code. AMO requires a source archive for anything a reviewer cannot read directly; State Mover ships unminified source, so this is quick, but supplying it avoids a round-trip.
5. Fill in the listing, set the category to **Other** or **Web Development**, and link the privacy policy.
6. Submit. Mozilla signs the add-on as part of review - unsigned add-ons will not install in release Firefox.

## 4. Opera add-ons (optional)

**Cost:** free.
**Review time:** the slowest of the four; multi-week waits are common.

1. Register at [addons.opera.com/developer](https://addons.opera.com/developer/).
2. Upload `state-mover-<version>-chromium.zip`.
3. Same listing copy and assets.

Honestly, this one is optional. Opera users can install from the Chrome Web
Store through Opera's own [Install Chrome
Extensions](https://addons.opera.com/extensions/details/install-chrome-extensions/)
add-on, and the Opera queue is long. Do it only if you want the native listing.

---

## Shared listing assets

Prepare these once and reuse them everywhere:

| Asset | Size | Source |
| --- | --- | --- |
| Store icon | 128×128 | `icons/icon-128.png` |
| Large icon / marquee | 512×512 | `icons/icon-512.png` |
| Screenshot - Chrome | 1280×800 | popup on a real app |
| Screenshot - Edge | 1366×768 | same |
| Short description | ≤132 chars | *"Copy selected localStorage and sessionStorage keys out of one page and apply them to another."* |
| Long description | - | README "Why" + "Features" |
| Privacy policy URL | - | [PRIVACY.md](PRIVACY.md) |
| Support URL | - | the repo's Issues page |

## Releasing an update

1. Bump `version` in **both** `manifest.json` and `manifest.firefox.json`. Every store rejects a re-upload of an existing version number.
2. Add a `CHANGELOG.md` entry.
3. `./scripts/build.sh`
4. Upload the new package to each store and add release notes.
5. Tag the release: `git tag v<version> && git push --tags`

Chrome and Edge auto-update installed copies within a day or so of approval;
Firefox does the same once signed.

## Self-hosting, if you would rather not deal with stores

- **Chromium browsers:** users can `Load unpacked` from a clone of the repo. Fine for a team, not for strangers.
- **Firefox:** you can get a build signed for self-distribution through AMO without publicly listing it, then host the signed `.xpi` yourself.
