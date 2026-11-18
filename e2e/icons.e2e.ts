/**
 * Built-in icons: Insert ▸ Icon opens the picker (search, keyboard, IconPark tri-colour with three colours), the icon
 * lands on the canvas as an image visual; a card's callout image takes an icon through its Image source; Save As
 * PBIP writes the baked SVGs + the Lumen_Icon annotation, and after reopening the icons are still editable.
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

  it('insert an icon, restyle the tri-colour set, put an icon on a card, save, reopen and edit again', async () => {
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
    // curated category is the default view and lists business icons
    await expect.poll(() => dlg.locator('.wbi-iconpicker__cell').count()).toBeGreaterThan(20)
    await shot(page, 'picker-curated', dlg)

    // IconPark (the multi-colour set), search
    await dlg.getByRole('tab', { name: /^IconPark/ }).click()
    await dlg.getByPlaceholder('Search icons').fill('wallet')
    // the set tabs count matches across libraries
    await expect.poll(() => dlg.getByRole('tab', { name: /^Tabler \(\d+\)$/ }).count()).toBe(1)
    const wallet = dlg.locator('[data-icon="iconpark:wallet"]')
    await wallet.click()
    await expect(dlg.locator('.wbi-iconpicker__name').innerText()).resolves.toBe('Wallet')

    // keyboard: arrows move the selection, back again
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => dlg.locator('.wbi-iconpicker__name').innerText()).not.toBe('Wallet')
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => dlg.locator('.wbi-iconpicker__name').innerText()).toBe('Wallet')
    await expect(wallet.getAttribute('aria-selected')).resolves.toBe('true')
    await expect(wallet.getAttribute('aria-label')).resolves.toBe('Wallet, IconPark')

    // variant: Two-tone (two colours), then the Tri-color style with its three colours
    await dlg.getByRole('radio', { name: 'Two-tone' }).click()
    await expect.poll(() => dlg.locator('.wbi-iconpicker__colors .wbi-color-btn').count()).toBe(2)
    await dlg.getByRole('radio', { name: 'Tri-color' }).click()
    await expect.poll(() => dlg.locator('.wbi-iconpicker__colors .wbi-color-btn').count()).toBe(3)
    await pickThemeColor(page, dlg, 'Primary (fill)', 'Theme color 3')
    await pickThemeColor(page, dlg, 'Secondary (accent)', 'Theme color 5')
    await pickThemeColor(page, dlg, 'Line', 'Black')
    await shot(page, 'picker-tricolor', dlg)
    // Enter on the focused grid chooses the icon
    await wallet.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => dlg.count()).toBe(0)

    // ---- on the canvas: a new image visual drawn from the icon library, with the three colours
    await expect.poll(async () => (await visualsOfType(page, 'image')).length).toBe(imagesBefore.length + 1)
    const iconVisual = (await visualsOfType(page, 'image')).find((n) => !imagesBefore.includes(n))!
    const vc = page.locator(`.wbi-page [data-visual="${iconVisual}"]`)
    await vc.locator('.wbi-image-icon[data-icon="iconpark:wallet"] svg').waitFor()
    const theme = await lumenEval(page, (l) => l.useApp.getState().theme.dataColors.slice(0, 4))
    const svgColors = await vc.locator('.wbi-image-icon svg').evaluate((el) => [...new Set([...el.querySelectorAll('[fill],[stroke]')].flatMap((n) => [n.getAttribute('fill'), n.getAttribute('stroke')]))])
    // Theme color 3 = dataColors[2], Theme color 5 = dataColors[4], Black = foreground
    expect(svgColors).toContain(theme[2].toUpperCase())
    expect(svgColors).toContain('#252423')
    let b = await bindings(page, iconVisual)
    expect(b).toHaveLength(1)
    expect(b[0].icon).toMatchObject({ set: 'iconpark', name: 'wallet', variant: 'multi-color', colors: ['theme:4', 'theme:6', 'theme:1'] })
    await settle(page)
    await shot(page, 'canvas-icon')

    // ---- a card's callout image: Image source ▸ Icon
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
    await pick.getByRole('tab', { name: /^Tabler/ }).click()
    await pick.getByPlaceholder('Search icons').fill('trending up')
    await pick.locator('[data-icon="tabler:trending-up"]').dblclick()
    await expect.poll(() => pick.count()).toBe(0)
    await expect.poll(async () => (await bindings(page, card)).length).toBe(1)
    await cardEl.locator('.wbi-card-image img[src^="data:image/svg+xml;base64,"]').first().waitFor()
    // the Format pane shows the icon rows instead of the URL
    await expect(callout.locator('[data-prop="lumenIcon"]').innerText()).resolves.toContain('Trending up')
    expect(await callout.locator('[data-prop="imageUrl"]').count()).toBe(0)
    await settle(page)
    await shot(page, 'card-icon')

    // ---- Save As PBIP: baked SVG resource + annotation on disk
    const target = join(tmp, 'icons', 'Icons.pbip')
    await stubSaveDialog(app, target)
    await fileMenu(page, 'Save as')
    await page.getByRole('button', { name: /Power BI project \(\.pbip\)/ }).click()
    const resDir = join(tmp, 'icons', 'Icons.Report', 'StaticResources', 'RegisteredResources')
    await untilNode(() => existsSync(resDir) && readdirSync(resDir).some((f) => f.endsWith('.svg')), 30_000, 'baked SVG')
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().project!.dirty)).toBe(false)
    const svgFile = readdirSync(resDir).find((f) => f.startsWith('LumenIcon_iconpark_wallet_'))!
    expect(readFileSync(join(resDir, svgFile), 'utf8')).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/)
    const pageDirs = join(tmp, 'icons', 'Icons.Report', 'definition', 'pages')
    const visualJson = (name: string) => {
      for (const p of readdirSync(pageDirs)) {
        const f = join(pageDirs, p, 'visuals', name, 'visual.json')
        if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'))
      }
      return undefined
    }
    const saved = visualJson(iconVisual)
    expect(saved.visual.objects.general[0].properties.imageUrl.expr.ResourcePackageItem.ItemName).toBe(svgFile)
    expect(saved.annotations.find((a: any) => a.name === 'Lumen_Icon')).toBeTruthy()
    const savedCard = visualJson(card)
    expect(savedCard.visual.objects.image[0].properties.imageUrl.expr.Literal.Value).toMatch(/^'data:image\/svg\+xml;base64,/)

    // ---- reopen: still icons, still editable
    await openFile(page, target)
    await waitIdle(page)
    const vc2 = page.locator(`.wbi-page [data-visual="${iconVisual}"]`)
    await vc2.locator('.wbi-image-icon[data-icon="iconpark:wallet"] svg').waitFor()
    await vc2.click()
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().selectedVisuals)).toEqual([iconVisual])
    const imgCard = await openFormatCard(page, /^Image$/)
    await expect(imgCard.locator('[data-prop="lumenIconSource"] .wbi-dropdown').innerText()).resolves.toContain('Icon')
    await expect(imgCard.locator('[data-prop="lumenIcon"]').innerText()).resolves.toContain('Wallet')
    await shot(page, 'format-pane-icon')
    // change the style after reopening: Outline (one colour)
    await imgCard.getByRole('radio', { name: 'Outline' }).click()
    await expect.poll(async () => (await bindings(page, iconVisual))[0]?.icon.variant).toBe('outline')
    b = await bindings(page, iconVisual)
    expect(b[0].icon.colors).toEqual(['theme:4'])
    // the card icon is an icon again too
    await expect.poll(async () => (await bindings(page, card))[0]?.icon.name).toBe('trending-up')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(async () => (await bindings(page, iconVisual))[0]?.icon.variant).toBe('multi-color')
    expect(await lumenEval(page, (l) => l.errors)).toEqual([])
  })
})
