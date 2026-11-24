// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { countFrom, easeOut, formatCountText, parseCountText } from '../countText'
import { samePathShape } from '../animator'
import { boxTransform, flyTransform, notePageShown, resetPageHistory, transitionFrames, twoPageFrames } from '../pageTransition'

describe('count-up text', () => {
  it('parses formatted numbers', () => {
    expect(parseCountText('$1,234.56K')).toMatchObject({ prefix: '$', suffix: 'K', value: 1234.56, decimals: 2, group: ',', decimal: '.', grouped: true })
    expect(parseCountText('12.3%')).toMatchObject({ prefix: '', suffix: '%', value: 12.3, decimals: 1 })
    expect(parseCountText('-4,500')).toMatchObject({ value: -4500, decimals: 0, grouped: true })
    expect(parseCountText('1.234,5 €')).toMatchObject({ value: 1234.5, decimal: ',', group: '.', suffix: ' €' })
    expect(parseCountText('42')).toMatchObject({ value: 42, grouped: false })
    expect(parseCountText('(Blank)')).toBeNull()
    expect(parseCountText('Q3 2024')).toBeNull()
    expect(parseCountText('')).toBeNull()
  })

  it('prints intermediate values the way the final text is printed', () => {
    const shape = parseCountText('$1,234.56K')!
    expect(formatCountText(shape, 0)).toBe('$0.00K')
    expect(formatCountText(shape, 617.281)).toBe('$617.28K')
    expect(formatCountText(shape, 1234.56)).toBe('$1,234.56K')
    const eu = parseCountText('1.234,5 €')!
    expect(formatCountText(eu, 12345.67)).toBe('12.345,7 €')
    expect(formatCountText(parseCountText('-4,500')!, -1200)).toBe('-1,200')
  })

  it('counts from the old number only when it was printed the same way', () => {
    const to = parseCountText('3.4K')!
    expect(countFrom('1.2K', to)).toBe(1.2)
    expect(countFrom('950', to)).toBe(0)
    expect(countFrom(null, to)).toBe(0)
  })

  it('eases out', () => {
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
    expect(easeOut(0.5)).toBeGreaterThan(0.5)
  })
})

describe('morphing', () => {
  it('interpolates paths only when their commands match', () => {
    expect(samePathShape('M0,0L10,10L20,5', 'M0,2L10,12L20,9')).toBe(true)
    expect(samePathShape('M0,0L10,10', 'M0,0L10,10L20,5')).toBe(false)
    expect(samePathShape('M0,0A5,5,0,0,1,10,0Z', 'M0,0L10,0Z')).toBe(false)
    expect(samePathShape('', '')).toBe(false)
  })
})

describe('page transitions', () => {
  it('knows the direction of travel through the page order', () => {
    resetPageHistory()
    const order = ['a', 'b', 'c']
    expect(notePageShown(order, 'a')).toBe(0)
    expect(notePageShown(order, 'c')).toBe(1)
    expect(notePageShown(order, 'b')).toBe(-1)
    expect(notePageShown(order, 'b')).toBe(0)
    expect(notePageShown(['x', 'y'], 'y')).toBe(0)
  })

  it('builds keyframes for each kind', () => {
    expect(transitionFrames('none', 1, 1000)).toBeNull()
    expect(transitionFrames('fade', 1, 1000)).toEqual([{ opacity: 0 }, { opacity: 1 }])
    expect(transitionFrames('slide', -1, 1000)![0]).toEqual({ opacity: 0, transform: 'translateX(-120px)' })
    expect(transitionFrames('slide', 1, 4000)![0]).toEqual({ opacity: 0, transform: 'translateX(160px)' })
    // without an old page to move, the two-page kinds fall back to an entrance
    expect(transitionFrames('push', 1, 1000)).toEqual(transitionFrames('slide', 1, 1000))
    expect(transitionFrames('wipe', -1, 1000)![0]).toEqual({ clipPath: 'inset(0 0 0 100%)' })
    expect(transitionFrames('morph', 1, 1000)).toEqual([{ opacity: 0 }, { opacity: 1 }])
  })

  it('moves both pages for push, depth, wipe, circle and morph', () => {
    const size = { width: 1000, height: 600 }
    const push = twoPageFrames('push', 1, size)!
    expect(push.enter[0]).toEqual({ opacity: 0, transform: 'translateX(120px)' })
    expect(push.leave[1]).toEqual({ opacity: 0, transform: 'translateX(-120px)' })
    expect(twoPageFrames('push', -1, size)!.leave[1]).toEqual({ opacity: 0, transform: 'translateX(120px)' })
    expect(twoPageFrames('depth', 1, size)!.leave[1]).toEqual({ opacity: 0, transform: 'scale(0.92)' })
    expect(twoPageFrames('wipe', 1, size)!.enter[0]).toEqual({ clipPath: 'inset(0 100% 0 0)' })
    // the circle opens from the point clicked and reaches the farthest corner
    expect(twoPageFrames('circle', 1, size, { x: 0, y: 0 })!.enter).toEqual([{ clipPath: 'circle(0px at 0px 0px)' }, { clipPath: 'circle(1167px at 0px 0px)' }])
    expect(twoPageFrames('circle', 1, size)!.enter[1]).toEqual({ clipPath: 'circle(584px at 500px 300px)' })
    expect(twoPageFrames('morph', 1, size)!.ghostAbove).toBe(true)
    expect(twoPageFrames('fade', 1, size)).toBeNull()
  })

  it('maps one box onto another', () => {
    const a = { left: 10, top: 20, width: 100, height: 50 }
    const b = { left: 110, top: 220, width: 200, height: 100 }
    expect(boxTransform(a, a)).toBe('none')
    expect(boxTransform(a, b)).toBe('translate(-100px, -200px) scale(0.5, 0.5)')
    expect(boxTransform(a, b, 2)).toBe('translate(-50px, -100px) scale(0.5, 0.5)')
    expect(flyTransform(a, b, 1)).toBe('translate(100px, 200px) scale(2, 2)')
    expect(flyTransform(a, b, 0)).toBe('translate(0px, 0px) scale(1, 1)')
  })
})
