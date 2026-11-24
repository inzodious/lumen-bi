# Lumen — Architecture

Lumen is a Linux desktop app (Electron + React + TypeScript) that opens real Power BI
artifacts — `.pbix`, `.pbit`, PBIP projects (`*.Report` PBIR + `*.SemanticModel` TMDL) — and lets
you view, edit, model, query and export them with a Power BI Desktop look and feel.

```
┌──────────── Electron main (src/main) ─────────────┐   ┌──────────── Renderer (src/renderer/src) ─────────────┐
│ window (frameless), menu accelerators, dialogs     │   │ app/      title bar, ribbon, backstage, view switcher │
│ ipc/fs.ts          filesystem                      │◄─►│ panes/    Data, Visualizations+Format, Filters,      │
│ ipc/connectors*    SQL Server, HTTP + connectors/* │IPC│           Selection, Bookmarks, Sync slicers         │
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
| `src/core/report/props.ts` | formatting property resolution (visual `objects` / `visualContainerObjects` → theme `visualStyles[type]['*']` → `visualStyles['*']['*']` (also the `'*'` object wildcard) → renderer default), `setObjectProp` |
| `src/core/report/entries.ts` | **which objects-bag entry a property write goes to** — the one rule for every writer (Format pane `setRaw`, conditional formatting, icons, `setObjectProp`): `{ id: 'default' }` ≡ no selector, writes go to the first entry of the selector's group (the one readers use) |
| `src/core/report/theme.ts` | theme merge (base CY24SU10 + custom), theme colors, shading |
| `src/core/dax/tabular/` | production DAX engine (columnar, dictionary-encoded); `src/core/dax/*.ts` is the vendored Parity engine kept as a reference/oracle (still used by the `#/modeling-test` harness, `views/dev/devEngine.ts`, and by gallery mock engines for number formatting) |
| `src/core/engine/api.ts` | `QueryEngine` — `summarize`, `distinctValues`, `evaluateScalar`, `runDaxQuery`, `validateExpression`, `format`, `processCalculated`, `describeField`, `resolveFieldParameter` |
| `src/core/io/fs.ts` | async `FileSystem` (Node impl `nodefs.ts`; renderer uses `window.wbi.fs`) |
| `src/core/io/open.ts` | `openProject(path, fs)` / `saveProject(project, path, fs, {format})` |
| `src/core/data/refresh.ts` | `refreshProject(project, host)` |
| `src/core/data/synthetic.ts` | `generateSyntheticData(project)` |
| `src/core/project.ts` | `ProjectDocument` = model + data + report + diagnostics |
| `src/shared/host.ts` | `window.wbi` bridge (fs, dialogs, app, window, connectors, exporter) |
| `src/renderer/src/visuals/contract.ts` | `VisualDefinition`, `VisualProps`, `VisualHostContext` (filters, selection, drill, tooltips, actions) |
| `src/renderer/src/visuals/common/query.ts` | visual field wells → `engine.summarize` |
| `src/renderer/src/state/store.ts` | zustand document store: project, engine, view, page, selection, undo/redo (`mutateReport`, `mutateModel`, `mutateModelSidecars`; non-undoable `patchReport`, `patchModelSidecar`) |

Changing a contract: additive changes are fine (new optional fields/methods). Breaking changes must
be coordinated — note them prominently in your final report.

## Key semantics

* **Filters are SQ filters everywhere.** Report/page/visual filters (`filterConfig.filters[].filter`),
  slicer selections, cross-filter selections (`identitiesToFilter`), drill-through and drill-down
  filters are all PBIR SQ filter JSON. The report canvas collects the applicable ones for each visual
  into `ctx.filters`; the engine applies them as CALCULATE filter context.
* **Slicer items** = `engine.distinctValues`: Power BI's slicer query (SUMMARIZECOLUMNS of the column without a
  measure), so slicers on two dimensions that share a fact do not filter each other; a visual-level measure filter
  on the slicer keeps only items with data. `existsInFacts` is an opt-in "has data" approximation for small multiples.
* **Visual data** = `engine.summarize` with SUMMARIZECOLUMNS semantics (auto-exist, drop rows whose
  values are all blank unless "show items with no data"). Totals/subtotals = extra summarize calls with fewer group-bys.
* **Field parameters**: projections pointing at a parameter column are expanded with `engine.resolveFieldParameter`.
* **Calculation groups**: filters on a calc-group column apply the calc item to measures (SELECTEDMEASURE).
* **Formatting**: always resolve via `props.ts` so theme `visualStyles` defaults apply exactly like Power BI.
* **Format pane defaults**: an unset property shows the value the visual draws with (`panes/visualizations/effective.ts`),
  never a copy of it. Visuals whose formatting is resolved by pure functions implement `VisualDefinition.formatDefaults`;
  the pane runs it under `props.ts` `recordFallbacks` and shows the fallback each reader passed (a second run with the
  Visual-tab switches on covers properties read only behind a switch). Charts use `panes/visualizations/chartDefaults.ts`,
  built on the renderers' exported constants. `effectiveDefaults.test.tsx` renders every gallery fixture with an empty
  format definition while recording the fallbacks and fails when a control shows anything else. A reader that resolves a
  default outside `getProp` (e.g. `optStr(...) ?? x`) is invisible to both — pass the default as the fallback instead.
* **Edits run on immer drafts**: every `mutateReport` / `mutateModel` / `patchReport` / `mutateModelSidecars` mutator
  receives Proxies. Deep-copy state only with `cloneDeep` (`src/core/clone.ts`), never `structuredClone` or a JSON
  round-trip (`clone.test.ts` greps `src/` for them). A mutator that throws changes nothing and is reported once by the
  store (`reportMutationError`: error toast naming the action); callers don't catch. `report/__tests__/draftAudit.test.ts`
  runs every exported edit operation on a draft and fails on a new export until it is exercised or classified.
* **Saving**: PBIR JSON round-trips (edits are immer copy-on-write recipes over the JSON as read, `autoFreeze` off; untouched files are written back unchanged). TMDL is regenerated from `SemanticModel`
  (with preserved `extra`/annotations). PBIX can't be written (proprietary DataModel); "Save" of a PBIX
  offers Save As PBIP or `.wbi` (Lumen bundle = PBIP + cached data).

## Data when the source isn't reachable

Most real models import from Fabric SQL endpoints. Order of preference when opening:
1. Data embedded in the file (PBIX DataModel, PBIP `.pbi/cache.abf`, `.wbi` bundle).
2. Refresh from source (M engine; SQL Server via tedious with Entra ID (device code, Azure CLI, interactive browser, "default" = the Azure CLI login else device code, or a raw token) or a SQL login — Windows authentication is refused on Linux; files; web; the connectors below).
3. Synthetic data generated from the schema (keys consistent across relationships — also through
   calculated tables that combine imported ones, `data/synthetic-lineage.ts` —, value domains mined from
   DAX/filter literals so measures produce non-empty results, survey scores skewed like real ones). Each literal's
   use (operator, polarity, measure / filter / test) decides its share (`data/synthetic-conditions.ts`,
   `SyntheticResult.decisions`): a flag only measures filter on holds for every row, sentinels stay rare.
   Only definitions are read; literals compared to name-like / id-like / free-text columns are never copied
   into the data (`SyntheticOptions.identifyingLiterals`, Options ▸ Data load); filters and saved slicer selections
   pinned to such a literal read a generated stand-in in memory (`data/standIns.ts`, `DataStore.literalStandIns`;
   slicers show a "Sample stand-in" notice). Facts are dense where the report is sliced (`data/synthetic-slices.ts`
   mines slicer / filter-card / grouping fields, `data/synthetic-coverage.ts` lays out coverage rows): every member of
   a sliced dimension has rows in every period of the report's date-slicer grain, periodic snapshots list every entity
   on every snapshot day, within a row budget (`SyntheticResult.coverage` says what was covered). "Regenerate sample data"
   (status-bar badge, Data pane menu, command search) draws a new seed for the sample tables; a `.wbi`
   bundle keeps the generated rows.

## Subsystems added in phase 2

| Area | Where | Notes |
|---|---|---|
| Production DAX engine | `src/core/dax/tabular/` | columnar, dictionary-encoded; grouped scans, fused aggregations, measure caching, compiled row path; `queryBudgetMs` (default 15 s) returns partial results instead of hanging |
| Visual calculations | `src/core/engine` + `visuals/common/visualCalcs.ts` | PBIR `NativeVisualCalculation` projections evaluated over the visual's result lattice |
| Connectors | `src/main/ipc/connectors/*` (Node side), `src/core/m/lib/{connectors,delta,sqldialect,fold}.ts` | PostgreSQL, MySQL, SQLite, DuckDB, Firestore, S3, SQL Server/Fabric, Delta/lakehouse folders, network shares, REST/OAuth; credentials encrypted with `safeStorage` in the main process (never sent to the renderer) |
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
| Table / matrix column sizing | `visuals/tables/{widths,columnWidths}.ts`, `visuals/tables/LayoutCard.tsx` | Layout ▸ Column width: `columnHeaders.columnAdjustment` (fit to content / grow to fit / fixed width), `defaultColumnWidth`, custom widths = `columnWidth` entries (`metadata` selector; matrix column headers / totals: `data` scope selectors); header-edge drag, double-click fit, Set / Reset column width |
| Expand / collapse state | `visuals/common/expansion.ts` | PBIR `expansionStates` (per-level `isCollapsed` + `isToggled` nodes, `active` projections kept in step) for matrix Rows / Columns and hierarchy slicers; +/- icons and the context menu's Expand ▸ / Collapse ▸ (Selection · Entire level · All) |
| Visual context menu | `report/Overlays.tsx` (`buildVisualMenu`) | one menu for PBI's right-click and "More options" entries; a visual adds its own entries for what was clicked through `ContextMenuRequest.entries` (`target`, `value`, `selectionText`) |
| Built-in icons | `core/icons/*`, `renderer/src/icons/*` | React components of Lucide (`react-icons/lu`) and Fluent Color (`@fluentui/react-icons` `*Color`), lazily loaded per set; a picture of each icon (the component's SVG output) stored in PBIR as an image + `Lumen_Icon` visual annotation; see [ICONS.md](ICONS.md) |
| Report templates + gallery | `core/templates/*` (PBIP projects + generated `catalog.ts`), `app/templates.ts`, `app/TemplateGallery.tsx`, `scripts/templates/*` | each template is a PBIP project with no data tables: the model holds `_measures_kpi` and `_measures_format`, every visual is empty and draws its designed sample (below); generated from `scripts/templates/designs/*.mjs` by `build.mjs`, thumbnails by `previews.sh`; `compatibility: 'powerbi' \| 'lumen'` is tested (`templates.test.ts`: Power BI compatible ones use no `Lumen_Style` and no bundled-only fonts) |
| Container effects (`Lumen_Style`) | `core/report/lumenStyle.ts`, applied in `report/VisualContainer.tsx` | Lumen-only frosted glass / gradient / glow / rotation from the visual annotation `Lumen_Style` (sanitised: hex colors, clamped numbers); rotation turns the box only, the selection frame stays upright; Power BI ignores the annotation |
| Color options (solid / gradient / fx) | `core/report/gradientFill.ts`, `props.ts` (`gradientOf`, `PropContext.fills`), `app/ui/{ColorPicker,GradientEditor}.tsx`, `visuals/common/svgPaint.tsx`, `report/gradientPaint.ts`, `report/boundColors.ts` | Every color row's picker has Solid, Gradient and fx Conditional. Gradient: the property keeps a solid fallback unique within the visual and theme (PBIR/PBIX open in Power BI with no export rewrite); the gradient lives in the owner's `Lumen_Fill` annotation and applies only while the property holds the fallback. Renderers may draw it directly (`gradientCss`, `SvgGradientDef`/`svgPaintRef`); otherwise the visual container's paint pass (`GradientPainter`) swaps the fallback color for the gradient in the rendered SVG fills/strokes, HTML backgrounds and text. fx: per-point colors are the visuals' own; every other bound color is evaluated once per visual (`resolveBoundColors`) before rendering |
| Sample data on empty visuals | `core/sample/*` (`spec.ts` annotations, `dataset.ts` sample dataset, `generic.ts`, `measureTables.ts`), `report/sampleData.ts`, `report/sampleActions.ts` | report.json `Lumen_SampleData` = on/off; a visual with no projections draws a sample: the query in its own `Lumen_SampleData` annotation against `sampleData.lumen.json` (a `SemanticModel` sidecar, built into a separate engine, never the report's model), else a generic query from its type and title. The sample draws with `sampleContext` (own engine, no filters, no selection, no writes), so it never reaches the model, the field wells or Power BI. View ▸ Sample data, context menu Clear / Show sample data. New reports get both measure tables and sample data on |
| Model diagram: editable lines + table groups | `views/model/*` (`routing.ts`, `snapping.ts`, `groups.ts`, `diagramOps.ts`, `EdgeLayer.tsx`, `GroupBox.tsx`), `core/io/diagramSidecar.ts` | Lumen-only diagram data in `diagramLayout.lumen.json`; edits go through `mutateModelSidecars` (undoable, no engine rebuild); see "Model diagram sidecar" below |
| Live dashboards | `examples/dashboards/*` (PBIP projects), `scripts/dashboards/*` (`build.mjs`, `model.mjs`, `designs/*.mjs`) | the Orbital, Contour and Aurora templates built out on mock star schemas: rows embedded as Power BI "Enter data" queries, a Power Query calendar, measures in `_measures_kpi` / `_measures_format`, visuals bound for real (`setLiveQueries` in `scripts/templates/lib.mjs`); the report half is shared with the template build (`scripts/templates/pbir.mjs`); `examples/dashboards/dashboards.test.ts` refreshes each and probes every visual |
| Animations and page transitions (`Lumen_Motion`) | `core/report/motion.ts` (settings on report / page / visual annotations, families, reading order, publish summary / strip), `report/motion/*` (`animator.ts` MutationObserver + Web Animations per visual, `pageTransition.ts`, `countText.ts`, `env.ts`), `visuals/common/motionMarks.ts`, `panes/visualizations/MotionCards.tsx`, `shared/still.ts` | renderers tag data marks with `data-wbi-mark` (grow-up/down/left/right/center, reveal, sweep, pop, label, count); a visual's animator acts only while armed: `enter` on mount, `update` after filters / highlights / query / engine change (geometry morphs from `attributeOldValue`), never on formatting edits or resizes. Only Web Animations (count-up rewrites text and ends on the visual's own), so nothing is left in the DOM. Off in headless runs (`--lumen-still`), with `motion=off` in the URL, under reduced motion, in print / export / tooltip canvases (`CanvasEnv.motion` absent); page transitions play in reading view only; push / depth / wipe / circle / morph, drill-through zoom and Back move a still clone of the old page captured by a `useApp` subscription before React commits (`installPageSnapshots`), laid in `.wbi-viewport` as `.wbi-transition-ghost` and removed when it ends; bookmark morph captures the page in `applyBookmark` (`beforeBookmark`) and settles in a PageCanvas layout effect. Publish keeps them (option `motion`, manifest `motion`); the HTML export plays page transitions; Power BI keeps and ignores the annotation |
| Publishing dashboards | `core/publish/*` (bundle, column usage), `renderer/src/viewer/*` + `src/renderer/viewer/index.html` (built by `viewer.vite.config.ts` into `out/viewer`), `renderer/src/publish/*` (dialog, `publishReport`), `main/ipc/publish/*` (site assembly, folder / zip, saved destinations `destinations.ts`, hosted targets `targets/*`: GitHub Pages via the Git Data API, Netlify zip deploys, Cloudflare Pages Direct Upload with BLAKE3 asset keys `blake3.ts`, S3 via `@aws-sdk/client-s3`, Lumen Server `targets/lumenServer.ts`), `server/*` (Lumen Server: self-hosted Node server with no dependencies, token upload API, listing, per-dashboard passwords, Docker image) | a published site = the viewer + `report.wbi` (trimmed copy: unused columns blank, M queries replaced) + `lumen-publish.json`; the viewer runs the reading view in a plain browser with a `window.wbi` stand-in (`viewer/browserHost.ts`); `npm run build` builds both; see docs/create-reports/publish-a-dashboard.md |

## Model diagram sidecar (`diagramLayout.lumen.json`)

Power BI's `diagramLayout.json` (card positions/sizes per layout tab) is read and written as-is. Everything Lumen adds to
the Model view lives in a **separate file beside it** in the `*.SemanticModel` folder — `diagramLayout.lumen.json` — which
travels in `SemanticModel.sidecarFiles` like every other unmodelled file, so it is saved in PBIP folders and inside `.wbi`
bundles and restored on open. Power BI Desktop does not read it. It is written only once a diagram was customised and is
**removed again when nothing custom is left** (`serializeLumenLayout` returns null; `saveProject` deletes a stale file), so
an untouched model round-trips byte-identically and a project without the file behaves as before.

```jsonc
{
  "$lumen": "diagramLayout",
  "version": 1,
  "diagrams": [                                   // one entry per layout tab, matched to diagramLayout.json by name
    {
      "name": "All tables",
      "lineStyle": "straight",                    // layout default: curved | orthogonal | straight (omitted = the user's preferred default, else curved)
      "routes": {
        "<relationship name>": {
          "style": "orthogonal",                  // per-relationship override
          "waypoints": [{ "x": 320, "y": 180 }],  // pinch points, diagram coordinates, from-table → to-table
          "from": { "side": "right", "t": 0.5 },  // manual attachment on the from / to card: side + position along it
          "to": { "side": "left", "t": 0.25 }     //   (0 = top/left … 1 = bottom/right); omitted = automatic
        }
      },
      "groups": [
        { "id": "g1", "name": "Dimensions", "color": "blue",          // gray (default, omitted) blue teal green amber rose purple
          "tables": [{ "name": "Date", "lineageTag": "…" }],
          "collapsed": true,                                           // omitted = expanded
          "bounds": { "x": 0, "y": 0, "width": 600, "height": 400 } }  // only after a manual resize; never smaller than the members
      ]
    }
  ]
}
```

* **Code**: `src/core/io/diagramSidecar.ts` (pure TS) — parse / `migrateLumenLayout` (version 0 = pre-release shape with
  diagrams keyed by name; a higher version is read best-effort and its number kept) / serialize, unknown properties
  preserved at every level.
* **Stale references**: read-time `resolveLumenDiagram` ignores routes of missing relationships and matches group members
  by table name, then lineage tag (a rename made outside Lumen is followed); `pruneLumenDiagram` drops them on the next
  write. In-app edits are followed immediately: `mutateModel` runs `withReconciledSidecars(prev, next)`, which renames
  group members / re-keys routes and removes entries of deleted tables and relationships **in the same undo step**.
* **Undo**: Model view edits (card moves, routing, groups, layout tabs) use `useApp.mutateModelSidecars(label, files => …)`:
  one snapshot per edit, several sidecar files changed together, no engine rebuild (undo/redo of a layout-only step
  recognises that only `sidecarFiles` differ).
* **When cards move**: line ends follow their cards (automatic ends re-pick the facing side); pinch points stay where the
  user put them, unless both tables of the relationship move together (multi-selection or group drag), then they travel
  along. Lines to a collapsed group's chip are routed automatically; their stored routing returns on expand.
* **Collapsed groups**: lines to a collapsed group's chip stay editable — their pinch points and style are the
  relationship's own route (so they survive collapse / expand); only a manual end on a hidden card is ignored while
  the chip stands in for it. Lines sharing a side of the chip are spread along it (`routing.spreadAlongSide`).
* **Discoverability**: hovering a line shows a halo, a grab cursor, a "+" marker under the pointer and a status line;
  a selected line is repeated faintly above the cards with a grab area there, "+" handles in the middle of each
  stretch (`routing.segmentMidpoints`) and its square end handles. The toolbar's "?" lists every gesture.
* **Auto arrange** (`views/model/arrange.ts`, pure TS): classifies tables (fact / dimension / bridge; loose tables
  as measure / parameter / calculation group / date / calculated), lays out each connected component as a star or
  in layers (barycentre ordering + constrained centring, wide rows wrapped) or packs a compact grid; table groups
  are arranged as units; loose tables go in a block at the right. One undo step (`commit` with all card positions);
  pinch points and manual ends of moved lines are cleared (`routing.routeAfterArrange`), group extents refit.
  A diagram without stored positions (`diagramLayout.json`) is first laid out with the suggested arrangement.
* **Formula bar**: Model view mounts it itself, floating over the top of the canvas (`.wbi-mv__fbar`); the toolbar
  moves below it through `--wbi-mv-top`. Report and Table view keep the shell's in-flow formula bar.
* **Per-user preferences** (not in the file): `views/model/diagramPrefs.ts` (localStorage) — preferred default line style
  for layouts that store none, pointer mode, snapping.

## Dev workflow

* `npm run dev` — run the app with HMR (strips `ELECTRON_RUN_AS_NODE`, which VS Code terminals set).
* `npm test` / `npx vitest run src/core/dax` — unit tests (vitest, Node).
* `npm run typecheck` — whole-project tsc.
* `npm run build && scripts/capture.sh /abs/out.png '#/route' [/path/to/open] [WxH]` — headless render to PNG on a private
  Xvfb display (+ `out.png.log` with renderer console). Capture waits for `wbiReady === '1'` and `wbiBusy !== '1'`.
  Route params (App.tsx): `sample=1`, `template=<id>`, `page=<n|name>`, `panes=`, `select=`, `dialog=`, `cmd=`, `formula=`, `data=sample`, `export=`…
* `scripts/sweep.sh <file-or-folder> <outdir> [--sample-data] [--pages …]` — render every page; `node scripts/sweep-summary.mjs <outdir>`.
* `scripts/install-desktop.sh [--pin|--uninstall]` — app menu entry, file associations, Cinnamon panel pin.

### Test layers and environment variables

| Env var | Enables |
|---|---|
| *(none)* | unit + integration tests (≈3,000 in ≈210 files), all offline |
| `LUMEN_SAMPLES_DIR=<dir of .pbix>` | real-data regression on Microsoft's public sample PBIX files (published-value oracle, every visual's query, perf budget) |
| `LUMEN_PERF_STRICT=1` | strict 300 ms per-visual budget (run the samples file alone) |
| `LUMEN_CORPUS_DIR=<dir of PBIP reports>` | parse/round-trip/evaluate a private corpus of real PBIP projects (assertions are generic; no corpus content in the repo) |
| `LUMEN_IT=1` | live connector tests against Docker containers (Postgres, MySQL, MinIO, Firestore emulator; the MinIO and Firestore suites run only when their images are already pulled) |
| `WBI_PERF=1` | the 1-million-row summarize performance test |

The complete list (verbose and dump switches included) is in [reference/command-line-and-environment.md](reference/command-line-and-environment.md); `node scripts/docs/check-env-vars.mjs` checks it against the code. `npm run typecheck` does not cover `e2e/` (it has its own `e2e/tsconfig.json`).

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
| `LUMEN_E2E_SHOTS` | folder for screenshots of key states (`icons.e2e.ts`, `model.e2e.ts`) |
| `CI` | when set, the `default` vitest reporter instead of `verbose` |
