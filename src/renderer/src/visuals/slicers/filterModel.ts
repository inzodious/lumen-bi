/**
 * Slicer filter model — builds and parses the SQ filters Power BI persists for slicers
 * (`objects.general[0].properties.filter.filter`) so our files round-trip with PBI Desktop.
 *
 * Shapes (all `Version: 2`, `From` aliases = first letter of the entity, lower-cased, de-duplicated):
 *   list:          In { Expressions: [col], Values: [[lit], ...] }
 *   inverted list: Not { In ... }                      (Select all, then deselect)
 *   hierarchy:     In { Expressions: [c1..ck], Values: [[l1..lk], ...] }  (k = depth of the selected nodes)
 *                  multiple depths are OR-ed; exclusions under a selected parent are AND Not(In tuples)
 *                  e.g. And(In([cat], [A]), Not(In([cat, sub], [(A, x)])))
 *   range:         And(Comparison >= lo, Comparison <= hi)   (dates: >= start, < end + 1 day)
 *   before/after:  Comparison <= / >=  (dates: < day + 1 / >=)
 *   relative date: Between { Expression, LowerBound: DateSpan(DateAdd(...Now...)), UpperBound: DateSpan(...) }
 *   text slicer:   Contains { Left: col, Right: 'text' }
 *
 * Selection membership is computed by evaluating the filter (common/sqEval), so any filter
 * PBI wrote — even shapes we don't build ourselves — displays correctly.
 */
import type { Scalar } from '@core/model/data'
import { fieldKey, literalExpr, literalValue, normalizeFilter, type SQExpr, type SQFilter } from '@core/report/sq'
import { evalCondition, evalFilter, scalarEquals, type FieldAccessor } from '../common/sqEval'

// ---------------------------------------------------------------------------------------------
// From aliases
// ---------------------------------------------------------------------------------------------

function entityOfField(e: any): string | undefined {
  if (!e || typeof e !== 'object') return undefined
  if (e.SourceRef?.Entity) return e.SourceRef.Entity
  for (const v of Object.values(e)) {
    const r = entityOfField(v)
    if (r) return r
  }
  return undefined
}

/** Wrap Where conditions in a PBI-style filter: Entity refs become `Source` aliases declared in `From`. */
export function wrapFilter(condition: any): SQFilter {
  const from: Array<{ Name: string; Entity: string; Type: number }> = []
  const aliasOf = new Map<string, string>()
  const alias = (entity: string) => {
    let a = aliasOf.get(entity)
    if (a) return a
    const base = (entity.match(/[A-Za-z]/)?.[0] ?? 't').toLowerCase()
    a = base
    let i = 1
    const used = new Set(from.map((f) => f.Name))
    while (used.has(a)) a = `${base}${i++}`
    aliasOf.set(entity, a)
    from.push({ Name: a, Entity: entity, Type: 0 })
    return a
  }
  const rewrite = (e: any): any => {
    if (Array.isArray(e)) return e.map(rewrite)
    if (!e || typeof e !== 'object') return e
    if (e.SourceRef?.Entity !== undefined && Object.keys(e).length === 1) return { SourceRef: { Source: alias(e.SourceRef.Entity) } }
    const out: any = {}
    for (const [k, v] of Object.entries(e)) out[k] = rewrite(v)
    return out
  }
  const cond = rewrite(condition)
  return { Version: 2, From: from, Where: [{ Condition: cond }] }
}

/** The Where conditions of a filter with aliases resolved (Entity refs), ANDed into one condition. */
export function filterCondition(filter: SQFilter | undefined): any {
  if (!filter?.Where?.length) return undefined
  const n = normalizeFilter(filter)
  const conds = n.Where.map((w) => w.Condition)
  return conds.reduce((a, b) => ({ And: { Left: a, Right: b } }))
}

/** Strip a projection field to a filterable column expression (HierarchyLevel / Column kept as-is). */
export function filterTarget(expr: SQExpr): SQExpr {
  return expr
}

// ---------------------------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------------------------

/** Accessor for a tuple of values of the given fields (by fieldKey). */
export function tupleAccessor(fields: SQExpr[], values: Scalar[]): FieldAccessor {
  const keys = fields.map((f) => fieldKey(f))
  return (key) => {
    const i = keys.indexOf(key)
    return i >= 0 ? values[i] : undefined
  }
}

/** Does the filter select this tuple (values for the first `values.length` fields)? */
export function isSelected(filter: SQFilter | undefined, fields: SQExpr[], values: Scalar[], nowDate?: Date): boolean {
  if (!filter) return false
  return evalFilter(resolveRelativeFilter(filter, nowDate ?? wallClockNow())!, tupleAccessor(fields, values))
}

// ---------------------------------------------------------------------------------------------
// Flat list (Basic / Dropdown / Tile / button slicer)
// ---------------------------------------------------------------------------------------------

export interface ListSelection {
  /** 'include' = In(values); 'exclude' = Not(In(values)) (inverted selection / Select all minus some) */
  mode: 'include' | 'exclude'
  values: Scalar[]
  /**
   * Identity column when it differs from the displayed column (field parameters: PBI filters the
   * hidden "<param> Fields" group-by column and records the display labels in `valueMap`).
   */
  keyField?: SQExpr
  /** display labels parallel to `values` (from / for the filterExpressionMetadata annotation) */
  labels?: Scalar[]
}

function tableOf(e: SQExpr): string | undefined {
  return e?.Column?.Expression?.SourceRef?.Entity ?? e?.HierarchyLevel?.Expression?.Hierarchy?.Expression?.SourceRef?.Entity
}

export function listFilter(field: SQExpr, sel: ListSelection): SQFilter | undefined {
  if (!sel.values.length) return undefined
  const target = sel.keyField ?? field
  const cond = { In: { Expressions: [target], Values: sel.values.map((v) => [literalExpr(v)]) } }
  const f = wrapFilter(sel.mode === 'exclude' ? { Not: { Expression: cond } } : cond)
  if (sel.keyField && sel.labels?.length === sel.values.length) {
    // mirror PBI's metadata so the filter pane / PBI Desktop show friendly labels
    ;(f.Where[0] as any).Annotations = {
      filterExpressionMetadata: {
        expressions: [field],
        decomposedIdentities: {
          values: sel.values.map((v) => [{ '0': [literalExpr(v)] }]),
          columns: [{ value: sel.keyField }]
        },
        valueMap: sel.labels.map((l) => ({ '0': l === null ? null : String(l) }))
      }
    }
  }
  return f
}

/** Parse a persisted list filter. Returns undefined when the filter has another shape. */
export function parseListFilter(filter: SQFilter | undefined, field: SQExpr): ListSelection | undefined {
  const cond = filterCondition(filter)
  if (!cond) return undefined
  const key = fieldKey(field)
  const table = tableOf(field)
  let keyField: SQExpr | undefined
  const fromIn = (inNode: any): Scalar[] | undefined => {
    const exprs = inNode?.Expressions ?? []
    if (exprs.length !== 1) return undefined
    if (fieldKey(exprs[0]) !== key) {
      // identity (group-by) column of the same table, e.g. a field parameter's "Fields" column
      if (!table || tableOf(exprs[0]) !== table) return undefined
      keyField = exprs[0]
    }
    return (inNode.Values ?? []).map((row: any[]) => literalValue(row[0]))
  }
  const labels = (() => {
    const vm = (filter?.Where?.[0] as any)?.Annotations?.filterExpressionMetadata?.valueMap
    return Array.isArray(vm) ? vm.map((m: any) => (m?.['0'] ?? null) as Scalar) : undefined
  })()
  let out: ListSelection | undefined
  if (cond.In) {
    const v = fromIn(cond.In)
    out = v ? { mode: 'include', values: v } : undefined
  } else if (cond.Not?.Expression?.In) {
    const v = fromIn(cond.Not.Expression.In)
    out = v ? { mode: 'exclude', values: v } : undefined
  }
  if (out && keyField) {
    out.keyField = keyField
    if (labels && labels.length === out.values.length) out.labels = labels
  }
  return out
}

export function listContains(values: Scalar[], v: Scalar): boolean {
  return values.some((x) => scalarEquals(x, v))
}

/**
 * Toggle a value in a list selection following PBI's click semantics.
 *  - `replace`: plain click with "multi-select with Ctrl" on (or strict single select): select only this item
 *    (clicking the only selected item clears).
 *  - otherwise: add/remove.
 */
export function toggleListValue(sel: ListSelection | undefined, v: Scalar, replace: boolean, label?: Scalar): ListSelection {
  const cur: ListSelection = sel ?? { mode: 'include', values: [] }
  const withLabels = cur.keyField !== undefined
  if (replace) {
    const only = cur.mode === 'include' && cur.values.length === 1 && scalarEquals(cur.values[0], v)
    return { ...cur, mode: 'include', values: only ? [] : [v], labels: withLabels ? (only ? [] : [label ?? v]) : undefined }
  }
  const idx = cur.values.findIndex((x) => scalarEquals(x, v))
  if (idx >= 0) {
    return {
      ...cur,
      values: cur.values.filter((_, i) => i !== idx),
      labels: withLabels ? (cur.labels ?? []).filter((_, i) => i !== idx) : undefined
    }
  }
  return { ...cur, values: [...cur.values, v], labels: withLabels ? [...(cur.labels ?? cur.values), label ?? v] : undefined }
}

// ---------------------------------------------------------------------------------------------
// Hierarchy slicers
// ---------------------------------------------------------------------------------------------

export interface HierNode {
  value: Scalar
  path: Scalar[]
  children: HierNode[]
  /** leaf count under this node */
  leaves: number
}

function pathKey(path: Scalar[]): string {
  return path.map((v) => (v instanceof Date ? 'd' + v.getTime() : JSON.stringify(v))).join('\u0001')
}

/** Build a tree from leaf tuples (rows of a summarize with all levels grouped, already sorted). */
export function buildHierTree(tuples: Scalar[][], depth: number): HierNode {
  const root: HierNode = { value: null, path: [], children: [], leaves: 0 }
  const index = new Map<string, HierNode>()
  for (const t of tuples) {
    let parent = root
    for (let d = 0; d < depth; d++) {
      const path = t.slice(0, d + 1)
      const k = pathKey(path)
      let node = index.get(k)
      if (!node) {
        node = { value: t[d], path, children: [], leaves: 0 }
        index.set(k, node)
        parent.children.push(node)
      }
      parent = node
    }
  }
  const count = (n: HierNode): number => (n.leaves = n.children.length ? n.children.reduce((s, c) => s + count(c), 0) : 1)
  count(root)
  return root
}

export function leafPaths(n: HierNode): Scalar[][] {
  if (!n.children.length) return [n.path]
  return n.children.flatMap(leafPaths)
}

export type TriState = 'on' | 'off' | 'partial'

/** Selected leaf keys under a filter (inverted + no filter = everything). */
export function selectedLeafKeys(root: HierNode, fields: SQExpr[], filter: SQFilter | undefined, invertedAll: boolean): Set<string> {
  const out = new Set<string>()
  for (const p of leafPaths(root)) if (filter ? isSelected(filter, fields, p) : invertedAll) out.add(pathKey(p))
  return out
}

export function nodeState(n: HierNode, selected: Set<string>): TriState {
  const leaves = leafPaths(n)
  let on = 0
  for (const l of leaves) if (selected.has(pathKey(l))) on++
  return on === 0 ? 'off' : on === leaves.length ? 'on' : 'partial'
}

export interface HierSelection {
  include: Scalar[][]
  exclude: Scalar[][]
  /** inverted: root is included (Select all), only exclusions are written */
  inverted: boolean
}

/** Compress a set of selected leaves into include/exclude paths the way PBI writes them. */
export function compressSelection(root: HierNode, selected: Set<string>, inverted: boolean): HierSelection {
  const include: Scalar[][] = []
  const exclude: Scalar[][] = []
  const countOn = (n: HierNode) => leafPaths(n).filter((p) => selected.has(pathKey(p))).length
  const collectExclusions = (n: HierNode) => {
    for (const c of n.children) {
      const on = countOn(c)
      if (on === 0) exclude.push(c.path)
      else if (on < c.leaves) collectExclusions(c)
    }
  }
  const collectIncludes = (n: HierNode) => {
    for (const c of n.children) {
      const on = countOn(c)
      if (on === 0) continue
      if (on === c.leaves) include.push(c.path)
      else if (c.children.length && on * 2 > c.leaves) {
        include.push(c.path)
        collectExclusions(c)
      } else collectIncludes(c)
    }
  }
  if (inverted) collectExclusions(root)
  else collectIncludes(root)
  return { include, exclude, inverted }
}

function inByDepth(fields: SQExpr[], paths: Scalar[][]): any[] {
  const byDepth = new Map<number, Scalar[][]>()
  for (const p of paths) {
    const arr = byDepth.get(p.length) ?? []
    arr.push(p)
    byDepth.set(p.length, arr)
  }
  return [...byDepth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([d, ps]) => ({ In: { Expressions: fields.slice(0, d), Values: ps.map((p) => p.map((v) => literalExpr(v))) } }))
}

export function hierarchyFilter(fields: SQExpr[], sel: HierSelection): SQFilter | undefined {
  const inc = sel.inverted ? [] : inByDepth(fields, sel.include)
  const exc = inByDepth(fields, sel.exclude).map((c) => ({ Not: { Expression: c } }))
  if (!sel.inverted && !inc.length) return undefined
  const left = inc.length ? inc.reduce((a, b) => ({ Or: { Left: a, Right: b } })) : undefined
  const all = [...(left ? [left] : []), ...exc]
  if (!all.length) return undefined
  return wrapFilter(all.reduce((a, b) => ({ And: { Left: a, Right: b } })))
}

/** Parse a hierarchy filter into include/exclude paths (undefined if the shape isn't recognised). */
export function parseHierarchyFilter(filter: SQFilter | undefined, fields: SQExpr[]): HierSelection | undefined {
  const cond = filterCondition(filter)
  if (!cond) return undefined
  const keys = fields.map((f) => fieldKey(f))
  const include: Scalar[][] = []
  const exclude: Scalar[][] = []
  const inPaths = (n: any): Scalar[][] | undefined => {
    const ex: any[] = n?.Expressions ?? []
    if (!ex.length || ex.some((e, i) => fieldKey(e) !== keys[i])) return undefined
    return (n.Values ?? []).map((row: any[]) => row.map((l) => literalValue(l)))
  }
  const walkOr = (c: any): boolean => {
    if (c.Or) return walkOr(c.Or.Left) && walkOr(c.Or.Right)
    if (c.In) {
      const p = inPaths(c.In)
      if (!p) return false
      include.push(...p)
      return true
    }
    return false
  }
  const terms: any[] = []
  const flattenAnd = (c: any): void => {
    if (c.And) {
      flattenAnd(c.And.Left)
      flattenAnd(c.And.Right)
    } else terms.push(c)
  }
  flattenAnd(cond)
  let sawInclude = false
  for (const t of terms) {
    if (t.Not?.Expression?.In) {
      const p = inPaths(t.Not.Expression.In)
      if (!p) return undefined
      exclude.push(...p)
    } else {
      if (sawInclude || !walkOr(t)) return undefined
      sawInclude = true
    }
  }
  return { include, exclude, inverted: !sawInclude }
}

/** Toggle a node: fully selected → deselect all its leaves; otherwise select all its leaves. */
export function toggleHierNode(node: HierNode, selected: Set<string>, replace: boolean): Set<string> {
  const leaves = leafPaths(node).map(pathKey)
  const allOn = leaves.every((k) => selected.has(k))
  if (replace) {
    const onlyThis = allOn && selected.size === leaves.length
    return new Set(onlyThis ? [] : leaves)
  }
  const next = new Set(selected)
  if (allOn) for (const k of leaves) next.delete(k)
  else for (const k of leaves) next.add(k)
  return next
}

export { pathKey }

// ---------------------------------------------------------------------------------------------
// Range (Between / Before / After / Single)
// ---------------------------------------------------------------------------------------------

export interface RangeSelection {
  min?: number | Date | null
  max?: number | Date | null
}

const DAY = 86400000

function cmp(field: SQExpr, kind: number, v: number | Date): any {
  return { Comparison: { ComparisonKind: kind, Left: field, Right: literalExpr(v) } }
}

/** Range filter. Dates use PBI's [start, end + 1 day) form; numbers use [lo, hi]. */
export function rangeFilter(field: SQExpr, r: RangeSelection): SQFilter | undefined {
  const parts: any[] = []
  if (r.min !== undefined && r.min !== null) parts.push(cmp(field, 2, r.min))
  if (r.max !== undefined && r.max !== null) {
    if (r.max instanceof Date) parts.push(cmp(field, 3, new Date(startOfDay(r.max).getTime() + DAY)))
    else parts.push(cmp(field, 4, r.max))
  }
  if (!parts.length) return undefined
  return wrapFilter(parts.reduce((a, b) => ({ And: { Left: a, Right: b } })))
}

/** Single value: PBI writes `Comparison(=)` (e.g. What-if parameter slicers). */
export function equalsFilter(field: SQExpr, v: number | Date): SQFilter {
  return wrapFilter(cmp(field, 0, v))
}

/** Nearest value of a sorted list. */
export function snapTo(values: number[], v: number): number {
  let lo = 0
  let hi = values.length - 1
  if (hi < 0) return v
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (values[mid] < v) lo = mid + 1
    else hi = mid
  }
  const a = values[Math.max(0, lo - 1)]
  const b = values[lo]
  return Math.abs(a - v) <= Math.abs(b - v) ? a : b
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/** Parse a range filter (Comparison / And of Comparisons / Between with literal bounds). */
export function parseRangeFilter(filter: SQFilter | undefined, field: SQExpr): RangeSelection | undefined {
  const cond = filterCondition(filter)
  if (!cond) return undefined
  const key = fieldKey(field)
  const out: RangeSelection = {}
  const terms: any[] = []
  const flat = (c: any): void => {
    if (c.And) {
      flat(c.And.Left)
      flat(c.And.Right)
    } else terms.push(c)
  }
  flat(cond)
  for (const t of terms) {
    if (t.Comparison) {
      if (fieldKey(t.Comparison.Left) !== key) return undefined
      const v = literalValue(t.Comparison.Right)
      if (typeof v !== 'number' && !(v instanceof Date)) return undefined
      const k = t.Comparison.ComparisonKind
      if (k === 1 || k === 2) out.min = v
      else if (k === 3) out.max = v instanceof Date ? new Date(v.getTime() - DAY) : v
      else if (k === 4) out.max = v
      else if (k === 0) {
        out.min = v
        out.max = v
      } else return undefined
    } else if (t.Between && t.Between.LowerBound?.Literal && t.Between.UpperBound?.Literal) {
      if (fieldKey(t.Between.Expression) !== key) return undefined
      out.min = literalValue(t.Between.LowerBound) as number | Date
      out.max = literalValue(t.Between.UpperBound) as number | Date
    } else return undefined
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Relative date / time
// ---------------------------------------------------------------------------------------------

/** SQ TimeUnit enum. */
export const TimeUnit = { Day: 0, Week: 1, Month: 2, Year: 3, Decade: 4, Second: 5, Minute: 6, Hour: 7 } as const
export type RelUnit = 'days' | 'weeks' | 'months' | 'years' | 'minutes' | 'hours'
const UNIT_CODE: Record<RelUnit, number> = { days: 0, weeks: 1, months: 2, years: 3, minutes: 6, hours: 7 }
const CODE_UNIT: Record<number, RelUnit> = { 0: 'days', 1: 'weeks', 2: 'months', 3: 'years', 6: 'minutes', 7: 'hours' }

export interface RelativeSelection {
  anchor: 'last' | 'next' | 'this'
  n: number
  unit: RelUnit
  /** calendar periods (whole weeks/months/years), PBI's "(Calendar)" units */
  calendar: boolean
  /**
   * PBI `dateRange.includeToday` (default true). Only affects rolling (non-calendar) Last/Next date ranges:
   * on → the range ends (Last) / starts (Next) today; off → it ends yesterday / starts tomorrow.
   */
  includeToday?: boolean
  /** PBI `dateRange.anchorDate`: evaluate relative to this date instead of today (written as a literal in place of `Now`). */
  anchorDate?: Date
}

const now = () => ({ Now: {} })
const add = (e: any, amount: number, unit: number) => ({ DateAdd: { Expression: e, Amount: amount, TimeUnit: unit } })
const span = (e: any, unit: number) => ({ DateSpan: { Expression: e, TimeUnit: unit } })

/**
 * Lower/upper bound expressions for a relative selection (PBI shapes, verified against PBIR files written by
 * PBI Desktop: e.g. "Last 24 weeks" = Between(DateSpan(DateAdd(DateAdd(Now, 1, Day), -24, Week), Day), DateSpan(Now, Day)),
 * "Last 12 calendar weeks" = Between(DateSpan(DateAdd(Now, -12, Week), Week), DateSpan(DateAdd(Now, -1, Week), Week))).
 * The include-today = off variants shift the rolling window by one day (approximation of PBI's shape; same rows).
 */
export function relativeBounds(r: RelativeSelection): { lower: any; upper: any } {
  const u = UNIT_CODE[r.unit]
  const isTime = r.unit === 'minutes' || r.unit === 'hours'
  const grain = isTime ? (r.unit === 'hours' ? TimeUnit.Hour : TimeUnit.Minute) : TimeUnit.Day
  const base = () => (r.anchorDate ? literalExpr(startOfDay(r.anchorDate)) : now())
  if (r.anchor === 'this') return { lower: span(base(), u), upper: span(base(), u) }
  const n = Math.max(1, Math.round(r.n))
  const today = r.includeToday !== false || isTime
  const calendar = r.calendar || r.unit === 'days' || isTime
  if (r.anchor === 'last') {
    if (isTime) return { lower: span(add(add(base(), 1, grain), -n, u), grain), upper: span(base(), grain) }
    if (r.unit === 'days') {
      return today
        ? { lower: span(add(add(base(), 1, TimeUnit.Day), -n, TimeUnit.Day), TimeUnit.Day), upper: span(base(), TimeUnit.Day) }
        : { lower: span(add(base(), -n, TimeUnit.Day), TimeUnit.Day), upper: span(add(base(), -1, TimeUnit.Day), TimeUnit.Day) }
    }
    if (calendar) return { lower: span(add(base(), -n, u), u), upper: span(add(base(), -1, u), u) }
    return today
      ? { lower: span(add(add(base(), 1, TimeUnit.Day), -n, u), TimeUnit.Day), upper: span(base(), TimeUnit.Day) }
      : { lower: span(add(base(), -n, u), TimeUnit.Day), upper: span(add(base(), -1, TimeUnit.Day), TimeUnit.Day) }
  }
  // next
  if (isTime) return { lower: span(base(), grain), upper: span(add(add(base(), -1, grain), n, u), grain) }
  if (r.unit === 'days') {
    return today
      ? { lower: span(base(), TimeUnit.Day), upper: span(add(add(base(), -1, TimeUnit.Day), n, TimeUnit.Day), TimeUnit.Day) }
      : { lower: span(add(base(), 1, TimeUnit.Day), TimeUnit.Day), upper: span(add(base(), n, TimeUnit.Day), TimeUnit.Day) }
  }
  if (calendar) return { lower: span(add(base(), 1, u), u), upper: span(add(base(), n, u), u) }
  return today
    ? { lower: span(base(), TimeUnit.Day), upper: span(add(add(base(), -1, TimeUnit.Day), n, u), TimeUnit.Day) }
    : { lower: span(add(base(), 1, TimeUnit.Day), TimeUnit.Day), upper: span(add(base(), n, u), TimeUnit.Day) }
}

export function relativeFilter(field: SQExpr, r: RelativeSelection): SQFilter | undefined {
  if (r.anchor !== 'this' && !(r.n > 0)) return undefined
  const { lower, upper } = relativeBounds(r)
  return wrapFilter({ Between: { Expression: field, LowerBound: lower, UpperBound: upper } })
}

/** Anchor literal used in place of `Now` (if any). */
function findAnchor(e: any): Date | undefined {
  if (!e || typeof e !== 'object') return undefined
  if (e.Literal) {
    const v = literalValue(e)
    return v instanceof Date ? v : undefined
  }
  for (const v of Object.values(e)) {
    const r = findAnchor(v)
    if (r) return r
  }
  return undefined
}

/**
 * Parse a relative date/time filter by matching the bound shapes PBI writes (Between of DateSpans, or
 * PBI's "is in this <unit>" Comparison(=, DateSpan(Now, unit)) written by the filter pane).
 */
export function parseRelativeFilter(filter: SQFilter | undefined, field: SQExpr): RelativeSelection | undefined {
  const cond = filterCondition(filter)
  if (!cond) return undefined
  if (cond.Comparison?.ComparisonKind === 0 && cond.Comparison.Right?.DateSpan && fieldKey(cond.Comparison.Left) === fieldKey(field)) {
    const ds = cond.Comparison.Right.DateSpan
    const unit = CODE_UNIT[ds.TimeUnit]
    if (unit && (ds.Expression?.Now || ds.Expression?.Literal)) return { anchor: 'this', n: 1, unit, calendar: false, anchorDate: findAnchor(ds.Expression) }
    return undefined
  }
  const b = cond.Between
  if (!b || fieldKey(b.Expression) !== fieldKey(field)) return undefined
  if (!b.LowerBound?.DateSpan || !b.UpperBound?.DateSpan) return undefined
  const sig = JSON.stringify([b.LowerBound, b.UpperBound])
  const anchorDate = findAnchor(b.LowerBound)
  for (const anchor of ['this', 'last', 'next'] as const) {
    const n = anchor === 'this' ? 1 : findAmount(b.LowerBound, b.UpperBound, anchor)
    if (n === undefined) continue
    for (const unit of Object.keys(UNIT_CODE) as RelUnit[]) {
      for (const calendar of [false, true]) {
        for (const includeToday of [true, false]) {
          const cand: RelativeSelection = { anchor, n, unit, calendar, includeToday, anchorDate }
          const { lower, upper } = relativeBounds(cand)
          if (JSON.stringify([lower, upper]) === sig) {
            if (includeToday) delete cand.includeToday
            if (!anchorDate) delete cand.anchorDate
            return cand
          }
        }
      }
    }
  }
  return undefined
}

function findAmount(lower: any, upper: any, anchor: 'last' | 'next'): number | undefined {
  const amounts: number[] = []
  const walk = (e: any) => {
    if (!e || typeof e !== 'object') return
    if (e.DateAdd) {
      amounts.push(e.DateAdd.Amount)
      walk(e.DateAdd.Expression)
    } else if (e.DateSpan) walk(e.DateSpan.Expression)
  }
  walk(anchor === 'last' ? lower : upper)
  const cand = anchor === 'last' ? amounts.filter((a) => a < 0).map((a) => -a) : amounts.filter((a) => a > 0)
  return cand.length ? Math.max(...cand) : undefined
}

/** Evaluate a DateAdd/DateSpan/Now expression to a concrete [start, end) interval (naive UTC wall clock). */
export function evalDateExpr(e: any, nowDate: Date): { start: Date; end: Date } | Date | undefined {
  if (!e) return undefined
  if (e.Now) return nowDate
  if (e.Literal) {
    const v = literalValue(e)
    return v instanceof Date ? v : undefined
  }
  if (e.DateAdd) {
    const base = evalDateExpr(e.DateAdd.Expression, nowDate)
    const d = base instanceof Date ? base : base?.start
    if (!d) return undefined
    return addUnits(d, e.DateAdd.Amount, e.DateAdd.TimeUnit)
  }
  if (e.DateSpan) {
    const base = evalDateExpr(e.DateSpan.Expression, nowDate)
    const d = base instanceof Date ? base : base?.start
    if (!d) return undefined
    const start = truncate(d, e.DateSpan.TimeUnit)
    return { start, end: addUnits(start, 1, e.DateSpan.TimeUnit) }
  }
  return undefined
}

export function addUnits(d: Date, amount: number, unit: number): Date {
  const x = new Date(d.getTime())
  switch (unit) {
    case TimeUnit.Day:
      x.setUTCDate(x.getUTCDate() + amount)
      break
    case TimeUnit.Week:
      x.setUTCDate(x.getUTCDate() + amount * 7)
      break
    case TimeUnit.Month: {
      const day = x.getUTCDate()
      x.setUTCDate(1)
      x.setUTCMonth(x.getUTCMonth() + amount)
      const dim = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate()
      x.setUTCDate(Math.min(day, dim))
      break
    }
    case TimeUnit.Year:
      x.setUTCFullYear(x.getUTCFullYear() + amount)
      break
    case TimeUnit.Decade:
      x.setUTCFullYear(x.getUTCFullYear() + amount * 10)
      break
    case TimeUnit.Second:
      x.setUTCSeconds(x.getUTCSeconds() + amount)
      break
    case TimeUnit.Minute:
      x.setUTCMinutes(x.getUTCMinutes() + amount)
      break
    case TimeUnit.Hour:
      x.setUTCHours(x.getUTCHours() + amount)
      break
  }
  return x
}

export function truncate(d: Date, unit: number): Date {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  switch (unit) {
    case TimeUnit.Year:
      return new Date(Date.UTC(y, 0, 1))
    case TimeUnit.Decade:
      return new Date(Date.UTC(y - (y % 10), 0, 1))
    case TimeUnit.Month:
      return new Date(Date.UTC(y, m, 1))
    case TimeUnit.Week: {
      // PBI weeks start on Sunday (en-US)
      const s = new Date(Date.UTC(y, m, d.getUTCDate()))
      s.setUTCDate(s.getUTCDate() - s.getUTCDay())
      return s
    }
    case TimeUnit.Hour:
      return new Date(Date.UTC(y, m, d.getUTCDate(), d.getUTCHours()))
    case TimeUnit.Minute:
      return new Date(Date.UTC(y, m, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()))
    case TimeUnit.Second:
      return new Date(Date.UTC(y, m, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()))
    default:
      return new Date(Date.UTC(y, m, d.getUTCDate()))
  }
}

/** Concrete inclusive date range of a relative selection (for the caption under the controls). */
export function relativeRange(r: RelativeSelection, nowDate: Date): { start: Date; end: Date } | undefined {
  const { lower, upper } = relativeBounds(r)
  const lo = evalDateExpr(lower, nowDate)
  const hi = evalDateExpr(upper, nowDate)
  if (!lo || !hi || lo instanceof Date || hi instanceof Date) return undefined
  return { start: lo.start, end: new Date(hi.end.getTime() - (r.unit === 'minutes' || r.unit === 'hours' ? 60000 : DAY)) }
}

/** "Now" as a naive wall-clock Date (local time fields stored in UTC fields, per the value contract). */
export function wallClockNow(): Date {
  const d = new Date()
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()))
}

export { CODE_UNIT }

/**
 * Replace relative date expressions (Now / DateAdd / DateSpan) by literal bounds for `nowDate`, so the
 * pure evaluator (common/sqEval) can test membership. DateSpan semantics follow the engine: as a lower
 * bound / `>=` the span start, as an upper bound / `<=` "before the span end", `=` "inside the span".
 */
const resolvedCache = new WeakMap<SQFilter, { minute: number; out: SQFilter }>()

export function resolveRelativeFilter(filter: SQFilter | undefined, nowDate: Date): SQFilter | undefined {
  if (!filter) return filter
  const minute = Math.floor(nowDate.getTime() / 60000)
  const hit = resolvedCache.get(filter)
  if (hit && hit.minute === minute) return hit.out
  const out = resolveRelativeUncached(filter, nowDate)
  resolvedCache.set(filter, { minute, out })
  return out
}

function resolveRelativeUncached(filter: SQFilter, nowDate: Date): SQFilter {
  if (!JSON.stringify(filter.Where ?? []).match(/"(Now|DateSpan|DateAdd)"/)) return filter
  const lit = (d: Date) => literalExpr(d)
  const bound = (e: any, which: 'start' | 'end'): any => {
    const v = evalDateExpr(e, nowDate)
    if (!v) return e
    if (v instanceof Date) return lit(v)
    return lit(which === 'start' ? v.start : v.end)
  }
  const isRel = (e: any) => !!(e && (e.Now || e.DateSpan || e.DateAdd))
  const rw = (c: any): any => {
    if (!c || typeof c !== 'object') return c
    if (c.And) return { And: { Left: rw(c.And.Left), Right: rw(c.And.Right) } }
    if (c.Or) return { Or: { Left: rw(c.Or.Left), Right: rw(c.Or.Right) } }
    if (c.Not) return { Not: { Expression: rw(c.Not.Expression) } }
    if (c.Between && (isRel(c.Between.LowerBound) || isRel(c.Between.UpperBound))) {
      const x = c.Between.Expression
      return {
        And: {
          Left: { Comparison: { ComparisonKind: 2, Left: x, Right: bound(c.Between.LowerBound, 'start') } },
          Right: c.Between.UpperBound?.DateSpan
            ? { Comparison: { ComparisonKind: 3, Left: x, Right: bound(c.Between.UpperBound, 'end') } }
            : { Comparison: { ComparisonKind: 4, Left: x, Right: bound(c.Between.UpperBound, 'start') } }
        }
      }
    }
    if (c.Comparison && isRel(c.Comparison.Right)) {
      const { ComparisonKind: k, Left: x, Right: r } = c.Comparison
      if (r.DateSpan) {
        const v = evalDateExpr(r, nowDate)
        if (!v || v instanceof Date) return c
        const ge = { Comparison: { ComparisonKind: 2, Left: x, Right: lit(v.start) } }
        const lt = { Comparison: { ComparisonKind: 3, Left: x, Right: lit(v.end) } }
        switch (k) {
          case 0:
            return { And: { Left: ge, Right: lt } }
          case 1:
            return { Comparison: { ComparisonKind: 2, Left: x, Right: lit(v.end) } }
          case 2:
            return ge
          case 3:
            return { Comparison: { ComparisonKind: 3, Left: x, Right: lit(v.start) } }
          case 4:
            return lt
        }
      }
      return { Comparison: { ComparisonKind: k, Left: x, Right: bound(r, 'start') } }
    }
    return c
  }
  return { ...filter, Where: filter.Where.map((w) => ({ ...w, Condition: rw(w.Condition) })) }
}

// ---------------------------------------------------------------------------------------------
// Date presets (Lumen extension for list / dropdown / between slicers on date fields)
// ---------------------------------------------------------------------------------------------

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'thisMonth'
  | 'thisQuarter'
  | 'thisYear'
  | 'last7Days'
  | 'last30Days'
  | 'last90Days'
  | 'last12Months'
  | 'lastMonth'
  | 'lastQuarter'
  | 'lastYear'
  | 'mtd'
  | 'qtd'
  | 'ytd'

export const DATE_PRESETS: Array<{ id: DatePreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'thisWeek', label: 'This week' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'thisQuarter', label: 'This quarter' },
  { id: 'thisYear', label: 'This year' },
  { id: 'last7Days', label: 'Last 7 days' },
  { id: 'last30Days', label: 'Last 30 days' },
  { id: 'last90Days', label: 'Last 90 days' },
  { id: 'last12Months', label: 'Last 12 months' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'lastQuarter', label: 'Last quarter' },
  { id: 'lastYear', label: 'Last year' },
  { id: 'mtd', label: 'Month to date' },
  { id: 'qtd', label: 'Quarter to date' },
  { id: 'ytd', label: 'Year to date' }
]

function quarterStart(d: Date, offset = 0): Date {
  const q = Math.floor(d.getUTCMonth() / 3) + offset
  return new Date(Date.UTC(d.getUTCFullYear(), q * 3, 1))
}

/**
 * SQ filter of a date preset. Everything SQ can express relative to `Now` is written relative (so the
 * selection rolls forward like a PBI relative date slicer): day/week/month/year periods use PBI's own
 * relative-date shapes; MTD/YTD are Between(DateSpan(Now, Month|Year), DateSpan(Now, Day)).
 * SQ has no quarter TimeUnit, so quarter presets are written as fixed date ranges computed from `nowDate`
 * (they do not roll over to the next quarter by themselves — documented approximation).
 */
export function datePresetFilter(field: SQExpr, preset: DatePreset, nowDate: Date = wallClockNow()): SQFilter | undefined {
  const between = (lo: any, hi: any) => wrapFilter({ Between: { Expression: field, LowerBound: lo, UpperBound: hi } })
  switch (preset) {
    case 'today':
      return relativeFilter(field, { anchor: 'this', n: 1, unit: 'days', calendar: false })
    case 'yesterday':
      return relativeFilter(field, { anchor: 'last', n: 1, unit: 'days', calendar: false, includeToday: false })
    case 'thisWeek':
      return relativeFilter(field, { anchor: 'this', n: 1, unit: 'weeks', calendar: false })
    case 'thisMonth':
      return relativeFilter(field, { anchor: 'this', n: 1, unit: 'months', calendar: false })
    case 'thisYear':
      return relativeFilter(field, { anchor: 'this', n: 1, unit: 'years', calendar: false })
    case 'last7Days':
      return relativeFilter(field, { anchor: 'last', n: 7, unit: 'days', calendar: false })
    case 'last30Days':
      return relativeFilter(field, { anchor: 'last', n: 30, unit: 'days', calendar: false })
    case 'last90Days':
      return relativeFilter(field, { anchor: 'last', n: 90, unit: 'days', calendar: false })
    case 'last12Months':
      return relativeFilter(field, { anchor: 'last', n: 12, unit: 'months', calendar: false })
    case 'lastMonth':
      return relativeFilter(field, { anchor: 'last', n: 1, unit: 'months', calendar: true })
    case 'lastYear':
      return relativeFilter(field, { anchor: 'last', n: 1, unit: 'years', calendar: true })
    case 'mtd':
      return between(span(now(), TimeUnit.Month), span(now(), TimeUnit.Day))
    case 'ytd':
      return between(span(now(), TimeUnit.Year), span(now(), TimeUnit.Day))
    case 'thisQuarter': {
      const s = quarterStart(nowDate)
      return rangeFilter(field, { min: s, max: new Date(quarterStart(nowDate, 1).getTime() - DAY) })
    }
    case 'lastQuarter': {
      const s = quarterStart(nowDate, -1)
      return rangeFilter(field, { min: s, max: new Date(quarterStart(nowDate).getTime() - DAY) })
    }
    case 'qtd':
      return rangeFilter(field, { min: quarterStart(nowDate), max: startOfDay(nowDate) })
  }
}

/** Which preset (if any) produced this filter (for highlighting the active preset). */
export function detectDatePreset(filter: SQFilter | undefined, field: SQExpr, nowDate: Date = wallClockNow()): DatePreset | undefined {
  if (!filter) return undefined
  const sig = JSON.stringify(filterCondition(filter))
  for (const p of DATE_PRESETS) {
    const f = datePresetFilter(field, p.id, nowDate)
    if (f && JSON.stringify(filterCondition(f)) === sig) return p.id
  }
  return undefined
}

// ---------------------------------------------------------------------------------------------
// Text slicer (Contains) and search self-filter
// ---------------------------------------------------------------------------------------------

export function containsFilter(field: SQExpr, text: string): SQFilter | undefined {
  if (!text) return undefined
  return wrapFilter({ Contains: { Left: field, Right: literalExpr(text) } })
}

/** Text of a Contains filter (first Contains found, also inside Or for search self-filters). */
export function parseContainsFilter(filter: SQFilter | undefined): string | undefined {
  const cond = filterCondition(filter)
  const find = (c: any): string | undefined => {
    if (!c || typeof c !== 'object') return undefined
    if (c.Contains) {
      const v = literalValue(c.Contains.Right)
      return v === null ? undefined : String(v)
    }
    if (c.Or) return find(c.Or.Left) ?? find(c.Or.Right)
    if (c.And) return find(c.And.Left) ?? find(c.And.Right)
    return undefined
  }
  return find(cond)
}

/** Read the persisted filter of a slicer visual.json (objects.general[*].properties.filter.filter). */
export function persistedFilter(visualJson: any, prop: 'filter' | 'selfFilter' = 'filter'): SQFilter | undefined {
  for (const e of visualJson?.visual?.objects?.general ?? []) {
    const f = e?.properties?.[prop]?.filter
    if (f?.Where) return f
  }
  return undefined
}

/** Evaluate a condition against one field value (used for list rendering). */
export function valueSelected(filter: SQFilter | undefined, field: SQExpr, v: Scalar, nowDate?: Date): boolean {
  if (!filter) return false
  return evalFilter(resolveRelativeFilter(filter, nowDate ?? wallClockNow())!, tupleAccessor([field], [v]))
}

export { evalCondition }
