#!/usr/bin/env bash
# Gallery thumbnails from Lumen's own render: scripts/templates/previews.sh [id…]
# Builds the app, exports the first page of each template to PNG and saves a 640×360 JPEG to
# src/renderer/src/assets/templates/<id>.jpg. Needs python3 with Pillow.
set -euo pipefail
cd "$(dirname "$0")/../.."
IDS=("$@")
if [ ${#IDS[@]} -eq 0 ]; then
  mapfile -t IDS < <(ls src/core/templates | grep -v '\.ts$')
fi
npm run build >/dev/null
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p src/renderer/src/assets/templates
for id in "${IDS[@]}"; do
  scripts/capture.sh "$TMP/$id.png" "#/?template=$id&export=png&exportPath=$TMP/$id" '' 1600x1000 >/dev/null
  first="$(ls "$TMP/$id"/*.png | sort | head -1)"
  python3 - "$first" "src/renderer/src/assets/templates/$id.jpg" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
im.resize((640, round(640 * im.height / im.width)), Image.LANCZOS).save(sys.argv[2], 'JPEG', quality=86, optimize=True, progressive=True)
PY
  echo "preview $id"
done
