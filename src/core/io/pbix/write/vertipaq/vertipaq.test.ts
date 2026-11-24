/**
 * VertiPaq writers (stage E).
 *  - always: invented columns through the encoders and Lumen's decoders;
 *  - with LUMEN_SAMPLES_DIR (Microsoft's sample .pbix files): reproduction of the real files' structures from their
 *    decoded values. Nothing from the samples is stored in the repository: each run reads them from that folder.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { abfFileBytes, parseAbf, type AbfArchive } from '../../datamodel/abf'
import { decompressDataModel } from '../../datamodel/container'
import { decodeIds } from '../../datamodel/columns'
import { decodeIdf, parseDictionary, parseIdfMeta } from '../../datamodel/vertipaq'
import { bytesEqual } from './bytes'
import { encodeColumn } from './dictionary'
import { parseDictionaryFull, writeDictionaryFull } from './dictionaryFormat'
import { compressStrings } from './huffman'
import { attributeHierarchyStreams, relationshipIndexStreams, sortedIds, userHierarchyStreams } from './hierarchy'
import { bookmarkBitsFor, writeColumnStreams, writeRowNumberStreams } from './idf'
import { parseIdfMetaFull, writeIdfMeta } from './idfmeta'

const SAMPLES = process.env.LUMEN_SAMPLES_DIR
const samples = SAMPLES && existsSync(SAMPLES) ? readdirSync(SAMPLES).filter((f) => f.toLowerCase().endsWith('.pbix')) : []

function ids(idf: Uint8Array, idfmeta: Uint8Array): number[] {
  const segs = parseIdfMeta(idfmeta)
  let n = 0
  for (const s of segs) n += s.records
  const out = new Uint32Array(n)
  return Array.from(out.subarray(0, decodeIdf(idf, segs, out, 0)))
}

describe('VertiPaq encoders (invented data)', () => {
  it('hash-encodes every data type and decodes back', () => {
    const cases: Array<[Parameters<typeof encodeColumn>[1], unknown[], (string | number | null)[]]> = [
      ['string', ['b', 'a', null, 'B', '', 'é😀'], ['b', 'a', null, 'b', '', 'é😀']],
      ['int64', [5, -3, 5, null, 2 ** 40], [5, -3, 5, null, 2 ** 40]],
      ['boolean', [true, false, null, true], [1, 0, null, 1]],
      ['decimal', [1.2345, -2, null], [12345, -20000, null]],
      ['double', [0.1, Number.POSITIVE_INFINITY, -0, null], [0.1, Number.POSITIVE_INFINITY, 0, null]],
      ['dateTime', [new Date(Date.UTC(1899, 11, 30)), new Date(Date.UTC(2024, 1, 29, 12)), null], [0, 45351.5, null]]
    ]
    for (const [type, values, stored] of cases) {
      const e = encodeColumn(values as never, type)
      const dict = parseDictionary(e.dictionary)
      const lut = Array.from(dict.values as ArrayLike<string | number>)
      const s = writeColumnStreams(e.ids, 1 << 20)
      const back = ids(s.idf, s.idfmeta).map((id) => (id === 2 ? null : lut[id - 3]))
      expect(back, type).toEqual(stored)
      expect(writeDictionaryFull(parseDictionaryFull(e.dictionary))).toEqual(e.dictionary)
    }
  })

  it('compresses large string dictionaries (Huffman pages) that decode back, charset and general', () => {
    const ascii = Array.from({ length: 3000 }, (_, i) => `Customer ${i} ${'x'.repeat(i % 40)}`)
    const wide = Array.from({ length: 800 }, (_, i) => `Ünïcödé ${i} 😀 ${'é'.repeat(i % 9)}`)
    const long = [`data:image/svg+xml;base64,${'QUJD'.repeat(3000)}`, '', 'b']
    for (const vals of [ascii, wide, long]) {
      const e = encodeColumn(vals, 'string')
      const full = parseDictionaryFull(e.dictionary)
      expect(full.pages![0].body.compressed).toBe(true)
      expect(Array.from(parseDictionary(e.dictionary).values as string[])).toEqual(vals)
      expect(writeDictionaryFull(full)).toEqual(e.dictionary)
    }
    expect(parseDictionaryFull(encodeColumn(['a', 'b'], 'string').dictionary).pages![0].body.compressed).toBe(false)
  })

  it('writes long runs as RLE, several segments, empty and all-BLANK columns', () => {
    const v = new Uint32Array(5000)
    for (let i = 0; i < v.length; i++) v[i] = i < 3000 ? 3 : 3 + (i % 7)
    const s = writeColumnStreams(v, 2048)
    expect(s.meta.segments.map((x) => x.records)).toEqual([2048, 2048, 904])
    expect(s.meta.segments[0].stats.rleRuns).toBe(1)
    expect(ids(s.idf, s.idfmeta)).toEqual(Array.from(v))
    const empty = writeColumnStreams(new Uint32Array(0), 2048)
    expect(empty.meta.segments[0].stats).toMatchObject({ minDataId: 2, maxDataId: 2, othersRleRuns: 1 })
    const blank = writeColumnStreams(new Uint32Array(100).fill(2), 2048)
    expect(blank.meta.segments[0].stats.originalMinSegmentDataId).toBe(0x80000000)
    // row numbers: sequential segments (no stored values; Lumen's reader skips row-number columns)
    expect(writeRowNumberStreams(70, 64).meta.segments.map((x) => [x.records, x.stats.minDataId, x.stats.maxDataId])).toEqual([
      [64, 3, 66],
      [6, 67, 72]
    ])
    expect([bookmarkBitsFor(10), bookmarkBitsFor(84), bookmarkBitsFor(20000)]).toEqual([1, 0, 8])
  })

  it('orders attribute hierarchies: BLANK first, case-insensitive text, sort-by keys', () => {
    expect(sortedIds(['b', 'A', 'c'], true)).toEqual([2, 4, 3, 5])
    expect(sortedIds(['Jan', 'Feb', 'Mar'], false, [1, 2, 3])).toEqual([3, 4, 5])
    const h = attributeHierarchyStreams(['b', 'a'], false)
    expect(ids(h.posToId.idf, h.posToId.idfmeta).map((x) => x - 2)).toEqual([4, 3, 0, 0, 0])
    expect(ids(h.idToPos.idf, h.idToPos.idfmeta).map((x) => x - 2)).toEqual([0, 2, 0, 1, 0])
  })

  it('builds user hierarchy members breadth first and relationship indexes', () => {
    // two levels: category (ids 3, 4), product (ids 3..5)
    const u = userHierarchyStreams([Uint32Array.of(3, 4, 4), Uint32Array.of(3, 4, 5)], [[0, 0, 0, 0, 1], [0, 0, 0, 0, 1, 2]], 3)
    expect(u.levelStarts).toEqual([0, 2])
    expect(ids(u.multiLevelId.idf, u.multiLevelId.idfmeta).map((x) => x - 2)).toEqual([3, 4, 3, 4, 5])
    expect(ids(u.childCount.idf, u.childCount.idfmeta).map((x) => x - 2)).toEqual([2, 3, 0, 0, 0])
    const r = relationshipIndexStreams(5, (id) => (id === 4 ? undefined : id - 3))
    expect(ids(r.idf, r.idfmeta).map((x) => x - 2)).toEqual([0, 0, 0, 1, 0])
  })
})

function load(file: string): AbfArchive {
  const dm = unzipSync(new Uint8Array(readFileSync(join(SAMPLES!, file))), { filter: (e) => e.name === 'DataModel' }).DataModel
  return parseAbf(decompressDataModel(dm))
}

describe.skipIf(!samples.length)('VertiPaq writers reproduce Microsoft samples (LUMEN_SAMPLES_DIR)', () => {
  it.each(samples)('%s: every .dictionary and .idfmeta round-trips byte for byte', (file) => {
    const abf = load(file)
    let n = 0
    for (const f of abf.files) {
      const b = abfFileBytes(abf, f.fileName)
      if (f.fileName.endsWith('.dictionary')) expect(bytesEqual(writeDictionaryFull(parseDictionaryFull(b)), b), f.fileName).toBe(true)
      else if (f.fileName.endsWith('.idfmeta')) expect(bytesEqual(writeIdfMeta(parseIdfMetaFull(b)), b), f.fileName).toBe(true)
      else continue
      n++
    }
    expect(n).toBeGreaterThan(50)
  })

  it.each(samples)('%s: compressed string pages regenerated from their strings', (file) => {
    const abf = load(file)
    let same = 0
    let total = 0
    for (const f of abf.files) {
      if (!f.fileName.endsWith('.dictionary')) continue
      const b = abfFileBytes(abf, f.fileName)
      const d = parseDictionaryFull(b)
      if (d.type !== 2 || !d.pages![0].body.compressed) continue
      const real = d.pages![0].body
      const g = compressStrings(parseDictionary(b).values as string[])
      total++
      if (real.compressed && bytesEqual(g.body.data, real.data) && bytesEqual(g.body.encodeArray, real.encodeArray)) same++
    }
    if (!total) return
    // code lengths differ only where a code needs length limiting
    expect(same / total).toBeGreaterThan(0.8)
  })

  it.each(samples)('%s: segment metadata of data columns regenerated from their data ids', (file) => {
    const abf = load(file)
    let same = 0
    let total = 0
    for (const f of abf.files) {
      if (!f.fileName.endsWith('.idf') || /^\d+\.[HRU]\$/.test(f.fileName)) continue
      const real = parseIdfMetaFull(abfFileBytes(abf, f.fileName + 'meta'))
      if (!real.sdos || real.segments[0].compressionClass !== 0xaba5a || real.segments.length > 1) continue
      const v = decodeIds(abf, f.fileName)
      if (!v.length) continue
      const isRow = f.fileName.includes('.RowNumber ')
      const s0 = real.segments[0]
      const g = isRow ? writeRowNumberStreams(v.length, v.length) : writeColumnStreams(v, v.length, { csFlag: s0.csFlag, originalMin: s0.stats.originalMinSegmentDataId })
      total++
      if (bytesEqual(g.idfmeta, abfFileBytes(abf, f.fileName + 'meta'))) same++
    }
    // 2017 files (no segment data objects block) are not compared; the 2023 samples are all identical
    if (!total) return
    expect(same / total).toBeGreaterThan(0.95)
  })

  it.each(samples)('%s: attribute hierarchies of hash-encoded columns without a sort-by column regenerated', (file) => {
    const abf = load(file)
    const byKey = new Map(abf.files.map((f) => [f.fileName.replace(/^\d+\./, ''), f.fileName]))
    let same = 0
    let total = 0
    for (const f of abf.files) {
      const m = /^\d+\.H\$(.*)\$(.*)\.POS_TO_ID\.0\.idf$/.exec(f.fileName)
      if (!m) continue
      const dn = byKey.get(`${m[1]}.${m[2]}.dictionary`)
      const cidf = byKey.get(`${m[1]}.${m[2]}.0.idf`)
      if (!dn || !cidf || !parseIdfMetaFull(abfFileBytes(abf, f.fileName + 'meta')).sdos) continue
      const vals = Array.from(parseDictionary(abfFileBytes(abf, dn)).values as ArrayLike<string | number>)
      const h = attributeHierarchyStreams(vals, decodeIds(abf, cidf).includes(2))
      total++
      if (bytesEqual(h.posToId.idf, abfFileBytes(abf, f.fileName)) && bytesEqual(h.posToId.idfmeta, abfFileBytes(abf, f.fileName + 'meta'))) same++
    }
    if (!total) return
    // the remainder: columns sorted by another column, and a few text order differences (sort.ts)
    expect(same / total).toBeGreaterThan(0.75)
  })
})
