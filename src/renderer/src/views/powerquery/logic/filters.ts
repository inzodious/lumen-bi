/**
 * Column filter menu → `Table.SelectRows` (pure), written exactly like Power Query's autofilter:
 *
 *   checked few values   → each ([Region] = "East" or [Region] = "West")
 *   unchecked few values → each ([Region] <> "East" and [Region] <> "West")
 *   Remove Empty         → each [Name] <> null and [Name] <> ""
 *   Text Filters ▸ …     → each Text.StartsWith([Name], "a") and Text.EndsWith([Name], "z")
 */
import type { PreviewCell } from '@core/m/engine.ts'
import { fieldRef, mNumber, mText, pqTypeOf } from './mtext'
import type { StepSpec } from './transforms'

/** M literal for a preview cell value of a column of the given type (dates arrive as ISO text). */
export function cellLiteral(v: PreviewCell, colType: string): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return mNumber(v)
  if (typeof v === 'string') {
    const k = pqTypeOf(colType)
    if (k === 'date') {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
      if (m) return `#date(${+m[1]!}, ${+m[2]!}, ${+m[3]!})`
    }
    if (k === 'datetime' || k === 'datetimezone') {
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})?$/.exec(v)
      if (m) {
        const parts = `${+m[1]!}, ${+m[2]!}, ${+m[3]!}, ${+m[4]!}, ${+m[5]!}, ${+m[6]!}`
        if (k === 'datetimezone') {
          const z = m[7] && m[7] !== 'Z' ? m[7] : '+00:00'
          const sign = z.startsWith('-') ? -1 : 1
          const [zh, zm] = z.slice(1).split(':').map(Number)
          return `#datetimezone(${parts}, ${sign * zh!}, ${sign * zm!})`
        }
        return `#datetime(${parts})`
      }
    }
    if (k === 'time') {
      const m = /^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(v)
      if (m) return `#time(${+m[1]!}, ${+m[2]!}, ${+m[3]!})`
    }
    return mText(v)
  }
  return 'null'
}

/** Literal for a value typed in a filter dialog (numbers/dates parsed per column type). */
export function typedLiteral(text: string, colType: string): string {
  const k = pqTypeOf(colType)
  const v = text.trim()
  if (v === '' && k !== 'text') return 'null'
  if (k === 'number' || k === 'int64' || k === 'currency' || k === 'percentage') {
    const n = Number(v.replace(/,/g, ''))
    if (Number.isFinite(n)) return mNumber(n)
  }
  if (k === 'date' || k === 'datetime') {
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(v)
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(v)
    let y: number | undefined, mo: number | undefined, d: number | undefined, h = 0, mi = 0, s = 0
    if (us) {
      ;[mo, d, y] = [+us[1]!, +us[2]!, +us[3]!]
      h = us[4] ? +us[4] : 0
      mi = us[5] ? +us[5] : 0
      s = us[6] ? +us[6] : 0
      if (us[7]) h = (h % 12) + (/pm/i.test(us[7]) ? 12 : 0)
    } else if (iso) {
      ;[y, mo, d] = [+iso[1]!, +iso[2]!, +iso[3]!]
      h = iso[4] ? +iso[4] : 0
      mi = iso[5] ? +iso[5] : 0
      s = iso[6] ? +iso[6] : 0
    }
    if (y !== undefined) return k === 'date' ? `#date(${y}, ${mo}, ${d})` : `#datetime(${y}, ${mo}, ${d}, ${h}, ${mi}, ${s})`
  }
  if (k === 'logical' && /^(true|false)$/i.test(v)) return v.toLowerCase()
  return mText(text)
}

function cellKey(v: PreviewCell): string {
  return JSON.stringify(v)
}

/**
 * Checkbox-list filter. `all` = every distinct value listed; `checked` = values kept. PQ writes the
 * shorter of the two forms (= … or … for few checked, <> … and … for few unchecked).
 */
export function filterByValues(col: string, colType: string, all: readonly PreviewCell[], checked: readonly PreviewCell[]): StepSpec | null {
  const keep = new Set(checked.map(cellKey))
  const unchecked = all.filter((v) => !keep.has(cellKey(v)))
  if (!unchecked.length) return null
  const ref = fieldRef(col)
  let cond: string
  if (checked.length <= unchecked.length) {
    if (!checked.length) cond = 'false'
    else cond = checked.map((v) => `${ref} = ${cellLiteral(v, colType)}`).join(' or ')
  } else cond = unchecked.map((v) => `${ref} <> ${cellLiteral(v, colType)}`).join(' and ')
  return { name: 'Filtered Rows', formula: (p) => `Table.SelectRows(${p}, each (${cond}))` }
}

export const removeEmpty = (col: string, colType: string): StepSpec => {
  const ref = fieldRef(col)
  const k = pqTypeOf(colType)
  const cond = k === 'text' || k === 'any' ? `${ref} <> null and ${ref} <> ""` : `${ref} <> null`
  return { name: 'Filtered Rows', formula: (p) => `Table.SelectRows(${p}, each ${cond})` }
}

export type FilterOp =
  | 'equals'
  | 'notEquals'
  | 'beginsWith'
  | 'notBeginsWith'
  | 'endsWith'
  | 'notEndsWith'
  | 'contains'
  | 'notContains'
  | 'greater'
  | 'greaterOrEqual'
  | 'less'
  | 'lessOrEqual'
  | 'before'
  | 'after'
  | 'onOrBefore'
  | 'onOrAfter'

export const TEXT_FILTER_OPS: Array<{ id: FilterOp; label: string }> = [
  { id: 'equals', label: 'equals' },
  { id: 'notEquals', label: 'does not equal' },
  { id: 'beginsWith', label: 'begins with' },
  { id: 'notBeginsWith', label: 'does not begin with' },
  { id: 'endsWith', label: 'ends with' },
  { id: 'notEndsWith', label: 'does not end with' },
  { id: 'contains', label: 'contains' },
  { id: 'notContains', label: 'does not contain' }
]

export const NUMBER_FILTER_OPS: Array<{ id: FilterOp; label: string }> = [
  { id: 'equals', label: 'equals' },
  { id: 'notEquals', label: 'does not equal' },
  { id: 'greater', label: 'is greater than' },
  { id: 'greaterOrEqual', label: 'is greater than or equal to' },
  { id: 'less', label: 'is less than' },
  { id: 'lessOrEqual', label: 'is less than or equal to' }
]

export const DATE_FILTER_OPS: Array<{ id: FilterOp; label: string }> = [
  { id: 'equals', label: 'is' },
  { id: 'notEquals', label: 'is not' },
  { id: 'before', label: 'is before' },
  { id: 'after', label: 'is after' },
  { id: 'onOrBefore', label: 'is on or before' },
  { id: 'onOrAfter', label: 'is on or after' }
]

export function filterOpsFor(colType: string): Array<{ id: FilterOp; label: string }> {
  const k = pqTypeOf(colType)
  if (k === 'number' || k === 'int64' || k === 'currency' || k === 'percentage') return NUMBER_FILTER_OPS
  if (k === 'date' || k === 'datetime' || k === 'datetimezone' || k === 'time') return DATE_FILTER_OPS
  return TEXT_FILTER_OPS
}

export interface FilterCondition {
  op: FilterOp
  /** value as typed */
  value: string
}

export function conditionExpr(col: string, colType: string, c: FilterCondition): string {
  const ref = fieldRef(col)
  const lit = typedLiteral(c.value, colType)
  switch (c.op) {
    case 'equals':
      return `${ref} = ${lit}`
    case 'notEquals':
      return `${ref} <> ${lit}`
    case 'beginsWith':
      return `Text.StartsWith(${ref}, ${lit})`
    case 'notBeginsWith':
      return `not Text.StartsWith(${ref}, ${lit})`
    case 'endsWith':
      return `Text.EndsWith(${ref}, ${lit})`
    case 'notEndsWith':
      return `not Text.EndsWith(${ref}, ${lit})`
    case 'contains':
      return `Text.Contains(${ref}, ${lit})`
    case 'notContains':
      return `not Text.Contains(${ref}, ${lit})`
    case 'greater':
    case 'after':
      return `${ref} > ${lit}`
    case 'greaterOrEqual':
    case 'onOrAfter':
      return `${ref} >= ${lit}`
    case 'less':
    case 'before':
      return `${ref} < ${lit}`
    case 'lessOrEqual':
    case 'onOrBefore':
      return `${ref} <= ${lit}`
  }
}

/** Filter Rows dialog (basic): one or two conditions joined with and/or. */
export function filterByConditions(col: string, colType: string, first: FilterCondition, join?: 'and' | 'or', second?: FilterCondition | null): StepSpec {
  let cond = conditionExpr(col, colType, first)
  if (join && second && (second.value.trim() !== '' || pqTypeOf(colType) === 'text')) cond = `${cond} ${join} ${conditionExpr(col, colType, second)}`
  return { name: 'Filtered Rows', formula: (p) => `Table.SelectRows(${p}, each ${cond})` }
}

/** Date filters that need no value: Is Earliest / Is Latest / Is Not Earliest / Is Not Latest. */
export function filterExtreme(col: string, which: 'earliest' | 'latest', negate = false): StepSpec {
  const v = which === 'earliest' ? 'earliest' : 'latest'
  const fn = which === 'earliest' ? 'List.Min' : 'List.Max'
  return {
    name: 'Filtered Rows',
    formula: (p) => `let ${v} = ${fn}(${p}${fieldRef(col)}) in Table.SelectRows(${p}, each ${fieldRef(col)} ${negate ? '<>' : '='} ${v})`
  }
}
