/**
 * Matrix row nodes: a group whose own subtotal is blank is still listed when its detail rows have values, and
 * "Show items with no data" on the Rows lists every group, values or not.
 */
import { describe, expect, it } from 'vitest'
import { build } from '@core/dax/tabular/__tests__/build'
import { createEngine } from '@core/engine/engine'
import { columnExpr, measureExpr } from '@core/report/sq'
import { createMockHost } from '../common/mockHost'
import { proj } from '../common/sampleData'
import { buildMatrixView } from './matrixView'

function engine() {
  const rows: Array<[string, string, number, number | null, string]> = [
    ['Beta', 'b-two', 2, 20, 'Q2'],
    ['Beta', 'b-one', 1, 10, 'Q1'],
    ['Alpha', 'a-two', 4, null, 'Q1'],
    ['Alpha', 'a-one', 3, 30, 'Q2'],
    ['Gamma', 'g-one', 5, null, 'Q3']
  ]
  const { model, data } = build({
    tables: {
      P: {
        columns: { Section: 'string', Item: 'string', Ord: 'int64', V: 'int64', Q: 'string' },
        rows,
        // blank above the detail level, like a per-row metric
        measures: { Detail: 'IF ( HASONEVALUE ( P[Item] ), SUM ( P[V] ) )' }
      }
    }
  })
  const e = createEngine(model, data)
  e.processCalculated()
  return e
}

function matrix(showAll = false, columns = false) {
  return {
    name: 'mx',
    visual: {
      visualType: 'pivotTable',
      query: {
        queryState: {
          Rows: { projections: [proj(columnExpr('P', 'Section'), 'P.Section', { active: true }), proj(columnExpr('P', 'Item'), 'P.Item', { active: true })], ...(showAll ? { showAll: true } : {}) },
          ...(columns ? { Columns: { projections: [proj(columnExpr('P', 'Q'), 'P.Q', { active: true })] } } : {}),
          Values: { projections: [proj(measureExpr('P', 'Detail'), 'P.Detail')] }
        }
      }
    }
  }
}

const labels = (v: ReturnType<typeof buildMatrixView>) => v.layout.items.filter((i) => i.kind === 'node').map((i) => `${'  '.repeat(i.level)}${String(i.label)}`)

describe('matrix row nodes', () => {
  const e = engine()

  it('lists a group whose subtotal is blank when its detail rows have values, in group order', () => {
    const v = buildMatrixView(matrix(), createMockHost({ engine: e }))
    expect(v.error).toBeUndefined()
    // Gamma has no detail value: not shown; Alpha's blank item is not shown either
    expect(labels(v)).toEqual(['Alpha', '  a-one', 'Beta', '  b-one', '  b-two'])
    const alpha = v.layout.items.find((i) => i.kind === 'node' && i.label === 'Alpha')!
    expect(alpha.node?.expanded).toBe(true)
    expect(v.layout.lookup(['Alpha'], [])?.values[0] ?? null).toBeNull()
    expect(v.layout.lookup(['Alpha', 'a-one'], [])?.values[0]).toBe(30)
  })

  it('"Show items with no data" on the rows lists every group and item', () => {
    const v = buildMatrixView(matrix(true), createMockHost({ engine: e }))
    expect(labels(v)).toEqual(['Alpha', '  a-one', '  a-two', 'Beta', '  b-one', '  b-two', 'Gamma', '  g-one'])
    expect(v.layout.lookup(['Gamma', 'g-one'], [])?.values[0] ?? null).toBeNull()
  })

  it('lists a column group whose total is blank when it has values in some row', () => {
    const v = buildMatrixView(matrix(false, true), createMockHost({ engine: e }))
    expect(v.error).toBeUndefined()
    // Q3 only holds a blank detail value: no column; Q1 / Q2 in order, then the total
    expect(v.layout.leaves.filter((l) => !l.isTotal).map((l) => l.path[0])).toEqual(['Q1', 'Q2'])
    expect(v.layout.lookup(['Beta', 'b-one'], ['Q1'])?.values[0]).toBe(10)
    expect(v.layout.lookup(['Alpha', 'a-one'], ['Q2'])?.values[0]).toBe(30)
  })
})
