/**
 * Slowly Changing Dimension Type 2 helpers.
 *
 * Model each entity as a list of versions (`from` date + attributes). `scd2Rows` assigns surrogate
 * keys and non-overlapping [valid_from, valid_to] ranges (valid_to = next.from - 1 day, open rows
 * end on 9999-12-31) and `Scd2Index` resolves the surrogate key in effect on a given date.
 */
import type { Scalar } from '../../../src/core/model/data.ts'
import { addDays, dateOnly, OPEN_END } from './calendar.ts'
import type { Rng } from './prng.ts'
import type { Row } from './schema.ts'

export interface Scd2Version {
  from: Date
  attrs: Record<string, Scalar>
}

export interface Scd2Entity {
  businessKey: string | number
  versions: Scd2Version[]
}

export interface Scd2RowOpts {
  skColumn: string
  bkColumn: string
  fromColumn?: string
  toColumn?: string
  currentColumn?: string
  versionColumn?: string
  firstKey?: number
}

/** Expand entities into SCD2 rows (sorted by business key order given, then version). */
export function scd2Rows(entities: Scd2Entity[], o: Scd2RowOpts): Row[] {
  const from = o.fromColumn ?? 'valid_from'
  const to = o.toColumn ?? 'valid_to'
  const cur = o.currentColumn ?? 'is_current'
  const ver = o.versionColumn ?? 'version'
  let sk = o.firstKey ?? 1
  const rows: Row[] = []
  for (const e of entities) {
    const versions = [...e.versions].sort((a, b) => a.from.getTime() - b.from.getTime())
    for (let i = 0; i < versions.length; i++) {
      const v = versions[i]
      const next = versions[i + 1]
      const validTo = next ? addDays(dateOnly(next.from), -1) : OPEN_END
      if (next && validTo.getTime() < dateOnly(v.from).getTime()) continue // same-day change: later version wins
      rows.push({
        [o.skColumn]: sk++,
        [o.bkColumn]: e.businessKey,
        ...v.attrs,
        [from]: dateOnly(v.from),
        [to]: validTo,
        [cur]: !next,
        [ver]: i + 1
      })
    }
  }
  // renumber versions after same-day collapses
  const counter = new Map<string, number>()
  for (const r of rows) {
    const k = String(r[o.bkColumn])
    const n = (counter.get(k) ?? 0) + 1
    counter.set(k, n)
    r[ver] = n
  }
  return rows
}

/** Point-in-time surrogate key lookup. */
export class Scd2Index {
  private byBk = new Map<string, Array<{ from: number; to: number; sk: number }>>()

  constructor(rows: Row[], skColumn: string, bkColumn: string, fromColumn = 'valid_from', toColumn = 'valid_to') {
    for (const r of rows) {
      const k = String(r[bkColumn])
      let list = this.byBk.get(k)
      if (!list) this.byBk.set(k, (list = []))
      list.push({ from: (r[fromColumn] as Date).getTime(), to: (r[toColumn] as Date).getTime(), sk: r[skColumn] as number })
    }
    for (const list of this.byBk.values()) list.sort((a, b) => a.from - b.from)
  }

  /** Surrogate key valid on `date`; falls back to the earliest/latest version outside the history. */
  lookup(bk: string | number, date: Date): number | null {
    const list = this.byBk.get(String(bk))
    if (!list || list.length === 0) return null
    const t = dateOnly(date).getTime()
    for (const v of list) if (t >= v.from && t <= v.to) return v.sk
    return t < list[0].from ? list[0].sk : list[list.length - 1].sk
  }
}

/**
 * Evolve an entity's attributes over [start, end]: change events arrive as a Poisson process
 * (`changesPerYear`), each applying `mutate` to a copy of the previous attributes.
 */
export function evolve(
  rng: Rng,
  start: Date,
  end: Date,
  initial: Record<string, Scalar>,
  changesPerYear: number,
  mutate: (prev: Record<string, Scalar>, at: Date, rng: Rng) => Record<string, Scalar>
): Scd2Version[] {
  const versions: Scd2Version[] = [{ from: dateOnly(start), attrs: initial }]
  const span = (end.getTime() - start.getTime()) / 86_400_000
  if (changesPerYear <= 0 || span <= 0) return versions
  let t = 0
  for (;;) {
    t += rng.exponential(365 / changesPerYear)
    if (t >= span) break
    const at = dateOnly(addDays(start, Math.floor(t)))
    const prev = versions[versions.length - 1]
    if (at.getTime() <= prev.from.getTime()) continue
    versions.push({ from: at, attrs: mutate({ ...prev.attrs }, at, rng) })
  }
  return versions
}
