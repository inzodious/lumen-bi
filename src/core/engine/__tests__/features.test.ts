import { describe, expect, it } from 'vitest'
import { col, d, engineFor, inF, lit, msr } from './fixture'
import type { ModelSpec } from '../../dax/tabular/__tests__/build'

function withCalcGroupsAndParams(s: ModelSpec): void {
  s.tables['Time Calc'] = {
    columns: { 'Time Calculation': { type: 'string', sourceColumn: 'Name', sortBy: 'Ordinal' }, Ordinal: { type: 'int64', sourceColumn: 'Ordinal' } },
    calculationGroup: {
      precedence: 10,
      items: [
        { name: 'Current', expression: 'SELECTEDMEASURE ()' },
        { name: 'PY', expression: "CALCULATE ( SELECTEDMEASURE (), SAMEPERIODLASTYEAR ( 'Date'[Date] ) )" },
        {
          name: 'YoY %',
          expression: "VAR c = SELECTEDMEASURE () VAR p = CALCULATE ( SELECTEDMEASURE (), SAMEPERIODLASTYEAR ( 'Date'[Date] ) ) RETURN DIVIDE ( c - p, p )",
          formatStringDefinition: '"0.0%"'
        },
        { name: 'Name', expression: 'SELECTEDMEASURENAME ()' },
        { name: 'Fmt', expression: 'SELECTEDMEASUREFORMATSTRING ()' }
      ]
    }
  }
  s.tables['Scale'] = {
    columns: { Scale: { type: 'string', sourceColumn: 'Name' }, Ordinal: { type: 'int64', sourceColumn: 'Ordinal' } },
    calculationGroup: { precedence: 20, items: [{ name: 'x10', expression: 'SELECTEDMEASURE () * 10' }] }
  }
  s.tables['Param'] = {
    expression: "{ ( \"Category\", NAMEOF ( 'Product'[Category] ), 0 ), ( \"Country\", NAMEOF ( 'Customer'[Country] ), 1 ), ( \"Sales\", NAMEOF ( 'Sales'[Sales] ), 2 ) }",
    columns: {
      Param: { type: 'string', sourceColumn: '[Value1]', sortBy: 'Param Order' },
      'Param Fields': { type: 'string', sourceColumn: '[Value2]', sortBy: 'Param Order', extendedProperties: { ParameterMetadata: { version: 3, kind: 2 } } },
      'Param Order': { type: 'int64', sourceColumn: '[Value3]' }
    }
  }
}

const { engine } = engineFor(withCalcGroupsAndParams)
const s = (expr: string, filters?: any[]) => engine.evaluateScalar(expr, filters).value
const q = (query: string) => engine.runDaxQuery(query).tables[0].rows
const salesV = [{ id: 'v', expr: { kind: 'measure' as const, table: 'Sales', measure: 'Sales' } }]

describe('calculation groups', () => {
  it('applies items to measures, sorted by ordinal, with item format strings', () => {
    const r = engine.summarize({
      groupBy: [{ table: 'Date', column: 'Year' }, { table: 'Time Calc', column: 'Time Calculation' }],
      values: salesV,
      filters: [inF('Time Calc', 'Time Calculation', ["'Current'", "'PY'", "'YoY %'"])]
    })
    expect(r.rows).toEqual([
      [2024, 'Current', 80],
      [2025, 'Current', 93],
      [2025, 'PY', 80],
      [2025, 'YoY %', 0.1625]
    ])
    expect(r.formats).toEqual([[undefined], [undefined], [undefined], ['0.0%']])
  })
  it('applies an item once per evaluation (measures referencing measures are not shifted twice)', () => {
    expect(s('[Sales Plus Qty]', [inF('Date', 'Year', ['2025L']), inF('Time Calc', 'Time Calculation', ["'PY'"])])).toBe(89)
  })
  it('stacks groups by precedence and exposes the selected measure', () => {
    const f = [inF('Date', 'Year', ['2025L']), inF('Time Calc', 'Time Calculation', ["'PY'"]), inF('Scale', 'Scale', ["'x10'"])]
    expect(s('[Sales]', f)).toBe(800)
    expect(s('[Qty]', [inF('Time Calc', 'Time Calculation', ["'Name'"])])).toBe('Qty')
    expect(s('[Sales]', [inF('Time Calc', 'Time Calculation', ["'Fmt'"])])).toBe('\\$#,0')
    expect(s('CALCULATE ( [Sales], \'Time Calc\'[Time Calculation] = "PY", \'Date\'[Year] = 2025 )')).toBe(80)
  })
})

describe('field parameters', () => {
  const p = col('Param', 'Param')
  it('lists every field in parameter order when nothing is selected', () => {
    expect(engine.resolveFieldParameter(p)?.map((x) => x.displayName)).toEqual(['Category', 'Country', 'Sales'])
    expect(engine.resolveFieldParameter(col('Product', 'Category'))).toBeNull()
    expect(engine.describeField(p)?.isFieldParameter).toBe(true)
  })
  it('follows slicer selections on the label or the order column', () => {
    expect(engine.resolveFieldParameter(p, [inF('Param', 'Param', ["'Country'"])])).toEqual([{ expr: col('Customer', 'Country'), displayName: 'Country' }])
    expect(engine.resolveFieldParameter(p, [inF('Param', 'Param Order', ['2L', '0L'])])).toEqual([
      { expr: col('Product', 'Category'), displayName: 'Category' },
      { expr: msr('Sales', 'Sales'), displayName: 'Sales' }
    ])
  })
})

describe('SQ filter translation', () => {
  const sales = (filters: any[]) => s('[Sales]', filters)
  const where = (cond: any, from: Array<[string, string]> = []) => ({ Version: 2, From: from.map(([Name, Entity]) => ({ Name, Entity, Type: 0 })), Where: [{ Condition: cond }] })
  const C = (src: string, prop: string) => ({ Column: { Expression: { SourceRef: { Source: src } }, Property: prop } })
  it('In (incl. tuples), Not, And/Or across tables', () => {
    expect(sales([inF('Product', 'Category', ["'Bikes'", "'Clothing'"])])).toBe(158)
    expect(sales([inF('Product', 'Category', ["'Bikes'"], true)])).toBe(43)
    const tuple = where({ In: { Expressions: [C('p', 'Category'), C('c', 'Country')], Values: [[lit("'Bikes'"), lit("'US'")], [lit("'Clothing'"), lit("'DE'")]] } }, [['p', 'Product'], ['c', 'Customer']])
    expect(sales([tuple])).toBe(140)
    const or = where({ Or: { Left: { Comparison: { ComparisonKind: 0, Left: C('p', 'Category'), Right: lit("'Accessories'") } }, Right: { Comparison: { ComparisonKind: 0, Left: C('c', 'Country'), Right: lit("'DE'") } } } }, [['p', 'Product'], ['c', 'Customer']])
    expect(sales([or])).toBe(45)
    const and = where({ And: { Left: { Comparison: { ComparisonKind: 0, Left: C('p', 'Category'), Right: lit("'Bikes'") } }, Right: { Comparison: { ComparisonKind: 0, Left: C('c', 'Country'), Right: lit("'US'") } } } }, [['p', 'Product'], ['c', 'Customer']])
    expect(sales([and])).toBe(120)
  })
  it('comparisons, between, text predicates and blanks', () => {
    const cmp = (k: number, v: string) => where({ Comparison: { ComparisonKind: k, Left: C('s', 'Qty'), Right: lit(v) } }, [['s', 'Sales']])
    expect(sales([cmp(1, '2L')])).toBe(35)
    expect(sales([cmp(4, '1L')])).toBe(50)
    expect(sales([cmp(2, '5L')])).toBe(20)
    expect(sales([cmp(3, '2L')])).toBe(50)
    expect(sales([where({ Between: { Expression: C('s', 'Amount'), LowerBound: lit('10D'), UpperBound: lit('20D') } }, [['s', 'Sales']])])).toBe(75)
    const txt = (k: string, v: string, not = false) => where(not ? { Not: { Expression: { [k]: { Left: C('p', 'Category'), Right: lit(v) } } } } : { [k]: { Left: C('p', 'Category'), Right: lit(v) } }, [['p', 'Product']])
    expect(sales([txt('Contains', "'cloth'")])).toBe(28)
    expect(sales([txt('StartsWith', "'Acc'")])).toBe(15)
    expect(sales([txt('EndsWith', "'kes'")])).toBe(130)
    expect(sales([txt('Contains', "'bike'", true)])).toBe(43)
    expect(sales([where({ Not: { Expression: { Comparison: { ComparisonKind: 0, Left: C('p', 'Color'), Right: lit('null') } } } }, [['p', 'Product']])])).toBe(173)
    expect(sales([where({ In: { Expressions: [C('p', 'Color')], Values: [[lit('null')]] } }, [['p', 'Product']])])).toBe(null)
  })
  it('relative dates (Now = 2025-03-10 14:30)', () => {
    const lastTwoMonths = where(
      {
        Between: {
          Expression: C('d', 'Date'),
          LowerBound: { DateSpan: { Expression: { DateAdd: { Expression: { DateAdd: { Expression: { Now: {} }, Amount: 1, TimeUnit: 0 } }, Amount: -2, TimeUnit: 2 } }, TimeUnit: 0 } },
          UpperBound: { DateSpan: { Expression: { Now: {} }, TimeUnit: 0 } }
        }
      },
      [['d', 'Date']]
    )
    expect(sales([lastTwoMonths])).toBe(33)
    expect(sales([where({ Comparison: { ComparisonKind: 0, Left: C('d', 'Date'), Right: { DateSpan: { Expression: { Now: {} }, TimeUnit: 3 } } } }, [['d', 'Date']])])).toBe(93)
    const onOrAfter = where({ Comparison: { ComparisonKind: 2, Left: C('s', 'OrderDate'), Right: { DateSpan: { Expression: lit("datetime'2025-02-28T00:00:00'"), TimeUnit: 5 } } } }, [['s', 'Sales']])
    expect(sales([onOrAfter])).toBe(18)
    const prevCalendarMonth = where(
      {
        Between: {
          Expression: C('d', 'Date'),
          LowerBound: { DateSpan: { Expression: { DateAdd: { Expression: { Now: {} }, Amount: -1, TimeUnit: 2 } }, TimeUnit: 2 } },
          UpperBound: { DateSpan: { Expression: { DateAdd: { Expression: { Now: {} }, Amount: -1, TimeUnit: 2 } }, TimeUnit: 2 } }
        }
      },
      [['d', 'Date']]
    )
    expect(sales([prevCalendarMonth])).toBe(25)
  })
  it('TopN subqueries are evaluated under the other filters', () => {
    const topN = (n: number) => ({
      Version: 2,
      From: [
        {
          Name: 'sub',
          Expression: {
            Subquery: {
              Query: {
                Version: 2,
                From: [
                  { Name: 'p', Entity: 'Product', Type: 0 },
                  { Name: 's', Entity: 'Sales', Type: 0 }
                ],
                Select: [{ ...C('p', 'Category'), Name: 'field' }],
                OrderBy: [{ Direction: 2, Expression: { Measure: { Expression: { SourceRef: { Source: 's' } }, Property: 'Sales' } } }],
                Top: n
              }
            }
          },
          Type: 2
        },
        { Name: 'p', Entity: 'Product', Type: 0 }
      ],
      Where: [{ Condition: { In: { Expressions: [C('p', 'Category')], Table: { SourceRef: { Source: 'sub' } } } } }]
    })
    expect(sales([topN(1)])).toBe(130)
    expect(sales([topN(2)])).toBe(158)
    expect(sales([inF('Customer', 'Country', ["'DE'"]), topN(1)])).toBe(20)
  })
  it('measure conditions filter visual rows', () => {
    const r = engine.summarize({
      groupBy: [{ table: 'Product', column: 'Category' }],
      values: salesV,
      filters: [where({ Comparison: { ComparisonKind: 1, Left: { Measure: { Expression: { SourceRef: { Source: 's' } }, Property: 'Sales' } }, Right: lit('20L') } }, [['s', 'Sales']])]
    })
    expect(r.rows).toEqual([
      ['Bikes', 130],
      ['Clothing', 28]
    ])
  })
  it('ignores unresolvable filters with a warning', () => {
    const r = engine.summarize({ groupBy: [], values: salesV, filters: [inF('Nope', 'x', ["'a'"])] })
    expect(r.rows).toEqual([[173]])
    expect(r.warnings?.length).toBe(1)
  })
})

describe('window functions and ranking', () => {
  const cat = (c: string) => [inF('Product', 'Category', [`'${c}'`])]
  it('OFFSET / WINDOW over years', () => {
    const r = engine.summarize({
      groupBy: [{ table: 'Date', column: 'Year' }],
      values: [
        { id: 'prev', expr: { kind: 'dax', expression: "CALCULATE ( [Sales], OFFSET ( -1, ALLSELECTED ( 'Date'[Year] ), ORDERBY ( 'Date'[Year] ) ) )" } },
        { id: 'run', expr: { kind: 'dax', expression: "CALCULATE ( [Sales], WINDOW ( 1, ABS, 0, REL, ALLSELECTED ( 'Date'[Year] ), ORDERBY ( 'Date'[Year] ) ) )" } }
      ]
    })
    expect(r.rows).toEqual([
      [2024, null, 80],
      [2025, 80, 173]
    ])
  })
  it('INDEX / RANK / ROWNUMBER / RANKX', () => {
    expect(s('SELECTCOLUMNS ( INDEX ( 1, ALL ( Product[Category] ), ORDERBY ( [Sales], DESC ) ), "c", Product[Category] )')).toBe('Bikes')
    expect(s('SELECTCOLUMNS ( INDEX ( -1, ALL ( Product[Category] ), ORDERBY ( [Sales], DESC ) ), "c", Product[Category] )')).toBe('Accessories')
    expect(s('RANK ( DENSE, ALL ( Product[Category] ), ORDERBY ( [Sales], DESC ) )', cat('Clothing'))).toBe(2)
    expect(s('ROWNUMBER ( ALL ( Product[Category] ), ORDERBY ( Product[Category] ) )', cat('Clothing'))).toBe(3)
    expect(s('RANKX ( ALL ( Product[Category] ), [Sales] )', cat('Clothing'))).toBe(2)
    expect(s('RANKX ( ALL ( Product[Category] ), [Sales], , ASC )', cat('Clothing'))).toBe(2)
    expect(s('RANKX ( ALL ( Product[Category] ), [Sales], 1000 )')).toBe(1)
    expect(s('RANK.EQ ( 20, Sales[Amount] )')).toBe(3)
  })
})

describe('DAX queries', () => {
  it('DEFINE MEASURE / VAR / TABLE / COLUMN', () => {
    expect(
      q(`DEFINE
           MEASURE Sales[x] = [Sales] * 2
           VAR v = 10
           TABLE t = { 1, 2, 3 }
           COLUMN Product[Twice] = Product[ProductKey] * 2
         EVALUATE ROW ( "a", [x], "b", v, "c", COUNTROWS ( t ), "d", SUMX ( Product, Product[Twice] ) ) -- comment`)
    ).toEqual([[346, 10, 3, 20]])
    expect(engine.runDaxQuery('EVALUATE { 1 }').tables[0].rows).toEqual([[1]])
    expect(() => s("SUMX ( Product, Product[Twice] )")).toThrow(/cannot be found/)
  })
  it('ORDER BY / START AT / several EVALUATEs', () => {
    expect(q('EVALUATE VALUES ( Product[Category] ) ORDER BY Product[Category] DESC START AT "Bikes"')).toEqual([['Bikes'], ['Accessories']])
    expect(engine.runDaxQuery('EVALUATE { 1 } EVALUATE { 2, 3 }').tables.map((t) => t.rows.length)).toEqual([1, 2])
  })
  it('result columns carry names, types and format strings', () => {
    const t = engine.runDaxQuery('EVALUATE SUMMARIZECOLUMNS ( Product[Category], "Sales", [Sales], "Avg", AVERAGE ( Sales[Amount] ) ) ORDER BY Product[Category]').tables[0]
    expect(t.columns).toEqual([
      { name: 'Product[Category]', dataType: 'string', formatString: undefined },
      { name: '[Sales]', dataType: 'double', formatString: '\\$#,0' },
      { name: '[Avg]', dataType: 'double', formatString: undefined }
    ])
    expect(t.rows[1]).toEqual(['Bikes', 130, 26])
    expect(q('EVALUATE { SUMX ( { 0.1, 0.2 }, [Value] ) }')).toEqual([[0.3]])
  })
  it('table functions', () => {
    expect(q('EVALUATE GROUPBY ( Sales, Customer[Country], "n", SUMX ( CURRENTGROUP (), Sales[Qty] ) ) ORDER BY Customer[Country]')).toEqual([
      ['DE', 6],
      ['US', 11]
    ])
    expect(q('EVALUATE SUMMARIZE ( Sales, Product[Category], "s", [Sales] ) ORDER BY [s] DESC')).toEqual([
      ['Bikes', 130],
      ['Clothing', 28],
      ['Accessories', 15]
    ])
    expect(q('EVALUATE NATURALLEFTOUTERJOIN ( DATATABLE ( "Category", STRING, { { "Bikes" }, { "Toys" } } ), DATATABLE ( "Category", STRING, "Weight", INTEGER, { { "Bikes", 3 } } ) )')).toEqual([
      ['Bikes', 3],
      ['Toys', null]
    ])
    expect(q('EVALUATE GENERATESERIES ( 1, 2, 0.5 )')).toEqual([[1], [1.5], [2]])
    expect(q('EVALUATE CALENDAR ( DATE ( 2024, 2, 28 ), DATE ( 2024, 3, 1 ) )')).toEqual([[d(2024, 2, 28)], [d(2024, 2, 29)], [d(2024, 3, 1)]])
    expect(q('EVALUATE TOPN ( 1, { 1, 2, 2 }, [Value] )')).toEqual([[2], [2]])
    expect(q('EVALUATE EXCEPT ( { 1, 2, 3 }, { 2 } )')).toEqual([[1], [3]])
    expect(q('EVALUATE INTERSECT ( { 1, 2, 3 }, { 3, 4 } )')).toEqual([[3]])
    expect(q('EVALUATE UNION ( { 1 }, { 1 } )')).toEqual([[1], [1]])
    expect(q('EVALUATE CROSSJOIN ( SELECTCOLUMNS ( { "a" }, "x", [Value] ), { 1, 2 } )')).toEqual([
      ['a', 1],
      ['a', 2]
    ])
    expect(q('EVALUATE SUMMARIZECOLUMNS ( ROLLUPADDISSUBTOTAL ( Customer[Country], "IsTotal" ), "s", [Sales] )')).toEqual([
      [null, true, 173],
      ['DE', false, 30],
      ['US', false, 143]
    ])
    expect(q('EVALUATE FILTER ( ADDCOLUMNS ( VALUES ( Customer[Country] ), "s", [Sales] ), [s] > 100 )')).toEqual([['US', 143]])
    expect(q('EVALUATE ROW ( "n", COUNTROWS ( SUMMARIZECOLUMNS ( Product[Color], Customer[Country], "s", [Sales] ) ) )')).toEqual([[4]])
    expect(q('EVALUATE ADDMISSINGITEMS ( Customer[Country], SUMMARIZECOLUMNS ( Customer[Country], TREATAS ( { "DE" }, Customer[Country] ), "s", [Sales] ), Customer[Country] )').length).toBe(2)
  })
})

describe('scalar functions', () => {
  const cases: Array<[string, unknown]> = [
    ['LEFT ( "abc", 2 )', 'ab'],
    ['MID ( "abcdef", 2, 3 )', 'bcd'],
    ['SUBSTITUTE ( "a-b-c", "-", "+", 2 )', 'a-b+c'],
    ['REPLACE ( "abcdef", 2, 3, "X" )', 'aXef'],
    ['SEARCH ( "C", "abc" )', 3],
    ['SEARCH ( "z", "abc", 1, -1 )', -1],
    ['FIND ( "C", "abc", 1, 0 )', 0],
    ['CONTAINSSTRING ( "Hello", "h*o" )', true],
    ['REPT ( "ab", 3 )', 'ababab'],
    ['TRIM ( "  a   b " )', 'a b'],
    ['LEN ( "héllo" )', 5],
    ['EXACT ( "a", "A" )', false],
    ['UNICHAR ( 9650 )', '▲'],
    ['UNICODE ( "A" )', 65],
    ['COMBINEVALUES ( "|", "a", 1 )', 'a|1'],
    ['VALUE ( "1,234.5" )', 1234.5],
    ['FIXED ( 1234.567, 1 )', '1,234.6'],
    ['FORMAT ( 1234.5, "#,##0.00" )', '1,234.50'],
    ['FORMAT ( DATE ( 2024, 1, 5 ), "dddd" )', 'Friday'],
    ['FORMAT ( DATE ( 2024, 1, 5 ) + TIME ( 15, 4, 0 ), "hh:mm AM/PM" )', '03:04 PM'],
    ['FORMAT ( 1234567890, "#,##0,,.0M" )', '1,234.6M'],
    ['FORMAT ( -0.25, "0.0%;(0.0%)" )', '(25.0%)'],
    ['CONCATENATEX ( { "b", "a" }, [Value], ", ", [Value], ASC )', 'a, b'],
    ['PATHITEM ( "1|2|3", 2, 1 )', 2],
    ['PATHLENGTH ( "1|2|3" )', 3],
    ['ROUND ( 2.675, 2 )', 2.68],
    ['ROUND ( -1.5, 0 )', -2],
    ['ROUND ( 1234, -2 )', 1200],
    ['ROUNDUP ( 1.21, 1 )', 1.3],
    ['ROUNDDOWN ( -1.29, 1 )', -1.2],
    ['MROUND ( 10, 3 )', 9],
    ['TRUNC ( -8.9 )', -8],
    ['INT ( -8.9 )', -9],
    ['CEILING ( 4.2, 2 )', 6],
    ['FLOOR ( 4.7, 2 )', 4],
    ['MOD ( -3, 2 )', 1],
    ['QUOTIENT ( 7, 2 )', 3],
    ['POWER ( 2, 10 )', 1024],
    ['LOG ( 100 )', 2],
    ['SIGN ( -3 )', -1],
    ['GCD ( 12, 18 )', 6],
    ['LCM ( 4, 6 )', 12],
    ['EVEN ( 3 )', 4],
    ['ODD ( 2 )', 3],
    ['DIVIDE ( 1, 0 )', null],
    ['DIVIDE ( 1, 0, -1 )', -1],
    ['1 / 0', Infinity],
    ['ISERROR ( 1 / 0 )', false],
    ['IFERROR ( 1 / "a", -1 )', -1],
    ['SWITCH ( TRUE (), 1 > 2, "a", 2 > 1, "b", "c" )', 'b'],
    ['IF ( BLANK (), 1, 2 )', 2],
    ['COALESCE ( BLANK (), BLANK (), 3 )', 3],
    ['BLANK () = 0', true],
    ['BLANK () == 0', false],
    ['"a" = "A"', true],
    ['"5" + 1', 6],
    ['TRUE () + 1', 2],
    ['-2 ^ 2', -4],
    ['"a" & 1', 'a1'],
    ['3 IN { 1, 2, 3 }', true],
    ['( 1, "a" ) IN { ( 1, "A" ) }', true],
    ['ISNUMBER ( 1 ) && ISTEXT ( "a" ) && ISLOGICAL ( TRUE () ) && ISBLANK ( BLANK () )', true],
    ['XOR ( TRUE (), FALSE () )', true],
    ['CONVERT ( "12", INTEGER )', 12],
    ['DATE ( 2024, 14, 1 )', d(2025, 2, 1)],
    ['DATE ( 2024, 3, 0 )', d(2024, 2, 29)],
    ['EOMONTH ( DATE ( 2024, 1, 31 ), 1 )', d(2024, 2, 29)],
    ['EDATE ( DATE ( 2024, 1, 31 ), 1 )', d(2024, 2, 29)],
    ['DATEDIFF ( DATE ( 2024, 1, 1 ), DATE ( 2025, 3, 1 ), MONTH )', 14],
    ['DATEDIFF ( DATE ( 2024, 12, 31 ), DATE ( 2025, 1, 1 ), YEAR )', 1],
    ['DATEDIFF ( DATE ( 2024, 1, 6 ), DATE ( 2024, 1, 7 ), WEEK )', 1],
    ['DATEDIFF ( DATE ( 2024, 1, 1 ) + TIME ( 23, 0, 0 ), DATE ( 2024, 1, 2 ) + TIME ( 1, 0, 0 ), HOUR )', 2],
    ['WEEKDAY ( DATE ( 2024, 1, 1 ) )', 2],
    ['WEEKDAY ( DATE ( 2024, 1, 1 ), 2 )', 1],
    ['WEEKNUM ( DATE ( 2024, 1, 7 ) )', 2],
    ['WEEKNUM ( DATE ( 2024, 1, 7 ), 2 )', 1],
    ['WEEKNUM ( DATE ( 2024, 12, 30 ), 21 )', 1],
    ['ROUND ( YEARFRAC ( DATE ( 2012, 1, 1 ), DATE ( 2012, 7, 30 ) ), 8 )', 0.58055556],
    ['ROUND ( YEARFRAC ( DATE ( 2012, 1, 1 ), DATE ( 2012, 7, 30 ), 1 ), 8 )', 0.57650273],
    ['NETWORKDAYS ( DATE ( 2024, 1, 1 ), DATE ( 2024, 1, 31 ) )', 23],
    ['QUARTER ( DATE ( 2024, 8, 1 ) )', 3],
    ['HOUR ( TIME ( 13, 45, 10 ) ) * 10000 + MINUTE ( TIME ( 13, 45, 10 ) ) * 100 + SECOND ( TIME ( 13, 45, 10 ) )', 134510],
    ['HOUR ( TIME ( 25, 0, 0 ) )', 1],
    ['HOUR ( NOW () )', 14],
    ['TODAY ()', d(2025, 3, 10)],
    ['DATEVALUE ( "2024-02-29" )', d(2024, 2, 29)],
    ['HOUR ( TIMEVALUE ( "6:30 PM" ) )', 18],
    ['DATE ( 2024, 1, 1 ) + TIME ( 6, 0, 0 )', d(2024, 1, 1, 6)],
    ['INT ( DATE ( 2024, 1, 2 ) - DATE ( 2024, 1, 1 ) )', 1],
    ['INT ( DATE ( 2024, 1, 1 ) )', 45292],
    ['YEAR ( "2024-05-06" )', 2024]
  ]
  for (const [expr, want] of cases) {
    it(expr, () => {
      expect(s(expr)).toEqual(want)
    })
  }
  it('USERPRINCIPALNAME is configurable', () => {
    const { engine: e } = engineFor(undefined, { userPrincipalName: 'someone@example.com' })
    expect(e.evaluateScalar('USERPRINCIPALNAME ()').value).toBe('someone@example.com')
  })
})
