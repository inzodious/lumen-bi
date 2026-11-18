/** Filter & context functions: CALCULATE, SELECTEDVALUE, ISFILTERED, LOOKUPVALUE, EARLIER, calc-group helpers... */
import { DaxError } from './errors.ts'
import type { Evaluator } from './evaluator.ts'
import { FilterContext } from './filters.ts'
import type { Col, DaxModel } from './model.ts'
import type { Node } from './parser.ts'
import { defineFn, type Env } from './registry.ts'
import { isTable, TableValue } from './table.ts'
import { compare, sortCompare, toText, tupleKey, type Scalar } from './values.ts'

const missing = (n: Node | undefined) => !n || (n.kind === 'ident' && n.name === '__missing__')

defineFn(
  'CALCULATE',
  (ev, a, env, node) => {
    if (ev.iterFusion) {
      const v = ev.iterOverride(node, env)
      if (v !== undefined) return v
    }
    const ov = ev.cellOverrides
    if (ov && env.rows.length === env.transitioned && env.ctx === ov.ctx && !env.applied && !env.selMeasure && !env.formatOf) {
      const v = ov.values.get(node)
      if (v !== undefined) return v
    }
    const ctx = ev.calculateContext(a.slice(1), env, a[0])
    return ev.scalar(a[0], { ...env, ctx, transitioned: env.rows.length })
  },
  { min: 1, context: true }
)

defineFn(
  'SELECTEDVALUE',
  (ev, a, env) => {
    const col = ev.resolveColumn(a[0], 'SELECTEDVALUE')
    const codes = ev.visibleCodes(col, env.ctx, true)
    if (codes.length === 1) return col.dict[codes[0]]
    return missing(a[1]) ? null : ev.scalar(a[1], env)
  },
  { min: 1, max: 2, context: true }
)
defineFn(
  'HASONEVALUE',
  (ev, a, env) => ev.visibleCodes(ev.resolveColumn(a[0], 'HASONEVALUE'), env.ctx, true).length === 1,
  { min: 1, max: 1, context: true }
)

function directFilterContext(ev: Evaluator, col: Col, ctx: FilterContext): FilterContext {
  return new FilterContext(ev.model, { filters: ctx.filtersOn(new Set([col.id])), cfg: ctx.cfg })
}
defineFn(
  'FILTERS',
  (ev, a, env) => {
    const col = ev.resolveColumn(a[0], 'FILTERS')
    return ev.valuesOf(col, directFilterContext(ev, col, env.ctx), false)
  },
  { min: 1, max: 1, table: true, context: true }
)
defineFn(
  'HASONEFILTER',
  (ev, a, env) => {
    const col = ev.resolveColumn(a[0], 'HASONEFILTER')
    if (!env.ctx.isFiltered(col)) return false
    return ev.visibleCodes(col, directFilterContext(ev, col, env.ctx), false).length === 1
  },
  { min: 1, max: 1, context: true }
)

function colsOrTable(ev: Evaluator, n: Node, fn: string): Col[] {
  if (n.kind === 'ident') {
    const t = ev.model.findTable(n.name)
    if (!t) throw new DaxError('REF', `${fn} expects a table or column reference, and '${n.name}' is not a table.`, n)
    return t.cols
  }
  return [ev.resolveColumn(n, fn)]
}
defineFn(
  'ISFILTERED',
  (ev, a, env) => {
    const ctx = ev.transition(env)
    return colsOrTable(ev, a[0], 'ISFILTERED').some((c) => ctx.isFiltered(c))
  },
  { min: 1, max: 1, context: true }
)
defineFn(
  'ISCROSSFILTERED',
  (ev, a, env) => {
    const ctx = ev.transition(env)
    const cols = colsOrTable(ev, a[0], 'ISCROSSFILTERED')
    const t = cols[0].table
    if (cols.some((c) => ctx.isFiltered(c))) return true
    // filtered through relationships: any filter on another column of the table, or visible rows reduced
    if (t.cols.some((c) => ctx.isFiltered(c))) return true
    return ctx.visible(t).length < t.fullCount
  },
  { min: 1, max: 1, context: true }
)
defineFn(
  'ISINSCOPE',
  (ev, a, env) => {
    const col = ev.resolveColumn(a[0], 'ISINSCOPE')
    const ctx = ev.transition(env)
    return ctx.scope.has(col.id) && ctx.isFiltered(col)
  },
  { min: 1, max: 1, context: true }
)
defineFn(
  'ISEMPTY',
  (ev, a, env) => {
    const n = a[0]
    if (n.kind === 'ident' && !ev.lookupVar(n.name, env) && !ev.queryTables.has(n.name.toLowerCase())) {
      const t = ev.model.findTable(n.name)
      if (t) return ev.transition(env).visible(t).length === 0
    }
    return ev.table(n, env, 'ISEMPTY').n === 0
  },
  { min: 1, max: 1, context: true }
)

defineFn('RELATED', (ev, a, env) => ev.related(ev.resolveColumn(a[0], 'RELATED'), env, a[0]), { min: 1, max: 1 })

function earlier(ev: Evaluator, a: Node[], env: Env, outermost: boolean): Scalar {
  const col = a[0].kind === 'column' ? ev.tryColumn(a[0]) : null
  const name = a[0].kind === 'column' ? a[0].name : ''
  const n = outermost ? Infinity : missing(a[1]) ? 1 : Math.trunc(Number(ev.scalar(a[1], env)))
  const hits: Array<{ t: TableValue; i: number; j: number }> = []
  for (let k = env.rows.length - 1; k >= 0; k--) {
    const rc = env.rows[k]
    const j = col ? rc.t.indexOfLineage(col) : rc.t.indexOfName(name)
    if (j >= 0) hits.push({ t: rc.t, i: rc.i, j })
  }
  const pick = outermost ? hits[hits.length - 1] : hits[n]
  if (!pick) throw new DaxError('EARLIER', `EARLIER/EARLIEST refers to an earlier row context which doesn't exist.`)
  return pick.t.get(pick.i, pick.j)
}
defineFn('EARLIER', (ev, a, env) => earlier(ev, a, env, false), { min: 1, max: 2 })
defineFn('EARLIEST', (ev, a, env) => earlier(ev, a, env, true), { min: 1, max: 1 })

// LOOKUPVALUE: index per (result column, search columns), ignoring the filter context.
const lookupIndexes = new WeakMap<DaxModel, { version: number; map: Map<string, Map<string, Set<number>>> }>()
defineFn(
  'LOOKUPVALUE',
  (ev, a, env) => {
    const result = ev.resolveColumn(a[0], 'LOOKUPVALUE')
    const alt = (a.length - 1) % 2 === 1 ? a[a.length - 1] : null
    const searchCols: Col[] = []
    const values: Scalar[] = []
    for (let i = 1; i + 1 < a.length; i += 2) {
      searchCols.push(ev.resolveColumn(a[i], 'LOOKUPVALUE'))
      values.push(ev.scalar(a[i + 1], env))
    }
    const t = result.table
    const exp = env.ctx.expansion(t)
    const getters = searchCols.map((c) => {
      const st = exp.stepOf.get(c.table)
      if (!st) throw new DaxError('REF', `LOOKUPVALUE: the search column ${c.label} is not related to the result table '${t.name}'.`)
      return ev.model.codesVia(st.path, c)
    })
    let cache = lookupIndexes.get(ev.model)
    if (!cache || cache.version !== ev.model.version) {
      cache = { version: ev.model.version, map: new Map() }
      lookupIndexes.set(ev.model, cache)
    }
    const key = result.id + '|' + searchCols.map((c) => c.id).join(',')
    let index = cache.map.get(key)
    if (!index) {
      index = new Map()
      for (let r = 0; r < t.rowCount; r++) {
        let k = ''
        for (const g of getters) k += g[r] + ','
        let s = index.get(k)
        if (!s) index.set(k, (s = new Set()))
        s.add(result.codes[r])
      }
      cache.map.set(key, index)
    }
    let k = ''
    const want: number[] = []
    for (let i = 0; i < searchCols.length; i++) {
      const c = searchCols[i].codeOf(values[i])
      if (c < 0) return alt ? ev.scalar(alt, env) : null
      k += c + ','
      want.push(c)
    }
    // LOOKUPVALUE removes the filters on the result table (ALL ( table )), but filters that still reach it (through
    // bidirectional relationships, row-level security) restrict the rows it searches
    const free = env.ctx.removeColumns(new Set(env.ctx.expandedColumns(t).map((c) => c.id)))
    const vis = free.visible(t)
    let hits: Set<number> | undefined
    if (vis.length >= t.rowCount) hits = index.get(k)
    else {
      hits = new Set()
      for (const r of vis) {
        if (r >= t.rowCount) continue
        let ok = true
        for (let i = 0; i < getters.length && ok; i++) ok = getters[i][r] === want[i]
        if (ok) hits.add(result.codes[r])
      }
    }
    if (!hits || hits.size === 0) return alt ? ev.scalar(alt, env) : null
    if (hits.size > 1) {
      if (alt) return ev.scalar(alt, env)
      throw new DaxError('LOOKUP', 'A table of multiple values was supplied where a single value was expected.')
    }
    return result.dict[hits.values().next().value as number]
  },
  { min: 3, context: true }
)

defineFn(
  'CONTAINS',
  (ev, a, env) => {
    const t = ev.table(a[0], env, 'CONTAINS')
    const pairs: Array<{ j: number; v: Scalar }> = []
    for (let i = 1; i + 1 < a.length; i += 2) {
      const n = a[i]
      const col = ev.tryColumn(n)
      let j = col ? t.indexOfLineage(col) : -1
      if (j < 0 && n.kind === 'column') j = t.indexOfName(n.name)
      if (j < 0) throw new DaxError('REF', 'CONTAINS: the column is not part of the table.', n)
      pairs.push({ j, v: ev.scalar(a[i + 1], env) })
    }
    for (let r = 0; r < t.n; r++) {
      if (pairs.every((p) => eq(t.get(r, p.j), p.v))) return true
    }
    return false
  },
  { min: 3, context: true }
)
function eq(a: Scalar, b: Scalar): boolean {
  if (a === null || b === null) return a === b
  try {
    return compare(a, b) === 0
  } catch {
    return false
  }
}
defineFn(
  'CONTAINSROW',
  (ev, a, env) => {
    const t = ev.table(a[0], env, 'CONTAINSROW')
    const vals = a.slice(1).map((x) => ev.scalar(x, env))
    if (vals.length !== t.cols.length) throw new DaxError('ARG', 'CONTAINSROW: the number of values must match the number of columns.')
    for (let r = 0; r < t.n; r++) if (vals.every((v, j) => eq(t.get(r, j), v))) return true
    return false
  },
  { min: 2, context: true }
)
defineFn(
  'ISONORAFTER',
  (ev, a, env) => {
    for (let i = 0; i + 1 < a.length; ) {
      const x = ev.scalar(a[i], env)
      const y = ev.scalar(a[i + 1], env)
      let desc = false
      let step = 2
      const o = a[i + 2]
      if (o && o.kind === 'ident' && ['ASC', 'DESC'].includes(o.name.toUpperCase())) {
        desc = o.name.toUpperCase() === 'DESC'
        step = 3
      }
      const c = sortCompare(x, y)
      if (c !== 0) return desc ? c < 0 : c > 0
      i += step
    }
    return true
  },
  { min: 2, context: true }
)

// ---- calculation group / measure helpers --------------------------------------------------------

defineFn(
  'SELECTEDMEASURE',
  (ev, _a, env) => {
    if (!env.selMeasure) throw new DaxError('CALC', 'SELECTEDMEASURE can only be used in the expression of a calculation item.')
    return ev.evalMeasure(env.selMeasure, { ...env, viaSelected: true })
  },
  { max: 0 }
)
defineFn(
  'SELECTEDMEASURENAME',
  (_ev, _a, env) => {
    const m = env.selMeasure ?? env.formatOf
    if (!m) throw new DaxError('CALC', 'SELECTEDMEASURENAME can only be used in a calculation item or a format string expression.')
    return m.name
  },
  { max: 0 }
)
defineFn(
  'ISSELECTEDMEASURE',
  (ev, a, env) => {
    const m = env.selMeasure ?? env.formatOf
    if (!m) throw new DaxError('CALC', 'ISSELECTEDMEASURE can only be used in a calculation item.')
    return a.some((x) => x.kind === 'column' && x.name.toLowerCase() === m.name.toLowerCase())
  },
  { min: 1 }
)
defineFn(
  'SELECTEDMEASUREFORMATSTRING',
  (ev, _a, env) => {
    const m = env.selMeasure ?? env.formatOf
    if (!m) throw new DaxError('CALC', 'SELECTEDMEASUREFORMATSTRING can only be used in a calculation item or a format string expression.')
    if (env.formatOf === m || !m.formatExpression) return m.formatString ?? null
    return ev.measureFormatString(m, env.ctx)
  },
  { max: 0 }
)
defineFn('__UDFTABLE', (ev, a, env) => ev.udfExprArg(a, env, true), { min: 2, max: 2, table: true })
defineFn(
  'TABLEOF',
  (ev, a, env) => {
    // the table of a column, of a measure (its home table) or a table reference, in the current filter context
    const arg = a[0]
    let t: string | null = null
    if (arg.kind === 'column') {
      const m = ev.measureFor(arg)
      t = m ? m.table.name : ev.resolveColumn(arg, 'TABLEOF').table.name
    } else if (arg.kind === 'ident' && ev.model.findTable(arg.name)) t = ev.model.findTable(arg.name)!.name
    if (!t) throw new DaxError('ARG', 'TABLEOF expects a column, measure, table or calendar reference.', arg)
    return ev.table({ kind: 'ident', name: t, quoted: true, s: arg.s, e: arg.e }, env, 'TABLEOF')
  },
  { min: 1, max: 1, table: true }
)
defineFn(
  'NAMEOF',
  (ev, a) => {
    const arg = a[0]
    if (arg.kind === 'column') {
      const m = ev.measureFor(arg)
      if (m) return `'${m.table.name}'[${m.name}]`
      const c = ev.resolveColumn(arg, 'NAMEOF')
      return `'${c.table.name}'[${c.name}]`
    }
    if (arg.kind === 'ident') {
      const t = ev.model.findTable(arg.name)
      if (t) return `'${t.name}'`
    }
    throw new DaxError('ARG', 'NAMEOF expects a column, measure or table reference.', arg)
  },
  { min: 1, max: 1, context: true }
)

// PATH ( id, parent ): delimited path from the root to the current row (parent-child hierarchies)
const pathIndexes = new WeakMap<DaxModel, { version: number; map: Map<string, Map<string, Scalar>> }>()
defineFn(
  'PATH',
  (ev, a, env) => {
    const idCol = ev.resolveColumn(a[0], 'PATH')
    const parentCol = ev.resolveColumn(a[1], 'PATH')
    let cache = pathIndexes.get(ev.model)
    if (!cache || cache.version !== ev.model.version) {
      cache = { version: ev.model.version, map: new Map() }
      pathIndexes.set(ev.model, cache)
    }
    const key = idCol.id + '|' + parentCol.id
    let parents = cache.map.get(key)
    if (!parents) {
      parents = new Map()
      for (let r = 0; r < idCol.table.rowCount; r++) {
        const id = idCol.value(r)
        if (id !== null) parents.set(tupleKey([id]), parentCol.value(r))
      }
      cache.map.set(key, parents)
    }
    let cur: Scalar = ev.rowValue(idCol, env, a[0])
    const out: string[] = []
    const seen = new Set<string>()
    while (cur !== null && cur !== '') {
      const k = tupleKey([cur])
      if (seen.has(k)) throw new DaxError('PATH', 'The PATH function found a loop in the parent-child hierarchy.')
      seen.add(k)
      out.unshift(toText(cur))
      const p = parents.get(k)
      if (p === undefined) break
      cur = p
    }
    return out.join('|')
  },
  { min: 2, max: 2 }
)

defineFn('ERROR', (ev, a, env) => {
  throw new DaxError('USER', toText(ev.scalar(a[0], env)))
}, { min: 1, max: 1 })
defineFn('EVALUATEANDLOG', (ev, a, env) => ev.value(a[0], env), { min: 1, max: 3 })

/** Extract the referenced object from a NAMEOF-style string ('T'[c] or [m]). */
export function parseNameRef(s: string): { table?: string; name: string } | null {
  const m = /^\s*(?:'((?:[^']|'')+)'|([^'[\]]+?))?\s*\[((?:[^\]]|\]\])+)\]\s*$/.exec(s)
  if (!m) return null
  const table = m[1]?.replace(/''/g, "'") ?? m[2]?.trim()
  return { table: table || undefined, name: m[3].replace(/]]/g, ']') }
}

export { isTable, toText, tupleKey }
