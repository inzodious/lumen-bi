import { buildParagraphs, fitScale, fitsOneLineInPbi, segoeParagraphWidth } from '../textboxModel'
import { isSegoeFamily, segoeTextWidth } from '../segoeMetrics'

const title = (text: string, size = '37.33px', family = 'Segoe UI Light') =>
  buildParagraphs([{ horizontalTextAlignment: 'center', textRuns: [{ value: text, textStyle: { fontFamily: family, fontSize: size, fontWeight: 'normal' } }] }])[0]

describe('Segoe UI metrics', () => {
  it('measures with per-weight advance widths', () => {
    // Selawik (Segoe-compatible) advances: Light "District Monthly Sales" = 8.896 em
    expect(segoeTextWidth('District Monthly Sales', 37.33, 300)).toBeCloseTo(332.1, 0)
    expect(segoeTextWidth('District Monthly Sales', 37.33, 400)).toBeGreaterThan(segoeTextWidth('District Monthly Sales', 37.33, 300))
    expect(segoeTextWidth('District Monthly Sales', 37.33, 700)).toBeGreaterThan(segoeTextWidth('District Monthly Sales', 37.33, 600))
    expect(segoeTextWidth('', 20)).toBe(0)
    expect(segoeTextWidth('é', 10)).toBeGreaterThan(0)
  })
  it('recognizes Segoe families and theme font tokens', () => {
    expect(isSegoeFamily("'Segoe UI', 'Selawik', sans-serif")).toBe(true)
    expect(isSegoeFamily("'Heading', sans-serif")).toBe(true)
    expect(isSegoeFamily("'DIN', sans-serif")).toBe(false)
  })
})

describe('textbox single-line fit (PBI line breaks with a wider fallback font)', () => {
  it('a 28pt Segoe UI Light title fits a 340px box on one line, as in PBI', () => {
    const p = title('District Monthly Sales')
    expect(p.runs[0].style.fontWeight).toBe(300)
    expect(segoeParagraphWidth(p)).toBeCloseTo(332.1, 0)
    expect(fitsOneLineInPbi(p, 340)).toBe(true)
    expect(fitsOneLineInPbi(p, 330)).toBe(true) // 340px box minus container padding
    expect(fitsOneLineInPbi(p, 300)).toBe(false)
  })
  it('does not predict non-Segoe fonts, dynamic values or multi-line text', () => {
    expect(fitsOneLineInPbi(title('District Monthly Sales', '37.33px', 'DIN'), 1000)).toBe(false)
    const dyn = buildParagraphs([{ textRuns: [{ value: '', valueExpr: { Measure: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: 'Total' } } }] }])[0]
    expect(fitsOneLineInPbi(dyn, 1000)).toBe(false)
    expect(fitsOneLineInPbi(title('a\nb'), 1000)).toBe(false)
  })
  it('scales down only as much as needed, never up, with a floor', () => {
    expect(fitScale(375, 340)).toBeCloseTo(0.906, 3)
    expect(fitScale(300, 340)).toBe(1)
    expect(fitScale(1000, 340)).toBe(0.7)
    expect(fitScale(0, 340)).toBe(1)
  })
})
