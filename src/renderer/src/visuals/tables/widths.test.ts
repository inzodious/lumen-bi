import { computeWidths } from './widths'
import { steppedHeaderWidth } from './MatrixVisual'

const font = { family: 'Segoe UI', size: 10, color: '#000' }
const col = (texts: string[], explicit?: number) => ({ header: 'H', headerFont: font, texts, valueFont: font, explicit })

describe('column widths', () => {
  it('auto-size off without a saved width measures content (PBI keeps the initial content width)', () => {
    const [narrow, wide] = computeWidths([col(['a']), col(['a much much longer row header label'])], { autoSize: false, wrapHeader: false, available: 1000, adjustment: 'auto' })
    expect(wide).toBeGreaterThan(narrow)
    expect(wide).not.toBe(120)
  })
  it('saved widths win; fixed-width adjustment uses the default width', () => {
    expect(computeWidths([col(['x'], 300)], { autoSize: false, wrapHeader: false, available: 1000, adjustment: 'auto' })).toEqual([300])
    expect(computeWidths([col(['long long long text'])], { autoSize: true, defaultWidth: 90, wrapHeader: false, available: 1000, adjustment: 'fixedWidth' })).toEqual([90])
  })
  it('stepped row header width comes from the outermost row field, else the widest saved level', () => {
    const w = new Map([
      ['Geo.Region', 400],
      ['Geo.City', 143]
    ])
    expect(steppedHeaderWidth(['Geo.Region', 'Geo.City'], w)).toBe(400)
    expect(steppedHeaderWidth(['Other.Level', 'Geo.City'], w)).toBe(143)
    expect(steppedHeaderWidth(['Other.Level'], w)).toBeUndefined()
  })
})
