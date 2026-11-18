/**
 * Small multiples share one plot geometry: every panel's plot area has the same size even when
 * one row's category labels rotate (long product names) and only the outer panels draw axes.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createEngine } from '@core/engine/engine'
import { createMockHost } from '../../common/mockHost'
import { buildSampleModel } from '../../gallery/sampleData'
import { col, msr, props, visualJson } from '../../gallery/registry'
import { getVisual } from '../../registry'
import '../../index'

const { model, data } = buildSampleModel()
const engine = createEngine(model, data)
engine.processCalculated()

/** plot overlay rects (first transparent rect of each panel svg) */
function plotRects(html: string): Array<{ x: number; y: number; w: number; h: number }> {
  const out: Array<{ x: number; y: number; w: number; h: number }> = []
  for (const svg of html.split('<svg').slice(1)) {
    const m = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="transparent"/.exec(svg)
    if (m) out.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] })
  }
  return out
}

function render(visualType: string, objects: Record<string, any> = {}, width = 720, height = 460) {
  const json = visualJson('sm', visualType, { Category: [col('Sales', 'Product')], Y: [msr('Sales', 'Total Sales')], Rows: [col('Sales', 'Category')] }, { objects })
  const Comp = getVisual(visualType)!.component
  return renderToStaticMarkup(<Comp visual={{ name: 'sm', json }} pageName="p" width={width} height={height} ctx={createMockHost({ engine })} />)
}

describe('small multiples alignment', () => {
  it('column chart, 3 columns with rotated labels: all plots have the same size', () => {
    const html = render('clusteredColumnChart', { smallMultiplesLayout: [props({ layoutType: 'custom', rowCount: 2, columnCount: 3 })] })
    const rects = plotRects(html)
    expect(rects.length).toBe(4)
    for (const r of rects) {
      expect(r.w).toBeCloseTo(rects[0].w, 0)
      expect(r.h).toBeCloseTo(rects[0].h, 0)
    }
    // the first column carries the value axis: its plot starts further right than the others
    expect(rects[0].x).toBeGreaterThan(rects[1].x)
    // panels above an empty cell draw their category labels into it
    expect(html).toContain('overflow:visible')
  })
  it('bar chart (horizontal): same plot size in every panel', () => {
    const rects = plotRects(render('clusteredBarChart', { smallMultiplesLayout: [props({ layoutType: 'custom', rowCount: 2, columnCount: 2 })] }))
    expect(rects.length).toBe(4)
    for (const r of rects) {
      expect(r.w).toBeCloseTo(rects[0].w, 0)
      expect(r.h).toBeCloseTo(rects[0].h, 0)
    }
  })
  it('narrow 2×2 line chart: rows align although the bottom row rotates labels', () => {
    const rects = plotRects(render('lineChart', { smallMultiplesLayout: [props({ layoutType: 'custom', rowCount: 2, columnCount: 2 })] }, 420, 420))
    expect(rects.length).toBe(4)
    expect(rects[2].h).toBeCloseTo(rects[0].h, 0)
    expect(rects[3].w).toBeCloseTo(rects[0].w, 0)
  })
})
