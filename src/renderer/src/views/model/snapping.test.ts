import { describe, expect, it } from 'vitest'
import { GRID, snapFraction, snapPoint } from './snapping'

describe('snapPoint', () => {
  it('snaps to the diagram grid', () => {
    expect(GRID).toBe(10)
    expect(snapPoint({ x: 104, y: 96 })).toEqual({ x: 100, y: 100 })
    expect(snapPoint({ x: -14.9, y: 5 }, { grid: 10 })).toEqual({ x: -10, y: 10 })
    expect(snapPoint({ x: 13, y: 13 }, { grid: 0 })).toEqual({ x: 13, y: 13 })
  })

  it('alignment with other points wins over the grid and reports the guides', () => {
    const s = snapPoint({ x: 104, y: 96 }, { xs: [107, 300], ys: [50], threshold: 6 })
    expect(s).toEqual({ x: 107, y: 100, guideX: 107 })
    const both = snapPoint({ x: 104, y: 52 }, { xs: [107], ys: [50], threshold: 6 })
    expect(both).toEqual({ x: 107, y: 50, guideX: 107, guideY: 50 })
    // the nearest candidate is chosen
    expect(snapPoint({ x: 104, y: 0 }, { xs: [100, 105, 109], threshold: 6 }).x).toBe(105)
    // out of reach: grid
    expect(snapPoint({ x: 104, y: 0 }, { xs: [111], threshold: 6 })).toEqual({ x: 100, y: 0 })
  })

  it('does nothing when disabled (Alt)', () => {
    expect(snapPoint({ x: 104.3, y: 96.7 }, { enabled: false, xs: [104], ys: [97] })).toEqual({ x: 104.3, y: 96.7 })
  })
})

describe('snapFraction', () => {
  it('snaps a position along a card side to the given fractions within a pixel threshold', () => {
    expect(snapFraction(0.52, 300, [0.5, 0.2], 7)).toBe(0.5)
    expect(snapFraction(0.6, 300, [0.5, 0.2], 7)).toBe(0.6)
    expect(snapFraction(0.21, 300, [0.5, 0.2], 7)).toBe(0.2)
    expect(snapFraction(0.52, 300, [0.5], 7, false)).toBe(0.52)
  })
})
