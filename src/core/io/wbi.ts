/**
 * `.wbi` — Lumen project bundle: a zip with the PBIP layout plus cached data, so a project
 * reopens offline with its data.
 *
 *   manifest.json                        { format: 'wbi', version: 1, name, savedAt, source }
 *   project/<Name>.pbip, project/<Name>.Report/**, project/<Name>.SemanticModel/**
 *   data/tables.json                     [{ name, rowCount, status, columns: [{ name, type, encoding, file, ... }] }]
 *   data/<t>/<c>.bin                     one typed blob per column (little-endian)
 *
 * Column encodings (chosen per column from its values):
 *   'i32'   Int32Array, nulls in a bitmap         'f64'  Float64Array, nulls in a bitmap
 *   'date'  Float64Array of epoch ms (UTC wall clock), nulls in a bitmap
 *   'bool'  Uint8Array 0/1/255(null)              'dict' Uint32Array indices into a JSON string table (0xFFFFFFFF = null)
 *   'json'  JSON array of tagged values (mixed / binary columns)
 * Blob layout: [uint32 nullBitmapBytes][bitmap][padding to 8][values]; 'dict' blobs carry the dictionary
 * in tables.json. The zip is deflated, which keeps dictionaries and bitmaps compact.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import type { ColumnData, DataStore, Scalar, TableData, TableLoadStatus } from '../model/data'
import { emptyDataStore } from '../model/data'
import type { DataType } from '../model/types'
import type { FileMap, OutFileMap } from '../pbir/pbir'

export const WBI_FORMAT_VERSION = 1

type Encoding = 'i32' | 'f64' | 'date' | 'bool' | 'dict' | 'json'

interface ColumnHeader {
  name: string
  type: DataType
  encoding: Encoding
  file: string
  dict?: string[]
}

interface TableHeader {
  name: string
  rowCount: number
  status?: TableLoadStatus
  columns: ColumnHeader[]
}

export interface WbiManifest {
  format: 'wbi'
  version: number
  name: string
  savedAt: string
  generator: string
  source?: unknown
}

function chooseEncoding(values: Scalar[]): Encoding {
  type Kind = 'none' | 'int' | 'num' | 'date' | 'bool' | 'str' | 'mixed'
  let kind = 'none' as Kind
  for (const v of values) {
    if (v === null || v === undefined) continue
    let k: Kind
    if (typeof v === 'number') k = Number.isInteger(v) && v >= -2147483648 && v <= 2147483647 ? 'int' : 'num'
    else if (typeof v === 'string') k = 'str'
    else if (typeof v === 'boolean') k = 'bool'
    else if (v instanceof Date) k = 'date'
    else k = 'mixed'
    if (kind === 'none') kind = k
    else if (kind !== k) {
      if ((kind === 'int' && k === 'num') || (kind === 'num' && k === 'int')) kind = 'num'
      else return 'json'
    }
    if (kind === 'mixed') return 'json'
  }
  switch (kind) {
    case 'int':
      return 'i32'
    case 'num':
      return 'f64'
    case 'date':
      return 'date'
    case 'bool':
      return 'bool'
    case 'str':
      return 'dict'
    default:
      return 'i32' // all null
  }
}

function withBitmap(values: Scalar[], body: (out: DataView, offset: number) => void, bytesPerValue: number): Uint8Array {
  const n = values.length
  const hasNull = values.some((v) => v === null || v === undefined)
  const bm = hasNull ? Math.ceil(n / 8) : 0
  const head = 4 + bm
  const pad = (8 - (head % 8)) % 8
  const buf = new Uint8Array(head + pad + n * bytesPerValue)
  const dv = new DataView(buf.buffer)
  dv.setUint32(0, bm, true)
  if (hasNull) for (let i = 0; i < n; i++) if (values[i] === null || values[i] === undefined) buf[4 + (i >> 3)] |= 1 << (i & 7)
  body(dv, head + pad)
  return buf
}

function encodeColumn(col: ColumnData): { enc: Encoding; bytes: Uint8Array; dict?: string[] } {
  const enc = chooseEncoding(col.values)
  const vals = col.values
  switch (enc) {
    case 'i32':
      return { enc, bytes: withBitmap(vals, (dv, o) => vals.forEach((v, i) => dv.setInt32(o + 4 * i, typeof v === 'number' ? v : 0, true)), 4) }
    case 'f64':
      return { enc, bytes: withBitmap(vals, (dv, o) => vals.forEach((v, i) => dv.setFloat64(o + 8 * i, typeof v === 'number' ? v : 0, true)), 8) }
    case 'date':
      return { enc, bytes: withBitmap(vals, (dv, o) => vals.forEach((v, i) => dv.setFloat64(o + 8 * i, v instanceof Date ? v.getTime() : 0, true)), 8) }
    case 'bool': {
      const b = new Uint8Array(vals.length)
      vals.forEach((v, i) => (b[i] = v === null || v === undefined ? 255 : v ? 1 : 0))
      return { enc, bytes: b }
    }
    case 'dict': {
      const dict: string[] = []
      const index = new Map<string, number>()
      const idx = new Uint32Array(vals.length)
      vals.forEach((v, i) => {
        if (typeof v !== 'string') {
          idx[i] = 0xffffffff
          return
        }
        let k = index.get(v)
        if (k === undefined) {
          k = dict.length
          dict.push(v)
          index.set(v, k)
        }
        idx[i] = k
      })
      return { enc, bytes: new Uint8Array(idx.buffer), dict }
    }
    default: {
      const tagged = vals.map((v) =>
        v === null || v === undefined ? null : v instanceof Date ? { d: v.getTime() } : v instanceof Uint8Array ? { b: bytesToB64(v) } : v
      )
      return { enc: 'json', bytes: strToU8(JSON.stringify(tagged)) }
    }
  }
}

function readBitmap(bytes: Uint8Array): { isNull: (i: number) => boolean; offset: number; dv: DataView } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const bm = dv.getUint32(0, true)
  const head = 4 + bm
  const offset = head + ((8 - (head % 8)) % 8)
  return { isNull: bm ? (i) => (bytes[4 + (i >> 3)] & (1 << (i & 7))) !== 0 : () => false, offset, dv }
}

function decodeColumn(h: ColumnHeader, bytes: Uint8Array, rowCount: number): Scalar[] {
  const out: Scalar[] = new Array(rowCount)
  switch (h.encoding) {
    case 'i32':
    case 'f64':
    case 'date': {
      const { isNull, offset, dv } = readBitmap(bytes)
      for (let i = 0; i < rowCount; i++) {
        if (isNull(i)) out[i] = null
        else if (h.encoding === 'i32') out[i] = dv.getInt32(offset + 4 * i, true)
        else {
          const f = dv.getFloat64(offset + 8 * i, true)
          out[i] = h.encoding === 'date' ? new Date(f) : f
        }
      }
      return out
    }
    case 'bool':
      for (let i = 0; i < rowCount; i++) out[i] = bytes[i] === 255 ? null : bytes[i] === 1
      return out
    case 'dict': {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const dict = h.dict ?? []
      for (let i = 0; i < rowCount; i++) {
        const k = dv.getUint32(4 * i, true)
        out[i] = k === 0xffffffff ? null : dict[k]
      }
      return out
    }
    default: {
      const arr = JSON.parse(strFromU8(bytes)) as unknown[]
      return arr.map((v) => {
        if (v && typeof v === 'object') {
          if ('d' in v) return new Date((v as { d: number }).d)
          if ('b' in v) return b64ToBytes((v as { b: string }).b)
        }
        return v as Scalar
      })
    }
  }
}

function bytesToB64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Encode a DataStore into bundle entries (`data/...`). */
export function encodeDataStore(data: DataStore): OutFileMap {
  const out: OutFileMap = {}
  const headers: TableHeader[] = []
  let t = 0
  for (const [name, table] of data.tables) {
    const th: TableHeader = { name, rowCount: table.rowCount, columns: [] }
    const st = data.status.get(name)
    if (st) th.status = st
    table.columns.forEach((col, c) => {
      const { enc, bytes, dict } = encodeColumn(col)
      const file = `data/${t}/${c}.bin`
      out[file] = bytes
      const ch: ColumnHeader = { name: col.name, type: col.type, encoding: enc, file }
      if (dict) ch.dict = dict
      th.columns.push(ch)
    })
    headers.push(th)
    t++
  }
  for (const [name, st] of data.status) if (!data.tables.has(name)) headers.push({ name, rowCount: 0, status: st, columns: [] })
  out['data/tables.json'] = JSON.stringify(headers)
  return out
}

export function decodeDataStore(files: FileMap): DataStore {
  const store = emptyDataStore()
  const head = files['data/tables.json']
  if (!head) return store
  const headers = JSON.parse(strFromU8(head)) as TableHeader[]
  for (const th of headers) {
    if (th.status) store.status.set(th.name, th.status)
    if (!th.columns.length && th.status && th.status.state !== 'loaded') continue
    const columns: ColumnData[] = th.columns.map((ch) => ({ name: ch.name, type: ch.type, values: decodeColumn(ch, files[ch.file] ?? new Uint8Array(0), th.rowCount) }))
    const table: TableData = { columns, rowCount: th.rowCount }
    store.tables.set(th.name, table)
  }
  return store
}

/** Build the `.wbi` zip. `projectFiles` are PBIP files relative to the project directory. */
export function writeWbi(name: string, projectFiles: OutFileMap, data: DataStore, source?: unknown): Uint8Array {
  const entries: Zippable = {}
  const manifest: WbiManifest = { format: 'wbi', version: WBI_FORMAT_VERSION, name, savedAt: new Date().toISOString(), generator: 'Lumen', source }
  entries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  for (const [p, c] of Object.entries(projectFiles)) entries[`project/${p}`] = typeof c === 'string' ? strToU8(c) : c
  for (const [p, c] of Object.entries(encodeDataStore(data))) entries[p] = typeof c === 'string' ? strToU8(c) : c
  return zipSync(entries, { level: 6 })
}

export interface WbiContents {
  manifest: WbiManifest
  /** PBIP files relative to the project directory */
  project: FileMap
  data: DataStore
}

export function readWbi(bytes: Uint8Array): WbiContents {
  const files = unzipSync(bytes)
  const m = files['manifest.json']
  if (!m) throw new Error('Not a Lumen bundle (manifest.json missing)')
  const manifest = JSON.parse(strFromU8(m)) as WbiManifest
  if (manifest.format !== 'wbi') throw new Error('Not a Lumen bundle')
  if (manifest.version > WBI_FORMAT_VERSION) throw new Error(`This bundle was written by a newer Lumen (format ${manifest.version})`)
  const project: FileMap = {}
  const dataFiles: FileMap = {}
  for (const [p, b] of Object.entries(files)) {
    if (p.startsWith('project/')) project[p.slice('project/'.length)] = b
    else if (p.startsWith('data/')) dataFiles[p] = b
  }
  return { manifest, project, data: decodeDataStore(dataFiles) }
}
