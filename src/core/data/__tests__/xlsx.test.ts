import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import ExcelJS from 'exceljs'
import { decodeXlsx } from '../xlsx'

async function workbookWithTable(rows: number): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sales')
  ws.addTable({
    name: 'Sales',
    ref: 'A1',
    headerRow: true,
    columns: [{ name: 'Key' }, { name: 'Name' }, { name: 'Amount' }],
    rows: Array.from({ length: rows }, (_, i) => [i + 1, `n${i + 1}`, (i + 1) * 1.5])
  })
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

/** Excel omits headerRowCount (default 1) in the table part; exceljs always writes it. */
function withoutHeaderRowCount(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes)
  for (const name of Object.keys(files)) {
    if (!/^xl\/tables\/table\d+\.xml$/.test(name)) continue
    files[name] = strToU8(strFromU8(files[name]!).replace(/\s+headerRowCount="1"/g, ''))
  }
  return zipSync(files)
}

describe('decodeXlsx', () => {
  it('drops the header row of a table saved by Excel (no headerRowCount attribute)', async () => {
    const data = await decodeXlsx(withoutHeaderRowCount(await workbookWithTable(3)))
    const t = data.tables!.find((x) => x.name === 'Sales')!
    expect(t.columns).toEqual(['Key', 'Name', 'Amount'])
    expect(t.rows).toEqual([
      [1, 'n1', 1.5],
      [2, 'n2', 3],
      [3, 'n3', 4.5]
    ])
  })

  it('keeps the first row of a table without a header row', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S')
    ws.addTable({ name: 'T', ref: 'A1', headerRow: false, columns: [{ name: 'A' }, { name: 'B' }], rows: [[1, 2], [3, 4]] })
    const data = await decodeXlsx(new Uint8Array(await wb.xlsx.writeBuffer()))
    expect(data.tables!.find((x) => x.name === 'T')!.rows).toEqual([
      [1, 2],
      [3, 4]
    ])
  })

  it('reads a large sheet in linear time', async () => {
    const bytes = await workbookWithTable(20_000)
    const t0 = performance.now()
    const data = await decodeXlsx(bytes)
    expect(data.sheets![0]!.rows.length).toBe(20_001)
    expect(performance.now() - t0).toBeLessThan(15_000)
  }, 60_000)
})
