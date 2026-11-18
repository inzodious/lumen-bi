/**
 * CodeMirror 6 DAX language (stream tokenizer — no Lezer grammar) + Power BI–like highlight style.
 *
 * Colors follow the Power BI Desktop DAX editors (formula bar / DAX query view light theme):
 * functions & keywords blue, strings red-brown, comments green, numbers teal-green,
 * table references dark, column/measure references dark-blue.
 */
import { HighlightStyle, LanguageSupport, StreamLanguage, syntaxHighlighting, type StreamParser, type StringStream } from '@codemirror/language'
import { Tag, tags as t } from '@lezer/highlight'
import { DAX_ENUM_SET, DAX_KEYWORD_SET } from './tokenizer'

export const daxTags = {
  // Tag.define() cannot derive from a modified tag (t.function(...)) — it throws at import time
  function: Tag.define(t.variableName),
  keyword: Tag.define(t.keyword),
  table: Tag.define(t.typeName),
  column: Tag.define(t.propertyName),
  variable: Tag.define(t.variableName)
}

interface DaxState {
  /** inside a block comment / string / [column] / 'table' that spans lines */
  inside: null | 'comment' | 'string'
  depth: number
  /** last significant token opens a continuation (`=`, `RETURN`, operator) */
  continuation: boolean
  /** only name-like tokens so far (formula bar `Total Sales =` — that `=` doesn't indent the body) */
  onlyName: boolean
}

const daxParser: StreamParser<DaxState> = {
  name: 'dax',
  startState: () => ({ inside: null, depth: 0, continuation: false, onlyName: true }),
  copyState: (s) => ({ ...s }),
  token(stream, state) {
    const style = tokenInner(stream, state)
    if (style && style !== 'comment' && style !== 'daxVariable' && style !== 'daxTable' && style !== 'daxColumn' && !(style === 'operator' && stream.current() === '=')) state.onlyName = false
    if (style === 'operator' && stream.current() === '=') {
      if (state.onlyName && state.depth === 0) state.continuation = false
      state.onlyName = false
    }
    return style
  },
  indent(state, textAfter, cx) {
    const closing = /^\s*[)}]/.test(textAfter)
    // RETURN / VAR align with the enclosing block (DAX Formatter layout)
    const blockKw = /^\s*(RETURN|VAR)\b/i.test(textAfter)
    let level = state.depth - (closing ? 1 : 0)
    if (state.continuation && !closing && !blockKw) level++
    return Math.max(0, level) * cx.unit
  },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['(', '[', '{', '"', "'"] },
    indentOnInput: /^\s*([)}]|RETURN|VAR )$/i
  },
  tokenTable: {
    daxFunction: daxTags.function,
    daxKeyword: daxTags.keyword,
    daxTable: daxTags.table,
    daxColumn: daxTags.column,
    daxVariable: daxTags.variable
  }
}

function tokenInner(stream: StringStream, state: DaxState): string | null {
    // formula bar `Name = expression`: the name is plain text (no keyword/function colouring)
    if (state.onlyName && state.depth === 0 && !state.inside && !stream.string.slice(0, stream.pos).includes('=') && /^[^=()"[\]\n]*?=(?!=)/.test(stream.string.slice(stream.pos)) && !/^\s*(VAR|TABLE|DEFINE|EVALUATE)\s/i.test(stream.string)) {
      if (stream.eatSpace()) return null
      if (stream.peek() === '=') {
        stream.next()
        return 'operator'
      }
      stream.match(/^[^=\s]+/)
      return 'daxVariable'
    }
    if (state.inside === 'comment') {
      if (stream.skipTo('*/')) {
        stream.pos += 2
        state.inside = null
      } else stream.skipToEnd()
      return 'comment'
    }
    if (state.inside === 'string') {
      while (!stream.eol()) {
        const ch = stream.next()
        if (ch === '"') {
          if (stream.peek() === '"') stream.next()
          else {
            state.inside = null
            break
          }
        }
      }
      return 'string'
    }
    if (stream.eatSpace()) return null
    if (stream.match('//') || stream.match('--')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match('/*')) {
      state.inside = 'comment'
      if (stream.skipTo('*/')) {
        stream.pos += 2
        state.inside = null
      } else stream.skipToEnd()
      return 'comment'
    }
    const ch = stream.peek()
    if (ch === '"') {
      stream.next()
      state.inside = 'string'
      while (!stream.eol()) {
        const c = stream.next()
        if (c === '"') {
          if (stream.peek() === '"') stream.next()
          else {
            state.inside = null
            break
          }
        }
      }
      state.continuation = false
      return 'string'
    }
    if (ch === "'") {
      stream.match(/^'(?:[^']|'')*'?/)
      state.continuation = false
      return 'daxTable'
    }
    if (ch === '[') {
      stream.match(/^\[(?:[^\]]|]])*]?/)
      state.continuation = false
      return 'daxColumn'
    }
    if (stream.match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/)) {
      state.continuation = false
      return 'number'
    }
    if (stream.match(/^[\p{L}_][\p{L}\p{N}_.]*/u)) {
      const word = stream.current()
      const upper = word.toUpperCase()
      const followedByParen = /^\s*\(/.test(stream.string.slice(stream.pos))
      const followedByColumn = /^\s*\[/.test(stream.string.slice(stream.pos))
      state.continuation = upper === 'RETURN' || upper === 'EVALUATE' || upper === 'DEFINE'
      if (followedByParen && upper !== 'IN' && upper !== 'NOT') return 'daxFunction'
      if (DAX_KEYWORD_SET.has(upper)) return 'daxKeyword'
      if (DAX_ENUM_SET.has(upper) && !followedByColumn) return 'daxKeyword'
      return followedByColumn ? 'daxTable' : 'daxVariable'
    }
    if (stream.match(/^(?:&&|\|\||==|<=|>=|<>|[=<>+\-*/^&])/)) {
      state.continuation = true
      return 'operator'
    }
    const c = stream.next()
    if (c === '(' || c === '{') {
      state.depth++
      state.continuation = false
      return 'bracket'
    }
    if (c === ')' || c === '}') {
      state.depth = Math.max(0, state.depth - 1)
      state.continuation = false
      return 'bracket'
    }
    if (c === ',') {
      state.continuation = false
      return 'punctuation'
    }
    return 'invalid'
}

export const daxLanguage = StreamLanguage.define(daxParser)

export const daxHighlightStyle = HighlightStyle.define([
  { tag: daxTags.function, color: '#035ACA' },
  { tag: daxTags.keyword, color: '#035ACA', fontWeight: '600' },
  { tag: t.string, color: '#A31515' },
  { tag: t.comment, color: '#008000' },
  { tag: t.number, color: '#098658' },
  { tag: daxTags.table, color: '#252423' },
  { tag: daxTags.column, color: '#001080' },
  { tag: daxTags.variable, color: '#252423' },
  { tag: t.operator, color: '#252423' },
  { tag: t.invalid, color: '#C4314B' }
])

export function dax(): LanguageSupport {
  return new LanguageSupport(daxLanguage, [syntaxHighlighting(daxHighlightStyle)])
}
