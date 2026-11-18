import { beforeAll, describe, expect, it } from 'vitest'
import { createSampleProject, SAMPLE_ANNOTATION, SAMPLE_MEASURES } from '../sample'
import type { ProjectDocument } from '../../project'
import type { DataType, SemanticModel } from '../../model/types'
import type { Scalar, TableData } from '../../model/data'
import { fieldInfo, inFilter, type SQExpr, type SQFilter } from '../../report/sq'
import { decodeLiteral } from '../../report/literal'
import { createEngine } from '../../engine/engine'
import type { QueryEngine } from '../../engine/api'
import { evaluate as daxEvaluate, evaluateScalar as daxScalar, Model as DaxModel, type DataType as DaxType } from '../../dax/index.ts'
import { evaluate as mEvaluate, parseExpression, preview as mPreview } from '../../m/index.ts'

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

function tableData(p: ProjectDocument, name: string): TableData {
  const t = p.data.tables.get(name)
  if (!t) throw new Error(`no data for ${name}`)
  return t
}

function colValues(p: ProjectDocument, table: string, column: string): Scalar[] {
  const c = tableData(p, table).columns.find((x) => x.name === column)
  if (!c) throw new Error(`no column ${table}[${column}]`)
  return c.values
}

const keyOf = (v: Scalar): string => (v instanceof Date ? `d${v.getTime()}` : `${typeof v}:${String(v)}`)

function valueMatchesType(v: Scalar, t: DataType): boolean {
  if (v === null) return true
  switch (t) {
    case 'int64':
      return typeof v === 'number' && Number.isInteger(v)
    case 'double':
    case 'decimal':
      return typeof v === 'number' && Number.isFinite(v)
    case 'string':
      return typeof v === 'string'
    case 'boolean':
      return typeof v === 'boolean'
    case 'dateTime':
      return v instanceof Date && !Number.isNaN(v.getTime())
    default:
      return false
  }
}

/** Every SQ field expression in a JSON tree (projections, sort definitions, filters...). */
function collectFields(node: unknown, out: SQExpr[] = []): SQExpr[] {
  if (Array.isArray(node)) {
    for (const n of node) collectFields(n, out)
    return out
  }
  if (!node || typeof node !== 'object') return out
  const o = node as Record<string, unknown>
  if (o.Column || o.Measure || o.Aggregation || o.HierarchyLevel) {
    out.push(o)
    return out
  }
  for (const v of Object.values(o)) collectFields(v, out)
  return out
}

/** Every `{ Literal: { Value } }` in a JSON tree. */
function collectLiterals(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const n of node) collectLiterals(n, out)
    return out
  }
  if (!node || typeof node !== 'object') return out
  const o = node as Record<string, unknown>
  const lit = o.Literal as { Value?: unknown } | undefined
  if (lit && typeof lit.Value === 'string') out.push(lit.Value)
  for (const v of Object.values(o)) collectLiterals(v, out)
  return out
}

/** Resolve a field against the model; returns an error string or null. */
function resolveField(model: SemanticModel, expr: SQExpr): string | null {
  const f = fieldInfo(expr)
  const table = model.tables.find((t) => t.name === f.table)
  if (!table) return `unknown table '${f.table}' in ${JSON.stringify(expr)}`
  switch (f.kind) {
    case 'column':
      return table.columns.some((c) => c.name === f.property) ? null : `unknown column ${f.table}[${f.property}]`
    case 'measure':
      return table.measures.some((m) => m.name === f.property) ? null : `unknown measure ${f.table}[${f.property}]`
    case 'aggregation':
      return f.inner?.kind === 'column' && table.columns.some((c) => c.name === f.property) ? null : `bad aggregation ${JSON.stringify(expr)}`
    case 'hierarchyLevel': {
      const h = table.hierarchies.find((x) => x.name === f.hierarchy)
      if (!h) return `unknown hierarchy ${f.table}.${f.hierarchy}`
      const lvl = h.levels.find((l) => l.name === f.level)
      if (!lvl) return `unknown level ${f.table}.${f.hierarchy}.${f.level}`
      return table.columns.some((c) => c.name === lvl.column) ? null : `level ${lvl.name} points to a missing column`
    }
    default:
      return `unsupported field ${JSON.stringify(expr)}`
  }
}

/** Column behind a grouping field (column or hierarchy level). */
function groupColumn(model: SemanticModel, expr: SQExpr): { table: string; column: string } | null {
  const f = fieldInfo(expr)
  if (f.kind === 'column') return { table: f.table!, column: f.property! }
  if (f.kind === 'hierarchyLevel') {
    const h = model.tables.find((t) => t.name === f.table)?.hierarchies.find((x) => x.name === f.hierarchy)
    const lvl = h?.levels.find((l) => l.name === f.level)
    return lvl ? { table: f.table!, column: lvl.column } : null
  }
  return null
}

/** Built-in Power BI visual types (fallback when the renderer registry can't be imported in Node). */
const PBI_VISUAL_TYPES = new Set([
  'textbox', 'shape', 'image', 'actionButton', 'pageNavigator', 'bookmarkNavigator', 'slicer', 'listSlicer', 'textSlicer', 'advancedSlicerVisual',
  'card', 'cardVisual', 'multiRowCard', 'kpi', 'gauge', 'tableEx', 'pivotTable', 'barChart', 'clusteredBarChart', 'hundredPercentStackedBarChart',
  'columnChart', 'clusteredColumnChart', 'hundredPercentStackedColumnChart', 'lineChart', 'areaChart', 'stackedAreaChart',
  'lineClusteredColumnComboChart', 'lineStackedColumnComboChart', 'ribbonChart', 'waterfallChart', 'funnel', 'scatterChart', 'pieChart',
  'donutChart', 'treemap', 'map', 'filledMap', 'shapeMap', 'azureMap', 'decompositionTreeVisual', 'keyDriversVisual', 'qnaVisual'
])

// ---------------------------------------------------------------------------------------------
// Measure evaluation: the QueryEngine when implemented, else the vendored DAX engine directly.
// ---------------------------------------------------------------------------------------------

const DAX_TYPES: Partial<Record<DataType, DaxType>> = { int64: 'int', double: 'double', decimal: 'double', string: 'string', dateTime: 'date', boolean: 'boolean' }

function buildDaxModel(p: ProjectDocument): DaxModel {
  const m = new DaxModel()
  for (const t of p.model.tables) {
    const td = tableData(p, t.name)
    const cols = t.columns.map((c) => td.columns.find((x) => x.name === c.name)!)
    const rows: unknown[][] = []
    for (let r = 0; r < td.rowCount; r++) rows.push(cols.map((c) => c.values[r]))
    m.addTable(
      t.name,
      t.columns.map((c) => ({ name: c.name, dataType: DAX_TYPES[c.dataType]!, formatString: c.formatString, isHidden: c.isHidden })),
      rows
    )
  }
  for (const r of p.model.relationships) {
    m.addRelationship({
      fromColumn: { table: r.fromTable, column: r.fromColumn },
      toColumn: { table: r.toTable, column: r.toColumn },
      isActive: r.isActive,
      crossFilteringBehavior: r.crossFilteringBehavior === 'bothDirections' ? 'both' : 'single'
    })
  }
  for (const t of p.model.tables) {
    for (const c of t.columns) if (c.sortByColumn) m.setSortBy({ table: t.name, column: c.name }, c.sortByColumn)
    if (t.dataCategory === 'Time') m.markAsDateTable(t.name, t.columns.find((c) => c.isKey)!.name)
  }
  for (const t of p.model.tables) for (const ms of t.measures) m.addMeasure({ name: ms.name, expression: ms.expression, table: t.name, formatString: ms.formatString })
  return m
}

interface Evaluator {
  kind: 'engine' | 'dax'
  engine?: QueryEngine
  measure(name: string, year?: number): Scalar
  grouped(measure: string, groupBy: Array<{ table: string; column: string }>): Array<{ keys: Scalar[]; value: Scalar }>
}

function makeEvaluator(p: ProjectDocument): Evaluator {
  let engine: QueryEngine | undefined
  try {
    engine = createEngine(p.model, p.data)
    engine.processCalculated()
  } catch (e) {
    if (!/not implemented/i.test(String((e as Error)?.message ?? e))) throw e
    engine = undefined
  }
  if (engine) {
    const eng = engine
    const filters = (year?: number): SQFilter[] => (year === undefined ? [] : [inFilter('Date', 'Year', [year])])
    return {
      kind: 'engine',
      engine: eng,
      measure: (name, year) => eng.evaluateScalar(`[${name}]`, filters(year)).value,
      grouped: (measure, groupBy) => {
        const res = eng.summarize({ groupBy, values: [{ id: 'v', expr: { kind: 'measure', table: '_Measures', measure } }] })
        return res.rows.map((r) => ({ keys: r.slice(0, groupBy.length), value: r[groupBy.length] ?? null }))
      }
    }
  }
  // createEngine is still a stub: validate with the vendored DAX engine (same evaluator the adapter wraps).
  const dax = buildDaxModel(p)
  return {
    kind: 'dax',
    measure: (name, year) => daxScalar(dax, `[${name}]`, year === undefined ? [] : [{ column: 'Date[Year]', values: [year] }]),
    grouped: (measure, groupBy) =>
      daxEvaluate(dax, { measure, groupBy: groupBy.map((g) => ({ table: g.table, column: g.column })) })
        .rows.filter((r) => r.level === groupBy.length)
        .map((r) => ({ keys: r.keys, value: r.value }))
  }
}

// ---------------------------------------------------------------------------------------------

describe('createSampleProject', () => {
  let p: ProjectDocument
  beforeAll(() => {
    p = createSampleProject()
  })

  it('returns a new, clean project with model, data and report', () => {
    expect(p.name).toBe('Sample - Sales')
    expect(p.source).toEqual({ kind: 'new' })
    expect(p.dirty).toBe(false)
    expect(p.diagnostics).toEqual([])
    expect(p.report?.origin).toBe('new')
    expect(p.model.annotations?.[SAMPLE_ANNOTATION]).toBe('true')
    const sales = tableData(p, 'Sales')
    expect(sales.rowCount).toBeGreaterThanOrEqual(15_000)
    expect(sales.rowCount).toBeLessThanOrEqual(25_000)
  })

  it('is deterministic', () => {
    const q = createSampleProject()
    expect(q.id).toBe(p.id)
    expect(q.model).toEqual(p.model)
    expect(q.report).toEqual(p.report)
    expect([...q.data.tables.keys()]).toEqual([...p.data.tables.keys()])
    for (const [name, t] of p.data.tables) expect(q.data.tables.get(name)).toEqual(t)
    expect([...q.data.status.entries()]).toEqual([...p.data.status.entries()])
  })
})

describe('sample model integrity', () => {
  let p: ProjectDocument
  beforeAll(() => {
    p = createSampleProject()
  })

  it('has loaded, typed data for every table, matching the model columns', () => {
    for (const t of p.model.tables) {
      const td = tableData(p, t.name)
      expect(td.columns.map((c) => c.name), t.name).toEqual(t.columns.map((c) => c.name))
      const status = p.data.status.get(t.name)
      expect(status).toEqual(expect.objectContaining({ state: 'loaded', source: 'import', rowCount: td.rowCount }))
      expect(t.annotations?.[SAMPLE_ANNOTATION]).toBe('true')
      for (const c of t.columns) {
        const cd = td.columns.find((x) => x.name === c.name)!
        expect(cd.type, `${t.name}[${c.name}]`).toBe(c.dataType)
        expect(cd.values.length).toBe(td.rowCount)
        const bad = cd.values.find((v) => !valueMatchesType(v, c.dataType))
        expect(bad, `${t.name}[${c.name}] value ${String(bad)}`).toBeUndefined()
        if (c.dataType === 'dateTime') {
          // date-only values: midnight wall clock (UTC fields, per the DataStore contract)
          expect(cd.values.every((v) => v === null || (v as Date).getTime() % 86_400_000 === 0)).toBe(true)
        }
      }
    }
  })

  it('has unique, non-blank key columns and hidden keys with summarizeBy none', () => {
    for (const t of p.model.tables) {
      for (const c of t.columns.filter((x) => x.isKey)) {
        const vals = colValues(p, t.name, c.name)
        expect(vals.includes(null), `${t.name}[${c.name}] blank`).toBe(false)
        expect(new Set(vals.map(keyOf)).size, `${t.name}[${c.name}] unique`).toBe(vals.length)
        expect(c.summarizeBy).toBe('none')
      }
      for (const c of t.columns.filter((x) => /Key$/.test(x.name))) {
        expect(c.isHidden, `${t.name}[${c.name}] hidden`).toBe(true)
        expect(c.summarizeBy).toBe('none')
      }
    }
  })

  it('has many-to-one single-direction relationships whose foreign keys all exist on the one side', () => {
    expect(p.model.relationships.length).toBe(5)
    for (const r of p.model.relationships) {
      expect(r).toEqual(expect.objectContaining({ fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection', isActive: true }))
      const fromT = p.model.tables.find((t) => t.name === r.fromTable)!
      const toT = p.model.tables.find((t) => t.name === r.toTable)!
      const fromC = fromT.columns.find((c) => c.name === r.fromColumn)!
      const toC = toT.columns.find((c) => c.name === r.toColumn)!
      expect(fromC.dataType).toBe(toC.dataType)
      const oneSide = colValues(p, r.toTable, r.toColumn)
      expect(new Set(oneSide.map(keyOf)).size, `${r.toTable}[${r.toColumn}] unique`).toBe(oneSide.length)
      const keys = new Set(oneSide.map(keyOf))
      const missing = colValues(p, r.fromTable, r.fromColumn).filter((v) => v === null || !keys.has(keyOf(v)))
      expect(missing.length, `${r.fromTable}[${r.fromColumn}] -> ${r.toTable}[${r.toColumn}]`).toBe(0)
    }
    // snowflake: Customer -> Region
    expect(p.model.relationships.some((r) => r.fromTable === 'Customer' && r.toTable === 'Region')).toBe(true)
  })

  it('has a contiguous date table marked as date table covering every order date', () => {
    const date = p.model.tables.find((t) => t.name === 'Date')!
    expect(date.dataCategory).toBe('Time')
    expect(date.columns.find((c) => c.isKey)?.name).toBe('Date')
    const days = colValues(p, 'Date', 'Date').map((v) => (v as Date).getTime() / 86_400_000)
    for (let i = 1; i < days.length; i++) expect(days[i] - days[i - 1]).toBe(1)
    const orderDays = colValues(p, 'Sales', 'OrderDate').map((v) => (v as Date).getTime() / 86_400_000)
    expect(Math.min(...orderDays)).toBeGreaterThanOrEqual(days[0])
    expect(Math.max(...orderDays)).toBeLessThanOrEqual(days[days.length - 1])
  })

  it('has valid sort-by columns, hierarchies and format strings', () => {
    for (const t of p.model.tables) {
      for (const c of t.columns.filter((x) => x.sortByColumn)) {
        const by = t.columns.find((x) => x.name === c.sortByColumn)
        expect(by, `${t.name}[${c.name}] sortBy`).toBeDefined()
        const vals = colValues(p, t.name, c.name)
        const keys = colValues(p, t.name, by!.name)
        const seen = new Map<string, string>()
        vals.forEach((v, i) => {
          const prev = seen.get(keyOf(v))
          expect(prev === undefined || prev === keyOf(keys[i]), `${t.name}[${c.name}] has one sort key per value`).toBe(true)
          seen.set(keyOf(v), keyOf(keys[i]))
        })
      }
      for (const h of t.hierarchies) {
        expect(h.levels.length).toBeGreaterThan(1)
        for (const l of h.levels) expect(t.columns.some((c) => c.name === l.column), `${t.name}.${h.name}.${l.name}`).toBe(true)
      }
    }
    const date = p.model.tables.find((t) => t.name === 'Date')!
    expect(date.hierarchies[0].levels.map((l) => l.column)).toEqual(['Year', 'Quarter', 'Month'])
    expect(date.columns.find((c) => c.name === 'Month')?.sortByColumn).toBe('Month Number')
    const product = p.model.tables.find((t) => t.name === 'Product')!
    expect(product.hierarchies[0].levels.map((l) => l.column)).toEqual(['Category', 'Subcategory', 'Product'])

    const measures = p.model.tables.flatMap((t) => t.measures)
    expect(measures.length).toBeGreaterThanOrEqual(15)
    expect(new Set(measures.map((m) => m.name.toLowerCase())).size).toBe(measures.length)
    const columnNames = new Set(p.model.tables.flatMap((t) => t.columns.map((c) => c.name.toLowerCase())))
    for (const m of measures) {
      expect(columnNames.has(m.name.toLowerCase()), `measure ${m.name} clashes with a column`).toBe(false)
      expect(m.formatString, m.name).toBeTruthy()
      expect(m.displayFolder, m.name).toBeTruthy()
    }
    expect(measures.find((m) => m.name === 'Total Sales')?.formatString).toBe('\\$#,0;(\\$#,0);\\$#,0')
    expect(measures.find((m) => m.name === 'Margin %')?.formatString).toBe('0.0%')
    expect(measures.find((m) => m.name === 'Orders')?.formatString).toBe('#,0')
  })

  it('has realistic patterns (seasonality, growth, category price ranges, skew)', () => {
    const amount = colValues(p, 'Sales', 'SalesAmount') as number[]
    const dates = colValues(p, 'Sales', 'OrderDate') as Date[]
    const byYear = new Map<number, number>()
    const byMonth = new Array<number>(12).fill(0)
    dates.forEach((d, i) => {
      byYear.set(d.getUTCFullYear(), (byYear.get(d.getUTCFullYear()) ?? 0) + amount[i])
      byMonth[d.getUTCMonth()] += amount[i]
    })
    const years = [...byYear.keys()].sort()
    expect(years.length).toBe(3)
    for (let i = 1; i < years.length; i++) expect(byYear.get(years[i])!).toBeGreaterThan(byYear.get(years[i - 1])! * 1.05)
    expect(Math.max(...byMonth) / Math.min(...byMonth)).toBeGreaterThan(1.8)

    const price = new Map((colValues(p, 'Product', 'ProductKey') as number[]).map((k, i) => [k, colValues(p, 'Product', 'List Price')[i] as number]))
    const cat = new Map((colValues(p, 'Product', 'ProductKey') as number[]).map((k, i) => [k, colValues(p, 'Product', 'Category')[i] as string]))
    const bikePrices = [...price].filter(([k]) => cat.get(k) === 'Bikes').map(([, v]) => v)
    const accPrices = [...price].filter(([k]) => cat.get(k) === 'Accessories').map(([, v]) => v)
    expect(Math.min(...bikePrices)).toBeGreaterThan(Math.max(...accPrices))

    // top 20 % of customers bring well over 20 % of sales
    const byCustomer = new Map<number, number>()
    ;(colValues(p, 'Sales', 'CustomerKey') as number[]).forEach((k, i) => byCustomer.set(k, (byCustomer.get(k) ?? 0) + amount[i]))
    const sorted = [...byCustomer.values()].sort((a, b) => b - a)
    const top = sorted.slice(0, Math.ceil(sorted.length / 5)).reduce((a, b) => a + b, 0)
    expect(top / sorted.reduce((a, b) => a + b, 0)).toBeGreaterThan(0.4)

    // amounts are consistent: SalesAmount = Quantity × UnitPrice − Discount
    const qty = colValues(p, 'Sales', 'Quantity') as number[]
    const unit = colValues(p, 'Sales', 'UnitPrice') as number[]
    const disc = colValues(p, 'Sales', 'Discount') as number[]
    amount.forEach((a, i) => expect(Math.abs(a - (qty[i] * unit[i] - disc[i]))).toBeLessThan(0.011))
  })

  it('has M partitions that parse; embedded/calendar queries reproduce the data', () => {
    for (const t of p.model.tables) {
      expect(t.partitions.length).toBe(1)
      const part = t.partitions[0]
      expect(part.sourceType).toBe('m')
      expect(part.mode).toBe('import')
      expect(() => parseExpression(part.expression!), t.name).not.toThrow()
      const embedded = /#table\([\s\S]*\{\s*\{/.test(part.expression!) || t.name === 'Date'
      if (!embedded) continue
      const pv = mPreview(mEvaluate(part.expression!), 1_000_000)
      if (pv.kind !== 'table') throw new Error(`${t.name}: M returned ${pv.kind}`)
      const td = tableData(p, t.name)
      expect(pv.columns.map((c) => c.name), t.name).toEqual(td.columns.map((c) => c.name))
      expect(pv.rowCount, t.name).toBe(td.rowCount)
      for (let r = 0; r < td.rowCount; r++) {
        for (let c = 0; c < td.columns.length; c++) {
          const want = td.columns[c].values[r]
          const got = pv.rows[r][c]
          if (want instanceof Date) expect(String(got).slice(0, 10), `${t.name} r${r} c${c}`).toBe(want.toISOString().slice(0, 10))
          else expect(got, `${t.name} r${r} ${td.columns[c].name}`).toEqual(want)
        }
      }
    }
  })
})

describe('sample report', () => {
  let p: ProjectDocument
  beforeAll(() => {
    p = createSampleProject()
  })

  it('has three 1280×720 pages listed in pageOrder', () => {
    const r = p.report!
    expect(r.pages.length).toBe(3)
    expect(r.pagesMeta.pageOrder).toEqual(r.pages.map((pg) => pg.name))
    expect(r.pagesMeta.pageOrder).toContain(r.pagesMeta.activePageName)
    expect(r.pages.map((pg) => pg.json.displayName)).toEqual(['Overview', 'Products', 'Customers & Regions'])
    for (const pg of r.pages) {
      expect(pg.json).toEqual(expect.objectContaining({ name: pg.name, width: 1280, height: 720, displayOption: 'FitToPage' }))
      expect(pg.visuals.length).toBeGreaterThanOrEqual(10)
      expect(new Set(pg.visuals.map((v) => v.name)).size).toBe(pg.visuals.length)
    }
    expect(r.report.themeCollection.baseTheme.name).toBe('CY24SU10')
  })

  it('uses well-formed visual containers that fit on the page', () => {
    for (const pg of p.report!.pages) {
      for (const v of pg.visuals) {
        const j = v.json
        expect(j.$schema).toMatch(/visualContainer\/2\.\d+\.\d+\/schema\.json$/)
        expect(j.name).toBe(v.name)
        expect(v.name).toMatch(/^[0-9a-f]{20}$/)
        const pos = j.position
        for (const k of ['x', 'y', 'z', 'width', 'height', 'tabOrder']) expect(typeof pos[k], `${v.name}.${k}`).toBe('number')
        expect(pos.x).toBeGreaterThanOrEqual(0)
        expect(pos.y).toBeGreaterThanOrEqual(0)
        expect(pos.x + pos.width).toBeLessThanOrEqual(1280)
        expect(pos.y + pos.height).toBeLessThanOrEqual(720)
        expect(typeof j.visual.visualType).toBe('string')
        expect(j.visual.drillFilterOtherVisuals).toBe(true)
        for (const [role, well] of Object.entries<any>(j.visual.query?.queryState ?? {})) {
          for (const pr of well.projections) {
            expect(typeof pr.queryRef, `${role} queryRef`).toBe('string')
            expect(typeof pr.nativeQueryRef).toBe('string')
          }
        }
        // every literal decodes per literal.ts
        for (const lit of collectLiterals(j)) expect(/^('.*'|-?\d+(\.\d+)?[LDM]|true|false|null|datetime'.*')$/s.test(lit), lit).toBe(true)
        for (const lit of collectLiterals(j)) expect(() => decodeLiteral(lit)).not.toThrow()
      }
    }
  })

  it('references only fields that exist in the model', () => {
    const problems: string[] = []
    const r = p.report!
    const trees: unknown[] = [r.report.filterConfig]
    for (const pg of r.pages) {
      trees.push(pg.json.filterConfig)
      for (const v of pg.visuals) trees.push(v.json.visual.query, v.json.filterConfig)
    }
    let count = 0
    for (const tree of trees) {
      for (const f of collectFields(tree)) {
        count++
        const err = resolveField(p.model, f)
        if (err) problems.push(err)
      }
    }
    expect(problems).toEqual([])
    expect(count).toBeGreaterThan(80)
  })

  it('includes the expected visual types (all known Power BI visuals)', async () => {
    const types = new Set(p.report!.pages.flatMap((pg) => pg.visuals.map((v) => v.json.visual.visualType as string)))
    for (const t of ['textbox', 'shape', 'slicer', 'cardVisual', 'multiRowCard', 'lineChart', 'clusteredColumnChart', 'barChart', 'donutChart', 'tableEx', 'pivotTable']) {
      expect(types.has(t), t).toBe(true)
    }
    for (const t of types) expect(PBI_VISUAL_TYPES.has(t), t).toBe(true)

    // The renderer registry (React modules) is checked when it can be imported in Node; visual
    // families still under construction by other workstreams are reported, not failed.
    let registry: { getVisual(t: string): unknown } | undefined
    try {
      registry = (await import('../../../renderer/src/visuals/index')) as { getVisual(t: string): unknown }
    } catch {
      registry = undefined
    }
    if (registry) {
      const missing = [...types].filter((t) => !registry!.getVisual(t))
      if (missing.length) console.info(`[sample] visual types not registered in the renderer yet: ${missing.join(', ')}`)
      expect(registry.getVisual('textbox')).toBeTruthy()
    }
  })

  it('uses slicer modes and expected PBIR shapes', () => {
    const visuals = p.report!.pages.flatMap((pg) => pg.visuals.map((v) => v.json.visual))
    const modes = visuals.filter((v) => v.visualType === 'slicer').map((v) => decodeLiteral(v.objects.data[0].properties.mode.expr.Literal.Value))
    expect(new Set(modes)).toEqual(new Set(['Dropdown', 'Basic']))
    const textbox = visuals.find((v) => v.visualType === 'textbox')
    expect(textbox.objects.general[0].properties.paragraphs[0].textRuns[0].value).toBe('Sales Overview')
    const shape = visuals.find((v) => v.visualType === 'shape')
    expect(shape.objects.shape[0].properties.tileShape.expr.Literal.Value).toBe("'rectangle'")
    const matrix = visuals.find((v) => v.visualType === 'pivotTable')
    expect(Object.keys(matrix.query.queryState).sort()).toEqual(['Columns', 'Rows', 'Values'])
    const line = visuals.find((v) => v.visualType === 'lineChart')
    expect(line.query.queryState.Y.projections.map((x: any) => x.nativeQueryRef)).toEqual(['Total Sales', 'Sales LY'])
  })
})

describe('sample measures evaluate to sane numbers', () => {
  let p: ProjectDocument
  let ev: Evaluator
  const sales = { total: 0, cost: 0, byYear: new Map<number, number>(), dec2025: 0, q4_2025: 0, orders: 0, customers: 0, units: 0 }

  beforeAll(() => {
    p = createSampleProject()
    ev = makeEvaluator(p)
    const amount = colValues(p, 'Sales', 'SalesAmount') as number[]
    const cost = colValues(p, 'Sales', 'Cost') as number[]
    const dates = colValues(p, 'Sales', 'OrderDate') as Date[]
    amount.forEach((a, i) => {
      const d = dates[i]
      sales.total += a
      sales.cost += cost[i]
      sales.byYear.set(d.getUTCFullYear(), (sales.byYear.get(d.getUTCFullYear()) ?? 0) + a)
      if (d.getUTCFullYear() === 2025 && d.getUTCMonth() === 11) sales.dec2025 += a
      if (d.getUTCFullYear() === 2025 && d.getUTCMonth() >= 9) sales.q4_2025 += a
    })
    sales.orders = new Set(colValues(p, 'Sales', 'OrderNumber')).size
    sales.customers = new Set(colValues(p, 'Sales', 'CustomerKey')).size
    sales.units = (colValues(p, 'Sales', 'Quantity') as number[]).reduce((a, b) => a + b, 0)
  })

  it('every measure is non-blank at the grand total and for 2025', () => {
    console.info(`[sample] measures evaluated with ${ev.kind === 'engine' ? 'createEngine' : 'the vendored DAX engine (createEngine is still a stub)'}`)
    for (const m of SAMPLE_MEASURES) {
      for (const year of [undefined, 2025]) {
        const v = ev.measure(m.name, year)
        expect(typeof v, `${m.name} (${year ?? 'total'}) = ${String(v)}`).toBe('number')
        expect(Number.isFinite(v as number), m.name).toBe(true)
      }
    }
  })

  it('base measures match the data', () => {
    const near = (a: Scalar, b: number, tol = 0.01) => expect(Math.abs((a as number) - b)).toBeLessThan(tol)
    near(ev.measure('Total Sales'), sales.total, 0.05)
    near(ev.measure('Total Cost'), sales.cost, 0.05)
    near(ev.measure('Margin'), sales.total - sales.cost, 0.05)
    expect(ev.measure('Orders')).toBe(sales.orders)
    expect(ev.measure('Customers')).toBe(sales.customers)
    expect(ev.measure('Units')).toBe(sales.units)
    near(ev.measure('Avg Order Value'), sales.total / sales.orders)
    const marginPct = ev.measure('Margin %') as number
    expect(marginPct).toBeGreaterThan(0.3)
    expect(marginPct).toBeLessThan(0.6)
    const disc = ev.measure('Discount %') as number
    expect(disc).toBeGreaterThan(0.005)
    expect(disc).toBeLessThan(0.15)
    near(ev.measure('% of Total Sales'), 1, 1e-9)
    near(ev.measure('% of Grand Total', 2025), sales.byYear.get(2025)! / sales.total, 1e-9)
  })

  it('time intelligence matches the data', () => {
    const near = (a: Scalar, b: number) => expect(Math.abs((a as number) - b)).toBeLessThan(0.05)
    near(ev.measure('Total Sales', 2025), sales.byYear.get(2025)!)
    near(ev.measure('Sales LY', 2025), sales.byYear.get(2024)!)
    const yoy = ev.measure('Sales YoY %', 2025) as number
    expect(Math.abs(yoy - (sales.byYear.get(2025)! / sales.byYear.get(2024)! - 1))).toBeLessThan(1e-9)
    expect(yoy).toBeGreaterThan(0.05)
    expect(yoy).toBeLessThan(0.4)
    near(ev.measure('Sales YTD'), sales.byYear.get(2025)!)
    near(ev.measure('Sales MTD'), sales.dec2025)
    near(ev.measure('Sales Rolling 3M'), sales.q4_2025)
  })

  it('grouped by category, % of Total Sales adds up to 100 %', () => {
    const rows = ev.grouped('% of Total Sales', [{ table: 'Product', column: 'Category' }])
    expect(rows.length).toBe(4)
    expect(rows.reduce((a, r) => a + (r.value as number), 0)).toBeCloseTo(1, 9)
  })

  it('every data visual returns rows for its grouping fields', () => {
    const empty: string[] = []
    for (const pg of p.report!.pages) {
      for (const v of pg.visuals) {
        const qs = v.json.visual.query?.queryState
        if (!qs || v.json.visual.visualType === 'slicer') continue
        const projections = Object.values<any>(qs).flatMap((w) => w.projections)
        const groups = projections.map((pr) => groupColumn(p.model, pr.field)).filter((g): g is { table: string; column: string } => !!g)
        const measures = projections.map((pr) => fieldInfo(pr.field)).filter((f) => f.kind === 'measure')
        for (const m of measures) {
          const rows = ev.grouped(m.property!, groups)
          if (!rows.some((r) => r.value !== null)) empty.push(`${pg.json.displayName} / ${v.json.visual.visualType} / ${m.property}`)
        }
      }
    }
    expect(empty).toEqual([])
  })

  it('every visual query runs through the QueryEngine like the renderer issues it', () => {
    if (!ev.engine) {
      console.info('[sample] createEngine unavailable: visual queries not checked through the QueryEngine')
      return
    }
    const eng = ev.engine
    const GROUP_ROLES = new Set(['Category', 'Series', 'Rows', 'Columns', 'Legend'])
    const problems: string[] = []
    for (const pg of p.report!.pages) {
      for (const v of pg.visuals) {
        const visual = v.json.visual
        const qs = visual.query?.queryState
        if (!qs) continue
        const where = `${pg.json.displayName} / ${visual.visualType} ${v.name}`
        try {
          if (visual.visualType === 'slicer') {
            const res = eng.distinctValues({ column: { kind: 'sq', expr: qs.Values.projections[0].field } })
            if (!res.values.length) problems.push(`${where}: slicer has no values`)
            continue
          }
          const groupBy: Array<{ kind: 'sq'; expr: SQExpr }> = []
          const values: Array<{ id: string; expr: { kind: 'sq'; expr: SQExpr } }> = []
          for (const [role, well] of Object.entries<any>(qs)) {
            for (const pr of well.projections) {
              const kind = fieldInfo(pr.field).kind
              const isGroup = GROUP_ROLES.has(role) || ((role === 'Values') && (kind === 'column' || kind === 'hierarchyLevel'))
              if (isGroup) groupBy.push({ kind: 'sq', expr: pr.field })
              else values.push({ id: pr.queryRef, expr: { kind: 'sq', expr: pr.field } })
            }
          }
          const res = eng.summarize({ groupBy, values })
          if (!res.rows.length) problems.push(`${where}: no rows`)
          if (res.warnings?.length) problems.push(`${where}: ${res.warnings.join('; ')}`)
          const valueCells = res.rows.flatMap((r) => r.slice(groupBy.length))
          if (!valueCells.some((x) => typeof x === 'number')) problems.push(`${where}: no numeric values`)
        } catch (e) {
          problems.push(`${where}: ${(e as Error).message}`)
        }
      }
    }
    expect(problems).toEqual([])
  })
})
