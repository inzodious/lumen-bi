import { describe, expect, it } from 'vitest'
import { DaxSyntaxError, isQueryText, parseExpression, parseQuery } from '../index.ts'

describe('tabular parser', () => {
  it('handles comments, quoted names and escapes', () => {
    const n = parseExpression(`-- line comment
      // another
      /* block
         comment */ 'My ''Table'''[Col]]x] + [Measure]`)
    expect(n).toMatchObject({ kind: 'binary', op: '+', left: { kind: 'column', table: "My 'Table'", name: 'Col]x' }, right: { kind: 'column', table: null, name: 'Measure' } })
  })
  it('parses numbers, strings, operators and precedence', () => {
    expect(parseExpression('.5 + 1e3 * 2')).toMatchObject({ op: '+', left: { value: 0.5 }, right: { op: '*', left: { value: 1000 } } })
    expect(parseExpression('"a""b"')).toMatchObject({ kind: 'string', value: 'a"b' })
    expect(parseExpression('NOT a = b && c')).toMatchObject({ op: '&&', left: { kind: 'unary', op: 'NOT', operand: { op: '=' } } })
    expect(parseExpression('NOT ( x ) || y')).toMatchObject({ op: '||', left: { kind: 'unary', op: 'NOT' } })
    expect(parseExpression('-2 ^ 2')).toMatchObject({ kind: 'unary', op: '-', operand: { op: '^' } })
    expect(parseExpression('( 1, 2 ) IN { ( 1, 2 ) }')).toMatchObject({ op: 'IN', left: { kind: 'tuple' }, right: { kind: 'tableCtor' } })
  })
  it('accepts dotted function names and VAR blocks', () => {
    expect(parseExpression('VAR.S ( T[c] ) + PERCENTILE.INC ( T[c], 0.5 )')).toMatchObject({ left: { kind: 'call', name: 'VAR.S' }, right: { kind: 'call', name: 'PERCENTILE.INC' } })
    expect(parseExpression('VAR a = 1 VAR b = a + 1 RETURN b')).toMatchObject({ kind: 'var', decls: [{ name: 'a' }, { name: 'b' }] })
    expect(parseExpression('IF.EAGER ( TRUE, 1, 2 )')).toMatchObject({ kind: 'call', name: 'IF.EAGER' })
    expect(parseExpression('RANKX ( T, [m], , DESC, DENSE )')).toMatchObject({ args: [{}, {}, { kind: 'ident', name: '__missing__' }, { kind: 'ident', name: 'DESC' }, { kind: 'ident', name: 'DENSE' }] })
  })
  it('reports syntax errors with offsets', () => {
    try {
      parseExpression('SUM ( T[c] ')
      throw new Error('no error')
    } catch (e) {
      expect(e).toBeInstanceOf(DaxSyntaxError)
      expect((e as DaxSyntaxError).start).toBe(11)
    }
    expect(() => parseExpression('a NOT IN { 1 }')).toThrow(/NOT IN/)
    expect(() => parseExpression("'unclosed")).toThrow(/never closed/)
    expect(() => parseExpression('RETURN 1')).toThrow(/RETURN/)
  })
  it('parses queries', () => {
    const q = parseQuery(`DEFINE
      MEASURE 'T'[m] = 1
      VAR v = 2
      TABLE tt = { 1 }
      COLUMN T[c2] = 3
    EVALUATE tt ORDER BY [Value] DESC START AT 5
    EVALUATE { v }`)
    expect(q.definitions.map((d) => d.kind)).toEqual(['measure', 'var', 'table', 'column'])
    expect(q.evaluates).toHaveLength(2)
    expect(q.evaluates[0]).toMatchObject({ orderBy: [{ desc: true }], startAt: [{ value: 5 }] })
    expect(isQueryText('  evaluate { 1 }')).toBe(true)
    expect(isQueryText('SUM ( T[c] )')).toBe(false)
    const fq = parseQuery('DEFINE FUNCTION f = ( a : INT64, b : TABLE EXPR = Sales ) => a EVALUATE { f ( 1 ) }')
    expect(fq.definitions[0]).toMatchObject({ kind: 'function', name: 'f', fn: { params: [{ name: 'a', type: 'SCALAR', subtype: 'INT64', mode: 'val' }, { name: 'b', type: 'TABLE', mode: 'expr' }] } })
  })
})
