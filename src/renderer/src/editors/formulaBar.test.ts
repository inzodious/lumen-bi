import { describe, expect, it } from 'vitest'
import { emptyReport } from '@core/report/types'
import { useApp } from '../state/store'
import { createDevProject } from '../views/dev/devProject'
import { commitFormula, definitionText, formulaTarget } from './FormulaBar'

function load() {
  const p = createDevProject()
  p.report = emptyReport()
  p.report.pages[0].visuals.push({ name: 'v', json: { visual: { visualType: 'card', query: { queryState: { Values: { projections: [{ field: { Measure: { Expression: { SourceRef: { Entity: 'Measures' } }, Property: 'Total Sales' } }, queryRef: 'Measures.Total Sales', nativeQueryRef: 'Total Sales' }] } } } } } })
  useApp.getState().setProject(p)
  return p
}

describe('formula bar commit', () => {
  it('shows Name = expression and commits rename + expression (references updated in model and report)', () => {
    load()
    const model = useApp.getState().project!.model
    const t = formulaTarget(model, { kind: 'measure', table: 'Measures', name: 'Total Sales' })!
    expect(definitionText(t)).toBe('Total Sales = SUM ( Sales[Line Total] )')
    expect(commitFormula(t, 'Revenue = SUM ( Sales[Line Total] ) * 1')).toBeNull()
    const s = useApp.getState()
    const ms = s.project!.model.tables.find((x) => x.name === 'Measures')!.measures
    expect(ms.find((m) => m.name === 'Revenue')!.expression).toBe('SUM ( Sales[Line Total] ) * 1')
    expect(ms.find((m) => m.name === 'Avg Order Value')!.expression).toBe('DIVIDE ( [Revenue], [Orders] )')
    expect(s.project!.report!.pages[0].visuals[0].json.visual.query.queryState.Values.projections[0]).toMatchObject({ queryRef: 'Measures.Revenue', nativeQueryRef: 'Revenue' })
    expect(s.selectedField).toEqual({ kind: 'measure', table: 'Measures', name: 'Revenue' })
    // undo restores both
    s.undo()
    s.undo()
    expect(useApp.getState().project!.model.tables.find((x) => x.name === 'Measures')!.measures.some((m) => m.name === 'Total Sales')).toBe(true)
  })
  it('rejects duplicate names and malformed text', () => {
    load()
    const model = useApp.getState().project!.model
    const t = formulaTarget(model, { kind: 'measure', table: 'Measures', name: 'Orders' })!
    expect(commitFormula(t, 'Total Sales = 1')).toMatch(/already used/)
    expect(commitFormula(t, 'SUM(1)')).toMatch(/syntax/)
  })
  it('targets calculated columns and calculated tables only', () => {
    const p = load()
    expect(formulaTarget(p.model, { kind: 'column', table: 'Sales', name: 'Quantity' })).toBeNull()
    expect(formulaTarget(p.model, { kind: 'column', table: 'Sales', name: 'Line Total' })?.kind).toBe('calculatedColumn')
    expect(formulaTarget(p.model, { kind: 'table', table: 'Measures' })?.kind).toBe('calculatedTable')
    expect(formulaTarget(p.model, { kind: 'table', table: 'Sales' })).toBeNull()
  })
})
