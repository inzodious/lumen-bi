/**
 * The Power Query Editor's working copy of the model's queries (pure). Edits (steps, renames, new /
 * deleted / duplicated queries, groups, Enable load) stay in the draft until Apply writes them to the
 * model through `applyDraft` (called inside `mutateModel`).
 *
 * Model mapping (as Power BI Desktop does it):
 *  - a loaded query = an import table whose M partition holds the query text (`partition.queryGroup`);
 *  - a query with load disabled / a parameter / a function = a shared expression (`model.expressions`);
 *  - renaming a loaded query renames the table (DAX + relationships via the modeling rename helper);
 *  - deleting a loaded query deletes its table; disabling load turns the table into an expression;
 *  - enabling load on an expression creates an import table typed from the preview's columns.
 */
import type { ColumnDef, DataType, SemanticModel, TableDef } from '@core/model/types'
import { expressionKind, listQueries, type QueryItem, type QueryKind } from '@core/data/queries'
import { renameTable } from '../../../dialogs/modeling/logic/modelOps'
import { pqTypeOf } from './mtext'
import { renameReferences, referencesName } from './steps'
import type { ColInfo } from './transforms'

export type QueryOrigin = { kind: 'table'; table: string; partitionIndex: number } | { kind: 'expression'; name: string }

export interface DraftQuery {
  /** stable id while the editor is open */
  id: string
  name: string
  kind: QueryKind
  group?: string
  source: string
  description?: string
  loadEnabled: boolean
  /** where the query lives in the model (undefined for a new query) */
  origin?: QueryOrigin
}

export interface Draft {
  queries: DraftQuery[]
  /** model queries deleted in the editor */
  deleted: QueryOrigin[]
  /** query groups created in the editor that may still be empty */
  groups: string[]
}

let seq = 0
const newId = () => `q${++seq}-${Date.now().toString(36)}`

function originKey(o: QueryOrigin | undefined): string {
  if (!o) return ''
  return o.kind === 'table' ? `t:${o.table}` : `e:${o.name}`
}

function fromItem(q: QueryItem): DraftQuery {
  return {
    id: newId(),
    name: q.name,
    kind: q.kind,
    group: q.group,
    source: q.source,
    description: q.description,
    loadEnabled: q.loadEnabled,
    origin: q.kind === 'table' ? { kind: 'table', table: q.table!, partitionIndex: q.partitionIndex! } : { kind: 'expression', name: q.name }
  }
}

export function draftFromModel(model: SemanticModel): Draft {
  return { queries: listQueries(model).map(fromItem), deleted: [], groups: [] }
}

/** Adds queries that appeared in the model meanwhile (e.g. Get data while the editor is open). */
export function syncDraft(draft: Draft, model: SemanticModel): Draft {
  const known = new Set([...draft.queries.map((q) => originKey(q.origin)), ...draft.deleted.map(originKey)])
  const extra = listQueries(model)
    .map(fromItem)
    .filter((q) => !known.has(originKey(q.origin)))
  return extra.length ? { ...draft, queries: [...draft.queries, ...extra] } : draft
}

/** Kind of a query from its text and load setting (parameter / function / loaded table / query). */
export function kindOfSource(source: string, loadEnabled: boolean): QueryKind {
  const k = expressionKind({ name: '', kind: 'm', expression: source })
  return k === 'query' && loadEnabled ? 'table' : k
}

export interface DraftChange {
  query: DraftQuery
  kind: 'new' | 'changed'
}

/** What Apply would write: changed / new queries, plus deletions. */
export function draftChanges(draft: Draft, model: SemanticModel): { changed: DraftChange[]; deleted: QueryOrigin[] } {
  const base = new Map(listQueries(model).map((q) => [originKey(fromItem(q).origin), q]))
  const changed: DraftChange[] = []
  for (const q of draft.queries) {
    const b = q.origin ? base.get(originKey(q.origin)) : undefined
    if (!b) changed.push({ query: q, kind: 'new' })
    else if (b.name !== q.name || b.source !== q.source || (b.group ?? '') !== (q.group ?? '') || b.loadEnabled !== q.loadEnabled || (b.description ?? '') !== (q.description ?? '')) changed.push({ query: q, kind: 'changed' })
  }
  return { changed, deleted: draft.deleted.filter((o) => base.has(originKey(o))) }
}

export function isDirty(draft: Draft, model: SemanticModel): boolean {
  const c = draftChanges(draft, model)
  return c.changed.length > 0 || c.deleted.length > 0
}

// ---------------------------------------------------------------------------------------------
// Draft operations

export function updateQuery(draft: Draft, id: string, patch: Partial<Omit<DraftQuery, 'id' | 'origin'>>): Draft {
  return {
    ...draft,
    queries: draft.queries.map((q) => {
      if (q.id !== id) return q
      const next = { ...q, ...patch }
      if (patch.source !== undefined || patch.loadEnabled !== undefined) next.kind = kindOfSource(next.source, next.loadEnabled)
      return next
    })
  }
}

/** Query names are unique (case-insensitive) like Power Query. */
export function queryNameError(draft: Draft, name: string, selfId?: string): string | null {
  const n = name.trim()
  if (!n) return 'The query name cannot be empty.'
  if (/[\t\n\r]/.test(n) || /["]/.test(n)) return 'The query name contains invalid characters.'
  if (draft.queries.some((q) => q.id !== selfId && q.name.toLowerCase() === n.toLowerCase())) return `A query with the name '${n}' already exists.`
  return null
}

/** Renames a query and updates references to it in every other query (PQ does this). */
export function renameQuery(draft: Draft, id: string, name: string): Draft {
  const q = draft.queries.find((x) => x.id === id)
  if (!q || q.name === name) return draft
  const old = q.name
  return {
    ...draft,
    queries: draft.queries.map((x) => (x.id === id ? { ...x, name } : referencesName(x.source, old) ? { ...x, source: renameReferences(x.source, old, name) } : x))
  }
}

/** `Sales (2)`, `Sales (3)`… */
export function copyName(draft: Draft, base: string): string {
  const taken = new Set(draft.queries.map((q) => q.name.toLowerCase()))
  for (let n = 2; ; n++) if (!taken.has(`${base} (${n})`.toLowerCase())) return `${base} (${n})`
}

/** `Query1`, `Query2`… */
export function newQueryName(draft: Draft, base = 'Query'): string {
  const taken = new Set(draft.queries.map((q) => q.name.toLowerCase()))
  for (let n = 1; ; n++) if (!taken.has(`${base}${n}`.toLowerCase())) return `${base}${n}`
}

export function addQuery(draft: Draft, q: Omit<DraftQuery, 'id'>, after?: string): { draft: Draft; id: string } {
  const id = newId()
  const queries = [...draft.queries]
  const i = after ? queries.findIndex((x) => x.id === after) : -1
  const item = { ...q, id }
  if (i >= 0) queries.splice(i + 1, 0, item)
  else queries.push(item)
  return { draft: { ...draft, queries }, id }
}

export function duplicateQuery(draft: Draft, id: string): { draft: Draft; id: string } | null {
  const q = draft.queries.find((x) => x.id === id)
  if (!q) return null
  return addQuery(draft, { name: copyName(draft, q.name), kind: q.kind, group: q.group, source: q.source, description: q.description, loadEnabled: q.loadEnabled }, id)
}

/** Reference: a new query whose Source is the referenced query (`let Source = Sales in Source`). */
export function referenceQuery(draft: Draft, id: string): { draft: Draft; id: string } | null {
  const q = draft.queries.find((x) => x.id === id)
  if (!q) return null
  const ref = /^[A-Za-z_][A-Za-z0-9_]*$/.test(q.name) ? q.name : `#"${q.name.replace(/"/g, '""')}"`
  return addQuery(draft, { name: copyName(draft, q.name), kind: q.kind === 'table' ? 'table' : 'query', group: q.group, source: `let\n    Source = ${ref}\nin\n    Source`, loadEnabled: q.kind === 'table' }, id)
}

export function deleteQuery(draft: Draft, id: string): Draft {
  const q = draft.queries.find((x) => x.id === id)
  if (!q) return draft
  return { ...draft, queries: draft.queries.filter((x) => x.id !== id), deleted: q.origin ? [...draft.deleted, q.origin] : draft.deleted }
}

/** Names of the queries that reference `name` (Delete warns about dependents). */
export function dependents(draft: Draft, name: string): string[] {
  return draft.queries.filter((q) => q.name !== name && referencesName(q.source, name)).map((q) => q.name)
}

export function groupsOf(draft: Draft): string[] {
  const out: string[] = []
  for (const q of draft.queries) if (q.group && !out.includes(q.group)) out.push(q.group)
  for (const g of draft.groups) if (!out.includes(g)) out.push(g)
  return out
}

// ---------------------------------------------------------------------------------------------
// Apply

export function modelDataType(typeText: string): DataType {
  switch (pqTypeOf(typeText)) {
    case 'text':
      return 'string'
    case 'int64':
      return 'int64'
    case 'number':
    case 'percentage':
    case 'duration':
      return 'double'
    case 'currency':
      return 'decimal'
    case 'date':
    case 'datetime':
    case 'datetimezone':
    case 'time':
      return 'dateTime'
    case 'logical':
      return 'boolean'
    case 'binary':
      return 'binary'
    default:
      return 'string'
  }
}

function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function newColumn(c: ColInfo): ColumnDef {
  const dataType = modelDataType(c.type)
  const numeric = dataType === 'int64' || dataType === 'double' || dataType === 'decimal'
  const k = pqTypeOf(c.type)
  return {
    name: c.name,
    dataType,
    kind: 'data',
    sourceColumn: c.name,
    summarizeBy: numeric ? 'sum' : 'none',
    lineageTag: uuid(),
    ...(k === 'date' ? { formatString: 'Long Date' } : k === 'currency' ? { formatString: '\\$#,0.00;(\\$#,0.00);\\$#,0.00' } : k === 'percentage' ? { formatString: '0.00%' } : {})
  }
}

/**
 * Makes a table's data columns match the query's output columns (Apply does this in PBI): new columns
 * are added, columns no longer produced are removed (calculated columns stay), types follow the query.
 */
export function syncColumns(table: TableDef, cols: ColInfo[]): void {
  const bySource = new Map(table.columns.filter((c) => c.kind === 'data').map((c) => [(c.sourceColumn ?? c.name).toLowerCase(), c]))
  const wanted = new Set(cols.map((c) => c.name.toLowerCase()))
  table.columns = table.columns.filter((c) => c.kind !== 'data' || wanted.has((c.sourceColumn ?? c.name).toLowerCase()))
  for (const c of cols) {
    const cur = bySource.get(c.name.toLowerCase())
    if (cur) {
      const dt = modelDataType(c.type)
      if (pqTypeOf(c.type) !== 'any' && cur.dataType !== dt) cur.dataType = dt
    } else if (!table.columns.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) table.columns.push(newColumn(c))
  }
}

export interface ApplyOptions {
  /** output columns of each query (by draft id) from the editor's previews — used to type new tables and sync columns */
  columns?: Record<string, ColInfo[] | undefined>
}

export interface ApplyResult {
  /** loaded tables whose query changed or that were created → refresh these */
  refresh: string[]
  /** tables renamed (old → new), so callers can update report references */
  renamedTables: Array<[string, string]>
  /** origins after apply, per draft id (the editor keeps working with them) */
  origins: Record<string, QueryOrigin>
}

function removeTable(model: SemanticModel, name: string): void {
  model.tables = model.tables.filter((t) => t.name !== name)
  model.relationships = model.relationships.filter((r) => r.fromTable !== name && r.toTable !== name)
}

/** Writes the draft to the model (call inside `mutateModel`). */
export function applyDraft(model: SemanticModel, draft: Draft, opts: ApplyOptions = {}): ApplyResult {
  const result: ApplyResult = { refresh: [], renamedTables: [], origins: {} }
  const { changed, deleted } = draftChanges(draft, model)
  for (const o of deleted) {
    if (o.kind === 'table') removeTable(model, o.table)
    else model.expressions = model.expressions.filter((e) => e.name !== o.name)
  }
  for (const q of draft.queries) if (q.origin) result.origins[q.id] = q.origin
  for (const { query: q } of changed) {
    const cols = opts.columns?.[q.id]
    const isFunctionOrParam = q.kind === 'parameter' || q.kind === 'function'
    const load = q.loadEnabled && !isFunctionOrParam
    const origin = q.origin
    if (origin?.kind === 'table') {
      const table = model.tables.find((t) => t.name === origin.table)
      if (!table) continue
      if (!load) {
        // Enable load unchecked: the table leaves the model, the query stays as an expression
        removeTable(model, table.name)
        model.expressions.push({ name: q.name, kind: 'm', expression: q.source, queryGroup: q.group, description: q.description, lineageTag: uuid() })
        result.origins[q.id] = { kind: 'expression', name: q.name }
        continue
      }
      const p = table.partitions[origin.partitionIndex]
      const sourceChanged = !!p && p.expression !== q.source
      if (p) {
        p.expression = q.source
        if (q.group) p.queryGroup = q.group
        else delete p.queryGroup
      }
      if ((table.description ?? '') !== (q.description ?? '')) table.description = q.description || undefined
      if (table.name !== q.name) {
        result.renamedTables.push([table.name, q.name])
        renameTable(model, table.name, q.name)
      }
      if (sourceChanged && cols) syncColumns(table, cols)
      if (sourceChanged) result.refresh.push(q.name)
      result.origins[q.id] = { kind: 'table', table: q.name, partitionIndex: origin.partitionIndex }
      continue
    }
    {
      const existing = origin?.kind === 'expression' ? model.expressions.find((e) => e.name === origin.name) : undefined
      if (load && q.kind === 'table') {
        // new loaded query, or Enable load turned on: create an import table
        if (existing) model.expressions = model.expressions.filter((e) => e !== existing)
        const table: TableDef = {
          name: q.name,
          columns: (cols ?? []).map(newColumn),
          measures: [],
          hierarchies: [],
          partitions: [{ name: `${q.name}-${uuid().slice(0, 8)}`, mode: 'import', sourceType: 'm', expression: q.source, ...(q.group ? { queryGroup: q.group } : {}) }],
          description: q.description,
          lineageTag: uuid()
        }
        model.tables.push(table)
        result.refresh.push(q.name)
        result.origins[q.id] = { kind: 'table', table: q.name, partitionIndex: 0 }
        continue
      }
      if (existing) {
        if (existing.name !== q.name) {
          // other expressions' references were rewritten in the draft already
          existing.name = q.name
        }
        existing.expression = q.source
        existing.queryGroup = q.group || undefined
        existing.description = q.description || undefined
      } else model.expressions.push({ name: q.name, kind: 'm', expression: q.source, ...(q.group ? { queryGroup: q.group } : {}), ...(q.description ? { description: q.description } : {}), lineageTag: uuid() })
      result.origins[q.id] = { kind: 'expression', name: q.name }
    }
  }
  return result
}

/** The draft after a successful apply: same ids/queries, origins pointing at the new model objects, no deletions. */
export function rebaseDraft(draft: Draft, origins: Record<string, QueryOrigin>): Draft {
  return { queries: draft.queries.map((q) => ({ ...q, origin: origins[q.id] ?? q.origin })), deleted: [], groups: draft.groups }
}
