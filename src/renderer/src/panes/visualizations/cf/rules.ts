/**
 * Conditional formatting (fx) — pure editor model ⇄ PBIR expression builders.
 *
 * PBIR shapes written (same as Power BI Desktop):
 *   Field value  { solid: { color: { expr: <Measure | Aggregation{Column} | Column> } } }   (text props: { expr: … })
 *   Gradient     { solid: { color: { expr: { FillRule: { Input, FillRule: { linearGradient2|3: {
 *                    min: { color: {Literal}, value?: {Literal} }, mid?, max, nullColoringStrategy: { strategy: {Literal}, color? } } } } } } } }
 *   Rules        { solid: { color: { expr: { Conditional: { Cases: [{ Condition, Value: {Literal} }], DefaultValue? } } } } }
 *                Condition = Comparison{ComparisonKind, Left, Right} | And{Left, Right} | Not{Expression} | Contains/StartsWith/EndsWith
 *   Icons        { kind: 'Icon', layout: {expr:{Literal}}, verticalAlignment: {expr:{Literal}}, value: { expr: Conditional | Measure } }
 *   Data bars    columnFormatting[selector.metadata].dataBars = { minValue?, maxValue?, positiveColor, negativeColor, axisColor,
 *                  reverseDirection, hideText, totalMatchingOption }
 *   Scope        selector { data: [{ dataViewWildcard: { matchingOption: 0 values+totals | 1 values only | 2 totals only } }], metadata? }
 *
 * Parsing is lossless: everything the editor doesn't model is kept (`extra`, literal text, `raw`) so
 * re-serializing an unedited value yields deep-equal JSON. Shapes the editor can't represent parse to
 * `{ style: 'raw' }` and are written back untouched.
 *
 * Not supported (yet): "Percent" / "Percentile" bound types for gradients and rules. Power BI encodes
 * them with visual-level aggregate expressions that Lumen's CF evaluators don't compute, so the dialog
 * offers Lowest / Highest / Middle / Number only rather than writing values that would render wrong.
 */
import type { Scalar } from '@core/model/data'
import { decodeLiteral } from '@core/report/literal'
import { fieldInfo, SQ_AGG, type SQExpr } from '@core/report/sq'
import type { Selector } from '@core/report/props'
import { entryGroupKey } from '@core/report/entries'

// ---------------------------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------------------------

/** A color inside a rule: a literal string (hex or theme token such as 'minColor') or a theme color. */
export type CFColor = string | { theme: { ColorId: number; Percent?: number } }

/** The field a rule is based on. `aggregation` set → `Aggregation { Expression: field, Function }`. */
export interface CFInput {
  field: SQExpr
  aggregation?: number
}

export type CFStyle = 'gradient' | 'rules' | 'fieldValue'

/** Stable JSON (sorted keys at every level) for structural comparisons. */
export function stableKey(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined'
  if (Array.isArray(v)) return `[${v.map(stableKey).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableKey(o[k])}`)
    .join(',')}}`
}

export function inputFromExpr(e: SQExpr): CFInput {
  if (e?.Aggregation && e.Aggregation.Expression && typeof e.Aggregation.Function === 'number' && Object.keys(e).length === 1 && Object.keys(e.Aggregation).length === 2) {
    return { field: e.Aggregation.Expression, aggregation: e.Aggregation.Function }
  }
  return { field: e }
}

export function inputToExpr(i: CFInput): SQExpr {
  return i.aggregation !== undefined ? { Aggregation: { Expression: i.field, Function: i.aggregation } } : i.field
}

export function sameInput(a: CFInput | undefined, b: CFInput | undefined): boolean {
  return !!a && !!b && stableKey(inputToExpr(a)) === stableKey(inputToExpr(b))
}

function isFieldExpr(e: any): boolean {
  return !!(e && typeof e === 'object' && (e.Measure || e.Aggregation || e.Column || e.HierarchyLevel))
}

/** Human label for an input ("Sales Amount", "First Product Name"). */
export function inputLabel(i: CFInput | undefined): string {
  if (!i) return ''
  const f = fieldInfo(i.field)
  const name = f.property ?? f.level ?? ''
  if (i.aggregation === undefined) return name
  return `${SUMMARIZATIONS.find((s) => s.fn === i.aggregation)?.label ?? 'Sum'} of ${name}`
}

/** Summarization choices (PBI CF dialog). Text columns use First (=Min) / Last (=Max) / Count / Count (Distinct). */
export const SUMMARIZATIONS: Array<{ fn: number; label: string; numeric: boolean; text: boolean }> = [
  { fn: SQ_AGG.Sum, label: 'Sum', numeric: true, text: false },
  { fn: SQ_AGG.Avg, label: 'Average', numeric: true, text: false },
  { fn: SQ_AGG.Min, label: 'Minimum', numeric: true, text: false },
  { fn: SQ_AGG.Max, label: 'Maximum', numeric: true, text: false },
  { fn: SQ_AGG.CountNonNull, label: 'Count', numeric: true, text: true },
  { fn: SQ_AGG.Count, label: 'Count (Distinct)', numeric: true, text: true },
  { fn: SQ_AGG.Median, label: 'Median', numeric: true, text: false },
  { fn: SQ_AGG.StandardDeviation, label: 'Standard deviation', numeric: true, text: false },
  { fn: SQ_AGG.Variance, label: 'Variance', numeric: true, text: false }
]
/** Text summarizations: SQ has no First/Last — PBI writes Min (First) / Max (Last). */
export const TEXT_SUMMARIZATIONS: Array<{ fn: number; label: string }> = [
  { fn: SQ_AGG.Min, label: 'First' },
  { fn: SQ_AGG.Max, label: 'Last' },
  { fn: SQ_AGG.CountNonNull, label: 'Count' },
  { fn: SQ_AGG.Count, label: 'Count (Distinct)' }
]

// ---------------------------------------------------------------------------------------------
// Literals / colors
// ---------------------------------------------------------------------------------------------

function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/** Number literal as PBI writes it in CF (`12D`, `0.75D`), keeping the original text when unchanged. */
export function numberLiteral(n: number, original?: string): string {
  if (original !== undefined && decodeLiteral(original) === n) return original
  return `${n}D`
}

function literalNode(text: string, wrapped: boolean): any {
  const lit = { Literal: { Value: text } }
  return wrapped ? { expr: lit } : lit
}

function unwrap(node: any): any {
  return node && typeof node === 'object' && node.expr && Object.keys(node).length === 1 ? node.expr : node
}

function parseColorNode(node: any): CFColor | undefined {
  const n = unwrap(node)
  if (n?.Literal && typeof n.Literal.Value === 'string') {
    const v = decodeLiteral(n.Literal.Value)
    return typeof v === 'string' ? v : undefined
  }
  if (n?.ThemeDataColor && typeof n.ThemeDataColor.ColorId === 'number') return { theme: { ...n.ThemeDataColor } }
  return undefined
}

export function colorNode(c: CFColor, wrapped = false): any {
  const node = typeof c === 'string' ? { Literal: { Value: quote(c) } } : { ThemeDataColor: { ...c.theme } }
  return wrapped ? { expr: node } : node
}

/** Wrapped solid color property value (`{ solid: { color: { expr } } }`). */
export function solidColor(c: CFColor): any {
  return { solid: { color: colorNode(c, true) } }
}

function parseSolidColor(raw: any): CFColor | undefined {
  return raw?.solid?.color !== undefined ? parseColorNode(raw.solid.color) : undefined
}

function literalBool(raw: any): boolean | undefined {
  const v = unwrap(raw)?.Literal?.Value
  return v === 'true' ? true : v === 'false' ? false : undefined
}

function literalNumber(raw: any): { value: number; literal: string } | undefined {
  const t = unwrap(raw)?.Literal?.Value
  if (typeof t !== 'string') return undefined
  const v = decodeLiteral(t)
  return typeof v === 'number' ? { value: v, literal: t } : undefined
}

// ---------------------------------------------------------------------------------------------
// Gradient
// ---------------------------------------------------------------------------------------------

export type StopKind = 'lowest' | 'highest' | 'middle' | 'number' | 'custom'

export interface GradientStop {
  kind: StopKind
  value?: number
  /** original literal text of `value` (round-trip) */
  literal?: string
  /** `value` node we don't model (kind 'custom'), kept as-is */
  rawValue?: any
  color: CFColor
  /** other keys of the stop object, kept as-is */
  extra?: Record<string, any>
}

export type NullStrategy = 'asZero' | 'specificColor' | 'noColor'

export interface GradientModel {
  style: 'gradient'
  input: CFInput
  min: GradientStop
  mid?: GradientStop
  max: GradientStop
  nullStrategy: NullStrategy
  nullColor?: CFColor
  /** nullColoringStrategy absent in the source (PBI then treats blanks as zero) */
  nullOmitted?: boolean
  /** literals inside the FillRule are `{ expr: { Literal } }` (standalone `fillRule` props) instead of `{ Literal }` */
  wrapped?: boolean
  /** unknown keys of the linearGradient object */
  extra?: Record<string, any>
}

function parseStop(node: any, position: 'min' | 'mid' | 'max'): GradientStop | undefined {
  if (!node || typeof node !== 'object') return undefined
  const color = parseColorNode(node.color)
  if (color === undefined) return undefined
  const { color: _c, value, ...extra } = node
  const stop: GradientStop = { kind: position === 'min' ? 'lowest' : position === 'max' ? 'highest' : 'middle', color }
  if (value !== undefined) {
    const n = literalNumber(value)
    if (n) Object.assign(stop, { kind: 'number', value: n.value, literal: n.literal })
    else Object.assign(stop, { kind: 'custom', rawValue: value })
  }
  if (Object.keys(extra).length) stop.extra = extra
  return stop
}

function stopNode(s: GradientStop, wrapped: boolean): any {
  const out: any = { color: colorNode(s.color, wrapped) }
  if (s.kind === 'number' && s.value !== undefined && Number.isFinite(s.value)) out.value = literalNode(numberLiteral(s.value, s.literal), wrapped)
  else if (s.kind === 'custom' && s.rawValue !== undefined) out.value = s.rawValue
  return { ...out, ...(s.extra ?? {}) }
}

function parseGradient(fillRuleExpr: any): GradientModel | undefined {
  const input = fillRuleExpr?.Input
  const body = fillRuleExpr?.FillRule
  if (!isFieldExpr(input) || !body || typeof body !== 'object') return undefined
  const keys = Object.keys(fillRuleExpr)
  if (keys.some((k) => k !== 'Input' && k !== 'FillRule')) return undefined
  const three = body.linearGradient3
  const g = three ?? body.linearGradient2
  if (!g || Object.keys(body).length !== 1) return undefined
  const { min, mid, max, nullColoringStrategy, ...extra } = g
  const wrapped = !!(min?.color?.expr && !min.color.Literal)
  const pMin = parseStop(min, 'min')
  const pMax = parseStop(max, 'max')
  const pMid = three ? parseStop(mid, 'mid') : undefined
  if (!pMin || !pMax || (three && !pMid)) return undefined
  const m: GradientModel = { style: 'gradient', input: inputFromExpr(input), min: pMin, max: pMax, nullStrategy: 'asZero' }
  if (pMid) m.mid = pMid
  if (wrapped) m.wrapped = true
  if (Object.keys(extra).length) m.extra = extra
  if (!nullColoringStrategy) m.nullOmitted = true
  else {
    const { strategy, color, ...rest } = nullColoringStrategy
    if (Object.keys(rest).length) return undefined
    const s = decodeLiteral(unwrap(strategy)?.Literal?.Value)
    if (s !== 'asZero' && s !== 'specificColor' && s !== 'noColor') return undefined
    m.nullStrategy = s
    if (color !== undefined) {
      const c = parseColorNode(color)
      if (c === undefined) return undefined
      m.nullColor = c
    }
  }
  return m
}

function gradientExpr(m: GradientModel): any {
  const w = !!m.wrapped
  const g: any = { min: stopNode(m.min, w) }
  if (m.mid) g.mid = stopNode(m.mid, w)
  g.max = stopNode(m.max, w)
  if (!(m.nullOmitted && m.nullStrategy === 'asZero')) {
    g.nullColoringStrategy = { strategy: literalNode(quote(m.nullStrategy), w) }
    if (m.nullStrategy === 'specificColor' && m.nullColor !== undefined) g.nullColoringStrategy.color = colorNode(m.nullColor, w)
  }
  Object.assign(g, m.extra ?? {})
  return { FillRule: { Input: inputToExpr(m.input), FillRule: { [m.mid ? 'linearGradient3' : 'linearGradient2']: g } } }
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

export type RuleOp = 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'blank' | 'notBlank' | 'contains' | 'notContains' | 'startsWith' | 'notStartsWith' | 'endsWith' | 'notEndsWith'

export const RULE_OPS: Array<{ op: RuleOp; label: string; numeric: boolean; text: boolean; noValue?: boolean }> = [
  { op: 'eq', label: 'is', numeric: true, text: true },
  { op: 'ne', label: 'is not', numeric: true, text: true },
  { op: 'gt', label: 'is greater than', numeric: true, text: false },
  { op: 'ge', label: 'is greater than or equal to', numeric: true, text: false },
  { op: 'lt', label: 'is less than', numeric: true, text: false },
  { op: 'le', label: 'is less than or equal to', numeric: true, text: false },
  { op: 'blank', label: 'is blank', numeric: true, text: true, noValue: true },
  { op: 'notBlank', label: 'is not blank', numeric: true, text: true, noValue: true },
  { op: 'contains', label: 'contains', numeric: false, text: true },
  { op: 'notContains', label: 'does not contain', numeric: false, text: true },
  { op: 'startsWith', label: 'starts with', numeric: false, text: true },
  { op: 'notStartsWith', label: 'does not start with', numeric: false, text: true },
  { op: 'endsWith', label: 'ends with', numeric: false, text: true },
  { op: 'notEndsWith', label: 'does not end with', numeric: false, text: true }
]
/** Ops allowed as the second ("and …") bound — PBI only offers the upper bound comparisons. */
export const SECOND_OPS: RuleOp[] = ['lt', 'le']

const KIND_OF: Partial<Record<RuleOp, number>> = { eq: 0, gt: 1, ge: 2, lt: 3, le: 4 }
const OP_OF_KIND: RuleOp[] = ['eq', 'gt', 'ge', 'lt', 'le']
const TEXT_NODE: Partial<Record<RuleOp, string>> = { contains: 'Contains', startsWith: 'StartsWith', endsWith: 'EndsWith' }
const NEGATED: Partial<Record<RuleOp, RuleOp>> = { eq: 'ne', blank: 'notBlank', contains: 'notContains', startsWith: 'notStartsWith', endsWith: 'notEndsWith' }

export interface RuleBound {
  op: RuleOp
  value?: Scalar
  /** original literal text (round-trip) */
  literal?: string
}

export interface RuleRow {
  first: RuleBound
  second?: RuleBound
  /** color (color rules) or icon name (icon rules) */
  value: CFColor
}

export interface RulesModel {
  style: 'rules'
  input: CFInput
  rules: RuleRow[]
  /** Conditional.DefaultValue, kept as-is */
  defaultValue?: any
}

function sameScalar(a: Scalar | undefined, b: Scalar | undefined): boolean {
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  return a === b
}

function boundLiteral(b: RuleBound): any {
  if (b.op === 'blank' || b.op === 'notBlank') return { Literal: { Value: 'null' } }
  const v = b.value
  if (b.literal !== undefined && sameScalar(decodeLiteral(b.literal), v)) return { Literal: { Value: b.literal } }
  if (typeof v === 'number') return { Literal: { Value: numberLiteral(v) } }
  if (typeof v === 'boolean') return { Literal: { Value: String(v) } }
  return { Literal: { Value: quote(v === null || v === undefined ? '' : String(v)) } }
}

function boundCondition(b: RuleBound, left: SQExpr): any {
  const neg = (Object.keys(NEGATED) as RuleOp[]).find((k) => NEGATED[k] === b.op)
  if (neg) return { Not: { Expression: boundCondition({ ...b, op: neg }, left) } }
  if (b.op === 'blank') return { Comparison: { ComparisonKind: 0, Left: left, Right: boundLiteral(b) } }
  const t = TEXT_NODE[b.op]
  if (t) return { [t]: { Left: left, Right: boundLiteral(b) } }
  return { Comparison: { ComparisonKind: KIND_OF[b.op] ?? 0, Left: left, Right: boundLiteral(b) } }
}

/** Parse one simple condition → bound + its left expression. */
function parseBound(c: any): { bound: RuleBound; left: SQExpr } | undefined {
  if (!c || typeof c !== 'object' || Object.keys(c).length !== 1) return undefined
  if (c.Not) {
    if (Object.keys(c.Not).length !== 1) return undefined
    const inner = parseBound(c.Not.Expression)
    const neg = inner && NEGATED[inner.bound.op]
    return inner && neg ? { bound: { ...inner.bound, op: neg }, left: inner.left } : undefined
  }
  const node = c.Comparison ?? c.Contains ?? c.StartsWith ?? c.EndsWith
  if (!node || !isFieldExpr(node.Left) || !node.Right?.Literal || typeof node.Right.Literal.Value !== 'string') return undefined
  const allowed = c.Comparison ? ['ComparisonKind', 'Left', 'Right'] : ['Left', 'Right']
  if (Object.keys(node).some((k) => !allowed.includes(k)) || Object.keys(node.Right).length !== 1) return undefined
  const literal: string = node.Right.Literal.Value
  const value = decodeLiteral(literal)
  if (c.Comparison) {
    const kind = node.ComparisonKind
    if (typeof kind !== 'number' || !OP_OF_KIND[kind]) return undefined
    if (kind === 0 && literal === 'null') return { bound: { op: 'blank' }, left: node.Left }
    return { bound: { op: OP_OF_KIND[kind], value, literal }, left: node.Left }
  }
  const op: RuleOp = c.Contains ? 'contains' : c.StartsWith ? 'startsWith' : 'endsWith'
  return { bound: { op, value, literal }, left: node.Left }
}

function parseRules(cond: any): RulesModel | undefined {
  const keys = Object.keys(cond ?? {})
  if (keys.some((k) => k !== 'Cases' && k !== 'DefaultValue')) return undefined
  const cases: any[] = cond.Cases
  if (!Array.isArray(cases) || !cases.length) return undefined
  let left: SQExpr | undefined
  const rules: RuleRow[] = []
  for (const cs of cases) {
    if (!cs || Object.keys(cs).some((k) => k !== 'Condition' && k !== 'Value')) return undefined
    const value = parseColorNode(cs.Value)
    if (value === undefined) return undefined
    const c = cs.Condition
    let first: { bound: RuleBound; left: SQExpr } | undefined
    let second: { bound: RuleBound; left: SQExpr } | undefined
    if (c?.And && Object.keys(c).length === 1 && Object.keys(c.And).length === 2) {
      first = parseBound(c.And.Left)
      second = parseBound(c.And.Right)
      if (!first || !second || !SECOND_OPS.includes(second.bound.op) || stableKey(first.left) !== stableKey(second.left)) return undefined
    } else {
      first = parseBound(c)
      if (!first) return undefined
    }
    if (left === undefined) left = first.left
    else if (stableKey(left) !== stableKey(first.left)) return undefined
    rules.push({ first: first.bound, ...(second ? { second: second.bound } : {}), value })
  }
  const m: RulesModel = { style: 'rules', input: inputFromExpr(left), rules }
  if (cond.DefaultValue !== undefined) m.defaultValue = cond.DefaultValue
  return m
}

function rulesExpr(m: RulesModel): any {
  const left = inputToExpr(m.input)
  const Cases = m.rules.map((r) => {
    const a = boundCondition(r.first, left)
    const Condition = r.second ? { And: { Left: a, Right: boundCondition(r.second, left) } } : a
    return { Condition, Value: colorNode(r.value) }
  })
  return { Conditional: { Cases, ...(m.defaultValue !== undefined ? { DefaultValue: m.defaultValue } : {}) } }
}

/** "Reverse order": keep the conditions, reverse which color / icon each rule gets (PBI behavior). */
export function reverseRuleValues(rules: RuleRow[]): RuleRow[] {
  const values = rules.map((r) => r.value).reverse()
  return rules.map((r, i) => ({ ...r, value: values[i] }))
}

// ---------------------------------------------------------------------------------------------
// Top-level color / text values
// ---------------------------------------------------------------------------------------------

export interface FieldValueModel {
  style: 'fieldValue'
  input: CFInput
}

export interface RawModel {
  style: 'raw'
  raw: any
}

export type CFModel = GradientModel | RulesModel | FieldValueModel

export interface ParsedCF {
  /** `solid` = color property ({ solid: { color: { expr } } }); `expr` = text/url property ({ expr }) */
  wrap: 'solid' | 'expr'
  model: CFModel | RawModel
}

/** Parse a data-bound property value. Returns undefined when the value is static (literal / theme color). */
export function parseCF(raw: any): ParsedCF | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  let wrap: ParsedCF['wrap']
  let expr: any
  if (raw.solid?.color?.expr && Object.keys(raw).length === 1 && Object.keys(raw.solid).length === 1 && Object.keys(raw.solid.color).length === 1) {
    wrap = 'solid'
    expr = raw.solid.color.expr
  } else if (raw.expr && Object.keys(raw).length === 1) {
    wrap = 'expr'
    expr = raw.expr
  } else return undefined
  // only data-bound expressions are conditional formatting (literals, theme colors, resources… are static)
  if (!expr || typeof expr !== 'object' || !(expr.FillRule || expr.Conditional || expr.SelectRef || isFieldExpr(expr))) return undefined
  let model: CFModel | undefined
  if (expr.FillRule && Object.keys(expr).length === 1) model = parseGradient(expr.FillRule)
  else if (expr.Conditional && Object.keys(expr).length === 1) model = parseRules(expr.Conditional)
  else if (isFieldExpr(expr)) model = { style: 'fieldValue', input: inputFromExpr(expr) }
  return { wrap, model: model ?? { style: 'raw', raw } }
}

export function modelExpr(m: CFModel): any {
  switch (m.style) {
    case 'gradient':
      return gradientExpr(m)
    case 'rules':
      return rulesExpr(m)
    case 'fieldValue':
      return inputToExpr(m.input)
  }
}

export function serializeCF(parsed: ParsedCF): any {
  if (parsed.model.style === 'raw') return parsed.model.raw
  const expr = modelExpr(parsed.model)
  return parsed.wrap === 'solid' ? { solid: { color: { expr } } } : { expr }
}

// ---------------------------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------------------------

export type IconLayout = 'Before' | 'After' | 'IconOnly'
export type IconAlign = 'Top' | 'Middle' | 'Bottom'

export interface IconsModel {
  layout: string
  verticalAlignment: string
  rule: RulesModel | FieldValueModel
  /** `kind` literal (PBI writes 'Icon') */
  kind?: string
  /** layout / verticalAlignment absent in the source */
  layoutOmitted?: boolean
  alignOmitted?: boolean
  extra?: Record<string, any>
}

export function parseIcons(raw: any): IconsModel | undefined {
  if (!raw || typeof raw !== 'object' || !raw.value) return undefined
  const { kind, layout, verticalAlignment, value, ...extra } = raw
  const expr = unwrap(value)
  let rule: RulesModel | FieldValueModel | undefined
  if (expr?.Conditional && Object.keys(expr).length === 1) rule = parseRules(expr.Conditional)
  else if (isFieldExpr(expr)) rule = { style: 'fieldValue', input: inputFromExpr(expr) }
  if (!rule || !(value.expr && Object.keys(value).length === 1)) return undefined
  const lay = layout === undefined ? undefined : decodeLiteral(unwrap(layout)?.Literal?.Value)
  const va = verticalAlignment === undefined ? undefined : decodeLiteral(unwrap(verticalAlignment)?.Literal?.Value)
  if ((layout !== undefined && typeof lay !== 'string') || (verticalAlignment !== undefined && typeof va !== 'string')) return undefined
  const m: IconsModel = { layout: (lay as string) ?? 'Before', verticalAlignment: (va as string) ?? 'Top', rule }
  if (kind !== undefined) m.kind = kind
  if (layout === undefined) m.layoutOmitted = true
  if (verticalAlignment === undefined) m.alignOmitted = true
  if (Object.keys(extra).length) m.extra = extra
  return m
}

export function serializeIcons(m: IconsModel): any {
  const out: any = {}
  if (m.kind !== undefined) out.kind = m.kind
  if (!m.layoutOmitted) out.layout = { expr: { Literal: { Value: quote(m.layout) } } }
  if (!m.alignOmitted) out.verticalAlignment = { expr: { Literal: { Value: quote(m.verticalAlignment) } } }
  out.value = { expr: modelExpr(m.rule) }
  return { ...out, ...(m.extra ?? {}) }
}

/** Icon style sets offered by the dialog (names resolvable by the table renderer's icon resolver). */
export const ICON_SETS: Array<{ id: string; label: string; icons: string[] }> = [
  { id: 'arrows', label: '3 arrows (colored)', icons: ['ArrowUpGreen', 'ArrowRightYellow', 'ArrowDownRed'] },
  { id: 'arrowsGray', label: '3 arrows (gray)', icons: ['ArrowUpGray', 'ArrowRightGray', 'ArrowDownGray'] },
  { id: 'triangles', label: '3 triangles', icons: ['TriangleUpGreen', 'TriangleSideYellow', 'TriangleDownRed'] },
  { id: 'lights', label: '3 traffic lights', icons: ['CircleGreen', 'CircleYellow', 'CircleRed'] },
  { id: 'signs', label: '3 signs', icons: ['CircleGreen', 'TriangleYellow', 'DiamondRed'] },
  { id: 'symbols', label: '3 symbols', icons: ['CheckGreen', 'ExclamationYellow', 'XRed'] },
  { id: 'flags', label: '3 flags', icons: ['FlagGreen', 'FlagYellow', 'FlagRed'] },
  { id: 'stars', label: '3 stars', icons: ['StarFull', 'StarHalf', 'StarEmpty'] },
  { id: 'quarters', label: '5 quarters', icons: ['Quarters4', 'Quarters3', 'Quarters2', 'Quarters1', 'Quarters0'] },
  { id: 'bars', label: '4 bars', icons: ['Bars4', 'Bars3', 'Bars2', 'Bars1'] }
]

/** All known icon names (style sets + any extra names, e.g. from an opened report). */
export function iconChoices(extra: string[] = []): string[] {
  const set = new Set<string>()
  for (const s of ICON_SETS) for (const i of s.icons) set.add(i)
  for (const e of extra) set.add(e)
  return [...set]
}

// ---------------------------------------------------------------------------------------------
// Data bars
// ---------------------------------------------------------------------------------------------

export interface DataBarsModel {
  /** undefined = Lowest value */
  min?: { value: number; literal?: string }
  /** undefined = Highest value */
  max?: { value: number; literal?: string }
  positiveColor: CFColor
  negativeColor: CFColor
  axisColor: CFColor
  /** undefined = property absent (renders as false) */
  reverse?: boolean
  /** "Show bar only" */
  hideText?: boolean
  /** 0 values+totals · 1 values only · 2 totals only (undefined = absent) */
  totalMatchingOption?: number
  totalLiteral?: string
  extra?: Record<string, any>
  /** color props absent in the source */
  omitted?: string[]
}

const DB_KEYS = ['minValue', 'maxValue', 'positiveColor', 'negativeColor', 'axisColor', 'reverseDirection', 'hideText', 'totalMatchingOption']

export function parseDataBars(raw: any): DataBarsModel | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const extra: Record<string, any> = {}
  for (const k of Object.keys(raw)) if (!DB_KEYS.includes(k)) extra[k] = raw[k]
  const m: DataBarsModel = { positiveColor: '#5B9BD5', negativeColor: 'minColor', axisColor: 'foreground' }
  const omitted: string[] = []
  for (const k of ['positiveColor', 'negativeColor', 'axisColor'] as const) {
    if (raw[k] === undefined) {
      omitted.push(k)
      continue
    }
    const c = parseSolidColor(raw[k])
    if (c === undefined) return undefined
    m[k] = c
  }
  if (omitted.length) m.omitted = omitted
  for (const k of ['minValue', 'maxValue'] as const) {
    if (raw[k] === undefined) continue
    const n = literalNumber(raw[k])
    if (!n) return undefined
    m[k === 'minValue' ? 'min' : 'max'] = n
  }
  if (raw.reverseDirection !== undefined) {
    const b = literalBool(raw.reverseDirection)
    if (b === undefined) return undefined
    m.reverse = b
  }
  if (raw.hideText !== undefined) {
    const b = literalBool(raw.hideText)
    if (b === undefined) return undefined
    m.hideText = b
  }
  if (raw.totalMatchingOption !== undefined) {
    const n = literalNumber(raw.totalMatchingOption)
    if (!n) return undefined
    m.totalMatchingOption = n.value
    m.totalLiteral = n.literal
  }
  if (Object.keys(extra).length) m.extra = extra
  return m
}

export function serializeDataBars(m: DataBarsModel): any {
  const out: any = {}
  const lit = (t: string) => ({ expr: { Literal: { Value: t } } })
  if (m.min) out.minValue = lit(numberLiteral(m.min.value, m.min.literal))
  if (m.max) out.maxValue = lit(numberLiteral(m.max.value, m.max.literal))
  for (const k of ['positiveColor', 'negativeColor', 'axisColor'] as const) if (!m.omitted?.includes(k)) out[k] = solidColor(m[k])
  if (m.reverse !== undefined) out.reverseDirection = lit(String(m.reverse))
  if (m.hideText !== undefined) out.hideText = lit(String(m.hideText))
  if (m.totalMatchingOption !== undefined) {
    const t = m.totalLiteral !== undefined && decodeLiteral(m.totalLiteral) === m.totalMatchingOption ? m.totalLiteral : `${m.totalMatchingOption}L`
    out.totalMatchingOption = lit(t)
  }
  return { ...out, ...(m.extra ?? {}) }
}

// ---------------------------------------------------------------------------------------------
// Scope selectors ("Apply to")
// ---------------------------------------------------------------------------------------------

export type ApplyTo = 'valuesAndTotals' | 'values' | 'totals'
export const APPLY_TO: Array<{ value: ApplyTo; label: string; matchingOption: number }> = [
  { value: 'values', label: 'Values only', matchingOption: 1 },
  { value: 'valuesAndTotals', label: 'Values and totals', matchingOption: 0 },
  { value: 'totals', label: 'Totals only', matchingOption: 2 }
]

export function applyToOf(selector: Selector | undefined): ApplyTo {
  const w = (selector?.data ?? []).find((d: any) => d?.dataViewWildcard)
  const m = w?.dataViewWildcard?.matchingOption
  return m === 1 ? 'values' : m === 2 ? 'totals' : 'valuesAndTotals'
}

export function matchingOptionOf(a: ApplyTo): number {
  return APPLY_TO.find((x) => x.value === a)?.matchingOption ?? 1
}

/** Selector of a CF entry: `{ data: [dataViewWildcard], metadata? }` (PBI key order). */
export function cfSelector(base: Selector | undefined, applyTo: ApplyTo = 'values'): Selector {
  const out: Selector = { data: [{ dataViewWildcard: { matchingOption: matchingOptionOf(applyTo) } }] }
  for (const [k, v] of Object.entries(base ?? {})) if (k !== 'data') out[k] = v
  return out
}

/** Does an entry selector belong to the same CF target as `base` (ignoring the wildcard / matching option)? */
export function sameTargetSelector(entry: Selector | undefined, base: Selector | undefined): boolean {
  const strip = (s: Selector | undefined) => {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(s ?? {})) {
      if (k === 'data') {
        const rest = (v as any[]).filter((d) => !d?.dataViewWildcard)
        if (rest.length) o.data = rest
      } else o[k] = v
    }
    // `id: 'default'` names the default instance (core/report/entries.ts)
    return entryGroupKey(o)
  }
  return strip(entry) === strip(base)
}

// ---------------------------------------------------------------------------------------------
// Defaults / descriptions
// ---------------------------------------------------------------------------------------------

export function defaultGradient(input: CFInput): GradientModel {
  return { style: 'gradient', input, min: { kind: 'lowest', color: 'minColor' }, max: { kind: 'highest', color: 'maxColor' }, nullStrategy: 'asZero' }
}

/** PBI's initial three-band rules (thresholds editable; Lumen writes them as numbers). */
export function defaultRules(input: CFInput, values: CFColor[]): RulesModel {
  const bands: Array<[number, number, RuleOp]> = [
    [0, 33, 'lt'],
    [33, 67, 'lt'],
    [67, 100, 'le']
  ]
  return {
    style: 'rules',
    input,
    rules: bands.slice(0, values.length).map(([lo, hi, op], i) => ({ first: { op: 'ge', value: lo }, second: { op, value: hi }, value: values[i] }))
  }
}

/** Rules for an icon set, one band per icon (high values get the first icon, like PBI). */
export function defaultIconRules(input: CFInput, icons: string[]): RulesModel {
  const n = icons.length
  const rules: RuleRow[] = icons.map((icon, i) => {
    const hi = Math.round(((n - i) / n) * 100)
    const lo = Math.round(((n - i - 1) / n) * 100)
    return { first: { op: 'ge', value: lo }, second: { op: i === 0 ? 'le' : 'lt', value: hi }, value: icon }
  })
  return { style: 'rules', input, rules }
}

export function defaultDataBars(positive: CFColor): DataBarsModel {
  return { positiveColor: positive, negativeColor: 'minColor', axisColor: 'foreground', reverse: false, hideText: false }
}

export function describeModel(m: CFModel | RawModel | undefined): string {
  if (!m) return ''
  if (m.style === 'raw') return 'Conditional formatting'
  const style = m.style === 'gradient' ? 'Gradient' : m.style === 'rules' ? 'Rules' : 'Field value'
  const f = inputLabel(m.input)
  return f ? `${style} · ${f}` : style
}
