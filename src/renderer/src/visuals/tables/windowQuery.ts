/**
 * Data reduction for tables and matrices — Power BI's "data windowing" (Learn: "Apply data point
 * limits and strategies by visual type"):
 *   Table:  Values: virtualization (data windowing) by using a window of 500 rows at a time.
 *   Matrix: Rows: virtualization by using a window of 500 rows at a time;
 *           Columns: top 100 grouping columns; multiple values don't count against the reduction.
 *
 * The engine evaluates every group before applying `limit`, so a limit alone does not bound the
 * cost. Instead each windowed query runs in two phases:
 *   1. a probe: group-by only (plus the sort value when the visual is sorted by a value), sorted
 *      and limited to window + 1 rows — cheap (a scan), and tells us whether there is more;
 *   2. the real query, restricted to the window's groups with an `In` filter per group column,
 *      then post-filtered to the exact window tuples and put in probe order.
 * Totals / subtotals are separate coarse queries and are never restricted, so they stay exact.
 *
 * The `In` restriction becomes part of the filter context, which is invisible to ordinary measures
 * at group level (the group's own filter is narrower) but NOT to ALLSELECTED (shadow filter
 * context: e.g. "% of total" measures). When a value (transitively) uses ALLSELECTED — or any
 * calculation item does — the restriction is skipped: the full query runs and only the window is
 * kept (correct numbers, unbounded cost, like before).
 */
import type { Scalar } from '@core/model/data'
import type { GroupExpr, QueryEngine, SortSpec, SummarizeRequest, SummarizeResult, ValueExpr } from '@core/engine/api'
import type { SemanticModel } from '@core/model/types'
import { columnExpr, fieldInfo, literalExpr, type SQExpr, type SQFilter } from '@core/report/sq'
import { pathKey } from './matrixModel'

/** Table / matrix rows: window size (Learn: "Window of 500 rows at a time"). */
export const ROW_WINDOW = 500
/**
 * Matrix columns: "Top 100 grouping columns" — the column window. Like rows, the next 100 column
 * groups are fetched when the user scrolls near the right edge (see LOAD_MORE_COLUMNS_PX).
 */
export const COLUMN_GROUP_LIMIT = 100
/** How close (px) to the right end of the loaded columns horizontal scrolling must get to fetch the next column window. */
export const LOAD_MORE_COLUMNS_PX = 400
/** How close (in rows) to the end of the loaded window scrolling must get to fetch the next window. */
export const LOAD_MORE_THRESHOLD = 60

export interface WindowedResult extends SummarizeResult {
  /** more groups exist beyond the window */
  hasMore: boolean
}

export function groupSq(g: GroupExpr): SQExpr {
  return 'kind' in g ? g.expr : columnExpr(g.table, g.column)
}

/** One `In` filter per column with the distinct values of that column among `tuples` (a superset of the tuples). */
export function restrictFilters(exprs: SQExpr[], tuples: Scalar[][]): SQFilter[] {
  return exprs.map((expr, i) => {
    const seen = new Set<string>()
    const vals: Scalar[] = []
    for (const t of tuples) {
      const k = pathKey([t[i]])
      if (seen.has(k)) continue
      seen.add(k)
      vals.push(t[i])
    }
    return { Version: 2, From: [], Where: [{ Condition: { In: { Expressions: [expr], Values: vals.map((v) => [literalExpr(v)]) } } }] } as unknown as SQFilter
  })
}

/**
 * Restriction batches: per-column `In` filters select the *rectangle* (cross product) of the
 * tuples' column values, which is a large superset when the window isn't rectangular (e.g. the top
 * 500 (A, B) pairs by a measure). Split the tuples on the column with the fewest distinct values
 * until each batch's rectangle is at most ~2× its tuple count; each batch is one query.
 */
export function restrictionBatches(exprs: SQExpr[], tuples: Scalar[][]): SQFilter[][] {
  const out: SQFilter[][] = []
  const distinct = (ts: Scalar[][], i: number) => new Set(ts.map((t) => pathKey([t[i]]))).size
  const split = (ts: Scalar[][]) => {
    if (!ts.length) return
    const counts = exprs.map((_, i) => distinct(ts, i))
    const rect = counts.reduce((a, b) => a * b, 1)
    if (exprs.length <= 1 || rect <= 2 * ts.length + 32) {
      out.push(restrictFilters(exprs, ts))
      return
    }
    // split on the column with the fewest (≥ 2) distinct values; fixing it shrinks the rectangle the most per query
    let col = -1
    for (let i = 0; i < counts.length; i++) if (counts[i] > 1 && (col < 0 || counts[i] < counts[col])) col = i
    if (col < 0) {
      out.push(restrictFilters(exprs, ts))
      return
    }
    const parts = new Map<string, Scalar[][]>()
    for (const t of ts) {
      const k = pathKey([t[col]])
      const arr = parts.get(k)
      if (arr) arr.push(t)
      else parts.set(k, [t])
    }
    // pack consecutive parts while their joint rectangle stays small
    let batch: Scalar[][] = []
    for (const part of parts.values()) {
      const cand = [...batch, ...part]
      const r = exprs.map((_, i) => distinct(cand, i)).reduce((a, b) => a * b, 1)
      if (batch.length && r > 2 * cand.length + 32) {
        split(batch)
        batch = part
      } else batch = cand
    }
    split(batch)
  }
  split(tuples)
  return out
}

// ------------------------------------------------------------------------------------------------
// shadow-filter (ALLSELECTED) sensitivity
// ------------------------------------------------------------------------------------------------

const SHADOW = /\bALLSELECTED\s*\(/i
const sensitiveCache = new WeakMap<SemanticModel, { calcItems: boolean; measures: Set<string> }>()

function modelSensitivity(model: SemanticModel): { calcItems: boolean; measures: Set<string> } {
  const hit = sensitiveCache.get(model)
  if (hit) return hit
  const exprs = new Map<string, string>()
  let calcItems = false
  for (const t of model.tables ?? []) {
    for (const m of t.measures ?? []) exprs.set(m.name.toLowerCase(), m.expression ?? '')
    for (const it of t.calculationGroup?.items ?? []) if (SHADOW.test(it.expression ?? '')) calcItems = true
  }
  const memo = new Map<string, boolean>()
  const visit = (name: string, stack: Set<string>): boolean => {
    const k = name.toLowerCase()
    if (memo.has(k)) return memo.get(k)!
    const e = exprs.get(k)
    if (e === undefined || stack.has(k)) return false
    stack.add(k)
    let r = SHADOW.test(e)
    if (!r) {
      for (const m of e.matchAll(/\[([^\]]+)\]/g)) {
        if (exprs.has(m[1].toLowerCase()) && visit(m[1], stack)) {
          r = true
          break
        }
      }
    }
    stack.delete(k)
    memo.set(k, r)
    return r
  }
  const measures = new Set<string>()
  for (const k of exprs.keys()) if (visit(k, new Set())) measures.add(k)
  const out = { calcItems, measures }
  sensitiveCache.set(model, out)
  return out
}

/** Would restricting the filter context to the window's groups change any of these values? */
export function shadowSensitive(engine: QueryEngine, values: ValueExpr[]): boolean {
  const model = engine.model
  if (!model) return false
  const s = modelSensitivity(model)
  if (s.calcItems) return true
  return values.some((v) => {
    if (v.kind === 'measure') return s.measures.has(v.measure.toLowerCase())
    if (v.kind === 'dax') return SHADOW.test(v.expression) || [...v.expression.matchAll(/\[([^\]]+)\]/g)].some((m) => s.measures.has(m[1].toLowerCase()))
    if (v.kind === 'sq') {
      const f = fieldInfo(v.expr)
      if (f.kind === 'measure') return !!f.property && s.measures.has(f.property.toLowerCase())
      if (f.kind === 'visualCalc') return true
      return false
    }
    return false
  })
}

// ------------------------------------------------------------------------------------------------
// windowed summarize
// ------------------------------------------------------------------------------------------------

export function defaultOrder(req: SummarizeRequest): SortSpec[] {
  return req.orderBy?.length ? req.orderBy : req.groupBy.map((_, i) => ({ target: { group: i }, direction: 'asc' as const }))
}

/**
 * Probe: the first `limit` group tuples in sort order (group-by only, plus the sort values).
 * Blank sort values are kept (the real query drops all-blank rows itself).
 */
export function probeGroups(engine: QueryEngine, req: SummarizeRequest, limit: number | undefined): Scalar[][] {
  const orderBy = defaultOrder(req)
  const sortIds = new Set(orderBy.flatMap((s) => ('value' in s.target ? [s.target.value] : [])))
  const values = req.values.filter((v) => sortIds.has(v.id))
  const r = engine.summarize({
    groupBy: req.groupBy,
    values,
    filters: req.filters,
    orderBy,
    limit,
    showItemsWithNoData: req.showItemsWithNoData,
    keepBlankRows: values.length > 0 ? true : req.keepBlankRows
  })
  const n = req.groupBy.length
  return r.rows.map((row) => row.slice(0, n))
}

/**
 * Evaluate `req` for exactly these group tuples (in this order). Restricts the filter context with
 * `In` filters unless the values are shadow-filter sensitive, then post-filters to the tuples.
 */
export function summarizeFor(engine: QueryEngine, req: SummarizeRequest, tuples: Scalar[][], sensitive?: boolean): SummarizeResult {
  const n = req.groupBy.length
  const restrict = !(sensitive ?? shadowSensitive(engine, req.values.map((v) => v.expr)))
  const batches = restrict ? restrictionBatches(req.groupBy.map(groupSq), tuples) : [[]]
  const parts = batches.map((f) => engine.summarize({ ...req, filters: [...(req.filters ?? []), ...f], limit: undefined }))
  const r: SummarizeResult = parts.length === 1 ? parts[0] : mergeResults(parts)
  const at = new Map<string, number>()
  r.rows.forEach((row, i) => at.set(pathKey(row.slice(0, n)), i))
  const rows: Scalar[][] = []
  const formats: Array<Array<string | undefined>> = []
  const highlights: Scalar[][] = []
  for (const t of tuples) {
    const i = at.get(pathKey(t))
    if (i === undefined) continue
    rows.push(r.rows[i])
    if (r.formats) formats.push(r.formats[i])
    if (r.highlights) highlights.push(r.highlights[i])
  }
  return { ...r, rows, formats: r.formats ? formats : undefined, highlights: r.highlights ? highlights : undefined, truncated: false }
}

/** Concatenate the results of disjoint batches. */
export function mergeResults(parts: SummarizeResult[]): SummarizeResult {
  const first = parts[0]
  const anyFormats = parts.some((p) => p.formats)
  const anyHi = parts.some((p) => p.highlights)
  const warnings = [...new Set(parts.flatMap((p) => p.warnings ?? []))]
  return {
    columns: first.columns,
    rows: parts.flatMap((p) => p.rows),
    formats: anyFormats ? parts.flatMap((p) => p.formats ?? p.rows.map(() => [])) : undefined,
    highlights: anyHi ? parts.flatMap((p) => p.highlights ?? p.rows.map(() => [])) : undefined,
    truncated: parts.some((p) => p.truncated),
    warnings: warnings.length ? warnings : undefined
  }
}

/**
 * Windowed summarize: the first `window` rows of `req` (in its sort order) with bounded cost.
 * Small results (≤ window groups) run the plain query.
 */
export function windowedSummarize(engine: QueryEngine, req: SummarizeRequest, window: number): WindowedResult {
  if (!req.groupBy.length) return { ...engine.summarize(req), hasMore: false }
  const tuples = probeGroups(engine, req, window + 1)
  if (tuples.length <= window) return { ...engine.summarize({ ...req, limit: undefined }), hasMore: false }
  const r = summarizeFor(engine, { ...req, orderBy: defaultOrder(req) }, tuples.slice(0, window))
  return { ...r, hasMore: true }
}
