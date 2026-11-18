/**
 * Differential tests: the group-index path (groups.ts), vertical fusion (fusion.ts), the row-expression compiler
 * (compile.ts) and the content-keyed measure cache must give exactly the results of the plain row-by-row path.
 * A 60k-row fact table (above the grouping threshold) with dimensions, rolling windows, time intelligence,
 * CALCULATE modifiers, iterators with context transition, and a bidirectional variant.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { SemanticModel } from '../../model/types'
import type { DataStore } from '../../model/data'
import { setFusionEnabled, setGroupingEnabled } from '../../dax/tabular'
import { createEngine } from '../engine'
import type { SummarizeRequest } from '../api'
import { build, d } from '../../dax/tabular/__tests__/build'

function model(bidi: boolean): { model: SemanticModel; data: DataStore } {
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const days = 400
  const dates = Array.from({ length: days }, (_, i) => d(2024, 1, 1 + i))
  const sales: Array<[number, Date, number, number | null, number]> = []
  for (let i = 0; i < 60_000; i++) {
    const pk = 1 + Math.floor(rnd() * 40)
    const qty = rnd() < 0.05 ? null : 1 + Math.floor(rnd() * 9)
    // a few orphan product keys -> blank row in Product
    sales.push([rnd() < 0.002 ? 999 : pk, dates[Math.floor(rnd() * days)], 1 + Math.floor(rnd() * 300), qty, Math.round(rnd() * 10000) / 100])
  }
  return build({
    tables: {
      Date: {
        dataCategory: 'Time',
        columns: { Date: { type: 'dateTime', isKey: true }, Month: { type: 'string', expression: 'FORMAT ( \'Date\'[Date], "yyyy-mm" )' }, Idx: { type: 'int64', expression: "INT ( 'Date'[Date] - DATE ( 2024, 1, 1 ) )" } },
        rows: dates.map((x) => [x])
      },
      Product: {
        columns: { ProductKey: 'int64', Category: 'string', Color: 'string' },
        rows: Array.from({ length: 40 }, (_, i) => [i + 1, `Cat ${i % 5}`, ['Red', 'Blue', 'Green'][i % 3]])
      },
      Customer: { columns: { CustomerKey: 'int64', Country: 'string' }, rows: Array.from({ length: 300 }, (_, i) => [i + 1, ['US', 'DE', 'FR', 'JP'][i % 4]]) },
      Sales: {
        columns: { ProductKey: 'int64', Date: 'dateTime', CustomerKey: 'int64', Qty: 'int64', Price: 'double' },
        rows: sales,
        measures: {
          Amount: 'SUMX ( Sales, Sales[Qty] * Sales[Price] )',
          TotalQty: 'SUM ( Sales[Qty] )',
          Rows: 'COUNTROWS ( Sales )',
          AvgPrice: 'AVERAGE ( Sales[Price] )',
          MaxQty: 'MAX ( Sales[Qty] )',
          MinPrice: 'MIN ( Sales[Price] )',
          Customers: 'DISTINCTCOUNT ( Sales[CustomerKey] )',
          QtyCount: 'COUNT ( Sales[Qty] )',
          Wrapped: 'CALCULATE ( [TotalQty] )',
          Red: 'CALCULATE ( [TotalQty], FILTER ( ALL ( Product[Color] ), Product[Color] = "Red" ) )',
          Rolling90: "CALCULATE ( [TotalQty], FILTER ( ALL ( 'Date' ), 'Date'[Idx] <= MAX ( 'Date'[Idx] ) && 'Date'[Idx] > MAX ( 'Date'[Idx] ) - 90 ) )",
          YTD: "TOTALYTD ( [TotalQty], 'Date'[Date] )",
          PY: "CALCULATE ( [TotalQty], SAMEPERIODLASTYEAR ( 'Date'[Date] ) )",
          PerCustomer: 'AVERAGEX ( VALUES ( Customer[CustomerKey] ), [TotalQty] )',
          Share: 'DIVIDE ( [TotalQty], CALCULATE ( [TotalQty], ALL ( Product ) ) )',
          BigOrders: 'CALCULATE ( [Rows], Sales[Qty] >= 8 )',
          RedKeep: 'CALCULATE ( [TotalQty], KEEPFILTERS ( Product[Color] = "Red" ) )',
          NotRedAllCust: 'CALCULATE ( [TotalQty], Product[Color] <> "Red", REMOVEFILTERS ( Customer ) )',
          BigShare: 'DIVIDE ( [BigOrders], [Rows] )',
          Mixed: 'IF ( [TotalQty] > 100, [Red] - [NotRedAllCust], BLANK () )',
          Treat: 'CALCULATE ( DISTINCTCOUNT ( Sales[CustomerKey] ), TREATAS ( { "Cat 1", "Cat 2" }, Product[Category] ) )'
        }
      }
    },
    relationships: [
      { from: 'Sales.ProductKey', to: 'Product.ProductKey' },
      { from: 'Sales.Date', to: 'Date.Date' },
      { from: 'Sales.CustomerKey', to: 'Customer.CustomerKey', crossFilteringBehavior: bidi ? 'bothDirections' : 'oneDirection' }
    ]
  })
}

const MEASURES = ['Amount', 'TotalQty', 'Rows', 'AvgPrice', 'MaxQty', 'MinPrice', 'Customers', 'QtyCount', 'Wrapped', 'Red', 'Rolling90', 'YTD', 'PY', 'PerCustomer', 'Share', 'BigOrders', 'RedKeep', 'NotRedAllCust', 'BigShare', 'Mixed', 'Treat']
const col = (table: string, column: string) => ({ Column: { Expression: { SourceRef: { Entity: table } }, Property: column } })
const inFilter = (table: string, column: string, values: string[]) => ({
  Version: 2,
  From: [{ Name: 't', Entity: table, Type: 0 }],
  Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 't' } }, Property: column } }], Values: values.map((v) => [{ Literal: { Value: `'${v}'` } }]) } } }]
})

function requests(): SummarizeRequest[] {
  const values = MEASURES.map((m) => ({ id: m, expr: { kind: 'measure' as const, table: 'Sales', measure: m } }))
  return [
    { groupBy: [{ table: 'Date', column: 'Month' }], values },
    { groupBy: [{ table: 'Product', column: 'Category' }, { table: 'Customer', column: 'Country' }], values },
    { groupBy: [{ table: 'Date', column: 'Month' }, { table: 'Product', column: 'Color' }], values, filters: [inFilter('Customer', 'Country', ['US', 'JP'])] },
    { groupBy: [{ table: 'Product', column: 'Category' }], values, filters: [inFilter('Product', 'Color', ['Red', 'Blue'])] },
    { groupBy: [], values },
    // only simple aggregations: fully fused (combinations come from the fact table)
    {
      groupBy: [{ table: 'Date', column: 'Month' }, { table: 'Product', column: 'Category' }, { table: 'Customer', column: 'Country' }],
      values: values.filter((v) => ['TotalQty', 'Rows', 'AvgPrice', 'MaxQty', 'MinPrice', 'Customers', 'QtyCount', 'Wrapped', 'RedKeep', 'BigOrders'].includes(v.id)),
      filters: [inFilter('Product', 'Color', ['Green'])]
    }
  ]
}

function run(bidi: boolean): unknown[] {
  const { model: m, data } = model(bidi)
  const e = createEngine(m, data)
  e.processCalculated()
  return requests().map((r) => {
    const res = e.summarize(r)
    expect(res.warnings ?? []).toEqual([])
    return res.rows
  })
}

function close(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => close(x, b[i]))
  return a === b || (a instanceof Date && b instanceof Date && a.getTime() === b.getTime())
}

afterEach(() => {
  setGroupingEnabled(true)
  setFusionEnabled(true)
})

describe('optimized paths equal the row path', () => {
  for (const bidi of [false, true]) {
    it(`summarize (${bidi ? 'bidirectional customer' : 'single direction'})`, () => {
      const fast = run(bidi)
      setGroupingEnabled(false)
      setFusionEnabled(false)
      const slow = run(bidi)
      expect((fast as unknown[][]).map((t) => t.length)).toEqual((slow as unknown[][]).map((t) => t.length))
      for (let q = 0; q < fast.length; q++) {
        const f = fast[q] as unknown[][]
        const s = slow[q] as unknown[][]
        for (let i = 0; i < f.length; i++) if (!close(f[i], s[i])) expect({ q, i, row: f[i] }).toEqual({ q, i, row: s[i] })
      }
    }, 120_000)
  }
})

describe('wide tables (group-by over many related tables)', () => {
  it('groups over combinations that exist in the fact table instead of the cross product', () => {
    const { model: m, data } = model(false)
    const e = createEngine(m, data)
    e.processCalculated()
    // Product (40 tuples) x Customer (300) x Date (400) = 4.8M combinations > the cross-join limit
    const r = e.summarize({
      groupBy: [{ table: 'Product', column: 'ProductKey' }, { table: 'Customer', column: 'CustomerKey' }, { table: 'Date', column: 'Date' }],
      // BigOrders is not a simple aggregation: no fusion, so combinations come from the relationship join
      values: [{ id: 'q', expr: { kind: 'measure', table: 'Sales', measure: 'Rows' } }, { id: 'b', expr: { kind: 'measure', table: 'Sales', measure: 'BigOrders' } }]
    })
    expect(r.warnings ?? []).toEqual([])
    const sales = data.tables.get('Sales')!
    const keys = new Set<string>()
    const pk = sales.columns[0].values
    const dt = sales.columns[1].values as Date[]
    const ck = sales.columns[2].values
    for (let i = 0; i < sales.rowCount; i++) keys.add(`${pk[i] === 999 ? null : pk[i]}|${ck[i]}|${dt[i].getTime()}`)
    expect(r.rows.length).toBe(keys.size)
    expect(r.rows.reduce((a, x) => a + (x[3] as number), 0)).toBe(60_000)
  }, 60_000)
})

describe('query time budget', () => {
  it('returns partial rows with a warning instead of running unbounded', () => {
    const { model: m, data } = model(false)
    const e = createEngine(m, data, { queryBudgetMs: 1 })
    e.processCalculated()
    setGroupingEnabled(false)
    setFusionEnabled(false)
    const r = e.summarize({ groupBy: [{ table: 'Date', column: 'Date' }, { table: 'Product', column: 'ProductKey' }], values: [{ id: 'x', expr: { kind: 'measure', table: 'Sales', measure: 'PerCustomer' } }] })
    expect(r.truncated).toBe(true)
    expect(r.warnings?.some((w) => /time budget/.test(w))).toBe(true)
  }, 60_000)
})

describe('performance: SUMMARIZECOLUMNS-style group-by', () => {
  it('evaluates ~500 groups x 7 typical measures well under a second', () => {
    const { model: m, data } = model(false)
    const e = createEngine(m, data)
    e.processCalculated()
    const values = ['TotalQty', 'Amount', 'Customers', 'Share', 'YTD', 'PY', 'BigOrders'].map((x) => ({ id: x, expr: { kind: 'measure' as const, table: 'Sales', measure: x } }))
    const req: SummarizeRequest = { groupBy: [{ table: 'Date', column: 'Month' }, { table: 'Product', column: 'ProductKey' }], values }
    const t0 = performance.now()
    const r = e.summarize(req)
    const ms = performance.now() - t0
    expect(r.rows.length).toBeGreaterThanOrEqual(500)
    // target 300 ms on a developer machine; the bound leaves room for slow CI runners
    if (process.env.LUMEN_PERF_VERBOSE) console.log(`${r.rows.length} groups x ${values.length} measures: ${ms.toFixed(0)} ms`)
    expect(ms).toBeLessThan(900)
  })
})
