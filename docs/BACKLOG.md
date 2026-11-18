# Lumen backlog

Items the user has raised for after the initial build. "Discuss" = agree the design with the user before building.

## In progress
- **Formula bar everywhere + better-than-PBI DAX IntelliSense** — formula bar in Report view on measure select / New measure;
  Tab-to-accept with fuzzy ranking (`CALC` → `CALCULATE(`), auto-indent, signature help, hover docs, snippets,
  format-on-demand/commit, live value preview, quick fixes. (modeling-views workstream)

## Discuss: canvas & formatting
- **Smarter sizing and snapping** — snap to *equal spacing* (Figma-style distance guides, e.g. keep the gaps between KPI
  cards identical), match-size guides (same width/height as a neighbour), margin/gutter presets for the page, distribute
  with a fixed gap, "tidy up" grid for a row of cards, keyboard resize, numeric position/size in the format pane.
- **More slicer dropdown options** — richer dropdown slicer (search, select-all, single/multi toggle, chips for
  selections, hierarchy in dropdown, date presets), plus whatever else the user lists.
- General improvements list (to be collected with the user).

## Planned: Model view (diagram) improvements
- **Editable relationship lines** — curved (Bézier) routing as an option, drag a line to reshape it, add/remove
  **pinch points** (waypoints) by clicking/double-clicking the line, snap waypoints to the grid; persist the routing
  per layout (Lumen-namespaced data next to `diagramLayout.json`, so Power BI ignores it and untouched models stay
  byte-identical).
- **Table groups ("containers")** — select several table cards and group them into a labeled, highlighted gray
  container (rename, recolor, collapse/expand, move as one, nest tables in/out by dragging); also persisted per layout.

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
