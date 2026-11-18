/**
 * Cell-level model shared by table and matrix: value → display text + conditional formatting
 * (background / font color, data bars, icons, web URLs), images and links for columns with the
 * ImageUrl / WebUrl data categories.
 */
import type { Scalar } from '@core/model/data'
import type { DataType } from '@core/model/types'
import type { ValueFormatter } from '@core/engine/api'
import type { ResolvedTheme } from '@core/report/theme'
import { fieldKey, type SQExpr } from '@core/report/sq'
import {
  computeStats,
  dataBarGeometry,
  evalColorRule,
  ruleInputs,
  scopeApplies,
  type ColumnCF,
  type RuleStats
} from '../common/conditionalFormatting'
import { formatWithUnits } from '../common/displayUnits'
import type { FieldAccessor } from '../common/sqEval'
import type { ColumnOverride } from './tableFormat'
import type { SparkPoint, SparklineFormat } from './sparklineModel'
import { kpiIconFor } from './iconSet'

export interface CellModel {
  value: Scalar
  text: string
  color?: string
  background?: string
  icon?: { name: string; layout: 'before' | 'after' | 'only'; verticalAlignment: 'top' | 'middle' | 'bottom' }
  bar?: { start: number; width: number; axis?: number; color: string; axisColor: string }
  hideText?: boolean
  url?: string
  image?: string
  /** sparkline series (table/matrix sparkline columns) */
  spark?: { points: SparkPoint[]; format: SparklineFormat }
}

export interface ValueColumnInfo {
  formatString?: string
  dataType?: DataType
  dataCategory?: string
  cf?: ColumnCF
  override?: ColumnOverride
  /** AS-style KPI part (engine.describeField().kpi): status / trend render as KPI icons like PBI */
  kpi?: { part: 'goal' | 'status' | 'trend'; statusGraphic?: string }
}

/** Per-column stats for gradients and data bars (computed over instance cells). */
export interface ColumnStats {
  back?: RuleStats
  font?: RuleStats
  icon?: RuleStats
  bar?: RuleStats
}

/**
 * Collect rule input values over rows to compute gradient / data bar ranges. `full` (fieldKey →
 * stats from `fullRangeStats`) replaces the loaded rows' range when the data is windowed, so colors
 * and bars don't depend on how far the user has scrolled; `ownKey` is the column's own fieldKey.
 */
export function columnStats(cf: ColumnCF | undefined, rows: Array<{ get: FieldAccessor; own: Scalar }>, full?: Map<string, RuleStats>, ownKey?: string): ColumnStats {
  if (!cf) return {}
  const statsFor = (rule: any): RuleStats | undefined => {
    if (!rule || rule.kind !== 'gradient') return undefined
    const input: SQExpr = rule.input
    const k = fieldKey(input)
    return full?.get(k) ?? computeStats(rows.map((r) => r.get(k, input) ?? null))
  }
  return {
    back: statsFor(cf.backColor?.rule),
    font: statsFor(cf.fontColor?.rule),
    icon: statsFor(cf.icon?.rule.rule),
    bar: cf.dataBars ? (ownKey !== undefined ? full?.get(ownKey) : undefined) ?? computeStats(rows.map((r) => r.own)) : undefined
  }
}

export function isUrl(v: unknown): v is string {
  return typeof v === 'string' && /^(https?:|mailto:|ftp:)/i.test(v.trim())
}

export function buildCell(
  value: Scalar,
  info: ValueColumnInfo,
  ctx: { format: ValueFormatter; theme: ResolvedTheme },
  opts: {
    get: FieldAccessor
    stats: ColumnStats
    isTotal: boolean
    dynamicFormat?: string
    /** matrix: 'subtotal' (row/column subtotal) vs 'grand' (grand total) for "Apply to subtotals / total" */
    totalKind?: 'subtotal' | 'grand'
  }
): CellModel {
  const fmt = opts.dynamicFormat ?? info.formatString
  const ov = info.override
  // "Specific column": Apply to values / subtotals / total (tables only know "total")
  const applyOverride = ov && (opts.isTotal ? (opts.totalKind === 'subtotal' ? ov.styleSubtotals : ov.styleTotal) : ov.styleValues)
  let text: string
  if (value === null || value === undefined) text = ''
  else if (typeof value === 'number' && applyOverride && (ov!.displayUnits !== undefined || ov!.precision !== undefined))
    text = formatWithUnits(value, ctx.format, { formatString: fmt, dataType: info.dataType, units: ov!.displayUnits ?? 1, precision: ov!.precision })
  else text = ctx.format(value, fmt, info.dataType)
  const cell: CellModel = { value, text }
  if (applyOverride) {
    if (ov!.fontColor) cell.color = ov!.fontColor
    if (ov!.backColor) cell.background = ov!.backColor
  }
  const cat = (info.dataCategory ?? '').toLowerCase()
  if (cat === 'weburl' && isUrl(value)) cell.url = value.trim()
  if (cat === 'imageurl' && typeof value === 'string' && value) cell.image = value
  const kpiIcon = kpiIconFor(info.kpi, value)
  if (kpiIcon) {
    // PBI shows KPI status / trend values as the KPI graphic only (no number)
    cell.icon = { name: kpiIcon, layout: 'only', verticalAlignment: 'middle' }
  } else if (kpiIcon === '') cell.text = '' // integer outside the graphic's states: PBI draws nothing

  const cf = info.cf
  if (cf) {
    const t = opts.isTotal
    if (cf.backColor && scopeApplies(cf.backColor.scope, t)) {
      const c = evalColorRule(cf.backColor.rule, opts.get, opts.stats.back ?? {}, ctx.theme)
      if (c) cell.background = c
    }
    if (cf.fontColor && scopeApplies(cf.fontColor.scope, t)) {
      const c = evalColorRule(cf.fontColor.rule, opts.get, opts.stats.font ?? {}, ctx.theme)
      if (c) cell.color = c
    }
    if (cf.icon && scopeApplies(cf.icon.scope, t)) {
      const name = evalColorRule(cf.icon.rule.rule, opts.get, opts.stats.icon ?? {}, ctx.theme)
      if (name) cell.icon = { name, layout: cf.icon.rule.layout, verticalAlignment: cf.icon.rule.verticalAlignment }
    }
    if (cf.webURL && scopeApplies(cf.webURL.scope, t)) {
      const u = opts.get(fieldKey(cf.webURL.input), cf.webURL.input)
      if (isUrl(u)) cell.url = u.trim()
    }
    if (cf.dataBars && scopeApplies(cf.dataBars.scope, t) && typeof value === 'number') {
      const spec = cf.dataBars.spec
      const g = dataBarGeometry(value, spec, opts.stats.bar ?? {})
      cell.bar = { start: g.start, width: g.width, axis: g.axis, color: g.negative ? spec.negativeColor : spec.positiveColor, axisColor: spec.axisColor }
      if (spec.hideText) cell.hideText = true
    }
  }
  return cell
}

/** Inputs a set of CFs needs that aren't already available as projections. */
export function extraInputs(cfs: Iterable<ColumnCF | undefined>, available: Set<string>): SQExpr[] {
  const out = new Map<string, SQExpr>()
  for (const cf of cfs) {
    if (!cf) continue
    const all = [...ruleInputs(cf.backColor?.rule), ...ruleInputs(cf.fontColor?.rule), ...ruleInputs(cf.icon?.rule.rule), ...(cf.webURL ? [cf.webURL.input] : [])]
    for (const e of all) {
      const k = fieldKey(e)
      if (!available.has(k)) out.set(k, e)
    }
  }
  return [...out.values()]
}

/** A bare column used as a CF input must be aggregated to be evaluated per row (PBI uses First / Min). */
export function asValueExpr(e: SQExpr): SQExpr {
  if (e?.Column) return { Aggregation: { Expression: e, Function: 3 } }
  return e
}
