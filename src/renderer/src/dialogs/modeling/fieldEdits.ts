/**
 * Field property edits shared by the Properties pane and the Table/Column/Measure tools ribbons.
 */
import type { ColumnDef, DataType, MeasureDef, SemanticModel, TableDef } from '@core/model/types'
import type { Scalar } from '@core/model/data'
import { makeDate } from '@core/model/data'
import { useApp, type FieldSelection } from '../../state/store'
import { nameError, renameColumn, renameMeasure, renameTable } from './logic/modelOps'
import { toast } from '../../app/ui/Notify'
import { renameInReport, type RenameTarget } from './logic/reportRename'

/** Update PBIR field references (visuals, filters, bookmarks, report measures) after a model rename. */
export function renameReportReferences(target: RenameTarget, newName: string): void {
  const state = useApp.getState()
  if (!state.project?.report) return
  const oldName = target.kind === 'table' ? target.table : target.name
  if (oldName === newName) return
  state.mutateReport(`Rename ${target.kind} references`, (r) => {
    renameInReport(r, target, newName)
  })
}

export function findSelected(model: SemanticModel | undefined, sel: FieldSelection | null): { table?: TableDef; column?: ColumnDef; measure?: MeasureDef } {
  if (!model || !sel) return {}
  const table = model.tables.find((t) => t.name === sel.table)
  if (!table) return {}
  if (sel.kind === 'column') return { table, column: table.columns.find((c) => c.name === sel.name) }
  if (sel.kind === 'measure') return { table, measure: table.measures.find((m) => m.name === sel.name) }
  return { table }
}

export function editColumn(table: string, column: string, label: string, fn: (c: ColumnDef, t: TableDef) => void): void {
  useApp.getState().mutateModel(label, (m) => {
    const t = m.tables.find((x) => x.name === table)
    const c = t?.columns.find((x) => x.name === column)
    if (t && c) fn(c, t)
  })
}

export function editMeasure(table: string, measure: string, label: string, fn: (me: MeasureDef, t: TableDef) => void): void {
  useApp.getState().mutateModel(label, (m) => {
    const t = m.tables.find((x) => x.name === table)
    const me = t?.measures.find((x) => x.name === measure)
    if (t && me) fn(me, t)
  })
}

export function editTable(table: string, label: string, fn: (t: TableDef) => void): void {
  useApp.getState().mutateModel(label, (m) => {
    const t = m.tables.find((x) => x.name === table)
    if (t) fn(t)
  })
}

/** Rename the selected object (updates references like PBI). Returns false (and toasts) on invalid names. */
export function renameSelected(sel: FieldSelection, newName: string): boolean {
  const state = useApp.getState()
  const model = state.project?.model
  if (!model) return false
  const n = newName.trim()
  const current = sel.kind === 'table' ? sel.table : sel.name
  if (n === current) return true
  const err = nameError(model, sel.kind === 'table' ? 'table' : sel.kind === 'measure' ? 'measure' : 'column', n, sel.table, current)
  if (err) {
    toast({ kind: 'error', message: err })
    return false
  }
  state.mutateModel(`Rename ${sel.kind}`, (m) => {
    if (sel.kind === 'table') renameTable(m, sel.table, n)
    else if (sel.kind === 'column') renameColumn(m, sel.table, sel.name, n)
    else if (sel.kind === 'measure') renameMeasure(m, sel.table, sel.name, n)
    else {
      const h = m.tables.find((t) => t.name === sel.table)?.hierarchies.find((x) => x.name === sel.name)
      if (h) h.name = n
    }
  })
  renameReportReferences(sel.kind === 'table' ? { kind: 'table', table: sel.table } : { kind: sel.kind, table: sel.table, name: sel.name }, n)
  state.selectField(sel.kind === 'table' ? { kind: 'table', table: n } : { ...sel, name: n })
  return true
}

/** Move a measure to another home table. */
export function moveMeasure(from: string, measure: string, to: string): void {
  if (from === to) return
  useApp.getState().mutateModel('Change home table', (m) => {
    const src = m.tables.find((t) => t.name === from)
    const dst = m.tables.find((t) => t.name === to)
    const me = src?.measures.find((x) => x.name === measure)
    if (!src || !dst || !me) return
    src.measures = src.measures.filter((x) => x !== me)
    dst.measures.push(me)
  })
  useApp.getState().selectField({ kind: 'measure', table: to, name: measure })
}

function convertValue(v: Scalar, to: DataType): Scalar {
  if (v === null) return null
  switch (to) {
    case 'string':
      return v instanceof Date ? v.toISOString().slice(0, v.getUTCHours() || v.getUTCMinutes() ? 19 : 10).replace('T', ' ') : String(v)
    case 'int64': {
      const n = typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : v instanceof Date ? NaN : Number(String(v).trim())
      return Number.isFinite(n) ? Math.round(n) : null
    }
    case 'double':
    case 'decimal': {
      const n = typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : v instanceof Date ? NaN : Number(String(v).trim())
      return Number.isFinite(n) ? (to === 'decimal' ? Math.round(n * 10000) / 10000 : n) : null
    }
    case 'boolean':
      return typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : /^true$/i.test(String(v)) ? true : /^false$/i.test(String(v)) ? false : null
    case 'dateTime': {
      if (v instanceof Date) return v
      const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(v))
      if (m) return makeDate(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
      return null
    }
    default:
      return v
  }
}

/**
 * Column tools ▸ Data type. Converts loaded values (values that can't convert become blank, as PBI
 * shows errors→blank in Table view) and updates the model.
 */
export function changeDataType(table: string, column: string, to: DataType): void {
  const state = useApp.getState()
  const data = state.project?.data.tables.get(table)
  const col = data?.columns.find((c) => c.name === column)
  if (col) {
    col.values = col.values.map((v) => convertValue(v, to))
    col.type = to
  }
  editColumn(table, column, 'Change data type', (c) => {
    c.dataType = to
    const numeric = to === 'int64' || to === 'double' || to === 'decimal'
    if (!numeric && c.summarizeBy && c.summarizeBy !== 'none' && c.summarizeBy !== 'count' && c.summarizeBy !== 'distinctCount') c.summarizeBy = 'none'
    if (to === 'int64' && !c.formatString) c.formatString = '0'
    if (to === 'dateTime' && (!c.formatString || /0|#/.test(c.formatString))) c.formatString = 'General Date'
    if (to === 'string' || to === 'boolean') delete c.formatString
  })
}

const SYN = 'WBI_Synonyms'
/**
 * Synonyms live in the culture's linguistic schema in PBI (Q&A). We keep them as an annotation so
 * they round-trip through our own saves; they are not written into the linguistic schema (gap).
 */
export function getSynonyms(obj: { annotations?: Record<string, string> } | undefined): string {
  return obj?.annotations?.[SYN] ?? ''
}
export function setSynonymsOn(obj: { annotations?: Record<string, string> }, value: string): void {
  const v = value.split(',').map((s) => s.trim()).filter(Boolean).join(', ')
  if (!v) {
    if (obj.annotations) delete obj.annotations[SYN]
    return
  }
  obj.annotations = { ...(obj.annotations ?? {}), [SYN]: v }
}
