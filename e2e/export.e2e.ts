/**
 * Export page selection: a report with one visible page and the rest hidden (reached through page navigators).
 * File ▸ Export ▸ PDF opens the page dialog; the default ticks every non-tooltip page, hidden ones included;
 * "None" disables Export; two pages (one hidden, never opened in this session) are exported; the PDF has exactly two
 * pages, the hidden page's own size included. Images and PowerPoint reuse the remembered selection.
 */
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { unzipSync } from 'fflate'
import { useLumen, lumenEval, stubSaveDialog, stubOpenDialog, untilNode, waitIdle } from './harness'
import type { Locator, Page } from 'playwright-core'

async function openExport(page: Page, tile: RegExp, title: string): Promise<Locator> {
  await page.locator('.wbi-ribbon').getByRole('button', { name: 'File', exact: true }).first().click()
  const bs = page.getByRole('dialog', { name: 'File' })
  await bs.locator('.wbi-backstage__item', { hasText: /^Export$/ }).click()
  await page.getByRole('button', { name: tile }).click()
  const dlg = page.getByRole('dialog', { name: title })
  await expect.poll(() => dlg.count()).toBe(1)
  return dlg
}

const rows = (dlg: Locator) => dlg.locator('.wbi-xp__row')
async function checkedPages(dlg: Locator): Promise<string[]> {
  return rows(dlg).evaluateAll((els) => els.filter((e) => e.getAttribute('aria-checked') === 'true').map((e) => e.getAttribute('data-page')!))
}
const exportButton = (dlg: Locator) => dlg.getByRole('button', { name: 'Export', exact: true })
const selectAll = (dlg: Locator) => dlg.getByRole('checkbox', { name: 'Select all' })

/** Page count of a Chromium PDF + the MediaBox of each page (PDF points). */
function pdfPages(buf: Buffer): { count: number; boxes: string[] } {
  const text = buf.toString('latin1')
  expect(text.startsWith('%PDF-')).toBe(true)
  const count = text.match(/\/Type\s*\/Page[\s/>]/g)?.length ?? 0
  const boxes = [...text.matchAll(/\/MediaBox\s*\[\s*([\d.\s-]+)\]/g)].map((m) => m[1].trim().split(/\s+/).map((n) => Math.round(Number(n))).join(' '))
  return { count, boxes }
}

describe('export page selection', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('PDF, images and PowerPoint export exactly the chosen pages, hidden pages included', async () => {
    const { page, app, tmp } = lumen()
    // one visible landing page, every other page hidden; the last page gets its own size so the PDF shows it is there
    const setup = await lumenEval(page, (l) => {
      const st = l.useApp.getState()
      const order = st.project!.report!.pagesMeta.pageOrder.slice()
      st.mutateReport('Hide pages', (draft) => {
        for (const p of draft.pages) {
          if (p.name !== order[0]) p.json.visibility = 'HiddenInViewMode'
          if (p.name === order[order.length - 1]) Object.assign(p.json, { width: 1000, height: 600 })
        }
      })
      const r = l.useApp.getState().project!.report!
      const tooltip = r.pages.filter((p) => p.json.pageBinding?.type === 'Tooltip' || p.json.type === 'Tooltip').map((p) => p.name)
      const last = r.pages.find((p) => p.name === order[order.length - 1])!
      return { order, tooltip, active: l.useApp.getState().activePage, hiddenTitle: String(last.json.displayName) }
    })
    const { order, tooltip } = setup
    const first = order[0]
    const hidden = order[order.length - 1]
    expect(order.length).toBeGreaterThanOrEqual(3)
    expect(setup.active).toBe(first) // the hidden page has never been opened in this session
    await waitIdle(page)

    // ---- PDF ------------------------------------------------------------------------------------------------------
    let dlg = await openExport(page, /Export to PDF/, 'Export to PDF')
    expect(await rows(dlg).evaluateAll((els) => els.map((e) => e.getAttribute('data-page')))).toEqual(order)
    expect(await dlg.locator('.wbi-xp__hidden').count()).toBe(order.length - 1)
    // default: every page except tooltip pages, hidden ones included
    const defaults = order.filter((n) => !tooltip.includes(n))
    expect(await checkedPages(dlg)).toEqual(defaults)
    await expect.poll(() => dlg.locator('.wbi-xp__count').innerText()).toBe(`${defaults.length} of ${order.length} pages selected`)
    expect(await selectAll(dlg).getAttribute('aria-checked')).toBe(tooltip.length ? 'mixed' : 'true')

    // None → Export disabled with a reason; select-all header goes unticked
    await dlg.getByRole('button', { name: 'None', exact: true }).click()
    expect(await checkedPages(dlg)).toEqual([])
    expect(await exportButton(dlg).isDisabled()).toBe(true)
    expect(await dlg.locator('.wbi-xp__reason').innerText()).toMatch(/Select at least one page/)
    expect(await selectAll(dlg).getAttribute('aria-checked')).toBe('false')
    // Ctrl+A ticks every page; the header toggles them all off again
    await rows(dlg).first().focus()
    await page.keyboard.press('Control+a')
    expect(await checkedPages(dlg)).toEqual(order)
    expect(await selectAll(dlg).getAttribute('aria-checked')).toBe('true')
    await selectAll(dlg).click()
    expect(await checkedPages(dlg)).toEqual([])
    // Visible only
    await dlg.getByRole('button', { name: 'Visible only', exact: true }).click()
    expect(await checkedPages(dlg)).toEqual([first])
    // click the second page (anchor), shift-click the third: range ticked; Space on the focused (third) row unticks it
    await rows(dlg).nth(1).click()
    await rows(dlg).nth(2).click({ modifiers: ['Shift'] })
    expect(await checkedPages(dlg)).toEqual(order.slice(0, 3))
    await page.keyboard.press('Space')
    expect(await checkedPages(dlg)).toEqual(order.slice(0, 2))
    // pick the visible landing page + the last (hidden, never opened) page
    await dlg.getByRole('button', { name: 'None', exact: true }).click()
    await rows(dlg).first().click()
    await rows(dlg).last().click()
    expect(await checkedPages(dlg)).toEqual([first, hidden])
    expect(await selectAll(dlg).getAttribute('aria-checked')).toBe('mixed')
    await expect.poll(() => dlg.locator('.wbi-xp__count').innerText()).toBe(`2 of ${order.length} pages selected`)
    expect(await exportButton(dlg).isDisabled()).toBe(false)

    const pdf = join(tmp, 'two.pdf')
    await stubSaveDialog(app, pdf)
    await exportButton(dlg).click()
    await untilNode(() => existsSync(pdf) && statSync(pdf).size > 1000, 60_000, 'PDF')
    await waitIdle(page)
    const parsed = pdfPages(readFileSync(pdf))
    expect(parsed.count).toBe(2)
    // the hidden page keeps its own page size (1000 × 600 px = 750 × 450 pt)
    expect(parsed.boxes).toContain('0 0 750 450')
    // and its content (vector text) when poppler's pdftotext is installed
    const txt = spawnSync('pdftotext', ['-f', '2', '-l', '2', pdf, '-'], { encoding: 'utf8' })
    if (txt.status === 0) expect(txt.stdout).toContain(setup.hiddenTitle)

    // ---- images: the dialog remembers the selection; Enter exports --------------------------------------------------
    dlg = await openExport(page, /Export pages as images/, 'Export pages as images')
    expect(await checkedPages(dlg)).toEqual([first, hidden])
    await dlg.getByRole('radio', { name: /1×/ }).click()
    const dir = join(tmp, 'png')
    await stubOpenDialog(app, [dir])
    await rows(dlg).first().focus()
    await page.keyboard.press('Enter')
    await untilNode(() => existsSync(dir) && readdirSync(dir).filter((f) => f.endsWith('.png')).length === 2, 60_000, 'PNG files')
    await waitIdle(page)
    const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort()
    expect(files.map((f) => f.slice(0, 4))).toEqual(['1 - ', '2 - '])
    const png = readFileSync(join(dir, files[1]))
    // second file = the hidden page at its own size, rendered (a blank page compresses to a few KB)
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1000, 600])
    expect(png.length).toBeGreaterThan(15_000)

    // ---- PowerPoint: title slide + the two pages; Escape on another dialog cancels without exporting ---------------
    dlg = await openExport(page, /Export to HTML/, 'Export to HTML')
    await page.keyboard.press('Escape')
    await expect.poll(() => dlg.count()).toBe(0)
    dlg = await openExport(page, /Export to PowerPoint/, 'Export to PowerPoint')
    expect(await checkedPages(dlg)).toEqual([first, hidden])
    const pptx = join(tmp, 'two.pptx')
    await stubSaveDialog(app, pptx)
    await exportButton(dlg).click()
    await untilNode(() => existsSync(pptx) && statSync(pptx).size > 1000, 60_000, 'PPTX')
    await waitIdle(page)
    const zip = unzipSync(new Uint8Array(readFileSync(pptx)))
    expect(Object.keys(zip).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).length).toBe(3)
  })
})
