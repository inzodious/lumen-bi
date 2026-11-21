/**
 * File ▸ Save as ▸ Power BI template (.pbit) / Power BI file (.pbix): the dialog states the write path and marks it
 * experimental, the file is written and reopens. Uses the built-in sample and the MIT-licensed Power BI Desktop file
 * committed as a reader fixture (src/core/io/pbix/datamodel/__fixtures__/data-profiling-demo.pbix).
 */
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { useLumen, lumenEval, stubSaveDialog, openFile, untilNode, waitIdle, ROOT } from './harness'
import type { Page } from 'playwright-core'

const FIXTURE = join(ROOT, 'src/core/io/pbix/datamodel/__fixtures__/data-profiling-demo.pbix')

async function fileMenu(page: Page, item: string): Promise<void> {
  await page.locator('.wbi-ribbon').getByRole('button', { name: 'File', exact: true }).first().click()
  const bs = page.getByRole('dialog', { name: 'File' })
  await bs.locator('.wbi-backstage__item', { hasText: new RegExp(`^${item}$`) }).click()
}

async function pageNames(page: Page): Promise<string[]> {
  return lumenEval(page, (l) => l.useApp.getState().project!.report!.pagesMeta.pageOrder.slice())
}

describe('save as Power BI file / template', () => {
  const lumen = useLumen({ route: { sample: '1' } })

  it('Save as .pbit: the dialog names the path and says experimental; the template reopens', async () => {
    const { page, app, tmp } = lumen()
    const before = await pageNames(page)
    const target = join(tmp, 'Sales.pbit')
    await stubSaveDialog(app, target)
    await fileMenu(page, 'Save as')
    await page.getByRole('button', { name: /Power BI template \(\.pbit\)/ }).click()
    const dlg = page.getByRole('dialog', { name: /Save as Power BI template/ })
    await expect.poll(() => dlg.count()).toBe(1)
    expect(await dlg.getByTestId('package-plan').getAttribute('data-path')).toBe('pbit')
    expect(await dlg.getByTestId('package-experimental').innerText()).toMatch(/Experimental: not yet verified in Power BI Desktop/)
    await dlg.getByRole('button', { name: 'Save', exact: true }).click()
    await untilNode(() => existsSync(target) && statSync(target).size > 1000, 30_000, '.pbit file')
    const parts = Object.keys(unzipSync(new Uint8Array(readFileSync(target)), { filter: () => true }))
    expect(parts).toContain('DataModelSchema')
    expect(parts).toContain('Report/Layout')
    expect(parts).not.toContain('DataModel')
    // a template is an export: the document keeps its own source
    expect(await lumenEval(page, (l) => l.useApp.getState().project!.source.kind)).not.toBe('pbit')
    await waitIdle(page)
    await openFile(page, target)
    expect(await lumenEval(page, (l) => l.useApp.getState().project!.source.kind)).toBe('pbit')
    expect(await pageNames(page)).toEqual(before)
  })

  it('Save as .pbix of the built-in sample: Lumen writes the data model (stage E); the file reopens with its data', async () => {
    const { page, app, tmp } = lumen()
    const before = await pageNames(page)
    const rows = (): Promise<Record<string, number>> =>
      lumenEval(page, (l) => Object.fromEntries([...l.useApp.getState().project!.data.tables].map(([n, t]) => [n, t.rowCount])))
    // the sample opens without data: fill it with generated sample data first
    await page.getByRole('button', { name: 'Use sample data', exact: true }).click()
    await expect.poll(async () => Object.values(await rows()).filter((n) => n > 0).length, { timeout: 60_000 }).toBeGreaterThan(3)
    await waitIdle(page)
    const rowsBefore = await rows()
    const target = join(tmp, 'Sample.pbix')
    await stubSaveDialog(app, target)
    await fileMenu(page, 'Save as')
    await page.getByRole('button', { name: /Power BI file \(\.pbix\)/ }).click()
    const dlg = page.getByRole('dialog', { name: /Save as Power BI file/ })
    await expect.poll(() => dlg.count()).toBe(1)
    expect(await dlg.getByTestId('package-plan').getAttribute('data-path')).toBe('pbix-lumen-data')
    expect(await dlg.innerText()).toMatch(/data written by Lumen/)
    // verified in Power BI Desktop 2.159: no experimental label
    expect(await dlg.getByTestId('package-experimental').count()).toBe(0)
    await dlg.getByRole('button', { name: 'Save', exact: true }).click()
    await untilNode(() => existsSync(target) && statSync(target).size > 1000, 60_000, '.pbix file')
    const parts = Object.keys(unzipSync(new Uint8Array(readFileSync(target)), { filter: () => true }))
    expect(parts).toContain('DataModel')
    expect(parts).toContain('Report/Layout')
    await waitIdle(page)
    await openFile(page, target)
    expect(await lumenEval(page, (l) => l.useApp.getState().project!.source.kind)).toBe('pbix')
    expect(await pageNames(page)).toEqual(before)
    expect(await rows()).toEqual(rowsBefore)
  })

  it('Save as .pbix of a template with no data loaded explains why and offers .pbit / PBIP', async () => {
    const { page, app, tmp } = lumen()
    await openFile(page, join(tmp, 'Sales.pbit'))
    const target = join(tmp, 'FromTemplate.pbix')
    await stubSaveDialog(app, target)
    await fileMenu(page, 'Save as')
    await page.getByRole('button', { name: /Power BI file \(\.pbix\)/ }).click()
    const dlg = page.getByRole('dialog', { name: /Can't save as Power BI file/ })
    await expect.poll(() => dlg.count()).toBe(1)
    expect(await dlg.innerText()).toMatch(/Save a \.pbit .* or a PBIP project/)
    expect(await dlg.innerText()).toMatch(/no data loaded/)
    await dlg.getByRole('button', { name: 'OK', exact: true }).click()
    expect(existsSync(target)).toBe(false)
  })

  it('Save as .pbix of an edited Power BI Desktop file keeps its data model byte for byte', async () => {
    const { page, app, tmp } = lumen()
    await openFile(page, FIXTURE)
    // a report edit: rename the first page (Desktop shows display names)
    await lumenEval(page, (l) =>
      l.useApp.getState().mutateReport('Rename page', (r) => {
        r.pages[0].json.displayName = 'Edited in Lumen'
      })
    )
    const target = join(tmp, 'Edited.pbix')
    await stubSaveDialog(app, target)
    await fileMenu(page, 'Save as')
    await page.getByRole('button', { name: /Power BI file \(\.pbix\)/ }).click()
    const dlg = page.getByRole('dialog', { name: /Save as Power BI file/ })
    await expect.poll(() => dlg.count()).toBe(1)
    expect(await dlg.getByTestId('package-plan').getAttribute('data-path')).toBe('pbix-original-model')
    expect(await dlg.innerText()).toMatch(/keeping the original data model/)
    expect(await dlg.innerText()).toMatch(/Experimental: not yet verified in Power BI Desktop/)
    await dlg.getByRole('button', { name: 'Save', exact: true }).click()
    await untilNode(() => existsSync(target) && statSync(target).size > 1000, 30_000, '.pbix file')
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().project!.dirty)).toBe(false)
    expect(await lumenEval(page, (l) => l.useApp.getState().project!.source)).toEqual({ kind: 'pbix', path: target })
    const a = unzipSync(new Uint8Array(readFileSync(FIXTURE)), { filter: (f) => f.name === 'DataModel' }).DataModel
    const b = unzipSync(new Uint8Array(readFileSync(target)), { filter: (f) => f.name === 'DataModel' }).DataModel
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0)
    await waitIdle(page)
    await openFile(page, target)
    expect(await lumenEval(page, (l) => l.useApp.getState().project!.report!.pages[0].json.displayName)).toBe('Edited in Lumen')
    expect(await lumenEval(page, (l) => [...l.useApp.getState().project!.data.tables.values()].some((t) => t.rowCount > 0))).toBe(true)
  })
})
