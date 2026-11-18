# Testing

> **Applies to:** Developers

This article describes Lumen's unit and integration tests: where they live, how to run them, what the global setup
blocks, which suites switch on only with an environment variable, and what a new test should look like. Read it
before you add a feature or change an engine. For the user-interface journeys, see
[End-to-end tests](end-to-end-tests.md).

## Test layers at a glance

| Layer | Runner | Where | Enabled by |
|---|---|---|---|
| Unit and integration | vitest (Node) | `src/**/*.test.ts(x)`, `tests/**`, `datasets/**`, `scripts/**/*.test.mjs` | always |
| Sample-file oracle | vitest | `src/core/engine/__tests__/{samples,oracle}.test.ts`, `src/core/io/__tests__/samples.test.ts`, `src/renderer/src/app/sweep/__tests__/samples.test.ts`, and a few `describe.skipIf(!SAMPLES …)` blocks | `LUMEN_SAMPLES_DIR` |
| Private corpus | vitest | `**/corpus.test.ts` and `describe.skipIf(!CORPUS …)` blocks | `LUMEN_CORPUS_DIR` |
| Live connectors | vitest + Docker | `src/main/ipc/connectors/__tests__/connectors.it.test.ts` | `LUMEN_IT=1` |
| Performance targets | vitest | `src/core/engine/__tests__/perf.test.ts`, the samples test | `WBI_PERF=1`, `LUMEN_PERF_STRICT=1` |
| End-to-end journeys | vitest + Playwright Electron driver | `e2e/*.e2e.ts` | `e2e/run.sh` |
| Render sweep, compare | Electron | `scripts/sweep.sh`, `scripts/compare.sh` | manual |

## Run the tests

```bash
source ~/.nvm/nvm.sh          # Node >= 20.19 (package.json "engines")
npm test                      # vitest run: the whole offline suite
npx vitest run src/core/dax   # one folder
npx vitest run src/core/m/__tests__/parser.test.ts   # one file
npx vitest -t "DATEDIFF"      # tests whose name matches (watch mode)
npm run test:watch            # vitest in watch mode
npm run typecheck             # tsc --noEmit over src, tests, datasets
```

A run of `npm test` on a clean checkout, without any of the environment variables below, reported:

```text
 Test Files  207 passed | 9 skipped (216)
      Tests  3040 passed | 49 skipped (3089)
   Duration  14.27s
```

The numbers grow with the code; the shape (everything offline passes, the skipped tests are the opt-in suites)
is what to expect. The skipped tests are exactly the ones gated on `LUMEN_SAMPLES_DIR`, `LUMEN_CORPUS_DIR`,
`LUMEN_IT` and `WBI_PERF`; nothing is skipped for any other reason.

> [!NOTE]
> `npm run typecheck` does not include the `e2e/` folder: it has its own `e2e/tsconfig.json`. Check it with
> `npx tsc --noEmit -p e2e/tsconfig.json`.

## Configuration

`vitest.config.ts` at the repository root defines the suite:

```ts
test: {
  globals: true,
  setupFiles: ['tests/setup.ts'],
  include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts', 'datasets/**/*.test.ts', 'scripts/**/*.test.mjs'], exclude: ['**/node_modules/**', 'datasets/out/**'],
  testTimeout: 60000
}
```

- **Environment.** Tests run in Node. No DOM library (jsdom or happy-dom) is installed, so React components are
  tested by rendering them to a string with `renderToStaticMarkup` from `react-dom/server` (see
  `src/renderer/src/panes/visualizations/effectiveDefaults.test.tsx` or
  `src/renderer/src/visuals/slicers/slicers.test.tsx`), or by testing the pure functions behind them. Anything that
  needs a real browser belongs in an end-to-end journey.
- **Aliases.** The same `@core/*`, `@renderer/*` and `@shared/*` aliases as the app, plus `@parity/lakehouse` for the
  lakehouse test support in `tests/support/lakehouse/`.
- **Timeout.** 60 seconds per test; long sample tests pass their own (`300_000`).
- **Isolation.** vitest's default: one worker per file, files in parallel. Tests must not depend on order or on
  shared global state.

### The setup file and what it blocks

`tests/setup.ts` runs before every test file:

```ts
;(globalThis as { __LUMEN_BLOCK_CACHE_ABF__?: boolean }).__LUMEN_BLOCK_CACHE_ABF__ = true
```

With this flag set, `openProject` (`src/core/io/open.ts`) never decodes a PBIP `.pbi/cache.abf` file (the
data cache Power BI Desktop writes beside a project). The guard exists because a corpus of real projects can
contain confidential data in those caches, and no test needs them: PBIX decoding is tested with public samples. The
guard's own tests are `src/core/io/__tests__/cacheguard.test.ts` and `src/shared/__tests__/cacheGuard.test.ts`. The
app applies the same guard when it runs with `WBI_BLOCK_CACHE=1` (see
[Command line and environment](../reference/command-line-and-environment.md)).

## Where tests live

Tests sit next to the code they test, as `name.test.ts` beside `name.ts`, or in a `__tests__/` folder of the same
directory when there are several, or when they share fixtures. Shared test support that is not tied to one module
lives in `tests/support/` (`lakehouse/` builds Delta and Parquet lakehouses; `m/` has an M workspace host).

The largest groups, by number of tests in the run above:

| Area | Test files | Tests | Typical subjects |
|---|---|---|---|
| `src/renderer/src/visuals` | 60 | 911 | visual queries, layout math, format resolution, gallery fixtures rendered to markup |
| `src/renderer/src/panes` | 14 | 334 | Format pane property model, effective defaults, field wells, conditional formatting rules |
| `src/core/format` | 3 | 263 | Power BI format strings (`#,0.00`, dates, cultures) |
| `src/core/dax` | 19 | 234 | DAX lexer, parser, evaluator, tabular engine, golden queries |
| `src/core/engine` | 16 | 193 | `QueryEngine` API, SQ filter translation, `toDaxQuery`, visual calculations |
| `src/renderer/src/views` | 18 | 178 | Model view routing and arrangement, Power Query editor, Table view |
| `datasets` | 3 | 166 | the fictional dataset generator (deterministic output) |
| `src/renderer/src/report` | 20 | 161 | canvas geometry, filters, bookmarks, chrome, Performance analyzer |
| `src/core/m` | 10 | 154 | M lexer, parser, interpreter, library, folding |
| `src/core/data` | 9 | 117 | refresh pipeline, synthetic data, stand-ins |

## Fixtures

Every fixture in the repository is invented. Common patterns:

- **Models built in code.** Most engine tests build a small `SemanticModel` and `DataStore` in the test file, or
  share one in a `fixture.ts` beside the tests (`src/core/dax/__tests__/fixture.ts`).
- **The built-in sample.** `src/core/data/sample-model.ts`, `sample-data.ts` and `sample-report.ts` build the
  fictional "Sales" report that the app opens with **Try a sample**. Tests and journeys can use it freely.
- **The visuals gallery.** Each visual family registers gallery entries (`src/renderer/src/visuals/*/gallery.ts`,
  `visuals/gallery/registry.ts`) over a mock model (`visuals/gallery/sampleData.ts`). Tests that must touch every
  visual iterate `galleryEntries` instead of keeping their own list.
- **Generated projects.** `e2e/fixtures/*.ts` and the `datasets/` generator write whole PBIP projects with
  `saveProject`, so a test exercises the real open path.

> [!IMPORTANT]
> This repository is public. Tests and fixtures use invented names and values only. Never commit content from a
> third-party report (names, measures, DAX, data, screenshots), even from a file you are allowed to open. Tests that
> run over private or third-party files read them from a path in an environment variable and assert only generic
> properties (opens, round-trips, no engine error, at most N % of visuals empty).

## Opt-in suites

### Microsoft sample files (`LUMEN_SAMPLES_DIR`)

Point `LUMEN_SAMPLES_DIR` at a folder with Microsoft's public sample `.pbix` files (Store Sales, Retail Analysis,
and so on). These files carry real data, so they serve as the accuracy oracle:

- `src/core/engine/__tests__/samples.test.ts`: every measure evaluates at grand total without an error, and every
  visual's query (rebuilt from its field wells and saved filters) runs within the per-visual budget.
- `src/core/engine/__tests__/oracle.test.ts`: engine results against values recomputed in plain JavaScript from
  the raw columns (totals of SUM, MIN, MAX, COUNT, DISTINCTCOUNT, COUNTROWS; plain aggregation measures; sums
  grouped across each active many-to-one relationship).
- `src/renderer/src/app/sweep/__tests__/samples.test.ts`: every visual of every page probed through the engine,
  and card values checked against the figures Microsoft publishes for these samples (see
  the "Accuracy oracle" section of [SWEEP.md](../SWEEP.md)).
- `src/core/io/__tests__/samples.test.ts`, `src/core/dax/tabular/__tests__/relkeys.test.ts` and a block in
  `panes/visualizations/cf/rules.test.ts`: decoding and round trips of the PBIX files.

`src/core/engine/__tests__/samples.ts` also accepts the older name `WBI_PBIX_SAMPLES_DIR`, and falls back to a
`pbix-samples` folder beside the repository folder. `WBI_SAMPLES_VERBOSE=1` prints one line per visual with its
time and row count.

### Private corpus (`LUMEN_CORPUS_DIR`)

`LUMEN_CORPUS_DIR` points at a folder of real PBIP projects that are not part of the repository. The corpus suites
(`src/core/{io,pbir,tmdl,engine}/__tests__/corpus.test.ts`, `src/renderer/src/visuals/custom/__tests__/corpus.test.ts`
and `describe.skipIf(!CORPUS)` blocks in about ten other files) parse, round-trip and evaluate every project. Their
assertions are generic, and no corpus content may appear in test names, snapshots or the repository. The cache guard
above applies to these runs too.

### Live connectors (`LUMEN_IT=1`)

```bash
LUMEN_IT=1 npx vitest run src/main/ipc/connectors
```

`connectors.it.test.ts` starts Docker containers (`postgres:16`, `mysql:8`, MinIO, a Firestore emulator), runs M
queries end to end through the connector services, and removes the containers afterwards. Without `LUMEN_IT` the
file prints a notice and skips; with `LUMEN_IT` but no reachable Docker it warns and skips. Suites whose image is not
present locally are skipped individually (`imagePresent`). See [Connectors](connectors.md).

### Performance targets (`WBI_PERF`, `LUMEN_PERF_STRICT`)

See [Performance](performance.md#performance-budget-tests).

## Writing a test

1. Put the file next to the code: `foo.test.ts` beside `foo.ts`.
2. Import from vitest explicitly (`import { describe, expect, it } from 'vitest'`), even though globals are on;
   the existing tests do. In the vendored engines (`src/core/dax`, `src/core/m`) keep their style: relative imports
   with `.ts` extensions and double quotes.
3. Build the smallest invented model that shows the behaviour. For the DAX and M engines, add a test for every
   function or feature you add (a project rule; see [Conventions](conventions.md)).
4. Compare numbers exactly, or with an explicit tolerance and a comment explaining it.
5. Where the behaviour approximates Power BI, name the approximation in the test, so a later reader does not
   "fix" the test towards Power BI without knowing.
6. If the test needs a real file that cannot be committed, gate it with `describe.skipIf(!process.env.X)` and
   keep its assertions generic.

A minimal engine test:

```ts
import { describe, expect, it } from 'vitest'
import { createEngine } from '@core/engine/engine'

describe('my feature', () => {
  it('evaluates at grand total', () => {
    const engine = createEngine(model, data) // an invented model built above
    expect(engine.evaluateScalar('SUM(Sales[Amount])').value).toBe(42)
  })
})
```

## Considerations and limitations

- There is no coverage report and no CI configuration in the repository; run the suite locally before you
  propose a change.
- Without `LUMEN_SAMPLES_DIR`, nothing in the default run checks Lumen's numbers against Power BI's on real data;
  the offline suite checks the engines against hand-computed values and against the vendored reference engine
  (`src/core/dax/*.ts`). Run the sample suites when you change engine semantics.
- The per-visual time budget is relaxed (1,000 ms instead of 300 ms) in the full parallel run because the CPU is
  shared; timings from a parallel run are not meaningful on their own.
- `e2e/` is not type-checked by `npm run typecheck`; at the time of writing
  `npx tsc --noEmit -p e2e/tsconfig.json` reports three type errors in `e2e/chrome.e2e.ts`, which do not stop the
  journeys from running (vitest strips types).

## Related content

- [End-to-end tests](end-to-end-tests.md)
- [Performance](performance.md)
- [Conventions](conventions.md)
- [Development environment](development-environment.md)
- [Command line and environment](../reference/command-line-and-environment.md)
