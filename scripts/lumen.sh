#!/usr/bin/env bash
# Desktop launcher for Lumen: rebuilds the app if sources changed since the last build, then starts it.
# Extra arguments (files to open: .pbix/.pbit/.pbip/.wbi or *.Report folders) are passed through.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$APP_DIR"
# The build (Vite 8 / rolldown) needs Node >= 20. A desktop launch does not load the shell profile, so the
# PATH may only have an older system Node: fall back to the newest nvm / fnm / volta install.
node_ok() { "$1" -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' 2>/dev/null; }
if ! { command -v node >/dev/null 2>&1 && node_ok node; }; then
  for n in $(ls -d "${NVM_DIR:-$HOME/.nvm}"/versions/node/v*/bin/node "$HOME"/.local/share/fnm/node-versions/v*/installation/bin/node "$HOME"/.volta/bin/node 2>/dev/null | sort -rV); do
    if node_ok "$n"; then PATH="$(dirname "$n"):$PATH"; export PATH; break; fi
  done
fi
STAMP="out/main/index.js"
if [ ! -f "$STAMP" ] || [ -n "$(find src package.json electron.vite.config.ts -newer "$STAMP" -type f -print -quit 2>/dev/null)" ]; then
  if command -v notify-send >/dev/null 2>&1; then notify-send -i "$APP_DIR/resources/icon.png" "Lumen" "Building the latest version…" || true; fi
  if ! node_ok node; then notify-send "Lumen" "Building needs Node.js 20 or newer (found $(node --version 2>/dev/null || echo none))" 2>/dev/null || true; exit 1; fi
  ./node_modules/.bin/electron-vite build >/tmp/lumen-build.log 2>&1 || { notify-send "Lumen" "Build failed — see /tmp/lumen-build.log" 2>/dev/null || true; exit 1; }
fi
exec env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron . "$@"
