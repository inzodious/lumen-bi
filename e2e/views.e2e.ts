/** Table view rows, Model view cards + relationship lines, DAX query view EVALUATE → result grid. */
import { describe, expect, it } from 'vitest'
import { useLumen, dataPaneRow, lumenEval } from './harness'

describe('views', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('Table view shows the selected table rows', async () => {
    const { page } = lumen()
    await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Table view' }).click()
    await (await dataPaneRow(page, ['Product'])).click()
    const grid = page.getByRole('grid', { name: 'Table Product' })
    await grid.waitFor()
    const rowCount = Number(await grid.getAttribute('aria-rowcount'))
    const expected = await lumenEval(page, (l) => l.useApp.getState().project!.data.tables.get('Product')?.rowCount ?? -1)
    expect(rowCount).toBeGreaterThan(10)
    expect(rowCount).toBe(expected)
    expect(await grid.getByRole('columnheader').allInnerTexts()).toEqual(expect.arrayContaining([expect.stringMatching(/^Category/), expect.stringMatching(/^Subcategory/)]))
    expect(await grid.locator('[role="row"].wbi-dv__row').count()).toBeGreaterThan(10)
    // the status bar reports the row count like PBI ("Table: Product (N rows)")
    expect(await page.locator('.wbi-statusbar').innerText()).toMatch(new RegExp(`${expected.toLocaleString('en-US')}|${expected}`))
  })

  it('Model view shows table cards and relationship lines', async () => {
    const { page } = lumen()
    await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Model view' }).click()
    const cards = page.locator('.wbi-mv-card')
    await cards.first().waitFor()
    const tables = await lumenEval(page, (l) => l.useApp.getState().project!.model.tables.filter((t) => !t.isPrivate).length)
    const rels = await lumenEval(page, (l) => l.useApp.getState().project!.model.relationships.length)
    expect(await cards.count()).toBe(tables)
    expect(rels).toBeGreaterThan(2)
    expect(await page.locator('.wbi-mv-edge .wbi-mv-edge__line').count()).toBe(rels)
    // every line has a non-trivial path between two cards
    const lens = await page.locator('.wbi-mv-edge__line').evaluateAll((ps) => ps.map((p) => (p as SVGPathElement).getTotalLength()))
    expect(lens.every((n) => n > 10)).toBe(true)
  })

  it('DAX query view runs EVALUATE TOPN and shows a result grid', async () => {
    const { page } = lumen()
    await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'DAX query view' }).click()
    const ed = page.locator('.wbi-dq__editor .cm-content')
    await ed.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Delete')
    await page.keyboard.insertText("EVALUATE TOPN(5, SUMMARIZECOLUMNS('Product'[Category], \"Sales\", [Total Sales]), [Sales], DESC) ORDER BY [Sales] DESC")
    await page.locator('.wbi-dq__toolbar').getByRole('button', { name: /Run/ }).click()
    const grid = page.locator('.wbi-dq__grid')
    await grid.waitFor()
    expect(await grid.getByRole('columnheader').allInnerTexts()).toEqual(['Product[Category]', '[Sales]'])
    const rows = await grid.locator('.wbi-dq__grow').allInnerTexts()
    expect(rows.length).toBe(4) // the sample has four categories; TOPN(5) returns them all
    expect(rows[0]).toMatch(/Bikes/)
    expect(await page.locator('.wbi-dq__ok').innerText()).toMatch(/4 rows?/)
  })
})
