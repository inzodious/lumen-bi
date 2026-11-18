/**
 * Hand-checkable star schema used by the engine tests.
 *
 * Sales (8 rows):                       Amount = Qty * Price (calculated column)
 *  # OrderDate   Prod Cust Qty Price Amount   Product: 1 A Bikes Red, 2 B Bikes Blue, 3 C Clothing Red, 4 D Accessories Black
 *  1 2024-01-15   1    1    2   10    20      Customer: 1 US, 2 US, 3 DE
 *  2 2024-02-10   2    2    1   30    30      ShipDate = OrderDate + 5 days (inactive relationship to Date)
 *  3 2024-02-20   3    3    5    4    20
 *  4 2024-06-01   1    3    1   10    10      Totals: all 173 · 2024 80 · 2025 93
 *  5 2025-01-10   2    1    2   30    60      Category: Bikes 130 · Clothing 28 · Accessories 15
 *  6 2025-02-15   4    2    3    5    15      Country: US 143 · DE 30
 *  7 2025-02-28   1    1    1   10    10
 *  8 2025-03-05   3    2    2    4     8
 */
import type { SemanticModel } from '../../model/types'
import type { DataStore } from '../../model/data'
import { build, d, type ModelSpec } from '../../dax/tabular/__tests__/build'
import { createEngine, type EngineOptions } from '../engine'

export { d }

function dates(): Date[][] {
  const out: Date[][] = []
  for (let t = Date.UTC(2024, 0, 1); t <= Date.UTC(2025, 11, 31); t += 86_400_000) out.push([new Date(t)])
  return out
}

const SALES: Array<[Date, number, number, number, number]> = [
  [d(2024, 1, 15), 1, 1, 2, 10],
  [d(2024, 2, 10), 2, 2, 1, 30],
  [d(2024, 2, 20), 3, 3, 5, 4],
  [d(2024, 6, 1), 1, 3, 1, 10],
  [d(2025, 1, 10), 2, 1, 2, 30],
  [d(2025, 2, 15), 4, 2, 3, 5],
  [d(2025, 2, 28), 1, 1, 1, 10],
  [d(2025, 3, 5), 3, 2, 2, 4]
]

export function spec(extra: (s: ModelSpec) => void = () => {}): ModelSpec {
  const s: ModelSpec = {
    tables: {
      Date: {
        dataCategory: 'Time',
        columns: {
          Date: { type: 'dateTime', isKey: true, formatString: 'Short Date' },
          Year: { type: 'int64', expression: 'YEAR ( \'Date\'[Date] )' },
          MonthNo: { type: 'int64', expression: "MONTH ( 'Date'[Date] )" },
          Month: { type: 'string', expression: 'FORMAT ( \'Date\'[Date], "mmm" )', sortBy: 'MonthNo' }
        },
        rows: dates(),
        hierarchies: [{ name: 'Calendar', levels: [{ name: 'Year', column: 'Year' }, { name: 'Month', column: 'Month' }] }]
      },
      Product: {
        columns: { ProductKey: 'int64', Name: 'string', Category: 'string', Color: 'string', ProductSales: { type: 'double', expression: 'CALCULATE ( SUM ( Sales[Amount] ) )' } },
        rows: [
          [1, 'A', 'Bikes', 'Red'],
          [2, 'B', 'Bikes', 'Blue'],
          [3, 'C', 'Clothing', 'Red'],
          [4, 'D', 'Accessories', 'Black']
        ]
      },
      Customer: {
        columns: { CustomerKey: 'int64', Country: 'string' },
        rows: [
          [1, 'US'],
          [2, 'US'],
          [3, 'DE']
        ]
      },
      Sales: {
        columns: {
          OrderDate: 'dateTime',
          ProductKey: 'int64',
          CustomerKey: 'int64',
          Qty: 'int64',
          Price: { type: 'double', formatString: '\\$#,0.00' },
          Amount: { type: 'double', expression: 'Sales[Qty] * Sales[Price]', formatString: '\\$#,0' },
          ShipDate: { type: 'dateTime', expression: 'Sales[OrderDate] + 5' }
        },
        rows: SALES.map((r) => [...r]),
        measures: {
          Sales: { expression: 'SUM ( Sales[Amount] )', formatString: '\\$#,0' },
          Qty: 'SUM ( Sales[Qty] )',
          'Sales Plus Qty': '[Sales] + [Qty]',
          'Sales YTD': 'TOTALYTD ( [Sales], \'Date\'[Date] )',
          'Sales PY': "CALCULATE ( [Sales], SAMEPERIODLASTYEAR ( 'Date'[Date] ) )",
          'Sales Share': { expression: 'DIVIDE ( [Sales], CALCULATE ( [Sales], ALL ( Product ) ) )', formatString: '0.0%' },
          'Sales Dynamic': { expression: '[Sales]', formatString: '0', formatStringDefinition: 'IF ( [Sales] > 100, "#,0", "0.00" )' },
          'Broken': 'SUM ( Sales[Amount] ) / VALUES ( Product[Category] )'
        }
      }
    },
    relationships: [
      { from: 'Sales.ProductKey', to: 'Product.ProductKey' },
      { from: 'Sales.CustomerKey', to: 'Customer.CustomerKey' },
      { from: 'Sales.OrderDate', to: 'Date.Date' },
      { from: 'Sales.ShipDate', to: 'Date.Date', isActive: false }
    ]
  }
  extra(s)
  return s
}

export function engineFor(extra?: (s: ModelSpec) => void, options: EngineOptions = {}): { engine: ReturnType<typeof createEngine>; model: SemanticModel; data: DataStore } {
  const { model, data } = build(spec(extra))
  const engine = createEngine(model, data, { now: () => new Date(2025, 2, 10, 14, 30, 0), ...options })
  const issues = engine.processCalculated()
  if (issues.length) throw new Error('fixture: ' + JSON.stringify(issues))
  return { engine, model, data }
}

export const col = (table: string, column: string) => ({ Column: { Expression: { SourceRef: { Entity: table } }, Property: column } })
export const msr = (table: string, measure: string) => ({ Measure: { Expression: { SourceRef: { Entity: table } }, Property: measure } })
export const lit = (v: string) => ({ Literal: { Value: v } })
export function inF(table: string, column: string, values: string[], not = false) {
  const cond = { In: { Expressions: [col(table, column)], Values: values.map((v) => [lit(v)]) } }
  return { Version: 2, From: [{ Name: 's', Entity: table, Type: 0 }], Where: [{ Condition: not ? { Not: { Expression: cond } } : cond }] }
}
