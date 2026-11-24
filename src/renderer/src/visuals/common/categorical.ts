/**
 * Categorical data model for charts: category × series × measure, built from the visual's
 * field wells with engine.summarize (via the shared query helpers).
 *
 *   Category role  → category axis (hierarchy; one drill level at a time, or several when expanded)
 *   Series role    → legend series (splits the "split" measure roles, e.g. Y)
 *   other measures → series that are not split by the legend (e.g. Y2 lines in combo charts)
 *   Tooltips       → extra values per point
 *
 * Sorting follows Power BI: the visual's sortDefinition (category field or a measure — measure
 * sorts order categories by their total across series), else the chart's default.
 */
import type { Scalar } from '@core/model/data'
import type { FieldDescription, SortSpec, SummarizeResult } from '@core/engine/api'
import { columnExpr, type DataPointIdentity, type SQExpr, fieldKey } from '@core/report/sq'
import { decodeValue } from '@core/report/props'
import type { VisualHostContext } from '../contract'
import { describe, expandParameters, getProjections, labelOf, valueId, type Projection } from './query'
import { formatScalar } from './units'
import { highDensitySample } from './sampling'
import { isVisualCalc, summarizeWithVisualCalcs } from './visualCalcs'
import { conditionalRule, defaultFill, evalConditional, findEntry, pointGradient, staticFill, type ConditionalRule, type ScopeField } from './color'
import type { GradientFill } from '@core/report/gradientFill'
import type { FormatReader } from './fmtProps'

export interface FieldRef {
  proj: Projection
  desc?: FieldDescription
  /** column expression used in identities / filters (hierarchy levels resolved to their column) */
  identityExpr: SQExpr
  label: string
  formatString?: string
}

export interface Category {
  key: string
  values: Scalar[]
  labels: string[]
  label: string
  identity: DataPointIdentity
  scope: ScopeField[]
}

export interface Series {
  key: string
  name: string
  measure: FieldRef
  role: string
  /** legend value when split by the Series role */
  seriesValue?: Scalar
  split: boolean
  index: number
  color: string
  /** per point colors (show all data points / conditional formatting) */
  pointColors?: Array<string | undefined>
  /** Lumen gradient fill of the series (bars / slices drawn with `color`), color.ts `pointGradient` */
  gradient?: GradientFill
  /** per point gradient fills, parallel to pointColors */
  pointGradients?: Array<GradientFill | undefined>
  /** extra per-point values requested with CategoricalOptions.pointValues, keyed by id */
  pointValues?: Record<string, Array<Scalar>>
  /** per point conditional colors of other color properties, keyed `object.prop` (e.g. 'labels.color') */
  cfColors?: Record<string, Array<string | undefined>>
  metadata: string
  scope: ScopeField[]
  values: Array<number | null>
  highlights?: Array<number | null>
  formats: Array<string | undefined>
  /** tooltip field values per category: tooltipValues[c][t] */
  tooltipValues: Scalar[][]
}

export interface CategoricalData {
  levels: FieldRef[]
  /** all category projections (for drill availability) */
  allLevels: Projection[]
  seriesField?: FieldRef
  categories: Category[]
  series: Series[]
  tooltips: FieldRef[]
  hasHighlights: boolean
  truncated: boolean
  /** categories were reduced with high-density sampling (line/area charts over the point budget) */
  sampled?: boolean
  categoryType: 'text' | 'date' | 'number'
  warnings: string[]
}

export interface CategoricalOptions {
  categoryRole?: string
  seriesRole?: string
  /** measure roles split by the legend series */
  splitRoles?: string[]
  /** measure roles never split by series (combo line values) */
  unsplitRoles?: string[]
  tooltipRole?: string
  /** default ordering (PBI's default sort, normally saved in sortDefinition with isDefaultSort) */
  defaultSort?: 'measureDesc' | 'categoryAsc'
  /** apply `defaultSort` even when the visual has no sortDefinition (otherwise category order is kept, like PBI) */
  applyDefaultSortWhenUnsaved?: boolean
  maxCategories?: number
  /** data reduction when over maxCategories: 'highDensity' = PBI line-chart sampling, default = first N */
  sampling?: 'highDensity'
  maxSeries?: number
  highlight?: boolean
  /** colors: per-point colors when there is a single series (showAllDataPoints / conditional) */
  fmt?: FormatReader
  /** varyColors: every category gets its own palette color (pie, donut, treemap, funnel?) */
  varyColors?: boolean
  extraFilters?: any[]
  /** extra per-point values (e.g. error-bar bounds): queried with the split measures, stored in series.pointValues[id] */
  pointValues?: Array<{ id: string; expr: any; metadata?: string }>
  /** color properties evaluated for conditional formatting (fx), `object.prop`; default DEFAULT_CF_PROPS */
  cfProps?: string[]
}

/**
 * Chart color properties on which Power BI offers conditional formatting (fx) per data point:
 * data colors and data label color.
 */
export const DEFAULT_CF_PROPS = ['dataPoint.fill', 'labels.color']

export function fieldRef(ctx: VisualHostContext, p: Projection): FieldRef {
  const desc = safeDescribe(ctx, p)
  let identityExpr: SQExpr = p.expr
  if (p.info.kind === 'hierarchyLevel' && desc?.column) identityExpr = columnExpr(desc.column.table, desc.column.column)
  return { proj: p, desc, identityExpr, label: labelOf(ctx, p), formatString: desc?.formatString }
}

function safeDescribe(ctx: VisualHostContext, p: Projection): FieldDescription | undefined {
  try {
    return describe(ctx, p)
  } catch {
    return undefined
  }
}

/** Which category projections are active for the current drill state. */
export function activeLevels(all: Projection[], ctx: VisualHostContext): Projection[] {
  if (!all.length) return []
  const d = ctx.drill
  const pristine = !d || (d.level === 0 && !d.path?.length && d.expandedLevel === undefined)
  if (pristine && all.length > 1) {
    // No runtime drill yet: honour the saved PBIR state. Several `active` projections = the
    // hierarchy is expanded down to the last active level; a single active one = drilled to it.
    const act = all.map((p, i) => (p.raw?.active === true ? i : -1)).filter((i) => i >= 0)
    if (act.length > 1) return all.slice(0, act[act.length - 1] + 1)
    if (act.length === 1 && act[0] > 0) return [all[act[0]]]
  }
  const exp = ctx.drill?.expandedLevel
  if (exp !== undefined && exp > 0) return all.slice(0, Math.min(all.length, exp + 1))
  const lvl = Math.max(0, Math.min(all.length - 1, ctx.drill?.level ?? 0))
  return [all[lvl]]
}

const keyOf = (v: Scalar): string => (v instanceof Date ? 'd' + v.getTime() : v === null ? '∅' : typeof v + ':' + String(v))

export function formatCategoryValue(ctx: VisualHostContext, f: FieldRef, v: Scalar): string {
  return formatScalar(v, f.formatString, ctx.format, f.desc?.dataType)
}

/** Build categorical data. Throws engine errors to the caller (rendered as a visual error). */
export function buildCategorical(visualJson: any, ctx: VisualHostContext, opts: CategoricalOptions = {}): CategoricalData {
  const roles = getProjections(visualJson)
  const catRole = opts.categoryRole ?? 'Category'
  const allLevels = expandParameters(roles[catRole] ?? [], ctx)
  const levelsP = activeLevels(allLevels, ctx)
  const seriesP = opts.seriesRole ? expandParameters(roles[opts.seriesRole] ?? [], ctx)[0] : undefined
  const splitM: Projection[] = []
  for (const r of opts.splitRoles ?? ['Y']) splitM.push(...expandParameters(roles[r] ?? [], ctx))
  const unsplitM: Projection[] = []
  for (const r of opts.unsplitRoles ?? []) unsplitM.push(...expandParameters(roles[r] ?? [], ctx))
  const tipsP = opts.tooltipRole === undefined ? expandParameters(roles['Tooltips'] ?? [], ctx) : opts.tooltipRole ? expandParameters(roles[opts.tooltipRole] ?? [], ctx) : []

  const levels = levelsP.map((p) => fieldRef(ctx, p))
  const seriesField = seriesP ? fieldRef(ctx, seriesP) : undefined
  const tooltips = tipsP.map((p) => fieldRef(ctx, p))
  const warnings: string[] = []

  // conditional-formatting inputs (dataPoint.fill) become extra values
  // (fx) on any supported color property: each rule's input becomes an extra query value
  const cfRules: Array<{ rule: ConditionalRule; id: string; prop: string }> = []
  if (opts.fmt) {
    for (const prop of opts.cfProps ?? DEFAULT_CF_PROPS) {
      const [obj, name] = prop.split('.')
      for (const m of [...splitM, ...unsplitM]) {
        const rule = conditionalRule(opts.fmt.pc, obj, name, m.queryRef)
        if (rule?.input && !cfRules.some((r) => r.prop === prop && JSON.stringify(r.rule.expr) === JSON.stringify(rule.expr) && r.rule.metadata === rule.metadata)) cfRules.push({ rule, id: `cf|${cfRules.length}`, prop })
      }
    }
  }

  const showAll = [...levelsP, ...(seriesP ? [seriesP] : [])].some((p) => p.raw?.showAll === true)
  const sortDef: any[] = visualJson?.visual?.query?.sortDefinition?.sort ?? []

  // the legend field may also be a category level (e.g. Category = [Channel, Month], Legend =
  // Channel): group by it once and read the series value from that level's column
  const seriesLevel = seriesP ? levelsP.findIndex((l) => fieldKey(l.expr) === fieldKey(seriesP.expr)) : -1
  const groupProjs = [...levelsP, ...(seriesP && seriesLevel < 0 ? [seriesP] : [])]
  const run = (groups: Projection[], measures: Projection[], withTips: boolean, withCf: boolean): SummarizeResult => {
    // projections parallel to `values` (visual calculations need them; extras get stand-ins)
    const projs: Projection[] = [...measures, ...(withTips ? tipsP : [])]
    const values = [
      ...measures.map((m) => ({ id: valueId(m), expr: { kind: 'sq' as const, expr: m.expr } })),
      ...(withTips ? tipsP.map((t) => ({ id: 'tip|' + valueId(t), expr: { kind: 'sq' as const, expr: t.expr } })) : []),
      ...(withCf ? cfRules.map((c) => ({ id: c.id, expr: { kind: 'sq' as const, expr: c.rule.input } })) : []),
      ...(withTips ? (opts.pointValues ?? []).map((pv) => ({ id: 'pv|' + pv.id, expr: { kind: 'sq' as const, expr: pv.expr } })) : [])
    ]
    // extra sort-by measure not otherwise queried
    for (const s of sortDef) {
      const k = fieldKey(s.field)
      if (s.field?.Measure || s.field?.Aggregation) {
        if (![...measures, ...tipsP].some((m) => fieldKey(m.expr) === k)) values.push({ id: 'sort|' + k, expr: { kind: 'sq', expr: s.field } })
      }
    }
    const orderBy: SortSpec[] = groups.map((_, i) => ({ target: { group: i }, direction: 'asc' }))
    const req = {
      groupBy: groups.map((g) => ({ kind: 'sq' as const, expr: g.expr })),
      values,
      filters: [...ctx.filters, ...(opts.extraFilters ?? [])],
      orderBy,
      limit: 50000,
      showItemsWithNoData: showAll,
      highlightFilters: opts.highlight && ctx.highlightFilters?.length ? ctx.highlightFilters : undefined
    }
    if (!projs.some(isVisualCalc)) return ctx.engine.summarize(req)
    // Visual calculations: evaluated over the visual matrix (Category = ROWS, Legend = COLUMNS). With both axes
    // the engine densifies (PBI DENSIFY): combinations without data are appended with blank base values and
    // their calculation values; they always belong to existing categories / legend members.
    const stand = (v: (typeof values)[number]): Projection => ({ role: '', expr: v.expr.expr, queryRef: v.id, nativeQueryRef: v.id, info: { kind: 'unknown' } as Projection['info'], isMeasure: true })
    return summarizeWithVisualCalcs(ctx, req, groups, values.map((v, i) => projs[i] ?? stand(v)))
  }

  const empty: CategoricalData = { levels, allLevels, seriesField, categories: [], series: [], tooltips, hasHighlights: false, truncated: false, categoryType: 'text', warnings }
  if (!splitM.length && !unsplitM.length && !levels.length) return empty

  const measuresA = seriesP ? splitM : [...splitM, ...unsplitM]
  const resA = measuresA.length || levels.length ? run(groupProjs, measuresA, true, true) : undefined
  const resB = seriesP && unsplitM.length ? run(levelsP, unsplitM, false, false) : undefined
  warnings.push(...(resA?.warnings ?? []), ...(resB?.warnings ?? []))

  // ---- categories (in engine order = category asc with sort-by-column)
  const nL = levelsP.length
  const catIndex = new Map<string, number>()
  const categories: Category[] = []
  const addCat = (row: Scalar[]): number => {
    const vals = row.slice(0, nL)
    const key = vals.map(keyOf).join('|')
    let i = catIndex.get(key)
    if (i === undefined) {
      i = categories.length
      catIndex.set(key, i)
      const labels = vals.map((v, li) => formatCategoryValue(ctx, levels[li], v))
      const scope = vals.map((v, li) => ({ expr: levels[li].identityExpr, value: v }))
      categories.push({ key, values: vals, labels, label: labels.join(' '), identity: { fields: scope }, scope })
    }
    return i
  }
  if (nL === 0 && (resA?.rows.length || resB?.rows.length)) {
    categories.push({ key: '', values: [], labels: [], label: '', identity: { fields: [] }, scope: [] })
    catIndex.set('', 0)
  }
  for (const row of resA?.rows ?? []) addCat(row)
  for (const row of resB?.rows ?? []) addCat(row)

  // ---- series
  const series: Series[] = []
  const seriesByKey = new Map<string, Series>()
  const mkSeries = (m: Projection, role: string, split: boolean, sv: Scalar | undefined, measureIdx: number): Series => {
    const key = split && seriesP ? `${m.queryRef}|${keyOf(sv ?? null)}` : m.queryRef + '|' + role
    let s = seriesByKey.get(key)
    if (!s) {
      const mf = fieldRef(ctx, m)
      const scope: ScopeField[] = split && seriesField ? [{ expr: seriesField.identityExpr, value: sv ?? null }] : []
      const sName = split && seriesField ? (splitM.length > 1 ? `${formatCategoryValue(ctx, seriesField, sv ?? null)} ${mf.label}` : formatCategoryValue(ctx, seriesField, sv ?? null)) : mf.label
      s = {
        key,
        name: sName,
        measure: mf,
        role,
        seriesValue: split ? sv : undefined,
        split: !!(split && seriesP),
        index: series.length,
        color: '',
        metadata: m.queryRef,
        scope,
        values: new Array(categories.length).fill(null),
        formats: new Array(categories.length).fill(undefined),
        tooltipValues: categories.map(() => new Array(tipsP.length).fill(null))
      }
      void measureIdx
      seriesByKey.set(key, s)
      series.push(s)
    }
    return s
  }

  const cfValues = new Map<string, Scalar[]>() // `${seriesKey}\0${ruleId}` → per category input values
  const sortExtra = new Map<string, Array<number>>()

  const fill = (res: SummarizeResult | undefined, groups: Projection[], measures: Projection[], split: boolean, withTips: boolean) => {
    if (!res) return
    const colIdx = (id: string) => res.columns.findIndex((c) => c.id === id)
    const gN = groups.length
    for (let r = 0; r < res.rows.length; r++) {
      const row = res.rows[r]
      const ci = catIndex.get(row.slice(0, nL).map(keyOf).join('|'))
      if (ci === undefined) continue
      const sv = split && seriesP ? row[seriesLevel >= 0 ? seriesLevel : nL] : undefined
      measures.forEach((m, mi) => {
        const role = m.role
        const s = mkSeries(m, role, split, sv, mi)
        const vi = colIdx(valueId(m))
        const col = vi >= 0 ? vi : gN + mi
        const raw = row[col]
        const v = typeof raw === 'number' ? raw : typeof raw === 'boolean' ? Number(raw) : raw === null ? null : Number.isFinite(Number(raw)) ? Number(raw) : null
        s.values[ci] = v
        const f = res.formats?.[r]?.[col - gN]
        s.formats[ci] = f ?? s.measure.formatString
        if (res.highlights) {
          s.highlights ??= new Array(categories.length).fill(null)
          const h = res.highlights[r]?.[col - gN]
          s.highlights[ci] = typeof h === 'number' ? h : h === null || h === undefined ? null : Number(h)
        }
        if (withTips) {
          tipsP.forEach((t, ti) => {
            const ti2 = colIdx('tip|' + valueId(t))
            if (ti2 >= 0) s.tooltipValues[ci][ti] = row[ti2]
          })
          for (const pv of opts.pointValues ?? []) {
            if (pv.metadata && pv.metadata !== m.queryRef) continue
            const k = colIdx('pv|' + pv.id)
            if (k < 0) continue
            s.pointValues ??= {}
            const arr = (s.pointValues[pv.id] ??= new Array(categories.length).fill(null))
            arr[ci] = row[k]
          }
          for (const c of cfRules) {
            const k = colIdx(c.id)
            if (k < 0) continue
            if (c.rule.metadata && c.rule.metadata !== m.queryRef) continue
            const ck = `${s.key}\u0000${c.id}`
            const arr = cfValues.get(ck) ?? new Array(categories.length).fill(null)
            arr[ci] = row[k]
            cfValues.set(ck, arr)
          }
        }
      })
      for (const sd of sortDef) {
        const k = colIdx('sort|' + fieldKey(sd.field))
        if (k < 0) continue
        const arr = sortExtra.get(fieldKey(sd.field)) ?? new Array(categories.length).fill(0)
        const v = row[k]
        arr[ci] += typeof v === 'number' ? v : 0
        sortExtra.set(fieldKey(sd.field), arr)
      }
    }
  }
  // make sure every measure has a series even with no rows (legend / empty state)
  fill(resA, groupProjs, measuresA, true, true)
  fill(resB, levelsP, unsplitM, false, false)
  if (!seriesP) {
    // keep measure order stable as declared (Y then Y2)
    series.sort((a, b) => measuresA.findIndex((m) => m.queryRef === a.metadata && m.role === a.role) - measuresA.findIndex((m) => m.queryRef === b.metadata && m.role === b.role))
  } else {
    // legend series in the legend field's sort order (sort-by-column aware, blank first like PBI),
    // then unsplit measures
    const rank = new Map<string, number>()
    try {
      const dv = ctx.engine.distinctValues({ column: { kind: 'sq', expr: seriesP.expr }, filters: [...ctx.filters, ...(opts.extraFilters ?? [])], existsInFacts: true })
      dv.values.forEach((v, i) => rank.set(keyOf(v), i))
    } catch {
      // keep engine row order
    }
    const firstSeen = new Map(series.map((s, i) => [s.key, i]))
    const r = (s: Series) => (s.split ? (rank.get(keyOf(s.seriesValue ?? null)) ?? (s.seriesValue === null || s.seriesValue === undefined || s.seriesValue === '' ? -1 : 1e9)) : 2e9)
    series.sort((a, b) => r(a) - r(b) || (splitM.findIndex((m) => m.queryRef === a.metadata) - splitM.findIndex((m) => m.queryRef === b.metadata)) || firstSeen.get(a.key)! - firstSeen.get(b.key)!)
  }

  // ---- sort categories
  let order = categories.map((_, i) => i)
  const totalsFor = (key: string): number[] | undefined => {
    const fromSeries = series.filter((s) => fieldKey(s.measure.proj.expr) === key)
    if (fromSeries.length) return categories.map((_, ci) => fromSeries.reduce((a, s) => a + (s.values[ci] ?? 0), 0))
    const tipI = tipsP.findIndex((t) => fieldKey(t.expr) === key)
    if (tipI >= 0) return categories.map((_, ci) => series.reduce((a, s) => a + (typeof s.tooltipValues[ci][tipI] === 'number' ? (s.tooltipValues[ci][tipI] as number) : 0), 0))
    return sortExtra.get(key)
  }
  const applied = sortDef.length > 0
  if (applied) {
    const s0 = sortDef[0]
    const k = fieldKey(s0.field)
    const desc = s0.direction === 'Descending'
    const li = levelsP.findIndex((l) => fieldKey(l.expr) === k || (l.info.kind === 'hierarchyLevel' && fieldKey(l.expr) === k))
    const totals = li < 0 ? totalsFor(k) : undefined
    if (totals) order.sort((a, b) => (desc ? totals[b] - totals[a] : totals[a] - totals[b]) || a - b)
    else if (desc) order.reverse()
  } else if (opts.defaultSort === 'measureDesc' && series.length && opts.applyDefaultSortWhenUnsaved) {
    // Power BI saves its default sort (measure descending) in sortDefinition (isDefaultSort);
    // when nothing is saved it keeps the category order (sort-by-column ascending).
    const s0 = series[0]
    const totals = categories.map((_, ci) => series.filter((s) => s.metadata === s0.metadata).reduce((a, s) => a + (s.values[ci] ?? 0), 0))
    order.sort((a, b) => totals[b] - totals[a] || a - b)
  }

  let truncated = !!(resA?.truncated || resB?.truncated)
  let sampled = false
  const maxC = opts.maxCategories ?? 1000
  if (order.length > maxC) {
    if (opts.sampling === 'highDensity') {
      // keep the line's shape (bucket edges + per-series extremes) instead of the first N
      const keep = highDensitySample(
        order.length,
        series.map((s) => order.map((i) => s.values[i])),
        maxC
      )
      order = keep.map((k) => order[k])
      sampled = true
    } else order = order.slice(0, maxC)
    truncated = true
  }
  const reCats = order.map((i) => categories[i])
  for (const s of series) {
    s.values = order.map((i) => s.values[i])
    s.formats = order.map((i) => s.formats[i])
    s.tooltipValues = order.map((i) => s.tooltipValues[i])
    if (s.highlights) s.highlights = order.map((i) => s.highlights![i])
    if (s.pointValues) for (const k of Object.keys(s.pointValues)) s.pointValues[k] = order.map((i) => s.pointValues![k][i])
  }
  for (const [k, arr] of [...cfValues]) cfValues.set(k, order.map((i) => arr[i]))

  let finalSeries = series
  const maxS = opts.maxSeries ?? 60
  if (finalSeries.filter((s) => s.split).length > maxS) {
    let n = 0
    finalSeries = finalSeries.filter((s) => !s.split || n++ < maxS)
    truncated = true
  }
  finalSeries.forEach((s, i) => (s.index = i))

  // ---- colors
  if (opts.fmt) {
    const fmt = opts.fmt
    const def = defaultFill(fmt.pc)
    // A `dataPoint.fill` stored without a selector is the colour the format pane shows for a chart drawing one series:
    // Power BI draws it even when a per-measure `fill` (metadata selector) is stored as well (a Power BI Desktop render
    // of a single-measure bar chart storing both draws the selector-less colour). With several series (combo charts)
    // the per-measure fill still wins, and the legacy `defaultColor` always yields to it.
    const allFill = allSeriesFill(fmt)
    const single = finalSeries.length === 1 || finalSeries.filter((s) => s.role === finalSeries[0].role).length === 1
    for (const s of finalSeries) {
      const idx = s.index
      s.color = s.split ? staticFill(fmt.pc, { fields: s.scope, index: idx }) : staticFill(fmt.pc, { metadata: s.metadata, index: idx })
      if (!s.split && finalSeries.length === 1 && allFill) s.color = allFill
      else if (def && !s.split && single && !hasExplicitSeriesFill(fmt, s.metadata)) s.color = def
      if (opts.varyColors) s.pointColors = reCats.map((c, ci) => staticFill(fmt.pc, { fields: c.scope, index: ci }))
      else if (single && !s.split && fmt.bool('dataPoint', 'showAllDataPoints', false))
        s.pointColors = reCats.map((c, ci) => (hasPointFill(fmt, c.scope) ? staticFill(fmt.pc, { fields: c.scope, index: ci }) : s.color))
      s.gradient = pointGradient(fmt.pc, s.color, { metadata: s.metadata, fields: s.split ? s.scope : undefined })
      if (s.pointColors) {
        const pg = s.pointColors.map((c, ci) => pointGradient(fmt.pc, c, { metadata: s.metadata, fields: reCats[ci]?.scope }))
        if (pg.some(Boolean)) s.pointGradients = pg
      }
      for (const prop of new Set(cfRules.map((r) => r.prop))) {
        const rule = cfRules.find((r) => r.prop === prop && r.rule.metadata === s.metadata) ?? cfRules.find((r) => r.prop === prop && !r.rule.metadata)
        const cf = rule ? cfValues.get(`${s.key}\u0000${rule.id}`) : undefined
        if (!rule || !cf) continue
        // gradient range over all series sharing the rule (PBI: min/max of the input over the visual)
        const all = [...cfValues.entries()].filter(([k]) => k.endsWith('\u0000' + rule.id)).flatMap(([, v]) => v)
        const nums = all.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
        const range: [number, number] = nums.length ? [Math.min(...nums), Math.max(...nums)] : [0, 0]
        const colors = cf.map((v) => evalConditional(rule.rule, v, range, fmt.theme))
        if (prop === 'dataPoint.fill') {
          s.pointGradients = s.pointGradients?.map((g, ci) => (colors[ci] ? undefined : g))
          s.pointColors = colors.map((c, ci) => c ?? s.pointColors?.[ci] ?? s.color)
        }
        else (s.cfColors ??= {})[prop] = colors
      }
    }
  }

  const ct: CategoricalData['categoryType'] =
    levels.length === 1 ? (levels[0].desc?.dataType === 'dateTime' ? 'date' : ['int64', 'double', 'decimal'].includes(levels[0].desc?.dataType ?? '') ? 'number' : 'text') : 'text'
  return {
    levels,
    allLevels,
    seriesField,
    categories: reCats,
    series: finalSeries,
    tooltips,
    hasHighlights: finalSeries.some((s) => s.highlights),
    truncated,
    sampled,
    categoryType: ct,
    warnings
  }
}

function hasExplicitSeriesFill(fmt: FormatReader, metadata: string): boolean {
  return (fmt.pc.objects?.dataPoint ?? []).some((e) => e.selector?.metadata === metadata && e.properties && 'fill' in e.properties)
}

/** The selector-less `dataPoint.fill` of the visual (format pane "All" colour), if stored. */
function allSeriesFill(fmt: FormatReader): string | undefined {
  const e = (fmt.pc.objects?.dataPoint ?? []).find((x) => !x.selector && x.properties && 'fill' in x.properties)
  const v = e ? decodeValue(e.properties.fill, fmt.pc.theme) : undefined
  return typeof v === 'string' ? v : undefined
}

function hasPointFill(fmt: FormatReader, scope: ScopeField[]): boolean {
  return !!findEntry(fmt.pc.objects?.dataPoint ?? [], 'fill', { fields: scope })
}

/** Identity of a data point (category + optional series). */
export function pointIdentity(cat: Category | undefined, s: Series | undefined): DataPointIdentity {
  return { fields: [...(cat?.scope ?? []), ...(s?.scope ?? [])] }
}

/** Tabular data behind a categorical chart ("Show as table" / export). */
export function categoricalTable(d: CategoricalData): { columns: string[]; rows: Scalar[][] } {
  const columns = [...d.levels.map((l) => l.label), ...(d.seriesField ? [d.seriesField.label] : [])]
  const measures = [...new Map(d.series.map((s) => [s.metadata + '|' + s.role, s.measure.label])).values()]
  columns.push(...measures)
  const rows: Scalar[][] = []
  if (d.seriesField) {
    const svs = [...new Map(d.series.filter((s) => s.split).map((s) => [s.key.split('|').slice(1).join('|'), s.seriesValue ?? null])).values()]
    d.categories.forEach((c, ci) => {
      for (const sv of svs) {
        const vals = measures.map((_, mi) => {
          const meta = [...new Map(d.series.map((s) => [s.metadata + '|' + s.role, s])).values()][mi]
          const s = d.series.find((x) => x.metadata === meta.metadata && x.role === meta.role && (!x.split || x.seriesValue === sv || (x.seriesValue instanceof Date && sv instanceof Date && x.seriesValue.getTime() === sv.getTime())))
          return s?.values[ci] ?? null
        })
        if (vals.every((v) => v === null)) continue
        rows.push([...c.values, sv, ...vals])
      }
    })
  } else {
    d.categories.forEach((c, ci) => rows.push([...c.values, ...d.series.map((s) => s.values[ci])]))
  }
  return { columns, rows }
}
