# Lumen

**Power BI reports, models and data — on Linux.**

Lumen is a desktop workbench that opens real Power BI files and lets you view, edit, model, query, refresh and export
them with a Power BI Desktop look and feel. It is a personal, open-source project for building and showcasing Power BI
work on Linux — not a Power BI replacement and not affiliated with Microsoft.

## What it does

- **Opens real files** — `.pbix` (including the embedded VertiPaq data model, decoded in pure TypeScript), `.pbit`,
  PBIP projects (PBIR report + TMDL semantic model), legacy report layouts, and Lumen's own `.wbi` bundles.
  Saves as PBIP (byte-identical round-trips for untouched files) or `.wbi` (PBIP + cached data).
- **DAX engine** — a columnar engine with filter context, context transition, relationships (incl. bidirectional and
  many-to-many), calculation groups, field parameters, time intelligence, window functions, visual calculations,
  user-defined functions, dynamic format strings and DAX queries (`EVALUATE`, `DEFINE`).
- **Power Query (M) engine** — 500+ library functions, Applied Steps, query folding, and a Power Query Editor.
- **Connectors** — files (CSV, Excel, JSON, XML, Parquet), Delta tables and lakehouse folders, SQL Server / Azure SQL /
  Fabric warehouses (Entra ID sign-in), PostgreSQL, MySQL, SQLite, Firestore, S3-compatible storage (AWS, MinIO,
  TrueNAS…), network shares (SMB/NFS), REST/GraphQL/OData with OAuth — with an encrypted credential store and
  incremental refresh.
- **Visuals** — every built-in Power BI visual type (charts, maps, tables, matrices, cards, slicers, KPI, gauge,
  decomposition tree, key influencers, Q&A, smart narrative, shapes, buttons, navigators) plus the HTML Content and
  Deneb (Vega/Vega-Lite) custom visuals, rendered from the report's PBIR formatting and theme.
- **Report authoring** — canvas editing with equal-spacing and match-size snapping, layout guides, format painter,
  conditional formatting (fx) dialogs, filters/visualizations/format/data/selection/bookmarks/sync-slicers panes,
  drill, drill-through, tooltips pages, bookmarks, mobile layout, themes and a performance analyzer.
- **Modeling** — Table, Model (diagram) and DAX query views, a formula bar with IntelliSense (fuzzy Tab completion,
  snippets, signature help, live value preview), relationships, roles (RLS) and "view as", calculation groups,
  parameters, quick measures and rename refactoring.
- **Export** — PDF, PowerPoint, PNG (1×–3×), static HTML, and CSV/Excel for any visual's data.
- **Sample data** — schema-driven synthetic data for reports whose sources aren't reachable, and seven fictional
  lakehouse datasets (see [`datasets/`](datasets/README.md)).

## Documentation

The full documentation is in [`docs/`](docs/README.md), written for report creators, analysts and developers:

- [Get started](docs/get-started/README.md): what Lumen is, installing it, a first report.
- [Files and compatibility](docs/files-and-compatibility/README.md): PBIX, PBIP, `.wbi`, round-tripping with Power BI Desktop.
- [Developer guide](docs/developer/README.md): architecture, engines, tests and tooling.
- [Troubleshooting](docs/troubleshooting/README.md) and [reference tables](docs/reference/README.md).

PDF editions of every section are in [`docs/pdf/`](docs/pdf/README.md) (regenerate with `scripts/docs/build-pdf.sh`).

## Getting started

Requires Node.js 22+ on Linux (developed on Node 24, Linux Mint / Cinnamon).

```bash
npm install
npm run dev                         # run with live reload
npm run build && npm start          # run a production build
scripts/install-desktop.sh --pin    # app menu entry, .pbix/.pbit/.pbip/.wbi file associations, panel pin (Cinnamon)
npm run dist                        # AppImage + .deb in release/
```

## Development

```bash
npm test                    # unit + integration tests (vitest)
npm run typecheck
LUMEN_IT=1 npx vitest run src/main/ipc/connectors   # live connector tests (needs Docker)
LUMEN_SAMPLES_DIR=<folder of .pbix files> npx vitest run src/renderer/src/app/sweep   # sample-file regression
scripts/capture.sh /abs/out.png '#/?sample=1' [file] [WxH]   # headless screenshot (private Xvfb display)
scripts/sweep.sh <file-or-folder> <outdir> [--sample-data]   # render every page of reports, with a triage summary
```

Architecture and contracts: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Limitations

Lumen approximates some Power BI behaviors (documented in code where they apply): AI visuals (key influencers,
anomaly detection) use statistical stand-ins; map basemaps are offline approximations; `.pbix` files can be read but
not written (the DataModel format is proprietary); there is no publishing to the Power BI service.

## License

MIT — see [LICENSE](LICENSE). Third-party components and their licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Power BI is a trademark of Microsoft Corporation; Lumen is not affiliated with or endorsed by Microsoft.
