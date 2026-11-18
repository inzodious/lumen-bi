import { describe, expect, it } from 'vitest'
import { layoutBarLabels, layoutCategoryLabels, joinTitles, valueTickFormatter } from './cartesian/axisLayout'
import { linearFit, quantile } from './cartesian/analytics'
import { dateTickFormatter } from './cartesian/CartesianChart'
import { breakdownSteps, simpleSteps, stepExtent } from './waterfall/waterfallMath'
import { labelParts, layoutOutsideLabels, sliceAngles, arcPath } from './pie/pieLayout'
import { computeValueAxis } from '../common/scale'
import { buildCategorical, categoricalTable } from '../common/categorical'
import { FormatReader } from '../common/fmtProps'
import { createMockEngine } from '../gallery/mockEngine'
import { buildSampleModel } from '../gallery/sampleData'
import { visualJson, col, msr, props, scope } from '../gallery/registry'
import { resolveTheme } from '@core/report/theme'
import { inFilter } from '@core/report/sq'
import type { VisualHostContext } from '../contract'

const font = { size: 12, family: 'Segoe UI' }

describe('category label layout', () => {
  it('keeps short labels horizontal', () => {
    const l = layoutCategoryLabels(['A', 'B', 'C'], 80, font, 100)
    expect(l.mode).toBe('horizontal')
    expect(l.lines).toEqual([['A'], ['B'], ['C']])
  })
  it('wraps multi-word labels into two lines when bands are wide enough', () => {
    const l = layoutCategoryLabels(['North America', 'Latin America'], 70, font, 100)
    expect(l.mode).toBe('horizontal')
    expect(l.lines[0]).toEqual(['North', 'America'])
  })
  it('rotates and skips labels when bands are narrow', () => {
    const labels = Array.from({ length: 40 }, (_, i) => `Category ${i}`)
    const l = layoutCategoryLabels(labels, 8, font, 80)
    expect(l.mode).toBe('rotated')
    expect(l.every).toBeGreaterThan(1)
    expect(l.lines[1]).toEqual([])
    expect(l.size).toBeLessThanOrEqual(80)
  })
  it('bar labels ellipsize to the margin', () => {
    const l = layoutBarLabels(['Short', 'A really very long product name'], 20, font, 60)
    expect(l.width).toBeLessThanOrEqual(66)
    expect(l.lines[1][0].endsWith('…')).toBe(true)
  })
})

describe('axis text', () => {
  it('joins value-axis titles like PBI', () => {
    expect(joinTitles(['Sales'])).toBe('Sales')
    expect(joinTitles(['Sales', 'Profit'])).toBe('Sales and Profit')
    expect(joinTitles(['A', 'B', 'C'])).toBe('A, B and C')
  })
  it('formats ticks with auto units from the largest tick', () => {
    const m = computeValueAxis({ dataMin: 0, dataMax: 5.3e6, includeZero: true, length: 250 })
    const f = valueTickFormatter(m, { formatString: '\\$#,0' })
    expect(m.ticks.map(f)).toContain('$2M')
    expect(f(0)).toBe('$0M')
  })
  it('uses decimals when the step needs them', () => {
    const m = computeValueAxis({ dataMin: 0, dataMax: 1.6e6, includeZero: true, length: 250 })
    const f = valueTickFormatter(m, {})
    expect(m.ticks.map(f)).toContain('0.5M')
  })
  it('date ticks: years, months, days', () => {
    const y = [Date.UTC(2023, 0, 1), Date.UTC(2024, 0, 1)]
    expect(dateTickFormatter(y)(y[1])).toBe('2024')
    const m = [Date.UTC(2023, 0, 1), Date.UTC(2023, 3, 1)]
    expect(dateTickFormatter(m)(m[1])).toBe('Apr 2023')
    const d = [Date.UTC(2023, 0, 5), Date.UTC(2023, 0, 12)]
    expect(dateTickFormatter(d)(d[1])).toBe('Jan 12')
  })
})

describe('analytics', () => {
  it('quantile and linear fit', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile([5], 0.9)).toBe(5)
    const f = linearFit([0, 1, 2], [1, 3, 5])
    expect(f.a).toBeCloseTo(1)
    expect(f.b).toBeCloseTo(2)
  })
})

describe('waterfall math', () => {
  it('simple steps + total', () => {
    const s = simpleSteps([10, -4, 6], ['a', 'b', 'c'])
    expect(s.map((x) => [x.kind, x.start, x.end])).toEqual([
      ['increase', 0, 10],
      ['decrease', 10, 6],
      ['increase', 6, 12],
      ['total', 0, 12]
    ])
    expect(stepExtent(s)).toEqual([0, 12])
  })
  it('breakdown deltas between categories with Other', () => {
    const s = breakdownSteps(['2023', '2024'], ['A', 'B', 'C'], [
      [10, 5, 1],
      [14, 3, 2]
    ], 2)
    expect(s[0]).toMatchObject({ kind: 'total', end: 16 })
    expect(s[1]).toMatchObject({ label: 'A', kind: 'increase', start: 16, end: 20 })
    expect(s[2]).toMatchObject({ label: 'B', kind: 'decrease', start: 20, end: 18 })
    expect(s[3]).toMatchObject({ label: 'Other', kind: 'other', start: 18, end: 19 })
    expect(s[4]).toMatchObject({ kind: 'total', label: '2024', end: 19 })
  })
})

describe('pie layout', () => {
  it('slices start at 12 o’clock clockwise', () => {
    const a = sliceAngles([1, 1, 2])
    expect(a[0].start).toBe(0)
    expect(a[1].end).toBeCloseTo(Math.PI)
    expect(a[2].end).toBeCloseTo(Math.PI * 2)
    expect(arcPath(0, 0, 0, 10, 0, Math.PI)).toMatch(/^M0,0L/)
  })
  it('outside labels never overlap on a side', () => {
    const labels = Array.from({ length: 8 }, (_, i) => ({ index: i, mid: 0.2 + i * 0.05, height: 14 }))
    const out = layoutOutsideLabels(labels, 100, 100, 60, 0, 200).sort((x, y) => x.y - y.y)
    for (let i = 1; i < out.length; i++) expect(out[i].y - out[i - 1].y).toBeGreaterThanOrEqual(13.99)
    expect(out.every((o) => o.side === 'right')).toBe(true)
  })
  it('label contents', () => {
    expect(labelParts('Data value, percent of total')).toEqual({ category: false, value: true, percent: true })
    expect(labelParts('All detail labels')).toEqual({ category: true, value: true, percent: true })
  })
})

describe('categorical data from the mock engine', () => {
  const { model, data } = buildSampleModel()
  const engine = createMockEngine(model, data)
  const theme = resolveTheme()
  const ctx = (extra: Partial<VisualHostContext> = {}): VisualHostContext =>
    ({
      engine,
      theme,
      format: engine.format,
      locale: 'en-US',
      mode: 'view',
      filters: [],
      selection: [],
      select() {},
      setSlicerFilter() {},
      drill: { level: 0, path: [] },
      setDrill() {},
      showTooltip() {},
      showContextMenu() {},
      actions: {} as any,
      report: {} as any,
      updateVisual() {},
      ...extra
    }) as VisualHostContext

  it('keeps category order when no sort is saved (like PBI)', () => {
    const json = visualJson('t', 'clusteredColumnChart', { Category: [col('Sales', 'Region')], Y: [msr('Sales', 'Total Sales')] })
    const d = buildCategorical(json, ctx(), { splitRoles: ['Y'], defaultSort: 'measureDesc', fmt: new FormatReader(json, theme) })
    const labels = d.categories.map((c) => c.label)
    expect(labels).toEqual([...labels].sort())
  })

  it('sorts by a saved measure sort descending and resolves colors', () => {
    const json = visualJson('t', 'clusteredColumnChart', { Category: [col('Sales', 'Region')], Y: [msr('Sales', 'Total Sales')] }, { objects: { dataPoint: [props({ fill: '#123456' }, { metadata: 'Sales.Total Sales' })] }, sort: [{ field: msr('Sales', 'Total Sales'), direction: 'Descending' }] })
    const d = buildCategorical(json, ctx(), { splitRoles: ['Y'], defaultSort: 'measureDesc', fmt: new FormatReader(json, theme) })
    const vals = d.series[0].values as number[]
    expect(vals).toEqual([...vals].sort((a, b) => b - a))
    expect(d.series[0].color).toBe('#123456')
    expect(d.categories[0].identity.fields[0].value).toBe('North America')
  })

  it('splits by legend series with per-series data-selector colors', () => {
    const json = visualJson('t', 'columnChart', { Category: [col('Sales', 'Year')], Y: [msr('Sales', 'Total Sales')], Series: [col('Sales', 'Channel')] }, { objects: { dataPoint: [props({ fill: '#ABCDEF' }, scope('Sales', 'Channel', 'Retail'))] } })
    const d = buildCategorical(json, ctx(), { seriesRole: 'Series', splitRoles: ['Y'], defaultSort: 'measureDesc', fmt: new FormatReader(json, theme) })
    expect(d.series.map((s) => s.name)).toEqual(['Online', 'Partner', 'Retail'])
    expect(d.series[2].color).toBe('#ABCDEF')
    expect(d.series[0].color).toBe(theme.dataColors[0])
    const table = categoricalTable(d)
    expect(table.columns).toEqual(['Year', 'Channel', 'Total Sales'])
    expect(table.rows.length).toBe(6)
  })

  it('category sort definition and month sort-by-column', () => {
    const month = col('Sales', 'Month')
    const json = visualJson('t', 'lineChart', { Category: [month], Y: [msr('Sales', 'Total Sales')] }, { sort: [{ field: month, direction: 'Ascending' }] })
    const d = buildCategorical(json, ctx(), { splitRoles: ['Y'], defaultSort: 'categoryAsc' })
    expect(d.categories.slice(0, 3).map((c) => c.label)).toEqual(['January', 'February', 'March'])
  })

  it('computes cross-highlight values', () => {
    const json = visualJson('t', 'clusteredColumnChart', { Category: [col('Sales', 'Region')], Y: [msr('Sales', 'Total Sales')] })
    const d = buildCategorical(json, ctx({ highlightFilters: [inFilter('Sales', 'Channel', ['Online'])] }), { splitRoles: ['Y'], highlight: true })
    expect(d.hasHighlights).toBe(true)
    const s = d.series[0]
    s.values.forEach((v, i) => expect((s.highlights![i] ?? 0) <= (v ?? 0)).toBe(true))
  })

  it('applies gradient conditional formatting per point', () => {
    const sales = msr('Sales', 'Total Sales')
    const fill = {
      solid: {
        color: {
          expr: {
            FillRule: {
              Input: sales,
              FillRule: { linearGradient2: { min: { color: { Literal: { Value: "'#000000'" } } }, max: { color: { Literal: { Value: "'#FFFFFF'" } } } } }
            }
          }
        }
      }
    }
    const json = visualJson('t', 'clusteredColumnChart', { Category: [col('Sales', 'Region')], Y: [sales] }, { objects: { dataPoint: [{ properties: { fill }, selector: { data: [{ dataViewWildcard: { matchingOption: 1 } }] } }], labels: [{ properties: { color: fill }, selector: { data: [{ dataViewWildcard: { matchingOption: 1 } }] } }] }, sort: [{ field: sales, direction: 'Descending' }] })
    const d = buildCategorical(json, ctx(), { splitRoles: ['Y'], defaultSort: 'measureDesc', fmt: new FormatReader(json, theme) })
    expect(d.series[0].pointColors?.[0]).toBe('#FFFFFF')
    expect(d.series[0].pointColors?.[d.categories.length - 1]).toBe('#000000')
    // data label color (fx) evaluated per point too
    expect(d.series[0].cfColors?.['labels.color']?.[0]).toBe('#FFFFFF')
    expect(d.series[0].cfColors?.['labels.color']?.[d.categories.length - 1]).toBe('#000000')
  })

  it('drill level and expanded hierarchy', () => {
    const lvl = (l: string) => ({ HierarchyLevel: { Expression: { Hierarchy: { Expression: { SourceRef: { Entity: 'Sales' } }, Hierarchy: 'Date Hierarchy' } }, Level: l } })
    const json = visualJson('t', 'clusteredColumnChart', { Category: [lvl('Year'), lvl('Quarter')], Y: [msr('Sales', 'Total Sales')] })
    const d0 = buildCategorical(json, ctx(), { splitRoles: ['Y'], defaultSort: 'categoryAsc' })
    expect(d0.categories.map((c) => c.label)).toEqual(['2023', '2024'])
    expect(d0.categories[0].identity.fields[0].expr).toEqual(col('Sales', 'Year'))
    const d1 = buildCategorical(json, ctx({ drill: { level: 0, path: [], expandedLevel: 1 } }), { splitRoles: ['Y'], defaultSort: 'categoryAsc' })
    expect(d1.categories.length).toBe(8)
    expect(d1.categories[0].labels).toEqual(['2023', 'Qtr 1'])
  })
})

describe('value axis tick format', () => {
  it('self-scaling format strings ($#,##0,,.0M) are used as-is', async () => {
    const { valueTickFormatter, hasScalingCommas } = await import('./cartesian/axisLayout')
    const { computeValueAxis } = await import('../common/scale')
    expect(hasScalingCommas('\\$#,##0,,.0M')).toBe(true)
    expect(hasScalingCommas('$#,0.00')).toBe(false)
    expect(hasScalingCommas('#,##0')).toBe(false)
    const m = computeValueAxis({ dataMin: 0, dataMax: 2500000, includeZero: true, length: 300, tickSpacing: 60 })
    const fmt = (v: number, f?: string) => (f === '\\$#,##0,,.0M' ? '$' + (v / 1e6).toFixed(1) + 'M' : String(v))
    const t = valueTickFormatter(m, { displayUnits: 1, formatString: '\\$#,##0,,.0M', format: fmt as any })
    expect(t(500000)).toBe('$0.5M')
    expect(t(2500000)).toBe('$2.5M')
  })
  it('percent formats with a space render without it', async () => {
    const { valueTickFormatter } = await import('./cartesian/axisLayout')
    const { computeValueAxis } = await import('../common/scale')
    const m = computeValueAxis({ dataMin: -0.4, dataMax: 0.5, includeZero: true, length: 200 })
    expect(valueTickFormatter(m, { formatString: '0.00 %;-0.00 %;0.00 %' })(-0.4)).toMatch(/^-40(\.0+)?%$/)
  })
})

describe('legend field that is also a category level', () => {
  it('splits by the level value (Category = [Channel, Year], Legend = Channel)', async () => {
    const { buildCategorical } = await import('../common/categorical')
    const { createEngine } = await import('@core/engine/engine')
    const { buildSampleModel } = await import('../gallery/sampleData')
    const { createMockHost } = await import('../common/mockHost')
    const { model, data } = buildSampleModel()
    const engine = createEngine(model, data)
    engine.processCalculated()
    const ch = col('Sales', 'Channel')
    const json = visualJson('t', 'columnChart', { Category: [{ expr: ch, active: true }, { expr: col('Sales', 'Year'), active: true }], Y: [msr('Sales', 'Total Sales')], Series: [ch] })
    const d = buildCategorical(json, createMockHost({ engine }), { seriesRole: 'Series', splitRoles: ['Y'] })
    expect(d.levels.length).toBe(2)
    expect(d.series.map((s) => s.name).sort()).toEqual(['Online', 'Partner', 'Retail'])
    // each category (channel × year) has a value only in its own channel's series
    for (const s of d.series) d.categories.forEach((c, ci) => expect(s.values[ci] !== null).toBe(c.values[0] === s.seriesValue))
  })
})
