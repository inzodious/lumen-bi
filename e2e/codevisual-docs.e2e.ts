/**
 * The code visual documentation, run in the app: every step of the two tutorials
 * (docs/create-reports/tutorial-build-a-kpi-tile-with-html-and-css.md, tutorial-build-a-drillable-bar-list.md) and the
 * how-to's screenshots, on the built-in sample at 1440 × 900. The steps always run (they are the tutorials' test);
 * screenshots are written only when LUMEN_DOCS_IMAGES names the docs/images folder.
 */
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import type { FrameLocator, Page } from 'playwright-core'
import { useLumen, waitIdle, settle, lumenEval, dataPaneRow, deselectAll, untilVisualText } from './harness'
import { TUTORIAL_KPI } from './fixtures/codevisualTutorial'
import { templateVisual } from './fixtures/codevisualTemplates'

const IMAGES = process.env['LUMEN_DOCS_IMAGES'] ?? ''
const TYPE = 'lumenCodeVisualC0DE5A1E7B3F4E2A9D6C8B1F0E4A7D3C'

async function shot(page: Page, file: string, target: { selector?: string; clip?: { x: number; y: number; width: number; height: number } } = {}): Promise<void> {
  if (!IMAGES) return
  const path = join(IMAGES, file)
  if (target.selector) await page.locator(target.selector).first().screenshot({ path })
  else await page.screenshot({ path, ...(target.clip ? { clip: target.clip } : {}) })
}

async function newPage(page: Page): Promise<void> {
  await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
  await page.locator('.wbi-tab-add').click()
  await waitIdle(page)
}

async function insertCodeVisual(page: Page, template: string): Promise<string> {
  await deselectAll(page)
  await page.getByRole('tab', { name: 'Build visual' }).click()
  await page.getByRole('listbox', { name: 'Visual types' }).getByRole('option', { name: 'Code visual', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'New code visual' })
  await picker.getByRole('option', { name: template }).click()
  return picker.getByRole('button', { name: 'Insert' }).click().then(async () => {
    await expect.poll(() => codeVisuals(page)).toHaveLength(1)
    return (await codeVisuals(page))[0]
  })
}

async function codeVisuals(page: Page): Promise<string[]> {
  return lumenEval(page, (l, t) => {
    const s = l.useApp.getState()
    return s.project!.report!.pages.find((p) => p.name === s.activePage)!.visuals.filter((v) => v.json.visual?.visualType === t).map((v) => v.name)
  }, TYPE)
}

const well = (page: Page, title: string) => page.locator('.wbi-well').filter({ has: page.locator('.wbi-well__title', { hasText: new RegExp(`^${title}$`) }) }).first().locator('.wbi-well__drop')

function frameOf(page: Page, visual: string): FrameLocator {
  return page.frameLocator(`.wbi-page [data-visual="${visual}"] iframe.wbi-codevisual__frame`)
}

async function rendered(page: Page, visual: string): Promise<void> {
  await page.waitForFunction((v) => document.querySelector(`.wbi-page [data-visual="${v}"] .wbi-codevisual`)?.getAttribute('data-code-state') === 'rendered', visual)
}

async function clickInFrame(page: Page, visual: string, selector: string, hasText?: string): Promise<void> {
  let loc = frameOf(page, visual).locator(selector)
  if (hasText) loc = loc.filter({ hasText })
  const r = await loc.first().evaluate((el) => {
    const b = el.getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  })
  const iframe = page.locator(`.wbi-page [data-visual="${visual}"] iframe.wbi-codevisual__frame`)
  const fb = (await iframe.boundingBox())!
  const scale = fb.width / (await iframe.evaluate((el) => (el as HTMLElement).offsetWidth))
  await page.mouse.click(fb.x + r.x * scale, fb.y + r.y * scale)
}

/** Replace the text of the editor's current tab (one input, like a paste). */
async function replaceCode(page: Page, code: string): Promise<void> {
  const dlg = page.getByRole('dialog', { name: 'Edit code' })
  await dlg.locator('.wbi-cve__editor:not([hidden]) .cm-content').click()
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText(code)
}

async function openEditor(page: Page, visual: string): Promise<void> {
  await page.locator(`.wbi-page [data-visual="${visual}"]`).click({ position: { x: 12, y: 12 } })
  await page.getByRole('tab', { name: 'Build visual' }).click()
  await page.locator('.wbi-viz__codeactions').getByRole('button', { name: 'Edit code' }).click()
  await expect.poll(() => page.getByRole('dialog', { name: 'Edit code' }).count()).toBe(1)
}

describe('code visual documentation', () => {
  const lumen = useLumen({ route: { sample: '1' }, size: '1440x900' })

  it('tutorial: build a KPI tile with HTML and CSS', async () => {
    const { page } = lumen()
    await newPage(page)
    // 1. Insert > Code visual, KPI tile
    const v = await insertCodeVisual(page, 'KPI tile')
    // 2. bind Total Sales and Sales LY to Values
    await (await dataPaneRow(page, ['_Measures', 'Sales', 'Total Sales'])).dragTo(well(page, 'Values'))
    await (await dataPaneRow(page, ['_Measures', 'Time Intelligence', 'Sales LY'])).dragTo(well(page, 'Values'))
    await settle(page)
    await rendered(page, v)
    // 3. open the editor and replace the template
    await openEditor(page, v)
    const dlg = page.getByRole('dialog', { name: 'Edit code' })
    await dlg.getByRole('tab', { name: 'HTML' }).click()
    await replaceCode(page, TUTORIAL_KPI.html1)
    await dlg.getByRole('tab', { name: 'CSS' }).click()
    await replaceCode(page, TUTORIAL_KPI.css1)
    const preview = dlg.frameLocator('.wbi-cve__visual iframe')
    await expect.poll(() => preview.locator('.value').innerText()).toBe('$6,487,996')
    expect(await preview.locator('.delta').innerText()).toBe('69.8% vs Sales LY')
    await shot(page, 'create-reports/tutorial-build-a-kpi-tile-with-html-and-css-editor.png', { selector: '.wbi-modal' })
    // 4. responsive: clamp() with container units, a container query
    await replaceCode(page, TUTORIAL_KPI.css2)
    await dlg.getByRole('button', { name: 'Small' }).click()
    await expect.poll(() => preview.locator('.delta').evaluate((el) => getComputedStyle(el).display)).toBe('none')
    await shot(page, 'create-reports/tutorial-build-a-kpi-tile-with-html-and-css-small.png', { selector: '.wbi-cve__right' })
    await dlg.getByRole('button', { name: 'Current' }).click()
    // 5. a progress bar sized by two measures, in CSS
    await dlg.getByRole('tab', { name: 'HTML' }).click()
    await replaceCode(page, TUTORIAL_KPI.html2)
    await dlg.getByRole('tab', { name: 'CSS' }).click()
    await replaceCode(page, TUTORIAL_KPI.css3)
    await expect.poll(() => preview.locator('.bar span').evaluate((el) => (el as HTMLElement).getBoundingClientRect().width > 0)).toBe(true)
    // the Data tab shows the variables the CSS used
    await dlg.getByRole('tab', { name: 'Data' }).click()
    await expect.poll(() => dlg.locator('.wbi-cve__data').innerText()).toContain('--sales-ly')
    await shot(page, 'create-reports/tutorial-build-a-kpi-tile-with-html-and-css-data.png', { selector: '.wbi-modal' })
    // 6. apply
    await dlg.getByRole('button', { name: 'Apply' }).click()
    await dlg.locator('.wbi-modal__footer').getByRole('button', { name: 'Close' }).click()
    await expect.poll(() => frameOf(page, v).locator('.value').innerText()).toBe('$6,487,996')
    await lumenEval(page, (l, n) => {
      const s = l.useApp.getState()
      s.mutateReport('place', (r: any) => {
        const x = r.pages.find((p: any) => p.name === s.activePage).visuals.find((q: any) => q.name === n)
        x.json.position = { ...x.json.position, x: 24, y: 24, width: 340, height: 180 }
      })
    }, v)
    await deselectAll(page)
    await lumenEval(page, (l) => l.useApp.getState().setZoom(1))
    await settle(page)
    await shot(page, 'create-reports/tutorial-build-a-kpi-tile-with-html-and-css-result.png', { selector: `.wbi-page [data-visual="${v}"]` })
    await lumenEval(page, (l) => l.useApp.getState().setZoom(null))
  })

  it('tutorial: build a drillable, selectable bar list', async () => {
    const { page } = lumen()
    await newPage(page)
    const v = await insertCodeVisual(page, 'Bar list (drill and select)')
    for (const f of ['Category', 'Subcategory', 'Product']) await (await dataPaneRow(page, ['Product', f])).dragTo(well(page, 'Rows'))
    await (await dataPaneRow(page, ['_Measures', 'Sales', 'Total Sales'])).dragTo(well(page, 'Values'))
    await settle(page)
    await rendered(page, v)
    await lumenEval(page, (l, n) => {
      const s = l.useApp.getState()
      s.mutateReport('place', (r: any) => {
        const x = r.pages.find((p: any) => p.name === s.activePage).visuals.find((q: any) => q.name === n)
        x.json.position = { ...x.json.position, x: 16, y: 16, width: 380, height: 260 }
      })
      s.setZoom(1)
    }, v)
    await settle(page)
    await page.mouse.move(700, 880)
    await shot(page, 'create-reports/code-visual-wells.png', { clip: { x: 48, y: 160, width: 1392, height: 600 } })
    await lumenEval(page, (l) => l.useApp.getState().setZoom(null))
    // a native card next to it
    await deselectAll(page)
    await page.getByRole('listbox', { name: 'Visual types' }).getByRole('option', { name: 'Card', exact: true }).first().click()
    await (await dataPaneRow(page, ['_Measures', 'Sales', 'Total Sales'])).dragTo(well(page, 'Value'))
    await settle(page)
    const card = await lumenEval(page, (l) => {
      const s = l.useApp.getState()
      return s.project!.report!.pages.find((p) => p.name === s.activePage)!.visuals.find((x) => /card/i.test(x.json.visual?.visualType ?? ''))!.name
    })
    // lay the two visuals out side by side (setup)
    await lumenEval(page, (l, a) => {
      const s = l.useApp.getState()
      s.mutateReport('place', (r: any) => {
        const vs = r.pages.find((p: any) => p.name === s.activePage).visuals
        vs.find((q: any) => q.name === a.v).json.position = { ...vs.find((q: any) => q.name === a.v).json.position, x: 16, y: 16, width: 380, height: 260 }
        vs.find((q: any) => q.name === a.card).json.position = { ...vs.find((q: any) => q.name === a.card).json.position, x: 412, y: 16, width: 210, height: 110 }
      })
    }, { v, card })
    await settle(page)
    const total = await untilVisualText(page, card, (t) => /\$/.test(t))
    // drill into Bikes with the arrow
    await clickInFrame(page, v, '.bl__row:has-text("Bikes") [data-drill]')
    await expect.poll(() => frameOf(page, v).locator('.bl__path').innerText()).toBe('Bikes')
    await expect.poll(() => frameOf(page, v).locator('.bl__by').innerText()).toBe('by Subcategory')
    // select Road Bikes: the card shows its total
    await clickInFrame(page, v, '.bl__row', 'Road Bikes')
    const road = await untilVisualText(page, card, (t) => t !== total && /\$/.test(t))
    expect(road).not.toBe(total)
    await lumenEval(page, (l) => {
      l.useApp.getState().selectVisuals([])
      l.useApp.getState().setZoom(1)
    })
    await settle(page)
    {
      // the pointer on empty canvas (no hover header)
      const pg = (await page.locator('.wbi-page').boundingBox())!
      await page.mouse.move(pg.x + 640, pg.y + 420, { steps: 4 })
      await page.waitForFunction(() => !document.querySelector('.wbi-vh'))
    }
    {
      const a = (await page.locator(`.wbi-page [data-visual="${v}"]`).boundingBox())!
      const b = (await page.locator(`.wbi-page [data-visual="${card}"]`).boundingBox())!
      await shot(page, 'create-reports/tutorial-build-a-drillable-bar-list-selected.png', { clip: { x: a.x - 12, y: Math.min(a.y, b.y) - 12, width: b.x + b.width - a.x + 24, height: a.height + 24 } })
    }
    await lumenEval(page, (l) => l.useApp.getState().setZoom(null))
    await settle(page)
    // back up
    await clickInFrame(page, v, '[data-drill-up]')
    await expect.poll(() => frameOf(page, v).locator('.bl__by').innerText()).toBe('by Category')
  })

  it('how-to screenshots: picker, editor, parameters', async () => {
    const { page } = lumen()
    await deselectAll(page)
    await page.getByRole('tab', { name: 'Build visual' }).click()
    await page.getByRole('listbox', { name: 'Visual types' }).getByRole('option', { name: 'Code visual', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'New code visual' })
    await picker.getByRole('option', { name: 'Bar list (drill and select)' }).click()
    await shot(page, 'create-reports/code-visual-template-picker.png', { selector: '.wbi-modal' })
    await picker.getByRole('button', { name: 'Cancel' }).click()
    const v = (await codeVisuals(page))[0]
    await openEditor(page, v)
    const dlg = page.getByRole('dialog', { name: 'Edit code' })
    await dlg.getByRole('tab', { name: 'HTML' }).click()
    await shot(page, 'create-reports/code-visual-editor.png', { selector: '.wbi-modal' })
    await dlg.getByRole('tab', { name: 'Parameters' }).click()
    await shot(page, 'create-reports/code-visual-parameters-tab.png', { selector: '.wbi-modal' })
    await dlg.locator('.wbi-modal__footer').getByRole('button', { name: 'Close' }).click()
    await page.getByRole('tab', { name: 'Format visual' }).click()
    await page.locator('.wbi-fmt__pivot').getByRole('tab', { name: 'Visual' }).click()
    const card = page.locator('.wbi-fmt__cards .wbi-card').filter({ has: page.locator('.wbi-card__title', { hasText: /^Parameters$/ }) })
    if (!(await card.locator('[data-prop="title"]').count())) await card.locator('.wbi-card__header').click()
    await shot(page, 'create-reports/code-visual-format-parameters.png', { selector: '.wbi-fmt' })
  })

  it('overview screenshot: starter templates on a page', async () => {
    const { page } = lumen()
    await newPage(page)
    const vs = [
      templateVisual('ovkpi000000000000000', 'kpi', { x: 16, y: 16, w: 300, h: 170 }),
      templateVisual('ovring00000000000000', 'ring', { x: 328, y: 16, w: 290, h: 170 }),
      templateVisual('ovbarlist00000000000', 'barlist', { x: 16, y: 198, w: 300, h: 210 }),
      templateVisual('ovbadges000000000000', 'badges', { x: 328, y: 198, w: 290, h: 210 })
    ]
    await lumenEval(page, (l, a) => {
      const s = l.useApp.getState()
      s.mutateReport('overview', (r: any) => {
        const p = r.pages.find((x: any) => x.name === s.activePage)
        for (const v of a) p.visuals.push({ name: v.name, json: v })
      })
      s.setZoom(1)
    }, vs)
    await settle(page)
    for (const v of vs) await rendered(page, v.name)
    const pg = (await page.locator('.wbi-page').boundingBox())!
    await page.mouse.move(pg.x + 700, pg.y + 500)
    await shot(page, 'visuals/code-visual-overview.png', { clip: { x: pg.x, y: pg.y, width: 634, height: 424 } })
    await lumenEval(page, (l) => l.useApp.getState().setZoom(null))
  })
})
