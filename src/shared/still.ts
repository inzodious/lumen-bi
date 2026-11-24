/**
 * Headless runs (capture, sweep, e2e) render without motion: the main process passes {@link STILL_ARG} to the renderer
 * (webPreferences `additionalArguments`), and the preload exposes `globalThis.__LUMEN_STILL__ = true`, which
 * `renderer/src/report/motion/env.ts` reads. Screenshots and `wbiReady` waits then never catch a visual mid-animation.
 */
export const STILL_ARG = '--lumen-still'
export const STILL_GLOBAL = '__LUMEN_STILL__'
