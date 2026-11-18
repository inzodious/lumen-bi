/** Content fingerprint for baked icons (change detection, not security): two FNV-1a 32-bit passes → 16 hex digits. */
export function fingerprint(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let a = 0x811c9dc5
  let b = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < bytes.length; i++) {
    a ^= bytes[i]
    a = Math.imul(a, 0x01000193)
    b ^= bytes[i] + (i & 0xff)
    b = Math.imul(b, 0x01000193)
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}
