/** Functions with keyword (enum) arguments in row context: calculated columns and iterators use the compiled path. */
import { describe, expect, it } from 'vitest'
import { buildModel, processCalculated, runQuery } from '../index.ts'
import { build, d } from './build.ts'

const COLUMNS: Record<string, string> = {
  Days: 'DATEDIFF ( Fact[d], DATE ( 2024, 2, 1 ), DAY )',
  Months: 'DATEDIFF ( DATE ( 2023, 1, 1 ), Fact[d], MONTH )',
  Rk: 'RANKX ( Fact, Fact[v], , ASC, DENSE )',
  RkSkip: 'RANKX ( ALL ( Fact ), Fact[v], Fact[v], DESC, Skip )',
  Shifted: "CALCULATE ( COUNTROWS ( Fact ), DATEADD ( Fact[d], -1, YEAR ) )",
  Cat: 'CONCATENATEX ( TOPN ( 2, Fact, Fact[v], DESC ), FORMAT ( Fact[v], "0" ), ",", Fact[v], ASC )',
  Sw: 'SWITCH ( TRUE (), Fact[v] > 25, "big", Fact[v] > 15, "mid", "small" )',
  Win: 'SUMX ( WINDOW ( 1, ABS, 0, REL, ALL ( Fact[v] ), ORDERBY ( Fact[v], ASC ) ), Fact[v] )',
  Off: 'MAXX ( OFFSET ( -1, ALL ( Fact[v] ), ORDERBY ( Fact[v], ASC ) ), Fact[v] )',
  Wk: 'WEEKDAY ( Fact[d], 2 ) + DATEDIFF ( Fact[d], Fact[d] + 7, WEEK )'
}

function model() {
  const { model: sm, data } = build({
    tables: {
      Fact: {
        columns: { d: 'dateTime', v: 'int64', ...Object.fromEntries(Object.entries(COLUMNS).map(([k, e]) => [k, { type: 'unknown' as const, expression: e }])) },
        rows: [[d(2024, 1, 1), 10], [d(2024, 1, 20), 20], [d(2023, 1, 20), 30]],
        measures: {
          M1: 'SUMX ( Fact, DATEDIFF ( Fact[d], DATE ( 2024, 2, 1 ), DAY ) )',
          M2: 'AVERAGEX ( Fact, DATEDIFF ( Fact[d], DATE ( 2024, 2, 1 ), MONTH ) )',
          M3: 'COUNTROWS ( FILTER ( Fact, DATEDIFF ( Fact[d], DATE ( 2024, 2, 1 ), YEAR ) = 1 ) )'
        }
      }
    }
  })
  const m = buildModel(sm, data)
  const issues = processCalculated(m)
  return { m, issues }
}

describe('keyword arguments in row context', () => {
  it('calculated columns', () => {
    const { m, issues } = model()
    expect(issues).toEqual([])
    const rows = runQuery(m, `EVALUATE SELECTCOLUMNS ( Fact, ${Object.keys(COLUMNS).map((k) => `"${k}", Fact[${k}]`).join(', ')} )`)[0].rows
    expect(rows).toEqual([
      // Shifted: the row's other columns stay filtered by context transition, so no row matches (BLANK)
      // Wk: WEEKDAY ( , 2 ) Mon 1 / Sat 6 / Fri 5, plus one week
      [31, 12, 1, 3, null, '20,30', 'small', 10, null, 2],
      [12, 12, 2, 2, null, '20,30', 'mid', 30, 10, 7],
      [377, 0, 3, 1, null, '20,30', 'big', 60, 20, 6]
    ])
  })
  it('iterator measures', () => {
    const { m } = model()
    expect(runQuery(m, 'EVALUATE ROW ( "a", [M1], "b", [M2], "c", [M3] )')[0].rows).toEqual([[420, 5, 1]]) // months: 1, 1, 13
  })
})
