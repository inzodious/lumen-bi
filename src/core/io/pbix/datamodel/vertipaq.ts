/**
 * VertiPaq (xVelocity) column storage decoders: `.idfmeta` (segment metadata), `.idf` (hybrid RLE +
 * bit-packed data ids), `.dictionary` (string / integer / real dictionaries incl. Huffman-compressed
 * string pages).
 *
 * Format knowledge follows Microsoft's [MS-XLDM] open specification and the pbixray project
 * (MIT, Copyright (c) 2024 Igor Cotruta, https://github.com/Hugoberry/pbixray — Kaitai descriptions `idf.ksy`, `idfmeta.ksy`,
 * `dictionary.ksy` and `vertipaq_decoder.py`) and xmhuffman (MIT, Copyright (c) 2026 Igor Cotruta,
 * https://github.com/Hugoberry/xmhuffman-cython). Full license texts: ./THIRD_PARTY.md.
 */

/** VertiPaq reserves data id 2 for BLANK; real data ids start at 3. */
export const XM_DATA_ID_NULL = 2
export const XM_FIRST_DATA_ID = 3

class Reader {
  pos = 0
  readonly dv: DataView
  constructor(readonly buf: Uint8Array) {
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  u8(): number {
    return this.buf[this.pos++]
  }
  i8(): number {
    return this.dv.getInt8(this.pos++)
  }
  u32(): number {
    const v = this.dv.getUint32(this.pos, true)
    this.pos += 4
    return v
  }
  i32(): number {
    const v = this.dv.getInt32(this.pos, true)
    this.pos += 4
    return v
  }
  /** u64 as a JS number (exact below 2^53). */
  u64(): number {
    const lo = this.dv.getUint32(this.pos, true)
    const hi = this.dv.getUint32(this.pos + 4, true)
    this.pos += 8
    return hi * 4294967296 + lo
  }
  i64(): number {
    const lo = this.dv.getUint32(this.pos, true)
    const hi = this.dv.getInt32(this.pos + 4, true)
    this.pos += 8
    return int64ToNumber(hi, lo)
  }
  f64(): number {
    const v = this.dv.getFloat64(this.pos, true)
    this.pos += 8
    return v
  }
  bytes(n: number): Uint8Array {
    if (this.pos + n > this.buf.length) throw new Error('VertiPaq: unexpected end of data')
    const v = this.buf.subarray(this.pos, this.pos + n)
    this.pos += n
    return v
  }
  expect(tag: number[], what: string): void {
    for (let i = 0; i < tag.length; i++) {
      if (this.buf[this.pos + i] !== tag[i]) throw new Error(`VertiPaq: bad ${what} tag at ${this.pos}`)
    }
    this.pos += tag.length
  }
  eof(): boolean {
    return this.pos >= this.buf.length
  }
}

/** Correctly rounded conversion of a signed 64-bit integer (hi:lo) to a double. */
export function int64ToNumber(hi: number, lo: number): number {
  if (hi >= -0x200000 && hi < 0x200000) return hi * 4294967296 + lo
  return Number((BigInt(hi) << 32n) | BigInt(lo >>> 0))
}

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0))
const TAG_CP_OPEN = ascii('<1:CP\0')
const TAG_CP_CLOSE = ascii('CP:1>\0')
const TAG_CS_OPEN = ascii('<1:CS\0')
const TAG_CS_CLOSE = ascii('CS:1>\0')
const TAG_SS_OPEN = ascii('<1:SS\0')
const TAG_SS_CLOSE = ascii('SS:1>\0')

const HYBRID_RLE_CLASS = 703066 // 0xABA5A

function bitWidthOfClass(cc: number): number {
  if (cc >= 703031 && cc <= 703040) return cc - 703030
  if (cc === 703042) return 12
  if (cc === 703046) return 16
  if (cc === 703051) return 21
  if (cc === 703062) return 32
  return 0
}

export interface SegmentMeta {
  records: number
  minDataId: number
  maxDataId: number
  hasNulls: boolean
  /** Number of bit-packed values (the sub-segment's record count). */
  bitPackedCount: number
  bitWidth: number
  compressionClass: number
}

/** Parse a `.idfmeta` stream into per-segment metadata. */
export function parseIdfMeta(buf: Uint8Array): SegmentMeta[] {
  const r = new Reader(buf)
  r.expect(TAG_CP_OPEN, 'CP')
  const n = r.u64()
  const out: SegmentMeta[] = []
  for (let i = 0; i < n; i++) {
    r.expect(TAG_CS_OPEN, 'CS')
    const records = r.u64()
    r.u64() // base_id
    const cc = r.u32()
    const subCc = r.u32()
    if (cc === HYBRID_RLE_CLASS) {
      r.u64() // bookmark_bits
      r.u64() // storage_alloc_size
      r.u64() // storage_used_size
      r.u8() // segment_needs_resizing
    }
    r.u32() // first_run_value
    r.expect(TAG_SS_OPEN, 'SS')
    r.u64() // distinct_states
    const minDataId = r.u32()
    const maxDataId = r.u32()
    r.u32() // original_min_segment_data_id
    r.i64() // rle_sort_order
    r.u64() // row_count
    const hasNulls = r.u8() !== 0
    r.u64() // rle_runs
    r.u64() // others_rle_runs
    r.expect(TAG_SS_CLOSE, 'SS close')
    const hasSub = r.u8() !== 0
    let bitPackedCount = 0
    if (hasSub) {
      r.expect(TAG_CS_OPEN, 'sub CS')
      bitPackedCount = r.u64()
      r.u64() // base_id
      if (r.u8() !== 0) throw new Error('VertiPaq: nested sub-segment')
      r.expect(TAG_CS_CLOSE, 'sub CS close')
    }
    r.expect(TAG_CS_CLOSE, 'CS close')
    const bitWidth = cc === HYBRID_RLE_CLASS ? bitWidthOfClass(subCc) : bitWidthOfClass(cc)
    out.push({ records, minDataId, maxDataId, hasNulls, bitPackedCount, bitWidth, compressionClass: cc })
  }
  r.expect(TAG_CP_CLOSE, 'CP close')
  return out
}

/**
 * Decode the data ids of a column partition (`.idf`) into `out` starting at `outPos`.
 * Each segment: u64 RLE entry count, entries (u32 dataValue, u32 repeat), u64 bit-packed word
 * count, u64 words. An RLE entry whose `dataValue + bitPackedConsumed == 0xFFFFFFFF` marks a run
 * of `repeat` values taken from the bit-packed stream (value + base); any other entry repeats
 * `dataValue` literally. Repeats are capped at the segment's declared record count (some writers
 * leave stale bytes in the unused tail of the RLE area).
 *
 * The base of bit-packed values is XM_DATA_ID_NULL for segments that contain nulls, else the
 * segment's min data id. Returns the number of rows written.
 */
export function decodeIdf(buf: Uint8Array, segments: SegmentMeta[], out: Uint32Array, outPos: number): number {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let p = 0
  let pos = outPos
  for (let s = 0; s < segments.length; s++) {
    const meta = segments[s]
    if (p + 8 > buf.length) throw new Error('VertiPaq: idf has fewer segments than idfmeta')
    if (meta.compressionClass !== HYBRID_RLE_CLASS && bitWidthOfClass(meta.compressionClass) > 0) {
      // pure bit-packed segment (e.g. relationship INDEX streams): u64 word count, words; value + min data id
      const nWords = dv.getUint32(p, true) + dv.getUint32(p + 4, true) * 4294967296
      const wordsAt = p + 8
      p = wordsAt + nWords * 8
      if (p > buf.length) throw new Error('VertiPaq: truncated idf segment')
      const bw = meta.bitWidth
      const vpw = Math.floor(64 / bw)
      const mask = bw >= 32 ? 0xffffffff : (1 << bw) - 1
      const base = meta.hasNulls ? XM_DATA_ID_NULL : meta.minDataId
      for (let idx = 0; idx < meta.records; idx++) {
        const w = Math.floor(idx / vpw)
        const bit = (idx - w * vpw) * bw
        const wa = wordsAt + w * 8
        let v = 0
        if (wa + 8 <= p) {
          if (bit + bw <= 32) v = (dv.getUint32(wa, true) >>> bit) & mask
          else if (bit >= 32) v = (dv.getUint32(wa + 4, true) >>> (bit - 32)) & mask
          else v = ((dv.getUint32(wa, true) >>> bit) | (dv.getUint32(wa + 4, true) << (32 - bit))) & mask
        }
        out[pos++] = ((v >>> 0) + base) >>> 0
      }
      continue
    }
    const nEntries = dv.getUint32(p, true) + dv.getUint32(p + 4, true) * 4294967296
    p += 8
    const entriesAt = p
    p += nEntries * 8
    const nWords = dv.getUint32(p, true) + dv.getUint32(p + 4, true) * 4294967296
    p += 8
    const wordsAt = p
    p += nWords * 8
    if (p > buf.length) throw new Error('VertiPaq: truncated idf segment')

    const cap = meta.records
    const base = meta.hasNulls ? XM_DATA_ID_NULL : meta.minDataId
    const bw = meta.bitWidth
    const vpw = bw > 0 ? Math.floor(64 / bw) : 0
    const mask = bw >= 32 ? 0xffffffff : (1 << bw) - 1
    let bpIndex = 0 // bit-packed values consumed
    let acc = 0
    for (let e = 0; e < nEntries; e++) {
      if (cap && acc >= cap) break
      const dataValue = dv.getUint32(entriesAt + e * 8, true)
      let count = dv.getUint32(entriesAt + e * 8 + 4, true)
      if (cap && acc + count > cap) count = cap - acc
      if (count === 0) continue
      acc += count
      if (dataValue + bpIndex === 0xffffffff) {
        if (bw === 0) {
          for (let k = 0; k < count; k++) out[pos++] = base
        } else {
          for (let k = 0; k < count; k++) {
            const idx = bpIndex + k
            const w = Math.floor(idx / vpw)
            const bit = (idx - w * vpw) * bw
            const wa = wordsAt + w * 8
            let v: number
            if (wa + 8 > p) {
              v = 0
            } else if (bit + bw <= 32) {
              v = (dv.getUint32(wa, true) >>> bit) & mask
            } else if (bit >= 32) {
              v = (dv.getUint32(wa + 4, true) >>> (bit - 32)) & mask
            } else {
              v = ((dv.getUint32(wa, true) >>> bit) | (dv.getUint32(wa + 4, true) << (32 - bit))) & mask
            }
            out[pos++] = (v >>> 0) + base
          }
        }
        bpIndex += count
      } else {
        out.fill(dataValue, pos, pos + count)
        pos += count
      }
    }
  }
  return pos - outPos
}

// ---------------------------------------------------------------------------------------------
// Dictionaries
// ---------------------------------------------------------------------------------------------

export type DictionaryValues = { kind: 'string'; values: string[] } | { kind: 'long'; values: Float64Array } | { kind: 'real'; values: Float64Array }

const HUFFMAN_CHARSET_BASED = 0x000aba91
const HUFFMAN_GENERAL = 0x000aba92

const utf16 = new TextDecoder('utf-16le')

/** Parse a `.dictionary` stream. Values are in data-id order starting at XM_FIRST_DATA_ID. */
export function parseDictionary(buf: Uint8Array): DictionaryValues {
  const r = new Reader(buf)
  const type = r.i32()
  r.pos += 24 // hash information (6 x s4)
  if (type === 0 || type === 1) {
    const n = r.u64()
    const elementSize = r.u32()
    const values = new Float64Array(n)
    if (elementSize === 4) {
      for (let i = 0; i < n; i++) values[i] = r.i32()
    } else if (type === 0) {
      for (let i = 0; i < n; i++) values[i] = r.i64()
    } else {
      for (let i = 0; i < n; i++) values[i] = r.f64()
    }
    return { kind: type === 0 ? 'long' : 'real', values }
  }
  if (type !== 2) throw new Error(`VertiPaq: unsupported dictionary type ${type}`)

  r.u64() // store_string_count
  r.i8() // f_store_compressed
  r.u64() // store_longest_string
  const pageCount = r.u64()
  interface Page {
    compressed: boolean
    // uncompressed
    chars?: Uint8Array
    // compressed
    totalBits?: number
    charsetType?: number
    charsetUsed?: number
    encodeArray?: Uint8Array
    data?: Uint8Array
  }
  const pages: Page[] = []
  for (let i = 0; i < pageCount; i++) {
    r.pos += 8 // page_mask
    r.u8() // page_contains_nulls
    r.u64() // page_start_index
    r.u64() // page_string_count
    const compressed = r.u8() !== 0
    r.expect([0xdd, 0xcc, 0xbb, 0xaa], 'string store begin')
    if (!compressed) {
      r.u64() // remaining_store_available
      const used = r.u64()
      const alloc = r.u64()
      const chars = r.bytes(used * 2)
      r.pos += alloc - used * 2
      pages.push({ compressed, chars })
    } else {
      const totalBits = r.u32()
      const charsetType = r.u32()
      const len = r.u64()
      const charsetUsed = charsetType === HUFFMAN_CHARSET_BASED ? r.u8() : 0
      r.u32() // ui_decode_bits
      const encodeArray = r.bytes(128)
      r.u64() // ui64_buffer_size
      const data = r.bytes(len)
      pages.push({ compressed, totalBits, charsetType, charsetUsed, encodeArray, data })
    }
    r.expect([0xcd, 0xab, 0xcd, 0xab], 'string store end')
  }
  // record handles: (bit_or_byte_offset u32, page_id u32)
  const nHandles = r.u64()
  r.u32() // element size (8)
  const handlesAt = r.pos
  const perPage: number[][] = pages.map(() => [])
  for (let i = 0; i < nHandles; i++) {
    const off = r.dv.getUint32(handlesAt + i * 8, true)
    const pid = r.dv.getUint32(handlesAt + i * 8 + 4, true)
    if (pid < perPage.length) perPage[pid].push(off)
  }

  const values: string[] = []
  for (let pid = 0; pid < pages.length; pid++) {
    const page = pages[pid]
    if (!page.compressed) {
      const text = utf16.decode(page.chars!)
      const parts = text.split('\0')
      parts.pop()
      for (const s of parts) values.push(s)
    } else {
      const offsets = perPage[pid]
      if (!offsets.length) continue
      decodeHuffmanPage(page.data!, page.encodeArray!, offsets, page.totalBits!, page.charsetType === HUFFMAN_GENERAL, page.charsetUsed!, values)
    }
  }
  return { kind: 'string', values }
}

let codeBuf = new Uint16Array(1024)

function codesToString(codes: Uint16Array, n: number): string {
  if (n === 0) return ''
  if (n < 4096) return String.fromCharCode.apply(null, codes.subarray(0, n) as unknown as number[])
  let s = ''
  for (let i = 0; i < n; i += 4096) s += String.fromCharCode.apply(null, codes.subarray(i, Math.min(n, i + 4096)) as unknown as number[])
  return s
}

/**
 * Decode one Huffman-compressed string page ([MS-XLDM] 2.7.4). Canonical code over 256 byte
 * symbols (lengths nibble-packed in `encodeArray`), bitstream stored with adjacent bytes pair-swapped
 * and read MSB-first. String `i` spans bits [offsets[i], offsets[i+1]) (last ends at totalBits).
 * Charset-based pages encode only the low byte of each UTF-16 unit (high byte = `charsetUsed`);
 * general pages encode the raw UTF-16LE byte sequence.
 */
export function decodeHuffmanPage(
  data: Uint8Array,
  encodeArray: Uint8Array,
  offsets: number[],
  totalBits: number,
  general: boolean,
  charsetUsed: number,
  out: string[]
): void {
  const lengths = new Uint8Array(256)
  for (let i = 0; i < 128; i++) {
    lengths[2 * i] = encodeArray[i] & 0x0f
    lengths[2 * i + 1] = encodeArray[i] >> 4
  }
  const count = new Uint32Array(17)
  let maxLen = 0
  for (let s = 0; s < 256; s++) {
    const L = lengths[s]
    if (L) {
      count[L]++
      if (L > maxLen) maxLen = L
    }
  }
  if (maxLen === 0) {
    for (let i = 0; i < offsets.length; i++) out.push('')
    return
  }
  const firstCode = new Uint32Array(17)
  {
    let code = 0
    for (let L = 1; L <= maxLen; L++) {
      code = (code + count[L - 1]) << 1
      firstCode[L] = code
    }
  }
  const table = new Uint16Array(1 << maxLen) // (symbol << 8) | length
  for (let s = 0; s < 256; s++) {
    const L = lengths[s]
    if (!L) continue
    const code = firstCode[L]++
    const pad = maxLen - L
    const b = code << pad
    const entry = (s << 8) | L
    table.fill(entry, b, b + (1 << pad))
  }
  // pair-swap into a padded buffer
  const n = data.length
  const sw = new Uint8Array(n + 4)
  const even = n & ~1
  for (let i = 0; i < even; i += 2) {
    sw[i] = data[i + 1]
    sw[i + 1] = data[i]
  }
  if (n & 1) sw[n - 1] = data[n - 1]

  const mask = (1 << maxLen) - 1
  for (let i = 0; i < offsets.length; i++) {
    let bit = offsets[i]
    const end = i + 1 < offsets.length ? offsets[i + 1] : totalBits
    let len = 0
    // generous upper bound for this string's output units
    const need = end > bit ? end - bit : 0
    if (codeBuf.length < need + 2) codeBuf = new Uint16Array(need + 2)
    const codes = codeBuf
    if (general) {
      // decode bytes, pair them into UTF-16LE units
      let pending = -1
      while (bit < end) {
        const byte = bit >>> 3
        const w = (sw[byte] << 16) | (sw[byte + 1] << 8) | sw[byte + 2]
        const e = table[(w >>> (24 - (bit & 7) - maxLen)) & mask]
        const cl = e & 0xff
        if (cl === 0) throw new Error('VertiPaq: corrupt Huffman string page')
        const sym = e >>> 8
        if (pending < 0) pending = sym
        else {
          codes[len++] = pending | (sym << 8)
          pending = -1
        }
        bit += cl
      }
    } else {
      const hi = charsetUsed << 8
      while (bit < end) {
        const byte = bit >>> 3
        const w = (sw[byte] << 16) | (sw[byte + 1] << 8) | sw[byte + 2]
        const e = table[(w >>> (24 - (bit & 7) - maxLen)) & mask]
        const cl = e & 0xff
        if (cl === 0) throw new Error('VertiPaq: corrupt Huffman string page')
        codes[len++] = hi | (e >>> 8)
        bit += cl
      }
    }
    out.push(codesToString(codes, len))
  }
}
