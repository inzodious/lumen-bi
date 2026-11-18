/**
 * Relationship editing helpers: PBI cardinality options ↔ TMDL from/to cardinalities, cardinality
 * detection from data, validation (as in the Power BI "Edit relationship" dialog).
 */
import type { Cardinality, CrossFilteringBehavior, RelationshipDef, SemanticModel } from '@core/model/types'
import type { Scalar } from '@core/model/data'

/** The dialog's cardinality choice, relative to (table1 = first table, table2 = second table). */
export type UiCardinality = 'manyToOne' | 'oneToOne' | 'oneToMany' | 'manyToMany'
export type UiCrossFilter = 'single' | 'both'

export const CARDINALITY_LABELS: Record<UiCardinality, string> = {
  manyToOne: 'Many to one (*:1)',
  oneToOne: 'One to one (1:1)',
  oneToMany: 'One to many (1:*)',
  manyToMany: 'Many to many (*:*)'
}

export interface RelationshipDraft {
  table1: string
  column1: string
  table2: string
  column2: string
  cardinality: UiCardinality
  crossFilter: UiCrossFilter
  isActive: boolean
  relyOnReferentialIntegrity: boolean
  /** "Apply security filter in both directions" */
  securityBoth: boolean
}

export function uiCardinality(rel: RelationshipDef): UiCardinality {
  const f = rel.fromCardinality ?? 'many'
  const t = rel.toCardinality ?? 'one'
  if (f === 'many' && t === 'one') return 'manyToOne'
  if (f === 'one' && t === 'one') return 'oneToOne'
  if (f === 'one' && t === 'many') return 'oneToMany'
  return 'manyToMany'
}

export function draftFromRelationship(rel: RelationshipDef): RelationshipDraft {
  return {
    table1: rel.fromTable,
    column1: rel.fromColumn,
    table2: rel.toTable,
    column2: rel.toColumn,
    cardinality: uiCardinality(rel),
    crossFilter: rel.crossFilteringBehavior === 'bothDirections' ? 'both' : 'single',
    isActive: rel.isActive !== false,
    relyOnReferentialIntegrity: !!rel.relyOnReferentialIntegrity,
    securityBoth: rel.securityFilteringBehavior === 'bothDirections'
  }
}

/**
 * Apply a draft to a relationship definition. One-to-many is stored with the tables swapped so
 * `from` is always the many side (that's what Power BI writes in TMDL).
 */
export function relationshipFromDraft(d: RelationshipDraft, base?: RelationshipDef, name = base?.name ?? crypto.randomUUID()): RelationshipDef {
  const swap = d.cardinality === 'oneToMany'
  const [fromTable, fromColumn, toTable, toColumn] = swap ? [d.table2, d.column2, d.table1, d.column1] : [d.table1, d.column1, d.table2, d.column2]
  let fromCardinality: Cardinality = 'many'
  let toCardinality: Cardinality = 'one'
  if (d.cardinality === 'oneToOne') fromCardinality = 'one'
  if (d.cardinality === 'manyToMany') toCardinality = 'many'
  const crossFilteringBehavior: CrossFilteringBehavior = d.cardinality === 'oneToOne' || d.crossFilter === 'both' ? 'bothDirections' : 'oneDirection'
  const rel: RelationshipDef = {
    ...(base ?? {}),
    name,
    fromTable,
    fromColumn,
    toTable,
    toColumn,
    fromCardinality,
    toCardinality,
    crossFilteringBehavior,
    isActive: d.isActive
  }
  if (d.relyOnReferentialIntegrity) rel.relyOnReferentialIntegrity = true
  else delete rel.relyOnReferentialIntegrity
  if (crossFilteringBehavior === 'bothDirections' && d.securityBoth) rel.securityFilteringBehavior = 'bothDirections'
  else delete rel.securityFilteringBehavior
  return rel
}

const keyOf = (v: Scalar): string | null => {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return `d${v.getTime()}`
  if (typeof v === 'string') return `s${v.toLowerCase()}` // the engine compares text case-insensitively
  return `${typeof v}${String(v)}`
}

export function isUnique(values: Scalar[] | undefined): boolean {
  if (!values) return false
  const seen = new Set<string>()
  for (const v of values) {
    const k = keyOf(v)
    if (k === null) continue
    if (seen.has(k)) return false
    seen.add(k)
  }
  return true
}

/** PBI's automatic cardinality: unique on both sides → 1:1, unique on side 2 → *:1, on side 1 → 1:*, else *:*. */
export function detectCardinality(values1: Scalar[] | undefined, values2: Scalar[] | undefined): UiCardinality {
  if (!values1?.length || !values2?.length) return 'manyToOne'
  const u1 = isUnique(values1)
  const u2 = isUnique(values2)
  if (u1 && u2) return 'oneToOne'
  if (u2) return 'manyToOne'
  if (u1) return 'oneToMany'
  return 'manyToMany'
}

export interface DraftCheck {
  errors: string[]
  warnings: string[]
}

/** Validation messages as Power BI shows them in the relationship dialog. */
export function validateDraft(model: SemanticModel, d: RelationshipDraft, values: { v1?: Scalar[]; v2?: Scalar[] }, editing?: RelationshipDef): DraftCheck {
  const errors: string[] = []
  const warnings: string[] = []
  if (!d.table1 || !d.table2 || !d.column1 || !d.column2) {
    errors.push('Select a column in each table to create a relationship.')
    return { errors, warnings }
  }
  if (d.table1 === d.table2) errors.push('A relationship can only be created between two different tables.')
  const t1 = model.tables.find((t) => t.name === d.table1)
  const t2 = model.tables.find((t) => t.name === d.table2)
  const c1 = t1?.columns.find((c) => c.name === d.column1)
  const c2 = t2?.columns.find((c) => c.name === d.column2)
  if (!c1 || !c2) errors.push('The selected columns could not be found.')
  else {
    const num = (t: string) => t === 'int64' || t === 'double' || t === 'decimal'
    if (c1.dataType !== c2.dataType && !(num(c1.dataType) && num(c2.dataType))) {
      errors.push(`The columns have different data types (${c1.dataType} and ${c2.dataType}). Relationships require columns of the same data type.`)
    }
  }
  // cardinality vs data
  if (values.v1?.length && values.v2?.length) {
    const u1 = isUnique(values.v1)
    const u2 = isUnique(values.v2)
    const needs1 = d.cardinality === 'oneToOne' || d.cardinality === 'oneToMany'
    const needs2 = d.cardinality === 'oneToOne' || d.cardinality === 'manyToOne'
    if ((needs1 && !u1) || (needs2 && !u2)) {
      errors.push(`The cardinality you selected isn't valid for this relationship. The column '${needs2 && !u2 ? d.column2 : d.column1}' contains duplicate values.`)
    }
    if (d.cardinality === 'manyToMany') warnings.push('This relationship has cardinality Many-Many. This should only be used if it is expected that neither column contains unique values, and that the significantly different behavior of Many-many relationships is understood.')
    if (d.relyOnReferentialIntegrity) {
      const one = new Set((d.cardinality === 'oneToMany' ? values.v1 : values.v2).map(keyOf))
      const many = d.cardinality === 'oneToMany' ? values.v2 : values.v1
      if (many.some((v) => keyOf(v) !== null && !one.has(keyOf(v)))) warnings.push('Some values on the many side have no match on the one side; "Assume referential integrity" may produce incorrect results.')
    }
  }
  // duplicates / active path ambiguity
  const others = model.relationships.filter((r) => r !== editing && r.name !== editing?.name)
  const sameColumns = others.find(
    (r) =>
      (r.fromTable === d.table1 && r.fromColumn === d.column1 && r.toTable === d.table2 && r.toColumn === d.column2) ||
      (r.fromTable === d.table2 && r.fromColumn === d.column2 && r.toTable === d.table1 && r.toColumn === d.column1)
  )
  if (sameColumns) errors.push('A relationship already exists between these columns.')
  if (d.isActive) {
    const activeBetween = others.find((r) => r.isActive !== false && ((r.fromTable === d.table1 && r.toTable === d.table2) || (r.fromTable === d.table2 && r.toTable === d.table1)))
    if (activeBetween) errors.push(`You can't create a direct active relationship between ${d.table1} and ${d.table2} because an active relationship already exists between these tables. To make this relationship active, deactivate or delete the other one first.`)
    else if (createsAmbiguity(model, d, others)) errors.push(`You can't create an active relationship between ${d.table1} and ${d.table2} because that would introduce ambiguity between tables. To make this relationship active, deactivate or delete one of the existing relationships between these tables first.`)
  }
  return { errors, warnings }
}

/**
 * Ambiguity check: with the new active relationship, would there be two different active
 * paths between the same pair of tables? (Approximation of PBI's check: undirected cycle among
 * active relationships.)
 */
function createsAmbiguity(_model: SemanticModel, d: RelationshipDraft, others: RelationshipDef[]): boolean {
  const adj = new Map<string, string[]>()
  const add = (a: string, b: string) => {
    adj.set(a, [...(adj.get(a) ?? []), b])
    adj.set(b, [...(adj.get(b) ?? []), a])
  }
  for (const r of others) if (r.isActive !== false) add(r.fromTable, r.toTable)
  // is table2 already reachable from table1?
  const seen = new Set([d.table1])
  const queue = [d.table1]
  while (queue.length) {
    const t = queue.shift()!
    if (t === d.table2) return true
    for (const n of adj.get(t) ?? []) if (!seen.has(n)) seen.add(n), queue.push(n)
  }
  return false
}

/** Suggest column pairs for a new relationship (same name, or Key/ID naming conventions). */
export function suggestColumns(model: SemanticModel, table1: string, table2: string): { column1: string; column2: string } | null {
  const t1 = model.tables.find((t) => t.name === table1)
  const t2 = model.tables.find((t) => t.name === table2)
  if (!t1 || !t2) return null
  for (const c1 of t1.columns) {
    const c2 = t2.columns.find((c) => c.name.toLowerCase() === c1.name.toLowerCase())
    if (c2) return { column1: c1.name, column2: c2.name }
  }
  return null
}
