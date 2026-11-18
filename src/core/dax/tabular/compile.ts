/**
 * Row-expression compiler for iterators (FILTER, SUMX & co., ADDCOLUMNS, calculated columns...).
 *
 * `rowFn(ev, node, t, env)` returns `(i) => value of node in the row context of row i of t`, with exactly the
 * semantics of `ev.scalar(node, ev.withRow(env, t, i))`, but:
 *
 *  1. Row-independent subexpressions are hoisted: a subtree that cannot observe the current row (no reference to a
 *     column of `t`, no measure reference, no CALCULATE / context transition, no row-reading function such as
 *     RELATED / EARLIER / RAND) is evaluated once, lazily, in the outer environment. `FILTER ( ALL ( 'Date' ),
 *     'Date'[Index] <= MAX ( 'Date'[Index] ) )` evaluates MAX once instead of once per row. `EARLIER ( col )` whose
 *     target is the outer row becomes a hoisted reference to that outer value.
 *  2. The rest is compiled to closures for the common shapes (columns of `t`, literals, operators, IF, AND/OR/NOT,
 *     ISBLANK, DIVIDE, COALESCE, RELATED over a base table) — no AST walk, environment allocation or name lookup per
 *     row. Any other dependent node is interpreted per row (with the hoisted values still shared).
 *  3. When the compiled expression reads a single model column of `t` and nothing else of the row, its value is
 *     memoized per dictionary code (a FILTER over a 1M-row table evaluates its predicate once per distinct value).
 */
import { DaxError } from './errors.ts'
import type { Evaluator } from './evaluator.ts'
import type { Col } from './model.ts'
import type { Node } from './parser.ts'
import { iterationFusion, treatasFusion } from './fusion.ts'
import { FN_META, FUNCTIONS, scopeGet, type Binding, type Env, type RowCtx, type Scope } from './registry.ts'
import { isTable, type TableValue, type TCol } from './table.ts'
import { arithmetic, compare, sameValue, toBool, toNumber, toText, type Scalar } from './values.ts'

export type RowFn = (i: number) => Scalar

/** Functions that observe the row context (context transition, RELATED-like row reads) or are non-deterministic. */
const ROW_DEPENDENT = new Set([
  'CALCULATE', 'CALCULATETABLE', 'RELATEDTABLE', 'ISFILTERED', 'ISCROSSFILTERED', 'ISINSCOPE', 'ISEMPTY', 'ALLSELECTED',
  'ALLEXCEPT', 'ALLCROSSFILTERED', 'SUMMARIZE', 'SUMMARIZECOLUMNS', 'SELECTEDMEASURE', 'SELECTEDMEASURENAME', 'ISSELECTEDMEASURE',
  'SELECTEDMEASUREFORMATSTRING', 'DATESYTD', 'DATESQTD', 'DATESMTD', 'TOTALYTD', 'TOTALQTD', 'TOTALMTD', 'SAMEPERIODLASTYEAR', 'DATEADD',
  'PARALLELPERIOD', 'PREVIOUSDAY', 'PREVIOUSMONTH', 'PREVIOUSQUARTER', 'PREVIOUSYEAR', 'NEXTDAY', 'NEXTMONTH', 'NEXTQUARTER', 'NEXTYEAR',
  'STARTOFMONTH', 'STARTOFQUARTER', 'STARTOFYEAR', 'ENDOFMONTH', 'ENDOFQUARTER', 'ENDOFYEAR', 'OPENINGBALANCEMONTH',
  'OPENINGBALANCEQUARTER', 'OPENINGBALANCEYEAR', 'CLOSINGBALANCEMONTH', 'CLOSINGBALANCEQUARTER', 'CLOSINGBALANCEYEAR', 'FIRSTDATE',
  'LASTDATE', 'OFFSET', 'INDEX', 'WINDOW', 'RANK', 'ROWNUMBER', 'RAND', 'RANDBETWEEN', 'PATH', 'CURRENTGROUP', 'ISSUBTOTAL', 'GROUPBY',
  'EARLIEST', 'RUNNINGSUM', 'MOVINGAVERAGE', 'PREVIOUS', 'NEXT', 'FIRST', 'LAST', 'COLLAPSE', 'COLLAPSEALL', 'EXPAND', 'EXPANDALL',
  'RANGE', 'LOOKUP', 'LOOKUPWITHTOTALS', 'ISATLEVEL', 'DETAILROWS', 'NEWGUID'
])

/** Column aggregators: a bare column argument is not a row-context reference. */
const COLUMN_ARG = new Set([
  'SUM', 'AVERAGE', 'AVERAGEA', 'MIN', 'MAX', 'MINA', 'MAXA', 'COUNT', 'COUNTA', 'COUNTBLANK', 'DISTINCTCOUNT', 'DISTINCTCOUNTNOBLANK',
  'APPROXIMATEDISTINCTCOUNT', 'MEDIAN', 'PRODUCT', 'STDEV.S', 'STDEV.P', 'VAR.S', 'VAR.P', 'STDEV', 'STDEVA', 'VAR', 'VARA', 'GEOMEAN',
  'PERCENTILE.INC', 'PERCENTILE.EXC', 'VALUES', 'DISTINCT', 'ALL', 'ALLNOBLANKROW', 'SELECTEDVALUE', 'HASONEVALUE', 'HASONEFILTER',
  'FILTERS', 'COUNTROWS', 'NAMEOF', 'REMOVEFILTERS'
])

interface Plan {
  rewritten: Node
  hoisted: Array<{ name: string; node: Node }>
}

let hoistSeq = 0
const HOIST_PREFIX = '\u0002h'

// shape of a table for plan caching: interned id of its column list (lineage + names)
const colSigs = new WeakMap<readonly TCol[], number>()
const sigIds = new Map<string, number>()
let nextSigId = 1
function tSignature(t: TableValue, ev: Evaluator): string {
  let id = colSigs.get(t.cols)
  if (id === undefined) {
    let cs = ''
    for (const c of t.cols) cs += '|' + (c.lineage ? c.lineage.id : '') + ':' + c.name.toLowerCase()
    id = sigIds.get(cs)
    if (id === undefined) {
      if (sigIds.size > 100_000) sigIds.clear()
      id = nextSigId++ // never reused, so ids cached before a clear stay unique
      sigIds.set(cs, id)
    }
    colSigs.set(t.cols, id)
  }
  return (ev.home?.name ?? '') + (t.base ? '|B' : '|') + id
}

class Analyzer {
  readonly hoisted: Array<{ name: string; node: Node }> = []
  constructor(
    private readonly ev: Evaluator,
    private readonly t: TableValue
  ) {}

  /** Does `n` observe the current row of t (or anything that makes it unsafe to evaluate once outside the row)? */
  dep(n: Node, locals: ReadonlySet<string>): boolean {
    switch (n.kind) {
      case 'number':
      case 'string':
      case 'bool':
      case 'param':
        return false
      case 'ident':
        return locals.has(n.name.toLowerCase())
      case 'column':
        return this.columnDep(n)
      case 'call': {
        const fn = n.name.toUpperCase()
        if (ROW_DEPENDENT.has(fn) || !FUNCTIONS.has(fn)) return true
        if (fn === 'EARLIER') return true
        if (fn === 'RELATED') return !!this.t.base || this.t.cols.some((c) => c.lineage)
        if (COLUMN_ARG.has(fn)) return n.args.some((a) => !this.isModelColumnArg(a) && this.dep(a, locals))
        return n.args.some((a) => this.dep(a, locals))
      }
      case 'binary':
        return this.dep(n.left, locals) || this.dep(n.right, locals)
      case 'unary':
        return this.dep(n.operand, locals)
      case 'tuple':
        return n.items.some((x) => this.dep(x, locals))
      case 'tableCtor':
        return n.rows.some((r) => r.some((x) => this.dep(x, locals)))
      case 'var': {
        const inner = new Set(locals)
        let d = false
        for (const decl of n.decls) {
          if (this.dep(decl.expr, inner)) d = true
          inner.add(decl.name.toLowerCase())
        }
        return d || this.dep(n.body, inner)
      }
    }
  }

  private isModelColumnArg(a: Node): boolean {
    return a.kind === 'column' && a.table !== null && !this.ev.measureFor(a) && !!this.ev.tryColumn(a)
  }

  private columnDep(n: Extract<Node, { kind: 'column' }>): boolean {
    const t = this.t
    if (t.indexOfName(n.name) >= 0) return true
    if (this.ev.measureFor(n)) return true
    if (n.table !== null) {
      const c = this.ev.tryColumn(n)
      if (c && t.indexOfLineage(c) >= 0) return true
    }
    return false
  }

  private hoist(n: Node): Node {
    const name = HOIST_PREFIX + hoistSeq++
    this.hoisted.push({ name, node: n })
    return { kind: 'ident', name, quoted: false, s: n.s, e: n.e }
  }

  /**
   * Never hoisted: literals and bare identifiers. Identifiers are keyword arguments (DAY, ASC, DENSE, REL, BOTH...),
   * table names and variables; functions read keyword arguments from the AST, so they must stay in place.
   */
  private trivial(n: Node): boolean {
    return n.kind === 'number' || n.kind === 'string' || n.kind === 'bool' || n.kind === 'param' || n.kind === 'ident'
  }

  /** Replace maximal row-independent subtrees by hoisted references. */
  rewrite(n: Node, locals: ReadonlySet<string>): Node {
    if (!this.dep(n, locals)) return this.trivial(n) ? n : this.hoist(n)
    switch (n.kind) {
      case 'call': {
        const fn = n.name.toUpperCase()
        if (fn === 'EARLIER') return this.earlier(n, locals)
        if (ROW_DEPENDENT.has(fn) || !FUNCTIONS.has(fn)) {
          // keep the call (it needs the row), but hoist independent arguments that are plain values
          return n
        }
        if (COLUMN_ARG.has(fn)) return { ...n, args: n.args.map((a) => (this.isModelColumnArg(a) ? a : this.rewrite(a, locals))) }
        // functions that add row contexts (iterators) or evaluate arguments in another filter context are kept as
        // they are: inside them, column references and EARLIER levels are relative to their own rows
        const meta = FN_META.get(fn)
        if (fn === 'RELATED' || meta?.context || meta?.table) return n
        return { ...n, args: n.args.map((a) => this.rewrite(a, locals)) }
      }
      case 'binary':
        return { ...n, left: this.rewrite(n.left, locals), right: this.rewrite(n.right, locals) }
      case 'unary':
        return { ...n, operand: this.rewrite(n.operand, locals) }
      case 'tuple':
        return { ...n, items: n.items.map((x) => this.rewrite(x, locals)) }
      case 'tableCtor':
        return { ...n, rows: n.rows.map((r) => r.map((x) => this.rewrite(x, locals))) }
      case 'var': {
        const inner = new Set(locals)
        const decls = n.decls.map((d) => {
          const expr = this.rewrite(d.expr, inner)
          inner.add(d.name.toLowerCase())
          return { ...d, expr }
        })
        return { ...n, decls, body: this.rewrite(n.body, inner) }
      }
      default:
        return n
    }
  }

  /**
   * EARLIER ( col [, n] ) inside the iteration of t: when t has the column, the current row is the innermost hit,
   * so the result is EARLIER ( col, n - 1 ) of the outer environment (the plain column for n = 1): row-independent.
   */
  private earlier(n: Extract<Node, { kind: 'call' }>, locals: ReadonlySet<string>): Node {
    const target = n.args[0]
    const lvl = n.args[1]
    if (!target || target.kind !== 'column') return n
    const level = !lvl || (lvl.kind === 'ident' && lvl.name === '__missing__') ? 1 : lvl.kind === 'number' ? Math.trunc(lvl.value) : NaN
    if (!Number.isFinite(level) || level < 1) return n
    const c = this.ev.tryColumn(target)
    const inT = (c && this.t.indexOfLineage(c) >= 0) || (!c && this.t.indexOfName(target.name) >= 0)
    if (!inT) {
      // the current row is not a hit: same result as in the outer environment
      return this.hoist(n)
    }
    void locals
    if (level === 1) return this.hoist(target)
    return this.hoist({ ...n, args: [target, { kind: 'number', value: level - 1, s: lvl!.s, e: lvl!.e }] })
  }
}

function planFor(ev: Evaluator, node: Node, t: TableValue): Plan {
  const sig = tSignature(t, ev)
  let byNode = ev.rowPlans.get(node)
  if (!byNode) {
    byNode = new Map()
    ev.rowPlans.set(node, byNode)
  }
  let p = byNode.get(sig) as Plan | undefined
  if (!p) {
    const a = new Analyzer(ev, t)
    const rewritten = a.rewrite(node, new Set())
    p = { rewritten, hoisted: a.hoisted }
    byNode.set(sig, p)
  }
  return p
}

interface CompileState {
  ev: Evaluator
  t: TableValue
  rc: RowCtx
  rowEnv: Env
  scope: Scope
  /** t column indexes read by compiled getters */
  cols: Set<number>
  /** some node is interpreted with the whole row available */
  whole: boolean
}

/** `(i) => value of node for row i of t` (see module comment). */
export function rowFn(ev: Evaluator, node: Node, t: TableValue, env: Env): RowFn {
  const plan = planFor(ev, node, t)
  let scope = env.scope
  if (plan.hoisted.length) {
    const vars = new Map<string, Binding>()
    for (const h of plan.hoisted) vars.set(h.name.toLowerCase(), { node: h.node, env })
    scope = { vars, parent: env.scope }
  }
  const rc: RowCtx = { t, i: 0 }
  const rowEnv: Env = { ...env, scope, rows: [...env.rows, rc], shadows: [...(env.shadows ?? []), { t }] }
  const st: CompileState = { ev, t, rc, rowEnv, scope: scope!, cols: new Set(), whole: false }
  const f0 = compile(st, plan.rewritten)
  // transition sites with simple aggregations over distinct values: one grouped scan (fusion.ts)
  const fusion = st.whole ? (iterationFusion(ev, plan.rewritten, t, env, rc) ?? treatasFusion(ev, plan.rewritten, t, env, rc)) : null
  const f: RowFn = fusion
    ? (i) => {
        const prev = ev.iterFusion
        ev.iterFusion = fusion
        try {
          return f0(i)
        } finally {
          ev.iterFusion = prev
        }
      }
    : f0
  if (st.whole || st.cols.size > 1) return f
  if (st.cols.size === 0) {
    // constant over the iteration (still lazily evaluated, errors surface on first use)
    let done = false
    let v: Scalar = null
    return (i) => {
      if (!done) {
        v = f(i)
        done = true
      }
      return v
    }
  }
  const j = st.cols.values().next().value as number
  const d = t.data[j]
  if (Array.isArray(d) || t.n < 64) return f
  const col = d.col
  const ids = d.ids
  const memo = new Array<Scalar>(col.dict.length)
  const seen = new Uint8Array(col.dict.length)
  const g: RowFn & { byCode?: { col: Col; ids: Int32Array } } = (i) => {
    const code = col.codes[ids[i]]
    if (seen[code]) return memo[code]
    const v = f(i)
    memo[code] = v
    seen[code] = 1
    return v
  }
  g.byCode = { col, ids }
  return g
}

/**
 * FILTER helper: indexes of the rows of t for which `node` is true. A predicate that only reads one model column of a
 * table holding a whole base table (ALL ( 'Date' ), a table reference) is evaluated once per distinct value and the
 * matching rows come from the column's posting lists, instead of a pass over every row.
 */
export function filterRows(ev: Evaluator, node: Node, t: TableValue, env: Env): number[] | Int32Array {
  const f = rowFn(ev, node, t, env) as RowFn & { byCode?: { col: Col; ids: Int32Array } }
  const bc = f.byCode
  if (bc && isIdentity(bc.ids)) {
    const { col, ids } = bc
    const n = ids.length
    const post = ev.model.postings('|' + col.id, col.codes, col.dict.length, col.table.fullCount)
    let total = 0
    const pass: number[] = []
    for (let c = 0; c < col.dict.length; c++) {
      const s = post.offsets[c]
      const e = post.offsets[c + 1]
      if (s === e) continue
      const first = post.rows[s]
      if (first >= n) continue
      if (!toBool(f(first))) continue
      pass.push(c)
      total += e - s
    }
    const out = new Int32Array(total)
    let k = 0
    for (const c of pass) for (let q = post.offsets[c]; q < post.offsets[c + 1]; q++) if (post.rows[q] < n) out[k++] = post.rows[q]
    return out.subarray(0, k).sort()
  }
  const keep: number[] = []
  for (let i = 0; i < t.n; i++) if (toBool(f(i))) keep.push(i)
  return keep
}

function isIdentity(ids: Int32Array): boolean {
  for (let i = 0; i < ids.length; i++) if (ids[i] !== i) return false
  return true
}

function interpret(st: CompileState, n: Node): RowFn {
  st.whole = true
  const { ev, rc, rowEnv } = st
  return (i) => {
    rc.i = i
    return ev.scalar(n, rowEnv)
  }
}

function columnGetter(st: CompileState, j: number): RowFn {
  st.cols.add(j)
  const d = st.t.data[j]
  if (Array.isArray(d)) return (i) => d[i] ?? null
  const { col, ids } = d
  const dict = col.dict
  const codes = col.codes
  return (i) => dict[codes[ids[i]]]
}

function scalarOf(ev: Evaluator, v: unknown, n: Node): Scalar {
  return isTable(v) ? ev.tableToScalar(v as TableValue, n) : (v as Scalar)
}

function compile(st: CompileState, n: Node): RowFn {
  const { ev, t } = st
  switch (n.kind) {
    case 'number':
    case 'string':
    case 'bool': {
      const v = n.value
      return () => v
    }
    case 'ident': {
      if (n.name.startsWith(HOIST_PREFIX)) {
        const b = st.scope.vars.get(n.name.toLowerCase())!
        let done = false
        let v: Scalar = null
        return () => {
          if (!done) {
            v = scalarOf(ev, ev.bindingValue(b, n.name), n)
            done = true
          }
          return v
        }
      }
      return interpret(st, n)
    }
    case 'column': {
      if (n.table === null) {
        const idx = t.indexOfName(n.name)
        if (idx >= 0 && !(t.cols[idx].lineage && ev.lookupMeasure(n.name))) return columnGetter(st, idx)
        return interpret(st, n)
      }
      if (ev.measureFor(n)) return interpret(st, n)
      const c = ev.tryColumn(n)
      if (c) {
        const idx = t.indexOfLineage(c)
        if (idx >= 0) return columnGetter(st, idx)
      }
      return interpret(st, n)
    }
    case 'unary': {
      const o = compile(st, n.operand)
      if (n.op === 'NOT') return (i) => !toBool(o(i))
      if (n.op === '-') return (i) => {
        const v = o(i)
        if (v === null) return null
        return v instanceof Date ? arithmetic('-', 0, v) : -toNumber(v)
      }
      return o
    }
    case 'binary':
      return compileBinary(st, n)
    case 'call':
      return compileCall(st, n)
    default:
      return interpret(st, n)
  }
}

/** `x IN var` / `( x, y ) IN var` with a variable (or hoisted) table: the table is evaluated once, then hashed. */
function compileIn(st: CompileState, n: Extract<Node, { kind: 'binary' }>): RowFn {
  const r = n.right
  if (r.kind !== 'ident' || !hasBinding(st.rowEnv.scope, r.name)) return interpret(st, n)
  const items = n.left.kind === 'tuple' ? n.left.items : [n.left]
  const left = items.map((x) => compile(st, x))
  const { ev, rowEnv } = st
  let table: TableValue | null = null
  return (i) => {
    if (!table) {
      const v = ev.lookupVar(r.name, rowEnv)
      if (!isTable(v)) ev.table(r, rowEnv, 'IN') // throws the usual "table expected" error
      if ((v as TableValue).cols.length !== left.length) {
        throw new DaxError('ARG', `The IN operator compares ${left.length} value(s) with a table of ${(v as TableValue).cols.length} column(s); they must match.`, n)
      }
      table = v as TableValue
    }
    return ev.inTable(left.map((f) => f(i)), table)
  }
}

function hasBinding(scope: Scope | null | undefined, name: string): boolean {
  const lower = name.toLowerCase()
  for (let s = scope; s; s = s.parent) if (scopeGet(s, lower)) return true
  return false
}

function compileBinary(st: CompileState, n: Extract<Node, { kind: 'binary' }>): RowFn {
  const op = n.op
  if (op === 'IN') return compileIn(st, n)
  const l = compile(st, n.left)
  const r = compile(st, n.right)
  const at = (e: unknown) => {
    if (e instanceof DaxError && e.start === undefined) {
      e.start = n.s
      e.end = n.e
    }
    return e
  }
  switch (op) {
    case '&&':
      return (i) => {
        const a = l(i)
        if (a !== null && !toBool(a)) return false
        return toBool(a) && toBool(r(i))
      }
    case '||':
      return (i) => (toBool(l(i)) ? true : toBool(r(i)))
    case '&':
      return (i) => toText(l(i)) + toText(r(i))
    case '==':
      return (i) => sameValue(l(i), r(i))
    case '=':
    case '<>':
    case '<':
    case '>':
    case '<=':
    case '>=': {
      const test = op === '=' ? (c: number) => c === 0 : op === '<>' ? (c: number) => c !== 0 : op === '<' ? (c: number) => c < 0 : op === '>' ? (c: number) => c > 0 : op === '<=' ? (c: number) => c <= 0 : (c: number) => c >= 0
      return (i) => {
        const a = l(i)
        const b = r(i)
        let c: number
        try {
          c = compare(a, b)
        } catch (e) {
          throw at(e)
        }
        return test(c)
      }
    }
    case '*':
      return (i) => {
        const a = l(i)
        const b = r(i)
        if (typeof a === 'number' && typeof b === 'number') return a * b
        try {
          return arithmetic(op, a, b)
        } catch (e) {
          throw at(e)
        }
      }
    case '+':
    case '-':
      return (i) => {
        const a = l(i)
        const b = r(i)
        if (typeof a === 'number' && typeof b === 'number') return op === '+' ? a + b : a - b
        try {
          return arithmetic(op, a, b)
        } catch (e) {
          throw at(e)
        }
      }
    default:
      return (i) => {
        try {
          return arithmetic(op, l(i), r(i))
        } catch (e) {
          throw at(e)
        }
      }
  }
}

const isMissing = (n: Node | undefined) => !n || (n.kind === 'ident' && n.name === '__missing__')

function compileCall(st: CompileState, n: Extract<Node, { kind: 'call' }>): RowFn {
  const fn = n.name.toUpperCase()
  const a = n.args
  switch (fn) {
    case 'IF':
    case 'IF.EAGER': {
      if (a.length < 2 || a.length > 3) break
      const c = compile(st, a[0])
      const x = compile(st, a[1])
      const y = isMissing(a[2]) ? null : compile(st, a[2])
      return (i) => (toBool(c(i)) ? x(i) : y ? y(i) : null)
    }
    case 'ISBLANK': {
      if (a.length !== 1) break
      const x = compile(st, a[0])
      return (i) => x(i) === null
    }
    case 'NOT': {
      if (a.length !== 1) break
      const x = compile(st, a[0])
      return (i) => !toBool(x(i))
    }
    case 'AND':
    case 'OR': {
      if (a.length !== 2) break
      const x = compile(st, a[0])
      const y = compile(st, a[1])
      return fn === 'AND' ? (i) => toBool(x(i)) && toBool(y(i)) : (i) => toBool(x(i)) || toBool(y(i))
    }
    case 'BLANK':
      if (a.length === 0) return () => null
      break
    case 'DIVIDE': {
      if (a.length < 2 || a.length > 3) break
      const x = compile(st, a[0])
      const y = compile(st, a[1])
      const alt = isMissing(a[2]) ? null : compile(st, a[2])
      return (i) => {
        const d = y(i)
        if (d === null || toNumber(d) === 0) return alt ? alt(i) : null
        const v = x(i)
        if (v === null) return null
        return toNumber(v) / toNumber(d)
      }
    }
    case 'COALESCE': {
      if (a.length < 1) break
      const xs = a.map((x) => compile(st, x))
      return (i) => {
        for (const x of xs) {
          const v = x(i)
          if (v !== null) return v
        }
        return null
      }
    }
    case 'RELATED': {
      if (a.length !== 1) break
      return relatedGetter(st, a[0]) ?? interpret(st, n)
    }
  }
  return interpret(st, n)
}

/** RELATED ( col ) over a base-table iteration: follow the expansion path (same as Evaluator.related's first case). */
function relatedGetter(st: CompileState, arg: Node): RowFn | null {
  const { ev, t } = st
  const col: Col | null = ev.tryColumn(arg)
  if (!col) return null
  const own = t.indexOfLineage(col)
  if (own >= 0) return columnGetter(st, own)
  if (!t.base) return null
  const exp = st.rowEnv.ctx.expansion(t.base.table)
  const step = exp.stepOf.get(col.table)
  if (!step) return null
  st.whole = true // depends on the row identity, not on one column
  const ids = t.base.ids
  if (step.path.length === 0) return (i) => col.value(ids[i])
  const map = ev.model.pathRowMap(step.path)!
  return (i) => {
    const x = map[ids[i]]
    return x < 0 ? null : col.value(x)
  }
}
