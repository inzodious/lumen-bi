import { describe, expect, it } from 'vitest'
import { decompressDataModel, detectCompression } from '../datamodel/container'
import { compressDataModel, DATAMODEL_CHUNK_SIZE, DATAMODEL_SIGNATURE } from './datamodelwrite'
import { compressXpress9Blocks, crc32c, huffmanLengths } from './xpress9enc'

/** Deterministic pseudo-random bytes (xorshift32). */
function random(n: number, seed = 0x12345678): Uint8Array {
  const out = new Uint8Array(n)
  let x = seed >>> 0 || 1
  for (let i = 0; i < n; i++) {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    out[i] = x & 255
  }
  return out
}

/** Text-like data with repeats at many distances (exercises plain and MTF pointers). */
function structured(n: number): Uint8Array {
  const words = ['Sales', 'Amount', 'Customer', 'Region', '2024-01-', 'Total', ' ', ',', '\n', 'idf', 'Product', 'North', 'South']
  const out = new Uint8Array(n)
  const r = random(n, 99)
  let p = 0
  let i = 0
  while (p < n) {
    const w = words[r[i++ % n] % words.length]
    for (let k = 0; k < w.length && p < n; k++) out[p++] = w.charCodeAt(k)
    if (r[i % n] < 20 && p < n) out[p++] = r[(i + 1) % n] // occasional noise
  }
  return out
}

function roundTrip(input: Uint8Array): Uint8Array {
  return decompressDataModel(compressDataModel(input))
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

describe('XPress9 encoder', () => {
  it('crc32c matches the standard check value', () => {
    expect(crc32c(new TextEncoder().encode('123456789'))).toBe(0xe3069283)
  })

  it('round-trips empty and one-byte inputs', () => {
    expect(roundTrip(new Uint8Array(0))).toEqual(new Uint8Array(0))
    expect(roundTrip(Uint8Array.of(0x41))).toEqual(Uint8Array.of(0x41))
    expect(roundTrip(Uint8Array.of(0, 0))).toEqual(Uint8Array.of(0, 0))
  })

  it('round-trips highly repetitive data and compresses it', () => {
    const zeros = new Uint8Array(3 * 1024 * 1024)
    const c = compressDataModel(zeros)
    expect(c.length).toBeLessThan(10_000)
    expect(sameBytes(decompressDataModel(c), zeros)).toBe(true)
    const pattern = new Uint8Array(1_000_000)
    for (let i = 0; i < pattern.length; i++) pattern[i] = i % 7 === 0 ? 1 : (i * 31) & 3
    expect(sameBytes(roundTrip(pattern), pattern)).toBe(true)
  })

  it('round-trips incompressible data spanning several chunks', () => {
    const r = random(5 * 1024 * 1024 + 123)
    const c = compressDataModel(r)
    expect(sameBytes(decompressDataModel(c), r)).toBe(true)
    // incompressible input grows only a little
    expect(c.length).toBeLessThan(r.length * 1.05)
  })

  it('round-trips structured data with matches across chunk boundaries', () => {
    const s = structured(4 * 1024 * 1024 + 777)
    const c = compressDataModel(s)
    expect(c.length).toBeLessThan(s.length / 3)
    expect(sameBytes(decompressDataModel(c), s)).toBe(true)
  })

  it('round-trips more than 16 MB with long-distance repeats', () => {
    const block = random(1024 * 1024, 7)
    const big = new Uint8Array(17 * 1024 * 1024 + 5)
    for (let p = 0; p < big.length; p += block.length) big.set(block.subarray(0, Math.min(block.length, big.length - p)), p)
    const c = compressDataModel(big)
    expect(c.length).toBeLessThan(big.length / 4) // 1 MB repeats are found (within the 2 MB reach)
    expect(sameBytes(decompressDataModel(c), big)).toBe(true)
  }, 60_000)

  it('round-trips with small blocks and with the fixed (stored) code-length tables', () => {
    const s = structured(300_000)
    for (const opts of [{ blockSize: 1000 }, { blockSize: 65536, storedTables: true }, { chainDepth: 1 }]) {
      const blocks = compressXpress9Blocks(s, opts)
      expect(blocks.length).toBe(Math.ceil(s.length / (opts.blockSize ?? DATAMODEL_CHUNK_SIZE)))
      expect(sameBytes(decompressDataModel(compressDataModel(s, opts)), s)).toBe(true)
    }
  })

  it('writes Power BI Desktop block headers', () => {
    const s = structured(5 * 1024 * 1024)
    const blocks = compressXpress9Blocks(s, { sessionSignature: 0xabcdef01 })
    expect(blocks.map((b) => b.origSize)).toEqual([DATAMODEL_CHUNK_SIZE, DATAMODEL_CHUNK_SIZE, s.length - 2 * DATAMODEL_CHUNK_SIZE])
    blocks.forEach((b, i) => {
      const dv = new DataView(b.bytes.buffer, b.bytes.byteOffset, b.bytes.byteLength)
      expect(dv.getUint32(0, true)).toBe(0x4e86d72a)
      expect(dv.getUint32(4, true)).toBe(b.origSize)
      expect(Math.ceil(dv.getUint32(8, true) / 8)).toBe(b.bytes.length)
      const flags = dv.getUint32(12, true)
      expect(flags & ~0x1fff).toBe(0x6c000) // window 2^22, 4 MTF entries, pointer minimum 4, MTF minimum 2
      expect(dv.getUint32(16, true)).toBe(0)
      expect(dv.getUint32(20, true)).toBe(0xabcdef01)
      expect(dv.getUint32(24, true)).toBe(i)
      expect(dv.getUint32(28, true)).toBe(crc32c(b.bytes, 0, 28))
    })
  })

  it('frames the stream like Power BI Desktop and is deterministic', () => {
    const s = structured(2 * 1024 * 1024 + 10)
    const a = compressDataModel(s)
    expect(detectCompression(a)).toBe('xpress9')
    const sig = new TextDecoder('utf-16le').decode(a.subarray(0, 102))
    expect(sig).toBe(DATAMODEL_SIGNATURE + '\0')
    const dv = new DataView(a.buffer, a.byteOffset)
    expect(dv.getUint32(102, true)).toBe(DATAMODEL_CHUNK_SIZE)
    expect(sameBytes(compressDataModel(s), a)).toBe(true)
  })

  it('limits Huffman code lengths and keeps codes complete', () => {
    // Fibonacci-like frequencies produce very deep unrestricted trees
    const freq: number[] = []
    let a = 1
    let b = 1
    for (let i = 0; i < 40; i++) {
      freq.push(a)
      ;[a, b] = [b, a + b]
    }
    for (const limit of [8, 12]) {
      const lens = huffmanLengths(freq, limit)
      expect(Math.max(...lens)).toBeLessThanOrEqual(limit)
      const kraft = [...lens].reduce((s, l) => s + (l ? 2 ** -l : 0), 0)
      expect(kraft).toBeCloseTo(1, 12)
    }
    // a single used symbol still yields a complete two-leaf code
    const one = huffmanLengths([0, 5, 0], 8)
    expect([...one].filter((l) => l > 0)).toEqual([1, 1])
  })
})
