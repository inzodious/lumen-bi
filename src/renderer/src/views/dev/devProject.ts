/**
 * DEV ONLY — a small, deterministic star-schema project (neutral names) used by the
 * #/modeling-test harness to exercise the Table / Model / DAX query views and modeling dialogs.
 */
import type { ProjectDocument } from '@core/project'
import { emptyModel, type SemanticModel, type TableDef } from '@core/model/types'
import { emptyDataStore, makeDate, tableFromRows, type Scalar } from '@core/model/data'

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const tag = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export function createDevProject(): ProjectDocument {
  const model: SemanticModel = emptyModel('Sample Model')
  const t = (name: string, columns: TableDef['columns'], extra: Partial<TableDef> = {}): TableDef => ({ name, columns, measures: [], hierarchies: [], partitions: [{ name, mode: 'import', sourceType: 'm', expression: 'let Source = #table({}, {}) in Source' }], lineageTag: tag(model.tables.length + 1), ...extra })
  model.tables = [
    t('Sales', [
      { name: 'OrderID', dataType: 'int64', kind: 'data', sourceColumn: 'OrderID', summarizeBy: 'none', formatString: '0' },
      { name: 'OrderDate', dataType: 'dateTime', kind: 'data', sourceColumn: 'OrderDate', formatString: 'Short Date' },
      { name: 'ProductKey', dataType: 'int64', kind: 'data', sourceColumn: 'ProductKey', summarizeBy: 'none', isHidden: true },
      { name: 'CustomerKey', dataType: 'int64', kind: 'data', sourceColumn: 'CustomerKey', summarizeBy: 'none', isHidden: true },
      { name: 'Quantity', dataType: 'int64', kind: 'data', sourceColumn: 'Quantity', summarizeBy: 'sum', formatString: '#,0' },
      { name: 'Unit Price', dataType: 'decimal', kind: 'data', sourceColumn: 'Unit Price', summarizeBy: 'sum', formatString: '\\$#,0.00;(\\$#,0.00);\\$#,0.00' },
      { name: 'Line Total', dataType: 'double', kind: 'calculated', expression: "Sales[Quantity] * Sales[Unit Price]", summarizeBy: 'sum', formatString: '#,0.00' }
    ]),
    t('Product', [
      { name: 'ProductKey', dataType: 'int64', kind: 'data', sourceColumn: 'ProductKey', isKey: true, summarizeBy: 'none' },
      { name: 'Product', dataType: 'string', kind: 'data', sourceColumn: 'Product' },
      { name: 'Category', dataType: 'string', kind: 'data', sourceColumn: 'Category' },
      { name: 'Color', dataType: 'string', kind: 'data', sourceColumn: 'Color' },
      { name: 'List Price', dataType: 'decimal', kind: 'data', sourceColumn: 'List Price', formatString: '\\$#,0.00;(\\$#,0.00);\\$#,0.00' }
    ]),
    t('Customer', [
      { name: 'CustomerKey', dataType: 'int64', kind: 'data', sourceColumn: 'CustomerKey', summarizeBy: 'none' },
      { name: 'Customer', dataType: 'string', kind: 'data', sourceColumn: 'Customer' },
      { name: 'City', dataType: 'string', kind: 'data', sourceColumn: 'City', dataCategory: 'City' },
      { name: 'Country', dataType: 'string', kind: 'data', sourceColumn: 'Country', dataCategory: 'Country' },
      { name: 'Segment', dataType: 'string', kind: 'data', sourceColumn: 'Segment' }
    ]),
    t(
      'Date',
      [
        { name: 'Date', dataType: 'dateTime', kind: 'data', sourceColumn: 'Date', formatString: 'Short Date', isKey: true },
        { name: 'Year', dataType: 'int64', kind: 'data', sourceColumn: 'Year', summarizeBy: 'none', formatString: '0' },
        { name: 'Month', dataType: 'string', kind: 'data', sourceColumn: 'Month', sortByColumn: 'Month Number' },
        { name: 'Month Number', dataType: 'int64', kind: 'data', sourceColumn: 'Month Number', isHidden: true, summarizeBy: 'none' }
      ],
      { dataCategory: 'Time' }
    ),
    t('Region Targets', [
      { name: 'Country', dataType: 'string', kind: 'data', sourceColumn: 'Country' },
      { name: 'Target', dataType: 'int64', kind: 'data', sourceColumn: 'Target', summarizeBy: 'sum', formatString: '#,0' }
    ]),
    t('Measures', [], { partitions: [{ name: 'Measures', mode: 'import', sourceType: 'calculated', expression: '{ BLANK() }' }] })
  ]
  model.tables[3].hierarchies.push({ name: 'Calendar', levels: [{ name: 'Year', column: 'Year', ordinal: 0 }, { name: 'Month', column: 'Month', ordinal: 1 }, { name: 'Date', column: 'Date', ordinal: 2 }] })
  model.tables[5].measures.push(
    { name: 'Total Sales', expression: 'SUM ( Sales[Line Total] )', formatString: '\\$#,0;(\\$#,0);\\$#,0', displayFolder: 'Sales' },
    { name: 'Orders', expression: 'DISTINCTCOUNT ( Sales[OrderID] )', formatString: '#,0' },
    { name: 'Avg Order Value', expression: 'DIVIDE ( [Total Sales], [Orders] )', formatString: '\\$#,0.00' },
    {
      name: 'Sales YoY %',
      expression: "VAR __PREV_YEAR =\n    CALCULATE ( [Total Sales], DATEADD ( 'Date'[Date], -1, YEAR ) )\nRETURN\n    DIVIDE ( [Total Sales] - __PREV_YEAR, __PREV_YEAR )",
      formatString: '0.0%'
    }
  )
  model.tables[0].measures.push({ name: 'Quantity Sold', expression: 'SUM ( Sales[Quantity] )', formatString: '#,0' })
  const rel = (n: number, f: string, fc: string, to: string, tc: string, extra: Partial<SemanticModel['relationships'][number]> = {}) =>
    ({ name: tag(100 + n), fromTable: f, fromColumn: fc, toTable: to, toColumn: tc, fromCardinality: 'many', toCardinality: 'one', crossFilteringBehavior: 'oneDirection', isActive: true, ...extra }) as SemanticModel['relationships'][number]
  model.relationships = [rel(1, 'Sales', 'ProductKey', 'Product', 'ProductKey'), rel(2, 'Sales', 'CustomerKey', 'Customer', 'CustomerKey'), rel(3, 'Sales', 'OrderDate', 'Date', 'Date'), rel(4, 'Region Targets', 'Country', 'Customer', 'Country', { fromCardinality: 'many', toCardinality: 'many', crossFilteringBehavior: 'bothDirections', isActive: false })]
  model.roles = [{ name: 'Europe', modelPermission: 'read', tablePermissions: [{ table: 'Customer', filterExpression: 'Customer[Country] IN { "Germany", "France", "United Kingdom" }' }] }]

  const data = emptyDataStore()
  const r = rng(42)
  const categories: Array<[string, string[]]> = [
    ['Bikes', ['Road-150', 'Mountain-200', 'Touring-1000']],
    ['Accessories', ['Helmet', 'Bottle', 'Lock', 'Pump']],
    ['Clothing', ['Jersey', 'Gloves', 'Cap']]
  ]
  const colors = ['Red', 'Black', 'Silver', 'Blue', 'Yellow']
  const products: Scalar[][] = []
  let pk = 1
  for (const [cat, names] of categories)
    for (const n of names) {
      products.push([pk, n, cat, colors[pk % colors.length], Math.round((cat === 'Bikes' ? 800 + r() * 2500 : 8 + r() * 90) * 100) / 100])
      pk++
    }
  data.tables.set('Product', tableFromRows(['ProductKey', 'Product', 'Category', 'Color', 'List Price'], ['int64', 'string', 'string', 'string', 'decimal'], products))
  const cities: Array<[string, string]> = [['Seattle', 'United States'], ['Toronto', 'Canada'], ['Berlin', 'Germany'], ['Paris', 'France'], ['London', 'United Kingdom'], ['Sydney', 'Australia']]
  const customers: Scalar[][] = []
  for (let i = 1; i <= 60; i++) {
    const [city, country] = cities[i % cities.length]
    customers.push([i, `Customer ${String(i).padStart(3, '0')}`, city, country, i % 3 === 0 ? 'Corporate' : i % 3 === 1 ? 'Consumer' : 'Small Business'])
  }
  data.tables.set('Customer', tableFromRows(['CustomerKey', 'Customer', 'City', 'Country', 'Segment'], ['int64', 'string', 'string', 'string', 'string'], customers))
  const dates: Scalar[][] = []
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  for (let d = makeDate(2023, 1, 1).getTime(); d <= makeDate(2024, 12, 31).getTime(); d += 86_400_000) {
    const dt = new Date(d)
    dates.push([dt, dt.getUTCFullYear(), months[dt.getUTCMonth()], dt.getUTCMonth() + 1])
  }
  data.tables.set('Date', tableFromRows(['Date', 'Year', 'Month', 'Month Number'], ['dateTime', 'int64', 'string', 'int64'], dates))
  const sales: Scalar[][] = []
  for (let i = 1; i <= 2500; i++) {
    const p = products[Math.floor(r() * products.length)]
    const date = dates[Math.floor(r() * dates.length)][0]
    const q = 1 + Math.floor(r() * 5)
    const price = p[4] as number
    sales.push([10000 + Math.floor(i / 2), date, p[0], 1 + Math.floor(r() * 60), q, price, q * price])
  }
  data.tables.set('Sales', tableFromRows(['OrderID', 'OrderDate', 'ProductKey', 'CustomerKey', 'Quantity', 'Unit Price', 'Line Total'], ['int64', 'dateTime', 'int64', 'int64', 'int64', 'decimal', 'double'], sales))
  data.tables.set('Region Targets', tableFromRows(['Country', 'Target'], ['string', 'int64'], cities.map(([, c], i) => [c, 200000 + i * 50000])))
  data.tables.set('Measures', tableFromRows([], [], []))
  for (const [name, td] of data.tables) data.status.set(name, { state: 'loaded', source: 'synthetic', rowCount: td.rowCount })
  return { id: 'dev-modeling', name: 'Sample Model', source: { kind: 'new' }, model, data, diagnostics: [], dirty: false }
}
