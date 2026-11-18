/**
 * Conditional formatting (CF) for tables, matrices, cards and any visual with data-bound colors.
 *
 * PBIR encodes CF as data-bound property values inside `objects.<object>[]` entries:
 *   - Field value:   { solid: { color: { expr: { Measure | Aggregation | Column } } } }
 *   - Gradient:      { solid: { color: { expr: { FillRule: { Input, FillRule: { linearGradient2|3: { min, [mid], max, nullColoringStrategy } } } } } } }
 *   - Rules:         { solid: { color: { expr: { Conditional: { Cases: [{ Condition, Value }], DefaultValue? } } } } }
 *   - Icons:         icon: { kind?: 'Icon', layout, verticalAlignment, value: { Conditional ... } }   (value may also sit under expr)
 *   - Web URL:       webURL: { expr: { Measure | Aggregation | Column } }
 *   - Data bars:     columnFormatting[].properties.dataBars = { minValue?, maxValue?, positiveColor, negativeColor, axisColor, reverseDirection, hideText }
 * Entries are scoped with `selector.metadata` (the column/measure queryRef) and optionally
 * `selector.data: [{ dataViewWildcard: { matchingOption } }]` (0 = values+totals, 1 = values only, 2 = totals only).
 *
 * Evaluation is two-phase: the visual adds every rule input to its query (`ruleInputs`) so each
 * row carries the input values at the visual's grain, then `computeStats` derives min/max for
 * gradients and data bars across instance rows, and `evalColorRule` resolves a color per cell.
 */
import type { Scalar } from '@core/model/data'
import { decodeLiteral } from '@core/report/literal'
import { fieldKey, type SQExpr } from '@core/report/sq'
import { themeDataColor, parseHex, toHex, type ResolvedTheme } from '@core/report/theme'
import type { QueryEngine } from '@core/engine/api'
import type { SQFilter } from '@core/report/sq'
import { evalCondition, evalScalar, conditionFields, type FieldAccessor } from './sqEval'

export type CFScope = 'both' | 'instances' | 'totals'

export interface GradientStop {
  color: string
  /** explicit numeric value; undefined = data min (first stop) / data max (last) / midpoint */
  value?: number
}

export type ColorRule =
  | { kind: 'literal'; color: string }
  | { kind: 'field'; input: SQExpr }
  | { kind: 'gradient'; input: SQExpr; stops: GradientStop[]; nullStrategy: 'asZero' | 'specificColor' | 'noColor'; nullColor?: string }
  | { kind: 'rules'; inputs: SQExpr[]; cases: Array<{ condition: any; value: any }>; defaultValue?: any }

export interface IconRule {
  rule: ColorRule // value evaluates to an icon name instead of a color
  layout: 'before' | 'after' | 'only'
  verticalAlignment: 'top' | 'middle' | 'bottom'
}

export interface DataBarSpec {
  min?: number
  max?: number
  positiveColor: string
  negativeColor: string
  axisColor: string
  reverse: boolean
  hideText: boolean
}

export interface ColumnCF {
  backColor?: { rule: ColorRule; scope: CFScope }
  fontColor?: { rule: ColorRule; scope: CFScope }
  icon?: { rule: IconRule; scope: CFScope }
  webURL?: { input: SQExpr; scope: CFScope }
  dataBars?: { spec: DataBarSpec; scope: CFScope }
}

export interface RuleStats {
  min?: number
  max?: number
}

function unwrapExpr(raw: any): any {
  if (!raw || typeof raw !== 'object') return undefined
  if (raw.solid?.color !== undefined) return unwrapExpr(typeof raw.solid.color === 'object' ? raw.solid.color : { expr: { Literal: { Value: `'${raw.solid.color}'` } } })
  if (raw.expr) return raw.expr
  return raw
}

/** Decode a color literal / theme color / color token used inside rules. */
export function colorFromExpr(e: any, theme: ResolvedTheme): string | undefined {
  if (!e) return undefined
  if (e.Literal) {
    const v = decodeLiteral(e.Literal.Value)
    return typeof v === 'string' ? colorToken(v, theme) : undefined
  }
  if (e.ThemeDataColor) return themeDataColor(theme, e.ThemeDataColor.ColorId, e.ThemeDataColor.Percent ?? 0)
  if (e.color) return colorFromExpr(e.color, theme)
  if (e.solid) return colorFromExpr(unwrapExpr(e), theme)
  if (e.expr) return colorFromExpr(e.expr, theme)
  return undefined
}

/** PBI sometimes stores theme color tokens ('minColor', 'foreground', 'good'...) as literals. */
export function colorToken(v: string, theme: ResolvedTheme): string {
  const t = v.trim()
  if (t.startsWith('#') || t.startsWith('rgb')) return t
  const map: Record<string, string> = {
    mincolor: theme.minimum,
    maxcolor: theme.maximum,
    midcolor: theme.center,
    centercolor: theme.center,
    foreground: theme.foreground,
    background: theme.background,
    good: theme.good,
    bad: theme.bad,
    neutral: theme.neutral,
    tableaccent: theme.tableAccent
  }
  return map[t.toLowerCase()] ?? t
}

function isField(e: any): boolean {
  return !!(e && (e.Measure || e.Aggregation || e.Column || e.HierarchyLevel))
}

/** Compile a raw (data-bound or literal) color property into a rule. */
export function compileColorRule(raw: any, theme: ResolvedTheme): ColorRule | undefined {
  const e = unwrapExpr(raw)
  if (!e) return undefined
  if (e.Literal || e.ThemeDataColor) {
    const c = colorFromExpr(e, theme)
    return c ? { kind: 'literal', color: c } : undefined
  }
  if (isField(e)) return { kind: 'field', input: e }
  if (e.FillRule) {
    const fr = e.FillRule.FillRule ?? {}
    const g = fr.linearGradient3 ?? fr.linearGradient2
    if (!g) return undefined
    const stop = (s: any): GradientStop => {
      const val = s?.value ? decodeLiteral(s.value.Literal?.Value) : undefined
      return { color: colorFromExpr(s?.color, theme) ?? theme.foreground, value: typeof val === 'number' ? val : undefined }
    }
    const stops = fr.linearGradient3 ? [stop(g.min), stop(g.mid), stop(g.max)] : [stop(g.min), stop(g.max)]
    const ns = g.nullColoringStrategy
    const strategy = ns?.strategy ? String(decodeLiteral(ns.strategy.Literal?.Value)) : 'asZero'
    return {
      kind: 'gradient',
      input: e.FillRule.Input,
      stops,
      nullStrategy: strategy === 'specificColor' ? 'specificColor' : strategy === 'noColor' ? 'noColor' : 'asZero',
      nullColor: ns?.color ? colorFromExpr(ns.color, theme) : undefined
    }
  }
  if (e.Conditional) {
    const cases = (e.Conditional.Cases ?? []).map((c: any) => ({ condition: c.Condition, value: c.Value }))
    const inputs = [...conditionFields(cases.map((c: any) => c.condition)).values()]
    return { kind: 'rules', inputs, cases, defaultValue: e.Conditional.DefaultValue }
  }
  return undefined
}

/** SQ field expressions a rule needs evaluated per row. */
export function ruleInputs(rule: ColorRule | undefined): SQExpr[] {
  if (!rule) return []
  if (rule.kind === 'field' || rule.kind === 'gradient') return [rule.input]
  if (rule.kind === 'rules') return rule.inputs
  return []
}

/** Min/max of a gradient's input over instance rows. */
export function computeStats(values: Scalar[]): RuleStats {
  let min: number | undefined
  let max: number | undefined
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    if (min === undefined || v < min) min = v
    if (max === undefined || v > max) max = v
  }
  return { min, max }
}

export function mixColors(a: string, b: string, t: number): string {
  if (!a.startsWith('#') || !b.startsWith('#')) return t < 0.5 ? a : b
  const [r1, g1, b1] = parseHex(a)
  const [r2, g2, b2] = parseHex(b)
  const k = Math.max(0, Math.min(1, t))
  return toHex(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k)
}

/** Interpolate a gradient for a numeric value. */
export function gradientColor(stops: GradientStop[], value: number, stats: RuleStats): string {
  const lo = stops[0].value ?? stats.min ?? 0
  const hi = stops[stops.length - 1].value ?? stats.max ?? lo
  const positions = stops.map((s, i) => (s.value !== undefined ? s.value : i === 0 ? lo : i === stops.length - 1 ? hi : (lo + hi) / 2))
  if (value <= positions[0]) return stops[0].color
  if (value >= positions[positions.length - 1]) return stops[stops.length - 1].color
  for (let i = 0; i < positions.length - 1; i++) {
    const a = positions[i]
    const b = positions[i + 1]
    if (value >= a && value <= b) return mixColors(stops[i].color, stops[i + 1].color, b === a ? 0 : (value - a) / (b - a))
  }
  return stops[stops.length - 1].color
}

/** Resolve a rule to a value (color string, or icon name for icon rules). */
export function evalRuleValue(rule: ColorRule, get: FieldAccessor, stats: RuleStats, theme: ResolvedTheme): string | undefined {
  switch (rule.kind) {
    case 'literal':
      return rule.color
    case 'field': {
      const v = get(fieldKey(rule.input), rule.input)
      if (v === null || v === undefined || v === '') return undefined
      return colorToken(String(v), theme)
    }
    case 'gradient': {
      let v = evalScalar(rule.input, get)
      if (v === null || v === undefined) {
        if (rule.nullStrategy === 'noColor') return undefined
        if (rule.nullStrategy === 'specificColor') return rule.nullColor
        v = 0
      }
      if (typeof v !== 'number') return undefined
      return gradientColor(rule.stops, v, stats)
    }
    case 'rules': {
      for (const c of rule.cases) {
        if (evalCondition(c.condition, get)) return valueOf(c.value, theme)
      }
      return rule.defaultValue ? valueOf(rule.defaultValue, theme) : undefined
    }
  }
}

function valueOf(v: any, theme: ResolvedTheme): string | undefined {
  if (!v) return undefined
  const c = colorFromExpr(v, theme)
  return c
}

export function evalColorRule(rule: ColorRule | undefined, get: FieldAccessor, stats: RuleStats, theme: ResolvedTheme): string | undefined {
  return rule ? evalRuleValue(rule, get, stats, theme) : undefined
}

function scopeOf(selector: any): CFScope {
  const w = (selector?.data ?? []).find((d: any) => d?.dataViewWildcard)
  const m = w?.dataViewWildcard?.matchingOption
  return m === 1 ? 'instances' : m === 2 ? 'totals' : 'both'
}

function literalOf(v: any): any {
  if (v && typeof v === 'object' && v.expr?.Literal) return decodeLiteral(v.expr.Literal.Value)
  if (v && typeof v === 'object' && v.Literal) return decodeLiteral(v.Literal.Value)
  return v
}

function compileIcon(raw: any, theme: ResolvedTheme): IconRule | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const valueRaw = raw.value ?? raw.expr ?? raw
  const rule = compileColorRule(valueRaw.expr ? valueRaw : { expr: valueRaw }, theme)
  if (!rule) return undefined
  const layout = String(literalOf(raw.layout) ?? 'before').toLowerCase()
  const va = String(literalOf(raw.verticalAlignment) ?? 'top').toLowerCase()
  return {
    rule,
    layout: layout.includes('after') || layout.includes('right') ? 'after' : layout.includes('only') ? 'only' : 'before',
    verticalAlignment: va.includes('middle') || va.includes('center') ? 'middle' : va.includes('bottom') ? 'bottom' : 'top'
  }
}

function compileDataBars(raw: any, theme: ResolvedTheme): DataBarSpec {
  const num = (v: any) => {
    const x = literalOf(v)
    return typeof x === 'number' ? x : undefined
  }
  return {
    min: num(raw.minValue),
    max: num(raw.maxValue),
    positiveColor: colorFromExpr(raw.positiveColor, theme) ?? '#5B9BD5',
    negativeColor: colorFromExpr(raw.negativeColor, theme) ?? theme.bad,
    axisColor: colorFromExpr(raw.axisColor, theme) ?? theme.foreground,
    reverse: literalOf(raw.reverseDirection) === true,
    hideText: literalOf(raw.hideText) === true
  }
}

/**
 * Collect CF per column queryRef from `objects.values` (table/matrix cells) and `objects.columnFormatting` (data bars).
 * `objectName` lets cards reuse it (e.g. 'value' / 'labels').
 */
export function collectColumnCF(visualJson: any, theme: ResolvedTheme, objectNames: string[] = ['values']): Map<string, ColumnCF> {
  const out = new Map<string, ColumnCF>()
  const objects = visualJson?.visual?.objects ?? {}
  const get = (ref: string) => {
    let cf = out.get(ref)
    if (!cf) out.set(ref, (cf = {}))
    return cf
  }
  for (const name of objectNames) {
    for (const entry of objects[name] ?? []) {
      const ref = entry.selector?.metadata
      if (!ref) continue
      const scope = scopeOf(entry.selector)
      const p = entry.properties ?? {}
      for (const prop of ['backColor', 'fontColor'] as const) {
        if (!p[prop]) continue
        const rule = compileColorRule(p[prop], theme)
        if (rule) get(ref)[prop] = { rule, scope }
      }
      if (p.icon) {
        const icon = compileIcon(p.icon, theme)
        if (icon) get(ref).icon = { rule: icon, scope }
      }
      if (p.webURL) {
        const e = unwrapExpr(p.webURL)
        if (isField(e)) get(ref).webURL = { input: e, scope }
      }
    }
  }
  for (const entry of objects.columnFormatting ?? []) {
    const ref = entry.selector?.metadata
    const db = entry.properties?.dataBars
    if (!ref || !db) continue
    const tmo = literalOf(db.totalMatchingOption)
    get(ref).dataBars = { spec: compileDataBars(db, theme), scope: tmo === 1 ? 'instances' : tmo === 2 ? 'totals' : 'both' }
  }
  return out
}

export function scopeApplies(scope: CFScope, isTotal: boolean): boolean {
  return scope === 'both' || (scope === 'totals' ? isTotal : !isTotal)
}

/** All SQ inputs a set of column CFs needs, deduplicated by fieldKey. */
export function cfInputs(cfs: Iterable<ColumnCF>): SQExpr[] {
  const m = new Map<string, SQExpr>()
  for (const cf of cfs) {
    for (const e of [...ruleInputs(cf.backColor?.rule), ...ruleInputs(cf.fontColor?.rule), ...ruleInputs(cf.icon?.rule.rule), ...(cf.webURL ? [cf.webURL.input] : [])]) {
      m.set(fieldKey(e), e)
    }
  }
  return [...m.values()]
}

/**
 * Gradient inputs and data-bar fields whose min/max must cover the whole result (keyed by fieldKey):
 * gradient rule inputs of back/font color and icons, and the column's own field for data bars.
 */
export function rangeInputs(cfs: Iterable<{ cf?: ColumnCF; own: SQExpr }>): SQExpr[] {
  const m = new Map<string, SQExpr>()
  for (const { cf, own } of cfs) {
    if (!cf) continue
    for (const r of [cf.backColor?.rule, cf.fontColor?.rule, cf.icon?.rule.rule]) if (r?.kind === 'gradient') m.set(fieldKey(r.input), r.input)
    if (cf.dataBars) m.set(fieldKey(own), own)
  }
  return [...m.values()]
}

/**
 * Min/max of each input over EVERY group of the visual's grain, not only the loaded data window
 * (tables/matrices load 500 rows / 100 column groups at a time; Power BI computes gradient and data
 * bar ranges with a separate min/max query over the visual's grouping). One summarize over
 * `groupBy` with only the inputs as values; keyed by fieldKey of the input. Columns used as inputs
 * are evaluated as their Min per group (`toValue`). Errors yield an empty map (callers keep the
 * window's stats).
 */
export function fullRangeStats(
  engine: QueryEngine,
  groupBy: SQExpr[],
  filters: SQFilter[],
  inputs: SQExpr[],
  toValue: (e: SQExpr) => SQExpr = (e) => e
): Map<string, RuleStats> {
  const out = new Map<string, RuleStats>()
  if (!inputs.length) return out
  try {
    const r = engine.summarize({
      groupBy: groupBy.map((expr) => ({ kind: 'sq' as const, expr })),
      values: inputs.map((e, i) => ({ id: `range${i}`, expr: { kind: 'sq' as const, expr: toValue(e) } })),
      filters
    })
    const g = groupBy.length
    inputs.forEach((e, i) => out.set(fieldKey(e), computeStats(r.rows.map((row) => row[g + i] ?? null))))
  } catch {
    // keep the window's stats
  }
  return out
}

/** Data bar geometry for a value: returns fractions of the cell width. */
export function dataBarGeometry(value: number, spec: DataBarSpec, stats: RuleStats): { start: number; width: number; axis?: number; negative: boolean } {
  const lo = Math.min(spec.min ?? Math.min(stats.min ?? 0, 0), 0)
  const hi = Math.max(spec.max ?? stats.max ?? 0, 0)
  const span = hi - lo || 1
  const zero = (0 - lo) / span
  const pos = (Math.max(lo, Math.min(hi, value)) - lo) / span
  const start = Math.min(zero, pos)
  const width = Math.abs(pos - zero)
  const geo = { start, width, axis: lo < 0 ? zero : undefined, negative: value < 0 }
  if (spec.reverse) return { ...geo, start: 1 - start - width, axis: geo.axis !== undefined ? 1 - geo.axis : undefined }
  return geo
}
