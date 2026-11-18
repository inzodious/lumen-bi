/** Sweep batch 3: card Auto display units on the published Microsoft sample values, KPI part labels. */
import { describe, expect, it } from 'vitest'
import { resolveTheme } from '@core/report/theme'
import { memoryFormat } from '../common/memoryEngine'
import { buildLegacyCardModel } from './legacyCardModel'
import { kpiAwareLabel, kpiPartLabel } from '../tables/kpiLabel'

const theme = resolveTheme()
const card = (value: number, formatString: string) => buildLegacyCardModel({ visual: { visualType: 'card', objects: {} } }, theme, memoryFormat, 'S', { value, formatString }).text

describe('legacy card Auto display units (Microsoft Learn sample screenshots)', () => {
  // Competitive Marketing Analysis, Executive Overview (Learn): $32K · $15K · $9,262 · $6,746 · $1,338 — integer currency format
  it('integer currency format: thousands without decimals, values under 10,000 in full', () => {
    const f = '\\$#,0;(\\$#,0);\\$#,0'
    expect(card(31_950, f)).toBe('$32K')
    expect(card(14_680, f)).toBe('$15K')
    expect(card(9262, f)).toBe('$9,262')
    expect(card(6746, f)).toBe('$6,746')
    expect(card(1338, f)).toBe('$1,338')
  })
  // Store Sales overview (Learn): "This Year Sales" $22M with the integer currency format
  it('millions with an integer format', () => {
    expect(card(22_050_000, '\\$#,0;(\\$#,0);\\$#,0')).toBe('$22M')
  })
  it('a format with decimals keeps two decimals when scaled', () => {
    expect(card(22_050_000, '\\$#,0.00')).toBe('$22.05M')
  })
})

describe('KPI part labels', () => {
  it('"<measure> Status" for the hidden KPI measures', () => {
    expect(kpiPartLabel({ kpi: { measure: 'Revenue', part: 'status' } as any })).toBe('Revenue Status')
    expect(kpiPartLabel({ kpi: { measure: 'Revenue', part: 'goal' } as any })).toBe('Revenue Goal')
    expect(kpiPartLabel({ kpi: { measure: 'Revenue', part: 'trend' } as any })).toBe('Revenue Trend')
    expect(kpiPartLabel({})).toBeUndefined()
  })
  it('explicit display names win, plain fields fall back', () => {
    const d = { kpi: { measure: 'Revenue', part: 'status' } as any }
    expect(kpiAwareLabel('My status', d, () => 'x')).toBe('My status')
    expect(kpiAwareLabel(undefined, d, () => 'x')).toBe('Revenue Status')
    expect(kpiAwareLabel(undefined, {}, () => 'Sales')).toBe('Sales')
  })
})
