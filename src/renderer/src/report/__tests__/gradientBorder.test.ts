import { describe, expect, it } from 'vitest'
import { resolveTheme } from '@core/report/theme'
import { writeFill, type GradientFill } from '@core/report/gradientFill'
import { borderCss, gradientBorderLayer, resolveChrome, resolveGroupChrome } from '../chrome'
import { applyBoundContainerColors } from '../containerCF'

const G: GradientFill = { kind: 'linear', angle: 90, stops: [{ color: '#FF0000', offset: 0 }, { color: '#0000FF', offset: 1 }] }
const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
const solid = (hex: string) => ({ solid: { color: lit(`'${hex}'`) } })
const measure = { Measure: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: 'Total' } }

function bordered(color: unknown, extra: Record<string, unknown> = {}): any {
  return { visual: { visualType: 'card', visualContainerObjects: { border: [{ properties: { show: lit('true'), width: lit('4D'), radius: lit('10D'), color, ...extra } }] } } }
}

describe('gradient visual borders', () => {
  it('resolves the gradient of a border whose color still holds the fallback', () => {
    const json = bordered(solid('#800080'))
    writeFill(json, { object: 'border', prop: 'color', container: true }, { gradient: G, fallback: '#800080' })
    const b = resolveChrome(json, resolveTheme()).border!
    expect(b.color).toBe('#800080')
    expect(b.gradient).toBe('linear-gradient(90deg, #FF0000 0%, #0000FF 100%)')
    expect(borderCss(b)).toBe('4px solid transparent')
  })

  it('keeps a solid border when the color was changed after the gradient was set', () => {
    const json = bordered(solid('#112233'))
    writeFill(json, { object: 'border', prop: 'color', container: true }, { gradient: G, fallback: '#800080' })
    const b = resolveChrome(json, resolveTheme()).border!
    expect(b.gradient).toBeUndefined()
    expect(borderCss(b)).toBe('4px solid #112233')
    expect(gradientBorderLayer(b, 10)).toBeUndefined()
  })

  it('draws the gradient as a ring masked to the border width, keeping rounded corners', () => {
    const border = { color: '#800080', width: 4, radius: 10, gradient: 'linear-gradient(90deg, #FF0000 0%, #0000FF 100%)' }
    const layer = gradientBorderLayer(border, 10, 0, { transform: 'rotate(5deg)' })!
    expect(layer).toMatchObject({ position: 'absolute', inset: 0, padding: 4, borderRadius: 10, background: border.gradient, pointerEvents: 'none', transform: 'rotate(5deg)' })
    expect(layer.mask).toContain('content-box exclude')
    expect(layer.WebkitMaskComposite).toBe('xor')
    expect(gradientBorderLayer(border, 0, -4)).toMatchObject({ inset: -4, borderRadius: undefined })
    expect(gradientBorderLayer({ ...border, width: 0 }, 10)).toBeUndefined()
    expect(borderCss(undefined)).toBeUndefined()
  })

  it('a field-value border color replaces the gradient', () => {
    const json = bordered({ solid: { color: { expr: measure } } })
    const base = resolveChrome(json, resolveTheme())
    const withGradient = { ...base, border: { ...base.border!, gradient: 'linear-gradient(90deg, #FF0000 0%, #0000FF 100%)' } }
    const ctx: any = { theme: resolveTheme(), filters: [], engine: { evaluateScalar: () => ({ value: '#00AA00' }) } }
    const out = applyBoundContainerColors(withGradient, json, ctx).border!
    expect(out.color).toBe('#00AA00')
    expect(out.gradient).toBeUndefined()
  })

  it('group borders and backgrounds take their gradients too', () => {
    const json: any = {
      name: 'g',
      visualGroup: { displayName: 'Group 1', objects: { border: [{ properties: { show: lit('true'), color: solid('#800080') } }], background: [{ properties: { show: lit('true'), color: solid('#800081') } }] } }
    }
    writeFill(json, { object: 'border', prop: 'color' }, { gradient: G, fallback: '#800080' })
    writeFill(json, { object: 'background', prop: 'color', container: true }, { gradient: G, fallback: '#800081' })
    const gc = resolveGroupChrome(json, resolveTheme())
    expect(gc.border?.gradient).toBe('linear-gradient(90deg, #FF0000 0%, #0000FF 100%)')
    expect(gc.background).toBe('linear-gradient(90deg, #FF0000 0%, #0000FF 100%)')
  })
})
