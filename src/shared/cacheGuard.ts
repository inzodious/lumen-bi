/**
 * `WBI_BLOCK_CACHE=1` guard: when Lumen runs on a corpus whose PBIP `.pbi/cache.abf` files must not
 * be decoded, the main process passes {@link BLOCK_CACHE_ARG} to the renderer (webPreferences
 * `additionalArguments`), and the preload exposes `globalThis.__LUMEN_BLOCK_CACHE_ABF__ = true` in the
 * page before any project opens. `src/core/io/open.ts` then refuses to read the cache (the same guard
 * `tests/setup.ts` sets for every vitest run).
 */

/** Renderer command-line switch carrying the guard (visible as `process.argv` in the preload). */
export const BLOCK_CACHE_ARG = '--wbi-block-cache'

/** The global flag read by `openProject` (src/core/io/open.ts). */
export const BLOCK_CACHE_GLOBAL = '__LUMEN_BLOCK_CACHE_ABF__'

/** True when the environment asks to block cache decoding (`WBI_BLOCK_CACHE` set to anything but '' / '0' / 'false'). */
export function blockCacheRequested(env: Record<string, string | undefined>): boolean {
  const v = env['WBI_BLOCK_CACHE']
  return v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false'
}

/** Extra renderer arguments for the main process `webPreferences.additionalArguments`. */
export function blockCacheArgs(env: Record<string, string | undefined>): string[] {
  return blockCacheRequested(env) ? [BLOCK_CACHE_ARG] : []
}

/** Preload side: does this renderer carry the guard switch? */
export function blockCacheFromArgv(argv: readonly string[]): boolean {
  return argv.includes(BLOCK_CACHE_ARG)
}
