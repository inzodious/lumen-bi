/**
 * Builds a Lumen `SemanticModel` (src/core/model/types.ts) for a universe's gold star schema:
 * import partitions in M reading the gold Parquet files through a `LakehousePath` parameter, the
 * date table, relationships (incl. inactive role-playing + bidirectional bridge), hierarchies,
 * display folders, a `_Measures` table, a time-intelligence calculation group and an optional
 * field parameter. Pure TS: usable by the Node CLI (TMDL output) and the app (in-memory samples).
 */
import type { CalculationItemDef, ColumnDef, HierarchyDef, MeasureDef, PartitionDef, RelationshipDef, SemanticModel, SummarizeBy, TableDef } from '../../../../src/core/model/types.ts'
import { uuidFrom } from '../prng.ts'
import { allTables, DATE_TABLE } from '../runner.ts'
import { kindToDataType, modelColumnName } from '../schema.ts'
import type { ColumnSpec, TableSpec, Universe } from '../schema.ts'

export const MEASURES_TABLE = '_Measures'
export const CALC_GROUP_TABLE = 'Time Intelligence'
export const LAKEHOUSE_PARAM = 'LakehousePath'

export interface ModelBuildOptions {
  /** Default value of the LakehousePath parameter (absolute path of `<Name>.Lakehouse`). */
  lakehousePath?: string
  /** gold table → Parquet files relative to the table folder (default: ['part-00000.parquet']). */
  partitionFiles?: Map<string, string[]>
}

/** DAX-quoted table reference: 'Date', Sales → 'Sales' (always quoted: safe for any name). */
export function daxTable(name: string): string {
  return `'${name.replace(/'/g, "''")}'`
}

export function daxColumn(table: string, column: string): string {
  return `${daxTable(table)}[${column.replace(/]/g, ']]')}]`
}

function mString(s: string): string {
  return `"${s.replace(/"/g, '""')}"`
}

function isKeyColumn(col: ColumnSpec): boolean {
  return col.kind === 'int' && /(_key|_id|_sk)$/.test(col.name)
}

function defaultFormat(col: ColumnSpec, isFact: boolean): string | undefined {
  if (col.format) return col.format
  switch (col.kind) {
    case 'date':
      return 'Short Date'
    case 'timestamp':
      return 'General Date'
    case 'decimal':
      return '#,0.00'
    case 'double':
      return '#,0.00'
    case 'int':
      return isKeyColumn(col) ? '0' : isFact ? '#,0' : '0'
    default:
      return undefined
  }
}

function defaultSummarize(col: ColumnSpec, spec: TableSpec): SummarizeBy {
  if (col.summarize) return col.summarize
  const numeric = col.kind === 'int' || col.kind === 'double' || col.kind === 'decimal'
  if (!numeric || isKeyColumn(col)) return 'none'
  return spec.kind === 'fact' || spec.kind === 'aggregate' ? 'sum' : 'none'
}

function partitionExpression(spec: TableSpec, files: string[], excluded: string[]): string {
  const base = `${LAKEHOUSE_PARAM} & "/Tables/${spec.name}/`
  const lines: string[] = ['let']
  if (files.length === 1) {
    lines.push(`    Source = Parquet.Document(File.Contents(${base}${files[0]}"))`)
  } else {
    lines.push(`    Files = {${files.map(mString).join(', ')}},`)
    lines.push(`    Parts = List.Transform(Files, each Parquet.Document(File.Contents(${base}" & _))),`)
    lines.push('    Source = Table.Combine(Parts)')
  }
  let last = 'Source'
  if (excluded.length) {
    lines[lines.length - 1] += ','
    lines.push(`    #"Removed Columns" = Table.RemoveColumns(Source, {${excluded.map(mString).join(', ')}}, MissingField.Ignore)`)
    last = '#"Removed Columns"'
  }
  lines.push('in', `    ${last}`)
  return lines.join('\n')
}

function tableDef(u: Universe, spec: TableSpec, files: string[]): TableDef {
  const m = spec.model!
  const isFact = spec.kind === 'fact' || spec.kind === 'aggregate' || spec.kind === 'bridge'
  const byName = new Map(spec.columns.map((col) => [col.name, col]))
  const included = spec.columns.filter((col) => !col.exclude)
  const columns: ColumnDef[] = included.map((col) => {
    const def: ColumnDef = {
      name: modelColumnName(col),
      dataType: kindToDataType(col.kind),
      kind: 'data',
      sourceColumn: col.name,
      formatString: defaultFormat(col, isFact),
      summarizeBy: defaultSummarize(col, spec),
      lineageTag: uuidFrom(`${u.id}/${spec.name}/${col.name}`),
      description: col.description,
      annotations: { SummarizationSetBy: 'Automatic' }
    }
    const hidden = col.hidden ?? isKeyColumn(col)
    if (hidden) def.isHidden = true
    if (col.folder) def.displayFolder = col.folder
    if (col.category) def.dataCategory = col.category
    if (col.sortBy) {
      const target = byName.get(col.sortBy)
      if (!target) throw new Error(`${spec.name}.${col.name}: sortBy column ${col.sortBy} not found`)
      def.sortByColumn = modelColumnName(target)
      def.changedProperties = ['SortByColumn']
    }
    if (col.kind === 'date') def.annotations = { ...def.annotations, UnderlyingDateTimeDataType: 'Date' }
    if (m.dateColumn === col.name) def.isKey = true
    return def
  })
  const hierarchies: HierarchyDef[] = (m.hierarchies ?? []).map((h) => ({
    name: h.name,
    lineageTag: uuidFrom(`${u.id}/${spec.name}/h/${h.name}`),
    levels: h.levels.map((lv, i) => {
      const col = byName.get(lv)
      if (!col) throw new Error(`${spec.name}: hierarchy ${h.name} level ${lv} not found`)
      return { name: modelColumnName(col), column: modelColumnName(col), ordinal: i, lineageTag: uuidFrom(`${u.id}/${spec.name}/h/${h.name}/${lv}`) }
    })
  }))
  const partition: PartitionDef = {
    name: m.name,
    mode: 'import',
    sourceType: 'm',
    queryGroup: isFact ? 'Facts' : 'Dimensions',
    expression: partitionExpression(
      spec,
      files,
      spec.columns.filter((col) => col.exclude).map((col) => col.name)
    )
  }
  const def: TableDef = {
    name: m.name,
    description: m.description ?? spec.description,
    lineageTag: uuidFrom(`${u.id}/${spec.name}`),
    columns,
    measures: [],
    hierarchies,
    partitions: [partition],
    annotations: { PBI_ResultType: 'Table' }
  }
  if (m.hidden) def.isHidden = true
  if (m.dateColumn) def.dataCategory = 'Time'
  return def
}

function measuresTable(u: Universe): TableDef {
  const measures: MeasureDef[] = u.measures.map((ms) => {
    const def: MeasureDef = {
      name: ms.name,
      expression: ms.expr.trim(),
      lineageTag: uuidFrom(`${u.id}/measure/${ms.name}`)
    }
    if (ms.format) def.formatString = ms.format
    if (ms.formatExpr) def.formatStringDefinition = { expression: ms.formatExpr.trim() }
    if (ms.folder) def.displayFolder = ms.folder
    if (ms.description) def.description = ms.description
    if (ms.hidden) def.isHidden = true
    return def
  })
  return {
    name: MEASURES_TABLE,
    description: 'Home table for all explicit measures.',
    lineageTag: uuidFrom(`${u.id}/${MEASURES_TABLE}`),
    columns: [
      {
        name: 'Column',
        dataType: 'string',
        kind: 'calculatedTableColumn',
        sourceColumn: '[Column]',
        isHidden: true,
        summarizeBy: 'none',
        lineageTag: uuidFrom(`${u.id}/${MEASURES_TABLE}/Column`),
        annotations: { SummarizationSetBy: 'Automatic' }
      }
    ],
    measures,
    hierarchies: [],
    partitions: [{ name: MEASURES_TABLE, mode: 'import', sourceType: 'calculated', expression: 'ROW ( "Column", BLANK () )' }]
  }
}

/** Fiscal year-end argument for DATESYTD ("6/30" for a July fiscal start). */
export function fiscalYearEnd(startMonth: number): string | null {
  if (startMonth === 1) return null
  const endMonth = startMonth - 1
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][endMonth - 1]
  return `${endMonth}/${days}`
}

export function timeIntelligenceItems(u: Universe): CalculationItemDef[] {
  const d = daxColumn('Date', 'Date')
  const fye = fiscalYearEnd(u.fiscalYearStartMonth)
  const items: Array<Omit<CalculationItemDef, 'ordinal'>> = [
    { name: 'Current', expression: 'SELECTEDMEASURE ()' },
    { name: 'MTD', expression: `CALCULATE ( SELECTEDMEASURE (), DATESMTD ( ${d} ) )` },
    { name: 'QTD', expression: `CALCULATE ( SELECTEDMEASURE (), DATESQTD ( ${d} ) )` },
    { name: 'YTD', expression: `CALCULATE ( SELECTEDMEASURE (), DATESYTD ( ${d} ) )` }
  ]
  if (fye) items.push({ name: 'Fiscal YTD', expression: `CALCULATE ( SELECTEDMEASURE (), DATESYTD ( ${d}, "${fye}" ) )` })
  items.push(
    { name: 'PY', expression: `CALCULATE ( SELECTEDMEASURE (), SAMEPERIODLASTYEAR ( ${d} ) )` },
    { name: 'PY YTD', expression: `CALCULATE ( SELECTEDMEASURE (), DATESYTD ( SAMEPERIODLASTYEAR ( ${d} ) ) )` },
    {
      name: 'YoY',
      expression: [
        'VAR CurrentValue = SELECTEDMEASURE ()',
        `VAR PriorValue = CALCULATE ( SELECTEDMEASURE (), SAMEPERIODLASTYEAR ( ${d} ) )`,
        'RETURN',
        '    IF ( NOT ISBLANK ( CurrentValue ) && NOT ISBLANK ( PriorValue ), CurrentValue - PriorValue )'
      ].join('\n')
    },
    {
      name: 'YoY %',
      expression: [
        'VAR CurrentValue = SELECTEDMEASURE ()',
        `VAR PriorValue = CALCULATE ( SELECTEDMEASURE (), SAMEPERIODLASTYEAR ( ${d} ) )`,
        'RETURN',
        '    DIVIDE ( CurrentValue - PriorValue, PriorValue )'
      ].join('\n'),
      formatStringDefinition: { expression: '"0.0%;-0.0%;0.0%"' }
    },
    { name: 'Rolling 3M', expression: `CALCULATE ( SELECTEDMEASURE (), DATESINPERIOD ( ${d}, MAX ( ${d} ), -3, MONTH ) )` },
    { name: 'Rolling 12M', expression: `CALCULATE ( SELECTEDMEASURE (), DATESINPERIOD ( ${d}, MAX ( ${d} ), -12, MONTH ) )` }
  )
  return items.map((it, i) => ({ ...it, ordinal: i }))
}

function calcGroupTable(u: Universe): TableDef {
  return {
    name: CALC_GROUP_TABLE,
    description: 'Calculation group: apply time intelligence to any measure (put "Time Calculation" on columns or a slicer).',
    lineageTag: uuidFrom(`${u.id}/${CALC_GROUP_TABLE}`),
    calculationGroup: { precedence: 10, items: timeIntelligenceItems(u) },
    columns: [
      {
        name: 'Time Calculation',
        dataType: 'string',
        kind: 'data',
        sourceColumn: 'Name',
        sortByColumn: 'Ordinal',
        summarizeBy: 'none',
        lineageTag: uuidFrom(`${u.id}/${CALC_GROUP_TABLE}/Name`),
        changedProperties: ['SortByColumn'],
        annotations: { SummarizationSetBy: 'Automatic' }
      },
      {
        name: 'Ordinal',
        dataType: 'int64',
        kind: 'data',
        sourceColumn: 'Ordinal',
        formatString: '0',
        isHidden: true,
        summarizeBy: 'none',
        lineageTag: uuidFrom(`${u.id}/${CALC_GROUP_TABLE}/Ordinal`),
        annotations: { SummarizationSetBy: 'Automatic' }
      }
    ],
    measures: [],
    hierarchies: [],
    partitions: []
  }
}

function fieldParameterTable(u: Universe): TableDef | null {
  const fp = u.fieldParameter
  if (!fp) return null
  const fieldsCol = `${fp.name} Fields`
  const orderCol = `${fp.name} Order`
  const rows = fp.fields.map((f, i) => `    (${JSON.stringify(f.label)}, NAMEOF ( ${f.ref} ), ${i})`)
  return {
    name: fp.name,
    description: 'Field parameter: switch the breakdown of visuals between dimensions.',
    lineageTag: uuidFrom(`${u.id}/fp/${fp.name}`),
    columns: [
      {
        name: fp.name,
        dataType: 'string',
        kind: 'calculatedTableColumn',
        sourceColumn: '[Value1]',
        sortByColumn: orderCol,
        summarizeBy: 'none',
        lineageTag: uuidFrom(`${u.id}/fp/${fp.name}/v1`),
        annotations: { SummarizationSetBy: 'Automatic' },
        extra: { relatedColumnDetails: { groupByColumn: fieldsCol } }
      },
      {
        name: fieldsCol,
        dataType: 'string',
        kind: 'calculatedTableColumn',
        sourceColumn: '[Value2]',
        sortByColumn: orderCol,
        isHidden: true,
        summarizeBy: 'none',
        lineageTag: uuidFrom(`${u.id}/fp/${fp.name}/v2`),
        extendedProperties: { ParameterMetadata: { version: 3, kind: 2 } },
        annotations: { SummarizationSetBy: 'Automatic' }
      },
      {
        name: orderCol,
        dataType: 'int64',
        kind: 'calculatedTableColumn',
        sourceColumn: '[Value3]',
        formatString: '0',
        isHidden: true,
        summarizeBy: 'sum',
        lineageTag: uuidFrom(`${u.id}/fp/${fp.name}/v3`),
        annotations: { SummarizationSetBy: 'Automatic' }
      }
    ],
    measures: [],
    hierarchies: [],
    partitions: [{ name: fp.name, mode: 'import', sourceType: 'calculated', expression: `{\n${rows.join(',\n')}\n}` }]
  }
}

function relationships(u: Universe, specs: TableSpec[]): RelationshipDef[] {
  const byName = new Map(specs.map((s) => [s.name, s]))
  const out: RelationshipDef[] = []
  for (const spec of specs) {
    if (!spec.model) continue
    for (const fk of spec.fks ?? []) {
      if (fk.noModel) continue
      const ref = byName.get(fk.table)
      if (!ref?.model) continue
      const fromCol = spec.columns.find((c) => c.name === fk.column)
      const refColName = fk.refColumn ?? ref.key[0]
      const toCol = ref.columns.find((c) => c.name === refColName)
      if (!fromCol || !toCol) throw new Error(`${spec.name}.${fk.column} → ${fk.table}.${refColName}: column missing`)
      out.push({
        name: uuidFrom(`${u.id}/rel/${spec.name}/${fk.column}/${fk.table}`),
        fromTable: spec.model.name,
        fromColumn: modelColumnName(fromCol),
        toTable: ref.model.name,
        toColumn: modelColumnName(toCol),
        fromCardinality: fk.oneToOne ? 'one' : 'many',
        toCardinality: 'one',
        crossFilteringBehavior: fk.bidirectional || fk.oneToOne ? 'bothDirections' : 'oneDirection',
        isActive: !fk.inactive
      })
    }
  }
  return out
}

export function buildSemanticModel(u: Universe, o: ModelBuildOptions = {}): SemanticModel {
  const specs = allTables(u)
  const gold = specs.filter((s) => s.layer === 'gold' && s.model)
  const tables: TableDef[] = []
  // date table first, then dimensions, bridges, facts (diagram-friendly order)
  const order = (s: TableSpec) => (s.name === DATE_TABLE ? 0 : s.kind === 'dim' ? 1 : s.kind === 'bridge' ? 2 : 3)
  for (const spec of [...gold].sort((a, b) => order(a) - order(b))) {
    tables.push(tableDef(u, spec, o.partitionFiles?.get(spec.name) ?? ['part-00000.parquet']))
  }
  tables.push(measuresTable(u))
  tables.push(calcGroupTable(u))
  const fp = fieldParameterTable(u)
  if (fp) tables.push(fp)
  const lakehouse = o.lakehousePath ?? `C:\\Data\\${u.name}.Lakehouse`
  return {
    name: 'Model',
    culture: 'en-US',
    compatibilityLevel: 1601,
    defaultPowerBIDataSourceVersion: 'powerBI_V3',
    sourceQueryCulture: 'en-US',
    discourageImplicitMeasures: true,
    dataAccessOptions: { legacyRedirects: true, returnErrorValuesAsNull: true },
    queryGroups: [
      { name: 'Parameters', annotations: { PBI_QueryGroupOrder: '0' } },
      { name: 'Dimensions', annotations: { PBI_QueryGroupOrder: '1' } },
      { name: 'Facts', annotations: { PBI_QueryGroupOrder: '2' } }
    ],
    tables,
    relationships: relationships(u, specs),
    expressions: [
      {
        name: LAKEHOUSE_PARAM,
        kind: 'm',
        expression: `${mString(lakehouse)} meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]`,
        description: `Folder of the ${u.name}.Lakehouse (contains Files/ and Tables/). Change it after moving the dataset.`,
        queryGroup: 'Parameters',
        lineageTag: uuidFrom(`${u.id}/param/${LAKEHOUSE_PARAM}`),
        annotations: { PBI_ResultType: 'Text' }
      }
    ],
    roles: [],
    annotations: {
      __PBI_TimeIntelligenceEnabled: '0',
      PBI_QueryOrder: JSON.stringify([LAKEHOUSE_PARAM, ...tables.filter((t) => t.partitions.some((p) => p.sourceType === 'm')).map((t) => t.name)])
    }
  }
}
