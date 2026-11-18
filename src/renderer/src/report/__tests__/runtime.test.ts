import { beforeEach, describe, expect, it } from 'vitest'
import { columnExpr, inFilter } from '@core/report/sq'
import { useApp } from '../../state/store'
import { useInteraction } from '../../state/interaction'
import {
  addBookmarkFromState,
  applyBookmark,
  clearAllSlicers,
  drillthrough,
  drillthroughTargets,
  effectiveSlicerFilter,
  flushSlicers,
  goBack,
  selectDataPoints,
  setSlicerFilter,
  syncTargets
} from '../runtime'
import { findPage, findVisual, savedSlicerFilter } from '../pbir'
import { FIXTURE, fixtureProject } from '../dev/fixture'

const report = () => useApp.getState().project!.report!
const visualJson = (page: string, v: string) => findVisual(findPage(report(), page), v)!.json

beforeEach(() => {
  useApp.getState().setProject(fixtureProject())
  useInteraction.getState().reset()
})

describe('slicers + sync groups', () => {
  it('finds synced slicers across pages', () => {
    expect(syncTargets(report(), FIXTURE.overview, FIXTURE.regionSlicer)).toEqual([{ page: FIXTURE.details, visual: FIXTURE.regionSlicer2 }])
  })

  it('propagates a selection to synced slicers and persists without an undo entry', () => {
    const undo = useApp.getState().undoStack.length
    setSlicerFilter(FIXTURE.overview, FIXTURE.regionSlicer, inFilter('Sales', 'Region', ['West']))
    // pending: the slicer sees it immediately, other visuals only after commit
    expect(JSON.stringify(effectiveSlicerFilter(findPage(report(), FIXTURE.overview)!, FIXTURE.regionSlicer, { includePending: true }))).toContain("'West'")
    flushSlicers()
    const it = useInteraction.getState()
    expect(JSON.stringify(it.slicers[FIXTURE.details][FIXTURE.regionSlicer2])).toContain("'West'")
    expect(JSON.stringify(savedSlicerFilter(visualJson(FIXTURE.overview, FIXTURE.regionSlicer)))).toContain("'West'")
    expect(JSON.stringify(savedSlicerFilter(visualJson(FIXTURE.details, FIXTURE.regionSlicer2)))).toContain("'West'")
    expect(useApp.getState().undoStack.length).toBe(undo)
    expect(useApp.getState().project!.dirty).toBe(true)
  })

  it('clear all slicers', () => {
    clearAllSlicers(FIXTURE.overview)
    expect(savedSlicerFilter(visualJson(FIXTURE.overview, FIXTURE.regionSlicer))).toBeUndefined()
    expect(savedSlicerFilter(visualJson(FIXTURE.details, FIXTURE.regionSlicer2))).toBeUndefined()
  })
})

describe('selection', () => {
  const bikes = { fields: [{ expr: columnExpr('Sales', 'Category'), value: 'Bikes' }] }
  const clothing = { fields: [{ expr: columnExpr('Sales', 'Category'), value: 'Clothing' }] }
  it('toggles single selection and supports multi-select', () => {
    selectDataPoints(FIXTURE.overview, FIXTURE.categoryChart, [bikes])
    expect(useInteraction.getState().crossFilter[FIXTURE.overview]!.identities).toHaveLength(1)
    selectDataPoints(FIXTURE.overview, FIXTURE.categoryChart, [clothing], { multi: true })
    expect(useInteraction.getState().crossFilter[FIXTURE.overview]!.identities).toHaveLength(2)
    selectDataPoints(FIXTURE.overview, FIXTURE.categoryChart, [clothing])
    selectDataPoints(FIXTURE.overview, FIXTURE.categoryChart, [clothing])
    expect(useInteraction.getState().crossFilter[FIXTURE.overview]).toBeUndefined()
  })
})

describe('drill-through + back', () => {
  it('navigates with filters and returns', () => {
    const id = { fields: [{ expr: columnExpr('Sales', 'Category'), value: 'Clothing' }] }
    expect(drillthroughTargets(id).map((t) => t.name)).toEqual([FIXTURE.details])
    useApp.getState().setActivePage(FIXTURE.overview)
    drillthrough(FIXTURE.overview, FIXTURE.details, id, [inFilter('Sales', 'Region', ['North'])])
    expect(useApp.getState().activePage).toBe(FIXTURE.details)
    const dt = useInteraction.getState().drillthrough[FIXTURE.details]!
    expect(JSON.stringify(dt.filters)).toContain("'Clothing'")
    expect(JSON.stringify(dt.filters)).toContain("'North'") // keep all filters (default)
    goBack()
    expect(useApp.getState().activePage).toBe(FIXTURE.overview)
  })
})

describe('bookmark capture/apply through the stores', () => {
  it('restores slicer state and page', () => {
    useApp.getState().setActivePage(FIXTURE.overview)
    setSlicerFilter(FIXTURE.overview, FIXTURE.regionSlicer, inFilter('Sales', 'Region', ['South']))
    const name = addBookmarkFromState({ displayName: 'South' })!
    expect(report().bookmarks.map((b) => b.name)).toContain(name)
    setSlicerFilter(FIXTURE.overview, FIXTURE.regionSlicer, inFilter('Sales', 'Region', ['West']))
    flushSlicers()
    useApp.getState().setActivePage(FIXTURE.hidden)
    applyBookmark(name)
    expect(useApp.getState().activePage).toBe(FIXTURE.overview)
    expect(JSON.stringify(effectiveSlicerFilter(findPage(report(), FIXTURE.overview)!, FIXTURE.regionSlicer))).toContain("'South'")
    expect(useInteraction.getState().appliedBookmark).toBe(name)
  })
})
