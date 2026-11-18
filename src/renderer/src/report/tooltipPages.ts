/**
 * Report-page tooltips: automatic matching (PBI "Page: Auto"). A tooltip page whose Tooltip fields (bound like
 * drill-through fields: pageBinding parameters / filter cards) are used by a visual is shown when hovering that visual,
 * unless the visual explicitly picks a page or the default tooltip. Pure helpers (unit-tested).
 */
import { fieldKey, type SQExpr } from '@core/report/sq'
import type { PageDocument, ReportDocument } from '@core/report/types'
import { drillthroughFields, orderedPages, pageType, visualFields } from './pbir'

/** Comparable key of a field: aggregations compare by their column (a "Sum of Amount" uses Sales[Amount]). */
export function baseFieldKey(expr: SQExpr | any): string {
  const inner = expr?.Aggregation?.Expression
  return fieldKey(inner ?? expr)
}

/** Tooltip pages (in report order) with their tooltip field keys. */
export function tooltipPages(report: ReportDocument): Array<{ page: PageDocument; keys: string[] }> {
  return orderedPages(report)
    .filter((p) => pageType(p) === 'tooltip')
    .map((page) => ({ page, keys: drillthroughFields(page).map((f) => baseFieldKey(f.field)) }))
    .filter((t) => t.keys.length > 0)
}

/**
 * Best tooltip page for a visual: the tooltip page with the most tooltip fields used by the visual (ties: report
 * order). Undefined when no tooltip page has a field in common with the visual.
 */
export function autoTooltipPage(report: ReportDocument, visualJson: any): PageDocument | undefined {
  const used = new Set(visualFields(visualJson).map((f) => baseFieldKey(f.expr)))
  let best: { page: PageDocument; score: number } | undefined
  for (const t of tooltipPages(report)) {
    const score = t.keys.filter((k) => used.has(k)).length
    if (score > 0 && (!best || score > best.score)) best = { page: t.page, score }
  }
  return best?.page
}

/**
 * Is the visual's tooltip in "Auto" mode? Type Report page with no page chosen, or no tooltip type set on the visual
 * at all (PBI's default: report-page tooltips match automatically). An explicit 'Default' type opts out.
 */
export function tooltipIsAuto(visualJson: any, resolved: { type: 'Default' | 'Canvas'; section?: string }): boolean {
  if (resolved.type === 'Canvas') return !resolved.section
  const explicit = (visualJson?.visual ?? visualJson?.visualGroup)?.visualContainerObjects?.visualTooltip?.find?.((e: any) => !e.selector)?.properties?.type
  return explicit === undefined
}
