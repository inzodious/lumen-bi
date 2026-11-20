/**
 * `.idf` / `.idfmeta` encoder: data ids → segment streams and their metadata, the inverse of `decodeIdf` /
 * `parseIdfMeta` in `../../datamodel/vertipaq.ts`.
 *
 * Rules measured on every `.idf` of the files on hand (docs/developer/file-format-io.md, "Inside the DataModel"):
 *  - Column segments use the hybrid class 0xABA5A: RLE entries first, then 64-bit words of bit-packed values.
 *    Scanning the segment left to right, a run of at least 64 equal ids becomes an RLE entry `(id, length)`; every
 *    stretch of shorter runs becomes one bit-packed entry `(0xFFFFFFFF - packedBefore, length)`. The entry list ends
 *    with a `(0, 0)` terminator that counts as used. `rleUsed` counts 32-bit units (2 per entry); the RLE area holds
 *    `max(32, nextPow2(rleUsed + 3))` units, unused entries are zero (real files leave uninitialised memory there,
 *    which no writer can reproduce).
 *  - Bit-packed values are stored as `id - base`, base 2 (the BLANK id) when the segment has BLANKs, else 3; the base
 *    is also the segment's `firstRunValue`. The width is the smallest of 1-10, 12, 16, 21 or 32 bits that holds
 *    `maxDataId - base` (at least 1); `floor(64 / width)` values per little-endian 64-bit word, low bits first.
 *  - Row-number columns use the sub-class 0xABA5B ("sequential": no words; value = 3 + row) with one bit-packed
 *    entry and no terminator.
 *  - System-table columns (attribute-hierarchy, relationship and user-hierarchy structures) use a pure bit-packed
 *    class (`0xABA36 + width`, ...): u64 word count, words.
 */
import { ByteWriter } from './bytes'
import { HYBRID_RLE_CLASS, writeIdfMeta as writeIdfMetaBytes, type IdfMetaFull, type SegmentDataObject, type SegmentMetaFull } from './idfmeta'

export const XM_NULL_ID = 2
export const XM_FIRST_ID = 3
/** Sub-class of row-number segments: value = 3 + row, no words. */
export const SEQUENTIAL_CLASS = 0xaba5b
/** Minimum run length stored as an RLE entry. */
export const RLE_MIN_RUN = 64

const WIDTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 21, 32]

/** Bit width class code for a width (703031 + width for 1-10; 703042, 703046, 703051, 703062). */
export function widthClass(width: number): number {
  if (width <= 10) return 0xaba36 + width
  if (width === 12) return 0xaba42
  if (width === 16) return 0xaba46
  if (width === 21) return 0xaba4b
  if (width === 32) return 0xaba56
  throw new Error(`VertiPaq: unsupported bit width ${width}`)
}

/** Smallest supported bit width that holds `maxValue` (at least 1). */
export function bitWidthFor(maxValue: number): number {
  let need = 1
  while (need < 32 && maxValue >= 2 ** need) need++
  for (const w of WIDTHS) if (w >= need) return w
  return 32
}

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

function packWords(values: ArrayLike<number>, start: number, count: number, base: number, width: number, w: ByteWriter, extraWord: boolean): number {
  const vpw = Math.floor(64 / width)
  // hybrid segments always carry one word more than whole words need (real files, also with no packed value)
  const nWords = extraWord ? Math.floor(count / vpw) + 1 : Math.ceil(count / vpw)
  for (let k = 0; k < nWords; k++) {
    let lo = 0
    let hi = 0
    for (let j = 0; j < vpw; j++) {
      const i = k * vpw + j
      if (i >= count) break
      const v = (values[start + i] - base) >>> 0
      const bit = j * width
      if (bit < 32) {
        lo = (lo | (v << bit)) >>> 0
        if (bit + width > 32) hi = (hi | (v >>> (32 - bit))) >>> 0
      } else hi = (hi | (v << (bit - 32))) >>> 0
    }
    w.u32(lo).u32(hi)
  }
  return nWords
}

/** Unknown-meaning fields written as constants or measured approximations (see the format notes). */
export interface SegmentWriteOptions {
  /** CS flag of the column segment (real files: 1 for most data columns, 0 for calculated columns; rule unknown) */
  csFlag?: number
  /** `bookmarkBits` of the hybrid header (meaning not established; default: `bookmarkBitsFor(rows)`) */
  bookmarkBits?: number
  /** hash-encoded columns: 2; value-encoded: 3 (`originalMinSegmentDataId`) */
  originalMin?: number
}

export interface EncodedSegment {
  meta: SegmentMetaFull
  sdo: SegmentDataObject
}

/**
 * `bookmarkBits` of a hybrid segment as files written by Power BI Desktop up to 2023 show it for every column of a
 * table (all seven Microsoft samples): 1 below 64 rows, else `floor(log2(rows)) - 6`. Files from late 2025 use another,
 * per-column value (not derived); current Desktop opens files of both kinds.
 */
export function bookmarkBitsFor(rows: number): number {
  if (rows < 64) return 1
  return Math.max(0, Math.floor(Math.log2(rows)) - 6)
}

/** Encode one hybrid segment of data ids into `w`; returns its metadata. */
export function encodeHybridSegment(ids: ArrayLike<number>, start: number, count: number, w: ByteWriter, opts: SegmentWriteOptions = {}): EncodedSegment {
  const segStart = w.pos
  let hasNulls = false
  let min = Infinity
  let max = 0
  for (let i = 0; i < count; i++) {
    const v = ids[start + i]
    if (v === XM_NULL_ID) hasNulls = true
    else if (v < min) min = v
    if (v > max) max = v
  }
  // an empty segment or one holding only BLANKs: min = max = the BLANK id (real files)
  const allBlank = count > 0 && min === Infinity
  if (min === Infinity) min = XM_NULL_ID
  const base = hasNulls || count === 0 ? XM_NULL_ID : XM_FIRST_ID
  const width = bitWidthFor(Math.max(0, max - base))
  // entries
  const entries: Array<[number, number]> = []
  let packed = 0
  let bpOpen = -1
  let rleRuns = 0
  let others = 0
  const packedIdx: number[] = []
  for (let i = 0; i < count; ) {
    const v = ids[start + i]
    let j = i + 1
    while (j < count && ids[start + j] === v) j++
    const len = j - i
    if (len >= RLE_MIN_RUN) {
      entries.push([v, len])
      rleRuns++
      bpOpen = -1
    } else {
      if (bpOpen < 0) {
        entries.push([(0xffffffff - packed) >>> 0, 0])
        bpOpen = entries.length - 1
        others++
      }
      entries[bpOpen][1] += len
      for (let k = i; k < j; k++) packedIdx.push(start + k)
      packed += len
    }
    i = j
  }
  // an empty segment: one empty bit-packed entry, no terminator (real files: rleUsed 2, othersRleRuns 1)
  if (count === 0) {
    entries.push([0xffffffff, 0])
    others = 1
  }
  const used = count === 0 ? 2 : 2 * (entries.length + 1)
  const alloc = Math.max(32, nextPow2(used + 3))
  const nEnt = alloc / 2
  w.u64(nEnt)
  for (let e = 0; e < nEnt; e++) {
    const en = entries[e]
    if (en) w.u32(en[0]).u32(en[1])
    else w.u32(0).u32(0)
  }
  const wordsAt = w.pos
  const packedVals = packedIdx.map((k) => ids[k])
  const lenAt = w.pos
  w.u64(0)
  const nWords = packWords(packedVals, 0, packedVals.length, base, width, w, true)
  w.setU64(lenAt, nWords)
  const meta: SegmentMetaFull = {
    records: count,
    csFlag: opts.csFlag ?? 1,
    compressionClass: HYBRID_RLE_CLASS,
    subClass: widthClass(width),
    hybrid: { bookmarkBits: opts.bookmarkBits ?? bookmarkBitsFor(count), rleAllocated: alloc, rleUsed: used, needsResizing: 0 },
    firstRunValue: base,
    stats: {
      distinctStates: 0,
      minDataId: min,
      maxDataId: count === 0 ? XM_NULL_ID : max,
      // a column holding only BLANKs: 0x80000000 (real files); otherwise 2 (hash encoding) or 3 (value encoding)
      originalMinSegmentDataId: allBlank ? 0x80000000 : (opts.originalMin ?? 2),
      rleSortOrder: -1n,
      rowCount: count,
      hasNulls,
      rleRuns,
      othersRleRuns: others
    },
    sub: { records: packed, csFlag: 0 }
  }
  return { meta, sdo: { offset: segStart, count: nEnt, sub: { offset: wordsAt, count: nWords } } }
}

/** Row-number segment (rows `start..start+count-1`, values 3 + row). */
export function encodeRowNumberSegment(start: number, count: number, w: ByteWriter): EncodedSegment {
  // an empty table's row-number column is written like any empty segment (real files)
  if (count === 0) {
    const e = encodeHybridSegment([], 0, 0, w, { csFlag: 0 })
    return e
  }
  const segStart = w.pos
  const nEnt = 16
  w.u64(nEnt)
  w.u32(0xffffffff).u32(count)
  for (let e = 1; e < nEnt; e++) w.u32(0).u32(0)
  const wordsAt = w.pos
  w.u64(0)
  const meta: SegmentMetaFull = {
    records: count,
    csFlag: 0,
    compressionClass: HYBRID_RLE_CLASS,
    subClass: SEQUENTIAL_CLASS,
    hybrid: { bookmarkBits: 24, rleAllocated: 32, rleUsed: 2, needsResizing: 0 },
    firstRunValue: XM_FIRST_ID,
    stats: {
      distinctStates: 0,
      minDataId: XM_FIRST_ID + start,
      maxDataId: XM_FIRST_ID + start + count - 1,
      originalMinSegmentDataId: 2,
      rleSortOrder: -1n,
      rowCount: count,
      hasNulls: false,
      rleRuns: 0,
      othersRleRuns: 0
    },
    sub: { records: count, csFlag: 0 }
  }
  return { meta, sdo: { offset: segStart, count: nEnt, sub: { offset: wordsAt, count: 0 } } }
}

export interface PackedSegmentOptions {
  /** value written as stored (no base subtraction); width from the maximum */
  width?: number
  /** one word more than the values need (attribute-hierarchy columns in real files), as hybrid segments do */
  extraWord?: boolean
  /** fields after the class code (real files: 1) and firstRunValue (0, or 0xFFFFFFFF for relationship indexes) */
  subClass?: number
  firstRunValue?: number
  /** statistics block of system-table segments (real files: min = max = original min = 2, the rest 0) */
  stats?: Partial<SegmentMetaFull['stats']>
}

/** Pure bit-packed segment (system tables): u64 word count, words of raw values. */
export function encodePackedSegment(values: ArrayLike<number>, start: number, count: number, w: ByteWriter, opts: PackedSegmentOptions = {}): EncodedSegment {
  const segStart = w.pos
  let max = 0
  for (let i = 0; i < count; i++) if (values[start + i] > max) max = values[start + i]
  const width = opts.width ?? bitWidthFor(max)
  const lenAt = w.pos
  w.u64(0)
  const nWords = packWords(values, start, count, 0, width, w, opts.extraWord ?? false)
  w.setU64(lenAt, nWords)
  const meta: SegmentMetaFull = {
    records: count,
    csFlag: 0,
    compressionClass: widthClass(width),
    subClass: opts.subClass ?? 1,
    firstRunValue: opts.firstRunValue ?? 0,
    stats: {
      distinctStates: 0,
      minDataId: 2,
      maxDataId: 2,
      originalMinSegmentDataId: 2,
      rleSortOrder: -1n,
      rowCount: 0,
      hasNulls: false,
      rleRuns: 0,
      othersRleRuns: 0,
      ...opts.stats
    }
  }
  return { meta, sdo: { offset: segStart, count: nWords } }
}

export interface ColumnStreams {
  idf: Uint8Array
  idfmeta: Uint8Array
  meta: IdfMetaFull
}

/** Segment boundaries for `rows` rows. */
export function segmentRanges(rows: number, segmentSize: number): Array<[number, number]> {
  if (rows === 0) return [[0, 0]]
  const out: Array<[number, number]> = []
  for (let s = 0; s < rows; s += segmentSize) out.push([s, Math.min(segmentSize, rows - s)])
  return out
}

/** Data column: hybrid segments of `segmentSize` rows. */
export function writeColumnStreams(ids: ArrayLike<number>, segmentSize: number, opts: SegmentWriteOptions & { sdos?: boolean } = {}): ColumnStreams {
  const w = new ByteWriter(Math.max(256, ids.length))
  const segs = segmentRanges(ids.length, segmentSize).map(([s, n]) => encodeHybridSegment(ids, s, n, w, opts))
  const meta: IdfMetaFull = { segments: segs.map((s) => s.meta), ...(opts.sdos === false ? {} : { sdos: segs.map((s) => s.sdo) }) }
  return { idf: w.finish(), idfmeta: writeIdfMetaBytes(meta), meta }
}

/** Row-number column of `rows` rows. */
export function writeRowNumberStreams(rows: number, segmentSize: number, opts: { sdos?: boolean } = {}): ColumnStreams {
  const w = new ByteWriter(256)
  const segs = segmentRanges(rows, segmentSize).map(([s, n]) => encodeRowNumberSegment(s, n, w))
  const meta: IdfMetaFull = { segments: segs.map((s) => s.meta), ...(opts.sdos === false ? {} : { sdos: segs.map((s) => s.sdo) }) }
  return { idf: w.finish(), idfmeta: writeIdfMetaBytes(meta), meta }
}

/** System-table column: pure bit-packed segments. */
export function writePackedStreams(values: ArrayLike<number>, segments: Array<[number, number]>, opts: PackedSegmentOptions & { sdos?: boolean } = {}): ColumnStreams {
  const w = new ByteWriter(Math.max(256, values.length * 2))
  const segs = segments.map(([s, n]) => encodePackedSegment(values, s, n, w, opts))
  const meta: IdfMetaFull = { segments: segs.map((s) => s.meta), ...(opts.sdos === false ? {} : { sdos: segs.map((s) => s.sdo) }) }
  return { idf: w.finish(), idfmeta: writeIdfMetaBytes(meta), meta }
}

