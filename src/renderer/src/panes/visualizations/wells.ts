/**
 * Pure mutations of a visual's field wells (PBIR `visual.query.queryState`). Each role bucket is
 * `{ projections: [{ field, queryRef, nativeQueryRef, displayName?, active? }], showAll? }`.
 * "Show items with no data" is the bucket-level `showAll: true` (as PBI Desktop writes it).
 * Unit-tested in wells.test.ts.
 */
import { columnExpr, defaultQueryRef, fieldInfo, fieldKey, SQ_AGG, type SQExpr } from '@core/report/sq'
import type { SemanticModel } from '@core/model/types'

export interface ProjectionJson {
  field: SQExpr
  queryRef: string
  nativeQueryRef?: string
  displayName?: string
  active?: boolean
  [k: string]: any
}

/** UI labels for SQ aggregation functions (PBI field-well menu order). */
export const AGG_MENU: Array<{ fn: number; label: string }> = [
  { fn: SQ_AGG.Sum, label: 'Sum' },
  { fn: SQ_AGG.Avg, label: 'Average' },
  { fn: SQ_AGG.Min, label: 'Minimum' },
  { fn: SQ_AGG.Max, label: 'Maximum' },
  { fn: SQ_AGG.Count, label: 'Count (Distinct)' },
  { fn: SQ_AGG.CountNonNull, label: 'Count' },
  { fn: SQ_AGG.StandardDeviation, label: 'Standard deviation' },
  { fn: SQ_AGG.Variance, label: 'Variance' },
  { fn: SQ_AGG.Median, label: 'Median' }
]

const AGG_PREFIX: Record<number, string> = {
  [SQ_AGG.Sum]: 'Sum of',
  [SQ_AGG.Avg]: 'Average of',
  [SQ_AGG.Min]: 'Min of',
  [SQ_AGG.Max]: 'Max of',
  [SQ_AGG.Count]: 'Count of',
  [SQ_AGG.CountNonNull]: 'Count of',
  [SQ_AGG.StandardDeviation]: 'Standard deviation of',
  [SQ_AGG.Variance]: 'Variance of',
  [SQ_AGG.Median]: 'Median of'
}

/** PBI default display name of a field (`nativeQueryRef`): "Sum of Amount", "Count of Id (Distinct)", "Amount". */
export function nativeName(expr: SQExpr): string {
  const pct = percentOfGrandTotalInner(expr)
  if (pct) return `%GT ${nativeName(pct)}`
  const f = fieldInfo(expr)
  if (f.kind === 'aggregation') {
    const base = `${AGG_PREFIX[f.aggregation ?? 0] ?? 'Sum of'} ${f.property ?? ''}`
    return f.aggregation === SQ_AGG.Count ? `${base} (Distinct)` : base
  }
  return f.property ?? f.level ?? ''
}

function queryRefOf(expr: SQExpr): string {
  const pct = percentOfGrandTotalInner(expr)
  if (pct) {
    const inner = queryRefOf(pct)
    return `Divide(${inner}, ScopedEval(${inner}, []))`
  }
  return defaultQueryRef(expr)
}

export function makeProjection(expr: SQExpr, extra: Partial<ProjectionJson> = {}): ProjectionJson {
  return { field: expr, queryRef: queryRefOf(expr), nativeQueryRef: nativeName(expr), ...extra }
}

function queryState(visualJson: any, create: boolean): Record<string, any> | undefined {
  const v = visualJson?.visual
  if (!v) return undefined
  if (!create) return v.query?.queryState
  v.query ??= {}
  v.query.queryState ??= {}
  return v.query.queryState
}

export function roleProjections(visualJson: any, role: string): ProjectionJson[] {
  return queryState(visualJson, false)?.[role]?.projections ?? []
}

function bucket(visualJson: any, role: string): { projections: ProjectionJson[]; [k: string]: any } {
  const qs = queryState(visualJson, true)!
  qs[role] ??= { projections: [] }
  qs[role].projections ??= []
  return qs[role]
}

function cleanupRole(visualJson: any, role: string): void {
  const qs = queryState(visualJson, false)
  if (qs?.[role] && !(qs[role].projections ?? []).length) delete qs[role]
}

function fieldUsedAnywhere(visualJson: any, key: string): boolean {
  const qs = queryState(visualJson, false) ?? {}
  return Object.values<any>(qs).some((b) => (b?.projections ?? []).some((p: ProjectionJson) => fieldKey(p.field) === key))
}

function dropSortsOn(visualJson: any, key: string): void {
  const sd = visualJson?.visual?.query?.sortDefinition
  if (!sd?.sort) return
  sd.sort = sd.sort.filter((s: any) => fieldKey(s.field) !== key)
  if (!sd.sort.length) delete visualJson.visual.query.sortDefinition
}

function replaceSortField(visualJson: any, oldKey: string, expr: SQExpr): void {
  for (const s of visualJson?.visual?.query?.sortDefinition?.sort ?? []) if (fieldKey(s.field) === oldKey) s.field = structuredClone(expr)
}

// ---------------------------------------------------------------------------------------------
// Default sort (what PBI writes while fields are added to a chart and the user hasn't sorted it)
// ---------------------------------------------------------------------------------------------

/** Charts PBI sorts by their first value, descending. */
const SORT_BY_VALUE = new Set([
  'barChart', 'clusteredBarChart', 'hundredPercentStackedBarChart',
  'columnChart', 'clusteredColumnChart', 'hundredPercentStackedColumnChart',
  'pieChart', 'donutChart', 'funnel', 'treemap'
])
/** Charts PBI sorts by their category axis, ascending (time / ordered axes). */
const SORT_BY_CATEGORY = new Set([
  'lineChart', 'areaChart', 'stackedAreaChart', 'hundredPercentStackedAreaChart',
  'lineClusteredColumnComboChart', 'lineStackedColumnComboChart'
])
const VALUE_ROLES = ['Y', 'Values', 'Size', 'Y2', 'ColumnY', 'LineY']
const CATEGORY_ROLES = ['Category', 'Group', 'Axis']

/**
 * (Re)write the default sort of a chart: bar / column / pie / donut / funnel / treemap → first value descending;
 * line / area / combo → first category ascending. Only while there is no user sort (no sortDefinition, or one marked
 * `isDefaultSort: true`); removed when the chart no longer has both a category and a value. Mutates `visualJson`.
 */
export function applyDefaultSort(visualJson: any): void {
  const v = visualJson?.visual
  if (!v) return
  const type = String(v.visualType ?? '')
  const byValue = SORT_BY_VALUE.has(type)
  const byCategory = SORT_BY_CATEGORY.has(type)
  if (!byValue && !byCategory) return
  const sd = v.query?.sortDefinition
  if (sd && sd.isDefaultSort !== true && (sd.sort?.length ?? 0) > 0) return // the user sorted: keep it
  const first = (roles: string[]) => {
    for (const r of roles) {
      const p = roleProjections(visualJson, r)[0]
      if (p) return p
    }
    return undefined
  }
  const category = first(CATEGORY_ROLES)
  const value = VALUE_ROLES.map((r) => roleProjections(visualJson, r).find((p) => isValueProjection(p.field))).find(Boolean)
  const target = byValue ? (category && value ? { field: value.field, direction: 'Descending' } : undefined) : category && value ? { field: category.field, direction: 'Ascending' } : undefined
  if (!target) {
    if (sd?.isDefaultSort) delete v.query.sortDefinition
    return
  }
  v.query ??= {}
  v.query.sortDefinition = { sort: [{ field: structuredClone(target.field), direction: target.direction }], isDefaultSort: true }
}

/**
 * Add a field to a role. Returns false when rejected (duplicate in the role, or role full).
 * `max` = role capacity (VisualDefinition role `max`); `index` = insertion position.
 */
export function addProjection(visualJson: any, role: string, expr: SQExpr, opts: { index?: number; max?: number; active?: boolean } = {}): boolean {
  if (!visualJson?.visual) return false
  const b = bucket(visualJson, role)
  const key = fieldKey(expr)
  if (b.projections.some((p) => fieldKey(p.field) === key)) {
    if (!b.projections.length) cleanupRole(visualJson, role)
    return false
  }
  if (opts.max !== undefined && b.projections.length >= opts.max) {
    if (opts.max === 1) b.projections.splice(0, 1) // single-field wells replace (PBI behavior)
    else return false
  }
  const p = makeProjection(structuredClone(expr), opts.active ? { active: true } : {})
  const at = opts.index === undefined ? b.projections.length : Math.max(0, Math.min(b.projections.length, opts.index))
  b.projections.splice(at, 0, p)
  applyDefaultSort(visualJson)
  return true
}

export function removeProjection(visualJson: any, role: string, index: number): void {
  const list = roleProjections(visualJson, role)
  const p = list[index]
  if (!p) return
  list.splice(index, 1)
  cleanupRole(visualJson, role)
  const key = fieldKey(p.field)
  if (!fieldUsedAnywhere(visualJson, key)) dropSortsOn(visualJson, key)
  applyDefaultSort(visualJson)
}

/** Move a projection within / between roles. Returns false when the target rejects it. */
export function moveProjection(visualJson: any, fromRole: string, fromIndex: number, toRole: string, toIndex: number, opts: { max?: number } = {}): boolean {
  const src = roleProjections(visualJson, fromRole)
  const p = src[fromIndex]
  if (!p) return false
  if (fromRole === toRole) {
    src.splice(fromIndex, 1)
    const at = Math.max(0, Math.min(src.length, toIndex > fromIndex ? toIndex - 1 : toIndex))
    src.splice(at, 0, p)
    applyDefaultSort(visualJson)
    return true
  }
  const dst = bucket(visualJson, toRole)
  const key = fieldKey(p.field)
  if (dst.projections.some((q) => fieldKey(q.field) === key)) {
    cleanupRole(visualJson, toRole)
    return false
  }
  if (opts.max !== undefined && dst.projections.length >= opts.max) {
    if (opts.max === 1) dst.projections.splice(0, 1)
    else {
      cleanupRole(visualJson, toRole)
      return false
    }
  }
  src.splice(fromIndex, 1)
  dst.projections.splice(Math.max(0, Math.min(dst.projections.length, toIndex)), 0, p)
  cleanupRole(visualJson, fromRole)
  applyDefaultSort(visualJson)
  return true
}

/**
 * Change the aggregation of a column projection (`fn` = SQ_AGG code) or remove it (`null` →
 * "Don't summarize": plain Column). Measures are left unchanged. Sorts on the field follow it.
 */
export function setAggregation(visualJson: any, role: string, index: number, fn: number | null): void {
  const p = roleProjections(visualJson, role)[index]
  if (!p) return
  const pctInner = percentOfGrandTotalInner(p.field)
  const base = pctInner ?? p.field
  const f = fieldInfo(base)
  if (f.kind !== 'column' && f.kind !== 'aggregation') return
  if (!f.table || !f.property) return
  const col = f.kind === 'aggregation' ? base.Aggregation.Expression : base
  const next = fn === null ? structuredClone(col) : { Aggregation: { Expression: structuredClone(col ?? columnExpr(f.table, f.property)), Function: fn } }
  const oldKey = fieldKey(p.field)
  const field = pctInner && fn !== null ? percentOfGrandTotal(next) : next
  const renamed = p.displayName
  Object.assign(p, makeProjection(field), renamed ? { displayName: renamed } : {})
  if (!renamed) delete p.displayName
  replaceSortField(visualJson, oldKey, field)
  applyDefaultSort(visualJson)
}

/** Rename for this visual (`displayName`); undefined/empty restores the default name. */
export function renameProjection(visualJson: any, role: string, index: number, name: string | undefined): void {
  const p = roleProjections(visualJson, role)[index]
  if (!p) return
  if (name && name.trim() && name.trim() !== nativeName(p.field)) p.displayName = name.trim()
  else delete p.displayName
}

export function getShowAll(visualJson: any, role: string): boolean {
  return queryState(visualJson, false)?.[role]?.showAll === true
}

/** "Show items with no data" (bucket-level `showAll`). */
export function setShowAll(visualJson: any, role: string, on: boolean): void {
  const qs = queryState(visualJson, false)
  if (!qs?.[role]) return
  if (on) qs[role].showAll = true
  else delete qs[role].showAll
}

// ---------------------------------------------------------------------------------------------
// Show value as: Percent of grand total
// PBI encodes it as Arithmetic(Divide) of the value by itself evaluated with an empty scope:
//   { Arithmetic: { Left: X, Right: { ScopedEval: { Expression: X, Scope: [] } }, Operator: 3 } }
// ---------------------------------------------------------------------------------------------

export function percentOfGrandTotal(expr: SQExpr): SQExpr {
  return { Arithmetic: { Left: structuredClone(expr), Right: { ScopedEval: { Expression: structuredClone(expr), Scope: [] } }, Operator: 3 } }
}

/** The inner value when `expr` is a "% of grand total" wrapper, else undefined. */
export function percentOfGrandTotalInner(expr: SQExpr): SQExpr | undefined {
  const a = expr?.Arithmetic
  if (!a || a.Operator !== 3 || !a.Right?.ScopedEval) return undefined
  const scope = a.Right.ScopedEval.Scope
  if (Array.isArray(scope) && scope.length) return undefined
  return fieldKey(a.Left) === fieldKey(a.Right.ScopedEval.Expression) ? a.Left : undefined
}

export type ShowValueAs = 'none' | 'percentOfGrandTotal'

export function getShowValueAs(p: ProjectionJson): ShowValueAs {
  return percentOfGrandTotalInner(p.field) ? 'percentOfGrandTotal' : 'none'
}

export function setShowValueAs(visualJson: any, role: string, index: number, mode: ShowValueAs): void {
  const p = roleProjections(visualJson, role)[index]
  if (!p) return
  const inner = percentOfGrandTotalInner(p.field)
  if ((mode === 'percentOfGrandTotal') === !!inner) return
  const oldKey = fieldKey(p.field)
  const field = mode === 'percentOfGrandTotal' ? percentOfGrandTotal(p.field) : inner!
  const renamed = p.displayName
  Object.assign(p, makeProjection(field))
  if (renamed) p.displayName = renamed
  else delete p.displayName
  replaceSortField(visualJson, oldKey, field)
}

/** Is the projection a measure-like value (measure / aggregation / % wrapper)? */
export function isValueProjection(expr: SQExpr): boolean {
  if (percentOfGrandTotalInner(expr)) return true
  const k = fieldInfo(expr).kind
  return k === 'measure' || k === 'aggregation' || k === 'visualCalc'
}

/**
 * New slicer on a date column: like Power BI Desktop ("Power BI automatically creates a date range slicer set to
 * Between by default", Microsoft Learn: Create a numeric or date range slicer, 2026), the first date / date-time column
 * added to a slicer without a style switches it to the Between range style (`objects.data.mode = 'Between'`).
 * Returns true when the mode was written. Date hierarchy levels and existing styles are left alone.
 */
export function applyDateSlicerDefault(visualJson: any, model: SemanticModel | undefined): boolean {
  const v = visualJson?.visual
  if (!v || v.visualType !== 'slicer') return false
  const ps: any[] = v.query?.queryState?.Values?.projections ?? []
  if (ps.length !== 1) return false
  if (v.objects?.data?.some((e: any) => e?.properties?.mode !== undefined)) return false
  const info = fieldInfo(ps[0].field)
  if (info.kind !== 'column' || !info.table || !info.property) return false
  const col = model?.tables.find((t) => t.name === info.table)?.columns.find((c) => c.name === info.property)
  if (col?.dataType !== 'dateTime') return false
  v.objects ??= {}
  const entries: any[] = (v.objects.data ??= [])
  const target = entries.find((e) => !e.selector) ?? (entries.push({ properties: {} }), entries[entries.length - 1])
  target.properties ??= {}
  target.properties.mode = { expr: { Literal: { Value: "'Between'" } } }
  return true
}
