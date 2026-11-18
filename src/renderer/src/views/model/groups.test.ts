import { describe, expect, it } from 'vitest'
import { CHIP_HEIGHT, CHIP_WIDTH, GROUP_HEADER, GROUP_PAD, GROUP_PALETTE, cardsInMarquee, chipRect, fitGroup, groupRect, manualBounds, membershipAfterDrop, rectFromPoints, resizeGroup, type DropGroup } from './groups'
import { GROUP_COLORS } from '@core/io/diagramSidecar'

const card = (x: number, y: number, w = 200, h = 100) => ({ x, y, width: w, height: h })

describe('container fitting', () => {
  it('fits the members with padding and a label band on top', () => {
    expect(fitGroup([])).toBeNull()
    const r = fitGroup([card(100, 100), card(400, 300, 200, 200)])!
    expect(r).toEqual({ x: 100 - GROUP_PAD, y: 100 - GROUP_HEADER, width: 500 + GROUP_PAD * 2, height: 400 + GROUP_HEADER + GROUP_PAD })
  })

  it('follows its members as they move, and extends to manual bounds', () => {
    const a = groupRect([card(0, 0)])!
    const b = groupRect([card(50, 20)])!
    expect(b.x - a.x).toBe(50)
    expect(b.y - a.y).toBe(20)
    const manual = { x: -200, y: -200, width: 300, height: 250 }
    const m = groupRect([card(0, 0)], manual)!
    expect(m).toEqual({ x: -200, y: -200, width: 200 + GROUP_PAD + 200, height: 100 + GROUP_PAD + 200 })
    // a member dragged beyond the manual extent still fits
    const far = groupRect([card(600, 0)], manual)!
    expect(far.x + far.width).toBe(800 + GROUP_PAD)
  })

  it('the collapsed chip sits at the container corner', () => {
    expect(chipRect({ x: 30, y: 40, width: 900, height: 700 })).toEqual({ x: 30, y: 40, width: CHIP_WIDTH, height: CHIP_HEIGHT })
  })

  it('every colour has a palette entry', () => {
    for (const c of GROUP_COLORS) expect(GROUP_PALETTE[c].fill).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('resize handles', () => {
  const fit = { x: 100, y: 100, width: 300, height: 200 }
  it('grows freely and never shrinks below the fitted rectangle', () => {
    expect(resizeGroup(fit, 'se', 50, 30, fit)).toEqual({ x: 100, y: 100, width: 350, height: 230 })
    expect(resizeGroup(fit, 'nw', -40, -20, fit)).toEqual({ x: 60, y: 80, width: 340, height: 220 })
    expect(resizeGroup(fit, 'se', -500, -500, fit)).toEqual(fit)
    expect(resizeGroup(fit, 'w', 80, 999, fit)).toEqual(fit)
    // an enlarged container can be dragged back down to the fit, edge by edge
    const big = { x: 0, y: 0, width: 600, height: 500 }
    expect(resizeGroup(big, 'e', -150, 0, fit)).toEqual({ x: 0, y: 0, width: 450, height: 500 })
    expect(resizeGroup(big, 'n', 0, 300, fit)).toEqual({ x: 0, y: 100, width: 600, height: 400 })
  })

  it('manual bounds are only stored when they add something', () => {
    expect(manualBounds(fit, fit)).toBeUndefined()
    expect(manualBounds({ ...fit, width: 400 }, fit)).toEqual({ ...fit, width: 400 })
  })
})

describe('marquee', () => {
  it('selects the cards it touches', () => {
    const rects: Array<[string, ReturnType<typeof card>]> = [
      ['A', card(0, 0)],
      ['B', card(300, 0)],
      ['C', card(0, 300)]
    ]
    expect(rectFromPoints(250, 150, -10, -10)).toEqual({ x: -10, y: -10, width: 260, height: 160 })
    expect(cardsInMarquee(rects, rectFromPoints(250, 150, -10, -10))).toEqual(['A'])
    expect(cardsInMarquee(rects, rectFromPoints(150, 50, 350, 60))).toEqual(['A', 'B'])
    expect(cardsInMarquee(rects, rectFromPoints(600, 600, 700, 700))).toEqual([])
  })
})

describe('dragging tables in and out of containers', () => {
  const groups: DropGroup[] = [
    { id: 'g1', rect: { x: 0, y: 0, width: 500, height: 400 }, tables: ['A', 'B'] },
    { id: 'g2', rect: { x: 1000, y: 0, width: 400, height: 400 }, tables: ['C'] },
    { id: 'g3', rect: { x: 2000, y: 0, width: 220, height: 40 }, tables: ['D'], collapsed: true }
  ]

  it('a member nudged past the edge stays (the container grows)', () => {
    expect(membershipAfterDrop(groups, [{ table: 'A', rect: card(450, 100) }]).get('A')).toBe('g1')
  })

  it('a member dropped entirely outside leaves its group', () => {
    expect(membershipAfterDrop(groups, [{ table: 'A', rect: card(600, 100) }]).get('A')).toBeNull()
  })

  it('a member dropped onto another container moves there', () => {
    expect(membershipAfterDrop(groups, [{ table: 'A', rect: card(1100, 100) }]).get('A')).toBe('g2')
  })

  it('an ungrouped table joins the container its centre is over', () => {
    expect(membershipAfterDrop(groups, [{ table: 'X', rect: card(380, 100) }]).get('X')).toBe('g1') // centre at x = 480
    expect(membershipAfterDrop(groups, [{ table: 'X', rect: card(450, 100) }]).get('X')).toBeNull() // centre at x = 550
  })

  it('collapsed containers take no drops; the smallest overlapping container wins', () => {
    expect(membershipAfterDrop(groups, [{ table: 'X', rect: card(2000, 0, 100, 30) }]).get('X')).toBeNull()
    const nested: DropGroup[] = [...groups, { id: 'small', rect: { x: 100, y: 100, width: 250, height: 150 }, tables: ['E'] }]
    expect(membershipAfterDrop(nested, [{ table: 'X', rect: card(120, 120, 100, 50) }]).get('X')).toBe('small')
  })

  it('several cards are decided independently', () => {
    const r = membershipAfterDrop(groups, [
      { table: 'A', rect: card(700, 0) },
      { table: 'B', rect: card(100, 100) },
      { table: 'X', rect: card(1100, 50) }
    ])
    expect([...r]).toEqual([
      ['A', null],
      ['B', 'g1'],
      ['X', 'g2']
    ])
  })
})
