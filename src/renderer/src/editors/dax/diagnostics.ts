/**
 * Local (engine-free) DAX diagnostics: unterminated literals, unbalanced brackets, unknown
 * functions and unknown 'Table'[Column] references. Merged with `engine.validateExpression`
 * results in the editors; used alone when no engine is available.
 */
import type { ExpressionDiagnostic } from '@core/engine/api'
import { DAX_FUNCTIONS, findDaxFunction } from './functions'
import { quotedTable, suggestNames } from './intellisense'

/** A diagnostic with optional quick-fix replacements for its range ("did you mean …"). */
export type DaxDiagnostic = ExpressionDiagnostic & { fixes?: string[] }
import type { DaxSchema } from './schema'
import { isTrivia, quoteColumn, tokenizeDax, unquoteRef, type DaxToken } from './tokenizer'

export function localDaxDiagnostics(text: string, schema?: DaxSchema): DaxDiagnostic[] {
  const out: DaxDiagnostic[] = []
  const tokens = tokenizeDax(text)
  const stack: DaxToken[] = []
  const definedTables = new Set<string>()
  /** `table|column` keys defined by DEFINE MEASURE T[x] / COLUMN T[x] in queries */
  const definedFields = new Set<string>()
  // names defined by DEFINE TABLE x = ... in queries
  const sig = tokens.filter((t) => !isTrivia(t))
  for (let i = 0; i < sig.length - 1; i++) {
    const kw = sig[i].type === 'keyword' ? sig[i].text.toUpperCase() : ''
    if (kw === 'TABLE' && (sig[i + 1].type === 'ident' || sig[i + 1].type === 'table')) definedTables.add(unquoteRef(sig[i + 1].text).toLowerCase())
    if ((kw === 'MEASURE' || kw === 'COLUMN') && (sig[i + 1].type === 'ident' || sig[i + 1].type === 'table') && sig[i + 2]?.type === 'column') {
      definedFields.add(`${unquoteRef(sig[i + 1].text).toLowerCase()}|${unquoteRef(sig[i + 2].text).toLowerCase()}`)
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    switch (t.type) {
      case 'string':
        if (!t.terminated) out.push({ message: 'The string is missing a closing quotation mark (").', start: t.start, end: t.end, severity: 'error' })
        break
      case 'column':
        if (!t.terminated) out.push({ message: "The column reference is missing a closing bracket (']').", start: t.start, end: t.end, severity: 'error' })
        break
      case 'table':
        if (!t.terminated) out.push({ message: "The table name is missing a closing quotation mark (').", start: t.start, end: t.end, severity: 'error' })
        break
      case 'comment':
        if (t.terminated === false) out.push({ message: "The comment is missing a closing '*/'.", start: t.start, end: t.end, severity: 'error' })
        break
      case 'error':
        out.push({ message: `The syntax for '${t.text}' is incorrect.`, start: t.start, end: t.end, severity: 'error' })
        break
      case 'lparen':
      case 'lbrace':
        stack.push(t)
        break
      case 'rparen':
      case 'rbrace': {
        const open = stack.pop()
        const want = t.type === 'rparen' ? 'lparen' : 'lbrace'
        if (!open) out.push({ message: `The syntax for '${t.text}' is incorrect: there is no matching opening bracket.`, start: t.start, end: t.end, severity: 'error' })
        else if (open.type !== want) out.push({ message: `The syntax for '${t.text}' is incorrect: '${open.text}' is not closed.`, start: t.start, end: t.end, severity: 'error' })
        break
      }
      case 'function':
        if (!findDaxFunction(t.text)) {
          const fixes = suggestNames(t.text.toUpperCase(), DAX_FUNCTIONS.map((f) => f.name))
          out.push({ message: `Failed to resolve name '${t.text}'. It is not a valid table, variable, or function name.${fixes.length ? ` Did you mean ${fixes[0]}?` : ''}`, start: t.start, end: t.end, severity: 'error', fixes })
        }
        break
      default:
        break
    }
  }
  for (const open of stack) out.push({ message: `'${open.text}' is not closed.`, start: open.start, end: open.end, severity: 'error' })

  if (schema && schema.tables.length) {
    for (let i = 0; i < tokens.length - 1; i++) {
      const t = tokens[i]
      const next = tokens[i + 1]
      if ((t.type === 'table' || t.type === 'ident') && t.terminated !== false && next.type === 'column' && next.terminated) {
        const tableName = unquoteRef(t.text)
        if (definedTables.has(tableName.toLowerCase())) continue
        const table = schema.tables.find((x) => x.name.toLowerCase() === tableName.toLowerCase())
        if (!table) {
          const fixes = suggestNames(tableName, schema.tables.map((x) => x.name)).map(quotedTable)
          out.push({ message: `Cannot find table '${tableName}'.${fixes.length ? ` Did you mean ${fixes[0]}?` : ''}`, start: t.start, end: t.end, severity: 'error', fixes })
          continue
        }
        const col = unquoteRef(next.text).toLowerCase()
        if (definedFields.has(`${table.name.toLowerCase()}|${col}`)) continue
        if (!table.columns.some((c) => c.name.toLowerCase() === col) && !table.measures.some((m) => m.name.toLowerCase() === col)) {
          const fixes = suggestNames(unquoteRef(next.text), [...table.columns.map((c) => c.name), ...table.measures.map((m) => m.name)]).map(quoteColumn)
          out.push({ message: `Column '${unquoteRef(next.text)}' in table '${table.name}' cannot be found or may not be used in this expression.${fixes.length ? ` Did you mean ${fixes[0]}?` : ''}`, start: next.start, end: next.end, severity: 'error', fixes })
        }
      }
    }
  }
  return out
}

/** Merge engine and local diagnostics, dropping engine duplicates at the same range. */
export function mergeDiagnostics(a: DaxDiagnostic[], b: DaxDiagnostic[]): DaxDiagnostic[] {
  const seen = new Set(a.map((d) => `${d.start}:${d.end}`))
  return [...a, ...b.filter((d) => !seen.has(`${d.start}:${d.end}`))]
}
