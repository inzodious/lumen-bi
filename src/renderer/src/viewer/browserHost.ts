/**
 * `window.wbi` for a published dashboard running in a plain browser: no files, dialogs or connectors. Any call the
 * reading view should never make rejects with a clear message instead of failing on an undefined bridge.
 */
const UNAVAILABLE = 'Not available in a published dashboard'

function section(name: string): unknown {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined
        // event subscriptions return an unsubscribe function
        if (/^on[A-Z]/.test(prop)) return () => () => undefined
        if (name === 'app') {
            if (prop === 'version') return ''
          if (prop === 'getPath') return async () => ''
          if (prop === 'getRecent' || prop === 'getLaunchFiles') return async () => []
          if (prop === 'addRecent') return async () => undefined
          if (prop === 'setTitle') return async (title: string) => void (document.title = title)
          if (prop === 'openExternal') return async (url: string) => void window.open(url, '_blank', 'noopener')
        }
        return async () => {
          throw new Error(`${UNAVAILABLE} (${name}.${prop})`)
        }
      }
    }
  )
}

/**
 * `crypto.randomUUID` exists only in secure contexts (https, localhost). A dashboard served over plain http on a home
 * network still needs ids, so fall back to an RFC 4122 v4 id from getRandomValues (available everywhere).
 */
export function ensureRandomUUID(c: { randomUUID?: () => string; getRandomValues<T extends ArrayBufferView>(a: T): T } | undefined = globalThis.crypto): void {
  if (!c || typeof c.randomUUID === 'function') return
  c.randomUUID = () => {
    const b = c.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }
}

export function installBrowserHost(): void {
  ensureRandomUUID()
  const w = window as unknown as { wbi?: unknown }
  if (w.wbi) return
  const cache = new Map<string, unknown>()
  w.wbi = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined
        if (!cache.has(prop)) cache.set(prop, section(prop))
        return cache.get(prop)
      }
    }
  )
}
