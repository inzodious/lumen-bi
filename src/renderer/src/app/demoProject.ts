/**
 * Small built-in demo project ("Sample sales") used by the start screen's "Try a sample" when the
 * core data workstream doesn't provide `createSampleProject` (src/core/data/sample.ts), and by
 * headless shell captures (`#/?sample=1`). Neutral, generated data — deterministic (seeded).
 */
import { nanoid } from 'nanoid'
import type { ProjectDocument } from '@core/project'
import type { SemanticModel } from '@core/model/types'
import { emptyDataStore, makeDate, tableFromRows, type Scalar } from '@core/model/data'
import { emptyReport } from '@core/report/types'
import { aggregationExpr, columnExpr, measureExpr } from '@core/report/sq'

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const PRODUCTS: Array<[number, string, string, number]> = [
  [1, 'Trail Bike', 'Bikes', 1200],
  [2, 'Road Bike', 'Bikes', 1850],
  [3, 'City Bike', 'Bikes', 640],
  [4, 'Helmet', 'Accessories', 65],
  [5, 'Bottle Cage', 'Accessories', 12],
  [6, 'Bike Lights', 'Accessories', 38],
  [7, 'Jersey', 'Clothing', 54],
  [8, 'Gloves', 'Clothing', 24],
  [9, 'Rain Jacket', 'Clothing', 110],
  [10, 'Tire Kit', 'Components', 45],
  [11, 'Chain', 'Components', 30],
  [12, 'Pedals', 'Components', 80]
]
const REGIONS = ['North', 'South', 'East', 'West', 'Central']

const tag = () => crypto.randomUUID()

export function createDemoProject(): ProjectDocument {
  const model: SemanticModel = {
    name: 'Sample sales',
    culture: 'en-US',
    compatibilityLevel: 1600,
    tables: [
      {
        name: 'Sales',
        lineageTag: tag(),
        columns: [
          { name: 'OrderDate', dataType: 'dateTime', kind: 'data', sourceColumn: 'OrderDate', formatString: 'Short Date', summarizeBy: 'none', lineageTag: tag() },
          { name: 'ProductKey', dataType: 'int64', kind: 'data', sourceColumn: 'ProductKey', isHidden: true, summarizeBy: 'none', lineageTag: tag() },
          { name: 'Region', dataType: 'string', kind: 'data', sourceColumn: 'Region', summarizeBy: 'none', lineageTag: tag() },
          { name: 'Quantity', dataType: 'int64', kind: 'data', sourceColumn: 'Quantity', summarizeBy: 'sum', formatString: '#,0', lineageTag: tag() },
          { name: 'Amount', dataType: 'decimal', kind: 'data', sourceColumn: 'Amount', summarizeBy: 'sum', formatString: '\\$#,0.00;(\\$#,0.00);\\$#,0.00', lineageTag: tag() }
        ],
        measures: [
          { name: 'Total Sales', expression: 'SUM(Sales[Amount])', formatString: '\\$#,0;(\\$#,0);\\$#,0', lineageTag: tag() },
          { name: 'Units', expression: 'SUM(Sales[Quantity])', formatString: '#,0', lineageTag: tag() },
          { name: 'Avg Price', expression: 'DIVIDE([Total Sales], [Units])', formatString: '\\$#,0.00', displayFolder: 'Ratios', lineageTag: tag() }
        ],
        hierarchies: [],
        partitions: [{ name: 'Sales', mode: 'import', sourceType: 'm', expression: 'let\n    Source = #table({"OrderDate","ProductKey","Region","Quantity","Amount"}, {})\nin\n    Source' }]
      },
      {
        name: 'Product',
        lineageTag: tag(),
        columns: [
          { name: 'ProductKey', dataType: 'int64', kind: 'data', sourceColumn: 'ProductKey', isKey: true, isHidden: true, summarizeBy: 'none', lineageTag: tag() },
          { name: 'Product', dataType: 'string', kind: 'data', sourceColumn: 'Product', summarizeBy: 'none', lineageTag: tag() },
          { name: 'Category', dataType: 'string', kind: 'data', sourceColumn: 'Category', summarizeBy: 'none', lineageTag: tag() },
          { name: 'List Price', dataType: 'decimal', kind: 'data', sourceColumn: 'List Price', summarizeBy: 'sum', formatString: '\\$#,0.00', lineageTag: tag() }
        ],
        measures: [],
        hierarchies: [{ name: 'Category Hierarchy', lineageTag: tag(), levels: [{ name: 'Category', column: 'Category', ordinal: 0 }, { name: 'Product', column: 'Product', ordinal: 1 }] }],
        partitions: [{ name: 'Product', mode: 'import', sourceType: 'm', expression: 'let\n    Source = #table({"ProductKey","Product","Category","List Price"}, {})\nin\n    Source' }]
      },
      {
        name: 'Date',
        lineageTag: tag(),
        dataCategory: 'Time',
        columns: [
          { name: 'Date', dataType: 'dateTime', kind: 'calculatedTableColumn', sourceColumn: '[Date]', isKey: true, formatString: 'Short Date', summarizeBy: 'none', lineageTag: tag() },
          { name: 'Year', dataType: 'int64', kind: 'calculated', expression: 'YEAR([Date])', summarizeBy: 'none', lineageTag: tag() },
          { name: 'Month', dataType: 'string', kind: 'calculated', expression: 'FORMAT([Date], "MMM")', sortByColumn: 'MonthNo', summarizeBy: 'none', lineageTag: tag() },
          { name: 'MonthNo', dataType: 'int64', kind: 'calculated', expression: 'MONTH([Date])', isHidden: true, summarizeBy: 'none', lineageTag: tag() }
        ],
        measures: [],
        hierarchies: [],
        partitions: [{ name: 'Date', mode: 'import', sourceType: 'calculated', expression: 'CALENDAR(DATE(2024, 1, 1), DATE(2025, 12, 31))' }]
      }
    ],
    relationships: [
      { name: tag(), fromTable: 'Sales', fromColumn: 'ProductKey', toTable: 'Product', toColumn: 'ProductKey', fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection', isActive: true },
      { name: tag(), fromTable: 'Sales', fromColumn: 'OrderDate', toTable: 'Date', toColumn: 'Date', fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection', isActive: true }
    ],
    expressions: [],
    roles: []
  }

  const data = emptyDataStore()
  const r = rng(7)
  const salesRows: Scalar[][] = []
  for (let i = 0; i < 2400; i++) {
    const p = PRODUCTS[Math.floor(r() * PRODUCTS.length)]
    const day = Math.floor(r() * 730)
    const qty = 1 + Math.floor(r() * (p[2] === 'Bikes' ? 3 : 8))
    const date = makeDate(2024, 1, 1 + day)
    salesRows.push([date, p[0], REGIONS[Math.floor(r() * REGIONS.length)], qty, Math.round(qty * p[3] * (0.85 + r() * 0.3) * 100) / 100])
  }
  data.tables.set('Sales', tableFromRows(['OrderDate', 'ProductKey', 'Region', 'Quantity', 'Amount'], ['dateTime', 'int64', 'string', 'int64', 'decimal'], salesRows))
  data.tables.set('Product', tableFromRows(['ProductKey', 'Product', 'Category', 'List Price'], ['int64', 'string', 'string', 'decimal'], PRODUCTS.map((p) => [p[0], p[1], p[2], p[3]])))
  data.status.set('Sales', { state: 'loaded', source: 'import', rowCount: salesRows.length })
  data.status.set('Product', { state: 'loaded', source: 'import', rowCount: PRODUCTS.length })

  const report = emptyReport()
  const page = report.pages[0]
  page.json.displayName = 'Overview'
  const lit = (v: string) => ({ expr: { Literal: { Value: `'${v}'` } } })
  const visual = (name: string, x: number, y: number, width: number, height: number, z: number, v: any) => ({
    name,
    json: { $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.4.0/schema.json', name, position: { x, y, z, width, height, tabOrder: z }, visual: v }
  })
  const proj = (field: any, queryRef: string, nativeQueryRef: string) => ({ field, queryRef, nativeQueryRef })
  page.visuals.push(
    visual('a1b2c3d4e5f6a7b8c9d0', 24, 20, 400, 52, 0, {
      visualType: 'textbox',
      objects: { general: [{ properties: { paragraphs: [{ textRuns: [{ value: 'Sales overview', textStyle: { fontSize: '20pt', fontWeight: 'bold' } }] }] } }] },
      visualContainerObjects: {}
    }),
    visual('b1b2c3d4e5f6a7b8c9d0', 24, 84, 280, 120, 1000, {
      visualType: 'cardVisual',
      query: { queryState: { Data: { projections: [proj(measureExpr('Sales', 'Total Sales'), 'Sales.Total Sales', 'Total Sales')] } } }
    }),
    visual('c1b2c3d4e5f6a7b8c9d0', 320, 84, 280, 120, 2000, {
      visualType: 'cardVisual',
      query: { queryState: { Data: { projections: [proj(measureExpr('Sales', 'Units'), 'Sales.Units', 'Units')] } } }
    }),
    visual('d1b2c3d4e5f6a7b8c9d0', 616, 84, 300, 120, 3000, {
      visualType: 'slicer',
      query: { queryState: { Values: { projections: [{ ...proj(columnExpr('Sales', 'Region'), 'Sales.Region', 'Region'), active: true }] } } },
      objects: { data: [{ properties: { mode: lit('Dropdown') } }] }
    }),
    visual('e1b2c3d4e5f6a7b8c9d0', 24, 220, 600, 340, 4000, {
      visualType: 'clusteredColumnChart',
      query: {
        queryState: {
          Category: { projections: [{ ...proj(columnExpr('Product', 'Category'), 'Product.Category', 'Category'), active: true }] },
          Y: { projections: [proj(measureExpr('Sales', 'Total Sales'), 'Sales.Total Sales', 'Total Sales')] }
        }
      }
    }),
    visual('f1b2c3d4e5f6a7b8c9d0', 640, 220, 616, 340, 5000, {
      visualType: 'lineChart',
      query: {
        queryState: {
          Category: { projections: [{ ...proj(columnExpr('Date', 'Month'), 'Date.Month', 'Month'), active: true }] },
          Y: { projections: [proj(aggregationExpr('Sales', 'Quantity', 0), 'Sum(Sales.Quantity)', 'Sum of Quantity')] }
        }
      }
    }),
    visual('a2b2c3d4e5f6a7b8c9d0', 24, 576, 1232, 124, 6000, {
      visualType: 'tableEx',
      query: {
        queryState: {
          Values: {
            projections: [
              proj(columnExpr('Product', 'Product'), 'Product.Product', 'Product'),
              proj(columnExpr('Product', 'Category'), 'Product.Category', 'Category'),
              proj(measureExpr('Sales', 'Total Sales'), 'Sales.Total Sales', 'Total Sales'),
              proj(measureExpr('Sales', 'Units'), 'Sales.Units', 'Units')
            ]
          }
        }
      }
    })
  )
  page.json.filterConfig = {
    filters: [{ name: '0a1b2c3d4e5f6a7b8c9d', field: columnExpr('Product', 'Category'), type: 'Categorical', howCreated: 'User' }]
  }
  report.pages.push({
    name: 'ReportSection2',
    json: { name: 'ReportSection2', displayName: 'Details', displayOption: 'FitToPage', height: 720, width: 1280 },
    visuals: []
  })
  report.pagesMeta.pageOrder.push('ReportSection2')

  return { id: nanoid(), name: 'Sample sales', source: { kind: 'new' }, model, data, report, diagnostics: [], dirty: false }
}
