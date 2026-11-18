/** Window functions: OFFSET, INDEX, WINDOW, RANK, ROWNUMBER with ORDERBY / PARTITIONBY / MATCHBY. */
import { DaxError } from './errors.ts'
import type { Evaluator } from './evaluator.ts'
import type { Col, Tbl } from './model.ts'
import type { Node } from './parser.ts'
import { defineFn, type Env } from './registry.ts'
import { TableValue } from './table.ts'
import { distinctColumns } from './fn-table.ts'
import { toNumber, tupleKey, type Scalar } from './values.ts'
import { parseOrderBy, windowCompare, type OrderItem } from './window-order.ts'
import { visualWindow } from './visualcalc.ts'

interface WinArgs {
  relation: TableValue
  orderBy: OrderItem[]
  partitionBy: Node[]
  matchBy: Node[]
  blanks: 'FIRST' | 'LAST' | 'DEFAULT' | 'KEEP'
}

const isCall = (n: Node | undefined, name: string): boolean => !!n && n.kind === 'call' && n.name.toUpperCase() === name

function parseWin(ev: Evaluator, rest: Node[], env: Env, fn: string): WinArgs {
  let relationNode: Node | null = null
  const orderBy: WinArgs['orderBy'] = []
  const partitionBy: Node[] = []
  const matchBy: Node[] = []
  let blanks: WinArgs['blanks'] = 'DEFAULT'
  for (const n of rest) {
    if (n.kind === 'ident' && n.name === '__missing__') continue
    if (n.kind === 'call' && isCall(n, 'ORDERBY')) {
      orderBy.push(...parseOrderBy(n.args))
    } else if (n.kind === 'call' && isCall(n, 'PARTITIONBY')) partitionBy.push(...n.args)
    else if (n.kind === 'call' && isCall(n, 'MATCHBY')) matchBy.push(...n.args)
    else if (n.kind === 'ident' && ['FIRST', 'LAST', 'DEFAULT', 'KEEP'].includes(n.name.toUpperCase())) blanks = n.name.toUpperCase() as WinArgs['blanks']
    else if (!relationNode) relationNode = n
  }
  let relation: TableValue
  if (relationNode) relation = ev.table(relationNode, env, fn)
  else {
    // default relation: ALLSELECTED of the ORDERBY and PARTITIONBY columns
    const cols: Col[] = []
    for (const n of [...orderBy.map((o) => o.expr), ...partitionBy]) {
      const c = ev.tryColumn(n)
      if (!c) throw new DaxError('ARG', `${fn}: when the relation is omitted, ORDERBY and PARTITIONBY must reference columns.`)
      if (!cols.includes(c)) cols.push(c)
    }
    if (!cols.length) throw new DaxError('ARG', `${fn} needs a relation or ORDERBY columns.`)
    const ctx = ev.allSelected(ev.transition(env), cols, env.shadows)
    const byTable = new Map<Tbl, Col[]>()
    for (const c of cols) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c])
    let rel: TableValue | null = null
    for (const [t, cs] of byTable) {
      const part = distinctColumns(cs, ctx.visible(t))
      if (!rel) rel = part
      else {
        const rows: Scalar[][] = []
        for (const r of rel.rows()) for (const p of part.rows()) rows.push([...r, ...p])
        rel = TableValue.fromRows([...rel.cols, ...part.cols], rows)
      }
    }
    relation = rel!
  }
  if (orderBy.length === 0) {
    // default order: all relation columns ascending
    relation.cols.forEach((c) => orderBy.push({ expr: { kind: 'column', table: c.lineage?.table.name ?? null, name: c.name, s: 0, e: 0 }, desc: false }))
  }
  return { relation, orderBy, partitionBy, matchBy, blanks }
}

interface Prepared {
  rel: TableValue
  order: number[]
  keys: Scalar[][]
  partKey: string[]
  cmp: (x: number, y: number) => number
}

function prepare(ev: Evaluator, w: WinArgs, env: Env): Prepared {
  const rel = w.relation
  const keys: Scalar[][] = []
  const partKey: string[] = []
  ev.each(rel, env, (re) => {
    keys.push(w.orderBy.map((o) => ev.scalar(o.expr, re)))
    partKey.push(tupleKey(w.partitionBy.map((p) => ev.scalar(p, re))))
  })
  const cmp = (x: number, y: number) => {
    for (let k = 0; k < w.orderBy.length; k++) {
      const o = w.orderBy[k]
      const c = windowCompare(keys[x][k], keys[y][k], o.desc, o.blanks ?? w.blanks)
      if (c !== 0) return c
    }
    return 0
  }
  const order = Array.from({ length: rel.n }, (_, i) => i).sort((x, y) => cmp(x, y) || x - y)
  return { rel, order, keys, partKey, cmp }
}

/** The relation row matching the current context (row context first, then single-valued filter context). */
function currentRow(ev: Evaluator, p: Prepared, w: WinArgs, env: Env): number {
  const rel = p.rel
  const ctx = ev.transition(env)
  const matchCols = w.matchBy.length ? w.matchBy.map((n) => rel.indexOfLineage(ev.tryColumn(n)!) ) : rel.cols.map((_, j) => j)
  const known: Array<{ j: number; v: Scalar }> = []
  for (const j of matchCols) {
    if (j < 0) continue
    const tc = rel.cols[j]
    let found = false
    let v: Scalar = null
    for (let k = env.rows.length - 1; k >= 0 && !found; k--) {
      const rc = env.rows[k]
      const idx = tc.lineage ? rc.t.indexOfLineage(tc.lineage) : rc.t.indexOfName(tc.name)
      if (idx >= 0) {
        v = rc.t.get(rc.i, idx)
        found = true
      }
    }
    if (!found && tc.lineage) {
      const codes = ev.visibleCodes(tc.lineage, ctx, true)
      if (codes.length === 1 && ctx.isFiltered(tc.lineage)) {
        v = tc.lineage.dict[codes[0]]
        found = true
      } else if (codes.length === 1 && tc.lineage.dict.length <= 2) {
        v = tc.lineage.dict[codes[0]]
        found = true
      }
    }
    if (found) known.push({ j, v })
  }
  if (!known.length) return -1
  let hit = -1
  for (let i = 0; i < rel.n; i++) {
    if (known.every((k) => tupleKey([rel.get(i, k.j)]) === tupleKey([k.v]))) {
      if (hit >= 0) return -1 // ambiguous
      hit = i
    }
  }
  return hit
}

function partitionOrder(p: Prepared, row: number): number[] {
  const key = p.partKey[row]
  return p.order.filter((i) => p.partKey[i] === key)
}

defineFn(
  'OFFSET',
  (ev, a, env) => {
    if (env.visual) {
      const vw = visualWindow(ev, 'OFFSET', a, env)
      if (vw !== undefined) return vw
    }
    const delta = Math.trunc(toNumber(ev.scalar(a[0], env)))
    const w = parseWin(ev, a.slice(1), env, 'OFFSET')
    const p = prepare(ev, w, env)
    const cur = currentRow(ev, p, w, env)
    if (cur < 0) return p.rel.select([])
    const part = partitionOrder(p, cur)
    const pos = part.indexOf(cur) + delta
    return p.rel.select(pos >= 0 && pos < part.length ? [part[pos]] : [])
  },
  { table: true, min: 1, context: true }
)
defineFn(
  'INDEX',
  (ev, a, env) => {
    if (env.visual) {
      const vw = visualWindow(ev, 'INDEX', a, env)
      if (vw !== undefined) return vw
    }
    const pos = Math.trunc(toNumber(ev.scalar(a[0], env)))
    const w = parseWin(ev, a.slice(1), env, 'INDEX')
    const p = prepare(ev, w, env)
    let part = p.order
    if (w.partitionBy.length) {
      const cur = currentRow(ev, p, w, env)
      if (cur < 0) return p.rel.select([])
      part = partitionOrder(p, cur)
    }
    const idx = pos > 0 ? pos - 1 : part.length + pos
    return p.rel.select(idx >= 0 && idx < part.length && pos !== 0 ? [part[idx]] : [])
  },
  { table: true, min: 1, context: true }
)
defineFn(
  'WINDOW',
  (ev, a, env) => {
    if (env.visual) {
      const vw = visualWindow(ev, 'WINDOW', a, env)
      if (vw !== undefined) return vw
    }
    const from = Math.trunc(toNumber(ev.scalar(a[0], env)))
    const fromType = a[1].kind === 'ident' ? a[1].name.toUpperCase() : 'REL'
    const to = Math.trunc(toNumber(ev.scalar(a[2], env)))
    const toType = a[3].kind === 'ident' ? a[3].name.toUpperCase() : 'REL'
    const w = parseWin(ev, a.slice(4), env, 'WINDOW')
    const p = prepare(ev, w, env)
    let part = p.order
    let curPos = -1
    if (fromType === 'REL' || toType === 'REL' || w.partitionBy.length) {
      const cur = currentRow(ev, p, w, env)
      if (cur < 0) return p.rel.select([])
      part = partitionOrder(p, cur)
      curPos = part.indexOf(cur)
    }
    const resolve = (v: number, type: string) => (type === 'ABS' ? (v > 0 ? v - 1 : part.length + v) : curPos + v)
    let s = Math.max(0, resolve(from, fromType))
    let e = Math.min(part.length - 1, resolve(to, toType))
    if (s > e) return p.rel.select([])
    return p.rel.select(part.slice(s, e + 1).sort((x, y) => x - y))
  },
  { table: true, min: 4, context: true }
)
defineFn(
  ['RANK', 'ROWNUMBER'],
  (ev, a, env, node) => {
    const fn = node.name.toUpperCase()
    if (env.visual) {
      const vw = visualWindow(ev, fn, a, env)
      if (vw !== undefined) return vw
    }
    let rest = a
    let dense = false
    if (fn === 'RANK' && a[0] && a[0].kind === 'ident' && ['DENSE', 'SKIP'].includes(a[0].name.toUpperCase())) {
      dense = a[0].name.toUpperCase() === 'DENSE'
      rest = a.slice(1)
    }
    const w = parseWin(ev, rest, env, fn)
    const p = prepare(ev, w, env)
    const cur = currentRow(ev, p, w, env)
    if (cur < 0) return null
    const part = partitionOrder(p, cur)
    const pos = part.indexOf(cur)
    if (fn === 'ROWNUMBER') return pos + 1
    if (!dense) {
      let k = pos
      while (k > 0 && p.cmp(part[k - 1], cur) === 0) k--
      return k + 1
    }
    let rank = 1
    for (let k = 1; k <= pos; k++) if (p.cmp(part[k - 1], part[k]) !== 0) rank++
    return rank
  },
  { min: 0, context: true }
)
for (const name of ['ORDERBY', 'PARTITIONBY', 'MATCHBY']) {
  defineFn(name, () => {
    throw new DaxError('ARG', `${name} can only be used as an argument of a window function (OFFSET, INDEX, WINDOW, RANK, ROWNUMBER).`)
  })
}
