/**
 * Visual data export builders (PBI "Export data"): CSV (RFC 4180) and XLSX (exceljs).
 * Values follow the DataStore contract: dates are JS Dates whose UTC fields carry the wall clock.
 */
import type { Scalar } from '@core/model/data'

export interface TabularData {
  columns: string[]
  rows: Scalar[][]
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0')
}

/** ISO date (YYYY-MM-DD) or date-time (YYYY-MM-DDTHH:MM:SS) using the UTC (= naive) fields. */
export function isoDate(d: Date): string {
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  if (!d.getUTCHours() && !d.getUTCMinutes() && !d.getUTCSeconds() && !d.getUTCMilliseconds()) return date
  return `${date}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

function csvCell(v: Scalar, delimiter: string): string {
  let s: string
  if (v === null || v === undefined) return ''
  if (v instanceof Date) s = isoDate(v)
  else if (typeof v === 'boolean') s = v ? 'True' : 'False'
  else if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : ''
  else if (v instanceof Uint8Array) s = ''
  else s = String(v)
  return s.includes('"') || s.includes(delimiter) || s.includes('\n') || s.includes('\r') ? `"${s.replace(/"/g, '""')}"` : s
}

/** RFC 4180 CSV with CRLF line endings. `bom` prepends a UTF-8 BOM so Excel detects the encoding (PBI does). */
export function toCsv(data: TabularData, opts: { bom?: boolean; delimiter?: string } = {}): string {
  const d = opts.delimiter ?? ','
  const lines = [data.columns.map((c) => csvCell(c, d)).join(d), ...data.rows.map((r) => data.columns.map((_, i) => csvCell(r[i] ?? null, d)).join(d))]
  return (opts.bom ? '﻿' : '') + lines.join('\r\n') + '\r\n'
}

type ColKind = 'int' | 'number' | 'date' | 'datetime' | 'bool' | 'text'

function columnKind(rows: Scalar[][], i: number): ColKind {
  let kind: ColKind | null = null
  for (const r of rows) {
    const v = r[i]
    if (v === null || v === undefined) continue
    let k: ColKind
    if (typeof v === 'number') k = Number.isInteger(v) ? 'int' : 'number'
    else if (v instanceof Date) k = v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds() ? 'datetime' : 'date'
    else if (typeof v === 'boolean') k = 'bool'
    else return 'text'
    if (!kind) kind = k
    else if (kind !== k) {
      if ((kind === 'int' && k === 'number') || (kind === 'number' && k === 'int')) kind = 'number'
      else if ((kind === 'date' && k === 'datetime') || (kind === 'datetime' && k === 'date')) kind = 'datetime'
      else return 'text'
    }
  }
  return kind ?? 'text'
}

const NUM_FMT: Record<ColKind, string | undefined> = {
  int: '#,##0',
  number: '#,##0.00',
  date: 'yyyy-mm-dd',
  datetime: 'yyyy-mm-dd hh:mm:ss',
  bool: undefined,
  text: undefined
}

/** XLSX workbook with one sheet: bold header row, typed cells, number formats, autofilter, column widths, frozen header. */
export async function buildXlsx(data: TabularData, opts: { sheetName?: string; title?: string } = {}): Promise<Uint8Array> {
  const mod: any = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Lumen'
  wb.created = new Date()
  const sheetName = (opts.sheetName ?? 'Export').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Export'
  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] })
  const kinds = data.columns.map((_, i) => columnKind(data.rows, i))
  ws.columns = data.columns.map((c, i) => {
    const sample = data.rows.slice(0, 200).map((r) => {
      const v = r[i]
      return v instanceof Date ? 10 : v === null || v === undefined ? 0 : String(v).length
    })
    const width = Math.min(60, Math.max(8, String(c).length + 2, ...sample.map((n) => n + 2)))
    return { header: c, key: `c${i}`, width, style: NUM_FMT[kinds[i]] ? { numFmt: NUM_FMT[kinds[i]] } : {} }
  })
  for (const r of data.rows) {
    ws.addRow(data.columns.map((_, i) => {
      const v = r[i]
      if (v === undefined || v === null || v instanceof Uint8Array) return null
      return v
    }))
  }
  const header = ws.getRow(1)
  header.font = { bold: true }
  header.alignment = { vertical: 'middle' }
  if (data.columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, data.rows.length + 1), column: data.columns.length } }
  const buf = await wb.xlsx.writeBuffer()
  return buf instanceof Uint8Array ? new Uint8Array(buf) : new Uint8Array(buf as ArrayBuffer)
}
