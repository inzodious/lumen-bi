/**
 * Global vitest setup.
 * Block decoding of PBIP `.pbi/cache.abf` files in every test: the parsing corpus may contain
 * confidential data, and no test needs a PBIP cache (PBIX decoding is tested with public samples).
 */
;(globalThis as { __LUMEN_BLOCK_CACHE_ABF__?: boolean }).__LUMEN_BLOCK_CACHE_ABF__ = true
