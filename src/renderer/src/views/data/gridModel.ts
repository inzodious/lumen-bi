/**
 * Pure helpers for the Table view grid: row ordering (sort), filtering, distinct values, widths.
 * Sorting/filtering in Table view is a view-only operation in Power BI (it doesn't change the model).
 */
import type { Scalar } from '@core/model/data'

export type ColumnFilter =
  | { kind: 'values'; values: Set<string> } // keys from valueKey()
  | { kind: 'text'; op: 'contains' | 'notContains' | 'equals' | 'startsWith' | 'endsWith' | 'isBlank' | 'isNotBlank'; text: string }

export interface SortState {
  column: string
  dir: 'asc' | 'desc'
}

export function valueKey(v: Scalar): string {
  if (v === null || v === undefined) return '\u0000blank'
  if (v instanceof Date) return `d${v.getTime()}`
  if (v instanceof Uint8Array) return `b${v.length}`
  return `${typeof v}:${String(v)}`
}

export function compareScalars(a: Scalar, b: Scalar): number {
  if (a === b) return 0
  if (a === null || a === undefined) return -1 // blanks first ascending (PBI)
  if (b === null || b === undefined) return 1
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0)
  return String(a).localeCompare(String(b), 'en', { sensitivity: 'base', numeric: true })
}

export function matchesFilter(v: Scalar, f: ColumnFilter, display: (v: Scalar) => string): boolean {
  if (f.kind === 'values') return f.values.has(valueKey(v))
  if (f.op === 'isBlank') return v === null || v === ''
  if (f.op === 'isNotBlank') return !(v === null || v === '')
  const s = display(v).toLowerCase()
  const t = f.text.toLowerCase()
  switch (f.op) {
    case 'contains':
      return s.includes(t)
    case 'notContains':
      return !s.includes(t)
    case 'equals':
      return s === t
    case 'startsWith':
      return s.startsWith(t)
    case 'endsWith':
      return s.endsWith(t)
  }
}

/** Row indices after filters and sort. */
export function computeRowOrder(
  rowCount: number,
  getValues: (column: string) => Scalar[] | undefined,
  filters: Record<string, ColumnFilter>,
  sort: SortState | null,
  display: (column: string, v: Scalar) => string
): number[] {
  let rows = Array.from({ length: rowCount }, (_, i) => i)
  for (const [col, f] of Object.entries(filters)) {
    const vals = getValues(col)
    if (!vals) continue
    rows = rows.filter((r) => matchesFilter(vals[r] ?? null, f, (v) => display(col, v)))
  }
  if (sort) {
    const vals = getValues(sort.column)
    if (vals) {
      const sign = sort.dir === 'asc' ? 1 : -1
      rows.sort((a, b) => sign * compareScalars(vals[a] ?? null, vals[b] ?? null) || a - b)
    }
  }
  return rows
}

/** Distinct values (sorted) with counts, for the filter checkbox list. */
export function distinctWithCounts(values: Scalar[]): Array<{ value: Scalar; key: string; count: number }> {
  const map = new Map<string, { value: Scalar; key: string; count: number }>()
  for (const v of values) {
    const k = valueKey(v)
    const e = map.get(k)
    if (e) e.count++
    else map.set(k, { value: v, key: k, count: 1 })
  }
  return [...map.values()].sort((a, b) => compareScalars(a.value, b.value))
}

/** Initial column width from header + sample of formatted values (7px/char approximation of Segoe UI 12px). */
export function estimateWidth(header: string, samples: string[]): number {
  const longest = Math.max(header.length + 4, ...samples.map((s) => s.length))
  return Math.max(70, Math.min(320, Math.round(longest * 7 + 24)))
}
