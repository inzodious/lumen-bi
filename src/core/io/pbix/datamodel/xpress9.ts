/**
 * XPress9 decoder — a TypeScript port of the decoding half of Microsoft's Xpress9 library
 * (`Xpress9DecHuffman.c`, `Xpress9DecLz77.c`, `Xpress9Lz77Dec.i`, `Xpress9Misc.c`), as published in
 * https://github.com/Hugoberry/xpress9-python.
 *   Original code: Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *   Wrapper/packaging: Copyright (c) 2025 Igor Cotruta. MIT License.
 * Full license texts: ./THIRD_PARTY.md.
 *
 * Xpress9 is LZ77 + canonical Huffman with optional move-to-front (MTF) offset caching.
 * A compressed stream is a *session* made of *blocks*; every block starts with a 32-byte
 * header (magic, original size, encoded size in bits, flags, session/block signatures, CRC),
 * followed by the Huffman tables and the LZ77 symbol stream. The LZ77 history window spans
 * block boundaries within a session, so a session must be decoded sequentially.
 *
 * Unlike the C library (which streams through a sliding window buffer), this port decodes a
 * whole session into one contiguous output buffer, so back-references simply index earlier
 * output and no window shifting / tail bookkeeping is needed.
 *
 * Bitstream: little-endian, least-significant-bit first (the C reader consumes 32-bit LE
 * words from a 64-bit shift register, which is bit-for-bit identical to an LSB-first byte reader).
 */

const XPRESS9_MAGIC = 0x4e86d72a

const HUFFMAN_MAX_CODEWORD_LENGTH = 27
const HUFFMAN_CODEWORD_LENGTH_LIMIT = 64
const ENC_FILL = HUFFMAN_MAX_CODEWORD_LENGTH + 1
const ENC_ZERO_REPT = HUFFMAN_MAX_CODEWORD_LENGTH + 2
const ENC_PREV = HUFFMAN_MAX_CODEWORD_LENGTH + 3
const ENC_ROW_0 = HUFFMAN_MAX_CODEWORD_LENGTH + 4
const ENC_ROW_1 = HUFFMAN_MAX_CODEWORD_LENGTH + 5
const ENC_TABLE_SIZE = HUFFMAN_MAX_CODEWORD_LENGTH + 6
const ENC_ZERO_REPT_MIN_COUNT = 5

const LZ77_MAX_MTF = 4
const LZ77_MAX_SHORT_LENGTH_LOG = 4
const LZ77_MAX_SHORT_LENGTH = 1 << LZ77_MAX_SHORT_LENGTH_LOG
const LZ77_MAX_WINDOW_SIZE_LOG = 24
const LZ77_LONG_LENGTH_ALPHABET_SIZE = 1 << 8
const LZ77_MAX_LONG_LENGTH = LZ77_LONG_LENGTH_ALPHABET_SIZE - LZ77_MAX_WINDOW_SIZE_LOG
const LZ77_SHORT_SYMBOL_ALPHABET_SIZE = 256 + ((LZ77_MAX_WINDOW_SIZE_LOG + LZ77_MAX_MTF) << LZ77_MAX_SHORT_LENGTH_LOG)

const SHORT_ROOT_BITS = 12
const SHORT_TAIL_BITS = 6
const LONG_ROOT_BITS = 12
const LONG_TAIL_BITS = 6
const SHORT_TABLE_SIZE = (1 << SHORT_ROOT_BITS) + (1 << SHORT_TAIL_BITS) * 64
const LONG_TABLE_SIZE = (1 << LONG_ROOT_BITS) + (1 << LONG_TAIL_BITS) * 64

export class Xpress9Error extends Error {
  constructor(message: string) {
    super(`XPress9: ${message}`)
    this.name = 'Xpress9Error'
  }
}

/** LSB-first bit reader. Keeps 25..32 valid bits in `bb` after `refill()`. Reads past `end` yield zeros. */
class BitReader {
  bb = 0
  bc = 0
  pos: number
  constructor(
    readonly src: Uint8Array,
    readonly start: number,
    readonly end: number
  ) {
    this.pos = start
    this.refill()
  }
  refill(): void {
    const src = this.src
    const end = this.end
    while (this.bc <= 24) {
      this.bb |= (this.pos < end ? src[this.pos] : 0) << this.bc
      this.pos++
      this.bc += 8
    }
  }
  /** Read n (0..24) bits. */
  read(n: number): number {
    if (n === 0) return 0
    if (this.bc < n) this.refill()
    const v = this.bb & ((1 << n) - 1)
    this.bb >>>= n
    this.bc -= n
    return v
  }
  /** Read up to 31 bits (split into two reads when needed). */
  readLong(n: number): number {
    if (n <= 24) return this.read(n)
    const lo = this.read(16)
    return lo + this.read(n - 16) * 65536
  }
  consumedBits(): number {
    return (this.pos - this.start) * 8 - this.bc
  }
}

function reverseBits(v: number, bits: number): number {
  let r = 0
  for (let i = 0; i < bits; i++) {
    r = (r << 1) | (v & 1)
    v >>>= 1
  }
  return r
}

/**
 * Build Xpress9 multi-level decode tables (port of HuffmanCreateDecodeTables).
 * Returns the index of the root table inside `table`. Entries: `(symbol << 4) | bitsToSkip` for
 * leaves; negative `(subtableOffsetDelta & ~15) | bitsToSkip` for links to sub-tables.
 */
function createDecodeTables(lengths: Uint8Array, alphabetSize: number, table: Int16Array, rootBits: number, tailBits: number): number {
  // Sort symbols by descending codeword length, then by descending symbol (stable as in C).
  const count = new Uint32Array(HUFFMAN_CODEWORD_LENGTH_LIMIT)
  let numSymbols = 0
  for (let i = 0; i < alphabetSize; i++) {
    const n = lengths[i]
    if (n !== 0) {
      if (n >= HUFFMAN_CODEWORD_LENGTH_LIMIT) throw new Xpress9Error(`excessive bit length ${n}`)
      count[n]++
      numSymbols++
    }
  }
  if (numSymbols === 0) throw new Xpress9Error('empty Huffman table')
  const leafSym = new Uint16Array(numSymbols)
  const leafBits = new Uint8Array(numSymbols)
  {
    // position of first leaf of each length in the descending-length ordering
    const startOf = new Uint32Array(HUFFMAN_CODEWORD_LENGTH_LIMIT)
    let acc = 0
    for (let n = HUFFMAN_CODEWORD_LENGTH_LIMIT - 1; n >= 1; n--) {
      startOf[n] = acc
      acc += count[n]
    }
    for (let i = alphabetSize - 1; i >= 0; i--) {
      const n = lengths[i]
      if (n !== 0) {
        const p = startOf[n]++
        leafSym[p] = i
        leafBits[p] = n
      }
    }
  }

  if (numSymbols === 1) {
    const entry = (leafSym[0] << 4) + leafBits[0]
    const size = 1 << rootBits
    for (let i = 0; i < size; i++) table[i] = entry
    return 0
  }

  // Verify the code is a full binary tree.
  {
    let n = 0
    for (let i = HUFFMAN_CODEWORD_LENGTH_LIMIT - 1; i !== 0; i--) {
      n += count[i]
      if ((n & 1) !== 0) throw new Xpress9Error('corrupted Huffman table (odd node count)')
      n >>>= 1
    }
    if (n !== 1) throw new Xpress9Error('corrupted Huffman table (not a full tree)')
  }

  // Fill tables bottom-up (port of HuffmanDecodeFillTables).
  const nodeSym: number[] = []
  const nodeBits: number[] = []
  let nodeHead = 0
  let li = 0
  let tableOffset = 0
  let rootLevel: number
  do {
    let leafLevel = leafBits[li]
    if (nodeHead < nodeSym.length && leafLevel < nodeBits[nodeHead]) leafLevel = nodeBits[nodeHead]
    if (leafLevel <= rootBits) {
      rootLevel = 0
      leafLevel = rootBits
    } else {
      rootLevel = leafLevel - tailBits
    }
    const span = leafLevel - rootLevel
    let i = 1 << span
    if (tableOffset + i > table.length) throw new Xpress9Error('decode table overflow')
    do {
      let sym: number
      let bits: number
      if (nodeHead < nodeSym.length && nodeBits[nodeHead] > rootLevel) {
        bits = nodeBits[nodeHead]
        sym = (nodeSym[nodeHead] << tailBits) - tableOffset + (bits - rootLevel)
        nodeHead++
      } else {
        if (li >= numSymbols) throw new Xpress9Error('corrupted Huffman table (leaf underflow)')
        bits = leafBits[li]
        sym = (leafSym[li] << 4) + (bits - rootLevel)
        li++
      }
      const cnt = 1 << (leafLevel - bits)
      if (cnt > i) throw new Xpress9Error('corrupted Huffman table (span)')
      const j = i - cnt
      do {
        --i
        table[tableOffset + reverseBits(i, span)] = sym
      } while (i !== j)
    } while (i !== 0)
    nodeSym.push(tableOffset >> tailBits)
    nodeBits.push(rootLevel)
    tableOffset += 1 << span
  } while (rootLevel !== 0)
  return tableOffset - (1 << rootBits)
}

function decodeSymbol(br: BitReader, table: Int16Array, root: number, rootBits: number, tailBits: number): number {
  if (br.bc < 25) br.refill()
  let e = table[root + (br.bb & ((1 << rootBits) - 1))]
  if (e < 0) {
    let skip = e & 15
    br.bb >>>= skip
    br.bc -= skip
    let t = root + (e & ~15)
    const tailMask = (1 << tailBits) - 1
    for (;;) {
      if (br.bc < 16) br.refill()
      e = table[t + (br.bb & tailMask)]
      if (e >= 0) break
      skip = e & 15
      br.bb >>>= skip
      br.bc -= skip
      t += e & ~15
    }
  }
  const s = e & 15
  br.bb >>>= s
  br.bc -= s
  return e >> 4
}

/** Port of HuffmanDecodeLengthTable. */
function decodeLengthTable(br: BitReader, out: Uint8Array, alphabetSize: number, fillBoundary: number, maxCodewordLength: number): void {
  let k = br.read(3)
  if (k === 0) {
    // "stored": first N symbols use M = msb(|A|) bits, remaining |A| - N use M + 1 bits
    const msb = 31 - Math.clz32(alphabetSize)
    k = 2 ** (msb + 1) - alphabetSize
    let i = 0
    for (; i < k; i++) out[i] = msb
    for (; i < alphabetSize; i++) out[i] = msb + 1
    return
  }
  if (k !== 1) throw new Xpress9Error(`unknown Huffman table encoding ${k}`)

  const small = new Uint8Array(ENC_TABLE_SIZE)
  let prev = 4
  for (let i = 0; i < ENC_TABLE_SIZE; i++) {
    if (br.read(1) === 0) {
      small[i] = prev
    } else {
      k = br.read(3)
      if (k >= prev) {
        k += 1
        if (k > 8) throw new Xpress9Error('corrupted small length table')
      }
      small[i] = k
      prev = k
    }
  }
  const smallTable = new Int16Array((1 << 8) + (2 << 4))
  const root = createDecodeTables(small, ENC_TABLE_SIZE, smallTable, 8, 4)

  prev = 8
  for (let i = 0; i < alphabetSize; ) {
    let sym = decodeSymbol(br, smallTable, root, 8, 4)
    switch (sym) {
      case ENC_FILL:
        do {
          out[i++] = 0
        } while ((i & (fillBoundary - 1)) !== 0 && i < alphabetSize)
        break
      case ENC_ZERO_REPT: {
        k = br.read(2)
        sym = k + ENC_ZERO_REPT_MIN_COUNT
        if (k === 3) {
          do {
            k = br.read(3)
            sym += k
            if (i + sym > alphabetSize || (i ^ (i + sym)) >= fillBoundary) throw new Xpress9Error('corrupted zero run')
          } while (k === 7)
        }
        if (i + sym > alphabetSize || (i ^ (i + sym)) >= fillBoundary) throw new Xpress9Error('corrupted zero run')
        do {
          out[i++] = 0
          --sym
        } while (i < alphabetSize && sym !== 0)
        break
      }
      case ENC_PREV:
        out[i++] = prev
        break
      case ENC_ROW_0:
        if (i < fillBoundary) throw new Xpress9Error('corrupted ROW_0')
        out[i] = out[i - fillBoundary]
        if (out[i] === 0) throw new Xpress9Error('corrupted ROW_0 length')
        prev = out[i++]
        break
      case ENC_ROW_1:
        if (i < fillBoundary) throw new Xpress9Error('corrupted ROW_1')
        out[i] = out[i - fillBoundary] + 1
        if (out[i] > maxCodewordLength || out[i] === 0) throw new Xpress9Error('corrupted ROW_1 length')
        prev = out[i++]
        break
      default:
        if (sym > maxCodewordLength) throw new Xpress9Error('codeword length out of range')
        out[i++] = sym
        if (sym !== 0) prev = sym
    }
  }
}

interface SessionState {
  started: boolean
  sessionSignature: number
  blockIndex: number
  windowLog2: number
  mtfCount: number
  ptrMin: number
  mtfMin: number
  /** Output position where this session's history starts (back-references may not cross it). */
  historyStart: number
  shortTable: Int16Array
  longTable: Int16Array
  shortLengths: Uint8Array
  longLengths: Uint8Array
}

/** An Xpress9 decoder session writing into a caller-provided output buffer. */
export class Xpress9Session {
  private st: SessionState

  constructor(
    private readonly out: Uint8Array,
    historyStart: number
  ) {
    this.st = {
      started: false,
      sessionSignature: 0,
      blockIndex: 0,
      windowLog2: 0,
      mtfCount: 0,
      ptrMin: 0,
      mtfMin: 0,
      historyStart,
      shortTable: new Int16Array(SHORT_TABLE_SIZE),
      longTable: new Int16Array(LONG_TABLE_SIZE),
      shortLengths: new Uint8Array(LZ77_SHORT_SYMBOL_ALPHABET_SIZE),
      longLengths: new Uint8Array(LZ77_LONG_LENGTH_ALPHABET_SIZE)
    }
  }

  /**
   * Decode one compressed chunk (one or more complete blocks) located at `src[srcStart, srcEnd)`,
   * writing at `out[outPos]`. Returns the number of bytes produced.
   */
  decodeChunk(src: Uint8Array, srcStart: number, srcEnd: number, outPos: number): number {
    let produced = 0
    let blockStart = srcStart
    const dv = new DataView(src.buffer, src.byteOffset, src.byteLength)
    while (blockStart + 32 <= srcEnd) {
      if (dv.getUint32(blockStart, true) !== XPRESS9_MAGIC) {
        if (blockStart === srcStart) throw new Xpress9Error('bad block magic')
        break
      }
      const n = this.decodeBlock(src, dv, blockStart, srcEnd, outPos + produced)
      produced += n.produced
      blockStart += n.blockBytes
    }
    return produced
  }

  private decodeBlock(src: Uint8Array, dv: DataView, at: number, srcEnd: number, outPos: number): { produced: number; blockBytes: number } {
    const st = this.st
    const origSize = dv.getUint32(at + 4, true)
    const encodedBits = dv.getUint32(at + 8, true)
    const flags = dv.getUint32(at + 12, true)
    const reserved = dv.getUint32(at + 16, true)
    const sessionSig = dv.getUint32(at + 20, true)
    const blockIdx = dv.getUint32(at + 24, true)
    if (!st.started) {
      st.blockIndex = 0
      st.sessionSignature = sessionSig
    }
    if (blockIdx !== st.blockIndex) throw new Xpress9Error(`block index ${blockIdx}, expected ${st.blockIndex}`)
    if (sessionSig !== st.sessionSignature) throw new Xpress9Error('session signature mismatch')
    if (reserved !== 0) throw new Xpress9Error('reserved header field is non-zero')
    if (flags >>> 20 !== 0) throw new Xpress9Error('reserved flags are non-zero')
    const tableBits = flags & 0x1fff
    const windowLog2 = ((flags >>> 13) & 7) + 16
    const mtfCount = ((flags >>> 16) & 3) << 1
    const ptrMin = ((flags >>> 18) & 1) + 3
    const mtfMin = ((flags >>> 19) & 1) + 2
    if (!st.started) {
      if (mtfCount > 4) throw new Xpress9Error(`MTF entry count ${mtfCount}`)
      st.windowLog2 = windowLog2
      st.mtfCount = mtfCount
      st.ptrMin = ptrMin
      st.mtfMin = mtfMin
      st.started = true
    } else if (st.windowLog2 !== windowLog2 || st.mtfCount !== mtfCount || st.ptrMin !== ptrMin || st.mtfMin !== mtfMin) {
      throw new Xpress9Error('block parameters differ from session parameters')
    }
    if (encodedBits <= tableBits + 256) throw new Xpress9Error('encoded size too small')
    const blockBytes = (encodedBits + 7) >>> 3
    const blockEnd = Math.min(at + blockBytes, srcEnd)
    if (outPos + origSize > this.out.length) throw new Xpress9Error('output buffer too small')

    const br = new BitReader(src, at + 32, blockEnd)
    // MTF state
    let mtfLastPtr = 0
    let mtf0 = 0
    let mtf1 = 0
    let mtf2 = 0
    let mtf3 = 0
    if (mtfCount > 0) {
      mtfLastPtr = br.read(1)
      const offs = [0, 0, 0, 0]
      for (let i = 0; i < mtfCount; i++) {
        const msb = br.read(5)
        if (msb >= windowLog2) throw new Xpress9Error('corrupted MTF state')
        offs[i] = br.readLong(msb) + 2 ** msb
      }
      ;[mtf0, mtf1, mtf2, mtf3] = offs
    }
    decodeLengthTable(br, st.shortLengths, LZ77_SHORT_SYMBOL_ALPHABET_SIZE, LZ77_MAX_SHORT_LENGTH, HUFFMAN_MAX_CODEWORD_LENGTH)
    const shortRoot = createDecodeTables(st.shortLengths, LZ77_SHORT_SYMBOL_ALPHABET_SIZE, st.shortTable, SHORT_ROOT_BITS, SHORT_TAIL_BITS)
    decodeLengthTable(br, st.longLengths, LZ77_LONG_LENGTH_ALPHABET_SIZE, LZ77_MAX_SHORT_LENGTH, HUFFMAN_MAX_CODEWORD_LENGTH)
    const longRoot = createDecodeTables(st.longLengths, LZ77_LONG_LENGTH_ALPHABET_SIZE, st.longTable, LONG_ROOT_BITS, LONG_TAIL_BITS)
    if (br.consumedBits() !== tableBits) throw new Xpress9Error(`Huffman table bits ${br.consumedBits()} != ${tableBits}`)

    // ---- LZ77 decode loop (port of Xpress9Lz77Dec, all MTF/min-match variants) ----
    const out = this.out
    const shortTable = st.shortTable
    const longTable = st.longTable
    const historyStart = st.historyStart
    const stop = outPos + origSize
    let pos = outPos
    // local bit reader state for speed
    let bb = br.bb
    let bc = br.bc
    let ip = br.pos
    const SHORT_ROOT_MASK = (1 << SHORT_ROOT_BITS) - 1
    const SHORT_TAIL_MASK = (1 << SHORT_TAIL_BITS) - 1
    const LONG_ROOT_MASK = (1 << LONG_ROOT_BITS) - 1
    const LONG_TAIL_MASK = (1 << LONG_TAIL_BITS) - 1

    while (pos < stop) {
      // refill to >= 25 bits
      while (bc <= 24) {
        bb |= (ip < blockEnd ? src[ip] : 0) << bc
        ip++
        bc += 8
      }
      let e = shortTable[shortRoot + (bb & SHORT_ROOT_MASK)]
      if (e < 0) {
        let s = e & 15
        bb >>>= s
        bc -= s
        let t = shortRoot + (e & ~15)
        for (;;) {
          while (bc <= 24) {
            bb |= (ip < blockEnd ? src[ip] : 0) << bc
            ip++
            bc += 8
          }
          e = shortTable[t + (bb & SHORT_TAIL_MASK)]
          if (e >= 0) break
          s = e & 15
          bb >>>= s
          bc -= s
          t += e & ~15
        }
      }
      {
        const s = e & 15
        bb >>>= s
        bc -= s
      }
      let sym = (e >> 4) - 256
      if (sym < 0) {
        out[pos++] = sym + 256
        mtfLastPtr = 0
        continue
      }
      // pointer: decode length
      let length = sym & (LZ77_MAX_SHORT_LENGTH - 1)
      sym >>>= LZ77_MAX_SHORT_LENGTH_LOG
      if (length === LZ77_MAX_SHORT_LENGTH - 1) {
        while (bc <= 24) {
          bb |= (ip < blockEnd ? src[ip] : 0) << bc
          ip++
          bc += 8
        }
        let le = longTable[longRoot + (bb & LONG_ROOT_MASK)]
        if (le < 0) {
          let s = le & 15
          bb >>>= s
          bc -= s
          let t = longRoot + (le & ~15)
          for (;;) {
            while (bc <= 24) {
              bb |= (ip < blockEnd ? src[ip] : 0) << bc
              ip++
              bc += 8
            }
            le = longTable[t + (bb & LONG_TAIL_MASK)]
            if (le >= 0) break
            s = le & 15
            bb >>>= s
            bc -= s
            t += le & ~15
          }
        }
        {
          const s = le & 15
          bb >>>= s
          bc -= s
        }
        length = le >> 4
        if (length >= LZ77_MAX_LONG_LENGTH) {
          const nb = length - LZ77_MAX_LONG_LENGTH
          while (bc <= 24) {
            bb |= (ip < blockEnd ? src[ip] : 0) << bc
            ip++
            bc += 8
          }
          let v: number
          if (nb <= 24) {
            v = nb === 0 ? 0 : bb & ((1 << nb) - 1)
            bb >>>= nb
            bc -= nb
          } else {
            v = bb & 0xffff
            bb >>>= 16
            bc -= 16
            while (bc <= 24) {
              bb |= (ip < blockEnd ? src[ip] : 0) << bc
              ip++
              bc += 8
            }
            const hi = bb & ((1 << (nb - 16)) - 1)
            bb >>>= nb - 16
            bc -= nb - 16
            v += hi * 65536
          }
          length = v + 2 ** nb + LZ77_MAX_LONG_LENGTH - 1
        }
        length += LZ77_MAX_SHORT_LENGTH - 1
      }

      let offset: number
      if (sym < mtfCount) {
        // MTF pointer
        length += st.mtfMin
        if (mtfLastPtr) {
          if (mtfCount <= 2) {
            if (sym !== 0) throw new Xpress9Error('corrupted MTF reference')
            offset = mtf1
          } else if (sym === 0) {
            offset = mtf1
          } else if (sym === 1) {
            offset = mtf2
            mtf2 = mtf1
          } else if (sym === 2) {
            offset = mtf3
            mtf3 = mtf2
            mtf2 = mtf1
          } else {
            throw new Xpress9Error('corrupted MTF reference')
          }
          mtf1 = mtf0
          mtf0 = offset
        } else if (sym === 0) {
          offset = mtf0
        } else if (sym === 1 || mtfCount <= 2) {
          offset = mtf1
          mtf1 = mtf0
          mtf0 = offset
        } else if (sym === 2) {
          offset = mtf2
          mtf2 = mtf1
          mtf1 = mtf0
          mtf0 = offset
        } else {
          offset = mtf3
          mtf3 = mtf2
          mtf2 = mtf1
          mtf1 = mtf0
          mtf0 = offset
        }
      } else {
        length += st.ptrMin
        const nb = sym - mtfCount
        while (bc <= 24) {
          bb |= (ip < blockEnd ? src[ip] : 0) << bc
          ip++
          bc += 8
        }
        let v: number
        if (nb <= 24) {
          v = nb === 0 ? 0 : bb & ((1 << nb) - 1)
          bb >>>= nb
          bc -= nb
        } else {
          v = bb & 0xffff
          bb >>>= 16
          bc -= 16
          while (bc <= 24) {
            bb |= (ip < blockEnd ? src[ip] : 0) << bc
            ip++
            bc += 8
          }
          const hi = bb & ((1 << (nb - 16)) - 1)
          bb >>>= nb - 16
          bc -= nb - 16
          v += hi * 65536
        }
        offset = v + 2 ** nb
        if (mtfCount > 2) {
          mtf3 = mtf2
          mtf2 = mtf1
        }
        if (mtfCount > 0) {
          mtf1 = mtf0
          mtf0 = offset
        }
      }
      if (offset > pos - historyStart) throw new Xpress9Error(`back-reference ${offset} before start of history at ${pos - historyStart}`)
      mtfLastPtr = 1
      const last = pos + length
      if (last > stop) throw new Xpress9Error('match overruns block')
      let from = pos - offset
      if (offset >= length && length > 32) {
        out.copyWithin(pos, from, from + length)
        pos = last
      } else {
        while (pos < last) out[pos++] = out[from++]
      }
    }

    // Verify every encoded bit was consumed.
    const consumed = (ip - (at + 32)) * 8 - bc + 256
    if (consumed !== encodedBits) throw new Xpress9Error(`decoded ${consumed} bits, block declares ${encodedBits}`)
    st.blockIndex++
    return { produced: origSize, blockBytes }
  }
}
