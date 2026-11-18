/**
 * Visualizations pane (PBI Desktop 2023+ layout): three icon tabs — Build visual, Format visual
 * (or Format page when nothing is selected), Analytics — above the gallery / wells / format cards.
 */
import type { ReactElement } from 'react'
import { DataBarVerticalAdd20Regular, PaintBrush20Regular, DataTrending20Regular } from '@fluentui/react-icons'
import { useApp } from '../../state/store'
import { useShell } from '../../app/shellState'
import { useMobileLayout } from '../../report/mobile/state'
import { findPage, findVisual, visualTypeOf } from '../../report/pbir'
import { PaneFrame } from '../PaneFrame'
import { Tip, cx } from '../../app/ui'
import { BuildTab } from './BuildTab'
import { FormatTab } from './FormatTab'
import { AnalyticsTab } from './AnalyticsTab'
import { supportsAnalytics } from './catalog'
import './visualizations.css'

export function VisualizationsPane() {
  const tab = useShell((s) => s.vizTab)
  const setTab = useShell((s) => s.setVizTab)
  const project = useApp((s) => s.project)
  const activePage = useApp((s) => s.activePage)
  const desktopSelected = useApp((s) => s.selectedVisuals)
  // View ▸ Mobile layout: the pane follows the phone-canvas selection (mobile-only formatting; no analytics there)
  const mobileOn = useMobileLayout((s) => s.on)
  const mobileSelected = useMobileLayout((s) => s.selected)
  const selected = mobileOn ? mobileSelected : desktopSelected
  const page = findPage(project?.report, activePage)
  const visual = selected.length === 1 ? findVisual(page, selected[0]) : undefined
  const analyticsOk = !mobileOn && !!visual && supportsAnalytics(visualTypeOf(visual))
  const tabs: Array<{ key: typeof tab; label: string; icon: ReactElement; disabled?: boolean }> = [
    { key: 'build', label: 'Build visual', icon: <DataBarVerticalAdd20Regular /> },
    { key: 'format', label: visual ? 'Format visual' : selected.length > 1 ? 'Format' : 'Format page', icon: <PaintBrush20Regular />, disabled: selected.length > 1 },
    { key: 'analytics', label: 'Add further analyses to your visual', icon: <DataTrending20Regular />, disabled: !analyticsOk }
  ]
  const effective = tabs.find((t) => t.key === tab && !t.disabled) ? tab : 'build'
  return (
    <PaneFrame id="visualizations" title="Visualizations" collapsible>
      <div className="wbi-viz__tabs" role="tablist">
        {tabs.map((t) => (
          <Tip key={t.key} title={t.label}>
            <button type="button" role="tab" aria-label={t.label} aria-selected={effective === t.key} disabled={t.disabled} className={cx('wbi-viz__tab', effective === t.key && 'is-active')} onClick={() => setTab(t.key)}>
              {t.icon}
            </button>
          </Tip>
        ))}
      </div>
      <div className="wbi-viz__body">
        {effective === 'build' && <BuildTab />}
        {effective === 'format' && <FormatTab />}
        {effective === 'analytics' && <AnalyticsTab />}
      </div>
    </PaneFrame>
  )
}
