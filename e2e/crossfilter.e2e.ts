/** Microsoft's public "Store Sales" sample PBIX: published card value, pie-slice cross-filtering and clearing. */
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { SAMPLES_DIR, useLumen, visualStatuses, expectAllRendered, goToPage, visualByTitle, visualText, clickShape, untilVisualText, settle, pageTexts, pageMarkup } from './harness'

const STORE_SALES = SAMPLES_DIR ? join(SAMPLES_DIR, 'Store Sales.pbix') : ''

describe.skipIf(!STORE_SALES || !existsSync(STORE_SALES))('Store Sales sample (cross-filter)', () => {
  const lumen = useLumen({ open: STORE_SALES })

  it('opens with every visual rendered and the published card value', async () => {
    const { page } = lumen()
    await goToPage(page, 'Store Sales Overview')
    expectAllRendered(await visualStatuses(page))
    const card = await visualByTitle(page, 'This Year Sales')
    expect(await visualText(page, card)).toBe('$22M')
  })

  it('clicking a pie slice cross-filters the other visuals; clicking the background clears it', async () => {
    const { page } = lumen()
    const pie = await visualByTitle(page, 'This Year Sales by Chain')
    const card = await visualByTitle(page, 'This Year Sales')
    const before = await pageTexts(page)
    const markupBefore = await pageMarkup(page)
    // slices are ordered by value: the first one is "Fashions Direct" ($15.7M)
    await clickShape(page, pie, 'svg > path', 0)
    const filtered = await untilVisualText(page, card, (t) => t !== '$22M')
    expect(filtered).toMatch(/^\$1[56]M$/)
    await settle(page)
    const after = await pageMarkup(page)
    const changed = Object.keys(markupBefore).filter((k) => k !== pie && markupBefore[k] !== after[k])
    // the card (filter) plus the combo chart, scatter and map (highlight / filter) react to the selection
    expect(changed.length).toBeGreaterThanOrEqual(4)
    // the pie dims the unselected slice
    expect(await page.locator(`[data-visual="${pie}"] svg > path[opacity="0.4"], [data-visual="${pie}"] svg > path[opacity="0.3"]`).count()).toBeGreaterThan(0)
    // clear: click the pie's background
    const box = (await page.locator(`[data-visual="${pie}"] .wbi-vc-content svg`).first().boundingBox())!
    await page.mouse.click(box.x + 4, box.y + box.height - 4)
    await untilVisualText(page, card, (t) => t === '$22M')
    await settle(page)
    expect(await pageTexts(page)).toEqual(before)
  })
})
