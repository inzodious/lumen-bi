/**
 * Motion (Lumen extension): page formatting ▸ Animations sets the page transition and the report's switches, a visual's
 * General ▸ Animation sets its entrance; e2e runs render still (--lumen-still) until a journey turns motion on, then
 * visual marks animate on entry, the page slides in reading view, and a cross-filter morphs the bars.
 */
import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { useLumen, goToPage, lumenEval, settle, visualByTitle, deselectAll, clickShape } from './harness'

/** Running Lumen animations, by what they animate ('page', a mark kind, or 'content'). */
async function animations(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const out: Record<string, number> = {}
    for (const a of document.getAnimations()) {
      if (a.id !== 'wbi-motion') continue
      const t = (a.effect as KeyframeEffect).target as Element
      const k = t.classList.contains('wbi-page-shadow') || t.classList.contains('wbi-page-outer') ? 'page' : (t.getAttribute('data-wbi-mark') ?? 'content')
      out[k] = (out[k] ?? 0) + 1
    }
    return out
  })
}

/** Record every Lumen animation that starts from now on (sampled each frame), by what it animates. */
async function recordAnimations(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __seen: Record<string, number>; __seenRaf?: number }
    w.__seen = {}
    const seen = new WeakSet<Animation>()
    const tick = () => {
      for (const a of document.getAnimations()) {
        if (a.id !== 'wbi-motion' || seen.has(a)) continue
        seen.add(a)
        const t = (a.effect as KeyframeEffect).target as Element
        const k = t.classList.contains('wbi-page-shadow') || t.classList.contains('wbi-page-outer') ? 'page' : (t.getAttribute('data-wbi-mark') ?? 'content')
        w.__seen[k] = (w.__seen[k] ?? 0) + 1
      }
      w.__seenRaf = requestAnimationFrame(tick)
    }
    if (w.__seenRaf) cancelAnimationFrame(w.__seenRaf)
    tick()
  })
}

const recorded = (page: Page) => page.evaluate(() => (window as unknown as { __seen: Record<string, number> }).__seen)

const annotation = (json: any): any => {
  const a = (json?.annotations ?? []).find((x: any) => x.name === 'Lumen_Motion')
  return a ? JSON.parse(a.value) : undefined
}

async function pick(page: Page, title: string, option: string): Promise<void> {
  await page.locator(`.wbi-fmt__cards button.wbi-dropdown[title="${title}"]`).click()
  // the list can open below the window's edge at the bottom of the pane: click it in place
  await page.locator('.wbi-menu [role="option"]', { hasText: new RegExp(`^${option}$`) }).evaluate((e) => (e as HTMLElement).click())
}

describe('motion', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('renders still in headless runs', async () => {
    const { page } = lumen()
    await goToPage(page, 'Products')
    await settle(page)
    expect(await animations(page)).toEqual({})
  })

  it('sets the page transition and the report switches in page formatting ▸ Animations', async () => {
    const { page } = lumen()
    await goToPage(page, 'Overview')
    await deselectAll(page)
    await page.getByRole('tab', { name: 'Format page' }).click()
    const card = page.locator('.wbi-fmt__cards .wbi-card').filter({ has: page.locator('.wbi-card__title', { hasText: /^Animations$/ }) })
    await card.locator('.wbi-card__header').first().click()
    await pick(page, 'Page transition', 'Slide')
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().project!.report!.pages.find((p) => p.json?.displayName === 'Overview')!.json)).toSatisfy((j: any) => annotation(j)?.transition === 'slide')
    await pick(page, 'Default page transition', 'Fade')
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().project!.report!.report)).toSatisfy((j: any) => annotation(j)?.transition === 'fade')
    // Power BI ignores the settings, and the card says so
    await expect(card.innerText()).resolves.toContain('Power BI keeps these settings but ignores them')
  })

  it("sets a visual's entrance in General ▸ Animation", async () => {
    const { page } = lumen()
    const name = await visualByTitle(page, 'Sales by category')
    await page.locator(`.wbi-page [data-visual="${name}"] .wbi-vc-titles`).click()
    await page.getByRole('tab', { name: 'Format visual' }).click()
    await page.locator('.wbi-fmt__pivot').getByRole('tab', { name: 'General' }).click()
    await page.locator('.wbi-fmt__cards .wbi-card__header', { hasText: /^Animation$/ }).click()
    await pick(page, 'Entrance', 'Rise')
    const json = () => lumenEval(page, (l, n) => l.useApp.getState().project!.report!.pages.flatMap((p) => p.visuals).find((v) => v.name === n)!.json, name)
    await expect.poll(json).toSatisfy((j: any) => annotation(j)?.entrance === 'rise')
    await pick(page, 'Entrance', 'Auto \\(by visual type\\)')
    await expect.poll(json).toSatisfy((j: any) => !annotation(j))
  })

  it('animates visuals, slides pages in reading view and morphs a cross-filter once motion is on', async () => {
    const { page } = lumen()
    await lumenEval(page, (l) => {
      l.setMotion('on')
      l.useApp.getState().setEditMode(false)
    })
    await goToPage(page, 'Products')
    await settle(page)
    await recordAnimations(page)
    await goToPage(page, 'Overview')
    await expect.poll(() => recorded(page)).toSatisfy((a: Record<string, number>) => a.page === 1 && (a['grow-up'] ?? 0) > 0 && (a['grow-right'] ?? 0) > 0 && (a.sweep ?? 0) > 0)
    await expect.poll(() => animations(page), { timeout: 5000 }).toEqual({})
    // cross-filter from the column chart: the line chart morphs (or reveals) to the filtered data
    const chart = await visualByTitle(page, 'Sales by year and channel')
    await recordAnimations(page)
    await clickShape(page, chart, 'rect[data-wbi-mark]', 0)
    await expect.poll(() => recorded(page)).toSatisfy((a: Record<string, number>) => Object.keys(a).length > 0 && !a.page)
    await expect.poll(() => animations(page), { timeout: 5000 }).toEqual({})
    // the DOM after the animations is exactly what the visuals rendered: no leftover styles
    expect(await page.evaluate(() => [...document.querySelectorAll('[data-wbi-mark]')].filter((e) => (e as HTMLElement).style?.transform || (e as HTMLElement).style?.opacity).length)).toBe(0)
    await lumenEval(page, (l) => {
      l.setMotion(null)
      l.useApp.getState().setEditMode(true)
    })
  })
})
