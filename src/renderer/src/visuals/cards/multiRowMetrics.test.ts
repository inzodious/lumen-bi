import { resolveTheme } from '@core/report/theme'
import { multiRowStyle } from './legacyCardModel'

describe('multi-row card defaults', () => {
  it('data labels 10pt, category labels 9pt (measured on Learn sample screenshots)', () => {
    const s = multiRowStyle({ visual: { visualType: 'multiRowCard' } }, resolveTheme())
    expect(s.data.size).toBe(10)
    expect(s.category.font.size).toBe(9)
  })
})
