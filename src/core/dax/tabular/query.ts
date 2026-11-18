/** DAX queries: DEFINE ( MEASURE | VAR | TABLE | COLUMN )* EVALUATE <table> [ORDER BY ...] [START AT ...] ... */
import type { DataType } from '../../model/types.ts'
import { DaxError } from './errors.ts'
import { Evaluator } from './evaluator.ts'
import { FilterContext } from './filters.ts'
import type { Col, DaxModel, Measure } from './model.ts'
import { parseQuery, type DaxQuery, type EvaluateStatement, type FunctionDefinition } from './parser.ts'
import { computeColumn } from './process.ts'
import { FUNCTIONS, type EvalOptions, type Scope } from './registry.ts'
import { isTable, type TableValue, type TCol } from './table.ts'
import { cleanScalar, inferDataType, sortCompare, type Scalar } from './values.ts'
import { visualShapeTable } from './visualcalc.ts'

export interface QueryColumn {
  /** as DAX query view shows it: Table[Column] for model columns, [Name] for named columns */
  name: string
  dataType: DataType
  formatString?: string
}

export interface QueryTable {
  columns: QueryColumn[]
  rows: Scalar[][]
}

export function resultColumnName(c: TCol): string {
  return c.lineage && !c.alias ? `${c.lineage.table.name}[${c.lineage.name}]` : `[${c.name}]`
}

function orderedRows(ev: Evaluator, ctx: FilterContext, t: TableValue, st: EvaluateStatement): number[] {
  const order = Array.from({ length: t.n }, (_, i) => i)
  if (st.orderBy.length === 0) return order
  const root = ev.rootEnv(ctx)
  const getters = st.orderBy.map((o) => {
    const e = o.expr
    if (e.kind === 'column') {
      const idx = e.table === null ? t.indexOfName(e.name) : (() => {
        const c = ev.tryColumn(e)
        return c ? t.indexOfLineage(c) : t.indexOfName(e.name)
      })()
      if (idx >= 0) return (i: number) => t.get(i, idx)
    }
    return (i: number) => ev.scalar(e, ev.withRow(root, t, i))
  })
  const keys = order.map((i) => getters.map((g) => g(i)))
  const cmp = (a: Scalar[], b: Scalar[], n = a.length) => {
    for (let k = 0; k < n; k++) {
      const c = sortCompare(a[k], b[k])
      if (c !== 0) return st.orderBy[k].desc ? -c : c
    }
    return 0
  }
  order.sort((x, y) => cmp(keys[x], keys[y]) || x - y)
  if (!st.startAt) return order
  const start = st.startAt.map((n) => ev.scalar(n, root))
  const first = order.findIndex((i) => cmp(keys[i], start, start.length) >= 0)
  return first < 0 ? [] : order.slice(first)
}

export function runQuery(model: DaxModel, text: string | DaxQuery, options: EvalOptions = {}): QueryTable[] {
  const q = typeof text === 'string' ? parseQuery(text) : text
  // DEFINE FUNCTION: visible to every definition and EVALUATE of the query (incl. DEFINE COLUMN evaluators)
  const queryFunctions = new Map<string, FunctionDefinition>()
  for (const d of q.definitions) {
    if (d.kind !== 'function') continue
    if (FUNCTIONS.has(d.name.toUpperCase())) throw new DaxError('QUERY', `The function name ${d.name} is a DAX function name; user-defined functions cannot reuse it.`)
    queryFunctions.set(d.name.toLowerCase(), d.fn)
  }
  const opts: EvalOptions = queryFunctions.size ? { ...options, functions: new Map([...(options.functions ?? []), ...queryFunctions]) } : options
  const ev = new Evaluator(model, opts)
  const ctx = new FilterContext(model)
  const scope: Scope = { vars: new Map(), parent: null }
  ev.queryScope = scope
  const tempCols: Col[] = []
  // COLUMN definitions on a TABLE ... WITH VISUAL SHAPE are its visual calculations (in definition order)
  const shapeTables = new Set(q.definitions.filter((d) => d.kind === 'table' && d.shape).map((d) => d.name.toLowerCase()))
  const shapeCalcs = new Map<string, Array<{ name: string; ast: import('./parser.ts').Node }>>()
  for (const d of q.definitions) {
    if (d.kind !== 'column' || !shapeTables.has(d.table.toLowerCase())) continue
    const list = shapeCalcs.get(d.table.toLowerCase()) ?? []
    list.push({ name: d.name, ast: d.expr })
    shapeCalcs.set(d.table.toLowerCase(), list)
  }
  try {
    for (const d of q.definitions) {
      if (d.kind === 'measure') {
        const t = model.findTable(d.table)
        if (!t) throw new DaxError('REF', `Cannot find table '${d.table}' for the query measure [${d.name}].`)
        const existing = model.measure(d.name)
        const m: Measure = { name: existing?.name ?? d.name, table: t, expression: '', ast: d.expr, formatString: existing?.formatString, formatExpression: existing?.formatExpression }
        ev.queryMeasures.set(d.name.toLowerCase(), m)
      } else if (d.kind === 'var') {
        scope.vars.set(d.name.toLowerCase(), { node: d.expr, env: { ...ev.rootEnv(ctx), scope: { vars: new Map(scope.vars), parent: null } } })
      } else if (d.kind === 'table') {
        const v = ev.value(d.expr, ev.rootEnv(ctx))
        if (!isTable(v)) throw new DaxError('QUERY', `DEFINE TABLE ${d.name} must be a table expression.`)
        const shaped = d.shape ? visualShapeTable(v, d.shape, shapeCalcs.get(d.name.toLowerCase()) ?? [], (m) => new Evaluator(m, { ...opts, functionSource: model })) : v
        ev.queryTables.set(d.name.toLowerCase(), shaped)
      } else if (d.kind === 'column' && shapeTables.has(d.table.toLowerCase())) {
        // evaluated with its visual shape table
      } else if (d.kind === 'function') {
        // registered before the loop
      } else {
        const t = model.findTable(d.table)
        if (!t) throw new DaxError('REF', `Cannot find table '${d.table}' for the query column [${d.name}].`)
        if (t.column(d.name)) throw new DaxError('QUERY', `The column '${d.table}'[${d.name}] already exists.`)
        const col = t.addColumn(d.name, 'unknown', 'calculated')
        col.expression = text && typeof text === 'string' ? text.slice(d.expr.s, d.expr.e) : ''
        tempCols.push(col)
        model.invalidateCaches()
        computeColumn(model, col, opts)
        model.invalidateCaches()
      }
    }
    return q.evaluates.map((st) => {
      const v = ev.value(st.expr, ev.rootEnv(ctx))
      if (!isTable(v)) throw new DaxError('QUERY', 'The expression specified in the query is not a valid table expression. To see a single value, wrap it in braces: EVALUATE { <expression> }.')
      const order = orderedRows(ev, ctx, v, st)
      const rows = order.map((i) => v.row(i).map(cleanScalar))
      return {
        columns: v.cols.map((c, j) => ({
          name: resultColumnName(c),
          dataType: c.dataType && c.dataType !== 'unknown' ? c.dataType : inferDataType(rows.map((r) => r[j])),
          formatString: c.formatString ?? c.lineage?.formatString
        })),
        rows
      }
    })
  } finally {
    if (tempCols.length) {
      for (const c of tempCols) c.table.removeColumn(c)
      model.invalidateCaches()
    }
  }
}
