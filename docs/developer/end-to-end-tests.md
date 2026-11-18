# End-to-end tests

> **Applies to:** Developers

End-to-end journeys drive the real, built Lumen app through its user interface: they click, type, drag and
drop, and check what the screen shows. This article explains how to run them, how the harness works, which
readiness signals a journey waits on, and how to write a new one. Every new user-interface feature needs a
journey.

## How it fits together

```text
e2e/run.sh
  ├─ electron-vite build --outDir out/e2e          (skipped with --no-build)
  └─ xvfb-run vitest run --config e2e/vitest.config.ts [filter]
        └─ one worker per e2e/*.e2e.ts file (3 in parallel by default)
              └─ useLumen() → Playwright _electron.launch(out/e2e/main/index.js)
                    env: LUMEN_E2E=1, LUMEN_USER_DATA=<tmp>/profile, WBI_BLOCK_CACHE=1,
                         WBI_ROUTE='#/?e2e=1&…', WBI_SIZE=1600x1000 [, WBI_OPEN=<path>]
```

- **Build output.** `e2e/run.sh` builds into `out/e2e/`, not `out/`, so a concurrent `npm run build` cannot swap the
  renderer's hashed assets under a running journey.
- **Display.** Journeys run on a private Xvfb display (`xvfb-run -a -s "-screen 0 1800x1200x24"`) when `xvfb-run` is
  installed. Set `LUMEN_E2E_USE_DISPLAY=1` to use your current `DISPLAY` and watch them.
- **One app per file.** Each `*.e2e.ts` file launches one Electron instance in `beforeAll` and closes it in
  `afterAll`. The tests inside a file share that instance and run in order, so a later test can build on an
  earlier one.
- **Main process in test mode.** With `LUMEN_E2E=1`, `src/main/index.ts` uses a throwaway profile
  (`LUMEN_USER_DATA`), shows the window without focusing it, keeps painting while unfocused, and never asks for
  confirmation on close.
- **Renderer hooks.** The route option `e2e=1` makes `src/renderer/src/app/e2eHooks.ts` install `window.__lumen`:
  the stores (`useApp`, `useShell`, `useInteraction`), `openPath`, `saveAs`, `exportReport`,
  `exportReportWithResult`, `isBusy`, `setVisualIcon` and `errors` (every `console.error`, uncaught error and
  unhandled rejection the renderer saw). The hooks are never installed in normal runs.

## Run the journeys

```bash
source ~/.nvm/nvm.sh
e2e/run.sh                         # build, then every journey
e2e/run.sh slicers                 # build, then only files matching "slicers"
e2e/run.sh --no-build model        # reuse out/e2e/
LUMEN_E2E_WORKERS=1 e2e/run.sh     # one file at a time
LUMEN_E2E_USE_DISPLAY=1 e2e/run.sh --no-build start   # watch on your desktop
LUMEN_SAMPLES_DIR=~/pbix-samples e2e/run.sh crossfilter
```

Arguments after `--no-build` are passed to vitest, so any vitest filter or flag works (`-t "<test name>"`).

A full run on a 20-thread machine reported:

```text
 Test Files  21 passed | 1 skipped (22)
      Tests  59 passed | 2 skipped (61)
   Duration  35.25s
```

The skipped file is `crossfilter.e2e.ts`, which needs `LUMEN_SAMPLES_DIR` (it opens Microsoft's
`Store Sales.pbix`). A single small file such as `e2e/run.sh start` takes a few seconds including the build.

### Environment variables

| Variable | Default | Effect |
|---|---|---|
| `LUMEN_E2E_OUT` | a new `lumen-e2e-*` folder under the system temp directory | failure screenshots and logs, and each instance's scratch folder (`run-*`: profile, saves, exports) |
| `LUMEN_E2E_WORKERS` | `3` | app instances in parallel; `1` also turns file parallelism off |
| `LUMEN_E2E_APP` | `out/e2e/main/index.js` | the built main entry to launch (for example `out/main/index.js`) |
| `LUMEN_E2E_USE_DISPLAY` | unset | use the current display instead of a private Xvfb |
| `LUMEN_SAMPLES_DIR` | unset | enables the journeys on Microsoft's sample `.pbix` files |
| `CI` | unset | when set, vitest uses the `default` reporter instead of `verbose` |

The full list of variables the app reads is in
[Command line and environment](../reference/command-line-and-environment.md).

## The journeys

| File | What it covers |
|---|---|
| `start.e2e.ts` | start screen, **Try a sample**, every page of the sample renders |
| `views.e2e.ts` | Table view rows, Model view cards and lines, a DAX query in the DAX query view |
| `slicers.e2e.ts` | list, dropdown and date range slicers filter the page; clearing restores it |
| `crossfilter.e2e.ts` | cross-filtering on Microsoft's Store Sales sample (needs `LUMEN_SAMPLES_DIR`) |
| `bookmarks.e2e.ts` | bookmarks restore slicer state; drill-through |
| `build.e2e.ts` | inserting a column chart and binding fields; default sort by value |
| `format.e2e.ts` | title and colour edits with undo and redo; controls show the values visuals draw with; reset; narrow pane widths |
| `cards.e2e.ts`, `tables.e2e.ts`, `chrome.e2e.ts` | card layout, table and matrix behaviour, container title and fonts |
| `icons.e2e.ts` | built-in icon libraries on image visuals and cards; save, reopen, edit |
| `formula.e2e.ts` | a new measure from the ribbon shown in a card; IntelliSense completion |
| `model.e2e.ts` | Model view: relationship lines (bend, ends, pinch points, styles), new relationship by drag, table groups, Auto arrange, floating formula bar (invented star schemas) |
| `powerquery.e2e.ts`, `refresh.e2e.ts`, `getdata.e2e.ts` | Power Query editor steps, refresh and cancel, Get data from a lakehouse folder and DuckDB |
| `sampledata.e2e.ts` | sample data for a model without data, Table view, relationship validation, regeneration, stand-ins, `.wbi` keeps rows |
| `saveexport.e2e.ts`, `export.e2e.ts` | save as PBIP and `.wbi`, export to PDF, PowerPoint, PNG; page selection |
| `performance.e2e.ts` | Performance analyzer recording, grouping, sorting, Copy query, Export |
| `mobile.e2e.ts`, `snapping.e2e.ts` | mobile-only formatting; equal-spacing guides and snapping while dragging |

Invented projects used by journeys are generated at run time by `e2e/fixtures/accounts.ts` and
`e2e/fixtures/survey.ts` (they write PBIP folders with `saveProject`); the `getdata` journeys generate a
lakehouse with the test support in `tests/support/lakehouse/`.

## Readiness signals

Journeys never sleep for a fixed time. They wait on signals the app publishes on `<body>`
(`src/renderer/src/app/readiness.ts`):

| Attribute | Meaning |
|---|---|
| `data-wbi-busy="1"` | a long operation runs: launching, opening a project, saving, a scripted export. Reference-counted (`holdBusy(reason)` returns a release function), so overlapping operations do not clear each other. |
| `data-wbi-ready="1"` | the visible screen finished rendering. The report canvas sets it when the first page rendered; other views set it when they have nothing more to render, and only while nothing is busy (`canSignalReady()`). |

`scripts/capture.sh` and `scripts/sweep.sh` wait on the same attributes. When you add a long-running operation,
hold busy for its duration; when you add a view, set ready once it has drawn.

## Harness reference (`e2e/harness.ts`)

**Launching**

| Helper | Use |
|---|---|
| `useLumen(opts)` | register one app instance for the file; returns a getter `lumen()` → `{ app, page, tmp }`. Options: `open` (a path to open at launch), `route` (extra `#/?…` options such as `{ sample: '1' }` or `{ start: '1' }`), `size` (default `1600x1000`). Without `route.start` or `route.sample`, `start=0` hides the start screen. |
| `launchLumen(opts)` | the same, without the hooks (for a second instance) |
| `ROOT`, `APP_ENTRY`, `SAMPLES_DIR`, `OUT_DIR` | resolved paths |

**Waiting**

| Helper | Use |
|---|---|
| `waitIdle(page)` | ready and not busy on two consecutive polls |
| `settle(page)` | after an interaction: not busy, no visual says "Loading…", and the page's DOM signature unchanged over three polls |
| `until(page, fn)` | poll a synchronous in-page predicate |
| `untilNode(fn, timeout, what)` | poll a Node-side check, such as a file appearing |
| `untilVisualText(page, name, test)` | poll one visual's text until a predicate holds |

**Canvas**

| Helper | Use |
|---|---|
| `visualStatuses(page)` | classify every visual on the page as `ok`, `error`, `unsupported`, `nodata`, `loading` or `empty` (the same rules as the sweep) |
| `expectAllRendered(statuses, allow)` | assert every visual is in an allowed state |
| `visualByTitle(page, title)`, `visualsOfType(page, type)` | find visual names |
| `visualText`, `pageTexts`, `pageMarkup` | text or markup of one or all visuals, to detect cross-filtering and highlighting |
| `pageTabs(page)`, `goToPage(page, indexOrName)` | page tabs; switching waits until the page rendered |
| `clickShape(page, visual, selector, index, opts)` | click a point that is really inside an SVG shape's fill and on top (pie slices, bars), with optional right button and modifiers |
| `dataPaneRow(page, ['Table', 'Column'])` | expand the Data pane down to a row and return its locator |
| `deselectAll(page)` | click the empty canvas around the page |

**State and native dialogs**

| Helper | Use |
|---|---|
| `lumenEval(page, (l, arg) => …, arg)` | evaluate against `window.__lumen` (for observation and setup steps not under test) |
| `openFile(page, path)` | open a file through the app's own open command, without the native dialog |
| `stubSaveDialog(app, path)`, `stubOpenDialog(app, paths)` | answer the next native Save or Open dialogs in the main process (`null` cancels) |
| `rendererErrors(page)` | the renderer errors captured so far |

The vitest configuration (`e2e/vitest.config.ts`) sets a 120 s test timeout, a 150 s hook timeout and a 20 s
default for `expect.poll`.

## Write a journey

1. Create `e2e/<feature>.e2e.ts` with a header comment that says what the journey proves.
2. Call `useLumen()` once at the top of the `describe`, with the route or file the journey starts from. Prefer the
   built-in sample (`route: { sample: '1' }`) or an invented project generated into `lumen().tmp`.
3. Drive the feature the way a user does: `page.getByRole(...)`, `locator.click()`, keyboard, drag and drop.
   Use `lumenEval` only to observe state that has no DOM form (undo depth, model tables) or for setup that is not
   what the journey tests.
4. After every interaction, wait on a condition: `settle`, `untilVisualText`, `until`, `expect.poll`. Do not use
   `waitForTimeout` or `setTimeout` sleeps.
5. Assert on what the user sees, then on document state if it matters (for example that a save wrote the file).
6. Run it alone (`e2e/run.sh <feature>`), then with the whole suite.

The slicer journey shows the pattern (`e2e/slicers.e2e.ts`):

```ts
describe('slicers', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('list slicer: selecting an item filters the visuals; the eraser clears it', async () => {
    const { page } = lumen()
    await goToPage(page, 'Products')
    const slicer = page.locator('.wbi-page [data-type="slicer"]').filter({ hasText: /^Category/ })
    const table = await visualByTitle(page, 'Product details')
    const before = await pageTexts(page)
    await slicer.getByRole('option', { name: 'Bikes', exact: true }).click()
    await untilVisualText(page, table, (t) => t !== before[table])
    await settle(page)
    // …assert on the changed visuals, then clear and compare with `before`
  })
})
```

## When a journey fails

The getter returned by `useLumen` registers an `onTestFailed` hook: it saves a screenshot and the renderer's error
log as `<test name>.png` and `<test name>.log` in `$LUMEN_E2E_OUT`, and prints their paths:

```text
[e2e] failure artifacts: /tmp/lumen-e2e-…/<test_name>.png / .log
```

Look at the screenshot first: most failures are a label or role that changed, a dialog still open, or a wait
that ended on the wrong condition. See [Debugging](debugging.md) for other failure signatures.

## Timing and load

Journeys are written to be independent of machine speed: every wait is on a condition, and `settle` requires the
page to be stable over several polls because slicer changes and cross-filter re-queries are asynchronous (a slicer
commits its filter after a debounce). The suite passed in full with the default 3 workers and with
`LUMEN_E2E_WORKERS=8` while the unit suite ran at the same time on the same machine.

The journeys most sensitive to timing are the ones that act on geometry or on asynchronous re-queries:
`model.e2e.ts` (pointer drags on relationship lines: a line can run partly behind a card, so the journey searches for
a point where the line itself is under the pointer), `slicers.e2e.ts`, `sampledata.e2e.ts`, `bookmarks.e2e.ts` and
`performance.e2e.ts` (timings and action grouping). If one of these fails only under load, re-run it alone with
`LUMEN_E2E_WORKERS=1` before you investigate, and treat a failure that reproduces alone as a real defect.

## Considerations and limitations

- The journeys need Electron's runtime libraries and, for headless runs, `xvfb-run`. Without `xvfb-run` they open
  windows on your display.
- Native file dialogs are stubbed, not exercised; journeys open files through the app's own command (`openFile`).
- The journeys run on Linux only, against the build in `out/e2e/`; they do not test a packaged build.
- `e2e/` is type-checked separately (`npx tsc --noEmit -p e2e/tsconfig.json`), not by `npm run typecheck`.

## Related content

- [Testing](testing.md)
- [Debugging](debugging.md)
- [The sweep](the-sweep.md)
- [Scripts](../reference/scripts.md)
- [Development environment](development-environment.md)
