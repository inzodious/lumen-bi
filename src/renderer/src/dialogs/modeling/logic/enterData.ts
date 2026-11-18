/**
 * Home ▸ Enter data — produce exactly the M partition Power BI Desktop writes, so the table
 * round-trips through PBIP/TMDL and Power BI itself:
 *
 *   let
 *       Source = Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText("<base64>", BinaryEncoding.Base64), Compression.Deflate)), let _t = ((type nullable text) meta [Serialized.Text = true]) in type table [Column1 = _t, #"My col" = _t]),
 *       #"Changed Type" = Table.TransformColumnTypes(Source,{{"Column1", Int64.Type}, {"My col", type text}})
 *   in
 *       #"Changed Type"
 *
 * The payload is the JSON array of row arrays (all cells as strings, empty cells as null),
 * compressed with raw DEFLATE and base64-encoded.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import type { ColumnDef, DataType, PartitionDef, TableDef } from '@core/model/types'
import type { Scalar, TableData } from '@core/model/data'
import { makeDate } from '@core/model/data'

export type EnterDataType = 'text' | 'int64' | 'number' | 'date' | 'datetime' | 'logical'

export interface EnterDataColumn {
  name: string
  /** undefined → inferred from the values (like PBI's automatic "Changed Type" step) */
  type?: EnterDataType
}

const M_KEYWORDS = new Set([
  'and', 'as', 'each', 'else', 'error', 'false', 'if', 'in', 'is', 'let', 'meta', 'not', 'null', 'or', 'otherwise', 'section', 'shared', 'then', 'true', 'try', 'type',
  '#binary', '#date', '#datetime', '#datetimezone', '#duration', '#infinity', '#nan', '#sections', '#shared', '#table', '#time'
])

/** M identifier: bare when regular, else #"quoted". */
export function mIdentifier(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !M_KEYWORDS.has(name) ? name : `#"${name.replace(/"/g, '""')}"`
}

const mString = (s: string): string => `"${s.replace(/"/g, '""')}"`

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function encodeEnterDataPayload(rows: Array<Array<string | null>>): string {
  return toBase64(deflateSync(strToU8(JSON.stringify(rows)), { level: 9 }))
}

export function decodeEnterDataPayload(b64: string): Array<Array<string | null>> {
  const json = strFromU8(inflateSync(fromBase64(b64)))
  const parsed: unknown = JSON.parse(json)
  if (!Array.isArray(parsed)) throw new Error('Enter data payload is not an array')
  return parsed.map((r) => (Array.isArray(r) ? r.map((c) => (c === null || c === undefined ? null : String(c))) : []))
}

const RE_INT = /^[+-]?\d{1,15}$/
const RE_NUM = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
const RE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const RE_US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
const RE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/

/** PBI's type detection on the first rows: whole number, decimal, date, date/time, true/false, else text. */
export function inferEnterDataType(values: Array<string | null>): EnterDataType {
  const vals = values.filter((v): v is string => v !== null && v.trim() !== '').map((v) => v.trim())
  if (!vals.length) return 'text'
  if (vals.every((v) => RE_INT.test(v))) return 'int64'
  if (vals.every((v) => RE_NUM.test(v))) return 'number'
  if (vals.every((v) => RE_DATE.test(v) || RE_US_DATE.test(v))) return 'date'
  if (vals.every((v) => RE_DATETIME.test(v) || RE_DATE.test(v))) return 'datetime'
  if (vals.every((v) => /^(true|false)$/i.test(v))) return 'logical'
  return 'text'
}

const M_TYPE: Record<EnterDataType, string> = {
  text: 'type text',
  int64: 'Int64.Type',
  number: 'type number',
  date: 'type date',
  datetime: 'type datetime',
  logical: 'type logical'
}

const MODEL_TYPE: Record<EnterDataType, DataType> = {
  text: 'string',
  int64: 'int64',
  number: 'double',
  date: 'dateTime',
  datetime: 'dateTime',
  logical: 'boolean'
}

function normalizeRows(columns: EnterDataColumn[], rows: Array<Array<string | null>>): Array<Array<string | null>> {
  // PBI drops trailing completely-empty rows of the grid
  const out = rows.map((r) => columns.map((_, i) => (r[i] === undefined || r[i] === '' ? null : r[i])))
  while (out.length && out[out.length - 1].every((c) => c === null)) out.pop()
  return out
}

export function resolveTypes(columns: EnterDataColumn[], rows: Array<Array<string | null>>): EnterDataType[] {
  return columns.map((c, i) => c.type ?? inferEnterDataType(rows.map((r) => r[i] ?? null)))
}

/** The M expression PBI writes for an Enter-data table (indented with 4 spaces like PBI). */
export function buildEnterDataM(columns: EnterDataColumn[], rawRows: Array<Array<string | null>>): string {
  const rows = normalizeRows(columns, rawRows)
  const types = resolveTypes(columns, rows)
  const payload = encodeEnterDataPayload(rows)
  const typeFields = columns.map((c) => `${mIdentifier(c.name)} = _t`).join(', ')
  const changes = columns.map((c, i) => `{${mString(c.name)}, ${M_TYPE[types[i]]}}`).join(', ')
  return [
    'let',
    `    Source = Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText(${mString(payload)}, BinaryEncoding.Base64), Compression.Deflate)), let _t = ((type nullable text) meta [Serialized.Text = true]) in type table [${typeFields}]),`,
    `    #"Changed Type" = Table.TransformColumnTypes(Source,{${changes}})`,
    'in',
    '    #"Changed Type"'
  ].join('\n')
}

/** Parse an Enter-data M expression back (for "Edit" of the table). null when it isn't one. */
export function parseEnterDataM(m: string): { columns: EnterDataColumn[]; rows: Array<Array<string | null>> } | null {
  const src = /Binary\.FromText\("([A-Za-z0-9+/=]*)",\s*BinaryEncoding\.Base64\)/.exec(m)
  const tt = /in\s+type\s+table\s+\[(.*?)\]\s*\)/s.exec(m)
  if (!src || !tt) return null
  const names: string[] = []
  const fieldRe = /\s*(#"((?:[^"]|"")*)"|[A-Za-z_][A-Za-z0-9_.]*)\s*=\s*_t\s*,?/gy
  let fm: RegExpExecArray | null
  while ((fm = fieldRe.exec(tt[1]))) names.push(fm[2] !== undefined ? fm[2].replace(/""/g, '"') : fm[1])
  const typeMap = new Map<string, EnterDataType>()
  const change = /Table\.TransformColumnTypes\(\s*Source\s*,\s*\{(.*)\}\s*\)/s.exec(m)
  if (change) {
    const pairRe = /\{\s*"((?:[^"]|"")*)"\s*,\s*(Int64\.Type|type text|type number|type date|type datetime|type logical|Currency\.Type|Percentage\.Type)\s*\}/g
    let pm: RegExpExecArray | null
    while ((pm = pairRe.exec(change[1]))) {
      const t = pm[2]
      const ty: EnterDataType = t === 'Int64.Type' ? 'int64' : t === 'type text' ? 'text' : t === 'type date' ? 'date' : t === 'type datetime' ? 'datetime' : t === 'type logical' ? 'logical' : 'number'
      typeMap.set(pm[1].replace(/""/g, '"'), ty)
    }
  }
  const rows = decodeEnterDataPayload(src[1])
  return { columns: names.map((name) => ({ name, type: typeMap.get(name) ?? 'text' })), rows }
}

export function isEnterDataPartition(p: PartitionDef | undefined): boolean {
  return !!p && p.sourceType === 'm' && !!p.expression && /Table\.FromRows\(Json\.Document\(Binary\.Decompress\(Binary\.FromText\(/.test(p.expression)
}

function convert(v: string | null, type: EnterDataType): Scalar {
  if (v === null || v.trim() === '') return null
  const s = v.trim()
  switch (type) {
    case 'int64':
    case 'number': {
      const n = Number(s)
      return Number.isFinite(n) ? n : null
    }
    case 'logical':
      return /^true$/i.test(s) ? true : /^false$/i.test(s) ? false : null
    case 'date':
    case 'datetime': {
      let m = RE_DATETIME.exec(s)
      if (m) return makeDate(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0))
      m = RE_DATE.exec(s)
      if (m) return makeDate(+m[1], +m[2], +m[3])
      m = RE_US_DATE.exec(s)
      if (m) return makeDate(+m[3], +m[1], +m[2])
      return null
    }
    default:
      return v
  }
}

/** Build the model table + its loaded data for an Enter-data table. */
export function buildEnterDataTable(tableName: string, columns: EnterDataColumn[], rawRows: Array<Array<string | null>>, lineageTag: string = crypto.randomUUID()): { table: TableDef; data: TableData } {
  const rows = normalizeRows(columns, rawRows)
  const types = resolveTypes(columns, rows)
  const cols: ColumnDef[] = columns.map((c, i) => {
    const dt = MODEL_TYPE[types[i]]
    const numeric = dt === 'int64' || dt === 'double'
    return {
      name: c.name,
      dataType: dt,
      kind: 'data',
      sourceColumn: c.name,
      lineageTag: crypto.randomUUID(),
      summarizeBy: numeric ? 'sum' : 'none',
      ...(types[i] === 'int64' ? { formatString: '0' } : types[i] === 'date' ? { formatString: 'Short Date' } : types[i] === 'datetime' ? { formatString: 'General Date' } : {}),
      annotations: { SummarizationSetBy: 'Automatic', ...(types[i] === 'number' ? { PBI_FormatHint: '{"isGeneralNumber":true}' } : {}) }
    }
  })
  const table: TableDef = {
    name: tableName,
    lineageTag,
    columns: cols,
    measures: [],
    hierarchies: [],
    partitions: [{ name: tableName, mode: 'import', sourceType: 'm', expression: buildEnterDataM(columns, rows) }],
    annotations: { PBI_ResultType: 'Table' }
  }
  const data: TableData = {
    rowCount: rows.length,
    columns: columns.map((c, i) => ({ name: c.name, type: MODEL_TYPE[types[i]], values: rows.map((r) => convert(r[i], types[i])) }))
  }
  return { table, data }
}
