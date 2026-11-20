/**
 * XPress9 encoder — Lumen's own encoder, written against the stream format as decoded by the TypeScript
 * port of Microsoft's MIT-licensed Xpress9 decoder in `../datamodel/xpress9.ts` (see
 * `../datamodel/THIRD_PARTY.md`). No encoder source was ported: every choice below is derived from
 * what that decoder reads and checks, and from the block headers of real Power BI Desktop files.
 *
 * Stream = one *session* of *blocks*. Block layout:
 *   32-byte header, eight little-endian u32:
 *     [0]  magic 0x4E86D72A
 *     [4]  original (decoded) size in bytes
 *     [8]  encoded size in bits, header included (256 + payload bits)
 *     [12] flags: bits 0..12 = bits used by the MTF state + Huffman tables; bits 13..15 = window log2 - 16;
 *          bits 16..17 = MTF entry count / 2; bit 18 = minimum plain-pointer length - 3;
 *          bit 19 = minimum MTF-pointer length - 2; bits 20..31 = 0
 *     [16] reserved (0)
 *     [20] session signature (same for every block of a session)
 *     [24] block index within the session (0, 1, 2, …)
 *     [28] CRC-32C (Castagnoli, init/xorout 0xFFFFFFFF) of header bytes [0, 28). The decoder port does not
 *          check it; it was identified on the block headers of real files (every block of every sample
 *          and of a recent Desktop file matches) and is written so a checking decoder accepts the block.
 *   then an LSB-first bitstream: MTF state (1 bit "last token was a pointer", then per entry 5 bits msb +
 *   msb bits), the short-symbol and long-length Huffman code-length tables, then the LZ77 symbols.
 *
 * Parameters mirror what recent Power BI Desktop files carry (flags high bits 0x6C000): window 2^22,
 * 4 MTF entries, plain pointers of at least 4 bytes, MTF pointers of at least 2 bytes. Lumen keeps every
 * back-reference within 2^21 bytes (half the declared window), a conservative choice that any decoder
 * holding the declared window can satisfy.
 *
 * Huffman codes are canonical (lengths ascending, symbols ascending within a length; equivalent to the
 * decoder's descending fill for complete codes) and limited to the decoder's root-table widths (12 bits
 * for both LZ77 alphabets, 8 bits for the code-length alphabet), so every code resolves in a root table.
 * Output is deterministic: the same input always gives the same bytes.
 */

const XPRESS9_MAGIC = 0x4e86d72a

const HUFFMAN_MAX_CODEWORD_LENGTH = 27
const ENC_FILL = HUFFMAN_MAX_CODEWORD_LENGTH + 1
const ENC_ZERO_REPT = HUFFMAN_MAX_CODEWORD_LENGTH + 2
const ENC_PREV = HUFFMAN_MAX_CODEWORD_LENGTH + 3
const ENC_TABLE_SIZE = HUFFMAN_MAX_CODEWORD_LENGTH + 6
const ENC_ZERO_REPT_MIN_COUNT = 5

const LZ77_MAX_MTF = 4
const LZ77_MAX_SHORT_LENGTH_LOG = 4
const LZ77_MAX_SHORT_LENGTH = 1 << LZ77_MAX_SHORT_LENGTH_LOG
const LZ77_MAX_WINDOW_SIZE_LOG = 24
const LZ77_LONG_LENGTH_ALPHABET_SIZE = 1 << 8
const LZ77_MAX_LONG_LENGTH = LZ77_LONG_LENGTH_ALPHABET_SIZE - LZ77_MAX_WINDOW_SIZE_LOG
const SHORT_ALPHABET = 256 + ((LZ77_MAX_WINDOW_SIZE_LOG + LZ77_MAX_MTF) << LZ77_MAX_SHORT_LENGTH_LOG)

/** Session parameters (as in recent Power BI Desktop files). */
const WINDOW_LOG2 = 22
const MTF_COUNT = 4
const PTR_MIN = 4
const MTF_MIN = 2
const FLAGS_HIGH = ((WINDOW_LOG2 - 16) << 13) | ((MTF_COUNT >> 1) << 16) | ((PTR_MIN - 3) << 18) | ((MTF_MIN - 2) << 19)
const MAX_TABLE_BITS = 0x1fff

/** Code-length limits = the decoder's root-table widths (no sub-tables needed). */
const SHORT_LIMIT = 12
const LONG_LIMIT = 12
const SMALL_LIMIT = 8

export interface Xpress9EncodeOptions {
  /** Uncompressed bytes per block (default 2 MiB, as Power BI Desktop writes). */
  blockSize?: number
  /** Session signature; default derived deterministically from the input. */
  sessionSignature?: number
  /** Largest back-reference distance (default 2^21; at most 2^22 - 1). */
  maxOffset?: number
  /** Hash-chain candidates examined per position (default 16). */
  chainDepth?: number
  /** Always send the fixed ("stored") code-length tables (used automatically when the Huffman tables would not fit; tests). */
  storedTables?: boolean
}

// ---------------------------------------------------------------- CRC-32C

const CRC32C = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

/** CRC-32C (Castagnoli) with init/xorout 0xFFFFFFFF. */
export function crc32c(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = CRC32C[(c ^ bytes[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ---------------------------------------------------------------- bit writer

class BitWriter {
  buf: Uint8Array
  pos = 0
  acc = 0
  n = 0
  constructor(capacity: number) {
    this.buf = new Uint8Array(Math.max(64, capacity))
  }
  private grow(): void {
    const b = new Uint8Array(this.buf.length * 2)
    b.set(this.buf.subarray(0, this.pos))
    this.buf = b
  }
  /** Write `nb` (0..24) bits of `v`, least-significant first. */
  write(v: number, nb: number): void {
    if (nb === 0) return
    this.acc = (this.acc | (v << this.n)) >>> 0
    this.n += nb
    while (this.n >= 8) {
      if (this.pos >= this.buf.length) this.grow()
      this.buf[this.pos++] = this.acc & 255
      this.acc >>>= 8
      this.n -= 8
    }
  }
  bits(): number {
    return this.pos * 8 + this.n
  }
  finish(): Uint8Array {
    if (this.n > 0) {
      if (this.pos >= this.buf.length) this.grow()
      this.buf[this.pos++] = this.acc & 255
      this.acc = 0
      this.n = 0
    }
    return this.buf.subarray(0, this.pos)
  }
}

// ---------------------------------------------------------------- Huffman

/** Huffman code lengths for `freq`, at most `limit` bits; at least two symbols get a code. */
export function huffmanLengths(freqIn: ArrayLike<number>, limit: number): Uint8Array {
  const n = freqIn.length
  const freq = Float64Array.from(freqIn as ArrayLike<number>)
  let used = 0
  for (let i = 0; i < n; i++) if (freq[i] > 0) used++
  // a complete code needs two leaves: give unused low symbols a token frequency
  for (let i = 0; used < 2 && i < n; i++)
    if (freq[i] === 0) {
      freq[i] = 1
      used++
    }
  for (;;) {
    const lengths = buildLengths(freq)
    let max = 0
    for (let i = 0; i < n; i++) if (lengths[i] > max) max = lengths[i]
    if (max <= limit) return lengths
    // flatten the distribution and retry (keeps every used symbol)
    for (let i = 0; i < n; i++) if (freq[i] > 0) freq[i] = Math.floor(freq[i] / 2) + 1
  }
}

function buildLengths(freq: Float64Array): Uint8Array {
  const n = freq.length
  const leaves: number[] = []
  for (let i = 0; i < n; i++) if (freq[i] > 0) leaves.push(i)
  leaves.sort((a, b) => freq[a] - freq[b] || a - b)
  const m = leaves.length
  const lengths = new Uint8Array(n)
  // two-queue Huffman: nodes 0..m-1 are leaves (sorted), m.. internal
  const weight = new Float64Array(2 * m)
  const parent = new Int32Array(2 * m).fill(-1)
  for (let i = 0; i < m; i++) weight[i] = freq[leaves[i]]
  let li = 0
  let ii = m
  let next = m
  const take = (): number => {
    if (li < m && (ii >= next || weight[li] <= weight[ii])) return li++
    return ii++
  }
  while (next < 2 * m - 1) {
    const a = take()
    const b = take()
    weight[next] = weight[a] + weight[b]
    parent[a] = next
    parent[b] = next
    next++
  }
  const depth = new Int32Array(2 * m)
  for (let i = 2 * m - 3; i >= 0; i--) depth[i] = depth[parent[i]] + 1
  for (let i = 0; i < m; i++) lengths[leaves[i]] = depth[i]
  return lengths
}

/** Canonical codes, returned bit-reversed so they can be written LSB-first (decoder reads MSB of the code first). */
function canonicalCodes(lengths: Uint8Array): Uint32Array {
  const count = new Uint32Array(32)
  for (let i = 0; i < lengths.length; i++) count[lengths[i]]++
  count[0] = 0
  const next = new Uint32Array(32)
  let code = 0
  for (let len = 1; len < 32; len++) {
    code = (code + count[len - 1]) << 1
    next[len] = code
  }
  const out = new Uint32Array(lengths.length)
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i]
    if (!len) continue
    let c = next[len]++
    let r = 0
    for (let k = 0; k < len; k++) {
      r = (r << 1) | (c & 1)
      c >>>= 1
    }
    out[i] = r
  }
  return out
}

// ---------------------------------------------------------------- code-length tables

/**
 * Encode a code-length table the way `decodeLengthTable` (encoding 1) reads it: a 33-symbol Huffman
 * code over {0..27, FILL, ZERO_REPT, PREV, ROW_0, ROW_1} whose own lengths are sent with a 1-bit
 * "same as previous" flag or 3 bits, then the symbols. Rows of `fillBoundary` (16) entries.
 */
function writeLengthTable(bw: BitWriter, lengths: Uint8Array, fillBoundary: number): void {
  const size = lengths.length
  const syms: number[] = []
  const extra: number[] = [] // packed (value << 5) | bits
  let prev = 8
  for (let i = 0; i < size; ) {
    const rowEnd = Math.min(size, (i | (fillBoundary - 1)) + 1)
    let allZero = true
    for (let j = i; j < rowEnd; j++)
      if (lengths[j] !== 0) {
        allZero = false
        break
      }
    if (allZero) {
      syms.push(ENC_FILL)
      extra.push(0)
      i = rowEnd
      continue
    }
    const v = lengths[i]
    if (v === 0) {
      let r = 0
      while (i + r < rowEnd && lengths[i + r] === 0) r++
      // the run cannot reach rowEnd here (the row has a non-zero entry after it)
      if (r >= ENC_ZERO_REPT_MIN_COUNT) {
        syms.push(ENC_ZERO_REPT)
        const k = r - ENC_ZERO_REPT_MIN_COUNT
        if (k < 3) extra.push((k << 5) | 2)
        else {
          // 2 bits = 3, then 3-bit groups (7 = more)
          const packed: number[] = [3 | (2 << 8)]
          let rem = r - (ENC_ZERO_REPT_MIN_COUNT + 3)
          while (rem >= 7) {
            packed.push(7 | (3 << 8))
            rem -= 7
          }
          packed.push(rem | (3 << 8))
          extra.push(-packed.length)
          for (const p of packed) extra.push(p)
        }
        i += r
        continue
      }
      syms.push(0)
      extra.push(0)
      i++
      continue
    }
    if (v === prev) syms.push(ENC_PREV)
    else {
      syms.push(v)
      prev = v
    }
    extra.push(0)
    i++
  }
  const freq = new Uint32Array(ENC_TABLE_SIZE)
  for (const s of syms) freq[s]++
  const small = huffmanLengths(freq, SMALL_LIMIT)
  const codes = canonicalCodes(small)
  // small table lengths
  let p = 4
  for (let i = 0; i < ENC_TABLE_SIZE; i++) {
    const v = small[i]
    if (v === p) bw.write(0, 1)
    else {
      bw.write(1, 1)
      bw.write(v < p ? v : v - 1, 3)
      p = v
    }
  }
  let e = 0
  for (const s of syms) {
    bw.write(codes[s], small[s])
    const x = extra[e++]
    if (x < 0) {
      for (let k = 0; k < -x; k++) {
        const pk = extra[e++]
        bw.write(pk & 255, pk >>> 8)
      }
    } else if (x !== 0) bw.write(x >>> 5, x & 31)
  }
}

/** Stored code-length table (encoding 0): what the decoder derives for an alphabet of `size`. */
function storedLengths(size: number): Uint8Array {
  const msb = 31 - Math.clz32(size)
  const k = 2 ** (msb + 1) - size
  const out = new Uint8Array(size)
  for (let i = 0; i < size; i++) out[i] = i < k ? msb : msb + 1
  return out
}

// ---------------------------------------------------------------- LZ77 session encoder

const HASH_BITS = 16
const NICE_LENGTH = 1024

function msb(x: number): number {
  return 31 - Math.clz32(x)
}

/**
 * Encode `input` as one XPress9 session. Returns one encoded block per `blockSize` slice of the input
 * (the DataModel framing stores each block as one chunk).
 */
export function compressXpress9Blocks(input: Uint8Array, opts: Xpress9EncodeOptions = {}): Array<{ origSize: number; bytes: Uint8Array }> {
  const blockSize = opts.blockSize ?? 2 * 1024 * 1024
  if (blockSize < 1 || blockSize > 0x7fffffff) throw new Error('XPress9: invalid block size')
  const maxOffset = Math.min(opts.maxOffset ?? 1 << 21, (1 << WINDOW_LOG2) - 1)
  const chainDepth = Math.max(1, opts.chainDepth ?? 16)
  const sessionSig = (opts.sessionSignature ?? defaultSignature(input)) >>> 0

  const head = new Int32Array(1 << HASH_BITS).fill(-1)
  const winMask = (1 << (msb(maxOffset) + 1)) - 1
  const prevPos = new Int32Array(winMask + 1)
  const n = input.length
  const hashAt = (p: number): number => Math.imul(input[p] | (input[p + 1] << 8) | (input[p + 2] << 16) | (input[p + 3] << 24), 0x9e3779b1) >>> (32 - HASH_BITS)
  const insert = (p: number): void => {
    if (p + 4 > n) return
    const h = hashAt(p)
    prevPos[p & winMask] = head[h]
    head[h] = p
  }

  // MTF state (mirrors the decoder)
  let lastPtr = 0
  let m0 = 1
  let m1 = 1
  let m2 = 1
  let m3 = 1

  const blocks: Array<{ origSize: number; bytes: Uint8Array }> = []
  // token buffers, reused per block
  const cap = Math.min(blockSize, Math.max(n, 1))
  const tShort = new Uint16Array(cap)
  const tLong = new Int16Array(cap)
  const tLongExtra = new Uint32Array(cap) // (value << 5) | bits
  const tOffExtra = new Float64Array(cap) // value * 32 + bits

  const matchLen = (a: number, b: number, max: number): number => {
    let l = 0
    while (l < max && input[a + l] === input[b + l]) l++
    return l
  }

  let blockIndex = 0
  for (let bs = 0; bs < n; bs += blockSize) {
    const be = Math.min(n, bs + blockSize)
    const startState = { lastPtr, m0, m1, m2, m3 }
    let nt = 0
    let p = bs
    while (p < be) {
      const avail = be - p
      // ---- MTF candidates
      let mtfSym = -1
      let mtfLen = 0
      if (avail >= MTF_MIN) {
        const cand = lastPtr ? [m1, m2, m3] : [m0, m1, m2, m3]
        for (let s = 0; s < cand.length; s++) {
          const off = cand[s]
          if (off > p || off > maxOffset) continue
          if (input[p] !== input[p - off] || input[p + 1] !== input[p - off + 1]) continue
          const l = matchLen(p, p - off, Math.min(avail, NICE_LENGTH * 4))
          if (l > mtfLen) {
            mtfLen = l
            mtfSym = s
          }
        }
      }
      // ---- hash chain
      let bestLen = 0
      let bestOff = 0
      if (avail >= PTR_MIN && p + 4 <= n) {
        const h = hashAt(p)
        let c = head[h]
        let depth = chainDepth
        const lim = Math.min(avail, NICE_LENGTH * 4)
        while (c >= 0 && depth-- > 0) {
          const off = p - c
          if (off > maxOffset || off <= 0) break
          if (input[c + bestLen] === input[p + bestLen] && input[c] === input[p]) {
            const l = matchLen(c, p, lim)
            if (l > bestLen) {
              bestLen = l
              bestOff = off
              if (l >= NICE_LENGTH) break
            }
          }
          const nc = prevPos[c & winMask]
          if (nc >= c) break
          c = nc
        }
      }
      // ---- choose (rough bit-cost model)
      const plainScore = bestLen >= PTR_MIN ? bestLen * 9 - (14 + msb(bestOff)) : 0
      const mtfScore = mtfLen >= MTF_MIN ? mtfLen * 9 - 10 : 0
      if (plainScore <= 0 && mtfScore <= 0) {
        tShort[nt] = input[p]
        tLong[nt] = -1
        nt++
        insert(p)
        p++
        lastPtr = 0
        continue
      }
      let len: number
      let slot: number
      let lcode: number
      if (mtfScore >= plainScore) {
        len = mtfLen
        slot = mtfSym
        lcode = len - MTF_MIN
        tOffExtra[nt] = 0
        // MTF update, exactly as the decoder
        let off: number
        if (lastPtr) {
          if (mtfSym === 0) off = m1
          else if (mtfSym === 1) {
            off = m2
            m2 = m1
          } else {
            off = m3
            m3 = m2
            m2 = m1
          }
          m1 = m0
          m0 = off
        } else if (mtfSym === 0) {
          // offset = m0, no change
        } else if (mtfSym === 1) {
          off = m1
          m1 = m0
          m0 = off
        } else if (mtfSym === 2) {
          off = m2
          m2 = m1
          m1 = m0
          m0 = off
        } else {
          off = m3
          m3 = m2
          m2 = m1
          m1 = m0
          m0 = off
        }
      } else {
        len = bestLen
        const nb = msb(bestOff)
        slot = MTF_COUNT + nb
        lcode = len - PTR_MIN
        tOffExtra[nt] = (bestOff - 2 ** nb) * 32 + nb
        m3 = m2
        m2 = m1
        m1 = m0
        m0 = bestOff
      }
      lastPtr = 1
      if (lcode < LZ77_MAX_SHORT_LENGTH - 1) {
        tShort[nt] = 256 + (slot << LZ77_MAX_SHORT_LENGTH_LOG) + lcode
        tLong[nt] = -1
      } else {
        tShort[nt] = 256 + (slot << LZ77_MAX_SHORT_LENGTH_LOG) + (LZ77_MAX_SHORT_LENGTH - 1)
        const L = lcode - (LZ77_MAX_SHORT_LENGTH - 1)
        if (L < LZ77_MAX_LONG_LENGTH) {
          tLong[nt] = L
          tLongExtra[nt] = 0
        } else {
          const x = L - (LZ77_MAX_LONG_LENGTH - 1)
          const nb = msb(x)
          tLong[nt] = LZ77_MAX_LONG_LENGTH + nb
          tLongExtra[nt] = ((x - 2 ** nb) << 5) | nb
        }
      }
      nt++
      // index the matched positions (bounded for very long runs)
      const stopIdx = p + Math.min(len, 64)
      for (let q = p; q < stopIdx; q++) insert(q)
      if (len > 64) for (let q = p + len - 3; q < p + len; q++) insert(q)
      p += len
    }
    blocks.push({ origSize: be - bs, bytes: encodeBlock(be - bs, nt, tShort, tLong, tLongExtra, tOffExtra, startState, sessionSig, blockIndex++, opts.storedTables === true) })
  }
  return blocks
}

function defaultSignature(input: Uint8Array): number {
  const s = (crc32c(input, 0, Math.min(input.length, 1 << 16)) ^ input.length) >>> 0
  return s === 0 ? 1 : s
}

function encodeBlock(
  origSize: number,
  nt: number,
  tShort: Uint16Array,
  tLong: Int16Array,
  tLongExtra: Uint32Array,
  tOffExtra: Float64Array,
  st: { lastPtr: number; m0: number; m1: number; m2: number; m3: number },
  sessionSig: number,
  blockIndex: number,
  forceStored: boolean
): Uint8Array {
  const sf = new Uint32Array(SHORT_ALPHABET)
  const lf = new Uint32Array(LZ77_LONG_LENGTH_ALPHABET_SIZE)
  for (let i = 0; i < nt; i++) {
    sf[tShort[i]]++
    if (tLong[i] >= 0) lf[tLong[i]]++
  }
  let shortLen = huffmanLengths(sf, SHORT_LIMIT)
  let longLen = huffmanLengths(lf, LONG_LIMIT)

  const writeHeaderTables = (bw: BitWriter, stored: boolean): void => {
    bw.write(st.lastPtr, 1)
    for (const off of [st.m0, st.m1, st.m2, st.m3]) {
      const nb = msb(off)
      bw.write(nb, 5)
      writeLong(bw, off - 2 ** nb, nb)
    }
    if (stored) {
      bw.write(0, 3)
      bw.write(0, 3)
    } else {
      bw.write(1, 3)
      writeLengthTable(bw, shortLen, LZ77_MAX_SHORT_LENGTH)
      bw.write(1, 3)
      writeLengthTable(bw, longLen, LZ77_MAX_SHORT_LENGTH)
    }
  }
  const bw = new BitWriter(Math.ceil(origSize * 1.1) + 4096)
  // 32-byte header placeholder
  for (let i = 0; i < 32; i++) bw.write(0, 8)
  writeHeaderTables(bw, false)
  let tableBits = bw.bits() - 256
  if (tableBits > MAX_TABLE_BITS || forceStored) {
    // fall back to the fixed ("stored") code lengths, which always fit
    shortLen = storedLengths(SHORT_ALPHABET)
    longLen = storedLengths(LZ77_LONG_LENGTH_ALPHABET_SIZE)
    bw.pos = 32
    bw.acc = 0
    bw.n = 0
    writeHeaderTables(bw, true)
    tableBits = bw.bits() - 256
  }
  const sc = canonicalCodes(shortLen)
  const lc = canonicalCodes(longLen)
  for (let i = 0; i < nt; i++) {
    const s = tShort[i]
    bw.write(sc[s], shortLen[s])
    if (s < 256) continue
    const l = tLong[i]
    if (l >= 0) {
      bw.write(lc[l], longLen[l])
      const x = tLongExtra[i]
      if (x) writeLong(bw, x >>> 5, x & 31)
    }
    const o = tOffExtra[i]
    if (o) {
      const nb = o % 32
      writeLong(bw, (o - nb) / 32, nb)
    }
  }
  const encodedBits = bw.bits()
  const out = bw.finish()
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength)
  dv.setUint32(0, XPRESS9_MAGIC, true)
  dv.setUint32(4, origSize, true)
  dv.setUint32(8, encodedBits, true)
  dv.setUint32(12, (FLAGS_HIGH | tableBits) >>> 0, true)
  dv.setUint32(16, 0, true)
  dv.setUint32(20, sessionSig, true)
  dv.setUint32(24, blockIndex, true)
  dv.setUint32(28, crc32c(out, 0, 28), true)
  return out.slice()
}

function writeLong(bw: BitWriter, v: number, nb: number): void {
  if (nb <= 24) bw.write(v, nb)
  else {
    bw.write(v & 0xffff, 16)
    bw.write(Math.floor(v / 65536), nb - 16)
  }
}

/** Concatenated blocks of one session (convenience for tests). */
export function compressXpress9(input: Uint8Array, opts: Xpress9EncodeOptions = {}): Uint8Array {
  const blocks = compressXpress9Blocks(input, opts)
  let total = 0
  for (const b of blocks) total += b.bytes.length
  const out = new Uint8Array(total)
  let p = 0
  for (const b of blocks) {
    out.set(b.bytes, p)
    p += b.bytes.length
  }
  return out
}
