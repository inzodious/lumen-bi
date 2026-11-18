/**
 * Conditional formatting (fx) of visual-container colors: title / subtitle font + background, visual background,
 * border, shadow, divider and header colors bound to a field (Field value), rules (Conditional) or a gradient
 * (FillRule). The rule's input is evaluated once over the visual's filter context (a container has no data points),
 * like Power BI does for these properties.
 *
 * Approximation (documented): gradients whose stops use "Lowest/Highest value" have no range across a single value;
 * the color of the min stop is used (PBI resolves those over the input's values in the visual's context, which for a
 * container is the same single value, so stops collapse to the first one as well).
 */
import { isDataBound } from '@core/report/props'
import { withTransparency } from '@core/report/theme'
import type { Scalar } from '@core/model/data'
import type { VisualHostContext } from '../visuals/contract'
import { evalConditional, type ConditionalRule } from '../visuals/common/color'
import type { ChromeSpec } from './chrome'

const quoteTable = (t: string) => `'${t.replace(/'/g, "''")}'`
const AGG = ['SUM', 'AVERAGE', 'DISTINCTCOUNT', 'MIN', 'MAX', 'COUNT', 'MEDIAN', 'STDEV.P', 'VAR.P']

/** Evaluate a Measure / Aggregation / Column SQ expression to a scalar in the visual's filter context. */
export function evalInputScalar(expr: any, ctx: VisualHostContext): Scalar | undefined {
  try {
    if (expr?.Measure) {
      const t = expr.Measure.Expression?.SourceRef?.Entity
      return ctx.engine.evaluateScalar(t ? `${quoteTable(t)}[${expr.Measure.Property}]` : `[${expr.Measure.Property}]`, ctx.filters).value
    }
    const col = expr?.Aggregation?.Expression?.Column ?? expr?.Column
    if (col) {
      const fn = expr.Aggregation ? (AGG[expr.Aggregation.Function ?? 0] ?? 'SUM') : 'FIRSTNONBLANK'
      const ref = `${quoteTable(col.Expression?.SourceRef?.Entity ?? '')}[${col.Property}]`
      const dax = fn === 'FIRSTNONBLANK' ? `FIRSTNONBLANK(${ref}, 1)` : `${fn}(${ref})`
      return ctx.engine.evaluateScalar(dax, ctx.filters).value
    }
  } catch {
    return undefined
  }
  return undefined
}

function inputOf(expr: any): any {
  if (expr.FillRule) return expr.FillRule.Input
  if (expr.Conditional) {
    // the first comparison's left side is the rule input (Conditional cases compare one input)
    const find = (c: any): any => c?.Comparison?.Left ?? c?.And?.Left?.Comparison?.Left ?? find(c?.And?.Left) ?? find(c?.Not?.Expression)
    for (const cs of expr.Conditional.Cases ?? []) {
      const l = find(cs.Condition)
      if (l) return l
    }
    return undefined
  }
  return expr
}

/** Resolve one data-bound raw color value (`{ solid: { color: { expr } } }`) to a color string. */
export function evalBoundColor(raw: any, ctx: VisualHostContext): string | undefined {
  const expr = raw?.solid?.color?.expr ?? raw?.expr
  if (!expr) return undefined
  const input = inputOf(expr)
  const value = input ? evalInputScalar(input, ctx) : undefined
  if (value === undefined) return undefined
  const n = typeof value === 'number' ? value : NaN
  const rule: ConditionalRule = { expr, input }
  return evalConditional(rule, value ?? null, [Number.isFinite(n) ? n : 0, Number.isFinite(n) ? n : 0], ctx.theme)
}

function defaultEntry(visualJson: any, object: string): Record<string, any> | undefined {
  const v = visualJson?.visual ?? visualJson?.visualGroup
  return v?.visualContainerObjects?.[object]?.find?.((e: any) => !e.selector)?.properties
}

const pct = (raw: any): number => {
  const v = raw?.expr?.Literal?.Value
  const n = typeof v === 'string' ? Number(v.replace(/[DL]$/, '')) : NaN
  return Number.isFinite(n) ? n : 0
}

/** True when any container color of the visual is data-bound (cheap check before evaluating). */
export function hasBoundContainerColors(visualJson: any): boolean {
  const v = visualJson?.visual ?? visualJson?.visualGroup
  const objs = v?.visualContainerObjects
  if (!objs) return false
  return Object.values<any>(objs).some((entries) => entries?.some?.((e: any) => Object.values<any>(e?.properties ?? {}).some((p) => (p?.solid?.color?.expr || p?.expr) && isDataBound(p))))
}

/** Chrome with data-bound container colors evaluated (returns the same object when nothing is bound). */
export function applyBoundContainerColors(chrome: ChromeSpec, visualJson: any, ctx: VisualHostContext | null): ChromeSpec {
  if (!ctx || !hasBoundContainerColors(visualJson)) return chrome
  const bound = (object: string, prop: string): string | undefined => {
    const raw = defaultEntry(visualJson, object)?.[prop]
    return raw !== undefined && isDataBound(raw) ? evalBoundColor(raw, ctx) : undefined
  }
  const out: ChromeSpec = { ...chrome, title: { ...chrome.title }, subTitle: { ...chrome.subTitle }, header: { ...chrome.header } }
  const tf = bound('title', 'fontColor')
  if (tf) out.title.color = tf
  const tb = bound('title', 'background')
  if (tb) out.title.background = withTransparency(tb, pct(defaultEntry(visualJson, 'title')?.transparency))
  const sf = bound('subTitle', 'fontColor')
  if (sf) out.subTitle.color = sf
  const sb = bound('subTitle', 'background')
  if (sb) out.subTitle.background = sb
  const bg = bound('background', 'color')
  if (bg && chrome.background !== undefined) out.background = withTransparency(bg, pct(defaultEntry(visualJson, 'background')?.transparency))
  const bc = bound('border', 'color')
  if (bc && chrome.border) out.border = { ...chrome.border, color: bc }
  const dc = bound('divider', 'color')
  if (dc && chrome.divider) out.divider = { ...chrome.divider, color: dc }
  const hb = bound('visualHeader', 'background')
  if (hb) out.header.background = hb
  const hf = bound('visualHeader', 'foreground')
  if (hf) out.header.foreground = hf
  return out
}
