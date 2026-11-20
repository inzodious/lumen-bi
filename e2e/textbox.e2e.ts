/**
 * Text box editing: deleting a whole paragraph (a heading and its line break) keeps the text box editable and the
 * other paragraphs' run styles, the way Power BI Desktop's text box editor does.
 */
import { describe, expect, it } from 'vitest'
import { useLumen, visualStatuses, lumenEval, deselectAll, rendererErrors } from './harness'

const H = { fontFamily: 'Segoe UI Semibold', fontSize: '13pt', color: '#171C73' }
const B = { fontFamily: 'Segoe UI Semibold', fontSize: '10pt', color: '#171C73' }
const N = { fontFamily: 'Segoe UI', fontSize: '10pt', color: '#171C73' }
const S = { fontFamily: 'Segoe UI', fontSize: '6pt', color: '#171C73' }
const PARAGRAPHS = [
  { textRuns: [{ value: 'How to read the table', textStyle: H }] },
  { textRuns: [{ value: ' ', textStyle: S }] },
  { textRuns: [{ value: 'Customers', textStyle: B }, { value: ': first purchase in the month.', textStyle: N }] },
  { textRuns: [{ value: 'Retained', textStyle: B }, { value: ': bought again.', textStyle: N }] }
]

describe('text box editing', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('deleting the heading paragraph keeps the text box editable and the other runs styled', async () => {
    const { page } = lumen()
    const name = (await visualStatuses(page)).find((v) => v.type === 'textbox')!.name
    expect(name).toBeTruthy()
    // setup (not under test): give the demo text box a heading, a spacer and label + definition lines
    await lumenEval(
      page,
      (l, a) =>
        l.useApp.getState().mutateReport('Set text', (r) => {
          for (const p of r.pages) for (const v of p.visuals) if (v.name === a.name) v.json.visual.objects.general[0].properties.paragraphs = a.paragraphs
        }),
      { name, paragraphs: PARAGRAPHS }
    )
    const paragraphs = () =>
      lumenEval(page, (l, n) => l.useApp.getState().project!.report!.pages.flatMap((p) => p.visuals).find((v) => v.name === n)!.json.visual.objects.general[0].properties.paragraphs, name)
    const content = page.locator(`.wbi-page [data-visual="${name}"] .wbi-vc-content`)
    await expect.poll(() => content.innerText()).toContain('How to read the table')
    const errorsBefore = (await rendererErrors(page)).length

    // edit: select the heading and its line break, delete them, leave the editor
    await content.locator('div', { hasText: /^How to read the table$/ }).last().dblclick()
    const editor = content.locator('[contenteditable="true"]')
    await expect.poll(() => editor.count()).toBe(1)
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Delete')
    await deselectAll(page)
    await expect.poll(() => editor.count()).toBe(0)

    await expect.poll(paragraphs).toEqual(PARAGRAPHS.slice(1))
    expect((await visualStatuses(page)).find((v) => v.name === name)?.state).toBe('ok')
    expect((await rendererErrors(page)).slice(errorsBefore)).toEqual([])

    // still editable: type a new heading in the first line
    await content.locator('span', { hasText: /^Customers$/ }).dblclick()
    await expect.poll(() => editor.count()).toBe(1)
    await page.keyboard.press('Control+Home')
    await page.keyboard.type('Read me')
    await deselectAll(page)
    await expect.poll(() => editor.count()).toBe(0)
    const after = await paragraphs()
    expect(after).toHaveLength(3)
    expect(after[0].textRuns.map((r: any) => r.value).join('')).toBe('Read me ')
    expect(after[1]).toEqual(PARAGRAPHS[2])
    expect((await rendererErrors(page)).slice(errorsBefore)).toEqual([])
  })
})
