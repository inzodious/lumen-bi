/**
 * Enter data (Home ▸ Enter data / New Source ▸ Enter data), written exactly like Power BI Desktop:
 *
 *   Source = Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText("<base64>", BinaryEncoding.Base64),
 *     Compression.Deflate)), let _t = ((type nullable text) meta [Serialized.Text = true]) in type table [A = _t, #"B c" = _t])
 *
 * The base64 payload is the raw DEFLATE of the rows serialised as JSON (an array of arrays of
 * strings — every cell is text, typed later by a "Changed Type" step). `parseEnterData` reads such a
 * step back so the Create Table dialog can edit it (Applied Steps gear).
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import { mText, mIdent } from './mtext'
import { tokenize } from '@core/m/lexer.ts'
import { detectType, changeType } from './transforms'

export interface EnterDataTable {
  columns: string[]
  /** cell texts, row-major; every row has `columns.length` cells */
  rows: string[][]
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Field name in a record type: plain identifier or `#"…"`. */
function typeField(name: string): string {
  return mIdent(name)
}

/** Rows without fully empty trailing rows; ragged rows padded with "". */
export function normalizeTable(t: EnterDataTable): EnterDataTable {
  const n = t.columns.length
  const rows = t.rows.map((r) => Array.from({ length: n }, (_, i) => r[i] ?? ''))
  while (rows.length && rows[rows.length - 1]!.every((c) => c === '')) rows.pop()
  return { columns: t.columns, rows }
}

/** The compressed payload PBI embeds (raw deflate of the JSON rows, base64). */
export function encodeRows(rows: string[][]): string {
  return toBase64(deflateSync(strToU8(JSON.stringify(rows))))
}

export function decodeRows(base64: string): string[][] | null {
  try {
    const v = JSON.parse(strFromU8(inflateSync(fromBase64(base64)))) as unknown
    if (!Array.isArray(v)) return null
    return v.map((r) => (Array.isArray(r) ? r.map((c) => (c === null || c === undefined ? '' : String(c))) : []))
  } catch {
    return null
  }
}

/** The Source step formula of an Enter data query. */
export function enterDataFormula(table: EnterDataTable): string {
  const t = normalizeTable(table)
  const fields = t.columns.map((c) => `${typeField(c)} = _t`).join(', ')
  return `Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText(${mText(encodeRows(t.rows))}, BinaryEncoding.Base64), Compression.Deflate)), let _t = ((type nullable text) meta [Serialized.Text = true]) in type table [${fields}])`
}

/**
 * The whole query PBI creates: Source + "Changed Type" (types detected from the entered values,
 * like PBI's "Detect column types" default).
 */
export function enterDataQuery(table: EnterDataTable): string {
  const t = normalizeTable(table)
  const source = enterDataFormula(t)
  const types = t.columns.map((c, i) => ({ name: c, type: detectType(t.rows.map((r) => r[i]).filter((v) => v !== ''), 'any') }))
  const changed = changeType(types).formula('Source')
  return `let\n    Source = ${source},\n    #"Changed Type" = ${changed}\nin\n    #"Changed Type"`
}

/** Is this step formula (or query text) an Enter data table? */
export function isEnterData(formula: string): boolean {
  return /Table\.FromRows\s*\(\s*Json\.Document\s*\(\s*Binary\.Decompress\s*\(\s*Binary\.FromText\s*\(/.test(formula)
}

/** Reads an Enter data step (or a query containing one) back into columns + rows; null otherwise. */
export function parseEnterData(formula: string): EnterDataTable | null {
  if (!isEnterData(formula)) return null
  const b64 = /Binary\.FromText\s*\(\s*"([A-Za-z0-9+/=\s]*)"/.exec(formula)
  if (!b64) return null
  const rows = decodeRows(b64[1]!.replace(/\s+/g, ''))
  if (!rows) return null
  const typeAt = formula.search(/\btype\s+table\s*\[/)
  if (typeAt < 0) return null
  let tokens
  try {
    tokens = tokenize(formula.slice(typeAt))
  } catch {
    return null
  }
  const columns: string[] = []
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.kind === 'op' && t.value === '[') depth++
    else if (t.kind === 'op' && t.value === ']') {
      depth--
      if (depth === 0) break
    } else if (depth === 1 && (t.kind === 'ident' || t.kind === 'quoted' || t.kind === 'keyword') && tokens[i + 1]?.value === '=') columns.push(t.value)
  }
  const n = Math.max(columns.length, ...rows.map((r) => r.length), 0)
  for (let i = columns.length; i < n; i++) columns.push(`Column${i + 1}`)
  return { columns, rows: rows.map((r) => Array.from({ length: n }, (_, i) => r[i] ?? '')) }
}
