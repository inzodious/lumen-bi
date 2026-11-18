/**
 * Application document store (zustand). Holds the open project, the engine built from it, the
 * active view/page, edit selection, and undo/redo.
 *
 * RULES
 *  - Mutate the report only through `mutateReport` and the model only through `mutateModel`;
 *    both are undoable and keep `dirty` + the engine in sync.
 *  - Runtime interaction state (slicer selections, cross-filter, drill, bookmarks applied) lives
 *    in ./interaction.ts, not here.
 *  - Extend by adding fields/actions here; keep them documented.
 */
import { create } from 'zustand'
import { Immer } from 'immer'
import type { ProjectDocument } from '@core/project'
import type { QueryEngine } from '@core/engine/api'
import type { ReportDocument } from '@core/report/types'
import type { SemanticModel } from '@core/model/types'
import { resolveTheme, type ResolvedTheme } from '@core/report/theme'
import { createEngine } from '@core/engine/engine'
import { withReconciledSidecars } from '@core/io/diagramSidecar'

export type AppView = 'report' | 'data' | 'model' | 'dax' | 'powerquery'

/** Canvas page view (View ▸ Page view). null = use the page's own `displayOption`. */
export type PageViewMode = 'fitToPage' | 'fitToWidth' | 'actualSize'

/** "Export data" request raised from a visual's context menu / header; the shell implements the export. */
export interface ExportVisualDataRequest {
  pageName: string
  visualName: string
  title: string
  data: { columns: string[]; rows: import('@core/model/data').Scalar[][] } | undefined
}

export type FieldSelection =
  | { kind: 'table'; table: string }
  | { kind: 'column'; table: string; name: string }
  | { kind: 'measure'; table: string; name: string }
  | { kind: 'hierarchy'; table: string; name: string }

interface Snapshot {
  label: string
  report?: ReportDocument
  model: SemanticModel
  /** coalescing key + time: consecutive edits with the same key within COALESCE_MS share one undo step */
  coalesce?: string
  at?: number
}

const COALESCE_MS = 1000

/** Options for report edits. */
export interface MutateOptions {
  /**
   * Coalesce with the previous edit when it had the same key and happened less than a second ago (keyboard nudges,
   * repeated resizes): one undo step restores the state before the whole burst.
   */
  coalesce?: string
}

export interface AppState {
  project: ProjectDocument | null
  engine: QueryEngine | null
  engineError?: string
  theme: ResolvedTheme
  view: AppView
  activePage: string | null
  /** selected visual names on the active page (edit mode) */
  selectedVisuals: string[]
  /** field selected in the Data pane / data view / model view */
  selectedField: FieldSelection | null
  busy: { message: string; progress?: number } | null
  undoStack: Snapshot[]
  redoStack: Snapshot[]
  /** bumps whenever data/model changes so memoized queries recompute */
  revision: number
  /** report canvas: edit mode (selection chrome, hidden pages navigable) vs reading view */
  editMode: boolean
  /** report canvas: page view override (null = page displayOption) */
  pageView: PageViewMode | null
  /** report canvas: explicit zoom (1 = 100%); null = fit according to pageView/displayOption */
  zoom: number | null
  /** report canvas: effective scale currently applied (read-only for the status bar) */
  canvasScale: number
  /** shell-provided handler for a visual's "Export data" command */
  exportVisualData: ((req: ExportVisualDataRequest) => void) | null
  /** Modeling ▸ View as: RLS roles currently simulated (null = none). Applied via engine.setViewAsRoles. */
  viewAsRoles: string[] | null

  setProject(project: ProjectDocument | null): void
  setView(view: AppView): void
  setActivePage(name: string): void
  selectVisuals(names: string[]): void
  selectField(sel: FieldSelection | null): void
  setBusy(busy: AppState['busy']): void
  /** Undoable report edit. The mutator receives a draft copy of the report document. */
  mutateReport(label: string, mutator: (report: ReportDocument) => void, opts?: MutateOptions): void
  /** Undoable model edit. Rebuilds/invalidates the engine and recomputes calculated objects. */
  mutateModel(label: string, mutator: (model: SemanticModel) => void): void
  /** Data changed (refresh / import): rebuild the engine. */
  dataChanged(): void
  /**
   * NON-undoable report edit for runtime state that PBI persists into the document (slicer selections,
   * bookmark application). Marks the project dirty; uses structural sharing like mutateReport.
   */
  patchReport(mutator: (report: ReportDocument) => void): void
  setEditMode(on: boolean): void
  setPageView(mode: PageViewMode | null): void
  setZoom(zoom: number | null): void
  setCanvasScale(scale: number): void
  setExportVisualDataHandler(handler: ((req: ExportVisualDataRequest) => void) | null): void
  /** Modeling ▸ View as roles (null = stop viewing). Re-applies to the current engine and bumps revision. */
  setViewAsRoles(roles: string[] | null): void
  /**
   * Non-semantic, NON-undoable edit of a model sidecar file (e.g. `diagramLayout.json` when cards are
   * moved in Model view). Does not rebuild the engine; marks the project dirty. `null` removes the file.
   */
  patchModelSidecar(path: string, content: string | null): void
  /**
   * UNDOABLE edit of the model's sidecar files (Model view: card positions in `diagramLayout.json`, line routing
   * and table groups in Lumen's `diagramLayout.lumen.json`). The mutator edits a copy of the path → text map
   * (delete a key to remove the file); several files changed together are one undo step. Layout-only: the
   * engine is not rebuilt, here or when the step is undone/redone. Marks the project dirty.
   */
  mutateModelSidecars(label: string, mutator: (files: Record<string, string>) => void): void
  /** After a successful save: clear `dirty` and (Save As) update the project source/name. */
  markSaved(source?: ProjectDocument['source'], name?: string): void
  undo(): void
  redo(): void
}

/**
 * Report edits use immer (structural sharing): untouched pages/visuals keep their object identity so the
 * canvas only re-renders / re-queries what changed. autoFreeze is off because loaders and engines may
 * annotate objects in place; the previous report object is never mutated by produce(), so undo snapshots
 * can hold it by reference.
 */
const immer = new Immer({ autoFreeze: false })

/** True when two model objects differ at most in their sidecar files (layout-only edits never need a new engine). */
function sameModelSemantics(a: SemanticModel, b: SemanticModel): boolean {
  if (a === b) return true
  const ra = a as unknown as Record<string, unknown>
  const rb = b as unknown as Record<string, unknown>
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) if (k !== 'sidecarFiles' && ra[k] !== rb[k]) return false
  return true
}
const produceReport = (report: ReportDocument, mutator: (r: ReportDocument) => void): ReportDocument =>
  immer.produce(report, (draft: ReportDocument) => {
    mutator(draft)
  })

/** Report content that depends on the theme and must follow a theme change in the same undo step. */
export type ThemeFollower = (draft: ReportDocument, theme: ResolvedTheme) => void
const themeFollowers: ThemeFollower[] = []
/**
 * Register a follower: called inside `mutateReport` (on the produced report, same undo step) whenever an edit
 * changes the report theme. Lumen icons use it to re-bake icons drawn in theme colours (icons/actions.ts).
 */
export function onReportThemeChange(fn: ThemeFollower): void {
  if (!themeFollowers.includes(fn)) themeFollowers.push(fn)
}

function buildEngine(project: ProjectDocument | null): { engine: QueryEngine | null; engineError?: string } {
  if (!project) return { engine: null }
  try {
    const engine = createEngine(project.model, project.data)
    engine.processCalculated()
    const roles = useApp.getState().viewAsRoles
    if (roles?.length) engine.setViewAsRoles?.(roles)
    return { engine }
  } catch (e) {
    return { engine: null, engineError: e instanceof Error ? e.message : String(e) }
  }
}

function themeOf(project: ProjectDocument | null): ResolvedTheme {
  return resolveTheme(project?.report?.theme.base, project?.report?.theme.custom)
}

export const useApp = create<AppState>()((set, get) => ({
  project: null,
  engine: null,
  theme: resolveTheme(),
  view: 'report',
  activePage: null,
  selectedVisuals: [],
  selectedField: null,
  busy: null,
  undoStack: [],
  redoStack: [],
  revision: 0,
  editMode: true,
  pageView: null,
  zoom: null,
  canvasScale: 1,
  exportVisualData: null,
  viewAsRoles: null,

  setProject(project) {
    const report = project?.report
    const firstVisible = report?.pagesMeta.pageOrder.find((n) => report.pages.find((p) => p.name === n)?.json?.visibility !== 'HiddenInViewMode')
    set({
      project,
      ...buildEngine(project),
      theme: themeOf(project),
      activePage: report ? (report.pagesMeta.activePageName ?? firstVisible ?? report.pages[0]?.name ?? null) : null,
      selectedVisuals: [],
      selectedField: null,
      undoStack: [],
      redoStack: [],
      revision: get().revision + 1
    })
  },
  setView: (view) => set({ view }),
  setActivePage: (name) => set({ activePage: name, selectedVisuals: [] }),
  selectVisuals: (names) => set({ selectedVisuals: names }),
  selectField: (sel) => set({ selectedField: sel }),
  setBusy: (busy) => set({ busy }),

  mutateReport(label, mutator, opts) {
    const { project } = get()
    if (!project?.report) return
    const now = Date.now()
    const snapshot: Snapshot = { label, report: project.report, model: project.model, coalesce: opts?.coalesce, at: now }
    let report = produceReport(project.report, mutator)
    if (report === project.report) return
    let next = { ...project, report, dirty: true }
    const theme = report.theme === project.report.theme ? get().theme : themeOf(next)
    if (theme !== get().theme && themeFollowers.length) {
      report = produceReport(report, (d) => themeFollowers.forEach((f) => f(d, theme)))
      next = { ...project, report, dirty: true }
    }
    const stack = get().undoStack
    const top = stack[stack.length - 1]
    if (opts?.coalesce && top?.coalesce === opts.coalesce && top.at !== undefined && now - top.at < COALESCE_MS && !get().redoStack.length) {
      // keep the older snapshot (state before the burst); refresh its timestamp
      set({ project: next, theme, undoStack: [...stack.slice(0, -1), { ...top, at: now }], revision: get().revision + 1 })
      return
    }
    set({ project: next, theme, undoStack: [...stack.slice(-99), snapshot], redoStack: [], revision: get().revision + 1 })
  },

  mutateModel(label, mutator) {
    const { project } = get()
    if (!project) return
    // Structural sharing (immer) rather than a deep clone: the TMDL writer remembers each object's
    // source formatting by identity (WeakMap), so untouched tables/measures must stay the same objects
    // for byte-identical saves. produce() never mutates the previous model, so undo can hold it by reference.
    const snapshot: Snapshot = { label, report: project.report, model: project.model }
    const produced = immer.produce(project.model, (draft: SemanticModel) => {
      mutator(draft)
    })
    if (produced === project.model) return
    // Lumen's diagram sidecar follows table renames and drops deleted tables/relationships in the same undo step
    const model = withReconciledSidecars(project.model, produced)
    const next = { ...project, model, dirty: true }
    set({ project: next, ...buildEngine(next), undoStack: [...get().undoStack.slice(-99), snapshot], redoStack: [], revision: get().revision + 1 })
  },

  patchReport(mutator) {
    const { project } = get()
    if (!project?.report) return
    const report = produceReport(project.report, mutator)
    if (report === project.report) return
    set({ project: { ...project, report, dirty: true } })
  },

  setEditMode: (editMode) => set({ editMode, ...(editMode ? {} : { selectedVisuals: [] }) }),
  setPageView: (pageView) => set({ pageView, zoom: null }),
  setZoom: (zoom) => set({ zoom: zoom === null ? null : Math.max(0.1, Math.min(4, zoom)) }),
  setCanvasScale: (canvasScale) => {
    if (Math.abs(get().canvasScale - canvasScale) > 1e-4) set({ canvasScale })
  },
  setExportVisualDataHandler: (exportVisualData) => set({ exportVisualData }),
  patchModelSidecar(path, content) {
    const { project } = get()
    if (!project) return
    const sidecarFiles = { ...(project.model.sidecarFiles ?? {}) }
    if (content === null) delete sidecarFiles[path]
    else sidecarFiles[path] = content
    set({ project: { ...project, model: { ...project.model, sidecarFiles }, dirty: true } })
  },
  mutateModelSidecars(label, mutator) {
    const { project } = get()
    if (!project) return
    const before = project.model.sidecarFiles ?? {}
    const sidecarFiles = { ...before }
    mutator(sidecarFiles)
    const keys = new Set([...Object.keys(before), ...Object.keys(sidecarFiles)])
    if ([...keys].every((k) => before[k] === sidecarFiles[k])) return
    const snapshot: Snapshot = { label, report: project.report, model: project.model }
    set({ project: { ...project, model: { ...project.model, sidecarFiles }, dirty: true }, undoStack: [...get().undoStack.slice(-99), snapshot], redoStack: [] })
  },
  setViewAsRoles(roles) {
    const next = roles?.length ? roles : null
    get().engine?.setViewAsRoles?.(next)
    set({ viewAsRoles: next, revision: get().revision + 1 })
  },
  markSaved(source, name) {
    const { project } = get()
    if (!project) return
    set({ project: { ...project, dirty: false, ...(source ? { source } : {}), ...(name ? { name } : {}) } })
  },

  dataChanged() {
    const { project } = get()
    set({ ...buildEngine(project), revision: get().revision + 1 })
  },

  undo() {
    const { project, undoStack, redoStack } = get()
    const snap = undoStack[undoStack.length - 1]
    if (!project || !snap) return
    const redo: Snapshot = { label: snap.label, report: project.report, model: project.model }
    const next = { ...project, report: snap.report, model: snap.model, dirty: true }
    const modelChanged = !sameModelSemantics(snap.model, project.model)
    set({
      project: next,
      ...(modelChanged ? buildEngine(next) : {}),
      theme: themeOf(next),
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, redo],
      revision: get().revision + 1
    })
  },

  redo() {
    const { project, undoStack, redoStack } = get()
    const snap = redoStack[redoStack.length - 1]
    if (!project || !snap) return
    const undo: Snapshot = { label: snap.label, report: project.report, model: project.model }
    const next = { ...project, report: snap.report, model: snap.model, dirty: true }
    const modelChanged = !sameModelSemantics(snap.model, project.model)
    set({
      project: next,
      ...(modelChanged ? buildEngine(next) : {}),
      theme: themeOf(next),
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, undo],
      revision: get().revision + 1
    })
  }
}))
