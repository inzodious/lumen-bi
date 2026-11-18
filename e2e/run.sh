#!/usr/bin/env bash
# Lumen end-to-end UI suite: build the app, then run every e2e/*.e2e.ts journey on a private Xvfb display.
# Usage: e2e/run.sh [--no-build] [vitest args, e.g. a file filter: e2e/run.sh report]
# The app is built into its own out/e2e/ (not out/) so a concurrent `npm run build` can't swap the renderer's hashed
# assets under a running journey.
# Env: LUMEN_SAMPLES_DIR=<dir of Microsoft sample .pbix> (enables the sample-file journeys),
#      LUMEN_E2E_OUT=<dir> (failure screenshots/logs + scratch files; default a temp dir), LUMEN_E2E_WORKERS (default 3).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" = "--no-build" ]; then shift; else node_modules/.bin/electron-vite build --outDir out/e2e --logLevel error; fi
RUN=()
if command -v xvfb-run >/dev/null 2>&1 && [ -z "${LUMEN_E2E_USE_DISPLAY:-}" ]; then
  RUN=(xvfb-run -a -s "-screen 0 1800x1200x24")
fi
exec env -u ELECTRON_RUN_AS_NODE "${RUN[@]}" node_modules/.bin/vitest run --config e2e/vitest.config.ts "$@"
