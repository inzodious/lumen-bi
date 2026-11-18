/**
 * Built-in icons (React components of Lucide via react-icons, and Fluent Color): Insert ▸ Icon opens the picker
 * (search, keyboard, Lucide colour + stroke width), the icon lands on the canvas as an image visual centred in view;
 * a Fluent Color icon too; a card's callout image takes an icon through its Image source without clipping the card's
 * label; Save As PBIP writes the pictures + the Lumen_Icon annotation, and after reopening the icons are still editable.
 * `LUMEN_E2E_SHOTS=<dir>` additionally saves screenshots of the picker, the canvas and the Format pane.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright-core'
import { useLumen, lumenEval, openFile, settle, stubSaveDialog, untilNode, visualsOfType, waitIdle } from './harness'

const SHOTS = process.env['LUMEN_E2E_SHOTS'] ?? ''

async function shot(page: Page, name: string, el?: Locator): Promise<void> {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await (el ?? page).screenshot({ path: join(SHOTS, `${name}.png`) })
}

async function fileMenu(page: Page, item: string): Promise<void> {
  await page.locator('.wbi-ribbon').getByRole('button', { name: 'File', exact: true }).first().click()
  const bs = page.getByRole('dialog', { name: 'File' })
  await bs.locator('.wbi-backstage__item', { hasText: new RegExp(`^${item}$`) }).click()
}

/** Pick a theme swatch in the colour popover of the picker's colour button `label`. */
async function pickThemeColor(page: Page, scope: Locator, label: string, swatch: string): Promise<void> {
  await scope.getByRole('button', { name: label, exact: true }).click()
  await page.locator(`.wbi-colorpop__sw[title^="${swatch},"]`).first().click()
  await expect.poll(() => page.locator('.wbi-colorpop').count()).toBe(0)
}

/** Lumen_Icon bindings of a visual (from the document store). */
async function bindings(page: Page, visual: string): Promise<any[]> {
  return lumenEval(
    page,
    (l, name) => {
      for (const p of l.useApp.getState().project!.report!.pages) {
        const v = p.visuals.find((x) => x.name === name)
        const a = v?.json.annotations?.find((x: any) => x.name === 'Lumen_Icon')
        if (a) return JSON.parse(a.value).icons
      }
      return []
    },
    visual
  )
}

async function openFormatCard(page: Page, title: RegExp): Promise<Locator> {
  await page.getByRole('tab', { name: 'Format visual' }).click()
  await page.locator('.wbi-fmt__pivot').getByRole('tab', { name: 'Visual' }).click()
  const card = page.locator('.wbi-fmt__cards .wbi-card').filter({ has: page.locator('.wbi-card__title', { hasText: title }) }).first()
  if (!(await card.locator('.wbi-card__body').count())) await card.locator('.wbi-card__header').first().click()
  return card
}

describe('built-in icons', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('insert Lucide and Fluent Color icons, style them, put an icon on a card, save, reopen and edit again', async () => {
    const { page, app, tmp } = lumen()
    const imagesBefore = await visualsOfType(page, 'image')

    // ---- Insert ▸ Icon opens the picker; Escape closes it without inserting
    await page.locator('.wbi-ribbon').getByRole('tab', { name: 'Insert' }).click()
    await page.locator('.wbi-ribbon').getByRole('button', { name: 'Icon', exact: true }).click()
    const dlg = page.getByRole('dialog', { name: 'Insert icon' })
    await dlg.waitFor()
    await page.keyboard.press('Escape')
    await expect.poll(() => dlg.count()).toBe(0)
    expect(await visualsOfType(page, 'image')).toEqual(imagesBefore)
    // the Image button's menu offers Icon too
    await page.locator('.wbi-ribbon').getByRole('button', { name: 'Image options', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Icon…' }).click()
    await dlg.waitFor()
    // two sets; the curated category is the default view and lists business icons
    await expect(dlg.getByRole('tab').allInnerTexts()).resolves.toEqual(['Lucide', 'Fluent Color'])
    await dlg.getByRole('tab', { name: /^Lucide/ }).click()
    await expect.poll(() => dlg.locator('.wbi-iconpicker__cell').count()).toBeGreaterThan(20)
    await shot(page, 'picker-lucide-curated', dlg)

    // search (the tab labels count the matches in both sets)
    await dlg.getByPlaceholder('Search icons').fill('trending up')
    await expect.poll(() => dlg.getByRole('tab', { name: /^Fluent Color \(\d+\)$/ }).count()).toBe(1)
    const trend = dlg.locator('[data-icon="lucide:trending-up"]')
    await trend.click()
    await expect(dlg.locator('.wbi-iconpicker__name').innerText()).resolves.toBe('Trending up')
    // keyboard: arrows move the selection, back again
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => dlg.locator('.wbi-iconpicker__name').innerText()).not.toBe('Trending up')
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => dlg.locator('.wbi-iconpicker__name').innerText()).toBe('Trending up')
    await expect(trend.getAttribute('aria-selected')).resolves.toBe('true')
    await expect(trend.getAttribute('aria-label')).resolves.toBe('Trending up, Lucide')
    // the picked component is drawn in the grid and both previews
    expect(await dlg.locator('.wbi-iconpicker__tile svg svg').count()).toBe(2)

    // Lucide: a theme colour and a stroke width (no style chips any more)
    expect(await dlg.getByRole('radio').count()).toBe(0)
    await pickThemeColor(page, dlg, 'Color', 'Theme color 3')
    const slider = dlg.locator('.wbi-iconpicker__stroke input[type="range"]')
    await slider.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await shot(page, 'picker-lucide-styled', dlg)
    // Enter on the focused grid chooses the icon
    await trend.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => dlg.count()).toBe(0)

    // ---- on the canvas: a new image visual drawn by the Lucide component, in the theme colour, centred in view
    await expect.poll(async () => (await visualsOfType(page, 'image')).length).toBe(imagesBefore.length + 1)
    const lucideVisual = (await visualsOfType(page, 'image')).find((n) => !imagesBefore.includes(n))!
    const vc = page.locator(`.wbi-page [data-visual="${lucideVisual}"]`)
    await vc.locator('.wbi-image-icon[data-icon="lucide:trending-up"] svg svg').waitFor()
    const theme = await lumenEval(page, (l) => l.useApp.getState().theme.dataColors.slice(0, 4))
    const drawn = await vc.locator('.wbi-image-icon svg svg').evaluate((el) => ({ color: getComputedStyle(el).color, stroke: el.getAttribute('stroke'), width: el.getAttribute('stroke-width') }))
    const hex = (c: string) => '#' + (c.match(/\d+/g) ?? []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase()
    // Theme color 3 = ThemeDataColor 4 = dataColors[2]
    expect(hex(drawn.color)).toBe(theme[2].toUpperCase())
    expect(drawn.stroke).toBe('currentColor')
    expect(Number(drawn.width)).toBeLessThan(2)
    let b = await bindings(page, lucideVisual)
    expect(b).toHaveLength(1)
    expect(b[0].icon).toMatchObject({ set: 'lucide', name: 'trending-up', color: 'theme:4' })
    expect(b[0].icon.strokeWidth).toBeLessThan(2)
    // placed in the middle of the visible page, not over the header at the top-left
    const pos = await lumenEval(page, (l, n) => l.useApp.getState().project!.report!.pages.flatMap((p) => p.visuals).find((v) => v.name === n)!.json.position, lucideVisual)
    expect(pos.x).toBeGreaterThan(200)
    expect(pos.y).toBeGreaterThan(150)
    await settle(page)
    await shot(page, 'canvas-lucide')

    // ---- a Fluent Color icon (fixed artwork: no colour controls)
    await page.locator('.wbi-ribbon').getByRole('button', { name: 'Icon', exact: true }).click()
    await dlg.waitFor()
    await dlg.getByRole('tab', { name: /^Fluent Color/ }).click()
    await dlg.locator('.wbi-iconpicker__cat', { hasText: /^Charts/ }).click()
    const pie = dlg.locator('[data-icon="fluent-color:data-pie"]')
    await pie.click()
    expect(await dlg.locator('.wbi-iconpicker__colors').count()).toBe(0)
    expect(await dlg.locator('.wbi-iconpicker__stroke').count()).toBe(0)
    await expect(dlg.locator('.wbi-iconpicker__note').innerText()).resolves.toContain('keep their own colors')
    await shot(page, 'picker-fluent', dlg)
    await pie.dblclick()
    await expect.poll(() => dlg.count()).toBe(0)
    await expect.poll(async () => (await visualsOfType(page, 'image')).length).toBe(imagesBefore.length + 2)
    const fluentVisual = (await visualsOfType(page, 'image')).find((n) => !imagesBefore.includes(n) && n !== lucideVisual)!
    const fc = page.locator(`.wbi-page [data-visual="${fluentVisual}"] .wbi-image-icon[data-icon="fluent-color:data-pie"]`)
    await fc.locator('linearGradient').first().waitFor({ state: 'attached' })
    // its gradient ids are scoped to this instance and resolve inside it
    const ids = await fc.evaluate((el) => ({ ids: [...el.querySelectorAll('[id]')].map((n) => n.id), refs: [...el.querySelectorAll('[fill^="url("]')].map((n) => n.getAttribute('fill')!.slice(5, -1)) }))
    expect(ids.refs.length).toBeGreaterThan(0)
    for (const r of ids.refs) expect(ids.ids).toContain(r)
    expect(ids.ids.every((id) => !id.startsWith('ic_fluent'))).toBe(true)
    // the second insert does not land exactly on the first
    const pos2 = await lumenEval(page, (l, n) => l.useApp.getState().project!.report!.pages.flatMap((p) => p.visuals).find((v) => v.name === n)!.json.position, fluentVisual)
    expect(`${pos2.x},${pos2.y}`).not.toBe(`${pos.x},${pos.y}`)

    // ---- a card's callout image: Image source ▸ Icon; the card's label stays inside the card
    const [card] = await visualsOfType(page, 'cardVisual')
    const cardEl = page.locator(`.wbi-page [data-visual="${card}"]`)
    await cardEl.locator('.wbi-card-value').first().click()
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().selectedVisuals)).toEqual([card])
    const callout = await openFormatCard(page, /^Callout image$/)
    const sw = callout.locator('.wbi-card__header [role="switch"]').first()
    if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click()
    await callout.locator('[data-prop="imageType"] .wbi-dropdown').click()
    await page.locator('.wbi-menu[role="listbox"]').getByRole('option', { name: 'Icon' }).click()
    const pick = page.getByRole('dialog', { name: 'Choose an icon' })
    await pick.waitFor()
    await pick.getByRole('tab', { name: /^Lucide/ }).click()
    await pick.getByPlaceholder('Search icons').fill('wallet')
    await pick.locator('[data-icon="lucide:wallet"]').dblclick()
    await expect.poll(() => pick.count()).toBe(0)
    await expect.poll(async () => (await bindings(page, card)).length).toBe(1)
    await cardEl.locator('.wbi-card-image img[src^="data:image/svg+xml;base64,"]').first().waitFor()
    // the Format pane shows the icon rows instead of the URL
    await expect(callout.locator('[data-prop="lumenIcon"]').innerText()).resolves.toContain('Wallet')
    expect(await callout.locator('[data-prop="imageUrl"]').count()).toBe(0)
    await settle(page)
    const labelInside = async () => {
      const tile = await cardEl.locator('.wbi-card-tile').first().boundingBox()
      const label = await cardEl.locator('.wbi-card-label').first().boundingBox()
      return !!tile && !!label && label.y >= tile.y - 0.5 && label.y + label.height <= tile.y + tile.height + 0.5 && label.x >= tile.x - 0.5
    }
    expect(await labelInside()).toBe(true)
    // above the text: the image gives way, the label is still not cut off
    await callout.locator('[data-prop="position"] .wbi-dropdown').click()
    await page.locator('.wbi-menu[role="listbox"]').getByRole('option', { name: 'Top' }).click()
    await settle(page)
    expect(await labelInside()).toBe(true)
    await shot(page, 'card-icon')

    // ---- Save As PBIP: pictures (from the components) + annotation on disk
    const target = join(tmp, 'icons', 'Icons.pbip')
    await stubSaveDialog(app, target)
    await fileMenu(page, 'Save as')
    await page.getByRole('button', { name: /Power BI project \(\.pbip\)/ }).click()
    const resDir = join(tmp, 'icons', 'Icons.Report', 'StaticResources', 'RegisteredResources')
    await untilNode(() => existsSync(resDir) && readdirSync(resDir).filter((f) => f.endsWith('.svg')).length >= 2, 30_000, 'baked SVGs')
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().project!.dirty)).toBe(false)
    const lucideFile = readdirSync(resDir).find((f) => f.startsWith('LumenIcon_lucide_trending-up_'))!
    const lucideSvg = readFileSync(join(resDir, lucideFile), 'utf8')
    expect(lucideSvg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="256" height="256"/)
    expect(lucideSvg).toContain(`color:${theme[2].toUpperCase()}`)
    const fluentFile = readdirSync(resDir).find((f) => f.startsWith('LumenIcon_fluent-color_data-pie_'))!
    expect(readFileSync(join(resDir, fluentFile), 'utf8')).toMatch(/<linearGradient id="lumen-ic_fluent_data_pie_20_color__a"/)
    const pageDirs = join(tmp, 'icons', 'Icons.Report', 'definition', 'pages')
    const visualJson = (name: string) => {
      for (const p of readdirSync(pageDirs)) {
        const f = join(pageDirs, p, 'visuals', name, 'visual.json')
        if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'))
      }
      return undefined
    }
    const saved = visualJson(lucideVisual)
    expect(saved.visual.objects.general[0].properties.imageUrl.expr.ResourcePackageItem.ItemName).toBe(lucideFile)
    expect(JSON.parse(saved.annotations.find((a: any) => a.name === 'Lumen_Icon').value).icons[0].icon).toMatchObject({ set: 'lucide', name: 'trending-up', color: 'theme:4' })
    const savedCard = visualJson(card)
    expect(savedCard.visual.objects.image[0].properties.imageUrl.expr.Literal.Value).toMatch(/^'data:image\/svg\+xml;base64,/)

    // ---- reopen: still icons, still editable
    await openFile(page, target)
    await waitIdle(page)
    const vc2 = page.locator(`.wbi-page [data-visual="${lucideVisual}"]`)
    await vc2.locator('.wbi-image-icon[data-icon="lucide:trending-up"] svg svg').waitFor()
    await page.locator(`.wbi-page [data-visual="${fluentVisual}"] .wbi-image-icon[data-icon="fluent-color:data-pie"] svg svg`).waitFor()
    // the Fluent icon was inserted 20 px down-right of it: click the uncovered corner
    await vc2.click({ position: { x: 6, y: 6 } })
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().selectedVisuals)).toEqual([lucideVisual])
    const imgCard = await openFormatCard(page, /^Image$/)
    await expect(imgCard.locator('[data-prop="lumenIconSource"] .wbi-dropdown').innerText()).resolves.toContain('Icon')
    await expect(imgCard.locator('[data-prop="lumenIcon"]').innerText()).resolves.toContain('Trending up')
    await shot(page, 'format-pane-icon')
    // change the colour after reopening: Black (the theme foreground)
    await pickThemeColor(page, imgCard, 'Color', 'Black')
    await expect.poll(async () => (await bindings(page, lucideVisual))[0]?.icon.color).toBe('theme:1')
    // the card icon is an icon again too
    await expect.poll(async () => (await bindings(page, card))[0]?.icon.name).toBe('wallet')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(async () => (await bindings(page, lucideVisual))[0]?.icon.color).toBe('theme:4')
    b = await bindings(page, fluentVisual)
    expect(b[0].icon).toEqual({ set: 'fluent-color', name: 'data-pie' })
    expect(await lumenEval(page, (l) => l.errors)).toEqual([])
  })
})
