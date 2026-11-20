/**
 * Column values → VertiPaq hash encoding: a `.dictionary` of the distinct values and one data id per row (3 + the
 * value's index in the dictionary, 2 = BLANK). The inverse of `parseDictionary` + `decodeColumn` in
 * `../../datamodel/`.
 *
 * Lumen writes every column hash-encoded. Power BI chooses between hash and value encoding per column; both occur for
 * every data type in real files (all seven Microsoft samples and a November 2025 Desktop file), and a hash-encoded
 * column needs no `.hidx` hash index (only value-encoded columns carry one), so hash encoding keeps the set of file
 * kinds Lumen writes small.
 *
 * Storage per data type (every real file examined; `DictionaryStorage.DataType` / `ColumnStorage.Statistics_DBType` /
 * `Statistics_XMType` in brackets):
 *   text                    string dictionary [2 / 130 / 2]
 *   whole number            long dictionary, 32-bit elements when every value fits, else 64-bit [6 / 20 / 0]
 *   true/false              long dictionary of 0 / 1 [6 / 11 / 0]
 *   decimal number          real dictionary (IEEE double) [8 / 5 / 1]
 *   date / date-time        real dictionary of OLE Automation dates (days since 1899-12-30) [8 / 7 / 1]
 *   fixed decimal (currency) long dictionary of value × 10,000 [6 / 6 / 0]: the scaling is the one the reader applies
 *                           (pbixray's rule); no file on hand has a fixed decimal column, so the storage codes are
 *                           not confirmed by a real file.
 *
 * Header fields (identical in every dictionary of the files on hand): hash information `[1, 8, 64, 6, -1, -1]` for
 * strings, `[-1, 8, 64, 6, -1, -1]` for 32-bit longs, `[-1, 16, 64, 3, -1, -1]` for 64-bit longs and reals. Strings are
 * written as one page: up to MAX_UNCOMPRESSED_CHARS characters uncompressed, beyond that Huffman-compressed (huffman.ts),
 * as real files do (Desktop rejects a large uncompressed page). Uncompressed pages: characters UTF-16LE, each string NUL-terminated, `allocBytes` = 2 × characters,
 * `storeCompressed` 1, page mask 0, `storeLongestString` = longest string in UTF-16 code units, handles
 * `(character offset, page 0)`.
 *
 * Text comparison follows Power BI's default collation (case-insensitive): values that differ only in case are one
 * dictionary entry, spelled as first seen, as the engine stores them.
 */
import type { Scalar } from '../../../../model/data'
import type { DataType } from '../../../../model/types'
import { DICT_LONG, DICT_REAL, DICT_STRING, writeDictionaryFull, type DictionaryFull } from './dictionaryFormat'
import { XM_FIRST_ID, XM_NULL_ID } from './idf'
import { compressStrings } from './huffman'

/** Largest uncompressed string page written (characters, NULs included); real files: 7,075 at most. */
export const MAX_UNCOMPRESSED_CHARS = 4096

const OLE_EPOCH_OFFSET_DAYS = 25569
const MS_PER_DAY = 86400000

/** Storage codes of a column as `DictionaryStorage` / `ColumnStorage` rows record them. */
export interface StorageCodes {
  /** DictionaryStorage.DataType: 2 string, 6 long, 8 real */
  dictDataType: number
  /** ColumnStorage.Statistics_DBType (OLE DB type) */
  dbType: number
  /** ColumnStorage.Statistics_XMType: 0 long, 1 real, 2 string */
  xmType: number
  /** DictionaryStorage.IsOperatingOn32 */
  operatingOn32: boolean
}

export interface EncodedColumn {
  kind: 'string' | 'long' | 'real'
  /** data id per row */
  ids: Uint32Array
  /** distinct stored values in id order (id = 3 + index): strings, or numbers as stored (scaled, OLE days, 0/1) */
  values: Array<string | number>
  hasNulls: boolean
  /** `.dictionary` bytes */
  dictionary: Uint8Array
  codes: StorageCodes
}

export class UnsupportedColumnError extends Error {}

/** Stored dictionary value of a cell (undefined = BLANK). */
export function storedValue(v: Scalar, dataType: DataType): string | number | undefined {
  if (v === null || v === undefined) return undefined
  switch (dataType) {
    case 'string':
      return typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : String(v)
    case 'int64': {
      const n = typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : Number(v)
      if (!Number.isFinite(n)) return undefined
      return Math.round(n)
    }
    case 'boolean':
      return v === true || v === 1 || (typeof v === 'string' && v.toLowerCase() === 'true') ? 1 : 0
    case 'decimal': {
      const n = typeof v === 'number' ? v : Number(v)
      if (!Number.isFinite(n)) return undefined
      return Math.round(n * 10000)
    }
    case 'dateTime': {
      const ms = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(String(v))
      if (!Number.isFinite(ms)) return undefined
      return ms / MS_PER_DAY + OLE_EPOCH_OFFSET_DAYS
    }
    case 'double': {
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isNaN(n) ? undefined : n
    }
    default:
      throw new UnsupportedColumnError(`data type ${dataType}`)
  }
}

export function storageCodes(dataType: DataType, longFits32 = true): StorageCodes {
  switch (dataType) {
    case 'string':
      return { dictDataType: 2, dbType: 130, xmType: 2, operatingOn32: false }
    case 'int64':
      return { dictDataType: 6, dbType: 20, xmType: 0, operatingOn32: longFits32 }
    case 'boolean':
      return { dictDataType: 6, dbType: 11, xmType: 0, operatingOn32: true }
    case 'decimal':
      return { dictDataType: 6, dbType: 6, xmType: 0, operatingOn32: longFits32 }
    case 'double':
      return { dictDataType: 8, dbType: 5, xmType: 1, operatingOn32: false }
    case 'dateTime':
      return { dictDataType: 8, dbType: 7, xmType: 1, operatingOn32: false }
    default:
      throw new UnsupportedColumnError(`data type ${dataType}`)
  }
}

const STRING_HASH = [1, 8, 64, 6, -1, -1]
const LONG32_HASH = [-1, 8, 64, 6, -1, -1]
const WIDE_HASH = [-1, 16, 64, 3, -1, -1]

/** Case-insensitive identity of a text value (Power BI's default collation). */
export function textKey(s: string): string {
  return s.toLocaleLowerCase('en-US')
}

/** Hash-encode one column. */
export function encodeColumn(values: ArrayLike<Scalar>, dataType: DataType): EncodedColumn {
  const n = values.length
  const ids = new Uint32Array(n)
  const distinct: Array<string | number> = []
  let hasNulls = false
  const kind: EncodedColumn['kind'] = dataType === 'string' ? 'string' : dataType === 'double' || dataType === 'dateTime' ? 'real' : 'long'
  if (kind === 'string') {
    const index = new Map<string, number>()
    for (let r = 0; r < n; r++) {
      const v = storedValue(values[r], dataType) as string | undefined
      if (v === undefined) {
        ids[r] = XM_NULL_ID
        hasNulls = true
        continue
      }
      const k = textKey(v)
      let i = index.get(k)
      if (i === undefined) {
        i = distinct.length
        index.set(k, i)
        distinct.push(v)
      }
      ids[r] = XM_FIRST_ID + i
    }
  } else {
    const index = new Map<number, number>()
    for (let r = 0; r < n; r++) {
      let v = storedValue(values[r], dataType) as number | undefined
      if (v === undefined) {
        ids[r] = XM_NULL_ID
        hasNulls = true
        continue
      }
      if (Object.is(v, -0)) v = 0
      let i = index.get(v)
      if (i === undefined) {
        i = distinct.length
        index.set(v, i)
        distinct.push(v)
      }
      ids[r] = XM_FIRST_ID + i
    }
  }
  let fits32 = true
  if (kind === 'long') for (const v of distinct as number[]) if (v < -2147483648 || v > 2147483647) fits32 = false
  const dictionary = writeDictionaryFull(buildDictionary(kind, distinct, fits32))
  return { kind, ids, values: distinct, hasNulls, dictionary, codes: storageCodes(dataType, fits32) }
}

export function buildDictionary(kind: EncodedColumn['kind'], distinct: Array<string | number>, fits32 = true): DictionaryFull {
  if (kind === 'long') {
    const nums = new BigInt64Array(distinct.length)
    distinct.forEach((v, i) => (nums[i] = BigInt(Math.round(v as number))))
    return { type: DICT_LONG, hashInfo: fits32 ? LONG32_HASH : WIDE_HASH, elementSize: fits32 ? 4 : 8, numbers: nums }
  }
  if (kind === 'real') return { type: DICT_REAL, hashInfo: WIDE_HASH, elementSize: 8, numbers: Float64Array.from(distinct as number[]) }
  const strings = distinct as string[]
  let total = 0
  let longestAll = 0
  for (const s of strings) {
    total += s.length + 1
    if (s.length > longestAll) longestAll = s.length
  }
  if (total > MAX_UNCOMPRESSED_CHARS) {
    const c = compressStrings(strings)
    return {
      type: DICT_STRING,
      hashInfo: STRING_HASH,
      storeStringCount: strings.length,
      storeCompressed: 1,
      storeLongestString: longestAll,
      pages: [{ pageMask: 1n, containsNulls: 0, startIndex: 0, stringCount: strings.length, body: c.body }],
      handleSize: 8,
      handles: c.handles.map((h) => [h, 0] as [number, number])
    }
  }
  let chars = 0
  let longest = 0
  const handles: Array<[number, number]> = []
  for (const s of strings) {
    handles.push([chars, 0])
    chars += s.length + 1
    if (s.length > longest) longest = s.length
  }
  const bytes = new Uint8Array(chars * 2)
  let p = 0
  for (const s of strings) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      bytes[p++] = c & 255
      bytes[p++] = c >>> 8
    }
    p += 2
  }
  return {
    type: DICT_STRING,
    hashInfo: STRING_HASH,
    storeStringCount: strings.length,
    storeCompressed: 1,
    storeLongestString: longest,
    pages: [
      {
        pageMask: 0n,
        containsNulls: 0,
        startIndex: 0,
        stringCount: strings.length,
        body: { compressed: false, remaining: 0, charsUsed: chars, allocBytes: chars * 2, chars: bytes, slack: new Uint8Array(0) }
      }
    ],
    handleSize: 8,
    handles
  }
}
