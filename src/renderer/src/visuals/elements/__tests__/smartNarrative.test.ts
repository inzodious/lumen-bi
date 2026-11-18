/**
 * Smart narrative text boxes (Power BI's PBIR shape: template switches + Transform subqueries) evaluated end to
 * end with the DAX engine over the gallery sample model: the numbers must equal what engine.summarize returns.
 */
import { describe, expect, it } from 'vitest'
import { createEngine } from '@core/engine/engine'
import { columnExpr, measureExpr } from '@core/report/sq'
import type { SQFilter } from '@core/report/sq'
import { createMockHost } from '../../common/mockHost'
import { buildSampleModel } from '../../gallery/sampleData'
import { buildParagraphs } from '../textboxModel'
import { makeResolver, resolveRuns, NARRATIVE_UNSUPPORTED } from '../Textbox'
import { evaluateTransform, valueDefs } from '../narrativeQuery'
import { smartNarrativeVisualJson } from '../smartNarrative'

const { model, data } = buildSampleModel()
const engine = createEngine(model, data)
engine.processCalculated()

function render(json: any, filters: SQFilter[] = []): string[] {
  const ctx = createMockHost({ engine, filters })
  const resolve = makeResolver(json, ctx)
  return buildParagraphs(json.visual.objects.general[0].properties.paragraphs)
    .map((p) =>
      resolveRuns(p.runs, resolve)
        .map((r) => r.text)
        .join('')
    )
    .filter((_, i) => i % 2 === 0) // odd paragraphs are the blank separators
}

function totals(column: string, measure = 'Total Sales', filters: SQFilter[] = []): Array<[string, number]> {
  return engine.summarize({ groupBy: [{ table: 'Sales', column }], values: [{ id: 'v', expr: { kind: 'sq', expr: measureExpr('Sales', measure) } }], filters, orderBy: [{ target: { group: 0 }, direction: 'asc' }] }).rows as Array<[string, number]>
}

const usd = (v: number) => '$' + Math.round(v).toLocaleString('en-US')
const pct2 = (x: number) => (x * 100).toFixed(2) + '%'

describe('smart narrative text box (Transform subqueries)', () => {
  const json = smartNarrativeVisualJson('sn', { category: columnExpr('Sales', 'Region'), categoryName: 'Region', measures: [measureExpr('Sales', 'Total Sales')], measureNames: ['Total Sales'], formatStrings: ['\\$#,0'] })

  it('is written in Power BI shape', () => {
    const defs = valueDefs(json)
    expect([...defs.keys()]).toContain('TemplateIdColumnRole (1)')
    const v1: any = defs.get('V1')?.expr
    expect(v1.Aggregation.Function).toBe(3)
    const q = v1.Aggregation.Expression.Column.Expression.Subquery.Query
    expect(q.Transform[0].Algorithm).toBe('HighPointLowPointSummary')
    expect(q.Transform[0].Input.Table.Columns.map((c: any) => c.Role)).toEqual(['PrimarySeriesColumnRole', 'PrimaryValueColumnRole'])
    expect(q.From).toEqual([{ Name: 's', Entity: 'Sales', Type: 0 }])
  })

  it('HighPointLowPoint, Aggregate and KPI summaries with real numbers', () => {
    const rows = totals('Region')
    const byValue = [...rows].sort((a, b) => b[1] - a[1])
    const hi = byValue[0]
    const lo = byValue[byValue.length - 1]
    const [p0, p1, p2] = render(json)
    expect(p0).toBe(`At ${usd(hi[1])}, ${hi[0]} had the highest Total Sales and was ${pct2((hi[1] - lo[1]) / lo[1])} higher than ${lo[0]}, which had the lowest Total Sales at ${usd(lo[1])}.`)
    expect(rows.length).toBe(4)
    expect(p1).toBe(`${byValue[0][0]} had the highest Total Sales at ${usd(byValue[0][1])}, followed by ${byValue[1][0]}, ${byValue[2][0]}, and ${byValue[3][0]}.`)
    const vals = rows.map((r) => r[1])
    expect(p2).toBe(`Across all 4 Region, Total Sales ranged from ${usd(Math.min(...vals))} to ${usd(Math.max(...vals))}.`)
  })

  it('follows the filter context (one region left → "All Region had …")', () => {
    const filter: SQFilter = {
      Version: 2,
      From: [{ Name: 's', Entity: 'Sales', Type: 0 }],
      Where: [{ Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 's' } }, Property: 'Region' } }], Values: [[{ Literal: { Value: "'Europe'" } }]] } } }]
    } as any
    const [eu] = totals('Region', 'Total Sales', [filter]).filter((r) => r[0] === 'Europe')
    const [p0, p1, p2] = render(json, [filter])
    expect(p0).toBe('') // no high/low with a single category: default case (empty)
    expect(p1).toBe(`All Region had Total Sales of ${usd(eu[1])}.`)
    expect(p2).toBe(`Europe had ${usd(eu[1])} Total Sales.`)
  })

  it('KPI summary over two measures by channel; categories keep their sort order', () => {
    const j = smartNarrativeVisualJson('sn2', {
      category: columnExpr('Sales', 'Channel'),
      categoryName: 'Channel',
      measures: [measureExpr('Sales', 'Total Sales'), measureExpr('Sales', 'Orders')],
      measureNames: ['Total Sales', 'Orders'],
      formatStrings: ['\\$#,0', '#,0']
    })
    const sales = totals('Channel')
    const orders = totals('Channel', 'Orders')
    expect(sales.length).toBe(3)
    const kpi = render(j)[2]
    const expected = sales.map(([c, v], i) => `${c} had ${usd(v)} Total Sales and ${orders[i][1].toLocaleString('en-US')} Orders.`).join(' ')
    expect(kpi).toBe(expected)
  })

  it('evaluates each transform once per render and keeps unknown algorithms as a note', () => {
    const q: any = (valueDefs(json).get('V1')?.expr as any).Aggregation.Expression.Column.Expression.Subquery.Query
    const ev = evaluateTransform(createMockHost({ engine }), q)
    expect('result' in ev && ev.result.templateId).toBe(10001)
    let calls = 0
    const counting = { ...engine, summarize: (r: any) => (calls++, engine.summarize(r)) }
    const ctx = createMockHost({ engine: counting as any })
    const resolve = makeResolver(json, ctx)
    for (const p of buildParagraphs(json.visual.objects.general[0].properties.paragraphs)) resolveRuns(p.runs, resolve)
    expect(calls).toBe(3)
    const odd = JSON.parse(JSON.stringify(json).replace(/"AggregateSummary"/g, '"ClusterSummary"'))
    expect(render(odd)[1]).toBe(NARRATIVE_UNSUPPORTED)
    // dynamic runs are flagged (underlined while editing)
    const runs = resolveRuns(buildParagraphs(json.visual.objects.general[0].properties.paragraphs)[0].runs, makeResolver(json, createMockHost({ engine })))
    expect(runs.filter((r) => r.dynamic).length).toBe(5)
  })

  it('reads the ExprContext value shape some PBIX layouts use', () => {
    const e = { Measure: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: 'Total Sales' } }
    const defs = valueDefs({ visual: { objects: { values: [{ selector: { id: 'A' }, properties: { expr: { propertyDefinitionKind: 'ExprContext', value: { expr: e } } } }] } } })
    expect(defs.get('A')?.expr).toEqual(e)
  })
})
