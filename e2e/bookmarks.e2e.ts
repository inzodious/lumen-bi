/** Bookmarks (capture → change a slicer → apply restores) and drill-through (set up in the UI → context menu → Back). */
import { describe, expect, it } from 'vitest'
import { useLumen, goToPage, settle, visualByTitle, untilVisualText, dataPaneRow, deselectAll, lumenEval, until, waitIdle, visualText } from './harness'

describe('bookmarks and drill-through', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('a bookmark restores the slicer state it captured', async () => {
    const { page } = lumen()
    await goToPage(page, 'Products')
    const slicer = page.locator('.wbi-page [data-type="slicer"]').filter({ hasText: /^Category/ })
    const table = await visualByTitle(page, 'Product details')
    const option = (name: string) => slicer.getByRole('option', { name, exact: true })
    await option('Bikes').click()
    const bikes = await untilVisualText(page, table, (t) => !/Helmet/i.test(t))
    await settle(page)
    // Bookmarks pane → Add
    const switcher = page.getByRole('toolbar', { name: 'Panes' })
    if ((await switcher.getByRole('button', { name: 'Bookmarks' }).getAttribute('aria-pressed')) !== 'true') await switcher.getByRole('button', { name: 'Bookmarks' }).click()
    const pane = page.locator('.wbi-pane').filter({ has: page.locator('.wbi-sel__toolbar') }).filter({ hasText: 'Bookmarks' })
    await pane.getByRole('button', { name: 'Add' }).click()
    const row = pane.locator('.wbi-bm__row').first()
    await row.waitFor()
    // a new bookmark starts in rename mode: keep the default name
    if (await row.locator('input').count()) await row.locator('input').press('Enter')
    const bmName = await row.locator('.wbi-sel__name').innerText()
    expect(bmName).toMatch(/^Bookmark/)
    // change the slicer
    await option('Clothing').click()
    await untilVisualText(page, table, (t) => t !== bikes)
    await settle(page)
    expect(await option('Bikes').getAttribute('aria-selected')).toBe('false')
    // apply the bookmark → Bikes selected again and the table matches
    await row.click()
    await expect.poll(() => option('Bikes').getAttribute('aria-selected')).toBe('true')
    await untilVisualText(page, table, (t) => t === bikes)
    // clean up for the next journey
    await slicer.hover()
    await slicer.locator('button[title="Clear selections"]').click()
    await settle(page)
  })

  it('drill-through: a page with a drill-through field, reached from a bar\'s context menu, then Back', async () => {
    const { page } = lumen()
    // target page: new page, drill-through field Region[Country] dragged into the page's drill-through well
    await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
    await page.locator('.wbi-tab-add').click()
    await waitIdle(page)
    const target = await lumenEval(page, (l) => l.useApp.getState().activePage!)
    await page.getByRole('tab', { name: 'Build visual' }).click()
    const country = await dataPaneRow(page, ['Region', 'Country'])
    await country.dragTo(page.locator('.wbi-viz__drill .wbi-well__drop'))
    await expect.poll(() => page.locator('.wbi-viz__drill .wbi-well__pill').count()).toBe(1)
    // PBI adds a Back button to the page
    const back = page.locator('.wbi-page [data-type="actionButton"]')
    await expect.poll(() => back.count()).toBe(1)
    // a card with Total Sales to observe the drill-through filter
    await deselectAll(page)
    await page.getByRole('listbox', { name: 'Visual types' }).getByRole('option', { name: /^Card/ }).first().click()
    const card = await until(page, () => window.__lumen!.useApp.getState().selectedVisuals[0])
    await (await dataPaneRow(page, ['_Measures', 'Sales', 'Total Sales'])).locator('.wbi-dtree__check input, .wbi-dtree__check [role="checkbox"]').first().click()
    const total = await untilVisualText(page, card, (t) => /\$/.test(t))
    // the new card lands on top of the Back button: drag it away (exercises a canvas move)
    const box = (await page.locator(`.wbi-page [data-visual="${card}"]`).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + i * 20, box.y + box.height / 2 + i * 15)
    await page.mouse.up()
    await expect.poll(async () => (await page.locator(`.wbi-page [data-visual="${card}"]`).boundingBox())!.x).toBeGreaterThan(box.x + 100)
    // source: Overview ▸ "Sales by country" bar chart, right-click the longest bar (United States)
    await goToPage(page, 'Overview')
    const chart = await visualByTitle(page, 'Sales by country')
    const idx = await page.locator(`.wbi-page [data-visual="${chart}"] svg rect`).evaluateAll((rs) => {
      let best = -1
      let w = 0
      rs.forEach((r, i) => {
        const bw = Number(r.getAttribute('width'))
        if (bw > w && r.getAttribute('fill') && r.getAttribute('fill') !== 'none' && r.getAttribute('fill') !== 'transparent') {
          w = bw
          best = i
        }
      })
      return best
    })
    const { clickShape } = await import('./harness')
    await clickShape(page, chart, 'svg rect', idx, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Drill through' }).hover()
    const targetName = await lumenEval(page, (l, n) => String(l.useApp.getState().project!.report!.pages.find((p) => p.name === n)!.json.displayName), target)
    await page.getByRole('menuitem', { name: targetName, exact: true }).click()
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().activePage)).toBe(target)
    await waitIdle(page)
    const drilled = await untilVisualText(page, card, (t) => /\$/.test(t) && t !== total)
    expect(drilled).not.toBe(total)
    // Back (Ctrl+click while editing, like PBI Desktop)
    await back.click({ modifiers: ['Control'] })
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().project!.report!.pages.find((p) => p.name === l.useApp.getState().activePage)!.json.displayName)).toBe('Overview')
    void visualText
  })
})
