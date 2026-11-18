/**
 * Scatter data query: one row per (play frame × category level(s) × legend value), with X / Y /
 * Size / tooltip values and the conditional-formatting input of `dataPoint.fill`.
 *
 * Roles: Category ("Values", hierarchy → drill), Series ("Legend"), X, Y, Size, Play, Tooltips.
 * When the legend field is also the active category level (common in PBI sample reports) the
 * group-by is shared instead of duplicated.
 */
import type { Scalar } from '@core/model/data'
import { fieldKey, identityKey, type DataPointIdentity } from '@core/report/sq'
import type { TooltipItem, VisualHostContext } from '../../contract'
import { activeLevels, fieldRef, formatCategoryValue, type FieldRef } from '../../common/categorical'
import { conditionalRule, defaultFill, evalConditional, findEntry, staticFill, type ConditionalRule, type ScopeField } from '../../common/color'
import type { FormatReader } from '../../common/fmtProps'
import { expandParameters, getProjections, valueId, type Projection } from '../../common/query'
import { formatScalar } from '../../common/units'
import { collectFrames } from './scatterModel'

export interface ScatterPoint {
  /** unique per frame */
  key: string
  /** identity key without the play field (stable across frames → trails, selection) */
  idKey: string
  x: number
  y: number
  size: number | null
  label: string
  seriesKey: string
  frame: string
  frameIndex: number
  identity: DataPointIdentity
  /** category-only identity (drill target) */
  catIdentity: DataPointIdentity
  highlighted: boolean
  color: string
  tips: TooltipItem[]
}

export interface ScatterSeries {
  key: string
  label: string
  color: string
  scope: DataPointIdentity
  metadata?: string
}

export interface ScatterData {
  points: ScatterPoint[]
  series: ScatterSeries[]
  frames: string[]
  xRef?: FieldRef
  yRef?: FieldRef
  sizeRef?: FieldRef
  seriesRef?: FieldRef
  playRef?: FieldRef
  levels: FieldRef[]
  drillLevels: number
  hasHighlights: boolean
  hasX: boolean
  hasY: boolean
  truncated: boolean
}

const num = (v: Scalar | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'boolean' ? Number(v) : null)

export function queryScatter(json: any, ctx: VisualHostContext, fmt: FormatReader): ScatterData | null {
  const roles = getProjections(json)
  const one = (r: string): Projection | undefined => expandParameters(roles[r] ?? [], ctx)[0]
  const xP = one('X')
  const yP = one('Y')
  if (!xP && !yP) return null
  const sizeP = one('Size')
  const playP = one('Play')
  const serP = one('Series')
  const allCats = expandParameters(roles['Category'] ?? [], ctx)
  const levelsP = activeLevels(allCats, ctx)
  const tips = expandParameters(roles['Tooltips'] ?? [], ctx)

  // group-bys (deduplicated by field)
  const groups: Projection[] = []
  const groupIdx = (p: Projection): number => {
    const k = fieldKey(p.expr)
    let i = groups.findIndex((g) => fieldKey(g.expr) === k)
    if (i < 0) {
      groups.push(p)
      i = groups.length - 1
    }
    return i
  }
  const playI = playP ? groupIdx(playP) : -1
  const levelI = levelsP.map(groupIdx)
  const serI = serP ? groupIdx(serP) : -1

  // values
  const vals: Array<{ id: string; expr: any }> = []
  const addVal = (id: string, expr: any): number => {
    vals.push({ id, expr })
    return vals.length - 1
  }
  const xI = xP ? addVal(valueId(xP), xP.expr) : -1
  const yI = yP ? addVal(valueId(yP), yP.expr) : -1
  const sizeI = sizeP ? addVal(valueId(sizeP), sizeP.expr) : -1
  const tipI = tips.map((t) => addVal('tip|' + valueId(t), t.expr))
  const rule: ConditionalRule | undefined = conditionalRule(fmt.pc, 'dataPoint', 'fill')
  const cfI = rule?.input ? addVal('cf|fill', rule.input) : -1

  const showAll = [...levelsP, ...(serP ? [serP] : [])].some((p) => p.raw?.showAll === true)
  const res = ctx.engine.summarize({
    groupBy: groups.map((g) => ({ kind: 'sq', expr: g.expr })),
    values: vals.map((v) => ({ id: v.id, expr: { kind: 'sq', expr: v.expr } })),
    filters: ctx.filters,
    orderBy: groups.map((_, i) => ({ target: { group: i }, direction: 'asc' as const })),
    limit: 10000,
    showItemsWithNoData: showAll,
    highlightFilters: ctx.highlightFilters?.length ? ctx.highlightFilters : undefined
  })
  const refs = {
    play: playP ? fieldRef(ctx, playP) : undefined,
    levels: levelsP.map((p) => fieldRef(ctx, p)),
    ser: serP ? fieldRef(ctx, serP) : undefined,
    x: xP ? fieldRef(ctx, xP) : undefined,
    y: yP ? fieldRef(ctx, yP) : undefined,
    size: sizeP ? fieldRef(ctx, sizeP) : undefined,
    tips: tips.map((t) => fieldRef(ctx, t))
  }
  const gN = groups.length
  const fs = (ref: FieldRef | undefined, v: Scalar, ri?: number, vi?: number) => formatScalar(v, (ri !== undefined && vi !== undefined ? res.formats?.[ri]?.[vi] : undefined) ?? ref?.formatString, ctx.format, ref?.desc?.dataType)

  const frameKeys = playP ? res.rows.map((row) => formatCategoryValue(ctx, refs.play!, row[playI])) : []
  // frames = play values that have at least one plotted point (rows with blank X/Y are not drawn)
  const plotted = (row: Scalar[]) => (!xP || num(row[gN + xI]) !== null) && (!yP || num(row[gN + yI]) !== null)
  const frames = collectFrames(frameKeys.filter((_, r) => plotted(res.rows[r])))
  const frameIndex = new Map(frames.map((f, i) => [f, i]))

  const seriesMap = new Map<string, ScatterSeries>()
  const catIndex = new Map<string, number>()
  const def = defaultFill(fmt.pc)
  const colorByCategory = !serP && fmt.bool('colorByCategory', 'show', false)
  const cfVals: Scalar[] = []
  const points: ScatterPoint[] = []
  res.rows.forEach((row, r) => {
    const x = xP ? num(row[gN + xI]) : 0
    const y = yP ? num(row[gN + yI]) : 0
    if (x === null || y === null) return
    const serV = serP ? row[serI] : null
    const sKey = refs.ser ? formatCategoryValue(ctx, refs.ser, serV) : ''
    const serScope: ScopeField[] = refs.ser ? [{ expr: refs.ser.identityExpr, value: serV }] : []
    if (!seriesMap.has(sKey)) {
      const idx = seriesMap.size
      const color = refs.ser ? staticFill(fmt.pc, { fields: serScope, index: idx }) : (def ?? staticFill(fmt.pc, { metadata: yP?.queryRef, index: 0 }))
      seriesMap.set(sKey, { key: sKey, label: sKey || refs.y?.label || '', color, scope: { fields: serScope }, metadata: refs.ser ? undefined : yP?.queryRef })
    }
    const catVals = levelI.map((i) => row[i])
    const catScope: ScopeField[] = catVals.map((v, li) => ({ expr: refs.levels[li].identityExpr, value: v }))
    const fields: ScopeField[] = [...catScope]
    for (const f of serScope) if (!fields.some((g) => fieldKey(g.expr) === fieldKey(f.expr))) fields.push(f)
    const catLabels = catVals.map((v, li) => formatCategoryValue(ctx, refs.levels[li], v))
    const label = catLabels.length ? catLabels.join(' ') : sKey
    const frame = refs.play ? frameKeys[r] : ''
    const ck = catLabels.join('|')
    if (!catIndex.has(ck)) catIndex.set(ck, catIndex.size)
    const identity = { fields }
    const idKey = identityKey(identity)
    const series = seriesMap.get(sKey)!
    // static color: per-point override (data selector) > color by category > series color
    let color = series.color
    if (catScope.length && findEntry(fmt.pc.objects?.dataPoint ?? [], 'fill', { fields: catScope })) color = staticFill(fmt.pc, { fields: catScope, index: catIndex.get(ck)! })
    else if (colorByCategory) color = staticFill(fmt.pc, { fields: catScope, index: catIndex.get(ck)! })
    const hl = res.highlights ? (res.highlights[r]?.some((v) => v !== null && v !== undefined) ?? false) : false
    const tipsItems: TooltipItem[] = [
      ...refs.levels.map((l, li) => ({ label: l.label, value: catLabels[li] })),
      ...(refs.ser && !refs.levels.some((l) => fieldKey(l.proj.expr) === fieldKey(refs.ser!.proj.expr)) ? [{ label: refs.ser.label, value: sKey }] : []),
      ...(refs.play ? [{ label: refs.play.label, value: frame }] : []),
      ...(refs.x ? [{ label: refs.x.label, value: fs(refs.x, x, r, xI) }] : []),
      ...(refs.y ? [{ label: refs.y.label, value: fs(refs.y, y, r, yI) }] : []),
      ...(refs.size ? [{ label: refs.size.label, value: fs(refs.size, row[gN + sizeI], r, sizeI) }] : []),
      ...refs.tips.map((t, ti) => ({ label: t.label, value: fs(t, row[gN + tipI[ti]], r, tipI[ti]) }))
    ]
    cfVals.push(cfI >= 0 ? row[gN + cfI] : null)
    points.push({
      key: `${frame}|${idKey}`,
      idKey,
      x,
      y,
      size: sizeP ? num(row[gN + sizeI]) : null,
      label,
      seriesKey: sKey,
      frame,
      frameIndex: refs.play ? frameIndex.get(frame)! : 0,
      identity,
      catIdentity: { fields: catScope },
      highlighted: hl,
      color,
      tips: tipsItems
    })
  })
  // conditional formatting (gradient range over all plotted points, all frames)
  if (rule && cfI >= 0) {
    const nums = cfVals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    const range: [number, number] = nums.length ? [Math.min(...nums), Math.max(...nums)] : [0, 0]
    points.forEach((p, i) => {
      const c = evalConditional(rule, cfVals[i], range, fmt.theme)
      if (c) p.color = c
    })
  }
  return {
    points,
    series: [...seriesMap.values()],
    frames,
    xRef: refs.x,
    yRef: refs.y,
    sizeRef: refs.size,
    seriesRef: refs.ser,
    playRef: refs.play,
    levels: refs.levels,
    drillLevels: allCats.length,
    hasHighlights: !!res.highlights,
    hasX: !!xP,
    hasY: !!yP,
    truncated: !!res.truncated
  }
}

/** Rows for "Show as table" / export. */
export function scatterTableOf(d: ScatterData): { columns: string[]; rows: Scalar[][] } {
  const columns = [
    ...(d.playRef ? [d.playRef.label] : []),
    ...(d.levels.length ? d.levels.map((l) => l.label) : ['Point']),
    ...(d.seriesRef ? [d.seriesRef.label] : []),
    d.xRef?.label ?? 'X',
    d.yRef?.label ?? 'Y',
    ...(d.sizeRef ? [d.sizeRef.label] : [])
  ]
  const rows = d.points.map((p) => [
    ...(d.playRef ? [p.frame] : []),
    ...(d.levels.length ? p.catIdentity.fields.map((f) => f.value) : [p.label]),
    ...(d.seriesRef ? [p.seriesKey] : []),
    p.x,
    p.y,
    ...(d.sizeRef ? [p.size] : [])
  ])
  return { columns, rows }
}
