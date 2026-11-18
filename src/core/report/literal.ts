/**
 * PBIR / SQ literal encoding.
 *   'text' (single quotes, '' escapes) · 12L (int) · 1.5D (double) · 1.5M (decimal) · true/false · null
 *   datetime'2024-01-31T00:00:00' (also datetime'2024-01-31T00:00:00.000')
 */
import type { Scalar } from '../model/data'

export function decodeLiteral(text: unknown): Scalar {
  if (typeof text !== 'string') return (text as Scalar) ?? null
  const t = text.trim()
  if (t === 'null') return null
  if (t === 'true') return true
  if (t === 'false') return false
  let m = /^(-?\d+)L$/.exec(t)
  if (m) return Number(m[1])
  m = /^(-?(?:\d+\.?\d*|\.\d+)(?:E[+-]?\d+)?)[DM]$/i.exec(t)
  if (m) return Number(m[1])
  m = /^datetime'(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?)?Z?'$/i.exec(t)
  if (m) {
    const ms = m[7] ? Math.round(Number('0.' + m[7]) * 1000) : 0
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), ms))
  }
  m = /^'((?:[^']|'')*)'$/s.exec(t)
  if (m) return m[1].replace(/''/g, "'")
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  return t
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0')
}

export function encodeLiteral(v: Scalar): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return String(v)
  if (typeof v === 'number') return Number.isInteger(v) ? `${v}L` : `${v}D`
  if (v instanceof Date) {
    return `datetime'${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}T${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}'`
  }
  if (v instanceof Uint8Array) return 'null'
  return `'${String(v).replace(/'/g, "''")}'`
}
