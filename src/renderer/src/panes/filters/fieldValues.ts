/**
 * Field metadata + distinct values for the Filters pane. Uses the query engine when it is available
 * and falls back to reading the DataStore directly (no filter context) when the engine is missing
 * or throws — the pane must keep working with partially loaded projects.
 */
import type { DataType } from '@core/model/types'
import type { Scalar } from '@core/model/data'
import type { QueryEngine } from '@core/engine/api'
import type { ProjectDocument } from '@core/project'
import { fieldInfo, type SQExpr } from '@core/report/sq'
import { fieldDisplayName } from './filterModel'

export interface FieldMeta {
  displayName: string
  dataType: DataType
  isMeasure: boolean
  table?: string
  column?: string
}

export function fieldMeta(project: ProjectDocument | null, engine: QueryEngine | null, expr: SQExpr): FieldMeta {
  const info = fieldInfo(expr)
  const isMeasure = info.kind === 'measure' || info.kind === 'aggregation'
  let desc: ReturnType<QueryEngine['describeField']> | undefined
  try {
    desc = engine?.describeField(expr)
  } catch {
    desc = undefined
  }
  const displayName = desc?.displayName ?? fieldDisplayName(expr)
  let dataType: DataType = desc?.dataType ?? 'unknown'
  let table = desc?.column?.table ?? info.table
  let column = desc?.column?.column ?? (info.kind === 'column' ? info.property : info.kind === 'aggregation' ? info.inner?.property : undefined)
  if (info.kind === 'hierarchyLevel' && project && info.table) {
    const t = project.model.tables.find((x) => x.name === info.table)
    const h = t?.hierarchies.find((x) => x.name === info.hierarchy)
    const lvl = h?.levels.find((l) => l.name === info.level)
    if (lvl) {
      table = info.table
      column = lvl.column
    }
  }
  if (dataType === 'unknown' && project && table) {
    const t = project.model.tables.find((x) => x.name === table)
    if (info.kind === 'measure') dataType = t?.measures.find((m) => m.name === info.property)?.dataType ?? 'double'
    else if (info.kind === 'aggregation') dataType = 'double'
    else dataType = t?.columns.find((c) => c.name === column)?.dataType ?? 'unknown'
  }
  return { displayName, dataType, isMeasure, table, column }
}

export interface DistinctResult {
  values: Scalar[]
  counts?: Array<number | null>
  truncated: boolean
  /** values came from the raw table (engine unavailable) */
  fallback: boolean
}

function compareScalar(a: Scalar, b: Scalar): number {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

export function scalarKey(v: Scalar): string {
  if (v instanceof Date) return `d${v.getTime()}`
  return `${typeof v}:${String(v)}`
}

const LIMIT = 1000

export function distinctValues(project: ProjectDocument | null, engine: QueryEngine | null, expr: SQExpr, meta: FieldMeta, search = ''): DistinctResult {
  if (engine) {
    try {
      const tbl = meta.table ? `'${meta.table.replace(/'/g, "''")}'` : undefined
      const r = engine.distinctValues({ column: { kind: 'sq', expr }, search: search || undefined, limit: LIMIT + 1, withMeasure: tbl ? { kind: 'dax', expression: `COUNTROWS(${tbl})` } : undefined })
      const truncated = r.values.length > LIMIT
      return {
        values: r.values.slice(0, LIMIT),
        counts: r.measures?.slice(0, LIMIT).map((m) => (typeof m === 'number' ? m : null)),
        truncated,
        fallback: false
      }
    } catch {
      /* fall through to raw data */
    }
  }
  const td = meta.table ? project?.data.tables.get(meta.table) : undefined
  const col = td?.columns.find((c) => c.name.toLowerCase() === (meta.column ?? '').toLowerCase())
  if (!col) return { values: [], truncated: false, fallback: true }
  const counts = new Map<string, { v: Scalar; n: number }>()
  for (const v of col.values) {
    const k = scalarKey(v)
    const hit = counts.get(k)
    if (hit) hit.n++
    else counts.set(k, { v, n: 1 })
  }
  let entries = [...counts.values()].sort((a, b) => compareScalar(a.v, b.v))
  if (search) {
    const q = search.toLowerCase()
    entries = entries.filter((e) => String(e.v instanceof Date ? e.v.toISOString().slice(0, 10) : e.v ?? '').toLowerCase().includes(q))
  }
  return { values: entries.slice(0, LIMIT).map((e) => e.v), counts: entries.slice(0, LIMIT).map((e) => e.n), truncated: entries.length > LIMIT, fallback: true }
}
