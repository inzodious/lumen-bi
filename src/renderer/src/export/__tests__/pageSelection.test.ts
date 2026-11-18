// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import type { PageDocument, ReportDocument } from '@core/report/types'
import {
  defaultSelection, exportPageEntries, forgetSelections, orderedSelection, quickSelection, rangeSelection, recallSelection, reconcileSelection, rememberSelection,
  selectionState, toggleSelection, type ExportPageEntry
} from '../pageSelection'

function page(name: string, json: Record<string, unknown> = {}): PageDocument {
  return { name, json: { displayName: name.toUpperCase(), width: 1280, height: 720, ...json }, visuals: [] }
}

function report(pages: PageDocument[], order = pages.map((p) => p.name)): ReportDocument {
  return { origin: 'new', report: {}, pagesMeta: { pageOrder: order }, pages, bookmarks: [] } as unknown as ReportDocument
}

// landing page visible, the rest hidden (reached through page navigator buttons), plus a tooltip and a drillthrough page
const REPORT = report(
  [
    page('detail', { visibility: 'HiddenInViewMode' }),
    page('home'),
    page('tip', { type: 'Tooltip', pageBinding: { type: 'Tooltip' }, visibility: 'HiddenInViewMode', width: 320, height: 240 }),
    page('drill', { pageBinding: { type: 'Drillthrough' }, visibility: 'HiddenInViewMode' }),
    page('trend', { visibility: 'HiddenInViewMode' })
  ],
  ['home', 'detail', 'trend', 'drill', 'tip']
)
const PAGES = exportPageEntries(REPORT)
const names = (ps: readonly ExportPageEntry[]) => ps.map((p) => p.name)

describe('exportPageEntries', () => {
  it('lists every page in report order with hidden / tooltip / drillthrough flags', () => {
    expect(names(PAGES)).toEqual(['home', 'detail', 'trend', 'drill', 'tip'])
    expect(PAGES.map((p) => [p.displayName, p.hidden, p.kind])).toEqual([
      ['HOME', false, 'normal'],
      ['DETAIL', true, 'normal'],
      ['TREND', true, 'normal'],
      ['DRILL', true, 'drillthrough'],
      ['TIP', true, 'tooltip']
    ])
    expect(PAGES[4]).toMatchObject({ width: 320, height: 240 })
  })
  it('is empty without a report', () => {
    expect(exportPageEntries(null)).toEqual([])
  })
})

describe('selection model', () => {
  it('default: every page except tooltip pages, hidden pages included', () => {
    expect(defaultSelection(PAGES)).toEqual(['home', 'detail', 'trend', 'drill'])
  })
  it('quick choices: all / none / visible only / current page', () => {
    expect(quickSelection('all', PAGES)).toEqual(names(PAGES))
    expect(quickSelection('none', PAGES)).toEqual([])
    expect(quickSelection('visible', PAGES)).toEqual(['home'])
    expect(quickSelection('current', PAGES, 'trend')).toEqual(['trend'])
    expect(quickSelection('current', PAGES, 'gone')).toEqual([])
    expect(quickSelection('current', PAGES, null)).toEqual([])
  })
  it('tri-state select-all', () => {
    expect(selectionState(PAGES, new Set())).toBe(false)
    expect(selectionState(PAGES, new Set(['home']))).toBe('mixed')
    expect(selectionState(PAGES, new Set(names(PAGES)))).toBe(true)
    // names that are no longer pages don't count
    expect(selectionState(PAGES, new Set(['ghost']))).toBe(false)
  })
  it('toggles one page', () => {
    const s = toggleSelection(new Set(['home']), 'trend')
    expect([...s].sort()).toEqual(['home', 'trend'])
    expect([...toggleSelection(s, 'home')]).toEqual(['trend'])
    expect([...toggleSelection(s, 'home', true)].sort()).toEqual(['home', 'trend'])
  })
  it('shift-click range selects (or clears) between the anchor and the target, either direction', () => {
    expect(orderedSelection(PAGES, rangeSelection(PAGES, new Set(), 'detail', 'drill', true))).toEqual(['detail', 'trend', 'drill'])
    expect(orderedSelection(PAGES, rangeSelection(PAGES, new Set(), 'drill', 'home', true))).toEqual(['home', 'detail', 'trend', 'drill'])
    expect(orderedSelection(PAGES, rangeSelection(PAGES, new Set(names(PAGES)), 'trend', 'tip', false))).toEqual(['home', 'detail'])
    // no anchor: acts on the target only
    expect(orderedSelection(PAGES, rangeSelection(PAGES, new Set(), null, 'trend', true))).toEqual(['trend'])
  })
  it('orders a selection by report order whatever order it was made in', () => {
    expect(orderedSelection(PAGES, ['tip', 'home', 'ghost', 'trend'])).toEqual(['home', 'trend', 'tip'])
  })
})

describe('remembered selection', () => {
  beforeEach(() => forgetSelections())

  it('recalls the default until something is remembered, then the remembered pages', () => {
    expect(recallSelection('r1', PAGES)).toEqual(defaultSelection(PAGES))
    rememberSelection('r1', PAGES, ['trend', 'home'])
    expect(recallSelection('r1', PAGES)).toEqual(['home', 'trend'])
    // per report
    expect(recallSelection('r2', PAGES)).toEqual(defaultSelection(PAGES))
  })

  it('survives page add, remove and rename', () => {
    rememberSelection('r', PAGES, ['home', 'trend'])
    const changed = exportPageEntries(
      report(
        [
          page('home', { displayName: 'Start here' }), // renamed: same id keeps its state
          page('detail', { visibility: 'HiddenInViewMode' }),
          page('trend', { displayName: 'Trend (renamed)', visibility: 'HiddenInViewMode' }),
          // 'drill' removed
          page('tip', { type: 'Tooltip', pageBinding: { type: 'Tooltip' } }),
          page('added', { visibility: 'HiddenInViewMode' }), // new page: default (ticked)
          page('tip2', { pageBinding: { type: 'Tooltip' } }) // new tooltip page: default (unticked)
        ],
        ['added', 'home', 'detail', 'trend', 'tip', 'tip2']
      )
    )
    expect(recallSelection('r', changed)).toEqual(['added', 'home', 'trend'])
  })

  it('an explicitly empty selection stays empty', () => {
    expect(reconcileSelection({ selected: [], known: names(PAGES) }, PAGES)).toEqual([])
  })
})
