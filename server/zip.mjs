/**
 * Minimal zip reader for site uploads (stored and deflated entries, no encryption, no zip64), built on node:zlib so
 * the server has no dependencies. Every path is checked so nothing can be written outside the target folder.
 */
import { inflateRawSync } from 'node:zlib'

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

/** A safe relative path inside a site: no absolute paths, no `..`, no empty segments, no backslashes. */
export function isSafePath(p) {
  return typeof p === 'string' && p.length > 0 && p.length < 512 && !p.startsWith('/') && !p.includes('\\') && !/^[a-z]:/i.test(p) && !p.split('/').some((s) => s === '' || s === '.' || s === '..')
}

/**
 * The files of a zip as a Map path → Buffer. Directory entries are skipped. Throws on a malformed archive, an unsafe
 * path, or when the uncompressed total exceeds `maxBytes`.
 */
export function readZip(buf, maxBytes = 512 * 1024 * 1024) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a zip archive')
  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  const files = new Map()
  let total = 0
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== CENTRAL) throw new Error('Malformed zip central directory')
    const flags = buf.readUInt16LE(at + 8)
    const method = buf.readUInt16LE(at + 10)
    const csize = buf.readUInt32LE(at + 20)
    const usize = buf.readUInt32LE(at + 24)
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8')
    at += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue
    if (flags & 1) throw new Error('Encrypted zip entries are not supported')
    if (!isSafePath(name)) throw new Error(`Unsafe path in archive: ${name}`)
    total += usize
    if (total > maxBytes) throw new Error('The upload is larger than this server accepts')
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== LOCAL) throw new Error('Malformed zip entry')
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + csize)
    let data
    if (method === 0) data = Buffer.from(raw)
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: Math.max(usize, 1) })
    else throw new Error(`Unsupported zip compression method ${method}`)
    if (data.length !== usize) throw new Error(`Corrupt zip entry: ${name}`)
    files.set(name, data)
  }
  return files
}
