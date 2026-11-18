/** Save As PBIP / .wbi and reopen; Export PDF / PowerPoint / PNG from File ▸ Export. */
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { useLumen, lumenEval, stubSaveDialog, stubOpenDialog, openFile, untilNode, visualStatuses, expectAllRendered, settle, goToPage, waitIdle } from './harness'
import type { Page } from 'playwright-core'

interface Shape {
  pages: Array<{ name: string; displayName: string; visuals: string[] }>
}

async function reportShape(page: Page): Promise<Shape> {
  return lumenEval(page, (l) => {
    const r = l.useApp.getState().project!.report!
    return {
      pages: r.pagesMeta.pageOrder.map((n) => {
        const p = r.pages.find((x) => x.name === n)!
        return { name: p.name, displayName: String(p.json.displayName), visuals: p.visuals.map((v) => `${v.name}:${v.json.visual?.visualType ?? 'group'}`).sort() }
      })
    }
  })
}

async function fileMenu(page: Page, item: string): Promise<void> {
  await page.locator('.wbi-ribbon').getByRole('button', { name: 'File', exact: true }).first().click()
  const bs = page.getByRole('dialog', { name: 'File' })
  await bs.locator('.wbi-backstage__item', { hasText: new RegExp(`^${item}$`) }).click()
}

function pngSize(buf: Buffer): { width: number; height: number } {
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('save and export', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('Save As PBIP, reopen: same pages and visuals', async () => {
    const { page, app, tmp } = lumen()
    const before = await reportShape(page)
    const target = join(tmp, 'proj', 'Sales.pbip')
    await stubSaveDialog(app, target)
    await fileMenu(page, 'Save as')
    await page.getByRole('button', { name: /Power BI project \(\.pbip\)/ }).click()
    await untilNode(() => existsSync(target) && existsSync(join(tmp, 'proj', 'Sales.Report', 'definition', 'report.json')), 30_000, 'PBIP files')
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().project!.dirty)).toBe(false)
    expect(await page.locator('.wbi-titlebar, header').first().innerText()).toMatch(/Sales/)
    await openFile(page, target)
    expect(await lumenEval(page, (l) => l.useApp.getState().project!.source.kind)).toBe('pbip')
    expect(await reportShape(page)).toEqual(before)
  })

  it('Save As .wbi, reopen offline with data', async () => {
    const { page, app, tmp } = lumen()
    // back to the sample (the PBIP copy has no data cache: the sample's data is generated in memory)
    await page.evaluate(() => (document.body.dataset.wbiReady = '0'))
    await fileMenu(page, 'New')
    await page.getByRole('button', { name: /Sample report/ }).click()
    // a dirty-check prompt may appear: discard
    const discard = page.getByRole('button', { name: /^(Don't save|Discard)$/ })
    if (await discard.count()) await discard.click()
    await waitIdle(page)
    const before = await reportShape(page)
    const target = join(tmp, 'Sales.wbi')
    await stubSaveDialog(app, target)
    await fileMenu(page, 'Save as')
    await page.getByRole('button', { name: /bundle \(\.wbi\)/ }).click()
    await untilNode(() => existsSync(target) && statSync(target).size > 10_000, 30_000, '.wbi file')
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().project!.dirty)).toBe(false)
    await openFile(page, target)
    expect(await lumenEval(page, (l) => l.useApp.getState().project!.source.kind)).toBe('wbi')
    expect(await reportShape(page)).toEqual(before)
    await goToPage(page, 'Overview')
    await settle(page)
    expectAllRendered(await visualStatuses(page))
    // data came from the bundle: the KPI card shows the same total as the sample
    const tables = await lumenEval(page, (l) => [...l.useApp.getState().project!.data.status.values()].map((s) => s.state))
    expect(tables.every((s) => s === 'loaded')).toBe(true)
  })

  it('exports PDF, PowerPoint and PNG files that are valid', async () => {
    const { page, app, tmp } = lumen()
    const pages = (await reportShape(page)).pages.length
    // PDF
    const pdf = join(tmp, 'out.pdf')
    await stubSaveDialog(app, pdf)
    await fileMenu(page, 'Export')
    await page.getByRole('button', { name: /Export to PDF/ }).click()
    await untilNode(() => existsSync(pdf) && statSync(pdf).size > 1000, 60_000, 'PDF')
    const pdfText = readFileSync(pdf).toString('latin1')
    expect(pdfText.startsWith('%PDF-')).toBe(true)
    expect(pdfText.match(/\/Type\s*\/Page[\s/>]/g)?.length).toBe(pages)
    await waitIdle(page)
    // PowerPoint
    const pptx = join(tmp, 'out.pptx')
    await stubSaveDialog(app, pptx)
    await fileMenu(page, 'Export')
    await page.getByRole('button', { name: /Export to PowerPoint/ }).click()
    await untilNode(() => existsSync(pptx) && statSync(pptx).size > 1000, 60_000, 'PPTX')
    const zip = unzipSync(new Uint8Array(readFileSync(pptx)))
    const slides = Object.keys(zip).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    // title slide (like PBI's export) + one slide per page
    expect(slides.length).toBe(pages + 1)
    expect(Object.keys(zip).some((k) => /^ppt\/media\/.*\.png$/.test(k))).toBe(true)
    await waitIdle(page)
    // PNG (one file per page into a folder)
    const dir = join(tmp, 'png')
    await stubOpenDialog(app, [dir])
    await fileMenu(page, 'Export')
    await page.getByRole('button', { name: /Export pages as images/ }).click()
    await untilNode(() => existsSync(dir) && readdirSync(dir).filter((f) => f.endsWith('.png')).length === pages, 60_000, 'PNG files')
    const pageSize = await lumenEval(page, (l) => {
      const r = l.useApp.getState().project!.report!
      const p = r.pages.find((x) => x.name === r.pagesMeta.pageOrder[0])!
      return { width: Number(p.json.width), height: Number(p.json.height) }
    })
    const first = readdirSync(dir).filter((f) => f.endsWith('.png')).sort()[0]
    const size = pngSize(readFileSync(join(dir, first)))
    // default resolution 1× the page size (±2 px rounding)
    expect(Math.abs(size.width - pageSize.width)).toBeLessThanOrEqual(2)
    expect(Math.abs(size.height - pageSize.height)).toBeLessThanOrEqual(2)
  })
})
