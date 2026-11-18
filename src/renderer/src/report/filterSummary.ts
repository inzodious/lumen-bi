/**
 * Human-readable filter restatement (visual header filter icon, PBI-style "Category is Bikes or Clothing").
 */
import { fieldInfo, literalValue, type SQFilter } from '@core/report/sq'
import type { VisualHostContext } from '../visuals/contract'

export interface FilterRestatement {
  field: string
  description: string
}

const CMP = ['is', 'is greater than', 'is greater than or equal to', 'is less than', 'is less than or equal to']

function fieldName(expr: any, ctx?: VisualHostContext): string {
  const d = ctx?.engine.describeField(expr)
  if (d) return d.displayName
  const f = fieldInfo(expr)
  return f.property ?? f.level ?? '?'
}

function valueText(v: any, ctx?: VisualHostContext): string {
  if (v?.Literal) {
    const x = literalValue(v)
    if (x === null) return '(Blank)'
    return ctx ? ctx.format(x) : String(x)
  }
  if (v?.DateSpan || v?.DateAdd || v?.Now) return 'relative date'
  return '…'
}

function describeCondition(c: any, ctx: VisualHostContext | undefined, out: FilterRestatement[], negate = false): void {
  if (!c) return
  if (c.And) {
    describeCondition(c.And.Left, ctx, out, negate)
    describeCondition(c.And.Right, ctx, out, negate)
    return
  }
  if (c.Not) return describeCondition(c.Not.Expression, ctx, out, !negate)
  if (c.In) {
    const exprs: any[] = c.In.Expressions ?? []
    if (c.In.Table) {
      out.push({ field: exprs.map((e) => fieldName(e, ctx)).join(', '), description: negate ? 'is not in Top N' : 'is Top N' })
      return
    }
    const rows: any[][] = c.In.Values ?? []
    const vals = rows.map((r) => r.map((v) => valueText(v, ctx)).join(', '))
    const shown = vals.length > 6 ? [...vals.slice(0, 6), `+${vals.length - 6} more`] : vals
    out.push({ field: exprs.map((e) => fieldName(e, ctx)).join(', '), description: `${negate ? 'is not' : 'is'} ${shown.join(' or ')}` })
    return
  }
  if (c.Comparison) {
    const kind = CMP[c.Comparison.ComparisonKind ?? 0] ?? 'is'
    out.push({ field: fieldName(c.Comparison.Left, ctx), description: `${negate ? 'not ' : ''}${kind} ${valueText(c.Comparison.Right, ctx)}` })
    return
  }
  if (c.Between) {
    out.push({ field: fieldName(c.Between.Expression, ctx), description: `${negate ? 'is not' : 'is'} between ${valueText(c.Between.LowerBound, ctx)} and ${valueText(c.Between.UpperBound, ctx)}` })
    return
  }
  for (const k of ['Contains', 'StartsWith', 'EndsWith'] as const) {
    if (c[k]) {
      const base = k === 'Contains' ? 'contain' : k === 'StartsWith' ? 'start with' : 'end with'
      const verb = negate ? `does not ${base}` : base.replace(/^(\w+)/, '$1s')
      out.push({ field: fieldName(c[k].Left, ctx), description: `${verb} ${valueText(c[k].Right, ctx)}` })
      return
    }
  }
  if (c.Or) {
    const parts: FilterRestatement[] = []
    describeCondition(c.Or.Left, ctx, parts, negate)
    describeCondition(c.Or.Right, ctx, parts, negate)
    if (parts.length) out.push({ field: [...new Set(parts.map((p) => p.field))].join(', '), description: parts.map((p) => p.description).join(' or ') })
  }
}

export function describeFilter(f: SQFilter, ctx?: VisualHostContext): FilterRestatement[] {
  const out: FilterRestatement[] = []
  for (const w of f.Where ?? []) describeCondition(w.Condition, ctx, out)
  return out
}

export function describeFilters(ctx: VisualHostContext): FilterRestatement[] {
  const out: FilterRestatement[] = []
  for (const f of ctx.filters) out.push(...describeFilter(f, ctx))
  return out
}
