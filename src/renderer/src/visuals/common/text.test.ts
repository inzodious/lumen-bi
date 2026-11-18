import { describe, expect, it } from 'vitest'
import { cssFontFamily, fontWeightOf, primaryFamily, resolveFont } from './text'

/** what the format pane stores for "Segoe UI Semibold" (a PBIR string literal un-escaped: quoted family + PBI's own fallbacks) */
const SEMIBOLD_STACK = "'Segoe UI Semibold', wf_segoe-ui_semibold, helvetica, arial, sans-serif"

describe('Power BI font names', () => {
  it('takes the first family of a stack, with or without (doubled) quotes', () => {
    expect(primaryFamily(SEMIBOLD_STACK)).toBe('Segoe UI Semibold')
    expect(primaryFamily("''Segoe UI Semibold'', wf_segoe-ui_semibold")).toBe('Segoe UI Semibold')
    expect(primaryFamily('wf_standard-font, helvetica, arial, sans-serif')).toBe('wf_standard-font')
    expect(primaryFamily(undefined)).toBe('')
  })

  it('a face name carries its own weight — never bold because of a family name', () => {
    expect(fontWeightOf('Segoe UI')).toBe(400)
    expect(fontWeightOf("'Segoe UI', wf_segoe-ui_normal, helvetica, arial, sans-serif")).toBe(400)
    expect(fontWeightOf('Segoe UI Light')).toBe(300)
    expect(fontWeightOf('Segoe UI Semilight')).toBe(350)
    expect(fontWeightOf('Segoe UI Semibold')).toBe(600)
    expect(fontWeightOf(SEMIBOLD_STACK)).toBe(600)
    expect(fontWeightOf('wf_segoe-ui_semibold')).toBe(600)
    expect(fontWeightOf('Segoe UI Bold')).toBe(700)
    expect(fontWeightOf('wf_segoe-ui_bold, helvetica, arial, sans-serif')).toBe(700)
    expect(fontWeightOf('DIN')).toBe(400)
    expect(fontWeightOf('wf_standard-font_light')).toBe(300)
    expect(fontWeightOf('Arial Black')).toBe(900)
    // only the first family counts: a bold fallback further down the stack says nothing
    expect(fontWeightOf("Calibri, 'Segoe UI Bold', sans-serif")).toBe(400)
    // a family that merely ends in the letters isn't a weighted face
    expect(fontWeightOf('Highlight')).toBe(400)
  })

  it('the Bold toggle is separate from the face', () => {
    expect(fontWeightOf('Segoe UI', true)).toBe(700)
    expect(fontWeightOf('Segoe UI Light', true)).toBe(700)
    expect(fontWeightOf('Arial Black', true)).toBe(900)
  })

  it('resolves the stored stack to the named face plus the Segoe-metric fallbacks', () => {
    const f = resolveFont(SEMIBOLD_STACK)
    expect(f.fontWeight).toBe(600)
    expect(f.fontFamily.startsWith("'Segoe UI Semibold', 'Segoe UI', 'Selawik'")).toBe(true)
    // PBI's own fallbacks (helvetica, arial) would resolve to Arial-metric fonts on Linux: the metric-compatible ones come first
    expect(f.fontFamily).not.toMatch(/wf_|helvetica,/)
    expect(f.fontFamily.indexOf('Selawik')).toBeLessThan(f.fontFamily.indexOf('Arial'))
    expect(resolveFont('wf_segoe-ui_semibold')).toEqual({ fontFamily: resolveFont('Segoe UI').fontFamily, fontWeight: 600 })
    expect(resolveFont(undefined)).toEqual({ fontFamily: cssFontFamily('Segoe UI'), fontWeight: 400 })
  })

  it('Bold on a weighted face asks for the real bold face of the base family', () => {
    const f = resolveFont(SEMIBOLD_STACK, { bold: true })
    expect(f.fontWeight).toBe(700)
    expect(f.fontFamily.startsWith("'Segoe UI',")).toBe(true)
  })

  it('DIN and its web-font alias share one stack that ends in the Segoe fallbacks', () => {
    const din = resolveFont('DIN')
    expect(din.fontFamily.startsWith("'DIN'")).toBe(true)
    expect(din.fontFamily).toContain("'Segoe UI'")
    expect(resolveFont('wf_standard-font, helvetica, arial, sans-serif')).toEqual(din)
    expect(resolveFont('wf_standard-font_light').fontWeight).toBe(300)
  })

  it('custom families keep their own fallbacks ahead of ours', () => {
    const f = resolveFont("'Brand Sans', 'Brand Fallback', arial, sans-serif")
    expect(f.fontFamily.startsWith("'Brand Sans', 'Brand Fallback', 'Segoe UI'")).toBe(true)
    expect(f.fontWeight).toBe(400)
    expect(resolveFont('Brand Sans Bold').fontFamily.startsWith("'Brand Sans Bold', 'Brand Sans', ")).toBe(true)
  })
})
