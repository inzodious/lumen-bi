import { describe, expect, it } from 'vitest'
import { breakdownSteps, DEFAULT_MAX_BREAKDOWNS, labelAnchor, normalizeMaxBreakdowns, simpleSteps, stepExtent } from './waterfallMath'
import { stepsOf } from './Waterfall'
import { buildCategorical } from '../../common/categorical'
import { FormatReader } from '../../common/fmtProps'
import { col, msr, visualJson } from '../../gallery/registry'
import { mockCtx, theme } from '../scatter/__tests__/testCtx'

describe('waterfall steps', () => {
  it('simple steps with and without the total column', () => {
    const s = simpleSteps([5, -2, null], ['a', 'b', 'c'])
    expect(s.map((x) => x.kind)).toEqual(['increase', 'decrease', 'increase', 'total'])
    expect(s[3]).toMatchObject({ start: 0, end: 3, value: 3 })
    expect(simpleSteps([5, -2], ['a', 'b'], { total: false }).length).toBe(2)
    expect(stepExtent(simpleSteps([-4, 1], ['a', 'b']))).toEqual([-4, 0])
  })

  it('breakdown default keeps the top 5 changes and folds the rest into Other', () => {
    const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    const prev = [10, 10, 10, 10, 10, 10, 10]
    const next = [17, 4, 15, 14, 13, 12, 11] // deltas 7,-6,5,4,3,2,1
    const s = breakdownSteps(['2023', '2024'], labels, [prev, next])
    expect(DEFAULT_MAX_BREAKDOWNS).toBe(5)
    expect(s.map((x) => x.label)).toEqual(['2023', 'A', 'B', 'C', 'D', 'E', 'Other', '2024'])
    const other = s.find((x) => x.kind === 'other')!
    expect(other.value).toBe(3)
    expect(other.others).toEqual([5, 6])
    // running total ends at the next category total
    const before = s[s.length - 2]
    expect(before.end).toBe(86)
    expect(s[s.length - 1]).toMatchObject({ kind: 'total', end: 86 })
  })

  it('omits unchanged breakdown items and has no Other when all fit', () => {
    const s = breakdownSteps(['x', 'y'], ['A', 'B'], [
      [1, 2],
      [1, 5]
    ])
    expect(s.map((x) => x.label)).toEqual(['x', 'B', 'y'])
  })

  it('normalizes maxBreakdowns', () => {
    expect(normalizeMaxBreakdowns(undefined)).toBe(5)
    expect(normalizeMaxBreakdowns(0)).toBe(1)
    expect(normalizeMaxBreakdowns(99)).toBe(28)
    expect(normalizeMaxBreakdowns(3.4)).toBe(3)
  })

  it('label anchors: outside end above increases, below decreases, inside fallbacks', () => {
    const plot = { y: 0, h: 200 }
    const inc = { kind: 'increase' as const, label: '', start: 0, end: 10, value: 10 }
    const dec = { kind: 'decrease' as const, label: '', start: 10, end: 5, value: -5 }
    expect(labelAnchor(inc, 100, 150, 12, 'Auto', plot)).toEqual({ y: 92, inside: false })
    expect(labelAnchor(dec, 100, 150, 12, 'Auto', plot)).toEqual({ y: 158, inside: false })
    expect(labelAnchor(inc, 2, 150, 12, 'Auto', plot)).toEqual({ y: 10, inside: true })
    expect(labelAnchor(inc, 100, 150, 12, 'InsideCenter', plot)).toEqual({ y: 125, inside: true })
    expect(labelAnchor(inc, 100, 150, 12, 'InsideBase', plot)).toEqual({ y: 142, inside: true })
    // bar too short for an inside label → outside end
    expect(labelAnchor(inc, 100, 108, 12, 'InsideCenter', plot)).toEqual({ y: 92, inside: false })
  })
})

describe('waterfall data', () => {
  it('category + breakdown from the sample model', () => {
    const json = visualJson('t', 'waterfallChart', { Category: [col('Sales', 'Year')], Breakdown: [col('Sales', 'Product')], Y: [msr('Sales', 'Total Sales')] })
    const d = buildCategorical(json, mockCtx(), { seriesRole: 'Breakdown', splitRoles: ['Y'], defaultSort: 'categoryAsc', fmt: new FormatReader(json, theme), maxSeries: 1000 })
    const steps = stepsOf(d, { maxBreakdowns: 3, totals: true })
    expect(steps[0]).toMatchObject({ kind: 'total', label: '2023' })
    expect(steps.filter((s) => s.kind === 'increase' || s.kind === 'decrease').length).toBe(3)
    expect(steps.some((s) => s.kind === 'other')).toBe(true)
    expect(steps[steps.length - 1]).toMatchObject({ kind: 'total', label: '2024' })
    const noTotal = buildCategorical(visualJson('t', 'waterfallChart', { Category: [col('Sales', 'Quarter')], Y: [msr('Sales', 'Profit')] }), mockCtx(), { seriesRole: 'Breakdown', splitRoles: ['Y'] })
    expect(stepsOf(noTotal, { maxBreakdowns: 5, totals: false }).some((s) => s.kind === 'total')).toBe(false)
  })
})
