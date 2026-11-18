import { describe, expect, it } from 'vitest'
import { callAt, quoteTable, tokenizeDax, unquoteRef } from './tokenizer'
import { formatDax, formatDaxDefinition, isDaxQueryText, splitDefinition } from './formatter'
import { localDaxDiagnostics } from './diagnostics'
import { paramIndexFor } from './signatureHelp'
import { DAX_FUNCTIONS, findDaxFunction, formatSignature } from './functions'
import type { DaxSchema } from './schema'

const sig = (src: string) => tokenizeDax(src).filter((t) => t.type !== 'ws' && t.type !== 'newline')

describe('tokenizeDax', () => {
  it('classifies functions, keywords, tables, columns, strings, numbers, comments', () => {
    const toks = sig(`VAR x = SUM ( 'Sales Fact'[Amount] ) // c\nRETURN IF ( x > 1.5e2, "a""b", Product[Color] ) /* blk */`)
    expect(toks.map((t) => t.type)).toEqual([
      'keyword', 'ident', 'op', 'function', 'lparen', 'table', 'column', 'rparen', 'comment',
      'keyword', 'function', 'lparen', 'ident', 'op', 'number', 'comma', 'string', 'comma', 'ident', 'column', 'rparen', 'comment'
    ])
    expect(toks[16].text).toBe('"a""b"')
    expect(toks[8].lineComment).toBe(true)
  })
  it('is tolerant of unterminated literals and records offsets', () => {
    const toks = tokenizeDax('"abc')
    expect(toks).toHaveLength(1)
    expect(toks[0]).toMatchObject({ type: 'string', terminated: false, start: 0, end: 4 })
    expect(tokenizeDax("'Tab")[0]).toMatchObject({ type: 'table', terminated: false })
    expect(tokenizeDax('[Col')[0]).toMatchObject({ type: 'column', terminated: false })
    expect(tokenizeDax('/* x')[0]).toMatchObject({ type: 'comment', terminated: false })
  })
  it('handles -- comments, escaped brackets and two-char operators', () => {
    const toks = sig('a <> b && [x]]y] -- tail')
    expect(toks.map((t) => t.text)).toEqual(['a', '<>', 'b', '&&', '[x]]y]', '-- tail'])
    expect(unquoteRef('[x]]y]')).toBe('x]y')
    expect(unquoteRef("'It''s'")).toBe("It's")
  })
  it('quotes table names like Power BI', () => {
    expect(quoteTable('Sales')).toBe('Sales')
    expect(quoteTable('Sales Fact')).toBe("'Sales Fact'")
    expect(quoteTable('Date')).toBe("'Date'") // DATE is a function
    expect(quoteTable("It's")).toBe("'It''s'")
  })
  it('finds the enclosing call and argument index', () => {
    expect(callAt('CALCULATE ( SUM ( T[a] ), ', 25)).toEqual({ name: 'CALCULATE', argIndex: 1, openPos: 10 })
    expect(callAt('CALCULATE ( SUM ( T[a]', 22)).toMatchObject({ name: 'SUM', argIndex: 0 })
    expect(callAt('1 + 2', 5)).toBeNull()
  })
})

describe('function catalog', () => {
  it('has the common functions with PBI-style signatures', () => {
    expect(DAX_FUNCTIONS.length).toBeGreaterThan(300)
    expect(formatSignature(findDaxFunction('calculate')!)).toBe('CALCULATE(<Expression>, [<Filter1>], ...)')
    expect(findDaxFunction('SELECTEDVALUE')).toBeDefined()
  })
  it('maps arguments of repeating groups to parameters', () => {
    const sw = findDaxFunction('SWITCH')!
    const names = [0, 1, 2, 3, 4].map((i) => sw.params[paramIndexFor(sw, i)]?.name)
    expect(names).toEqual(['Expression', 'Value', 'Result', 'Value', 'Result'])
    const calc = findDaxFunction('CALCULATE')!
    expect(paramIndexFor(calc, 5)).toBe(1)
  })
})

describe('formatDax', () => {
  it('formats short expressions on one line with DAX Formatter spacing', () => {
    expect(formatDax('sum(Sales[Amount])')).toBe('SUM ( Sales[Amount] )')
    expect(formatDax('today()')).toBe('TODAY ()')
    expect(formatDax('-1+ 2*[x]')).toBe('-1 + 2 * [x]')
    expect(formatDax("divide([a],[b],0)")).toBe('DIVIDE ( [a], [b], 0 )')
  })
  it('breaks long calls one argument per line with 4-space indent', () => {
    const src = `calculate(sum(Sales[Amount]),filter(all(Product),Product[Color]="Red" && Product[Weight] > 100),Sales[Quantity]>10)`
    expect(formatDax(src)).toBe(
      [
        'CALCULATE (',
        '    SUM ( Sales[Amount] ),',
        '    FILTER ( ALL ( Product ), Product[Color] = "Red" && Product[Weight] > 100 ),',
        '    Sales[Quantity] > 10',
        ')'
      ].join('\n')
    )
  })
  it('lays out VAR / RETURN', () => {
    const src = 'var a = sum(T[x]) var b = calculate([m], removefilters(T)) return divide(a, b)'
    expect(formatDax(src)).toBe(['VAR a = SUM ( T[x] )', 'VAR b = CALCULATE ( [m], REMOVEFILTERS ( T ) )', 'RETURN', '    DIVIDE ( a, b )'].join('\n'))
  })
  it('preserves comments', () => {
    const out = formatDax('// leading\nSUM(T[a]) -- trailing')
    expect(out).toBe('// leading\nSUM ( T[a] ) -- trailing')
    const out2 = formatDax('CALCULATE([m], // why\n T[x] = 1)')
    expect(out2).toContain('// why')
    expect(out2.split('\n').find((l) => l.includes('// why'))).not.toMatch(/\/\/ why.*,/)
  })
  it('formats queries', () => {
    const q = "define measure Sales[Total]=sum(Sales[Amount]) evaluate summarizecolumns(Product[Color],\"Total\",[Total]) order by Product[Color] asc, [Total] desc"
    expect(isDaxQueryText(q)).toBe(true)
    expect(formatDax(q)).toBe(
      [
        'DEFINE',
        '    MEASURE Sales[Total] = SUM ( Sales[Amount] )',
        '',
        'EVALUATE',
        '    SUMMARIZECOLUMNS ( Product[Color], "Total", [Total] )',
        'ORDER BY',
        '    Product[Color] ASC,',
        '    [Total] DESC'
      ].join('\n')
    )
  })
  it('keeps VARs inside a DEFINE MEASURE with the measure', () => {
    const q = 'DEFINE MEASURE T[m] = VAR a = 1 RETURN a VAR v = 2 EVALUATE ROW("x", [m])'
    const out = formatDax(q)
    expect(out).toContain('    MEASURE T[m] =\n        VAR a = 1\n        RETURN\n            a\n    VAR v = 2')
  })
  it('is idempotent', () => {
    const src = 'VAR a = CALCULATE(SUM(Sales[Amount]), FILTER(ALL(Product), Product[Color] = "Red" || Product[Color] = "Blue"), USERELATIONSHIP(Sales[ShipDate], \'Date\'[Date])) RETURN a'
    const once = formatDax(src)
    expect(formatDax(once)).toBe(once)
  })
})

describe('definitions', () => {
  it('splits Name = expression', () => {
    expect(splitDefinition('Total Sales = SUM(Sales[Amount])')).toEqual({ name: 'Total Sales', expression: 'SUM(Sales[Amount])' })
    expect(splitDefinition('[A = B] = 1')).toEqual({ name: 'A = B', expression: '1' })
    expect(splitDefinition('SUM(x)')).toBeNull()
    expect(splitDefinition('Sales (LY) % = 1')).toEqual({ name: 'Sales (LY) %', expression: '1' })
    expect(splitDefinition("Customer's Sales = 2")).toEqual({ name: "Customer's Sales", expression: '2' })
    expect(formatDaxDefinition('m = var a = 1 return a')).toBe('m =\nVAR a = 1\nRETURN\n    a')
    expect(formatDaxDefinition('m = sum(T[a])')).toBe('m = SUM ( T[a] )')
  })
})

describe('localDaxDiagnostics', () => {
  const schema: DaxSchema = { tables: [{ name: 'Sales', columns: [{ name: 'Amount' }], measures: [{ name: 'Total' }] }] }
  it('reports unbalanced parens, unterminated strings and unknown functions', () => {
    expect(localDaxDiagnostics('SUM(Sales[Amount]', schema).map((d) => d.message)).toEqual(["'(' is not closed."])
    expect(localDaxDiagnostics('"abc', schema)[0].message).toMatch(/closing quotation/)
    expect(localDaxDiagnostics('SUMM(1)', schema)[0]).toMatchObject({ start: 0, end: 4, severity: 'error' })
  })
  it('reports unknown tables and columns', () => {
    const d = localDaxDiagnostics('SUM(Sale[Amount])', schema)[0]
    expect(d.message).toBe("Cannot find table 'Sale'. Did you mean 'Sales'?")
    expect(d.fixes).toEqual(["'Sales'"])
    expect(localDaxDiagnostics('SUM(Sales[Amout])', schema)[0].fixes).toEqual(['[Amount]'])
    expect(localDaxDiagnostics('CALCULTE(1)', schema)[0].fixes?.[0]).toBe('CALCULATE')
    expect(localDaxDiagnostics('SUM(Sales[Amt])', schema)[0].message).toMatch(/Column 'Amt' in table 'Sales'/)
    expect(localDaxDiagnostics('Sales[Total] + SUM(Sales[Amount])', schema)).toEqual([])
    expect(localDaxDiagnostics('DEFINE TABLE X = {1} EVALUATE SELECTCOLUMNS(X, "a", X[Value])', schema)).toEqual([])
    expect(localDaxDiagnostics('DEFINE MEASURE Sales[New] = 1 EVALUATE ROW("x", Sales[New])', schema)).toEqual([])
  })
})
