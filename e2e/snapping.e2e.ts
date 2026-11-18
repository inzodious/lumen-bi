/** Canvas snapping: dragging a visual next to two others shows the equal-spacing guide and the drop snaps. */
import { describe, expect, it } from 'vitest'
import { useLumen, lumenEval, waitIdle, deselectAll } from './harness'

describe('snapping', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('shows equal-spacing guides while dragging and snaps the drop position', async () => {
    const { page } = lumen()
    await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
    await page.locator('.wbi-tab-add').click()
    await waitIdle(page)
    // three shapes from Insert ▸ Shapes would land on top of each other; insert then lay them out (setup, not under test)
    for (let i = 0; i < 3; i++) {
      await deselectAll(page).catch(() => undefined)
      await page.getByRole('listbox', { name: 'Visual types' }).getByRole('option', { name: /^Card/ }).first().click()
    }
    const names = await lumenEval(page, (l) => {
      const s = l.useApp.getState()
      const pg = s.project!.report!.pages.find((p) => p.name === s.activePage)!
      const ns = pg.visuals.map((v) => v.name)
      const rects = [
        { x: 100, y: 100 },
        { x: 400, y: 100 },
        { x: 760, y: 400 }
      ]
      s.mutateReport('layout', (r) => {
        const p = r.pages.find((x) => x.name === s.activePage)!
        p.visuals.forEach((v, i) => Object.assign(v.json.position, rects[i], { width: 200, height: 150 }))
      })
      s.selectVisuals([])
      return ns
    })
    expect(names.length).toBe(3)
    const scale = await lumenEval(page, (l) => l.useApp.getState().canvasScale)
    const c = page.locator(`.wbi-page [data-visual="${names[2]}"]`)
    const box = (await c.boundingBox())!
    // grab C by its middle and move it so it lands at ~(703, 102): 3 px past an equal gap of 100, 2 px below the row
    const sx = box.x + box.width / 2
    const sy = box.y + box.height / 2
    const tx = sx + (703 - 760) * scale
    const ty = sy + (102 - 400) * scale
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    const steps = 12
    for (let i = 1; i <= steps; i++) await page.mouse.move(sx + ((tx - sx) * i) / steps, sy + ((ty - sy) * i) / steps)
    // guides are in the DOM while dragging
    await expect.poll(() => page.locator('.wbi-page .wbi-spacing').count()).toBeGreaterThan(0)
    expect(await page.locator('.wbi-page .wbi-spacing-pill').first().innerText()).toMatch(/100/)
    expect(await page.locator('.wbi-page .wbi-guide').count()).toBeGreaterThan(0)
    await page.mouse.up()
    // dropped exactly at the equal-spacing / aligned position
    const pos = await lumenEval(
      page,
      (l, n) => {
        const s = l.useApp.getState()
        const v = s.project!.report!.pages.find((p) => p.name === s.activePage)!.visuals.find((x) => x.name === n)!
        return { x: v.json.position.x, y: v.json.position.y }
      },
      names[2]
    )
    expect(pos).toEqual({ x: 700, y: 100 })
    await expect.poll(() => page.locator('.wbi-page .wbi-spacing').count()).toBe(0)
    // one undo step restores the original position
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    const back = await lumenEval(
      page,
      (l, n) => {
        const s = l.useApp.getState()
        const v = s.project!.report!.pages.find((p) => p.name === s.activePage)!.visuals.find((x) => x.name === n)!
        return { x: v.json.position.x, y: v.json.position.y }
      },
      names[2]
    )
    expect(back).toEqual({ x: 760, y: 400 })
  })
})
