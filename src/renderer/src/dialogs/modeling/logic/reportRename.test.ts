import { describe, expect, it } from 'vitest'
import { emptyReport } from '@core/report/types'
import { renameInReport, renameQueryRef } from './reportRename'

const col = (entity: string, prop: string) => ({ Column: { Expression: { SourceRef: { Entity: entity } }, Property: prop } })

function report() {
  const r = emptyReport()
  r.pages[0].visuals.push({
    name: 'v1',
    json: {
      visual: {
        visualType: 'clusteredColumnChart',
        query: {
          queryState: {
            Category: { projections: [{ field: col('Product', 'Color'), queryRef: 'Product.Color', nativeQueryRef: 'Color' }] },
            Y: { projections: [{ field: { Aggregation: { Expression: col('Sales', 'Amount'), Function: 0 } }, queryRef: 'Sum(Sales.Amount)', nativeQueryRef: 'Sum of Amount' }, { field: { Measure: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: 'Total' } }, queryRef: 'Sales.Total', nativeQueryRef: 'Total' }] }
          }
        },
        objects: { dataPoint: [{ selector: { metadata: 'Sales.Total' }, properties: {} }] }
      },
      filterConfig: {
        filters: [{ name: 'f1', field: col('Product', 'Color'), filter: { Version: 2, From: [{ Name: 'p', Entity: 'Product', Type: 0 }], Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'p' } }, Property: 'Color' } }], Values: [[{ Literal: { Value: "'Red'" } }]] } } }] } }]
      }
    }
  })
  r.bookmarks.push({ name: 'b1', json: { explorationState: { sections: { s: { filters: { byExpr: [{ expression: col('Product', 'Color') }] } } } } } })
  r.reportExtensions = { entities: [{ name: 'Sales', measures: [{ name: 'Report Measure', expression: '[Total] * 2 + SUM(Sales[Amount])' }] }] }
  return r
}

describe('renameInReport', () => {
  it('rewrites queryRef strings', () => {
    expect(renameQueryRef('Sum(Sales.Amount)', { kind: 'column', table: 'Sales', name: 'Amount' }, 'Net')).toBe('Sum(Sales.Net)')
    expect(renameQueryRef('Sales.Amount2', { kind: 'column', table: 'Sales', name: 'Amount' }, 'Net')).toBe('Sales.Amount2')
    expect(renameQueryRef('Date.Calendar.Year', { kind: 'table', table: 'Date' }, 'Calendar Dates')).toBe('Calendar Dates.Calendar.Year')
  })
  it('renames a column everywhere, including aliased filter sources and bookmarks', () => {
    const r = report()
    const n = renameInReport(r, { kind: 'column', table: 'Product', name: 'Color' }, 'Colour')
    const v = r.pages[0].visuals[0].json
    expect(v.visual.query.queryState.Category.projections[0]).toMatchObject({ field: col('Product', 'Colour'), queryRef: 'Product.Colour', nativeQueryRef: 'Colour' })
    expect(v.filterConfig.filters[0].field).toEqual(col('Product', 'Colour'))
    expect(v.filterConfig.filters[0].filter.Where[0].Condition.In.Expressions[0].Column.Property).toBe('Colour')
    expect(r.bookmarks[0].json.explorationState.sections.s.filters.byExpr[0].expression).toEqual(col('Product', 'Colour'))
    expect(n).toBe(6)
  })
  it('renames measures (refs, selectors, report measures DAX) and tables', () => {
    const r = report()
    renameInReport(r, { kind: 'measure', table: 'Sales', name: 'Total' }, 'Revenue')
    const v = r.pages[0].visuals[0].json
    expect(v.visual.query.queryState.Y.projections[1]).toMatchObject({ queryRef: 'Sales.Revenue', nativeQueryRef: 'Revenue' })
    expect(v.visual.objects.dataPoint[0].selector.metadata).toBe('Sales.Revenue')
    expect((r.reportExtensions as any).entities[0].measures[0].expression).toBe('[Revenue] * 2 + SUM(Sales[Amount])')
    renameInReport(r, { kind: 'table', table: 'Sales' }, 'Sales Fact')
    expect(v.visual.query.queryState.Y.projections[0]).toMatchObject({ field: { Aggregation: { Expression: col('Sales Fact', 'Amount') } }, queryRef: 'Sum(Sales Fact.Amount)', nativeQueryRef: 'Sum of Amount' })
    expect((r.reportExtensions as any).entities[0]).toMatchObject({ name: 'Sales Fact' })
    expect((r.reportExtensions as any).entities[0].measures[0].expression).toBe("[Revenue] * 2 + SUM('Sales Fact'[Amount])")
    renameInReport(r, { kind: 'table', table: 'Product' }, 'Item')
    expect(v.filterConfig.filters[0].filter.From[0].Entity).toBe('Item')
  })
})
