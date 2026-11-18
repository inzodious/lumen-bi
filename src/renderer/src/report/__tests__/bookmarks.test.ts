import { describe, expect, it } from 'vitest'
import { columnExpr, inFilter, type SQFilter } from '@core/report/sq'
import { addBookmark, captureBookmark, decodeDecomposedSelectors, encodeDecomposedSelectors, highlightToIdentities, identitiesToHighlight, planBookmarkApply, type RuntimeSnapshot } from '../bookmarks'
import { findPage, savedSlicerFilter, bookmarkList } from '../pbir'
import { FIXTURE, fixtureReport } from '../dev/fixture'
import type { DrillState } from '../../visuals/contract'

function runtime(over: Partial<RuntimeSnapshot> & { slicers?: Record<string, SQFilter | undefined>; drills?: Record<string, DrillState> } = {}): RuntimeSnapshot {
  return {
    activePage: FIXTURE.overview,
    slicerFilter: (_p, v) => over.slicers?.[v],
    drill: (_p, v) => over.drills?.[v] ?? { level: 0, path: [] },
    spotlight: over.spotlight ?? null,
    ...(over.activePage ? { activePage: over.activePage } : {})
  }
}

describe('bookmarks', () => {
  it('captures page, filters, slicer state, visibility, sort and drill', () => {
    const r = fixtureReport()
    findPage(r, FIXTURE.overview)!.visuals.find((v) => v.name === FIXTURE.productTable)!.json.visual.query.sortDefinition = {
      sort: [{ field: columnExpr('Sales', 'Product'), direction: 'Descending' }]
    }
    const bm = captureBookmark(
      r,
      runtime({
        slicers: { [FIXTURE.regionSlicer]: inFilter('Sales', 'Region', ['West']) },
        drills: { [FIXTURE.categoryChart]: { level: 1, path: [{ fields: [{ expr: columnExpr('Sales', 'Category'), value: 'Bikes' }] }] } }
      }),
      { displayName: 'My view' }
    )
    expect(bm.name).toMatch(/^Bookmark[0-9a-f]{20}$/)
    const es = bm.json.explorationState
    expect(es.activeSection).toBe(FIXTURE.overview)
    expect(es.filters.byExpr[0].expression).toBeDefined()
    const sec = es.sections[FIXTURE.overview]
    expect(JSON.stringify(sec.visualContainers[FIXTURE.regionSlicer].singleVisual.objects.merge.general)).toContain("'West'")
    expect(sec.visualContainers[FIXTURE.hiddenVisual].singleVisual.display.mode).toBe('hidden')
    expect(sec.visualContainers[FIXTURE.productTable].singleVisual.orderBy[0].Direction).toBe(2)
    expect(sec.visualContainers[FIXTURE.categoryChart].singleVisual.activeProjections.Category).toHaveLength(1)
    expect(bm.json.options).toBeUndefined()
  })

  it('round-trips: capture → change state → apply restores it', () => {
    const r = fixtureReport()
    const drill: DrillState = { level: 1, path: [{ fields: [{ expr: columnExpr('Sales', 'Category'), value: 'Bikes' }] }] }
    const bm = captureBookmark(r, runtime({ slicers: { [FIXTURE.regionSlicer]: inFilter('Sales', 'Region', ['West']) }, drills: { [FIXTURE.categoryChart]: drill } }), { displayName: 'b' })
    addBookmark(r, bm)
    expect(bookmarkList(r)).toEqual([{ name: bm.name, displayName: 'b' }])

    // change state: unhide the hidden card, hide the chart, set a report filter value
    const p = findPage(r, FIXTURE.overview)!
    delete p.visuals.find((v) => v.name === FIXTURE.hiddenVisual)!.json.isHidden
    p.visuals.find((v) => v.name === FIXTURE.categoryChart)!.json.isHidden = true
    r.report.filterConfig.filters[0].filter = inFilter('Sales', 'Amount', [1])

    const plan = planBookmarkApply(r, bm)
    expect(plan.activePage).toBe(FIXTURE.overview)
    expect(plan.slicers.find((s) => s.visual === FIXTURE.regionSlicer)!.filter).toEqual(inFilter('Sales', 'Region', ['West']))
    const d = plan.drill.find((x) => x.visual === FIXTURE.categoryChart)!.state!
    expect(d.level).toBe(1)
    expect(d.path[0].fields[0].value).toBe('Bikes')
    plan.mutate(r)
    expect(p.visuals.find((v) => v.name === FIXTURE.hiddenVisual)!.json.isHidden).toBe(true)
    expect(p.visuals.find((v) => v.name === FIXTURE.categoryChart)!.json.isHidden).toBeUndefined()
    expect(JSON.stringify(r.report.filterConfig.filters[0].filter)).toContain('Amount')
    expect(JSON.stringify(r.report.filterConfig.filters[0].filter)).toContain('ComparisonKind')
    expect(JSON.stringify(savedSlicerFilter(p.visuals.find((v) => v.name === FIXTURE.regionSlicer)!.json))).toContain("'West'")
  })

  it('respects data / display / current page options and selected visuals', () => {
    const r = fixtureReport()
    const displayOnly = captureBookmark(r, runtime({ activePage: FIXTURE.details }), { displayName: 'd', data: false, currentPage: false })
    expect(displayOnly.json.options).toEqual({ suppressData: true, suppressActiveSection: true })
    const plan = planBookmarkApply(r, displayOnly)
    expect(plan.activePage).toBeUndefined()
    expect(plan.slicers).toEqual([])

    const sel = captureBookmark(r, runtime(), { displayName: 's', targetVisualNames: [FIXTURE.card] })
    expect(Object.keys(sel.json.explorationState.sections[FIXTURE.overview].visualContainers)).toEqual([FIXTURE.card])
    const p = findPage(r, FIXTURE.overview)!
    p.visuals.find((v) => v.name === FIXTURE.categoryChart)!.json.isHidden = true
    planBookmarkApply(r, sel).mutate(r)
    // chart is outside the bookmark's target visuals → untouched
    expect(p.visuals.find((v) => v.name === FIXTURE.categoryChart)!.json.isHidden).toBe(true)
  })

  it('applies group visibility', () => {
    const r = fixtureReport()
    const p = findPage(r, FIXTURE.overview)!
    p.visuals.find((v) => v.name === FIXTURE.group)!.json.isHidden = true
    const bm = captureBookmark(r, runtime(), { displayName: 'g' })
    expect(bm.json.explorationState.sections[FIXTURE.overview].visualContainerGroups[FIXTURE.group].isHidden).toBe(true)
    delete p.visuals.find((v) => v.name === FIXTURE.group)!.json.isHidden
    planBookmarkApply(r, bm).mutate(r)
    expect(p.visuals.find((v) => v.name === FIXTURE.group)!.json.isHidden).toBe(true)
  })

  it('captures and restores focus mode (maximize) and show-as-table', () => {
    const r = fixtureReport()
    const focus = captureBookmark(r, { ...runtime(), focus: { page: FIXTURE.overview, visual: FIXTURE.categoryChart, mode: 'focus' } }, { displayName: 'Focus' })
    expect(focus.json.explorationState.sections[FIXTURE.overview].visualContainers[FIXTURE.categoryChart].singleVisual.display).toEqual({ mode: 'maximize' })
    expect(planBookmarkApply(r, focus).focus).toEqual({ page: FIXTURE.overview, visual: FIXTURE.categoryChart, mode: 'focus' })
    const table = captureBookmark(r, { ...runtime(), focus: { page: FIXTURE.overview, visual: FIXTURE.categoryChart, mode: 'table' } }, { displayName: 'Table' })
    expect(planBookmarkApply(r, table).focus?.mode).toBe('table')
    // no focus captured → applying leaves focus mode
    expect(planBookmarkApply(r, captureBookmark(r, runtime(), { displayName: 'x' })).focus).toBeNull()
  })

  it('captures and restores cross-highlight selections (HighlightState)', () => {
    const r = fixtureReport()
    const ids = [{ fields: [{ expr: columnExpr('Sales', 'Category'), value: 'Bikes' }] }, { fields: [{ expr: columnExpr('Sales', 'Category'), value: 'Helmets' }] }]
    const bm = captureBookmark(r, { ...runtime(), crossFilter: (p) => (p === FIXTURE.overview ? { source: FIXTURE.categoryChart, identities: ids } : undefined) }, { displayName: 'Sel' })
    const hl = bm.json.explorationState.sections[FIXTURE.overview].visualContainers[FIXTURE.categoryChart].highlight
    expect(hl.selection).toHaveLength(2)
    expect(JSON.stringify(hl.selection[0].dataMap)).toContain("'Bikes'")
    expect(hl.filterExpressionMetadata.expressions).toHaveLength(1)
    const plan = planBookmarkApply(r, bm)
    expect(plan.crossFilters).toEqual([{ page: FIXTURE.overview, source: FIXTURE.categoryChart, identities: ids }])
    // without data capture, selections are not stored
    const noData = captureBookmark(r, { ...runtime(), crossFilter: () => ({ source: FIXTURE.categoryChart, identities: ids }) }, { displayName: 'n', data: false })
    expect(planBookmarkApply(r, noData).crossFilters).toEqual([])
  })

  it('highlight state round-trips numbers, dates and booleans', () => {
    const ids = [{ fields: [{ expr: columnExpr('Sales', 'Year'), value: 2024 }, { expr: columnExpr('Sales', 'Day'), value: new Date(Date.UTC(2024, 0, 2)) }, { expr: columnExpr('Sales', 'Flag'), value: true }] }]
    expect(highlightToIdentities(identitiesToHighlight({}, ids))).toEqual(ids)
  })
})

describe('DecomposedSelectors (compressed highlight selection)', () => {
  const col = (t: string, c: string) => ({ Column: { Expression: { SourceRef: { Entity: t } }, Property: c } })
  const lit = (v: string) => ({ Literal: { Value: v } })
  const eq = (l: any, r: any) => ({ Comparison: { ComparisonKind: 0, Left: l, Right: r } })
  const selectors = [
    { dataMap: { 'Product.Category': [{ scopeId: eq(col('Product', 'Category'), lit("'Bikes'")) }] } },
    { dataMap: { 'Product.Category': [{ scopeId: eq(col('Product', 'Category'), lit("'Clothing'")) }] } },
    {
      dataMap: {
        'Region.Country': [{ scopeId: { And: { Left: eq(col('Region', 'Country'), lit("'France'")), Right: eq(col('Date', 'Year'), lit('2024L')) } } }]
      },
      metadata: ['Sales.Total Sales'],
      id: 'x1'
    }
  ]

  it('encodes column shapes once and expands back to the same SelectorsByColumn[]', () => {
    const enc = encodeDecomposedSelectors(selectors)
    expect(enc.decomposedIdentities.columns.length).toBe(2)
    expect(enc.queryNames).toEqual(['Product.Category', 'Region.Country'])
    expect(enc.decomposedIdentities.values[0]).toEqual([{ '0': [lit("'Bikes'")] }])
    expect(enc.decomposedIdentities.values[2]).toEqual([{ '1': [lit("'France'"), lit('2024L')] }])
    const dec = decodeDecomposedSelectors(enc)
    expect(dec[0]).toEqual(selectors[0])
    expect(dec[1]).toEqual(selectors[1])
    expect(dec[2]).toEqual(selectors[2])
  })

  it('applies a decomposed highlight as data point identities', () => {
    const ids = highlightToIdentities({ selection: encodeDecomposedSelectors(selectors) })
    expect(ids.length).toBe(3)
    expect(ids[0].fields.map((f) => f.value)).toEqual(['Bikes'])
    expect(ids[2].fields.map((f) => f.value)).toEqual(['France', 2024])
  })

  it('tolerates missing or unknown parts', () => {
    expect(highlightToIdentities({ selection: {} })).toEqual([])
    expect(decodeDecomposedSelectors({ decomposedIdentities: { columns: [{ value: col('A', 'b') }], values: [[{ '0': [lit("'x'")] }]] } })[0].dataMap).toEqual({ selection: [{ scopeId: eq(col('A', 'b'), lit("'x'")) }] })
  })
})
