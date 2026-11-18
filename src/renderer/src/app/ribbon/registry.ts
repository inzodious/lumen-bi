/**
 * Ribbon tab registry. Standard tabs (Home, Insert, Modeling, View, Optimize, Help) and contextual
 * tabs (Format, Data / Drill, Table tools, Column tools, Measure tools…) are all registered here.
 *
 * Other workstreams contribute contextual tabs at module load time:
 *
 *   import { registerRibbonTab } from '@renderer/app/ribbon/registry'
 *   import { RibbonGroup, RibbonButton } from '@renderer/app/ribbon/Ribbon'
 *   registerRibbonTab({
 *     id: 'columnTools', label: 'Column tools', contextual: true, views: ['report', 'data', 'model'],
 *     visible: (s) => s.selectedField?.kind === 'column', autoSelect: true, order: 200,
 *     render: () => <ColumnToolsTab />
 *   })
 *
 * The module that registers must be imported somewhere (e.g. by the view that owns it).
 */
import type { ReactNode } from 'react'
import { create } from 'zustand'
import type { AppState, AppView } from '../../state/store'

export interface RibbonTabDef {
  id: string
  label: string
  /** contextual tabs render after the standard ones, in the contextual accent color */
  contextual?: boolean
  /** sort key: standard tabs use 10..70, contextual 100+ */
  order?: number
  /** views in which the tab exists (default: ['report']) */
  views?: AppView[]
  /** extra visibility predicate (e.g. a visual/column is selected) */
  visible?(app: AppState): boolean
  /** select this tab automatically when it becomes visible */
  autoSelect?: boolean
  render(): ReactNode
}

interface RibbonRegistryState {
  tabs: RibbonTabDef[]
  register(def: RibbonTabDef): () => void
}

export const useRibbonRegistry = create<RibbonRegistryState>((set, get) => ({
  tabs: [],
  register(def) {
    set({ tabs: [...get().tabs.filter((t) => t.id !== def.id), def].sort((a, b) => (a.order ?? 50) - (b.order ?? 50)) })
    return () => set({ tabs: get().tabs.filter((t) => t !== def) })
  }
}))

/** Register (or replace, by id) a ribbon tab. Returns an unregister function. */
export function registerRibbonTab(def: RibbonTabDef): () => void {
  return useRibbonRegistry.getState().register(def)
}

export function visibleTabs(tabs: RibbonTabDef[], app: AppState): RibbonTabDef[] {
  return tabs.filter((t) => (t.views ?? ['report']).includes(app.view) && (t.visible ? t.visible(app) : true))
}
