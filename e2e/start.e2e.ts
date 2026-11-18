/** Start screen → Try a sample → the report renders every visual on every page. */
import { describe, expect, it } from 'vitest'
import { useLumen, visualStatuses, waitIdle, expectAllRendered, lumenEval, pageTabs, goToPage } from './harness'

describe('start screen', () => {
  const lumen = useLumen({ route: { start: '1' } })

  it('shows the start screen and opens the sample report', async () => {
    const { page } = lumen()
    const start = page.getByRole('dialog', { name: /Welcome to Lumen/ })
    await start.waitFor({ state: 'visible' })
    await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
    await start.getByRole('button', { name: /Try a sample/ }).click()
    await waitIdle(page)
    await start.waitFor({ state: 'detached' })
    const statuses = await visualStatuses(page)
    expect(statuses.length).toBeGreaterThan(5)
    expectAllRendered(statuses, ['ok'])
  })

  it('renders every page of the sample without errors', async () => {
    const { page } = lumen()
    const tabs = await pageTabs(page)
    expect(tabs.length).toBeGreaterThan(1)
    for (let i = 0; i < tabs.length; i++) {
      await goToPage(page, i)
      const statuses = await visualStatuses(page)
      expectAllRendered(statuses, ['ok'])
    }
    expect(await lumenEval(page, (l) => l.errors.filter((e) => !/Warning:/.test(e)).length)).toBe(0)
  })
})
