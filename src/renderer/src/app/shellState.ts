/**
 * UI-only shell state (not part of the document): backstage, ribbon, right-hand panes, open
 * dialogs, notification bars and user options. Document state lives in state/store.ts.
 */
import { create } from 'zustand'

/** Performance analyzer entry (one visual load): total wall-clock ms split like PBI (query / display / other). */
export interface PerfEntry {
  visual: string
  title: string
  /** total duration (ms) */
  ms: number
  at: number
  /** time spent in engine queries (PBI "DAX query") */
  query?: number
  /** rendering / layout (PBI "Visual display") */
  render?: number
  /** remaining time (PBI "Other": waiting for other visuals, scheduling) */
  other?: number
  /** the queries the visual ran (engine requests, JSON) — "Copy query" */
  queries?: string[]
  /** page the visual is on */
  page?: string
  /** what triggered it (e.g. 'Refreshed visual', 'Changed a slicer') */
  action?: string
  /** entries of one user action share this id (the pane groups them under one header) */
  actionId?: number
  /** unique, increasing id (assigned by logPerf) */
  id?: number
  /** visualType */
  type?: string
  /** header-only entry without a visual (e.g. 'Recording started') */
  marker?: boolean
}

let nextPerfId = 1

export type PaneId = 'filters' | 'visualizations' | 'data' | 'selection' | 'bookmarks' | 'syncSlicers' | 'performance'

export const PANE_ORDER: PaneId[] = ['filters', 'visualizations', 'data', 'bookmarks', 'selection', 'syncSlicers', 'performance']

export interface PaneState {
  open: boolean
  /** PBI lets Filters / Visualizations / Data collapse into a thin vertical strip */
  collapsed: boolean
  width: number
}

export type BackstagePage = 'home' | 'new' | 'open' | 'save' | 'saveAs' | 'export' | 'options' | 'about'

export type DialogId =
  | { id: 'getData'; source?: string }
  | { id: 'enterData' }
  | { id: 'customizeTheme' }
  | { id: 'options'; section?: string }
  | { id: 'about' }
  | { id: 'refresh'; tables?: string[] }
  | { id: 'unsaved' }
  | { id: 'pageSettings' }
  /** Power Query data source settings (credentials, privacy) — connectors lane dialog */
  | { id: 'dataSources' }

export interface DataNotice {
  kind: 'noData' | 'refreshErrors' | 'engine'
  tables: string[]
  message?: string
}

export interface UserOptions {
  locale: string
  defaultTheme: string
  /** Options ▸ Data load */
  autoDetectRelationships: boolean
  autoDateTime: boolean
  /** On open: what to do when import tables have no data */
  onMissingData: 'ask' | 'synthetic' | 'refresh'
  syntheticSeed: number
  syntheticFactRows: number
  /**
   * Sample data may contain the names / ids that formulas and report filters mention (`customer = "…"`).
   * Off by default: sample data is meant to be shown to others, so those real values are never copied.
   */
  syntheticReuseIdentifying: boolean
  sqlAuth: 'azure-default' | 'azure-cli' | 'device-code' | 'interactive' | 'sql'
  sqlTenantId: string
  /** Report settings */
  showStartScreen: boolean
  autoRecovery: boolean
}

const OPTIONS_KEY = 'lumen.options'

export const DEFAULT_OPTIONS: UserOptions = {
  locale: 'en-US',
  defaultTheme: 'Default',
  autoDetectRelationships: true,
  autoDateTime: false,
  onMissingData: 'ask',
  syntheticSeed: 42,
  syntheticFactRows: 5000,
  syntheticReuseIdentifying: false,
  sqlAuth: 'azure-default',
  sqlTenantId: '',
  showStartScreen: true,
  autoRecovery: false
}

function loadOptions(): UserOptions {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY)
    return raw ? { ...DEFAULT_OPTIONS, ...JSON.parse(raw) } : DEFAULT_OPTIONS
  } catch {
    return DEFAULT_OPTIONS
  }
}

function loadPanes(): Record<PaneId, PaneState> {
  const def: Record<PaneId, PaneState> = {
    filters: { open: true, collapsed: false, width: 220 },
    visualizations: { open: true, collapsed: false, width: 244 },
    data: { open: true, collapsed: false, width: 240 },
    selection: { open: false, collapsed: false, width: 240 },
    bookmarks: { open: false, collapsed: false, width: 240 },
    syncSlicers: { open: false, collapsed: false, width: 240 },
    performance: { open: false, collapsed: false, width: 320 }
  }
  try {
    const saved = JSON.parse(localStorage.getItem('lumen.panes') ?? 'null')
    if (saved && typeof saved === 'object') for (const k of PANE_ORDER) if (saved[k]) def[k] = { ...def[k], ...saved[k] }
  } catch {
    /* defaults */
  }
  return def
}

export interface ShellState {
  backstage: BackstagePage | null
  ribbonTab: string
  ribbonCollapsed: boolean
  panes: Record<PaneId, PaneState>
  dialog: DialogId | null
  dataNotice: DataNotice | null
  options: UserOptions
  /** Visualizations pane sub-tab */
  vizTab: 'build' | 'format' | 'analytics'
  /** Format pane sub-tab */
  formatTab: 'visual' | 'general'
  /** the start screen (welcome dialog) is visible */
  startScreen: boolean
  /** Performance analyzer recording */
  perfRecording: boolean
  perfLog: PerfEntry[]

  openBackstage(page?: BackstagePage | null): void
  setRibbonTab(tab: string): void
  toggleRibbon(): void
  setPane(id: PaneId, patch: Partial<PaneState>): void
  togglePane(id: PaneId): void
  openDialog(d: DialogId | null): void
  setDataNotice(n: DataNotice | null): void
  setOptions(patch: Partial<UserOptions>): void
  setVizTab(t: ShellState['vizTab']): void
  setFormatTab(t: ShellState['formatTab']): void
  setStartScreen(v: boolean): void
  setPerfRecording(v: boolean): void
  logPerf(entry: Omit<PerfEntry, 'at' | 'id'>): void
  clearPerf(): void
}

export const useShell = create<ShellState>()((set, get) => ({
  backstage: null,
  ribbonTab: 'home',
  ribbonCollapsed: false,
  panes: loadPanes(),
  dialog: null,
  dataNotice: null,
  options: loadOptions(),
  vizTab: 'build',
  formatTab: 'visual',
  startScreen: false,
  perfRecording: false,
  perfLog: [],

  openBackstage: (page = 'home') => set({ backstage: page }),
  setRibbonTab: (ribbonTab) => set({ ribbonTab, ...(get().ribbonCollapsed ? {} : {}) }),
  toggleRibbon: () => set({ ribbonCollapsed: !get().ribbonCollapsed }),
  setPane(id, patch) {
    const panes = { ...get().panes, [id]: { ...get().panes[id], ...patch } }
    set({ panes })
    try {
      localStorage.setItem('lumen.panes', JSON.stringify(panes))
    } catch {
      /* ignore */
    }
  },
  togglePane(id) {
    const p = get().panes[id]
    get().setPane(id, p.open && !p.collapsed ? { open: false } : { open: true, collapsed: false })
  },
  openDialog: (dialog) => set({ dialog }),
  setDataNotice: (dataNotice) => set({ dataNotice }),
  setOptions(patch) {
    const options = { ...get().options, ...patch }
    set({ options })
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(options))
    } catch {
      /* ignore */
    }
  },
  setVizTab: (vizTab) => set({ vizTab }),
  setFormatTab: (formatTab) => set({ formatTab }),
  setStartScreen: (startScreen) => set({ startScreen }),
  setPerfRecording: (perfRecording) => set({ perfRecording }),
  logPerf: (entry) => get().perfRecording && set({ perfLog: [...get().perfLog.slice(-499), { ...entry, at: Date.now(), id: nextPerfId++ }] }),
  clearPerf: () => set({ perfLog: [] })
}))
