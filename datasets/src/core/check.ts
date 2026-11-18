/**
 * Helpers for writing reconciliation invariants over collected `TableData`.
 */
import type { Scalar, TableData } from '../../../src/core/model/data.ts'

/** Iterate rows as objects (column name → value). */
export function* rowsOf(t: TableData | undefined): Generator<Record<string, Scalar>> {
  if (!t) return
  for (let r = 0; r < t.rowCount; r++) {
    const o: Record<string, Scalar> = {}
    for (const c of t.columns) o[c.name] = c.values[r]
    yield o
  }
}

function k(v: Scalar): string {
  return v instanceof Date ? String(v.getTime()) : String(v)
}

/** Sum `value` grouped by the key columns. */
export function groupSum(t: TableData | undefined, keys: string[], value: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rowsOf(t)) {
    const key = keys.map((c) => k(r[c])).join('|')
    out.set(key, (out.get(key) ?? 0) + ((r[value] as number | null) ?? 0))
  }
  return out
}

/** Count rows grouped by the key columns (optionally distinct on `distinct`). */
export function groupCount(t: TableData | undefined, keys: string[], distinct?: string): Map<string, number> {
  const sets = new Map<string, Set<string>>()
  const out = new Map<string, number>()
  for (const r of rowsOf(t)) {
    const key = keys.map((c) => k(r[c])).join('|')
    if (distinct) {
      let s = sets.get(key)
      if (!s) sets.set(key, (s = new Set()))
      s.add(k(r[distinct]))
      out.set(key, s.size)
    } else out.set(key, (out.get(key) ?? 0) + 1)
  }
  return out
}

/** Compare two keyed sums; returns up to `limit` mismatch descriptions. */
export function compareSums(label: string, a: Map<string, number>, b: Map<string, number>, tolerance = 0.011, limit = 5): string[] {
  const errors: string[] = []
  const keys = new Set([...a.keys(), ...b.keys()])
  for (const key of keys) {
    const x = a.get(key) ?? 0
    const y = b.get(key) ?? 0
    if (Math.abs(x - y) > tolerance) {
      errors.push(`${label} [${key}]: ${x.toFixed(4)} ≠ ${y.toFixed(4)}`)
      if (errors.length >= limit) break
    }
  }
  return errors
}

/** Assert a per-row predicate; returns up to `limit` failures. */
export function checkRows(label: string, t: TableData | undefined, pred: (r: Record<string, Scalar>) => boolean, limit = 5): string[] {
  const errors: string[] = []
  let i = 0
  for (const r of rowsOf(t)) {
    if (!pred(r)) {
      errors.push(`${label}: row ${i} ${JSON.stringify(r)}`)
      if (errors.length >= limit) break
    }
    i++
  }
  return errors
}

export function near(a: number | null | undefined, b: number | null | undefined, tolerance = 0.011): boolean {
  return Math.abs((a ?? 0) - (b ?? 0)) <= tolerance
}
