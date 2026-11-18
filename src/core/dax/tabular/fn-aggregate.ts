/** Aggregations over columns (storage-engine style fast paths) and iterators (X functions), RANKX, CONCATENATEX. */
import { DaxError } from './errors.ts'
import type { Evaluator } from './evaluator.ts'
import type { Col } from './model.ts'
import type { Node } from './parser.ts'
import { defineFn, type Env } from './registry.ts'
import { rowFn } from './compile.ts'
import { TableValue } from './table.ts'
import { clean15, compare, KahanSum, sortCompare, toNumber, toText, type Scalar } from './values.ts'

const missing = (n: Node | undefined) => !n || (n.kind === 'ident' && n.name === '__missing__')

function columnArg(ev: Evaluator, n: Node, fn: string): Col {
  return ev.resolveColumn(n, fn)
}

function typeErr(fn: string, col: Col): DaxError {
  return new DaxError('TYPE', `The function ${fn} cannot work with values of type ${col.dataType === 'string' ? 'String' : col.dataType === 'boolean' ? 'Boolean' : col.dataType}.`)
}

/** Numeric values of a column over the visible rows (blanks skipped). */
function numericValues(ev: Evaluator, col: Col, env: Env, fn: string): number[] {
  if (col.dataType === 'string') throw typeErr(fn, col)
  const vis = env.ctx.visible(col.table)
  const out: number[] = []
  const codes = col.codes
  const num = col.num
  for (let i = 0; i < vis.length; i++) {
    const c = codes[vis[i]]
    if (c !== 0) out.push(num[c])
  }
  return out
}

defineFn(
  'SUM',
  (ev, a, env) => {
    const col = columnArg(ev, a[0], 'SUM')
    if (col.dataType === 'string') throw typeErr('SUM', col)
    const fast = env.ctx.aggregate(col.table, col, 'sum')
    if (fast) return fast.any ? clean15(fast.value) : null
    const vis = env.ctx.visible(col.table)
    const codes = col.codes
    const num = col.num
    const k = new KahanSum()
    let any = false
    for (let i = 0; i < vis.length; i++) {
      const c = codes[vis[i]]
      if (c !== 0) {
        k.add(num[c])
        any = true
      }
    }
    if (!any) return null
    return clean15(k.sum)
  },
  { min: 1, max: 1, context: true }
)

defineFn(
  ['AVERAGE', 'AVERAGEA'],
  (ev, a, env, node) => {
    const col = columnArg(ev, a[0], node.name)
    if (node.name.toUpperCase() === 'AVERAGEA' && col.dataType === 'string') {
      const vis = env.ctx.visible(col.table)
      let n = 0
      for (const r of vis) if (col.codes[r] !== 0) n++
      return n ? 0 : null
    }
    if (col.dataType === 'string') throw typeErr('AVERAGE', col)
    const fs = env.ctx.aggregate(col.table, col, 'sum')
    if (fs) {
      if (!fs.any) return null
      const fc = env.ctx.aggregate(col.table, col, 'count')!
      return clean15(fs.value / fc.value)
    }
    const v = numericValues(ev, col, env, 'AVERAGE')
    if (!v.length) return null
    const k = new KahanSum()
    for (const x of v) k.add(x)
    return clean15(k.sum / v.length)
  },
  { min: 1, max: 1, context: true }
)

function minMaxCol(ev: Evaluator, col: Col, env: Env, max: boolean): Scalar {
  const numeric = col.dataType !== 'string' && col.dataType !== 'variant' && col.dataType !== 'unknown'
  if (numeric) {
    const fast = env.ctx.aggregate(col.table, col, max ? 'max' : 'min')
    if (fast) return fast.any ? col.dict[fast.value] : null
  }
  const vis = env.ctx.visible(col.table)
  const codes = col.codes
  if (numeric) {
    const num = col.num
    let best = -1
    for (let i = 0; i < vis.length; i++) {
      const c = codes[vis[i]]
      if (c === 0) continue
      if (best < 0 || (max ? num[c] > num[best] : num[c] < num[best])) best = c
    }
    return best < 0 ? null : col.dict[best]
  }
  const seen = new Uint8Array(col.dict.length)
  let best: Scalar = null
  for (let i = 0; i < vis.length; i++) {
    const c = codes[vis[i]]
    if (c === 0 || seen[c]) continue
    seen[c] = 1
    const v = col.dict[c]
    if (best === null || (max ? sortCompare(v, best) > 0 : sortCompare(v, best) < 0)) best = v
  }
  return best
}

defineFn(
  ['MIN', 'MAX', 'MINA', 'MAXA'],
  (ev, a, env, node) => {
    const fn = node.name.toUpperCase()
    const isMax = fn.startsWith('MAX')
    if (a.length === 2) {
      const x = ev.scalar(a[0], env)
      const y = ev.scalar(a[1], env)
      if (x === null) return y === null ? null : isMax ? (compare(y, 0) >= 0 ? y : 0) : compare(y, 0) <= 0 ? y : 0
      if (y === null) return isMax ? (compare(x, 0) >= 0 ? x : 0) : compare(x, 0) <= 0 ? x : 0
      const c = compare(x, y)
      return isMax ? (c >= 0 ? x : y) : c <= 0 ? x : y
    }
    const col = columnArg(ev, a[0], fn)
    const v = minMaxCol(ev, col, env, isMax)
    if ((fn === 'MINA' || fn === 'MAXA') && typeof v === 'boolean') return v ? 1 : 0
    return v
  },
  { min: 1, max: 2, context: true }
)

defineFn(
  ['COUNT', 'COUNTA'],
  (ev, a, env, node) => {
    const col = columnArg(ev, a[0], node.name)
    const fast = env.ctx.aggregate(col.table, col, 'count')
    if (fast) return fast.value === 0 ? null : fast.value
    const vis = env.ctx.visible(col.table)
    let n = 0
    const codes = col.codes
    for (let i = 0; i < vis.length; i++) if (codes[vis[i]] !== 0) n++
    return n === 0 ? null : n
  },
  { min: 1, max: 1, context: true }
)
defineFn(
  'COUNTBLANK',
  (ev, a, env) => {
    const col = columnArg(ev, a[0], 'COUNTBLANK')
    const vis = env.ctx.visible(col.table)
    let n = 0
    for (let i = 0; i < vis.length; i++) if (vis[i] < col.table.rowCount && col.codes[vis[i]] === 0) n++
    if (vis.length === 0) return null
    return n
  },
  { min: 1, max: 1, context: true }
)
defineFn(
  'COUNTROWS',
  (ev, a, env) => {
    let n: number
    if (a.length === 0) {
      // COUNTROWS ( ) without a table counts the home table of the expression (measure or calculated column table)
      if (!ev.home) throw new DaxError('ARG', 'COUNTROWS ( ) without a table can only be used in a measure or a calculated column (it counts their table).')
      n = env.ctx.visible(ev.home).length
      return n === 0 ? null : n
    }
    const arg = a[0]
    if (arg.kind === 'ident' && !ev.lookupVar(arg.name, env) && !ev.queryTables.has(arg.name.toLowerCase())) {
      const t = ev.model.findTable(arg.name)
      if (t) n = env.ctx.aggregate(t, null, 'rows')?.value ?? env.ctx.visible(t).length
      else n = ev.table(arg, env, 'COUNTROWS').n
    } else n = ev.table(arg, env, 'COUNTROWS').n
    return n === 0 ? null : n
  },
  { min: 0, max: 1, context: true }
)
defineFn(
  ['DISTINCTCOUNT', 'DISTINCTCOUNTNOBLANK', 'APPROXIMATEDISTINCTCOUNT'],
  (ev, a, env, node) => {
    const fn = node.name.toUpperCase()
    if (a[0].kind !== 'column' || !ev.tryColumn(a[0])) {
      // DISTINCTCOUNT over a table expression column (rare): count distinct values
      const t = ev.colOrTable(a[0], env, fn)
      const set = new Set(t.column(0).filter((v) => fn !== 'DISTINCTCOUNTNOBLANK' || v !== null).map((v) => (v === null ? null : typeof v === 'string' ? v.toLowerCase() : v instanceof Date ? v.getTime() : v)))
      return set.size === 0 ? null : set.size
    }
    const col = columnArg(ev, a[0], fn)
    const vis = env.ctx.visible(col.table)
    if (vis.length === 0) return null
    const seen = new Uint8Array(col.dict.length)
    let n = 0
    const codes = col.codes
    for (let i = 0; i < vis.length; i++) {
      const c = codes[vis[i]]
      if (!seen[c]) {
        seen[c] = 1
        n++
      }
    }
    if (fn === 'DISTINCTCOUNTNOBLANK' && seen[0]) n--
    return n === 0 ? null : n
  },
  { min: 1, max: 1, context: true }
)

// ---- statistics over columns -------------------------------------------------------------------

function median(v: number[]): number | null {
  if (!v.length) return null
  const s = [...v].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function variance(v: number[], sample: boolean): number | null {
  const n = v.length
  if (n === 0 || (sample && n < 2)) {
    if (sample && n === 1) throw new DaxError('ARG', 'The variance of a sample with one value cannot be computed.')
    return null
  }
  let mean = 0
  for (const x of v) mean += x
  mean /= n
  let ss = 0
  for (const x of v) ss += (x - mean) ** 2
  return ss / (sample ? n - 1 : n)
}
function percentile(v: number[], k: number, inclusive: boolean): number | null {
  if (!v.length) return null
  const s = [...v].sort((x, y) => x - y)
  const n = s.length
  let rank: number
  if (inclusive) {
    if (k < 0 || k > 1) throw new DaxError('ARG', 'PERCENTILE.INC: k must be between 0 and 1.')
    rank = k * (n - 1)
  } else {
    rank = k * (n + 1) - 1
    if (rank < 0 || rank > n - 1) throw new DaxError('ARG', 'PERCENTILE.EXC: k is out of range for the number of values.')
  }
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  return s[lo] + (rank - lo) * (s[hi] - s[lo])
}
function geomean(v: number[]): number | null {
  if (!v.length) return null
  let s = 0
  for (const x of v) {
    if (x <= 0) throw new DaxError('ARG', 'GEOMEAN needs positive values.')
    s += Math.log(x)
  }
  return Math.exp(s / v.length)
}

const STAT: Record<string, (v: number[], k?: number) => number | null> = {
  MEDIAN: median,
  'STDEV.S': (v) => {
    const x = variance(v, true)
    return x === null ? null : Math.sqrt(x)
  },
  'STDEV.P': (v) => {
    const x = variance(v, false)
    return x === null ? null : Math.sqrt(x)
  },
  'VAR.S': (v) => variance(v, true),
  'VAR.P': (v) => variance(v, false),
  PRODUCT: (v) => (v.length ? v.reduce((p, c) => p * c, 1) : null),
  GEOMEAN: geomean,
  'PERCENTILE.INC': (v, k) => percentile(v, k ?? 0, true),
  'PERCENTILE.EXC': (v, k) => percentile(v, k ?? 0, false)
}
for (const [name, f] of Object.entries(STAT)) {
  const pct = name.startsWith('PERCENTILE')
  defineFn(
    name,
    (ev, a, env) => {
      const col = columnArg(ev, a[0], name)
      const k = pct ? toNumber(ev.scalar(a[1], env)) : undefined
      return f(numericValues(ev, col, env, name), k)
    },
    { min: pct ? 2 : 1, max: pct ? 2 : 1, context: true }
  )
  const xname = name.includes('.') ? name.replace('.', 'X.') : name + 'X'
  defineFn(
    xname,
    (ev, a, env) => {
      const t = ev.table(a[0], env, xname)
      const vals: number[] = []
      const rf = rowFn(ev, a[1], t, env)
      for (let i = 0; i < t.n; i++) {
        const v = rf(i)
        if (v === null) continue
        if (typeof v === 'string') throw new DaxError('TYPE', `The function ${xname} cannot work with values of type String.`)
        vals.push(toNumber(v))
      }
      const k = pct ? toNumber(ev.scalar(a[2], env)) : undefined
      return f(vals, k)
    },
    { min: pct ? 3 : 2, max: pct ? 3 : 2, context: true }
  )
}
// legacy names
defineFn(['STDEV', 'STDEVA'], (ev, a, env) => STAT['STDEV.S'](numericValues(ev, columnArg(ev, a[0], 'STDEV.S'), env, 'STDEV.S')), { min: 1, max: 1, context: true })
defineFn(['VAR', 'VARA'], (ev, a, env) => STAT['VAR.S'](numericValues(ev, columnArg(ev, a[0], 'VAR.S'), env, 'VAR.S')), { min: 1, max: 1, context: true })

// ---- iterators ---------------------------------------------------------------------------------

defineFn(
  ['SUMX', 'AVERAGEX'],
  (ev, a, env, node) => {
    const fn = node.name.toUpperCase()
    const t = ev.table(a[0], env, fn)
    const acc = new KahanSum()
    let count = 0
    const expr = a[1]
    // fast path: column of the iterated table
    const col = expr.kind === 'column' ? ev.tryColumn(expr) : null
    const j = col ? t.indexOfLineage(col) : -1
    if (j >= 0 && !ev.measureFor(expr as Extract<Node, { kind: 'column' }>)) {
      for (let i = 0; i < t.n; i++) {
        const v = t.get(i, j)
        if (v === null) continue
        if (typeof v === 'string') throw new DaxError('TYPE', `The function ${fn} cannot work with values of type String.`)
        acc.add(toNumber(v))
        count++
      }
    } else {
      const f = rowFn(ev, expr, t, env)
      for (let i = 0; i < t.n; i++) {
        const v = f(i)
        if (v === null) continue
        if (typeof v === 'number') acc.add(v)
        else if (typeof v === 'string') throw new DaxError('TYPE', `The function ${fn} cannot work with values of type String.`)
        else acc.add(toNumber(v))
        count++
      }
    }
    if (count === 0) return null
    return clean15(fn === 'SUMX' ? acc.sum : acc.sum / count)
  },
  { min: 2, max: 2, context: true }
)

defineFn(
  ['MINX', 'MAXX'],
  (ev, a, env, node) => {
    const fn = node.name.toUpperCase()
    const t = ev.table(a[0], env, fn)
    let best: Scalar = null
    const f = rowFn(ev, a[1], t, env)
    for (let i = 0; i < t.n; i++) {
      const v = f(i)
      if (v === null) continue
      if (best === null || (fn === 'MINX' ? sortCompare(v, best) < 0 : sortCompare(v, best) > 0)) best = v
    }
    return best
  },
  { min: 2, max: 3, context: true }
)

defineFn(
  ['COUNTX', 'COUNTAX'],
  (ev, a, env, node) => {
    const fn = node.name.toUpperCase()
    const t = ev.table(a[0], env, fn)
    let n = 0
    const f = rowFn(ev, a[1], t, env)
    for (let i = 0; i < t.n; i++) {
      const v = f(i)
      if (v === null) continue
      if (fn === 'COUNTX' && typeof v === 'boolean') continue
      n++
    }
    return n === 0 ? null : n
  },
  { min: 2, max: 2, context: true }
)

defineFn(
  'DISTINCTCOUNTX',
  (ev, a, env) => {
    const t = ev.table(a[0], env, 'DISTINCTCOUNTX')
    const s = new Set<unknown>()
    const f = rowFn(ev, a[1], t, env)
    for (let i = 0; i < t.n; i++) {
      const v = f(i)
      s.add(v === null ? null : typeof v === 'string' ? v.toLowerCase() : v instanceof Date ? v.getTime() : v)
    }
    return s.size === 0 ? null : s.size
  },
  { min: 2, max: 2, context: true }
)

defineFn(
  'CONCATENATEX',
  (ev, a, env) => {
    const t = ev.table(a[0], env, 'CONCATENATEX')
    const delim = missing(a[2]) ? '' : toText(ev.scalar(a[2], env))
    const items: Array<{ text: string; keys: Scalar[] }> = []
    const orders: Array<{ expr: Node; desc: boolean }> = []
    for (let i = 3; i < a.length; ) {
      const e = a[i]
      const nx = a[i + 1]
      let desc = false
      let step = 1
      if (nx && nx.kind === 'ident' && ['ASC', 'DESC'].includes(nx.name.toUpperCase())) {
        desc = nx.name.toUpperCase() === 'DESC'
        step = 2
      } else if (nx && (nx.kind === 'number' || nx.kind === 'bool')) {
        desc = nx.kind === 'number' ? nx.value === 0 : !nx.value
        step = 2
      }
      orders.push({ expr: e, desc })
      i += step
    }
    ev.each(t, env, (re) => {
      items.push({ text: toText(ev.scalar(a[1], re)), keys: orders.map((o) => ev.scalar(o.expr, re)) })
    })
    if (orders.length) {
      items.sort((x, y) => {
        for (let k = 0; k < orders.length; k++) {
          const c = sortCompare(x.keys[k], y.keys[k])
          if (c) return orders[k].desc ? -c : c
        }
        return 0
      })
    }
    return items.map((i) => i.text).join(delim)
  },
  { min: 2, context: true }
)

// ---- ranking -----------------------------------------------------------------------------------

defineFn(
  'RANKX',
  (ev, a, env) => {
    const t = ev.table(a[0], env, 'RANKX')
    const vals: Scalar[] = []
    const f = rowFn(ev, a[1], t, env)
    for (let i = 0; i < t.n; i++) vals.push(f(i))
    const value = missing(a[2]) ? ev.scalar(a[1], env) : ev.scalar(a[2], env)
    const ord = a[3]
    let asc = false
    if (!missing(ord)) {
      if (ord!.kind === 'ident') asc = ord!.name.toUpperCase() === 'ASC'
      else {
        const v = ev.scalar(ord!, env)
        asc = v === 1 || v === true
      }
    }
    const tie = a[4] && a[4].kind === 'ident' ? a[4].name.toUpperCase() : 'SKIP'
    return rankOf(vals, value, asc, tie === 'DENSE')
  },
  { min: 2, max: 5, context: true }
)

export function rankOf(vals: Scalar[], value: Scalar, asc: boolean, dense: boolean): number {
  const better = (v: Scalar) => {
    const c = compare(v ?? 0, value ?? 0)
    return asc ? c < 0 : c > 0
  }
  if (dense) {
    const seen = new Set<unknown>()
    for (const v of vals) if (better(v)) seen.add(typeof v === 'string' ? v.toLowerCase() : v instanceof Date ? v.getTime() : v)
    return seen.size + 1
  }
  let n = 0
  for (const v of vals) if (better(v)) n++
  return n + 1
}

defineFn(
  'RANK.EQ',
  (ev, a, env) => {
    const value = ev.scalar(a[0], env)
    const col = a[1]
    let vals: Scalar[]
    const c = col.kind === 'column' ? ev.tryColumn(col) : null
    if (c) {
      const vis = ev.model.findTable(c.table.name) ? env.ctx.visible(c.table) : new Int32Array(0)
      vals = Array.from(vis, (r) => c.value(r))
    } else vals = ev.colOrTable(col, env, 'RANK.EQ').column(0)
    const ord = missing(a[2]) ? 0 : toNumber(ev.scalar(a[2]!, env))
    if (value === null) return null
    return rankOf(vals.filter((v) => v !== null), value, ord !== 0, false)
  },
  { min: 2, max: 3, context: true }
)

// ---- first / last non blank ----------------------------------------------------------------------

function nonBlankScan(ev: Evaluator, a: Node[], env: Env, last: boolean, returnValue: boolean): Scalar | TableValue {
  const fn = returnValue ? (last ? 'LASTNONBLANKVALUE' : 'FIRSTNONBLANKVALUE') : last ? 'LASTNONBLANK' : 'FIRSTNONBLANK'
  const t = ev.colOrTable(a[0], env, fn)
  const order = Array.from({ length: t.n }, (_, i) => i).sort((x, y) => sortCompare(t.get(x, 0), t.get(y, 0)))
  if (last) order.reverse()
  for (const i of order) {
    const re = ev.withRow(env, t, i)
    const v = ev.scalar(a[1], re)
    if (v !== null) {
      if (returnValue) return v
      return new TableValue([t.cols[0]], [[t.get(i, 0)]], 1)
    }
  }
  return returnValue ? null : TableValue.empty([t.cols[0]])
}
defineFn('FIRSTNONBLANK', (ev, a, env) => nonBlankScan(ev, a, env, false, false), { min: 2, max: 3, table: true, context: true })
defineFn('LASTNONBLANK', (ev, a, env) => nonBlankScan(ev, a, env, true, false), { min: 2, max: 3, table: true, context: true })
defineFn('FIRSTNONBLANKVALUE', (ev, a, env) => nonBlankScan(ev, a, env, false, true), { min: 2, max: 2, context: true })
defineFn('LASTNONBLANKVALUE', (ev, a, env) => nonBlankScan(ev, a, env, true, true), { min: 2, max: 2, context: true })
