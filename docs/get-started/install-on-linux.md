# Install Lumen on Linux

> **Applies to:** Creators · Analysts · Developers

This article explains how to get Lumen running on a Linux computer: build it from source, start it, add it to your
desktop's application menu with file associations, update it and remove it again.

> [!IMPORTANT]
> There is no installer and no prebuilt package. You build Lumen from its source code with Node.js and run it from
> the source folder. The repository has a packaging script (`npm run dist`), but in this version it does not produce
> a package; see [below](#build-an-appimage-or-a-deb-package).

## Requirements

| Requirement | Details |
|---|---|
| Operating system | A desktop Linux distribution. Lumen is developed on Linux Mint with the Cinnamon desktop; the desktop integration script uses the freedesktop.org standards (`.desktop` files, shared MIME info, `xdg-mime`) that GNOME, KDE Plasma, Cinnamon, MATE and Xfce follow. |
| Node.js | Version **20.19 or later** (`package.json` declares `"engines": { "node": ">=20.19" }`). Development uses Node.js 24. Install it with your distribution, with [nvm](https://github.com/nvm-sh/nvm), fnm or Volta. |
| npm | The version that comes with Node.js. |
| Git | To clone the repository and to update it. |
| Disk space | About 1.5 GB: the `node_modules` folder alone is about 1.3 GB. |
| Optional | `notify-send` (libnotify) for the launcher's "building" notifications; `xvfb-run` (package `xvfb`) for headless screenshots and tests. |

Lumen bundles Electron (which brings its own Chromium) through npm, so you do not install a browser or Electron
separately. None of its npm dependencies needs a C/C++ compiler.

## Build and run

1. Clone the repository and change into it:

   ```bash
   git clone <repository-url> lumen-bi
   cd lumen-bi
   ```

2. Install the dependencies:

   ```bash
   npm install
   ```

3. Build the application. The output goes to the `out/` folder.

   ```bash
   npm run build
   ```

4. Start the built application:

   ```bash
   npm start
   ```

   Lumen opens with the **Welcome to Lumen** screen. Continue with
   [Quickstart: open a report](quickstart-open-a-report.md).

To work on Lumen itself, run `npm run dev` instead of steps 3 and 4: it starts the application with live reload of
the user interface. The [developer guide](../developer/README.md) covers the development workflow.

> [!NOTE]
> If you start Lumen from a terminal inside Visual Studio Code, the terminal sets `ELECTRON_RUN_AS_NODE=1`, which
> makes Electron behave like plain Node.js. The `npm` scripts and the repository's shell scripts remove the variable
> for you. If you run the `electron` binary yourself, use `env -u ELECTRON_RUN_AS_NODE`. See
> [The app does not start or build](../troubleshooting/the-app-does-not-start-or-build.md).

## Add Lumen to the desktop

`scripts/install-desktop.sh` adds Lumen to your application menu and makes it the default application for Power BI
files. It installs for the current user only and does not need `sudo`.

```bash
scripts/install-desktop.sh          # menu entry, icons and file associations
scripts/install-desktop.sh --pin    # the same, and pin Lumen to the Cinnamon panel
```

The script:

- writes `~/.local/share/applications/lumen.desktop`, which starts `scripts/lumen.sh` from **this** checkout (the
  entry stores the absolute path of the folder you ran it from);
- copies the Lumen icon into `~/.local/share/icons/hicolor/` (as the application icon and as the document icon);
- registers four file types in `~/.local/share/mime/packages/lumen.xml`: `*.pbix` (Power BI report), `*.pbit`
  (Power BI report template), `*.pbip` (Power BI project) and `*.wbi` (Lumen project bundle);
- makes Lumen the default application for those four types with `xdg-mime default`;
- with `--pin`, adds `lumen.desktop` to the pinned applications of the Cinnamon panel's grouped window list. On other
  desktops `--pin` does nothing beyond the normal installation; pin Lumen with your desktop's own menu.

After it runs, double-clicking a `.pbix`, `.pbit`, `.pbip` or `.wbi` file in your file manager opens it in Lumen.

> [!IMPORTANT]
> The menu entry points at the folder you installed from. If you move or rename the repository folder, run
> `scripts/install-desktop.sh` again.

## What the launcher does when it starts

The menu entry and the file associations run `scripts/lumen.sh`. Each time it starts, the launcher:

1. Looks for Node.js 20 or later. A program started from the desktop menu does not read your shell profile, so the
   `node` on its `PATH` may be an old system version. If it is, the launcher looks for the newest Node.js installed by
   nvm (`$NVM_DIR` or `~/.nvm`), fnm (`~/.local/share/fnm`) or Volta (`~/.volta`) and uses that.
2. Checks whether the build is current. If `out/main/index.js` is missing, or any file in `src/`, `package.json` or
   `electron.vite.config.ts` is newer than it, the launcher rebuilds the application first. It shows a desktop
   notification ("Building the latest version…") when `notify-send` is available, and writes the build output to
   **`/tmp/lumen-build.log`**. If the build fails, it shows "Build failed — see /tmp/lumen-build.log" and stops.
3. Starts Electron with `ELECTRON_RUN_AS_NODE` removed from the environment and passes on the files it was given.

Because of step 2, the first start after an update takes a little longer: the launcher rebuilds before the window
appears.

> [!NOTE]
> The launcher checks for Node.js **20** or later, while `package.json` asks for **20.19** or later. A Node.js 20
> release older than 20.19 passes the launcher's check and then fails during the build. Use Node.js 20.19 or later.

### Files you can pass on the command line

`scripts/lumen.sh` accepts a file to open. Lumen opens the first argument that ends in `.pbix`,
`.pbit`, `.pbip` or `.wbi`, or names a `*.Report` or `*.SemanticModel` folder:

```bash
scripts/lumen.sh ~/reports/Sales.pbix
scripts/lumen.sh ~/projects/Sales/Sales.Report
```

Other files and folders are ignored on the command line; open them from **File > Open** instead (a project folder
that contains a `.pbip` file, or a `model.bim` file, for example). Each launch starts a separate Lumen window: a second
file opened from the file manager opens in a new window rather than in the one already running.

## Update Lumen

1. Get the latest source:

   ```bash
   git pull
   ```

2. If `package.json` or `package-lock.json` changed, install the dependencies again:

   ```bash
   npm install
   ```

3. Start Lumen from the menu (the launcher rebuilds because the sources changed) or run `npm run build` and
   `npm start`.

You do not need to run `scripts/install-desktop.sh` again after an update unless you moved the folder.

## Uninstall

1. Remove the desktop integration:

   ```bash
   scripts/install-desktop.sh --uninstall
   ```

   This removes the menu entry, the MIME type definitions and the icons the script installed. A Cinnamon panel pin
   stays until you unpin it. The default-application choices that `xdg-mime` recorded in your `mimeapps.list` are
   not removed; they have no effect once the menu entry is gone.

2. Delete the repository folder.

3. Optionally, delete your settings and recent-files list. Lumen keeps them in Electron's user-data folder for the
   application, `~/.config/Lumen` on a standard setup (recent files in `recent.json`; options, pane layout and
   canvas preferences in the `Local Storage` subfolder).

## Build an AppImage or a .deb package

`npm run dist` builds the application and then runs electron-builder for Linux with two targets, AppImage and
`.deb`, as configured in the `build` section of `package.json` (output folder `dist/`, executable name `lumen`,
file associations for `.pbix`, `.pbit`, `.pbip` and `.wbi`).

> [!WARNING]
> In this version `npm run dist` does not produce a package: electron-builder stops with a configuration error
> because it rejects the `build.linux.desktop` setting in `package.json`. Packaging is not part of this project's
> tested workflow. Use the source checkout with `scripts/install-desktop.sh` instead.

## Considerations and limitations

- There are no Windows or macOS builds, no published packages, and `npm run dist` does not currently build one.
- The desktop entry runs the source checkout through `scripts/lumen.sh`; it is not a system-wide installation.
- `--pin` only knows the Cinnamon panel.
- The MIME type names that `scripts/install-desktop.sh` registers (`application/x-powerbi-pbix`,
  `application/x-lumen-wbi`, …) differ from the ones the electron-builder configuration declares for packages
  (`application/vnd.ms-powerbi.pbix`, `application/x-lumen-bundle`). If you install both a package and the
  script's integration, you may see two entries for the same extension in your file manager's "Open with" list.

## Related content

- [Quickstart: open a report](quickstart-open-a-report.md)
- [The app does not start or build](../troubleshooting/the-app-does-not-start-or-build.md)
- [Command line and environment variables](../reference/command-line-and-environment.md)
- [Scripts reference](../reference/scripts.md)
- [Developer guide](../developer/README.md)
