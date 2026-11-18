import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { Immer } from 'immer'
import { cloneDeep } from './clone'

const immer = new Immer({ autoFreeze: false })

describe('cloneDeep', () => {
  it('copies plain data like structuredClone (Dates, Maps, shared references, cycles)', () => {
    const shared = { k: 1 }
    const src: any = { d: new Date(Date.UTC(2024, 0, 2)), m: new Map([['a', [1, 2]]]), a: shared, b: shared, u: undefined }
    src.self = src
    const c = cloneDeep(src)
    expect(c).not.toBe(src)
    expect(c.d).toEqual(src.d)
    expect(c.d).not.toBe(src.d)
    expect(c.m.get('a')).toEqual([1, 2])
    expect(c.a).toBe(c.b)
    expect(c.a).not.toBe(shared)
    expect(c.self).toBe(c)
    expect('u' in c).toBe(true)
    expect(cloneDeep(5)).toBe(5)
    expect(cloneDeep(null)).toBe(null)
    expect(cloneDeep(undefined)).toBe(undefined)
  })

  it('unwraps an immer draft (structuredClone throws DataCloneError on one)', () => {
    const base = { page: { visuals: [{ name: 'v', json: { position: { x: 1 } } }] } }
    immer.produce(base, (d) => {
      expect(() => structuredClone(d.page)).toThrow(/could not be cloned/)
      d.page.visuals[0].json.position.x = 2 // modified drafts give their current value
      const c = cloneDeep(d.page)
      expect(c).toEqual({ visuals: [{ name: 'v', json: { position: { x: 2 } } }] })
      c.visuals[0].json.position.x = 9
      expect(d.page.visuals[0].json.position.x).toBe(2)
    })
    expect(base.page.visuals[0].json.position.x).toBe(1)
  })

  it('unwraps drafts nested in plain objects built from a draft (spread / rest destructuring)', () => {
    const base = { card: { name: 'c', filter: { Where: [{ x: 1 }] }, field: { Column: { Property: 'A' } } } }
    immer.produce(base, (d) => {
      const { field, ...rest } = d.card
      const c = cloneDeep({ ...rest, expression: field, list: [d.card.filter] })
      expect(c).toEqual({ name: 'c', filter: { Where: [{ x: 1 }] }, expression: { Column: { Property: 'A' } }, list: [{ Where: [{ x: 1 }] }] })
      expect(JSON.stringify(c)).toContain('Where')
    })
  })

  it('the copy outlives the edit (no revoked proxies left behind)', () => {
    let kept: any
    immer.produce({ a: { b: [1, { c: 2 }] } }, (d) => {
      kept = cloneDeep({ wrap: d.a })
    })
    expect(kept.wrap.b[1].c).toBe(2)
  })
})

/**
 * Guard: document state is copied only through `cloneDeep`. A direct `structuredClone(...)` (or JSON round-trip copy)
 * throws / misbehaves on an immer draft whenever the code runs inside a store mutation, which is the defect class
 * behind "Duplicate page does nothing" and fields dropped from wells. Exceptions need an entry here with a reason.
 */
const ALLOWED: Record<string, string> = {
  'src/core/clone.ts': 'the helper itself'
}

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules' && name !== '__tests__') sources(p, out)
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p)
  }
  return out
}

describe('no direct deep copies of state', () => {
  it('src/ calls cloneDeep, never structuredClone or JSON.parse(JSON.stringify(…)) (allow-list with reasons)', () => {
    const root = resolve(import.meta.dirname, '../..')
    const offenders: string[] = []
    for (const file of sources(join(root, 'src'))) {
      const rel = relative(root, file).split('\\').join('/')
      if (rel in ALLOWED) continue
      const text = readFileSync(file, 'utf8')
      text.split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '')
        if (/\bstructuredClone\s*\(/.test(code) || /JSON\.parse\(\s*JSON\.stringify\(/.test(code)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
