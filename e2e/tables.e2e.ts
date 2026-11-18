/**
 * Table / matrix column sizing (Format ▸ Visual ▸ Layout ▸ Column width, dragging a header edge, the header's
 * Set / Reset column width) and expand / collapse from the visual context menu (matrix rows, hierarchy slicer).
 */
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright-core'
import { useLumen, goToPage, visualByTitle, settle, lumenEval, stubSaveDialog, openFile, untilVisualText, until, waitIdle, deselectAll, dataPaneRow, visualText } from './harness'

/** `visual.objects` / `expansionStates` of a visual on the active page (document state has no DOM form). */
async function visualJson(page: Page, name: string): Promise<{ objects: any; expansionStates: any; projections: Record<string, Array<{ queryRef: string; active?: boolean }>> }> {
  return lumenEval(
    page,
    (l, n) => {
      const s = l.useApp.getState()
      const v = s.project!.report!.pages.find((p) => p.name === s.activePage)!.visuals.find((x) => x.name === n)!.json.visual
      const qs = v.query?.queryState ?? {}
      return {
        objects: JSON.parse(JSON.stringify(v.objects ?? {})),
        expansionStates: JSON.parse(JSON.stringify(v.expansionStates ?? null)),
        projections: Object.fromEntries(Object.keys(qs).map((r) => [r, (qs[r].projections ?? []).map((p: any) => ({ queryRef: p.queryRef, active: p.active }))]))
      }
    },
    name
  )
}

const literal = (raw: any): string | undefined => raw?.expr?.Literal?.Value

/** Header cells (layout px, independent of the canvas zoom) and the scroll viewport of a table / matrix. */
async function columns(vc: Locator): Promise<{ viewport: number; cols: Array<{ ref: string; width: number }>; total: number }> {
  return vc.evaluate((el) => {
    const scroll = el.querySelector<HTMLElement>('.wbi-table-scroll')!
    const cols = Array.from(el.querySelectorAll<HTMLElement>('[role="columnheader"][data-col]')).map((h) => ({ ref: h.dataset.col!, width: h.offsetWidth }))
    return { viewport: scroll.clientWidth, cols, total: cols.reduce((a, c) => a + c.width, 0) }
  })
}

async function openColumnWidthCard(page: Page): Promise<Locator> {
  await page.getByRole('tab', { name: 'Format visual' }).click()
  await page.locator('.wbi-fmt__pivot').getByRole('tab', { name: 'Visual' }).click()
  const card = page.locator('.wbi-fmt__cards > .wbi-card').filter({ has: page.locator(':scope > .wbi-card__header .wbi-card__title', { hasText: /^Layout$/ }) })
  if (!(await card.locator(':scope > .wbi-card__body').count())) await card.locator(':scope > .wbi-card__header').click()
  return card
}

async function pickBehavior(page: Page, card: Locator, label: string): Promise<void> {
  await card.locator('[data-prop="columnAdjustment"] .wbi-dropdown').click()
  await page.getByRole('option', { name: label, exact: true }).click()
}

/** Right-click, then walk the context menu: `['Expand', 'Selection']` hovers Expand and clicks Selection. */
async function contextMenu(page: Page, target: Locator, path: string[]): Promise<void> {
  await target.click({ button: 'right' })
  let scope: Locator = page.locator('.wbi-menu-backdrop > .wbi-menu')
  await scope.waitFor()
  for (let i = 0; i < path.length; i++) {
    const item = scope.locator(':scope > [role^="menuitem"]', { has: page.locator(':scope > .wbi-menu-label', { hasText: new RegExp(`^${path[i]}$`) }) })
    if (i < path.length - 1) {
      await item.hover()
      scope = item.locator(':scope > .wbi-menu')
      await scope.waitFor()
    } else await item.click()
  }
  await page.locator('.wbi-menu-backdrop').waitFor({ state: 'detached' })
}

async function menuLabels(page: Page, target: Locator): Promise<string[]> {
  await target.click({ button: 'right' })
  const menu = page.locator('.wbi-menu-backdrop > .wbi-menu')
  await menu.waitFor()
  const labels = await menu.locator(':scope > [role^="menuitem"] > .wbi-menu-label').allInnerTexts()
  await page.keyboard.press('Escape')
  await page.locator('.wbi-menu-backdrop').waitFor({ state: 'detached' })
  return labels
}

describe('tables and matrices', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('table: auto-size behavior, default width, custom widths, dragging a header edge; saved and reopened', async () => {
    const { page, app, tmp } = lumen()
    await goToPage(page, 'Products')
    const name = await visualByTitle(page, 'Product details')
    const vc = page.locator(`.wbi-page [data-visual="${name}"]`)
    await vc.locator('.wbi-vc-titles').click()
    await expect(lumenEval(page, (l) => l.useApp.getState().selectedVisuals)).resolves.toEqual([name])
    const card = await openColumnWidthCard(page)

    // Fit to content (default): the columns leave free space on the right
    const fit = await columns(vc)
    expect(fit.cols.length).toBeGreaterThanOrEqual(4)
    expect(fit.total).toBeLessThan(fit.viewport - 20)

    // Grow to fit: the columns fill the visual, without a horizontal scrollbar
    await pickBehavior(page, card, 'Grow to fit')
    await expect.poll(async () => (await columns(vc)).total).toBeGreaterThan(fit.viewport - fit.cols.length - 1)
    const grown = await columns(vc)
    expect(grown.total).toBeLessThanOrEqual(grown.viewport)
    expect(literal((await visualJson(page, name)).objects.columnHeaders[0].properties.columnAdjustment)).toBe("'growToFit'")

    // Fixed width: every column takes the Default width
    await pickBehavior(page, card, 'Fixed width')
    const def = card.locator('[data-prop="defaultColumnWidth"] input')
    await def.fill('64')
    await def.press('Enter')
    await expect.poll(async () => (await columns(vc)).cols.map((c) => c.width)).toEqual(fit.cols.map(() => 64))
    expect(literal((await visualJson(page, name)).objects.columnHeaders[0].properties.defaultColumnWidth)).toBe('64D')

    // back to Fit to content: Default width is a Fixed width setting
    await pickBehavior(page, card, 'Fit to content')
    await expect.poll(async () => (await columns(vc)).cols.map((c) => c.width)).toEqual(fit.cols.map((c) => c.width))
    await expect.poll(() => def.count()).toBe(0)

    // drag the right edge of the first column: a custom width (columnWidth, selector.metadata = the column's queryRef)
    const first = fit.cols[0]
    const header = vc.locator(`[role="columnheader"][data-col="${first.ref}"]`)
    const handle = header.locator('.wbi-table-resize')
    const hb = (await handle.boundingBox())!
    const zoom = (await header.boundingBox())!.width / first.width
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
    await page.mouse.down()
    await page.mouse.move(hb.x + hb.width / 2 + 30, hb.y + hb.height / 2, { steps: 4 })
    await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2, { steps: 4 })
    await page.mouse.up()
    const dragged = first.width + Math.round(60 / zoom)
    await expect.poll(async () => (await columns(vc)).cols[0].width).toBe(dragged)
    const stored = (await visualJson(page, name)).objects.columnWidth
    expect(stored).toEqual([{ properties: { value: { expr: { Literal: { Value: `${dragged}D` } } } }, selector: { metadata: first.ref } }])
    // the visual wasn't moved by the drag, and the other columns kept their width
    expect((await columns(vc)).cols.slice(1).map((c) => c.width)).toEqual(fit.cols.slice(1).map((c) => c.width))
    // the Format pane shows it as a custom width
    const input = card.locator(`[data-width-for="${first.ref}"] input`)
    await expect.poll(() => input.inputValue()).toBe(String(dragged))

    // Undo / Redo
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(async () => (await columns(vc)).cols[0].width).toBe(first.width)
    expect((await visualJson(page, name)).objects.columnWidth).toBeUndefined()
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect.poll(async () => (await columns(vc)).cols[0].width).toBe(dragged)

    // a custom width typed in the pane; clearing the input goes back to (auto)
    const second = fit.cols[1]
    const input2 = card.locator(`[data-width-for="${second.ref}"] input`)
    await input2.fill('150')
    await input2.press('Enter')
    await expect.poll(async () => (await columns(vc)).cols[1].width).toBe(150)
    await input2.fill('')
    await input2.press('Enter')
    await expect.poll(async () => (await columns(vc)).cols[1].width).toBe(second.width)

    // double-click the edge: fit the column to its content
    await handle.dblclick()
    await expect.poll(async () => (await columns(vc)).cols[0].width).toBe(first.width)
    expect(literal((await visualJson(page, name)).objects.columnWidth[0].properties.value)).toBe(`${first.width}D`)

    // header context menu: Set column width / Reset column width
    await contextMenu(page, header, ['Set column width'])
    const dialog = page.getByRole('dialog', { name: 'Set column width' })
    await dialog.locator('input').fill('210')
    await dialog.getByRole('button', { name: 'OK' }).click()
    await expect.poll(async () => (await columns(vc)).cols[0].width).toBe(210)

    // Save As and reopen: the custom width is still there
    const target = join(tmp, 'widths', 'Widths.wbi')
    await stubSaveDialog(app, target)
    expect(await lumenEval(page, (l) => l.saveAs('wbi'))).toBe(true)
    await openFile(page, target)
    await goToPage(page, 'Products')
    await settle(page)
    const reopened = page.locator(`.wbi-page [data-visual="${name}"]`)
    await expect.poll(async () => (await columns(reopened)).cols[0].width).toBe(210)
    expect((await visualJson(page, name)).objects.columnWidth).toEqual([{ properties: { value: { expr: { Literal: { Value: '210D' } } } }, selector: { metadata: first.ref } }])

    // Reset column width (header menu), then Custom widths off clears everything
    await contextMenu(page, reopened.locator(`[role="columnheader"][data-col="${first.ref}"]`), ['Reset column width'])
    await expect.poll(async () => (await columns(reopened)).cols[0].width).toBe(first.width)
    expect((await visualJson(page, name)).objects.columnWidth).toBeUndefined()
  })

  it('matrix: expand / collapse from the context menu, row-header width by dragging', async () => {
    const { page } = lumen()
    await goToPage(page, 'Products')
    const name = await visualByTitle(page, 'Sales and margin by category and year')
    const vc = page.locator(`.wbi-page [data-visual="${name}"]`)
    const rowHeader = (label: string) => vc.locator('.wbi-table-scroll span', { hasText: new RegExp(`^${label}$`) }).first()
    // the sample matrix opens with every category expanded
    const before = await visualText(page, name)
    expect(before).toMatch(/Accessories[\s\S]*Helmets[\s\S]*Bikes[\s\S]*Road Bikes/)
    expect(await menuLabels(page, rowHeader('Accessories'))).toEqual(expect.arrayContaining(['Show as a table', 'Show data point as a table', 'Include', 'Exclude', 'Expand', 'Collapse', 'Drill down', 'Drill up', 'Show next level', 'Expand to next level', 'Copy', 'Sort by', 'Export data', 'Spotlight']))

    // Collapse ▸ Selection: only that category's subcategories go away
    await contextMenu(page, rowHeader('Accessories'), ['Collapse', 'Selection'])
    await untilVisualText(page, name, (t) => !/Helmets/.test(t) && /Road Bikes/.test(t))
    let json = await visualJson(page, name)
    const rows = json.projections.Rows.map((p) => p.queryRef)
    const st = json.expansionStates.find((s: any) => s.roles.includes('Rows'))
    expect(st.levels.map((l: any) => [l.queryRefs, l.isCollapsed === true])).toEqual([[[rows[0]], false], [[rows[1]], true]])
    expect(st.root.children).toEqual([{ identityValues: [{ Literal: { Value: "'Accessories'" } }], isToggled: true }])

    // Collapse ▸ Entire level: every category collapses; Expand ▸ Selection re-opens one
    await contextMenu(page, rowHeader('Bikes'), ['Collapse', 'Entire level'])
    await untilVisualText(page, name, (t) => !/Helmets/.test(t) && !/Road Bikes/.test(t) && /Bikes/.test(t))
    json = await visualJson(page, name)
    expect(json.expansionStates.find((s: any) => s.roles.includes('Rows')).levels[0].isCollapsed).toBe(true)
    expect(json.projections.Rows.map((p) => !!p.active)).toEqual([true, false])
    await contextMenu(page, rowHeader('Bikes'), ['Expand', 'Selection'])
    await untilVisualText(page, name, (t) => /Road Bikes/.test(t) && !/Helmets/.test(t))
    expect((await visualJson(page, name)).projections.Rows.map((p) => !!p.active)).toEqual([true, true])

    // Expand ▸ All restores the original view; Undo steps back
    await contextMenu(page, rowHeader('Accessories'), ['Expand', 'All'])
    await untilVisualText(page, name, (t) => t === before)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await untilVisualText(page, name, (t) => /Road Bikes/.test(t) && !/Helmets/.test(t))
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await untilVisualText(page, name, (t) => t === before)

    // +/- icon on a row still toggles one node
    await vc.locator('[aria-label="Collapse"]').first().click()
    await untilVisualText(page, name, (t) => !/Helmets/.test(t) && /Road Bikes/.test(t))
    await vc.locator('[aria-label="Expand"]').first().click()
    await untilVisualText(page, name, (t) => t === before)

    // row-header column: drag the corner's edge (the visual must be selected to edit it)
    await vc.locator('.wbi-vc-titles').click()
    const corner = vc.locator(`[role="columnheader"][data-col="${rows[0]}"]`)
    const w0 = await corner.evaluate((e) => (e as HTMLElement).offsetWidth)
    const zoom = (await corner.boundingBox())!.width / w0
    const hb = (await corner.locator('.wbi-table-resize').boundingBox())!
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
    await page.mouse.down()
    await page.mouse.move(hb.x + hb.width / 2 + 40, hb.y + hb.height / 2, { steps: 5 })
    await page.mouse.up()
    const w1 = w0 + Math.round(40 / zoom)
    await expect.poll(() => corner.evaluate((e) => (e as HTMLElement).offsetWidth)).toBe(w1)
    expect((await visualJson(page, name)).objects.columnWidth).toEqual([{ properties: { value: { expr: { Literal: { Value: `${w1}D` } } } }, selector: { metadata: rows[0] } }])
    // row headers stay frozen while the values scroll horizontally
    const scrolled = await vc.evaluate((el) => {
      const s = el.querySelector<HTMLElement>('.wbi-table-scroll')!
      s.scrollLeft = 80
      return s.scrollLeft
    })
    if (scrolled > 0) expect((await corner.boundingBox())!.x).toBeCloseTo((await vc.locator('.wbi-table-scroll').boundingBox())!.x, 0)
    await settle(page)
  })

  it('hierarchy slicer: Expand ▸ / Collapse ▸ (Selection, Entire level, All), Search and Clear selections from the context menu', async () => {
    const { page } = lumen()
    // a new page with a slicer on Category ▸ Subcategory
    await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
    await page.locator('.wbi-tab-add').click()
    await waitIdle(page)
    await page.getByRole('tab', { name: 'Build visual' }).click()
    await deselectAll(page)
    await page.getByRole('listbox', { name: 'Visual types' }).getByRole('option', { name: /^Slicer$/ }).first().click()
    const name = await until(page, () => window.__lumen!.useApp.getState().selectedVisuals[0])
    for (const field of ['Category', 'Subcategory']) await (await dataPaneRow(page, ['Product', field])).locator('.wbi-dtree__check input, .wbi-dtree__check [role="checkbox"]').first().click()
    const vc = page.locator(`.wbi-page [data-visual="${name}"]`)
    const item = (label: string) => vc.getByRole('option', { name: label, exact: true })
    await item('Bikes').waitFor()
    // collapsed by default: no subcategory is listed
    await expect.poll(() => item('Road Bikes').count()).toBe(0)

    // the user's report: right-clicking the slicer offered no expand / collapse
    expect(await menuLabels(page, item('Bikes'))).toEqual(expect.arrayContaining(['Show as a table', 'Expand', 'Collapse', 'Search', 'Clear selections', 'Copy', 'Sort axis', 'Export data', 'Spotlight']))

    await contextMenu(page, item('Bikes'), ['Expand', 'Selection'])
    await item('Road Bikes').waitFor()
    await expect.poll(() => item('Helmets').count()).toBe(0)
    let st = (await visualJson(page, name)).expansionStates.find((s: any) => s.roles.includes('Values'))
    expect(st.levels.map((l: any) => l.isCollapsed)).toEqual([true, true])
    expect(st.root.children).toEqual([{ identityValues: [{ Literal: { Value: "'Bikes'" } }], isToggled: true }])

    await contextMenu(page, item('Bikes'), ['Expand', 'Entire level'])
    await item('Helmets').waitFor()
    st = (await visualJson(page, name)).expansionStates.find((s: any) => s.roles.includes('Values'))
    expect(st.levels[0].isCollapsed).toBeUndefined()
    expect(st.root.children).toBeUndefined()

    await contextMenu(page, item('Accessories'), ['Collapse', 'Selection'])
    await expect.poll(() => item('Helmets').count()).toBe(0)
    await item('Road Bikes').waitFor()

    await contextMenu(page, item('Road Bikes'), ['Collapse', 'All'])
    await expect.poll(() => item('Road Bikes').count()).toBe(0)
    await contextMenu(page, item('Bikes'), ['Expand', 'All'])
    await item('Helmets').waitFor()
    await item('Road Bikes').waitFor()

    // the +/- icon edits the same saved state; Undo brings the node back
    await item('Bikes').locator('span').first().click()
    await expect.poll(() => item('Road Bikes').count()).toBe(0)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await item('Road Bikes').waitFor()

    // Search (More options ▸ Search) shows / hides the search box
    await expect.poll(() => vc.locator('input[placeholder="Search"]').count()).toBe(0)
    await contextMenu(page, item('Bikes'), ['Search'])
    await vc.locator('input[placeholder="Search"]').waitFor()
    expect(literal((await visualJson(page, name)).objects.general[0].properties.selfFilterEnabled)).toBe('true')
    await contextMenu(page, item('Bikes'), ['Search'])
    await expect.poll(() => vc.locator('input[placeholder="Search"]').count()).toBe(0)

    // Clear selections
    await item('Helmets').click()
    await expect.poll(() => item('Helmets').getAttribute('aria-selected')).toBe('true')
    await contextMenu(page, item('Bikes'), ['Clear selections'])
    await expect.poll(() => item('Helmets').getAttribute('aria-selected')).toBe('false')
    await settle(page)
  })
})
