# Command line and environment variables

> **Applies to:** Developers

This reference lists every launch argument, environment variable and route option that Lumen, its tests and its
scripts read: where each is read, its default and its effect. Use it when you script the app, run the test layers
or wonder why the app behaves differently in a test run.

The environment-variable tables are checked against the code by `scripts/docs/check-env-vars.mjs`, which finds every
`process.env` read in `src/`, `e2e/`, `tests/`, `scripts/` and `datasets/src/` (plus `${VAR}` reads in shell scripts)
and fails when one is missing here:

```bash
node scripts/docs/check-env-vars.mjs          # "NN environment variables, all documented."
node scripts/docs/check-env-vars.mjs --list   # every variable with the files and lines that read it
```

## Launch arguments

Lumen takes the files to open as plain arguments. `launchFiles()` in `src/main/index.ts` keeps the arguments that do
not start with `-` and match this pattern:

```ts
/\.(pbix|pbit|pbip|wbi)$|\.Report\/?$|\.SemanticModel\/?$/i
```

| Argument | Effect |
|---|---|
| `<file>.pbix`, `.pbit`, `.pbip`, `.wbi` | Opened at startup. |
| `<name>.Report` or `<name>.SemanticModel` folder | Opened at startup as a PBIR report folder or a TMDL model folder. |
| anything else | Ignored. |

Only the **first** matching file is opened: the renderer's `launch()` in `src/renderer/src/app/App.tsx` calls
`openPath(files[0], { skipConfirm: true })`. When `WBI_OPEN` is set it replaces the arguments.

```bash
npm run build
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron . ~/reports/Sales.pbix
scripts/lumen.sh ~/reports/Sales.pbix      # the desktop launcher: rebuilds when sources changed, then starts
```

There are no command-line switches (`--something`) for users. The main process passes one internal switch to the
renderer, `--wbi-block-cache`, when `WBI_BLOCK_CACHE` is set (`BLOCK_CACHE_ARG` in `src/shared/cacheGuard.ts`).

### Developer keyboard shortcuts in the window

Handled in `createWindow()` in `src/main/index.ts` (the window is frameless and has no visible menu):

| Keys | Effect |
|---|---|
| F12 or Ctrl+Shift+I | Toggle Chromium developer tools. |
| Ctrl+R | Reload the renderer. Development server (`npm run dev`) only. |

## Application environment variables

Read by the Electron main process (`src/main/index.ts`) or the preload (`src/preload/index.ts`).

| Variable | Default | Effect |
|---|---|---|
| `WBI_BLOCK_CACHE` | unset (decoding allowed) | Any value except empty, `0` or `false` blocks decoding of PBIP `.pbi/cache.abf` files. The main process adds `--wbi-block-cache` to the renderer's arguments; the preload then sets `globalThis.__LUMEN_BLOCK_CACHE_ABF__`, which `openProject` in `src/core/io/open.ts` checks. Read by `blockCacheRequested()` in `src/shared/cacheGuard.ts`. `scripts/capture.sh` sets it to `1` by default and `scripts/sweep.sh` always does. |
| `WBI_OPEN` | unset | A path to open at startup instead of the command-line arguments (`app:getLaunchFiles` handler). |
| `WBI_ROUTE` | empty | Hash route loaded in the window, for example `#/?sample=1&page=2`. See [Route options](#route-options). |
| `WBI_SIZE` | `1600x1000` | Window size as `WxH`, used only in capture, sweep and end-to-end modes. A normal window opens at 1600 x 980. |
| `WBI_CAPTURE` | unset | Headless capture mode: an absolute PNG path. The hidden window loads, waits until `document.body.dataset.wbiReady === '1'` and `wbiBusy !== '1'` hold on two polls 250 ms apart (or until `WBI_TIMEOUT`), writes the PNG and `<path>.log` (renderer console), and exits. Set by `scripts/capture.sh`. |
| `WBI_CAPTURE_PROFILE` | unset | `keep` makes a capture use the real user profile. By default a capture uses a temporary profile (`lumen-capture-<pid>` in the temp folder) that is deleted on quit, so pane layout and recent files do not leak between captures. |
| `WBI_CAPTURE_SHOW` | unset | When set, the capture window is shown, inactive, on the current display. `scripts/capture.sh` sets it when it runs on a private Xvfb display; a window that is never shown stops producing frames. |
| `WBI_SWEEP` | unset | Sweep host mode: the renderer drives itself from the route (`#/?sweep=…`), main forwards its console to `WBI_SWEEP_LOG` and exits when the window closes. Set by `scripts/sweep.sh`. |
| `WBI_SWEEP_LOG` | unset | File that receives the renderer console in sweep mode. |
| `WBI_SWEEP_SHOW` | unset | Like `WBI_CAPTURE_SHOW`, for sweep mode. |
| `WBI_TIMEOUT` | `60000` (capture), `900000` (sweep) | Milliseconds. Capture: how long to wait for readiness before taking the picture anyway (the log then contains `[capture] timed out waiting for document.body.dataset.wbiReady`). Sweep: overall limit per report; on expiry the process exits with code 3. `scripts/sweep.sh` adds 30 s to it for its own `timeout`. |
| `LUMEN_E2E` | unset | `1` enables end-to-end test mode (ignored when `WBI_CAPTURE` is set): a throwaway profile, the window is shown inactive and keeps painting when unfocused, and closing never prompts. Set by `e2e/harness.ts`. |
| `LUMEN_USER_DATA` | a temp folder `lumen-e2e-<pid>` | Profile folder in end-to-end mode. When you set it, the folder is kept after the run; the default one is deleted on quit. |
| `ELECTRON_RENDERER_URL` | unset | Set by `electron-vite dev`. When present the main process loads the renderer from the development server (hot module replacement) and enables Ctrl+R. |
| `ELECTRON_RUN_AS_NODE` | set to `1` by VS Code terminals | Makes the Electron binary behave as plain Node, so the app fails at startup with `SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'`. Every npm script and repository script unsets it (`env -u ELECTRON_RUN_AS_NODE`); do the same when you run `electron` yourself. |
| `npm_package_version` | `0.1.0` | Read by the preload as `window.wbi.app.version`. npm sets it when the app starts through an npm script. |

### Read by connectors in the main process

| Variable | Where | Effect |
|---|---|---|
| `AWS_REGION` | `src/main/ipc/connectors/s3.ts` | Region of an S3 client when the source names neither a region nor an endpoint (else `us-east-1`). The AWS SDK also reads its usual variables and profile files when the source uses a named profile. |
| `USER` | `src/main/ipc/connectors/shares.ts` | Default user name offered when mounting a network share. |

## Script environment variables

| Variable | Read by | Default | Effect |
|---|---|---|---|
| `WBI_USE_DESKTOP` | `scripts/capture.sh`, `scripts/sweep.sh` | unset | Run on your current display instead of a private Xvfb display. |
| `LUMEN_E2E_USE_DISPLAY` | `e2e/run.sh` | unset | Run the journeys on your current display (watch them) instead of a private Xvfb display. |
| `NVM_DIR` | `scripts/lumen.sh` | `~/.nvm` | Where the launcher looks for a Node 20+ install when the `PATH` has none. Not checked by the script above (it is not a Lumen setting). |

## Test environment variables

The unit and integration suite (`npm test`) runs offline without any of these. Each variable switches on an extra
layer; suites that need one are skipped when it is unset (`describe.skipIf`). See [Testing](../developer/testing.md).

| Variable | Read in | Effect |
|---|---|---|
| `LUMEN_SAMPLES_DIR` | `src/core/engine/__tests__/samples.ts`, `src/core/io/__tests__/samples.test.ts`, `src/core/dax/tabular/__tests__/relkeys.test.ts`, `src/renderer/src/app/sweep/__tests__/samples.test.ts`, `src/renderer/src/visuals/slicers/slicerExtras.test.ts`, `e2e/harness.ts` | Folder of Microsoft's public sample `.pbix` files. Enables the real-data regression tests (published values, every visual's query, performance budget) and the sample-file end-to-end journeys. `samples.ts` falls back to `WBI_PBIX_SAMPLES_DIR`, then to a `pbix-samples` folder beside the repository. |
| `WBI_PBIX_SAMPLES_DIR` | `src/core/engine/__tests__/samples.ts`, `src/core/io/pbix/datamodel/datamodel.test.ts` | Older name of `LUMEN_SAMPLES_DIR`. The DataModel test reads only this name: it decodes every `.pbix` / `.abf` under the folder and checks structural invariants. |
| `LUMEN_PBIX_SAMPLES` | `src/renderer/src/panes/visualizations/cf/rules.test.ts` | Folder of sample `.pbix` files for the conditional-formatting rule round-trip test. |
| `WBI_SAMPLES_VERBOSE` | `src/core/engine/__tests__/samples.ts` | Print per-sample detail. |
| `LUMEN_PERF_STRICT` | `src/core/engine/__tests__/samples.test.ts` | Per-visual budget of 300 ms instead of 1,000 ms. Run the samples file alone with it; the full parallel suite shares the CPU. |
| `LUMEN_PERF_VERBOSE` | `src/core/engine/__tests__/optimizations.test.ts` | Print the timing of the large grouped-query test. |
| `WBI_PERF` | `src/core/engine/__tests__/perf.test.ts` | Enables the 1-million-row summarize test and prints its time. |
| `LUMEN_SWEEP_DUMP` | `src/renderer/src/app/sweep/__tests__/samples.test.ts` | Folder where the engine-probe test writes one `.probe.json` per sample, for triage. |
| `LUMEN_SWEEP_TRACE` | same file | Print each visual as the probe reaches it (find the one that hangs). |
| `LUMEN_CORPUS_DIR` | `src/core/*/__tests__/corpus.test.ts` and about a dozen other test files | Folder of PBIP projects to parse, round-trip and evaluate. The assertions are generic; no corpus content belongs in the repository. `tests/setup.ts` blocks `.pbi/cache.abf` decoding in every test run. |
| `LUMEN_CORPUS_VERBOSE` | `src/core/engine/__tests__/corpus.test.ts` | Print per-project detail. |
| `LUMEN_CORPUS_RAW` | same file | Group error messages by their raw text instead of a scrubbed form with names replaced by `…`. Prints names from the corpus: use it locally only. |
| `TMDL_DIFF_OUT` | `src/core/tmdl/__tests__/corpus.test.ts` | Folder where TMDL files that do not round-trip byte-identically are written as `a.tmdl` / `b.tmdl` pairs. |
| `LUMEN_ARRANGE_REPORT` | `src/renderer/src/views/model/arrange.test.ts` | Print layout timing and line-crossing counts of the Model view's **Auto arrange**. |
| `LUMEN_IT` | `src/main/ipc/connectors/__tests__/connectors.it.test.ts` | Live connector tests against Docker containers (PostgreSQL, MySQL, MinIO, Firestore emulator). See [Connectors](../developer/connectors.md). |

### End-to-end variables

Read by `e2e/harness.ts`, `e2e/vitest.config.ts` and individual journeys. See
[End-to-end tests](../developer/end-to-end-tests.md).

| Variable | Default | Effect |
|---|---|---|
| `LUMEN_E2E_OUT` | a new temp folder `lumen-e2e-*` | Failure screenshots and renderer error logs, plus per-run scratch files (saves, exports). |
| `LUMEN_E2E_WORKERS` | `3` | Parallel app instances. `1` runs the files one after another. |
| `LUMEN_E2E_APP` | `out/e2e/main/index.js` | Built main entry to launch. |
| `LUMEN_E2E_SHOTS` | unset | Folder where `e2e/icons.e2e.ts` and `e2e/model.e2e.ts` save screenshots of key states. |
| `CI` | unset | When set, vitest uses the `default` reporter instead of `verbose`. |

## Route options

The renderer reads options from the hash of its URL (`#/<path>?<options>`), parsed by `parseHash()` in
`src/renderer/src/app/Router.tsx`. Set them with `WBI_ROUTE`, the second argument of `scripts/capture.sh`, or the
`route` option of the end-to-end harness.

### Paths

| Path | What it shows |
|---|---|
| `#/` | The application shell. |
| `#/gallery` | Every registered visual rendered from gallery fixtures (`visuals/gallery/Gallery.tsx`). |
| `#/canvas-test` | The report canvas with a mock engine (`report/dev/CanvasTest.tsx`). |
| `#/modeling-test` | The modeling views with the development engine (`views/dev/ModelingDev.tsx`); options `view=data|model|dax`, `field=`, `dialog=`, `arg=`, `query=`, `run=1`, `complete=1`. |
| `#/print` | The export layout used for PDF and image capture. |

> [!NOTE]
> The three developer routes (`gallery`, `canvas-test`, `modeling-test`) never clear the busy signal that the shell
> takes at startup, so a capture of them always waits the full `WBI_TIMEOUT` before taking the picture. The picture
> is still correct.

### Options of `#/`

Applied by `applyRouteOptions()` and `launch()` in `src/renderer/src/app/App.tsx` after the project opens.

| Option | Effect |
|---|---|
| `sample=1` | Open the built-in sample project. |
| `template=<id>` | Create a new report from a built-in template: `boardroom`, `monolith`, `doodle`, `orbital`, `atomic`, `blacktop`, `broadsheet`, `contour`, `blueprint`, `aurora` or `first-edition`. |
| `start=1` / `start=0` | Show / suppress the start screen. |
| `view=report|data|model|dax|powerquery` | Active view. |
| `page=<name or n>` | Active page: page name, display name (case-insensitive) or 1-based index. |
| `panes=filters,visualizations,…` | Open exactly these panes. |
| `collapse=<pane,…>` | Open these panes collapsed. |
| `select=<visualName,…>` | Select visuals. |
| `vizTab=build|format|analytics`, `formatTab=visual|general` | Visualizations pane tab and Format pane tab. |
| `tab=<ribbon tab id>` | Ribbon tab. |
| `dialog=<id>` | Open a dialog, for example `getData` or `options`. |
| `backstage=home|open|save|saveAs|export|options|about` | Open a **File** menu page. |
| `field=Table.Column`, `field=Table.[Measure]`, `field=Table` | Select a field in the Data pane. |
| `cmd=<modeling command>` | Run a modeling command, for example `newMeasure`. |
| `formula=<text>` | Commit this formula to the selected field. |
| `data=sample` | Fill tables that have no data with sample data. |
| `notice=1` | Show the missing-data notification bar. |
| `perf=1` | Start Performance analyzer recording and refresh the visuals. |
| `export=pdf|pptx|png|html&exportPath=/abs/path[&pngScale=2]` | Scripted export after the project opens; the app stays busy until it finishes. |
| `simdrag=<visual or type#n>:<dx>,<dy>[:<handle>]` | Show the smart guides of a simulated drag (read in `report/PageCanvas.tsx`). |
| `mobile=1|auto` | Mobile layout (read in `report/mobile/index.tsx`). |
| `cf=<object>.<prop>[@queryRef][&cfStyle=rules]` | Open the conditional-formatting dialog (read in `panes/visualizations/cf/CfDialog.tsx`). |
| `pq=`, `pqQuery=`, `pqNew=`, `pqStep=`, `pqView=quality,distribution,profile,noformula,nosettings,collapsed`, `pqCols=` | Power Query Editor state when `view=powerquery` (read in `views/powerquery/PowerQueryEditor.tsx`). |
| `e2e=1` | Install the end-to-end hooks on `window.__lumen` (`app/e2eHooks.ts`). |
| `sweep=<outdir>&open=<path>` | Sweep mode (`app/sweep/sweep.ts`), with `synthetic=1`, `private=1`, `appDefaults=1`, `blockCache=1`, `pages=a,b` and repeatable `dax=<query>`. Normally set by `scripts/sweep.sh`. With `blockCache=1` the renderer refuses to open anything unless the cache guard is active. |

Example:

```bash
npm run build
scripts/capture.sh /tmp/overview.png '#/?sample=1&page=1&panes=visualizations&vizTab=format' '' 1440x900
```

## Related content

- [Scripts reference](scripts.md)
- [Development environment](../developer/development-environment.md)
- [Testing](../developer/testing.md)
- [End-to-end tests](../developer/end-to-end-tests.md)
- [Debugging](../developer/debugging.md)
