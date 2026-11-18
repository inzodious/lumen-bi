import { describe, expect, it } from 'vitest'
import type { LumenDiagram } from '@core/io/diagramSidecar'
import { DEFAULT_LINE_STYLE, applyFollow, createGroup, effectiveStyle, followMove, groupOf, patchGroup, setLineStyle, setMembership, setRoute, ungroup } from './diagramOps'

const tags = new Map<string, string | undefined>([
  ['Date', 'tag-date'],
  ['Product', undefined]
])

describe('groups', () => {
  it('createGroup names the group, records lineage tags and takes tables out of their old groups', () => {
    const d: LumenDiagram = { name: 'All tables' }
    expect(createGroup(d, [], tags)).toBeNull()
    const id = createGroup(d, ['Date', 'Product', 'Date'], tags)!
    expect(d.groups).toEqual([{ id, name: 'Group 1', tables: [{ name: 'Date', lineageTag: 'tag-date' }, { name: 'Product' }] }])
    const id2 = createGroup(d, ['Product', 'Store'], tags, '  Shops ')!
    expect(id2).not.toBe(id)
    expect(d.groups!.map((g) => [g.name, g.tables.map((t) => t.name)])).toEqual([
      ['Group 1', ['Date']],
      ['Shops', ['Product', 'Store']]
    ])
    // taking the last table of a group removes that group (the name was picked while "Group 1" still existed)
    createGroup(d, ['Date'], tags)
    expect(d.groups!.map((g) => g.name)).toEqual(['Shops', 'Group 2'])
    expect(groupOf(d, 'Date')!.name).toBe('Group 2')
    expect(groupOf(d, 'Nope')).toBeUndefined()
  })

  it('ungroup removes containers, never tables', () => {
    const d: LumenDiagram = { name: 'A', groups: [{ id: 'g1', name: 'One', tables: [{ name: 'T' }] }, { id: 'g2', name: 'Two', tables: [{ name: 'U' }] }] }
    ungroup(d, ['g1'])
    expect(d.groups!.map((g) => g.id)).toEqual(['g2'])
    ungroup(d, ['g2'])
    expect(d.groups).toBeUndefined()
  })

  it('setMembership moves tables between groups and drops emptied ones', () => {
    const d: LumenDiagram = { name: 'A', groups: [{ id: 'g1', name: 'One', tables: [{ name: 'T' }, { name: 'V' }], bounds: { x: 0, y: 0, width: 9, height: 9 } }, { id: 'g2', name: 'Two', tables: [{ name: 'U' }] }] }
    setMembership(d, new Map<string, string | null>([['T', 'g2'], ['U', 'g2'], ['Date', 'g1']]), tags)
    expect(d.groups!.map((g) => [g.id, g.tables.map((t) => t.name)])).toEqual([
      ['g1', ['V', 'Date']],
      ['g2', ['U', 'T']]
    ])
    // a container whose member left fits again
    expect(d.groups![0].bounds).toBeUndefined()
    setMembership(d, new Map<string, string | null>([['V', null], ['Date', null]]), tags)
    expect(d.groups!.map((g) => g.id)).toEqual(['g2'])
  })

  it('patchGroup edits name / colour / collapsed / bounds and stores no defaults', () => {
    const d: LumenDiagram = { name: 'A', groups: [{ id: 'g1', name: 'One', tables: [{ name: 'T' }] }] }
    patchGroup(d, 'g1', { name: '  Dims  ', color: 'blue', collapsed: true, bounds: { x: 1, y: 2, width: 3, height: 4 } })
    expect(d.groups![0]).toEqual({ id: 'g1', name: 'Dims', color: 'blue', collapsed: true, bounds: { x: 1, y: 2, width: 3, height: 4 }, tables: [{ name: 'T' }] })
    patchGroup(d, 'g1', { name: '   ', color: 'gray', collapsed: false, bounds: null })
    expect(d.groups![0]).toEqual({ id: 'g1', name: 'Dims', tables: [{ name: 'T' }] })
  })
})

describe('routes and styles', () => {
  it('setRoute forgets empty routes', () => {
    const d: LumenDiagram = { name: 'A' }
    setRoute(d, 'r', { waypoints: [{ x: 1, y: 2 }] })
    expect(d.routes).toEqual({ r: { waypoints: [{ x: 1, y: 2 }] } })
    setRoute(d, 'r', {})
    expect(d.routes).toBeUndefined()
    setRoute(d, 'missing', undefined)
    expect(d.routes).toBeUndefined()
  })

  it('the built-in default style is not stored; a line override beats the layout default', () => {
    const d: LumenDiagram = { name: 'A' }
    expect(effectiveStyle(d, undefined)).toBe(DEFAULT_LINE_STYLE)
    setLineStyle(d, 'curved')
    expect(d.lineStyle).toBe('curved')
    expect(effectiveStyle(d, {})).toBe('curved')
    expect(effectiveStyle(d, { style: 'orthogonal' })).toBe('orthogonal')
    setLineStyle(d, DEFAULT_LINE_STYLE)
    expect(d.lineStyle).toBeUndefined()
    // with a preferred default (fallback) the same rule applies relative to it
    expect(effectiveStyle(d, undefined, 'curved')).toBe('curved')
    setLineStyle(d, 'curved', 'curved')
    expect(d.lineStyle).toBeUndefined()
    setLineStyle(d, DEFAULT_LINE_STYLE, 'curved')
    expect(d.lineStyle).toBe(DEFAULT_LINE_STYLE)
    expect(effectiveStyle(d, undefined, 'curved')).toBe(DEFAULT_LINE_STYLE)
  })
})

describe('what follows moved cards', () => {
  const rels = [
    { name: 'r1', fromTable: 'Sales', toTable: 'Date' },
    { name: 'r2', fromTable: 'Sales', toTable: 'Product' }
  ]
  const diagram = (): LumenDiagram => ({
    name: 'A',
    routes: { r1: { waypoints: [{ x: 10, y: 10 }] }, r2: { waypoints: [{ x: 50, y: 50 }], from: { side: 'top', t: 0.5 } } },
    groups: [{ id: 'g1', name: 'G', tables: [{ name: 'Sales' }, { name: 'Date' }], bounds: { x: 0, y: 0, width: 100, height: 100 } }]
  })

  it('pinch points stay put when only one end of the line moves', () => {
    const f = followMove(diagram(), new Set(['Sales']), 30, 40, rels)
    expect(f.routes).toEqual({})
    expect(f.bounds).toEqual({})
  })

  it('pinch points and the manual extent travel when both tables / the whole group move', () => {
    const d = diagram()
    const f = followMove(d, new Set(['Sales', 'Date']), 30, 40, rels)
    expect(f.routes).toEqual({ r1: { waypoints: [{ x: 40, y: 50 }] } })
    expect(f.bounds).toEqual({ g1: { x: 30, y: 40, width: 100, height: 100 } })
    applyFollow(d, f)
    expect(d.routes!['r1'].waypoints).toEqual([{ x: 40, y: 50 }])
    expect(d.routes!['r2'].waypoints).toEqual([{ x: 50, y: 50 }])
    expect(d.groups![0].bounds).toEqual({ x: 30, y: 40, width: 100, height: 100 })
  })

  it('no movement, no change', () => {
    expect(followMove(diagram(), new Set(['Sales', 'Date']), 0, 0, rels)).toEqual({ routes: {}, bounds: {} })
  })
})
