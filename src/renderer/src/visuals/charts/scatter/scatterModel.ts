/**
 * Pure scatter / bubble chart math (no React): bubble sizing, play-axis frames and trails,
 * analytics statistics, ratio line, symmetry shading, trend lines, marker shapes and
 * category-label placement.
 *
 * Bubble sizing follows Power BI's scatter: bubble *area* (not radius) is proportional to the Size
 * value. The pixel area range is [200, 3000] px² for a 300 × 300 plot and scales with the plot's
 * smaller side squared (the open-sourced PBI scatter used exactly these constants).
 * `bubbles.markerRangeType`:
 *   - 'magnitude': the area range maps [0, max |size|] (a bubble of 0 gets the minimum area)
 *   - 'dataRange': the area range maps [min size, max size]
 *   - 'auto' (default): magnitude when every size is ≥ 0, else data range
 * `bubbles.bubbleSize` (-100…100, theme default -10) scales the radius by (1 + n/100). PBI's exact
 * multiplier curve is not documented; this linear radius factor is an approximation.
 */
import { linearFit, quantile } from '../cartesian/analytics'

// ------------------------------------------------------------------------------------------------
// Bubble sizes
// ------------------------------------------------------------------------------------------------

export type MarkerRangeType = 'auto' | 'magnitude' | 'dataRange'

/** PBI constants (area in px² for a 300 × 300 plot). */
export const BUBBLE_MIN_AREA = 200
export const BUBBLE_MAX_AREA = 3000
const AREA_OF_300_BY_300 = 90000
/** Marker radius (px) when there is no Size field. */
export const DEFAULT_MARKER_RADIUS = 6

export function sizeMultiplier(bubbleSize: number): number {
  const n = Number.isFinite(bubbleSize) ? Math.max(-100, Math.min(100, bubbleSize)) : 0
  return Math.max(0.15, 1 + n / 100)
}

/** Default marker radius (no Size field) after the size multiplier. */
export function markerRadius(bubbleSize: number): number {
  return DEFAULT_MARKER_RADIUS * sizeMultiplier(bubbleSize)
}

/**
 * Bubble radius function for a set of size values on a plot of `plotW × plotH` px.
 * Null sizes get the default marker radius.
 */
export function bubbleScale(sizes: Array<number | null>, opts: { plotW: number; plotH: number; bubbleSize?: number; rangeType?: MarkerRangeType }): (size: number | null) => number {
  const mult = sizeMultiplier(opts.bubbleSize ?? -10)
  const nums = sizes.filter((s): s is number => s !== null && Number.isFinite(s))
  const fallback = DEFAULT_MARKER_RADIUS * mult
  if (!nums.length) return () => fallback
  const side = Math.max(1, Math.min(opts.plotW, opts.plotH))
  const ratio = (side * side) / AREA_OF_300_BY_300
  const minA = BUBBLE_MIN_AREA * ratio
  const maxA = BUBBLE_MAX_AREA * ratio
  const lo = Math.min(...nums)
  const hi = Math.max(...nums)
  const type = opts.rangeType === 'magnitude' || opts.rangeType === 'dataRange' ? opts.rangeType : lo >= 0 ? 'magnitude' : 'dataRange'
  let d0: number
  let d1: number
  let val: (s: number) => number
  if (type === 'magnitude') {
    d0 = 0
    d1 = Math.max(...nums.map(Math.abs))
    val = Math.abs
  } else {
    d0 = lo
    d1 = hi
    val = (s) => s
  }
  return (size) => {
    if (size === null || !Number.isFinite(size)) return fallback
    const t = d1 === d0 ? 1 : Math.max(0, Math.min(1, (val(size) - d0) / (d1 - d0)))
    const area = minA + t * (maxA - minA)
    return Math.sqrt(area / Math.PI) * mult
  }
}

// ------------------------------------------------------------------------------------------------
// Play axis
// ------------------------------------------------------------------------------------------------

/** Distinct frames in first-seen order (the query sorts by the play field ascending). */
export function collectFrames(frameKeys: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of frameKeys) if (!seen.has(k)) seen.add(k), out.push(k)
  return out
}

/** Initial frame: the saved `currentFrameIndex.index` when valid, else the last frame (PBI shows the latest state). */
export function initialFrame(frameCount: number, saved: number | undefined): number {
  if (!frameCount) return -1
  if (saved !== undefined && Number.isInteger(saved) && saved >= 0 && saved < frameCount) return saved
  return frameCount - 1
}

/** Next frame while playing; returns -1 when the animation has reached the end. */
export function nextFrame(current: number, frameCount: number): number {
  if (frameCount <= 0) return -1
  const n = current < 0 ? 0 : current + 1
  return n >= frameCount ? -1 : n
}

export interface TrailPoint {
  frame: number
  x: number
  y: number
}

/**
 * Trail of one data point (identity key) through frames 0..current (PBI draws trails for the
 * selected bubbles while a play axis is used).
 */
export function trailOf<T extends { frameIndex: number; x: number; y: number }>(points: T[], current: number): TrailPoint[] {
  return points
    .filter((p) => p.frameIndex <= current)
    .sort((a, b) => a.frameIndex - b.frameIndex)
    .map((p) => ({ frame: p.frameIndex, x: p.x, y: p.y }))
}

// ------------------------------------------------------------------------------------------------
// Analytics
// ------------------------------------------------------------------------------------------------

export type StatKind = 'min' | 'max' | 'average' | 'median' | 'percentile'

/** Statistic over the plotted values (blank values excluded, like PBI). NaN when empty. */
export function statValue(kind: StatKind, values: number[], percentile = 50): number {
  const v = values.filter((x) => Number.isFinite(x))
  if (!v.length) return NaN
  switch (kind) {
    case 'min':
      return Math.min(...v)
    case 'max':
      return Math.max(...v)
    case 'average':
      return v.reduce((a, b) => a + b, 0) / v.length
    case 'median':
      return quantile([...v].sort((a, b) => a - b), 0.5)
    case 'percentile':
      // PBI's "Percentile" uses the inclusive method (PERCENTILE.INC)
      return quantile([...v].sort((a, b) => a - b), Math.max(0, Math.min(100, percentile)) / 100)
  }
}

/**
 * Ratio line slope: Σy / Σx over the visible points (PBI: "the ratio of the total Y to the total X";
 * the line goes through the origin).
 */
export function ratioSlope(points: Array<{ x: number; y: number }>): number | null {
  let sx = 0
  let sy = 0
  for (const p of points) {
    sx += p.x
    sy += p.y
  }
  return sx === 0 ? null : sy / sx
}

/**
 * Symmetry shading polygons (data coordinates) inside the plot rectangle: `upper` = where y > x,
 * `lower` = where y < x. The diagonal is sampled so log axes (curved diagonal on mixed scales) work.
 */
export function symmetryPolygons(xDomain: [number, number], yDomain: [number, number], samples = 48): { upper: Array<[number, number]>; lower: Array<[number, number]> } {
  const [x0, x1] = [Math.min(...xDomain), Math.max(...xDomain)]
  const [y0, y1] = [Math.min(...yDomain), Math.max(...yDomain)]
  const diag: Array<[number, number]> = []
  // include the exact crossings of y = x with the rectangle so clamping keeps sharp corners
  const xs = new Set<number>()
  for (let i = 0; i <= samples; i++) xs.add(x0 + ((x1 - x0) * i) / samples)
  for (const c of [y0, y1]) if (c > x0 && c < x1) xs.add(c)
  for (const x of [...xs].sort((a, b) => a - b)) diag.push([x, Math.max(y0, Math.min(y1, x))])
  return {
    upper: [...diag, [x1, y1], [x0, y1]],
    lower: [...diag, [x1, y0], [x0, y0]]
  }
}

/** Least-squares trend line over (x, y) points, as a segment across [xMin, xMax]. */
export function trendSegment(points: Array<{ x: number; y: number }>, xRange?: [number, number]): { x0: number; y0: number; x1: number; y1: number; slope: number; intercept: number } | null {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  if (pts.length < 2) return null
  const xs = pts.map((p) => p.x)
  if (Math.min(...xs) === Math.max(...xs)) return null
  const { a, b } = linearFit(
    xs,
    pts.map((p) => p.y)
  )
  const lo = xRange ? xRange[0] : Math.min(...xs)
  const hi = xRange ? xRange[1] : Math.max(...xs)
  return { x0: lo, y0: a + b * lo, x1: hi, y1: a + b * hi, slope: b, intercept: a }
}

// ------------------------------------------------------------------------------------------------
// Marker shapes (`bubbles.markerShape`)
// ------------------------------------------------------------------------------------------------

export type MarkerShape = 'circle' | 'square' | 'diamond' | 'triangle' | 'x' | 'shortDash' | 'longDash' | 'plus'

export const MARKER_SHAPES: MarkerShape[] = ['circle', 'square', 'diamond', 'triangle', 'x', 'shortDash', 'longDash', 'plus']

export function normalizeShape(v: unknown): MarkerShape {
  return typeof v === 'string' && (MARKER_SHAPES as string[]).includes(v) ? (v as MarkerShape) : 'circle'
}

/** Is the shape drawn as strokes only (no fill area)? */
export const isStrokeShape = (s: MarkerShape): boolean => s === 'x' || s === 'plus' || s === 'shortDash' || s === 'longDash'

/** SVG path of a marker centred at (0,0) with "radius" r (shapes have the same visual area as the circle). */
export function markerPath(shape: MarkerShape, r: number): string {
  const f = (n: number) => +n.toFixed(2)
  switch (shape) {
    case 'square': {
      const s = r * 0.886 // equal area: side = r·√π
      return `M${f(-s)},${f(-s)}H${f(s)}V${f(s)}H${f(-s)}Z`
    }
    case 'diamond': {
      const s = r * 1.253
      return `M0,${f(-s)}L${f(s)},0L0,${f(s)}L${f(-s)},0Z`
    }
    case 'triangle': {
      const s = r * 1.347 // equal-area equilateral triangle circumradius
      const h = s * 0.5
      const w = s * 0.866
      return `M0,${f(-s)}L${f(w)},${f(h)}L${f(-w)},${f(h)}Z`
    }
    case 'x': {
      const s = r * 0.8
      return `M${f(-s)},${f(-s)}L${f(s)},${f(s)}M${f(-s)},${f(s)}L${f(s)},${f(-s)}`
    }
    case 'plus':
      return `M${f(-r)},0H${f(r)}M0,${f(-r)}V${f(r)}`
    case 'shortDash':
      return `M${f(-r * 0.6)},0H${f(r * 0.6)}`
    case 'longDash':
      return `M${f(-r * 1.2)},0H${f(r * 1.2)}`
    default:
      return `M${f(-r)},0A${f(r)},${f(r)} 0 1,0 ${f(r)},0A${f(r)},${f(r)} 0 1,0 ${f(-r)},0Z`
  }
}

// ------------------------------------------------------------------------------------------------
// Category label placement
// ------------------------------------------------------------------------------------------------

export interface LabelRequest {
  /** marker centre (px) */
  x: number
  y: number
  /** marker radius (px) */
  r: number
  width: number
  height: number
}

export interface PlacedLabel {
  index: number
  /** text anchor point: centre x, baseline-middle y */
  x: number
  y: number
}

/**
 * Greedy collision-free placement (PBI hides category labels that would overlap): candidates are
 * above, below, right and left of the marker; larger bubbles are placed first. Labels must stay in
 * `bounds` and not cover other labels.
 */
export function placeLabels(reqs: LabelRequest[], bounds: { x: number; y: number; w: number; h: number }): PlacedLabel[] {
  const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = []
  const out: PlacedLabel[] = []
  const order = reqs.map((_, i) => i).sort((a, b) => reqs[b].r - reqs[a].r || a - b)
  for (const i of order) {
    const q = reqs[i]
    const gap = 2
    const cands: Array<[number, number]> = [
      [q.x, q.y - q.r - gap - q.height / 2],
      [q.x, q.y + q.r + gap + q.height / 2],
      [q.x + q.r + gap + q.width / 2, q.y],
      [q.x - q.r - gap - q.width / 2, q.y]
    ]
    for (const [cx, cy] of cands) {
      const box = { x0: cx - q.width / 2, y0: cy - q.height / 2, x1: cx + q.width / 2, y1: cy + q.height / 2 }
      if (box.x0 < bounds.x || box.y0 < bounds.y || box.x1 > bounds.x + bounds.w || box.y1 > bounds.y + bounds.h) continue
      if (placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) continue
      placed.push(box)
      out.push({ index: i, x: cx, y: cy })
      break
    }
  }
  return out.sort((a, b) => a.index - b.index)
}

// ------------------------------------------------------------------------------------------------
// Axis titles with units (`axisStyle`)
// ------------------------------------------------------------------------------------------------

const UNIT_NAMES: Record<number, string> = { 1e3: 'Thousands', 1e6: 'Millions', 1e9: 'Billions', 1e12: 'Trillions' }

/** PBI axis title: "showTitleOnly" (default) | "showUnitOnly" | "showBoth" → "Sales (Thousands)". */
export function axisTitleWithUnits(title: string, style: string | undefined, unit: number): string {
  const name = UNIT_NAMES[unit]
  if (style === 'showUnitOnly') return name ?? ''
  if (style === 'showBoth') return name ? (title ? `${title} (${name})` : name) : title
  return title
}
