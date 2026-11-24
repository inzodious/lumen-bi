import { describe, expect, it } from 'vitest'
import { emptyDataStore, tableFromRows } from '../../model/data'
import { emptyModel, type SemanticModel } from '../../model/types'
import { emptyReport, type ReportDocument } from '../../report/types'
import { openWbi } from '../../io/open'
import type { ProjectDocument } from '../../project'
import { PUBLISH_BUNDLE, PUBLISH_MANIFEST, REMOVED_QUERY, buildPublishBundle, type PublishManifest } from '../bundle'
import { reportMotion, setReportMotion, setVisualMotion, visualMotion } from '../../report/motion'
import { bracketNames, columnUsage, isColumnKept, referencesWholeTable } from '../usage'

function model(): SemanticModel {
  const m = emptyModel()
  m.compatibilityLevel = 1600
  m.tables.push(
    {
      name: 'Sales',
      columns: [
        { name: 'ProductKey', dataType: 'int64', kind: 'data', sourceColumn: 'ProductKey' },
        { name: 'Amount', dataType: 'double', kind: 'data', sourceColumn: 'Amount' },
        { name: 'Cost', dataType: 'double', kind: 'data', sourceColumn: 'Cost' },
        { name: 'Notes', dataType: 'string', kind: 'data', sourceColumn: 'Notes' }
      ],
      measures: [{ name: 'Total Amount', expression: 'SUM(Sales[Amount])' }],
      hierarchies: [],
      partitions: [{ name: 'Sales', sourceType: 'm', mode: 'import', expression: 'let\n    Source = Sql.Database("server", "db")\nin\n    Source' }]
    },
    {
      name: 'Product',
      columns: [
        { name: 'ProductKey', dataType: 'int64', kind: 'data', sourceColumn: 'ProductKey' },
        { name: 'Name', dataType: 'string', kind: 'data', sourceColumn: 'Name', sortByColumn: 'SortOrder' },
        { name: 'SortOrder', dataType: 'int64', kind: 'data', sourceColumn: 'SortOrder' },
        { name: 'Supplier', dataType: 'string', kind: 'data', sourceColumn: 'Supplier' }
      ],
      measures: [],
      hierarchies: [],
      partitions: [{ name: 'Product', sourceType: 'm', mode: 'import', expression: 'let\n    Source = Sql.Database("server", "db")\nin\n    Source' }]
    },
    {
      name: 'Region',
      columns: [
        { name: 'Code', dataType: 'string', kind: 'data', sourceColumn: 'Code' },
        { name: 'Manager', dataType: 'string', kind: 'data', sourceColumn: 'Manager' }
      ],
      measures: [{ name: 'Regions', expression: 'COUNTROWS(DISTINCT(Region))' }],
      hierarchies: [],
      partitions: [{ name: 'Region', sourceType: 'm', mode: 'import', expression: 'let\n    Source = #table({}, {})\nin\n    Source' }]
    }
  )
  m.relationships.push({ name: 'r1', fromTable: 'Sales', fromColumn: 'ProductKey', toTable: 'Product', toColumn: 'ProductKey', fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection', isActive: true })
  m.expressions.push({ name: 'ServerName', kind: 'm', expression: '"sql.example.test" meta [IsParameterQuery=true]' })
  return m
}

function report(): ReportDocument {
  const r = emptyReport()
  r.pages[0].json.displayName = 'Overview'
  r.pages[0].visuals.push({
    name: 'v1',
    json: {
      name: 'v1',
      visual: {
        visualType: 'clusteredColumnChart',
        query: {
          queryState: {
            Category: { projections: [{ field: { Column: { Expression: { SourceRef: { Entity: 'Product' } }, Property: 'Name' } }, queryRef: 'Product.Name' }] },
            Y: { projections: [{ field: { Measure: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: 'Total Amount' } }, queryRef: 'Sales.Total Amount' }] }
          }
        }
      }
    }
  })
  r.pages.push({ name: 'tip', json: { name: 'tip', displayName: 'Tooltip', visibility: 'HiddenInViewMode' }, visuals: [] })
  r.pagesMeta.pageOrder.push('tip')
  return r
}

function project(): ProjectDocument {
  const data = emptyDataStore()
  data.tables.set('Sales', tableFromRows(['ProductKey', 'Amount', 'Cost', 'Notes'], ['int64', 'double', 'double', 'string'], [[1, 10, 4, 'private note'], [2, 20, 8, 'another']]))
  data.tables.set('Product', tableFromRows(['ProductKey', 'Name', 'SortOrder', 'Supplier'], ['int64', 'string', 'int64', 'string'], [[1, 'Bike', 2, 'Acme'], [2, 'Helmet', 1, 'Globex']]))
  data.tables.set('Region', tableFromRows(['Code', 'Manager'], ['string', 'string'], [['N', 'Ann'], ['S', 'Bo']]))
  for (const t of data.tables.keys()) data.status.set(t, { state: 'loaded', source: 'query', rowCount: 2 })
  return { id: 'p1', name: 'Retail', source: { kind: 'new' }, model: model(), data, report: report(), diagnostics: [], dirty: false }
}

describe('DAX reference scanning', () => {
  it('reads bracketed names, ignoring strings and comments', () => {
    expect([...bracketNames(`SUM('Sales'[Amount]) + [Total] // [Hidden]\n + LEN("[NotAColumn]")`)]).toEqual(['amount', 'total'])
  })

  it('finds whole-table references but not column prefixes or functions', () => {
    expect(referencesWholeTable('COUNTROWS(Sales)', 'Sales')).toBe(true)
    expect(referencesWholeTable("CALCULATE([x], ALL('Sales'))", 'Sales')).toBe(true)
    expect(referencesWholeTable('SUM(Sales[Amount])', 'Sales')).toBe(false)
    expect(referencesWholeTable("SUM('Sales'[Amount])", 'Sales')).toBe(false)
    expect(referencesWholeTable('DATE(2024, 1, 1)', 'Date')).toBe(false)
    expect(referencesWholeTable('[Sales]', 'Sales')).toBe(false)
    expect(referencesWholeTable('"Sales"', 'Sales')).toBe(false)
  })
})

describe('column usage', () => {
  it('keeps report fields, measure inputs, relationship keys and sort-by columns', () => {
    const p = project()
    const u = columnUsage(p.model, p.report)
    expect(isColumnKept(u, 'Product', 'Name')).toBe(true)
    expect(isColumnKept(u, 'Product', 'SortOrder')).toBe(true)
    expect(isColumnKept(u, 'Product', 'ProductKey')).toBe(true)
    expect(isColumnKept(u, 'Sales', 'ProductKey')).toBe(true)
    expect(isColumnKept(u, 'Sales', 'Amount')).toBe(true)
    expect(isColumnKept(u, 'Product', 'Supplier')).toBe(false)
    expect(isColumnKept(u, 'Sales', 'Notes')).toBe(false)
    expect(isColumnKept(u, 'Sales', 'Cost')).toBe(false)
  })

  it('keeps every column of a table used as a table expression', () => {
    const p = project()
    const u = columnUsage(p.model, p.report)
    expect(u.wholeTables.has('Region')).toBe(true)
    expect(isColumnKept(u, 'Region', 'Manager')).toBe(true)
  })

  it('keeps a column named only in a filter of the report', () => {
    const p = project()
    p.report!.pages[0].json.filterConfig = { filters: [{ name: 'f', field: { Column: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: 'Cost' } } }] }
    expect(isColumnKept(columnUsage(p.model, p.report), 'Sales', 'Cost')).toBe(true)
  })
})

describe('publish bundle', () => {
  it('writes the manifest and a bundle that opens with the trimmed data', async () => {
    const p = project()
    const b = buildPublishBundle(p, { now: new Date('2026-11-23T12:00:00Z') })
    const manifest = JSON.parse(b.files[PUBLISH_MANIFEST] as string) as PublishManifest
    expect(manifest).toMatchObject({ format: 'lumen-publish', title: 'Retail', name: 'Retail', publishedAt: '2026-11-23T12:00:00.000Z', bundle: PUBLISH_BUNDLE })
    expect(manifest.pages).toEqual([{ name: 'ReportSection', displayName: 'Overview' }])
    expect(b.summary).toMatchObject({ tables: 3, rows: 6, columns: 10, columnsLeftOut: 3, queriesRemoved: 4 })

    const opened = await openWbi(b.files[PUBLISH_BUNDLE] as Uint8Array, undefined)
    const sales = opened.data.tables.get('Sales')!
    expect(sales.columns.find((c) => c.name === 'Amount')!.values).toEqual([10, 20])
    expect(sales.columns.find((c) => c.name === 'Notes')!.values).toEqual([null, null])
    expect(opened.model.tables.find((t) => t.name === 'Sales')!.columns.map((c) => c.name)).toEqual(['ProductKey', 'Amount', 'Cost', 'Notes'])
    expect(opened.model.expressions[0].expression).toBe(REMOVED_QUERY)
    expect(opened.model.tables[0].partitions[0].expression).toBe(REMOVED_QUERY)
    expect(opened.report?.pages.map((pg) => pg.name)).toEqual(['ReportSection', 'tip'])
    // the source project is untouched
    expect(p.model.expressions[0].expression).toContain('sql.example.test')
  })

  it('carries the report motion settings, or publishes a still dashboard when asked', async () => {
    const p = project()
    setReportMotion(p.report!.report, { transition: 'slide', stagger: 40 })
    setVisualMotion(p.report!.pages[0].visuals[0].json, { entrance: 'rise' })
    const moving = buildPublishBundle(p)
    expect(moving.manifest.motion).toEqual({ animate: true, transitions: ['slide'] })
    const opened = await openWbi(moving.files[PUBLISH_BUNDLE] as Uint8Array, undefined)
    expect(reportMotion(opened.report!.report)).toMatchObject({ transition: 'slide', stagger: 40 })
    expect(visualMotion(opened.report!.pages[0].visuals[0].json)).toEqual({ entrance: 'rise' })

    const still = buildPublishBundle(p, { motion: false })
    expect(still.manifest.motion).toEqual({ animate: false, transitions: [] })
    expect(still.summary.motion).toEqual({ animate: false, transitions: [] })
    const stillOpened = await openWbi(still.files[PUBLISH_BUNDLE] as Uint8Array, undefined)
    expect(reportMotion(stillOpened.report!.report)).toMatchObject({ animate: false, transition: 'none' })
    expect(visualMotion(stillOpened.report!.pages[0].visuals[0].json)).toEqual({})
    // the open report keeps its settings
    expect(reportMotion(p.report!.report).transition).toBe('slide')
  })

  it('keeps all data and queries when asked', async () => {
    const b = buildPublishBundle(project(), { trimData: false, stripQueries: false, title: ' Retail dashboard ' })
    expect(b.summary.columnsLeftOut).toBe(0)
    expect(b.summary.queriesRemoved).toBe(0)
    expect(b.manifest.title).toBe('Retail dashboard')
    const opened = await openWbi(b.files[PUBLISH_BUNDLE] as Uint8Array, undefined)
    expect(opened.data.tables.get('Sales')!.columns.find((c) => c.name === 'Notes')!.values).toEqual(['private note', 'another'])
    expect(opened.model.expressions[0].expression).toContain('sql.example.test')
  })

  it('warns about row-level security, sample data and empty tables', () => {
    const p = project()
    p.model.roles.push({ name: 'North', tablePermissions: [{ table: 'Region', filterExpression: 'Region[Code] = "N"' }] })
    p.data.status.set('Product', { state: 'loaded', source: 'synthetic', rowCount: 2 })
    p.data.tables.delete('Region')
    const w = buildPublishBundle(p).summary.warnings.join('\n')
    expect(w).toMatch(/Row-level security/)
    expect(w).toMatch(/Product holds generated sample data/)
    expect(w).toMatch(/Region has no data/)
  })

  it('refuses a project without a report or with a live connection', () => {
    const p = project()
    expect(() => buildPublishBundle({ ...p, report: undefined })).toThrow(/Only a report/)
    const live = project()
    live.model.tables = []
    live.report!.pbir = { datasetReference: { byConnection: { connectionString: 'x' } } }
    expect(() => buildPublishBundle(live)).toThrow(/live connection/)
  })
})
