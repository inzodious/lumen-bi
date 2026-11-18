#!/usr/bin/env bash
# Install Lumen into the Linux desktop for the current user (no root needed):
#  - app menu entry (~/.local/share/applications/lumen.desktop) launching scripts/lumen.sh from THIS checkout
#  - icons (app + document icons)
#  - file types .pbix .pbit .pbip .wbi registered and opened with Lumen by default
#  - optional: --pin  adds Lumen to the Cinnamon panel's pinned apps
# Re-run after moving/renaming the repo folder. `--uninstall` removes everything it added.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
APPS=~/.local/share/applications; ICONS=~/.local/share/icons/hicolor; MIME=~/.local/share/mime
TYPES=(application/x-powerbi-pbix application/x-powerbi-pbit application/x-powerbi-pbip application/x-lumen-wbi)

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$APPS/lumen.desktop" "$MIME/packages/lumen.xml" \
    "$ICONS"/*/apps/lumen.* "$ICONS"/*/mimetypes/application-x-powerbi-pbix.*
  update-mime-database "$MIME" 2>/dev/null || true; update-desktop-database "$APPS" 2>/dev/null || true
  echo "Lumen desktop integration removed (panel pins, if any, remain until unpinned)."; exit 0
fi

mkdir -p "$APPS" "$ICONS/512x512/apps" "$ICONS/512x512/mimetypes" "$ICONS/scalable/apps" "$ICONS/scalable/mimetypes" "$MIME/packages"
cp "$APP_DIR/resources/icon.png" "$ICONS/512x512/apps/lumen.png"
cp "$APP_DIR/resources/icon.png" "$ICONS/512x512/mimetypes/application-x-powerbi-pbix.png"
if [ -f "$APP_DIR/resources/icon.svg" ]; then
  cp "$APP_DIR/resources/icon.svg" "$ICONS/scalable/apps/lumen.svg"
  cp "$APP_DIR/resources/icon.svg" "$ICONS/scalable/mimetypes/application-x-powerbi-pbix.svg"
fi

cat > "$MIME/packages/lumen.xml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-powerbi-pbix"><comment>Power BI report</comment><sub-class-of type="application/zip"/><generic-icon name="application-x-powerbi-pbix"/><glob pattern="*.pbix" weight="90"/></mime-type>
  <mime-type type="application/x-powerbi-pbit"><comment>Power BI report template</comment><sub-class-of type="application/zip"/><generic-icon name="application-x-powerbi-pbix"/><glob pattern="*.pbit" weight="90"/></mime-type>
  <mime-type type="application/x-powerbi-pbip"><comment>Power BI project</comment><sub-class-of type="application/json"/><generic-icon name="application-x-powerbi-pbix"/><glob pattern="*.pbip" weight="90"/></mime-type>
  <mime-type type="application/x-lumen-wbi"><comment>Lumen project bundle</comment><sub-class-of type="application/zip"/><generic-icon name="application-x-powerbi-pbix"/><glob pattern="*.wbi" weight="90"/></mime-type>
</mime-info>
XML

cat > "$APPS/lumen.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Lumen
GenericName=Power BI Report & Model Workbench
Comment=Open, build and export Power BI reports (PBIX, PBIP, PBIR, TMDL) on Linux
Exec=$APP_DIR/scripts/lumen.sh %F
TryExec=$APP_DIR/scripts/lumen.sh
Path=$APP_DIR
Icon=lumen
Terminal=false
StartupNotify=true
StartupWMClass=lumen
Categories=Office;
Keywords=Power BI;PBIX;PBIP;DAX;Power Query;report;dashboard;BI;
MimeType=application/x-powerbi-pbix;application/x-powerbi-pbit;application/x-powerbi-pbip;application/x-lumen-wbi;
DESKTOP

update-mime-database "$MIME"
update-desktop-database "$APPS" 2>/dev/null || true
gtk-update-icon-cache -f -t "$ICONS" >/dev/null 2>&1 || true
for t in "${TYPES[@]}"; do xdg-mime default lumen.desktop "$t"; done

if [ "${1:-}" = "--pin" ]; then
  for f in ~/.config/cinnamon/spices/grouped-window-list@cinnamon.org/*.json; do
    [ -f "$f" ] || continue
    python3 - "$f" <<'PY'
import json, sys
p = sys.argv[1]; d = json.load(open(p))
apps = d.get('pinned-apps', {}).get('value')
if isinstance(apps, list) and 'lumen.desktop' not in apps:
    apps.append('lumen.desktop'); json.dump(d, open(p, 'w'), indent=4); print('pinned in', p)
PY
  done
fi
echo "Lumen installed for $USER → $APP_DIR (.pbix/.pbit/.pbip/.wbi open with Lumen)"
