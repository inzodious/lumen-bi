/** Formula bar: New measure → type a definition → commit → use it in a card; DAX IntelliSense (CALC + Tab). */
import { describe, expect, it } from 'vitest'
import { useLumen, settle, lumenEval, dataPaneRow, untilVisualText, deselectAll, until } from './harness'

describe('formula bar', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  const editor = () => lumen().page.locator('[data-testid="formula-bar"] .cm-content')

  it('creates a measure from the ribbon and shows its value in a new card', async () => {
    const { page } = lumen()
    // home table: the measure table (select it in the Data pane first, like a PBI user would)
    await (await dataPaneRow(page, ['_Measures'])).click()
    await page.locator('.wbi-ribbon').getByRole('button', { name: /^New measure$/ }).first().click()
    // the formula bar is focused with "Measure = " and the caret at the end
    await expect.poll(() => editor().innerText()).toMatch(/^Measure = ?$/)
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="formula-bar"]'))).toBe(true)
    await page.keyboard.press('Control+A')
    await page.keyboard.type('Test Measure = SUM(Sales[SalesAmount]) * 2')
    // close any completion popup, then commit with Enter
    if (await page.locator('.cm-tooltip-autocomplete').count()) await page.keyboard.press('Escape')
    await page.keyboard.press('Enter')
    await expect
      .poll(() => lumenEval(page, (l) => l.useApp.getState().project!.model.tables.flatMap((t) => t.measures).find((m) => m.name === 'Test Measure')?.expression ?? null))
      .toMatch(/SUM\s*\(\s*Sales\[SalesAmount\]\s*\)\s*\*\s*2/)
    // insert a card and tick the new measure
    await deselectAll(page)
    await page.getByRole('tab', { name: 'Build visual' }).click()
    await page.getByRole('listbox', { name: 'Visual types' }).getByRole('option', { name: /^Card/ }).first().click()
    const name = await until(page, () => window.__lumen!.useApp.getState().selectedVisuals[0])
    expect(await page.locator(`.wbi-page [data-visual="${name}"]`).getAttribute('data-type')).toMatch(/card/i)
    await (await dataPaneRow(page, ['_Measures', 'Test Measure'])).locator('.wbi-dtree__check input, .wbi-dtree__check [role="checkbox"]').first().click()
    // Total Sales is $6M on the overview card → the doubled measure shows $13M (12.97M) in the same display units
    const text = await untilVisualText(page, name, (t) => /\$?1[23](\.\d+)?M/.test(t))
    expect(text).toMatch(/Test Measure/)
    await settle(page)
  })

  it('IntelliSense completes CALC + Tab to CALCULATE(', async () => {
    const { page } = lumen()
    await (await dataPaneRow(page, ['_Measures'])).click()
    await page.locator('.wbi-ribbon').getByRole('button', { name: /^New measure$/ }).first().click()
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="formula-bar"]'))).toBe(true)
    await page.keyboard.press('Control+A')
    await page.keyboard.type('IS Test = CALC')
    await page.locator('.cm-tooltip-autocomplete').waitFor()
    await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected="true"]').innerText()).resolves.toMatch(/^CALCULATE/)
    await page.keyboard.press('Tab')
    await expect.poll(() => editor().innerText()).toMatch(/^IS Test = CALCULATE\(\)?$/)
    // finish and commit
    await page.keyboard.type('[Total Sales], Product[Category] = "Bikes"')
    if (await page.locator('.cm-tooltip-autocomplete').count()) await page.keyboard.press('Escape')
    await page.keyboard.press('Enter')
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().project!.model.tables.flatMap((t) => t.measures).some((m) => m.name === 'IS Test' && /CALCULATE/.test(m.expression)))).toBe(true)
  })
})
