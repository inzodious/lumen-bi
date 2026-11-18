import { describe, expect, it } from 'vitest'
import { layoutTreemap } from './treemapLayout'
import { treemapNodes } from './Treemap'
import { buildCategorical } from '../../common/categorical'
import { FormatReader } from '../../common/fmtProps'
import { col, msr, scope, props, visualJson } from '../../gallery/registry'
import { mockCtx, theme } from '../scatter/__tests__/testCtx'

const areaOf = (r: { x0: number; y0: number; x1: number; y1: number }) => (r.x1 - r.x0) * (r.y1 - r.y0)

describe('treemap layout', () => {
  const groups = [
    { key: 'a', children: [{ key: 'a1', value: 60 }] },
    { key: 'b', children: [{ key: 'b1', value: 30 }] },
    { key: 'c', children: [{ key: 'c1', value: 10 }, { key: 'c2', value: 0 }] }
  ]
  it('areas are proportional to values and fill the box', () => {
    const r = layoutTreemap(groups, { width: 400, height: 300 })
    const total = 400 * 300
    expect(r.leaves.length).toBe(3) // zero values dropped
    for (const l of r.leaves) expect(areaOf(l.rect)).toBeCloseTo((total * l.value) / 100, 3)
    for (const l of r.leaves) {
      expect(l.rect.x0).toBeGreaterThanOrEqual(0)
      expect(l.rect.y1).toBeLessThanOrEqual(300 + 1e-9)
    }
  })
  it('largest tile at the top-left (PBI order)', () => {
    const r = layoutTreemap(groups, { width: 400, height: 300 })
    const a = r.leaves.find((l) => l.key === 'a1')!
    expect(a.rect.x0).toBe(0)
    expect(a.rect.y0).toBe(0)
  })
  it('squarified tiles are close to square', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ key: `g${i}`, children: [{ key: `l${i}`, value: 12 - i }] }))
    const r = layoutTreemap(many, { width: 600, height: 400 })
    const aspect = (x: { x0: number; y0: number; x1: number; y1: number }) => Math.max(x.x1 - x.x0, x.y1 - x.y0) / Math.min(x.x1 - x.x0, x.y1 - x.y0)
    const worstSq = Math.max(...r.leaves.map((l) => aspect(l.rect)))
    const dice = layoutTreemap(many, { width: 600, height: 400, tiling: 'alternating' })
    const worstDice = Math.max(...dice.leaves.map((l) => aspect(l.rect)))
    expect(worstSq).toBeLessThan(worstDice)
  })
  it('reserves a header strip for tall groups only, and applies padding', () => {
    const detail = [
      { key: 'big', children: [{ key: 'x', value: 70 }, { key: 'y', value: 20 }] },
      { key: 'tiny', children: [{ key: 'z', value: 1 }] }
    ]
    const r = layoutTreemap(detail, { width: 300, height: 200, groupHeader: 18 })
    const big = r.groups.find((g) => g.key === 'big')!
    expect(big.header).toBe(18)
    const leaves = r.leaves.filter((l) => l.group === 'big')
    expect(Math.min(...leaves.map((l) => l.rect.y0))).toBeCloseTo(big.rect.y0 + 18)
    expect(r.groups.find((g) => g.key === 'tiny')!.header).toBe(0)
    const padded = layoutTreemap(groups, { width: 400, height: 300, outerPadding: 5, innerPadding: 2 })
    expect(Math.min(...padded.leaves.map((l) => l.rect.x0))).toBe(5)
    expect(layoutTreemap([], { width: 10, height: 10 })).toEqual({ groups: [], leaves: [] })
  })
})

describe('treemap nodes from the sample model', () => {
  it('groups = Group values, leaves = Details; per-group fill override', () => {
    const json = visualJson('t', 'treemap', { Group: [col('Sales', 'Region')], Details: [col('Sales', 'Channel')], Values: [msr('Sales', 'Total Sales')] }, { objects: { dataPoint: [props({ fill: '#123456' }, scope('Sales', 'Region', 'Europe'))] } })
    const fmt = new FormatReader(json, theme)
    const d = buildCategorical(json, mockCtx(), { categoryRole: 'Group', seriesRole: 'Details', splitRoles: ['Values'], defaultSort: 'measureDesc', applyDefaultSortWhenUnsaved: true, fmt, maxSeries: 2000 })
    const { groups, leaves } = treemapNodes(d, fmt, true)
    expect(groups.length).toBe(4)
    expect(groups[0].label).toBe('North America')
    expect(leaves.filter((l) => l.group === groups[0].key).length).toBe(3)
    const europe = groups.find((g) => g.label === 'Europe')!
    expect(europe.color).toBe('#123456')
    expect(leaves.filter((l) => l.group === europe.key).every((l) => l.color === '#123456')).toBe(true)
    expect(leaves[0].identity.fields.length).toBe(2)
  })
})
