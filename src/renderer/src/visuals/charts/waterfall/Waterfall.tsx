/**
 * Waterfall chart (PBI `waterfallChart`): increase / decrease / total (and breakdown "Other")
 * columns with connector lines. Colors from `sentimentColors` (increaseFill / decreaseFill /
 * totalFill / otherFill; defaults = theme good / bad / first data color / neutral), breakdown
 * top-N from `breakdown.maxBreakdowns`, total column toggle `valueAxis.totalsEnabled`, data labels
 * (`labels`: position, units, precision, background), Y-axis constant lines (`y1AxisReferenceLine`).
 */
import { useMemo, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { VisualProps, TooltipItem } from '../../contract'
import { buildCategorical, pointIdentity, type CategoricalData } from '../../common/categorical'
import { FormatReader, PBI, axisTitleDefaults } from '../../common/fmtProps'
import { Legend, measureLegend, readLegendStyle, type LegendItem } from '../../common/Legend'
import { computeValueAxis, valueToPx, bandLayout } from '../../common/scale'
import { ellipsize, fontAttrs, lineHeight, measureText } from '../../common/text'
import { contrastText } from '../../common/color'
import { formatScalar, formatWithUnits, parseNumberFormat, resolveDisplayUnit } from '../../common/units'
import { makeInteractions } from '../../common/interaction'
import { EmptyVisual, NoData, VisualError, useVisualQuery } from '../../common/VisualState'
import { ICONS } from '../icons'
import { layoutCategoryLabels, maxLabelWidth, valueTickFormatter } from '../cartesian/axisLayout'
import { breakdownSteps, labelAnchor, normalizeMaxBreakdowns, simpleSteps, stepExtent, type WaterfallStep } from './waterfallMath'
import { readReferenceLines } from '../scatter/referenceLines'
import { refLineNodes } from '../scatter/RefLineLayer'
import { axisTitleWithUnits } from '../scatter/scatterModel'
import type { DataPointIdentity } from '@core/report/sq'
import { barMark } from '../../common/motionMarks'

/** Default data-label position (also shown by the Format pane). */
export const WATERFALL_LABEL_POSITION = 'Auto'

export function stepsOf(d: CategoricalData, opts: { maxBreakdowns: number; totals: boolean }): WaterfallStep[] {
  if (d.seriesField && d.levels.length) {
    const split = d.series.filter((s) => s.split)
    return breakdownSteps(
      d.categories.map((c) => c.label),
      split.map((s) => s.name),
      d.categories.map((_, ci) => split.map((s) => s.values[ci])),
      opts.maxBreakdowns
    )
  }
  if (d.seriesField) {
    const split = d.series.filter((s) => s.split)
    return simpleSteps(
      split.map((s) => s.values[0] ?? null),
      split.map((s) => s.name),
      { total: opts.totals }
    ).map((s, i) => (s.kind === 'total' ? s : { ...s, bi: i, ci: undefined }))
  }
  const s = d.series[0]
  return simpleSteps(
    s.values,
    d.categories.map((c) => c.label),
    { total: opts.totals }
  )
}

export function Waterfall({ visual, width, height, ctx }: VisualProps) {
  const json = visual.json
  const fmt = useMemo(() => new FormatReader(json, ctx.theme), [json, ctx.theme])
  const q = useVisualQuery(json, ctx, () => buildCategorical(json, ctx, { seriesRole: 'Breakdown', splitRoles: ['Y'], defaultSort: 'categoryAsc', fmt, maxCategories: 300, maxSeries: 1000 }))
  if (!q.ok) return <VisualError error={q.error} height={height} />
  const d = q.data
  if (!d.series.length) return <EmptyVisual icon={ICONS.waterfallChart} width={width} height={height} />
  if (!d.categories.length) return <NoData height={height} />
  const steps = stepsOf(d, { maxBreakdowns: normalizeMaxBreakdowns(fmt.optNum('breakdown', 'maxBreakdowns')), totals: fmt.bool('valueAxis', 'totalsEnabled', true) })
  if (!steps.length) return <NoData height={height} />
  const inter = makeInteractions(ctx, { drillLevels: d.allLevels.length })
  const s0 = d.series[0]
  const formatString = s0.measure.formatString
  const split = d.series.filter((s) => s.split)

  const colors = {
    increase: fmt.color('sentimentColors', 'increaseFill', ctx.theme.good),
    decrease: fmt.color('sentimentColors', 'decreaseFill', ctx.theme.bad),
    total: fmt.color('sentimentColors', 'totalFill', ctx.theme.dataColors[0]),
    // PBI uses the theme's neutral sentiment color for the breakdown "Other" column
    other: fmt.color('sentimentColors', 'otherFill', ctx.theme.neutral)
  }
  const responsive = fmt.bool('general', 'responsive', true)
  const legendStyle = readLegendStyle(fmt, { show: !(responsive && height < 120), position: 'Top', title: '' })
  const items: LegendItem[] = [
    { key: 'increase', label: 'Increase', color: colors.increase },
    { key: 'decrease', label: 'Decrease', color: colors.decrease },
    ...(steps.some((s) => s.kind === 'other') ? [{ key: 'other', label: 'Other', color: colors.other }] : []),
    ...(steps.some((s) => s.kind === 'total') ? [{ key: 'total', label: 'Total', color: colors.total }] : [])
  ]
  const lg = measureLegend(legendStyle, items, width, height)
  const legendVertical = legendStyle.position.startsWith('Left') || legendStyle.position.startsWith('Right')
  const area = {
    x: legendVertical && legendStyle.position.startsWith('Left') ? lg.size : 0,
    y: !legendVertical && legendStyle.position.startsWith('Top') ? lg.size : 0,
    w: width - (legendVertical ? lg.size : 0),
    h: height - (legendVertical ? 0 : lg.size)
  }

  const catT = fmt.text('categoryAxis', { color: 'labelColor' }, { size: PBI.axisFontPt, color: PBI.labelColor })
  const valT = fmt.text('valueAxis', { color: 'labelColor' }, { size: PBI.axisFontPt, color: PBI.labelColor })
  const tdef = axisTitleDefaults(fmt)
  const small = responsive && (height < 160 || width < 180)
  const catShow = fmt.bool('categoryAxis', 'show', true)
  const valShow = fmt.bool('valueAxis', 'show', true)
  const catTitleT = fmt.text('categoryAxis', { size: 'titleFontSize', family: 'titleFontFamily', color: 'titleColor', bold: 'titleBold', italic: 'titleItalic' }, tdef)
  const valTitleT = fmt.text('valueAxis', { size: 'titleFontSize', family: 'titleFontFamily', color: 'titleColor', bold: 'titleBold', italic: 'titleItalic' }, tdef)
  const catTitle = !small && catShow && fmt.bool('categoryAxis', 'showAxisTitle', true) ? fmt.str('categoryAxis', 'titleText', d.levels.map((l) => l.label).join(' and ') || d.seriesField?.label || '') : ''
  const valTitleOn = !small && valShow && fmt.bool('valueAxis', 'showAxisTitle', true)
  const catTitleH = catTitle ? lineHeight(catTitleT.font) + 2 : 0
  const valTitleW = valTitleOn ? lineHeight(valTitleT.font) + 2 : 0
  const [lo, hi] = stepExtent(steps)
  const yRight = fmt.bool('valueAxis', 'switchAxisPosition', false) || fmt.str('valueAxis', 'position', 'Left') === 'Right'
  const invert = fmt.bool('valueAxis', 'invertAxis', false)

  const labShow = fmt.bool('labels', 'show', false)
  const lT = fmt.text('labels', {}, { size: PBI.dataLabelFontPt, color: PBI.dataLabelColor })
  const labelH = labShow ? lineHeight(lT.font) : 0
  const top = area.y + 6 + (labShow ? labelH * 0.5 : 0)
  const axisModel = (len: number) => computeValueAxis({ dataMin: lo, dataMax: hi, includeZero: true, start: fmt.optNum('valueAxis', 'start'), end: fmt.optNum('valueAxis', 'end'), length: len })
  const tickFmt = (m: ReturnType<typeof axisModel>) => valueTickFormatter(m, { displayUnits: fmt.optNum('valueAxis', 'labelDisplayUnits'), precision: fmt.optNum('valueAxis', 'labelPrecision'), formatString, format: ctx.format })
  let plotH = Math.max(10, area.y + area.h - top - (catShow ? lineHeight(catT.font) + 6 : 0) - catTitleH)
  let model = axisModel(plotH)
  let labels = model.ticks.map(tickFmt(model))
  const sideW = (valShow ? maxLabelWidth(labels, valT.font) + 8 : 0) + valTitleW + 4
  const plotW = Math.max(10, area.w - sideW - 8)
  const px0 = area.x + (yRight ? 8 : sideW)
  const band = bandLayout(steps.length, plotW, fmt.num('categoryAxis', 'innerPadding', 20) / 100)
  const catLay = catShow
    ? layoutCategoryLabels(
        steps.map((s) => s.label),
        band.step,
        catT.font,
        area.h * (fmt.num('categoryAxis', 'maxMarginFactor', 25) / 100) + lineHeight(catT.font)
      )
    : { mode: 'none' as const, lines: [] as string[][], size: 0, every: 1 }
  plotH = Math.max(10, area.y + area.h - top - catLay.size - catTitleH - 2)
  model = axisModel(plotH)
  labels = model.ticks.map(tickFmt(model))
  const v = valueToPx(model, plotH, !invert)
  const py = (x: number) => top + v(x)
  const plot = { x: px0, y: top, w: plotW, h: plotH }

  const lunit = resolveDisplayUnit(fmt.optNum('labels', 'labelDisplayUnits') ?? 0, Math.max(Math.abs(lo), Math.abs(hi)))
  const lprec = fmt.optNum('labels', 'labelPrecision')
  const lcolor = fmt.optStr('labels', 'color')
  const lpos = fmt.str('labels', 'labelPosition', WATERFALL_LABEL_POSITION)
  const lbg = fmt.bool('labels', 'enableBackground', false)
  const lbgColor = fmt.color('labels', 'backgroundColor', '#FFFFFF')
  const lbgOp = 1 - fmt.num('labels', 'backgroundTransparency', 90) / 100
  const gridOn = fmt.bool('valueAxis', 'gridlineShow', true)
  const gridC = fmt.color('valueAxis', 'gridlineColor', PBI.gridColor)
  const gridS = fmt.str('valueAxis', 'gridlineStyle', 'dotted')
  const gridW = fmt.num('valueAxis', 'gridlineThickness', 1)
  const gridOp = 1 - fmt.num('valueAxis', 'gridlineTransparency', 0) / 100

  const nodes: ReactNode[] = []
  const plotColor = fmt.optStr('plotArea', 'color')
  if (plotColor) nodes.push(<rect key="plotbg" x={plot.x} y={plot.y} width={plot.w} height={plot.h} fill={plotColor} opacity={1 - fmt.num('plotArea', 'transparency', 0) / 100} />)
  model.ticks.forEach((t, i) => {
    const y = Math.round(py(t)) + 0.5
    if (gridOn) nodes.push(<line key={`g${i}`} x1={px0} x2={px0 + plotW} y1={y} y2={y} stroke={gridC} strokeWidth={gridW} strokeOpacity={gridOp} strokeDasharray={gridS === 'dotted' ? '1 2' : gridS === 'dashed' ? '4 3' : undefined} />)
    if (valShow)
      nodes.push(
        <text key={`t${i}`} x={yRight ? px0 + plotW + 6 : px0 - 6} y={y} dy="0.35em" textAnchor={yRight ? 'start' : 'end'} {...fontAttrs(valT.font)} fill={valT.color}>
          {labels[i]}
        </text>
      )
  })
  const refLines = readReferenceLines(fmt, [{ object: 'y1AxisReferenceLine', kind: 'constant', axis: 'y' }], [{ queryRef: s0.metadata, axis: 'y', values: steps.map((s) => s.value), formatString }], ctx.format)
  const yMap = { toPx: py, domain: model.domain }
  nodes.push(...refLineNodes(refLines, plot, undefined, yMap, 'back'))

  const idOf = (s: WaterfallStep): DataPointIdentity => {
    const cat = s.ci !== undefined ? d.categories[s.ci] : undefined
    const ser = s.bi !== undefined ? split[s.bi] : undefined
    return pointIdentity(cat, ser)
  }
  const fmtVal = (x: number) => formatWithUnits(x, { unit: lunit, decimals: lprec, formatString, format: ctx.format })
  const labelNodes: ReactNode[] = []
  steps.forEach((s, i) => {
    const x = px0 + band.pos(i)
    const yA = py(s.start)
    const yB = py(s.end)
    const y0 = Math.min(yA, yB)
    const y1 = Math.max(yA, yB)
    const id = idOf(s)
    const op = id.fields.length ? inter.opacityFor(id) : 1
    const catLabel = d.levels[0]?.label ?? d.seriesField?.label ?? 'Category'
    const tips: TooltipItem[] =
      s.ci !== undefined && s.bi !== undefined && d.seriesField
        ? [
            { label: catLabel, value: d.categories[s.ci].label },
            { label: d.seriesField.label, value: s.label },
            { label: s0.measure.label, value: formatScalar(s.value, formatString, ctx.format), color: colors[s.kind] }
          ]
        : [
            { label: s.kind === 'other' ? d.seriesField?.label ?? catLabel : catLabel, value: s.label },
            { label: s0.measure.label, value: formatScalar(s.value, formatString, ctx.format), color: colors[s.kind] }
          ]
    nodes.push(
      <rect
        key={`b${i}`}
        x={x}
        y={y0}
        width={band.bandwidth}
        height={Math.max(1, y1 - y0)}
        fill={colors[s.kind]}
        opacity={op}
        style={{ cursor: 'pointer' }}
        {...barMark(true, s.value < 0)}
        onClick={(e: ReactMouseEvent) => (id.fields.length ? inter.onPointClick(id, e, { categoryOnly: pointIdentity(s.ci !== undefined ? d.categories[s.ci] : undefined, undefined) }) : e.stopPropagation())}
        onContextMenu={(e) => inter.onContextMenu(id, e)}
        onMouseMove={(e) => inter.showTooltip(e, tips, id)}
        onMouseLeave={() => inter.hideTooltip()}
      />
    )
    if (i < steps.length - 1) {
      const yc = Math.round(py(s.end)) + 0.5
      nodes.push(<line key={`c${i}`} x1={x + band.bandwidth} x2={px0 + band.pos(i + 1)} y1={yc} y2={yc} stroke="#8A8886" strokeWidth={1} pointerEvents="none" />)
    }
    if (labShow) {
      const t = fmtVal(s.value)
      const tw = measureText(t, lT.font)
      if (tw <= band.step + 4) {
        const a = labelAnchor(s, y0, y1, labelH, lpos, plot)
        const fill = lcolor ?? (a.inside ? contrastText(colors[s.kind]) : lT.color)
        if (lbg) labelNodes.push(<rect key={`lb${i}`} x={x + band.bandwidth / 2 - tw / 2 - 3} y={a.y - labelH / 2} width={tw + 6} height={labelH} fill={lbgColor} opacity={lbgOp} pointerEvents="none" />)
        labelNodes.push(
          <text key={`l${i}`} x={x + band.bandwidth / 2} y={a.y} dy="0.35em" textAnchor="middle" {...fontAttrs(lT.font)} fill={fill} opacity={op} pointerEvents="none">
            {t}
          </text>
        )
      }
    }
    const lines = catLay.lines[i] ?? []
    if (lines.length) {
      const cx = x + band.bandwidth / 2
      nodes.push(
        catLay.mode === 'rotated' ? (
          <text key={`ct${i}`} transform={`translate(${cx},${top + plotH + 6}) rotate(-45)`} textAnchor="end" dy="0.35em" {...fontAttrs(catT.font)} fill={catT.color}>
            {lines[0]}
          </text>
        ) : (
          <text key={`ct${i}`} x={cx} y={top + plotH + 4} textAnchor="middle" {...fontAttrs(catT.font)} fill={catT.color}>
            {lines.map((l, li) => (
              <tspan key={li} x={cx} dy={li ? lineHeight(catT.font) : '0.95em'}>
                {l}
              </tspan>
            ))}
          </text>
        )
      )
    }
  })
  nodes.push(...refLineNodes(refLines, plot, undefined, yMap, 'front'))
  nodes.push(...labelNodes)
  if (catTitle)
    nodes.push(
      <text key="ctitle" x={px0 + plotW / 2} y={area.y + area.h - catTitleH / 2} dy="0.35em" textAnchor="middle" {...fontAttrs(catTitleT.font)} fill={catTitleT.color}>
        {ellipsize(catTitle, plotW, catTitleT.font)}
      </text>
    )
  if (valTitleOn) {
    const unit = parseNumberFormat(formatString).percent ? 1 : resolveDisplayUnit(fmt.optNum('valueAxis', 'labelDisplayUnits'), Math.max(...model.ticks.map(Math.abs), 0))
    const valTitle = axisTitleWithUnits(fmt.str('valueAxis', 'titleText', s0.measure.label), fmt.optStr('valueAxis', 'axisStyle'), unit)
    const tx = yRight ? area.x + area.w - valTitleW / 2 : area.x + valTitleW / 2
    if (valTitle)
      nodes.push(
        <text key="vtitle" transform={`translate(${tx},${top + plotH / 2}) rotate(-90)`} dy="0.35em" textAnchor="middle" {...fontAttrs(valTitleT.font)} fill={valTitleT.color}>
          {ellipsize(valTitle, plotH, valTitleT.font)}
        </text>
      )
  }
  return (
    <svg width={width} height={height} style={{ display: 'block', userSelect: 'none' }} onClick={(e) => inter.onBackgroundClick(e)} onContextMenu={(e) => inter.onContextMenu(undefined, e)}>
      {nodes}
      {lg.size ? (
        <Legend
          style={legendStyle}
          items={items}
          x={legendStyle.position.startsWith('Right') ? width - lg.size : 0}
          y={legendStyle.position.startsWith('Bottom') ? height - lg.size : 0}
          width={legendVertical ? lg.size : width}
          height={legendVertical ? height : lg.size}
        />
      ) : null}
    </svg>
  )
}
