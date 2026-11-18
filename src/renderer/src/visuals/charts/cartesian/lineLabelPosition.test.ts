import { describe, expect, it } from 'vitest'
import { lineLabelSides, preferredLineLabelSide } from './lineLabelPosition'
import { LINE_LABEL_POSITION_DEFAULT } from './CartesianChart'

const sides = (ys: Array<number | null>, pos: string) => ys.map((_, i) => preferredLineLabelSide(pos, ys, i))

describe('line data-label position', () => {
  it('defaults to Above', () => {
    expect(LINE_LABEL_POSITION_DEFAULT).toBe('Above')
  })

  it('Below goes below; Above, Auto and the others go above, local minima included', () => {
    const ys = [275, 236, 312, 462, 420]
    expect(sides(ys, 'Below')).toEqual(['below', 'below', 'below', 'below', 'below'])
    expect(sides(ys, 'Above')).toEqual(['above', 'above', 'above', 'above', 'above'])
    expect(sides(ys, 'Auto')).toEqual(['above', 'above', 'above', 'above', 'above'])
    expect(sides(ys, 'Center')).toEqual(['above', 'above', 'above', 'above', 'above'])
  })

  it('a single side is tried (no fallback to the other side)', () => {
    expect(lineLabelSides('Auto', [50, 5, 50], 1)).toEqual(['above'])
    expect(lineLabelSides('Below', [50, 95, 50], 1)).toEqual(['below'])
  })
})
