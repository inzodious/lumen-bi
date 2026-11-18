# Lumen — Architecture

Lumen is a Linux desktop app (Electron + React + TypeScript) that opens real Power BI
artifacts — `.pbix`, `.pbit`, PBIP projects (`*.Report` PBIR + `*.SemanticModel` TMDL) — and lets
you view, edit, model, query and export them with a Power BI Desktop look and feel.

```
┌──────────── Electron main (src/main) ─────────────┐   ┌──────────── Renderer (src/renderer/src) ─────────────┐
│ window (frameless), menu accelerators, dialogs     │   │ app/      title bar, ribbon, backstage, view switcher │
│ ipc/fs.ts          filesystem                      │◄─►│ panes/    Data, Visualizations+Format, Filters,      │
│ ipc/connectors.ts  SQL (tedious+Entra ID), HTTP    │IPC│           Selection, Bookmarks, Sync slicers         │
│ export: printToPDF, capturePage                    │   │ report/   canvas, visual container chrome, interactions│
│ headless capture mode (WBI_CAPTURE)                │   │ visuals/  one module per visualType (registry)        │
└────────────────────────────────────────────────────┘   │ views/    data, model, dax query, powerquery           │
            preload (src/preload) exposes window.wbi     │ state/    store.ts (document), interaction.ts (runtime)│
            typed by src/shared/host.ts                  └──────────────────────┬───────────────────────────────┘
                                                                                │ pure TS, no DOM/Node
                                   ┌────────────────────────────────────────────▼───────────────────────────────┐
                                   │ src/core                                                                    │
                                   │  model/   SemanticModel types, DataStore (columnar)                         │
                                   │  report/  PBIR doc types, SQ expressions/filters, literals, props, theme    │
                                   │  dax/tabular/  production columnar DAX engine (dax/ = vendored reference) │
                                   │  engine/  QueryEngine API + adapter (summarize, distinctValues, DAX query)  │
                                   │  m/       Power Query M interpreter (vendored from Parity, extended)        │
                                   │  data/    refresh orchestration, synthetic data, samples                    │
                                   │  io/      open/save: TMDL, model.bim, PBIR, PBIP, PBIX/PBIT, .wbi bundle    │
                                   │  io/pbix/datamodel/  XPress9 → ABF → VertiPaq + metadata.sqlitedb           │
                                   └─────────────────────────────────────────────────────────────────────────────┘
```

## Contracts (read these first — they are the integration surface)

| File | What |
|---|---|
| `src/core/model/types.ts` | `SemanticModel` — tables, columns, measures, hierarchies, partitions, calc groups, relationships, expressions, roles |
| `src/core/model/data.ts` | `DataStore`/`TableData`/`Scalar` — **value representation contract** (dates = JS Date with UTC fields = naive wall clock; blank = null) |
| `src/core/report/types.ts` | `ReportDocument` — PBIR JSON kept as-is (report.json, page.json, visual.json, bookmarks, resources) |
| `src/core/report/sq.ts` | SQ field expressions + filters, `fieldInfo`, `fieldKey`, `DataPointIdentity`, `identitiesToFilter` |
| `src/core/report/literal.ts` | PBIR literal encode/decode (`'text'`, `12L`, `1.5D`, `datetime'…'`) |
| `src/core/report/props.ts` | formatting property resolution (visual objects → theme visualStyles → default), `setObjectProp` |
| `src/core/report/theme.ts` | theme merge (base CY24SU10 + custom), theme colors, shading |
| `src/core/dax/tabular/` | production DAX engine (columnar, dictionary-encoded); `src/core/dax/*.ts` is the vendored Parity engine kept as a reference/oracle |
| `src/core/engine/api.ts` | `QueryEngine` — `summarize`, `distinctValues`, `evaluateScalar`, `runDaxQuery`, `validateExpression`, `format`, `processCalculated`, `describeField`, `resolveFieldParameter` |
| `src/core/io/fs.ts` | async `FileSystem` (Node impl `nodefs.ts`; renderer uses `window.wbi.fs`) |
| `src/core/io/open.ts` | `openProject(path, fs)` / `saveProject(project, path, fs, {format})` |
| `src/core/data/refresh.ts` | `refreshProject(project, host)` |
| `src/core/data/synthetic.ts` | `generateSyntheticData(project)` |
| `src/core/project.ts` | `ProjectDocument` = model + data + report + diagnostics |
| `src/shared/host.ts` | `window.wbi` bridge (fs, dialogs, app, window, connectors, exporter) |
| `src/renderer/src/visuals/contract.ts` | `VisualDefinition`, `VisualProps`, `VisualHostContext` (filters, selection, drill, tooltips, actions) |
| `src/renderer/src/visuals/common/query.ts` | visual field wells → `engine.summarize` |
| `src/renderer/src/state/store.ts` | zustand document store: project, engine, view, page, selection, undo/redo |

Changing a contract: additive changes are fine (new optional fields/methods). Breaking changes must
be coordinated — note them prominently in your final report.

## Key semantics

* **Filters are SQ filters everywhere.** Report/page/visual filters (`filterConfig.filters[].filter`),
  slicer selections, cross-filter selections (`identitiesToFilter`), drill-through and drill-down
  filters are all PBIR SQ filter JSON. The report canvas collects the applicable ones for each visual
  into `ctx.filters`; the engine applies them as CALCULATE filter context.
* **Visual data** = `engine.summarize` with SUMMARIZECOLUMNS semantics (auto-exist, drop rows whose
  values are all blank unless "show items with no data"). Totals/subtotals = extra summarize calls with fewer group-bys.
* **Field parameters**: projections pointing at a parameter column are expanded with `engine.resolveFieldParameter`.
* **Calculation groups**: filters on a calc-group column apply the calc item to measures (SELECTEDMEASURE).
* **Formatting**: always resolve via `props.ts` so theme `visualStyles` defaults apply exactly like Power BI.
* **Saving**: PBIR JSON round-trips (we mutate it in place). TMDL is regenerated from `SemanticModel`
  (with preserved `extra`/annotations). PBIX can't be written (proprietary DataModel); "Save" of a PBIX
  offers Save As PBIP or `.wbi` (Lumen bundle = PBIP + cached data).

## Data when the source isn't reachable

Most real models import from Fabric SQL endpoints. Order of preference when opening:
1. Data embedded in the file (PBIX DataModel, PBIP `.pbi/cache.abf`, `.wbi` bundle).
2. Refresh from source (M engine; SQL via tedious + Entra ID device-code/CLI auth; files; web).
3. Synthetic data generated from the schema (keys consistent across relationships, value domains
   mined from DAX/filters literals so measures produce non-empty results).

## Subsystems added in phase 2

| Area | Where | Notes |
|---|---|---|
| Production DAX engine | `src/core/dax/tabular/` | columnar, dictionary-encoded; grouped scans, fused aggregations, measure caching, compiled row path; `queryBudgetMs` (default 15 s) returns partial results instead of hanging |
| Visual calculations | `src/core/engine` + `visuals/common/visualCalcs.ts` | PBIR `NativeVisualCalculation` projections evaluated over the visual's result lattice |
| Connectors | `src/main/ipc/connectors/*` (Node side), `src/core/m/lib/{connectors,delta,sqldialect,fold}.ts` | PostgreSQL, MySQL, SQLite, Firestore, S3, SQL Server/Fabric, Delta/lakehouse folders, network shares, REST/OAuth; credentials encrypted with `safeStorage` in the main process (never sent to the renderer) |
| Data windowing | `visuals/tables/windowQuery.ts` | tables/matrices query 500-row windows (PBI data reduction); totals come from their own queries |
| Readiness | `src/renderer/src/app/readiness.ts` | ref-counted busy tracker → `body.dataset.wbiBusy` / `wbiReady`, used by headless capture and the sweep |
| Cache guard | `src/shared/cacheGuard.ts`, `tests/setup.ts` | `WBI_BLOCK_CACHE=1` (app) / always in tests: PBIP `.pbi/cache.abf` files are never decoded |
| Sweep | `src/renderer/src/app/sweep/*`, `scripts/sweep.sh`, `scripts/sweep-summary.mjs`, `docs/SWEEP.md` | renders every page of a report set, per-visual status JSON + PNGs; engine-level regression oracle in `app/sweep/__tests__` |
| Snapping & layout | `report/geometry.ts`, `report/prefs.ts` | equal spacing, match size, margins/gutters, tidy up, distribute with gap |
| Conditional formatting | `panes/visualizations/cf/*`, `report/containerCF.ts`, `visuals/common/conditionalFormatting.ts` | fx dialogs write exact PBIR FillRule / Conditional / field-value shapes |

## Subsystems added in phase 3

| Area | Where | Notes |
|---|---|---|
| End-to-end UI suite | `e2e/*`, `app/e2eHooks.ts`, `LUMEN_E2E` in `src/main/index.ts` | see "End-to-end UI journeys" below |
| Hover visual headers | `report/VisualContainer.tsx` (`PlacedHeader`), `.wbi-vh-layer` in `report/PageCanvas.tsx` | rendered in a canvas overlay above the visual's top edge (PBI placement), never covering the visual's own controls |
| Per-report layout guides | `report/layoutGuides.ts` | margin/gutter in report.json `objects.lumenLayout`, written only when non-default (untouched reports save byte-identically) |
| Mobile-only formatting | `report/mobile/format.ts`, Format pane in mobile layout | edits `mobile.json` objects (object-level override seeded from desktop); "Reset to desktop formatting" |
| Page visuals for summaries | `report/host.ts` (`usePageVisualFilters`, `pageVisualInfos`) | `ReportInfo.pageVisuals` with each visual's effective filters, only for page-summary visuals (narrative) |
| Bookmark highlights | `report/bookmarks.ts` | `DecomposedSelectors` (compressed HighlightState.selection) decoded/encoded per the bookmark schema; raw value kept on save |

## Dev workflow

* `npm run dev` — run the app with HMR (strips `ELECTRON_RUN_AS_NODE`, which VS Code terminals set).
* `npm test` / `npx vitest run src/core/dax` — unit tests (vitest, Node).
* `npm run typecheck` — whole-project tsc.
* `npm run build && scripts/capture.sh /abs/out.png '#/route' [/path/to/open] [WxH]` — headless render to PNG on a private
  Xvfb display (+ `out.png.log` with renderer console). Capture waits for `wbiReady === '1'` and `wbiBusy !== '1'`.
  Route params (App.tsx): `sample=1`, `page=<n|name>`, `panes=`, `select=`, `dialog=`, `cmd=`, `formula=`, `data=sample`, `export=`…
* `scripts/sweep.sh <file-or-folder> <outdir> [--sample-data] [--pages …]` — render every page; `node scripts/sweep-summary.mjs <outdir>`.
* `scripts/install-desktop.sh [--pin|--uninstall]` — app menu entry, file associations, Cinnamon panel pin.

### Test layers and environment variables

| Env var | Enables |
|---|---|
| *(none)* | unit + integration tests (≈2,200), all offline |
| `LUMEN_SAMPLES_DIR=<dir of .pbix>` | real-data regression on Microsoft's public sample PBIX files (published-value oracle, every visual's query, perf budget) |
| `LUMEN_PERF_STRICT=1` | strict 300 ms per-visual budget (run the samples file alone) |
| `LUMEN_CORPUS_DIR=<dir of PBIP reports>` | parse/round-trip/evaluate a private corpus of real PBIP projects (assertions are generic; no corpus content in the repo) |
| `LUMEN_IT=1` | live connector tests against Docker containers (Postgres, MySQL, MinIO, Firestore emulator) |

### End-to-end UI journeys (`e2e/`)

`e2e/run.sh [--no-build] [vitest filter]` builds the app into `out/e2e/` (so a concurrent `npm run build` can't swap the
renderer assets under a running test) and runs `e2e/*.e2e.ts` with vitest (`e2e/vitest.config.ts`, 3 files in parallel,
`LUMEN_E2E_WORKERS`) under `xvfb-run`. Each file launches one Electron instance through Playwright's `_electron` driver
(`e2e/harness.ts` → `useLumen()`), with:

* `LUMEN_E2E=1` (src/main): throwaway profile (`LUMEN_USER_DATA`), window shown inactive, painting while unfocused, close never prompts;
* route option `e2e=1` (app/e2eHooks.ts): `window.__lumen` exposes the stores (`useApp`, `useShell`, `useInteraction`), `openPath`,
  `saveAs`, `exportReport` and the renderer's console errors — for observation and for setup steps that are not under test;
* native Open/Save dialogs stubbed in the main process (`stubSaveDialog`, `stubOpenDialog`).

Journeys drive the real UI (clicks, typing, HTML5 drag-and-drop, pointer drags) and wait on `body[data-wbi-ready|busy]`,
DOM conditions or store state — no fixed sleeps. On failure a screenshot + renderer error log land in `$LUMEN_E2E_OUT`.

| Env var | Effect |
|---|---|
| `LUMEN_SAMPLES_DIR` | enables journeys on Microsoft's public sample PBIX files (Store Sales cross-filtering) |
| `LUMEN_E2E_OUT` | where failure artifacts and per-run scratch files (saves, exports, generated lakehouse) go |
| `LUMEN_E2E_WORKERS` | parallel app instances (default 3; `1` runs files serially) |
| `LUMEN_E2E_APP` | built main entry to launch (default `out/e2e/main/index.js`) |
| `LUMEN_E2E_USE_DISPLAY` | use the current `DISPLAY` instead of a private Xvfb (watch the journeys run) |
