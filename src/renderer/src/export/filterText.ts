/**
 * Plain-text summaries of filter cards ("Product[Color] is Red, Blue") for slide notes and the
 * HTML export. Mirrors the Filters pane card summaries.
 */
import { aliasesOf, fieldInfo, literalValue, type SQFilter } from '@core/report/sq'
import type { Scalar } from '@core/model/data'

function fmt(v: Scalar): string {
  if (v === null) return '(Blank)'
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${v.getUTCMonth() + 1}/${v.getUTCDate()}/${v.getUTCFullYear()}${v.getUTCHours() || v.getUTCMinutes() ? ` ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}` : ''}`
  }
  return String(v)
}

function fieldLabel(expr: any, aliases: Record<string, string>): string {
  const f = fieldInfo(expr, aliases)
  if (f.kind === 'unknown') return 'Field'
  if (f.kind === 'aggregation') return `${f.table}[${f.property}] (aggregated)`
  return `${f.table ?? ''}[${f.property ?? f.level ?? ''}]`
}

const CMP = ['is', 'is greater than', 'is greater than or equal to', 'is less than', 'is less than or equal to']

function operand(e: any): string {
  if (e?.Literal) return fmt(literalValue(e))
  if (e?.DateSpan) return operand(e.DateSpan.Expression)
  if (e?.Now) return 'now'
  if (e?.DateAdd) return 'a relative date'
  return 'a value'
}

function describeCondition(c: any, aliases: Record<string, string>): string {
  if (!c || typeof c !== 'object') return 'has a filter'
  if (c.In) {
    if (c.In.Table) return `${fieldLabel(c.In.Expressions?.[0], aliases)} is in the Top N`
    const vals: string[] = (c.In.Values ?? []).map((row: any[]) => row.map((x) => fmt(literalValue(x))).join(' | '))
    const shown = vals.slice(0, 10).join(', ') + (vals.length > 10 ? ` and ${vals.length - 10} more` : '')
    return `${(c.In.Expressions ?? []).map((e: any) => fieldLabel(e, aliases)).join(', ')} is ${shown}`
  }
  if (c.Not) {
    const inner = describeCondition(c.Not.Expression, aliases)
    return inner.replace(/ is /, ' is not ')
  }
  if (c.And) return `${describeCondition(c.And.Left, aliases)} and ${describeCondition(c.And.Right, aliases).replace(/^.*?\] /, '')}`
  if (c.Or) return `${describeCondition(c.Or.Left, aliases)} or ${describeCondition(c.Or.Right, aliases).replace(/^.*?\] /, '')}`
  if (c.Comparison) return `${fieldLabel(c.Comparison.Left, aliases)} ${CMP[c.Comparison.ComparisonKind] ?? 'is'} ${operand(c.Comparison.Right)}`
  if (c.Between) return `${fieldLabel(c.Between.Expression, aliases)} is between ${operand(c.Between.LowerBound)} and ${operand(c.Between.UpperBound)}`
  if (c.Contains) return `${fieldLabel(c.Contains.Left, aliases)} contains ${operand(c.Contains.Right)}`
  if (c.StartsWith) return `${fieldLabel(c.StartsWith.Left, aliases)} starts with ${operand(c.StartsWith.Right)}`
  if (c.EndsWith) return `${fieldLabel(c.EndsWith.Left, aliases)} ends with ${operand(c.EndsWith.Right)}`
  return 'has a filter'
}

/** Summaries of the filter cards that actually filter (cards without a `filter` are skipped). */
export function describeFilterCards(cards: Array<{ filter?: SQFilter; field?: any }>): string[] {
  const out: string[] = []
  for (const card of cards) {
    const f = card.filter
    if (!f?.Where?.length) continue
    const aliases = aliasesOf(f)
    out.push(f.Where.map((w) => describeCondition(w.Condition, aliases)).join('; '))
  }
  return out
}
