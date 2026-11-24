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
 *                  "transition": "fade",      // default page transition: none | fade | slide | rise | zoom (default none)
 *                  "transitionDuration": 350 }// ms, page transitions (default 350)
 *   page.json    { "transition": "slide" }    // this page's transition, overriding the report default
 *   visual.json  { "entrance": "rise",        // auto | fade | rise | zoom | none (default auto: by visual type)
 *                  "delay": 200 }             // ms before the visual enters (added to the report's stagger)
 *
 * In Power BI Desktop (PBIP or a PBIX built from it) the annotations are kept and do nothing: visuals animate the way
 * Power BI animates them, and pages switch without a transition.
 */

export const MOTION_ANNOTATION = 'Lumen_Motion'

export const PAGE_TRANSITIONS = ['none', 'fade', 'slide', 'rise', 'zoom'] as const
export type PageTransition = (typeof PAGE_TRANSITIONS)[number]

export const VISUAL_ENTRANCES = ['auto', 'fade', 'rise', 'zoom', 'none'] as const
export type VisualEntrance = (typeof VISUAL_ENTRANCES)[number]

export interface ReportMotion {
  animate: boolean
  duration: number
  stagger: number
  transition: PageTransition
  transitionDuration: number
}

export interface PageMotion {
  transition?: PageTransition
}

export interface VisualMotion {
  entrance?: VisualEntrance
  delay?: number
}

export const DEFAULT_REPORT_MOTION: Readonly<ReportMotion> = Object.freeze({ animate: true, duration: 500, stagger: 0, transition: 'none', transitionDuration: 350 })

export const MOTION_LIMITS = {
  duration: [100, 2000],
  stagger: [0, 400],
  transitionDuration: [100, 1500],
  delay: [0, 3000]
} as const

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

/** The report's motion settings (report.json), defaults filled in. */
export function reportMotion(reportJson: any): ReportMotion {
  const o = readRaw(reportJson) ?? {}
  const d = DEFAULT_REPORT_MOTION
  return {
    animate: typeof o.animate === 'boolean' ? o.animate : d.animate,
    duration: clamp(o.duration, MOTION_LIMITS.duration) ?? d.duration,
    stagger: clamp(o.stagger, MOTION_LIMITS.stagger) ?? d.stagger,
    transition: oneOf(o.transition, PAGE_TRANSITIONS) ?? d.transition,
    transitionDuration: clamp(o.transitionDuration, MOTION_LIMITS.transitionDuration) ?? d.transitionDuration
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

export function pageMotion(pageJson: any): PageMotion {
  const o = readRaw(pageJson) ?? {}
  const t = oneOf(o.transition, PAGE_TRANSITIONS)
  return t ? { transition: t } : {}
}

/** Set (or with `undefined`, clear back to the report default) the page's transition. */
export function setPageMotion(pageJson: any, patch: PageMotion): void {
  const known = readRaw(pageJson) ?? {}
  const out: Record<string, unknown> = { ...known }
  const t = oneOf(patch.transition, PAGE_TRANSITIONS)
  if (t) out.transition = t
  else delete out.transition
  writeRaw(pageJson, out)
}

/** The transition a page enters with: its own, else the report's default. */
export function pageTransition(reportJson: any, pageJson: any): PageTransition {
  return pageMotion(pageJson).transition ?? reportMotion(reportJson).transition
}

// ---------------------------------------------------------------------------------------------
// Visual
// ---------------------------------------------------------------------------------------------

export function visualMotion(visualJson: any): VisualMotion {
  const o = readRaw(visualJson) ?? {}
  const out: VisualMotion = {}
  const e = oneOf(o.entrance, VISUAL_ENTRANCES)
  if (e && e !== 'auto') out.entrance = e
  const d = clamp(o.delay, MOTION_LIMITS.delay)
  if (d) out.delay = d
  return out
}

export function setVisualMotion(visualJson: any, patch: VisualMotion): void {
  const known = readRaw(visualJson) ?? {}
  const merged = { ...visualMotion(visualJson), ...patch }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(known)) if (k !== 'entrance' && k !== 'delay') out[k] = v
  const e = oneOf(merged.entrance, VISUAL_ENTRANCES)
  if (e && e !== 'auto') out.entrance = e
  const d = clamp(merged.delay, MOTION_LIMITS.delay)
  if (d) out.delay = d
  writeRaw(visualJson, out)
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
    setReportMotion(report.report, { animate: false })
  }
  for (const p of report.pages) {
    writeRaw(p.json, undefined)
    for (const v of p.visuals) writeRaw(v.json, undefined)
  }
}
