/**
 * Card visual: the category label sits above the value and is the card's only header — switching the
 * container title on generates no text (no doubled field name) until one is typed; the label position
 * follows the Format pane.
 */
import { describe, expect, it } from 'vitest'
import type { Locator } from 'playwright-core'
import { useLumen, visualsOfType, settle, lumenEval } from './harness'

/** Where the category label sits relative to the value (rendered boxes). */
async function labelSide(vc: Locator): Promise<'above' | 'below' | 'overlap'> {
  return vc.evaluate((el) => {
    const l = el.querySelector('.wbi-card-label')!.getBoundingClientRect()
    const v = el.querySelector('.wbi-card-value')!.getBoundingClientRect()
    return l.bottom <= v.top + 1 ? 'above' : l.top >= v.bottom - 1 ? 'below' : 'overlap'
  })
}

/** Label/value block in the callout area: space above, between and below (rendered boxes, px). */
async function calloutRhythm(vc: Locator): Promise<{ above: number; between: number; below: number }> {
  return vc.evaluate((el) => {
    const area = el.querySelector('.wbi-card-callout')!.getBoundingClientRect()
    const l = el.querySelector('.wbi-card-label')!.getBoundingClientRect()
    const v = el.querySelector('.wbi-card-value')!.getBoundingClientRect()
    return { above: l.top - area.top, between: v.top - l.bottom, below: area.bottom - v.bottom }
  })
}

describe('card visual', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('labels above the value, no generated title, position and title editable in the Format pane', async () => {
    const { page } = lumen()
    const [name] = await visualsOfType(page, 'cardVisual')
    expect(name).toBeTruthy()
    const vc = page.locator(`.wbi-page [data-visual="${name}"]`)
    const label = (await vc.locator('.wbi-card-label').first().innerText()).trim()
    expect(label.length).toBeGreaterThan(0)
    await expect(labelSide(vc)).resolves.toBe('above')
    await expect(vc.locator('.wbi-vc-titles').count()).resolves.toBe(0)
    // Power BI's rhythm: the label + value block is centred in the callout area with a gap between them
    const r = await calloutRhythm(vc)
    expect(r.between).toBeGreaterThan(4)
    expect(Math.abs(r.above - r.below)).toBeLessThan(3)

    // select the card and open its formatting
    await vc.locator('.wbi-card-label').first().click()
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().selectedVisuals)).toEqual([name])
    await page.getByRole('tab', { name: 'Format visual' }).click()
    const pivot = page.locator('.wbi-fmt__pivot')
    const fmt = page.locator('.wbi-fmt__cards')

    // General ▸ Title: on, without a text → still no title (the field name is not repeated above the label)
    await pivot.getByRole('tab', { name: 'General' }).click()
    await fmt.locator('.wbi-card__header', { hasText: /^Title$/ }).first().click()
    const sub = fmt.locator('.wbi-card--l2').filter({ has: page.locator('.wbi-card__title', { hasText: /^Title$/ }) })
    const toggle = sub.locator('.wbi-card__header [role="switch"]')
    await expect(toggle.getAttribute('aria-checked')).resolves.toBe('false')
    await toggle.click()
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true')
    await settle(page)
    await expect(vc.locator('.wbi-vc-titles').count()).resolves.toBe(0)
    await expect(vc.locator('.wbi-card-label').first().innerText()).resolves.toContain(label)
    // a typed title shows
    if (!(await sub.locator('.wbi-card__body').count())) await sub.locator('.wbi-card__header').click()
    const text = sub.locator('[data-prop="text"] input')
    await text.fill('Headline')
    await text.press('Enter')
    await expect.poll(() => vc.locator('.wbi-vc-titles').count()).toBe(1)
    await expect(vc.locator('.wbi-vc-titles').innerText()).resolves.toBe('Headline')

    // Visual ▸ Category label ▸ Position: Below value
    await pivot.getByRole('tab', { name: 'Visual' }).click()
    const cat = fmt.locator('.wbi-card').filter({ has: page.locator('.wbi-card__title', { hasText: /^Category label$/ }) }).first()
    if (!(await cat.locator('.wbi-card__body').count())) await cat.locator('.wbi-card__header').first().click()
    await cat.locator('[data-prop="position"] .wbi-dropdown').click()
    await page.locator('.wbi-menu[role="listbox"]').getByRole('option', { name: 'Below value' }).click()
    await expect.poll(() => labelSide(vc)).toBe('below')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(() => labelSide(vc)).toBe('above')
    await settle(page)
  })
})
