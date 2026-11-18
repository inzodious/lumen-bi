import { describe, expect, it } from 'vitest'
import { columnExpr, identitiesToFilter } from '@core/report/sq'
import { createMockHost } from '../../../common/mockHost'
import { col, msr, props, visualJson } from '../../../gallery/registry'
import {
  binIndex,
  binLabel,
  defaultMinSupport,
  evaluateSegment,
  mean,
  quantileBins,
  rankInfluencers,
  segmentField,
  topSegments,
  variance,
  welchT,
  type Moments,
  type Sample
} from '../keyInfluencers/stats'
import { computeKeyInfluencers, influencersTable, targetKey } from '../keyInfluencers/query'
import { buildCustomerModel, customerEngine, CUSTOMER_ROWS } from '../sampleCustomers'

/** n rows of which `hits` have the target value (indicator moments). */
const ind = (n: number, hits: number): Moments => ({ n, s: hits, ss: hits })

describe('moments & tests', () => {
  it('mean / variance / Welch t', () => {
    // values 1,2,3,4 → mean 2.5, var 1.6667
    const m = { n: 4, s: 10, ss: 30 }
    expect(mean(m)).toBe(2.5)
    expect(variance(m)).toBeCloseTo(5 / 3, 10)
    expect(variance({ n: 1, s: 3, ss: 9 })).toBe(0)
    const a = { n: 4, s: 10, ss: 30 }
    const b = { n: 4, s: 18, ss: 86 } // 3,4,5,6
    expect(welchT(a, b)).toBeCloseTo(-2 / Math.sqrt(5 / 3 / 4 + 5 / 3 / 4), 10)
    expect(welchT({ n: 3, s: 3, ss: 3 }, { n: 3, s: 0, ss: 0 })).toBe(Infinity)
  })
})

describe('binning', () => {
  it('weighted quantile cuts at data values', () => {
    const vals = Array.from({ length: 10 }, (_, i) => ({ v: i + 1, w: 1 }))
    const bins = quantileBins(vals, 5)
    expect(bins.map((b) => b.upTo)).toEqual([2, 4, 6, 8, Infinity])
    expect(bins[0].after).toBe(-Infinity)
    expect(binIndex(bins, 1)).toBe(0)
    expect(binIndex(bins, 3)).toBe(1)
    expect(binIndex(bins, 10)).toBe(4)
    // heavy weight on one value collapses cuts
    const skew = quantileBins([{ v: 0, w: 90 }, { v: 1, w: 5 }, { v: 2, w: 5 }], 4)
    expect(skew.map((b) => b.upTo)).toEqual([0, Infinity]) // 90% of the rows are 0: "0 or less" / "more than 0"
  })
  it('labels like Power BI ranges', () => {
    const f = (v: number) => String(v)
    expect(binLabel({ after: -Infinity, upTo: 12 }, 1, f)).toBe('12 or less')
    expect(binLabel({ after: 12, upTo: 24 }, 13, f)).toBe('13 - 24')
    expect(binLabel({ after: 12, upTo: 13 }, 13, f)).toBe('13')
    expect(binLabel({ after: 24, upTo: Infinity }, 25, f)).toBe('more than 24')
  })
  it('segments numeric fields into bins (blank kept apart) and categories as-is', () => {
    const samples: Sample[] = []
    for (let v = 1; v <= 20; v++) samples.push({ attrs: [v, v % 2 ? 'odd' : 'even'], n: 1, s: 0, ss: 0 })
    samples.push({ attrs: [null, 'odd'], n: 3, s: 0, ss: 0 })
    const num = segmentField(samples, 0, { numeric: true, label: (v) => String(v), maxBins: 4 })
    expect(num.binned).toBe(true)
    expect(num.segments.map((s) => s.label)).toEqual(['5 or less', '6 - 10', '11 - 15', 'more than 15', '(Blank)'])
    expect(num.segments.map((s) => s.m.n)).toEqual([5, 5, 5, 5, 3])
    expect(num.assign(7)).toBe(1)
    expect(num.assign(null)).toBe(4)
    const cat = segmentField(samples, 1, { numeric: false, label: (v) => String(v), order: (a, b) => String(a).localeCompare(String(b)) })
    expect(cat.binned).toBe(false)
    expect(cat.segments.map((s) => [s.label, s.m.n])).toEqual([
      ['even', 10],
      ['odd', 13]
    ])
    // few distinct numbers stay categorical
    const few = segmentField(samples.slice(0, 5), 0, { numeric: true, label: (v) => String(v) })
    expect(few.binned).toBe(false)
  })
})

describe('influencer ranking', () => {
  const total = ind(1000, 140)
  it('lift = P(target | segment) / P(target | rest)', () => {
    const inf = evaluateSegment({ key: 'a', label: 'A', order: 0, m: ind(100, 50) }, total, 0, { kind: 'categorical', direction: 'increase', minSupport: 10 })!
    expect(inf.mean).toBe(0.5)
    expect(inf.restMean).toBeCloseTo(90 / 900, 10)
    expect(inf.impact).toBeCloseTo(5, 10)
  })
  it('requires support, significance and the right direction', () => {
    const opts = { kind: 'categorical' as const, direction: 'increase' as const, minSupport: 10 }
    expect(evaluateSegment({ key: 'small', label: 'S', order: 0, m: ind(5, 5) }, total, 0, opts)).toBeNull()
    expect(evaluateSegment({ key: 'flat', label: 'F', order: 0, m: ind(100, 15) }, total, 0, opts)).toBeNull()
    expect(evaluateSegment({ key: 'low', label: 'L', order: 0, m: ind(300, 10) }, total, 0, opts)).toBeNull()
  })
  it('continuous: mean difference vs the rest; Decrease keeps lower segments', () => {
    // segment: 50 rows of 20; rest: 50 rows alternating 9/11 (mean 10)
    const seg = { n: 50, s: 1000, ss: 50 * 400 }
    const rest = { n: 50, s: 500, ss: 25 * 81 + 25 * 121 }
    const tot = { n: 100, s: 1500, ss: seg.ss + rest.ss }
    const up = evaluateSegment({ key: 'hi', label: 'H', order: 0, m: seg }, tot, 0, { kind: 'continuous', direction: 'increase', minSupport: 10 })!
    expect(up.diff).toBeCloseTo(10, 10)
    expect(up.impact).toBeCloseTo(10, 10)
    expect(evaluateSegment({ key: 'hi', label: 'H', order: 0, m: seg }, tot, 0, { kind: 'continuous', direction: 'decrease', minSupport: 10 })).toBeNull()
    const down = evaluateSegment({ key: 'lo', label: 'L', order: 0, m: rest }, tot, 0, { kind: 'continuous', direction: 'decrease', minSupport: 10 })!
    expect(down.diff).toBeCloseTo(-10, 10)
    expect(down.impact).toBeCloseTo(10, 10)
  })
  it('sorts by impact or by count', () => {
    const fields = [
      {
        field: 0,
        binned: false,
        assign: () => 0,
        segments: [
          { key: 'a', label: 'A', order: 0, m: ind(100, 60) },
          { key: 'b', label: 'B', order: 1, m: ind(400, 120) }
        ]
      }
    ]
    const tot = ind(1000, 200)
    const byImpact = rankInfluencers(fields, tot, { kind: 'categorical', direction: 'increase', minSupport: 10 })
    expect(byImpact.map((i) => i.segment.key)).toEqual(['a', 'b'])
    const byCount = rankInfluencers(fields, tot, { kind: 'categorical', direction: 'increase', minSupport: 10, sort: 'count' })
    expect(byCount.map((i) => i.segment.key)).toEqual(['b', 'a'])
  })
  it('default minimum support', () => {
    expect(defaultMinSupport(500, false)).toBe(10)
    expect(defaultMinSupport(5000, false)).toBe(50)
    expect(defaultMinSupport(20, true)).toBe(2)
  })
})

describe('top segments', () => {
  it('finds a planted two-field interaction and skips restatements', () => {
    // A=x & B=p has rate 0.8; every other cell 0.1
    const samples: Sample[] = []
    for (const a of ['x', 'y']) for (const b of ['p', 'q']) samples.push({ attrs: [a, b], ...ind(100, a === 'x' && b === 'p' ? 80 : 10) })
    const fields = [0, 1].map((f) => segmentField(samples, f, { numeric: false, label: String }))
    const total = samples.reduce((m, s) => ({ n: m.n + s.n, s: m.s + s.s, ss: m.ss + s.ss }), { n: 0, s: 0, ss: 0 })
    const segs = topSegments(samples, fields, total, { kind: 'categorical', direction: 'increase', minSupport: 20 })
    expect(segs[0].conditions.map((c) => c.segment.label)).toEqual(['x', 'p'])
    expect(segs[0].mean).toBeCloseTo(0.8, 10)
    expect(segs[0].share).toBeCloseTo(0.25, 10)
    // "A is x" alone (rate .45) overlaps the picked pair and is not repeated
    expect(segs.some((s) => s.conditions.length === 1 && s.conditions[0].segment.label === 'x')).toBe(false)
  })
})

describe('computeKeyInfluencers (DAX engine, customers sample)', () => {
  const engine = customerEngine()
  const ctx = createMockHost({ engine })
  const explain = [col('Customers', 'Contract'), col('Customers', 'Plan'), col('Customers', 'Tenure'), col('Customers', 'Support Tickets'), col('Customers', 'Region')]
  const opts = { direction: 'increase' as const, numericAsCategorical: false, sort: 'impact' as const }
  const raw = (() => {
    const { data } = buildCustomerModel()
    const t = data.tables.get('Customers')!
    const c = (name: string) => t.columns.find((x) => x.name === name)!.values
    return { contract: c('Contract'), churned: c('Churned'), charges: c('Monthly Charges') as number[], plan: c('Plan') }
  })()

  it('categorical target: Monthly contract is the top influencer with the exact lift', () => {
    const d = computeKeyInfluencers(visualJson('k', 'keyDriversVisual', { Analyze: [col('Customers', 'Churned')], ExplainBy: explain }), ctx, { ...opts, targetValue: 'Yes' })!
    expect(d.kind).toBe('categorical')
    expect(d.targetValues).toEqual(['No', 'Yes'])
    expect(d.target).toBe('Yes')
    expect(d.total.n).toBe(CUSTOMER_ROWS)
    const top = d.influencers[0]
    expect(d.explain[top.field].label).toBe('Contract')
    expect(top.segment.label).toBe('Monthly')
    // brute force over the raw rows
    let segN = 0
    let segY = 0
    let restN = 0
    let restY = 0
    raw.contract.forEach((v, i) => {
      const y = raw.churned[i] === 'Yes' ? 1 : 0
      if (v === 'Monthly') (segN++, (segY += y))
      else (restN++, (restY += y))
    })
    expect(top.segment.m.n).toBe(segN)
    expect(top.impact).toBeCloseTo(segY / segN / (restY / restN), 10)
    // planted effects show up; Region (no effect) is not an influencer
    const labels = d.influencers.map((i) => `${d.explain[i.field].label}=${i.segment.label}`)
    expect(labels.some((l) => l.startsWith('Tenure='))).toBe(true)
    expect(labels.some((l) => l.startsWith('Support Tickets='))).toBe(true)
    expect(labels.some((l) => l.startsWith('Region='))).toBe(false)
    expect(d.segments.length).toBeGreaterThan(0)
    expect(d.segments[0].mean).toBeGreaterThan(d.overall)
    expect(influencersTable(d).columns).toEqual(['Field', 'Value', 'Lift', 'Rows'])
  })

  it('defaults to the first target value and respects the filter context', () => {
    const j = visualJson('k', 'keyDriversVisual', { Analyze: [col('Customers', 'Churned')], ExplainBy: explain })
    expect(computeKeyInfluencers(j, ctx, opts)!.target).toBe('No')
    const f = identitiesToFilter([{ fields: [{ expr: columnExpr('Customers', 'Plan'), value: 'Basic' }] }])!
    const d = computeKeyInfluencers(j, createMockHost({ engine, filters: [f] }), { ...opts, targetValue: 'Yes' })!
    expect(d.total.n).toBe(raw.plan.filter((p) => p === 'Basic').length)
    expect(targetKey(new Date(Date.UTC(2024, 0, 2)))).toBe('2024-01-02T00:00:00.000Z')
  })

  it('continuous column: mean difference of the Premium plan', () => {
    const j = visualJson('k', 'keyDriversVisual', { Analyze: [col('Customers', 'Monthly Charges')], ExplainBy: [col('Customers', 'Plan'), col('Customers', 'Region')] })
    const d = computeKeyInfluencers(j, ctx, opts)!
    expect(d.kind).toBe('continuous')
    const top = d.influencers[0]
    expect(top.segment.label).toBe('Premium')
    const prem = raw.charges.filter((_, i) => raw.plan[i] === 'Premium')
    const rest = raw.charges.filter((_, i) => raw.plan[i] !== 'Premium')
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(top.diff).toBeCloseTo(avg(prem) - avg(rest), 6)
    const dec = computeKeyInfluencers(j, ctx, { ...opts, direction: 'decrease' })!
    expect(dec.influencers[0].segment.label).toBe('Basic')
    expect(dec.influencers.every((i) => i.diff < 0)).toBe(true)
    // "Categorical" analysis type treats the numeric column's values as categories
    expect(computeKeyInfluencers(j, ctx, { ...opts, numericAsCategorical: true })!.kind).toBe('categorical')
  })

  it('measure: one sample per Explain-by combination', () => {
    const j = visualJson('k', 'keyDriversVisual', { Analyze: [msr('Customers', 'Avg Monthly Charges')], ExplainBy: [col('Customers', 'Plan'), col('Customers', 'Region'), msr('Customers', 'Customer Count')] })
    const d = computeKeyInfluencers(j, ctx, opts)!
    expect(d.grain).toBe('measure')
    expect(d.total.n).toBe(15)
    expect(d.explain.map((f) => f.label)).toEqual(['Plan', 'Region'])
    expect(d.notes.some((n) => n.includes('Customer Count'))).toBe(true)
    expect(d.influencers[0].segment.label).toBe('Premium')
  })

  it('is null without Analyze and empty without Explain by', () => {
    expect(computeKeyInfluencers(visualJson('k', 'keyDriversVisual', {}), ctx, opts)).toBeNull()
    const d = computeKeyInfluencers(visualJson('k', 'keyDriversVisual', { Analyze: [col('Customers', 'Churned')] }, { objects: { keyDrivers: [props({ targetValue: 'Yes' })] } }), ctx, opts)!
    expect(d.influencers).toEqual([])
  })
})
