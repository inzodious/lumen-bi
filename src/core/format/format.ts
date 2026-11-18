/**
 * Power BI / DAX FORMAT() value formatter (culture en-US).
 *
 * Supported: named formats ("Currency", "Short Date", ...), .NET standard numeric specifiers (C2, N0, P1, ...),
 * VB-style custom numeric formats (up to 4 sections, 0 # ? placeholders, grouping and scaling commas, % ‰,
 * E+/E- scientific, literals/escapes/quoted text, digits distributed across interior literals), custom date/time
 * formats (see dates.ts) and minimal text formats (@ & < > !).
 *
 * Semantic choices (documented where Excel, VB and DAX disagree):
 *  - Section selection uses the raw value (Excel/VB). With a single section the minus sign is prepended, but it
 *    is dropped when the rounded result is zero (-0.001 with "0.0" -> "0.0", not Excel's "-0.0"). An explicit
 *    negative section is still used for such values (-0.001 with "0.0;(0.0)" -> "(0.0)").
 *  - An empty section ("0;;0") falls back to the first section (VB/DAX docs), with the automatic minus sign.
 *  - A decimal point with no fraction digits shown is dropped ("0.##" with 5 -> "5", like .NET; VB prints "5.").
 *  - Booleans used as numbers are 1/0 (DAX conversion), not VB's -1/0.
 *  - Strings are returned unchanged unless the format is a text format (@ & < >).
 *  - BLANK (null) -> "" regardless of a 4th (null) section, per the formatValue contract.
 *  - Currency negatives use parentheses for both "Currency" and "C<n>" (Power BI en-US display).
 *  - "P<n>" renders "12.35%" (ICU en-US, no space).
 */

import type { Scalar } from '../model/data'
import type { DataType } from '../model/types'
import {
  fixedDec,
  fracDigits,
  generalNumber,
  generalPrecision,
  groupDigits,
  intDigits,
  roundDec,
  scientificFixed,
  shiftDec,
  toDec,
  ZERO,
  type Dec
} from './decimal'
import { dateToSerial, generalDate, parseDateSection, renderDate, serialToDate, type DTok } from './dates'
import { conditionMet, lex, sectionMeta, splitSections, type Ch, type SectionMeta } from './lexer'

export { serialToDate, dateToSerial } from './dates'

export interface FormatOptions {
  dataType?: DataType
  /** Only en-US semantics are implemented; other cultures are accepted and ignored. */
  culture?: string
}

// ---------------------------------------------------------------------------------------------------------------
// Parsed format cache

type Kind = 'general' | 'gennum' | 'gendate' | 'bool' | 'std' | 'num' | 'date' | 'text'

interface StdSpec {
  letter: string // as written (case matters for E/G/X)
  prec: number | null
}

type NItem = { k: 'ph'; c: string } | { k: 'lit'; v: string }

interface NumSection {
  empty: boolean
  intItems: NItem[]
  intPh: string[]
  intHash: boolean
  interiorLit: boolean
  hasDot: boolean
  fracItems: NItem[]
  fracPh: string[]
  group: boolean
  shift: number
  hasPh: boolean
  exp: null | { upper: boolean; plus: boolean; minDigits: number; items: NItem[] }
}

interface TextSection {
  items: NItem[]
  nPh: number
  upper: boolean
  lower: boolean
  ltr: boolean
}

interface Parsed {
  kind: Kind
  raw: string
  /** Section sources (for the custom kinds); parsed lazily per use. */
  sections: Ch[][]
  /** Excel color / condition blocks per section ([Red], [>=1000]) */
  meta: SectionMeta[]
  std: StdSpec | null
  boolText: [string, string] | null
  num: NumSection[] | null
  date: DTok[] | null
  text: TextSection | null
}

const NAMED: Record<string, string> = {
  currency: '$#,##0.00;($#,##0.00)',
  fixed: '0.00',
  standard: '#,##0.00',
  percent: '0.00%',
  scientific: '0.00E+00',
  'long date': 'dddd, mmmm d, yyyy',
  'medium date': 'dd-mmm-yy',
  'short date': 'm/d/yyyy',
  'long time': 'h:nn:ss AM/PM',
  'medium time': 'hh:nn AM/PM',
  'short time': 'hh:nn'
}

const BOOL_NAMED: Record<string, [string, string]> = {
  'yes/no': ['Yes', 'No'],
  'true/false': ['True', 'False'],
  'on/off': ['On', 'Off']
}

const STD_RE = /^([CcDdEeFfGgNnPpXxRr])(\d{1,2})?$/

const CACHE_LIMIT = 2000
const cache = new Map<string, Parsed>()

function getParsed(fmt: string): Parsed {
  let p = cache.get(fmt)
  if (!p) {
    if (cache.size >= CACHE_LIMIT) cache.clear()
    p = parseFormat(fmt)
    cache.set(fmt, p)
  }
  return p
}

function blank(kind: Kind, raw: string): Parsed {
  return { kind, raw, sections: [], meta: [], std: null, boolText: null, num: null, date: null, text: null }
}

function parseFormat(fmt: string): Parsed {
  const key = fmt.trim().toLowerCase()
  if (key === '' || key === 'general') return blank('general', fmt)
  if (key === 'general number') return blank('gennum', fmt)
  if (key === 'general date') return blank('gendate', fmt)
  const b = BOOL_NAMED[key]
  if (b) {
    const p = blank('bool', fmt)
    p.boolText = b
    return p
  }
  const named = NAMED[key]
  if (named !== undefined) {
    const p = parseFormat(named)
    p.raw = fmt
    return p
  }
  const rawSections = splitSections(fmt).slice(0, 4)
  const sections = rawSections.map(lex)
  const meta = rawSections.map(sectionMeta)
  const m = STD_RE.exec(fmt.trim())
  if (m) {
    const p = blank('std', fmt)
    p.sections = sections
    p.std = { letter: m[1], prec: m[2] === undefined ? null : parseInt(m[2], 10) }
    return p
  }
  const p = blank(classify(sections), fmt)
  p.sections = sections
  p.meta = meta
  return p
}

/** True when chs[i] is a '0' that is part of a fractional-seconds code ("ss.000"). */
function isFracSecondZero(chs: Ch[], i: number): boolean {
  let j = i
  while (j >= 0 && !chs[j].lit && chs[j].c === '0') j--
  if (j < 0 || chs[j].lit || chs[j].c !== '.') return false
  j--
  return j >= 0 && !chs[j].lit && (chs[j].c === 's' || chs[j].c === 'S')
}

/**
 * Decide how a custom format is interpreted. Digit placeholders (0 # ?) win: every letter of a numeric format is a
 * literal ("#,##0,,.0M", "0 days"). Otherwise text placeholders (@ &) or case codes (< >) make it a text format,
 * and date codes (d m y h n s q w c, AM/PM, A/P, tt) make it a date format. Anything else (literal-only sections
 * such as "\"N/A\"") is numeric.
 */
function classify(sections: Ch[][]): Kind {
  let digit = false
  let text = false
  let date = false
  for (const chs of sections) {
    for (let i = 0; i < chs.length; i++) {
      const ch = chs[i]
      if (ch.lit) continue
      const c = ch.c
      if (c === '0' || c === '#' || c === '?') {
        if (c === '0' && isFracSecondZero(chs, i)) continue
        digit = true
      } else if (c === '@' || c === '&' || c === '<' || c === '>') {
        text = true
      } else if ('dDmMyYhHnNsSqQwWcC'.includes(c)) {
        date = true
      } else if ((c === 't' || c === 'T') && i + 1 < chs.length && !chs[i + 1].lit && chs[i + 1].c.toLowerCase() === 't') {
        date = true
      } else if (
        (c === 'a' || c === 'A') &&
        i + 2 < chs.length &&
        !chs[i + 1].lit &&
        chs[i + 1].c === '/' &&
        !chs[i + 2].lit &&
        chs[i + 2].c.toLowerCase() === 'p'
      ) {
        date = true
      }
    }
  }
  if (digit) return 'num'
  if (text) return 'text'
  if (date) return 'date'
  return 'num'
}

// ---------------------------------------------------------------------------------------------------------------
// Numeric custom sections

function parseNumSection(chs: Ch[]): NumSection {
  type Raw = { k: 'ph'; c: string } | { k: 'lit'; v: string } | { k: 'comma' }
  const intRaw: Raw[] = []
  const fracRaw: Raw[] = []
  const expItems: NItem[] = []
  let state: 'int' | 'frac' | 'exp' = 'int'
  let hasDot = false
  let shift = 0
  let exp: NumSection['exp'] = null
  const cur = (): Raw[] | NItem[] => (state === 'int' ? intRaw : state === 'frac' ? fracRaw : expItems)
  const pushLit = (v: string): void => {
    const list = cur()
    const last = list[list.length - 1]
    if (last && last.k === 'lit') last.v += v
    else list.push({ k: 'lit', v })
  }
  const n = chs.length
  for (let i = 0; i < n; i++) {
    const ch = chs[i]
    if (ch.lit) {
      pushLit(ch.c)
      continue
    }
    const c = ch.c
    if (
      state !== 'exp' &&
      (c === 'E' || c === 'e') &&
      i + 2 < n &&
      !chs[i + 1].lit &&
      (chs[i + 1].c === '+' || chs[i + 1].c === '-') &&
      !chs[i + 2].lit &&
      (chs[i + 2].c === '0' || chs[i + 2].c === '#')
    ) {
      state = 'exp'
      exp = { upper: c === 'E', plus: chs[i + 1].c === '+', minDigits: 0, items: expItems }
      i++
      continue
    }
    switch (c) {
      case '0':
      case '#':
      case '?':
        if (state === 'exp') {
          if (c === '0' && exp) exp.minDigits++
          expItems.push({ k: 'ph', c })
        } else cur().push({ k: 'ph', c } as Raw & NItem)
        break
      case '.':
        if (state === 'int') {
          hasDot = true
          state = 'frac'
        } else pushLit('.')
        break
      case ',':
        if (state === 'exp') pushLit(',')
        else (cur() as Raw[]).push({ k: 'comma' })
        break
      case '%':
        shift += 2
        pushLit('%')
        break
      case '‰':
        shift += 3
        pushLit('‰')
        break
      case '_':
        // Excel "space the width of the next char": rendered as one space.
        if (i + 1 < n) i++
        pushLit(' ')
        break
      case '*':
        // Excel fill character: no meaning for plain text output.
        if (i + 1 < n) i++
        break
      default:
        pushLit(c)
    }
  }

  // Commas: between integer placeholders -> grouping; after the last placeholder of the integer or fraction part
  // -> scaling (÷1000 each); elsewhere in the integer part -> literal; elsewhere in the fraction part -> ignored.
  let group = false
  const lastPhIndex = (list: Raw[]): number => {
    for (let k = list.length - 1; k >= 0; k--) if (list[k].k === 'ph') return k
    return -1
  }
  const intItems: NItem[] = []
  const firstInt = intRaw.findIndex((r) => r.k === 'ph')
  const lastInt = lastPhIndex(intRaw)
  for (let k = 0; k < intRaw.length; k++) {
    const r = intRaw[k]
    if (r.k !== 'comma') {
      appendItem(intItems, r)
      continue
    }
    if (firstInt >= 0 && k > firstInt && k < lastInt) group = true
    else if (firstInt >= 0 && k > lastInt) shift -= 3
    else appendItem(intItems, { k: 'lit', v: ',' })
  }
  const fracItems: NItem[] = []
  const lastFrac = lastPhIndex(fracRaw)
  for (let k = 0; k < fracRaw.length; k++) {
    const r = fracRaw[k]
    if (r.k !== 'comma') appendItem(fracItems, r)
    else if (k > lastFrac) shift -= 3
  }
  const intPh = intItems.filter((x): x is { k: 'ph'; c: string } => x.k === 'ph').map((x) => x.c)
  const fracPh = fracItems.filter((x): x is { k: 'ph'; c: string } => x.k === 'ph').map((x) => x.c)
  let interiorLit = false
  {
    let seenPh = 0
    for (const it of intItems) {
      if (it.k === 'ph') seenPh++
      else if (seenPh > 0 && seenPh < intPh.length) interiorLit = true
    }
  }
  return {
    empty: chs.length === 0,
    intItems,
    intPh,
    intHash: intPh.includes('#'),
    interiorLit,
    hasDot,
    fracItems,
    fracPh,
    group,
    shift,
    hasPh: intPh.length + fracPh.length > 0,
    exp
  }
}

function appendItem(list: NItem[], r: NItem): void {
  const last = list[list.length - 1]
  if (r.k === 'lit' && last && last.k === 'lit') last.v += r.v
  else list.push(r.k === 'lit' ? { k: 'lit', v: r.v } : r)
}

function phFill(c: string): string {
  return c === '0' ? '0' : c === '?' ? ' ' : ''
}

function renderInt(sec: NumSection, digits: string): string {
  const ph = sec.intPh
  const np = ph.length
  if (np === 0) {
    // No integer placeholders (".00"): Excel still shows a non-zero integer part before the point.
    let s = ''
    for (const it of sec.intItems) if (it.k === 'lit') s += it.v
    return s + digits
  }
  const outs: string[] = new Array(np)
  let j = digits.length
  for (let k = np - 1; k >= 0; k--) {
    if (k === 0) {
      outs[0] = j > 0 ? digits.slice(0, j) : phFill(ph[0])
      j = 0
    } else if (j > 0) {
      outs[k] = digits[j - 1]
      j--
    } else outs[k] = phFill(ph[k])
  }
  if (sec.group && !sec.interiorLit) {
    let prefix = ''
    let suffix = ''
    let seen = 0
    for (const it of sec.intItems) {
      if (it.k === 'ph') seen++
      else if (seen === 0) prefix += it.v
      else suffix += it.v
    }
    const joined = outs.join('')
    let lead = 0
    while (lead < joined.length && joined[lead] === ' ') lead++
    return prefix + joined.slice(0, lead) + groupDigits(joined.slice(lead)) + suffix
  }
  let s = ''
  let k = 0
  for (const it of sec.intItems) s += it.k === 'ph' ? outs[k++] : it.v
  return s
}

function renderFrac(items: NItem[], ph: string[], digits: string): { s: string; any: boolean } {
  const outs: string[] = new Array(ph.length)
  let trimming = true
  for (let k = ph.length - 1; k >= 0; k--) {
    const dch = digits[k]
    if (trimming && ph[k] !== '0' && dch === '0') outs[k] = ph[k] === '?' ? ' ' : ''
    else {
      trimming = false
      outs[k] = dch
    }
  }
  let s = ''
  let any = false
  let k = 0
  for (const it of items) {
    if (it.k === 'ph') {
      const o = outs[k++]
      if (o) any = true
      s += o
    } else s += it.v
  }
  return { s, any }
}

/** Render |value| with one numeric section. `zero` reports whether the displayed number rounded to zero. */
function renderNumSection(sec: NumSection, abs: number): { s: string; zero: boolean } {
  const x = shiftDec(toDec(abs), sec.shift)
  if (sec.exp) return renderScientific(sec, x)
  const r = roundDec(x, sec.fracPh.length)
  if (!sec.hasPh) {
    let s = ''
    for (const it of sec.intItems) if (it.k === 'lit') s += it.v
    for (const it of sec.fracItems) if (it.k === 'lit') s += it.v
    return { s, zero: r.d === '' }
  }
  const intS = renderInt(sec, intDigits(r))
  const frac = renderFrac(sec.fracItems, sec.fracPh, fracDigits(r, sec.fracPh.length))
  return { s: intS + (sec.hasDot && frac.any ? '.' : '') + frac.s, zero: r.d === '' }
}

function renderScientific(sec: NumSection, x0: Dec): { s: string; zero: boolean } {
  const exp = sec.exp!
  const nInt = sec.intPh.length
  const engineering = sec.intHash && nInt > 1
  const maxIntDigits = Math.max(nInt, 1)
  const nFrac = sec.fracPh.length
  let E = 0
  let m: Dec = ZERO
  if (x0.d !== '') {
    let x = x0
    for (let pass = 0; pass < 3; pass++) {
      const e10 = x.e - 1
      E = engineering ? Math.floor(e10 / nInt) * nInt : e10 - (maxIntDigits - 1)
      m = roundDec({ d: x.d, e: x.e - E }, nFrac)
      if (m.d === '' || m.e <= maxIntDigits) break
      x = { d: m.d, e: m.e + E } // rounding carried into a new digit (9.99 -> 10.0): renormalize
    }
  }
  const intS = renderInt({ ...sec, group: false }, intDigits(m))
  const frac = renderFrac(sec.fracItems, sec.fracPh, fracDigits(m, nFrac))
  let expDigits = String(Math.abs(E))
  if (expDigits.length < exp.minDigits) expDigits = expDigits.padStart(exp.minDigits, '0')
  let expS = (exp.upper ? 'E' : 'e') + (E < 0 ? '-' : exp.plus ? '+' : '')
  let placed = false
  for (const it of exp.items) {
    if (it.k === 'ph') {
      if (!placed) expS += expDigits
      placed = true
    } else expS += it.v
  }
  return { s: intS + (sec.hasDot && frac.any ? '.' : '') + frac.s + expS, zero: m.d === '' }
}

/**
 * Section used for a number: { index, signed } where `signed` means the automatic minus sign applies.
 * Without conditions: positive/zero -> 0, negative -> 1, zero -> 2 (VB/Excel). With Excel conditions
 * (`[>=1000]#,##0,"K";[>=1]0;0`): the conditional sections (first two) are tested in order, then the first section
 * without a condition is the "else" section. A conditional section that can only match negatives ([<0], [<=-1])
 * shows the absolute value, like a negative section; any other section gets the minus sign for negative values.
 */
function pickSection(p: Parsed, v: number, count: number, emptyAt: (i: number) => boolean): { i: number; signed: boolean } {
  const meta = p.meta
  const conditional = meta.slice(0, 2).some((m) => m?.cond)
  if (!conditional) {
    if (v < 0 && count >= 2 && !emptyAt(1)) return { i: 1, signed: false }
    if (v === 0 && count >= 3 && !emptyAt(2)) return { i: 2, signed: false }
    return { i: 0, signed: true }
  }
  const negOnly = (i: number) => {
    const c = meta[i]?.cond
    return !!c && ((c.op === '<' && c.value <= 0) || (c.op === '<=' && c.value < 0))
  }
  for (let i = 0; i < Math.min(2, count); i++) {
    const c = meta[i]?.cond
    if (c && conditionMet(c, v)) return { i, signed: !negOnly(i) }
  }
  for (let i = 0; i < count; i++) if (!meta[i]?.cond) return { i, signed: true }
  return { i: count - 1, signed: true }
}

function formatCustomNumber(p: Parsed, v: number): string {
  if (!Number.isFinite(v)) return generalNumber(v)
  if (!p.num) p.num = p.sections.map(parseNumSection)
  const secs = p.num
  const abs = Math.abs(v)
  const { i, signed } = pickSection(p, v, secs.length, (k) => secs[k].empty)
  const sec = secs[i].empty ? secs[0] : secs[i]
  const r = renderNumSection(sec, abs)
  return signed && v < 0 && !r.zero ? '-' + r.s : r.s
}

/**
 * Display color selected by an Excel color code in the format string ([Red], [Blue], [Color10]) for this value,
 * as a CSS hex color, or null. Power BI shows such formats' text without color in most visuals; tables/cards may use
 * this to color the value.
 */
export function formatColor(value: Scalar, format?: string | null): string | null {
  if (value === null || value === undefined || !format || value instanceof Uint8Array) return null
  try {
    const p = getParsed(format)
    if (!p.meta.length || !p.meta.some((m) => m.color)) return null
    if (p.kind !== 'num' || typeof value === 'string') return p.meta[0]?.color ?? null
    const v = toNumber(value as number | boolean | Date)
    const { i } = pickSection(p, v, p.sections.length, (k) => p.sections[k].length === 0)
    return p.meta[i]?.color ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------------------------------
// .NET standard numeric format specifiers

function formatStd(spec: StdSpec, v: number): string {
  if (!Number.isFinite(v)) return generalNumber(v)
  const L = spec.letter
  const u = L.toUpperCase()
  const abs = Math.abs(v)
  const neg = v < 0
  switch (u) {
    case 'C': {
      const r = fixedDec(abs, spec.prec ?? 2, true)
      return neg && !r.zero ? '($' + r.s + ')' : '$' + r.s
    }
    case 'N':
    case 'F': {
      const r = fixedDec(abs, spec.prec ?? 2, u === 'N')
      return neg && !r.zero ? '-' + r.s : r.s
    }
    case 'P': {
      const r = fixedDec(abs, spec.prec ?? 2, true, 2)
      return (neg && !r.zero ? '-' : '') + r.s + '%'
    }
    case 'D': {
      // .NET only accepts integers for D; non-integers are rounded half away from zero (best effort).
      const r = fixedDec(abs, 0, false)
      const s = r.s.padStart(spec.prec ?? 0, '0')
      return neg && !r.zero ? '-' + s : s
    }
    case 'E':
      return scientificFixed(v, spec.prec ?? 6, L === 'e')
    case 'G':
      return spec.prec ? generalPrecision(v, spec.prec, L === 'g') : generalNumber(v)
    case 'R':
      return String(v).replace('e', 'E')
    case 'X': {
      const iv = Number(fixedDec(abs, 0, false).s) * (neg ? -1 : 1)
      let s: string
      if (iv >= 0) s = Number.isSafeInteger(iv) ? iv.toString(16) : BigInt(iv).toString(16)
      else if (iv >= -2147483648) s = (iv >>> 0).toString(16) // two's complement Int32, like .NET
      else s = BigInt.asUintN(64, BigInt(iv)).toString(16)
      s = s.padStart(spec.prec ?? 0, '0')
      return L === 'X' ? s.toUpperCase() : s
    }
  }
  return generalNumber(v)
}

// ---------------------------------------------------------------------------------------------------------------
// Text formats (@ & < > !)

function parseTextSection(chs: Ch[]): TextSection {
  const items: NItem[] = []
  let nPh = 0
  let upper = false
  let lower = false
  let ltr = false
  for (const ch of chs) {
    if (!ch.lit && (ch.c === '@' || ch.c === '&')) {
      items.push({ k: 'ph', c: ch.c })
      nPh++
    } else if (!ch.lit && ch.c === '<') lower = true
    else if (!ch.lit && ch.c === '>') upper = true
    else if (!ch.lit && ch.c === '!') ltr = true
    else appendItem(items, { k: 'lit', v: ch.c })
  }
  return { items, nPh, upper, lower, ltr }
}

function formatText(p: Parsed, s: string): string {
  if (!p.text) p.text = parseTextSection(p.sections[0] ?? [])
  const t = p.text
  const str = t.upper ? s.toUpperCase() : t.lower ? s.toLowerCase() : s
  if (t.nPh === 0) return str
  const ph: string[] = []
  for (const it of t.items) if (it.k === 'ph') ph.push(it.c)
  const outs: string[] = new Array(ph.length)
  const fill = (c: string): string => (c === '@' ? ' ' : '')
  if (t.ltr) {
    let j = 0
    for (let k = 0; k < ph.length; k++) {
      if (k === ph.length - 1) outs[k] = j < str.length ? str.slice(j) : fill(ph[k])
      else outs[k] = j < str.length ? str[j++] : fill(ph[k])
    }
  } else {
    let j = str.length
    for (let k = ph.length - 1; k >= 0; k--) {
      if (k === 0) outs[0] = j > 0 ? str.slice(0, j) : fill(ph[0])
      else outs[k] = j > 0 ? str[--j] : fill(ph[k])
    }
  }
  let out = ''
  let k = 0
  for (const it of t.items) out += it.k === 'ph' ? outs[k++] : it.v
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Public API

function toNumber(v: number | boolean | Date): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  return dateToSerial(v)
}

function toDate(v: number | boolean | Date): Date {
  return v instanceof Date ? v : serialToDate(typeof v === 'boolean' ? (v ? 1 : 0) : v)
}

function formatAsDate(p: Parsed, v: number | boolean | Date): string {
  const d = toDate(v)
  if (Number.isNaN(d.getTime())) return typeof v === 'number' ? generalNumber(v) : ''
  if (!p.date) p.date = parseDateSection(p.sections[0] ?? [])
  return renderDate(p.date, d)
}

/** DAX FORMAT() / Power BI display formatting. null (BLANK) -> "". Never throws. */
export function formatValue(value: Scalar, format?: string | null, opts?: FormatOptions): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Uint8Array) return ''
  if (format == null || format === '') return formatGeneral(value, opts?.dataType)
  try {
    const p = getParsed(format)
    if (typeof value === 'string') return p.kind === 'text' ? formatText(p, value) : value
    switch (p.kind) {
      case 'general':
        return formatGeneral(value, opts?.dataType)
      case 'gennum':
        return generalNumber(toNumber(value))
      case 'gendate': {
        const d = toDate(value)
        return Number.isNaN(d.getTime()) ? (typeof value === 'number' ? generalNumber(value) : '') : generalDate(d)
      }
      case 'bool': {
        const n = toNumber(value)
        return n !== 0 && !Number.isNaN(n) ? p.boolText![0] : p.boolText![1]
      }
      case 'std': {
        const spec = p.std!
        if (value instanceof Date) {
          const lc = spec.letter.toLowerCase()
          // A bare "d"/"n"/"c" on a date is the VB date code (day / minute / General Date); "G" is General Date.
          if (spec.prec === null && (lc === 'd' || lc === 'n' || lc === 'c')) return formatAsDate(p, value)
          if (spec.prec === null && lc === 'g') return generalDate(value)
        }
        return formatStd(spec, toNumber(value))
      }
      case 'date':
        return formatAsDate(p, value)
      case 'text':
        return formatText(p, formatGeneral(value, opts?.dataType))
      case 'num':
        return formatCustomNumber(p, toNumber(value))
    }
  } catch {
    // Defensive: formatting must never break rendering.
  }
  return formatGeneral(value, opts?.dataType)
}

/**
 * Default display without a format string. Numbers: DAX "General" (see generalNumber; a number with dataType
 * 'dateTime' is treated as an OLE serial). Booleans: "True"/"False". Dates: General Date ("1/31/2024" when the time
 * part is zero, else "1/31/2024 1:05:09 PM"). Strings: unchanged. Binary: "".
 */
export function formatGeneral(value: Scalar, dataType?: DataType): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') {
    if (dataType === 'dateTime' && Number.isFinite(value)) return generalDate(serialToDate(value))
    return generalNumber(value, dataType)
  }
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (value instanceof Date) return generalDate(value)
  return ''
}
