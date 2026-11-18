/** Calculated objects keep stored (file) values until their definition or inputs change, like Power BI. */
import { describe, expect, it } from 'vitest'
import { build } from '../../dax/tabular/__tests__/build'
import { createEngine } from '../engine'

const now = () => new Date(2026, 0, 15)

function project() {
  const { model, data } = build({
    tables: {
      Sales: {
        columns: { Day: 'int64', Amount: 'double', Age: { type: 'int64', expression: 'Sales[Day] + DAY ( TODAY () )' }, Twice: { type: 'double', expression: 'Sales[Amount] * 2' } },
        rows: [
          [1, 10],
          [2, 20]
        ]
      },
      Cluster: { columns: { Value: 'int64' }, expression: 'KMEANSCLUSTERING ( Sales, 2 )' }
    }
  })
  // values "stored in the file" (computed on another day by Power BI)
  const td = data.tables.get('Sales')!
  td.columns.push({ name: 'Age', type: 'int64', values: [101, 102] }, { name: 'Twice', type: 'double', values: [20, 40] })
  data.tables.set('Cluster', { rowCount: 2, columns: [{ name: 'Value', type: 'int64', values: [1, 2] }] })
  data.status.set('Sales', { state: 'loaded', source: 'pbix', rowCount: 2 })
  return { model, data }
}

const col = (e: ReturnType<typeof createEngine>, q: string) => e.runDaxQuery(`EVALUATE ${q}`).tables[0].rows.map((r) => r[0])

describe('stored calculated objects', () => {
  it('are not recomputed on open', () => {
    const { model, data } = project()
    const e = createEngine(model, data, { now })
    expect(e.processCalculated()).toEqual([])
    expect(col(e, 'SELECTCOLUMNS ( Sales, "a", Sales[Age] )')).toEqual([101, 102])
    expect(col(e, 'SELECTCOLUMNS ( Cluster, "v", Cluster[Value] )')).toEqual([1, 2])
  })
  it('are recomputed after an edit of the object (and only that object)', () => {
    const { model, data } = project()
    const e = createEngine(model, data, { now })
    e.processCalculated()
    model.tables[0].columns.find((c) => c.name === 'Twice')!.expression = 'Sales[Amount] * 3'
    e.invalidate()
    e.processCalculated()
    expect(col(e, 'SELECTCOLUMNS ( Sales, "t", Sales[Twice] )')).toEqual([30, 60])
    expect(col(e, 'SELECTCOLUMNS ( Sales, "a", Sales[Age] )')).toEqual([101, 102])
  })
  it('are recomputed after their input data changes (refresh); unsupported ones keep stored values with a notice', () => {
    const { model, data } = project()
    createEngine(model, data, { now }).processCalculated()
    const old = data.tables.get('Sales')!
    data.tables.set('Sales', { rowCount: 2, columns: old.columns.slice(0, 2) })
    const e = createEngine(model, data, { now })
    const issues = e.processCalculated()
    expect(col(e, 'SELECTCOLUMNS ( Sales, "a", Sales[Age] )')).toEqual([16, 17])
    expect(col(e, 'SELECTCOLUMNS ( Sales, "t", Sales[Twice] )')).toEqual([20, 40])
    expect(issues.length).toBe(1)
    expect(issues[0].error).toMatch(/KMEANSCLUSTERING.*stored in the file are kept/)
    expect(col(e, 'SELECTCOLUMNS ( Cluster, "v", Cluster[Value] )')).toEqual([1, 2])
  })
})
