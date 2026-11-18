/**
 * Pages: duplicate a page from the page-tab context menu and from Insert ▸ New page ▸ Duplicate page (the copy has the
 * same visuals); Escape closes the page-tab menu; an edit that throws shows an error notification and changes nothing.
 */
import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { useLumen, goToPage, lumenEval, waitIdle, settle, visualStatuses, expectAllRendered, escapeRe } from './harness'

/** Display names of the page tabs, in order. */
const tabNames = (page: Page) => page.locator('.wbi-tabs [role="tab"] .wbi-tab-label').allInnerTexts()

/** Visual types (sorted) and display name of a page, from the document. */
async function pageSummary(page: Page, displayName: string): Promise<{ name: string; types: string[] } | null> {
  return lumenEval(
    page,
    (l, dn) => {
      const p = l.useApp.getState().project!.report!.pages.find((x) => x.json?.displayName === dn)
      return p ? { name: p.name, types: p.visuals.map((v) => String(v.json?.visual?.visualType ?? (v.json?.visualGroup ? 'group' : ''))).sort() } : null
    },
    displayName
  )
}

const tab = (page: Page, displayName: string) => page.locator('.wbi-tabs [role="tab"]').filter({ has: page.locator('.wbi-tab-label', { hasText: new RegExp(`^${escapeRe(displayName)}$`) }) })

describe('pages', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('Duplicate page from the page-tab menu: the copy follows the source, has the same visuals and opens', async () => {
    const { page } = lumen()
    await goToPage(page, 'Products')
    const errorsBefore = (await lumenEval(page, (l) => l.errors.length))
    const src = (await pageSummary(page, 'Products'))!
    expect(src.types.length).toBeGreaterThan(3)
    await tab(page, 'Products').click({ button: 'right' })
    const menu = page.locator('.wbi-tabs .wbi-menu')
    await menu.waitFor()
    await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
    await menu.getByRole('menuitem', { name: 'Duplicate page' }).click()
    await expect.poll(() => menu.count()).toBe(0)
    const names = await tabNames(page)
    expect(names[names.indexOf('Products') + 1]).toBe('Duplicate of Products')
    await expect.poll(() => page.locator('.wbi-tabs [role="tab"][aria-selected="true"] .wbi-tab-label').innerText()).toBe('Duplicate of Products')
    await waitIdle(page)
    await settle(page)
    const dup = (await pageSummary(page, 'Duplicate of Products'))!
    expect(dup.types).toEqual(src.types)
    expect(dup.name).not.toBe(src.name)
    expectAllRendered(await visualStatuses(page))
    expect(await lumenEval(page, (l, n) => l.errors.slice(n), errorsBefore)).toEqual([])
  })

  it('Insert ▸ New page ▸ Duplicate page duplicates the current page', async () => {
    const { page } = lumen()
    await goToPage(page, 'Overview')
    const src = (await pageSummary(page, 'Overview'))!
    await page.locator('.wbi-ribbon').getByRole('tab', { name: 'Insert' }).click()
    await page.locator('.wbi-ribbon').getByRole('button', { name: 'New page options' }).click()
    await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
    await page.getByRole('menuitem', { name: 'Duplicate page' }).click()
    await expect.poll(() => page.locator('.wbi-tabs [role="tab"][aria-selected="true"] .wbi-tab-label').innerText()).toBe('Duplicate of Overview')
    await waitIdle(page)
    await settle(page)
    expect((await pageSummary(page, 'Duplicate of Overview'))!.types).toEqual(src.types)
    expectAllRendered(await visualStatuses(page))
    // one undo step removes the copy again
    await page.keyboard.press('Control+z')
    await expect.poll(() => tabNames(page)).not.toContain('Duplicate of Overview')
    // and the page shown is an existing one, selected in the tabs
    await expect.poll(() => page.locator('.wbi-tabs [role="tab"][aria-selected="true"] .wbi-tab-label').allInnerTexts()).toEqual(['Overview'])
  })

  it('Escape closes the page-tab menu', async () => {
    const { page } = lumen()
    await tab(page, 'Overview').click({ button: 'right' })
    const menu = page.locator('.wbi-tabs .wbi-menu')
    await menu.waitFor()
    await page.keyboard.press('Escape')
    await expect.poll(() => menu.count()).toBe(0)
  })

  it('an edit that fails shows an error notification, closes the menu and leaves the report unchanged', async () => {
    const { page } = lumen()
    await goToPage(page, 'Overview')
    // make duplicating another (not displayed) page throw inside the store mutation: a stand-in for any defect in an edit
    await lumenEval(page, (l) => {
      const st = l.useApp.getState()
      const pages = st.project!.report!.pages
      const p = pages.find((x) => x.json?.displayName === 'Customers & Regions')!
      ;(window as unknown as { __visuals: unknown }).__visuals = p.visuals
      Object.defineProperty(p, 'visuals', {
        configurable: true,
        enumerable: true,
        get() {
          throw new Error('injected failure')
        }
      })
      ;(window as unknown as { __before: unknown }).__before = { report: st.project!.report, undo: st.undoStack.length }
    })
    try {
      const before = await tabNames(page)
      await tab(page, 'Customers & Regions').click({ button: 'right' })
      const menu = page.locator('.wbi-tabs .wbi-menu')
      await menu.getByRole('menuitem', { name: 'Duplicate page' }).click()
      await expect.poll(() => menu.count()).toBe(0)
      const toast = page.locator('.wbi-toast--error').filter({ hasText: 'Duplicate page' })
      await toast.waitFor()
      expect(await toast.innerText()).toMatch(/injected failure/)
      expect(await tabNames(page)).toEqual(before)
      const same = await lumenEval(page, (l) => {
        const st = l.useApp.getState()
        const b = (window as unknown as { __before: { report: unknown; undo: number } }).__before
        return st.project!.report === b.report && st.undoStack.length === b.undo
      })
      expect(same).toBe(true)
      await toast.getByRole('button', { name: 'Dismiss' }).click()
    } finally {
      await lumenEval(page, (l) => {
        const p = l.useApp.getState().project!.report!.pages.find((x) => x.json?.displayName === 'Customers & Regions')!
        // restore the plain data property the injected getter replaced
        Object.defineProperty(p, 'visuals', { configurable: true, enumerable: true, writable: true, value: (window as unknown as { __visuals: unknown }).__visuals })
      })
    }
  })
})
