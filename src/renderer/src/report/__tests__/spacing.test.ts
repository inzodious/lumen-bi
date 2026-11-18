import { describe, expect, it } from 'vitest'
import { alignRects, distributeWithGap, matchSize, resizeBy, rowGaps, rowsOf, snapMove, snapResize, tidyUp } from '../geometry'

const r = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
const page = { width: 1280, height: 720 }

describe('equal spacing snap (move)', () => {
  // a row of KPI cards with 20px gaps
  const cards = [r(20, 20, 200, 100), r(240, 20, 200, 100), r(460, 20, 200, 100)]

  it('measures gaps between row neighbors', () => {
    expect(rowGaps(cards).map((g) => g.value)).toEqual([20, 20])
  })

  it('snaps a 4th card to the same gap after the last one and shows the gap guides', () => {
    const s = snapMove(r(684, 60, 200, 100), cards, { page, threshold: 6 })
    expect(s.rect.x).toBe(680)
    expect(s.spacing.length).toBeGreaterThanOrEqual(3) // new gap + the two existing equal gaps
    expect(s.spacing.every((g) => g.axis === 'x' && Math.abs(g.value - 20) < 0.01)).toBe(true)
  })

  it('snaps to the left of the first card too', () => {
    const others = [r(300, 20, 200, 100), r(520, 20, 200, 100)]
    const s = snapMove(r(83, 30, 200, 100), others, { page, threshold: 6 })
    expect(s.rect.x).toBe(80)
  })

  it('centers a card between two neighbors (equal gaps on both sides)', () => {
    const others = [r(0, 0, 100, 100), r(400, 0, 100, 100)]
    const s = snapMove(r(196, 0, 100, 100), others, { page, threshold: 6 })
    expect(s.rect.x).toBe(200)
    expect(s.spacing.map((g) => g.value)).toEqual([100, 100])
  })

  it('works vertically (column of cards)', () => {
    const col = [r(20, 20, 200, 100), r(20, 140, 200, 100)]
    const s = snapMove(r(20, 263, 200, 100), col, { page, threshold: 6 })
    expect(s.rect.y).toBe(260)
    expect(s.spacing.some((g) => g.axis === 'y' && g.value === 20)).toBe(true)
  })

  it('alignment wins over spacing on ties and Alt (objects:false) disables both', () => {
    const s = snapMove(r(684, 60, 200, 100), cards, { page, threshold: 6, objects: false })
    expect(s.rect.x).toBe(684)
    expect(s.spacing).toEqual([])
  })
})

describe('margins and gutter', () => {
  it('snaps to page margins', () => {
    const s = snapMove(r(27, 300, 100, 100), [], { page, threshold: 6, layout: { margin: 24, gutter: 0 } })
    expect(s.rect.x).toBe(24)
    expect(s.guides.some((g) => g.axis === 'x' && g.pos === 24)).toBe(true)
    const s2 = snapMove(r(1150, 300, 100, 100), [], { page, threshold: 6, layout: { margin: 24, gutter: 0 } })
    expect(s2.rect.x).toBe(1256 - 100)
  })

  it('snaps to the gutter next to a neighbor', () => {
    const s = snapMove(r(318, 0, 100, 100), [r(0, 0, 300, 100)], { page, threshold: 6, layout: { margin: 0, gutter: 16 }, equalSpacing: false })
    expect(s.rect.x).toBe(316)
    expect(s.spacing[0]).toMatchObject({ axis: 'x', from: 300, to: 316, value: 16 })
  })
})

describe('match size (resize)', () => {
  const others = [r(0, 300, 240, 120), r(600, 300, 180, 90)]
  it('snaps the width to a neighbor width and reports the match', () => {
    const s = snapResize(r(300, 0, 243, 50), 'e', others, { page, threshold: 6 })
    expect(s.rect.width).toBe(240)
    expect(s.sizes[0]).toMatchObject({ dim: 'width', value: 240 })
    expect(s.sizes[0].rects).toHaveLength(1)
  })
  it('snaps the height from the top handle (anchored bottom)', () => {
    const s = snapResize(r(300, 100, 50, 93), 'n', others, { page, threshold: 6 })
    expect(s.rect.height).toBe(90)
    expect(s.rect.y + s.rect.height).toBe(193)
    expect(s.sizes[0].dim).toBe('height')
  })
  it('snaps the left edge to an equal gap', () => {
    const row = [r(0, 0, 100, 50), r(120, 0, 100, 50)]
    const s = snapResize(r(243, 0, 100, 50), 'w', row, { page, threshold: 6, matchSize: false })
    expect(s.rect.x).toBe(240)
    expect(s.rect.x + s.rect.width).toBe(343)
    expect(s.spacing.some((g) => g.value === 20)).toBe(true)
  })
})

describe('arrange ops', () => {
  it('distributes with a fixed gap keeping the first in place', () => {
    const out = distributeWithGap([r(300, 0, 50, 10), r(10, 0, 100, 10), r(500, 0, 20, 10)], 'horizontal', 12)
    expect(out.map((o) => o.x)).toEqual([122, 10, 184])
  })

  it('tidies a ragged row into an even row', () => {
    const out = tidyUp([r(13, 22, 200, 100), r(229, 18, 200, 100), r(452, 25, 200, 100), r(668, 20, 200, 100)], 16)
    expect(out.map((o) => o.x)).toEqual([13, 229, 445, 661])
    expect(new Set(out.map((o) => o.y)).size).toBe(1)
  })

  it('tidies a 2x2 cluster into a grid using the median gap', () => {
    const rects = [r(0, 0, 100, 50), r(118, 3, 100, 50), r(2, 70, 100, 50), r(121, 68, 100, 50)]
    expect(rowsOf(rects)).toEqual([[0, 1], [2, 3]])
    const out = tidyUp(rects, 18)
    expect(out.map((o) => [o.x, o.y])).toEqual([
      [0, 0],
      [118, 0],
      [0, 68],
      [118, 68]
    ])
    // default spacing = median of the current gaps (15, 18, 19, 20 → 19)
    expect(tidyUp(rects)[1].x).toBe(119)
  })

  it('makes visuals the same size as the key object', () => {
    const out = matchSize([r(0, 0, 100, 50), r(200, 0, 80, 70)], 'both', 0)
    expect(out[1]).toMatchObject({ x: 200, width: 100, height: 50 })
    expect(matchSize([r(0, 0, 100, 50), r(200, 0, 80, 70)], 'width', 1)[0].width).toBe(80)
  })

  it('aligns to the key object or the page', () => {
    const rects = [r(100, 100, 50, 50), r(10, 300, 80, 50)]
    expect(alignRects(rects, 'left', page, { to: 'keyObject', keyIndex: 0 }).map((o) => o.x)).toEqual([100, 100])
    expect(alignRects(rects, 'left', page).map((o) => o.x)).toEqual([10, 10])
    expect(alignRects(rects, 'right', page, { to: 'page' }).map((o) => o.x)).toEqual([1230, 1200])
  })

  it('keyboard resize keeps a minimum size', () => {
    expect(resizeBy(r(0, 0, 12, 12), -5, 3)).toEqual(r(0, 0, 10, 15))
  })
})
