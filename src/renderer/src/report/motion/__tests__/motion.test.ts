// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { countFrom, easeOut, formatCountText, parseCountText } from '../countText'
import { samePathShape } from '../animator'
import { notePageShown, resetPageHistory, transitionFrames } from '../pageTransition'

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
  })
})
