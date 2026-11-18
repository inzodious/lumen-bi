#!/usr/bin/env bash
# Compare a Power BI reference (screenshot or Export-to-PDF) with Lumen's render, visual by visual (docs/COMPARE.md).
#
# Usage: scripts/compare.sh <reference.png|.jpg|.pdf> <report> <outdir> [--page p] [--pages a,b] [--sample-data]
#                           [--private] [--same-data] [--crop x,y,w,h] [--lumen <sweep dir>] [--titles] [--no-build]
#   Renders the report pages with scripts/sweep.sh, finds the page canvas in the reference (or uses --crop),
#   cuts every visual out of both at the same scale and scores the differences that survive different data.
#   Output: <outdir>/index.html (review page, worst first), compare.json, summary.tsv, pages/, visuals/, lumen/.
#   Needs pdftoppm (poppler-utils) for PDF references; JPEG references are decoded through Electron.
set -euo pipefail
[ $# -ge 3 ] || { sed -n '2,10p' "$0"; exit 2; }
exec node "$(dirname "$0")/compare.mjs" "$@"
