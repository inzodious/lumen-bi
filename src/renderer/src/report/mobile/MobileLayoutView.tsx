/**
 * View ▸ Mobile layout: phone emulator canvas + "Page visuals" pane (Power BI Desktop's mobile layout view).
 *
 *  - The phone canvas renders the visuals placed in the page's mobile layout (`mobile.json` positions,
 *    mobile formatting overrides applied) with the regular VisualContainer, so slicers / buttons stay
 *    interactive like PBI's interactive canvas. Tooltips are disabled (as in PBI).
 *  - Drag a visual from the Page visuals pane onto the canvas (or double-click it) to place it; move /
 *    resize with snap to the fine grid (Shift keeps the aspect ratio); X / Delete removes it from the
 *    phone layout only. Auto-create and "Remove all" (eraser) like PBI. All edits are undoable.
 *  - Canvas controls (bottom): gridlines, snap to grid, lock visuals.
 *
 * Approximations: mobile-only formatting overrides are rendered but edited through the desktop
 * Format pane (which writes visual.json); the auto-create engine is a simplified reading-order flow.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as RPointerEvent } from 'react'
import { DismissRegular, EraserRegular, EyeOffRegular, EyeRegular, GridRegular, LockClosedRegular, PhoneRegular, SparkleRegular, CheckmarkCircleFilled, GridDotsRegular } from '@fluentui/react-icons'
import type { PageDocument, ReportDocument, VisualDocument } from '@core/report/types'
import type { SQFilter } from '@core/report/sq'
import { useApp } from '../../state/store'
import { getVisual } from '../../visuals/registry'
import { showContextMenu, cx } from '../../app/ui'
import { CanvasEnvContext, type CanvasEnv } from '../canvasEnv'
import { resolveChrome } from '../chrome'
import { HANDLES, type Handle } from '../geometry'
import { usePageFilters } from '../pageFilters'
import { flatBackgroundStyle, pageBackgroundStyle } from '../PageCanvas'
import { findPage, isEffectivelyHidden, isGroup, visualTypeOf, type Rect } from '../pbir'
import { VisualContainer } from '../VisualContainer'
import {
  MOBILE_GRID_MAJOR,
  MOBILE_MIN_HEIGHT,
  MOBILE_WIDTH,
  addToMobile,
  autoCreateMobile,
  clearMobile,
  groupChildrenRects,
  isPlaced,
  mobileCanvasHeight,
  mobileRect,
  mobileVisualJson,
  moveMobileBy,
  moveMobileRect,
  pageVisualItems,
  placedVisuals,
  removeFromMobile,
  reorderMobile,
  resizeMobile,
  setMobileRects,
  snap
} from './layout'
import { useMobileLayout } from './state'
import './mobile.css'

const DRAG_MIME = 'application/x-wbi-mobile-visual'
const EMPTY: SQFilter[] = []
const READY_TIMEOUT_MS = 12000
/** width reserved for the phone screen's (thin, stable) scrollbar */
const SCROLLBAR = 8

function editPage(pageName: string, label: string, fn: (p: PageDocument) => void): void {
  useApp.getState().mutateReport(label, (draft) => {
    const p = findPage(draft, pageName)
    if (p) fn(p)
  })
}

/** Display name for the Page visuals pane: title text → group name → visual type name. */
export function visualLabel(v: VisualDocument): string {
  if (isGroup(v)) return String(v.json?.visualGroup?.displayName ?? 'Group')
  const theme = useApp.getState().theme
  try {
    const t = resolveChrome(v.json, theme).title
    if (t.text && !t.boundExpr) return t.text
  } catch {
    /* fall through */
  }
  const type = visualTypeOf(v)
  return getVisual(type)?.displayName ?? type
}

function setReadyFlag(on: boolean): void {
  document.body.dataset.wbiReady = on ? '1' : '0'
}

// ---------------------------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------------------------

export function MobileLayoutView({ report, page }: { report: ReportDocument; page: PageDocument }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageH, setStageH] = useState(0)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setStageH(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // phone screen = one MOBILE_MIN_HEIGHT screen; scale it to the available height (PBI's emulator scales too)
  const scale = stageH ? Math.max(0.6, Math.min(1.6, (stageH - 96) / MOBILE_MIN_HEIGHT)) : 0

  // keyboard: Delete removes from the phone layout, arrows nudge, Esc clears selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const st = useMobileLayout.getState()
      const sel = st.selected
      if (!sel.length) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        editPage(page.name, 'Remove from mobile layout', (p) => removeFromMobile(p, sel))
        st.select([])
      } else if (e.key === 'Escape') st.select([])
      else if (e.key.startsWith('Arrow') && !st.lock) {
        e.preventDefault()
        const step = e.shiftKey ? MOBILE_GRID_MAJOR : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        editPage(page.name, 'Move', (p) => moveMobileBy(p, sel, dx, dy))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [page.name])

  // drop selection of visuals that left the layout / page
  useEffect(() => {
    const st = useMobileLayout.getState()
    const keep = st.selected.filter((n) => isPlaced(page.visuals.find((v) => v.name === n)))
    if (keep.length !== st.selected.length) st.select(keep)
  }, [page])

  return (
    <div className="wbi-mobile">
      <div className="wbi-mobile__stage" ref={stageRef} onPointerDown={(e) => e.target === e.currentTarget && useMobileLayout.getState().select([])}>
        {scale > 0 && <Phone report={report} page={page} scale={scale} />}
      </div>
      <PageVisualsPane page={page} />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Phone canvas
// ---------------------------------------------------------------------------------------------

interface DragState {
  kind: 'move' | 'resize'
  startX: number
  startY: number
  moved: boolean
  start: Record<string, Rect>
  handle?: Handle
  pointerId: number
}

function Phone({ report, page, scale }: { report: ReportDocument; page: PageDocument; scale: number }) {
  const theme = useApp((s) => s.theme)
  const selected = useMobileLayout((s) => s.selected)
  const showGrid = useMobileLayout((s) => s.showGrid)
  const snapOn = useMobileLayout((s) => s.snapToGrid)
  const lock = useMobileLayout((s) => s.lock)
  const filters = usePageFilters(report, page)
  const placed = useMemo(() => placedVisuals(page), [page])
  const height = mobileCanvasHeight(page)
  const [preview, setPreviewState] = useState<Record<string, Rect> | null>(null)
  const previewRef = useRef<Record<string, Rect> | null>(null)
  const setPreview = (p: Record<string, Rect> | null) => {
    previewRef.current = p
    setPreviewState(p)
  }
  const [dropHint, setDropHint] = useState<Rect | null>(null)
  const drag = useRef<DragState | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const bg = useMemo(() => {
    return flatBackgroundStyle(pageBackgroundStyle(report, page, theme))
  }, [report, page, theme])

  // ---- readiness (headless captures) ------------------------------------------------------------
  const done = useRef(new Set<string>())
  const fired = useRef(false)
  const expected = useMemo(
    () => placed
        .filter((v) => !isEffectivelyHidden(page, v))
        .flatMap((v) => (isGroup(v) ? groupChildrenRects(page, v, { x: 0, y: 0, width: 1, height: 1 }).filter((c) => !isEffectivelyHidden(page, c.v)).map((c) => c.v.name) : [v.name])),
    [placed, page]
  )
  const check = useCallback(() => {
    if (fired.current) return
    if (expected.every((n) => done.current.has(n))) {
      fired.current = true
      requestAnimationFrame(() => requestAnimationFrame(() => fired.current && setReadyFlag(true)))
    }
  }, [expected])
  useEffect(() => {
    // the placed set changed (auto-create, drop, undo): not ready until the new visuals rendered
    if (!expected.every((n) => done.current.has(n))) {
      fired.current = false
      setReadyFlag(false)
    }
    check()
    const t = setTimeout(() => {
      if (!fired.current) {
        fired.current = true
        console.warn(`[mobile] readiness timeout: ${expected.filter((n) => !done.current.has(n)).length} visual(s) pending`)
        setReadyFlag(true)
      }
    }, READY_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [check, expected])
  const reportDone = useCallback(
    (name: string) => {
      done.current.add(name)
      check()
    },
    [check]
  )

  // ---- pointer interactions ----------------------------------------------------------------------
  const toCanvas = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale }
  }

  const onContainerPointerDown = useCallback(
    (e: RPointerEvent, name: string) => {
      if (e.button !== 0) return
      const st = useMobileLayout.getState()
      // a group child forwards its group (placed items are top level)
      const top = placed.find((v) => v.name === name) ? name : (placed.find((g) => isGroup(g) && groupChildrenRects(page, g, { x: 0, y: 0, width: 1, height: 1 }).some((c) => c.v.name === name))?.name ?? name)
      let sel = st.selected
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        sel = sel.includes(top) ? sel.filter((n) => n !== top) : [...sel, top]
        st.select(sel)
        return
      }
      if (!sel.includes(top)) {
        sel = [top]
        st.select(sel)
      }
      if (st.lock) return
      const start: Record<string, Rect> = {}
      for (const n of sel) {
        const r = mobileRect(page.visuals.find((v) => v.name === n))
        if (r) start[n] = { x: r.x, y: r.y, width: r.width, height: r.height }
      }
      drag.current = { kind: 'move', startX: e.clientX, startY: e.clientY, moved: false, start, pointerId: e.pointerId }
      try {
        canvasRef.current?.setPointerCapture(e.pointerId)
      } catch {
        /* element gone */
      }
    },
    [placed, page]
  )

  const onHandleDown = (e: RPointerEvent, name: string, handle: Handle) => {
    e.stopPropagation()
    e.preventDefault()
    const r = mobileRect(page.visuals.find((v) => v.name === name))
    if (!r) return
    drag.current = { kind: 'resize', startX: e.clientX, startY: e.clientY, moved: false, start: { [name]: { x: r.x, y: r.y, width: r.width, height: r.height } }, handle, pointerId: e.pointerId }
    try {
      canvasRef.current?.setPointerCapture(e.pointerId)
    } catch {
      /* element gone */
    }
  }

  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const dxs = e.clientX - d.startX
    const dys = e.clientY - d.startY
    if (!d.moved && Math.hypot(dxs, dys) < 4) return
    d.moved = true
    const dx = dxs / scale
    const dy = dys / scale
    const doSnap = snapOn && !e.altKey
    if (d.kind === 'move') {
      // move the selection as a block: snap the first item, apply its offset to the others
      const names = Object.keys(d.start)
      const lead = d.start[names[0]]
      const moved = moveMobileRect(lead, dx, dy, doSnap)
      const ox = moved.x - lead.x
      const oy = moved.y - lead.y
      const next: Record<string, Rect> = {}
      for (const n of names) next[n] = moveMobileRect(d.start[n], ox, oy, false)
      setPreview(next)
    } else if (d.handle) {
      const n = Object.keys(d.start)[0]
      setPreview({ [n]: resizeMobile(d.start[n], d.handle, dx, dy, e.shiftKey, doSnap) })
    }
  }

  const onPointerUp = (e: RPointerEvent) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    const p = previewRef.current
    if (d.moved) {
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation()
        ev.preventDefault()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 250)
    }
    if (d.moved && p) editPage(page.name, d.kind === 'move' ? 'Move' : 'Resize', (pg) => setMobileRects(pg, p, { snap: false }))
    setPreview(null)
  }

  // ---- drop from the Page visuals pane ----------------------------------------------------------
  const dropRect = (e: DragEvent, name: string): Rect | null => {
    const v = page.visuals.find((x) => x.name === name)
    if (!v) return null
    const r = mobileRect(v)
    const { x, y } = toCanvas(e.clientX, e.clientY)
    const size = r ? { width: r.width, height: r.height } : defaultSizeFor(page, v)
    return { x: Math.max(0, Math.min(MOBILE_WIDTH - size.width, snap(x - size.width / 2))), y: Math.max(0, snap(y - Math.min(size.height / 2, 20))), ...size }
  }
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const name = draggingName
    setDropHint(name ? dropRect(e, name) : null)
  }
  const onDrop = (e: DragEvent) => {
    const name = e.dataTransfer.getData(DRAG_MIME)
    setDropHint(null)
    if (!name) return
    e.preventDefault()
    const r = dropRect(e, name)
    if (!r) return
    const already = isPlaced(page.visuals.find((v) => v.name === name))
    editPage(page.name, already ? 'Move' : 'Add to mobile layout', (p) => {
      if (already) setMobileRects(p, { [name]: r })
      else addToMobile(p, name, { x: r.x, y: r.y }, { width: r.width, height: r.height })
    })
    useMobileLayout.getState().select([name])
  }

  const onContextMenuCapture = (e: React.MouseEvent) => {
    // replace the desktop visual context menu with the phone-layout one
    const el = (e.target as HTMLElement).closest('[data-mobile-item]') as HTMLElement | null
    e.preventDefault()
    e.stopPropagation()
    const name = el?.dataset.mobileItem
    if (!name) return
    const st = useMobileLayout.getState()
    const sel = st.selected.includes(name) ? st.selected : [name]
    st.select(sel)
    showContextMenu(e, [
      { label: 'Bring to front', onClick: () => editPage(page.name, 'Bring to front', (p) => reorderMobile(p, sel, 'front')) },
      { label: 'Send to back', onClick: () => editPage(page.name, 'Send to back', (p) => reorderMobile(p, sel, 'back')) },
      { separator: true },
      {
        label: sel.length > 1 ? 'Remove visuals from mobile layout' : 'Remove from mobile layout',
        shortcut: 'Del',
        onClick: () => {
          editPage(page.name, 'Remove from mobile layout', (p) => removeFromMobile(p, sel))
          st.select([])
        }
      }
    ])
  }

  const env: CanvasEnv = useMemo(
    () => ({
      report,
      page,
      pageName: page.name,
      mode: 'edit',
      interactive: true,
      editing: true,
      scale,
      headers: false,
      reportDone,
      onContainerPointerDown
    }),
    [report, page, scale, reportDone, onContainerPointerDown]
  )

  const rectOf = (v: VisualDocument): Rect => preview?.[v.name] ?? mobileRect(v)!
  const inv = 1 / scale
  const screenH = MOBILE_MIN_HEIGHT * scale

  return (
    <div className="wbi-mobile__phone" style={{ width: MOBILE_WIDTH * scale + SCROLLBAR + 24 }}>
      <div className="wbi-mobile__notch" />
      <div className="wbi-mobile__screen" style={{ width: MOBILE_WIDTH * scale + SCROLLBAR, height: screenH }}>
        <div className="wbi-mobile__canvas-outer" style={{ width: MOBILE_WIDTH * scale, height: height * scale }}>
          <CanvasEnvContext.Provider value={env}>
            <div
              ref={canvasRef}
              className="wbi-mobile__canvas"
              data-page={page.name}
              style={{ width: MOBILE_WIDTH, height, transform: `scale(${scale})` }}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('wbi-mobile__grid') || (e.target as HTMLElement).classList.contains('wbi-page-bg')) useMobileLayout.getState().select([])
              }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDragOver={onDragOver}
              onDragLeave={() => setDropHint(null)}
              onDrop={onDrop}
              onContextMenuCapture={onContextMenuCapture}
            >
              <div className="wbi-page-bg" style={bg} />
              {showGrid && <div className="wbi-mobile__grid" style={{ backgroundSize: `${MOBILE_GRID_MAJOR}px ${MOBILE_GRID_MAJOR}px` }} />}
              {placed.map((v) => (
                <PlacedVisual key={v.name} page={page} visual={v} rect={rectOf(v)} filters={filters} />
              ))}
              {dropHint && <div className="wbi-mobile__drophint" style={{ left: dropHint.x, top: dropHint.y, width: dropHint.width, height: dropHint.height }} />}
              <div className="wbi-edit-layer">
                {selected
                  .map((n) => page.visuals.find((v) => v.name === n))
                  .filter((v): v is VisualDocument => !!v && isPlaced(v))
                  .map((v) => {
                    const r = rectOf(v)
                    const hs = 8 * inv
                    const single = selected.length === 1 && !lock
                    return (
                      <div key={v.name} className="wbi-sel" style={{ left: r.x, top: r.y, width: r.width, height: r.height, borderWidth: Math.max(1, 1.5 * inv) }}>
                        {single &&
                          HANDLES.map((h) => {
                            const x = h.includes('w') ? 0 : h.includes('e') ? r.width : r.width / 2
                            const y = h.includes('n') ? 0 : h.includes('s') ? r.height : r.height / 2
                            return <div key={h} className={`wbi-handle h-${h}`} style={{ left: x - hs / 2, top: y - hs / 2, width: hs, height: hs, borderWidth: Math.max(0.5, inv) }} onPointerDown={(e) => onHandleDown(e, v.name, h)} />
                          })}
                        <button
                          type="button"
                          className="wbi-mobile__remove"
                          title="Remove from mobile layout"
                          aria-label="Remove from mobile layout"
                          style={{ width: 18 * inv, height: 18 * inv, fontSize: 12 * inv, top: -9 * inv, right: -9 * inv }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            editPage(page.name, 'Remove from mobile layout', (p) => removeFromMobile(p, [v.name]))
                            useMobileLayout.getState().select(useMobileLayout.getState().selected.filter((n) => n !== v.name))
                          }}
                        >
                          <DismissRegular />
                        </button>
                      </div>
                    )
                  })}
              </div>
            </div>
          </CanvasEnvContext.Provider>
          {!placed.length && (
            <div className="wbi-mobile__hint" style={{ top: 120 * scale }}>
              <PhoneRegular fontSize={28} />
              <div>Drag visuals from the Page visuals pane to build the mobile layout, or select Auto-create.</div>
            </div>
          )}
        </div>
      </div>
      <CanvasControls />
    </div>
  )
}

/** Name of the visual being dragged from the pane (dataTransfer data isn't readable during dragover). */
let draggingName: string | null = null

function defaultSizeFor(page: PageDocument, v: VisualDocument): { width: number; height: number } {
  // same default as addToMobile, computed through a throwaway clone so we don't mutate the live page
  const clone: PageDocument = { name: page.name, json: page.json, visuals: page.visuals.map((x) => (x === v ? { ...x, mobile: undefined } : x)) }
  addToMobile(clone, v.name, { x: 0, y: 0 })
  const r = mobileRect(clone.visuals.find((x) => x.name === v.name))
  return r ? { width: r.width, height: r.height } : { width: MOBILE_WIDTH, height: 160 }
}

const PlacedVisual = memo(function PlacedVisual({ page, visual, rect, filters }: { page: PageDocument; visual: VisualDocument; rect: Rect; filters: ReturnType<typeof usePageFilters> }) {
  const json = useMemo(() => mobileVisualJson(visual), [visual])
  const shown = useMemo<VisualDocument>(() => (json === visual.json ? visual : { ...visual, json }), [visual, json])
  const hidden = isEffectivelyHidden(page, visual)
  const z = mobileRect(visual)?.z ?? 0
  if (hidden) {
    // PBI places hidden visuals but doesn't show them; we draw a faint outline so they stay selectable
    return (
      <div className="wbi-mobile__hidden" data-mobile-item={visual.name} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: z }} onPointerDown={(e) => (e.button === 0 ? useMobileLayout.getState().select([visual.name]) : undefined)}>
        <EyeOffRegular /> Hidden
      </div>
    )
  }
  if (isGroup(visual)) {
    const kids = groupChildrenRects(page, visual, rect)
    return (
      <div className="wbi-group" data-mobile-item={visual.name} style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: z }}>
        {kids
          .filter((k) => !isEffectivelyHidden(page, k.v))
          .sort((a, b) => a.z - b.z)
          .map((k, i) => {
            const f = filters.get(k.v.name)
            return <ChildVisual key={k.v.name} visual={k.v} rect={k.rect} z={i} filters={f?.filters ?? EMPTY} highlightFilters={f?.highlightFilters ?? EMPTY} />
          })}
      </div>
    )
  }
  const f = filters.get(visual.name)
  return (
    <div data-mobile-item={visual.name} style={{ display: 'contents' }}>
      <VisualContainer visual={shown} rect={rect} z={z} filters={f?.filters ?? EMPTY} highlightFilters={f?.highlightFilters ?? EMPTY} />
    </div>
  )
})

function ChildVisual(props: { visual: VisualDocument; rect: Rect; z: number; filters: SQFilter[]; highlightFilters: SQFilter[] }) {
  const json = useMemo(() => mobileVisualJson(props.visual), [props.visual])
  const shown = useMemo<VisualDocument>(() => (json === props.visual.json ? props.visual : { ...props.visual, json }), [props.visual, json])
  return <VisualContainer visual={shown} rect={props.rect} z={props.z} filters={props.filters} highlightFilters={props.highlightFilters} />
}

function CanvasControls() {
  const showGrid = useMobileLayout((s) => s.showGrid)
  const snapOn = useMobileLayout((s) => s.snapToGrid)
  const lock = useMobileLayout((s) => s.lock)
  const set = useMobileLayout((s) => s.set)
  return (
    <div className="wbi-mobile__controls">
      <button type="button" className={cx('wbi-mobile__ctl', showGrid && 'is-on')} title="Gridlines" aria-pressed={showGrid} onClick={() => set({ showGrid: !showGrid })}>
        <GridRegular />
      </button>
      <button type="button" className={cx('wbi-mobile__ctl', snapOn && 'is-on')} title="Snap to grid" aria-pressed={snapOn} onClick={() => set({ snapToGrid: !snapOn })}>
        <GridDotsRegular />
      </button>
      <button type="button" className={cx('wbi-mobile__ctl', lock && 'is-on')} title="Lock visuals" aria-pressed={lock} onClick={() => set({ lock: !lock })}>
        <LockClosedRegular />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Page visuals pane
// ---------------------------------------------------------------------------------------------

function PageVisualsPane({ page }: { page: PageDocument }) {
  const appearance = useMobileLayout((s) => s.appearance)
  const set = useMobileLayout((s) => s.set)
  const selected = useMobileLayout((s) => s.selected)
  const items = useMemo(() => pageVisualItems(page), [page])
  const anyPlaced = items.some(isPlaced)
  const shown = items.filter((v) => {
    const hidden = isEffectivelyHidden(page, v)
    return appearance === 'all' || (appearance === 'hidden' ? hidden : !hidden)
  })
  return (
    <aside className="wbi-pane wbi-mobile__pane" aria-label="Page visuals">
      <div className="wbi-pane__header">
        <h2 className="wbi-pane__title">Page visuals</h2>
      </div>
      <div className="wbi-mobile__pane-actions">
        <button
          type="button"
          className="wbi-btn wbi-btn--small"
          onClick={() => {
            let names: string[] = []
            editPage(page.name, 'Auto-create mobile layout', (p) => {
              names = autoCreateMobile(p)
            })
            useMobileLayout.getState().select([])
            if (!names.length) console.info('[mobile] auto-create placed no visuals')
          }}
          title="Create a mobile layout automatically (replaces the current one)"
        >
          <SparkleRegular fontSize={14} /> Auto-create
        </button>
        <span className="wbi-mobile__spacer" />
        <select className="wbi-mobile__filter" value={appearance} aria-label="Filter by appearance" onChange={(e) => set({ appearance: e.target.value as typeof appearance })}>
          <option value="all">All</option>
          <option value="visible">Visible</option>
          <option value="hidden">Hidden</option>
        </select>
        <button
          type="button"
          className="wbi-btn wbi-btn--icon"
          title="Remove all visuals from canvas"
          aria-label="Remove all visuals from canvas"
          disabled={!anyPlaced}
          onClick={() => {
            editPage(page.name, 'Remove all from mobile layout', clearMobile)
            useMobileLayout.getState().select([])
          }}
        >
          <EraserRegular fontSize={16} />
        </button>
      </div>
      <div className="wbi-pane__body">
        {!shown.length && <div className="wbi-pane__empty">{items.length ? 'No visuals match the filter.' : 'This page has no visuals.'}</div>}
        <ul className="wbi-mobile__list">
          {shown.map((v) => {
            const placed = isPlaced(v)
            const hidden = isEffectivelyHidden(page, v)
            const def = getVisual(visualTypeOf(v))
            return (
              <li
                key={v.name}
                className={cx('wbi-mobile__item', placed && 'is-placed', selected.includes(v.name) && 'is-selected')}
                draggable
                onDragStart={(e) => {
                  draggingName = v.name
                  e.dataTransfer.setData(DRAG_MIME, v.name)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onDragEnd={() => (draggingName = null)}
                onClick={() => placed && useMobileLayout.getState().select([v.name])}
                onDoubleClick={() => {
                  if (placed) return
                  editPage(page.name, 'Add to mobile layout', (p) => addToMobile(p, v.name))
                  useMobileLayout.getState().select([v.name])
                }}
                title={placed ? 'On the mobile layout — drag to reposition' : 'Drag onto the phone canvas (or double-click) to add'}
              >
                <span className="wbi-mobile__thumb" aria-hidden dangerouslySetInnerHTML={{ __html: isGroup(v) ? GROUP_ICON : (def?.icon ?? GENERIC_ICON) }} />
                <span className="wbi-mobile__name">{visualLabel(v)}</span>
                {placed && <CheckmarkCircleFilled className="wbi-mobile__used" aria-label="In use" />}
                <span className="wbi-mobile__eye" title={hidden ? 'Hidden' : 'Visible'}>
                  {hidden ? <EyeOffRegular /> : <EyeRegular />}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </aside>
  )
}

const GENERIC_ICON = '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="2.5" y="3.5" width="15" height="13" rx="1" fill="none" stroke="#605E5C"/></svg>'
const GROUP_ICON = '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="2.5" y="2.5" width="15" height="15" rx="1" fill="none" stroke="#605E5C" stroke-dasharray="2 1.5"/><rect x="5" y="5" width="5" height="5" fill="#C8C6C4"/><rect x="11" y="9" width="4" height="6" fill="#A19F9D"/></svg>'
