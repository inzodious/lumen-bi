import { DaxSyntaxError } from './errors.ts'

export type TokenType = 'ident' | 'number' | 'string' | 'table' | 'column' | 'op' | 'punct' | 'param' | 'eof'

export interface Token {
  type: TokenType
  value: string
  /** 0-based offsets */
  start: number
  end: number
  line: number
  col: number
}

const TWO_CHAR_OPS = new Set(['&&', '||', '==', '<=', '>=', '<>', '=>'])
const ONE_CHAR_OPS = new Set(['=', '<', '>', '+', '-', '*', '/', '^', '&'])
const PUNCT = new Set(['(', ')', '{', '}', ',', ';', ':'])

function isIdentStart(ch: string): boolean {
  return /[\p{L}_]/u.test(ch)
}
function isIdentPart(ch: string): boolean {
  return /[\p{L}\p{N}_.]/u.test(ch)
}

export function lex(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  let line = 1
  let lineStart = 0
  const fail = (msg: string, at: number): never => {
    throw new DaxSyntaxError(msg, line, at - lineStart + 1, at, Math.min(src.length, at + 1))
  }
  const push = (type: TokenType, value: string, start: number, end: number, l: number, ls: number) =>
    tokens.push({ type, value, start, end, line: l, col: start - ls + 1 })
  while (i < src.length) {
    const ch = src[i]
    const next = src[i + 1] ?? ''
    if (ch === '\n') {
      line++
      i++
      lineStart = i
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === ' ' || ch === '﻿' || /\s/.test(ch)) {
      i++
      continue
    }
    const start = i
    const l = line
    const ls = lineStart
    if ((ch === '-' && next === '-') || (ch === '/' && next === '/')) {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2)
      if (end < 0) fail('the /* comment is never closed with */.', i)
      for (let k = i; k < end + 2; k++) if (src[k] === '\n') {
        line++
        lineStart = k + 1
      }
      i = end + 2
      continue
    }
    if (ch === '"' || ch === "'" || ch === '[') {
      const close = ch === '[' ? ']' : ch
      let j = i + 1
      let value = ''
      for (;;) {
        if (j >= src.length) fail(ch === '"' ? 'the text literal is never closed with ".' : ch === "'" ? "the quoted table name is never closed with '." : 'the column or measure name is never closed with ].', start)
        const c = src[j]
        if (c === close) {
          if (src[j + 1] === close) {
            value += close
            j += 2
            continue
          }
          break
        }
        if (c === '\n') {
          line++
          lineStart = j + 1
        }
        value += c
        j++
      }
      i = j + 1
      push(ch === '"' ? 'string' : ch === "'" ? 'table' : 'column', value, start, i, l, ls)
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(next))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i, i + 64))!
      i += m[0].length
      push('number', m[0], start, i, l, ls)
      continue
    }
    if (isIdentStart(ch)) {
      let j = i + 1
      while (j < src.length && isIdentPart(src[j])) j++
      // a trailing '.' is not part of an identifier
      while (j > i + 1 && src[j - 1] === '.') j--
      push('ident', src.slice(i, j), start, j, l, ls)
      i = j
      continue
    }
    if (ch === '@' && isIdentStart(next)) {
      let j = i + 1
      while (j < src.length && isIdentPart(src[j])) j++
      push('param', src.slice(i + 1, j), start, j, l, ls)
      i = j
      continue
    }
    const two = ch + next
    if (TWO_CHAR_OPS.has(two)) {
      i += 2
      push('op', two, start, i, l, ls)
      continue
    }
    if (ONE_CHAR_OPS.has(ch)) {
      i++
      push('op', ch, start, i, l, ls)
      continue
    }
    if (PUNCT.has(ch)) {
      i++
      push('punct', ch, start, i, l, ls)
      continue
    }
    if (ch === ']') fail("unexpected ']' without a matching '['.", i)
    fail(`unexpected character '${ch}'.`, i)
  }
  tokens.push({ type: 'eof', value: '', start: src.length, end: src.length, line, col: src.length - lineStart + 1 })
  return tokens
}
