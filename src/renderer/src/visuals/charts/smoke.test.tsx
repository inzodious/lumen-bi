/**
 * Smoke test: server-render EVERY gallery fixture (charts, maps, AI visuals, tables, matrices, cards, slicers,
 * elements, custom visuals) with the real engine over the gallery sample model (or the entry's own engine), so a
 * runtime error in a render path fails CI instead of showing "Can't display this visual".
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createEngine } from '@core/engine/engine'
import { createMockHost, createMockState } from '../common/mockHost'
import { buildSampleModel } from '../gallery/sampleData'
import { galleryEntries, type GalleryEntry } from '../gallery/registry'
import { getVisual } from '../registry'
import '../index'

// every family's fixtures, exactly like Gallery.tsx
import.meta.glob('../*/gallery.ts', { eager: true })

const { model, data } = buildSampleModel()
const engine = createEngine(model, data)
engine.processCalculated()

const CHART_CATEGORIES = new Set(['chart', 'map'])
const categoryOf = (e: GalleryEntry) => getVisual(e.json?.visual?.visualType ?? '')?.category ?? 'unknown'

function render(e: GalleryEntry): { html: string; errors: unknown[] } {
  const def = getVisual(e.json.visual.visualType)!
  const state = createMockState({ selection: e.selection ?? [], drill: { level: 0, path: [], ...e.drill } })
  const ctx = { ...createMockHost({ engine: e.engine ?? engine, report: e.report, mode: e.mode, filters: e.filters, state }), highlightFilters: e.highlightFilters }
  const Comp = def.component
  const errors: unknown[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => errors.push(a)
  try {
    const html = renderToStaticMarkup(<Comp visual={{ name: e.id, json: e.json }} pageName="gallery" width={e.width ?? 400} height={e.height ?? 300} ctx={ctx} />)
    return { html, errors }
  } finally {
    console.error = orig
  }
}

describe('every gallery fixture renders', () => {
  const all = galleryEntries()
  it('has fixtures for every family', () => {
    expect(all.filter((e) => CHART_CATEGORIES.has(categoryOf(e))).length).toBeGreaterThan(40)
    for (const cat of ['table', 'card', 'slicer', 'element', 'custom']) expect(all.some((e) => categoryOf(e) === cat), cat).toBe(true)
  })
  it('every fixture has a registered visual type', () => {
    expect(all.filter((e) => !getVisual(e.json?.visual?.visualType ?? '')).map((e) => e.id)).toEqual([])
  })
  for (const e of all) {
    if (!getVisual(e.json?.visual?.visualType ?? '')) continue
    it(`${categoryOf(e)} · ${e.id} (${e.json.visual.visualType})`, () => {
      const { html } = render(e)
      expect(html).not.toMatch(/Can.t display/)
      expect(html).not.toMatch(/Something.s wrong with one or more fields/)
      expect(html).not.toMatch(/Couldn.t load the data/)
      expect(html.length).toBeGreaterThan(50)
    })
  }
})
