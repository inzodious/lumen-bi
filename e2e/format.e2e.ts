/** Editing: select a visual, change its title text and color in the Format pane, Undo / Redo. */
import { describe, expect, it } from 'vitest'
import { useLumen, visualByTitle, settle, lumenEval } from './harness'

describe('format pane', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('changes a visual title and color; Undo restores, Redo re-applies', async () => {
    const { page } = lumen()
    const name = await visualByTitle(page, 'Sales by category')
    const vc = page.locator(`.wbi-page [data-visual="${name}"]`)
    // select by clicking the title (clicking a data point would also cross-filter)
    await vc.locator('.wbi-vc-titles').click()
    await expect(lumenEval(page, (l) => l.useApp.getState().selectedVisuals)).resolves.toEqual([name])
    await page.getByRole('tab', { name: 'Format visual' }).click()
    await page.locator('.wbi-fmt__pivot').getByRole('tab', { name: 'General' }).click()
    const fmt = page.locator('.wbi-fmt__cards')
    await fmt.locator('.wbi-card__header', { hasText: /^Title$/ }).first().click()
    // nested "Title" sub-card (Title ▸ Title / Subtitle / Divider…)
    const sub = fmt.locator('.wbi-card--l2').filter({ has: page.locator('.wbi-card__title', { hasText: /^Title$/ }) })
    if (!(await sub.locator('.wbi-card__body').count())) await sub.locator('.wbi-card__header').click()
    const text = sub.locator('[data-prop="text"] input')
    await text.fill('Category share')
    await text.press('Enter')
    await expect.poll(() => vc.getAttribute('aria-label')).toBe('Category share')
    await expect(vc.locator('.wbi-vc-titles').innerText()).resolves.toBe('Category share')
    // font color: pick a swatch in the color picker
    const colorBefore = await vc.locator('.wbi-vc-titles > div').first().evaluate((e) => getComputedStyle(e).color)
    await sub.locator('[data-prop="fontColor"] button.wbi-color-btn').click()
    await page.locator('.wbi-colorpop').getByTitle(/^Theme color 3,/).click()
    await expect.poll(() => vc.locator('.wbi-vc-titles > div').first().evaluate((e) => getComputedStyle(e).color)).not.toBe(colorBefore)
    // Undo twice (title bar): color, then text
    const undo = page.getByRole('button', { name: 'Undo', exact: true })
    await undo.click()
    await expect.poll(() => vc.locator('.wbi-vc-titles > div').first().evaluate((e) => getComputedStyle(e).color)).toBe(colorBefore)
    await undo.click()
    await expect.poll(() => vc.getAttribute('aria-label')).toBe('Sales by category')
    // the Format pane follows the document
    await expect(text.inputValue()).resolves.toBe('Sales by category')
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect.poll(() => vc.getAttribute('aria-label')).toBe('Category share')
    await settle(page)
  })
})
