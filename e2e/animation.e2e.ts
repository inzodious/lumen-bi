/**
 * Animation pane (Lumen extension): the page's sequence with a timeline, drag to reorder, the selected visual's start,
 * duration, curve and hover effect, page transition timing, and Play. Hover effects play in reading view and stay on
 * the canvas.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { OUT_DIR, useLumen, goToPage, lumenEval, settle, deselectAll } from './harness'

const motionOf = (json: any): any => {
  const a = (json?.annotations ?? []).find((x: any) => x.name === 'Lumen_Motion')
  return a ? JSON.parse(a.value) : {}
}

const pane = (page: Page) => page.locator('.wbi-pane[data-pane="animation"]')

async function pick(page: Page, title: string, option: string): Promise<void> {
  await pane(page).locator(`button.wbi-dropdown[title="${title}"]`).click()
  await page.locator('.wbi-menu [role="option"]', { hasText: new RegExp(`^${option.replace(/[()]/g, '\\$&')}$`) }).evaluate((e) => (e as HTMLElement).click())
}

async function spin(page: Page, label: string, value: number): Promise<void> {
  const input = pane(page).locator(`.wbi-spin input[aria-label="${label}"]`)
  await input.fill(String(value))
  await input.press('Enter')
}

const visualJson = (page: Page, name: string) => lumenEval(page, (l, n) => l.useApp.getState().project!.report!.pages.flatMap((p) => p.visuals).find((v) => v.name === n)!.json, name)
const sequence = (page: Page) => pane(page).locator('.wbi-anim__list > .wbi-anim__row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-visual')!))
const shot = (page: Page, name: string) => (process.env['LUMEN_DEMO_SHOTS'] ? page.screenshot({ path: join(process.env['LUMEN_DEMO_SHOTS'], name) }) : page.screenshot({ path: join(OUT_DIR, name) }))

describe('animation pane', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('lists the sequence, reorders it by drag and drop and sets the selected visual', async () => {
    const { page } = lumen()
    await goToPage(page, 'Overview')
    await settle(page)
    await deselectAll(page)
    await page.locator('.wbi-paneswitch button[aria-label="Animation"]').click()
    await expect.poll(() => pane(page).count()).toBe(1)
    const before = await sequence(page)
    expect(before.length).toBeGreaterThan(2)
    // every row has a bar on the shared timeline
    expect(await pane(page).locator('.wbi-anim__list > .wbi-anim__row .wbi-anim__bar').count()).toBe(before.length)
    await shot(page, 'animation-pane.png')

    // drag the last visual to the top of the sequence
    const last = before[before.length - 1]
    await pane(page).locator(`.wbi-anim__row[data-visual="${last}"]`).dragTo(pane(page).locator(`.wbi-anim__row[data-visual="${before[0]}"]`))
    await expect.poll(() => sequence(page)).toEqual([last, ...before.slice(0, -1)])
    expect(motionOf(await visualJson(page, last)).order).toBe(0)

    // the selected visual: starts after the previous ones, runs 900 ms on a linear curve, enlarges on hover
    const second = before[0]
    await pane(page).locator(`.wbi-anim__row[data-visual="${second}"]`).click()
    await pick(page, 'Start', 'After previous')
    await spin(page, 'Duration (ms)', 900)
    await pick(page, 'Curve', 'Linear')
    await pick(page, 'Hover effect', 'Enlarge')
    await expect.poll(async () => motionOf(await visualJson(page, second))).toMatchObject({ start: 'after', duration: 900, easing: 'linear', hover: 'enlarge', order: 1 })
    await expect.poll(() => pane(page).locator(`.wbi-anim__row[data-visual="${second}"] .wbi-anim__mode`).innerText()).toMatch(/after/i)

    // page timing
    await pick(page, 'Page transition', 'Push')
    await spin(page, 'Transition duration (ms)', 700)
    await pick(page, 'Transition curve', 'Overshoot')
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().project!.report!.pages.find((p) => p.json?.displayName === 'Overview')!.json)).toSatisfy((j: any) => {
      const m = motionOf(j)
      return m.transition === 'push' && m.transitionDuration === 700 && m.transitionEasing === 'overshoot'
    })
    await shot(page, 'animation-pane-visual.png')

    // Reset order goes back to reading order
    await pane(page).getByRole('button', { name: 'Reset order' }).click()
    await expect.poll(() => sequence(page)).toEqual(before)
  })

  it('plays the sequence with a playhead and enlarges a visual on hover inside the canvas', async () => {
    const { page } = lumen()
    const seq = await sequence(page)
    await lumenEval(page, (l) => l.setMotion('on'))
    await pane(page).getByRole('button', { name: 'Play', exact: true }).click()
    await expect.poll(() => pane(page).locator('.wbi-anim__playhead').count()).toBeGreaterThan(0)
    // the visuals run their entrances with the sequence's delays
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.id === 'wbi-motion').length)).toBeGreaterThan(0)

    const target = seq[0]
    await lumenEval(page, (l, n) =>
      l.useApp.getState().mutateReport('Hover', (r) => {
        const v = r.pages.flatMap((p) => p.visuals).find((x) => x.name === n)!
        v.json.annotations = [...(v.json.annotations ?? []).filter((a: any) => a.name !== 'Lumen_Motion'), { name: 'Lumen_Motion', value: JSON.stringify({ hover: 'enlarge', hoverAmount: 10 }) }]
      }), target)
    await lumenEval(page, (l) => l.useApp.getState().setEditMode(false))
    await settle(page)
    const vc = page.locator(`.wbi-page .wbi-vc[data-visual="${target}"]`)
    await expect.poll(() => vc.getAttribute('data-hover')).toBe('enlarge')
    await vc.hover()
    await expect.poll(() => vc.evaluate((e) => getComputedStyle(e).transform)).toMatch(/^matrix\(1\.1, 0, 0, 1\.1/)
    // the page clips its visuals, and the visual grows away from the canvas edge it touches
    expect(await page.locator('.wbi-page').evaluate((e) => getComputedStyle(e).overflow)).toBe('hidden')
    await shot(page, 'hover-enlarge.png')
    await page.mouse.move(2, 2)
    await lumenEval(page, (l) => {
      l.setMotion(null)
      l.useApp.getState().setEditMode(true)
    })
  })
})
