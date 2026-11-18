/**
 * Footprint-keyed measure cache (a measure's value is shared by cells that differ only by filters that cannot reach
 * the tables it reads) and the compiled `x IN variable` row path. Results must equal the plain semantics.
 */
import { describe, expect, it } from 'vitest'
import { buildModel, runQuery } from '../index.ts'
import { build } from './build.ts'

function model(bidi: boolean) {
  const { model: sm, data } = build({
    tables: {
      Sales: {
        columns: { ProductKey: 'int64', RegionKey: 'int64', Amount: 'double', ShipRegion: 'int64' },
        rows: [
          [1, 1, 10, 2],
          [1, 2, 20, 2],
          [2, 1, 30, 1],
          [3, 2, 40, 1],
          [3, 2, 50, 1]
        ],
        measures: {
          Amt: 'SUM ( Sales[Amount] )',
          Products: 'COUNTROWS ( Product )',
          Regions: 'COUNTROWS ( Region )',
          Share: 'DIVIDE ( [Amt], CALCULATE ( [Amt], ALL ( Product ) ) )',
          Both: "CALCULATE ( COUNTROWS ( Product ), CROSSFILTER ( Sales[ProductKey], Product[ProductKey], BOTH ) )",
          Ship: 'CALCULATE ( [Amt], USERELATIONSHIP ( Sales[ShipRegion], Region[RegionKey] ) )',
          // iterating a dimension: the transition is irrelevant once its relationship is disabled
          ByKey: 'SUMX ( Product, CALCULATE ( [Amt], CROSSFILTER ( Sales[ProductKey], Product[ProductKey], NONE ), TREATAS ( { Product[ProductKey] }, Sales[ProductKey] ) ) )',
          Detached: 'SUMX ( Product, CALCULATE ( [Amt], CROSSFILTER ( Sales[ProductKey], Product[ProductKey], NONE ) ) )',
          Attached: 'SUMX ( Product, CALCULATE ( [Amt] ) )',
          AttachedRef: 'SUMX ( Product, [Amt] )',
          RegionRows: 'SUMX ( Product, CALCULATE ( COUNTROWS ( Region ), CROSSFILTER ( Sales[ProductKey], Product[ProductKey], NONE ) ) )'
        }
      },
      Product: { columns: { ProductKey: 'int64', Color: 'string' }, rows: [[1, 'Red'], [2, 'Blue'], [3, 'Red'], [4, 'Green']] },
      Region: { columns: { RegionKey: 'int64', Name: 'string' }, rows: [[1, 'East'], [2, 'West']] }
    },
    relationships: [
      { from: 'Sales.ProductKey', to: 'Product.ProductKey', crossFilteringBehavior: bidi ? 'bothDirections' : 'oneDirection' },
      { from: 'Sales.RegionKey', to: 'Region.RegionKey' },
      { from: 'Sales.ShipRegion', to: 'Region.RegionKey', isActive: false }
    ]
  })
  return buildModel(sm, data)
}

const Q = `EVALUATE SUMMARIZECOLUMNS ( Product[Color], Region[Name], "Amt", [Amt], "Products", [Products], "Regions", [Regions], "Share", [Share], "Both", [Both], "Ship", [Ship] ) ORDER BY Product[Color], Region[Name]`

describe('measure cache keyed by footprint', () => {
  it('single-direction: dimension counts ignore other dimensions', () => {
    const rows = runQuery(model(false), Q)[0].rows
    expect(rows).toEqual([
      // Color, Region, Amt, Products, Regions, Share, Both (Product filtered through Sales), Ship (by ship region)
      ['Blue', 'East', 30, 1, 1, 0.75, 1, 30],
      ['Blue', 'West', null, 1, 1, null, null, null],
      ['Green', 'East', null, 1, 1, null, null, null],
      ['Green', 'West', null, 1, 1, null, null, null],
      ['Red', 'East', 10, 2, 1, 0.25, 1, 90],
      ['Red', 'West', 110, 2, 1, 1, 2, 30]
    ])
  })
  it('bidirectional: the dimension count follows filters through the fact table', () => {
    const rows = runQuery(model(true), Q)[0].rows
    expect(rows.map((r) => [r[0], r[1], r[3]])).toEqual([
      ['Blue', 'East', 1],
      ['Blue', 'West', null],
      ['Green', 'East', null],
      ['Green', 'West', null],
      ['Red', 'East', 1],
      ['Red', 'West', 2]
    ])
  })
})

describe('compiled IN against a variable table', () => {
  const m = model(false)
  const one = (expr: string) => runQuery(m, `EVALUATE ROW ( "v", ${expr} )`)[0].rows[0][0]
  it('matches the literal-table form, including BLANK = 0 equivalence and tuples', () => {
    const keys = 'VAR K = SELECTCOLUMNS ( FILTER ( Product, Product[Color] = "Red" ), "k", Product[ProductKey] )'
    expect(one(`${keys} RETURN COUNTROWS ( FILTER ( Sales, Sales[ProductKey] IN K ) )`)).toBe(4)
    expect(one(`COUNTROWS ( FILTER ( Sales, Sales[ProductKey] IN { 1, 3 } ) )`)).toBe(4)
    // more than 8 rows: hashed membership; BLANK in the table matches 0
    expect(one(`VAR K = { 0, 2, 5, 6, 7, 8, 9, 10, 11, 12 } RETURN COUNTROWS ( FILTER ( Sales, Sales[ProductKey] - 2 IN K ) )`)).toBe(1)
    expect(one(`VAR K = UNION ( { BLANK () }, { 7, 8, 9, 10, 11, 12, 13, 14, 15 } ) RETURN COUNTROWS ( FILTER ( Sales, Sales[ProductKey] - 1 IN K ) )`)).toBe(2)
    expect(one(`VAR K = { ( 1, 2 ), ( 3, 2 ) } RETURN COUNTROWS ( FILTER ( Sales, ( Sales[ProductKey], Sales[RegionKey] ) IN K ) )`)).toBe(3)
  })
  it('width mismatch and scalar variables raise errors', () => {
    expect(() => one(`VAR K = { ( 1, 2 ) } RETURN COUNTROWS ( FILTER ( Sales, Sales[ProductKey] IN K ) )`)).toThrow(/IN operator/)
    expect(() => one(`VAR K = 3 RETURN COUNTROWS ( FILTER ( Sales, Sales[ProductKey] IN K ) )`)).toThrow()
  })
})

describe('context transition skipped when it cannot reach the expression', () => {
  it('gives the same results as the full transition', () => {
    const m = model(false)
    const q = `EVALUATE SUMMARIZECOLUMNS ( Product[Color], "ByKey", [ByKey], "Detached", [Detached], "Attached", [Attached], "AttachedRef", [AttachedRef], "RegionRows", [RegionRows] ) ORDER BY Product[Color]`
    expect(runQuery(m, q)[0].rows).toEqual([
      // Detached: every product of the color sees all sales (150); RegionRows: both regions per product
      ['Blue', 30, 150, 30, 30, 2],
      ['Green', null, 150, null, null, 2],
      ['Red', 120, 300, 120, 120, 4]
    ])
    // a filter on the iterated dimension's columns that also reaches the expression keeps the transition
    expect(runQuery(m, `EVALUATE ROW ( "v", CALCULATE ( [Detached], TREATAS ( { ( 1, 1 ) }, Sales[ProductKey], Product[ProductKey] ) ) )`)[0].rows).toEqual([[30]])
  })
})

describe('iteration fusion (iterators over distinct values with transition sites)', () => {
  function orders() {
    const ordersRows: unknown[][] = []
    const lines: unknown[][] = []
    let id = 1
    for (let o = 1; o <= 40; o++) {
      ordersRows.push([o, o % 7 === 0 ? null : (o * 3) % 5, ['North', 'South', 'East'][o % 3]])
      for (let k = 0; k < (o % 4) + (o % 9 === 0 ? 0 : 1); k++) lines.push([id++, o, ['A', 'B'][(o + k) % 2], (o + k) % 3 !== 0])
    }
    lines.push([id++, 999, 'A', true]) // order missing from Orders: blank row
    const { model: sm, data } = build({
      tables: {
        Orders: { columns: { Order: 'int64', Cap: 'int64', Region: 'string' }, rows: ordersRows as never },
        Lines: {
          columns: { LineId: 'int64', Order: 'int64', Type: 'string', Ok: 'boolean' },
          rows: lines as never,
          measures: {
            Lines: 'CALCULATE ( DISTINCTCOUNT ( Lines[LineId] ), Lines[Ok] = TRUE () )',
            Used: 'CALCULATE ( [Lines], Lines[Type] = "A" )',
            Capped: 'SUMX ( VALUES ( Orders[Order] ), VAR cap = CALCULATE ( MAX ( Orders[Cap] ) ) VAR used = CALCULATE ( [Used] ) RETURN IF ( ISBLANK ( used ) || ISBLANK ( cap ), 0, MIN ( cap, used ) ) )',
            PerRegion: 'AVERAGEX ( VALUES ( Orders[Region] ), [Lines] )',
            Subset: 'CALCULATE ( [Capped], Orders[Order] <= 20 )',
            Tuple: 'CALCULATE ( [Capped], TREATAS ( { ( 1, "North" ), ( 2, "East" ), ( 3, "North" ) }, Orders[Order], Orders[Region] ) )',
            Pairs: 'SUMX ( SUMMARIZE ( Lines, Orders[Region], Lines[Type] ), [Lines] * 10 + CALCULATE ( COUNTROWS ( Lines ) ) )',
            Nested: 'MAXX ( VALUES ( Orders[Region] ), SUMX ( VALUES ( Orders[Order] ), [Used] ) )',
            WithAll: 'SUMX ( ALL ( Orders[Order] ), [Used] + 0 )',
            Filtered: 'COUNTROWS ( FILTER ( VALUES ( Lines[Order] ), [Lines] > 1 ) )'
          }
        }
      },
      relationships: [{ from: 'Lines.Order', to: 'Orders.Order' }]
    })
    return buildModel(sm, data)
  }
  it('matches per-row evaluation', async () => {
    const { setFusionEnabled } = await import('../index.ts')
    const m = orders()
    const q = `EVALUATE SUMMARIZECOLUMNS ( ROLLUPADDISSUBTOTAL ( Orders[Region], "IsTotal" ), "Capped", [Capped], "PerRegion", [PerRegion], "Subset", [Subset], "Tuple", [Tuple], "Pairs", [Pairs], "Nested", [Nested], "WithAll", [WithAll], "Filtered", [Filtered] ) ORDER BY Orders[Region]`
    const q2 = `EVALUATE ROW ( "a", [Capped], "b", CALCULATE ( [Capped], Lines[Type] = "B" ), "c", CALCULATE ( [Filtered], Orders[Region] = "East" ) )`
    const fused = [runQuery(m, q)[0].rows, runQuery(m, q2)[0].rows]
    setFusionEnabled(false)
    try {
      const plain = [runQuery(m, q)[0].rows, runQuery(m, q2)[0].rows]
      expect(fused).toEqual(plain)
      expect(plain[1][0][0]).toBeGreaterThan(0)
    } finally {
      setFusionEnabled(true)
    }
  })
})

describe('time-intelligence tables shared by cells with the same visible dates', () => {
  it('reuses DATESYTD / DATEADD across cells, but not when an argument varies per cell', async () => {
    const { d } = await import('./build.ts')
    const days = Array.from({ length: 60 }, (_, i) => d(2024, 1, 1 + i * 7))
    const { model: sm, data } = build({
      tables: {
        Dates: { columns: { Date: 'dateTime' }, rows: days.map((x) => [x]) },
        Fact: {
          columns: { Date: 'dateTime', K: 'int64', V: 'double' },
          rows: days.flatMap((x, i) => [[x, 1, i], [x, 2, 2 * i]]),
          measures: {
            V: 'SUM ( Fact[V] )',
            YTD: 'CALCULATE ( [V], DATESYTD ( Dates[Date] ) )',
            Shift: 'VAR n = MAX ( Fact[K] ) * 7 RETURN CALCULATE ( [V], DATEADD ( Dates[Date], - n, DAY ) )',
            Prev: 'CALCULATE ( [V], DATEADD ( Dates[Date], -7, DAY ) )'
          }
        }
      },
      relationships: [{ from: 'Fact.Date', to: 'Dates.Date' }]
    })
    const m = buildModel(sm, data)
    const rows = runQuery(m, `EVALUATE CALCULATETABLE ( SUMMARIZECOLUMNS ( Fact[K], "YTD", [YTD], "Shift", [Shift], "Prev", [Prev] ), Dates[Date] = DATE ( 2024, 3, 4 ) ) ORDER BY Fact[K]`)[0].rows
    // 2024-03-04 is week index 9: YTD = sum of weeks 0..9; Shift: K=1 -> week 8, K=2 -> week 7; Prev -> week 8
    expect(rows).toEqual([
      [1, 45, 8, 8],
      [2, 90, 14, 16]
    ])
  })
})
