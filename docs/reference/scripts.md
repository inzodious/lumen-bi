# Scripts

> **Applies to:** Developers

This reference lists every script in the repository's `scripts/` folder and `e2e/run.sh`: what it is for, how to call
it, its options and what it writes. The usage lines are taken from each script's header comment or argument parser;
run a script without arguments (or with `--help` where noted) to see its own usage text.

All shell scripts change to the repository root first, so you can call them from anywhere. Scripts that start
Electron unset `ELECTRON_RUN_AS_NODE` themselves. Scripts that need a build say so; run `npm run build` first unless the
script builds for you.

## Overview

| Script | Purpose | Needs a build |
|---|---|---|
| `scripts/capture.sh` | Headless screenshot of one route | yes, `npm run build` |
| `scripts/sweep.sh` | Render every page of reports, record per-visual status | builds when `src/` is newer |
| `scripts/sweep-summary.mjs` | Summarise a sweep folder | no |
| `scripts/compare.sh` | Compare a Power BI reference with Lumen's render, visual by visual | via the sweep |
| `scripts/compare.mjs`, `compare-lib.mjs`, `compare-electron.mjs` | Implementation of `compare.sh` | — |
| `e2e/run.sh` | End-to-end UI journeys | builds into `out/e2e/` |
| `scripts/lumen.sh` | Desktop launcher | builds when sources changed |
| `scripts/install-desktop.sh` | Menu entry and file associations | no (the entry calls `lumen.sh`) |
| `scripts/fonts/make-semibold.py` | Rebuild the bundled semibold font | no |
| `scripts/icons/gen-fluent-color.mjs` | Regenerate the Fluent Color icon barrel | no |
| `scripts/docs/check-env-vars.mjs` | Check the environment-variable reference | no |

## capture.sh

Renders the app headlessly and saves a PNG plus a `.log` file with the renderer console.

```text
scripts/capture.sh <out.png> [route e.g. '#/gallery'] [path-to-open] [WxH]
```

| Argument | Default | Meaning |
|---|---|---|
| `<out.png>` | required | Output path (made absolute with `realpath -m`). An existing file and its `.log` are deleted first. |
| route | empty (`#/`) | Hash route and options, for example `'#/?sample=1&page=2'`. See [Route options](command-line-and-environment.md#route-options). |
| path-to-open | none | A report to open (`WBI_OPEN`). |
| `WxH` | `1600x1000` | Window size. |

Environment: `WBI_TIMEOUT` (ms, default 60000) bounds the wait for readiness; `WBI_BLOCK_CACHE` defaults to `1`
(set `0` to allow `.pbi/cache.abf` decoding); `WBI_USE_DESKTOP=1` uses your display instead of a private Xvfb display.
The whole run is limited to 180 seconds by `timeout`.

Output: `<out.png>`, `<out.png>.log`; prints `captured <path>` or `capture failed` (exit code 1).

```bash
npm run build
scripts/capture.sh /tmp/sample.png '#/?sample=1' '' 1440x900
```

## sweep.sh

Renders every page of one or more reports headlessly and records the status of every visual. Detail and triage log:
[SWEEP.md](../SWEEP.md); overview: [The sweep](../developer/the-sweep.md).

```text
scripts/sweep.sh <file-or-folder> <outdir> [--sample-data [--private | --app-defaults]] [--selections] [--pages a,b] [--size WxH] [--dax 'EVALUATE …'] [--no-build]
```

| Option | Meaning |
|---|---|
| `<file-or-folder>` | A `.pbix`, `.pbit`, `.pbip` or `.wbi` file, a `*.Report` folder, or a folder searched four levels deep for `.pbix`, `.pbit` and `.wbi` files and `*.Report` folders (a `.pbip` file inside a folder is not picked up; pass it directly or let the `*.Report` folder be found). One Electron process per report. |
| `<outdir>` | Results folder. Each report's subfolder is deleted and recreated. |
| `--sample-data` | Fill tables without data with synthetic rows, reusing literals from the definitions. |
| `--private` | With `--sample-data`: the app's default seed, fact-table size and privacy (names and ids are never copied into the data). |
| `--app-defaults` | With `--sample-data`: the app's seed and fact-table size, literals reused. |
| `--selections` | Selection audit: a seeded sample of each slicer's items applied one at a time; counts visuals that had data and lose it. |
| `--pages a,b` | Only these pages (name, display name or 1-based index). |
| `--size WxH` | Window size, default `1800x1200`. |
| `--dax 'EVALUATE …'` | Run a DAX query after loading; repeatable; results in `report.json` `.dax`. |
| `--no-build` | Do not rebuild. Without it the script runs `npm run build` when `out/renderer/index.html` is missing or older than a file in `src/`. |

Environment: always sets `WBI_BLOCK_CACHE=1`; `WBI_TIMEOUT` (ms, default 900000) bounds each report;
`WBI_USE_DESKTOP=1` uses your display.

Output: `<outdir>/<report>/NN-<page>.png`, `report.json`, `console.log`, `electron.log`, and `<outdir>/summary.tsv`
(columns `report pages visuals ok error nodata loading unsupported empty blank open_ms error_msg noitems selections
sel_emptied sel_emptied_selections`). Prints one line per report and the summary path.

## sweep-summary.mjs

Summarises a sweep folder: per report and page counts, every visual that is not `ok`, slow pages, console errors,
engine-probe errors and warnings, card values and selection-audit results.

```text
node scripts/sweep-summary.mjs <outdir> [--all] [--cards] [--json]
```

| Option | Meaning |
|---|---|
| `--all` | List every visual, not only the ones that are not `ok`. |
| `--cards` | Print card values (types `card`, `cardVisual`, `multiRowCard`, `kpi`, `gauge`). |
| `--json` | Print a JSON summary (name, error, totals, per-page counts and render times) instead of text. |

## compare.sh

Compares a Power BI reference (a screenshot or an Export to PDF) with Lumen's render of the same pages, visual by
visual. Detail: [COMPARE.md](../COMPARE.md); overview: [The compare tool](../developer/the-compare-tool.md).
`compare.sh` checks that it has three arguments and runs `node scripts/compare.mjs` with them.

```text
scripts/compare.sh <reference.png|.jpg|.pdf> <report> <outdir> [options]
```

| Option | Meaning |
|---|---|
| `--page <p>` | Which report page a screenshot (or single-page PDF) shows; default the first page, or the only one in `--pages`. |
| `--pages a,b` | Only compare these pages (passed to the sweep). |
| `--sample-data`, `--private` | Passed to the sweep. |
| `--same-data` | The reference shows the same data as Lumen: also score a perceptual pixel difference per visual. |
| `--crop x,y,w,h` | Page rectangle in the reference, in reference pixels; skips detection. |
| `--lumen <dir>` | Reuse an existing sweep output folder instead of rendering. |
| `--size WxH` | Sweep window size (default `1800x1200`). |
| `--dpi <n>` | PDF rasterisation resolution (default 144). |
| `--calibrate-colours` (or `--calibrate-colors`) / `--no-calibrate` | Force or prevent correcting a colour cast of the reference. |
| `--no-local` | Do not align each visual's reference crop locally. |
| `--titles` | Include visual titles in `compare.json` and `index.html`. |
| `--no-build` | Passed to the sweep. |
| `-h`, `--help` | Print the usage text. |

Needs `pdftoppm` (poppler-utils) for PDF references. JPEG references are decoded through Electron
(`compare-electron.mjs decode`). Output: `<outdir>/index.html` (review page, worst first), `compare.json`,
`summary.tsv`, `pages/`, `visuals/`, `lumen/`.

### compare-lib.mjs and compare-electron.mjs

`compare-lib.mjs` holds the image primitives and scores (a PNG codec on `node:zlib`, crops, resampling, canvas
detection, scores); it has tests in `compare-lib.test.mjs`, which `npm test` runs. `compare-electron.mjs` is an
Electron helper: `electron scripts/compare-electron.mjs decode <in> <out.png>` converts any image Chromium can decode
to PNG, and `pdf <in.png> <out.pdf>` prints an image to a one-page PDF.

## e2e/run.sh

Builds the app into `out/e2e/` and runs every `e2e/*.e2e.ts` journey on a private Xvfb display. See
[End-to-end tests](../developer/end-to-end-tests.md).

```text
e2e/run.sh [--no-build] [vitest args, e.g. a file filter: e2e/run.sh report]
```

| Option | Meaning |
|---|---|
| `--no-build` | Reuse the existing `out/e2e/` build. Must be the first argument. |
| other arguments | Passed to `vitest run --config e2e/vitest.config.ts`, for example a file filter or `-t <test name>`. |

Environment: `LUMEN_SAMPLES_DIR`, `LUMEN_E2E_OUT`, `LUMEN_E2E_WORKERS`, `LUMEN_E2E_APP`, `LUMEN_E2E_SHOTS`,
`LUMEN_E2E_USE_DISPLAY` ([reference](command-line-and-environment.md#end-to-end-variables)).

## lumen.sh

The desktop launcher used by the menu entry. It finds a Node 20+ install (the `PATH` first, then the newest nvm,
fnm or Volta install), rebuilds with `electron-vite build` when `out/main/index.js` is missing or older than a file
in `src/`, `package.json` or `electron.vite.config.ts`, then starts Electron. Arguments (files to open) are passed
through.

```text
scripts/lumen.sh [file …]
```

During a rebuild it shows a desktop notification (`notify-send`, when installed). Build output goes to
`/tmp/lumen-build.log`; a failed build is reported with a notification and exit code 1.

## install-desktop.sh

Installs Lumen into the Linux desktop for the current user, without root.

```text
scripts/install-desktop.sh [--pin | --uninstall]
```

It writes:

- `~/.local/share/applications/lumen.desktop`, which runs `scripts/lumen.sh %F` from **this checkout**;
- the app icon and a document icon under `~/.local/share/icons/hicolor/`;
- MIME types `application/x-powerbi-pbix`, `-pbit`, `-pbip` and `application/x-lumen-wbi` in
  `~/.local/share/mime/packages/lumen.xml`, each set to open with Lumen by default (`xdg-mime default`).

`--pin` also adds `lumen.desktop` to the pinned apps of the Cinnamon panel's grouped window list. `--uninstall`
removes the menu entry, MIME file and icons (a panel pin stays until you unpin it). Re-run the script after moving
or renaming the repository folder.

## fonts/make-semibold.py

Builds the bundled "Lumen Sans Semibold" face
(`src/renderer/src/assets/fonts/selawik/lumensans-semibold.woff2`) from Selawik Regular, emboldened to sit between
Selawik Regular and Bold, with Selawik Semibold's advance widths and kerning. Needs Python 3 with `fontTools` and
`brotli`. The output is committed; you only run this when you change the font.

```bash
python3 scripts/fonts/make-semibold.py
```

## icons/gen-fluent-color.mjs

Regenerates `src/renderer/src/icons/sets/fluentColor.generated.ts`, the barrel of the unsized `*Color` components of
`@fluentui/react-icons`. Run it after upgrading that package; `src/renderer/src/icons/registry.test.ts` fails while
the file is out of date. See [ICONS.md](../ICONS.md).

```bash
node scripts/icons/gen-fluent-color.mjs
```

## docs/check-env-vars.mjs

Finds every environment variable the code, tests and scripts read and checks that
[Command line and environment variables](command-line-and-environment.md) documents it.

```text
node scripts/docs/check-env-vars.mjs [--list]
```

Exit code 1 lists the missing variables with the files that read them; `--list` prints every variable and where it
is read.

## Related content

- [Command line and environment variables](command-line-and-environment.md)
- [Development environment](../developer/development-environment.md)
- [The sweep](../developer/the-sweep.md)
- [The compare tool](../developer/the-compare-tool.md)
- [End-to-end tests](../developer/end-to-end-tests.md)
- [Build and packaging](../developer/build-and-packaging.md)
