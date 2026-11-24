/**
 * OPC (zip) package reading and writing for `.pbix` / `.pbit`, shaped like the packages Power BI Desktop writes
 * (System.IO.Packaging). Observed in Desktop-saved files (2017 to November 2025):
 *  - local and central headers: "version needed" 2.0, "made by" 4.5 on MS-DOS/FAT, general-purpose flags 0,
 *    no data descriptors, no comments, external attributes 0;
 *  - every part deflated except `DataModel`, which is stored;
 *  - `[Content_Types].xml`: UTF-8 with BOM, `<Default Extension="json" ContentType="" />` plus an `<Override>` with an
 *    empty content type for each extension-less part (`application/json` for /Settings and /Metadata), written in the
 *    order of the parts;
 *  - Desktop pads local headers with a 0xA220 "growth hint" extra field; it is optional and Lumen does not write it.
 * Part names are percent-encoded like OPC part URIs (Desktop's reader decodes them; see container.ts DAXQueries).
 * Raw entries of a source package can be copied without recompression, byte for byte (`addRaw`).
 */
import { deflateSync } from 'fflate'

export interface ZipEntry {
  /** decoded part name, e.g. `Report/Layout` */
  name: string
  /** name exactly as stored in the zip */
  rawName: string
  method: number
  crc: number
  compressedSize: number
  size: number
  dosTime: number
  dosDate: number
  flags: number
  /** compressed bytes (a view into the source package) */
  data: Uint8Array
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = -1
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

const utf8 = new TextEncoder()
const utf8d = new TextDecoder('utf-8')

/** Percent-encode a part name the way OPC part URIs are stored (keeps `/` and RFC 3986 pchar characters). */
export function encodePartName(name: string): string {
  let out = ''
  for (const ch of name) {
    if (/^[A-Za-z0-9\-._~!$&'()*+,;=:@/[\]]$/.test(ch)) out += ch
    else for (const b of utf8.encode(ch)) out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

export function decodePartName(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** Text as UTF-16LE without BOM (Desktop's encoding for Version, DataModelSchema, DiagramLayout, Report/Layout, Settings, Metadata). */
export function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2)
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    out[i * 2] = c & 0xff
    out[i * 2 + 1] = c >>> 8
  }
  return out
}

/** Decode a UTF-16LE part (with or without BOM). */
export function fromUtf16le(bytes: Uint8Array): string {
  const s = new TextDecoder('utf-16le').decode(bytes)
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8)
}
function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
}
function u64(b: Uint8Array, o: number): number {
  return u32(b, o) + u32(b, o + 4) * 0x100000000
}

/** Read the central directory of a zip; entries keep a view of their compressed bytes (no copies, no inflation). */
export function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end of central directory)')
  let count = u16(bytes, eocd + 10)
  let cdOffset = u32(bytes, eocd + 16)
  if (cdOffset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20
    if (loc >= 0 && u32(bytes, loc) === 0x07064b50) {
      const z64 = u64(bytes, loc + 8)
      count = u64(bytes, z64 + 32)
      cdOffset = u64(bytes, z64 + 48)
    }
  }
  const out: ZipEntry[] = []
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('Corrupt zip central directory')
    const flags = u16(bytes, p + 8)
    const method = u16(bytes, p + 10)
    const dosTime = u16(bytes, p + 12)
    const dosDate = u16(bytes, p + 14)
    const crc = u32(bytes, p + 16)
    let compressedSize = u32(bytes, p + 20)
    let size = u32(bytes, p + 24)
    const nameLen = u16(bytes, p + 28)
    const extraLen = u16(bytes, p + 30)
    const commentLen = u16(bytes, p + 32)
    let localOffset = u32(bytes, p + 42)
    const rawName = utf8d.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    // zip64 extra field
    let e = p + 46 + nameLen
    const eEnd = e + extraLen
    while (e + 4 <= eEnd) {
      const id = u16(bytes, e)
      const len = u16(bytes, e + 2)
      if (id === 0x0001) {
        let q = e + 4
        if (size === 0xffffffff) (size = u64(bytes, q)), (q += 8)
        if (compressedSize === 0xffffffff) (compressedSize = u64(bytes, q)), (q += 8)
        if (localOffset === 0xffffffff) localOffset = u64(bytes, q)
      }
      e += 4 + len
    }
    if (u32(bytes, localOffset) !== 0x04034b50) throw new Error(`Corrupt zip local header for ${rawName}`)
    const dataStart = localOffset + 30 + u16(bytes, localOffset + 26) + u16(bytes, localOffset + 28)
    out.push({ name: decodePartName(rawName), rawName, method, crc, compressedSize, size, dosTime, dosDate, flags, data: bytes.subarray(dataStart, dataStart + compressedSize) })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  }
}

interface Written {
  rawName: Uint8Array
  method: number
  crc: number
  compressedSize: number
  size: number
  time: number
  date: number
  offset: number
  utf8Flag: number
}

export interface ZipWriterOptions {
  /** timestamp written for new parts (default: now); fixed in tests for deterministic output */
  date?: Date
}

/** Sequential zip writer: parts are appended in call order; `finish()` returns the package bytes. */
export class ZipWriter {
  private chunks: Uint8Array[] = []
  private offset = 0
  private entries: Written[] = []
  private names = new Set<string>()
  private readonly time: number
  private readonly date: number

  constructor(opts: ZipWriterOptions = {}) {
    const dt = dosDateTime(opts.date ?? new Date())
    this.time = dt.time
    this.date = dt.date
  }

  /** Part names written so far, in order. */
  get partNames(): string[] {
    return [...this.names]
  }

  has(name: string): boolean {
    return this.names.has(name)
  }

  /** Add a part; `store` writes it uncompressed (Desktop stores `DataModel`). */
  add(name: string, data: Uint8Array | string, opts: { store?: boolean } = {}): void {
    const bytes = typeof data === 'string' ? utf8.encode(data) : data
    const method = opts.store ? 0 : 8
    const body = method === 8 ? deflateSync(bytes, { level: 6 }) : bytes
    this.push(name, encodePartName(name), method, crc32(bytes), body, bytes.length, this.time, this.date)
  }

  /** Copy a part of a source package byte for byte (compressed bytes, CRC and timestamp unchanged). */
  addRaw(entry: ZipEntry, name = entry.name): void {
    this.push(name, name === entry.name ? entry.rawName : encodePartName(name), entry.method, entry.crc, entry.data, entry.size, entry.dosTime, entry.dosDate)
  }

  private push(name: string, rawName: string, method: number, crc: number, body: Uint8Array, size: number, time: number, date: number): void {
    if (this.names.has(name)) throw new Error(`Duplicate package part: ${name}`)
    if (body.length >= 0xffffffff || size >= 0xffffffff || this.offset >= 0xffffffff) throw new Error('Package parts larger than 4 GB are not supported')
    this.names.add(name)
    const nameBytes = utf8.encode(rawName)
    const utf8Flag = /^[\x20-\x7e]*$/.test(rawName) ? 0 : 0x0800
    const h = new Uint8Array(30 + nameBytes.length)
    const dv = new DataView(h.buffer)
    dv.setUint32(0, 0x04034b50, true)
    dv.setUint16(4, 20, true)
    dv.setUint16(6, utf8Flag, true)
    dv.setUint16(8, method, true)
    dv.setUint16(10, time, true)
    dv.setUint16(12, date, true)
    dv.setUint32(14, crc, true)
    dv.setUint32(18, body.length, true)
    dv.setUint32(22, size, true)
    dv.setUint16(26, nameBytes.length, true)
    dv.setUint16(28, 0, true)
    h.set(nameBytes, 30)
    this.entries.push({ rawName: nameBytes, method, crc, compressedSize: body.length, size, time, date, offset: this.offset, utf8Flag })
    this.chunks.push(h, body)
    this.offset += h.length + body.length
  }

  /** Central directory + end record; returns the whole package (one copy of the parts). */
  finish(): Uint8Array {
    const cdStart = this.offset
    for (const e of this.entries) {
      const c = new Uint8Array(46 + e.rawName.length)
      const dv = new DataView(c.buffer)
      dv.setUint32(0, 0x02014b50, true)
      dv.setUint16(4, 0x002d, true) // made by 4.5, MS-DOS
      dv.setUint16(6, 20, true)
      dv.setUint16(8, e.utf8Flag, true)
      dv.setUint16(10, e.method, true)
      dv.setUint16(12, e.time, true)
      dv.setUint16(14, e.date, true)
      dv.setUint32(16, e.crc, true)
      dv.setUint32(20, e.compressedSize, true)
      dv.setUint32(24, e.size, true)
      dv.setUint16(28, e.rawName.length, true)
      dv.setUint32(42, e.offset, true)
      c.set(e.rawName, 46)
      this.chunks.push(c)
      this.offset += c.length
    }
    const end = new Uint8Array(22)
    const dv = new DataView(end.buffer)
    dv.setUint32(0, 0x06054b50, true)
    dv.setUint16(8, this.entries.length, true)
    dv.setUint16(10, this.entries.length, true)
    dv.setUint32(12, this.offset - cdStart, true)
    dv.setUint32(16, cdStart, true)
    this.chunks.push(end)
    this.offset += 22
    const out = new Uint8Array(this.offset)
    let p = 0
    for (const ch of this.chunks) {
      out.set(ch, p)
      p += ch.length
    }
    this.chunks = []
    return out
  }
}

/** Parts whose content type Desktop writes as `application/json`. */
const JSON_PARTS = new Set(['Settings', 'Metadata'])

function xmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * `[Content_Types].xml` for the given part names, in Desktop's form: `json` (and every other extension used) as an
 * empty-type Default, one Override per extension-less part.
 */
export function contentTypesXml(partNames: string[]): string {
  const exts: string[] = ['json']
  const overrides: string[] = []
  for (const name of partNames) {
    if (name === '[Content_Types].xml') continue
    const last = name.slice(name.lastIndexOf('/') + 1)
    const dot = last.lastIndexOf('.')
    if (dot > 0) {
      const ext = last.slice(dot + 1).toLowerCase()
      if (!exts.includes(ext)) exts.push(ext)
    } else overrides.push(name)
  }
  let xml = '﻿<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  for (const e of exts) xml += `<Default Extension="${xmlAttr(e)}" ContentType="" />`
  for (const o of overrides) xml += `<Override PartName="/${xmlAttr(encodePartName(o))}" ContentType="${JSON_PARTS.has(o) ? 'application/json' : ''}" />`
  xml += '</Types>'
  return xml
}
