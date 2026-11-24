/**
 * `.idfmeta` (column segment metadata): every field, parsed and written. The reader in
 * `../../datamodel/vertipaq.ts` keeps only what decoding needs; this module keeps all of it so the writer can be
 * checked byte for byte against real files (docs/developer/file-format-io.md, "Inside the DataModel").
 *
 * Layout (field names from pbixray's `idfmeta.ksy`, MIT, see ../../datamodel/THIRD_PARTY.md, meanings refined by
 * comparing every `.idfmeta` of the files on hand with the `.idf` it describes):
 *
 *   '<1:CP\0'  u64 segmentCount
 *   per segment:
 *     '<1:CS\0'  u64 records  u64 csFlag  u32 compressionClass  u32 subClass
 *     hybrid class (0xABA5A) only: u64 bookmarkBits  u64 rleAllocated  u64 rleUsed  u8 needsResizing
 *     u32 firstRunValue
 *     '<1:SS\0'  u64 distinctStates  u32 minDataId  u32 maxDataId  u32 originalMinSegmentDataId
 *                i64 rleSortOrder  u64 rowCount  u8 hasNulls  u64 rleRuns  u64 othersRleRuns  'SS:1>\0'
 *     u8 hasSubSegment
 *     [ '<1:CS\0' u64 records u64 csFlag u8 0 'CS:1>\0' ]   bit-packed sub-segment (hybrid class)
 *     'CS:1>\0'
 *   'CP:1>\0'
 *   files written since about 2019 then carry the segment data objects (absent in the 2017 files):
 *   '<1:SDOs\0'  per segment: '<1:CSDOs\0' u64 offset u64 count [ '<1:CSDOs\0' u64 offset u64 count 'CSDOs:1>\0' ] 'CSDOs:1>\0'  'SDOs:1>\0'
 *     outer pair: byte offset of the segment in the `.idf` and its RLE entries allocated (hybrid) or 64-bit words (pure
 *     bit-packing); nested pair (hybrid only): byte offset of the bit-packed words in the `.idf` and their count.
 * Units: `rleAllocated` / `rleUsed` count 32-bit units (two per RLE entry).
 */
import { ByteReader, ByteWriter } from './bytes'

export const HYBRID_RLE_CLASS = 0xaba5a // 703066

export interface SegmentStats {
  distinctStates: number
  minDataId: number
  maxDataId: number
  originalMinSegmentDataId: number
  rleSortOrder: bigint
  rowCount: number
  hasNulls: boolean
  rleRuns: number
  othersRleRuns: number
}

export interface SegmentMetaFull {
  records: number
  csFlag: number
  compressionClass: number
  subClass: number
  hybrid?: { bookmarkBits: number; rleAllocated: number; rleUsed: number; needsResizing: number }
  firstRunValue: number
  stats: SegmentStats
  sub?: { records: number; csFlag: number }
}

export interface SegmentDataObject {
  offset: number
  count: number
  sub?: { offset: number; count: number }
}

export interface IdfMetaFull {
  segments: SegmentMetaFull[]
  /** undefined: the 2017 layout without the SDOs block */
  sdos?: SegmentDataObject[]
}

export function parseIdfMetaFull(buf: Uint8Array): IdfMetaFull {
  const r = new ByteReader(buf)
  r.expect('<1:CP\0', 'CP')
  const n = r.u64()
  const segments: SegmentMetaFull[] = []
  for (let i = 0; i < n; i++) {
    r.expect('<1:CS\0', 'CS')
    const records = r.u64()
    const csFlag = r.u64()
    const compressionClass = r.u32()
    const subClass = r.u32()
    const seg: SegmentMetaFull = { records, csFlag, compressionClass, subClass, firstRunValue: 0, stats: undefined as unknown as SegmentStats }
    if (compressionClass === HYBRID_RLE_CLASS) seg.hybrid = { bookmarkBits: r.u64(), rleAllocated: r.u64(), rleUsed: r.u64(), needsResizing: r.u8() }
    seg.firstRunValue = r.u32()
    r.expect('<1:SS\0', 'SS')
    seg.stats = {
      distinctStates: r.u64(),
      minDataId: r.u32(),
      maxDataId: r.u32(),
      originalMinSegmentDataId: r.u32(),
      rleSortOrder: r.i64(),
      rowCount: r.u64(),
      hasNulls: r.u8() !== 0,
      rleRuns: r.u64(),
      othersRleRuns: r.u64()
    }
    r.expect('SS:1>\0', 'SS close')
    if (r.u8() !== 0) {
      r.expect('<1:CS\0', 'sub CS')
      seg.sub = { records: r.u64(), csFlag: r.u64() }
      if (r.u8() !== 0) throw new Error('VertiPaq: nested sub-segment')
      r.expect('CS:1>\0', 'sub CS close')
    }
    r.expect('CS:1>\0', 'CS close')
    segments.push(seg)
  }
  r.expect('CP:1>\0', 'CP close')
  const out: IdfMetaFull = { segments }
  if (!r.eof()) {
    r.expect('<1:SDOs\0', 'SDOs')
    const sdos: SegmentDataObject[] = []
    while (r.peekAscii('<1:CSDOs\0')) {
      r.pos += 9
      const o: SegmentDataObject = { offset: r.u64(), count: r.u64() }
      if (r.peekAscii('<1:CSDOs\0')) {
        r.pos += 9
        o.sub = { offset: r.u64(), count: r.u64() }
        r.expect('CSDOs:1>\0', 'CSDOs close')
      }
      r.expect('CSDOs:1>\0', 'CSDOs close')
      sdos.push(o)
    }
    r.expect('SDOs:1>\0', 'SDOs close')
    out.sdos = sdos
    if (!r.eof()) throw new Error('VertiPaq: trailing bytes after SDOs')
  }
  return out
}

export function writeIdfMeta(m: IdfMetaFull): Uint8Array {
  const w = new ByteWriter(256)
  w.ascii('<1:CP\0').u64(m.segments.length)
  for (const s of m.segments) {
    w.ascii('<1:CS\0').u64(s.records).u64(s.csFlag).u32(s.compressionClass).u32(s.subClass)
    if (s.compressionClass === HYBRID_RLE_CLASS) {
      const h = s.hybrid ?? { bookmarkBits: 0, rleAllocated: 0, rleUsed: 0, needsResizing: 0 }
      w.u64(h.bookmarkBits).u64(h.rleAllocated).u64(h.rleUsed).u8(h.needsResizing)
    }
    w.u32(s.firstRunValue)
    const st = s.stats
    w.ascii('<1:SS\0')
      .u64(st.distinctStates)
      .u32(st.minDataId)
      .u32(st.maxDataId)
      .u32(st.originalMinSegmentDataId)
      .i64(st.rleSortOrder)
      .u64(st.rowCount)
      .u8(st.hasNulls ? 1 : 0)
      .u64(st.rleRuns)
      .u64(st.othersRleRuns)
      .ascii('SS:1>\0')
    if (s.sub) w.u8(1).ascii('<1:CS\0').u64(s.sub.records).u64(s.sub.csFlag).u8(0).ascii('CS:1>\0')
    else w.u8(0)
    w.ascii('CS:1>\0')
  }
  w.ascii('CP:1>\0')
  if (m.sdos) {
    w.ascii('<1:SDOs\0')
    for (const o of m.sdos) {
      w.ascii('<1:CSDOs\0').u64(o.offset).u64(o.count)
      if (o.sub) w.ascii('<1:CSDOs\0').u64(o.sub.offset).u64(o.sub.count).ascii('CSDOs:1>\0')
      w.ascii('CSDOs:1>\0')
    }
    w.ascii('SDOs:1>\0')
  }
  return w.finish()
}
