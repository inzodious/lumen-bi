/**
 * Lumen gradient fills (core/report/gradientFill.ts) reach the SVG of the visuals that draw them: the gradient's
 * definition is in the markup and the shape is filled with it, while the property keeps its solid fallback.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createEngine } from '@core/engine/engine'
import { cloneDeep } from '@core/clone'
import { gradientFallback, writeFill, type GradientFill } from '@core/report/gradientFill'
import { createMockHost, createMockState } from '../common/mockHost'
import { buildSampleModel } from '../gallery/sampleData'
import { galleryEntries, type GalleryEntry } from '../gallery/registry'
import { getVisual } from '../registry'
import '../index'

import.meta.glob('../*/gallery.ts', { eager: true })

const { model, data } = buildSampleModel()
const engine = createEngine(model, data)
engine.processCalculated()

const G: GradientFill = { kind: 'linear', angle: 180, stops: [{ color: '#7B5CFF', offset: 0 }, { color: '#3BF0FF', offset: 1 }] }
const FALLBACK = gradientFallback(G)
const solid = (hex: string) => ({ solid: { color: { expr: { Literal: { Value: `'${hex}'` } } } } })

function render(e: GalleryEntry, json: any): string {
  const def = getVisual(json.visual.visualType)!
  const state = createMockState({ selection: [], drill: { level: 0, path: [] } })
  const ctx = createMockHost({ engine: e.engine ?? engine, report: e.report, mode: e.mode, filters: e.filters, state })
  const Comp = def.component
  return renderToStaticMarkup(<Comp visual={{ name: e.id, json }} pageName="gallery" width={400} height={300} ctx={ctx} />)
}

/** The gradient on the default entry (shapes) or on the first series (charts: a metadata selector, like the Format pane's series picker). */
function withFill(e: GalleryEntry, object: string, prop: string, series = false): any {
  const json = cloneDeep(e.json)
  const objs = (json.visual.objects ??= {})
  const qs = json.visual.query?.queryState ?? {}
  const selector = series ? { metadata: (qs.Y ?? qs.Values).projections[0].queryRef } : undefined
  const rest = (objs[object] ?? []).filter((x: any) => (selector ? x.selector?.metadata !== selector.metadata : !!x.selector))
  const own = (objs[object] ?? []).find((x: any) => (selector ? x.selector?.metadata === selector.metadata : !x.selector))
  objs[object] = [{ properties: { ...(own?.properties ?? {}), [prop]: solid(FALLBACK) }, ...(selector ? { selector } : {}) }, ...rest]
  writeFill(json, { object, prop, selector }, { gradient: G, fallback: FALLBACK })
  return json
}

const first = (type: string) => galleryEntries().find((e) => e.json?.visual?.visualType === type)

describe('gradient fills render', () => {
  for (const [type, object, prop, series] of [
    ['shape', 'fill', 'fillColor', false],
    ['clusteredColumnChart', 'dataPoint', 'fill', true],
    ['clusteredBarChart', 'dataPoint', 'fill', true],
    ['funnel', 'dataPoint', 'fill', true]
  ] as const) {
    it(`${type} ${object}.${prop}`, () => {
      const e = first(type)
      expect(e, type).toBeDefined()
      const html = render(e!, withFill(e!, object, prop, series))
      expect(html).toContain('<linearGradient id="lumen-gf-')
      expect(html).toMatch(/fill="url\(#lumen-gf-[a-z0-9]+\)"/)
      expect(html).toContain('stop-color="#7B5CFF"')
    })
  }

  it('a color changed elsewhere drops the stale gradient', () => {
    const e = first('shape')!
    const json = withFill(e, 'fill', 'fillColor')
    json.visual.objects.fill[0].properties.fillColor = solid('#FF0000')
    expect(render(e, json)).not.toContain('lumen-gf-')
  })
})
