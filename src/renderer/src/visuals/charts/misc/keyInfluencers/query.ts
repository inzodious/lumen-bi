/**
 * Key influencers data: one engine.summarize grouped by every Explain-by column (plus the Analyze column for
 * categorical targets) gives the full contingency table, from which every per-field / per-pair statistic is
 * an exact sum (see stats.ts).
 *
 * Analysis grain:
 *  - Analyze = a column → rows of the column's table (COUNTROWS / SUM / SUMX(y²) per combination), like
 *    Power BI's row-level analysis. Expand by doesn't change counts at this grain and is ignored.
 *  - Analyze = a measure / aggregation → the measure evaluated per combination of Expand-by (if any) and
 *    Explain-by values; each combination is one sample (Power BI evaluates measures at the Expand-by /
 *    Explain-by grain as well, then regresses — Lumen compares segment means).
 * Measures in Explain by are not analyzed (listed in `notes`).
 */
import type { Scalar } from '@core/model/data'
import type { DataType } from '@core/model/types'
import type { ValueExpr } from '@core/engine/api'
import type { VisualHostContext } from '../../../contract'
import { expandParameters, getProjections } from '../../../common/query'
import { fieldRef, formatCategoryValue, type FieldRef } from '../../../common/categorical'
import { formatScalar } from '../../../common/units'
import {
  addMoments,
  defaultMinSupport,
  mean,
  rankInfluencers,
  segmentField,
  topSegments,
  ZERO,
  type Direction,
  type FieldSegments,
  type Influencer,
  type Moments,
  type Sample,
  type TargetKind,
  type TopSegment
} from './stats'

export const MAX_COMBINATIONS = 200_000

const NUMERIC: DataType[] = ['int64', 'double', 'decimal']

export interface KiOptions {
  /** keyDrivers.targetValue (categorical target), compared with targetKey() */
  targetValue?: string
  direction: Direction
  /** keyDrivers.selectedNumericAnalysis: treat a numeric Analyze column as categorical */
  numericAsCategorical: boolean
  sort: 'impact' | 'count'
}

export interface KiData {
  analyze: FieldRef
  kind: TargetKind
  grain: 'row' | 'measure'
  explain: FieldRef[]
  /** categorical: the Analyze column's values (dropdown) and the selected one */
  targetValues: Scalar[]
  target: Scalar
  targetLabel: string
  samples: Sample[]
  total: Moments
  overall: number
  fields: FieldSegments[]
  influencers: Influencer[]
  segments: TopSegment[]
  minSupport: number
  notes: string[]
}

/** String form used for keyDrivers.targetValue. */
export function targetKey(v: Scalar): string {
  if (v instanceof Date) return v.toISOString()
  return v === null ? '' : String(v)
}

function daxTable(t: string): string {
  return `'${t.replace(/'/g, "''")}'`
}

function daxCol(t: string, c: string): string {
  return `${daxTable(t)}[${c.replace(/]/g, ']]')}]`
}

export function computeKeyInfluencers(visualJson: any, ctx: VisualHostContext, opts: KiOptions): KiData | null {
  const roles = getProjections(visualJson)
  const ap = expandParameters(roles.Analyze ?? [], ctx)[0]
  if (!ap) return null
  const analyze = fieldRef(ctx, ap)
  const notes: string[] = []
  const explain: FieldRef[] = []
  const seen = new Set<string>()
  for (const p of expandParameters(roles.ExplainBy ?? [], ctx)) {
    const f = fieldRef(ctx, p)
    if (p.isMeasure) {
      notes.push(`${f.label} (measure) isn't analyzed: Lumen explains by columns only.`)
      continue
    }
    const k = JSON.stringify(f.identityExpr)
    if (seen.has(k) || k === JSON.stringify(analyze.identityExpr)) continue
    seen.add(k)
    explain.push(f)
  }
  const expandBy = expandParameters(roles.ExpandBy ?? [], ctx)
    .filter((p) => !p.isMeasure)
    .map((p) => fieldRef(ctx, p))

  const dataType = analyze.desc?.dataType
  const isMeasure = ap.isMeasure
  const kind: TargetKind = isMeasure || (dataType && NUMERIC.includes(dataType) && !opts.numericAsCategorical) ? 'continuous' : 'categorical'
  const grain: 'row' | 'measure' = isMeasure ? 'measure' : 'row'
  const empty = (): KiData => ({ analyze, kind, grain, explain, targetValues: [], target: null, targetLabel: '', samples: [], total: ZERO, overall: NaN, fields: [], influencers: [], segments: [], minSupport: 0, notes })
  if (!explain.length) return empty()

  const groupBy = explain.map((f) => ({ kind: 'sq' as const, expr: f.proj.expr }))
  const values: Array<{ id: string; expr: ValueExpr }> = []
  let targetValues: Scalar[] = []
  let target: Scalar = null
  const tbl = analyze.desc?.column?.table ?? analyze.desc?.table ?? ap.info.table
  const colName = analyze.desc?.column?.column ?? analyze.desc?.name ?? ap.info.property
  if (grain === 'measure') {
    groupBy.push(...expandBy.map((f) => ({ kind: 'sq' as const, expr: f.proj.expr })))
    values.push({ id: 'y', expr: { kind: 'sq', expr: ap.expr } })
  } else {
    if (!tbl || !colName) throw new Error(`Can't resolve the Analyze field ${analyze.label}.`)
    if (kind === 'categorical') {
      groupBy.push({ kind: 'sq', expr: analyze.proj.expr })
      values.push({ id: 'n', expr: { kind: 'dax', expression: `COUNTROWS(${daxTable(tbl)})` } })
      targetValues = ctx.engine.distinctValues({ column: { kind: 'sq', expr: analyze.proj.expr }, filters: ctx.filters, limit: 1000 }).values
      target = targetValues.find((v) => opts.targetValue !== undefined && targetKey(v) === opts.targetValue) ?? targetValues.find((v) => v !== null) ?? null
    } else {
      const c = daxCol(tbl, colName)
      values.push({ id: 'n', expr: { kind: 'dax', expression: `COUNT(${c})` } })
      values.push({ id: 's', expr: { kind: 'dax', expression: `SUM(${c})` } })
      values.push({ id: 'ss', expr: { kind: 'dax', expression: `SUMX(${daxTable(tbl)}, ${c} * ${c})` } })
    }
  }
  const res = ctx.engine.summarize({ groupBy, values, filters: ctx.filters, limit: MAX_COMBINATIONS })
  if (res.truncated || res.rows.length >= MAX_COMBINATIONS) notes.push(`Only the first ${MAX_COMBINATIONS.toLocaleString('en-US')} value combinations were analyzed.`)
  for (const w of res.warnings ?? []) notes.push(w)

  const nx = explain.length
  const byAttrs = new Map<string, Sample>()
  const keyOfAttrs = (a: Scalar[]) => a.map((v) => (v instanceof Date ? 'd' + v.getTime() : typeof v + ':' + String(v))).join('\u0001')
  const add = (attrs: Scalar[], m: Moments) => {
    if (m.n <= 0) return
    const k = keyOfAttrs(attrs)
    const cur = byAttrs.get(k)
    if (cur) Object.assign(cur, addMoments(cur, m))
    else byAttrs.set(k, { attrs, ...m })
  }
  const tKey = targetKey(target)
  for (const r of res.rows) {
    const attrs = r.slice(0, nx)
    if (grain === 'measure') {
      const y = r[groupBy.length]
      if (typeof y !== 'number' || !Number.isFinite(y)) continue
      add(attrs, { n: 1, s: y, ss: y * y })
    } else if (kind === 'categorical') {
      const t = r[nx]
      const n = Number(r[nx + 1] ?? 0)
      if (!(n > 0)) continue
      const hit = t !== null && targetKey(t) === tKey ? n : 0
      add(attrs, { n, s: hit, ss: hit })
    } else {
      const n = Number(r[nx] ?? 0)
      if (!(n > 0)) continue
      add(attrs, { n, s: Number(r[nx + 1] ?? 0), ss: Number(r[nx + 2] ?? 0) })
    }
  }
  const samples = [...byAttrs.values()]
  const total = samples.reduce<Moments>((a, s) => addMoments(a, s), ZERO)
  const fields = explain.map((f, i) =>
    segmentField(samples, i, {
      numeric: !!f.desc && NUMERIC.includes(f.desc.dataType),
      label: (v) => (typeof v === 'number' ? formatScalar(v, f.formatString, ctx.format, f.desc?.dataType) : formatCategoryValue(ctx, f, v))
    })
  )
  const minSupport = defaultMinSupport(total.n, grain === 'measure')
  const rank = { kind, direction: opts.direction, minSupport, sort: opts.sort }
  const influencers = rankInfluencers(fields, total, rank)
  const segments = topSegments(samples, fields, total, { ...rank, minSupport: Math.max(minSupport, Math.ceil(total.n * 0.02)) })
  return {
    analyze,
    kind,
    grain,
    explain,
    targetValues,
    target,
    targetLabel: target === null ? '(Blank)' : formatCategoryValue(ctx, analyze, target),
    samples,
    total,
    overall: mean(total),
    fields,
    influencers,
    segments,
    minSupport,
    notes
  }
}

/** "Show as table" / export data: the influencer list. */
export function influencersTable(d: KiData): { columns: string[]; rows: Scalar[][] } {
  return {
    columns: ['Field', 'Value', d.kind === 'categorical' ? 'Lift' : 'Mean difference', 'Rows'],
    rows: d.influencers.map((i) => [d.explain[i.field].label, i.segment.label, Number.isFinite(i.impact) ? i.impact : null, i.segment.m.n])
  }
}
