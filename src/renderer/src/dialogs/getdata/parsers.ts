/**
 * Renderer-side file parsing for Get data previews and direct loads: CSV/TSV (delimiter detection,
 * RFC 4180 quotes, UTF-8 BOM), JSON (array of records / record of arrays / array of arrays),
 * type inference (Power Query's "Detect data type" approximation), plus helpers shared by the
 * Excel / Parquet / SQL readers. Values follow the DataStore contract (dates = UTC-naive Date).
 */
import type { DataType } from '@core/model/types'
import type { Scalar } from '@core/model/data'

export interface ParsedTable {
  columns: string[]
  types: DataType[]
  rows: Scalar[][]
  /** rows were cut at a limit */
  truncated?: boolean
}

// ---------------------------------------------------------------------------------------------
// Text decoding / CSV
// ---------------------------------------------------------------------------------------------

export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  const text = new TextDecoder('utf-8').decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Pick the delimiter that splits the first lines most consistently (comma, semicolon, tab, pipe). */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20)
  let best = ','
  let bestScore = -1
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => countOutsideQuotes(l, d))
    if (!counts.length || counts[0] === 0) continue
    const consistent = counts.filter((c) => c === counts[0]).length
    const score = consistent * 1000 + counts[0]
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

function countOutsideQuotes(line: string, d: string): number {
  let n = 0
  let q = false
  for (const ch of line) {
    if (ch === '"') q = !q
    else if (ch === d && !q) n++
  }
  return n
}

/** RFC 4180 CSV parse into string rows (quoted fields may contain delimiters, quotes and newlines). */
export function parseCsvRows(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let q = false
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        q = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"' && field === '') {
      q = true
      i++
    } else if (ch === delimiter) {
      row.push(field)
      field = ''
      i++
    } else if (ch === '\r' || ch === '\n') {
      row.push(field)
      field = ''
      rows.push(row)
      row = []
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1
    } else {
      field += ch
      i++
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

/** Should the first row be promoted to headers? (PBI: first row all text and some later row has non-text.) */
export function looksLikeHeader(rows: Scalar[][]): boolean {
  if (rows.length < 2) return rows.length === 1
  const first = rows[0]
  if (!first.every((v) => typeof v === 'string' && v.trim() !== '' && inferStringType(v) === 'string')) return false
  if (new Set(first.map((v) => String(v).toLowerCase())).size !== first.length) return false
  const sample = rows.slice(1, 50)
  // any column whose body is typed (number/date/bool) while the first row is text → header
  for (let c = 0; c < first.length; c++) {
    const vals = sample.map((r) => r[c]).filter((v) => v !== null && v !== '')
    if (vals.length && vals.every((v) => typeof v !== 'string' || inferStringType(v) !== 'string')) return true
  }
  // all-text tables: PBI promotes when values in the first row are distinct and none repeat in their column
  for (let c = 0; c < first.length; c++) if (sample.some((r) => r[c] === first[c])) return false
  return true
}

export function uniqueHeaders(raw: Scalar[]): string[] {
  const seen = new Map<string, number>()
  return raw.map((v, i) => {
    let name = v === null || v === undefined || String(v).trim() === '' ? `Column${i + 1}` : String(v).trim()
    const key = name.toLowerCase()
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    if (n) name = `${name}_${n}`
    return name
  })
}

/** Parse CSV text into a typed table. */
export function parseCsv(text: string, opts: { delimiter?: string; promoteHeaders?: boolean; limit?: number } = {}): ParsedTable & { delimiter: string; promoted: boolean } {
  const delimiter = opts.delimiter ?? detectDelimiter(text)
  const raw = parseCsvRows(text, delimiter)
  const width = raw.reduce((m, r) => Math.max(m, r.length), 0)
  const typedProbe: Scalar[][] = raw.slice(0, 60).map((r) => r.map((v) => (v === '' ? null : v)))
  const promoted = opts.promoteHeaders ?? looksLikeHeader(typedProbe)
  const headers = promoted ? uniqueHeaders(Array.from({ length: width }, (_, i) => raw[0]?.[i] ?? null)) : Array.from({ length: width }, (_, i) => `Column${i + 1}`)
  const body = (promoted ? raw.slice(1) : raw).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''))
  const limited = opts.limit !== undefined && body.length > opts.limit ? body.slice(0, opts.limit) : body
  const t = typeStringTable(headers, limited)
  return { ...t, truncated: limited.length < body.length, delimiter, promoted }
}

// ---------------------------------------------------------------------------------------------
// Type inference
// ---------------------------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?(?: ?([AP]M))?)?$/i

export function parseDateString(s: string): Date | null {
  let m = ISO_DATE.exec(s)
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), m[7] ? Math.round(Number('0.' + m[7]) * 1000) : 0))
    return d.getUTCMonth() === +m[2] - 1 ? d : null
  }
  m = US_DATE.exec(s)
  if (m) {
    let h = +(m[4] ?? 0)
    if (m[7]) h = (h % 12) + (m[7].toUpperCase() === 'PM' ? 12 : 0)
    const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], h, +(m[5] ?? 0), +(m[6] ?? 0)))
    return d.getUTCMonth() === +m[1] - 1 ? d : null
  }
  return null
}

const INT = /^[+-]?\d+$/
const NUM = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/** Type a single string would be detected as. */
export function inferStringType(s: string): DataType {
  const t = s.trim()
  if (t === '') return 'unknown'
  if (/^(true|false)$/i.test(t)) return 'boolean'
  if (INT.test(t) && Math.abs(Number(t)) <= Number.MAX_SAFE_INTEGER) return 'int64'
  if (NUM.test(t)) return 'double'
  if (parseDateString(t)) return 'dateTime'
  return 'string'
}

/** Combine per-value types into a column type. */
export function combineTypes(types: Iterable<DataType>): DataType {
  let out: DataType | null = null
  for (const t of types) {
    if (t === 'unknown') continue
    if (out === null) out = t
    else if (out !== t) {
      if ((out === 'int64' && t === 'double') || (out === 'double' && t === 'int64')) out = 'double'
      else return 'string'
    }
  }
  return out ?? 'string'
}

export function convertString(s: string, type: DataType): Scalar {
  const t = s.trim()
  if (t === '') return null
  switch (type) {
    case 'int64':
    case 'double':
    case 'decimal':
      return Number(t)
    case 'boolean':
      return /^true$/i.test(t)
    case 'dateTime':
      return parseDateString(t)
    default:
      return s
  }
}

/** Type a table of strings (CSV / Enter data): detect each column's type and convert values. */
export function typeStringTable(columns: string[], rows: string[][]): ParsedTable {
  const types = columns.map((_, c) => combineTypes(rows.slice(0, 1000).map((r) => inferStringType(r[c] ?? ''))))
  return { columns, types, rows: rows.map((r) => columns.map((_, c) => convertString(r[c] ?? '', types[c]))) }
}

/** Type of a JS value already parsed (JSON / Excel / Parquet / SQL). */
export function valueType(v: unknown): DataType {
  if (v === null || v === undefined) return 'unknown'
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'number') return Number.isInteger(v) ? 'int64' : 'double'
  if (typeof v === 'bigint') return 'int64'
  if (v instanceof Date) return 'dateTime'
  if (v instanceof Uint8Array) return 'binary'
  if (typeof v === 'string') return 'string'
  return 'string'
}

/** Normalize a parsed JS value into a Scalar (bigint → number, objects → JSON text). */
export function toScalar(v: unknown): Scalar {
  if (v === null || v === undefined) return null
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' || typeof v === 'boolean' || v instanceof Date || v instanceof Uint8Array) return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** Build a typed table from already-typed JS rows. */
export function typeValueTable(columns: string[], rows: unknown[][]): ParsedTable {
  const types = columns.map((_, c) => combineTypes(rows.slice(0, 2000).map((r) => valueType(r[c]))))
  return { columns, types, rows: rows.map((r) => columns.map((_, c) => coerce(toScalar(r[c]), types[c]))) }
}

function coerce(v: Scalar, t: DataType): Scalar {
  if (v === null) return null
  if (t === 'string' && typeof v !== 'string') return v instanceof Date ? v.toISOString() : String(v)
  if (t === 'double' && typeof v === 'number') return v
  return v
}

// ---------------------------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------------------------

/** Tabulate a JSON document. Returns null when it isn't table-shaped. */
export function tabulateJson(doc: unknown): (ParsedTable & { shape: 'records' | 'columns' | 'rows' | 'values' }) | null {
  if (Array.isArray(doc)) {
    if (!doc.length) return { columns: ['Value'], types: ['string'], rows: [], shape: 'values' }
    if (doc.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
      const cols: string[] = []
      const seen = new Set<string>()
      for (const r of doc.slice(0, 1000)) for (const k of Object.keys(r)) if (!seen.has(k)) (seen.add(k), cols.push(k))
      const t = typeValueTable(cols, doc.map((r: any) => cols.map((c) => jsonValue(r[c]))))
      return { ...t, shape: 'records' }
    }
    if (doc.every((r) => Array.isArray(r))) {
      const width = doc.reduce((m: number, r: any[]) => Math.max(m, r.length), 0)
      const cols = Array.from({ length: width }, (_, i) => `Column${i + 1}`)
      return { ...typeValueTable(cols, doc.map((r: any[]) => cols.map((_, i) => jsonValue(r[i])))), shape: 'rows' }
    }
    return { ...typeValueTable(['Value'], doc.map((v) => [jsonValue(v)])), shape: 'values' }
  }
  if (doc && typeof doc === 'object') {
    const entries = Object.entries(doc as Record<string, unknown>)
    const isRecord = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Date)
    if (entries.length && entries.every(([, v]) => Array.isArray(v) && !(v as unknown[]).some(isRecord))) {
      const cols = entries.map(([k]) => k)
      const len = Math.max(...entries.map(([, v]) => (v as unknown[]).length))
      const rows = Array.from({ length: len }, (_, r) => entries.map(([, v]) => jsonValue((v as unknown[])[r])))
      return { ...typeValueTable(cols, rows), shape: 'columns' }
    }
    // a record holding one array of records (e.g. { "value": [...] } OData style)
    const arr = entries.find(([, v]) => Array.isArray(v) && (v as unknown[]).every((x) => x && typeof x === 'object' && !Array.isArray(x)))
    if (arr) return tabulateJson(arr[1])
  }
  return null
}

function jsonValue(v: unknown): unknown {
  if (typeof v === 'string') {
    // ISO dates in JSON are detected like Power Query's type detection on text
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return parseDateString(v.replace(/Z$|[+-]\d{2}:?\d{2}$/, '')) ?? v
    return v
  }
  return v
}

// ---------------------------------------------------------------------------------------------
// SQL type names (tedious) → DataType
// ---------------------------------------------------------------------------------------------

export function sqlTypeToDataType(t: string): DataType {
  const s = t.toLowerCase()
  if (/^(bigint|int|smallint|tinyint|intn)/.test(s)) return 'int64'
  if (/^(decimal|numeric|money|smallmoney|decimaln|numericn|moneyn)/.test(s)) return 'decimal'
  if (/^(float|real|floatn)/.test(s)) return 'double'
  if (/^(date|datetime|datetime2|smalldatetime|datetimeoffset|time|daten|datetimen)/.test(s)) return 'dateTime'
  if (/^bit/.test(s)) return 'boolean'
  if (/^(binary|varbinary|image)/.test(s)) return 'binary'
  return 'string'
}

/** Summarize-by default like PBI: numeric non-key columns sum, everything else none. */
export function defaultSummarizeBy(name: string, type: DataType): 'sum' | 'none' {
  if (type !== 'int64' && type !== 'double' && type !== 'decimal') return 'none'
  const lower = name.toLowerCase()
  if (lower === 'id' || lower === 'key' || /[ _-](id|key)$/.test(lower) || /[a-z](Id|ID|Key)$/.test(name) || /^(id|key)[ _-]/.test(lower)) return 'none'
  if (/(code|number|zip|postal|phone|year)$/.test(lower)) return 'none'
  return 'sum'
}
