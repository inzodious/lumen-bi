/** Formula-bar validation: syntax errors and unresolved names / unknown functions with source offsets. */
import type { ExpressionDiagnostic } from './api'
import { DaxError } from '../dax/tabular/errors'
import type { DaxModel } from '../dax/tabular/model'
import { parseExpression, type Node } from '../dax/tabular/parser'
import { FN_META, FUNCTIONS } from '../dax/tabular/registry'
import '../dax/tabular/evaluator'

/** Identifiers that are keywords inside specific function calls. */
const KEYWORDS = new Set([
  'ASC', 'DESC', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR', 'HOUR', 'MINUTE', 'SECOND', 'NONE', 'BOTH', 'ONEWAY', 'ONEWAY_LEFTFILTERSRIGHT',
  'ONEWAY_RIGHTFILTERSLEFT', 'SKIP', 'DENSE', 'INTEGER', 'DOUBLE', 'STRING', 'BOOLEAN', 'CURRENCY', 'DATETIME', 'DATE', 'TIME', 'ABS', 'REL',
  'FIRST', 'LAST', 'DEFAULT', 'KEEP', 'BLANKS', '__MISSING__', 'TRUE', 'FALSE', 'INT64', 'DECIMAL'
])

export function validateDax(dm: DaxModel, expression: string, context: { kind: 'measure' | 'calculatedColumn' | 'calculatedTable'; table?: string }): ExpressionDiagnostic[] {
  const out: ExpressionDiagnostic[] = []
  let ast: Node
  try {
    ast = parseExpression(expression)
  } catch (e) {
    const err = e as DaxError
    out.push({ message: err.message, start: err.start, end: err.end, severity: 'error' })
    return out
  }
  const home = context.table ? dm.findTable(context.table) : undefined
  // column names introduced by the expression itself (ADDCOLUMNS/SELECTCOLUMNS/ROW/... names, table constructors)
  const local = new Set<string>(['value', 'date'])
  const collect = (n: Node): void => {
    if (n.kind === 'string') local.add(n.value.toLowerCase())
    else if (n.kind === 'tableCtor') (n.rows[0] ?? []).forEach((_, i) => local.add(`value${i + 1}`))
    if (n.kind === 'call') n.args.forEach(collect)
    else if (n.kind === 'binary') {
      collect(n.left)
      collect(n.right)
    } else if (n.kind === 'unary') collect(n.operand)
    else if (n.kind === 'var') {
      n.decls.forEach((d) => collect(d.expr))
      collect(n.body)
    } else if (n.kind === 'tableCtor') n.rows.forEach((r) => r.forEach(collect))
    else if (n.kind === 'tuple') n.items.forEach(collect)
  }
  collect(ast)
  const scopes: Array<Set<string>> = []
  const isVar = (n: string) => scopes.some((s) => s.has(n.toLowerCase()))
  const visit = (n: Node): void => {
    switch (n.kind) {
      case 'call': {
        const fn = n.name.toUpperCase()
        if (!FUNCTIONS.has(fn) && !dm.functions.has(n.name.toLowerCase())) out.push({ message: `The function '${fn}' is not supported (unknown DAX function).`, start: n.s, end: n.s + n.name.length, severity: 'error' })
        else {
          const meta = FN_META.get(fn)
          const argc = n.args.length
          if (meta && ((meta.min !== undefined && argc < meta.min) || (meta.max !== undefined && argc > meta.max)))
            out.push({ message: `Wrong number of arguments for ${fn}: ${argc}.`, start: n.s, end: n.e, severity: 'error' })
        }
        n.args.forEach(visit)
        return
      }
      case 'column': {
        if (n.table) {
          if (isVar(n.table)) return
          const t = dm.findTable(n.table)
          if (!t) {
            out.push({ message: `Cannot find table '${n.table}'.`, start: n.s, end: n.e, severity: 'error' })
            return
          }
          if (!t.column(n.name) && !dm.measure(n.name))
            out.push({ message: `Column '${n.name}' in table '${n.table}' cannot be found or may not be used in this expression.`, start: n.s, end: n.e, severity: 'error' })
          return
        }
        if (dm.measure(n.name)) return
        if (home?.column(n.name)) return
        if (local.has(n.name.toLowerCase())) return
        if (dm.tables.some((t) => t.column(n.name))) {
          if (context.kind === 'measure')
            out.push({ message: `[${n.name}] is not a measure; reference the column with its table name (Table[${n.name}]) unless it is a column of an iterated table.`, start: n.s, end: n.e, severity: 'warning' })
          return
        }
        out.push({ message: `The column or measure [${n.name}] cannot be found.`, start: n.s, end: n.e, severity: 'error' })
        return
      }
      case 'ident': {
        if (isVar(n.name) || dm.findTable(n.name) || KEYWORDS.has(n.name.toUpperCase())) return
        out.push({ message: `Failed to resolve name '${n.name}'. It is not a valid table, variable, or function name.`, start: n.s, end: n.e, severity: 'error' })
        return
      }
      case 'binary':
        visit(n.left)
        visit(n.right)
        return
      case 'unary':
        visit(n.operand)
        return
      case 'var': {
        const scope = new Set<string>()
        scopes.push(scope)
        for (const d of n.decls) {
          visit(d.expr)
          scope.add(d.name.toLowerCase())
        }
        visit(n.body)
        scopes.pop()
        return
      }
      case 'tableCtor':
        n.rows.forEach((r) => r.forEach(visit))
        return
      case 'tuple':
        n.items.forEach(visit)
        return
      default:
        return
    }
  }
  visit(ast)
  // calculated tables must return tables; measures/columns scalars (cheap static check)
  return out
}
