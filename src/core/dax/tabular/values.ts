/**
 * Scalar values of the tabular DAX engine.
 *
 * Representation follows the app-wide data contract (src/core/model/data.ts) so values cross the
 * engine boundary without conversion:
 *   BLANK -> null, text -> string, numbers -> number, booleans -> boolean,
 *   date/time -> JS Date whose UTC fields hold the naive wall-clock value (never use local getters).
 */
import type { DataType } from '../../model/types.ts'
import { DaxError } from './errors.ts'

export type Scalar = null | number | string | boolean | Date

export const MS_PER_DAY = 86_400_000
/** Days between the OLE/DAX serial epoch (1899-12-30) and 1970-01-01. */
export const SERIAL_OFFSET = 25_569

export function isDateValue(v: unknown): v is Date {
  return v instanceof Date
}

export function serialOf(d: Date): number {
  return d.getTime() / MS_PER_DAY + SERIAL_OFFSET
}

export function fromSerial(serial: number): Date {
  return new Date(Math.round((serial - SERIAL_OFFSET) * MS_PER_DAY))
}

/** DATE(y, m, d) with month/day overflow like DAX. */
export function makeDate(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0, ms = 0): Date {
  const r = new Date(0)
  r.setUTCFullYear(y, m - 1, d)
  r.setUTCHours(hh, mm, ss, ms)
  return r
}

export function dateOnly(d: Date): Date {
  return new Date(Math.floor(d.getTime() / MS_PER_DAY) * MS_PER_DAY)
}

export function dayNumber(d: Date): number {
  return Math.floor(d.getTime() / MS_PER_DAY)
}

export function fromDayNumber(n: number): Date {
  return new Date(n * MS_PER_DAY)
}

export function typeName(v: Scalar): string {
  if (v === null) return 'Blank'
  if (v instanceof Date) return 'Date'
  if (typeof v === 'number') return Number.isInteger(v) ? 'Integer' : 'Number'
  if (typeof v === 'string') return 'Text'
  return 'True/False'
}

/** Dictionary / identity key: text is case-insensitive (like VertiPaq). */
export type VKey = number | string | boolean | null
export function vkey(v: Scalar): VKey {
  if (v === null) return null
  if (typeof v === 'string') return v.toLowerCase()
  if (v instanceof Date) return '\u0001' + v.getTime()
  return v
}

export function tupleKey(values: Scalar[]): string {
  let s = ''
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    s += (i ? '\u0002' : '') + (v === null ? '\u0003' : typeof v === 'string' ? 's' + v.toLowerCase() : v instanceof Date ? 'd' + v.getTime() : typeof v === 'number' ? 'n' + v : v ? 'T' : 'F')
  }
  return s
}

export function toNumber(v: Scalar, context = 'arithmetic'): number {
  if (v === null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Date) return serialOf(v)
  const t = v.trim()
  if (t === '') throw new DaxError('TYPE', `Cannot convert value '' of type Text to type Number (in ${context}).`)
  const n = Number(t.replace(/,/g, ''))
  if (!Number.isNaN(n)) return n
  const d = parseDateText(t)
  if (d) return serialOf(d)
  if (/^\(?\$?-?[\d,.]+\)?%?$/.test(t)) {
    const neg = t.startsWith('(') || t.includes('-')
    const pct = t.endsWith('%')
    const x = Number(t.replace(/[()$,%-]/g, ''))
    if (!Number.isNaN(x)) return (neg ? -x : x) / (pct ? 100 : 1)
  }
  throw new DaxError('TYPE', `Cannot convert value '${v}' of type Text to type Number.`)
}

export function toBool(v: Scalar): boolean {
  if (v === null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (v instanceof Date) return v.getTime() !== -SERIAL_OFFSET * MS_PER_DAY
  const u = v.trim().toUpperCase()
  if (u === 'TRUE') return true
  if (u === 'FALSE') return false
  throw new DaxError('TYPE', `Cannot convert value '${v}' of type Text to type True/False.`)
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Parse date/time text the way DAX DATEVALUE / implicit conversion does (en-US). */
export function parseDateText(s: string): Date | null {
  const t = s.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?Z?$/.exec(t)
  if (m) return withTime(Date.UTC(+m[1], +m[2] - 1, +m[3]), m[4], m[5], m[6], m[7])
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/.exec(t)
  if (m) {
    let y = +m[3]
    if (y < 100) y += y < 30 ? 2000 : 1900
    let h = m[4] ? +m[4] : 0
    if (m[7]) h = (h % 12) + (/p/i.test(m[7]) ? 12 : 0)
    return withTime(Date.UTC(y, +m[1] - 1, +m[2]), String(h), m[5], m[6])
  }
  m = /^(\d{1,2})[- ]([A-Za-z]{3,})[- ,]+(\d{2,4})$/.exec(t)
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase())
    if (mi >= 0) {
      let y = +m[3]
      if (y < 100) y += y < 30 ? 2000 : 1900
      return new Date(Date.UTC(y, mi, +m[1]))
    }
  }
  m = /^([A-Za-z]{3,})\.? (\d{1,2}),? (\d{4})$/.exec(t)
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase())
    if (mi >= 0) return new Date(Date.UTC(+m[3], mi, +m[2]))
  }
  m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(t)
  if (m) {
    let h = +m[1]
    if (m[4]) h = (h % 12) + (/p/i.test(m[4]) ? 12 : 0)
    return withTime(-SERIAL_OFFSET * MS_PER_DAY, String(h), m[2], m[3])
  }
  return null
}

function withTime(base: number, h?: string, mi?: string, s?: string, frac?: string): Date | null {
  if (Number.isNaN(base)) return null
  const ms = (h ? +h : 0) * 3_600_000 + (mi ? +mi : 0) * 60_000 + (s ? +s : 0) * 1000 + (frac ? Math.round(Number('0.' + frac) * 1000) : 0)
  return new Date(base + ms)
}

export function toDate(v: Scalar): Date | null {
  if (v === null) return null
  if (v instanceof Date) return v
  if (typeof v === 'number') return fromSerial(v)
  if (typeof v === 'boolean') return fromSerial(v ? 1 : 0)
  const d = parseDateText(v)
  if (!d) throw new DaxError('TYPE', `Cannot convert value '${v}' of type Text to type Date.`)
  return d
}

export function generalNumber(n: number): string {
  if (Number.isNaN(n)) return 'NaN'
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : '-Infinity'
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n)
  const p = Number(n.toPrecision(15))
  const s = String(p)
  if (/e/.test(s)) {
    const [mant, exp] = s.split('e')
    const e = Number(exp)
    return `${mant}E${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`
  }
  return s
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0')
}

/** Implicit date -> text conversion (en-US general date). */
export function dateText(d: Date): string {
  const base = `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`
  const ms = d.getTime() - dayNumber(d) * MS_PER_DAY
  if (ms === 0) return base
  const h = d.getUTCHours()
  return `${base} ${h % 12 === 0 ? 12 : h % 12}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${h < 12 ? 'AM' : 'PM'}`
}

export function toText(v: Scalar): string {
  if (v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return generalNumber(v)
  return dateText(v)
}

type Kind = 0 | 1 | 2 | 3 // blank, number/date, text, bool
function kindOf(v: Scalar): Kind {
  if (v === null) return 0
  if (typeof v === 'string') return 2
  if (typeof v === 'boolean') return 3
  return 1
}

/** DAX comparison: BLANK converts to the other operand's default (0, "", FALSE). Text is case-insensitive. */
export function compare(a: Scalar, b: Scalar): number {
  const ka = kindOf(a)
  const kb = kindOf(b)
  if (ka === 0 && kb === 0) return 0
  const k = ka === 0 ? kb : ka
  if (ka !== 0 && kb !== 0 && ka !== kb) {
    // DAX converts number <-> text in comparisons? No: it raises an error. Number vs boolean too.
    throw new DaxError(
      'TYPE',
      `DAX comparison operations do not support comparing values of type ${typeName(a)} with values of type ${typeName(b)}. Consider using the VALUE or FORMAT function to convert one of the values.`
    )
  }
  if (k === 2) {
    const x = ((a as string | null) ?? '').toLowerCase()
    const y = ((b as string | null) ?? '').toLowerCase()
    return x < y ? -1 : x > y ? 1 : 0
  }
  if (k === 3) return (a ? 1 : 0) - (b ? 1 : 0)
  const x = a === null ? 0 : typeof a === 'number' ? a : (a as Date).getTime() / MS_PER_DAY + SERIAL_OFFSET
  const y = b === null ? 0 : typeof b === 'number' ? b : (b as Date).getTime() / MS_PER_DAY + SERIAL_OFFSET
  return x < y ? -1 : x > y ? 1 : 0
}

/** Strict equality used by ==, IN, CONTAINS...: BLANK only equals BLANK in == ; text case-insensitive. */
export function sameValue(a: Scalar, b: Scalar): boolean {
  if (a === null || b === null) return a === b
  if (a instanceof Date || b instanceof Date) {
    const x = a instanceof Date ? a.getTime() : typeof a === 'number' ? fromSerial(a).getTime() : NaN
    const y = b instanceof Date ? b.getTime() : typeof b === 'number' ? fromSerial(b).getTime() : NaN
    return x === y
  }
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase()
  return a === b
}

/** Total order for sorting result grids: blanks first, then numbers/dates, text, booleans. */
export function sortCompare(a: Scalar, b: Scalar): number {
  const ra = a === null ? 0 : typeof a === 'number' || a instanceof Date ? 1 : typeof a === 'string' ? 2 : 3
  const rb = b === null ? 0 : typeof b === 'number' || b instanceof Date ? 1 : typeof b === 'string' ? 2 : 3
  if (ra !== rb) return ra - rb
  if (ra === 0) return 0
  if (ra === 2) {
    const x = (a as string).toLowerCase()
    const y = (b as string).toLowerCase()
    return x < y ? -1 : x > y ? 1 : 0
  }
  return compare(a, b)
}

export function arithmetic(op: string, a: Scalar, b: Scalar): Scalar {
  if (op === '*' || op === '/') {
    if (op === '*' && (a === null || b === null)) return a === null && b === null ? null : null
  }
  if (a === null && b === null) return null
  if (op === '^') {
    if (a === null) return null
    return Math.pow(toNumber(a), toNumber(b))
  }
  if (op === '/' && a === null) return null
  const x = toNumber(a)
  const y = toNumber(b)
  switch (op) {
    case '+': {
      const r = x + y
      if (a instanceof Date || b instanceof Date) return fromSerial(r)
      return r
    }
    case '-': {
      if (a instanceof Date && b instanceof Date) return fromSerial(x - y)
      const r = x - y
      if (a instanceof Date) return fromSerial(r)
      return r
    }
    case '*':
      return x * y
    case '/':
      if (y === 0) {
        if (x === 0) return Number.NaN
        return x > 0 ? Infinity : -Infinity
      }
      return x / y
  }
  throw new DaxError('INTERNAL', `Unknown operator ${op}`)
}

export function valueDataType(v: Scalar): DataType {
  if (v === null) return 'unknown'
  if (typeof v === 'string') return 'string'
  if (typeof v === 'boolean') return 'boolean'
  if (v instanceof Date) return 'dateTime'
  return Number.isInteger(v) ? 'int64' : 'double'
}

export function inferDataType(values: Iterable<Scalar>): DataType {
  let seen: DataType | null = null
  for (const v of values) {
    if (v === null) continue
    const t = valueDataType(v)
    if (seen === null) seen = t
    else if (seen !== t) {
      if ((seen === 'int64' && t === 'double') || (seen === 'double' && t === 'int64')) seen = 'double'
      else return 'variant'
    }
  }
  return seen ?? 'unknown'
}

/** Convert a value to a column's declared type (calculated columns, DATATABLE, data load). */
export function coerceTo(v: Scalar, t: DataType): Scalar {
  if (v === null) return null
  switch (t) {
    case 'int64':
    case 'double':
    case 'decimal':
      if (typeof v === 'number') return t === 'int64' ? Math.round(v) : v
      if (typeof v === 'boolean') return v ? 1 : 0
      if (v instanceof Date) return serialOf(v)
      return toNumber(v)
    case 'string':
      return typeof v === 'string' ? v : toText(v)
    case 'boolean':
      return toBool(v)
    case 'dateTime':
      return toDate(v)
    default:
      return v
  }
}

/** Clean binary floating-point noise the way VertiPaq results look (15 significant digits). */
export function clean15(x: number): number {
  if (!Number.isFinite(x) || Number.isInteger(x)) return x
  return Number(x.toPrecision(15))
}

/** Kahan-compensated summation accumulator. */
export class KahanSum {
  sum = 0
  private c = 0
  add(x: number): void {
    const y = x - this.c
    const t = this.sum + y
    this.c = t - this.sum - y
    this.sum = t
  }
}

export function cleanScalar<T>(v: T): T {
  return (typeof v === 'number' ? clean15(v) : v) as T
}
