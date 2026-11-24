/**
 * BLAKE3 (hash mode, 32-byte output), after the reference implementation in the BLAKE3 paper's repository.
 * Cloudflare Pages keys uploaded files by a BLAKE3 hash, so the Cloudflare target needs it; Node's crypto has none.
 */
const IV = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
const PERM = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8]
const CHUNK_START = 1
const CHUNK_END = 2
const PARENT = 4
const ROOT = 8
const BLOCK = 64
const CHUNK = 1024

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0
}

function g(s: Uint32Array, a: number, b: number, c: number, d: number, x: number, y: number): void {
  s[a] = (s[a] + s[b] + x) >>> 0
  s[d] = rotr(s[d] ^ s[a], 16)
  s[c] = (s[c] + s[d]) >>> 0
  s[b] = rotr(s[b] ^ s[c], 12)
  s[a] = (s[a] + s[b] + y) >>> 0
  s[d] = rotr(s[d] ^ s[a], 8)
  s[c] = (s[c] + s[d]) >>> 0
  s[b] = rotr(s[b] ^ s[c], 7)
}

function compress(cv: Uint32Array, block: Uint32Array, counter: number, blockLen: number, flags: number): Uint32Array {
  const s = new Uint32Array(16)
  s.set(cv, 0)
  s.set(IV.subarray(0, 4), 8)
  s[12] = counter >>> 0
  s[13] = Math.floor(counter / 0x100000000) >>> 0
  s[14] = blockLen
  s[15] = flags
  let m = Uint32Array.from(block)
  for (let r = 0; r < 7; r++) {
    g(s, 0, 4, 8, 12, m[0], m[1])
    g(s, 1, 5, 9, 13, m[2], m[3])
    g(s, 2, 6, 10, 14, m[4], m[5])
    g(s, 3, 7, 11, 15, m[6], m[7])
    g(s, 0, 5, 10, 15, m[8], m[9])
    g(s, 1, 6, 11, 12, m[10], m[11])
    g(s, 2, 7, 8, 13, m[12], m[13])
    g(s, 3, 4, 9, 14, m[14], m[15])
    if (r < 6) m = Uint32Array.from(PERM, (i) => m[i])
  }
  for (let i = 0; i < 8; i++) {
    s[i] ^= s[i + 8]
    s[i + 8] ^= cv[i]
  }
  return s
}

function words(bytes: Uint8Array): Uint32Array {
  const out = new Uint32Array(16)
  for (let i = 0; i < 16; i++) out[i] = (bytes[4 * i] | (bytes[4 * i + 1] << 8) | (bytes[4 * i + 2] << 16) | (bytes[4 * i + 3] << 24)) >>> 0
  return out
}

interface Output {
  cv: Uint32Array
  block: Uint32Array
  counter: number
  blockLen: number
  flags: number
}

const chainingValue = (o: Output) => compress(o.cv, o.block, o.counter, o.blockLen, o.flags).slice(0, 8)

class ChunkState {
  cv: Uint32Array
  block = new Uint8Array(BLOCK)
  blockLen = 0
  blocksCompressed = 0
  constructor(
    key: Uint32Array,
    readonly counter: number
  ) {
    this.cv = Uint32Array.from(key)
  }
  get length(): number {
    return BLOCK * this.blocksCompressed + this.blockLen
  }
  private get start(): number {
    return this.blocksCompressed === 0 ? CHUNK_START : 0
  }
  update(input: Uint8Array): void {
    let at = 0
    while (at < input.length) {
      if (this.blockLen === BLOCK) {
        this.cv = compress(this.cv, words(this.block), this.counter, BLOCK, this.start).slice(0, 8)
        this.blocksCompressed++
        this.block.fill(0)
        this.blockLen = 0
      }
      const take = Math.min(BLOCK - this.blockLen, input.length - at)
      this.block.set(input.subarray(at, at + take), this.blockLen)
      this.blockLen += take
      at += take
    }
  }
  output(): Output {
    return { cv: this.cv, block: words(this.block), counter: this.counter, blockLen: this.blockLen, flags: this.start | CHUNK_END }
  }
}

function parent(left: Uint32Array, right: Uint32Array): Output {
  const block = new Uint32Array(16)
  block.set(left, 0)
  block.set(right, 8)
  return { cv: IV, block, counter: 0, blockLen: BLOCK, flags: PARENT }
}

/** BLAKE3 digest (32 bytes) of `input`. */
export function blake3(input: Uint8Array): Uint8Array {
  const stack: Uint32Array[] = []
  let chunk = new ChunkState(IV, 0)
  let at = 0
  while (at < input.length) {
    if (chunk.length === CHUNK) {
      let cv = chainingValue(chunk.output())
      let total = chunk.counter + 1
      while ((total & 1) === 0) {
        cv = chainingValue(parent(stack.pop()!, cv))
        total = Math.floor(total / 2)
      }
      stack.push(cv)
      chunk = new ChunkState(IV, chunk.counter + 1)
    }
    const take = Math.min(CHUNK - chunk.length, input.length - at)
    chunk.update(input.subarray(at, at + take))
    at += take
  }
  let out = chunk.output()
  for (let i = stack.length - 1; i >= 0; i--) out = parent(stack[i], chainingValue(out))
  const s = compress(out.cv, out.block, 0, out.blockLen, out.flags | ROOT)
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 8; i++) {
    bytes[4 * i] = s[i] & 0xff
    bytes[4 * i + 1] = (s[i] >>> 8) & 0xff
    bytes[4 * i + 2] = (s[i] >>> 16) & 0xff
    bytes[4 * i + 3] = (s[i] >>> 24) & 0xff
  }
  return bytes
}

export function blake3Hex(input: Uint8Array): string {
  return Array.from(blake3(input), (b) => b.toString(16).padStart(2, '0')).join('')
}
