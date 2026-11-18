/**
 * Scatter / bubble chart (PBI `scatterChart`).
 *
 * Roles: Category ("Values": one point per value; hierarchy → drill), Series (Legend), X, Y, Size,
 * Play (animation axis), Tooltips. X is formatted by `categoryAxis`, Y by `valueAxis`, markers by
 * `dataPoint` (colors, conditional fill), `bubbles` (bubbleSize, markerRangeType, markerShape),
 * `markers` (border, transparency), `fillPoint`, `colorBorder`, `colorByCategory`, labels by
 * `categoryLabels`. Analytics: x/y constant lines, min/max/average/median/percentile lines on
 * either measure, `trend` (combineSeries), `ratioLine` and `plotAreaShading` (symmetry shading).
 * Play axis: play/pause button, slider with frame ticks, the current frame as a watermark in the
 * plot's top-right corner, and trails for selected points (like PBI).
 */
import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { VisualProps } from '../../contract'
import type { Scalar } from '@core/model/data'
import { decodeValue } from '@core/report/props'
import { FormatReader, PBI, axisTitleDefaults } from '../../common/fmtProps'
import { Legend, measureLegend, readLegendStyle, type LegendItem } from '../../common/Legend'
import { computeValueAxis, valueToPx, type ValueAxisModel } from '../../common/scale'
import { ellipsize, fontAttrs, lineHeight, measureText } from '../../common/text'
import { parseNumberFormat, resolveDisplayUnit } from '../../common/units'
import { makeInteractions } from '../../common/interaction'
import { EmptyVisual, NoData, VisualError, useVisualQuery } from '../../common/VisualState'
import { ICONS } from '../icons'
import { maxLabelWidth, valueTickFormatter } from '../cartesian/axisLayout'
import { queryScatter, scatterTableOf, type ScatterData, type ScatterPoint } from './scatterQuery'
import {
  axisTitleWithUnits,
  bubbleScale,
  initialFrame,
  isStrokeShape,
  markerPath,
  markerRadius,
  nextFrame,
  normalizeShape,
  placeLabels,
  ratioSlope,
  symmetryPolygons,
  trailOf,
  trendSegment,
  type MarkerRangeType
} from './scatterModel'
import { dashFor, readReferenceLines, SCATTER_LINE_OBJECTS, DEFAULT_LINE_COLOR, type LineMeasure } from './referenceLines'
import { refLineNodes, type AxisMap } from './RefLineLayer'

/** PBI bubble fill opacity and the dimmed opacity of non-selected points. */
const BUBBLE_OPACITY = 0.85
const PLAY_INTERVAL_MS = 1100

interface AxisSpec {
  object: 'categoryAxis' | 'valueAxis'
  show: boolean
  model: ValueAxisModel
  labels: string[]
  invert: boolean
}

function gridDash(fmt: FormatReader, object: string): string | undefined {
  const style = fmt.str(object, 'gridlineStyle', 'dotted')
  if (style === 'solid') return undefined
  if (style === 'dashed') return '4 3'
  if (style === 'custom') return dashFor('custom', fmt.optStr(object, 'gridlineDashArray'))
  return '1 2'
}

function isLog(fmt: FormatReader, object: string): boolean {
  return fmt.bool(object, 'logAxisScale', false) || fmt.str(object, 'axisScale', 'linear') === 'log'
}

/** Scatter charts draw vertical gridlines by default too (also shown by the Format pane). */
export const SCATTER_X_GRIDLINES = true

export function ScatterChart({ visual, width, height, ctx }: VisualProps) {
  const json = visual.json
  const fmt = useMemo(() => new FormatReader(json, ctx.theme), [json, ctx.theme])
  const q = useVisualQuery(json, ctx, () => queryScatter(json, ctx, fmt))
  const frames = q.ok && q.data ? q.data.frames : []
  const savedFrame = fmt.optNum('currentFrameIndex', 'index')
  const [frame, setFrame] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const fi = frames.length ? Math.min(frames.length - 1, frame ?? initialFrame(frames.length, savedFrame)) : -1
  useEffect(() => {
    if (!playing || !frames.length) return
    const t = setInterval(() => {
      setFrame((f) => {
        const n = nextFrame(f ?? -1, frames.length)
        if (n < 0) {
          setPlaying(false)
          return frames.length - 1
        }
        return n
      })
    }, PLAY_INTERVAL_MS)
    return () => clearInterval(t)
  }, [playing, frames.length])

  if (!q.ok) return <VisualError error={q.error} height={height} />
  const d = q.data
  if (!d) return <EmptyVisual icon={ICONS.scatterChart} width={width} height={height} />
  if (!d.points.length) return <NoData height={height} />
  return (
    <ScatterBody
      name={visual.name}
      d={d}
      fmt={fmt}
      width={width}
      height={height}
      ctx={ctx}
      fi={fi}
      playing={playing}
      onPlay={() => {
        if (!playing && fi >= frames.length - 1) setFrame(0)
        setPlaying(!playing)
      }}
      onFrame={(i) => {
        setPlaying(false)
        setFrame(i)
      }}
    />
  )
}

function ScatterBody({ name, d, fmt, width, height, ctx, fi, playing, onPlay, onFrame }: { name: string; d: ScatterData; fmt: FormatReader; width: number; height: number; ctx: VisualProps['ctx']; fi: number; playing: boolean; onPlay(): void; onFrame(i: number): void }) {
  const inter = makeInteractions(ctx, { drillLevels: d.drillLevels })
  const frames = d.frames
  const shown = fi >= 0 ? d.points.filter((p) => p.frameIndex === fi) : d.points
  const responsive = fmt.bool('general', 'responsive', true)
  const small = responsive && (height < 160 || width < 180)

  // ---- legend
  const legendStyle = readLegendStyle(fmt, { show: !!d.seriesRef, position: 'Top', title: d.seriesRef?.label ?? '' })
  const shape = normalizeShape(fmt.raw('bubbles', 'markerShape'))
  const items: LegendItem[] = d.seriesRef
    ? d.series.map((s) => ({ key: s.key, label: s.label, color: s.color, shape: shape === 'square' ? 'square' : 'circle', dimmed: inter.hasSelection && s.scope.fields.length > 0 && !inter.isSelected(s.scope) }))
    : []
  const lg = measureLegend(legendStyle, items, width, height)
  const legendVertical = legendStyle.position.startsWith('Left') || legendStyle.position.startsWith('Right')
  const area = {
    x: legendVertical && legendStyle.position.startsWith('Left') ? lg.size : 0,
    y: !legendVertical && legendStyle.position.startsWith('Top') ? lg.size : 0,
    w: width - (legendVertical ? lg.size : 0),
    h: height - (legendVertical ? 0 : lg.size)
  }

  // ---- play axis strip
  const playH = frames.length ? 34 : 0

  // ---- axes text
  const xT = fmt.text('categoryAxis', { color: 'labelColor' }, { size: PBI.axisFontPt, color: PBI.labelColor })
  const yT = fmt.text('valueAxis', { color: 'labelColor' }, { size: PBI.axisFontPt, color: PBI.labelColor })
  const tdef = axisTitleDefaults(fmt)
  const xTitleT = fmt.text('categoryAxis', { size: 'titleFontSize', family: 'titleFontFamily', color: 'titleColor', bold: 'titleBold', italic: 'titleItalic' }, tdef)
  const yTitleT = fmt.text('valueAxis', { size: 'titleFontSize', family: 'titleFontFamily', color: 'titleColor', bold: 'titleBold', italic: 'titleItalic' }, tdef)
  const xShow = fmt.bool('categoryAxis', 'show', true)
  const yShow = fmt.bool('valueAxis', 'show', true)
  const yRight = fmt.bool('valueAxis', 'switchAxisPosition', false) || fmt.str('valueAxis', 'position', 'Left') === 'Right'

  // domains over all frames so axes stay fixed while playing
  const xs = d.points.map((p) => p.x)
  const ys = d.points.map((p) => p.y)
  const pad = 8
  const xLabelH = xShow ? lineHeight(xT.font) + 6 : 0
  const xTitleOn = !small && xShow && fmt.bool('categoryAxis', 'showAxisTitle', true)
  const yTitleOn = !small && yShow && fmt.bool('valueAxis', 'showAxisTitle', true)
  const xTitleH = xTitleOn ? lineHeight(xTitleT.font) + 2 : 0
  const yTitleW = yTitleOn ? lineHeight(yTitleT.font) + 2 : 0
  const plotTop = area.y + pad
  const plotH = Math.max(10, area.h - pad - xLabelH - xTitleH - playH)
  const mkAxis = (object: 'categoryAxis' | 'valueAxis', values: number[], length: number, spacing: number, formatString: string | undefined): AxisSpec => {
    const model = computeValueAxis({
      dataMin: Math.min(...values),
      dataMax: Math.max(...values),
      includeZero: false,
      start: fmt.optNum(object, 'start'),
      end: fmt.optNum(object, 'end'),
      scale: isLog(fmt, object) ? 'log' : 'linear',
      length,
      tickSpacing: spacing
    })
    const labels = model.ticks.map(valueTickFormatter(model, { displayUnits: fmt.optNum(object, 'labelDisplayUnits'), precision: fmt.optNum(object, 'labelPrecision'), formatString, format: ctx.format }))
    return { object, show: object === 'categoryAxis' ? xShow : yShow, model, labels, invert: fmt.bool(object, 'invertAxis', false) }
  }
  const yAxis = mkAxis('valueAxis', ys, plotH, 50, d.yRef?.formatString)
  const yLabelW = yShow ? maxLabelWidth(yAxis.labels, yT.font) + 8 : 0
  const sideW = yLabelW + yTitleW + 4
  const plotX = area.x + (yRight ? 12 : sideW)
  const plotW = Math.max(10, area.w - sideW - 12)
  const xAxis = mkAxis('categoryAxis', xs, plotW, 80, d.xRef?.formatString)
  const plot = { x: plotX, y: plotTop, w: plotW, h: plotH }

  // bubble sizes (computed over every frame so a bubble keeps its scale while playing)
  const bubbleSize = fmt.num('bubbles', 'bubbleSize', -10)
  const rangeType = fmt.str('bubbles', 'markerRangeType', 'auto') as MarkerRangeType
  const radius = d.sizeRef ? bubbleScale(d.points.map((p) => p.size), { plotW: plot.w, plotH: plot.h, bubbleSize, rangeType }) : () => markerRadius(bubbleSize)
  const maxR = Math.max(...d.points.map((p) => radius(p.size)))
  const inset = fmt.bool('bubbles', 'preventOverflow', false) ? maxR : 0
  const vx = valueToPx(xAxis.model, Math.max(1, plot.w - 2 * inset), xAxis.invert)
  const vy = valueToPx(yAxis.model, Math.max(1, plot.h - 2 * inset), !yAxis.invert)
  const px = (x: number) => plot.x + inset + vx(x)
  const py = (y: number) => plot.y + inset + vy(y)
  const xMap: AxisMap = { toPx: px, domain: xAxis.model.domain }
  const yMap: AxisMap = { toPx: py, domain: yAxis.model.domain }

  const nodes: ReactNode[] = []
  const clipId = `sc-clip-${name.replace(/[^\w-]/g, '_')}`

  // ---- plot area background
  const plotColor = fmt.optStr('plotArea', 'color')
  if (plotColor) nodes.push(<rect key="plotbg" x={plot.x} y={plot.y} width={plot.w} height={plot.h} fill={plotColor} opacity={1 - fmt.num('plotArea', 'transparency', 0) / 100} />)

  // ---- symmetry shading (analytics)
  const back: ReactNode[] = []
  if (fmt.bool('plotAreaShading', 'show', false)) {
    const op = 1 - fmt.num('plotAreaShading', 'transparency', 66) / 100
    const polys = symmetryPolygons(xAxis.model.domain, yAxis.model.domain)
    const toPath = (pts: Array<[number, number]>) => 'M' + pts.map(([a, b]) => `${px(a).toFixed(1)},${py(b).toFixed(1)}`).join('L') + 'Z'
    // approximation: PBI's default shading colors are not documented; theme good / bad sentiment colors are used
    back.push(<path key="shadeU" d={toPath(polys.upper)} fill={fmt.color('plotAreaShading', 'upperShadingColor', ctx.theme.good)} opacity={op} />)
    back.push(<path key="shadeL" d={toPath(polys.lower)} fill={fmt.color('plotAreaShading', 'lowerShadingColor', ctx.theme.bad)} opacity={op} />)
  }

  // ---- gridlines + tick labels
  const gridOf = (object: string, defShow: boolean) => ({
    show: fmt.bool(object, 'gridlineShow', defShow),
    color: fmt.color(object, 'gridlineColor', PBI.gridColor),
    width: fmt.num(object, 'gridlineThickness', 1),
    opacity: 1 - fmt.num(object, 'gridlineTransparency', 0) / 100,
    dash: gridDash(fmt, object)
  })
  const gy = gridOf('valueAxis', true)
  const gx = gridOf('categoryAxis', SCATTER_X_GRIDLINES)
  yAxis.model.ticks.forEach((t, i) => {
    const y = Math.round(py(t)) + 0.5
    if (gy.show) nodes.push(<line key={`gy${i}`} x1={plot.x} x2={plot.x + plot.w} y1={y} y2={y} stroke={gy.color} strokeWidth={gy.width} strokeOpacity={gy.opacity} strokeDasharray={gy.dash} />)
    if (yShow)
      nodes.push(
        <text key={`ty${i}`} x={yRight ? plot.x + plot.w + 6 : plot.x - 6} y={y} dy="0.35em" textAnchor={yRight ? 'start' : 'end'} {...fontAttrs(yT.font)} fill={yT.color}>
          {yAxis.labels[i]}
        </text>
      )
  })
  xAxis.model.ticks.forEach((t, i) => {
    const x = Math.round(px(t)) + 0.5
    if (gx.show) nodes.push(<line key={`gx${i}`} x1={x} x2={x} y1={plot.y} y2={plot.y + plot.h} stroke={gx.color} strokeWidth={gx.width} strokeOpacity={gx.opacity} strokeDasharray={gx.dash} />)
    if (xShow)
      nodes.push(
        <text key={`tx${i}`} x={x} y={plot.y + plot.h + 4} dy="0.9em" textAnchor="middle" {...fontAttrs(xT.font)} fill={xT.color}>
          {xAxis.labels[i]}
        </text>
      )
  })

  // ---- analytics lines
  const measures: LineMeasure[] = [
    ...(d.yRef ? [{ queryRef: d.yRef.proj.queryRef, axis: 'y' as const, values: shown.map((p) => p.y), formatString: d.yRef.formatString }] : []),
    ...(d.xRef ? [{ queryRef: d.xRef.proj.queryRef, axis: 'x' as const, values: shown.map((p) => p.x), formatString: d.xRef.formatString }] : [])
  ]
  const refLines = readReferenceLines(fmt, SCATTER_LINE_OBJECTS, measures, ctx.format)
  back.push(...refLineNodes(refLines, plot, xMap, yMap, 'back'))
  const lines: ReactNode[] = []
  // ratio line: y = (Σy / Σx)·x through the origin
  for (const e of fmt.pc.objects?.ratioLine ?? []) {
    if (decodeValue(e.properties?.show, fmt.theme) !== true) continue
    const k = ratioSlope(shown)
    if (k === null) continue
    const color = (decodeValue(e.properties?.lineColor, fmt.theme) as string) ?? DEFAULT_LINE_COLOR
    const tr = Number(decodeValue(e.properties?.transparency, fmt.theme) ?? 0)
    const [x0, x1] = xAxis.model.domain
    const n = 32
    const pts = Array.from({ length: n + 1 }, (_, i) => x0 + ((x1 - x0) * i) / n).map((x) => `${px(x).toFixed(1)},${py(k * x).toFixed(1)}`)
    lines.push(<path key={`ratio${lines.length}`} d={'M' + pts.join('L')} fill="none" stroke={color} strokeOpacity={1 - tr / 100} strokeWidth={Number(decodeValue(e.properties?.width, fmt.theme) ?? 1)} strokeDasharray={dashFor(String(decodeValue(e.properties?.style, fmt.theme) ?? 'dashed'), decodeValue(e.properties?.dashArray, fmt.theme))} />)
  }
  // trend line(s)
  for (const e of fmt.pc.objects?.trend ?? []) {
    if (decodeValue(e.properties?.show, fmt.theme) !== true) continue
    const combine = decodeValue(e.properties?.combineSeries, fmt.theme) !== false
    const color = decodeValue(e.properties?.lineColor, fmt.theme) as string | undefined
    const tr = Number(decodeValue(e.properties?.transparency, fmt.theme) ?? 0)
    const style = String(decodeValue(e.properties?.style, fmt.theme) ?? 'dashed')
    const groups = combine || !d.seriesRef ? [{ key: '', pts: shown, color: color ?? DEFAULT_LINE_COLOR }] : d.series.map((s) => ({ key: s.key, pts: shown.filter((p) => p.seriesKey === s.key), color: color ?? s.color }))
    for (const g of groups) {
      const seg = trendSegment(g.pts, xAxis.model.domain)
      if (!seg) continue
      const n = 32
      const pts = Array.from({ length: n + 1 }, (_, i) => seg.x0 + ((seg.x1 - seg.x0) * i) / n).map((x) => `${px(x).toFixed(1)},${py(seg.intercept + seg.slope * x).toFixed(1)}`)
      lines.push(<path key={`trend${g.key}`} d={'M' + pts.join('L')} fill="none" stroke={g.color} strokeOpacity={1 - tr / 100} strokeWidth={Number(decodeValue(e.properties?.width, fmt.theme) ?? 2)} strokeDasharray={dashFor(style, decodeValue(e.properties?.dashArray, fmt.theme))} />)
    }
  }

  // ---- markers
  const fillStyle = fmt.optStr('fillPoint', 'style')
  const fillPoint = fillStyle ? fillStyle !== 'Border only' : fmt.bool('fillPoint', 'show', true)
  const colorBorder = fmt.bool('colorBorder', 'show', false)
  const markerTransp = fmt.optNum('markers', 'transparency')
  const borderShow = fmt.bool('markers', 'borderShow', false)
  const borderColorMatch = fmt.bool('markers', 'borderColorMatchFill', true)
  const borderColor = fmt.optStr('markers', 'borderColor')
  const borderWidth = fmt.num('markers', 'borderWidth', 1)
  const opacityBase = markerTransp !== undefined ? 1 - markerTransp / 100 : d.sizeRef ? BUBBLE_OPACITY : 1
  const marks: ReactNode[] = []
  const sorted = [...shown].sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
  const pointOpacity = (p: ScatterPoint) => (d.hasHighlights ? (p.highlighted ? 1 : PBI.dimOpacity) : inter.opacityFor(p.identity))

  // trails of selected points (play axis)
  if (frames.length && inter.hasSelection) {
    const selected = new Set(shown.filter((p) => inter.isSelected(p.identity)).map((p) => p.idKey))
    const trailFont = { ...xT.font, size: Math.max(9, xT.font.size - 1) }
    for (const idKey of selected) {
      const trail = trailOf(
        d.points.filter((p) => p.idKey === idKey),
        fi
      )
      if (trail.length < 2) continue
      const color = shown.find((p) => p.idKey === idKey)?.color ?? PBI.labelColor
      marks.push(<path key={`trail${idKey}`} d={'M' + trail.map((t) => `${px(t.x).toFixed(1)},${py(t.y).toFixed(1)}`).join('L')} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.8} pointerEvents="none" />)
      const past = trail.slice(0, -1)
      past.forEach((t) => marks.push(<circle key={`trail${idKey}|${t.frame}`} cx={px(t.x)} cy={py(t.y)} r={3} fill={color} opacity={0.6} pointerEvents="none" />))
      // frame labels next to the trail points, skipping the ones that would overlap (earliest frames win)
      const th = lineHeight(trailFont)
      const placedT = placeLabels(
        past.map((t) => ({ x: px(t.x), y: py(t.y), r: 3, width: measureText(frames[t.frame], trailFont), height: th })),
        { x: plot.x, y: plot.y, w: plot.w, h: plot.h }
      )
      for (const pl of placedT)
        marks.push(
          <text key={`traillabel${idKey}|${past[pl.index].frame}`} x={pl.x} y={pl.y} dy="0.35em" textAnchor="middle" {...fontAttrs(trailFont)} fill={PBI.labelColor} pointerEvents="none">
            {frames[past[pl.index].frame]}
          </text>
        )
    }
  }

  for (const p of sorted) {
    const r = radius(p.size)
    const c = p.color
    const strokeOnly = isStrokeShape(shape)
    const filled = fillPoint && !strokeOnly
    const stroke = strokeOnly || !filled ? c : borderShow ? (borderColorMatch ? c : (borderColor ?? c)) : colorBorder ? darken(c) : d.sizeRef ? '#FFFFFF' : 'none'
    const sw = strokeOnly ? 2 : !filled ? 1.5 : borderShow ? borderWidth : colorBorder ? 1 : 0.5
    marks.push(
      <path
        key={p.key}
        d={markerPath(shape, r)}
        fill={filled ? c : strokeOnly ? 'none' : '#FFFFFF'}
        fillOpacity={filled ? opacityBase : 1}
        stroke={stroke}
        strokeWidth={sw}
        opacity={pointOpacity(p)}
        style={{ cursor: 'pointer', transform: `translate(${px(p.x).toFixed(2)}px, ${py(p.y).toFixed(2)}px)`, transition: frames.length ? 'transform 0.8s ease-in-out' : undefined }}
        onClick={(e: ReactMouseEvent) => (p.identity.fields.length ? inter.onPointClick(p.identity, e, { categoryOnly: p.catIdentity }) : e.stopPropagation())}
        onContextMenu={(e) => inter.onContextMenu(p.identity, e)}
        onMouseMove={(e) => inter.showTooltip(e, p.tips, p.identity)}
        onMouseLeave={() => inter.hideTooltip()}
      />
    )
  }

  // ---- category labels (collision-free placement)
  const labelNodes: ReactNode[] = []
  if (fmt.bool('categoryLabels', 'show', false)) {
    const clT = fmt.text('categoryLabels', {}, { size: PBI.dataLabelFontPt, color: PBI.labelColor })
    const lh = lineHeight(clT.font)
    const bg = fmt.bool('categoryLabels', 'enableBackground', fmt.bool('categoryLabels', 'showBackground', false))
    const bgColor = fmt.color('categoryLabels', 'backgroundColor', '#FFFFFF')
    const bgOp = 1 - fmt.num('categoryLabels', 'backgroundTransparency', fmt.num('categoryLabels', 'transparency', 90)) / 100
    const cand = shown.filter((p) => p.label)
    const texts = cand.map((p) => ellipsize(p.label, Math.max(40, plot.w * 0.5), clT.font))
    const placed = placeLabels(
      cand.map((p, i) => ({ x: px(p.x), y: py(p.y), r: radius(p.size), width: measureText(texts[i], clT.font) + (bg ? 6 : 0), height: lh })),
      { x: plot.x - 4, y: plot.y - 4, w: plot.w + 8, h: plot.h + 8 }
    )
    for (const pl of placed) {
      const p = cand[pl.index]
      const w = measureText(texts[pl.index], clT.font)
      if (bg) labelNodes.push(<rect key={`lb${p.key}`} x={pl.x - w / 2 - 3} y={pl.y - lh / 2} width={w + 6} height={lh} fill={bgColor} opacity={bgOp} pointerEvents="none" />)
      labelNodes.push(
        <text key={`l${p.key}`} x={pl.x} y={pl.y} dy="0.35em" textAnchor="middle" {...fontAttrs(clT.font)} fill={clT.color} opacity={pointOpacity(p)} pointerEvents="none">
          {texts[pl.index]}
        </text>
      )
    }
  }

  // ---- axis titles
  // log axes label each decade with its own unit, so the title gets no unit
  const unitOf = (ax: AxisSpec, formatString?: string) => (parseNumberFormat(formatString).percent || ax.model.scale === 'log' ? 1 : resolveDisplayUnit(fmt.optNum(ax.object, 'labelDisplayUnits'), Math.max(...ax.model.ticks.map(Math.abs), 0)))
  const xTitle = xTitleOn ? axisTitleWithUnits(fmt.str('categoryAxis', 'titleText', d.xRef?.label ?? ''), fmt.optStr('categoryAxis', 'axisStyle'), unitOf(xAxis, d.xRef?.formatString)) : ''
  const yTitle = yTitleOn ? axisTitleWithUnits(fmt.str('valueAxis', 'titleText', d.yRef?.label ?? ''), fmt.optStr('valueAxis', 'axisStyle'), unitOf(yAxis, d.yRef?.formatString)) : ''
  if (xTitle)
    nodes.push(
      <text key="xt" x={plot.x + plot.w / 2} y={plot.y + plot.h + xLabelH + xTitleH / 2} dy="0.35em" textAnchor="middle" {...fontAttrs(xTitleT.font)} fill={xTitleT.color}>
        {ellipsize(xTitle, plot.w, xTitleT.font)}
      </text>
    )
  if (yTitle) {
    const tx = yRight ? area.x + area.w - yTitleW / 2 : area.x + yTitleW / 2
    nodes.push(
      <text key="yt" transform={`translate(${tx},${plot.y + plot.h / 2}) rotate(-90)`} dy="0.35em" textAnchor="middle" {...fontAttrs(yTitleT.font)} fill={yTitleT.color}>
        {ellipsize(yTitle, plot.h, yTitleT.font)}
      </text>
    )
  }

  // ---- play axis: watermark + controls
  const play: ReactNode[] = []
  if (frames.length && fi >= 0) {
    const wmSize = Math.max(14, Math.min(40, plot.h * 0.12))
    const wmFont = { size: wmSize, family: 'Segoe UI', weight: 300 }
    play.push(
      <text key="watermark" x={plot.x + plot.w - 6} y={plot.y + 4} dy="0.85em" textAnchor="end" {...fontAttrs(wmFont)} fill="#A19F9D" opacity={0.75} pointerEvents="none">
        {ellipsize(frames[fi], plot.w * 0.6, wmFont)}
      </text>
    )
    const cy = area.y + area.h - playH / 2 - 2
    const bx = area.x + 16
    const x0 = bx + 22
    const x1 = area.x + area.w - 12
    const fx = (i: number) => x0 + (frames.length > 1 ? (i / (frames.length - 1)) * (x1 - x0) : 0)
    const tickFont = { ...xT.font, size: Math.max(9, xT.font.size - 1) }
    const every = Math.max(1, Math.ceil((frames.reduce((m, f) => Math.max(m, measureText(f, tickFont)), 0) + 8) / Math.max(1, (x1 - x0) / Math.max(1, frames.length - 1))))
    play.push(
      <g key="play">
        <g
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation()
            onPlay()
          }}
        >
          <title>{playing ? 'Pause' : 'Play'}</title>
          <circle cx={bx} cy={cy} r={11} fill="#FFFFFF" stroke="#8A8886" />
          {playing ? <path d={`M${bx - 3.5},${cy - 4.5}v9M${bx + 3.5},${cy - 4.5}v9`} stroke="#252423" strokeWidth={2.2} /> : <path d={`M${bx - 3},${cy - 5.5}L${bx + 5.5},${cy}L${bx - 3},${cy + 5.5}Z`} fill="#252423" />}
        </g>
        <line x1={x0} x2={x1} y1={cy - 4} y2={cy - 4} stroke="#C8C6C4" strokeWidth={2} />
        <line x1={x0} x2={fx(fi)} y1={cy - 4} y2={cy - 4} stroke="#605E5C" strokeWidth={2} />
        {frames.map((f, i) => (
          <g
            key={`f${i}`}
            style={{ cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation()
              onFrame(i)
            }}
          >
            <title>{f}</title>
            <rect x={fx(i) - 5} y={cy - 12} width={10} height={16} fill="transparent" />
            <line x1={fx(i)} x2={fx(i)} y1={cy - 7} y2={cy - 1} stroke="#A19F9D" />
            {i % every === 0 || i === frames.length - 1 ? (
              <text x={fx(i)} y={cy + 3} dy="0.9em" textAnchor={fx(i) + measureText(f, tickFont) / 2 > area.x + area.w ? 'end' : 'middle'} {...fontAttrs(tickFont)} fill={PBI.labelColor}>
                {i % every === 0 ? f : ''}
              </text>
            ) : null}
          </g>
        ))}
        <circle cx={fx(fi)} cy={cy - 4} r={6} fill="#FFFFFF" stroke="#252423" strokeWidth={1.5} style={{ transition: playing ? `cx ${PLAY_INTERVAL_MS / 1000}s linear` : undefined }} pointerEvents="none" />
      </g>
    )
  }

  return (
    <svg width={width} height={height} style={{ display: 'block', userSelect: 'none' }} onClick={(e) => inter.onBackgroundClick(e)} onContextMenu={(e) => inter.onContextMenu(undefined, e)}>
      <defs>
        <clipPath id={clipId}>
          <rect x={plot.x} y={plot.y} width={plot.w} height={plot.h} />
        </clipPath>
      </defs>
      {nodes}
      <g clipPath={`url(#${clipId})`}>{back}</g>
      {play.slice(0, 1)}
      <g clipPath={`url(#${clipId})`}>{lines}</g>
      {marks}
      <g clipPath={`url(#${clipId})`}>{refLineNodes(refLines, plot, xMap, yMap, 'front')}</g>
      {labelNodes}
      {play.slice(1)}
      {lg.size ? (
        <Legend
          style={legendStyle}
          items={items}
          x={legendStyle.position.startsWith('Right') ? width - lg.size : 0}
          y={legendStyle.position.startsWith('Bottom') ? height - lg.size : 0}
          width={legendVertical ? lg.size : width}
          height={legendVertical ? height : lg.size}
          onItemClick={(key, e) => {
            const s = d.series.find((x) => x.key === key)
            if (s?.scope.fields.length) inter.onPointClick(s.scope, e, { drillable: false })
          }}
        />
      ) : null}
    </svg>
  )
}

/** Darker border for `colorBorder` (PBI draws the bubble outline a shade darker than its fill). */
function darken(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex
  const n = parseInt(hex.slice(1), 16)
  const f = (c: number) => Math.round(c * 0.7)
  const r = f((n >> 16) & 255)
  const g = f((n >> 8) & 255)
  const b = f(n & 255)
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
}

/** Rows for "Show as table" / export. */
export function scatterTable(json: any, ctx: VisualProps['ctx']): { columns: string[]; rows: Scalar[][] } | undefined {
  const fmt = new FormatReader(json, ctx.theme)
  const d = queryScatter(json, ctx, fmt)
  return d ? scatterTableOf(d) : undefined
}

