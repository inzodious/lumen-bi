import { describe, expect, it } from 'vitest'
import { createEngine } from '@core/engine/engine'
import { measureExpr } from '@core/report/sq'
import { createMockHost } from '../../../common/mockHost'
import { buildSampleModel } from '../../../gallery/sampleData'
import { col, msr, props, visualJson } from '../../../gallery/registry'
import '../../../index'
import {
  averageComparisonSentence,
  divergenceSentence,
  extremesSentence,
  longestRunSentence,
  narrate,
  peakSentence,
  relChange,
  sentenceText,
  shareSentence,
  trendSentences,
  valueSentence,
  type NarrDataset,
  type NarrSeries
} from '../narrative/generate'
import { datasetFor, isOrderedField, pageDatasets } from '../narrative/collect'
import { computeNarrative, selectedVisualNames } from '../narrative/Narrative'
import { fieldRef } from '../../../common/categorical'
import { getProjections } from '../../../common/query'

const fmt = (v: number) => v.toFixed(0)
const series = (measure: string, values: Array<number | null>, extra: Partial<NarrSeries> = {}): NarrSeries => ({ measure, values, format: fmt, unitKey: '#', ...extra })
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
const time = (...s: NarrSeries[]): NarrDataset => ({ category: { name: 'Month', labels: months.slice(0, s[0].values.length), ordered: true }, series: s })
const cats = (labels: string[], ...s: NarrSeries[]): NarrDataset => ({ category: { name: 'Region', labels, ordered: false }, series: s })
const text = (s: ReturnType<typeof extremesSentence>) => (s ? sentenceText(s) : null)

describe('narrative sentences', () => {
  it('relative change', () => {
    expect(relChange(100, 150)).toBe(0.5)
    expect(relChange(-100, -50)).toBe(0.5)
    expect(relChange(0, 5)).toBeNull()
    expect(relChange(-1, 5)).toBeNull()
  })

  it('trend over time, merged when measures move together', () => {
    expect(trendSentences(time(series('Sales', [100, 90, 130])) ).map(sentenceText)).toEqual(['Sales trended up, resulting in a 30.00% increase between Jan and Mar.'])
    expect(trendSentences(time(series('Sales', [100, 120, 150]), series('Cost', [50, 60, 55]))).map(sentenceText)).toEqual([
      'Sales (50.00% increase) and Cost (10.00% increase) both trended up between Jan and Mar.'
    ])
    expect(trendSentences(time(series('Sales', [100, 120]), series('Cost', [50, 40]))).map(sentenceText)).toEqual([
      'Sales trended up, resulting in a 20.00% increase between Jan and Feb.',
      'Cost trended down, resulting in a 20.00% decrease between Jan and Feb.'
    ])
    expect(trendSentences(time(series('Net', [-10, 20])))[0].map((r) => r.text).join('')).toBe('Net went from -10 in Jan to 20 in Feb.')
    expect(trendSentences(cats(['A', 'B'], series('Sales', [1, 2])))).toEqual([])
    // values are marked for highlighting
    expect(trendSentences(time(series('Sales', [100, 130])))[0].filter((r) => r.value).map((r) => r.text)).toEqual(['Sales', '30.00%', 'Jan', 'Feb'])
  })

  it('peak and longest run', () => {
    const s = series('Sales', [5, 7, 9, 12, 8, 6])
    expect(text(peakSentence(time(s), s))).toBe('Sales peaked in Apr at 12 and was lowest in Jan at 5.')
    expect(text(longestRunSentence(time(s), s))).toBe('Sales experienced the longest period of growth (+7) between Jan and Apr.')
    const d = series('Sales', [9, 8, 9, 7, 5, 4])
    expect(text(longestRunSentence(time(d), d))).toBe('Sales experienced the longest period of decline (-5) between Mar and Jun.')
    const zig = series('Sales', [1, 2, 1, 2])
    expect(longestRunSentence(time(zig), zig)).toBeNull()
  })

  it('highest vs lowest category and share', () => {
    const s = series('Sales', [500, 100, 300])
    const ds = cats(['North', 'South', 'East'], s)
    expect(text(extremesSentence(ds, s))).toBe('At 500, North had the highest Sales and was 400.00% higher than South, which had the lowest Sales at 100.')
    expect(text(shareSentence(ds, s))).toBe('North accounted for 55.56% of Sales, while South accounted for 11.11%.')
    expect(text(shareSentence(cats(['North', 'South'], series('Sales', [500, 100])), series('Sales', [500, 100])))).toBe('North accounted for 83.33% of Sales.')
    expect(shareSentence(ds, { ...s, ratio: true })).toBeNull()
    const neg = series('Profit', [50, -20])
    const nds = cats(['A', 'B'], neg)
    expect(text(extremesSentence(nds, neg))).toBe('At 50, A had the highest Profit, while B had the lowest at -20.')
    expect(shareSentence(nds, neg)).toBeNull()
    const same = series('Sales', [3, 3])
    expect(text(extremesSentence(cats(['A', 'B'], same), same))).toBe('All 2 Region values had the same Sales (3).')
  })

  it('divergence and average comparison need comparable units', () => {
    const a = series('Sales', [100, 300, 200])
    const b = series('Cost', [80, 120, 190])
    expect(text(divergenceSentence(cats(['A', 'B', 'C'], a, b), a, b))).toBe('Sales and Cost diverged the most when the Region was B, when Sales was 180 higher than Cost.')
    expect(divergenceSentence(cats(['A', 'B', 'C'], a, b), a, { ...b, unitKey: '%' })).toBeNull()
    expect(text(averageComparisonSentence(time(a, b), a, b))).toBe('Between Jan and Mar, the average of Sales (200) was higher than Cost (130).')
  })

  it('card value', () => {
    expect(text(valueSentence(series('Profit', [42])))).toBe('Profit is 42.')
    expect(valueSentence(series('Profit', [null]))).toBeNull()
  })

  it('narrate: per-visual and total limits, no repeated insights', () => {
    const ds = cats(['North', 'South', 'East'], series('Sales', [500, 100, 300]), series('Cost', [300, 90, 100]))
    const once = narrate([ds])
    expect(once.length).toBeLessThanOrEqual(4)
    expect(sentenceText(once[0])).toContain('highest Sales')
    const twice = narrate([ds, ds])
    expect(new Set(twice.map(sentenceText)).size).toBe(twice.length)
    expect(narrate([ds], { maxPerVisual: 1 })).toHaveLength(1)
    const many = Array.from({ length: 10 }, (_, i) => cats(['A', 'B'], series(`M${i}`, [2, 1])))
    expect(narrate(many, { maxTotal: 5 })).toHaveLength(5)
  })
})

describe('narrative data collection (DAX engine, sample model)', () => {
  const { model, data } = buildSampleModel()
  const engine = createEngine(model, data)
  engine.processCalculated()
  const ctx = createMockHost({ engine })
  const totalBy = (column: string) =>
    engine.summarize({ groupBy: [{ table: 'Sales', column }], values: [{ id: 'v', expr: { kind: 'sq', expr: measureExpr('Sales', 'Total Sales') } }] }).rows as Array<[string, number]>

  it('ordered axes', () => {
    const j = visualJson('x', 'lineChart', { Category: [col('Sales', 'Month'), col('Sales', 'Region'), col('Sales', 'Date'), col('Sales', 'Year')] })
    const [month, region, date, year] = getProjections(j).Category.map((p) => fieldRef(ctx, p))
    expect(isOrderedField(month)).toBe(true) // sort-by column
    expect(isOrderedField(region)).toBe(false)
    expect(isOrderedField(date)).toBe(true)
    expect(isOrderedField(year)).toBe(true)
  })

  it('bar chart → highest / lowest region from the engine', () => {
    const ds = datasetFor(visualJson('b', 'barChart', { Category: [col('Sales', 'Region')], Y: [msr('Sales', 'Total Sales')] }), ctx, [])!
    const rows = totalBy('Region').sort((a, b) => b[1] - a[1])
    expect(ds.category?.labels[0]).toBe(rows[0][0])
    const s = sentenceText(narrate([ds])[0])
    expect(s).toContain(`${rows[0][0]} had the highest Total Sales`)
    expect(s).toContain(`than ${rows[rows.length - 1][0]}`)
  })

  it('line chart over months keeps the calendar order', () => {
    const ds = datasetFor(visualJson('l', 'lineChart', { Category: [col('Sales', 'Month')], Y: [msr('Sales', 'Total Sales')] }), ctx, [])!
    expect(ds.category?.ordered).toBe(true)
    expect(ds.category?.labels.slice(0, 3)).toEqual(['January', 'February', 'March'])
    expect(sentenceText(narrate([ds])[0])).toMatch(/^Total Sales trended (up|down), resulting in a .* between January and December\.$/)
  })

  it('measures with the same format share one display unit', () => {
    const ds = datasetFor(visualJson('l2', 'lineChart', { Category: [col('Sales', 'Month')], Y: [msr('Sales', 'Total Sales'), msr('Sales', 'Total Cost')] }), ctx, [])!
    const [a, b] = ds.series
    expect(a.format(500000).replace(/[\d.,]/g, '')).toBe(b.format(500000).replace(/[\d.,]/g, ''))
    expect(sentenceText(narrate([ds]).find((x) => sentenceText(x).includes('average'))!)).toMatch(/\(\$[\d.]+M\) was higher than Total Cost \(\$[\d.]+M\)/)
  })

  it('page: reading order, skips slicers / text / itself', () => {
    const mk = (name: string, type: string, wells: any, x: number, y: number) => {
      const json = visualJson(name, type, wells)
      json.position = { x, y, width: 100, height: 100 }
      return { visual: { name, json } }
    }
    const sources = [
      mk('card', 'card', { Values: [msr('Sales', 'Profit')] }, 500, 0),
      mk('bar', 'barChart', { Category: [col('Sales', 'Category')], Y: [msr('Sales', 'Total Sales')] }, 0, 0),
      mk('slicer', 'slicer', { Values: [col('Sales', 'Region')] }, 0, 400),
      mk('text', 'textbox', {}, 0, 500),
      mk('self', 'aiNarratives', {}, 0, 600)
    ]
    const { datasets, errors } = pageDatasets(sources, ctx, 'self')
    expect(errors).toEqual([])
    expect(datasets).toHaveLength(2)
    expect(datasets[0].category?.name).toBe('Category') // left visual first
    expect(datasets[1].category).toBeUndefined()
    expect(pageDatasets(sources, ctx, 'self', new Set(['card'])).datasets).toHaveLength(1)
    const r = computeNarrative(sources[4].visual.json, 'self', ctx, sources)
    expect(r.scope).toBe('page')
    expect(r.sentences.map(sentenceText).some((s) => s.startsWith('Profit is $'))).toBe(true)
  })

  it('own fields and selected visuals', () => {
    const j = visualJson('n', 'aiNarratives', { Category: [col('Sales', 'Channel')], Values: [msr('Sales', 'Total Sales')] })
    const r = computeNarrative(j, 'n', ctx, [])
    expect(r.scope).toBe('visual')
    expect(sentenceText(r.sentences[0])).toContain('had the highest Total Sales')
    expect(selectedVisualNames('["a", {"name": "b"}]')).toEqual(new Set(['a', 'b']))
    expect(selectedVisualNames('not json')).toBeUndefined()
    const scoped = visualJson('n2', 'aiNarratives', {}, { objects: { userPrompt: [props({ useAllVisuals: false, selectedVisualsJson: '["none"]' })] } })
    expect(computeNarrative(scoped, 'n2', ctx, [{ visual: { name: 'bar', json: visualJson('bar', 'barChart', { Category: [col('Sales', 'Region')], Y: [msr('Sales', 'Total Sales')] }) } }]).sentences).toEqual([])
  })
})
