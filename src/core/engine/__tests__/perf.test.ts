/**
 * Performance: summarize with 2 group-bys from 2 dimension tables and 3 simple measures over a large fact table.
 * Default run uses 200k rows with a generous bound; WBI_PERF=1 runs the 1M-row target (≲ 1 s).
 */
import { describe, expect, it } from 'vitest'
import type { SemanticModel } from '../../model/types'
import type { DataStore } from '../../model/data'
import { createEngine } from '../engine'

function bigModel(rows: number): { model: SemanticModel; data: DataStore } {
  const products = 1000
  const days = 730
  let seed = 12345
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const pk = new Array(rows)
  const dk = new Array(rows)
  const ck = new Array(rows)
  const amt = new Array(rows)
  const base = Date.UTC(2024, 0, 1)
  const dates = Array.from({ length: days }, (_, i) => new Date(base + i * 86_400_000))
  for (let i = 0; i < rows; i++) {
    pk[i] = 1 + Math.floor(rnd() * products)
    dk[i] = dates[Math.floor(rnd() * days)]
    ck[i] = 1 + Math.floor(rnd() * 50_000)
    amt[i] = Math.round(rnd() * 10_000) / 100
  }
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const model: SemanticModel = {
    name: 'Perf',
    tables: [
      {
        name: 'Sales',
        columns: [
          { name: 'ProductKey', dataType: 'int64', kind: 'data' },
          { name: 'Date', dataType: 'dateTime', kind: 'data' },
          { name: 'CustomerKey', dataType: 'int64', kind: 'data' },
          { name: 'Amount', dataType: 'double', kind: 'data' }
        ],
        measures: [
          { name: 'Sales', expression: 'SUM ( Sales[Amount] )' },
          { name: 'Orders', expression: 'COUNTROWS ( Sales )' },
          { name: 'Customers', expression: 'DISTINCTCOUNT ( Sales[CustomerKey] )' }
        ],
        hierarchies: [],
        partitions: []
      },
      {
        name: 'Product',
        columns: [
          { name: 'ProductKey', dataType: 'int64', kind: 'data' },
          { name: 'Category', dataType: 'string', kind: 'data' }
        ],
        measures: [],
        hierarchies: [],
        partitions: []
      },
      {
        name: 'Date',
        columns: [
          { name: 'Date', dataType: 'dateTime', kind: 'data' },
          { name: 'Month', dataType: 'string', kind: 'data' }
        ],
        measures: [],
        hierarchies: [],
        partitions: []
      }
    ],
    relationships: [
      { name: 'r1', fromTable: 'Sales', fromColumn: 'ProductKey', toTable: 'Product', toColumn: 'ProductKey', fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection', isActive: true },
      { name: 'r2', fromTable: 'Sales', fromColumn: 'Date', toTable: 'Date', toColumn: 'Date', fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection', isActive: true }
    ],
    expressions: [],
    roles: []
  }
  const data: DataStore = { tables: new Map(), status: new Map() }
  data.tables.set('Sales', {
    rowCount: rows,
    columns: [
      { name: 'ProductKey', type: 'int64', values: pk },
      { name: 'Date', type: 'dateTime', values: dk },
      { name: 'CustomerKey', type: 'int64', values: ck },
      { name: 'Amount', type: 'double', values: amt }
    ]
  })
  data.tables.set('Product', {
    rowCount: products,
    columns: [
      { name: 'ProductKey', type: 'int64', values: Array.from({ length: products }, (_, i) => i + 1) },
      { name: 'Category', type: 'string', values: Array.from({ length: products }, (_, i) => `Category ${i % 20}`) }
    ]
  })
  data.tables.set('Date', {
    rowCount: days,
    columns: [
      { name: 'Date', type: 'dateTime', values: dates },
      { name: 'Month', type: 'string', values: dates.map((d) => `${d.getUTCFullYear()}-${monthNames[d.getUTCMonth()]}`) }
    ]
  })
  return { model, data }
}

function run(rows: number): number {
  const { model, data } = bigModel(rows)
  const engine = createEngine(model, data)
  engine.processCalculated()
  const t0 = performance.now()
  const r = engine.summarize({
    groupBy: [
      { table: 'Product', column: 'Category' },
      { table: 'Date', column: 'Month' }
    ],
    values: [
      { id: 's', expr: { kind: 'measure', table: 'Sales', measure: 'Sales' } },
      { id: 'o', expr: { kind: 'measure', table: 'Sales', measure: 'Orders' } },
      { id: 'c', expr: { kind: 'measure', table: 'Sales', measure: 'Customers' } }
    ]
  })
  const ms = performance.now() - t0
  expect(r.rows.length).toBe(20 * 24)
  expect(r.rows.reduce((a, x) => a + (x[3] as number), 0)).toBe(rows)
  return ms
}

describe('summarize performance', () => {
  it('200k rows, 2 group-bys, 3 measures', () => {
    const ms = run(200_000)
    expect(ms).toBeLessThan(3000)
  })
  it.skipIf(!process.env.WBI_PERF)('1M rows, 2 group-bys, 3 measures in about a second', () => {
    const ms = run(1_000_000)
    process.stdout.write(`summarize over 1M rows: ${ms.toFixed(0)} ms\n`)
    expect(ms).toBeLessThan(1500)
  })
})
