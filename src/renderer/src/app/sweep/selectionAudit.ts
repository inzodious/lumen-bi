/**
 * Selection audit (sweep `--selections`): does a page stay populated under the selections its own slicers offer?
 *
 * For each slicer of a page that offers items (list / dropdown / tile / button and hierarchy slicers; range, relative
 * date and text slicers are skipped), a deterministic sample of its items is picked (all items when there are few,
 * otherwise first, middle, last and a few pseudo-random ones chosen by seed). Each item is applied on its own, on top
 * of the page's saved state (the slicer's saved selection is replaced, every other slicer keeps its own), and every
 * data-bound visual of the page is queried again with the engine probe (`probe.ts`). A visual that returned rows under
 * the saved state and returns none under the selection is counted as *emptied*.
 *
 * Engine level (the same query shape as the probe, no re-render): a few milliseconds per visual, so a page with a
 * dozen slicers is audited in seconds. Bounded per page by a selection cap and a time cap (`capped` is set when one
 * of them cut the audit short). Pure of React / DOM: also runs in Node tests.
 */
import type { QueryEngine } from '@core/engine/api'
import type { Scalar } from '@core/model/data'
import type { PageDocument, ReportDocument, VisualDocument } from '@core/report/types'
import type { SQExpr, SQFilter } from '@core/report/sq'
import { decodeLiteral } from '@core/report/literal'
import { fieldInfo } from '@core/report/sq'
import { hash32 } from '@core/data/synthetic-values'
import { computeVisualFilters } from '../../report/filters'
import { isEffectivelyHidden, isGroup, isSlicerType, savedSlicerFilter, visualTypeOf } from '../../report/pbir'
import { getProjections } from '../../visuals/common/query'
import { keyFieldFor, slicerProjections } from '../../visuals/slicers/slicerData'
import { hierarchyFilter, listFilter } from '../../visuals/slicers/filterModel'
import { probeVisual } from './probe'

export interface SelectionAuditOptions {
  /** seed of the pseudo-random item picks (default 1) */
  seed?: number
  /** items picked per slicer besides first / middle / last (default 3) */
  randomPicks?: number
  /** a slicer with at most this many items is audited on every item (default 8) */
  allItemsUpTo?: number
  /** at most this many selections per page (default 60) */
  maxSelections?: number
  /** time budget per page in ms (default 60 000): the audit stops after the selection that crosses it */
  maxMs?: number
}

export interface SelectionTrial {
  /** slicer visual name */
  slicer: string
  /** the selected item (display value; hierarchy paths joined with " › ") */
  item: string
  /** visuals (names) that had rows under the saved state and have none under this selection */
  emptied: string[]
}

export interface PageSelectionAudit {
  /** slicers whose items were audited */
  slicers: number
  /** selections applied */
  selections: number
  /** data-bound visuals that return rows under the saved state (the baseline) */
  withData: number
  /** (selection, visual) pairs: the visual had rows under the saved state, none under the selection */
  emptied: number
  /** selections that emptied at least one visual */
  emptiedSelections: number
  /** distinct visuals emptied by at least one selection */
  emptiedVisuals: string[]
  /** selections that emptied something (all of them, in audit order) */
  trials: SelectionTrial[]
  /** the selection or time cap cut the audit short */
  capped?: boolean
  ms: number
}

const RANGE_MODES = new Set(['between', 'before', 'after', 'single', 'relative', 'relativedate', 'relativetime', 'relativedatepicker'])

/** Slicer display mode from the visual's own `data.mode` (theme defaults are not consulted: they are list modes in practice). */
function slicerMode(json: any): string {
  const lit = json?.visual?.objects?.data?.[0]?.properties?.mode?.expr?.Literal?.Value
  const v = lit === undefined ? undefined : decodeLiteral(lit)
  return typeof v === 'string' ? v.toLowerCase() : 'basic'
}

/** Deterministic pick of item indices: every index when n ≤ allUpTo, else first, middle, last + `random` seeded picks. */
export function pickItems(n: number, key: string, seed: number, random = 3, allUpTo = 8): number[] {
  if (n <= 0) return []
  if (n <= allUpTo) return Array.from({ length: n }, (_, i) => i)
  const out = new Set<number>([0, Math.floor((n - 1) / 2), n - 1])
  let h = hash32(key, seed >>> 0)
  for (let tries = 0; out.size < 3 + random && tries < random * 8; tries++) {
    out.add(h % n)
    h = hash32(String(h), seed ^ 0x9e3779b9)
  }
  return [...out].sort((a, b) => a - b)
}

function itemText(v: Scalar): string {
  if (v === null || v === undefined || v === '') return '(Blank)'
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v)
}

interface Candidate {
  slicer: VisualDocument
  selections: Array<{ item: string; filter: SQFilter }>
}

/** Every item a single-field list slicer offers under a filter context, as single-item selections (in list order). */
function slicerItems(engine: QueryEngine, field: SQExpr, filters: SQFilter[]): Array<{ item: string; value: Scalar; filter: SQFilter }> {
  const values = engine.distinctValues({ column: { kind: 'sq', expr: field }, filters, limit: 5000 }).values
  const keyField = keyFieldFor(engine, field)
  let keyOf: ((v: Scalar) => Scalar) | undefined
  if (keyField) {
    const m = new Map<string, Scalar>()
    const r = engine.summarize({ groupBy: [{ kind: 'sq', expr: field }, { kind: 'sq', expr: keyField }], values: [], filters })
    for (const row of r.rows) m.set(itemText(row[0] as Scalar), row[1] as Scalar)
    keyOf = (v) => m.get(itemText(v)) ?? v
  }
  const out: Array<{ item: string; value: Scalar; filter: SQFilter }> = []
  for (const v of values) {
    const filter = listFilter(field, keyField ? { mode: 'include', values: [keyOf!(v)], keyField, labels: [v] } : { mode: 'include', values: [v] })
    if (filter) out.push({ item: itemText(v), value: v, filter })
  }
  return out
}

/** The one field of a single-field list slicer whose items can be enumerated (undefined: range / text / hierarchy slicer). */
function listSlicerField(engine: QueryEngine, slicer: VisualDocument): SQExpr | undefined {
  const type = visualTypeOf(slicer)
  if (type === 'textSlicer') return undefined
  const fields: SQExpr[] = slicerProjections(slicer.json).map((p) => p.expr)
  if (fields.length !== 1) return undefined
  let dataType: string | undefined
  try {
    dataType = engine.describeField(fields[0])?.dataType
  } catch {
    dataType = undefined
  }
  const rangeLike = dataType === 'int64' || dataType === 'double' || dataType === 'decimal' || dataType === 'dateTime'
  if (type === 'slicer' && rangeLike && RANGE_MODES.has(slicerMode(slicer.json))) return undefined
  return fields[0]
}

/** Items a slicer offers under its saved filter context, as single-item selections (undefined: not a list slicer). */
function slicerCandidates(engine: QueryEngine, report: ReportDocument, page: PageDocument, slicer: VisualDocument, base: Record<string, SQFilter | undefined>, o: Required<SelectionAuditOptions>): Candidate | undefined {
  const type = visualTypeOf(slicer)
  if (type === 'textSlicer') return undefined
  const fields: SQExpr[] = slicerProjections(slicer.json).map((p) => p.expr)
  if (!fields.length) return undefined
  const filters = computeVisualFilters({ report, page, visualName: slicer.name, slicerFilters: base, supportsHighlight: () => false }).filters
  const key = `${page.name}/${slicer.name}`
  if (fields.length > 1) {
    const r = engine.summarize({ groupBy: fields.map((expr) => ({ kind: 'sq' as const, expr })), values: [], filters, limit: 30000 })
    const picks = pickItems(r.rows.length, key, o.seed, o.randomPicks, o.allItemsUpTo)
    const selections = picks.map((i) => {
      const path = r.rows[i].slice(0, fields.length) as Scalar[]
      return { item: path.map(itemText).join(' › '), filter: hierarchyFilter(fields, { include: [path], exclude: [], inverted: false })! }
    })
    return { slicer, selections: selections.filter((s) => s.filter) }
  }
  const field = listSlicerField(engine, slicer)
  if (!field) return undefined
  const items = slicerItems(engine, field, filters)
  const picks = pickItems(items.length, key, o.seed, o.randomPicks, o.allItemsUpTo)
  return { slicer, selections: picks.map((i) => items[i]) }
}

// ---------------------------------------------------------------------------------------------
// Entity check: tables / matrices grouped by one sliced dimension keep a row for every member
// ---------------------------------------------------------------------------------------------

/** Visual types that list one row per member of their grouping columns. */
const ENTITY_TYPES = new Set(['tableEx', 'table', 'pivotTable', 'matrix'])

export interface EntityCheck {
  /** the entity-level visual (table / matrix) */
  visual: string
  /** the list slicer on the same dimension */
  slicer: string
  /** the dimension table both use */
  dimension: string
  /** members the slicer offers under the page's saved state (this slicer at "All"), minus members a filter stored in the report removes from the visual */
  offered: number
  /** offered members the visual lists under the saved state with this slicer at "All" */
  listed: number
  /** the same with every slicer of the page at "All" */
  offeredAll: number
  listedAll: number
  /** members selected alone (every member up to the cap, spread over the list beyond it) */
  singles: number
  /** single selections that leave the visual empty */
  emptying: number
  /** a few members missing from the visual or emptying it (display values, for triage) */
  examples: string[]
  /** the member cap or the time budget cut the single selections short */
  capped?: boolean
  /** a query the engine could not run (first message) */
  error?: string
}

export interface EntityCheckOptions {
  /** at most this many single selections per (visual, slicer) pair (default 500) */
  cap?: number
  /** time budget per page in ms (default 120 000) */
  maxMs?: number
}

/**
 * Entity-level visuals of a page: tables and matrices whose grouping columns all come from one table that a list
 * slicer of the page selects on. Returns each with the slicers on that table.
 */
export function entityVisuals(engine: QueryEngine, page: PageDocument): Array<{ visual: VisualDocument; dimension: string; groups: SQExpr[]; values: SQExpr[]; slicers: Array<{ slicer: VisualDocument; field: SQExpr }> }> {
  const slicers: Array<{ slicer: VisualDocument; field: SQExpr; table: string }> = []
  for (const v of page.visuals) {
    if (isGroup(v) || !isSlicerType(visualTypeOf(v)) || isEffectivelyHidden(page, v)) continue
    const field = listSlicerField(engine, v)
    const fi = field && fieldInfo(field)
    if (field && fi?.kind === 'column' && fi.table) slicers.push({ slicer: v, field, table: fi.table.toLowerCase() })
  }
  if (!slicers.length) return []
  const out: ReturnType<typeof entityVisuals> = []
  for (const v of page.visuals) {
    if (isGroup(v) || isEffectivelyHidden(page, v) || !ENTITY_TYPES.has(visualTypeOf(v))) continue
    const roles = getProjections(v.json)
    const groups: SQExpr[] = []
    const values: SQExpr[] = []
    const tables = new Set<string>()
    let ok = true
    for (const [role, ps] of Object.entries(roles)) {
      for (const p of ps) {
        if (p.isMeasure || (p.info.kind !== 'column' && p.info.kind !== 'hierarchyLevel')) {
          values.push(p.expr)
          continue
        }
        if (role === 'Tooltips') continue
        if (p.info.kind !== 'column' || !p.info.table || engine.resolveFieldParameter(p.expr, [])) {
          ok = false
          continue
        }
        tables.add(p.info.table.toLowerCase())
        groups.push(p.expr)
      }
    }
    if (!ok || tables.size !== 1 || !groups.length) continue
    const dim = [...tables][0]
    const on = slicers.filter((s) => s.table === dim)
    if (!on.length) continue
    out.push({ visual: v, dimension: fieldInfo(groups[0]).table!, groups, values, slicers: on.map(({ slicer, field }) => ({ slicer, field })) })
  }
  return out
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Evenly spread indices (first and last included) when n exceeds the cap. */
function spread(n: number, cap: number): number[] {
  if (n <= cap) return Array.from({ length: n }, (_, i) => i)
  const out = new Set<number>()
  for (let k = 0; k < cap; k++) out.add(Math.round((k * (n - 1)) / (cap - 1)))
  return [...out]
}

/**
 * Exhaustive entity check of one page: for each entity-level visual and each list slicer on its dimension, the members
 * the slicer offers versus the members the visual lists (under the saved state with that slicer at "All", and with every
 * slicer at "All"), then every member selected alone (up to the cap) — how many leave the visual empty.
 */
export function checkEntityVisuals(engine: QueryEngine, report: ReportDocument, page: PageDocument, opts: EntityCheckOptions = {}): EntityCheck[] {
  const cap = opts.cap ?? 500
  const maxMs = opts.maxMs ?? 120_000
  const t0 = performance.now()
  const base: Record<string, SQFilter | undefined> = {}
  for (const v of page.visuals) if (!isGroup(v) && isSlicerType(visualTypeOf(v))) base[v.name] = savedSlicerFilter(v.json)
  const none: Record<string, SQFilter | undefined> = {}
  const out: EntityCheck[] = []
  const filtersFor = (visualName: string, slicerFilters: Record<string, SQFilter | undefined>): SQFilter[] =>
    computeVisualFilters({ report, page, visualName, slicerFilters, supportsHighlight: () => false }).filters
  for (const ev of entityVisuals(engine, page)) {
    const valueSpecs = ev.values.map((expr, i) => ({ id: `v${i}`, expr: { kind: 'sq' as const, expr } }))
    /** members of `field` the visual lists under a slicer state (rows whose measures are all blank are dropped, as in Power BI) */
    const listed = (field: SQExpr, slicerFilters: Record<string, SQFilter | undefined>): Set<string> => {
      const r = engine.summarize({ groupBy: [{ kind: 'sq', expr: field }, ...ev.groups.map((expr) => ({ kind: 'sq' as const, expr }))], values: valueSpecs, filters: filtersFor(ev.visual.name, slicerFilters), limit: 100000 })
      return new Set(r.rows.map((row) => itemText(row[0] as Scalar)))
    }
    /** members a filter stored in the report leaves to the visual (its own filters, without measures) */
    const allowed = (field: SQExpr, slicerFilters: Record<string, SQFilter | undefined>): Set<string> =>
      new Set(engine.distinctValues({ column: { kind: 'sq', expr: field }, filters: filtersFor(ev.visual.name, slicerFilters), limit: 100000 }).values.map(itemText))
    for (const s of ev.slicers) {
      const check: EntityCheck = { visual: ev.visual.name, slicer: s.slicer.name, dimension: ev.dimension, offered: 0, listed: 0, offeredAll: 0, listedAll: 0, singles: 0, emptying: 0, examples: [] }
      out.push(check)
      const atAll = { ...base, [s.slicer.name]: undefined }
      let offered: Array<{ item: string; value: Scalar; filter: SQFilter }> = []
      try {
        const items = slicerItems(engine, s.field, filtersFor(s.slicer.name, atAll))
        const ok = allowed(s.field, atAll)
        offered = items.filter((it) => ok.has(it.item))
        const have = listed(s.field, atAll)
        check.offered = offered.length
        check.listed = offered.filter((it) => have.has(it.item)).length
        for (const it of offered) if (!have.has(it.item) && check.examples.length < 8) check.examples.push(it.item)
      } catch (e) {
        check.error = errText(e)
      }
      try {
        const itemsAll = slicerItems(engine, s.field, filtersFor(s.slicer.name, none))
        const okAll = allowed(s.field, none)
        const haveAll = listed(s.field, none)
        const offeredAll = itemsAll.filter((it) => okAll.has(it.item))
        check.offeredAll = offeredAll.length
        check.listedAll = offeredAll.filter((it) => haveAll.has(it.item)).length
      } catch (e) {
        check.error ??= errText(e)
      }
      for (const i of spread(offered.length, cap)) {
        if (performance.now() - t0 > maxMs) {
          check.capped = true
          break
        }
        const it = offered[i]
        check.singles++
        try {
          const r = engine.summarize({
            groupBy: ev.groups.map((expr) => ({ kind: 'sq' as const, expr })),
            values: valueSpecs,
            filters: filtersFor(ev.visual.name, { ...base, [s.slicer.name]: it.filter }),
            limit: 1
          })
          if (r.rows.length) continue
        } catch (e) {
          check.error ??= errText(e)
          continue
        }
        check.emptying++
        if (check.examples.length < 8 && !check.examples.includes(it.item)) check.examples.push(it.item)
      }
      if (offered.length > cap) check.capped = true
    }
  }
  return out
}

/** Run the selection audit on one page (see the module comment). */
export function auditPageSelections(engine: QueryEngine, report: ReportDocument, page: PageDocument, opts: SelectionAuditOptions = {}): PageSelectionAudit {
  const o: Required<SelectionAuditOptions> = {
    seed: opts.seed ?? 1,
    randomPicks: opts.randomPicks ?? 3,
    allItemsUpTo: opts.allItemsUpTo ?? 8,
    maxSelections: opts.maxSelections ?? 60,
    maxMs: opts.maxMs ?? 60_000
  }
  const t0 = performance.now()
  const out: PageSelectionAudit = { slicers: 0, selections: 0, withData: 0, emptied: 0, emptiedSelections: 0, emptiedVisuals: [], trials: [], ms: 0 }
  const base: Record<string, SQFilter | undefined> = {}
  const slicers: VisualDocument[] = []
  const targets: VisualDocument[] = []
  for (const v of page.visuals) {
    if (isGroup(v)) continue
    const type = visualTypeOf(v)
    if (isSlicerType(type)) {
      base[v.name] = savedSlicerFilter(v.json)
      if (!isEffectivelyHidden(page, v)) slicers.push(v)
    }
    if (!isEffectivelyHidden(page, v) && Object.keys(getProjections(v.json)).length) targets.push(v)
  }
  if (!slicers.length || !targets.length) {
    out.ms = Math.round(performance.now() - t0)
    return out
  }
  const hasRows = (v: VisualDocument, slicerFilters: Record<string, SQFilter | undefined>): boolean => {
    const p = probeVisual(engine, report, page, v, {
      limit: 1,
      totals: false,
      filtersFor: () => computeVisualFilters({ report, page, visualName: v.name, slicerFilters, supportsHighlight: () => false }).filters
    })
    return !p.error && (p.rows ?? 0) > 0
  }
  const baseline = targets.filter((v) => hasRows(v, base))
  out.withData = baseline.length
  const emptiedVisuals = new Set<string>()
  let stop = false
  for (const s of slicers) {
    if (stop) break
    let cand: Candidate | undefined
    try {
      cand = slicerCandidates(engine, report, page, s, base, o)
    } catch {
      cand = undefined
    }
    if (!cand?.selections.length) continue
    out.slicers++
    for (const sel of cand.selections) {
      if (out.selections >= o.maxSelections || performance.now() - t0 > o.maxMs) {
        out.capped = true
        stop = true
        break
      }
      out.selections++
      const filters = { ...base, [s.name]: sel.filter }
      const emptied = baseline.filter((v) => v !== s && !hasRows(v, filters)).map((v) => v.name)
      if (!emptied.length) continue
      out.emptied += emptied.length
      out.emptiedSelections++
      for (const n of emptied) emptiedVisuals.add(n)
      out.trials.push({ slicer: s.name, item: sel.item, emptied })
    }
  }
  out.emptiedVisuals = [...emptiedVisuals]
  out.ms = Math.round(performance.now() - t0)
  return out
}
