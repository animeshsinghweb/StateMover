#!/usr/bin/env bash
# Builds the extension into dist/.
#
# Unpacked folders - what "Load unpacked" wants. Point the browser at the FOLDER:
#   dist/chromium/  -> Chrome, Edge, Brave, Opera, Vivaldi
#   dist/firefox/   -> Firefox (or pick dist/firefox/manifest.json as a temporary add-on)
#
# Zips - for store submission only. No browser will "Load unpacked" a zip:
#   dist/state-mover-<version>-chromium.zip
#   dist/state-mover-<version>-firefox.zip
#   dist/state-mover-<version>-source.zip   (source archive for AMO review)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(python3 -c 'import json;print(json.load(open("manifest.json"))["version"])')"
DIST="$ROOT/dist"
rm -rf "$DIST"
mkdir -p "$DIST"

pack() {
  local target="$1" manifest="$2"
  local dir="$DIST/$target"
  mkdir -p "$dir/icons"
  # icon-512 is a store-listing asset, not something the extension loads.
  find icons -name 'icon-*.png' ! -name 'icon-512.png' -exec cp {} "$dir/icons/" \;
  cp -R src "$dir/"
  cp "$manifest" "$dir/manifest.json"
  (cd "$dir" && zip -qr "$DIST/state-mover-$VERSION-$target.zip" . -x '.DS_Store' '*/.DS_Store')
}

pack chromium manifest.json
pack firefox manifest.firefox.json

zip -qr "$DIST/state-mover-$VERSION-source.zip" \
  assets icons scripts src manifest.json manifest.firefox.json \
  README.md LICENSE PRIVACY.md CHANGELOG.md \
  -x '.DS_Store' '*/.DS_Store'

cat <<SUMMARY

Built State Mover $VERSION.

  Load unpacked  ->  select one of these FOLDERS (not a zip):
    $DIST/chromium
    $DIST/firefox

  Store upload   ->  these zips:
    dist/state-mover-$VERSION-chromium.zip   Chrome, Edge, Brave, Opera
    dist/state-mover-$VERSION-firefox.zip    Firefox
    dist/state-mover-$VERSION-source.zip     source archive for AMO

SUMMARY
