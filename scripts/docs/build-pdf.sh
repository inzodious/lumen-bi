#!/usr/bin/env bash
# Build the PDF editions of the Lumen documentation (docs/**/*.md) into docs/pdf/, after a link check.
#
# Usage: scripts/docs/build-pdf.sh [options] [edition ...]
#   (no arguments)      link check, then every edition and the combined lumen-documentation.pdf
#   <edition> ...       only these editions (ids from --list), e.g. get-started troubleshooting
#   --check             link check only (relative links, image paths and #anchors in every docs/**/*.md)
#   --list              the editions, their sections and article counts, and ordering warnings
#   --out <dir>         write the PDFs to <dir> instead of docs/pdf/
#   --keep-html         keep the intermediate HTML (prints its folder)
#   --warn-links        report broken links but build anyway (for drafts; never for the committed PDFs)
#   -h, --help          this text
#
# The link check fails the build (exit 1) and lists every broken link. Article order inside a section comes from the
# links in the section's README.md; the combined edition follows the "All sections" table of docs/README.md.
# Requirements: pandoc 3.x, pdfinfo (poppler-utils), Electron in node_modules (npm install), xvfb-run (optional:
# without it Electron needs a display; LUMEN_DOCS_USE_DISPLAY=1 forces the current display). Node >= 20.
# Implementation: scripts/docs/build-pdf.mjs, pdf-filter.lua (pandoc), pdf.css (print styles), pdf-print.cjs (Electron).
set -euo pipefail
ROOT="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
node_ok() { "$1" -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' 2>/dev/null; }
if ! { command -v node >/dev/null 2>&1 && node_ok node; }; then
  for n in $(ls -d "${NVM_DIR:-$HOME/.nvm}"/versions/node/v*/bin/node "$HOME"/.local/share/fnm/node-versions/v*/installation/bin/node "$HOME"/.volta/bin/node 2>/dev/null | sort -rV); do
    if node_ok "$n"; then PATH="$(dirname "$n"):$PATH"; export PATH; break; fi
  done
fi
command -v pandoc >/dev/null 2>&1 || { echo "build-pdf: pandoc is required (e.g. apt install pandoc)" >&2; exit 2; }
exec env -u ELECTRON_RUN_AS_NODE node "$ROOT/scripts/docs/build-pdf.mjs" "$@"
