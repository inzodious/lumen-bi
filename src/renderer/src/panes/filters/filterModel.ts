/**
 * Filter pane model (pure — unit-tested in filterModel.test.ts).
 *
 * Converts between the Filters pane UI state (basic / advanced / Top N / relative date) and the PBIR
 * filter card JSON (`filterConfig.filters[]`), using the SQ shapes Power BI Desktop writes:
 *
 *   Categorical   In { Expressions:[col], Values:[[Literal]…] }  (inverted selection: Not(In) + objects.general isInvertedSelectionMode)
 *   Advanced      Comparison / Contains / StartsWith / Not(...) combined with And / Or; blanks compare to Literal null;
 *                 date operands are DateSpan { Literal datetime, TimeUnit: 5 } like PBI writes for date columns
 *   TopN          From: subquery (Select field, OrderBy measure Direction 2 = Top / 1 = Bottom, Top N) + In { Table: subquery }
 *   RelativeDate  Between { LowerBound: DateSpan(DateAdd(...Now...)), UpperBound: DateSpan(...) }
 *
 * SQ TimeUnit: 0 Day, 1 Week, 2 Month, 3 Year (DateSpan TimeUnit 5 is used for datetime comparisons).
 */
import type { Scalar } from '@core/model/data'
import { aliasesOf, entityOf, fieldInfo, fieldKey, literalExpr, normalizeExpr, SQ_AGG_NAMES, type SQExpr, type SQFilter } from '@core/report/sq'
import { decodeLiteral } from '@core/report/literal'
import type { FilterCard } from '../../report/pbir'

// ---------------------------------------------------------------------------------------------
// UI model
// ---------------------------------------------------------------------------------------------

export interface BasicModel {
  kind: 'basic'
  /** selected values (or excluded values when `inverted`) */
  values: Scalar[]
  /** "Select all" then unchecking: values are the exclusions */
  inverted: boolean
  requireSingleSelection: boolean
}

export type AdvancedOp =
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'notStartsWith'
  | 'is'
  | 'isNot'
  | 'isBlank'
  | 'isNotBlank'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'lt'
  | 'le'
  | 'gt'
  | 'ge'

export interface AdvancedCondition {
  op: AdvancedOp
  value: Scalar
}

export interface AdvancedModel {
  kind: 'advanced'
  first: AdvancedCondition | null
  second: AdvancedCondition | null
  logic: 'and' | 'or'
}

export interface TopNModel {
  kind: 'topN'
  direction: 'top' | 'bottom'
  count: number
  /** "By value" field (Measure / Aggregation SQ expression, Entity refs) */
  by: SQExpr | null
}

export type RelativeUnit = 'days' | 'weeks' | 'weeksCalendar' | 'months' | 'monthsCalendar' | 'years' | 'yearsCalendar'

export interface RelativeDateModel {
  kind: 'relativeDate'
  operator: 'last' | 'this' | 'next'
  count: number
  unit: RelativeUnit
  includeToday: boolean
}

export type FilterModel = BasicModel | AdvancedModel | TopNModel | RelativeDateModel
export type FilterKind = FilterModel['kind']

export type FieldValueType = 'text' | 'number' | 'date' | 'boolean'

export const CARD_TYPE: Record<FilterKind, string> = { basic: 'Categorical', advanced: 'Advanced', topN: 'TopN', relativeDate: 'RelativeDate' }

export function emptyModel(kind: FilterKind): FilterModel {
  switch (kind) {
    case 'basic':
      return { kind, values: [], inverted: false, requireSingleSelection: false }
    case 'advanced':
      return { kind, first: null, second: null, logic: 'and' }
    case 'topN':
      return { kind, direction: 'top', count: 5, by: null }
    case 'relativeDate':
      return { kind, operator: 'last', count: 1, unit: 'months', includeToday: true }
  }
}

export const TEXT_OPS: Array<{ value: AdvancedOp; label: string }> = [
  { value: 'contains', label: 'contains' },
  { value: 'notContains', label: 'does not contain' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'notStartsWith', label: 'does not start with' },
  { value: 'is', label: 'is' },
  { value: 'isNot', label: 'is not' },
  { value: 'isBlank', label: 'is blank' },
  { value: 'isNotBlank', label: 'is not blank' },
  { value: 'isEmpty', label: 'is empty' },
  { value: 'isNotEmpty', label: 'is not empty' }
]

export const NUMBER_OPS: Array<{ value: AdvancedOp; label: string }> = [
  { value: 'lt', label: 'is less than' },
  { value: 'le', label: 'is less than or equal to' },
  { value: 'gt', label: 'is greater than' },
  { value: 'ge', label: 'is greater than or equal to' },
  { value: 'is', label: 'is' },
  { value: 'isNot', label: 'is not' },
  { value: 'isBlank', label: 'is blank' },
  { value: 'isNotBlank', label: 'is not blank' }
]

export const DATE_OPS: Array<{ value: AdvancedOp; label: string }> = [
  { value: 'is', label: 'is' },
  { value: 'isNot', label: 'is not' },
  { value: 'ge', label: 'is on or after' },
  { value: 'gt', label: 'is after' },
  { value: 'le', label: 'is on or before' },
  { value: 'lt', label: 'is before' },
  { value: 'isBlank', label: 'is blank' },
  { value: 'isNotBlank', label: 'is not blank' }
]

export function opsFor(type: FieldValueType): Array<{ value: AdvancedOp; label: string }> {
  return type === 'text' ? TEXT_OPS : type === 'date' ? DATE_OPS : NUMBER_OPS
}

export function opNeedsValue(op: AdvancedOp): boolean {
  return !['isBlank', 'isNotBlank', 'isEmpty', 'isNotEmpty'].includes(op)
}

export const RELATIVE_UNITS: Array<{ value: RelativeUnit; label: string; plural: string }> = [
  { value: 'days', label: 'Days', plural: 'days' },
  { value: 'weeks', label: 'Weeks', plural: 'weeks' },
  { value: 'weeksCalendar', label: 'Weeks (Calendar)', plural: 'calendar weeks' },
  { value: 'months', label: 'Months', plural: 'months' },
  { value: 'monthsCalendar', label: 'Months (Calendar)', plural: 'calendar months' },
  { value: 'years', label: 'Years', plural: 'years' },
  { value: 'yearsCalendar', label: 'Years (Calendar)', plural: 'calendar years' }
]

const UNIT_CODE: Record<RelativeUnit, number> = { days: 0, weeks: 1, weeksCalendar: 1, months: 2, monthsCalendar: 2, years: 3, yearsCalendar: 3 }
const isCalendar = (u: RelativeUnit) => u.endsWith('Calendar')

// ---------------------------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------------------------

/** Build the `From` list + rewrite Entity refs to `Source` aliases (PBI style: first letter of the table, deduplicated). */
class AliasBuilder {
  from: Array<{ Name: string; Entity: string; Type: number }> = []
  private byEntity = new Map<string, string>()
  alias(entity: string): string {
    const hit = this.byEntity.get(entity)
    if (hit) return hit
    const base = (entity.replace(/[^A-Za-z]/g, '').charAt(0) || 't').toLowerCase()
    let name = base
    for (let i = 1; this.from.some((f) => f.Name === name) || name === 'subquery'; i++) name = `${base}${i}`
    this.byEntity.set(entity, name)
    this.from.push({ Name: name, Entity: entity, Type: 0 })
    return name
  }
  /** deep copy of expr with every { SourceRef: { Entity } } replaced by { SourceRef: { Source } } */
  ref(expr: SQExpr): SQExpr {
    if (Array.isArray(expr)) return expr.map((e) => this.ref(e))
    if (!expr || typeof expr !== 'object') return expr
    if (expr.SourceRef?.Entity) return { ...expr, SourceRef: { Source: this.alias(expr.SourceRef.Entity) } }
    const out: any = {}
    for (const [k, v] of Object.entries(expr)) out[k] = this.ref(v)
    return out
  }
}

// ---------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------

function operand(value: Scalar, type: FieldValueType): SQExpr {
  if (type === 'date' && value instanceof Date) return { DateSpan: { Expression: literalExpr(value), TimeUnit: 5 } }
  return literalExpr(value)
}

function conditionExpr(field: SQExpr, c: AdvancedCondition, type: FieldValueType): SQExpr {
  const cmp = (kind: number, right: SQExpr) => ({ Comparison: { ComparisonKind: kind, Left: field, Right: right } })
  const not = (e: SQExpr) => ({ Not: { Expression: e } })
  const v = c.value
  switch (c.op) {
    case 'contains':
      return { Contains: { Left: field, Right: literalExpr(String(v ?? '')) } }
    case 'notContains':
      return not({ Contains: { Left: field, Right: literalExpr(String(v ?? '')) } })
    case 'startsWith':
      return { StartsWith: { Left: field, Right: literalExpr(String(v ?? '')) } }
    case 'notStartsWith':
      return not({ StartsWith: { Left: field, Right: literalExpr(String(v ?? '')) } })
    case 'is':
      return cmp(0, operand(v, type))
    case 'isNot':
      return not(cmp(0, operand(v, type)))
    case 'isBlank':
      return cmp(0, literalExpr(null))
    case 'isNotBlank':
      return not(cmp(0, literalExpr(null)))
    case 'isEmpty':
      return cmp(0, literalExpr(''))
    case 'isNotEmpty':
      return not(cmp(0, literalExpr('')))
    case 'lt':
      return cmp(3, operand(v, type))
    case 'le':
      return cmp(4, operand(v, type))
    case 'gt':
      return cmp(1, operand(v, type))
    case 'ge':
      return cmp(2, operand(v, type))
  }
}

function isComplete(c: AdvancedCondition | null): c is AdvancedCondition {
  if (!c) return false
  if (!opNeedsValue(c.op)) return true
  return c.value !== null && c.value !== undefined && c.value !== ''
}

const now = () => ({ Now: {} })
const dateAdd = (e: SQExpr, amount: number, unit: number) => ({ DateAdd: { Expression: e, Amount: amount, TimeUnit: unit } })
const dateSpan = (e: SQExpr, unit: number) => ({ DateSpan: { Expression: e, TimeUnit: unit } })

function relativeBounds(m: RelativeDateModel): { lower: SQExpr; upper: SQExpr } {
  const u = UNIT_CODE[m.unit]
  const n = Math.max(1, Math.round(m.count))
  if (m.operator === 'this') return { lower: dateSpan(now(), u), upper: dateSpan(now(), u) }
  if (isCalendar(m.unit)) {
    if (m.operator === 'last') return { lower: dateSpan(dateAdd(now(), -n, u), u), upper: dateSpan(dateAdd(now(), -1, u), u) }
    return { lower: dateSpan(dateAdd(now(), 1, u), u), upper: dateSpan(dateAdd(now(), n, u), u) }
  }
  if (m.operator === 'last') {
    if (m.includeToday) return { lower: dateSpan(dateAdd(dateAdd(now(), 1, 0), -n, u), 0), upper: dateSpan(now(), 0) }
    return { lower: dateSpan(dateAdd(now(), -n, u), 0), upper: dateSpan(dateAdd(now(), -1, 0), 0) }
  }
  if (m.includeToday) return { lower: dateSpan(now(), 0), upper: dateSpan(dateAdd(dateAdd(now(), -1, 0), n, u), 0) }
  return { lower: dateSpan(dateAdd(now(), 1, 0), 0), upper: dateSpan(dateAdd(now(), n, u), 0) }
}

/**
 * Build the PBIR `filter` for a card. Returns undefined when the model selects nothing
 * (card shows "is (All)").
 */
export function buildFilter(field: SQExpr, model: FilterModel, type: FieldValueType = 'text'): SQFilter | undefined {
  const ab = new AliasBuilder()
  const f = () => ab.ref(field)
  const wrap = (cond: SQExpr): SQFilter => ({ Version: 2, From: ab.from, Where: [{ Condition: cond }] })
  switch (model.kind) {
    case 'basic': {
      if (!model.values.length) return undefined
      const inExpr = { In: { Expressions: [f()], Values: model.values.map((v) => [literalExpr(v)]) } }
      return wrap(model.inverted ? { Not: { Expression: inExpr } } : inExpr)
    }
    case 'advanced': {
      const conds = [model.first, model.second].filter(isComplete).map((c) => conditionExpr(f(), c, type))
      if (!conds.length) return undefined
      const cond = conds.length === 1 ? conds[0] : model.logic === 'or' ? { Or: { Left: conds[0], Right: conds[1] } } : { And: { Left: conds[0], Right: conds[1] } }
      return wrap(cond)
    }
    case 'topN': {
      if (!model.by || !(model.count > 0)) return undefined
      const sub = new AliasBuilder()
      const query = {
        Version: 2,
        From: sub.from,
        Select: [{ ...sub.ref(field), Name: 'field' }],
        OrderBy: [{ Direction: model.direction === 'top' ? 2 : 1, Expression: sub.ref(model.by) }],
        Top: Math.round(model.count)
      }
      const outerField = f()
      return {
        Version: 2,
        From: [{ Name: 'subquery', Expression: { Subquery: { Query: query } }, Type: 2 } as any, ...ab.from],
        Where: [{ Condition: { In: { Expressions: [outerField], Table: { SourceRef: { Source: 'subquery' } } } } }]
      }
    }
    case 'relativeDate': {
      const { lower, upper } = relativeBounds(model)
      return wrap({ Between: { Expression: f(), LowerBound: lower, UpperBound: upper } })
    }
  }
}

/** Apply a model to a card in place (filter, type, objects flags). */
export function applyModelToCard(card: FilterCard, model: FilterModel, type: FieldValueType): void {
  if (!card.field) return
  const filter = buildFilter(card.field, model, type)
  card.type = card.field.Measure || card.field.Aggregation ? (model.kind === 'topN' ? 'TopN' : 'Advanced') : CARD_TYPE[model.kind]
  if (filter) card.filter = filter
  else delete card.filter
  // general objects: inverted selection mode / require single selection (Categorical only)
  const general: Record<string, any> = { ...(card.objects?.general?.[0]?.properties ?? {}) }
  delete general.isInvertedSelectionMode
  delete general.requireSingleSelection
  if (model.kind === 'basic') {
    if (model.inverted) general.isInvertedSelectionMode = { expr: { Literal: { Value: 'true' } } }
    if (model.requireSingleSelection) general.requireSingleSelection = { expr: { Literal: { Value: 'true' } } }
  }
  const objects = { ...(card.objects ?? {}) }
  if (Object.keys(general).length) objects.general = [{ properties: general }]
  else delete objects.general
  if (Object.keys(objects).length) card.objects = objects
  else delete card.objects
}

// ---------------------------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------------------------

function boolProp(card: FilterCard, prop: string): boolean {
  const raw = card.objects?.general?.[0]?.properties?.[prop]
  return decodeLiteral(raw?.expr?.Literal?.Value) === true
}

function literalOf(e: SQExpr): { ok: boolean; value: Scalar } {
  if (e?.Literal) return { ok: true, value: decodeLiteral(e.Literal.Value) }
  if (e?.DateSpan?.Expression?.Literal) return { ok: true, value: decodeLiteral(e.DateSpan.Expression.Literal.Value) }
  return { ok: false, value: null }
}

function parseCondition(c: any): AdvancedCondition | null {
  if (!c || typeof c !== 'object') return null
  if (c.Not) {
    const inner = parseCondition(c.Not.Expression)
    if (!inner) return null
    const neg: Partial<Record<AdvancedOp, AdvancedOp>> = { contains: 'notContains', startsWith: 'notStartsWith', is: 'isNot', isBlank: 'isNotBlank', isEmpty: 'isNotEmpty' }
    const op = neg[inner.op]
    return op ? { op, value: inner.value } : null
  }
  if (c.Contains) return { op: 'contains', value: literalOf(c.Contains.Right).value }
  if (c.StartsWith) return { op: 'startsWith', value: literalOf(c.StartsWith.Right).value }
  if (c.Comparison) {
    const { ok, value } = literalOf(c.Comparison.Right)
    if (!ok) return null
    const k = c.Comparison.ComparisonKind
    if (k === 0) return value === null ? { op: 'isBlank', value: null } : value === '' ? { op: 'isEmpty', value: '' } : { op: 'is', value }
    const op = ({ 1: 'gt', 2: 'ge', 3: 'lt', 4: 'le' } as Record<number, AdvancedOp>)[k]
    return op ? { op, value } : null
  }
  return null
}

function parseRelative(cond: any): RelativeDateModel | null {
  const b = cond?.Between
  if (!b?.LowerBound?.DateSpan || !b?.UpperBound?.DateSpan) return null
  const lo = b.LowerBound.DateSpan
  const hi = b.UpperBound.DateSpan
  const isNow = (e: any) => !!e?.Now
  const unitName = (code: number, calendar: boolean): RelativeUnit => {
    const base = (['days', 'weeks', 'months', 'years'] as const)[code] ?? 'days'
    return calendar && base !== 'days' ? (`${base}Calendar` as RelativeUnit) : base
  }
  // this <unit>
  if (isNow(lo.Expression) && isNow(hi.Expression) && lo.TimeUnit === hi.TimeUnit) return { kind: 'relativeDate', operator: 'this', count: 1, unit: unitName(lo.TimeUnit, true), includeToday: true }
  // calendar variants: spans aligned to the unit (TimeUnit != 0)
  if (lo.TimeUnit !== 0 && lo.TimeUnit === hi.TimeUnit && lo.Expression?.DateAdd && hi.Expression?.DateAdd) {
    const a = lo.Expression.DateAdd.Amount
    const z = hi.Expression.DateAdd.Amount
    if (a < 0) return { kind: 'relativeDate', operator: 'last', count: -a, unit: unitName(lo.TimeUnit, true), includeToday: false }
    return { kind: 'relativeDate', operator: 'next', count: z, unit: unitName(lo.TimeUnit, true), includeToday: false }
  }
  // last N (include today): lower = DateAdd(DateAdd(Now, 1, day), -N, unit), upper = Now
  const la = lo.Expression?.DateAdd
  if (la && isNow(hi.Expression)) {
    if (la.Expression?.DateAdd && isNow(la.Expression.DateAdd.Expression)) return { kind: 'relativeDate', operator: 'last', count: -la.Amount, unit: unitName(la.TimeUnit, false), includeToday: true }
    if (isNow(la.Expression)) return { kind: 'relativeDate', operator: 'last', count: -la.Amount, unit: unitName(la.TimeUnit, false), includeToday: true }
  }
  // last N (exclude today): lower = DateAdd(Now, -N, unit), upper = DateAdd(Now, -1, day)
  if (la && isNow(la.Expression) && la.Amount < 0 && hi.Expression?.DateAdd) return { kind: 'relativeDate', operator: 'last', count: -la.Amount, unit: unitName(la.TimeUnit, false), includeToday: false }
  // next N (include today): lower = Now, upper = DateAdd(DateAdd(Now, -1, day), N, unit)
  const ua = hi.Expression?.DateAdd
  if (ua && isNow(lo.Expression)) return { kind: 'relativeDate', operator: 'next', count: ua.Amount, unit: unitName(ua.TimeUnit, false), includeToday: true }
  if (ua && la && la.Amount > 0) return { kind: 'relativeDate', operator: 'next', count: ua.Amount, unit: unitName(ua.TimeUnit, false), includeToday: false }
  return null
}

function normalizeQuery(q: any): any {
  const aliases = aliasesOf(q)
  return { ...q, Select: normalizeExpr(q.Select ?? [], aliases), OrderBy: normalizeExpr(q.OrderBy ?? [], aliases) }
}

/** Strip the `Name` key PBI puts on Select items. */
function stripName(e: any): any {
  if (!e || typeof e !== 'object') return e
  const { Name: _n, ...rest } = e
  return rest
}

/**
 * Read a card back into a UI model. Returns `{ model, unsupported? }`; unsupported filter shapes
 * (tuple filters, measure-filter combos we can't express) keep the card intact and show the raw summary.
 */
export function parseCard(card: FilterCard): { model: FilterModel; unsupported?: boolean } {
  const isMeasure = !!(card.field?.Measure || card.field?.Aggregation)
  const filter = card.filter
  const t = card.type
  const defaultKind: FilterKind = t === 'TopN' ? 'topN' : t === 'RelativeDate' || t === 'RelativeTime' ? 'relativeDate' : t === 'Advanced' || isMeasure ? 'advanced' : 'basic'
  if (!filter?.Where?.length) {
    const m = emptyModel(defaultKind)
    if (m.kind === 'basic') {
      m.inverted = boolProp(card, 'isInvertedSelectionMode')
      m.requireSingleSelection = boolProp(card, 'requireSingleSelection')
    }
    return { model: m }
  }
  const aliases = aliasesOf(filter)
  const cond = normalizeExpr(filter.Where[0].Condition, aliases)

  if (t === 'TopN' || cond?.In?.Table) {
    const sub = (filter.From ?? []).find((f: any) => f.Expression?.Subquery)?.Expression?.Subquery?.Query
    if (sub) {
      const q = normalizeQuery(sub)
      const ob = q.OrderBy?.[0]
      return { model: { kind: 'topN', direction: ob?.Direction === 1 ? 'bottom' : 'top', count: Number(sub.Top ?? 5), by: ob ? stripName(ob.Expression) : null } }
    }
    return { model: emptyModel('topN'), unsupported: true }
  }
  if (cond?.Between) {
    const rel = parseRelative(cond)
    if (rel) return { model: rel }
    return { model: emptyModel(defaultKind), unsupported: true }
  }
  // Categorical
  const inCond = cond?.In ?? cond?.Not?.Expression?.In
  if (inCond && Array.isArray(inCond.Values) && inCond.Expressions?.length === 1) {
    const values = inCond.Values.map((row: any[]) => literalOf(row[0]).value)
    const inverted = !!cond.Not
    if (defaultKind === 'basic' || t === 'Categorical' || !t) return { model: { kind: 'basic', values, inverted, requireSingleSelection: boolProp(card, 'requireSingleSelection') } }
  }
  // Advanced
  const parts: any[] = []
  let logic: 'and' | 'or' = 'and'
  if (cond?.And || cond?.Or) {
    const node = cond.And ?? cond.Or
    logic = cond.Or ? 'or' : 'and'
    parts.push(node.Left, node.Right)
  } else parts.push(cond)
  const parsed = parts.map(parseCondition)
  if (parsed.every((p) => p) && parsed.length <= 2) return { model: { kind: 'advanced', first: parsed[0], second: parsed[1] ?? null, logic } }
  return { model: emptyModel(defaultKind), unsupported: true }
}

// ---------------------------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------------------------

export function formatValue(v: Scalar): string {
  if (v === null || v === undefined) return '(Blank)'
  if (v instanceof Date) {
    const base = `${v.getUTCMonth() + 1}/${v.getUTCDate()}/${v.getUTCFullYear()}`
    return v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds() ? `${base} ${v.toISOString().slice(11, 19)}` : base
  }
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (v instanceof Uint8Array) return '(Binary)'
  if (v === '') return '(Empty)'
  return String(v)
}

function joinOr(vals: string[]): string {
  if (vals.length <= 1) return vals.join('')
  if (vals.length <= 3) return `${vals.slice(0, -1).join(', ')} or ${vals[vals.length - 1]}`
  return `${vals.slice(0, 2).join(', ')} and ${vals.length - 2} more`
}

const OP_TEXT: Record<AdvancedOp, string> = {
  contains: 'contains',
  notContains: 'does not contain',
  startsWith: 'starts with',
  notStartsWith: 'does not start with',
  is: 'is',
  isNot: 'is not',
  isBlank: 'is blank',
  isNotBlank: 'is not blank',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
  lt: 'is less than',
  le: 'is less than or equal to',
  gt: 'is greater than',
  ge: 'is greater than or equal to'
}

function condText(c: AdvancedCondition): string {
  if (!opNeedsValue(c.op)) return OP_TEXT[c.op]
  const v = typeof c.value === 'string' && (c.op === 'contains' || c.op === 'notContains' || c.op === 'startsWith' || c.op === 'notStartsWith') ? `"${c.value}"` : formatValue(c.value)
  return `${OP_TEXT[c.op]} ${v}`
}

/** Display name of a field expression (falls back to the property; aggregations → "Sum of Amount"). */
export function fieldDisplayName(expr: SQExpr | undefined, describe?: (e: SQExpr) => { displayName: string } | undefined): string {
  if (!expr) return '(Unknown field)'
  try {
    const d = describe?.(expr)
    if (d?.displayName) return d.displayName
  } catch {
    /* engine not available */
  }
  const info = fieldInfo(expr)
  if (info.kind === 'aggregation') return `${SQ_AGG_NAMES[info.aggregation ?? 0] ?? 'Sum'} of ${info.property}`
  return info.property ?? '(Unknown field)'
}

/** Summary line under the card title ("is (All)", "is Bikes or Clothing", "Top 5 by Sales"...). */
export function summarize(model: FilterModel, opts: { byName?: string; unsupported?: boolean; rawFilter?: boolean } = {}): string {
  if (opts.unsupported) return opts.rawFilter ? 'is filtered' : 'is (All)'
  switch (model.kind) {
    case 'basic':
      if (!model.values.length) return 'is (All)'
      return `${model.inverted ? 'is not' : 'is'} ${joinOr(model.values.map(formatValue))}`
    case 'advanced': {
      const parts = [model.first, model.second].filter(isComplete).map(condText)
      if (!parts.length) return 'is (All)'
      return parts.join(model.logic === 'or' ? ' or ' : ' and ')
    }
    case 'topN':
      if (!model.by) return 'is (All)'
      return `${model.direction === 'top' ? 'Top' : 'Bottom'} ${model.count} by ${opts.byName ?? fieldDisplayName(model.by)}`
    case 'relativeDate': {
      const unit = RELATIVE_UNITS.find((u) => u.value === model.unit)!
      if (model.operator === 'this') return `is in this ${unit.plural.replace(/s$/, '').replace('calendar ', '')}`
      const plural = model.count === 1 ? unit.plural.replace(/s$/, '') : unit.plural
      return `is in the ${model.operator} ${model.count} ${plural}`
    }
  }
}

/** Is a card actively filtering? */
export function isFiltering(card: FilterCard): boolean {
  return !!card.filter?.Where?.length
}

/** Field value type for UI decisions. */
export function valueTypeOf(dataType: string | undefined): FieldValueType {
  if (dataType === 'dateTime') return 'date'
  if (dataType === 'int64' || dataType === 'double' || dataType === 'decimal') return 'number'
  if (dataType === 'boolean') return 'boolean'
  return 'text'
}

/** New card for a field (no filter yet). */
export function newCard(name: string, field: SQExpr): FilterCard {
  const isMeasure = !!(field?.Measure || field?.Aggregation)
  return { name, field, type: isMeasure ? 'Advanced' : 'Categorical', howCreated: 'User' }
}

/** Same field? (ignores alias style) */
export function sameField(a: SQExpr, b: SQExpr): boolean {
  return fieldKey(a) === fieldKey(b)
}

export { entityOf }
