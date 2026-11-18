#!/usr/bin/env bash
# Desktop launcher for Lumen: rebuilds the app if sources changed since the last build, then starts it.
# Extra arguments (files to open: .pbix/.pbit/.pbip/.wbi or *.Report folders) are passed through.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$APP_DIR"
STAMP="out/main/index.js"
if [ ! -f "$STAMP" ] || [ -n "$(find src package.json electron.vite.config.ts -newer "$STAMP" -type f -print -quit 2>/dev/null)" ]; then
  if command -v notify-send >/dev/null 2>&1; then notify-send -i "$APP_DIR/resources/icon.png" "Lumen" "Building the latest version…" || true; fi
  ./node_modules/.bin/electron-vite build >/tmp/lumen-build.log 2>&1 || { notify-send "Lumen" "Build failed — see /tmp/lumen-build.log" 2>/dev/null || true; exit 1; }
fi
exec env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron . "$@"
