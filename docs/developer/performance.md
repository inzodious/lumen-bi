# Performance

> **Applies to:** Developers

This article explains how Lumen measures performance: the Performance analyzer pane that report authors see, how
its timings are produced inside the renderer, the query budget that keeps the app responsive, and the tests that
guard the engine's speed. Read it when you investigate a slow visual or change the engine or the canvas.

## The Performance analyzer pane

Open it with **View > Performance analyzer** or **Optimize > Performance analyzer**. **Start recording** begins a
log; **Refresh visuals** reloads every visual on the page and records each one; **Stop**, **Clear** and **Export**
work as in Power BI Desktop. **Optimize > Start recording** starts a recording while the pane is closed.

![The Performance analyzer pane beside the sample report's Overview page: Start recording, Refresh visuals and Stop on the first row, Clear and Export on the second, then a "Recording started" line, a "Refreshed visual" group and one row per visual with its duration in milliseconds.](../images/developer/performance-analyzer-pane.png)

Each row expands into **DAX query**, **Visual display** and **Other**, with a **Copy query** button for visuals that
queried data. Rows are grouped under the user action that caused them (**Refreshed visual**, **Changed a slicer**,
**Cross-highlighted**, **Drilled**, **Changed page**, **Drilled through**, **Selected a bookmark**,
**Changed a visual**). Clicking **Name** or **Duration (ms)** sorts the visuals into a flat list; a third click
returns to action order.

For a headless capture with a recording already running, use the route options `panes=performance&perf=1` (see
[Debugging](debugging.md#capture-a-screenshot-headlessly)).

### Where the code is

| File | Role |
|---|---|
| `src/renderer/src/report/perf.ts` | metering, the timing split, user actions, row model, JSON export (pure functions, tested in `report/__tests__/perf.test.ts` and `perfDescribe.test.ts`) |
| `src/renderer/src/panes/performance/tracking.ts` | watches the stores and names the user action for the next timings |
| `src/renderer/src/panes/performance/PerformancePane.tsx` | the pane |
| `src/renderer/src/app/shellState.ts` | `perfRecording`, `perfLog` (the last 500 entries), `logPerf` |
| `src/renderer/src/report/VisualContainer.tsx` | calls `useVisualPerf` and places the `<PerfMark>` pair around each visual |

### How a duration is measured and split

Each visual's host context receives a metered engine: `meteredEngine(engine, meter, enabled)` wraps the
`QueryEngine` in a `Proxy` that times the query methods (`summarize`, `distinctValues`, `evaluateScalar`,
`runDaxQuery`, `resolveFieldParameter`, `evaluateVisualCalculations`) and remembers up to 20 requests. Two
`<PerfMark>` components, rendered immediately before and after the visual, time the render of its component tree.
`useVisualPerf` logs one entry per (re)load of a visual, from the render that received a new host context or
definition to the next paint; all visuals that loaded together share one paint timestamp.

`splitTimings` turns the wall-clock duration into the three categories:

```ts
export function splitTimings(total: number, meter: Pick<PerfMeter, 'queryMs' | 'renderMs' | 'renderQueryMs'> | undefined): PerfSplit {
  const ms = Math.max(0, total)
  const query = Math.min(ms, Math.max(0, meter?.queryMs ?? 0))
  const render = Math.min(ms - query, Math.max(0, (meter?.renderMs ?? 0) - Math.min(meter?.renderQueryMs ?? 0, meter?.queryMs ?? 0)))
  return { ms, query, render, other: Math.max(0, ms - query - render) }
}
```

- **DAX query**: time inside the engine calls the visual made.
- **Visual display**: render time of the visual's own component tree, minus the query time spent inside that
  render (queries run synchronously while rendering).
- **Other**: the rest until the next paint: waiting for the other visuals of the page (they share one React
  commit), layout and painting.

**Copy query** copies the DAX text Power BI's Copy query would give when the engine can produce it
(`engine.toDaxQuery` for `summarize`, `toVisualCalcDaxQuery` for visual calculations); otherwise the request as
JSON, headed with the method name.

**Export** writes a JSON file shaped after Power BI Desktop's `PowerBIPerformanceData.json`: a flat `events` list
with a "User Action" event per action and a "Visual Container Lifecycle" event per visual, whose children are
"Query", "Render" and "Other" events (`toExportJson`).

### Differences from Power BI Desktop

- Lumen's engine runs in the renderer process, so there is no network, queueing or Analysis Services time: the
  DAX query figure is pure evaluation time, and "Other" means waiting on the shared React commit and painting.
- Repeated identical queries are answered from an LRU cache (`src/renderer/src/report/cachedEngine.ts`, 600
  entries per engine instance). Cache hits are timed too and show as roughly 0 ms queries, which matches Power BI's
  cached-query behaviour.
- After a slicer change, cross-highlight or drill, only visuals that queried data are listed (`shouldLog`); text
  boxes and shapes are left out, as in Power BI.
- The exported JSON has the shape of Power BI's file but far fewer event kinds; child events carry the measured
  duration and the DAX text, not Power BI's engine-internal tracing.
- A re-render a visual starts on its own (internal state) does not pass through the marks and counts as "Other".

## The query budget

`createEngine(model, data, options)` accepts `queryBudgetMs` (`src/core/engine/engine.ts`): the time budget of one
`summarize`, `distinctValues` or `evaluateScalar` call, 15,000 ms by default, `0` for none. When a call exceeds it,
the evaluator's deadline stops it and the call returns the rows computed so far, flagged `truncated` with a
warning, instead of freezing the window. Tables and matrices also request 500-row windows
(`visuals/tables/windowQuery.ts`) as Power BI's data reduction does, with totals from their own queries.

## Performance budget tests

| Test | Default run | Opt-in |
|---|---|---|
| `src/core/engine/__tests__/perf.test.ts` | `summarize` with 2 group-bys from 2 dimensions and 3 measures over a 200,000-row fact must finish in under 3,000 ms | `WBI_PERF=1` adds the 1,000,000-row target: under 1,500 ms |
| `src/core/engine/__tests__/samples.test.ts` | skipped without `LUMEN_SAMPLES_DIR`; with it, every visual query of every Microsoft sample must finish within 1,000 ms | `LUMEN_PERF_STRICT=1` tightens the budget to 300 ms per visual |
| `src/core/engine/__tests__/optimizations.test.ts` | about 500 groups by 7 typical measures in under 900 ms (target 300 ms); the query budget returns `truncated` with a "time budget" warning | `LUMEN_PERF_VERBOSE=1` prints the time |
| `src/core/dax/tabular/__tests__/fusion-treatas.test.ts` | relative check: the fused path must take less than half the time of the plain one | none |

The 300 ms target is the real goal. The full suite runs files in parallel and shares the CPU, so the default budget
leaves headroom; check the strict budget with the samples file alone:

```bash
LUMEN_SAMPLES_DIR=~/pbix-samples LUMEN_PERF_STRICT=1 npx vitest run src/core/engine/__tests__/samples.test.ts
WBI_SAMPLES_VERBOSE=1 LUMEN_SAMPLES_DIR=~/pbix-samples npx vitest run src/core/engine/__tests__/samples.test.ts   # per-visual times
WBI_PERF=1 npx vitest run src/core/engine/__tests__/perf.test.ts
```

On a 20-thread development machine, the `WBI_PERF=1` run printed `summarize over 1M rows: 60 ms`.

## Investigate a slow visual

1. Record it in the Performance analyzer; note whether the time is in **DAX query** or **Visual display**.
2. For query time, use **Copy query** and run the text in the DAX query view, or reproduce the request in a test
   with `engine.summarize` and the model you need.
3. For display time, profile the renderer with the developer tools (**F12**, Performance tab); see
   [Debugging](debugging.md).
4. For a whole report set, the sweep records each visual's engine probe time in `report.json`
   (see [The sweep](the-sweep.md)); `LUMEN_SWEEP_TRACE=1` logs each visual as the engine-level sweep test probes it.
5. When you fix it, add a test that would have caught it, and keep timing assertions generous or relative so they
   do not fail on a slower machine.

## Considerations and limitations

- Timings depend on the machine and on what else is running; compare runs on the same machine only.
- The analyzer measures Lumen's engine, not your data source: refresh time from a database is not included.
- Absolute time thresholds in the default test run are deliberately loose; a regression of less than a few times
  the normal duration can pass them.

## Related content

- [Debugging](debugging.md)
- [Testing](testing.md)
- [DAX engine internals](dax-engine-internals.md)
- [Visual query pipeline](visual-query-pipeline.md)
- [The sweep](the-sweep.md)
