/**
 * Raw-file serialisers: bronze CSV / JSON / NDJSON / XLSX and plain CSV exports of TableData.
 * XLSX is written as minimal SpreadsheetML zipped with fflate using a fixed mtime so output stays
 * byte-identical across runs (exceljs stamps creation times into the archive).
 */
import { strToU8, zipSync } from 'fflate'
import type { Scalar, TableData } from '../../../src/core/model/data.ts'
import { fileColumns, formatDate } from '../core/chaos.ts'
import type { BronzeFile, BronzeValue } from '../core/schema.ts'

function bronzeText(v: BronzeValue | undefined, nullAs: string): string {
  if (v === null || v === undefined) return nullAs
  if (v instanceof Date) return formatDate(v, 'iso')
  if (typeof v === 'object') return JSON.stringify(v, jsonReplacer)
  return String(v)
}

function jsonReplacer(_k: string, v: unknown): unknown {
  return v
}

function csvCell(text: string, delimiter: string, quoteAll: boolean): string {
  if (quoteAll || text.includes(delimiter) || text.includes('"') || text.includes('\n') || text.includes('\r')) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function bronzeCsv(f: BronzeFile): string {
  const o = f.csv ?? {}
  const d = o.delimiter ?? ','
  const eol = o.lineEnding ?? '\n'
  const cols = fileColumns(f)
  const lines = [cols.map((c) => csvCell(c, d, !!o.quoteAll)).join(d)]
  for (const r of f.rows) lines.push(cols.map((c) => csvCell(bronzeText(r[c], o.nullAs ?? ''), d, !!o.quoteAll)).join(d))
  return (o.bom ? '﻿' : '') + lines.join(eol) + eol
}

function toJsonValue(v: BronzeValue | undefined): unknown {
  if (v === undefined) return null
  if (v instanceof Date) {
    const hasTime = v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds()
    return hasTime ? v.toISOString().replace('.000Z', 'Z') : v.toISOString().slice(0, 10)
  }
  if (Array.isArray(v)) return v.map(toJsonValue)
  if (v !== null && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) o[k] = toJsonValue(x)
    return o
  }
  return v
}

export function bronzeJson(f: BronzeFile): string {
  const rows = f.rows.map((r) => toJsonValue(r))
  if (f.format === 'ndjson') return rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
  const o = f.json ?? {}
  const body = o.envelope ? { ...(toJsonValue(o.envelope) as Record<string, unknown>), [o.dataKey ?? 'data']: rows } : rows
  return JSON.stringify(body, null, o.pretty === false ? undefined : 2) + '\n'
}

// ---------------------------------------------------------------------------------------------
// XLSX (minimal SpreadsheetML)

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function colLetter(i: number): string {
  let s = ''
  let n = i + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

function cellXml(ref: string, v: BronzeValue | undefined): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`
  if (v instanceof Date) {
    const serial = (v.getTime() - EXCEL_EPOCH) / 86_400_000
    return `<c r="${ref}" s="1"><v>${serial}</v></c>`
  }
  const text = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`
}

/** Build an .xlsx with one sheet: optional title lines, a header row, then rows. Dates use yyyy-mm-dd. */
export function bronzeXlsx(f: BronzeFile): Uint8Array {
  const cols = fileColumns(f)
  const sheet = f.xlsx?.sheet ?? 'Sheet1'
  const rowsXml: string[] = []
  let r = 1
  for (const line of f.xlsx?.titleLines ?? []) rowsXml.push(`<row r="${r}">${cellXml(`A${r++}`, line)}</row>`)
  rowsXml.push(`<row r="${r}">${cols.map((c, i) => cellXml(`${colLetter(i)}${r}`, c)).join('')}</row>`)
  r++
  for (const row of f.rows) {
    rowsXml.push(`<row r="${r}">${cols.map((c, i) => cellXml(`${colLetter(i)}${r}`, row[c])).join('')}</row>`)
    r++
  }
  const files: Record<string, string> = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml.join('')}</sheetData></worksheet>`
  }
  const mtime = new Date(Date.UTC(2000, 0, 1))
  const zipInput: Record<string, [Uint8Array, { mtime: Date }]> = {}
  for (const [p, text] of Object.entries(files)) zipInput[p] = [strToU8(text), { mtime }]
  return zipSync(zipInput, { level: 6 })
}

export function bronzeBytes(f: BronzeFile): Uint8Array | string {
  switch (f.format) {
    case 'csv':
      return bronzeCsv(f)
    case 'json':
    case 'ndjson':
      return bronzeJson(f)
    case 'xlsx':
      return bronzeXlsx(f)
  }
}

// ---------------------------------------------------------------------------------------------
// Clean CSV export of silver/gold tables

function exportText(v: Scalar, kind: string): string {
  if (v === null) return ''
  if (v instanceof Date) return kind === 'date' ? v.toISOString().slice(0, 10) : v.toISOString().slice(0, 19).replace('T', ' ')
  if (v instanceof Uint8Array) return ''
  return String(v)
}

export function tableCsv(table: TableData, kinds: string[], withHeader: boolean): string {
  const lines: string[] = []
  if (withHeader) lines.push(table.columns.map((c) => csvCell(c.name, ',', false)).join(','))
  for (let r = 0; r < table.rowCount; r++) {
    lines.push(table.columns.map((c, i) => csvCell(exportText(c.values[r], kinds[i]), ',', false)).join(','))
  }
  return lines.length ? lines.join('\n') + '\n' : ''
}
