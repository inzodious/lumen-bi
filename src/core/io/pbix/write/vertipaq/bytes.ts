/**
 * Little-endian byte builder and reader shared by the VertiPaq writers (pure TypeScript, no Node APIs).
 */

export class ByteWriter {
  private buf: Uint8Array
  private dv: DataView
  pos = 0
  constructor(initial = 256) {
    this.buf = new Uint8Array(initial)
    this.dv = new DataView(this.buf.buffer)
  }
  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return
    let cap = this.buf.length * 2
    while (cap < this.pos + n) cap *= 2
    const next = new Uint8Array(cap)
    next.set(this.buf.subarray(0, this.pos))
    this.buf = next
    this.dv = new DataView(next.buffer)
  }
  u8(v: number): this {
    this.ensure(1)
    this.buf[this.pos++] = v & 255
    return this
  }
  u16(v: number): this {
    this.ensure(2)
    this.dv.setUint16(this.pos, v, true)
    this.pos += 2
    return this
  }
  u32(v: number): this {
    this.ensure(4)
    this.dv.setUint32(this.pos, v >>> 0, true)
    this.pos += 4
    return this
  }
  i32(v: number): this {
    this.ensure(4)
    this.dv.setInt32(this.pos, v, true)
    this.pos += 4
    return this
  }
  /** unsigned 64-bit from a non-negative safe integer */
  u64(v: number): this {
    this.ensure(8)
    this.dv.setUint32(this.pos, v % 4294967296, true)
    this.dv.setUint32(this.pos + 4, Math.floor(v / 4294967296), true)
    this.pos += 8
    return this
  }
  /** signed 64-bit from a safe integer or a bigint */
  i64(v: number | bigint): this {
    this.ensure(8)
    this.dv.setBigInt64(this.pos, typeof v === 'bigint' ? v : BigInt(v), true)
    this.pos += 8
    return this
  }
  f64(v: number): this {
    this.ensure(8)
    this.dv.setFloat64(this.pos, v, true)
    this.pos += 8
    return this
  }
  bytes(b: Uint8Array): this {
    this.ensure(b.length)
    this.buf.set(b, this.pos)
    this.pos += b.length
    return this
  }
  zeros(n: number): this {
    this.ensure(n)
    this.buf.fill(0, this.pos, this.pos + n)
    this.pos += n
    return this
  }
  ascii(s: string): this {
    this.ensure(s.length)
    for (let i = 0; i < s.length; i++) this.buf[this.pos++] = s.charCodeAt(i)
    return this
  }
  /** patch a u64 written earlier */
  setU64(at: number, v: number): void {
    this.dv.setUint32(at, v % 4294967296, true)
    this.dv.setUint32(at + 4, Math.floor(v / 4294967296), true)
  }
  finish(): Uint8Array {
    return this.buf.slice(0, this.pos)
  }
}

export class ByteReader {
  pos = 0
  readonly dv: DataView
  constructor(readonly buf: Uint8Array) {
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  need(n: number): void {
    if (this.pos + n > this.buf.length) throw new Error('VertiPaq: unexpected end of data')
  }
  u8(): number {
    this.need(1)
    return this.buf[this.pos++]
  }
  u16(): number {
    this.need(2)
    const v = this.dv.getUint16(this.pos, true)
    this.pos += 2
    return v
  }
  u32(): number {
    this.need(4)
    const v = this.dv.getUint32(this.pos, true)
    this.pos += 4
    return v
  }
  i32(): number {
    this.need(4)
    const v = this.dv.getInt32(this.pos, true)
    this.pos += 4
    return v
  }
  u64(): number {
    this.need(8)
    const lo = this.dv.getUint32(this.pos, true)
    const hi = this.dv.getUint32(this.pos + 4, true)
    this.pos += 8
    return hi * 4294967296 + lo
  }
  i64(): bigint {
    this.need(8)
    const v = this.dv.getBigInt64(this.pos, true)
    this.pos += 8
    return v
  }
  f64(): number {
    this.need(8)
    const v = this.dv.getFloat64(this.pos, true)
    this.pos += 8
    return v
  }
  bytes(n: number): Uint8Array {
    this.need(n)
    const v = this.buf.subarray(this.pos, this.pos + n)
    this.pos += n
    return v
  }
  peekAscii(s: string): boolean {
    if (this.pos + s.length > this.buf.length) return false
    for (let i = 0; i < s.length; i++) if (this.buf[this.pos + i] !== s.charCodeAt(i)) return false
    return true
  }
  expect(s: string, what: string): void {
    if (!this.peekAscii(s)) throw new Error(`VertiPaq: bad ${what} at ${this.pos}`)
    this.pos += s.length
  }
  eof(): boolean {
    return this.pos >= this.buf.length
  }
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Index of the first differing byte, or -1. */
export function firstDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i
  return a.length === b.length ? -1 : n
}
