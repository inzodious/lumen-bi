import { describe, expect, it } from 'vitest'
import { makePropContext, rawProp } from '@core/report/props'
import { resolveTheme } from '@core/report/theme'
import type { FormatPropDef } from '../../visuals/contract'
import { resolveChrome, ptToPx } from '../../report/chrome'
import { layoutProps, propState, type PropSource } from './propModel'
import { containerDefault, rendererDefault, titleOnByDefault, visualDefault } from './effective'
import { normalizeNumber, parseNumberInput, stepNumber } from './controls'
import { SHAPE_DEFAULTS } from '../../visuals/elements/Shape'
import { getVisual } from '../../visuals/registry'
import '../../visuals/elements' // registers shape / buttons (category element)

const theme = resolveTheme()
const lit = (v: string) => ({ expr: { Literal: { Value: v } } })

/** A BagTarget-like source over a visual json (what FormatTab's visualTarget builds). */
function source(visualJson: any, container: boolean): PropSource {
  const pc = makePropContext(visualJson, theme)
  const v = visualJson.visual
  return {
    bag: container ? v.visualContainerObjects : v.objects,
    resolveRaw: (object, prop, sel) => rawProp(pc, object, prop, sel),
    defaults: (object, prop) => rendererDefault(object, prop, theme, v.visualType, container),
    theme
  }
}

const p = (name: string, type: FormatPropDef['type'], extra: Partial<FormatPropDef> = {}): FormatPropDef => ({ name, displayName: name, type, ...extra })

describe('format pane effective values', () => {
  it('shows the renderer default of an unset shape border instead of an empty control', () => {
    const shape = { visual: { visualType: 'shape', objects: { outline: [{ properties: { show: lit('true') } }] } } }
    const src = source(shape, false)
    // the reported case: Border on, Width / Color never set
    expect(propState(p('weight', 'integer'), 'outline', src)).toMatchObject({ explicit: false, value: SHAPE_DEFAULTS.weight })
    expect(propState(p('lineColor', 'color'), 'outline', src)).toMatchObject({ explicit: false, value: theme.dataColors[0] })
    expect(propState(p('transparency', 'percent'), 'outline', src).value).toBe(0)
    expect(propState(p('show', 'bool'), 'outline', src)).toMatchObject({ explicit: true, value: true })
    // fill is on unless switched off (the header toggle must not read "Off" for a filled shape)
    expect(propState(p('show', 'bool'), 'fill', src)).toMatchObject({ explicit: false, value: true })
  })

  it('an explicit value wins over every default; the theme wins over the renderer default', () => {
    const shape = { visual: { visualType: 'shape', objects: { outline: [{ properties: { weight: lit('4D') } }] } } }
    expect(propState(p('weight', 'integer', { default: 9 }), 'outline', source(shape, false))).toMatchObject({ explicit: true, value: 4 })
    const themed = resolveTheme(undefined, { visualStyles: { shape: { '*': { outline: [{ weight: 3 }] } } } })
    const pc = makePropContext({ visual: { visualType: 'shape' } }, themed)
    const src: PropSource = { bag: undefined, resolveRaw: (o, n, s) => rawProp(pc, o, n, s), defaults: (o, n) => visualDefault(o, n, themed, 'shape'), theme: themed }
    expect(propState(p('weight', 'integer'), 'outline', src)).toMatchObject({ explicit: false, value: 3 })
  })

  it('falls back to the card default, then to "automatic" (undefined) when nothing is known', () => {
    const src = source({ visual: { visualType: 'someVisual' } }, false)
    expect(propState(p('size', 'integer', { default: 7 }), 'thing', src).value).toBe(7)
    expect(propState(p('size', 'integer'), 'thing', src).value).toBeUndefined()
    // a renderer default of `false` / 0 is a value, not "unknown"
    expect(propState(p('show', 'bool', { default: true }), 'text', source({ visual: { visualType: 'shape' } }, false)).value).toBe(false)
  })

  it('container defaults are the ones the container chrome really uses', () => {
    for (const visualType of ['clusteredColumnChart', 'tableEx', 'slicer', 'shape']) {
      // everything switched on, nothing else set → the chrome falls back to its defaults
      const json = { visual: { visualType, visualContainerObjects: { title: [{ properties: { show: lit('true') } }], subTitle: [{ properties: { show: lit('true') } }], divider: [{ properties: { show: lit('true') } }], border: [{ properties: { show: lit('true') } }] } } }
      // the options VisualContainer passes (elements keep 5 px padding on every side)
      const chrome = resolveChrome(json, theme, { element: getVisual(visualType)?.category === 'element' })
      const d = (object: string, prop: string) => containerDefault(object, prop, theme, visualType)
      expect(chrome.title.color).toBe(d('title', 'fontColor'))
      expect(chrome.title.fontSizePx).toBe(ptToPx(d('title', 'fontSize') as number))
      expect(chrome.subTitle.color).toBe(d('subTitle', 'fontColor'))
      expect(chrome.subTitle.fontSizePx).toBe(ptToPx(d('subTitle', 'fontSize') as number))
      expect(chrome.divider).toMatchObject({ color: d('divider', 'color'), width: d('divider', 'width') })
      expect(chrome.border).toMatchObject({ color: d('border', 'color'), width: d('border', 'width'), radius: d('border', 'radius') })
      expect(chrome.padding).toEqual({ top: d('padding', 'top'), right: d('padding', 'right'), bottom: d('padding', 'bottom'), left: d('padding', 'left') })
      expect(chrome.header.foreground).toBe(d('visualHeader', 'foreground'))
      // title on/off when unset (the General ▸ Title toggle)
      expect(resolveChrome({ visual: { visualType } }, theme).title.show).toBe(titleOnByDefault(visualType))
    }
    // data visuals have no top padding by default, elements 5 px (report/chrome.ts DEFAULT_PADDING / ELEMENT_PADDING)
    expect(getVisual('shape')?.category).toBe('element')
    expect(containerDefault('padding', 'top', theme, 'clusteredColumnChart')).toBe(0)
    expect(containerDefault('padding', 'top', theme, 'shape')).toBe(5)
    expect(containerDefault('spacing', 'verticalSpacing', theme, 'clusteredColumnChart')).toBe(resolveChrome({ visual: { visualType: 'clusteredColumnChart' } }, theme).spacing.belowTitle)
    // unknown container properties stay automatic
    expect(containerDefault('title', 'background', theme, 'tableEx')).toBeUndefined()
  })
})

describe('format pane row layout', () => {
  const names = (defs: FormatPropDef[]) =>
    layoutProps(defs).map((i) => (i.kind === 'row' ? i.def.name : i.kind === 'font' ? `font(${i.family.name}+${i.size.name})` : `style(${i.defs.map((d) => d.name).join(',')})`))

  it('puts the font family next to its size and groups B / I / U', () => {
    const defs = [p('text', 'text'), p('fontFamily', 'fontFamily'), p('fontSize', 'fontSize'), p('bold', 'bool'), p('italic', 'bool'), p('underline', 'bool'), p('fontColor', 'color')]
    expect(names(defs)).toEqual(['text', 'font(fontFamily+fontSize)', 'style(bold,italic,underline)', 'fontColor'])
  })
  it('accepts prefixed names, "text size" and two-button groups', () => {
    expect(names([p('titleFontFamily', 'fontFamily'), p('titleFontSize', 'fontSize'), p('titleBold', 'bool'), p('titleItalic', 'bool'), p('wrap', 'bool')])).toEqual(['font(titleFontFamily+titleFontSize)', 'style(titleBold,titleItalic)', 'wrap'])
    expect(names([p('fontFamily', 'fontFamily'), p('textSize', 'fontSize')])).toEqual(['font(fontFamily+textSize)'])
  })
  it('leaves everything else one property per row', () => {
    // a lone bold switch, a font size without family, bold switches of two different texts
    expect(names([p('bold', 'bool'), p('fontSize', 'fontSize'), p('show', 'bool')])).toEqual(['bold', 'fontSize', 'show'])
    expect(names([p('titleBold', 'bool'), p('valueBold', 'bool')])).toEqual(['titleBold', 'valueBold'])
    expect(names([p('embolden', 'enum')])).toEqual(['embolden'])
    // a size listed before the family, or the size of another text, keeps its own labelled row (Filter pane card)
    expect(names([p('titleSize', 'fontSize'), p('headerSize', 'fontSize'), p('fontFamily', 'fontFamily')])).toEqual(['titleSize', 'headerSize', 'fontFamily'])
    expect(names([p('fontFamily', 'fontFamily'), p('headerSize', 'fontSize')])).toEqual(['fontFamily', 'headerSize'])
    expect(names([p('a', 'fontFamily'), p('b', 'fontFamily'), p('c', 'fontSize')])).toEqual(['a', 'b', 'c'])
  })
})

describe('format pane numeric input', () => {
  it('parses typed text: empty resets, junk is rejected, comma decimals work', () => {
    expect(parseNumberInput('')).toBeUndefined()
    expect(parseNumberInput('  ')).toBeUndefined()
    expect(parseNumberInput('12')).toBe(12)
    expect(parseNumberInput(' 1,5 ')).toBe(1.5)
    expect(parseNumberInput('abc')).toBeNull()
    expect(parseNumberInput('1e999')).toBeNull()
  })
  it('clamps and rounds', () => {
    expect(normalizeNumber(12.6, { integer: true })).toBe(13)
    expect(normalizeNumber(120, { min: 0, max: 100 })).toBe(100)
    expect(normalizeNumber(-3, { min: 1 })).toBe(1)
    expect(normalizeNumber(0.1 + 0.2, {})).toBe(0.3)
    expect(normalizeNumber(1.23456, { step: 0.001 })).toBe(1.235)
  })
  it('steps from the current value, and from the lower bound / zero when there is none', () => {
    expect(stepNumber(5, 1, { integer: true })).toBe(6)
    expect(stepNumber(5, -1, { integer: true, min: 5 })).toBe(5)
    expect(stepNumber(100, 1, { max: 100 })).toBe(100)
    expect(stepNumber(undefined, 1, {})).toBe(0)
    expect(stepNumber(undefined, -1, {})).toBe(0)
    expect(stepNumber(undefined, 1, { min: 8, max: 60 })).toBe(8)
    expect(stepNumber(undefined, -1, { min: 8, max: 60 })).toBe(8)
    expect(stepNumber(0.2, 1, { step: 0.1 })).toBe(0.3)
  })
})
