/**
 * Format-string presets of the Power BI "Column tools / Measure tools ▸ Formatting" controls and the
 * Properties pane (Format dropdown, $ / % / , / decimal places), plus parsing of an existing string.
 */
import type { DataType } from '@core/model/types'

export type FormatKind = 'general' | 'wholeNumber' | 'decimal' | 'currency' | 'percentage' | 'scientific' | 'date' | 'time' | 'text' | 'custom'

export const FORMAT_KIND_LABELS: Record<FormatKind, string> = {
  general: 'General',
  wholeNumber: 'Whole number',
  decimal: 'Decimal number',
  currency: 'Currency',
  percentage: 'Percentage',
  scientific: 'Scientific',
  date: 'Date',
  time: 'Time',
  text: 'Text',
  custom: 'Custom'
}

export interface FormatSpec {
  kind: FormatKind
  decimals: number
  thousands: boolean
  /** currency symbol, e.g. "$", "€", "£" */
  symbol: string
  /** date/time pattern for kind date/time */
  pattern: string
  /** raw string for custom */
  custom: string
}

/** Date formats offered by PBI (format dropdown when data type is Date / Date/Time). */
export const DATE_FORMATS: Array<{ value: string; label: string }> = [
  { value: 'General Date', label: '3/14/2001 1:30:55 PM (General Date)' },
  { value: 'Long Date', label: 'Wednesday, March 14, 2001 (Long Date)' },
  { value: 'Short Date', label: '3/14/2001 (Short Date)' },
  { value: 'yyyy-mm-dd', label: '2001-03-14 (yyyy-mm-dd)' },
  { value: 'dd/mm/yyyy', label: '14/03/2001 (dd/mm/yyyy)' },
  { value: 'mm/dd/yyyy', label: '03/14/2001 (mm/dd/yyyy)' },
  { value: 'd-mmm-yy', label: '14-Mar-01 (d-mmm-yy)' },
  { value: 'mmm d, yyyy', label: 'Mar 14, 2001 (mmm d, yyyy)' },
  { value: 'mmmm d, yyyy', label: 'March 14, 2001 (mmmm d, yyyy)' },
  { value: 'mmmm yyyy', label: 'March 2001 (mmmm yyyy)' },
  { value: 'mmm yyyy', label: 'Mar 2001 (mmm yyyy)' },
  { value: 'yyyy', label: '2001 (yyyy)' },
  { value: 'dddd', label: 'Wednesday (dddd)' }
]

export const TIME_FORMATS: Array<{ value: string; label: string }> = [
  { value: 'Long Time', label: '1:30:55 PM (Long Time)' },
  { value: 'Short Time', label: '13:30 (Short Time)' },
  { value: 'hh:nn:ss', label: '13:30:55 (hh:nn:ss)' },
  { value: 'h:nn AM/PM', label: '1:30 PM (h:nn AM/PM)' }
]

export const CURRENCY_SYMBOLS = ['$', '€', '£', '¥', '₹', 'CHF', 'kr', 'R$', '₩', 'A$', 'C$']

const quoteSym = (s: string): string => (s.length === 1 && s !== '"' ? `\\${s}` : `"${s}"`)
const decimalsPart = (n: number): string => (n > 0 ? '.' + '0'.repeat(n) : '')

export function buildFormatString(spec: FormatSpec): string | undefined {
  const num = (spec.thousands ? '#,0' : '0') + decimalsPart(spec.decimals)
  switch (spec.kind) {
    case 'general':
      return undefined
    case 'wholeNumber':
      return spec.thousands ? '#,0' : '0'
    case 'decimal':
      return num
    case 'currency': {
      const s = quoteSym(spec.symbol || '$')
      return `${s}#,0${decimalsPart(spec.decimals)};(${s}#,0${decimalsPart(spec.decimals)});${s}#,0${decimalsPart(spec.decimals)}`
    }
    case 'percentage':
      return `${spec.thousands ? '#,0' : '0'}${decimalsPart(spec.decimals)}%`
    case 'scientific':
      return `0${decimalsPart(spec.decimals)}E+000`
    case 'date':
    case 'time':
      return spec.pattern || (spec.kind === 'date' ? 'Short Date' : 'Long Time')
    case 'text':
      return '@'
    case 'custom':
      return spec.custom || undefined
  }
}

const countDecimals = (s: string): number => {
  const m = /\.(0+)/.exec(s)
  return m ? m[1].length : 0
}

export function parseFormatString(fmt: string | undefined, dataType: DataType): FormatSpec {
  const base: FormatSpec = { kind: 'general', decimals: 2, thousands: true, symbol: '$', pattern: '', custom: fmt ?? '' }
  if (!fmt) return dataType === 'dateTime' ? { ...base, kind: 'date', pattern: 'General Date' } : base
  const f = fmt.trim()
  if (dataType === 'dateTime') return TIME_FORMATS.some((t) => t.value === f) ? { ...base, kind: 'time', pattern: f } : { ...base, kind: 'date', pattern: f }
  if (f === '@') return { ...base, kind: 'text' }
  if (f === '0' || f === '#,0' || f === '#,##0') return { ...base, kind: 'wholeNumber', decimals: 0, thousands: f !== '0' }
  const cur = /^(?:\\(.)|"([^"]+)")#,0(?:\.0+)?;/.exec(f)
  if (cur) return { ...base, kind: 'currency', symbol: cur[1] ?? cur[2], decimals: countDecimals(f.split(';')[0]) }
  const cur2 = /^(?:\\(.)|"([^"]+)")#,0(\.0+)?$/.exec(f)
  if (cur2) return { ...base, kind: 'currency', symbol: cur2[1] ?? cur2[2], decimals: cur2[3] ? cur2[3].length - 1 : 0 }
  if (/^(#,)?0(\.0+)?%$/.test(f)) return { ...base, kind: 'percentage', decimals: countDecimals(f), thousands: f.startsWith('#,') }
  if (/^0(\.0+)?E\+0+$/i.test(f)) return { ...base, kind: 'scientific', decimals: countDecimals(f) }
  if (/^(#,)?0\.0+$/.test(f) || /^#,0\.0+$/.test(f)) return { ...base, kind: 'decimal', decimals: countDecimals(f), thousands: f.startsWith('#,') }
  if (/^#,0$/.test(f)) return { ...base, kind: 'wholeNumber', decimals: 0 }
  return { ...base, kind: 'custom', custom: f }
}

export function formatKindsFor(dataType: DataType): FormatKind[] {
  switch (dataType) {
    case 'int64':
    case 'double':
    case 'decimal':
      return ['general', 'wholeNumber', 'decimal', 'currency', 'percentage', 'scientific', 'custom']
    case 'dateTime':
      return ['date', 'time', 'custom']
    case 'string':
      return ['text', 'custom']
    default:
      return ['general', 'custom']
  }
}

export const DATA_TYPE_LABELS: Partial<Record<DataType, string>> = {
  string: 'Text',
  int64: 'Whole number',
  double: 'Decimal number',
  decimal: 'Fixed decimal number',
  dateTime: 'Date/time',
  boolean: 'True/false',
  binary: 'Binary'
}

/** Data categories (TMDL value → PBI label). */
export const DATA_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: '', label: 'Uncategorized' },
  { value: 'Address', label: 'Address' },
  { value: 'City', label: 'City' },
  { value: 'Continent', label: 'Continent' },
  { value: 'Country', label: 'Country/Region' },
  { value: 'County', label: 'County' },
  { value: 'Latitude', label: 'Latitude' },
  { value: 'Longitude', label: 'Longitude' },
  { value: 'Place', label: 'Place' },
  { value: 'PostalCode', label: 'Postal code' },
  { value: 'StateOrProvince', label: 'State or Province' },
  { value: 'WebUrl', label: 'Web URL' },
  { value: 'ImageUrl', label: 'Image URL' },
  { value: 'Barcode', label: 'Barcode' }
]

export const SUMMARIZE_LABELS: Array<{ value: import('@core/model/types').SummarizeBy; label: string }> = [
  { value: 'none', label: "Don't summarize" },
  { value: 'sum', label: 'Sum' },
  { value: 'average', label: 'Average' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
  { value: 'count', label: 'Count' },
  { value: 'distinctCount', label: 'Count (Distinct)' }
]
