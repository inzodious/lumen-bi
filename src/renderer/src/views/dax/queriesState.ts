/**
 * DAX query view tabs (kept across view switches). Queries round-trip as PBIP
 * `DAXQueries/<name>.dax` sidecar files of the semantic model, like Power BI Desktop saves them.
 */
import { create } from 'zustand'
import type { DaxQueryResultTable } from '@core/engine/api'

export interface QueryRun {
  tables: DaxQueryResultTable[]
  durationMs: number
  at: number
}

export interface QueryError {
  message: string
  line?: number
  col?: number
}

export interface QueryTab {
  id: number
  name: string
  text: string
  result?: QueryRun
  error?: QueryError
  activeResult: number
  running?: boolean
}

export interface HistoryEntry {
  text: string
  at: number
  ok: boolean
  rows?: number
  durationMs?: number
}

interface DaxQueriesState {
  projectId: string | null
  tabs: QueryTab[]
  active: number
  history: HistoryEntry[]
  init(projectId: string | null, files: Record<string, string> | undefined): void
  setActive(id: number): void
  update(id: number, patch: Partial<QueryTab>): void
  add(text?: string, name?: string): number
  close(id: number): void
  rename(id: number, name: string): void
  pushHistory(e: HistoryEntry): void
}

let nextId = 1
export const QUERY_DIR = 'DAXQueries/'

export const useDaxQueries = create<DaxQueriesState>((set, get) => ({
  projectId: null,
  tabs: [],
  active: 0,
  history: [],
  init(projectId, files) {
    if (get().projectId === projectId && get().tabs.length) return
    const tabs: QueryTab[] = Object.entries(files ?? {})
      .filter(([k]) => k.startsWith(QUERY_DIR) && k.endsWith('.dax'))
      .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
      .map(([k, text]) => ({ id: nextId++, name: k.slice(QUERY_DIR.length, -4), text, activeResult: 0 }))
    if (!tabs.length) tabs.push({ id: nextId++, name: 'Query 1', text: '', activeResult: 0 })
    set({ projectId, tabs, active: tabs[0].id, history: [] })
  },
  setActive: (active) => set({ active }),
  update: (id, patch) => set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
  add(text = '', name) {
    const taken = new Set(get().tabs.map((t) => t.name.toLowerCase()))
    let n = get().tabs.length + 1
    while (taken.has(`query ${n}`)) n++
    const tab: QueryTab = { id: nextId++, name: name ?? `Query ${n}`, text, activeResult: 0 }
    set({ tabs: [...get().tabs, tab], active: tab.id })
    return tab.id
  },
  close(id) {
    const tabs = get().tabs.filter((t) => t.id !== id)
    if (!tabs.length) tabs.push({ id: nextId++, name: 'Query 1', text: '', activeResult: 0 })
    const idx = get().tabs.findIndex((t) => t.id === id)
    set({ tabs, active: get().active === id ? tabs[Math.max(0, idx - 1)].id : get().active })
  },
  rename: (id, name) => set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, name } : t)) }),
  pushHistory: (e) => set({ history: [e, ...get().history].slice(0, 100) })
}))

/** Parse "line:col" / "line X, column Y" positions out of engine error messages. */
export function errorPosition(message: string): { line: number; col: number } | null {
  const m = /(?:at |\()(\d+):(\d+)/.exec(message) ?? /line (\d+),? col(?:umn)? (\d+)/i.exec(message)
  return m ? { line: Number(m[1]), col: Number(m[2]) } : null
}
