/**
 * Vertical fusion for SUMMARIZECOLUMNS (visual queries): extension expressions that are simple aggregations of a
 * fact table column (SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, COUNTROWS, DISTINCTCOUNT — directly or through measure
 * references, optionally wrapped in a filter-less CALCULATE) are computed for every group in one scan of the fact
 * table's visible rows, like a VertiPaq storage-engine query with a group-by, instead of one filtered scan per cell.
 * When every extension is fused, only the group combinations that occur in the fact table are evaluated (the others
 * would be all-blank rows, which SUMMARIZECOLUMNS removes).
 *
 * Exactness conditions (otherwise the per-cell path is used): every group-by table is reached from the fact table
 * through regular many-to-one relationships, no bidirectional / one-to-one / weak relationship can carry a group
 * filter back into the fact table, no calculation group applies, and the aggregation does not depend on the cell
 * beyond its group filters.
 */
import type { Evaluator } from './evaluator.ts'
import { colMask, eqFilter, filterTouches, type FilterContext } from './filters.ts'
import type { Col, Measure, Tbl } from './model.ts'
import type { Node } from './parser.ts'
import { scopeGet, type Env, type RowCtx, type Scope } from './registry.ts'
import type { TableValue } from './table.ts'
import { clean15, KahanSum, sortCompare, type Scalar } from './values.ts'

type AggFn = 'SUM' | 'AVERAGE' | 'MIN' | 'MAX' | 'COUNT' | 'COUNTA' | 'COUNTROWS' | 'DISTINCTCOUNT' | 'DISTINCTCOUNTNOBLANK'

export interface SimpleAgg {
  fn: AggFn
  col: Col | null
  table: Tbl
  /** CALCULATE filter arguments applied around the aggregation (context-independent ones only) */
  filters: Node[]
  /** cell-invariant variables the filter arguments refer to (hoisted, see CellInvariance) */
  scope?: Scope
}

/**
 * Hoisting of cell-invariant variables (SUMMARIZECOLUMNS fusion): a measure such as
 *   VAR ids = CALCULATETABLE ( VALUES ( Org[id] ), FILTER ( ALL ( Org ), Org[parent] IN VALUES ( Org[id] ) ) )
 *   RETURN CALCULATE ( [Sessions], CROSSFILTER ( Org[id], Fact[org], NONE ), TREATAS ( ids, Fact[org] ) )
 * is a simple aggregation with constant filters when its variables have the same value in every cell: their
 * expressions read only tables (footprint) whose relevant filters the group-by filters do not change (the group
 * columns do not reach them), they use no scope / shadow-dependent function, and they refer only to such variables.
 * The variables are then evaluated once in the query context and bound for the filter arguments.
 */
export interface CellInvariance {
  base: FilterContext
  /** base plus one equality filter per group column */
  probe: FilterContext
  env: Env
}

const SCOPE_DEPENDENT = new Set(['ISINSCOPE', 'ALLSELECTED', 'OFFSET', 'INDEX', 'WINDOW', 'RANK', 'ROWNUMBER', 'SELECTEDMEASURE', 'SELECTEDMEASURENAME', 'ISSELECTEDMEASURE', 'SELECTEDMEASUREFORMATSTRING', 'EARLIER', 'EARLIEST', 'ISSUBTOTAL', 'CURRENTGROUP'])

function invariantExpr(ev: Evaluator, n: Node, scope: Scope, inv: CellInvariance): boolean {
  const fp = ev.nodeFootprint(n, ev.home)
  if (!fp) return false
  for (const t of fp.tables) {
    const a = inv.base.relevantKey(t)
    if (a === null || a !== inv.probe.relevantKey(t)) return false
  }
  let ok = true
  const local = new Set<string>()
  ev.walkNodes(n, (x) => {
    if (x.kind === 'var') x.decls.forEach((d) => local.add(d.name.toLowerCase()))
    else if (x.kind === 'call' && SCOPE_DEPENDENT.has(x.name.toUpperCase())) ok = false
  })
  if (!ok) return false
  ev.walkNodes(n, (x) => {
    if (x.kind !== 'ident' || x.name === '__missing__') return
    const k = x.name.toLowerCase()
    if (local.has(k)) return
    for (let sc: Scope | null = scope; sc; sc = sc.parent) if (scopeGet(sc, k)) return
    if (!ev.model.findTable(x.name)) ok = false
  })
  return ok
}

const AGGS = new Set<string>(['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'COUNTROWS', 'DISTINCTCOUNT', 'DISTINCTCOUNTNOBLANK'])

/** The simple aggregation an expression is equivalent to at a SUMMARIZECOLUMNS cell, or null. */
export function simpleAggOf(ev: Evaluator, node: Node, depth = 0, inv?: CellInvariance, scope?: Scope): SimpleAgg | null {
  if (depth > 20) return null
  if (node.kind === 'var') {
    if (!inv) return null
    const sc: Scope = { vars: new Map(), parent: scope ?? inv.env.scope }
    for (const d of node.decls) {
      if (!invariantExpr(ev, d.expr, sc, inv)) return null
      const env: Env = { ...inv.env, ctx: inv.base, rows: [], transitioned: 0, scope: { vars: new Map(sc.vars), parent: sc.parent } }
      let v
      try {
        v = ev.value(d.expr, env)
      } catch {
        return null
      }
      sc.vars.set(d.name.toLowerCase(), { node: d.expr, env, value: v })
    }
    const r = simpleAggOf(ev, node.body, depth + 1, inv, sc)
    return r && (r.filters.length ? { ...r, scope: r.scope ?? sc } : r)
  }
  if (node.kind === 'column') {
    const m = ev.measureFor(node)
    if (!m) return null
    let ast: Node
    try {
      ast = ev.measureAst(m)
    } catch {
      return null
    }
    const home = ev.home
    ev.home = m.table
    try {
      return simpleAggOf(ev, ast, depth + 1, inv)
    } finally {
      ev.home = home
    }
  }
  if (node.kind !== 'call') return null
  const fn = node.name.toUpperCase()
  if (fn === 'CALCULATE' && node.args.length >= 1) {
    const inner = simpleAggOf(ev, node.args[0], depth + 1, inv, scope)
    if (!inner) return null
    const filters = node.args.slice(1)
    if (!filters.length) return inner
    if (!filters.every((f) => constantFilter(ev, f, scope))) return null
    if (inner.scope && scope && inner.scope !== scope) return null
    if (inner.filters.length) {
      // nested CALCULATEs apply their filters in order; with pure filters on disjoint (non-date) columns the order
      // does not matter, so they merge into one filter set
      const a = pureFilterCols(ev, filters)
      const b = pureFilterCols(ev, inner.filters)
      if (!a || !b) return null
      for (const c of a) if (b.has(c) || c.dataType === 'dateTime') return null
      for (const c of b) if (c.dataType === 'dateTime') return null
      return { ...inner, filters: [...filters, ...inner.filters], scope: inner.scope ?? scope }
    }
    return { ...inner, filters, scope: inner.scope ?? scope }
  }
  if (!AGGS.has(fn) || node.args.length !== 1) return null
  const arg = node.args[0]
  if (fn === 'COUNTROWS') {
    if (arg.kind !== 'ident' || ev.queryTables.has(arg.name.toLowerCase())) return null
    const t = ev.model.findTable(arg.name)
    return t ? { fn, col: null, table: t, filters: [] } : null
  }
  if (arg.kind !== 'column' || ev.measureFor(arg)) return null
  const col = ev.tryColumn(arg)
  if (!col) return null
  if ((fn === 'SUM' || fn === 'AVERAGE') && col.dataType === 'string') return null
  return { fn: fn as AggFn, col, table: col.table, filters: [] }
}

/**
 * CALCULATE filter arguments whose effect does not depend on the cell: predicates over one column with constants,
 * ALL / REMOVEFILTERS / ALLNOBLANKROW, FILTER over ALL of columns with such a predicate, TREATAS of literals,
 * KEEPFILTERS of those.
 */
function constantFilter(ev: Evaluator, n: Node, scope?: Scope): boolean {
  if (n.kind === 'call') {
    const fn = n.name.toUpperCase()
    if (fn === 'KEEPFILTERS') return n.args.length === 1 && constantFilter(ev, n.args[0], scope)
    // relationship changes are context-independent
    if (fn === 'CROSSFILTER' || fn === 'USERELATIONSHIP') return n.args.slice(0, 2).every((a) => a.kind === 'column' && !!ev.tryColumn(a))
    // TREATAS of a hoisted (cell-invariant) table variable
    if (fn === 'TREATAS' && scope && n.args[0]?.kind === 'ident' && boundIn(scope, n.args[0].name) && n.args.slice(1).every((a) => a.kind === 'column' && !!ev.tryColumn(a))) return true
    if (fn === 'ALL' || fn === 'REMOVEFILTERS' || fn === 'ALLNOBLANKROW') return n.args.every((a) => (a.kind === 'column' && !!ev.tryColumn(a)) || (a.kind === 'ident' && !!ev.model.findTable(a.name)))
    if (fn === 'FILTER') {
      const src = n.args[0]
      if (!src || src.kind !== 'call' || !['ALL', 'ALLNOBLANKROW'].includes(src.name.toUpperCase()) || !src.args.every((a) => a.kind === 'column' && !!ev.tryColumn(a))) return false
      const cols = new Set(src.args.map((a) => ev.tryColumn(a)!))
      return pureOver(ev, n.args[1], cols)
    }
    if (fn === 'TREATAS') return n.args[0]?.kind === 'tableCtor' && literalTable(n.args[0]) && n.args.slice(1).every((a) => a.kind === 'column' && !!ev.tryColumn(a))
  }
  // boolean column predicate
  const cols = new Set<Col>()
  if (!collectCols(ev, n, cols) || cols.size !== 1) return false
  return pureOver(ev, n, cols)
}

function boundIn(scope: Scope, name: string): boolean {
  const k = name.toLowerCase()
  for (let sc: Scope | null = scope; sc; sc = sc.parent) if (scopeGet(sc, k)) return true
  return false
}

/** Columns set by constant filter arguments that only add filters (no ALL / REMOVEFILTERS), or null. */
function pureFilterCols(ev: Evaluator, filters: Node[]): Set<Col> | null {
  const out = new Set<Col>()
  for (const n of filters) {
    let x = n
    while (x.kind === 'call' && x.name.toUpperCase() === 'KEEPFILTERS' && x.args.length === 1) x = x.args[0]
    if (x.kind === 'call') {
      const fn = x.name.toUpperCase()
      if (fn === 'ALL' || fn === 'REMOVEFILTERS' || fn === 'ALLNOBLANKROW') return null
      if (fn === 'CROSSFILTER' || fn === 'USERELATIONSHIP') continue
      if (fn === 'FILTER' || fn === 'TREATAS') {
        const src = fn === 'FILTER' ? (x.args[0] as Extract<Node, { kind: 'call' }>).args : x.args.slice(1)
        for (const a of src) {
          const c = ev.tryColumn(a as Extract<Node, { kind: 'column' }>)
          if (!c) return null
          out.add(c)
        }
        continue
      }
    }
    if (!collectCols(ev, x, out)) return null
  }
  return out
}

function literalTable(n: Node): boolean {
  return n.kind === 'tableCtor' && n.rows.every((r) => r.every((x) => x.kind === 'number' || x.kind === 'string' || x.kind === 'bool' || (x.kind === 'unary' && x.operand.kind === 'number') || (x.kind === 'call' && ['DATE', 'BLANK', 'TRUE', 'FALSE'].includes(x.name.toUpperCase()) && x.args.every((y) => y.kind === 'number'))))
}

/** Expression that only reads the given columns (row context) and constants. */
function pureOver(ev: Evaluator, n: Node, cols: Set<Col>): boolean {
  switch (n.kind) {
    case 'number':
    case 'string':
    case 'bool':
      return true
    case 'column': {
      if (ev.measureFor(n)) return false
      const c = ev.tryColumn(n)
      return !!c && cols.has(c)
    }
    case 'binary':
      return pureOver(ev, n.left, cols) && pureOver(ev, n.right, cols)
    case 'unary':
      return pureOver(ev, n.operand, cols)
    case 'tableCtor':
      return literalTable(n)
    case 'call': {
      const fn = n.name.toUpperCase()
      if (!['AND', 'OR', 'NOT', 'ISBLANK', 'BLANK', 'TRUE', 'FALSE', 'DATE', 'CONTAINSSTRING', 'LEFT', 'RIGHT', 'UPPER', 'LOWER', 'YEAR', 'MONTH', 'IF', 'ABS', 'VALUE', 'LEN', 'SEARCH', 'FIND'].includes(fn)) return false
      return n.args.every((a) => pureOver(ev, a, cols))
    }
    default:
      return false
  }
}

function collectCols(ev: Evaluator, n: Node, out: Set<Col>): boolean {
  switch (n.kind) {
    case 'column': {
      if (ev.measureFor(n)) return false
      const c = ev.tryColumn(n)
      if (!c) return false
      out.add(c)
      return true
    }
    case 'binary':
      return collectCols(ev, n.left, out) && collectCols(ev, n.right, out)
    case 'unary':
      return collectCols(ev, n.operand, out)
    case 'call':
      return n.args.every((a) => collectCols(ev, a, out))
    case 'tableCtor':
      return true
    default:
      return true
  }
}

export interface Fused {
  /** value of aggregation `k` at a combination of the group columns' codes (null when no rows) */
  valueAt(k: number, codes: ArrayLike<number>): Scalar
  /** codes of every combination that occurs for an aggregation without filter arguments (in `cols` order) */
  keys: Map<number | string, Int32Array>
  /** every aggregation groups by all the columns: `keys` holds every combination with a non-blank value */
  complete: boolean
  keyOf: (codes: ArrayLike<number>) => number | string
}

let fusionEnabled = true
/** Tests: disable fusion to compare against per-cell evaluation. */
export function setFusionEnabled(on: boolean): void {
  fusionEnabled = on
}

/** One scan per (fact table, filter set): aggregate every simple aggregation per group of `cols` codes. null = not applicable. */
export function fuse(ev: Evaluator, base: FilterContext, cols: Col[], aggs: SimpleAgg[], env: Env): Fused | null {
  if (cols.length === 0 || !fusionEnabled) return null
  for (const g of ev.model.calcGroups) {
    if (ev.selectedCalcItem(g, base)) return null
    if (cols.some((c) => c.table === g.table)) return null
  }
  const keyFn = (cs: Col[]) => {
    let prod = 1
    for (const c of cs) prod *= c.dict.length
    const radix = prod < 2 ** 52
    return (codes: ArrayLike<number>): number | string => {
      if (radix) {
        let v = 0
        for (let j = 0; j < cs.length; j++) v = v * cs[j].dict.length + codes[j]
        return v
      }
      return Array.prototype.join.call(codes, ',')
    }
  }
  const keyOf = keyFn(cols)
  const keys = new Map<number | string, Int32Array>()
  // aggregations sharing a filter-argument list (same AST array) share their context
  const groupsByFilters = new Map<Node[] | null, number[]>()
  aggs.forEach((a, k) => {
    const f = a.filters.length ? a.filters : null
    groupsByFilters.set(f, [...(groupsByFilters.get(f) ?? []), k])
  })
  const lookups: Array<(codes: ArrayLike<number>) => Scalar> = new Array(aggs.length)
  let complete = true
  for (const [filters, idxs] of groupsByFilters) {
    let ctx = base
    let used = cols.map((_, j) => j)
    if (filters) {
      // group columns whose filter the CALCULATE arguments remove or replace do not split the result
      const probeFs = cols.map((c) => eqFilter(c, c.dict.length > 1 ? 1 : 0))
      const probe = base.addFilters(probeFs, false)
      let after: FilterContext
      try {
        const scope = aggs[idxs[0]].scope ?? env.scope
        after = ev.calculateContext(filters, { ...env, ctx: probe, rows: [], transitioned: 0, scope })
        ctx = ev.calculateContext(filters, { ...env, ctx: base, rows: [], transitioned: 0, scope })
      } catch {
        return null
      }
      used = used.filter((j) => after.filters.includes(probeFs[j]))
    }
    if (used.length !== cols.length) complete = false
    const usedCols = used.map((j) => cols[j])
    const usedKey = keyFn(usedCols)
    const byTable = new Map<Tbl, number[]>()
    for (const k of idxs) byTable.set(aggs[k].table, [...(byTable.get(aggs[k].table) ?? []), k])
    for (const [T, ks] of byTable) {
      const exp = ctx.expansion(T)
      const via: Int32Array[] = []
      for (const c of usedCols) {
        const st = exp.stepOf.get(c.table)
        if (!st) return null
        via.push(ev.model.codesVia(st.path, c))
      }
      if (!ctx.noUphillFilters(T)) return null
      const vis = ctx.visible(T)
      const gid = new Int32Array(vis.length)
      const local = new Map<number | string, number>()
      const gkeys: Array<number | string> = []
      const codes = new Int32Array(usedCols.length)
      for (let i = 0; i < vis.length; i++) {
        const r = vis[i]
        for (let j = 0; j < via.length; j++) codes[j] = via[j][r]
        const k = usedKey(codes)
        let g = local.get(k)
        if (g === undefined) {
          g = gkeys.length
          local.set(k, g)
          gkeys.push(k)
          if (usedCols.length === cols.length && !keys.has(k)) keys.set(k, codes.slice())
        }
        gid[i] = g
      }
      for (const k of ks) {
        const vals = aggregateBy(aggs[k], vis, gid, gkeys.length)
        const m = new Map<number | string, Scalar>()
        for (let g = 0; g < gkeys.length; g++) if (vals[g] !== null) m.set(gkeys[g], vals[g])
        const sub = new Int32Array(used.length)
        lookups[k] = (all) => {
          for (let q = 0; q < used.length; q++) sub[q] = all[used[q]]
          return m.get(usedKey(sub)) ?? null
        }
      }
    }
  }
  return { valueAt: (k, codes) => lookups[k](codes), keys, complete, keyOf }
}

function aggregateBy(a: SimpleAgg, vis: Int32Array, gid: Int32Array, G: number): Scalar[] {
  const out = new Array<Scalar>(G).fill(null)
  if (a.fn === 'COUNTROWS') {
    const n = new Int32Array(G)
    for (let i = 0; i < vis.length; i++) n[gid[i]]++
    for (let g = 0; g < G; g++) if (n[g]) out[g] = n[g]
    return out
  }
  const col = a.col!
  const codes = col.codes
  const num = col.num
  switch (a.fn) {
    case 'SUM':
    case 'AVERAGE': {
      const sums = Array.from({ length: G }, () => new KahanSum())
      const cnt = new Int32Array(G)
      for (let i = 0; i < vis.length; i++) {
        const c = codes[vis[i]]
        if (c === 0) continue
        sums[gid[i]].add(num[c])
        cnt[gid[i]]++
      }
      for (let g = 0; g < G; g++) if (cnt[g]) out[g] = clean15(a.fn === 'SUM' ? sums[g].sum : sums[g].sum / cnt[g])
      return out
    }
    case 'COUNT':
    case 'COUNTA': {
      const cnt = new Int32Array(G)
      for (let i = 0; i < vis.length; i++) if (codes[vis[i]] !== 0) cnt[gid[i]]++
      for (let g = 0; g < G; g++) if (cnt[g]) out[g] = cnt[g]
      return out
    }
    case 'MIN':
    case 'MAX': {
      const max = a.fn === 'MAX'
      const best = new Int32Array(G).fill(-1)
      const numeric = col.dataType !== 'string' && col.dataType !== 'variant' && col.dataType !== 'unknown'
      for (let i = 0; i < vis.length; i++) {
        const c = codes[vis[i]]
        if (c === 0) continue
        const g = gid[i]
        const b = best[g]
        if (b < 0) best[g] = c
        else if (numeric ? (max ? num[c] > num[b] : num[c] < num[b]) : max ? sortCompare(col.dict[c], col.dict[b]) > 0 : sortCompare(col.dict[c], col.dict[b]) < 0) best[g] = c
      }
      for (let g = 0; g < G; g++) if (best[g] >= 0) out[g] = col.dict[best[g]]
      return out
    }
    case 'DISTINCTCOUNT':
    case 'DISTINCTCOUNTNOBLANK': {
      const sets = Array.from({ length: G }, () => new Set<number>())
      for (let i = 0; i < vis.length; i++) {
        const c = codes[vis[i]]
        if (c === 0 && a.fn === 'DISTINCTCOUNTNOBLANK') continue
        sets[gid[i]].add(c)
      }
      for (let g = 0; g < G; g++) if (sets[g].size) out[g] = sets[g].size
      return out
    }
  }
  return out
}

/**
 * Iteration fusion: an iterator over a table of distinct column values (VALUES / DISTINCT / SUMMARIZE of model
 * columns) whose expression evaluates simple aggregations through context transition — `CALCULATE ( agg )` or a
 * measure reference, e.g. SUMX ( VALUES ( T[k] ), MIN ( CALCULATE ( MAX ( T[cap] ) ), [Used] ) ) — gets every
 * row's aggregations from one grouped scan (fuse) instead of one transition and filtered scan per row.
 *
 * Exact because the row's transition filter is `columns = row values`, which is a group of `fuse` over the same
 * columns: the iterator must have no outer row context left to transition, filters already on the iterated columns
 * must be single-column filters (intersection = replacement for the values they allow; other rows fall back), and the
 * override applies only when a site is evaluated directly in the iteration's row context (same filter context,
 * no other row context opened).
 */
export interface IterFusion {
  ctx: FilterContext
  depth: number
  /** env.transitioned when the fusion applies (default: depth, i.e. no untransitioned outer row) */
  transitioned?: number
  /** the outer row contexts (identity) when there are untransitioned ones */
  prefix?: readonly RowCtx[]
  rc: RowCtx
  sites: Map<Node | Measure, number>
  /** value of site `k` at row `i`, or undefined to evaluate normally */
  valueAt(k: number, i: number): Scalar | undefined
}

export function iterationFusion(ev: Evaluator, body: Node, t: TableValue, env: Env, rc: RowCtx): IterFusion | null {
  if (!fusionEnabled || t.n < 16 || t.base || env.rows.length !== env.transitioned) return null
  if (env.applied || env.selMeasure || env.formatOf || ev.model.calcGroups.length) return null
  const cols: Col[] = []
  for (const c of t.cols) {
    if (!c.lineage || cols.includes(c.lineage)) return null
    cols.push(c.lineage)
  }
  if (!cols.length) return null
  const ids = new Set(cols.map((c) => c.id))
  const masks: Array<[number, Uint8Array]> = []
  for (const f of env.ctx.filters) {
    if (!filterTouches(ev.model, env.ctx.cfg, f, ids)) continue
    if (f.kind !== 'col') return null
    masks.push([cols.indexOf(f.col), colMask(f)])
  }
  const found = transitionSites(ev, body)
  if (!found) return null
  const { sites, aggs } = found
  let fused: Fused | null
  try {
    fused = fuse(ev, env.ctx, cols, aggs, env)
  } catch {
    return null
  }
  if (!fused) return null
  const f = fused
  const codes = new Int32Array(cols.length)
  let at = -1
  let ok = false
  const rowCodes = (i: number): boolean => {
    if (at === i) return ok
    at = i
    ok = false
    for (let j = 0; j < cols.length; j++) {
      const c = cols[j]
      const d = t.data[j]
      const code = Array.isArray(d) ? c.codeOf(d[i] ?? null) : d.col === c ? c.codes[d.ids[i]] : c.codeOf(t.get(i, j))
      if (code < 0 || code === undefined) return false
      codes[j] = code
    }
    for (const [j, mask] of masks) if (!mask[codes[j]]) return false
    ok = true
    return true
  }
  return {
    ctx: env.ctx,
    depth: env.rows.length,
    rc,
    sites,
    valueAt: (k, i) => (rowCodes(i) ? f.valueAt(k, codes) : undefined)
  }
}

type Sites = { sites: Map<Node | Measure, number>; aggs: SimpleAgg[] } | null
const siteCaches = new WeakMap<Evaluator, WeakMap<Node, Map<Tbl | null, Sites>>>()
/** CALCULATE nodes and measure references of an expression that are simple aggregations (cached per expression). */
function transitionSites(ev: Evaluator, body: Node): Sites {
  let cache = siteCaches.get(ev)
  if (!cache) siteCaches.set(ev, (cache = new WeakMap()))
  let byHome = cache.get(body)
  if (!byHome) cache.set(body, (byHome = new Map()))
  if (byHome.has(ev.home)) return byHome.get(ev.home)!
  const sites = new Map<Node | Measure, number>()
  const aggs: SimpleAgg[] = []
  const visit = (n: Node): void => {
    if (n.kind === 'column') {
      const m = ev.measureFor(n)
      if (m && !sites.has(m)) {
        const a = simpleAggOf(ev, n)
        if (a) sites.set(m, aggs.push(a) - 1)
      }
      return
    }
    if (n.kind === 'call' && n.name.toUpperCase() === 'CALCULATE' && !sites.has(n)) {
      const a = simpleAggOf(ev, n)
      if (a) sites.set(n, aggs.push(a) - 1)
    }
    if (n.kind === 'call') n.args.forEach(visit)
    else if (n.kind === 'binary') {
      visit(n.left)
      visit(n.right)
    } else if (n.kind === 'unary') visit(n.operand)
    else if (n.kind === 'var') {
      n.decls.forEach((d) => visit(d.expr))
      visit(n.body)
    } else if (n.kind === 'tuple') n.items.forEach(visit)
  }
  visit(body)
  const out = aggs.length ? { sites, aggs } : null
  byHome.set(ev.home, out)
  return out
}

/**
 * TREATAS row-value fusion: an iterator over the rows of a table whose expression evaluates
 *   CALCULATE ( <simple aggregation of F>, [CROSSFILTER / USERELATIONSHIP ...,] TREATAS ( { T[c] }, F[k] ) )
 * where T[c] is a column of the iterated row (e.g. SUMX ( Orgs, CALCULATE ( [Headcount], CROSSFILTER ( Org[oid],
 * Pop[oid], NONE ), TREATAS ( { Org[oid] }, Pop[oid] ) ) ) inside AVERAGEX over dates). Every row's value comes from
 * one scan of F grouped by F[k] instead of one context transition and filtered scan per row.
 *
 * Exact when the context transition of the iterated row does not reach F under the CALCULATE's relationship
 * changes (Evaluator.transitionSkips says the row can be skipped): the CALCULATE context is then the transition of
 * the outer rows, with the relationship changes, without filters on F[k] (TREATAS replaces them), plus F[k] = the
 * row's value — so the row's value is the group F[k] = value of a grouped scan over that context.
 */
export function treatasFusion(ev: Evaluator, body: Node, t: TableValue, env: Env, rc: RowCtx): IterFusion | null {
  if (!fusionEnabled || t.n < 16) return null
  if (env.applied || env.selMeasure || env.formatOf || ev.model.calcGroups.length) return null
  const sites = new Map<Node | Measure, number>()
  const plans: Array<{ node: Extract<Node, { kind: 'call' }>; agg: SimpleAgg; key: Col; src: number; mods: Node[] }> = []
  const visit = (n: Node): void => {
    if (n.kind === 'call') {
      if (n.name.toUpperCase() === 'CALCULATE' && !sites.has(n)) {
        const p = treatasSite(ev, n, t)
        if (p) sites.set(n, plans.push(p) - 1)
      }
      n.args.forEach(visit)
    } else if (n.kind === 'binary') {
      visit(n.left)
      visit(n.right)
    } else if (n.kind === 'unary') visit(n.operand)
    else if (n.kind === 'var') {
      n.decls.forEach((d) => visit(d.expr))
      visit(n.body)
    }
  }
  visit(body)
  if (!plans.length) return null
  const rows = [...env.rows, rc]
  const lookups: Array<(i: number) => Scalar> = []
  for (const p of plans) {
    let ctx: FilterContext
    try {
      // relationship changes of the CALCULATE (context-independent)
      const modsCtx = ev.calculateContext(p.mods, { ...env, rows: [], transitioned: 0 })
      const fp = ev.nodeFootprint(p.node.args[0], ev.home)
      if (!fp) return null
      const skips = ev.transitionSkips({ ...env, rows, ctx: env.ctx }, fp, modsCtx.cfg)
      if (!skips || !skips.has(env.rows.length)) return null
      const outer = new Set([...skips].filter((k) => k < env.rows.length))
      ctx = ev.transition(env, outer.size ? outer : null)
      ctx = ctx.with({ cfg: modsCtx.cfg }).removeColumns(new Set([p.key.id]))
      if (p.agg.filters.length) ctx = ev.calculateContext(p.agg.filters, { ...env, ctx, rows: [], transitioned: 0 })
      if (!ctx.noUphillFilters(p.agg.table)) return null
    } catch {
      return null
    }
    const vis = ctx.visible(p.agg.table)
    const kc = p.key.codes
    const groupOf = new Int32Array(p.key.dict.length).fill(-1)
    const gid = new Int32Array(vis.length)
    let G = 0
    for (let i = 0; i < vis.length; i++) {
      const c = kc[vis[i]]
      if (groupOf[c] < 0) groupOf[c] = G++
      gid[i] = groupOf[c]
    }
    const vals = aggregateBy(p.agg, vis, gid, G)
    const key = p.key
    const src = p.src
    lookups.push((i) => {
      const code = key.codeOf(t.get(i, src))
      if (code < 0) return null
      const g = groupOf[code]
      return g < 0 ? null : vals[g]
    })
  }
  return {
    ctx: env.ctx,
    depth: env.rows.length,
    transitioned: env.transitioned,
    prefix: env.rows,
    rc,
    sites,
    valueAt: (k, i) => lookups[k](i)
  }
}

function treatasSite(ev: Evaluator, n: Extract<Node, { kind: 'call' }>, t: TableValue): { node: Extract<Node, { kind: 'call' }>; agg: SimpleAgg; key: Col; src: number; mods: Node[] } | null {
  if (n.args.length < 2) return null
  let tr: Extract<Node, { kind: 'call' }> | null = null
  const mods: Node[] = []
  for (const a of n.args.slice(1)) {
    if (a.kind !== 'call') return null
    const fn = a.name.toUpperCase()
    if (fn === 'CROSSFILTER' || fn === 'USERELATIONSHIP') mods.push(a)
    else if (fn === 'TREATAS' && !tr) tr = a
    else return null
  }
  if (!tr || tr.args.length !== 2) return null
  const [tbl, target] = tr.args
  if (tbl.kind !== 'tableCtor' || tbl.rows.length !== 1 || tbl.rows[0].length !== 1) return null
  const item = tbl.rows[0][0]
  if (item.kind !== 'column' || ev.measureFor(item)) return null
  const srcCol = ev.tryColumn(item)
  if (!srcCol) return null
  const src = t.indexOfLineage(srcCol)
  if (src < 0) return null
  if (target.kind !== 'column') return null
  const key = ev.tryColumn(target)
  if (!key || key.dataType === 'dateTime') return null
  const agg = simpleAggOf(ev, n.args[0])
  if (!agg || agg.table !== key.table) return null
  if (agg.filters.length) {
    const cols = pureFilterCols(ev, agg.filters)
    if (!cols || cols.has(key)) return null
  }
  return { node: n, agg, key, src, mods }
}
