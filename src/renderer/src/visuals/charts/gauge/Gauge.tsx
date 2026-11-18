/**
 * Gauge (radial semicircle, PBI `gauge`) and KPI (`kpi`) visuals.
 *
 * Gauge: Value (Y), Minimum / Maximum / Target value roles and the `axis` min / max / target
 * properties (range rules in ./gaugeMath.ts: default max = 2 × value). Band inner radius = 0.7 ×
 * outer like PBI; fill `dataPoint.fill` (per-measure selector, conditional formatting), target
 * line `dataPoint.target`; min/max labels (`labels`), target label (`target`), callout value
 * (`calloutValue`, auto-sized DIN like PBI).
 * KPI: Indicator, Trend axis, Target (up to two goals); big value + status icon, goal text and
 * distance (`goals`), trend area behind in the status color (`trendline.transparency`), optional
 * last date (`lastDate`). Status rules in ./kpiMath.ts.
 */
import { useMemo, type MouseEvent as ReactMouseEvent } from 'react'
import { area as d3area, line as d3line } from 'd3-shape'
import type { VisualProps, VisualHostContext } from '../../contract'
import type { Scalar } from '@core/model/data'
import { FormatReader, PBI, textClass } from '../../common/fmtProps'
import { getProjections, labelOf, expandParameters, valueId, type Projection } from '../../common/query'
import { fontAttrs, measureText, ptToPx, fontWeightOf, lineHeight, ellipsize, type FontSpec } from '../../common/text'
import { conditionalRule, evalConditional, rgba } from '../../common/color'
import { formatScalar, formatWithUnits, resolveDisplayUnit } from '../../common/units'
import { makeInteractions } from '../../common/interaction'
import { EmptyVisual, NoData, VisualError, useVisualQuery } from '../../common/VisualState'
import { ICONS } from '../icons'
import { arcPath, polar } from '../pie/pieLayout'
import { GAUGE_INNER_RADIUS_FACTOR, gaugeAngle, gaugeRange } from './gaugeMath'
import { distanceText, kpiDirection, kpiDistance, kpiStatus, signedPercent, type KpiStatus } from './kpiMath'

interface GaugeData {
  value: number | null
  highlight?: number | null
  min: number | null
  max: number | null
  target: number | null
  cfInput: Scalar
  valueFormat?: string
  targetFormat?: string
  valueLabel: string
  targetLabel: string
  queryRef: string
  tooltips: Array<{ label: string; value: string }>
}

const num = (v: Scalar | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function queryGauge(json: any, ctx: VisualHostContext, fmt: FormatReader): GaugeData | null {
  const roles = getProjections(json)
  const pick = (r: string) => expandParameters(roles[r] ?? [], ctx)[0]
  const y = pick('Y')
  if (!y) return null
  const minP = pick('MinValue')
  const maxP = pick('MaxValue')
  const tgtP = pick('TargetValue')
  const tips = expandParameters(roles['Tooltips'] ?? [], ctx)
  const all = [y, minP, maxP, tgtP, ...tips].filter(Boolean) as Projection[]
  const rule = conditionalRule(fmt.pc, 'dataPoint', 'fill')
  const values = all.map((p) => ({ id: valueId(p), expr: { kind: 'sq' as const, expr: p.expr } }))
  if (rule?.input) values.push({ id: 'cf|fill', expr: { kind: 'sq', expr: rule.input } })
  const res = ctx.engine.summarize({
    groupBy: [],
    values,
    filters: ctx.filters,
    keepBlankRows: true,
    highlightFilters: ctx.highlightFilters?.length ? ctx.highlightFilters : undefined
  })
  const row = res.rows[0] ?? []
  const at = (p: Projection | undefined) => (p ? row[all.indexOf(p)] : null)
  const desc = ctx.engine.describeField(y.expr)
  return {
    value: num(at(y)),
    highlight: res.highlights ? num(res.highlights[0]?.[0]) : undefined,
    min: num(at(minP)),
    max: num(at(maxP)),
    target: num(at(tgtP)),
    cfInput: rule?.input ? (row[all.length] ?? null) : null,
    valueFormat: res.formats?.[0]?.[0] ?? desc?.formatString,
    targetFormat: tgtP ? (ctx.engine.describeField(tgtP.expr)?.formatString ?? desc?.formatString) : desc?.formatString,
    valueLabel: labelOf(ctx, y),
    targetLabel: tgtP ? labelOf(ctx, tgtP) : '',
    queryRef: y.queryRef,
    tooltips: tips.map((t) => ({ label: labelOf(ctx, t), value: formatScalar(at(t) ?? null, ctx.engine.describeField(t.expr)?.formatString, ctx.format) }))
  }
}

export function Gauge({ visual, width, height, ctx }: VisualProps) {
  const json = visual.json
  const fmt = useMemo(() => new FormatReader(json, ctx.theme), [json, ctx.theme])
  const q = useVisualQuery(json, ctx, () => queryGauge(json, ctx, fmt))
  if (!q.ok) return <VisualError error={q.error} height={height} />
  const g = q.data
  if (!g) return <EmptyVisual icon={ICONS.gauge} width={width} height={height} />
  if (g.value === null) return <NoData height={height} />
  const inter = makeInteractions(ctx)

  const v = g.value
  const range = gaugeRange({ value: v, minField: g.min, maxField: g.max, targetField: g.target, axisMin: fmt.optNum('axis', 'min'), axisMax: fmt.optNum('axis', 'max'), axisTarget: fmt.optNum('axis', 'target') })
  const { min, max, target } = range
  const rule = conditionalRule(fmt.pc, 'dataPoint', 'fill')
  const staticFillColor = fmt.sColor('dataPoint', 'fill', { metadata: g.queryRef }) ?? ctx.theme.dataColors[0]
  const fill = (rule && evalConditional(rule, g.cfInput, [min, max], ctx.theme)) || staticFillColor
  const track = fmt.color('dataPoint', 'background', '#E6E6E6')
  // Learn themes doc: "Gauge target" = lightLabel and "Gauge target and target leader line color" = secondLevelElements (#605E5C)
  const targetColor = fmt.color('dataPoint', 'target', PBI.labelColor)
  const labelsShow = fmt.bool('labels', 'show', true)
  const lT = fmt.text('labels', {}, { size: PBI.dataLabelFontPt, color: PBI.labelColor })
  const tT = fmt.text('target', {}, { size: PBI.dataLabelFontPt, color: PBI.labelColor })
  const calloutShow = fmt.bool('calloutValue', 'show', true)
  const targetShow = fmt.bool('target', 'show', true)
  const ref = Math.max(Math.abs(max), Math.abs(min))
  const fmtIn = (x: number, obj: string, formatString: string | undefined) =>
    formatWithUnits(x, { unit: resolveDisplayUnit(fmt.optNum(obj, 'labelDisplayUnits') ?? 0, obj === 'calloutValue' ? Math.abs(x) : ref), decimals: fmt.optNum(obj, 'labelPrecision'), formatString, format: ctx.format })

  const lh = lineHeight(lT.font)
  const sideLabel = targetShow && target !== null ? Math.min(width * 0.2, measureText(fmtIn(target, 'target', g.targetFormat), tT.font) + 10) : 6
  const padTop = targetShow && target !== null ? lineHeight(tT.font) + 2 : 6
  const r = Math.max(10, Math.min((width - 2 * sideLabel - 8) / 2, height - padTop - (labelsShow ? lh + 4 : 4) - 4))
  const cx = width / 2
  const contentH = padTop + r + (labelsShow ? lh + 4 : 4)
  const cy = padTop + r + Math.max(0, (height - contentH) / 2)
  const inner = r * GAUGE_INNER_RADIUS_FACTOR
  const a0 = -Math.PI / 2
  const a1 = Math.PI / 2
  const av = gaugeAngle(v, min, max)
  const callDefault = textClass(ctx.theme, 'callout', { size: 45, family: 'DIN', color: '#252423' })
  const callFam = fmt.str('calloutValue', 'fontFamily', callDefault.family)
  const callText = fmtIn(v, 'calloutValue', g.valueFormat)
  // PBI auto-sizes the callout to the inner radius (calloutValue has no font size)
  let callSize = Math.min(inner * 0.5, ptToPx(fmt.num('calloutValue', 'fontSize', callDefault.size)))
  const callFont: FontSpec = { size: callSize, family: callFam, weight: fontWeightOf(callFam, fmt.bool('calloutValue', 'bold', false)), italic: fmt.bool('calloutValue', 'italic', false) }
  while (callSize > 8 && measureText(callText, { ...callFont, size: callSize }) > inner * 1.7) callSize -= 1
  callFont.size = callSize

  const onMove = (e: ReactMouseEvent) =>
    inter.showTooltip(e, [
      { label: g.valueLabel, value: formatScalar(v, g.valueFormat, ctx.format), color: fill },
      ...(target !== null ? [{ label: g.targetLabel || 'Target', value: formatScalar(target, g.targetFormat, ctx.format) }] : []),
      ...(g.min !== null || g.max !== null ? [{ label: 'Minimum', value: formatScalar(min, g.valueFormat, ctx.format) }, { label: 'Maximum', value: formatScalar(max, g.valueFormat, ctx.format) }] : []),
      ...g.tooltips
    ])
  return (
    <svg width={width} height={height} style={{ display: 'block' }} onContextMenu={(e) => inter.onContextMenu(undefined, e)}>
      <g onMouseMove={onMove} onMouseLeave={() => inter.hideTooltip()}>
        <path d={arcPath(cx, cy, inner, r, a0, a1)} fill={track} />
        {g.highlight !== undefined ? (
          <>
            <path d={arcPath(cx, cy, inner, r, a0, av)} fill={rgba(fill, PBI.highlightBackOpacity)} />
            <path d={arcPath(cx, cy, inner, r, a0, gaugeAngle(g.highlight ?? min, min, max))} fill={fill} />
          </>
        ) : (
          <path d={arcPath(cx, cy, inner, r, a0, av)} fill={fill} />
        )}
        {target !== null
          ? (() => {
              const at = gaugeAngle(target, min, max)
              const [x0, y0] = polar(cx, cy, inner - 2, at)
              const [x1, y1] = polar(cx, cy, r + 2, at)
              const [tx, ty] = polar(cx, cy, r + 6, at)
              return (
                <g>
                  <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={targetColor} strokeWidth={2} />
                  {targetShow ? (
                    <text x={tx} y={ty} textAnchor={at < -0.05 ? 'end' : at > 0.05 ? 'start' : 'middle'} dy={Math.abs(at) < 0.3 ? '-0.2em' : '0.35em'} {...fontAttrs(tT.font)} fill={tT.color}>
                      {fmtIn(target, 'target', g.targetFormat)}
                    </text>
                  ) : null}
                </g>
              )
            })()
          : null}
      </g>
      {calloutShow ? (
        <text x={cx} y={cy - 2} textAnchor="middle" {...fontAttrs(callFont)} fill={fmt.color('calloutValue', 'color', callDefault.color)} pointerEvents="none">
          {callText}
        </text>
      ) : null}
      {labelsShow ? (
        <>
          <text x={cx - (inner + r) / 2} y={cy + 4} dy="0.9em" textAnchor="middle" {...fontAttrs(lT.font)} fill={lT.color}>
            {fmtIn(min, 'labels', g.valueFormat)}
          </text>
          <text x={cx + (inner + r) / 2} y={cy + 4} dy="0.9em" textAnchor="middle" {...fontAttrs(lT.font)} fill={lT.color}>
            {fmtIn(max, 'labels', g.valueFormat)}
          </text>
        </>
      ) : null}
    </svg>
  )
}

// ---------------------------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------------------------

interface KpiData {
  value: number | null
  goals: Array<number | null>
  trend: Array<number | null>
  format?: string
  goalFormats: Array<string | undefined>
  label: string
  goalLabels: string[]
  trendLabels: string[]
  trendLabel?: string
}

function queryKpi(json: any, ctx: VisualHostContext): KpiData | null {
  const roles = getProjections(json)
  const ind = expandParameters(roles['Indicator'] ?? [], ctx)[0]
  if (!ind) return null
  const trendP = expandParameters(roles['TrendLine'] ?? [], ctx)[0]
  const goalPs = expandParameters(roles['Goal'] ?? [], ctx).slice(0, 2)
  const vals = [ind, ...goalPs]
  const res = ctx.engine.summarize({
    groupBy: trendP ? [{ kind: 'sq', expr: trendP.expr }] : [],
    values: vals.map((p) => ({ id: valueId(p), expr: { kind: 'sq', expr: p.expr } })),
    filters: ctx.filters,
    orderBy: trendP ? [{ target: { group: 0 }, direction: 'asc' }] : undefined,
    keepBlankRows: !trendP
  })
  const off = trendP ? 1 : 0
  // PBI shows the indicator at the last trend-axis point that has a value
  let lastI = res.rows.length - 1
  while (lastI > 0 && num(res.rows[lastI][off]) === null) lastI--
  const last = res.rows[lastI] ?? []
  const desc = ctx.engine.describeField(ind.expr)
  const tdesc = trendP ? ctx.engine.describeField(trendP.expr) : undefined
  return {
    value: num(last[off]),
    goals: goalPs.map((_, i) => num(last[off + 1 + i])),
    trend: trendP ? res.rows.slice(0, lastI + 1).map((r) => num(r[off])) : [],
    format: res.formats?.[lastI]?.[0] ?? desc?.formatString,
    goalFormats: goalPs.map((p) => ctx.engine.describeField(p.expr)?.formatString ?? desc?.formatString),
    label: labelOf(ctx, ind),
    goalLabels: goalPs.map((p) => labelOf(ctx, p)),
    trendLabels: trendP ? res.rows.slice(0, lastI + 1).map((r) => formatScalar(r[0], tdesc?.formatString, ctx.format, tdesc?.dataType)) : [],
    trendLabel: trendP ? labelOf(ctx, trendP) : undefined
  }
}

/** Gray used for the trend when there is no goal (no status). */
const NO_GOAL_TREND = '#A19F9D'

export function Kpi({ visual, width, height, ctx }: VisualProps) {
  const json = visual.json
  const fmt = useMemo(() => new FormatReader(json, ctx.theme), [json, ctx.theme])
  const q = useVisualQuery(json, ctx, () => queryKpi(json, ctx))
  if (!q.ok) return <VisualError error={q.error} height={height} />
  const k = q.data
  if (!k) return <EmptyVisual icon={ICONS.kpi} width={width} height={height} />
  if (k.value === null) return <NoData height={height} />
  const inter = makeInteractions(ctx)
  const value = k.value
  const direction = kpiDirection(fmt.optStr('goals', 'direction'), fmt.optStr('status', 'direction'))
  const status: KpiStatus = kpiStatus(value, k.goals, direction)
  const colors: Record<KpiStatus, string> = {
    good: fmt.color('status', 'goodColor', ctx.theme.good),
    bad: fmt.color('status', 'badColor', ctx.theme.bad),
    neutral: fmt.color('status', 'neutralColor', ctx.theme.neutral),
    none: NO_GOAL_TREND
  }
  const statusColor = colors[status]
  const hasGoal = status !== 'none'

  // ---- indicator
  const unit = resolveDisplayUnit(fmt.optNum('indicator', 'indicatorDisplayUnits') ?? 0, Math.abs(value))
  const prec = fmt.optNum('indicator', 'indicatorPrecision')
  const valueText = formatWithUnits(value, { unit, decimals: prec, formatString: k.format, format: ctx.format })
  const callout = textClass(ctx.theme, 'callout', { size: 45, family: 'DIN', color: '#252423' })
  const showTrend = fmt.bool('trendline', 'show', true) && k.trend.filter((x) => x !== null).length > 1
  const trendTransp = fmt.num('trendline', 'transparency', 20)
  const hAlign = fmt.str('indicator', 'horizontalAlignment', 'center')
  const vAlign = fmt.str('indicator', 'verticalAlignment', 'middle')
  const showIcon = fmt.bool('indicator', 'showIcon', true) && hasGoal

  // ---- goals text
  const goalsShow = fmt.bool('goals', 'showGoal', true) && hasGoal
  const distShow = fmt.bool('goals', 'showDistance', true) && hasGoal
  const goalFam = fmt.str('goals', 'goalFontFamily', fmt.str('goals', 'fontFamily', 'Segoe UI'))
  const goalSize = ptToPx(fmt.num('goals', 'fontSize', 9))
  const goalFont: FontSpec = { size: goalSize, family: goalFam, weight: fontWeightOf(goalFam, fmt.bool('goals', 'bold', false)), italic: fmt.bool('goals', 'italic', false) }
  const distFam = fmt.str('goals', 'distanceFontFamily', goalFam)
  const distFont: FontSpec = { ...goalFont, family: distFam, weight: fontWeightOf(distFam, fmt.bool('goals', 'bold', false)) }
  const goalColor = fmt.color('goals', 'goalFontColor', PBI.labelColor)
  const distColor = fmt.color('goals', 'distanceFontColor', statusColor)
  const goalText = fmt.str('goals', 'goalText', 'Goal')
  const pctDec = fmt.num('goals', 'labelPrecision', 2)
  const goalParts = k.goals
    .map((gv, i) => {
      if (gv === null) return null
      const gText = formatWithUnits(gv, { unit, decimals: prec, formatString: k.goalFormats[i], format: ctx.format })
      const dist = kpiDistance(value, gv)
      const absText = (dist.abs >= 0 ? '+' : '-') + formatWithUnits(Math.abs(dist.abs), { unit, decimals: prec, formatString: k.format, format: ctx.format })
      return { gText, dText: distanceText(fmt.optStr('goals', 'distanceLabel'), signedPercent(dist.pct, pctDec), absText) }
    })
    .filter((x): x is { gText: string; dText: string } => x !== null)
  const goalH = (goalsShow || distShow) && goalParts.length ? lineHeight(goalFont) + 8 : 0

  // ---- last date
  const lastDateShow = fmt.bool('lastDate', 'show', false) && k.trendLabels.length > 0
  const ldFam = fmt.str('lastDate', 'lastDateFontFamily', 'Segoe UI')
  const ldFont: FontSpec = { size: ptToPx(fmt.num('lastDate', 'fontSize', 9)), family: ldFam, weight: fontWeightOf(ldFam, fmt.bool('lastDate', 'bold', false)) }
  const ldH = lastDateShow ? lineHeight(ldFont) + 4 : 0

  // ---- trend geometry (bottom part of the visual, behind the value)
  const trendTop = Math.max(ldH, height * 0.42)
  const trendH = Math.max(10, height - goalH - trendTop)
  const tv = k.trend.filter((x): x is number => x !== null)
  const tMin = Math.min(...tv)
  const tMax = Math.max(...tv)
  const xs = (i: number) => (k.trend.length > 1 ? (i / (k.trend.length - 1)) * width : width / 2)
  const ys = (v: number) => trendTop + trendH - (tMax === tMin ? trendH / 2 : ((v - tMin) / (tMax - tMin)) * trendH * 0.9)
  const pts = k.trend.map((v, i) => (v === null ? null : ([xs(i), ys(v)] as [number, number])))
  const areaPath = d3area<[number, number] | null>()
    .defined((p) => p !== null)
    .x((p) => p![0])
    .y0(trendTop + trendH)
    .y1((p) => p![1])(pts)
  const linePath = d3line<[number, number] | null>()
    .defined((p) => p !== null)
    .x((p) => p![0])
    .y((p) => p![1])(pts)

  // ---- value text sizing / placement
  const valFam = fmt.str('indicator', 'fontFamily', callout.family)
  let valSize = Math.min((showTrend ? trendTop - ldH : height - goalH - ldH) * 0.8, ptToPx(fmt.optNum('indicator', 'fontSize') ?? callout.size))
  const valFont: FontSpec = { size: valSize, family: valFam, weight: fontWeightOf(valFam, fmt.bool('indicator', 'bold', false)), italic: fmt.bool('indicator', 'italic', false) }
  const iconFor = (s: number) => (showIcon ? Math.min(ptToPx(fmt.num('indicator', 'iconSize', 0) || 0) || s * 0.55, s) : 0)
  while (valSize > 8 && measureText(valueText, valFont) + iconFor(valSize) + 14 > width - 8) {
    valSize -= 1
    valFont.size = valSize
  }
  const iconW = iconFor(valSize)
  const blockTop = ldH
  const blockBottom = showTrend ? trendTop : height - goalH
  const valueY = vAlign === 'top' ? blockTop + valSize * 0.6 : vAlign === 'bottom' ? blockBottom - valSize * 0.5 : (blockTop + blockBottom) / 2
  const tw = measureText(valueText, valFont)
  const blockW = tw + (iconW ? iconW + 6 : 0)
  const startX = hAlign === 'left' ? 8 : hAlign === 'right' ? width - 8 - blockW : (width - blockW) / 2

  return (
    <svg
      width={width}
      height={height}
      style={{ display: 'block' }}
      onMouseMove={(e) =>
        inter.showTooltip(e, [
          ...(k.trendLabel && k.trendLabels.length ? [{ label: k.trendLabel, value: k.trendLabels[k.trendLabels.length - 1] }] : []),
          { label: k.label, value: formatScalar(value, k.format, ctx.format), color: hasGoal ? statusColor : undefined },
          ...k.goals.flatMap((gv, i) => (gv === null ? [] : [{ label: k.goalLabels[i], value: formatScalar(gv, k.goalFormats[i], ctx.format) }]))
        ])
      }
      onMouseLeave={() => inter.hideTooltip()}
      onContextMenu={(e) => inter.onContextMenu(undefined, e)}
    >
      {showTrend ? (
        <g pointerEvents="none">
          <path d={areaPath ?? ''} fill={statusColor} fillOpacity={(1 - trendTransp / 100) * 0.45} />
          <path d={linePath ?? ''} fill="none" stroke={statusColor} strokeWidth={1.5} strokeOpacity={1 - trendTransp / 100} />
        </g>
      ) : null}
      {lastDateShow ? (
        <text x={8} y={ldH / 2 + 2} dy="0.35em" {...fontAttrs(ldFont)} fill={fmt.color('lastDate', 'lastDateFontColor', PBI.labelColor)}>
          {k.trendLabels[k.trendLabels.length - 1]}
        </text>
      ) : null}
      <text x={startX} y={valueY} dy="0.35em" {...fontAttrs(valFont)} fill={fmt.color('indicator', 'fontColor', fmt.color('indicator', 'color', callout.color))}>
        {valueText}
      </text>
      {showIcon ? <StatusIcon x={startX + tw + 6} y={valueY} size={iconW} status={status} color={statusColor} /> : null}
      {(goalsShow || distShow) && goalParts.length ? (
        <text x={width / 2} y={height - goalH / 2} dy="0.35em" textAnchor="middle" {...fontAttrs(goalFont)} fill={goalColor}>
          {goalParts.map((p, i) => (
            <tspan key={i}>
              {i > 0 ? <tspan>{', '}</tspan> : null}
              {goalsShow ? <tspan>{ellipsize(i === 0 ? `${goalText}: ${p.gText}` : p.gText, width * 0.6, goalFont)}</tspan> : null}
              {distShow ? (
                <tspan fill={distColor} {...fontAttrs(distFont)} dx={goalsShow ? 4 : 0}>
                  {goalsShow ? `(${p.dText})` : p.dText}
                </tspan>
              ) : null}
            </tspan>
          ))}
        </text>
      ) : null}
    </svg>
  )
}

/** PBI KPI status icons: check mark (good), exclamation (bad), dash-diamond (neutral). */
function StatusIcon({ x, y, size, status, color }: { x: number; y: number; size: number; status: KpiStatus; color: string }) {
  const s = size
  if (status === 'neutral')
    return (
      <g>
        <path d={`M${x + s / 2},${y - s / 2}L${x + s},${y}L${x + s / 2},${y + s / 2}L${x},${y}Z`} fill={color} />
        <rect x={x + s * 0.28} y={y - s * 0.06} width={s * 0.44} height={s * 0.12} fill="#FFFFFF" />
      </g>
    )
  if (status === 'good')
    return (
      <path
        d={`M${x + s * 0.08},${y}L${x + s * 0.38},${y + s * 0.32}L${x + s * 0.95},${y - s * 0.38}`}
        fill="none"
        stroke={color}
        strokeWidth={Math.max(2, s * 0.16)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )
  return (
    <g>
      <rect x={x + s * 0.4} y={y - s * 0.45} width={s * 0.2} height={s * 0.6} rx={s * 0.08} fill={color} />
      <circle cx={x + s * 0.5} cy={y + s * 0.38} r={s * 0.11} fill={color} />
    </g>
  )
}
