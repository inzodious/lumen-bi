/**
 * The sample dataset behind sample visuals (see spec.ts): a small model with its rows, kept beside the semantic
 * model as the Lumen-only file `sampleData.lumen.json` (in `SemanticModel.sidecarFiles`, like the diagram sidecar).
 * It never becomes part of the report's model: Lumen builds a separate engine from it for sample visuals only, so
 * the Data pane, saved TMDL, refresh and Power BI Desktop never see it.
 *
 *   {
 *     "$lumen": "sampleData", "version": 1,
 *     "tables": [{ "name": "Streams", "columns": [{ "name": "Month", "type": "string", "sortBy": "MonthNo" }, …], "rows": [["Jan", 1, …], …] }],
 *     "measures": [{ "table": "_Pulse", "name": "Streams", "expression": "SUM(Streams[Streams])", "format": "#,0" }],
 *     "relationships": [{ "from": "Sales.ProductKey", "to": "Product.ProductKey" }]
 *   }
 *
 * Dates are written "YYYY-MM-DD". A measure's table needs no columns: one that is not listed becomes a measures-only table.
 */
import type { ColumnDef, DataType, SemanticModel, TableDef } from '../model/types'
import { emptyModel } from '../model/types'
import { emptyDataStore, makeDate, type DataStore, type Scalar, type TableData } from '../model/data'

export const SAMPLE_DATA_FILE = 'sampleData.lumen.json'

export type SampleColumnType = 'string' | 'int64' | 'double' | 'dateTime' | 'boolean'

export interface SampleColumn {
  name: string
  type: SampleColumnType
  sortBy?: string
  format?: string
  hidden?: boolean
  /** dataCategory, e.g. 'Country' for map locations */
  category?: string
}

export interface SampleTable {
  name: string
  columns: SampleColumn[]
  rows: Array<Array<string | number | boolean | null>>
}

export interface SampleMeasure {
  table: string
  name: string
  expression: string
  format?: string
}

export interface SampleDataset {
  $lumen: 'sampleData'
  version: 1
  tables: SampleTable[]
  measures: SampleMeasure[]
  relationships?: Array<{ from: string; to: string }>
}

const TYPES = new Set<SampleColumnType>(['string', 'int64', 'double', 'dateTime', 'boolean'])

/** Parse `sampleData.lumen.json`; undefined when it is missing or not a sample dataset. */
export function parseSampleDataset(text: string | undefined): SampleDataset | undefined {
  if (!text) return undefined
  try {
    const o = JSON.parse(text)
    if (!o || o.$lumen !== 'sampleData' || !Array.isArray(o.tables)) return undefined
    const tables: SampleTable[] = []
    for (const t of o.tables) {
      if (!t || typeof t.name !== 'string' || !Array.isArray(t.columns) || !Array.isArray(t.rows)) continue
      const columns = t.columns.filter((c: any) => c && typeof c.name === 'string' && TYPES.has(c.type))
      if (columns.length !== t.columns.length) continue
      tables.push({ name: t.name, columns, rows: t.rows.filter((r: unknown) => Array.isArray(r)) })
    }
    const measures: SampleMeasure[] = (Array.isArray(o.measures) ? o.measures : []).filter(
      (m: any) => m && typeof m.table === 'string' && typeof m.name === 'string' && typeof m.expression === 'string'
    )
    const relationships = (Array.isArray(o.relationships) ? o.relationships : []).filter((r: any) => r && typeof r.from === 'string' && typeof r.to === 'string')
    return { $lumen: 'sampleData', version: 1, tables, measures, relationships }
  } catch {
    return undefined
  }
}

export function serializeSampleDataset(ds: SampleDataset): string {
  return JSON.stringify(ds) + '\n'
}

function scalar(v: unknown, type: SampleColumnType): Scalar {
  if (v === null || v === undefined) return null
  if (type === 'dateTime') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v))
    return m ? makeDate(Number(m[1]), Number(m[2]), Number(m[3])) : null
  }
  if (type === 'int64') return Math.round(Number(v))
  if (type === 'double') return Number(v)
  if (type === 'boolean') return v === true || v === 'true'
  return String(v)
}

function splitRef(ref: string): [string, string] {
  const i = ref.lastIndexOf('.')
  return [ref.slice(0, i), ref.slice(i + 1)]
}

/** The model and data a sample engine is built from. */
export function sampleDatasetModel(ds: SampleDataset): { model: SemanticModel; data: DataStore } {
  const model = emptyModel('Sample')
  const data = emptyDataStore()
  const tables = new Map<string, TableDef>()
  for (const t of ds.tables) {
    const columns: ColumnDef[] = t.columns.map((c) => ({
      name: c.name,
      dataType: c.type as DataType,
      kind: 'data',
      sourceColumn: c.name,
      formatString: c.format ?? (c.type === 'dateTime' ? 'Short Date' : c.type === 'int64' ? '0' : undefined),
      isHidden: c.hidden,
      sortByColumn: c.sortBy,
      dataCategory: c.category,
      summarizeBy: c.type === 'int64' || c.type === 'double' ? 'sum' : 'none'
    }))
    const def: TableDef = { name: t.name, columns, measures: [], hierarchies: [], partitions: [{ name: t.name, sourceType: 'm', mode: 'import', expression: '#table({}, {})' }] }
    tables.set(t.name, def)
    model.tables.push(def)
    const td: TableData = {
      columns: t.columns.map((c, i) => ({ name: c.name, type: c.type as DataType, values: t.rows.map((r) => scalar(r[i], c.type)) })),
      rowCount: t.rows.length
    }
    data.tables.set(t.name, td)
    data.status.set(t.name, { state: 'loaded', source: 'import', rowCount: td.rowCount })
  }
  for (const m of ds.measures) {
    let home = tables.get(m.table)
    if (!home) {
      home = { name: m.table, columns: [{ name: 'Column1', dataType: 'string', kind: 'data', sourceColumn: 'Column1', isHidden: true, summarizeBy: 'none' }], measures: [], hierarchies: [], partitions: [{ name: m.table, sourceType: 'm', mode: 'import', expression: '#table({}, {})' }] }
      tables.set(m.table, home)
      model.tables.push(home)
      data.tables.set(m.table, { columns: [{ name: 'Column1', type: 'string', values: [] }], rowCount: 0 })
      data.status.set(m.table, { state: 'loaded', source: 'import', rowCount: 0 })
    }
    home.measures.push({ name: m.name, expression: m.expression, formatString: m.format })
  }
  for (const r of ds.relationships ?? []) {
    const [fromTable, fromColumn] = splitRef(r.from)
    const [toTable, toColumn] = splitRef(r.to)
    model.relationships.push({
      name: `${r.from}->${r.to}`,
      fromTable,
      fromColumn,
      toTable,
      toColumn,
      fromCardinality: 'many',
      toCardinality: 'one',
      crossFilteringBehavior: 'oneDirection',
      isActive: true
    })
  }
  return { model, data }
}
