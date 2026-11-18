/**
 * Evaluate a single SQ field (measure / aggregation / column) in the visual's filter context —
 * used for textbox dynamic values, measure-bound button destinations / text, HTML stylesheets.
 */
import type { Scalar } from '@core/model/data'
import type { SQExpr } from '@core/report/sq'
import type { VisualHostContext } from '../contract'

export interface EvaluatedField {
  value: Scalar
  formatted: string
  error?: string
}

export function evaluateField(ctx: VisualHostContext, expr: SQExpr): EvaluatedField {
  try {
    const res = ctx.engine.summarize({ groupBy: [], values: [{ id: 'v', expr: { kind: 'sq', expr } }], filters: ctx.filters, keepBlankRows: true })
    const value = res.rows[0]?.[0] ?? null
    const fmt = res.formats?.[0]?.[0] ?? res.columns[0]?.formatString
    return { value, formatted: value === null ? '' : ctx.format(value, fmt, res.columns[0]?.dataType) }
  } catch (e) {
    return { value: null, formatted: '', error: e instanceof Error ? e.message : String(e) }
  }
}

/** Raw data-bound property ({ expr: { Measure } } or { solid: { color: { expr } } }) → field expr. */
export function boundField(raw: any): SQExpr | undefined {
  const e = raw?.solid?.color?.expr ?? raw?.expr ?? raw
  return e && typeof e === 'object' && (e.Measure || e.Aggregation || e.Column) ? e : undefined
}
