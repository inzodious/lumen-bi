/** Table functions: FILTER, ALL*, VALUES, ADDCOLUMNS, SUMMARIZE(COLUMNS), GROUPBY, TOPN, set operations, joins, generators. */
import type { DataType } from '../../model/types.ts'
import { DaxError } from './errors.ts'
import type { Evaluator } from './evaluator.ts'
import { colFilter, eqFilter, rowsFilter, type FilterContext, type Filter } from './filters.ts'
import type { Col, Measure, Tbl } from './model.ts'
import { parseExpression, type Node } from './parser.ts'
import { defineFn, FN_META, type Env, type Val } from './registry.ts'
import { filterRows, rowFn } from './compile.ts'
import { fuse, simpleAggOf, type CellInvariance, type Fused, type SimpleAgg } from './fusion.ts'
import { TableValue, type ColData, type TCol } from './table.ts'
import {
  coerceTo,
  dayNumber,
  fromDayNumber,
  inferDataType,
  makeDate,
  MS_PER_DAY,
  sortCompare,
  toBool,
  toDate,
  toNumber,
  toText,
  tupleKey,
  type Scalar
} from './values.ts'

const missing = (n: Node | undefined) => !n || (n.kind === 'ident' && n.name === '__missing__')

// ------------------------------------------------------------------------------------------------
// helpers shared with the engine adapter
// ------------------------------------------------------------------------------------------------

/** Rows of `t` visible in `ctx` (helper) */
function allRowsOf(t: Tbl, blankRow: boolean): Int32Array {
  const ids = t.all()
  return blankRow || !t.hasBlankRow ? ids : ids.subarray(0, t.rowCount)
}

function distinctColumns(cols: Col[], ids: ArrayLike<number>): TableValue {
  if (cols.length === 1) {
    const c = cols[0]
    const seen = new Uint8Array(c.dict.length)
    const vals: Scalar[] = []
    for (let i = 0; i < ids.length; i++) {
      const code = c.codes[ids[i]]
      if (!seen[code]) {
        seen[code] = 1
        vals.push(c.dict[code])
      }
    }
    return new TableValue([{ name: c.name, lineage: c, dataType: c.dataType }], [vals], vals.length)
  }
  const seen = new Set<string>()
  const data: Scalar[][] = cols.map(() => [])
  for (let i = 0; i < ids.length; i++) {
    const r = ids[i]
    let k = ''
    for (const c of cols) k += c.codes[r] + ','
    if (seen.has(k)) continue
    seen.add(k)
    cols.forEach((c, j) => data[j].push(c.dict[c.codes[r]]))
  }
  return new TableValue(
    cols.map((c) => ({ name: c.name, lineage: c, dataType: c.dataType })),
    data,
    data[0].length
  )
}

function sameTable(cols: Col[], fn: string): Tbl {
  const t = cols[0].table
  if (cols.some((c) => c.table !== t)) throw new DaxError('ARG', `All column arguments of ${fn} must come from the same table.`)
  return t
}

function allTable(ev: Evaluator, a: Node[], env: Env, fn: string, blankRow: boolean): TableValue {
  if (a.length === 0) throw new DaxError('ARG', `${fn} ( ) with no arguments can only be used as a CALCULATE filter argument. Use REMOVEFILTERS ( ) there.`)
  if (a.length === 1 && a[0].kind === 'ident') {
    const v = ev.lookupVar(a[0].name, env)
    if (v !== undefined && v !== null && typeof v === 'object' && 'kind' in v) return v as TableValue
    const t = ev.model.findTable(a[0].name)
    if (!t) throw new DaxError('REF', `${fn} expects a table or column reference, and '${a[0].name}' is not a table.`, a[0])
    return TableValue.fromBase(t, allRowsOf(t, blankRow))
  }
  if (a.length === 1 && a[0].kind !== 'column') {
    // ALL over a table expression: its distinct rows
    return ev.table(a[0], env, fn).distinct()
  }
  const cols = a.map((x) => ev.resolveColumn(x, fn))
  const t = sameTable(cols, fn)
  return distinctColumns(cols, allRowsOf(t, blankRow))
}

defineFn('ALL', (ev, a, env) => allTable(ev, a, env, 'ALL', true), { table: true, context: true })
defineFn('ALLNOBLANKROW', (ev, a, env) => allTable(ev, a, env, 'ALLNOBLANKROW', false), { table: true, context: true })
defineFn(
  'ALLSELECTED',
  (ev, a, env) => {
    if (a.length === 0) throw new DaxError('ARG', 'ALLSELECTED ( ) without arguments can only be used as a CALCULATE filter argument.')
    const target = ev.tableTarget(a, 'ALLSELECTED', env)
    const ctx = ev.allSelected(ev.transition(env), target, env.shadows)
    if (a.length === 1 && a[0].kind === 'ident') {
      const t = ev.model.findTable(a[0].name)!
      return TableValue.fromBase(t, ctx.visible(t))
    }
    const cols = a.map((x) => ev.resolveColumn(x, 'ALLSELECTED'))
    return distinctColumns(cols, ctx.visible(sameTable(cols, 'ALLSELECTED')))
  },
  { table: true, context: true }
)
defineFn(
  ['ALLEXCEPT', 'ALLCROSSFILTERED'],
  (ev, a, env, node) => {
    const ctx = ev.calculateContext([node], env)
    const t = a[0].kind === 'ident' ? ev.model.findTable(a[0].name) : null
    if (!t) throw new DaxError('ARG', `${node.name.toUpperCase()} expects a table as its first argument.`)
    return TableValue.fromBase(t, ctx.visible(t))
  },
  { table: true, context: true }
)
defineFn('REMOVEFILTERS', () => {
  throw new DaxError('ARG', 'REMOVEFILTERS can only be used as a filter argument of CALCULATE or CALCULATETABLE.')
}, { table: true })
defineFn(['USERELATIONSHIP', 'CROSSFILTER'], (_ev, _a, _env, node) => {
  throw new DaxError('ARG', `${node.name.toUpperCase()} can only be used as a filter argument of CALCULATE or CALCULATETABLE.`)
}, { table: true })
defineFn(['KEEPFILTERS', 'NONVISUAL'], (ev, a, env) => ev.value(a[0], env), { table: true, min: 1, max: 1 })
defineFn('IGNORE', (ev, a, env) => ev.value(a[0], env), { min: 1, max: 1 })

defineFn(
  ['VALUES', 'DISTINCT'],
  (ev, a, env, node) => {
    const fn = node.name.toUpperCase()
    const arg = a[0]
    const col = arg.kind === 'column' && !ev.measureFor(arg) ? ev.tryColumn(arg) : null
    if (col) return ev.valuesOf(col, env.ctx, fn === 'VALUES')
    if (arg.kind === 'ident' && !ev.lookupVar(arg.name, env) && !ev.queryTables.has(arg.name.toLowerCase())) {
      const t = ev.model.findTable(arg.name)
      if (t) {
        const vis = env.ctx.visible(t)
        return TableValue.fromBase(t, fn === 'VALUES' ? vis : vis.filter((r) => r < t.rowCount))
      }
    }
    return ev.table(arg, env, fn).distinct()
  },
  { table: true, min: 1, max: 1, context: true }
)

defineFn(
  'FILTER',
  (ev, a, env) => {
    const t = ev.table(a[0], env, 'FILTER')
    const keep = filterRows(ev, a[1], t, env)
    return keep.length === t.n ? t : t.select(keep)
  },
  { table: true, min: 2, max: 2, context: true }
)

defineFn(
  'CALCULATETABLE',
  (ev, a, env) => {
    const ctx = ev.calculateContext(a.slice(1), env)
    return ev.table(a[0], { ...env, ctx, transitioned: env.rows.length }, 'CALCULATETABLE')
  },
  { table: true, min: 1, context: true }
)
defineFn(
  'RELATEDTABLE',
  (ev, a, env) => {
    const ctx = ev.transition(env)
    return ev.table(a[0], { ...env, ctx, transitioned: env.rows.length }, 'RELATEDTABLE')
  },
  { table: true, min: 1, max: 1, context: true }
)

// ------------------------------------------------------------------------------------------------
// column-shaping
// ------------------------------------------------------------------------------------------------

function newName(fn: string, name: string, cols: TCol[]): void {
  if (cols.some((c) => c.name.toLowerCase() === name.toLowerCase() && (c.alias || !c.lineage)))
    throw new DaxError('ARG', `Function '${fn}' cannot add column [${name}] since it already exists.`)
}

export function namedPairs(ev: Evaluator, fn: string, a: Node[], start: number, existing: TCol[]): Array<{ col: TCol; expr: Node }> {
  const out: Array<{ col: TCol; expr: Node }> = []
  for (let i = start; i < a.length; i += 2) {
    const n = a[i]
    if (n.kind !== 'string') throw new DaxError('ARG', `Function '${fn}' expects a column name in double quotes as argument number ${i + 1}.`, n)
    const expr = a[i + 1]
    if (!expr) throw new DaxError('ARG', `Function '${fn}' needs an expression after the column name "${n.value}".`, n)
    newName(fn, n.value, [...existing, ...out.map((o) => o.col)])
    const m = expr.kind === 'column' ? ev.measureFor(expr) : null
    const lineage = expr.kind === 'column' && !m ? ev.tryColumn(expr) : null
    out.push({ col: { name: n.value, lineage, alias: true, dataType: lineage?.dataType ?? ev.staticType(expr), formatString: m?.formatString ?? lineage?.formatString }, expr })
  }
  return out
}

function evalColumns(ev: Evaluator, t: TableValue, env: Env, exprs: Node[]): Scalar[][] {
  const out: Scalar[][] = exprs.map(() => new Array(t.n))
  const fs = exprs.map((e) => rowFn(ev, e, t, env))
  for (let i = 0; i < t.n; i++) for (let j = 0; j < fs.length; j++) out[j][i] = fs[j](i)
  return out
}

function fixTypes(cols: TCol[], values: Scalar[][]): void {
  cols.forEach((c, j) => {
    if (!c.dataType || c.dataType === 'unknown') {
      const t = inferDataType(values[j])
      if (t !== 'unknown') c.dataType = t
    }
  })
}

defineFn(
  'ADDCOLUMNS',
  (ev, a, env) => {
    if (a.length < 3 || a.length % 2 === 0) throw new DaxError('ARG', 'ADDCOLUMNS takes a table, then pairs of a column name in double quotes and an expression.')
    const t = ev.table(a[0], env, 'ADDCOLUMNS')
    const pairs = namedPairs(ev, 'ADDCOLUMNS', a, 1, t.cols)
    const values = evalColumns(ev, t, env, pairs.map((p) => p.expr))
    const cols = pairs.map((p) => ({ ...p.col }))
    fixTypes(cols, values)
    return t.extend(cols, values)
  },
  { table: true, context: true }
)

defineFn(
  'SELECTCOLUMNS',
  (ev, a, env) => {
    const t = ev.table(a[0], env, 'SELECTCOLUMNS')
    const items: Array<{ col: TCol; expr: Node }> = []
    for (let i = 1; i < a.length; ) {
      const n = a[i]
      if (n.kind !== 'string') {
        // bare column reference keeps its name and lineage
        const c = n.kind === 'column' && !ev.measureFor(n) ? ev.tryColumn(n) : null
        const name = n.kind === 'column' ? n.name : `Column${i}`
        items.push({ col: { name, lineage: c, dataType: c?.dataType ?? ev.staticType(n), tableName: n.kind === 'column' ? n.table ?? undefined : undefined }, expr: n })
        i += 1
        continue
      }
      const [p] = namedPairs(ev, 'SELECTCOLUMNS', a.slice(0, i + 2), i, items.map((x) => x.col))
      items.push(p)
      i += 2
    }
    // fast path: pure projections of columns
    const data: ColData[] = []
    const rest: number[] = []
    items.forEach((it, j) => {
      const src = it.col.lineage ? t.indexOfLineage(it.col.lineage) : it.expr.kind === 'column' && it.expr.table === null ? t.indexOfName(it.expr.name) : -1
      if (src >= 0 && !(it.expr.kind === 'column' && ev.measureFor(it.expr) && !it.col.lineage)) data[j] = t.data[src]
      else rest.push(j)
    })
    if (rest.length) {
      const vals = evalColumns(ev, t, env, rest.map((j) => items[j].expr))
      rest.forEach((j, k) => (data[j] = vals[k]))
    }
    const cols = items.map((i) => ({ ...i.col }))
    fixTypes(cols, cols.map((_, j) => (Array.isArray(data[j]) ? (data[j] as Scalar[]) : [])))
    return new TableValue(cols, data, t.n)
  },
  { table: true, min: 2, context: true }
)

defineFn(
  'ROW',
  (ev, a, env) => {
    if (a.length === 0 || a.length % 2 !== 0) throw new DaxError('ARG', 'ROW takes pairs of a column name in double quotes and an expression.')
    const pairs = namedPairs(ev, 'ROW', a, 0, [])
    const vals = pairs.map((p) => ev.scalar(p.expr, env))
    const cols = pairs.map((p, j) => ({ ...p.col, dataType: p.col.dataType ?? inferDataType([vals[j]]) }))
    return TableValue.fromRows(cols, [vals])
  },
  { table: true }
)

const DT_TYPES: Record<string, DataType> = { INTEGER: 'int64', DOUBLE: 'double', CURRENCY: 'decimal', STRING: 'string', BOOLEAN: 'boolean', DATETIME: 'dateTime', DATE: 'dateTime', TIME: 'dateTime' }
defineFn(
  'DATATABLE',
  (ev, a, env) => {
    const usage = 'DATATABLE takes pairs of a column name and a type, then the rows: DATATABLE ( "Name", STRING, "Qty", INTEGER, { { "a", 1 }, { "b", 2 } } ).'
    if (a.length < 3 || a.length % 2 === 0) throw new DaxError('ARG', usage)
    const data = a[a.length - 1]
    if (data.kind !== 'tableCtor') throw new DaxError('ARG', usage)
    const cols: TCol[] = []
    for (let i = 0; i + 1 < a.length - 1; i += 2) {
      const n = a[i]
      const ty = a[i + 1]
      if (n.kind !== 'string' || ty.kind !== 'ident') throw new DaxError('ARG', usage)
      const dt = DT_TYPES[ty.name.toUpperCase()]
      if (!dt) throw new DaxError('ARG', `DATATABLE column type '${ty.name}' isn't valid. Use INTEGER, DOUBLE, CURRENCY, STRING, BOOLEAN or DATETIME.`)
      cols.push({ name: n.value, lineage: null, alias: true, dataType: dt })
    }
    const rows = data.rows.map((r, k) => {
      const cells = r.length === 1 && r[0].kind === 'tableCtor' ? r[0].rows.map((x) => (x.length === 1 ? x[0] : null)).filter((x): x is Node => !!x) : r
      const flat = r.length === 1 && r[0].kind === 'tableCtor' && r[0].rows.length === 1 ? r[0].rows[0] : cells
      if (flat.length !== cols.length) throw new DaxError('ARG', `Row ${k + 1} of DATATABLE has ${flat.length} values, but ${cols.length} columns are declared.`)
      return flat.map((c, j) => coerceTo(ev.scalar(c, env), cols[j].dataType!))
    })
    return TableValue.fromRows(cols, rows)
  },
  { table: true }
)

// ------------------------------------------------------------------------------------------------
// SUMMARIZE / SUMMARIZECOLUMNS / GROUPBY
// ------------------------------------------------------------------------------------------------

/** Getter for a group-by column over the rows of `t`: own column, or a related column through the base table. */
function groupGetter(ev: Evaluator, t: TableValue, c: Col, env: Env, fn: string): (i: number) => Scalar {
  const own = t.indexOfLineage(c)
  if (own >= 0) return (i) => t.get(i, own)
  if (t.base) {
    const st = env.ctx.expansion(t.base.table).stepOf.get(c.table)
    if (st) {
      const map = ev.model.pathRowMap(st.path)
      const ids = t.base.ids
      return (i) => {
        const r = map ? map[ids[i]] : ids[i]
        return r < 0 ? null : c.value(r)
      }
    }
  }
  // related through any lineage column
  for (let j = 0; j < t.cols.length; j++) {
    const lc = t.cols[j].lineage
    const d = t.data[j]
    if (!lc || Array.isArray(d)) continue
    const st = env.ctx.expansion(lc.table).stepOf.get(c.table)
    if (st && st.path.length) {
      const map = ev.model.pathRowMap(st.path)!
      return (i) => {
        const r = map[d.ids[i]]
        return r < 0 ? null : c.value(r)
      }
    }
  }
  throw new DaxError('REF', `The column '${c.name}' specified in the '${fn}' function was not found in the input table.`)
}

export const subtotalStack: Array<Set<Col>> = []
export const groupStack: TableValue[] = []

defineFn(
  'SUMMARIZE',
  (ev, a, env) => {
    const fn = 'SUMMARIZE'
    const t = ev.table(a[0], env, fn)
    let i = 1
    const groupCols: Col[] = []
    const rollup: Col[] = []
    for (; i < a.length && a[i].kind !== 'string'; i++) {
      const n = a[i]
      if (n.kind === 'call' && ['ROLLUP', 'ROLLUPGROUP'].includes(n.name.toUpperCase())) {
        for (const x of n.args) {
          const c = ev.resolveColumn(x, fn)
          groupCols.push(c)
          rollup.push(c)
        }
        continue
      }
      groupCols.push(ev.resolveColumn(n, fn))
    }
    if ((a.length - i) % 2 !== 0) throw new DaxError('ARG', 'SUMMARIZE extension columns come in pairs of a name in double quotes and an expression.')
    const getters = groupCols.map((c) => groupGetter(ev, t, c, env, fn))
    const groups = new Map<string, { vals: Scalar[]; rows: number[] }>()
    for (let r = 0; r < t.n; r++) {
      const vals = getters.map((g) => g(r))
      const k = tupleKey(vals)
      let g = groups.get(k)
      if (!g) {
        g = { vals, rows: [] }
        groups.set(k, g)
      }
      g.rows.push(r)
    }
    const exts = namedPairs(ev, fn, a, i, groupCols.map((c) => ({ name: c.name, lineage: c })))
    const out: Scalar[][] = []
    const levels: Array<Set<Col>> = [new Set()]
    for (let k = rollup.length - 1; k >= 0; k--) levels.push(new Set(rollup.slice(k)))
    for (const level of levels) {
      const lv = level.size ? new Map<string, { vals: Scalar[]; rows: number[] }>() : groups
      if (level.size) {
        for (const g of groups.values()) {
          const vals = g.vals.map((v, j) => (level.has(groupCols[j]) ? null : v))
          const k = tupleKey(vals)
          const x = lv.get(k)
          if (x) x.rows.push(...g.rows)
          else lv.set(k, { vals, rows: [...g.rows] })
        }
      }
      for (const g of lv.values()) {
        let values: Scalar[] = []
        if (exts.length) {
          const f: Filter[] = []
          if (t.base) f.push(rowsFilter(t.base.table, Int32Array.from(new Set(g.rows.map((r) => t.base!.ids[r]))).sort(), true))
          groupCols.forEach((c, j) => {
            if (!level.has(c)) f.push(eqFilter(c, c.codeOf(g.vals[j])))
          })
          const ctx = ev.transition(env).addFilters(f, true)
          subtotalStack.push(level)
          try {
            values = exts.map((e) => ev.scalar(e.expr, { ...env, ctx, transitioned: env.rows.length }))
          } finally {
            subtotalStack.pop()
          }
        }
        out.push([...g.vals, ...values])
      }
    }
    const cols: TCol[] = [...groupCols.map((c) => ({ name: c.name, lineage: c, dataType: c.dataType })), ...exts.map((e) => ({ ...e.col, lineage: null }))]
    fixTypes(cols, cols.map((_, j) => out.map((r) => r[j])))
    return TableValue.fromRows(cols, out)
  },
  { table: true, min: 1, context: true }
)
defineFn(['ROLLUP', 'ROLLUPGROUP'], () => {
  throw new DaxError('ARG', 'ROLLUP / ROLLUPGROUP can only be used inside SUMMARIZE or SUMMARIZECOLUMNS.')
}, { table: true })
defineFn('ISSUBTOTAL', (ev, a) => {
  const c = ev.resolveColumn(a[0], 'ISSUBTOTAL')
  const top = subtotalStack[subtotalStack.length - 1]
  return !!top && top.has(c)
}, { min: 1, max: 1 })

export interface SummarizeExt {
  name: string
  expr: Node
  /** IGNORE(): not considered when removing all-blank rows */
  ignore?: boolean
}

export interface SummarizeOptions {
  /** keep rows where every (non-ignored) value is blank */
  keepBlankRows?: boolean
  /** cross join all values of each table's group columns (show items with no data) */
  showAll?: boolean
  /** max number of group combinations before falling back to fact-driven auto-exist */
  maxCombos?: number
  /** called per row with its group filter context (formats, measure filters); return false to drop the row */
  onRow?: (ctx: FilterContext, row: Scalar[]) => boolean | void
  /** per-cell error handler: return the value to use (default: rethrow) */
  onError?: (e: unknown, ext: number) => Scalar
  /** evaluate the extension expressions with this filter context instead of the group context */
  extraFilters?: Filter[]
  /** Date.now() deadline: stop producing rows when reached (partial result) and call onTimeout */
  deadline?: number
  onTimeout?: () => void
}

/**
 * Group combinations that exist, for group-by columns spread over many tables (wide tables): instead of the cross
 * product, tables are merged into clusters through the rows of tables that reach several of them (fact tables, or a
 * dimension that expands to another one), keeping only combinations that occur in those rows (auto-exist through
 * relationships, like Power BI's queries over related tables); independent clusters are cross joined.
 * Used only when the plain cross join would exceed `maxCombos`.
 */
function existingCombos(ev: Evaluator, base: FilterContext, tables: Array<[Tbl, Col[]]>, perTable: Int32Array[][], maxCombos: number): Int32Array[][] {
  type Cluster = { tis: number[]; combos: Int32Array[][] }
  let clusters: Cluster[] = tables.map((_, ti) => ({ tis: [ti], combos: perTable[ti].map((tu) => [tu]) }))
  for (;;) {
    if (clusters.length < 2) break
    // the table whose expansion covers the most clusters (at least two)
    let best: { F: Tbl; covered: Cluster[] } | null = null
    for (const F of ev.model.tables) {
      const exp = base.expansion(F)
      const covered = clusters.filter((c) => c.tis.every((ti) => exp.stepOf.has(tables[ti][0])))
      if (covered.length < 2) continue
      if (!best || covered.length > best.covered.length || (covered.length === best.covered.length && F.rowCount > best.F.rowCount)) best = { F, covered }
    }
    if (!best) break
    const exp = base.expansion(best.F)
    const tis = best.covered.flatMap((c) => c.tis)
    const via = tis.map((ti) => tables[ti][1].map((c) => ev.model.codesVia(exp.stepOf.get(tables[ti][0])!.path, c)))
    // each covered cluster's existing combinations (as keys), so merged rows stay consistent with them
    const allowed = best.covered.map((c) => new Set(c.combos.map((cb) => cb.map((tu) => tu.join(',')).join('|'))))
    const seen = new Set<string>()
    const merged: Int32Array[][] = []
    for (const r of base.visible(best.F)) {
      const tuples = via.map((vs) => Int32Array.from(vs.map((v) => v[r])))
      let o = 0
      let ok = true
      for (let k = 0; k < best.covered.length && ok; k++) {
        const n = best.covered[k].tis.length
        ok = allowed[k].has(tuples.slice(o, o + n).map((tu) => tu.join(',')).join('|'))
        o += n
      }
      if (!ok) continue
      const key = tuples.map((tu) => tu.join(',')).join('|')
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(tuples)
    }
    clusters = [...clusters.filter((c) => !best!.covered.includes(c)), { tis, combos: merged }]
  }
  let size = 1
  for (const c of clusters) size *= c.combos.length
  if (size > Math.max(maxCombos, 2_000_000)) throw new DaxError('LIMIT', `The visual would produce ${size} group combinations from unrelated tables; reduce the number of fields.`)
  let out: Int32Array[][] = [new Array(tables.length)]
  for (const c of clusters) {
    const next: Int32Array[][] = []
    for (const partial of out)
      for (const cb of c.combos) {
        const row = partial.slice()
        c.tis.forEach((ti, k) => (row[ti] = cb[k]))
        next.push(row)
      }
    out = next
  }
  return out
}

/**
 * SUMMARIZECOLUMNS core: group-by column combinations that exist (auto-exist within each table, cross join
 * across tables), each evaluated with the group values as filters, dropping rows whose values are all blank.
 */
export function summarizeColumnsCore(ev: Evaluator, env: Env, groupCols: Col[], exts: SummarizeExt[], opts: SummarizeOptions = {}): Scalar[][] {
  const base = env.ctx.with({ shadow: env.ctx.shadow ?? env.ctx.filters })
  const byTable = new Map<Tbl, Col[]>()
  for (const c of groupCols) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c])
  const tables = [...byTable.entries()]
  // per-table distinct code tuples
  const perTable: Int32Array[][] = tables.map(([t, cols]) => {
    const ids = base.visible(t)
    const seen = new Set<string>()
    const out: Int32Array[] = []
    for (let i = 0; i < ids.length; i++) {
      const r = ids[i]
      let k = ''
      for (const c of cols) k += c.codes[r] + ','
      if (seen.has(k)) continue
      seen.add(k)
      out.push(Int32Array.from(cols.map((c) => c.codes[r])))
    }
    return out
  })
  let total = 1
  for (const p of perTable) total *= p.length
  const maxCombos = opts.maxCombos ?? 250_000
  // vertical fusion: simple aggregations computed for all groups in one scan (fusion.ts) — the extension
  // expressions themselves, and measures they reference at the cell level (served to evalMeasure per cell)
  const flatCols = tables.flatMap(([, cols]) => cols)
  let fused: Fused | null = null
  let fusedIdx: number[] = []
  let innerMeasures: Array<Measure | Node> = []
  if (exts.length && !opts.extraFilters?.length && !env.applied && !env.selMeasure && !env.formatOf && total > 1) {
    // cell-invariant measure variables are hoisted (evaluated once) when the group columns do not reach them
    const inv: CellInvariance = { base, probe: base.addFilters(flatCols.map((c) => eqFilter(c, c.dict.length > 1 ? 1 : 0)), false), env }
    const simple = exts.map((e) => simpleAggOf(ev, e.expr, 0, inv))
    fusedIdx = simple.map((x, j) => (x ? j : -1)).filter((j) => j >= 0)
    const inner = new Map<Measure | Node, SimpleAgg>()
    exts.forEach((e, j) => {
      if (!simple[j]) cellLevelMeasures(ev, e.expr, inner, 0, new Set(), inv)
    })
    innerMeasures = [...inner.keys()]
    const aggs = [...fusedIdx.map((j) => simple[j]!), ...innerMeasures.map((m) => inner.get(m)!)]
    if (aggs.length) fused = fuse(ev, base, flatCols, aggs, env)
    if (!fused) {
      fusedIdx = []
      innerMeasures = []
    }
  }
  const allFused = !!fused && fused.complete && fusedIdx.length === exts.length && exts.every((e) => !e.ignore) && !opts.keepBlankRows && !opts.showAll
  let combos: Int32Array[][]
  if (allFused) {
    // only combinations present in the fact table(s) can have a non-blank value
    const sizes = tables.map(([, cols]) => cols.length)
    combos = []
    for (const codes of fused!.keys.values()) {
      const combo: Int32Array[] = []
      let o = 0
      for (const n of sizes) {
        combo.push(codes.subarray(o, o + n))
        o += n
      }
      combos.push(combo)
    }
  } else if (tables.length > 1 && total > maxCombos && !opts.showAll) {
    combos = existingCombos(ev, base, tables, perTable, maxCombos)
  } else {
    combos = [[]]
    for (const p of perTable) {
      const next: Int32Array[][] = []
      for (const c of combos) for (const tu of p) next.push([...c, tu])
      combos = next
    }
  }
  const scope = new Set(groupCols.map((c) => c.id))
  const rows: Scalar[][] = []
  let n = 0
  for (const combo of combos) {
    if (opts.deadline && (++n & 15) === 0 && Date.now() > opts.deadline) {
      opts.onTimeout?.()
      break
    }
    const keys: Scalar[] = new Array(groupCols.length)
    const fs: Filter[] = []
    let k = 0
    tables.forEach(([, cols], ti) => {
      cols.forEach((c, j) => {
        const code = combo[ti][j]
        keys[groupCols.indexOf(c)] = c.dict[code]
        fs.push(eqFilter(c, code))
        k++
      })
    })
    let ctx = base.addFilters(fs, false).with({ scope })
    if (opts.extraFilters?.length) ctx = ctx.addFilters(opts.extraFilters, false)
    const cellEnv: Env = { ...env, ctx, rows: [], transitioned: 0 }
    let flat: Int32Array | null = null
    if (fused) {
      flat = new Int32Array(flatCols.length)
      let o = 0
      for (const tu of combo) for (let q = 0; q < tu.length; q++) flat[o++] = tu[q]
      if (innerMeasures.length) {
        const ov = new Map<Measure | Node, Scalar>()
        innerMeasures.forEach((m, q) => ov.set(m, fused!.valueAt(fusedIdx.length + q, flat!)))
        ev.cellOverrides = { ctx, values: ov }
      }
    }
    const values = exts.map((e, j) => {
      if (fused) {
        const fi = fusedIdx.indexOf(j)
        if (fi >= 0) return fused.valueAt(fi, flat!)
      }
      if (!opts.onError) return ev.scalar(e.expr, cellEnv)
      try {
        return ev.scalar(e.expr, cellEnv)
      } catch (err) {
        return opts.onError(err, j)
      }
    })
    if (exts.length > 0 && !opts.keepBlankRows && !opts.showAll && exts.every((e, j) => e.ignore || values[j] === null)) continue
    const row = [...keys, ...values]
    if (opts.onRow) {
      // the row callback (visual-level measure filters) re-reads measures of the row in the cell context: serve the
      // values just computed
      const ov = ev.cellOverrides?.ctx === ctx ? ev.cellOverrides.values : new Map<Measure | Node, Scalar>()
      exts.forEach((e, j) => {
        const m = e.expr.kind === 'column' ? ev.measureFor(e.expr) : null
        if (m && values[j] !== null) ov.set(m, values[j])
      })
      ev.cellOverrides = { ctx, values: ov }
      if (opts.onRow(ctx, row) === false) continue
    }
    rows.push(row)
  }
  ev.cellOverrides = null
  return rows
}

/**
 * Measures referenced at the cell level of an expression (operands of arithmetic, IF, DIVIDE... — not inside
 * CALCULATE, iterators or other context-changing functions), transitively through measures, that are simple
 * aggregations: their per-cell values can come from the fused scan.
 */
function cellLevelMeasures(ev: Evaluator, n: Node, out: Map<Measure | Node, SimpleAgg>, depth = 0, seen = new Set<Measure>(), inv?: CellInvariance): void {
  if (depth > 20) return
  switch (n.kind) {
    case 'column': {
      const m = ev.measureFor(n)
      if (!m || seen.has(m)) return
      seen.add(m)
      const s = simpleAggOf(ev, n, 0, inv)
      if (s) {
        out.set(m, s)
        return
      }
      try {
        const home = ev.home
        ev.home = m.table
        try {
          cellLevelMeasures(ev, ev.measureAst(m), out, depth + 1, seen, inv)
        } finally {
          ev.home = home
        }
      } catch {
        /* syntax errors surface when evaluated */
      }
      return
    }
    case 'binary':
      cellLevelMeasures(ev, n.left, out, depth, seen, inv)
      cellLevelMeasures(ev, n.right, out, depth, seen, inv)
      return
    case 'unary':
      cellLevelMeasures(ev, n.operand, out, depth, seen, inv)
      return
    case 'var':
      n.decls.forEach((d) => cellLevelMeasures(ev, d.expr, out, depth, seen, inv))
      cellLevelMeasures(ev, n.body, out, depth, seen, inv)
      return
    case 'call': {
      if (n.name.toUpperCase() === 'CALCULATE') {
        // CALCULATE ( <simple aggregation>, <constant filters> ) at the cell level
        const s = simpleAggOf(ev, n, 0, inv)
        if (s) out.set(n, s)
        return
      }
      const meta = FN_META.get(n.name.toUpperCase())
      if (!meta || meta.context || meta.table) return
      n.args.forEach((a) => cellLevelMeasures(ev, a, out, depth, seen, inv))
      return
    }
    default:
      return
  }
}

defineFn(
  'SUMMARIZECOLUMNS',
  (ev, a, env) => {
    const fn = 'SUMMARIZECOLUMNS'
    let i = 0
    const groupCols: Col[] = []
    const rollups: Array<{ cols: Col[]; name: string }> = []
    // each ROLLUPADDISSUBTOTAL is a hierarchy of levels (a column or ROLLUPGROUP, then its flag name): its subtotals
    // roll up the levels from the last one; several hierarchies combine (rows x columns subtotals of a matrix)
    const hierarchies: number[][] = []
    for (; i < a.length; i++) {
      const n = a[i]
      if (n.kind === 'column' && !ev.measureFor(n)) {
        const c = ev.resolveColumn(n, fn)
        if (groupCols.includes(c)) throw new DaxError('ARG', `The column ${c.label} is specified more than once in ${fn}.`)
        groupCols.push(c)
        continue
      }
      if (n.kind === 'call' && n.name.toUpperCase() === 'ROLLUPGROUP') {
        for (const x of n.args) if (x.kind === 'column') groupCols.push(ev.resolveColumn(x, fn))
        continue
      }
      if (n.kind === 'call' && n.name.toUpperCase() === 'ROLLUPADDISSUBTOTAL') {
        const levels: number[] = []
        let cols: Col[] = []
        for (const x of n.args) {
          if (x.kind === 'column') cols.push(ev.resolveColumn(x, fn))
          else if (x.kind === 'call' && x.name.toUpperCase() === 'ROLLUPGROUP') for (const y of x.args) cols.push(ev.resolveColumn(y, fn))
          else if (x.kind === 'string') {
            if (!cols.length) throw new DaxError('ARG', 'ROLLUPADDISSUBTOTAL: a subtotal name must follow a column or ROLLUPGROUP.', x)
            groupCols.push(...cols)
            levels.push(rollups.push({ cols, name: x.value }) - 1)
            cols = []
          }
          // other arguments (a grand total filter table) do not change the groups
        }
        if (cols.length) throw new DaxError('ARG', 'ROLLUPADDISSUBTOTAL: each column needs a subtotal name in double quotes.', n)
        hierarchies.push(levels)
        continue
      }
      break
    }
    const filters: Node[] = []
    for (; i < a.length && a[i].kind !== 'string'; i++) filters.push(a[i])
    if ((a.length - i) % 2 !== 0) throw new DaxError('ARG', `The expressions in ${fn} come in pairs: a column name in double quotes, then an expression.`)
    const exts: SummarizeExt[] = []
    for (let j = i; j < a.length; j += 2) {
      const n = a[j] as Extract<Node, { kind: 'string' }>
      let expr = a[j + 1]
      let ignore = false
      if (expr.kind === 'call' && expr.name.toUpperCase() === 'IGNORE') {
        ignore = true
        expr = expr.args[0]
      }
      exts.push({ name: n.value, expr, ignore })
    }
    const ctx = filters.length ? ev.calculateContext(filters, env) : ev.transition(env)
    const inner = { ...env, ctx: ctx.with({ shadow: ctx.filters }), rows: [], transitioned: 0, shadows: [] }
    let rows = summarizeColumnsCore(ev, inner, groupCols, exts)
    const flagCols: TCol[] = rollups.map((r) => ({ name: r.name, lineage: null, alias: true, dataType: 'boolean' as DataType }))
    if (rollups.length) {
      rows = rows.map((r) => [...r.slice(0, groupCols.length), ...rollups.map(() => false), ...r.slice(groupCols.length)])
      // subtotal levels: every combination of rolled-up level counts of the hierarchies (each from its last level)
      const counts = hierarchies.map(() => 0)
      for (;;) {
        let h = 0
        while (h < counts.length && counts[h] === hierarchies[h].length) counts[h++] = 0
        if (h === counts.length) break
        counts[h]++
        const flagged = new Set<number>()
        hierarchies.forEach((levels, q) => levels.slice(levels.length - counts[q]).forEach((r) => flagged.add(r)))
        const rolled = new Set([...flagged].flatMap((r) => rollups[r].cols))
        const keep = groupCols.filter((c) => !rolled.has(c))
        const sub = summarizeColumnsCore(ev, inner, keep, exts)
        for (const s of sub) {
          const keys = groupCols.map((c) => (rolled.has(c) ? null : s[keep.indexOf(c)]))
          rows.push([...keys, ...rollups.map((_, q) => flagged.has(q)), ...s.slice(keep.length)])
        }
      }
    }
    rows.sort((x, y) => {
      for (let j = 0; j < groupCols.length; j++) {
        const c = sortCompare(x[j], y[j])
        if (c !== 0) return c
      }
      return 0
    })
    const cols: TCol[] = [
      ...groupCols.map((c) => ({ name: c.name, lineage: c, dataType: c.dataType })),
      ...flagCols,
      ...exts.map((e) => {
        const m = e.expr.kind === 'column' ? ev.measureFor(e.expr) : null
        return { name: e.name, lineage: null, alias: true, dataType: ev.staticType(e.expr), formatString: m?.formatString }
      })
    ]
    fixTypes(cols, cols.map((_, j) => rows.map((r) => r[j])))
    return TableValue.fromRows(cols, rows)
  },
  { table: true, context: true }
)
defineFn('ROLLUPADDISSUBTOTAL', () => {
  throw new DaxError('ARG', 'ROLLUPADDISSUBTOTAL can only be used inside SUMMARIZECOLUMNS.')
}, { table: true })

defineFn(
  'GROUPBY',
  (ev, a, env) => {
    const fn = 'GROUPBY'
    const t = ev.table(a[0], env, fn)
    let i = 1
    // group by model columns, or by columns the table expression added ([Name] of ADDCOLUMNS / SELECTCOLUMNS)
    const groupBy: TCol[] = []
    const getters: Array<(r: number) => Scalar> = []
    for (; i < a.length && a[i].kind !== 'string'; i++) {
      const n = a[i]
      const own = n.kind === 'column' && n.table === null ? t.indexOfName(n.name) : -1
      if (own >= 0 && (!t.cols[own].lineage || t.cols[own].lineage!.name.toLowerCase() !== (n as { name: string }).name.toLowerCase())) {
        groupBy.push({ ...t.cols[own] })
        getters.push((r) => t.get(r, own))
        continue
      }
      const c = ev.resolveColumn(n, fn)
      groupBy.push({ name: c.name, lineage: c, dataType: c.dataType })
      getters.push(groupGetter(ev, t, c, env, fn))
    }
    const groups = new Map<string, { vals: Scalar[]; rows: number[] }>()
    for (let r = 0; r < t.n; r++) {
      const vals = getters.map((g) => g(r))
      const k = tupleKey(vals)
      let g = groups.get(k)
      if (!g) groups.set(k, (g = { vals, rows: [] }))
      g.rows.push(r)
    }
    const exts = namedPairs(ev, fn, a, i, groupBy.map((c) => ({ name: c.name, lineage: c.lineage })))
    const out: Scalar[][] = []
    for (const g of groups.values()) {
      groupStack.push(t.select(g.rows))
      try {
        out.push([...g.vals, ...exts.map((e) => ev.scalar(e.expr, env))])
      } finally {
        groupStack.pop()
      }
    }
    const cols: TCol[] = [...groupBy, ...exts.map((e) => ({ ...e.col, lineage: null }))]
    fixTypes(cols, cols.map((_, j) => out.map((r) => r[j])))
    return TableValue.fromRows(cols, out)
  },
  { table: true, min: 1, context: true }
)
defineFn(
  'CURRENTGROUP',
  () => {
    const g = groupStack[groupStack.length - 1]
    if (!g) throw new DaxError('ARG', 'CURRENTGROUP can only be used inside GROUPBY.')
    return g
  },
  { table: true, max: 0 }
)

// ------------------------------------------------------------------------------------------------
// ordering / sampling
// ------------------------------------------------------------------------------------------------

function orderKeys(ev: Evaluator, a: Node[], start: number, env: Env): Array<{ expr: Node; desc: boolean }> {
  const keys: Array<{ expr: Node; desc: boolean }> = []
  for (let i = start; i < a.length; ) {
    const expr = a[i]
    const next = a[i + 1]
    let desc = true
    let step = 1
    if (next && next.kind === 'ident' && ['ASC', 'DESC'].includes(next.name.toUpperCase())) {
      desc = next.name.toUpperCase() === 'DESC'
      step = 2
    } else if (next && (next.kind === 'number' || next.kind === 'bool')) {
      desc = !toBool(next.value)
      step = 2
    } else if (next && next.kind !== 'column' && next.kind !== 'call' && next.kind !== 'binary') {
      const v = ev.scalar(next, env)
      if (typeof v === 'number' || typeof v === 'boolean') {
        desc = !toBool(v)
        step = 2
      }
    }
    keys.push({ expr, desc })
    i += step
  }
  return keys
}

function sortedOrder(ev: Evaluator, t: TableValue, env: Env, keys: Array<{ expr: Node; desc: boolean }>): { order: number[]; cmp: (x: number, y: number) => number } {
  const values: Scalar[][] = []
  const fs = keys.map((k) => rowFn(ev, k.expr, t, env))
  for (let i = 0; i < t.n; i++) values.push(fs.map((f) => f(i)))
  const cmp = (x: number, y: number) => {
    for (let k = 0; k < keys.length; k++) {
      const c = sortCompare(values[x][k], values[y][k])
      if (c !== 0) return keys[k].desc ? -c : c
    }
    return 0
  }
  const order = Array.from({ length: t.n }, (_, i) => i).sort((x, y) => cmp(x, y) || x - y)
  return { order, cmp }
}

defineFn(
  'TOPN',
  (ev, a, env) => {
    const nv = ev.scalar(a[0], env)
    const n = nv === null ? 0 : Math.trunc(toNumber(nv))
    const t = ev.table(a[1], env, 'TOPN')
    if (n <= 0 || t.n === 0) return t.select([])
    if (a.length === 2) return t.select(Array.from({ length: Math.min(n, t.n) }, (_, i) => i))
    const { order, cmp } = sortedOrder(ev, t, env, orderKeys(ev, a, 2, env))
    let end = Math.min(n, order.length)
    while (end < order.length && cmp(order[end - 1], order[end]) === 0) end++
    return t.select(order.slice(0, end).sort((x, y) => x - y))
  },
  { table: true, min: 2, context: true }
)
defineFn(
  'TOPNSKIP',
  (ev, a, env) => {
    const n = Math.trunc(toNumber(ev.scalar(a[0], env)))
    const skip = Math.trunc(toNumber(ev.scalar(a[1], env)))
    const t = ev.table(a[2], env, 'TOPNSKIP')
    const { order } = a.length > 3 ? sortedOrder(ev, t, env, orderKeys(ev, a, 3, env)) : { order: Array.from({ length: t.n }, (_, i) => i) }
    return t.select(order.slice(skip, skip + n))
  },
  { table: true, min: 3, context: true }
)
defineFn(
  'SAMPLE',
  (ev, a, env) => {
    const n = Math.trunc(toNumber(ev.scalar(a[0], env)))
    const t = ev.table(a[1], env, 'SAMPLE')
    if (n <= 0 || t.n === 0) return t.select([])
    const { order } = a.length > 2 ? sortedOrder(ev, t, env, orderKeys(ev, a, 2, env).map((k) => ({ ...k, desc: !k.desc ? false : k.desc }))) : { order: Array.from({ length: t.n }, (_, i) => i) }
    if (n >= t.n) return t
    const pick: number[] = []
    for (let k = 0; k < n; k++) pick.push(order[Math.floor((k * t.n) / n)])
    return t.select(pick)
  },
  { table: true, min: 2, context: true }
)

// ------------------------------------------------------------------------------------------------
// set operations & joins
// ------------------------------------------------------------------------------------------------

defineFn(
  'UNION',
  (ev, a, env) => {
    const ts = a.map((x) => ev.table(x, env, 'UNION'))
    const width = ts[0].cols.length
    if (ts.some((t) => t.cols.length !== width)) throw new DaxError('ARG', 'Each table argument of UNION must have the same number of columns.')
    const cols: TCol[] = ts[0].cols.map((c, j) => ({
      ...c,
      lineage: ts.every((t) => t.cols[j].lineage === c.lineage) ? c.lineage : null,
      dataType: ts.every((t) => t.cols[j].dataType === c.dataType) ? c.dataType : undefined
    }))
    const rows = ts.flatMap((t) => t.rows())
    fixTypes(cols, cols.map((_, j) => rows.map((r) => r[j])))
    return TableValue.fromRows(cols, rows)
  },
  { table: true, min: 2, context: true }
)
defineFn(
  ['INTERSECT', 'EXCEPT'],
  (ev, a, env, node) => {
    const fn = node.name.toUpperCase()
    const x = ev.table(a[0], env, fn)
    const y = ev.table(a[1], env, fn)
    if (x.cols.length !== y.cols.length) throw new DaxError('ARG', `Each table argument of '${fn}' must have the same number of columns.`)
    const other = new Set<string>()
    for (let i = 0; i < y.n; i++) other.add(y.rowKey(i))
    const keep: number[] = []
    for (let i = 0; i < x.n; i++) if (other.has(x.rowKey(i)) === (fn === 'INTERSECT')) keep.push(i)
    return x.select(keep)
  },
  { table: true, min: 2, max: 2, context: true }
)

function joinCols(fn: string, ts: TableValue[]): TCol[] {
  const out: TCol[] = []
  for (const t of ts) {
    for (const c of t.cols) {
      if (out.some((o) => o.name.toLowerCase() === c.name.toLowerCase() && (o.lineage === c.lineage || !o.lineage || !c.lineage || o.lineage.table === c.lineage.table)))
        throw new DaxError('ARG', `Function '${fn}' does not allow two columns with the same name '${c.name}'.`)
      out.push(c)
    }
  }
  return out
}

defineFn(
  'CROSSJOIN',
  (ev, a, env) => {
    const ts = a.map((x) => ev.table(x, env, 'CROSSJOIN'))
    const cols = joinCols('CROSSJOIN', ts)
    let rows: Scalar[][] = [[]]
    for (const t of ts) {
      const tr = t.rows()
      const next: Scalar[][] = []
      for (const r of rows) for (const x of tr) next.push([...r, ...x])
      rows = next
    }
    return TableValue.fromRows(cols, rows)
  },
  { table: true, min: 1, context: true }
)
defineFn(
  ['GENERATE', 'GENERATEALL'],
  (ev, a, env, node) => {
    const fn = node.name.toUpperCase()
    const t = ev.table(a[0], env, fn)
    let inner: TCol[] | null = null
    const rows: Scalar[][] = []
    ev.each(t, env, (re, i) => {
      const x = ev.table(a[1], re, fn)
      inner ??= x.cols
      const left = t.row(i)
      if (x.n === 0 && fn === 'GENERATEALL') rows.push([...left, ...x.cols.map(() => null)])
      for (let k = 0; k < x.n; k++) rows.push([...left, ...x.row(k)])
    })
    if (!inner) {
      // evaluate once in an empty row context to learn the shape
      try {
        inner = ev.table(a[1], env, fn).cols
      } catch {
        inner = []
      }
    }
    return TableValue.fromRows(joinCols(fn, [t, TableValue.empty(inner)]), rows.map((r) => r.concat(new Array(Math.max(0, t.cols.length + inner!.length - r.length)).fill(null))))
  },
  { table: true, min: 2, max: 2, context: true }
)
defineFn(
  ['NATURALINNERJOIN', 'NATURALLEFTOUTERJOIN'],
  (ev, a, env, node) => {
    const fn = node.name.toUpperCase()
    const x = ev.table(a[0], env, fn)
    const y = ev.table(a[1], env, fn)
    const pairs: Array<[number, number]> = []
    x.cols.forEach((c, i) => {
      const j = y.cols.findIndex((d) => (c.lineage && d.lineage ? c.lineage === d.lineage : c.name.toLowerCase() === d.name.toLowerCase() && !c.lineage && !d.lineage))
      if (j >= 0) pairs.push([i, j])
    })
    if (pairs.length === 0) {
      // related tables: join on relationship keys (common case NATURALLEFTOUTERJOIN ( Fact, Dim ))
      for (const r of ev.model.relationships) {
        const i = x.cols.findIndex((c) => c.lineage === r.from || c.lineage === r.to)
        const j = y.cols.findIndex((d) => d.lineage === (x.cols[i]?.lineage === r.from ? r.to : r.from))
        if (i >= 0 && j >= 0) {
          pairs.push([i, j])
          break
        }
      }
    }
    if (pairs.length === 0) throw new DaxError('ARG', `No common join columns detected. The join function '${fn}' requires at least one common join column.`)
    const yRest = y.cols.map((_, j) => j).filter((j) => !pairs.some(([, pj]) => pj === j && x.cols[pairs.find(([, q]) => q === j)![0]].name.toLowerCase() === y.cols[j].name.toLowerCase()))
    const index = new Map<string, number[]>()
    for (let k = 0; k < y.n; k++) {
      const key = tupleKey(pairs.map(([, j]) => y.get(k, j)))
      const l = index.get(key)
      if (l) l.push(k)
      else index.set(key, [k])
    }
    const rows: Scalar[][] = []
    for (let i = 0; i < x.n; i++) {
      const key = tupleKey(pairs.map(([p]) => x.get(i, p)))
      const hits = pairs.some(([p]) => x.get(i, p) === null) ? undefined : index.get(key)
      if (hits) for (const k of hits) rows.push([...x.row(i), ...yRest.map((j) => y.get(k, j))])
      else if (fn === 'NATURALLEFTOUTERJOIN') rows.push([...x.row(i), ...yRest.map(() => null)])
    }
    return TableValue.fromRows([...x.cols, ...yRest.map((j) => y.cols[j])], rows)
  },
  { table: true, min: 2, max: 2, context: true }
)

defineFn(
  'TREATAS',
  (ev, a, env) => {
    const t = ev.table(a[0], env, 'TREATAS')
    const cols = a.slice(1).map((x) => ev.resolveColumn(x, 'TREATAS'))
    if (t.cols.length !== cols.length) throw new DaxError('ARG', `The table passed to TREATAS has ${t.cols.length} column(s), but ${cols.length} target column(s) were given; they must match.`)
    const make = () =>
      new TableValue(
        cols.map((c) => ({ name: c.name, lineage: c, dataType: c.dataType })),
        t.cols.map((_, j) => t.column(j)),
        t.n
      )
    if (t.n < 64) return make()
    // large inputs (often a memoized variable): the same output object, so its filter conversion is cached too
    const key = cols.map((c) => c.id).join(',')
    let byCols = ev.treatAsCache.get(t)
    const hit = byCols?.get(key)
    if (hit) return hit
    const out = make()
    if (!byCols) ev.treatAsCache.set(t, (byCols = new Map()))
    byCols.set(key, out)
    return out
  },
  { table: true, min: 2, context: true }
)

// ------------------------------------------------------------------------------------------------
// generators
// ------------------------------------------------------------------------------------------------

defineFn(
  'GENERATESERIES',
  (ev, a, env) => {
    const s = ev.scalar(a[0], env)
    const e = ev.scalar(a[1], env)
    const stepV = missing(a[2]) ? 1 : ev.scalar(a[2], env)
    if (s === null || e === null) throw new DaxError('ARG', 'GENERATESERIES: start and end cannot be blank.')
    const isDate = s instanceof Date
    const start = toNumber(s)
    const end = toNumber(e)
    const step = toNumber(stepV)
    if (step <= 0) throw new DaxError('ARG', 'GENERATESERIES: the increment must be positive.')
    const out: Scalar[] = []
    const decimals = Math.max(dec(start), dec(step))
    for (let k = 0; ; k++) {
      let v = start + k * step
      if (decimals > 0) v = Number(v.toFixed(Math.min(15, decimals)))
      if (v > end + 1e-12) break
      out.push(isDate ? new Date(Math.round((v - 25569) * MS_PER_DAY)) : v)
      if (out.length > 5_000_000) throw new DaxError('LIMIT', 'GENERATESERIES would produce too many rows.')
    }
    const dt: DataType = isDate ? 'dateTime' : out.every((v) => Number.isInteger(v)) ? 'int64' : 'double'
    return new TableValue([{ name: 'Value', lineage: null, alias: true, dataType: dt }], [out], out.length)
  },
  { table: true, min: 2, max: 3 }
)
function dec(x: number): number {
  const s = String(x)
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

function calendarTable(from: number, to: number): TableValue {
  const vals: Scalar[] = []
  for (let d = from; d <= to; d++) vals.push(fromDayNumber(d))
  return new TableValue([{ name: 'Date', lineage: null, alias: true, dataType: 'dateTime' }], [vals], vals.length)
}
defineFn(
  'CALENDAR',
  (ev, a, env) => {
    const s = toDate(ev.scalar(a[0], env))
    const e = toDate(ev.scalar(a[1], env))
    if (!s || !e) throw new DaxError('ARG', 'CALENDAR: the start and end dates cannot be blank.')
    if (e < s) throw new DaxError('ARG', 'The start date in Calendar function can not be later than the end date.')
    return calendarTable(dayNumber(s), dayNumber(e))
  },
  { table: true, min: 2, max: 2 }
)
defineFn(
  'CALENDARAUTO',
  (ev, a, env) => {
    const fyEnd = missing(a[0]) ? 12 : Math.trunc(toNumber(ev.scalar(a[0], env)))
    let lo = Infinity
    let hi = -Infinity
    for (const t of ev.model.tables) {
      if (t.expression) continue // calculated tables are excluded
      for (const c of t.cols) {
        if (c.dataType !== 'dateTime' || c.kind === 'calculated') continue
        for (let i = 1; i < c.dict.length; i++) {
          const d = c.dict[i] as Date
          const n = dayNumber(d)
          if (n < lo) lo = n
          if (n > hi) hi = n
        }
      }
    }
    if (!Number.isFinite(lo)) {
      const today = dayNumber(ev.now())
      lo = hi = today
    }
    const ld = fromDayNumber(lo)
    const hd = fromDayNumber(hi)
    // fiscal year containing the earliest date starts the month after fyEnd
    let sy = ld.getUTCFullYear()
    if (ld.getUTCMonth() + 1 <= fyEnd) sy -= 1
    let ey = hd.getUTCFullYear()
    if (hd.getUTCMonth() + 1 > fyEnd) ey += 1
    const start = dayNumber(makeDate(sy, fyEnd + 1, 1))
    const end = dayNumber(makeDate(ey, fyEnd + 1, 0))
    return calendarTable(fyEnd === 12 ? dayNumber(makeDate(ld.getUTCFullYear(), 1, 1)) : start, fyEnd === 12 ? dayNumber(makeDate(hd.getUTCFullYear(), 12, 31)) : end)
  },
  { table: true, max: 1 }
)

defineFn(
  'ADDMISSINGITEMS',
  (ev, a, env) => {
    // ADDMISSINGITEMS ( [showAll columns...], table, groupBy columns..., [filterTable]... )
    let i = 0
    const showAll: Col[] = []
    while (i < a.length && a[i].kind === 'column') showAll.push(ev.resolveColumn(a[i++], 'ADDMISSINGITEMS'))
    const t = ev.table(a[i++], env, 'ADDMISSINGITEMS')
    const groupCols: Col[] = []
    while (i < a.length && a[i].kind === 'column') groupCols.push(ev.resolveColumn(a[i++], 'ADDMISSINGITEMS'))
    const cols = groupCols.length ? groupCols : showAll
    const pos = cols.map((c) => t.indexOfLineage(c))
    if (pos.some((p) => p < 0)) return t
    const present = new Set<string>()
    for (let r = 0; r < t.n; r++) present.add(tupleKey(pos.map((p) => t.get(r, p))))
    const byTable = new Map<Tbl, Col[]>()
    for (const c of cols) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c])
    let combos: Scalar[][] = [[]]
    for (const [tb, cs] of byTable) {
      const vals = distinctColumns(cs, allRowsOf(tb, false)).rows()
      const next: Scalar[][] = []
      for (const c of combos) for (const v of vals) next.push([...c, ...v])
      combos = next
    }
    const order = [...byTable.values()].flat()
    const rows = t.rows()
    for (const combo of combos) {
      const vals = cols.map((c) => combo[order.indexOf(c)])
      if (present.has(tupleKey(vals))) continue
      const row: Scalar[] = new Array(t.cols.length).fill(null)
      pos.forEach((p, j) => (row[p] = vals[j]))
      rows.push(row)
    }
    return TableValue.fromRows(t.cols, rows)
  },
  { table: true, min: 2, context: true }
)

defineFn('KMEANSCLUSTERING', () => {
  throw new DaxError(
    'UNSUPPORTED',
    'KMEANSCLUSTERING (the Power BI clustering feature) cannot be recomputed in Lumen: Power BI computes clusters with its own algorithm.'
  )
}, { table: true })

/**
 * DETAILROWS ( [Measure] ): the measure's detail rows expression (a table expression stored with the measure,
 * TOM `detailRowsDefinition`), evaluated in the current filter context (row context turned into filters).
 */
const detailAsts = new WeakMap<object, Node>()
defineFn(
  'DETAILROWS',
  (ev, a, env) => {
    const arg = a[0]
    const m = arg.kind === 'column' ? ev.measureFor(arg) : null
    if (!m) throw new DaxError('ARG', 'DETAILROWS expects a measure reference.', arg)
    const text = m.def?.detailRowsDefinition
    if (!text?.trim()) throw new DaxError('DETAILROWS', `The measure [${m.name}] has no detail rows expression.`, arg)
    let ast = detailAsts.get(m)
    if (!ast) {
      ast = parseExpression(text)
      detailAsts.set(m, ast)
    }
    const ctx = ev.transition(env)
    const home = ev.home
    ev.home = m.table
    try {
      return ev.table(ast, { ...env, ctx, rows: [], transitioned: 0, home: m.table }, 'DETAILROWS')
    } finally {
      ev.home = home
    }
  },
  { table: true, min: 1, max: 1, context: true }
)

defineFn(
  'SUBSTITUTEWITHINDEX',
  (ev, a, env) => {
    const t = ev.table(a[0], env, 'SUBSTITUTEWITHINDEX')
    const name = toText(ev.scalar(a[1], env))
    const idxT = ev.table(a[2], env, 'SUBSTITUTEWITHINDEX')
    const common = t.cols.map((c, i) => [i, idxT.indexOfName(c.name)] as const).filter(([, j]) => j >= 0)
    const keys = idxT.rows().map((r) => tupleKey(common.map(([, j]) => r[j])))
    const order = Array.from({ length: idxT.n }, (_, i) => i)
    const sortKeys = orderKeys(ev, a, 3, env)
    if (sortKeys.length) order.splice(0, order.length, ...sortedOrder(ev, idxT, env, sortKeys).order)
    const rank = new Map<string, number>()
    order.forEach((i, k) => {
      if (!rank.has(keys[i])) rank.set(keys[i], k)
    })
    const restCols = t.cols.map((_, i) => i).filter((i) => !common.some(([c]) => c === i))
    const rows = t.rows().map((r) => [...restCols.map((i) => r[i]), rank.get(tupleKey(common.map(([i]) => r[i]))) ?? null])
    return TableValue.fromRows([...restCols.map((i) => t.cols[i]), { name, lineage: null, alias: true, dataType: 'int64' }], rows)
  },
  { table: true, min: 3, context: true }
)

/** Helper used by the engine: filter that keeps exactly the given codes. */
export { colFilter, distinctColumns, allRowsOf }
export type { Val }
