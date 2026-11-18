import { describe, expect, it } from 'vitest'
import { columnExpr, measureExpr, aggregationExpr, SQ_AGG } from '@core/report/sq'
import { makeDate } from '@core/model/data'
import { applyModelToCard, buildFilter, fieldDisplayName, newCard, parseCard, summarize, type FilterModel, type RelativeUnit } from './filterModel'

const cat = columnExpr('Product', 'Category')
const amount = columnExpr('Sales', 'Amount')
const date = columnExpr('Date', 'Date')
const total = measureExpr('Sales', 'Total Sales')

function roundTrip(field: any, model: FilterModel, type: any = 'text') {
  const card = newCard('abc', field)
  applyModelToCard(card, model, type)
  return { card, parsed: parseCard(card) }
}

describe('basic filters', () => {
  it('builds an In filter with aliases', () => {
    const f = buildFilter(cat, { kind: 'basic', values: ['Bikes', 'Clothing'], inverted: false, requireSingleSelection: false })!
    expect(f.From).toEqual([{ Name: 'p', Entity: 'Product', Type: 0 }])
    expect(f.Where[0].Condition.In.Expressions[0]).toEqual({ Column: { Expression: { SourceRef: { Source: 'p' } }, Property: 'Category' } })
    expect(f.Where[0].Condition.In.Values).toEqual([[{ Literal: { Value: "'Bikes'" } }], [{ Literal: { Value: "'Clothing'" } }]])
  })
  it('no selection → no filter', () => {
    expect(buildFilter(cat, { kind: 'basic', values: [], inverted: false, requireSingleSelection: false })).toBeUndefined()
  })
  it('round-trips selection and inverted selection', () => {
    const a = roundTrip(cat, { kind: 'basic', values: ['Bikes'], inverted: false, requireSingleSelection: true })
    expect(a.card.type).toBe('Categorical')
    expect(a.parsed.model).toEqual({ kind: 'basic', values: ['Bikes'], inverted: false, requireSingleSelection: true })
    const b = roundTrip(cat, { kind: 'basic', values: [null, 'Bikes'], inverted: true, requireSingleSelection: false })
    expect(b.card.filter!.Where[0].Condition.Not.Expression.In).toBeTruthy()
    expect(b.card.objects.general[0].properties.isInvertedSelectionMode).toEqual({ expr: { Literal: { Value: 'true' } } })
    expect(b.parsed.model).toEqual({ kind: 'basic', values: [null, 'Bikes'], inverted: true, requireSingleSelection: false })
    expect(summarize(b.parsed.model)).toBe('is not (Blank) or Bikes')
  })
  it('round-trips numbers and dates', () => {
    const r = roundTrip(date, { kind: 'basic', values: [makeDate(2024, 1, 31)], inverted: false, requireSingleSelection: false })
    expect((r.parsed.model as any).values[0]).toEqual(makeDate(2024, 1, 31))
    expect(summarize(r.parsed.model)).toBe('is 1/31/2024')
  })
  it('parses PBI aliased Not(In null) cards', () => {
    const card = {
      name: 'x',
      field: date,
      type: 'Categorical',
      filter: { Version: 2, From: [{ Name: 'd', Entity: 'Date', Type: 0 }], Where: [{ Condition: { Not: { Expression: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'd' } }, Property: 'Date' } }], Values: [[{ Literal: { Value: 'null' } }]] } } } } }] },
      objects: { general: [{ properties: { isInvertedSelectionMode: { expr: { Literal: { Value: 'true' } } } } }] }
    }
    const { model } = parseCard(card)
    expect(model).toEqual({ kind: 'basic', values: [null], inverted: true, requireSingleSelection: false })
    expect(summarize(model)).toBe('is not (Blank)')
  })
  it('summarizes empty cards as (All)', () => {
    expect(summarize(parseCard(newCard('n', cat)).model)).toBe('is (All)')
  })
})

describe('advanced filters', () => {
  const ops: Array<[FilterModel, string]> = [
    [{ kind: 'advanced', first: { op: 'contains', value: 'ik' }, second: null, logic: 'and' }, 'contains "ik"'],
    [{ kind: 'advanced', first: { op: 'notContains', value: 'ik' }, second: null, logic: 'and' }, 'does not contain "ik"'],
    [{ kind: 'advanced', first: { op: 'startsWith', value: 'B' }, second: { op: 'notStartsWith', value: 'Bo' }, logic: 'and' }, 'starts with "B" and does not start with "Bo"'],
    [{ kind: 'advanced', first: { op: 'is', value: 'Bikes' }, second: { op: 'isNot', value: 'Cars' }, logic: 'or' }, 'is Bikes or is not Cars'],
    [{ kind: 'advanced', first: { op: 'isBlank', value: null }, second: null, logic: 'and' }, 'is blank'],
    [{ kind: 'advanced', first: { op: 'isNotBlank', value: null }, second: null, logic: 'and' }, 'is not blank'],
    [{ kind: 'advanced', first: { op: 'isEmpty', value: '' }, second: null, logic: 'and' }, 'is empty'],
    [{ kind: 'advanced', first: { op: 'isNotEmpty', value: '' }, second: null, logic: 'and' }, 'is not empty']
  ]
  for (const [model, text] of ops) {
    it(`round-trips ${text}`, () => {
      const r = roundTrip(cat, model)
      expect(r.card.type).toBe('Advanced')
      expect(r.parsed.unsupported).toBeFalsy()
      expect(r.parsed.model).toEqual(model)
      expect(summarize(r.parsed.model)).toBe(text)
    })
  }
  it('numeric comparisons use ComparisonKind 1..4', () => {
    const m: FilterModel = { kind: 'advanced', first: { op: 'gt', value: 10 }, second: { op: 'le', value: 99.5 }, logic: 'and' }
    const r = roundTrip(amount, m, 'number')
    const and = r.card.filter!.Where[0].Condition.And
    expect(and.Left.Comparison.ComparisonKind).toBe(1)
    expect(and.Right.Comparison.ComparisonKind).toBe(4)
    expect(and.Right.Comparison.Right).toEqual({ Literal: { Value: '99.5D' } })
    expect(r.parsed.model).toEqual(m)
    expect(summarize(m)).toBe('is greater than 10 and is less than or equal to 99.5')
  })
  it('date comparisons use DateSpan TimeUnit 5', () => {
    const m: FilterModel = { kind: 'advanced', first: { op: 'lt', value: makeDate(2025, 12, 1) }, second: null, logic: 'and' }
    const r = roundTrip(date, m, 'date')
    expect(r.card.filter!.Where[0].Condition.Comparison.Right).toEqual({ DateSpan: { Expression: { Literal: { Value: "datetime'2025-12-01T00:00:00'" } }, TimeUnit: 5 } })
    expect(r.parsed.model).toEqual(m)
  })
  it('incomplete conditions produce no filter', () => {
    expect(buildFilter(cat, { kind: 'advanced', first: { op: 'contains', value: '' }, second: null, logic: 'and' })).toBeUndefined()
  })
  it('measure cards are Advanced', () => {
    const r = roundTrip(total, { kind: 'advanced', first: { op: 'gt', value: 0 }, second: null, logic: 'and' }, 'number')
    expect(r.card.type).toBe('Advanced')
    expect(r.card.filter!.From).toEqual([{ Name: 's', Entity: 'Sales', Type: 0 }])
  })
})

describe('top N', () => {
  it('builds the subquery shape and round-trips', () => {
    const m: FilterModel = { kind: 'topN', direction: 'top', count: 5, by: total }
    const r = roundTrip(cat, m)
    const f = r.card.filter!
    expect(r.card.type).toBe('TopN')
    expect(f.From![0].Name).toBe('subquery')
    expect((f.From![0] as any).Type).toBe(2)
    const q = (f.From![0] as any).Expression.Subquery.Query
    expect(q.Top).toBe(5)
    expect(q.OrderBy[0].Direction).toBe(2)
    expect(q.Select[0].Name).toBe('field')
    expect(q.From.map((x: any) => x.Entity)).toEqual(['Product', 'Sales'])
    expect(f.Where[0].Condition.In.Table).toEqual({ SourceRef: { Source: 'subquery' } })
    expect(r.parsed.model).toEqual(m)
    expect(summarize(r.parsed.model, { byName: 'Total Sales' })).toBe('Top 5 by Total Sales')
  })
  it('bottom N with an aggregated column', () => {
    const by = aggregationExpr('Sales', 'Amount', SQ_AGG.Sum)
    const r = roundTrip(cat, { kind: 'topN', direction: 'bottom', count: 3, by })
    expect(r.parsed.model).toEqual({ kind: 'topN', direction: 'bottom', count: 3, by })
    expect(summarize(r.parsed.model)).toBe('Bottom 3 by Sum of Amount')
  })
})

describe('relative date', () => {
  it('parses the PBI "last 6 months including today" shape', () => {
    const card = {
      name: 'r',
      field: date,
      type: 'RelativeDate',
      filter: {
        Version: 2,
        From: [{ Name: 'd', Entity: 'Date', Type: 0 }],
        Where: [
          {
            Condition: {
              Between: {
                Expression: { Column: { Expression: { SourceRef: { Source: 'd' } }, Property: 'Date' } },
                LowerBound: { DateSpan: { Expression: { DateAdd: { Expression: { DateAdd: { Expression: { Now: {} }, Amount: 1, TimeUnit: 0 } }, Amount: -6, TimeUnit: 2 } }, TimeUnit: 0 } },
                UpperBound: { DateSpan: { Expression: { Now: {} }, TimeUnit: 0 } }
              }
            }
          }
        ]
      }
    }
    const { model } = parseCard(card)
    expect(model).toEqual({ kind: 'relativeDate', operator: 'last', count: 6, unit: 'months', includeToday: true })
    expect(summarize(model)).toBe('is in the last 6 months')
    // building the same model yields the same condition
    const built = buildFilter(date, model, 'date')!
    expect(built.Where[0].Condition).toEqual(card.filter.Where[0].Condition)
  })
  const cases: Array<[RelativeDateModel['operator'], number, RelativeUnit, boolean]> = [
    ['last', 7, 'days', true],
    ['last', 7, 'days', false],
    ['last', 2, 'weeks', false],
    ['last', 3, 'monthsCalendar', false],
    ['next', 4, 'days', true],
    ['next', 4, 'years', false],
    ['next', 2, 'yearsCalendar', false],
    ['this', 1, 'monthsCalendar', true],
    ['this', 1, 'yearsCalendar', true]
  ]
  for (const [operator, count, unit, includeToday] of cases) {
    it(`round-trips ${operator} ${count} ${unit} ${includeToday ? '(incl. today)' : ''}`, () => {
      const m: FilterModel = { kind: 'relativeDate', operator, count, unit, includeToday }
      const r = roundTrip(date, m, 'date')
      expect(r.card.type).toBe('RelativeDate')
      expect(r.parsed.model).toEqual(m)
    })
  }
  it('summaries', () => {
    expect(summarize({ kind: 'relativeDate', operator: 'last', count: 1, unit: 'days', includeToday: true })).toBe('is in the last 1 day')
    expect(summarize({ kind: 'relativeDate', operator: 'this', count: 1, unit: 'monthsCalendar', includeToday: true })).toBe('is in this month')
    expect(summarize({ kind: 'relativeDate', operator: 'next', count: 2, unit: 'yearsCalendar', includeToday: false })).toBe('is in the next 2 calendar years')
  })
})

type RelativeDateModel = Extract<FilterModel, { kind: 'relativeDate' }>

describe('display names', () => {
  it('uses describeField when available, else property / aggregation names', () => {
    expect(fieldDisplayName(cat)).toBe('Category')
    expect(fieldDisplayName(aggregationExpr('Sales', 'Amount', SQ_AGG.Avg))).toBe('Average of Amount')
    expect(fieldDisplayName(cat, () => ({ displayName: 'Product category' }))).toBe('Product category')
    expect(
      fieldDisplayName(cat, () => {
        throw new Error('no engine')
      })
    ).toBe('Category')
  })
  it('clearing a model removes the filter but keeps the card', () => {
    const card = newCard('c', cat)
    applyModelToCard(card, { kind: 'basic', values: ['A'], inverted: false, requireSingleSelection: false }, 'text')
    expect(card.filter).toBeTruthy()
    applyModelToCard(card, { kind: 'basic', values: [], inverted: false, requireSingleSelection: false }, 'text')
    expect(card.filter).toBeUndefined()
    expect(card.objects).toBeUndefined()
  })
})
