/**
 * Minimal in-memory QueryEngine for the visuals gallery and visual unit tests.
 *
 * Supports: group-by on columns / hierarchy levels of one table, SQ Aggregations (sum, avg, min,
 * max, count, distinct count, median), measures written in a small DAX subset (SUM / AVERAGE /
 * MIN / MAX / COUNTROWS / DISTINCTCOUNT / DIVIDE / [measure] refs / + - * /), SQ filters (In,
 * Not, And, Or, Comparison, Between, Contains/StartsWith), sort-by-column ordering,
 * highlights, describeField and a FORMAT-style formatter. Relationships are ignored (single
 * table queries), which is all the gallery needs. The real engine (createEngine) replaces this
 * automatically when available — see Gallery.tsx.
 */
import type { DataType, SemanticModel, TableDef } from '@core/model/types'
import type { DataStore, Scalar, TableData } from '@core/model/data'
import type { FieldDescription, QueryEngine, SummarizeRequest, SummarizeResult, ValueExpr, GroupExpr, DistinctValuesRequest } from '@core/engine/api'
import { fieldInfo, SQ_AGG_NAMES, type SQExpr, type SQFilter } from '@core/report/sq'
import { decodeLiteral } from '@core/report/literal'
import { formatValue } from '@core/dax/format'
import { DaxDate } from '@core/dax/values'
import { formatFixed, parseNumberFormat } from '../common/units'

type Row = number
interface ColRef {
  table: string
  column: string
}

// ------------------------------------------------------------------------------------------------
// Mini DAX expression evaluator (measure subset)
// ------------------------------------------------------------------------------------------------
type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'col'; table: string; column: string }
  | { t: 'msr'; name: string }
  | { t: 'call'; fn: string; args: Node[] }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'neg'; a: Node }

export function parseMiniDax(src: string): Node {
  let i = 0
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++
  }
  const peek = () => (ws(), src[i])
  const ident = (): string => {
    ws()
    if (src[i] === "'") {
      const j = src.indexOf("'", i + 1)
      const s = src.slice(i + 1, j)
      i = j + 1
      return s
    }
    const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i))
    if (!m) throw new Error(`Unexpected '${src[i]}' in ${src}`)
    i += m[0].length
    return m[0]
  }
  const bracket = (): string => {
    ws()
    const j = src.indexOf(']', i)
    const s = src.slice(i + 1, j)
    i = j + 1
    return s
  }
  const primary = (): Node => {
    const c = peek()
    if (c === '(') {
      i++
      const e = expr()
      ws()
      i++
      return e
    }
    if (c === '-') {
      i++
      return { t: 'neg', a: primary() }
    }
    if (c === '[') return { t: 'msr', name: bracket() }
    if (c === '"') {
      const j = src.indexOf('"', i + 1)
      const s = src.slice(i + 1, j)
      i = j + 1
      return { t: 'str', v: s }
    }
    if (/[0-9.]/.test(c ?? '')) {
      const m = /^[0-9.]+(E[+-]?\d+)?/i.exec(src.slice(i))!
      i += m[0].length
      return { t: 'num', v: Number(m[0]) }
    }
    const id = ident()
    ws()
    if (src[i] === '[') return { t: 'col', table: id, column: bracket() }
    if (src[i] === '(') {
      i++
      const args: Node[] = []
      ws()
      if (src[i] === ')') i++
      else
        for (;;) {
          args.push(expr())
          ws()
          if (src[i] === ',') {
            i++
            continue
          }
          i++
          break
        }
      return { t: 'call', fn: id.toUpperCase(), args }
    }
    return { t: 'col', table: id, column: '' }
  }
  const term = (): Node => {
    let a = primary()
    for (;;) {
      const c = peek()
      if (c === '*' || c === '/') {
        i++
        a = { t: 'bin', op: c, a, b: primary() }
      } else return a
    }
  }
  const expr = (): Node => {
    let a = term()
    for (;;) {
      const c = peek()
      if (c === '+' || c === '-') {
        i++
        a = { t: 'bin', op: c, a, b: term() }
      } else return a
    }
  }
  return expr()
}

// ------------------------------------------------------------------------------------------------

export function createMockEngine(model: SemanticModel, data: DataStore): QueryEngine {
  const tableDef = (name: string): TableDef | undefined => model.tables.find((t) => t.name.toLowerCase() === name.toLowerCase())
  const tableData = (name: string): TableData | undefined => {
    for (const [k, v] of data.tables) if (k.toLowerCase() === name.toLowerCase()) return v
    return undefined
  }
  const colValues = (ref: ColRef): Scalar[] => {
    const td = tableData(ref.table)
    const c = td?.columns.find((x) => x.name.toLowerCase() === ref.column.toLowerCase())
    if (!c) throw new Error(`Column '${ref.table}'[${ref.column}] not found`)
    return c.values
  }
  const findMeasure = (name: string): { table: TableDef; expression: string; formatString?: string } | undefined => {
    for (const t of model.tables) {
      const m = t.measures.find((x) => x.name.toLowerCase() === name.toLowerCase())
      if (m) return { table: t, expression: m.expression, formatString: m.formatString }
    }
    return undefined
  }
  const parsed = new Map<string, Node>()
  const parse = (src: string) => {
    let n = parsed.get(src)
    if (!n) {
      n = parseMiniDax(src)
      parsed.set(src, n)
    }
    return n
  }

  /** column referenced by a SQ field (Column / HierarchyLevel) */
  const colOf = (expr: SQExpr): ColRef | undefined => {
    const f = fieldInfo(expr)
    if (f.kind === 'column' && f.table && f.property) return { table: f.table, column: f.property }
    if (f.kind === 'hierarchyLevel' && f.table && f.hierarchy) {
      const t = tableDef(f.table)
      const h = t?.hierarchies.find((x) => x.name === f.hierarchy)
      const lvl = h?.levels.find((l) => l.name === f.level)
      if (lvl) return { table: f.table, column: lvl.column }
      if (f.level) return { table: f.table, column: f.level }
    }
    return undefined
  }

  const evalNode = (n: Node, table: string, rows: Row[]): Scalar => {
    switch (n.t) {
      case 'num':
        return n.v
      case 'str':
        return n.v
      case 'neg': {
        const v = evalNode(n.a, table, rows)
        return typeof v === 'number' ? -v : null
      }
      case 'msr': {
        const m = findMeasure(n.name)
        if (!m) throw new Error(`Measure [${n.name}] not found`)
        return evalNode(parse(m.expression), table, rows)
      }
      case 'col': {
        const vals = colValues({ table: n.table, column: n.column })
        return rows.length ? vals[rows[0]] : null
      }
      case 'bin': {
        const a = evalNode(n.a, table, rows)
        const b = evalNode(n.b, table, rows)
        const x = typeof a === 'number' ? a : a === null ? 0 : NaN
        const y = typeof b === 'number' ? b : b === null ? 0 : NaN
        if (a === null && b === null) return null
        switch (n.op) {
          case '+':
            return x + y
          case '-':
            return x - y
          case '*':
            return x * y
          default:
            return y === 0 ? null : x / y
        }
      }
      case 'call': {
        const aggCol = (k: number) => {
          const c = n.args[k]
          if (c?.t !== 'col') throw new Error(`${n.fn} expects a column`)
          const vals = colValues({ table: c.table, column: c.column })
          return rows.map((r) => vals[r]).filter((v): v is number => typeof v === 'number')
        }
        switch (n.fn) {
          case 'SUM': {
            const v = aggCol(0)
            return v.length ? v.reduce((a, b) => a + b, 0) : null
          }
          case 'AVERAGE': {
            const v = aggCol(0)
            return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
          }
          case 'MIN': {
            const v = aggCol(0)
            return v.length ? Math.min(...v) : null
          }
          case 'MAX': {
            const v = aggCol(0)
            return v.length ? Math.max(...v) : null
          }
          case 'COUNTROWS':
            return rows.length || null
          case 'DISTINCTCOUNT': {
            const c = n.args[0]
            if (c?.t !== 'col') return null
            const vals = colValues({ table: c.table, column: c.column })
            return new Set(rows.map((r) => vals[r])).size || null
          }
          case 'DIVIDE': {
            const a = evalNode(n.args[0], table, rows)
            const b = evalNode(n.args[1], table, rows)
            if (typeof a !== 'number' || typeof b !== 'number' || b === 0) return n.args[2] ? evalNode(n.args[2], table, rows) : null
            return a / b
          }
          case 'BLANK':
            return null
          default:
            throw new Error(`Function ${n.fn} is not supported by the gallery mock engine`)
        }
      }
    }
  }

  const aggregate = (fn: number, vals: Scalar[]): Scalar => {
    const nums = vals.filter((v): v is number => typeof v === 'number')
    switch (fn) {
      case 0:
        return nums.length ? nums.reduce((a, b) => a + b, 0) : null
      case 1:
        return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
      case 2:
        return new Set(vals.filter((v) => v !== null).map((v) => (v instanceof Date ? v.getTime() : v))).size || null
      case 3:
        return nums.length ? Math.min(...nums) : null
      case 4:
        return nums.length ? Math.max(...nums) : null
      case 5:
        return vals.filter((v) => v !== null).length || null
      case 6: {
        const s = [...nums].sort((a, b) => a - b)
        if (!s.length) return null
        const m = s.length >> 1
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
      }
      default:
        return null
    }
  }

  const tableOfValue = (v: ValueExpr): string | undefined => {
    if (v.kind === 'measure') return findMeasure(v.measure)?.table.name
    if (v.kind === 'aggregate') return v.table
    if (v.kind === 'sq') {
      const f = fieldInfo(v.expr)
      if (f.kind === 'measure') return findMeasure(f.property ?? '')?.table.name ?? f.table
      return f.table
    }
    return undefined
  }

  const evalValue = (v: ValueExpr, table: string, rows: Row[]): Scalar => {
    if (v.kind === 'measure') return evalNode({ t: 'msr', name: v.measure }, table, rows)
    if (v.kind === 'aggregate') return aggregate(['sum', 'avg', 'distinctCount', 'min', 'max', 'countNonNull', 'median'].indexOf(v.fn), rows.map((r) => colValues(v)[r]))
    if (v.kind === 'dax') return evalNode(parse(v.expression), table, rows)
    const f = fieldInfo(v.expr)
    if (f.kind === 'measure') return evalNode({ t: 'msr', name: f.property ?? '' }, table, rows)
    if (f.kind === 'aggregation' && f.inner) {
      const c = colOf(v.expr.Aggregation.Expression)
      if (!c) return null
      const vals = colValues(c)
      return aggregate(f.aggregation ?? 0, rows.map((r) => vals[r]))
    }
    const c = colOf(v.expr)
    if (c) {
      const vals = colValues(c)
      const distinct = new Set(rows.map((r) => vals[r]))
      return distinct.size === 1 ? vals[rows[0]] : null
    }
    return null
  }

  // ---------------- filters
  const cmp = (a: Scalar, b: Scalar): number => {
    const x = a instanceof Date ? a.getTime() : a
    const y = b instanceof Date ? b.getTime() : b
    if (x === y) return 0
    if (x === null) return -1
    if (y === null) return 1
    return (x as any) < (y as any) ? -1 : 1
  }
  const lit = (e: any): Scalar => (e?.Literal ? decodeLiteral(e.Literal.Value) : null)
  const rowPred = (cond: any, table: string): ((r: Row) => boolean) => {
    if (!cond) return () => true
    if (cond.And) {
      const a = rowPred(cond.And.Left, table)
      const b = rowPred(cond.And.Right, table)
      return (r) => a(r) && b(r)
    }
    if (cond.Or) {
      const a = rowPred(cond.Or.Left, table)
      const b = rowPred(cond.Or.Right, table)
      return (r) => a(r) || b(r)
    }
    if (cond.Not) {
      const a = rowPred(cond.Not.Expression, table)
      return (r) => !a(r)
    }
    const access = (e: any): ((r: Row) => Scalar) | undefined => {
      const c = colOf(e)
      if (!c || c.table.toLowerCase() !== table.toLowerCase()) return undefined
      const vals = colValues(c)
      return (r) => vals[r]
    }
    if (cond.In) {
      const accs = (cond.In.Expressions ?? []).map(access)
      if (accs.some((a: any) => !a)) return () => true
      const tuples: Scalar[][] = (cond.In.Values ?? []).map((t: any[]) => t.map(lit))
      return (r) => tuples.some((t) => t.every((v, k) => cmp(accs[k]!(r), v) === 0))
    }
    if (cond.Comparison) {
      const a = access(cond.Comparison.Left)
      if (!a) return () => true
      const v = lit(cond.Comparison.Right)
      const k = cond.Comparison.ComparisonKind
      return (r) => {
        const c = cmp(a(r), v)
        return k === 0 ? c === 0 : k === 1 ? c > 0 : k === 2 ? c >= 0 : k === 3 ? c < 0 : c <= 0
      }
    }
    if (cond.Between) {
      const a = access(cond.Between.Expression)
      if (!a) return () => true
      const lo = lit(cond.Between.LowerBound)
      const hi = lit(cond.Between.UpperBound)
      return (r) => cmp(a(r), lo) >= 0 && cmp(a(r), hi) <= 0
    }
    for (const k of ['Contains', 'StartsWith', 'EndsWith'] as const) {
      if (cond[k]) {
        const a = access(cond[k].Left)
        if (!a) return () => true
        const needle = String(lit(cond[k].Right) ?? '').toLowerCase()
        return (r) => {
          const s = String(a(r) ?? '').toLowerCase()
          return k === 'Contains' ? s.includes(needle) : k === 'StartsWith' ? s.startsWith(needle) : s.endsWith(needle)
        }
      }
    }
    return () => true
  }
  const filterRows = (table: string, filters: SQFilter[] | undefined): Row[] => {
    const td = tableData(table)
    if (!td) throw new Error(`Table '${table}' not found`)
    const preds = (filters ?? []).flatMap((f) => (f.Where ?? []).map((w) => rowPred(w.Condition, table)))
    const out: Row[] = []
    for (let r = 0; r < td.rowCount; r++) if (preds.every((p) => p(r))) out.push(r)
    return out
  }

  const describeCol = (ref: ColRef) => {
    const t = tableDef(ref.table)
    return t?.columns.find((c) => c.name.toLowerCase() === ref.column.toLowerCase())
  }

  const engine: QueryEngine = {
    model,
    data,
    summarize(req: SummarizeRequest): SummarizeResult {
      const groups = req.groupBy.map((g: GroupExpr) => ('kind' in g ? colOf(g.expr) : (g as ColRef)))
      if (groups.some((g) => !g)) throw new Error('Unsupported group-by expression')
      const table = groups[0]?.table ?? req.values.map((v) => tableOfValue(v.expr)).find(Boolean)
      if (!table) return { columns: [], rows: [] }
      for (const g of groups) if (g!.table.toLowerCase() !== table.toLowerCase()) throw new Error('The gallery mock engine only groups within one table')
      const rows = filterRows(table, req.filters)
      const gvals = groups.map((g) => colValues(g!))
      const sortVals = groups.map((g) => {
        const c = describeCol(g!)
        return c?.sortByColumn ? colValues({ table: g!.table, column: c.sortByColumn }) : null
      })
      const buckets = new Map<string, Row[]>()
      for (const r of rows) {
        const key = gvals.map((v) => {
          const x = v[r]
          return x instanceof Date ? 'd' + x.getTime() : JSON.stringify(x)
        }).join('|')
        let b = buckets.get(key)
        if (!b) buckets.set(key, (b = []))
        b.push(r)
      }
      const hlRows = req.highlightFilters?.length ? new Set(filterRows(table, [...(req.filters ?? []), ...req.highlightFilters])) : undefined
      type Out = { g: Scalar[]; s: Scalar[]; v: Scalar[]; h?: Scalar[] }
      const out: Out[] = []
      for (const b of buckets.values()) {
        const g = gvals.map((v) => v[b[0]])
        const s = sortVals.map((sv, i) => (sv ? sv[b[0]] : g[i]))
        const v = req.values.map((x) => evalValue(x.expr, table, b))
        if (req.values.length && !req.keepBlankRows && !req.showItemsWithNoData && v.every((x) => x === null)) continue
        let h: Scalar[] | undefined
        if (hlRows) {
          const hb = b.filter((r) => hlRows.has(r))
          h = req.values.map((x) => (hb.length ? evalValue(x.expr, table, hb) : null))
        }
        out.push({ g, s, v, h })
      }
      if (!groups.length && !out.length && req.values.length) out.push({ g: [], s: [], v: req.values.map((x) => evalValue(x.expr, table, rows)) })
      const order = req.orderBy ?? groups.map((_, i) => ({ target: { group: i }, direction: 'asc' as const }))
      out.sort((a, b) => {
        for (const o of order) {
          let c = 0
          if ('group' in o.target) c = cmp(a.s[o.target.group], b.s[o.target.group])
          else {
            const id = (o.target as { value: string }).value
            const vi = req.values.findIndex((v) => v.id === id)
            c = cmp(a.v[vi], b.v[vi])
          }
          if (c) return o.direction === 'desc' ? -c : c
        }
        return 0
      })
      const limited = req.limit ? out.slice(0, req.limit) : out
      const columns = [
        ...groups.map((g) => {
          const c = describeCol(g!)
          return { id: `${g!.table}.${g!.column}`, kind: 'group' as const, dataType: c?.dataType ?? 'unknown', formatString: c?.formatString, name: g!.column }
        }),
        ...req.values.map((v) => {
          const d = v.expr.kind === 'sq' ? engine.describeField(v.expr.expr) : undefined
          return { id: v.id, kind: 'value' as const, dataType: d?.dataType ?? ('double' as DataType), formatString: d?.formatString, name: d?.displayName ?? v.id }
        })
      ]
      return {
        columns,
        rows: limited.map((o) => [...o.g, ...o.v]),
        highlights: hlRows ? limited.map((o) => o.h ?? req.values.map(() => null)) : undefined,
        truncated: limited.length < out.length
      }
    },
    distinctValues(req: DistinctValuesRequest) {
      const c = 'kind' in req.column ? colOf(req.column.expr) : (req.column as ColRef)
      if (!c) return { values: [], dataType: 'unknown' }
      const rows = filterRows(c.table, req.filters)
      const vals = colValues(c)
      const seen = new Map<string, Scalar>()
      for (const r of rows) {
        const v = vals[r]
        if (req.search && !String(v ?? '').toLowerCase().includes(req.search.toLowerCase())) continue
        seen.set(v instanceof Date ? 'd' + v.getTime() : JSON.stringify(v), v)
      }
      const values = [...seen.values()].sort(cmp)
      return { values: req.limit ? values.slice(0, req.limit) : values, dataType: describeCol(c)?.dataType ?? 'unknown' }
    },
    evaluateScalar(expression: string, filters?: SQFilter[]) {
      const n = parse(expression)
      const findTable = (x: Node): string | undefined =>
        x.t === 'col' ? x.table : x.t === 'msr' ? findMeasure(x.name)?.table.name : x.t === 'call' ? x.args.map(findTable).find(Boolean) : x.t === 'bin' ? findTable(x.a) ?? findTable(x.b) : x.t === 'neg' ? findTable(x.a) : undefined
      const table = findTable(n) ?? model.tables[0]?.name
      return { value: table ? evalNode(n, table, filterRows(table, filters)) : null }
    },
    runDaxQuery() {
      throw new Error('DAX queries are not supported by the gallery mock engine')
    },
    validateExpression() {
      return []
    },
    format: mockFormat,
    processCalculated() {
      return []
    },
    invalidate() {
      parsed.clear()
    },
    describeField(expr: SQExpr): FieldDescription | undefined {
      const f = fieldInfo(expr)
      if (f.kind === 'measure') {
        const m = findMeasure(f.property ?? '')
        if (!m) return undefined
        return { kind: 'measure', table: m.table.name, name: f.property!, displayName: f.property!, dataType: 'double', formatString: m.formatString, isMeasure: true }
      }
      if (f.kind === 'aggregation') {
        const c = colOf(expr.Aggregation.Expression)
        const cd = c ? describeCol(c) : undefined
        const fn = f.aggregation ?? 0
        const counting = fn === 2 || fn === 5
        return {
          kind: 'aggregation',
          table: f.table ?? '',
          name: f.property ?? '',
          displayName: `${SQ_AGG_NAMES[fn] === 'Count (Distinct)' ? 'Count of' : SQ_AGG_NAMES[fn] + ' of'} ${f.property}`,
          dataType: counting ? 'int64' : (cd?.dataType ?? 'double'),
          formatString: counting ? '#,0' : cd?.formatString,
          isMeasure: true,
          column: c
        }
      }
      const c = colOf(expr)
      if (!c) return undefined
      const cd = describeCol(c)
      if (!cd) return undefined
      return {
        kind: f.kind === 'hierarchyLevel' ? 'hierarchyLevel' : 'column',
        table: c.table,
        name: f.kind === 'hierarchyLevel' ? (f.level ?? cd.name) : cd.name,
        displayName: f.kind === 'hierarchyLevel' ? (f.level ?? cd.name) : cd.name,
        dataType: cd.dataType,
        formatString: cd.formatString,
        isMeasure: false,
        sortBy: cd.sortByColumn ? { table: c.table, column: cd.sortByColumn } : undefined,
        column: c,
        dataCategory: cd.dataCategory
      }
    },
    resolveFieldParameter() {
      return null
    }
  }
  return engine
}

/** FORMAT-like formatter (uses the DAX engine's formatter; falls back for named formats). */
export function mockFormat(value: Scalar, formatString?: string): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    const named = (formatString ?? '').toLowerCase()
    if (!formatString || named === 'short date' || named === 'general date') return `${value.getUTCMonth() + 1}/${value.getUTCDate()}/${value.getUTCFullYear()}`
    try {
      return formatValue(DaxDate.fromParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()) as any, formatString)
    } catch {
      return `${value.getUTCMonth() + 1}/${value.getUTCDate()}/${value.getUTCFullYear()}`
    }
  }
  if (typeof value === 'number') {
    if (!formatString) return Number.isInteger(value) ? String(value) : String(Math.round(value * 1e10) / 1e10)
    try {
      return formatValue(value as any, formatString)
    } catch {
      const pf = parseNumberFormat(formatString)
      if (pf.percent) return formatFixed(value * 100, pf.decimals, pf.grouping) + '%'
      return pf.prefix + formatFixed(value, Math.max(0, pf.decimals), pf.grouping) + pf.suffix
    }
  }
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  return String(value)
}
