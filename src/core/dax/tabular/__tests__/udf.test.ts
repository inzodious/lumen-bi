/** DAX user-defined functions: DEFINE FUNCTION in queries and model functions (functions.tmdl). */
import { describe, expect, it } from 'vitest'
import { buildModel, processCalculated, runQuery } from '../index.ts'
import { readTmdlFiles } from '../../../tmdl'
import { build } from './build.ts'

function model(functions: Array<{ name: string; expression: string }> = []) {
  const { model: sm, data } = build({
    tables: {
      Date: { columns: { Year: 'int64' }, rows: [[2020], [2021]] },
      Sales: { columns: { Year: 'int64', Amount: 'double' }, rows: [[2020, 10], [2020, 20], [2021, 70]], measures: { Total: 'SUM ( Sales[Amount] )' } }
    },
    relationships: [{ from: 'Sales.Year', to: 'Date.Year' }]
  })
  sm.functions = functions
  const m = buildModel(sm, data)
  processCalculated(m)
  return m
}
const q = (m: ReturnType<typeof model>, text: string) => runQuery(m, text)[0].rows

describe('user-defined functions', () => {
  it('scalar parameters with defaults and nesting', () => {
    const m = model()
    expect(
      q(
        m,
        `DEFINE
          FUNCTION AddTax = ( amount : NUMERIC, taxRate : NUMERIC = 0.1 ) => amount * ( 1 + taxRate )
          FUNCTION AddTaxAndDiscount = ( amount : NUMERIC, discount : NUMERIC ) => AddTax ( amount - discount )
          FUNCTION My.Ns.Twice = ( x ) => x * 2
        EVALUATE { ( AddTax ( 10 ), AddTax ( 10, 0.5 ), AddTaxAndDiscount ( 10, 2 ), My.Ns.Twice ( 4 ) ) }`
      ).map((r) => r.map((v) => Math.round((v as number) * 1e9) / 1e9))
    ).toEqual([[11, 15, 8.8, 8]])
  })
  it('type hints cast val arguments (INT64 rounds half away from zero, text to number)', () => {
    const m = model()
    expect(q(m, `DEFINE FUNCTION CastToInt = ( x : SCALAR INT64 VAL ) => x EVALUATE { ( CastToInt ( 3.4 ), CastToInt ( 3.5 ), CastToInt ( "5" ), CastToInt ( -2.5 ) ) }`)).toEqual([[3, 4, 5, -3]])
    expect(q(m, `DEFINE FUNCTION S = ( x : STRING ) => x & "!" EVALUATE { S ( 12 ) }`)).toEqual([['12!']])
  })
  it('table val vs table expr (Microsoft example semantics)', () => {
    const m = model()
    const rows = q(
      m,
      `DEFINE
        FUNCTION CountRowsNow = ( t : TABLE VAL ) => COUNTROWS ( CALCULATETABLE ( t, ALL ( 'Date' ) ) )
        FUNCTION CountRowsLater = ( t : TABLE EXPR ) => COUNTROWS ( CALCULATETABLE ( t, ALL ( 'Date' ) ) )
      EVALUATE { ( CALCULATE ( CountRowsNow ( Sales ), 'Date'[Year] = 2020 ), CALCULATE ( CountRowsLater ( Sales ), 'Date'[Year] = 2020 ) ) }`
    )
    expect(rows).toEqual([[2, 3]])
  })
  it('expr parameters: measure and column references evaluated in the body context', () => {
    const m = model()
    expect(q(m, `DEFINE FUNCTION AllYears = ( m : MEASUREREF ) => CALCULATE ( m, REMOVEFILTERS ( 'Date' ) ) EVALUATE { CALCULATE ( AllYears ( [Total] ), 'Date'[Year] = 2021 ) }`)).toEqual([[100]])
    expect(q(m, `DEFINE FUNCTION SumOf = ( c : COLUMNREF ) => SUM ( c ) EVALUATE { SumOf ( Sales[Amount] ) }`)).toEqual([[100]])
    expect(q(m, `DEFINE FUNCTION PerYear = ( e : SCALAR EXPR ) => SUMX ( VALUES ( 'Date'[Year] ), e ) EVALUATE { PerYear ( [Total] * 2 ) }`)).toEqual([[200]])
    // val: evaluated once in the caller's context
    expect(q(m, `DEFINE FUNCTION PerYearVal = ( e : SCALAR VAL ) => SUMX ( VALUES ( 'Date'[Year] ), e ) EVALUATE { PerYearVal ( [Total] * 2 ) }`)).toEqual([[400]])
  })
  it('val arguments see the caller row context (calculated column)', () => {
    const m = model()
    expect(q(m, `DEFINE FUNCTION Half = ( x ) => x / 2 COLUMN Sales[H] = Half ( Sales[Amount] ) EVALUATE SELECTCOLUMNS ( Sales, "h", Sales[H] )`)).toEqual([[5], [10], [35]])
  })
  it('recursion and wrong arity are errors', () => {
    const m = model()
    expect(() => q(m, `DEFINE FUNCTION F = ( n ) => IF ( n <= 0, 0, F ( n - 1 ) ) EVALUATE { F ( 3 ) }`)).toThrow(/Recursion/)
    expect(() => q(m, `DEFINE FUNCTION G = ( a, b ) => a + b EVALUATE { G ( 1 ) }`)).toThrow(/argument/)
    expect(() => q(m, `DEFINE FUNCTION G = ( a : COLUMNREF VAL ) => a EVALUATE { 1 }`)).toThrow(/EXPR/)
  })
  it('model functions (TMDL functions.tmdl) are callable from measures', () => {
    const tmdl = readTmdlFiles({
      'definition/model.tmdl': 'model Model\n\tculture: en-US\n',
      'definition/functions.tmdl': '/// adds tax\nfunction AddTax =\n\t\t(amount : NUMERIC) =>\n\t\t\tamount * 1.1\n\nfunction Double = ( x ) => x * 2\n'
    })
    expect(tmdl.model.functions?.map((f) => f.name)).toEqual(['AddTax', 'Double'])
    const m = model(tmdl.model.functions)
    expect(q(m, `EVALUATE { AddTax ( Double ( 10 ) ) }`).map((r) => Math.round((r[0] as number) * 1e9) / 1e9)).toEqual([22])
    expect(q(m, `DEFINE MEASURE Sales[Taxed] = AddTax ( [Total] ) EVALUATE SUMMARIZECOLUMNS ( 'Date'[Year], "t", [Taxed] ) ORDER BY 'Date'[Year]`).map((r) => [r[0], Math.round((r[1] as number) * 1e9) / 1e9])).toEqual([[2020, 33], [2021, 77]])
  })
})

describe('user-defined functions: lexical scoping', () => {
  it("the body does not see the caller's variables", () => {
    const m = model()
    expect(() => q(m, `DEFINE FUNCTION F = ( ) => x + 1 EVALUATE VAR x = 5 RETURN { F ( ) }`)).toThrow(/x/)
    // a val parameter is evaluated in the caller's scope, then bound to the parameter name
    expect(q(m, `DEFINE FUNCTION F = ( a ) => a + 1 EVALUATE VAR x = 5 RETURN { F ( x ) }`)).toEqual([[6]])
  })
  it("expr arguments keep the caller's variables and are not captured by the body's variables", () => {
    const m = model()
    expect(q(m, `DEFINE FUNCTION G = ( e : SCALAR EXPR ) => VAR x = 1 RETURN e + x EVALUATE VAR x = 100 RETURN { G ( x * 2 ) }`)).toEqual([[201]])
    // a table variable passed as a TABLE EXPR argument, the body declaring a variable of the same name
    expect(q(m, `DEFINE FUNCTION Cnt = ( t : TABLE EXPR ) => VAR s = 0 RETURN COUNTROWS ( t ) + s EVALUATE VAR s = FILTER ( Sales, Sales[Amount] > 15 ) RETURN { Cnt ( s ) }`)).toEqual([[2]])
    // nested calls: the captured variable travels through an inner function's expr parameter
    expect(
      q(m, `DEFINE FUNCTION Inner = ( e : SCALAR EXPR ) => VAR y = 1000 RETURN e FUNCTION Outer = ( e : SCALAR EXPR ) => VAR y = 10 RETURN Inner ( e + y ) EVALUATE VAR y = 1 RETURN { Outer ( y ) }`)
    ).toEqual([[11]])
  })
  it('query-level DEFINE VARs are visible to query functions', () => {
    const m = model()
    expect(q(m, `DEFINE VAR k = 3 FUNCTION H = ( a ) => a * k EVALUATE { H ( 2 ) }`)).toEqual([[6]])
  })
})

describe('user-defined functions: type hints and type checking', () => {
  it("type checking functions (Microsoft's StringLength / GetCurrencyName patterns)", () => {
    const m = model()
    expect(q(m, `DEFINE FUNCTION StringLength = ( s ) => IF ( ISSTRING ( s ), LEN ( s ), BLANK () ) EVALUATE { ( StringLength ( "hello" ), StringLength ( 123 ) ) }`)).toEqual([[5, null]])
    expect(q(m, `DEFINE FUNCTION Kind = ( v ) => IF ( ISINT64 ( v ), "key", "code" ) EVALUATE { ( Kind ( 36 ), Kind ( "USD" ) ) }`)).toEqual([['key', 'code']])
    // declared subtypes and column / CONVERT types decide the numeric subtype, not the value
    expect(q(m, `DEFINE FUNCTION D = ( x : DOUBLE ) => ISDOUBLE ( x ) & "/" & ISINT64 ( x ) EVALUATE { D ( 3 ) }`)).toEqual([['TRUE/FALSE']])
    expect(q(m, `EVALUATE { ( ISDOUBLE ( MAX ( Sales[Amount] ) ), ISINT64 ( MAX ( Sales[Year] ) ), ISDECIMAL ( CONVERT ( 1, CURRENCY ) ), ISCURRENCY ( 1 ), ISNUMERIC ( 1.5 ), ISBOOLEAN ( TRUE () ), ISINTEGER ( 2 ) ) }`)).toEqual([
      [true, true, true, false, true, true, true]
    ])
  })
  it('SCALAR / TABLE expr parameters are type-checked (and cast) where the body references them', () => {
    const m = model()
    // lazily evaluated per row of the body's iterator, cast to Int64 at each reference: 1.4 -> 1, 2.6 -> 3
    expect(q(m, `DEFINE FUNCTION SumInt = ( e : INT64 EXPR ) => SUMX ( { 1.4, 2.6 }, e ) EVALUATE { SumInt ( [Value] ) }`)).toEqual([[4]])
    expect(() => q(m, `DEFINE FUNCTION C = ( t : TABLE EXPR ) => COUNTROWS ( t ) EVALUATE { C ( 5 ) }`)).toThrow(/table/i)
  })
  it('reference parameters only accept references of their kind', () => {
    const m = model()
    expect(() => q(m, `DEFINE FUNCTION S = ( c : COLUMNREF ) => SUM ( c ) EVALUATE { S ( [Total] ) }`)).toThrow(/parameter c expects a column reference/)
    expect(() => q(m, `DEFINE FUNCTION M = ( x : MEASUREREF ) => x EVALUATE { M ( Sales[Amount] ) }`)).toThrow(/parameter x expects a measure reference/)
    expect(() => q(m, `DEFINE FUNCTION T = ( t : TABLEREF ) => COUNTROWS ( t ) EVALUATE { T ( FILTER ( Sales, TRUE () ) ) }`)).toThrow(/parameter t expects a table reference/)
    expect(q(m, `DEFINE FUNCTION T = ( t : TABLEREF ) => COUNTROWS ( t ) EVALUATE { T ( Sales ) }`)).toEqual([[3]])
  })
  it("TABLEOF and Microsoft's MODEX example", () => {
    const m = model()
    expect(q(m, `DEFINE FUNCTION N = ( x : MEASUREREF ) => COUNTROWS ( TABLEOF ( x ) ) EVALUATE { ( N ( [Total] ), COUNTROWS ( TABLEOF ( 'Date'[Year] ) ) ) }`)).toEqual([[3, 2]])
    const modex = `DEFINE FUNCTION MODEX = ( e : ANYREF ) =>
        VAR newTable = ADDCOLUMNS ( TABLEOF ( e ), "expr", e )
        VAR freqTable = GROUPBY ( newTable, [expr], "count", SUMX ( CURRENTGROUP (), 1 ) )
        VAR maxCount = MAXX ( freqTable, [count] )
        RETURN SELECTCOLUMNS ( FILTER ( freqTable, [count] = maxCount ), "expr", [expr] )
      EVALUATE MODEX ( Sales[Year] )`
    expect(q(m, modex)).toEqual([[2020]])
  })
  it('an expr default resolves in the definition scope, not captured by the body', () => {
    const m = model()
    expect(q(m, `DEFINE VAR k = 2 FUNCTION F = ( e : SCALAR EXPR = k ) => VAR k = 100 RETURN e EVALUATE { ( F ( ), F ( 7 ) ) }`)).toEqual([[2, 7]])
  })
})
