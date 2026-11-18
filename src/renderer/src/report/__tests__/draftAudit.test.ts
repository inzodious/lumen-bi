/**
 * Draft audit: every report edit operation runs inside the store's immer `produce`, where the document it edits is a
 * draft (a Proxy). Each exported operation of the edit-op modules below is run here the same way (immer, autoFreeze
 * off, like state/store.ts) against the fixture report, and must not throw and must make its change. Operations that
 * deep-copied a draft with `structuredClone` threw `DataCloneError` here (duplicate page, wells, slicer sync, …).
 *
 * Completeness: for each audited module, every exported function is either exercised below or listed in
 * `NOT_EDITS` with the reason it never receives a draft. A new export fails the test until it is classified.
 */
import { describe, expect, it } from 'vitest'
import { Immer } from 'immer'
import type { PageDocument, ReportDocument, VisualDocument } from '@core/report/types'
import { columnExpr, measureExpr, SQ_AGG } from '@core/report/sq'
import { literalProp } from '@core/report/props'
import { FIXTURE as F, fixtureModel, fixtureReport } from '../dev/fixture'
import { findPage, findVisual, positionOf } from '../pbir'
import * as editOps from '../editOps'
import * as wells from '../../panes/visualizations/wells'
import * as sync from '../../panes/syncslicers/sync'
import * as bookmarks from '../bookmarks'
import * as bookmarkPane from '../../panes/bookmarks/bookmarks'
import * as painter from '../formatPainter'
import * as layers from '../../panes/selection/layers'
import * as mobileLayout from '../mobile/layout'
import * as mobileFormat from '../mobile/format'
import * as fieldOps from '../../panes/data/visualFieldOps'
import * as filterModel from '../../panes/filters/filterModel'

const immer = new Immer({ autoFreeze: false })

/** Run `edit` on a draft of a fresh fixture report (the way the store runs mutators); returns before / after. */
function edit(fn: (draft: ReportDocument) => void, base: ReportDocument = fixtureReport()): { before: ReportDocument; after: ReportDocument } {
  const after = immer.produce(base, (d: ReportDocument) => {
    fn(d)
  })
  return { before: base, after }
}
const pageOf = (r: ReportDocument, name = F.overview): PageDocument => findPage(r, name)!
const visualOf = (r: ReportDocument, v: string, p = F.overview): VisualDocument => findVisual(pageOf(r, p), v)!
const roles = (json: any) => Object.fromEntries(Object.entries<any>(json.visual.query.queryState).map(([k, b]) => [k, b.projections.map((p: any) => p.queryRef)]))
const SEGMENT = columnExpr('Sales', 'Segment')
const COST = measureExpr('Sales', 'Total Cost')
const lit = literalProp

/** A fixture with a bookmark captured from the plain report (capture runs outside a mutation in the app). */
function withBookmark(): { base: ReportDocument; bm: ReturnType<typeof bookmarks.captureBookmark> } {
  const base = fixtureReport()
  const bm = bookmarks.captureBookmark(base, runtime(), { displayName: 'B1', name: 'Bookmark1' })
  base.bookmarks.push(bm)
  base.bookmarksMeta = { items: [{ name: bm.name }] }
  return { base, bm }
}
function runtime(): bookmarks.RuntimeSnapshot {
  return { activePage: F.overview, slicerFilter: () => undefined, drill: () => ({ level: 0, path: [] }) }
}

// ---------------------------------------------------------------------------------------------
// The audit table: [module, export name, check]
// ---------------------------------------------------------------------------------------------

type Check = () => void
const AUDIT: Record<string, Record<string, Check>> = {
  editOps: {
    addPage: () => {
      const { before, after } = edit((d) => editOps.addPage(d, { after: F.overview }))
      expect(after.pages.length).toBe(before.pages.length + 1)
    },
    duplicatePage: () => {
      let dup: string | undefined
      const { after } = edit((d) => (dup = editOps.duplicatePage(d, F.overview)))
      const copy = pageOf(after, dup)
      expect(copy.json.displayName).toBe('Duplicate of Overview')
      expect(copy.visuals.length).toBe(pageOf(after).visuals.length)
      expect(after.pagesMeta.pageOrder.indexOf(dup!)).toBe(after.pagesMeta.pageOrder.indexOf(F.overview) + 1)
      // the copy is independent: no object shared with the source page
      expect(copy.visuals[0].json).not.toBe(pageOf(after).visuals[0].json)
      expect(copy.json.visualInteractions[0].source).not.toBe(F.regionSlicer)
    },
    deletePage: () => expect(edit((d) => editOps.deletePage(d, F.hidden)).after.pages.some((p) => p.name === F.hidden)).toBe(false),
    renamePage: () => expect(pageOf(edit((d) => editOps.renamePage(d, F.overview, 'Summary')).after).json.displayName).toBe('Summary'),
    setPageHidden: () => expect(pageOf(edit((d) => editOps.setPageHidden(d, F.overview, true)).after).json.visibility).toBe('HiddenInViewMode'),
    movePage: () => expect(edit((d) => editOps.movePage(d, F.hidden, 0)).after.pagesMeta.pageOrder[0]).toBe(F.hidden),
    setAbsoluteRects: () => expect(visualOf(edit((d) => editOps.setAbsoluteRects(pageOf(d), { [F.card]: { x: 900 } })).after, F.card).json.position.x).toBe(900),
    fitGroupToChildren: () => {
      const { after } = edit((d) => {
        const child = pageOf(d).visuals.find((v) => v.json.parentGroupName === F.group)!
        child.json.position.width = 400
        editOps.fitGroupToChildren(pageOf(d), F.group)
      })
      expect(visualOf(after, F.group).json.position.width).toBeGreaterThan(192)
    },
    moveVisualsBy: () => expect(visualOf(edit((d) => editOps.moveVisualsBy(pageOf(d), [F.card], 10, 0)).after, F.card).json.position.x).toBe(854),
    topLevelOf: () => expect(edit((d) => expect(editOps.topLevelOf(pageOf(d), [F.card])).toEqual([F.card])).after).toBeDefined(),
    alignVisuals: () => expect(visualOf(edit((d) => editOps.alignVisuals(pageOf(d), [F.card, F.categoryChart], 'top')).after, F.card).json.position.y).toBe(24),
    distributeVisualsWithGap: () => {
      const { before, after } = edit((d) => editOps.distributeVisualsWithGap(pageOf(d), [F.regionSlicer, F.categoryChart, F.card], 'horizontal', 5))
      expect(visualOf(after, F.categoryChart).json.position.x).not.toBe(visualOf(before, F.categoryChart).json.position.x)
    },
    tidyUpVisuals: () => expect(edit((d) => editOps.tidyUpVisuals(pageOf(d), [F.regionSlicer, F.categoryChart, F.card], 10)).after).toBeDefined(),
    matchVisualSize: () => expect(visualOf(edit((d) => editOps.matchVisualSize(pageOf(d), [F.categoryChart, F.card], 'width')).after, F.card).json.position.width).toBe(560),
    resizeVisualsBy: () => expect(visualOf(edit((d) => editOps.resizeVisualsBy(pageOf(d), [F.card], 10, 0)).after, F.card).json.position.width).toBe(210),
    distributeVisuals: () => expect(edit((d) => editOps.distributeVisuals(pageOf(d), [F.regionSlicer, F.categoryChart, F.card], 'horizontal')).after).toBeDefined(),
    reorderZ: () => {
      const { after } = edit((d) => editOps.reorderZ(pageOf(d), [F.regionSlicer], 'front'))
      const z = positionOf(visualOf(after, F.regionSlicer)).z
      expect(pageOf(after).visuals.filter((v) => !v.json.parentGroupName).every((v) => positionOf(v).z <= z)).toBe(true)
    },
    addVisual: () => {
      const { before, after } = edit((d) => editOps.addVisual(pageOf(d), 'card', { x: 0, y: 0, width: 100, height: 100 }))
      expect(pageOf(after).visuals.length).toBe(pageOf(before).visuals.length + 1)
    },
    deleteVisuals: () => expect(findVisual(pageOf(edit((d) => editOps.deleteVisuals(pageOf(d), [F.card])).after), F.card)).toBeUndefined(),
    copyVisuals: () => {
      // copying inside an edit (cut = copy + delete in one step) must yield plain data that outlives the draft
      let clip: editOps.VisualClipboard | undefined
      edit((d) => (clip = editOps.copyVisuals(pageOf(d), [F.group])))
      expect(clip!.visuals.map((v) => v.name)).toContain(F.group)
      expect(JSON.parse(JSON.stringify(clip)).visuals.length).toBe(3)
    },
    pasteVisuals: () => {
      const clip = editOps.copyVisuals(pageOf(fixtureReport()), [F.card])
      const { before, after } = edit((d) => editOps.pasteVisuals(pageOf(d, F.details), clip))
      expect(pageOf(after, F.details).visuals.length).toBe(pageOf(before, F.details).visuals.length + 1)
    },
    duplicateVisuals: () => {
      let names: string[] = []
      const { before, after } = edit((d) => (names = editOps.duplicateVisuals(pageOf(d), [F.group, F.card])))
      expect(names.length).toBe(2)
      expect(pageOf(after).visuals.length).toBe(pageOf(before).visuals.length + 4)
    },
    groupVisuals: () => {
      let g: string | undefined
      const { after } = edit((d) => (g = editOps.groupVisuals(pageOf(d), [F.card, F.regionChart])))
      expect(visualOf(after, F.card).json.parentGroupName).toBe(g)
    },
    ungroupVisuals: () => expect(findVisual(pageOf(edit((d) => editOps.ungroupVisuals(pageOf(d), [F.group])).after), F.group)).toBeUndefined(),
    setVisualsHidden: () => expect(visualOf(edit((d) => editOps.setVisualsHidden(pageOf(d), [F.card], true)).after, F.card).json.isHidden).toBe(true),
    tabOrder: () => expect(edit((d) => expect(editOps.tabOrder(pageOf(d)).length).toBeGreaterThan(3)).after).toBeDefined()
  },

  wells: {
    addProjection: () => {
      // the reported orders: Legend after axis + value (column chart), a value after the X-axis (line chart)
      const { after } = edit((d) => {
        const json = visualOf(d, F.categoryChart).json
        expect(wells.addProjection(json, 'Series', SEGMENT, { max: 1 })).toBe(true)
        json.visual.visualType = 'lineChart'
        delete json.visual.query.sortDefinition
        expect(wells.addProjection(json, 'Y', COST)).toBe(true)
      })
      const json = visualOf(after, F.categoryChart).json
      expect(roles(json)).toEqual({ Category: ['Sales.Category', 'Sales.Product'], Y: ['Sales.Total Sales', 'Sales.Total Cost'], Series: ['Sales.Segment'] })
      expect(json.visual.query.sortDefinition).toEqual({ sort: [{ field: columnExpr('Sales', 'Category'), direction: 'Ascending' }], isDefaultSort: true })
    },
    applyDefaultSort: () => {
      const { after } = edit((d) => wells.applyDefaultSort(visualOf(d, F.categoryChart).json))
      expect(visualOf(after, F.categoryChart).json.visual.query.sortDefinition.sort[0]).toEqual({ field: measureExpr('Sales', 'Total Sales'), direction: 'Descending' })
    },
    removeProjection: () => expect(roles(visualOf(edit((d) => wells.removeProjection(visualOf(d, F.categoryChart).json, 'Category', 1)).after, F.categoryChart).json).Category).toEqual(['Sales.Category']),
    moveProjection: () => {
      const { after } = edit((d) => expect(wells.moveProjection(visualOf(d, F.categoryChart).json, 'Category', 1, 'Series', 0)).toBe(true))
      expect(roles(visualOf(after, F.categoryChart).json).Series).toEqual(['Sales.Product'])
    },
    setAggregation: () => {
      // the field is already in the well (part of the draft), as when its well menu is used
      const base = fixtureReport()
      const json0 = visualOf(base, F.productTable).json
      wells.addProjection(json0, 'Values', { Aggregation: { Expression: columnExpr('Sales', 'Amount'), Function: SQ_AGG.Sum } })
      const i = json0.visual.query.queryState.Values.projections.length - 1
      const { after } = edit((d) => wells.setAggregation(visualOf(d, F.productTable).json, 'Values', i, SQ_AGG.Avg), base)
      const ps = visualOf(after, F.productTable).json.visual.query.queryState.Values.projections
      expect(ps[i].field).toEqual({ Aggregation: { Expression: columnExpr('Sales', 'Amount'), Function: SQ_AGG.Avg } })
      const { after: plain } = edit((d) => wells.setAggregation(visualOf(d, F.productTable).json, 'Values', i, null), base)
      expect(visualOf(plain, F.productTable).json.visual.query.queryState.Values.projections[i].field).toEqual(columnExpr('Sales', 'Amount'))
    },
    renameProjection: () => expect(visualOf(edit((d) => wells.renameProjection(visualOf(d, F.card).json, 'Values', 0, 'Revenue')).after, F.card).json.visual.query.queryState.Values.projections[0].displayName).toBe('Revenue'),
    setShowAll: () => expect(visualOf(edit((d) => wells.setShowAll(visualOf(d, F.categoryChart).json, 'Category', true)).after, F.categoryChart).json.visual.query.queryState.Category.showAll).toBe(true),
    setShowValueAs: () => {
      const { after } = edit((d) => {
        const json = visualOf(d, F.categoryChart).json
        json.visual.query.sortDefinition = { sort: [{ field: measureExpr('Sales', 'Total Sales'), direction: 'Descending' }] }
        wells.setShowValueAs(json, 'Y', 0, 'percentOfGrandTotal')
      })
      const json = visualOf(after, F.categoryChart).json
      expect(wells.getShowValueAs(json.visual.query.queryState.Y.projections[0])).toBe('percentOfGrandTotal')
      expect(json.visual.query.sortDefinition.sort[0].field.Arithmetic).toBeDefined()
    },
    applyDateSlicerDefault: () => {
      const model = fixtureModel()
      const { after } = edit((d) => {
        const json = visualOf(d, F.regionSlicer).json
        json.visual.query.queryState.Values.projections = [{ field: columnExpr('Sales', 'OrderDate'), queryRef: 'Sales.OrderDate' }]
        delete json.visual.objects.data
        wells.applyDateSlicerDefault(json, model)
      })
      expect(visualOf(after, F.regionSlicer).json.visual.objects.data?.[0]?.properties?.mode).toEqual({ expr: { Literal: { Value: "'Between'" } } })
    }
  },

  sync: {
    setPageSync: () => {
      const { before, after } = edit((d) => sync.setPageSync(d, F.overview, F.card, F.hidden, true))
      expect(pageOf(after, F.hidden).visuals.length).toBe(pageOf(before, F.hidden).visuals.length + 1)
    },
    setPageVisible: () => {
      // the reported failure: Sync slicers pane ▸ Visible on another page
      const { after } = edit((d) => sync.setPageVisible(d, F.overview, F.regionSlicer, F.hidden, true))
      const copy = pageOf(after, F.hidden).visuals.find((v) => v.json.visual?.syncGroup?.groupName === 'Region')!
      expect(copy.json.isHidden).toBeUndefined()
      expect(copy.json.visual.query).toEqual(visualOf(after, F.regionSlicer).json.visual.query)
      expect(copy.json.visual.query).not.toBe(visualOf(after, F.regionSlicer).json.visual.query)
    },
    syncAllPages: () => {
      const { after } = edit((d) => sync.syncAllPages(d, F.overview, F.regionSlicer))
      expect(pageOf(after, F.hidden).visuals.some((v) => v.json.visual?.syncGroup?.groupName === 'Region')).toBe(true)
    },
    setGroupOptions: () => expect(visualOf(edit((d) => sync.setGroupOptions(d, F.overview, F.regionSlicer, { groupName: 'Area' })).after, F.regionSlicer2, F.details).json.visual.syncGroup.groupName).toBe('Area'),
    propagateSlicerFields: () => {
      const { after } = edit((d) => {
        visualOf(d, F.regionSlicer).json.visual.query.queryState.Values.projections = [{ field: SEGMENT, queryRef: 'Sales.Segment' }]
        expect(sync.propagateSlicerFields(d, F.overview, F.regionSlicer)).toEqual([F.regionSlicer2])
      })
      expect(roles(visualOf(after, F.regionSlicer2, F.details).json).Values).toEqual(['Sales.Segment'])
    }
  },

  bookmarks: {
    captureBookmark: () => {
      // capture reads a draft when run inside an edit (e.g. a future "capture on change"): must not throw
      edit((d) => {
        const bm = bookmarks.captureBookmark(d, runtime(), { displayName: 'B', name: 'B' })
        expect(bm.json.explorationState.sections[F.overview]).toBeDefined()
        expect(JSON.parse(JSON.stringify(bm)).name).toBe('B')
      })
    },
    planBookmarkApply: () => {
      const { base, bm } = withBookmark()
      // the bookmark restores the hidden state the capture saw
      const plan = bookmarks.planBookmarkApply(base, bm)
      const { after } = edit((d) => {
        visualOf(d, F.card).json.isHidden = true
        plan.mutate(d)
      }, base)
      expect(visualOf(after, F.card).json.isHidden).toBeUndefined()
    },
    addBookmark: () => {
      const bm = bookmarks.captureBookmark(fixtureReport(), runtime(), { displayName: 'B', name: 'B' })
      expect(edit((d) => bookmarks.addBookmark(d, bm)).after.bookmarks.map((b) => b.name)).toEqual(['B'])
    },
    updateBookmark: () => {
      const { base } = withBookmark()
      const captured = bookmarks.captureBookmark(base, runtime(), { displayName: 'X', name: 'Bookmark1', currentPage: false })
      const { after } = edit((d) => bookmarks.updateBookmark(d, 'Bookmark1', captured), base)
      expect(after.bookmarks[0].json.displayName).toBe('B1')
    },
    deleteBookmark: () => expect(edit((d) => bookmarks.deleteBookmark(d, 'Bookmark1'), withBookmark().base).after.bookmarks).toEqual([])
  },

  bookmarkPane: {
    renameBookmark: () => expect(edit((d) => bookmarkPane.renameBookmark(d, 'Bookmark1', 'Renamed'), withBookmark().base).after.bookmarks[0].json.displayName).toBe('Renamed'),
    setBookmarkOption: () => expect(edit((d) => bookmarkPane.setBookmarkOption(d, 'Bookmark1', 'data', false), withBookmark().base).after.bookmarks[0].json.options.suppressData).toBe(true),
    groupBookmarks: () => expect(edit((d) => bookmarkPane.groupBookmarks(d, ['Bookmark1']), withBookmark().base).after.bookmarksMeta.items[0].children).toEqual(['Bookmark1']),
    ungroupBookmarks: () => {
      const { base } = withBookmark()
      base.bookmarksMeta.items = [{ name: 'G', displayName: 'Group', children: ['Bookmark1'] }]
      expect(edit((d) => bookmarkPane.ungroupBookmarks(d, 'G'), base).after.bookmarksMeta.items).toEqual([{ name: 'Bookmark1' }])
    },
    moveBookmark: () => {
      const { base } = withBookmark()
      const second = bookmarks.captureBookmark(base, runtime(), { displayName: 'B2', name: 'Bookmark2' })
      base.bookmarks.push(second)
      base.bookmarksMeta.items.push({ name: 'Bookmark2' })
      expect(edit((d) => bookmarkPane.moveBookmark(d, 'Bookmark2', -1), base).after.bookmarksMeta.items.map((i: any) => i.name)).toEqual(['Bookmark2', 'Bookmark1'])
    }
  },

  painter: {
    applyFormat: () => {
      // painting onto a visual with a title keeps the target's title text (copied from the draft)
      const fmt = painter.copyFormat(visualOf(fixtureReport(), F.card).json)!
      const { after } = edit((d) => expect(painter.applyFormat(visualOf(d, F.productTable).json, fmt)).toBe(true))
      const vco = visualOf(after, F.productTable).json.visual.visualContainerObjects
      expect(vco.title[0].properties.text).toEqual(lit('Products'))
      expect(vco.border).toEqual(visualOf(after, F.card).json.visual.visualContainerObjects.border)
    },
    copyFormat: () => {
      let fmt: painter.CopiedFormat | null = null
      edit((d) => (fmt = painter.copyFormat(visualOf(d, F.card).json)))
      expect(JSON.parse(JSON.stringify(fmt)).visualType).toBe('card')
    }
  },

  layers: {
    renameLayer: () => expect(visualOf(edit((d) => layers.renameLayer(visualOf(d, F.card), 'Total')).after, F.card).json.visual.visualContainerObjects.title[0].properties.text).toEqual(lit('Total')),
    moveLayerAbove: () => {
      const { after } = edit((d) => expect(layers.moveLayerAbove(pageOf(d), F.regionSlicer, F.card)).toBe(true))
      expect(positionOf(visualOf(after, F.regionSlicer)).z).toBeGreaterThan(positionOf(visualOf(after, F.card)).z)
    },
    moveTabOrder: () => {
      const { before, after } = edit((d) => layers.moveTabOrder(pageOf(d), F.card, -1))
      expect(layers.tabOrderList(pageOf(after)).map((v) => v.name)).not.toEqual(layers.tabOrderList(pageOf(before)).map((v) => v.name))
    }
  },

  mobileLayout: {
    addToMobile: () => expect(mobileLayout.isPlaced(visualOf(edit((d) => expect(mobileLayout.addToMobile(pageOf(d), F.card)).toBe(true)).after, F.card))).toBe(true),
    setMobileRects: () => {
      const base = edit((d) => mobileLayout.addToMobile(pageOf(d), F.card)).after
      expect(mobileLayout.mobileRect(visualOf(edit((d) => mobileLayout.setMobileRects(pageOf(d), { [F.card]: { x: 20, y: 40, width: 200, height: 100 } }), base).after, F.card))?.y).toBe(40)
    },
    moveMobileBy: () => {
      const base = edit((d) => mobileLayout.addToMobile(pageOf(d), F.card, { x: 0, y: 0 })).after
      expect(mobileLayout.mobileRect(visualOf(edit((d) => mobileLayout.moveMobileBy(pageOf(d), [F.card], 0, 40), base).after, F.card))?.y).toBe(40)
    },
    removeFromMobile: () => {
      const base = edit((d) => mobileLayout.addToMobile(pageOf(d), F.card)).after
      expect(mobileLayout.isPlaced(visualOf(edit((d) => mobileLayout.removeFromMobile(pageOf(d), [F.card]), base).after, F.card))).toBe(false)
    },
    clearMobile: () => {
      const base = edit((d) => mobileLayout.addToMobile(pageOf(d), F.card)).after
      expect(mobileLayout.placedVisuals(pageOf(edit((d) => mobileLayout.clearMobile(pageOf(d)), base).after))).toEqual([])
    },
    reorderMobile: () => {
      const base = edit((d) => {
        mobileLayout.addToMobile(pageOf(d), F.card)
        mobileLayout.addToMobile(pageOf(d), F.regionChart)
      }).after
      const { after } = edit((d) => mobileLayout.reorderMobile(pageOf(d), [F.card], 'front'), base)
      expect(mobileLayout.mobileRect(visualOf(after, F.card))!.z).toBeGreaterThan(mobileLayout.mobileRect(visualOf(after, F.regionChart))!.z)
    },
    autoCreateMobile: () => expect(mobileLayout.placedVisuals(pageOf(edit((d) => mobileLayout.autoCreateMobile(pageOf(d))).after)).length).toBeGreaterThan(3)
  },

  mobileFormat: {
    seedMobileObject: () => {
      const base = edit((d) => mobileLayout.addToMobile(pageOf(d), F.card)).after
      const { after } = edit((d) => mobileFormat.seedMobileObject(visualOf(d, F.card), true, 'border'), base)
      const v = visualOf(after, F.card)
      expect(v.mobile.visualContainerObjects.border).toEqual(v.json.visual.visualContainerObjects.border)
      expect(v.mobile.visualContainerObjects.border).not.toBe(v.json.visual.visualContainerObjects.border)
    },
    resetMobileFormatting: () => {
      const base = edit((d) => {
        mobileLayout.addToMobile(pageOf(d), F.card)
        mobileFormat.seedMobileObject(visualOf(d, F.card), true, 'border')
      }).after
      const { after } = edit((d) => expect(mobileFormat.resetMobileFormatting(visualOf(d, F.card))).toBe(true), base)
      expect(mobileFormat.mobileOverrides(visualOf(after, F.card))).toEqual([])
    },
    mobileBag: () => {
      const base = edit((d) => mobileLayout.addToMobile(pageOf(d), F.card)).after
      expect(visualOf(edit((d) => mobileFormat.mobileBag(visualOf(d, F.card), false, true), base).after, F.card).mobile.objects).toEqual({})
    }
  },

  fieldOps: {
    addFieldToVisual: () => {
      const model = fixtureModel()
      const { after } = edit((d) => {
        const json = visualOf(d, F.regionChart).json
        expect(fieldOps.addFieldToVisual(json, { kind: 'measure', table: 'Sales', name: 'Total Sales' }, model)).toBe('Y')
      })
      expect(roles(visualOf(after, F.regionChart).json).Y).toEqual(['Sales.Total Quantity', 'Sales.Total Sales'])
    },
    removeFieldFromVisual: () => expect(roles(visualOf(edit((d) => fieldOps.removeFieldFromVisual(visualOf(d, F.categoryChart).json, { kind: 'column', table: 'Sales', name: 'Product' })).after, F.categoryChart).json).Category).toEqual(['Sales.Category'])
  },

  filterModel: {
    applyModelToCard: () => {
      const { after } = edit((d) => {
        const card = pageOf(d).json.filterConfig.filters[0]
        filterModel.applyModelToCard(card, { ...filterModel.emptyModel('basic'), values: ['Bikes'] } as any, 'text')
      })
      expect(filterModel.isFiltering(pageOf(after).json.filterConfig.filters[0])).toBe(true)
    }
  }
}

/** Exports of the audited modules that never take a draft (read-only queries / pure builders / store commands). */
const NOT_EDITS: Record<string, Record<string, string>> = {
  editOps: {},
  wells: {
    nativeName: 'pure: name of an expression',
    makeProjection: 'pure builder (callers pass plain or cloned expressions)',
    roleProjections: 'read-only accessor',
    getShowAll: 'read-only',
    percentOfGrandTotal: 'builder, deep-copies its argument with cloneDeep (exercised by setShowValueAs)',
    percentOfGrandTotalInner: 'read-only',
    getShowValueAs: 'read-only',
    isValueProjection: 'read-only'
  },
  sync: { defaultGroupName: 'read-only', syncState: 'read-only (pane state)' },
  bookmarks: {
    identitiesToHighlight: 'builder over runtime identities (exercised by captureBookmark)',
    decodeDecomposedSelectors: 'pure decoder',
    encodeDecomposedSelectors: 'pure encoder',
    highlightToIdentities: 'pure decoder',
    savedSlicerFilter: 'read-only (re-exported from pbir)'
  },
  bookmarkPane: { bookmarkTree: 'read-only', playOrder: 'read-only', bookmarkOptions: 'read-only' },
  painter: {
    canPaint: 'read-only',
    toggleFormatPainter: 'store command: copies from the plain document, outside any mutation',
    paintOnto: 'store command wrapping applyFormat in mutateReport (applyFormat is audited)',
    useFormatPainter: 'zustand store hook'
  },
  layers: { layerTree: 'read-only', flattenTree: 'read-only', layerName: 'read-only', tabOrderList: 'read-only' },
  mobileLayout: {
    snap: 'pure number', mobileRect: 'read-only', isPlaced: 'read-only', pageVisualItems: 'read-only', placedVisuals: 'read-only',
    mobileCanvasHeight: 'read-only', defaultMobileSize: 'read-only', clampMobile: 'pure rect', resizeMobile: 'pure rect',
    moveMobileRect: 'pure rect', mobileVisualJson: 'read-only view of a visual', groupChildrenRects: 'read-only',
    MOBILE_GRID: 'constant', MOBILE_WIDTH: 'constant', MOBILE_MIN: 'constant'
  },
  mobileFormat: { mobileOverrides: 'read-only', mobileTarget: 'builds a pane target whose writes go through mutateReport (seed / bag audited)', mobileFormatVisual: 'read-only' },
  fieldOps: { rolesOf: 'read-only', isValueField: 'read-only', pickRole: 'read-only', projectionFor: 'pure builder', visualUsesField: 'read-only', newVisualForField: 'pure builder' },
  filterModel: {
    emptyModel: 'pure', opsFor: 'pure', opNeedsValue: 'pure', buildFilter: 'pure builder over plain UI state', parseCard: 'read-only',
    entityOf: 'read-only (re-exported from @core/report/sq)', formatValue: 'pure', fieldDisplayName: 'pure', summarize: 'pure', isFiltering: 'read-only', valueTypeOf: 'pure', newCard: 'pure builder', sameField: 'pure'
  }
}

const MODULES: Record<string, Record<string, unknown>> = { editOps, wells, sync, bookmarks, bookmarkPane, painter, layers, mobileLayout, mobileFormat, fieldOps, filterModel }

describe('edit operations on immer drafts (store mutations)', () => {
  for (const [mod, checks] of Object.entries(AUDIT)) {
    describe(mod, () => {
      for (const [name, check] of Object.entries(checks)) it(name, check)
    })
  }

  it('every exported operation of the audited modules is exercised here or classified as not an edit', () => {
    const missing: string[] = []
    for (const [mod, exports] of Object.entries(MODULES)) {
      for (const [name, value] of Object.entries(exports)) {
        if (typeof value !== 'function' && !(mod in NOT_EDITS && name in NOT_EDITS[mod])) continue
        if (name in (AUDIT[mod] ?? {}) || name in (NOT_EDITS[mod] ?? {})) continue
        missing.push(`${mod}.${name}`)
      }
    }
    expect(missing).toEqual([])
  })
})
