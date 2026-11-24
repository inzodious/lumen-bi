/**
 * Imperative report runtime API (navigation, drill-through, slicers + sync groups, bookmarks, context menu
 * commands). Operates on the document store (`useApp`) and the interaction store (`useInteraction`).
 * Exported for the shell (Bookmarks pane, Selection pane, ribbon) through ./index.ts.
 */
import { useApp } from '../state/store'
import { useInteraction } from '../state/interaction'
import type { DataPointIdentity, SQFilter } from '@core/report/sq'
import type { PageDocument, ReportDocument } from '@core/report/types'
import type { DrillState } from '../visuals/contract'
import { addBookmark, captureBookmark, deleteBookmark, planBookmarkApply, updateBookmark, type CaptureOptions, type RuntimeSnapshot } from './bookmarks'
import { buildDrillthrough, includeExcludeCard } from './filters'
import { beforeBookmark, noteNavigation } from './motion/pageTransition'
import {
  drillthroughFields,
  findPage,
  findVisual,
  isSlicerType,
  keepsAllFilters,
  newObjectName,
  pageInfo,
  savedSlicerFilter,
  syncGroupOf,
  visualTypeOf,
  writeSlicerFilter
} from './pbir'

const report = (): ReportDocument | undefined => useApp.getState().project?.report

// ---------------------------------------------------------------------------------------------
// Slicers
// ---------------------------------------------------------------------------------------------

/** Effective (applied) slicer filter: runtime overlay, else saved visual.json selection. */
export function effectiveSlicerFilter(page: PageDocument, visualName: string, opts: { includePending?: boolean } = {}): SQFilter | undefined {
  const st = useInteraction.getState()
  if (opts.includePending) {
    const pend = st.pendingSlicers[page.name]
    if (pend && visualName in pend) return pend[visualName] ?? undefined
  }
  const applied = st.slicers[page.name]
  if (applied && visualName in applied) return applied[visualName] ?? undefined
  const v = findVisual(page, visualName)
  return v ? savedSlicerFilter(v.json) : undefined
}

/** Applied slicer filters for every slicer on a page (input of computeVisualFilters). */
export function pageSlicerFilters(page: PageDocument, applied: Record<string, SQFilter | null> | undefined): Record<string, SQFilter | undefined> {
  const out: Record<string, SQFilter | undefined> = {}
  for (const v of page.visuals) {
    if (!isSlicerType(visualTypeOf(v))) continue
    out[v.name] = applied && v.name in applied ? (applied[v.name] ?? undefined) : savedSlicerFilter(v.json)
  }
  return out
}

/** Slicers synced with (page, visual) through a sync group with filterChanges on (excluding itself). */
export function syncTargets(r: ReportDocument, pageName: string, visualName: string): Array<{ page: string; visual: string }> {
  const src = findVisual(findPage(r, pageName), visualName)
  const sg = src ? syncGroupOf(src.json) : undefined
  if (!sg || !sg.filterChanges) return []
  const out: Array<{ page: string; visual: string }> = []
  for (const p of r.pages) {
    for (const v of p.visuals) {
      if (p.name === pageName && v.name === visualName) continue
      const g = syncGroupOf(v.json)
      if (g && g.groupName === sg.groupName && g.filterChanges) out.push({ page: p.name, visual: v.name })
    }
  }
  return out
}

let commitTimer: ReturnType<typeof setTimeout> | undefined
const SLICER_DEBOUNCE_MS = 120

/** Apply all pending slicer selections: runtime state, sync groups, and persistence into visual.json. */
export function flushSlicers(): void {
  if (commitTimer) clearTimeout(commitTimer)
  commitTimer = undefined
  const entries = useInteraction.getState().commitPending()
  if (!entries.length) return
  const r = report()
  if (!r) return
  const all = new Map<string, { page: string; visual: string; filter: SQFilter | null }>()
  for (const e of entries) {
    all.set(`${e.page}/${e.visual}`, e)
    for (const t of syncTargets(r, e.page, e.visual)) all.set(`${t.page}/${t.visual}`, { ...t, filter: e.filter })
  }
  const st = useInteraction.getState()
  for (const e of all.values()) if (!entries.includes(e)) st.setSlicer(e.page, e.visual, e.filter)
  useApp.getState().patchReport((draft) => {
    for (const e of all.values()) {
      const v = findVisual(findPage(draft, e.page), e.visual)
      if (v) writeSlicerFilter(v.json, e.filter ?? undefined)
    }
  }, 'Slicer selection')
}

/** Set a slicer selection (debounced commit so typing in a slicer doesn't re-query every keystroke). */
export function setSlicerFilter(pageName: string, visualName: string, filter: SQFilter | undefined): void {
  useInteraction.getState().setSlicer(pageName, visualName, filter ?? null, { pending: true })
  if (commitTimer) clearTimeout(commitTimer)
  commitTimer = setTimeout(flushSlicers, SLICER_DEBOUNCE_MS)
}

/** "Clear all slicers" button action. */
export function clearAllSlicers(pageName: string): void {
  const page = findPage(report(), pageName)
  if (!page) return
  for (const v of page.visuals) if (isSlicerType(visualTypeOf(v))) useInteraction.getState().setSlicer(pageName, v.name, null, { pending: true })
  flushSlicers()
}

// ---------------------------------------------------------------------------------------------
// Selection / drill
// ---------------------------------------------------------------------------------------------

function sameIds(a: DataPointIdentity[], b: DataPointIdentity[]): boolean {
  if (a.length !== b.length) return false
  const k = (x: DataPointIdentity) => JSON.stringify(x.fields.map((f) => [f.expr, f.value instanceof Date ? f.value.getTime() : f.value]))
  const sa = new Set(a.map(k))
  return b.every((x) => sa.has(k(x)))
}

/** Cross-filter selection from a visual. Clicking the only selected point again clears (PBI toggle). */
export function selectDataPoints(pageName: string, visualName: string, ids: DataPointIdentity[], opts: { multi?: boolean } = {}): void {
  const st = useInteraction.getState()
  const cur = st.crossFilter[pageName]
  const mine = cur?.source === visualName ? cur.identities : []
  let next: DataPointIdentity[]
  if (opts.multi) {
    const key = (x: DataPointIdentity) => JSON.stringify(x.fields.map((f) => [f.expr, f.value instanceof Date ? f.value.getTime() : f.value]))
    const map = new Map(mine.map((m) => [key(m), m]))
    for (const id of ids) {
      if (map.has(key(id))) map.delete(key(id))
      else map.set(key(id), id)
    }
    next = [...map.values()]
  } else next = ids.length && sameIds(mine, ids) ? [] : ids
  st.setCrossFilter(pageName, next.length ? { source: visualName, identities: next } : undefined)
}

export function setDrill(pageName: string, visualName: string, state: DrillState): void {
  useInteraction.getState().setDrill(pageName, visualName, state.level === 0 && !state.path.length && !state.expandedLevel && !state.drillMode ? undefined : state)
}

// ---------------------------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------------------------

export function navigatePage(pageName: string, opts: { pushBack?: boolean } = {}): void {
  const app = useApp.getState()
  if (!findPage(app.project?.report, pageName) || app.activePage === pageName) return
  flushSlicers()
  if (opts.pushBack !== false && app.activePage) useInteraction.getState().pushBack(app.activePage)
  const it = useInteraction.getState()
  it.setFocus(null)
  it.setSpotlight(null)
  it.setTooltip(null)
  it.setContextMenu(null)
  app.setActivePage(pageName)
}

export function goBack(): void {
  const prev = useInteraction.getState().popBack()
  if (!prev) return
  noteNavigation('back')
  navigatePage(prev, { pushBack: false })
}

/** Drill-through targets available for a data point (pages whose drill-through fields match). */
export function drillthroughTargets(identity: DataPointIdentity | undefined): Array<{ name: string; displayName: string }> {
  const r = report()
  if (!r || !identity) return []
  const out: Array<{ name: string; displayName: string }> = []
  for (const p of r.pages) {
    const info = pageInfo(p)
    if (!info.isDrillthrough) continue
    const fields = drillthroughFields(p)
    if (buildDrillthrough(fields, identity, [], false)) out.push({ name: p.name, displayName: info.displayName })
  }
  return out
}

export function drillthrough(sourcePage: string, targetPage: string, identity: DataPointIdentity, sourceFilters: SQFilter[]): void {
  const target = findPage(report(), targetPage)
  if (!target) return
  const dt = buildDrillthrough(drillthroughFields(target), identity, sourceFilters, keepsAllFilters(target))
  if (!dt) return
  useInteraction.getState().setDrillthrough(targetPage, { ...dt, fromPage: sourcePage })
  noteNavigation('drill')
  navigatePage(targetPage)
}

export function openUrl(url: string): void {
  if (!/^(https?:|mailto:)/i.test(url)) return
  const host = (globalThis as any).window?.wbi
  if (host?.app?.openExternal) void host.app.openExternal(url)
  else (globalThis as any).window?.open?.(url, '_blank', 'noopener')
}

// ---------------------------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------------------------

export function runtimeSnapshot(): RuntimeSnapshot {
  const app = useApp.getState()
  const r = app.project?.report
  const it = useInteraction.getState()
  return {
    activePage: app.activePage ?? r?.pagesMeta.activePageName ?? r?.pages[0]?.name ?? '',
    slicerFilter: (page, visual) => {
      const p = findPage(r, page)
      return p ? effectiveSlicerFilter(p, visual) : undefined
    },
    drill: (page, visual) => it.getDrill(page, visual),
    spotlight: it.spotlight,
    focus: it.focus,
    crossFilter: (page) => it.crossFilter[page]
  }
}

/** Capture the current state as a new bookmark (undoable). Returns the bookmark name. */
export function addBookmarkFromState(opts: CaptureOptions & { group?: string }): string | undefined {
  flushSlicers()
  const r = report()
  if (!r) return undefined
  const bm = captureBookmark(r, runtimeSnapshot(), opts)
  useApp.getState().mutateReport('Add bookmark', (draft) => addBookmark(draft, bm, opts.group))
  useInteraction.getState().setAppliedBookmark(bm.name)
  return bm.name
}

/** Bookmarks pane ▸ Update: re-capture the current state into an existing bookmark (keeps its options). */
export function updateBookmarkFromState(name: string): void {
  flushSlicers()
  const r = report()
  const existing = r?.bookmarks.find((b) => b.name === name)
  if (!r || !existing) return
  const o = existing.json?.options ?? {}
  const bm = captureBookmark(r, runtimeSnapshot(), {
    displayName: existing.json?.displayName ?? name,
    name,
    data: !o.suppressData,
    display: !o.suppressDisplay,
    currentPage: !o.suppressActiveSection,
    targetVisualNames: o.applyOnlyToTargetVisuals ? o.targetVisualNames : undefined
  })
  useApp.getState().mutateReport('Update bookmark', (draft) => updateBookmark(draft, name, bm))
}

export function removeBookmark(name: string): void {
  useApp.getState().mutateReport('Delete bookmark', (draft) => deleteBookmark(draft, name))
}

/** Apply a bookmark by name (page, filters, slicers, visibility, drill, spotlight per its options). */
export function applyBookmark(name: string): void {
  flushSlicers()
  const app = useApp.getState()
  const r = app.project?.report
  const bm = r?.bookmarks.find((b) => b.name === name || b.json?.displayName === name)
  if (!r || !bm) return
  const plan = planBookmarkApply(r, bm)
  if (!plan.activePage || plan.activePage === app.activePage) beforeBookmark(app.activePage)
  app.patchReport(plan.mutate, 'Apply bookmark')
  const it = useInteraction.getState()
  for (const s of plan.slicers) it.setSlicer(s.page, s.visual, s.filter)
  for (const d of plan.drill) it.setDrill(d.page, d.visual, d.state)
  for (const p of plan.clearCrossFilterPages) it.setCrossFilter(p, undefined)
  if (plan.spotlight !== undefined) it.setSpotlight(plan.spotlight)
  if (plan.activePage && plan.activePage !== app.activePage) navigatePage(plan.activePage)
  // restore data point selections (cross-filter / cross-highlight) and focus mode after navigating
  for (const c of plan.crossFilters) useInteraction.getState().setCrossFilter(c.page, { source: c.source, identities: c.identities })
  useInteraction.getState().setFocus(plan.focus ?? null)
  useInteraction.getState().setAppliedBookmark(bm.name)
}

// ---------------------------------------------------------------------------------------------
// Context-menu commands
// ---------------------------------------------------------------------------------------------

/** Include / Exclude data points (adds a visual-level filter card, undoable). */
export function includeExclude(pageName: string, visualName: string, ids: DataPointIdentity[], mode: 'Include' | 'Exclude'): void {
  const card = includeExcludeCard(newObjectName(), ids, mode)
  if (!card) return
  useApp.getState().mutateReport(mode, (draft) => {
    const v = findVisual(findPage(draft, pageName), visualName)
    if (!v) return
    v.json.filterConfig ??= { filters: [] }
    v.json.filterConfig.filters ??= []
    v.json.filterConfig.filters.push(card)
  })
  useInteraction.getState().setCrossFilter(pageName, undefined)
}

/** Sort a visual by one of its fields (context menu ▸ Sort axis). */
export function sortVisual(pageName: string, visualName: string, field: unknown, direction: 'Ascending' | 'Descending'): void {
  useApp.getState().mutateReport('Sort', (draft) => {
    const v = findVisual(findPage(draft, pageName), visualName)
    if (!v?.json.visual) return
    v.json.visual.query ??= {}
    v.json.visual.query.sortDefinition = { sort: [{ field, direction }], isDefaultSort: false }
  })
}

// Reset runtime interaction state whenever a different project is opened.
let lastProjectId: string | undefined
useApp.subscribe((s) => {
  const id = s.project?.id
  if (id !== lastProjectId) {
    lastProjectId = id
    if (commitTimer) clearTimeout(commitTimer)
    commitTimer = undefined
    useInteraction.getState().reset()
  }
})
