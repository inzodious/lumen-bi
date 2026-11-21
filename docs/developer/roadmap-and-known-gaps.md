# Roadmap and known gaps

> **Applies to:** Developers

This article collects what Lumen does not do, what it approximates, and the open ideas recorded in
[BACKLOG.md](../BACKLOG.md). It is a map for contributors looking for work and a caution list for anyone relying on
Lumen's output. It makes no promises and gives no dates: an item here may never be built.

## Out of scope today

| Area | State |
|---|---|
| Writing `.pbix` | Not possible: the embedded DataModel format is proprietary. A `.pbix` is saved as PBIP or `.wbi`. |
| Power BI service | No publishing, no workspaces, no scheduled refresh in the service. The ribbon's **Publish** button is disabled. |
| DirectQuery and live connections | Not implemented. The model keeps a partition's `directQuery` mode and **Get data** offers a DirectQuery option, but such tables import no rows: visuals over them show no data until the table is switched to Import and refreshed. |
| Platforms | Linux only. No Windows or macOS builds. |
| Distributable packages | None today: `npm run dist` fails at electron-builder's configuration check (see [Build and packaging](build-and-packaging.md#distributable-packages)). |
| Compatibility with Power BI Desktop | Saved files are designed to open in Power BI Desktop, but this has not been tested (no Windows machine in the project). |

## Approximations stated in the code

The code states each approximation where it happens (see [Conventions](conventions.md#approximations-are-declared-never-silent)).
List them with:

```bash
grep -rn "pproximation" src --include='*.ts' --include='*.tsx' | grep -v test
```

The main groups:

- **AI and language visuals.** Key influencers uses per-field statistical tests instead of Power BI's model and says
  so in the visual (`visuals/charts/misc/keyInfluencers/`). The decomposition tree offers AI splits for every measure
  (`decompositionTree.tsx`). Q&A uses a small rule-based grammar (`visuals/elements/qna/parse.ts`). Smart narrative
  narrates the category only, not legend or small-multiple splits (`charts/misc/narrative/collect.ts`).
- **Undocumented Power BI defaults.** Where Microsoft does not publish a value (new card spacing and column split,
  table row padding and column widths, scatter bubble sizes, button slicer encodings, icon set tints, line label
  "Auto" position), Lumen uses the closest observed look and records the evidence in
  [VISUAL_DEFAULTS.md](../VISUAL_DEFAULTS.md).
- **Fonts.** Segoe UI is not redistributable; Selawik and the derived "Lumen Sans Semibold" stand in for it
  (`assets/fonts/selawik/`). Text measures close to, not exactly like, Power BI.
- **Totals over windows.** Some table and matrix figures are computed over the loaded window of rows rather than the
  whole result (`visuals/tables/tableModel.ts`, `matrixQuery.ts`).
- **Power Query.** Column profiles and merge match counts use the preview rows (up to 1,000), not the full data
  (`views/powerquery/logic/profile.ts`, `dialogs/CombineDialogs.tsx`). "Include in report refresh" is shown but not
  stored. `Xml.Tables` infers its shape by its own rules (`core/m/lib/sources.ts`).
- **Performance analyzer.** Durations are split into Lumen's own categories, because the engine runs in the renderer
  (`report/perf.ts`). See [Performance](performance.md).
- **Mobile layout.** The phone canvas geometry and some layering rules are approximations (`report/mobile/`).
- **Sample data.** Generated rows are fiction; calculated date tables are not evaluated by the generator, and
  measures that compare a column to a withheld literal stay blank (`core/data/synthetic.ts`, `standIns.ts`). See
  [Data layer](data-layer.md).
- **Maps.** Basemaps are offline approximations; there is no tile service.

## Known defects

These were found while writing this documentation and are not fixed at the time of writing. Each has the file to
start from.

| Area | What happens | Where to look |
|---|---|---|
| Saving | A saved report's `report.json` fails Microsoft's published schema: `themeCollection.baseTheme` lacks `reportVersionAtImport`. | `emptyReport` in `src/core/report/types.ts`, the sample report, `pbirToFiles` for legacy layouts |
| Saving | A saved PBIP has no base theme file in its resources; reopening shows "Theme 'CY24SU10' not found in the report resources" (the report still renders with the bundled theme). | `src/core/io/open.ts`, `src/core/pbir/` |
| Saving | Saving a model opened from a `model.bim` file targets `model.bim.pbip` and creates a new `.SemanticModel` folder. | `saveTarget()` in `src/renderer/src/app/commands.ts` |
| Saving | A PBIP save always names the model folder after the report, so a report whose model folder has another name gets a duplicate model. | `saveProject()` in `src/core/io/open.ts` |
| Connectors | Cancelling a refresh does not stop PostgreSQL, MySQL, SQLite, DuckDB, Firestore or S3 requests in the main process; their results are discarded. SQL Server and HTTP requests do stop. | `conn:request` in `src/main/ipc/connectors.ts`, `src/core/data/fetcher.ts` |
| Packaging | `npm run dist` fails: electron-builder 26 rejects `build.linux.desktop` in `package.json`. | `package.json` |
| Format pane | Numbers are written as double literals (`3D`) even for properties Power BI writes as integers (`3L`). | `wrapFor()` in `src/renderer/src/panes/visualizations/PropEditor.tsx` |
| Conditional formatting | A visual that offers a fill colour but does not evaluate conditional formatting gets an **fx** button without the "not previewed" warning. | `cfRendered()` in `panes/visualizations/cf/target.ts` |
| Capture | Captures of the developer routes (`#/gallery`, `#/canvas-test`, `#/modeling-test`) always wait for the full timeout: the launch busy hold is never released there. | `holdBusy('launch')` in `src/renderer/src/app/App.tsx` |
| Type checking | `e2e/` is outside `npm run typecheck`, and `e2e/chrome.e2e.ts` has type errors that nothing reports. | `e2e/tsconfig.json` |
| Compare | When page detection is one pixel off, scores on an identical reference exceed the stated noise floor. | `scripts/compare-lib.mjs` (`findCanvas`) |

## Ideas recorded in the backlog

[BACKLOG.md](../BACKLOG.md) keeps the longer list, written as requests; some of its items are partly built, so
check the code before you start one. Open themes there include:

- **Canvas and formatting**: further sizing and snapping helpers and a richer dropdown slicer (select-all, chips,
  date presets).
- **Transitions and animations**: animated visuals when data loads or filters change, and optional page transitions
  (a Lumen extension, since Power BI Desktop has none), off under reduced motion and in exports.
- **Model view follow-ups**: obstacle-aware routing of relationship lines, nested table groups, renaming layout tabs,
  arrow-key nudging, persistent card collapse state.
- **Connectors**: Azure Blob, ADLS Gen2 and OneLake; Google Sheets, BigQuery and Snowflake; privacy levels in full;
  refresh on a schedule while the app is open; a DirectQuery-style live mode for SQL sources.

Gaps noted in the code rather than in the backlog:

- **Engine threading**: the engines run on the renderer's main thread; `src/core` is kept free of DOM and Node APIs
  so that it could move to a worker.
- **Engine rebuilds**: any data change rebuilds the whole engine (`dataChanged` in `state/store.ts`).

## Related content

- [BACKLOG.md](../BACKLOG.md)
- [Contributing](contributing.md)
- [Fidelity workflow](fidelity-workflow.md)
- [Saving and round-trip](saving-and-round-trip.md)
- [Connectors](connectors.md)
