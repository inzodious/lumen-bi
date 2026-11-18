# The app does not start or build

> **Applies to:** Creators · Analysts · Developers

This article helps when Lumen does not start, the build fails, or Electron behaves strangely. Most cases come down
to the Node.js version, an environment variable, or missing dependencies.

## Nothing happens when you start Lumen from the menu

The menu entry runs `scripts/lumen.sh`, which rebuilds Lumen when the sources changed (see
[What the launcher does](../get-started/install-on-linux.md#what-the-launcher-does-when-it-starts)). If the build
fails, the launcher stops before any window appears.

1. Look for a desktop notification: "Building needs Node.js 20 or newer (found …)" or
   "Build failed — see /tmp/lumen-build.log". Notifications need `notify-send`; without it the failure is silent.
2. Open the build log:

   ```bash
   less /tmp/lumen-build.log
   ```

3. Run the launcher from a terminal to see its output directly:

   ```bash
   scripts/lumen.sh
   ```

> [!NOTE]
> `/tmp/lumen-build.log` is overwritten by each build the launcher runs, and your system may clear `/tmp` at
> restart.

## The build fails: Node.js is too old

Lumen's build tools need **Node.js 20.19 or later**.

1. Check the version that the build uses:

   ```bash
   node --version
   ```

2. If it is older, install a newer Node.js (for example `nvm install 24` and `nvm use 24`).
3. A menu launch does not read your shell profile, so `nvm use` in a terminal does not affect it. The launcher looks
   for the newest Node.js installed by nvm, fnm or Volta when the `node` on its `PATH` is older than 20; make sure a
   suitable version is installed through one of them, or that the system `node` is new enough.

> [!WARNING]
> The launcher accepts any Node.js 20 release, while the build needs 20.19 or later. With Node.js 20.0 to 20.18 the
> launcher starts the build and the build fails. Install Node.js 20.19+ or 22+ to avoid this.

## Electron starts as Node.js, or "Cannot find module" from electron

Symptom: running the `electron` binary prints a Node.js prompt or treats `.` as a script, or Lumen exits at once
with an error about Electron APIs being undefined.

Cause: the environment variable `ELECTRON_RUN_AS_NODE=1` is set. Visual Studio Code sets it in its integrated
terminals. It makes Electron behave as plain Node.js.

Fix: use the npm scripts (`npm run dev`, `npm start`) or the repository scripts (`scripts/lumen.sh`,
`scripts/capture.sh`, `e2e/run.sh`), which remove the variable. When you run Electron yourself, remove it:

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .
```

## npm start shows an old version or fails

`npm start` previews the last build in `out/`; it does not build. Run `npm run build` first, or use `npm run dev`.

## Dependencies are missing

Symptom: the build fails with "Cannot find module" or "Failed to resolve import".

Fix: run `npm install` in the repository folder. After `git pull`, run it again whenever `package.json` or
`package-lock.json` changed.

## The window opens but stays blank or shows an error

1. Open the developer tools with Ctrl+Shift+I (or F12) and look at the **Console** tab.
2. Delete Lumen's settings to rule out a damaged preference (this also clears the recent-files list):

   ```bash
   mv ~/.config/Lumen ~/.config/Lumen.bak
   ```

3. Start Lumen again. If it works, the old settings were the cause.

## Lumen starts on a headless machine or over SSH

Lumen is a desktop application and needs a display. For screenshots, tests and report sweeps without a display,
the repository's scripts use `xvfb-run` (package `xvfb`) when it is installed. See
[Command line and environment variables](../reference/command-line-and-environment.md).

## Related content

- [Install Lumen on Linux](../get-started/install-on-linux.md)
- [Command line and environment variables](../reference/command-line-and-environment.md)
- [Scripts reference](../reference/scripts.md)
- [Frequently asked questions](faq.md)
