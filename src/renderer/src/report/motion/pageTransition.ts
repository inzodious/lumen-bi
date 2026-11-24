/**
 * Page transitions (Lumen extension: Power BI has none), drill-through zoom and bookmark morphs.
 *
 * A page canvas mounts once per page. fade, slide, rise and zoom are entrances of the new page. The other transitions
 * also move the page that leaves: the moment the active page changes (a store subscription runs before React commits),
 * the old page is cloned as a still "ghost" (canvases copied), and when the new page mounts the ghost is laid behind or
 * over it in the viewport and both animate. Everything animates transform, opacity or clip-path only, so the
 * compositor does the work and nothing re-renders. The ghost is removed when its animation ends.
 *
 *  - push: the old page slides out while the new one slides in, in the direction of travel through the page order
 *  - depth: the old page sinks back and fades while the new one rises to the front
 *  - wipe: the new page is uncovered by a straight edge moving in the direction of travel
 *  - circle: the new page is uncovered by a circle opening from the point clicked (the tab or button), else the center
 *  - morph: visuals both pages share (core visualMatchKey) glide from their old place to the new one; the rest cross-fade
 *  - drill-through (report `drillthrough: zoom`): the target page grows out of the visual clicked, and Back shrinks it
 *    into that visual again
 *  - bookmarks (report `bookmarks: morph`): applying a bookmark on the same page fades the visuals it shows or hides and
 *    moves the ones it moves
 *
 * Pinned visuals and groups (visual `pinned`, e.g. a sidebar) hold still through every transition: when the page left
 * had a pinned item of the same type in the same place, a still copy of it stays on top while both pages move, and the
 * new page's own copy takes over (a short cross-fade) when the transition ends.
 *
 * The first page shown in a window, and pages opened while editing, appear without a transition.
 */
import { morphPairs, pageTransition, reportMotion, TWO_PAGE_TRANSITIONS, type PageTransition, type ReportMotion } from '@core/report/motion'
import type { VisualDocument } from '@core/report/types'
import { useApp } from '../../state/store'
import { EASING, MOTION_ANIMATION_ID } from './animator'
import { motionAllowed } from './env'

let last: { pages: string[]; index: number } | null = null

/** Remember the page that was shown; returns -1 / 1 for the direction of travel, 0 when there was no previous page of this report. */
export function notePageShown(pageOrder: string[], page: string): -1 | 0 | 1 {
  const index = pageOrder.indexOf(page)
  const prev = last
  last = { pages: pageOrder, index }
  if (!prev || prev.pages.length !== pageOrder.length || prev.pages.some((p, i) => p !== pageOrder[i])) return 0
  if (prev.index === index) return 0
  return index > prev.index ? 1 : -1
}

/** Forget the last page (a different report opened). */
export function resetPageHistory(): void {
  last = null
  snapshot = null
  drillOrigins.clear()
}

const shiftFor = (width: number) => Math.round(Math.min(160, Math.max(24, width * 0.12)))

/** Keyframes of the entering page when there is no old page to move (and for the one-page transitions). */
export function transitionFrames(kind: PageTransition, direction: -1 | 1, width: number): Keyframe[] | null {
  const shift = shiftFor(width)
  switch (kind) {
    case 'fade':
    case 'morph':
      return [{ opacity: 0 }, { opacity: 1 }]
    case 'slide':
    case 'push':
      return [{ opacity: 0, transform: `translateX(${direction * shift}px)` }, { opacity: 1, transform: 'none' }]
    case 'rise':
      return [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }]
    case 'zoom':
      return [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }]
    case 'depth':
      return [{ opacity: 0, transform: 'translateY(16px) scale(0.98)' }, { opacity: 1, transform: 'none' }]
    case 'wipe':
      return [{ clipPath: direction > 0 ? 'inset(0 100% 0 0)' : 'inset(0 0 0 100%)' }, { clipPath: 'inset(0 0 0 0)' }]
    case 'circle':
      return [{ clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(71% at 50% 50%)' }]
    default:
      return null
  }
}

export interface TwoPageFrames {
  enter: Keyframe[]
  leave: Keyframe[]
  /** the old page is drawn over the new one (else behind it) */
  ghostAbove?: boolean
}

/**
 * Keyframes for a transition that moves both pages. `origin` is the circle's center in the new page's box (px), `size`
 * that box. For morph, the shared visuals get their own frames (morphFrames).
 */
export function twoPageFrames(kind: PageTransition, direction: -1 | 1, size: { width: number; height: number }, origin?: { x: number; y: number }): TwoPageFrames | null {
  const shift = shiftFor(size.width)
  switch (kind) {
    case 'push':
      return {
        enter: [{ opacity: 0, transform: `translateX(${direction * shift}px)` }, { opacity: 1, transform: 'none' }],
        leave: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-direction * shift}px)` }]
      }
    case 'depth':
      return {
        enter: [{ opacity: 0, transform: 'translateY(16px) scale(0.98)' }, { opacity: 1, transform: 'none' }],
        leave: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.92)' }]
      }
    case 'wipe':
      return { enter: transitionFrames('wipe', direction, size.width)!, leave: [{ opacity: 1 }, { opacity: 1 }] }
    case 'circle': {
      const o = origin ?? { x: size.width / 2, y: size.height / 2 }
      const r = Math.ceil(Math.max(Math.hypot(o.x, o.y), Math.hypot(size.width - o.x, o.y), Math.hypot(o.x, size.height - o.y), Math.hypot(size.width - o.x, size.height - o.y)))
      const at = `at ${Math.round(o.x)}px ${Math.round(o.y)}px`
      return { enter: [{ clipPath: `circle(0px ${at})` }, { clipPath: `circle(${r}px ${at})` }], leave: [{ opacity: 1 }, { opacity: 1 }] }
    }
    case 'morph':
      return { enter: [{ opacity: 1 }, { opacity: 1 }], leave: [{ opacity: 1 }, { opacity: 0 }], ghostAbove: true }
    default:
      return null
  }
}

type Box = { left: number; top: number; width: number; height: number }

/** A transform that puts box `to` where box `from` is (transform-origin 0 0), or 'none' when they match. */
export function boxTransform(from: Box, to: Box, localScale = 1): string {
  const dx = (from.left - to.left) / localScale
  const dy = (from.top - to.top) / localScale
  const sx = to.width ? from.width / to.width : 1
  const sy = to.height ? from.height / to.height : 1
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) return 'none'
  return `translate(${round(dx)}px, ${round(dy)}px) scale(${round(sx, 4)}, ${round(sy, 4)})`
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d

// ---------------------------------------------------------------------------------------------
// The old page: captured when the active page changes
// ---------------------------------------------------------------------------------------------

type Nav = 'page' | 'drill' | 'back'

interface Snapshot {
  from: string
  to: string
  at: number
  nav: Nav
  /** clone of the old page's shadow box */
  node: HTMLElement
  rect: Box
  /** client boxes of the old page's visual containers; local = their on-screen scale */
  visuals: Map<string, { box: Box; el: HTMLElement; local: number }>
  /** the old page's pinned visuals and groups (outermost only) */
  pins: Pin[]
  fromVisuals: VisualDocument[]
  pointer?: { x: number; y: number }
}

interface Pin {
  /** data-type of a visual, 'group' for a group */
  kind: string
  /** selector of the item inside the page (and inside the snapshot's clone) */
  selector: string
  box: Box
  el: HTMLElement
  local: number
}

let snapshot: Snapshot | null = null
let pendingNav: { nav: Nav; at: number } | null = null
let pointer: { x: number; y: number; at: number; page?: string; visual?: string } | null = null
let lastVisualPointer: { page: string; visual: string; at: number } | null = null
/** drill-through page -> where it was drilled from (Back zooms into that visual) */
const drillOrigins = new Map<string, { page: string; visual: string }>()

const FRESH_MS = 1500

/** runtime.drillthrough / goBack say what kind of navigation the next page change is. */
export function noteNavigation(nav: 'drill' | 'back'): void {
  pendingNav = { nav, at: performance.now() }
}

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

function shadowOf(page: string): HTMLElement | null {
  const pageEl = document.querySelector<HTMLElement>(`.wbi-report .wbi-page[data-page="${CSS.escape(page)}"]`)
  const outer = pageEl?.closest<HTMLElement>('.wbi-page-outer')
  if (!outer) return null
  return outer.parentElement?.classList.contains('wbi-page-shadow') ? outer.parentElement : outer
}

/** A still copy of an element: a deep clone with its canvases' pixels copied (cloneNode leaves them blank). */
export function stillCopy<T extends HTMLElement>(el: T): T {
  const copy = el.cloneNode(true) as T
  const src = el.querySelectorAll('canvas')
  if (src.length) {
    const dst = copy.querySelectorAll('canvas')
    src.forEach((c, i) => {
      try {
        dst[i]?.getContext('2d')?.drawImage(c, 0, 0)
      } catch {
        /* tainted or lost context: leave it blank */
      }
    })
  }
  copy.removeAttribute('id')
  copy.setAttribute('aria-hidden', 'true')
  copy.setAttribute('inert', '')
  return copy
}

const localOf = (el: HTMLElement, box: Box) => (el.offsetWidth ? box.width / el.offsetWidth : 1)

/** The outermost pinned visuals and groups inside `root`. */
export function pinsOf(root: ParentNode): Pin[] {
  const out: Pin[] = []
  root.querySelectorAll<HTMLElement>('[data-pinned]').forEach((el) => {
    if (el.parentElement?.closest('[data-pinned]') && root.contains(el.parentElement.closest('[data-pinned]'))) return
    const group = el.dataset.group
    const selector = group ? `.wbi-group[data-group="${CSS.escape(group)}"]` : `.wbi-vc[data-visual="${CSS.escape(el.dataset.visual ?? '')}"]`
    const box = boxOf(el)
    out.push({ kind: group ? 'group' : (el.dataset.type ?? ''), selector, box, el, local: localOf(el, box) })
  })
  return out
}

/** Two pinned items are the same when they have the same kind and stand in the same place (within 2 px). */
export function samePin(a: { kind: string; box: Box }, b: { kind: string; box: Box }): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) <= 2
  return a.kind === b.kind && near(a.box.left, b.box.left) && near(a.box.top, b.box.top) && near(a.box.width, b.box.width) && near(a.box.height, b.box.height)
}

function capture(from: string, to: string, nav: Nav, fromVisuals: VisualDocument[]): void {
  const shadow = shadowOf(from)
  if (!shadow) return
  const visuals = new Map<string, { box: Box; el: HTMLElement; local: number }>()
  shadow.querySelectorAll<HTMLElement>('.wbi-vc[data-visual]').forEach((el) => {
    const box = boxOf(el)
    visuals.set(el.dataset.visual!, { box, el, local: localOf(el, box) })
  })
  const now = performance.now()
  snapshot = { from, to, at: now, nav, node: stillCopy(shadow), rect: boxOf(shadow), visuals, pins: pinsOf(shadow), fromVisuals, pointer: pointer && now - pointer.at < FRESH_MS ? { x: pointer.x, y: pointer.y } : undefined }
}

let installed = false

/** Watch page changes (once per window) so the old page can be captured before it unmounts. */
export function installPageSnapshots(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener(
    'pointerdown',
    (e) => {
      const t = e.target as Element | null
      const vc = t?.closest?.('.wbi-page [data-visual]') as HTMLElement | null
      const page = vc?.closest<HTMLElement>('.wbi-page')?.dataset.page
      pointer = { x: e.clientX, y: e.clientY, at: performance.now(), page, visual: vc?.dataset.visual }
      if (page && vc?.dataset.visual) lastVisualPointer = { page, visual: vc.dataset.visual, at: pointer.at }
    },
    { capture: true }
  )
  useApp.subscribe((s, prev) => {
    if (s.activePage === prev.activePage) return
    const nav = pendingNav && performance.now() - pendingNav.at < FRESH_MS ? pendingNav.nav : 'page'
    pendingNav = null
    snapshot = null
    const from = prev.activePage
    const to = s.activePage
    const report = s.project?.report
    if (!from || !to || !report || s.project?.id !== prev.project?.id) return
    if (nav === 'drill') {
      const lv = lastVisualPointer && lastVisualPointer.page === from && performance.now() - lastVisualPointer.at < 60_000 ? lastVisualPointer.visual : undefined
      if (lv) drillOrigins.set(to, { page: from, visual: lv })
      else drillOrigins.delete(to)
    }
    if (s.editMode || !motionAllowed()) return
    const rm = reportMotion(report.report)
    const target = report.pages.find((p) => p.name === to)
    const kind = pageTransition(report.report, target?.json)
    const zooms = rm.drillthrough === 'zoom' && (nav === 'drill' ? drillOrigins.has(to) : nav === 'back' && drillOrigins.get(from)?.page === to)
    const pins = kind !== 'none' && !!shadowOf(from)?.querySelector('[data-pinned]')
    if (!zooms && !pins && !TWO_PAGE_TRANSITIONS.has(kind)) return
    capture(from, to, nav, report.pages.find((p) => p.name === from)?.visuals ?? [])
  })
}

function takeSnapshot(page: string): Snapshot | null {
  const s = snapshot
  snapshot = null
  return s && s.to === page && performance.now() - s.at < FRESH_MS ? s : null
}

// ---------------------------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------------------------

function animate(el: Element, frames: Keyframe[], duration: number, opts: KeyframeAnimationOptions = {}): Animation | null {
  try {
    const a = el.animate(frames, { duration, easing: EASING, fill: 'backwards', ...opts })
    a.id = MOTION_ANIMATION_ID
    return a
  } catch {
    return null
  }
}

/** Lay a ghost (a still copy of the old page) in the viewport at its old place, behind or over the new page. */
function placeGhost(viewport: HTMLElement, node: HTMLElement, box: Box, above: boolean): HTMLElement {
  const vp = viewport.getBoundingClientRect()
  const holder = document.createElement('div')
  holder.className = 'wbi-transition-ghost'
  holder.setAttribute('aria-hidden', 'true')
  Object.assign(holder.style, {
    position: 'absolute',
    left: `${box.left - vp.left + viewport.scrollLeft}px`,
    top: `${box.top - vp.top + viewport.scrollTop}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    zIndex: above ? '2' : '-1',
    pointerEvents: 'none'
  })
  node.style.margin = '0'
  holder.appendChild(node)
  viewport.appendChild(holder)
  return holder
}

function withGhost(viewport: HTMLElement, ghost: HTMLElement, animations: Array<Animation | null>): void {
  const isolation = viewport.style.isolation
  // a stacking context of its own, so a ghost behind the page (z-index -1) still paints over the viewport's background
  viewport.style.isolation = 'isolate'
  const done = () => {
    ghost.remove()
    if (!viewport.querySelector(':scope > .wbi-transition-ghost')) viewport.style.isolation = isolation
  }
  const live = animations.filter((a): a is Animation => !!a)
  if (!live.length) return done()
  void Promise.allSettled(live.map((a) => a.finished)).then(done)
}

export interface PageEnter {
  /** the new page's shadow box (or outer box) */
  el: HTMLElement
  page: string
  visuals: VisualDocument[]
  kind: PageTransition
  direction: -1 | 1
  motion: ReportMotion
}

/** Play the transition of a page that just mounted (PageCanvas, reading view). */
export function playPageEnter(p: PageEnter): void {
  const snap = takeSnapshot(p.page)
  const viewport = p.el.closest<HTMLElement>('.wbi-viewport')
  // measured before anything moves the new page
  const hold = snap && viewport ? holdPins(p.el, viewport, snap) : null
  const anims = enter(p, snap, viewport)
  hold?.(anims)
}

function enter(p: PageEnter, snap: Snapshot | null, viewport: HTMLElement | null): Array<Animation | null> {
  const duration = p.motion.transitionDuration
  if (snap && viewport && p.motion.drillthrough === 'zoom') {
    if (snap.nav === 'drill') {
      const origin = drillOrigins.get(p.page)
      const from = origin && snap.visuals.get(origin.visual)
      if (from) return drillIn(p.el, viewport, snap, from.box, duration)
    }
    if (snap.nav === 'back') {
      const origin = drillOrigins.get(snap.from)
      const to = origin?.page === p.page ? p.el.querySelector(`.wbi-vc[data-visual="${CSS.escape(origin.visual)}"]`) : null
      if (to) return drillOut(p.el, viewport, snap, boxOf(to), duration)
    }
  }
  if (snap && viewport && TWO_PAGE_TRANSITIONS.has(p.kind)) return playTwoPage(p, snap, viewport)
  return [playPageTransition(p.el, p.kind, p.direction, duration)]
}

/**
 * Pinned items both pages share (same kind, same place): a still copy of the old one stays over everything while the
 * pages move, the new one is hidden until the transition ends and then takes over. Returns the release, given the
 * transition's animations.
 */
function holdPins(el: HTMLElement, viewport: HTMLElement, snap: Snapshot): ((anims: Array<Animation | null>) => void) | null {
  if (!snap.pins.length) return null
  const held: Array<{ el: HTMLElement; copy: HTMLElement }> = []
  const free = [...snap.pins]
  for (const n of pinsOf(el)) {
    const i = free.findIndex((o) => samePin(o, n))
    if (i < 0) continue
    const [o] = free.splice(i, 1)
    const inGhost = snap.node.querySelector<HTMLElement>(o.selector)
    if (inGhost) inGhost.style.visibility = 'hidden'
    // the old page's copy: the new page's visuals may still be drawing (queries, images); a page navigator shows the new
    // page as selected when the new page's own copy takes over at the end
    const copy = flyingCopy(viewport, o.el, o.box, o.local)
    n.el.style.visibility = 'hidden'
    copy.className = 'wbi-transition-pin'
    copy.style.zIndex = '4'
    held.push({ el: n.el, copy })
  }
  if (!held.length) return null
  return (anims) => {
    const release = () =>
      held.forEach(({ el: n, copy }) => {
        n.style.visibility = ''
        const a = animate(copy, [{ opacity: 1 }, { opacity: 0 }], 140, { easing: 'linear', fill: 'forwards' })
        if (a) void a.finished.then(() => copy.remove(), () => copy.remove())
        else copy.remove()
      })
    const live = anims.filter((a): a is Animation => !!a)
    if (!live.length) release()
    else void Promise.allSettled(live.map((a) => a.finished)).then(release)
  }
}

/** The new page's entrance alone (no old page to move). */
export function playPageTransition(el: HTMLElement, kind: PageTransition, direction: -1 | 1, duration: number): Animation | null {
  const frames = transitionFrames(kind, direction, el.offsetWidth)
  return frames ? animate(el, frames, duration) : null
}

function playTwoPage(p: PageEnter, snap: Snapshot, viewport: HTMLElement): Array<Animation | null> {
  const box = boxOf(p.el)
  const origin = snap.pointer && snap.pointer.x >= box.left && snap.pointer.x <= box.left + box.width && snap.pointer.y >= box.top && snap.pointer.y <= box.top + box.height ? { x: snap.pointer.x - box.left, y: snap.pointer.y - box.top } : snap.pointer ? nearestEdgePoint(snap.pointer, box) : undefined
  const frames = twoPageFrames(p.kind, p.direction, { width: box.width, height: box.height }, origin)
  if (!frames) return []
  const duration = p.motion.transitionDuration
  const shared = p.kind === 'morph' ? morphPairs(snap.fromVisuals, p.visuals) : new Map<string, string>()
  const anims: Array<Animation | null> = []
  const flights: HTMLElement[] = []
  for (const [oldName, newName] of shared) {
    const from = snap.visuals.get(oldName)
    const toEl = p.el.querySelector<HTMLElement>(`.wbi-vc[data-visual="${CSS.escape(newName)}"]`)
    if (!from || !toEl) continue
    const to = boxOf(toEl)
    const local = toEl.offsetWidth ? to.width / toEl.offsetWidth : 1
    const t = boxTransform(from.box, to, local)
    // hide the old copy inside the ghost; a copy of its own flies over the ghost while the real visual glides beneath
    const inGhost = snap.node.querySelector<HTMLElement>(`.wbi-vc[data-visual="${CSS.escape(oldName)}"]`)
    if (inGhost) inGhost.style.visibility = 'hidden'
    if (t === 'none') continue
    anims.push(animate(toEl, [{ transform: t, transformOrigin: '0 0' }, { transform: 'none', transformOrigin: '0 0' }], duration))
    const fly = flyingCopy(viewport, from.el, from.box, from.local)
    flights.push(fly)
    anims.push(animate(fly, [{ transform: 'none' }, { transform: flyTransform(from.box, to, 1) }], duration, { fill: 'forwards' }))
    anims.push(animate(fly.firstElementChild!, [{ opacity: 1 }, { opacity: 1, offset: 0.45 }, { opacity: 0 }], duration, { easing: 'linear', fill: 'forwards' }))
  }
  const ghost = placeGhost(viewport, snap.node, snap.rect, !!frames.ghostAbove)
  anims.push(animate(ghost, frames.leave, duration, { fill: 'forwards' }))
  anims.push(animate(p.el, frames.enter, duration))
  withGhost(viewport, ghost, anims)
  if (flights.length) void Promise.allSettled(anims.filter((a): a is Animation => !!a).map((a) => a.finished)).then(() => flights.forEach((f) => f.remove()))
  return anims
}

/** Transform (origin 0 0) of a box placed at `from` that has travelled fraction `t` of the way to `to`. */
export function flyTransform(from: Box, to: Box, t: number): string {
  const e = t
  const dx = (to.left - from.left) * e
  const dy = (to.top - from.top) * e
  const sx = 1 + ((from.width ? to.width / from.width : 1) - 1) * e
  const sy = 1 + ((from.height ? to.height / from.height : 1) - 1) * e
  return `translate(${round(dx)}px, ${round(dy)}px) scale(${round(sx, 4)}, ${round(sy, 4)})`
}

function nearestEdgePoint(pt: { x: number; y: number }, box: Box): { x: number; y: number } {
  return { x: Math.max(0, Math.min(box.width, pt.x - box.left)), y: Math.max(0, Math.min(box.height, pt.y - box.top)) }
}

/** A still copy of a visual of the old page, laid over everything at its old client box. */
function flyingCopy(viewport: HTMLElement, el: HTMLElement, box: Box, local: number): HTMLElement {
  const vp = viewport.getBoundingClientRect()
  const holder = document.createElement('div')
  holder.className = 'wbi-transition-ghost wbi-transition-fly'
  Object.assign(holder.style, {
    position: 'absolute',
    left: `${box.left - vp.left + viewport.scrollLeft}px`,
    top: `${box.top - vp.top + viewport.scrollTop}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    zIndex: '3',
    pointerEvents: 'none',
    transformOrigin: '0 0',
    overflow: 'visible'
  })
  const copy = stillCopy(el)
  Object.assign(copy.style, { left: '0px', top: '0px', position: 'absolute', transform: `scale(${local})`, transformOrigin: '0 0' })
  holder.appendChild(copy)
  viewport.appendChild(holder)
  return holder
}

function drillIn(el: HTMLElement, viewport: HTMLElement, snap: Snapshot, from: Box, duration: number): Array<Animation | null> {
  const to = boxOf(el)
  const d = Math.round(duration * 1.25)
  const ghost = placeGhost(viewport, snap.node, snap.rect, false)
  const anims = [
    animate(ghost, [{ opacity: 1 }, { opacity: 0 }], d, { fill: 'forwards' }),
    animate(el, [{ transform: boxTransform(from, to), transformOrigin: '0 0', opacity: 0 }, { opacity: 1, offset: 0.35 }, { transform: 'none', transformOrigin: '0 0', opacity: 1 }], d)
  ]
  withGhost(viewport, ghost, anims)
  return anims
}

function drillOut(el: HTMLElement, viewport: HTMLElement, snap: Snapshot, to: Box, duration: number): Array<Animation | null> {
  const d = Math.round(duration * 1.25)
  const ghost = placeGhost(viewport, snap.node, snap.rect, true)
  ghost.style.transformOrigin = '0 0'
  const shrink = flyTransform(snap.rect, to, 1)
  const anims = [
    animate(ghost, [{ transform: 'none', opacity: 1 }, { opacity: 1, offset: 0.65 }, { transform: shrink, opacity: 0 }], d, { fill: 'forwards' }),
    animate(el, [{ opacity: 0.4 }, { opacity: 1 }], d)
  ]
  withGhost(viewport, ghost, anims)
  return anims
}

/** Format pane ▸ Preview: play a transition on the open page, with the page itself standing in for the old one. */
export function previewPageTransition(el: HTMLElement, kind: PageTransition, duration: number): void {
  const viewport = el.closest<HTMLElement>('.wbi-viewport')
  if (!viewport || !TWO_PAGE_TRANSITIONS.has(kind)) {
    playPageTransition(el, kind, 1, duration)
    return
  }
  const box = boxOf(el)
  const frames = twoPageFrames(kind, 1, { width: box.width, height: box.height })
  if (!frames) return
  const ghost = placeGhost(viewport, stillCopy(el), box, !!frames.ghostAbove)
  withGhost(viewport, ghost, [animate(ghost, frames.leave, duration, { fill: 'forwards' }), animate(el, kind === 'morph' ? [{ opacity: 0 }, { opacity: 1 }] : frames.enter, duration)])
}

// ---------------------------------------------------------------------------------------------
// Bookmark morph
// ---------------------------------------------------------------------------------------------

interface BookmarkCapture {
  page: string
  at: number
  items: Map<string, { box: Box; el: HTMLElement; parent: string | null }>
}

let bookmarkCapture: BookmarkCapture | null = null

const itemKey = (el: HTMLElement) => (el.dataset.group ? `g:${el.dataset.group}` : `v:${el.dataset.visual}`)

function pageItems(pageEl: HTMLElement): Map<string, { box: Box; el: HTMLElement; parent: string | null }> {
  const out = new Map<string, { box: Box; el: HTMLElement; parent: string | null }>()
  pageEl.querySelectorAll<HTMLElement>('.wbi-vc[data-visual], .wbi-group[data-group]').forEach((el) => {
    const parentGroup = el.parentElement?.closest<HTMLElement>('.wbi-group[data-group]')
    out.set(itemKey(el), { box: boxOf(el), el, parent: parentGroup && pageEl.contains(parentGroup) ? itemKey(parentGroup) : null })
  })
  return out
}

/** runtime.applyBookmark, before it changes anything: remember what the open page shows. */
export function beforeBookmark(page: string | null): void {
  bookmarkCapture = null
  if (!page || typeof document === 'undefined' || !motionAllowed()) return
  const app = useApp.getState()
  if (app.editMode || reportMotion(app.project?.report?.report).bookmarks !== 'morph') return
  const pageEl = document.querySelector<HTMLElement>(`.wbi-report .wbi-page[data-page="${CSS.escape(page)}"]`)
  if (!pageEl) return
  bookmarkCapture = { page, at: performance.now(), items: pageItems(pageEl) }
}

/** PageCanvas, after each commit (before paint): fade in what a bookmark showed, fade out what it hid, move what it moved. */
export function settleBookmarkMorph(pageEl: HTMLElement | null, page: string, duration: number): void {
  const cap = bookmarkCapture
  if (!cap || !pageEl || cap.page !== page) return
  if (performance.now() - cap.at > FRESH_MS) {
    bookmarkCapture = null
    return
  }
  const now = pageItems(pageEl)
  let changed = false
  for (const k of now.keys()) if (!cap.items.has(k)) changed = true
  for (const k of cap.items.keys()) if (!now.has(k)) changed = true
  for (const [k, n] of now) {
    const o = cap.items.get(k)
    if (o && boxTransform(o.box, n.box) !== 'none') changed = true
  }
  // the bookmark's state may land over more than one commit: keep the capture until something changed
  if (!changed) return
  bookmarkCapture = null
  const local = pageEl.offsetWidth ? pageEl.getBoundingClientRect().width / pageEl.offsetWidth : 1
  for (const [k, n] of now) {
    if (n.parent && !cap.items.has(n.parent)) continue
    const o = cap.items.get(k)
    if (!o) animate(n.el, [{ opacity: 0, transform: 'scale(0.98)' }, { opacity: 1, transform: 'none' }], duration)
    else if (!n.parent || cap.items.has(n.parent)) {
      const t = boxTransform(o.box, n.box, local)
      if (t !== 'none') animate(n.el, [{ transform: t, transformOrigin: '0 0' }, { transform: 'none', transformOrigin: '0 0' }], duration)
    }
  }
  for (const [k, o] of cap.items) {
    if (now.has(k) || (o.parent && !now.has(o.parent) && cap.items.has(o.parent))) continue
    const host = o.parent ? now.get(o.parent)?.el : pageEl
    if (!host) continue
    const copy = stillCopy(o.el)
    copy.style.pointerEvents = 'none'
    host.appendChild(copy)
    const a = animate(copy, [{ opacity: 1 }, { opacity: 0 }], Math.round(duration * 0.8), { fill: 'forwards' })
    if (a) void a.finished.then(() => copy.remove(), () => copy.remove())
    else copy.remove()
  }
}
