import { describe, expect, it } from 'vitest'
import { aggregateSummary, contributorShares, highLow, highLowSummary, kpiSummary, ranked, templateSentence, timeInsights, toPoints } from '../narrative/insights'
import { changeSentence, narrate, rankingSentence, sentenceText, statesSentence, totalSentence, type NarrDataset, type NarrSeries } from '../narrative/generate'

const pts = (...values: Array<number | null>) => toPoints(values.map((_, i) => String.fromCharCode(65 + i)), values)
const id = (...values: Array<number | null>) => aggregateSummary(pts(...values)).templateId
const fmtOf = (r: ReturnType<typeof aggregateSummary>) => (role: string) => {
  const o = r.outputs[role]
  if (!o || o.value === null) return ''
  return o.kind === 'percent' ? `${(Number(o.value) * 100).toFixed(2)}%` : String(o.value)
}
const sentence = (r: ReturnType<typeof aggregateSummary>, measures = ['Sales'], category = 'Region') => sentenceText(templateSentence(r.templateId, { measures, category }, fmtOf(r)) ?? [])

describe('insight engine: HighPointLowPointSummary', () => {
  it('outputs and template 10001', () => {
    const r = highLowSummary(pts(300, 100, 500))
    expect(r.templateId).toBe(10001)
    expect(r.outputs.V1.value).toBe(500)
    expect(r.outputs.V2.value).toBe('C')
    expect(r.outputs.V3.value).toBe(100)
    expect(r.outputs.V4.value).toBe('B')
    expect(r.outputs.V5.value).toBe(4)
    expect(sentence(r)).toBe('At 500, C had the highest Sales and was 400.00% higher than B, which had the lowest Sales at 100.')
  })
  it('no template for fewer than two points or equal values (the text box shows the default case)', () => {
    expect(highLowSummary(pts(5)).templateId).toBe(10000)
    expect(highLowSummary(pts(5, 5)).templateId).toBe(10000)
    expect(highLow(pts(1, 2, null))?.hi.label).toBe('B')
  })
})

describe('insight engine: AggregateSummary (ranking with ties)', () => {
  it('chooses the template for every tie configuration', () => {
    expect(id()).toBe(43019)
    expect(id(7)).toBe(43006)
    expect(id(2, 2)).toBe(43002)
    expect(id(2, 1)).toBe(43001)
    expect(id(3, 3, 3)).toBe(43006)
    expect(id(3, 2, 1)).toBe(43003)
    expect(id(3, 3, 1)).toBe(43004)
    expect(id(3, 2, 2)).toBe(43005)
    expect(id(4, 3, 2, 1)).toBe(43007)
    expect(id(4, 4, 2, 1)).toBe(43013)
    expect(id(4, 3, 3, 1)).toBe(43021)
    expect(id(4, 4, 4, 1)).toBe(43011)
    expect(id(5, 4, 3, 2, 1)).toBe(43016)
    expect(id(5, 5, 3, 2, 1)).toBe(43020)
    expect(id(5, 5, 5, 2, 1)).toBe(43011)
    expect(id(5, 4, 4, 2, 1)).toBe(43021)
    expect(id(9, 9, 9, 9, 1)).toBe(43015)
    expect(id(...Array.from({ length: 60 }, (_, i) => (i < 55 ? 9 : 1)))).toBe(43022)
  })
  it('ranks highest first with ties in category order and phrases like Power BI', () => {
    expect(ranked(pts(1, 3, 3)).map((p) => p.label)).toEqual(['B', 'C', 'A'])
    expect(sentence(aggregateSummary(pts(1, 5, 3, 2, 4)))).toBe('B had the highest Sales at 5, followed by E and C. A had the lowest Sales at 1.')
    expect(sentence(aggregateSummary(pts(2, 1)))).toBe('Sales for A (2) was higher than B (1).')
    expect(sentence(aggregateSummary(pts(9, 9, 9, 9, 1)))).toBe('The top 4 Region all had Sales of 9.')
    expect(sentence(aggregateSummary(pts(3, 3, 3)))).toBe('All Region had Sales of 3.')
  })
})

describe('insight engine: KPISummary', () => {
  it('values at the first states, range across many states', () => {
    const one = kpiSummary(['Q1', 'Q2'], [[10, 20]])
    expect(one.templateId).toBe(56002)
    expect(sentence(one, ['Sales'], 'Quarter')).toBe('Q1 had 10 Sales and Q2 had 20.')
    const three = kpiSummary(['Q1', 'Q2', 'Q3'], [[10, 20, 30]])
    expect(sentence(three, ['Sales'], 'Quarter')).toBe('Q1 had 10 Sales, Q2 had 20, and Q3 had 30.')
    const many = kpiSummary(['a', 'b', 'c', 'd', 'e'], [[5, 1, null, 9, 3]])
    expect(many.templateId).toBe(56004)
    expect(sentence(many, ['Sales'], 'Month')).toBe('Across all 4 Month, Sales ranged from 1 to 9.')
    const two = kpiSummary(['On', 'Off'], [
      [1, 2],
      [3, 4]
    ])
    expect(two.templateId).toBe(56006)
    expect(sentence(two, ['Sales', 'Cost'], 'Channel')).toBe('On had 1 Sales and 3 Cost. Off had 2 Sales and 4 Cost.')
    const range3 = kpiSummary(['a', 'b', 'c', 'd'], [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [0, 1, 0, 1]
    ])
    expect(range3.templateId).toBe(56012)
    expect(sentence(range3, ['A', 'B', 'C'], 'K')).toBe('Across all 4 K, A ranged from 1 to 4, B ranged from 5 to 8, and C ranged from 0 to 1.')
    expect(kpiSummary(['x'], [[null]]).templateId).toBe(56013)
  })
})

describe('insight engine: time and shares', () => {
  it('first/last change, largest increase/decrease, peak, longest run', () => {
    const ti = timeInsights(pts(100, 120, 90, 150, 160, 170))!
    expect(ti.change).toBeCloseTo(0.7)
    expect(ti.direction).toBe('up')
    expect(ti.maxIncrease?.from.label).toBe('C')
    expect(ti.maxIncrease?.delta).toBe(60)
    expect(ti.maxDecrease?.delta).toBe(-30)
    expect(ti.peak.label).toBe('F')
    expect(ti.low.label).toBe('C')
    expect(ti.longestRun).toMatchObject({ direction: 'up', from: { label: 'C' }, to: { label: 'F' } })
    expect(timeInsights(pts(1))).toBeNull()
  })
  it('contributor shares need additive non-negative values', () => {
    const sh = contributorShares(pts(50, 30, 20))!
    expect(sh.total).toBe(100)
    expect(sh.topShare).toBe(0.5)
    expect(sh.bottom.label).toBe('C')
    expect(contributorShares(pts(5, -1))).toBeNull()
  })
})

describe('narrative sentences built on the insight engine', () => {
  const fmt = (v: number) => v.toFixed(0)
  const s = (measure: string, values: Array<number | null>, extra: Partial<NarrSeries> = {}): NarrSeries => ({ measure, values, format: fmt, unitKey: '#', ...extra })
  const cats = (labels: string[], ...series: NarrSeries[]): NarrDataset => ({ category: { name: 'Region', labels, ordered: false }, series })
  const time = (...series: NarrSeries[]): NarrDataset => ({ category: { name: 'Month', labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].slice(0, series[0].values.length), ordered: true }, series })

  it('largest period-over-period changes', () => {
    const a = s('Sales', [100, 120, 90, 150])
    expect(sentenceText(changeSentence(time(a), a)!)).toBe('The largest increase in Sales was between Mar and Apr (+60, 66.67%), and the largest decrease between Feb and Mar (-30, 25.00%).')
    const up = s('Sales', [1, 2, 4])
    expect(sentenceText(changeSentence(time(up), up)!)).toBe('The largest increase in Sales was between Feb and Mar (+2, 100.00%).')
    expect(changeSentence(cats(['A', 'B', 'C'], up), up)).toBeNull()
  })

  it('ranking, states and totals', () => {
    const a = s('Sales', [500, 100, 300, 50])
    const ds = cats(['North', 'South', 'East', 'West'], a)
    expect(sentenceText(rankingSentence(ds, a)!)).toBe('North had the highest Sales at 500, followed by East, South, and West.')
    expect(sentenceText(totalSentence(ds, a)!)).toBe('Across all 4 Region, Sales totaled 950.')
    expect(totalSentence(ds, { ...a, ratio: true })).toBeNull()
    const b = s('Cost', [40, 30])
    const two = cats(['Online', 'Store'], s('Sales', [100, 80]), b)
    expect(sentenceText(statesSentence(two)!)).toBe('Online had 100 Sales and 40 Cost. Store had 80 Sales and 30 Cost.')
  })

  it('a categorical visual narrates high/low, ranking, contributors and total', () => {
    const out = narrate([cats(['North', 'South', 'East', 'West'], s('Sales', [500, 100, 300, 50]))]).map(sentenceText)
    expect(out).toEqual([
      'At 500, North had the highest Sales and was 900.00% higher than West, which had the lowest Sales at 50.',
      'North had the highest Sales at 500, followed by East, South, and West.',
      'North accounted for 52.63% of Sales, while West accounted for 5.26%.',
      'Across all 4 Region, Sales totaled 950.'
    ])
  })

  it('a time visual narrates the trend, largest changes, peak and longest run', () => {
    const out = narrate([time(s('Sales', [5, 7, 9, 12, 8, 6]))]).map(sentenceText)
    expect(out[0]).toBe('Sales trended up, resulting in a 20.00% increase between Jan and Jun.')
    expect(out[1]).toBe('The largest increase in Sales was between Mar and Apr (+3, 33.33%), and the largest decrease between Apr and May (-4, 33.33%).')
    expect(out[2]).toBe('Sales peaked in Apr at 12 and was lowest in Jan at 5.')
    expect(out[3]).toBe('Sales experienced the longest period of growth (+7) between Jan and Apr.')
  })
})
