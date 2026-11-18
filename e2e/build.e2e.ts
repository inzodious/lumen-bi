/** Building a visual: new page, insert a clustered column chart, add fields from the Data pane (checkbox + drag). */
import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { useLumen, settle, lumenEval, dataPaneRow, waitIdle } from './harness'

/** New blank page with one visual of `label` from the Visualizations gallery (selected). Returns the visual's name. */
async function newPageWithVisual(page: Page, label: string, type: string): Promise<string> {
  await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
  await page.locator('.wbi-tab-add').click()
  await waitIdle(page)
  await page.getByRole('tab', { name: 'Build visual' }).click()
  await page.getByRole('listbox', { name: 'Visual types' }).getByRole('option', { name: label, exact: true }).click()
  const vc = page.locator(`.wbi-page .wbi-vc[data-type="${type}"]`)
  await expect.poll(() => vc.count()).toBe(1)
  return (await vc.getAttribute('data-visual'))!
}

/** Drag a Data pane field onto a field well of the selected visual (by the well's title). */
async function dragToWell(page: Page, field: string[], well: string): Promise<void> {
  const row = await dataPaneRow(page, field)
  const target = page.locator('.wbi-well').filter({ has: page.locator('.wbi-well__title', { hasText: new RegExp(`^${well}$`) }) }).first()
  await row.dragTo(target.locator('.wbi-well__drop'))
  await settle(page)
}

/** queryRefs per role of a visual on the active page. */
async function wellsOf(page: Page, name: string): Promise<Record<string, string[]>> {
  return lumenEval(page, (l, n) => {
    const s = l.useApp.getState()
    const v = s.project!.report!.pages.find((p) => p.name === s.activePage)!.visuals.find((x) => x.name === n)!
    const qs = v.json.visual.query?.queryState ?? {}
    return Object.fromEntries(Object.entries(qs).map(([k, r]: [string, any]) => [k, r.projections.map((p: any) => p.queryRef)]))
  }, name)
}

const newErrors = async (page: Page, from: number) => lumenEval(page, (l, n) => l.errors.slice(n).filter((e) => !/Warning:/.test(e)), from)

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

  it('column chart: a Legend added after the axis and the value lands in its well and splits the bars into series', async () => {
    const { page } = lumen()
    const errors = await lumenEval(page, (l) => l.errors.length)
    const name = await newPageWithVisual(page, 'Clustered column chart', 'clusteredColumnChart')
    await dragToWell(page, ['Product', 'Category'], 'X-axis')
    await dragToWell(page, ['_Measures', 'Sales', 'Total Sales'], 'Y-axis')
    await dragToWell(page, ['Customer', 'Segment'], 'Legend')
    expect(await wellsOf(page, name)).toEqual({ Category: ['Product.Category'], Y: ['_Measures.Total Sales'], Series: ['Customer.Segment'] })
    // one bar colour per segment, and a legend
    const fills = await page.locator(`.wbi-page [data-visual="${name}"] svg rect`).evaluateAll((rs) => [...new Set(rs.filter((r) => Number(r.getAttribute('height')) > 0 && /^#/.test(r.getAttribute('fill') ?? '')).map((r) => r.getAttribute('fill')!.toUpperCase()))])
    expect(fills.length).toBeGreaterThanOrEqual(2)
    expect(await newErrors(page, errors)).toEqual([])
  })

  it('line chart: a second value added after the X-axis lands in the Y-axis well and draws a second line', async () => {
    const { page } = lumen()
    const errors = await lumenEval(page, (l) => l.errors.length)
    const name = await newPageWithVisual(page, 'Line chart', 'lineChart')
    await dragToWell(page, ['Product', 'Category'], 'X-axis')
    await dragToWell(page, ['_Measures', 'Sales', 'Total Sales'], 'Y-axis')
    const lines = () => page.locator(`.wbi-page [data-visual="${name}"] svg path`).evaluateAll((ps) => new Set(ps.filter((p) => (p.getAttribute('fill') ?? 'none') === 'none' && /^#/.test(p.getAttribute('stroke') ?? '') && (p.getAttribute('d') ?? '').includes('L')).map((p) => p.getAttribute('stroke')!.toUpperCase())).size)
    const one = await lines()
    expect(one).toBe(1)
    await dragToWell(page, ['_Measures', 'Sales', 'Total Cost'], 'Y-axis')
    expect(await wellsOf(page, name)).toEqual({ Category: ['Product.Category'], Y: ['_Measures.Total Sales', '_Measures.Total Cost'] })
    await expect.poll(lines).toBe(2)
    expect(await newErrors(page, errors)).toEqual([])
  })
})
