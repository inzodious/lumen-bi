import { buildBookmarkItems, buildPageItems, navLayout, resolveSelectedBookmark } from '../navigatorModel'
import type { ReportInfo } from '../../contract'

const L = (v: string) => ({ expr: { Literal: { Value: v } } })
const report: ReportInfo = {
  pages: [
    { name: 'p1', displayName: 'Home', hidden: false },
    { name: 'p2', displayName: 'Detail', hidden: true },
    { name: 'p3', displayName: 'Tooltip', hidden: true, isTooltip: true },
    { name: 'p4', displayName: 'Trends', hidden: false }
  ],
  activePage: 'p4',
  bookmarks: [
    { name: 'b1', displayName: 'A', group: 'G1' },
    { name: 'b2', displayName: 'B' }
  ],
  resolveImage: () => undefined
}

describe('navigator model', () => {
  it('default: visible pages only, active page selected', () => {
    const items = buildPageItems({ visual: { objects: {} } }, report)
    expect(items.map((i) => i.key)).toEqual(['p1', 'p4'])
    expect(items.find((i) => i.selected)?.key).toBe('p4')
  })

  it('corpus pattern: showHiddenPages + per-page showPage=false', () => {
    const vj = { visual: { objects: { pages: [{ properties: { showHiddenPages: L('true') } }, { properties: { showPage: L('false') }, selector: { id: 'p1' } }] } } }
    expect(buildPageItems(vj, report).map((i) => i.key)).toEqual(['p2', 'p4'])
  })

  it('showByDefault=false shows only opted-in pages; tooltips need showTooltipPages', () => {
    const vj = { visual: { objects: { pages: [{ properties: { showByDefault: L('false'), showHiddenPages: L('true'), showTooltipPages: L('true') } }, { properties: { showPage: L('true') }, selector: { id: 'p3' } }] } } }
    expect(buildPageItems(vj, report).map((i) => i.key)).toEqual(['p3'])
  })

  it('bookmark items filter by group', () => {
    const vj = { visual: { objects: { bookmarks: [{ properties: { bookmarkGroup: L("'G1'") } }] } } }
    expect(buildBookmarkItems(vj, report, 'b1')).toEqual([{ key: 'b1', label: 'A', selected: true }])
    expect(buildBookmarkItems({ visual: {} }, report).length).toBe(2)
  })

  it('layouts', () => {
    const v = navLayout(3, 100, 320, { orientation: 1, gap: 10 })
    expect(v.map((c) => c.y)).toEqual([0, 110, 220])
    expect(v[0].h).toBe(100)
    const h = navLayout(4, 430, 40, { orientation: 0, gap: 10 })
    expect(h[3].x).toBe(330)
    expect(h[0].w).toBe(100)
    const g = navLayout(5, 200, 100, { orientation: 0, columnCount: 2, gap: 0 })
    expect(g[4]).toMatchObject({ x: 0, y: (100 / 3) * 2 })
  })

  it('selected bookmark follows the report\'s applied bookmark', () => {
    // host reports the applied bookmark
    expect(resolveSelectedBookmark('b2', undefined)).toBe('b2')
    // clicked b1 here; host then applied it → follows the host
    expect(resolveSelectedBookmark('b1', { name: 'b1', basis: 'b2' })).toBe('b1')
    // deselected (allowDeselection) while b1 is applied → none, until another bookmark is applied elsewhere
    expect(resolveSelectedBookmark('b1', { name: null, basis: 'b1' })).toBeUndefined()
    expect(resolveSelectedBookmark('b2', { name: null, basis: 'b1' })).toBe('b2')
    // host without activeBookmark support: local pick
    expect(resolveSelectedBookmark(undefined, { name: 'b1', basis: undefined })).toBe('b1')
    // another navigator (other group) applied b2: this navigator keeps its own last pick
    expect(resolveSelectedBookmark('b2', { name: 'b1', basis: 'b1' }, (n) => n === 'b1')).toBe('b1')
    expect(resolveSelectedBookmark('b2', undefined, (n) => n === 'b1')).toBeUndefined()
    const items = buildBookmarkItems({ visual: {} }, { ...report, activeBookmark: 'b2' }, resolveSelectedBookmark('b2', undefined))
    expect(items.find((i) => i.selected)?.key).toBe('b2')
  })
})
