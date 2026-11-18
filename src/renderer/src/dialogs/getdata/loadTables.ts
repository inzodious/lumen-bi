/**
 * Adding imported tables to the model (Get data ▸ Load): TableDef with an M partition + the parsed
 * rows loaded straight into the DataStore so the table is usable even before a refresh.
 */
import type { ColumnDef, DataType, PartitionMode, SemanticModel, TableDef, RelationshipDef } from '@core/model/types'
import { tableFromRows, type DataStore, type Scalar } from '@core/model/data'
import { useApp } from '../../state/store'
import { useShell } from '../../app/shellState'
import { blankProject } from '../../app/commands'
import { toast } from '../../app/ui/Notify'
import { defaultSummarizeBy, type ParsedTable } from './parsers'

export interface ImportTable {
  /** requested name (made unique against the model) */
  name: string
  /** M expression of the partition */
  m: string
  columns: Array<{ name: string; type: DataType }>
  /** rows to load right away (omit to leave the table empty until refresh) */
  data?: ParsedTable
  mode?: PartitionMode
}

const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`)

export function uniqueTableName(model: SemanticModel, base: string, taken: Set<string> = new Set()): string {
  const clean = base.replace(/[\r\n\t]/g, ' ').trim() || 'Table'
  const used = new Set([...model.tables.map((t) => t.name.toLowerCase()), ...[...taken].map((t) => t.toLowerCase())])
  if (!used.has(clean.toLowerCase())) return clean
  for (let i = 2; ; i++) if (!used.has(`${clean} (${i})`.toLowerCase())) return `${clean} (${i})`
}

function formatStringOf(t: DataType, allDates: boolean): string | undefined {
  if (t === 'int64') return '0'
  if (t === 'dateTime') return allDates ? 'Long Date' : 'General Date'
  if (t === 'decimal') return '\\$#,0.###############;(\\$#,0.###############);\\$#,0.###############'
  return undefined
}

function dateOnly(rows: Scalar[][] | undefined, c: number): boolean {
  if (!rows) return false
  return rows.slice(0, 2000).every((r) => {
    const v = r[c]
    return !(v instanceof Date) || (!v.getUTCHours() && !v.getUTCMinutes() && !v.getUTCSeconds())
  })
}

/** Pure: TableDef for an imported table. */
export function buildTableDef(name: string, t: ImportTable): TableDef {
  const columns: ColumnDef[] = t.columns.map((c, i) => ({
    name: c.name,
    dataType: c.type === 'unknown' ? 'string' : c.type,
    kind: 'data',
    sourceColumn: c.name,
    formatString: formatStringOf(c.type, dateOnly(t.data?.rows, i)),
    summarizeBy: defaultSummarizeBy(c.name, c.type),
    lineageTag: uuid(),
    annotations: { SummarizationSetBy: 'Automatic' }
  }))
  return {
    name,
    columns,
    measures: [],
    hierarchies: [],
    partitions: [{ name: `${name}-${uuid()}`, mode: t.mode ?? 'import', sourceType: 'm', expression: t.m }],
    lineageTag: uuid(),
    annotations: { PBI_ResultType: 'Table', PBI_NavigationStepName: 'Navigation' }
  }
}

/**
 * Pure: PBI-style relationship autodetect for newly loaded tables — same column name (case-insensitive)
 * and type in two tables, where one side's values are unique (the "one" side) and every non-blank value
 * on the many side exists on the one side. Skips pairs of tables already related.
 */
export function detectRelationships(model: SemanticModel, data: DataStore, newTables: string[]): RelationshipDef[] {
  const out: RelationshipDef[] = []
  const related = (a: string, b: string) => [...model.relationships, ...out].some((r) => (r.fromTable === a && r.toTable === b) || (r.fromTable === b && r.toTable === a))
  const valuesOf = (table: string, col: string): Scalar[] | undefined => data.tables.get(table)?.columns.find((c) => c.name.toLowerCase() === col.toLowerCase())?.values
  const key = (v: Scalar) => (v instanceof Date ? `d${v.getTime()}` : typeof v === 'string' ? `s${v.toLowerCase()}` : `${typeof v}${String(v)}`)
  for (const tn of newTables) {
    const t = model.tables.find((x) => x.name === tn)
    if (!t) continue
    for (const c of t.columns) {
      if (c.dataType === 'double' || c.dataType === 'boolean') continue
      for (const other of model.tables) {
        if (other.name === tn || related(tn, other.name)) continue
        const oc = other.columns.find((x) => x.name.toLowerCase() === c.name.toLowerCase() && x.dataType === c.dataType)
        if (!oc) continue
        const a = valuesOf(tn, c.name)
        const b = valuesOf(other.name, oc.name)
        if (!a?.length || !b?.length) continue
        const aKeys = a.filter((v) => v !== null).map(key)
        const bKeys = b.filter((v) => v !== null).map(key)
        const aUnique = new Set(aKeys).size === aKeys.length
        const bUnique = new Set(bKeys).size === bKeys.length
        let one: { table: string; col: string; keys: string[] } | null = null
        let many: { table: string; col: string; keys: string[] } | null = null
        if (bUnique && !aUnique) [one, many] = [{ table: other.name, col: oc.name, keys: bKeys }, { table: tn, col: c.name, keys: aKeys }]
        else if (aUnique && !bUnique) [one, many] = [{ table: tn, col: c.name, keys: aKeys }, { table: other.name, col: oc.name, keys: bKeys }]
        else if (aUnique && bUnique) continue // 1:1 is ambiguous; PBI asks — we skip
        if (!one || !many) continue
        const oneSet = new Set(one.keys)
        if (!many.keys.every((k) => oneSet.has(k))) continue
        out.push({
          name: uuid(),
          fromTable: many.table,
          fromColumn: many.col,
          toTable: one.table,
          toColumn: one.col,
          fromCardinality: 'many',
          toCardinality: 'one',
          crossFilteringBehavior: 'oneDirection',
          isActive: true
        })
      }
    }
  }
  return out
}

/** Add tables to the open project (creating one if needed), load their rows, rebuild the engine. */
export function loadImportedTables(tables: ImportTable[], opts: { transform?: boolean } = {}): string[] {
  let app = useApp.getState()
  if (!app.project) {
    app.setProject(blankProject())
    useShell.getState().setStartScreen(false)
    app = useApp.getState()
  }
  const project = app.project!
  const names: string[] = []
  const taken = new Set<string>()
  for (const t of tables) {
    const n = uniqueTableName(project.model, t.name, taken)
    taken.add(n)
    names.push(n)
  }
  const autoRel = useShell.getState().options.autoDetectRelationships
  app.mutateModel(tables.length === 1 ? `Load ${names[0]}` : 'Get data', (m) => {
    tables.forEach((t, i) => m.tables.push(buildTableDef(names[i], t)))
  })
  // load rows directly (data is not part of undo snapshots)
  const data = useApp.getState().project!.data
  tables.forEach((t, i) => {
    if (!t.data) {
      data.status.set(names[i], { state: 'empty', reason: 'Not loaded yet — refresh to load data' })
      return
    }
    data.tables.set(names[i], tableFromRows(t.data.columns, t.data.types.map((x) => (x === 'unknown' ? 'string' : x)), t.data.rows))
    data.status.set(names[i], { state: 'loaded', source: 'import', at: new Date().toISOString(), rowCount: t.data.rows.length })
  })
  if (autoRel) {
    const p = useApp.getState().project!
    const rels = detectRelationships(p.model, p.data, names)
    if (rels.length) useApp.getState().mutateModel('Autodetect relationships', (m) => m.relationships.push(...rels))
  }
  useApp.getState().dataChanged()
  if (opts.transform) useApp.getState().setView('powerquery')
  const rows = tables.reduce((s, t) => s + (t.data?.rows.length ?? 0), 0)
  toast({ kind: 'success', message: `Loaded ${names.length === 1 ? `"${names[0]}"` : `${names.length} tables`} (${rows.toLocaleString()} rows).`, duration: 3500 })
  return names
}
