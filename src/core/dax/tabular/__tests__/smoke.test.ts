import { describe, expect, it } from 'vitest'
import { buildModel, Evaluator, FilterContext, parseExpression, processCalculated, runQuery } from '../index.ts'
import { build } from './build.ts'

function star() {
  const { model, data } = build({
    tables: {
      Product: { columns: { ProductKey: 'int64', Category: 'string', Color: 'string' }, rows: [[1, 'Bikes', 'Red'], [2, 'Bikes', 'Blue'], [3, 'Clothing', 'Red']] },
      Sales: {
        columns: { ProductKey: 'int64', Qty: 'int64', Amount: 'double' },
        rows: [[1, 2, 10], [1, 1, 5], [2, 3, 30], [3, 1, 7], [9, 1, 100]],
        measures: { 'Total Amount': 'SUM ( Sales[Amount] )', Qty: 'SUM(Sales[Qty])', 'Red Amount': 'CALCULATE([Total Amount], Product[Color] = "Red")' }
      }
    },
    relationships: [{ from: 'Sales.ProductKey', to: 'Product.ProductKey' }]
  })
  const m = buildModel(model, data)
  processCalculated(m)
  return m
}

function scalar(m: ReturnType<typeof star>, expr: string) {
  const ev = new Evaluator(m)
  return ev.scalar(parseExpression(expr), ev.rootEnv(new FilterContext(m)))
}

describe('tabular smoke', () => {
  it('evaluates basic measures', () => {
    const m = star()
    expect(scalar(m, '[Total Amount]')).toBe(152)
    expect(scalar(m, '[Red Amount]')).toBe(22)
    expect(scalar(m, 'COUNTROWS ( Product )')).toBe(4) // blank row for orphan key 9
    expect(scalar(m, 'CALCULATE ( [Total Amount], Product[Category] = "Bikes" )')).toBe(45)
    expect(scalar(m, 'SUMX ( Product, [Total Amount] )')).toBe(152)
    expect(scalar(m, 'CALCULATE ( [Total Amount], ISBLANK ( Product[Category] ) )')).toBe(100)
  })
  it('runs queries', () => {
    const m = star()
    const r = runQuery(m, 'EVALUATE SUMMARIZECOLUMNS ( Product[Category], "Amt", [Total Amount] ) ORDER BY Product[Category]')
    expect(r[0].rows).toEqual([[null, 100], ['Bikes', 45], ['Clothing', 7]])
    expect(r[0].columns.map((c) => c.name)).toEqual(['Product[Category]', '[Amt]'])
  })
})
