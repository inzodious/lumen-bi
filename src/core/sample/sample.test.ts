import { describe, expect, it } from 'vitest'
import { createEngine } from '../engine/engine'
import type { QueryEngine } from '../engine/api'
import { emptyModel } from '../model/types'
import { emptyDataStore } from '../model/data'
import { parseSampleDataset, sampleDatasetModel, serializeSampleDataset, type SampleDataset } from './dataset'
import { genericSampleDataset, genericSampleQuery } from './generic'
import { addDefaultMeasureTables, defaultMeasureHome } from './measureTables'
import {
  referencedEntities,
  reportSampleDataOn,
  setReportSampleData,
  setVisualSampleOff,
  setVisualSampleSpec,
  splitFieldObjects,
  visualHasFields,
  visualSampleSpec,
  withSampleQuery
} from './spec'

/** Run a sample query the way a visual does: group by its columns, compute its measures. */
function runSampleQuery(engine: QueryEngine, query: any) {
  const groupBy: any[] = []
  const values: any[] = []
  for (const role of Object.values<any>(query.queryState))
    for (const p of role.projections) {
      if (p.field.Measure) values.push({ id: p.queryRef, expr: { kind: 'sq', expr: p.field } })
      else groupBy.push({ kind: 'sq', expr: p.field })
    }
  return engine.summarize({ groupBy, values })
}

describe('sample spec annotations', () => {
  it('report switch: absent is off, on/off round-trips', () => {
    const r: any = {}
    expect(reportSampleDataOn(r)).toBe(false)
    setReportSampleData(r, true)
    expect(r.annotations).toEqual([{ name: 'Lumen_SampleData', value: 'on' }])
    expect(reportSampleDataOn(r)).toBe(true)
    setReportSampleData(r, false)
    expect(reportSampleDataOn(r)).toBe(false)
  })

  it('visual spec: stored as JSON next to other annotations; off keeps the query', () => {
    const v: any = { annotations: [{ name: 'Lumen_Style', value: '{}' }], visual: { visualType: 'donutChart' } }
    const query = { queryState: { Category: { projections: [{ field: { Column: { Expression: { SourceRef: { Entity: 'T' } }, Property: 'C' } }, queryRef: 'T.C' }] } } }
    setVisualSampleSpec(v, { query })
    expect(v.annotations).toHaveLength(2)
    expect(visualSampleSpec(v)).toEqual({ query })
    setVisualSampleOff(v, true)
    expect(visualSampleSpec(v)).toEqual({ query, off: true })
    setVisualSampleOff(v, false)
    expect(visualSampleSpec(v)).toEqual({ query })
    setVisualSampleSpec(v, undefined)
    expect(v.annotations).toEqual([{ name: 'Lumen_Style', value: '{}' }])
  })

  it('ignores a malformed spec', () => {
    expect(visualSampleSpec({ annotations: [{ name: 'Lumen_SampleData', value: 'not json' }] })).toBeUndefined()
    expect(visualSampleSpec({ annotations: [{ name: 'Lumen_SampleData', value: '{"query":{"x":1}}' }] })).toEqual({})
  })

  it('fields: a visual has fields only when a role has a projection', () => {
    expect(visualHasFields({ visual: {} })).toBe(false)
    expect(visualHasFields({ visual: { query: { queryState: { Y: { projections: [] } } } } })).toBe(false)
    expect(visualHasFields({ visual: { query: { queryState: { Y: { projections: [{}] } } } } })).toBe(true)
  })

  it('withSampleQuery adds the sample formatting after the visual’s own and leaves the input untouched', () => {
    const own = { dataPoint: [{ properties: { a: 1 } }], legend: [{ properties: { show: true } }] }
    const v = { name: 'v', visual: { visualType: 'donutChart', objects: own } }
    const out = withSampleQuery(v, { queryState: {} }, { dataPoint: [{ properties: { b: 2 }, selector: { data: [] } }] })
    expect(out.visual.objects.dataPoint).toHaveLength(2)
    expect(out.visual.objects.legend).toBe(own.legend)
    expect(v.visual.objects.dataPoint).toHaveLength(1)
    expect((v.visual as any).query).toBeUndefined()
  })

  it('splitFieldObjects keeps selectors and field expressions apart from plain formatting', () => {
    const { plain, fieldBound } = splitFieldObjects({
      dataPoint: [{ properties: { x: 1 } }, { properties: { fill: 1 }, selector: { data: [{}] } }, { properties: { fill: 2 }, selector: { metadata: 'T.M' } }],
      title: [{ properties: { text: { expr: { Measure: { Expression: { SourceRef: { Entity: 'T' } }, Property: 'M' } } } } }]
    })
    expect(plain).toEqual({ dataPoint: [{ properties: { x: 1 } }] })
    expect(fieldBound?.dataPoint).toHaveLength(2)
    expect(fieldBound?.title).toHaveLength(1)
    expect([...referencedEntities(fieldBound?.title)]).toEqual(['T'])
  })
})

describe('sample dataset', () => {
  const ds: SampleDataset = {
    $lumen: 'sampleData',
    version: 1,
    tables: [
      { name: 'Facts', columns: [{ name: 'Month', type: 'string', sortBy: 'MonthNo' }, { name: 'MonthNo', type: 'int64', hidden: true }, { name: 'Day', type: 'dateTime' }, { name: 'Amount', type: 'double' }], rows: [['Feb', 2, '2025-02-01', 5], ['Jan', 1, '2025-01-01', 3], ['Jan', 1, '2025-01-15', 4]] },
      { name: 'Months', columns: [{ name: 'Month', type: 'string' }], rows: [['Jan'], ['Feb']] }
    ],
    measures: [
      { table: '_m', name: 'Total', expression: 'SUM(Facts[Amount])', format: '#,0' },
      { table: 'Facts', name: 'Rows', expression: 'COUNTROWS(Facts)' }
    ],
    relationships: [{ from: 'Facts.Month', to: 'Months.Month' }]
  }

  it('round-trips and rejects other files', () => {
    expect(parseSampleDataset(serializeSampleDataset(ds))).toEqual(ds)
    expect(parseSampleDataset('{"$lumen":"diagramLayout"}')).toBeUndefined()
    expect(parseSampleDataset('nope')).toBeUndefined()
    expect(parseSampleDataset(undefined)).toBeUndefined()
  })

  it('builds a model an engine can query: measures-only tables, sort-by columns, dates, relationships', () => {
    const { model, data } = sampleDatasetModel(ds)
    expect(model.tables.map((t) => t.name)).toEqual(['Facts', 'Months', '_m'])
    expect(data.tables.get('Facts')!.columns[2].values[0]).toEqual(new Date(Date.UTC(2025, 1, 1)))
    const engine = createEngine(model, data)
    expect(engine.evaluateScalar('[Total]').value).toBe(12)
    const total = { id: 't', expr: { kind: 'measure' as const, table: '_m', measure: 'Total' } }
    const bySort = engine.summarize({ groupBy: [{ table: 'Facts', column: 'Month' }], values: [total], orderBy: [{ target: { group: 0 }, direction: 'asc' }] })
    expect(bySort.rows.map((x) => [x[0], x[1]])).toEqual([
      ['Jan', 7],
      ['Feb', 5]
    ])
    const related = engine.summarize({ groupBy: [{ table: 'Months', column: 'Month' }], values: [total] })
    expect(related.rows.map((x) => [x[0], x[1]]).sort()).toEqual([
      ['Feb', 5],
      ['Jan', 7]
    ])
  })
})

describe('generic sample', () => {
  const { model, data } = sampleDatasetModel(genericSampleDataset())
  const engine = createEngine(model, data)

  it('is deterministic and every measure evaluates', () => {
    expect(genericSampleDataset()).toBe(genericSampleDataset())
    expect(JSON.stringify(genericSampleDataset(7).tables[0].rows.slice(0, 3))).toBe(JSON.stringify(genericSampleDataset(7).tables[0].rows.slice(0, 3)))
    for (const t of model.tables) for (const m of t.measures) expect(engine.evaluateScalar(`[${m.name}]`).value, m.name).not.toBeNull()
    const margin = engine.evaluateScalar('[Margin %]').value as number
    expect(margin).toBeGreaterThan(0.2)
    expect(margin).toBeLessThan(0.6)
  })

  const ROLES: Record<string, string[]> = {
    clusteredColumnChart: ['Category', 'Y', 'Series', 'Rows', 'Tooltips'],
    columnChart: ['Category', 'Y', 'Series', 'Rows', 'Tooltips'],
    hundredPercentStackedBarChart: ['Category', 'Y', 'Series', 'Rows', 'Tooltips'],
    clusteredBarChart: ['Category', 'Y', 'Series', 'Rows', 'Tooltips'],
    lineChart: ['Category', 'Y', 'Y2', 'Series', 'Rows', 'Tooltips'],
    stackedAreaChart: ['Category', 'Y', 'Series', 'Rows', 'Tooltips'],
    lineClusteredColumnComboChart: ['Category', 'Y', 'Y2', 'Series', 'Rows', 'Tooltips'],
    ribbonChart: ['Category', 'Series', 'Y', 'Rows', 'Tooltips'],
    pieChart: ['Category', 'Y', 'Series', 'Rows', 'Tooltips'],
    donutChart: ['Category', 'Y', 'Series', 'Rows', 'Tooltips'],
    funnel: ['Category', 'Y', 'Tooltips'],
    treemap: ['Group', 'Details', 'Values', 'Tooltips'],
    gauge: ['Y', 'MinValue', 'MaxValue', 'TargetValue', 'Tooltips'],
    kpi: ['Indicator', 'TrendLine', 'Goal'],
    waterfallChart: ['Category', 'Breakdown', 'Y', 'Tooltips'],
    scatterChart: ['Category', 'X', 'Y', 'Series', 'Size', 'Play', 'Tooltips'],
    filledMap: ['Category', 'Series', 'Y', 'X', 'Size', 'Tooltips'],
    map: ['Category', 'Series', 'Y', 'X', 'Size', 'Tooltips'],
    tableEx: ['Values'],
    pivotTable: ['Rows', 'Columns', 'Values'],
    cardVisual: ['Data', 'Rows'],
    card: ['Values'],
    multiRowCard: ['Values'],
    slicer: ['Values'],
    listSlicer: ['Field'],
    advancedSlicerVisual: ['Values', 'Data']
  }

  for (const [type, roles] of Object.entries(ROLES)) {
    it(`${type}: a query in the visual's roles that returns data`, () => {
      const q = genericSampleQuery(type, roles)
      expect(q, type).toBeDefined()
      for (const role of Object.keys(q.queryState)) expect(roles).toContain(role)
      for (const role of Object.values<any>(q.queryState)) for (const p of role.projections) expect(engine.describeField(p.field), p.queryRef).toBeDefined()
      const r = runSampleQuery(engine, q)
      expect(r.rows.length).toBeGreaterThan(0)
    })
  }

  it('no sample for visuals that take no data or are not drawn from fields', () => {
    expect(genericSampleQuery('textbox', [])).toBeUndefined()
    expect(genericSampleQuery('decompositionTreeVisual', ['Analyze', 'ExplainBy'])).toBeUndefined()
    expect(genericSampleQuery('deneb7E15AEF80B9E4D4F8E12924291ECE89A', ['dataset'])).toBeUndefined()
  })

  const fields = (q: any) => Object.fromEntries(Object.entries<any>(q.queryState).map(([role, r]) => [role, r.projections.map((p: any) => p.queryRef)]))

  it('the title picks the dimension and the measure', () => {
    expect(fields(genericSampleQuery('clusteredColumnChart', ROLES.clusteredColumnChart, 'Profit by region'))).toEqual({ Category: ['Sales.Region'], Y: ['Sales.Profit'] })
    expect(fields(genericSampleQuery('lineChart', ROLES.lineChart, 'Orders over time'))).toEqual({ Category: ['Sales.Month'], Y: ['Sales.Orders'] })
    expect(fields(genericSampleQuery('lineChart', ROLES.lineChart, 'Revenue trend by channel'))).toEqual({ Category: ['Sales.Month'], Y: ['Sales.Sales'], Series: ['Sales.Channel'] })
    expect(fields(genericSampleQuery('cardVisual', ROLES.cardVisual, 'Gross margin'))).toEqual({ Data: ['Sales.Margin %'] })
    expect(fields(genericSampleQuery('clusteredBarChart', ROLES.clusteredBarChart, 'Sales pipeline'))).toEqual({ Category: ['Pipeline.Stage'], Y: ['Pipeline.Opportunities'] })
    expect(fields(genericSampleQuery('slicer', ROLES.slicer, 'Country'))).toEqual({ Values: ['Sales.Country'] })
  })

  it('without a title: what a Power BI author would most likely use for the type', () => {
    expect(fields(genericSampleQuery('clusteredColumnChart', ROLES.clusteredColumnChart))).toEqual({ Category: ['Sales.Category'], Y: ['Sales.Sales'] })
    expect(fields(genericSampleQuery('columnChart', ROLES.columnChart))).toEqual({ Category: ['Sales.Category'], Y: ['Sales.Sales'], Series: ['Sales.Channel'] })
    expect(fields(genericSampleQuery('lineChart', ROLES.lineChart))).toEqual({ Category: ['Sales.Month'], Y: ['Sales.Sales'] })
    expect(fields(genericSampleQuery('donutChart', ROLES.donutChart))).toEqual({ Category: ['Sales.Region'], Y: ['Sales.Sales'] })
    expect(fields(genericSampleQuery('waterfallChart', ROLES.waterfallChart))).toEqual({ Category: ['Sales.Month'], Y: ['Sales.Variance'] })
  })
})

describe('default measure tables', () => {
  it('adds _measures_kpi and _measures_format once, with their placeholder measures; new measures go to _measures_kpi', () => {
    const model = emptyModel('M')
    const data = emptyDataStore()
    addDefaultMeasureTables(model, data)
    addDefaultMeasureTables(model, data)
    expect(model.tables.map((t) => t.name)).toEqual(['_measures_kpi', '_measures_format'])
    expect(model.tables.map((t) => t.measures.map((m) => `${m.name} = ${m.expression}`))).toEqual([['kpi_blank = BLANK()'], ['fmt_blank = BLANK()']])
    expect(model.tables.every((t) => t.columns.every((c) => c.isHidden) && t.partitions[0].queryGroup === 'Measures')).toBe(true)
    expect(model.queryGroups?.map((g) => g.name)).toEqual(['Measures'])
    expect(data.tables.get('_measures_kpi')?.rowCount).toBe(0)
    expect(defaultMeasureHome(model)).toBe('_measures_kpi')
    expect(defaultMeasureHome(emptyModel())).toBeUndefined()
  })
})
