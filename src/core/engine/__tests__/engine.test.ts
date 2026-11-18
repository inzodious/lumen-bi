import { describe, expect, it } from 'vitest'
import { col, d, engineFor, inF, lit, msr } from './fixture'

const { engine } = engineFor()
const s = (expr: string, filters?: any[]) => engine.evaluateScalar(expr, filters).value
const q = (query: string) => engine.runDaxQuery(query).tables[0].rows

describe('basic aggregation and relationships', () => {
  it('sums, counts, averages', () => {
    expect(s('[Sales]')).toBe(173)
    expect(s('[Qty]')).toBe(17)
    expect(s('COUNTROWS ( Sales )')).toBe(8)
    expect(s('DISTINCTCOUNT ( Sales[ProductKey] )')).toBe(4)
    expect(s('AVERAGE ( Sales[Amount] )')).toBe(21.625)
    expect(s('MIN ( Sales[Amount] )')).toBe(8)
    expect(s('MAX ( Sales[OrderDate] )')).toEqual(d(2025, 3, 5))
    expect(s('COUNTROWS ( Product )')).toBe(4) // no orphan keys: no blank row
    expect(s('MEDIAN ( Sales[Amount] )')).toBe(17.5)
    expect(s('PRODUCTX ( Customer, Customer[CustomerKey] )')).toBe(6)
    expect(s('STDEV.P ( Product[ProductKey] )')).toBeCloseTo(1.118033989, 8)
    expect(s('VAR.S ( Product[ProductKey] )')).toBeCloseTo(1.6666667, 6)
    expect(s('PERCENTILE.INC ( Sales[Amount], 0.5 )')).toBe(17.5)
    expect(s('COUNTBLANK ( Product[Color] )')).toBe(0)
  })
  it('filters propagate one-to-many', () => {
    expect(s('CALCULATE ( [Sales], Product[Category] = "Bikes" )')).toBe(130)
    expect(s('CALCULATE ( [Sales], Customer[Country] = "DE" )')).toBe(30)
    expect(s('CALCULATE ( [Sales], \'Date\'[Year] = 2024 )')).toBe(80)
    expect(s('CALCULATE ( COUNTROWS ( Customer ), Product[Category] = "Clothing" )')).toBe(3) // single direction
    expect(s('CALCULATE ( COUNTROWS ( Customer ), Product[Category] = "Clothing", CROSSFILTER ( Sales[CustomerKey], Customer[CustomerKey], BOTH ) )')).toBe(2)
  })
  it('calculated columns with context transition, RELATED and EARLIER', () => {
    expect(q("EVALUATE SELECTCOLUMNS ( Product, \"k\", Product[ProductKey], \"s\", Product[ProductSales] ) ORDER BY [k]")).toEqual([
      [1, 40],
      [2, 90],
      [3, 28],
      [4, 15]
    ])
    expect(q('EVALUATE ADDCOLUMNS ( VALUES ( Product[Name] ), "rank", CALCULATE ( COUNTROWS ( FILTER ( ALL ( Product ), Product[ProductSales] > MAX ( Product[ProductSales] ) ) ) ) + 1 ) ORDER BY Product[Name]')).toEqual([
      ['A', 2],
      ['B', 1],
      ['C', 3],
      ['D', 4]
    ])
    expect(s('SUMX ( Sales, RELATED ( Product[ProductKey] ) )')).toBe(17)
    expect(s('MAXX ( Product, COUNTROWS ( FILTER ( Product, Product[ProductSales] > EARLIER ( Product[ProductSales] ) ) ) + 1 )')).toBe(4)
  })
})

describe('CALCULATE semantics', () => {
  it('context transition in iterators', () => {
    expect(s('SUMX ( VALUES ( Product[Category] ), [Sales] )')).toBe(173)
    expect(s('MAXX ( VALUES ( Product[Category] ), [Sales] )')).toBe(130)
    expect(s('AVERAGEX ( Customer, [Sales] )')).toBeCloseTo(173 / 3, 10)
    expect(s('COUNTROWS ( FILTER ( Customer, [Sales] > 50 ) )')).toBe(2)
  })
  it('ALL, ALLEXCEPT, REMOVEFILTERS, KEEPFILTERS', () => {
    const bikes = [inF('Product', 'Category', ["'Bikes'"])]
    expect(s('[Sales Share]', bikes)).toBeCloseTo(130 / 173, 12)
    expect(s('CALCULATE ( [Sales], REMOVEFILTERS ( Product[Category] ) )', bikes)).toBe(173)
    expect(s('CALCULATE ( [Sales], ALLEXCEPT ( Sales, Customer[Country] ) )', [inF('Customer', 'Country', ["'DE'"]), ...bikes])).toBe(30)
    const blue = [inF('Product', 'Color', ["'Blue'"])]
    expect(s('CALCULATE ( [Sales], Product[Color] = "Red" )', blue)).toBe(68)
    expect(s('CALCULATE ( [Sales], KEEPFILTERS ( Product[Color] = "Red" ) )', blue)).toBe(null)
    expect(s('CALCULATE ( [Sales], ALL ( ) )', bikes)).toBe(173)
  })
  it('table filters filter the expanded table', () => {
    expect(s('CALCULATE ( [Sales], FILTER ( Sales, Sales[Qty] >= 2 ) )')).toBe(20 + 20 + 60 + 15 + 8)
    expect(s('CALCULATE ( COUNTROWS ( Product ), FILTER ( Sales, Sales[Qty] >= 3 ) )')).toBe(2)
    expect(s('CALCULATE ( [Sales], TREATAS ( { "DE" }, Customer[Country] ) )')).toBe(30)
    expect(s('CALCULATE ( [Sales], Product[Category] IN { "Clothing", "Accessories" } )')).toBe(43)
    expect(s('CALCULATE ( [Sales], NOT ( Product[Category] IN { "Bikes" } ) )')).toBe(43)
  })
  it('USERELATIONSHIP activates the ship-date relationship', () => {
    const mar = [inF('Date', 'Year', ['2025L']), inF('Date', 'Month', ["'Mar'"])]
    expect(s('[Sales]', mar)).toBe(8)
    expect(s("CALCULATE ( [Sales], USERELATIONSHIP ( Sales[ShipDate], 'Date'[Date] ) )", mar)).toBe(18)
  })
  it('measure references transition and calc group style nesting', () => {
    expect(s('[Sales Plus Qty]')).toBe(190)
    expect(s('VAR x = [Sales] RETURN CALCULATE ( x, ALL ( Product ) )')).toBe(173)
  })
})

describe('time intelligence', () => {
  const ym = (y: number, m: string) => [inF('Date', 'Year', [`${y}L`]), inF('Date', 'Month', [`'${m}'`])]
  it('YTD / PY / DATEADD / PARALLELPERIOD', () => {
    expect(s('[Sales YTD]', ym(2025, 'Feb'))).toBe(85)
    expect(s('[Sales PY]', ym(2025, 'Feb'))).toBe(50)
    expect(s('[Sales PY]', [inF('Date', 'Year', ['2025L'])])).toBe(80)
    expect(s("CALCULATE ( [Sales], DATEADD ( 'Date'[Date], -1, MONTH ) )", ym(2025, 'Mar'))).toBe(25)
    expect(s("CALCULATE ( [Sales], PARALLELPERIOD ( 'Date'[Date], -1, YEAR ) )", ym(2025, 'Feb'))).toBe(80)
    expect(s("CALCULATE ( [Sales], PREVIOUSMONTH ( 'Date'[Date] ) )", ym(2025, 'Mar'))).toBe(25)
    expect(s("CALCULATE ( [Sales], NEXTMONTH ( 'Date'[Date] ) )", ym(2025, 'Feb'))).toBe(8)
    expect(s("TOTALYTD ( [Sales], 'Date'[Date], \"6/30\" )", ym(2024, 'Jun'))).toBe(80)
    expect(s("TOTALYTD ( [Sales], 'Date'[Date], \"6/30\" )", ym(2025, 'Mar'))).toBe(93) // fiscal Jul-2024..Mar-2025 (no sales Jul..Dec 2024)
  })
  it('date ranges', () => {
    expect(s("CALCULATE ( [Sales], DATESBETWEEN ( 'Date'[Date], DATE ( 2024, 2, 1 ), DATE ( 2024, 6, 1 ) ) )")).toBe(60)
    expect(s("CALCULATE ( [Sales], DATESINPERIOD ( 'Date'[Date], DATE ( 2025, 2, 28 ), -1, MONTH ) )")).toBe(25)
    expect(s("CALCULATE ( [Sales], DATESMTD ( 'Date'[Date] ) )", [inF('Date', 'Date', ["datetime'2025-02-20T00:00:00'"])])).toBe(15)
    expect(s("CALCULATE ( [Sales], DATESQTD ( 'Date'[Date] ) )", [inF('Date', 'Date', ["datetime'2024-06-30T00:00:00'"])])).toBe(10)
    expect(s("FIRSTDATE ( 'Date'[Date] )", ym(2025, 'Feb'))).toEqual(d(2025, 2, 1))
    expect(s("ENDOFMONTH ( 'Date'[Date] )", ym(2024, 'Feb'))).toEqual(d(2024, 2, 29))
    expect(s("STARTOFYEAR ( 'Date'[Date] )", ym(2025, 'Mar'))).toEqual(d(2025, 1, 1))
    expect(s("CLOSINGBALANCEMONTH ( [Sales], 'Date'[Date] )", ym(2025, 'Feb'))).toBe(10)
    expect(s("LASTNONBLANK ( 'Date'[Date], [Sales] )", [inF('Date', 'Year', ['2025L'])])).toEqual(d(2025, 3, 5))
    expect(s("LASTNONBLANKVALUE ( 'Date'[Date], [Sales] )", [inF('Date', 'Year', ['2024L'])])).toBe(10)
  })
})

describe('summarize (visual queries)', () => {
  it('groups with auto-exist, sort-by columns and blank removal', () => {
    const r = engine.summarize({
      groupBy: [{ table: 'Date', column: 'Month' }],
      values: [{ id: 'v', expr: { kind: 'measure', table: 'Sales', measure: 'Sales' } }],
      filters: [inF('Date', 'Year', ['2025L'])]
    })
    expect(r.rows).toEqual([
      ['Jan', 60],
      ['Feb', 25],
      ['Mar', 8]
    ])
    expect(r.columns.map((c) => c.id)).toEqual(['Date.Month', 'v'])
    expect(r.columns[1].formatString).toBe('\\$#,0')
  })
  it('cross-table groups, aggregates and ordering by value', () => {
    const r = engine.summarize({
      groupBy: [{ table: 'Customer', column: 'Country' }, { kind: 'sq', expr: col('Product', 'Category') }],
      values: [
        { id: 's', expr: { kind: 'aggregate', table: 'Sales', column: 'Amount', fn: 'sum' } },
        { id: 'n', expr: { kind: 'sq', expr: { Aggregation: { Expression: col('Sales', 'ProductKey'), Function: 2 } } } }
      ],
      orderBy: [{ target: { value: 's' }, direction: 'desc' }],
      limit: 3
    })
    expect(r.rows).toEqual([
      ['US', 'Bikes', 120, 2],
      ['DE', 'Clothing', 20, 1],
      ['US', 'Accessories', 15, 1]
    ])
    expect(r.truncated).toBe(true)
  })
  it('show items with no data keeps blank rows', () => {
    const r = engine.summarize({
      groupBy: [{ table: 'Product', column: 'Category' }],
      values: [{ id: 'v', expr: { kind: 'measure', table: 'Sales', measure: 'Sales' } }],
      filters: [inF('Customer', 'Country', ["'DE'"])],
      showItemsWithNoData: true
    })
    expect(r.rows).toEqual([
      ['Accessories', null],
      ['Bikes', 10],
      ['Clothing', 20]
    ])
  })
  it('ALLSELECTED restores the visual-level (query) filters', () => {
    const r = engine.summarize({
      groupBy: [{ table: 'Product', column: 'Category' }],
      values: [{ id: 'p', expr: { kind: 'dax', expression: 'DIVIDE ( [Sales], CALCULATE ( [Sales], ALLSELECTED ( Product[Category] ) ) )' } }],
      filters: [inF('Customer', 'Country', ["'US'"])]
    })
    expect(r.rows.map((x) => [x[0], Math.round((x[1] as number) * 1000) / 1000])).toEqual([
      ['Accessories', Math.round((15 / 143) * 1000) / 1000],
      ['Bikes', Math.round((120 / 143) * 1000) / 1000],
      ['Clothing', Math.round((8 / 143) * 1000) / 1000]
    ])
  })
  it('ISINSCOPE distinguishes detail rows from totals', () => {
    const v = [{ id: 'x', expr: { kind: 'dax' as const, expression: 'IF ( ISINSCOPE ( Product[Category] ), 1, 0 )' } }]
    expect(engine.summarize({ groupBy: [{ table: 'Product', column: 'Category' }], values: v }).rows.every((r) => r[1] === 1)).toBe(true)
    expect(engine.summarize({ groupBy: [], values: v }).rows).toEqual([[0]])
  })
  it('cards return one row even when blank', () => {
    const r = engine.summarize({ groupBy: [], values: [{ id: 'v', expr: { kind: 'measure', table: 'Sales', measure: 'Sales' } }], filters: [inF('Product', 'Category', ["'none'"])] })
    expect(r.rows).toEqual([[null]])
  })
  it('per-cell errors become null + warning, not a failed query', () => {
    const r = engine.summarize({
      groupBy: [],
      values: [
        { id: 'ok', expr: { kind: 'measure', table: 'Sales', measure: 'Sales' } },
        { id: 'bad', expr: { kind: 'measure', table: 'Sales', measure: 'Broken' } }
      ]
    })
    expect(r.rows).toEqual([[173, null]])
    expect(r.warnings?.[0]).toMatch(/multiple values/)
    const g = engine.summarize({ groupBy: [{ table: 'Product', column: 'Category' }], values: [{ id: 'bad', expr: { kind: 'measure', table: 'Sales', measure: 'Broken' } }] })
    expect(g.rows.length).toBe(0) // every cell errors (text divisor) -> all-blank rows are removed
    expect(g.warnings?.[0]).toMatch(/Broken|bad/)
  })
  it('dynamic format strings per row', () => {
    const r = engine.summarize({ groupBy: [{ table: 'Product', column: 'Category' }], values: [{ id: 'v', expr: { kind: 'measure', table: 'Sales', measure: 'Sales Dynamic' } }] })
    expect(r.rows.map((x) => x[0])).toEqual(['Accessories', 'Bikes', 'Clothing'])
    expect(r.formats).toEqual([['0.00'], ['#,0'], ['0.00']])
  })
  it('highlights compute values under extra filters', () => {
    const r = engine.summarize({
      groupBy: [{ table: 'Product', column: 'Category' }],
      values: [{ id: 'v', expr: { kind: 'measure', table: 'Sales', measure: 'Sales' } }],
      highlightFilters: [inF('Customer', 'Country', ["'DE'"])]
    })
    expect(r.highlights).toEqual([[null], [10], [20]])
  })
  it('hierarchy levels resolve to their columns', () => {
    const lvl = { HierarchyLevel: { Expression: { Hierarchy: { Expression: { SourceRef: { Entity: 'Date' } }, Hierarchy: 'Calendar' } }, Level: 'Year' } }
    const r = engine.summarize({ groupBy: [{ kind: 'sq', expr: lvl }], values: [{ id: 'v', expr: { kind: 'sq', expr: msr('Sales', 'Sales') } }] })
    expect(r.rows).toEqual([
      [2024, 80],
      [2025, 93]
    ])
  })
  it('auto date/time variation falls back to derived Year/Quarter/Month when no LocalDateTable exists', () => {
    const lvl = (level: string) => ({
      HierarchyLevel: { Expression: { Hierarchy: { Expression: { PropertyVariationSource: { Expression: { SourceRef: { Entity: 'Sales' } }, Name: 'Variation', Property: 'OrderDate' } }, Hierarchy: 'Date Hierarchy' } }, Level: level }
    })
    const r = engine.summarize({ groupBy: [{ kind: 'sq', expr: lvl('Year') }, { kind: 'sq', expr: lvl('Month') }], values: [{ id: 'v', expr: { kind: 'sq', expr: msr('Sales', 'Sales') } }] })
    expect(r.rows).toEqual([
      [2024, 'January', 20],
      [2024, 'February', 50],
      [2024, 'June', 10],
      [2025, 'January', 60],
      [2025, 'February', 25],
      [2025, 'March', 8]
    ])
    expect(r.columns[1].name).toBe('Month')
  })
})

describe('distinct values, describeField, validate, format', () => {
  it('slicer values cross-filter through facts and keep sort order', () => {
    expect(engine.distinctValues({ column: { table: 'Date', column: 'Month' }, filters: [inF('Date', 'Year', ['2024L'])], limit: 3 }).values).toEqual(['Jan', 'Feb', 'Mar'])
    expect(engine.distinctValues({ column: { table: 'Product', column: 'Category' } }).values).toEqual(['Accessories', 'Bikes', 'Clothing'])
    expect(engine.distinctValues({ column: { table: 'Product', column: 'Category' }, filters: [inF('Customer', 'Country', ["'DE'"])] }).values).toEqual(['Bikes', 'Clothing'])
    const w = engine.distinctValues({ column: { table: 'Product', column: 'Category' }, search: 'cl', withMeasure: { kind: 'measure', table: 'Sales', measure: 'Sales' } })
    expect(w).toEqual({ values: ['Clothing'], measures: [28], dataType: 'string' })
  })
  it('describes fields', () => {
    expect(engine.describeField({ Aggregation: { Expression: col('Sales', 'Amount'), Function: 0 } })).toMatchObject({ kind: 'aggregation', displayName: 'Sum of Amount', dataType: 'double' })
    expect(engine.describeField({ Aggregation: { Expression: col('Sales', 'OrderDate'), Function: 4 } })?.displayName).toBe('Latest OrderDate')
    expect(engine.describeField(msr('Sales', 'Sales'))).toMatchObject({ kind: 'measure', isMeasure: true, formatString: '\\$#,0' })
    expect(engine.describeField(col('Date', 'Month'))).toMatchObject({ sortBy: { table: 'Date', column: 'MonthNo' } })
    expect(engine.describeField(col('Nope', 'x'))).toBeUndefined()
  })
  it('validates expressions with offsets', () => {
    expect(engine.validateExpression('SUM ( Sales[Amount] )', { kind: 'measure' })).toEqual([])
    const bad = engine.validateExpression('SUMM ( Sales[Amout] )', { kind: 'measure' })
    expect(bad.map((x) => [x.start, x.end])).toEqual([
      [0, 4],
      [7, 19]
    ])
    expect(engine.validateExpression('1 +', { kind: 'measure' })[0]).toMatchObject({ severity: 'error' })
    expect(engine.validateExpression('VAR x = 1 RETURN x + [Qty]', { kind: 'measure' })).toEqual([])
  })
  it('formats values', () => {
    expect(engine.format(1234.5, '#,0.00')).toBe('1,234.50')
    expect(engine.format(0.1625, '0.0%')).toBe('16.3%')
    expect(engine.format(d(2025, 3, 5), 'mmm yyyy')).toBe('Mar 2025')
    expect(engine.format(null, '0')).toBe('')
    expect(engine.evaluateScalar('[Sales Dynamic]').formatString).toBe('#,0')
    expect(engine.evaluateScalar('[Sales]').formatString).toBe('\\$#,0')
  })
  it('reports unknown functions by name', () => {
    expect(() => s('FOOBAR ( 1 )')).toThrow(/FOOBAR/)
  })
})

describe('row-level security (View as)', () => {
  it('restricts every query to the role rows, propagating through relationships', () => {
    const { engine: e, model } = engineFor()
    model.roles.push({ name: 'DE only', tablePermissions: [{ table: 'Customer', filterExpression: 'Customer[Country] = "DE"' }] })
    e.setViewAsRoles?.(['DE only'])
    expect(e.evaluateScalar('[Sales]').value).toBe(30)
    expect(e.evaluateScalar('CALCULATE ( [Sales], ALL ( Customer ) )').value).toBe(30)
    e.setViewAsRoles?.(null)
    expect(e.evaluateScalar('[Sales]').value).toBe(173)
  })
})

void lit
