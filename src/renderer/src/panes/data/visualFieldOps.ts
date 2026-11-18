/**
 * Data pane checkbox → visual field wells (pure, tested in visualFieldOps.test.ts).
 * Adds a field to the first compatible role of a visual's `query.queryState`, removes it, or tells
 * whether the visual already uses it. Roles come from the visual registry with a fallback table for
 * common PBIR visual types (so it works before every visual module is registered).
 */
import { applyDateSlicerDefault, applyDefaultSort } from '../visualizations/wells'
import type { SemanticModel } from '@core/model/types'
import { defaultQueryRef, fieldInfo, SQ_AGG_NAMES, type SQExpr } from '@core/report/sq'
import type { DataRoleDef } from '../../visuals/contract'
import { getVisual } from '../../visuals/registry'
import { fieldToSQ, type DraggedField } from '../fieldDrag'

const g = (name: string, displayName = name, max?: number): DataRoleDef => ({ name, displayName, kind: 'grouping', max })
const m = (name: string, displayName = name, max?: number): DataRoleDef => ({ name, displayName, kind: 'measure', max })
const b = (name: string, displayName = name, max?: number): DataRoleDef => ({ name, displayName, kind: 'both', max })

const CHART = [g('Category', 'X-axis'), m('Y', 'Y-axis'), g('Series', 'Legend', 1), m('Tooltips')]
const BAR = [g('Category', 'Y-axis'), m('Y', 'X-axis'), g('Series', 'Legend', 1), m('Tooltips')]

/** Fallback roles for core PBIR visual types. */
export const FALLBACK_ROLES: Record<string, DataRoleDef[]> = {
  clusteredColumnChart: CHART,
  columnChart: CHART,
  hundredPercentStackedColumnChart: CHART,
  clusteredBarChart: BAR,
  barChart: BAR,
  hundredPercentStackedBarChart: BAR,
  lineChart: [g('Category', 'X-axis'), m('Y', 'Y-axis'), m('Y2', 'Secondary y-axis'), g('Series', 'Legend', 1), m('Tooltips')],
  areaChart: CHART,
  stackedAreaChart: CHART,
  lineClusteredColumnComboChart: [g('Category', 'X-axis'), m('Y', 'Column y-axis'), m('Y2', 'Line y-axis'), g('Series', 'Column legend', 1), m('Tooltips')],
  lineStackedColumnComboChart: [g('Category', 'X-axis'), m('Y', 'Column y-axis'), m('Y2', 'Line y-axis'), g('Series', 'Column legend', 1), m('Tooltips')],
  pieChart: [g('Category', 'Legend'), m('Y', 'Values'), g('Series', 'Details'), m('Tooltips')],
  donutChart: [g('Category', 'Legend'), m('Y', 'Values'), g('Series', 'Details'), m('Tooltips')],
  funnel: [g('Category'), m('Y', 'Values'), m('Tooltips')],
  treemap: [g('Group', 'Category'), g('Details'), m('Values'), m('Tooltips')],
  scatterChart: [g('Category', 'Values'), m('X', 'X-axis', 1), m('Y', 'Y-axis', 1), g('Series', 'Legend', 1), m('Size', 'Size', 1), m('Tooltips')],
  waterfallChart: [g('Category'), g('Breakdown', 'Breakdown', 1), m('Y', 'Y-axis', 1), m('Tooltips')],
  tableEx: [b('Values', 'Columns')],
  pivotTable: [g('Rows'), g('Columns'), m('Values')],
  card: [m('Values', 'Fields', 1)],
  cardVisual: [b('Data', 'Data')],
  multiRowCard: [b('Values', 'Fields')],
  kpi: [m('Indicator', 'Value', 1), g('TrendLine', 'Trend axis', 1), m('Goal', 'Target', 1)],
  gauge: [m('Y', 'Value', 1), m('MinValue', 'Minimum value', 1), m('MaxValue', 'Maximum value', 1), m('TargetValue', 'Target value', 1), m('Tooltips')],
  slicer: [g('Values', 'Field')],
  advancedSlicerVisual: [g('Values', 'Field')],
  map: [g('Category', 'Location'), g('Series', 'Legend', 1), m('Size', 'Bubble size', 1), m('Tooltips')],
  filledMap: [g('Category', 'Location'), g('Series', 'Legend', 1), m('Tooltips')]
}

export function rolesOf(visualType: string): DataRoleDef[] {
  return getVisual(visualType)?.roles ?? FALLBACK_ROLES[visualType] ?? [b('Values')]
}

function countIn(json: any, role: string): number {
  return json?.visual?.query?.queryState?.[role]?.projections?.length ?? 0
}

/** Does a dragged field go in as a value (measure / aggregated numeric column)? */
export function isValueField(field: DraggedField, model: SemanticModel | undefined): boolean {
  if (field.kind === 'measure') return true
  if (field.kind !== 'column') return false
  const col = model?.tables.find((t) => t.name === field.table)?.columns.find((c) => c.name === field.name)
  if (!col) return false
  const numeric = col.dataType === 'int64' || col.dataType === 'double' || col.dataType === 'decimal'
  return numeric && (col.summarizeBy ?? 'default') !== 'none'
}

/** Pick the role a checked field lands in (PBI: first compatible well that still has room). */
export function pickRole(visualJson: any, field: DraggedField, model: SemanticModel | undefined): { role: DataRoleDef; asValue: boolean } | undefined {
  const roles = rolesOf(visualJson?.visual?.visualType ?? '')
  const value = isValueField(field, model)
  const room = (r: DataRoleDef) => r.max === undefined || countIn(visualJson, r.name) < r.max
  if (value) {
    const r = roles.find((x) => (x.kind === 'measure' || x.kind === 'both') && room(x))
    if (r) return { role: r, asValue: r.kind === 'measure' || field.kind === 'column' }
    // measures can't go to grouping wells; numeric columns fall back to a grouping well unaggregated
    if (field.kind === 'measure') return undefined
  }
  const r = roles.find((x) => (x.kind === 'grouping' || x.kind === 'both') && room(x))
  return r ? { role: r, asValue: false } : undefined
}

function nativeName(expr: SQExpr): string {
  const info = fieldInfo(expr)
  if (info.kind === 'aggregation') return `${SQ_AGG_NAMES[info.aggregation ?? 0]} of ${info.property}`
  return info.property ?? ''
}

export function projectionFor(expr: SQExpr): any {
  const p: any = { field: expr, queryRef: defaultQueryRef(expr), nativeQueryRef: nativeName(expr) }
  if (expr.HierarchyLevel) p.active = true
  return p
}

/** Add a field to a visual JSON (mutates). Returns the role name used, or undefined if no well fits. */
export function addFieldToVisual(visualJson: any, field: DraggedField, model: SemanticModel | undefined): string | undefined {
  const pick = pickRole(visualJson, field, model)
  if (!pick) return undefined
  const exprs = fieldToSQ(field, { asValue: pick.asValue, model })
  if (!exprs.length) return undefined
  const v = visualJson.visual
  v.query ??= {}
  v.query.queryState ??= {}
  const bucket = (v.query.queryState[pick.role.name] ??= { projections: [] })
  bucket.projections ??= []
  for (const e of exprs) bucket.projections.push(projectionFor(e))
  applyDefaultSort(visualJson)
  applyDateSlicerDefault(visualJson, model)
  return pick.role.name
}

/** Table + property a well expression refers to (columns, aggregations of a column, measures, hierarchy levels). */
function exprTarget(expr: SQExpr): { table?: string; name?: string; hierarchy?: string } {
  const info = fieldInfo(expr)
  if (info.kind === 'aggregation') return { table: info.table, name: info.inner?.property }
  if (info.kind === 'hierarchyLevel') return { table: info.table, name: info.level, hierarchy: info.hierarchy }
  return { table: info.table, name: info.property }
}

function matches(expr: SQExpr, field: DraggedField): boolean {
  const t = exprTarget(expr)
  if (field.kind === 'table') return false
  if (t.table !== field.table) return false
  if (field.kind === 'hierarchy') return t.hierarchy === field.name
  if (field.kind === 'hierarchyLevel') return t.hierarchy === field.hierarchy && t.name === field.name
  const info = fieldInfo(expr)
  if (field.kind === 'measure') return info.kind === 'measure' && t.name === field.name
  return (info.kind === 'column' || info.kind === 'aggregation') && t.name === field.name
}

export function visualUsesField(visualJson: any, field: DraggedField): boolean {
  const qs = visualJson?.visual?.query?.queryState ?? {}
  return Object.values<any>(qs).some((bucket) => (bucket?.projections ?? []).some((p: any) => matches(p.field, field)))
}

/** Remove every projection of the field from the visual (mutates). Also drops its sort entries. */
export function removeFieldFromVisual(visualJson: any, field: DraggedField): void {
  const qs = visualJson?.visual?.query?.queryState
  if (!qs) return
  for (const [role, bucket] of Object.entries<any>(qs)) {
    if (!bucket?.projections) continue
    bucket.projections = bucket.projections.filter((p: any) => !matches(p.field, field))
    if (!bucket.projections.length) delete qs[role]
  }
  const sd = visualJson.visual.query?.sortDefinition
  if (Array.isArray(sd?.sort)) {
    sd.sort = sd.sort.filter((s: any) => !matches(s.field, field))
    if (!sd.sort.length) delete visualJson.visual.query.sortDefinition
  }
  applyDefaultSort(visualJson)
}

/** Visual for a field checked with nothing selected (PBI: numbers → column chart, else table). */
export function newVisualForField(field: DraggedField, model: SemanticModel | undefined): { visualType: string; visual: any } {
  const value = isValueField(field, model)
  const visualType = value ? 'clusteredColumnChart' : 'tableEx'
  const json = { visual: { visualType } }
  addFieldToVisual(json, field, model)
  return { visualType, visual: { query: (json.visual as any).query } }
}
