/**
 * Power Query M generation for Get data, following the shapes Power BI Desktop writes so the
 * partitions round-trip and the M engine (Power Query editor / refresh) can evaluate them.
 */
import { deflateSync } from 'fflate'
import type { DataType } from '@core/model/types'

/** M text literal. */
export function mString(s: string): string {
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, '#(lf)').replace(/\t/g, '#(tab)')}"`
}

const KEYWORDS = new Set(['and', 'as', 'each', 'else', 'error', 'false', 'if', 'in', 'is', 'let', 'meta', 'not', 'null', 'or', 'otherwise', 'section', 'shared', 'then', 'true', 'try', 'type'])

/** M identifier (quoted `#"..."` when needed). */
export function mIdent(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !KEYWORDS.has(name) && !name.endsWith('.') ? name : `#${mString(name)}`
}

/** M type for a column data type, as PBI writes in Table.TransformColumnTypes. */
export function mTypeOf(t: DataType, opts: { dateOnly?: boolean } = {}): string {
  switch (t) {
    case 'int64':
      return 'Int64.Type'
    case 'double':
      return 'type number'
    case 'decimal':
      return 'Currency.Type'
    case 'boolean':
      return 'type logical'
    case 'dateTime':
      return opts.dateOnly ? 'type date' : 'type datetime'
    case 'binary':
      return 'type binary'
    default:
      return 'type text'
  }
}

export interface MColumn {
  name: string
  type: DataType
  dateOnly?: boolean
}

function changedType(prev: string, cols: MColumn[]): string {
  return `Table.TransformColumnTypes(${mIdent(prev)},{${cols.map((c) => `{${mString(c.name)}, ${mTypeOf(c.type, { dateOnly: c.dateOnly })}}`).join(', ')}})`
}

/** let … in … with PBI's 4-space indentation. */
export function letExpr(steps: Array<[string, string]>): string {
  return `let\n${steps.map(([n, e], i) => `    ${mIdent(n)} = ${e}${i < steps.length - 1 ? ',' : ''}`).join('\n')}\nin\n    ${mIdent(steps[steps.length - 1][0])}`
}

function withTypes(steps: Array<[string, string]>, cols: MColumn[]): string {
  if (cols.length) steps.push(['Changed Type', changedType(steps[steps.length - 1][0], cols)])
  return letExpr(steps)
}

function delimiterLiteral(d: string): string {
  return d === '\t' ? '"#(tab)"' : mString(d)
}

export function csvM(source: string, cols: MColumn[], opts: { delimiter: string; promoted: boolean; web?: boolean }): string {
  const content = opts.web ? `Web.Contents(${mString(source)})` : `File.Contents(${mString(source)})`
  const steps: Array<[string, string]> = [['Source', `Csv.Document(${content},[Delimiter=${delimiterLiteral(opts.delimiter)}, Columns=${cols.length}, Encoding=65001, QuoteStyle=QuoteStyle.Csv])`]]
  if (opts.promoted) steps.push(['Promoted Headers', 'Table.PromoteHeaders(Source, [PromoteAllScalars=true])'])
  return withTypes(steps, cols)
}

export function excelM(path: string, item: { name: string; kind: 'Sheet' | 'Table' }, cols: MColumn[], opts: { promoted: boolean }): string {
  const nav = `${item.name}_${item.kind}`
  const steps: Array<[string, string]> = [
    ['Source', `Excel.Workbook(File.Contents(${mString(path)}), null, true)`],
    [nav, `Source{[Item=${mString(item.name)},Kind=${mString(item.kind)}]}[Data]`]
  ]
  if (opts.promoted && item.kind === 'Sheet') steps.push(['Promoted Headers', `Table.PromoteHeaders(${mIdent(nav)}, [PromoteAllScalars=true])`])
  return withTypes(steps, cols)
}

export function jsonM(source: string, cols: MColumn[], opts: { shape: 'records' | 'columns' | 'rows' | 'values'; web?: boolean }): string {
  const content = opts.web ? `Web.Contents(${mString(source)})` : `File.Contents(${mString(source)})`
  const steps: Array<[string, string]> = [['Source', `Json.Document(${content})`]]
  if (opts.shape === 'records') steps.push(['Converted to Table', 'Table.FromRecords(Source)'])
  else if (opts.shape === 'columns') steps.push(['Converted to Table', 'Table.FromColumns(Record.FieldValues(Source), Record.FieldNames(Source))'])
  else if (opts.shape === 'rows') steps.push(['Converted to Table', 'Table.FromRows(Source)'])
  else steps.push(['Converted to Table', 'Table.FromList(Source, Splitter.SplitByNothing(), {"Value"}, null, ExtraValues.Error)'])
  return withTypes(steps, cols)
}

/** Parquet carries its own column types, so no Changed Type step (as PBI generates). */
export function parquetM(path: string): string {
  return letExpr([['Source', `Parquet.Document(File.Contents(${mString(path)}))`]])
}

export function folderM(path: string): string {
  return letExpr([['Source', `Folder.Files(${mString(path)})`]])
}

export function sqlM(server: string, database: string, opts: { schema?: string; item?: string; query?: string }): string {
  if (opts.query) return letExpr([['Source', `Sql.Database(${mString(server)}, ${mString(database)}, [Query=${mString(opts.query)}])`]])
  const nav = `${opts.schema ?? 'dbo'}_${opts.item ?? ''}`
  return letExpr([
    ['Source', `Sql.Database(${mString(server)}, ${mString(database)})`],
    [nav, `Source{[Schema=${mString(opts.schema ?? 'dbo')},Item=${mString(opts.item ?? '')}]}[Data]`]
  ])
}

export function blankQueryM(): string {
  return letExpr([['Source', '""']])
}

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** PBI "Enter data" M: rows serialized as JSON, raw-deflated, base64 — every column typed text then converted. */
export function enterDataM(columns: MColumn[], rows: string[][]): string {
  const json = JSON.stringify(rows.map((r) => columns.map((_, i) => r[i] ?? '')))
  const payload = base64(deflateSync(new TextEncoder().encode(json)))
  const typeRow = columns.map((c) => `${mIdent(c.name)} = _t`).join(', ')
  const steps: Array<[string, string]> = [
    ['Source', `Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText(${mString(payload)}, BinaryEncoding.Base64), Compression.Deflate)), let _t = ((type nullable text) meta [Serialized.Text = true]) in type table [${typeRow}])`]
  ]
  return withTypes(steps, columns)
}
