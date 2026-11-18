/** toDaxQuery: the generated DAX query returns exactly what summarize returns. */
import { describe, expect, it } from 'vitest'
import type { SummarizeRequest } from '../api'
import { col, engineFor, inF, lit, msr } from './fixture'

const { engine } = engineFor()
const where = (table: string, cond: any) => ({ Version: 2, From: [{ Name: 's', Entity: table, Type: 0 }], Where: [{ Condition: cond }] })
const sref = (c: string) => ({ Column: { Expression: { SourceRef: { Source: 's' } }, Property: c } })

const requests: Array<[string, SummarizeRequest]> = [
  ['two groups, measures', { groupBy: [{ table: 'Date', column: 'Year' }, { table: 'Product', column: 'Category' }], values: [{ id: 's', expr: { kind: 'measure', table: 'Sales', measure: 'Sales' } }, { id: 'q', expr: { kind: 'measure', table: 'Sales', measure: 'Qty' } }] }],
  ['In / Not In filters, implicit aggregation', {
    groupBy: [{ table: 'Customer', column: 'Country' }],
    values: [{ id: 'a', expr: { kind: 'aggregate', table: 'Sales', column: 'Qty', fn: 'sum' } }, { id: 's', expr: { kind: 'measure', table: 'Sales', measure: 'Sales YTD' } }],
    filters: [inF('Product', 'Category', ["'Bikes'", "'Clothing'"]), inF('Product', 'Color', ["'Black'"], true)]
  }],
  ['date range + measure filter + sort by value + limit', {
    groupBy: [{ table: 'Product', column: 'Name' }],
    values: [{ id: 's', expr: { kind: 'sq', expr: msr('Sales', 'Sales') } }],
    filters: [
      where('Date', { Between: { Expression: sref('Date'), LowerBound: lit("datetime'2024-02-01T00:00:00'"), UpperBound: lit("datetime'2025-02-28T00:00:00'") } }),
      where('Sales', { Comparison: { ComparisonKind: 1, Left: msr('Sales', 'Sales'), Right: lit('15D') } })
    ],
    orderBy: [{ target: { value: 's' }, direction: 'desc' }],
    limit: 2
  }],
  ['card (no group-by)', { groupBy: [], values: [{ id: 's', expr: { kind: 'measure', table: 'Sales', measure: 'Sales Share' } }], filters: [inF('Product', 'Name', ["'A'"])] }]
]

describe('toDaxQuery', () => {
  for (const [name, req] of requests) {
    it(name, () => {
      const text = engine.toDaxQuery!(req)
      expect(text).toMatch(/SUMMARIZECOLUMNS/)
      const res = engine.runDaxQuery(text).tables[0]
      const directRes = engine.summarize(req)
      // the query also groups by sort-by columns (like Power BI): keep the summarize columns
      const ids = directRes.columns.map((c) => (c.kind === 'group' ? `${c.id.slice(0, c.id.lastIndexOf('.'))}[${c.id.slice(c.id.lastIndexOf('.') + 1)}]` : null))
      const keep = res.columns.map((c, j) => (ids.includes(c.name) || j >= res.columns.length - req.values.length ? j : -1)).filter((j) => j >= 0)
      const viaQuery = res.rows.map((r) => keep.map((j) => r[j]))
      const direct = directRes.rows
      // TOPN keeps ties (like Power BI's windowed queries); summarize cuts at the limit
      expect(req.limit !== undefined ? viaQuery.slice(0, direct.length) : viaQuery).toEqual(direct)
    })
  }
  it('looks like Power BI\'s query', () => {
    const text = engine.toDaxQuery!(requests[2][1])
    expect(text).toContain('VAR __DS0FilterTable = ')
    expect(text).toContain('FILTER ( KEEPFILTERS ( VALUES ( \'Date\'[Date] ) ), AND ( \'Date\'[Date] >= DATE ( 2024, 2, 1 ), \'Date\'[Date] <= DATE ( 2025, 2, 28 ) ) )')
    expect(text).toContain("TOPN ( 2, __DS0ValueFiltered, [Sales], 0 )")
    expect(text).toMatch(/EVALUATE\n\t__DS0PrimaryWindowed\n\nORDER BY\n\t\[Sales\] DESC/)
  })
})
void col

describe('toDaxQuery: Power BI shapes', () => {
  it('sort-by columns are grouped and ordered like Power BI; implicit measures are wrapped in CALCULATE', () => {
    const req: SummarizeRequest = { groupBy: [{ table: 'Date', column: 'Year' }, { table: 'Date', column: 'Month' }], values: [{ id: 'q', expr: { kind: 'aggregate', table: 'Sales', column: 'Qty', fn: 'sum' } }] }
    const text = engine.toDaxQuery!(req)
    expect(text).toContain("'Date'[Month],\n\t\t\t'Date'[MonthNo],")
    expect(text).toContain('"SumQty", CALCULATE ( SUM ( \'Sales\'[Qty] ) )')
    expect(text).toMatch(/ORDER BY\n\t'Date'\[Year\], 'Date'\[MonthNo\], 'Date'\[Month\]$/)
    const res = engine.runDaxQuery(text).tables[0]
    expect(res.rows.map((r) => [r[0], r[1], r[3]])).toEqual(engine.summarize(req).rows)
  })
})

describe('toVisualCalcDaxQuery', () => {
  const sales = { id: 'Sales', expr: { kind: 'measure' as const, table: 'Sales', measure: 'Sales' } }
  const vcReq = {
    base: { groupBy: [{ table: 'Product', column: 'Category' }, { table: 'Date', column: 'Year' }, { table: 'Date', column: 'Month' }], values: [sales] },
    rowFields: 1,
    names: ['Category', 'Year', 'Month', 'Sales'],
    calcs: [
      { id: 'a', name: 'Across', expression: 'RUNNINGSUM ( [Sales], COLUMNS )' },
      { id: 'b', name: 'Share', expression: 'DIVIDE ( [Sales], COLLAPSEALL ( [Sales], ROWS ) )' }
    ]
  }
  it('has the visual shape of Power BI\'s query', () => {
    const text = engine.toVisualCalcDaxQuery!(vcReq)
    expect(text).toContain("COLUMN '__DS0VisualCalcs'[Across] = RUNNINGSUM ( [Sales], COLUMNS )")
    expect(text).toContain('ROLLUPADDISSUBTOTAL ( \'Product\'[Category], "IsGrandTotalRowTotal" )')
    expect(text).toContain('ROLLUPADDISSUBTOTAL ( \'Date\'[Year], "IsGrandTotalColumnTotal", ROLLUPGROUP ( \'Date\'[Month], \'Date\'[MonthNo] ), "IsDM2Total" )')
    expect(text).toContain("TABLE '__DS0VisualCalcs' = __DS0VisualCalcsInput\n\t\tWITH VISUAL SHAPE\n\t\tAXIS ROWS\n\t\t\tGROUP [Category] TOTAL [IsGrandTotalRowTotal]")
    expect(text).toContain('GROUP [Month], [MonthNo] TOTAL [IsDM2Total]')
    expect(text).toContain('ORDER BY [Year] ASC, [MonthNo] ASC, [Month] ASC')
    expect(text).toContain('DENSIFY "IsDensifiedRow"')
  })
  it('runs and gives the visual calculation values of every cell (densified included)', () => {
    const vc = engine.evaluateVisualCalculations!(vcReq)
    expect(vc.errors).toEqual([null, null])
    const t = engine.runDaxQuery(engine.toVisualCalcDaxQuery!(vcReq)).tables[0]
    const col = (n: string) => t.columns.findIndex((c) => c.name === `[${n}]`)
    const [cat, yr, mo, fr, fy, fm, a, b, dens] = ['Category', 'Year', 'Month', 'IsGrandTotalRowTotal', 'IsGrandTotalColumnTotal', 'IsDM2Total', 'Across', 'Share', 'IsDensifiedRow'].map(col)
    expect(Math.min(cat, yr, mo, fr, fy, fm, a, b, dens)).toBeGreaterThanOrEqual(0)
    const round = (v: unknown) => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v)
    let compared = 0
    for (const c of vc.cells) {
      if (c.calcs.every((v) => v === null)) continue
      const row = t.rows.find((r) => r[fr] === (c.rowLevel === 0) && r[fy] === (c.colLevel === 0) && r[fm] === (c.colLevel < 2) && (c.rowLevel === 0 || r[cat] === c.keys[0]) && (c.colLevel === 0 || r[yr] === c.keys[1]) && (c.colLevel < 2 || r[mo] === c.keys[2]))
      expect(row, JSON.stringify(c)).toBeTruthy()
      expect([round(row![a]), round(row![b])]).toEqual(c.calcs.map(round))
      compared++
    }
    expect(compared).toBeGreaterThan(10)
    // densified cells exist (e.g. Accessories has no 2024 sales) and keep their running sum across columns
    expect(t.rows.some((r) => r[dens] === true)).toBe(true)
  })
})
