/**
 * Sparklines in tables and matrices (pure model, no DOM).
 *
 * PBIR encodes a sparkline as a Values projection whose field is
 *   `{ SparklineData: { Measure: <measure | aggregation>, Groupings: [<axis column>] } }`
 * (queryRef like `SparklineData(Sum(Sales.Amount)_[Sales.Date])`). Formatting lives in the
 * `sparklines` object with `selector.metadata` = the sparkline's queryRef; property names from
 * Microsoft's report-theme schema: chartType ('line' | 'column'), dataColor, strokeWidth,
 * markers (bit flags), markerColor, markerShape, markerSize.
 *
 * Data: one extra summarize per visual grain — the visual's row groups plus the axis column —
 * ordered by the axis (so sort-by-columns such as month numbers apply), split into one series
 * per row key. Each sparkline is scaled to its own min/max like Power BI's.
 *
 * Approximations (documented gaps):
 *  - `markers` is an integer bit set; Microsoft doesn't document the bit order. We use the
 *    format-pane order: 1 every point, 2 highest, 4 lowest, 8 first, 16 last, 32 negative,
 *    64 isolated.
 *  - Blank axis points break the line (PBI connects across blanks only for "isolated" display).
 */
import type { Scalar } from '@core/model/data'
import { getColor, getProp, objectEntries, type PropContext } from '@core/report/props'
import type { ResolvedTheme } from '@core/report/theme'
import type { SQExpr } from '@core/report/sq'

export interface SparklineSpec {
  measure: SQExpr
  /** the x-axis column (first grouping) */
  axis: SQExpr
}

/** Parse a `SparklineData` projection field; undefined for any other expression. */
export function sparklineSpec(expr: SQExpr): SparklineSpec | undefined {
  const sd = (expr as any)?.SparklineData
  if (!sd || !sd.Measure) return undefined
  const groupings: SQExpr[] = Array.isArray(sd.Groupings) ? sd.Groupings : []
  const axis = groupings[0]
  if (!axis) return undefined
  return { measure: sd.Measure, axis }
}

export function isSparkline(expr: SQExpr): boolean {
  return sparklineSpec(expr) !== undefined
}

export const MARKER = { every: 1, highest: 2, lowest: 4, first: 8, last: 16, negative: 32, isolated: 64 } as const
export type MarkerKind = keyof typeof MARKER
export type MarkerShape = 'circle' | 'square' | 'diamond' | 'triangle' | 'x' | 'shortDash' | 'longDash' | 'plus'

export interface SparklineFormat {
  chartType: 'line' | 'column'
  color: string
  strokeWidth: number
  markers: number
  markerColor: string
  markerShape: MarkerShape
  markerSize: number
}

export function defaultSparklineFormat(theme: ResolvedTheme): SparklineFormat {
  const c = theme.dataColors?.[0] ?? '#118DFF'
  return { chartType: 'line', color: c, strokeWidth: 1.5, markers: 0, markerColor: c, markerShape: 'circle', markerSize: 3 }
}

/** All `sparklines` entries by queryRef (an entry without selector applies to every sparkline). */
export function readSparklineFormats(pc: PropContext, theme: ResolvedTheme): Map<string, SparklineFormat> {
  const out = new Map<string, SparklineFormat>()
  const read = (sel?: { metadata: string }): SparklineFormat => {
    const d = defaultSparklineFormat(theme)
    const ct = String(getProp<any>(pc, 'sparklines', 'chartType', d.chartType, sel)).toLowerCase()
    const color = getColor(pc, 'sparklines', 'dataColor', d.color, sel)
    const shape = String(getProp<any>(pc, 'sparklines', 'markerShape', d.markerShape, sel)) as MarkerShape
    return {
      chartType: ct === 'column' ? 'column' : 'line',
      color,
      strokeWidth: numOr(getProp<any>(pc, 'sparklines', 'strokeWidth', d.strokeWidth, sel), d.strokeWidth),
      markers: Math.max(0, Math.round(numOr(getProp<any>(pc, 'sparklines', 'markers', d.markers, sel), 0))),
      markerColor: getColor(pc, 'sparklines', 'markerColor', color, sel),
      markerShape: (['circle', 'square', 'diamond', 'triangle', 'x', 'shortDash', 'longDash', 'plus'] as MarkerShape[]).includes(shape) ? shape : 'circle',
      markerSize: Math.max(1, numOr(getProp<any>(pc, 'sparklines', 'markerSize', d.markerSize, sel), d.markerSize))
    }
  }
  out.set('', read())
  for (const e of objectEntries(pc, 'sparklines')) {
    const ref = e.selector?.metadata
    if (ref) out.set(ref, read({ metadata: ref }))
  }
  return out
}

export function sparklineFormatFor(map: Map<string, SparklineFormat>, queryRef: string, theme: ResolvedTheme): SparklineFormat {
  return map.get(queryRef) ?? map.get('') ?? defaultSparklineFormat(theme)
}

function numOr(v: unknown, d: number): number {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v))
  return Number.isFinite(n) ? n : d
}

// ---------------------------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------------------------

export interface SparkPoint {
  x: Scalar
  y: number | null
}

export function sparkKey(keys: Scalar[]): string {
  return keys.map((v) => (v instanceof Date ? 'd' + v.getTime() : JSON.stringify(v))).join('\u0001')
}

/**
 * Split summarize rows `[key_1..key_k, axis, value]` (already ordered by axis) into one series
 * per key. Every series gets every axis value seen in the result (missing → null), so all
 * sparklines of a column share the same x positions, like Power BI's.
 */
export function seriesFromRows(rows: Scalar[][], keyLen: number): Map<string, SparkPoint[]> {
  const axisOrder: Scalar[] = []
  const axisIndex = new Map<string, number>()
  const byKey = new Map<string, Map<number, number | null>>()
  for (const r of rows) {
    const ax = r[keyLen]
    const ak = sparkKey([ax])
    let ai = axisIndex.get(ak)
    if (ai === undefined) {
      ai = axisOrder.length
      axisIndex.set(ak, ai)
      axisOrder.push(ax)
    }
    const k = sparkKey(r.slice(0, keyLen))
    let m = byKey.get(k)
    if (!m) byKey.set(k, (m = new Map()))
    const v = r[keyLen + 1]
    m.set(ai, typeof v === 'number' && Number.isFinite(v) ? v : null)
  }
  const out = new Map<string, SparkPoint[]>()
  for (const [k, m] of byKey) out.set(k, axisOrder.map((x, i) => ({ x, y: m.get(i) ?? null })))
  return out
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

export interface SparkMarker {
  x: number
  y: number
  kinds: MarkerKind[]
}

export interface SparkGeometry {
  kind: 'line' | 'column'
  /** line: SVG path ("M…L…", gaps start a new "M") */
  path?: string
  /** column: bars */
  bars?: Array<{ x: number; y: number; w: number; h: number; negative: boolean }>
  markers: SparkMarker[]
  width: number
  height: number
  empty: boolean
}

/**
 * Lay out a sparkline in a `width × height` box. `inset` keeps markers/strokes inside the box.
 */
export function sparklineGeometry(points: SparkPoint[], fmt: Pick<SparklineFormat, 'chartType' | 'markers' | 'strokeWidth' | 'markerSize'>, width: number, height: number): SparkGeometry {
  const vals = points.map((p) => p.y).filter((y): y is number => y !== null)
  const base: SparkGeometry = { kind: fmt.chartType, markers: [], width, height, empty: vals.length === 0 }
  if (!vals.length || width <= 0 || height <= 0) return base
  const inset = fmt.chartType === 'line' ? Math.max(fmt.strokeWidth / 2, fmt.markers ? fmt.markerSize : 0) + 0.5 : 0.5
  let min = Math.min(...vals)
  let max = Math.max(...vals)
  if (fmt.chartType === 'column') {
    min = Math.min(0, min)
    max = Math.max(0, max)
  }
  const span = max - min
  const h = Math.max(1, height - 2 * inset)
  const yOf = (v: number) => (span === 0 ? height / 2 : inset + (1 - (v - min) / span) * h)
  const n = points.length
  if (fmt.chartType === 'column') {
    const slot = width / Math.max(1, n)
    const gap = Math.min(2, slot * 0.25)
    const zero = yOf(0)
    base.bars = []
    points.forEach((p, i) => {
      if (p.y === null) return
      const y = yOf(p.y)
      const top = Math.min(y, zero)
      base.bars!.push({ x: i * slot + gap / 2, y: top, w: Math.max(0.5, slot - gap), h: Math.max(span === 0 ? h : 0.5, Math.abs(zero - y)), negative: p.y < 0 })
    })
    if (span === 0) for (const b of base.bars) b.y = inset
  } else {
    const xOf = (i: number) => (n <= 1 ? width / 2 : inset + (i / (n - 1)) * (width - 2 * inset))
    let d = ''
    let pen = false
    points.forEach((p, i) => {
      if (p.y === null) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${round(xOf(i))} ${round(yOf(p.y))}`
      pen = true
    })
    base.path = d
    base.markers = markerPoints(points, fmt.markers).map((m) => ({ x: round(xOf(m.index)), y: round(yOf(points[m.index].y as number)), kinds: m.kinds }))
  }
  return base
}

/** Which points get markers for a marker bit set. */
export function markerPoints(points: SparkPoint[], flags: number): Array<{ index: number; kinds: MarkerKind[] }> {
  if (!flags) return []
  const idx = points.map((p, i) => (p.y === null ? -1 : i)).filter((i) => i >= 0)
  if (!idx.length) return []
  const ys = idx.map((i) => points[i].y as number)
  const hi = idx[ys.indexOf(Math.max(...ys))]
  const lo = idx[ys.indexOf(Math.min(...ys))]
  const out = new Map<number, MarkerKind[]>()
  const add = (i: number, k: MarkerKind) => {
    const a = out.get(i) ?? []
    a.push(k)
    out.set(i, a)
  }
  for (const i of idx) {
    if (flags & MARKER.every) add(i, 'every')
    if (flags & MARKER.negative && (points[i].y as number) < 0) add(i, 'negative')
    if (flags & MARKER.isolated && (i === 0 || points[i - 1].y === null) && (i === points.length - 1 || points[i + 1].y === null)) add(i, 'isolated')
  }
  if (flags & MARKER.highest) add(hi, 'highest')
  if (flags & MARKER.lowest) add(lo, 'lowest')
  if (flags & MARKER.first) add(idx[0], 'first')
  if (flags & MARKER.last) add(idx[idx.length - 1], 'last')
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([index, kinds]) => ({ index, kinds }))
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** Default header label of a sparkline projection: "<measure> by <axis>" like Power BI. */
export function sparklineLabel(measureLabel: string, axisLabel: string): string {
  return `${measureLabel} by ${axisLabel}`
}

/** PBI's default sparkline cell size (px) used for auto-sized columns. */
export const SPARKLINE_DEFAULT_WIDTH = 100
