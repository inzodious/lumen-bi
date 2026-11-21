/**
 * Lumen-only gradient fills for color formatting properties.
 *
 * Power BI's static color properties hold one solid color (`{ solid: { color } }`); its only gradient is the
 * data-driven conditional formatting rule (FillRule `linearGradient2|3`), which Lumen already reads and writes as-is.
 * A gradient *fill* (a color that changes across the shape) has no PBIR equivalent, so Lumen stores it beside the
 * property, in the owner's `annotations` (visual.json / page.json: `{ name, value }` strings that Power BI Desktop
 * preserves and ignores) under the name `Lumen_Fill`:
 *
 *   [{ "object": "background", "prop": "color", "container": true,
 *      "fallback": "#5A7BFF",                                    // the solid color written to the property itself
 *      "gradient": { "kind": "linear", "angle": 135, "stops": [{ "color": "#7B5CFF", "offset": 0 }, { "color": "#3BF0FF", "offset": 1 }] } }]
 *
 * The property itself always keeps a plain solid color (the gradient's blend, `gradientFallback`), so PBIR / PBIX /
 * PBIT exports open in Power BI with a solid fill and no export rewriting is needed. A gradient applies only while
 * the property still holds that fallback: once the color is changed elsewhere (Power BI, a theme, a script), the
 * stale gradient is ignored and the new solid color shows.
 */
import { entryGroupKey } from './entries'
import type { Selector } from './props'
import { parseHex, toHex } from './theme'

export const LUMEN_FILL_ANNOTATION = 'Lumen_Fill'

export interface GradientStop {
  color: string
  /** 0..1 along the gradient */
  offset: number
}

export interface GradientFill {
  kind: 'linear' | 'radial'
  /** degrees, CSS convention (0 = to top, 90 = to right, 180 = to bottom); ignored for radial */
  angle: number
  stops: GradientStop[]
}

export interface FillLocation {
  object: string
  prop: string
  selector?: Selector
  /** visual container objects (`visualContainerObjects`) rather than visual `objects` */
  container?: boolean
}

export interface FillEntry extends FillLocation {
  fallback: string
  gradient: GradientFill
}

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const MAX_STOPS = 8

/** Properties Lumen draws with a gradient (object.prop; `*` = any visual type). Others keep the solid picker. */
const SUPPORTED: Array<{ visualTypes?: string[]; object: string; prop: string; container?: boolean }> = [
  { object: 'background', prop: 'color', container: true },
  { object: 'title', prop: 'background', container: true },
  { visualTypes: ['page'], object: 'background', prop: 'color' },
  { visualTypes: ['page'], object: 'outspace', prop: 'color' },
  { visualTypes: ['shape', 'actionButton'], object: 'fill', prop: 'fillColor' },
  { visualTypes: ['shape'], object: 'outline', prop: 'lineColor' },
  { visualTypes: ['barChart', 'clusteredBarChart', 'stackedBarChart', 'hundredPercentStackedBarChart', 'columnChart', 'clusteredColumnChart', 'stackedColumnChart', 'hundredPercentStackedColumnChart', 'pieChart', 'donutChart', 'funnel'], object: 'dataPoint', prop: 'fill' },
  { visualTypes: ['barChart', 'clusteredBarChart', 'stackedBarChart', 'hundredPercentStackedBarChart', 'columnChart', 'clusteredColumnChart', 'stackedColumnChart', 'hundredPercentStackedColumnChart', 'pieChart', 'donutChart', 'funnel'], object: 'dataPoint', prop: 'defaultColor' }
]

/** Does Lumen draw this color property with a gradient fill? */
export function gradientSupported(visualType: string, object: string, prop: string, container = false): boolean {
  return SUPPORTED.some((s) => s.object === object && s.prop === prop && !!s.container === container && (!s.visualTypes || s.visualTypes.includes(visualType)))
}

/** '#abc' → '#AABBCC'; 6- and 8-digit forms upper-cased. */
function normHex(c: string): string {
  const h = c.slice(1)
  return ('#' + (h.length === 3 ? [...h].map((x) => x + x).join('') : h)).toUpperCase()
}

function clamp(v: unknown, min: number, max: number, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : dflt
}

/** Sanitise a gradient (hex colors only, 2..8 stops sorted by offset, clamped numbers); undefined when invalid. */
export function parseGradient(v: unknown): GradientFill | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as any
  if (!Array.isArray(o.stops)) return undefined
  const raw = o.stops.filter((s: any) => s && typeof s.color === 'string' && COLOR.test(s.color)).slice(0, MAX_STOPS)
  if (raw.length < 2) return undefined
  const stops = raw
    .map((s: any, i: number) => ({ color: normHex(s.color), offset: clamp(s.offset, 0, 1, i / (raw.length - 1)) }))
    .sort((a: GradientStop, b: GradientStop) => a.offset - b.offset)
  return { kind: o.kind === 'radial' ? 'radial' : 'linear', angle: clamp(o.angle, -360, 360, 180), stops }
}

function annotationList(owner: any): any[] | undefined {
  return Array.isArray(owner?.annotations) ? owner.annotations : undefined
}

/** The gradient fills stored on a visual.json / page.json (sanitised; invalid entries dropped). */
export function readFills(owner: any): FillEntry[] {
  const a = annotationList(owner)?.find((x: any) => x && x.name === LUMEN_FILL_ANNOTATION)
  if (!a) return []
  let list: any
  try {
    list = typeof a.value === 'string' ? JSON.parse(a.value) : a.value
  } catch {
    return []
  }
  if (!Array.isArray(list)) return []
  const out: FillEntry[] = []
  for (const e of list) {
    if (!e || typeof e.object !== 'string' || typeof e.prop !== 'string' || typeof e.fallback !== 'string' || !COLOR.test(e.fallback)) continue
    const gradient = parseGradient(e.gradient)
    if (!gradient) continue
    out.push({
      object: e.object,
      prop: e.prop,
      ...(e.selector && typeof e.selector === 'object' ? { selector: e.selector } : {}),
      ...(e.container ? { container: true } : {}),
      fallback: normHex(e.fallback).slice(0, 7),
      gradient
    })
  }
  return out
}

function sameLocation(a: FillLocation, b: FillLocation): boolean {
  return a.object === b.object && a.prop === b.prop && !!a.container === !!b.container && entryGroupKey(a.selector) === entryGroupKey(b.selector)
}

/** The stored entry for a location (regardless of whether it still applies). */
export function findFill(fills: FillEntry[] | undefined, loc: FillLocation): FillEntry | undefined {
  return fills?.find((f) => sameLocation(f, loc))
}

/**
 * Write (or clear with undefined) the gradient of a location on a visual.json / page.json (mutates). The caller writes
 * `fallback` to the property itself in the same edit. The annotation is removed once no gradient is left, so an
 * untouched file round-trips unchanged.
 */
export function writeFill(owner: any, loc: FillLocation, value: { gradient: GradientFill; fallback: string } | undefined): void {
  if (!owner || typeof owner !== 'object') return
  const rest = readFills(owner).filter((f) => !sameLocation(f, loc))
  const next: FillEntry[] = value
    ? [
        ...rest,
        {
          object: loc.object,
          prop: loc.prop,
          ...(loc.selector && entryGroupKey(loc.selector) ? { selector: loc.selector } : {}),
          ...(loc.container ? { container: true } : {}),
          fallback: normHex(value.fallback).slice(0, 7),
          gradient: value.gradient
        }
      ]
    : rest
  const list = annotationList(owner) ?? []
  const others = list.filter((x: any) => !(x && x.name === LUMEN_FILL_ANNOTATION))
  if (next.length) {
    const entry = { name: LUMEN_FILL_ANNOTATION, value: JSON.stringify(next) }
    const i = list.findIndex((x: any) => x && x.name === LUMEN_FILL_ANNOTATION)
    if (i >= 0) list[i] = entry
    else list.push(entry)
    owner.annotations = list
  } else if (others.length !== list.length) {
    if (others.length) owner.annotations = others
    else delete owner.annotations
  }
}

/** The color of a gradient at `t` (0..1), alpha included when a stop has one. */
export function colorAt(g: GradientFill, t: number): string {
  const s = g.stops
  if (t <= s[0].offset) return s[0].color
  if (t >= s[s.length - 1].offset) return s[s.length - 1].color
  let i = 0
  while (i < s.length - 2 && t > s[i + 1].offset) i++
  const a = s[i]
  const b = s[i + 1]
  const k = b.offset === a.offset ? 0 : (t - a.offset) / (b.offset - a.offset)
  const [r1, g1, b1, a1] = parseHex(a.color)
  const [r2, g2, b2, a2] = parseHex(b.color)
  const hex = toHex(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k)
  const alpha = a1 + (a2 - a1) * k
  return alpha < 1 ? hex + Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase() : hex
}

/** The solid color written to the property for Power BI: the gradient's midpoint, opaque. */
export function gradientFallback(g: GradientFill): string {
  return colorAt(g, 0.5).slice(0, 7)
}

/** A starting gradient for a solid color: the color fading to a lighter tint (a darker shade for light colors), top to bottom. */
export function defaultGradient(from: string | undefined): GradientFill {
  const c = from && COLOR.test(from) ? normHex(from).slice(0, 7) : '#118DFF'
  const [r, g, b] = parseHex(c)
  const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.8
  const other = light ? toHex(r * 0.8, g * 0.8, b * 0.8) : toHex(r + (255 - r) * 0.6, g + (255 - g) * 0.6, b + (255 - b) * 0.6)
  return { kind: 'linear', angle: 180, stops: [{ color: c, offset: 0 }, { color: other, offset: 1 }] }
}

function cssColor(hex: string, transparency: number): string {
  const [r, g, b, a] = parseHex(hex)
  const alpha = a * (1 - Math.max(0, Math.min(100, transparency)) / 100)
  return alpha >= 1 ? hex.slice(0, 7) : `rgba(${r},${g},${b},${Math.round(alpha * 1000) / 1000})`
}

/** CSS `background` value; `transparency` (0..100, PBI's) applies to every stop. */
export function gradientCss(g: GradientFill, transparency = 0): string {
  const stops = g.stops.map((s) => `${cssColor(s.color, transparency)} ${Math.round(s.offset * 1000) / 10}%`).join(', ')
  return g.kind === 'radial' ? `radial-gradient(circle at 50% 50%, ${stops})` : `linear-gradient(${g.angle}deg, ${stops})`
}

/** Is this a CSS gradient string (as produced by gradientCss)? */
export function isCssGradient(v: unknown): v is string {
  return typeof v === 'string' && /^(linear|radial)-gradient\(/.test(v)
}

/** SVG gradient attributes (objectBoundingBox units) matching the CSS angle convention. */
export function svgGradientGeometry(g: GradientFill): { x1: number; y1: number; x2: number; y2: number } {
  const rad = ((g.angle - 90) * Math.PI) / 180
  const dx = Math.cos(rad) / 2
  const dy = Math.sin(rad) / 2
  const r = (n: number) => Math.round(n * 10000) / 10000
  return { x1: r(0.5 - dx), y1: r(0.5 - dy), x2: r(0.5 + dx), y2: r(0.5 + dy) }
}

/** A stable element id for a gradient (identical gradients share one id). */
export function gradientId(g: GradientFill, transparency = 0): string {
  const s = JSON.stringify([g.kind, g.angle, g.stops, transparency])
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `lumen-gf-${(h >>> 0).toString(36)}`
}
