/**
 * DataModel stream container: detects how the Analysis Services backup (ABF) is wrapped and
 * returns the raw ABF bytes. Framing as implemented by pbixray's `loader.py` (MIT, Copyright (c)
 * 2024 Igor Cotruta, https://github.com/Hugoberry/pbixray); see ./THIRD_PARTY.md.
 *
 *  - uncompressed: the stream *is* the ABF (starts with `\xff\xfe` + UTF-16 "STREAM_STORAGE_SIGNATURE_)!@#$%^&*(").
 *  - single-threaded XPress9: 102-byte UTF-16 signature "This backup was created using XPress9 compression."
 *    then repeated `[u32 uncompressedSize][u32 compressedSize][compressed bytes]` chunks forming ONE session.
 *  - multi-threaded XPress9: signature "This backup was created using multithreaded XPrs9." then five u64
 *    (mainChunksPerThread, prefixChunksPerThread, prefixThreadCount, mainThreadCount, chunkUncompressedSize);
 *    prefix thread groups then main thread groups follow, each group being an independent session of
 *    `chunksPerThread` chunks framed as above. Output order = prefix groups, then main groups.
 */

import { Xpress9Error, Xpress9Session } from './xpress9'

const SINGLE_SIG = 'This backup was created using XPress9 compression.'
const MULTI_SIG = 'This backup was created using multithreaded XPrs9.'
const STREAM_STORAGE_SIG = 'STREAM_STORAGE_SIGNATURE_)!@#$%^&*('

export type DataModelCompression = 'uncompressed' | 'xpress9' | 'xpress9-multithreaded' | 'unknown'

function utf16At(bytes: Uint8Array, offset: number, chars: number): string {
  let s = ''
  for (let i = 0; i < chars; i++) {
    const p = offset + i * 2
    if (p + 1 >= bytes.length) break
    s += String.fromCharCode(bytes[p] | (bytes[p + 1] << 8))
  }
  return s
}

export function detectCompression(bytes: Uint8Array): DataModelCompression {
  if (bytes.length >= 72 && bytes[0] === 0xff && bytes[1] === 0xfe && utf16At(bytes, 2, STREAM_STORAGE_SIG.length) === STREAM_STORAGE_SIG) {
    return 'uncompressed'
  }
  const sig = utf16At(bytes, 0, 51)
  if (sig.includes(SINGLE_SIG)) return 'xpress9'
  if (sig.includes(MULTI_SIG)) return 'xpress9-multithreaded'
  return 'unknown'
}

interface Chunk {
  srcOff: number
  compSize: number
  origSize: number
}

function readChunks(bytes: Uint8Array, dv: DataView, start: number, maxChunks: number): { chunks: Chunk[]; end: number } {
  const chunks: Chunk[] = []
  let p = start
  while (p + 8 <= bytes.length && chunks.length < maxChunks) {
    const origSize = dv.getUint32(p, true)
    const compSize = dv.getUint32(p + 4, true)
    if (p + 8 + compSize > bytes.length) throw new Xpress9Error('truncated chunk')
    chunks.push({ srcOff: p + 8, compSize, origSize })
    p += 8 + compSize
  }
  return { chunks, end: p }
}

function u64(dv: DataView, off: number): number {
  const lo = dv.getUint32(off, true)
  const hi = dv.getUint32(off + 4, true)
  return hi * 4294967296 + lo
}

export interface DecompressProgress {
  (fraction: number): void
}

/** Decompress (if needed) a DataModel stream to raw ABF bytes. */
export function decompressDataModel(bytes: Uint8Array, onProgress?: DecompressProgress): Uint8Array {
  const kind = detectCompression(bytes)
  if (kind === 'uncompressed') return bytes
  if (kind === 'unknown') throw new Error('Unknown or unsupported DataModel compression format')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // Collect the sessions (groups of chunks) in output order.
  const sessions: Chunk[][] = []
  if (kind === 'xpress9') {
    sessions.push(readChunks(bytes, dv, 102, Number.MAX_SAFE_INTEGER).chunks)
  } else {
    const mainChunksPerThread = u64(dv, 102)
    const prefixChunksPerThread = u64(dv, 110)
    const prefixThreadCount = u64(dv, 118)
    const mainThreadCount = u64(dv, 126)
    let p = 102 + 40
    for (const [threads, per] of [
      [prefixThreadCount, prefixChunksPerThread],
      [mainThreadCount, mainChunksPerThread]
    ] as const) {
      if (threads <= 0 || per <= 0) continue
      for (let t = 0; t < threads; t++) {
        const r = readChunks(bytes, dv, p, per)
        if (r.chunks.length !== per) throw new Xpress9Error('truncated multi-threaded stream')
        sessions.push(r.chunks)
        p = r.end
      }
    }
  }

  let total = 0
  for (const s of sessions) for (const c of s) total += c.origSize
  const out = new Uint8Array(total)
  let pos = 0
  let lastReport = 0
  for (const s of sessions) {
    const session = new Xpress9Session(out, pos)
    for (const c of s) {
      const n = session.decodeChunk(bytes, c.srcOff, c.srcOff + c.compSize, pos)
      if (n !== c.origSize) throw new Xpress9Error(`chunk decoded to ${n} bytes, expected ${c.origSize}`)
      pos += n
      if (onProgress && pos - lastReport > 8 * 1024 * 1024) {
        lastReport = pos
        onProgress(pos / total)
      }
    }
  }
  return out
}
