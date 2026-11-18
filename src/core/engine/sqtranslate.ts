/**
 * SQ (PBIR semantic query) -> tabular engine translation: field resolution (columns, measures, aggregations,
 * hierarchy levels incl. auto date/time variations) and filters (In / Not / And / Or / Comparison / Between /
 * Contains / StartsWith / EndsWith / DateSpan relative dates / TopN subqueries / measure conditions).
 */
import type { SemanticModel } from '../model/types'
import type { SQExpr, SQFilter } from '../report/sq'
import { decodeLiteral as decodeRaw } from '../report/literal'
import type { Col, DaxModel, Measure, Tbl } from '../dax/tabular/model'
import type { Node } from '../dax/tabular/parser'
import { colFilter, tupleFilterFromCodes, type Filter } from '../dax/tabular/filters'
import { dayNumber, fromDayNumber, makeDate, MS_PER_DAY, sortCompare, type Scalar } from '../dax/tabular/values'

export type Resolved =
  | { kind: 'column'; col: Col }
  | { kind: 'measure'; measure: Measure }
  | { kind: 'aggregation'; col: Col; fn: number }
  | { kind: 'expr'; node: Node; label: string }

function decodeLiteral(v: unknown): Scalar {
  const x = decodeRaw(v)
  return x instanceof Uint8Array ? null : x
}

export const AGG_DAX: Record<number, string> = {
  0: 'SUM',
  1: 'AVERAGE',
  2: 'DISTINCTCOUNT',
  3: 'MIN',
  4: 'MAX',
  5: 'COUNTA',
  6: 'MEDIAN',
  7: 'STDEV.S',
  8: 'VAR.S'
}

const P = { s: 0, e: 0 }
export function colNode(c: Col): Node {
  return { kind: 'column', table: c.table.name, name: c.name, ...P }
}
/** Measure reference; unqualified when its table has a column of the same name ('T'[X] would be the column). */
export function measureNode(m: Measure): Node {
  return { kind: 'column', table: m.table.column(m.name) ? null : m.table.name, name: m.name, ...P }
}
export function callNode(name: string, args: Node[]): Node {
  return { kind: 'call', name, args, ...P }
}
export function litNode(v: Scalar): Node {
  if (v === null) return callNode('BLANK', [])
  if (typeof v === 'number') return { kind: 'number', value: v, ...P }
  if (typeof v === 'boolean') return { kind: 'bool', value: v, ...P }
  if (v instanceof Date) {
    const d = callNode('DATE', [litNode(v.getUTCFullYear()), litNode(v.getUTCMonth() + 1), litNode(v.getUTCDate())])
    const ms = v.getTime() - dayNumber(v) * MS_PER_DAY
    if (!ms) return d
    return { kind: 'binary', op: '+', left: d, right: callNode('TIME', [litNode(v.getUTCHours()), litNode(v.getUTCMinutes()), litNode(v.getUTCSeconds())]), ...P }
  }
  return { kind: 'string', value: v, ...P }
}

/** Value node for a resolved field (measures as references, aggregations as calls). */
export function valueNode(r: Resolved): Node {
  switch (r.kind) {
    case 'measure':
      return measureNode(r.measure)
    case 'aggregation':
      return callNode(AGG_DAX[r.fn] ?? 'SUM', [colNode(r.col)])
    case 'column': {
      const c = r.col
      const sb = c.def?.summarizeBy
      const fn =
        sb === 'sum' ? 'SUM' : sb === 'average' ? 'AVERAGE' : sb === 'min' ? 'MIN' : sb === 'max' ? 'MAX' : sb === 'count' ? 'COUNTA' : sb === 'distinctCount' ? 'DISTINCTCOUNT' : c.dataType === 'int64' || c.dataType === 'double' || c.dataType === 'decimal' ? (sb === 'none' ? 'MIN' : 'SUM') : 'MIN'
      return callNode(fn, [colNode(c)])
    }
    case 'expr':
      return r.node
  }
}

type Aliases = Record<string, string>
type Subqueries = Record<string, any>

const DERIVED_PARTS = ['Year', 'Quarter', 'QuarterNo', 'Month', 'MonthNo', 'Day'] as const
type DerivedPart = (typeof DERIVED_PARTS)[number]
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export class SqResolver {
  private derived = new Map<string, Col>()
  constructor(
    readonly model: DaxModel,
    readonly sm: SemanticModel
  ) {}

  entity(expr: any, aliases: Aliases): string | undefined {
    if (!expr) return undefined
    const sr = expr.SourceRef
    if (sr) return sr.Entity ?? (sr.Source ? aliases[sr.Source] ?? sr.Source : undefined)
    if (expr.Column) return this.entity(expr.Column.Expression, aliases)
    if (expr.Measure) return this.entity(expr.Measure.Expression, aliases)
    if (expr.Hierarchy) return this.entity(expr.Hierarchy.Expression, aliases)
    if (expr.PropertyVariationSource) return this.entity(expr.PropertyVariationSource.Expression, aliases)
    return undefined
  }

  /** Auto date/time derived column (when the LocalDateTable is missing). */
  derivedColumn(base: Col, part: DerivedPart): Col {
    const key = `${base.id}|${part}`
    let c = this.derived.get(key)
    if (c && c.table.column(c.name) === c) return c
    const t = base.table
    const name = `\u0001${base.name}.${part}`
    c = t.column(name) ?? t.addColumn(name, part === 'Quarter' || part === 'Month' ? 'string' : 'int64', 'calculated')
    c.isHidden = true
    const vals = new Array<Scalar>(t.rowCount)
    for (let r = 0; r < t.rowCount; r++) {
      const v = base.value(r)
      if (!(v instanceof Date)) {
        vals[r] = null
        continue
      }
      const m = v.getUTCMonth()
      switch (part) {
        case 'Year':
          vals[r] = v.getUTCFullYear()
          break
        case 'Quarter':
          vals[r] = `Qtr ${Math.floor(m / 3) + 1}`
          break
        case 'QuarterNo':
          vals[r] = Math.floor(m / 3) + 1
          break
        case 'Month':
          vals[r] = MONTH_NAMES[m]
          break
        case 'MonthNo':
          vals[r] = m + 1
          break
        case 'Day':
          vals[r] = v.getUTCDate()
          break
      }
    }
    c.setValues(vals)
    if (part === 'Quarter') c.sortBy = this.derivedColumn(base, 'QuarterNo')
    if (part === 'Month') c.sortBy = this.derivedColumn(base, 'MonthNo')
    this.model.invalidateCaches()
    this.derived.set(key, c)
    return c
  }

  private hierarchyLevel(expr: any, aliases: Aliases): Col | null {
    const h = expr.HierarchyLevel.Expression?.Hierarchy
    const level: string = expr.HierarchyLevel.Level
    const hname: string = h?.Hierarchy
    const hexpr = h?.Expression
    const pvs = hexpr?.PropertyVariationSource
    if (pvs) {
      const tname = this.entity(pvs.Expression, aliases)
      const base = tname ? this.model.column(tname, pvs.Property) : undefined
      if (!base) return null
      // variation -> relationship -> local date table hierarchy
      const vdef = base.def?.variations?.find((v) => !pvs.Name || v.name.toLowerCase() === String(pvs.Name).toLowerCase()) ?? base.def?.variations?.[0]
      if (vdef) {
        const rel = this.model.relationships.find((r) => r.id === vdef.relationship || r.def?.name === vdef.relationship)
        const target: Tbl | undefined = rel ? (rel.from === base ? rel.to.table : rel.from.table) : undefined
        if (target && target.rowCount > 0) {
          const hh = target.hierarchies.find((x) => x.name.toLowerCase() === String(hname).toLowerCase()) ?? target.hierarchies[0]
          const lv = hh?.levels.find((l) => l.name.toLowerCase() === level.toLowerCase())
          if (lv) return lv.column
          const direct = target.column(level)
          if (direct) return direct
        }
      }
      const part = DERIVED_PARTS.find((p) => p.toLowerCase() === level.toLowerCase())
      if (part && base.dataType === 'dateTime') return this.derivedColumn(base, part)
      return null
    }
    const tname = this.entity(hexpr, aliases)
    const t = tname ? this.model.findTable(tname) : undefined
    if (!t) return null
    const hh = t.hierarchies.find((x) => x.name.toLowerCase() === String(hname).toLowerCase())
    const lv = hh?.levels.find((l) => l.name.toLowerCase() === level.toLowerCase())
    return lv?.column ?? t.column(level) ?? null
  }

  resolve(expr: SQExpr, aliases: Aliases = {}): Resolved | null {
    if (!expr || typeof expr !== 'object') return null
    if (expr.Column) {
      const t = this.entity(expr.Column.Expression, aliases)
      const c = t ? this.model.column(t, expr.Column.Property) : undefined
      if (c) return { kind: 'column', col: c }
      // a measure referenced with Column syntax
      const m = this.model.measure(expr.Column.Property)
      return m ? { kind: 'measure', measure: m } : null
    }
    if (expr.Measure) {
      const m = this.model.measure(expr.Measure.Property)
      return m ? { kind: 'measure', measure: m } : null
    }
    if (expr.Aggregation) {
      const inner = this.resolve(expr.Aggregation.Expression, aliases)
      if (!inner || inner.kind !== 'column') return null
      return { kind: 'aggregation', col: inner.col, fn: Number(expr.Aggregation.Function ?? 0) }
    }
    if (expr.HierarchyLevel) {
      const c = this.hierarchyLevel(expr, aliases)
      return c ? { kind: 'column', col: c } : null
    }
    if (expr.Arithmetic) {
      const l = this.resolve(expr.Arithmetic.Left, aliases)
      const r = this.resolve(expr.Arithmetic.Right, aliases)
      if (!l || !r) return null
      const op = ['+', '-', '*', '/'][Number(expr.Arithmetic.Operator ?? 0)] ?? '+'
      const node: Node =
        op === '/' ? callNode('DIVIDE', [valueNode(l), valueNode(r)]) : { kind: 'binary', op, left: valueNode(l), right: valueNode(r), ...P }
      return { kind: 'expr', node, label: 'Expression' }
    }
    if (expr.ScopedEval) {
      const inner = this.resolve(expr.ScopedEval.Expression, aliases)
      if (!inner) return null
      // ScopedEval with an empty scope = the visual total: evaluate without the visual's group-by filters
      return { kind: 'expr', node: callNode('CALCULATE', [valueNode(inner), callNode('ALLSELECTED', [])]), label: 'Total' }
    }
    if (expr.Literal) return { kind: 'expr', node: litNode(decodeLiteral(expr.Literal.Value)), label: 'Literal' }
    return null
  }

  // ------------------------------------------------------------------------------------------------
  // filters
  // ------------------------------------------------------------------------------------------------

  translate(filters: SQFilter[], now: Date, evalTopN: (sub: any, aliases: Aliases, done: Filter[]) => Filter | null): { filters: Filter[]; measureConds: Node[]; warnings: string[] } {
    const out: Filter[] = []
    const measureConds: Node[] = []
    const warnings: string[] = []
    const deferred: Array<() => void> = []
    for (const f of filters ?? []) {
      if (!f || !Array.isArray(f.Where)) continue
      const aliases: Aliases = {}
      const subs: Subqueries = {}
      for (const fr of f.From ?? []) {
        if (fr.Entity) aliases[fr.Name] = fr.Entity
        else if (fr.Expression?.Subquery) subs[fr.Name] = fr.Expression.Subquery
      }
      for (const w of f.Where) {
        const cond = w?.Condition
        if (!cond) continue
        // TopN: In { Expressions, Table: SourceRef to a subquery }
        if (cond.In?.Table) {
          const src = cond.In.Table.SourceRef?.Source
          const sub = src ? subs[src] : undefined
          if (!sub) {
            warnings.push('A TopN filter references an unknown subquery source; ignored.')
            continue
          }
          deferred.push(() => {
            const r = evalTopN(sub, aliases, out)
            if (r) out.push(r)
            else warnings.push('A TopN filter could not be evaluated; ignored.')
          })
          continue
        }
        try {
          this.condition(cond, aliases, now, out, measureConds)
        } catch (e) {
          warnings.push(`Filter ignored: ${(e as Error).message}`)
        }
      }
    }
    for (const d of deferred) d()
    return { filters: out, measureConds, warnings }
  }

  private fieldsOf(cond: any, aliases: Aliases, acc: { cols: Col[]; keys: string[]; measure: boolean }): void {
    if (!cond || typeof cond !== 'object') return
    if (Array.isArray(cond)) {
      cond.forEach((c) => this.fieldsOf(c, aliases, acc))
      return
    }
    if (cond.Column || cond.HierarchyLevel || cond.Measure || cond.Aggregation) {
      const r = this.resolve(cond, aliases)
      if (!r) throw new Error(`cannot resolve field ${JSON.stringify(cond).slice(0, 120)}`)
      if (r.kind === 'column') {
        if (!acc.cols.includes(r.col)) acc.cols.push(r.col)
      } else acc.measure = true
      return
    }
    if (cond.Literal || cond.Now || cond.SourceRef) return
    for (const v of Object.values(cond)) this.fieldsOf(v, aliases, acc)
  }

  private condition(cond: any, aliases: Aliases, now: Date, out: Filter[], measureConds: Node[]): void {
    if (cond.And) {
      this.condition(cond.And.Left, aliases, now, out, measureConds)
      this.condition(cond.And.Right, aliases, now, out, measureConds)
      return
    }
    const acc = { cols: [] as Col[], keys: [], measure: false }
    this.fieldsOf(cond, aliases, acc)
    if (acc.measure) {
      measureConds.push(this.conditionNode(cond, aliases, now))
      return
    }
    if (acc.cols.length === 0) return
    const cols = acc.cols
    const pred = (vals: Scalar[]) => truthy(this.evalCond(cond, aliases, now, cols, vals))
    if (cols.length === 1) {
      const c = cols[0]
      const keep: number[] = []
      for (let code = 0; code < c.dict.length; code++) if (pred([c.dict[code]])) keep.push(code)
      out.push(colFilter(c, keep))
      return
    }
    // several columns: distinct tuples per table, cross joined across tables
    const byTable = new Map<Tbl, Col[]>()
    for (const c of cols) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c])
    let combos: Array<{ cols: Col[]; codes: number[] }> = [{ cols: [], codes: [] }]
    for (const [t, tcols] of byTable) {
      const seen = new Set<string>()
      const tuples: number[][] = []
      for (let r = 0; r < t.fullCount; r++) {
        const tu = tcols.map((c) => c.codes[r])
        const k = tu.join(',')
        if (seen.has(k)) continue
        seen.add(k)
        tuples.push(tu)
      }
      const next: typeof combos = []
      for (const c of combos) for (const tu of tuples) next.push({ cols: [...c.cols, ...tcols], codes: [...c.codes, ...tu] })
      if (next.length > 2_000_000) throw new Error('filter over too many value combinations')
      combos = next
    }
    const order = combos[0].cols
    const kept: Int32Array[] = []
    for (const combo of combos) {
      const vals = cols.map((c) => c.dict[combo.codes[order.indexOf(c)]])
      if (pred(vals)) kept.push(Int32Array.from(cols.map((c) => combo.codes[order.indexOf(c)])))
    }
    out.push(tupleFilterFromCodes(cols, kept))
  }

  /** Evaluate a condition / scalar SQ expression against values of the given columns. */
  private evalCond(e: any, aliases: Aliases, now: Date, cols: Col[], vals: Scalar[]): Scalar | Span | boolean {
    if (!e || typeof e !== 'object') return null
    if (e.Literal) return decodeLiteral(e.Literal.Value)
    if (e.Column || e.HierarchyLevel) {
      const r = this.resolve(e, aliases)
      const i = r && r.kind === 'column' ? cols.indexOf(r.col) : -1
      return i >= 0 ? vals[i] : null
    }
    if (e.Not) return !truthy(this.evalCond(e.Not.Expression, aliases, now, cols, vals))
    if (e.And) return truthy(this.evalCond(e.And.Left, aliases, now, cols, vals)) && truthy(this.evalCond(e.And.Right, aliases, now, cols, vals))
    if (e.Or) return truthy(this.evalCond(e.Or.Left, aliases, now, cols, vals)) || truthy(this.evalCond(e.Or.Right, aliases, now, cols, vals))
    if (e.In) {
      const exprs: any[] = e.In.Expressions ?? []
      const actual = exprs.map((x) => this.evalCond(x, aliases, now, cols, vals) as Scalar)
      for (const row of e.In.Values ?? []) {
        if (row.every((lit: any, j: number) => looseEqual(actual[j], this.evalCond(lit, aliases, now, cols, vals) as Scalar))) return true
      }
      return false
    }
    if (e.Comparison) {
      const l = this.evalCond(e.Comparison.Left, aliases, now, cols, vals)
      const r = this.evalCond(e.Comparison.Right, aliases, now, cols, vals)
      return compareKind(Number(e.Comparison.ComparisonKind ?? 0), l, r)
    }
    if (e.Between) {
      const v = this.evalCond(e.Between.Expression, aliases, now, cols, vals)
      const lo = this.evalCond(e.Between.LowerBound, aliases, now, cols, vals)
      const hi = this.evalCond(e.Between.UpperBound, aliases, now, cols, vals)
      return compareKind(2, v, lo) && compareKind(4, v, hi)
    }
    for (const k of ['Contains', 'StartsWith', 'EndsWith', 'DoesNotContain', 'DoesNotStartWith', 'DoesNotEndWith']) {
      if (e[k]) {
        const l = this.evalCond(e[k].Left, aliases, now, cols, vals)
        const r = this.evalCond(e[k].Right, aliases, now, cols, vals)
        if (l === null || typeof l === 'object') return k.startsWith('DoesNot')
        const a = String(l).toLowerCase()
        const b = String(r ?? '').toLowerCase()
        const res = k.endsWith('Contains') ? a.includes(b) : k.endsWith('StartsWith') || k.endsWith('StartWith') ? a.startsWith(b) : a.endsWith(b)
        return k.startsWith('DoesNot') ? !res : res
      }
    }
    if (e.Now) return now
    if (e.DateAdd) {
      const base = this.evalCond(e.DateAdd.Expression, aliases, now, cols, vals)
      const d = base instanceof Date ? base : isSpan(base) ? base.start : null
      return d ? addUnit(d, Number(e.DateAdd.Amount ?? 0), Number(e.DateAdd.TimeUnit ?? 0)) : null
    }
    if (e.DateSpan) {
      const base = this.evalCond(e.DateSpan.Expression, aliases, now, cols, vals)
      const d = base instanceof Date ? base : isSpan(base) ? base.start : null
      return d ? spanOf(d, Number(e.DateSpan.TimeUnit ?? 0)) : null
    }
    if (e.Exists || e.AnyValue || e.DefaultValue) return true
    return null
  }

  /** DAX boolean AST for a condition over measures (applied per visual row). */
  conditionNode(e: any, aliases: Aliases, now: Date): Node {
    if (e.Not) return { kind: 'unary', op: 'NOT', operand: this.conditionNode(e.Not.Expression, aliases, now), ...P }
    if (e.And) return { kind: 'binary', op: '&&', left: this.conditionNode(e.And.Left, aliases, now), right: this.conditionNode(e.And.Right, aliases, now), ...P }
    if (e.Or) return { kind: 'binary', op: '||', left: this.conditionNode(e.Or.Left, aliases, now), right: this.conditionNode(e.Or.Right, aliases, now), ...P }
    if (e.Comparison) {
      const kind = Number(e.Comparison.ComparisonKind ?? 0)
      const l = this.scalarNode(e.Comparison.Left, aliases, now)
      const rLit = e.Comparison.Right?.Literal ? decodeLiteral(e.Comparison.Right.Literal.Value) : undefined
      if (rLit === null && kind === 0) return callNode('ISBLANK', [l])
      const r = this.scalarNode(e.Comparison.Right, aliases, now)
      return { kind: 'binary', op: ['=', '>', '>=', '<', '<='][kind] ?? '=', left: l, right: r, ...P }
    }
    if (e.Between) {
      const v = this.scalarNode(e.Between.Expression, aliases, now)
      return {
        kind: 'binary',
        op: '&&',
        left: { kind: 'binary', op: '>=', left: v, right: this.scalarNode(e.Between.LowerBound, aliases, now), ...P },
        right: { kind: 'binary', op: '<=', left: v, right: this.scalarNode(e.Between.UpperBound, aliases, now), ...P },
        ...P
      }
    }
    if (e.In) {
      const exprs = (e.In.Expressions ?? []).map((x: any) => this.scalarNode(x, aliases, now))
      const ors: Node[] = (e.In.Values ?? []).map((row: any[]) =>
        row
          .map((lit, j): Node => ({ kind: 'binary', op: '==', left: exprs[j], right: this.scalarNode(lit, aliases, now), ...P }))
          .reduce((a: Node, b: Node): Node => ({ kind: 'binary', op: '&&', left: a, right: b, ...P }))
      )
      return ors.length ? ors.reduce((a, b) => ({ kind: 'binary', op: '||', left: a, right: b, ...P })) : { kind: 'bool', value: false, ...P }
    }
    return { kind: 'bool', value: true, ...P }
  }

  private scalarNode(e: any, aliases: Aliases, now: Date): Node {
    if (e?.Literal) return litNode(decodeLiteral(e.Literal.Value))
    const r = this.resolve(e, aliases)
    if (r) return valueNode(r)
    if (e?.Now) return litNode(now)
    throw new Error('unsupported expression in a measure filter')
  }
}

// ------------------------------------------------------------------------------------------------
// date spans & comparisons
// ------------------------------------------------------------------------------------------------

interface Span {
  span: true
  start: Date
  end: Date
}
function isSpan(v: unknown): v is Span {
  return typeof v === 'object' && v !== null && (v as Span).span === true
}

/** SQ TimeUnit: 0 Day, 1 Week, 2 Month, 3 Year, 4 Decade, 5 Second, 6 Minute, 7 Hour. */
function addUnit(d: Date, n: number, unit: number): Date {
  const r = new Date(d.getTime())
  switch (unit) {
    case 0:
      r.setUTCDate(r.getUTCDate() + n)
      return r
    case 1:
      r.setUTCDate(r.getUTCDate() + 7 * n)
      return r
    case 2: {
      const day = r.getUTCDate()
      r.setUTCDate(1)
      r.setUTCMonth(r.getUTCMonth() + n)
      const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate()
      r.setUTCDate(Math.min(day, last))
      return r
    }
    case 3:
      return addUnit(d, 12 * n, 2)
    case 4:
      return addUnit(d, 120 * n, 2)
    case 5:
      return new Date(d.getTime() + n * 1000)
    case 6:
      return new Date(d.getTime() + n * 60_000)
    case 7:
      return new Date(d.getTime() + n * 3_600_000)
  }
  return r
}

function spanOf(d: Date, unit: number): Span {
  let start: Date
  switch (unit) {
    case 0:
      start = fromDayNumber(dayNumber(d))
      return { span: true, start, end: addUnit(start, 1, 0) }
    case 1: {
      const day = dayNumber(d)
      start = fromDayNumber(day - d.getUTCDay())
      return { span: true, start, end: addUnit(start, 1, 1) }
    }
    case 2:
      start = makeDate(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
      return { span: true, start, end: addUnit(start, 1, 2) }
    case 3:
      start = makeDate(d.getUTCFullYear(), 1, 1)
      return { span: true, start, end: addUnit(start, 1, 3) }
    case 4:
      start = makeDate(Math.floor(d.getUTCFullYear() / 10) * 10, 1, 1)
      return { span: true, start, end: addUnit(start, 10, 3) }
    case 5:
      start = new Date(Math.floor(d.getTime() / 1000) * 1000)
      return { span: true, start, end: new Date(start.getTime() + 1000) }
    case 6:
      start = new Date(Math.floor(d.getTime() / 60_000) * 60_000)
      return { span: true, start, end: new Date(start.getTime() + 60_000) }
    case 7:
      start = new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000)
      return { span: true, start, end: new Date(start.getTime() + 3_600_000) }
  }
  return { span: true, start: d, end: d }
}

function truthy(v: unknown): boolean {
  return v === true || (typeof v === 'number' && v !== 0)
}

function norm(v: Scalar): Scalar {
  return v
}

export function looseEqual(a: Scalar, b: Scalar): boolean {
  if (a === null || b === null) return a === b
  if (a instanceof Date || b instanceof Date) {
    const x = a instanceof Date ? a.getTime() : NaN
    const y = b instanceof Date ? b.getTime() : NaN
    return x === y
  }
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase()
  if (typeof a === 'number' && typeof b === 'string') return String(a) === b.trim()
  if (typeof a === 'string' && typeof b === 'number') return a.trim() === String(b)
  if (typeof a === 'boolean' && typeof b === 'number') return (a ? 1 : 0) === b
  if (typeof a === 'number' && typeof b === 'boolean') return a === (b ? 1 : 0)
  return a === b
}

/** SQ QueryComparisonKind: 0 Equal, 1 GreaterThan, 2 GreaterThanOrEqual, 3 LessThan, 4 LessThanOrEqual. */
function compareKind(kind: number, l: unknown, r: unknown): boolean {
  if (isSpan(r)) {
    if (!(l instanceof Date)) return false
    const t = l.getTime()
    switch (kind) {
      case 0:
        return t >= r.start.getTime() && t < r.end.getTime()
      case 1:
        return t >= r.end.getTime()
      case 2:
        return t >= r.start.getTime()
      case 3:
        return t < r.start.getTime()
      case 4:
        return t < r.end.getTime()
    }
    return false
  }
  const a = norm(l as Scalar)
  const b = norm(r as Scalar)
  if (kind === 0) return looseEqual(a, b)
  let c: number
  if (a === null || b === null) {
    // comparisons are evaluated like DAX: BLANK converts to the other operand's default (0, "", FALSE, 12/30/1899),
    // so BLANK >= -18 is true (which is why Power BI adds an explicit "is not blank" condition when it means it)
    if (a === null && b === null) c = 0
    else {
      const other = (a ?? b) as Scalar
      const blankAs: Scalar = typeof other === 'string' ? '' : typeof other === 'boolean' ? false : other instanceof Date ? new Date(Date.UTC(1899, 11, 30)) : 0
      c = a === null ? sortCompare(blankAs, other) : sortCompare(other, blankAs)
    }
    return kind === 1 ? c > 0 : kind === 2 ? c >= 0 : kind === 3 ? c < 0 : kind === 4 ? c <= 0 : false
  }
  if (typeof a === 'number' && typeof b === 'string' && b.trim() !== '' && !Number.isNaN(Number(b))) c = a - Number(b)
  else if (typeof a === 'string' && typeof b === 'number') c = Number(a) - b
  else c = sortCompare(a, b)
  switch (kind) {
    case 1:
      return c > 0
    case 2:
      return c >= 0
    case 3:
      return c < 0
    case 4:
      return c <= 0
  }
  return false
}
