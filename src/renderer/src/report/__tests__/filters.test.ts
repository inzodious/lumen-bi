import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { columnExpr, fieldKey, inFilter, type SQFilter } from '@core/report/sq'
import { buildDrillthrough, canDrillthrough, cardFilters, computeVisualFilters, includeExcludeCard, interactionKind, normalizeReportFilter, pageScopeFilters, type FilterInputs } from '../filters'
import { drillthroughFields, findPage, savedSlicerFilter } from '../pbir'
import { FIXTURE, fixtureReport } from '../dev/fixture'

const supportsHighlight = (t: string) => /Chart$/.test(t)

function inputs(visualName: string, extra: Partial<FilterInputs> = {}): FilterInputs {
  const report = fixtureReport()
  const page = findPage(report, FIXTURE.overview)!
  const slicerFilters: Record<string, SQFilter | undefined> = {}
  for (const v of page.visuals) {
    const f = savedSlicerFilter(v.json)
    if (f) slicerFilters[v.name] = f
  }
  return { report, page, visualName, slicerFilters, supportsHighlight, ...extra }
}

const json = (f: unknown) => JSON.stringify(f)

describe('normalizeReportFilter', () => {
  it('rewrites alias Source refs to Entity and drops plain From', () => {
    const f: SQFilter = {
      Version: 2,
      From: [{ Name: 's', Entity: 'Sales', Type: 0 }],
      Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 's' } }, Property: 'Region' } }], Values: [[{ Literal: { Value: "'North'" } }]] } } }]
    }
    const n = normalizeReportFilter(f)
    expect(n.From).toBeUndefined()
    expect(json(n)).toContain('"Entity":"Sales"')
    expect(json(n)).not.toContain('"Source"')
  })

  it('keeps TopN subquery From entries and normalizes the inner query', () => {
    const f: SQFilter = {
      Version: 2,
      From: [
        {
          Name: 'subquery',
          Expression: {
            Subquery: {
              Query: {
                Version: 2,
                From: [{ Name: 'p', Entity: 'Product', Type: 0 }, { Name: 's', Entity: 'Sales', Type: 0 }],
                Select: [{ Column: { Expression: { SourceRef: { Source: 'p' } }, Property: 'Product' }, Name: 'field' }],
                OrderBy: [{ Direction: 2, Expression: { Measure: { Expression: { SourceRef: { Source: 's' } }, Property: 'Total Sales' } } }],
                Top: 3
              }
            }
          },
          Type: 2
        },
        { Name: 'p', Entity: 'Product', Type: 0 }
      ],
      Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'p' } }, Property: 'Product' } }], Table: { SourceRef: { Source: 'subquery' } } } } }]
    }
    const n = normalizeReportFilter(f)
    expect(n.From).toHaveLength(1)
    expect(n.From![0].Name).toBe('subquery')
    const inner = (n.From![0].Expression as any).Subquery.Query
    expect(json(inner.Select)).toContain('"Entity":"Product"')
    expect(json(inner.OrderBy)).toContain('"Entity":"Sales"')
    expect(json(n.Where)).toContain('"Source":"subquery"')
    expect(json(n.Where)).toContain('"Entity":"Product"')
  })

  it('cards without a filter contribute nothing', () => {
    expect(cardFilters({ name: 'x', field: columnExpr('Sales', 'Category'), type: 'Categorical' })).toEqual([])
    expect(cardFilters({ name: 'x', type: 'Passthrough', filter: { Where: [] } as any })).toEqual([])
  })
})

describe('interactionKind', () => {
  const report = fixtureReport()
  const page = findPage(report, FIXTURE.overview)!
  it('honours NoFilter rules', () => {
    expect(interactionKind(page, FIXTURE.regionSlicer, FIXTURE.card, { sourceIsSlicer: true, targetSupportsHighlight: false, defaultIsFilter: false })).toBe('none')
  })
  it('defaults: highlight for charts, filter for others and for slicer sources', () => {
    const o = { sourceIsSlicer: false, targetSupportsHighlight: true, defaultIsFilter: false }
    expect(interactionKind(page, 'a', 'b', o)).toBe('highlight')
    expect(interactionKind(page, 'a', 'b', { ...o, targetSupportsHighlight: false })).toBe('filter')
    expect(interactionKind(page, 'a', 'b', { ...o, sourceIsSlicer: true })).toBe('filter')
    expect(interactionKind(page, 'a', 'b', { ...o, defaultIsFilter: true })).toBe('filter')
  })
  it('explicit DataFilter / HighlightFilter', () => {
    const p = { ...page, json: { ...page.json, visualInteractions: [{ source: 'a', target: 'b', type: 'DataFilter' }, { source: 'a', target: 'c', type: 'HighlightFilter' }] } }
    const o = { sourceIsSlicer: false, targetSupportsHighlight: true, defaultIsFilter: false }
    expect(interactionKind(p, 'a', 'b', o)).toBe('filter')
    expect(interactionKind(p, 'a', 'c', o)).toBe('highlight')
  })
})

describe('computeVisualFilters', () => {
  it('collects report + page + slicer filters for a chart (not its own selection)', () => {
    const { filters, highlightFilters } = computeVisualFilters(inputs(FIXTURE.categoryChart))
    // report Advanced filter (Amount > 0) + slicer (Region in North, East); the page card has no value
    expect(filters).toHaveLength(2)
    expect(json(filters[0])).toContain('"Property":"Amount"')
    expect(json(filters[1])).toContain("'North'")
    expect(highlightFilters).toEqual([])
  })

  it('does not apply a slicer to itself, and respects NoFilter interactions', () => {
    expect(computeVisualFilters(inputs(FIXTURE.regionSlicer)).filters).toHaveLength(1)
    expect(computeVisualFilters(inputs(FIXTURE.card)).filters).toHaveLength(1)
  })

  it('cross-filter selection: highlight for charts, filter for tables, nothing for the source', () => {
    const sel = { source: FIXTURE.categoryChart, identities: [{ fields: [{ expr: columnExpr('Sales', 'Category'), value: 'Bikes' }] }] }
    const chart = computeVisualFilters(inputs(FIXTURE.regionChart, { crossFilter: sel }))
    expect(chart.highlightFilters).toHaveLength(1)
    expect(json(chart.highlightFilters[0])).toContain("'Bikes'")
    const table = computeVisualFilters(inputs(FIXTURE.productTable, { crossFilter: sel }))
    expect(table.highlightFilters).toHaveLength(0)
    expect(json(table.filters)).toContain("'Bikes'")
    const self = computeVisualFilters(inputs(FIXTURE.categoryChart, { crossFilter: sel }))
    expect(json(self)).not.toContain("'Bikes'")
  })

  it('slicer-sourced selections always filter', () => {
    const sel = { source: FIXTURE.regionSlicer, identities: [{ fields: [{ expr: columnExpr('Sales', 'Region'), value: 'West' }] }] }
    const r = computeVisualFilters(inputs(FIXTURE.regionChart, { crossFilter: sel, slicerFilters: {} }))
    expect(r.highlightFilters).toHaveLength(0)
    expect(json(r.filters)).toContain("'West'")
  })

  it('runtime slicer overlay replaces saved selection; cleared slicer contributes nothing', () => {
    const overlay = inputs(FIXTURE.productTable, { slicerFilters: { [FIXTURE.regionSlicer]: inFilter('Sales', 'Region', ['South']) } })
    expect(json(computeVisualFilters(overlay).filters)).toContain("'South'")
    const cleared = inputs(FIXTURE.productTable, { slicerFilters: { [FIXTURE.regionSlicer]: undefined } })
    expect(computeVisualFilters(cleared).filters).toHaveLength(1)
  })

  it('applies own drill path and other visuals drill paths', () => {
    const path = [{ fields: [{ expr: columnExpr('Sales', 'Category'), value: 'Bikes' }] }]
    const own = computeVisualFilters(inputs(FIXTURE.categoryChart, { drillPath: path }))
    expect(json(own.filters)).toContain("'Bikes'")
    const other = computeVisualFilters(inputs(FIXTURE.productTable, { otherDrillPaths: { [FIXTURE.categoryChart]: path } }))
    expect(json(other.filters)).toContain("'Bikes'")
  })

  it('visual-level include/exclude cards apply to that visual only', () => {
    const inp = inputs(FIXTURE.productTable)
    const v = inp.page.visuals.find((x) => x.name === FIXTURE.productTable)!
    const card = includeExcludeCard('e1', [{ fields: [{ expr: columnExpr('Sales', 'Product'), value: 'Helmet' }] }], 'Exclude')!
    v.json.filterConfig = { filters: [card] }
    const r = computeVisualFilters(inp)
    expect(json(r.filters)).toContain('"Not"')
    expect(json(computeVisualFilters({ ...inp, visualName: FIXTURE.regionChart }).filters)).not.toContain('Helmet')
  })
})

describe('drill-through', () => {
  const report = fixtureReport()
  const details = findPage(report, FIXTURE.details)!
  const fields = drillthroughFields(details)
  const id = { fields: [{ expr: columnExpr('Sales', 'Category'), value: 'Clothing' }, { expr: columnExpr('Sales', 'Product'), value: 'Gloves' }] }

  it('finds drill-through fields from pageBinding / howCreated', () => {
    expect(fields.map((f) => f.key)).toEqual([fieldKey(columnExpr('Sales', 'Category'))])
    expect(canDrillthrough(fields, id)).toBe(true)
    expect(canDrillthrough(fields, { fields: [{ expr: columnExpr('Sales', 'Region'), value: 'x' }] })).toBe(false)
  })

  it('keep all filters carries the source context + whole identity', () => {
    const src = [inFilter('Sales', 'Region', ['North'])]
    const dt = buildDrillthrough(fields, id, src, true)!
    expect(dt.filters).toHaveLength(3)
    const page = pageScopeFilters(report, details, dt)
    expect(json(page)).toContain("'Clothing'")
    expect(json(page)).toContain("'North'")
  })

  it('without keep-all only the drill-through fields are passed', () => {
    const dt = buildDrillthrough(fields, id, [inFilter('Sales', 'Region', ['North'])], false)!
    expect(dt.filters).toHaveLength(1)
    expect(json(dt.filters)).not.toContain('Gloves')
  })

  it('replaces the saved drill-through card value', () => {
    const r2 = fixtureReport()
    const d2 = findPage(r2, FIXTURE.details)!
    d2.json.filterConfig.filters[0].filter = inFilter('Sales', 'Category', ['Bikes'])
    expect(json(pageScopeFilters(r2, d2, null))).toContain("'Bikes'")
    const dt = buildDrillthrough(fields, id, [], false)!
    const withDt = json(pageScopeFilters(r2, d2, dt))
    expect(withDt).not.toContain("'Bikes'")
    expect(withDt).toContain("'Clothing'")
  })
})

/** Corpus check: every filter card shape found in real PBIR reports converts without errors. */
const corpus = process.env.LUMEN_CORPUS_DIR
describe.skipIf(!corpus)('corpus filter cards', () => {
  function* walk(dir: string): Generator<string> {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e.startsWith('.')) continue
      const p = join(dir, e)
      const st = statSync(p)
      if (st.isDirectory()) yield* walk(p)
      else if (/(report|page|visual)\.json$/.test(e)) yield p
    }
  }
  it('normalizes every filterConfig filter (no alias refs left except subqueries)', () => {
    let cards = 0
    let withFilter = 0
    const types = new Set<string>()
    for (const file of walk(corpus!)) {
      const j = JSON.parse(readFileSync(file, 'utf8'))
      for (const c of j?.filterConfig?.filters ?? []) {
        cards++
        if (c.type) types.add(c.type)
        const out = cardFilters(c)
        if (c.filter?.Where?.length) {
          withFilter++
          expect(out).toHaveLength(1)
          const subNames = new Set((out[0].From ?? []).map((f) => f.Name))
          const refs = [...JSON.stringify(out[0].Where).matchAll(/"Source":"([^"]+)"/g)].map((m) => m[1])
          for (const r of refs) expect(subNames.has(r)).toBe(true)
        } else expect(out).toHaveLength(0)
      }
      const sf = savedSlicerFilter(j)
      if (sf) expect(JSON.stringify(normalizeReportFilter(sf))).not.toMatch(/"Source":/)
    }
    expect(cards).toBeGreaterThan(0)
    expect(withFilter).toBeGreaterThan(0)
    expect(types.size).toBeGreaterThan(0)
  })
})
