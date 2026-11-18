import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { columnExpr, normalizeFilter, type SQFilter } from '@core/report/sq'
import {
  buildHierTree,
  compressSelection,
  containsFilter,
  evalDateExpr,
  hierarchyFilter,
  isSelected,
  listFilter,
  nodeState,
  parseContainsFilter,
  parseHierarchyFilter,
  parseListFilter,
  parseRangeFilter,
  parseRelativeFilter,
  pathKey,
  persistedFilter,
  rangeFilter,
  relativeFilter,
  relativeRange,
  selectedLeafKeys,
  toggleHierNode,
  toggleListValue,
  valueSelected,
  wrapFilter
} from './filterModel'

const region = columnExpr('Sales', 'Region')
const country = columnExpr('Sales', 'Country')
const amount = columnExpr('Sales', 'Amount')
const date = columnExpr('Calendar', 'Date')

const cond = (f: SQFilter | undefined) => (f ? normalizeFilter(f).Where.map((w) => w.Condition) : undefined)

describe('wrapFilter', () => {
  it('declares PBI-style From aliases', () => {
    const f = wrapFilter({ In: { Expressions: [region, columnExpr('dim_regions', 'x'), columnExpr('Sales', 'y')], Values: [] } })
    expect(f.From).toEqual([
      { Name: 's', Entity: 'Sales', Type: 0 },
      { Name: 'd', Entity: 'dim_regions', Type: 0 }
    ])
    expect(JSON.stringify(f.Where)).toContain('"Source":"s"')
    expect(JSON.stringify(f.Where)).not.toContain('Entity')
  })
  it('de-duplicates aliases with the same initial', () => {
    const f = wrapFilter({ And: { Left: { In: { Expressions: [columnExpr('dim_a', 'x')], Values: [] } }, Right: { In: { Expressions: [columnExpr('dim_b', 'x')], Values: [] } } } })
    expect(f.From!.map((x) => x.Name)).toEqual(['d', 'd1'])
  })
})

describe('list selection', () => {
  it('builds and parses In / Not In', () => {
    const f = listFilter(region, { mode: 'include', values: ['Europe', null] })
    expect(parseListFilter(f, region)).toEqual({ mode: 'include', values: ['Europe', null] })
    expect(valueSelected(f, region, 'Europe')).toBe(true)
    expect(valueSelected(f, region, 'europe')).toBe(true)
    expect(valueSelected(f, region, null)).toBe(true)
    expect(valueSelected(f, region, 'Asia')).toBe(false)
    const inv = listFilter(region, { mode: 'exclude', values: ['Asia'] })
    expect(parseListFilter(inv, region)).toEqual({ mode: 'exclude', values: ['Asia'] })
    expect(valueSelected(inv, region, 'Europe')).toBe(true)
    expect(valueSelected(inv, region, 'Asia')).toBe(false)
    expect(listFilter(region, { mode: 'include', values: [] })).toBeUndefined()
  })
  it('toggles like PBI clicks', () => {
    let s = toggleListValue(undefined, 'A', false)
    s = toggleListValue(s, 'B', false)
    expect(s.values).toEqual(['A', 'B'])
    s = toggleListValue(s, 'A', false)
    expect(s.values).toEqual(['B'])
    s = toggleListValue(s, 'C', true)
    expect(s.values).toEqual(['C'])
    s = toggleListValue(s, 'C', true)
    expect(s.values).toEqual([])
  })
  it('handles dates and numbers', () => {
    const d = new Date(Date.UTC(2024, 0, 31))
    const f = listFilter(date, { mode: 'include', values: [d, 5] })
    expect(valueSelected(f, date, new Date(Date.UTC(2024, 0, 31)))).toBe(true)
    expect(parseListFilter(f, date)!.values[0]).toEqual(d)
  })
})

describe('hierarchy selection', () => {
  const tuples = [
    ['Europe', 'France'],
    ['Europe', 'Germany'],
    ['Europe', 'Spain'],
    ['North America', 'Canada'],
    ['North America', 'Mexico']
  ]
  const fields = [region, country]
  const root = buildHierTree(tuples, 2)

  it('builds the tree with leaf counts', () => {
    expect(root.leaves).toBe(5)
    expect(root.children.map((c) => [c.value, c.leaves])).toEqual([
      ['Europe', 3],
      ['North America', 2]
    ])
  })

  it('selecting a parent writes a level-1 In; deselecting a child adds a tuple Not In', () => {
    let sel = toggleHierNode(root.children[0], new Set(), false)
    let f = hierarchyFilter(fields, compressSelection(root, sel, false))
    expect(cond(f)).toEqual([{ In: { Expressions: [region], Values: [[{ Literal: { Value: "'Europe'" } }]] } }])
    sel = toggleHierNode(root.children[0].children[1], sel, false)
    f = hierarchyFilter(fields, compressSelection(root, sel, false))
    const c = cond(f)![0]
    expect(c.And.Left.In.Expressions).toEqual([region])
    expect(c.And.Right.Not.Expression.In.Expressions).toEqual([region, country])
    expect(c.And.Right.Not.Expression.In.Values).toEqual([[{ Literal: { Value: "'Europe'" } }, { Literal: { Value: "'Germany'" } }]])
    // tri-state
    const keys = selectedLeafKeys(root, fields, f, false)
    expect(nodeState(root.children[0], keys)).toBe('partial')
    expect(nodeState(root.children[1], keys)).toBe('off')
    expect(nodeState(root.children[0].children[0], keys)).toBe('on')
    expect(nodeState(root.children[0].children[1], keys)).toBe('off')
  })

  it('a single leaf becomes a tuple In', () => {
    const sel = toggleHierNode(root.children[1].children[0], new Set(), false)
    const f = hierarchyFilter(fields, compressSelection(root, sel, false))
    expect(cond(f)).toEqual([{ In: { Expressions: [region, country], Values: [[{ Literal: { Value: "'North America'" } }, { Literal: { Value: "'Canada'" } }]] } }])
    expect(isSelected(f, fields, ['North America', 'Canada'])).toBe(true)
    expect(isSelected(f, fields, ['North America', 'Mexico'])).toBe(false)
  })

  it('mixed depths are OR-ed and round-trip', () => {
    let sel = toggleHierNode(root.children[1], new Set(), false)
    sel = toggleHierNode(root.children[0].children[2], sel, false)
    const hs = compressSelection(root, sel, false)
    const f = hierarchyFilter(fields, hs)
    expect(cond(f)![0].Or).toBeDefined()
    const parsed = parseHierarchyFilter(f, fields)!
    expect(parsed.include).toEqual([['North America'], ['Europe', 'Spain']])
    expect(selectedLeafKeys(root, fields, f, false)).toEqual(sel)
  })

  it('inverted (Select all) mode writes only exclusions', () => {
    const all = new Set(tuples.map(pathKey))
    const sel = toggleHierNode(root.children[1].children[1], all, false)
    const f = hierarchyFilter(fields, compressSelection(root, sel, true))
    expect(cond(f)![0].Not).toBeDefined()
    expect(selectedLeafKeys(root, fields, f, true).size).toBe(4)
    expect(parseHierarchyFilter(f, fields)).toEqual({ include: [], exclude: [['North America', 'Mexico']], inverted: true })
  })

  it('strict single select replaces the selection', () => {
    let sel = toggleHierNode(root.children[0], new Set(), true)
    sel = toggleHierNode(root.children[1].children[0], sel, true)
    expect([...sel]).toEqual([pathKey(['North America', 'Canada'])])
  })
})

describe('range', () => {
  it('numbers use >= and <=', () => {
    const f = rangeFilter(amount, { min: 10, max: 20.5 })
    const c = cond(f)![0]
    expect(c.And.Left.Comparison.ComparisonKind).toBe(2)
    expect(c.And.Right.Comparison.ComparisonKind).toBe(4)
    expect(parseRangeFilter(f, amount)).toEqual({ min: 10, max: 20.5 })
    expect(isSelected(f, [amount], [15])).toBe(true)
    expect(isSelected(f, [amount], [21])).toBe(false)
  })
  it('dates use [start, end + 1 day)', () => {
    const a = new Date(Date.UTC(2024, 0, 1))
    const b = new Date(Date.UTC(2024, 0, 31))
    const f = rangeFilter(date, { min: a, max: b })
    const c = cond(f)![0]
    expect(c.And.Right.Comparison).toMatchObject({ ComparisonKind: 3, Right: { Literal: { Value: "datetime'2024-02-01T00:00:00'" } } })
    expect(parseRangeFilter(f, date)).toEqual({ min: a, max: b })
    expect(isSelected(f, [date], [new Date(Date.UTC(2024, 0, 31, 23))])).toBe(true)
    expect(isSelected(f, [date], [new Date(Date.UTC(2024, 1, 1))])).toBe(false)
  })
  it('before / after', () => {
    expect(parseRangeFilter(rangeFilter(amount, { max: 5 }), amount)).toEqual({ max: 5 })
    expect(parseRangeFilter(rangeFilter(amount, { min: 5 }), amount)).toEqual({ min: 5 })
    expect(rangeFilter(amount, {})).toBeUndefined()
  })
})

describe('relative date', () => {
  const now = new Date(Date.UTC(2024, 4, 15, 13, 30)) // Wed 15 May 2024
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const cases: Array<[Parameters<typeof relativeFilter>[1], string, string]> = [
    [{ anchor: 'last', n: 3, unit: 'days', calendar: false }, '2024-05-13', '2024-05-15'],
    [{ anchor: 'last', n: 2, unit: 'months', calendar: true }, '2024-03-01', '2024-04-30'],
    [{ anchor: 'last', n: 2, unit: 'months', calendar: false }, '2024-03-16', '2024-05-15'],
    [{ anchor: 'last', n: 1, unit: 'years', calendar: true }, '2023-01-01', '2023-12-31'],
    [{ anchor: 'last', n: 1, unit: 'weeks', calendar: true }, '2024-05-05', '2024-05-11'],
    [{ anchor: 'this', n: 1, unit: 'months', calendar: true }, '2024-05-01', '2024-05-31'],
    [{ anchor: 'this', n: 1, unit: 'years', calendar: true }, '2024-01-01', '2024-12-31'],
    [{ anchor: 'next', n: 2, unit: 'days', calendar: false }, '2024-05-15', '2024-05-16'],
    [{ anchor: 'next', n: 1, unit: 'months', calendar: true }, '2024-06-01', '2024-06-30']
  ]
  for (const [sel, from, to] of cases) {
    it(`${sel.anchor} ${sel.n} ${sel.unit}${sel.calendar ? ' (calendar)' : ''}`, () => {
      const r = relativeRange(sel, now)!
      expect([iso(r.start), iso(r.end)]).toEqual([from, to])
      const f = relativeFilter(date, sel)
      const p = parseRelativeFilter(f, date)!
      expect(relativeRange(p, now)).toEqual(r)
      expect(cond(f)![0].Between.LowerBound.DateSpan).toBeDefined()
    })
  }
  it('evaluates DateSpan to an interval', () => {
    const v = evalDateExpr({ DateSpan: { Expression: { Now: {} }, TimeUnit: 2 } }, now) as { start: Date; end: Date }
    expect(iso(v.start)).toBe('2024-05-01')
    expect(iso(v.end)).toBe('2024-06-01')
  })
  it('relative time (last 2 hours)', () => {
    const sel = { anchor: 'last', n: 2, unit: 'hours', calendar: false } as const
    const f = relativeFilter(date, sel)
    expect(parseRelativeFilter(f, date)).toMatchObject({ anchor: 'last', n: 2, unit: 'hours' })
  })
})

describe('text slicer', () => {
  it('Contains round-trip', () => {
    const f = containsFilter(columnExpr('Customer', 'CustomerName'), 'contoso')!
    expect(f).toEqual({
      Version: 2,
      From: [{ Name: 'c', Entity: 'Customer', Type: 0 }],
      Where: [{ Condition: { Contains: { Left: { Column: { Expression: { SourceRef: { Source: 'c' } }, Property: 'CustomerName' } }, Right: { Literal: { Value: "'contoso'" } } } } }]
    })
    expect(parseContainsFilter(f)).toBe('contoso')
    expect(containsFilter(region, '')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------
// Real corpus round-trip
// ---------------------------------------------------------------------------------------------

const CORPUS = process.env.LUMEN_CORPUS_DIR ?? ''

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name === 'visual.json') out.push(p)
  }
  return out
}

describe.skipIf(!existsSync(CORPUS))('corpus slicer filters round-trip', () => {
  const files = existsSync(CORPUS) ? walk(CORPUS) : []
  const slicers = files
    .map((f) => ({ f, json: JSON.parse(readFileSync(f, 'utf8')) }))
    .filter((x) => x.json.visual?.visualType === 'slicer' || x.json.visual?.visualType === 'textSlicer')

  it('found slicer filters', () => {
    expect(slicers.filter((s) => persistedFilter(s.json)).length).toBeGreaterThan(50)
  })

  it('every persisted filter parses and rebuilds to the same condition', () => {
    let checked = 0
    for (const { f, json } of slicers) {
      for (const prop of ['filter', 'selfFilter'] as const) {
        const filter = persistedFilter(json, prop)
        if (!filter) continue
        const fields = (json.visual.query?.queryState?.Values?.projections ?? []).map((p: any) => p.field)
        const original = cond(filter)
        let rebuilt: SQFilter | undefined
        const c = original![0]
        if (json.visual.visualType === 'textSlicer' || c.Contains) {
          rebuilt = containsFilter(c.Contains.Left, parseContainsFilter(filter)!)
        } else if (c.Or && JSON.stringify(c).includes('Contains')) {
          // search self-filter with OR-ed Contains: only verify the text is recoverable
          expect(parseContainsFilter(filter), f).toBeTruthy()
          checked++
          continue
        } else if (fields.length > 1 || (c.In && c.In.Expressions.length > 1) || c.And) {
          const nFields = Math.max(fields.length, JSON.stringify(c).match(/"Expressions":\[([^\]]*)\]/)?.[1].split('"Column"').length ?? 1)
          const h = parseHierarchyFilter(filter, fields.length >= nFields - 1 ? fields : fields)
          expect(h, f).toBeDefined()
          rebuilt = hierarchyFilter(fields, h!)
        } else {
          const l = parseListFilter(filter, fields[0])
          expect(l, f).toBeDefined()
          rebuilt = listFilter(fields[0], l!)
        }
        expect(cond(rebuilt), f).toEqual(original)
        // From aliases follow PBI's naming
        expect(rebuilt!.From!.map((x) => x.Entity).sort(), f).toEqual([...new Set((filter.From ?? []).map((x) => x.Entity))].sort())
        checked++
      }
    }
    expect(checked).toBeGreaterThan(80)
  })
})
