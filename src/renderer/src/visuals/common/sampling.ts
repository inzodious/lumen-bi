/**
 * Data reduction for dense line / area charts, modelled on Power BI's "high-density sampling"
 * for line charts: when a chart has more categories than its point budget (3,500 for line and
 * area charts), the categories are split into equal buckets and from every bucket the points that
 * carry the shape of the line are kept — the first and last point of the bucket and, for every
 * series, its minimum and maximum. Outliers and peaks therefore always survive, unlike a naive
 * "first N" truncation.
 *
 * APPROXIMATION: Power BI's exact bucket boundaries and tie-breaking aren't documented; the
 * result keeps the same kinds of points (bucket edges + per-series extremes) within the budget.
 */

/**
 * Indices (ascending, unique) of the categories to keep. `series[s][c]` = value of series s at
 * category c (null = no point). Returns all indices when `n <= budget`.
 */
export function highDensitySample(n: number, series: Array<Array<number | null>>, budget = 3500): number[] {
  if (n <= budget) return Array.from({ length: n }, (_, i) => i)
  // each bucket keeps up to 2 edges + 2 per series → choose the bucket count to fit the budget
  const perBucket = 2 + 2 * Math.max(1, series.length)
  const buckets = Math.max(1, Math.floor(budget / perBucket))
  const keep = new Set<number>()
  for (let b = 0; b < buckets; b++) {
    const lo = Math.floor((b * n) / buckets)
    const hi = Math.floor(((b + 1) * n) / buckets) - 1
    if (hi < lo) continue
    keep.add(lo)
    keep.add(hi)
    for (const vals of series) {
      let mn = -1
      let mx = -1
      for (let i = lo; i <= hi; i++) {
        const v = vals[i]
        if (v === null || v === undefined || !Number.isFinite(v)) continue
        if (mn < 0 || v < (vals[mn] as number)) mn = i
        if (mx < 0 || v > (vals[mx] as number)) mx = i
      }
      if (mn >= 0) keep.add(mn)
      if (mx >= 0) keep.add(mx)
    }
  }
  keep.add(0)
  keep.add(n - 1)
  const out = [...keep].sort((a, b) => a - b)
  return out.length > budget ? out.filter((_, i) => i % Math.ceil(out.length / budget) === 0 || i === out.length - 1) : out
}
