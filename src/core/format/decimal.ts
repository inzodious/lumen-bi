/**
 * Exact decimal helpers used by the formatter so that rounding happens on decimal digits rather than on
 * binary doubles (2.675 -> "2.68", 1.005 -> "1.01", like Excel / Power BI and unlike Number#toFixed).
 *
 * A Dec represents the non-negative value 0.d × 10^e, where `d` has no leading or trailing zeros.
 * Zero is `{ d: '', e: 0 }`.
 */

import type { DataType } from '../model/types'

export interface Dec {
  d: string
  e: number
}

export const ZERO: Dec = { d: '', e: 0 }

/** Parse a non-negative JS number string (may contain an exponent) into a Dec. */
export function parseDec(s: string): Dec {
  let mant = s
  let exp = 0
  const ei = s.search(/e/i)
  if (ei >= 0) {
    mant = s.slice(0, ei)
    exp = parseInt(s.slice(ei + 1), 10) || 0
  }
  const dot = mant.indexOf('.')
  const digits = dot >= 0 ? mant.slice(0, dot) + mant.slice(dot + 1) : mant
  const intCount = dot >= 0 ? dot : mant.length
  let lead = 0
  while (lead < digits.length && digits.charCodeAt(lead) === 48) lead++
  if (lead === digits.length) return ZERO
  let end = digits.length
  while (end > lead && digits.charCodeAt(end - 1) === 48) end--
  return { d: digits.slice(lead, end), e: intCount + exp - lead }
}

/**
 * Decimal digits of a finite non-negative double.
 * Integers keep their shortest round-trip digits (exact below 2^53). Non-integers use the shortest round-trip
 * representation when it has <= 15 significant digits (so 2.675 stays 2.675), otherwise 15 significant digits
 * (Excel's precision; turns 0.1+0.2 = 0.30000000000000004 into 0.3).
 */
export function toDec(abs: number): Dec {
  if (abs === 0) return ZERO
  const x = parseDec(String(abs))
  if (Number.isInteger(abs) || x.d.length <= 15) return x
  return parseDec(abs.toPrecision(15))
}

/** Multiply by 10^k (exact). */
export function shiftDec(x: Dec, k: number): Dec {
  return x.d === '' || k === 0 ? x : { d: x.d, e: x.e + k }
}

/** Round to `n` decimal places, half away from zero (value is non-negative so: half up). */
export function roundDec(x: Dec, n: number): Dec {
  if (x.d === '') return x
  const keep = x.e + n
  if (keep >= x.d.length) return x
  if (keep < 0) return ZERO
  const next = x.d.charCodeAt(keep) - 48
  let digits = x.d.slice(0, keep)
  let e = x.e
  if (next >= 5) {
    const arr = digits.split('')
    let i = arr.length - 1
    while (i >= 0) {
      if (arr[i] === '9') {
        arr[i] = '0'
        i--
      } else {
        arr[i] = String.fromCharCode(arr[i].charCodeAt(0) + 1)
        break
      }
    }
    if (i < 0) {
      arr.unshift('1')
      e += 1
    }
    digits = arr.join('')
  }
  let end = digits.length
  while (end > 0 && digits.charCodeAt(end - 1) === 48) end--
  digits = digits.slice(0, end)
  return digits === '' ? ZERO : { d: digits, e }
}

/** Integer-part digits without leading zeros ('' when the integer part is zero). */
export function intDigits(x: Dec): string {
  if (x.d === '' || x.e <= 0) return ''
  return x.d.length >= x.e ? x.d.slice(0, x.e) : x.d + '0'.repeat(x.e - x.d.length)
}

/** First `n` fractional digits (zero padded). */
export function fracDigits(x: Dec, n: number): string {
  if (n <= 0) return ''
  if (x.d === '') return '0'.repeat(n)
  const s = x.e >= 0 ? x.d.slice(x.e) : '0'.repeat(-x.e) + x.d
  return s.length >= n ? s.slice(0, n) : s + '0'.repeat(n - s.length)
}

/** All fractional digits, without trailing zeros. */
export function allFracDigits(x: Dec): string {
  if (x.d === '') return ''
  return x.e >= 0 ? x.d.slice(x.e) : '0'.repeat(-x.e) + x.d
}

/** Insert en-US thousands separators into a digit string. */
export function groupDigits(s: string): string {
  if (s.length <= 3) return s
  let out = ''
  const first = s.length % 3 || 3
  out = s.slice(0, first)
  for (let i = first; i < s.length; i += 3) out += ',' + s.slice(i, i + 3)
  return out
}

/** Fixed-point rendering with `n` decimals; `zero` tells whether the rounded value is zero. */
export function fixedDec(abs: number, n: number, group: boolean, shift = 0): { s: string; zero: boolean } {
  const x = roundDec(shiftDec(toDec(abs), shift), n)
  let i = intDigits(x) || '0'
  if (group) i = groupDigits(i)
  const f = fracDigits(x, n)
  return { s: f ? i + '.' + f : i, zero: x.d === '' }
}

function plainDec(x: Dec): string {
  const i = intDigits(x) || '0'
  const f = allFracDigits(x)
  return f ? i + '.' + f : i
}

function sciMantissa(x: Dec): string {
  return x.d[0] + (x.d.length > 1 ? '.' + x.d.slice(1) : '')
}

function expSuffix(exp: number, letter: string, minDigits: number): string {
  return letter + (exp < 0 ? '-' : '+') + String(Math.abs(exp)).padStart(minDigits, '0')
}

/**
 * Power BI / DAX "General" rendering of a number:
 *  - integers below 1e15 (or any integer when dataType is int64) print all digits ("1234");
 *  - otherwise 15 significant digits (trailing zeros trimmed) in fixed notation when the decimal exponent is in
 *    [-4, 14], else scientific "1.5E+20" / "1E-05" (.NET G15 rules: fixed iff -5 < exponent < 15).
 */
export function generalNumber(n: number, dataType?: DataType): string {
  if (Number.isNaN(n)) return 'NaN'
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : '-Infinity'
  if (n === 0) return '0'
  const abs = Math.abs(n)
  let body: string
  if (Number.isInteger(abs) && abs < 1e21 && (abs < 1e15 || dataType === 'int64')) {
    body = String(abs)
  } else {
    const x = parseDec(abs.toPrecision(15))
    const exp = x.e - 1
    body = exp >= 15 || exp < -4 ? sciMantissa(x) + expSuffix(exp, 'E', 2) : plainDec(x)
  }
  return n < 0 ? '-' + body : body
}

/** .NET "G<p>" / "g<p>" (p >= 1). */
export function generalPrecision(n: number, p: number, lower: boolean): string {
  const abs = Math.abs(n)
  if (abs === 0) return '0'
  const x0 = toDec(abs)
  const x = roundDec(x0, p - x0.e)
  if (x.d === '') return '0'
  const exp = x.e - 1
  const body = exp > -5 && exp < p ? plainDec(x) : sciMantissa(x) + expSuffix(exp, lower ? 'e' : 'E', 2)
  return n < 0 ? '-' + body : body
}

/** .NET "E<p>" / "e<p>": one integer digit, p decimals, at least 3 exponent digits. */
export function scientificFixed(n: number, p: number, lower: boolean): string {
  const abs = Math.abs(n)
  let exp = 0
  let m: Dec = ZERO
  if (abs !== 0) {
    let x = toDec(abs)
    for (let pass = 0; pass < 2; pass++) {
      exp = x.e - 1
      m = roundDec({ d: x.d, e: 1 }, p)
      if (m.e <= 1) break
      x = { d: m.d, e: m.e + exp }
    }
  }
  const f = fracDigits(m, p)
  const body = (intDigits(m) || '0') + (f ? '.' + f : '') + expSuffix(exp, lower ? 'e' : 'E', 3)
  return n < 0 && m.d !== '' ? '-' + body : body
}
