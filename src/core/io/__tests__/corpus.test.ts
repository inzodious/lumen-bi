/**
 * openProject / saveProject over a local corpus of PBIP projects (LUMEN_CORPUS_DIR; skipped when unset).
 * Data caches are never decoded here (loadData: false). Only generic properties are asserted.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { nodeFs } from '../nodefs'
import { openProject, saveProject } from '../open'

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

function listFiles(dir: string): string[] {
  const out: string[] = []
  const rec = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) rec(p)
      else out.push(relative(dir, p))
    }
  }
  rec(dir)
  return out
}

describe.skipIf(!CORPUS || !existsSync(CORPUS))('PBIP corpus open/save', () => {
  it('opens every report with its model, saves as PBIP and reopens identically', async () => {
    const reports = findDirs(CORPUS!, '.Report')
    const tmp = mkdtempSync(join(tmpdir(), 'wbi-corpus-'))
    let tmdlFiles = 0
    let tmdlIdentical = 0
    try {
      for (const [i, dir] of reports.entries()) {
        const doc = await openProject(dir, nodeFs, { loadData: false })
        expect(doc.diagnostics.filter((d) => d.level === 'error')).toEqual([])
        expect(doc.data.tables.size).toBe(0)
        const target = join(tmp, `p${i}`)
        await saveProject(doc, join(target, `P${i}.pbip`), nodeFs, { format: 'pbip' })
        const again = await openProject(join(target, `P${i}.pbip`), nodeFs, { loadData: false })
        expect(again.model).toEqual(doc.model)
        expect(again.report!.pages).toEqual(doc.report!.pages)
        expect(again.report!.report).toEqual(doc.report!.report)
        // unmodified TMDL comes out byte-identical
        if (doc.source.modelPath && existsSync(join(doc.source.modelPath, 'definition'))) {
          const srcDef = join(doc.source.modelPath, 'definition')
          for (const rel of listFiles(srcDef)) {
            if (!rel.endsWith('.tmdl')) continue
            tmdlFiles++
            const out = join(target, `P${i}.SemanticModel`, 'definition', rel)
            if (existsSync(out) && readFileSync(out, 'utf8') === readFileSync(join(srcDef, rel), 'utf8').replace(/^﻿/, '')) tmdlIdentical++
          }
        }
      }
      // eslint-disable-next-line no-console
      console.log(`PBIP: ${reports.length} projects saved and reopened; TMDL byte-identical after save: ${tmdlIdentical}/${tmdlFiles}`)
      expect(tmdlIdentical).toBe(tmdlFiles)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
