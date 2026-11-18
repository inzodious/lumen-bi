/**
 * Filter computation for the report canvas (pure — unit-tested in filters.test.ts).
 *
 * For a target visual, the effective filter context is:
 *   report filters (report.json filterConfig)
 * + page filters (page.json filterConfig; drill-through cards replaced by the active drill-through)
 * + the visual's own filters (visual.json filterConfig; incl. visual-level Include/Exclude)
 * + slicers on the same page (except the visual itself), subject to page `visualInteractions`
 * + cross-filter selection from another visual on the page (Filter → filters, Highlight → highlightFilters)
 * + "drilling filters other visuals": drill paths of other visuals (as filters)
 * + drill-through filters when the page was reached through drill-through
 * + this visual's own drill path (each drilled identity adds a filter)
 * + extra filters (report-page tooltips: hovered data point + source visual context)
 *
 * Every SQ filter is normalized (alias `Source` refs rewritten to `Entity`), keeping TopN
 * subquery `From` entries which the Where clause still references by name.
 */
import type { PageDocument, ReportDocument } from '@core/report/types'
import { aliasesOf, fieldKey, identitiesToFilter, normalizeExpr, type DataPointIdentity, type SQFilter } from '@core/report/sq'
import { filterCards, findVisual, isSlicerType, visualTypeOf, type FilterCard } from './pbir'

// ---------------------------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------------------------

function normalizeQuery(query: any): any {
  if (!query || typeof query !== 'object') return query
  const aliases = aliasesOf(query)
  const out: any = { ...query }
  out.From = (query.From ?? []).map((f: any) => (f.Expression ? { ...f, Expression: normalizeSubqueryExpr(f.Expression) } : f))
  for (const k of ['Select', 'Where', 'OrderBy', 'GroupBy']) if (query[k]) out[k] = normalizeExpr(query[k], aliases)
  return out
}

function normalizeSubqueryExpr(expr: any): any {
  if (expr?.Subquery?.Query) return { ...expr, Subquery: { ...expr.Subquery, Query: normalizeQuery(expr.Subquery.Query) } }
  return expr
}

/**
 * Like `normalizeFilter` from sq.ts (all SourceRefs → Entity) but keeps `From` entries that carry an
 * `Expression` (TopN subqueries) — the Where clause references them by name (`{ SourceRef: { Source: 'subquery' } }`).
 */
export function normalizeReportFilter(filter: SQFilter): SQFilter {
  const aliases = aliasesOf(filter)
  const out: SQFilter = { Version: filter.Version ?? 2, Where: (filter.Where ?? []).map((w) => normalizeExpr(w, aliases)) }
  const sub = (filter.From ?? []).filter((f) => f.Expression)
  if (sub.length) out.From = sub.map((f) => ({ ...f, Expression: normalizeSubqueryExpr(f.Expression) }))
  return out
}

function hasConditions(f: SQFilter | undefined): f is SQFilter {
  return !!f && Array.isArray(f.Where) && f.Where.length > 0
}

/**
 * Convert one filter card into the SQ filters it contributes. Cards without a `filter` (no selection,
 * "Passthrough", inverted-selection mode with nothing excluded) contribute nothing.
 *
 * Types: Categorical, Advanced, TopN (subquery kept), RelativeDate / RelativeTime (Now/DateSpan/DateAdd
 * expressions — the engine evaluates them), Include / Exclude (visual-level data-point include/exclude),
 * Tuple (multi-column In), Passthrough (no condition of its own unless a filter is present).
 */
export function cardFilters(card: FilterCard): SQFilter[] {
  if (!hasConditions(card.filter)) return []
  return [normalizeReportFilter(card.filter)]
}

export function cardsFilters(cards: FilterCard[]): SQFilter[] {
  const out: SQFilter[] = []
  for (const c of cards) out.push(...cardFilters(c))
  return out
}

// ---------------------------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------------------------

export type InteractionKind = 'filter' | 'highlight' | 'none'

/**
 * Effective interaction from `source` to `target` on a page.
 * PBIR page.json `visualInteractions: [{ source, target, type }]`, type ∈ Default | DataFilter | HighlightFilter | NoFilter.
 * Default = cross-highlight when the target supports it (and the source isn't a slicer and the report setting
 * "cross-filter by default" is off), otherwise cross-filter.
 */
export function interactionKind(
  page: PageDocument,
  source: string,
  target: string,
  opts: { sourceIsSlicer: boolean; targetSupportsHighlight: boolean; defaultIsFilter: boolean }
): InteractionKind {
  const rules: any[] = page.json?.visualInteractions ?? []
  const rule = rules.find((r) => r?.source === source && r?.target === target)
  const t = rule?.type
  if (t === 'NoFilter' || t === 0) return 'none'
  if (t === 'DataFilter' || t === 1) return 'filter'
  if (t === 'HighlightFilter' || t === 2) return opts.targetSupportsHighlight && !opts.sourceIsSlicer ? 'highlight' : 'filter'
  if (opts.sourceIsSlicer) return 'filter'
  return opts.targetSupportsHighlight && !opts.defaultIsFilter ? 'highlight' : 'filter'
}

// ---------------------------------------------------------------------------------------------
// Effective filter context
// ---------------------------------------------------------------------------------------------

export interface CrossFilterSelection {
  source: string
  identities: DataPointIdentity[]
}

export interface DrillthroughContext {
  /** filters carried into the target page */
  filters: SQFilter[]
  /** fieldKeys of the drill-through fields replaced by `filters` (the page's saved drillthrough card values are ignored) */
  fieldKeys: string[]
}

export interface FilterInputs {
  report: ReportDocument
  page: PageDocument
  visualName: string
  /** current slicer filter per visual on this page (runtime overlay already merged with the saved filter) */
  slicerFilters: Record<string, SQFilter | undefined>
  crossFilter?: CrossFilterSelection | null
  /** drill path of this visual (drill-down filters) */
  drillPath?: DataPointIdentity[]
  /** drill paths of other visuals that "filter other visuals" (keyed by visual name) */
  otherDrillPaths?: Record<string, DataPointIdentity[]>
  drillthrough?: DrillthroughContext | null
  extraFilters?: SQFilter[]
  /** capability lookups (from the visual registry) */
  supportsHighlight(visualType: string): boolean
  isSlicer?(visualType: string): boolean
}

export interface EffectiveFilters {
  filters: SQFilter[]
  highlightFilters: SQFilter[]
}

/** Filters that apply to every visual of the page (report + page level, drill-through aware). */
export function pageScopeFilters(report: ReportDocument, page: PageDocument, drillthrough?: DrillthroughContext | null): SQFilter[] {
  const out = cardsFilters(filterCards(report.report))
  const replaced = new Set(drillthrough?.fieldKeys ?? [])
  for (const c of filterCards(page.json)) {
    if (replaced.size && c.field && replaced.has(fieldKey(c.field))) continue
    out.push(...cardFilters(c))
  }
  if (drillthrough) out.push(...drillthrough.filters.map(normalizeReportFilter))
  return out
}

export function drillPathFilters(path: DataPointIdentity[] | undefined): SQFilter[] {
  const out: SQFilter[] = []
  for (const id of path ?? []) {
    const f = identitiesToFilter([id])
    if (f) out.push(f)
  }
  return out
}

/** Slicer styles that show a range of a single date / numeric column (format pane "Slicer settings ▸ Style"). */
const RANGE_SLICER_MODES = new Set(['between', 'before', 'after', 'single', 'relative', 'relativetime', 'relativedatepicker'])

/** Field keys of a range-style slicer (undefined when the slicer is a list / dropdown / tile slicer). */
export function rangeSlicerFieldKeys(visualJson: any): Set<string> | undefined {
  const raw = visualJson?.visual?.objects?.data?.find((e: any) => e?.properties?.mode)?.properties?.mode?.expr?.Literal?.Value
  const mode = typeof raw === 'string' ? raw.replace(/^'|'$/g, '').toLowerCase() : ''
  if (!RANGE_SLICER_MODES.has(mode)) return undefined
  const keys = new Set<string>()
  for (const p of visualJson?.visual?.query?.queryState?.Values?.projections ?? []) if (p?.field) keys.add(fieldKey(p.field))
  return keys.size ? keys : undefined
}

/** Column / level references of a filter's conditions (alias-resolved field keys). */
export function filterFieldKeys(f: SQFilter): Set<string> {
  const aliases = aliasesOf(f as any)
  const out = new Set<string>()
  const walk = (n: any): void => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (n.Column || n.HierarchyLevel) {
      out.add(fieldKey(n, aliases))
      return
    }
    for (const v of Object.values(n)) walk(v)
  }
  walk((f as any).Where)
  return out
}

/** True when every condition of `f` is on one of `keys` (and there is at least one). */
function onlyConstrains(f: SQFilter, keys: Set<string>): boolean {
  const used = filterFieldKeys(f)
  return used.size > 0 && [...used].every((k) => keys.has(k))
}

export function computeVisualFilters(inp: FilterInputs): EffectiveFilters {
  const { report, page, visualName } = inp
  const isSlicer = inp.isSlicer ?? isSlicerType
  const target = findVisual(page, visualName)
  const targetType = visualTypeOf(target)
  const targetHighlights = inp.supportsHighlight(targetType)
  const defaultIsFilter = report.report?.settings?.defaultFilterActionIsDataFilter === true

  const filters: SQFilter[] = pageScopeFilters(report, page, inp.drillthrough)
  const highlightFilters: SQFilter[] = []

  if (target) filters.push(...cardsFilters(filterCards(target.json)))

  // slicers on the page
  const rangeFields = target && isSlicer(targetType) ? rangeSlicerFieldKeys(target.json) : undefined
  for (const [slicerName, f] of Object.entries(inp.slicerFilters)) {
    if (slicerName === visualName || !hasConditions(f)) continue
    const src = findVisual(page, slicerName)
    if (!src) continue
    // PBI: range (date / numeric) slicers on the same column keep their own bounds — another slicer filtering only
    // that column doesn't narrow their available range (e.g. two date pickers on Date[Date])
    if (rangeFields && isSlicer(visualTypeOf(src)) && onlyConstrains(f!, rangeFields)) continue
    const kind = interactionKind(page, slicerName, visualName, { sourceIsSlicer: true, targetSupportsHighlight: targetHighlights, defaultIsFilter })
    if (kind === 'none') continue
    filters.push(normalizeReportFilter(f))
  }

  // cross-filter / cross-highlight selection
  const cf = inp.crossFilter
  if (cf && cf.source !== visualName && cf.identities.length) {
    const src = findVisual(page, cf.source)
    if (src) {
      const kind = interactionKind(page, cf.source, visualName, {
        sourceIsSlicer: isSlicer(visualTypeOf(src)),
        targetSupportsHighlight: targetHighlights,
        defaultIsFilter
      })
      const f = identitiesToFilter(cf.identities)
      if (f && kind === 'filter') filters.push(f)
      else if (f && kind === 'highlight') highlightFilters.push(f)
    }
  }

  // drill paths of other visuals ("drilling filters other visuals")
  for (const [src, path] of Object.entries(inp.otherDrillPaths ?? {})) {
    if (src === visualName || !path?.length) continue
    if (!findVisual(page, src)) continue
    const kind = interactionKind(page, src, visualName, { sourceIsSlicer: false, targetSupportsHighlight: false, defaultIsFilter: true })
    if (kind === 'none') continue
    filters.push(...drillPathFilters(path))
  }

  filters.push(...drillPathFilters(inp.drillPath))
  if (inp.extraFilters) filters.push(...inp.extraFilters.map(normalizeReportFilter))
  return { filters, highlightFilters }
}

/** Stable key for memoization (filters are plain JSON). */
export function filtersKey(filters: SQFilter[] | undefined): string {
  return filters?.length ? JSON.stringify(filters) : ''
}

// ---------------------------------------------------------------------------------------------
// Drill-through
// ---------------------------------------------------------------------------------------------

/** Fields comparable across visuals: hierarchy levels compare by level name within the same table. */
function looseKey(expr: any): string {
  const k = fieldKey(expr)
  return k
}

/**
 * Build the drill-through context for a target page from a data point of a source visual.
 *  - identity fields matching drill-through fields replace the page's drill-through card values;
 *  - with "Keep all filters" (default) the source visual's whole filter context is carried as well.
 * Returns null when no identity field matches a drill-through field (drill-through not available).
 */
export function buildDrillthrough(
  targetDrillFields: Array<{ key: string }>,
  identity: DataPointIdentity,
  sourceFilters: SQFilter[],
  keepAllFilters: boolean
): DrillthroughContext | null {
  const keys = new Set(targetDrillFields.map((f) => f.key))
  const matching = identity.fields.filter((f) => keys.has(looseKey(f.expr)))
  if (!matching.length) return null
  const filters: SQFilter[] = []
  if (keepAllFilters) {
    filters.push(...sourceFilters)
    for (const f of identity.fields) {
      const one = identitiesToFilter([{ fields: [f] }])
      if (one) filters.push(one)
    }
  } else {
    for (const f of matching) {
      const one = identitiesToFilter([{ fields: [f] }])
      if (one) filters.push(one)
    }
  }
  return { filters, fieldKeys: matching.map((f) => looseKey(f.expr)) }
}

/** Can `identity` drill through to a page with these drill-through fields? */
export function canDrillthrough(targetDrillFields: Array<{ key: string }>, identity: DataPointIdentity | undefined, visualFieldKeys: string[] = []): boolean {
  if (!targetDrillFields.length) return false
  const keys = new Set(targetDrillFields.map((f) => f.key))
  if (identity?.fields.some((f) => keys.has(looseKey(f.expr)))) return true
  return visualFieldKeys.some((k) => keys.has(k)) && !!identity
}

/** Visual-level include / exclude filter card for "Include" / "Exclude" in the context menu. */
export function includeExcludeCard(name: string, identities: DataPointIdentity[], mode: 'Include' | 'Exclude'): FilterCard | undefined {
  const f = identitiesToFilter(identities)
  if (!f) return undefined
  const cond = f.Where[0].Condition
  return {
    name,
    type: mode,
    howCreated: mode,
    filter: { Version: 2, Where: [{ Condition: mode === 'Exclude' ? { Not: { Expression: cond } } : cond }] }
  }
}
