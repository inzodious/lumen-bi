/**
 * Narrative inputs: turn visuals (their field wells) into NarrDatasets with engine.summarize.
 *
 * Each visual contributes its first category field (axis / rows / group) and up to three measures, grouped by
 * the category only (legend / small-multiple splits are not narrated — Lumen approximation). Tables, matrices,
 * slicers, text, shapes, buttons and the AI visuals are skipped, as in Power BI.
 */
import type { SQFilter } from '@core/report/sq'
import type { VisualDocument } from '@core/report/types'
import type { DataRoleDef, PageVisualInfo, VisualHostContext } from '../../../contract'
import { getVisual } from '../../../registry'
import { expandParameters, getProjections, valueId, type Projection } from '../../../common/query'
import { fieldRef, formatCategoryValue, type FieldRef } from '../../../common/categorical'
import { formatWithUnits, parseNumberFormat, resolveDisplayUnit } from '../../../common/units'
import type { NarrDataset, NarrSeries } from './generate'

/** Visual types never summarized. */
const SKIP_TYPES = new Set(['aiNarratives', 'qnaVisual', 'keyDriversVisual', 'textbox', 'image', 'shape', 'actionButton', 'pageNavigator', 'bookmarkNavigator', 'scriptVisual', 'pythonVisual', 'rdlVisual', 'tableEx', 'pivotTable'])
const SKIP_CATEGORIES = new Set(['slicer', 'element', 'table', 'custom'])
const NON_VALUE_ROLES = new Set(['Tooltips', 'MinValue', 'MaxValue'])
const MAX_CATEGORIES = 1000

/** A visual to summarize; `filters` falls back to the narrative's own filter context. */
export type NarrSource = PageVisualInfo

function isSummarizable(type: string): boolean {
  if (SKIP_TYPES.has(type)) return false
  const def = getVisual(type)
  return !!def && !SKIP_CATEGORIES.has(def.category) && !def.isSlicer
}

/** Ordered (time-like) axis: dates, sort-by-column fields, date hierarchy levels, year/quarter/month-like integers. */
export function isOrderedField(f: FieldRef): boolean {
  const d = f.desc
  if (!d) return false
  if (d.dataType === 'dateTime') return true
  if (d.sortBy) return true
  if (f.proj.info.kind === 'hierarchyLevel' && /date|calendar|time/i.test(f.proj.info.hierarchy ?? '')) return true
  if (f.proj.info.variationColumn) return true
  return (d.dataType === 'int64' || d.dataType === 'double') && /(year|quarter|month|week|day|period|fiscal)/i.test(d.name)
}

function roleKind(roles: DataRoleDef[], role: string): DataRoleDef['kind'] | undefined {
  return roles.find((r) => r.name === role)?.kind
}

/** Category + measure projections of a visual, in role order. */
export function narrativeFields(visualJson: any, ctx: VisualHostContext, roles?: DataRoleDef[]): { category?: Projection; measures: Projection[] } {
  const all = getProjections(visualJson)
  const roleNames = roles?.length ? roles.map((r) => r.name) : Object.keys(all)
  let category: Projection | undefined
  const measures: Projection[] = []
  for (const role of roleNames) {
    if (NON_VALUE_ROLES.has(role)) continue
    const kind = roles ? roleKind(roles, role) : undefined
    const projs = expandParameters(all[role] ?? [], ctx)
    for (const p of projs) {
      if (p.isMeasure && kind !== 'grouping') {
        if (measures.length < 3 && !measures.some((m) => m.queryRef === p.queryRef)) measures.push(p)
      } else if (!p.isMeasure && kind !== 'measure' && !category && role !== 'Series' && role !== 'Legend') {
        // hierarchy wells: the active level, else the first
        const active = projs.find((x) => !x.isMeasure && x.active) ?? p
        category = active
      }
    }
  }
  return { category, measures }
}

function seriesOf(ctx: VisualHostContext, f: FieldRef, values: Array<number | null>, sharedMaxAbs?: number): NarrSeries {
  const maxAbs = sharedMaxAbs ?? Math.max(0, ...values.map((x) => Math.abs(x ?? 0)))
  const pf = parseNumberFormat(f.formatString)
  // one display unit per series (PBI auto units), so values in a sentence read consistently
  const unit = pf.percent ? 1 : resolveDisplayUnit(0, maxAbs)
  return {
    measure: f.label,
    values,
    ratio: pf.percent,
    unitKey: f.formatString ?? '',
    format: (v: number) => formatWithUnits(v, { unit, formatString: f.formatString, format: ctx.format })
  }
}

/** Dataset for one visual's fields (null when it has no measure). */
export function datasetFor(visualJson: any, ctx: VisualHostContext, filters: SQFilter[], roles?: DataRoleDef[]): NarrDataset | null {
  const { category, measures } = narrativeFields(visualJson, ctx, roles)
  if (!measures.length) return null
  const mf = measures.map((m) => fieldRef(ctx, m))
  const values = measures.map((m) => ({ id: valueId(m), expr: { kind: 'sq' as const, expr: m.expr } }))
  if (!category) {
    const r = ctx.engine.summarize({ groupBy: [], values, filters })
    const row = r.rows[0] ?? []
    return { series: mf.map((f, i) => seriesOf(ctx, f, [typeof row[i] === 'number' ? (row[i] as number) : null])) }
  }
  const cf = fieldRef(ctx, category)
  const ordered = isOrderedField(cf)
  const res = ctx.engine.summarize({
    groupBy: [{ kind: 'sq', expr: category.expr }],
    values,
    filters,
    orderBy: ordered ? [{ target: { group: 0 }, direction: 'asc' }] : [{ target: { value: values[0].id }, direction: 'desc' }],
    limit: MAX_CATEGORIES
  })
  const labels = res.rows.map((r) => formatCategoryValue(ctx, cf, r[0]))
  const cols = mf.map((_, i) => res.rows.map((r) => (typeof r[i + 1] === 'number' && Number.isFinite(r[i + 1] as number) ? (r[i + 1] as number) : null)))
  // measures with the same format string share one display unit, so a sentence comparing them reads consistently
  const maxByFormat = new Map<string, number>()
  mf.forEach((f, i) => maxByFormat.set(f.formatString ?? '', Math.max(maxByFormat.get(f.formatString ?? '') ?? 0, ...cols[i].map((x) => Math.abs(x ?? 0)))))
  return {
    category: { name: cf.label, labels, ordered },
    series: mf.map((f, i) => seriesOf(ctx, f, cols[i], maxByFormat.get(f.formatString ?? '')))
  }
}

function positionOf(v: VisualDocument): { x: number; y: number } {
  const p = v.json?.position ?? {}
  return { x: Number(p.x) || 0, y: Number(p.y) || 0 }
}

/** Datasets of the page's other visuals, in reading order (top-to-bottom, left-to-right). */
export function pageDatasets(sources: NarrSource[], ctx: VisualHostContext, selfName: string, only?: Set<string>): { datasets: NarrDataset[]; errors: string[] } {
  const errors: string[] = []
  const list = sources
    .filter((s) => s.visual.name !== selfName && (!only || only.has(s.visual.name)))
    .filter((s) => !s.visual.json?.isHidden && isSummarizable(s.visual.json?.visual?.visualType ?? ''))
    .sort((a, b) => {
      const pa = positionOf(a.visual)
      const pb = positionOf(b.visual)
      return Math.abs(pa.y - pb.y) > 40 ? pa.y - pb.y : pa.x - pb.x
    })
  const datasets: NarrDataset[] = []
  for (const s of list) {
    try {
      const def = getVisual(s.visual.json.visual.visualType)
      const ds = datasetFor(s.visual.json, ctx, s.filters ?? ctx.filters, def?.roles)
      if (ds) datasets.push(ds)
    } catch (e) {
      errors.push(`${s.visual.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { datasets, errors }
}
