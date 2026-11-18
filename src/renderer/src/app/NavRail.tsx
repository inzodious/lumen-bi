/**
 * Left view switcher (PBI Desktop): Report / Table / Model / DAX query, with the yellow active bar.
 */
import { DataBarVertical20Regular, DataBarVertical20Filled, Table20Regular, Table20Filled, Organization20Regular, Organization20Filled, DocumentTableSearch20Regular, DocumentTableSearch20Filled } from '@fluentui/react-icons'
import type { ReactElement } from 'react'
import { useApp, type AppView } from '../state/store'
import { Tip } from './ui/Tooltip'
import { cx } from './ui/cx'

const ITEMS: Array<{ view: AppView; label: string; icon: ReactElement; active: ReactElement; needsModel?: boolean }> = [
  { view: 'report', label: 'Report view', icon: <DataBarVertical20Regular />, active: <DataBarVertical20Filled /> },
  { view: 'data', label: 'Table view', icon: <Table20Regular />, active: <Table20Filled />, needsModel: true },
  { view: 'model', label: 'Model view', icon: <Organization20Regular />, active: <Organization20Filled />, needsModel: true },
  { view: 'dax', label: 'DAX query view', icon: <DocumentTableSearch20Regular />, active: <DocumentTableSearch20Filled />, needsModel: true }
]

export function NavRail() {
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const hasProject = useApp((s) => !!s.project)
  return (
    <nav className="wbi-navrail" aria-label="Views">
      {ITEMS.map((it) => (
        <Tip key={it.view} title={it.label} placement="right">
          <button
            type="button"
            aria-label={it.label}
            aria-current={view === it.view}
            disabled={!!it.needsModel && !hasProject}
            className={cx('wbi-navrail__btn', view === it.view && 'is-active')}
            onClick={() => setView(it.view)}
          >
            {view === it.view ? it.active : it.icon}
          </button>
        </Tip>
      ))}
    </nav>
  )
}
