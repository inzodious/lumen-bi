/** Performance analyzer: record, refresh visuals, Copy query → PBI's "// DAX Query" + EVALUATE text. */
import { describe, expect, it } from 'vitest'
import { useLumen, visualByTitle } from './harness'

describe('performance analyzer', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('records visual timings and copies the DAX query of a visual', async () => {
    const { page, app } = lumen()
    const switcher = page.getByRole('toolbar', { name: 'Panes' })
    await switcher.getByRole('button', { name: 'Performance analyzer' }).click()
    const pane = page.locator('section.wbi-pane[data-pane="performance"]')
    await pane.getByRole('button', { name: 'Start recording' }).click()
    await pane.getByRole('button', { name: 'Refresh visuals' }).click()
    const title = 'Sales by category'
    await visualByTitle(page, title)
    const row = pane.locator('.wbi-sel__row').filter({ has: page.locator('.wbi-sel__name', { hasText: new RegExp(`^${title}$`) }) }).first()
    await row.waitFor()
    expect(Number((await row.locator('.wbi-perf__ms').innerText()).replace(/,/g, ''))).toBeGreaterThanOrEqual(0)
    await row.click()
    await app.evaluate(({ clipboard }) => clipboard.writeText(''))
    await pane.locator('.wbi-perf__copy').first().click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(/^\/\/ DAX Query\r?\n/)
    const text = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(text).toMatch(/\bEVALUATE\b/)
    // the header appears once per query (not duplicated)
    expect(text.split('\n\n')[0].match(/\/\/ DAX Query/g)?.length).toBe(1)
  })
})
