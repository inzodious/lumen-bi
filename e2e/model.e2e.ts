/**
 * Model view — Lumen's diagram additions:
 *  (a) relationship lines: bend by dragging (pinch point), undo / redo, line style, save → reopen;
 *  (b) table groups: group two tables, rename, move (tables follow), save → reopen, collapse / expand, ungroup;
 *  (c) dragging a column onto another table's column previews the line and opens the relationship dialog.
 * `LUMEN_E2E_SHOTS=<dir>` additionally saves screenshots of the key states.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { useLumen, lumenEval, openFile, stubSaveDialog, untilNode } from './harness'

const SIDECAR = 'diagramLayout.lumen.json'
const SHOTS = process.env['LUMEN_E2E_SHOTS'] ?? ''

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

async function toModelView(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Model view' }).click()
  await page.locator('.wbi-mv-card').first().waitFor()
  await page.locator('.wbi-mv-edge').first().waitFor()
}

interface Sidecar {
  version: number
  diagrams: Array<{ name: string; lineStyle?: string; routes?: Record<string, { style?: string; waypoints?: Array<{ x: number; y: number }> }>; groups?: Array<{ id: string; name: string; tables: Array<{ name: string }>; collapsed?: boolean }> }>
}
const sidecar = (page: Page): Promise<Sidecar | null> =>
  lumenEval(page, (l) => {
    const t = l.useApp.getState().project!.model.sidecarFiles?.['diagramLayout.lumen.json']
    return t ? JSON.parse(t) : null
  })
const undoDepth = (page: Page): Promise<number> => lumenEval(page, (l) => l.useApp.getState().undoStack.length)
const dirty = (page: Page): Promise<boolean> => lumenEval(page, (l) => l.useApp.getState().project!.dirty)

/** Screen point at `fraction` of the visible line of edge #index. */
async function pointOnEdge(page: Page, index: number, fraction = 0.5): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([i, f]) => {
      const p = document.querySelectorAll<SVGPathElement>('.wbi-mv-edge .wbi-mv-edge__line')[i]
      const pt = p.getPointAtLength(p.getTotalLength() * f)
      const m = p.getScreenCTM()!
      return { x: pt.x * m.a + pt.y * m.c + m.e, y: pt.x * m.b + pt.y * m.d + m.f }
    },
    [index, fraction] as const
  )
}

/** Index of a relationship line whose midpoint is not covered by a card (so it can be grabbed there). */
async function grabbableEdge(page: Page): Promise<number> {
  const i = await page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll<SVGPathElement>('.wbi-mv-edge .wbi-mv-edge__line'))
    return lines.findIndex((p) => {
      const pt = p.getPointAtLength(p.getTotalLength() / 2)
      const m = p.getScreenCTM()!
      const el = document.elementFromPoint(pt.x * m.a + pt.y * m.c + m.e, pt.x * m.b + pt.y * m.d + m.f)
      return el?.closest('.wbi-mv-edge') === p.closest('.wbi-mv-edge')
    })
  })
  expect(i).toBeGreaterThanOrEqual(0)
  return i
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, opts: { steps?: number; hold?: () => Promise<void> } = {}): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: opts.steps ?? 8 })
  if (opts.hold) await opts.hold()
  await page.mouse.up()
}

const box = async (page: Page, selector: string): Promise<{ x: number; y: number; width: number; height: number }> => (await page.locator(selector).boundingBox())!
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Diagram tools' })

async function saveAsPbip(page: Page, app: Parameters<typeof stubSaveDialog>[0], target: string): Promise<void> {
  await stubSaveDialog(app, target)
  await page.keyboard.press('Control+Shift+S')
  await untilNode(() => existsSync(target), 30_000, 'saved .pbip')
  await expect.poll(() => dirty(page)).toBe(false)
}

describe('model view: editable relationship lines', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('bend a line by dragging, undo, redo, change the style, save and reopen', async () => {
    const { page, app, tmp } = lumen()
    await toModelView(page)
    expect(await sidecar(page)).toBeNull()
    const rels = await page.locator('.wbi-mv-edge').count()
    const index = await grabbableEdge(page)
    const edge = page.locator('.wbi-mv-edge').nth(index)
    const rel = (await edge.getAttribute('data-rel'))!
    // built-in default: curved lines (a project without the sidecar stores no style)
    expect(await edge.getAttribute('data-style')).toBe('curved')
    const depth = await undoDepth(page)

    // hover highlights the line
    const mid = await pointOnEdge(page, index)
    await page.mouse.move(mid.x, mid.y)
    await expect.poll(() => edge.getAttribute('class')).toContain('is-active')

    // drag the line: a pinch point appears under the cursor and follows it
    const target = { x: mid.x + 70, y: mid.y - 60 }
    await drag(page, mid, target)
    const wp = page.locator(`.wbi-mv-wp[data-index="0"]`)
    await expect.poll(() => wp.count()).toBe(1)
    await expect.poll(() => edge.getAttribute('data-waypoints')).toBe('1')
    const dot = await box(page, '.wbi-mv-wp[data-index="0"] .wbi-mv-wp__dot')
    // (snapped to the grid / alignment: within a few px of where it was dropped)
    expect(Math.abs(dot.x + dot.width / 2 - target.x)).toBeLessThan(10)
    expect(Math.abs(dot.y + dot.height / 2 - target.y)).toBeLessThan(10)
    const afterBend = (await sidecar(page))!
    expect(afterBend.diagrams[0].routes![rel].waypoints).toHaveLength(1)
    expect(await undoDepth(page)).toBe(depth + 1)
    expect(await dirty(page)).toBe(true)
    await shot(page, 'line-bent-curved')

    // undo removes the pinch point (and the sidecar: nothing custom is left), redo brings it back
    await page.keyboard.press('Control+Z')
    await expect.poll(() => wp.count()).toBe(0)
    expect(await sidecar(page)).toBeNull()
    await page.keyboard.press('Control+Y')
    await expect.poll(() => wp.count()).toBe(1)
    expect(await sidecar(page)).toEqual(afterBend)

    // the line style applies to every line of the layout and is undoable too
    await toolbar(page).getByRole('button', { name: 'Straight lines' }).click()
    await expect.poll(() => page.locator('.wbi-mv-edge[data-style="straight"]').count()).toBe(rels)
    expect(await edge.locator('.wbi-mv-edge__line').getAttribute('d')).not.toMatch(/ C/)
    expect((await sidecar(page))!.diagrams[0].lineStyle).toBe('straight')
    await shot(page, 'line-bent-straight')
    await page.keyboard.press('Control+Z')
    await expect.poll(() => page.locator('.wbi-mv-edge[data-style="curved"]').count()).toBe(rels)
    await page.keyboard.press('Control+Y')
    await expect.poll(() => page.locator('.wbi-mv-edge[data-style="straight"]').count()).toBe(rels)
    // back to curved: the built-in default is not stored
    await toolbar(page).getByRole('button', { name: 'Curved lines' }).click()
    await expect.poll(() => page.locator('.wbi-mv-edge[data-style="curved"]').count()).toBe(rels)
    const d = await edge.locator('.wbi-mv-edge__line').getAttribute('d')
    expect(d).toMatch(/ C/)
    expect((d!.match(/ C/g) ?? []).length).toBe(2) // two Bézier segments meeting in the pinch point
    expect((await sidecar(page))!.diagrams[0].lineStyle).toBeUndefined()
    // markers are still there in the curved style
    expect(await edge.locator('.wbi-mv-edge__card').count()).toBe(2)
    expect(await edge.locator('.wbi-mv-edge__dir path').count()).toBeGreaterThan(0)
    await page.mouse.move(target.x, target.y)
    await shot(page, 'line-curved-pinch-point')

    // a second pinch point, then move the first one
    const further = await pointOnEdge(page, index, 0.85)
    await drag(page, further, { x: further.x + 30, y: further.y + 70 })
    await expect.poll(() => edge.getAttribute('data-waypoints')).toBe('2')
    const first = await box(page, '.wbi-mv-wp[data-index="0"] .wbi-mv-wp__dot')
    const firstCentre = { x: first.x + first.width / 2, y: first.y + first.height / 2 }
    const before = (await sidecar(page))!.diagrams[0].routes![rel].waypoints![0]
    await drag(page, firstCentre, { x: firstCentre.x - 40, y: firstCentre.y })
    await expect.poll(async () => (await sidecar(page))!.diagrams[0].routes![rel].waypoints![0].x).toBeLessThan(before.x - 20)
    await shot(page, 'line-curved-two-pinch-points')

    // orthogonal style: right-angled legs with the same pinch points
    await toolbar(page).getByRole('button', { name: 'Orthogonal lines' }).click()
    await expect.poll(() => page.locator('.wbi-mv-edge[data-style="orthogonal"]').count()).toBe(rels)
    await shot(page, 'line-orthogonal')
    // leave a stored, non-default layout style for the save / reopen check below
    await toolbar(page).getByRole('button', { name: 'Straight lines' }).click()
    await expect.poll(() => page.locator('.wbi-mv-edge[data-style="straight"]').count()).toBe(rels)

    // double-click a pinch point to remove it
    const second = await box(page, '.wbi-mv-wp[data-index="1"] .wbi-mv-wp__dot')
    await page.mouse.dblclick(second.x + second.width / 2, second.y + second.height / 2)
    await expect.poll(() => edge.getAttribute('data-waypoints')).toBe('1')

    // save as PBIP: the sidecar sits beside diagramLayout.json; reopen restores routing and style
    const pbip = join(tmp, 'lines', 'Lines.pbip')
    const expected = (await sidecar(page))!
    await saveAsPbip(page, app, pbip)
    const file = join(tmp, 'lines', 'Lines.SemanticModel', SIDECAR)
    expect(existsSync(file)).toBe(true)
    expect(existsSync(join(tmp, 'lines', 'Lines.SemanticModel', 'diagramLayout.json'))).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(expected)
    await openFile(page, pbip)
    await toModelView(page)
    expect(await sidecar(page)).toEqual(expected)
    const reopened = page.locator(`.wbi-mv-edge[data-rel="${rel}"]`)
    expect(await reopened.getAttribute('data-style')).toBe('straight')
    expect(expected.diagrams[0].lineStyle).toBe('straight')
    expect(await reopened.getAttribute('data-waypoints')).toBe('1')
    expect(await page.locator('.wbi-mv-wp').count()).toBe(1)
    expect(await dirty(page)).toBe(false)

    // select the pinch point and press Delete: the line is plain again, the relationship stays
    const last = await box(page, '.wbi-mv-wp[data-index="0"] .wbi-mv-wp__dot')
    await page.mouse.click(last.x + last.width / 2, last.y + last.height / 2)
    await expect.poll(() => page.locator('.wbi-mv-wp.is-selected').count()).toBe(1)
    await page.keyboard.press('Delete')
    await expect.poll(() => page.locator('.wbi-mv-wp').count()).toBe(0)
    expect(await page.locator('.wbi-mv-edge').count()).toBe(rels)
    expect((await sidecar(page))!.diagrams[0].routes).toBeUndefined()
  })

  it('dragging a column onto another table previews the line and opens the relationship dialog', async () => {
    const { page } = lumen()
    await toModelView(page)
    const from = await box(page, '.wbi-mv-card[data-table="Customer"] .wbi-mv-field[data-field="City"]')
    const to = await box(page, '.wbi-mv-card[data-table="Store"] .wbi-mv-field[data-field="City"]')
    const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
    const b = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
    await drag(page, a, b, {
      steps: 12,
      hold: async () => {
        // live preview in the layout's line style, attached to the column under the cursor
        const preview = page.locator('.wbi-mv-link')
        await expect.poll(() => preview.count()).toBe(1)
        const style = await page.locator('.wbi-mv__canvas').getAttribute('data-line-style')
        expect(await preview.getAttribute('d')).toMatch(style === 'curved' ? / C/ : style === 'orthogonal' ? / Q| L/ : / L/)
        await expect.poll(() => page.locator('.wbi-mv-card[data-table="Store"] .wbi-mv-field[data-field="City"]').getAttribute('class')).toContain('is-highlighted')
        await shot(page, 'connect-preview')
      }
    })
    const dialog = page.getByRole('dialog', { name: 'New relationship' })
    await dialog.waitFor()
    expect(await page.locator('.wbi-mv-link').count()).toBe(0)
    // both ends are pre-filled from the drag
    const text = await dialog.innerText()
    expect(text).toContain('Customer')
    expect(text).toContain('Store')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect.poll(() => dialog.count()).toBe(0)
  })
})

describe('model view: line ends and reset', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('drag a line end to another side of its table, snap a pinch point to the grid, reset the line', async () => {
    const { page } = lumen()
    await toModelView(page)
    const index = await grabbableEdge(page)
    const edge = page.locator('.wbi-mv-edge').nth(index)
    const rel = (await edge.getAttribute('data-rel'))!
    const toTable = await lumenEval(page, (l, name) => l.useApp.getState().project!.model.relationships.find((r) => r.name === name)!.toTable, rel)
    const route = async () => (await sidecar(page))?.diagrams[0]?.routes?.[rel] as { to?: { side: string; t: number }; waypoints?: Array<{ x: number; y: number }> } | undefined

    // select the line: its two ends become draggable handles
    const mid = await pointOnEdge(page, index)
    await page.mouse.click(mid.x, mid.y)
    const end = page.locator(`.wbi-mv-end[data-end="to"]`)
    await expect.poll(() => end.count()).toBe(1)
    const handle = await box(page, '.wbi-mv-end[data-end="to"] .wbi-mv-end__dot')
    const card = await box(page, `.wbi-mv-card[data-table="${toTable}"]`)
    // drag it to just above the middle of the card's top edge: it attaches there (snapped to the middle)
    await drag(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, { x: card.x + card.width / 2 + 3, y: card.y - 14 }, { steps: 12 })
    await expect.poll(async () => (await route())?.to?.side).toBe('top')
    expect((await route())!.to!.t).toBe(0.5)
    const moved = await box(page, '.wbi-mv-end[data-end="to"] .wbi-mv-end__dot')
    expect(Math.abs(moved.y + moved.height / 2 - card.y)).toBeLessThan(3)
    expect(Math.abs(moved.x + moved.width / 2 - (card.x + card.width / 2))).toBeLessThan(3)
    expect(await end.getAttribute('class')).toContain('is-manual')

    // a pinch point dropped anywhere lands on the 10 px diagram grid (or on an alignment guide); with Alt it does not snap
    const p1 = await pointOnEdge(page, index, 0.4)
    await drag(page, p1, { x: p1.x - 47, y: p1.y + 33 })
    await expect.poll(async () => (await route())?.waypoints?.length).toBe(1)
    const w = (await route())!.waypoints![0]
    const centres = await page.locator('.wbi-mv-card').evaluateAll((els) => els.map((e) => ({ x: (e as HTMLElement).offsetLeft + (e as HTMLElement).offsetWidth / 2, y: (e as HTMLElement).offsetTop + (e as HTMLElement).offsetHeight / 2 })))
    const onGridOrGuide = (v: number, others: number[]): boolean => Math.abs(v / 10 - Math.round(v / 10)) < 1e-6 || others.some((o) => Math.abs(o - v) < 0.01)
    expect(onGridOrGuide(w.x, centres.map((c) => c.x))).toBe(true)
    await page.keyboard.down('Alt')
    const dot = await box(page, '.wbi-mv-wp[data-index="0"] .wbi-mv-wp__dot')
    await drag(page, { x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 }, { x: dot.x + dot.width / 2 + 23.4, y: dot.y + dot.height / 2 + 17.3 })
    await page.keyboard.up('Alt')
    await expect.poll(async () => (await route())!.waypoints![0].x).not.toBe(w.x)
    const free = (await route())!.waypoints![0]
    expect(Math.abs(free.x / 10 - Math.round(free.x / 10)) > 1e-6 || Math.abs(free.y / 10 - Math.round(free.y / 10)) > 1e-6).toBe(true)

    // per-line style override, then "Reset line" from the line's menu puts everything back
    const p2 = await pointOnEdge(page, index, 0.15)
    await page.mouse.click(p2.x, p2.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Line style' }).hover()
    await page.getByRole('menuitem', { name: 'Orthogonal' }).click()
    await expect.poll(() => edge.getAttribute('data-style')).toBe('orthogonal')
    expect(await page.locator('.wbi-mv-edge[data-style="orthogonal"]').count()).toBe(1)
    const p3 = await pointOnEdge(page, index, 0.1)
    await page.mouse.click(p3.x, p3.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Reset line' }).click()
    await expect.poll(() => edge.getAttribute('data-style')).toBe('curved')
    expect(await edge.getAttribute('data-waypoints')).toBe('0')
    expect(await route()).toBeUndefined()
    expect((await sidecar(page))?.diagrams[0]?.routes).toBeUndefined()
  })
})

describe('model view: table groups', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('group two tables, rename, move, save and reopen, collapse, ungroup', async () => {
    const { page, app, tmp } = lumen()
    await toModelView(page)
    const cards = await page.locator('.wbi-mv-card').count()
    const rels = await page.locator('.wbi-mv-edge').count()
    const group = page.locator('.wbi-mv-group')
    const groupBtn = toolbar(page).getByRole('button', { name: /^Group/ })
    const ungroupBtn = toolbar(page).getByRole('button', { name: /^Ungroup/ })
    expect(await groupBtn.isDisabled()).toBe(true)

    // select two cards (click + Ctrl-click) and group them from the toolbar
    await page.locator('.wbi-mv-card[data-table="Product"] .wbi-mv-card__title').click()
    await page.locator('.wbi-mv-card[data-table="Store"] .wbi-mv-card__title').click({ modifiers: ['Control'] })
    await expect.poll(() => page.locator('.wbi-mv-card.is-selected').count()).toBe(2)
    const depth = await undoDepth(page)
    await groupBtn.click()
    await expect.poll(() => group.count()).toBe(1)
    expect(await undoDepth(page)).toBe(depth + 1)
    let side = (await sidecar(page))!
    expect(side.diagrams[0].groups!.map((g) => g.tables.map((t) => t.name).sort())).toEqual([['Product', 'Store']])
    // the container surrounds both cards
    const g0 = await box(page, '.wbi-mv-group')
    for (const t of ['Product', 'Store']) {
      const c = await box(page, `.wbi-mv-card[data-table="${t}"]`)
      expect(c.x).toBeGreaterThan(g0.x)
      expect(c.y).toBeGreaterThan(g0.y)
      expect(c.x + c.width).toBeLessThan(g0.x + g0.width)
      expect(c.y + c.height).toBeLessThan(g0.y + g0.height)
    }

    // rename by double-clicking the label
    await page.locator('.wbi-mv-group__label').dblclick()
    const input = page.locator('.wbi-mv-group__input')
    await input.waitFor()
    await input.fill('Dimensions')
    await input.press('Enter')
    await expect.poll(() => page.locator('.wbi-mv-group__label').innerText()).toBe('Dimensions')
    expect((await sidecar(page))!.diagrams[0].groups![0].name).toBe('Dimensions')
    await shot(page, 'group')

    // undo / redo the rename
    await page.keyboard.press('Control+Z')
    await expect.poll(() => page.locator('.wbi-mv-group__label').innerText()).toBe('Group 1')
    await page.keyboard.press('Control+Y')
    await expect.poll(() => page.locator('.wbi-mv-group__label').innerText()).toBe('Dimensions')

    // drag the container: both tables move with it
    const before = { product: await box(page, '.wbi-mv-card[data-table="Product"]'), store: await box(page, '.wbi-mv-card[data-table="Store"]'), sales: await box(page, '.wbi-mv-card[data-table="Sales"]') }
    const g1 = await box(page, '.wbi-mv-group')
    const grip = { x: g1.x + g1.width / 2, y: g1.y + 9 }
    await drag(page, grip, { x: grip.x + 90, y: grip.y + 50 })
    await expect.poll(async () => Math.round((await box(page, '.wbi-mv-card[data-table="Product"]')).x - before.product.x)).toBeGreaterThan(80)
    const after = { product: await box(page, '.wbi-mv-card[data-table="Product"]'), store: await box(page, '.wbi-mv-card[data-table="Store"]'), sales: await box(page, '.wbi-mv-card[data-table="Sales"]') }
    for (const t of ['product', 'store'] as const) {
      expect(Math.abs(after[t].x - before[t].x - 90)).toBeLessThan(2)
      expect(Math.abs(after[t].y - before[t].y - 50)).toBeLessThan(2)
    }
    expect(after.sales.x).toBe(before.sales.x)
    const g2 = await box(page, '.wbi-mv-group')
    expect(Math.abs(g2.x - g1.x - 90)).toBeLessThan(2)
    // resize handles give the selected container extra room; "Fit to tables" takes it back
    await page.mouse.click(g2.x + g2.width / 2, g2.y + 9)
    const se = page.locator('.wbi-mv-group__handle.is-se')
    await se.waitFor()
    const h = (await se.boundingBox())!
    await drag(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 }, { x: h.x + h.width / 2 + 60, y: h.y + h.height / 2 + 40 })
    await expect.poll(async () => (await sidecar(page))!.diagrams[0].groups![0]).toHaveProperty('bounds')
    const g2b = await box(page, '.wbi-mv-group')
    expect(Math.abs(g2b.width - g2.width - 60)).toBeLessThan(2)
    expect(Math.abs(g2b.height - g2.height - 40)).toBeLessThan(2)
    await page.locator('.wbi-mv-group').click({ button: 'right', position: { x: g2.width / 2, y: 9 } })
    await page.getByRole('menuitem', { name: 'Fit to tables' }).click()
    await expect.poll(async () => (await sidecar(page))!.diagrams[0].groups![0]).not.toHaveProperty('bounds')
    // a different colour from the container's menu
    await page.locator('.wbi-mv-group').click({ button: 'right', position: { x: g2.width / 2, y: 9 } })
    await page.getByRole('menuitem', { name: 'Color' }).hover()
    await page.getByRole('menuitem', { name: 'Blue' }).click()
    await expect.poll(() => group.getAttribute('data-color')).toBe('blue')
    await shot(page, 'group-moved-blue')

    // save → reopen: the group is restored with its name, colour and members
    const pbip = join(tmp, 'groups', 'Groups.pbip')
    const expected = (await sidecar(page))!
    await saveAsPbip(page, app, pbip)
    expect(JSON.parse(readFileSync(join(tmp, 'groups', 'Groups.SemanticModel', SIDECAR), 'utf8'))).toEqual(expected)
    await openFile(page, pbip)
    await toModelView(page)
    await expect.poll(() => group.count()).toBe(1)
    expect(await page.locator('.wbi-mv-group__label').innerText()).toBe('Dimensions')
    expect(await group.getAttribute('data-color')).toBe('blue')
    expect(await sidecar(page)).toEqual(expected)

    // collapse to a chip: member cards hide, their relationship lines attach to the chip
    await group.getByRole('button', { name: 'Collapse group' }).click()
    await expect.poll(() => group.getAttribute('data-collapsed')).toBe('1')
    await expect.poll(() => page.locator('.wbi-mv-card').count()).toBe(cards - 2)
    expect(await page.locator('.wbi-mv-edge').count()).toBe(rels)
    expect(await group.innerText()).toMatch(/Dimensions\s*2 tables/)
    await shot(page, 'group-collapsed')
    await group.getByRole('button', { name: 'Expand group' }).click()
    await expect.poll(() => page.locator('.wbi-mv-card').count()).toBe(cards)

    // ungroup with the keyboard: the container goes, the tables stay
    const g3 = await box(page, '.wbi-mv-group')
    await page.mouse.click(g3.x + g3.width / 2, g3.y + 9)
    await expect.poll(() => group.getAttribute('class')).toContain('is-selected')
    expect(await ungroupBtn.isDisabled()).toBe(false)
    await page.keyboard.press('Control+Shift+G')
    await expect.poll(() => group.count()).toBe(0)
    expect(await page.locator('.wbi-mv-card').count()).toBe(cards)
    expect((await sidecar(page))?.diagrams[0]?.groups).toBeUndefined()
    // … and Ctrl+G groups the marquee selection again (Shift+drag on the canvas)
    await page.keyboard.press('Control+Z')
    await expect.poll(() => group.count()).toBe(1)
  })

  it('marquee-select tables, group with Ctrl+G, drag a table out of the container', async () => {
    const { page } = lumen()
    await toModelView(page)
    const group = page.locator('.wbi-mv-group')
    // start clean: remove the group left by the previous journey
    if (await group.count()) {
      const g = await box(page, '.wbi-mv-group')
      await page.mouse.click(g.x + g.width / 2, g.y + 9)
      await page.keyboard.press('Control+Shift+G')
      await expect.poll(() => group.count()).toBe(0)
    }
    // Shift+drag a box around Region and Customer
    const region = await box(page, '.wbi-mv-card[data-table="Region"]')
    const customer = await box(page, '.wbi-mv-card[data-table="Customer"]')
    const x0 = Math.min(region.x, customer.x) - 12
    const y1 = Math.max(region.y + region.height, customer.y + customer.height) + 12
    await page.keyboard.down('Shift')
    await drag(page, { x: x0, y: y1 }, { x: region.x + region.width / 2, y: region.y + 20 }, {
      hold: async () => {
        await expect.poll(() => page.locator('.wbi-mv-marquee').count()).toBe(1)
      }
    })
    await page.keyboard.up('Shift')
    await expect.poll(() => page.locator('.wbi-mv-card.is-selected').count()).toBeGreaterThanOrEqual(1)
    const selected = await page.locator('.wbi-mv-card.is-selected').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['table']))
    expect(selected).toContain('Region')
    // add Customer if the box missed it, then group with the keyboard
    if (!selected.includes('Customer')) await page.locator('.wbi-mv-card[data-table="Customer"] .wbi-mv-card__title').click({ modifiers: ['Control'] })
    await expect.poll(() => page.locator('.wbi-mv-card.is-selected').count()).toBe(2)
    await page.keyboard.press('Control+G')
    await expect.poll(() => group.count()).toBe(1)
    const members = async (): Promise<string[]> => ((await sidecar(page))?.diagrams[0]?.groups?.[0]?.tables ?? []).map((t) => t.name).sort()
    expect(await members()).toEqual(['Customer', 'Region'])

    // drag Region far out of the container: it leaves the group, the container shrinks around Customer
    const title = await box(page, '.wbi-mv-card[data-table="Region"] .wbi-mv-card__title')
    const from = { x: title.x + title.width / 2, y: title.y + title.height / 2 }
    await drag(page, from, { x: from.x - 30, y: from.y - 260 }, {
      steps: 14,
      hold: async () => {
        await expect.poll(() => group.getAttribute('class')).toContain('is-leave')
      }
    })
    await expect.poll(members).toEqual(['Customer'])
    // drag it back onto the container: it joins again
    const g = await box(page, '.wbi-mv-group')
    const title2 = await box(page, '.wbi-mv-card[data-table="Region"] .wbi-mv-card__title')
    const from2 = { x: title2.x + title2.width / 2, y: title2.y + title2.height / 2 }
    const card2 = await box(page, '.wbi-mv-card[data-table="Region"]')
    // put the card's centre over the container's centre
    const dx = g.x + g.width / 2 - (card2.x + card2.width / 2)
    const dy = g.y + g.height / 2 - (card2.y + card2.height / 2)
    await drag(page, from2, { x: from2.x + dx, y: from2.y + dy }, {
      steps: 14,
      hold: async () => {
        await expect.poll(() => group.getAttribute('class')).toContain('is-join')
      }
    })
    await expect.poll(members).toEqual(['Customer', 'Region'])
  })
})
