import { describe, expect, it } from 'vitest'
import { emptyReport } from '@core/report/types'
import { bookmarkOptions, bookmarkTree, groupBookmarks, moveBookmark, playOrder, renameBookmark, setBookmarkOption, ungroupBookmarks } from './bookmarks'

function report() {
  const r = emptyReport()
  r.bookmarks = ['a', 'b', 'c'].map((n) => ({ name: n, json: { name: n, displayName: `Bookmark ${n}`, explorationState: { version: '1.3' } } }))
  r.bookmarksMeta = { items: [{ name: 'a' }, { name: 'b' }] }
  return r
}

describe('bookmark pane ops', () => {
  it('builds a tree including bookmarks missing from metadata', () => {
    const r = report()
    expect(bookmarkTree(r).map((n) => n.name)).toEqual(['a', 'b', 'c'])
    expect(playOrder(r)).toEqual(['a', 'b', 'c'])
  })

  it('groups, ungroups and keeps order', () => {
    const r = report()
    const g = groupBookmarks(r, ['b', 'c'], 'Story')!
    const tree = bookmarkTree(r)
    expect(tree.map((n) => n.kind)).toEqual(['bookmark', 'group'])
    expect(tree[1].kind === 'group' && tree[1].children.map((c) => c.name)).toEqual(['b', 'c'])
    expect(playOrder(r)).toEqual(['a', 'b', 'c'])
    renameBookmark(r, g, 'Chapter')
    expect(bookmarkTree(r)[1].displayName).toBe('Chapter')
    moveBookmark(r, 'c', -1)
    expect(playOrder(r)).toEqual(['a', 'c', 'b'])
    ungroupBookmarks(r, g)
    expect(bookmarkTree(r).map((n) => n.name)).toEqual(['a', 'c', 'b'])
  })

  it('renames and toggles options', () => {
    const r = report()
    renameBookmark(r, 'a', 'Overview')
    expect(r.bookmarks[0].json.displayName).toBe('Overview')
    setBookmarkOption(r, 'a', 'data', false)
    setBookmarkOption(r, 'a', 'allVisuals', false, ['v1'])
    expect(r.bookmarks[0].json.options).toEqual({ suppressData: true, applyOnlyToTargetVisuals: true, targetVisualNames: ['v1'] })
    expect(bookmarkOptions(r, 'a')).toMatchObject({ data: false, display: true, currentPage: true, allVisuals: false })
    setBookmarkOption(r, 'a', 'data', true)
    setBookmarkOption(r, 'a', 'allVisuals', true)
    expect(r.bookmarks[0].json.options).toBeUndefined()
  })
})
