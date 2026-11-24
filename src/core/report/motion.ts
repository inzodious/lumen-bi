/**
 * Lumen-only motion: visual animations and page transitions.
 *
 * Power BI Desktop animates some visuals on load and on filter changes, but a report cannot configure it, and it has
 * no page transitions at all. Lumen stores its motion settings in PBIR `annotations` (an array of `{ name, value }`
 * strings that Power BI Desktop preserves and ignores) under the name `Lumen_Motion`, value a JSON object, on three
 * levels. Every key is optional; a level without settings carries no annotation, so untouched reports save unchanged.
 *
 *   report.json  { "animate": false,          // visual animations on load and on data changes (default on)
 *                  "duration": 500,           // ms, visual animations (default 500)
 *                  "stagger": 60,             // ms between visuals entering a page, in reading order (default 0)
 *                  "transition": "fade",      // default page transition (default none), one of PAGE_TRANSITIONS
 *                  "transitionDuration": 350, // ms, page transitions (default 350)
 *                  "easing": "ease-out",      // visual animations' curve, one of MOTION_EASINGS (default smooth)
 *                  "updateDuration": 300,     // ms, animations after a data change (default 0: the same as duration)
 *                  "transitionEasing": "linear", // page transitions' curve (default smooth)
 *                  "drillthrough": "page",    // zoom (default): drill-through grows the page out of the clicked visual and
 *                                             // Back shrinks it into it again; page: use the target page's transition
 *                  "bookmarks": "none" }      // morph (default): applying a bookmark fades and moves the visuals that change
 *   page.json    { "transition": "slide",     // this page's transition, overriding the report default
 *                  "transitionDuration": 800, // ms, and its duration and curve (default: the report's)
 *                  "transitionEasing": "overshoot",
 *                  "stagger": 80 }            // ms between visuals entering this page (default: the report's)
 *   visual.json  { "entrance": "rise",        // auto | fade | rise | zoom | none (default auto: by visual type)
 *                  "delay": 200,              // ms before the visual enters, after its start (below)
 *                  "order": 2,                // place in the page's animation sequence (Animation pane); visuals
 *                                             // without one follow the ordered ones, in reading order
 *                  "start": "after",          // with (default): starts the stagger after the previous visual
 *                                             // starts; after: starts once every visual before it has finished
 *                  "duration": 900,           // ms, overrides the report's duration for this visual
 *                  "easing": "linear",        // overrides the report's curve for this visual
 *                  "update": "none",          // don't animate this visual's data changes (default animate)
 *                  "hover": "enlarge",        // hover effect in reading view: none (default) | brighten | darken |
 *                                             // enlarge | lift (shadow and a small rise)
 *                  "hoverAmount": 10,         // % strength of the hover effect (default 10)
 *                  "pinned": true }           // stays fixed during page transitions (a sidebar, a header): when the
 *                                             // page left has a pinned visual or group in the same place, it holds
 *                                             // still while the rest of the page moves; also on groups (pins children)
 *
 * In Power BI Desktop (PBIP or a PBIX built from it) the annotations are kept and do nothing: visuals animate the way
 * Power BI animates them, and pages switch without a transition.
 */

export const MOTION_ANNOTATION = 'Lumen_Motion'

/**
 * fade, slide, rise and zoom bring the new page in; push, depth, wipe, circle and morph also move the page that leaves
 * (a still copy of it, taken the moment the page changes). morph glides the visuals two pages share (same type, fields
 * and title) from their old place to the new one and cross-fades the rest.
 */
export const PAGE_TRANSITIONS = ['none', 'fade', 'slide', 'push', 'rise', 'zoom', 'depth', 'wipe', 'circle', 'morph'] as const
export type PageTransition = (typeof PAGE_TRANSITIONS)[number]

/** Transitions that animate the page that leaves as well as the one that enters. */
export const TWO_PAGE_TRANSITIONS: ReadonlySet<PageTransition> = new Set(['push', 'depth', 'wipe', 'circle', 'morph'])

export const DRILLTHROUGH_MOTIONS = ['zoom', 'page'] as const
export type DrillthroughMotion = (typeof DRILLTHROUGH_MOTIONS)[number]

export const BOOKMARK_MOTIONS = ['morph', 'none'] as const
export type BookmarkMotion = (typeof BOOKMARK_MOTIONS)[number]

export const VISUAL_ENTRANCES = ['auto', 'fade', 'rise', 'zoom', 'none'] as const
export type VisualEntrance = (typeof VISUAL_ENTRANCES)[number]

/**
 * Animation curves. smooth is Lumen's default (a quick start that settles gently), ease-in speeds up, ease-out slows
 * down, overshoot passes the end a little and comes back.
 */
export const MOTION_EASINGS = ['smooth', 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'overshoot'] as const
export type MotionEasing = (typeof MOTION_EASINGS)[number]

export const EASING_CSS: Readonly<Record<MotionEasing, string>> = Object.freeze({
  smooth: 'cubic-bezier(0.22, 0.8, 0.3, 1)',
  linear: 'linear',
  'ease-in': 'cubic-bezier(0.55, 0, 1, 0.45)',
  'ease-out': 'cubic-bezier(0, 0.55, 0.45, 1)',
  'ease-in-out': 'cubic-bezier(0.65, 0, 0.35, 1)',
  overshoot: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
})

export const HOVER_EFFECTS = ['none', 'brighten', 'darken', 'enlarge', 'lift'] as const
export type HoverEffect = (typeof HOVER_EFFECTS)[number]

export const VISUAL_STARTS = ['with', 'after'] as const
export type VisualStart = (typeof VISUAL_STARTS)[number]

export interface ReportMotion {
  animate: boolean
  duration: number
  stagger: number
  easing: MotionEasing
  /** ms for data-change animations; 0 means the same as `duration` */
  updateDuration: number
  transition: PageTransition
  transitionDuration: number
  transitionEasing: MotionEasing
  drillthrough: DrillthroughMotion
  bookmarks: BookmarkMotion
}

export interface PageMotion {
  transition?: PageTransition
  transitionDuration?: number
  transitionEasing?: MotionEasing
  stagger?: number
}

export interface VisualMotion {
  entrance?: VisualEntrance
  delay?: number
  /** stays fixed during page transitions (no entrance either) */
  pinned?: boolean
  /** place in the page's animation sequence */
  order?: number
  start?: VisualStart
  duration?: number
  easing?: MotionEasing
  /** 'none': data changes don't animate */
  update?: 'animate' | 'none'
  hover?: HoverEffect
  /** % strength of the hover effect */
  hoverAmount?: number
}

export const DEFAULT_REPORT_MOTION: Readonly<ReportMotion> = Object.freeze({
  animate: true,
  duration: 500,
  stagger: 0,
  easing: 'smooth',
  updateDuration: 0,
  transition: 'none',
  transitionDuration: 350,
  transitionEasing: 'smooth',
  drillthrough: 'zoom',
  bookmarks: 'morph'
})

export const MOTION_LIMITS = {
  duration: [100, 2000],
  stagger: [0, 400],
  transitionDuration: [100, 1500],
  delay: [0, 3000],
  updateDuration: [0, 2000],
  visualDuration: [100, 3000],
  order: [0, 9999],
  hoverAmount: [1, 50]
} as const

export const DEFAULT_HOVER_AMOUNT = 10

// ---------------------------------------------------------------------------------------------
// Annotation plumbing
// ---------------------------------------------------------------------------------------------

type Annotation = { name: string; value: string }

function readRaw(json: any): Record<string, unknown> | undefined {
  const list = json?.annotations
  if (!Array.isArray(list)) return undefined
  const a = list.find((x: any) => x && x.name === MOTION_ANNOTATION)
  if (!a || typeof a.value !== 'string') return undefined
  try {
    const o = JSON.parse(a.value)
    return o && typeof o === 'object' && !Array.isArray(o) ? o : undefined
  } catch {
    return undefined
  }
}

function writeRaw(json: any, value: Record<string, unknown> | undefined): void {
  if (!json || typeof json !== 'object') return
  const list: Annotation[] = Array.isArray(json.annotations) ? json.annotations : []
  const i = list.findIndex((x) => x && x.name === MOTION_ANNOTATION)
  const empty = !value || !Object.keys(value).length
  if (empty) {
    if (i >= 0) list.splice(i, 1)
  } else if (i >= 0) list[i] = { ...list[i], value: JSON.stringify(value) }
  else list.push({ name: MOTION_ANNOTATION, value: JSON.stringify(value) })
  if (list.length) json.annotations = list
  else delete json.annotations
}

function clamp(v: unknown, [lo, hi]: readonly [number, number]): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(lo, Math.min(hi, v))) : undefined
}

function oneOf<T extends string>(v: unknown, list: readonly T[]): T | undefined {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

const updateMs = (v: number | undefined) => (v === undefined || v === 0 ? v : Math.max(100, v))

/** The report's motion settings (report.json), defaults filled in. */
export function reportMotion(reportJson: any): ReportMotion {
  const o = readRaw(reportJson) ?? {}
  const d = DEFAULT_REPORT_MOTION
  return {
    animate: typeof o.animate === 'boolean' ? o.animate : d.animate,
    duration: clamp(o.duration, MOTION_LIMITS.duration) ?? d.duration,
    stagger: clamp(o.stagger, MOTION_LIMITS.stagger) ?? d.stagger,
    easing: oneOf(o.easing, MOTION_EASINGS) ?? d.easing,
    updateDuration: updateMs(clamp(o.updateDuration, MOTION_LIMITS.updateDuration)) ?? d.updateDuration,
    transition: oneOf(o.transition, PAGE_TRANSITIONS) ?? d.transition,
    transitionDuration: clamp(o.transitionDuration, MOTION_LIMITS.transitionDuration) ?? d.transitionDuration,
    transitionEasing: oneOf(o.transitionEasing, MOTION_EASINGS) ?? d.transitionEasing,
    drillthrough: oneOf(o.drillthrough, DRILLTHROUGH_MOTIONS) ?? d.drillthrough,
    bookmarks: oneOf(o.bookmarks, BOOKMARK_MOTIONS) ?? d.bookmarks
  }
}

/** Change the report's motion settings; only values that differ from the defaults are stored. */
export function setReportMotion(reportJson: any, patch: Partial<ReportMotion>): void {
  const next: ReportMotion = { ...reportMotion(reportJson), ...patch }
  const known = readRaw(reportJson) ?? {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(known)) if (!(k in DEFAULT_REPORT_MOTION)) out[k] = v
  const sane = reportMotion({ annotations: [{ name: MOTION_ANNOTATION, value: JSON.stringify(next) }] })
  for (const k of Object.keys(DEFAULT_REPORT_MOTION) as Array<keyof ReportMotion>) if (sane[k] !== DEFAULT_REPORT_MOTION[k]) out[k] = sane[k]
  writeRaw(reportJson, out)
}

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------

const PAGE_KEYS = ['transition', 'transitionDuration', 'transitionEasing', 'stagger'] as const

function cleanPage(o: Record<string, unknown>): PageMotion {
  const out: PageMotion = {}
  const t = oneOf(o.transition, PAGE_TRANSITIONS)
  if (t) out.transition = t
  const d = clamp(o.transitionDuration, MOTION_LIMITS.transitionDuration)
  if (d !== undefined) out.transitionDuration = d
  const e = oneOf(o.transitionEasing, MOTION_EASINGS)
  if (e) out.transitionEasing = e
  const s = clamp(o.stagger, MOTION_LIMITS.stagger)
  if (s !== undefined) out.stagger = s
  return out
}

export function pageMotion(pageJson: any): PageMotion {
  return cleanPage(readRaw(pageJson) ?? {})
}

/** Change the page's settings; a key set to `undefined` goes back to the report default. */
export function setPageMotion(pageJson: any, patch: PageMotion): void {
  const known = readRaw(pageJson) ?? {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(known)) if (!(PAGE_KEYS as readonly string[]).includes(k)) out[k] = v
  Object.assign(out, cleanPage({ ...pageMotion(pageJson), ...patch }))
  writeRaw(pageJson, out)
}

/** The transition a page enters with: its own, else the report's default. */
export function pageTransition(reportJson: any, pageJson: any): PageTransition {
  return pageMotion(pageJson).transition ?? reportMotion(reportJson).transition
}

/** How a page's transition plays: kind, duration and curve, the page's own settings over the report's. */
export function pageTransitionTiming(reportJson: any, pageJson: any): { kind: PageTransition; duration: number; easing: MotionEasing } {
  const r = reportMotion(reportJson)
  const p = pageMotion(pageJson)
  return { kind: p.transition ?? r.transition, duration: p.transitionDuration ?? r.transitionDuration, easing: p.transitionEasing ?? r.transitionEasing }
}

// ---------------------------------------------------------------------------------------------
// Visual
// ---------------------------------------------------------------------------------------------

const VISUAL_KEYS = ['entrance', 'delay', 'pinned', 'order', 'start', 'duration', 'easing', 'update', 'hover', 'hoverAmount'] as const

function cleanVisual(o: Record<string, unknown>): VisualMotion {
  const out: VisualMotion = {}
  const e = oneOf(o.entrance, VISUAL_ENTRANCES)
  if (e && e !== 'auto') out.entrance = e
  const d = clamp(o.delay, MOTION_LIMITS.delay)
  if (d) out.delay = d
  if (o.pinned === true) out.pinned = true
  const n = clamp(o.order, MOTION_LIMITS.order)
  if (n !== undefined) out.order = n
  if (o.start === 'after') out.start = 'after'
  const ms = clamp(o.duration, MOTION_LIMITS.visualDuration)
  if (ms !== undefined) out.duration = ms
  const ease = oneOf(o.easing, MOTION_EASINGS)
  if (ease) out.easing = ease
  if (o.update === 'none') out.update = 'none'
  const h = oneOf(o.hover, HOVER_EFFECTS)
  if (h && h !== 'none') {
    out.hover = h
    const a = clamp(o.hoverAmount, MOTION_LIMITS.hoverAmount)
    if (a !== undefined && a !== DEFAULT_HOVER_AMOUNT) out.hoverAmount = a
  }
  return out
}

/**
 * CSS for a visual's hover effect at full strength (the container eases into it): brighten and darken change the
 * brightness, enlarge scales the visual up from its center, lift raises it a little with a shadow. Undefined for none.
 * Everything stays inside the canvas (the page clips its visuals).
 */
export function hoverStyle(m: VisualMotion): { filter?: string; transform?: string; boxShadow?: string } | undefined {
  const a = (m.hoverAmount ?? DEFAULT_HOVER_AMOUNT) / 100
  switch (m.hover) {
    case 'brighten':
      return { filter: `brightness(${round2(1 + a)})` }
    case 'darken':
      return { filter: `brightness(${round2(Math.max(0.1, 1 - a))})` }
    case 'enlarge':
      return { transform: `scale(${round2(1 + a)})` }
    case 'lift':
      return { transform: `translateY(${-Math.round(a * 40)}px)`, boxShadow: `0 ${Math.round(a * 80)}px ${Math.round(a * 160)}px rgba(0, 0, 0, 0.28)` }
    default:
      return undefined
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100

/**
 * Where an enlarging visual grows from (CSS transform-origin, in %), so that it stays on the canvas: from its center
 * when there is room, else pushed toward the edge it sits against. `rect` and `page` are in page pixels.
 */
export function hoverOrigin(rect: { x: number; y: number; width: number; height: number }, page: { width: number; height: number }, scale: number): string {
  const axis = (pos: number, size: number, total: number) => {
    const grow = size * (scale - 1)
    if (grow <= 0 || size <= 0) return 50
    const lo = (pos + size + grow - total) / grow
    const hi = pos / grow
    const f = lo > hi ? 0.5 : Math.min(Math.max(0.5, Math.max(0, lo)), Math.min(1, hi))
    return Math.round(f * 1000) / 10
  }
  return `${axis(rect.x, rect.width, page.width)}% ${axis(rect.y, rect.height, page.height)}%`
}

export function visualMotion(visualJson: any): VisualMotion {
  return cleanVisual(readRaw(visualJson) ?? {})
}

/** Change the visual's settings; a key set to `undefined` goes back to its default. */
export function setVisualMotion(visualJson: any, patch: VisualMotion): void {
  const known = readRaw(visualJson) ?? {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(known)) if (!(VISUAL_KEYS as readonly string[]).includes(k)) out[k] = v
  Object.assign(out, cleanVisual({ ...visualMotion(visualJson), ...patch }))
  writeRaw(visualJson, out)
}

/** A visual is pinned when it, or a group it sits in, is pinned. */
export function isPinned(visuals: Array<{ name: string; json?: any }>, name: string): boolean {
  const byName = new Map(visuals.map((v) => [v.name, v]))
  const seen = new Set<string>()
  let v = byName.get(name)
  while (v && !seen.has(v.name)) {
    if (visualMotion(v.json).pinned) return true
    seen.add(v.name)
    v = byName.get(v.json?.parentGroupName)
  }
  return false
}

// ---------------------------------------------------------------------------------------------
// How each visual type moves
// ---------------------------------------------------------------------------------------------

/**
 * The animation family of a visual type, used for `entrance: auto`:
 *  - `marks`: charts whose renderers tag their data marks (bars grow from the axis, lines draw, slices sweep, points pop,
 *    values count) and morph from the old values to the new ones when the data changes
 *  - `fade`: data visuals drawn without tagged marks (tables, matrices, maps, custom visuals) fade in on entry
 *  - `still`: slicers, text, shapes, images and buttons don't move (as in Power BI)
 */
export function motionFamily(visualType: string): 'marks' | 'fade' | 'still' {
  const t = visualType.toLowerCase()
  if (/slicer|textbox|shape|image|actionbutton|basicshape|bookmarknavigator|pagenavigator|group|qna|filter/.test(t)) return 'still'
  if (/chart|column|bar|line|area|pie|donut|funnel|waterfall|treemap|gauge|card|kpi|ribbon|scatter/.test(t)) return 'marks'
  return 'fade'
}

/** Delay before a visual enters: its own delay plus the report's stagger times its place in reading order. */
export function entranceDelay(motion: ReportMotion, own: VisualMotion, order: number): number {
  return Math.max(0, (own.delay ?? 0) + motion.stagger * Math.max(0, order))
}

/** Whether a visual plays an entrance at all: not pinned, not switched off, and not a still type left on auto. */
export function hasEntrance(visualType: string, own: VisualMotion, pinned = false): boolean {
  if (pinned || own.pinned || own.entrance === 'none') return false
  return motionFamily(visualType) !== 'still' || !!own.entrance
}

/**
 * How long an entrance runs. Charts that animate their marks one after another (bars, points) spread them over up to
 * 40% of the duration (at most 400 ms) on top of it; this is the time the last mark finishes, close enough for the
 * sequence (a few mark kinds run slightly longer or shorter).
 */
export function entranceSpan(visualType: string, own: VisualMotion, duration: number): number {
  const marks = motionFamily(visualType) === 'marks' && (own.entrance ?? 'auto') === 'auto'
  return Math.round(duration + (marks ? Math.min(duration * 0.4, 400) : 0))
}

export interface ScheduledEntrance {
  name: string
  /** place in the sequence, from 0 */
  index: number
  /** ms after the page appears */
  start: number
  duration: number
  /** when the entrance has finished (start + span) */
  end: number
  easing: MotionEasing
  /** with or after the previous visual */
  mode: VisualStart
}

export interface SequenceVisual {
  name: string
  type: string
  json?: any
  /** reading order (top to bottom, left to right) */
  reading: number
  pinned?: boolean
}

/** The visuals of a page that enter, in sequence order: their own `order` first, then the rest in reading order. */
export function sequenceOrder<T extends SequenceVisual>(visuals: T[]): T[] {
  const list = visuals.filter((v) => hasEntrance(v.type, visualMotion(v.json), v.pinned))
  return list.sort((a, b) => {
    const oa = visualMotion(a.json).order
    const ob = visualMotion(b.json).order
    if (oa !== undefined && ob !== undefined && oa !== ob) return oa - ob
    if (oa !== undefined && ob === undefined) return -1
    if (oa === undefined && ob !== undefined) return 1
    return a.reading - b.reading
  })
}

/**
 * When each visual of a page enters. Each visual has a trigger: the first at 0, one that starts "with" the previous at
 * the previous trigger plus the stagger, one that starts "after" the previous once every visual before it has
 * finished. The visual starts its delay after its trigger. With no orders, starts or durations set this is the
 * report's stagger in reading order plus each visual's delay, as before the sequence existed.
 */
export function entranceSchedule(report: ReportMotion, page: PageMotion, visuals: SequenceVisual[]): Map<string, ScheduledEntrance> {
  const stagger = page.stagger ?? report.stagger
  const out = new Map<string, ScheduledEntrance>()
  let trigger = 0
  let lastEnd = 0
  sequenceOrder(visuals).forEach((v, i) => {
    const own = visualMotion(v.json)
    const mode = own.start ?? 'with'
    if (i > 0) trigger = mode === 'after' ? lastEnd : trigger + stagger
    const start = trigger + (own.delay ?? 0)
    const duration = own.duration ?? report.duration
    const end = start + entranceSpan(v.type, own, duration)
    lastEnd = Math.max(lastEnd, end)
    out.set(v.name, { name: v.name, index: i, start, duration, end, easing: own.easing ?? report.easing, mode })
  })
  return out
}

/** Put visuals in this sequence order (Animation pane drag and drop); every visual named gets its place. */
export function setSequence(visuals: Array<{ name: string; json?: any }>, names: string[]): void {
  const byName = new Map(visuals.map((v) => [v.name, v]))
  names.forEach((n, i) => {
    const v = byName.get(n)
    if (v?.json) setVisualMotion(v.json, { order: i })
  })
}

/** Back to reading order: drop every visual's `order`. */
export function clearSequence(visuals: Array<{ json?: any }>): void {
  for (const v of visuals) if (v.json && visualMotion(v.json).order !== undefined) setVisualMotion(v.json, { order: undefined })
}

/**
 * What makes two visuals on different pages "the same" for the morph transition: type, bound fields and title.
 * Undefined for visuals that carry neither fields nor a title (shapes, plain images), which never glide.
 */
export function visualMatchKey(visualJson: any): string | undefined {
  const v = visualJson?.visual
  if (!v) return undefined
  const refs: string[] = []
  for (const [role, st] of Object.entries<any>(v.query?.queryState ?? {}))
    for (const p of st?.projections ?? []) refs.push(`${role}=${p?.queryRef ?? JSON.stringify(p?.field ?? null)}`)
  const title = v.visualContainerObjects?.title?.[0]?.properties?.text?.expr?.Literal?.Value
  if (!refs.length && !title) return undefined
  return [v.visualType ?? '', refs.sort().join('|'), title ?? ''].join('#')
}

/** Pairs of visuals (old page name -> new page name) that glide in a morph: keys found exactly once on each page. */
export function morphPairs(from: Array<{ name: string; json?: any }>, to: Array<{ name: string; json?: any }>): Map<string, string> {
  // pinned visuals hold still instead of gliding
  const index = (list: Array<{ name: string; json?: any }>) => {
    const m = new Map<string, string | null>()
    for (const v of list) {
      if (isPinned(list, v.name)) continue
      const k = visualMatchKey(v.json)
      if (k) m.set(k, m.has(k) ? null : v.name)
    }
    return m
  }
  const a = index(from)
  const b = index(to)
  const out = new Map<string, string>()
  for (const [k, n] of a) {
    const m = b.get(k)
    if (n && m) out.set(n, m)
  }
  return out
}

/** Reading order of visuals (top to bottom, then left to right, in rows of `band` px). */
export function readingOrder(rects: Array<{ name: string; x: number; y: number }>, band = 40): Map<string, number> {
  const sorted = [...rects].sort((a, b) => Math.floor(a.y / band) - Math.floor(b.y / band) || a.x - b.x || a.y - b.y)
  return new Map(sorted.map((r, i) => [r.name, i]))
}

// ---------------------------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------------------------

/** What a published report carries, for the publish manifest and the Publish dialog. */
export interface MotionSummary {
  animate: boolean
  /** distinct page transitions in use (the default and every page override) */
  transitions: PageTransition[]
}

export function motionSummary(report: { report?: any; pages: Array<{ json?: any }> }): MotionSummary {
  const m = reportMotion(report.report)
  const set = new Set<PageTransition>()
  for (const p of report.pages) {
    const t = pageTransition(report.report, p.json)
    if (t !== 'none') set.add(t)
  }
  return { animate: m.animate, transitions: [...set] }
}

/** Turn every animation and transition off (publish without motion): report switch off, page and visual settings cleared. */
export function stripMotion(report: { report?: any; pages: Array<{ json?: any; visuals: Array<{ json?: any }> }> }): void {
  if (report.report) {
    writeRaw(report.report, undefined)
    setReportMotion(report.report, { animate: false, drillthrough: 'page', bookmarks: 'none' })
  }
  for (const p of report.pages) {
    writeRaw(p.json, undefined)
    for (const v of p.visuals) writeRaw(v.json, undefined)
  }
}
