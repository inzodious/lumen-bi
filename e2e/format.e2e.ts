/** Editing: select a visual, change its title text and color in the Format pane, Undo / Redo. */
import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { useLumen, visualByTitle, visualStatuses, settle, lumenEval, rendererErrors } from './harness'

describe('format pane', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('changes a visual title and color; Undo restores, Redo re-applies', async () => {
    const { page } = lumen()
    const name = await visualByTitle(page, 'Sales by category')
    const vc = page.locator(`.wbi-page [data-visual="${name}"]`)
    // select by clicking the title (clicking a data point would also cross-filter)
    await vc.locator('.wbi-vc-titles').click()
    await expect(lumenEval(page, (l) => l.useApp.getState().selectedVisuals)).resolves.toEqual([name])
    await page.getByRole('tab', { name: 'Format visual' }).click()
    await page.locator('.wbi-fmt__pivot').getByRole('tab', { name: 'General' }).click()
    const fmt = page.locator('.wbi-fmt__cards')
    await fmt.locator('.wbi-card__header', { hasText: /^Title$/ }).first().click()
    // nested "Title" sub-card (Title ▸ Title / Subtitle / Divider…)
    const sub = fmt.locator('.wbi-card--l2').filter({ has: page.locator('.wbi-card__title', { hasText: /^Title$/ }) })
    if (!(await sub.locator('.wbi-card__body').count())) await sub.locator('.wbi-card__header').click()
    const text = sub.locator('[data-prop="text"] input')
    await text.fill('Category share')
    await text.press('Enter')
    await expect.poll(() => vc.getAttribute('aria-label')).toBe('Category share')
    await expect(vc.locator('.wbi-vc-titles').innerText()).resolves.toBe('Category share')
    // font color: pick a swatch in the color picker
    const colorBefore = await vc.locator('.wbi-vc-titles > div').first().evaluate((e) => getComputedStyle(e).color)
    await sub.locator('[data-prop="fontColor"] button.wbi-color-btn').click()
    await page.locator('.wbi-colorpop').getByTitle(/^Theme color 3,/).click()
    await expect.poll(() => vc.locator('.wbi-vc-titles > div').first().evaluate((e) => getComputedStyle(e).color)).not.toBe(colorBefore)
    // Undo twice (title bar): color, then text
    const undo = page.getByRole('button', { name: 'Undo', exact: true })
    await undo.click()
    await expect.poll(() => vc.locator('.wbi-vc-titles > div').first().evaluate((e) => getComputedStyle(e).color)).toBe(colorBefore)
    await undo.click()
    await expect.poll(() => vc.getAttribute('aria-label')).toBe('Sales by category')
    // the Format pane follows the document
    await expect(text.inputValue()).resolves.toBe('Sales by category')
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect.poll(() => vc.getAttribute('aria-label')).toBe('Category share')
    await settle(page)
  })
})

// ---------------------------------------------------------------------------------------------
// Format pane controls: nothing clipped, effective values instead of empty boxes
// ---------------------------------------------------------------------------------------------

/** Expand every collapsed card of the Format tab (cards mount their body only when open). */
async function expandAllCards(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const closed = page.locator('.wbi-viz__body .wbi-card__header[aria-expanded="false"]')
      const n = await closed.count()
      if (n) await closed.first().click()
      return n
    })
    .toBe(0)
}

/**
 * Controls of the Format tab that stick out of the pane (horizontally), are squeezed to nothing, or overlap the
 * control next to them in the same row. Vertical position doesn't matter: the pane scrolls.
 */
async function clippedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const body = document.querySelector<HTMLElement>('.wbi-viz__body')!
    const left = body.getBoundingClientRect().left
    const right = left + body.clientWidth
    const where = (el: Element) => `${el.closest('.wbi-card')?.querySelector('.wbi-card__title')?.textContent ?? '?'} ▸ ${el.closest('[data-prop]')?.getAttribute('data-prop') ?? el.textContent?.slice(0, 20) ?? ''} <${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(' ')[0]}>`
    const out: string[] = []
    if (body.scrollWidth > body.clientWidth + 1) out.push(`the pane scrolls horizontally (${body.scrollWidth} > ${body.clientWidth})`)
    for (const el of body.querySelectorAll<HTMLElement>('input, textarea, button, .wbi-input, .wbi-dropdown, .wbi-toggle, .wbi-color-btn, .wbi-fmt__label, .wbi-card__title, .wbi-spin__unit')) {
      const r = el.getBoundingClientRect()
      if (!r.width && !r.height) continue
      if (r.right > right + 0.5 || r.left < left - 0.5) out.push(`outside the pane: ${where(el)} (${Math.round(r.left - left)}…${Math.round(r.right - left)} of ${body.clientWidth})`)
      // a text / number box must keep room for a few digits
      if (el instanceof HTMLInputElement && el.type === 'text' && el.clientWidth < 18) out.push(`squeezed: ${where(el)} (${el.clientWidth}px)`)
      if (el.matches('.wbi-spin input') && el.scrollWidth > el.clientWidth + 1) out.push(`number cut off: ${where(el)} "${(el as HTMLInputElement).value}"`)
    }
    // the controls sharing one row (slider + number box, color + fx, font + size) don't overlap
    for (const row of body.querySelectorAll<HTMLElement>('.wbi-fslider, .wbi-fx-wrap, .wbi-fmt__font, .wbi-fmt__pair, .wbi-fmt__seg')) {
      const kids = Array.from(row.children).map((k) => k.getBoundingClientRect())
      for (let i = 0; i < kids.length; i++)
        for (let j = i + 1; j < kids.length; j++) if (kids[i].left < kids[j].right - 0.5 && kids[j].left < kids[i].right - 0.5 && kids[i].top < kids[j].bottom - 0.5 && kids[j].top < kids[i].bottom - 0.5) out.push(`overlap in ${where(row)}`)
    }
    return out
  })
}

describe('format pane controls', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('shows effective values for an unset shape border and keeps every control inside the pane, at the default and the narrowest width', async () => {
    const { page } = lumen()
    const shape = (await visualStatuses(page)).find((v) => v.type === 'shape')!
    await lumenEval(page, (l, n) => l.useApp.getState().selectVisuals([n]), shape.name)
    await page.getByRole('tab', { name: 'Format visual' }).click()
    await page.locator('.wbi-fmt__pivot').getByRole('tab', { name: 'Visual' }).click()
    const cards = page.locator('.wbi-fmt__cards')
    const border = cards.locator('.wbi-card').filter({ has: page.locator('.wbi-card__title', { hasText: /^Border$/ }) })
    await border.locator('.wbi-card__header').click()
    // switch the border on like in the report: Width and Color were never set, yet show what the shape uses
    if ((await border.locator('.wbi-card__header [role="switch"]').getAttribute('aria-checked')) !== 'true') await border.locator('.wbi-card__header [role="switch"]').click()
    await expect.poll(() => border.locator('.wbi-card__header [role="switch"]').getAttribute('aria-checked')).toBe('true')
    const width = border.locator('[data-prop="weight"] input')
    await expect(width.inputValue()).resolves.toBe('1')
    expect(await border.locator('[data-prop="lineColor"] .wbi-color-btn__swatch.is-empty').count()).toBe(0)
    await expect(border.locator('[data-prop="transparency"] [role="spinbutton"]').inputValue()).resolves.toBe('0')
    // the spin arrows step the value (one undo step for a burst), ↑/↓ keys too; clearing the box resets to the default
    const depth = () => lumenEval(page, (l) => l.useApp.getState().undoStack.length)
    const d0 = await depth()
    await border.locator('[data-prop="weight"]').getByRole('button', { name: 'Increase Width' }).click()
    await border.locator('[data-prop="weight"]').getByRole('button', { name: 'Increase Width' }).click()
    await expect(width.inputValue()).resolves.toBe('3')
    await width.press('ArrowDown')
    await expect(width.inputValue()).resolves.toBe('2')
    expect(await depth()).toBe(d0 + 1)
    await expect(lumenEval(page, (l, n) => l.useApp.getState().project!.report!.pages.flatMap((p) => p.visuals).find((v) => v.name === n)!.json.visual.objects.outline[0].properties.weight.expr.Literal.Value, shape.name)).resolves.toBe('2D')
    await width.fill('')
    await width.press('Enter')
    await expect(width.inputValue()).resolves.toBe('1')

    await expandAllCards(page)
    const pane = page.locator('section.wbi-pane[data-pane="visualizations"]')
    const defaultWidth = await pane.evaluate((p) => Math.round(p.getBoundingClientRect().width))
    expect(await clippedControls(page)).toEqual([])
    // the transparency number box is fully visible next to its slider
    const box = (await border.locator('[data-prop="transparency"] .wbi-fslider__num').boundingBox())!
    const paneBox = (await pane.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(56)
    expect(box.x + box.width).toBeLessThanOrEqual(paneBox.x + paneBox.width)

    // General tab of a chart (title text, fonts, B/I/U, alignment, colors + fx, sliders, shadow…)
    const chart = await visualByTitle(page, 'Sales by year and channel')
    await lumenEval(page, (l, n) => l.useApp.getState().selectVisuals([n]), chart)
    await page.locator('.wbi-fmt__pivot').getByRole('tab', { name: 'General' }).click()
    await expandAllCards(page)
    expect(await clippedControls(page)).toEqual([])
    // General ▸ Effects ▸ Visual border: effective color / width rather than empty controls
    const vb = cards.locator('.wbi-card--l2').filter({ has: page.locator('.wbi-card__title', { hasText: /^Visual border$/ }) })
    expect(await vb.locator('[data-prop="color"] .wbi-color-btn__swatch.is-empty').count()).toBe(0)
    expect(await vb.locator('[data-prop="width"] input').inputValue()).not.toBe('')
    // font family and size share a row; bold / italic / underline are one button group
    const title = cards.locator('.wbi-card--l2').filter({ has: page.locator('.wbi-card__title', { hasText: /^Title$/ }) })
    const fam = (await title.locator('[data-prop="fontFamily"]').boundingBox())!
    const size = (await title.locator('[data-prop="fontSize"]').boundingBox())!
    expect(Math.abs(fam.y - size.y)).toBeLessThan(2)
    expect(size.x).toBeGreaterThanOrEqual(fam.x + fam.width)
    await expect(title.getByRole('group', { name: 'Font style' }).getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).resolves.toEqual(['Bold', 'Italic', 'Underline'])

    // narrowest width the pane allows: still nothing clipped (sliders shrink, font size wraps under the family)
    await lumenEval(page, (l) => l.useShell.getState().setPane('visualizations', { width: 100 }))
    await expect.poll(() => pane.evaluate((p) => Math.round(p.getBoundingClientRect().width))).toBe(180)
    expect(await clippedControls(page)).toEqual([])
    await lumenEval(page, (l, n) => l.useApp.getState().selectVisuals([n]), shape.name)
    await page.locator('.wbi-fmt__pivot').getByRole('tab', { name: 'Visual' }).click()
    await expandAllCards(page)
    expect(await clippedControls(page)).toEqual([])
    await lumenEval(page, (l, w) => l.useShell.getState().setPane('visualizations', { width: w }), defaultWidth)
  })
})

// ---------------------------------------------------------------------------------------------
// Visual tab of data visuals: unset properties show what the visual draws with
// ---------------------------------------------------------------------------------------------

/** Remove every Visual-tab formatting of a visual (setup: an "empty definition", fields kept). */
async function clearVisualFormatting(page: Page, name: string): Promise<void> {
  await lumenEval(page, (l, n) =>
    l.useApp.getState().mutateReport('Clear formatting', (r) => {
      for (const p of r.pages) for (const v of p.visuals) if (v.name === n) delete v.json.visual.objects
    }), name)
}

/**
 * Visual-tab controls that show no value: an empty number box, the "Auto" color label or the "no color" swatch, a
 * dropdown on its placeholder, an alignment group with no button on. Text boxes are left out (empty by design).
 */
async function automaticControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    const where = (el: Element) => `${el.closest('.wbi-card')?.querySelector('.wbi-card__title')?.textContent ?? '?'} ▸ ${el.closest('[data-prop]')?.getAttribute('data-prop') ?? '?'}`
    const body = document.querySelector('.wbi-fmt__cards')!
    for (const el of body.querySelectorAll<HTMLInputElement>('.wbi-spin input')) if (el.value.trim() === '') out.push(where(el))
    for (const el of body.querySelectorAll('.wbi-color-btn__auto, .wbi-color-btn__swatch.is-empty, .wbi-dropdown__placeholder')) out.push(where(el))
    for (const el of body.querySelectorAll('.wbi-fmt__seg[role="radiogroup"]')) if (!el.querySelector('[aria-checked="true"]')) out.push(where(el))
    return [...new Set(out)].sort()
  })
}

describe('format pane: Visual tab defaults of data visuals', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('card, column chart, table and slicer show the values they draw with when nothing is set; Reset returns to them', async () => {
    const { page } = lumen()
    const statuses = await visualStatuses(page)
    const pick = (type: string) => statuses.find((v) => v.type === type)!.name
    const cardsEl = page.locator('.wbi-fmt__cards')
    const card = (title: string) => cardsEl.locator('.wbi-card').filter({ has: page.locator('.wbi-card__title', { hasText: new RegExp(`^${title}$`) }) }).first()
    const spin = (title: string, prop: string) => card(title).locator(`[data-prop="${prop}"] .wbi-spin input`).first()
    const colorOf = (title: string, prop: string) => card(title).locator(`[data-prop="${prop}"] button.wbi-color-btn`).first().getAttribute('title')
    const dropdownText = (title: string, prop: string) => card(title).locator(`[data-prop="${prop}"] .wbi-dropdown__value`).first().innerText()
    const open = async (name: string) => {
      await clearVisualFormatting(page, name)
      await lumenEval(page, (l, n) => l.useApp.getState().selectVisuals([n]), name)
      await page.getByRole('tab', { name: 'Format visual' }).click()
      await page.locator('.wbi-fmt__pivot').getByRole('tab', { name: 'Visual' }).click()
      await expandAllCards(page)
    }
    const theme = await lumenEval(page, (l) => {
      const t = l.useApp.getState().theme
      return { callout: t.textClasses.callout ?? {}, title: t.textClasses.title ?? {}, label: t.textClasses.label ?? {}, foreground: t.foreground, data0: t.dataColors[0] }
    })

    // ---- card visual (~110 controls that used to read "Auto" / empty)
    await open(pick('cardVisual'))
    await expect(spin('Callout value', 'fontSize').inputValue()).resolves.toBe(String(theme.callout.fontSize ?? 45))
    await expect(colorOf('Callout value', 'fontColor')).resolves.toBe(theme.foreground.toUpperCase())
    // behind a switch that is off: the shadow still shows the values it would draw with
    await expect(spin('Card shadow', 'shadowBlur').inputValue()).resolves.toBe('10')
    await expect(spin('Card shadow', 'angle').inputValue()).resolves.toBe('45')
    await expect(colorOf('Card shadow', 'color')).resolves.toBe('#000000')
    await expect(dropdownText('Card shadow', 'shadowPositionPreset')).resolves.toBe('bottomRight')
    expect(await automaticControls(page)).toEqual(
      [
        'Callout value ▸ labelPrecision',
        'Multi-card layout ▸ rowCount',
        'Reference labels layout ▸ horizontalAlignment',
        'Reference labels layout ▸ valueArea',
        'Reference label value ▸ valuePrecision',
        'Reference label detail ▸ detailPrecision',
        'Multi-category layout ▸ rowCount',
        'Multi-category layout ▸ titleOrientation',
        'Multi-category layout ▸ maxHeaderSize'
      ].sort()
    )
    // Reset returns to exactly the displayed default and clears the property
    const blur = spin('Card shadow', 'shadowBlur')
    await blur.press('ArrowUp')
    await expect(blur.inputValue()).resolves.toBe('11')
    await card('Card shadow').getByRole('button', { name: 'Reset Blur' }).click()
    await expect(blur.inputValue()).resolves.toBe('10')
    await expect(lumenEval(page, (l, n) => l.useApp.getState().project!.report!.pages.flatMap((p) => p.visuals).find((v) => v.name === n)!.json.visual.objects?.shadowCustom ?? null, pick('cardVisual'))).resolves.toBeNull()

    // ---- clustered column chart: theme title class on the axis titles, label position, total color…
    await open(pick('clusteredColumnChart'))
    await expect(card('X-axis').locator('[data-prop="titleFontFamily"] .wbi-dropdown__value').innerText()).resolves.toBe(theme.title.fontFace ?? 'DIN')
    await expect(dropdownText('Data labels', 'labelPosition')).resolves.toBe('Auto')
    // category-axis labels: `lightLabel` class (the theme label size when it isn't the base 10pt, else 9pt)
    const lightLabelPt = theme.label.fontSize !== undefined && theme.label.fontSize !== 10 ? theme.label.fontSize : 9
    await expect(spin('X-axis', 'fontSize').inputValue()).resolves.toBe(String(lightLabelPt))
    await expect(spin('Y-axis', 'fontSize').inputValue()).resolves.toBe('9')
    const auto = await automaticControls(page)
    // what remains automatic is what Power BI computes per render too
    for (const a of auto) expect(a, a).toMatch(/▸ (start|end|labelPrecision|axisType|color|fill|defaultColor|barColor|backgroundColor|labelDisplayUnits)$/)
    expect(auto).not.toContain('Y-axis ▸ titleFontSize')

    // ---- table: values follow the theme label class
    await open(pick('tableEx'))
    await expect(spin('Values', 'fontSize').inputValue()).resolves.toBe(String(theme.label.fontSize ?? 10))
    expect(await card('Values').locator('.wbi-color-btn__auto, .wbi-color-btn__swatch.is-empty').count()).toBe(0)
    for (const a of await automaticControls(page)) expect(a, a).toMatch(/▸ (labelPrecision|imageWidth|backColor|alignment|fontColor|labelDisplayUnits)$|^Specific column/)
    const valueSize = spin('Values', 'fontSize')
    const shown = await valueSize.inputValue()
    await valueSize.press('ArrowUp')
    await expect(valueSize.inputValue()).resolves.toBe(String(Number(shown) + 1))
    await card('Values').getByRole('button', { name: /^Reset / }).first().click()
    await expect(valueSize.inputValue()).resolves.toBe(shown)

    // ---- slicer: header / values fonts and colors
    await open(pick('slicer'))
    await expect(spin('Slicer header', 'textSize').inputValue()).resolves.not.toBe('')
    await expect(spin('Values', 'textSize').inputValue()).resolves.not.toBe('')
    await expect(colorOf('Values', 'fontColor')).resolves.toMatch(/^#[0-9A-F]{6}$/)
    for (const a of await automaticControls(page)) expect(a, a).toMatch(/▸ background$/)
    expect(await rendererErrors(page)).toEqual([])
  })
})
