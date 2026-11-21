# Lumen

**Power BI reports, models and data — on Linux.**

Lumen is a desktop workbench that opens real Power BI files and lets you view, edit, model, query, refresh and export
them with a Power BI Desktop look and feel. It is a personal, open-source project for building and showcasing Power BI
work on Linux — not a Power BI replacement and not affiliated with Microsoft.

## What it does

- **Opens real files** — `.pbix` (including the embedded VertiPaq data model, decoded in pure TypeScript), `.pbit`,
  PBIP projects (PBIR report + TMDL semantic model), legacy report layouts, and Lumen's own `.wbi` bundles.
  Saves as PBIP (designed to write untouched files back byte for byte) or `.wbi` (PBIP + cached data); it cannot
  write `.pbix` or `.pbit`.
- **DAX engine** — a columnar engine with filter context, context transition, relationships (incl. bidirectional and
  many-to-many), calculation groups, field parameters, time intelligence, window functions, visual calculations,
  user-defined functions, dynamic format strings and DAX queries (`EVALUATE`, `DEFINE`).
- **Power Query (M) engine** — 472 of the 660 functions in Microsoft's M list, Applied Steps, query folding, and a
  Power Query Editor.
- **Connectors** — files (CSV, Excel, JSON, XML, Parquet), Delta tables and lakehouse folders, SQL Server / Azure SQL /
  Fabric warehouses (Entra ID sign-in), PostgreSQL, MySQL, SQLite, Firestore, S3-compatible storage (AWS, MinIO,
  TrueNAS…), network shares (SMB/NFS), REST/GraphQL/OData with OAuth — with an encrypted credential store and
  incremental refresh.
- **Visuals** — the built-in Power BI visual types (charts, maps, tables, matrices, cards, slicers, KPI, gauge,
  decomposition tree, key influencers, Q&A, Narrative, shapes, buttons, navigators) plus the HTML Content, Deneb
  (Vega/Vega-Lite) and Power Automate custom visuals, rendered from the report's PBIR formatting and theme. R and
  Python script visuals, Metrics, Paginated report and other custom visuals show a placeholder; see
  [visual support](docs/reference/visual-support.md).
- **Report authoring** — canvas editing with equal-spacing and match-size snapping, layout guides, format painter,
  conditional formatting (fx) dialogs, filters/visualizations/format/data/selection/bookmarks/sync-slicers panes,
  drill, drill-through, tooltip pages, bookmarks, mobile layout, themes, built-in icons and a performance analyzer.
- **Modeling** — Table, Model (diagram) and DAX query views, a formula bar with autocomplete, parameter hints and
  hover help, relationships, roles (RLS; **View as** does not filter yet), calculation groups, parameters, quick
  measures and renames that update references.
- **Export** — PDF, PowerPoint, PNG (1×–3×), static HTML, and CSV/Excel for any visual's data.
- **Sample data** — schema-driven synthetic data for reports whose sources aren't reachable, and seven fictional
  lakehouse datasets (see [`datasets/`](datasets/README.md)).

## Documentation

The full documentation is in [`docs/`](docs/README.md), written for report creators, analysts and developers:

- [Get started](docs/get-started/README.md): what Lumen is, installing it, a first report.
- [Create reports](docs/create-reports/README.md) and [Visuals](docs/visuals/README.md): building and formatting report pages.
- [Connect and transform data](docs/connect-and-transform/README.md), [Model data](docs/model-data/README.md) and
  [DAX](docs/dax/README.md).
- [Files and compatibility](docs/files-and-compatibility/README.md): PBIX, PBIP, `.wbi`, round-tripping with Power BI Desktop.
- [Developer guide](docs/developer/README.md): architecture, engines, tests and tooling.
- [Troubleshooting](docs/troubleshooting/README.md) and [reference tables](docs/reference/README.md).

PDF editions of every section are in [`docs/pdf/`](docs/pdf/README.md) (regenerate with `scripts/docs/build-pdf.sh`).

## Getting started

Requires Node.js 20.19 or later on Linux (developed on Node 24, Linux Mint / Cinnamon).

```bash
npm install
npm run dev                         # run with live reload
npm run build && npm start          # run a production build
scripts/install-desktop.sh --pin    # app menu entry, .pbix/.pbit/.pbip/.wbi file associations, panel pin (Cinnamon)
npm run dist                        # AppImage + .deb in dist/
```

### Windows

Requires Node.js 20.19 or later (`winget install OpenJS.NodeJS.LTS`) and Git. In PowerShell:

```powershell
git clone https://github.com/inzodious/lumen-bi.git
cd lumen-bi
npm ci
npm run dev                         # run with live reload
npm run build; npm start            # run a production build
npm run dist:win                    # dist\Lumen-Setup-<version>.exe and dist\Lumen-<version>-portable.exe
```

Every CI run also builds both executables: open the latest run of the **CI** workflow under the repository's Actions
tab and download the `Lumen-windows-x64` artifact. The builds are unsigned, so SmartScreen asks once ("More info" ▸
"Run anyway"). The Linux shell scripts under `scripts/` (capture, sweep, compare, desktop integration) are not
available on Windows. See [Build and packaging](docs/developer/build-and-packaging.md).

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

Lumen approximates some Power BI behaviors (documented in the code and in each article's "Differences from Power BI
Desktop" section): AI visuals (key influencers, Narrative, Q&A, anomaly detection) use statistics and templates
instead of Microsoft's AI services, and the Insert ribbon's smart narrative button is disabled; map basemaps and
geocoding are offline approximations; `.pbix` files can be read but not written (the DataModel format is proprietary);
there is no publishing to the Power BI service. Opening a project saved by Lumen in Power BI Desktop is designed to
work but has not been verified. See [Coming from Power BI Desktop](docs/get-started/coming-from-power-bi-desktop.md).

## License

MIT — see [LICENSE](LICENSE). Third-party components and their licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Power BI is a trademark of Microsoft Corporation; Lumen is not affiliated with or endorsed by Microsoft.
