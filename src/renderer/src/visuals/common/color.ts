/**
 * Color resolution for data-bound visuals (pure).
 *
 *  - Data-point selectors (`selector.data[].scopeId` comparisons, `dataViewWildcard`) matching.
 *  - Per-series / per-category fills from `dataPoint` (visual objects → theme palette).
 *  - Conditional formatting: FillRule gradients (2/3 stops, explicit or data-range min/max),
 *    Conditional rules (Cases) and field-value colors, evaluated per data point.
 */
import type { Scalar } from '@core/model/data'
import { decodeLiteral } from '@core/report/literal'
import { decodeValue, objectEntries, type ObjectEntry, type PropContext } from '@core/report/props'
import { fieldKey } from '@core/report/sq'
import { parseHex, seriesColor, themeDataColor, toHex, type ResolvedTheme } from '@core/report/theme'

export interface ScopeField {
  expr: any
  value: Scalar
}

function scalarEq(a: Scalar, b: Scalar): boolean {
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : typeof a === 'string' ? Date.parse(a) : NaN
    const tb = b instanceof Date ? b.getTime() : typeof b === 'string' ? Date.parse(b) : NaN
    return ta === tb
  }
  if (typeof a === 'number' && typeof b === 'string') return String(a) === b
  if (typeof b === 'number' && typeof a === 'string') return String(b) === a
  return a === b
}

/** Does a single scopeId condition hold for the data point fields? */
export function scopeConditionMatches(cond: any, fields: ScopeField[]): boolean {
  if (!cond) return false
  if (cond.And) return scopeConditionMatches(cond.And.Left, fields) && scopeConditionMatches(cond.And.Right, fields)
  if (cond.Or) return scopeConditionMatches(cond.Or.Left, fields) || scopeConditionMatches(cond.Or.Right, fields)
  if (cond.Comparison) {
    const key = fieldKey(cond.Comparison.Left)
    const f = fields.find((x) => fieldKey(x.expr) === key || sameColumn(x.expr, cond.Comparison.Left))
    if (!f) return false
    const lit = cond.Comparison.Right?.Literal ? decodeLiteral(cond.Comparison.Right.Literal.Value) : null
    return scalarEq(f.value, lit)
  }
  return false
}

function sameColumn(a: any, b: any): boolean {
  const ca = a?.Column ?? a?.HierarchyLevel
  const cb = b?.Column ?? b?.HierarchyLevel
  if (!ca || !cb) return false
  const pa = a.Column ? a.Column.Property : a.HierarchyLevel.Level
  const pb = b.Column ? b.Column.Property : b.HierarchyLevel.Level
  return pa === pb
}

export function isWildcardSelector(sel: any): boolean {
  return Array.isArray(sel?.data) && sel.data.some((d: any) => d?.dataViewWildcard)
}

/** Data selector (array of {scopeId}) matches the point (every scope must hold). */
export function dataSelectorMatches(data: any[] | undefined, fields: ScopeField[]): boolean {
  if (!Array.isArray(data) || !data.length) return false
  return data.every((d) => (d?.dataViewWildcard ? true : d?.scopeId ? scopeConditionMatches(d.scopeId, fields) : false))
}

/** Find the most specific objects entry for a data point: data selector > metadata > default. */
export function findEntry(entries: ObjectEntry[], prop: string, opts: { metadata?: string; fields?: ScopeField[] }): ObjectEntry | undefined {
  const withProp = entries.filter((e) => e.properties && prop in e.properties)
  if (opts.fields?.length) {
    const hit = withProp.find((e) => e.selector?.data && !isWildcardSelector(e.selector) && dataSelectorMatches(e.selector.data, opts.fields!))
    if (hit) return hit
  }
  if (opts.metadata) {
    const hit = withProp.find((e) => e.selector?.metadata === opts.metadata && !e.selector?.data)
    if (hit) return hit
  }
  return undefined
}

/** Static per-series/per-point fill from `dataPoint.fill` (no conditional formatting). */
export function staticFill(pc: PropContext, opts: { metadata?: string; fields?: ScopeField[]; index: number; object?: string; prop?: string }): string {
  const object = opts.object ?? 'dataPoint'
  const prop = opts.prop ?? 'fill'
  const entries = objectEntries(pc, object)
  const hit = findEntry(entries, prop, opts)
  if (hit) {
    const v = decodeValue(hit.properties[prop], pc.theme)
    if (typeof v === 'string') return v
  }
  return seriesColor(pc.theme, opts.index)
}

/** The dataPoint default color (`defaultColor` or a wildcard/no-selector `fill`) if set. */
export function defaultFill(pc: PropContext, object = 'dataPoint'): string | undefined {
  const entries = objectEntries(pc, object)
  for (const e of entries) {
    if (e.selector?.metadata || (e.selector?.data && !isWildcardSelector(e.selector))) continue
    for (const p of ['defaultColor', 'fill']) {
      if (!e.properties || !(p in e.properties)) continue
      const v = decodeValue(e.properties[p], pc.theme)
      if (typeof v === 'string') return v
    }
  }
  const themed = pc.theme.visualStyles?.[pc.visualType]?.['*']?.[object]?.[0]?.defaultColor ?? pc.theme.visualStyles?.['*']?.['*']?.[object]?.[0]?.defaultColor
  const t = themed ? decodeValue(themed, pc.theme) : undefined
  return typeof t === 'string' ? t : undefined
}

// ---------------------------------------------------------------------------------------------
// Conditional formatting
// ---------------------------------------------------------------------------------------------

export interface ConditionalRule {
  /** raw expression (FillRule / Conditional / Measure / Aggregation / Column) */
  expr: any
  /** the SQ field whose per-point value drives the rule */
  input?: any
  /** metadata selector restricting the rule to one series */
  metadata?: string
}

/** Extract the conditional (data-bound) color rule of an object property, if any. */
export function conditionalRule(pc: PropContext, object: string, prop: string, metadata?: string): ConditionalRule | undefined {
  for (const e of objectEntries(pc, object)) {
    const raw = e.properties?.[prop]
    const expr = raw?.solid?.color?.expr ?? raw?.expr
    if (!expr) continue
    if (!(expr.FillRule || expr.Conditional || expr.Measure || expr.Aggregation || expr.Column)) continue
    if (e.selector?.metadata && metadata && e.selector.metadata !== metadata) continue
    const input = expr.FillRule ? expr.FillRule.Input : expr.Conditional ? conditionalInput(expr.Conditional) : expr
    return { expr, input, metadata: e.selector?.metadata }
  }
  return undefined
}

function conditionalInput(c: any): any {
  for (const cs of c?.Cases ?? []) {
    const cond = cs.Condition
    const left = findLeft(cond)
    if (left) return left
  }
  return undefined
}

function findLeft(cond: any): any {
  if (!cond) return undefined
  if (cond.Comparison) return cond.Comparison.Left
  if (cond.And) return findLeft(cond.And.Left) ?? findLeft(cond.And.Right)
  if (cond.Or) return findLeft(cond.Or.Left) ?? findLeft(cond.Or.Right)
  if (cond.Between) return cond.Between.Expression
  if (cond.Not) return findLeft(cond.Not.Expression)
  if (cond.Contains) return cond.Contains.Left
  if (cond.StartsWith) return cond.StartsWith.Left
  if (cond.EndsWith) return cond.EndsWith.Left
  return undefined
}

function colorOf(node: any, theme: ResolvedTheme): string | undefined {
  if (!node) return undefined
  if (typeof node === 'string') return node
  if (node.Literal) {
    const v = decodeLiteral(node.Literal.Value)
    return typeof v === 'string' ? v : undefined
  }
  if (node.ThemeDataColor) return themeDataColor(theme, node.ThemeDataColor.ColorId, node.ThemeDataColor.Percent ?? 0)
  const d = decodeValue(node, theme)
  return typeof d === 'string' ? d : undefined
}

function numOf(node: any): number | undefined {
  if (node === undefined || node === null) return undefined
  if (typeof node === 'number') return node
  const v = node.Literal ? decodeLiteral(node.Literal.Value) : decodeLiteral(node)
  return typeof v === 'number' ? v : undefined
}

export function mixColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parseHex(a)
  const [r2, g2, b2] = parseHex(b)
  const k = Math.max(0, Math.min(1, t))
  return toHex(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k)
}

/** Evaluate a gradient FillRule for value v given the data range. */
export function evalFillRule(rule: any, v: Scalar, range: [number, number], theme: ResolvedTheme): string | undefined {
  const g2 = rule.linearGradient2
  const g3 = rule.linearGradient3
  const g = g2 ?? g3
  if (!g) return undefined
  if (v === null || typeof v !== 'number' || !Number.isFinite(v)) {
    const strat = g.nullColoringStrategy
    if (strat?.strategy?.Literal?.Value === "'specificColor'") return colorOf(strat.color, theme)
    if (strat?.strategy?.Literal?.Value === "'asZero'") v = 0
    else return undefined
  }
  const minC = colorOf(g.min?.color, theme) ?? '#DEEFFF'
  const maxC = colorOf(g.max?.color, theme) ?? '#118DFF'
  const minV = numOf(g.min?.value) ?? range[0]
  const maxV = numOf(g.max?.value) ?? range[1]
  const x = v as number
  if (g3) {
    const midC = colorOf(g3.mid?.color, theme) ?? '#D9B300'
    const midV = numOf(g3.mid?.value) ?? (minV + maxV) / 2
    if (x <= midV) return mixColor(minC, midC, midV === minV ? 1 : (x - minV) / (midV - minV))
    return mixColor(midC, maxC, maxV === midV ? 1 : (x - midV) / (maxV - midV))
  }
  return mixColor(minC, maxC, maxV === minV ? 1 : (x - minV) / (maxV - minV))
}

function evalCondition(cond: any, v: Scalar): boolean {
  if (!cond) return false
  if (cond.And) return evalCondition(cond.And.Left, v) && evalCondition(cond.And.Right, v)
  if (cond.Or) return evalCondition(cond.Or.Left, v) || evalCondition(cond.Or.Right, v)
  if (cond.Not) return !evalCondition(cond.Not.Expression, v)
  if (cond.Contains || cond.StartsWith || cond.EndsWith) {
    const c = cond.Contains ?? cond.StartsWith ?? cond.EndsWith
    const r = c.Right?.Literal ? decodeLiteral(c.Right.Literal.Value) : null
    if (v === null || r === null) return false
    const a = String(v).toLowerCase()
    const b = String(r).toLowerCase()
    return cond.Contains ? a.includes(b) : cond.StartsWith ? a.startsWith(b) : a.endsWith(b)
  }
  if (cond.Comparison) {
    const r = cond.Comparison.Right?.Literal ? decodeLiteral(cond.Comparison.Right.Literal.Value) : null
    const a = v instanceof Date ? v.getTime() : v
    const b = r instanceof Date ? r.getTime() : r
    switch (cond.Comparison.ComparisonKind) {
      case 0:
        return scalarEq(v, r)
      case 1:
        return a !== null && b !== null && (a as any) > (b as any)
      case 2:
        return a !== null && b !== null && (a as any) >= (b as any)
      case 3:
        return a !== null && b !== null && (a as any) < (b as any)
      case 4:
        return a !== null && b !== null && (a as any) <= (b as any)
      default:
        return false
    }
  }
  return false
}

/** Evaluate a conditional rule for one point. `inputValue` = value of rule.input for the point; range = data range. */
export function evalConditional(rule: ConditionalRule, inputValue: Scalar, range: [number, number], theme: ResolvedTheme): string | undefined {
  const e = rule.expr
  if (e.FillRule) return evalFillRule(e.FillRule.FillRule ?? e.FillRule, inputValue, range, theme)
  if (e.Conditional) {
    for (const cs of e.Conditional.Cases ?? []) if (evalCondition(cs.Condition, inputValue)) return colorOf(cs.Value, theme)
    return colorOf(e.Conditional.DefaultValue, theme)
  }
  // field value: the measure returns a color (name or hex)
  return typeof inputValue === 'string' && inputValue ? inputValue : undefined
}

// ---------------------------------------------------------------------------------------------
// Misc color utilities
// ---------------------------------------------------------------------------------------------

/** Relative luminance (0..1) of a hex color. */
export function luminance(hex: string): number {
  if (!hex?.startsWith('#')) return 0.5
  const [r, g, b] = parseHex(hex).map((c, i) => (i < 3 ? c / 255 : c))
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** PBI auto label color inside a filled shape: white on dark fills, near-black on light ones. */
export function contrastText(fill: string): string {
  return luminance(fill) < 0.4 ? '#FFFFFF' : '#252423'
}

export function rgba(hex: string, alpha: number): string {
  if (!hex?.startsWith('#')) return hex
  const [r, g, b] = parseHex(hex)
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`
}
