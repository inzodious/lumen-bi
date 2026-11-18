import { describe, expect, it } from 'vitest'
import { evaluateQuery, parseExpression } from '@core/m/index.ts'
import { decodeRows, encodeRows, enterDataFormula, enterDataQuery, isEnterData, parseEnterData } from '../enterData'
import { columnOpArgsValid, columnOpDialog, columnOpNeedsArgs, splitOnceAtPosition } from '../dialogArgs'
import * as S from '../stepSettings'
import * as T from '../transforms'
import { filterByConditions } from '../filters'
import { check, missingFunctions, tableOf } from './helpers'

const P = '#"Changed Type"'
const f = (spec: T.StepSpec) => spec.formula(P)

describe('enter data', () => {
  const table = { columns: ['Product', 'Unit Price'], rows: [['Apple', '1.5'], ['Pear', '2'], ['', '']] }

  it('compresses the rows like PBI (raw deflate of JSON, base64) and reads them back', () => {
    const b64 = encodeRows([['a', 'b'], ['c', 'd"e']])
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(decodeRows(b64)).toEqual([['a', 'b'], ['c', 'd"e']])
    expect(decodeRows('not base64!')).toBeNull()
  })

  it('writes the Source formula PBI writes', () => {
    const src = enterDataFormula(table)
    expect(src).toMatch(/^Table\.FromRows\(Json\.Document\(Binary\.Decompress\(Binary\.FromText\("[A-Za-z0-9+/=]+", BinaryEncoding\.Base64\), Compression\.Deflate\)\), let _t = \(\(type nullable text\) meta \[Serialized\.Text = true\]\) in type table \[Product = _t, #"Unit Price" = _t\]\)$/)
    expect(isEnterData(src)).toBe(true)
    // trailing empty rows are dropped
    expect(parseEnterData(src)).toEqual({ columns: ['Product', 'Unit Price'], rows: [['Apple', '1.5'], ['Pear', '2']] })
  })

  it('creates a query with a Changed Type step (detected types)', () => {
    const q = enterDataQuery(table)
    expect(() => parseExpression(q)).not.toThrow()
    expect(q).toContain('#"Changed Type" = Table.TransformColumnTypes(Source,{{"Product", type text}, {"Unit Price", type number}})')
    expect(parseEnterData(q)?.columns).toEqual(['Product', 'Unit Price'])
    expect(parseEnterData('Table.FromRows({})')).toBeNull()
  })

  const gaps = missingFunctions(enterDataFormula(table))
  // The M engine doesn't implement Binary.FromText / Binary.Decompress yet: evaluated once it does.
  it.skipIf(gaps.length > 0)('evaluates with the M engine', () => {
    const ev = evaluateQuery(enterDataQuery(table), { previewSteps: false })
    expect(ev.result.ok).toBe(true)
    if (ev.result.ok && ev.result.preview.kind === 'table') expect(ev.result.preview.rows).toEqual([['Apple', 1.5], ['Pear', 2]])
  })
})

describe('column op argument dialogs', () => {
  it('knows which ops need input', () => {
    expect(columnOpNeedsArgs('prefix')).toBe(true)
    expect(columnOpNeedsArgs('range')).toBe(true)
    expect(columnOpNeedsArgs('round')).toBe(true)
    expect(columnOpNeedsArgs('upper')).toBe(false)
    expect(columnOpNeedsArgs('year')).toBe(false)
    expect(columnOpDialog('first')?.title).toBe('Extract First Characters')
    expect(columnOpDialog('betweenDelimiters')?.fields).toHaveLength(2)
  })
  it('validates numeric fields', () => {
    expect(columnOpArgsValid('first', ['3'])).toBe(true)
    expect(columnOpArgsValid('first', ['x'])).toBe(false)
    expect(columnOpArgsValid('beforeDelimiter', [''])).toBe(false)
    expect(columnOpArgsValid('upper', [])).toBe(true)
  })
  it('split once at a position', () => {
    expect(f(splitOnceAtPosition('Region', 2, 'left'))).toBe(`Table.SplitColumn(${P}, "Region", Splitter.SplitTextByPositions({0, 2}, false), {"Region.1", "Region.2"})`)
    const spec = splitOnceAtPosition('Region', 1, 'right')
    expect(f(spec)).toContain('Splitter.SplitTextByPositions({0, 1}, true)')
    check(spec, f(spec))
  })
})

describe('step settings', () => {
  it('maps generated steps to their dialogs', () => {
    const cases: Array<[string, string | null]> = [
      [f(filterByConditions('Region', 'text', { op: 'beginsWith', value: 'E' }, 'or', { op: 'equals', value: 'West' })), 'filterRows'],
      [f(T.groupBy(['Region'], [{ name: 'Total', op: 'sum', column: 'Amount' }, { name: 'Count', op: 'count' }], [])), 'groupBy'],
      [f(T.addCustomColumn('Double', '[Amount] * 2', 'number')), 'customColumn'],
      [f(T.addConditionalColumn('Size', [{ column: 'Amount', op: 'greater', value: '10', output: '"Big"' }], '"Small"')), 'conditionalColumn'],
      [f(T.mergeQueries(['Region'], 'Regions', ['Region'], 'Inner')), 'merge'],
      [f(T.appendQueries(['Other', 'Third Query'])), 'append'],
      [f(T.splitByDelimiter('Region', ',', 'each', 3)), 'split'],
      [f(T.replaceValues([{ name: 'Region', type: 'text' }], 'E', 'X')), 'replace'],
      [f(T.replaceErrors(['Amount'], '0')), 'replace'],
      [f(T.pivotColumn('Region', 'Amount', 'sum')), 'pivot'],
      [f(T.keepFirstRows(5)), 'rows'],
      [f(T.removeAlternateRows(2, 1, 3)), 'rows'],
      [f(T.addIndexColumn(1)), 'indexColumn'],
      [enterDataFormula({ columns: ['A'], rows: [['1']] }), 'enterData'],
      [f(T.removeColumns(['A'])), null],
      [f(T.reverseRows()), null],
      ['Table.SelectRows(Source, each [A] > 1 and [B] < 2)', null],
      ['Sql.Database("server", "db")', null]
    ]
    for (const [formula, id] of cases) expect([formula, S.stepSettingsDialog('Step', formula)?.id ?? null]).toEqual([formula, id])
    expect(S.hasStepSettings(f(T.keepLastRows(3)))).toBe(true)
    expect(S.hasStepSettings(f(T.transpose()))).toBe(false)
  })

  it('reads filter rows back', () => {
    const p = S.parseFilterRows(f(filterByConditions('Order Date', 'date', { op: 'after', value: '1/5/2024' }, 'and', { op: 'before', value: '3/1/2024' })))
    expect(p).toEqual({ column: 'Order Date', first: { op: 'greater', value: '1/5/2024' }, join: 'and', second: { op: 'less', value: '3/1/2024' } })
    expect(S.parseFilterRows(`Table.SelectRows(${P}, each not Text.Contains([#"Sales (USD)"], "x"))`)).toEqual({ column: 'Sales (USD)', first: { op: 'notContains', value: 'x' } })
    expect(S.parseFilterRows(`Table.SelectRows(${P}, each ([Region] = "East"))`)?.first).toEqual({ op: 'equals', value: 'East' })
  })

  it('reads group by, custom / conditional / index columns back', () => {
    const cols: T.ColInfo[] = [{ name: 'Amount', type: 'number' }]
    expect(S.parseGroupBy(f(T.groupBy(['Region', 'Product'], [{ name: 'Total', op: 'sum', column: 'Amount' }, { name: 'Rows', op: 'all' }, { name: 'N', op: 'countDistinct' }], cols)))).toEqual({
      keys: ['Region', 'Product'],
      aggs: [{ name: 'Total', op: 'sum', column: 'Amount' }, { name: 'Rows', op: 'all' }, { name: 'N', op: 'countDistinct' }]
    })
    expect(S.parseCustomColumn(f(T.addCustomColumn('My Col', '[Amount] * 2', 'currency')))).toEqual({ name: 'My Col', body: '[Amount] * 2', type: 'currency' })
    expect(S.parseCustomColumn(f(T.addCustomColumn('X', '1')))).toEqual({ name: 'X', body: '1', type: undefined })
    const cond = S.parseConditionalColumn(
      f(
        T.addConditionalColumn(
          'Band',
          [
            { column: 'Amount', op: 'greaterOrEqual', value: '100', output: '"High"' },
            { column: 'Region', op: 'notBeginsWith', value: '"E"', output: '"Other"' }
          ],
          'null'
        )
      )
    )
    expect(cond).toEqual({
      name: 'Band',
      clauses: [
        { column: 'Amount', op: 'greaterOrEqual', value: '100', output: '"High"' },
        { column: 'Region', op: 'notBeginsWith', value: '"E"', output: '"Other"' }
      ],
      otherwise: 'null'
    })
    expect(S.parseIndexColumn(f(T.addIndexColumn(10, 5, 'Idx')))).toEqual({ name: 'Idx', start: 10, increment: 5 })
  })

  it('reads merge, append, split, replace, pivot and row steps back', () => {
    expect(S.parseMerge(f(T.mergeQueries(['A', 'B'], 'Other Table', ['X', 'Y'], 'LeftAnti')))).toEqual({ leftKeys: ['A', 'B'], other: 'Other Table', rightKeys: ['X', 'Y'], newColumn: 'Other Table', kind: 'LeftAnti' })
    expect(S.parseAppend(f(T.appendQueries(['Q1', 'Q 2'])))).toEqual(['Q1', 'Q 2'])
    expect(S.parseSplit(f(T.splitByDelimiter('Name', ' ', 'right', 2)))).toEqual({ mode: 'delimiter', column: 'Name', delimiter: ' ', at: 'right', count: 2, quoteStyle: 'Csv' })
    expect(S.parseSplit(f(T.splitByDelimiter('Name', ';', 'each', 3, 'None')))).toEqual({ mode: 'delimiter', column: 'Name', delimiter: ';', at: 'each', count: 3, quoteStyle: 'None' })
    expect(S.parseSplit(f(T.splitByPositions('Code', 2, 4)))).toEqual({ mode: 'positions', column: 'Code', length: 2, repeat: 'repeat', count: 4 })
    expect(S.parseSplit(f(splitOnceAtPosition('Code', 3, 'right')))).toEqual({ mode: 'positions', column: 'Code', length: 3, repeat: 'right', count: 2 })
    expect(S.parseReplace(f(T.replaceValues([{ name: 'Region', type: 'text' }], 'a"b', 'c', true)))).toEqual({ columns: ['Region'], find: 'a"b', replace: 'c', matchEntire: true })
    expect(S.parseReplace(f(T.replaceValues([{ name: 'Qty', type: 'Int64.Type' }], '3', '4')))).toEqual({ columns: ['Qty'], find: '3', replace: '4', matchEntire: false })
    expect(S.parseReplaceErrors(f(T.replaceErrors(['A', 'B'], '"x"')))).toEqual({ columns: ['A', 'B'], value: 'x' })
    expect(S.parsePivot(f(T.pivotColumn('Region', 'Amount', 'countDistinct')))).toEqual({ attribute: 'Region', value: 'Amount', agg: 'countDistinct' })
    expect(S.parsePivot(f(T.pivotColumn('Region', 'Amount', 'none')))).toEqual({ attribute: 'Region', value: 'Amount', agg: 'none' })
    expect(S.parseRows(f(T.keepRange(3, 5)))).toEqual({ kind: 'keepRange', values: [3, 5] })
    expect(S.parseRows(f(T.removeAlternateRows(2, 1, 3)))).toEqual({ kind: 'removeAlternate', values: [2, 1, 3] })
    expect(S.parseRows(f(T.removeBottomRows(4)))).toEqual({ kind: 'removeBottom', values: [4] })
  })

  it('small readers', () => {
    expect(S.fieldName('[#"A ""b"""]')).toBe('A "b"')
    expect(S.fieldName('[Order Date]')).toBe('Order Date')
    expect(S.identName('#"Sales (2)"')).toBe('Sales (2)')
    expect(S.literalText('#date(2024, 1, 5)')).toBe('1/5/2024')
    expect(S.typeIdOf('Int64.Type')).toBe('int64')
    expect(S.typeIdOf('type   text')).toBe('text')
  })

  it('the base data still evaluates through a parsed + regenerated group by', () => {
    const spec = T.groupBy(['Region'], [{ name: 'Total', op: 'sum', column: 'Amount' }], [{ name: 'Amount', type: 'number' }])
    const parsed = S.parseGroupBy(f(spec))!
    const again = T.groupBy(parsed.keys, parsed.aggs, [{ name: 'Amount', type: 'number' }])
    expect(tableOf(check(again, f(spec)))?.columns).toEqual(['Region', 'Total'])
  })
})

describe('step descriptions', () => {
  const src = 'let\n    Source = 1,\n    // old\n    #"Added One" = Source + 1\nin\n    #"Added One"'
  it('reads and writes the comment above a step', () => {
    expect(S.readStepDescription(src, 'Added One')).toBe('old')
    expect(S.readStepDescription(src, 'Source')).toBe('')
    const next = S.writeStepDescription(src, 'Added One', 'Adds one\nto the source')!
    expect(next).toBe('let\n    Source = 1,\n    // Adds one\n    // to the source\n    #"Added One" = Source + 1\nin\n    #"Added One"')
    expect(S.readStepDescription(next, 'Added One')).toBe('Adds one\nto the source')
    expect(S.writeStepDescription(next, 'Added One', '')).toBe('let\n    Source = 1,\n    #"Added One" = Source + 1\nin\n    #"Added One"')
    expect(S.writeStepDescription(src, 'Missing', 'x')).toBeNull()
    expect(() => parseExpression(next)).not.toThrow()
  })
})
