/**
 * Key influencers statistics (pure, no engine / DOM).
 *
 * Input: weighted "samples" — one per distinct combination of Explain-by values — carrying the moments of
 * the analyzed variable y over the rows of that combination: n (rows), s = Σy, ss = Σy². A categorical
 * target ("What influences X to be V") is the indicator y = [X = V], so its mean is the rate of V and the
 * same machinery serves both target kinds.
 *
 * Ranking (Power BI semantics, simplified to a univariate analysis):
 *  - categorical target: lift = P(V | segment) / P(V | not segment) — Power BI compares a segment with the
 *    average of everything else ("Average (excluding selected)") and words it "the likelihood … increases by 1.53x".
 *  - continuous target: mean difference = mean(segment) − mean(rest) ("… increases by 120 on average"),
 *    positive for Increase, negative for Decrease.
 *  - a segment is an influencer when it has at least `minSupport` rows (and so has the rest), and the
 *    difference is significant (Welch's t ≥ 1.96 ≈ 95%). Power BI fits a logistic / linear regression over
 *    all fields; Lumen's per-field test is an approximation and is labelled as such in the visual.
 *  - numeric Explain-by columns are binned into weighted-quantile ranges ("is 12 or less", "is 13 - 24",
 *    "is more than 24") instead of Power BI's supervised binning / "goes up by" regressions.
 */
import type { Scalar } from '@core/model/data'

export interface Moments {
  n: number
  s: number
  ss: number
}

export interface Sample extends Moments {
  /** Explain-by values, in field order */
  attrs: Scalar[]
}

export const ZERO: Moments = { n: 0, s: 0, ss: 0 }

export function addMoments(a: Moments, b: Moments): Moments {
  return { n: a.n + b.n, s: a.s + b.s, ss: a.ss + b.ss }
}

export function subMoments(a: Moments, b: Moments): Moments {
  return { n: a.n - b.n, s: a.s - b.s, ss: a.ss - b.ss }
}

export function mean(m: Moments): number {
  return m.n > 0 ? m.s / m.n : NaN
}

/** Unbiased sample variance from moments (0 when n ≤ 1). */
export function variance(m: Moments): number {
  if (m.n <= 1) return 0
  const v = (m.ss - (m.s * m.s) / m.n) / (m.n - 1)
  return v > 0 ? v : 0
}

/** Welch's t statistic of mean(a) − mean(b). ±Infinity when both variances are 0 and the means differ. */
export function welchT(a: Moments, b: Moments): number {
  const d = mean(a) - mean(b)
  if (!Number.isFinite(d)) return 0
  const se = Math.sqrt(variance(a) / a.n + variance(b) / b.n)
  if (se === 0) return d === 0 ? 0 : d > 0 ? Infinity : -Infinity
  return d / se
}

// ------------------------------------------------------------------------------------------------
// Segments
// ------------------------------------------------------------------------------------------------

export interface Bin {
  /** inclusive lower bound (−Infinity for the first bin) — values must be > `after` */
  after: number
  /** inclusive upper bound (+Infinity for the last bin) */
  upTo: number
}

/**
 * Weighted-quantile bins over the distinct values of a numeric column (at most `maxBins`).
 * Cut points are actual data values, so "x or less" / "more than x" read naturally.
 */
export function quantileBins(values: Array<{ v: number; w: number }>, maxBins = 5): Bin[] {
  const byV = new Map<number, number>()
  for (const { v, w } of values) if (Number.isFinite(v) && w > 0) byV.set(v, (byV.get(v) ?? 0) + w)
  const sorted = [...byV.entries()].sort((a, b) => a[0] - b[0])
  if (!sorted.length) return []
  const total = sorted.reduce((a, [, w]) => a + w, 0)
  const k = Math.max(1, Math.min(maxBins, sorted.length))
  const cuts: number[] = []
  let cum = 0
  let next = 1
  for (let i = 0; i < sorted.length - 1 && next < k; i++) {
    cum += sorted[i][1]
    if (cum >= (total * next) / k - 1e-9) {
      cuts.push(sorted[i][0])
      while (next < k && cum >= (total * next) / k - 1e-9) next++
    }
  }
  const bins: Bin[] = []
  let after = -Infinity
  for (const c of cuts) {
    bins.push({ after, upTo: c })
    after = c
  }
  bins.push({ after, upTo: Infinity })
  return bins
}

export function binIndex(bins: Bin[], v: number): number {
  for (let i = 0; i < bins.length; i++) if (v > bins[i].after && v <= bins[i].upTo) return i
  return -1
}

/** "12 or less" · "13 - 24" (smallest actual value in the bin … upper cut) · "more than 24". */
export function binLabel(bin: Bin, minInBin: number, fmt: (v: number) => string): string {
  if (bin.after === -Infinity && bin.upTo === Infinity) return `${fmt(minInBin)} or more`
  if (bin.after === -Infinity) return `${fmt(bin.upTo)} or less`
  if (bin.upTo === Infinity) return `more than ${fmt(bin.after)}`
  if (minInBin === bin.upTo) return fmt(bin.upTo)
  return `${fmt(minInBin)} - ${fmt(bin.upTo)}`
}

export interface Segment {
  /** stable key within the field */
  key: string
  label: string
  /** categorical value (undefined for numeric bins) */
  value?: Scalar
  bin?: Bin
  /** display order within the field (bins ascending, categories by the caller's order) */
  order: number
  m: Moments
}

export interface FieldSegments {
  field: number
  binned: boolean
  segments: Segment[]
  /** sample → segment index (−1 = not assigned) */
  assign: (attr: Scalar) => number
}

const keyOf = (v: Scalar): string => (v instanceof Date ? 'd' + v.getTime() : v === null ? '∅' : typeof v + ':' + String(v))

/**
 * Segment one Explain-by field. Numeric fields with more than `binThreshold` distinct values are binned.
 * `label(v)` formats a categorical value / bin bound; `order` sorts categorical values (default: first seen).
 */
export function segmentField(
  samples: Sample[],
  field: number,
  opts: { numeric: boolean; label: (v: Scalar) => string; binThreshold?: number; maxBins?: number; order?: (a: Scalar, b: Scalar) => number }
): FieldSegments {
  const distinct = new Map<string, Scalar>()
  for (const s of samples) {
    const v = s.attrs[field]
    const k = keyOf(v)
    if (!distinct.has(k)) distinct.set(k, v)
  }
  const nums = [...distinct.values()].filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const binned = opts.numeric && nums.length > (opts.binThreshold ?? 8)
  if (binned) {
    const bins = quantileBins(
      samples.filter((s) => typeof s.attrs[field] === 'number').map((s) => ({ v: s.attrs[field] as number, w: s.n })),
      opts.maxBins ?? 5
    )
    const mins = bins.map(() => Infinity)
    const ms: Moments[] = bins.map(() => ZERO)
    let blank: Moments = ZERO
    for (const s of samples) {
      const v = s.attrs[field]
      if (typeof v !== 'number') {
        blank = addMoments(blank, s)
        continue
      }
      const b = binIndex(bins, v)
      if (b < 0) continue
      ms[b] = addMoments(ms[b], s)
      if (v < mins[b]) mins[b] = v
    }
    const segments: Segment[] = bins.map((bin, i) => ({ key: `bin${i}`, label: binLabel(bin, mins[i], (x) => opts.label(x)), bin, order: i, m: ms[i] }))
    if (blank.n > 0) segments.push({ key: 'blank', label: '(Blank)', value: null, order: bins.length, m: blank })
    const assign = (attr: Scalar) => (typeof attr === 'number' ? binIndex(bins, attr) : blank.n > 0 ? bins.length : -1)
    return { field, binned, segments, assign }
  }
  const values = [...distinct.values()]
  if (opts.order) values.sort(opts.order)
  const index = new Map(values.map((v, i) => [keyOf(v), i]))
  const ms: Moments[] = values.map(() => ZERO)
  for (const s of samples) {
    const i = index.get(keyOf(s.attrs[field]))!
    ms[i] = addMoments(ms[i], s)
  }
  const segments: Segment[] = values.map((v, i) => ({ key: keyOf(v), label: v === null ? '(Blank)' : opts.label(v), value: v, order: i, m: ms[i] }))
  return { field, binned, segments, assign: (attr) => index.get(keyOf(attr)) ?? -1 }
}

// ------------------------------------------------------------------------------------------------
// Influencers
// ------------------------------------------------------------------------------------------------

export type TargetKind = 'categorical' | 'continuous'
export type Direction = 'increase' | 'decrease'

export interface Influencer {
  field: number
  segment: Segment
  /** mean of y in the segment (rate for categorical targets) */
  mean: number
  /** mean of y outside the segment */
  restMean: number
  /** lift (categorical) or |mean difference| (continuous) */
  impact: number
  /** signed mean difference */
  diff: number
  t: number
}

export interface RankOptions {
  kind: TargetKind
  direction: Direction
  /** minimum rows in the segment and in the rest */
  minSupport: number
  /** |t| threshold (default 1.96) */
  tCrit?: number
  sort?: 'impact' | 'count'
}

/** Evaluate one segment against the rest of the data; null when it isn't an influencer. */
export function evaluateSegment(seg: Segment, total: Moments, field: number, opts: RankOptions): Influencer | null {
  const rest = subMoments(total, seg.m)
  if (seg.m.n < opts.minSupport || rest.n < opts.minSupport) return null
  const m = mean(seg.m)
  const r = mean(rest)
  if (!Number.isFinite(m) || !Number.isFinite(r)) return null
  const diff = m - r
  const t = welchT(seg.m, rest)
  const crit = opts.tCrit ?? 1.96
  const up = opts.kind === 'categorical' || opts.direction === 'increase'
  if (up ? !(diff > 0 && t >= crit) : !(diff < 0 && t <= -crit)) return null
  const impact = opts.kind === 'categorical' ? (r > 0 ? m / r : Infinity) : Math.abs(diff)
  return { field, segment: seg, mean: m, restMean: r, impact, diff, t }
}

export function rankInfluencers(fields: FieldSegments[], total: Moments, opts: RankOptions): Influencer[] {
  const out: Influencer[] = []
  for (const f of fields) for (const seg of f.segments) {
    const inf = evaluateSegment(seg, total, f.field, opts)
    if (inf) out.push(inf)
  }
  out.sort((a, b) => (opts.sort === 'count' ? b.segment.m.n - a.segment.m.n || b.impact - a.impact : b.impact - a.impact || b.segment.m.n - a.segment.m.n))
  return out
}

/** Default minimum support: 10 rows, or 1% of the data for large tables (Power BI also hides tiny segments). */
export function defaultMinSupport(totalRows: number, measureGrain: boolean): number {
  if (measureGrain) return Math.max(2, Math.ceil(totalRows * 0.02))
  return Math.max(10, Math.ceil(totalRows * 0.01))
}

// ------------------------------------------------------------------------------------------------
// Top segments
// ------------------------------------------------------------------------------------------------

export interface TopSegment {
  /** conditions: (field, segment) pairs */
  conditions: Array<{ field: number; segment: Segment }>
  m: Moments
  mean: number
  /** share of all rows */
  share: number
}

/**
 * Top segments (Power BI "Top segments" tab, simplified): single segments and pairs of segments from two
 * different fields, with at least `minSupport` rows, whose mean is significantly above (Increase / categorical)
 * or below (Decrease) the overall mean. Sorted by mean; a candidate that only restates an already picked one
 * (same condition set ⊂ / ⊃) is skipped. Power BI grows segments with a decision tree; this is an approximation.
 */
export function topSegments(samples: Sample[], fields: FieldSegments[], total: Moments, opts: RankOptions & { max?: number }): TopSegment[] {
  const up = opts.kind === 'categorical' || opts.direction === 'increase'
  const crit = opts.tCrit ?? 1.96
  const overall = mean(total)
  const cands: TopSegment[] = []
  const consider = (conditions: TopSegment['conditions'], m: Moments) => {
    if (m.n < opts.minSupport) return
    const rest = subMoments(total, m)
    if (rest.n < opts.minSupport) return
    const t = welchT(m, rest)
    const mu = mean(m)
    if (up ? !(mu > overall && t >= crit) : !(mu < overall && t <= -crit)) return
    cands.push({ conditions, m, mean: mu, share: total.n > 0 ? m.n / total.n : 0 })
  }
  for (const f of fields) for (const seg of f.segments) consider([{ field: f.field, segment: seg }], seg.m)
  for (let a = 0; a < fields.length; a++) {
    for (let b = a + 1; b < fields.length; b++) {
      const fa = fields[a]
      const fb = fields[b]
      const cells = new Map<string, Moments>()
      for (const s of samples) {
        const ia = fa.assign(s.attrs[fa.field])
        const ib = fb.assign(s.attrs[fb.field])
        if (ia < 0 || ib < 0) continue
        const k = `${ia}|${ib}`
        cells.set(k, addMoments(cells.get(k) ?? ZERO, s))
      }
      for (const [k, m] of cells) {
        const [ia, ib] = k.split('|').map(Number)
        consider(
          [
            { field: fa.field, segment: fa.segments[ia] },
            { field: fb.field, segment: fb.segments[ib] }
          ],
          m
        )
      }
    }
  }
  cands.sort((x, y) => (up ? y.mean - x.mean : x.mean - y.mean) || y.m.n - x.m.n)
  const picked: TopSegment[] = []
  const sig = (c: TopSegment) => c.conditions.map((x) => `${x.field}:${x.segment.key}`)
  for (const c of cands) {
    const cs = sig(c)
    const overlaps = picked.some((p) => {
      const ps = sig(p)
      return cs.every((x) => ps.includes(x)) || ps.every((x) => cs.includes(x))
    })
    if (overlaps) continue
    picked.push(c)
    if (picked.length >= (opts.max ?? 4)) break
  }
  return picked
}
