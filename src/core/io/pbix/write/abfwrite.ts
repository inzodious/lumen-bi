/**
 * Analysis Services backup (ABF) writer: rebuilds an ABF read with `parseAbf`, optionally replacing the
 * bytes of inner files. Mirrors the reader in `../datamodel/abf.ts` (layout knowledge from pbixray, MIT;
 * see `../datamodel/THIRD_PARTY.md`), with the layout rules below measured on real files.
 *
 * Layout (every Power BI file examined: the seven Microsoft samples, 2017 and 2023, and a file saved by
 * Power BI Desktop in November 2025):
 *   [0, 72)          `\xff\xfe` + UTF-16LE "STREAM_STORAGE_SIGNATURE_)!@#$%^&*(" — copied unchanged
 *   [72, 4096)       BackupLogHeader, UTF-16LE XML without BOM, zero padded. Holds `m_cbOffsetHeader` (offset
 *                    of the VirtualDirectory), `DataSize` (its byte length), `Files` (its entry count),
 *                    `m_cbOffsetData` (4096, first file blob), `ErrorCode`, `ApplyCompression`.
 *   file blobs       in VirtualDirectory order, back to back from `m_cbOffsetData` (no gaps in any real file);
 *                    the last one is the BackupLog (`LOG`).
 *   zero padding     up to the next multiple of 4096
 *   VirtualDirectory UTF-8 XML (2023+ files) or UTF-16LE XML (2017 files), no BOM: per BackupFile
 *                    `Path` (storage id), `Size` (stored bytes), `m_cbOffsetHeader` (blob offset), timestamps.
 *   zero padding     up to the next multiple of 4096 (end of file)
 * The BackupLog (UTF-16LE with BOM) maps logical paths to storage ids and gives each file's logical `Size`.
 *
 * Rebuilding keeps every byte that does not have to change: the header, VirtualDirectory and BackupLog XML
 * are patched in place (only the numbers `Size`, `m_cbOffsetHeader` and `DataSize` that depend on a
 * replaced file's length), untouched blobs are copied, padding follows the source file's rule. With no
 * replacements the output is byte-identical to the input.
 *
 * `ErrorCode = true` (a 4-byte trailer after each blob) occurs in no Power BI file examined; replacing a
 * file in such an archive is refused because the trailer's content is unknown. `ApplyCompression = true`
 * (each blob XPress8-compressed, 2017-era files) is supported by storing replacements as XPress8 *stored*
 * chunks (`[u16 size][u16 size][bytes]`, 4096 bytes each), a chunk form those real files also contain.
 */

import type { AbfArchive } from '../datamodel/abf'

const PAGE = 4096
const HEADER_START = 72

export interface AbfRebuildOptions {
  /** reserved for future layout options */
  readonly _?: never
}

interface Entry {
  path: string
  size: number
  offset: number
  /** positions within the VirtualDirectory text */
  sizeAt: [number, number]
  offsetAt: [number, number]
}

/** Lossless code-unit decoding of UTF-16LE bytes (no replacement characters). */
function decodeUtf16(bytes: Uint8Array): string {
  let s = ''
  const CH = 8192
  for (let i = 0; i + 1 < bytes.length; i += CH * 2) {
    const n = Math.min(CH, (bytes.length - i) >> 1)
    const units = new Array<number>(n)
    for (let k = 0; k < n; k++) units[k] = bytes[i + 2 * k] | (bytes[i + 2 * k + 1] << 8)
    s += String.fromCharCode(...units)
  }
  return s
}

function encodeUtf16(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out[2 * i] = c & 255
    out[2 * i + 1] = c >>> 8
  }
  return out
}

/** Lossless byte-per-char decoding (the XML is ASCII; patches only touch ASCII digits). */
function decodeBytes(bytes: Uint8Array): string {
  let s = ''
  const CH = 8192
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH))
  return s
}

function encodeBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

function isUtf16(bytes: Uint8Array): boolean {
  return (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes.length > 1 && bytes[1] === 0 && bytes[0] !== 0)
}

/** [start, end) of the text of `<tag>…</tag>` searched in `s[from, to)`. */
function tagValue(s: string, tag: string, from: number, to: number): [number, number] | undefined {
  const open = `<${tag}>`
  const a = s.indexOf(open, from)
  if (a < 0 || a >= to) return undefined
  const start = a + open.length
  const b = s.indexOf(`</${tag}>`, start)
  if (b < 0 || b > to) return undefined
  return [start, b]
}

/** Apply sorted, non-overlapping replacements of `s` ranges. */
function patch(s: string, edits: Array<{ at: [number, number]; text: string }>): string {
  edits.sort((x, y) => x.at[0] - y.at[0])
  let out = ''
  let p = 0
  for (const e of edits) {
    out += s.slice(p, e.at[0]) + e.text
    p = e.at[1]
  }
  return out + s.slice(p)
}

const alignUp = (n: number): number => Math.ceil(n / PAGE) * PAGE

/** XPress8 chunked stream made of stored chunks only (4096 bytes each). */
export function xpress8Stored(data: Uint8Array): Uint8Array {
  const chunks = Math.ceil(data.length / PAGE)
  const out = new Uint8Array(data.length + chunks * 4)
  let o = 0
  for (let i = 0; i < data.length; i += PAGE) {
    const n = Math.min(PAGE, data.length - i)
    out[o] = n & 255
    out[o + 1] = n >>> 8
    out[o + 2] = n & 255
    out[o + 3] = n >>> 8
    out.set(data.subarray(i, i + n), o + 4)
    o += 4 + n
  }
  return out
}

/** Rebuild an ABF, replacing inner files (keyed by file name, e.g. `metadata.sqlitedb`). */
export function rebuildAbf(abf: AbfArchive, replace?: Map<string, Uint8Array>, _opts: AbfRebuildOptions = {}): Uint8Array {
  const src = abf.bytes
  // ---- header
  let hEnd = HEADER_START
  while (hEnd + 1 < PAGE && (src[hEnd] !== 0 || src[hEnd + 1] !== 0)) hEnd += 2
  const header = decodeUtf16(src.subarray(HEADER_START, hEnd))
  const vdOffAt = tagValue(header, 'm_cbOffsetHeader', 0, header.length)
  const vdSizeAt = tagValue(header, 'DataSize', 0, header.length)
  if (!vdOffAt || !vdSizeAt) throw new Error('ABF: header without m_cbOffsetHeader / DataSize')
  const vdOffset = Number(header.slice(...vdOffAt))
  const vdSize = Number(header.slice(...vdSizeAt))

  // ---- virtual directory
  const vdRaw = src.subarray(vdOffset, vdOffset + vdSize)
  const vdWide = isUtf16(vdRaw)
  const vd = vdWide ? decodeUtf16(vdRaw) : decodeBytes(vdRaw)
  const entries: Entry[] = []
  for (let p = 0; ; ) {
    const a = vd.indexOf('<BackupFile>', p)
    if (a < 0) break
    const b = vd.indexOf('</BackupFile>', a)
    if (b < 0) throw new Error('ABF: unterminated VirtualDirectory entry')
    const pathAt = tagValue(vd, 'Path', a, b)
    const sizeAt = tagValue(vd, 'Size', a, b)
    const offsetAt = tagValue(vd, 'm_cbOffsetHeader', a, b)
    if (!pathAt || !sizeAt || !offsetAt) throw new Error('ABF: incomplete VirtualDirectory entry')
    entries.push({ path: vd.slice(...pathAt), size: Number(vd.slice(...sizeAt)), offset: Number(vd.slice(...offsetAt)), sizeAt, offsetAt })
    p = b
  }
  if (!entries.length) throw new Error('ABF: empty virtual directory')
  const logIdx = entries.length - 1

  // ---- replacements: new stored blobs and logical sizes
  const newBlob = new Map<number, Uint8Array>()
  const logSizes = new Map<string, number>() // storage path -> new logical size
  if (replace?.size) {
    if (abf.errorCode) throw new Error('ABF: replacing files of a backup with ErrorCode trailers is not supported')
    const byPath = new Map(entries.map((e, i) => [e.path, i]))
    for (const [name, data] of replace) {
      const f = abf.byName.get(name)
      if (!f) throw new Error(`ABF: file not found: ${name}`)
      const i = byPath.get(f.storagePath)
      if (i === undefined || i === logIdx) throw new Error(`ABF: file not in the virtual directory: ${name}`)
      newBlob.set(i, abf.applyCompression ? xpress8Stored(data) : data)
      logSizes.set(f.storagePath, data.length)
    }
  }

  // ---- backup log (patched only when a logical size changed)
  const logE = entries[logIdx]
  let logBytes: Uint8Array = src.subarray(logE.offset, logE.offset + logE.size)
  if (logSizes.size) {
    const wide = isUtf16(logBytes)
    const log = wide ? decodeUtf16(logBytes) : decodeBytes(logBytes)
    const edits: Array<{ at: [number, number]; text: string }> = []
    for (let p = 0; ; ) {
      const a = log.indexOf('<BackupFile>', p)
      if (a < 0) break
      const b = log.indexOf('</BackupFile>', a)
      if (b < 0) break
      const spAt = tagValue(log, 'StoragePath', a, b)
      const sp = spAt ? log.slice(...spAt) : undefined
      const size = sp !== undefined ? logSizes.get(sp) : undefined
      if (size !== undefined) {
        const at = tagValue(log, 'Size', a, b)
        if (!at) throw new Error(`ABF: backup log entry without Size: ${sp}`)
        edits.push({ at, text: String(size) })
      }
      p = b
    }
    if (edits.length !== logSizes.size) throw new Error('ABF: replaced file missing from the backup log')
    const text = patch(log, edits)
    logBytes = wide ? encodeUtf16(text) : encodeBytes(text)
    newBlob.set(logIdx, logBytes)
  }

  // ---- layout: keep the source's gaps between blobs and its padding rule
  const newOffsets: number[] = []
  const newSizes: number[] = []
  let prevOrigEnd = entries[0].offset
  let cursor = entries[0].offset
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const gap = Math.max(0, e.offset - prevOrigEnd)
    cursor += gap
    newOffsets.push(cursor)
    const size = newBlob.get(i)?.length ?? e.size
    newSizes.push(size)
    cursor += size
    prevOrigEnd = e.offset + e.size
  }
  const origBlobEnd = prevOrigEnd
  const padRuleVd = vdOffset === alignUp(origBlobEnd)
  const newVdOffset = padRuleVd ? alignUp(cursor) : cursor + (vdOffset - origBlobEnd)

  const vdEdits: Array<{ at: [number, number]; text: string }> = []
  for (let i = 0; i < entries.length; i++) {
    if (newSizes[i] !== entries[i].size) vdEdits.push({ at: entries[i].sizeAt, text: String(newSizes[i]) })
    if (newOffsets[i] !== entries[i].offset) vdEdits.push({ at: entries[i].offsetAt, text: String(newOffsets[i]) })
  }
  const newVdBytes: Uint8Array = vdEdits.length ? (vdWide ? encodeUtf16(patch(vd, vdEdits)) : encodeBytes(patch(vd, vdEdits))) : vdRaw
  const origEnd = src.length
  const padRuleEnd = origEnd === alignUp(vdOffset + vdSize)
  const newEnd = padRuleEnd ? alignUp(newVdOffset + newVdBytes.length) : newVdOffset + newVdBytes.length + Math.max(0, origEnd - vdOffset - vdSize)

  // ---- header patch
  const headerEdits: Array<{ at: [number, number]; text: string }> = []
  if (newVdOffset !== vdOffset) headerEdits.push({ at: vdOffAt, text: String(newVdOffset) })
  if (newVdBytes.length !== vdSize) headerEdits.push({ at: vdSizeAt, text: String(newVdBytes.length) })
  const headerBytes = headerEdits.length ? encodeUtf16(patch(header, headerEdits)) : src.subarray(HEADER_START, hEnd)
  if (HEADER_START + headerBytes.length > PAGE) throw new Error('ABF: header too large')

  // ---- assemble
  const out = new Uint8Array(newEnd)
  out.set(src.subarray(0, HEADER_START), 0)
  out.set(headerBytes, HEADER_START)
  // bytes between the header text and the first blob (zero padding in every real file)
  if (!headerEdits.length) out.set(src.subarray(hEnd, Math.min(entries[0].offset, src.length)), hEnd)
  prevOrigEnd = entries[0].offset
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const gap = Math.max(0, e.offset - prevOrigEnd)
    if (gap) out.set(src.subarray(prevOrigEnd, e.offset), newOffsets[i] - gap)
    const blob = newBlob.get(i) ?? src.subarray(e.offset, e.offset + e.size)
    out.set(blob, newOffsets[i])
    prevOrigEnd = e.offset + e.size
  }
  out.set(newVdBytes, newVdOffset)
  return out
}
