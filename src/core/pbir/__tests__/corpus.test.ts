/**
 * PBIR round-trip over a local corpus of PBIP reports (LUMEN_CORPUS_DIR; skipped when unset).
 * Only generic properties are asserted.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nodeFs } from '../../io/nodefs'
import { readPbirFolder, writePbirFolder } from '../pbir'

const CORPUS = process.env.LUMEN_CORPUS_DIR

function findDirs(root: string, suffix: string): string[] {
  const out: string[] = []
  const rec = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const p = join(d, e.name)
      if (e.name.endsWith(suffix)) out.push(p)
      else rec(p)
    }
  }
  rec(root)
  return out.sort()
}

describe.skipIf(!CORPUS || !existsSync(CORPUS))('PBIR corpus round-trip', () => {
  it('reads, writes and re-reads every report losslessly', async () => {
    const reports = findDirs(CORPUS!, '.Report')
    expect(reports.length).toBeGreaterThan(0)
    const tmp = mkdtempSync(join(tmpdir(), 'wbi-pbir-'))
    let pages = 0
    let visuals = 0
    let legacy = 0
    try {
      for (const [i, dir] of reports.entries()) {
        const doc = await readPbirFolder(nodeFs, dir)
        if (doc.origin === 'pbix-legacy') legacy++
        expect(doc.report.themeCollection?.baseTheme?.name).toBeTruthy()
        expect(doc.theme.base).toBeTruthy()
        pages += doc.pages.length
        visuals += doc.pages.reduce((n, p) => n + p.visuals.length, 0)
        for (const p of doc.pages) for (const v of p.visuals) expect(v.json.visual ?? v.json.visualGroup).toBeTruthy()
        const out = join(tmp, `r${i}.Report`)
        await writePbirFolder(nodeFs, out, doc)
        const again = await readPbirFolder(nodeFs, out)
        expect(again.report).toEqual(doc.report)
        expect(again.pagesMeta.pageOrder).toEqual(doc.pages.map((p) => p.name))
        expect(again.pages).toEqual(doc.pages)
        expect(again.bookmarks).toEqual(doc.bookmarks)
        expect(again.bookmarksMeta).toEqual(doc.bookmarksMeta)
        expect(again.reportExtensions).toEqual(doc.reportExtensions)
        expect(again.version).toEqual(doc.version)
        expect(again.pbir).toEqual(doc.pbir)
        expect(Object.keys(again.resources).sort()).toEqual(Object.keys(doc.resources).sort())
        expect(again.theme).toEqual(doc.theme)
        // writing again over itself changes nothing
        const before = await readPbirFolder(nodeFs, out)
        await writePbirFolder(nodeFs, out, before)
        expect((await readPbirFolder(nodeFs, out)).pages).toEqual(before.pages)
      }
      // eslint-disable-next-line no-console
      console.log(`PBIR: ${reports.length} reports (${legacy} PBIR-legacy converted), ${pages} pages, ${visuals} visuals`)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
