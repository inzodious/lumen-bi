/** Slicers on the built-in sample: list slicer + dropdown slicer selections filter the page; clearing restores it. */
import { describe, expect, it } from 'vitest'
import { useLumen, goToPage, settle, pageTexts, visualByTitle, untilVisualText, visualText, waitIdle, deselectAll, until, dataPaneRow, lumenEval } from './harness'

describe('slicers', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('list slicer: selecting an item filters the visuals; the eraser clears it', async () => {
    const { page } = lumen()
    await goToPage(page, 'Products')
    const slicer = page.locator('.wbi-page [data-type="slicer"]').filter({ hasText: /^Category/ })
    const table = await visualByTitle(page, 'Product details')
    const before = await pageTexts(page)
    await slicer.getByRole('option', { name: 'Bikes', exact: true }).click()
    await expect(slicer.getByRole('option', { name: 'Bikes', exact: true }).getAttribute('aria-selected')).resolves.toBe('true')
    await untilVisualText(page, table, (t) => t !== before[table])
    await settle(page)
    const after = await pageTexts(page)
    const changed = Object.keys(before).filter((k) => before[k] !== after[k])
    expect(changed.length).toBeGreaterThanOrEqual(4)
    // a helmet is an accessory: no longer listed once only bikes are selected
    expect(before[table]).toMatch(/Helmet/i)
    expect(after[table]).not.toMatch(/Helmet/i)
    // reset with the header eraser
    await slicer.hover()
    await slicer.locator('button[title="Clear selections"]').click()
    await untilVisualText(page, table, (t) => t === before[table])
    await settle(page)
    expect(await pageTexts(page)).toEqual(before)
  })

  it('dropdown slicer: picking a value filters the visuals; clearing restores them', async () => {
    const { page } = lumen()
    const slicer = page.locator('.wbi-page [data-type="slicer"]').filter({ hasText: /^Year/ })
    const matrix = await visualByTitle(page, 'Sales and margin by category and year')
    const before = await pageTexts(page)
    expect(before[matrix]).toMatch(/2023[\s\S]*2024[\s\S]*2025/)
    await slicer.getByRole('combobox').click()
    const popup = page.locator('.wbi-slicer-popup')
    await popup.getByRole('option', { name: '2024', exact: true }).click()
    await untilVisualText(page, matrix, (t) => !/2023/.test(t) && /2024/.test(t))
    await page.keyboard.press('Escape')
    await settle(page)
    expect(await visualText(page, (await slicer.getAttribute('data-visual'))!)).toMatch(/2024/)
    // clear
    await slicer.hover()
    await slicer.locator('[aria-label="Clear selections"], button[title="Clear selections"]').first().click()
    await untilVisualText(page, matrix, (t) => t === before[matrix])
    await settle(page)
    expect(await pageTexts(page)).toEqual(before)
  })

  it('date slicers: a new slicer on a date column is a Between range; two on the same column keep their own bounds', async () => {
    const { page } = lumen()
    await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
    await page.locator('.wbi-tab-add').click()
    await waitIdle(page)
    await page.getByRole('tab', { name: 'Build visual' }).click()
    const gallery = page.getByRole('listbox', { name: 'Visual types' })
    const addVisual = async (type: RegExp, field: string[]) => {
      await deselectAll(page)
      await gallery.getByRole('option', { name: type }).first().click()
      const name = await until(page, () => window.__lumen!.useApp.getState().selectedVisuals[0])
      await (await dataPaneRow(page, field)).locator('.wbi-dtree__check input, .wbi-dtree__check [role="checkbox"]').first().click()
      return name
    }
    const mode = (n: string) =>
      lumenEval(
        page,
        (l, name) => {
          const s = l.useApp.getState()
          const v = s.project!.report!.pages.find((p) => p.name === s.activePage)!.visuals.find((x) => x.name === name)!
          return v.json.visual.objects?.data?.[0]?.properties?.mode?.expr?.Literal?.Value ?? null
        },
        n
      )
    const a = await addVisual(/^Slicer$/, ['Date', 'Date'])
    expect(await mode(a)).toBe("'Between'")
    const b = await addVisual(/^Slicer$/, ['Date', 'Date'])
    expect(await mode(b)).toBe("'Between'")
    const card = await addVisual(/^Card/, ['_Measures', 'Sales', 'Total Sales'])
    const total = await untilVisualText(page, card, (t) => /\$/.test(t))
    const inputs = (n: string) => page.locator(`.wbi-page [data-visual="${n}"] .wbi-slicer-input input:not([type="date"])`)
    await expect.poll(() => inputs(a).count()).toBe(2)
    await expect.poll(() => inputs(b).count()).toBe(2)
    const boundsB = [await inputs(b).nth(0).inputValue(), await inputs(b).nth(1).inputValue()]
    expect(boundsB.every((t) => /\d/.test(t))).toBe(true)
    // narrow slicer A to the last year of data: start date = 1/1/2025
    await inputs(a).nth(0).fill('1/1/2025')
    await inputs(a).nth(0).press('Enter')
    const filtered = await untilVisualText(page, card, (t) => /\$/.test(t) && t !== total)
    expect(filtered).not.toBe(total)
    await settle(page)
    // slicer B (same column) keeps its own available range
    expect([await inputs(b).nth(0).inputValue(), await inputs(b).nth(1).inputValue()]).toEqual(boundsB)
    void visualText
  })
})
