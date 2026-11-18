/**
 * Card callout image layout: an image above / below the label + value gives up its space before the text does, and the
 * text column uses `safe` alignment, so switching a callout image on never cuts the label off at the top (the defect:
 * the image kept 50 % of the height and the centred text overflowed both ways). The browser layout itself is checked by
 * e2e/icons.e2e.ts (label box inside the card).
 */
import { describe, expect, it } from 'vitest'
import { calloutImageFlex, calloutTextFlex } from './CardVisual'

describe('callout image layout', () => {
  it('above / below: the image shrinks first (no minimum), from its area share or fixed size', () => {
    for (const position of ['top', 'bottom'] as const) {
      expect(calloutImageFlex({ position, areaSize: 50 })).toMatchObject({ flex: '0 1000 50%', minHeight: 0 })
      expect(calloutImageFlex({ position, areaSize: 50, size: 40 })).toMatchObject({ flex: '0 1000 40px', minHeight: 0 })
    }
  })
  it('left / right: the image keeps its share (the text ellipsizes beside it)', () => {
    expect(calloutImageFlex({ position: 'right', areaSize: 30 }).flex).toBe('0 0 30%')
    expect(calloutImageFlex({ position: 'left', areaSize: 50, size: 24 }).flex).toBe('0 0 24px')
  })
  it('the label + value column keeps its content size and never overflows upwards', () => {
    expect(calloutTextFlex('middle', true)).toEqual({ flex: '1 1 auto', minWidth: 0, minHeight: 0, justifyContent: 'safe center' })
    expect(calloutTextFlex('top', true).justifyContent).toBe('safe flex-start')
    expect(calloutTextFlex('bottom', true).justifyContent).toBe('safe flex-end')
    // without an image the alignment is unchanged (centred like Power BI)
    expect(calloutTextFlex('middle', false).justifyContent).toBe('center')
  })
})
