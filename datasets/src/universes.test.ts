/**
 * Generic checks every universe must pass (tiny scale): determinism, scale budget, grain / FK /
 * SCD2 validity, reconciliation invariants, planted bronze issues, semantic model (DAX parses and
 * every reference resolves, TMDL round-trips through Lumen's reader, measures evaluate in Lumen's
 * engine), report fields and README content.
 */
import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Scalar, TableData } from '../../src/core/model/data.ts'
import type { SemanticModel } from '../../src/core/model/types.ts'
import { parseDax } from '../../src/core/dax/parser.ts'
import type { Node } from '../../src/core/dax/parser.ts'
import { readTmdlFiles } from '../../src/core/tmdl/read.ts'
import { createEngine } from '../../src/core/engine/engine.ts'
import { detectIssue } from './core/chaos.ts'
import { renderUniverseReadme } from './core/readme.ts'
import { collectUniverse, DEFAULT_TODAY, makeContext } from './core/runner.ts'
import type { Collected } from './core/runner.ts'
import { sampleProject } from './core/sample.ts'
import type { SampleProject } from './core/sample.ts'
import type { BronzeFile, Universe } from './core/schema.ts'
import { CALC_GROUP_TABLE, MEASURES_TABLE } from './core/semantic/model.ts'
import { modelToTmdlFiles } from './core/semantic/tmdl.ts'
import { UNIVERSES } from './core/universes/index.ts'
import { columnValues, validateCollected } from './core/validate.ts'

const OPTS = { seed: 42, scale: 'tiny' as const, today: DEFAULT_TODAY }

export function hashCollected(c: Collected): string {
  const h = createHash('sha256')
  const enc = (v: Scalar) => (v instanceof Date ? `D${v.getTime()}` : v === null ? 'N' : typeof v === 'object' ? 'B' : `${typeof v}${String(v)}`)
  for (const [name, t] of c.tables) {
    h.update(name)
    for (const col of t.columns) {
      h.update(col.name)
      for (const v of col.values) h.update(enc(v) + '\u0001')
    }
  }
  for (const f of c.bronze) h.update(f.path + JSON.stringify(f.rows, (_k, v: unknown) => (v instanceof Date ? `D${v.getTime()}` : v)))
  for (const [k, v] of c.issues) h.update(`${k}=${v}`)
  return h.digest('hex')
}

/** Collect every DAX reference in an expression tree. */
function daxRefs(node: Node, out: { columns: Array<{ table: string | null; name: string }>; tables: string[]; vars: Set<string> }): void {
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(visit)
    if (!n || typeof n !== 'object') return
    const x = n as Node
    if (x.kind === 'column') out.columns.push({ table: x.table, name: x.name })
    else if (x.kind === 'ident') {
      if (x.quoted) out.tables.push(x.name)
    } else if (x.kind === 'var') for (const d of x.decls) out.vars.add(d.name.toLowerCase())
    for (const v of Object.values(x)) if (v && typeof v === 'object') visit(v)
  }
  visit(node)
}

function referenceErrors(model: SemanticModel, expr: string, where: string): string[] {
  let ast: Node
  try {
    ast = parseDax(expr).ast
  } catch (e) {
    return [`${where}: DAX parse error: ${(e as Error).message}`]
  }
  const refs = { columns: [] as Array<{ table: string | null; name: string }>, tables: [] as string[], vars: new Set<string>() }
  daxRefs(ast, refs)
  const tables = new Map(model.tables.map((t) => [t.name.toLowerCase(), t]))
  const measures = new Set(model.tables.flatMap((t) => t.measures.map((m) => m.name.toLowerCase())))
  const anyColumn = new Set(model.tables.flatMap((t) => t.columns.map((c) => c.name.toLowerCase())))
  const errors: string[] = []
  for (const t of refs.tables) if (!tables.has(t.toLowerCase())) errors.push(`${where}: unknown table '${t}'`)
  for (const c of refs.columns) {
    if (c.table) {
      const t = tables.get(c.table.toLowerCase())
      if (!t) errors.push(`${where}: unknown table '${c.table}'`)
      else if (!t.columns.some((x) => x.name.toLowerCase() === c.name.toLowerCase()) && !t.measures.some((m) => m.name.toLowerCase() === c.name.toLowerCase()))
        errors.push(`${where}: unknown column '${c.table}'[${c.name}]`)
    } else if (!measures.has(c.name.toLowerCase()) && !anyColumn.has(c.name.toLowerCase())) errors.push(`${where}: unknown measure [${c.name}]`)
  }
  return errors
}

function goldRows(c: Collected): number {
  let n = 0
  for (const [name, t] of c.tables) if (name.startsWith('gold_')) n += t.rowCount
  return n
}

describe.each(UNIVERSES.map((u) => [u.id, u] as const))('universe %s', (_id, u: Universe) => {
  let c: Collected
  let sample: SampleProject

  beforeAll(() => {
    c = collectUniverse(u, OPTS)
    sample = sampleProject(u, OPTS)
  })

  it('has a complete definition', () => {
    expect(u.company.length).toBeGreaterThan(3)
    expect(u.premise.trim().length).toBeGreaterThan(200)
    const gold = u.tables.filter((t) => t.layer === 'gold')
    const facts = gold.filter((t) => t.kind === 'fact')
    const dims = c.specs.filter((t) => t.layer === 'gold' && t.kind === 'dim')
    expect(facts.length).toBeGreaterThanOrEqual(2)
    expect(facts.length).toBeLessThanOrEqual(5)
    expect(dims.length).toBeGreaterThanOrEqual(8)
    expect(dims.length).toBeLessThanOrEqual(16)
    expect(gold.some((t) => t.kind === 'bridge')).toBe(true)
    expect(c.specs.some((t) => t.scd2)).toBe(true)
    expect(u.tables.some((t) => t.layer === 'silver')).toBe(true)
    expect(u.measures.length).toBeGreaterThanOrEqual(20)
    expect(u.measures.length).toBeLessThanOrEqual(40)
    expect(u.analyses.length).toBeGreaterThanOrEqual(10)
    expect(u.issues.length).toBeGreaterThanOrEqual(10)
    expect(u.sources.length).toBeGreaterThanOrEqual(5)
    expect(u.report.length).toBeGreaterThanOrEqual(1)
    expect(u.fieldParameter?.fields.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(new Set(u.tables.map((t) => t.name)).size).toBe(u.tables.length)
    for (const t of u.tables) {
      expect(t.name.startsWith(`${t.layer}_`), t.name).toBe(true)
      if (t.layer === 'gold') expect(t.model, `${t.name} has model metadata`).toBeDefined()
      for (const k of t.key) expect(t.columns.some((col) => col.name === k), `${t.name} key ${k}`).toBe(true)
      for (const col of t.columns) expect(col.description.length, `${t.name}.${col.name} description`).toBeGreaterThan(0)
    }
  })

  it('is deterministic (same seed ⇒ identical data; other seed ⇒ different)', () => {
    const again = collectUniverse(u, OPTS)
    expect(hashCollected(again)).toBe(hashCollected(c))
    expect(hashCollected(collectUniverse(u, { ...OPTS, seed: 7 }))).not.toBe(hashCollected(c))
  })

  it('stays under the tiny budget (< 5k gold rows) with every gold table populated', () => {
    expect(goldRows(c)).toBeLessThan(5000)
    for (const s of c.specs) if (s.layer === 'gold') expect(c.tables.get(s.name)!.rowCount, s.name).toBeGreaterThan(0)
  })

  it('has unique grains, valid foreign keys, valid SCD2 history and no nulls in required columns', () => {
    expect(validateCollected(c).errors).toEqual([])
  })

  it('satisfies its reconciliation invariants', () => {
    expect(u.invariants, 'universe defines invariants()').toBeDefined()
    expect(u.invariants!(c.tables)).toEqual([])
  })

  it('plants every documented bronze issue and the detectors find it', () => {
    const refs = (table: string, column: string) => new Set(columnValues(c.tables.get(table)!, column).map((v) => String(v).trim().toUpperCase()))
    const codes = new Set<string>()
    for (const issue of u.issues) {
      expect(codes.has(issue.code), `duplicate code ${issue.code}`).toBe(false)
      codes.add(issue.code)
      expect(c.issues.get(issue.code) ?? 0, `${issue.code} planted`).toBeGreaterThan(0)
      const d = detectIssue(issue, c.bronze, refs)
      expect(d.found, `${issue.code} detected (${d.detail})`).toBeGreaterThan(0)
    }
    for (const code of c.issues.keys()) expect(codes.has(code), `issue ${code} is documented`).toBe(true)
    expect(new Set(u.issues.map((i) => i.kind)).size).toBeGreaterThanOrEqual(7)
  })

  it('emits bronze files only for documented sources, and every source has files', () => {
    const ids = new Set(u.sources.map((s) => s.id))
    const seen = new Set<string>()
    const paths = new Set<string>()
    for (const f of c.bronze as BronzeFile[]) {
      expect(ids.has(f.source), `${f.path} source ${f.source}`).toBe(true)
      expect(paths.has(f.path), `duplicate bronze path ${f.path}`).toBe(false)
      paths.add(f.path)
      seen.add(f.source)
      expect(f.path).not.toMatch(/^\/|\.\./)
    }
    for (const id of ids) expect(seen.has(id), `source ${id} produced files`).toBe(true)
    expect(new Set(c.bronze.map((f) => f.format)).size).toBeGreaterThanOrEqual(3)
  })

  it('builds a semantic model whose DAX parses and references resolve', () => {
    const m = sample.model
    const errors: string[] = []
    for (const t of m.tables) {
      for (const ms of t.measures) {
        errors.push(...referenceErrors(m, ms.expression, `measure [${ms.name}]`))
        if (ms.formatStringDefinition) errors.push(...referenceErrors(m, ms.formatStringDefinition.expression, `format of [${ms.name}]`))
      }
      for (const item of t.calculationGroup?.items ?? []) errors.push(...referenceErrors(m, item.expression, `calc item ${item.name}`))
      for (const p of t.partitions) if (p.sourceType === 'calculated') errors.push(...referenceErrors(m, p.expression!, `partition ${p.name}`))
    }
    expect(errors).toEqual([])
    const measures = m.tables.find((t) => t.name === MEASURES_TABLE)!.measures
    expect(measures.length).toBe(u.measures.length)
    expect(new Set(measures.map((x) => x.name.toLowerCase())).size).toBe(measures.length)
    expect(measures.some((x) => x.formatStringDefinition), 'a dynamic format string').toBe(true)
    const exprs = measures.map((x) => x.expression.toUpperCase()).join('\n')
    for (const fn of ['DIVIDE', 'SAMEPERIODLASTYEAR', 'USERELATIONSHIP', 'RANKX']) expect(exprs, `uses ${fn}`).toContain(fn)
    expect(/TOTALYTD|DATESYTD/.test(exprs), 'uses YTD').toBe(true)
    expect(/DATESINPERIOD|DATESBETWEEN/.test(exprs), 'uses a rolling window').toBe(true)
    expect(m.tables.find((t) => t.name === CALC_GROUP_TABLE)?.calculationGroup?.items.length).toBeGreaterThanOrEqual(8)
    expect(m.tables.find((t) => t.dataCategory === 'Time')?.columns.some((col) => col.isKey && col.dataType === 'dateTime')).toBe(true)
  })

  it('has valid relationships incl. an inactive role-playing one and a bidirectional bridge', () => {
    const m = sample.model
    for (const r of m.relationships) {
      const from = m.tables.find((t) => t.name === r.fromTable)
      const to = m.tables.find((t) => t.name === r.toTable)
      expect(from?.columns.some((col) => col.name === r.fromColumn), `${r.fromTable}[${r.fromColumn}]`).toBe(true)
      expect(to?.columns.some((col) => col.name === r.toColumn), `${r.toTable}[${r.toColumn}]`).toBe(true)
    }
    expect(m.relationships.some((r) => !r.isActive)).toBe(true)
    expect(m.relationships.some((r) => r.crossFilteringBehavior === 'bothDirections')).toBe(true)
    // at most one active path between any two tables: active relationships form a forest per direction
    const active = m.relationships.filter((r) => r.isActive)
    const seen = new Set<string>()
    for (const r of active) {
      const k = `${r.fromTable}->${r.toTable}`
      expect(seen.has(k), `two active relationships ${k}`).toBe(false)
      seen.add(k)
    }
    for (const t of m.tables) for (const h of t.hierarchies) for (const lv of h.levels) expect(t.columns.some((col) => col.name === lv.column)).toBe(true)
  })

  it('writes TMDL that Lumen reads back losslessly', () => {
    const files = modelToTmdlFiles(sample.model)
    const read = readTmdlFiles(files)
    expect(read.errors).toEqual([])
    const m = read.model
    expect(m.tables.map((t) => t.name).sort()).toEqual(sample.model.tables.map((t) => t.name).sort())
    expect(m.relationships.length).toBe(sample.model.relationships.length)
    expect(m.relationships.filter((r) => !r.isActive).length).toBe(sample.model.relationships.filter((r) => !r.isActive).length)
    for (const t of sample.model.tables) {
      const back = m.tables.find((x) => x.name === t.name)!
      expect(back.columns.map((col) => col.name)).toEqual(t.columns.map((col) => col.name))
      expect(back.measures.map((x) => [x.name, x.expression.trim()])).toEqual(t.measures.map((x) => [x.name, x.expression.trim()]))
      expect(back.hierarchies.length).toBe(t.hierarchies.length)
      expect(back.calculationGroup?.items.length ?? 0).toBe(t.calculationGroup?.items.length ?? 0)
      for (const col of t.columns) {
        const b = back.columns.find((x) => x.name === col.name)!
        expect([b.dataType, b.sourceColumn, b.sortByColumn, !!b.isHidden, b.formatString]).toEqual([col.dataType, col.sourceColumn, col.sortByColumn, !!col.isHidden, col.formatString])
      }
    }
    const param = m.expressions.find((e) => e.name === 'LakehousePath')
    expect(param?.expression).toContain('IsParameterQuery=true')
  })

  it('evaluates its measures in the Lumen engine', () => {
    const engine = createEngine(sample.model, sample.data, { now: () => DEFAULT_TODAY })
    const failures: string[] = []
    let nonBlank = 0
    for (const ms of u.measures) {
      try {
        const { value } = engine.evaluateScalar(`[${ms.name}]`)
        if (value !== null) nonBlank++
      } catch (e) {
        failures.push(`${ms.name}: ${(e as Error).message}`)
      }
    }
    // exact cross-check: simple SUM measures equal the direct column total
    let checked = 0
    for (const ms of u.measures) {
      const m = /^SUM \( '([^']+)'\[([^\]]+)\] \)$/.exec(ms.expr.trim())
      if (!m) continue
      const table = sample.model.tables.find((t) => t.name === m[1])!
      const col = table.columns.find((x) => x.name === m[2])!
      const values = sample.data.tables.get(m[1])!.columns.find((x) => x.name === col.sourceColumn)!.values
      const direct = values.reduce<number>((acc, v) => acc + ((v as number | null) ?? 0), 0)
      const { value } = engine.evaluateScalar(`[${ms.name}]`)
      expect(Number(value ?? 0), `${ms.name}`).toBeCloseTo(direct, 2)
      checked++
    }
    expect(checked, 'at least one simple SUM measure cross-checked').toBeGreaterThan(0)
    if (failures.length) console.warn(`[${u.id}] engine could not evaluate:\n  ${failures.join('\n  ')}`)
    // engine gaps belong to the engine workstream; the model must still be overwhelmingly evaluable
    expect(failures.length).toBeLessThanOrEqual(Math.floor(u.measures.length * 0.15))
    expect(nonBlank).toBeGreaterThanOrEqual(Math.floor(u.measures.length * 0.6))
  })

  it('report visuals reference existing fields and measures', () => {
    const m = sample.model
    const measures = new Set(m.tables.flatMap((t) => t.measures.map((x) => x.name)))
    const hasField = (f: { table: string; column: string }) => m.tables.find((t) => t.name === f.table)?.columns.some((col) => col.name === f.column) ?? false
    let visuals = 0
    const types = new Set<string>()
    for (const p of u.report)
      for (const v of p.visuals) {
        visuals++
        types.add(v.type)
        const fields = v.type === 'card' ? [] : v.type === 'slicer' ? [v.field] : v.type === 'matrix' ? [...v.rows, ...(v.columns ?? [])] : v.type === 'table' ? v.columns : [v.category]
        for (const f of fields) expect(hasField(f), `${p.name}: ${f.table}[${f.column}]`).toBe(true)
        const ms = v.type === 'card' ? [v.measure] : v.type === 'slicer' ? [] : v.measures
        for (const x of ms) expect(measures.has(x), `${p.name}: measure ${x}`).toBe(true)
      }
    expect(visuals).toBeGreaterThanOrEqual(6)
    for (const t of ['card', 'slicer', 'matrix', 'line']) expect(types.has(t), `report has a ${t}`).toBe(true)
  })

  it('renders a useful README', () => {
    const ctx = makeContext(u, OPTS, new Map())
    const rows = new Map([...c.tables].map(([k, t]: [string, TableData]) => [k, t.rowCount]))
    const bronze = new Map<string, { files: number; rows: number }>()
    for (const f of c.bronze) {
      const b = bronze.get(f.source) ?? { files: 0, rows: 0 }
      b.files++
      b.rows += f.rows.length
      bronze.set(f.source, b)
    }
    const md = renderUniverseReadme(u, c.specs, { scale: 'tiny', seed: 42, today: DEFAULT_TODAY, start: ctx.start, rows, bronze, issues: c.issues, model: sample.model })
    expect(md).toContain('```mermaid')
    expect(md).toContain('erDiagram')
    for (const s of c.specs) expect(md).toContain(`\`${s.name}\``)
    for (const i of u.issues) expect(md).toContain(i.code)
    for (const a of u.analyses) expect(md).toContain(a.title)
    expect(md.length).toBeGreaterThan(8000)
  })
})
