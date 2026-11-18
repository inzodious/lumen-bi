import { describe, expect, it } from 'vitest'
import { alignRects, distributeRects, lassoHits, rectFromPoints, resizeRect, snapMove, snapResize } from '../geometry'
import { addPage, alignVisuals, copyVisuals, deletePage, deleteVisuals, distributeVisuals, duplicatePage, duplicateVisuals, groupVisuals, movePage, pasteVisuals, reorderZ, setAbsoluteRects, ungroupVisuals } from '../editOps'
import { absoluteRect, findPage, orderedPages, positionOf } from '../pbir'
import { FIXTURE, fixtureReport } from '../dev/fixture'

const R = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })

describe('resize', () => {
  it('moves the right edges for each handle', () => {
    expect(resizeRect(R(10, 10, 100, 50), 'se', 20, 10)).toEqual(R(10, 10, 120, 60))
    expect(resizeRect(R(10, 10, 100, 50), 'nw', 5, 5)).toEqual(R(15, 15, 95, 45))
    expect(resizeRect(R(10, 10, 100, 50), 'w', -10, 99)).toEqual(R(0, 10, 110, 50))
  })
  it('enforces a minimum size and keeps the anchored edge', () => {
    const r = resizeRect(R(10, 10, 100, 50), 'w', 200, 0)
    expect(r.width).toBe(10)
    expect(r.x + r.width).toBe(110)
  })
  it('locks aspect ratio', () => {
    const r = resizeRect(R(0, 0, 100, 50), 'se', 100, 0, { lockAspect: true })
    expect(r).toEqual(R(0, 0, 200, 100))
    const s = resizeRect(R(0, 0, 100, 50), 's', 0, 50, { lockAspect: true })
    expect(s).toEqual(R(0, 0, 200, 100))
  })
})

describe('snapping', () => {
  const others = [R(100, 100, 200, 100)]
  it('snaps left edge to another visual left edge with a guide', () => {
    const { rect, guides } = snapMove(R(103, 300, 50, 50), others)
    expect(rect.x).toBe(100)
    expect(guides.some((g) => g.axis === 'x' && g.pos === 100)).toBe(true)
  })
  it('snaps centers and page edges', () => {
    const { rect } = snapMove(R(172, 400, 50, 50), others, { page: { width: 1280, height: 720 } })
    expect(rect.x + 25).toBe(200)
    expect(snapMove(R(3, 698, 50, 20), [], { page: { width: 1280, height: 720 } }).rect).toEqual(R(0, 700, 50, 20))
  })
  it('falls back to grid snapping', () => {
    expect(snapMove(R(33, 47, 10, 10), [], { grid: 16, objects: false }).rect).toEqual(R(32, 48, 10, 10))
  })
  it('snaps resize edges', () => {
    const { rect } = snapResize(R(0, 0, 97, 40), 'e', others)
    expect(rect.width).toBe(100)
  })
})

describe('align / distribute', () => {
  it('aligns to selection bounds, or to the page for one rect', () => {
    expect(alignRects([R(10, 0, 10, 10), R(50, 0, 20, 10)], 'right').map((r) => r.x)).toEqual([60, 50])
    expect(alignRects([R(10, 0, 10, 10), R(50, 20, 20, 10)], 'middle').map((r) => r.y)).toEqual([10, 10])
    expect(alignRects([R(10, 0, 100, 10)], 'center', { width: 1000, height: 500 })[0].x).toBe(450)
  })
  it('distributes with equal gaps', () => {
    const out = distributeRects([R(0, 0, 10, 10), R(100, 0, 10, 10), R(30, 0, 20, 10)], 'horizontal')
    // span 0..110, total width 40 → gap 35
    expect(out.map((r) => r.x)).toEqual([0, 100, 45])
  })
  it('lasso hits intersecting rects', () => {
    expect(lassoHits(rectFromPoints(50, 50, 0, 0), [{ name: 'a', rect: R(40, 40, 10, 10) }, { name: 'b', rect: R(60, 60, 5, 5) }])).toEqual(['a'])
  })
})

describe('edit operations', () => {
  it('moves group children relative to their group and refits the group', () => {
    const r = fixtureReport()
    const p = findPage(r, FIXTURE.overview)!
    const child = p.visuals.find((v) => v.json.parentGroupName === FIXTURE.group)!
    const before = absoluteRect(p, child)
    setAbsoluteRects(p, { [child.name]: { x: before.x - 10 } })
    expect(absoluteRect(p, child).x).toBeCloseTo(before.x - 10)
    const g = p.visuals.find((v) => v.name === FIXTURE.group)!
    expect(positionOf(g).x).toBeCloseTo(1064 - 2) // group bounds follow (child was at +8)
    expect(positionOf(child).x).toBe(0)
  })

  it('aligns and distributes visuals', () => {
    const r = fixtureReport()
    const p = findPage(r, FIXTURE.overview)!
    alignVisuals(p, [FIXTURE.card, FIXTURE.categoryChart], 'top')
    expect(positionOf(p.visuals.find((v) => v.name === FIXTURE.card)!).y).toBe(24)
    distributeVisuals(p, [FIXTURE.regionSlicer, FIXTURE.categoryChart, FIXTURE.card], 'horizontal')
    expect(positionOf(p.visuals.find((v) => v.name === FIXTURE.card)!).x).toBe(844)
  })

  it('group / ungroup preserves absolute positions', () => {
    const r = fixtureReport()
    const p = findPage(r, FIXTURE.overview)!
    const before = absoluteRect(p, p.visuals.find((v) => v.name === FIXTURE.card)!)
    const g = groupVisuals(p, [FIXTURE.card, FIXTURE.categoryChart])!
    expect(g).toMatch(/^[0-9a-f]{20}$/)
    expect(absoluteRect(p, p.visuals.find((v) => v.name === FIXTURE.card)!)).toEqual(before)
    ungroupVisuals(p, [g])
    expect(p.visuals.find((v) => v.name === g)).toBeUndefined()
    expect(absoluteRect(p, p.visuals.find((v) => v.name === FIXTURE.card)!)).toEqual(before)
  })

  it('z-order operations', () => {
    const r = fixtureReport()
    const p = findPage(r, FIXTURE.overview)!
    const z = (n: string) => positionOf(p.visuals.find((v) => v.name === n)!).z
    reorderZ(p, [FIXTURE.regionSlicer], 'front')
    const top = p.visuals.filter((v) => !v.json.parentGroupName).every((v) => z(v.name) <= z(FIXTURE.regionSlicer))
    expect(top).toBe(true)
    reorderZ(p, [FIXTURE.regionSlicer], 'backward')
    reorderZ(p, [FIXTURE.regionSlicer], 'back')
    expect(z(FIXTURE.regionSlicer)).toBe(0)
  })

  it('duplicate / copy-paste give fresh 20-hex names and duplicate group descendants', () => {
    const r = fixtureReport()
    const p = findPage(r, FIXTURE.overview)!
    const n = p.visuals.length
    const [dup] = duplicateVisuals(p, [FIXTURE.group])
    expect(dup).toMatch(/^[0-9a-f]{20}$/)
    expect(p.visuals.length).toBe(n + 3)
    expect(p.visuals.filter((v) => v.json.parentGroupName === dup)).toHaveLength(2)
    const clip = copyVisuals(p, [FIXTURE.card])
    const other = findPage(r, FIXTURE.hidden)!
    const [pasted] = pasteVisuals(other, clip)
    expect(positionOf(other.visuals.find((v) => v.name === pasted)!).x).toBe(844)
    deleteVisuals(p, [dup])
    expect(p.visuals.length).toBe(n)
  })

  it('page operations', () => {
    const r = fixtureReport()
    const added = addPage(r, { after: FIXTURE.overview })
    expect(orderedPages(r)[1].name).toBe(added)
    expect(findPage(r, added)!.json.displayName).toBe('Page 5')
    const dup = duplicatePage(r, FIXTURE.overview)!
    const dp = findPage(r, dup)!
    expect(dp.json.displayName).toBe('Duplicate of Overview')
    expect(dp.visuals.length).toBe(findPage(r, FIXTURE.overview)!.visuals.length)
    const grp = dp.visuals.find((v) => v.json.visualGroup)!
    expect(dp.visuals.filter((v) => v.json.parentGroupName === grp.name)).toHaveLength(2)
    movePage(r, dup, 0)
    expect(orderedPages(r)[0].name).toBe(dup)
    expect(deletePage(r, dup)).toBe(FIXTURE.overview)
    expect(r.pages.find((p) => p.name === dup)).toBeUndefined()
  })
})
