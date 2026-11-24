import { describe, expect, it } from 'vitest'
import { shadePercents } from './ThemeSwatches'

describe('shadePercents', () => {
  it('offers only darker shades under white and only lighter tints under black', () => {
    expect(shadePercents('#FFFFFF').every((t) => t < 0)).toBe(true)
    expect(shadePercents('#000000').every((t) => t > 0)).toBe(true)
    expect(new Set(shadePercents('#FFFFFF')).size).toBe(5)
  })
  it('offers tints and shades under a mid color', () => {
    const t = shadePercents('#118DFF')
    expect(t.some((x) => x > 0) && t.some((x) => x < 0)).toBe(true)
  })
})

describe('shadePercents for theme foregrounds', () => {
  it('treats a dark gray foreground as black but keeps a dark blue two-way', () => {
    expect(shadePercents('#252423').every((t) => t > 0)).toBe(true)
    expect(shadePercents('#12239E').some((t) => t < 0)).toBe(true)
  })
})
