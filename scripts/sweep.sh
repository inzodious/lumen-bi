#!/usr/bin/env bash
# Render every page of one or more reports headlessly and record per-visual status (see docs/SWEEP.md).
#
# Usage: scripts/sweep.sh <file-or-folder> <outdir> [--sample-data] [--pages a,b] [--size WxH] [--no-build]
#   <file-or-folder>  a .pbix/.pbit/.pbip/.wbi file, a *.Report folder, or a folder searched (depth 4)
#                     for those; one Electron process per report.
#   <outdir>          results: <outdir>/<report>/NN-<page>.png + report.json, and <outdir>/summary.tsv
#   --sample-data     fill tables without data with synthetic sample rows (PBIP corpus without data)
#   --pages a,b       only these pages (name, display name or 1-based index)
#   --dax 'EVALUATE …' run a DAX query in the app after loading (repeatable; results in report.json .dax)
#
# Always runs with WBI_BLOCK_CACHE=1: PBIP `.pbi/cache.abf` files are never decoded (the renderer refuses
# to open anything if the guard is not active). Requires `npm run build` (done unless --no-build / out/ is
# newer than src/). Uses a private Xvfb display when available. WBI_TIMEOUT (ms) bounds each report.
set -euo pipefail
cd "$(dirname "$0")/.."
[ $# -ge 2 ] || { sed -n '2,14p' "$0"; exit 2; }
SRC="$(realpath -m "$1")"; OUT="$(realpath -m "$2")"; shift 2
SAMPLE=0; PAGES=""; SIZE="1800x1200"; BUILD=1; DAX=()
while [ $# -gt 0 ]; do
  case "$1" in
    --sample-data) SAMPLE=1 ;;
    --pages) PAGES="$2"; shift ;;
    --dax) DAX+=("$2"); shift ;;
    --size) SIZE="$2"; shift ;;
    --no-build) BUILD=0 ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
  shift
done
W="${SIZE%x*}"; H="${SIZE#*x}"

if [ "$BUILD" = 1 ] && { [ ! -f out/renderer/index.html ] || [ -n "$(find src -newer out/renderer/index.html -type f -print -quit)" ]; }; then
  echo "building…"; npm run build >/dev/null 2>&1 || { echo "build failed (run npm run build to see why)"; exit 1; }
fi

TARGETS=()
if [ -d "$SRC" ] && [[ ! "$SRC" =~ \.(Report|SemanticModel)$ ]]; then
  while IFS= read -r -d '' f; do TARGETS+=("$f"); done < <(find "$SRC" -maxdepth 4 \( -iname '*.pbix' -o -iname '*.pbit' -o -iname '*.wbi' -o \( -type d -name '*.Report' \) \) -print0 | LC_ALL=C sort -z)
else
  TARGETS=("$SRC")
fi
[ ${#TARGETS[@]} -gt 0 ] || { echo "nothing to sweep under $SRC"; exit 1; }

RUN=()
SHOW=""
if command -v xvfb-run >/dev/null 2>&1 && [ -z "${WBI_USE_DESKTOP:-}" ]; then RUN=(xvfb-run -a -s "-screen 0 $((W + 100))x$((H + 100))x24"); SHOW=1; fi
enc() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }

mkdir -p "$OUT"
SUMMARY="$OUT/summary.tsv"
printf "report\tpages\tvisuals\tok\terror\tnodata\tloading\tunsupported\tempty\tblank\topen_ms\terror_msg\n" > "$SUMMARY"
for T in "${TARGETS[@]}"; do
  NAME="$(basename "$T")"; NAME="${NAME%.*}"
  DIR="$OUT/$NAME"; rm -rf "$DIR"; mkdir -p "$DIR"
  ROUTE="#/?start=0&blockCache=1&sweep=$(enc "$DIR")&open=$(enc "$T")"
  [ "$SAMPLE" = 1 ] && ROUTE="$ROUTE&synthetic=1"
  [ -n "$PAGES" ] && ROUTE="$ROUTE&pages=$(enc "$PAGES")"
  for q in "${DAX[@]}"; do ROUTE="$ROUTE&dax=$(enc "$q")"; done
  START=$(date +%s)
  env -u ELECTRON_RUN_AS_NODE WBI_BLOCK_CACHE=1 WBI_SWEEP=1 WBI_SWEEP_SHOW="$SHOW" WBI_SWEEP_LOG="$DIR/console.log" WBI_ROUTE="$ROUTE" WBI_SIZE="$SIZE" \
    timeout $(( ${WBI_TIMEOUT:-900000} / 1000 + 30 )) "${RUN[@]}" ./node_modules/.bin/electron . >"$DIR/electron.log" 2>&1 || true
  node -e '
    const fs = require("fs"); const [dir, name, secs, sum] = process.argv.slice(1)
    let r; try { r = JSON.parse(fs.readFileSync(dir + "/report.json", "utf8")) } catch { r = { pages: [], totals: {}, error: "no report.json (crash or timeout; see console.log)" } }
    const t = r.totals || {}; const n = Object.values(t).reduce((a, b) => a + b, 0)
    const row = [name, r.pages.length, n, t.ok || 0, t.error || 0, t.nodata || 0, t["loading-stuck"] || 0, t.unsupported || 0, t.empty || 0, t.blank || 0, r.openMs ?? "", (r.error || (r.inProgress ? "stuck on page " + r.inProgress : "")).replace(/\s+/g, " ")]
    fs.appendFileSync(sum, row.join("\t") + "\n")
    console.log(`${name}: ${r.pages.length} page(s) in ${secs}s  ${JSON.stringify(t)}${r.error ? "  ERROR " + r.error : ""}${r.inProgress ? "  STUCK on page " + r.inProgress : ""}${r.cacheBlocked === false ? "  (cache guard OFF!)" : ""}`)
  ' "$DIR" "$NAME" "$(( $(date +%s) - START ))" "$SUMMARY"
done
echo "summary: $SUMMARY"
