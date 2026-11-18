import { describe, expect, it } from 'vitest'
import { mIndentAfter, tokenizeM } from './language'
import { mCompletionsFor, mFieldRef, mLibrary, mWordContext } from './completion'
import { diagnosticRange, mSyntaxCheck } from './lint'

const styles = (text: string) => tokenizeM(text).tokens.filter((t) => t.style !== null).map((t) => [t.text, t.style])

describe('M tokenizer', () => {
  it('classifies keywords, identifiers, strings, numbers, comments', () => {
    const toks = styles('let Source = Table.SelectRows(#"Changed Type", each [Amount] > 0x1F and [Name] <> "a""b") in Source')
    expect(toks).toContainEqual(['let', 'mKeyword'])
    expect(toks).toContainEqual(['Source', 'mIdentifier'])
    expect(toks).toContainEqual(['Table.SelectRows', 'mIdentifier'])
    expect(toks).toContainEqual(['#"Changed Type"', 'mQuoted'])
    expect(toks).toContainEqual(['each', 'mKeyword'])
    expect(toks).toContainEqual(['0x1F', 'number'])
    expect(toks).toContainEqual(['"a""b"', 'string'])
    expect(toks).toContainEqual(['<>', 'operator'])
    expect(toks).toContainEqual(['in', 'mKeyword'])
  })

  it('handles intrinsics, exponents and operators', () => {
    const toks = styles('#date(2024, 1, 1) + #duration(1,0,0,0) ?? 1.5e-3 => {1..3}')
    expect(toks).toContainEqual(['#date', 'mIntrinsic'])
    expect(toks).toContainEqual(['#duration', 'mIntrinsic'])
    expect(toks).toContainEqual(['1.5e-3', 'number'])
    expect(toks).toContainEqual(['??', 'operator'])
    expect(toks).toContainEqual(['=>', 'operator'])
    expect(toks).toContainEqual(['..', 'operator'])
  })

  it('continues block comments and strings across lines', () => {
    const toks = tokenizeM('/* a\n b */ x = "line1\nline2" // done').tokens.filter((t) => t.style)
    expect(toks.map((t) => [t.text, t.style])).toEqual([
      ['/* a', 'comment'],
      [' b */', 'comment'],
      ['x', 'mIdentifier'],
      ['=', 'operator'],
      ['"line1', 'string'],
      ['line2"', 'string'],
      ['// done', 'comment']
    ])
  })

  it('keeps quoted identifiers with doubled quotes as one token', () => {
    expect(styles('#"Sales ""2024"""')).toEqual([['#"Sales ""2024"""', 'mQuoted']])
  })
})

describe('M indentation', () => {
  it('indents after let and inside brackets, dedents in and closers', () => {
    expect(mIndentAfter('let')).toBe(4)
    expect(mIndentAfter('let\n    Source = 1,')).toBe(4)
    expect(mIndentAfter('let\n    Source = 1', 'in')).toBe(0)
    expect(mIndentAfter('let\n    Source = 1\nin')).toBe(4)
    expect(mIndentAfter('let\n    Source = Table.FromRows(')).toBe(8)
    expect(mIndentAfter('let\n    Source = Table.FromRows(\n        {1, 2}', ')')).toBe(4)
    expect(mIndentAfter('let\n    Source = {\n        1,')).toBe(8)
  })

  it('adds a continuation level after =', () => {
    expect(mIndentAfter('let\n    Source =')).toBe(8)
    expect(mIndentAfter('let\n    A = if x then')).toBe(8)
  })

  it('handles nested let used as a binding value', () => {
    const before = 'let\n    A = let\n        x = 1\n    in\n        x,'
    expect(mIndentAfter(before)).toBe(4)
    expect(mIndentAfter('let\n    A = let', 'x = 1')).toBe(8)
  })
})

describe('mSyntaxCheck', () => {
  it('accepts valid queries and reports errors with positions', () => {
    expect(mSyntaxCheck('let a = 1 in a')).toBeNull()
    expect(mSyntaxCheck('let a = 1 b = 2 in a')).toEqual({ message: 'Token Comma expected.', line: 1, col: 11 })
    expect(mSyntaxCheck('let\n  a = 1,\n  b = [x\nin b')?.line).toBe(4)
  })

  it('ignores a leading = in expression mode and maps positions back', () => {
    expect(mSyntaxCheck('= Table.RowCount(Source)', { expression: true })).toBeNull()
    const d = mSyntaxCheck('= 1 +', { expression: true })
    expect(d?.message).toBe('Token Literal expected.')
    expect(d?.col).toBe(6)
  })

  it('diagnosticRange covers the token at the error', () => {
    const text = 'let a = 1 b = 2 in a'
    const d = mSyntaxCheck(text)!
    const r = diagnosticRange(text, d)
    expect(text.slice(r.from, r.to)).toBe('b')
  })
})

describe('M completion', () => {
  const library = mLibrary()

  it('loads the engine library', () => {
    const fn = library.find((e) => e.name === 'Table.SelectRows')
    expect(fn?.kind).toBe('function')
    expect(fn?.signature).toMatch(/^Table\.SelectRows\(/)
    expect(library.find((e) => e.name === 'Int64.Type')?.kind).toBe('type')
  })

  it('finds the word context before the caret', () => {
    expect(mWordContext('x = Table.Sel')).toEqual({ kind: 'word', word: 'Table.Sel' })
    expect(mWordContext('each [Amo')).toEqual({ kind: 'field', word: 'Amo' })
    expect(mWordContext('= #"Chan')).toEqual({ kind: 'hash', word: '#"Chan' })
    expect(mWordContext('x = ')).toBeNull()
  })

  it('filters namespace members by prefix', () => {
    const c = mCompletionsFor({ kind: 'word', word: 'Table.Sel' }, { library })
    expect(c[0]?.label).toBe('Table.SelectColumns')
    expect(c.map((x) => x.label)).toContain('Table.SelectRows')
    expect(c.every((x) => x.label.startsWith('Table.'))).toBe(true)
  })

  it('quotes step and query names, writes field refs', () => {
    const c = mCompletionsFor({ kind: 'word', word: 'Chan' }, { library, steps: ['Changed Type', 'Source'], queries: ['Channel List'], columns: ['Change %'] })
    expect(c.find((x) => x.label === 'Changed Type')?.apply).toBe('#"Changed Type"')
    expect(c.find((x) => x.label === 'Channel List')?.apply).toBe('#"Channel List"')
    expect(c.find((x) => x.label === 'Change %')?.apply).toBe('[#"Change %"]')
    expect(c[0]?.kind).toBe('step')
    expect(mFieldRef('Order Date')).toBe('[Order Date]')
  })

  it('completes columns inside [ and intrinsics after #', () => {
    const f = mCompletionsFor({ kind: 'field', word: 'or' }, { library, columns: ['Order Date', 'Amount', 'Sales (USD)'] })
    expect(f.map((x) => x.apply)).toEqual(['Order Date'])
    const h = mCompletionsFor({ kind: 'hash', word: '#da' }, { library, steps: ['data set'] })
    expect(h.map((x) => x.label)).toEqual(expect.arrayContaining(['#date', '#datetime', '#datetimezone']))
  })

  it('offers keywords', () => {
    expect(mCompletionsFor({ kind: 'word', word: 'oth' }, { library }).map((x) => x.label)).toContain('otherwise')
  })
})
