/**
 * TMDL round-trip over a local corpus of PBIP semantic models.
 * The corpus location comes only from LUMEN_CORPUS_DIR (skipped when unset); assertions are generic.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { readTmdlFiles } from '../read'
import { writeTmdlFiles } from '../write'

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

function readTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const rec = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) rec(p)
      else out[relative(dir, p).split('\\').join('/')] = readFileSync(p, 'utf8').replace(/^\uFEFF/, '')
    }
  }
  rec(dir)
  return out
}

describe.skipIf(!CORPUS || !existsSync(CORPUS))('TMDL corpus round-trip', () => {
  const models = CORPUS ? findDirs(CORPUS, '.SemanticModel').filter((d) => existsSync(join(d, 'definition')) && statSync(join(d, 'definition')).isDirectory()) : []

  it('finds semantic models', () => {
    expect(models.length).toBeGreaterThan(0)
  })

  it('parses with zero errors, re-serializes (mostly) byte-identically and losslessly', () => {
    let files = 0
    let identical = 0
    let canonicalIdentical = 0
    let canonDiffs = 0
    const diffs: string[] = []
    for (const dir of models) {
      const src = readTree(join(dir, 'definition'))
      const { model, errors } = readTmdlFiles(src)
      expect(errors).toEqual([])
      const out = writeTmdlFiles(model).files
      for (const [path, text] of Object.entries(src)) {
        if (!path.endsWith('.tmdl')) continue
        files++
        if (out[path] === text) identical++
        else {
          diffs.push(path)
          const dump = process.env.TMDL_DIFF_OUT
          if (dump) {
            const base = join(dump, String(diffs.length))
            mkdirSync(base, { recursive: true })
            writeFileSync(join(base, 'a.tmdl'), text)
            writeFileSync(join(base, 'b.tmdl'), out[path] ?? '<missing>')
          }
        }
      }
      // semantic equality: hinted output and canonical (hint-free) output both re-parse to the same model
      expect(readTmdlFiles(out).model).toEqual(model)
      const canonical = writeTmdlFiles(structuredClone(model)).files
      expect(readTmdlFiles(canonical).model).toEqual(model)
      for (const [path, text] of Object.entries(src)) {
        if (!path.endsWith('.tmdl')) continue
        if (canonical[path] === text) canonicalIdentical++
        else if (process.env.TMDL_DIFF_OUT) {
          const base = join(process.env.TMDL_DIFF_OUT, 'canon', String(++canonDiffs))
          mkdirSync(base, { recursive: true })
          writeFileSync(join(base, 'a.tmdl'), text)
          writeFileSync(join(base, 'b.tmdl'), canonical[path] ?? '<missing>')
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `TMDL byte-identical: ${identical}/${files} files with source hints, ${canonicalIdentical}/${files} from the canonical serializer alone (${models.length} models)`
    )
    expect(identical / files).toBeGreaterThan(0.95)
  })
})
