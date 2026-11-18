/** Mobile layout: place a visual on the phone canvas, format it for mobile only (Format pane), reset to desktop. */
import { describe, expect, it } from 'vitest'
import { useLumen, lumenEval, visualByTitle } from './harness'

describe('mobile layout', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('mobile-only title text: phone shows it, desktop keeps its own; reset restores', async () => {
    const { page } = lumen()
    const name = await visualByTitle(page, 'Sales by category')
    await page.getByRole('radiogroup', { name: 'Layout' }).getByRole('radio', { name: /Mobile layout/ }).click()
    const pane = page.getByRole('complementary', { name: 'Page visuals' })
    await pane.waitFor()
    await pane.locator('.wbi-mobile__item').filter({ has: page.locator('.wbi-mobile__name', { hasText: /^Sales by category$/ }) }).dblclick()
    const phone = page.locator(`[data-mobile-item="${name}"] .wbi-vc`)
    await phone.waitFor()
    // the Format pane follows the phone-canvas selection
    await page.getByRole('tab', { name: 'Format visual' }).click()
    await expect.poll(() => page.locator('.wbi-fmt__mobile').count()).toBe(1)
    await page.locator('.wbi-fmt__pivot').getByRole('tab', { name: 'General' }).click()
    const fmt = page.locator('.wbi-fmt__cards')
    await fmt.locator('.wbi-card__header', { hasText: /^Title$/ }).first().click()
    const sub = fmt.locator('.wbi-card--l2').filter({ has: page.locator('.wbi-card__title', { hasText: /^Title$/ }) })
    if (!(await sub.locator('.wbi-card__body').count())) await sub.locator('.wbi-card__header').click()
    const input = sub.locator('[data-prop="text"] input')
    await expect(input.inputValue()).resolves.toBe('Sales by category')
    await input.fill('Category (phone)')
    await input.press('Enter')
    const docs = () =>
      lumenEval(
        page,
        (l, n) => {
          const s = l.useApp.getState()
          const v = s.project!.report!.pages.find((p) => p.name === s.activePage)!.visuals.find((x) => x.name === n)!
          const t = (j: any) => j?.title?.[0]?.properties?.text?.expr?.Literal?.Value ?? null
          return { desktop: t(v.json.visual.visualContainerObjects), mobile: t(v.mobile?.visualContainerObjects) }
        },
        name
      )
    await expect.poll(docs).toEqual({ desktop: "'Sales by category'", mobile: "'Category (phone)'" })
    await expect.poll(() => phone.getAttribute('aria-label')).toBe('Category (phone)')
    // reset to the desktop formatting
    await page.locator('.wbi-fmt__mobile').getByRole('button', { name: 'Reset to desktop formatting' }).click()
    await expect.poll(() => phone.getAttribute('aria-label')).toBe('Sales by category')
    expect((await docs()).mobile).toBeNull()
    // back to the web layout: desktop title unchanged
    await page.getByRole('radiogroup', { name: 'Layout' }).getByRole('radio', { name: /Web layout/ }).click()
    await expect.poll(() => page.locator(`.wbi-page [data-visual="${name}"]`).getAttribute('aria-label')).toBe('Sales by category')
  })
})
