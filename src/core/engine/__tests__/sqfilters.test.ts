/** SQ filter shapes: comparison kinds (0 eq, 1 gt, 2 ge, 3 lt, 4 le) with BLANK, relative date spans (Now/DateAdd/DateSpan). */
import { describe, expect, it } from 'vitest'
import { build, d } from '../../dax/tabular/__tests__/build'
import { createEngine } from '../engine'

function engine() {
  const days: Array<[Date, number | null]> = []
  for (let i = 0; i < 70; i++) days.push([d(2025, 12, 1 + i), i % 10 === 0 ? null : i - 40])
  const { model, data } = build({ tables: { T: { columns: { Date: 'dateTime', Rel: 'int64' }, rows: days, measures: { N: 'COUNTROWS ( T )' } } } })
  // "now" = 2026-01-15 10:30 local wall clock
  const e = createEngine(model, data, { now: () => new Date(2026, 0, 15, 10, 30) })
  e.processCalculated()
  return e
}
const colRef = (c: string) => ({ Column: { Expression: { SourceRef: { Source: 't' } }, Property: c } })
const where = (cond: any) => ({ Version: 2, From: [{ Name: 't', Entity: 'T', Type: 0 }], Where: [{ Condition: cond }] })
const cmp = (kind: number, v: string) => where({ Comparison: { ComparisonKind: kind, Left: colRef('Rel'), Right: { Literal: { Value: v } } } })
const now = { Now: {} }
const add = (e: any, n: number, unit: number) => ({ DateAdd: { Expression: e, Amount: n, TimeUnit: unit } })
const span = (e: any, unit: number) => ({ DateSpan: { Expression: e, TimeUnit: unit } })

describe('SQ comparisons', () => {
  const e = engine()
  const n = (f: any) => e.evaluateScalar('[N]', [f]).value
  it('maps kinds 0..4 and treats BLANK like DAX (as 0)', () => {
    // Rel = i - 40 for rows i = 0..69, except BLANK on the 7 rows with i % 10 = 0
    expect(n(cmp(0, '0L'))).toBe(null) // equality does not match BLANK (row i = 40 is blank): "is blank" is explicit
    expect(n(cmp(1, '0L'))).toBe(27) // Rel 1..29 minus the blank rows i = 50, 60
    expect(n(cmp(2, '-18L'))).toBe(51) // 44 non-blank rows with Rel >= -18 + all 7 blanks (0 >= -18)
    expect(n(cmp(3, '0L'))).toBe(36) // Rel -39..-1 minus the blank rows i = 10, 20, 30 (i = 0 too)
    expect(n(cmp(4, '0L'))).toBe(43) // the 36 negatives + all 7 blanks (0 <= 0)
  })
})

describe('relative date filters', () => {
  const e = engine()
  const n = (cond: any) => e.evaluateScalar('[N]', [where(cond)]).value
  it('last 7 days including today (DateSpan bounds: start inclusive, end of the span exclusive)', () => {
    const cond = { Between: { Expression: colRef('Date'), LowerBound: span(add(now, -6, 0), 0), UpperBound: span(now, 0) } }
    expect(n(cond)).toBe(7)
  })
  it('this month / last 1 calendar month / next 2 weeks', () => {
    expect(n({ Comparison: { ComparisonKind: 0, Left: colRef('Date'), Right: span(now, 2) } })).toBe(31)
    expect(n({ Between: { Expression: colRef('Date'), LowerBound: span(add(now, -1, 2), 2), UpperBound: span(add(now, -1, 2), 2) } })).toBe(31)
    // weeks start on Sunday (en-US): 2026-01-18 .. 2026-01-31
    expect(n({ Between: { Expression: colRef('Date'), LowerBound: span(add(now, 1, 1), 1), UpperBound: span(add(now, 2, 1), 1) } })).toBe(14)
  })
  it('in the last 2 years / before today', () => {
    expect(n({ Comparison: { ComparisonKind: 3, Left: colRef('Date'), Right: span(now, 0) } })).toBe(45)
    expect(n({ Comparison: { ComparisonKind: 2, Left: colRef('Date'), Right: span(add(now, -1, 3), 3) } })).toBe(70)
  })
})
