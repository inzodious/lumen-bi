/** KPI measures expose _<m> Goal / Status / Trend like Analysis Services. */
import { describe, expect, it } from 'vitest'
import { build } from '../../dax/tabular/__tests__/build'
import { createEngine } from '../engine'

describe('KPI hidden measures', () => {
  it('resolve and evaluate (status references the goal measure)', () => {
    const { model, data } = build({
      tables: { Sales: { columns: { Amount: 'double' }, rows: [[60], [40]], measures: { Revenue: { expression: 'SUM ( Sales[Amount] )', formatString: '#,0' } } } }
    })
    const m = model.tables[0].measures[0]
    m.kpi = {
      targetExpression: '120',
      statusExpression: "VAR r = DIVIDE ( [Revenue], [_Revenue Goal] ) RETURN IF ( r < 0.9, -1, IF ( r < 1, 0, 1 ) )",
      trendExpression: '1',
      statusGraphic: 'Traffic Light - Single',
      trendGraphic: 'Standard Arrow'
    }
    const e = createEngine(model, data)
    e.processCalculated()
    expect(e.evaluateScalar('[_Revenue Goal]').value).toBe(120)
    expect(e.evaluateScalar('[_Revenue Status]').value).toBe(-1)
    expect(e.evaluateScalar('[_Revenue Trend]').value).toBe(1)
    const sq = { Measure: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: '_Revenue Status' } }
    expect(e.describeField(sq)?.kpi).toEqual({ measure: 'Revenue', part: 'status', statusGraphic: 'Traffic Light - Single' })
    expect(e.summarize({ groupBy: [], values: [{ id: 's', expr: { kind: 'sq', expr: sq } }] }).rows).toEqual([[-1]])
    const trend = { Measure: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: '_Revenue Trend' } }
    expect(e.describeField(trend)?.kpi).toEqual({ measure: 'Revenue', part: 'trend', trendGraphic: 'Standard Arrow' })
  })
})

describe('KPI trend graphic in TMDL', () => {
  it('reads and writes trendGraphic', async () => {
    const { readTmdlFiles, writeTmdlFiles } = await import('../../tmdl')
    const tmdl = readTmdlFiles({
      'definition/model.tmdl': 'model Model\n\tculture: en-US\n',
      'definition/tables/Sales.tmdl':
        "table Sales\n\n\tmeasure Revenue = SUM(Sales[Amount])\n\n\t\tkpi\n\t\t\ttargetExpression = 120\n\t\t\ttrendExpression = 1\n\t\t\ttrendGraphic: Status Arrow - Ascending\n\n\tcolumn Amount\n\t\tdataType: double\n\t\tsourceColumn: Amount\n"
    })
    const kpi = tmdl.model.tables[0].measures[0].kpi
    expect(kpi?.trendGraphic).toBe('Status Arrow - Ascending')
    const files = writeTmdlFiles(tmdl.model)
    const text = Object.entries(files.files).find(([k]) => k.endsWith('Sales.tmdl'))![1]
    expect(text).toMatch(/trendGraphic: Status Arrow - Ascending/)
  })
})
