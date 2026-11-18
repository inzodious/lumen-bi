/**
 * Table view decisions that do not need React (tested in tableChoice.test.ts): which table the view
 * opens on, and what to say when a table has no rows.
 */
import type { SemanticModel, TableDef } from '@core/model/types'
import type { DataStore } from '@core/model/data'

const PLACEHOLDER_COLUMN = /^(column\d*|placeholder|dummy|blank|value|x)$/i

function rowsOf(t: TableDef, data: DataStore | undefined): number {
  if (!data) return 0
  const direct = data.tables.get(t.name)
  if (direct) return direct.rowCount
  const lower = t.name.toLowerCase()
  for (const [k, v] of data.tables) if (k.toLowerCase() === lower) return v.rowCount
  return 0
}

export function isCalculatedTable(t: TableDef): boolean {
  return t.partitions.length > 0 && t.partitions.every((p) => p.sourceType === 'calculated')
}

/**
 * A table that exists to hold measures: it has measures, and its stored columns are either all hidden or
 * the single placeholder column Power BI's "Enter data" leaves behind (`Column1`). Such a table has no rows
 * by design.
 */
export function isMeasureHolder(t: TableDef): boolean {
  if (!t.measures.length || t.calculationGroup) return false
  const cols = t.columns.filter((c) => c.kind !== 'rowNumber')
  if (!cols.length) return true
  return cols.every((c) => c.isHidden) || (cols.length <= 2 && cols.every((c) => PLACEHOLDER_COLUMN.test(c.name)))
}

/** Tables the Table view can show (auto date/time and other private tables are not listed, as in Power BI Desktop). */
export function viewableTables(model: SemanticModel | undefined): TableDef[] {
  return (model?.tables ?? []).filter((t) => !t.isPrivate && !t.showAsVariationsOnly)
}

/**
 * The table the Table view opens on when nothing is selected: the first table that has rows — visible ones
 * before hidden ones — because a view that opens on an empty measure table looks as if no data was loaded.
 * Falls back to the first table that is not a measure holder, then to the first table.
 */
export function defaultTable(model: SemanticModel | undefined, data: DataStore | undefined): string | null {
  const tables = viewableTables(model)
  const withRows = tables.filter((t) => rowsOf(t, data) > 0)
  const pick = withRows.find((t) => !t.isHidden) ?? withRows[0] ?? tables.find((t) => !isMeasureHolder(t) && !t.calculationGroup && !t.isHidden) ?? tables.find((t) => !isMeasureHolder(t) && !t.calculationGroup) ?? tables[0]
  return pick?.name ?? null
}

export interface EmptyTableInfo {
  /** why there are no rows */
  kind: 'measures' | 'calculationGroup' | 'calculated' | 'error' | 'empty' | 'pending' | 'noData'
  message: string
  /** the table could be filled by a refresh or with sample data */
  loadable: boolean
}

/** Why a table shows no rows, in the user's terms; null when it has rows. */
export function emptyTableInfo(t: TableDef, data: DataStore | undefined): EmptyTableInfo | null {
  if (rowsOf(t, data) > 0) return null
  if (t.calculationGroup || t.partitions.some((p) => p.sourceType === 'calculationGroup')) {
    return { kind: 'calculationGroup', loadable: false, message: 'This is a calculation group. It holds calculation items, not rows — select it in Model view to edit its items.' }
  }
  if (isMeasureHolder(t)) {
    return { kind: 'measures', loadable: false, message: `This table only holds measures (${t.measures.length}), so it has no rows. Select a measure in the Data pane to see its formula.` }
  }
  const status = data?.status.get(t.name)
  if (status?.state === 'error') return { kind: 'error', loadable: true, message: `This table failed to load: ${status.message}` }
  if (status?.state === 'pending') return { kind: 'pending', loadable: false, message: 'Loading…' }
  if (isCalculatedTable(t)) {
    return { kind: 'calculated', loadable: false, message: 'This calculated table has no rows: its DAX expression returned none, usually because the tables it reads have no data yet.' }
  }
  if (status?.state === 'empty') return { kind: 'empty', loadable: true, message: status.reason ?? 'This table is empty.' }
  if (status?.state === 'loaded') return { kind: 'empty', loadable: false, message: status.source === 'synthetic' ? 'No sample rows were generated for this table.' : 'The source returned no rows for this table.' }
  return { kind: 'noData', loadable: true, message: 'No data is loaded for this table. Refresh it from the source, or fill the model with sample data.' }
}
