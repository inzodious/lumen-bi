/**
 * Coverage layout for generated fact tables (see ./synthetic.ts, `SyntheticResult.coverage`).
 *
 * Problem: a few thousand fact rows spread over hundreds of dimension members and dozens of periods leave most
 * member × period pairs without rows, so "one organisation in one quarter" — the selection a report's own slicers
 * offer — shows an empty page, where real data has rows for every active member in every period.
 *
 * Rule: for each fact table, every member of each related *sliceable* dimension (a dimension the report's slicers,
 * filter cards or cross-filtering visuals select on, directly or through a chain of dimensions) gets at least one row
 * in every period of the grain the report's date slicers select (quarter, month, year…; one period = the whole
 * activity window when the report has no date slicer). These coverage rows are added on top of the ordinary
 * (Zipf-skewed, trend-weighted) rows, so distributions keep their shape: every member has a floor of activity, popular
 * members have much more.
 *
 * Budget and degradation: coverage rows per table are capped (`budget`). Periods are taken in priority order —
 * periods holding a saved selection first (always fully covered), then the most recent ones — and covered fully while
 * three quarters of the budget last; the remaining (older) periods share what is left, each covering its most popular
 * members first (partial). The layout reports what it covered.
 *
 * Periodic-snapshot facts (one row per entity per snapshot day) are laid out as snapshots: every entity on every
 * snapshot day, within the same budget and priority rules (saved and recent days full, older days the most popular
 * entities).
 *
 * Pure functions over indices: the generator maps them to values.
 */

export interface PeriodBucket {
  /** stable key of the period (the derived values of the report's date slicer columns) */
  key: string
  /** calendar day indices of the period that may hold fact rows (activity window, not after today) */
  days: number[]
  /** a saved selection (slicer / filter card) points into this period */
  saved: boolean
}

export interface CoverColumn {
  /** domain indices of the dimension's members in popularity order (most popular first) */
  order: ArrayLike<number>
}

export interface CoverStats {
  /** periods of the grain with at least one possible fact day */
  periods: number
  /** periods whose every member pair is covered */
  fullPeriods: number
  /** periods with some (not all) member pairs covered */
  partialPeriods: number
  /** member × period pairs the rule asks for (summed over the covered columns) */
  pairs: number
  /** of those, pairs that got a coverage row */
  coveredPairs: number
  /** coverage rows laid out */
  rows: number
}

export interface CoverLayout extends CoverStats {
  /** per coverage row: calendar day index */
  day: Int32Array
  /** per covered column, per coverage row: domain index */
  members: Int32Array[]
}

/** Periods in priority order: saved first, then most recent first (by their last day). */
export function prioritise(periods: PeriodBucket[]): PeriodBucket[] {
  const last = (p: PeriodBucket): number => (p.days.length ? p.days[p.days.length - 1] : -1)
  return periods.filter((p) => p.days.length).sort((a, b) => Number(b.saved) - Number(a.saved) || last(b) - last(a))
}

/** Share of the budget full periods may take when not every period fits: the rest goes to the older periods. */
export const FULL_SHARE = 0.75

/**
 * How many member slots each period gets: `m` (all members) for every period when they all fit in the budget; else
 * for saved periods and, in priority order, for as many periods as `FULL_SHARE` of the budget allows, the rest sharing
 * what is left evenly (popular members first), at least `minPartial` each when that still fits under twice the budget.
 */
export function allocate(periods: PeriodBucket[], m: number, budget: number, minPartial = 0): number[] {
  const out = new Array<number>(periods.length).fill(0)
  const fullCap = periods.length * m <= budget ? budget : Math.floor(budget * FULL_SHARE)
  let used = 0
  let i = 0
  for (; i < periods.length; i++) {
    const p = periods[i]
    if (!p.saved && used + m > fullCap) break
    out[i] = m
    used += m
  }
  const rest = periods.length - i
  if (rest > 0) {
    let per = Math.min(m, Math.floor(Math.max(0, budget - used) / rest))
    if (per < minPartial && used + rest * minPartial <= budget * 2) per = Math.min(m, minPartial)
    for (let k = i; k < periods.length; k++) out[k] = per
  }
  return out
}

/**
 * Offset of column j's members in period p: a hash, so the pairing between two columns changes from one period to the
 * next whatever their sizes (a linear offset keeps it fixed when one size divides the other).
 */
function rotation(p: number, j: number, n: number): number {
  let h = Math.imul(p + 1, 0x9e3779b1) ^ Math.imul(j + 1, 0x85ebca77)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  return ((h ^ (h >>> 13)) >>> 0) % n
}

/** A day of the period: uniform, with fewer weekend days (as the ordinary rows' weekday dip). */
function pickDay(days: number[], rng: () => number, isWeekend: (day: number) => boolean): number {
  let d = days[Math.floor(rng() * days.length)]
  if (isWeekend(d) && rng() < 0.55) d = days[Math.floor(rng() * days.length)]
  return d
}

/**
 * Coverage rows for an event-like fact: for each period (priority order) and each slot k < its allocation, one row on
 * a day of the period whose covered columns take member k (columns with fewer members cycle; full periods rotate the
 * pairing between columns per period, so no two dimensions are locked together).
 */
export function layoutCoverage(
  periods: PeriodBucket[],
  cols: CoverColumn[],
  budget: number,
  rng: () => number,
  isWeekend: (day: number) => boolean = () => false
): CoverLayout {
  const ps = prioritise(periods)
  const sizes = cols.map((c) => c.order.length)
  const m = Math.max(0, ...sizes)
  const alloc = allocate(ps, m, budget)
  const rows = alloc.reduce((a, b) => a + b, 0)
  const day = new Int32Array(rows)
  const members = cols.map(() => new Int32Array(rows))
  let r = 0
  let fullPeriods = 0
  let partialPeriods = 0
  let coveredPairs = 0
  ps.forEach((p, pi) => {
    const c = alloc[pi]
    if (c >= m && m > 0) fullPeriods++
    else if (c > 0) partialPeriods++
    cols.forEach((_, j) => (coveredPairs += Math.min(sizes[j], c)))
    for (let k = 0; k < c; k++, r++) {
      day[r] = pickDay(p.days, rng, isWeekend)
      cols.forEach((col, j) => {
        const n = sizes[j]
        if (!n) return
        // full: every member, the pairing between columns rotated per period; partial: the c most popular, cycled
        const idx = c >= m ? (k + rotation(pi, j, n)) % n : k % Math.min(n, c)
        members[j][r] = col.order[idx]
      })
    }
  })
  return { day, members, periods: ps.length, fullPeriods, partialPeriods, pairs: sizes.reduce((a, n) => a + n * ps.length, 0), coveredPairs, rows }
}

export interface SnapshotLayout extends CoverStats {
  /** per row: snapshot day (rows in date order) */
  day: Int32Array
  /** per row: domain index of the entity */
  entity: Int32Array
  /** per other covered column, per row: domain index */
  members: Int32Array[]
}

/**
 * Snapshot rows: on each snapshot day, the first `alloc` entities in popularity order (all of them on saved and recent
 * days within the budget), one row each. Other covered columns follow the entity's rank (stable across days, so an
 * entity keeps its dimension members from one snapshot to the next). `minPerDay` keeps older days from being empty.
 */
export function layoutSnapshot(days: number[], savedDays: ReadonlySet<number>, entity: CoverColumn, others: CoverColumn[], budget: number, minPerDay = 5): SnapshotLayout {
  const n = entity.order.length
  const periods: PeriodBucket[] = days.map((d) => ({ key: String(d), days: [d], saved: savedDays.has(d) }))
  const ps = prioritise(periods)
  const alloc = allocate(ps, n, budget, Math.min(n, minPerDay))
  const per = new Map<number, number>()
  ps.forEach((p, i) => per.set(p.days[0], alloc[i]))
  const sorted = [...days].sort((a, b) => a - b)
  const rows = sorted.reduce((a, d) => a + (per.get(d) ?? 0), 0)
  const day = new Int32Array(rows)
  const ent = new Int32Array(rows)
  const members = others.map(() => new Int32Array(rows))
  let r = 0
  let fullPeriods = 0
  let partialPeriods = 0
  let coveredPairs = 0
  for (const d of sorted) {
    const c = per.get(d) ?? 0
    if (c >= n && n > 0) fullPeriods++
    else if (c > 0) partialPeriods++
    coveredPairs += Math.min(n, c)
    for (let k = 0; k < c; k++, r++) {
      day[r] = d
      ent[r] = entity.order[k]
      others.forEach((o, j) => {
        if (o.order.length) members[j][r] = o.order[k % o.order.length]
      })
    }
  }
  return { day, entity: ent, members, periods: sorted.length, fullPeriods, partialPeriods, pairs: n * sorted.length, coveredPairs, rows }
}
