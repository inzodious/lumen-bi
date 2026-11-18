import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import type { SemanticModel } from '@core/model/types'
import * as D from '../draft'

function model(): SemanticModel {
  return {
    name: 'Model',
    tables: [
      {
        name: 'Sales',
        columns: [
          { name: 'Region', dataType: 'string', kind: 'data', sourceColumn: 'Region' },
          { name: 'Amount', dataType: 'double', kind: 'data', sourceColumn: 'Amount' },
          { name: 'Calc', dataType: 'double', kind: 'calculated', expression: '[Amount] * 2' }
        ],
        measures: [{ name: 'Total', expression: 'SUM ( Sales[Amount] )' }],
        hierarchies: [],
        partitions: [{ name: 'Sales', mode: 'import', sourceType: 'm', expression: 'let\n    Source = #table({"Region", "Amount"}, {{"E", 1}})\nin\n    Source' }]
      },
      {
        name: 'Product',
        columns: [{ name: 'Name', dataType: 'string', kind: 'data', sourceColumn: 'Name' }],
        measures: [],
        hierarchies: [],
        partitions: [{ name: 'Product', mode: 'import', sourceType: 'm', expression: 'let\n    Source = Sales\nin\n    Source', queryGroup: 'Dimensions' }]
      }
    ],
    relationships: [{ name: 'r1', fromTable: 'Sales', fromColumn: 'Region', toTable: 'Product', toColumn: 'Name' }],
    expressions: [
      { name: 'ServerName', kind: 'm', expression: '"srv" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]', queryGroup: 'Parameters' },
      { name: 'fnDouble', kind: 'm', expression: '(x) => x * 2' },
      { name: 'Staging', kind: 'm', expression: 'let\n    Source = Sales\nin\n    Source' }
    ],
    roles: []
  } as unknown as SemanticModel
}

describe('draft', () => {
  it('lists queries with kinds and is clean initially', () => {
    const m = model()
    const d = D.draftFromModel(m)
    expect(d.queries.map((q) => [q.name, q.kind])).toEqual([
      ['Sales', 'table'],
      ['Product', 'table'],
      ['ServerName', 'parameter'],
      ['fnDouble', 'function'],
      ['Staging', 'query']
    ])
    expect(D.isDirty(d, m)).toBe(false)
    expect(D.groupsOf(d)).toEqual(['Dimensions', 'Parameters'])
  })
  it('renames a query and rewrites references in other queries', () => {
    const m = model()
    let d = D.draftFromModel(m)
    const sales = d.queries[0]!
    d = D.renameQuery(d, sales.id, 'Fact Sales')
    expect(d.queries[1]!.source).toContain('Source = #"Fact Sales"')
    expect(d.queries[4]!.source).toContain('Source = #"Fact Sales"')
    expect(D.isDirty(d, m)).toBe(true)
    expect(D.queryNameError(d, 'product')).toMatch(/already exists/)
    expect(D.dependents(d, 'Fact Sales')).toEqual(['Product', 'Staging'])
  })
  it('applies edits: partitions, expressions, table rename, delete, new loaded query', () => {
    const m = model()
    let d = D.draftFromModel(m)
    const [sales, product, param, , staging] = d.queries
    d = D.updateQuery(d, sales!.id, { source: 'let\n    Source = #table({"Region", "Amount", "Qty"}, {{"E", 1, 2}})\nin\n    Source' })
    d = D.renameQuery(d, product!.id, 'Products')
    d = D.updateQuery(d, param!.id, { source: '"other" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]' })
    d = D.deleteQuery(d, staging!.id)
    const added = D.addQuery(d, { name: D.newQueryName(d), kind: 'table', source: '#table({"A"}, {{1}})', loadEnabled: true })
    d = added.draft
    const ref = D.referenceQuery(d, sales!.id)!
    d = D.updateQuery(ref.draft, ref.id, { loadEnabled: false })
    expect(d.queries.find((q) => q.id === ref.id)!.kind).toBe('query')
    let res: D.ApplyResult | null = null
    const next = produce(m, (draft) => {
      res = D.applyDraft(draft, d, {
        columns: {
          [sales!.id]: [
            { name: 'Region', type: 'text' },
            { name: 'Amount', type: 'Int64.Type' },
            { name: 'Qty', type: 'Int64.Type' }
          ],
          [added.id]: [{ name: 'A', type: 'number' }]
        }
      })
    })
    const r = res as unknown as D.ApplyResult
    expect(r.refresh.sort()).toEqual(['Query1', 'Sales'])
    expect(r.renamedTables).toEqual([['Product', 'Products']])
    const s = next.tables.find((t) => t.name === 'Sales')!
    expect(s.partitions[0]!.expression).toContain('"Qty"')
    expect(s.columns.map((c) => `${c.name}:${c.dataType}`)).toEqual(['Region:string', 'Amount:int64', 'Calc:double', 'Qty:int64'])
    expect(next.tables.some((t) => t.name === 'Products')).toBe(true)
    expect(next.relationships[0]!.toTable).toBe('Products')
    expect(next.expressions.find((e) => e.name === 'ServerName')!.expression).toMatch(/^"other"/)
    expect(next.expressions.some((e) => e.name === 'Staging')).toBe(false)
    const q1 = next.tables.find((t) => t.name === 'Query1')!
    expect(q1.columns).toMatchObject([{ name: 'A', dataType: 'double', kind: 'data', sourceColumn: 'A', summarizeBy: 'sum' }])
    expect(q1.partitions[0]).toMatchObject({ mode: 'import', sourceType: 'm', expression: '#table({"A"}, {{1}})' })
    expect(next.expressions.find((e) => e.name === 'Sales (2)')!.expression).toContain('Source = Sales')
    const rebased = D.rebaseDraft(d, r.origins)
    expect(D.isDirty(rebased, next)).toBe(false)
  })
  it('disabling load turns a table into an expression; deleting a table drops its relationships', () => {
    const m = model()
    let d = D.draftFromModel(m)
    d = D.updateQuery(d, d.queries[1]!.id, { loadEnabled: false })
    d = D.deleteQuery(d, d.queries[0]!.id)
    const next = produce(m, (draft) => void D.applyDraft(draft, d))
    expect(next.tables.length).toBe(0)
    expect(next.relationships.length).toBe(0)
    expect(next.expressions.find((e) => e.name === 'Product')).toMatchObject({ queryGroup: 'Dimensions' })
  })
  it('syncs new model queries and names copies like PQ', () => {
    const m = model()
    const d = D.draftFromModel({ ...m, tables: [m.tables[0]!] })
    const synced = D.syncDraft(d, m)
    expect(synced.queries.map((q) => q.name)).toContain('Product')
    expect(D.copyName(d, 'Sales')).toBe('Sales (2)')
    const dup = D.duplicateQuery(d, d.queries[0]!.id)!
    expect(dup.draft.queries[1]!.name).toBe('Sales (2)')
    expect(D.modelDataType('Currency.Type')).toBe('decimal')
    expect(D.modelDataType('nullable date')).toBe('dateTime')
    expect(D.modelDataType('logical')).toBe('boolean')
  })
})
