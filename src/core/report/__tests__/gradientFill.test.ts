import { describe, expect, it } from 'vitest'
import { colorAt, defaultGradient, findFill, gradientCss, gradientFallback, gradientId, gradientSupported, LUMEN_FILL_ANNOTATION, parseGradient, readFills, svgGradientGeometry, writeFill, type GradientFill } from '../gradientFill'
import { gradientForRaw, gradientOf, makePropContext } from '../props'
import { lumenStyleCss } from '../lumenStyle'
import { resolveTheme } from '../theme'

const G: GradientFill = { kind: 'linear', angle: 90, stops: [{ color: '#000000', offset: 0 }, { color: '#FFFFFF', offset: 1 }] }
const solid = (hex: string) => ({ solid: { color: { expr: { Literal: { Value: `'${hex}'` } } } } })

describe('gradient fills (Lumen_Fill)', () => {
  it('sanitises gradients', () => {
    expect(parseGradient({ stops: ['#fff'] })).toBeUndefined()
    expect(parseGradient({ stops: [{ color: 'red' }, { color: '#fff' }] })).toBeUndefined()
    const g = parseGradient({ kind: 'weird', angle: 999, stops: [{ color: '#ffffff', offset: 1 }, { color: '#000', offset: -2 }] })!
    expect(g.kind).toBe('linear')
    expect(g.angle).toBe(360)
    expect(g.stops).toEqual([
      { color: '#000000', offset: 0 },
      { color: '#FFFFFF', offset: 1 }
    ])
    expect(parseGradient({ kind: 'radial', stops: [{ color: '#111111' }, { color: '#222222' }, { color: '#333333' }] })!.stops.map((s) => s.offset)).toEqual([0, 0.5, 1])
  })

  it('interpolates colors and picks the midpoint as the Power BI fallback', () => {
    expect(colorAt(G, 0)).toBe('#000000')
    expect(colorAt(G, 1)).toBe('#FFFFFF')
    expect(colorAt(G, 0.5)).toBe('#808080')
    expect(gradientFallback(G)).toBe('#808080')
    const three: GradientFill = { kind: 'linear', angle: 0, stops: [{ color: '#FF0000', offset: 0 }, { color: '#00FF00', offset: 0.5 }, { color: '#0000FF', offset: 1 }] }
    expect(gradientFallback(three)).toBe('#00FF00')
    expect(colorAt({ ...G, stops: [{ color: '#00000000', offset: 0 }, { color: '#000000FF', offset: 1 }] }, 0.5)).toBe('#00000080')
  })

  it('writes CSS and SVG geometry', () => {
    expect(gradientCss(G)).toBe('linear-gradient(90deg, #000000 0%, #FFFFFF 100%)')
    expect(gradientCss({ ...G, kind: 'radial' }, 50)).toBe('radial-gradient(circle at 50% 50%, rgba(0,0,0,0.5) 0%, rgba(255,255,255,0.5) 100%)')
    expect(svgGradientGeometry(G)).toEqual({ x1: 0, y1: 0.5, x2: 1, y2: 0.5 })
    expect(svgGradientGeometry({ ...G, angle: 180 })).toEqual({ x1: 0.5, y1: 0, x2: 0.5, y2: 1 })
    expect(gradientId(G)).toBe(gradientId({ ...G }))
    expect(gradientId(G)).not.toBe(gradientId(G, 20))
  })

  it('starts a gradient from the current color', () => {
    const g = defaultGradient('#118dff')
    expect(g.stops[0].color).toBe('#118DFF')
    expect(g.stops).toHaveLength(2)
    expect(defaultGradient(undefined).stops[0].color).toBe('#118DFF')
    // white fades to a visible gray, not to white
    expect(defaultGradient('#FFFFFF').stops[1].color).toBe('#CCCCCC')
  })

  it('stores entries in the annotation and removes it once empty', () => {
    const json: any = { name: 'v', annotations: [{ name: 'Other', value: 'x' }] }
    writeFill(json, { object: 'background', prop: 'color', container: true }, { gradient: G, fallback: '#808080' })
    writeFill(json, { object: 'dataPoint', prop: 'fill', selector: { metadata: 'Sum(T.V)' } }, { gradient: G, fallback: '#808080' })
    expect(json.annotations).toHaveLength(2)
    const fills = readFills(json)
    expect(fills).toHaveLength(2)
    expect(findFill(fills, { object: 'background', prop: 'color', container: true })?.gradient).toEqual(G)
    expect(findFill(fills, { object: 'background', prop: 'color' })).toBeUndefined()
    // `{ id: 'default' }` is the default entry group
    writeFill(json, { object: 'background', prop: 'color', container: true, selector: { id: 'default' } }, { gradient: { ...G, angle: 45 }, fallback: '#808080' })
    expect(readFills(json).filter((f) => f.object === 'background')).toHaveLength(1)
    expect(readFills(json).find((f) => f.object === 'background')!.selector).toBeUndefined()
    writeFill(json, { object: 'background', prop: 'color', container: true }, undefined)
    writeFill(json, { object: 'dataPoint', prop: 'fill', selector: { metadata: 'Sum(T.V)' } }, undefined)
    expect(json.annotations).toEqual([{ name: 'Other', value: 'x' }])
    const bare: any = {}
    writeFill(bare, { object: 'a', prop: 'b' }, { gradient: G, fallback: '#808080' })
    writeFill(bare, { object: 'a', prop: 'b' }, undefined)
    expect(bare).toEqual({})
  })

  it('ignores broken annotations', () => {
    expect(readFills({ annotations: [{ name: LUMEN_FILL_ANNOTATION, value: '{nope' }] })).toEqual([])
    expect(readFills({ annotations: [{ name: LUMEN_FILL_ANNOTATION, value: JSON.stringify([{ object: 'a', prop: 'b', fallback: 'red', gradient: G }]) }] })).toEqual([])
  })

  it('applies only while the property still holds the fallback', () => {
    const theme = resolveTheme()
    const json: any = { visual: { visualType: 'shape', objects: { fill: [{ properties: { fillColor: solid('#808080') } }] } } }
    writeFill(json, { object: 'fill', prop: 'fillColor' }, { gradient: G, fallback: '#808080' })
    expect(gradientOf(makePropContext(json, theme), { object: 'fill', prop: 'fillColor' })).toEqual(G)
    expect(gradientForRaw(makePropContext(json, theme), { object: 'fill', prop: 'fillColor' }, solid('#808080'))).toEqual(G)
    // changed in Power BI: the solid color wins
    json.visual.objects.fill[0].properties.fillColor = solid('#FF0000')
    expect(gradientOf(makePropContext(json, theme), { object: 'fill', prop: 'fillColor' })).toBeUndefined()
  })

  it('keeps container gradients under Lumen_Style layers', () => {
    expect(lumenStyleCss({ radial: { at: '50% 50%', stops: ['#FFFFFF', '#000000'] } }, gradientCss(G)).background).toBe('radial-gradient(circle at 50% 50%, #FFFFFF, #000000), linear-gradient(90deg, #000000 0%, #FFFFFF 100%)')
  })

  it('lists the properties Lumen draws with gradients', () => {
    expect(gradientSupported('lineChart', 'background', 'color', true)).toBe(true)
    expect(gradientSupported('lineChart', 'background', 'color', false)).toBe(false)
    expect(gradientSupported('page', 'outspace', 'color')).toBe(true)
    expect(gradientSupported('shape', 'fill', 'fillColor')).toBe(true)
    expect(gradientSupported('clusteredColumnChart', 'dataPoint', 'fill')).toBe(true)
    expect(gradientSupported('lineChart', 'dataPoint', 'fill')).toBe(false)
    expect(gradientSupported('textbox', 'title', 'fontColor', true)).toBe(false)
  })
})
