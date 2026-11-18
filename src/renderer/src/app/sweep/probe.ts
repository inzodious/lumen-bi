/**
 * Engine-level visual probe (pure TS — no React / DOM, so the vitest regression can run it in Node).
 *
 * For every visual of every page it builds a simplified query from the visual's field wells and runs it
 * against the engine under the visual's saved filter context (report + page + visual filters + saved
 * slicer selections on the page, via the canvas' own `computeVisualFilters`). This does not reproduce
 * each visual's exact query shape (drill levels, data reduction, small multiples, visual calculations...):
 * it checks that every field resolves and every measure evaluates without engine errors, records engine
 * warnings and query time, and computes grand-total values (no group-by) — what a card / KPI shows.
 */
import type { QueryEngine, SummarizeRequest } from '@core/engine/api'
import type { Scalar } from '@core/model/data'
import type { PageDocument, ReportDocument, VisualDocument } from '@core/report/types'
import { fieldInfo, type SQExpr, type SQFilter } from '@core/report/sq'
import { decodeLiteral } from '@core/report/literal'
import { computeVisualFilters } from '../../report/filters'
import { isEffectivelyHidden, isGroup, isSlicerType, orderedPages, pageInfo, savedSlicerFilter, visualTypeOf } from '../../report/pbir'
import { getProjections, type Projection } from '../../visuals/common/query'

/** Visual types that show grand totals (no grouping) as their main value. */
export const CARD_TYPES = new Set(['card', 'cardVisual', 'multiRowCard', 'kpi', 'gauge'])

/** Roles that never become group-by columns in the probe (tooltips are evaluated per data point). */
const IGNORED_GROUP_ROLES = new Set(['Tooltips', 'SmallMultiple'])

export interface ProbeValue {
  /** queryRef of the measure / aggregation */
  field: string
  /** `Table.Property` of the measure / aggregated column (queryRefs of legacy reports are opaque, e.g. `select1`) */
  ref: string
  value: Scalar
  formatted: string
}

export interface VisualProbe {
  page: string
  pageDisplayName: string
  visual: string
  visualType: string
  title?: string
  hidden: boolean
  /** group-by fields (queryRefs) */
  groups: string[]
  /** value fields (queryRefs) */
  values: string[]
  rows?: number
  ms?: number
  warnings?: string[]
  error?: string
  /** grand totals (no group-by) for card-like visuals and as "total" for tables/charts */
  totals?: ProbeValue[]
}

export interface ProbeOptions {
  /** only these pages (name or display name) */
  pages?: string[]
  /** row cap for the grouped query (default 2000) */
  limit?: number
  /** supply filters from the live canvas instead of the saved state (app sweep) */
  filtersFor?(page: PageDocument, visual: VisualDocument): SQFilter[] | undefined
  /** progress hook (called before each visual is probed) */
  onVisual?(page: PageDocument, visual: VisualDocument): void
}

/** Static title text from visualContainerObjects.title (literal only; data-bound titles are skipped). */
export function staticTitle(visualJson: any): string | undefined {
  const e = visualJson?.visual?.visualContainerObjects?.title?.[0]?.properties?.text?.expr
  const lit = e?.Literal?.Value
  if (lit === undefined) return undefined
  const v = decodeLiteral(lit)
  return v === null ? undefined : String(v)
}

/** Saved filter context of a visual (no runtime selections). */
export function savedFilters(report: ReportDocument, page: PageDocument, visual: VisualDocument): SQFilter[] {
  const slicerFilters: Record<string, SQFilter | undefined> = {}
  for (const v of page.visuals) if (isSlicerType(visualTypeOf(v))) slicerFilters[v.name] = savedSlicerFilter(v.json)
  return computeVisualFilters({ report, page, visualName: visual.name, slicerFilters, supportsHighlight: () => false }).filters
}

function expandParams(engine: QueryEngine, ps: Projection[], filters: SQFilter[]): Array<{ expr: SQExpr; queryRef: string; isMeasure: boolean }> {
  const out: Array<{ expr: SQExpr; queryRef: string; isMeasure: boolean }> = []
  for (const p of ps) {
    const expanded = p.info.kind === 'column' ? engine.resolveFieldParameter(p.expr, filters) : null
    if (!expanded) {
      // anything that isn't a plain column / hierarchy level (Arithmetic, visual calculations…) is a value
      out.push({ expr: p.expr, queryRef: p.queryRef, isMeasure: p.isMeasure || (p.info.kind !== 'column' && p.info.kind !== 'hierarchyLevel') })
      continue
    }
    for (const f of expanded) {
      const d = engine.describeField(f.expr)
      out.push({ expr: f.expr, queryRef: f.displayName, isMeasure: !!d?.isMeasure || (f.expr as any)?.Aggregation !== undefined })
    }
  }
  return out
}

/** Visual types that show every grouping field at once (no drill level). */
const FLAT_TYPES = new Set(['tableEx', 'pivotTable', 'table', 'matrix', 'multiRowCard'])

/**
 * Charts with several grouping fields in one role (a hierarchy or stacked columns) show one level at a
 * time: the projection marked `active` (the saved drill level), else the first. Measures are kept.
 */
function drillLevelOf(visualType: string, ps: Projection[]): Projection[] {
  if (FLAT_TYPES.has(visualType)) return ps
  const cols = ps.filter((p) => !p.isMeasure)
  if (cols.length <= 1) return ps
  const level = cols.find((p) => p.active) ?? cols[0]
  return ps.filter((p) => p.isMeasure || p === level)
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Probe one visual. */
export function probeVisual(engine: QueryEngine, report: ReportDocument, page: PageDocument, visual: VisualDocument, opts: ProbeOptions = {}): VisualProbe {
  const info = pageInfo(page)
  const visualType = visualTypeOf(visual)
  const probe: VisualProbe = {
    page: page.name,
    pageDisplayName: info.displayName,
    visual: visual.name,
    visualType,
    title: staticTitle(visual.json),
    hidden: isEffectivelyHidden(page, visual),
    groups: [],
    values: []
  }
  const roles = getProjections(visual.json)
  if (!Object.keys(roles).length) return probe
  let filters: SQFilter[]
  try {
    filters = opts.filtersFor?.(page, visual) ?? savedFilters(report, page, visual)
  } catch (e) {
    probe.error = `filters: ${errMessage(e)}`
    return probe
  }
  const t0 = performance.now()
  try {
    const groups: Array<{ expr: SQExpr; queryRef: string }> = []
    const values: Array<{ expr: SQExpr; queryRef: string }> = []
    for (const [role, all] of Object.entries(roles)) {
      for (const p of expandParams(engine, drillLevelOf(visualType, all), filters)) {
        if (p.isMeasure) values.push(p)
        else if (!IGNORED_GROUP_ROLES.has(role) && !groups.some((g) => g.queryRef === p.queryRef)) groups.push(p)
      }
    }
    probe.groups = groups.map((g) => g.queryRef)
    probe.values = values.map((v) => v.queryRef)
    const warnings: string[] = []
    if (isSlicerType(visualType) && groups.length) {
      const r = engine.distinctValues({ column: { kind: 'sq', expr: groups[0].expr }, filters, limit: opts.limit ?? 2000 })
      probe.rows = r.values.length
    } else if (groups.length || values.length) {
      const req: SummarizeRequest = {
        groupBy: groups.map((g) => ({ kind: 'sq', expr: g.expr })),
        values: values.map((v, i) => ({ id: `v${i}`, expr: { kind: 'sq', expr: v.expr } })),
        filters,
        limit: opts.limit ?? 2000
      }
      const r = engine.summarize(req)
      probe.rows = r.rows.length
      if (r.warnings?.length) warnings.push(...r.warnings)
    }
    if (values.length) {
      const r = engine.summarize({ groupBy: [], values: values.map((v, i) => ({ id: `v${i}`, expr: { kind: 'sq', expr: v.expr } })), filters, keepBlankRows: true })
      if (r.warnings?.length) warnings.push(...r.warnings)
      const row = r.rows[0] ?? []
      probe.totals = values.map((v, i) => {
        const col = r.columns[i]
        const value = (row[i] ?? null) as Scalar
        const fmt = r.formats?.[0]?.[i] ?? col?.formatString
        const fi = fieldInfo(v.expr)
        return { field: v.queryRef, ref: `${fi.table ?? ''}.${fi.property ?? ''}`, value, formatted: value === null ? '(Blank)' : engine.format(value, fmt, col?.dataType) }
      })
    }
    if (warnings.length) probe.warnings = [...new Set(warnings)]
  } catch (e) {
    probe.error = errMessage(e)
  }
  probe.ms = Math.round((performance.now() - t0) * 10) / 10
  return probe
}

/** Probe every data-bound visual of every page (hidden / tooltip / drillthrough pages included). */
export function probeReport(engine: QueryEngine, report: ReportDocument, opts: ProbeOptions = {}): VisualProbe[] {
  const out: VisualProbe[] = []
  const want = opts.pages ? new Set(opts.pages.map((p) => p.toLowerCase())) : null
  for (const page of orderedPages(report)) {
    if (want && !want.has(page.name.toLowerCase()) && !want.has(String(page.json?.displayName ?? '').toLowerCase())) continue
    for (const v of page.visuals) {
      if (isGroup(v)) continue
      opts.onVisual?.(page, v)
      out.push(probeVisual(engine, report, page, v, opts))
    }
  }
  return out
}
