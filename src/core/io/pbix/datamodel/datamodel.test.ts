import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Scalar } from '../../../model/data'
import { base64ToBytes, oleDaysToDate } from './columns'
import { decompressDataModel, detectCompression } from './container'
import { extractDataModelStream, parseAbf, readDataModel, setSqlJsFactory } from './index'
import { decodeHuffmanPage, decodeIdf, type SegmentMeta } from './vertipaq'
import { decompressXpress8Chunked } from './xpress8'

const FIXTURES = join(import.meta.dirname, '__fixtures__')

/** Canonical value encoding used to hash reference (pbixray) and decoded columns identically. */
function canon(v: Scalar | undefined): string {
  if (v === null || v === undefined) return 'N'
  if (v instanceof Date) return 'd:' + v.getTime()
  if (typeof v === 'boolean') return v ? 'b:1' : 'b:0'
  if (typeof v === 'string') return 's' + [...v].length + ':' + v
  if (v instanceof Uint8Array) return 'x:' + Buffer.from(v).toString('hex')
  if (Number.isNaN(v)) return 'N'
  const b = Buffer.alloc(8)
  b.writeDoubleBE(v === 0 ? 0 : v)
  return 'n:' + b.toString('hex')
}

function columnSha1(values: Scalar[]): string {
  const h = createHash('sha1')
  for (const v of values) h.update(canon(v) + '\n')
  return h.digest('hex')
}

interface Expected {
  abfSha256: string
  abfSize: number
  tables: Record<string, { rows: number; columns: Record<string, { sha1: string; sample: string[] }> }>
}

function load(name: string): { bytes: Uint8Array; expected: Expected } {
  return {
    bytes: new Uint8Array(readFileSync(join(FIXTURES, name + '.pbix'))),
    expected: JSON.parse(readFileSync(join(FIXTURES, name + '.expected.json'), 'utf8')) as Expected
  }
}

async function expectMatchesReference(bytes: Uint8Array, expected: Expected): Promise<void> {
  const { model, data, diagnostics } = await readDataModel(bytes)
  expect(diagnostics).toEqual([])
  for (const [tname, t] of Object.entries(expected.tables)) {
    const td = data.tables.get(tname)
    expect(td, tname).toBeDefined()
    expect(td!.rowCount, tname).toBe(t.rows)
    expect(model.tables.some((x) => x.name === tname)).toBe(true)
    expect(data.status.get(tname)).toMatchObject({ state: 'loaded', source: 'pbix', rowCount: t.rows })
    for (const [cname, c] of Object.entries(t.columns)) {
      const cd = td!.columns.find((x) => x.name === cname)
      expect(cd, `${tname}[${cname}]`).toBeDefined()
      expect(cd!.values.slice(0, 5).map(canon), `${tname}[${cname}] sample`).toEqual(c.sample)
      expect(columnSha1(cd!.values), `${tname}[${cname}]`).toBe(c.sha1)
    }
  }
}

describe('PBIX DataModel reader — fixtures (values verified against pbixray)', () => {
  it('XPress9 output is byte-identical to the reference decompressor', () => {
    const { bytes, expected } = load('data-profiling-demo')
    const stream = extractDataModelStream(bytes)
    expect(detectCompression(stream)).toBe('xpress9')
    const abf = decompressDataModel(stream)
    expect(abf.length).toBe(expected.abfSize)
    expect(createHash('sha256').update(abf).digest('hex')).toBe(expected.abfSha256)
  })

  it('decodes every table and column of a Power BI sample', async () => {
    const { bytes, expected } = load('data-profiling-demo')
    await expectMatchesReference(bytes, expected)
  })

  it('builds the semantic model from metadata.sqlitedb', async () => {
    const { bytes } = load('data-profiling-demo')
    const { model } = await readDataModel(bytes, { tables: [] })
    expect(model.compatibilityLevel).toBeGreaterThan(1000)
    const orders = model.tables.find((t) => t.name === 'Orders')!
    // a 2018 file: legacy query partition bound to the embedded mashup (M lives in the DataMashup part)
    expect(orders.partitions[0]).toMatchObject({ sourceType: 'query', mode: 'import', expression: 'SELECT * FROM [Orders]' })
    expect(orders.partitions[0].extra).toMatchObject({ mashupQueryName: 'Orders' })
    expect(orders.columns.find((c) => c.kind === 'rowNumber')).toMatchObject({ isHidden: true })
    expect(orders.columns.find((c) => c.name === 'OrderDate')?.dataType).toBe('dateTime')
    // auto date/time: variations point at LocalDateTable hierarchies through relationships
    const withVariation = model.tables.flatMap((t) => t.columns).find((c) => c.variations?.length)
    expect(withVariation?.variations?.[0].relationship).toBeTruthy()
    expect(withVariation?.variations?.[0].defaultHierarchy).toMatch(/^LocalDateTable_.+\./)
    const localDate = model.tables.find((t) => t.name.startsWith('LocalDateTable_'))!
    expect(localDate.showAsVariationsOnly).toBe(true)
    expect(localDate.partitions[0].sourceType).toBe('calculated')
    expect(localDate.columns.some((c) => c.kind === 'calculatedTableColumn')).toBe(true)
    expect(localDate.hierarchies[0].levels.map((l) => l.ordinal)).toEqual([0, 1, 2, 3])
    expect(model.relationships.length).toBeGreaterThan(0)
    for (const r of model.relationships) {
      expect(model.tables.some((t) => t.name === r.fromTable)).toBe(true)
      expect(model.tables.some((t) => t.name === r.toTable)).toBe(true)
    }
  })

  it('accepts the raw (uncompressed) ABF, as found in PBIP .pbi/cache.abf', async () => {
    const { bytes, expected } = load('data-profiling-demo')
    const abf = decompressDataModel(extractDataModelStream(bytes))
    expect(detectCompression(abf)).toBe('uncompressed')
    const { data } = await readDataModel(abf, { tables: ['Orders'] })
    expect(data.tables.get('Orders')!.rowCount).toBe(expected.tables.Orders.rows)
    expect(data.tables.has('Customers')).toBe(false)
  })

  it('decodes the multi-threaded XPress9 container variant', async () => {
    const { bytes, expected } = load('abc-multithreaded')
    const stream = extractDataModelStream(bytes)
    expect(detectCompression(stream)).toBe('xpress9-multithreaded')
    const abf = decompressDataModel(stream)
    expect(createHash('sha256').update(abf).digest('hex')).toBe(expected.abfSha256)
    await expectMatchesReference(bytes, expected)
  })

  it('reports progress and honours an injected sql.js factory', async () => {
    const { bytes } = load('abc-multithreaded')
    const initSqlJs = (await import('sql.js')).default
    let calls = 0
    setSqlJsFactory(() => {
      calls++
      return initSqlJs()
    })
    try {
      const steps: number[] = []
      await readDataModel(bytes, { onProgress: (f) => steps.push(f) })
      expect(calls).toBe(1)
      expect(steps[steps.length - 1]).toBe(1)
      expect(steps.every((f, i) => i === 0 || f >= steps[i - 1])).toBe(true)
    } finally {
      setSqlJsFactory(undefined)
    }
  })

  it('parses the ABF virtual directory', () => {
    const { bytes } = load('abc-multithreaded')
    const abf = parseAbf(decompressDataModel(extractDataModelStream(bytes)))
    expect(abf.byName.has('metadata.sqlitedb')).toBe(true)
    expect(abf.files.some((f) => f.fileName.endsWith('.idf'))).toBe(true)
    for (const f of abf.files) expect(f.offset + f.size).toBeLessThanOrEqual(abf.bytes.length)
  })
})

describe('VertiPaq primitives', () => {
  function seg(over: Partial<SegmentMeta>): SegmentMeta {
    return { records: 0, minDataId: 3, maxDataId: 3, hasNulls: false, bitPackedCount: 0, bitWidth: 0, compressionClass: 0, ...over }
  }
  function idfSegment(entries: Array<[number, number]>, words: bigint[]): Uint8Array {
    const b = Buffer.alloc(8 + entries.length * 8 + 8 + words.length * 8)
    let p = 0
    b.writeBigUInt64LE(BigInt(entries.length), p)
    p += 8
    for (const [v, r] of entries) {
      b.writeUInt32LE(v, p)
      b.writeUInt32LE(r, p + 4)
      p += 8
    }
    b.writeBigUInt64LE(BigInt(words.length), p)
    p += 8
    for (const w of words) {
      b.writeBigUInt64LE(w, p)
      p += 8
    }
    return new Uint8Array(b)
  }

  it('decodes hybrid RLE + bit-packed segments (incl. null base and record cap)', () => {
    // 3 bits per value, 21 values per word; values 0..4 packed
    let w = 0n
    for (let k = 0; k < 5; k++) w |= BigInt(k) << BigInt(3 * k)
    const s1 = idfSegment(
      [
        [7, 2], // literal id 7 twice
        [0xffffffff, 3], // 3 bit-packed values (bpIndex 0)
        [0xffffffff - 3, 2], // 2 more bit-packed values (bpIndex 3)
        [9, 100] // capped by records
      ],
      [w]
    )
    const out = new Uint32Array(10)
    const n = decodeIdf(s1, [seg({ records: 10, hasNulls: true, minDataId: 5, bitWidth: 3, bitPackedCount: 5 })], out, 0)
    expect(n).toBe(10)
    // base = XM_DATA_ID_NULL (2) because the segment has nulls
    expect([...out]).toEqual([7, 7, 2, 3, 4, 5, 6, 9, 9, 9])
    const out2 = new Uint32Array(3)
    decodeIdf(idfSegment([[0xffffffff, 3]], [w]), [seg({ records: 3, minDataId: 10, bitWidth: 3 })], out2, 0)
    expect([...out2]).toEqual([10, 11, 12])
  })

  it('handles 21- and 32-bit packing across 32-bit word halves', () => {
    const vals21 = [0x1fffff, 12345, 0x100001]
    let w = 0n
    vals21.forEach((v, k) => (w |= BigInt(v) << BigInt(21 * k)))
    const out = new Uint32Array(3)
    decodeIdf(idfSegment([[0xffffffff, 3]], [w]), [seg({ records: 3, minDataId: 0, bitWidth: 21 })], out, 0)
    expect([...out]).toEqual(vals21)
    const w32 = (0xfedcba98n << 32n) | 0x89abcdefn
    const out32 = new Uint32Array(2)
    decodeIdf(idfSegment([[0xffffffff, 2]], [w32]), [seg({ records: 2, minDataId: 0, bitWidth: 32 })], out32, 0)
    expect([...out32]).toEqual([0x89abcdef, 0xfedcba98])
  })

  /** Minimal canonical Huffman encoder used to produce test pages in the on-disk layout. */
  function encodePage(strings: number[][], lengths: Map<number, number>): { data: Uint8Array; encodeArray: Uint8Array; offsets: number[]; totalBits: number } {
    const syms = [...lengths.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0])
    const codes = new Map<number, [number, number]>()
    let code = 0
    let prevLen = syms[0][1]
    for (const [s, L] of syms) {
      code <<= L - prevLen
      prevLen = L
      codes.set(s, [code, L])
      code++
    }
    const bits: number[] = []
    const offsets: number[] = []
    for (const str of strings) {
      offsets.push(bits.length)
      for (const s of str) {
        const [c, L] = codes.get(s)!
        for (let i = L - 1; i >= 0; i--) bits.push((c >> i) & 1)
      }
    }
    const totalBits = bits.length
    const nBytes = Math.ceil(totalBits / 8)
    const logical = new Uint8Array(nBytes + (nBytes & 1))
    bits.forEach((b, i) => (logical[i >> 3] |= b << (7 - (i & 7))))
    const data = new Uint8Array(logical.length)
    for (let i = 0; i < logical.length; i += 2) {
      data[i] = logical[i + 1]
      data[i + 1] = logical[i]
    }
    const encodeArray = new Uint8Array(128)
    for (const [s, L] of lengths) encodeArray[s >> 1] |= s & 1 ? L << 4 : L
    return { data, encodeArray, offsets, totalBits }
  }

  it('decodes Huffman-compressed string pages (charset and general modes)', () => {
    const text = ['Sales', 'Product', '', 'Date', 'Sales Amount']
    const units = text.map((s) => [...s].map((c) => c.charCodeAt(0)))
    const alphabet = new Set(units.flat())
    alphabet.add(0x7e)
    // build a valid (Kraft-complete) set of lengths: assign lengths by a simple balanced scheme
    const symbols = [...alphabet].sort((a, b) => a - b)
    const lengths = new Map<number, number>()
    const n = symbols.length
    const L = Math.ceil(Math.log2(n))
    const short = 2 ** L - n // symbols that get L-1 bits
    symbols.forEach((s, i) => lengths.set(s, i < short ? L - 1 : L))
    const page = encodePage(units, lengths)
    const out: string[] = []
    decodeHuffmanPage(page.data, page.encodeArray, page.offsets, page.totalBits, false, 0, out)
    expect(out).toEqual(text)

    // charset byte reinserted as the high byte of each UTF-16 unit (e.g. Cyrillic 0x04xx)
    const out2: string[] = []
    decodeHuffmanPage(page.data, page.encodeArray, page.offsets.slice(0, 2), page.offsets[2], false, 0x04, out2)
    expect(out2).toEqual(text.slice(0, 2).map((s) => [...s].map((c) => String.fromCharCode(0x400 | c.charCodeAt(0))).join('')))

    // general mode: the Huffman stream carries the UTF-16LE bytes
    const words = ['Zürich', 'Ωmega']
    const bytes = words.map((s) => [...Buffer.from(s, 'utf16le')])
    const gsyms = [...new Set(bytes.flat()), 0xff].sort((a, b) => a - b)
    const gl = new Map<number, number>()
    const gL = Math.ceil(Math.log2(gsyms.length))
    const gshort = 2 ** gL - gsyms.length
    gsyms.forEach((s, i) => gl.set(s, i < gshort ? gL - 1 : gL))
    const gpage = encodePage(bytes, gl)
    const out3: string[] = []
    decodeHuffmanPage(gpage.data, gpage.encodeArray, gpage.offsets, gpage.totalBits, true, 0, out3)
    expect(out3).toEqual(words)
  })

  it('decodes XPress8 (plain LZ77) chunks', () => {
    // "abcabcabcabcabcX": 3 literals, match(offset 3, length 12), literal 'X'
    const payload: number[] = []
    const flags = (0 << 31) | (0 << 30) | (0 << 29) | (1 << 28) | (0 << 27) | (1 << 26) // bits: L L L M L M ...
    payload.push(flags & 0xff, (flags >>> 8) & 0xff, (flags >>> 16) & 0xff, (flags >>> 24) & 0xff)
    payload.push(0x61, 0x62, 0x63)
    // match: offset 3 -> (3-1) << 3, length 12 -> extended: 7 + nibble(2) + 3
    const m1 = ((3 - 1) << 3) | 7
    payload.push(m1 & 0xff, m1 >> 8, 0x12) // shared nibble byte: low = 2 (this match), high = 1 (next one)
    payload.push(0x58)
    // second match: offset 1, length 7 + 3 + high nibble (1) = 11 → 'X' x 11
    const m2 = ((1 - 1) << 3) | 7
    payload.push(m2 & 0xff, m2 >> 8)
    const expected = 'abc' + 'abcabcabcabc' + 'X' + 'X'.repeat(11)
    const chunk = [expected.length & 0xff, expected.length >> 8, payload.length & 0xff, payload.length >> 8, ...payload]
    const stored = [4, 0, 4, 0, 0x44, 0x45, 0x46, 0x47]
    const out = decompressXpress8Chunked(new Uint8Array([...chunk, ...stored]))
    expect(Buffer.from(out).toString('latin1')).toBe(expected + 'DEFG')
  })

  it('converts OLE automation dates and base64 binaries', () => {
    expect(oleDaysToDate(45000.5).toISOString()).toBe('2023-03-15T12:00:00.000Z')
    expect(oleDaysToDate(0).toISOString()).toBe('1899-12-30T00:00:00.000Z')
    expect([...base64ToBytes('/9j/\n4A ==')]).toEqual([0xff, 0xd8, 0xff, 0xe0])
  })
})

/**
 * Optional corpus smoke test: `WBI_PBIX_SAMPLES_DIR=/path/to/public/samples npx vitest run src/core/io/pbix/datamodel`
 * decodes every .pbix / .abf under the directory (recursively) and checks structural invariants.
 */
const SAMPLES = process.env.WBI_PBIX_SAMPLES_DIR
describe.skipIf(!SAMPLES || !existsSync(SAMPLES))('PBIX DataModel reader — sample corpus', () => {
  const files: string[] = []
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(pbix|abf)$/i.test(e)) files.push(p)
    }
  }
  if (SAMPLES && existsSync(SAMPLES)) walk(SAMPLES)

  it.each(files.map((f) => [f.slice(SAMPLES!.length + 1), f]))('%s', async (_name, file) => {
    const bytes = new Uint8Array(readFileSync(file))
    let res
    try {
      res = await readDataModel(bytes)
    } catch (e) {
      // live-connection / report-only files have no embedded model
      expect(String(e)).toMatch(/no embedded DataModel/i)
      return
    }
    expect(res.diagnostics).toEqual([])
    for (const t of res.model.tables) {
      const td = res.data.tables.get(t.name)!
      expect(td).toBeDefined()
      for (const c of td.columns) expect(c.values.length).toBe(td.rowCount)
      expect(res.data.status.get(t.name)?.state).not.toBe('error')
    }
  }, 120000)
})
