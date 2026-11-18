/**
 * Calendar helpers. All dates follow the Lumen value contract: a JS Date whose *UTC* fields carry
 * the naive wall-clock value (`Date.UTC(y, m-1, d, hh, mm)`); never use local-time getters.
 */

const DAY_MS = 86_400_000

export function ymd(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, hh, mm, ss))
}

export function parseIso(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s.trim())
  if (!m) throw new Error(`Invalid ISO date: ${s}`)
  return ymd(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0)
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS)
}

export function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + Math.round(n * 60_000))
}

export function addHours(d: Date, n: number): Date {
  return new Date(d.getTime() + Math.round(n * 3_600_000))
}

export function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + n
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()))
}

export function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((dateOnly(b).getTime() - dateOnly(a).getTime()) / DAY_MS)
}

export function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000
}

export function startOfMonth(d: Date): Date {
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}

export function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
}

export function startOfWeek(d: Date): Date {
  return addDays(dateOnly(d), -(isoDow(d) - 1))
}

/** 0 = Sunday ... 6 = Saturday */
export function dow(d: Date): number {
  return d.getUTCDay()
}

/** ISO weekday 1 = Monday ... 7 = Sunday */
export function isoDow(d: Date): number {
  return ((d.getUTCDay() + 6) % 7) + 1
}

export function isWeekend(d: Date): boolean {
  const w = d.getUTCDay()
  return w === 0 || w === 6
}

export function isoWeek(d: Date): { year: number; week: number } {
  const t = dateOnly(d)
  const thursday = addDays(t, 4 - isoDow(t))
  const year = thursday.getUTCFullYear()
  const jan1 = ymd(year, 1, 1)
  const week = Math.floor(daysBetween(jan1, thursday) / 7) + 1
  return { year, week }
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function isoDateTime(d: Date): string {
  return d.toISOString().slice(0, 19)
}

export function dateKey(d: Date): number {
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
}

export function monthKey(d: Date): number {
  return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1
}

export function fromDateKey(k: number): Date {
  return ymd(Math.floor(k / 10000), Math.floor(k / 100) % 100, k % 100)
}

export function* eachDay(start: Date, end: Date): Generator<Date> {
  for (let d = dateOnly(start); d.getTime() <= end.getTime(); d = addDays(d, 1)) yield d
}

/** First day of each month overlapping [start, end]. */
export function* eachMonth(start: Date, end: Date): Generator<Date> {
  for (let d = startOfMonth(start); d.getTime() <= end.getTime(); d = addMonths(d, 1)) yield d
}

export function daysInMonth(d: Date): number {
  return endOfMonth(d).getUTCDate()
}

export function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b
}

export function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b
}

/** The far-future SCD2 "open" expiry date. */
export const OPEN_END = ymd(9999, 12, 31)

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

// ---------------------------------------------------------------------------------------------
// Holidays

export type HolidayRule =
  | { name: string; month: number; day: number }
  | { name: string; month: number; weekday: number; nth: number } // weekday ISO 1..7, nth 1..4 or -1 = last

export const GENERIC_HOLIDAYS: HolidayRule[] = [
  { name: "New Year's Day", month: 1, day: 1 },
  { name: 'Spring Bank Holiday', month: 5, weekday: 1, nth: -1 },
  { name: 'Midsummer Day', month: 7, day: 4 },
  { name: 'Labor Day', month: 9, weekday: 1, nth: 1 },
  { name: 'Thanksgiving', month: 11, weekday: 4, nth: 4 },
  { name: 'Christmas Eve', month: 12, day: 24 },
  { name: 'Christmas Day', month: 12, day: 25 },
  { name: "New Year's Eve", month: 12, day: 31 }
]

export function holidayDate(rule: HolidayRule, year: number): Date {
  if ('day' in rule) return ymd(year, rule.month, rule.day)
  if (rule.nth > 0) {
    const first = ymd(year, rule.month, 1)
    const offset = (rule.weekday - isoDow(first) + 7) % 7
    return addDays(first, offset + (rule.nth - 1) * 7)
  }
  const last = endOfMonth(ymd(year, rule.month, 1))
  const offset = (isoDow(last) - rule.weekday + 7) % 7
  return addDays(last, -offset)
}

export function holidayMap(rules: HolidayRule[], fromYear: number, toYear: number): Map<number, string> {
  const map = new Map<number, string>()
  for (let y = fromYear; y <= toYear; y++) {
    for (const r of rules) map.set(dateKey(holidayDate(r, y)), r.name)
  }
  return map
}

// ---------------------------------------------------------------------------------------------
// Fiscal calendar

/** Fiscal year number: a fiscal year starting in `startMonth` is named after the calendar year it ends in. */
export function fiscalYear(d: Date, startMonth: number): number {
  const m = d.getUTCMonth() + 1
  const y = d.getUTCFullYear()
  return startMonth === 1 ? y : m >= startMonth ? y + 1 : y
}

export function fiscalMonth(d: Date, startMonth: number): number {
  return ((d.getUTCMonth() + 1 - startMonth + 12) % 12) + 1
}

export function fiscalQuarter(d: Date, startMonth: number): number {
  return Math.ceil(fiscalMonth(d, startMonth) / 3)
}

// ---------------------------------------------------------------------------------------------
// Date dimension rows

export interface DateDimOptions {
  start: Date
  end: Date
  today: Date
  fiscalStartMonth: number
  holidays: HolidayRule[]
}

export type DateDimRow = Record<string, number | string | boolean | Date | null>

export function dateDimRows(o: DateDimOptions): DateDimRow[] {
  const holidays = holidayMap(o.holidays, o.start.getUTCFullYear(), o.end.getUTCFullYear())
  const today = dateOnly(o.today)
  const todayMonthIndex = today.getUTCFullYear() * 12 + today.getUTCMonth()
  const rows: DateDimRow[] = []
  for (const d of eachDay(o.start, o.end)) {
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth() + 1
    const q = Math.ceil(m / 3)
    const wk = isoWeek(d)
    const fy = fiscalYear(d, o.fiscalStartMonth)
    const fq = fiscalQuarter(d, o.fiscalStartMonth)
    const fm = fiscalMonth(d, o.fiscalStartMonth)
    const key = dateKey(d)
    const holiday = holidays.get(key) ?? null
    const wd = isoDow(d)
    rows.push({
      date_key: key,
      date: d,
      year: y,
      quarter: q,
      quarter_label: `Q${q}`,
      year_quarter: `${y} Q${q}`,
      year_quarter_key: y * 10 + q,
      month: m,
      month_name: MONTH_NAMES[m - 1],
      month_short: MONTH_NAMES[m - 1].slice(0, 3),
      year_month: `${y}-${String(m).padStart(2, '0')}`,
      year_month_key: y * 100 + m,
      month_start: ymd(y, m, 1),
      week_of_year: wk.week,
      iso_year: wk.year,
      week_start: startOfWeek(d),
      day_of_month: d.getUTCDate(),
      day_of_year: daysBetween(ymd(y, 1, 1), d) + 1,
      day_of_week: wd,
      day_name: DAY_NAMES[wd - 1],
      day_short: DAY_NAMES[wd - 1].slice(0, 3),
      is_weekend: wd >= 6,
      is_holiday: holiday !== null,
      holiday_name: holiday,
      is_working_day: wd < 6 && holiday === null,
      fiscal_year: fy,
      fiscal_year_label: `FY${String(fy).slice(2)}`,
      fiscal_quarter: fq,
      fiscal_quarter_label: `FY${String(fy).slice(2)} Q${fq}`,
      fiscal_month: fm,
      is_past: d.getTime() <= today.getTime(),
      day_offset: daysBetween(today, d),
      month_offset: y * 12 + (m - 1) - todayMonthIndex,
      year_offset: y - today.getUTCFullYear()
    })
  }
  return rows
}

/** Time-of-day dimension at `stepMinutes` grain (default 15 minutes → 96 rows). */
export function timeDimRows(stepMinutes = 15): DateDimRow[] {
  const rows: DateDimRow[] = []
  for (let t = 0; t < 1440; t += stepMinutes) {
    const h = Math.floor(t / 60)
    const mi = t % 60
    const h12 = h % 12 === 0 ? 12 : h % 12
    rows.push({
      time_key: h * 100 + mi,
      time_label: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`,
      hour: h,
      minute: mi,
      hour_label: `${h12} ${h < 12 ? 'AM' : 'PM'}`,
      day_part: dayPart(h),
      is_peak: (h >= 7 && h < 10) || (h >= 12 && h < 14) || (h >= 17 && h < 19)
    })
  }
  return rows
}

export function dayPart(h: number): string {
  if (h < 5) return 'Night'
  if (h < 11) return 'Morning'
  if (h < 14) return 'Midday'
  if (h < 17) return 'Afternoon'
  if (h < 21) return 'Evening'
  return 'Night'
}

/** time_key (hhmm) of the dim_time row containing `d` at `stepMinutes` grain. */
export function timeKey(d: Date, stepMinutes = 15): number {
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes()
  const t = mins - (mins % stepMinutes)
  return Math.floor(t / 60) * 100 + (t % 60)
}

/** Day-of-year seasonality helper: smooth annual cycle peaking at `peakDayOfYear`, amplitude in ±fraction. */
export function annualCycle(d: Date, peakDayOfYear: number, amplitude: number): number {
  const doy = daysBetween(ymd(d.getUTCFullYear(), 1, 1), d)
  return 1 + amplitude * Math.cos(((doy - peakDayOfYear) / 365.25) * 2 * Math.PI)
}
