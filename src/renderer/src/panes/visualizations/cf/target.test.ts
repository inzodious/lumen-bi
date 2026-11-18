import { describe, expect, it } from 'vitest'
import type { ObjectsBag } from '@core/report/props'
import { setRaw, getRaw } from '../objects'
import { defaultGradient, serializeCF, serializeDataBars, defaultDataBars } from './rules'
import { cellTarget, cfKindFor, cfRendered, findCF, propTarget, writeCF } from './target'
import { defaultInputFor, inputIsNumeric, modelFields } from './fields'
import { emptyModel } from '@core/model/types'

const measure = (p: string) => ({ Measure: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: p } })
const gradient = serializeCF({ wrap: 'solid', model: defaultGradient({ field: measure('Amount') }) })
const ctx = { pageName: 'p1', visualName: 'v1', visualType: 'clusteredColumnChart', container: false }

describe('cf targets', () => {
  it('decides which props support fx', () => {
    expect(cfKindFor({ name: 'fill', displayName: 'Color', type: 'color' }, 'dataPoint', ctx)).toBe('color')
    expect(cfKindFor({ name: 'fill', displayName: 'Color', type: 'color', conditional: false }, 'dataPoint', ctx)).toBeUndefined()
    expect(cfKindFor({ name: 'text', displayName: 'Text', type: 'text' }, 'title', { ...ctx, container: true })).toBe('text')
    expect(cfKindFor({ name: 'text', displayName: 'Text', type: 'text' }, 'labels', ctx)).toBeUndefined()
    expect(cfKindFor({ name: 'fill', displayName: 'Color', type: 'color' }, 'dataPoint', undefined)).toBeUndefined()
  })

  it('writes chart data colors under a dataViewWildcard selector and finds them again', () => {
    const bag: ObjectsBag = { dataPoint: [{ properties: { fill: { solid: { color: { expr: { Literal: { Value: "'#118DFF'" } } } } } } }] }
    const t = propTarget(ctx, 'dataPoint', { name: 'fill', displayName: 'Default color', type: 'color' }, 'color')
    expect(t.scoped).toBe(true)
    expect(findCF(bag, t)).toBeUndefined()
    writeCF(bag, t, gradient)
    expect(bag.dataPoint).toHaveLength(2)
    expect(bag.dataPoint[1].selector).toEqual({ data: [{ dataViewWildcard: { matchingOption: 1 } }] })
    expect(findCF(bag, t)?.raw).toBe(gradient)
    // the static default color is untouched
    expect(bag.dataPoint[0].properties.fill.solid.color.expr.Literal.Value).toBe("'#118DFF'")
    writeCF(bag, t, undefined)
    expect(bag.dataPoint).toHaveLength(1)
  })

  it('moves table cell CF between "Apply to" scopes and removes empty entries', () => {
    const bag: ObjectsBag = {}
    const t = cellTarget('p1', 'v1', 'Sales.Amount', 'Amount', 'backColor')
    writeCF(bag, t, gradient, 'values')
    expect(findCF(bag, t)?.applyTo).toBe('values')
    writeCF(bag, t, gradient, 'valuesAndTotals')
    expect(bag.values).toHaveLength(1)
    expect(bag.values[0].selector).toEqual({ data: [{ dataViewWildcard: { matchingOption: 0 } }], metadata: 'Sales.Amount' })
    // a different series is a different target
    expect(findCF(bag, cellTarget('p1', 'v1', 'Sales.Other', 'Other', 'backColor'))).toBeUndefined()
    writeCF(bag, t, undefined)
    expect(bag.values).toBeUndefined()
  })

  it('data bars live in columnFormatting with a metadata selector', () => {
    const bag: ObjectsBag = {}
    const t = cellTarget('p1', 'v1', 'Sales.Amount', 'Amount', 'dataBars')
    writeCF(bag, t, serializeDataBars(defaultDataBars('#118DFF')))
    expect(bag.columnFormatting[0].selector).toEqual({ metadata: 'Sales.Amount' })
    expect(findCF(bag, t)).toBeDefined()
    expect(cfRendered('tableEx', t)).toBe(true)
    expect(cfRendered('lineChart', propTarget(ctx, 'labels', { name: 'color', displayName: 'Color', type: 'color' }, 'color'))).toBe(true) // charts evaluate labels.color per data point
  })

  it('setRaw distinguishes selectors that differ only in nested keys', () => {
    const bag: ObjectsBag = {}
    const s0 = { data: [{ dataViewWildcard: { matchingOption: 0 } }] }
    const s1 = { data: [{ dataViewWildcard: { matchingOption: 1 } }] }
    setRaw(bag, 'dataPoint', 'fill', 'a', s0)
    setRaw(bag, 'dataPoint', 'fill', 'b', s1)
    expect(bag.dataPoint).toHaveLength(2)
    expect(getRaw(bag, 'dataPoint', 'fill', s0)).toBe('a')
  })
})

describe('cf fields', () => {
  const model = emptyModel('M')
  model.tables.push({
    name: 'Sales',
    columns: [
      { name: 'Amount', dataType: 'double', kind: 'data' },
      { name: 'Region', dataType: 'string', kind: 'data' },
      { name: 'Secret', dataType: 'string', kind: 'data', isHidden: true }
    ],
    measures: [{ name: 'Total', expression: 'SUM(Sales[Amount])' }],
    hierarchies: [],
    partitions: []
  } as any)

  it('lists visible model fields, measures first', () => {
    const f = modelFields(model)
    expect(f.map((x) => `${x.kind}:${x.label}`)).toEqual(['measure:Total', 'column:Amount', 'column:Region'])
  })

  it('defaults to the series field, summarizing columns', () => {
    const visual = { visual: { query: { queryState: { Values: { projections: [{ field: { Column: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: 'Region' } }, queryRef: 'Sales.Region' }, { field: measure('Total'), queryRef: 'Sales.Total' }] } } } } }
    expect(defaultInputFor(model, visual, 'Sales.Region')).toEqual({ field: visual.visual.query.queryState.Values.projections[0].field, aggregation: 3 })
    expect(defaultInputFor(model, visual)).toEqual({ field: measure('Total') })
    expect(inputIsNumeric(model, { field: visual.visual.query.queryState.Values.projections[0].field, aggregation: 3 })).toBe(false)
    expect(inputIsNumeric(model, { field: visual.visual.query.queryState.Values.projections[0].field, aggregation: 5 })).toBe(true)
  })
})
