/**
 * DAX engine over a local corpus of PBIP semantic models (location from LUMEN_CORPUS_DIR only; skipped when unset).
 * Assertions are generic: every DAX expression parses, uses only known functions, and every measure evaluates
 * against small synthetic data with relationship-consistent keys. Set LUMEN_CORPUS_VERBOSE=1 to print details.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { readTmdlFiles } from '../../tmdl'
import type { SemanticModel, TableDef } from '../../model/types'
import type { DataStore, Scalar } from '../../model/data'
import { parseExpression, walk, FUNCTIONS } from '../../dax/tabular'
import { createEngine } from '../engine'

const CORPUS = process.env.LUMEN_CORPUS_DIR
const VERBOSE = !!process.env.LUMEN_CORPUS_VERBOSE

function findDirs(root: string, suffix: string): string[] {
  const out: string[] = []
  const rec = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const p = join(d, e.name)
      if (e.name.endsWith(suffix)) out.push(p)
      else rec(p)
    }
  }
  rec(root)
  return out.sort()
}

function readTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const rec = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) rec(p)
      else if (e.name.endsWith('.tmdl')) out[relative(dir, p).split('\\').join('/')] = readFileSync(p, 'utf8').replace(/^\uFEFF/, '')
    }
  }
  rec(dir)
  return out
}

function expressions(m: SemanticModel): Array<{ what: string; text: string }> {
  const out: Array<{ what: string; text: string }> = []
  for (const t of m.tables) {
    for (const ms of t.measures) {
      out.push({ what: 'measure', text: ms.expression })
      if (ms.formatStringDefinition?.expression) out.push({ what: 'formatString', text: ms.formatStringDefinition.expression })
    }
    for (const c of t.columns) if (c.kind === 'calculated' && c.expression) out.push({ what: 'column', text: c.expression })
    for (const p of t.partitions) if (p.sourceType === 'calculated' && p.expression) out.push({ what: 'table', text: p.expression })
    for (const it of t.calculationGroup?.items ?? []) {
      out.push({ what: 'calcItem', text: it.expression })
      if (it.formatStringDefinition?.expression) out.push({ what: 'formatString', text: it.formatStringDefinition.expression })
    }
  }
  return out
}

/** Small synthetic data: dimension keys 1..N, facts cycling through them, date tables covering two years. */
function synth(m: SemanticModel): DataStore {
  const data: DataStore = { tables: new Map(), status: new Map() }
  const toSide = new Map<string, Set<string>>()
  const fromRefs = new Map<string, { table: string; column: string }>()
  for (const r of m.relationships) {
    const key = `${r.toTable}|${r.toColumn}`.toLowerCase()
    toSide.set(r.toTable.toLowerCase(), new Set([...(toSide.get(r.toTable.toLowerCase()) ?? []), r.toColumn.toLowerCase()]))
    fromRefs.set(`${r.fromTable}|${r.fromColumn}`.toLowerCase(), { table: r.toTable, column: r.toColumn })
    void key
  }
  const isDateTable = (t: TableDef) =>
    t.dataCategory?.toLowerCase() === 'time' || t.columns.some((c) => c.dataType === 'dateTime' && toSide.get(t.name.toLowerCase())?.has(c.name.toLowerCase()))
  const isFact = (t: TableDef) => m.relationships.some((r) => r.fromTable.toLowerCase() === t.name.toLowerCase())
  const rowsOf = (t: TableDef) => (isDateTable(t) ? 731 : isFact(t) ? 40 : 6)
  const base = Date.UTC(2024, 0, 1)
  const keyValue = (t: TableDef, colName: string, type: string, r: number): Scalar => {
    if (type === 'dateTime') return new Date(base + r * 86_400_000)
    if (type === 'string') return `K${r + 1}`
    return r + 1
  }
  const valueFor = (t: TableDef, c: TableDef['columns'][number], r: number, n: number): Scalar => {
    if (toSide.get(t.name.toLowerCase())?.has(c.name.toLowerCase())) return keyValue(t, c.name, c.dataType, r)
    const ref = fromRefs.get(`${t.name}|${c.name}`.toLowerCase())
    if (ref) {
      const target = m.tables.find((x) => x.name.toLowerCase() === ref.table.toLowerCase())
      const tc = target?.columns.find((x) => x.name.toLowerCase() === ref.column.toLowerCase())
      if (target && tc) {
        const tn = rowsOf(target)
        return keyValue(target, tc.name, tc.dataType, (r * 7) % tn)
      }
    }
    if (toSide.get(t.name.toLowerCase())?.has(c.name.toLowerCase())) return keyValue(t, c.name, c.dataType, r)
    switch (c.dataType) {
      case 'dateTime':
        return new Date(base + ((r * 13) % 731) * 86_400_000 + (r % 4) * 3_600_000 * (isDateTable(t) ? 0 : 1))
      case 'string':
        if (isDateTable(t) && /month|day|quarter|year/i.test(c.name)) return String(r % 12)
        return /(^|_)(id|key|code|oid|guid|number|no)$/i.test(c.name) ? `${c.name}_${r}` : `${c.name}_${r % 3}`
      case 'boolean':
        return r % 2 === 0
      case 'int64':
        if (isDateTable(t) && /year/i.test(c.name)) return 2024 + Math.floor(r / 366)
        return /(^|_)(id|key|code|oid|number|no)$/i.test(c.name) ? r + 1 : (r % 5) + 1
      case 'double':
      case 'decimal':
        return Math.round(((r * 37) % 101) * 1.5 * 100) / 100
      default:
        return `${c.name}_${r % 3}`
    }
  }
  for (const t of m.tables) {
    if (t.calculationGroup || t.partitions.some((p) => p.sourceType === 'calculated')) continue
    const n = rowsOf(t)
    const cols = t.columns.filter((c) => c.kind === 'data')
    data.tables.set(t.name, {
      rowCount: n,
      columns: cols.map((c) => ({ name: c.name, type: c.dataType, values: Array.from({ length: n }, (_, r) => valueFor(t, c, r, n)) }))
    })
  }
  return data
}

describe.skipIf(!CORPUS || !existsSync(CORPUS))('DAX engine over the corpus', () => {
  const dirs = CORPUS ? findDirs(CORPUS, '.SemanticModel').filter((d) => existsSync(join(d, 'definition')) && statSync(join(d, 'definition')).isDirectory()) : []
  const models = dirs.map((d) => readTmdlFiles(readTree(join(d, 'definition'))).model)

  it('parses every DAX expression with known functions only', () => {
    let total = 0
    const parseErrors: string[] = []
    const unknown = new Map<string, number>()
    for (const m of models) {
      for (const e of expressions(m)) {
        total++
        try {
          walk(parseExpression(e.text), (n) => {
            if (n.kind === 'call' && !FUNCTIONS.has(n.name.toUpperCase())) unknown.set(n.name.toUpperCase(), (unknown.get(n.name.toUpperCase()) ?? 0) + 1)
          })
        } catch (err) {
          parseErrors.push(`${e.what}: ${(err as Error).message}`)
        }
      }
    }
    if (VERBOSE) process.stdout.write(JSON.stringify({ total, parseErrors: parseErrors.slice(0, 20), unknown: [...unknown] }) + "\n")
    expect(total).toBeGreaterThan(0)
    expect(parseErrors).toEqual([])
    expect([...unknown.keys()]).toEqual([])
  })

  it('builds every model with synthetic data and evaluates every measure (grand total and per group)', () => {
    let measures = 0
    let failures = 0
    let stale = 0
    let calcErrors = 0
    let cells = 0
    let cellErrors = 0
    let validationErrors = 0
    const timing = { calc: 0, groups: 0 }
    const byMessage = new Map<string, number>()
    const note = (raw: string, scrubbed: string) => {
      const k = process.env.LUMEN_CORPUS_RAW ? raw.slice(0, 300) : scrubbed
      byMessage.set(k, (byMessage.get(k) ?? 0) + 1)
    }
    const scrub = (msg: string) => msg.replace(/'[^']*'|\[[^\]]*\]|"[^"]*"/g, '…').slice(0, 140)
    /** an error caused by a reference to a table that does not exist in this model (stale definition in the source) */
    const isStale = (m: SemanticModel, msg: string) => {
      const hit = /Cannot find table '([^']+)'|Failed to resolve name '([^']+)'/.exec(msg)
      const name = hit?.[1] ?? hit?.[2]
      return !!name && !m.tables.some((t) => t.name.toLowerCase() === name.toLowerCase())
    }
    for (const m of models) {
      const data = synth(m)
      const engine = createEngine(m, data, { now: () => new Date(2025, 5, 15, 12, 0, 0) })
      const t0 = performance.now()
      const processed = engine.processCalculated()
      timing.calc += performance.now() - t0
      for (const i of processed) {
        if (isStale(m, i.error)) continue
        calcErrors++
        note(`calc ${i.table}.${i.column ?? ''}: ${i.error}`, 'calc: ' + scrub(i.error))
      }
      const all = m.tables.flatMap((t) => t.measures.map((ms) => ({ table: t.name, name: ms.name })))
      const staleMeasures = new Set<string>()
      for (const ms of all) {
        measures++
        try {
          engine.evaluateScalar(`'${ms.table.replace(/'/g, "''")}'[${ms.name.replace(/]/g, ']]')}]`)
        } catch (err) {
          const msg = (err as Error).message
          if (isStale(m, msg)) {
            stale++
            staleMeasures.add(ms.name)
            continue
          }
          failures++
          note(`${ms.name}: ${msg}`, scrub(msg))
        }
      }
      // the formula bar must not flag valid DAX
      for (const t of m.tables) {
        const exprs: Array<{ text: string; kind: 'measure' | 'calculatedColumn' | 'calculatedTable' }> = [
          ...t.measures.filter((x) => !staleMeasures.has(x.name)).map((x) => ({ text: x.expression, kind: 'measure' as const })),
          ...t.columns.filter((c) => c.kind === 'calculated' && c.expression).map((c) => ({ text: c.expression!, kind: 'calculatedColumn' as const })),
          ...t.partitions.filter((p) => p.sourceType === 'calculated' && p.expression).map((p) => ({ text: p.expression!, kind: 'calculatedTable' as const }))
        ]
        for (const e of exprs) {
          for (const d of engine.validateExpression(e.text, { kind: e.kind, table: t.name })) {
            if (d.severity !== 'error' || isStale(m, d.message)) continue
            validationErrors++
            note(`validate ${t.name}: ${d.message} @ ${e.text.slice(d.start ?? 0, d.end ?? 0)}`, 'validate: ' + scrub(d.message))
          }
        }
      }
      // per group: a few dimension columns, every (non-stale) measure as a value
      const groupCols = m.relationships
        .map((r) => m.tables.find((t) => t.name === r.toTable))
        .filter((t): t is TableDef => !!t)
        .flatMap((t) => t.columns.filter((c) => c.dataType === 'string' && c.kind !== 'rowNumber').slice(0, 1).map((c) => ({ table: t.name, column: c.name })))
        .slice(0, 3)
      const t1 = performance.now()
      for (const g of groupCols) {
        const values = all.filter((x) => !staleMeasures.has(x.name)).map((x, i) => ({ id: `v${i}`, expr: { kind: 'measure' as const, table: x.table, measure: x.name } }))
        const tq = performance.now()
        const r = engine.summarize({ groupBy: [g], values, keepBlankRows: true })
        if (VERBOSE && performance.now() - tq > 1000) console.log(`slow group-by: model #${models.indexOf(m)}, ${values.length} measures, ${r.rows.length} rows, ${(performance.now() - tq).toFixed(0)} ms`)
        cells += r.rows.length * values.length
        for (const w of r.warnings ?? []) {
          if (isStale(m, w)) continue
          cellErrors++
          note(`cell: ${w}`, 'cell: ' + scrub(w))
        }
      }
      timing.groups += performance.now() - t1
    }
    if (VERBOSE) process.stdout.write(JSON.stringify({ timing, models: models.length, measures, failures, stale, calcErrors, cells, cellErrors, validationErrors, byMessage: [...byMessage].sort((a, b) => b[1] - a[1]).slice(0, 60) }, null, 1) + "\n")
    expect(measures).toBeGreaterThan(0)
    expect(failures).toBe(0)
    expect(calcErrors).toBe(0)
    expect(cellErrors).toBe(0)
    expect(validationErrors).toBe(0)
  })
})
