/**
 * DAX query text for a visual query (Performance analyzer ▸ "Copy query"): the SUMMARIZECOLUMNS query Power BI
 * would send for a SummarizeRequest, in Power BI's layout (DEFINE VAR __DS0FilterTable… / __DS0Core /
 * __DS0PrimaryWindowed, EVALUATE, ORDER BY).
 *
 * Filters are written from the engine's translated filters, so they are exact for every SQ shape: a contiguous
 * range of values becomes a range condition (relative dates resolve to concrete dates, as in Power BI's own
 * queries), a small set becomes TREATAS ( { … }, column ), a set that excludes few values becomes NOT IN.
 */
import type { Col } from '../dax/tabular/model'
import type { Node } from '../dax/tabular/parser'
import { colMask, type Filter } from '../dax/tabular/filters'
import { dayNumber, MS_PER_DAY, type Scalar } from '../dax/tabular/values'

export function tableName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`
}
export function columnRef(c: Col): string {
  return `${tableName(c.table.name)}[${c.name.replace(/]/g, ']]')}]`
}

export function literal(v: Scalar): string {
  if (v === null) return 'BLANK ()'
  if (typeof v === 'string') return `"${v.replace(/"/g, '""')}"`
  if (typeof v === 'boolean') return v ? 'TRUE ()' : 'FALSE ()'
  if (v instanceof Date) {
    const date = `DATE ( ${v.getUTCFullYear()}, ${v.getUTCMonth() + 1}, ${v.getUTCDate()} )`
    const ms = v.getTime() - dayNumber(v) * MS_PER_DAY
    return ms ? `${date} + TIME ( ${v.getUTCHours()}, ${v.getUTCMinutes()}, ${v.getUTCSeconds()} )` : date
  }
  if (!Number.isFinite(v)) return v > 0 ? '1/0' : v < 0 ? '-1/0' : '0/0'
  return String(v)
}

const PREC: Record<string, number> = { '||': 1, '&&': 2, '=': 4, '==': 4, '<>': 4, '<': 4, '>': 4, '<=': 4, '>=': 4, IN: 4, '&': 5, '+': 6, '-': 6, '*': 7, '/': 7, '^': 9 }

/** DAX text of an expression AST (fully parenthesized where precedence requires). */
export function printDax(n: Node): string {
  switch (n.kind) {
    case 'number':
      return String(n.value)
    case 'string':
      return `"${n.value.replace(/"/g, '""')}"`
    case 'bool':
      return n.value ? 'TRUE ()' : 'FALSE ()'
    case 'param':
      return `@${n.name}`
    case 'ident':
      return n.quoted ? tableName(n.name) : n.name === '__missing__' ? '' : n.name
    case 'column':
      return n.table === null ? `[${n.name.replace(/]/g, ']]')}]` : `${tableName(n.table)}[${n.name.replace(/]/g, ']]')}]`
    case 'call':
      return `${n.name.toUpperCase()} ( ${n.args.map(printDax).join(', ')} )`.replace('(  )', '()')
    case 'unary':
      return n.op === 'NOT' ? `NOT ( ${printDax(n.operand)} )` : `${n.op}${wrap(n.operand, 8)}`
    case 'binary': {
      const p = PREC[n.op] ?? 0
      return `${wrap(n.left, p)} ${n.op} ${wrap(n.right, p + 1)}`
    }
    case 'var':
      return `VAR ${n.decls.map((d) => `${d.name} = ${printDax(d.expr)}`).join(' VAR ')} RETURN ${printDax(n.body)}`
    case 'tableCtor':
      return `{ ${n.rows.map((r) => (r.length === 1 ? printDax(r[0]) : `( ${r.map(printDax).join(', ')} )`)).join(', ')} }`
    case 'tuple':
      return `( ${n.items.map(printDax).join(', ')} )`
  }
}

function wrap(n: Node, prec: number): string {
  const s = printDax(n)
  if (n.kind === 'binary' && (PREC[n.op] ?? 0) < prec) return `( ${s} )`
  return s
}

/** Filter table expression (for SUMMARIZECOLUMNS / CALCULATETABLE) of a translated engine filter. */
export function filterTable(f: Filter): string {
  if (f.kind === 'col') {
    const c = f.col
    const allowed = f.codes
    const n = c.dict.length
    const ref = columnRef(c)
    if (allowed.length === 0) return `FILTER ( KEEPFILTERS ( VALUES ( ${ref} ) ), FALSE () )`
    const hasBlank = allowed[0] === 0
    // contiguous range in sort order (blank excluded)?
    const sorted = c.sortedCodes()
    const mask = colMask(f)
    if (!hasBlank && allowed.length > 8) {
      let first = -1
      let last = -1
      let ok = true
      for (let i = 0; i < sorted.length && ok; i++) {
        const code = sorted[i]
        if (code === 0) continue
        if (mask[code]) {
          if (first < 0) first = i
          else if (last !== i - 1) ok = false
          last = i
        }
      }
      if (ok && first >= 0) {
        const lo = literal(c.dict[sorted[first]])
        const hi = literal(c.dict[sorted[last]])
        return `FILTER ( KEEPFILTERS ( VALUES ( ${ref} ) ), AND ( ${ref} >= ${lo}, ${ref} <= ${hi} ) )`
      }
    }
    if (allowed.length > (n - 1) / 2 && n - allowed.length < allowed.length) {
      const excluded: string[] = []
      for (let code = 0; code < n; code++) if (!mask[code]) excluded.push(literal(c.dict[code]))
      return `FILTER ( KEEPFILTERS ( VALUES ( ${ref} ) ), NOT ( ${ref} IN { ${excluded.join(', ')} } ) )`
    }
    return `TREATAS ( { ${Array.from(allowed, (code) => literal(c.dict[code])).join(', ')} }, ${ref} )`
  }
  if (f.kind === 'tuple') {
    const rows = f.tuples.map((t) => `( ${Array.from(t, (code, j) => literal(f.cols[j].dict[code])).join(', ')} )`)
    return `TREATAS ( { ${rows.join(', ')} }, ${f.cols.map(columnRef).join(', ')} )`
  }
  // row filters do not come from SQ filters; write them as the key values of their rows
  const key = f.table.cols.find((c) => c.dict.length - 1 === f.table.rowCount) ?? f.table.cols[0]
  const vals = new Set<string>()
  for (const id of f.ids) vals.add(literal(key.value(id)))
  return `TREATAS ( { ${[...vals].join(', ')} }, ${columnRef(key)} )`
}
