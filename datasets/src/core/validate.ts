/**
 * Structural validation of generated lakehouse tables: grain uniqueness, foreign-key integrity,
 * SCD2 validity. Pure functions over `TableData`; used by the tests and `cli.ts validate`.
 */
import type { Scalar, TableData } from '../../../src/core/model/data.ts'
import type { Collected } from './runner.ts'
import type { TableSpec } from './schema.ts'

export function columnValues(t: TableData, name: string): Scalar[] {
  const col = t.columns.find((c) => c.name === name)
  if (!col) throw new Error(`column ${name} not found`)
  return col.values
}

function keyString(v: Scalar): string {
  if (v instanceof Date) return `d${v.getTime()}`
  return `${typeof v}:${String(v)}`
}

/** Number of rows whose key tuple duplicates an earlier row. */
export function grainDuplicates(spec: TableSpec, t: TableData): number {
  const cols = spec.key.map((k) => columnValues(t, k))
  const seen = new Set<string>()
  let dupes = 0
  for (let r = 0; r < t.rowCount; r++) {
    const k = cols.map((c) => keyString(c[r])).join('\u0001')
    if (seen.has(k)) dupes++
    else seen.add(k)
  }
  return dupes
}

export interface FkViolation {
  table: string
  column: string
  ref: string
  missing: number
  nulls: number
  sample: Scalar[]
}

export function fkViolations(c: Collected): FkViolation[] {
  const byName = new Map(c.specs.map((s) => [s.name, s]))
  const out: FkViolation[] = []
  for (const spec of c.specs) {
    for (const fk of spec.fks ?? []) {
      const refSpec = byName.get(fk.table)
      if (!refSpec) {
        out.push({ table: spec.name, column: fk.column, ref: `${fk.table} (undeclared)`, missing: -1, nulls: 0, sample: [] })
        continue
      }
      const refCol = fk.refColumn ?? refSpec.key[0]
      const refSet = new Set(columnValues(c.tables.get(fk.table)!, refCol).map(keyString))
      let missing = 0
      let nulls = 0
      const sample: Scalar[] = []
      for (const v of columnValues(c.tables.get(spec.name)!, fk.column)) {
        if (v === null) {
          if (!fk.nullable) nulls++
          continue
        }
        if (!refSet.has(keyString(v))) {
          missing++
          if (sample.length < 5) sample.push(v)
        }
      }
      if (missing || nulls) out.push({ table: spec.name, column: fk.column, ref: `${fk.table}.${refCol}`, missing, nulls, sample })
    }
  }
  return out
}

/** SCD2 checks: valid_from <= valid_to, no overlaps / gaps between versions, exactly one current row. */
export function scd2Errors(spec: TableSpec, t: TableData): string[] {
  if (!spec.scd2) return []
  const { businessKey, from, to, current } = spec.scd2
  const bk = columnValues(t, businessKey)
  const f = columnValues(t, from)
  const tt = columnValues(t, to)
  const cur = columnValues(t, current)
  const groups = new Map<string, number[]>()
  for (let r = 0; r < t.rowCount; r++) {
    const k = keyString(bk[r])
    let g = groups.get(k)
    if (!g) groups.set(k, (g = []))
    g.push(r)
  }
  const errors: string[] = []
  const DAY = 86_400_000
  for (const [k, rows] of groups) {
    rows.sort((a, b) => (f[a] as Date).getTime() - (f[b] as Date).getTime())
    const currents = rows.filter((r) => cur[r] === true).length
    if (currents !== 1) errors.push(`${spec.name} ${k}: ${currents} current rows`)
    for (let i = 0; i < rows.length; i++) {
      const a = rows[i]
      if ((f[a] as Date).getTime() > (tt[a] as Date).getTime()) errors.push(`${spec.name} ${k}: valid_from after valid_to`)
      if (i > 0) {
        const prev = rows[i - 1]
        const gap = (f[a] as Date).getTime() - (tt[prev] as Date).getTime()
        if (gap !== DAY) errors.push(`${spec.name} ${k}: versions ${i} and ${i + 1} ${gap <= 0 ? 'overlap' : 'leave a gap'}`)
      }
    }
    const last = rows[rows.length - 1]
    if (cur[last] !== true) errors.push(`${spec.name} ${k}: latest version is not current`)
  }
  return errors
}

export interface ValidationReport {
  errors: string[]
  checks: number
}

export function validateCollected(c: Collected): ValidationReport {
  const errors: string[] = []
  let checks = 0
  for (const spec of c.specs) {
    const t = c.tables.get(spec.name)!
    checks++
    const d = grainDuplicates(spec, t)
    if (d) errors.push(`${spec.name}: ${d} rows violate grain (${spec.key.join(', ')})`)
    if (spec.scd2) {
      checks++
      errors.push(...scd2Errors(spec, t).slice(0, 10))
    }
    for (const col of spec.columns) {
      if (col.nullable === false) {
        checks++
        const nulls = columnValues(t, col.name).filter((v) => v === null).length
        if (nulls) errors.push(`${spec.name}.${col.name}: ${nulls} nulls in non-nullable column`)
      }
    }
  }
  for (const v of fkViolations(c)) {
    errors.push(`${v.table}.${v.column} → ${v.ref}: ${v.missing} orphan keys, ${v.nulls} nulls (e.g. ${v.sample.map(String).join(', ')})`)
  }
  checks += c.specs.reduce((n, s) => n + (s.fks?.length ?? 0), 0)
  return { errors, checks }
}
