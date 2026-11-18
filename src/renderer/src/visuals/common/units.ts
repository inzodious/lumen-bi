/**
 * Power BI display units and number formatting for axes, data labels and tooltips.
 *
 * `labelDisplayUnits` values in PBIR: 0 = Auto, 1 = None, 1000 = Thousands, 1e6 = Millions,
 * 1e9 = Billions, 1e12 = Trillions. PBI suffixes: K, M, bn, T.
 * Auto picks the unit from a reference magnitude (axis: the largest tick; labels: the largest
 * absolute value shown), so all labels of one visual share a unit, as in Power BI.
 */
import type { Scalar } from '@core/model/data'
import type { ValueFormatter } from '@core/engine/api'

export const UNIT_SUFFIX: Record<number, string> = { 1: '', 1e3: 'K', 1e6: 'M', 1e9: 'bn', 1e12: 'T' }

export const DISPLAY_UNIT_OPTIONS = [
  { value: 0, label: 'Auto' },
  { value: 1, label: 'None' },
  { value: 1000, label: 'Thousands' },
  { value: 1000000, label: 'Millions' },
  { value: 1000000000, label: 'Billions' },
  { value: 1000000000000, label: 'Trillions' }
]

/** Auto unit for a reference magnitude (PBI: the largest unit whose scaled value is ≥ 1). */
export function autoDisplayUnit(maxAbs: number): number {
  const a = Math.abs(maxAbs)
  if (!Number.isFinite(a)) return 1
  if (a >= 1e12) return 1e12
  if (a >= 1e9) return 1e9
  if (a >= 1e6) return 1e6
  if (a >= 1e3) return 1e3
  return 1
}

/** Normalize a PBIR labelDisplayUnits value; 0/undefined → auto using `reference`. */
export function resolveDisplayUnit(setting: number | undefined | null, reference: number): number {
  const s = Number(setting ?? 0)
  if (!s) return autoDisplayUnit(reference)
  if (s in UNIT_SUFFIX) return s
  // nearest known unit for odd values (e.g. 10000 from old reports)
  if (s >= 1e12) return 1e12
  if (s >= 1e9) return 1e9
  if (s >= 1e6) return 1e6
  if (s >= 1e3) return 1e3
  return 1
}

export interface ParsedFormat {
  prefix: string
  suffix: string
  /** decimals in the format string's first section */
  decimals: number
  percent: boolean
  grouping: boolean
  /** recognised as a plain numeric pattern we can rescale safely */
  numeric: boolean
  /**
   * Negative section ("$#,0;($#,0)"): literal text around the digits, used instead of a leading minus — PBI's
   * axes and labels honour it with display units too: "($0.2M)".
   */
  negative?: { prefix: string; suffix: string }
}

const fmtCache = new Map<string, ParsedFormat>()

/** Parse the first section of a .NET/DAX numeric format string ("$#,0.00;($#,0.00)" → prefix $, 2 decimals). */
export function parseNumberFormat(fmt: string | undefined): ParsedFormat {
  const key = fmt ?? ''
  const hit = fmtCache.get(key)
  if (hit) return hit
  const out: ParsedFormat = { prefix: '', suffix: '', decimals: 0, percent: false, grouping: false, numeric: false }
  if (fmt) {
    const named = fmt.trim().toLowerCase()
    if (named === 'percent') Object.assign(out, { percent: true, decimals: 2, numeric: true, grouping: true })
    else if (named === 'currency') Object.assign(out, { prefix: '$', decimals: 2, numeric: true, grouping: true })
    else if (named === 'standard' || named === 'fixed') Object.assign(out, { decimals: 2, numeric: true, grouping: named === 'standard' })
    else if (named === 'general number') Object.assign(out, { numeric: true, decimals: -1 })
    else {
      // sections, honouring quotes and backslash escapes
      const sections: string[] = ['']
      let inQ = false
      for (let i = 0; i < fmt.length; i++) {
        const ch = fmt[i]
        if (ch === '"') inQ = !inQ
        if (!inQ && ch === ';') {
          sections.push('')
          continue
        }
        if (!inQ && ch === '\\') {
          sections[sections.length - 1] += ch + (fmt[i + 1] ?? '')
          i++
          continue
        }
        sections[sections.length - 1] += ch
      }
      const section = sections[0]
      const literal = (s: string) => s.replace(/\\(.)/g, '$1').replace(/"([^"]*)"/g, '$1')
      const firstDigit = section.search(/[#0]/)
      if (firstDigit >= 0 && !/[ymdhsq]/i.test(section.replace(/"[^"]*"|\\./g, ''))) {
        let lastDigit = -1
        for (let i = section.length - 1; i >= 0; i--)
          if ('#0.,'.includes(section[i])) {
            lastDigit = i
            break
          }
        const body = section.slice(firstDigit, lastDigit + 1)
        out.prefix = literal(section.slice(0, firstDigit))
        out.suffix = literal(section.slice(lastDigit + 1))
        out.grouping = body.includes(',') && !/,$/.test(body.replace(/\..*/, ''))
        const dot = body.indexOf('.')
        out.decimals = dot >= 0 ? body.slice(dot + 1).replace(/[^0#]/g, '').length : 0
        out.percent = out.suffix.includes('%') || out.prefix.includes('%')
        out.numeric = true
        const neg = sections[1]
        const nd = neg ? neg.search(/[#0]/) : -1
        if (neg && nd >= 0) {
          let ld = -1
          for (let i = neg.length - 1; i >= 0; i--)
            if ('#0.,'.includes(neg[i])) {
              ld = i
              break
            }
          out.negative = { prefix: literal(neg.slice(0, nd)), suffix: literal(neg.slice(ld + 1)) }
        }
      }
    }
  }
  fmtCache.set(key, out)
  return out
}

const nfCache = new Map<string, Intl.NumberFormat>()
export function formatFixed(value: number, decimals: number, grouping = true, trim = false): string {
  const key = `${decimals}|${grouping}|${trim}`
  let nf = nfCache.get(key)
  if (!nf) {
    nf = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: trim ? 0 : Math.max(0, decimals),
      maximumFractionDigits: Math.max(0, decimals),
      useGrouping: grouping
    })
    nfCache.set(key, nf)
  }
  const s = nf.format(value)
  return s === '-0' ? '0' : s
}

/** Decimal places PBI uses for an auto-precision scaled label (≈ 3 significant digits). */
export function autoDecimals(scaledAbs: number): number {
  const a = Math.abs(scaledAbs)
  if (a === 0) return 0
  if (a >= 100) return 0
  if (a >= 10) return 1
  return 2
}

/** Decimals needed to distinguish ticks spaced by `step` (in display units). */
export function decimalsForStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0
  let d = 0
  while (d < 10 && Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-9 * 10 ** d) d++
  return d
}

export interface NumberLabelOptions {
  /** resolved unit (1, 1e3, ...) — use resolveDisplayUnit first */
  unit: number
  /** explicit decimals (labelPrecision); undefined = auto */
  decimals?: number
  formatString?: string
  /** used when no units/decimals apply: the engine's FORMAT */
  format?: ValueFormatter
  /** trim trailing zeros in auto precision */
  trimAuto?: boolean
}

/**
 * Format a number for a label/axis with PBI display units.
 * Percent formats are never scaled (PBI shows 45.2% regardless of display units).
 */
export function formatWithUnits(value: number | null | undefined, opts: NumberLabelOptions): string {
  if (value === null || value === undefined || Number.isNaN(value)) return ''
  const pf = parseNumberFormat(opts.formatString)
  if (pf.percent) {
    const d = opts.decimals ?? pf.decimals
    return pf.prefix.replace('%', '') + formatFixed(value * 100, d, pf.grouping) + pf.suffix
  }
  const unit = opts.unit > 1 ? opts.unit : 1
  if (unit > 1) {
    const scaled = value / unit
    const auto = opts.decimals === undefined
    const d = auto ? autoDecimals(scaled) : opts.decimals!
    const num = formatFixed(scaled, d, true, auto && opts.trimAuto !== false)
    return withSign(num, pf, UNIT_SUFFIX[unit])
  }
  if (opts.decimals !== undefined) return withSign(formatFixed(value, opts.decimals, pf.numeric ? pf.grouping : true), pf)
  if (opts.formatString && opts.format) {
    try {
      return opts.format(value, opts.formatString)
    } catch {
      /* fall through */
    }
  }
  if (pf.numeric && pf.decimals >= 0 && opts.formatString) return withSign(formatFixed(value, pf.decimals, pf.grouping), pf)
  return formatFixed(value, Number.isInteger(value) ? 0 : 2, true, true)
}

/** Number text (already scaled) + display-unit suffix → final text with the format's prefix/suffix or negative section. */
function withSign(num: string, pf: ParsedFormat, unitSuffix = ''): string {
  if (num.startsWith('-')) {
    if (pf.negative) return pf.negative.prefix + num.slice(1) + unitSuffix + pf.negative.suffix
    return '-' + pf.prefix + num.slice(1) + unitSuffix + pf.suffix
  }
  return pf.prefix + num + unitSuffix + pf.suffix
}

/** Format any scalar for a tooltip/table cell using the field's format string. */
export function formatScalar(value: Scalar, formatString: string | undefined, format: ValueFormatter | undefined, dataType?: string): string {
  if (value === null || value === undefined) return '(Blank)'
  if (value instanceof Date) return formatDate(value, formatString, format)
  if (typeof value === 'number') {
    if (formatString && format) {
      try {
        return format(value, formatString, dataType as any)
      } catch {
        /* fall back */
      }
    }
    return formatWithUnits(value, { unit: 1, formatString })
  }
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (value instanceof Uint8Array) return '(Binary)'
  return String(value)
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Dates: model format string via the engine, otherwise PBI's default short date (M/d/yyyy [h:mm:ss AM]). */
export function formatDate(d: Date, formatString: string | undefined, format: ValueFormatter | undefined): string {
  if (formatString && format) {
    try {
      const s = format(d, formatString, 'dateTime')
      if (s) return s
    } catch {
      /* fallback below */
    }
  }
  const datePart = `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`
  if (d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds()) {
    const h = d.getUTCHours()
    const h12 = h % 12 || 12
    return `${datePart} ${h12}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
  }
  return datePart
}

export function monthName(m: number, short = false): string {
  const n = MONTHS[m] ?? ''
  return short ? n.slice(0, 3) : n
}
