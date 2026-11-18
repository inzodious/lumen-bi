/**
 * Analysis Services backup (ABF) container parser.
 *
 * Layout knowledge from pbixray (`pbixray/abf/*`, MIT, Copyright (c) 2024 Igor Cotruta,
 * https://github.com/Hugoberry/pbixray); see ./THIRD_PARTY.md.
 *
 * Layout (all offsets absolute within the decompressed ABF):
 *   [0, 72)        `\xff\xfe` + UTF-16 "STREAM_STORAGE_SIGNATURE_)!@#$%^&*(" (+ padding)
 *   [72, 4096)     BackupLogHeader — UTF-16LE XML, zero padded; gives the VirtualDirectory location
 *                  (`m_cbOffsetHeader`, `DataSize`), `ErrorCode` (each file carries a 4-byte trailer)
 *                  and `ApplyCompression` (each file is individually XPress8-compressed — SSAS backups only).
 *   VirtualDirectory — UTF-8 XML: list of BackupFile { Path (storage id), Size, m_cbOffsetHeader }.
 *   The last VirtualDirectory entry is the BackupLog — UTF-16LE XML mapping logical file paths
 *   (FileGroups/FileGroup/FileList/BackupFile { Path, StoragePath, Size }) to storage ids.
 */

import { decompressXpress8Chunked } from './xpress8'

export interface AbfFile {
  /** Logical path relative to the database persist root (Windows separators). */
  path: string
  /** Last path component, e.g. `metadata.sqlitedb`, `12.Sales (25).Amount (102).0.idf`. */
  fileName: string
  storagePath: string
  /** Byte offset within the ABF. */
  offset: number
  /** Stored size (may include a 4-byte trailer when the header's ErrorCode is set). */
  size: number
  /** Logical (uncompressed) size from the backup log. */
  logSize: number
}

export interface AbfArchive {
  bytes: Uint8Array
  files: AbfFile[]
  errorCode: boolean
  applyCompression: boolean
  byName: Map<string, AbfFile>
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeXmlText(s: string): string {
  if (s.indexOf('&') < 0) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[ent] ?? m
  })
}

/** Text content of the first `<tag>` element in `xml` (no nested-element support needed here). */
export function xmlText(xml: string, tag: string): string | undefined {
  const open = xml.indexOf(`<${tag}>`)
  if (open < 0) {
    if (xml.indexOf(`<${tag}/>`) >= 0) return ''
    return undefined
  }
  const start = open + tag.length + 2
  const close = xml.indexOf(`</${tag}>`, start)
  if (close < 0) return undefined
  return decodeXmlText(xml.slice(start, close))
}

/** All `<tag>…</tag>` element bodies (non-nested). */
export function xmlBlocks(xml: string, tag: string): string[] {
  const out: string[] = []
  const openTag = `<${tag}>`
  const closeTag = `</${tag}>`
  let p = 0
  for (;;) {
    const a = xml.indexOf(openTag, p)
    if (a < 0) break
    const b = xml.indexOf(closeTag, a + openTag.length)
    if (b < 0) break
    out.push(xml.slice(a + openTag.length, b))
    p = b + closeTag.length
  }
  return out
}

const utf16 = new TextDecoder('utf-16le')
const utf8 = new TextDecoder('utf-8')

function decodeXmlBytes(bytes: Uint8Array): string {
  // Detect UTF-16LE (BOM or `<\0`) vs UTF-8.
  let s: string
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes.length > 1 && bytes[1] === 0 && bytes[0] !== 0)) s = utf16.decode(bytes)
  else s = utf8.decode(bytes)
  // strip BOM and trailing NUL padding
  let end = s.length
  while (end > 0 && (s.charCodeAt(end - 1) === 0 || s.charCodeAt(end - 1) <= 32)) end--
  let start = 0
  if (s.charCodeAt(0) === 0xfeff) start = 1
  return s.slice(start, end)
}

function int(s: string | undefined, what: string): number {
  const n = s === undefined ? NaN : Number(s)
  if (!Number.isFinite(n)) throw new Error(`ABF: missing/invalid ${what}`)
  return n
}

export function parseAbf(bytes: Uint8Array): AbfArchive {
  if (bytes.length < 4096) throw new Error('ABF: file too small')
  const header = decodeXmlBytes(bytes.subarray(72, 4096))
  const vdOffset = int(xmlText(header, 'm_cbOffsetHeader'), 'BackupLogHeader.m_cbOffsetHeader')
  const vdSize = int(xmlText(header, 'DataSize'), 'BackupLogHeader.DataSize')
  const errorCode = xmlText(header, 'ErrorCode') === 'true'
  const applyCompression = xmlText(header, 'ApplyCompression') === 'true'
  if (vdOffset + vdSize > bytes.length) throw new Error('ABF: virtual directory out of range')

  const vd = decodeXmlBytes(bytes.subarray(vdOffset, vdOffset + vdSize))
  const vdFiles = xmlBlocks(vd, 'BackupFile').map((b) => ({
    path: xmlText(b, 'Path') ?? '',
    size: int(xmlText(b, 'Size'), 'VirtualDirectory.Size'),
    offset: int(xmlText(b, 'm_cbOffsetHeader'), 'VirtualDirectory.m_cbOffsetHeader')
  }))
  if (!vdFiles.length) throw new Error('ABF: empty virtual directory')
  const logEntry = vdFiles[vdFiles.length - 1]
  let logBytes = bytes.subarray(logEntry.offset, logEntry.offset + logEntry.size)
  if (errorCode) logBytes = logBytes.subarray(0, Math.max(0, logBytes.length - 4))
  const log = decodeXmlBytes(logBytes)

  const groups = xmlBlocks(log, 'FileGroup')
  // pbixray uses FileGroups[1].PersistLocationPath as the persist root; fall back to the first
  // group that has one.
  let persistRoot = ''
  const persistPaths = groups.map((g) => xmlText(g, 'PersistLocationPath') ?? '')
  persistRoot = persistPaths[1] || persistPaths.find((p) => p) || ''
  const prefix = persistRoot ? persistRoot + '\\' : ''

  const vdByPath = new Map(vdFiles.map((f) => [f.path, f]))
  const files: AbfFile[] = []
  for (const g of groups) {
    const list = xmlText(g, 'FileList') !== undefined ? g.slice(g.indexOf('<FileList>')) : g
    for (const bf of xmlBlocks(list, 'BackupFile')) {
      const storagePath = xmlText(bf, 'StoragePath') ?? ''
      const vf = vdByPath.get(storagePath)
      if (!vf) continue
      const full = xmlText(bf, 'Path') ?? ''
      const path = prefix && full.startsWith(prefix) ? full.slice(prefix.length) : full
      const fileName = path.slice(path.lastIndexOf('\\') + 1)
      files.push({
        path,
        fileName,
        storagePath,
        offset: vf.offset,
        size: vf.size,
        logSize: Number(xmlText(bf, 'Size') ?? vf.size)
      })
    }
  }
  const byName = new Map<string, AbfFile>()
  for (const f of files) if (!byName.has(f.fileName)) byName.set(f.fileName, f)
  return { bytes, files, errorCode, applyCompression, byName }
}

/** Bytes of a logical file by its file name (last path component). */
export function abfFileBytes(abf: AbfArchive, fileName: string): Uint8Array {
  const f = abf.byName.get(fileName)
  if (!f) throw new Error(`ABF: file not found: ${fileName}`)
  const size = abf.errorCode ? f.size - 4 : f.size
  const raw = abf.bytes.subarray(f.offset, f.offset + size)
  if (abf.applyCompression) return decompressXpress8Chunked(raw, f.logSize)
  return raw
}
