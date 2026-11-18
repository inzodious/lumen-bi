# Set up a development environment

> **Applies to:** Developers

This how-to takes you from a fresh clone to a running development build, a passing test suite and a headless
screenshot. Follow it in order the first time; the commands were run as written on Linux with Node 24.

## Prerequisites

| Tool | Needed for | Notes |
|---|---|---|
| Linux (x64) | everything | Lumen is developed and tested on Linux only. |
| Node.js **20.19 or later** | everything | `package.json` declares `"engines": { "node": ">=20.19" }`; the build tool (Vite 8) needs it. Development uses Node 24. Distribution packages often ship an older Node: use [nvm](https://github.com/nvm-sh/nvm) or similar. |
| git | cloning, contributing | |
| `xvfb-run` (package `xvfb`) | `scripts/capture.sh`, `scripts/sweep.sh`, `e2e/run.sh` | Optional: without it these scripts show windows on your desktop. |
| Docker | `LUMEN_IT=1` connector tests | Optional. |
| `pdftoppm` (package `poppler-utils`) | `scripts/compare.sh` with a PDF reference | Optional. |
| Python 3 with `fontTools` and `brotli` | `scripts/fonts/make-semibold.py` | Only to rebuild the bundled font. |

Electron itself comes from `node_modules`; you do not install it separately.

## Steps

1. Clone the repository and enter it.

   ```bash
   git clone https://github.com/inzodious/lumen-bi.git
   cd lumen-bi
   ```

2. Select a recent Node.js. With nvm:

   ```bash
   nvm install 24
   nvm use 24
   node -v        # v24.x
   ```

3. Install the dependencies.

   ```bash
   npm install
   ```

   > [!IMPORTANT]
   > If several working copies (for example git worktrees) share one `node_modules` folder through links, do not
   > run `npm install` or `npm uninstall` in one of them without agreeing it with whoever uses the others: it changes
   > the packages under every copy at once.

4. Run the app with hot module replacement.

   ```bash
   npm run dev
   ```

   electron-vite builds `out/main/index.js` and `out/preload/index.cjs`, starts a Vite development server for the
   renderer (`http://localhost:5173/`) and launches Electron. Renderer edits reload in place; edits to `src/main` or
   `src/preload` restart Electron. **Ctrl+R** reloads the window, **F12** opens the developer tools.

5. Type-check the whole project (about 10 seconds).

   ```bash
   npm run typecheck
   ```

6. Run the unit and integration tests (about 20 to 30 seconds, offline).

   ```bash
   npm test
   ```

   A clean run reports a little over 200 test files and about 3,000 tests passing, with a few files skipped: those
   need one of the optional data sources described in [Testing](testing.md). Run one folder or file with
   `npx vitest run src/core/dax`.

7. Build a production bundle and start it.

   ```bash
   npm run build
   npm start
   ```

   `npm run build` writes `out/main`, `out/preload` and `out/renderer` (a few seconds). `npm start` runs
   `electron-vite preview`, which builds again the same way and then starts Electron on the result, so `npm start`
   alone is enough to try a production build; the scripts in the next step need `npm run build`.

8. Take a headless screenshot of the built-in sample (needs step 7's build).

   ```bash
   scripts/capture.sh /tmp/lumen-sample.png '#/?sample=1' '' 1440x900
   ```

   The script prints `captured /tmp/lumen-sample.png` and writes the renderer console to
   `/tmp/lumen-sample.png.log`.

9. Optionally, run the end-to-end journeys (about a minute; builds into `out/e2e/`).

   ```bash
   e2e/run.sh
   ```

## Result

You have a development build with hot reload, a green unit suite and a working headless capture. Next, read
[Conventions](conventions.md) and [Contributing](contributing.md).

## The `ELECTRON_RUN_AS_NODE` trap

VS Code's integrated terminal sets `ELECTRON_RUN_AS_NODE=1` (VS Code is itself an Electron app). With that variable
set, the Electron binary behaves as plain Node.js, and starting Lumen fails at once:

```text
SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'
```

Every npm script that starts Electron (`dev`, `start`) and every repository script (`capture.sh`, `sweep.sh`,
`lumen.sh`, `e2e/run.sh`) removes the variable with `env -u ELECTRON_RUN_AS_NODE`. When you start Electron yourself,
do the same:

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron . path/to/report.pbix
```

## Environment variables you will meet

| Variable | Purpose |
|---|---|
| `LUMEN_SAMPLES_DIR` | Folder of Microsoft's public sample `.pbix` files; enables the real-data regression tests and the sample-file end-to-end journeys. |
| `LUMEN_CORPUS_DIR` | Folder of your own PBIP projects to parse, round-trip and evaluate. Assertions are generic; never commit anything from it. |
| `LUMEN_IT` | `1` runs the live connector tests against Docker containers. |
| `LUMEN_PERF_STRICT` | `1` applies the strict 300 ms per-visual budget to the sample-file tests. |
| `WBI_BLOCK_CACHE` | `1` stops the app from decoding PBIP `.pbi/cache.abf` files. Use it when you open projects whose cached data must not be read. |
| `WBI_CAPTURE`, `WBI_ROUTE`, `WBI_OPEN`, `WBI_SIZE`, `WBI_TIMEOUT` | Headless capture; normally set for you by `scripts/capture.sh`. |
| `LUMEN_E2E_OUT` | Where end-to-end failure screenshots and logs go (default: a new temp folder). |

The complete list, with defaults and the files that read each one, is in
[Command line and environment variables](../reference/command-line-and-environment.md).

## Considerations and limitations

- Only Linux is supported and tested. The code has no Windows or macOS packaging, and nothing has been verified on
  those systems.
- The root `README.md` gives Node 22 as the minimum; `package.json` declares 20.19. The project is developed on
  Node 24, and only that version was used to check these steps.
- `npm run dev` and `npm run build` both write to `out/`. A sweep or capture running at the same time uses that
  folder; the end-to-end suite builds into `out/e2e/` so it is not affected.
- The app opened by `npm run dev` or `npm start` uses your real Electron profile (`~/.config/Lumen`): options, pane
  layout and recent files. Captures and end-to-end runs use throwaway profiles.

## Related content

- [Repository layout](repository-layout.md)
- [Conventions](conventions.md)
- [Testing](testing.md)
- [Debugging](debugging.md)
- [Command line and environment variables](../reference/command-line-and-environment.md)
- [Scripts](../reference/scripts.md)
