#!/usr/bin/env bash
# Packages the extension into store-ready zips under dist/.
#   dist/state-mover-<version>-chromium.zip  -> Chrome, Edge, Brave, Opera, Vivaldi
#   dist/state-mover-<version>-firefox.zip   -> Firefox, Firefox for Android
#   dist/state-mover-<version>-source.zip    -> source archive for AMO review
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(python3 -c 'import json;print(json.load(open("manifest.json"))["version"])')"
DIST="$ROOT/dist"
rm -rf "$DIST"
mkdir -p "$DIST"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

pack() {
  local target="$1" manifest="$2"
  local dir="$STAGE/$target"
  mkdir -p "$dir"
  mkdir -p "$dir/icons"
  # icon-512 is a store-listing asset, not something the extension loads.
  find icons -name 'icon-*.png' ! -name 'icon-512.png' -exec cp {} "$dir/icons/" \;
  cp -R src "$dir/"
  cp "$manifest" "$dir/manifest.json"
  (cd "$dir" && zip -qr "$DIST/state-mover-$VERSION-$target.zip" . -x '.DS_Store' '*/.DS_Store')
  echo "dist/state-mover-$VERSION-$target.zip"
}

pack chromium manifest.json
pack firefox manifest.firefox.json

zip -qr "$DIST/state-mover-$VERSION-source.zip" \
  assets icons scripts src manifest.json manifest.firefox.json \
  README.md LICENSE PRIVACY.md PUBLISHING.md CHANGELOG.md \
  -x '.DS_Store' '*/.DS_Store' 
echo "dist/state-mover-$VERSION-source.zip"
