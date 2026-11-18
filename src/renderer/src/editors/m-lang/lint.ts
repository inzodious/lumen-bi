/**
 * M syntax diagnostics from the engine's parser (the same check Power Query's Advanced Editor runs:
 * "No syntax errors have been detected." or the first syntax error, e.g. "Token Comma expected.").
 */
import type { Diagnostic } from '@codemirror/lint'
import type { EditorView } from '@codemirror/view'
import { parseExpression } from '@core/m/parser.ts'
import { MSyntaxError } from '@core/m/errors.ts'

export interface MSyntaxDiagnostic {
  message: string
  /** 1-based line / column in the checked text */
  line: number
  col: number
}

export interface MSyntaxOptions {
  /** the text is an expression body (formula bar `= …`, custom column): a leading `=` is ignored */
  expression?: boolean
}

/** Offset of the checked text inside the editor text (the stripped leading `=` and spaces). */
export function expressionOffset(text: string, opts: MSyntaxOptions = {}): number {
  if (!opts.expression) return 0
  const m = /^\s*=/.exec(text)
  return m ? m[0].length : 0
}

/** First syntax error of an M text, or null when it parses (empty text is an error, like PQ). */
export function mSyntaxCheck(text: string, opts: MSyntaxOptions = {}): MSyntaxDiagnostic | null {
  const off = expressionOffset(text, opts)
  const body = text.slice(off)
  if (!body.trim()) return { message: 'Token Literal expected.', line: 1, col: 1 }
  try {
    parseExpression(body)
    return null
  } catch (e) {
    if (e instanceof MSyntaxError) {
      // positions are relative to the body: map back to the full text when a prefix was stripped
      const prefixLines = text.slice(0, off).split('\n')
      const line = e.line + prefixLines.length - 1
      const col = e.line === 1 ? e.col + prefixLines[prefixLines.length - 1]!.length : e.col
      return { message: e.message, line, col }
    }
    return { message: e instanceof Error ? e.message : String(e), line: 1, col: 1 }
  }
}

/** Offset range of a diagnostic in a text: from its position to the end of the token there. */
export function diagnosticRange(text: string, d: MSyntaxDiagnostic): { from: number; to: number } {
  const lines = text.split('\n')
  const lineIdx = Math.min(Math.max(d.line, 1), lines.length) - 1
  let from = 0
  for (let i = 0; i < lineIdx; i++) from += lines[i]!.length + 1
  const lineText = lines[lineIdx] ?? ''
  const col = Math.min(Math.max(d.col - 1, 0), lineText.length)
  from += col
  const rest = lineText.slice(col)
  const tok = /^(?:"(?:[^"]|"")*"?|#?[\p{L}_][\p{L}\p{N}_.]*|\d+(?:\.\d+)?|\S)/u.exec(rest)
  let to = from + (tok ? tok[0].length : 0)
  if (to === from) {
    // at end of line / text: underline the previous character when possible
    if (from > 0) return { from: from - 1, to: from }
    to = Math.min(text.length, from + 1)
  }
  return { from, to }
}

/** CodeMirror lint source. */
export function mLintSource(opts: () => MSyntaxOptions & { onDiagnostics?(d: MSyntaxDiagnostic[]): void }) {
  return (view: EditorView): Diagnostic[] => {
    const text = view.state.doc.toString()
    const o = opts()
    if (!text.trim()) {
      o.onDiagnostics?.([])
      return []
    }
    const d = mSyntaxCheck(text, o)
    o.onDiagnostics?.(d ? [d] : [])
    if (!d) return []
    const { from, to } = diagnosticRange(text, d)
    return [{ from: Math.min(from, text.length), to: Math.min(to, text.length), severity: 'error', message: d.message }]
  }
}
