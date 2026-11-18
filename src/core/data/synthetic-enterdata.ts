/**
 * "Enter data" tables: Power BI Desktop stores manually entered tables inside the M partition as
 *   Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText("<base64>", BinaryEncoding.Base64),
 *     Compression.Deflate)), let _t = ... in type table [Col1 = _t, ...])
 * followed by optional PromoteHeaders / RenameColumns / TransformColumnTypes steps.
 *
 * Those rows are real model content (not external data), so when the synthetic generator meets such
 * a table it decodes them instead of inventing values. Only the common step shapes are understood;
 * anything else returns undefined and the caller falls back to synthetic rows.
 */
import { inflateSync } from 'fflate'
import type { ColumnDef, DataType, TableDef } from '../model/types'
import { makeDate, type ColumnData, type Scalar, type TableData } from '../model/data'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64Decode(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let buf = 0
  let bits = 0
  let o = 0
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | B64.indexOf(clean[i])
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (buf >> bits) & 0xff
    }
  }
  return out.subarray(0, o)
}

function mString(tok: string): string {
  const t = tok.trim()
  const m = /^#?"((?:[^"]|"")*)"$/.exec(t)
  return m ? m[1].replace(/""/g, '"') : t
}

/** Split on commas outside quotes / brackets. */
function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let inStr = false
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      cur += ch
      if (ch === '"') {
        if (s[i + 1] === '"') cur += s[++i]
        else inStr = false
      }
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '[' || ch === '{' || ch === '(') depth++
    else if (ch === ']' || ch === '}' || ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

/** True when the M partition is an "Enter data" table. */
export function isEnterDataPartition(expression: string | undefined): boolean {
  return !!expression && /Table\.FromRows\s*\(\s*Json\.Document\s*\(\s*Binary\.Decompress\s*\(\s*Binary\.FromText\s*\(/.test(expression)
}

function convert(v: unknown, type: DataType): Scalar {
  if (v === null || v === undefined) return null
  const s = typeof v === 'string' ? v : String(v)
  switch (type) {
    case 'string':
    case 'unknown':
    case 'variant':
      return s
    case 'int64': {
      if (s.trim() === '') return null
      const n = Number(s)
      return Number.isFinite(n) ? Math.round(n) : null
    }
    case 'double':
    case 'decimal': {
      if (s.trim() === '') return null
      const n = Number(s.replace(/[$,%\s]/g, ''))
      return Number.isFinite(n) ? n : null
    }
    case 'boolean': {
      const l = s.trim().toLowerCase()
      return l === 'true' || l === 'yes' || l === '1' ? true : l === 'false' || l === 'no' || l === '0' ? false : null
    }
    case 'dateTime': {
      let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s.trim())
      if (m) return makeDate(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i.exec(s.trim())
      if (m) {
        let hh = +(m[4] ?? 0)
        if (m[7]?.toUpperCase() === 'PM' && hh < 12) hh += 12
        if (m[7]?.toUpperCase() === 'AM' && hh === 12) hh = 0
        return makeDate(+m[3], +m[1], +m[2], hh, +(m[5] ?? 0), +(m[6] ?? 0))
      }
      return null
    }
    default:
      return null
  }
}

/**
 * Decode an Enter-data table. Returns TableData for the table's data columns (model column names),
 * or undefined when the partition is not an Enter-data table or a model column cannot be mapped.
 */
export function decodeEnterDataTable(table: TableDef, dataColumns: ColumnDef[]): TableData | undefined {
  const expr = table.partitions.find((p) => p.sourceType === 'm')?.expression
  if (!expr || !isEnterDataPartition(expr)) return undefined
  try {
    const b64 = /Binary\.FromText\s*\(\s*"([^"]*)"/.exec(expr)?.[1]
    if (b64 === undefined) return undefined
    const json = new TextDecoder().decode(inflateSync(base64Decode(b64)))
    const rows = JSON.parse(json) as unknown[][]
    if (!Array.isArray(rows)) return undefined
    const typeTable = /type\s+table\s*\[([\s\S]*?)\]\s*\)/.exec(expr)?.[1]
    let names: string[] = typeTable ? splitTop(typeTable).map((e) => mString(e.split('=')[0])) : []
    let body = rows
    if (/Table\.PromoteHeaders\s*\(/.test(expr) && rows.length) {
      names = rows[0].map((v) => String(v ?? ''))
      body = rows.slice(1)
    }
    const renameRe = /Table\.RenameColumns\s*\([^{]*\{([\s\S]*?\})\s*\}/g
    for (let m = renameRe.exec(expr); m; m = renameRe.exec(expr)) {
      const pairRe = /\{\s*("(?:[^"]|"")*")\s*,\s*("(?:[^"]|"")*")\s*\}/g
      for (let p = pairRe.exec(m[1]); p; p = pairRe.exec(m[1])) {
        const from = mString(p[1])
        const to = mString(p[2])
        names = names.map((n) => (n === from ? to : n))
      }
    }
    const lower = names.map((n) => n.toLowerCase())
    const columns: ColumnData[] = []
    for (const col of dataColumns) {
      const src = (col.sourceColumn ?? col.name).replace(/^\[|\]$/g, '')
      let idx = names.indexOf(src)
      if (idx < 0) idx = lower.indexOf(src.toLowerCase())
      if (idx < 0) idx = lower.indexOf(col.name.toLowerCase())
      if (idx < 0) return undefined
      columns.push({ name: col.name, type: col.dataType, values: body.map((r) => convert(Array.isArray(r) ? r[idx] : null, col.dataType)) })
    }
    return { columns, rowCount: body.length }
  } catch {
    return undefined
  }
}
