/**
 * Visual calculations over the visual matrix (hand-worked on the engine fixture).
 * Sales by month: 2024 Jan 20 · Feb 50 · Jun 10 (80) ; 2025 Jan 60 · Feb 25 · Mar 8 (93) ; total 173.
 * Category x Year: Bikes 60 / 70 · Clothing 20 / 8 · Accessories - / 15.
 */
import { describe, expect, it } from 'vitest'
import type { VisualCalcRequest } from '../api'
import { engineFor } from './fixture'

const { engine } = engineFor()
const sales = { id: 'Values|Sales.Sales', expr: { kind: 'measure' as const, table: 'Sales', measure: 'Sales' } }
const round = (v: unknown) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)

function run(groupBy: VisualCalcRequest['base']['groupBy'], rowFields: number, names: string[], calcs: Array<[string, string]>) {
  const r = engine.evaluateVisualCalculations!({ base: { groupBy, values: [sales] }, rowFields, names, calcs: calcs.map(([name, expression]) => ({ id: name, name, expression })) })
  expect(r.errors).toEqual(calcs.map(() => null))
  return r
}

describe('visual calculations', () => {
  it('one row axis: RUNNINGSUM, PREVIOUS, FIRST, MOVINGAVERAGE, COLLAPSEALL, ROWNUMBER (and the total row)', () => {
    const r = run([{ table: 'Date', column: 'Year' }], 1, ['Year', 'Sales'], [
      ['RS', 'RUNNINGSUM ( [Sales] )'],
      ['Prev', 'PREVIOUS ( [Sales] )'],
      ['First', 'FIRST ( [Sales] )'],
      ['MA', 'MOVINGAVERAGE ( [Sales], 2 )'],
      ['Pct', 'DIVIDE ( [Sales], COLLAPSEALL ( [Sales], ROWS ) )'],
      ['Rn', 'ROWNUMBER ()'],
      ['VsPrev', '[Sales] - PREVIOUS ( [Sales] )']
    ])
    expect(r.result.rows.map((x) => x.map(round))).toEqual([
      [2024, 80, 80, null, 80, 80, round(80 / 173), 1, 80],
      [2025, 93, 173, 80, 80, 86.5, round(93 / 173), 2, 13]
    ])
    expect(r.result.columns.slice(2).map((c) => c.id)).toEqual(['RS', 'Prev', 'First', 'MA', 'Pct', 'Rn', 'VsPrev'])
    const total = r.cells.find((c) => c.rowLevel === 0)!
    expect(total.values).toEqual([173])
    expect(total.calcs.map(round)).toEqual([173, null, 173, 173, 1, 1, 173])
  })

  it('hierarchy: reset, COLLAPSE, EXPAND, LOOKUP(WITHTOTALS), ISATLEVEL, RANGE', () => {
    const r = run([{ table: 'Date', column: 'Year' }, { table: 'Date', column: 'Month' }], 2, ['Year', 'Month', 'Sales'], [
      ['RSyear', 'RUNNINGSUM ( [Sales], HIGHESTPARENT )'],
      ['RSall', 'RUNNINGSUM ( [Sales] )'],
      ['RSparent', 'RUNNINGSUM ( [Sales], LOWESTPARENT )'],
      ['OfParent', 'DIVIDE ( [Sales], COLLAPSE ( [Sales], ROWS ) )'],
      ['Avg', 'EXPAND ( AVERAGE ( [Sales] ), ROWS )'],
      ['Same2025', 'LOOKUP ( SUM ( [Sales] ), [Year], 2025 )'],
      ['Year2025', 'LOOKUPWITHTOTALS ( SUM ( [Sales] ), [Year], 2025 )'],
      ['AtMonth', 'ISATLEVEL ( [Month] )'],
      ['Last2', 'CALCULATE ( SUM ( [Sales] ), RANGE ( -1, ROWS ) )'],
      ['Avg2', 'AVERAGEX ( RANGE ( -1, ROWS ), [Sales] )']
    ])
    expect(r.result.rows.map((x) => x.map(round))).toEqual([
      [2024, 'Jan', 20, 20, 20, 20, 0.25, 20, 60, 93, true, 20, 20],
      [2024, 'Feb', 50, 70, 70, 70, 0.625, 50, 25, 93, true, 70, 35],
      [2024, 'Jun', 10, 80, 80, 80, 0.125, 10, null, 93, true, 60, 30],
      [2025, 'Jan', 60, 60, 140, 60, round(60 / 93), 60, 60, 93, true, 70, 35],
      [2025, 'Feb', 25, 85, 165, 85, round(25 / 93), 25, 25, 93, true, 85, 42.5],
      [2025, 'Mar', 8, 93, 173, 93, round(8 / 93), 8, 8, 93, true, 33, 16.5]
    ])
    const y2024 = r.cells.find((c) => c.rowLevel === 1 && c.keys[0] === 2024)!
    // at the year level: reset by year = each year alone; EXPAND = average of its months; not at Month level
    expect(y2024.calcs.map(round)).toEqual([80, 80, 80, round(80 / 173), round(80 / 3), 93, 93, false, 80, 80])
    const total = r.cells.find((c) => c.rowLevel === 0)!
    expect(round(total.calcs[4])).toBe(86.5)
  })

  it('COLUMNS axis and ROWS COLUMNS traversal', () => {
    const r = run([{ table: 'Product', column: 'Category' }, { table: 'Date', column: 'Year' }], 1, ['Category', 'Year', 'Sales'], [
      ['AcrossYears', 'RUNNINGSUM ( [Sales], COLUMNS )'],
      ['DownRows', 'RUNNINGSUM ( [Sales], ROWS )'],
      ['RowsThenColumns', 'RUNNINGSUM ( [Sales], ROWS COLUMNS )']
    ])
    const get = (cat: string, y: number) => r.result.rows.find((x) => x[0] === cat && x[1] === y)!.slice(2)
    // categories sort Accessories, Bikes, Clothing; ROWS COLUMNS goes down the rows of 2024, then of 2025:
    // Bikes 60, Clothing 20 | Accessories 15, Bikes 70, Clothing 8
    expect(get('Bikes', 2024)).toEqual([60, 60, 60, 60])
    expect(get('Clothing', 2024)).toEqual([20, 20, 80, 80])
    expect(get('Accessories', 2025)).toEqual([15, 15, 15, 95])
    expect(get('Bikes', 2025)).toEqual([70, 130, 85, 165])
    expect(get('Clothing', 2025)).toEqual([8, 28, 93, 173])
  })

  it('reports errors per calculation (not in the visual / syntax)', () => {
    const r = engine.evaluateVisualCalculations!({
      base: { groupBy: [{ table: 'Date', column: 'Year' }], values: [sales] },
      rowFields: 1,
      names: ['Year', 'Sales'],
      calcs: [
        { id: 'a', name: 'Bad', expression: '[Qty] * 2' },
        { id: 'b', name: 'Syntax', expression: 'RUNNINGSUM ( [Sales]' },
        { id: 'c', name: 'Ok', expression: '[Sales] * 2' }
      ]
    })
    expect(r.errors[0]).toMatch(/Qty/)
    expect(r.errors[1]).toBeTruthy()
    expect(r.errors[2]).toBeNull()
    expect(r.result.rows.map((x) => x[4])).toEqual([160, 186])
  })
})

describe('visual calculations: window functions with ORDERBY / PARTITIONBY / MATCHBY / reset', () => {
  // months: 2024 Jan 20 · Feb 50 · Jun 10 ; 2025 Jan 60 · Feb 25 · Mar 8
  const ym = [{ table: 'Date', column: 'Year' }, { table: 'Date', column: 'Month' }]
  const rows = (r: ReturnType<typeof run>) => r.result.rows.map((x) => x.slice(3).map(round))
  const yearCells = (r: ReturnType<typeof run>) => r.cells.filter((c) => c.rowLevel === 1).map((c) => c.calcs.map(round))

  it("Microsoft's RANK examples: within each year and over the entire history", () => {
    const r = run(ym, 2, ['Year', 'Month', 'Sales'], [
      ['RankInYear', 'RANK ( DENSE, ORDERBY ( [Sales], DESC ), PARTITIONBY ( [Year] ) )'],
      ['RankAll', 'RANK ( DENSE, ORDERBY ( [Sales], DESC ) )'],
      ['RnAsc', 'ROWNUMBER ( ORDERBY ( [Sales] ) )']
    ])
    expect(rows(r)).toEqual([
      [2, 4, 3],
      [1, 2, 5],
      [3, 5, 2],
      [1, 1, 6],
      [2, 3, 4],
      [3, 6, 1]
    ])
    // year level: PARTITIONBY ( [Year] ) puts each year alone; over all years 93 > 80
    expect(yearCells(r)).toEqual([
      [1, 2, 1],
      [1, 1, 2]
    ])
    expect(r.cells.find((c) => c.rowLevel === 0)!.calcs).toEqual([1, 1, 1])
  })

  it('OFFSET / INDEX / WINDOW with ORDERBY and PARTITIONBY', () => {
    const r = run(ym, 2, ['Year', 'Month', 'Sales'], [
      ['PrevDesc', 'CALCULATE ( SUM ( [Sales] ), OFFSET ( -1, ORDERBY ( [Sales], DESC ), PARTITIONBY ( [Year] ) ) )'],
      ['TopMonth', 'MAXX ( INDEX ( 1, ORDERBY ( [Sales], DESC ), PARTITIONBY ( [Year] ) ), [Month] )'],
      ['RunBySales', 'SUMX ( WINDOW ( 1, ABS, 0, REL, ORDERBY ( [Sales] ), PARTITIONBY ( [Year] ) ), [Sales] )'],
      ['NextOnAxis', 'CALCULATE ( SUM ( [Sales] ), OFFSET ( 1, ROWS ) )']
    ])
    expect(rows(r)).toEqual([
      [50, 'Feb', 30, 50],
      [null, 'Feb', 80, 10],
      [20, 'Feb', 10, 60],
      [null, 'Jan', 93, 25],
      [60, 'Jan', 33, 8],
      [25, 'Jan', 8, null]
    ])
  })

  it('reset by a field reference, relative reset clamped to -(N-1), and reset with ORDERBY is an error', () => {
    const r = run(ym, 2, ['Year', 'Month', 'Sales'], [
      ['RnByYear', 'ROWNUMBER ( ROWS, [Year] )'],
      ['RnRel', 'ROWNUMBER ( ROWS, -5 )'],
      ['RnNone', 'ROWNUMBER ( ROWS )'],
      ['IdxLast', 'CALCULATE ( SUM ( [Sales] ), INDEX ( -1, ROWS, HIGHESTPARENT ) )']
    ])
    expect(rows(r)).toEqual([
      [1, 1, 1, 10],
      [2, 2, 2, 10],
      [3, 3, 3, 10],
      [1, 1, 4, 8],
      [2, 2, 5, 8],
      [3, 3, 6, 8]
    ])
    // year level: an absolute reset at/above its level resets for each element; relative -1 at the top level = none
    expect(yearCells(r)).toEqual([
      [1, 1, 1, 80],
      [1, 2, 2, 93]
    ])
    const bad = engine.evaluateVisualCalculations!({
      base: { groupBy: ym, values: [sales] },
      rowFields: 2,
      names: ['Year', 'Month', 'Sales'],
      calcs: [{ id: 'x', name: 'X', expression: 'RANK ( SKIP, ROWS, ORDERBY ( [Sales] ), , , , HIGHESTPARENT )' }]
    })
    expect(bad.errors[0]).toMatch(/reset.*ORDERBY/i)
  })

  it('MATCHBY identifies the current cell (and must be unique in the partition)', () => {
    const r = run(ym, 2, ['Year', 'Month', 'Sales'], [['M', 'ROWNUMBER ( ROWS, ORDERBY ( [Sales], DESC ), , PARTITIONBY ( [Year] ), MATCHBY ( [Month] ) )']])
    expect(rows(r).map((x) => x[0])).toEqual([2, 1, 3, 1, 2, 3])
    const bad = engine.evaluateVisualCalculations!({
      base: { groupBy: ym, values: [sales] },
      rowFields: 2,
      names: ['Year', 'Month', 'Sales'],
      calcs: [{ id: 'x', name: 'X', expression: 'ROWNUMBER ( ROWS, ORDERBY ( [Sales] ), , , MATCHBY ( [Month] ) )' }]
    })
    // Jan and Feb occur in both years: [Month] alone cannot identify a month cell
    expect(bad.errors[0]).toMatch(/MATCHBY/)
  })

  it('blank ordering: DEFAULT, BLANKS FIRST / LAST on the expression, the <blanks> argument, SKIP vs DENSE ties', () => {
    // E = Sales unless >= 50: Jan24 20, Feb24 blank, Jun24 10, Jan25 blank, Feb25 25, Mar25 8
    const E = 'IF ( [Sales] >= 50, BLANK (), [Sales] )'
    const r = run(ym, 2, ['Year', 'Month', 'Sales'], [
      ['DescDefault', `RANK ( SKIP, ORDERBY ( ${E}, DESC ) )`],
      ['AscDefault', `RANK ( SKIP, ORDERBY ( ${E}, ASC ) )`],
      ['AscLast', `RANK ( SKIP, ORDERBY ( ${E}, ASC BLANKS LAST ) )`],
      ['DescFirstDense', `RANK ( DENSE, ORDERBY ( ${E}, DESC BLANKS FIRST ) )`],
      ['ArgLast', `RANK ( SKIP, ROWS, ORDERBY ( ${E} ), LAST )`],
      ['ExprWins', `RANK ( SKIP, ROWS, ORDERBY ( ${E}, ASC BLANKS FIRST ), LAST )`]
    ])
    expect(rows(r)).toEqual([
      [2, 5, 3, 3, 3, 5],
      [5, 1, 5, 1, 5, 1],
      [3, 4, 2, 4, 2, 4],
      [5, 1, 5, 1, 5, 1],
      [1, 6, 4, 2, 4, 6],
      [4, 3, 1, 5, 1, 3]
    ])
  })
})

describe('visual calculations: user-defined functions', () => {
  it('a visual calculation calls a model function with visual fields', async () => {
    const { createEngine } = await import('../engine')
    const { model, data } = engineFor()
    model.functions = [{ name: 'AddTax', expression: '( amount : NUMERIC, rate : NUMERIC = 0.1 ) => amount * ( 1 + rate )' }]
    const e = createEngine(model, data)
    e.processCalculated()
    const r = e.evaluateVisualCalculations!({ base: { groupBy: [{ table: 'Date', column: 'Year' }], values: [sales] }, rowFields: 1, names: ['Year', 'Sales'], calcs: [{ id: 't', name: 'Taxed', expression: 'AddTax ( [Sales], 0.5 )' }] })
    expect(r.errors).toEqual([null])
    expect(r.result.rows.map((x) => x[2])).toEqual([120, 139.5])
  })
})

describe('visual calculations: densification (rows x columns)', () => {
  it('combinations without data get the calculations (Accessories has no 2024 sales)', () => {
    const r = run([{ table: 'Product', column: 'Category' }, { table: 'Date', column: 'Year' }], 1, ['Category', 'Year', 'Sales'], [
      ['LastRow', 'LAST ( [Sales], ROWS )'],
      ['Prev', 'PREVIOUS ( [Sales], COLUMNS )']
    ])
    // the densified leaf row is returned with a blank base value: LAST down the 2024 column = Clothing 20
    expect(r.result.rows.find((x) => x[0] === 'Accessories' && x[1] === 2024)).toEqual(['Accessories', 2024, null, 20, null])
    // Accessories 2025: PREVIOUS across columns is the (densified, blank) 2024 cell
    expect(r.result.rows.find((x) => x[0] === 'Accessories' && x[1] === 2025)).toEqual(['Accessories', 2025, 15, 8, null])
    const dens = r.cells.filter((c) => (c as { densified?: boolean }).densified)
    expect(dens.map((c) => [c.rowLevel, c.colLevel, c.keys])).toEqual([[1, 1, ['Accessories', 2024]]])
  })
})
