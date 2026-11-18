/**
 * Mobile layout (View ▸ Mobile layout): public surface for the report view and the ribbon.
 */
import { useEffect } from 'react'
import { PhoneRegular, DesktopRegular } from '@fluentui/react-icons'
import { useApp } from '../../state/store'
import { RibbonButton, RibbonGroup } from '../../app/ribbon/Ribbon'
import { findPage } from '../pbir'
import { autoCreateMobile } from './layout'
import { useMobileLayout } from './state'

export { MobileLayoutView } from './MobileLayoutView'
export { useMobileLayout, isMobileLayoutOn } from './state'
export * as mobileLayout from './layout'

/** View ribbon ▸ "Mobile" group (PBI: View ▸ Mobile ▸ Mobile layout). */
export function MobileRibbonGroup() {
  const on = useMobileLayout((s) => s.on)
  const hasReport = useApp((s) => !!s.project?.report)
  return (
    <RibbonGroup label="Mobile">
      <RibbonButton
        label="Mobile layout"
        icon={<PhoneRegular fontSize={32} />}
        checked={on}
        disabled={!hasReport}
        onClick={() => useMobileLayout.getState().toggle()}
        tooltip="Create a mobile-optimized layout of the current page for phones in portrait orientation."
      />
    </RibbonGroup>
  )
}

/** Small web / mobile layout switcher (PBI shows it at the bottom of the page). */
export function LayoutSwitcher() {
  const on = useMobileLayout((s) => s.on)
  const setOn = useMobileLayout((s) => s.setOn)
  return (
    <div className="wbi-layoutswitch" role="radiogroup" aria-label="Layout">
      <button type="button" role="radio" aria-checked={!on} title="Web layout" className={!on ? 'is-on' : undefined} onClick={() => setOn(false)}>
        <DesktopRegular />
      </button>
      <button type="button" role="radio" aria-checked={on} title="Mobile layout" className={on ? 'is-on' : undefined} onClick={() => setOn(true)}>
        <PhoneRegular />
      </button>
    </div>
  )
}

let routeApplied = false

/**
 * Deep link / headless capture: `#/?…&mobile=1` opens the mobile layout; `mobile=auto` also runs
 * Auto-create on the active page (undoable). Applied once, after a report is loaded.
 */
export function useMobileRouteParam(): void {
  const hasReport = useApp((s) => !!s.project?.report)
  useEffect(() => {
    if (routeApplied || !hasReport) return
    const q = window.location.hash.split('?')[1] ?? ''
    const v = new URLSearchParams(q).get('mobile')
    routeApplied = true
    if (!v || v === '0') return
    useMobileLayout.getState().setOn(true)
    if (v === 'auto') {
      // launch applies `page=` synchronously after loading, before React commits, so activePage is final here
      const s = useApp.getState()
      const page = findPage(s.project?.report, s.activePage)
      if (!page) return
      s.mutateReport('Auto-create mobile layout', (draft) => {
        const p = findPage(draft, page.name)
        if (p) autoCreateMobile(p)
      })
    }
  }, [hasReport])
}
