/**
 * VisualHostContext construction (one per visual container). The returned object is memoized so a visual
 * only re-renders when something it depends on changes (engine, theme, filters, its selection, drill,
 * slicer state, mode). Callbacks read live state from the stores, so they never go stale.
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import { useApp } from '../state/store'
import { EMPTY_DRILL, drillStateKey, useInteraction } from '../state/interaction'
import type { QueryEngine, ValueFormatter } from '@core/engine/api'
import type { DataPointIdentity, SQFilter } from '@core/report/sq'
import type { ReportDocument } from '@core/report/types'
import type { DrillState, PageVisualInfo, ReportInfo, VisualActions, VisualHostContext } from '../visuals/contract'
import { cachedEngine } from './cachedEngine'
import { meteredEngine, meters, newMeter } from './perf'
import { useShell } from '../app/shellState'
import { resolveImageUrl } from './images'
import { bookmarkList, drillthroughFields, findPage, findVisual, orderedPages, pageInfo, savedSlicerFilter } from './pbir'
import {
  applyBookmark,
  clearAllSlicers,
  drillthrough,
  goBack,
  navigatePage,
  openUrl,
  selectDataPoints,
  setDrill,
  setSlicerFilter
} from './runtime'

const EMPTY_SEL: DataPointIdentity[] = []

/** Fallback formatter when no engine is available (should not normally be used). */
export const fallbackFormat: ValueFormatter = (v) => {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return String(v)
}

/** Drillable hierarchy roles: rows (charts' Category / matrix Rows) and matrix Columns. */
const ROW_ROLES = ['Category', 'Rows', 'Axis', 'Group']

function activeIndexes(visualJson: any, role: string): number[] {
  const ps: any[] = visualJson?.visual?.query?.queryState?.[role]?.projections ?? []
  return ps.length > 1 ? ps.map((p, i) => (p?.active ? i : -1)).filter((i) => i >= 0) : []
}

function activeSignature(visualJson: any): string {
  return JSON.stringify([...ROW_ROLES, 'Columns'].map((r) => activeIndexes(visualJson, r)))
}

/**
 * Initial DrillState from PBIR `active` flags on a hierarchy role's projections (PBI's saved drill / expand state):
 * several active projections = expanded down to the last one (`expandedLevel`, starting at the first active level);
 * a single active projection at k > 0 = drilled to level k. Matrix Columns map to `columnLevel` / `columnExpandedLevel`.
 */
export function seedDrillState(visualJson: any): DrillState {
  let out: DrillState | undefined
  const rowRole = ROW_ROLES.find((r) => (visualJson?.visual?.query?.queryState?.[r]?.projections?.length ?? 0) > 1)
  const rows = rowRole ? activeIndexes(visualJson, rowRole) : []
  if (rows.length > 1) out = { level: rows[0], path: [], expandedLevel: rows[rows.length - 1] }
  else if (rows.length === 1 && rows[0] > 0) out = { level: rows[0], path: [] }
  const cols = activeIndexes(visualJson, 'Columns')
  if (cols.length > 1) out = { ...(out ?? { level: 0, path: [] }), columnLevel: cols[0], columnExpandedLevel: cols[cols.length - 1] }
  else if (cols.length === 1 && cols[0] > 0) out = { ...(out ?? { level: 0, path: [] }), columnLevel: cols[0] }
  if (out && out.level === 0 && out.expandedLevel === 0) delete out.expandedLevel
  return out ?? EMPTY_DRILL
}

const infoCache = new Map<string, { sig: string; info: ReportInfo }>()

/**
 * ReportInfo (pages incl. flags, bookmarks, image resolution). Reused while its content is unchanged so
 * unrelated report edits (moving a visual) don't invalidate every visual's host context.
 */
export function reportInfo(report: ReportDocument, activePage: string, activeBookmark?: string | null): ReportInfo {
  const pages = orderedPages(report).map((p) => {
    const i = pageInfo(p)
    const dt = i.isDrillthrough ? drillthroughFields(p).map((f) => f.field) : undefined
    return { name: i.name, displayName: i.displayName, hidden: i.hidden, isTooltip: i.isTooltip, isDrillthrough: i.isDrillthrough, ...(dt?.length ? { drillthroughFields: dt } : {}) }
  })
  const bookmarks = bookmarkList(report)
  const sig = JSON.stringify([pages, bookmarks, activeBookmark ?? null])
  const hit = infoCache.get(activePage)
  if (hit && hit.sig === sig) return hit.info
  const info: ReportInfo = {
    pages,
    activePage,
    bookmarks,
    ...(activeBookmark ? { activeBookmark } : {}),
    resolveImage: (ref) => resolveImageUrl(useApp.getState().project?.report ?? report, ref)
  }
  infoCache.set(activePage, { sig, info })
  return info
}

// ---------------------------------------------------------------------------------------------
// Page visuals with their effective filters (ReportInfo.pageVisuals, for page-summarizing visuals)
// ---------------------------------------------------------------------------------------------

/** Visual types that summarize the whole page and get `ctx.report.pageVisuals` (smart narrative). */
const PAGE_SUMMARY_TYPES = new Set(['aiNarratives'])

export interface VisualFilterSet {
  filters: SQFilter[]
  highlightFilters?: SQFilter[]
}

/**
 * Effective filters of every visual per page, published by the interactive canvas (PageCanvas) after it computed them.
 * Only page-summary visuals subscribe, so other visuals don't re-render when a filter elsewhere on the page changes.
 */
export const usePageVisualFilters = create<{ byPage: Record<string, ReadonlyMap<string, VisualFilterSet>>; publish(page: string, map: ReadonlyMap<string, VisualFilterSet>): void }>((set, get) => ({
  byPage: {},
  publish(page, map) {
    if (get().byPage[page] !== map) set({ byPage: { ...get().byPage, [page]: map } })
  }
}))

/** `ReportInfo.pageVisuals` for a page: every visual (document order) with its effective filters when known. */
export function pageVisualInfos(report: ReportDocument, pageName: string, filters: ReadonlyMap<string, VisualFilterSet> | undefined): PageVisualInfo[] {
  const page = findPage(report, pageName)
  return (page?.visuals ?? []).map((visual) => {
    const f = filters?.get(visual.name)
    return f ? { visual, filters: f.filters } : { visual }
  })
}

export interface HostEnv {
  report: ReportDocument
  pageName: string
  mode: 'view' | 'edit'
  /** non-interactive canvases (print, thumbnails) ignore selection/tooltip/menu requests */
  interactive: boolean
}

export function useVisualHost(env: HostEnv, visualName: string, filters: SQFilter[], highlightFilters: SQFilter[], isSlicer: boolean): VisualHostContext | null {
  const engine = useApp((s) => s.engine)
  const theme = useApp((s) => s.theme)
  const { pageName, interactive, mode, report } = env
  const selection = useInteraction((s) => {
    const cf = s.crossFilter[pageName]
    return cf && cf.source === visualName ? cf.identities : EMPTY_SEL
  })
  const storedDrill = useInteraction((s) => s.drill[drillStateKey(pageName, visualName)])
  // page-wide data point selection (any visual) — drill-through buttons act on it
  const pageSelection = useInteraction((s) => s.crossFilter[pageName]?.identities ?? EMPTY_SEL)
  const activeBookmark = useInteraction((s) => s.activeBookmark)
  const slicerOverlay = useInteraction((s) => {
    if (!isSlicer) return undefined
    const pend = s.pendingSlicers[pageName]
    if (pend && visualName in pend) return pend[visualName]
    const ap = s.slicers[pageName]
    if (ap && visualName in ap) return ap[visualName]
    return undefined
  })
  const visualJson = findVisual(findPage(report, pageName), visualName)?.json
  // until the user drills, start from the saved PBIR expand/drill state (`active` projections)
  const seedSig = activeSignature(visualJson)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const seeded = useMemo(() => seedDrillState(visualJson), [seedSig])
  const drill = storedDrill ?? seeded
  const savedSlicer = isSlicer ? savedSlicerFilter(visualJson) : undefined
  const slicerFilter = slicerOverlay === null ? undefined : (slicerOverlay ?? savedSlicer)
  const baseInfo = reportInfo(report, pageName, activeBookmark)
  const summarizesPage = PAGE_SUMMARY_TYPES.has(String(visualJson?.visual?.visualType ?? ''))
  const pageFilters = usePageVisualFilters((s) => (summarizesPage ? s.byPage[pageName] : undefined))
  const page = summarizesPage ? findPage(report, pageName) : undefined
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const info = useMemo(() => (summarizesPage ? { ...baseInfo, pageVisuals: pageVisualInfos(report, pageName, pageFilters) } : baseInfo), [summarizesPage, baseInfo, page, pageFilters, pageName])

  return useMemo(() => {
    if (!engine) return null
    const meter = newMeter()
    const eng: QueryEngine = meteredEngine(cachedEngine(engine), meter, () => interactive && useShell.getState().perfRecording)
    const actions: VisualActions = {
      navigatePage: (p) => navigatePage(p),
      applyBookmark: (b) => applyBookmark(b),
      back: () => goBack(),
      drillthrough: (target, identity) => drillthrough(pageName, target, identity, filters),
      openUrl: (u) => openUrl(u),
      clearAllSlicers: () => clearAllSlicers(pageName)
    }
    const ctx: VisualHostContext = {
      engine: eng,
      theme,
      format: (v, f, t) => eng.format(v, f, t),
      locale: 'en-US',
      mode,
      filters,
      highlightFilters: highlightFilters.length ? highlightFilters : undefined,
      selection,
      pageSelection: pageSelection.length ? pageSelection : undefined,
      select: (ids, opts) => {
        if (interactive) selectDataPoints(pageName, visualName, ids, opts)
      },
      setSlicerFilter: (f) => setSlicerFilter(pageName, visualName, f),
      slicerFilter,
      drill,
      setDrill: (next) => setDrill(pageName, visualName, next),
      showTooltip: (req) => {
        if (!interactive) return
        const it = useInteraction.getState()
        if (!req) {
          if (it.tooltip && it.tooltip.page === pageName && it.tooltip.visual === visualName) it.setTooltip(null)
          return
        }
        it.setTooltip({ page: pageName, visual: visualName, req, sourceFilters: filters })
      },
      showContextMenu: (req) => {
        if (!interactive) return
        lastMenuRequest = Date.now()
        useInteraction.getState().setContextMenu({ page: pageName, visual: visualName, req })
      },
      actions,
      report: info,
      updateVisual: (mutator) => {
        useApp.getState().mutateReport('Edit visual', (draft) => {
          const v = findVisual(findPage(draft, pageName), visualName)
          if (v) mutator(v.json)
        })
      }
    }
    meters.set(ctx, meter)
    return ctx
  }, [engine, theme, mode, filters, highlightFilters, selection, pageSelection, slicerFilter, drill, info, pageName, visualName, interactive])
}

/** Timestamp of the last visual-originated context menu (so the container doesn't open a second, generic one). */
export let lastMenuRequest = 0

const live = new Map<string, VisualHostContext>()

/** Register the live host context of a rendered visual (main canvas) so menus / exports can reuse it. */
export function registerLiveContext(page: string, visual: string, ctx: VisualHostContext | null): () => void {
  const k = `${page}/${visual}`
  if (ctx) live.set(k, ctx)
  return () => {
    if (live.get(k) === ctx) live.delete(k)
  }
}

export function liveContext(page: string, visual: string): VisualHostContext | undefined {
  return live.get(`${page}/${visual}`)
}
