/**
 * Shared chrome for the right-hand panes: header (title + actions + collapse »/close ×),
 * resize grip on the left edge, and the collapsed vertical strip (PBI "Filters" ‹‹ strip).
 */
import type { ReactNode } from 'react'
import { ChevronDoubleRightRegular, ChevronDoubleLeftRegular, DismissRegular } from '@fluentui/react-icons'
import { useShell, type PaneId } from '../app/shellState'
import { Tip } from '../app/ui/Tooltip'
import { cx } from '../app/ui/cx'

export interface PaneFrameProps {
  id: PaneId
  title: string
  /** collapsible panes shrink to a strip; others close */
  collapsible?: boolean
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** element under the header (search box, tabs) */
  subheader?: ReactNode
  /** extra content shown in the collapsed strip below the title (e.g. filter count) */
  collapsedExtra?: ReactNode
  /** render even when the pane was closed (Table / Model views always show the Data pane; it can only collapse there) */
  alwaysOpen?: boolean
  minWidth?: number
  maxWidth?: number
}

export function PaneFrame(p: PaneFrameProps) {
  const state = useShell((s) => s.panes[p.id])
  const setPane = useShell((s) => s.setPane)
  if (!state.open && !p.alwaysOpen) return null
  if (p.collapsible && state.collapsed) {
    return (
      <div className="wbi-pane wbi-pane--collapsed" data-pane={p.id}>
        <Tip title={`Expand ${p.title}`} placement="left">
          <button type="button" className="wbi-pane__expand" aria-label={`Expand ${p.title}`} onClick={() => setPane(p.id, { collapsed: false })}>
            <ChevronDoubleLeftRegular fontSize={14} />
          </button>
        </Tip>
        <button type="button" className="wbi-pane__vtitle" onClick={() => setPane(p.id, { collapsed: false })}>
          {p.title}
        </button>
        {p.collapsedExtra}
      </div>
    )
  }
  const min = p.minWidth ?? 180
  const max = p.maxWidth ?? 520
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = state.width
    const move = (ev: PointerEvent) => setPane(p.id, { width: Math.max(min, Math.min(max, w0 + (x0 - ev.clientX))) })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <section className={cx('wbi-pane', p.className)} style={{ width: state.width }} data-pane={p.id} aria-label={p.title}>
      <div className="wbi-pane__grip" onPointerDown={startResize} />
      <header className="wbi-pane__header">
        <h2 className="wbi-pane__title">{p.title}</h2>
        <div className="wbi-pane__actions">
          {p.actions}
          {p.collapsible ? (
            <Tip title={`Collapse the ${p.title} pane`}>
              <button type="button" className="wbi-btn wbi-btn--icon" aria-label={`Collapse ${p.title}`} onClick={() => setPane(p.id, { collapsed: true })}>
                <ChevronDoubleRightRegular fontSize={14} />
              </button>
            </Tip>
          ) : (
            <Tip title="Close">
              <button type="button" className="wbi-btn wbi-btn--icon" aria-label={`Close ${p.title}`} onClick={() => setPane(p.id, { open: false })}>
                <DismissRegular fontSize={14} />
              </button>
            </Tip>
          )}
        </div>
      </header>
      {p.subheader}
      <div className="wbi-pane__body">{p.children}</div>
    </section>
  )
}
