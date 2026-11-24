/**
 * Pie and donut charts.
 *
 * Roles (PBI): Legend = Category (each slice its own palette color), Values = Y, Details = Series
 * (splits every legend slice into sub-slices of the legend's color; without a Legend the
 * details become the slices). Without Legend/Details each measure is a slice.
 *
 * Detail labels follow PBI's options: label contents (`labels.labelStyle`, theme default "Data
 * value, percent of total"), position (`labels.position`: outside / inside / preferOutside /
 * preferInside; legacy `labelPosition`), overflow text, background, display units / decimals.
 * Outside labels sit at the slice's mid-angle with gray leader lines; when a label is too wide
 * PBI wraps it onto two lines ("$6.39M" / "(28.97%)") before truncating. Rotation =
 * `slices.startAngle`, donut hole = `slices.innerRadiusRatio`.
 */
import { useMemo, type MouseEvent as ReactMouseEvent, type ComponentType, type ReactNode } from 'react'
import type { VisualProps } from '../../contract'
import { buildCategorical, pointIdentity, type CategoricalData } from '../../common/categorical'
import { FormatReader, PBI } from '../../common/fmtProps'
import { Legend, measureLegend, readLegendStyle, type LegendItem } from '../../common/Legend'
import { ellipsize, fontAttrs, lineHeight, measureText, ptToPx, fontWeightOf } from '../../common/text'
import { contrastText, rgba } from '../../common/color'
import { colorAt, type GradientFill } from '@core/report/gradientFill'
import { SvgGradientDefs, svgPaintRef } from '../../common/svgPaint'
import { formatWithUnits, resolveDisplayUnit, formatFixed, formatScalar } from '../../common/units'
import { makeInteractions } from '../../common/interaction'
import { pointTooltip } from '../../common/tooltip'
import { EmptyVisual, NoData, VisualError, useVisualQuery } from '../../common/VisualState'
import { arcPath, composeLabel, labelParts, layoutOutsideLabels, polar, sliceAngles, splitLabel } from './pieLayout'
import type { DataPointIdentity } from '@core/report/sq'
import { SmallMultiples } from '../cartesian/SmallMultiples'
import { sweepMark } from '../../common/motionMarks'

/** Pie / donut data labels are on by default (also shown by the Format pane). */
export const PIE_LABELS_SHOWN = true
/** Default label position: the legacy `labelPosition` when present, else "Prefer outside". */
export function pieLabelPositionDefault(legacyPos: string | undefined): string {
  return legacyPos === 'insideOnly' ? 'inside' : legacyPos === 'preferInside' ? 'preferInside' : legacyPos === 'outside' ? 'outside' : 'preferOutside'
}

export interface Slice {
  key: string
  /** legend label (category) */
  label: string
  /** details label (sub-slice) */
  detail?: string
  value: number
  color: string
  /** Lumen gradient fill drawn instead of `color` (the solid fallback) */
  gradient?: GradientFill
  labelColor?: string
  highlight?: number | null
  identity: DataPointIdentity
  /** legend identity (legend clicks / legend dimming) */
  legendKey: string
  ci: number
  si: number
  format?: string
}

const LEADER = '#B3B0AD'

/** Slices from categorical data (Legend × Details), in legend order. */
export function slicesOf(d: CategoricalData): Slice[] {
  const out: Slice[] = []
  const split = d.series.filter((s) => s.split)
  if (d.levels.length) {
    const list = split.length ? split : d.series.slice(0, 1)
    d.categories.forEach((c, ci) => {
      for (const s of list) {
        const v = s.values[ci]
        if (v === null || !Number.isFinite(v) || v <= 0) continue
        out.push({
          key: split.length ? `${c.key}|${s.key}` : c.key,
          label: c.label,
          detail: split.length ? s.name : undefined,
          value: v,
          color: s.pointColors?.[ci] ?? s.color,
          gradient: s.pointColors?.[ci] !== undefined ? s.pointGradients?.[ci] : s.gradient,
          labelColor: s.cfColors?.['labels.color']?.[ci],
          highlight: s.highlights?.[ci],
          identity: pointIdentity(c, split.length ? s : undefined),
          legendKey: c.key,
          ci,
          si: d.series.indexOf(s),
          format: s.formats[ci] ?? s.measure.formatString
        })
      }
    })
  } else {
    d.series.forEach((s, si) => {
      const v = s.values[0]
      if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) return
      out.push({ key: s.key, label: s.name, value: v, color: s.color, gradient: s.gradient, labelColor: s.cfColors?.['labels.color']?.[0], highlight: s.highlights?.[0], identity: { fields: s.scope }, legendKey: s.key, ci: 0, si, format: s.formats[0] ?? s.measure.formatString })
    })
  }
  return out
}

export function makePieComponent(opts: { donut: boolean; icon: string }): ComponentType<VisualProps> {
  return function Pie(props: VisualProps) {
    const hasSM = ((props.visual.json?.visual?.query?.queryState?.Rows?.projections ?? []) as any[]).length > 0
    if (hasSM) return <SmallMultiples {...props} pie={opts} />
    return <PieChart {...props} donut={opts.donut} icon={opts.icon} />
  }
}

export interface PieRenderOptions {
  /** small-multiples panel: precomputed data, no legend */
  data?: CategoricalData
  hideLegend?: boolean
  panelKey?: string
}

export function PieChart({ visual, width, height, ctx, donut, icon, panel }: VisualProps & { donut: boolean; icon: string; panel?: PieRenderOptions }) {
  const json = visual.json
  const fmt = useMemo(() => new FormatReader(json, ctx.theme), [json, ctx.theme])
  const q = useVisualQuery(
    json,
    ctx,
    () => panel?.data ?? buildCategorical(json, ctx, pieQueryOptions(fmt)),
    panel?.panelKey ?? ''
  )
  if (!q.ok) return <VisualError error={q.error} height={height} />
  const d = q.data
  if (!d.series.length) return <EmptyVisual icon={icon} width={width} height={height} />
  const slices = slicesOf(d)
  if (!slices.length) return <NoData height={height} />
  const inter = makeInteractions(ctx, { drillLevels: d.allLevels.length })
  const responsive = fmt.bool('general', 'responsive', true)

  // legend: the Legend field's categories (or the details / measures when there is no legend)
  const legendStyle = readLegendStyle(fmt, { show: true, position: 'RightCenter', title: d.levels.length ? d.levels.map((l) => l.label).join(', ') : (d.seriesField?.label ?? '') })
  if ((responsive && (width < 160 || height < 100)) || panel?.hideLegend) legendStyle.show = false
  const legendMap = new Map<string, LegendItem & { identity: DataPointIdentity }>()
  for (const s of slices) {
    if (legendMap.has(s.legendKey)) continue
    const identity = d.levels.length ? pointIdentity(d.categories[s.ci], undefined) : s.identity
    legendMap.set(s.legendKey, { key: s.legendKey, label: s.label, color: s.color, gradient: s.gradient, identity, dimmed: inter.hasSelection && !inter.isSelected(identity) })
  }
  const items = [...legendMap.values()]
  const lg = measureLegend(legendStyle, items, width, height)
  let box = { x: 0, y: 0, w: width, h: height }
  let lrect = { x: 0, y: 0, w: 0, h: 0 }
  const pos = legendStyle.position
  if (lg.size) {
    if (pos.startsWith('Top')) ((lrect = { x: 0, y: 0, w: width, h: lg.size }), (box = { x: 0, y: lg.size, w: width, h: height - lg.size }))
    else if (pos.startsWith('Bottom')) ((lrect = { x: 0, y: height - lg.size, w: width, h: lg.size }), (box = { x: 0, y: 0, w: width, h: height - lg.size }))
    else if (pos.startsWith('Left')) ((lrect = { x: 0, y: 0, w: lg.size, h: height }), (box = { x: lg.size, y: 0, w: width - lg.size, h: height }))
    else ((lrect = { x: width - lg.size, y: 0, w: lg.size, h: height }), (box = { x: 0, y: 0, w: width - lg.size, h: height }))
  }

  // ---- detail labels
  const total = slices.reduce((a, s) => a + s.value, 0)
  const showLabels = fmt.bool('labels', 'show', PIE_LABELS_SHOWN)
  const parts = labelParts(fmt.str('labels', 'labelStyle', 'Data value, percent of total'))
  const legacyPos = fmt.optStr('labels', 'labelPosition')
  const position = fmt.str('labels', 'position', pieLabelPositionDefault(legacyPos))
  const overflow = fmt.bool('labels', 'overflow', false)
  const bgMode = fmt.str('labels', 'background', 'off')
  const lsz = fmt.num('labels', 'fontSize', PBI.dataLabelFontPt)
  const lfam = fmt.str('labels', 'fontFamily', PBI.fontFamily)
  const lfont = { size: ptToPx(lsz), family: lfam, weight: fontWeightOf(lfam, fmt.bool('labels', 'bold', false)), italic: fmt.bool('labels', 'italic', false) }
  const lcolor = fmt.optStr('labels', 'color')
  const unit = resolveDisplayUnit(fmt.optNum('labels', 'labelDisplayUnits') ?? 0, Math.max(...slices.map((s) => s.value)))
  const prec = fmt.optNum('labels', 'labelPrecision')
  const pctPrec = fmt.optNum('labels', 'percentageLabelPrecision') ?? 2
  const textOf = (s: Slice): string =>
    composeLabel({
      category: parts.category ? (s.detail ? `${s.label}, ${s.detail}` : s.label) : undefined,
      value: parts.value ? formatWithUnits(s.value, { unit, decimals: prec, formatString: s.format, format: ctx.format }) : undefined,
      percent: parts.percent ? formatFixed((s.value / total) * 100, pctPrec, true) + '%' : undefined
    })
  const texts = slices.map(textOf)
  const lh = lineHeight(lfont)
  const wantOutside = showLabels && (position === 'outside' || position === 'preferOutside')
  // PBI keeps the pie as large as the labels allow (labels may wrap to 2 lines before truncating)
  const textW = texts.map((t) => measureText(t, lfont))
  const twoLineW = texts.map((t) => {
    const sp = splitLabel(t)
    return sp ? Math.max(measureText(sp[0], lfont), measureText(sp[1], lfont)) : measureText(t, lfont)
  })
  const fullR = Math.max(4, Math.min(box.w, box.h) / 2 - 4)
  let r = fullR
  let labelsOutside = wantOutside
  if (wantOutside) {
    const need = (w: number) => Math.min(box.w / 2 - w - 22, box.h / 2 - lh - 4)
    const minR = Math.min(fullR, Math.max(20, Math.min(box.w, box.h) * 0.22))
    const oneLine = need(Math.max(...textW))
    const twoLine = need(Math.max(...twoLineW))
    if (oneLine >= minR) r = Math.min(fullR, oneLine)
    else if (twoLine >= minR) r = Math.min(fullR, twoLine)
    else if (position === 'preferOutside' && box.w / 2 - 22 - minR > 24) r = minR
    else if (position === 'preferOutside') {
      labelsOutside = false
      r = fullR
    } else r = minR
  }
  r = Math.max(4, r)
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const inner = donut ? r * (fmt.num('slices', 'innerRadiusRatio', 50) / 100) : 0
  const angles = sliceAngles(
    slices.map((s) => s.value),
    fmt.num('slices', 'startAngle', 0)
  )
  const hl = d.hasHighlights

  const onSlice = (s: Slice) => ({
    onClick: (e: ReactMouseEvent) => (s.identity.fields.length ? inter.onPointClick(s.identity, e) : e.stopPropagation()),
    onContextMenu: (e: ReactMouseEvent) => inter.onContextMenu(s.identity, e),
    onMouseMove: (e: ReactMouseEvent) => {
      const series = d.series[s.si]
      const items = d.levels.length ? pointTooltip(ctx, d, s.ci, series) : [{ label: s.label, value: formatScalar(s.value, s.format, ctx.format), color: s.color }]
      items.push({ label: '% of total', value: formatFixed((s.value / total) * 100, 2, true) + '%' })
      inter.showTooltip(e, items, s.identity)
    },
    onMouseLeave: () => inter.hideTooltip()
  })

  const labelNodes: ReactNode[] = []
  const insideLabel = (s: Slice, i: number, force: boolean): boolean => {
    const a = angles[i]
    const rm = donut ? (inner + r) / 2 : r * 0.62
    const [x, y] = polar(cx, cy, rm, a.mid)
    const t = texts[i]
    const tw = textW[i]
    const arcLen = (a.end - a.start) * rm
    const room = Math.max(arcLen, donut ? r - inner : r)
    if (!force && !overflow && (tw > room * 1.1 || lh > arcLen)) return false
    const fill = s.labelColor ?? lcolor ?? contrastText(s.gradient ? colorAt(s.gradient, 0.5) : s.color)
    labelNodes.push(
      <g key={`li${i}`} pointerEvents="none" opacity={inter.opacityFor(s.identity)}>
        {bgMode === 'on' ? <rect x={x - tw / 2 - 2} y={y - lh / 2} width={tw + 4} height={lh} fill="#FFFFFF" fillOpacity={0.8} /> : null}
        <text x={x} y={y} dy="0.35em" textAnchor="middle" {...fontAttrs(lfont)} fill={fill}>
          {overflow ? t : ellipsize(t, room, lfont)}
        </text>
      </g>
    )
    return true
  }
  if (showLabels) {
    if (labelsOutside) {
      const sides = slices.map((s, i) => ({ s, i }))
      // preferInside: labels that fit stay inside, the rest go outside
      const outside = position === 'preferInside' ? sides.filter(({ s, i }) => !insideLabel(s, i, false)) : sides
      const twoLine = outside.map(({ i }) => {
        const avail = (angles[i].mid <= Math.PI ? box.x + box.w - (cx + r + 20) : cx - r - 20 - box.x) - 2
        return textW[i] > avail && !!splitLabel(texts[i])
      })
      const laid = layoutOutsideLabels(
        outside.map(({ i }, k) => ({ index: i, mid: angles[i].mid, height: twoLine[k] ? lh * 2 : lh })),
        cx,
        cy,
        r,
        box.y + 2,
        box.y + box.h - 2
      )
      for (const L of laid) {
        const avail = L.side === 'right' ? box.x + box.w - L.x - 2 : L.x - box.x - 2
        const s = slices[L.index]
        const k = outside.findIndex((o) => o.i === L.index)
        const lines = twoLine[k] ? splitLabel(texts[L.index])! : [texts[L.index]]
        const shown = lines.map((ln) => ellipsize(ln, avail, lfont))
        if (!shown[0] || shown[0] === '…') continue
        const fill = s.labelColor ?? lcolor ?? PBI.labelColor
        labelNodes.push(
          <g key={`lb${L.index}`} pointerEvents="none" opacity={inter.opacityFor(s.identity)}>
            <polyline points={L.line.map((p) => p.join(',')).join(' ')} fill="none" stroke={LEADER} strokeWidth={1} />
            {bgMode === 'on' ? <rect x={L.side === 'right' ? L.x - 2 : L.x - Math.max(...shown.map((x) => measureText(x, lfont))) - 2} y={L.y - (lh * shown.length) / 2} width={Math.max(...shown.map((x) => measureText(x, lfont))) + 4} height={lh * shown.length} fill="#FFFFFF" fillOpacity={0.8} /> : null}
            <text x={L.x} y={L.y - ((shown.length - 1) * lh) / 2} dy="0.35em" textAnchor={L.side === 'right' ? 'start' : 'end'} {...fontAttrs(lfont)} fill={fill}>
              {shown.map((ln, li) => (
                <tspan key={li} x={L.x} dy={li === 0 ? '0.35em' : lh}>
                  {ln}
                </tspan>
              ))}
            </text>
          </g>
        )
      }
    } else slices.forEach((s, i) => void insideLabel(s, i, position === 'inside' && overflow))
  }

  // sub-slices (details) are separated by thinner lines than legend slices
  const sep = (i: number) => (slices.length > 1 ? (slices[i].detail && slices[i + 1]?.legendKey === slices[i].legendKey ? 0.5 : 1) : 0)
  return (
    <svg width={width} height={height} style={{ display: 'block', userSelect: 'none' }} onClick={(e) => inter.onBackgroundClick(e)} onContextMenu={(e) => inter.onContextMenu(undefined, e)}>
      <SvgGradientDefs paints={slices.map((s) => (s.gradient ? { gradient: s.gradient } : undefined))} />
      {slices.map((s, i) => {
        const a = angles[i]
        const fill = s.gradient ? svgPaintRef({ gradient: s.gradient }) : s.color
        const op = inter.opacityFor(s.identity)
        const path = arcPath(cx, cy, inner, r, a.start, a.end)
        if (hl) {
          const frac = s.highlight && s.value ? Math.max(0, Math.min(1, s.highlight / s.value)) : 0
          const rh = donut ? inner + (r - inner) * frac : r * Math.sqrt(frac)
          return (
            <g key={s.key} {...onSlice(s)} style={{ cursor: 'pointer' }}>
              <path d={path} fill={rgba(s.color, 0.4)} stroke="#FFFFFF" strokeWidth={1} {...sweepMark(cx, cy)} />
              {frac > 0 ? <path d={arcPath(cx, cy, inner, rh, a.start, a.end)} fill={fill} stroke="#FFFFFF" strokeWidth={1} {...sweepMark(cx, cy)} /> : null}
            </g>
          )
        }
        return <path key={s.key} d={path} fill={fill} opacity={op} stroke="#FFFFFF" strokeWidth={sep(i)} style={{ cursor: 'pointer' }} {...sweepMark(cx, cy)} {...onSlice(s)} />
      })}
      {labelNodes}
      {lg.size ? (
        <Legend
          style={legendStyle}
          items={items}
          x={lrect.x}
          y={lrect.y}
          width={lrect.w}
          height={lrect.h}
          onItemClick={(key, e) => {
            const it = legendMap.get(key)
            if (it?.identity.fields.length) inter.onPointClick(it.identity, e, { drillable: false })
          }}
        />
      ) : null}
    </svg>
  )
}

/** Query options shared by the pie/donut visual, its getData and small multiples. */
export function pieQueryOptions(fmt: FormatReader): Parameters<typeof buildCategorical>[2] {
  return { seriesRole: 'Series', splitRoles: ['Y'], defaultSort: 'measureDesc', highlight: true, fmt, varyColors: true, maxCategories: 500 }
}
