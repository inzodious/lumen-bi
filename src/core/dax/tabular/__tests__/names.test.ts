/** Name resolution: bare [Name] column references (home table first, then unique model column). */
import { describe, expect, it } from 'vitest'
import { buildModel, Evaluator, FilterContext, parseExpression, processCalculated, runQuery } from '../index.ts'
import { build } from './build.ts'

function model() {
  const { model, data } = build({
    tables: {
      Month: { columns: { MonthID: 'int64', Label: 'string' }, rows: [[1, 'Jan'], [2, 'Feb'], [3, 'Mar']] },
      Sales: {
        columns: { MonthID: 'int64', Amount: 'double', Twice: { type: 'double', expression: '[Amount] * 2' } },
        rows: [[1, 10], [1, 5], [2, 30]],
        measures: {
          Months: 'DISTINCTCOUNT ( [MonthID] )',
          PerMonth: 'SUM ( [Amount] ) / DISTINCTCOUNT ( [MonthID] )',
          MaxMonth: 'MAX ( [MonthID] )',
          Vals: 'COUNTROWS ( VALUES ( [MonthID] ) )'
        }
      },
      Other: { columns: { X: 'int64' }, rows: [[1]], measures: { MonthsOther: 'DISTINCTCOUNT ( [MonthID] )' } }
    },
    relationships: [{ from: 'Sales.MonthID', to: 'Month.MonthID' }]
  })
  const m = buildModel(model, data)
  processCalculated(m)
  return m
}
const scalar = (m: ReturnType<typeof model>, e: string) => {
  const ev = new Evaluator(m)
  return ev.scalar(parseExpression(e), ev.rootEnv(new FilterContext(m)))
}

describe('bare column references', () => {
  it('resolve against the measure home table when the name is ambiguous', () => {
    const m = model()
    expect(scalar(m, '[Months]')).toBe(2) // Sales[MonthID]: 1, 2 (Month table has 3)
    expect(scalar(m, '[PerMonth]')).toBe(22.5)
    expect(scalar(m, '[MaxMonth]')).toBe(2)
    expect(scalar(m, '[Vals]')).toBe(2)
    expect(scalar(m, 'CALCULATE ( [Months], Month[Label] = "Jan" )')).toBe(1)
  })
  it('calculated columns use their own table', () => {
    const m = model()
    expect(runQuery(m, 'EVALUATE SELECTCOLUMNS ( Sales, "t", Sales[Twice] )')[0].rows).toEqual([[20], [10], [60]])
  })
  it('an ambiguous name outside the home table is an error, not a silent pick', () => {
    const m = model()
    expect(() => scalar(m, '[MonthsOther]')).toThrow(/MonthID/)
  })
})

describe('COUNTROWS ( ) without a table', () => {
  it('counts the home table', () => {
    const m = model()
    const t = m.findTable('Sales')!
    const c = t.addColumn('Share', 'double', 'calculated')
    c.expression = 'DIVIDE ( 1, COUNTROWS ( ) )'
    processCalculated(m)
    for (const r of runQuery(m, 'EVALUATE SELECTCOLUMNS ( Sales, "s", Sales[Share] )')[0].rows) expect(r[0]).toBeCloseTo(1 / 3, 12)
    const ev = new Evaluator(m)
    m.measures.set('cnt', { name: 'Cnt', table: m.findTable('Month')!, expression: 'COUNTROWS ( )' })
    expect(ev.scalar(parseExpression('[Cnt]'), ev.rootEnv(new FilterContext(m)))).toBe(3)
  })
})

describe('text is case-insensitive like VertiPaq', () => {
  it('in relationship keys, grouping (first-seen casing), IN and =', () => {
    const { model: sm, data } = build({
      tables: {
        Seg: { columns: { Key: 'string', Channel: 'string' }, rows: [['Alpha', 'Web'], ['beta', 'Store']] },
        Item: { columns: { Name: 'string', Seg: 'string' }, rows: [['x', 'ALPHA'], ['y', 'Beta'], ['z', 'gamma'], ['w', 'alpha']] }
      },
      relationships: [{ from: 'Item.Seg', to: 'Seg.Key' }]
    })
    const m = buildModel(sm, data)
    processCalculated(m)
    const q = (e: string) => runQuery(m, e)[0].rows
    expect(q('EVALUATE ADDCOLUMNS ( Item, "c", RELATED ( Seg[Channel] ) ) ORDER BY Item[Name]').map((r) => r[2])).toEqual(['Web', 'Web', 'Store', null])
    expect(q('EVALUATE VALUES ( Item[Seg] ) ORDER BY Item[Seg]')).toEqual([['ALPHA'], ['Beta'], ['gamma']])
    expect(q('EVALUATE ROW ( "in", "BETA" IN { "beta" }, "eq", "Alpha" = "ALPHA", "n", CALCULATE ( COUNTROWS ( Item ), Seg[Key] = "ALPHA" ) )')).toEqual([[true, true, 2]])
    expect(q('EVALUATE SUMMARIZECOLUMNS ( Seg[Channel], "n", COUNTROWS ( Item ) ) ORDER BY Seg[Channel]')).toEqual([[null, 1], ['Store', 1], ['Web', 2]])
  })
})

describe('IN over larger tables (hashed)', () => {
  it('keeps = semantics: BLANK matches 0, case-insensitive text, dates by value', () => {
    const m = model()
    const big = (xs: string) => `{ ${xs}, 101, 102, 103, 104, 105, 106, 107, 108, 109 }`
    const r = runQuery(m, `EVALUATE ROW (
      "a", BLANK () IN GENERATESERIES ( 0, 20 ),
      "b", BLANK () IN GENERATESERIES ( 1, 20 ),
      "c", 0 IN ${big('BLANK ()')},
      "d", "abc" IN { "x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8", "x9", "ABC" },
      "e", DATE ( 2024, 1, 1 ) IN CALENDAR ( DATE ( 2023, 12, 25 ), DATE ( 2024, 1, 5 ) ),
      "f", ( 2, "B" ) IN { ( 1, "a" ), ( 2, "b" ), ( 3, "c" ), ( 4, "d" ), ( 5, "e" ), ( 6, "f" ), ( 7, "g" ), ( 8, "h" ), ( 9, "i" ) },
      "g", 15.5 IN GENERATESERIES ( 0, 20 )
    )`)[0].rows
    expect(r).toEqual([[true, false, true, true, true, true, false]])
  })
})
