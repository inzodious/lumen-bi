/**
 * Pure helpers of the list / dropdown slicer extras: item ordering, the dropdown summary text,
 * keyboard focus movement and the measure lookup used by "sort by measure".
 */
import type { Scalar } from '@core/model/data'
import type { SemanticModel } from '@core/model/types'
import { measureExpr, type SQExpr } from '@core/report/sq'
import { compareScalars } from '../common/sqEval'
import type { ItemSort, SummaryStyle } from './slicerFormat'

export interface OrderableItem {
  value: Scalar
  text: string
  selected: boolean
  /** row count (showCounts / count sorts) */
  count?: number | null
  /** sort-by measure value */
  measure?: Scalar
}

export interface OrderOptions {
  /** PBI sortDefinition of the slicer (applies when `sort` is 'default') */
  pbiSort?: 'asc' | 'desc'
  sort: ItemSort
  selectedFirst: boolean
}

/**
 * Order items. The engine returns values in the column's sort order (Sort by column honored); PBI's
 * sortDefinition only flips it. Lumen sorts: by label, by row count, by a measure; blanks stay last
 * for count/measure sorts. "Selected first" is a stable partition applied last.
 */
export function orderItems<T extends OrderableItem>(items: T[], o: OrderOptions): T[] {
  let out = items.slice()
  const blankLast = (a: Scalar | undefined, b: Scalar | undefined, dir: number) => {
    const an = a === null || a === undefined
    const bn = b === null || b === undefined
    if (an || bn) return an === bn ? 0 : an ? 1 : -1
    return dir * compareScalars(a, b)
  }
  switch (o.sort) {
    case 'asc':
      out.sort((a, b) => a.text.localeCompare(b.text, undefined, { numeric: true, sensitivity: 'base' }))
      break
    case 'desc':
      out.sort((a, b) => b.text.localeCompare(a.text, undefined, { numeric: true, sensitivity: 'base' }))
      break
    case 'countDesc':
    case 'countAsc':
      out.sort((a, b) => blankLast(a.count, b.count, o.sort === 'countDesc' ? -1 : 1))
      break
    case 'measureDesc':
    case 'measureAsc':
      out.sort((a, b) => blankLast(a.measure, b.measure, o.sort === 'measureDesc' ? -1 : 1))
      break
    default:
      if (o.pbiSort === 'desc') out.reverse()
  }
  if (o.selectedFirst) out = [...out.filter((i) => i.selected), ...out.filter((i) => !i.selected)]
  return out
}

export interface SummaryInput {
  style: SummaryStyle
  /** labels of the selected items in display order */
  selected: string[]
  /** total number of items */
  total: number
  /** nothing selected (no filter) or everything selected (Select all) */
  all: boolean
  /** an inverted (Select all minus some) selection: the count is total - excluded */
  selectedCount?: number
}

/**
 * Text of the closed dropdown box. 'pbi' is exactly Power BI's: "All" when nothing is filtered,
 * the single selected value, else "Multiple selections".
 */
export function summaryText(s: SummaryInput): string {
  const n = s.selectedCount ?? s.selected.length
  if (s.all || n === 0) return 'All'
  if (n === 1 && s.selected.length === 1) return s.selected[0]
  switch (s.style) {
    case 'list': {
      const shown = s.selected.slice(0, 2)
      const rest = n - shown.length
      return rest > 0 ? `${shown.join(', ')} +${rest}` : shown.join(', ')
    }
    case 'count':
      return `${n} of ${s.total} selected`
    default:
      return 'Multiple selections'
  }
}

/** Keyboard focus movement within a list of `count` rows (returns the new index). */
export function moveFocus(cur: number, key: string, count: number, page = 8): number {
  if (count <= 0) return -1
  const clamp = (i: number) => Math.max(0, Math.min(count - 1, i))
  switch (key) {
    case 'ArrowDown':
      return cur < 0 ? 0 : clamp(cur + 1)
    case 'ArrowUp':
      return cur < 0 ? count - 1 : clamp(cur - 1)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    case 'PageDown':
      return clamp((cur < 0 ? 0 : cur) + page)
    case 'PageUp':
      return clamp((cur < 0 ? 0 : cur) - page)
    default:
      return cur
  }
}

/** Resolve "Table[Measure]" / "[Measure]" / "Measure" to a measure SQ expression. */
export function findMeasure(model: SemanticModel | undefined, ref: string | undefined): SQExpr | undefined {
  if (!model || !ref) return undefined
  const m = /^\s*(?:'?([^'[\]]+?)'?\s*)?\[([^\]]+)\]\s*$/.exec(ref)
  const table = m?.[1]?.trim()
  const name = (m ? m[2] : ref).trim().toLowerCase()
  for (const t of model.tables ?? []) {
    if (table && t.name.toLowerCase() !== table.toLowerCase()) continue
    const hit = (t.measures ?? []).find((x) => x.name.toLowerCase() === name)
    if (hit) return measureExpr(t.name, hit.name)
  }
  return undefined
}

/**
 * PBI "paste values to select": exact (case-insensitive, like DAX text comparison) matches of the
 * pasted lines against the items' displayed text or raw value. Returns the matched items in list order.
 */
export function matchPasted<T extends { value: Scalar; text: string }>(lines: string[], items: T[]): T[] {
  const want = new Set(lines.map((l) => l.trim().toLowerCase()).filter((l) => l !== ''))
  if (!want.size) return []
  return items.filter((it) => want.has(it.text.trim().toLowerCase()) || (it.value !== null && want.has(String(it.value instanceof Date ? it.text : it.value).trim().toLowerCase())))
}
