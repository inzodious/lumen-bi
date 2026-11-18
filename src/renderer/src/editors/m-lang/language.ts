/**
 * CodeMirror 6 Power Query M language (stream tokenizer — no Lezer grammar) + the Advanced Editor's
 * highlight style.
 *
 * Colors follow Power BI Desktop's Advanced Editor (light): keywords blue #0000FF, strings #A31515,
 * comments green #008000, numbers #09885A; identifiers (library functions included) and
 * `#"quoted identifiers"` stay the default text color.
 *
 * Indentation: 4 spaces after `let` and inside ( [ {, plus one level of continuation after `=`,
 * operators, `each`, `then`, `else`, `=>`; `in` and closing brackets dedent to their opener's line.
 */
import { HighlightStyle, LanguageSupport, StreamLanguage, StringStream, syntaxHighlighting, type StreamParser } from '@codemirror/language'
import { Tag, tags as t } from '@lezer/highlight'

export const M_KEYWORDS = [
  'and',
  'as',
  'catch',
  'each',
  'else',
  'error',
  'false',
  'if',
  'in',
  'is',
  'let',
  'meta',
  'not',
  'null',
  'or',
  'otherwise',
  'section',
  'shared',
  'then',
  'true',
  'try',
  'type'
] as const

const KEYWORD_SET = new Set<string>(M_KEYWORDS)

/** `#date`, `#table`… (keyword-colored like PBI). */
export const M_INTRINSICS = ['#binary', '#date', '#datetime', '#datetimezone', '#duration', '#infinity', '#nan', '#sections', '#shared', '#table', '#time'] as const

export const mTags = {
  keyword: Tag.define(t.keyword),
  intrinsic: Tag.define(t.keyword),
  identifier: Tag.define(t.variableName),
  quoted: Tag.define(t.variableName)
}

type FrameKind = 'let' | 'in' | '(' | '[' | '{'

interface Frame {
  kind: FrameKind
  /** indentation of the line the frame opened on */
  indent: number
}

export interface MState {
  /** inside a block comment / string / quoted identifier that spans lines */
  inside: null | 'comment' | 'string' | 'quoted'
  stack: Frame[]
  /** the last significant token expects a continuation (`=`, operator, `each`, `then`…) */
  cont: boolean
  /** indentation of the current line (set at the line's first token) */
  lineIndent: number
}

const CONT_WORDS = new Set(['each', 'then', 'else', 'if', 'and', 'or', 'not', 'try', 'otherwise', 'as', 'is', 'meta', 'error', 'type'])

function readString(stream: StringStream, state: MState, kind: 'string' | 'quoted'): void {
  while (!stream.eol()) {
    const c = stream.next()
    if (c === '"') {
      if (stream.peek() === '"') stream.next()
      else {
        state.inside = null
        return
      }
    }
  }
  state.inside = kind
}

function popTo(state: MState, kinds: FrameKind[]): void {
  for (let i = state.stack.length - 1; i >= 0; i--) {
    if (kinds.includes(state.stack[i]!.kind)) {
      state.stack.length = i
      return
    }
  }
}

function tokenInner(stream: StringStream, state: MState): string | null {
  if (state.inside === 'comment') {
    if (stream.skipTo('*/')) {
      stream.pos += 2
      state.inside = null
    } else stream.skipToEnd()
    return 'comment'
  }
  if (state.inside === 'string' || state.inside === 'quoted') {
    const kind = state.inside
    readString(stream, state, kind)
    return kind === 'string' ? 'string' : 'mQuoted'
  }
  if (stream.sol()) state.lineIndent = stream.indentation()
  if (stream.eatSpace()) return null
  if (stream.match('//')) {
    stream.skipToEnd()
    return 'comment'
  }
  if (stream.match('/*')) {
    if (stream.skipTo('*/')) stream.pos += 2
    else {
      stream.skipToEnd()
      state.inside = 'comment'
    }
    return 'comment'
  }
  const ch = stream.peek()
  if (ch === '"') {
    stream.next()
    readString(stream, state, 'string')
    state.cont = false
    return 'string'
  }
  if (ch === '#') {
    if (stream.match('#"')) {
      readString(stream, state, 'quoted')
      state.cont = false
      return 'mQuoted'
    }
    if (stream.match(/^#[A-Za-z]+/)) {
      state.cont = false
      return 'mIntrinsic'
    }
    stream.next()
    return 'invalid'
  }
  if (stream.match(/^0[xX][0-9A-Fa-f]+/) || stream.match(/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/)) {
    state.cont = false
    return 'number'
  }
  if (stream.match(/^[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*/u)) {
    const word = stream.current()
    if (KEYWORD_SET.has(word)) {
      if (word === 'let') {
        state.stack.push({ kind: 'let', indent: state.lineIndent })
        state.cont = false
      } else if (word === 'in') {
        // `in` closes the nearest `let`; the body indents relative to it
        for (let i = state.stack.length - 1; i >= 0; i--) {
          const f = state.stack[i]!
          if (f.kind === 'let') {
            state.stack.length = i
            state.stack.push({ kind: 'in', indent: f.indent })
            break
          }
          if (f.kind !== 'in') break
        }
        state.cont = false
      } else state.cont = CONT_WORDS.has(word)
      return 'mKeyword'
    }
    state.cont = false
    return 'mIdentifier'
  }
  if (stream.match(/^(?:=>|\.\.\.|\.\.|<>|<=|>=|\?\?|[=<>+\-*/&?!@])/)) {
    state.cont = true
    return 'operator'
  }
  const c = stream.next()!
  if (c === '(' || c === '[' || c === '{') {
    state.stack.push({ kind: c, indent: state.lineIndent })
    state.cont = false
    return 'bracket'
  }
  if (c === ')' || c === ']' || c === '}') {
    const open = c === ')' ? '(' : c === ']' ? '[' : '{'
    popTo(state, [open])
    state.cont = false
    return 'bracket'
  }
  if (c === ',' || c === ';') {
    // a `let … in body` used as a list item / argument / binding ends at the comma
    while (state.stack.length && state.stack[state.stack.length - 1]!.kind === 'in') state.stack.pop()
    state.cont = false
    return 'punctuation'
  }
  return 'invalid'
}

/** Indentation (columns) of a line starting with `textAfter`, given the state at its start. */
export function indentFor(state: MState, textAfter: string, unit = 4): number {
  const after = textAfter.trimStart()
  const top = state.stack[state.stack.length - 1]
  if (!top) return state.cont && !/^in\b/.test(after) ? unit : 0
  const closer = /^[)\]}]/.exec(after)?.[0]
  if (closer) {
    const open = closer === ')' ? '(' : closer === ']' ? '[' : '{'
    for (let i = state.stack.length - 1; i >= 0; i--) if (state.stack[i]!.kind === open) return state.stack[i]!.indent
    return top.indent
  }
  if (/^in\b/.test(after)) {
    for (let i = state.stack.length - 1; i >= 0; i--) if (state.stack[i]!.kind === 'let') return state.stack[i]!.indent
    return top.indent
  }
  return top.indent + unit + (state.cont ? unit : 0)
}

export const mStreamParser: StreamParser<MState> = {
  name: 'powerquery-m',
  startState: () => ({ inside: null, stack: [], cont: false, lineIndent: 0 }),
  copyState: (s) => ({ inside: s.inside, stack: s.stack.map((f) => ({ ...f })), cont: s.cont, lineIndent: s.lineIndent }),
  token: tokenInner,
  indent(state, textAfter, cx) {
    if (state.inside === 'string' || state.inside === 'quoted') return null
    return indentFor(state, textAfter, cx.unit)
  },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['(', '[', '{', '"'] },
    indentOnInput: /^\s*(?:[)\]}]|in\s)$/
  },
  tokenTable: {
    mKeyword: mTags.keyword,
    mIntrinsic: mTags.intrinsic,
    mIdentifier: mTags.identifier,
    mQuoted: mTags.quoted
  }
}

export const mStreamLanguage = StreamLanguage.define(mStreamParser)

export const mHighlightStyle = HighlightStyle.define([
  { tag: mTags.keyword, color: '#0000FF' },
  { tag: mTags.intrinsic, color: '#0000FF' },
  { tag: t.string, color: '#A31515' },
  { tag: t.comment, color: '#008000' },
  { tag: t.number, color: '#09885A' },
  { tag: mTags.identifier, color: '#000000' },
  { tag: mTags.quoted, color: '#000000' },
  { tag: t.operator, color: '#000000' },
  { tag: t.invalid, color: '#C4314B' }
])

export function mLanguage(): LanguageSupport {
  return new LanguageSupport(mStreamLanguage, [syntaxHighlighting(mHighlightStyle)])
}

// ---------------------------------------------------------------------------------------------
// Pure helpers over the stream parser (tests, indentation queries without an editor)

export interface MToken {
  text: string
  style: string | null
  line: number
}

/** Runs the tokenizer over a whole text; returns the tokens and the state after the last line. */
export function tokenizeM(text: string, unit = 4): { tokens: MToken[]; state: MState } {
  const state = mStreamParser.startState!(unit)
  const tokens: MToken[] = []
  text.split('\n').forEach((line, li) => {
    const stream = new StringStream(line, 4, unit)
    if (!line.length) return
    while (!stream.eol()) {
      const style = mStreamParser.token(stream, state)
      if (stream.pos === stream.start) stream.next() // safety: always advance
      tokens.push({ text: stream.current(), style, line: li + 1 })
      stream.start = stream.pos
    }
  })
  return { tokens, state }
}

/** Indentation for a new line whose content will be `textAfter`, after `textBefore`. */
export function mIndentAfter(textBefore: string, textAfter = '', unit = 4): number {
  return indentFor(tokenizeM(textBefore, unit).state, textAfter, unit)
}
