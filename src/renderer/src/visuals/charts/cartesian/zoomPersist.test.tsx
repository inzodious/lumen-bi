import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveTheme } from '@core/report/theme'
import { createEngine } from '@core/engine/engine'
import { categoryZoomProps, readSavedZoom, savedCategoryWindow, savedValueWindow, valueZoomProps, writeZoom } from './zoomPersist'
import { createMockHost } from '../../common/mockHost'
import { buildSampleModel } from '../../gallery/sampleData'
import { col, msr, props, visualJson } from '../../gallery/registry'
import { getVisual } from '../../registry'
import '../../index'

const theme = resolveTheme()

describe('zoom window persistence', () => {
  it('categorical axis: indices ↔ fractions round-trip', () => {
    const w: [number, number] = [0.25, 0.5]
    const p = categoryZoomProps(w, 12)
    expect(p).toEqual({ categoryMin: 3, categoryMax: 5, categorySize: 12 })
    expect(savedCategoryWindow(p, 12)).toEqual([0.25, 0.5])
    // the category count changed since saving: indices rescale
    expect(savedCategoryWindow(p, 24)).toEqual([0.25, 0.5])
  })
  it('continuous axis: axis values ↔ fractions', () => {
    const dom: [number, number] = [Date.UTC(2023, 0, 1), Date.UTC(2024, 11, 1)]
    const p = categoryZoomProps([0.5, 1], 24, dom)
    expect(p.categoryMax).toBe(dom[1])
    const w = savedCategoryWindow(p, 24, dom)!
    expect(w[0]).toBeCloseTo(0.5)
    expect(w[1]).toBeCloseTo(1)
  })
  it('value axis: values ↔ fractions; full range = no window', () => {
    const p = valueZoomProps([0.1, 0.6], [0, 1000])
    expect(p).toEqual({ valueMin: 100, valueMax: 600, valueSize: 1000 })
    expect(savedValueWindow(p, [0, 1000])).toEqual([0.1, 0.6])
    expect(savedValueWindow({ valueMin: -5, valueMax: 2000 }, [0, 1000])).toBeUndefined()
  })
  it('writes and clears the zoom object (keeps the slider toggles)', () => {
    const vj = { visual: { objects: { zoom: [props({ show: true })] } } } as any
    writeZoom(vj, { categoryMin: 3, categoryMax: 5, categorySize: 12 }, 'category')
    expect(readSavedZoom(vj.visual.objects, theme)).toEqual({ categoryMin: 3, categoryMax: 5, categorySize: 12 })
    writeZoom(vj, {}, 'category')
    expect(readSavedZoom(vj.visual.objects, theme)).toEqual({})
    expect(vj.visual.objects.zoom[0].properties.show).toBeDefined()
  })
})

describe('a chart reopens at its saved zoom window', () => {
  const { model, data } = buildSampleModel()
  const engine = createEngine(model, data)
  engine.processCalculated()
  const render = (zoomProps: Record<string, any>) => {
    const json = visualJson('z', 'clusteredColumnChart', { Category: [col('Sales', 'Month')], Y: [msr('Sales', 'Total Sales')] }, {
      objects: { zoom: [props({ show: true, ...zoomProps })] },
      sort: [{ field: col('Sales', 'Month'), direction: 'Ascending' }]
    })
    const Comp = getVisual('clusteredColumnChart')!.component
    return renderToStaticMarkup(<Comp visual={{ name: 'z', json }} pageName="p" width={500} height={300} ctx={createMockHost({ engine })} />)
  }
  /** widths of the slider track (#E1DFDD) and window (#8A8886) */
  const slider = (html: string) => {
    const w = (fill: string) => Number(new RegExp(`<rect[^>]*width="([\\d.]+)"[^>]*fill="${fill}"`).exec(html)?.[1])
    return { track: w('#E1DFDD'), win: w('#8A8886') }
  }
  it('full window without saved values', () => {
    const s = slider(render({}))
    expect(s.win).toBeCloseTo(s.track, 0)
  })
  it('a saved window of 3 of 12 months', () => {
    const s = slider(render({ categoryMin: 3, categoryMax: 5, categorySize: 12 }))
    expect(s.win / s.track).toBeCloseTo(0.25, 2)
  })
})
