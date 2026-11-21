/**
 * Cartesian chart renderer shared by column / bar (clustered, stacked, 100%), line, area
 * (overlapping, stacked, 100%), line+column combos and the ribbon chart.
 *
 * Layout follows Power BI: legend → axis titles → value-axis label margins → category labels
 * (single line, wrapped, or rotated 45° with skipping) → plot. When categories would be narrower
 * than "minimum category width" the plot scrolls (custom PBI-like scrollbar, wheel scrolling).
 */
import { useMemo, useRef, useState, type ComponentType, type MouseEvent as ReactMouseEvent, type ReactNode, type WheelEvent } from 'react'
import { area as d3area, curveCardinal, curveLinear, curveMonotoneX, curveStep, curveStepAfter, curveStepBefore, line as d3line } from 'd3-shape'
import { scaleLinear } from 'd3-scale'
import type { VisualProps } from '../../contract'
import { buildCategorical, pointIdentity, type CategoricalData, type Series } from '../../common/categorical'
import { FormatReader, PBI, axisTitleDefaults, labelDerivedClass } from '../../common/fmtProps'
import { Legend, measureLegend, readLegendStyle, isVertical, type LegendItem } from '../../common/Legend'
import { alignZeroAxes, bandLayout, computeValueAxis, continuousTicks, snapFloat, stackValues, valueToPx, type ValueAxisModel } from '../../common/scale'
import { ellipsize, fontAttrs, lineHeight, measureText, ptToPx, type FontSpec } from '../../common/text'
import { contrastText, rgba } from '../../common/color'
import { formatWithUnits, resolveDisplayUnit, formatDate } from '../../common/units'
import { makeInteractions } from '../../common/interaction'
import { pointTooltip } from '../../common/tooltip'
import { EmptyVisual, NoData, VisualError, useVisualQuery } from '../../common/VisualState'
import { joinTitles, layoutBarLabels, layoutCategoryLabels, maxLabelWidth, valueTickFormatter } from './axisLayout'
import { computeAnalytics, type AnalyticsLine } from './analytics'
import { SmallMultiples } from './SmallMultiples'
import { ZoomSlider } from './ZoomSlider'
import { categoryZoomProps, readSavedZoom, savedCategoryWindow, savedValueWindow, valueZoomProps, writeZoom } from './zoomPersist'
import { readSeriesLabels, spreadLabels } from './seriesLabels'
import { lineLabelSides, type LinePlacement } from './lineLabelPosition'
import { readErrorBars, errorBounds, errorSpecFor, errorTooltip, type ErrorBarSpec } from './errorBars'
import { decodeValue } from '@core/report/props'
import { colorAt, type GradientFill } from '@core/report/gradientFill'
import { SvgGradientDefs, svgPaintRef, type SvgPaint } from '../../common/svgPaint'
import { detectAnomalies } from './anomaly'
import { forecastSeries, readForecastSpecs, FORECAST_DEFAULT_COLOR, type SeriesForecast } from './forecast'

/**
 * Default data-label position of bars (also shown by the Format pane): inside center when stacked, else Auto.
 * A stacked chart drawing a single bar series (no legend field, one measure) labels its bars like a clustered chart:
 * Auto, outside the end of the bar when there is room, inside the end otherwise. Inferred from Power BI Desktop
 * renders (two single-series stacked bar charts with no stored position; not documented).
 */
export const barLabelPositionDefault = (stacking: CartesianConfig['stacking'], barSeriesCount = 2): string =>
  stacking === 'clustered' || (stacking === 'stacked' && barSeriesCount === 1) ? 'Auto' : 'InsideCenter'
/** Default data-label position of lines / areas: above the point (see lineLabelPosition.ts). */
export const LINE_LABEL_POSITION_DEFAULT = 'Above'

export type SeriesKind = 'bar' | 'line' | 'area'

export interface CartesianConfig {
  orientation: 'vertical' | 'horizontal'
  /** stacking of bar series (and of area series for stacked/100% area charts) */
  stacking: 'clustered' | 'stacked' | 'percent'
  kindOf(role: string): SeriesKind
  /** measure roles split by the legend */
  splitRoles: string[]
  /** measure roles not split by the legend (combo line values) */
  unsplitRoles?: string[]
  /** roles drawn against the secondary value axis (when valueAxis.secShow) */
  secondaryRoles?: string[]
  ribbon?: boolean
  defaultSort: 'measureDesc' | 'categoryAsc'
  icon: string
  maxCategories?: number
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const DASH: Record<string, string | undefined> = { dotted: '1 2', dashed: '4 3', solid: undefined }

/** Options when rendering one panel of a small-multiples grid. */
export interface PanelOptions {
  key: string
  data: CategoricalData
  /** shared primary value range across panels */
  domain?: [number, number]
  hideLegend?: boolean
  hideTitles?: boolean
  /** small multiples: value axis drawn only on the first column, category axis only on the last row */
  hideValueAxis?: boolean
  hideCategoryAxis?: boolean
  /**
   * Forced plot margins (px from the panel edges). Small multiples measure every panel's natural
   * margins first and then give all panels the same plot geometry, so plots line up even when one
   * row's category labels rotate or one column's value labels are wider.
   */
  margins?: { left: number; top: number; right: number; bottom: number }
  /** px the category labels may extend below the panel (panel above an empty grid cell) */
  overflowBottom?: number
}

export { categoricalOptions }

export function makeCartesianComponent(config: CartesianConfig): ComponentType<VisualProps> {
  function Cartesian(props: VisualProps) {
    const hasSM = ((props.visual.json?.visual?.query?.queryState?.Rows?.projections ?? []) as any[]).length > 0
    if (hasSM) return <SmallMultiples {...props} config={config} />
    return <CartesianChart {...props} config={config} />
  }
  return Cartesian
}

export function CartesianChart({ visual, width, height, ctx, config, panel }: VisualProps & { config: CartesianConfig; panel?: PanelOptions }) {
  const json = visual.json
  const fmt = useMemo(() => new FormatReader(json, ctx.theme), [json, ctx.theme])
  // categoryAxis.initialScrollPosition = 'end' starts a scrolling axis at its last category
  const [scroll, setScroll] = useState(() => (fmt.str('categoryAxis', 'initialScrollPosition', 'start') === 'end' ? 1e12 : 0))
  const [hover, setHover] = useState<{ ci: number; si: number } | null>(null)
  const [zoom, setZoom] = useState<ZoomState>({})
  const dragRef = useRef<{ start: number; scroll: number } | null>(null)
  const errorSpecs = useMemo(() => readErrorBars(fmt), [fmt])
  const q = useVisualQuery(json, ctx, () =>
    panel?.data ??
    buildCategorical(json, ctx, categoricalOptions(config, fmt, errorSpecs)),
    panel ? `panel:${panel.key}:${panel.domain?.join(',')}:${panel.data.categories.length}` : ''
  )
  const layout = useMemo(() => (q.ok ? computeLayout(q.data, fmt, config, width, height, ctx.format, panel, zoom, errorSpecs) : null), [q, fmt, width, height, ctx.format, panel, zoom, errorSpecs])

  if (!q.ok) return <VisualError error={q.error} height={height} />
  const data = q.data
  const hasMeasures = data.series.length > 0 || hasRole(json, config.splitRoles) || hasRole(json, config.unsplitRoles ?? [])
  if (!hasMeasures && !data.levels.length) return <EmptyVisual icon={config.icon} width={width} height={height} />
  if (!layout) return null
  if (!data.categories.length || !data.series.length) {
    if (!hasMeasures) return <EmptyVisual icon={config.icon} width={width} height={height} />
    return <NoData height={height} />
  }

  const L = layout
  const inter = makeInteractions(ctx, { drillLevels: data.allLevels.length })
  const maxScroll = Math.max(0, L.contentLen - L.viewLen)
  const sc = L.zoomCat ? Math.min(maxScroll, L.zoomWin.c[0] * L.contentLen) : Math.min(scroll, maxScroll)
  const vertical = config.orientation === 'vertical'
  const catPx = (c: number) => (vertical ? L.plot.x + c - sc : L.plot.y + c - sc)
  const xy = (c: number, v: number): [number, number] => (vertical ? [catPx(c), v] : [v, catPx(c)])

  const onWheel = (e: WheelEvent) => {
    if (maxScroll <= 0 || L.zoomCat) return
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    setScroll((s) => Math.max(0, Math.min(maxScroll, s + d)))
  }

  // ---------------- plot elements
  // unique per visual AND per small-multiples panel (duplicate ids make every panel use the first clip)
  const clipId = `wbi-clip-${visual.name}-${panel?.key ?? ''}`.replace(/[^a-zA-Z0-9_-]/g, '_')
  const elems: ReactNode[] = []
  const labelNodes: ReactNode[] = []
  const placed: Rect[] = []
  const tryPlace = (r: Rect): boolean => {
    if (placed.length < 600 && placed.some((p) => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y)) return false
    placed.push(r)
    return true
  }

  const hl = data.hasHighlights
  // bars (Lumen gradient fills: one definition per distinct gradient, see common/svgPaint.tsx)
  const barPaints = new Map<string, SvgPaint>()
  const barPaint = (gradient: GradientFill): string => {
    const p = { gradient }
    const ref = svgPaintRef(p)
    barPaints.set(ref, p)
    return ref
  }
  const viewLo = (vertical ? L.plot.x : L.plot.y) - L.catStep * 2
  const viewHi = (vertical ? L.plot.x + L.plot.w : L.plot.y + L.plot.h) + L.catStep * 2
  for (const b of L.bars) {
    // virtualization: bars scrolled out of view aren't rendered
    if (maxScroll > 0) {
      const mid = catPx((b.c0 + b.c1) / 2)
      if (mid < viewLo || mid > viewHi) continue
    }
    const s = data.series[b.si]
    const cat = data.categories[b.ci]
    const id = pointIdentity(cat, s.split ? s : undefined)
    const grad = s.pointColors?.[b.ci] !== undefined ? s.pointGradients?.[b.ci] : s.gradient
    const color = grad ? barPaint(grad) : (s.pointColors?.[b.ci] ?? s.color)
    const [x0, y0] = xy(b.c0, b.v0)
    const [x1, y1] = xy(b.c1, b.v1)
    const r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
    const op = inter.opacityFor(id)
    const handlers = {
      onClick: (e: ReactMouseEvent) => inter.onPointClick(id, e, { categoryOnly: pointIdentity(cat, undefined) }),
      onContextMenu: (e: ReactMouseEvent) => inter.onContextMenu(id, e),
      onMouseMove: (e: ReactMouseEvent) => inter.showTooltip(e, pointTooltip(ctx, data, b.ci, s), id),
      onMouseLeave: () => inter.hideTooltip()
    }
    if (hl && b.hv0 !== undefined && b.hv1 !== undefined) {
      const [hx0, hy0] = xy(b.c0, b.hv0)
      const [hx1, hy1] = xy(b.c1, b.hv1)
      elems.push(
        <g key={`b${b.si}-${b.ci}`} {...handlers} style={{ cursor: 'pointer' }}>
          <rect x={r.x} y={r.y} width={Math.max(0, r.w)} height={Math.max(0, r.h)} fill={color} opacity={PBI.highlightBackOpacity} />
          <rect x={Math.min(hx0, hx1)} y={Math.min(hy0, hy1)} width={Math.abs(hx1 - hx0)} height={Math.abs(hy1 - hy0)} fill={color} />
        </g>
      )
    } else {
      elems.push(<rect key={`b${b.si}-${b.ci}`} x={r.x} y={r.y} width={Math.max(0, r.w)} height={Math.max(0, r.h)} fill={color} opacity={hl ? PBI.highlightBackOpacity : op} style={{ cursor: 'pointer' }} {...handlers} />)
    }
    // data label
    const ls = L.labelStyleFor(s)
    if (ls.show && s.values[b.ci] !== null) {
      const text = ls.format(s.values[b.ci] as number, s.formats[b.ci])
      const tw = measureText(text, ls.font)
      const th = lineHeight(ls.font)
      const pos = b.labelPos
      const along = vertical ? r.h : r.w
      const across = vertical ? r.w : r.h
      const need = vertical ? th : tw + 6
      const neg = b.value < 0
      let lx: number
      let ly: number
      let inside = true
      let p = pos
      if (p === 'Auto') {
        const room = vertical ? (neg ? L.plot.y + L.plot.h - r.y - r.h : r.y - L.plot.y) : neg ? r.x - L.plot.x : L.plot.x + L.plot.w - (r.x + r.w)
        const insideOk = vertical ? tw <= r.w + 2 && r.h >= th + 4 : r.w >= tw + 6
        // PBI auto: outside end when there is room, otherwise inside end; text wider than the
        // column goes above it if at least a line of space is left (PBI lets it overflow the plot top)
        p = room >= need + 2 || (!insideOk && room >= need / 2) ? 'OutsideEnd' : 'InsideEnd'
      }
      if (p === 'OutsideEnd' && L.stacked && !L.soleStack) p = 'InsideEnd'
      if (vertical) {
        lx = r.x + r.w / 2
        if (p === 'OutsideEnd') {
          ly = neg ? r.y + r.h + th / 2 + 2 : r.y - th / 2 - 2
          inside = false
        } else if (p === 'InsideBase') ly = neg ? r.y + th / 2 + 2 : r.y + r.h - th / 2 - 2
        else if (p === 'InsideCenter') ly = r.y + r.h / 2
        else ly = neg ? r.y + r.h - th / 2 - 2 : r.y + th / 2 + 2
      } else {
        ly = r.y + r.h / 2
        if (p === 'OutsideEnd') {
          lx = neg ? r.x - tw / 2 - 4 : r.x + r.w + tw / 2 + 4
          inside = false
        } else if (p === 'InsideBase') lx = neg ? r.x + r.w - tw / 2 - 3 : r.x + tw / 2 + 3
        else if (p === 'InsideCenter') lx = r.x + r.w / 2
        else lx = neg ? r.x + tw / 2 + 3 : r.x + r.w - tw / 2 - 3
      }
      const fits = !inside || (along >= need && (vertical ? tw <= across + 2 : across >= th - 2))
      // a label wider than its column must stay inside the (scrolling) plot window
      if (maxScroll > 0 && vertical) lx = Math.max(L.plot.x + tw / 2 + 1, Math.min(L.plot.x + L.plot.w - tw / 2 - 1, lx))
      const box = { x: lx - tw / 2 - 1, y: ly - th / 2, w: tw + 2, h: th }
      const visible = vertical ? lx > L.plot.x - 1 && lx < L.plot.x + L.plot.w + 1 : ly > L.plot.y - 1 && ly < L.plot.y + L.plot.h + 1
      if (fits && visible && tryPlace(box)) {
        const fill = s.cfColors?.['labels.color']?.[b.ci] ?? ls.color ?? (inside ? contrastText(grad ? colorAt(grad, 0.5) : color) : PBI.dataLabelColor)
        labelNodes.push(
          <g key={`l${b.si}-${b.ci}`} pointerEvents="none" opacity={hl ? 1 : op}>
            {ls.background ? <rect x={box.x - 2} y={box.y} width={box.w + 4} height={box.h} fill={ls.background} /> : null}
            <text x={lx} y={ly} dy="0.35em" textAnchor="middle" {...fontAttrs(ls.font)} fill={fill}>
              {text}
            </text>
          </g>
        )
      }
    }
  }
  if (barPaints.size) elems.unshift(<SvgGradientDefs key="gdefs" paints={[...barPaints.values()]} />)

  // ribbons
  for (const rb of L.ribbons) {
    const s = data.series[rb.si]
    const pts = rb.quad.map(([c, v]) => xy(c, v))
    elems.unshift(<path key={`rb${rb.si}-${rb.ci}`} d={`M${pts[0]}L${pts[1]}L${pts[2]}L${pts[3]}Z`} fill={s.color} opacity={0.35 * (inter.hasSelection ? 0.6 : 1)} pointerEvents="none" />)
  }

  // areas & lines
  const lineNodes: ReactNode[] = []
  for (const ln of L.lines) {
    const s = data.series[ln.si]
    const pts = ln.points.map((p) => (p ? ([...xy(p.c, p.v)] as [number, number]) : null))
    const labelYs = pts.map((p) => (p ? p[1] : null))
    const curve =
      ln.curve === 'smooth'
        ? ln.smoothType === 'cardinal'
          ? curveCardinal.tension(Math.max(0, Math.min(1, 1 - ln.tension)))
          : curveMonotoneX
        : ln.curve === 'step'
          ? ln.stepPos === 'before'
            ? curveStepBefore
            : ln.stepPos === 'after'
              ? curveStepAfter
              : curveStep
          : curveLinear
    if (ln.area) {
      const base = ln.points.map((p) => (p ? xy(p.c, p.base)[1] : 0))
      const gen = d3area<[number, number] | null>()
        .defined((p) => p !== null)
        .x((p) => p![0])
        .y1((p) => p![1])
        .y0((_p, i) => base[i])
        .curve(curve)
      lineNodes.push(<path key={`a${ln.si}`} d={gen(pts) ?? ''} fill={rgba(ln.areaColor ?? s.color, ln.areaOpacity)} pointerEvents="none" />)
    }
    const gen = d3line<[number, number] | null>()
      .defined((p) => p !== null)
      .x((p) => p![0])
      .y((p) => p![1])
      .curve(curve)
    if (ln.strokeShow)
      lineNodes.push(
        <path
          key={`l${ln.si}`}
          d={gen(pts) ?? ''}
          fill="none"
          stroke={s.color}
          strokeOpacity={ln.strokeOpacity}
          strokeWidth={ln.width}
          strokeDasharray={ln.dash}
          strokeLinejoin={ln.lineJoin as 'round' | 'miter' | 'bevel'}
          strokeLinecap={ln.dash ? (ln.dashCap === 'none' ? 'butt' : (ln.dashCap as 'round' | 'square' | 'butt')) : 'round'}
          pointerEvents="none"
        />
      )
    // markers
    ln.points.forEach((p, ci) => {
      if (!p) return
      const [x, y] = pts[ci]!
      const cat = data.categories[ci]
      const id = pointIdentity(cat, s.split ? s : undefined)
      const sel = inter.hasSelection && inter.isSelected(id)
      const isHover = hover?.ci === ci && hover.si === ln.si
      const single = ln.points.filter(Boolean).length === 1
      if (ln.marker || sel || isHover || single) {
        const r = Math.max(ln.markerSize, isHover || sel ? 4 : 3)
        lineNodes.push(<Marker key={`m${ln.si}-${ci}`} shape={ln.markerShape} x={x} y={y} r={r} fill={s.pointColors?.[ci] ?? ln.markerColor ?? s.color} />)
      }
      const ls = L.labelStyleFor(s)
      if (ls.show && ci % ln.labelEvery === 0) {
        const text = ls.format(s.values[ci] as number, s.formats[ci])
        const tw = measureText(text, ls.font)
        const th = lineHeight(ls.font)
        const centreY = (side: LinePlacement) => (side === 'below' ? y + th / 2 + 4 : y - th / 2 - 4)
        const sides = lineLabelSides(ln.labelPos, labelYs, ci)
        const visible = vertical && x >= L.plot.x - 1 && x <= L.plot.x + L.plot.w + 1
        let ly = centreY(sides[0])
        let box = { x: x - tw / 2, y: ly - th / 2, w: tw, h: th }
        let ok = false
        for (const side of visible ? sides : []) {
          ly = centreY(side)
          box = { x: x - tw / 2, y: ly - th / 2, w: tw, h: th }
          if ((ok = tryPlace(box))) break
        }
        if (ok)
          labelNodes.push(
            <g key={`ll${ln.si}-${ci}`} pointerEvents="none">
              {ls.background ? <rect x={box.x - 2} y={box.y} width={box.w + 4} height={box.h} fill={ls.background} /> : null}
              <text x={x} y={ly} dy="0.35em" textAnchor="middle" {...fontAttrs(ls.font)} fill={s.cfColors?.['labels.color']?.[ci] ?? ls.color ?? PBI.dataLabelColor}>
                {text}
              </text>
            </g>
          )
      }
    })
  }

  // total labels (stacked)
  for (const t of L.totals) {
    const [x, y] = xy(t.c, t.v)
    const th = lineHeight(t.font)
    const tw = measureText(t.text, t.font)
    const lx = vertical ? x : t.neg ? x - tw / 2 - 4 : x + tw / 2 + 4
    const ly = vertical ? (t.neg ? y + th / 2 + 2 : y - th / 2 - 2) : y
    if (tryPlace({ x: lx - tw / 2, y: ly - th / 2, w: tw, h: th }))
      labelNodes.push(
        <text key={`t${t.ci}`} x={lx} y={ly} dy="0.35em" textAnchor="middle" {...fontAttrs(t.font)} fill={t.color} pointerEvents="none">
          {t.text}
        </text>
      )
  }

  // analytics (constant / stat lines, X constant line, trend) with shading and data labels
  const analyticsNodes = (front: boolean) =>
    L.analytics
      .filter((a) => a.front === front)
      .map((a, i) => {
        const dash = a.dashArray ?? DASH[a.style]
        if (a.kind === 'trend') {
          const [x0, y0] = xy(a.c0!, a.v0!)
          const [x1, y1] = xy(a.c1!, a.v1!)
          return <line key={`an${i}`} x1={x0} y1={y0} x2={x1} y2={y1} stroke={a.color} strokeOpacity={a.opacity} strokeWidth={a.width} strokeDasharray={dash} pointerEvents="none" />
        }
        let x0: number, y0: number, x1: number, y1: number
        let shade: ReactNode = null
        if (a.kind === 'xConstant') {
          const p = catPx(a.c0!)
          ;[x0, y0, x1, y1] = vertical ? [p, L.plot.y, p, L.plot.y + L.plot.h] : [L.plot.x, p, L.plot.x + L.plot.w, p]
          if (a.shade) {
            const before = a.shade.region === 'before'
            shade = vertical ? (
              <rect x={before ? L.plot.x : p} y={L.plot.y} width={Math.max(0, before ? p - L.plot.x : L.plot.x + L.plot.w - p)} height={L.plot.h} fill={a.shade.color} fillOpacity={a.shade.opacity} />
            ) : null
          }
        } else {
          const vpx = a.secondary && L.v2px ? L.v2px(a.value) : L.v1px(a.value)
          ;[x0, y0, x1, y1] = vertical ? [L.plot.x, vpx, L.plot.x + L.plot.w, vpx] : [vpx, L.plot.y, vpx, L.plot.y + L.plot.h]
          if (a.shade) {
            // "before" = values below the line (left of it on bar charts)
            const before = a.shade.region === 'before'
            const r = vertical
              ? { x: L.plot.x, y: before ? vpx : L.plot.y, w: L.plot.w, h: before ? L.plot.y + L.plot.h - vpx : vpx - L.plot.y }
              : { x: before ? L.plot.x : vpx, y: L.plot.y, w: before ? vpx - L.plot.x : L.plot.x + L.plot.w - vpx, h: L.plot.h }
            shade = <rect x={r.x} y={r.y} width={Math.max(0, r.w)} height={Math.max(0, r.h)} fill={a.shade.color} fillOpacity={a.shade.opacity} />
          }
        }
        let label: ReactNode = null
        if (a.label) {
          const fa = fontAttrs(L.axisFont)
          if (a.kind === 'xConstant' || !vertical) {
            const lx = (vertical ? x0 : x0) + (a.labelH === 'left' ? -4 : 4)
            const ly = a.labelV === 'under' ? L.plot.y + L.plot.h - 4 : L.plot.y + 10
            label = (
              <text x={lx} y={ly} textAnchor={a.labelH === 'left' ? 'end' : 'start'} {...fa} fill={a.labelColor}>
                {a.label}
              </text>
            )
          } else {
            const lx = a.labelH === 'left' ? L.plot.x + 2 : L.plot.x + L.plot.w - 2
            const ly = a.labelV === 'under' ? y0 + 4 : y0 - 4
            label = (
              <text x={lx} y={ly} dy={a.labelV === 'under' ? '0.8em' : 0} textAnchor={a.labelH === 'left' ? 'start' : 'end'} {...fa} fill={a.labelColor}>
                {a.label}
              </text>
            )
          }
        }
        return (
          <g key={`an${i}`} pointerEvents="none">
            {shade}
            <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={a.color} strokeOpacity={a.opacity} strokeWidth={a.width} strokeDasharray={dash} />
            {label}
          </g>
        )
      })

  // error bars (whiskers + optional shaded band for line series)
  const errorNodes: ReactNode[] = []
  for (const eb of L.errorBars) {
    const sp = eb.spec
    if (sp.shadeShow && eb.isLine) {
      const pts = eb.points.filter((p) => p.lo !== null && p.hi !== null)
      if (pts.length > 1) {
        const top = pts.map((p) => xy(p.c, p.hi!))
        const bot = pts.map((p) => xy(p.c, p.lo!)).reverse()
        const d = `M${top.map((p) => p.join(',')).join('L')}L${bot.map((p) => p.join(',')).join('L')}Z`
        const op = 1 - sp.shadeTransparency / 100
        if (sp.shadeBandStyle !== 'line') errorNodes.push(<path key={`ebs${eb.si}`} d={d} fill={eb.shadeColor} fillOpacity={op} stroke="none" pointerEvents="none" />)
        if (sp.shadeBandStyle !== 'fill') {
          errorNodes.push(<path key={`ebu${eb.si}`} d={`M${top.map((p) => p.join(',')).join('L')}`} fill="none" stroke={eb.shadeColor} strokeDasharray="3 2" pointerEvents="none" />)
          errorNodes.push(<path key={`ebl${eb.si}`} d={`M${bot.map((p) => p.join(',')).join('L')}`} fill="none" stroke={eb.shadeColor} strokeDasharray="3 2" pointerEvents="none" />)
        }
      }
    }
    for (const p of eb.points) {
      const [cx, a] = xy(p.c, p.lo ?? p.hi!)
      const [, b] = xy(p.c, p.hi ?? p.lo!)
      const s = data.series[eb.si]
      const v = s.values[p.ci] as number
      const tip = errorTooltip(sp, v, p.loV, p.hiV, (x) => formatWithUnits(x, { unit: 1, formatString: s.measure.formatString, format: ctx.format }))
      const half = Math.max(2, sp.markerSize / 2)
      const g = (
        <g key={`eb${eb.si}-${p.ci}`} onMouseMove={(e) => inter.showTooltip(e, [...pointTooltip(ctx, data, p.ci, s), ...(tip ? [{ label: 'Error range', value: tip }] : [])], pointIdentity(data.categories[p.ci], s.split ? s : undefined))} onMouseLeave={() => inter.hideTooltip()}>
          {sp.barShow ? (
            vertical ? (
              <>
                {sp.barBorderSize > 0 ? <line x1={cx} x2={cx} y1={a} y2={b} stroke={sp.barBorderColor} strokeWidth={sp.barWidth + sp.barBorderSize * 2} /> : null}
                <line x1={cx} x2={cx} y1={a} y2={b} stroke={eb.color} strokeWidth={sp.barWidth} />
              </>
            ) : (
              <line x1={a} x2={b} y1={xy(p.c, 0)[1]} y2={xy(p.c, 0)[1]} stroke={eb.color} strokeWidth={sp.barWidth} />
            )
          ) : null}
          {sp.markerShow && sp.markerShape !== 'none'
            ? [p.lo, p.hi].map((pv, k) =>
                pv === null ? null : vertical ? (
                  <Marker key={k} shape={sp.markerShape} x={cx} y={pv} r={half} fill={eb.color} />
                ) : (
                  <Marker key={k} shape={sp.markerShape === 'shortDash' || sp.markerShape === 'longDash' ? 'vdash' : sp.markerShape} x={pv} y={xy(p.c, 0)[1]} r={half} fill={eb.color} />
                )
              )
            : null}
          <rect x={vertical ? cx - 4 : Math.min(a, b)} y={vertical ? Math.min(a, b) : xy(p.c, 0)[1] - 4} width={vertical ? 8 : Math.abs(b - a)} height={vertical ? Math.abs(b - a) : 8} fill="transparent" />
        </g>
      )
      errorNodes.push(g)
    }
  }

  // anomalies: expected-range band + markers
  const anomalyNodes: ReactNode[] = []
  const anomalyBandNodes: ReactNode[] = []
  for (const an of L.anomalies) {
    if (an.band) {
      const pts = an.band.filter((p): p is NonNullable<typeof p> => p !== null)
      if (pts.length > 1) {
        const top = pts.map((p) => xy(p.c, p.hi))
        const bot = pts.map((p) => xy(p.c, p.lo)).reverse()
        if (an.bandStyle === 'line') {
          anomalyBandNodes.push(<path key={`anb${an.si}`} d={`M${top.join('L')}M${bot.join('L')}`} fill="none" stroke={an.bandColor} strokeDasharray="3 2" pointerEvents="none" />)
        } else anomalyBandNodes.push(<path key={`anb${an.si}`} d={`M${top.join('L')}L${bot.join('L')}Z`} fill={an.bandColor} fillOpacity={an.bandOpacity} pointerEvents="none" />)
      }
    }
    if (an.markerShow)
      for (const m of an.markers) {
        const [x, y] = xy(m.c, m.v)
        const s = data.series[an.si]
        const band = an.band?.[m.ci]
        anomalyNodes.push(
          <g
            key={`anm${an.si}-${m.ci}`}
            onMouseMove={(e) =>
              inter.showTooltip(
                e,
                [
                  ...pointTooltip(ctx, data, m.ci, s),
                  { label: 'Anomaly', value: 'Yes (approximate detection)' },
                  ...(band ? [{ label: 'Expected range', value: `${formatWithUnits(band.loV, { unit: 1, formatString: s.measure.formatString, format: ctx.format })} – ${formatWithUnits(band.hiV, { unit: 1, formatString: s.measure.formatString, format: ctx.format })}` }] : [])
                ],
                pointIdentity(data.categories[m.ci], s.split ? s : undefined)
              )
            }
            onMouseLeave={() => inter.hideTooltip()}
          >
            <Marker shape={an.markerShape} x={x} y={y} r={an.markerSize / 2 + 1} fill={an.markerColor} />
          </g>
        )
      }
  }

  // forecasts: confidence band (area and/or bound lines) + forecast line, hover shows the bounds
  const forecastBandNodes: ReactNode[] = []
  const forecastNodes: ReactNode[] = []
  for (const fc of L.forecasts) {
    const curve = fc.smooth ? curveMonotoneX : fc.step ? curveStep : curveLinear
    const pt = (c: number, v: number) => xy(c, v) as [number, number]
    if (fc.bandArea) {
      const gen = d3area<{ c: number; lo: number; hi: number }>()
        .x((p) => pt(p.c, 0)[0])
        .y0((p) => p.lo)
        .y1((p) => p.hi)
        .curve(curve)
      forecastBandNodes.push(<path key={`fcb${fc.si}`} d={gen(fc.band) ?? ''} fill={fc.bandArea.color} fillOpacity={fc.bandArea.opacity} pointerEvents="none" />)
    }
    if (fc.bandLine) {
      const bl = fc.bandLine
      for (const k of ['lo', 'hi'] as const) {
        const gen = d3line<{ c: number; lo: number; hi: number }>()
          .x((p) => pt(p.c, 0)[0])
          .y((p) => p[k])
          .curve(curve)
        forecastBandNodes.push(<path key={`fcl${fc.si}${k}`} d={gen(fc.band.slice(1)) ?? ''} fill="none" stroke={bl.color} strokeOpacity={bl.opacity} strokeWidth={bl.width} strokeDasharray={bl.dash} pointerEvents="none" />)
      }
    }
    const gen = d3line<[number, number]>()
      .x((p) => pt(p[0], 0)[0])
      .y((p) => p[1])
      .curve(curve)
    forecastNodes.push(<path key={`fc${fc.si}`} d={gen(fc.line) ?? ''} fill="none" stroke={fc.color} strokeOpacity={fc.opacity} strokeWidth={fc.width} strokeDasharray={fc.dash} strokeLinejoin="round" pointerEvents="none" />)
    const fv = (v: number) => formatWithUnits(v, { unit: 1, formatString: fc.formatString, format: ctx.format })
    const xLabel = (x: number) => (data.categoryType === 'date' ? formatDate(new Date(x), data.levels[0]?.formatString, undefined) : formatWithUnits(x, { unit: 1, formatString: data.levels[0]?.formatString, format: ctx.format }))
    const hitR = Math.max(4, Math.min(10, (fc.points.length > 1 ? Math.abs(fc.points[1].c - fc.points[0].c) : 20) / 2))
    fc.points.forEach((p, i) => {
      const x = pt(p.c, 0)[0]
      const y = p.v
      const isHover = hover?.si === -1 - fc.si && hover.ci === i
      forecastNodes.push(
        <g
          key={`fcp${fc.si}-${i}`}
          onMouseMove={(e) => {
            setHover({ si: -1 - fc.si, ci: i })
            inter.showTooltip(e, [
              { label: data.levels[0]?.label ?? '', value: xLabel(p.x) },
              { label: fc.name, value: fv(p.mean), color: fc.color },
              { label: 'Upper bound', value: fv(p.upper) },
              { label: 'Lower bound', value: fv(p.lower) }
            ])
          }}
          onMouseLeave={() => {
            setHover(null)
            inter.hideTooltip()
          }}
        >
          <circle cx={x} cy={y} r={hitR} fill="transparent" />
          {isHover ? <circle cx={x} cy={y} r={4} fill={fc.color} pointerEvents="none" /> : null}
        </g>
      )
    })
  }

  // series labels at the end of lines
  const seriesLabelNodes = L.seriesLabelItems.map((it) => {
    const fa = fontAttrs(L.seriesLabelFont)
    const tw = measureText(it.text, L.seriesLabelFont)
    const th = lineHeight(L.seriesLabelFont)
    const bx = it.anchor === 'start' ? it.x - 2 : it.x - tw - 2
    return (
      <g key={`sl${it.si}`} pointerEvents="none">
        {it.leader ? <polyline points={`${it.leader[0]},${it.leader[1]} ${it.anchor === 'start' ? it.x - 4 : it.x + 4},${it.y}`} fill="none" stroke={it.color} strokeWidth={1} strokeOpacity={0.6} /> : null}
        {it.background ? <rect x={bx} y={it.y - th / 2} width={tw + 4} height={th} fill={it.background} fillOpacity={it.backgroundOpacity} /> : null}
        <text x={it.x} y={it.y} dy="0.35em" textAnchor={it.anchor} {...fa} fill={it.background && it.background === data.series[it.si].color ? contrastText(it.background) : it.color}>
          {it.text}
        </text>
      </g>
    )
  })

  // hover overlay for line series
  const lineSeries = L.lines.filter((l) => !l.area || true)
  const onPlotMove = (e: ReactMouseEvent<SVGRectElement>) => {
    if (!lineSeries.length) return
    const svg = (e.currentTarget.ownerSVGElement ?? e.currentTarget) as SVGGraphicsElement
    const box = svg.getBoundingClientRect()
    const mx = e.clientX - box.left
    const my = e.clientY - box.top
    let best: { ci: number; si: number; d: number } | null = null
    for (const ln of lineSeries) {
      ln.points.forEach((p, ci) => {
        if (!p) return
        const [x, y] = xy(p.c, p.v)
        const d = Math.abs(x - mx) * 3 + Math.abs(y - my)
        if (!best || d < best.d) best = { ci, si: ln.si, d }
      })
    }
    const b = best as { ci: number; si: number; d: number } | null
    if (b) {
      setHover({ ci: b.ci, si: b.si })
      const s = data.series[b.si]
      inter.showTooltip(e, pointTooltip(ctx, data, b.ci, s), pointIdentity(data.categories[b.ci], s.split ? s : undefined))
    }
  }
  const onPlotClick = (e: ReactMouseEvent) => {
    if (hover && lineSeries.length) {
      const s = data.series[hover.si]
      const cat = data.categories[hover.ci]
      inter.onPointClick(pointIdentity(cat, s.split ? s : undefined), e, { categoryOnly: pointIdentity(cat, undefined) })
      return
    }
    inter.onBackgroundClick(e)
  }
  const onPlotContext = (e: ReactMouseEvent) => {
    if (hover && lineSeries.length) {
      const s = data.series[hover.si]
      inter.onContextMenu(pointIdentity(data.categories[hover.ci], s.split ? s : undefined), e)
    } else inter.onContextMenu(undefined, e)
  }

  // ---------------- axes
  const axisNodes: ReactNode[] = []
  // value gridlines + labels
  for (const ax of L.valueAxes) {
    ax.ticks.forEach((t, i) => {
      const p = ax.px(t)
      if (ax.grid && !ax.secondary)
        axisNodes.push(
          vertical ? (
            <line key={`g${i}`} x1={L.plot.x} x2={L.plot.x + L.plot.w} y1={Math.round(p) + 0.5} y2={Math.round(p) + 0.5} stroke={ax.grid.color} strokeWidth={ax.grid.width} strokeDasharray={ax.grid.dash} strokeOpacity={ax.grid.opacity} />
          ) : (
            <line key={`g${i}`} y1={L.plot.y} y2={L.plot.y + L.plot.h} x1={Math.round(p) + 0.5} x2={Math.round(p) + 0.5} stroke={ax.grid.color} strokeWidth={ax.grid.width} strokeDasharray={ax.grid.dash} strokeOpacity={ax.grid.opacity} />
          )
        )
      if (!ax.show) return
      const text = ax.labels[i]
      if (vertical) {
        const right = ax.side === 'right'
        axisNodes.push(
          <text key={`vt${ax.secondary ? 2 : 1}-${i}`} x={right ? L.plot.x + L.plot.w + 6 : L.plot.x - 6} y={p} dy="0.35em" textAnchor={right ? 'start' : 'end'} {...fontAttrs(ax.font)} fill={ax.color}>
            {text}
          </text>
        )
      } else {
        axisNodes.push(
          <text key={`vt${i}`} x={p} y={L.valTop ? L.plot.y - 4 : L.plot.y + L.plot.h + 4} dy={L.valTop ? '-0.2em' : '0.85em'} textAnchor="middle" {...fontAttrs(ax.font)} fill={ax.color}>
            {text}
          </text>
        )
      }
    })
    if (ax.title) {
      const tf = fontAttrs(ax.title.font)
      if (vertical) {
        const right = ax.side === 'right'
        const zoomOff = L.zoomVal && !ax.secondary ? 18 : 0
        const x = right ? width - ax.title.size / 2 - L.rightReserve - zoomOff : ax.title.size / 2 + L.leftReserve + zoomOff
        const cy = L.plot.y + L.plot.h / 2
        axisNodes.push(
          <text key={`vtitle${ax.secondary ? 2 : 1}`} transform={`translate(${x},${cy}) rotate(${right ? 90 : -90})`} textAnchor="middle" dy="0.35em" {...tf} fill={ax.title.color}>
            {ellipsize(ax.title.text, L.plot.h, ax.title.font)}
          </text>
        )
      } else {
        axisNodes.push(
          <text key="vtitle" x={L.plot.x + L.plot.w / 2} y={L.valueTitleY} dy="0.35em" textAnchor="middle" {...tf} fill={ax.title.color}>
            {ellipsize(ax.title.text, L.plot.w, ax.title.font)}
          </text>
        )
      }
    }
  }
  // category gridlines
  if (L.catGrid)
    L.catTicks.forEach((t, i) => {
      const p = catPx(t.c)
      if (vertical) axisNodes.push(<line key={`cg${i}`} x1={p} x2={p} y1={L.plot.y} y2={L.plot.y + L.plot.h} stroke={L.catGrid!.color} strokeWidth={L.catGrid!.width} strokeDasharray={L.catGrid!.dash} strokeOpacity={L.catGrid!.opacity} clipPath={`url(#${clipId})`} />)
      else axisNodes.push(<line key={`cg${i}`} y1={p} y2={p} x1={L.plot.x} x2={L.plot.x + L.plot.w} stroke={L.catGrid!.color} strokeWidth={L.catGrid!.width} strokeDasharray={L.catGrid!.dash} strokeOpacity={L.catGrid!.opacity} clipPath={`url(#${clipId})`} />)
    })
  // category labels
  const catLabelNodes: ReactNode[] = []
  if (L.catShow) {
    const fa = fontAttrs(L.catFont)
    const lh = lineHeight(L.catFont)
    L.catTicks.forEach((t, i) => {
      if (!t.lines.length) return
      const p = catPx(t.c)
      if (vertical) {
        if (p < L.plot.x - L.catStep || p > L.plot.x + L.plot.w + L.catStep) return
        if (L.catMode === 'rotated') {
          const y = L.plot.y + L.plot.h + 6
          catLabelNodes.push(
            <text key={`ct${i}`} transform={`translate(${p},${y}) rotate(-45)`} textAnchor="end" dy="0.35em" {...fa} fill={L.catColor}>
              <title>{t.full}</title>
              {t.lines[0]}
            </text>
          )
        } else {
          catLabelNodes.push(
            <text key={`ct${i}`} x={p} y={L.plot.y + L.plot.h + 4} textAnchor="middle" {...fa} fill={L.catColor}>
              <title>{t.full}</title>
              {t.lines.map((ln, li) => (
                <tspan key={li} x={p} dy={li === 0 ? '0.95em' : lh}>
                  {ln}
                </tspan>
              ))}
            </text>
          )
        }
      } else {
        if (p < L.plot.y - L.catStep || p > L.plot.y + L.plot.h + L.catStep) return
        const n = t.lines.length
        catLabelNodes.push(
          <text key={`ct${i}`} x={L.plot.x - 6} y={p - ((n - 1) * lh) / 2} textAnchor="end" {...fa} fill={L.catColor}>
            <title>{t.full}</title>
            {t.lines.map((ln, li) => (
              <tspan key={li} x={L.plot.x - 6} dy={li === 0 ? '0.35em' : lh}>
                {ln}
              </tspan>
            ))}
          </text>
        )
      }
    })
    // outer hierarchy level labels (expanded, not concatenated): PBI's grouped hierarchical axis
    const nRows = Math.max(0, ...L.outerGroups.map((g) => g.row + 1))
    for (const g of L.outerGroups) {
      const a = catPx(g.c0)
      const b = catPx(g.c1)
      const mid = (a + b) / 2
      if (vertical) {
        const y = L.outerY + g.row * (lh + 4)
        catLabelNodes.push(
          <g key={`og${g.row}-${g.c0}`}>
            <line x1={b} x2={b} y1={L.plot.y + L.plot.h} y2={y + lh + 2} stroke="#C8C6C4" />
            <text x={mid} y={y} dy="0.95em" textAnchor="middle" {...fa} fill={L.catColor}>
              {ellipsize(g.label, Math.max(0, Math.abs(b - a) - 4), L.catFont)}
            </text>
          </g>
        )
      } else {
        const colW = L.outerW / Math.max(1, nRows)
        const x1 = L.plot.x - L.innerLabelW - g.row * colW
        const x0 = x1 - colW
        catLabelNodes.push(
          <g key={`og${g.row}-${g.c0}`}>
            <line x1={x0} x2={L.plot.x} y1={b} y2={b} stroke="#C8C6C4" />
            <text x={x1 - 4} y={mid} dy="0.35em" textAnchor="end" {...fa} fill={L.catColor}>
              {ellipsize(g.label, Math.max(0, colW - 6), L.catFont)}
            </text>
          </g>
        )
      }
    }
  }
  if (L.catTitle) {
    const tf = fontAttrs(L.catTitle.font)
    if (vertical)
      axisNodes.push(
        <text key="ctitle" x={L.plot.x + L.plot.w / 2} y={L.catTitleY} dy="0.35em" textAnchor="middle" {...tf} fill={L.catTitle.color}>
          {ellipsize(L.catTitle.text, L.plot.w, L.catTitle.font)}
        </text>
      )
    else
      axisNodes.push(
        <text key="ctitle" transform={`translate(${L.catTitleY},${L.plot.y + L.plot.h / 2}) rotate(-90)`} dy="0.35em" textAnchor="middle" {...tf} fill={L.catTitle.color}>
          {ellipsize(L.catTitle.text, L.plot.h, L.catTitle.font)}
        </text>
      )
  }

  // persist a slider window into the zoom object (undoable); the saved value then drives the slider
  const commitZoom = (axis: 'category' | 'value', w: [number, number]) => {
    const full = w[0] <= 0.0005 && w[1] >= 0.9995
    const values = full ? {} : axis === 'category' ? L.zoomProps.category(w) : L.zoomProps.value(w)
    ctx.updateVisual((j) => writeZoom(j, values, axis))
    setZoom((z) => (axis === 'category' ? { ...z, c: undefined } : { ...z, v: undefined }))
  }

  // scrollbar
  let scrollbar: ReactNode = null
  if (L.zoomCat || L.zoomVal) {
    const sliders: ReactNode[] = []
    if (L.zoomCat)
      sliders.push(
        vertical ? (
          <ZoomSlider key="zc" orientation="horizontal" x={L.plot.x} y={height - 8} length={L.plot.w} range={L.zoomWin.c} onChange={(r) => setZoom((z) => ({ ...z, c: r }))} onCommit={(r) => commitZoom('category', r)} />
        ) : (
          <ZoomSlider key="zc" orientation="vertical" x={width - 8} y={L.plot.y} length={L.plot.h} range={[1 - L.zoomWin.c[1], 1 - L.zoomWin.c[0]]} onChange={(r) => setZoom((z) => ({ ...z, c: [1 - r[1], 1 - r[0]] }))} onCommit={(r) => commitZoom('category', [1 - r[1], 1 - r[0]])} />
        )
      )
    if (L.zoomVal)
      sliders.push(
        vertical ? (
          <ZoomSlider key="zv" orientation="vertical" x={L.zoomValX} y={L.plot.y} length={L.plot.h} range={L.zoomWin.v} onChange={(r) => setZoom((z) => ({ ...z, v: r }))} onCommit={(r) => commitZoom('value', r)} />
        ) : (
          <ZoomSlider key="zv" orientation="horizontal" x={L.plot.x} y={height - 8} length={L.plot.w} range={L.zoomWin.v} onChange={(r) => setZoom((z) => ({ ...z, v: r }))} onCommit={(r) => commitZoom('value', r)} />
        )
      )
    scrollbar = <g>{sliders}</g>
  } else if (maxScroll > 0) {
    const track = L.viewLen
    const thumb = Math.max(20, (track * L.viewLen) / L.contentLen)
    const pos = ((track - thumb) * sc) / maxScroll
    const onDown = (e: React.PointerEvent) => {
      e.stopPropagation()
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      dragRef.current = { start: vertical ? e.clientX : e.clientY, scroll: sc }
    }
    const onMove = (e: React.PointerEvent) => {
      if (!dragRef.current) return
      const d = (vertical ? e.clientX : e.clientY) - dragRef.current.start
      setScroll(Math.max(0, Math.min(maxScroll, dragRef.current.scroll + (d * maxScroll) / Math.max(1, track - thumb))))
    }
    const onUp = () => (dragRef.current = null)
    scrollbar = vertical ? (
      <rect x={L.plot.x + pos} y={height - 6} width={thumb} height={5} rx={2.5} fill="#B3B0AD" opacity={0.8} style={{ cursor: 'pointer' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
    ) : (
      <rect x={width - 6} y={L.plot.y + pos} width={5} height={thumb} rx={2.5} fill="#B3B0AD" opacity={0.8} style={{ cursor: 'pointer' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
    )
  }

  const legendItems: LegendItem[] = L.legendItems.map((it) => {
    const s = data.series.find((x) => x.key === it.key)
    const dim = s && inter.hasSelection && s.split ? !inter.isSelected({ fields: s.scope }) : false
    return { ...it, dimmed: dim }
  })
  const onLegendClick = (key: string, e: ReactMouseEvent) => {
    const s = data.series.find((x) => x.key === key)
    if (s?.split) inter.onPointClick({ fields: s.scope }, e, { drillable: false })
  }

  const scrolling = maxScroll > 0
  const catClip = !scrolling ? { x: 0, y: 0, w: width, h: height + (panel?.overflowBottom ?? 0) } : vertical ? { x: L.plot.x - 2, y: 0, w: L.plot.w + 4, h: height } : { x: 0, y: L.plot.y - 2, w: width, h: L.plot.h + 4 }
  const plotClip = L.clipPlot || scrolling ? (vertical ? { x: L.plot.x, y: L.plot.y - 30, w: L.plot.w, h: L.plot.h + 60 } : { x: L.plot.x - 60, y: L.plot.y, w: L.plot.w + 120, h: L.plot.h }) : { x: 0, y: 0, w: width, h: height }

  return (
    <svg
      width={width}
      height={height}
      style={{ display: 'block', overflow: panel?.overflowBottom ? 'visible' : 'hidden', userSelect: 'none', position: panel?.overflowBottom ? 'relative' : undefined, zIndex: panel?.overflowBottom ? 1 : undefined }}
      onWheel={onWheel}
      onClick={(e) => inter.onBackgroundClick(e)}
      onContextMenu={(e) => inter.onContextMenu(undefined, e)}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={plotClip.x} y={plotClip.y} width={plotClip.w} height={plotClip.h} />
        </clipPath>
        <clipPath id={clipId + 'p'}>
          <rect x={L.plot.x} y={L.plot.y} width={L.plot.w} height={L.plot.h} />
        </clipPath>
        <clipPath id={clipId + 'c'}>
          <rect x={catClip.x} y={catClip.y} width={catClip.w} height={catClip.h} />
        </clipPath>
      </defs>
      {L.plotBg ? <rect x={L.plot.x} y={L.plot.y} width={L.plot.w} height={L.plot.h} fill={L.plotBg} /> : null}
      <rect
        x={L.plot.x}
        y={L.plot.y}
        width={L.plot.w}
        height={L.plot.h}
        fill="transparent"
        onMouseMove={onPlotMove}
        onMouseLeave={() => {
          setHover(null)
          inter.hideTooltip()
        }}
        onClick={(e) => {
          e.stopPropagation()
          onPlotClick(e)
        }}
        onContextMenu={onPlotContext}
      />
      <g pointerEvents="none">{axisNodes}</g>
      <g clipPath={`url(#${clipId})`}>{analyticsNodes(false)}</g>
      <g clipPath={`url(#${clipId})`}>
        <g clipPath={`url(#${clipId}p)`}>
          {anomalyBandNodes}
          {forecastBandNodes}
        </g>
        {elems}
        {lineNodes}
        {forecastNodes}
        {anomalyNodes}
        {errorNodes}
        {labelNodes}
      </g>
      <g clipPath={`url(#${clipId})`}>{analyticsNodes(true)}</g>
      {seriesLabelNodes}
      <g clipPath={`url(#${clipId}c)`} style={{ cursor: data.allLevels.length > 1 && ctx.drill?.drillMode ? 'pointer' : 'default' }}>
        {catLabelNodes}
      </g>
      {L.legend.size > 0 ? (
        <Legend style={L.legendStyle} items={legendItems} x={L.legendRect.x} y={L.legendRect.y} width={L.legendRect.w} height={L.legendRect.h} onItemClick={onLegendClick} />
      ) : null}
      {scrollbar}
    </svg>
  )
}

function hasRole(json: any, roles: string[]): boolean {
  const qs = json?.visual?.query?.queryState ?? {}
  return roles.some((r) => (qs[r]?.projections ?? []).length > 0)
}

function Marker({ shape, x, y, r, fill }: { shape: string; x: number; y: number; r: number; fill: string }) {
  switch (shape) {
    case 'square':
      return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill={fill} pointerEvents="none" />
    case 'diamond':
      return <path d={`M${x},${y - r * 1.2}L${x + r * 1.2},${y}L${x},${y + r * 1.2}L${x - r * 1.2},${y}Z`} fill={fill} pointerEvents="none" />
    case 'triangle':
      return <path d={`M${x},${y - r * 1.2}L${x + r * 1.1},${y + r * 0.9}L${x - r * 1.1},${y + r * 0.9}Z`} fill={fill} pointerEvents="none" />
    case 'x':
      return <path d={`M${x - r},${y - r}L${x + r},${y + r}M${x + r},${y - r}L${x - r},${y + r}`} stroke={fill} strokeWidth={2} pointerEvents="none" />
    case 'vdash':
      return <rect x={x - 1} y={y - r} width={2} height={r * 2} fill={fill} pointerEvents="none" />
    case 'plus':
      return <path d={`M${x - r},${y}L${x + r},${y}M${x},${y - r}L${x},${y + r}`} stroke={fill} strokeWidth={2} pointerEvents="none" />
    case 'shortDash':
      return <rect x={x - r} y={y - 1} width={r * 2} height={2} fill={fill} pointerEvents="none" />
    case 'longDash':
      return <rect x={x - r * 1.8} y={y - 1} width={r * 3.6} height={2} fill={fill} pointerEvents="none" />
    default:
      return <circle cx={x} cy={y} r={r} fill={fill} stroke="#FFFFFF" strokeWidth={r > 3 ? 1 : 0} pointerEvents="none" />
  }
}

// =============================================================================================
// Layout
// =============================================================================================

interface BarGeom {
  si: number
  ci: number
  c0: number
  c1: number
  v0: number
  v1: number
  hv0?: number
  hv1?: number
  value: number
  labelPos: string
}

interface LineGeom {
  si: number
  points: Array<{ c: number; v: number; base: number } | null>
  area: boolean
  areaOpacity: number
  width: number
  dash?: string
  curve: 'linear' | 'smooth' | 'step'
  smoothType: string
  tension: number
  stepPos: string
  areaColor?: string
  dashCap: string
  strokeShow: boolean
  strokeOpacity: number
  lineJoin: string
  marker: boolean
  markerShape: string
  markerSize: number
  markerColor?: string
  labelEvery: number
  labelPos: string
}

interface ValueAxisRender {
  secondary: boolean
  side: 'left' | 'right'
  show: boolean
  ticks: number[]
  labels: string[]
  px(v: number): number
  font: FontSpec
  color: string
  grid?: GridSpec
  title?: { text: string; font: FontSpec; color: string; size: number }
}

/**
 * Legend marker of a series: `legend.legendMarkerRendering` for line series; the default (markerCircleDefault) is a
 * circle for every series, line series of combo charts included (Power BI render of a line-and-clustered-column chart:
 * the line series has the same circle marker as the columns).
 */
export function legendShapeFor(kind: string, markerRendering: string): LegendItem['shape'] {
  if (kind !== 'line') return 'circle'
  if (markerRendering === 'lineOnly') return 'lineOnly'
  if (markerRendering === 'lineAndMarker') return 'line'
  return 'circle'
}

interface LabelStyle {
  show: boolean
  font: FontSpec
  color?: string
  background?: string
  format(v: number, fmtStr?: string): string
}

interface Layout {
  plot: Rect
  plotBg?: string
  legend: { size: number }
  legendStyle: ReturnType<typeof readLegendStyle>
  legendRect: Rect
  legendItems: LegendItem[]
  bars: BarGeom[]
  ribbons: Array<{ si: number; ci: number; quad: Array<[number, number]> }>
  lines: LineGeom[]
  totals: Array<{ ci: number; c: number; v: number; text: string; font: FontSpec; color: string; neg: boolean }>
  analytics: AnalyticsLine[]
  valueAxes: ValueAxisRender[]
  v1px(v: number): number
  v2px?: (v: number) => number
  catShow: boolean
  catFont: FontSpec
  catColor: string
  catMode: 'horizontal' | 'rotated' | 'none'
  catTicks: Array<{ c: number; lines: string[]; full: string }>
  catStep: number
  catGrid?: GridSpec
  catTitle?: { text: string; font: FontSpec; color: string }
  catTitleY: number
  valueTitleY: number
  outerGroups: Array<{ c0: number; c1: number; label: string; row: number }>
  seriesLabelItems: Array<{ si: number; text: string; x: number; y: number; anchor: 'start' | 'end'; color: string; leader?: [number, number]; background?: string; backgroundOpacity: number }>
  seriesLabelFont: FontSpec
  errorBars: Array<{ si: number; spec: ErrorBarSpec; color: string; shadeColor: string; isLine: boolean; points: Array<{ ci: number; c: number; lo: number | null; hi: number | null; loV: number | null; hiV: number | null }> }>
  anomalies: Array<{
    si: number
    band?: Array<{ c: number; lo: number; hi: number; loV: number; hiV: number; exp: number } | null>
    bandStyle: string
    bandColor: string
    bandOpacity: number
    markers: Array<{ ci: number; c: number; v: number }>
    markerShow: boolean
    markerShape: string
    markerSize: number
    markerColor: string
  }>
  forecasts: Array<{
    si: number
    name: string
    color: string
    width: number
    opacity: number
    dash?: string
    smooth: boolean
    step: boolean
    /** content-space [c, px] from the last used observation through the forecast */
    line: Array<[number, number]>
    band: Array<{ c: number; lo: number; hi: number }>
    bandArea?: { color: string; opacity: number }
    bandLine?: { color: string; opacity: number; width: number; dash?: string }
    points: Array<{ x: number; c: number; v: number; mean: number; lower: number; upper: number }>
    formatString?: string
    confidence: number
    period: number
  }>
  zoomCat: boolean
  zoomVal: boolean
  /** effective slider windows (session state, else the saved zoom object, else full) */
  zoomWin: { c: [number, number]; v: [number, number] }
  /** window fractions → values persisted in the zoom object */
  zoomProps: { category(w: [number, number]): Record<string, number>; value(w: [number, number]): Record<string, number> }
  /** x of the value-axis zoom slider (vertical charts) */
  zoomValX: number
  outerW: number
  /** width of the inner category labels of bar charts */
  innerLabelW: number
  valTop: boolean
  outerY: number
  contentLen: number
  viewLen: number
  stacked: boolean
  /** stacked chart with a single bar series: its labels may go outside the bar end like a clustered chart */
  soleStack: boolean
  /** explicit axis bounds can push marks outside the plot */
  clipPlot: boolean
  axisFont: FontSpec
  leftReserve: number
  rightReserve: number
  labelStyleFor(s: Series): LabelStyle
}

function computeLayout(data: CategoricalData, fmt: FormatReader, cfg: CartesianConfig, W: number, H: number, formatter: VisualProps['ctx']['format'], panel?: PanelOptions, zoom?: ZoomState, errorSpecs: ErrorBarSpec[] = []): Layout {
  let czoom = zoom?.c
  const vzoom = zoom?.v
  const vertical = cfg.orientation === 'vertical'
  const responsive = fmt.bool('general', 'responsive', true)
  const small = responsive && (H < 140 || W < 160)
  const tiny = responsive && (H < 90 || W < 110)

  const series = data.series
  const kinds = series.map((s) => cfg.kindOf(s.role))
  const secShow = y2Bool(fmt, 'show', 'secShow', true)
  const isSec = series.map((s) => !!cfg.secondaryRoles?.includes(s.role) && secShow)
  const anySec = isSec.some(Boolean)

  // ---------------- legend (PBI only draws it when there is more than one series / a legend field)
  const multi = series.length > 1 || !!data.seriesField
  const legendStyle = readLegendStyle(fmt, {
    show: multi && !tiny,
    position: undefined,
    title: data.seriesField ? data.seriesField.label : ''
  })
  if (!data.seriesField) legendStyle.showTitle = legendStyle.showTitle && !!fmt.optStr('legend', 'titleText')
  if (tiny || panel?.hideLegend || !multi) legendStyle.show = false
  const markerRendering = fmt.str('legend', 'legendMarkerRendering', 'markerCircleDefault')
  const legendItems: LegendItem[] = series.map((s, i) => ({ key: s.key, label: s.name, color: s.color, shape: legendShapeFor(kinds[i], markerRendering), gradient: kinds[i] === 'bar' ? s.gradient : undefined }))
  const lg = measureLegend(legendStyle, legendItems, W, H)
  let area: Rect = { x: 0, y: 0, w: W, h: H }
  let legendRect: Rect = { x: 0, y: 0, w: 0, h: 0 }
  if (lg.size > 0) {
    const p = legendStyle.position
    if (p.startsWith('Top')) {
      legendRect = { x: 0, y: 0, w: W, h: lg.size }
      area = { x: 0, y: lg.size, w: W, h: H - lg.size }
    } else if (p.startsWith('Bottom')) {
      legendRect = { x: 0, y: H - lg.size, w: W, h: lg.size }
      area = { x: 0, y: 0, w: W, h: H - lg.size }
    } else if (p.startsWith('Left')) {
      legendRect = { x: 0, y: 0, w: lg.size, h: H }
      area = { x: lg.size + 4, y: 0, w: W - lg.size - 4, h: H }
    } else {
      legendRect = { x: W - lg.size, y: 0, w: lg.size, h: H }
      area = { x: 0, y: 0, w: W - lg.size - 4, h: H }
    }
  }
  void isVertical

  // ---------------- fonts & axis props
  const catShow = fmt.bool('categoryAxis', 'show', true) && !panel?.hideCategoryAxis
  // axis label defaults: category axis = `lightLabel`, value axis = `smallLightLabel` text classes (fmtProps)
  const catT = fmt.text('categoryAxis', { color: 'labelColor' }, labelDerivedClass(fmt.theme, 'lightLabel'))
  const valShow = fmt.bool('valueAxis', 'show', true) && !(responsive && W < 120 && vertical) && !panel?.hideValueAxis
  const valT = fmt.text('valueAxis', { color: 'labelColor' }, labelDerivedClass(fmt.theme, 'smallLightLabel'))
  const secT = fmt.text(y2Obj(fmt, 'secFontSize'), { color: 'secLabelColor', size: 'secFontSize', family: 'secFontFamily', bold: 'secBold', italic: 'secItalic' }, { size: valT.font.size / (4 / 3), color: valT.color, family: valT.font.family })
  const secAxisShow = y2Bool(fmt, 'show', 'secShow', true)
  const catTitleShow = catShow && fmt.bool('categoryAxis', 'showAxisTitle', true) && !small && !panel?.hideTitles
  const valTitleShow = valShow && fmt.bool('valueAxis', 'showAxisTitle', true) && !small && !panel?.hideTitles
  const secTitleShow = anySec && y2Bool(fmt, 'secShowAxisTitle', 'secShowAxisTitle', true) && !small && !panel?.hideTitles
  const titleClass = axisTitleDefaults(fmt)
  const catTitleT = fmt.text('categoryAxis', { size: 'titleFontSize', family: 'titleFontFamily', color: 'titleColor', bold: 'titleBold', italic: 'titleItalic' }, titleClass)
  const valTitleT = fmt.text('valueAxis', { size: 'titleFontSize', family: 'titleFontFamily', color: 'titleColor', bold: 'titleBold', italic: 'titleItalic' }, titleClass)
  const catTitleText = fmt.str('categoryAxis', 'titleText', joinTitles(data.levels.map((l) => l.label)))
  const primNames = series.filter((_, i) => !isSec[i]).map((s) => s.measure.label)
  const secNames = series.filter((_, i) => isSec[i]).map((s) => s.measure.label)
  const valTitleText = fmt.str('valueAxis', 'titleText', joinTitles(primNames))
  const secTitleText = fmt.str(y2Obj(fmt, 'secTitleText'), 'secTitleText', joinTitles(secNames))
  const catTitleH = catTitleShow && catTitleText ? lineHeight(catTitleT.font) + 2 : 0
  const valTitleH = valTitleShow && valTitleText ? lineHeight(valTitleT.font) + 2 : 0
  const secTitleH = secTitleShow && secTitleText ? lineHeight(valTitleT.font) + 2 : 0

  const innerPad = fmt.num('categoryAxis', 'innerPadding', 20) / 100
  const minCatW = Math.max(4, fmt.num('categoryAxis', 'preferredCategoryWidth', 20))
  const maxMargin = fmt.num('categoryAxis', 'maxMarginFactor', 25) / 100
  const concatenate = fmt.bool('categoryAxis', 'concatenateLabels', false)

  // continuous axis?
  const scalarDefault = data.levels.length === 1 && data.levels[0].proj.info.kind === 'column' && (data.categoryType === 'date' || data.categoryType === 'number')
  const axisType = fmt.str('categoryAxis', 'axisType', scalarDefault ? 'Scalar' : 'Categorical')
  const continuous = vertical && axisType === 'Scalar' && (data.categoryType === 'date' || data.categoryType === 'number') && data.levels.length === 1 && !cfg.ribbon
  const catNums = continuous ? data.categories.map((c) => toNum(c.values[0])) : []

  // ---------------- value domains
  const barIdx = series.map((_, i) => i).filter((i) => kinds[i] === 'bar')
  const areaStack = cfg.stacking !== 'clustered'
  const stackGroup = (i: number) => (kinds[i] === 'bar' ? 'bar' : kinds[i] === 'area' && areaStack ? 'area' : null)
  const stacks: Record<string, Array<Array<[number, number] | null>>> = {}
  const hstacks: Record<string, Array<Array<[number, number] | null>>> = {}
  for (const g of ['bar', 'area']) {
    const members = series.map((_, i) => i).filter((i) => stackGroup(i) === g && !isSec[i])
    if (!members.length) continue
    const vals = members.map((i) => series[i].values)
    const st = cfg.stacking === 'clustered' && g === 'bar' ? null : stackValues(vals, cfg.stacking === 'percent')
    if (st) {
      const full: Array<Array<[number, number] | null>> = series.map(() => [])
      members.forEach((i, k) => (full[i] = st[k]))
      stacks[g] = full
      if (data.hasHighlights) {
        const hfull: Array<Array<[number, number] | null>> = series.map(() => [])
        // highlight segment = [base, base + highlight] within the full segment
        members.forEach((i) => {
          hfull[i] = full[i].map((seg, ci) => {
            const h = series[i].highlights?.[ci]
            if (!seg || h === null || h === undefined) return null
            const raw = series[i].values[ci] ?? 0
            const frac = raw ? h / raw : 0
            const lo = seg[0]
            const hi = seg[1]
            return raw >= 0 ? [lo, lo + (hi - lo) * frac] : [hi - (hi - lo) * frac, hi]
          })
        })
        hstacks[g] = hfull
      }
    }
  }
  const extent = (sec: boolean): [number, number, boolean] => {
    let lo = Infinity
    let hi = -Infinity
    let includeZero = false
    series.forEach((s, i) => {
      if (isSec[i] !== sec) return
      const g = stackGroup(i)
      // columns/bars and stacked areas start at zero; PBI's (overlapping) area chart fits the data
      // like a line chart and fills down to the bottom of the plot
      if (kinds[i] === 'bar' || (kinds[i] === 'area' && areaStack)) includeZero = true
      if (g && stacks[g]?.[i]?.length) {
        for (const seg of stacks[g][i]) if (seg) (lo = Math.min(lo, seg[0])), (hi = Math.max(hi, seg[1]))
      } else
        for (const v of s.values)
          if (v !== null && Number.isFinite(v)) {
            lo = Math.min(lo, v)
            hi = Math.max(hi, v)
          }
    })
    if (!Number.isFinite(lo)) return [0, 1, true]
    return [lo, hi, includeZero]
  }
  const analyticsSpec = computeAnalytics(fmt, data, {
    percent: cfg.stacking === 'percent',
    isSecondary: (s) => isSec[series.indexOf(s)] ?? false,
    catNumber: continuous ? (ci) => catNums[ci] : undefined
  })
  // Analytics ▸ Forecast: line series on a continuous X axis without a legend field (PBI disables the
  // forecast otherwise). Forecast values extend the value range and the X domain.
  const forecastRaw: Array<{ si: number; f: SeriesForecast }> = []
  if (continuous && !data.seriesField && !panel)
    for (const spec of readForecastSpecs(fmt.pc.objects, fmt.theme)) {
      const si = series.findIndex((s, i) => kinds[i] === 'line' && (!spec.metadata || s.metadata === spec.metadata))
      if (si < 0) continue
      const f = forecastSeries(catNums, series[si].values, spec, data.categoryType === 'date')
      if (f) forecastRaw.push({ si, f })
    }
  let [lo1, hi1, z1] = extent(false)
  if (panel?.domain) {
    lo1 = Math.min(lo1, panel.domain[0])
    hi1 = Math.max(hi1, panel.domain[1])
  }
  for (const a of analyticsSpec) if (!a.secondary && a.kind !== 'trend' && a.kind !== 'xConstant' && Number.isFinite(a.value)) (lo1 = Math.min(lo1, a.value)), (hi1 = Math.max(hi1, a.value))
  let [lo2, hi2, z2] = extent(true)
  for (const { si, f } of forecastRaw)
    for (const p of f.points) {
      const vals = f.spec.bandArea.show || f.spec.bandLine.show ? [p.mean, p.lower, p.upper] : [p.mean]
      for (const v of vals) {
        if (!Number.isFinite(v)) continue
        if (isSec[si]) ((lo2 = Math.min(lo2, v)), (hi2 = Math.max(hi2, v)))
        else ((lo1 = Math.min(lo1, v)), (hi1 = Math.max(hi1, v)))
      }
    }
  const forecastMaxX = forecastRaw.reduce((m, { f }) => Math.max(m, f.points[f.points.length - 1]?.x ?? -Infinity), -Infinity)
  // error-bar bounds are part of the axis range (PBI extends the axis to show the whiskers)
  if (cfg.stacking !== 'percent')
    series.forEach((s, i) => {
      const spec = errorSpecFor(errorSpecs, s)
      if (!spec) return
      const k = errorSpecs.indexOf(spec)
      s.values.forEach((v, ci) => {
        if (v === null) return
        const [l, h] = errorBounds(spec, v, s.pointValues?.[`eu${k}`]?.[ci], s.pointValues?.[`el${k}`]?.[ci])
        for (const b of [l, h]) {
          if (b === null || !Number.isFinite(b)) continue
          if (isSec[i]) ((lo2 = Math.min(lo2, b)), (hi2 = Math.max(hi2, b)))
          else ((lo1 = Math.min(lo1, b)), (hi1 = Math.max(hi1, b)))
        }
      })
    })
  const percent = cfg.stacking === 'percent'
  const logScale = fmt.str('valueAxis', 'axisScale', 'linear') === 'log' || fmt.bool('valueAxis', 'logAxisScale', false)
  const secLog = fmt.str('valueAxis', 'secAxisScale', 'linear') === 'log' || y2Bool(fmt, 'secLogAxisScale', 'secLogAxisScale', false)
  // value axis on the other side (vertical charts: right; bar charts: top)
  const valSwitched = fmt.str('valueAxis', 'position', 'Left') === 'Right' || fmt.bool('valueAxis', 'switchAxisPosition', false)
  const valInvert = fmt.bool('valueAxis', 'invertAxis', false)
  const catInvert = fmt.bool('categoryAxis', 'invertAxis', false)
  const zoomOn = fmt.bool('zoom', 'show', false) && !panel
  const zoomCat = zoomOn && fmt.bool('zoom', 'showOnCategoryAxis', true)
  const zoomVal = zoomOn && fmt.bool('zoom', 'showOnValueAxis', false)
  const ZOOM_BAR = 14
  // windows saved in the zoom object (restored when the slider hasn't been moved in this session)
  const savedZoom = zoomOn ? readSavedZoom(fmt.pc.objects, fmt.theme) : {}
  const catNumsOk = catNums.filter((x): x is number => x !== null)
  const contDomain: [number, number] | undefined = continuous && catNumsOk.length ? [Math.min(...catNumsOk), Math.max(...catNumsOk, forecastMaxX)] : undefined
  if (zoomCat && !czoom) czoom = savedCategoryWindow(savedZoom, data.categories.length, contDomain)
  let vFull: [number, number] | undefined
  let vWin: [number, number] | undefined

  // ---------------- iterative layout
  const catLabels = data.categories.map((c) => (concatenate || data.levels.length === 1 ? c.label : c.labels[c.labels.length - 1]))
  const outerLevels = !continuous && data.levels.length > 1 && !concatenate ? data.levels.length - 1 : 0
  const outerNeeded = vertical && outerLevels > 0
  const catLH = lineHeight(catT.font)
  const valFmt1 = { displayUnits: fmt.optNum('valueAxis', 'labelDisplayUnits'), precision: fmt.optNum('valueAxis', 'labelPrecision'), formatString: firstFormat(series, isSec, false), format: formatter, percent }
  const valFmt2 = { displayUnits: fmt.optNum(y2Obj(fmt, 'secLabelDisplayUnits'), 'secLabelDisplayUnits'), precision: fmt.optNum(y2Obj(fmt, 'secLabelPrecision'), 'secLabelPrecision'), formatString: firstFormat(series, isSec, true), format: formatter }
  // 100% stacked: the axis is exactly the stacked range — 0…100%, starting below zero when a category has negative
  // values (Power BI shows the negative part left of / below 0%) — never rounded out
  const start1 = percent ? fmt.optNum('valueAxis', 'start') ?? Math.min(0, snapFloat(lo1)) : fmt.optNum('valueAxis', 'start')
  const end1 = percent ? fmt.optNum('valueAxis', 'end') ?? 1 : fmt.optNum('valueAxis', 'end')
  const start2 = fmt.optNum(y2Obj(fmt, 'secStart'), 'secStart')
  const alignZeros = fmt.bool(y2Obj(fmt, 'alignZeros'), 'alignZeros', false)
  const end2 = fmt.optNum(y2Obj(fmt, 'secEnd'), 'secEnd')
  /** apply the Y zoom window (fractions of the full range) to an axis model */
  const zoomed = (m: ValueAxisModel, wIn: [number, number] | undefined, length: number, spacing: number): ValueAxisModel => {
    vFull = m.domain
    const w = zoomVal ? (wIn ?? savedValueWindow(savedZoom, m.domain)) : undefined
    vWin = w
    if (!w || (w[0] <= 0 && w[1] >= 1) || m.scale === 'log') return m
    const [d0, d1] = m.domain
    return computeValueAxis({ dataMin: d0 + w[0] * (d1 - d0), dataMax: d0 + w[1] * (d1 - d0), includeZero: false, start: d0 + w[0] * (d1 - d0), end: d0 + w[1] * (d1 - d0), length, tickSpacing: spacing })
  }

  let plot: Rect = { ...area }
  // Stacked total labels: Power BI makes room for them by extending the value range past the stacks instead of
  // rounding it out to a nice step — the longest bar plus its total label fill the plot, and a chart with negative
  // stacks gets the same room on the negative side (measured on Power BI renders of stacked bar charts; applied to
  // stacked columns by analogy — approximation). Explicit start / end values are honoured as they are.
  const totalsRoom = cfg.stacking === 'stacked' && barIdx.length > 0 && !logScale && start1 === undefined && end1 === undefined && fmt.bool('totals', 'show', false)
  const totalLabelRoom = (): number => {
    const tf = { size: ptToPx(fmt.num('totals', 'fontSize', PBI.dataLabelFontPt)), family: fmt.str('totals', 'fontFamily', PBI.fontFamily) }
    if (vertical) return lineHeight(tf) + 4
    const sums = data.categories.map((_, ci) => series.reduce((a, s, i) => (kinds[i] === 'bar' ? a + Math.abs(s.values[ci] ?? 0) : a), 0))
    const ref = Math.max(0, ...sums)
    const txt = formatWithUnits(ref, { unit: resolveDisplayUnit(fmt.optNum('totals', 'labelDisplayUnits') ?? 0, ref), decimals: fmt.optNum('totals', 'labelPrecision'), formatString: series[0]?.measure.formatString, format: formatter })
    return measureText(txt, tf) + 10
  }
  const totalRoomPx = totalsRoom ? totalLabelRoom() : 0
  /** primary value axis for a plot of `length` px along the value direction */
  const primaryAxis = (length: number, tickSpacing: number): ValueAxisModel => {
    if (!totalsRoom) return computeValueAxis({ dataMin: lo1, dataMax: hi1, includeZero: z1, start: start1, end: end1, scale: logScale ? 'log' : 'linear', length, tickSpacing })
    const lo = Math.min(0, lo1)
    const hi = Math.max(0, hi1)
    const above = hi > 0 ? totalRoomPx : 0
    const below = lo < 0 ? totalRoomPx : 0
    // value units per px once the label room is taken out of the plot (at least half of it stays for the bars)
    const k = (hi - lo) / Math.max(length / 2, length - above - below)
    return computeValueAxis({ dataMin: lo - below * k, dataMax: hi + above * k, includeZero: true, length, tickSpacing, nice: false })
  }
  let model1: ValueAxisModel = primaryAxis(vertical ? area.h * 0.75 : area.w * 0.75, vertical ? 50 : 90)
  let model2: ValueAxisModel | undefined
  let labels1: string[] = []
  let labels2: string[] = []
  let catLayout = { mode: 'horizontal' as 'horizontal' | 'rotated' | 'none', lines: [] as string[][], size: catLH + 4, every: 1 }
  let barLab = { lines: [] as string[][], width: 0, every: 1 }
  let contentLen = 0
  let viewLen = 0
  let catStep = 0
  const n = data.categories.length
  let leftReserve = 0
  let rightReserve = 0
  let outerH = 0
  let outerW = 0
  let valTop = false
  // series labels at the end of lines (seriesLabels object)
  const seriesLab = readSeriesLabels(fmt, series, kinds)
  const seriesLabW = vertical && seriesLab.show ? seriesLab.width : 0

  const fitCategories = (len: number) => {
    // PBI "Minimum category width": a category band never gets narrower than this; beyond that the
    // axis scrolls (or the zoom window decides what is visible)
    if (continuous) {
      contentLen = len
      catStep = n > 1 ? len / n : len
    } else {
      const naturalStep = len / Math.max(1, n)
      const minStep = minCatW
      if (naturalStep < minStep && n > 1 && !zoomCat && !panel) {
        contentLen = n * minStep
        catStep = minStep
      } else {
        contentLen = len
        catStep = naturalStep
      }
    }
    viewLen = len
    if (zoomCat && czoom && czoom[1] - czoom[0] < 1) {
      contentLen = len / Math.max(0.01, czoom[1] - czoom[0])
      catStep = continuous ? contentLen / Math.max(1, n) : contentLen / Math.max(1, n)
    }
  }

  for (let iter = 0; iter < 3; iter++) {
    if (vertical) {
      const plotHGuess = Math.max(10, plot.h)
      model1 = zoomed(primaryAxis(plotHGuess, 50), vzoom, plotHGuess, 50)
      labels1 = model1.ticks.map(valueTickFormatter(model1, valFmt1))
      if (anySec) {
        // The secondary axis gets its own range and ticks (a Power BI render of a combo chart: its labels are not on the
        // primary gridlines and its zero is not level with the primary zero); "Align zeros" (valueAxis.alignZeros)
        // extends the axes so both zeros are at the same height (explicit start / end values are kept).
        model2 = secLog
          ? computeValueAxis({ dataMin: lo2, dataMax: hi2, includeZero: z2, start: start2, end: end2, scale: 'log', length: plotHGuess, tickSpacing: 50 })
          : computeValueAxis({ dataMin: lo2, dataMax: hi2, includeZero: z2 || alignZeros, start: start2, end: end2, length: plotHGuess, tickSpacing: 50 })
        if (alignZeros && start1 == null && end1 == null && start2 == null && end2 == null && !vzoom) {
          ;[model1, model2] = alignZeroAxes(model1, model2)
          labels1 = model1.ticks.map(valueTickFormatter(model1, valFmt1))
        }
        labels2 = model2.ticks.map(valueTickFormatter(model2, valFmt2))
      }
      const lw = valShow ? Math.ceil(maxLabelWidth(labels1, valT.font)) + 8 : 0
      const rw = anySec && secAxisShow ? Math.ceil(maxLabelWidth(labels2, secT.font)) + 8 : 0
      const zw = zoomVal ? ZOOM_BAR + 2 : 0
      leftReserve = 0
      rightReserve = 0
      let left = (!valSwitched ? lw + valTitleH + zw : rw + secTitleH) + 4
      let right = !valSwitched ? rw + secTitleH : lw + valTitleH + zw
      // half of the first/last category label can hang over the edges: keep a small margin
      right = Math.max(right, 8) + (seriesLab.position === 'Right' ? seriesLabW : 0)
      left = Math.max(left, 6) + (seriesLab.position === 'Left' ? seriesLabW : 0)
      if (panel?.margins) {
        left = panel.margins.left - area.x
        right = panel.margins.right - (W - area.x - area.w)
      }
      const plotW = Math.max(10, area.w - left - right)
      fitCategories(plotW)
      const maxCatH = Math.max(catLH + 4, H * maxMargin + catLH)
      if (catShow && !continuous) catLayout = layoutCategoryLabels(catLabels, catStep, catT.font, maxCatH, true)
      else if (catShow) catLayout = { mode: 'horizontal', lines: [], size: catLH + 4, every: 1 }
      else catLayout = { mode: 'none', lines: [], size: 0, every: 1 }
      outerH = outerNeeded && catShow ? (catLH + 4) * outerLevels : 0
      const scrollH = zoomCat ? ZOOM_BAR + 4 : contentLen > viewLen + 0.5 ? 8 : 0
      // keep room for half of the lowest value label when there are no category labels
      const bottom = panel?.margins ? panel.margins.bottom - (H - area.y - area.h) : Math.max(catLayout.size + outerH + catTitleH + scrollH + 2, valShow ? Math.ceil(lineHeight(valT.font) / 2) + 2 : 2)
      const top = panel?.margins ? panel.margins.top - area.y : 6
      plot = { x: area.x + left, y: area.y + top, w: plotW, h: Math.max(10, area.h - top - bottom) }
      leftReserve = area.x
      rightReserve = W - (area.x + area.w)
    } else {
      // horizontal bars: categories on the left, values at the bottom (or top when switched)
      const plotWGuess = Math.max(10, plot.w)
      model1 = zoomed(primaryAxis(plotWGuess, 90), vzoom, plotWGuess, 90)
      labels1 = model1.ticks.map(valueTickFormatter(model1, valFmt1))
      const valH = valShow ? catLH + 6 : 0
      const zh = zoomVal ? ZOOM_BAR + 4 : 0
      valTop = valSwitched
      const plotH0 = panel?.margins ? Math.max(10, H - panel.margins.top - panel.margins.bottom + 4) : Math.max(10, area.h - valH - valTitleH - 6 - zh)
      fitCategories(plotH0)
      const maxLabW = Math.max(20, area.w * maxMargin + 10)
      barLab = catShow ? layoutBarLabels(catLabels, catStep, catT.font, maxLabW) : { lines: [], width: 0, every: 1 }
      outerW = outerLevels && catShow ? outerLevels * Math.min(Math.max(...data.categories.map((c) => measureText(c.labels[0] ?? '', catT.font))) + 10, area.w * 0.2) : 0
      const lastLabelHalf = valShow ? Math.ceil(measureText(labels1[labels1.length - 1] ?? '', valT.font) / 2) : 0
      const firstLabelHalf = valShow ? Math.ceil(measureText(labels1[0] ?? '', valT.font) / 2) + 2 : 0
      const zw = zoomCat ? ZOOM_BAR + 4 : contentLen > viewLen + 0.5 ? 8 : 0
      const left = panel?.margins ? panel.margins.left - area.x : Math.max(barLab.width + catTitleH + outerW + 4, firstLabelHalf)
      // No room is reserved for the data labels of clustered bars: like Power BI, the bars run to the end of the value
      // range and a label that doesn't fit outside its bar is drawn inside it (total labels: see `primaryAxis`).
      const right = panel?.margins ? panel.margins.right - (W - area.x - area.w) : Math.max(lastLabelHalf + 2, 8) + zw
      const topY = panel?.margins ? panel.margins.top : area.y + 4 + (valTop ? valH + valTitleH : 0)
      plot = { x: area.x + left, y: topY, w: Math.max(10, area.w - left - right), h: plotH0 - 4 }
      viewLen = plot.h
      if (contentLen <= plotH0 && !(zoomCat && czoom && czoom[1] - czoom[0] < 1)) contentLen = plot.h
      else if (zoomCat && czoom && czoom[1] - czoom[0] < 1) contentLen = plot.h / Math.max(0.01, czoom[1] - czoom[0])
    }
  }

  // ---------------- value pixel mappers (invert range = flip the axis)
  const v1 = valueToPx(model1, vertical ? plot.h : plot.w, false)
  const v1px = vertical ? (valInvert ? (v: number) => plot.y + v1(v) : (v: number) => plot.y + plot.h - v1(v)) : valInvert ? (v: number) => plot.x + plot.w - v1(v) : (v: number) => plot.x + v1(v)
  let v2px: ((v: number) => number) | undefined
  if (model2) {
    const v2 = valueToPx(model2, plot.h, false)
    v2px = valInvert ? (v: number) => plot.y + v2(v) : (v: number) => plot.y + plot.h - v2(v)
  }
  const vpx = (i: number) => (isSec[i] && v2px ? v2px : v1px)

  // ---------------- category positions (in content coordinates)
  let catNumScale: ((x: number) => number) | undefined
  let band = bandLayout(n, contentLen, innerPad)
  if (catInvert && !continuous) {
    // "Invert range": last category first
    const b0 = band
    band = { ...b0, pos: (i) => b0.pos(n - 1 - i) }
  }
  let catCenter = (i: number) => band.pos(i) + band.bandwidth / 2
  let barThickness = band.bandwidth
  if (continuous) {
    const nums = catNums.filter((x): x is number => x !== null)
    const lo = Math.min(...nums)
    const hi = Math.max(...nums, forecastMaxX)
    const minGap = nums.length > 1 ? Math.min(...nums.slice(1).map((x, i) => x - nums[i]).filter((d) => d > 0)) : 1
    const hasBars = barIdx.length > 0
    const pad = hasBars ? (minGap || 1) / 2 : 0
    const s = scaleLinear()
      .domain([lo - pad, hi + pad || lo + 1])
      .range(catInvert ? [contentLen, 0] : [0, contentLen])
    catCenter = (i) => s(catNums[i] ?? lo)
    catNumScale = (x: number) => s(x)
    barThickness = Math.max(1, (minGap && Number.isFinite(minGap) ? Math.abs(s(lo + minGap) - s(lo)) : contentLen / Math.max(1, n)) * (1 - innerPad))
    band = { step: barThickness / (1 - innerPad || 1), bandwidth: barThickness, offset: 0, pos: (i) => catCenter(i) - barThickness / 2 }
  }

  // ---------------- bars
  const bars: BarGeom[] = []
  const stacked = cfg.stacking !== 'clustered'
  const barSeries = barIdx.filter((i) => true || !isSec[i])
  const clusterN = stacked ? 1 : barSeries.length
  const labelPosDefault = barLabelPositionDefault(cfg.stacking, barSeries.length)
  const zeroPx = (i: number) => vpx(i)(model1.scale === 'log' ? model1.domain[0] : Math.max(Math.min(0, isSec[i] && model2 ? model2.domain[1] : model1.domain[1]), isSec[i] && model2 ? model2.domain[0] : model1.domain[0]))
  barSeries.forEach((si, k) => {
    const s = series[si]
    const labelPos = fmt.sStr('labels', 'labelPosition', labelPosDefault, s)
    for (let ci = 0; ci < n; ci++) {
      const v = s.values[ci]
      if (v === null || !Number.isFinite(v)) continue
      const start = band.pos(ci) + (stacked ? 0 : (barThickness / clusterN) * k)
      const end = start + barThickness / clusterN
      let a: number
      let b: number
      let ha: number | undefined
      let hb: number | undefined
      const seg = stacks.bar?.[si]?.[ci]
      if (stacked && seg) {
        a = vpx(si)(seg[0])
        b = vpx(si)(seg[1])
        const hs = hstacks.bar?.[si]?.[ci]
        if (hs) {
          ha = vpx(si)(hs[0])
          hb = vpx(si)(hs[1])
        } else if (data.hasHighlights) {
          ha = a
          hb = a
        }
      } else {
        a = zeroPx(si)
        b = vpx(si)(v)
        const h = s.highlights?.[ci]
        if (data.hasHighlights) {
          ha = a
          hb = h === null || h === undefined ? a : vpx(si)(h)
        }
      }
      bars.push({ si, ci, c0: start, c1: end, v0: a, v1: b, hv0: ha, hv1: hb, value: v, labelPos })
    }
  })

  // ---------------- ribbons (between adjacent stacked columns, same series)
  const ribbons: Layout['ribbons'] = []
  if (cfg.ribbon && stacked) {
    // ribbon chart ranks series within each column: largest on top
    const order = Array.from({ length: n }, (_, ci) =>
      barSeries
        .filter((si) => (series[si].values[ci] ?? null) !== null)
        .sort((x, y) => (series[x].values[ci] ?? 0) - (series[y].values[ci] ?? 0))
    )
    // recompute stacked segments with ranking
    const segs = new Map<string, [number, number]>()
    for (let ci = 0; ci < n; ci++) {
      let acc = 0
      for (const si of order[ci]) {
        const v = Math.max(0, series[si].values[ci] ?? 0)
        segs.set(`${si}|${ci}`, [acc, acc + v])
        acc += v
      }
    }
    for (const b of bars) {
      const seg = segs.get(`${b.si}|${b.ci}`)
      if (seg) {
        b.v0 = vpx(b.si)(seg[0])
        b.v1 = vpx(b.si)(seg[1])
      }
    }
    // ribbons need a gap between columns: shrink bars to 60% of band
    const gapShrink = 0.6
    for (const b of bars) {
      const mid = (b.c0 + b.c1) / 2
      const half = ((b.c1 - b.c0) * gapShrink) / 2
      b.c0 = mid - half
      b.c1 = mid + half
    }
    for (const si of barSeries) {
      for (let ci = 0; ci < n - 1; ci++) {
        const a = segs.get(`${si}|${ci}`)
        const b = segs.get(`${si}|${ci + 1}`)
        if (!a || !b) continue
        const ba = bars.find((x) => x.si === si && x.ci === ci)
        const bb = bars.find((x) => x.si === si && x.ci === ci + 1)
        if (!ba || !bb) continue
        ribbons.push({
          si,
          ci,
          quad: [
            [ba.c1, vpx(si)(a[0])],
            [bb.c0, vpx(si)(b[0])],
            [bb.c0, vpx(si)(b[1])],
            [ba.c1, vpx(si)(a[1])]
          ]
        })
      }
    }
  }

  // ---------------- lines / areas
  const lines: LineGeom[] = []
  series.forEach((s, si) => {
    if (kinds[si] === 'bar') return
    const isArea = kinds[si] === 'area' || fmt.sBool('lineStyles', 'areaShow', false, s)
    const seg = stacks.area?.[si]
    const points = s.values.map((v, ci) => {
      if (v === null || !Number.isFinite(v)) return null
      const c = catCenter(ci)
      if (seg?.[ci]) return { c, v: vpx(si)(seg[ci]![1]), base: vpx(si)(seg[ci]![0]) }
      return { c, v: vpx(si)(v), base: zeroPx(si) }
    })
    const style = fmt.sStr('lineStyles', 'lineStyle', 'solid', s)
    const width = fmt.sNum('lineStyles', 'strokeWidth', 3, s)
    const lct = fmt.sStr('lineStyles', 'lineChartType', fmt.sBool('lineStyles', 'stepped', false, s) ? 'step' : 'linear', s)
    const markerSize = fmt.sNum('lineStyles', 'markerSize', 5, s)
    const density = fmt.num('labels', 'labelDensity', 50)
    const pxPer = n > 1 ? contentLen / n : contentLen
    const labelEvery = Math.max(1, Math.ceil(40 / Math.max(1, pxPer) / Math.max(0.2, density / 50)))
    const customDash = fmt.sStr('lineStyles', 'strokeDashArray', '', s)
    const areaT = fmt.seriesRaw('lineStyles', 'areaTransparency', s) ?? fmt.seriesRaw('dataPoint', 'transparency', s) ?? fmt.seriesRaw('lineStyles', 'shadeTransparency', s)
    const areaMatch = fmt.sBool('lineStyles', 'areaMatchStrokeColor', true, s)
    lines.push({
      si,
      points,
      area: isArea,
      areaOpacity: 1 - (Number.isFinite(Number(areaT)) && areaT !== null && areaT !== undefined ? Number(areaT) : 60) / 100,
      areaColor: areaMatch ? undefined : fmt.sColor('lineStyles', 'areaColor', s),
      width: Math.max(0.5, width * (4 / 3) * 0.75),
      dash: style === 'custom' && customDash ? customDash.replace(/,/g, ' ') : style === 'dashed' ? `${width * 2.5} ${width * 1.5}` : style === 'dotted' ? `${width * 0.1} ${width * 1.6}` : undefined,
      dashCap: fmt.sStr('lineStyles', 'strokeDashCap', style === 'dotted' ? 'round' : 'butt', s),
      strokeShow: fmt.sBool('lineStyles', 'strokeShow', true, s),
      strokeOpacity: 1 - fmt.sNum('lineStyles', 'strokeTransparency', 0, s) / 100,
      lineJoin: fmt.sStr('lineStyles', 'strokeLineJoin', 'round', s),
      curve: lct === 'smooth' ? 'smooth' : lct === 'step' ? 'step' : 'linear',
      smoothType: fmt.sStr('lineStyles', 'interpolationSmooth', 'monotoneX', s),
      tension: fmt.sNum('lineStyles', 'interpolationSmoothParam', 0.5, s),
      stepPos: fmt.sStr('lineStyles', 'interpolationStep', 'center', s),
      marker: fmt.sBool('lineStyles', 'showMarker', false, s),
      markerShape: fmt.sStr('lineStyles', 'markerShape', 'circle', s),
      markerSize: Math.max(2, markerSize * 0.6),
      markerColor: fmt.sColor('lineStyles', 'markerColor', s),
      labelEvery,
      labelPos: fmt.sStr('labels', 'labelPosition', LINE_LABEL_POSITION_DEFAULT, s)
    })
  })

  // ---------------- data label styles
  const maxAbs = Math.max(0, ...series.flatMap((s) => s.values.map((v) => Math.abs(v ?? 0))))
  const labelCache = new Map<string, LabelStyle>()
  const labelStyleFor = (s: Series): LabelStyle => {
    const hit = labelCache.get(s.key)
    if (hit) return hit
    const show = fmt.bool('labels', 'show', false) && fmt.sBool('labels', 'showSeries', true, s) && fmt.sBool('labels', 'show', true, s)
    const sz = fmt.sNum('labels', 'fontSize', PBI.dataLabelFontPt, s)
    const fam = fmt.sStr('labels', 'fontFamily', labelDerivedClass(fmt.theme, 'smallLightLabel').family, s)
    const bold = fmt.sBool('labels', 'bold', false, s)
    const italic = fmt.sBool('labels', 'italic', false, s)
    const color = fmt.sColor('labels', 'color', s)
    // Label background: off unless set (Power BI's format-pane default). A light box behind combo-chart line labels by
    // default was tried from a single Power BI render and withdrawn: one visual does not establish a default.
    const bgOn = fmt.sBool('labels', 'enableBackground', false, s)
    const bgC = fmt.sColor('labels', 'backgroundColor', s) ?? '#FFFFFF'
    const bgT = fmt.sNum('labels', 'backgroundTransparency', 90, s)
    const units = fmt.sNum('labels', 'labelDisplayUnits', 0, s)
    const prec = fmt.seriesRaw('labels', 'labelPrecision', s)
    const unit = resolveDisplayUnit(units, maxAbs)
    const st: LabelStyle = {
      show,
      font: { size: ptToPx(sz), family: fam, weight: bold ? 700 : fam.toLowerCase().includes('semibold') ? 600 : 400, italic },
      color,
      background: bgOn ? rgba(bgC, 1 - bgT / 100) : undefined,
      format: (v, f) => formatWithUnits(v, { unit, decimals: typeof prec === 'number' ? prec : undefined, formatString: f ?? s.measure.formatString, format: formatter })
    }
    labelCache.set(s.key, st)
    return st
  }

  // ---------------- totals
  const totals: Layout['totals'] = []
  if (stacked && fmt.bool('totals', 'show', false) && barIdx.length) {
    const tt = fmt.text('totals', {}, { size: PBI.dataLabelFontPt, color: PBI.dataLabelColor })
    const tu = fmt.optNum('totals', 'labelDisplayUnits') ?? 0
    const tp = fmt.optNum('totals', 'labelPrecision')
    const sums = Array.from({ length: n }, (_, ci) => barIdx.reduce((a, si) => a + (series[si].values[ci] ?? 0), 0))
    const unit = resolveDisplayUnit(tu, Math.max(...sums.map(Math.abs)))
    for (let ci = 0; ci < n; ci++) {
      let top = 0
      let bottom = 0
      for (const si of barIdx) {
        const seg = stacks.bar?.[si]?.[ci]
        if (seg) {
          top = Math.max(top, seg[1])
          bottom = Math.min(bottom, seg[0])
        }
      }
      const neg = sums[ci] < 0
      totals.push({
        ci,
        c: catCenter(ci),
        v: v1px(neg ? bottom : top),
        text: formatWithUnits(sums[ci], { unit, decimals: tp, formatString: series[barIdx[0]].formats[ci] ?? series[barIdx[0]].measure.formatString, format: formatter }),
        font: tt.font,
        color: tt.color,
        neg
      })
    }
  }

  // ---------------- analytics positions
  const analytics = analyticsSpec
    .map((a) => {
      if (a.kind === 'trend' && a.points) {
        const si = a.si ?? 0
        return { ...a, c0: catCenter(a.points[0][0]), v0: vpx(si)(a.points[0][1]), c1: catCenter(a.points[1][0]), v1: vpx(si)(a.points[1][1]) }
      }
      if (a.kind === 'xConstant') {
        // X-axis constant line: only meaningful on a continuous (numeric / date) category axis
        if (!continuous || !catNumScale) return null
        return { ...a, c0: catNumScale(a.value) }
      }
      return a
    })
    .filter((a): a is AnalyticsLine => a !== null)

  // ---------------- series labels (end of line)
  const seriesLabelItems: Layout['seriesLabelItems'] = []
  if (seriesLab.show && vertical) {
    const lh = lineHeight(seriesLab.font)
    const items = lines
      .map((ln) => {
        const idxs = ln.points.map((p, i) => (p ? i : -1)).filter((i) => i >= 0)
        if (!idxs.length) return null
        const ci = seriesLab.position === 'Right' ? idxs[idxs.length - 1] : idxs[0]
        return { si: ln.si, y: ln.points[ci]!.v, text: ellipsize(series[ln.si].name, seriesLab.maxWidth, seriesLab.font) }
      })
      .filter((x): x is { si: number; y: number; text: string } => x !== null)
    const ys = spreadLabels(
      items.map((i) => i.y),
      items.map(() => lh),
      plot.y,
      plot.y + plot.h
    )
    const secW = anySec && secAxisShow ? Math.ceil(maxLabelWidth(labels2, secT.font)) + 8 + secTitleH : 0
    const x = seriesLab.position === 'Right' ? plot.x + plot.w + (valSwitched ? 0 : secW) + (seriesLab.leaderLines ? 12 : 4) : plot.x - (valShow ? Math.ceil(maxLabelWidth(labels1, valT.font)) + 8 + valTitleH : 0) - (seriesLab.leaderLines ? 12 : 4)
    items.forEach((it, k) => {
      const s = series[it.si]
      seriesLabelItems.push({
        si: it.si,
        text: it.text,
        x,
        y: ys[k],
        anchor: seriesLab.position === 'Right' ? 'start' : 'end',
        color: seriesLab.color ?? s.color,
        leader: seriesLab.leaderLines ? [seriesLab.position === 'Right' ? plot.x + plot.w : plot.x, it.y] : undefined,
        background: seriesLab.background ? (seriesLab.matchBackground ? s.color : seriesLab.background) : undefined,
        backgroundOpacity: seriesLab.backgroundOpacity
      })
    })
  }

  // ---------------- error bars (Analytics ▸ Error bars)
  const errorBars: Layout['errorBars'] = []
  if (errorSpecs.length) {
    series.forEach((s, si) => {
      const spec = errorSpecFor(errorSpecs, s)
      if (!spec) return
      const k = errorSpecs.indexOf(spec)
      const up = s.pointValues?.[`eu${k}`]
      const lo = s.pointValues?.[`el${k}`]
      if (!up && !lo) return
      const color = spec.barMatchSeriesColor || !spec.barColor ? s.color : spec.barColor
      const pts: Layout['errorBars'][number]['points'] = []
      for (let ci = 0; ci < n; ci++) {
        const v = s.values[ci]
        if (v === null || !Number.isFinite(v)) continue
        const [l, h] = errorBounds(spec, v, up?.[ci], lo?.[ci])
        if (l === null && h === null) continue
        const bar = bars.find((b) => b.si === si && b.ci === ci)
        const c = bar ? (bar.c0 + bar.c1) / 2 : catCenter(ci)
        pts.push({ ci, c, lo: l === null ? null : vpx(si)(l), hi: h === null ? null : vpx(si)(h), loV: l, hiV: h })
      }
      errorBars.push({ si, spec, color, shadeColor: spec.shadeMatchSeriesColor || !spec.shadeColor ? s.color : spec.shadeColor, points: pts, isLine: kinds[si] !== 'bar' })
    })
  }

  // ---------------- anomalies (Analytics ▸ Find anomalies, line charts)
  const anomalies: Layout['anomalies'] = []
  for (const e of fmt.pc.objects?.anomalyDetection ?? []) {
    const p = e.properties ?? {}
    if (decodeValue(p.show, fmt.theme) !== true) continue
    const meta = e.selector?.metadata
    for (const ln of lines) {
      const s = series[ln.si]
      if (meta && s.metadata !== meta) continue
      if (!meta && s.metadata !== series.find((x, i) => kinds[i] !== 'bar')?.metadata) continue
      const sens = Number(decodeValue(p.sensitivity, fmt.theme) ?? 70)
      const res = detectAnomalies(s.values, Number.isFinite(sens) ? sens : 70)
      if (!res) continue
      const dv = (k: string) => decodeValue(p[k], fmt.theme)
      const bandStyle = String(dv('confidenceBandStyle') ?? 'fill')
      const markerColor = typeof dv('markerColor') === 'string' ? (dv('markerColor') as string) : '#6B007B'
      anomalies.push({
        si: ln.si,
        band: dv('confidenceBandShow') === false || bandStyle === 'none' ? undefined : res.low.map((l, ci) => (l === null ? null : { c: catCenter(ci), lo: vpx(ln.si)(l), hi: vpx(ln.si)(res.high[ci] as number), loV: l, hiV: res.high[ci] as number, exp: res.expected[ci] as number })),
        bandStyle,
        bandColor: typeof dv('confidenceBandColor') === 'string' ? (dv('confidenceBandColor') as string) : s.color,
        bandOpacity: 1 - Number(dv('transparency') ?? 80) / 100,
        markers: res.anomalies.map((ci) => ({ ci, c: catCenter(ci), v: vpx(ln.si)(s.values[ci] as number) })),
        markerShow: dv('markerShow') !== false,
        markerShape: String(dv('markerShape') ?? 'circle'),
        markerSize: Number(dv('markerShapeSize') ?? 6) || 6,
        markerColor
      })
    }
  }

  // ---------------- forecasts (positions)
  const forecasts: Layout['forecasts'] = forecastRaw.map(({ si, f }) => {
    const s = series[si]
    const sp = f.spec
    const color = sp.lineColor ?? FORECAST_DEFAULT_COLOR
    const xs = (x: number) => catNumScale!(x)
    const vp = vpx(si)
    return {
      si,
      name: sp.displayName,
      color,
      width: sp.width,
      opacity: sp.opacity,
      dash: sp.style === 'custom' && sp.dashArray ? sp.dashArray : DASH[sp.style],
      smooth: sp.interpolation === 'smooth',
      step: sp.interpolation === 'step',
      line: [[xs(f.anchor.x), vp(f.anchor.y)] as [number, number], ...f.points.map((p) => [xs(p.x), vp(p.mean)] as [number, number])],
      band: [{ c: xs(f.anchor.x), lo: vp(f.anchor.y), hi: vp(f.anchor.y) }, ...f.points.map((p) => ({ c: xs(p.x), lo: vp(p.lower), hi: vp(p.upper) }))],
      bandArea: sp.bandArea.show ? { color: sp.bandArea.color ?? color, opacity: sp.bandArea.opacity } : undefined,
      bandLine: sp.bandLine.show ? { color: sp.bandLine.color ?? color, opacity: sp.bandLine.opacity, width: sp.bandLine.width, dash: sp.bandLine.style === 'custom' && sp.bandLine.dashArray ? sp.bandLine.dashArray : DASH[sp.bandLine.style] } : undefined,
      points: f.points.map((p) => ({ x: p.x, c: xs(p.x), v: vp(p.mean), mean: p.mean, lower: p.lower, upper: p.upper })),
      formatString: s.measure.formatString,
      confidence: sp.confidence,
      period: f.result.period
    }
  })

  // ---------------- axes render specs
  const grid = readGrid(fmt, 'valueAxis', true)
  const valSide: 'left' | 'right' = valSwitched ? 'right' : 'left'
  const unitTitle = (text: string, m: ValueAxisModel, units: number | undefined, isPercent: boolean, obj: string, prop: string) => {
    const style = fmt.str(obj, prop, 'showTitleOnly')
    if (style === 'showTitleOnly' || isPercent) return text
    const u = resolveDisplayUnit(units, Math.max(0, ...m.ticks.map(Math.abs)))
    const name = UNIT_NAMES[u]
    if (!name) return text
    return style === 'showUnitOnly' ? name : `${text} (${name})`
  }
  const valueAxes: ValueAxisRender[] = [
    {
      secondary: false,
      side: valSide,
      show: valShow,
      ticks: model1.ticks,
      labels: labels1,
      px: v1px,
      font: valT.font,
      color: valT.color,
      grid,
      title: valTitleH ? { text: unitTitle(valTitleText, model1, valFmt1.displayUnits, percent, 'valueAxis', 'axisStyle'), font: valTitleT.font, color: valTitleT.color, size: valTitleH } : undefined
    }
  ]
  if (model2 && v2px)
    valueAxes.push({
      secondary: true,
      side: valSide === 'left' ? 'right' : 'left',
      show: secAxisShow,
      ticks: model2.ticks,
      labels: labels2,
      px: v2px,
      font: secT.font,
      color: secT.color,
      title: secTitleH ? { text: unitTitle(secTitleText, model2, valFmt2.displayUnits, false, y2Obj(fmt, 'secAxisStyle'), 'secAxisStyle'), font: valTitleT.font, color: valTitleT.color, size: secTitleH } : undefined
    })

  // category ticks
  let catTicks: Layout['catTicks'] = []
  if (continuous && catShow) {
    const nums = catNums.filter((x): x is number => x !== null)
    if (nums.length) {
      const isDate = data.categoryType === 'date'
      const xHi = Math.max(...nums, forecastMaxX)
      const ticks = nums.length === 1 && xHi === nums[0] ? [nums[0]] : continuousTicks(Math.min(...nums), xHi, contentLen, isDate, isDate ? 75 : 60, nums.every(Number.isInteger))
      const sFwd = (x: number) => {
        if (catNumScale) return catNumScale(x)
        // invert catCenter via linear interpolation over categories
        const lo = Math.min(...nums)
        const hi = Math.max(...nums)
        const i0 = catNums.indexOf(lo)
        const i1 = catNums.indexOf(hi)
        const p0 = catCenter(i0)
        const p1 = catCenter(i1)
        return hi === lo ? p0 : p0 + ((x - lo) / (hi - lo)) * (p1 - p0)
      }
      const fmtTick = isDate ? dateTickFormatter(ticks) : (x: number) => formatWithUnits(x, { unit: 1, formatString: data.levels[0].formatString, format: formatter })
      catTicks = ticks.map((t) => ({ c: sFwd(t), lines: [fmtTick(t)], full: isDate ? formatDate(new Date(t), undefined, undefined) : String(t) }))
    }
  } else if (catShow) {
    if (vertical) catTicks = catLabels.map((l, i) => ({ c: catCenter(i), lines: catLayout.lines[i] ?? [], full: data.categories[i].label }))
    else catTicks = catLabels.map((l, i) => ({ c: catCenter(i), lines: barLab.lines[i] ?? [], full: data.categories[i].label }))
  }
  const catGrid = readGrid(fmt, 'categoryAxis', false)

  // outer hierarchy groups
  // PBI's hierarchical axis (concatenate labels off): one row per outer level below the inner
  // labels, each group centred under its span with separators between groups.
  const outerGroups: Layout['outerGroups'] = []
  if (outerLevels > 0 && catShow) {
    const gap = (band.step - band.bandwidth) / 2
    for (let L = 0; L < outerLevels; L++) {
      const row = outerLevels - 1 - L
      let startI = 0
      for (let i = 1; i <= n; i++) {
        const prev = data.categories[i - 1].labels.slice(0, L + 1).join('\u0001')
        const cur = i < n ? data.categories[i].labels.slice(0, L + 1).join('\u0001') : null
        if (cur !== prev) {
          const a = band.pos(startI)
          const b = band.pos(i - 1)
          outerGroups.push({ c0: Math.min(a, b) - gap, c1: Math.max(a, b) + band.bandwidth + gap, label: data.categories[i - 1].labels[L] ?? '', row })
          startI = i
        }
      }
    }
  }

  const plotBgColor = fmt.optStr('plotArea', 'color')
  const plotBgT = fmt.num('plotArea', 'transparency', 0)

  return {
    plot,
    plotBg: plotBgColor ? rgba(plotBgColor, 1 - plotBgT / 100) : undefined,
    legend: { size: lg.size },
    legendStyle,
    legendRect,
    legendItems,
    bars,
    ribbons,
    lines,
    totals,
    analytics,
    valueAxes,
    v1px,
    v2px,
    catShow,
    catFont: catT.font,
    catColor: catT.color,
    catMode: continuous ? 'horizontal' : catLayout.mode,
    catTicks,
    catStep,
    catGrid,
    catTitle: catTitleH ? { text: catTitleText, font: catTitleT.font, color: catTitleT.color } : undefined,
    catTitleY: vertical ? plot.y + plot.h + catLayout.size + outerH + catTitleH / 2 + 2 : area.x + catTitleH / 2,
    valueTitleY: valTop ? plot.y - catLH - 6 - valTitleH / 2 : plot.y + plot.h + catLH + 6 + valTitleH / 2,
    outerGroups,
    seriesLabelItems,
    seriesLabelFont: seriesLab.font,
    errorBars,
    anomalies,
    forecasts,
    zoomCat,
    zoomVal,
    zoomWin: { c: czoom ?? [0, 1], v: vWin ?? [0, 1] },
    zoomProps: {
      category: (w) => categoryZoomProps(w, data.categories.length, contDomain),
      value: (w) => (vFull ? valueZoomProps(w, vFull) : {})
    },
    zoomValX: valSwitched ? plot.x + plot.w + (W - plot.x - plot.w) - 8 : area.x + 8,
    outerW,
    innerLabelW: barLab.width,
    valTop,
    outerY: plot.y + plot.h + catLayout.size,
    contentLen,
    viewLen,
    stacked,
    soleStack: cfg.stacking === 'stacked' && barSeries.length === 1,
    clipPlot: start1 !== undefined || end1 !== undefined || logScale,
    axisFont: valT.font,
    leftReserve,
    rightReserve,
    labelStyleFor
  }
}

/**
 * Natural plot margins of a panel (small multiples): the space the panel's own axes, labels and
 * titles need around its plot area at this size.
 */
export function panelMargins(data: CategoricalData, json: any, theme: VisualProps['ctx']['theme'], config: CartesianConfig, W: number, H: number, formatter: VisualProps['ctx']['format'], panel: PanelOptions): { left: number; top: number; right: number; bottom: number } {
  const fmt = new FormatReader(json, theme)
  const L = computeLayout(data, fmt, config, W, H, formatter, { ...panel, margins: undefined }, {}, readErrorBars(fmt))
  return { left: L.plot.x, top: L.plot.y, right: W - L.plot.x - L.plot.w, bottom: H - L.plot.y - L.plot.h }
}

function toNum(v: unknown): number | null {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return v
  return null
}

function firstFormat(series: Series[], isSec: boolean[], sec: boolean): string | undefined {
  const i = series.findIndex((_, k) => isSec[k] === sec)
  return i >= 0 ? (series[i].formats.find((f) => f) ?? series[i].measure.formatString) : undefined
}

/** PBI-like continuous date tick labels: years → "2024", months → "Jan 2024", days → "Jan 05". */
export function dateTickFormatter(ticks: number[]): (t: number) => string {
  const ds = ticks.map((t) => new Date(t))
  const allJan1 = ds.every((d) => d.getUTCMonth() === 0 && d.getUTCDate() === 1)
  const allFirst = ds.every((d) => d.getUTCDate() === 1)
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  if (allJan1) return (t) => String(new Date(t).getUTCFullYear())
  if (allFirst) return (t) => `${M[new Date(t).getUTCMonth()]} ${new Date(t).getUTCFullYear()}`
  return (t) => {
    const d = new Date(t)
    return `${M[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')}`
  }
}

/** Secondary-axis properties live in `y2Axis` (current PBI) or `valueAxis.sec*` (older reports). */
function y2Obj(fmt: FormatReader, prop: string): 'y2Axis' | 'valueAxis' {
  const has = (o: string) => (fmt.pc.objects?.[o] ?? []).some((e: any) => !e.selector && e.properties && prop in e.properties)
  return has('y2Axis') ? 'y2Axis' : has('valueAxis') ? 'valueAxis' : 'y2Axis'
}

function y2Bool(fmt: FormatReader, y2Prop: string, legacyProp: string, fallback: boolean): boolean {
  const has = (o: string, p: string) => (fmt.pc.objects?.[o] ?? []).some((e: any) => !e.selector && e.properties && p in e.properties)
  if (has('y2Axis', y2Prop)) return fmt.bool('y2Axis', y2Prop, fallback)
  if (has('valueAxis', legacyProp)) return fmt.bool('valueAxis', legacyProp, fallback)
  return fmt.bool('y2Axis', y2Prop, fallback)
}

/** Zoom slider windows as fractions [lo, hi] of the full category / value range. */
export interface ZoomState {
  c?: [number, number]
  v?: [number, number]
}

interface GridSpec {
  color: string
  width: number
  style: string
  dash?: string
  opacity: number
}

const UNIT_NAMES: Record<number, string> = { 1000: 'Thousands', 1000000: 'Millions', 1000000000: 'Billions', 1000000000000: 'Trillions' }

/**
 * Gridline formatting (PBI: dotted #C8C6C4 1px by default; custom dash arrays; transparency). An axis switched off
 * takes its gridlines with it, whatever `gridlineShow` says: on a Power BI Desktop render a clustered bar chart with
 * `valueAxis.show` false has no gridlines while a combo chart on the same page draws them, and "show gridlines
 * without the axis" is a known Power BI limitation (the usual workaround is an axis with invisible labels).
 */
export function readGrid(fmt: FormatReader, obj: string, defaultShow: boolean): GridSpec | undefined {
  if (!fmt.bool(obj, 'show', true)) return undefined
  if (!fmt.bool(obj, 'gridlineShow', defaultShow)) return undefined
  const width = fmt.num(obj, 'gridlineThickness', 1)
  const style = fmt.str(obj, 'gridlineStyle', 'dotted')
  const custom = fmt.optStr(obj, 'gridlineDashArray')
  const dash = style === 'custom' && custom ? custom.replace(/,/g, ' ') : style === 'dashed' ? `${4 * width} ${3 * width}` : style === 'dotted' ? `${width} ${2 * width}` : undefined
  return { color: fmt.color(obj, 'gridlineColor', PBI.gridColor), width, style, dash, opacity: 1 - fmt.num(obj, 'gridlineTransparency', 0) / 100 }
}

/** Query options of the cartesian charts (PBI data reduction + error-bar bounds). */
function categoricalOptions(config: CartesianConfig, fmt: FormatReader, errorSpecs: ReturnType<typeof readErrorBars>): Parameters<typeof buildCategorical>[2] {
  return {
    seriesRole: 'Series',
    splitRoles: config.splitRoles,
    unsplitRoles: config.unsplitRoles,
    defaultSort: config.defaultSort,
    highlight: true,
    fmt,
    maxCategories: config.maxCategories,
    // PBI line/area charts: high-density sampling to 3,500 points instead of truncating
    sampling: (config.maxCategories ?? 0) >= 3500 ? 'highDensity' : undefined,
    pointValues: errorSpecs.flatMap((sp, i) => [
      ...(sp.upper ? [{ id: `eu${i}`, expr: sp.upper, metadata: sp.metadata }] : []),
      ...(sp.lower ? [{ id: `el${i}`, expr: sp.lower, metadata: sp.metadata }] : [])
    ])
  }
}
