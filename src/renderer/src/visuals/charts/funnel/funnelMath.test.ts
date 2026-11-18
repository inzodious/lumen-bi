import { describe, expect, it } from 'vitest'
import { conversionRate, formatPercent, funnelLabelText, normalizeFunnelLabelStyle, percentOfFirst, percentOfPrevious } from './funnelMath'

const v = [4200, 2650, 1480, null, 410]

describe('funnel conversion math', () => {
  it('percent of first / previous', () => {
    expect(percentOfFirst(v, 0)).toBe(1)
    expect(percentOfFirst(v, 1)).toBeCloseTo(2650 / 4200)
    expect(percentOfPrevious(v, 0)).toBe(1)
    expect(percentOfPrevious(v, 2)).toBeCloseTo(1480 / 2650)
    expect(percentOfPrevious(v, 4)).toBeNull() // previous stage blank
    expect(percentOfFirst([0, 5], 1)).toBeNull()
    expect(conversionRate(v)).toBeCloseTo(410 / 4200)
    expect(conversionRate([])).toBeNull()
  })
  it('label text per funnelLabelStyle', () => {
    expect(funnelLabelText('Data', '2.65K', v, 1)).toBe('2.65K')
    expect(funnelLabelText('Percent of first', '2.65K', v, 1)).toBe('63.10%')
    expect(funnelLabelText('Percent of previous', '1.48K', v, 2, 1)).toBe('55.8%')
    expect(funnelLabelText('Data, percent of first', '2.65K', v, 1, 0)).toBe('2.65K (63%)')
    expect(funnelLabelText('Data, percent of previous', '0.41K', v, 4)).toBe('0.41K')
  })
  it('normalizes legacy label styles', () => {
    expect(normalizeFunnelLabelStyle('Both')).toBe('Data, percent of first')
    expect(normalizeFunnelLabelStyle('Data value')).toBe('Data')
    expect(normalizeFunnelLabelStyle(undefined)).toBe('Data')
    expect(normalizeFunnelLabelStyle('Percent of previous')).toBe('Percent of previous')
    expect(formatPercent(null)).toBe('')
    expect(formatPercent(0.0976)).toBe('9.76%')
  })
})
