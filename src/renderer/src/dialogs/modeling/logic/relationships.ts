/**
 * Relationship editing helpers: PBI cardinality options ↔ TMDL from/to cardinalities, cardinality
 * detection from data, validation (as in the Power BI "Edit relationship" dialog).
 */
import type { Cardinality, CrossFilteringBehavior, DataType, RelationshipDef, SemanticModel } from '@core/model/types'
import type { Scalar } from '@core/model/data'
import { dataTypeLabel, effectiveDataType, isNumericType } from './columnTypes'

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

/**
 * Key of a value as the storage engine compares relationship keys: text is case-insensitive and ignores
 * trailing spaces ("a" and "A " are one value — src/core/dax/tabular/model.ts does the same), dates compare by
 * instant, blanks (and empty text) are no key at all.
 */
const keyOf = (v: Scalar): string | null => {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return `d${v.getTime()}`
  if (typeof v === 'string') {
    const t = v.replace(/ +$/, '')
    return t === '' ? null : `s${t.toLowerCase()}`
  }
  return `${typeof v}${String(v)}`
}

/** No two rows hold the same key. Blank rows are ignored: a "one" side may contain blanks. */
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
  /** block Save */
  errors: string[]
  /** shown, never block Save */
  warnings: string[]
}

export interface DraftData {
  v1?: Scalar[]
  v2?: Scalar[]
  /** data types stored with the data (the engine's inferred type when the definition declares none) */
  type1?: DataType
  type2?: DataType
}

/** The draft still describes the saved relationship's columns (in either orientation). */
function sameEndpoints(d: RelationshipDraft, r: RelationshipDef): boolean {
  return (
    (r.fromTable === d.table1 && r.fromColumn === d.column1 && r.toTable === d.table2 && r.toColumn === d.column2) ||
    (r.fromTable === d.table2 && r.fromColumn === d.column2 && r.toTable === d.table1 && r.toColumn === d.column1)
  )
}

/**
 * Validation messages of the relationship dialog.
 *
 * Rules mirrored from Power BI Desktop (Microsoft Learn, "Model relationships in Power BI Desktop"):
 *  - data types: "The data type for both the 'from' and 'to' column of the relationship should be the same" is
 *    a recommendation, not a requirement — Power BI relates e.g. a text column to a whole-number column and
 *    converts the keys (Lumen's engine matches them the same way). So differing types are a note, never an
 *    error (other pairs, e.g. date ↔ text, get a note saying that Lumen's engine finds no matches); a column
 *    whose definition declares no type (calculated tables) uses the type stored with its data.
 *  - cardinality: a "one" side must hold unique values, but only while there is data to judge by ("…as long
 *    as any 'one' side columns contain unique values (or the table is yet to be loaded with rows of data)").
 *
 * An existing relationship that is opened unchanged is valid by definition: it was accepted by Power BI on
 * the real data. What the *currently loaded* rows say about it (sample data, a partial refresh) is shown as a
 * note and never blocks Save; errors are reserved for what the user changes in the dialog.
 */
export function validateDraft(model: SemanticModel, d: RelationshipDraft, values: DraftData, editing?: RelationshipDef): DraftCheck {
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
  const unchangedColumns = !!editing && sameEndpoints(d, editing)
  const unchanged = unchangedColumns && uiCardinalityOfDraft(d, editing!) === uiCardinality(editing!)
  if (!c1 || !c2) errors.push('The selected columns could not be found.')
  else {
    const ty1 = effectiveDataType(c1, { type: values.type1 ?? 'unknown', values: values.v1 ?? [] })
    const ty2 = effectiveDataType(c2, { type: values.type2 ?? 'unknown', values: values.v2 ?? [] })
    if (ty1 === 'binary' || ty2 === 'binary') {
      if (!unchanged) errors.push("Binary columns can't be used in a relationship.")
    } else if (ty1 !== 'unknown' && ty2 !== 'unknown' && ty1 !== ty2 && !(isNumericType(ty1) && isNumericType(ty2))) {
      const types = `The columns have different data types (${dataTypeLabel(ty1)} and ${dataTypeLabel(ty2)}).`
      const textAndNumber = (ty1 === 'string' && isNumericType(ty2)) || (isNumericType(ty1) && ty2 === 'string')
      // text ↔ number is what the engine converts (DaxModel.keyMatch); for other pairs it finds no matching keys, and
      // saying so beats silently filtering nothing
      if (textAndNumber) warnings.push(`${types} Power BI relates them by converting the values; using the same data type on both sides is recommended.`)
      else warnings.push(`${types} Values of these types do not match each other here, so the relationship would not filter anything — give both columns the same data type.`)
    }
  }
  // cardinality vs data
  if (values.v1?.length && values.v2?.length) {
    const u1 = isUnique(values.v1)
    const u2 = isUnique(values.v2)
    const needs1 = d.cardinality === 'oneToOne' || d.cardinality === 'oneToMany'
    const needs2 = d.cardinality === 'oneToOne' || d.cardinality === 'manyToOne'
    if ((needs1 && !u1) || (needs2 && !u2)) {
      const column = needs2 && !u2 ? d.column2 : d.column1
      if (unchanged) warnings.push(`The data currently loaded has duplicate values in '${column}', the "one" side of this relationship. The relationship is kept as defined; a refresh in Power BI fails while the duplicates exist.`)
      else errors.push(`The cardinality you selected isn't valid for this relationship. The column '${column}' contains duplicate values.`)
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
  const sameColumns = others.find((r) => sameEndpoints(d, r))
  if (sameColumns) errors.push('A relationship already exists between these columns.')
  // an existing active relationship that keeps its columns and filter direction cannot become ambiguous by being saved again
  const keptActive = unchangedColumns && editing!.isActive !== false && (editing!.crossFilteringBehavior === 'bothDirections') === (d.crossFilter === 'both' || d.cardinality === 'oneToOne')
  if (d.isActive && !keptActive) {
    const activeBetween = others.find((r) => r.isActive !== false && ((r.fromTable === d.table1 && r.toTable === d.table2) || (r.fromTable === d.table2 && r.toTable === d.table1)))
    if (activeBetween) errors.push(`You can't create a direct active relationship between ${d.table1} and ${d.table2} because an active relationship already exists between these tables. To make this relationship active, deactivate or delete the other one first.`)
    else if (createsAmbiguity(d, others)) errors.push(`You can't create an active relationship between ${d.table1} and ${d.table2} because that would introduce ambiguity between tables. To make this relationship active, deactivate or delete one of the existing relationships between these tables first.`)
  }
  return { errors, warnings }
}

/** Cardinality of the draft expressed in the saved relationship's orientation (so "1:*" with swapped tables equals "*:1"). */
function uiCardinalityOfDraft(d: RelationshipDraft, r: RelationshipDef): UiCardinality {
  const flipped = r.fromTable === d.table2 && r.fromColumn === d.column2
  if (!flipped) return d.cardinality
  return d.cardinality === 'manyToOne' ? 'oneToMany' : d.cardinality === 'oneToMany' ? 'manyToOne' : d.cardinality
}

/** Directed edges along which a relationship propagates filters: one → many, both ways when bidirectional / 1:1. */
function filterEdges(fromTable: string, toTable: string, fromCardinality: string | undefined, toCardinality: string | undefined, both: boolean): Array<[string, string]> {
  const fromOne = fromCardinality === 'one'
  const toOne = (toCardinality ?? 'one') !== 'many'
  if (both || (fromOne && toOne)) return [[fromTable, toTable], [toTable, fromTable]]
  // `from` is the many side in TMDL (filters flow to → from); 1:* stored the other way round flows from → to
  return fromOne && !toOne ? [[fromTable, toTable]] : [[toTable, fromTable]]
}

/**
 * Ambiguity check: would the new active relationship give some pair of tables a second filter path?
 * Filters travel along relationships from the "one" side to the "many" side (both ways when bidirectional),
 * so two fact tables sharing two dimensions are *not* ambiguous although the tables form a cycle. A pair of
 * tables is ambiguous when two different directed filter paths connect them; only pairs that become
 * ambiguous because of the draft count (Power BI reports the relationship being added).
 */
function createsAmbiguity(d: RelationshipDraft, others: RelationshipDef[]): boolean {
  const base: Array<[string, string]> = []
  for (const r of others) if (r.isActive !== false) base.push(...filterEdges(r.fromTable, r.toTable, r.fromCardinality, r.toCardinality, r.crossFilteringBehavior === 'bothDirections'))
  const draft = relationshipFromDraft(d, undefined, '\u0000draft')
  const added = filterEdges(draft.fromTable, draft.toTable, draft.fromCardinality, draft.toCardinality, draft.crossFilteringBehavior === 'bothDirections')
  const ambiguousPairs = (edges: Array<[string, string]>): Set<string> => {
    const adj = new Map<string, string[]>()
    for (const [a, b] of edges) adj.set(a, [...(adj.get(a) ?? []), b])
    const out = new Set<string>()
    let budget = 200_000
    for (const start of adj.keys()) {
      const paths = new Map<string, number>()
      const onPath = new Set([start])
      const walk = (t: string): void => {
        for (const n of adj.get(t) ?? []) {
          if (onPath.has(n) || budget-- <= 0) continue
          paths.set(n, (paths.get(n) ?? 0) + 1)
          onPath.add(n)
          walk(n)
          onPath.delete(n)
        }
      }
      walk(start)
      for (const [t, n] of paths) if (n > 1) out.add(`${start}\u0000${t}`)
    }
    return out
  }
  const before = ambiguousPairs(base)
  for (const p of ambiguousPairs([...base, ...added])) if (!before.has(p)) return true
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
