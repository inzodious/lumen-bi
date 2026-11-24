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

  it('moves both pages for the two-page transitions, zooms a drill-through and morphs a bookmark', async () => {
    const { page } = lumen()
    const setReportMotion = (motion: Record<string, unknown> | null) =>
      lumenEval(
        page,
        (l, m) =>
          l.useApp.getState().mutateReport('Motion', (r) => {
            r.report ??= {}
            const list = (r.report.annotations ?? []).filter((a: any) => a.name !== 'Lumen_Motion')
            if (m) list.push({ name: 'Lumen_Motion', value: JSON.stringify(m) })
            r.report.annotations = list
            // pages follow the report default
            for (const p of r.pages) if (p.json?.annotations) p.json.annotations = p.json.annotations.filter((a: any) => a.name !== 'Lumen_Motion')
          }),
        motion
      )
    const ghosts = () => page.evaluate(() => document.querySelectorAll('.wbi-viewport > .wbi-transition-ghost').length)
    /** watch for ghosts (still copies of the page that leaves) from now on */
    const watchGhosts = () =>
      page.evaluate(() => {
        const w = window as unknown as { __ghosts: Array<{ z: string; fly: boolean }>; __ghostObserver?: MutationObserver }
        w.__ghosts = []
        w.__ghostObserver?.disconnect()
        w.__ghostObserver = new MutationObserver((ms) => {
          for (const m of ms) for (const n of m.addedNodes) if (n instanceof HTMLElement && n.classList.contains('wbi-transition-ghost')) w.__ghosts.push({ z: n.style.zIndex, fly: n.classList.contains('wbi-transition-fly') })
        })
        w.__ghostObserver.observe(document.body, { childList: true, subtree: true })
      })
    const seenGhosts = () => page.evaluate(() => (window as unknown as { __ghosts: Array<{ z: string; fly: boolean }> }).__ghosts)
    await lumenEval(page, (l) => {
      l.setMotion('on')
      l.useApp.getState().setEditMode(false)
    })
    await goToPage(page, 'Products')
    await settle(page)
    for (const kind of ['push', 'depth', 'wipe', 'circle', 'morph']) {
      await setReportMotion({ transition: kind })
      await watchGhosts()
      await recordAnimations(page)
      await goToPage(page, kind === 'push' || kind === 'wipe' || kind === 'morph' ? 'Overview' : 'Products')
      await expect.poll(seenGhosts).toSatisfy((g: Array<{ z: string; fly: boolean }>) => g.filter((x) => !x.fly).length === 1 && g.find((x) => !x.fly)!.z === (kind === 'morph' ? '2' : '-1'))
      await expect.poll(() => recorded(page)).toSatisfy((a: Record<string, number>) => (a.page ?? 0) >= 1)
      // the ghost goes away when the transition ends
      await expect.poll(ghosts, { timeout: 5000 }).toBe(0)
    }
    // drill-through zoom: the page grows out of the visual clicked, Back shrinks it into that visual again
    await setReportMotion({ transition: 'none' })
    await goToPage(page, 'Overview')
    await settle(page)
    const chart = await visualByTitle(page, 'Sales by year and channel')
    const title = page.locator(`.wbi-page [data-visual="${chart}"] .wbi-vc-titles`)
    await title.dispatchEvent('pointerdown', { bubbles: true })
    await watchGhosts()
    await lumenEval(page, (l) => {
      l.motionNav.noteNavigation('drill')
      l.useApp.getState().setActivePage(l.useApp.getState().project!.report!.pages.find((p) => p.json?.displayName === 'Products')!.name)
    })
    await expect.poll(seenGhosts).toSatisfy((g: Array<{ z: string }>) => g.length === 1 && g[0].z === '-1')
    await expect.poll(ghosts, { timeout: 5000 }).toBe(0)
    await watchGhosts()
    await lumenEval(page, (l) => {
      l.motionNav.noteNavigation('back')
      l.useApp.getState().setActivePage(l.useApp.getState().project!.report!.pages.find((p) => p.json?.displayName === 'Overview')!.name)
    })
    await expect.poll(seenGhosts).toSatisfy((g: Array<{ z: string }>) => g.length === 1 && g[0].z === '2')
    await expect.poll(ghosts, { timeout: 5000 }).toBe(0)
    // bookmark morph: a visual the bookmark hides fades out (a still copy of it), and comes back with a fade in
    await settle(page)
    const hide = (hidden: boolean) =>
      lumenEval(
        page,
        (l, a) => {
          const s = l.useApp.getState()
          l.motionNav.beforeBookmark(s.activePage)
          s.patchReport((r) => {
            const v = r.pages.flatMap((p) => p.visuals).find((x) => x.name === a.name)!
            if (a.hidden) v.json.isHidden = true
            else delete v.json.isHidden
          }, 'Apply bookmark')
        },
        { name: chart, hidden }
      )
    await hide(true)
    await expect.poll(() => page.locator(`.wbi-page > .wbi-vc[data-visual="${chart}"][inert]`).count()).toBe(1)
    await expect.poll(() => page.locator(`.wbi-page > .wbi-vc[data-visual="${chart}"]`).count(), { timeout: 5000 }).toBe(0)
    await recordAnimations(page)
    await hide(false)
    await expect.poll(() => recorded(page)).toSatisfy((a: Record<string, number>) => (a.content ?? 0) >= 1)
    await expect.poll(() => animations(page), { timeout: 5000 }).toEqual({})
    await setReportMotion(null)
    await lumenEval(page, (l) => {
      l.setMotion(null)
      l.useApp.getState().setEditMode(true)
    })
  })
  it('keeps a pinned visual still while the page transitions around it, and sets it in General ▸ Animation', async () => {
    const { page } = lumen()
    const chart = await visualByTitle(page, 'Sales by year and channel')
    // the UI switch
    await page.locator(`.wbi-page [data-visual="${chart}"] .wbi-vc-titles`).click()
    await page.getByRole('tab', { name: 'Format visual' }).click()
    await page.locator('.wbi-fmt__pivot').getByRole('tab', { name: 'General' }).click()
    const pinRow = page.locator('.wbi-fmt__row', { hasText: 'Stay fixed during page transitions' })
    if (!(await pinRow.count())) await page.locator('.wbi-fmt__cards .wbi-card__header', { hasText: /^Animation$/ }).click()
    await pinRow.locator('[role=switch], button, input').first().click()
    await expect.poll(() => lumenEval(page, (l, name) => l.useApp.getState().project!.report!.pages.flatMap((p) => p.visuals).find((v) => v.name === name)!.json.annotations?.find((a: any) => a.name === 'Lumen_Motion')?.value, chart)).toBe('{"pinned":true}')
    // the same visual, pinned, in the same place on Products: it holds still while the pages push
    await lumenEval(page, (l, name) =>
      l.useApp.getState().mutateReport('Pin', (r) => {
        const src = r.pages.flatMap((p) => p.visuals).find((v) => v.name === name)!
        const products = r.pages.find((p) => p.json?.displayName === 'Products')!
        products.visuals = products.visuals.filter((v) => v.name !== 'pinned-copy')
        products.visuals.push({ name: 'pinned-copy', json: { ...JSON.parse(JSON.stringify(src.json)), name: 'pinned-copy', position: { ...src.json.position, z: 99000, tabOrder: 99000 } } })
        r.report ??= {}
        r.report.annotations = [...(r.report.annotations ?? []).filter((a: any) => a.name !== 'Lumen_Motion'), { name: 'Lumen_Motion', value: JSON.stringify({ transition: 'push', transitionDuration: 900 }) }]
        for (const p of r.pages) if (p.json?.annotations) p.json.annotations = p.json.annotations.filter((a: any) => a.name !== 'Lumen_Motion')
      }), chart)
    await lumenEval(page, (l) => {
      l.setMotion('on')
      l.useApp.getState().setEditMode(false)
    })
    await goToPage(page, 'Overview')
    await settle(page)
    await page.evaluate(() => {
      const w = window as unknown as { __pins: number; __pinObserver?: MutationObserver }
      w.__pins = 0
      w.__pinObserver?.disconnect()
      w.__pinObserver = new MutationObserver((ms) => {
        for (const m of ms) for (const n of m.addedNodes) if (n instanceof HTMLElement && n.classList.contains('wbi-transition-pin')) w.__pins++
      })
      w.__pinObserver.observe(document.body, { childList: true, subtree: true })
    })
    await goToPage(page, 'Products')
    await expect.poll(() => page.evaluate(() => (window as unknown as { __pins: number }).__pins)).toBe(1)
    // the new page's own copy is hidden under the still one until the transition ends, then takes over
    const copy = page.locator('.wbi-page .wbi-vc[data-visual="pinned-copy"]')
    await expect.poll(() => copy.getAttribute('data-pinned')).toBe('true')
    await expect.poll(() => page.locator('.wbi-transition-pin').count(), { timeout: 5000 }).toBe(0)
    await expect.poll(() => copy.evaluate((e) => (e as HTMLElement).style.visibility)).toBe('')
    await lumenEval(page, (l) => {
      l.useApp.getState().mutateReport('Unpin', (r) => {
        const products = r.pages.find((p) => p.json?.displayName === 'Products')!
        products.visuals = products.visuals.filter((v) => v.name !== 'pinned-copy')
        r.report.annotations = (r.report.annotations ?? []).filter((a: any) => a.name !== 'Lumen_Motion')
        for (const v of r.pages.flatMap((p) => p.visuals)) if (v.json?.annotations) v.json.annotations = v.json.annotations.filter((a: any) => a.name !== 'Lumen_Motion')
      })
      l.setMotion(null)
      l.useApp.getState().setEditMode(true)
    })
  })
})
