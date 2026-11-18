/**
 * XPress8 ("Xpress" plain LZ77, CODING_DIRECT2) decoder — a TypeScript port of the decoding loop
 * of Microsoft's Xpress library (`xdecode.c` / `xdecode.i`) and the chunk framing of
 * `xpress8.pyx`, as published in https://github.com/Hugoberry/xpress8-python (the decoder sources are
 * vendored there from https://github.com/microsoft/Extensible-Storage-Engine).
 *   Original code: Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *   Wrapper/packaging: Copyright (c) 2026 Igor Cotruta. MIT License.
 * Full license texts: ./THIRD_PARTY.md.
 *
 * Used by older Power BI Desktop files (and SSAS backups) whose ABF header sets
 * `ApplyCompression`: every logical file is stored as a sequence of chunks
 * `[u16 uncompressedSize][u16 compressedSize][payload]`; equal sizes mean a stored chunk.
 *
 * Chunk payload: 32-bit little-endian flag words consumed most-significant bit first
 * (0 = literal byte, 1 = match). A match is a u16: low 3 bits = length - 3 (7 = extended),
 * high 13 bits = offset - 1. Extended lengths use a shared nibble (low nibble of a fresh byte,
 * then the high nibble of the same byte for the next extended match), then a byte (15 = more),
 * then a u16 holding the full length - 3.
 */

const MIN_MATCH = 3
const DIRECT2_LEN_LOG = 3
const DIRECT2_MAX_LEN = (1 << DIRECT2_LEN_LOG) - 1

function decodeChunk(src: Uint8Array, start: number, end: number, out: Uint8Array, outStart: number, outEnd: number): void {
  let s = start
  let d = outStart
  let flags = 0
  let flagBits = 0
  let nibblePtr = -1
  while (d < outEnd) {
    if (flagBits === 0) {
      if (s + 4 > end) throw new Error('XPress8: truncated flags')
      flags = (src[s] | (src[s + 1] << 8) | (src[s + 2] << 16) | (src[s + 3] << 24)) >>> 0
      s += 4
      flagBits = 32
    }
    const isMatch = flags & 0x80000000
    flags = (flags << 1) >>> 0
    flagBits--
    if (!isMatch) {
      if (s >= end) throw new Error('XPress8: truncated literal')
      out[d++] = src[s++]
      continue
    }
    if (s + 2 > end) throw new Error('XPress8: truncated match')
    const v = src[s] | (src[s + 1] << 8)
    s += 2
    const offset = (v >>> DIRECT2_LEN_LOG) + 1
    let len = v & DIRECT2_MAX_LEN
    if (len === DIRECT2_MAX_LEN) {
      if (nibblePtr < 0) {
        if (s >= end) throw new Error('XPress8: truncated length')
        nibblePtr = s
        len = src[s++] & 15
      } else {
        len = src[nibblePtr] >> 4
        nibblePtr = -1
      }
      if (len === 15) {
        if (s >= end) throw new Error('XPress8: truncated length')
        len = src[s++]
        if (len === 255) {
          if (s + 2 > end) throw new Error('XPress8: truncated length')
          len = src[s] | (src[s + 1] << 8)
          s += 2
          if (len < 255 + 15 + DIRECT2_MAX_LEN) throw new Error('XPress8: invalid length')
          len += MIN_MATCH
        } else {
          len += 15 + DIRECT2_MAX_LEN + MIN_MATCH
        }
      } else {
        len += DIRECT2_MAX_LEN + MIN_MATCH
      }
    } else {
      len += MIN_MATCH
    }
    let from = d - offset
    if (from < outStart) throw new Error('XPress8: match before start of chunk')
    const last = Math.min(d + len, outEnd)
    while (d < last) out[d++] = out[from++]
  }
}

/** Decode an XPress8 chunked stream (per-file compression inside an ABF with ApplyCompression). */
export function decompressXpress8Chunked(data: Uint8Array, expectedSize?: number): Uint8Array {
  // first pass: total size
  let total = 0
  for (let p = 0; p + 4 <= data.length; ) {
    const u = data[p] | (data[p + 1] << 8)
    const c = data[p + 2] | (data[p + 3] << 8)
    p += 4
    if (p + c > data.length) break
    total += u
    p += c
  }
  const out = new Uint8Array(total)
  let o = 0
  for (let p = 0; p + 4 <= data.length; ) {
    const u = data[p] | (data[p + 1] << 8)
    const c = data[p + 2] | (data[p + 3] << 8)
    p += 4
    if (p + c > data.length) break
    if (u === c) out.set(data.subarray(p, p + c), o)
    else decodeChunk(data, p, p + c, out, o, o + u)
    o += u
    p += c
  }
  if (expectedSize !== undefined && expectedSize !== total) {
    throw new Error(`XPress8: decompressed ${total} bytes, expected ${expectedSize}`)
  }
  return out
}
