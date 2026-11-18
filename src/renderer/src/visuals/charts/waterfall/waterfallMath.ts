/**
 * Waterfall step math (pure).
 *
 *  - Category only: each category is a step (increase/decrease) from the running total, then a
 *    final "Total" bar (`valueAxis.totalsEnabled`, default on).
 *  - Category + Breakdown (PBI): the first category is a total bar, then for each next category
 *    the top-N breakdown deltas vs. the previous category (N = `breakdown.maxBreakdowns`, default 5;
 *    ranked by |delta|, the rest summed as "Other"), followed by that category's total bar.
 *    Breakdown items with no change are omitted, like Power BI.
 *  - Breakdown only (no category): breakdown items as steps + Total.
 */
export type StepKind = 'increase' | 'decrease' | 'total' | 'other'

export interface WaterfallStep {
  kind: StepKind
  label: string
  /** running total before / after the step */
  start: number
  end: number
  value: number
  /** source category index (totals and simple steps) */
  ci?: number
  /** breakdown index (breakdown deltas) */
  bi?: number
  /** breakdown indices aggregated into an "Other" step */
  others?: number[]
}

export const DEFAULT_MAX_BREAKDOWNS = 5

export function simpleSteps(values: Array<number | null>, labels: string[], opts: { total?: boolean; totalLabel?: string } = {}): WaterfallStep[] {
  const out: WaterfallStep[] = []
  let acc = 0
  values.forEach((v, i) => {
    const x = v ?? 0
    out.push({ kind: x >= 0 ? 'increase' : 'decrease', label: labels[i], start: acc, end: acc + x, value: x, ci: i })
    acc += x
  })
  if (opts.total !== false) out.push({ kind: 'total', label: opts.totalLabel ?? 'Total', start: 0, end: acc, value: acc })
  return out
}

/** Clamp a `breakdown.maxBreakdowns` setting (PBI accepts 1–28). */
export function normalizeMaxBreakdowns(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return DEFAULT_MAX_BREAKDOWNS
  return Math.max(1, Math.min(28, Math.round(v)))
}

/** matrix[c][b] = value of breakdown b in category c. */
export function breakdownSteps(categoryLabels: string[], breakdownLabels: string[], matrix: Array<Array<number | null>>, maxBreakdowns = DEFAULT_MAX_BREAKDOWNS, opts: { otherLabel?: string } = {}): WaterfallStep[] {
  const out: WaterfallStep[] = []
  const totals = matrix.map((row) => row.reduce<number>((a, v) => a + (v ?? 0), 0))
  if (!categoryLabels.length) return out
  const n = normalizeMaxBreakdowns(maxBreakdowns)
  out.push({ kind: 'total', label: categoryLabels[0], start: 0, end: totals[0], value: totals[0], ci: 0 })
  let acc = totals[0]
  for (let c = 1; c < categoryLabels.length; c++) {
    const deltas = breakdownLabels.map((_, b) => ({ b, d: (matrix[c][b] ?? 0) - (matrix[c - 1][b] ?? 0) })).filter((x) => Math.abs(x.d) > 1e-12)
    deltas.sort((x, y) => Math.abs(y.d) - Math.abs(x.d) || x.b - y.b)
    const top = deltas.slice(0, n)
    const restItems = deltas.slice(n)
    const rest = restItems.reduce((a, x) => a + x.d, 0)
    for (const { b, d } of top) {
      out.push({ kind: d >= 0 ? 'increase' : 'decrease', label: breakdownLabels[b], start: acc, end: acc + d, value: d, bi: b, ci: c })
      acc += d
    }
    if (restItems.length && Math.abs(rest) > 1e-12) {
      out.push({ kind: 'other', label: opts.otherLabel ?? 'Other', start: acc, end: acc + rest, value: rest, ci: c, others: restItems.map((x) => x.b) })
      acc += rest
    }
    out.push({ kind: 'total', label: categoryLabels[c], start: 0, end: totals[c], value: totals[c], ci: c })
    acc = totals[c]
  }
  return out
}

export function stepExtent(steps: WaterfallStep[]): [number, number] {
  let lo = 0
  let hi = 0
  for (const s of steps) {
    lo = Math.min(lo, s.start, s.end)
    hi = Math.max(hi, s.start, s.end)
  }
  return [lo, hi]
}

export type WaterfallLabelPosition = 'Auto' | 'InsideEnd' | 'OutsideEnd' | 'InsideCenter' | 'InsideBase'

/**
 * Data-label anchor for a step bar spanning pixel rows [top, bottom] (top < bottom).
 * "End" is the end of the step in its direction: the top of increases / totals ≥ 0, the bottom of
 * decreases / negative totals. Auto = outside end, moved inside when it would leave the plot.
 */
export function labelAnchor(step: WaterfallStep, top: number, bottom: number, labelH: number, position: string, plot: { y: number; h: number }): { y: number; inside: boolean } {
  const down = step.kind === 'total' ? step.end < 0 : step.end < step.start
  const pos = (['InsideEnd', 'OutsideEnd', 'InsideCenter', 'InsideBase'].includes(position) ? position : 'Auto') as WaterfallLabelPosition
  const outside = down ? bottom + 2 + labelH / 2 : top - 2 - labelH / 2
  const insideEnd = down ? bottom - 2 - labelH / 2 : top + 2 + labelH / 2
  // inside positions fall back to outside end when the bar is too short for the label (PBI)
  const fitsInside = bottom - top >= labelH + 2
  if (pos !== 'OutsideEnd' && pos !== 'Auto' && !fitsInside) return { y: outside, inside: false }
  switch (pos) {
    case 'InsideEnd':
      return { y: insideEnd, inside: true }
    case 'InsideCenter':
      return { y: (top + bottom) / 2, inside: true }
    case 'InsideBase':
      return { y: down ? top + 2 + labelH / 2 : bottom - 2 - labelH / 2, inside: true }
    case 'OutsideEnd':
      return { y: outside, inside: false }
    default: {
      const fits = outside - labelH / 2 >= plot.y && outside + labelH / 2 <= plot.y + plot.h
      return fits || !fitsInside ? { y: outside, inside: false } : { y: insideEnd, inside: true }
    }
  }
}
