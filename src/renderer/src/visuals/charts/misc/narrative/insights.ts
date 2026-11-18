/**
 * Smart-narrative insight engine (pure) — the ONE place where Lumen decides what a summary says.
 *
 * Power BI's smart narrative is built from three summary "transforms" that it stores in the text box's
 * `objects.values` as SQ `Transform` subqueries (see elements/narrativeQuery.ts):
 *   - `HighPointLowPointSummary` (template 10001): highest / lowest category and the % difference,
 *   - `AggregateSummary` (templates 43001–43022): ranking with ties ("A had the highest … followed by B and C"),
 *   - `KPISummary` (templates 56001–56013): values of the first states, or the range across all states.
 * Each transform returns output roles V1…Vn plus `TemplateIdColumnRole`; the text box holds one switch per
 * template id whose runs reference the outputs. The functions below compute those outputs and choose the
 * template id; the Narrative visual (aiNarratives) phrases the same template ids with `templateSentence`, so
 * both renderings say the same thing about the same numbers.
 *
 * Template selection is inferred from the template texts Power BI writes (it isn't documented): e.g. 43003 is
 * "three categories, no ties", 43004 "top two tied, then a third". Where Power BI's exact choice can't be
 * known (e.g. when it prefers 43009 over 43018) the closest faithful template is used.
 *
 * Time insights (first→last change, largest period-over-period increase / decrease, peak, longest run) are
 * computed here too and phrased by generate.ts.
 */
import type { Scalar } from '@core/model/data'

/** One non-blank value of a measure at a category position. */
export interface InsightPoint {
  /** category index (row order of the query) */
  i: number
  label: string
  value: number
  /** raw category value (for formatting with the column's format string) */
  raw?: Scalar
}

export function toPoints(labels: string[], values: Array<number | null>, raws?: Scalar[]): InsightPoint[] {
  const out: InsightPoint[] = []
  values.forEach((value, i) => {
    if (value !== null && value !== undefined && Number.isFinite(value)) out.push({ i, label: labels[i] ?? '', value, raw: raws?.[i] })
  })
  return out
}

/** Relative change from a to b (null when a is 0 or the signs differ). */
export function relChange(a: number, b: number): number | null {
  if (a === 0 || (a < 0 && b > 0) || (a > 0 && b < 0)) return null
  return (b - a) / Math.abs(a)
}

// ------------------------------------------------------------------------------------------------
// Transform outputs
// ------------------------------------------------------------------------------------------------

/** What an output role holds — decides how the text box formats it. */
export type OutputKind = 'category' | 'value' | 'percent' | 'count'

export interface OutputValue {
  kind: OutputKind
  /** raw value: category scalar, measure value, ratio (percent) or count */
  value: Scalar
  /** for 'value' outputs: index of the measure (KPISummary has up to three) */
  measure?: number
}

export interface SummaryResult {
  /** chosen template id (the text box shows the matching switch case; unknown ids show the default case) */
  templateId: number
  outputs: Record<string, OutputValue>
}

const cat = (p: InsightPoint | undefined): OutputValue => ({ kind: 'category', value: p ? (p.raw ?? p.label) : null })
const val = (x: number | null | undefined, measure = 0): OutputValue => ({ kind: 'value', value: x ?? null, measure })

function highest(points: InsightPoint[]): InsightPoint {
  return points.reduce((a, x) => (x.value > a.value ? x : a), points[0])
}

function lowest(points: InsightPoint[]): InsightPoint {
  return points.reduce((a, x) => (x.value < a.value ? x : a), points[0])
}

export interface HighLow {
  hi: InsightPoint
  lo: InsightPoint
  /** (hi − lo) / |lo|, null when undefined */
  change: number | null
}

/** Highest and lowest point (first wins on ties); null with fewer than two points or when all are equal. */
export function highLow(points: InsightPoint[]): HighLow | null {
  if (points.length < 2) return null
  const hi = highest(points)
  const lo = lowest(points)
  if (hi.value === lo.value) return null
  return { hi, lo, change: relChange(lo.value, hi.value) }
}

/** HighPointLowPointSummary: V1 max, V2 category with max, V3 min, V4 category with min, V5 % difference. */
export function highLowSummary(points: InsightPoint[], initialTemplateId = 10000): SummaryResult {
  const hl = highLow(points)
  if (!hl) return { templateId: initialTemplateId, outputs: {} }
  return {
    templateId: 10001,
    outputs: { V1: val(hl.hi.value), V2: cat(hl.hi), V3: val(hl.lo.value), V4: cat(hl.lo), V5: { kind: 'percent', value: hl.change } }
  }
}

/** Points ranked by value, highest first (ties keep category order). */
export function ranked(points: InsightPoint[]): InsightPoint[] {
  return [...points].sort((a, b) => b.value - a.value || a.i - b.i)
}

/** Number of points tied with the first of a ranked list. */
function tiedAtTop(r: InsightPoint[]): number {
  let k = 1
  while (k < r.length && r[k].value === r[0].value) k++
  return k
}

/**
 * AggregateSummary: V4/V5 top category/value, V6/V7 second, V8/V9 third, V10/V11 fourth (V11 is the 4th
 * category, as in PBI's templates), V15/V16 lowest category/value, V17 count (of tied top categories for 43015,
 * else of categories).
 */
export function aggregateSummary(points: InsightPoint[]): SummaryResult {
  const r = ranked(points)
  const n = r.length
  if (!n) return { templateId: 43019, outputs: {} }
  const last = r[n - 1]
  const k = tiedAtTop(r)
  const outputs: Record<string, OutputValue> = {
    V4: cat(r[0]),
    V5: val(r[0].value),
    V6: cat(r[1]),
    V7: val(r[1]?.value),
    V8: cat(r[2]),
    V9: val(r[2]?.value),
    V10: val(r[3]?.value),
    V11: cat(r[3]),
    V15: cat(last),
    V16: val(last.value),
    V17: { kind: 'count', value: n }
  }
  const eq = (a: number, b: number) => r[a] !== undefined && r[b] !== undefined && r[a].value === r[b].value
  let id: number
  if (n === 1) id = 43006
  else if (k === n) id = n === 2 ? 43002 : n > 50 ? 43022 : 43006
  else if (n === 2) id = 43001
  else if (n === 3) id = eq(0, 1) ? 43004 : eq(1, 2) ? 43005 : 43003
  else if (n === 4) id = k === 3 ? 43011 : k === 2 ? 43013 : eq(1, 2) ? 43021 : 43007
  else if (k > 50) id = 43022
  else if (k >= 4) {
    id = 43015
    outputs.V17 = { kind: 'count', value: k }
  } else if (k === 3) id = 43011
  else if (k === 2) id = 43020
  else id = eq(1, 2) ? 43021 : 43016
  return { templateId: id, outputs }
}

/** KPISummary output roles per measure: values at the first three states and the range. */
const KPI_ROLES = [
  { states: ['V3', 'V9', 'V13'], range: ['V17', 'V18'] },
  { states: ['V5', 'V10', 'V14'], range: ['V19', 'V20'] },
  { states: ['V7', 'V11', 'V15'], range: ['V21', 'V22'] }
]
const KPI_STATES = ['V1', 'V8', 'V12']

/**
 * KPISummary over up to three measures by state (category, in its sort order): with 1–3 states the values at
 * each state (56001–56003 for one measure, +4 per extra measure), with more states the range across all
 * states (56004 / 56008 / 56012). No data → 56013 ("Blank.").
 */
export function kpiSummary(labels: string[], measures: Array<Array<number | null>>, raws?: Scalar[]): SummaryResult {
  const m = Math.max(1, Math.min(3, measures.length))
  const rows = labels.map((_, i) => i).filter((i) => measures.slice(0, m).some((vals) => vals[i] !== null && vals[i] !== undefined && Number.isFinite(vals[i] as number)))
  const n = rows.length
  if (!n) return { templateId: 56013, outputs: {} }
  const outputs: Record<string, OutputValue> = { V16: { kind: 'count', value: n } }
  KPI_STATES.forEach((role, s) => {
    if (s < n) outputs[role] = { kind: 'category', value: raws?.[rows[s]] ?? labels[rows[s]] }
  })
  for (let k = 0; k < m; k++) {
    const vals = measures[k] ?? []
    KPI_ROLES[k].states.forEach((role, s) => {
      if (s < n) outputs[role] = val(vals[rows[s]], k)
    })
    const xs = rows.map((i) => vals[i]).filter((x): x is number => x !== null && x !== undefined && Number.isFinite(x))
    if (xs.length) {
      outputs[KPI_ROLES[k].range[0]] = val(Math.min(...xs), k)
      outputs[KPI_ROLES[k].range[1]] = val(Math.max(...xs), k)
    }
  }
  return { templateId: 56000 + (m - 1) * 4 + Math.min(n, 4), outputs }
}

// ------------------------------------------------------------------------------------------------
// Template texts (Power BI's English smart-narrative templates), for the Narrative visual
// ------------------------------------------------------------------------------------------------

export interface Run {
  text: string
  /** dynamic value (rendered emphasized, like PBI's underlined values) */
  value?: boolean
}
export type Sentence = Run[]

export interface TemplateNames {
  /** measure display names (KPISummary: up to three) */
  measures: string[]
  /** category field display name */
  category: string
}

/**
 * The sentence of a template id with its outputs already formatted (`fmt(role)`), or null for blank /
 * unknown templates. Texts follow the templates Power BI writes into smart-narrative text boxes.
 */
export function templateSentence(id: number, names: TemplateNames, fmt: (role: string) => string): Sentence | null {
  const v = (role: string): Run => ({ text: fmt(role), value: true })
  const t = (text: string): Run => ({ text })
  const M = names.measures[0] ?? ''
  const m = (s: string): Run => ({ text: s, value: true })
  const C = names.category
  switch (id) {
    case 10001:
      return [t('At '), v('V1'), t(', '), v('V2'), t(' had the highest '), m(M), t(' and was '), v('V5'), t(' higher than '), v('V4'), t(', which had the lowest '), m(M), t(' at '), v('V3'), t('.')]
    case 43001:
      return [m(M), t(' for '), v('V4'), t(' ('), v('V5'), t(') was higher than '), v('V6'), t(' ('), v('V7'), t(').')]
    case 43002:
      return [m(M), t(' for both '), v('V4'), t(' and '), v('V6'), t(' was '), v('V5'), t('.')]
    case 43003:
      return [v('V4'), t(' had the highest '), m(M), t(' at '), v('V5'), t(', followed by '), v('V6'), t(' at '), v('V7'), t(' and '), v('V8'), t(' at '), v('V9'), t('.')]
    case 43004:
      return [v('V4'), t(' and '), v('V6'), t(' tied for highest '), m(M), t(' with '), v('V5'), t(', followed by '), v('V8'), t(' at '), v('V9'), t('.')]
    case 43005:
    case 43021:
      return [v('V4'), t(' had the highest '), m(M), t(' at '), v('V5'), t(', followed by '), v('V6'), t(' and '), v('V8'), t(', which tied for second at '), v('V7'), t('.')]
    case 43006:
      return [t('All '), m(C), t(' had '), m(M), t(' of '), v('V5'), t('.')]
    case 43007:
      return [v('V4'), t(' had the highest '), m(M), t(' at '), v('V5'), t(', followed by '), v('V6'), t(', '), v('V8'), t(', and '), v('V11'), t('.')]
    case 43008:
      return [v('V4'), t(' and '), v('V6'), t(' tied for highest '), m(M), t(' at '), v('V5'), t('.')]
    case 43009:
      return [v('V4'), t(' had the highest '), m(M), t(' at '), v('V5'), t(' and '), v('V15'), t(' had the lowest at '), v('V16'), t('.')]
    case 43010:
      return [v('V4'), t(' had the highest '), m(M), t(' at '), v('V5'), t(', followed by '), v('V6'), t(' at '), v('V7'), t('.')]
    case 43011:
      return [v('V4'), t(', '), v('V6'), t(', and '), v('V8'), t(' tied for highest '), m(M), t(' at '), v('V5'), t('. '), v('V15'), t(' had the lowest '), m(M), t(' at '), v('V16'), t('.')]
    case 43012:
      return [m(M), t(' was highest for '), v('V4'), t(' at '), v('V5'), t(', followed by '), v('V6'), t(' and '), v('V8'), t('.')]
    case 43013:
      return [v('V4'), t(' and '), v('V6'), t(' tied for highest '), m(M), t(' at '), v('V5'), t(', followed by '), v('V8'), t('.')]
    case 43015:
      return [t('The top '), v('V17'), t(' '), m(C), t(' all had '), m(M), t(' of '), v('V5'), t('.')]
    case 43016:
      return [v('V4'), t(' had the highest '), m(M), t(' at '), v('V5'), t(', followed by '), v('V6'), t(' and '), v('V8'), t('. '), v('V15'), t(' had the lowest '), m(M), t(' at '), v('V16'), t('.')]
    case 43018:
      return [v('V4'), t(' had the highest '), m(M), t(' at '), v('V5'), t('. '), v('V15'), t(' had the lowest '), m(M), t(' at '), v('V16'), t('.')]
    case 43020:
      return [v('V4'), t(' and '), v('V6'), t(' tied for highest '), m(M), t(' at '), v('V5'), t(', followed by '), v('V8'), t('. '), v('V15'), t(' had the lowest '), m(M), t(' at '), v('V16'), t('.')]
    case 43022:
      return [t('More than 50 '), m(C), t(' tied for the highest '), m(M), t(' at '), v('V5'), t('.')]
  }
  if (id > 56000 && id < 56013) {
    const k = Math.floor((id - 56001) / 4) // extra measures
    const n = ((id - 56001) % 4) + 1 // states (4 = range)
    const ms = names.measures.slice(0, k + 1)
    if (n === 4) {
      const out: Sentence = [t('Across all '), v('V16'), t(' '), m(C), t(', ')]
      ms.forEach((name, j) => {
        if (j > 0) out.push(t(j === ms.length - 1 ? (ms.length > 2 ? ', and ' : ' and ') : ', '))
        out.push(m(name), t(' ranged from '), v(KPI_ROLES[j].range[0]), t(' to '), v(KPI_ROLES[j].range[1]))
      })
      out.push(t('.'))
      return out
    }
    const out: Sentence = []
    if (k === 0) {
      // "S1 had a M." / "S1 had a M and S2 had b." / "S1 had a M, S2 had b, and S3 had c."
      for (let s = 0; s < n; s++) {
        if (s > 0) out.push(t(n === 2 ? ' and ' : s === n - 1 ? ', and ' : ', '))
        out.push(v(KPI_STATES[s]), t(' had '), v(KPI_ROLES[0].states[s]))
        if (s === 0) out.push(t(' '), m(M))
      }
      out.push(t('.'))
      return out
    }
    // several measures: one sentence per state, "S1 had a M1 and b M2."
    for (let s = 0; s < n; s++) {
      if (s > 0) out.push(t(' '))
      out.push(v(KPI_STATES[s]), t(' had '))
      ms.forEach((name, j) => {
        if (j > 0) out.push(t(j === ms.length - 1 ? (ms.length > 2 ? ', and ' : ' and ') : ', '))
        out.push(v(KPI_ROLES[j].states[s]), t(' '), m(name))
      })
      out.push(t('.'))
    }
    return out
  }
  return null
}

// ------------------------------------------------------------------------------------------------
// Time insights
// ------------------------------------------------------------------------------------------------

export interface Step {
  from: InsightPoint
  to: InsightPoint
  delta: number
  change: number | null
}

export interface TimeInsights {
  first: InsightPoint
  last: InsightPoint
  /** first → last relative change */
  change: number | null
  direction: 'up' | 'down' | 'flat'
  /** largest period-over-period increase / decrease (consecutive non-blank points) */
  maxIncrease?: Step
  maxDecrease?: Step
  peak: InsightPoint
  low: InsightPoint
  /** longest run of consecutive increases or decreases (≥ 2 steps) */
  longestRun?: { from: InsightPoint; to: InsightPoint; direction: 'up' | 'down' }
}

/** Insights of a measure over an ordered (time) axis; null with fewer than two points. */
export function timeInsights(points: InsightPoint[]): TimeInsights | null {
  if (points.length < 2) return null
  const first = points[0]
  const last = points[points.length - 1]
  let maxIncrease: Step | undefined
  let maxDecrease: Step | undefined
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1]
    const b = points[k]
    const delta = b.value - a.value
    const step = { from: a, to: b, delta, change: relChange(a.value, b.value) }
    if (delta > 0 && (!maxIncrease || delta > maxIncrease.delta)) maxIncrease = step
    if (delta < 0 && (!maxDecrease || delta < maxDecrease.delta)) maxDecrease = step
  }
  // longest monotone run
  let run: TimeInsights['longestRun']
  let bestLen = 1
  let start = 0
  let dir: 0 | 1 | -1 = 0
  for (let k = 1; k <= points.length; k++) {
    const d: 0 | 1 | -1 = k < points.length ? (points[k].value > points[k - 1].value ? 1 : points[k].value < points[k - 1].value ? -1 : 0) : 0
    if (k < points.length && d !== 0 && d === dir) continue
    if (dir !== 0) {
      const len = k - 1 - start
      if (len >= 2 && len > bestLen) {
        bestLen = len
        run = { from: points[start], to: points[k - 1], direction: dir > 0 ? 'up' : 'down' }
      }
    }
    start = k - 1
    dir = d
  }
  return {
    first,
    last,
    change: relChange(first.value, last.value),
    direction: last.value > first.value ? 'up' : last.value < first.value ? 'down' : 'flat',
    maxIncrease,
    maxDecrease,
    peak: highest(points),
    low: lowest(points),
    longestRun: run
  }
}

/** Share of the total for the highest and lowest contributors (additive, non-negative measures only). */
export function contributorShares(points: InsightPoint[]): { total: number; top: InsightPoint; topShare: number; bottom: InsightPoint; bottomShare: number } | null {
  if (points.length < 2 || points.some((x) => x.value < 0)) return null
  const total = points.reduce((a, x) => a + x.value, 0)
  if (!(total > 0)) return null
  const top = highest(points)
  const bottom = lowest(points)
  return { total, top, topShare: top.value / total, bottom, bottomShare: bottom.value / total }
}
