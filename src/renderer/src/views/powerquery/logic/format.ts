/**
 * Display of preview values in the Power Query Editor grid, like Power BI Desktop's Power Query
 * Editor in the en-US locale: dates `3/1/2024`, date/times `3/1/2024 10:00:00 AM`, logicals
 * `TRUE` / `FALSE`, percentages `12.5%`, nulls as italic `null`, errors as `Error`, nested values as
 * `Table` / `List` / `Record`.
 *
 * Approximation: the engine sends dates as ISO text, so they are formatted by the *column type*.
 * In an untyped (`any`) column a date value shows in ISO form (`2024-03-01`) where Power BI would
 * show `3/1/2024`.
 */
import type { ErrorInfo, PreviewCell } from '@core/m/engine.ts'
import { pqTypeOf, type PqType } from './mtext'

export type CellClass = 'null' | 'error' | 'nested' | 'number' | 'text' | 'logical' | 'date'

export interface CellDisplay {
  text: string
  cls: CellClass
  /** nested kind for links (Table / List / Record / Function / Type / Binary) */
  nested?: string
  error?: ErrorInfo
}

const pad2 = (n: number) => String(n).padStart(2, '0')

function time12(h: number, mi: number, s: string): string {
  return `${h % 12 || 12}:${pad2(mi)}:${s} ${h < 12 ? 'AM' : 'PM'}`
}

/** `2024-03-01` → `3/1/2024` (null when not an ISO date). */
export function usDate(iso: string): string | null {
  const m = /^(-?\d{4,})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${+m[2]!}/${+m[3]!}/${+m[1]!}` : null
}

/** `10:05:00(.123)` → `10:05:00 AM` */
export function usTime(iso: string): string | null {
  const m = /^(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(iso)
  if (!m) return null
  return time12(+m[1]!, +m[2]!, m[3]!.replace(/\.?0+$/, (x) => (x.startsWith('.') ? '' : x)))
}

/** `2024-03-01T10:00:00` → `3/1/2024 10:00:00 AM` (keeps a `+02:00` offset) */
export function usDateTime(iso: string): string | null {
  const m = /^(-?\d{4,}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})?$/.exec(iso)
  if (!m) return null
  const d = usDate(m[1]!)
  const t = usTime(m[2]!)
  if (!d || !t) return null
  return `${d} ${t}${m[3] ? ` ${m[3] === 'Z' ? '+00:00' : m[3]}` : ''}`
}

/** Number as Power Query shows it: no grouping, up to 15 significant digits, `E+` exponent. */
export function formatNumber(n: number, kind: PqType = 'number'): string {
  if (Number.isNaN(n)) return 'NaN'
  if (n === Infinity) return 'Infinity'
  if (n === -Infinity) return '-Infinity'
  if (kind === 'percentage') return `${trimNum(n * 100)}%`
  return trimNum(n)
}

function trimNum(n: number): string {
  const s = Number.isInteger(n) && Math.abs(n) < 1e15 ? String(n) : String(Number(n.toPrecision(15)))
  return s.replace('e+', 'E+').replace('e-', 'E-')
}

export function isNested(v: PreviewCell): v is { $kind: 'Table' | 'List' | 'Record' | 'Function' | 'Type' | 'Binary' } {
  return typeof v === 'object' && v !== null && '$kind' in v
}

export function isError(v: PreviewCell): v is { $error: ErrorInfo } {
  return typeof v === 'object' && v !== null && '$error' in v
}

/** How a cell displays in a column of the given (preview) type. */
export function formatCell(v: PreviewCell, colType = 'any'): CellDisplay {
  if (v === null) return { text: 'null', cls: 'null' }
  if (isError(v)) return { text: 'Error', cls: 'error', error: v.$error }
  if (isNested(v)) return { text: v.$kind, cls: 'nested', nested: v.$kind }
  if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', cls: 'logical' }
  const kind = pqTypeOf(colType)
  if (typeof v === 'number') return { text: formatNumber(v, kind), cls: 'number' }
  switch (kind) {
    case 'date':
      return { text: usDate(v) ?? v, cls: 'date' }
    case 'datetime':
    case 'datetimezone':
      return { text: usDateTime(v) ?? usDate(v) ?? v, cls: 'date' }
    case 'time':
      return { text: usTime(v) ?? v, cls: 'date' }
    case 'duration':
      return { text: v, cls: 'date' }
    default:
      return { text: v, cls: 'text' }
  }
}

/** Plain text of a cell for lists (filter value list, profile labels). */
export function cellText(v: PreviewCell, colType = 'any'): string {
  return formatCell(v, colType).text
}

/** Stable key of a cell value (distinct counting, filter checkboxes). */
export function cellKey(v: PreviewCell): string {
  if (v === null) return 'n:'
  if (isError(v)) return 'e:'
  if (isNested(v)) return `k:${v.$kind}`
  if (typeof v === 'number') return `d:${v}`
  if (typeof v === 'boolean') return `b:${v}`
  return `s:${v}`
}

/** Column type icon category (header glyph) — see the grid. */
export type TypeIcon = 'text' | 'decimal' | 'whole' | 'currency' | 'percentage' | 'date' | 'datetime' | 'datetimezone' | 'time' | 'duration' | 'logical' | 'binary' | 'any' | 'table' | 'record' | 'list' | 'function'

export function typeIcon(typeText: string): TypeIcon {
  const t = typeText.replace(/^nullable\s+/, '').trim()
  if (/^table\b/.test(t)) return 'table'
  if (/^record\b/.test(t)) return 'record'
  if (/^list\b/.test(t)) return 'list'
  if (/^function\b/.test(t)) return 'function'
  const k = pqTypeOf(typeText)
  switch (k) {
    case 'number':
      return 'decimal'
    case 'int64':
      return 'whole'
    default:
      return k
  }
}

/** "N COLUMNS, M ROWS" with PBI's "999+" when the preview is truncated. */
export function statusCounts(columns: number, rows: number, truncated: boolean): string {
  const r = truncated ? '999+' : String(rows)
  return `${columns} COLUMN${columns === 1 ? '' : 'S'}, ${r} ROW${!truncated && rows === 1 ? '' : 'S'}`
}

/** "3:41 PM" */
export function clockTime(d: Date): string {
  return `${d.getHours() % 12 || 12}:${pad2(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`
}
