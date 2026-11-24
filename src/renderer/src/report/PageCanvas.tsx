/**
 * PageCanvas — renders one report page at native size scaled by `scale`: page background, visual tree
 * (groups nest their children), edit layer (selection, move / resize with snapping + guides, lasso,
 * gridlines), focus mode / show-as-table, and readiness tracking. Used by the report view, report-page
 * tooltips, and the print layout.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import { ArrowLeftRegular } from '@fluentui/react-icons'
import type { PageDocument, ReportDocument, VisualDocument } from '@core/report/types'
import type { DataPointIdentity, SQFilter } from '@core/report/sq'
import { decodeValue, gradientOf, rawProp } from '@core/report/props'
import { gradientCss, readFills } from '@core/report/gradientFill'
import { withTransparency } from '@core/report/theme'
import { useApp } from '../state/store'
import { useInteraction } from '../state/interaction'
import { getVisual } from '../visuals/registry'
import { CanvasEnvContext, type CanvasEnv, type CanvasMotion } from './canvasEnv'
import { isPinned, pageTransition, readingOrder, reportMotion } from '@core/report/motion'
import { motionAllowed, useMotionAllowed } from './motion/env'
import { notePageShown, playPageEnter, settleBookmarkMorph } from './motion/pageTransition'
import { borderCss, gradientBorderLayer, resolveChrome, resolveGroupChrome } from './chrome'
import { setAbsoluteRects, topLevelOf } from './editOps'
import { HANDLES, boundsOf, lassoHits, rectFromPoints, resizeRect, snapMove, snapResize, type Guide, type Handle, type SizeMatch, type SpacingGuide } from './geometry'
import { usePageFilters } from './pageFilters'
import { usePageVisualFilters } from './host'
import { currentLayoutGuides, useLayoutGuides } from './layoutGuides'
import { absoluteRect, groupOrigin, isEffectivelyHidden, isGroup, parentOf, positionOf, topAncestor, visualTypeOf, type Rect } from './pbir'
import { useCanvasPrefs } from './prefs'
import { VisualContainer } from './VisualContainer'
import { resolveImageUrl } from './images'
import { ShowAsTable } from './ShowAsTable'
import { paintOnto, useFormatPainter } from './formatPainter'

export interface PageCanvasProps {
  report: ReportDocument
  page: PageDocument
  scale: number
  /** ctx.mode for visuals */
  mode: 'view' | 'edit'
  /** selection / tooltips / context menus enabled */
  interactive: boolean
  /** edit chrome (selection handles, drag, lasso) */
  editing: boolean
  /** extra filters for every visual (report-page tooltips) */
  extraFilters?: SQFilter[]
  /**
   * called once when every visible visual rendered, or after a timeout; `result.timedOut` (with the visuals still
   * pending) tells the two apart, so exports can say which pages were not fully drawn
   */
  onReady?(result?: CanvasReadyResult): void
  /** focus mode / show as table for one visual */
  focus?: { visual: string; mode: 'focus' | 'table'; point?: DataPointIdentity } | null
  /** box size for focus mode (CSS px) */
  focusSize?: { width: number; height: number }
  /** color under the (possibly transparent) page background; default white like PBI */
  underlay?: string
}

const READY_TIMEOUT_MS = 12000

/** Outcome of a canvas' readiness wait (PageCanvasProps.onReady). */
export interface CanvasReadyResult {
  /** true when the readiness timeout fired before every visual reported */
  timedOut: boolean
  /** visuals not rendered when the timeout fired (name and visual type) */
  pending: Array<{ name: string; type: string }>
}

// ---------------------------------------------------------------------------------------------
// Page background
// ---------------------------------------------------------------------------------------------

export function pageBackgroundStyle(report: ReportDocument, page: PageDocument, theme = useApp.getState().theme, object = 'background'): CSSProperties {
  const ctx = { visualType: 'page', objects: page.json?.objects, theme, fills: readFills(page.json) }
  const color = decodeValue(rawProp(ctx, object, 'color'), theme)
  const transparency = Number(decodeValue(rawProp(ctx, object, 'transparency'), theme) ?? 0)
  const img = rawProp(ctx, object, 'image')
  const style: CSSProperties = {}
  // Lumen gradient fill (core/report/gradientFill.ts): `--wbi-bg-gradient`, the solid fallback stays in backgroundColor
  const gradient = typeof color === 'string' ? gradientOf(ctx, { object, prop: 'color' }) : undefined
  if (typeof color === 'string') style.backgroundColor = withTransparency(color, transparency)
  if (gradient) (style as any)['--wbi-bg-gradient'] = gradientCss(gradient, transparency)
  const imageProps = img?.image ?? img
  if (imageProps?.url) {
    const ref = decodeValue(imageProps.url, theme)
    const url = ref ? resolveImageUrl(report, typeof ref === 'string' ? ref : ref) : undefined
    if (url) {
      const scaling = String(decodeValue(imageProps.scaling, theme) ?? 'Normal')
      style.backgroundImage = `url("${url}")`
      style.backgroundRepeat = 'no-repeat'
      style.backgroundSize = scaling === 'Fit' ? '100% 100%' : scaling === 'Fill' ? 'cover' : 'auto'
      style.backgroundPosition = scaling === 'Fill' ? 'center' : 'top left'
    }
  }
  return { ...style, ['--wbi-bg-opacity' as any]: String(1 - Math.max(0, Math.min(100, transparency)) / 100) }
}

/** pageBackgroundStyle as one plain CSS layer stack (image over the gradient fill), without the custom properties. */
export function flatBackgroundStyle(st: CSSProperties): CSSProperties {
  const { ['--wbi-bg-opacity' as any]: _o, ['--wbi-bg-gradient' as any]: gradient, ...rest } = st as any
  if (!gradient) return rest
  return { ...rest, backgroundImage: rest.backgroundImage ? `${rest.backgroundImage}, ${gradient}` : gradient }
}

/** Page background layer: color + image with PBI transparency applied to the whole layer (image included). */
function PageBackground({ report, page }: { report: ReportDocument; page: PageDocument }) {
  const theme = useApp((s) => s.theme)
  const st = useMemo(() => pageBackgroundStyle(report, page, theme), [report, page, theme])
  const opacity = Number((st as any)['--wbi-bg-opacity'] ?? 1)
  const { backgroundColor, ['--wbi-bg-gradient' as any]: gradient, ...rest } = st as any
  // color already carries alpha via withTransparency; image layer gets the opacity
  return (
    <>
      {gradient ? <div className="wbi-page-bg" style={{ background: gradient }} /> : backgroundColor ? <div className="wbi-page-bg" style={{ backgroundColor }} /> : null}
      {rest.backgroundImage ? <div className="wbi-page-bg" style={{ ...rest, opacity }} /> : null}
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Visual tree
// ---------------------------------------------------------------------------------------------

interface TreeProps {
  page: PageDocument
  parent?: string
  filters: ReturnType<typeof usePageFilters>
  preview: Record<string, Rect> | null
}

const VisualTree = memo(function VisualTree({ page, parent, filters, preview }: TreeProps) {
  const theme = useApp((s) => s.theme)
  const exists = (n: string | undefined) => !!n && page.visuals.some((v) => v.name === n)
  const level = page.visuals
    .filter((v) => (parent ? parentOf(v) === parent : !exists(parentOf(v))))
    .filter((v) => !v.json?.isHidden)
    .sort((a, b) => positionOf(a).z - positionOf(b).z)
  const origin = groupOrigin(page, parent)
  const rectOf = (v: VisualDocument): Rect => {
    const p = preview?.[v.name]
    if (p) return { ...p, x: p.x - origin.x, y: p.y - origin.y }
    const pos = positionOf(v)
    return { x: pos.x, y: pos.y, width: pos.width, height: pos.height }
  }
  return (
    <>
      {level.map((v) => {
        const r = rectOf(v)
        const z = positionOf(v).z
        if (isGroup(v)) {
          const gc = resolveGroupChrome(v.json, theme)
          return (
            <div
              key={v.name}
              className="wbi-group"
              data-group={v.name}
              data-pinned={isPinned(page.visuals, v.name) || undefined}
              style={{
                position: 'absolute',
                left: r.x,
                top: r.y,
                width: r.width,
                height: r.height,
                zIndex: z,
                background: gc.background,
                border: borderCss(gc.border),
                borderRadius: gc.radius || undefined,
                boxShadow: gc.shadow?.css
              }}
            >
              {gc.border?.gradient && <div className="wbi-group-border" aria-hidden style={gradientBorderLayer(gc.border, gc.radius, -gc.border.width)} />}
              <VisualTree page={page} parent={v.name} filters={filters} preview={preview} />
            </div>
          )
        }
        const f = filters.get(v.name)
        return <VisualContainer key={v.name} visual={v} rect={r} z={z} filters={f?.filters ?? EMPTY} highlightFilters={f?.highlightFilters ?? EMPTY} pinned={isPinned(page.visuals, v.name)} />
      })}
    </>
  )
})
const EMPTY: SQFilter[] = []

// ---------------------------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------------------------

interface DragState {
  kind: 'move' | 'resize' | 'lasso'
  startX: number
  startY: number
  moved: boolean
  /** page-space start rects of the manipulated top-level visuals */
  start: Record<string, Rect>
  handle?: Handle
  lockAspect?: boolean
  pointerId: number
  additive?: boolean
}

export function PageCanvas(props: PageCanvasProps) {
  const { report, page, scale, mode, interactive, editing, extraFilters, focus } = props
  const width = page.json?.width ?? 1280
  const height = page.json?.height ?? 720
  const filters = usePageFilters(report, page, extraFilters)
  // publish the per-visual filters for page-summary visuals (ReportInfo.pageVisuals, see report/host.ts)
  useEffect(() => {
    if (interactive && !focus) usePageVisualFilters.getState().publish(page.name, filters)
  }, [interactive, focus, page.name, filters])
  const spotlight = useInteraction((s) => (s.spotlight?.page === page.name ? s.spotlight.visual : undefined))
  const selected = useApp((s) => (editing ? s.selectedVisuals : EMPTY_NAMES))
  const prefs = useCanvasPrefs()
  const layoutGuides = useLayoutGuides()
  const painting = useFormatPainter((s) => !!s.format)
  const [preview, setPreviewState] = useState<Record<string, Rect> | null>(null)
  // mirror in a ref: pointerup may run before React flushes the last pointermove's state update
  const previewRef = useRef<Record<string, Rect> | null>(null)
  const setPreview = (p: Record<string, Rect> | null) => {
    previewRef.current = p
    setPreviewState(p)
  }
  const [guides, setGuidesState] = useState<SnapOverlay>(NO_SNAP)
  const setGuides = (g: SnapOverlay | Guide[]) => setGuidesState(Array.isArray(g) ? (g.length ? { guides: g, spacing: [], sizes: [] } : NO_SNAP) : g)
  const [lasso, setLassoState] = useState<Rect | null>(null)
  const lassoRef = useRef<Rect | null>(null)
  const setLasso = (r: Rect | null) => {
    lassoRef.current = r
    setLassoState(r)
  }
  const drag = useRef<DragState | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)

  // ---- readiness ------------------------------------------------------------------------------
  const done = useRef(new Set<string>())
  const readyFired = useRef(false)
  const expected = useMemo(() => {
    if (focus) return [focus.visual]
    return page.visuals.filter((v) => !isGroup(v) && !isEffectivelyHidden(page, v)).map((v) => v.name)
  }, [page, focus])
  const onReadyRef = useRef(props.onReady)
  onReadyRef.current = props.onReady
  const checkReady = useCallback(() => {
    if (readyFired.current) return
    if (expected.every((n) => done.current.has(n))) {
      readyFired.current = true
      onReadyRef.current?.({ timedOut: false, pending: [] })
    }
  }, [expected])
  useEffect(() => {
    checkReady()
    const t = setTimeout(() => {
      if (!readyFired.current) {
        readyFired.current = true
        const pending = expected.filter((n) => !done.current.has(n)).map((n) => ({ name: n, type: visualTypeOf(page.visuals.find((v) => v.name === n)) }))
        console.warn(`[canvas] readiness timeout on page ${page.name}: ${pending.length} visual(s) pending (${pending.map((p) => p.type).join(', ')})`)
        onReadyRef.current?.({ timedOut: true, pending })
      }
    }, READY_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [checkReady, expected, page.name])
  const reportDone = useCallback(
    (name: string) => {
      done.current.add(name)
      checkReady()
    },
    [checkReady]
  )

  // ---- edit interactions ----------------------------------------------------------------------
  const pageSize = useMemo(() => ({ width, height }), [width, height])
  const toPage = (dx: number) => dx / (scale || 1)

  const othersFor = (exclude: Set<string>): Rect[] =>
    page.visuals
      .filter((v) => !exclude.has(v.name) && !isEffectivelyHidden(page, v) && !(parentOf(v) && exclude.has(topAncestor(page, v).name)))
      .map((v) => absoluteRect(page, v))

  const [headerLayer, setHeaderLayer] = useState<HTMLDivElement | null>(null)
  const capture = (pointerId: number) => {
    try {
      pageRef.current?.setPointerCapture(pointerId)
    } catch {
      /* element may be gone */
    }
  }
  const beginDrag = (e: RPointerEvent, st: DragState) => {
    drag.current = st
    // A move starts as a plain click: capturing now would retarget the following `click` to the page (Chromium
    // dispatches click to the capture target), so the first click on a data point of an unselected visual would only
    // select it instead of also cross-filtering like PBI Desktop. Capture once the pointer really moved (onPointerMove).
    if (st.kind !== 'move') capture(e.pointerId)
  }

  const onContainerPointerDown = useCallback(
    (e: RPointerEvent, name: string) => {
      if (e.button !== 0 || !editing) return
      const v = page.visuals.find((x) => x.name === name)
      if (!v) return
      // format painter armed: paint onto the clicked (top-level) visual instead of selecting / dragging
      if (useFormatPainter.getState().format) {
        const t = topAncestor(page, v)
        const target = isGroup(t) ? v : t
        if (paintOnto(page, target.name)) {
          e.stopPropagation()
          return
        }
      }
      const app = useApp.getState()
      const sel = app.selectedVisuals
      // PBI: first click selects the outermost group; once a group is selected, clicking selects inside it
      let target = topAncestor(page, v)
      let cur: VisualDocument | undefined = v
      while (cur) {
        const p = parentOf(cur)
        if (p && sel.includes(p)) {
          target = cur
          break
        }
        cur = p ? page.visuals.find((x) => x.name === p) : undefined
      }
      if (sel.includes(v.name)) target = v
      let next = sel
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        next = sel.includes(target.name) ? sel.filter((n) => n !== target.name) : [...sel, target.name]
        app.selectVisuals(next)
        return
      }
      if (!sel.includes(target.name)) {
        next = [target.name]
        app.selectVisuals(next)
      }
      if (useCanvasPrefs.getState().lockObjects) return
      const tops = topLevelOf(page, next)
      const start: Record<string, Rect> = {}
      for (const n of tops) {
        const vv = page.visuals.find((x) => x.name === n)
        if (vv) start[n] = absoluteRect(page, vv)
      }
      beginDrag(e, { kind: 'move', startX: e.clientX, startY: e.clientY, moved: false, start, pointerId: e.pointerId })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, editing, scale]
  )

  const onHandlePointerDown = (e: RPointerEvent, name: string, handle: Handle) => {
    e.stopPropagation()
    e.preventDefault()
    const v = page.visuals.find((x) => x.name === name)
    if (!v) return
    const theme = useApp.getState().theme
    const lockAspect = !isGroup(v) && resolveChrome(v.json, theme).lockAspect
    beginDrag(e, { kind: 'resize', startX: e.clientX, startY: e.clientY, moved: false, start: { [name]: absoluteRect(page, v) }, handle, lockAspect, pointerId: e.pointerId })
  }

  const onPagePointerDown = (e: RPointerEvent) => {
    if (!editing || e.button !== 0) return
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('wbi-page-bg') && !(e.target as HTMLElement).classList.contains('wbi-grid')) return
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    if (!additive) useApp.getState().selectVisuals([])
    const rect = pageRef.current!.getBoundingClientRect()
    beginDrag(e, { kind: 'lasso', startX: (e.clientX - rect.left) / scale, startY: (e.clientY - rect.top) / scale, moved: false, start: {}, pointerId: e.pointerId, additive })
  }

  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    if (d.kind === 'lasso') {
      const rect = pageRef.current!.getBoundingClientRect()
      const x = (e.clientX - rect.left) / scale
      const y = (e.clientY - rect.top) / scale
      if (!d.moved && Math.hypot(x - d.startX, y - d.startY) * scale < 3) return
      d.moved = true
      setLasso(rectFromPoints(d.startX, d.startY, x, y))
      return
    }
    const dxs = e.clientX - d.startX
    const dys = e.clientY - d.startY
    if (!d.moved && e.buttons === 0) {
      // released outside the page before the move threshold (no capture yet): abandon the drag
      drag.current = null
      return
    }
    if (!d.moved && Math.hypot(dxs, dys) < 4) return
    if (!d.moved) capture(e.pointerId)
    d.moved = true
    const dx = toPage(dxs)
    const dy = toPage(dys)
    const prefsNow = useCanvasPrefs.getState()
    // Alt: free move/resize (no smart guides) like PBI / Figma
    const snapOpts = {
      page: pageSize,
      grid: prefsNow.snapToGrid ? prefsNow.gridSize : undefined,
      objects: !e.altKey,
      threshold: 6 / Math.max(scale, 0.25),
      layout: currentLayoutGuides(report),
      equalSpacing: prefsNow.equalSpacing,
      matchSize: prefsNow.matchSize
    }
    const names = Object.keys(d.start)
    const others = othersFor(new Set(names))
    if (d.kind === 'move') {
      const b = boundsOf(Object.values(d.start))
      const moved = { ...b, x: b.x + dx, y: b.y + dy }
      const snapped = snapMove(moved, others, snapOpts)
      const ox = snapped.rect.x - b.x
      const oy = snapped.rect.y - b.y
      const next: Record<string, Rect> = {}
      for (const n of names) next[n] = { ...d.start[n], x: d.start[n].x + ox, y: d.start[n].y + oy }
      setPreview(next)
      setGuides({ guides: snapped.guides, spacing: snapped.spacing, sizes: [] })
    } else if (d.kind === 'resize' && d.handle) {
      const n = names[0]
      const r0 = resizeRect(d.start[n], d.handle, dx, dy, { lockAspect: d.lockAspect || e.shiftKey })
      const snapped = d.lockAspect || e.shiftKey ? { rect: r0, guides: [], spacing: [], sizes: [] } : snapResize(r0, d.handle, others, snapOpts)
      setPreview({ [n]: snapped.rect })
      setGuides({ guides: snapped.guides, spacing: snapped.spacing, sizes: snapped.sizes, resized: snapped.rect })
    }
  }

  const onPointerUp = (e: RPointerEvent) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    drag.current = null
    try {
      pageRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (d.kind === 'lasso') {
      const lassoRect = lassoRef.current
      if (lassoRect) {
        const items = page.visuals
          .filter((v) => !parentOf(v) || !page.visuals.some((g) => g.name === parentOf(v)))
          .filter((v) => !isEffectivelyHidden(page, v))
          .map((v) => ({ name: v.name, rect: absoluteRect(page, v) }))
        const hits = lassoHits(lassoRect, items)
        const app = useApp.getState()
        app.selectVisuals(d.additive ? [...new Set([...app.selectedVisuals, ...hits])] : hits)
      }
      setLasso(null)
      return
    }
    const p = previewRef.current
    setGuides([])
    if (d.moved) {
      // swallow the click that follows a drag so the visual under the pointer doesn't cross-filter
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation()
        ev.preventDefault()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 250)
    }
    if (d.moved && p) {
      useApp.getState().mutateReport(d.kind === 'move' ? 'Move' : 'Resize', (draft) => {
        const dp = draft.pages.find((x) => x.name === page.name)
        if (dp) setAbsoluteRects(dp, p)
      })
    }
    setPreview(null)
  }

  // ---- headless capture aid: `#/?…&simdrag=<visual>:<dx>,<dy>[:<handle>]` shows the smart guides of a drag ------
  useEffect(() => {
    if (!editing || typeof window === 'undefined') return
    const m = /[?&]simdrag=([^&]+)/.exec(window.location.hash)
    if (!m) return
    const [name, delta, handle] = decodeURIComponent(m[1]).split(':')
    const [dx, dy] = (delta ?? '0,0').split(',').map(Number)
    // by name, or `<visualType>#<n>` (n-th visual of that type in page order, 0-based)
    const [vt, idx] = name.split('#')
    const v = page.visuals.find((x) => x.name === name) ?? page.visuals.filter((x) => x.json?.visual?.visualType === vt).sort((a, b) => absoluteRect(page, a).y - absoluteRect(page, b).y || absoluteRect(page, a).x - absoluteRect(page, b).x)[Number(idx ?? 0)]
    if (!v) return
    const start = absoluteRect(page, v)
    const prefsNow = useCanvasPrefs.getState()
    const opts = { page: pageSize, threshold: 6, layout: currentLayoutGuides(report), equalSpacing: prefsNow.equalSpacing, matchSize: prefsNow.matchSize }
    const others = othersFor(new Set([v.name]))
    if (handle) {
      const r = snapResize(resizeRect(start, handle as Handle, dx, dy), handle as Handle, others, opts)
      setPreview({ [v.name]: r.rect })
      setGuides({ guides: r.guides, spacing: r.spacing, sizes: r.sizes, resized: r.rect })
    } else {
      const r = snapMove({ ...start, x: start.x + dx, y: start.y + dy }, others, opts)
      setPreview({ [v.name]: r.rect })
      setGuides({ guides: r.guides, spacing: r.spacing, sizes: [] })
    }
    useApp.getState().selectVisuals([v.name])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, page.name])

  // ---- motion (Lumen: visual animations and page transitions, report/motion) ----------------------
  const motionOn = useMotionAllowed()
  const reportJson = report.report
  const motion: CanvasMotion | undefined = useMemo(() => {
    const rm = reportMotion(reportJson)
    if (!motionOn || !interactive || !rm.animate) return undefined
    return { report: rm, order: readingOrder(page.visuals.map((v) => ({ name: v.name, ...absoluteRect(page, v) }))) }
  }, [motionOn, interactive, reportJson, page])
  const outerRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!interactive || focus) return
    const order = report.pagesMeta?.pageOrder?.length ? report.pagesMeta.pageOrder : report.pages.map((p) => p.name)
    const direction = notePageShown(order, page.name)
    // the page transition plays in reading view only (and in published dashboards); never while editing
    if (!direction || editing || mode !== 'view' || !motionAllowed()) return
    const el = outerRef.current
    const target = el?.parentElement?.classList.contains('wbi-page-shadow') ? el.parentElement : el
    if (target) playPageEnter({ el: target, page: page.name, visuals: page.visuals, kind: pageTransition(reportJson, page.json), direction, motion: reportMotion(reportJson) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // bookmark morph: after a bookmark changes what the page shows (runtime.applyBookmark captured the page before)
  useLayoutEffect(() => {
    if (interactive && !editing && !focus) settleBookmarkMorph(pageRef.current, page.name, reportMotion(reportJson).transitionDuration)
  })

  // ---- env --------------------------------------------------------------------------------------
  const env: CanvasEnv = useMemo(
    () => ({
      report,
      page,
      pageName: page.name,
      mode,
      interactive,
      editing,
      scale,
      headers: interactive,
      spotlight,
      reportDone,
      headerLayer,
      onContainerPointerDown,
      motion
    }),
    [report, page, mode, interactive, editing, scale, spotlight, reportDone, headerLayer, onContainerPointerDown, motion]
  )

  // ---- focus mode / show as table ---------------------------------------------------------------
  if (focus) {
    const v = page.visuals.find((x) => x.name === focus.visual)
    const f = filters.get(focus.visual)
    const size = props.focusSize ?? { width, height }
    return (
      <CanvasEnvContext.Provider value={{ ...env, editing: false }}>
        <div className="wbi-focus" style={{ width: size.width, height: size.height }}>
          {v && focus.mode === 'focus' && (
            <div style={{ position: 'absolute', inset: 0 }}>
              <VisualContainer visual={v} rect={{ x: 0, y: 0, width: size.width, height: size.height }} z={0} filters={f?.filters ?? EMPTY} highlightFilters={f?.highlightFilters ?? EMPTY} fill />
            </div>
          )}
          {v && focus.mode === 'table' && <ShowAsTable visual={v} filters={f?.filters ?? EMPTY} highlightFilters={f?.highlightFilters ?? EMPTY} size={size} point={focus.point} />}
        </div>
      </CanvasEnvContext.Provider>
    )
  }

  const outer: CSSProperties = { width: width * scale, height: height * scale, position: 'relative', flex: '0 0 auto' }
  const inner: CSSProperties = { background: props.underlay ?? '#FFFFFF', width, height, transform: `scale(${scale})`, transformOrigin: '0 0', position: 'absolute', left: 0, top: 0 }

  return (
    <CanvasEnvContext.Provider value={env}>
      <div ref={outerRef} className={'wbi-page-outer' + (editing ? ' editing' : '') + (editing && painting ? ' painting' : '')} style={outer}>
        <div
          ref={pageRef}
          className="wbi-page"
          data-page={page.name}
          style={inner}
          onPointerDown={onPagePointerDown}
          onPointerMove={editing ? onPointerMove : undefined}
          onPointerUp={editing ? onPointerUp : undefined}
          onPointerCancel={editing ? onPointerUp : undefined}
        >
          <PageBackground report={report} page={page} />
          {editing && prefs.showGridlines && <div className="wbi-grid" style={{ backgroundSize: `${prefs.gridSize}px ${prefs.gridSize}px` }} />}
          {editing && prefs.showLayoutGuides && layoutGuides.margin > 0 && layoutGuides.margin * 2 < Math.min(width, height) && (
            <div className="wbi-margin-guide" style={{ left: layoutGuides.margin, top: layoutGuides.margin, right: layoutGuides.margin, bottom: layoutGuides.margin, borderWidth: Math.max(1, 1 / (scale || 1)) }} />
          )}
          <VisualTree page={page} filters={filters} preview={preview} />
          <div className="wbi-vh-layer" ref={setHeaderLayer} />
          {editing && (
            <EditLayer page={page} selected={selected} preview={preview} guides={guides} lasso={lasso} scale={scale} locked={prefs.lockObjects} onHandlePointerDown={onHandlePointerDown} />
          )}
        </div>
      </div>
    </CanvasEnvContext.Provider>
  )
}
const EMPTY_NAMES: string[] = []

// ---------------------------------------------------------------------------------------------
// Edit layer (selection outlines, handles, guides, lasso)
// ---------------------------------------------------------------------------------------------

function EditLayer(props: {
  page: PageDocument
  selected: string[]
  preview: Record<string, Rect> | null
  guides: SnapOverlay
  lasso: Rect | null
  scale: number
  locked: boolean
  onHandlePointerDown(e: RPointerEvent, name: string, h: Handle): void
}) {
  const { page, selected, preview, guides, lasso, scale } = props
  const inv = 1 / (scale || 1)
  const pageW = page.json?.width ?? 1280
  const pageH = page.json?.height ?? 720
  const rects = selected
    .map((n) => page.visuals.find((v) => v.name === n))
    .filter((v): v is VisualDocument => !!v && !isEffectivelyHidden(page, v))
    .map((v) => {
      let r = preview?.[v.name] ?? absoluteRect(page, v)
      // children of a group being previewed follow it
      if (!preview?.[v.name] && preview) {
        const top = topAncestor(page, v)
        const pr = preview[top.name]
        if (pr && top.name !== v.name) {
          const base = absoluteRect(page, top)
          r = { ...r, x: r.x + pr.x - base.x, y: r.y + pr.y - base.y }
        }
      }
      return { name: v.name, r, group: isGroup(v) }
    })
  const single = rects.length === 1 && !props.locked
  const hs = 8 * inv
  return (
    <div className="wbi-edit-layer">
      {rects.map(({ name, r, group }) => (
        <div
          key={name}
          className={'wbi-sel' + (group ? ' group' : '')}
          style={{ left: r.x, top: r.y, width: r.width, height: r.height, borderWidth: Math.max(1, 1.5 * inv) }}
        >
          {single &&
            HANDLES.map((h) => {
              const x = h.includes('w') ? 0 : h.includes('e') ? r.width : r.width / 2
              const y = h.includes('n') ? 0 : h.includes('s') ? r.height : r.height / 2
              return (
                <div
                  key={h}
                  className={`wbi-handle h-${h}`}
                  style={{ left: x - hs / 2, top: y - hs / 2, width: hs, height: hs, borderWidth: Math.max(0.5, inv) }}
                  onPointerDown={(e) => props.onHandlePointerDown(e, name, h)}
                />
              )
            })}
        </div>
      ))}
      {guides.guides.map((g, i) =>
        g.axis === 'x' ? (
          <div key={i} className="wbi-guide" style={{ left: g.pos, top: g.from, width: Math.max(1, inv), height: g.to - g.from }} />
        ) : (
          <div key={i} className="wbi-guide" style={{ top: g.pos, left: g.from, height: Math.max(1, inv), width: g.to - g.from }} />
        )
      )}
      {guides.spacing.map((g, i) => (
        <SpacingMark key={'s' + i} g={g} inv={inv} />
      ))}
      {guides.sizes.map((m, i) => (
        <SizeMarks key={'m' + i} m={m} inv={inv} resized={guides.resized} pageW={pageW} pageH={pageH} />
      ))}
      {guides.resized && <DimLabel r={guides.resized} inv={inv} pageH={pageH} />}
      {lasso && <div className="wbi-lasso" style={{ left: lasso.x, top: lasso.y, width: lasso.width, height: lasso.height, borderWidth: inv }} />}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Smart guide overlays (equal spacing, match size, size readout)
// ---------------------------------------------------------------------------------------------

interface SnapOverlay {
  guides: Guide[]
  spacing: SpacingGuide[]
  sizes: SizeMatch[]
  /** rect being resized (size readout) */
  resized?: Rect
}
const NO_SNAP: SnapOverlay = { guides: [], spacing: [], sizes: [] }

const fmtPx = (n: number) => String(Math.round(n * 10) / 10)

/** Figma-style distance guide: a measured segment with end ticks and a value pill. */
function SpacingMark({ g, inv }: { g: SpacingGuide; inv: number }) {
  const t = Math.max(1, inv)
  const tick = 6 * inv
  const len = g.to - g.from
  if (len <= 0) return null
  const horizontal = g.axis === 'x'
  const line: CSSProperties = horizontal ? { left: g.from, top: g.at - t / 2, width: len, height: t } : { top: g.from, left: g.at - t / 2, height: len, width: t }
  const tickStyle = (pos: number): CSSProperties => (horizontal ? { left: pos - t / 2, top: g.at - tick / 2, width: t, height: tick } : { top: pos - t / 2, left: g.at - tick / 2, height: t, width: tick })
  const mid = (g.from + g.to) / 2
  const pill: CSSProperties = {
    fontSize: 11 * inv,
    padding: `${1 * inv}px ${4 * inv}px`,
    borderRadius: 3 * inv,
    ...(horizontal ? { left: mid, top: g.at + 4 * inv, transform: 'translateX(-50%)' } : { top: mid, left: g.at + 4 * inv, transform: 'translateY(-50%)' })
  }
  return (
    <>
      <div className="wbi-spacing" style={line} />
      <div className="wbi-spacing" style={tickStyle(g.from)} />
      <div className="wbi-spacing" style={tickStyle(g.to)} />
      <div className="wbi-spacing-pill" style={pill}>
        {fmtPx(g.value)}
      </div>
    </>
  )
}

/** Match-size indicator: a dimension bar with the shared value on each matching neighbor. */
function SizeMarks({ m, inv, resized, pageW, pageH }: { m: SizeMatch; inv: number; resized?: Rect; pageW: number; pageH: number }) {
  const t = Math.max(1, inv)
  const all = resized ? [...m.rects, resized] : m.rects
  return (
    <>
      {all.map((r, i) => {
        // outside the rect (below / right of it) unless that would leave the page — then just inside the edge
        const below = r.y + r.height + 24 * inv <= pageH
        const beside = r.x + r.width + 48 * inv <= pageW
        const by = below ? r.y + r.height + 4 * inv : r.y + r.height - 4 * inv - t
        const bx = beside ? r.x + r.width + 4 * inv : r.x + r.width - 4 * inv - t
        const bar: CSSProperties = m.dim === 'width' ? { left: r.x, top: by, width: r.width, height: t } : { left: bx, top: r.y, height: r.height, width: t }
        const pill: CSSProperties = {
          fontSize: 10 * inv,
          padding: `${0.5 * inv}px ${3 * inv}px`,
          borderRadius: 3 * inv,
          ...(m.dim === 'width'
            ? { left: r.x + r.width / 2, top: below ? by + 2 * inv : by - 2 * inv, transform: below ? 'translateX(-50%)' : 'translate(-50%, -100%)' }
            : { left: beside ? bx + 2 * inv : bx - 2 * inv, top: r.y + r.height / 2, transform: beside ? 'translateY(-50%)' : 'translate(-100%, -50%)' })
        }
        return (
          <div key={i}>
            <div className="wbi-sizematch" style={bar} />
            <div className="wbi-sizematch-pill" style={pill}>
              {m.dim === 'width' ? 'W' : 'H'} {fmtPx(m.value)}
            </div>
          </div>
        )
      })}
    </>
  )
}

/** "W × H" readout under the rect being resized. */
function DimLabel({ r, inv, pageH }: { r: Rect; inv: number; pageH: number }) {
  const below = r.y + r.height + 42 * inv <= pageH
  return (
    <div className="wbi-dim-pill" style={{ left: r.x + r.width / 2, top: below ? r.y + r.height + 22 * inv : r.y + r.height - 40 * inv, fontSize: 11 * inv, padding: `${1 * inv}px ${5 * inv}px`, borderRadius: 3 * inv }}>
      {fmtPx(r.width)} × {fmtPx(r.height)}
    </div>
  )
}

/** Small "Back to report" bar used by focus mode / show as table. */
export function FocusBar(props: { onBack(): void; label?: string }) {
  return (
    <div className="wbi-focusbar">
      <button className="wbi-focusbar-back" onClick={props.onBack}>
        <ArrowLeftRegular /> {props.label ?? 'Back to report'}
      </button>
    </div>
  )
}

/** Visual type helper used by callers that need the registry definition (e.g. default sizes). */
export function visualDefOf(v: VisualDocument) {
  return getVisual(visualTypeOf(v))
}
