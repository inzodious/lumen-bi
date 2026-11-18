/** Editing: select a visual, change its title text and color in the Format pane, Undo / Redo. */
import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { useLumen, visualByTitle, visualStatuses, settle, lumenEval } from './harness'

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
