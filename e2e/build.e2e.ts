/** Building a visual: new page, insert a clustered column chart, add fields from the Data pane (checkbox + drag). */
import { describe, expect, it } from 'vitest'
import { useLumen, settle, lumenEval, dataPaneRow, waitIdle } from './harness'

describe('build a visual', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('inserts a column chart and binds fields; bars render sorted by value (PBI default)', async () => {
    const { page } = lumen()
    // new blank page
    const tabsBefore = await page.locator('.wbi-tabs [role="tab"]').count()
    await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
    await page.locator('.wbi-tab-add').click()
    await expect.poll(() => page.locator('.wbi-tabs [role="tab"]').count()).toBe(tabsBefore + 1)
    await waitIdle(page)
    expect(await page.locator('.wbi-page .wbi-vc').count()).toBe(0)
    // insert from the Visualizations gallery
    await page.getByRole('tab', { name: 'Build visual' }).click()
    await page.getByRole('listbox', { name: 'Visual types' }).getByRole('option', { name: 'Clustered column chart', exact: true }).click()
    const vc = page.locator('.wbi-page .wbi-vc[data-type="clusteredColumnChart"]')
    await expect.poll(() => vc.count()).toBe(1)
    const name = (await vc.getAttribute('data-visual'))!
    await expect(lumenEval(page, (l) => l.useApp.getState().selectedVisuals)).resolves.toEqual([name])
    // axis: tick the column's checkbox in the Data pane (PBI puts a category on the X-axis)
    const category = await dataPaneRow(page, ['Product', 'Category'])
    await category.locator('.wbi-dtree__check input, .wbi-dtree__check [role="checkbox"]').first().click()
    // value: drag the measure onto the Y-axis well (same code path as a mouse drag-and-drop)
    const measure = await dataPaneRow(page, ['_Measures', 'Sales', 'Total Sales'])
    const yWell = page.locator('.wbi-well').filter({ has: page.locator('.wbi-well__title', { hasText: /^Y-axis$/ }) }).first()
    await measure.dragTo(yWell.locator('.wbi-well__drop'))
    await settle(page)
    const wells = await lumenEval(page, (l, n) => {
      const s = l.useApp.getState()
      const v = s.project!.report!.pages.find((p) => p.name === s.activePage)!.visuals.find((x) => x.name === n)!
      const qs = v.json.visual.query.queryState
      return Object.fromEntries(Object.entries(qs).map(([k, r]: [string, any]) => [k, r.projections.map((p: any) => p.queryRef)]))
    }, name)
    expect(wells).toEqual({ Category: ['Product.Category'], Y: ['_Measures.Total Sales'] })
    // bars render, one per category, sorted by Total Sales descending
    // bars: rects filled with the theme's first data color (#118DFF in the default theme)
    const bars = await page.locator(`.wbi-page [data-visual="${name}"] svg rect`).evaluateAll((rs) => rs.filter((r) => (r.getAttribute('fill') ?? '').toUpperCase() === '#118DFF' && Number(r.getAttribute('height')) > 0).length)
    const labels = (await page.locator(`.wbi-page [data-visual="${name}"] .wbi-vc-content`).innerText()).split('\n')
    const cats = ['Accessories', 'Bikes', 'Clothing', 'Components']
    const order = labels.filter((t) => cats.includes(t))
    expect(order.length).toBe(4)
    expect(order[0]).toBe('Bikes')
    expect(bars).toBe(4)
  })
})
