#!/usr/bin/env bash
# Renders the real popup - fed demo data, never a real page's keys - into the
# marketing and store-listing images under docs/assets/.
#   hero.png        2000x1520  landing page, product shot only
#   store-1280.png  1280x800   Chrome Web Store, Opera, AMO
#   store-1366.png  1366x768   Microsoft Edge Add-ons
#   og.png          1200x630   link previews
#   popup.png        420x640   the popup on its own, for the guide
# Requires Google Chrome (headless).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/scripts/screenshot"
OUT="$ROOT/docs/assets"

CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [ ! -x "$CHROME" ]; then
  CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
fi
[ -x "$CHROME" ] || { echo "Chrome not found. Set CHROME_BIN to a Chrome/Chromium binary." >&2; exit 1; }

mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# A copy of the popup with the demo API stubbed in ahead of popup.js.
cp -R "$ROOT/src" "$ROOT/icons" "$TMP/"
cp "$SRC/stub.js" "$TMP/src/stub.js"
python3 - "$TMP/src/popup.html" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read().replace('<script src="popup.js">', '<script src="stub.js"></script>\n    <script src="popup.js">')
open(p, 'w').write(s)
PY

cp "$SRC/shot.css" "$TMP/shot.css"
sed -e "s|ICONS|icons|" -e "s|POPUP|src/popup.html|" "$SRC/shot.html" > "$TMP/shot.html"
# Same stage, minus the marketing copy - the site hero supplies its own headline.
sed 's|class="stage"|class="stage bare"|' "$TMP/shot.html" > "$TMP/bare.html"

shoot() {
  local page="$1" out="$2" w="$3" h="$4" scale="${5:-1}"
  "$CHROME" --headless --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --force-device-scale-factor="$scale" --virtual-time-budget=3000 \
    --screenshot="$OUT/$out" --window-size="$w,$h" "file://$page" >/dev/null 2>&1
  echo "docs/assets/$out  (${w}x${h} @${scale}x)"
}

shoot "$TMP/bare.html" hero.png       1000 760 2
shoot "$TMP/shot.html" store-1280.png 1280 800 1
shoot "$TMP/shot.html" store-1366.png 1366 768 1
shoot "$TMP/shot.html" og.png         1200 630 1
shoot "$TMP/src/popup.html" popup.png 420 640 2
