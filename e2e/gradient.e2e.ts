/**
 * Gradient fills (Lumen-only, core/report/gradientFill.ts): the color picker's Gradient tab fills a shape and a
 * visual's background with a gradient; the property keeps a solid fallback for Power BI; Undo removes it.
 * `LUMEN_E2E_SHOTS=<dir>` additionally saves screenshots of the Gradient tab and the canvas.
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright-core'
import { deselectAll, useLumen, visualStatuses, settle, lumenEval, rendererErrors } from './harness'

const SHOTS = process.env['LUMEN_E2E_SHOTS'] ?? ''

async function shot(page: Page, name: string, el?: Locator): Promise<void> {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await (el ?? page).screenshot({ path: join(SHOTS, `${name}.png`) })
}

function visualJson(page: Page, name: string): Promise<any> {
  return lumenEval(page, (l, n) => JSON.parse(JSON.stringify(l.useApp.getState().project!.report!.pages.flatMap((p) => p.visuals).find((v) => v.name === n)!.json)), name)
}

async function openCard(page: Page, title: RegExp) {
  const card = page.locator('.wbi-fmt__cards .wbi-card').filter({ has: page.locator('.wbi-card__title', { hasText: title }) }).last()
  if ((await card.locator('.wbi-card__header').first().getAttribute('aria-expanded')) === 'false') await card.locator('.wbi-card__header').first().click()
  return card
}

describe('gradient fills', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('fills a shape and a visual background with a gradient; Undo restores the solid color', async () => {
    const { page } = lumen()
    const shape = (await visualStatuses(page)).find((v) => v.type === 'shape')!
    await lumenEval(page, (l, n) => l.useApp.getState().selectVisuals([n]), shape.name)
    await page.getByRole('tab', { name: 'Format visual' }).click()
    await page.locator('.wbi-fmt__pivot').getByRole('tab', { name: 'Visual' }).click()
    const fill = await openCard(page, /^Fill$/)
    await fill.locator('[data-prop="fillColor"] button.wbi-color-btn').click()
    const pop = page.locator('.wbi-colorpop')
    await pop.getByRole('tab', { name: 'Gradient' }).click()
    await expect.poll(() => pop.locator('[data-gradient-editor]').count()).toBe(1)
    // second stop: a theme swatch; type radial
    await pop.getByRole('button', { name: 'Stop 2' }).click()
    await pop.locator('[data-gradient-editor] .wbi-colorpop__sw').nth(3).click()
    await pop.getByRole('button', { name: 'Add stop' }).click()
    await pop.getByRole('radio', { name: 'Radial' }).click()
    await shot(page, 'gradient-picker', pop)
    await pop.getByRole('button', { name: 'Apply' }).click()

    const vc = page.locator(`.wbi-page [data-visual="${shape.name}"]`)
    await expect.poll(() => vc.locator('svg radialGradient stop').count()).toBe(3)
    await expect.poll(() => vc.locator('svg path').first().getAttribute('fill')).toMatch(/^url\(#lumen-gf-/)
    const json = await visualJson(page, shape.name)
    const ann = JSON.parse(json.annotations.find((a: any) => a.name === 'Lumen_Fill').value)
    expect(ann).toHaveLength(1)
    expect(ann[0]).toMatchObject({ object: 'fill', prop: 'fillColor', gradient: { kind: 'radial' } })
    // the property itself holds the solid fallback Power BI draws
    expect(json.visual.objects.fill[0].properties.fillColor.solid.color.expr.Literal.Value).toBe(`'${ann[0].fallback}'`)
    await expect.poll(() => fill.locator('[data-prop="fillColor"] button.wbi-color-btn').getAttribute('data-gradient')).toBe('1')

    // a solid color replaces the gradient
    await fill.locator('[data-prop="fillColor"] button.wbi-color-btn').click()
    await pop.getByRole('tab', { name: 'Solid' }).click()
    await pop.getByTitle(/^Theme color 4,/).click()
    await expect.poll(() => vc.locator('svg path').first().getAttribute('fill')).not.toMatch(/^url\(/)
    expect((await visualJson(page, shape.name)).annotations?.some((a: any) => a.name === 'Lumen_Fill') ?? false).toBe(false)
    // Undo brings the gradient back, Undo again the original color
    const undo = page.getByRole('button', { name: 'Undo', exact: true })
    await undo.click()
    await expect.poll(() => vc.locator('svg path').first().getAttribute('fill')).toMatch(/^url\(#lumen-gf-/)
    await undo.click()
    await expect.poll(() => vc.locator('svg path').first().getAttribute('fill')).not.toMatch(/^url\(/)
    expect((await visualJson(page, shape.name)).annotations?.some((a: any) => a.name === 'Lumen_Fill') ?? false).toBe(false)

    // General ▸ Effects ▸ Background of a chart
    const chart = (await visualStatuses(page)).find((v) => v.type !== 'shape' && v.state === 'ok' && /Chart$/.test(v.type))!
    await lumenEval(page, (l, n) => l.useApp.getState().selectVisuals([n]), chart.name)
    await page.locator('.wbi-fmt__pivot').getByRole('tab', { name: 'General' }).click()
    await openCard(page, /^Effects$/)
    const bg = await openCard(page, /^Background$/)
    await bg.locator('[data-prop="color"] button.wbi-color-btn').click()
    await pop.getByRole('tab', { name: 'Gradient' }).click()
    await pop.getByRole('radio', { name: '90°' }).click()
    await pop.getByRole('button', { name: 'Apply' }).click()
    const box = page.locator(`.wbi-page [data-visual="${chart.name}"] > .wbi-vc-box`)
    await expect.poll(() => box.evaluate((e) => getComputedStyle(e).backgroundImage)).toMatch(/^linear-gradient\(to right|^linear-gradient\(90deg/)

    // page format ▸ Canvas background: a radial gradient behind the visuals, stored on page.json
    await deselectAll(page)
    const canvas = await openCard(page, /^Canvas background$/)
    await canvas.locator('[data-prop="color"] button.wbi-color-btn').click()
    await pop.getByRole('tab', { name: 'Gradient' }).click()
    await pop.locator('[data-gradient-editor] .wbi-colorpop__sw').nth(2).click()
    await pop.getByRole('radio', { name: 'Radial' }).click()
    await pop.getByRole('button', { name: 'Apply' }).click()
    await expect.poll(() => page.locator('.wbi-page .wbi-page-bg').first().evaluate((e) => getComputedStyle(e).backgroundImage)).toMatch(/^radial-gradient\(/)
    const pageJson = await lumenEval(page, (l) => JSON.parse(JSON.stringify(l.useApp.getState().project!.report!.pages.find((p) => p.name === l.useApp.getState().activePage)!.json)))
    expect(pageJson.annotations.some((a: any) => a.name === 'Lumen_Fill')).toBe(true)
    await shot(page, 'gradient-canvas')
    expect(await rendererErrors(page)).toEqual([])
    await settle(page)
  })
})
