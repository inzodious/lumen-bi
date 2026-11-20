import { describe, expect, it } from 'vitest'
import { desktopCompatVisual } from '../desktopCompat'
import { pbirToFiles, readPbirFiles } from '../pbir'

const lit = (v: string) => ({ Literal: { Value: v } })
const measure = { Measure: { Expression: { SourceRef: { Entity: 'm' } }, Property: 'pct' } }

const gradient = (stop: (v: string) => any) => ({
  solid: {
    color: {
      expr: {
        FillRule: {
          Input: measure,
          FillRule: {
            linearGradient2: {
              min: { color: stop("'#FFFFFF'") },
              max: { color: stop("'#171C73'"), value: stop('1D') },
              nullColoringStrategy: { strategy: stop("'noColor'") }
            }
          }
        }
      }
    }
  }
})

const matrix = (backColor: any) => ({
  name: 'v1',
  visual: {
    visualType: 'pivotTable',
    objects: { values: [{ properties: { backColor }, selector: { data: [{ dataViewWildcard: { matchingOption: 1 } }], metadata: 'm.pct' } }] }
  }
})

const card = (position: string) => ({
  name: 'c1',
  visual: {
    visualType: 'cardVisual',
    objects: {
      accentBar: [
        { properties: { show: { expr: lit('true') }, position: { expr: lit(position) }, width: { expr: lit('4D') } }, selector: { id: 'default' } }
      ]
    }
  }
})

describe('desktopCompatVisual', () => {
  it('unwraps expr around gradient stops and the null strategy (Desktop cannot save the wrapped shape)', () => {
    const out = desktopCompatVisual(matrix(gradient((v) => ({ expr: lit(v) }))))
    expect(out).toEqual(matrix(gradient(lit)))
  })

  it('keeps gradients already in Desktop shape unchanged (same object)', () => {
    const v = matrix(gradient(lit))
    expect(desktopCompatVisual(v)).toBe(v)
  })

  it('unwraps linearGradient3 stops too', () => {
    const v: any = matrix(gradient((x) => ({ expr: lit(x) })))
    const g = v.visual.objects.values[0].properties.backColor.solid.color.expr.FillRule.FillRule
    g.linearGradient3 = { ...g.linearGradient2, mid: { color: { expr: lit("'#888888'") } } }
    delete g.linearGradient2
    const out = desktopCompatVisual(v)
    const g3 = out.visual.objects.values[0].properties.backColor.solid.color.expr.FillRule.FillRule.linearGradient3
    expect(g3.mid).toEqual({ color: lit("'#888888'") })
    expect(g3.min).toEqual({ color: lit("'#FFFFFF'") })
  })

  it('leaves the expr wrapper of the fill color itself alone', () => {
    const out = desktopCompatVisual(matrix(gradient((v) => ({ expr: lit(v) }))))
    expect(out.visual.objects.values[0].properties.backColor.solid.color.expr.FillRule).toBeDefined()
  })

  it("capitalizes the new card's accent bar position (lowercase blanks the card in Desktop)", () => {
    expect(desktopCompatVisual(card("'left'"))).toEqual(card("'Left'"))
    expect(desktopCompatVisual(card("'bottom'"))).toEqual(card("'Bottom'"))
    const ok = card("'Top'")
    expect(desktopCompatVisual(ok)).toBe(ok)
  })

  it('does not touch accentBar on other visual types', () => {
    const v: any = card("'left'")
    v.visual.visualType = 'advancedSlicerVisual'
    expect(desktopCompatVisual(v)).toBe(v)
  })

  it('is applied when a report is serialized, and the input document is not mutated', () => {
    const src = matrix(gradient((v) => ({ expr: lit(v) })))
    const files = pbirToFiles(
      readPbirFiles({
        'definition/report.json': new TextEncoder().encode('{}'),
        'definition/pages/pages.json': new TextEncoder().encode(JSON.stringify({ pageOrder: ['p1'] })),
        'definition/pages/p1/page.json': new TextEncoder().encode(JSON.stringify({ name: 'p1', displayName: 'P' })),
        'definition/pages/p1/visuals/v1/visual.json': new TextEncoder().encode(JSON.stringify(src)),
        'definition/pages/p1/visuals/c1/visual.json': new TextEncoder().encode(JSON.stringify(card("'left'")))
      }, 'pbir')
    )
    expect(JSON.parse(files['definition/pages/p1/visuals/v1/visual.json'] as string)).toEqual(matrix(gradient(lit)))
    expect(JSON.parse(files['definition/pages/p1/visuals/c1/visual.json'] as string)).toEqual(card("'Left'"))
    expect(src).toEqual(matrix(gradient((v) => ({ expr: lit(v) }))))
  })
})
