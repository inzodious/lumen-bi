/**
 * Date/time side of the formatter: OLE serial conversion, VB/DAX custom date format parsing and rendering.
 * Dates follow the value contract in model/data.ts: UTC fields carry the naive wall-clock (never local getters).
 */

import type { Ch } from './lexer'

const DAY_MS = 86400000
const EPOCH_MS = Date.UTC(1899, 11, 30)

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * OLE Automation serial (days since 1899-12-30; the fraction is the time of day) -> UTC-naive Date.
 * For negative serials the integer part is the day and the absolute fraction is the time (OLE rule:
 * -1.25 = 1899-12-29 06:00). Rounded to the millisecond to absorb float error (45322.5 + 1/86400 etc.).
 * Unlike Excel there is no fictitious 1900-02-29 (DAX uses OLE serials: DATE(1900,1,1) = 2).
 */
export function serialToDate(serial: number): Date {
  if (!Number.isFinite(serial)) return new Date(NaN)
  const days = Math.trunc(serial)
  const ms = Math.round(Math.abs(serial - days) * DAY_MS)
  return new Date(EPOCH_MS + days * DAY_MS + ms)
}

/** UTC-naive Date -> OLE serial (inverse of serialToDate). Invalid dates give NaN. */
export function dateToSerial(d: Date): number {
  const t = d.getTime()
  if (Number.isNaN(t)) return NaN
  const ms = t - EPOCH_MS
  const day = Math.floor(ms / DAY_MS)
  const frac = (ms - day * DAY_MS) / DAY_MS
  return day >= 0 || frac === 0 ? day + frac : day - frac
}

const pad2 = (n: number): string => (n < 10 ? '0' + n : String(n))
const pad4 = (n: number): string => String(n).padStart(4, '0')

function hour12(h: number): number {
  return h % 12 === 0 ? 12 : h % 12
}

export function shortDate(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${pad4(d.getUTCFullYear())}`
}

export function longDate(d: Date): string {
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${pad4(d.getUTCFullYear())}`
}

export function longTime(d: Date): string {
  const h = d.getUTCHours()
  return `${hour12(h)}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} ${h < 12 ? 'AM' : 'PM'}`
}

/**
 * VB/DAX "General Date" (also the `c` code): date only when there is no time part, time only when the date part
 * is the serial-zero day (1899-12-30, e.g. DAX TIME()), otherwise "m/d/yyyy h:nn:ss AM/PM".
 */
export function generalDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return ''
  const hasTime = d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0 || d.getUTCMilliseconds() !== 0
  if (!hasTime) return shortDate(d)
  if (d.getUTCFullYear() === 1899 && d.getUTCMonth() === 11 && d.getUTCDate() === 30) return longTime(d)
  return shortDate(d) + ' ' + longTime(d)
}

export type DTok =
  | { k: 'lit'; v: string }
  | { k: 'day' | 'wday' | 'month' | 'min' | 'year' | 'sec' | 'frac'; n: number }
  | { k: 'mq'; n: number } // m / mm: month or minute, resolved after parsing
  | { k: 'hour'; n: number; h24: boolean }
  | { k: 'sdate' | 'ldate' | 'gdate' | 'ltime' | 'doy' | 'q' | 'w' | 'ww' }
  | { k: 'ampm'; am: string; pm: string }

/**
 * Parse one date section (VB/DAX FORMAT codes, plus a few .NET-isms used in PBI models):
 *  d dd ddd dddd ddddd(short date) dddddd(long date) · m mm (month, or minutes right after an hour code or right
 *  before a seconds code, ignoring literals) mmm mmmm mmmmm(first letter) · M MM MMM MMMM (always month) ·
 *  y (day of year) yy yyy/yyyy (4-digit year) · q · w (weekday 1-7, Sunday = 1) ww (week of year, Jan 1 week = 1) ·
 *  h hh (12-hour when an AM/PM designator is present, else 24-hour) H HH (always 24-hour) · n nn · s ss ·
 *  fractional seconds `ss.0`…`ss.000`/`ss.fff` · AM/PM am/pm A/P a/p AMPM tt · c (General Date) · ttttt (long time).
 * Any other character is a literal (case-insensitive except M/m and H/h as described).
 */
export function parseDateSection(chs: Ch[]): DTok[] {
  const toks: DTok[] = []
  const n = chs.length
  const lit = (v: string): void => {
    const last = toks[toks.length - 1]
    if (last && last.k === 'lit') last.v += v
    else toks.push({ k: 'lit', v })
  }
  const code = (j: number): string => (j < n && !chs[j].lit ? chs[j].c : '')
  const text = (j: number, len: number): string => {
    let s = ''
    for (let k = j; k < j + len && k < n && !chs[k].lit; k++) s += chs[k].c
    return s
  }
  const run = (j: number, pred: (c: string) => boolean): number => {
    let k = j
    while (k < n && !chs[k].lit && pred(chs[k].c)) k++
    return k - j
  }
  let i = 0
  while (i < n) {
    const ch = chs[i]
    if (ch.lit) {
      lit(ch.c)
      i++
      continue
    }
    const c = ch.c
    const lc = c.toLowerCase()
    let r: number
    switch (lc) {
      case 'a': {
        const s5 = text(i, 5)
        if (s5.toLowerCase() === 'am/pm') {
          toks.push({ k: 'ampm', am: s5.slice(0, 2), pm: s5.slice(3, 5) })
          i += 5
        } else if (text(i, 4).toLowerCase() === 'ampm') {
          toks.push({ k: 'ampm', am: 'AM', pm: 'PM' })
          i += 4
        } else if (text(i, 3).toLowerCase() === 'a/p') {
          const s3 = text(i, 3)
          toks.push({ k: 'ampm', am: s3[0], pm: s3[2] })
          i += 3
        } else {
          lit(c)
          i++
        }
        continue
      }
      case 'd':
        r = run(i, (x) => x === 'd' || x === 'D')
        if (r <= 2) toks.push({ k: 'day', n: r })
        else if (r <= 4) toks.push({ k: 'wday', n: r })
        else toks.push({ k: r === 5 ? 'sdate' : 'ldate' })
        i += r
        continue
      case 'y':
        r = run(i, (x) => x === 'y' || x === 'Y')
        if (r === 1) toks.push({ k: 'doy' })
        else toks.push({ k: 'year', n: r === 2 ? 2 : 4 })
        i += r
        continue
      case 'm': {
        // a mixed-case run ("Mmm", "mMM") is one token, as in VB/PBI ("Mmm yy" → "Aug 26"); any uppercase M makes it a month
        r = run(i, (x) => x === 'm' || x === 'M')
        let hasUpper = false
        for (let k = i; k < i + r; k++) if (chs[k].c === 'M') hasUpper = true
        if (hasUpper) toks.push({ k: 'month', n: Math.min(r, 5) })
        else if (r <= 2) toks.push({ k: 'mq', n: r })
        else toks.push({ k: 'month', n: Math.min(r, 5) })
        i += r
        continue
      }
      case 'h':
        r = run(i, (x) => x === c)
        toks.push({ k: 'hour', n: Math.min(r, 2), h24: c === 'H' })
        i += r
        continue
      case 'n':
        r = run(i, (x) => x === 'n' || x === 'N')
        toks.push({ k: 'min', n: Math.min(r, 2) })
        i += r
        continue
      case 's': {
        r = run(i, (x) => x === 's' || x === 'S')
        toks.push({ k: 'sec', n: Math.min(r, 2) })
        i += r
        // fractional seconds: ss.000 / ss.fff
        if (code(i) === '.') {
          const z = run(i + 1, (x) => x === '0')
          const f = z ? 0 : run(i + 1, (x) => x === 'f' || x === 'F')
          if (z || f) {
            lit('.')
            toks.push({ k: 'frac', n: Math.min(z || f, 7) })
            i += 1 + (z || f)
          }
        }
        continue
      }
      case 'q':
        toks.push({ k: 'q' })
        i++
        continue
      case 'w':
        r = run(i, (x) => x === 'w' || x === 'W')
        toks.push({ k: r === 1 ? 'w' : 'ww' })
        i += r
        continue
      case 'c':
        toks.push({ k: 'gdate' })
        i++
        continue
      case 't':
        r = run(i, (x) => x === 't' || x === 'T')
        if (r >= 5) {
          toks.push({ k: 'ltime' })
          i += 5
        } else if (r >= 2) {
          toks.push({ k: 'ampm', am: 'AM', pm: 'PM' })
          i += 2
        } else {
          lit(c)
          i++
        }
        continue
      default:
        lit(c)
        i++
    }
  }
  const hasAmPm = toks.some((t) => t.k === 'ampm')
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]
    if (t.k === 'hour' && !t.h24 && !hasAmPm) t.h24 = true
    if (t.k === 'mq') {
      let p = k - 1
      while (p >= 0 && toks[p].k === 'lit') p--
      let q = k + 1
      while (q < toks.length && toks[q].k === 'lit') q++
      const isMinute = (p >= 0 && toks[p].k === 'hour') || (q < toks.length && toks[q].k === 'sec')
      toks[k] = isMinute ? { k: 'min', n: t.n } : { k: 'month', n: t.n }
    }
  }
  return toks
}

export function renderDate(toks: DTok[], d: Date): string {
  const y = d.getUTCFullYear()
  const mo = d.getUTCMonth()
  const day = d.getUTCDate()
  const h = d.getUTCHours()
  let out = ''
  for (const t of toks) {
    switch (t.k) {
      case 'lit':
        out += t.v
        break
      case 'day':
        out += t.n === 1 ? String(day) : pad2(day)
        break
      case 'wday':
        out += t.n === 3 ? DAYS[d.getUTCDay()].slice(0, 3) : DAYS[d.getUTCDay()]
        break
      case 'month':
        if (t.n === 1) out += String(mo + 1)
        else if (t.n === 2) out += pad2(mo + 1)
        else if (t.n === 3) out += MONTHS[mo].slice(0, 3)
        else if (t.n === 4) out += MONTHS[mo]
        else out += MONTHS[mo][0]
        break
      case 'year':
        out += t.n === 2 ? pad2(((y % 100) + 100) % 100) : pad4(y)
        break
      case 'doy':
        out += String(dayOfYear(y, mo, day))
        break
      case 'q':
        out += String(Math.floor(mo / 3) + 1)
        break
      case 'w':
        out += String(d.getUTCDay() + 1)
        break
      case 'ww': {
        const jan1 = new Date(utc(y, 0, 1)).getUTCDay()
        out += String(Math.floor((dayOfYear(y, mo, day) - 1 + jan1) / 7) + 1)
        break
      }
      case 'hour': {
        const v = t.h24 ? h : hour12(h)
        out += t.n === 1 ? String(v) : pad2(v)
        break
      }
      case 'min':
        out += t.n === 1 ? String(d.getUTCMinutes()) : pad2(d.getUTCMinutes())
        break
      case 'sec':
        out += t.n === 1 ? String(d.getUTCSeconds()) : pad2(d.getUTCSeconds())
        break
      case 'frac': {
        // Truncated (like .NET fff); values carry millisecond precision only.
        const ms = String(d.getUTCMilliseconds()).padStart(3, '0')
        out += t.n <= 3 ? ms.slice(0, t.n) : ms + '0'.repeat(t.n - 3)
        break
      }
      case 'ampm':
        out += h < 12 ? t.am : t.pm
        break
      case 'sdate':
        out += shortDate(d)
        break
      case 'ldate':
        out += longDate(d)
        break
      case 'ltime':
        out += longTime(d)
        break
      case 'gdate':
        out += generalDate(d)
        break
      case 'mq':
        break
    }
  }
  return out
}

/** Date.UTC without the 0..99 -> 1900+ year mapping. */
function utc(y: number, mo: number, day: number): number {
  const d = new Date(Date.UTC(2000, mo, day))
  d.setUTCFullYear(y)
  return d.getTime()
}

function dayOfYear(y: number, mo: number, day: number): number {
  return Math.round((utc(y, mo, day) - utc(y, 0, 1)) / DAY_MS) + 1
}
