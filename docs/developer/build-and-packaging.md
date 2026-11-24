# Build and packaging

> **Applies to:** Developers

This article explains what the build produces, how Lumen is launched from a checkout, how the desktop integration
script registers it with Linux, and the state of distributable packages. Read it when you change the build, ship
Lumen to another machine or wonder why the menu entry rebuilds the app.

## Build outputs

`npm run build` runs `electron-vite build` with `electron.vite.config.ts`, which defines three bundles:

| Bundle | Entry | Output | Notes |
|---|---|---|---|
| main | `src/main/index.ts` | `out/main/index.js` | ES module; npm dependencies stay external (`externalizeDepsPlugin`) and load from `node_modules` at run time. |
| preload | `src/preload/index.ts` | `out/preload/index.cjs` | CommonJS (`format: 'cjs'`), as Electron preloads require. |
| renderer | `src/renderer/index.html` | `out/renderer/index.html` + `out/renderer/assets/` | React plugin, `sql.js` pre-bundled, worker format set to ES (no workers exist yet). About 16 MB, most of it in one main chunk; the gallery, the developer harnesses, the export libraries and the icon sets are separate lazy chunks. |

`package.json`'s `"main": "./out/main/index.js"` points Electron at the main bundle, so `electron .` in the
repository root starts the build. The three aliases (`@core`, `@renderer`, `@shared`) are resolved at build time.

The build prints one warning that you can ignore: `sql.js` is imported both statically (`src/renderer/src/main.tsx`)
and dynamically (`src/core/io/pbix/datamodel/sqlite.ts`), so the dynamic import does not split it into its own chunk.

Other builds:

| Command | Output | Used by |
|---|---|---|
| `npm run dev` | `out/main`, `out/preload` (development) + a Vite dev server for the renderer | development with hot reload |
| `npm start` | rebuilds `out/` and starts Electron (`electron-vite preview`) | trying a production build |
| `e2e/run.sh` | `out/e2e/` (`electron-vite build --outDir out/e2e`) | end-to-end journeys, isolated from `out/` |

## The launcher: scripts/lumen.sh

`scripts/lumen.sh` is how Lumen runs day to day from a checkout:

1. Finds a Node.js 20 or later: the one on `PATH`, else the newest install under nvm (`$NVM_DIR` or `~/.nvm`),
   fnm or Volta. A launch from the desktop menu does not load your shell profile, so `PATH` may only have the
   system's older Node.
2. Rebuilds with `electron-vite build` when `out/main/index.js` is missing or any file in `src/`, `package.json` or
   `electron.vite.config.ts` is newer. A desktop notification says "Building the latest version…"; the log goes to
   `/tmp/lumen-build.log`.
3. Starts `electron .` with `ELECTRON_RUN_AS_NODE` removed, passing its arguments (files to open) through.

So a `git pull` followed by opening a `.pbix` from the file manager runs the new code after a short build.

## Desktop integration: scripts/install-desktop.sh

`scripts/install-desktop.sh` registers the checkout with the desktop for the current user, without root:

- a menu entry `~/.local/share/applications/lumen.desktop` whose `Exec` is `scripts/lumen.sh %F` in **this** folder;
- icons under `~/.local/share/icons/hicolor/`;
- MIME types for `.pbix`, `.pbit`, `.pbip` and `.wbi` (`~/.local/share/mime/packages/lumen.xml`), each set to open
  with Lumen by default;
- with `--pin`, a pinned launcher in the Cinnamon panel.

`--uninstall` removes what it added. Re-run it after you move or rename the repository folder. See
[Scripts](../reference/scripts.md#install-desktopsh).

## Distributable packages

`package.json`'s `build` section configures electron-builder: app id `dev.lumen.app`, file associations for the four
extensions, `.wasm` files unpacked from the archive, output folder `dist/`.

| Command | Output |
|---|---|
| `npm run dist` | Linux AppImage and `.deb` |
| `npm run dist:win` (on Windows) | `Lumen-Setup-<version>.exe` (per-user NSIS installer, registers the file associations) and `Lumen-<version>-portable.exe` |

Only the packages the main process loads at run time (`@aws-sdk/client-s3`, `@azure/identity`,
`google-auth-library`, `mysql2`, `pg`, `tedious`, `sql.js`) are `dependencies`. Everything the renderer uses is bundled
by Vite, so it is a `devDependency` and stays out of the package. Move a package back to `dependencies` only when
`src/main` imports it.

CI (`.github/workflows/ci.yml`) builds the Windows installer and portable exe on every pull request, starts the
packaged app once with a sample report as a smoke test, and uploads both executables as the `Lumen-windows-x64`
artifact.

## Considerations and limitations

- Linux and Windows. There is no macOS build configuration.
- The app is not signed (Windows SmartScreen warns on first run), and there is no auto-update.
- The shell scripts in `scripts/` and `e2e/run.sh` (captures, sweeps, compare, desktop integration) need Linux and
  Xvfb. On Windows use the npm scripts.
- The renderer's main chunk is large (several megabytes) because the engines, decoders and every visual load at
  startup; only the gallery, developer routes, export libraries and icon sets are split out.
- `lumen.sh` rebuilds into the shared `out/` folder. A capture or sweep running from the same checkout at that
  moment can see a half-written build.

## Related content

- [Development environment](development-environment.md)
- [Scripts](../reference/scripts.md)
- [Dependencies and licences](dependencies-and-licences.md)
- [Architecture overview](architecture-overview.md)
