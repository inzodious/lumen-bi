import { describe, expect, it } from 'vitest'
import { resolveTheme } from '@core/report/theme'
import { resolveChrome } from '../chrome'
import { applyBoundContainerColors, hasBoundContainerColors } from '../containerCF'

const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
const measure = { Measure: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: 'Total' } }

function ctx(value: unknown): any {
  return { theme: resolveTheme(), filters: [], engine: { evaluateScalar: () => ({ value }) } }
}

describe('container conditional formatting', () => {
  it('field value: a measure returning a color drives the title font color', () => {
    const json = { visual: { visualType: 'card', visualContainerObjects: { title: [{ properties: { show: lit('true'), fontColor: { solid: { color: { expr: measure } } } } }] } } }
    expect(hasBoundContainerColors(json)).toBe(true)
    const base = resolveChrome(json, resolveTheme())
    expect(applyBoundContainerColors(base, json, ctx('#FF0000')).title.color).toBe('#FF0000')
  })

  it('rules: Conditional cases on a measure color the background', () => {
    const cond = {
      Conditional: {
        Cases: [
          { Condition: { Comparison: { ComparisonKind: 2, Left: measure, Right: { Literal: { Value: '100D' } } } }, Value: { Literal: { Value: "'#00AA00'" } } }
        ],
        DefaultValue: { Literal: { Value: "'#AA0000'" } }
      }
    }
    const json = { visual: { visualType: 'card', visualContainerObjects: { background: [{ properties: { show: lit('true'), color: { solid: { color: { expr: cond } } } } }] } } }
    const base = resolveChrome(json, resolveTheme())
    expect(applyBoundContainerColors(base, json, ctx(150)).background?.toUpperCase()).toContain('00AA00')
    expect(applyBoundContainerColors(base, json, ctx(50)).background?.toUpperCase()).toContain('AA0000')
  })

  it('leaves unbound chrome untouched (same object)', () => {
    const json = { visual: { visualType: 'card', visualContainerObjects: { title: [{ properties: { fontColor: { solid: { color: lit("'#123456'") } } } }] } } }
    const base = resolveChrome(json, resolveTheme())
    expect(applyBoundContainerColors(base, json, ctx(1))).toBe(base)
  })
})
