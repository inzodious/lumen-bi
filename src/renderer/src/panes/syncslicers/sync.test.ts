import { describe, expect, it } from 'vitest'
import { emptyReport, type ReportDocument } from '@core/report/types'
import { columnExpr } from '@core/report/sq'
import { setGroupOptions, setPageSync, setPageVisible, syncAllPages, syncState } from './sync'

function report(): ReportDocument {
  const r = emptyReport()
  const p1 = r.pages[0]
  p1.visuals.push({
    name: 's1',
    json: {
      name: 's1',
      position: { x: 1200, y: 10, width: 200, height: 60, z: 0, tabOrder: 0 },
      visual: { visualType: 'slicer', query: { queryState: { Values: { projections: [{ field: columnExpr('Product', 'Region'), queryRef: 'Product.Region' }] } } } }
    }
  })
  r.pages.push({ name: 'p2', json: { name: 'p2', displayName: 'Page 2', width: 1000, height: 720 }, visuals: [] })
  r.pages.push({ name: 'tt', json: { name: 'tt', displayName: 'Tip', pageBinding: { type: 'Tooltip' } }, visuals: [] })
  r.pagesMeta.pageOrder.push('p2', 'tt')
  return r
}

describe('sync slicers', () => {
  it('reports unsynced state with a default group name, skipping tooltip pages', () => {
    const r = report()
    const s = syncState(r, r.pages[0].name, 's1')!
    expect(s.groupName).toBe('Region')
    expect(s.hasGroup).toBe(false)
    expect(s.rows.map((x) => [x.page === 'p2', x.synced, x.visible])).toEqual([
      [false, false, true],
      [true, false, false]
    ])
  })

  it('sync without visible creates a hidden copy; unsync removes it', () => {
    const r = report()
    setPageSync(r, r.pages[0].name, 's1', 'p2', true)
    const copy = r.pages[1].visuals[0]
    expect(copy.json.isHidden).toBe(true)
    expect(copy.json.visual.syncGroup).toEqual({ groupName: 'Region', fieldChanges: true, filterChanges: true })
    expect(r.pages[0].visuals[0].json.visual.syncGroup.groupName).toBe('Region')
    expect(copy.json.position.x).toBe(800) // clamped into the narrower page
    const s = syncState(r, r.pages[0].name, 's1')!
    expect(s.rows[1]).toMatchObject({ synced: true, visible: false })
    setPageSync(r, r.pages[0].name, 's1', 'p2', false)
    expect(r.pages[1].visuals).toHaveLength(0)
  })

  it('visible toggles and add-to-all, group options apply to every member', () => {
    const r = report()
    syncAllPages(r, r.pages[0].name, 's1')
    expect(r.pages[1].visuals[0].json.isHidden).toBeUndefined()
    expect(r.pages[2].visuals).toHaveLength(0)
    setPageVisible(r, r.pages[0].name, 's1', 'p2', false)
    expect(r.pages[1].visuals[0].json.isHidden).toBe(true)
    setGroupOptions(r, r.pages[0].name, 's1', { groupName: 'Regions', filterChanges: false })
    expect(r.pages[1].visuals[0].json.visual.syncGroup).toEqual({ groupName: 'Regions', fieldChanges: true, filterChanges: false })
    expect(r.pages[0].visuals[0].json.visual.syncGroup.groupName).toBe('Regions')
  })
})

describe('sync field changes', () => {
  it('copies the field wells to grouped slicers that sync field changes and clears their selection', async () => {
    const { propagateSlicerFields } = await import('./sync')
    const r = report()
    const p1 = r.pages[0].name
    setPageSync(r, p1, 's1', 'p2', true)
    const copy = r.pages.find((p) => p.name === 'p2')!.visuals[0]
    copy.json.visual.objects = { general: [{ properties: { filter: { filter: { Version: 2 } } } }] }
    const src = r.pages[0].visuals[0]
    src.json.visual.query.queryState.Values.projections = [{ field: columnExpr('Product', 'Color'), queryRef: 'Product.Color' }]
    expect(propagateSlicerFields(r, p1, 's1')).toEqual([copy.name])
    expect(copy.json.visual.query.queryState.Values.projections[0].queryRef).toBe('Product.Color')
    expect(copy.json.visual.objects.general[0].properties.filter).toBeUndefined()
    // field changes off on the target → untouched
    setGroupOptions(r, 'p2', copy.name, { fieldChanges: false })
    src.json.visual.query.queryState.Values.projections = [{ field: columnExpr('Product', 'Size'), queryRef: 'Product.Size' }]
    const synced = syncState(r, p1, 's1')!
    expect(synced.fieldChanges).toBe(false)
    expect(propagateSlicerFields(r, p1, 's1')).toEqual([])
  })
})
