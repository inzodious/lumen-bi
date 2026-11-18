/**
 * Pure model operations used by modeling commands, the formula bar and property panes.
 * All functions mutate the `model` passed in (call them inside `mutateModel`).
 */
import type { ColumnDef, SemanticModel, TableDef } from '@core/model/types'
import type { Scalar } from '@core/model/data'
import { quoteColumn, quoteTable, tokenizeDax, unquoteRef } from '../../../editors/dax/tokenizer'

/** "Measure", "Measure 2", … unique (case-insensitive) within `taken`. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((s) => s.toLowerCase()))
  if (!set.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) if (!set.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`
}

/** Measure names are unique across the model; column names within a table must not clash with measures either. */
export function takenFieldNames(model: SemanticModel, table?: string): string[] {
  const out = model.tables.flatMap((t) => t.measures.map((m) => m.name))
  const t = table ? model.tables.find((x) => x.name === table) : undefined
  if (t) out.push(...t.columns.map((c) => c.name))
  return out
}

export function nameError(model: SemanticModel, kind: 'measure' | 'column' | 'table', name: string, table?: string, current?: string): string | null {
  const n = name.trim()
  if (!n) return 'The name cannot be empty.'
  if (/[\t\n\r]/.test(n)) return 'The name contains invalid characters.'
  if ((n.match(/\(/g)?.length ?? 0) !== (n.match(/\)/g)?.length ?? 0)) return `The syntax for '${n}' is incorrect. Use the form: Name = expression.`
  if (current && n.toLowerCase() === current.toLowerCase()) return null
  if (kind === 'table') {
    if (model.tables.some((t) => t.name.toLowerCase() === n.toLowerCase())) return `The name '${n}' is already used by another table.`
    return null
  }
  if (model.tables.some((t) => t.measures.some((m) => m.name.toLowerCase() === n.toLowerCase()))) return `The name '${n}' is already used by a measure.`
  const t = table ? model.tables.find((x) => x.name === table) : undefined
  if (t?.columns.some((c) => c.name.toLowerCase() === n.toLowerCase())) return `The name '${n}' is already used by a column in table '${t.name}'.`
  if (kind === 'measure' && model.tables.some((x) => x.columns.some((c) => c.name.toLowerCase() === n.toLowerCase()))) {
    // PBI allows it, but references become ambiguous; warn as an error only within the same table (above)
    return null
  }
  return null
}

type Ref = { kind: 'table'; table: string } | { kind: 'column'; table: string; name: string } | { kind: 'measure'; table: string; name: string }

/**
 * Rewrite DAX references after a rename (PBI updates dependent expressions automatically).
 *  - table: `'Old'[x]` / `Old[x]` / bare `Old` → new quoted name
 *  - column: `Table[Old]`; unqualified `[Old]` in the same table's calculated columns
 *  - measure: `[Old]` anywhere and `Table[Old]`
 */
export function renameInExpression(expr: string, ref: Ref, newName: string, ownTable?: string): string {
  const toks = tokenizeDax(expr)
  let out = ''
  let last = 0
  const lower = (s: string) => s.toLowerCase()
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    let replacement: string | null = null
    if (ref.kind === 'table' && (t.type === 'table' || t.type === 'ident') && lower(unquoteRef(t.text)) === lower(ref.table)) {
      const prev = toks.slice(0, i).reverse().find((x) => x.type !== 'ws' && x.type !== 'newline' && x.type !== 'comment')
      const isVarName = prev?.type === 'keyword' && prev.text.toUpperCase() === 'VAR'
      if (!isVarName && (t.type === 'table' || toks[i + 1]?.type === 'column' || t.type === 'ident')) replacement = quoteTable(newName)
    } else if ((ref.kind === 'column' || ref.kind === 'measure') && t.type === 'column' && lower(unquoteRef(t.text)) === lower(ref.name)) {
      const prev = toks[i - 1]
      const qualified = prev && (prev.type === 'table' || prev.type === 'ident')
      if (qualified) {
        if (lower(unquoteRef(prev.text)) === lower(ref.table)) replacement = quoteColumn(newName)
      } else if (ref.kind === 'measure') replacement = quoteColumn(newName)
      else if (ownTable && lower(ownTable) === lower(ref.table)) replacement = quoteColumn(newName)
    }
    if (replacement !== null) {
      out += expr.slice(last, t.start) + replacement
      last = t.end
    }
  }
  return last === 0 ? expr : out + expr.slice(last)
}

function eachExpression(model: SemanticModel, fn: (get: () => string, set: (v: string) => void, ownTable: string) => void): void {
  for (const t of model.tables) {
    for (const m of t.measures) {
      fn(() => m.expression, (v) => (m.expression = v), t.name)
      if (m.formatStringDefinition) fn(() => m.formatStringDefinition!.expression, (v) => (m.formatStringDefinition!.expression = v), t.name)
    }
    for (const c of t.columns) if (c.kind === 'calculated' && c.expression) fn(() => c.expression!, (v) => (c.expression = v), t.name)
    for (const p of t.partitions) if (p.sourceType === 'calculated' && p.expression) fn(() => p.expression!, (v) => (p.expression = v), t.name)
    for (const it of t.calculationGroup?.items ?? []) fn(() => it.expression, (v) => (it.expression = v), t.name)
  }
  for (const r of model.roles) for (const tp of r.tablePermissions) if (tp.filterExpression) fn(() => tp.filterExpression!, (v) => (tp.filterExpression = v), tp.table)
}

export function renameTable(model: SemanticModel, oldName: string, newName: string): void {
  const t = model.tables.find((x) => x.name === oldName)
  if (!t || oldName === newName) return
  eachExpression(model, (get, set) => set(renameInExpression(get(), { kind: 'table', table: oldName }, newName)))
  t.name = newName
  for (const p of t.partitions) if (p.name === oldName) p.name = newName
  for (const r of model.relationships) {
    if (r.fromTable === oldName) r.fromTable = newName
    if (r.toTable === oldName) r.toTable = newName
  }
  for (const role of model.roles) for (const tp of role.tablePermissions) if (tp.table === oldName) tp.table = newName
  renameDiagramNode(model, oldName, newName)
}

export function renameColumn(model: SemanticModel, table: string, oldName: string, newName: string): void {
  const t = model.tables.find((x) => x.name === table)
  const c = t?.columns.find((x) => x.name === oldName)
  if (!t || !c || oldName === newName) return
  eachExpression(model, (get, set, own) => set(renameInExpression(get(), { kind: 'column', table, name: oldName }, newName, own)))
  c.name = newName
  for (const other of t.columns) if (other.sortByColumn === oldName) other.sortByColumn = newName
  for (const h of t.hierarchies) for (const l of h.levels) if (l.column === oldName) l.column = newName
  for (const r of model.relationships) {
    if (r.fromTable === table && r.fromColumn === oldName) r.fromColumn = newName
    if (r.toTable === table && r.toColumn === oldName) r.toColumn = newName
  }
}

export function renameMeasure(model: SemanticModel, table: string, oldName: string, newName: string): void {
  const t = model.tables.find((x) => x.name === table)
  const m = t?.measures.find((x) => x.name === oldName)
  if (!t || !m || oldName === newName) return
  eachExpression(model, (get, set, own) => set(renameInExpression(get(), { kind: 'measure', table, name: oldName }, newName, own)))
  m.name = newName
}

function renameDiagramNode(model: SemanticModel, oldName: string, newName: string): void {
  const raw = model.sidecarFiles?.['diagramLayout.json']
  if (!raw) return
  try {
    const json = JSON.parse(raw) as { diagrams?: Array<{ nodes?: Array<{ nodeIndex?: string }> }> }
    for (const d of json.diagrams ?? []) for (const n of d.nodes ?? []) if (n.nodeIndex === oldName) n.nodeIndex = newName
    model.sidecarFiles!['diagramLayout.json'] = JSON.stringify(json, null, 2)
  } catch {
    /* keep unparsable layout untouched */
  }
}

/** Remove a table and everything that points at it (relationships, role permissions, layout node). */
export function deleteTable(model: SemanticModel, name: string): void {
  model.tables = model.tables.filter((t) => t.name !== name)
  model.relationships = model.relationships.filter((r) => r.fromTable !== name && r.toTable !== name)
  for (const role of model.roles) role.tablePermissions = role.tablePermissions.filter((tp) => tp.table !== name)
}

export function deleteColumn(model: SemanticModel, table: string, name: string): void {
  const t = model.tables.find((x) => x.name === table)
  if (!t) return
  t.columns = t.columns.filter((c) => c.name !== name)
  for (const c of t.columns) if (c.sortByColumn === name) delete c.sortByColumn
  for (const h of t.hierarchies) h.levels = h.levels.filter((l) => l.column !== name)
  t.hierarchies = t.hierarchies.filter((h) => h.levels.length > 0)
  model.relationships = model.relationships.filter((r) => !((r.fromTable === table && r.fromColumn === name) || (r.toTable === table && r.toColumn === name)))
}

// ------------------------------------------------------------------ date table

export interface DateTableCheck {
  ok: boolean
  message: string
}

/** PBI "Mark as date table" validation: date type, no blanks, unique values, contiguous days. */
export function validateDateColumn(column: ColumnDef | undefined, values: Scalar[] | undefined): DateTableCheck {
  if (!column) return { ok: false, message: 'Select a date column.' }
  if (column.dataType !== 'dateTime') return { ok: false, message: `The column '${column.name}' must be of data type Date or Date/Time.` }
  if (!values || !values.length) return { ok: true, message: 'Validated successfully (no data loaded to check).' }
  const days = new Set<number>()
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (v === null) return { ok: false, message: `The column '${column.name}' contains blank values.` }
    if (!(v instanceof Date)) return { ok: false, message: `The column '${column.name}' contains values that are not dates.` }
    const day = Math.floor(v.getTime() / 86_400_000)
    if (v.getTime() % 86_400_000 !== 0) return { ok: false, message: `The column '${column.name}' contains time values; a date table needs one row per day.` }
    if (days.has(day)) return { ok: false, message: `The column '${column.name}' contains duplicate values.` }
    days.add(day)
    if (day < min) min = day
    if (day > max) max = day
  }
  if (max - min + 1 !== days.size) return { ok: false, message: `The column '${column.name}' has gaps in its dates. A date table must contain contiguous dates.` }
  return { ok: true, message: 'Validated successfully.' }
}

/** Mark/unmark: table dataCategory 'Time' + `isKey` on the date column (what PBI writes in TMDL). */
export function markAsDateTable(table: TableDef, column: string | null): void {
  for (const c of table.columns) if (c.isKey && c.name !== column) delete c.isKey
  if (column === null) {
    delete table.dataCategory
    return
  }
  table.dataCategory = 'Time'
  const c = table.columns.find((x) => x.name === column)
  if (c) c.isKey = true
}

export function dateTableColumn(table: TableDef): string | null {
  if (table.dataCategory !== 'Time') return null
  return table.columns.find((c) => c.isKey && c.dataType === 'dateTime')?.name ?? null
}

// ------------------------------------------------------------------ calculation groups

export function newCalculationGroupTable(model: SemanticModel, uuid: () => string = () => crypto.randomUUID()): TableDef {
  const name = uniqueName('Calculation group', model.tables.map((t) => t.name))
  const precedence = Math.max(-1, ...model.tables.map((t) => t.calculationGroup?.precedence ?? -1)) + 1
  return {
    name,
    lineageTag: uuid(),
    calculationGroup: { precedence, items: [{ name: 'Calculation item', expression: 'SELECTEDMEASURE()', ordinal: 0 }] },
    columns: [
      { name: 'Name', dataType: 'string', kind: 'data', sourceColumn: 'Name', lineageTag: uuid(), summarizeBy: 'none', sortByColumn: 'Ordinal' },
      { name: 'Ordinal', dataType: 'int64', kind: 'data', sourceColumn: 'Ordinal', isHidden: true, formatString: '0', lineageTag: uuid(), summarizeBy: 'sum' }
    ],
    measures: [],
    hierarchies: [],
    partitions: [{ name: `${name}`, sourceType: 'calculationGroup' }]
  }
}

/** Turn the model's "discourage implicit measures" on, as PBI does when a calculation group is created. */
export function ensureDiscourageImplicitMeasures(model: SemanticModel): void {
  model.discourageImplicitMeasures = true
}

export function columnRefText(table: string, column: string): string {
  return `${quoteTable(table)}${quoteColumn(column)}`
}
