/**
 * Column reconstruction: idf data ids + dictionary / value encoding → Scalar[] per the DataStore
 * value contract (src/core/model/data.ts).
 *
 * Semantics mirror pbixray's `VertiPaqDecoder` (MIT, see THIRD_PARTY.md):
 *  - hash-encoded columns: value = dictionary[dataId - 3]; ids outside the dictionary (the null id 2) → BLANK.
 *  - value-encoded columns: value = (dataId + BaseId) / Magnitude; id 2 → BLANK.
 *  - dateTime: OLE Automation date (days since 1899-12-30) → Date with UTC fields = wall clock.
 *  - decimal (fixed decimal / currency): stored scaled by 10^4 → divided by 10000.
 */

import type { DataType } from '../../../model/types'
import type { Scalar } from '../../../model/data'
import { abfFileBytes, type AbfArchive } from './abf'
import type { ColumnStorageInfo } from './metadata'
import { decodeIdf, parseDictionary, parseIdfMeta, XM_DATA_ID_NULL, XM_FIRST_DATA_ID, type SegmentMeta } from './vertipaq'

const OLE_EPOCH_OFFSET_DAYS = 25569 // 1970-01-01 - 1899-12-30
const MS_PER_DAY = 86400000

export function oleDaysToDate(days: number): Date {
  return new Date(Math.round((days - OLE_EPOCH_OFFSET_DAYS) * MS_PER_DAY))
}

function convertNumber(v: number, type: DataType): Scalar {
  switch (type) {
    case 'dateTime':
      return oleDaysToDate(v)
    case 'decimal':
      return v / 10000
    case 'boolean':
      return v !== 0
    default:
      return v
  }
}

const B64 = new Int16Array(128).fill(-1)
for (let i = 0; i < 64; i++) B64['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.charCodeAt(i)] = i

/** Decode base64 text, ignoring whitespace and padding. */
export function base64ToBytes(s: string): Uint8Array {
  const out = new Uint8Array(Math.floor((s.length * 3) / 4) + 3)
  let acc = 0
  let bits = 0
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const v = c < 128 ? B64[c] : -1
    if (v < 0) continue
    acc = ((acc << 6) | v) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[n++] = (acc >> bits) & 0xff
    }
  }
  return out.slice(0, n)
}

export interface DecodedColumn {
  values: Scalar[]
  rows: number
}

/** Read idfmeta for every partition of a column. */
export function columnSegments(abf: AbfArchive, info: ColumnStorageInfo): SegmentMeta[][] {
  return info.idfs.map((idf) => parseIdfMeta(abfFileBytes(abf, idf + 'meta')))
}

/** Value of a data id of a column (dictionary or value encoding), for relationship indexes. */
export function dataIdDecoder(abf: AbfArchive, info: ColumnStorageInfo, dataType: DataType): (id: number) => Scalar {
  if (info.dictionary) {
    const dict = parseDictionary(abfFileBytes(abf, info.dictionary))
    const lut: Scalar[] = dict.kind === 'string' ? (dataType === 'boolean' ? dict.values.map((s) => s.toLowerCase() === 'true') : dict.values) : Array.from(dict.values, (v) => convertNumber(v, dataType))
    return (id) => {
      const k = id - XM_FIRST_DATA_ID
      return k >= 0 && k < lut.length ? lut[k] : null
    }
  }
  if (info.magnitude !== undefined && info.baseId !== undefined && info.magnitude !== 0) {
    const base = info.baseId
    const mag = info.magnitude
    return (id) => (id === XM_DATA_ID_NULL ? null : convertNumber((id + base) / mag, dataType))
  }
  return () => null
}

/** Raw data ids of an `.idf` stream with its `.idfmeta`. */
export function decodeIds(abf: AbfArchive, idf: string): Uint32Array {
  const segs = parseIdfMeta(abfFileBytes(abf, idf + 'meta'))
  let cap = 0
  for (const s of segs) cap += s.records
  const ids = new Uint32Array(cap)
  const n = decodeIdf(abfFileBytes(abf, idf), segs, ids, 0)
  return ids.subarray(0, n)
}

/**
 * Rows of a relationship INDEX stream (one entry per "from" data id: the matching "to" row, -1 = none). Two storage
 * forms occur: segments whose minimum is -1 store the row itself; the others store it as a data id (row + 3, the null
 * id 2 = no match).
 */
export function relationshipIndexRows(abf: AbfArchive, idf: string): Int32Array {
  const segs = parseIdfMeta(abfFileBytes(abf, idf + 'meta'))
  let cap = 0
  for (const s of segs) cap += s.records
  const ids = new Uint32Array(cap)
  const n = decodeIdf(abfFileBytes(abf, idf), segs, ids, 0)
  const out = new Int32Array(n)
  let i = 0
  for (const s of segs) {
    const direct = s.minDataId === 0xffffffff
    for (let k = 0; k < s.records && i < n; k++, i++) {
      const v = ids[i]
      out[i] = direct ? (v % 4294967296) | 0 : v === XM_DATA_ID_NULL || v < XM_FIRST_DATA_ID ? -1 : v - XM_FIRST_DATA_ID
    }
  }
  return out
}

export function decodeColumn(abf: AbfArchive, info: ColumnStorageInfo, dataType: DataType): DecodedColumn {
  const segs = columnSegments(abf, info)
  let cap = 0
  for (const s of segs) for (const m of s) cap += m.records
  const ids = new Uint32Array(cap)
  let n = 0
  for (let p = 0; p < info.idfs.length; p++) {
    n += decodeIdf(abfFileBytes(abf, info.idfs[p]), segs[p], ids, n)
  }
  const values: Scalar[] = new Array(n)

  if (info.dictionary) {
    const dict = parseDictionary(abfFileBytes(abf, info.dictionary))
    let lut: Scalar[]
    if (dict.kind === 'string') {
      lut = dict.values
      if (dataType === 'boolean') lut = dict.values.map((s) => s.toLowerCase() === 'true')
      // VertiPaq stores binary values as (MIME-wrapped) base64 text.
      else if (dataType === 'binary') lut = dict.values.map(base64ToBytes)
    } else {
      lut = new Array(dict.values.length)
      for (let i = 0; i < dict.values.length; i++) lut[i] = convertNumber(dict.values[i], dataType)
    }
    const len = lut.length
    for (let i = 0; i < n; i++) {
      const k = ids[i] - XM_FIRST_DATA_ID
      values[i] = k >= 0 && k < len ? lut[k] : null
    }
    return { values, rows: n }
  }

  if (info.magnitude !== undefined && info.baseId !== undefined && info.magnitude !== 0) {
    const base = info.baseId
    const mag = info.magnitude
    if (dataType === 'dateTime' || dataType === 'decimal' || dataType === 'boolean') {
      for (let i = 0; i < n; i++) {
        const id = ids[i]
        values[i] = id === XM_DATA_ID_NULL ? null : convertNumber((id + base) / mag, dataType)
      }
    } else {
      for (let i = 0; i < n; i++) {
        const id = ids[i]
        values[i] = id === XM_DATA_ID_NULL ? null : (id + base) / mag
      }
    }
    return { values, rows: n }
  }

  // No dictionary and no value encoding: an all-BLANK column.
  values.fill(null)
  return { values, rows: n }
}
