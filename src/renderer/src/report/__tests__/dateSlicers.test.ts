import { describe, expect, it } from 'vitest'
import { columnExpr, fieldKey, type SQFilter } from '@core/report/sq'
import type { PageDocument, ReportDocument } from '@core/report/types'
import { computeVisualFilters, filterFieldKeys, rangeSlicerFieldKeys } from '../filters'
import { applyDateSlicerDefault } from '../../panes/visualizations/wells'
import { addFieldToVisual } from '../../panes/data/visualFieldOps'
import type { SemanticModel } from '@core/model/types'

const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
const dateCol = columnExpr('Date', 'Date')

function slicer(name: string, field: any, mode?: string) {
  return {
    name,
    json: {
      name,
      position: { x: 0, y: 0, z: 0, width: 200, height: 100 },
      visual: {
        visualType: 'slicer',
        query: { queryState: { Values: { projections: [{ field, queryRef: fieldKey(field) }] } } },
        ...(mode ? { objects: { data: [{ properties: { mode: lit(`'${mode}'`) } }] } } : {})
      }
    }
  }
}

/** Date >= 2024-01-01 (alias form, as PBI stores slicer filters). */
const rangeFilter: SQFilter = {
  Version: 2,
  From: [{ Name: 'd', Entity: 'Date', Type: 0 }],
  Where: [{ Condition: { Comparison: { ComparisonKind: 2, Left: { Column: { Expression: { SourceRef: { Source: 'd' } }, Property: 'Date' } }, Right: { Literal: { Value: "datetime'2024-01-01T00:00:00'" } } } } }]
} as any

function setup(targetMode?: string, sourceField: any = dateCol) {
  const page = { name: 'p', json: { name: 'p' }, visuals: [slicer('a', sourceField, 'Between'), slicer('b', dateCol, targetMode), { name: 'chart', json: { name: 'chart', visual: { visualType: 'clusteredColumnChart' } } }] } as unknown as PageDocument
  const report = { origin: 'new', report: {}, pagesMeta: { pageOrder: ['p'] }, pages: [page], bookmarks: [], theme: {} } as unknown as ReportDocument
  return { report, page }
}

describe('date / range slicers keep their own bounds', () => {
  it('a slicer on the same date column does not narrow a date picker / Between slicer', () => {
    for (const mode of ['RelativeDatePicker', 'Between', 'Before', 'After']) {
      const { report, page } = setup(mode)
      const r = computeVisualFilters({ report, page, visualName: 'b', slicerFilters: { a: rangeFilter }, supportsHighlight: () => false })
      expect(r.filters).toEqual([])
    }
  })

  it('other visuals and list slicers on that column are still filtered', () => {
    const { report, page } = setup('Basic')
    expect(computeVisualFilters({ report, page, visualName: 'b', slicerFilters: { a: rangeFilter }, supportsHighlight: () => false }).filters.length).toBe(1)
    expect(computeVisualFilters({ report, page, visualName: 'chart', slicerFilters: { a: rangeFilter }, supportsHighlight: () => false }).filters.length).toBe(1)
  })

  it('a slicer on another column still narrows a range slicer', () => {
    const { report, page } = setup('Between', columnExpr('Product', 'Category'))
    const f: SQFilter = { Version: 2, From: [{ Name: 'p', Entity: 'Product', Type: 0 }], Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'p' } }, Property: 'Category' } }], Values: [[{ Literal: { Value: "'Bikes'" } }]] } } }] } as any
    expect(computeVisualFilters({ report, page, visualName: 'b', slicerFilters: { a: f }, supportsHighlight: () => false }).filters.length).toBe(1)
  })

  it('helpers: range slicer fields and filter field keys (alias-resolved)', () => {
    expect([...(rangeSlicerFieldKeys(slicer('x', dateCol, 'RelativeDatePicker').json) ?? [])]).toEqual([fieldKey(dateCol)])
    expect(rangeSlicerFieldKeys(slicer('x', dateCol).json)).toBeUndefined()
    expect([...filterFieldKeys(rangeFilter)]).toEqual([fieldKey(dateCol)])
  })
})

describe('new slicer on a date column defaults to Between (PBI)', () => {
  const model = {
    tables: [
      { name: 'Date', columns: [{ name: 'Date', dataType: 'dateTime' }, { name: 'Year', dataType: 'int64' }], measures: [], hierarchies: [] },
      { name: 'Product', columns: [{ name: 'Category', dataType: 'string' }], measures: [], hierarchies: [] }
    ],
    relationships: []
  } as unknown as SemanticModel

  it('first date column added through the Data pane writes data.mode = Between', () => {
    const vj: any = { visual: { visualType: 'slicer' } }
    addFieldToVisual(vj, { kind: 'column', table: 'Date', name: 'Date' } as any, model)
    expect(vj.visual.objects.data[0].properties.mode).toEqual(lit("'Between'"))
  })

  it('keeps list style for text / numeric columns and existing styles', () => {
    const text: any = { visual: { visualType: 'slicer', query: { queryState: { Values: { projections: [{ field: columnExpr('Product', 'Category') }] } } } } }
    expect(applyDateSlicerDefault(text, model)).toBe(false)
    const styled: any = slicer('s', dateCol, 'Dropdown').json
    expect(applyDateSlicerDefault(styled, model)).toBe(false)
    expect(styled.visual.objects.data[0].properties.mode).toEqual(lit("'Dropdown'"))
    const chart: any = { visual: { visualType: 'tableEx', query: { queryState: { Values: { projections: [{ field: dateCol }] } } } } }
    expect(applyDateSlicerDefault(chart, model)).toBe(false)
  })
})
