#!/usr/bin/env bash
# Render the app headlessly and save a PNG (+ .log with renderer console output).
# Usage: scripts/capture.sh <out.png> [route e.g. '#/gallery'] [path-to-open] [WxH]
# Requires a prior `npm run build` (uses out/). Set WBI_TIMEOUT (ms) to change the wait.
# Uses a private Xvfb display when available (no windows on your desktop, works without a session).
# PBIP .pbi/cache.abf is never decoded (WBI_BLOCK_CACHE=1 by default; set WBI_BLOCK_CACHE=0 to allow).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$(realpath -m "$1")"; ROUTE="${2:-}"; OPEN="${3:-}"; SIZE="${4:-1600x1000}"
W="${SIZE%x*}"; H="${SIZE#*x}"
RUN=()
SHOW=""
if command -v xvfb-run >/dev/null 2>&1 && [ -z "${WBI_USE_DESKTOP:-}" ]; then
  RUN=(xvfb-run -a -s "-screen 0 $((W + 100))x$((H + 100))x24")
  # private display: show the window there (inactive) so it keeps producing frames
  SHOW=1
fi
rm -f "$OUT" "$OUT.log"
env -u ELECTRON_RUN_AS_NODE WBI_BLOCK_CACHE="${WBI_BLOCK_CACHE:-1}" WBI_CAPTURE="$OUT" WBI_ROUTE="$ROUTE" WBI_OPEN="$OPEN" WBI_SIZE="$SIZE" WBI_CAPTURE_SHOW="$SHOW" \
  timeout "${WBI_HARD_TIMEOUT:-180}" "${RUN[@]}" ./node_modules/.bin/electron . >/dev/null 2>&1 || true
[ -f "$OUT" ] && echo "captured $OUT" || { echo "capture failed"; exit 1; }
