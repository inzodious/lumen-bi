/**
 * Code visual: insert from the gallery with a template, bind fields, edit CSS in the editor (preview, canvas, undo /
 * redo), container queries on resize, cross-filtering in both directions with native visuals (card, bar chart, table,
 * slicer), drill-down (header icons, data-drill, breadcrumb, drill up, expand), save as PBIP and reopen, PDF export.
 * The sandbox and protocol attacks are in codevisual-security.e2e.ts.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { FrameLocator, Page } from 'playwright-core'
import { useLumen, waitIdle, settle, lumenEval, dataPaneRow, deselectAll, clickShape, untilVisualText, visualText, stubSaveDialog, untilNode } from './harness'

const TYPE = 'lumenCodeVisualC0DE5A1E7B3F4E2A9D6C8B1F0E4A7D3C'

const col = (t: string, c: string, extra: Record<string, unknown> = {}) => ({ field: { Column: { Expression: { SourceRef: { Entity: t } }, Property: c } }, queryRef: `${t}.${c}`, nativeQueryRef: c, ...extra })
const mea = (m: string) => ({ field: { Measure: { Expression: { SourceRef: { Entity: '_Measures' } }, Property: m } }, queryRef: `_Measures.${m}`, nativeQueryRef: m })

/** Native visuals the code visual talks to (setup, not under test). */
async function addNativeVisuals(page: Page): Promise<void> {
  await lumenEval(
    page,
    (l, v: any) => {
      const s = l.useApp.getState()
      s.mutateReport('setup', (r: any) => {
        const p = r.pages.find((x: any) => x.name === s.activePage)
        const add = (name: string, rect: number[], visual: any) =>
          p.visuals.push({ name, json: { name, position: { x: rect[0], y: rect[1], z: 100, width: rect[2], height: rect[3], tabOrder: 100 }, visual: { drillFilterOtherVisuals: true, ...visual } } })
        add('nativecard', [16, 16, 220, 96], { visualType: 'cardVisual', query: { queryState: { Data: { projections: [v.sales] } } } })
        add('nativebar', [16, 124, 360, 240], { visualType: 'barChart', query: { queryState: { Category: { projections: [v.region] }, Y: { projections: [v.sales] } } } })
        add('nativetable', [16, 376, 360, 200], { visualType: 'tableEx', query: { queryState: { Values: { projections: [v.category, v.sales] } } } })
        add('nativeslicer', [250, 16, 200, 100], { visualType: 'slicer', query: { queryState: { Values: { projections: [v.storeType] } } }, objects: { data: [{ properties: { mode: { expr: { Literal: { Value: "'Basic'" } } } } }] } })
      })
    },
    { sales: mea('Total Sales'), region: col('Region', 'Region', { active: true }), category: col('Product', 'Category'), storeType: col('Store', 'Store Type', { active: true }) }
  )
}

function frameOf(page: Page, visual: string): FrameLocator {
  return page.frameLocator(`.wbi-page [data-visual="${visual}"] iframe.wbi-codevisual__frame`)
}

async function codeVisualName(page: Page): Promise<string> {
  return lumenEval(page, (l, t) => {
    const s = l.useApp.getState()
    return s.project!.report!.pages.find((p) => p.name === s.activePage)!.visuals.find((v) => v.json.visual?.visualType === t)?.name ?? ''
  }, TYPE)
}

async function rendered(page: Page, visual: string): Promise<void> {
  await page.waitForFunction((v) => document.querySelector(`.wbi-page [data-visual="${v}"] .wbi-codevisual`)?.getAttribute('data-code-state') === 'rendered', visual, { timeout: 30_000 })
}

/** computed style of the first match inside a frame */
async function frameStyle(frame: FrameLocator, selector: string, prop: string): Promise<string> {
  return frame.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop)
}

/**
 * Click an element inside a code visual's frame with the real mouse. Coordinates are computed here because the page
 * is zoomed (CSS transform) and Playwright maps out-of-process frame coordinates without that scale.
 */
async function clickInFrame(page: Page, visual: string, selector: string, opts: { hasText?: string; modifiers?: Array<'Control' | 'Shift'>; at?: { x: number; y: number } } = {}): Promise<void> {
  const frame = frameOf(page, visual)
  let loc = frame.locator(selector)
  if (opts.hasText) loc = loc.filter({ hasText: opts.hasText })
  const r = await loc.first().evaluate((el) => {
    const b = el.getBoundingClientRect()
    return { x: b.left, y: b.top, w: b.width, h: b.height }
  })
  const iframe = page.locator(`.wbi-page [data-visual="${visual}"] iframe.wbi-codevisual__frame`)
  const fb = (await iframe.boundingBox())!
  const inner = await iframe.evaluate((el) => (el as HTMLElement).offsetWidth)
  const scale = fb.width / inner
  const px = opts.at ? r.x + opts.at.x : r.x + r.w / 2
  const py = opts.at ? r.y + opts.at.y : r.y + r.h / 2
  const x = fb.x + px * scale
  const y = fb.y + py * scale
  await page.mouse.move(x, y)
  for (const m of opts.modifiers ?? []) await page.keyboard.down(m)
  await page.mouse.click(x, y)
  for (const m of opts.modifiers ?? []) await page.keyboard.up(m)
}

/** Index of the widest filled rect of a native chart (a bar). */
async function widestBar(page: Page, visual: string): Promise<number> {
  return page.evaluate((v) => {
    const rs = Array.from(document.querySelectorAll<SVGRectElement>(`.wbi-page [data-visual="${v}"] svg rect`))
    let best = 0
    let w = 0
    rs.forEach((r, i) => {
      const bw = Number(r.getAttribute('width'))
      const f = r.getAttribute('fill')
      if (bw > w && f && f !== 'none' && f !== 'transparent') {
        w = bw
        best = i
      }
    })
    return best
  }, visual)
}

const crossFilter = (page: Page) => lumenEval(page, (l) => {
  const s = l.useApp.getState()
  const cf = l.useInteraction.getState().crossFilter[s.activePage!]
  return cf ? { source: cf.source, n: cf.identities.length, values: cf.identities.map((i) => i.fields.map((f) => f.value).join('/')) } : null
})

describe('code visual', () => {
  const lumen = useLumen({ route: { sample: '1' } })
  let cv = ''
  let total = ''

  it('inserts from the gallery with a template and binds fields from the Data pane', async () => {
    const { page } = lumen()
    await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
    await page.locator('.wbi-tab-add').click()
    await waitIdle(page)
    await addNativeVisuals(page)
    await settle(page)
    total = await untilVisualText(page, 'nativecard', (t) => /\$/.test(t))
    await deselectAll(page)
    await page.getByRole('tab', { name: 'Build visual' }).click()
    await page.getByRole('listbox', { name: 'Visual types' }).getByRole('option', { name: 'Code visual', exact: true }).click()
    // the template picker
    const picker = page.getByRole('dialog', { name: 'New code visual' })
    await picker.getByRole('option', { name: 'Bar list (drill and select)' }).click()
    await picker.getByRole('button', { name: 'Insert' }).click()
    await expect.poll(() => codeVisualName(page)).not.toBe('')
    cv = await codeVisualName(page)
    // place it right of the native visuals (setup)
    await lumenEval(page, (l, n) => {
      const s = l.useApp.getState()
      s.mutateReport('place', (r: any) => {
        const v = r.pages.find((p: any) => p.name === s.activePage).visuals.find((x: any) => x.name === n)
        v.json.position = { ...v.json.position, x: 480, y: 124, width: 460, height: 360 }
      })
    }, cv)
    await page.locator(`.wbi-page [data-visual="${cv}"]`).click({ position: { x: 20, y: 20 } })
    // bind: a three-level hierarchy to Rows, a measure to Values (real drag and drop)
    const well = (title: string) => page.locator('.wbi-well').filter({ has: page.locator('.wbi-well__title', { hasText: new RegExp(`^${title}$`) }) }).first().locator('.wbi-well__drop')
    for (const f of ['Category', 'Subcategory', 'Product']) await (await dataPaneRow(page, ['Product', f])).dragTo(well('Rows'))
    await (await dataPaneRow(page, ['_Measures', 'Sales', 'Total Sales'])).dragTo(well('Values'))
    await settle(page)
    await rendered(page, cv)
    const frame = frameOf(page, cv)
    await expect.poll(() => frame.locator('.bl__row').count()).toBe(4)
    expect(await frame.locator('.bl__title').innerText()).toBe('Total Sales')
    expect(await frame.locator('.bl__by').innerText()).toBe('by Category')
    // the report's Segoe UI stand-in is the font inside the frame
    expect(await frameStyle(frame, '.bl__label', 'font-family')).toMatch(/Segoe UI/)
    // rows carry the CSS variables of their values
    expect(Number(await frameStyle(frame, '.bl__row', '--pct-of-max'))).toBe(1)
  })

  it('edits CSS in the editor: the preview follows as you type, Apply changes the canvas, undo / redo', async () => {
    const { page } = lumen()
    const frame = frameOf(page, cv)
    const blue = await frameStyle(frame, '.bl__fill', 'background-color')
    // open the editor from the visual's context menu
    const box = (await page.locator(`.wbi-page [data-visual="${cv}"] .wbi-codevisual`).boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + 12, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Edit code' }).click()
    const dlg = page.getByRole('dialog', { name: 'Edit code' })
    await expect.poll(() => dlg.isVisible()).toBe(true)
    await dlg.getByRole('tab', { name: 'CSS' }).click()
    const editor = dlg.locator('.wbi-cve__editor:not([hidden]) .cm-content')
    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\n.bl__fill { background: rgb(214, 69, 84); }')
    const preview = dlg.frameLocator('.wbi-cve__visual iframe')
    await expect.poll(() => frameStyle(preview, '.bl__fill', 'background-color')).toBe('rgb(214, 69, 84)')
    // not applied yet
    expect(await frameStyle(frame, '.bl__fill', 'background-color')).toBe(blue)
    // the Data tab lists what the code receives
    await dlg.getByRole('tab', { name: 'Data' }).click()
    await expect.poll(() => dlg.locator('.wbi-cve__data').innerText()).toContain('--total-sales-text')
    await dlg.getByRole('button', { name: 'Apply' }).click()
    await expect.poll(() => frameStyle(frame, '.bl__fill', 'background-color')).toBe('rgb(214, 69, 84)')
    await dlg.locator('.wbi-modal__footer').getByRole('button', { name: 'Close' }).click()
    await expect.poll(() => dlg.count()).toBe(0)
    // undo / redo: one step for the applied change
    expect(await lumenEval(page, (l) => l.useApp.getState().undoStack.at(-1)?.label)).toBe('Edit code')
    await page.locator('.wbi-titlebar').getByRole('button', { name: /^Undo/ }).click()
    await expect.poll(() => frameStyle(frame, '.bl__fill', 'background-color')).toBe(blue)
    await page.locator('.wbi-titlebar').getByRole('button', { name: /^Redo/ }).click()
    await expect.poll(() => frameStyle(frame, '.bl__fill', 'background-color')).toBe('rgb(214, 69, 84)')
  })

  it('switches layout with a container query when the visual is resized', async () => {
    const { page } = lumen()
    const frame = frameOf(page, cv)
    expect(await frameStyle(frame, '.bl__track', 'grid-row-start')).toBe('auto')
    await page.locator(`.wbi-page [data-visual="${cv}"]`).click({ position: { x: 20, y: 20 } })
    const vc = (await page.locator(`.wbi-page [data-visual="${cv}"]`).boundingBox())!
    const pageW = await lumenEval(page, (l, n) => {
      const s = l.useApp.getState()
      return s.project!.report!.pages.find((p) => p.name === s.activePage)!.visuals.find((v) => v.name === n)!.json.position.width as number
    }, cv)
    const scale = vc.width / pageW
    const handle = (await page.locator('.wbi-handle.h-e').boundingBox())!
    // to about 230 page px wide (the template goes narrow below 280 px)
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2 - (pageW - 230) * scale, handle.y + handle.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => frameStyle(frame, '.bl__track', 'grid-row-start')).toBe('2')
    // --width follows the container
    expect(parseFloat(await frame.locator('#lumen-root').evaluate((el) => getComputedStyle(el).getPropertyValue('--width')))).toBeLessThan(280)
    await page.locator('.wbi-titlebar').getByRole('button', { name: /^Undo/ }).click()
    await expect.poll(() => frameStyle(frame, '.bl__track', 'grid-row-start')).toBe('auto')
  })

  it('a clicked row cross-filters the card and the table and highlights the bar chart; Ctrl+click adds; empty space clears', async () => {
    const { page } = lumen()
    const frame = frameOf(page, cv)
    await deselectAll(page)
    const barBefore = await page.locator('.wbi-page [data-visual="nativebar"]').innerHTML()
    await clickInFrame(page, cv, '.bl__row', { hasText: 'Bikes' })
    await expect.poll(() => crossFilter(page)).toEqual({ source: cv, n: 1, values: ['Bikes'] })
    const bikes = await untilVisualText(page, 'nativecard', (t) => t !== total && /\$/.test(t))
    await expect.poll(() => visualText(page, 'nativetable')).not.toMatch(/Clothing/)
    expect(await visualText(page, 'nativetable')).toMatch(/Bikes/)
    // the bar chart cross-highlights (same identity as a native chart's data point)
    await expect.poll(() => page.locator('.wbi-page [data-visual="nativebar"]').innerHTML()).not.toBe(barBefore)
    // this visual marks its own selection
    await expect.poll(() => frame.locator('.bl__row[data-selected="true"]').count()).toBe(1)
    expect(await frame.locator('.bl__row[data-selected="false"]').count()).toBe(3)
    // Ctrl+click adds a second row
    await clickInFrame(page, cv, '.bl__row', { hasText: 'Clothing', modifiers: ['Control'] })
    await expect.poll(async () => (await crossFilter(page))?.n).toBe(2)
    await untilVisualText(page, 'nativecard', (t) => t !== bikes && t !== total)
    // a click on empty space in the visual clears the selection
    await clickInFrame(page, cv, '.bl__head', { at: { x: 300, y: 8 } })
    await expect.poll(() => crossFilter(page)).toBeNull()
    await untilVisualText(page, 'nativecard', (t) => t === total)
  })

  it('a bar in the native chart and a table row cross-highlight the code visual; a slicer filters it', async () => {
    const { page } = lumen()
    const frame = frameOf(page, cv)
    const firstValue = await frame.locator('.bl__value').first().innerText()
    await clickShape(page, 'nativebar', 'svg rect', await widestBar(page, 'nativebar'))
    await expect.poll(async () => (await crossFilter(page))?.source).toBe('nativebar')
    await expect.poll(() => frame.locator('#lumen-root').getAttribute('data-has-highlight')).toBe('true')
    await expect.poll(() => frame.locator('.bl__row[data-highlighted]').count()).toBe(4)
    // highlight values reach the CSS (the solid part of each bar)
    const hl = Number(await frameStyle(frame, '.bl__row', '--highlight-pct-of-max'))
    expect(hl).toBeGreaterThan(0)
    expect(hl).toBeLessThan(1)
    expect(await frame.locator('.bl__hl').count()).toBe(4)
    // clear: the bar chart's background
    const bb = (await page.locator('.wbi-page [data-visual="nativebar"] .wbi-vc-content svg').first().boundingBox())!
    await page.mouse.click(bb.x + bb.width - 4, bb.y + bb.height - 4)
    await expect.poll(() => crossFilter(page)).toBeNull()
    await expect.poll(() => frame.locator('#lumen-root').getAttribute('data-has-highlight')).toBe('false')
    // slicer: the code visual re-queries with the slicer's filter
    const slicer = page.locator('.wbi-page [data-visual="nativeslicer"]')
    await slicer.getByRole('option').first().click()
    await expect.poll(() => frame.locator('.bl__value').first().innerText()).not.toBe(firstValue)
    // a second click on the item clears it (the header icons of the slicer cover its eraser while hovered)
    await slicer.getByRole('option').first().click()
    await expect.poll(() => frame.locator('.bl__value').first().innerText()).toBe(firstValue)
    // a table row: the code visual cross-highlights the same category (Bikes highlighted, the others not)
    const bikesCell = page.locator('.wbi-page [data-visual="nativetable"] .wbi-vc-content').getByText('Bikes', { exact: true })
    await bikesCell.click()
    await expect.poll(async () => (await crossFilter(page))?.source).toBe('nativetable')
    await expect.poll(() => frame.locator('.bl__row[data-highlighted="true"]').count()).toBe(1)
    expect(await frame.locator('.bl__row[data-highlighted="true"] .bl__label').innerText()).toBe('Bikes')
    expect(await frame.locator('.bl__row[data-highlighted="false"]').count()).toBe(3)
    await bikesCell.click()
    await expect.poll(() => crossFilter(page)).toBeNull()
  })

  it('drills down with data-drill and the header icons, shows the breadcrumb, drills up, expands, and cross-filters from a drilled level', async () => {
    const { page } = lumen()
    const frame = frameOf(page, cv)
    // data-drill on the Bikes row
    await clickInFrame(page, cv, '.bl__row:has-text("Bikes") [data-drill]')
    await expect.poll(() => frame.locator('.bl__by').innerText()).toBe('by Subcategory')
    await expect.poll(() => frame.locator('.bl__path').innerText()).toBe('Bikes')
    expect(await frame.locator('#lumen-root').getAttribute('data-level')).toBe('1')
    const subcats = await frame.locator('.bl__label').allInnerTexts()
    expect(subcats.length).toBeGreaterThan(0)
    // the drill state is saved with the visual (undoable)
    expect(await lumenEval(page, (l) => l.useApp.getState().undoStack.at(-1)?.label)).toBe('Drill down')
    // select a row at the drilled level: the native card cross-filters to it
    await clickInFrame(page, cv, '.bl__row')
    await expect.poll(async () => (await crossFilter(page))?.values).toEqual([subcats[0]])
    await untilVisualText(page, 'nativecard', (t) => t !== total)
    await clickInFrame(page, cv, '.bl__head', { at: { x: 300, y: 8 } })
    await expect.poll(() => crossFilter(page)).toBeNull()
    // data-drill-up (the back arrow)
    await clickInFrame(page, cv, '[data-drill-up]')
    await expect.poll(() => frame.locator('.bl__by').innerText()).toBe('by Category')
    expect(await frame.locator('.bl__path').count()).toBe(0)
    // header icons: turn on drill mode, then a click on a row drills
    const header = page.locator(`.wbi-vh[data-visual-header="${cv}"]`)
    const hover = () => page.locator(`.wbi-page [data-visual="${cv}"]`).hover({ position: { x: 30, y: 30 } })
    // the header re-renders while the visual updates: click it by position
    const headerClick = async (name: string) => {
      await hover()
      const b = (await header.getByRole('button', { name, exact: true }).boundingBox())!
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
    }
    await headerClick('Click to turn on Drill down')
    await clickInFrame(page, cv, '.bl__row', { hasText: 'Clothing' })
    await expect.poll(() => frame.locator('.bl__path').innerText()).toBe('Clothing')
    expect(await crossFilter(page)).toBeNull()
    await headerClick('Drill up')
    await expect.poll(() => frame.locator('.bl__by').innerText()).toBe('by Category')
    await headerClick('Drill down is on')
    // go to the next level (header icon)
    await headerClick('Go to the next level in the hierarchy')
    await expect.poll(() => frame.locator('.bl__by').innerText()).toBe('by Subcategory')
    await clickInFrame(page, cv, '[data-drill-up]')
    await expect.poll(() => frame.locator('.bl__by').innerText()).toBe('by Category')
    // expand all down one level: parents and children with depth
    await headerClick('Expand all down one level in the hierarchy')
    await expect.poll(() => frame.locator('.bl__row[data-depth="1"]').count()).toBeGreaterThan(0)
    expect(await frame.locator('.bl__row[data-depth="0"]').count()).toBe(4)
    await clickInFrame(page, cv, '[data-drill-up]')
    await expect.poll(() => frame.locator('.bl__row[data-depth="1"]').count()).toBe(0)
  })

  it('saves as PBIP with the code beside visual.json and reopens with the drill state', async () => {
    const { page, app, tmp } = lumen()
    const frame = frameOf(page, cv)
    await clickInFrame(page, cv, '.bl__row:has-text("Bikes") [data-drill]')
    await expect.poll(() => frame.locator('.bl__path').innerText()).toBe('Bikes')
    const pageName = await lumenEval(page, (l) => l.useApp.getState().activePage!)
    const target = join(tmp, 'CodeVisual.pbip')
    await stubSaveDialog(app, target)
    await lumenEval(page, (l) => l.saveAs('pbip'))
    const vdir = join(tmp, 'CodeVisual.Report', 'definition', 'pages', pageName, 'visuals', cv)
    await untilNode(() => existsSync(join(vdir, 'code.html')), 30_000, 'code files')
    expect(readdirSync(vdir).sort()).toEqual(['code.css', 'code.html', 'visual.json'])
    expect(readFileSync(join(vdir, 'code.css'), 'utf8')).toContain('rgb(214, 69, 84)')
    const vj = JSON.parse(readFileSync(join(vdir, 'visual.json'), 'utf8'))
    expect(vj.visual.visualType).toBe(TYPE)
    expect(vj.visual.objects.lumenCode[0].properties.drill).toBeDefined()
    expect(statSync(join(vdir, 'code.html')).size).toBeGreaterThan(100)
    // reopen: still editable, drill state restored
    await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
    await lumenEval(page, (l, p) => l.openPath(p, { skipConfirm: true }), target)
    await waitIdle(page)
    await lumenEval(page, (l, p) => l.useApp.getState().setActivePage(p), pageName)
    await waitIdle(page)
    await rendered(page, cv)
    await expect.poll(() => frameOf(page, cv).locator('.bl__path').innerText()).toBe('Bikes')
    expect(await frameOf(page, cv).locator('.bl__by').innerText()).toBe('by Subcategory')
    // a PBIP holds no data: the visual shows its empty state with the applied CSS loaded from code.css
    expect(await frameOf(page, cv).locator('#lumen-author').evaluate((el) => el.textContent)).toContain('rgb(214, 69, 84)')
  })

  it('exports to PDF with the code visual drawn', async () => {
    const { page, tmp } = lumen()
    const pageName = await lumenEval(page, (l) => l.useApp.getState().activePage!)
    const pdf = join(tmp, 'code.pdf')
    await lumenEval(page, (l, a) => l.exportReport('pdf', { path: a.pdf, pages: [a.pageName] }), { pdf, pageName })
    await untilNode(() => existsSync(pdf) && statSync(pdf).size > 1000, 60_000, 'PDF')
    await waitIdle(page)
    const txt = spawnSync('pdftotext', [pdf, '-'], { encoding: 'utf8' })
    if (txt.status === 0) {
      expect(txt.stdout).toContain('by Subcategory')
      expect(txt.stdout).toContain('Total Sales')
    }
  })
})
