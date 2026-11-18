/**
 * Power Query Editor UI state (zustand, local to the editor). Holds the working copy of the queries
 * (`Draft`), the selection (query / applied step / columns), the current preview and the View-tab
 * toggles. It survives re-renders and view switches; it is reset when another project is opened.
 */
import { create } from 'zustand'
import type { ErrorInfo } from '@core/m/engine.ts'
import type { QueryPreview } from '@core/data/preview'
import type { Draft, DraftQuery } from './logic/draft'
import type { ColInfo } from './logic/transforms'

export interface PreviewState {
  /** identity of what is shown (query id + source + step + other queries) */
  key: string
  queryId: string | null
  running: boolean
  /** "Waiting for <source>…" while the driver fetches data */
  waiting: string | null
  result: QueryPreview | null
  /** when the shown preview finished evaluating */
  at: number | null
}

export interface ViewOptions {
  formulaBar: boolean
  quality: boolean
  distribution: boolean
  profile: boolean
  monospaced: boolean
  whitespace: boolean
  queriesCollapsed: boolean
  settingsOpen: boolean
}

/** A cell picked for the details pane (errors / nested values). */
export interface CellDetail {
  column: string
  row: number
  error?: ErrorInfo
}

export interface PqState {
  projectId: string | null
  draft: Draft
  selectedId: string | null
  /** selected applied step per query id (absent / null = the last step) */
  steps: Record<string, string | null>
  selectedCols: string[]
  /** last clicked column (shift-click range anchor) */
  colAnchor: string | null
  preview: PreviewState
  /** queries whose last preview failed (id → error) */
  errors: Record<string, ErrorInfo>
  /** the first failing step of a query, found after a failed preview (id → step name) */
  errorSteps: Record<string, string>
  /** last output columns of each query (draft id → columns), used to type tables on Apply */
  outputs: Record<string, ColInfo[]>
  view: ViewOptions
  /** user-resized column widths by `query id|column` */
  widths: Record<string, number>
  detail: CellDetail | null
  /** inline renames in progress */
  renamingQuery: string | null
  renamingStep: string | null
  renamingColumn: string | null
  /** nested column whose Expand popover is open */
  expandColumn: string | null
  /** bumps to force a re-evaluation (Refresh Preview) */
  nonce: number
  /** Formula bar expanded to several lines */
  formulaExpanded: boolean

  set(patch: Partial<PqState>): void
  setView(patch: Partial<ViewOptions>): void
  setDraft(draft: Draft): void
  reset(projectId: string | null, draft: Draft): void
}

const VIEW_KEY = 'lumen.pq.view'

const DEFAULT_VIEW: ViewOptions = {
  formulaBar: true,
  quality: false,
  distribution: false,
  profile: false,
  monospaced: false,
  whitespace: true,
  queriesCollapsed: false,
  settingsOpen: true
}

function loadView(): ViewOptions {
  try {
    const raw = localStorage.getItem(VIEW_KEY)
    return raw ? { ...DEFAULT_VIEW, ...(JSON.parse(raw) as Partial<ViewOptions>) } : DEFAULT_VIEW
  } catch {
    return DEFAULT_VIEW
  }
}

function saveView(v: ViewOptions): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v))
  } catch {
    /* storage unavailable: per-session only */
  }
}

const EMPTY_PREVIEW: PreviewState = { key: '', queryId: null, running: false, waiting: null, result: null, at: null }

export const usePq = create<PqState>()((set, get) => ({
  projectId: null,
  draft: { queries: [], deleted: [], groups: [] },
  selectedId: null,
  steps: {},
  selectedCols: [],
  colAnchor: null,
  preview: EMPTY_PREVIEW,
  errors: {},
  errorSteps: {},
  outputs: {},
  view: loadView(),
  widths: {},
  detail: null,
  renamingQuery: null,
  renamingStep: null,
  renamingColumn: null,
  expandColumn: null,
  nonce: 0,
  formulaExpanded: false,

  set: (patch) => set(patch),
  setView(patch) {
    const view = { ...get().view, ...patch }
    saveView(view)
    set({ view })
  },
  setDraft: (draft) => set({ draft }),
  reset(projectId, draft) {
    set({
      projectId,
      draft,
      selectedId: draft.queries.find((q) => q.kind === 'table')?.id ?? draft.queries[0]?.id ?? null,
      steps: {},
      selectedCols: [],
      colAnchor: null,
      preview: EMPTY_PREVIEW,
      errors: {},
      errorSteps: {},
      outputs: {},
      widths: {},
      detail: null,
      renamingQuery: null,
      renamingStep: null,
      renamingColumn: null,
      expandColumn: null,
      formulaExpanded: false
    })
  }
}))

/** The selected query of the draft. */
export function selectedQuery(s: Pick<PqState, 'draft' | 'selectedId'> = usePq.getState()): DraftQuery | null {
  return s.draft.queries.find((q) => q.id === s.selectedId) ?? null
}

export function useSelectedQuery(): DraftQuery | null {
  return usePq((s) => s.draft.queries.find((q) => q.id === s.selectedId) ?? null)
}

/** Columns of the shown table preview (empty for non-table results). */
export function previewColumns(s: Pick<PqState, 'preview'> = usePq.getState()): ColInfo[] {
  const r = s.preview.result?.result
  return r?.ok && r.preview.kind === 'table' ? r.preview.columns : []
}
