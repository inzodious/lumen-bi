/**
 * Data windowing (PBI data reduction): a 100k-group matrix / table must render from bounded queries —
 * only the first window of 500 rows evaluates measures; the next window is loaded on demand, and the
 * numbers are the same as the unrestricted query's.
 */
import type { QueryEngine, SummarizeRequest } from '@core/engine/api'
import { build } from '@core/dax/tabular/__tests__/build'
import { createEngine } from '@core/engine/engine'
import { columnExpr, fieldKey, measureExpr, type SQExpr } from '@core/report/sq'
import { gradientColor } from '../common/conditionalFormatting'
import { createMockHost } from '../common/mockHost'
import { proj } from '../common/sampleData'
import { buildMatrixView } from './matrixView'
import { buildTableModel } from './tableModel'
import { COLUMN_GROUP_LIMIT, ROW_WINDOW, shadowSensitive, windowedSummarize } from './windowQuery'

const MEASURES: Record<string, string> = {
  Total: 'SUM ( T[V] )',
  Double: 'SUM ( T[V] ) * 2',
  Rows: 'COUNTROWS ( T )',
  Avg: 'AVERAGE ( T[V] )',
  Hi: 'MAX ( T[V] )',
  Lo: 'MIN ( T[V] )',
  Ratio: 'DIVIDE ( [Total], [Rows] )',
  Share: 'DIVIDE ( [Total], CALCULATE ( [Total], ALLSELECTED ( T ) ) )',
  Wsum: 'SUM ( T[W] )'
}
const SEVEN = ['Total', 'Double', 'Rows', 'Avg', 'Hi', 'Lo', 'Ratio']

function bigEngine(): QueryEngine {
  const rows: Array<[string, string, string, number, number]> = []
  // W = the A index: its range over the first window (A0000–A0001) is far narrower than over all rows
  for (let a = 0; a < 400; a++) for (let b = 0; b < 250; b++) rows.push([`A${String(a).padStart(4, '0')}`, `B${String(b).padStart(3, '0')}`, `C${String((a * 7 + b) % 150).padStart(3, '0')}`, ((a * 31 + b * 17) % 97) + 1, a])
  const { model, data } = build({ tables: { T: { columns: { A: 'string', B: 'string', C: 'string', V: 'int64', W: 'int64' }, rows, measures: MEASURES } } })
  const e = createEngine(model, data)
  e.processCalculated()
  return e
}

interface Call {
  req: SummarizeRequest
  /** groups the engine had to evaluate the values for (group combinations under the call's filters) */
  groups: number
}

/** Spy engine: records each summarize call with the number of groups it evaluates measures for. */
function spy(engine: QueryEngine): { engine: QueryEngine; calls: Call[] } {
  const calls: Call[] = []
  const wrapped = new Proxy(engine, {
    get(target, prop, recv) {
      if (prop === 'summarize') {
        return (req: SummarizeRequest) => {
          const groups = req.values.length && req.groupBy.length ? target.summarize({ groupBy: req.groupBy, values: [], filters: req.filters }).rows.length : req.groupBy.length ? 0 : 1
          calls.push({ req, groups })
          return target.summarize(req)
        }
      }
      return Reflect.get(target, prop, recv)
    }
  })
  return { engine: wrapped, calls }
}

const A = columnExpr('T', 'A')
const B = columnExpr('T', 'B')
const C = columnExpr('T', 'C')
const m = (n: string) => measureExpr('T', n)

function matrixJson(values: string[], opts: { columns?: boolean } = {}) {
  return {
    name: 'mx',
    visual: {
      visualType: 'pivotTable',
      query: {
        queryState: {
          Rows: { projections: [proj(A, 'T.A', { active: true }), proj(B, 'T.B', { active: true })] },
          ...(opts.columns ? { Columns: { projections: [proj(C, 'T.C', { active: true })] } } : {}),
          Values: { projections: values.map((v) => proj(m(v), `T.${v}`)) }
        }
      }
    }
  }
}

function tableJson(values: string[], sort?: any) {
  return {
    name: 'tb',
    visual: {
      visualType: 'tableEx',
      query: {
        queryState: { Values: { projections: [proj(A, 'T.A'), proj(B, 'T.B'), ...values.map((v) => proj(m(v), `T.${v}`))] } },
        ...(sort ? { sortDefinition: { sort } } : {})
      }
    }
  }
}

/** measure evaluations = Σ groups × values over the calls that evaluate more than a sort value */
const cost = (calls: Call[]) => calls.reduce((s, c) => s + c.groups * c.req.values.length, 0)

describe('data windowing', () => {
  const base = bigEngine()

  it('matrix with 100k row groups × 7 measures: the initial render issues bounded queries', () => {
    const { engine, calls } = spy(base)
    const t0 = Date.now()
    const v = buildMatrixView(matrixJson(SEVEN), createMockHost({ engine }))
    const ms = Date.now() - t0
    expect(v.error).toBeUndefined()
    expect(v.data.hasMore).toBe(true)
    // first window: 500 rows (one top-level group + its children ... in display order)
    const nodes = v.layout.items.filter((i) => i.kind === 'node')
    expect(nodes.length).toBeLessThanOrEqual(ROW_WINDOW)
    expect(nodes.length).toBeGreaterThan(ROW_WINDOW - 10)
    for (const c of calls) {
      // every query evaluating the 7 measures runs over at most one window of groups (or is a grand total)
      if (c.req.values.length > 1) expect(c.groups).toBeLessThanOrEqual(ROW_WINDOW + 1)
    }
    expect(cost(calls)).toBeLessThan(10 * ROW_WINDOW * SEVEN.length)
    expect(ms).toBeLessThan(10_000)
  })

  it('matrix: the next window extends the rows (scroll), values match the unrestricted query', () => {
    const { engine, calls } = spy(base)
    const ctx = createMockHost({ engine })
    const first = buildMatrixView(matrixJson(SEVEN), ctx)
    const second = buildMatrixView(matrixJson(SEVEN), ctx, 2 * ROW_WINDOW)
    const n1 = first.layout.items.filter((i) => i.kind === 'node').length
    const n2 = second.layout.items.filter((i) => i.kind === 'node').length
    expect(n2).toBeGreaterThan(n1)
    expect(n2).toBeLessThanOrEqual(2 * ROW_WINDOW)
    for (const c of calls) if (c.req.values.length > 1) expect(c.groups).toBeLessThanOrEqual(2 * ROW_WINDOW + 1)
    // the first window's rows are a prefix of the second's
    const labels = (v: typeof first) => v.layout.items.filter((i) => i.kind === 'node').map((i) => JSON.stringify(i.path))
    expect(labels(second).slice(0, n1 - 1)).toEqual(labels(first).slice(0, n1 - 1))
    // a leaf cell equals the plain engine result for that group
    const leafIdx = second.layout.items.findIndex((i) => i.kind === 'node' && i.path.length === 2 && i.path[0] === 'A0001')
    const leaf = second.layout.items[leafIdx]
    const plain = base.summarize({
      groupBy: [{ kind: 'sq', expr: A }, { kind: 'sq', expr: B }],
      values: [{ id: 't', expr: { kind: 'sq', expr: m('Total') } }],
      filters: [{ Version: 2, From: [], Where: [{ Condition: { In: { Expressions: [A], Values: [[{ Literal: { Value: "'A0001'" } }]] } } }] } as any]
    })
    const want = plain.rows.find((r) => r[1] === leaf.path[1])![2]
    expect(second.cells[leafIdx][0].value).toBe(want)
    // grand total is the full, unrestricted total
    const grand = second.layout.items.findIndex((i) => i.kind === 'grand')
    if (grand >= 0) expect(second.cells[grand][0].value).toBe(base.evaluateScalar('[Total]').value)
  })

  it('collapsed matrix only queries the visible level', () => {
    const { engine, calls } = spy(base)
    const json = matrixJson(SEVEN)
    json.visual.query.queryState.Rows.projections[1].active = false
    const v = buildMatrixView(json, createMockHost({ engine }))
    expect(v.layout.items.filter((i) => i.kind === 'node').every((i) => i.path.length === 1)).toBe(true)
    // no query groups by both row fields
    expect(calls.some((c) => c.req.groupBy.length >= 2 && c.req.values.length > 0)).toBe(false)
    expect(v.data.hasMore).toBe(false) // 400 top-level groups fit in one window
  })

  it('matrix columns load 100 grouping columns at a time (column windowing)', () => {
    const { engine } = spy(base)
    const json = matrixJson(['Total'], { columns: true })
    json.visual.query.queryState.Rows.projections[1].active = false
    const v = buildMatrixView(json, createMockHost({ engine }))
    expect(v.data.columnsCapped).toBe(true)
    expect(v.data.columnWindow).toBe(COLUMN_GROUP_LIMIT)
    const groupLeaves = v.layout.leaves.filter((l) => !l.isTotal)
    expect(groupLeaves.length).toBe(COLUMN_GROUP_LIMIT)
    // no "not all data" warning: the rest is fetched on horizontal scroll
    expect(v.data.warnings.join(' ')).not.toMatch(/Not all data/)
  })

  it('the next column window extends the columns; cells and the grand total stay exact', () => {
    const { engine, calls } = spy(base)
    const json = matrixJson(['Total'], { columns: true })
    json.visual.query.queryState.Rows.projections[1].active = false
    const ctx = createMockHost({ engine })
    const first = buildMatrixView(json, ctx)
    const second = buildMatrixView(json, ctx, ROW_WINDOW, 2 * COLUMN_GROUP_LIMIT)
    const leaves1 = first.layout.leaves.filter((l) => !l.isTotal).map((l) => l.path[0])
    const leaves2 = second.layout.leaves.filter((l) => !l.isTotal).map((l) => l.path[0])
    // 150 distinct C values: the second window holds all of them, the first 100 are a prefix
    expect(leaves2.length).toBe(150)
    expect(leaves2.slice(0, COLUMN_GROUP_LIMIT)).toEqual(leaves1)
    expect(second.data.columnsCapped).toBe(false)
    // value queries are bounded by the row window × column window
    for (const c of calls) if (c.req.values.length && c.req.groupBy.length === 2) expect(c.groups).toBeLessThanOrEqual(ROW_WINDOW * 2 * COLUMN_GROUP_LIMIT)
    // a cell in the second column window equals the plain engine result
    const li = second.layout.leaves.findIndex((l) => !l.isTotal && l.path[0] === 'C140')
    const ri = second.layout.items.findIndex((i) => i.kind === 'node' && i.path[0] === 'A0003')
    const plain = base.summarize({
      groupBy: [{ kind: 'sq', expr: A }, { kind: 'sq', expr: C }],
      values: [{ id: 't', expr: { kind: 'sq', expr: m('Total') } }],
      filters: [{ Version: 2, From: [], Where: [{ Condition: { In: { Expressions: [A], Values: [[{ Literal: { Value: "'A0003'" } }]] } } }] } as any]
    })
    expect(second.cells[ri][li].value).toBe(plain.rows.find((r) => r[1] === 'C140')?.[2] ?? null)
    // the row total column (all columns) is exact in both windows
    const totalCol = (v: typeof first) => v.layout.leaves.findIndex((l) => l.totalKind === 'grand')
    const rowTotal = base.summarize({ groupBy: [{ kind: 'sq', expr: A }], values: [{ id: 't', expr: { kind: 'sq', expr: m('Total') } }], filters: [] }).rows.find((r) => r[0] === 'A0003')![1]
    expect(first.cells[first.layout.items.findIndex((i) => i.kind === 'node' && i.path[0] === 'A0003')][totalCol(first)].value).toBe(rowTotal)
    expect(second.cells[ri][totalCol(second)].value).toBe(rowTotal)
  })

  it('table with 100k rows × 7 measures: bounded queries, next window on demand', () => {
    const { engine, calls } = spy(base)
    const ctx = createMockHost({ engine })
    const t = buildTableModel(tableJson(SEVEN), ctx)
    expect(t.rows.length).toBe(ROW_WINDOW)
    expect(t.hasMore).toBe(true)
    for (const c of calls) if (c.req.values.length > 1 && c.req.groupBy.length) expect(c.groups).toBeLessThanOrEqual(ROW_WINDOW + 1)
    expect(t.total?.[2].value).toBe(base.evaluateScalar('[Total]').value)
    const t2 = buildTableModel(tableJson(SEVEN), ctx, 2 * ROW_WINDOW)
    expect(t2.rows.length).toBe(2 * ROW_WINDOW)
    expect(t2.rows.slice(0, ROW_WINDOW).map((r) => r[0].text + r[1].text)).toEqual(t.rows.map((r) => r[0].text + r[1].text))
  })

  it('table sorted by a measure: only the sort value is evaluated for every group', () => {
    const { engine, calls } = spy(base)
    const t = buildTableModel(tableJson(SEVEN, [{ field: m('Avg'), direction: 'Descending' }]), createMockHost({ engine }))
    expect(t.rows.length).toBe(ROW_WINDOW)
    const full = calls.filter((c) => c.groups > ROW_WINDOW + 1)
    expect(full.every((c) => c.req.values.length <= 1)).toBe(true)
    const avg = t.rows.map((r) => r[5].value as number)
    expect([...avg].sort((a, b) => b - a)).toEqual(avg)
  })

  it('table: gradient range covers every row, not only the loaded window', () => {
    const json: any = tableJson(['Wsum'])
    json.visual.objects = { values: [{ properties: { backColor: gradientFill(m('Wsum')) }, selector: { metadata: 'T.Wsum' } }] }
    const t = buildTableModel(json, createMockHost({ engine: base }))
    expect(t.hasMore).toBe(true)
    const row = t.rows.find((r) => r[2].value === 1)!
    // W ranges 0..399 over all rows; with window stats (0..1) the cell would get the max color
    expect(row[2].background).toBe(gradientColor([{ color: '#FFFFFF' }, { color: '#000000' }], 1, { min: 0, max: 399 }))
    expect(row[2].background).not.toBe('#000000')
  })

  it('matrix: data-bar range covers every group (separate min/max query)', () => {
    const json: any = matrixJson(['Wsum'])
    json.visual.objects = { columnFormatting: [{ properties: { dataBars: { positiveColor: { solid: { color: { expr: { Literal: { Value: "'#118DFF'" } } } } } } }, selector: { metadata: 'T.Wsum' } }] }
    const v = buildMatrixView(json, createMockHost({ engine: base }))
    expect(v.data.hasMore).toBe(true)
    expect(v.data.fullStats?.stats.get(fieldKey(m('Wsum')))).toEqual({ min: 0, max: 399 })
    const i = v.layout.items.findIndex((it) => it.kind === 'node' && it.path.length === 2 && it.path[0] === 'A0001')
    expect(v.cells[i][0].bar?.width).toBeCloseTo(1 / 399, 5)
  })

  it('ALLSELECTED measures are not restricted (correct numbers)', () => {
    expect(shadowSensitive(base, [{ kind: 'sq', expr: m('Share') }])).toBe(true)
    expect(shadowSensitive(base, [{ kind: 'sq', expr: m('Ratio') }])).toBe(false)
    const req: SummarizeRequest = {
      groupBy: [{ kind: 'sq', expr: A }, { kind: 'sq', expr: B }],
      values: [{ id: 's', expr: { kind: 'sq', expr: m('Share') } }],
      orderBy: [{ target: { group: 0 }, direction: 'asc' }, { target: { group: 1 }, direction: 'asc' }]
    }
    const w = windowedSummarize(base, req, 50)
    const full = base.summarize({ ...req, limit: 50 })
    expect(w.hasMore).toBe(true)
    expect(w.rows).toEqual(full.rows)
  })
})

function gradientFill(input: SQExpr) {
  const c = (v: string) => ({ color: { Literal: { Value: `'${v}'` } } })
  return { solid: { color: { expr: { FillRule: { Input: input, FillRule: { linearGradient2: { min: c('#FFFFFF'), max: c('#000000'), nullColoringStrategy: { strategy: { Literal: { Value: "'asZero'" } } } } } } } } } }
}
