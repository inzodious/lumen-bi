/**
 * Column quality / distribution / profile statistics for the Power Query Editor (View ▸ Data Preview).
 *
 * Approximation: Power BI profiles the top 1000 rows by default (or the entire data set on request);
 * Lumen always profiles the rows of the preview (at most 1000), and the status bar says so.
 *
 * Definitions follow Power Query: Valid = not an error and not empty; Error = error cells;
 * Empty = null or empty text; Distinct = number of different values (null included); Unique = values
 * occurring exactly once.
 */
import type { PreviewCell } from '@core/m/engine.ts'
import { cellKey, isError, isNested } from './format'
import { pqTypeOf } from './mtext'

export interface ColumnQuality {
  total: number
  valid: number
  error: number
  empty: number
}

export interface ValueCount {
  value: PreviewCell
  count: number
}

export interface ColumnDistribution {
  distinct: number
  unique: number
  /** values by descending count (ties: first occurrence order) */
  values: ValueCount[]
}

export interface ColumnStats extends ColumnQuality {
  distinct: number
  unique: number
  emptyString: number
  min: PreviewCell
  max: PreviewCell
  /** numeric columns */
  average?: number
  stdDev?: number
  zero?: number
  nan?: number
  odd?: number
  even?: number
}

export function columnValues(rows: readonly PreviewCell[][], index: number): PreviewCell[] {
  return rows.map((r) => r[index] ?? null)
}

const isEmpty = (v: PreviewCell) => v === null || v === ''

export function columnQuality(values: readonly PreviewCell[]): ColumnQuality {
  let error = 0
  let empty = 0
  for (const v of values) {
    if (isError(v)) error++
    else if (isEmpty(v)) empty++
  }
  return { total: values.length, valid: values.length - error - empty, error, empty }
}

/** Percentages as Power Query shows them (`100%`, `< 1%`, `67%`). */
export function percentText(part: number, total: number): string {
  if (!total || !part) return '0%'
  const p = (part / total) * 100
  if (p < 1) return '< 1%'
  if (p > 99 && part < total) return '> 99%'
  return `${Math.round(p)}%`
}

export function columnDistribution(values: readonly PreviewCell[]): ColumnDistribution {
  const counts = new Map<string, ValueCount>()
  for (const v of values) {
    if (isError(v)) continue
    const k = cellKey(v)
    const cur = counts.get(k)
    if (cur) cur.count++
    else counts.set(k, { value: v, count: 1 })
  }
  const list = [...counts.values()]
  const sorted = list.map((x, i) => ({ x, i })).sort((a, b) => b.x.count - a.x.count || a.i - b.i).map((e) => e.x)
  return { distinct: list.length, unique: list.filter((x) => x.count === 1).length, values: sorted }
}

function compare(a: PreviewCell, b: PreviewCell): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  const sa = String(a)
  const sb = String(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

export function columnStats(values: readonly PreviewCell[], colType = 'any'): ColumnStats {
  const q = columnQuality(values)
  const d = columnDistribution(values)
  let min: PreviewCell = null
  let max: PreviewCell = null
  let emptyString = 0
  const nums: number[] = []
  let nan = 0
  for (const v of values) {
    if (v === null || isError(v) || isNested(v)) continue
    if (v === '') emptyString++
    if (typeof v === 'number') {
      if (Number.isNaN(v)) {
        nan++
        continue
      }
      nums.push(v)
    }
    if (min === null || compare(v, min) < 0) min = v
    if (max === null || compare(v, max) > 0) max = v
  }
  const stats: ColumnStats = { ...q, distinct: d.distinct, unique: d.unique, emptyString, min, max }
  const k = pqTypeOf(colType)
  const numeric = k === 'number' || k === 'int64' || k === 'currency' || k === 'percentage' || (k === 'any' && nums.length > 0 && nums.length === values.filter((v) => v !== null && !isError(v)).length)
  if (numeric) {
    const n = nums.length
    const sum = nums.reduce((a, b) => a + b, 0)
    const avg = n ? sum / n : undefined
    stats.average = avg
    // sample standard deviation (as Power Query's profile)
    stats.stdDev = n > 1 && avg !== undefined ? Math.sqrt(nums.reduce((a, b) => a + (b - avg) * (b - avg), 0) / (n - 1)) : undefined
    stats.zero = nums.filter((x) => x === 0).length
    stats.nan = nan
    const ints = nums.filter((x) => Number.isInteger(x))
    stats.even = ints.filter((x) => x % 2 === 0).length
    stats.odd = ints.length - stats.even
  }
  return stats
}
