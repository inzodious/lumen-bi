import { beforeEach, describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { getIndentation, indentUnit } from '@codemirror/language'
import { closeBrackets } from '@codemirror/autocomplete'
import { buildCandidates, completionContextAt, declaredVars, matchScore, rankCandidates, recordUsage, resetUsage, snippetText, DAX_SNIPPETS, suggestNames, type CompletionMode } from './intellisense'
import { applyFunctionToState } from './completion'
import { hoverDocAt } from './hover'
import { dax } from './language'
import type { DaxSchema } from './schema'

const schema: DaxSchema = {
  homeTable: 'Sales',
  tables: [
    {
      name: 'Sales',
      columns: [
        { name: 'Amount', dataType: 'double' },
        { name: 'OrderDate', dataType: 'dateTime' },
        { name: 'Line Total', dataType: 'double', calculated: true, expression: 'Sales[Qty] * Sales[Price]' }
      ],
      measures: [{ name: 'Total Sales', formatString: '#,0', expression: 'SUM ( Sales[Amount] )' }]
    },
    { name: 'Sales Targets', columns: [{ name: 'Target', dataType: 'int64' }], measures: [{ name: 'Target Total', expression: 'SUM ( \'Sales Targets\'[Target] )' }] },
    { name: 'Date', columns: [{ name: 'Date', dataType: 'dateTime' }], measures: [] }
  ]
}

const word = (q: string): CompletionMode => ({ kind: 'word', query: q, from: 0 })
const top = (q: string, n = 3, docBefore = '') => rankCandidates(buildCandidates(word(q), schema, { docBefore }), q).slice(0, n).map((c) => c.label)

beforeEach(() => resetUsage())

describe('completion context', () => {
  it('detects word, bracket and quoted contexts', () => {
    expect(completionContextAt('= CALC')).toEqual({ kind: 'word', query: 'CALC', from: 2 })
    expect(completionContextAt("SUM ( 'Sales Targets'[Ta")).toEqual({ kind: 'bracket', table: 'Sales Targets', query: 'Ta', from: 21 })
    expect(completionContextAt('[Tot')).toEqual({ kind: 'bracket', table: null, query: 'Tot', from: 0 })
    expect(completionContextAt("'Sal")).toEqual({ kind: 'quoted', query: 'Sal', from: 0 })
    expect(completionContextAt('"text ')).toEqual({ kind: 'none' })
    expect(completionContextAt('-- comment')).toEqual({ kind: 'none' })
  })
})

describe('ranking', () => {
  it('prefers common functions on prefix ties, case-insensitive', () => {
    expect(top('CALC', 2)).toEqual(['CALCULATE', 'CALCULATETABLE'])
    expect(top('calc', 1)).toEqual(['CALCULATE'])
    expect(top('SU', 1)).toEqual(['SUM'])
    expect(top('div', 1)).toEqual(['DIVIDE'])
  })
  it('matches fuzzily (subsequence and word starts)', () => {
    expect(matchScore('cltb', 'CALCULATETABLE')).not.toBeNull()
    expect(matchScore('xyz', 'CALCULATE')).toBeNull()
    expect(matchScore('tts', 'Total Target Sales')).not.toBeNull()
    expect(top('Targ', 2)).toContain('[Target Total]')
  })
  it('boosts recently used items', () => {
    const before = top('CALC', 1)
    expect(before).toEqual(['CALCULATE'])
    for (let i = 0; i < 5; i++) recordUsage('f:CALCULATETABLE')
    expect(top('CALC', 1)).toEqual(['CALCULATETABLE'])
  })
  it('puts in-scope VARs first', () => {
    const doc = 'VAR _total = 1\nVAR _count = 2\nRETURN _t'
    expect(declaredVars(doc)).toEqual(['_total', '_count'])
    expect(top('_t', 1, doc)).toEqual(['_total'])
  })
  it('lists the qualified table columns and measures after Table[', () => {
    const r = rankCandidates(buildCandidates({ kind: 'bracket', table: 'Sales', query: '', from: 0 }, schema), '')
    expect(r.map((c) => c.label)).toEqual(['[Amount]', '[Line Total]', '[OrderDate]', '[Total Sales]'])
    expect(r.find((c) => c.label === '[Line Total]')!.calculated).toBe(true)
    expect(r.find((c) => c.label === '[Total Sales]')!.detail).toBe('#,0 · Sales')
  })
  it('lists all measures (home table first) and home columns after [', () => {
    const r = rankCandidates(buildCandidates({ kind: 'bracket', table: null, query: 'T', from: 0 }, schema), 'T')
    expect(r[0].label).toBe('[Total Sales]')
    expect(r.map((c) => c.label)).toContain('[Target Total]')
  })
  it('table completions insert the quoted name', () => {
    const r = rankCandidates(buildCandidates(word('date'), schema), 'date')
    expect(r.find((c) => c.kind === 'table')!.insert).toBe("'Date'")
    expect(r.find((c) => c.kind === 'column' && c.table === 'Date')!.insert).toBe("'Date'[Date]")
  })
})

describe('insertion', () => {
  const st = (doc: string) => EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [dax(), closeBrackets()] })
  it('function completion inserts NAME() with the caret inside', () => {
    const s = applyFunctionToState(st('= calc'), 'CALCULATE', 2, 6)
    expect(s.doc.toString()).toBe('= CALCULATE()')
    expect(s.selection.main.head).toBe(12)
  })
  it('steps into an existing parenthesis instead of adding another', () => {
    const doc = '= calc(1)'
    const s = applyFunctionToState(EditorState.create({ doc, selection: { anchor: 6 }, extensions: [dax(), closeBrackets()] }), 'CALCULATE', 2, 6)
    expect(s.doc.toString()).toBe('= CALCULATE(1)')
    expect(s.selection.main.head).toBe(12)
  })
})

describe('auto-indentation', () => {
  const indentAt = (doc: string) => {
    const s = EditorState.create({ doc, extensions: [dax(), indentUnit.of('    ')] })
    return getIndentation(s, doc.length)
  }
  it('indents inside open parentheses and closes back', () => {
    expect(indentAt('CALCULATE (\n')).toBe(4)
    expect(indentAt('CALCULATE (\n    FILTER (\n')).toBe(8)
  })
  it('indents after VAR x = and after RETURN, not after the formula-bar name', () => {
    expect(indentAt('VAR x =\n')).toBe(4)
    expect(indentAt('VAR x = 1\n')).toBe(0)
    expect(indentAt('VAR x = 1\nRETURN\n')).toBe(4)
    expect(indentAt('Total Sales =\n')).toBe(0)
    expect(indentAt('DEFINE MEASURE T[m] =\n')).toBe(4)
  })
  it('aligns RETURN / VAR with the block and closing parens with the call', () => {
    const s = EditorState.create({ doc: 'VAR x =\n    1\nRETURN', extensions: [dax(), indentUnit.of('    ')] })
    expect(getIndentation(s, s.doc.line(3).from)).toBe(0)
    const s2 = EditorState.create({ doc: 'SUM (\n    T[a]\n)', extensions: [dax(), indentUnit.of('    ')] })
    expect(getIndentation(s2, s2.doc.line(3).from)).toBe(0)
  })
})

describe('snippets', () => {
  it('expand to valid DAX with default placeholders', () => {
    expect(snippetText(DAX_SNIPPETS.find((s) => s.label === 'var')!.template)).toBe('VAR _value = \nRETURN\n    _value')
    expect(snippetText(DAX_SNIPPETS.find((s) => s.label === 'sw')!.template)).toBe('SWITCH (\n    TRUE (),\n    condition, result,\n    else\n)')
    expect(snippetText(DAX_SNIPPETS.find((s) => s.label === 'divide')!.template)).toBe('DIVIDE ( numerator, denominator )')
    for (const s of DAX_SNIPPETS) expect(snippetText(s.template)).not.toMatch(/\$\{/)
  })
  it('are offered as completions', () => {
    expect(rankCandidates(buildCandidates(word('sw'), schema), 'sw').some((c) => c.kind === 'snippet' && c.label === 'sw')).toBe(true)
  })
})

describe('hover docs', () => {
  it('documents functions, measures, columns and tables', () => {
    const text = "CALCULATE ( [Total Sales], 'Date'[Date] = TODAY () ) + Sales[Line Total]"
    expect(hoverDocAt(text, 2, schema)).toMatchObject({ title: 'CALCULATE — Filter', code: 'CALCULATE(<Expression>, [<Filter1>], ...)' })
    expect(hoverDocAt(text, 2, schema)!.example).toContain('CALCULATE')
    expect(hoverDocAt(text, 15, schema)).toMatchObject({ title: 'Measure Sales[Total Sales]', code: 'Total Sales =\nSUM ( Sales[Amount] )', body: 'Format: #,0' })
    expect(hoverDocAt(text, 35, schema)).toMatchObject({ title: 'Column Date[Date]', body: 'Date/time' })
    expect(hoverDocAt(text, text.length - 3, schema)).toMatchObject({ title: 'Column Sales[Line Total]', code: 'Line Total =\nSales[Qty] * Sales[Price]' })
    expect(hoverDocAt('COUNTROWS ( Sales )', 13, schema)).toMatchObject({ title: 'Table Sales' })
    expect(hoverDocAt(text, 30, schema)).toMatchObject({ title: 'Table Date' })
  })
})

describe('did you mean', () => {
  it('suggests close names', () => {
    expect(suggestNames('Amout', ['Amount', 'OrderDate'])).toEqual(['Amount'])
    expect(suggestNames('Zzz', ['Amount'])).toEqual([])
  })
})
