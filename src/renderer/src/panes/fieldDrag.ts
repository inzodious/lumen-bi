/**
 * Drag & drop payload for model fields (Data pane → field wells / filter pane / canvas).
 * Any drop target can read it with `readFieldDrag(e.dataTransfer)`.
 */
import type { SemanticModel } from '@core/model/types'
import { aggregationExpr, columnExpr, measureExpr, SQ_AGG, type SQExpr } from '@core/report/sq'

export const FIELD_MIME = 'application/x-lumen-field'

export type DraggedField =
  | { kind: 'column'; table: string; name: string }
  | { kind: 'measure'; table: string; name: string }
  | { kind: 'hierarchy'; table: string; name: string; levels: string[] }
  | { kind: 'hierarchyLevel'; table: string; hierarchy: string; name: string }
  | { kind: 'table'; table: string }

/** Module-level copy: dataTransfer.getData() is not readable during dragover, so targets peek here. */
let current: DraggedField | null = null

export function startFieldDrag(e: React.DragEvent | DragEvent, field: DraggedField): void {
  current = field
  const dt = e.dataTransfer
  if (!dt) return
  dt.setData(FIELD_MIME, JSON.stringify(field))
  dt.setData('text/plain', field.kind === 'table' ? field.table : `${field.table}[${field.name}]`)
  dt.effectAllowed = 'copyMove'
}

export function endFieldDrag(): void {
  current = null
}

/** The field being dragged right now (valid during dragover). */
export function draggingField(): DraggedField | null {
  return current
}

export function isFieldDrag(e: React.DragEvent | DragEvent): boolean {
  return !!e.dataTransfer?.types.includes(FIELD_MIME)
}

export function readFieldDrag(dt: DataTransfer | null): DraggedField | null {
  const raw = dt?.getData(FIELD_MIME)
  if (!raw) return current
  try {
    return JSON.parse(raw) as DraggedField
  } catch {
    return null
  }
}

const SUMMARIZE_TO_AGG: Record<string, number> = {
  sum: SQ_AGG.Sum,
  average: SQ_AGG.Avg,
  min: SQ_AGG.Min,
  max: SQ_AGG.Max,
  count: SQ_AGG.CountNonNull,
  distinctCount: SQ_AGG.Count
}

/** Default aggregation for a column dropped into a value well (PBI: column summarizeBy, numeric → Sum, else Count). */
export function defaultAggregation(model: SemanticModel | undefined, table: string, column: string): number | undefined {
  const col = model?.tables.find((t) => t.name === table)?.columns.find((c) => c.name === column)
  if (!col) return SQ_AGG.Sum
  const sb = col.summarizeBy ?? 'default'
  if (sb === 'none') return undefined
  if (sb !== 'default') return SUMMARIZE_TO_AGG[sb]
  return col.dataType === 'int64' || col.dataType === 'double' || col.dataType === 'decimal' ? SQ_AGG.Sum : SQ_AGG.CountNonNull
}

/**
 * SQ expression for a dragged field. `asValue`: the target well holds measures (numeric columns
 * become Aggregation per summarizeBy; non-summarizable become Count).
 */
export function fieldToSQ(field: DraggedField, opts: { asValue?: boolean; model?: SemanticModel } = {}): SQExpr[] {
  switch (field.kind) {
    case 'measure':
      return [measureExpr(field.table, field.name)]
    case 'column': {
      if (!opts.asValue) return [columnExpr(field.table, field.name)]
      const agg = defaultAggregation(opts.model, field.table, field.name)
      return [aggregationExpr(field.table, field.name, agg ?? SQ_AGG.CountNonNull)]
    }
    case 'hierarchyLevel':
      return [hierarchyLevelExpr(field.table, field.hierarchy, field.name)]
    case 'hierarchy':
      return field.levels.map((l) => hierarchyLevelExpr(field.table, field.name, l))
    default:
      return []
  }
}

export function hierarchyLevelExpr(table: string, hierarchy: string, level: string): SQExpr {
  return { HierarchyLevel: { Expression: { Hierarchy: { Expression: { SourceRef: { Entity: table } }, Hierarchy: hierarchy } }, Level: level } }
}
