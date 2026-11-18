import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { resolveTheme } from '@core/report/theme'
import { DEFAULT_PADDING, resolveChrome, titleAreaGaps, type SpacingSpec } from '../chrome'
import { TitleBlock } from '../VisualContainer'

const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
const color = (hex: string) => ({ solid: { color: lit(`'${hex}'`) } })
const obj = (properties: Record<string, unknown>, selector?: unknown) => [selector ? { properties, selector } : { properties }]
/** un-escaped it is: 'Segoe UI Semibold', wf_segoe-ui_semibold, helvetica, arial, sans-serif */
const SEMIBOLD = lit("'''Segoe UI Semibold'', wf_segoe-ui_semibold, helvetica, arial, sans-serif'")

function chrome(vco: Record<string, unknown>, opts: { type?: string; objects?: Record<string, unknown>; theme?: any } = {}) {
  return resolveChrome({ visual: { visualType: opts.type ?? 'barChart', objects: opts.objects, visualContainerObjects: vco } }, resolveTheme(undefined, opts.theme))
}

describe('container title', () => {
  it('a Semibold family is semibold, not bold; the stored fallbacks are replaced', () => {
    const t = chrome({ title: obj({ show: lit('true'), text: lit("'Revenue by Region'"), fontSize: lit('14D'), fontFamily: SEMIBOLD, fontColor: color('#112233') }) }).title
    expect(t.fontWeight).toBe(600)
    expect(t.fontFamily.startsWith("'Segoe UI Semibold', 'Segoe UI'")).toBe(true)
    expect(t.fontFamily).not.toMatch(/wf_|helvetica,/)
    expect(t.fontSizePx).toBeCloseTo((14 * 4) / 3, 6)
    expect(t.color).toBe('#112233')
    expect(t.text).toBe('Revenue by Region')
    expect(t.italic).toBe(false)
    expect(t.underline).toBe(false)
  })

  it('bold / italic / underline are flags of their own', () => {
    const t = chrome({ title: obj({ show: lit('true'), fontFamily: lit("'Segoe UI'"), bold: lit('true'), italic: lit('true'), underline: lit('true') }) }).title
    expect(t.fontWeight).toBe(700)
    expect(t.italic).toBe(true)
    expect(t.underline).toBe(true)
    const semiboldBold = chrome({ title: obj({ show: lit('true'), fontFamily: SEMIBOLD, bold: lit('true') }) }).title
    expect(semiboldBold.fontWeight).toBe(700)
    expect(semiboldBold.fontFamily.startsWith("'Segoe UI',")).toBe(true)
  })

  it('font sizes are points, also when stored as a string literal', () => {
    expect(chrome({ title: obj({ show: lit('true'), fontSize: lit("'14'") }) }).title.fontSizePx).toBeCloseTo(18.667, 2)
    expect(chrome({ title: obj({ show: lit('true'), fontSize: lit('9D') }) }).title.fontSizePx).toBe(12)
  })

  it('defaults come from the theme: text class, then the wildcard visual style', () => {
    const base = chrome({ title: obj({ show: lit('true') }) }).title
    expect(base.fontSizePx).toBe(16) // title text class: DIN 12pt
    expect(base.fontFamily.startsWith("'DIN'")).toBe(true)
    expect(base.fontWeight).toBe(400)
    const theme = { textClasses: { title: { fontFace: 'Segoe UI Semibold', fontSize: 16, color: '#101010' } }, visualStyles: { '*': { '*': { title: [{ fontSize: 14, alignment: 'Center' }] } } } }
    const t = chrome({ title: obj({ show: lit('true') }) }, { theme }).title
    expect(t.fontWeight).toBe(600)
    expect(t.fontSizePx).toBeCloseTo(18.667, 2)
    expect(t.color).toBe('#101010')
    expect(t.align).toBe('center')
  })

  it('the subtitle shares the title background', () => {
    const c = chrome({ title: obj({ show: lit('true'), background: color('#223344') }), subTitle: obj({ show: lit('true'), text: lit("'by month'") }) })
    expect(c.subTitle.show).toBe(true)
    expect(c.subTitle.background).toBe('#223344')
  })

  it('switching the Title card off hides the subtitle and the divider too', () => {
    const c = chrome({ title: obj({ show: lit('false') }), subTitle: obj({ show: lit('true'), text: lit("'x'") }), divider: obj({ show: lit('true') }) })
    expect(c.title.show).toBe(false)
    expect(c.subTitle.show).toBe(false)
    expect(c.divider).toBeUndefined()
  })
})

describe('divider, padding, spacing', () => {
  it('reads the divider as authored; "Ignore padding" is on unless switched off', () => {
    const d = chrome({ title: obj({ show: lit('true') }), divider: obj({ show: lit('true'), color: color('#3A7CA5'), width: lit('3D'), style: lit("'dashed'"), ignorePadding: lit('false') }) }).divider
    expect(d).toEqual({ color: '#3A7CA5', style: 'dashed', width: 3, ignorePadding: false })
    expect(chrome({ title: obj({ show: lit('true') }), divider: obj({ show: lit('true') }) }).divider).toMatchObject({ width: 1, style: 'solid', ignorePadding: true })
  })

  it("default padding is Power BI's: none at the top, 5 px on the other sides", () => {
    expect(DEFAULT_PADDING).toEqual({ top: 0, right: 5, bottom: 5, left: 5 })
    expect(chrome({}).padding).toEqual({ top: 0, right: 5, bottom: 5, left: 5 })
    expect(chrome({ padding: obj({ top: lit('4D'), left: lit('8D') }) }).padding).toEqual({ top: 4, right: 5, bottom: 5, left: 8 })
    // elements (text box, shape, image, button…) keep 5 px all around
    const element = resolveChrome({ visual: { visualType: 'textbox', visualContainerObjects: {} } }, resolveTheme(), { element: true })
    expect(element.padding).toEqual({ top: 5, right: 5, bottom: 5, left: 5 })
  })

  it("a visual's own objects never leak into the container chrome", () => {
    // e.g. the card visual has `divider` / `padding` objects of its own
    const c = chrome({ title: obj({ show: lit('true') }) }, { type: 'cardVisual', objects: { divider: obj({ show: lit('true'), width: lit('4D') }), padding: obj({ top: lit('20D') }), title: obj({ text: lit("'inner'") }) } })
    expect(c.divider).toBeUndefined()
    expect(c.padding.top).toBe(0)
    expect(c.title.text).toBeUndefined()
  })

  const gaps = (spacing: Record<string, unknown> | undefined, shown: { title: boolean; subTitle: boolean; divider: boolean }) =>
    titleAreaGaps(chrome({ title: obj({ show: lit('true') }), ...(spacing ? { spacing: obj(spacing) } : {}) }).spacing, shown)

  it('default: 5 px after each shown element (title, subtitle, divider)', () => {
    expect(gaps(undefined, { title: true, subTitle: false, divider: false })).toEqual({ titleToSubTitle: 0, aboveDivider: 0, aboveContent: 5 })
    expect(gaps(undefined, { title: true, subTitle: true, divider: true })).toEqual({ titleToSubTitle: 5, aboveDivider: 5, aboveContent: 5 })
    expect(gaps(undefined, { title: false, subTitle: false, divider: false })).toEqual({ titleToSubTitle: 0, aboveDivider: 0, aboveContent: 0 })
  })

  it('"Vertical spacing" sets all of them; per-element values need "Customize spacing"', () => {
    expect(gaps({ verticalSpacing: lit('8D') }, { title: true, subTitle: true, divider: true })).toEqual({ titleToSubTitle: 8, aboveDivider: 8, aboveContent: 8 })
    const per = { spaceBelowTitle: lit('2D'), spaceBelowSubTitle: lit('3D'), spaceBelowTitleArea: lit('10D') }
    expect(gaps(per, { title: true, subTitle: true, divider: true })).toEqual({ titleToSubTitle: 5, aboveDivider: 5, aboveContent: 5 })
    expect(gaps({ customizeSpacing: lit('true'), ...per }, { title: true, subTitle: true, divider: true })).toEqual({ titleToSubTitle: 2, aboveDivider: 3, aboveContent: 10 })
    // without a subtitle the divider follows the title's own space; without a divider the content does
    expect(gaps({ customizeSpacing: lit('true'), ...per }, { title: true, subTitle: false, divider: true })).toEqual({ titleToSubTitle: 0, aboveDivider: 2, aboveContent: 10 })
    expect(gaps({ customizeSpacing: lit('true'), ...per }, { title: true, subTitle: true, divider: false })).toEqual({ titleToSubTitle: 2, aboveDivider: 0, aboveContent: 3 })
  })

  it('the "space above …" properties of the newer format pane win when present', () => {
    const sp = { customizeSpacing: lit('true'), spaceBelowTitleArea: lit('0D'), verticalSpacing: lit('5D'), spaceAboveDivider: lit('6D'), spaceAbovePlotArea: lit('9D') }
    expect(gaps(sp, { title: true, subTitle: false, divider: true })).toEqual({ titleToSubTitle: 0, aboveDivider: 6, aboveContent: 9 })
    expect(gaps({ ...sp, spaceAboveSubtitle: lit('1D') }, { title: true, subTitle: true, divider: false })).toEqual({ titleToSubTitle: 1, aboveDivider: 0, aboveContent: 9 })
  })

  it('titleAreaGaps is pure over the spec', () => {
    const sp: SpacingSpec = { model: 'below', belowTitle: 1, belowSubTitle: 2, belowDivider: 3, aboveSubTitle: 0, aboveDivider: 0, abovePlotArea: 0 }
    expect(titleAreaGaps(sp, { title: false, subTitle: true, divider: true })).toEqual({ titleToSubTitle: 0, aboveDivider: 2, aboveContent: 3 })
  })
})

describe('title block markup', () => {
  const render = (vco: Record<string, unknown>, title?: string, subTitle?: string) => renderToStaticMarkup(createElement(TitleBlock, { chrome: chrome(vco), title, subTitle }))

  it('title text is inset by the padding, its background spans the container and covers the spacing below', () => {
    const html = render({ title: obj({ show: lit('true'), background: color('#223344') }), padding: obj({ left: lit('10D'), right: lit('12D') }) }, 'Revenue')
    expect(html).toContain('margin:0 -12px 0 -10px')
    expect(html).toContain('padding:0 12px 5px 10px')
    expect(html).toContain('line-height:normal')
    expect(html).toContain('>Revenue<')
  })

  it('the divider sits one spacing below the title and respects the padding unless told to ignore it', () => {
    const vco = (ignore: boolean) => ({ title: obj({ show: lit('true') }), divider: obj({ show: lit('true'), color: color('#3A7CA5'), width: lit('3D'), ignorePadding: lit(String(ignore)) }) })
    const inset = render(vco(false), 'Revenue')
    expect(inset).toContain('border-top:3px solid #3A7CA5')
    expect(inset).toContain('margin:0 0 5px')
    expect(inset).toContain('padding:0 5px 5px 5px')
    expect(render(vco(true), 'Revenue')).toContain('margin:0 -5px 5px -5px')
  })

  it('renders nothing without title, subtitle and divider', () => {
    expect(render({ title: obj({ show: lit('false') }) })).toBe('')
  })
})
