# Lumen backlog

Items the user has raised for after the initial build. "Discuss" = agree the design with the user before building.

## Built (kept for reference)
- **Formula bar everywhere + better-than-PBI DAX IntelliSense** — built: `src/renderer/src/editors/FormulaBar.tsx` and
  `src/renderer/src/editors/dax/` (completion, signature help, hover, formatter, diagnostics). Original request: formula bar in Report view on measure select / New measure;
  Tab-to-accept with fuzzy ranking (`CALC` → `CALCULATE(`), auto-indent, signature help, hover docs, snippets,
  format-on-demand/commit, live value preview, quick fixes. (modeling-views workstream)

## Discuss: canvas & formatting
- **Smarter sizing and snapping** — snap to *equal spacing* (Figma-style distance guides, e.g. keep the gaps between KPI
  cards identical), match-size guides (same width/height as a neighbour), margin/gutter presets for the page, distribute
  with a fixed gap, "tidy up" grid for a row of cards, keyboard resize, numeric position/size in the format pane.
  *Status:* equal spacing, match size, margin/gutter guides, tidy up and distribute with a gap are built
  (`report/geometry.ts`, `report/layoutGuides.ts`; see ARCHITECTURE ▸ "Snapping & layout").
- **More slicer dropdown options** — richer dropdown slicer (search, select-all, single/multi toggle, chips for
  selections, hierarchy in dropdown, date presets), plus whatever else the user lists.
- General improvements list (to be collected with the user).

## Discuss: transitions and animations
- **Visual animations** — animate a visual when its data changes (bars and columns grow, lines redraw, pies sweep,
  cards count up), as Power BI does on load, filter and cross-highlight. Today visuals redraw without motion; only the
  scatter chart's play axis animates (`charts/scatter/ScatterChart.tsx`).
- **Page transitions** — an optional transition (fade, slide) when moving between pages, bookmarks and drillthrough
  targets. Power BI Desktop has no page transitions, so this is a Lumen extension: store it in a Lumen sidecar and leave
  the saved PBIR unchanged so files still open in Power BI.
- Cross-cutting: a per-report on/off switch and duration, motion off under the OS reduced-motion setting, and none in
  exports, captures and `wbiReady` waits so screenshots and e2e journeys stay deterministic.

## Done: Model view (diagram) improvements
Built in `src/renderer/src/views/model/` (geometry in `routing.ts`, `snapping.ts`, `groups.ts`, `diagramOps.ts`), stored per
layout in `diagramLayout.lumen.json` (see ARCHITECTURE ▸ "Model diagram sidecar"); journeys in `e2e/model.e2e.ts`.
- **Editable relationship lines** — curved (spline), orthogonal and straight styles (layout default in the diagram toolbar,
  per-line override in the line's menu, "make … my default" as a per-user preference); drag a line to bend it (pinch
  point), drag / double-click / Delete pinch points, drag a line's ends around their cards, "Reset line", snapping to the
  10 px grid and to alignment with other pinch points / card centres (Alt = off), live preview when a relationship is
  dragged from column to column.
- **Table groups ("containers")** — Ctrl/Shift-click or marquee (Shift+drag, or the Select tool), then Group (toolbar,
  menu, Ctrl+G) / Ungroup (Ctrl+Shift+G, Delete): labelled tinted container behind lines and cards; rename by
  double-click, 7 muted colours, move as one, auto-fit, resize handles, drag tables in/out, collapse to a chip that keeps
  its relationship lines; included in fit-to-screen, the mini-map and "Export diagram as image" (PNG/SVG).

Follow-ups worth considering:
- Obstacle-aware automatic routing (lines still pass behind cards that lie between their two tables).
- Nested groups; a group shared by several layouts; renaming layout tabs (the sidecar is keyed by layout name).
- Lines to a collapsed group attach to the middle of the chip's side (several lines can end in the same point), and
  their own pinch points are ignored while collapsed.
- Arrow-key nudging of pinch points / containers; multi-select of pinch points.
- Card collapse state (the chevron on a table card) is still per-session, as before.

## Discuss: real data connectors (end state)
Goal: reports refresh from real sources, not only files and mock data. Connectors run in the Electron **main process**
(Node: network, native drivers, credential storage) behind the M engine's async host, so every source is usable from
Power Query M (`PostgreSQL.Database(…)`, etc.), the Get data dialog, and scheduled refresh.

| Source | Approach |
|---|---|
| PostgreSQL (+ Supabase, Timescale, Neon) | `pg` driver; `PostgreSQL.Database(server, db)` navigation + `Value.NativeQuery`; SSL; simple query folding (select/filter/limit) |
| MySQL / MariaDB | `mysql2`; `MySQL.Database` |
| SQL Server / Azure SQL / Fabric warehouse & lakehouse SQL endpoints | `tedious` + Entra ID (device code / CLI / browser) — being built in the Power Query workstream |
| Firestore | Firebase Admin SDK or REST with a service account / OAuth; collections → tables (flatten nested maps, arrays → child tables), incremental by `updated_at` |
| TrueNAS (ZFS datasets) | files over SMB/NFS (mounted path → `Folder.Files`, or a direct SMB2 client), or S3-compatible buckets (TrueNAS / MinIO apps) via an S3 connector; Parquet/Delta/CSV/Excel readers already exist |
| S3 / MinIO / Azure Blob / ADLS Gen2 / OneLake | object-store connector + Parquet/Delta readers (`AzureStorage.DataLake`, `AmazonS3`-style) |
| Delta / Parquet lakehouses (incl. the mock lakehouses in `datasets/`) | `Lakehouse.Contents`-style navigator over `Tables/` (Delta log replay → Parquet) and `Files/`; optional embedded DuckDB in main for SQL over lakehouse files |
| REST / OData / GraphQL APIs | `Web.Contents` / `OData.Feed` with auth presets (API key, bearer, OAuth2 PKCE), pagination helpers |
| SQLite / DuckDB files | native file connectors |
| Google Sheets, BigQuery, Snowflake | later, via their Node SDKs |

Cross-cutting: credential manager (OS keychain via Electron `safeStorage`), data source settings dialog, privacy levels,
connection test, query folding for SQL sources, incremental refresh (RangeStart/RangeEnd), refresh schedule while the app
is open, and optional DirectQuery-style live mode for SQL sources.

Hosting the mock lakehouses: keep them as folders (local disk or a TrueNAS share) read directly by the Lakehouse
connector; optionally publish them to Postgres/DuckDB for SQL access, or upload to Fabric/OneLake for the real thing.
