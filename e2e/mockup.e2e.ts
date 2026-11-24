/**
 * Sample data on empty visuals (mockups): a gallery template opens with no data tables, only the two default
 * measure tables, and its empty visuals draw their designed sample. View ▸ Sample data hides and restores every
 * sample, the context menu clears and restores one, and a real field dropped into a visual replaces its sample.
 * A new blank report has the measure tables too, and a chart inserted into it draws a generic sample.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { dataPaneRow, deselectAll, lumenEval, settle, useLumen, waitIdle } from './harness'

const SHOTS = process.env['LUMEN_E2E_SHOTS'] ?? ''
const samples = (page: Page) => page.locator('.wbi-page .wbi-vc[data-sample]')
const errors = (page: Page) => lumenEval(page, (l) => l.errors.filter((e) => !/Warning:/.test(e)))

async function viewTab(page: Page) {
  await page.locator('.wbi-ribbon [role="tab"]', { hasText: /^View$/ }).click()
}

describe('sample data on a template', () => {
  const lumen = useLumen({ route: { template: 'boardroom' } })

  it('has no data tables, only _measures_kpi and _measures_format; its empty visuals draw the designed sample', async () => {
    const { page } = lumen()
    await waitIdle(page)
    const model = await lumenEval(page, (l) => {
      const p = l.useApp.getState().project!
      return { tables: p.model.tables.map((t) => t.name), queries: p.report!.pages.flatMap((pg) => pg.visuals).filter((v) => v.json.visual?.query).length }
    })
    expect(model).toEqual({ tables: ['_measures_kpi', '_measures_format'], queries: 0 })
    await expect((await dataPaneRow(page, ['_measures_kpi', 'kpi_blank'])).isVisible()).resolves.toBe(true)
    await expect((await dataPaneRow(page, ['_measures_format', 'fmt_blank'])).isVisible()).resolves.toBe(true)
    await expect.poll(() => samples(page).count()).toBeGreaterThan(4)
    expect(await page.locator('.wbi-page .wbi-vc[data-sample="report"]').count()).toBe(await samples(page).count())
    await expect.poll(() => page.getByText('$490.4M', { exact: true }).count()).toBe(1)
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'mockup-template.png') })
    expect(await errors(page)).toEqual([])
  })

  it('View ▸ Sample data hides every sample and brings them back', async () => {
    const { page } = lumen()
    const before = await samples(page).count()
    await viewTab(page)
    const toggle = page.locator('.wbi-ribbon').getByRole('button', { name: 'Sample data', exact: true })
    await toggle.click()
    await expect.poll(() => samples(page).count()).toBe(0)
    await expect.poll(() => page.getByText('$490.4M', { exact: true }).count()).toBe(0)
    await toggle.click()
    await expect.poll(() => samples(page).count()).toBe(before)
    await expect.poll(() => page.getByText('$490.4M', { exact: true }).count()).toBe(1)
  })

  it('clears one visual’s sample from its context menu and shows it again', async () => {
    const { page } = lumen()
    const target = samples(page).first()
    const name = (await target.getAttribute('data-visual'))!
    const vc = page.locator(`.wbi-page .wbi-vc[data-visual="${name}"]`)
    const total = await samples(page).count()
    await vc.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Clear sample data' }).click()
    await expect.poll(() => vc.getAttribute('data-sample')).toBeNull()
    expect(await samples(page).count()).toBe(total - 1)
    await vc.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Show sample data' }).click()
    await expect.poll(() => vc.getAttribute('data-sample')).toBe('report')
  })

  it('a field dropped into a visual replaces its sample', async () => {
    const { page } = lumen()
    const card = page.locator('.wbi-page .wbi-vc[data-type="cardVisual"][data-sample]').first()
    const name = (await card.getAttribute('data-visual'))!
    await card.click()
    await expect(lumenEval(page, (l) => l.useApp.getState().selectedVisuals)).resolves.toEqual([name])
    const row = await dataPaneRow(page, ['_measures_kpi', 'kpi_blank'])
    await row.locator('.wbi-dtree__check input, .wbi-dtree__check [role="checkbox"]').first().click()
    await settle(page)
    const vc = page.locator(`.wbi-page .wbi-vc[data-visual="${name}"]`)
    await expect.poll(() => vc.getAttribute('data-sample')).toBeNull()
    await deselectAll(page)
    expect(await errors(page)).toEqual([])
  })
})

describe('sample data on a new report', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('a new blank report has both measure tables; an inserted chart draws a generic sample until it gets fields', async () => {
    const { page } = lumen()
    await waitIdle(page)
    await page.locator('.wbi-page').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+n')
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().project?.model.tables.map((t) => t.name))).toEqual(['_measures_kpi', '_measures_format'])
    await page.getByRole('tab', { name: 'Build visual' }).click()
    await page.getByRole('listbox', { name: 'Visual types' }).getByRole('option', { name: 'Clustered column chart', exact: true }).click()
    const vc = page.locator('.wbi-page .wbi-vc[data-type="clusteredColumnChart"]')
    await expect.poll(() => vc.count()).toBe(1)
    await expect.poll(() => vc.getAttribute('data-sample')).toBe('generic')
    await expect.poll(() => vc.locator('svg rect').count()).toBeGreaterThan(3)
    await vc.hover()
    await expect.poll(() => vc.locator('.wbi-vc-sample').count()).toBe(1)
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'mockup-new-report.png') })
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().project!.report!.pages[0].visuals[0].json.visual.query ?? null)).toBeNull()
    expect(await errors(page)).toEqual([])
  })
})
