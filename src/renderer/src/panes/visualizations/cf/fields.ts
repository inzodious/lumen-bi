/**
 * Field helpers for the fx dialog: model fields for "What field should we base this on?", the
 * default input for a target (the series' own field, like PBI), and numeric/text classification.
 */
import type { SemanticModel } from '@core/model/types'
import { columnExpr, fieldInfo, measureExpr, SQ_AGG, type SQExpr } from '@core/report/sq'
import { inputFromExpr, stableKey, type CFInput } from './rules'
import { isValueProjection, roleProjections } from '../wells'

export interface FieldOption {
  key: string
  label: string
  table: string
  kind: 'measure' | 'column'
  expr: SQExpr
  numeric: boolean
}

const NUMERIC = new Set(['int64', 'double', 'decimal'])

export function modelFields(model: SemanticModel | undefined): FieldOption[] {
  const out: FieldOption[] = []
  for (const t of model?.tables ?? []) {
    if (t.isHidden || t.isPrivate) continue
    for (const m of t.measures) {
      if (m.isHidden) continue
      const expr = measureExpr(t.name, m.name)
      out.push({ key: stableKey(expr), label: m.name, table: t.name, kind: 'measure', expr, numeric: !m.dataType || NUMERIC.has(m.dataType) || m.dataType === 'unknown' || m.dataType === 'variant' })
    }
    for (const c of t.columns) {
      if (c.isHidden || c.kind === 'rowNumber') continue
      const expr = columnExpr(t.name, c.name)
      out.push({ key: stableKey(expr), label: c.name, table: t.name, kind: 'column', expr, numeric: NUMERIC.has(c.dataType) })
    }
  }
  return out.sort((a, b) => a.table.localeCompare(b.table) || (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'measure' ? -1 : 1))
}

/** Is a field (column/measure) numeric according to the model? Unknown fields count as numeric. */
export function fieldIsNumeric(model: SemanticModel | undefined, field: SQExpr): boolean {
  const f = fieldInfo(field)
  const t = model?.tables.find((x) => x.name === f.table)
  if (!t) return true
  if (f.kind === 'measure') {
    const m = t.measures.find((x) => x.name === f.property)
    return !m?.dataType || NUMERIC.has(m.dataType) || m.dataType === 'unknown' || m.dataType === 'variant'
  }
  const c = t.columns.find((x) => x.name === f.property)
  return !c || NUMERIC.has(c.dataType)
}

export function isColumnField(field: SQExpr): boolean {
  return !!field?.Column
}

/** Default summarization for a column picked as rule input. */
export function defaultAggregation(model: SemanticModel | undefined, field: SQExpr): number | undefined {
  if (!isColumnField(field)) return undefined
  return fieldIsNumeric(model, field) ? SQ_AGG.Sum : SQ_AGG.Min // Min = "First" for text
}

/** CF input for a projected field (a measure as is, a column summarized). */
export function inputForField(model: SemanticModel | undefined, expr: SQExpr): CFInput {
  if (expr?.Column) return { field: expr, aggregation: defaultAggregation(model, expr) }
  return inputFromExpr(expr)
}

/** Does a rule over this input compare numbers (else text)? Counts are numeric. */
export function inputIsNumeric(model: SemanticModel | undefined, input: CFInput | undefined): boolean {
  if (!input) return true
  if (input.aggregation !== undefined && input.aggregation !== SQ_AGG.Min && input.aggregation !== SQ_AGG.Max) return true
  return fieldIsNumeric(model, input.field)
}

/** The projection a series selector points at (queryRef), else the visual's first value projection. */
export function defaultInputFor(model: SemanticModel | undefined, visualJson: any, metadata?: string): CFInput | undefined {
  const qs = visualJson?.visual?.query?.queryState ?? {}
  const all = Object.keys(qs).flatMap((role) => roleProjections(visualJson, role).map((p) => ({ role, p })))
  const hit = metadata ? all.find((x) => x.p.queryRef === metadata) : undefined
  const pick = hit ?? all.find((x) => x.role !== 'Tooltips' && isValueProjection(x.p.field))
  return pick ? inputForField(model, pick.p.field) : undefined
}
