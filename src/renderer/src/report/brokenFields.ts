/**
 * Fields in a visual's wells that don't resolve against the model (deleted / renamed columns or measures).
 * Power BI shows the visual's error state "Something's wrong with one or more fields" with See details / Fix this;
 * "Fix this" removes the broken fields from the visual. Pure helpers (unit-tested).
 */
import { fieldKey, type SQExpr } from '@core/report/sq'
import type { QueryEngine } from '@core/engine/api'
import { visualFields } from './pbir'

export interface BrokenField {
  role: string
  queryRef: string
  /** readable reference, e.g. Sales[Total] */
  label: string
  key: string
}

/** Only plain model references are checked; calculated projections (visual calculations, arithmetic…) are skipped. */
function checkable(expr: any): boolean {
  if (!expr || typeof expr !== 'object') return false
  if (expr.Column || expr.Measure || expr.HierarchyLevel) return true
  return !!(expr.Aggregation && (expr.Aggregation.Expression?.Column || expr.Aggregation.Expression?.HierarchyLevel))
}

function labelOf(expr: any, queryRef: string): string {
  const e = expr.Aggregation?.Expression ?? expr
  const c = e.Column ?? e.Measure
  if (c) return `${c.Expression?.SourceRef?.Entity ?? '?'}[${c.Property}]`
  const h = e.HierarchyLevel
  if (h) return `${h.Expression?.Hierarchy?.Expression?.SourceRef?.Entity ?? '?'}[${h.Expression?.Hierarchy?.Hierarchy ?? '?'}].[${h.Level}]`
  return queryRef
}

/** Report-level measures (definition/reportExtensions.json) as `Table.Measure` keys — they live outside the model. */
export function reportMeasureKeys(reportExtensions: any): Set<string> {
  const out = new Set<string>()
  for (const e of reportExtensions?.entities ?? []) for (const m of e?.measures ?? []) if (e?.name && m?.name) out.add(`${e.name}.${m.name}`)
  return out
}

export function brokenFields(visualJson: any, engine: Pick<QueryEngine, 'describeField'>, reportMeasures: Set<string> = new Set()): BrokenField[] {
  const out: BrokenField[] = []
  for (const f of visualFields(visualJson)) {
    if (!checkable(f.expr)) continue
    const m = (f.expr as any).Measure
    if (m && reportMeasures.has(`${m.Expression?.SourceRef?.Entity}.${m.Property}`)) continue
    let ok = false
    try {
      ok = !!engine.describeField(f.expr as SQExpr)
    } catch {
      ok = false
    }
    if (!ok) out.push({ role: f.role, queryRef: f.queryRef, label: labelOf(f.expr, f.queryRef), key: fieldKey(f.expr) })
  }
  return out
}

/** "Fix this": remove the broken projections (and sorts / empty roles referencing them). Mutates visualJson. */
export function removeBrokenFields(visualJson: any, broken: BrokenField[]): void {
  const keys = new Set(broken.map((b) => b.key))
  const qs = visualJson?.visual?.query?.queryState
  if (!qs) return
  for (const [role, bucket] of Object.entries<any>(qs)) {
    if (!Array.isArray(bucket?.projections)) continue
    bucket.projections = bucket.projections.filter((p: any) => !keys.has(fieldKey(p.field)))
    if (!bucket.projections.length) delete qs[role]
  }
  const sd = visualJson.visual.query.sortDefinition
  if (Array.isArray(sd?.sort)) {
    sd.sort = sd.sort.filter((s: any) => !keys.has(fieldKey(s.field)))
    if (!sd.sort.length) delete visualJson.visual.query.sortDefinition
  }
}
