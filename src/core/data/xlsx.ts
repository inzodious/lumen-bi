/**
 * .xlsx decoding for `Excel.Workbook` (via exceljs). Produces the M host's `WorkbookData`: every sheet
 * as a raw cell grid over its used range (like Power Query, leading empty rows/columns are skipped),
 * Excel tables (header + body rows) and defined names that refer to a single range.
 * Cells with formulas yield their cached result (Power Query never recalculates).
 */
import type { WorkbookCell, WorkbookData } from '../m/host.ts'

type Cell = unknown

const p2 = (n: number) => String(n).padStart(2, '0')

function dateCell(d: Date): WorkbookCell {
  if (Number.isNaN(d.getTime())) return null
  const y = d.getUTCFullYear()
  const date = `${String(y).padStart(4, '0')}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
  const time = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`
  // Excel stores a time-only value as a fraction of day 0 (1899-12-30/31)
  if (y < 1900) return { $time: time }
  if (time === '00:00:00' && d.getUTCMilliseconds() === 0) return { $date: date }
  return { $datetime: `${date} ${time}` }
}

function cellValue(v: Cell): WorkbookCell {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return dateCell(v)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('result' in o) return cellValue(o.result)
    if ('formula' in o || 'sharedFormula' in o) return null
    if (Array.isArray(o.richText)) return (o.richText as Array<{ text: string }>).map((r) => r.text).join('')
    if ('text' in o) return cellValue(o.text)
    if ('error' in o) return `#${String(o.error).replace(/^#/, '')}`
  }
  return String(v)
}

interface Sheet {
  name: string
  state?: string
  rowCount: number
  columnCount: number
  getCell(r: number, c: number): { value: Cell }
  getRow(r: number): { getCell(c: number): { value: Cell } }
  tables?: Record<string, { table?: TableModel; model?: TableModel }>
}

interface TableModel {
  name: string
  ref?: string
  tableRef?: string
  headerRow?: boolean
  totalsRow?: boolean
  columns?: Array<{ name: string }>
}

function colIndex(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

function parseRange(ref: string): { r1: number; c1: number; r2: number; c2: number } | null {
  const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i.exec(ref.trim())
  if (!m) return null
  const c1 = colIndex(m[1]!)
  const r1 = Number(m[2])
  return { r1, c1, r2: m[4] ? Number(m[4]) : r1, c2: m[3] ? colIndex(m[3]) : c1 }
}

function grid(ws: Sheet, r1: number, c1: number, r2: number, c2: number): WorkbookCell[][] {
  const out: WorkbookCell[][] = []
  for (let r = r1; r <= r2; r++) {
    const row = ws.getRow(r)
    const vals: WorkbookCell[] = []
    for (let c = c1; c <= c2; c++) vals.push(cellValue(row.getCell(c).value))
    out.push(vals)
  }
  return out
}

function usedRange(ws: Sheet): { r1: number; c1: number; r2: number; c2: number } | null {
  let r1 = Infinity
  let c1 = Infinity
  let r2 = 0
  let c2 = 0
  // exceljs computes `columnCount` by walking every row: read it (and rowCount) once, not per cell
  // (per-cell reads made decoding quadratic: minutes for a 60,000-row sheet)
  const rowCount = ws.rowCount
  const columnCount = ws.columnCount
  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r)
    for (let c = 1; c <= columnCount; c++) {
      const v = cellValue(row.getCell(c).value)
      if (v === null || v === '') continue
      if (r < r1) r1 = r
      if (c < c1) c1 = c
      if (r > r2) r2 = r
      if (c > c2) c2 = c
    }
  }
  return r2 ? { r1, c1, r2, c2 } : null
}

export async function decodeXlsx(bytes: Uint8Array): Promise<WorkbookData> {
  const mod = (await import('exceljs')) as unknown as { default?: { Workbook: new () => unknown }; Workbook?: new () => unknown }
  const Workbook = (mod.Workbook ?? mod.default?.Workbook)!
  const wb = new Workbook() as { xlsx: { load(data: ArrayBuffer): Promise<unknown> }; worksheets: Sheet[]; definedNames?: { model?: Array<{ name: string; ranges: string[] }> } }
  const buf = bytes.slice().buffer as ArrayBuffer
  try {
    await wb.xlsx.load(buf)
  } catch (e) {
    throw new Error(`External table is not in the expected format. (${e instanceof Error ? e.message : String(e)})`)
  }
  const data: WorkbookData = { sheets: [], tables: [], definedNames: [] }
  for (const ws of wb.worksheets) {
    const range = usedRange(ws)
    data.sheets!.push({ name: ws.name, hidden: ws.state === 'hidden' || ws.state === 'veryHidden', rows: range ? grid(ws, range.r1, range.c1, range.r2, range.c2) : [] })
    for (const t of Object.values(ws.tables ?? {})) {
      const m = t.table ?? t.model
      if (!m) continue
      const range2 = parseRange(m.tableRef ?? m.ref ?? '')
      if (!range2) continue
      const cells = grid(ws, range2.r1, range2.c1, range2.r2, range2.c2)
      const header = m.headerRow === false ? null : cells.shift()
      if (m.totalsRow) cells.pop()
      const columns = m.columns?.length ? m.columns.map((c) => c.name) : (header ?? []).map((h, i) => (h === null ? `Column${i + 1}` : String(h)))
      data.tables!.push({ name: m.name, columns, rows: cells })
    }
  }
  for (const dn of wb.definedNames?.model ?? []) {
    if (dn.ranges.length !== 1 || dn.name.startsWith('_xlnm.')) continue
    const m = /^'?(.+?)'?!(.+)$/.exec(dn.ranges[0]!)
    const ws = m && wb.worksheets.find((s) => s.name === m[1])
    const r = m && parseRange(m[2]!)
    if (ws && r) data.definedNames!.push({ name: dn.name, rows: grid(ws, r.r1, r.c1, r.r2, r.c2) })
  }
  return data
}
