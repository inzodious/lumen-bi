/** Default Power BI tooltip content for categorical data points. */
import type { TooltipItem, VisualHostContext } from '../contract'
import type { CategoricalData, Series } from './categorical'
import { formatScalar } from './units'

export function pointTooltip(ctx: VisualHostContext, d: CategoricalData, ci: number, s: Series | undefined, extra: TooltipItem[] = []): TooltipItem[] {
  const items: TooltipItem[] = []
  const cat = d.categories[ci]
  if (cat) d.levels.forEach((l, li) => items.push({ label: l.label, value: cat.labels[li] }))
  if (s?.split && d.seriesField) items.push({ label: d.seriesField.label, value: formatScalar(s.seriesValue ?? null, d.seriesField.formatString, ctx.format, d.seriesField.desc?.dataType) })
  if (s) {
    items.push({ label: s.measure.label, value: formatScalar(s.values[ci] ?? null, s.formats[ci] ?? s.measure.formatString, ctx.format), color: s.pointColors?.[ci] ?? s.color })
    const h = s.highlights?.[ci]
    if (s.highlights && h !== null && h !== undefined) items.push({ label: 'Highlighted', value: formatScalar(h, s.formats[ci] ?? s.measure.formatString, ctx.format) })
    d.tooltips.forEach((t, ti) => items.push({ label: t.label, value: formatScalar(s.tooltipValues[ci]?.[ti] ?? null, t.formatString, ctx.format, t.desc?.dataType) }))
  }
  items.push(...extra)
  return items
}
