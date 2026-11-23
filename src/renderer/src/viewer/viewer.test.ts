import { describe, expect, it } from 'vitest'
import { ensureRandomUUID } from './browserHost'
import { manifestUrl } from './load'

describe('viewer', () => {
  it('finds the manifest next to the page or at ?src=', () => {
    expect(manifestUrl({ href: 'https://x.test/dash/', search: '' })).toBe('https://x.test/dash/lumen-publish.json')
    expect(manifestUrl({ href: 'https://x.test/dash/index.html', search: '' })).toBe('https://x.test/dash/lumen-publish.json')
    expect(manifestUrl({ href: 'https://x.test/viewer/', search: '?src=/d/sales' })).toBe('https://x.test/d/sales/lumen-publish.json')
    expect(manifestUrl({ href: 'https://x.test/viewer/', search: '?src=../d/sales/' })).toBe('https://x.test/d/sales/lumen-publish.json')
    expect(manifestUrl({ href: 'https://x.test/viewer/', search: '?src=/d/m.json' })).toBe('https://x.test/d/m.json')
  })

  it('provides randomUUID outside secure contexts', () => {
    const c = { getRandomValues: <T extends ArrayBufferView>(a: T) => globalThis.crypto.getRandomValues(a as unknown as Uint8Array) as unknown as T } as { randomUUID?: () => string; getRandomValues<T extends ArrayBufferView>(a: T): T }
    ensureRandomUUID(c)
    const id = c.randomUUID!()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(c.randomUUID!()).not.toBe(id)
  })
})
