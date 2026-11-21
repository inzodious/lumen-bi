/** The shared color options of every color property: gradient paint map, visual-level fx, format painter. */
import { describe, expect, it } from 'vitest'
import { createEngine } from '@core/engine/engine'
import { resolveTheme } from '@core/report/theme'
import { readFills, writeFill, type GradientFill } from '@core/report/gradientFill'
import { createMockHost } from '../../visuals/common/mockHost'
import { buildSampleModel } from '../../visuals/gallery/sampleData'
import { activeGradients, parseCssColor } from '../gradientPaint'
import { hasVisualBoundColors, resolveBoundColors } from '../boundColors'
import { applyFormat, copyFormat } from '../formatPainter'

const G: GradientFill = { kind: 'linear', angle: 90, stops: [{ color: '#000000', offset: 0 }, { color: '#FFFFFF', offset: 1 }] }
const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
const solid = (hex: string) => ({ solid: { color: lit(`'${hex}'`) } })
const measure = (entity: string, prop: string) => ({ Measure: { Expression: { SourceRef: { Entity: entity } }, Property: prop } })

describe('gradient paint map', () => {
  it('parses the colors renderers write', () => {
    expect(parseCssColor('#abc')).toEqual({ hex: '#AABBCC', a: 1 })
    expect(parseCssColor('#11223380')).toEqual({ hex: '#112233', a: 128 / 255 })
    expect(parseCssColor('rgb(255, 0, 16)')).toEqual({ hex: '#FF0010', a: 1 })
    expect(parseCssColor('rgba(1,2,3,0.25)')).toEqual({ hex: '#010203', a: 0.25 })
    expect(parseCssColor('url(#x)')).toBeUndefined()
    expect(parseCssColor('red')).toBeUndefined()
  })

  it('lists the gradients whose property still holds the fallback, container ones included', () => {
    const theme = resolveTheme()
    const json: any = { visual: { visualType: 'lineChart', objects: { dataPoint: [{ properties: { fill: solid('#808081') }, selector: { metadata: 'm' } }] }, visualContainerObjects: { title: [{ properties: { fontColor: solid('#808082') } }] } } }
    writeFill(json, { object: 'dataPoint', prop: 'fill', selector: { metadata: 'm' } }, { gradient: G, fallback: '#808081' })
    writeFill(json, { object: 'title', prop: 'fontColor', container: true }, { gradient: G, fallback: '#808082' })
    writeFill(json, { object: 'labels', prop: 'color' }, { gradient: G, fallback: '#808083' })
    expect([...activeGradients(json, theme).keys()].sort()).toEqual(['#808081', '#808082'])
  })
})

describe('visual-level conditional formatting', () => {
  const { model, data } = buildSampleModel()
  const engine = createEngine(model, data)
  engine.processCalculated()
  const ctx = createMockHost({ engine })
  const rule = (input: any) => ({ solid: { color: { expr: { Conditional: { Cases: [{ Condition: { Comparison: { ComparisonKind: 1, Left: input, Right: { Literal: { Value: '0D' } } } }, Value: lit("'#00AA00'") }], DefaultValue: lit("'#AA0000'") } } } } })

  it('evaluates fx colors that have one value for the visual, and leaves per-point ones to the visual', () => {
    const json: any = {
      visual: {
        visualType: 'slicer',
        objects: {
          items: [{ properties: { fontColor: rule(measure('Sales', 'Total Sales')), background: solid('#123456') } }],
          dataPoint: [{ properties: { fill: rule(measure('Sales', 'Total Sales')) } }],
          labels: [{ properties: { color: rule(measure('Sales', 'Total Sales')) } }]
        }
      }
    }
    expect(hasVisualBoundColors(json)).toBe(true)
    const v = { name: 'v', json }
    const out = resolveBoundColors(v, ctx)
    expect(out).not.toBe(v)
    expect(out.json.visual.objects.items[0].properties.fontColor).toEqual(solid('#00AA00'))
    expect(out.json.visual.objects.items[0].properties.background).toEqual(solid('#123456'))
    expect(out.json.visual.objects.dataPoint).toBe(json.visual.objects.dataPoint)
    expect(out.json.visual.objects.labels[0].properties.color).toBe(json.visual.objects.labels[0].properties.color)
    // the document itself is untouched
    expect(json.visual.objects.items[0].properties.fontColor.solid.color.expr.Conditional).toBeDefined()
  })

  it('returns the same visual when nothing is bound, and leaves the new card to itself', () => {
    const plain = { name: 'v', json: { visual: { visualType: 'slicer', objects: { items: [{ properties: { fontColor: solid('#123456') } }] } } } }
    expect(resolveBoundColors(plain, ctx)).toBe(plain)
    expect(hasVisualBoundColors({ visual: { visualType: 'cardVisual', objects: { value: [{ properties: { fontColor: rule(measure('Sales', 'Total Sales')) } }] } } })).toBe(false)
    expect(resolveBoundColors(plain, null)).toBe(plain)
  })
})

describe('format painter and gradients', () => {
  it('copies gradient fills with the formatting they belong to', () => {
    const src: any = { visual: { visualType: 'shape', objects: { fill: [{ properties: { fillColor: solid('#808081') } }] }, visualContainerObjects: { background: [{ properties: { color: solid('#808082') } }] } } }
    writeFill(src, { object: 'fill', prop: 'fillColor' }, { gradient: G, fallback: '#808081' })
    writeFill(src, { object: 'background', prop: 'color', container: true }, { gradient: G, fallback: '#808082' })
    const same: any = { visual: { visualType: 'shape' } }
    applyFormat(same, copyFormat(src)!)
    expect(readFills(same).map((f) => f.object).sort()).toEqual(['background', 'fill'])
    // another type gets the container formatting only
    const other: any = { visual: { visualType: 'textbox' }, annotations: [{ name: 'Keep', value: '1' }] }
    applyFormat(other, copyFormat(src)!)
    expect(readFills(other).map((f) => f.object)).toEqual(['background'])
    expect(other.annotations[0]).toEqual({ name: 'Keep', value: '1' })
  })
})
