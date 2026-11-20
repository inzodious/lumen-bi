/**
 * Stage E: a DataModel written entirely by Lumen, read back by Lumen's reader (model and data identical).
 * A reader written by the same hands accepting the file proves the writer is self-consistent, not that Power BI
 * accepts it; the reproduction tests (reproduce.test.ts) compare the writer with real files.
 */
import { describe, expect, it } from 'vitest'
import { createSampleProject } from '../../../../data/sample'
import { emptyDataStore, tableFromRows, type DataStore, type Scalar } from '../../../../model/data'
import { emptyModel, type SemanticModel, type TableDef } from '../../../../model/types'
import { readDataModel } from '../../datamodel'
import { parseAbf } from '../../datamodel/abf'
import { freshModelSupport } from './model'
import { UnsupportedModelError, writeFreshDataModel } from './datamodel'

function norm(v: Scalar): unknown {
  if (v instanceof Date) return `D${v.getTime()}`
  return v
}

/** Every table's columns, row by row, as comparable values. */
function dump(data: DataStore, model: SemanticModel): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const t of model.tables) {
    const td = data.tables.get(t.name)
    if (!td) continue
    out[t.name] = Object.fromEntries(td.columns.filter((c) => !c.name.startsWith('RowNumber-')).map((c) => [c.name, c.values.map(norm)]))
  }
  return out
}

function table(name: string, cols: Array<[string, TableDef['columns'][number]['dataType']]>, extra: Partial<TableDef> = {}): TableDef {
  return {
    name,
    columns: cols.map(([n, dataType]) => ({ name: n, dataType, kind: 'data' as const, sourceColumn: n })),
    measures: [],
    hierarchies: [],
    partitions: [{ name, sourceType: 'm', mode: 'import', expression: `let Source = #table({}, {}) in Source` }],
    ...extra
  }
}

function tinyModel(): { model: SemanticModel; data: DataStore } {
  const model = emptyModel()
  model.tables.push(
    table('Product', [
      ['ProductKey', 'int64'],
      ['Product', 'string'],
      ['Category', 'string']
    ], { hierarchies: [{ name: 'Products', levels: [{ name: 'Category', column: 'Category', ordinal: 0 }, { name: 'Product', column: 'Product', ordinal: 1 }] }] }),
    table('Sales', [
      ['ProductKey', 'int64'],
      ['Date', 'dateTime'],
      ['Amount', 'double'],
      ['Price', 'decimal'],
      ['Returned', 'boolean'],
      ['Note', 'string']
    ])
  )
  model.tables[1].measures.push({ name: 'Total', expression: 'SUM(Sales[Amount])', formatString: '#,0.00' })
  model.relationships.push({ name: 'r1', fromTable: 'Sales', fromColumn: 'ProductKey', toTable: 'Product', toColumn: 'ProductKey', fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection', isActive: true })
  const data = emptyDataStore()
  data.tables.set('Product', tableFromRows(['ProductKey', 'Product', 'Category'], ['int64', 'string', 'string'], [
    [1, 'Bike', 'Vehicles'],
    [2, 'Helmet', 'Gear'],
    [3, 'Lock', 'Gear'],
    [4, 'Ünïcödé 😀', null]
  ]))
  const d = (y: number, m: number, day: number, h = 0): Date => new Date(Date.UTC(y, m - 1, day, h))
  data.tables.set('Sales', tableFromRows(['ProductKey', 'Date', 'Amount', 'Price', 'Returned', 'Note'], ['int64', 'dateTime', 'double', 'decimal', 'boolean', 'string'], [
    [1, d(2024, 1, 1), 10.5, 1.25, false, 'a'],
    [2, d(2024, 1, 2, 13), -3, 2.5, true, ''],
    [3, d(1899, 12, 30), 0, null, null, null],
    [1, null, 1e300, 99999.9999, false, 'A'],
    [9, d(2030, 6, 30), null, -7, true, 'x'.repeat(5000)]
  ]))
  return { model, data }
}

describe('fresh DataModel (stage E)', () => {
  it('writes a small model that reads back with identical data', async () => {
    const { model, data } = tinyModel()
    expect(freshModelSupport(model, data)).toEqual([])
    const res = await writeFreshDataModel(model, data, { now: Date.UTC(2026, 0, 2) })
    const back = await readDataModel(res.dataModel)
    expect(back.model.tables.map((t) => t.name)).toEqual(['Product', 'Sales'])
    const got = dump(back.data, back.model)
    const want = dump(data, model)
    // text is case-insensitive in Power BI: 'A' is stored as the first spelling seen ('a')
    ;(want.Sales as Record<string, unknown[]>).Note[3] = 'a'
    expect(got).toEqual(want)
    expect(back.model.relationships).toHaveLength(1)
    expect(back.model.tables[1].measures[0]).toMatchObject({ name: 'Total', expression: 'SUM(Sales[Amount])', formatString: '#,0.00' })
    expect(back.model.tables[0].hierarchies[0].levels.map((l) => l.column)).toEqual(['Category', 'Product'])
  })

  it('writes an ABF the reader parses, with every column file listed', async () => {
    const { model, data } = tinyModel()
    const res = await writeFreshDataModel(model, data, { uncompressed: true })
    const abf = parseAbf(res.dataModel)
    const names = abf.files.map((f) => f.fileName)
    expect(names).toContain('metadata.sqlitedb')
    // Desktop refuses a data model without a database key file
    expect(names).toContain('0.CryptKey.bin')
    expect(names.some((n) => /^1\.H\$Product \(\d+\)\$Product \(\d+\)\.POS_TO_ID\.0\.idf$/.test(n))).toBe(true)
    expect(names.some((n) => /^1\.R\$Sales \(\d+\)\$r1 \(\d+\)\.INDEX\.0\.idf$/.test(n))).toBe(true)
    expect(names.some((n) => /^1\.U\$Product \(\d+\)\$Products \(\d+\)\.MULTI_LEVEL_ID\.0\.idf$/.test(n))).toBe(true)
  })

  it('writes the built-in sample', async () => {
    const doc = createSampleProject()
    const res = await writeFreshDataModel(doc.model, doc.data)
    const back = await readDataModel(res.dataModel)
    expect(dump(back.data, back.model)).toEqual(dump(doc.data, doc.model))
  })

  it('writes one key per table: a key column replaces the row number as key (Desktop rejects two)', async () => {
    const { model, data } = tinyModel()
    model.tables[0].columns[0].isKey = true
    const res = await writeFreshDataModel(model, data, { uncompressed: true })
    const abf = parseAbf(res.dataModel)
    const { MetadataDb } = await import('../../datamodel/sqlite')
    const { abfFileBytes } = await import('../../datamodel/abf')
    const db = await MetadataDb.open(abfFileBytes(abf, 'metadata.sqlitedb'))
    const product = db.all('Table').find((t) => t.Name === 'Product')!
    const keys = db.all('Column').filter((c) => c.TableID === product.ID && c.IsKey === 1).map((c) => c.ExplicitName)
    expect(keys).toEqual(['ProductKey'])
    const sales = db.all('Table').find((t) => t.Name === 'Sales')!
    expect(db.all('Column').filter((c) => c.TableID === sales.ID && c.IsKey === 1).map((c) => c.Type)).toEqual([3])
    db.close()
  })

  it('refuses unsupported features by name', async () => {
    const { model, data } = tinyModel()
    model.relationships[0].toCardinality = 'many'
    await expect(writeFreshDataModel(model, data)).rejects.toThrow(UnsupportedModelError)
    expect(freshModelSupport(model, data).join()).toMatch(/many-to-many/)
  })
})
