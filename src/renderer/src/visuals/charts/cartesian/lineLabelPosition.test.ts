import { describe, expect, it } from 'vitest'
import { lineLabelSides, preferredLineLabelSide } from './lineLabelPosition'

// pixel y: larger = lower on screen
const sides = (ys: Array<number | null>, pos = 'Auto') => ys.map((_, i) => preferredLineLabelSide(pos, ys, i))

describe('line data-label position', () => {
  it('Auto: above, below at local minima (end points compare with their one neighbour)', () => {
    // a dip at index 3, a trough at index 6 and a slight dip at index 10; first point lower than the second
    const ys = [275, 236, 312, 462, 420, 433, 446, 372, 390, 393, 400, 378]
    expect(sides(ys)).toEqual(['below', 'above', 'above', 'below', 'above', 'above', 'below', 'above', 'above', 'above', 'below', 'above'])
  })

  it('Auto: flat runs and single points stay above; gaps are skipped when finding neighbours', () => {
    expect(sides([100, 100, 100])).toEqual(['above', 'above', 'above'])
    expect(sides([null, 50, null])).toEqual(['above', 'above', 'above'])
    expect(sides([40, null, 80, null, 60])).toEqual(['above', 'above', 'below', 'above', 'above'])
  })

  it('explicit positions are kept', () => {
    expect(sides([10, 90, 10], 'Above')).toEqual(['above', 'above', 'above'])
    expect(sides([10, 90, 10], 'Below')).toEqual(['below', 'below', 'below'])
    expect(lineLabelSides('Above', [10, 90, 10], 1, () => -100, 10, 0, 100)).toEqual(['above'])
  })

  it('Auto falls back to the other side when the preferred one leaves the plot area, else after a collision', () => {
    const top = (y: number) => (side: 'above' | 'below') => (side === 'above' ? y - 14 : y + 4)
    // a peak near the top edge: above would leave the plot
    expect(lineLabelSides('Auto', [50, 5, 50], 1, top(5), 10, 0, 100)).toEqual(['below', 'above'])
    // a trough near the bottom edge: below would leave the plot
    expect(lineLabelSides('Auto', [50, 95, 50], 1, top(95), 10, 0, 100)).toEqual(['above', 'below'])
    // room on both sides: preferred first, the other as the collision fallback
    expect(lineLabelSides('Auto', [50, 60, 50], 1, top(60), 10, 0, 100)).toEqual(['below', 'above'])
  })
})
