/**
 * Runtime report interaction state (zustand): slicer selections, cross-filter / cross-highlight
 * selection, drill state per visual, drill-through (+ Back stack), focus mode / show-as-table,
 * spotlight, tooltip, context menu, applied bookmark.
 *
 * Document-persisted parts (slicer selections, bookmark-applied filters/visibility) are written into the
 * report through `useApp().patchReport` by the canvas (report/host.ts) — this store is the immediate
 * runtime overlay so the UI responds instantly while persistence is batched.
 */
import { create } from 'zustand'
import type { DataPointIdentity, SQFilter } from '@core/report/sq'
import type { ContextMenuRequest, DrillState, TooltipRequest } from '../visuals/contract'

export interface CrossFilterSelection {
  /** source visual name */
  source: string
  identities: DataPointIdentity[]
}

export interface DrillthroughState {
  /** filters carried into the target page */
  filters: SQFilter[]
  /** fieldKeys of the target page's drill-through fields replaced by `filters` */
  fieldKeys: string[]
  /** page we came from (Back) */
  fromPage: string
}

export interface FocusState {
  page: string
  visual: string
  /** 'focus' = focus mode; 'table' = show as a table */
  mode: 'focus' | 'table'
  /** "Show data point as a table": restrict the visual and its data to this data point */
  point?: DataPointIdentity
}

export interface TooltipState {
  page: string
  visual: string
  req: TooltipRequest
  /** report page used as tooltip (resolved by the canvas) */
  tooltipPage?: string
  /** filters of the source visual (for report-page tooltips) */
  sourceFilters?: SQFilter[]
}

export interface ContextMenuState {
  page: string
  visual: string
  req: ContextMenuRequest
}

export const EMPTY_DRILL: DrillState = Object.freeze({ level: 0, path: [] }) as DrillState

const drillKey = (page: string, visual: string) => `${page}/${visual}`

export interface InteractionState {
  /** applied slicer selections: page → visual → filter (null = explicitly cleared; absent = use saved visual.json) */
  slicers: Record<string, Record<string, SQFilter | null>>
  /** not-yet-applied slicer selections (debounced typing) — shown by the slicer itself */
  pendingSlicers: Record<string, Record<string, SQFilter | null>>
  /** cross-filter selection per page */
  crossFilter: Record<string, CrossFilterSelection | undefined>
  /** drill state per `${page}/${visual}` */
  drill: Record<string, DrillState>
  /** active drill-through per target page */
  drillthrough: Record<string, DrillthroughState | undefined>
  /** page navigation history for the Back action (drill-through / page navigation buttons) */
  backStack: string[]
  focus: FocusState | null
  spotlight: { page: string; visual: string } | null
  tooltip: TooltipState | null
  contextMenu: ContextMenuState | null
  appliedBookmark: string | null
  /**
   * Bookmark applied most recently (bookmark navigator selection). Unlike `appliedBookmark` (bookmarks pane
   * highlight, cleared by slicer edits) it sticks until another bookmark is applied or the report is reset.
   */
  activeBookmark: string | null

  reset(): void
  getSlicer(page: string, visual: string): SQFilter | null | undefined
  setSlicer(page: string, visual: string, filter: SQFilter | null, opts?: { pending?: boolean }): void
  commitPending(): Array<{ page: string; visual: string; filter: SQFilter | null }>
  clearSlicers(entries: Array<{ page: string; visual: string }>): void
  setCrossFilter(page: string, sel: CrossFilterSelection | undefined): void
  getDrill(page: string, visual: string): DrillState
  setDrill(page: string, visual: string, state: DrillState | undefined): void
  setDrillthrough(page: string, dt: DrillthroughState | undefined): void
  pushBack(page: string): void
  popBack(): string | undefined
  setFocus(focus: FocusState | null): void
  setSpotlight(s: { page: string; visual: string } | null): void
  setTooltip(t: TooltipState | null): void
  setContextMenu(m: ContextMenuState | null): void
  setAppliedBookmark(name: string | null): void
}

const initial = {
  slicers: {},
  pendingSlicers: {},
  crossFilter: {},
  drill: {},
  drillthrough: {},
  backStack: [],
  focus: null,
  spotlight: null,
  tooltip: null,
  contextMenu: null,
  appliedBookmark: null,
  activeBookmark: null
}

export const useInteraction = create<InteractionState>()((set, get) => ({
  ...initial,

  reset: () => set({ ...initial }),

  getSlicer(page, visual) {
    const p = get().pendingSlicers[page]
    if (p && visual in p) return p[visual]
    const a = get().slicers[page]
    if (a && visual in a) return a[visual]
    return undefined
  },

  setSlicer(page, visual, filter, opts = {}) {
    if (opts.pending) {
      set((s) => ({ pendingSlicers: { ...s.pendingSlicers, [page]: { ...s.pendingSlicers[page], [visual]: filter } } }))
      return
    }
    set((s) => {
      const pend = { ...s.pendingSlicers[page] }
      delete pend[visual]
      return {
        slicers: { ...s.slicers, [page]: { ...s.slicers[page], [visual]: filter } },
        pendingSlicers: { ...s.pendingSlicers, [page]: pend },
        appliedBookmark: null
      }
    })
  },

  commitPending() {
    const pend = get().pendingSlicers
    const out: Array<{ page: string; visual: string; filter: SQFilter | null }> = []
    for (const [page, m] of Object.entries(pend)) for (const [visual, filter] of Object.entries(m)) out.push({ page, visual, filter })
    if (!out.length) return out
    set((s) => {
      const slicers = { ...s.slicers }
      for (const e of out) slicers[e.page] = { ...slicers[e.page], [e.visual]: e.filter }
      return { slicers, pendingSlicers: {}, appliedBookmark: null }
    })
    return out
  },

  clearSlicers(entries) {
    set((s) => {
      const slicers = { ...s.slicers }
      for (const e of entries) slicers[e.page] = { ...slicers[e.page], [e.visual]: null }
      return { slicers, appliedBookmark: null }
    })
  },

  setCrossFilter(page, sel) {
    set((s) => ({ crossFilter: { ...s.crossFilter, [page]: sel && sel.identities.length ? sel : undefined } }))
  },

  getDrill(page, visual) {
    return get().drill[drillKey(page, visual)] ?? EMPTY_DRILL
  },

  setDrill(page, visual, state) {
    set((s) => {
      const drill = { ...s.drill }
      if (state) drill[drillKey(page, visual)] = state
      else delete drill[drillKey(page, visual)]
      return { drill }
    })
  },

  setDrillthrough(page, dt) {
    set((s) => ({ drillthrough: { ...s.drillthrough, [page]: dt } }))
  },

  pushBack(page) {
    set((s) => ({ backStack: [...s.backStack.slice(-49), page] }))
  },

  popBack() {
    const st = get().backStack
    const last = st[st.length - 1]
    if (last !== undefined) set({ backStack: st.slice(0, -1) })
    return last
  },

  setFocus: (focus) => set({ focus }),
  setSpotlight: (spotlight) => set({ spotlight }),
  setTooltip: (tooltip) => set({ tooltip }),
  setContextMenu: (contextMenu) => set(contextMenu ? { contextMenu, tooltip: null } : { contextMenu }),
  setAppliedBookmark: (appliedBookmark) => set(appliedBookmark ? { appliedBookmark, activeBookmark: appliedBookmark } : { appliedBookmark })
}))

export function drillStateKey(page: string, visual: string): string {
  return drillKey(page, visual)
}
