/**
 * Performance analyzer, end to end: the toolbar never clips or overlaps (at the default, the previous default and the
 * narrowest pane width), recording logs one group per user action (refresh, slicer change, page change) with a row per
 * visual that expands into DAX query / Visual display / Other, sorting, Copy query → PBI's "// DAX Query" + EVALUATE
 * text, Export → JSON file, Stop stops, Clear empties.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { useLumen, visualByTitle, visualStatuses, goToPage, lumenEval, stubSaveDialog, untilNode } from './harness'

const PANE = 'section.wbi-pane[data-pane="performance"]'

/** Toolbar buttons that are clipped by the pane, overlap a neighbour, or whose own text doesn't fit. */
async function toolbarProblems(page: Page): Promise<string[]> {
  return page.evaluate((sel) => {
    const pane = document.querySelector(sel)!
    const body = pane.querySelector('.wbi-pane__body')!.getBoundingClientRect()
    const btns = Array.from(pane.querySelectorAll<HTMLElement>('.wbi-perf__btn, .wbi-perf__sort'))
    const out: string[] = []
    const rects = btns.map((b) => ({ name: b.textContent ?? '', r: b.getBoundingClientRect(), b }))
    for (const { name, r, b } of rects) {
      if (r.width < 20 || r.height < 16) out.push(`${name}: collapsed (${r.width}x${r.height})`)
      if (r.left < body.left - 0.5 || r.right > body.right + 0.5) out.push(`${name}: outside the pane (${r.left}–${r.right} vs ${body.left}–${body.right})`)
      if (b.scrollWidth > b.clientWidth + 1) out.push(`${name}: content clipped (${b.scrollWidth} > ${b.clientWidth})`)
      const label = b.querySelector('span')?.getBoundingClientRect()
      if (label && (label.left < r.left - 0.5 || label.right > r.right + 0.5)) out.push(`${name}: label sticks out of its button`)
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].r
        const c = rects[j].r
        if (a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5) out.push(`${rects[i].name} overlaps ${rects[j].name}`)
      }
    return out
  }, PANE)
}

const logLength = (page: Page) => lumenEval(page, (l) => l.useShell.getState().perfLog.length)
const titlesOf = (page: Page, action: string) => lumenEval(page, (l, a) => l.useShell.getState().perfLog.filter((e) => !e.marker && e.action === a).map((e) => e.title), action)

describe('performance analyzer', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('lays out the toolbar without clipping or overlap at any pane width', async () => {
    const { page } = lumen()
    await page.getByRole('toolbar', { name: 'Panes' }).getByRole('button', { name: 'Performance analyzer' }).click()
    const pane = page.locator(PANE)
    await pane.waitFor()
    const names = ['Start recording', 'Refresh visuals', 'Stop', 'Clear', 'Export']
    for (const n of names) await expect(pane.getByRole('button', { name: n, exact: true }).isVisible()).resolves.toBe(true)
    expect(await toolbarProblems(page)).toEqual([])
    // PBI layout at the default width: Start recording · Refresh visuals · Stop on the first row, Clear · Export below
    const top = (n: string) => pane.getByRole('button', { name: n, exact: true }).evaluate((b) => Math.round(b.getBoundingClientRect().top))
    expect(new Set([await top('Start recording'), await top('Refresh visuals'), await top('Stop')]).size).toBe(1)
    expect(await top('Clear')).toBeGreaterThan(await top('Stop'))
    expect(await top('Export')).toBe(await top('Clear'))
    // the previous default width (saved in existing profiles) and the narrowest the pane allows: buttons wrap, never clip
    for (const width of [300, 200]) {
      await lumenEval(page, (l, w) => l.useShell.getState().setPane('performance', { width: w }), width)
      await expect.poll(() => pane.evaluate((p) => Math.round(p.getBoundingClientRect().width))).toBe(width)
      expect(await toolbarProblems(page)).toEqual([])
    }
    // a saved width below the pane's minimum is clamped when rendering
    await lumenEval(page, (l) => l.useShell.getState().setPane('performance', { width: 60 }))
    await expect.poll(() => pane.evaluate((p) => Math.round(p.getBoundingClientRect().width))).toBe(200)
    await lumenEval(page, (l) => l.useShell.getState().setPane('performance', { width: 320 }))
  })

  it('records refresh, slicer and page actions; rows expand into query / display / other; sorts; copies; exports; stops; clears', async () => {
    const { page, app, tmp } = lumen()
    const pane = page.locator(PANE)
    const start = pane.getByRole('button', { name: 'Start recording', exact: true })
    const stop = pane.getByRole('button', { name: 'Stop', exact: true })
    const refresh = pane.getByRole('button', { name: 'Refresh visuals', exact: true })
    await expect(stop.isDisabled()).resolves.toBe(true)
    await expect(refresh.isDisabled()).resolves.toBe(true)
    await expect(pane.getByRole('button', { name: 'Export', exact: true }).isDisabled()).resolves.toBe(true)

    // --- start: nothing is logged until the report is used
    await start.click()
    await expect.poll(() => start.isDisabled()).toBe(true)
    await expect(stop.isDisabled()).resolves.toBe(false)
    await pane.locator('.wbi-perf__action[data-action="Recording started"]').waitFor()
    expect(await pane.locator('.wbi-perf__row').count()).toBe(0)

    // --- Refresh visuals: one row per visual of the page under "Refreshed visual"
    const onPage = await visualStatuses(page)
    await refresh.click()
    await expect.poll(() => titlesOf(page, 'Refreshed visual').then((t) => t.length)).toBe(onPage.length)
    await pane.locator('.wbi-perf__action[data-action="Refreshed visual"]').waitFor()
    expect(await pane.locator('.wbi-perf__action[data-action="Refreshed visual"]').count()).toBe(1)
    expect(await pane.locator('.wbi-perf__row').count()).toBe(onPage.length)
    const title = 'Sales by category'
    const name = await visualByTitle(page, title)
    const item = pane.locator(`.wbi-perf__item[data-visual="${name}"]`).first()
    const num = async (loc: ReturnType<typeof item.locator>) => Number((await loc.innerText()).replace(/[^\d.-]/g, ''))
    await expect(item.locator('.wbi-perf__name').innerText()).resolves.toBe(title)
    const total = await num(item.locator('.wbi-perf__row .wbi-perf__ms'))
    expect(total).toBeGreaterThanOrEqual(0)

    // --- expand: DAX query / Visual display / Other, which add up to the row's duration (each rounded)
    await item.locator('.wbi-perf__row').click()
    await expect(item.locator('.wbi-perf__part').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.part))).resolves.toEqual(['DAX query', 'Visual display', 'Other'])
    const parts = await Promise.all(['DAX query', 'Visual display', 'Other'].map((p) => num(item.locator(`.wbi-perf__part[data-part="${p}"] .wbi-perf__ms`))))
    expect(Math.abs(parts[0] + parts[1] + parts[2] - total)).toBeLessThanOrEqual(2)
    // a text box runs no query: no "DAX query" line, no Copy query
    const textbox = onPage.find((v) => v.type === 'textbox')!
    const tb = pane.locator(`.wbi-perf__item[data-visual="${textbox.name}"]`).first()
    await tb.locator('.wbi-perf__row').click()
    await expect(tb.locator('.wbi-perf__part').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.part))).resolves.toEqual(['Visual display', 'Other'])
    expect(await tb.locator('.wbi-perf__copy').count()).toBe(0)

    // --- Copy query: the DAX the visual ran
    await app.evaluate(({ clipboard }) => clipboard.writeText(''))
    await item.locator('.wbi-perf__copy').click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(/^\/\/ DAX Query\r?\n/)
    const text = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(text).toMatch(/\bEVALUATE\b/)
    // the header appears once per query (not duplicated)
    expect(text.split('\n\n')[0].match(/\/\/ DAX Query/g)?.length).toBe(1)

    // --- change a slicer: a new group with the visuals that queried again (no shapes / text boxes), not a full reload
    const slicer = page.locator('.wbi-page [data-type="slicer"]').filter({ hasText: /^Year/ })
    await slicer.getByRole('combobox').click()
    await page.locator('.wbi-slicer-popup').getByRole('option', { name: '2024', exact: true }).click()
    await expect.poll(() => titlesOf(page, 'Changed a slicer').then((t) => t.includes(title))).toBe(true)
    await page.keyboard.press('Escape')
    const afterSlicer = await titlesOf(page, 'Changed a slicer')
    expect(afterSlicer).toContain('Year')
    expect(afterSlicer).not.toContain('Text box')
    expect(afterSlicer).not.toContain('Shape')
    expect(new Set(afterSlicer).size).toBe(afterSlicer.length)
    // one gesture = one group in the pane
    await expect.poll(() => pane.locator('.wbi-perf__action[data-action="Changed a slicer"]').count()).toBe(1)

    // --- switch page: the visuals of the new page under "Changed page"
    await goToPage(page, 1)
    const page2 = await visualStatuses(page)
    await expect.poll(() => titlesOf(page, 'Changed page').then((t) => t.length)).toBe(page2.length)
    await pane.locator('.wbi-perf__action[data-action="Changed page"]').waitFor()

    // --- sort by duration (slowest first, then fastest first), by name, and back to action order
    const durations = () => pane.locator('.wbi-perf__row .wbi-perf__ms').evaluateAll((els) => els.map((e) => Number((e.textContent ?? '').replace(/[^\d.-]/g, ''))))
    const rowNames = () => pane.locator('.wbi-perf__row .wbi-perf__name').evaluateAll((els) => els.map((e) => e.textContent ?? ''))
    const sortBy = (label: string) => pane.getByRole('columnheader', { name: label })
    const count = (await rowNames()).length
    await sortBy('Duration (ms)').click()
    await expect(sortBy('Duration (ms)').getAttribute('aria-sort')).resolves.toBe('descending')
    expect(await pane.locator('.wbi-perf__action').count()).toBe(0)
    let d = await durations()
    expect(d).toHaveLength(count)
    expect(d).toEqual([...d].sort((a, b) => b - a))
    await sortBy('Duration (ms)').click()
    d = await durations()
    expect(d).toEqual([...d].sort((a, b) => a - b))
    await sortBy('Name').click()
    await expect(sortBy('Name').getAttribute('aria-sort')).resolves.toBe('ascending')
    await expect(sortBy('Duration (ms)').getAttribute('aria-sort')).resolves.toBe('none')
    const sortedNames = await rowNames()
    expect(sortedNames).toEqual([...sortedNames].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })))
    await sortBy('Name').click()
    await sortBy('Name').click()
    await expect(sortBy('Name').getAttribute('aria-sort')).resolves.toBe('none')
    expect(await pane.locator('.wbi-perf__action').count()).toBeGreaterThanOrEqual(4)

    // --- Export: a JSON file with the actions, the visuals and their parts
    const file = join(tmp, 'perf.json')
    await stubSaveDialog(app, file)
    await pane.getByRole('button', { name: 'Export', exact: true }).click()
    const doc = await untilNode(() => JSON.parse(readFileSync(file, 'utf8')), 15_000, 'the exported performance file')
    expect(doc.version).toBe('1.1.0')
    const actions = doc.events.filter((e: { name: string }) => e.name === 'User Action').map((e: { metrics: { sourceLabel: string } }) => e.metrics.sourceLabel)
    expect(actions).toEqual(expect.arrayContaining(['Recording started', 'Refreshed visual', 'Changed a slicer', 'Changed page']))
    const visuals = doc.events.filter((e: { name: string }) => e.name === 'Visual Container Lifecycle')
    expect(visuals).toHaveLength(count)
    const exported = visuals.find((v: { metrics: { visualTitle: string } }) => v.metrics.visualTitle === title)
    const query = doc.events.find((e: { name: string; parentId: string }) => e.name === 'Query' && e.parentId === exported.id)
    expect(query.metrics.QueryText[0]).toMatch(/^\/\/ DAX Query\r?\n[\s\S]*\bEVALUATE\b/)

    // --- Stop: interacting no longer logs
    await stop.click()
    await expect.poll(() => start.isDisabled()).toBe(false)
    const frozen = await logLength(page)
    await goToPage(page, 0)
    await pane.getByRole('button', { name: 'Refresh visuals', exact: true }).isDisabled()
    expect(await logLength(page)).toBe(frozen)
    expect((await rowNames()).length).toBe(count)

    // --- Clear: back to the hint, Export disabled
    await pane.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect.poll(() => pane.locator('.wbi-perf__row').count()).toBe(0)
    expect(await logLength(page)).toBe(0)
    await expect(pane.locator('.wbi-pane__empty').innerText()).resolves.toMatch(/Start recording/)
    await expect(pane.getByRole('button', { name: 'Export', exact: true }).isDisabled()).resolves.toBe(true)
    await expect(pane.getByRole('button', { name: 'Clear', exact: true }).isDisabled()).resolves.toBe(true)
  })
})
