/**
 * Default measure tables of a new report or template: `_measures_format` holds formatting measures (dynamic titles,
 * colors, labels) and `_measures_kpi` the metrics. Each starts with one placeholder measure and the hidden `Column1`
 * of a Power BI "Enter data" table, so it shows as a measure table in Power BI Desktop and Lumen alike.
 */
import type { SemanticModel, TableDef } from '../model/types'
import type { DataStore } from '../model/data'

export const FORMAT_MEASURE_TABLE = '_measures_format'
export const KPI_MEASURE_TABLE = '_measures_kpi'
export const DEFAULT_MEASURE_TABLES = [KPI_MEASURE_TABLE, FORMAT_MEASURE_TABLE] as const

const ENTER_DATA_M = [
  'let',
  '    Source = Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText("i44FAA==", BinaryEncoding.Base64), Compression.Deflate)), let _t = ((type nullable text) meta [Serialized.Text = true]) in type table [Column1 = _t]),',
  '    #"Changed Type" = Table.TransformColumnTypes(Source,{{"Column1", type text}})',
  'in',
  '    #"Changed Type"'
].join('\n')

function uuid(): string {
  return globalThis.crypto.randomUUID()
}

export function measureTable(name: string, placeholder: string, ids: { table?: string; column?: string; measure?: string } = {}): TableDef {
  return {
    name,
    lineageTag: ids.table ?? uuid(),
    columns: [
      {
        name: 'Column1',
        dataType: 'string',
        kind: 'data',
        sourceColumn: 'Column1',
        isHidden: true,
        summarizeBy: 'none',
        lineageTag: ids.column ?? uuid(),
        annotations: { SummarizationSetBy: 'Automatic' }
      }
    ],
    measures: [{ name: placeholder, expression: 'BLANK()', formatString: '0', lineageTag: ids.measure ?? uuid() }],
    hierarchies: [],
    partitions: [{ name, sourceType: 'm', mode: 'import', queryGroup: 'Measures', expression: ENTER_DATA_M }],
    annotations: { PBI_NavigationStepName: 'Navigation', PBI_ResultType: 'Table' }
  }
}

/** Add `_measures_kpi` and `_measures_format` (and the Measures query group) to a model that lacks them. */
export function addDefaultMeasureTables(model: SemanticModel, data?: DataStore): void {
  const have = new Set(model.tables.map((t) => t.name.toLowerCase()))
  const add: TableDef[] = []
  if (!have.has(KPI_MEASURE_TABLE)) add.push(measureTable(KPI_MEASURE_TABLE, 'kpi_blank'))
  if (!have.has(FORMAT_MEASURE_TABLE)) add.push(measureTable(FORMAT_MEASURE_TABLE, 'fmt_blank'))
  if (!add.length) return
  model.tables.unshift(...add)
  if (!(model.queryGroups ?? []).some((g) => g.name === 'Measures')) model.queryGroups = [{ name: 'Measures', annotations: { PBI_QueryGroupOrder: '0' } }, ...(model.queryGroups ?? [])]
  if (data) {
    for (const t of add) {
      data.tables.set(t.name, { columns: [{ name: 'Column1', type: 'string', values: [] }], rowCount: 0 })
      data.status.set(t.name, { state: 'loaded', source: 'query', rowCount: 0 })
    }
  }
}

/** The table a new measure goes to when no table is selected: `_measures_kpi` when the model has it. */
export function defaultMeasureHome(model: SemanticModel): string | undefined {
  return model.tables.find((t) => t.name.toLowerCase() === KPI_MEASURE_TABLE)?.name
}
