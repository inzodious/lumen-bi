import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cssFontFamily, fontWeightOf, primaryFamily, resolveFont } from './text'
import { cssFont as styleFont, fontStyle, FALLBACK_STACK } from './textStyle'

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

describe('Segoe UI faces: weight with and without the Bold toggle', () => {
  // [family, weight, weight with Bold on, first family of the CSS stack without Bold]
  const cases: Array<[string, number, number, string]> = [
    ['Segoe UI', 400, 700, 'Segoe UI'],
    ['Segoe UI Light', 300, 700, 'Segoe UI Light'],
    ['Segoe UI Semibold', 600, 700, 'Segoe UI Semibold'],
    ['Segoe UI Bold', 700, 700, 'Segoe UI Bold']
  ]
  for (const [family, weight, boldWeight, face] of cases) {
    it(`${family}: ${weight}, Bold → ${boldWeight}`, () => {
      for (const stored of [family, `'${family}', wf_segoe-ui_normal, helvetica, arial, sans-serif`]) {
        const plain = resolveFont(stored)
        expect(plain.fontWeight).toBe(weight)
        expect(primaryFamily(plain.fontFamily)).toBe(face)
        const bold = resolveFont(stored, { bold: true })
        expect(bold.fontWeight).toBe(boldWeight)
        // Bold asks for the base family's real bold face, never a synthesized bold of the named face
        expect(primaryFamily(bold.fontFamily)).toBe('Segoe UI')
      }
      // the element / slicer helper agrees on the weight
      expect(fontStyle({ family, size: 10, color: '#000' }).fontWeight).toBe(weight)
      expect(fontStyle({ family, size: 10, color: '#000', bold: true }).fontWeight).toBe(700)
      expect(styleFont(family).fontWeight ?? 400).toBe(weight)
    })
  }
})

describe('bundled Segoe UI stand-in faces', () => {
  const css = readFileSync(resolve(__dirname, '../../assets/fonts/selawik/selawik.css'), 'utf8')
  const srcOf = (family: string, weight: string): string | undefined => {
    for (const rule of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
      if (rule.includes(`font-family: '${family}'`) && new RegExp(`font-weight: ${weight};`).test(rule)) return /url\('\.\/([^']+)'\)/.exec(rule)?.[1]
    }
    return undefined
  }

  it('every Semibold alias uses the lighter derived semibold face; regular and bold stay Selawik', () => {
    // Selawik's own Semibold is nearly as heavy as its Bold: semibold titles / headers would read as bold
    expect(srcOf('Segoe UI', '600')).toBe('lumensans-semibold.woff2')
    expect(srcOf('Segoe UI Semibold', '400')).toBe('lumensans-semibold.woff2')
    expect(srcOf('Segoe UI Semibold', '600')).toBe('lumensans-semibold.woff2')
    expect(srcOf('wf_segoe-ui_semibold', 'normal')).toBe('lumensans-semibold.woff2')
    expect(srcOf('Segoe UI', '400')).toBe('selawk.woff2')
    expect(srcOf('Segoe UI', '700')).toBe('selawkb.woff2')
    expect(srcOf('Segoe UI Bold', '700')).toBe('selawkb.woff2')
    expect(srcOf('Segoe UI Light', '300')).toBe('selawkl.woff2')
  })
})

describe('text box / card fonts that Linux rarely has', () => {
  it('fall back to a face of the same kind, not the Segoe stand-in', () => {
    expect(styleFont('Georgia').fontFamily).toMatch(/^'Georgia', Georgia, .*serif$/)
    expect(styleFont('Consolas').fontFamily).toMatch(/monospace$/)
    expect(styleFont('Arial Black')).toEqual({ fontFamily: "'Arial', Arial, Helvetica, sans-serif", fontWeight: 900 })
    // Segoe faces keep the Segoe-like stack
    expect(styleFont('Segoe UI Semibold')).toEqual({ fontFamily: `'Segoe UI', ${FALLBACK_STACK}`, fontWeight: 600 })
  })
})
