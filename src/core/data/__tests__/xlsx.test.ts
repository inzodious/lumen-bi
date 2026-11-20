import { describe, expect, it } from 'vitest'
import { decodeXlsx } from '../xlsx'

/** Builds an .xlsx in memory with exceljs: one sheet holding an Excel table of `rows` x `cols` numbers. */
async function workbook(rows: number, cols: number): Promise<Uint8Array> {
  const mod = (await import('exceljs')) as unknown as { default?: { Workbook: new () => any }; Workbook?: new () => any }
  const Workbook = (mod.Workbook ?? mod.default?.Workbook)!
  const wb = new Workbook()
  const ws = wb.addWorksheet('Data')
  const columns = Array.from({ length: cols }, (_, i) => ({ name: `C${i + 1}` }))
  const data = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => r * cols + c))
  ws.addTable({ name: 'Big', ref: 'A1', headerRow: true, columns, rows: data })
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

describe('decodeXlsx', () => {
  it('reads the used range and the table of a large sheet in linear time', async () => {
    const bytes = await workbook(20000, 10)
    const t0 = performance.now()
    const data = await decodeXlsx(bytes)
    const ms = performance.now() - t0
    const table = data.tables!.find((t) => t.name === 'Big')!
    expect(table.columns).toEqual(Array.from({ length: 10 }, (_, i) => `C${i + 1}`))
    expect(table.rows.length).toBe(20000)
    expect(table.rows[19999]![9]).toBe(199999)
    const sheet = data.sheets!.find((s) => s.name === 'Data')!
    expect(sheet.rows.length).toBe(20001)
    // with per-cell columnCount reads this took minutes (columnCount walks every row)
    expect(ms).toBeLessThan(20000)
  }, 60000)

  it('drops the header row of a table whose XML omits headerRowCount (the OOXML default: one header row)', async () => {
    const { zipSync, unzipSync, strFromU8, strToU8 } = await import('fflate')
    const files = unzipSync(await workbook(3, 2))
    const name = Object.keys(files).find((f) => /^xl\/tables\/table\d+\.xml$/.test(f))!
    // Excel itself writes no headerRowCount attribute for a table with a header; exceljs writes headerRowCount="1"
    files[name] = strToU8(strFromU8(files[name]!).replace(/\s+headerRowCount="1"/, ''))
    expect(strFromU8(files[name]!)).not.toMatch(/headerRowCount/)
    const data = await decodeXlsx(zipSync(files))
    const table = data.tables!.find((t) => t.name === 'Big')!
    expect(table.columns).toEqual(['C1', 'C2'])
    expect(table.rows).toEqual([[0, 1], [2, 3], [4, 5]])
  })
})
