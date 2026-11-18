/**
 * Tolerant DAX tokenizer for editor features (formatter, signature help, completion context).
 *
 * Unlike the engine lexer (src/core/dax/lexer.ts) this never throws: unterminated strings,
 * column references and block comments simply run to the end of the input, and unknown
 * characters become `error` tokens. Offsets are 0-based UTF-16 indices into the source.
 */
import { findDaxFunction } from './functions'

export type DaxTokenType =
  | 'ws'
  | 'newline'
  | 'comment'
  | 'string'
  | 'number'
  /** 'Quoted table' */
  | 'table'
  /** [Column] or [Measure] */
  | 'column'
  /** unquoted identifier: function name, keyword, table name or VAR name */
  | 'ident'
  | 'keyword'
  | 'function'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'lbrace'
  | 'rbrace'
  | 'comma'
  | 'error'

export interface DaxToken {
  type: DaxTokenType
  text: string
  start: number
  end: number
  /** comment tokens: true for `--` / `//` line comments (they force a line break when formatting) */
  lineComment?: boolean
  /** string/column/table/comment tokens: false when the closing delimiter is missing */
  terminated?: boolean
}

/** Keywords of DAX expressions and queries (identifiers that are not functions). */
export const DAX_KEYWORD_SET = new Set([
  'VAR',
  'RETURN',
  'DEFINE',
  'EVALUATE',
  'ORDER',
  'BY',
  'START',
  'AT',
  'MEASURE',
  'COLUMN',
  'TABLE',
  'FUNCTION',
  'CALCULATIONGROUP',
  'CALCULATIONITEM',
  'IN',
  'NOT',
  'ASC',
  'DESC',
  'TRUE',
  'FALSE'
])

/** Enumeration arguments (DATEADD(..., YEAR), RANKX(..., DENSE), CROSSFILTER(..., BOTH), DATATABLE types). */
export const DAX_ENUM_SET = new Set(['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR', 'HOUR', 'MINUTE', 'SECOND', 'SKIP', 'DENSE', 'BOTH', 'NONE', 'ONEWAY', 'ONEWAY_RIGHTFILTERSLEFT', 'ONEWAY_LEFTFILTERSRIGHT', 'INTEGER', 'DOUBLE', 'STRING', 'BOOLEAN', 'CURRENCY', 'DATETIME', 'REL', 'ASC', 'DESC'])

const TWO_CHAR_OPS = ['&&', '||', '==', '<=', '>=', '<>']
const ONE_CHAR_OPS = '=<>+-*/^&'

const isIdentStart = (ch: string): boolean => /[\p{L}_]/u.test(ch)
const isIdentPart = (ch: string): boolean => /[\p{L}\p{N}_.]/u.test(ch)
const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= '0' && ch <= '9'

export function tokenizeDax(src: string): DaxToken[] {
  const out: DaxToken[] = []
  let i = 0
  const n = src.length
  const push = (type: DaxTokenType, start: number, end: number, extra?: Partial<DaxToken>): void => {
    out.push({ type, text: src.slice(start, end), start, end, ...extra })
  }
  while (i < n) {
    const ch = src[i]
    const start = i
    if (ch === '\n' || ch === '\r') {
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1
      push('newline', start, i)
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === ' ') {
      while (i < n && (src[i] === ' ' || src[i] === '\t' || src[i] === ' ')) i++
      push('ws', start, i)
      continue
    }
    if ((ch === '-' && src[i + 1] === '-') || (ch === '/' && src[i + 1] === '/')) {
      while (i < n && src[i] !== '\n' && src[i] !== '\r') i++
      push('comment', start, i, { lineComment: true, terminated: true })
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end < 0 ? n : end + 2
      push('comment', start, i, { terminated: end >= 0 })
      continue
    }
    if (ch === '"') {
      i++
      let terminated = false
      while (i < n) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            i += 2
            continue
          }
          i++
          terminated = true
          break
        }
        i++
      }
      push('string', start, i, { terminated })
      continue
    }
    if (ch === "'") {
      i++
      let terminated = false
      while (i < n) {
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            i += 2
            continue
          }
          i++
          terminated = true
          break
        }
        if (src[i] === '\n') break
        i++
      }
      push('table', start, i, { terminated })
      continue
    }
    if (ch === '[') {
      i++
      let terminated = false
      while (i < n) {
        if (src[i] === ']') {
          if (src[i + 1] === ']') {
            i += 2
            continue
          }
          i++
          terminated = true
          break
        }
        if (src[i] === '\n') break
        i++
      }
      push('column', start, i, { terminated })
      continue
    }
    if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1]))) {
      while (i < n && isDigit(src[i])) i++
      if (src[i] === '.') {
        i++
        while (i < n && isDigit(src[i])) i++
      }
      if ((src[i] === 'e' || src[i] === 'E') && (isDigit(src[i + 1]) || ((src[i + 1] === '+' || src[i + 1] === '-') && isDigit(src[i + 2])))) {
        i += 2
        while (i < n && isDigit(src[i])) i++
      }
      push('number', start, i)
      continue
    }
    if (isIdentStart(ch)) {
      while (i < n && isIdentPart(src[i])) i++
      push('ident', start, i)
      continue
    }
    const two = src.slice(i, i + 2)
    if (TWO_CHAR_OPS.includes(two)) {
      i += 2
      push('op', start, i)
      continue
    }
    if (ONE_CHAR_OPS.includes(ch)) {
      i++
      push('op', start, i)
      continue
    }
    i++
    if (ch === '(') push('lparen', start, i)
    else if (ch === ')') push('rparen', start, i)
    else if (ch === '{') push('lbrace', start, i)
    else if (ch === '}') push('rbrace', start, i)
    else if (ch === ',') push('comma', start, i)
    else push('error', start, i)
  }
  classifyIdents(out)
  return out
}

/** Next non-trivia token index after `i` (skips ws, newlines, comments). */
export function nextSignificant(tokens: DaxToken[], i: number): number {
  let j = i + 1
  while (j < tokens.length && isTrivia(tokens[j])) j++
  return j
}

export function isTrivia(t: DaxToken): boolean {
  return t.type === 'ws' || t.type === 'newline' || t.type === 'comment'
}

/** ident → function (followed by "("), keyword, or stays ident (table/variable). */
function classifyIdents(tokens: DaxToken[]): void {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type !== 'ident') continue
    const upper = t.text.toUpperCase()
    const next = tokens[nextSignificant(tokens, i)]
    if (next?.type === 'lparen' && upper !== 'IN' && upper !== 'NOT' && upper !== 'RETURN') t.type = 'function'
    else if (DAX_KEYWORD_SET.has(upper)) t.type = 'keyword'
    else if (DAX_ENUM_SET.has(upper) && next?.type !== 'column') t.type = 'keyword'
  }
}

/** Unquote a 'Table' or [Column] token text. */
export function unquoteRef(text: string): string {
  if (text.startsWith("'")) return text.slice(1, text.endsWith("'") && text.length > 1 ? -1 : undefined).replace(/''/g, "'")
  if (text.startsWith('[')) return text.slice(1, text.endsWith(']') && text.length > 1 ? -1 : undefined).replace(/]]/g, ']')
  return text
}

/** Quote a table name the way Power BI does: bare when it is a simple identifier, else 'quoted'. */
export function quoteTable(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !DAX_KEYWORD_SET.has(name.toUpperCase()) && !findDaxFunction(name) ? name : `'${name.replace(/'/g, "''")}'`
}

export function quoteColumn(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`
}

export interface CallContext {
  /** function name (upper-case as typed) */
  name: string
  /** 0-based index of the argument the cursor is in */
  argIndex: number
  /** offset of the "(" */
  openPos: number
}

/** Innermost function call enclosing `pos` (for parameter hints). */
export function callAt(src: string, pos: number): CallContext | null {
  const tokens = tokenizeDax(src.slice(0, pos))
  const stack: Array<{ name: string | null; argIndex: number; openPos: number }> = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'lparen' || t.type === 'lbrace') {
      let name: string | null = null
      if (t.type === 'lparen') {
        let j = i - 1
        while (j >= 0 && isTrivia(tokens[j])) j--
        if (j >= 0 && (tokens[j].type === 'function' || tokens[j].type === 'ident')) name = tokens[j].text
      }
      stack.push({ name, argIndex: 0, openPos: t.start })
    } else if (t.type === 'rparen' || t.type === 'rbrace') stack.pop()
    else if (t.type === 'comma' && stack.length) stack[stack.length - 1].argIndex++
  }
  for (let k = stack.length - 1; k >= 0; k--) {
    const s = stack[k]
    if (s.name) return { name: s.name.toUpperCase(), argIndex: s.argIndex, openPos: s.openPos }
  }
  return null
}
