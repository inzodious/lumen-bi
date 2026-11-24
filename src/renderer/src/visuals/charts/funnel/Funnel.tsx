/**
 * Funnel (PBI `funnel`): centered horizontal bars sorted by value (desc by default), category
 * labels on the left (`categoryAxis`), data labels (`labels`: funnelLabelStyle, position, units,
 * precision, percentage precision, background) and the conversion-rate labels (`percentBarLabel`:
 * 100% above the first stage, last ÷ first below the last). Tooltips add %First / %Previous.
 * Cross-highlighting draws the highlighted part over a faded full bar.
 */
import { useMemo, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { VisualProps } from '../../contract'
import { buildCategorical, pointIdentity } from '../../common/categorical'
import { FormatReader, PBI } from '../../common/fmtProps'
import { ellipsize, fontAttrs, lineHeight, measureText } from '../../common/text'
import { contrastText, rgba } from '../../common/color'
import { colorAt } from '@core/report/gradientFill'
import { SvgGradientDefs, svgPaintRef, type SvgPaint } from '../../common/svgPaint'
import { formatWithUnits, resolveDisplayUnit } from '../../common/units'
import { makeInteractions } from '../../common/interaction'
import { pointTooltip } from '../../common/tooltip'
import { EmptyVisual, NoData, VisualError, useVisualQuery } from '../../common/VisualState'
import { ICONS } from '../icons'
import { conversionRate, formatPercent, funnelLabelText, normalizeFunnelLabelStyle, percentOfFirst, percentOfPrevious } from './funnelMath'
import { WIDEN_MARK } from '../../common/motionMarks'

/** Bar height as a fraction of the row (PBI leaves a small gap between stages). */
const BAR_FILL = 0.85

/** Default data-label position (also shown by the Format pane). */
export const FUNNEL_LABEL_POSITION = 'Auto'

export function Funnel({ visual, width, height, ctx }: VisualProps) {
  const json = visual.json
  const fmt = useMemo(() => new FormatReader(json, ctx.theme), [json, ctx.theme])
  const q = useVisualQuery(json, ctx, () => buildCategorical(json, ctx, { splitRoles: ['Y'], defaultSort: 'measureDesc', highlight: true, fmt, maxCategories: 1000 }))
  if (!q.ok) return <VisualError error={q.error} height={height} />
  const d = q.data
  if (!d.series.length) return <EmptyVisual icon={ICONS.funnel} width={width} height={height} />
  const s = d.series[0]
  const n = d.categories.length
  if (!n) return <NoData height={height} />
  const inter = makeInteractions(ctx, { drillLevels: d.allLevels.length })

  const catShow = fmt.bool('categoryAxis', 'show', true)
  const catT = fmt.text('categoryAxis', { color: 'color' }, { size: PBI.axisFontPt, color: PBI.labelColor })
  const labShow = fmt.bool('labels', 'show', true)
  const lT = fmt.text('labels', {}, { size: PBI.dataLabelFontPt, color: PBI.dataLabelColor })
  const lcolor = fmt.optStr('labels', 'color')
  const style = normalizeFunnelLabelStyle(fmt.optStr('labels', 'funnelLabelStyle') ?? fmt.optStr('labels', 'labelStyle'))
  const lpos = fmt.str('labels', 'labelPosition', FUNNEL_LABEL_POSITION)
  const lbg = fmt.bool('labels', 'enableBackground', false)
  const lbgColor = fmt.color('labels', 'backgroundColor', '#FFFFFF')
  const lbgOp = 1 - fmt.num('labels', 'backgroundTransparency', 90) / 100
  const pctDec = fmt.optNum('labels', 'percentageLabelPrecision') ?? 2
  const pctShow = fmt.bool('percentBarLabel', 'show', true)
  const pctT = fmt.text('percentBarLabel', {}, { size: PBI.dataLabelFontPt, color: PBI.labelColor })
  const raw = s.values
  const vals = raw.map((v) => (v === null ? 0 : Math.max(0, v)))
  const max = Math.max(...vals, 0) || 1
  const unit = resolveDisplayUnit(fmt.optNum('labels', 'labelDisplayUnits') ?? 0, max)
  const prec = fmt.optNum('labels', 'labelPrecision')

  const pctH = pctShow && n > 1 ? lineHeight(pctT.font) + 4 : 0
  const labelW = catShow ? Math.min(width * 0.3, Math.max(...d.categories.map((c) => measureText(c.label, catT.font))) + 10) : 0
  const plot = { x: labelW, y: pctH, w: Math.max(10, width - labelW - 4), h: Math.max(10, height - pctH * 2) }
  const step = plot.h / n
  const barH = Math.max(1, step * BAR_FILL)
  const cx = plot.x + plot.w / 2
  const hl = d.hasHighlights
  const lh = lineHeight(lT.font)

  const nodes: ReactNode[] = []
  const paints: SvgPaint[] = []
  const labels: ReactNode[] = []
  d.categories.forEach((c, ci) => {
    const v = vals[ci]
    const w = (v / max) * plot.w
    const y = plot.y + ci * step + (step - barH) / 2
    const id = pointIdentity(c, undefined)
    const grad = s.pointColors?.[ci] !== undefined ? s.pointGradients?.[ci] : s.gradient
    if (grad) paints.push({ gradient: grad })
    const color = s.pointColors?.[ci] ?? s.color
    const paint = grad ? svgPaintRef({ gradient: grad }) : color
    const op = hl ? 1 : inter.opacityFor(id)
    const handlers = {
      onClick: (e: ReactMouseEvent) => inter.onPointClick(id, e),
      onContextMenu: (e: ReactMouseEvent) => inter.onContextMenu(id, e),
      onMouseMove: (e: ReactMouseEvent) =>
        inter.showTooltip(
          e,
          pointTooltip(ctx, d, ci, s, [
            { label: '%First', value: formatPercent(percentOfFirst(raw, ci)) },
            { label: '%Previous', value: formatPercent(percentOfPrevious(raw, ci)) }
          ]),
          id
        ),
      onMouseLeave: () => inter.hideTooltip()
    }
    if (hl) {
      const h = Math.max(0, s.highlights?.[ci] ?? 0)
      const hw = (h / max) * plot.w
      nodes.push(
        <g key={c.key} {...handlers} style={{ cursor: 'pointer' }}>
          <rect x={cx - w / 2} y={y} width={w} height={barH} fill={rgba(color, PBI.highlightBackOpacity)} {...WIDEN_MARK} />
          <rect x={cx - hw / 2} y={y} width={hw} height={barH} fill={paint} {...WIDEN_MARK} />
        </g>
      )
    } else nodes.push(<rect key={c.key} x={cx - w / 2} y={y} width={Math.max(0, w)} height={barH} fill={paint} opacity={op} style={{ cursor: 'pointer' }} {...WIDEN_MARK} {...handlers} />)
    if (catShow)
      nodes.push(
        <text key={`c${c.key}`} x={plot.x - 6} y={y + barH / 2} dy="0.35em" textAnchor="end" {...fontAttrs(catT.font)} fill={catT.color} pointerEvents="none" opacity={op}>
          {ellipsize(c.label, labelW - 8, catT.font)}
        </text>
      )
    if (labShow && barH >= lh - 2) {
      const val = formatWithUnits(raw[ci], { unit, decimals: prec, formatString: s.formats[ci] ?? s.measure.formatString, format: ctx.format })
      const t = funnelLabelText(style, val, raw, ci, pctDec)
      const tw = measureText(t, lT.font)
      const fitsInside = tw + 8 <= w
      // positions: Auto/InsideCenter = centered (outside right when too narrow), InsideEnd = right end
      // inside, InsideBase = left end inside, OutsideEnd = right of the bar
      let lx: number
      let anchor: 'start' | 'middle' | 'end'
      let inside: boolean
      const fitsOutside = cx + w / 2 + 4 + tw <= width
      if ((lpos === 'OutsideEnd' && fitsOutside) || !fitsInside) {
        lx = cx + w / 2 + 4
        anchor = 'start'
        inside = false
      } else if (lpos === 'InsideEnd' || lpos === 'OutsideEnd') {
        lx = cx + w / 2 - 4
        anchor = 'end'
        inside = true
      } else if (lpos === 'InsideBase') {
        lx = cx - w / 2 + 4
        anchor = 'start'
        inside = true
      } else {
        lx = cx
        anchor = 'middle'
        inside = true
      }
      const fill = lcolor ?? (inside ? contrastText(grad ? colorAt(grad, 0.5) : color) : lT.color)
      const bx = anchor === 'start' ? lx - 3 : anchor === 'end' ? lx - tw - 3 : lx - tw / 2 - 3
      if (lbg) labels.push(<rect key={`lb${c.key}`} x={bx} y={y + barH / 2 - lh / 2} width={tw + 6} height={lh} fill={lbgColor} opacity={lbgOp} pointerEvents="none" />)
      labels.push(
        <text key={`l${c.key}`} x={lx} y={y + barH / 2} dy="0.35em" textAnchor={anchor} {...fontAttrs(lT.font)} fill={fill} pointerEvents="none" opacity={op}>
          {t}
        </text>
      )
    }
  })
  const rate = conversionRate(raw)
  if (pctShow && n > 1 && rate !== null) {
    nodes.push(
      <text key="pct0" x={cx} y={pctH / 2} dy="0.35em" textAnchor="middle" {...fontAttrs(pctT.font)} fill={pctT.color}>
        100%
      </text>,
      <text key="pctN" x={cx} y={height - pctH / 2} dy="0.35em" textAnchor="middle" {...fontAttrs(pctT.font)} fill={pctT.color}>
        {formatPercent(rate)}
      </text>
    )
  }
  return (
    <svg width={width} height={height} style={{ display: 'block', userSelect: 'none' }} onClick={(e) => inter.onBackgroundClick(e)} onContextMenu={(e) => inter.onContextMenu(undefined, e)}>
      <SvgGradientDefs paints={paints} />
      {nodes}
      {labels}
    </svg>
  )
}
