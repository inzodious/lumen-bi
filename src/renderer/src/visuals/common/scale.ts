/**
 * Axis scale helpers (pure): value-axis domains and ticks the way Power BI picks them.
 *
 *  - Column/bar/area values always include zero; line/scatter axes fit the data (PBI "Auto" start).
 *  - An automatic range is rounded out to a "nice" step. An explicit `start` or `end` from the format pane switches
 *    the rounding off: the other, automatic end then stops at the data (measured on Power BI renders — a bar chart
 *    with only "Start = 0" ends exactly at its longest bar).
 *  - Floating-point noise never moves a bound: a stack that sums to 1.0000000000000002 ends at 1, not at the next step.
 *  - Tick density ≈ one tick per ~50 px (vertical) / ~80 px (horizontal), PBI-like.
 */
import { scaleLinear, scaleLog, scaleUtc } from 'd3-scale'

export interface ValueAxisSpec {
  dataMin: number
  dataMax: number
  /** include zero in the domain (columns/bars/areas) */
  includeZero: boolean
  start?: number | null
  end?: number | null
  scale?: 'linear' | 'log'
  /** axis length in px */
  length: number
  /** px per tick */
  tickSpacing?: number
  /** false: never round the automatic bounds out (the domain is exactly the data range, e.g. room for total labels was added by the caller) */
  nice?: boolean
}

/** Drop binary floating-point noise (sums like 0.1 + 0.2, stacks of shares): 12 significant digits. */
export function snapFloat(v: number): number {
  return Number.isFinite(v) && v !== 0 ? Number(v.toPrecision(12)) : v
}

export interface ValueAxisModel {
  domain: [number, number]
  ticks: number[]
  step: number
  scale: 'linear' | 'log'
}

export function tickCountFor(length: number, spacing = 50): number {
  return Math.max(2, Math.min(10, Math.floor(length / spacing)))
}

export function computeValueAxis(spec: ValueAxisSpec): ValueAxisModel {
  let lo = Number.isFinite(spec.dataMin) ? snapFloat(spec.dataMin) : 0
  let hi = Number.isFinite(spec.dataMax) ? snapFloat(spec.dataMax) : 0
  if (spec.scale === 'log' && hi > 0) {
    const min = spec.start && spec.start > 0 ? spec.start : Math.max(lo > 0 ? lo : hi / 1000, 1e-12)
    const max = spec.end && spec.end > min ? spec.end : hi
    const s = scaleLog().domain([min, max]).nice()
    const [a, b] = s.domain() as [number, number]
    const ticks: number[] = []
    for (let p = Math.floor(Math.log10(a)); 10 ** p <= b * 1.0000001; p++) if (10 ** p >= a / 1.0000001) ticks.push(10 ** p)
    return { domain: [a, b], ticks, step: 10, scale: 'log' }
  }
  if (spec.includeZero) {
    lo = Math.min(0, lo)
    hi = Math.max(0, hi)
  }
  if (lo === hi) {
    if (lo === 0) hi = 1
    else if (lo > 0) {
      lo = spec.includeZero ? 0 : lo * 0.9
      hi = hi * 1.1 || 1
    } else {
      hi = spec.includeZero ? 0 : hi * 0.9
      lo = lo * 1.1
    }
  }
  const hasStart = spec.start !== null && spec.start !== undefined && Number.isFinite(spec.start)
  const hasEnd = spec.end !== null && spec.end !== undefined && Number.isFinite(spec.end)
  if (hasStart) lo = spec.start as number
  if (hasEnd) hi = spec.end as number
  if (lo > hi) [lo, hi] = [hi, lo]
  if (lo === hi) hi = lo + 1
  let count = tickCountFor(spec.length, spec.tickSpacing)
  const s = scaleLinear().domain([lo, hi])
  if (!hasStart && !hasEnd && spec.nice !== false) {
    s.nice(count)
    // Short axes: a coarse step can overshoot the data a lot (645K → 1.0M). PBI then uses a finer
    // step as long as the labels keep ~a line of room; pick the tightest of a few tick counts.
    const span = hi - lo
    const over = (d: number[]) => (d[1] - d[0]) / (span || 1)
    if (over(s.domain()) > 1.3) {
      const minPx = Math.max(18, (spec.tickSpacing ?? 50) * 0.5)
      let best = s.domain() as [number, number]
      for (let c = count + 1; c <= count + 4; c++) {
        const t = scaleLinear().domain([lo, hi]).nice(c)
        const d = t.domain() as [number, number]
        const n = t.ticks(c).length
        if (n > 1 && spec.length / (n - 1) < minPx) break
        if (over(d) < over(best) - 0.05) {
          best = d
          count = c
        }
      }
      s.domain(best)
    }
  }
  let [a, b] = s.domain() as [number, number]
  if (hasStart) a = spec.start as number
  if (hasEnd) b = spec.end as number
  const ticks = scaleLinear().domain([a, b]).ticks(count)
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : Math.abs(b - a)
  return { domain: [a, b], ticks: ticks.filter((t) => t >= Math.min(a, b) - 1e-9 && t <= Math.max(a, b) + 1e-9), step, scale: 'linear' }
}

/** Map a value into [0, length] for a value axis (log-aware). */
export function valueToPx(model: ValueAxisModel, length: number, invert = false): (v: number) => number {
  const s = model.scale === 'log' ? scaleLog().domain(model.domain).range([0, length]).clamp(true) : scaleLinear().domain(model.domain).range([0, length])
  return invert ? (v: number) => length - s(v) : (v: number) => s(v)
}

/** Band layout: position/width of N categories along `length` with PBI inner padding (fraction 0..1). */
export interface BandLayout {
  step: number
  bandwidth: number
  /** offset of first band start */
  offset: number
  pos(i: number): number
}

export function bandLayout(n: number, length: number, innerPadding: number, outerPadding = innerPadding / 2): BandLayout {
  const p = Math.max(0, Math.min(0.9, innerPadding))
  const o = Math.max(0, outerPadding)
  const step = n > 0 ? length / Math.max(1, n - p + 2 * o) : length
  const bandwidth = step * (1 - p)
  const offset = step * o
  return { step, bandwidth, offset, pos: (i) => offset + i * step }
}

/** Continuous (time / number) category axis ticks. */
export function continuousTicks(min: number, max: number, length: number, isDate: boolean, spacing = 80, integers = false): number[] {
  const count = Math.max(2, Math.floor(length / spacing))
  if (isDate) {
    const ticks = scaleUtc().domain([new Date(min), new Date(max)]).ticks(count).map((d) => d.getTime())
    // d3's calendar intervals jump (e.g. 3 months → 1 year): keep every k-th tick so labels don't
    // overlap (PBI then labels every 6 months: Jan / Jul)
    if (ticks.length <= count + 1) return ticks
    const k = Math.ceil(ticks.length / (count + 1))
    return ticks.filter((_, i) => i % k === 0)
  }
  const ticks = scaleLinear().domain([min, max]).ticks(count)
  if (!integers) return ticks
  const ints = ticks.filter((t) => Number.isInteger(t))
  return ints.length >= 2 || max - min < 1 ? ints : [min, max]
}

/** Stack values (per category) — returns [base, top] per series/category; negatives stack downward. */
export function stackValues(values: Array<Array<number | null>>, percent = false): Array<Array<[number, number] | null>> {
  const nS = values.length
  const nC = nS ? values[0].length : 0
  const out: Array<Array<[number, number] | null>> = values.map(() => new Array(nC).fill(null))
  for (let c = 0; c < nC; c++) {
    let totalPos = 0
    let totalNeg = 0
    for (let s = 0; s < nS; s++) {
      const v = values[s][c]
      if (v === null || !Number.isFinite(v)) continue
      if (v >= 0) totalPos += v
      else totalNeg += v
    }
    const denom = percent ? totalPos - totalNeg || 1 : 1
    let pos = 0
    let neg = 0
    for (let s = 0; s < nS; s++) {
      const raw = values[s][c]
      if (raw === null || !Number.isFinite(raw)) continue
      const v = raw / denom
      if (v >= 0) {
        out[s][c] = [pos, pos + v]
        pos += v
      } else {
        out[s][c] = [neg + v, neg]
        neg += v
      }
    }
  }
  return out
}

/** A "nice" step ≥ raw (1, 2, 2.5, 5 × 10^k). */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1
  const e = Math.floor(Math.log10(raw))
  const base = 10 ** e
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= raw * (1 - 1e-9)) return m * base
  return 10 * base
}

/**
 * Secondary value axis aligned to the primary's gridlines, like Power BI's combo / dual-axis
 * charts: same number of intervals, zero on the same gridline when both axes cross zero (or the
 * secondary must include zero), nice secondary step. Explicit secondary start/end win.
 */
export function alignSecondaryAxis(primary: ValueAxisModel, spec: { dataMin: number; dataMax: number; includeZero: boolean; start?: number | null; end?: number | null }): ValueAxisModel {
  const k = primary.ticks.length - 1
  if (primary.scale === 'log' || k < 1 || (spec.start ?? null) !== null || (spec.end ?? null) !== null) {
    return computeValueAxis({ dataMin: spec.dataMin, dataMax: spec.dataMax, includeZero: spec.includeZero, start: spec.start, end: spec.end, length: k * 50 + 1 })
  }
  let lo = Number.isFinite(spec.dataMin) ? spec.dataMin : 0
  let hi = Number.isFinite(spec.dataMax) ? spec.dataMax : 1
  if (spec.includeZero) {
    lo = Math.min(0, lo)
    hi = Math.max(0, hi)
  }
  if (lo === hi) {
    hi = lo === 0 ? 1 : lo > 0 ? hi * 1.1 : 0
    if (lo < 0 && hi === 0) lo = lo * 1.1
  }
  // primary ticks must cover the whole primary domain for a clean alignment
  const p0 = primary.ticks[0]
  const z = primary.step ? Math.round((0 - p0) / primary.step) : -1
  const zeroOnTick = z >= 0 && z <= k && Math.abs(p0 + z * primary.step) < primary.step * 1e-6
  let step: number
  let start: number
  if (zeroOnTick && (lo < 0 || spec.includeZero) && z > 0 && z < k) {
    step = niceStep(Math.max(hi / (k - z), lo < 0 ? -lo / z : 0))
    start = -z * step
  } else {
    step = niceStep((hi - lo) / k)
    start = Math.floor(lo / step + 1e-9) * step
    while (start + k * step < hi - 1e-9) {
      step = niceStep(step * 1.0001 + 1e-12)
      start = Math.floor(lo / step + 1e-9) * step
    }
    if (spec.includeZero && lo >= 0) start = 0
  }
  const ticks = Array.from({ length: k + 1 }, (_, i) => +(start + i * step).toPrecision(12))
  // map the secondary ticks onto the same pixel positions as the primary ticks
  const pa = primary.domain[0]
  const pb = primary.domain[1]
  const t0 = primary.ticks[0]
  const tk = primary.ticks[k]
  const scale = (ticks[k] - ticks[0]) / (tk - t0 || 1)
  const domain: [number, number] = [ticks[0] + (pa - t0) * scale, ticks[0] + (pb - t0) * scale]
  return { domain, ticks, step, scale: 'linear' }
}
