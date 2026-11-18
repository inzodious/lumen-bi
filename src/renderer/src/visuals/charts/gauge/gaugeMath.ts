/**
 * Gauge range math (pure).
 *
 * Precedence for each bound: the bound field (MinValue / MaxValue / TargetValue roles) > the
 * format-pane `axis` property (min / max / target) > Power BI's default:
 *   - min: 0 (2 × value when the value is negative, so it stays on the arc)
 *   - max: 2 × value when the value is positive (PBI's documented default), 1 when value ≤ 0 and
 *     min ≥ 0, else 0.
 * Approximation: when the target is larger than the default maximum, the maximum is extended to
 * the target so the target line stays visible (PBI's behavior here is not documented).
 */

export interface GaugeRangeInput {
  value: number
  /** values of the bound fields (null when not bound / blank) */
  minField?: number | null
  maxField?: number | null
  targetField?: number | null
  /** format pane `axis` properties */
  axisMin?: number
  axisMax?: number
  axisTarget?: number
}

export interface GaugeRange {
  min: number
  max: number
  target: number | null
  /** true when the maximum came from PBI's default (2 × value) */
  defaultMax: boolean
}

const fin = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

export function gaugeRange(i: GaugeRangeInput): GaugeRange {
  const target = fin(i.targetField) ? i.targetField : fin(i.axisTarget) ? i.axisTarget : null
  let min = fin(i.minField) ? i.minField : fin(i.axisMin) ? i.axisMin : i.value < 0 ? 2 * i.value : 0
  let max: number
  let defaultMax = false
  if (fin(i.maxField)) max = i.maxField
  else if (fin(i.axisMax)) max = i.axisMax
  else {
    defaultMax = true
    max = i.value > 0 ? 2 * i.value : min < 0 ? 0 : 1
    if (target !== null && target > max) max = target
  }
  if (max <= min) {
    // degenerate ranges: keep the arc drawable
    if (defaultMax) max = min + (Math.abs(min) || 1)
    else min = max - (Math.abs(max) || 1)
  }
  return { min, max, target, defaultMax }
}

/** Fraction of the arc (0..1) for a value, clamped. */
export function gaugeFraction(v: number, min: number, max: number): number {
  if (!(max > min)) return 0
  return Math.max(0, Math.min(1, (v - min) / (max - min)))
}

/** Angle (radians, 0 = 12 o'clock, clockwise positive) on the semicircle from -π/2 (min) to π/2 (max). */
export function gaugeAngle(v: number, min: number, max: number): number {
  return -Math.PI / 2 + Math.PI * gaugeFraction(v, min, max)
}

/** Inner radius factor of the band (PBI: inner radius = 0.7 × outer). */
export const GAUGE_INNER_RADIUS_FACTOR = 0.7
