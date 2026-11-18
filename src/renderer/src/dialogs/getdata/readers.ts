/**
 * Source readers producing Navigator items: each item has a preview table, the M expression that
 * PBI would generate, and the full data to load directly.
 */
import type { DataType } from '@core/model/types'
import { basename } from '@core/io/fs'
import { csvM, excelM, folderM, jsonM, parquetM, sqlM, type MColumn } from './mcode'
import { decodeText, looksLikeHeader, parseCsv, sqlTypeToDataType, tabulateJson, toScalar, typeValueTable, uniqueHeaders, type ParsedTable } from './parsers'
import type { SqlAuth } from '@shared/host'

export interface NavItem {
  id: string
  label: string
  kind: 'sheet' | 'table' | 'file' | 'view' | 'folder' | 'query'
  /** tree group header (e.g. workbook name / schema) */
  group?: string
  /** full data (file sources) — or loaded lazily (SQL) */
  data?: ParsedTable
  load?(): Promise<ParsedTable>
  /** every row, for Load (connectors evaluated as M; `load` is then the preview) */
  full?(): Promise<ParsedTable>
  /** M for the partition given the final columns */
  m(columns: MColumn[]): string
  mode?: 'import' | 'directQuery'
  /** default table name */
  tableName: string
}

export function mColumns(t: ParsedTable): MColumn[] {
  return t.columns.map((name, i) => ({
    name,
    type: t.types[i],
    dateOnly: t.types[i] === 'dateTime' && t.rows.slice(0, 2000).every((r) => !(r[i] instanceof Date) || !((r[i] as Date).getUTCHours() || (r[i] as Date).getUTCMinutes() || (r[i] as Date).getUTCSeconds()))
  }))
}

const stem = (p: string) => basename(p).replace(/\.[^.]+$/, '')

export function csvItems(path: string, bytes: Uint8Array, web = false): NavItem[] {
  const parsed = parseCsv(decodeText(bytes))
  return [
    {
      id: path,
      label: web ? path : basename(path),
      kind: 'file',
      data: parsed,
      tableName: web ? stem(path.split('?')[0]) || 'Table' : stem(path),
      m: (cols) => csvM(path, cols, { delimiter: parsed.delimiter, promoted: parsed.promoted, web })
    }
  ]
}

export function jsonItems(path: string, bytes: Uint8Array, web = false): NavItem[] {
  const doc = JSON.parse(decodeText(bytes))
  const t = tabulateJson(doc)
  if (!t) throw new Error("The JSON document doesn't contain a table (expected an array of records, a record of arrays, or an array of arrays).")
  return [{ id: path, label: web ? path : basename(path), kind: 'file', data: t, tableName: web ? stem(path.split('?')[0]) || 'Table' : stem(path), m: (cols) => jsonM(path, cols, { shape: t.shape, web }) }]
}

function excelCell(v: any): unknown {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  if (typeof v !== 'object') return v
  if ('result' in v) return excelCell(v.result)
  if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join('')
  if ('text' in v) return v.text
  if ('error' in v) return null
  if ('sharedFormula' in v || 'formula' in v) return null
  return String(v)
}

function sheetTable(rows: unknown[][]): { table: ParsedTable; promoted: boolean } {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0)
  const norm = rows.map((r) => Array.from({ length: width }, (_, i) => toScalar(r[i])))
  const promoted = looksLikeHeader(norm.slice(0, 60))
  const headers = promoted ? uniqueHeaders(norm[0]) : Array.from({ length: width }, (_, i) => `Column${i + 1}`)
  return { table: typeValueTable(headers, promoted ? norm.slice(1) : norm), promoted }
}

function a1ToRC(a1: string): { r: number; c: number } {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(a1.trim())
  if (!m) return { r: 1, c: 1 }
  let c = 0
  for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64)
  return { r: Number(m[2]), c }
}

export async function excelItems(path: string, bytes: Uint8Array): Promise<NavItem[]> {
  const mod: any = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  const items: NavItem[] = []
  const group = basename(path)
  wb.eachSheet((ws: any) => {
    const grid: unknown[][] = []
    ws.eachRow({ includeEmpty: true }, (row: any, rowNumber: number) => {
      const vals: unknown[] = Array.isArray(row.values) ? row.values.slice(1) : []
      grid[rowNumber - 1] = vals.map(excelCell)
    })
    const rows = Array.from({ length: grid.length }, (_, i) => grid[i] ?? [])
    // Excel tables on this sheet
    let tables: any[] = []
    try {
      tables = typeof ws.getTables === 'function' ? ws.getTables() : Object.values(ws.tables ?? {})
    } catch {
      tables = []
    }
    for (const entry of tables) {
      const tbl = entry?.table ?? entry
      const name: string | undefined = tbl?.name ?? tbl?.displayName
      const ref: string | undefined = tbl?.tableRef ?? tbl?.ref
      if (!name || !ref) continue
      const [a, b] = ref.split(':')
      const s = a1ToRC(a)
      const e = a1ToRC(b ?? a)
      const slice = rows.slice(s.r - 1, e.r).map((r) => r.slice(s.c - 1, e.c))
      const headers = uniqueHeaders(slice[0]?.map((v) => toScalar(v)) ?? [])
      const table = typeValueTable(headers, slice.slice(1))
      items.push({ id: `table:${name}`, label: name, kind: 'table', group, data: table, tableName: name, m: (cols) => excelM(path, { name, kind: 'Table' }, cols, { promoted: false }) })
    }
    // trim fully empty leading rows like Excel.Workbook's used range
    let first = 0
    while (first < rows.length && rows[first].every((v) => v === null || v === undefined || v === '')) first++
    const used = rows.slice(first)
    if (!used.length) return
    const { table, promoted } = sheetTable(used)
    const name: string = ws.name
    items.push({ id: `sheet:${name}`, label: name, kind: 'sheet', group, data: table, tableName: name, m: (cols) => excelM(path, { name, kind: 'Sheet' }, cols, { promoted }) })
  })
  // PBI lists tables before sheets
  return items.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'table' ? -1 : 1))
}

export async function parquetItems(path: string, bytes: Uint8Array): Promise<NavItem[]> {
  const { parquetReadObjects, parquetMetadata, parquetSchema } = await import('hyparquet')
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const meta = parquetMetadata(buf)
  const schema = parquetSchema(meta)
  const columns: string[] = schema.children.map((c: any) => c.element.name)
  const objects: Array<Record<string, unknown>> = await parquetReadObjects({ file: buf })
  const table = typeValueTable(columns, objects.map((o) => columns.map((c) => o[c])))
  return [{ id: path, label: basename(path), kind: 'file', data: table, tableName: stem(path), m: () => parquetM(path) }]
}

export async function folderItems(dir: string): Promise<NavItem[]> {
  const entries = await window.wbi.fs.list(dir)
  const files = entries.filter((e) => !e.isDirectory)
  const rows = files.map((f) => {
    const dot = f.name.lastIndexOf('.')
    const mtime = new Date(f.mtime)
    // Folder.Files returns local wall-clock times: encode as UTC-naive
    const naive = new Date(Date.UTC(mtime.getFullYear(), mtime.getMonth(), mtime.getDate(), mtime.getHours(), mtime.getMinutes(), mtime.getSeconds()))
    return [f.name, dot > 0 ? f.name.slice(dot).toLowerCase() : '', naive, `${dir.replace(/\/$/, '')}/`, f.size]
  })
  // Content (binary) and Attributes (record) columns of Folder.Files are not materialized in the preview
  const table: ParsedTable = { columns: ['Name', 'Extension', 'Date modified', 'Folder Path', 'Size'], types: ['string', 'string', 'dateTime', 'string', 'int64'] as DataType[], rows }
  return [{ id: dir, label: basename(dir), kind: 'folder', data: table, tableName: basename(dir) || 'Folder', m: () => folderM(dir) }]
}

export interface SqlTarget {
  server: string
  database: string
  query?: string
  mode: 'import' | 'directQuery'
  auth: SqlAuth
}

function sqlResultTable(res: { columns: Array<{ name: string; type: string }>; rows: unknown[][] }, limit?: number): ParsedTable {
  const types = res.columns.map((c) => sqlTypeToDataType(c.type))
  const rows = (limit ? res.rows.slice(0, limit) : res.rows).map((r) => r.map((v) => toScalar(v)))
  return { columns: res.columns.map((c) => c.name), types, rows, truncated: !!limit && res.rows.length > limit }
}

export async function sqlItems(t: SqlTarget): Promise<NavItem[]> {
  const base = { server: t.server, database: t.database, auth: t.auth }
  if (t.query) {
    const preview = async () => sqlResultTable(await window.wbi.connectors.sqlQuery({ ...base, query: t.query, maxRows: 50 }))
    return [{ id: 'query', label: 'Query1', kind: 'query', tableName: 'Query1', mode: t.mode, load: preview, m: () => sqlM(t.server, t.database, { query: t.query }) }]
  }
  const list = await window.wbi.connectors.sqlListItems(base)
  return list.map((it) => ({
    id: `${it.schema}.${it.item}`,
    label: `${it.schema}.${it.item}`,
    kind: it.kind === 'View' ? ('view' as const) : ('table' as const),
    group: t.database,
    tableName: it.item,
    mode: t.mode,
    load: async () => sqlResultTable(await window.wbi.connectors.sqlQuery({ ...base, schema: it.schema, item: it.item, maxRows: 50 })),
    m: () => sqlM(t.server, t.database, { schema: it.schema, item: it.item })
  }))
}

/** Full rows for an import-mode SQL item (Load). */
export async function sqlFullData(t: SqlTarget, item: NavItem): Promise<ParsedTable> {
  const base = { server: t.server, database: t.database, auth: t.auth, maxRows: 1_000_000 }
  if (item.kind === 'query') return sqlResultTable(await window.wbi.connectors.sqlQuery({ ...base, query: t.query }))
  const [schema, ...rest] = item.id.split('.')
  return sqlResultTable(await window.wbi.connectors.sqlQuery({ ...base, schema, item: rest.join('.') }))
}

/** Web.Contents: fetch then dispatch on content type / extension. */
export async function webItems(url: string): Promise<NavItem[]> {
  const res = await window.wbi.connectors.http({ url, timeoutMs: 60000 })
  if (res.status >= 400) throw new Error(`The server returned HTTP ${res.status}.`)
  const ct = (Object.entries(res.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '').toLowerCase()
  const path = url.split('?')[0].toLowerCase()
  if (ct.includes('json') || path.endsWith('.json')) return jsonItems(url, res.body, true)
  if (ct.includes('csv') || ct.includes('text/plain') || path.endsWith('.csv') || path.endsWith('.txt') || path.endsWith('.tsv')) return csvItems(url, res.body, true)
  if (ct.includes('html')) throw new Error('HTML pages (Web.Page tables) are not supported yet. Point the URL at a CSV or JSON resource.')
  // sniff
  const head = decodeText(res.body.subarray(0, 512)).trimStart()
  if (head.startsWith('{') || head.startsWith('[')) return jsonItems(url, res.body, true)
  return csvItems(url, res.body, true)
}
