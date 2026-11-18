import { CELL_PAD_X, cellPadX, computeWidths, contentWidth, DEFAULT_FIXED_WIDTH, MIN_COLUMN_WIDTH, WRAP_TEXT } from './widths'
import { steppedHeaderWidth } from './MatrixVisual'

const font = { family: 'Segoe UI', size: 10, color: '#000' }
const col = (texts: string[], explicit?: number) => ({ header: 'H', headerFont: font, texts, valueFont: font, explicit })

describe('column widths', () => {
  it('auto-size off without a saved width measures content (PBI keeps the initial content width)', () => {
    const [narrow, wide] = computeWidths([col(['a']), col(['a much much longer row header label'])], { behavior: 'fixedWidth', legacyManual: true, wrapHeader: false, available: 1000 })
    expect(wide).toBeGreaterThan(narrow)
    expect(wide).not.toBe(120)
  })
  it('saved widths win; fixed-width adjustment uses the default width', () => {
    expect(computeWidths([col(['x'], 300)], { behavior: 'fixedWidth', legacyManual: true, wrapHeader: false, available: 1000 })).toEqual([300])
    expect(computeWidths([col(['long long long text'])], { behavior: 'fixedWidth', defaultWidth: 90, wrapHeader: false, available: 1000 })).toEqual([90])
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

  it('Fit to content: header and values decide; a bold total is measured with its own font', () => {
    const opts = { behavior: 'fitToContent' as const, wrapHeader: false, available: 1000 }
    const [a, b] = computeWidths([col(['short']), col(['a considerably longer value'])], opts)
    expect(b).toBeGreaterThan(a)
    const bold = { ...font, bold: true }
    const plain = contentWidth(col(['1,234']), opts)
    const withTotal = contentWidth({ ...col(['1,234']), extraTexts: [{ text: '6,487,996', font: bold }] }, opts)
    expect(withTotal).toBeGreaterThan(plain)
    expect(withTotal).toBeGreaterThanOrEqual(contentWidth(col(['6,487,996']), opts))
  })
  it('Grow to fit fills the viewport with the auto columns; custom widths stay; nothing shrinks when the content is wider', () => {
    const cols = [col(['a']), col(['b'], 200), col(['c'])]
    const fit = computeWidths(cols, { behavior: 'fitToContent', wrapHeader: false, available: 800 })
    const grow = computeWidths(cols, { behavior: 'growToFit', wrapHeader: false, available: 800 })
    expect(grow[1]).toBe(200)
    expect(grow[0]).toBeGreaterThan(fit[0])
    const total = grow.reduce((x, y) => x + y, 0)
    expect(total).toBeLessThanOrEqual(800)
    expect(total).toBeGreaterThan(800 - cols.length)
    // a narrower viewport (vertical scrollbar) is what gets filled
    expect(computeWidths(cols, { behavior: 'growToFit', wrapHeader: false, available: 792 }).reduce((x, y) => x + y, 0)).toBeLessThanOrEqual(792)
    // every column custom: nothing to grow
    expect(computeWidths([col(['a'], 100), col(['b'], 120)], { behavior: 'growToFit', wrapHeader: false, available: 800 })).toEqual([100, 120])
    // content wider than the visual: horizontal scrolling, widths unchanged
    expect(computeWidths(cols, { behavior: 'growToFit', wrapHeader: false, available: 150 })).toEqual(computeWidths(cols, { behavior: 'fitToContent', wrapHeader: false, available: 150 }))
  })
  it('Fixed width: the default width for every column without a custom width', () => {
    const cols = [col(['a long long long value']), col(['b'], 40), col(['c'])]
    expect(computeWidths(cols, { behavior: 'fixedWidth', defaultWidth: 75, wrapHeader: false, available: 300 })).toEqual([75, 40, 75])
    expect(computeWidths(cols, { behavior: 'fixedWidth', wrapHeader: false, available: 300 })).toEqual([DEFAULT_FIXED_WIDTH, 40, DEFAULT_FIXED_WIDTH])
    expect(computeWidths([col(['a'])], { behavior: 'fixedWidth', defaultWidth: 2, wrapHeader: false, available: 300 })).toEqual([MIN_COLUMN_WIDTH])
    // legacy "Auto-size width: off" with a default width set later uses it
    expect(computeWidths([col(['a long long long value'])], { behavior: 'fixedWidth', legacyManual: true, defaultWidth: 60, wrapHeader: false, available: 300 })).toEqual([60])
  })
  it('header text wrap lets a long header use the width of its values', () => {
    const c = { header: 'A rather long column header text', headerFont: font, texts: ['12'], valueFont: font }
    const nowrap = computeWidths([c], { behavior: 'fitToContent', wrapHeader: false, available: 1000 })[0]
    const wrap = computeWidths([c], { behavior: 'fitToContent', wrapHeader: true, available: 1000 })[0]
    expect(wrap).toBeLessThan(nowrap)
  })
  it('a column of width 0 (hidden) has no cell padding', () => {
    expect(cellPadX(0)).toBe(0)
    expect(cellPadX(100)).toBeGreaterThan(0)
    expect(computeWidths([col(['x'], 0)], { behavior: 'fitToContent', wrapHeader: false, available: 100 })).toEqual([0])
  })
  it('cells are padded 3px per side; word wrap breaks at spaces only and clips a longer word', () => {
    expect(CELL_PAD_X).toBe(3)
    expect(cellPadX(83)).toBe(3)
    expect(cellPadX(6)).toBe(0)
    // fit to content: the widest text + 2 × padding (+1px rounding guard)
    const w = computeWidths([col(['12345'])], { behavior: 'fitToContent', wrapHeader: false, available: 1000 })[0]
    expect(w - 2 * CELL_PAD_X - 1).toBeGreaterThanOrEqual(0)
    expect(WRAP_TEXT).toMatchObject({ whiteSpace: 'normal', overflowWrap: 'normal', wordBreak: 'normal', overflow: 'hidden' })
  })
})
