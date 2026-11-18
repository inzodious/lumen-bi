/**
 * Query helper for custom visuals whose roles mix columns and measures in user order (Deneb's
 * `dataset`, HTML Content's `content`): columns become group-bys, measures become values, and
 * the result is mapped back to projection order.
 */
import type { Scalar } from '@core/model/data'
import type { SummarizeResult } from '@core/engine/api'
import type { VisualHostContext } from '../contract'
import { expandParameters, getProjections, labelOf, sortSpecs, valueId, type Projection } from '../common/query'

export interface FieldColumn {
  projection: Projection
  /** display name (rename > field display name) */
  label: string
  kind: 'group' | 'value'
  /** column index into result rows */
  index: number
  formatString?: string
}

export interface FieldQueryResult {
  fields: FieldColumn[]
  result: SummarizeResult
  groups: Projection[]
  values: Projection[]
}

export function runFieldQuery(visualJson: any, ctx: VisualHostContext, roles: string[], opts: { limit?: number } = {}): FieldQueryResult {
  const all = getProjections(visualJson)
  const ordered: Projection[] = []
  for (const r of roles) ordered.push(...expandParameters(all[r] ?? [], ctx))
  const groups = ordered.filter((p) => !p.isMeasure)
  const values = ordered.filter((p) => p.isMeasure)
  const result = ctx.engine.summarize({
    groupBy: groups.map((g) => ({ kind: 'sq', expr: g.expr })),
    values: values.map((v) => ({ id: valueId(v), expr: { kind: 'sq', expr: v.expr } })),
    filters: ctx.filters,
    orderBy: sortSpecs(visualJson, groups, values),
    limit: opts.limit,
    keepBlankRows: groups.length === 0
  })
  const fields: FieldColumn[] = ordered.map((p) => {
    const gi = groups.indexOf(p)
    const index = gi >= 0 ? gi : groups.length + values.indexOf(p)
    return { projection: p, label: labelOf(ctx, p), kind: gi >= 0 ? 'group' : 'value', index, formatString: result.columns[index]?.formatString }
  })
  return { fields, result, groups, values }
}

/** Format string for a cell (dynamic per-row format when present). */
export function cellFormat(q: FieldQueryResult, rowIndex: number, f: FieldColumn): string | undefined {
  if (f.kind === 'value') return q.result.formats?.[rowIndex]?.[f.index - q.groups.length] ?? f.formatString
  return f.formatString
}

export function cellValue(q: FieldQueryResult, rowIndex: number, f: FieldColumn): Scalar {
  return q.result.rows[rowIndex]?.[f.index] ?? null
}
