/**
 * Date picker slicer model (classic `slicer` visual, `data.mode = 'RelativeDatePicker'`, shown as
 * "Date picker" in the format pane's Style dropdown — PBI's default style for date columns since 2026).
 *
 * What Power BI documents (learn.microsoft.com/power-bi/visuals/power-bi-visualization-slicer-visual#date-picker
 * and …/desktop-slicer-filter-date-range):
 *   - relative selections Last / Next / This × N × Days, Weeks, Weeks (Calendar), Months, Months (Calendar),
 *     Years, Years (Calendar), anchored on **Today**, **First date** or **Last date** of the column, with an
 *     optional **Offset** (periods, positive or negative) applied to the anchor before the range is computed;
 *   - manual selection of a range or a single date with a calendar ("select a start date, then an end date;
 *     select the same date twice for a single date") or the slider, committed with **Apply**;
 *   - `selection.singleDate` ("Single date"): range selection disabled, relative options restricted to whole days;
 *   - the canvas shows the selected range (column format string), a restatement such as
 *     "In the last 1 month from last date", and an indicator when the range extends past the available dates.
 *
 * PBIR keys. Documented in the report theme JSON schema (reportThemeSchema-2.159, `visual-slicer`):
 *   data.mode 'RelativeDatePicker', data.relativeRange ('Last'|'Next'|'This'), data.relativeDuration (number),
 *   data.relativePeriod ('Days'|'Weeks'|'Calendar Weeks'|'Months'|'Calendar Months'|'Years'|'Calendar Years'),
 *   data.startDate / data.endDate (strings), selection.singleDate, dateRange.anchorDate / includeToday,
 *   calendarButton (icon/background/stroke/corners), dateRangeText + relativeText (fonts), slider.*.
 * NOT in any published schema (guessed, plausible names — PBI ignores unknown properties):
 *   data.relativeAnchor ('Today'|'FirstDate'|'LastDate') and data.relativeOffset (number of periods).
 *
 * The filter written to `general.filter` is what every engine applies:
 *   - relative + Today anchor + no offset → PBI's rolling relative-date shape (DateSpan/DateAdd of `Now`),
 *     so it keeps rolling without Lumen re-evaluating it;
 *   - relative + First/Last date anchor or an offset → the same shape with the resolved anchor date as a
 *     literal in place of `Now` (like `dateRange.anchorDate`); the slicer re-resolves it when the data changes;
 *   - manual → `>= start AND < end + 1 day` (PBI's Between date shape).
 */
import type { SQExpr, SQFilter } from '@core/report/sq'
import { decodeLiteral, encodeLiteral } from '@core/report/literal'
import { setObjectProp } from '@core/report/props'
import { addUnits, parseRangeFilter, parseRelativeFilter, rangeFilter, relativeFilter, relativeRange, TimeUnit, type RelativeSelection } from './filterModel'

export const DAY_MS = 86400000

export type PickerAnchor = 'today' | 'first' | 'last'
export type PickerUnit = 'days' | 'weeks' | 'months' | 'years'

export interface PickerRelative {
  kind: 'relative'
  range: 'last' | 'next' | 'this'
  n: number
  unit: PickerUnit
  /** "(Calendar)" periods: whole weeks / months / years */
  calendar: boolean
  anchor: PickerAnchor
  /** periods (of `unit`) added to the anchor before computing the range; 0 = none */
  offset: number
}

export interface PickerManual {
  kind: 'manual'
  /** inclusive start / end day (naive UTC dates, time 00:00) */
  start: Date
  end: Date
}

export type PickerRule = PickerRelative | PickerManual

export interface DateSpanRange {
  start: Date
  /** inclusive last day */
  end: Date
}

/** PBIR `data.relativePeriod` values (schema enum) ↔ unit + calendar flag. */
export const PERIODS: Array<{ value: string; label: string; unit: PickerUnit; calendar: boolean }> = [
  { value: 'Days', label: 'Days', unit: 'days', calendar: false },
  { value: 'Weeks', label: 'Weeks', unit: 'weeks', calendar: false },
  { value: 'Calendar Weeks', label: 'Weeks (Calendar)', unit: 'weeks', calendar: true },
  { value: 'Months', label: 'Months', unit: 'months', calendar: false },
  { value: 'Calendar Months', label: 'Months (Calendar)', unit: 'months', calendar: true },
  { value: 'Years', label: 'Years', unit: 'years', calendar: false },
  { value: 'Calendar Years', label: 'Years (Calendar)', unit: 'years', calendar: true }
]

const ANCHOR_VALUE: Record<PickerAnchor, string> = { today: 'Today', first: 'FirstDate', last: 'LastDate' }
const UNIT_CODE: Record<PickerUnit, number> = { days: TimeUnit.Day, weeks: TimeUnit.Week, months: TimeUnit.Month, years: TimeUnit.Year }

export function periodOf(unit: PickerUnit, calendar: boolean): string {
  return PERIODS.find((p) => p.unit === unit && p.calendar === (calendar && unit !== 'days'))?.value ?? 'Days'
}

export function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export function sameDay(a: Date | undefined, b: Date | undefined): boolean {
  return !!a && !!b && a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate()
}

// ---------------------------------------------------------------------------------------------
// PBIR objects ⇄ rule
// ---------------------------------------------------------------------------------------------

function dataProps(visualJson: any): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const e of visualJson?.visual?.objects?.data ?? []) {
    if (e?.selector) continue
    for (const [k, raw] of Object.entries<any>(e?.properties ?? {})) {
      const lit = raw?.expr?.Literal?.Value
      out[k] = lit !== undefined ? decodeLiteral(lit) : raw
    }
  }
  return out
}

function asDate(v: unknown): Date | undefined {
  if (v instanceof Date) return startOfDay(v)
  if (typeof v === 'string') {
    const d = parseDateInput(v) ?? (/^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(v.slice(0, 10) + 'T00:00:00Z') : undefined)
    return d && !Number.isNaN(d.getTime()) ? startOfDay(d) : undefined
  }
  return undefined
}

/** Rule persisted in `objects.data` (undefined when the slicer has no stored date picker selection). */
export function readPickerRule(visualJson: any): PickerRule | undefined {
  const p = dataProps(visualJson)
  const start = asDate(p.startDate)
  const end = asDate(p.endDate)
  if (start && end) return { kind: 'manual', start: start <= end ? start : end, end: start <= end ? end : start }
  const range = String(p.relativeRange ?? '').toLowerCase()
  const period = PERIODS.find((x) => x.value.toLowerCase() === String(p.relativePeriod ?? '').toLowerCase())
  if (!period || !['last', 'next', 'this'].includes(range)) return undefined
  const anchorRaw = String(p.relativeAnchor ?? 'Today').toLowerCase()
  const anchor: PickerAnchor = anchorRaw === 'firstdate' || anchorRaw === 'first' ? 'first' : anchorRaw === 'lastdate' || anchorRaw === 'last' ? 'last' : 'today'
  const n = Number(p.relativeDuration ?? 1)
  const offset = Number(p.relativeOffset ?? 0)
  return {
    kind: 'relative',
    range: range as PickerRelative['range'],
    n: Number.isFinite(n) && n > 0 ? Math.round(n) : 1,
    unit: period.unit,
    calendar: period.calendar,
    anchor,
    offset: Number.isFinite(offset) ? Math.round(offset) : 0
  }
}

const RULE_KEYS = ['startDate', 'endDate', 'relativeRange', 'relativeDuration', 'relativePeriod', 'relativeAnchor', 'relativeOffset'] as const

/** Write (or clear, with undefined) the rule into `objects.data`. Mutates `visualJson`. */
export function writePickerRule(visualJson: any, rule: PickerRule | undefined): void {
  for (const k of RULE_KEYS) setObjectProp(visualJson, 'data', k, undefined)
  if (!rule) return
  if (rule.kind === 'manual') {
    // datetime literals (props.literalProp only encodes text/number/bool)
    setObjectProp(visualJson, 'data', 'startDate', 'x')
    const entry = (visualJson.visual ?? visualJson.visualGroup).objects.data.find((e: any) => !e.selector)
    entry.properties.startDate = { expr: { Literal: { Value: encodeLiteral(startOfDay(rule.start)) } } }
    entry.properties.endDate = { expr: { Literal: { Value: encodeLiteral(startOfDay(rule.end)) } } }
    return
  }
  setObjectProp(visualJson, 'data', 'relativeRange', rule.range === 'last' ? 'Last' : rule.range === 'next' ? 'Next' : 'This')
  // integer literals: PBI writes relativeDuration as a number ("3D"); our encoder writes "3L", both decode to 3
  setObjectProp(visualJson, 'data', 'relativeDuration', rule.n)
  setObjectProp(visualJson, 'data', 'relativePeriod', periodOf(rule.unit, rule.calendar))
  if (rule.anchor !== 'today') setObjectProp(visualJson, 'data', 'relativeAnchor', ANCHOR_VALUE[rule.anchor])
  if (rule.offset) setObjectProp(visualJson, 'data', 'relativeOffset', rule.offset)
}

/**
 * Rule implied by a filter alone (reports saved without the data.* rule properties, or a filter applied by
 * a bookmark / another tool): relative shapes → Today-anchored relative rule; ranges → manual.
 */
export function ruleFromFilter(filter: SQFilter | undefined, field: SQExpr): PickerRule | undefined {
  const rel = parseRelativeFilter(filter, field)
  if (rel && rel.unit !== 'minutes' && rel.unit !== 'hours')
    return { kind: 'relative', range: rel.anchor, n: rel.anchor === 'this' ? 1 : rel.n, unit: rel.unit, calendar: rel.calendar && rel.unit !== 'days', anchor: 'today', offset: 0 }
  const r = parseRangeFilter(filter, field)
  if (r && (r.min instanceof Date || r.max instanceof Date)) {
    const start = r.min instanceof Date ? startOfDay(r.min) : undefined
    const end = r.max instanceof Date ? startOfDay(r.max) : undefined
    if (start && end) return { kind: 'manual', start, end }
  }
  return undefined
}

// ---------------------------------------------------------------------------------------------
// Resolution and filters
// ---------------------------------------------------------------------------------------------

export interface PickerDomain {
  /** first / last date of the column (anchors) */
  first?: Date
  last?: Date
}

export interface PickerOptions {
  /** `dateRange.includeToday` (rolling Last/Next ranges) */
  includeToday?: boolean
  /** `dateRange.anchorDate`: replaces "today" for the Today anchor */
  anchorDate?: Date
}

/** The anchor date of a relative rule after the offset (undefined when the anchor's date is unknown). */
export function anchorDateOf(rule: PickerRelative, domain: PickerDomain, now: Date, opts: PickerOptions = {}): Date | undefined {
  const base = rule.anchor === 'first' ? domain.first : rule.anchor === 'last' ? domain.last : (opts.anchorDate ?? now)
  if (!base) return undefined
  return startOfDay(rule.offset ? addUnits(base, rule.offset, UNIT_CODE[rule.unit]) : base)
}

function toRelativeSelection(rule: PickerRelative, anchorDate: Date | undefined, opts: PickerOptions): RelativeSelection {
  return { anchor: rule.range, n: rule.n, unit: rule.unit, calendar: rule.calendar && rule.unit !== 'days', includeToday: opts.includeToday, anchorDate }
}

/** Inclusive date range selected by a rule. */
export function resolvePickerRange(rule: PickerRule, domain: PickerDomain, now: Date, opts: PickerOptions = {}): DateSpanRange | undefined {
  if (rule.kind === 'manual') return { start: startOfDay(rule.start), end: startOfDay(rule.end) }
  const anchor = anchorDateOf(rule, domain, now, opts)
  if (!anchor) return undefined
  return relativeRange(toRelativeSelection(rule, anchor, opts), anchor)
}

/** The SQ filter PBI semantics require for a rule (see the module comment for the shapes). */
export function pickerFilter(field: SQExpr, rule: PickerRule | undefined, domain: PickerDomain, now: Date, opts: PickerOptions = {}): SQFilter | undefined {
  if (!rule) return undefined
  if (rule.kind === 'manual') return rangeFilter(field, { min: startOfDay(rule.start), max: startOfDay(rule.end) })
  const rolling = rule.anchor === 'today' && !rule.offset
  const anchor = rolling ? opts.anchorDate : anchorDateOf(rule, domain, now, opts)
  if (!rolling && !anchor) return undefined
  return relativeFilter(field, toRelativeSelection(rule, anchor, opts))
}

/** Clip a range to the available dates; `clipped` drives PBI's "outside the available dates" indicator. */
export function clipRange(r: DateSpanRange, first: Date | undefined, last: Date | undefined): DateSpanRange & { clipped: boolean; empty: boolean } {
  let start = r.start
  let end = r.end
  let clipped = false
  if (first && start < startOfDay(first)) (start = startOfDay(first)), (clipped = true)
  if (last && end > startOfDay(last)) (end = startOfDay(last)), (clipped = true)
  return { start, end, clipped, empty: start > end }
}

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

const UNIT_WORD: Record<PickerUnit, [string, string]> = { days: ['day', 'days'], weeks: ['week', 'weeks'], months: ['month', 'months'], years: ['year', 'years'] }

function unitText(unit: PickerUnit, calendar: boolean, n: number): string {
  const w = UNIT_WORD[unit][Math.abs(n) === 1 ? 0 : 1]
  return calendar && unit !== 'days' ? `calendar ${w}` : w
}

/**
 * Restatement of a relative rule, worded like PBI's ("In the last 2 calendar years, offset by 1 calendar year
 * from last date"; "In the last 1 month from last date offset by -1 months" in the docs).
 */
export function relativeSummary(rule: PickerRelative): string {
  const cal = rule.calendar && rule.unit !== 'days'
  let s = rule.range === 'this' ? `In this ${UNIT_WORD[rule.unit][0]}` : `In the ${rule.range} ${rule.n} ${unitText(rule.unit, cal, rule.n)}`
  if (rule.offset) s += `, offset by ${rule.offset} ${unitText(rule.unit, cal, rule.offset)}`
  if (rule.anchor !== 'today') s += ` from ${rule.anchor === 'last' ? 'last' : 'first'} date`
  return s
}

// ---------------------------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------------------------

export interface CalendarDay {
  date: Date
  inMonth: boolean
}

/** 6 × 7 month grid starting on Sunday (PBI's calendar, en-US), naive UTC dates. */
export function monthGrid(year: number, month: number): CalendarDay[][] {
  const first = new Date(Date.UTC(year, month, 1))
  const start = new Date(first.getTime() - first.getUTCDay() * DAY_MS)
  const weeks: CalendarDay[][] = []
  for (let w = 0; w < 6; w++) {
    const row: CalendarDay[] = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + w * 7 + d))
      row.push({ date, inMonth: date.getUTCMonth() === month })
    }
    weeks.push(row)
  }
  return weeks
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Pending manual selection in the calendar: first click sets the start, the second the end (swapped when earlier). */
export interface CalendarPick {
  start?: Date
  end?: Date
}

export function calendarClick(pick: CalendarPick, day: Date, single: boolean): CalendarPick {
  const d = startOfDay(day)
  if (single) return { start: d, end: d }
  if (!pick.start || pick.end) return { start: d, end: undefined }
  return d < pick.start ? { start: d, end: pick.start } : { start: pick.start, end: d }
}

/**
 * Parse typed dates: M/D/YYYY, M/D/YY, YYYY-MM-DD, "Apr 14, 2026", "14 April 2026". Returns a naive UTC
 * date or undefined (invalid dates such as 2/30/2026 are rejected).
 */
export function parseDateInput(text: string): Date | undefined {
  const t = text.trim()
  if (!t) return undefined
  const mk = (y: number, m: number, d: number): Date | undefined => {
    if (y < 100) y += y < 50 ? 2000 : 1900
    const dt = new Date(Date.UTC(y, m - 1, d))
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : undefined
  }
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t)
  if (m) return mk(+m[3], +m[1], +m[2])
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(t)
  if (m) return mk(+m[1], +m[2], +m[3])
  const monthIdx = (s: string) => MONTHS.findIndex((x) => x.toLowerCase().startsWith(s.toLowerCase().slice(0, 3)))
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t)
  if (m && monthIdx(m[1]) >= 0) return mk(+m[3], monthIdx(m[1]) + 1, +m[2])
  m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(t)
  if (m && monthIdx(m[2]) >= 0) return mk(+m[3], monthIdx(m[2]) + 1, +m[1])
  return undefined
}

/** Short "M/D/YYYY" (fallback when the column has no format string). */
export function shortDate(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`
}
