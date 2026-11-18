/**
 * Differential test against the vendored Parity engine, whose golden measures are verified cell by cell against
 * a DuckDB SQL oracle (src/core/dax/__tests__/golden.test.ts). The same Starlane star schema is converted into a
 * SemanticModel + DataStore and every golden expression is evaluated by both engines over several grids and
 * slicer states. Cases the Parity engine refuses ("not supported in Parity yet") are skipped.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DaxDate, evaluate, type Model, type SlicerFilter } from '../../dax/index.ts'
import { starlane } from '../../dax/__tests__/fixture.ts'
import type { DataType, SemanticModel, TableDef } from '../../model/types'
import type { DataStore, Scalar } from '../../model/data'
import { createEngine } from '../engine'
import type { QueryEngine } from '../api'

const TYPE: Record<string, DataType> = { int: 'int64', double: 'double', string: 'string', date: 'dateTime', boolean: 'boolean' }

function convert(pm: Model): { model: SemanticModel; data: DataStore } {
  const tables: TableDef[] = []
  const data: DataStore = { tables: new Map(), status: new Map() }
  const cgTables = new Set(pm.calculationGroups.map((g) => g.table))
  for (const t of pm.tables.values()) {
    const g = pm.calculationGroups.find((x) => x.table === t)
    tables.push({
      name: t.name,
      columns: t.columns.map((c) => ({
        name: c.name,
        dataType: TYPE[c.dataType],
        kind: g ? 'calculatedTableColumn' : 'data',
        sourceColumn: g ? (c === g.column ? 'Name' : 'Ordinal') : c.name,
        sortByColumn: c.sortBy?.name ?? (g && c === g.column ? t.columns[1].name : undefined),
        isKey: pm.dateTable?.column === c
      })),
      measures: [],
      hierarchies: [],
      partitions: [{ name: t.name, sourceType: g ? 'calculationGroup' : 'm' }],
      dataCategory: pm.dateTable?.table === t ? 'Time' : undefined,
      calculationGroup: g
        ? { precedence: g.precedence, items: g.items.map((it) => ({ name: it.name, expression: it.expression, ordinal: it.ordinal, formatStringDefinition: it.formatStringDefinition ? { expression: it.formatStringDefinition } : undefined })) }
        : undefined
    })
    if (cgTables.has(t)) continue
    data.tables.set(t.name, {
      rowCount: t.rows.length,
      columns: t.columns.map((c) => ({
        name: c.name,
        type: TYPE[c.dataType],
        values: t.rows.map((r) => {
          const v = r[c.index]
          return v instanceof DaxDate ? new Date(v.days * 86_400_000) : (v as Scalar)
        })
      }))
    })
  }
  const relationships = pm.relationships.map((r) => ({
    name: r.id,
    fromTable: r.from.table.name,
    fromColumn: r.from.name,
    toTable: r.to.table.name,
    toColumn: r.to.name,
    fromCardinality: r.cardinality === 'oneToOne' ? ('one' as const) : ('many' as const),
    toCardinality: 'one' as const,
    crossFilteringBehavior: r.crossFilteringBehavior === 'both' ? ('bothDirections' as const) : ('oneDirection' as const),
    isActive: r.isActive
  }))
  return { model: { name: 'Starlane', tables, relationships, expressions: [], roles: [] }, data }
}

/** Golden expressions, read from the vendored golden test so both suites always use the same set. */
function goldenExpressions(): string[] {
  const src = readFileSync(join(import.meta.dirname, '../../dax/__tests__/golden.test.ts'), 'utf8')
  const out: string[] = []
  const re = /expression:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`]*)`)/g
  for (let m = re.exec(src); m; m = re.exec(src)) out.push((m[1] ?? m[2] ?? m[3]).replace(/\\"/g, '"').replace(/\\'/g, "'"))
  return out
}

const GRIDS: string[][] = [[], ['dim_accounts[region]', 'fact_transmissions[channel]'], ['dim_calendar[year_quarter]'], ['dim_calendar[year]', 'dim_calendar[month_end]'], ['dim_accounts[account_name]'], ['dim_products[product_line]']]
const STATES: SlicerFilter[][] = [
  [],
  [{ column: 'fact_transmissions[channel]', values: ['voice'] }],
  [
    { column: 'fact_transmissions[channel]', values: ['relay', 'beacon'] },
    { column: 'dim_accounts[region]', values: ['Core', 'Rim'] }
  ],
  [{ column: 'dim_calendar[year]', values: [2026] }],
  [{ column: 'dim_products[product_line]', values: ['freight'] }],
  [{ column: 'dim_calendar[month_end]', values: ['2025-01-31', '2025-02-28', '2025-03-31'] }],
  ...['MTD', 'QTD', 'YTD', 'PY', 'PY YTD', 'YoY', 'YoY %'].map((item) => [
    { column: 'cg_time_intelligence[time_calculation]', values: [item] },
    { column: 'dim_accounts[region]', values: ['Rim'] }
  ])
]

function sqFilter(f: SlicerFilter): any {
  const m = /^(.*)\[(.*)\]$/.exec(String(f.column))!
  const lit = (v: unknown) => ({ Literal: { Value: typeof v === 'number' ? `${v}L` : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? `datetime'${v}T00:00:00'` : `'${v}'` } })
  return { Version: 2, Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Entity: m[1] } }, Property: m[2] } }], Values: f.values.map((v) => [lit(v)]) } } }] }
}

const key = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === null ? '(blank)' : String(v))

describe('tabular engine agrees with the oracle-verified Parity engine', () => {
  let pm: Model
  let engine: QueryEngine
  const exprs = goldenExpressions()
  beforeAll(async () => {
    pm = (await starlane()).model
    const { model, data } = convert(pm)
    model.tables.push({ name: '_m', columns: [], measures: [], hierarchies: [], partitions: [] })
    for (const [i, e] of exprs.entries()) {
      model.tables.find((t) => t.name === '_m')!.measures.push({ name: `g${i}`, expression: e })
      pm.addMeasure({ name: `g${i}`, expression: e, table: '_m' })
    }
    engine = createEngine(model, data)
    expect(engine.processCalculated()).toEqual([])
  })

  it('finds the golden expressions', () => {
    expect(exprs.length).toBeGreaterThan(30)
  })

  it('every golden expression, grid and slicer state matches', () => {
    let compared = 0
    let skipped = 0
    const mismatches: string[] = []
    exprs.forEach((_, i) => {
      for (const groupBy of GRIDS) {
        for (const filters of STATES) {
          let expected: Map<string, unknown>
          try {
            const grid = evaluate(pm, { measure: `g${i}`, groupBy, filters })
            expected = new Map(grid.rows.map((r) => [r.keys.map(key).join('|'), r.value]))
          } catch {
            skipped++
            continue
          }
          const r = engine.summarize({
            groupBy: groupBy.map((c) => {
              const m = /^(.*)\[(.*)\]$/.exec(c)!
              return { table: m[1], column: m[2] }
            }),
            values: [{ id: 'v', expr: { kind: 'measure', table: '_m', measure: `g${i}` } }],
            filters: filters.map(sqFilter)
          })
          const actual = new Map(r.rows.map((row) => [row.slice(0, groupBy.length).map(key).join('|'), row[groupBy.length]]))
          if (groupBy.length === 0 && actual.get('') === null) actual.delete('')
          compared++
          const keys = new Set([...expected.keys(), ...actual.keys()])
          for (const k of keys) {
            const a = actual.get(k) ?? null
            const e = expected.get(k) ?? null
            const same = typeof a === 'number' && typeof e === 'number' ? Math.abs(a - e) <= 1e-9 * Math.max(1, Math.abs(e)) : key(a) === key(e)
            if (!same) mismatches.push(`g${i} [${groupBy.join(',')}] ${JSON.stringify(filters)} ${k}: expected ${key(e)}, got ${key(a)}`)
          }
          if (r.warnings?.length) mismatches.push(`g${i}: warnings ${r.warnings.join('; ')}`)
        }
      }
    })
    if (mismatches.length) process.stdout.write(mismatches.slice(0, 30).join('\n') + '\n')
    expect(compared).toBeGreaterThan(400)
    expect(mismatches).toEqual([])
    void skipped
  })
})
