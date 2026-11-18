/**
 * Hand-worked DAX semantics: ALLSELECTED shadow filter contexts, context transition over the expanded table,
 * ALL on some columns of a table filter (value semantics), LOOKUPVALUE and the filter context.
 *
 * Sales: (ProductKey, Amount)   Product: 1 A Red · 2 A Blue · 3 B Red · 4 C Green
 *   1:10  1:20  2:5  3:40  4:25        Brand totals A 35 · B 40 · C 25 = 100 ; Red 70
 */
import { describe, expect, it } from 'vitest'
import { buildModel, processCalculated, runQuery } from '../index.ts'
import { build } from './build.ts'

function model(extraSales: Record<string, string> = {}) {
  const { model: sm, data } = build({
    tables: {
      Product: { columns: { ProductKey: 'int64', Brand: 'string', Color: 'string' }, rows: [[1, 'A', 'Red'], [2, 'A', 'Blue'], [3, 'B', 'Red'], [4, 'C', 'Green']] },
      Sales: {
        columns: { ProductKey: 'int64', Amount: 'double', ...Object.fromEntries(Object.entries(extraSales).map(([k, e]) => [k, { type: 'unknown' as const, expression: e }])) },
        rows: [[1, 10], [1, 20], [2, 5], [3, 40], [4, 25]],
        measures: {
          Sales: 'SUM ( Sales[Amount] )',
          Pct: 'DIVIDE ( [Sales], CALCULATE ( [Sales], ALLSELECTED () ) )',
          IterPct: 'SUMX ( VALUES ( Product[Brand] ), [Pct] )',
          SelBrand: 'CALCULATE ( [Sales], ALLSELECTED ( Product[Brand] ) )',
          IterSelColor: 'SUMX ( VALUES ( Product[Brand] ), CALCULATE ( [Sales], ALLSELECTED ( Product[Color] ) ) )',
          IterSelBrand: 'SUMX ( VALUES ( Product[Brand] ), CALCULATE ( [Sales], ALLSELECTED ( Product[Brand] ) ) )'
        }
      },
      T: { columns: { a: 'int64', b: 'string' }, rows: [[1, 'x'], [1, 'y'], [2, 'x']] }
    },
    relationships: [{ from: 'Sales.ProductKey', to: 'Product.ProductKey' }]
  })
  const m = buildModel(sm, data)
  processCalculated(m)
  return m
}
const q = (m: ReturnType<typeof model>, text: string) => runQuery(m, text)[0].rows

describe('ALLSELECTED and shadow filter contexts', () => {
  it('restores the visual (outer) filters on a column', () => {
    const m = model()
    const rows = q(m, `EVALUATE SUMMARIZECOLUMNS ( Product[Brand], TREATAS ( { "A", "B" }, Product[Brand] ), "s", [SelBrand], "p", [Pct] ) ORDER BY Product[Brand]`)
    expect(rows.map((r) => [r[0], r[1]])).toEqual([['A', 75], ['B', 75]])
    expect(rows[0][2]).toBeCloseTo(35 / 75, 12)
    expect(rows[1][2]).toBeCloseTo(40 / 75, 12)
  })
  it('inside an iteration restores the iterated table (SQLBI: SUMX over VALUES of the visual column gives 100%)', () => {
    const m = model()
    const rows = q(m, `EVALUATE SUMMARIZECOLUMNS ( Product[Brand], "it", [IterPct] ) ORDER BY Product[Brand]`)
    expect(rows).toEqual([['A', 1], ['B', 1], ['C', 1]])
    // at the grand total the shadow is every brand: the shares add up to 100 %
    expect(q(m, `EVALUATE ROW ( "t", [IterPct] )`)).toEqual([[1]])
    expect(q(m, `EVALUATE ROW ( "t", [IterSelBrand] )`)).toEqual([[300]])
  })
  it('a column the iteration does not cover keeps the outer selection', () => {
    const m = model()
    // Color slicer = Red; brands iterate: each brand row sees ALLSELECTED(Color) = Red (outer), filtered to its brand
    const rows = q(m, `EVALUATE SUMMARIZECOLUMNS ( Product[Brand], TREATAS ( { "Red" }, Product[Color] ), "v", [IterSelColor] ) ORDER BY Product[Brand]`)
    expect(rows).toEqual([['A', 30], ['B', 40]])
  })
})

describe('context transition', () => {
  it('filters the expanded table (related one-side columns)', () => {
    const m = model({ ColorOf: 'CALCULATE ( SELECTEDVALUE ( Product[Color] ) )' })
    expect(q(m, `EVALUATE SELECTCOLUMNS ( Sales, "c", Sales[ColorOf] )`)).toEqual([['Red'], ['Red'], ['Blue'], ['Red'], ['Green']])
    expect(q(m, `EVALUATE ROW ( "n", SUMX ( Sales, CALCULATE ( COUNTROWS ( Product ) ) ) )`)).toEqual([[5]])
    // an explicit filter on a related column still overrides that column
    expect(q(m, `EVALUATE ROW ( "n", SUMX ( Sales, CALCULATE ( SUM ( Sales[Amount] ), Product[Color] = "Blue" ) ) )`)).toEqual([[5]])
  })
})

describe('ALL on some columns of a table filter', () => {
  it('keeps the remaining columns by value, not by row', () => {
    const m = model()
    // FILTER ( T, b = "y" ) = row (1, y); ALL ( T[b] ) leaves a = 1 -> rows (1, x) and (1, y)
    expect(q(m, `EVALUATE ROW ( "n", CALCULATE ( CALCULATE ( COUNTROWS ( T ), ALL ( T[b] ) ), FILTER ( T, T[b] = "y" ) ) )`)).toEqual([[2]])
    expect(q(m, `EVALUATE ROW ( "n", CALCULATE ( CALCULATE ( COUNTROWS ( T ), ALL ( T[a] ) ), FILTER ( T, T[b] = "y" ) ) )`)).toEqual([[1]])
  })
})

describe('LOOKUPVALUE', () => {
  it('removes the filters on its table', () => {
    const m = model()
    expect(q(m, `EVALUATE ROW ( "c", CALCULATE ( LOOKUPVALUE ( Product[Color], Product[ProductKey], 4 ), Product[Brand] = "A" ) )`)).toEqual([['Green']])
    expect(q(m, `EVALUATE ROW ( "c", LOOKUPVALUE ( Product[Color], Product[Brand], "A", "many" ) )`)).toEqual([['many']])
    // several rows with different results and no alternate result: error
    expect(() => q(m, `EVALUATE ROW ( "c", LOOKUPVALUE ( Product[Brand], Product[Color], "Red" ) )`)).toThrow(/multiple values/)
    // several rows with the same result: that result
    expect(q(m, `EVALUATE ROW ( "c", LOOKUPVALUE ( Product[Brand], Product[Brand], "A" ) )`)).toEqual([['A']])
  })
})

describe('blank row (invalid relationship)', () => {
  it('VALUES / ALL include it; DISTINCT / ALLNOBLANKROW / table scans exclude it; modifiers keep orphan facts', () => {
    const { model: sm, data } = build({
      tables: {
        P: { columns: { K: 'int64', C: 'string' }, rows: [[1, 'a'], [2, null]] },
        S: { columns: { K: 'int64', V: 'int64' }, rows: [[1, 1], [2, 2], [9, 4]] }
      },
      relationships: [{ from: 'S.K', to: 'P.K' }]
    })
    const m = buildModel(sm, data)
    processCalculated(m)
    const r = (e: string) => runQuery(m, `EVALUATE ROW ( "x", ${e} )`)[0].rows[0][0]
    expect(r('COUNTROWS ( VALUES ( P[C] ) )')).toBe(2) // 'a' and BLANK (genuine blank + blank row share the value)
    expect(r('COUNTROWS ( DISTINCT ( P[C] ) )')).toBe(2) // 'a' and the genuine blank of row 2
    expect(r('COUNTROWS ( VALUES ( P[K] ) )')).toBe(3) // 1, 2, blank row
    expect(r('COUNTROWS ( DISTINCT ( P[K] ) )')).toBe(2)
    expect(r('COUNTROWS ( ALL ( P ) )')).toBe(3)
    expect(r('COUNTROWS ( ALLNOBLANKROW ( P ) )')).toBe(2)
    expect(r('CALCULATE ( SUM ( S[V] ), ALLNOBLANKROW ( P ) )')).toBe(7)
    expect(r('CALCULATE ( SUM ( S[V] ), FILTER ( ALLNOBLANKROW ( P ), TRUE () ) )')).toBe(3)
    expect(r('CALCULATE ( SUM ( S[V] ), ISBLANK ( P[K] ) )')).toBe(4)
  })
})

describe('DETAILROWS', () => {
  it('evaluates the measure detail rows expression in the current context', () => {
    const { model: sm, data } = build({
      tables: {
        Product: { columns: { ProductKey: 'int64', Brand: 'string' }, rows: [[1, 'A'], [2, 'B']] },
        Sales: { columns: { ProductKey: 'int64', Amount: 'double' }, rows: [[1, 10], [1, 20], [2, 5]], measures: { Sales: 'SUM ( Sales[Amount] )', NoDetail: '1' } }
      },
      relationships: [{ from: 'Sales.ProductKey', to: 'Product.ProductKey' }]
    })
    sm.tables.find((t) => t.name === 'Sales')!.measures[0].detailRowsDefinition = 'SELECTCOLUMNS ( Sales, "Brand", RELATED ( Product[Brand] ), "Amount", Sales[Amount] )'
    const m = buildModel(sm, data)
    processCalculated(m)
    expect(runQuery(m, `EVALUATE CALCULATETABLE ( DETAILROWS ( [Sales] ), Product[Brand] = "A" )`)[0].rows).toEqual([['A', 10], ['A', 20]])
    expect(runQuery(m, `EVALUATE ADDCOLUMNS ( VALUES ( Product[Brand] ), "n", COUNTROWS ( DETAILROWS ( [Sales] ) ) )`)[0].rows).toEqual([['A', 2], ['B', 1]])
    expect(() => runQuery(m, `EVALUATE DETAILROWS ( [NoDetail] )`)).toThrow(/no detail rows/)
  })
})

describe('VAR blocks', () => {
  it('a declaration sees only the previous ones (outer variable of the same name before its redeclaration)', async () => {
    const { buildModel, processCalculated, runQuery } = await import('../index.ts')
    const { build } = await import('./build.ts')
    const { model: sm, data } = build({ tables: { T: { columns: { A: 'int64' }, rows: [[1]] } } })
    const m = buildModel(sm, data)
    processCalculated(m)
    const q = (x: string) => runQuery(m, `EVALUATE { ${x} }`)[0].rows[0][0]
    expect(q('VAR x = 1 RETURN ( VAR y = x VAR x = 2 RETURN y * 10 + x )')).toBe(12)
    expect(q('VAR a = 1 VAR b = a + 1 VAR c = b * 10 RETURN a + b + c')).toBe(23)
    expect(q('VAR a = 1 VAR a = a + 1 RETURN a')).toBe(2)
  })
})
