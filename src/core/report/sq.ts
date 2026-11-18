/**
 * Semantic Query (SQ) expressions — the JSON expression language PBIR uses for fields,
 * filters, sort, conditional formatting, and selectors. This module is the shared vocabulary:
 * every component that talks about "a field" or "a filter" uses these shapes.
 *
 * Field forms seen in PBIR:
 *   { Column:  { Expression: { SourceRef: { Entity: 'T' } | { Source: 'alias' } }, Property: 'col' } }
 *   { Measure: { Expression: { SourceRef: ... }, Property: 'measure' } }
 *   { Aggregation: { Expression: { Column: ... }, Function: 0..8 } }
 *   { HierarchyLevel: { Expression: { Hierarchy: { Expression: { SourceRef } | { PropertyVariationSource: {...} }, Hierarchy: 'H' } }, Level: 'L' } }
 *   { NativeVisualCalculation: { Language: 'dax', Expression: '...', Name: '...' } }
 *
 * Filter (PBIR `filter` property): { Version: 2, From: [{ Name, Entity, Type: 0 }], Where: [{ Condition }] }
 * Conditions: In { Expressions, Values: [[Literal...]] }, Not { Expression }, And/Or { Left, Right },
 *   Comparison { ComparisonKind: 0 eq,1 gt,2 ge,3 lt,4 le, Left, Right }, Between { Expression, LowerBound, UpperBound },
 *   Contains / StartsWith / EndsWith { Left, Right }, Exists, DateSpan, Literal, Subquery (TopN)...
 */

import type { Scalar } from '../model/data'
import { decodeLiteral, encodeLiteral } from './literal'

export type SQExpr = any
export type SQFilter = { Version?: number; From?: Array<{ Name: string; Entity?: string; Type?: number; Expression?: any }>; Where: Array<{ Condition: any; Target?: any[] }> }

/** QueryAggregateFunction enum as used in SQ `Aggregation.Function`. NOTE: SQ "Count" (2) is a *distinct* count. */
export const SQ_AGG = {
  Sum: 0,
  Avg: 1,
  Count: 2, // distinct count ("Count (Distinct)" in UI)
  Min: 3,
  Max: 4,
  CountNonNull: 5, // "Count" in UI
  Median: 6,
  StandardDeviation: 7,
  Variance: 8
} as const

export const SQ_AGG_NAMES: Record<number, string> = {
  0: 'Sum',
  1: 'Average',
  2: 'Count (Distinct)',
  3: 'Minimum',
  4: 'Maximum',
  5: 'Count',
  6: 'Median',
  7: 'Standard deviation',
  8: 'Variance'
}

export interface FieldInfo {
  kind: 'column' | 'measure' | 'aggregation' | 'hierarchyLevel' | 'visualCalc' | 'unknown'
  table?: string
  /** column / measure name, or the hierarchy level's name */
  property?: string
  hierarchy?: string
  level?: string
  /** auto date/time variation: the base date column (e.g. 'date' for 'date'.Variation.'Date Hierarchy') */
  variationColumn?: string
  aggregation?: number
  /** For aggregation: the inner field */
  inner?: FieldInfo
  /** visual calculation expression */
  expression?: string
}

type AliasMap = Record<string, string> | undefined

export function aliasesOf(filter: { From?: Array<{ Name: string; Entity?: string }> } | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of filter?.From ?? []) if (f.Entity) out[f.Name] = f.Entity
  return out
}

/** Resolve the entity (table name) of an expression's SourceRef. */
export function entityOf(expr: any, aliases?: AliasMap): string | undefined {
  if (!expr) return undefined
  const sr = expr.SourceRef
  if (sr) return sr.Entity ?? (sr.Source ? aliases?.[sr.Source] ?? sr.Source : undefined)
  if (expr.Column) return entityOf(expr.Column.Expression, aliases)
  if (expr.Measure) return entityOf(expr.Measure.Expression, aliases)
  if (expr.Hierarchy) return entityOf(expr.Hierarchy.Expression, aliases)
  if (expr.PropertyVariationSource) return entityOf(expr.PropertyVariationSource.Expression, aliases)
  return undefined
}

/** Describe a SQ field expression in plain terms. */
export function fieldInfo(expr: SQExpr, aliases?: AliasMap): FieldInfo {
  if (!expr || typeof expr !== 'object') return { kind: 'unknown' }
  if (expr.Column) return { kind: 'column', table: entityOf(expr.Column.Expression, aliases), property: expr.Column.Property }
  if (expr.Measure) return { kind: 'measure', table: entityOf(expr.Measure.Expression, aliases), property: expr.Measure.Property }
  if (expr.Aggregation) {
    const inner = fieldInfo(expr.Aggregation.Expression, aliases)
    return { kind: 'aggregation', table: inner.table, property: inner.property, aggregation: expr.Aggregation.Function, inner }
  }
  if (expr.HierarchyLevel) {
    const h = expr.HierarchyLevel.Expression?.Hierarchy
    const hexpr = h?.Expression
    const pvs = hexpr?.PropertyVariationSource
    return {
      kind: 'hierarchyLevel',
      table: entityOf(pvs ? pvs.Expression : hexpr, aliases),
      hierarchy: h?.Hierarchy,
      level: expr.HierarchyLevel.Level,
      property: expr.HierarchyLevel.Level,
      variationColumn: pvs?.Property
    }
  }
  if (expr.NativeVisualCalculation) return { kind: 'visualCalc', expression: expr.NativeVisualCalculation.Expression, property: expr.NativeVisualCalculation.Name }
  return { kind: 'unknown' }
}

/** Stable identity string for a field, e.g. `col:Sales.Amount`, `msr:_m.Total`, `agg:2:Sales.Id`. */
export function fieldKey(expr: SQExpr, aliases?: AliasMap): string {
  const f = fieldInfo(expr, aliases)
  switch (f.kind) {
    case 'column':
      return `col:${f.table}.${f.property}`
    case 'measure':
      return `msr:${f.table}.${f.property}`
    case 'aggregation':
      return `agg:${f.aggregation}:${f.table}.${f.property}`
    case 'hierarchyLevel':
      return `lvl:${f.table}.${f.variationColumn ? f.variationColumn + '.' : ''}${f.hierarchy}.${f.level}`
    case 'visualCalc':
      return `calc:${f.property}`
    default:
      return `?:${JSON.stringify(expr)}`
  }
}

/** Default PBI-style queryRef: `Table.Column`, `Sum(Table.Column)`, `Table.Measure`. */
export function defaultQueryRef(expr: SQExpr, aliases?: AliasMap): string {
  const f = fieldInfo(expr, aliases)
  if (f.kind === 'aggregation') {
    const fn = ['Sum', 'Avg', 'CountNonNull', 'Min', 'Max', 'CountNonNull', 'Median', 'StandardDeviation', 'Variance'][f.aggregation ?? 0]
    return `${f.aggregation === 2 ? 'Count' : fn}(${f.table}.${f.property})`
  }
  if (f.kind === 'hierarchyLevel') return `${f.table}.${f.hierarchy}.${f.level}`
  return `${f.table}.${f.property}`
}

export function columnExpr(table: string, column: string): SQExpr {
  return { Column: { Expression: { SourceRef: { Entity: table } }, Property: column } }
}

export function measureExpr(table: string, measure: string): SQExpr {
  return { Measure: { Expression: { SourceRef: { Entity: table } }, Property: measure } }
}

export function aggregationExpr(table: string, column: string, fn: number): SQExpr {
  return { Aggregation: { Expression: columnExpr(table, column), Function: fn } }
}

/** Strip alias indirection: rewrite { Source: 'a' } SourceRefs to { Entity: 'T' }. Returns a deep copy. */
export function normalizeExpr(expr: SQExpr, aliases?: AliasMap): SQExpr {
  if (Array.isArray(expr)) return expr.map((e) => normalizeExpr(e, aliases))
  if (!expr || typeof expr !== 'object') return expr
  if (expr.SourceRef && expr.SourceRef.Source && !expr.SourceRef.Entity) {
    const entity = aliases?.[expr.SourceRef.Source]
    if (entity) return { ...expr, SourceRef: { Entity: entity } }
  }
  const out: any = {}
  for (const [k, v] of Object.entries(expr)) out[k] = normalizeExpr(v, aliases)
  return out
}

/** Normalize a filter so that every SourceRef uses Entity (no From aliases needed). */
export function normalizeFilter(filter: SQFilter): SQFilter {
  const aliases = aliasesOf(filter)
  // Subquery sources (TopN filters: From entries with Expression.Subquery) are still referenced by
  // SourceRef.Source after normalization, so they are kept (subquery-only From).
  const subqueries = (filter.From ?? []).filter((f) => !f.Entity && f.Expression)
  const out: SQFilter = { Version: filter.Version ?? 2, Where: (filter.Where ?? []).map((w) => normalizeExpr(w, aliases)) }
  if (subqueries.length) out.From = subqueries
  return out
}

// ---------------------------------------------------------------------------------------------
// Data point identities (selection, cross-filter / cross-highlight, drill-through)
// ---------------------------------------------------------------------------------------------

/** One data point = AND of (column = value) pairs. Columns are SQ Column (or HierarchyLevel) expressions with Entity refs. */
export interface DataPointIdentity {
  fields: Array<{ expr: SQExpr; value: Scalar }>
}

export function identityKey(id: DataPointIdentity): string {
  return id.fields.map((f) => `${fieldKey(f.expr)}=${f.value instanceof Date ? 'd' + f.value.getTime() : JSON.stringify(f.value)}`).join('&')
}

/** Literal SQ node for a JS value. */
export function literalExpr(v: Scalar): SQExpr {
  return { Literal: { Value: encodeLiteral(v) } }
}

export function literalValue(expr: SQExpr): Scalar {
  return expr?.Literal ? decodeLiteral(expr.Literal.Value) : null
}

/**
 * Convert a set of selected data points into an SQ filter (OR of ANDs). Single-field identities
 * become a compact `In` condition; multi-field identities become a tuple `In` (Expressions = all fields).
 */
export function identitiesToFilter(ids: DataPointIdentity[]): SQFilter | undefined {
  if (!ids.length) return undefined
  const exprs = ids[0].fields.map((f) => f.expr)
  const sameShape = ids.every((id) => id.fields.length === exprs.length && id.fields.every((f, i) => fieldKey(f.expr) === fieldKey(exprs[i])))
  if (sameShape) {
    return {
      Version: 2,
      Where: [{ Condition: { In: { Expressions: exprs, Values: ids.map((id) => id.fields.map((f) => literalExpr(f.value))) } } }]
    }
  }
  const ors = ids.map((id) =>
    id.fields
      .map((f): any => ({ Comparison: { ComparisonKind: 0, Left: f.expr, Right: literalExpr(f.value) } }))
      .reduce((a, b) => ({ And: { Left: a, Right: b } }))
  )
  return { Version: 2, Where: [{ Condition: ors.reduce((a, b) => ({ Or: { Left: a, Right: b } })) }] }
}

/** Basic categorical filter `table[column] IN (values)`. */
export function inFilter(table: string, column: string, values: Scalar[], not = false): SQFilter {
  const cond = { In: { Expressions: [columnExpr(table, column)], Values: values.map((v) => [literalExpr(v)]) } }
  return { Version: 2, Where: [{ Condition: not ? { Not: { Expression: cond } } : cond }] }
}
