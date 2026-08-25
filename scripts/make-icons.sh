#!/usr/bin/env bash
# Rasterises the SVG logos into the PNG sizes the extension and the stores need.
# Small sizes use a simplified mark so the glyph stays readable in a toolbar.
# Requires Google Chrome (headless) - no extra toolchain to install.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/icons"

CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [ ! -x "$CHROME" ]; then
  CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
fi
[ -x "$CHROME" ] || { echo "Chrome not found. Set CHROME_BIN to a Chrome/Chromium binary." >&2; exit 1; }

mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

render() {
  local svg="$ROOT/assets/$1.svg" size="$2"
  cat > "$TMP/wrap-$size.html" <<HTML
<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
img{display:block;width:${size}px;height:${size}px}</style>
<img src="file://$svg">
HTML
  "$CHROME" --headless --disable-gpu --force-device-scale-factor=1 \
    --default-background-color=00000000 --hide-scrollbars --allow-file-access-from-files \
    --screenshot="$OUT/icon-$size.png" --window-size="$size,$size" \
    "file://$TMP/wrap-$size.html" >/dev/null 2>&1
  echo "icons/icon-$size.png"
}

for size in 16 32; do render logo-small "$size"; done
for size in 48 96 128 512; do render logo "$size"; done
