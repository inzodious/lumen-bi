/** Calculation groups: sideways recursion, ISSELECTEDMEASURE, multiple / no selection expressions. */
import { describe, expect, it } from 'vitest'
import { build } from '../../dax/tabular/__tests__/build'
import { createEngine } from '../engine'

function engine() {
  const { model, data } = build({
    tables: {
      Sales: { columns: { Amount: 'double', Qty: 'int64' }, rows: [[10, 1], [30, 2]], measures: { Amount: 'SUM ( Sales[Amount] )', Units: 'SUM ( Sales[Qty] )' } },
      CG: {
        columns: { Item: { type: 'string', sourceColumn: 'Name' }, Ordinal: { type: 'int64', sourceColumn: 'Ordinal' } },
        calculationGroup: {
          items: [
            { name: 'Double', expression: 'SELECTEDMEASURE () * 2' },
            { name: 'AmountOnly', expression: 'IF ( ISSELECTEDMEASURE ( [Amount] ), SELECTEDMEASURE () * 100, SELECTEDMEASURE () )' },
            { name: 'Sideways', expression: 'CALCULATE ( SELECTEDMEASURE (), CG[Item] = "Double" ) + 1' },
            { name: 'Name', expression: 'SELECTEDMEASURENAME ()' }
          ]
        }
      }
    }
  })
  const cg = model.tables.find((t) => t.name === 'CG')!.calculationGroup!
  cg.noSelectionExpression = 'SELECTEDMEASURE () + 1000'
  cg.multipleOrEmptySelectionExpression = '-1'
  const e = createEngine(model, data)
  e.processCalculated()
  return e
}
const item = (name: string | string[]) => ({
  Version: 2,
  From: [{ Name: 'c', Entity: 'CG', Type: 0 }],
  Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'c' } }, Property: 'Item' } }], Values: (Array.isArray(name) ? name : [name]).map((n) => [{ Literal: { Value: `'${n}'` } }]) } } }]
})

describe('calculation groups', () => {
  const e = engine()
  const v = (expr: string, f?: any[]) => e.evaluateScalar(expr, f).value
  it('no selection and multiple selection expressions', () => {
    expect(v('[Amount]')).toBe(1040)
    expect(v('[Amount]', [item(['Double', 'Name'])])).toBe(-1)
  })
  it('ISSELECTEDMEASURE / SELECTEDMEASURENAME', () => {
    expect(v('[Amount]', [item('AmountOnly')])).toBe(4000)
    expect(v('[Units]', [item('AmountOnly')])).toBe(3)
    expect(v('[Units]', [item('Name')])).toBe('Units')
  })
  it('sideways recursion applies the other item of the same group', () => {
    expect(v('[Amount]', [item('Sideways')])).toBe(81)
  })
  it('does not apply to non-measure expressions (implicit measures)', () => {
    expect(v('SUM ( Sales[Amount] )', [item('Double')])).toBe(40)
  })
})

describe('calculation groups: recursion', () => {
  const { model, data } = build({
    tables: {
      Sales: {
        columns: { Amount: 'double' },
        rows: [[10], [30]],
        measures: { Amount: 'SUM ( Sales[Amount] )', MA: 'CALCULATE ( [Amount], Loop[Item] = "Via A" )', MB: 'CALCULATE ( [Amount], Loop[Item] = "Via B" )' }
      },
      Loop: {
        columns: { Item: { type: 'string', sourceColumn: 'Name' }, Ordinal: { type: 'int64', sourceColumn: 'Ordinal' } },
        calculationGroup: {
          items: [
            { name: 'Self', expression: 'CALCULATE ( SELECTEDMEASURE (), Loop[Item] = "Self" ) + 1' },
            { name: 'Loop A', expression: 'CALCULATE ( SELECTEDMEASURE (), Loop[Item] = "Loop B" )' },
            { name: 'Loop B', expression: 'CALCULATE ( SELECTEDMEASURE (), Loop[Item] = "Loop A" )' },
            { name: 'Via A', expression: '[MB] + 1' },
            { name: 'Via B', expression: '[MA] + 2' },
            { name: 'Plus', expression: 'SELECTEDMEASURE () + 5' },
            { name: 'ToPlus', expression: 'CALCULATE ( SELECTEDMEASURE (), Loop[Item] = "Plus" ) * 10' }
          ]
        }
      }
    }
  })
  const e = createEngine(model, data)
  e.processCalculated()
  const sel = (n: string) => ({
    Version: 2,
    From: [{ Name: 'l', Entity: 'Loop', Type: 0 }],
    Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'l' } }, Property: 'Item' } }], Values: [[{ Literal: { Value: `'${n}'` } }]] } } }]
  })
  it('an item that selects itself again is a circular dependency (not silently skipped)', () => {
    expect(() => e.evaluateScalar('[Amount]', [sel('Self')])).toThrow(/circular dependency.*'Self'.*Self -> Self/i)
  })
  it('items that select each other (Loop A -> Loop B -> Loop A) are a circular dependency', () => {
    expect(() => e.evaluateScalar('[Amount]', [sel('Loop A')])).toThrow(/circular dependency.*Loop A -> Loop B -> Loop A/i)
  })
  it('a loop through measures ignores the second application of the same item', () => {
    // Via A on Amount = [MB] + 1; MB applies Via B on Amount = [MA] + 2; MA selects Via A again: ignored -> 40
    expect(e.evaluateScalar('[Amount]', [sel('Via A')]).value).toBe(43)
  })
  it('sideways recursion without a loop still works', () => {
    expect(e.evaluateScalar('[Amount]', [sel('ToPlus')]).value).toBe(450)
  })
})
