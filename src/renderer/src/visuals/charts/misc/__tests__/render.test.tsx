/** Server-render smoke tests: the three AI visuals render their PBI chrome from real engine data. */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createEngine } from '@core/engine/engine'
import type { VisualHostContext } from '../../../contract'
import { createMockHost } from '../../../common/mockHost'
import { buildSampleModel } from '../../../gallery/sampleData'
import { getVisual } from '../../../registry'
import { miscGalleryEntries } from '../galleryEntries'
import '../../../index'

const { model, data } = buildSampleModel()
const sales = createEngine(model, data)
sales.processCalculated()

function render(id: string): { html: string; ctx: VisualHostContext; json: any } {
  const e = miscGalleryEntries.find((x) => x.id === id)!
  const ctx = createMockHost({ engine: e.engine ?? sales, report: e.report, mode: e.mode })
  const def = getVisual(e.json.visual.visualType)!
  const Comp = def.component
  const html = renderToStaticMarkup(<Comp visual={{ name: e.id, json: e.json }} pageName="gallery" width={e.width ?? 400} height={e.height ?? 300} ctx={ctx} />)
  return { html, ctx, json: e.json }
}

describe('AI visuals render', () => {
  it('decomposition tree: headers, AI bulb, path and "+" buttons', () => {
    const { html, ctx, json } = render('decompTree')
    expect(html).not.toContain("Can't display the visual")
    for (const s of ['Region', 'Category', 'Total Sales', 'Europe', 'Bikes', 'Remove level', 'Expand']) expect(html).toContain(s)
    expect(html).toContain('stroke-dasharray="2 2"') // AI recommendation connector
    const t = getVisual('decompositionTreeVisual')!.getData!({ name: 'x', json }, ctx)!
    expect(t.columns[t.columns.length - 1]).toBe('Total Sales')
    expect(t.rows.length).toBeGreaterThan(0)
  })
  it('decomposition tree: locked level and scroll chevrons', () => {
    const { html } = render('decompTreeLow')
    expect(html).toContain('Unlock level')
    expect(html).toContain('Scroll down')
  })
  it('key influencers: question, influencer list and detail chart', () => {
    const { html, ctx, json } = render('keyInfluencers')
    expect(html).toContain('What influences Churned to')
    expect(html).toContain('Contract is Monthly')
    expect(html).toContain('Average (excluding selected)')
    expect(html).toContain('Statistical approximation')
    expect(getVisual('keyDriversVisual')!.getData!({ name: 'x', json }, ctx)!.rows[0][1]).toBe('Monthly')
    expect(render('keyInfluencersContinuous').html).toContain('What influences Monthly Charges to')
    expect(render('keyInfluencersSegments').html).toContain('Segment 1')
  })
  it('narrative: page summary from ReportInfo.pageVisuals and own fields', () => {
    const { html, ctx, json } = render('narrative')
    expect(html).toContain('trended')
    expect(html).toContain('Template-generated')
    expect(getVisual('aiNarratives')!.getData!({ name: 'narrative', json }, ctx)!.rows.length).toBeGreaterThan(2)
    expect(render('narrativeFields').html).toContain('had the highest')
  })
})
