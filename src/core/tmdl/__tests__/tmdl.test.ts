import { describe, expect, it } from 'vitest'
import { readTmdlFiles } from '../read'
import { writeTmdlFiles } from '../write'
import { parseTmdlText } from '../parser'
import { quoteName, parseQualified, encodeTextValue, decodeTextValue } from '../names'
import { readTmsl, writeTmsl } from '../tmsl'

const T = '\t'

const files: Record<string, string> = {
  'database.tmdl': `database\n\tcompatibilityLevel: 1600\n\n`,
  'model.tmdl': [
    'model Model',
    '\tculture: en-US',
    '\tdefaultPowerBIDataSourceVersion: powerBI_V3',
    '\tdiscourageImplicitMeasures',
    '\tsourceQueryCulture: en-US',
    '\tdataAccessOptions',
    '\t\tlegacyRedirects',
    '\t\treturnErrorValuesAsNull',
    '',
    'queryGroup Facts',
    '',
    '\tannotation PBI_QueryGroupOrder = 0',
    '',
    'annotation PBI_QueryOrder = ["Sales","Product"]',
    '',
    'ref table Sales',
    "ref table 'Product Info'",
    'ref table Time',
    'ref table Metric',
    '',
    'ref cultureInfo en-US',
    '',
    ''
  ].join('\n'),
  'tables/Sales.tmdl': [
    '/// Fact table with one row per order line',
    'table Sales',
    '\tlineageTag: 11111111-0000-0000-0000-000000000001',
    '',
    '\t/// Total amount',
    '\tmeasure Amount = SUM(Sales[Net])',
    '\t\tformatString: #,0.00',
    '\t\tdisplayFolder: Base',
    '\t\tlineageTag: m1',
    '',
    '\t\tannotation PBI_FormatHint = {"isGeneralNumber":true}',
    '',
    "\tmeasure 'Amount LY' =",
    '\t\t\t',
    '\t\t\tCALCULATE (',
    '\t\t\t    [Amount],',
    "\t\t\t    SAMEPERIODLASTYEAR ( 'Time'[Date] )",
    '\t\t\t)',
    '\t\tformatString: """Yes"";""Yes"";""No"""',
    '\t\tlineageTag: m2',
    '',
    '\t\tformatStringDefinition =',
    '\t\t\t\tIF ( [Amount] > 1000, "#,0,K", "#,0" )',
    '',
    "\tmeasure 'Trailing ws' = ```",
    '\t\t\tVAR x = 1 ',
    '\t\t\tRETURN x',
    '\t\t\t',
    '\t\t\t```',
    '\t\tlineageTag: m3',
    '',
    '\tcolumn Net',
    '\t\tdataType: decimal',
    '\t\tformatString: "$"#,0',
    '\t\tlineageTag: c1',
    '\t\tsummarizeBy: sum',
    '\t\tsourceColumn: Net',
    '',
    '\t\tannotation SummarizationSetBy = Automatic',
    '',
    "\tcolumn 'Order Date'",
    '\t\tdataType: dateTime',
    '\t\tformatString: General Date',
    '\t\tlineageTag: c2',
    '\t\tsummarizeBy: none',
    '\t\tsourceColumn: order date',
    '',
    '\t\tvariation Variation',
    '\t\t\tisDefault',
    '\t\t\trelationship: 0f0f0f0f-0000-0000-0000-000000000009',
    "\t\t\tdefaultHierarchy: LocalDateTable_1.'Date Hierarchy'",
    '',
    '\t\tchangedProperty = DataType',
    '',
    '\tcolumn Margin = Sales[Net] * 0.2',
    '\t\tlineageTag: c3',
    '\t\tsummarizeBy: sum',
    '\t\tisDataTypeInferred',
    '',
    '\tpartition Sales = m',
    '\t\tmode: import',
    '\t\tqueryGroup: Facts',
    '\t\tsource =',
    '\t\t\t\tlet',
    '\t\t\t\t    Source = Csv.Document(File.Contents("sales.csv"))',
    '\t\t\t\tin',
    '\t\t\t\t    Source',
    '',
    '\tannotation PBI_ResultType = Table',
    '',
    ''
  ].join('\n'),
  "tables/Product Info.tmdl": [
    "table 'Product Info'",
    '\tlineageTag: t2',
    '',
    '\tcolumn Name',
    '\t\tdataType: string',
    '\t\tisKey',
    '\t\tlineageTag: p1',
    '\t\tsummarizeBy: none',
    '\t\tsourceColumn: Name',
    '\t\tsortByColumn: \'Sort Key\'',
    '',
    "\tcolumn 'Sort Key'",
    '\t\tdataType: int64',
    '\t\tisHidden',
    '\t\tlineageTag: p2',
    '\t\tsummarizeBy: none',
    '\t\tsourceColumn: SortKey',
    '',
    "\thierarchy 'Category Hierarchy'",
    '\t\tlineageTag: h1',
    '',
    '\t\tlevel Name',
    '\t\t\tlineageTag: l1',
    '\t\t\tcolumn: Name',
    '',
    "\tpartition 'Product Info' = entity",
    '\t\tmode: directLake',
    '\t\tsource',
    '\t\t\tentityName: dim_product',
    '\t\t\tschemaName: dbo',
    '\t\t\texpressionSource: DatabaseQuery',
    '',
    ''
  ].join('\n'),
  'tables/Time.tmdl': [
    'table Time',
    '\tlineageTag: t3',
    '\tdataCategory: Time',
    '',
    '\tcalculationGroup',
    '\t\tprecedence: 10',
    '',
    '\t\tcalculationItem Current = SELECTEDMEASURE ()',
    '',
    "\t\tcalculationItem 'YoY %' =",
    '\t\t\t\tVAR c = SELECTEDMEASURE ()',
    '\t\t\t\tRETURN DIVIDE ( c, 2 )',
    '',
    '\t\t\tformatStringDefinition = "0.0%"',
    '',
    '\tcolumn Calc',
    '\t\tdataType: string',
    '\t\tlineageTag: t3c',
    '\t\tsummarizeBy: none',
    '\t\tsourceColumn: Name',
    '',
    ''
  ].join('\n'),
  'tables/Metric.tmdl': [
    'table Metric',
    '\tlineageTag: t4',
    '',
    '\tcolumn Metric',
    '\t\tlineageTag: f1',
    '\t\tsummarizeBy: none',
    '\t\tsourceColumn: [Value1]',
    '',
    '\t\trelatedColumnDetails',
    "\t\t\tgroupByColumn: 'Metric Fields'",
    '',
    "\tcolumn 'Metric Fields'",
    '\t\tisHidden',
    '\t\tlineageTag: f2',
    '\t\tsummarizeBy: none',
    '\t\tsourceColumn: [Value2]',
    '',
    '\t\textendedProperty ParameterMetadata =',
    '\t\t\t\t{',
    '\t\t\t\t  "version": 3,',
    '\t\t\t\t  "kind": 2',
    '\t\t\t\t}',
    '',
    '\tpartition Metric = calculated',
    '\t\tmode: import',
    '\t\tsource =',
    '\t\t\t\t{',
    '\t\t\t\t    ("Amount", NAMEOF(\'Sales\'[Amount]), 0)',
    '\t\t\t\t}',
    '',
    ''
  ].join('\n'),
  'relationships.tmdl': [
    'relationship r1',
    '\tfromColumn: Sales.Net',
    "\ttoColumn: 'Product Info'.Name",
    '',
    'relationship r2',
    '\tisActive: false',
    '\tcrossFilteringBehavior: bothDirections',
    '\ttoCardinality: many',
    "\tfromColumn: Sales.'Order Date'",
    '\ttoColumn: Time.Calc',
    '',
    ''
  ].join('\n'),
  'expressions.tmdl': [
    'expression Server = "localhost" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]',
    '\tlineageTag: e1',
    '\tqueryGroup: Parameters',
    '',
    '\tannotation PBI_ResultType = Text',
    '',
    ''
  ].join('\n'),
  'roles/Readers.tmdl': ['role Readers', '\tmodelPermission: read', '', '\ttablePermission Sales = [Net] > 0', '', ''].join('\n'),
  'cultures/en-US.tmdl': ['cultureInfo en-US', '', '\tlinguisticMetadata =', '\t\t\t{"Version":"1.0.0","Language":"en-US"}', '\t\tcontentType: json', '', ''].join('\n')
}

describe('TMDL names', () => {
  it('quotes and splits names', () => {
    expect(quoteName('Sales')).toBe('Sales')
    expect(quoteName('a-b_c1')).toBe('a-b_c1')
    expect(quoteName('Order Date')).toBe("'Order Date'")
    expect(quoteName("it's")).toBe("'it''s'")
    expect(quoteName('a.b')).toBe("'a.b'")
    expect(parseQualified("'My T'.'Col x'")).toEqual({ table: 'My T', member: 'Col x' })
    expect(parseQualified('T.C')).toEqual({ table: 'T', member: 'C' })
    expect(parseQualified("'a.b'.c")).toEqual({ table: 'a.b', member: 'c' })
  })
  it('encodes text values', () => {
    expect(encodeTextValue('"TRUE";"FALSE"')).toBe('"""TRUE"";""FALSE"""')
    expect(decodeTextValue('"""TRUE"";""FALSE"""')).toBe('"TRUE";"FALSE"')
    expect(encodeTextValue('"$"#,0')).toBe('"$"#,0')
    expect(decodeTextValue('"$"#,0')).toBe('"$"#,0')
    expect(encodeTextValue(' padded')).toBe('" padded"')
  })
})

describe('TMDL parser', () => {
  it('parses declarations, descriptions and expressions', () => {
    const doc = parseTmdlText(files['tables/Sales.tmdl'])
    expect(doc.errors).toEqual([])
    const t = doc.nodes[0]
    expect(t.keyword).toBe('table')
    expect(t.description).toBe('Fact table with one row per order line')
    const ly = t.children.find((c) => c.name === 'Amount LY')!
    expect(ly.value).toBe("\nCALCULATE (\n    [Amount],\n    SAMEPERIODLASTYEAR ( 'Time'[Date] )\n)")
    const fenced = t.children.find((c) => c.name === 'Trailing ws')!
    expect(fenced.fenced).toBe(true)
    expect(fenced.value).toBe('VAR x = 1 \nRETURN x\n')
    const part = t.children.find((c) => c.keyword === 'partition')!
    expect(part.children.find((c) => c.keyword === 'source')!.value).toBe('let\n    Source = Csv.Document(File.Contents("sales.csv"))\nin\n    Source')
  })
  it('handles property-style expressions (one level deeper)', () => {
    const doc = parseTmdlText(['table X', '\trefreshPolicy', '\t\tpolicyType: basic', '\t\tpollingExpression =', '\t\t\tlet', '\t\t\t    a = 1', '\t\t\tin a', '\t\tsourceExpression = x', ''].join('\n'))
    const rp = doc.nodes[0].children[0]
    expect(rp.children.map((c) => c.keyword)).toEqual(['policyType', 'pollingExpression', 'sourceExpression'])
    expect(rp.children[1].value).toBe('let\n    a = 1\nin a')
  })
  it('reports bad syntax with line numbers', () => {
    const doc = parseTmdlText('table X\n\t\t\tcolumn Y\n\t?? what\n')
    expect(doc.errors.length).toBeGreaterThan(0)
    expect(doc.errors[0].line).toBe(2)
  })
})

describe('TMDL model mapping', () => {
  const { model, errors } = readTmdlFiles(files)
  it('reads the model faithfully', () => {
    expect(errors).toEqual([])
    expect(model.tables.map((t) => t.name)).toEqual(['Sales', 'Product Info', 'Time', 'Metric'])
    expect(model.compatibilityLevel).toBe(1600)
    expect(model.discourageImplicitMeasures).toBe(true)
    expect(model.dataAccessOptions).toEqual({ legacyRedirects: true, returnErrorValuesAsNull: true })
    expect(model.queryGroups).toEqual([{ name: 'Facts', annotations: { PBI_QueryGroupOrder: '0' } }])
    const sales = model.tables[0]
    expect(sales.description).toBe('Fact table with one row per order line')
    expect(sales.measures[0]).toMatchObject({ name: 'Amount', expression: 'SUM(Sales[Net])', formatString: '#,0.00', displayFolder: 'Base', description: 'Total amount' })
    expect(sales.measures[1].formatString).toBe('"Yes";"Yes";"No"')
    expect(sales.measures[1].formatStringDefinition?.expression).toBe('IF ( [Amount] > 1000, "#,0,K", "#,0" )')
    expect(sales.columns[0]).toMatchObject({ name: 'Net', dataType: 'decimal', kind: 'data', formatString: '"$"#,0', summarizeBy: 'sum', sourceColumn: 'Net' })
    expect(sales.columns[1].variations).toEqual([
      { name: 'Variation', isDefault: true, relationship: '0f0f0f0f-0000-0000-0000-000000000009', defaultHierarchy: "LocalDateTable_1.'Date Hierarchy'" }
    ])
    expect(sales.columns[1].changedProperties).toEqual(['DataType'])
    expect(sales.columns[2]).toMatchObject({ kind: 'calculated', expression: 'Sales[Net] * 0.2', dataType: 'unknown', extra: { isDataTypeInferred: true } })
    expect(sales.partitions[0]).toMatchObject({ sourceType: 'm', mode: 'import', queryGroup: 'Facts' })
    const prod = model.tables[1]
    expect(prod.columns[0]).toMatchObject({ isKey: true, sortByColumn: 'Sort Key' })
    expect(prod.hierarchies[0].levels).toEqual([{ name: 'Name', column: 'Name', ordinal: 0, lineageTag: 'l1' }])
    expect(prod.partitions[0]).toMatchObject({ sourceType: 'entity', mode: 'directLake', entityName: 'dim_product', schemaName: 'dbo', expressionSource: 'DatabaseQuery' })
    const time = model.tables[2]
    expect(time.calculationGroup?.precedence).toBe(10)
    expect(time.calculationGroup?.items.map((i) => i.name)).toEqual(['Current', 'YoY %'])
    expect(time.calculationGroup?.items[1].formatStringDefinition?.expression).toBe('"0.0%"')
    const metric = model.tables[3]
    expect(metric.columns[0].kind).toBe('calculatedTableColumn')
    expect(metric.columns[1].extendedProperties).toEqual({ ParameterMetadata: { version: 3, kind: 2 } })
    expect(model.relationships[0]).toMatchObject({ fromTable: 'Sales', fromColumn: 'Net', toTable: 'Product Info', toColumn: 'Name', isActive: true, crossFilteringBehavior: 'oneDirection', fromCardinality: 'many', toCardinality: 'one' })
    expect(model.relationships[1]).toMatchObject({ isActive: false, crossFilteringBehavior: 'bothDirections', toCardinality: 'many' })
    expect(model.expressions[0]).toMatchObject({ name: 'Server', kind: 'm', queryGroup: 'Parameters' })
    expect(model.expressions[0].expression).toContain('meta [IsParameterQuery=true')
    expect(model.roles[0]).toMatchObject({ name: 'Readers', modelPermission: 'read', tablePermissions: [{ table: 'Sales', filterExpression: '[Net] > 0' }] })
    expect(model.cultures?.[0].raw).toBe(files['cultures/en-US.tmdl'])
  })

  it('writes the input back byte-identically', () => {
    const out = writeTmdlFiles(model).files
    for (const [p, text] of Object.entries(files)) expect(out[p], p).toBe(text)
  })

  it('canonical output (no hints) re-parses to the same model', () => {
    const out = writeTmdlFiles(structuredClone(model)).files
    expect(readTmdlFiles(out).model).toEqual(model)
    // and is itself Power BI style
    expect(out['tables/Sales.tmdl']).toContain(`${T}measure Amount = SUM(Sales[Net])\n${T}${T}formatString: #,0.00\n`)
  })

  it('edits produce canonical text only where changed', () => {
    const m2 = readTmdlFiles(files).model
    m2.tables[0].measures[0].expression = 'SUM(Sales[Net]) * 2'
    m2.tables[0].columns.push({ name: 'New Col', dataType: 'string', kind: 'data', sourceColumn: 'new', summarizeBy: 'none', lineageTag: 'n1' })
    const out = writeTmdlFiles(m2).files['tables/Sales.tmdl']
    expect(out).toContain('\tmeasure Amount = SUM(Sales[Net]) * 2\n')
    expect(out).toContain("\tcolumn 'New Col'\n\t\tdataType: string\n\t\tlineageTag: n1\n\t\tsummarizeBy: none\n\t\tsourceColumn: new\n")
    // new column inserted after the last existing column, before the partition
    expect(out.indexOf("column 'New Col'")).toBeLessThan(out.indexOf('partition Sales'))
    expect(out.indexOf("column 'New Col'")).toBeGreaterThan(out.indexOf('column Margin'))
    expect(readTmdlFiles(writeTmdlFiles(m2).files).model).toEqual(m2)
  })

  it('round-trips through TMSL (model.bim)', () => {
    const { json } = writeTmsl(model)
    expect(json.compatibilityLevel).toBe(1600)
    const sales = json.model.tables[0]
    expect(sales.measures[1].expression).toEqual(['', 'CALCULATE (', '    [Amount],', "    SAMEPERIODLASTYEAR ( 'Time'[Date] )", ')'])
    const metric = json.model.tables[3]
    expect(metric.columns[0].relatedColumnDetails).toEqual({ groupByColumns: [{ groupingColumn: 'Metric Fields' }] })
    expect(metric.columns[1].extendedProperties).toEqual([{ type: 'json', name: 'ParameterMetadata', value: { version: 3, kind: 2 } }])
    expect(json.model.cultures[0].linguisticMetadata).toEqual({ content: { Version: '1.0.0', Language: 'en-US' }, contentType: 'json' })
    const back = readTmsl(JSON.parse(JSON.stringify(json))).model
    expect(back.tables.map((t) => t.name)).toEqual(model.tables.map((t) => t.name))
    expect(back.tables[0].measures).toEqual(model.tables[0].measures)
    expect(back.relationships).toEqual(model.relationships)
    expect(back.tables[3].columns[0].extra).toEqual(model.tables[3].columns[0].extra)
    // TMSL -> TMSL is stable
    expect(writeTmsl(back).json).toEqual(json)
    // TMSL -> TMDL -> model keeps the content
    const viaTmdl = readTmdlFiles(writeTmdlFiles(back).files).model
    expect(viaTmdl.tables[2].calculationGroup).toEqual(back.tables[2].calculationGroup)
  })
})
