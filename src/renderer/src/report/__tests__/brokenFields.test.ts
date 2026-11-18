import { describe, expect, it } from 'vitest'
import { brokenFields, removeBrokenFields, reportMeasureKeys } from '../brokenFields'

const col = (t: string, c: string) => ({ Column: { Expression: { SourceRef: { Entity: t } }, Property: c } })
const msr = (t: string, m: string) => ({ Measure: { Expression: { SourceRef: { Entity: t } }, Property: m } })
const known = new Set(['Product.Color', 'Sales.Total'])
const engine = {
  describeField: (e: any) => {
    const x = e.Aggregation?.Expression ?? e
    const c = x.Column ?? x.Measure
    return c && known.has(`${c.Expression.SourceRef.Entity}.${c.Property}`) ? ({} as any) : undefined
  }
}

function pivot(): any {
  return {
    visual: {
      visualType: 'pivotTable',
      query: {
        queryState: {
          Rows: { projections: [{ field: col('Product', 'Color'), queryRef: 'Product.Color' }] },
          Values: { projections: [{ field: msr('Sales', 'Total'), queryRef: 'Sales.Total' }, { field: msr('Sales', 'Gone'), queryRef: 'Sales.Gone' }] },
          Columns: { projections: [{ field: col('Store', 'Missing'), queryRef: 'Store.Missing' }] }
        },
        sortDefinition: { sort: [{ field: msr('Sales', 'Gone'), direction: 'Descending' }] }
      }
    }
  }
}

describe('fields missing from the model', () => {
  it('lists projections that do not resolve', () => {
    const b = brokenFields(pivot(), engine)
    expect(b.map((x) => x.label)).toEqual(['Sales[Gone]', 'Store[Missing]'])
  })
  it('ignores report-level measures and calculated projections', () => {
    const j = pivot()
    j.visual.query.queryState.Values.projections.push({ field: { NativeVisualCalculation: { Name: 'Running' } }, queryRef: 'Running' })
    const b = brokenFields(j, engine, reportMeasureKeys({ entities: [{ name: 'Sales', measures: [{ name: 'Gone', expression: '1' }] }] }))
    expect(b.map((x) => x.label)).toEqual(['Store[Missing]'])
  })
  it('Fix this removes the broken fields, their sorts and emptied roles', () => {
    const j = pivot()
    removeBrokenFields(j, brokenFields(j, engine))
    expect(Object.keys(j.visual.query.queryState)).toEqual(['Rows', 'Values'])
    expect(j.visual.query.queryState.Values.projections).toHaveLength(1)
    expect(j.visual.query.sortDefinition).toBeUndefined()
    expect(brokenFields(j, engine)).toEqual([])
  })
})
