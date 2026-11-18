/**
 * Public Power BI sample files (e.g. github.com/microsoft/powerbi-desktop-samples) placed in a local
 * directory given by LUMEN_SAMPLES_DIR (skipped when unset). Every .pbix/.pbit there must open,
 * save as PBIP and as .wbi, and reopen with the same content.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nodeFs } from '../nodefs'
import { openProject, saveProject } from '../open'

const DIR = process.env.LUMEN_SAMPLES_DIR
const files = DIR && existsSync(DIR) ? readdirSync(DIR).filter((f) => /\.(pbix|pbit)$/i.test(f)).sort() : []

describe.skipIf(!files.length)('Power BI sample files', () => {
  for (const f of files) {
    it(`opens, saves and reopens ${f}`, async () => {
      const doc = await openProject(join(DIR!, f), nodeFs)
      const errors = doc.diagnostics.filter((d) => d.level === 'error')
      expect(errors, JSON.stringify(errors)).toEqual([])
      expect(doc.report?.pages.length ?? 0).toBeGreaterThan(0)
      const visuals = doc.report!.pages.reduce((n, p) => n + p.visuals.length, 0)
      for (const p of doc.report!.pages) for (const v of p.visuals) expect(v.json.visual ?? v.json.visualGroup).toBeTruthy()
      // eslint-disable-next-line no-console
      console.log(`${f}: ${doc.source.kind}/${doc.report!.origin}, ${doc.model.tables.length} tables, ${doc.data.tables.size} with data, ${doc.report!.pages.length} pages, ${visuals} visuals`)
      for (const d of doc.diagnostics) console.log(`  [${d.level}] ${d.message}`)

      const tmp = mkdtempSync(join(tmpdir(), 'wbi-sample-'))
      try {
        await saveProject(doc, join(tmp, 'Out.pbip'), nodeFs, { format: 'pbip' })
        const again = await openProject(join(tmp, 'Out.pbip'), nodeFs)
        expect(again.model.tables.map((t) => t.name)).toEqual(doc.model.tables.filter((t) => t.columns.some((c) => c.kind !== 'rowNumber') || t.measures.length || t.calculationGroup).map((t) => t.name))
        expect(again.model.relationships).toEqual(doc.model.relationships)
        expect(again.report!.pages.map((p) => p.json)).toEqual(doc.report!.pages.map((p) => p.json))
        expect(again.report!.pages.map((p) => p.visuals)).toEqual(doc.report!.pages.map((p) => p.visuals))

        await saveProject(doc, join(tmp, 'Out.wbi'), nodeFs, { format: 'wbi' })
        const bundle = await openProject(join(tmp, 'Out.wbi'), nodeFs)
        expect(bundle.data.tables.size).toBe(doc.data.tables.size)
        for (const [name, t] of doc.data.tables) expect(bundle.data.tables.get(name)?.rowCount).toBe(t.rowCount)
        expect(bundle.report!.pages.map((p) => p.visuals)).toEqual(doc.report!.pages.map((p) => p.visuals))
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })
  }
})

/** Legacy PBIX layouts without a base theme render with the Classic palette; a PBIP save must keep it. */
async function roundTripsClassic(path: string, dropBaseTheme: boolean): Promise<void> {
  const { resolveThemes } = await import('../../pbir/pbir')
  const { legacyDefaultBaseTheme } = await import('../../report/themes/builtin')
  const doc = await openProject(path, nodeFs)
  expect(doc.report!.origin).toBe('pbix-legacy')
  if (dropBaseTheme) delete doc.report!.report.themeCollection?.baseTheme
  if (doc.report!.report.themeCollection?.baseTheme) return
  const classic = legacyDefaultBaseTheme().dataColors
  expect(resolveThemes(doc.report!).base?.dataColors).toEqual(classic)
  const tmp = mkdtempSync(join(tmpdir(), 'wbi-legacy-'))
  try {
    await saveProject(doc, join(tmp, 'Legacy.pbip'), nodeFs, { format: 'pbip' })
    const again = await openProject(join(tmp, 'Legacy.pbip'), nodeFs)
    expect(again.report!.origin).not.toBe('pbix-legacy')
    expect(again.report!.report.themeCollection?.baseTheme).toMatchObject({ name: 'Classic', type: 'SharedResources' })
    expect(resolveThemes(again.report!).base?.dataColors).toEqual(classic)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

describe('legacy PBIX theme persistence (save as PBIP, reopen)', () => {
  it('a legacy layout without a base theme keeps the Classic palette (repo fixture, base theme removed)', async () => {
    await roundTripsClassic(join(import.meta.dirname, '../pbix/datamodel/__fixtures__/abc-multithreaded.pbix'), true)
  })
  for (const f of files.filter((x) => /\.pbix$/i.test(x))) {
    it(`${f}: the Classic palette survives a PBIP round trip when the file has no base theme`, async () => {
      await roundTripsClassic(join(DIR!, f), false)
    })
  }
})
