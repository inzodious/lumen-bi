/**
 * Power BI "display units" + "value decimal places" applied on top of a model format string.
 *
 * PBI display unit property values: 0 = Auto, 1 = None, 1e3 = Thousands (K), 1e6 = Millions (M),
 * 1e9 = Billions (bn), 1e12 = Trillions (T). Precision (`labelPrecision` / `*Precision`) overrides
 * the number of decimals of the format string; Auto precision keeps the format string's decimals
 * for unscaled values and uses up to 2 decimals for scaled values (PBI's displayUnitSystem
 * behavior: e.g. 29,358,677 → "29.36M", 60,000 with an integer format → "60K").
 */
import type { DataType } from '@core/model/types'
import type { Scalar } from '@core/model/data'
import type { ValueFormatter } from '@core/engine/api'

export const UNIT_SUFFIX: Record<number, string> = { 1e3: 'K', 1e6: 'M', 1e9: 'bn', 1e12: 'T' }

/** Pick the auto display unit for a magnitude. */
export function autoUnit(magnitude: number): number {
  const a = Math.abs(magnitude)
  if (a >= 1e12) return 1e12
  if (a >= 1e9) return 1e9
  if (a >= 1e6) return 1e6
  if (a >= 1e3) return 1e3
  return 1
}

/** Locate the numeric placeholder run of a single format section, skipping quoted/escaped text. */
function numberRun(section: string): { start: number; end: number } | undefined {
  let i = 0
  while (i < section.length) {
    const ch = section[i]
    if (ch === '"') {
      const close = section.indexOf('"', i + 1)
      i = close < 0 ? section.length : close + 1
      continue
    }
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '#' || ch === '0' || (ch === '.' && /[0#]/.test(section[i + 1] ?? ''))) {
      let j = i
      while (j < section.length && /[#0,.]/.test(section[j])) j++
      return { start: i, end: j }
    }
    i++
  }
  return undefined
}

/** Number of decimals a format string shows (first section). undefined when there is no numeric placeholder. */
export function formatDecimals(fmt: string | undefined): number | undefined {
  if (!fmt) return undefined
  const section = fmt.split(';')[0]
  const run = numberRun(section)
  if (!run) return undefined
  const body = section.slice(run.start, run.end)
  const dot = body.indexOf('.')
  return dot < 0 ? 0 : body.length - dot - 1
}

/**
 * Rewrite the decimals of every section of a .NET format string. `optional` uses '#' placeholders
 * (trailing zeros trimmed). Strings without a numeric placeholder (e.g. "General") are replaced.
 */
export function withDecimals(fmt: string | undefined, decimals: number, optional = false, keepScaling = false): string {
  const dec = decimals > 0 ? '.' + (optional ? '#' : '0').repeat(decimals) : ''
  if (!fmt || /^general/i.test(fmt.trim())) return `#,0${dec}`
  const sections = fmt.split(';').map((section) => {
    const run = numberRun(section)
    if (!run) return section
    const body = section.slice(run.start, run.end)
    const rawInt = body.split('.')[0]
    // scaling commas directly before the decimal point (e.g. "#,0,,") are dropped when a display unit
    // replaces them; with display units "None" they stay, so "$#,##0,,.0M" keeps dividing by 1e6.
    const intPart = (keepScaling ? rawInt : rawInt.replace(/,+$/, '')) || '0'
    return section.slice(0, run.start) + intPart + dec + section.slice(run.end)
  })
  return sections.join(';')
}

function isPercentFormat(fmt: string | undefined): boolean {
  return !!fmt && /%/.test(fmt.replace(/"[^"]*"|\\./g, ''))
}

export interface DisplayFormatOptions {
  formatString?: string
  dataType?: DataType
  /** 0 auto, 1 none, 1e3.. */
  units?: number | null
  /** decimal places; null/undefined = auto */
  precision?: number | null
  /** for Auto units: magnitude used to choose the unit (e.g. the max of the column/axis). Defaults to the value. */
  autoBase?: number
}

/** Format a value applying display units and precision. Non-numbers go through the plain formatter. */
export function formatWithUnits(value: Scalar, format: ValueFormatter, opts: DisplayFormatOptions): string {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'number') return format(value, opts.formatString, opts.dataType)
  const fmt = opts.formatString
  const pct = isPercentFormat(fmt)
  let unit = opts.units === undefined || opts.units === null ? 1 : Number(opts.units)
  if (unit === 0) unit = pct ? 1 : autoUnit(opts.autoBase ?? value)
  if (pct || !UNIT_SUFFIX[unit]) unit = 1
  const precision = opts.precision === undefined || opts.precision === null ? undefined : Math.max(0, Math.min(15, Math.round(Number(opts.precision))))
  if (unit === 1) {
    if (precision === undefined) return format(value, fmt, opts.dataType)
    return format(value, withDecimals(fmt, precision, false, true), opts.dataType)
  }
  const scaled = value / unit
  let f: string
  if (precision !== undefined) f = withDecimals(fmt, precision)
  else {
    const baseDec = formatDecimals(fmt) ?? 0
    // integer formats: up to 2 optional decimals; decimal formats: exactly 2.
    f = baseDec === 0 ? withDecimals(fmt, 2, true) : withDecimals(fmt, 2)
  }
  const text = format(scaled, f, opts.dataType)
  return insertSuffix(text, UNIT_SUFFIX[unit])
}

/** Insert the unit suffix right after the last digit ("$1.23" → "$1.23M", "(1.2)" → "(1.2M)"). */
export function insertSuffix(text: string, suffix: string): string {
  const m = /\d(?!.*\d)/s.exec(text)
  if (!m) return text + suffix
  const at = m.index + 1
  // keep a trailing optional decimal point out ("12." → "12M")
  const before = text.slice(0, at).replace(/\.$/, '')
  return before + suffix + text.slice(at)
}
