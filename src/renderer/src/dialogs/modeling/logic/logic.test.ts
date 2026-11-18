import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { emptyModel, type SemanticModel, type TableDef } from '@core/model/types'
import { makeDate } from '@core/model/data'
import { buildEnterDataM, buildEnterDataTable, decodeEnterDataPayload, encodeEnterDataPayload, inferEnterDataType, isEnterDataPartition, mIdentifier, parseEnterDataM } from './enterData'
import { buildFieldParameter, buildNumericRangeParameter, fieldParameterExpression, isFieldParameterTable, parseFieldParameterExpression, validateNumericRange } from './parameters'
import { QUICK_MEASURES, literal, valueExpr } from './quickMeasures'
import { detectCardinality, draftFromRelationship, relationshipFromDraft, validateDraft, type RelationshipDraft } from './relationships'
import { buildFormatString, parseFormatString } from './formats'
import { markAsDateTable, renameColumn, renameInExpression, renameMeasure, renameTable, uniqueName, validateDateColumn, dateTableColumn } from './modelOps'
import { localDaxDiagnostics } from '../../../editors/dax/diagnostics'
import { readTmdlFiles, writeTmdlFiles } from '@core/tmdl'
import { formatDax } from '../../../editors/dax/formatter'

const uuidSeq = () => {
  let i = 0
  return () => `00000000-0000-0000-0000-${String(++i).padStart(12, '0')}`
}

describe('Enter data', () => {
  it('encodes the payload as base64 raw-deflate JSON and decodes it back', () => {
    const rows = [['1', 'Red'], ['2', null], ['3', 'Bl"ue']]
    const b64 = encodeEnterDataPayload(rows)
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(decodeEnterDataPayload(b64)).toEqual(rows)
    // the empty table payload Power BI writes
    expect(decodeEnterDataPayload('i44FAA==')).toEqual([])
  })
  it('writes the exact Power BI M shape', () => {
    const m = buildEnterDataM([{ name: 'Id' }, { name: 'My Color' }, { name: 'type' }], [['1', 'Red', 'a'], ['2', 'Blue', 'b'], ['', '', '']])
    const lines = m.split('\n')
    expect(lines[0]).toBe('let')
    expect(lines[1]).toMatch(/^ {4}Source = Table\.FromRows\(Json\.Document\(Binary\.Decompress\(Binary\.FromText\("[A-Za-z0-9+/=]+", BinaryEncoding\.Base64\), Compression\.Deflate\)\), let _t = \(\(type nullable text\) meta \[Serialized\.Text = true\]\) in type table \[Id = _t, #"My Color" = _t, #"type" = _t\]\),$/)
    expect(lines[2]).toBe('    #"Changed Type" = Table.TransformColumnTypes(Source,{{"Id", Int64.Type}, {"My Color", type text}, {"type", type text}})')
    expect(lines.slice(3)).toEqual(['in', '    #"Changed Type"'])
  })
  it('round-trips through parseEnterDataM (trailing empty rows dropped)', () => {
    const cols = [{ name: 'Name' }, { name: 'Amount' }, { name: 'When' }]
    const rows = [['a', '1.5', '2024-01-31'], ['b', '2', '2024-02-29'], ['', '', '']]
    const parsed = parseEnterDataM(buildEnterDataM(cols, rows))!
    expect(parsed.columns).toEqual([{ name: 'Name', type: 'text' }, { name: 'Amount', type: 'number' }, { name: 'When', type: 'date' }])
    expect(parsed.rows).toEqual([['a', '1.5', '2024-01-31'], ['b', '2', '2024-02-29']])
  })
  it('infers types like PBI and builds model table + data', () => {
    expect(inferEnterDataType(['1', '2', null])).toBe('int64')
    expect(inferEnterDataType(['1', '2.5'])).toBe('number')
    expect(inferEnterDataType(['TRUE', 'false'])).toBe('logical')
    expect(inferEnterDataType(['2024-01-01 10:00'])).toBe('datetime')
    expect(inferEnterDataType(['x', '1'])).toBe('text')
    const { table, data } = buildEnterDataTable('Targets', [{ name: 'Region' }, { name: 'Target' }, { name: 'Start' }], [['North', '100', '2024-01-01'], ['South', '', '1/15/2024']])
    expect(table.columns.map((c) => [c.name, c.dataType, c.summarizeBy])).toEqual([['Region', 'string', 'none'], ['Target', 'int64', 'sum'], ['Start', 'dateTime', 'none']])
    expect(isEnterDataPartition(table.partitions[0])).toBe(true)
    expect(data.rowCount).toBe(2)
    expect(data.columns[1].values).toEqual([100, null])
    expect(data.columns[2].values).toEqual([makeDate(2024, 1, 1), makeDate(2024, 1, 15)])
  })
  it('quotes M identifiers', () => {
    expect(mIdentifier('Column1')).toBe('Column1')
    expect(mIdentifier('each')).toBe('#"each"')
    expect(mIdentifier('A "b"')).toBe('#"A ""b"""')
  })
})

describe('parameters', () => {
  it('builds a numeric range (what-if) parameter like PBI', () => {
    const spec = { name: 'Discount Pct', dataType: 'int64' as const, min: 0, max: 50, increment: 5, defaultValue: 10 }
    expect(validateNumericRange(spec)).toBeNull()
    expect(validateNumericRange({ ...spec, increment: 0 })).toMatch(/Increment/)
    expect(validateNumericRange({ ...spec, min: 1.5 })).toMatch(/whole number/)
    const t = buildNumericRangeParameter(spec, uuidSeq())
    expect(t.partitions[0]).toMatchObject({ sourceType: 'calculated', expression: 'GENERATESERIES(0, 50, 5)' })
    expect(t.columns[0]).toMatchObject({ name: 'Discount Pct', sourceColumn: '[Value]', extendedProperties: { ParameterMetadata: { version: 0 } } })
    expect(t.measures[0]).toMatchObject({ name: 'Discount Pct Value', expression: "SELECTEDVALUE('Discount Pct'[Discount Pct], 10)" })
    expect(localDaxDiagnostics(t.measures[0].expression)).toEqual([])
  })
  it('builds a fields parameter with the exact TMDL shape', () => {
    const items = [
      { label: 'Color', table: 'Product', field: 'Color' },
      { label: 'Total "Sales"', table: 'Sales Fact', field: 'Total Sales' }
    ]
    const t = buildFieldParameter('Metric Picker', items, uuidSeq())
    expect(t.columns.map((c) => [c.name, c.sourceColumn, c.isHidden ?? false, c.sortByColumn])).toEqual([
      ['Metric Picker', '[Value1]', false, 'Metric Picker Order'],
      ['Metric Picker Fields', '[Value2]', true, 'Metric Picker Order'],
      ['Metric Picker Order', '[Value3]', true, undefined]
    ])
    expect(t.columns[1].extendedProperties).toEqual({ ParameterMetadata: { version: 3, kind: 2 } })
    expect(t.columns[0].extra).toEqual({ '@children': [{ keyword: 'relatedColumnDetails', children: [{ keyword: 'groupByColumn', sep: ':', value: "'Metric Picker Fields'" }] }] })
    expect(t.columns[2]).toMatchObject({ formatString: '0', summarizeBy: 'sum', dataType: 'int64' })
    expect(t.partitions[0].expression).toBe(['{', `    ("Color", NAMEOF('Product'[Color]), 0),`, `    ("Total ""Sales""", NAMEOF('Sales Fact'[Total Sales]), 1)`, '}'].join('\n'))
    expect(isFieldParameterTable(t)).toBe(true)
    expect(parseFieldParameterExpression(t.partitions[0].expression!)).toEqual(items)
    expect(parseFieldParameterExpression(fieldParameterExpression([]))).toEqual([])
  })
})

describe('TMDL round trip of generated tables', () => {
  it('writes the field parameter exactly like Power BI and reads it back', () => {
    const m = emptyModel('M')
    m.tables.push(buildFieldParameter('Metric Picker', [{ label: 'Color', table: 'Product', field: 'Color' }, { label: 'Total', table: '', field: 'Total' }], uuidSeq()))
    m.tables.push(buildNumericRangeParameter({ name: 'Discount', dataType: 'int64', min: 0, max: 10, increment: 1, defaultValue: 5 }, uuidSeq()))
    m.tables.push(buildEnterDataTable('Targets', [{ name: 'Region' }, { name: 'Target' }], [['North', '1']]).table)
    const { files } = writeTmdlFiles(m)
    const tmdl = Object.entries(files).find(([k]) => k.includes('Metric Picker'))![1] as string
    expect(tmdl).toContain("\t\trelatedColumnDetails\n\t\t\tgroupByColumn: 'Metric Picker Fields'")
    expect(tmdl).toMatch(/extendedProperty ParameterMetadata =\s*\{\s*"version": 3,\s*"kind": 2\s*\}/)
    expect(tmdl).toContain('NAMEOF([Total]), 1)')
    const back = readTmdlFiles(files).model
    const fp = back.tables.find((t) => t.name === 'Metric Picker')!
    expect(isFieldParameterTable(fp)).toBe(true)
    expect(parseFieldParameterExpression(fp.partitions[0].expression!)).toEqual([{ label: 'Color', table: 'Product', field: 'Color' }, { label: 'Total', table: '', field: 'Total' }])
    expect(back.tables.find((t) => t.name === 'Discount')!.measures[0].expression).toBe('SELECTEDVALUE(Discount[Discount], 5)')
    const ed = back.tables.find((t) => t.name === 'Targets')!
    expect(parseEnterDataM(ed.partitions[0].expression!)!.rows).toEqual([['North', '1']])
  })
})

describe('quick measures', () => {
  const amount = { kind: 'column' as const, table: 'Sales', name: 'Amount', agg: 'sum' as const }
  const color = { kind: 'column' as const, table: 'Product', name: 'Color' }
  const date = { kind: 'column' as const, table: 'Date', name: 'Date' }
  it('renders base values', () => {
    expect(valueExpr(amount)).toBe('SUM(Sales[Amount])')
    expect(valueExpr({ kind: 'measure', table: 'Sales', name: 'Total' })).toBe('[Total]')
    expect(literal('42')).toBe('42')
    expect(literal('Red "x"')).toBe('"Red ""x"""')
  })
  it('every template produces syntactically valid DAX', () => {
    for (const t of QUICK_MEASURES) {
      const f: Record<string, typeof amount | typeof color> = {}
      for (const s of t.slots) f[s.id] = s.accepts === 'value' ? amount : s.accepts === 'date' ? date : color
      const p = Object.fromEntries((t.params ?? []).map((x) => [x.id, x.default || 'Red']))
      const dax = t.build(f, p)
      const diags = localDaxDiagnostics(dax).filter((d) => d.severity === 'error')
      expect(diags, `${t.id}: ${dax}`).toEqual([])
      expect(t.name(f, p).length).toBeGreaterThan(0)
      expect(formatDax(formatDax(dax))).toBe(formatDax(dax))
    }
  })
  it('YoY and running total match PBI structure', () => {
    const yoy = QUICK_MEASURES.find((t) => t.id === 'yoy')!
    expect(yoy.build({ base: amount, date }, {})).toContain("DATEADD('Date'[Date], -1, YEAR)")
    const rt = QUICK_MEASURES.find((t) => t.id === 'runningTotal')!
    expect(rt.build({ base: amount, field: date }, {})).toContain("ISONORAFTER('Date'[Date], MAX('Date'[Date]), DESC)")
    expect(rt.name({ base: amount, field: date }, {})).toBe('Amount running total in Date')
  })
})

function starModel(): SemanticModel {
  const m = emptyModel('Test')
  const t = (name: string, cols: Array<[string, 'int64' | 'string' | 'dateTime']>): TableDef => ({ name, columns: cols.map(([n, dt]) => ({ name: n, dataType: dt, kind: 'data' })), measures: [], hierarchies: [], partitions: [] })
  m.tables = [t('Sales', [['ProductKey', 'int64'], ['DateKey', 'dateTime'], ['Amount', 'int64']]), t('Product', [['ProductKey', 'int64'], ['Color', 'string']]), t('Date', [['Date', 'dateTime'], ['Year', 'int64']])]
  m.relationships = [{ name: 'r1', fromTable: 'Sales', fromColumn: 'ProductKey', toTable: 'Product', toColumn: 'ProductKey', fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection', isActive: true }]
  m.tables[0].measures.push({ name: 'Total', expression: 'SUM(Sales[Amount])' }, { name: 'Twice', expression: "[Total] * 2 + CALCULATE([Total], Product[Color] = \"Red\")" })
  m.tables[0].columns.push({ name: 'Big', dataType: 'boolean', kind: 'calculated', expression: '[Amount] > 100' })
  return m
}

describe('relationships', () => {
  it('maps UI cardinality to TMDL (one-to-many is stored swapped)', () => {
    const d: RelationshipDraft = { table1: 'Product', column1: 'ProductKey', table2: 'Sales', column2: 'ProductKey', cardinality: 'oneToMany', crossFilter: 'single', isActive: true, relyOnReferentialIntegrity: false, securityBoth: false }
    const r = relationshipFromDraft(d, undefined, 'x')
    expect(r).toMatchObject({ fromTable: 'Sales', toTable: 'Product', fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection' })
    expect(draftFromRelationship(r).cardinality).toBe('manyToOne')
    expect(relationshipFromDraft({ ...d, cardinality: 'oneToOne', crossFilter: 'single' }).crossFilteringBehavior).toBe('bothDirections')
  })
  it('detects cardinality from data', () => {
    expect(detectCardinality([1, 1, 2], [1, 2, 3])).toBe('manyToOne')
    expect(detectCardinality([1, 2], [2, 1])).toBe('oneToOne')
    expect(detectCardinality([1, 2], [1, 1])).toBe('oneToMany')
    expect(detectCardinality([1, 1], [2, 2])).toBe('manyToMany')
  })
  it('validates against data and existing relationships', () => {
    const m = starModel()
    const d: RelationshipDraft = { table1: 'Sales', column1: 'ProductKey', table2: 'Product', column2: 'ProductKey', cardinality: 'manyToOne', crossFilter: 'single', isActive: true, relyOnReferentialIntegrity: false, securityBoth: false }
    expect(validateDraft(m, d, {}).errors[0]).toMatch(/already exists/)
    const d2 = { ...d, column1: 'Amount' }
    expect(validateDraft(m, d2, { v1: [1, 2], v2: [1, 1] }).errors.some((e) => e.includes("cardinality you selected isn't valid"))).toBe(true)
    const d3: RelationshipDraft = { ...d, table2: 'Date', column1: 'DateKey', column2: 'Year' }
    expect(validateDraft(m, d3, {}).errors[0]).toMatch(/different data types/)
    expect(validateDraft(m, { ...d3, column2: 'Date' }, {}).errors).toEqual([])
  })
})

describe('formats', () => {
  it('builds and parses PBI format strings', () => {
    expect(buildFormatString({ kind: 'currency', decimals: 2, thousands: true, symbol: '$', pattern: '', custom: '' })).toBe('\\$#,0.00;(\\$#,0.00);\\$#,0.00')
    expect(parseFormatString('\\$#,0.00;(\\$#,0.00);\\$#,0.00', 'double')).toMatchObject({ kind: 'currency', symbol: '$', decimals: 2 })
    expect(parseFormatString('"CHF"#,0;("CHF"#,0);"CHF"#,0', 'double')).toMatchObject({ kind: 'currency', symbol: 'CHF', decimals: 0 })
    expect(parseFormatString('0.0%', 'double')).toMatchObject({ kind: 'percentage', decimals: 1, thousands: false })
    expect(parseFormatString('#,0.00', 'double')).toMatchObject({ kind: 'decimal', decimals: 2, thousands: true })
    expect(parseFormatString('0', 'int64')).toMatchObject({ kind: 'wholeNumber' })
    expect(parseFormatString('yyyy-mm-dd', 'dateTime')).toMatchObject({ kind: 'date', pattern: 'yyyy-mm-dd' })
    expect(parseFormatString('0.00E+000', 'double')).toMatchObject({ kind: 'scientific', decimals: 2 })
    expect(parseFormatString('[>1000]#,0', 'double')).toMatchObject({ kind: 'custom' })
    expect(buildFormatString({ kind: 'percentage', decimals: 0, thousands: false, symbol: '', pattern: '', custom: '' })).toBe('0%')
  })
})

describe('model operations', () => {
  it('generates unique names', () => {
    expect(uniqueName('Measure', ['measure', 'Measure 2'])).toBe('Measure 3')
  })
  it('renames references in expressions', () => {
    expect(renameInExpression("[Total] + Sales[Total] + Other[Total]", { kind: 'measure', table: 'Sales', name: 'Total' }, 'Revenue')).toBe('[Revenue] + Sales[Revenue] + Other[Total]')
    expect(renameInExpression("SUM(Sales[Amount]) + [Amount]", { kind: 'column', table: 'Sales', name: 'Amount' }, 'Net', 'Sales')).toBe('SUM(Sales[Net]) + [Net]')
    expect(renameInExpression("COUNTROWS(Sales) + SUM('Sales'[x])", { kind: 'table', table: 'Sales' }, 'Sales Fact')).toBe("COUNTROWS('Sales Fact') + SUM('Sales Fact'[x])")
  })
  it('renames tables, columns and measures across the model', () => {
    const m = starModel()
    renameMeasure(m, 'Sales', 'Total', 'Revenue')
    expect(m.tables[0].measures[1].expression).toBe('[Revenue] * 2 + CALCULATE([Revenue], Product[Color] = "Red")')
    renameColumn(m, 'Product', 'ProductKey', 'PKey')
    expect(m.relationships[0].toColumn).toBe('PKey')
    renameTable(m, 'Product', 'Item')
    expect(m.relationships[0].toTable).toBe('Item')
    expect(m.tables[0].measures[1].expression).toContain('Item[Color]')
    renameColumn(m, 'Sales', 'Amount', 'Value')
    expect(m.tables[0].columns.find((c) => c.name === 'Big')!.expression).toBe('[Value] > 100')
    expect(m.tables[0].measures[0].expression).toBe('SUM(Sales[Value])')
  })
  it('validates and marks date tables', () => {
    const col = { name: 'Date', dataType: 'dateTime' as const, kind: 'data' as const }
    expect(validateDateColumn(col, [makeDate(2024, 1, 1), makeDate(2024, 1, 2)]).ok).toBe(true)
    expect(validateDateColumn(col, [makeDate(2024, 1, 1), makeDate(2024, 1, 3)]).message).toMatch(/gaps/)
    expect(validateDateColumn(col, [makeDate(2024, 1, 1), makeDate(2024, 1, 1)]).message).toMatch(/duplicate/)
    expect(validateDateColumn(col, [makeDate(2024, 1, 1), null]).message).toMatch(/blank/)
    expect(validateDateColumn({ ...col, dataType: 'string' }, []).ok).toBe(false)
    const m = starModel()
    markAsDateTable(m.tables[2], 'Date')
    expect(m.tables[2].dataCategory).toBe('Time')
    expect(dateTableColumn(m.tables[2])).toBe('Date')
    markAsDateTable(m.tables[2], null)
    expect(dateTableColumn(m.tables[2])).toBeNull()
  })
})

// Corpus: every field-parameter partition in the real models parses back into NAMEOF items and
// regenerating from those items yields the same tuples (generic assertions only).
const CORPUS = process.env['LUMEN_CORPUS_DIR']
describe.skipIf(!CORPUS || !existsSync(CORPUS))('corpus field parameters', () => {
  it('parses and regenerates field-parameter partitions', () => {
    const files: string[] = []
    const walk = (dir: string, depth: number) => {
      if (depth > 8) return
      for (const e of readdirSync(dir)) {
        if (e === 'node_modules' || e === '.pbi') continue
        const p = join(dir, e)
        const st = statSync(p)
        if (st.isDirectory()) walk(p, depth + 1)
        else if (e.endsWith('.tmdl')) files.push(p)
      }
    }
    walk(CORPUS!, 0)
    let checked = 0
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      if (!text.includes('ParameterMetadata') || !text.includes('NAMEOF')) continue
      const tuples = text.match(/\(\s*"(?:[^"]|"")*"\s*,\s*NAMEOF\s*\(/g) ?? []
      const items = parseFieldParameterExpression(text)
      expect(items.length).toBe(tuples.length)
      const regenerated = parseFieldParameterExpression(fieldParameterExpression(items))
      expect(regenerated).toEqual(items)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })
})
