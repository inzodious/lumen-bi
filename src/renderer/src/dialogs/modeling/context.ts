/**
 * Helpers shared by modeling commands/dialogs/views: current project/engine access, table data,
 * calculated-table column inference.
 */
import type { ColumnDef, DataType, SemanticModel, TableDef } from '@core/model/types'
import type { Scalar, TableData } from '@core/model/data'
import type { QueryEngine } from '@core/engine/api'
import { useApp, type FieldSelection } from '../../state/store'
import { quoteTable } from '../../editors/dax/tokenizer'

export function app() {
  return useApp.getState()
}

export function currentModel(): SemanticModel | null {
  return useApp.getState().project?.model ?? null
}

export function tableData(name: string): TableData | undefined {
  const data = useApp.getState().project?.data
  if (!data) return undefined
  const direct = data.tables.get(name)
  if (direct) return direct
  const lower = name.toLowerCase()
  for (const [k, v] of data.tables) if (k.toLowerCase() === lower) return v
  return undefined
}

export function columnValues(table: string, column: string): Scalar[] | undefined {
  const t = tableData(table)
  const lower = column.toLowerCase()
  return t?.columns.find((c) => c.name.toLowerCase() === lower)?.values
}

/**
 * Home table for "New measure" (PBI behavior): the selected table, else the selected field's table,
 * else the first measure table (a table that holds measures and no visible columns), else the first
 * visible table.
 */
export function targetTable(sel: FieldSelection | null = useApp.getState().selectedField, kind: 'measure' | 'column' = 'measure'): string | null {
  const model = currentModel()
  if (!model) return null
  if (sel && model.tables.some((t) => t.name === sel.table)) return sel.table
  const visible = model.tables.filter((t) => !t.isPrivate && !t.showAsVariationsOnly && !t.calculationGroup)
  if (kind === 'measure') {
    const measureTable = visible.find((t) => t.measures.length > 0 && t.columns.every((c) => c.isHidden || c.kind === 'rowNumber' || c.kind === 'calculatedTableColumn'))
    if (measureTable) return measureTable.name
  }
  return visible.find((t) => !t.isHidden && !isCalculatedTable(t))?.name ?? visible[0]?.name ?? model.tables[0]?.name ?? null
}

export function isCalculatedTable(t: TableDef): boolean {
  return t.partitions.length > 0 && t.partitions.every((p) => p.sourceType === 'calculated')
}

/**
 * Infer the columns of a calculated table expression by evaluating it (EVALUATE <expr>).
 * Returns null when no engine is available or evaluation fails.
 */
export function inferTableColumns(engine: QueryEngine | null, expression: string): { columns: Array<{ name: string; dataType: DataType }>; error?: string } | null {
  if (!engine || !expression.trim()) return null
  try {
    const res = engine.runDaxQuery(`EVALUATE\n${expression}`)
    const t = res.tables[0]
    if (!t) return { columns: [] }
    return { columns: t.columns.map((c) => ({ name: c.name.replace(/^.*\[(.*)\]$/, '$1'), dataType: c.dataType })) }
  } catch (e) {
    return { columns: [], error: e instanceof Error ? e.message : String(e) }
  }
}

/** Infer a calculated column's data type by evaluating it over the table (row context). */
export function inferColumnType(engine: QueryEngine | null, table: string, expression: string): DataType | null {
  if (!engine || !expression.trim()) return null
  try {
    const res = engine.runDaxQuery(`EVALUATE\nTOPN(1000, SELECTCOLUMNS(${quoteTable(table)}, "__value", ${expression}))`)
    const col = res.tables[0]?.columns[0]
    if (!col) return null
    if (col.dataType !== 'unknown' && col.dataType !== 'variant') return col.dataType
    const v = res.tables[0].rows.find((r) => r[0] !== null)?.[0]
    if (v === undefined) return null
    return typeof v === 'number' ? (Number.isInteger(v) ? 'int64' : 'double') : typeof v === 'boolean' ? 'boolean' : v instanceof Date ? 'dateTime' : 'string'
  } catch {
    return null
  }
}

/** Replace a calculated table's model columns with the inferred ones, keeping properties of columns that persist. */
export function syncCalculatedTableColumns(table: TableDef, inferred: Array<{ name: string; dataType: DataType }>): void {
  const old = new Map(table.columns.map((c) => [c.name.toLowerCase(), c]))
  table.columns = inferred.map<ColumnDef>((c) => {
    const prev = old.get(c.name.toLowerCase())
    if (prev) return { ...prev, dataType: c.dataType }
    const numeric = c.dataType === 'int64' || c.dataType === 'double' || c.dataType === 'decimal'
    return { name: c.name, dataType: c.dataType, kind: 'calculatedTableColumn', sourceColumn: `[${c.name}]`, lineageTag: crypto.randomUUID(), summarizeBy: numeric ? 'sum' : 'none', annotations: { SummarizationSetBy: 'Automatic' } }
  })
}
