import { afterEach, describe, expect, it, vi } from 'vitest'
import { BLOCK_CACHE_ARG, BLOCK_CACHE_GLOBAL, blockCacheArgs, blockCacheFromArgv, blockCacheRequested } from '../cacheGuard'

describe('WBI_BLOCK_CACHE guard', () => {
  it('maps the env flag to a renderer switch', () => {
    expect(blockCacheRequested({ WBI_BLOCK_CACHE: '1' })).toBe(true)
    expect(blockCacheRequested({ WBI_BLOCK_CACHE: 'yes' })).toBe(true)
    expect(blockCacheRequested({})).toBe(false)
    expect(blockCacheRequested({ WBI_BLOCK_CACHE: '' })).toBe(false)
    expect(blockCacheRequested({ WBI_BLOCK_CACHE: '0' })).toBe(false)
    expect(blockCacheRequested({ WBI_BLOCK_CACHE: 'false' })).toBe(false)
    expect(blockCacheArgs({ WBI_BLOCK_CACHE: '1' })).toEqual([BLOCK_CACHE_ARG])
    expect(blockCacheArgs({})).toEqual([])
    expect(blockCacheFromArgv(['electron', '--type=renderer', BLOCK_CACHE_ARG])).toBe(true)
    expect(blockCacheFromArgv(['electron', '--type=renderer'])).toBe(false)
    // must be the global name src/core/io/open.ts checks
    expect(BLOCK_CACHE_GLOBAL).toBe('__LUMEN_BLOCK_CACHE_ABF__')
  })
})

describe('preload exposes the guard to the page', () => {
  const argv = process.argv
  afterEach(() => {
    process.argv = argv
    vi.resetModules()
    vi.doUnmock('electron')
  })

  async function exposedWith(args: string[]): Promise<Record<string, unknown>> {
    const exposed: Record<string, unknown> = {}
    vi.resetModules()
    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld: (k: string, v: unknown) => (exposed[k] = v) },
      ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() }
    }))
    process.argv = [...argv, ...args]
    await import('../../preload/index')
    return exposed
  }

  it('sets __LUMEN_BLOCK_CACHE_ABF__ when main passes the switch', async () => {
    const exposed = await exposedWith([BLOCK_CACHE_ARG])
    expect(exposed[BLOCK_CACHE_GLOBAL]).toBe(true)
    expect(exposed['wbi']).toBeTruthy()
  })

  it('leaves it unset otherwise', async () => {
    const exposed = await exposedWith([])
    expect(BLOCK_CACHE_GLOBAL in exposed).toBe(false)
  })
})
