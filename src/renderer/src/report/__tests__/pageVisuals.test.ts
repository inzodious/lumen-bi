import { describe, expect, it } from 'vitest'
import { inFilter } from '@core/report/sq'
import { pageVisualInfos, usePageVisualFilters, type VisualFilterSet } from '../host'
import { findPage } from '../pbir'
import { FIXTURE, fixtureReport } from '../dev/fixture'

describe('ReportInfo.pageVisuals', () => {
  it('lists every visual of the page with the effective filters the canvas published', () => {
    const r = fixtureReport()
    const page = findPage(r, FIXTURE.overview)!
    const f = inFilter('Sales', 'Region', ['West'])
    const map = new Map<string, VisualFilterSet>([[FIXTURE.categoryChart, { filters: [f] }]])
    const infos = pageVisualInfos(r, FIXTURE.overview, map)
    expect(infos.map((i) => i.visual.name)).toEqual(page.visuals.map((v) => v.name))
    expect(infos.find((i) => i.visual.name === FIXTURE.categoryChart)!.filters).toEqual([f])
    // visuals the canvas hasn't computed yet carry no filters (the narrative falls back to its own)
    expect(infos.find((i) => i.visual.name === FIXTURE.productTable)!.filters).toBeUndefined()
  })

  it('without published filters, still lists the visuals; unknown page → empty', () => {
    const r = fixtureReport()
    expect(pageVisualInfos(r, FIXTURE.overview, undefined).every((i) => i.filters === undefined)).toBe(true)
    expect(pageVisualInfos(r, 'nope', undefined)).toEqual([])
  })

  it('publishing the same map is a no-op (no store churn)', () => {
    const map = new Map<string, VisualFilterSet>()
    usePageVisualFilters.getState().publish('p', map)
    const before = usePageVisualFilters.getState().byPage
    usePageVisualFilters.getState().publish('p', map)
    expect(usePageVisualFilters.getState().byPage).toBe(before)
  })
})
