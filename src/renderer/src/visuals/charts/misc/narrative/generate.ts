/**
 * Template-based narrative generation (pure). Mirrors the kinds of sentences Power BI's smart narrative
 * writes — trends over time, highest / lowest categories, shares, longest growth / decline, measures that
 * diverge — but from fixed templates over the visuals' aggregated data, not from a language model.
 *
 * Output: sentences as runs; `value: true` marks dynamic values (rendered highlighted, like PBI's
 * underlined dynamic values). The analysis (high/low, ranking with ties, KPI states, time insights, shares) lives
 * in insights.ts, shared with the smart-narrative text box (elements/narrativeQuery.ts), so the Narrative visual
 * and Power BI's smart narratives say the same thing about the same numbers.
 */
import { aggregateSummary, contributorShares, highLow, kpiSummary, relChange, templateSentence, timeInsights, toPoints, type InsightPoint, type OutputValue, type Run, type Sentence } from './insights'

export interface NarrSeries {
  measure: string
  values: Array<number | null>
  /** formats a value of this measure (display units, format string) */
  format(v: number): string
  /** ratio / percentage measure: no "accounted for x% of" sentence, no summing */
  ratio?: boolean
  /** measures with the same unit key can be compared with each other */
  unitKey?: string
}

export interface NarrDataset {
  /** category axis (absent for cards / KPIs) */
  category?: { name: string; labels: string[]; ordered: boolean }
  series: NarrSeries[]
}

export type { Run, Sentence }

export interface NarrateOptions {
  /** Power BI: up to 4 summaries per visual and 16 per page */
  maxPerVisual?: number
  maxTotal?: number
}

const v = (text: string): Run => ({ text, value: true })
const t = (text: string): Run => ({ text })

export { relChange }

export function pct(x: number): string {
  const s = (Math.abs(x) * 100).toFixed(2)
  return `${s}%`
}

/** Sentence → plain text (tests, accessibility, "Show as table"). */
export function sentenceText(s: Sentence): string {
  return s.map((r) => r.text).join('')
}

type Point = InsightPoint

function points(ds: NarrDataset, s: NarrSeries): Point[] {
  return toPoints(ds.category?.labels ?? [], s.values)
}

/** Trend sentence(s) for ordered (time) axes. Two or more series moving the same way are merged like PBI. */
export function trendSentences(ds: NarrDataset): Sentence[] {
  const cat = ds.category
  if (!cat || !cat.ordered) return []
  const trends = ds.series
    .map((s) => {
      const p = points(ds, s)
      if (p.length < 2) return null
      const first = p[0]
      const last = p[p.length - 1]
      const ch = relChange(first.value, last.value)
      return { s, first, last, ch, dir: last.value > first.value ? 'up' : last.value < first.value ? 'down' : 'flat' }
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.dir !== 'flat')
  if (!trends.length) return []
  const out: Sentence[] = []
  const sameSpan = trends.every((x) => x.first.i === trends[0].first.i && x.last.i === trends[0].last.i)
  const sameDir = trends.every((x) => x.dir === trends[0].dir)
  if (trends.length >= 2 && sameSpan && sameDir && trends.every((x) => x.ch !== null)) {
    const runs: Run[] = []
    trends.forEach((x, k) => {
      if (k > 0) runs.push(t(k === trends.length - 1 ? ' and ' : ', '))
      runs.push(v(x.s.measure), t(' ('), v(pct(x.ch!)), t(x.dir === 'up' ? ' increase)' : ' decrease)'))
    })
    runs.push(t(` ${trends.length === 2 ? 'both' : 'all'} trended ${trends[0].dir} between `), v(trends[0].first.label), t(' and '), v(trends[0].last.label), t('.'))
    out.push(runs)
    return out
  }
  for (const x of trends) {
    if (x.ch !== null) {
      out.push([v(x.s.measure), t(` trended ${x.dir}, resulting in a `), v(pct(x.ch)), t(` ${x.dir === 'up' ? 'increase' : 'decrease'} between `), v(x.first.label), t(' and '), v(x.last.label), t('.')])
    } else {
      out.push([v(x.s.measure), t(` went from `), v(x.s.format(x.first.value)), t(' in '), v(x.first.label), t(' to '), v(x.s.format(x.last.value)), t(' in '), v(x.last.label), t('.')])
    }
  }
  return out
}

/** Formats transform outputs for template sentences (categories → labels, values → the measure's format). */
function outputFormatter(outputs: Record<string, OutputValue>, series: NarrSeries[]): (role: string) => string {
  return (role) => {
    const o = outputs[role]
    if (!o || o.value === null || o.value === undefined) return ''
    if (o.kind === 'category') return String(o.value)
    if (o.kind === 'percent') return pct(Number(o.value))
    if (o.kind === 'count') return String(o.value)
    return (series[o.measure ?? 0] ?? series[0]).format(Number(o.value))
  }
}

/** "X peaked in <label> at <v> and was lowest in <label> at <v>." for ordered axes (≥ 3 points). */
export function peakSentence(ds: NarrDataset, s: NarrSeries): Sentence | null {
  if (!ds.category?.ordered) return null
  const p = points(ds, s)
  if (p.length < 3) return null
  const ti = timeInsights(p)
  if (!ti || ti.peak.value === ti.low.value) return null
  return [v(s.measure), t(' peaked in '), v(ti.peak.label), t(' at '), v(s.format(ti.peak.value)), t(' and was lowest in '), v(ti.low.label), t(' at '), v(s.format(ti.low.value)), t('.')]
}

/** Longest run of consecutive increases or decreases (≥ 2 steps): "X experienced the longest period of growth (+Δ) between A and B." */
export function longestRunSentence(ds: NarrDataset, s: NarrSeries): Sentence | null {
  if (!ds.category?.ordered) return null
  const p = points(ds, s)
  if (p.length < 3) return null
  const run = timeInsights(p)?.longestRun
  if (!run) return null
  const delta = run.to.value - run.from.value
  const sign = delta > 0 ? '+' : '-'
  return [v(s.measure), t(` experienced the longest period of ${run.direction === 'up' ? 'growth' : 'decline'} (`), v(sign + s.format(Math.abs(delta))), t(') between '), v(run.from.label), t(' and '), v(run.to.label), t('.')]
}

/**
 * Largest period-over-period changes (ordered axes, ≥ 3 points): "The largest increase in Sales was between Mar
 * and Apr (+30, 25.00%), and the largest decrease between May and Jun (-12, 10.00%)."
 */
export function changeSentence(ds: NarrDataset, s: NarrSeries): Sentence | null {
  if (!ds.category?.ordered) return null
  const p = points(ds, s)
  if (p.length < 3) return null
  const ti = timeInsights(p)
  if (!ti || (!ti.maxIncrease && !ti.maxDecrease)) return null
  const step = (st: NonNullable<typeof ti.maxIncrease>): Run[] => {
    const runs: Run[] = [t(' between '), v(st.from.label), t(' and '), v(st.to.label), t(' ('), v((st.delta > 0 ? '+' : '-') + s.format(Math.abs(st.delta)))]
    if (st.change !== null) runs.push(t(', '), v(pct(st.change)))
    runs.push(t(')'))
    return runs
  }
  const out: Sentence = []
  if (ti.maxIncrease) out.push(t('The largest increase in '), v(s.measure), t(' was'), ...step(ti.maxIncrease))
  if (ti.maxDecrease) {
    if (out.length) out.push(t(', and the largest decrease'), ...step(ti.maxDecrease))
    else out.push(t('The largest decrease in '), v(s.measure), t(' was'), ...step(ti.maxDecrease))
  }
  out.push(t('.'))
  return out
}

/** Highest vs lowest category (Power BI's HighPointLowPointSummary, template 10001). */
export function extremesSentence(ds: NarrDataset, s: NarrSeries): Sentence | null {
  if (!ds.category || ds.category.ordered) return null
  const p = points(ds, s)
  if (p.length < 2) return null
  const hl = highLow(p)
  if (!hl) return [t('All '), v(String(p.length)), t(` ${ds.category.name} values had the same `), v(s.measure), t(' ('), v(s.format(p[0].value)), t(').')]
  if (hl.change === null)
    return [t('At '), v(s.format(hl.hi.value)), t(', '), v(hl.hi.label), t(' had the highest '), v(s.measure), t(', while '), v(hl.lo.label), t(' had the lowest at '), v(s.format(hl.lo.value)), t('.')]
  const outputs: Record<string, OutputValue> = {
    V1: { kind: 'value', value: hl.hi.value },
    V2: { kind: 'category', value: hl.hi.label },
    V3: { kind: 'value', value: hl.lo.value },
    V4: { kind: 'category', value: hl.lo.label },
    V5: { kind: 'percent', value: hl.change }
  }
  return templateSentence(10001, { measures: [s.measure], category: ds.category.name }, outputFormatter(outputs, [s]))
}

/**
 * Ranking with ties (Power BI's AggregateSummary, templates 43xxx): "A had the highest Sales at 9, followed by B
 * and C. Z had the lowest Sales at 1." Only for three or more categories (two are covered by the extremes).
 */
export function rankingSentence(ds: NarrDataset, s: NarrSeries): Sentence | null {
  if (!ds.category || ds.category.ordered) return null
  const p = points(ds, s)
  if (p.length < 3) return null
  const r = aggregateSummary(p)
  if (r.templateId === 43006 || r.templateId === 43019) return null
  return templateSentence(r.templateId, { measures: [s.measure], category: ds.category.name }, outputFormatter(r.outputs, [s]))
}

/** Values of up to three measures for each of ≤ 3 categories (Power BI's KPISummary, templates 56005–56011). */
export function statesSentence(ds: NarrDataset): Sentence | null {
  if (!ds.category || ds.category.ordered || ds.series.length < 2) return null
  const n = ds.category.labels.length
  if (n < 1 || n > 3) return null
  const ms = ds.series.slice(0, 3)
  const r = kpiSummary(ds.category.labels, ms.map((x) => x.values))
  return templateSentence(r.templateId, { measures: ms.map((x) => x.measure), category: ds.category.name }, outputFormatter(r.outputs, ms))
}

/** Top and bottom contributors: "North accounted for 55.56% of Sales, while South accounted for 11.11%." (additive, non-negative measures only) */
export function shareSentence(ds: NarrDataset, s: NarrSeries): Sentence | null {
  if (!ds.category || s.ratio) return null
  const p = points(ds, s)
  const sh = contributorShares(p)
  if (!sh || sh.topShare < 0.15 || sh.topShare > 0.999) return null
  const out: Sentence = [v(sh.top.label), t(' accounted for '), v(pct(sh.topShare)), t(' of '), v(s.measure)]
  if (p.length >= 3 && sh.bottom !== sh.top) out.push(t(', while '), v(sh.bottom.label), t(' accounted for '), v(pct(sh.bottomShare)))
  out.push(t('.'))
  return out
}

/** Total of an additive measure over the categories: "Across all 4 Region, Sales totaled 900." */
export function totalSentence(ds: NarrDataset, s: NarrSeries): Sentence | null {
  if (!ds.category || s.ratio) return null
  const p = points(ds, s)
  const sh = contributorShares(p)
  if (!sh) return null
  return [t('Across all '), v(String(p.length)), t(` ${ds.category.name}, `), v(s.measure), t(' totaled '), v(s.format(sh.total)), t('.')]
}

/** Two comparable measures: "Total Sales and Total Cost diverged the most when the Region was Europe, when Total Sales were $1.2M higher than Total Cost." */
export function divergenceSentence(ds: NarrDataset, a: NarrSeries, b: NarrSeries): Sentence | null {
  if (!ds.category || a.unitKey === undefined || a.unitKey !== b.unitKey) return null
  let best = -1
  let gap = 0
  ds.category.labels.forEach((_, i) => {
    const x = a.values[i]
    const y = b.values[i]
    if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) return
    if (Math.abs(x - y) > Math.abs(gap) || best < 0) {
      best = i
      gap = x - y
    }
  })
  if (best < 0 || gap === 0) return null
  return [
    v(a.measure),
    t(' and '),
    v(b.measure),
    t(` diverged the most when the ${ds.category.name} was `),
    v(ds.category.labels[best]),
    t(', when '),
    v(a.measure),
    t(' was '),
    v(a.format(Math.abs(gap))),
    t(gap > 0 ? ' higher than ' : ' lower than '),
    v(b.measure),
    t('.')
  ]
}

/** Time axis with two comparable measures: "Between A and B, the average of X (…) was higher than Y (…)." */
export function averageComparisonSentence(ds: NarrDataset, a: NarrSeries, b: NarrSeries): Sentence | null {
  if (!ds.category?.ordered || a.unitKey === undefined || a.unitKey !== b.unitKey) return null
  const pa = points(ds, a)
  const pb = points(ds, b)
  if (pa.length < 2 || pb.length < 2) return null
  const avg = (p: Point[]) => p.reduce((s, x) => s + x.value, 0) / p.length
  const ma = avg(pa)
  const mb = avg(pb)
  if (ma === mb) return null
  const [hi, hv, lo, lv] = ma > mb ? [a, ma, b, mb] : [b, mb, a, ma]
  const first = Math.min(pa[0].i, pb[0].i)
  const last = Math.max(pa[pa.length - 1].i, pb[pb.length - 1].i)
  return [
    t('Between '),
    v(ds.category.labels[first]),
    t(' and '),
    v(ds.category.labels[last]),
    t(', the average of '),
    v(hi.measure),
    t(' ('),
    v(hi.format(hv)),
    t(') was higher than '),
    v(lo.measure),
    t(' ('),
    v(lo.format(lv)),
    t(').')
  ]
}

/** Card / KPI: "Total Sales is $13.6M." */
export function valueSentence(s: NarrSeries): Sentence | null {
  const x = s.values[0]
  if (x === null || x === undefined || !Number.isFinite(x)) return null
  return [v(s.measure), t(' is '), v(s.format(x)), t('.')]
}

/** All sentences for one dataset, most informative first. */
export function datasetSentences(ds: NarrDataset): Array<{ key: string; sentence: Sentence }> {
  const out: Array<{ key: string; sentence: Sentence }> = []
  const cat = ds.category
  const push = (key: string, s: Sentence | null) => {
    if (s) out.push({ key, sentence: s })
  }
  if (!cat) {
    for (const s of ds.series) push(`value|${s.measure}`, valueSentence(s))
    return out
  }
  if (cat.ordered) {
    const tr = trendSentences(ds)
    tr.forEach((s, i) => push(`trend|${cat.name}|${ds.series.map((x) => x.measure).join('+')}|${i}`, s))
    if (ds.series.length >= 2) push(`avg|${cat.name}|${ds.series[0].measure}|${ds.series[1].measure}`, averageComparisonSentence(ds, ds.series[0], ds.series[1]))
    for (const s of ds.series) {
      push(`change|${cat.name}|${s.measure}`, changeSentence(ds, s))
      push(`peak|${cat.name}|${s.measure}`, peakSentence(ds, s))
      push(`run|${cat.name}|${s.measure}`, longestRunSentence(ds, s))
    }
    return out
  }
  // first measure's highlights, then how the measures relate, then the other measures
  const [first, ...rest] = ds.series
  push(`ext|${cat.name}|${first.measure}`, extremesSentence(ds, first))
  push(`rank|${cat.name}|${first.measure}`, rankingSentence(ds, first))
  push(`share|${cat.name}|${first.measure}`, shareSentence(ds, first))
  if (rest.length) {
    push(`states|${cat.name}|${ds.series.map((x) => x.measure).join('+')}`, statesSentence(ds))
    push(`div|${cat.name}|${first.measure}|${rest[0].measure}`, divergenceSentence(ds, first, rest[0]))
  }
  push(`total|${cat.name}|${first.measure}`, totalSentence(ds, first))
  for (const s of rest) {
    push(`ext|${cat.name}|${s.measure}`, extremesSentence(ds, s))
    push(`share|${cat.name}|${s.measure}`, shareSentence(ds, s))
  }
  return out
}

/**
 * Summarize several datasets (visuals in reading order). Repeated insights (same kind / measure / category)
 * are reported once, like Power BI avoiding the same kind of summary for different visuals.
 */
export function narrate(datasets: NarrDataset[], opts: NarrateOptions = {}): Sentence[] {
  const perVisual = opts.maxPerVisual ?? 4
  const max = opts.maxTotal ?? 16
  const seen = new Set<string>()
  const out: Sentence[] = []
  for (const ds of datasets) {
    let n = 0
    for (const { key, sentence } of datasetSentences(ds)) {
      if (n >= perVisual || out.length >= max) break
      if (seen.has(key)) continue
      seen.add(key)
      out.push(sentence)
      n++
    }
    if (out.length >= max) break
  }
  return out
}
