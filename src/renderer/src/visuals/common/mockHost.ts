/**
 * A standalone VisualHostContext for unit tests and the dev gallery (no report canvas needed).
 * State (slicer filter, selection, drill, visual JSON mutations) lives in a plain object; pass
 * `onChange` to re-render when a visual updates it.
 */
import type { QueryEngine } from '@core/engine/api'
import type { DataPointIdentity, SQFilter } from '@core/report/sq'
import { resolveTheme, type ResolvedTheme } from '@core/report/theme'
import type { DrillState, ReportInfo, VisualActions, VisualHostContext } from '../contract'

export interface MockHostState {
  slicerFilter?: SQFilter
  selection: DataPointIdentity[]
  drill: DrillState
  log: string[]
}

export interface MockHostOptions {
  engine: QueryEngine
  theme?: ResolvedTheme
  visualJson?: any
  filters?: SQFilter[]
  mode?: 'view' | 'edit'
  state?: MockHostState
  report?: Partial<ReportInfo>
  onChange?: () => void
}

export function createMockState(init: Partial<MockHostState> = {}): MockHostState {
  return { selection: [], drill: { level: 0, path: [] }, log: [], ...init }
}

export function createMockHost(opts: MockHostOptions): VisualHostContext {
  const state = opts.state ?? createMockState()
  const changed = () => opts.onChange?.()
  const actions: VisualActions = {
    navigatePage: (p) => state.log.push(`navigate:${p}`),
    applyBookmark: (b) => state.log.push(`bookmark:${b}`),
    back: () => state.log.push('back'),
    drillthrough: (p) => state.log.push(`drillthrough:${p}`),
    openUrl: (u) => state.log.push(`url:${u}`),
    clearAllSlicers: () => state.log.push('clearAllSlicers')
  }
  const report: ReportInfo = {
    pages: [
      { name: 'p1', displayName: 'Overview', hidden: false },
      { name: 'p2', displayName: 'Sales detail', hidden: false },
      { name: 'p3', displayName: 'Customers', hidden: false },
      { name: 'p4', displayName: 'Hidden page', hidden: true }
    ],
    activePage: 'p1',
    bookmarks: [
      { name: 'b1', displayName: 'Default view' },
      { name: 'b2', displayName: 'Top regions' }
    ],
    resolveImage: () => undefined,
    ...opts.report
  }
  return {
    engine: opts.engine,
    theme: opts.theme ?? resolveTheme(),
    format: (v, f, t) => opts.engine.format(v, f, t),
    locale: 'en-US',
    mode: opts.mode ?? 'view',
    filters: opts.filters ?? [],
    selection: state.selection,
    select(ids) {
      state.selection = ids
      changed()
    },
    setSlicerFilter(filter) {
      state.slicerFilter = filter
      state.log.push(`slicer:${filter ? JSON.stringify(filter.Where) : 'clear'}`)
      changed()
    },
    get slicerFilter() {
      return state.slicerFilter
    },
    drill: state.drill,
    setDrill(next) {
      state.drill = next
      changed()
    },
    showTooltip: () => {},
    showContextMenu: () => {},
    actions,
    report,
    updateVisual(mutator) {
      if (opts.visualJson) mutator(opts.visualJson)
      changed()
    }
  }
}
