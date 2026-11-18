// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { inflateSync } from 'fflate'
import { detectDelimiter, parseCsv, parseCsvRows, inferStringType, tabulateJson, defaultSummarizeBy, typeStringTable, parseDateString, sqlTypeToDataType, decodeText } from '../getdata/parsers'
import { csvM, enterDataM, excelM, jsonM, mIdent, mString, sqlM, letExpr } from '../getdata/mcode'
import { buildTableDef, detectRelationships, uniqueTableName } from '../getdata/loadTables'
import { emptyModel } from '@core/model/types'
import { emptyDataStore, tableFromRows } from '@core/model/data'

describe('csv parsing', () => {
  it('handles quotes, embedded delimiters and newlines', () => {
    expect(parseCsvRows('a,b\n"x, y","he said ""hi"""\n"multi\nline",2\r\n', ',')).toEqual([['a', 'b'], ['x, y', 'he said "hi"'], ['multi\nline', '2']])
  })
  it('detects delimiters', () => {
    expect(detectDelimiter('a;b;c\n1;2;3\n')).toBe(';')
    expect(detectDelimiter('a\tb\n1\t2\n')).toBe('\t')
    expect(detectDelimiter('a,b\n1,2\n')).toBe(',')
  })
  it('promotes headers and types columns', () => {
    const t = parseCsv('Name,Qty,Price,When,Ok\nA,1,2.5,2024-01-31,true\nB,2,3,2024-02-01,false\n')
    expect(t.promoted).toBe(true)
    expect(t.columns).toEqual(['Name', 'Qty', 'Price', 'When', 'Ok'])
    expect(t.types).toEqual(['string', 'int64', 'double', 'dateTime', 'boolean'])
    expect(t.rows[0][3]).toEqual(new Date(Date.UTC(2024, 0, 31)))
    expect(t.rows[1]).toEqual(['B', 2, 3, new Date(Date.UTC(2024, 1, 1)), false])
  })
  it('does not promote all-numeric first rows', () => {
    const t = parseCsv('1,2\n3,4\n')
    expect(t.promoted).toBe(false)
    expect(t.columns).toEqual(['Column1', 'Column2'])
  })
  it('strips a UTF-8 BOM', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('a')
  })
})

describe('type inference', () => {
  it('detects scalar types', () => {
    expect(inferStringType('42')).toBe('int64')
    // Power Query's detection turns zero-padded digits into whole numbers too
    expect(inferStringType('007')).toBe('int64')
    expect(inferStringType('-1.5e3')).toBe('double')
    expect(inferStringType('TRUE')).toBe('boolean')
    expect(inferStringType('12/31/2023')).toBe('dateTime')
    expect(inferStringType('2023-02-30')).toBe('string')
    expect(parseDateString('1/2/2024 3:04 PM')).toEqual(new Date(Date.UTC(2024, 0, 2, 15, 4)))
  })
  it('widens int+double and falls back to text', () => {
    expect(typeStringTable(['a', 'b'], [['1', 'x'], ['1.5', '2']]).types).toEqual(['double', 'string'])
  })
  it('maps SQL types', () => {
    expect(sqlTypeToDataType('BigInt')).toBe('int64')
    expect(sqlTypeToDataType('Decimal')).toBe('decimal')
    expect(sqlTypeToDataType('DateTime2')).toBe('dateTime')
    expect(sqlTypeToDataType('NVarChar')).toBe('string')
  })
  it('chooses summarize-by like PBI', () => {
    expect(defaultSummarizeBy('Amount', 'double')).toBe('sum')
    expect(defaultSummarizeBy('Amount Paid', 'double')).toBe('sum')
    expect(defaultSummarizeBy('CustomerId', 'int64')).toBe('none')
    expect(defaultSummarizeBy('Product Key', 'int64')).toBe('none')
    expect(defaultSummarizeBy('Name', 'string')).toBe('none')
  })
})

describe('json tabulation', () => {
  it('records, columns, nested value arrays', () => {
    expect(tabulateJson([{ a: 1, b: 'x' }, { a: 2, c: true }])).toMatchObject({ columns: ['a', 'b', 'c'], types: ['int64', 'string', 'boolean'], shape: 'records' })
    expect(tabulateJson({ a: [1, 2], b: ['x', 'y'] })).toMatchObject({ columns: ['a', 'b'], rows: [[1, 'x'], [2, 'y']], shape: 'columns' })
    expect(tabulateJson({ value: [{ id: 1 }] })).toMatchObject({ columns: ['id'], shape: 'records' })
    expect(tabulateJson('nope')).toBeNull()
  })
})

describe('M generation', () => {
  it('quotes identifiers and strings', () => {
    expect(mIdent('Source')).toBe('Source')
    expect(mIdent('Changed Type')).toBe('#"Changed Type"')
    expect(mIdent('each')).toBe('#"each"')
    expect(mString('a "b"')).toBe('"a ""b"""')
  })
  it('csv', () => {
    const m = csvM('/data/sales.csv', [{ name: 'Name', type: 'string' }, { name: 'Qty', type: 'int64' }], { delimiter: ',', promoted: true })
    expect(m).toBe(
      'let\n    Source = Csv.Document(File.Contents("/data/sales.csv"),[Delimiter=",", Columns=2, Encoding=65001, QuoteStyle=QuoteStyle.Csv]),\n    #"Promoted Headers" = Table.PromoteHeaders(Source, [PromoteAllScalars=true]),\n    #"Changed Type" = Table.TransformColumnTypes(#"Promoted Headers",{{"Name", type text}, {"Qty", Int64.Type}})\nin\n    #"Changed Type"'
    )
  })
  it('excel sheet / table', () => {
    expect(excelM('/x.xlsx', { name: 'Sheet1', kind: 'Sheet' }, [{ name: 'D', type: 'dateTime', dateOnly: true }], { promoted: true })).toContain('Sheet1_Sheet = Source{[Item="Sheet1",Kind="Sheet"]}[Data]')
    expect(excelM('/x.xlsx', { name: 'Sales', kind: 'Table' }, [{ name: 'D', type: 'dateTime', dateOnly: true }], { promoted: false })).toContain('{{"D", type date}}')
  })
  it('json / sql', () => {
    expect(jsonM('/a.json', [], { shape: 'records' })).toContain('Table.FromRecords(Source)')
    expect(sqlM('srv', 'db', { schema: 'dbo', item: 'Sales' })).toContain('dbo_Sales = Source{[Schema="dbo",Item="Sales"]}[Data]')
    expect(sqlM('srv', 'db', { query: 'select 1' })).toContain('[Query="select 1"]')
    expect(letExpr([['Source', '1']])).toBe('let\n    Source = 1\nin\n    Source')
  })
  it('enter data embeds deflated JSON rows', () => {
    const m = enterDataM([{ name: 'A', type: 'string' }, { name: 'B b', type: 'int64' }], [['x', '1'], ['y', '2']])
    const b64 = /Binary\.FromText\("([^"]+)"/.exec(m)![1]
    const json = new TextDecoder().decode(inflateSync(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))))
    expect(JSON.parse(json)).toEqual([['x', '1'], ['y', '2']])
    expect(m).toContain('type table [A = _t, #"B b" = _t]')
    expect(m).toContain('{"B b", Int64.Type}')
  })
})

describe('model loading', () => {
  it('builds a table def with an M partition', () => {
    const def = buildTableDef('Sales', { name: 'Sales', m: 'let Source = 1 in Source', columns: [{ name: 'Amount', type: 'double' }, { name: 'SaleId', type: 'int64' }] })
    expect(def.partitions[0]).toMatchObject({ sourceType: 'm', mode: 'import', expression: 'let Source = 1 in Source' })
    expect(def.columns.map((c) => [c.name, c.summarizeBy, c.kind])).toEqual([['Amount', 'sum', 'data'], ['SaleId', 'none', 'data']])
    expect(def.columns[0].lineageTag).toBeTruthy()
  })
  it('makes table names unique', () => {
    const m = emptyModel()
    m.tables.push(buildTableDef('Sales', { name: 'Sales', m: '', columns: [] }))
    expect(uniqueTableName(m, 'Sales')).toBe('Sales (2)')
    expect(uniqueTableName(m, 'Other')).toBe('Other')
  })
  it('autodetects many-to-one relationships on matching key columns', () => {
    const m = emptyModel()
    m.tables.push(buildTableDef('Product', { name: 'Product', m: '', columns: [{ name: 'ProductKey', type: 'int64' }, { name: 'Color', type: 'string' }] }))
    m.tables.push(buildTableDef('Sales', { name: 'Sales', m: '', columns: [{ name: 'ProductKey', type: 'int64' }, { name: 'Amount', type: 'double' }] }))
    const data = emptyDataStore()
    data.tables.set('Product', tableFromRows(['ProductKey', 'Color'], ['int64', 'string'], [[1, 'Red'], [2, 'Blue']]))
    data.tables.set('Sales', tableFromRows(['ProductKey', 'Amount'], ['int64', 'double'], [[1, 5], [1, 6], [2, 7]]))
    const rels = detectRelationships(m, data, ['Sales'])
    expect(rels).toHaveLength(1)
    expect(rels[0]).toMatchObject({ fromTable: 'Sales', fromColumn: 'ProductKey', toTable: 'Product', toColumn: 'ProductKey', fromCardinality: 'many', toCardinality: 'one' })
  })
})

describe('excel reader', () => {
  it('lists Excel tables and sheets with promoted, typed columns', async () => {
    const { excelItems } = await import('../getdata/readers')
    const mod: any = await import('exceljs')
    const ExcelJS = mod.default ?? mod
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Data')
    ws.addRow(['Region', 'Units', 'Date'])
    ws.addRow(['North', 10, new Date(Date.UTC(2024, 0, 5))])
    ws.addRow(['South', 12.5, new Date(Date.UTC(2024, 0, 6))])
    const ws2 = wb.addWorksheet('Lookup')
    ws2.addTable({ name: 'Regions', ref: 'B2', headerRow: true, columns: [{ name: 'Region' }, { name: 'Manager' }], rows: [['North', 'Ann'], ['South', 'Bo']] })
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer())
    const items = await excelItems('/tmp/book.xlsx', bytes)
    const sheet = items.find((i) => i.id === 'sheet:Data')!
    expect(sheet.data).toMatchObject({ columns: ['Region', 'Units', 'Date'], types: ['string', 'double', 'dateTime'] })
    expect(sheet.data!.rows[1]).toEqual(['South', 12.5, new Date(Date.UTC(2024, 0, 6))])
    expect(sheet.m([])).toContain('Data_Sheet')
    const table = items.find((i) => i.id === 'table:Regions')
    expect(table?.data).toMatchObject({ columns: ['Region', 'Manager'], rows: [['North', 'Ann'], ['South', 'Bo']] })
    expect(items[0].kind).toBe('table')
  })
})
