# Render sweep

The sweep renders **every page** of a report in the real app (hidden, tooltip and drill-through pages
included), captures a PNG per page, and records a status for each visual. Its job is to find everything
that renders wrong, route each problem to the lane that owns it, and track the fixes. This file is the
triage log. It is written in neutral terms: the private PBIP corpus is called C01…C19, and its report,
table and measure names never appear here.

## How to run

To compare the renders with Power BI itself (a screenshot or an Export-to-PDF), use `scripts/compare.sh`, which
builds on the sweep: see [COMPARE.md](COMPARE.md).

```bash
npm run build                                          # sweep.sh rebuilds by itself when src/ is newer than out/
scripts/sweep.sh <file-or-folder> <outdir> [--sample-data] [--pages 1,3] [--size 1800x1200] [--no-build]
node scripts/sweep-summary.mjs <outdir> [--cards] [--all] [--json]
```

* `<file-or-folder>` is a `.pbix` / `.pbit` / `.pbip` / `.wbi` file, a `*.Report` folder, or a folder
  searched to depth 4 for `.pbix` / `.pbit` / `.wbi` files and `*.Report` folders (a PBIP project is found through
  its `*.Report` folder; `.pbip` files themselves are not searched for). Each report runs in its own Electron process
  on a private Xvfb display.
* Output: `<outdir>/<report>/NN-<page>.png`, `report.json` (rewritten after each page; per page `pngPage` gives
  the page origin and pixels per page unit inside the PNG), `console.log`
  (renderer console), `electron.log` (Electron's own stdout / stderr) and `<outdir>/summary.tsv` (one line per report).
* `--sample-data` fills tables that have no data with synthetic rows (`src/core/data/synthetic.ts`). Use it
  for PBIP projects without a data cache. The sweep reuses every literal of the definitions, including names
  and ids that filters or formulas mention, so visuals pinned to them render. Add `--private` to use the app's
  default instead (`identifyingLiterals: 'never'`, the app's default seed and fact-table size): those literals are
  never copied into the data; filters and saved slicer selections pinned to them read a generated stand-in
  (`src/core/data/standIns.ts`), formulas that compare to them stay blank. `--app-defaults` uses the app's seed and
  fact-table size but reuses the literals (compare it with `--private` to count what privacy costs).
* **`WBI_BLOCK_CACHE=1` is always set.** The main process passes `--wbi-block-cache` to the renderer, and the
  preload exposes `__LUMEN_BLOCK_CACHE_ABF__ = true`, so `openProject` never decodes a PBIP `.pbi/cache.abf`.
  The renderer refuses to open anything if the guard is missing (`report.json` → `cacheBlocked`).
  `scripts/capture.sh` sets the same flag by default. Code: `src/shared/cacheGuard.ts` (+ tests in
  `src/shared/__tests__/cacheGuard.test.ts`).
* `--selections` adds a **selection audit** (`src/renderer/src/app/sweep/selectionAudit.ts`): on each page, every
  slicer that offers items (list, dropdown, tile, button, hierarchy; not range / relative / text slicers) gets a
  deterministic sample of its items picked, one at a time, on top of the page's saved state (the slicer's saved
  selection replaced, every other slicer kept): all items when there are 8 or fewer, otherwise first, middle, last and
  3 pseudo-random ones (seed = the app's sample-data seed). Every data-bound visual is queried again with the engine
  probe; a visual that returned rows under the saved state and none under the selection is *emptied*. Capped at 60
  selections and 60 s per page (`capped`). Results: `report.json` → `pages[].selections` (counts, the emptied visuals
  per selection, first 40 trials) and `selectionTotals`; `summary.tsv` → `selections`, `sel_emptied` (selection × visual
  pairs) and `sel_emptied_selections`; `sweep-summary.mjs` lists each emptying selection. Use it with
  `--sample-data --private` to measure whether sample data stays populated under the report's own selections.
* `WBI_TIMEOUT` (ms) bounds each report (default 15 min). `WBI_USE_DESKTOP=1` shows the window on your desktop.

### What the in-app sweep does (`src/renderer/src/app/sweep/`)

Route `#/?sweep=<outdir>&open=<path>[&synthetic=1][&blockCache=1][&pages=…]`. The main process runs with
`WBI_SWEEP=1`: the window is kept alive, the renderer console goes to `WBI_SWEEP_LOG`, and on Xvfb the window is
shown inactive. A hidden window stops painting, which makes `capturePage` return stale frames.

1. Hold `holdBusy('sweep')` (see `app/readiness.ts`), `openPath()` the project, and wait until the store's busy
   state clears, so the whole open flow, data decoding included, is finished.
2. Optionally generate synthetic data, then switch to reading view, close the panes and hide toasts.
3. For each page: activate it, zoom to 100% (or fit when it's larger), wait for canvas readiness
   (`wbiReady`), then wait until no visual says "Loading…" and the DOM has been stable for 3 polls. Then
   capture the page rectangle with `window.wbi.exporter.capturePng`.
4. Each visual is classified from the DOM as `ok`, `blank` (a card showing "(Blank)"), `noitems` (a slicer that
   offers nothing to pick: its item count `items` is taken with the slicer's own loaders under the live filter
   context, `app/sweep/slicerItems.ts`; `summary.tsv` has a trailing `noitems` column), `error` (error boundary /
   "Can't display the visual" / "Something's wrong with one or more fields" + message), `nodata`,
   `loading-stuck`, `unsupported` (placeholder), `empty` (no text and no marks; text inside same-origin
   iframes counts), `hidden` or `not-rendered`. The record also keeps its visible text
   (card values, totals), its rectangle from the definition (`rect`, page units, group offsets applied; `z`)
   and an **engine probe** (`probe.ts`): the visual's fields are run against the
   engine under the live filter context, recording query time, engine warnings, errors and grand totals.

### Fast regression (no Electron)

`src/renderer/src/app/sweep/__tests__/samples.test.ts`:

* `LUMEN_SAMPLES_DIR=…/pbix-samples npx vitest run src/renderer/src/app/sweep`: opens each Microsoft
  sample, probes every visual (query builds and runs, no engine errors), and checks **published values**
  (see the oracle below). About 30 s.
* `LUMEN_CORPUS_DIR=… npx vitest run src/renderer/src/app/sweep`: PBIP corpus + synthetic data. It checks
  that every report opens and that at most 25% of data-bound visuals fail or return nothing.
  `LUMEN_SWEEP_DUMP=<dir>` writes per-report probe JSON for triage. `LUMEN_SWEEP_TRACE=1` logs each
  visual as it is probed, which helps find slow queries.

### Accuracy oracle (Microsoft Learn "Take a tour of the … sample" pages)

| Sample | Published value | Lumen |
|---|---|---|
| Store Sales | This Year Sales **$22.05M** | 22,051,952 ✓ |
| Retail Analysis | **104** stores, **10** new | 104 / 10 ✓ |
| Customer Profitability | GM **42.5%**, **80** customers, **5** products (Industry Margin page); Team Scorecard **83** / **7** | ✓ all |
| Procurement Analysis | Discount % **4.23 %**, Discount Savings **$4,068,848** (Discount Analysis screenshot) | ✓ both |
| Supplier Quality | **33 million** defects, **77,000** downtime minutes | 32,983,053 / 76,607 ✓ |

Not usable as an oracle: the Procurement text says "Mexico City 11.05%, Atlanta 0.08%", but those figures
were taken under a selection; overall Lumen gets 9.06% / 0.07%. Regional Sales and Competitive Marketing
have no published figures.

## Status summary

"OK" means the visual rendered without an error, "No data" or unsupported placeholder, and it isn't stuck
loading. "Broken" counts error + nodata + loading-stuck + unsupported. Hidden (bookmark-toggled) visuals are
not counted. Rendered-but-wrong problems are listed per page below.

| Report | Pages | First sweep (OK / visible) | Latest (OK / visible) |
|---|---|---|---|
| Competitive Marketing Analysis | 5 | 45 / 45 | 45 / 45 |
| Customer Profitability | 4 | 31 / 31 | 31 / 31 |
| Procurement Analysis | 3 | 15 / 15 | 15 / 15 |
| Regional Sales | 11 | 271 / 295 (22 "No data", 1 unsupported) | 294 / 295 (Q&A field error, see below) |
| Retail Analysis | 4 | 24 / 24 | 24 / 24 |
| Store Sales | 5 | 34 / 34 | 34 / 34 |
| Supplier Quality | 5 | 26 / 26 | 26 / 26 |

The corpus table is further down.

## Triage: Microsoft samples (real data)

Lanes: **charts**, **tables** (tables/cards/slicers/elements/custom), **canvas**, **dax** (engine/format/report),
**io** (unowned, small fixes), **sweep** (this lane: harness + synthetic data).
Status: ✅ fixed · 🔶 open (reported to the lane) · ℹ️ not a bug / approximation.

### Store Sales
| Page | Issue | Lane | Status |
|---|---|---|---|
| Overview | Map "This Year Sales by PostalCode": stuck "Loading map…", then "100 not located" with no bubbles | charts | ✅ (postal-code geocoding + basemap) |
| Overview | Scatter "Sales Per Sq Ft…" showed "No data available" | charts | ✅ |
| Overview | Combo "Total Sales Variance by FiscalMonth…" sorted by value (Mar, Aug, Jun…). No sortDefinition is saved, so PBI keeps month order | charts | ✅ |
| Overview | Card "This Year Sales" now "$22M"; the published value is "$22.05M" (it was right before) | tables | 🔶 regression |
| Overview | Pie data labels truncated ("$6.39M (28.9…") | charts | ✅ |
| New Stores | Matrix row-header column far too narrow ("Fashions Di…") | tables | 🔶 |
| New Stores | Gauge has no callout value ($2.43M) | charts | 🔶 |
| (model) | `ClusterMappingTable 2` uses KMEANSCLUSTERING (PBI clustering), which isn't supported | dax | ℹ️ |
| — | Readiness: capture fired mid-load | canvas + sweep | ✅ (open flow holds busy; sweep waits for the store; hidden windows return **stale frames**, so the sweep shows its Xvfb window, see below) |

### Retail Analysis
| Page | Issue | Lane | Status |
|---|---|---|---|
| all | Built-in theme "Concourse" missing, so blue instead of teal/gray | dax (theme) | ✅ |
| all | Oldest legacy layout `singleVisual.title/background` dropped: chart titles became auto titles and the slicer lost "District Manager" | io (`pbir/legacy.ts`) | ✅ (sweep lane) |
| Overview, District Monthly, New Stores | Category sort by value instead of month / name order (no sortDefinition) | charts | ✅ |
| District Monthly | Scatter legend "(Blank)", single color | charts | ✅ |
| District Monthly | "Total Sales Variance % by FiscalMonth": scrollbar with 8 categories, extra legend, axis "50 %" | charts | ✅ |
| District Monthly | "This Year Sales by StoreNumberName": axis to $800K for ~$100K visible bars (check whether an off-screen store reaches it; PBI's axis follows the visible window) | charts | 🔶 |
| District Monthly | Title textbox wraps onto two lines | tables | ✅ |
| District Monthly | Slicer items truncated ("Annelie Zub…") | tables | 🔶 |

### Customer Profitability
| Page | Issue | Lane | Status |
|---|---|---|---|
| Team / Industry / Executive | `_RevenueTY Status` (KPI status measure) didn't resolve | dax | ✅ |
| Team / Industry / Executive | The KPI-status card shows "1" + "_RevenueTY Status"; PBI shows a status icon | tables | 🔶 |
| Team Scorecard | "RevenueTY and Revenue Var % to Budget by Month" sorted by value (Nov, Jun, Mar…) | charts | ✅ |

### Procurement Analysis
| Page | Issue | Lane | Status |
|---|---|---|---|
| Spend Overview / Discount Analysis | `Vendor[Tier]` calc column failed (COUNTROWS), so "Total Invoice by Tier" showed (Blank) | dax | ✅ (stored calc-column values kept on open) |
| Discount Analysis | Combo sorted by value instead of month order | charts | ✅ |
| Discount Analysis | Area chart with 12 months shows a horizontal scrollbar | charts | ✅ |
| Spend Overview | City map placed a single bubble per country | charts | ✅ |

### Regional Sales
| Page | Issue | Lane | Status |
|---|---|---|---|
| Sales Overview, Win/Loss, Trend Analytics… | 22 visuals "No data": calc columns (RELATIVE MONTH, TODAY()-based) were recomputed on open | dax | ✅ (PBI keeps stored values until refresh) |
| Sales Overview | Textbox with a dynamic value renders "[object Object]" | tables | ✅ |
| Sales Overview | What-if parameter slicer renders as a list instead of PBI's single-value slider | tables | 🔶 |
| Win/Loss Ratio Overview | Custom visual FlowVisual (Sankey) unsupported placeholder | tables (custom) | ✅ (renders now) |
| Industries Overview | Scatter query 7 s, pivot 3.5 s | dax (perf) | 🔶 |
| Q&A Query | qnaVisual saved fields reference a column that isn't in the model. Lumen now shows "Something's wrong with one or more fields"; PBI would re-run the question | canvas | ℹ️ |

### Competitive Marketing Analysis
| Page | Issue | Lane | Status |
|---|---|---|---|
| Executive Overview, Top 10 Regions | multiRowCard rows clipped vertically | tables | ✅ |
| Executive Overview, Top 10 Regions | Card display units inconsistent ("$15K" next to "$1,338"; PBI ≈ "$14.68K") | tables | 🔶 regression |
| Executive Overview | "Total Sales by Product and Channel" (Series = Channel): legend starts with "(Blank)" and bars aren't split by channel (single pink color from a dataPoint selector) | charts | 🔶 |
| Executive Overview | "Total Sales by Channel Over Time": both Category projections `active` (expand all → Channel › Months) and Series = Channel; Lumen shows Channel only with legend "(Blank)" | charts | 🔶 (expand-all axis ✅; series coloring still "(Blank)") |
| all pages (hidden visuals) | `% Units Market Share R12M` by month takes 25–42 s per query | dax (perf) | 🔶 |

### Supplier Quality
| Page | Issue | Lane | Status |
|---|---|---|---|
| Supplier Quality | `_Total Defect Qty Status` KPI measure unresolved | dax | ✅ (red status dots render) |
| Supplier Quality | Table columns overflow the visual ("56,010,95" cut) | tables | 🔶 |

## Triage: PBIP corpus (no data → synthetic sample data)

These 19 PBIP projects (PBIR + TMDL) are private and are referred to as C01–C19 only. Each run uses
`--sample-data`, so numbers are synthetic. What matters is that every visual renders and that measures
return plausible values. `blank` means a card shows "(Blank)". The blank icon-holder cards in four reports are
intentional: the measure is `BLANK()` and the cards hold icons.

| Report | Pages | First sweep (OK / visible) | Latest (OK / visible) | Notes |
|---|---|---|---|---|
| C01 | 6 | 125 / 125 | 125 / 125 | ratio KPIs were > 100% (fixed: sweep, ratio implications) |
| C02 | 4 | 69 / 70 | 70 / 70 | trend chart "No data" (fixed: sweep, week-end dates); one what-if card blank (synthetic coverage, open) |
| C03 | 6 | 117 / 117 | 117 / 117 | |
| C04 | 3 | 52 / 55 | 55 / 55 | 3 "No data" (fixed: sweep, engine-derived date tables + week-end weekday) |
| C05 | 6 | 115 / 115 | 115 / 115 | |
| C06 | 3 | 63 / 64 | 64 / 64 | trailing-12-month combo "No data" (fixed: same as C04) |
| C07 | 5 | 86 / 86 | 86 / 86 | |
| C08 | 1 | 0 / 0 | 0 / 0 | the report has one empty page ℹ️ |
| C09 | 7 | 22 / 22 | 22 / 22 | pivot / table queries 25–33 s (dax perf, open) |
| C10 | 6 | 10 / 10 | 9 / 10 | a visual uses a measure missing from the referenced model; Lumen now shows PBI's "Something's wrong with one or more fields" ✅ (canvas) |
| C11 | 4 | 103 / 103 | 103 / 103 | |
| C12 | 4 | 103 / 103 | 103 / 103 | |
| C13 | 4 | 62 / 62 | 62 / 62 | two field-parameter tables reference tables that aren't in the model ℹ️ |
| C14 | 4 | 103 / 103 | 103 / 103 | |
| C15 | 9 | 225 / 226 | 225 / 226 | DATEDIFF in row context failed (✅ dax); one bar chart needs a single-item selection (measure guards on SELECTEDVALUE) ℹ️ |
| C16 | 5 | 57 / 57 | 57 / 57 | |
| C17 | 12 | 232 / 232 | 232 / 232 | LOOKUPVALUE calc column failed on duplicate synthetic keys (fixed: sweep); 2 cards blank (cross-table correlation not modelled) |
| C18 | 33 → 44 | 153 / 161, **renderer hang** on page 34 | 186 / 186 | 100k-group matrix froze the app (✅ tables data reduction); per-group measure cost (dax perf, open) |
| C19 | 5 | — | 86 / 86 | |

Cross-cutting corpus items:

| Issue | Lane | Status |
|---|---|---|
| Hidden windows stop painting, so `capturePage` returned stale frames (wrong zoom, an old loading overlay) | sweep / canvas | ✅ sweep shows its window on Xvfb + `backgroundThrottling: false`; reported for capture mode |
| HTML Content (custom) visuals counted as empty: they render into srcdoc iframes | sweep | ✅ classifier reads same-origin iframes |
| Synthetic data: engine-derived calculated tables (auto date/time) reused as key domains when the engine was built before generating (the app order), giving year-3799 calendars | sweep | ✅ + regression test |
| Synthetic data: LOOKUPVALUE search columns must be unique on dimensions | sweep | ✅ |
| Synthetic data: `DIVIDE(part, whole)` over filtered counts on one table, so part ⊆ whole (ratios ≤ 100%) | sweep | ✅ |
| Synthetic data: week-end columns (`*_eow`, `week_end*`) follow the weekday of mined literals; week dimensions list consecutive week ends | sweep | ✅ |
| cardVisual: reference-label line overlaps the category label | tables | 🔶 |
| Value axis ignored a self-scaling measure format (`$#,##0,,.0M`) when display units = None | charts | ✅ |
| `DATEDIFF(…, DAY)` failed in row context (calc columns, iterators) | dax | ✅ |
| Table visual with ~54 columns: "would produce 3e20 group combinations" | dax | 🔶 |

Known synthetic-data gaps (documented in `src/core/data/synthetic.ts`): cross-table value correlations
(e.g. a fact's date matching another fact's date for the same person) aren't modelled, so measures that
reconcile two facts row by row stay blank. Measures anchored on "recent N weeks of data" depend on
how the trend is shaped.

## Re-running

Re-run after other lanes land fixes (always rebuild first; `sweep.sh` does it when `src/` is newer):

```bash
npm run build
scripts/sweep.sh /path/to/pbix-samples /tmp/sweep-ms
LUMEN_CORPUS_DIR=… scripts/sweep.sh "$LUMEN_CORPUS_DIR" /tmp/sweep-corpus --sample-data
node scripts/sweep-summary.mjs /tmp/sweep-ms --cards
LUMEN_SAMPLES_DIR=/path/to/pbix-samples npx vitest run src/renderer/src/app/sweep
```

Triage tips: `--pages 3` re-renders one page. `--dax 'EVALUATE …'` runs a query inside the app after
loading (results go to `report.json` → `dax`), which is how app-vs-test data differences are found.
For visuals that come out `nodata`, `blank` or `error`, `report.json` keeps their live filter context
(`filters`). `inProgress` names the page a hung renderer was stuck on.
