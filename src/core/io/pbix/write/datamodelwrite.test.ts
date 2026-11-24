/**
 * DataModel repacking: decode → ABF → rebuild → XPress9 → decode again.
 * Sample corpus (Microsoft's public sample .pbix files):
 *   LUMEN_SAMPLES_DIR=/path/to/pbix-samples npx vitest run src/core/io/pbix/write
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DataStore, Scalar } from '../../../model/data'
import { abfFileBytes, decompressDataModel, detectCompression, extractDataModelStream, parseAbf, readDataModel } from '../datamodel/index'
import { rebuildAbf } from './abfwrite'
import { compressDataModel, DATAMODEL_CHUNK_SIZE, repackDataModel } from './datamodelwrite'

const FIXTURES = join(import.meta.dirname, '../datamodel/__fixtures__')

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function canon(v: Scalar | undefined): string {
  if (v === null || v === undefined) return 'N'
  if (v instanceof Date) return 'd:' + v.getTime()
  if (v instanceof Uint8Array) return 'x:' + Buffer.from(v).toString('hex')
  return typeof v + ':' + String(v)
}

/** Row counts and a hash of every value of every table. */
function dataSummary(data: DataStore): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, t] of data.tables) {
    const h = createHash('sha1')
    for (const c of t.columns) {
      h.update(c.name + '\u0001')
      for (const v of c.values) h.update(canon(v) + '\n')
    }
    out[name] = `${t.rowCount}:${h.digest('hex')}`
  }
  return out
}

async function expectSameModelAndData(original: Uint8Array, repacked: Uint8Array): Promise<void> {
  const a = await readDataModel(original)
  const b = await readDataModel(repacked)
  expect(b.diagnostics).toEqual(a.diagnostics)
  expect(JSON.stringify(b.model)).toBe(JSON.stringify(a.model))
  expect(dataSummary(b.data)).toEqual(dataSummary(a.data))
}

describe('DataModel writer — repository fixture', () => {
  it('repacks data-profiling-demo.pbix with identical model and data', async () => {
    const dm = extractDataModelStream(new Uint8Array(readFileSync(join(FIXTURES, 'data-profiling-demo.pbix'))))
    const repacked = repackDataModel(dm)
    expect(detectCompression(repacked)).toBe('xpress9')
    expect(sameBytes(decompressDataModel(repacked), decompressDataModel(dm))).toBe(true)
    await expectSameModelAndData(dm, repacked)
  })

  it('repacks with a replaced metadata.sqlitedb that the reader still opens', async () => {
    const dm = extractDataModelStream(new Uint8Array(readFileSync(join(FIXTURES, 'data-profiling-demo.pbix'))))
    const abf = parseAbf(decompressDataModel(dm))
    const db = abfFileBytes(abf, 'metadata.sqlitedb')
    // a trailing unused page: the file grows, every later blob moves, SQLite content is unchanged
    const grown = new Uint8Array(db.length + 4096)
    grown.set(db)
    const repacked = repackDataModel(dm, new Map([['metadata.sqlitedb', grown]]))
    expect(sameBytes(abfFileBytes(parseAbf(decompressDataModel(repacked)), 'metadata.sqlitedb'), grown)).toBe(true)
    await expectSameModelAndData(dm, repacked)
  })
})

const SAMPLES = process.env.LUMEN_SAMPLES_DIR
const sampleFiles = SAMPLES && existsSync(SAMPLES) ? readdirSync(SAMPLES).filter((f) => /\.pbix$/i.test(f)).sort() : []

describe.skipIf(!sampleFiles.length)('DataModel writer — Microsoft samples (LUMEN_SAMPLES_DIR)', () => {
  it.each(sampleFiles)('%s: ABF rebuild is byte-identical, XPress9 round trip is exact, Lumen reads the same model and data', async (file) => {
    const dm = extractDataModelStream(new Uint8Array(readFileSync(join(SAMPLES!, file))))
    const abf = decompressDataModel(dm)
    expect(sameBytes(rebuildAbf(parseAbf(abf)), abf)).toBe(true)
    const repacked = compressDataModel(abf)
    // framing: one chunk per 2 MiB
    const dv = new DataView(repacked.buffer, repacked.byteOffset)
    expect(dv.getUint32(102, true)).toBe(Math.min(abf.length, DATAMODEL_CHUNK_SIZE))
    expect(sameBytes(decompressDataModel(repacked), abf)).toBe(true)
    await expectSameModelAndData(dm, repacked)
  }, 180_000)

  it.each(sampleFiles)('%s: a replaced metadata.sqlitedb moves the other files and keeps them intact', async (file) => {
    const dm = extractDataModelStream(new Uint8Array(readFileSync(join(SAMPLES!, file))))
    const a = parseAbf(decompressDataModel(dm))
    const db = abfFileBytes(a, 'metadata.sqlitedb')
    const grown = new Uint8Array(db.length + 4096)
    grown.set(db)
    const rebuilt = rebuildAbf(a, new Map([['metadata.sqlitedb', grown]]))
    const b = parseAbf(rebuilt)
    expect(b.applyCompression).toBe(a.applyCompression)
    for (const f of a.files) {
      const want = f.fileName === 'metadata.sqlitedb' ? grown : abfFileBytes(a, f.fileName)
      expect(sameBytes(abfFileBytes(b, f.fileName), want), f.fileName).toBe(true)
    }
    await expectSameModelAndData(dm, compressDataModel(rebuilt))
  }, 180_000)
})
