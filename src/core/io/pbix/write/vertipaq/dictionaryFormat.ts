/**
 * `.dictionary` (hash-encoded column values): every field, parsed and written. The decoder in
 * `../../datamodel/vertipaq.ts` keeps only the values; this module keeps the whole structure so the writer can be
 * compared byte for byte with real files.
 *
 * Layout (names from pbixray's `dictionary.ksy`, MIT, see ../../datamodel/THIRD_PARTY.md, and [MS-XLDM] 2.7.4):
 *   i32 type (0 long, 1 real, 2 string)   6 x i32 hash information
 *   long / real: u64 count  u32 elementSize (4 or 8)  values
 *   string:      u64 storeStringCount  i8 storeCompressed  u64 storeLongestString  u64 pageCount
 *                per page: u64 pageMask  u8 containsNulls  u64 startIndex  u64 stringCount  u8 compressed
 *                          0xAABBCCDD
 *                          uncompressed: u64 remaining  u64 charsUsed  u64 allocBytes  UTF-16LE chars (each string NUL
 *                                        terminated) then `allocBytes - 2*charsUsed` bytes of slack
 *                          compressed:   u32 totalBits  u32 charsetType  u64 dataLength  [u8 charsetUsed]
 *                                        u32 decodeBits  128 bytes code lengths  u64 bufferSize  data
 *                          0xABCDABCD
 *                u64 handleCount  u32 handleSize (8)  handles (u32 offset, u32 page)
 */
import { ByteReader, ByteWriter } from './bytes'

export const DICT_LONG = 0
export const DICT_REAL = 1
export const DICT_STRING = 2

export interface UncompressedPage {
  compressed: false
  remaining: number
  charsUsed: number
  allocBytes: number
  chars: Uint8Array
  /** bytes after the used characters, up to allocBytes (real files: uninitialised memory or zeros) */
  slack: Uint8Array
}

export interface CompressedPage {
  compressed: true
  totalBits: number
  charsetType: number
  charsetUsed?: number
  decodeBits: number
  encodeArray: Uint8Array
  bufferSize: number
  data: Uint8Array
}

export interface StringPage {
  pageMask: bigint
  containsNulls: number
  startIndex: number
  stringCount: number
  body: UncompressedPage | CompressedPage
}

export interface DictionaryFull {
  type: number
  hashInfo: number[]
  /** long / real */
  elementSize?: number
  numbers?: Float64Array | BigInt64Array
  /** string */
  storeStringCount?: number
  storeCompressed?: number
  storeLongestString?: number
  pages?: StringPage[]
  handleSize?: number
  handles?: Array<[number, number]>
}

export const HUFFMAN_CHARSET_BASED = 0x000aba91
export const HUFFMAN_GENERAL = 0x000aba92

export function parseDictionaryFull(buf: Uint8Array): DictionaryFull {
  const r = new ByteReader(buf)
  const type = r.i32()
  const hashInfo = [r.i32(), r.i32(), r.i32(), r.i32(), r.i32(), r.i32()]
  if (type === DICT_LONG || type === DICT_REAL) {
    const n = r.u64()
    const elementSize = r.u32()
    let numbers: Float64Array | BigInt64Array
    if (type === DICT_LONG) {
      const a = new BigInt64Array(n)
      for (let i = 0; i < n; i++) a[i] = elementSize === 4 ? BigInt(r.i32()) : r.i64()
      numbers = a
    } else {
      const a = new Float64Array(n)
      for (let i = 0; i < n; i++) a[i] = r.f64()
      numbers = a
    }
    if (!r.eof()) throw new Error('VertiPaq: trailing bytes after numeric dictionary')
    return { type, hashInfo, elementSize, numbers }
  }
  if (type !== DICT_STRING) throw new Error(`VertiPaq: unsupported dictionary type ${type}`)
  const storeStringCount = r.u64()
  const storeCompressed = r.u8()
  const storeLongestString = r.u64()
  const pageCount = r.u64()
  const pages: StringPage[] = []
  for (let i = 0; i < pageCount; i++) {
    const pageMask = r.dv.getBigUint64(r.pos, true)
    r.pos += 8
    const containsNulls = r.u8()
    const startIndex = r.u64()
    const stringCount = r.u64()
    const compressed = r.u8() !== 0
    if (r.u32() !== 0xaabbccdd) throw new Error('VertiPaq: bad string store begin')
    let body: UncompressedPage | CompressedPage
    if (!compressed) {
      const remaining = r.u64()
      const charsUsed = r.u64()
      const allocBytes = r.u64()
      const chars = r.bytes(charsUsed * 2)
      const slack = r.bytes(allocBytes - charsUsed * 2)
      body = { compressed: false, remaining, charsUsed, allocBytes, chars, slack }
    } else {
      const totalBits = r.u32()
      const charsetType = r.u32()
      const len = r.u64()
      const charsetUsed = charsetType === HUFFMAN_CHARSET_BASED ? r.u8() : undefined
      const decodeBits = r.u32()
      const encodeArray = r.bytes(128)
      const bufferSize = r.u64()
      const data = r.bytes(len)
      body = { compressed: true, totalBits, charsetType, charsetUsed, decodeBits, encodeArray, bufferSize, data }
    }
    if (r.u32() !== 0xabcdabcd) throw new Error('VertiPaq: bad string store end')
    pages.push({ pageMask, containsNulls, startIndex, stringCount, body })
  }
  const nHandles = r.u64()
  const handleSize = r.u32()
  const handles: Array<[number, number]> = []
  for (let i = 0; i < nHandles; i++) handles.push([r.u32(), r.u32()])
  if (!r.eof()) throw new Error('VertiPaq: trailing bytes after string dictionary')
  return { type, hashInfo, storeStringCount, storeCompressed, storeLongestString, pages, handleSize, handles }
}

export function writeDictionaryFull(d: DictionaryFull): Uint8Array {
  const w = new ByteWriter(1024)
  w.i32(d.type)
  for (const h of d.hashInfo) w.i32(h)
  if (d.type === DICT_LONG || d.type === DICT_REAL) {
    const nums = d.numbers!
    w.u64(nums.length).u32(d.elementSize!)
    if (d.type === DICT_LONG) for (const v of nums as BigInt64Array) d.elementSize === 4 ? w.i32(Number(v)) : w.i64(v)
    else for (const v of nums as Float64Array) w.f64(v)
    return w.finish()
  }
  w.u64(d.storeStringCount!).u8(d.storeCompressed!).u64(d.storeLongestString!).u64(d.pages!.length)
  for (const p of d.pages!) {
    w.i64(BigInt.asIntN(64, p.pageMask)).u8(p.containsNulls).u64(p.startIndex).u64(p.stringCount).u8(p.body.compressed ? 1 : 0).u32(0xaabbccdd)
    const b = p.body
    if (!b.compressed) {
      w.u64(b.remaining).u64(b.charsUsed).u64(b.allocBytes).bytes(b.chars).bytes(b.slack)
    } else {
      w.u32(b.totalBits).u32(b.charsetType).u64(b.data.length)
      if (b.charsetType === HUFFMAN_CHARSET_BASED) w.u8(b.charsetUsed ?? 0)
      w.u32(b.decodeBits).bytes(b.encodeArray).u64(b.bufferSize).bytes(b.data)
    }
    w.u32(0xabcdabcd)
  }
  w.u64(d.handles!.length).u32(d.handleSize!)
  for (const [o, p] of d.handles!) w.u32(o).u32(p)
  return w.finish()
}
