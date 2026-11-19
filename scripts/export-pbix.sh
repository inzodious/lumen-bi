#!/usr/bin/env bash
# Headless save of a project as a Power BI file or template (experimental: not yet verified in Power BI Desktop).
# Usage: scripts/export-pbix.sh <input: .pbix | .pbit | .pbip | .wbi | project folder> <output.pbix | output.pbit> [--refresh]
#   --refresh   refresh the model from its sources first (a PBIP project has no data until it is refreshed)
# Requires a prior `npm run build` (uses out/). Runs the app on a private Xvfb display when available, opens the input,
# writes the output with the same code as File > Save as, and prints the app's [export] / [refresh] log lines.
# Exit status 0 only when the output file was written. PBIP .pbi/cache.abf is never decoded (WBI_BLOCK_CACHE=1).
set -euo pipefail
cd "$(dirname "$0")/.."
[ $# -ge 2 ] || { sed -n '2,7p' "$0"; exit 2; }
IN="$(realpath -m "$1")"; OUT="$(realpath -m "$2")"; REFRESH=""
[ "${3:-}" = "--refresh" ] && REFRESH="&refresh=1"
case "$OUT" in
  *.pbix) KIND=pbix ;;
  *.pbit) KIND=pbit ;;
  *) echo "output must end in .pbix or .pbit" >&2; exit 2 ;;
esac
[ -e "$IN" ] || { echo "not found: $IN" >&2; exit 2; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
rm -f "$OUT"
ENC="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$OUT")"
T="${WBI_TIMEOUT:-300000}"
WBI_TIMEOUT="$T" WBI_HARD_TIMEOUT="$((T / 1000 + 60))" scripts/capture.sh "$TMP/shot.png" "#/?export=$KIND&exportPath=$ENC$REFRESH" "$IN" >/dev/null 2>&1 || true
grep -E '\[(export|refresh)\]' "$TMP/shot.png.log" 2>/dev/null | sed 's/^\[[a-z]*\] //' || true
[ -f "$OUT" ] && { echo "wrote $OUT"; exit 0; } || { echo "export failed (see the lines above)" >&2; exit 1; }
