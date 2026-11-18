/**
 * Right-hand pane area: the open panes side by side (PBI order: Filters, Visualizations, Data,
 * then Bookmarks / Selection / Sync slicers / Performance analyzer) plus the pane switcher strip
 * on the far right. Which panes exist depends on the view (Table / Model views show only Data).
 */
import type { ReactElement } from 'react'
import { Filter20Regular, DataBarVerticalAdd20Regular, Database20Regular, Bookmark20Regular, Layer20Regular, ArrowSync20Regular, Timer20Regular } from '@fluentui/react-icons'
import { useApp } from '../state/store'
import { useShell, type PaneId } from '../app/shellState'
import { Tip } from '../app/ui/Tooltip'
import { cx } from '../app/ui/cx'
import { FiltersPane } from './filters/FiltersPane'
import { VisualizationsPane } from './visualizations/VisualizationsPane'
import { DataPane } from './data/DataPane'
import { SelectionPane } from './selection/SelectionPane'
import { BookmarksPane } from './bookmarks/BookmarksPane'
import { SyncSlicersPane } from './syncslicers/SyncSlicersPane'
import { PerformancePane } from './performance/PerformancePane'

const SWITCHER: Array<{ id: PaneId; label: string; icon: ReactElement }> = [
  { id: 'filters', label: 'Filters', icon: <Filter20Regular /> },
  { id: 'visualizations', label: 'Visualizations', icon: <DataBarVerticalAdd20Regular /> },
  { id: 'data', label: 'Data', icon: <Database20Regular /> },
  { id: 'bookmarks', label: 'Bookmarks', icon: <Bookmark20Regular /> },
  { id: 'selection', label: 'Selection', icon: <Layer20Regular /> },
  { id: 'syncSlicers', label: 'Sync slicers', icon: <ArrowSync20Regular /> },
  { id: 'performance', label: 'Performance analyzer', icon: <Timer20Regular /> }
]

const PANES: Record<PaneId, () => ReactElement | null> = {
  filters: FiltersPane,
  visualizations: VisualizationsPane,
  data: DataPane,
  bookmarks: BookmarksPane,
  selection: SelectionPane,
  syncSlicers: SyncSlicersPane,
  performance: PerformancePane
}

/** Panes in display order (left → right). Secondary panes sit left of Filters like PBI. */
const DISPLAY_ORDER: PaneId[] = ['bookmarks', 'selection', 'syncSlicers', 'performance', 'filters', 'visualizations', 'data']

export function PaneHost() {
  const view = useApp((s) => s.view)
  const hasProject = useApp((s) => !!s.project)
  const panes = useShell((s) => s.panes)
  const togglePane = useShell((s) => s.togglePane)
  if (!hasProject) return null
  const allowed: PaneId[] = view === 'report' ? DISPLAY_ORDER : view === 'data' || view === 'model' ? ['data'] : []
  if (!allowed.length) return null
  return (
    <aside className="wbi-panehost">
      <div className="wbi-panehost__panes">
        {allowed.map((id) => {
          const P = PANES[id]
          return panes[id].open ? <P key={id} /> : null
        })}
      </div>
      {view === 'report' && (
        <div className="wbi-paneswitch" role="toolbar" aria-label="Panes" aria-orientation="vertical">
          {SWITCHER.map((s) => {
            const st = panes[s.id]
            return (
              <Tip key={s.id} title={s.label} placement="left">
                <button type="button" aria-label={s.label} aria-pressed={st.open} className={cx('wbi-paneswitch__btn', st.open && 'is-on')} onClick={() => togglePane(s.id)}>
                  {s.icon}
                </button>
              </Tip>
            )
          })}
        </div>
      )}
    </aside>
  )
}
