import { describe, expect, it } from 'vitest'
import { col, msr, props, visualJson } from '../../../gallery/registry'
import { FormatReader } from '../../../common/fmtProps'
import { queryScatter, scatterTableOf } from '../scatterQuery'
import { readReferenceLines, SCATTER_LINE_OBJECTS, dashFor } from '../referenceLines'
import { mockCtx, theme } from './testCtx'

const S = 'Sales'
const sales = msr(S, 'Total Sales')
const margin = msr(S, 'Margin %')
const units = msr(S, 'Units Sold')
const product = col(S, 'Product')
const category = col(S, 'Category')
const region = col(S, 'Region')
const country = col(S, 'Country')
const month = col(S, 'Month')

describe('scatter query', () => {
  it('one point per category with series colors and tooltips', () => {
    const json = visualJson('t', 'scatterChart', { Category: [product], Series: [category], X: [sales], Y: [margin] })
    const d = queryScatter(json, mockCtx(), new FormatReader(json, theme))!
    expect(d.points.length).toBe(13)
    expect(d.series.length).toBe(4)
    expect(new Set(d.series.map((s) => s.color)).size).toBe(4)
    const p = d.points[0]
    expect(p.tips.map((t) => t.label)).toEqual(['Product', 'Category', 'Total Sales', 'Margin %'])
    expect(p.identity.fields.length).toBe(2)
    expect(p.catIdentity.fields.length).toBe(1)
  })
  it('shares the group-by when the legend is the category field', () => {
    const json = visualJson('t', 'scatterChart', { Category: [category], Series: [category], X: [sales], Y: [margin] })
    const d = queryScatter(json, mockCtx(), new FormatReader(json, theme))!
    expect(d.points.length).toBe(4)
    expect(d.points.every((p) => p.identity.fields.length === 1)).toBe(true)
    expect(d.points[0].tips.filter((t) => t.label === 'Category').length).toBe(1)
  })
  it('play axis: frames in order, identity without the play field', () => {
    const json = visualJson('t', 'scatterChart', { Category: [category], X: [units], Y: [margin], Size: [sales], Play: [month] })
    const d = queryScatter(json, mockCtx(), new FormatReader(json, theme))!
    expect(d.frames[0]).toBe('January')
    expect(d.frames.length).toBe(12)
    const bikes = d.points.filter((p) => p.label === 'Bikes')
    expect(bikes.length).toBe(12)
    expect(new Set(bikes.map((p) => p.idKey)).size).toBe(1)
    expect(new Set(bikes.map((p) => p.key)).size).toBe(12)
    expect(scatterTableOf(d).columns).toEqual(['Month', 'Category', 'Units Sold', 'Margin %', 'Total Sales'])
  })
  it('hierarchy: active drill level and drill-level count', () => {
    const json = visualJson('t', 'scatterChart', { Category: [region, country], X: [sales], Y: [margin] })
    const d0 = queryScatter(json, mockCtx(), new FormatReader(json, theme))!
    expect(d0.drillLevels).toBe(2)
    expect(d0.points.length).toBe(4)
    const d1 = queryScatter(json, mockCtx({ drill: { level: 1, path: [] } }), new FormatReader(json, theme))!
    expect(d1.points.length).toBe(10)
    expect(d1.levels[0].label).toBe('Country')
  })
  it('conditional gradient fill per point and color by category', () => {
    const lit = (v: string) => ({ Literal: { Value: v } })
    const json = visualJson('t', 'scatterChart', { Category: [category], X: [sales], Y: [margin] }, {
      objects: { dataPoint: [{ properties: { fill: { solid: { color: { expr: { FillRule: { Input: sales, FillRule: { linearGradient2: { min: { color: lit("'#000000'") }, max: { color: lit("'#FFFFFF'") } } } } } } } } } }] }
    })
    const d = queryScatter(json, mockCtx(), new FormatReader(json, theme))!
    const top = d.points.reduce((a, b) => (b.x > a.x ? b : a))
    const bottom = d.points.reduce((a, b) => (b.x < a.x ? b : a))
    expect(top.color.toUpperCase()).toBe('#FFFFFF')
    expect(bottom.color.toUpperCase()).toBe('#000000')
    const json2 = visualJson('t', 'scatterChart', { Category: [category], X: [sales], Y: [margin] }, { objects: { colorByCategory: [props({ show: true })] } })
    const d2 = queryScatter(json2, mockCtx(), new FormatReader(json2, theme))!
    expect(new Set(d2.points.map((p) => p.color)).size).toBe(4)
  })
})

describe('reference lines', () => {
  const measures = [
    { queryRef: 'Sales.Margin %', axis: 'y' as const, values: [0.2, 0.4, 0.6], formatString: '0.0%' },
    { queryRef: 'Sales.Total Sales', axis: 'x' as const, values: [100, 200, 600], formatString: '#,0' }
  ]
  it('reads constant and statistic lines on the right axis', () => {
    const json = visualJson('t', 'scatterChart', {}, {
      objects: {
        xAxisReferenceLine: [{ ...props({ show: true, value: 150, dataLabelShow: true, displayName: 'Plan', dataLabelText: 'ValueAndName' }), selector: { id: '1' } }],
        averageLine: [{ ...props({ show: true, lineColor: '#FF0000', style: 'solid' }), selector: { id: '1', metadata: 'Sales.Total Sales' } }],
        medianLine: [{ ...props({ show: true, shadeShow: true, shadeRegion: 'after' }), selector: { id: '1' } }],
        maxLine: [{ ...props({ show: false }), selector: { id: '1' } }],
        y1AxisReferenceLine: [{ ...props({ show: true }), selector: { id: '1' } }]
      }
    })
    const lines = readReferenceLines(new FormatReader(json, theme), SCATTER_LINE_OBJECTS, measures, mockCtx().format)
    expect(lines.map((l) => [l.kind, l.axis, l.value])).toEqual([
      ['constant', 'x', 150],
      ['constant', 'y', 0],
      ['average', 'x', 300],
      ['median', 'y', 0.4]
    ])
    expect(lines[0].label?.text).toBe('Plan 150')
    expect(lines[2].color).toBe('#FF0000')
    expect(lines[2].dash).toBeUndefined()
    expect(lines[3].shade).toMatchObject({ region: 'after' })
    expect(lines[3].dash).toBe('6 4')
  })
  it('dash patterns', () => {
    expect(dashFor('dotted')).toBe('1.5 3')
    expect(dashFor('custom', '2, 4')).toBe('2 4')
    expect(dashFor('solid')).toBeUndefined()
  })
})
