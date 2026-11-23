/**
 * Start screen → Gallery: the template cards with their Power BI compatible / Lumen only badges and filter; a
 * Power BI compatible design (Boardroom), a Lumen-only one (Orbital, glass panels from Lumen_Style) and the 1st
 * Edition starter each open as a new unsaved report; the designs' empty visuals draw their sample data.
 * `LUMEN_E2E_SHOTS=<dir>` additionally saves screenshots of the start screen, the gallery and the new reports.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { useLumen, waitIdle, lumenEval, pageTabs, goToPage, visualsOfType } from './harness'

const SHOTS = process.env['LUMEN_E2E_SHOTS'] ?? ''

/** Show the start screen afresh (it remounts on the welcome view) and switch it to the gallery. */
async function openGallery(page: Page) {
  await lumenEval(page, (l) => {
    l.useShell.getState().setStartScreen(false)
  })
  await lumenEval(page, (l) => {
    l.useShell.getState().setStartScreen(true)
  })
  const start = page.getByRole('dialog', { name: /Welcome to Lumen/ })
  await start.getByRole('button', { name: /^Gallery/ }).click()
  await start.locator('.wbi-gallery__card').first().waitFor({ state: 'visible' })
  return start
}

describe('template gallery', () => {
  const lumen = useLumen({ route: { start: '1' } })

  it('lists the templates with compatibility badges and filters them', async () => {
    const { page } = lumen()
    const start = page.getByRole('dialog', { name: /Welcome to Lumen/ })
    await start.waitFor({ state: 'visible' })
    await start.getByRole('button', { name: /^Gallery/ }).click()
    const cards = start.locator('.wbi-gallery__card')
    await expect.poll(() => cards.count()).toBe(11)
    await expect.poll(() => start.locator('.wbi-gallery__badge.is-lumen').count()).toBe(3)
    // every card has its rendered preview
    await expect.poll(() => start.locator('.wbi-gallery__thumb img').count()).toBe(11)
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'gallery-all.png') })
    await start.getByRole('radio', { name: /^Lumen only/ }).click()
    await expect.poll(() => cards.count()).toBe(3)
    expect(await start.locator('.wbi-gallery__name').allTextContents()).toEqual(['Orbital', 'Blacktop', 'Aurora'])
    await start.getByRole('radio', { name: /^Power BI compatible/ }).click()
    await expect.poll(() => cards.count()).toBe(8)
    await start.getByRole('radio', { name: /^All/ }).click()
    await expect.poll(() => cards.count()).toBe(11)
  })

  it('opens a Power BI compatible design: no data tables, its empty visuals draw the designed sample', async () => {
    const { page } = lumen()
    const start = await openGallery(page)
    await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
    await start.getByRole('button', { name: /^Boardroom:/ }).click()
    await waitIdle(page)
    await start.waitFor({ state: 'detached' })
    expect(await pageTabs(page)).toEqual(['Overview', 'Segments'])
    const info = await lumenEval(page, (l) => {
      const p = l.useApp.getState().project!
      return { name: p.name, kind: p.source.kind, tables: p.model.tables.map((t) => t.name) }
    })
    expect(info).toEqual({ name: 'Boardroom', kind: 'new', tables: ['_measures_kpi', '_measures_format'] })
    await expect.poll(() => page.locator('.wbi-page .wbi-vc[data-sample="report"]').count()).toBeGreaterThan(4)
    await expect.poll(() => page.getByText('Quarterly Performance Review', { exact: true }).count()).toBe(1)
    await expect.poll(() => page.getByText('$490.4M', { exact: true }).count()).toBe(1)
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'boardroom.png') })
    expect(await lumenEval(page, (l) => l.errors.filter((e) => !/Warning:/.test(e)).length)).toBe(0)
  })

  it('opens a Lumen-only design: frosted-glass panels from Lumen_Style', async () => {
    const { page } = lumen()
    const start = await openGallery(page)
    await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
    await start.getByRole('button', { name: /^Orbital:/ }).click()
    await waitIdle(page)
    await start.waitFor({ state: 'detached' })
    expect(await pageTabs(page)).toEqual(['Mission Control'])
    const glass = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.wbi-vc-box')].filter((b) => b.style.backdropFilter.startsWith('blur(')).length)
    expect(glass).toBeGreaterThanOrEqual(7)
    await expect.poll(() => page.getByText('97.92%', { exact: true }).count()).toBe(1)
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'orbital.png') })
    expect(await lumenEval(page, (l) => l.errors.filter((e) => !/Warning:/.test(e)).length)).toBe(0)
  })

  it('opens the 1st Edition template from the Gallery button', async () => {
    const { page } = lumen()
    const start = await openGallery(page)
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'gallery.png') })
    await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
    await start.getByRole('button', { name: /^1st Edition:/ }).click()
    await waitIdle(page)
    await start.waitFor({ state: 'detached' })

    expect(await pageTabs(page)).toEqual(['Overview', 'Detail', 'Export', 'Info'])
    const info = await lumenEval(page, (l) => {
      const p = l.useApp.getState().project!
      return { name: p.name, kind: p.source.kind, calendarRows: p.data.tables.get('dim_calendar')?.rowCount ?? 0, refreshRows: p.data.tables.get('dim_last_refresh')?.rowCount ?? 0 }
    })
    expect(info).toMatchObject({ name: '1st Edition', kind: 'new', refreshRows: 1 })
    expect(info.calendarRows).toBeGreaterThan(365 * 3)

    // three empty, styled filters on every page but Info
    for (const [i, expected] of [[0, 3], [1, 3], [2, 3], [3, 0]] as const) {
      await goToPage(page, i)
      expect((await visualsOfType(page, 'slicer')).length).toBe(expected)
    }
    await goToPage(page, 0)
    await expect.poll(() => page.getByText('Filter 1', { exact: true }).count()).toBe(1)
    // the Applied Filters header is the HTML Content visual: its markup renders inside an iframe
    const header = page.frameLocator('.wbi-vc[data-type^="htmlContent"] iframe')
    await expect.poll(() => header.getByText(/^Applied Filters:/i).count()).toBe(1)
    await expect.poll(() => header.getByText('Report Date:', { exact: true }).count()).toBe(1)
    await expect.poll(() => page.getByText(/^Last Refreshed: \d{4}-\d{2}-\d{2}/).count()).toBe(1)
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'report.png') })
    expect(await lumenEval(page, (l) => l.errors.filter((e) => !/Warning:/.test(e)).length)).toBe(0)
  })
})
