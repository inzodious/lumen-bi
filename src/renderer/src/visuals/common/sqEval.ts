/**
 * Client-side evaluation of SQ (semantic query) conditions against already-queried values.
 *
 * Used by conditional formatting rules (`Conditional.Cases[].Condition`), slicer filter
 * parsing (which items of a slicer list does a persisted filter select?) and the in-memory
 * test/gallery engine. Field references are resolved through a caller-supplied accessor keyed
 * by `fieldKey(expr)`, so the same evaluator works for rows of a summarize result, distinct
 * values of a slicer, or a raw table row.
 */
import type { Scalar } from '@core/model/data'
import { fieldKey, literalValue, normalizeExpr, aliasesOf, type SQExpr, type SQFilter } from '@core/report/sq'

/** Returns the value of a field (by fieldKey) for the current row, or `undefined` if unknown. */
export type FieldAccessor = (key: string, expr: SQExpr) => Scalar | undefined

function isFieldExpr(e: any): boolean {
  return !!(e && (e.Column || e.Measure || e.Aggregation || e.HierarchyLevel))
}

function toComparable(v: Scalar | undefined): number | string | null {
  if (v === undefined || v === null) return null
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Uint8Array) return null
  return v
}

/** DAX-like comparison: blank compares as 0 / '' against the other side's type. */
export function compareScalars(a: Scalar | undefined, b: Scalar | undefined): number {
  let x = toComparable(a)
  let y = toComparable(b)
  if (x === null && y === null) return 0
  if (x === null) x = typeof y === 'string' ? '' : 0
  if (y === null) y = typeof x === 'string' ? '' : 0
  if (typeof x === 'number' && typeof y === 'number') return x === y ? 0 : x < y ? -1 : 1
  const sx = String(x).toLowerCase()
  const sy = String(y).toLowerCase()
  return sx === sy ? 0 : sx < sy ? -1 : 1
}

/** Strict equality used by `In` (blank only equals blank; text is case-insensitive like the VertiPaq default collation). */
export function scalarEquals(a: Scalar | undefined, b: Scalar | undefined): boolean {
  const x = toComparable(a)
  const y = toComparable(b)
  if (x === null || y === null) return x === y
  if (typeof x === 'string' && typeof y === 'string') return x.toLowerCase() === y.toLowerCase()
  return x === y
}

/** Evaluate a scalar SQ expression (field, literal, arithmetic) for the current row. */
export function evalScalar(expr: any, get: FieldAccessor): Scalar | undefined {
  if (!expr || typeof expr !== 'object') return undefined
  if (expr.Literal) return literalValue(expr)
  if (isFieldExpr(expr)) return get(fieldKey(expr), expr)
  if (expr.Arithmetic) {
    const l = evalScalar(expr.Arithmetic.Left, get)
    const r = evalScalar(expr.Arithmetic.Right, get)
    const a = typeof l === 'number' ? l : 0
    const b = typeof r === 'number' ? r : 0
    switch (expr.Arithmetic.Operator) {
      case 0:
        return a + b
      case 1:
        return a - b
      case 2:
        return a * b
      case 3:
        return b === 0 ? null : a / b
      default:
        return undefined
    }
  }
  if (expr.DateSpan) return evalScalar(expr.DateSpan.Expression, get)
  return undefined
}

/**
 * Evaluate an SQ condition. Unknown constructs evaluate to `true` (do not exclude) — callers that
 * need to know whether a filter is fully understood use `conditionSupported`.
 */
export function evalCondition(cond: any, get: FieldAccessor): boolean {
  if (!cond || typeof cond !== 'object') return true
  if (cond.And) return evalCondition(cond.And.Left, get) && evalCondition(cond.And.Right, get)
  if (cond.Or) return evalCondition(cond.Or.Left, get) || evalCondition(cond.Or.Right, get)
  if (cond.Not) return !evalCondition(cond.Not.Expression, get)
  if (cond.In) {
    const exprs: any[] = cond.In.Expressions ?? []
    const vals = exprs.map((e) => evalScalar(e, get))
    const rows: any[][] = cond.In.Values ?? []
    return rows.some((row) => row.every((lit, i) => scalarEquals(vals[i], literalValue(lit))))
  }
  if (cond.Comparison) {
    const l = evalScalar(cond.Comparison.Left, get)
    const r = evalScalar(cond.Comparison.Right, get)
    const kind = cond.Comparison.ComparisonKind ?? 0
    // Blank handling: `x = null` is "is blank"; ordering comparisons against blank use DAX coercion.
    if (kind === 0) {
      if (r === null || r === undefined) return l === null || l === undefined || l === ''
      if (l === null || l === undefined) return false
      return compareScalars(l, r) === 0
    }
    const c = compareScalars(l, r)
    switch (kind) {
      case 1:
        return c > 0
      case 2:
        return c >= 0
      case 3:
        return c < 0
      case 4:
        return c <= 0
      default:
        return true
    }
  }
  if (cond.Between) {
    const v = evalScalar(cond.Between.Expression, get)
    const lo = evalScalar(cond.Between.LowerBound, get)
    const hi = evalScalar(cond.Between.UpperBound, get)
    return compareScalars(v, lo) >= 0 && compareScalars(v, hi) <= 0
  }
  const textOp = (node: any, fn: (a: string, b: string) => boolean) => {
    const l = evalScalar(node.Left, get)
    const r = evalScalar(node.Right, get)
    if (l === null || l === undefined) return false
    return fn(String(l instanceof Date ? l.toISOString() : l).toLowerCase(), String(r ?? '').toLowerCase())
  }
  if (cond.Contains) return textOp(cond.Contains, (a, b) => a.includes(b))
  if (cond.StartsWith) return textOp(cond.StartsWith, (a, b) => a.startsWith(b))
  if (cond.EndsWith) return textOp(cond.EndsWith, (a, b) => a.endsWith(b))
  if (cond.Literal) return literalValue(cond) !== false
  return true
}

const SUPPORTED = new Set(['And', 'Or', 'Not', 'In', 'Comparison', 'Between', 'Contains', 'StartsWith', 'EndsWith', 'Literal'])

/** True when every node of the condition is understood by evalCondition. */
export function conditionSupported(cond: any): boolean {
  if (!cond || typeof cond !== 'object') return false
  const k = Object.keys(cond)[0]
  if (!SUPPORTED.has(k)) return false
  if (k === 'And' || k === 'Or') return conditionSupported(cond[k].Left) && conditionSupported(cond[k].Right)
  if (k === 'Not') return conditionSupported(cond.Not.Expression)
  return true
}

/** Evaluate a whole filter (all Where conditions ANDed), resolving From aliases first. */
export function evalFilter(filter: SQFilter, get: FieldAccessor): boolean {
  const aliases = aliasesOf(filter)
  return (filter.Where ?? []).every((w) => evalCondition(normalizeExpr(w.Condition, aliases), get))
}

/** Collect every field expression referenced by a condition (deduplicated by fieldKey). */
export function conditionFields(cond: any, out = new Map<string, SQExpr>()): Map<string, SQExpr> {
  if (!cond || typeof cond !== 'object') return out
  if (isFieldExpr(cond)) {
    out.set(fieldKey(cond), cond)
    return out
  }
  if (Array.isArray(cond)) {
    for (const c of cond) conditionFields(c, out)
    return out
  }
  for (const v of Object.values(cond)) if (v && typeof v === 'object') conditionFields(v, out)
  return out
}
