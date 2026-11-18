/**
 * Data pane model edits (pure mutators over a draft SemanticModel — call inside `mutateModel`).
 * Renames keep model-internal references consistent (relationships, hierarchy levels, sort-by
 * columns). DAX expressions and report field references are NOT rewritten here; the modeling
 * workstream owns reference-aware renames (PBI rewrites dependent DAX automatically).
 */
import type { SemanticModel, TableDef } from '@core/model/types'

export type ModelTarget =
  | { kind: 'table'; table: string }
  | { kind: 'column'; table: string; name: string }
  | { kind: 'measure'; table: string; name: string }
  | { kind: 'hierarchy'; table: string; name: string }

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function tableOf(m: SemanticModel, name: string): TableDef | undefined {
  return m.tables.find((t) => t.name === name)
}

/** Validation message for a new name, or undefined when OK. */
export function validateName(m: SemanticModel, target: ModelTarget, next: string): string | undefined {
  const n = next.trim()
  if (!n) return 'The name cannot be empty.'
  if (/[[\]]/.test(n) && target.kind !== 'table') return 'The name cannot contain square brackets.'
  if (target.kind === 'table') {
    if (m.tables.some((t) => t.name !== target.table && eq(t.name, n))) return `A table named '${n}' already exists.`
    return undefined
  }
  const t = tableOf(m, target.table)
  if (!t) return undefined
  const own = (target as { name: string }).name
  if (target.kind === 'measure' || target.kind === 'column') {
    // measure names are model-wide; column names table-wide and can't collide with measures
    if (m.tables.some((x) => x.measures.some((mm) => !(x.name === t.name && mm.name === own) && eq(mm.name, n)))) return `'${n}' is already used by a measure.`
    if (t.columns.some((c) => c.name !== own && eq(c.name, n))) return `A column named '${n}' already exists in '${t.name}'.`
  }
  if (target.kind === 'hierarchy' && t.hierarchies.some((h) => h.name !== own && eq(h.name, n))) return `A hierarchy named '${n}' already exists.`
  return undefined
}

export function renameObject(m: SemanticModel, target: ModelTarget, next: string): void {
  const n = next.trim()
  if (target.kind === 'table') {
    const t = tableOf(m, target.table)
    if (!t) return
    t.name = n
    for (const r of m.relationships) {
      if (r.fromTable === target.table) r.fromTable = n
      if (r.toTable === target.table) r.toTable = n
    }
    return
  }
  const t = tableOf(m, target.table)
  if (!t) return
  if (target.kind === 'column') {
    const c = t.columns.find((x) => x.name === target.name)
    if (!c) return
    c.name = n
    for (const r of m.relationships) {
      if (r.fromTable === t.name && r.fromColumn === target.name) r.fromColumn = n
      if (r.toTable === t.name && r.toColumn === target.name) r.toColumn = n
    }
    for (const h of t.hierarchies) for (const l of h.levels) if (l.column === target.name) l.column = n
    for (const x of t.columns) if (x.sortByColumn === target.name) x.sortByColumn = n
  } else if (target.kind === 'measure') {
    const mm = t.measures.find((x) => x.name === target.name)
    if (mm) mm.name = n
  } else {
    const h = t.hierarchies.find((x) => x.name === target.name)
    if (h) h.name = n
  }
}

export function deleteObject(m: SemanticModel, target: ModelTarget): void {
  if (target.kind === 'table') {
    m.tables = m.tables.filter((t) => t.name !== target.table)
    m.relationships = m.relationships.filter((r) => r.fromTable !== target.table && r.toTable !== target.table)
    return
  }
  const t = tableOf(m, target.table)
  if (!t) return
  if (target.kind === 'column') {
    t.columns = t.columns.filter((c) => c.name !== target.name)
    m.relationships = m.relationships.filter((r) => !((r.fromTable === t.name && r.fromColumn === target.name) || (r.toTable === t.name && r.toColumn === target.name)))
    for (const h of t.hierarchies) h.levels = h.levels.filter((l) => l.column !== target.name).map((l, i) => ({ ...l, ordinal: i }))
    t.hierarchies = t.hierarchies.filter((h) => h.levels.length)
    for (const c of t.columns) if (c.sortByColumn === target.name) delete c.sortByColumn
  } else if (target.kind === 'measure') t.measures = t.measures.filter((x) => x.name !== target.name)
  else t.hierarchies = t.hierarchies.filter((x) => x.name !== target.name)
}

export function setHidden(m: SemanticModel, target: ModelTarget, hidden: boolean): void {
  const t = tableOf(m, target.table)
  if (!t) return
  const obj = target.kind === 'table' ? t : target.kind === 'column' ? t.columns.find((c) => c.name === target.name) : target.kind === 'measure' ? t.measures.find((x) => x.name === target.name) : t.hierarchies.find((x) => x.name === target.name)
  if (!obj) return
  if (hidden) obj.isHidden = true
  else delete obj.isHidden
}

export function isHidden(m: SemanticModel, target: ModelTarget): boolean {
  const t = tableOf(m, target.table)
  if (!t) return false
  if (target.kind === 'table') return !!t.isHidden
  if (target.kind === 'column') return !!t.columns.find((c) => c.name === target.name)?.isHidden
  if (target.kind === 'measure') return !!t.measures.find((c) => c.name === target.name)?.isHidden
  return !!t.hierarchies.find((c) => c.name === target.name)?.isHidden
}

/** PBI "Unhide all": every table/column/measure/hierarchy (internal auto-date tables stay hidden). */
export function unhideAll(m: SemanticModel): void {
  for (const t of m.tables) {
    if (t.isPrivate || /^(LocalDateTable_|DateTableTemplate_)/.test(t.name)) continue
    delete t.isHidden
    for (const c of t.columns) if (c.kind !== 'rowNumber') delete c.isHidden
    for (const x of t.measures) delete x.isHidden
    for (const h of t.hierarchies) delete h.isHidden
  }
}

/** New hierarchy with the column as its first level (PBI names it "<Column> Hierarchy"). */
export function addHierarchy(m: SemanticModel, table: string, column: string): string | undefined {
  const t = tableOf(m, table)
  if (!t) return undefined
  let name = `${column} Hierarchy`
  for (let i = 2; t.hierarchies.some((h) => eq(h.name, name)); i++) name = `${column} Hierarchy ${i}`
  t.hierarchies.push({ name, levels: [{ name: column, column, ordinal: 0 }] })
  return name
}

export function setDisplayFolder(m: SemanticModel, target: ModelTarget, folder: string): void {
  const t = tableOf(m, target.table)
  if (!t || target.kind === 'table') return
  const obj = target.kind === 'column' ? t.columns.find((c) => c.name === target.name) : target.kind === 'measure' ? t.measures.find((x) => x.name === target.name) : t.hierarchies.find((x) => x.name === target.name)
  if (!obj) return
  if (folder.trim()) obj.displayFolder = folder.trim()
  else delete obj.displayFolder
}

/** DAX reference text used by "Copy name". */
export function daxReference(target: ModelTarget): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`
  const b = (s: string) => `[${s.replace(/]/g, ']]')}]`
  if (target.kind === 'table') return q(target.table)
  if (target.kind === 'measure') return b(target.name)
  return `${q(target.table)}${b(target.name)}`
}
