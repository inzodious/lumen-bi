/**
 * Lossless size reduction for the PDFs printed by Chromium (scripts/docs/pdf-print.cjs).
 *
 *   node scripts/docs/pdf-compact.mjs <file.pdf> [...]     rewrites each file in place
 *
 * Chromium writes a tagged PDF (the structure tree screen readers use, and from which it builds the outline) as
 * tens of thousands of small uncompressed objects: a table cell is three objects. For the long reference tables they
 * are most of the file. This script moves every object that is not a stream into compressed object streams and
 * replaces the cross-reference table with a cross-reference stream (PDF 1.5). Nothing is removed or re-encoded: page
 * content, fonts, images, links, the outline and the structure tree are kept byte for byte.
 * Only the simple single-revision files Chromium writes are handled; anything else is left unchanged with a warning.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const PER_STREAM = 200

export function compactPdf(buf) {
  const s = buf.toString('latin1')
  const sx = s.lastIndexOf('startxref')
  if (sx < 0) throw new Error('no startxref')
  const xrefAt = parseInt(s.slice(sx + 9).trim(), 10)
  if (s.slice(xrefAt, xrefAt + 4) !== 'xref') throw new Error('not a classic cross-reference table')
  if (s.indexOf('xref', xrefAt + 4) !== -1 && s.indexOf('xref', xrefAt + 4) < sx) throw new Error('more than one revision')
  const tr = s.indexOf('trailer', xrefAt)
  const trailer = s.slice(tr + 7, sx)
  if (/\/Encrypt\b|\/Prev\b/.test(trailer)) throw new Error('encrypted or incremental file')
  const root = /\/Root\s+(\d+\s+\d+\s+R)/.exec(trailer)?.[1]
  const info = /\/Info\s+(\d+\s+\d+\s+R)/.exec(trailer)?.[1]
  const id = /\/ID\s*(\[[^\]]*\])/.exec(trailer)?.[1]
  if (!root) throw new Error('no /Root')

  // cross-reference table: subsections "first count" followed by 20-byte entries
  const offsets = new Map()
  let size = 0
  const lines = s.slice(xrefAt + 4, tr).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (let i = 0; i < lines.length; ) {
    const [first, count] = lines[i++].split(/\s+/).map(Number)
    for (let k = 0; k < count; k++, i++) {
      const [off, gen, kind] = lines[i].split(/\s+/)
      if (kind === 'n') offsets.set(first + k, { off: Number(off), gen: Number(gen) })
    }
    size = Math.max(size, first + count)
  }

  const sorted = [...offsets.entries()].sort((a, b) => a[1].off - b[1].off)
  const streamObjs = [] // [num, gen, Buffer] kept verbatim
  const plainObjs = [] // [num, body string]
  for (let i = 0; i < sorted.length; i++) {
    const [num, { off, gen }] = sorted[i]
    const end = i + 1 < sorted.length ? sorted[i + 1][1].off : xrefAt
    const seg = s.slice(off, end)
    const head = new RegExp(`^${num}\\s+${gen}\\s+obj\\b`).exec(seg)
    if (!head) throw new Error(`object ${num} not at its offset`)
    const e = seg.lastIndexOf('endobj')
    if (e < 0) throw new Error(`object ${num} has no endobj`)
    const body = seg.slice(head[0].length, e).trim()
    if (gen !== 0 || body.endsWith('endstream')) streamObjs.push([num, gen, buf.subarray(off, off + e + 6)])
    else plainObjs.push([num, body])
  }

  const out = []
  let pos = 0
  const push = (b) => {
    const x = typeof b === 'string' ? Buffer.from(b, 'latin1') : b
    out.push(x)
    pos += x.length
  }
  const entries = new Map() // num -> [type, f2, f3]
  push('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n')
  for (const [num, gen, b] of streamObjs) {
    entries.set(num, [1, pos, gen])
    push(b)
    push('\n')
  }
  let next = size
  for (let i = 0; i < plainObjs.length; i += PER_STREAM) {
    const group = plainObjs.slice(i, i + PER_STREAM)
    const objNum = next++
    let header = ''
    let data = ''
    group.forEach(([num, body], k) => {
      header += `${num} ${data.length} `
      data += body + '\n'
      entries.set(num, [2, objNum, k])
    })
    const z = deflateSync(Buffer.from(header + data, 'latin1'), { level: 9 })
    entries.set(objNum, [1, pos, 0])
    push(`${objNum} 0 obj\n<</Type /ObjStm /N ${group.length} /First ${header.length} /Filter /FlateDecode /Length ${z.length}>>\nstream\n`)
    push(z)
    push('\nendstream\nendobj\n')
  }
  const xrefNum = next++
  const total = next
  entries.set(xrefNum, [1, pos, 0])
  const rows = Buffer.alloc(total * 7)
  for (let n = 0; n < total; n++) {
    const [t, a, b] = entries.get(n) ?? [0, 0, n === 0 ? 65535 : 0]
    rows.writeUInt8(t, n * 7)
    rows.writeUInt32BE(a, n * 7 + 1)
    rows.writeUInt16BE(b, n * 7 + 5)
  }
  const z = deflateSync(rows, { level: 9 })
  const xrefPos = pos
  push(
    `${xrefNum} 0 obj\n<</Type /XRef /Size ${total} /W [1 4 2] /Root ${root}${info ? ` /Info ${info}` : ''}${id ? ` /ID ${id}` : ''} /Filter /FlateDecode /Length ${z.length}>>\nstream\n`
  )
  push(z)
  push(`\nendstream\nendobj\nstartxref\n${xrefPos}\n%%EOF\n`)
  return Buffer.concat(out)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const f of process.argv.slice(2)) {
    const before = readFileSync(f)
    try {
      const after = compactPdf(before)
      writeFileSync(f, after)
      console.log(`${f}: ${Math.round(before.length / 1024)} KB -> ${Math.round(after.length / 1024)} KB`)
    } catch (e) {
      console.warn(`${f}: left unchanged (${e.message})`)
    }
  }
}
