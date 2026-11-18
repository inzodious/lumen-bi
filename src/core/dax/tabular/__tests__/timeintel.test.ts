/** Time intelligence edge cases (hand-computed day counts / boundaries). */
import { describe, expect, it } from 'vitest'
import { buildModel, processCalculated, runQuery } from '../index.ts'
import { build, d } from './build.ts'

function model() {
  const rows: Date[][] = []
  for (let t = Date.UTC(2022, 0, 1); t <= Date.UTC(2025, 11, 31); t += 86_400_000) rows.push([new Date(t)])
  const { model: sm, data } = build({ tables: { Date: { dataCategory: 'Time', columns: { Date: { type: 'dateTime', isKey: true } }, rows } } })
  const m = buildModel(sm, data)
  processCalculated(m)
  return m
}
const m = model()
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)
/** [count, first, last] of a date table expression under a date filter */
function span(expr: string, filter: string): unknown[] {
  const r = runQuery(m, `EVALUATE ROW ( "n", CALCULATE ( COUNTROWS ( ${expr} ), ${filter} ), "a", CALCULATE ( MINX ( ${expr}, 'Date'[Date] ), ${filter} ), "b", CALCULATE ( MAXX ( ${expr}, 'Date'[Date] ), ${filter} ) )`)[0].rows[0]
  return r.map(iso)
}
const day = (y: number, mo: number, dd: number) => `'Date'[Date] = DATE ( ${y}, ${mo}, ${dd} )`
const month = (y: number, mo: number) => `'Date'[Date] >= DATE ( ${y}, ${mo}, 1 ) && 'Date'[Date] < EDATE ( DATE ( ${y}, ${mo}, 1 ), 1 )`

describe('time intelligence edge cases', () => {
  it('DATESINPERIOD across years and leap days', () => {
    expect(span(`DATESINPERIOD ( 'Date'[Date], MAX ( 'Date'[Date] ), -1, YEAR )`, day(2024, 2, 29))).toEqual([366, '2023-03-01', '2024-02-29'])
    expect(span(`DATESINPERIOD ( 'Date'[Date], MAX ( 'Date'[Date] ), -3, MONTH )`, day(2024, 1, 15))).toEqual([92, '2023-10-16', '2024-01-15'])
    expect(span(`DATESINPERIOD ( 'Date'[Date], MIN ( 'Date'[Date] ), 2, MONTH )`, day(2024, 12, 31))).toEqual([59, '2024-12-31', '2025-02-27'])
  })
  it('PARALLELPERIOD returns whole periods', () => {
    expect(span(`PARALLELPERIOD ( 'Date'[Date], -1, YEAR )`, day(2024, 7, 4))).toEqual([365, '2023-01-01', '2023-12-31'])
    expect(span(`PARALLELPERIOD ( 'Date'[Date], 1, QUARTER )`, month(2024, 11))).toEqual([90, '2025-01-01', '2025-03-31'])
    expect(span(`PARALLELPERIOD ( 'Date'[Date], -2, MONTH )`, day(2024, 3, 31))).toEqual([31, '2024-01-01', '2024-01-31'])
  })
  it('DATEADD / SAMEPERIODLASTYEAR at month ends', () => {
    expect(span(`SAMEPERIODLASTYEAR ( 'Date'[Date] )`, day(2024, 2, 29))).toEqual([1, '2023-02-28', '2023-02-28'])
    expect(span(`DATEADD ( 'Date'[Date], -1, MONTH )`, day(2024, 2, 29))).toEqual([3, '2024-01-29', '2024-01-31'])
    expect(span(`DATEADD ( 'Date'[Date], -1, MONTH )`, month(2024, 2))).toEqual([31, '2024-01-01', '2024-01-31'])
    expect(span(`DATEADD ( 'Date'[Date], 1, YEAR )`, day(2025, 6, 1))).toEqual([null, null, null])
  })
  it('fiscal year ends (DATESYTD / TOTALYTD / STARTOFYEAR / PREVIOUSYEAR)', () => {
    expect(span(`DATESYTD ( 'Date'[Date], "6/30" )`, day(2024, 3, 15))).toEqual([259, '2023-07-01', '2024-03-15'])
    expect(span(`DATESYTD ( 'Date'[Date], "30/6" )`, day(2024, 8, 2))).toEqual([33, '2024-07-01', '2024-08-02'])
    expect(span(`STARTOFYEAR ( 'Date'[Date], "3/31" )`, day(2024, 3, 31))).toEqual([1, '2023-04-01', '2023-04-01'])
    expect(span(`PREVIOUSYEAR ( 'Date'[Date], "6/30" )`, day(2024, 3, 15))).toEqual([365, '2022-07-01', '2023-06-30'])
    expect(span(`NEXTYEAR ( 'Date'[Date], "6/30" )`, day(2024, 3, 15))).toEqual([365, '2024-07-01', '2025-06-30'])
  })
  it('DATESQTD / ENDOFQUARTER / DATESBETWEEN with blanks', () => {
    expect(span(`DATESQTD ( 'Date'[Date] )`, day(2024, 5, 10))).toEqual([40, '2024-04-01', '2024-05-10'])
    expect(span(`ENDOFQUARTER ( 'Date'[Date] )`, day(2024, 5, 10))).toEqual([1, '2024-06-30', '2024-06-30'])
    expect(span(`DATESBETWEEN ( 'Date'[Date], BLANK (), DATE ( 2022, 1, 10 ) )`, day(2024, 5, 10))).toEqual([10, '2022-01-01', '2022-01-10'])
  })
})
void d
