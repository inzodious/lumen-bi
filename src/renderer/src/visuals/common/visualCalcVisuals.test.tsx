/**
 * Visual calculations in visuals (charts, tables, matrices), incl. PBI's DENSIFY on ROWS × COLUMNS visuals:
 * combinations without base data get cells (blank base values) when a calculation is non-blank there.
 *
 * Data: Region × Channel with (B, Y) and (C, X) missing. RUNNINGSUM([Total]) runs down ROWS:
 *   X: A 10, B 15, C 15 (densified)      Y: A 20, B 20 (densified), C 27      row totals: 30, 35, 42
 */
import { describe, expect, it } from 'vitest'
import { createEngine } from '@core/engine/engine'
import { tableFromRows, type DataStore } from '@core/model/data'
import type { SemanticModel } from '@core/model/types'
import { createMockHost } from './mockHost'
import { buildCategorical } from './categorical'
import { col, msr, visualJson } from '../gallery/registry'
import { loadMatrix } from '../tables/matrixQuery'
import { blockKey } from '../tables/matrixModel'
import { readTableFormat } from '../tables/tableFormat'
import { buildTableModel } from '../tables/tableModel'
import { evaluateCalcLattice } from './visualCalcs'
import { getProjections } from './query'
import '../index'

function engine() {
  const model: SemanticModel = {
    name: 'VC',
    culture: 'en-US',
    tables: [
      {
        name: 'Sales',
        columns: [
          { name: 'Region', dataType: 'string', kind: 'data', sourceColumn: 'Region' },
          { name: 'Channel', dataType: 'string', kind: 'data', sourceColumn: 'Channel' },
          { name: 'Amount', dataType: 'double', kind: 'data', sourceColumn: 'Amount', summarizeBy: 'sum' }
        ],
        measures: [{ name: 'Total', expression: 'SUM ( Sales[Amount] )', formatString: '#,0' }],
        hierarchies: [],
        partitions: [{ name: 'Sales', sourceType: 'unknown' }]
      }
    ],
    relationships: [],
    expressions: [],
    roles: []
  }
  const data: DataStore = { tables: new Map(), status: new Map() }
  data.tables.set(
    'Sales',
    tableFromRows(['Region', 'Channel', 'Amount'], ['string', 'string', 'double'], [
      ['A', 'X', 10],
      ['A', 'Y', 20],
      ['B', 'X', 5],
      ['C', 'Y', 7]
    ])
  )
  data.status.set('Sales', { state: 'loaded', source: 'synthetic', rowCount: 4 })
  const e = createEngine(model, data)
  e.processCalculated()
  return e
}

const vc = { expr: { NativeVisualCalculation: { Language: 'dax', Expression: 'RUNNINGSUM([Total])', Name: 'Running' } } as any }
const region = col('Sales', 'Region')
const channel = col('Sales', 'Channel')
const total = msr('Sales', 'Total')
const ctx = createMockHost({ engine: engine() })

describe('visual calculations over ROWS × COLUMNS (DENSIFY)', () => {
  it('lattice: leaf, densified and total cells', () => {
    const json = visualJson('m', 'pivotTable', { Rows: [region], Columns: [channel], Values: [total, vc] })
    const p = getProjections(json)
    const lat = evaluateCalcLattice(ctx, p.Rows, p.Columns, [p.Values[0]], [p.Values[1]])
    expect(lat.get(['A'], ['X'])).toEqual([10])
    expect(lat.get(['C'], ['Y'])).toEqual([27])
    const dens = lat.cellsAt(1, 1).filter((c) => c.densified)
    expect(dens.map((c) => [...c.rowKeys, ...c.colKeys, c.calcs[0]]).sort()).toEqual([
      ['B', 'Y', 20],
      ['C', 'X', 15]
    ])
    // row-total column (colLevel 0)
    expect(lat.get(['C'], [])).toEqual([42])
  })

  it('matrix: calc slots filled in every block, densified cells added with blank base values', () => {
    const json = visualJson('m', 'pivotTable', { Rows: [region], Columns: [channel], Values: [total, vc] })
    const m = loadMatrix(json, ctx, readTableFormat(json, ctx.theme))
    const leaf = m.spec.blocks.get(blockKey(1, 1))!
    const at = (r: string, c: string) => leaf.rows.find((row) => row[0] === r && row[1] === c)
    expect(at('A', 'X')?.slice(2, 4)).toEqual([10, 10])
    expect(at('B', 'Y')?.slice(2, 4)).toEqual([null, 20])
    expect(at('C', 'X')?.slice(2, 4)).toEqual([null, 15])
    const rowTotals = m.spec.blocks.get(blockKey(1, 0))!
    expect(rowTotals.rows.map((r) => [r[0], r[1], r[2]])).toEqual([
      ['A', 30, 30],
      ['B', 5, 35],
      ['C', 7, 42]
    ])
    expect(m.warnings).toEqual([])
  })

  it('chart: densified rows land in existing categories / legend series', () => {
    // (a calculation can only reference fields of the visual: Total is on the Y axis too)
    const json = visualJson('c', 'lineChart', { Category: [region], Series: [channel], Y: [total, vc] })
    const d = buildCategorical(json, ctx, { seriesRole: 'Series', splitRoles: ['Y'] })
    expect(d.categories.map((c) => c.label)).toEqual(['A', 'B', 'C'])
    const byName = Object.fromEntries(d.series.map((s) => [s.name, s.values]))
    expect(byName).toEqual({ 'X Total': [10, 5, null], 'X Running': [10, 15, 15], 'Y Total': [20, null, 7], 'Y Running': [20, 20, 27] })
  })

  it('chart: a calc next to its base measure on one axis (no densify)', () => {
    const json = visualJson('c', 'clusteredColumnChart', { Category: [region], Y: [total, vc] })
    const d = buildCategorical(json, ctx, {})
    expect(d.series.map((s) => s.values)).toEqual([
      [30, 5, 7],
      [30, 35, 42]
    ])
  })

  it('table: calc column and its total cell', () => {
    const json = visualJson('t', 'tableEx', { Values: [region, total, vc] })
    const t = buildTableModel(json, ctx)
    expect(t.error).toBeUndefined()
    expect(t.rows.map((r) => r.map((c) => c.value))).toEqual([
      ['A', 30, 30],
      ['B', 5, 35],
      ['C', 7, 42]
    ])
    expect(t.total?.[2].value).toBe(42)
  })
})
