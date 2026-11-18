/** Power Query: Transform data → select a query → Remove a column → Close & Apply → the model is updated. */
import { describe, expect, it } from 'vitest'
import { useLumen, lumenEval, waitIdle, settle, expectAllRendered, visualStatuses } from './harness'

describe('power query', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('removes a column with a new applied step and loads it into the model', async () => {
    const { page } = lumen()
    const cols = () => lumenEval(page, (l) => l.useApp.getState().project!.model.tables.find((t) => t.name === 'Product')!.columns.map((c) => c.name))
    expect(await cols()).toContain('Standard Cost')
    await page.locator('.wbi-ribbon').getByRole('button', { name: 'Transform data', exact: true }).click()
    await page.locator('.wbi-pq-queries').waitFor()
    await page.locator('.wbi-pq-qlist [role="treeitem"]').filter({ has: page.locator('.wbi-pq-qname', { hasText: /^Product$/ }) }).click()
    const header = page.locator('.wbi-pq-th[title="Standard Cost"]')
    await header.waitFor()
    const stepsBefore = await page.locator('.wbi-pq-steps [role="option"]').count()
    await header.click({ button: 'right' })
    await page.getByRole('menu').getByRole('menuitem', { name: /^Remove$/ }).click()
    await expect.poll(() => page.locator('.wbi-pq-steps [role="option"]').count()).toBe(stepsBefore + 1)
    expect(await page.locator('.wbi-pq-steps [role="option"]').last().innerText()).toMatch(/Removed Columns/)
    await expect.poll(() => header.count()).toBe(0)
    // the generated M uses Table.RemoveColumns
    await page.locator('.wbi-pq-ribbon, .wbi-pqhost').getByRole('button', { name: /^Close & Apply/ }).first().click()
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().view)).toBe('report')
    await expect.poll(cols).not.toContain('Standard Cost')
    const m = await lumenEval(page, (l) => l.useApp.getState().project!.model.tables.find((t) => t.name === 'Product')!.partitions[0]!.expression ?? '')
    expect(m).toMatch(/Table\.RemoveColumns\([^)]*"Standard Cost"/)
    // data reloaded: the table still has its rows and the report renders
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().project!.data.tables.get('Product')?.columns.map((c) => c.name).includes('Standard Cost') ?? true)).toBe(false)
    // the load dialog closes by itself when every table loaded (PBI)
    await expect.poll(() => page.locator('.wbi-modal').count()).toBe(0)
    await waitIdle(page)
    await settle(page)
    expectAllRendered(await visualStatuses(page))
  })
})
