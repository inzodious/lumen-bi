/**
 * Accuracy oracle over the Microsoft sample PBIX files (real data): engine results are compared with values
 * recomputed in plain JavaScript from the raw column data —
 *   - grand totals of SUM / MIN / MAX / COUNT / DISTINCTCOUNT of every numeric column and COUNTROWS of every table,
 *   - every measure that is a plain aggregation of one column,
 *   - SUM of fact columns grouped by a dimension column through each active many-to-one relationship.
 * Location: see samples.ts (LUMEN_SAMPLES_DIR...). Skipped when absent.
 */
import { describe, expect, it } from 'vitest'
import type { Scalar } from '../../model/data'
import type { SemanticModel } from '../../model/types'
import { files, openSample } from './samples'

const NUMERIC = new Set(['int64', 'double', 'decimal'])

function near(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
  return a === b
}

const keyOf = (v: Scalar): unknown => (typeof v === 'string' ? v.toLowerCase() : v instanceof Date ? `d${v.getTime()}` : v)
/** relationship key matching: numeric text matches numbers, dates by day */
const matchKey = (v: Scalar): unknown =>
  typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v instanceof Date ? `d${Math.floor(v.getTime() / 86_400_000)}` : keyOf(v)

interface Agg {
  sum: number | null
  min: number | null
  max: number | null
  count: number | null
  distinct: number | null
}

function aggregate(values: Scalar[]): Agg {
  let sum = 0
  let n = 0
  let min = Infinity
  let max = -Infinity
  const distinct = new Set<unknown>()
  for (const v of values) {
    distinct.add(v === null ? null : keyOf(v))
    if (typeof v !== 'number') continue
    sum += v
    n++
    if (v < min) min = v
    if (v > max) max = v
  }
  return { sum: n ? sum : null, min: n ? min : null, max: n ? max : null, count: n || null, distinct: distinct.size || null }
}

/** Measures of the form FN ( 'Table'[Column] ) / COUNTROWS ( 'Table' ). */
function plainMeasures(m: SemanticModel): Array<{ name: string; fn: string; table: string; column?: string }> {
  const out: Array<{ name: string; fn: string; table: string; column?: string }> = []
  const re = /^\s*(SUM|MIN|MAX|COUNT|DISTINCTCOUNT|COUNTROWS)\s*\(\s*(?:'((?:[^']|'')+)'|([A-Za-z_][\w ]*?))\s*(?:\[([^\]]+)\])?\s*\)\s*$/i
  for (const t of m.tables) {
    for (const ms of t.measures) {
      const x = re.exec(ms.expression)
      if (!x) continue
      const fn = x[1].toUpperCase()
      const table = (x[2] ?? x[3]).replace(/''/g, "'")
      if ((fn === 'COUNTROWS') !== (x[4] === undefined)) continue
      out.push({ name: ms.name, fn, table, column: x[4] })
    }
  }
  return out
}

describe.skipIf(files.length === 0)('accuracy oracle (Microsoft samples, plain JS recomputation)', () => {
  for (const file of files) {
    it(`${file}: totals, plain measures and grouped sums match`, async () => {
      const { doc, engine } = await openSample(file)
      const data = doc.data
      const q = (name: string) => `'${name.replace(/'/g, "''")}'`
      const col = (t: string, c: string) => `${q(t)}[${c.replace(/]/g, ']]')}]`
      const mismatches: string[] = []
      let checks = 0
      const scalar = (dax: string) => engine.evaluateScalar(dax).value
      const check = (what: string, got: unknown, want: unknown) => {
        checks++
        if (!near(got, want)) mismatches.push(`${what}: engine ${String(got)} vs oracle ${String(want)}`)
      }
      // the blank row: a one-side table gets one when some many-side key is blank or has no match (it is counted by
      // COUNTROWS ( Table ) and adds BLANK to the distinct values of every column)
      const blankRow = new Set<string>()
      for (const r of doc.model.relationships) {
        if (r.fromCardinality === 'one' || r.toCardinality === 'many') continue
        const fk = data.tables.get(r.fromTable)?.columns.find((c) => c.name === r.fromColumn)
        const pk = data.tables.get(r.toTable)?.columns.find((c) => c.name === r.toColumn)
        if (!fk || !pk) continue
        const keys = new Set(pk.values.map(matchKey))
        if (fk.values.some((v) => v === null || !keys.has(matchKey(v)))) blankRow.add(r.toTable.toLowerCase())
      }
      const aggs = new Map<string, Agg>()
      for (const t of doc.model.tables) {
        const td = data.tables.get(t.name)
        if (!td || td.rowCount === 0) continue
        const blank = blankRow.has(t.name.toLowerCase())
        check(`COUNTROWS ${t.name}`, scalar(`COUNTROWS ( ${q(t.name)} )`), td.rowCount + (blank ? 1 : 0))
        for (const c of td.columns) {
          if (!NUMERIC.has(c.type)) continue
          const a = aggregate(c.values)
          aggs.set(`${t.name}|${c.name}`.toLowerCase(), a)
          const ref = col(t.name, c.name)
          check(`SUM ${t.name}[${c.name}]`, scalar(`SUM ( ${ref} )`), a.sum)
          check(`MIN ${t.name}[${c.name}]`, scalar(`MIN ( ${ref} )`), a.min)
          check(`MAX ${t.name}[${c.name}]`, scalar(`MAX ( ${ref} )`), a.max)
          check(`COUNT ${t.name}[${c.name}]`, scalar(`COUNT ( ${ref} )`), a.count)
          check(`DISTINCTCOUNT ${t.name}[${c.name}]`, scalar(`DISTINCTCOUNT ( ${ref} )`), (a.distinct ?? 0) + (blank && !c.values.includes(null) ? 1 : 0) || null)
        }
      }
      // plain-aggregation measures
      for (const pm of plainMeasures(doc.model)) {
        const td = [...data.tables.entries()].find(([n]) => n.toLowerCase() === pm.table.toLowerCase())?.[1]
        if (!td) continue
        let want: unknown
        if (pm.fn === 'COUNTROWS') want = td.rowCount + (blankRow.has(pm.table.toLowerCase()) ? 1 : 0) || null
        else {
          const c = td.columns.find((x) => x.name.toLowerCase() === pm.column!.toLowerCase())
          if (!c || !NUMERIC.has(c.type)) continue
          const a = aggregate(c.values)
          const extra = blankRow.has(pm.table.toLowerCase()) && !c.values.includes(null) ? 1 : 0
          want = { SUM: a.sum, MIN: a.min, MAX: a.max, COUNT: a.count, DISTINCTCOUNT: (a.distinct ?? 0) + extra || null }[pm.fn]
        }
        check(`measure [${pm.name}]`, scalar(`[${pm.name.replace(/]/g, ']]')}]`), want)
      }
      // grouped sums through active many-to-one relationships
      let grouped = 0
      for (const r of doc.model.relationships) {
        if (r.isActive === false || r.toCardinality === 'many' || r.fromCardinality === 'one' || grouped >= 4) continue
        const fact = data.tables.get(r.fromTable)
        const dim = data.tables.get(r.toTable)
        const dimDef = doc.model.tables.find((t) => t.name === r.toTable)
        if (!fact || !dim || !dimDef) continue
        const g = dim.columns.find((c) => c.type === 'string' && dimDef.columns.some((d) => d.name === c.name && !d.isHidden))
        const v = fact.columns.find((c) => NUMERIC.has(c.type) && c.name !== r.fromColumn)
        const fk = fact.columns.find((c) => c.name === r.fromColumn)
        const pk = dim.columns.find((c) => c.name === r.toColumn)
        if (!g || !v || !fk || !pk) continue
        // dimension key -> group value (case-insensitive grouping as in DAX; skip when the column has case variants)
        const byKey = new Map<unknown, string | null>()
        const variants = new Map<string, string>()
        let ambiguous = false
        for (let i = 0; i < dim.rowCount; i++) {
          const gv = g.values[i] as string | null
          byKey.set(matchKey(pk.values[i]), gv)
          if (gv !== null) {
            const prev = variants.get(gv.toLowerCase())
            if (prev !== undefined && prev !== gv) ambiguous = true
            variants.set(gv.toLowerCase(), gv)
          }
        }
        if (ambiguous) continue
        const sums = new Map<string | null, number>()
        const seen = new Set<string | null>()
        for (let i = 0; i < fact.rowCount; i++) {
          const k = fk.values[i]
          const gv = k === null || !byKey.has(matchKey(k)) ? null : byKey.get(matchKey(k))!
          const key = gv === null ? null : gv.toLowerCase()
          seen.add(key)
          const x = v.values[i]
          if (typeof x === 'number') sums.set(key, (sums.get(key) ?? 0) + x)
        }
        const res = engine.summarize({
          groupBy: [{ table: r.toTable, column: g.name }],
          values: [{ id: 's', expr: { kind: 'dax', expression: `SUM ( ${col(r.fromTable, v.name)} )` } }]
        })
        const got = new Map<string | null, unknown>()
        for (const row of res.rows) if (row[1] !== null) got.set(row[0] === null ? null : String(row[0]).toLowerCase(), row[1])
        for (const key of seen) {
          if (!sums.has(key)) continue
          check(`SUM ${r.fromTable}[${v.name}] by ${r.toTable}[${g.name}] = ${key}`, got.get(key), sums.get(key))
        }
        for (const key of got.keys()) if (!sums.has(key)) mismatches.push(`group ${key} of ${r.toTable}[${g.name}] has a value but no fact rows`)
        grouped++
      }
      if (mismatches.length) console.log(file, mismatches.slice(0, 20))
      expect(checks).toBeGreaterThan(0)
      expect(mismatches).toEqual([])
    }, 300_000)
  }
})
