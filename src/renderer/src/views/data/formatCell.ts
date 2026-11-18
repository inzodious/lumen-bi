/**
 * Cell formatting for the Table view / previews: the engine's FORMAT semantics when available,
 * otherwise a close fallback (en-US) so the grid is readable without an engine.
 */
import type { QueryEngine } from '@core/engine/api'
import type { DataType } from '@core/model/types'
import type { Scalar } from '@core/model/data'

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

export function fallbackFormat(v: Scalar, dataType?: DataType, formatString?: string): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    const y = v.getUTCFullYear()
    const m = v.getUTCMonth() + 1
    const d = v.getUTCDate()
    const hasTime = v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds()
    if (formatString && /^yyyy-mm-dd$/i.test(formatString)) return `${y}-${pad(m)}-${pad(d)}`
    const date = `${m}/${d}/${y}`
    if (!hasTime || /short date|^m\/d\/yyyy$/i.test(formatString ?? '')) return date
    const h = v.getUTCHours()
    return `${date} ${h % 12 || 12}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())} ${h < 12 ? 'AM' : 'PM'}`
  }
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v === 'number') {
    if (formatString && /^(\\.|"[^"]*")/.test(formatString)) {
      // currency-like: literal prefix + numeric body (negative section in parentheses when present)
      const sections = formatString.split(';')
      const sec = v < 0 && sections[1] ? sections[1] : sections[0]
      const m = /^(\(?)(\\.|"[^"]*")(.*?)(\)?)$/.exec(sec)
      if (m) {
        const sym = m[2].startsWith('\\') ? m[2].slice(1) : m[2].slice(1, -1)
        const body = fallbackFormat(v < 0 && sections[1] ? -v : v, dataType, m[3])
        return `${m[1]}${sym}${body}${m[4]}`
      }
    }
    if (formatString && /%$/.test(formatString)) {
      const dec = (/\.(0+)/.exec(formatString)?.[1].length ?? 0)
      return `${(v * 100).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}%`
    }
    if (formatString && /0\.(0+)/.test(formatString)) {
      const dec = /0\.(0+)/.exec(formatString)![1].length
      return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: formatString.includes(',') })
    }
    if (formatString && /^#,0$/.test(formatString)) return Math.round(v).toLocaleString('en-US')
    if (dataType === 'int64' || formatString === '0') return String(Math.round(v))
    return String(Number(v.toPrecision(15)))
  }
  if (v instanceof Uint8Array) return `[binary ${v.length} bytes]`
  return String(v)
}

export function formatCell(v: Scalar, col: { dataType: DataType; formatString?: string }, engine: QueryEngine | null): string {
  if (v === null || v === undefined) return ''
  if (engine) {
    try {
      return engine.format(v, col.formatString, col.dataType)
    } catch {
      /* fall through */
    }
  }
  return fallbackFormat(v, col.dataType, col.formatString)
}
