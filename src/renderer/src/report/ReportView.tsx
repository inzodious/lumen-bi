/**
 * Report view (main area when view === 'report'): canvas with the active page (FitToPage / FitToWidth /
 * ActualSize + zoom), wallpaper (page `outspace`), page tabs, focus mode / show as table, tooltips,
 * context menus, keyboard shortcuts, and headless readiness (`document.body.dataset.wbiReady`).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import '../visuals'
import './report.css'
import { useApp, type PageViewMode } from '../state/store'
import { useInteraction } from '../state/interaction'
import type { PageDocument, ReportDocument } from '@core/report/types'
import { decodeValue } from '@core/report/props'
import { withTransparency } from '@core/report/theme'
import { FocusBar, PageCanvas, flatBackgroundStyle, pageBackgroundStyle } from './PageCanvas'
import { PageTabs } from './PageTabs'
import { ContextMenuLayer, TooltipLayer } from './Overlays'
import { handleCanvasKey } from './commands'
import { findPage, orderedPages, pageInfo } from './pbir'
import { navigatePage } from './runtime'
import { canSignalReady } from '../app/readiness'
import { LayoutSwitcher, MobileLayoutView, isMobileLayoutOn, useMobileLayout, useMobileRouteParam } from './mobile'

const MARGIN = 16

export function setReady(on: boolean): void {
  if (typeof document !== 'undefined') document.body.dataset.wbiReady = on ? '1' : '0'
}

/** Scale for a page in a viewport. */
export function computeScale(mode: PageViewMode, page: { width: number; height: number }, viewport: { width: number; height: number }, margin = MARGIN): number {
  const aw = Math.max(50, viewport.width - margin * 2)
  const ah = Math.max(50, viewport.height - margin * 2)
  if (mode === 'actualSize') return 1
  if (mode === 'fitToWidth') return aw / page.width
  return Math.min(aw / page.width, ah / page.height)
}

function displayOptionMode(page: PageDocument | undefined): PageViewMode {
  const d = page?.json?.displayOption
  if (d === 'FitToWidth' || d === 1) return 'fitToWidth'
  if (d === 'ActualSize' || d === 2) return 'actualSize'
  return 'fitToPage'
}

/** Wallpaper (page `outspace` object): explicit wallpaper color/image fills the area around and under the page. */
function wallpaper(report: ReportDocument, page: PageDocument | undefined, theme: ReturnType<typeof useApp.getState>['theme']): { style: CSSProperties; explicit: boolean } {
  const entries = page?.json?.objects?.outspace
  if (!page || !entries?.length) return { style: { background: '#EAEAEA' }, explicit: false }
  const st = pageBackgroundStyle(report, page, theme, 'outspace')
  const props = entries[0]?.properties ?? {}
  const color = decodeValue(props.color, theme)
  const transparency = Number(decodeValue(props.transparency, theme) ?? 0)
  return { style: { ...flatBackgroundStyle(st), backgroundColor: typeof color === 'string' ? withTransparency(color, transparency) : '#FFFFFF' }, explicit: true }
}

/** Page format ▸ Canvas settings ▸ Vertical alignment (`page.objects.displayArea.verticalAlignment`): 'Top' | 'Middle'. */
export function pageVerticalAlignment(page: PageDocument | undefined): 'Top' | 'Middle' {
  const raw = page?.json?.objects?.displayArea?.find?.((e: any) => !e.selector)?.properties?.verticalAlignment
  const v = String(decodeValue(raw, useApp.getState().theme) ?? 'Top').replace(/'/g, '')
  return v.toLowerCase() === 'middle' ? 'Middle' : 'Top'
}

export interface ReportViewProps {
  /** render the built-in page tabs bar (set false when the shell renders its own) */
  showTabs?: boolean
}

export function ReportView({ showTabs = true }: ReportViewProps = {}) {
  const project = useApp((s) => s.project)
  const report = project?.report
  const activePage = useApp((s) => s.activePage)
  const editMode = useApp((s) => s.editMode)
  const pageView = useApp((s) => s.pageView)
  const zoom = useApp((s) => s.zoom)
  const theme = useApp((s) => s.theme)
  const view = useApp((s) => s.view)
  const focus = useInteraction((s) => s.focus)
  const mobileOn = useMobileLayout((s) => s.on)
  useMobileRouteParam()
  const page = findPage(report, activePage) ?? (report ? orderedPages(report)[0] : undefined)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => setViewport((v) => (v.width === el.clientWidth && v.height === el.clientHeight ? v : { width: el.clientWidth, height: el.clientHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [report, page?.name, mobileOn])

  const info = page ? pageInfo(page) : undefined
  const vAlign = pageVerticalAlignment(page)
  const mode = pageView ?? displayOptionMode(page)
  const scale = info && viewport.width ? (zoom ?? computeScale(mode, info, viewport)) : 0
  useEffect(() => {
    if (scale > 0) useApp.getState().setCanvasScale(scale)
  }, [scale])

  // readiness: reset on page change, set by the canvas once visuals rendered. A layout effect: it must run before the
  // canvas's passive effects, which signal ready synchronously on mount for a page without visuals (else this reset
  // would come last and an empty page would never be ready).
  useLayoutEffect(() => {
    setReady(false)
  }, [page?.name, project?.id])
  useEffect(() => {
    // "nothing to render" is only ready when no open/launch is in flight (else captures fire mid-load)
    if ((!project || !report || !page) && canSignalReady()) setReady(true)
  }, [project, report, page])
  const onReady = useCallback(() => setReady(true), [])

  // keyboard shortcuts (edit mode)
  useEffect(() => {
    if (view !== 'report') return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const it = useInteraction.getState()
      if (e.key === 'Escape') {
        if (it.contextMenu) return it.setContextMenu(null)
        if (it.focus) return it.setFocus(null)
        if (it.spotlight) return it.setSpotlight(null)
      }
      const app = useApp.getState()
      // Ctrl+PageDown / Ctrl+PageUp: next / previous page (visible pages in reading view)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'PageDown' || e.key === 'PageUp') && app.project?.report) {
        const pages = orderedPages(app.project.report).filter((p) => app.editMode || pageInfo(p).hidden !== true)
        const i = pages.findIndex((p) => p.name === app.activePage)
        const next = pages[i + (e.key === 'PageDown' ? 1 : -1)]
        if (next) {
          e.preventDefault()
          navigatePage(next.name)
        }
        return
      }
      // Alt+Shift+F11 (PBI): show the selected visual's data as a table
      if (e.altKey && e.shiftKey && e.key === 'F11' && app.activePage && app.selectedVisuals.length === 1) {
        e.preventDefault()
        it.setFocus({ page: app.activePage, visual: app.selectedVisuals[0], mode: 'table' })
        return
      }
      if (!app.editMode) return
      if (isMobileLayoutOn()) return // the phone layout editor handles its own keys
      if (handleCanvasKey(e)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view])

  // hide tooltip when the pointer leaves the canvas / on scroll
  const clearTooltip = () => useInteraction.getState().tooltip && useInteraction.getState().setTooltip(null)

  const wp = useMemo(() => (report ? wallpaper(report, page, theme) : { style: {}, explicit: false }), [report, page, theme])

  if (!project) return <EmptyState title="No report open" detail="Open a .pbix, .pbit or PBIP project to see its report pages." />
  if (!report) return <EmptyState title="This project has no report" detail="Only a semantic model was opened. Use the Data, Model or DAX query views." />
  if (!page || !info) return <EmptyState title="This report has no pages" />
  if (mobileOn)
    return (
      <div className="wbi-report">
        <MobileLayoutView report={report} page={page} />
        {showTabs ? <PageTabs report={report} editing={editMode} /> : null}
        <LayoutSwitcher />
      </div>
    )

  const focused = focus && focus.page === page.name ? focus : null
  const editing = editMode && !focused

  return (
    <div className="wbi-report">
      <div
        className="wbi-viewport"
        ref={viewportRef}
        style={wp.style}
        onPointerLeave={clearTooltip}
        onScroll={clearTooltip}
        onPointerDown={(e) => {
          // clicking the gray area around the page (viewport, centering wrapper, page shadow) deselects, like PBI
          if (editMode && !(e.target as HTMLElement).closest('.wbi-page, .wbi-focus-wrap')) useApp.getState().selectVisuals([])
        }}
      >
        {focused ? (
          <div className="wbi-focus-wrap">
            <FocusBar onBack={() => useInteraction.getState().setFocus(null)} />
            <div className="wbi-focus-area">
              <PageCanvas
                key={`${project?.id}:${page.name}:focus`}
                report={report}
                page={page}
                scale={1}
                mode={editMode ? 'edit' : 'view'}
                interactive
                editing={false}
                focus={focused}
                focusSize={{ width: Math.max(100, viewport.width - 32), height: Math.max(100, viewport.height - 60) }}
                onReady={onReady}
              />
            </div>
          </div>
        ) : scale > 0 ? (
          <div
            className="wbi-canvas-center"
            style={{
              minWidth: info.width * scale + MARGIN * 2,
              // Canvas settings ▸ Vertical alignment: Middle centers the page in the view when there is room
              minHeight: vAlign === 'Middle' ? Math.max(viewport.height, info.height * scale + MARGIN * 2) : info.height * scale + MARGIN * 2,
              alignItems: vAlign === 'Middle' ? 'center' : undefined,
              padding: MARGIN
            }}
          >
            <div className="wbi-page-shadow">
              <PageCanvas
                // keyed by project too: reopening a file whose pages have the same names must remount the canvas
                // (fresh visual state + readiness re-signalled for the new document)
                key={`${project?.id}:${page.name}`}
                report={report}
                page={page}
                scale={scale}
                mode={editMode ? 'edit' : 'view'}
                interactive
                editing={editing}
                onReady={onReady}
                underlay={wp.explicit ? 'transparent' : '#FFFFFF'}
              />
            </div>
          </div>
        ) : null}
      </div>
      {showTabs ? <PageTabs report={report} editing={editMode} /> : null}
      <LayoutSwitcher />
      <TooltipLayer />
      <ContextMenuLayer editing={editMode} />
    </div>
  )
}

function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="wbi-report-empty">
      <div className="wbi-report-empty-title">{title}</div>
      {detail ? <div className="wbi-report-empty-detail">{detail}</div> : null}
    </div>
  )
}
