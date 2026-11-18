import type { SummarizeRequest } from '@core/engine/api'
import type { VisualHostContext } from '../../contract'
import { buildParagraphs, caseRuns } from '../textboxModel'
import { aggregateValues, evaluateDynamicValue, runSQQuery, valueDefs, valueRefOf } from '../narrativeQuery'
import { NARRATIVE_UNSUPPORTED, resolveRuns } from '../Textbox'

const ref = (id: string) => ({ propertyIdentifier: { objectName: 'values', propertyName: 'expr' }, selector: { id } })
const col = (src: string, p: string) => ({ Column: { Expression: { SourceRef: { Source: src } }, Property: p } })
const meas = (src: string, p: string) => ({ Measure: { Expression: { SourceRef: { Source: src } }, Property: p } })

/** Q&A "Region with highest total" as PBI writes it: Min over a column of a TopN-filtered subquery. */
const topRegion = {
  Aggregation: {
    Function: 3,
    Expression: {
      Column: {
        Property: 'Sales.Region',
        Expression: {
          Subquery: {
            Query: {
              Version: 2,
              From: [
                { Name: 's', Entity: 'Sales', Type: 0 },
                { Name: 'subquery', Type: 2, Expression: { Subquery: { Query: { Version: 2, From: [{ Name: 'ss', Entity: 'Sales', Type: 0 }], Select: [{ ...col('ss', 'Region'), Name: 'r' }], OrderBy: [{ Direction: 2, Expression: meas('ss', 'Total') }], Top: 1 } } } }
              ],
              Select: [{ ...col('s', 'Region'), Name: 'Sales.Region' }],
              Where: [{ Condition: { In: { Expressions: [col('s', 'Region')], Table: { SourceRef: { Source: 'subquery' } } } } }],
              OrderBy: [{ Direction: 2, Expression: meas('s', 'Total') }]
            }
          }
        }
      }
    }
  }
}

function fakeCtx(rows: any[][], seen: SummarizeRequest[] = []): VisualHostContext {
  return {
    filters: [{ Version: 2, Where: [] }],
    format: (v: any) => `<${v}>`,
    engine: {
      summarize(req: SummarizeRequest) {
        seen.push(req)
        return { columns: [{ id: 'Sales.Region', kind: 'group', dataType: 'string', name: 'Region' }], rows }
      }
    }
  } as any
}

describe('text box dynamic values (Q&A "+ Value")', () => {
  it('parses value references, smart-narrative switches and __Newline__', () => {
    const [p] = buildParagraphs([
      {
        textRuns: [
          { value: ref('Value') },
          { value: ' had the highest total' },
          { cases: [{ pattern: { expr: { Literal: { Value: '10001L' } } }, textRuns: [{ value: 'A ' }, { value: ref('V1') }] }], defaultCase: { textRuns: [{ value: '__Newline__' }] }, expression: ref('TemplateIdColumnRole') }
        ]
      }
    ])
    expect(p.runs[0].valueRef).toBe('Value')
    expect(p.runs[0].text).toBe('')
    expect(p.runs[1].text).toBe(' had the highest total')
    const sw = p.runs[2]
    expect(sw.cases?.on).toBe('TemplateIdColumnRole')
    expect(caseRuns(sw, 10001).map((r) => r.text || r.valueRef)).toEqual(['A ', 'V1'])
    expect(caseRuns(sw, 5).map((r) => r.text)).toEqual(['\n'])
    expect(valueRefOf(ref('X'))).toEqual({ id: 'X' })
  })

  it('reads objects.values with format strings', () => {
    const defs = valueDefs({ visual: { objects: { values: [{ selector: { id: 'V' }, properties: { expr: { expr: topRegion }, formatString: { expr: { Literal: { Value: "'0.0%'" } } } } }] } } })
    expect(defs.get('V')?.formatString).toBe('0.0%')
    expect(defs.get('V')?.expr).toBe(topRegion)
  })

  it('runs the subquery through summarize (TopN Where kept as a filter) and aggregates the column', () => {
    const seen: SummarizeRequest[] = []
    const ctx = fakeCtx([['Europe']], seen)
    const r = evaluateDynamicValue(ctx, { expr: topRegion })
    expect(r).toEqual({ value: 'Europe', formatted: '<Europe>' })
    const req = seen[0]
    expect(req.groupBy).toEqual([{ kind: 'sq', expr: { Column: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: 'Region' } } }])
    // ORDER BY a measure that isn't selected → hidden value
    expect(req.values.map((v) => v.id)).toEqual(['o0'])
    expect(req.orderBy).toEqual([{ target: { value: 'o0' }, direction: 'desc' }])
    expect(req.filters).toHaveLength(2)
    expect((req.filters![1] as any).From).toHaveLength(2)
  })

  it('runSQQuery honours Top and sorts on selected columns', () => {
    const seen: SummarizeRequest[] = []
    const q = { Version: 2, From: [{ Name: 's', Entity: 'Sales', Type: 0 }], Select: [{ ...col('s', 'Region'), Name: 'r' }, { ...meas('s', 'Total'), Name: 't' }], OrderBy: [{ Direction: 1, Expression: col('s', 'Region') }], Top: 3 }
    const out = runSQQuery(fakeCtx([['A', 1]], seen), q)
    expect(out.names).toEqual(['r', 't'])
    expect(seen[0].limit).toBe(3)
    expect(seen[0].orderBy).toEqual([{ target: { group: 0 }, direction: 'asc' }])
    expect(seen[0].filters).toHaveLength(1) // no Where → only the visual's filters
  })

  it('reports unknown smart narrative algorithms as unsupported instead of guessing', () => {
    const transform = (algo: string) => ({ Aggregation: { Function: 3, Expression: { Column: { Property: 'V1', Expression: { Subquery: { Query: { Transform: [{ Algorithm: algo }] } } } } } } })
    expect(evaluateDynamicValue(fakeCtx([]), { expr: transform('ClusterSummary') })).toEqual({ unsupported: 'smart narrative summary (ClusterSummary)' })
    // a known algorithm without an input table can't be evaluated either
    expect('unsupported' in evaluateDynamicValue(fakeCtx([]), { expr: transform('HighPointLowPointSummary') })).toBe(true)
  })

  it('aggregates like SQ QueryAggregateFunction', () => {
    expect(aggregateValues(0, [1, 2, null])).toBe(3)
    expect(aggregateValues(1, [1, 2])).toBe(1.5)
    expect(aggregateValues(2, ['a', 'a', 'b'])).toBe(2)
    expect(aggregateValues(3, ['b', 'a'])).toBe('a')
    expect(aggregateValues(4, [3, 9, 2])).toBe(9)
    expect(aggregateValues(5, [1, null, 2])).toBe(2)
    expect(aggregateValues(6, [1, 3, 10, 20])).toBe(6.5)
    expect(aggregateValues(3, [])).toBeNull()
  })

  it('resolves runs: values formatted, unknown narratives replaced by one note, BOM padding dropped', () => {
    const [p] = buildParagraphs([
      {
        textRuns: [
          { cases: [{ pattern: { expr: { Literal: { Value: '1L' } } }, textRuns: [{ value: 'x' }] }], defaultCase: { textRuns: [] }, expression: ref('T') },
          { cases: [], defaultCase: { textRuns: [] }, expression: ref('T') },
          { value: ref('Value') },
          { value: '﻿﻿' }
        ]
      }
    ])
    const out = resolveRuns(p.runs, (r) => (r.valueRef === 'T' ? { unsupported: 'smart narrative summary' } : r.valueRef === 'Value' ? { value: 1, formatted: '1.0' } : undefined))
    expect(out.map((r) => r.text)).toEqual([NARRATIVE_UNSUPPORTED, '1.0', ''])
    const ok = resolveRuns(p.runs.slice(0, 1), (r) => (r.valueRef ? { value: 1, formatted: '1' } : undefined))
    expect(ok.map((r) => r.text)).toEqual(['x'])
  })
})
