/**
 * Metadata-only model edits for `.pbix` saves (stage D, docs/developer/file-format-io.md).
 *
 * `classifyModelChanges` compares the model read from the source `.pbix` with the document's model (both as TMSL
 * JSON) and sorts every difference into one Lumen can write into the source `metadata.sqlitedb` without touching
 * column data, or one it cannot. Only measure edits are written (add, delete, change of expression, format string,
 * description, display folder, hidden flag, data type hint, annotations): measures live only in the `Measure` table
 * (plus `Annotation` / `KPI` rows) and need no recalculation of stored data. Everything else, including
 * relationships, calculated columns and tables, hierarchies, sort-by and partitions, needs the engine to rebuild stored
 * structures; Lumen does not write those yet (no real file on disk shows how Desktop marks them for recalculation).
 */
import type { SemanticModel } from '../../../model/types'
import { deepEqual } from '../../../pbir/pbir'
import { writeTmsl } from '../../../tmdl/tmsl'

type J = Record<string, any>

/** Measure properties kept in rows of their own; edits to them are not written yet. */
const SEPARATE_ROWS = ['kpi', 'formatStringDefinition', 'detailRowsDefinition', 'changedProperties']

export interface MeasureChange {
  kind: 'measure-add' | 'measure-delete' | 'measure-update'
  table: string
  name: string
  /** TMSL JSON of the measure in the document (add / update) */
  measure?: J
  /** TMSL JSON of the measure in the source (update / delete) */
  before?: J
}

export interface ModelChangeReport {
  changes: MeasureChange[]
  /** human-readable descriptions of changes that cannot be written */
  unsupported: string[]
  summary: string
}

function byName(list: J[] | undefined): Map<string, J> {
  return new Map((list ?? []).map((x) => [x.name, x]))
}

function without(o: J, keys: string[]): J {
  const out: J = { ...o }
  for (const k of keys) delete out[k]
  return out
}

/** Differences between the source model and the document's model. */
export function classifyModelChanges(source: SemanticModel, current: SemanticModel): ModelChangeReport {
  const a = writeTmsl(source).json
  const b = writeTmsl(current).json
  const changes: MeasureChange[] = []
  const unsupported: string[] = []
  if (!deepEqual(without(a, ['model']), without(b, ['model']))) unsupported.push('Database properties changed.')
  if (!deepEqual(without(a.model, ['tables']), without(b.model, ['tables']))) {
    for (const k of new Set([...Object.keys(a.model), ...Object.keys(b.model)])) {
      if (k === 'tables' || deepEqual(a.model[k], b.model[k])) continue
      unsupported.push(`Model ${k} changed.`)
    }
  }
  const ta = byName(a.model.tables)
  const tb = byName(b.model.tables)
  for (const [name] of ta) if (!tb.has(name)) unsupported.push(`Table ${name} was removed.`)
  for (const [name, t] of tb) {
    const s = ta.get(name)
    if (!s) {
      unsupported.push(`Table ${name} was added.`)
      continue
    }
    if (!deepEqual(without(s, ['measures']), without(t, ['measures']))) {
      for (const k of new Set([...Object.keys(s), ...Object.keys(t)])) {
        if (k === 'measures' || deepEqual(s[k], t[k])) continue
        unsupported.push(`Table ${name}: ${k} changed.`)
      }
    }
    const ma = byName(s.measures)
    const mb = byName(t.measures)
    for (const [mn, m] of ma) if (!mb.has(mn)) changes.push({ kind: 'measure-delete', table: name, name: mn, before: m })
    for (const [mn, m] of mb) {
      const prev = ma.get(mn)
      // stored in their own tables (KPI, FormatStringDefinition, DetailRowsDefinition, ChangedProperty): not written yet
      const extras = SEPARATE_ROWS.filter((k) => !deepEqual(prev?.[k], m[k]))
      if (extras.length) unsupported.push(`Measure ${name}[${mn}]: ${extras.join(', ')} changed.`)
      else if (!prev) changes.push({ kind: 'measure-add', table: name, name: mn, measure: m })
      else if (!deepEqual(prev, m)) changes.push({ kind: 'measure-update', table: name, name: mn, measure: m, before: prev })
    }
  }
  const n = (k: MeasureChange['kind']): number => changes.filter((c) => c.kind === k).length
  const parts = [n('measure-add') && `${n('measure-add')} measure(s) added`, n('measure-update') && `${n('measure-update')} changed`, n('measure-delete') && `${n('measure-delete')} deleted`].filter(Boolean)
  return { changes, unsupported, summary: parts.join(', ') }
}

export interface MetadataEditResult {
  dataModel: Uint8Array
  diagnostics: string[]
}

/** Apply measure edits to a source `DataModel` stream (implemented in ./metadataWrite). */
export async function applyMetadataEdits(dataModel: Uint8Array, changes: ModelChangeReport): Promise<MetadataEditResult> {
  const { writeMeasureEdits } = await import('./metadataWrite')
  return writeMeasureEdits(dataModel, changes)
}
