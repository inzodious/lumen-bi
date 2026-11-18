/**
 * Deterministic sample model + data for the visuals gallery (neutral retail-style dataset).
 *
 *  Sales     — one row per (month × product × region × channel): Date, Year, Quarter, Month,
 *              MonthNo, Region, Country, State, Category, Product, Channel, Segment, Amount, Cost, Units, Target, Month Start
 *  Pipeline  — funnel stages with an ordinal
 *
 * Measures are written in DAX so the real engine can run them; the mock engine maps them to
 * equivalent JS aggregations (see mockEngine.ts).
 */
import type { SemanticModel, TableDef, ColumnDef, DataType } from '@core/model/types'
import { tableFromRows, type DataStore, type Scalar } from '@core/model/data'

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const PRODUCTS: Array<[string, string, number]> = [
  ['Bikes', 'Mountain-200', 2100],
  ['Bikes', 'Road-250', 1800],
  ['Bikes', 'Touring-1000', 1500],
  ['Bikes', 'Road-650', 900],
  ['Components', 'HL Crankset', 400],
  ['Components', 'ML Fork', 320],
  ['Components', 'Headset', 160],
  ['Clothing', 'Jersey', 70],
  ['Clothing', 'Bib-Shorts', 60],
  ['Clothing', 'Gloves', 30],
  ['Accessories', 'Helmet', 45],
  ['Accessories', 'Bottle Cage', 12],
  ['Accessories', 'Tire Tube', 8]
]

const GEO: Array<[string, string, string | null, number]> = [
  ['North America', 'United States', 'California', 1.6],
  ['North America', 'United States', 'Texas', 1.1],
  ['North America', 'United States', 'New York', 1.0],
  ['North America', 'United States', 'Washington', 0.7],
  ['North America', 'United States', 'Florida', 0.8],
  ['North America', 'Canada', null, 0.8],
  ['Europe', 'Germany', null, 1.0],
  ['Europe', 'France', null, 0.8],
  ['Europe', 'United Kingdom', null, 0.9],
  ['Europe', 'Spain', null, 0.4],
  ['Pacific', 'Australia', null, 0.9],
  ['Pacific', 'Japan', null, 0.5],
  ['Latin America', 'Brazil', null, 0.45],
  ['Latin America', 'Mexico', null, 0.35]
]

const CHANNELS: Array<[string, number]> = [
  ['Online', 1.1],
  ['Retail', 0.9],
  ['Partner', 0.45]
]

function col(name: string, dataType: DataType, extra: Partial<ColumnDef> = {}): ColumnDef {
  return { name, dataType, kind: 'data', sourceColumn: name, ...extra }
}

export function buildSampleModel(): { model: SemanticModel; data: DataStore } {
  const r = rng(42)
  const rows: Scalar[][] = []
  for (let y = 2023; y <= 2024; y++) {
    for (let m = 1; m <= 12; m++) {
      const season = 1 + 0.25 * Math.sin(((m - 3) / 12) * Math.PI * 2) + (y - 2023) * 0.12 + (m / 12) * 0.08
      for (const [cat, prod, price] of PRODUCTS) {
        for (const [region, country, state, gw] of GEO) {
          if (r() < 0.12) continue
          const [channel, cw] = CHANNELS[Math.floor(r() * CHANNELS.length)]
          const base = (cat === 'Bikes' ? 6 : cat === 'Components' ? 9 : 14) * gw * cw * season
          const units = Math.max(1, Math.round(base * (0.6 + r() * 0.8)))
          const amount = Math.round(units * price * (0.92 + r() * 0.16))
          const cost = Math.round(amount * (cat === 'Bikes' ? 0.62 : cat === 'Accessories' ? 0.38 : 0.5) * (0.9 + r() * 0.2))
          const target = Math.round(amount * (0.9 + r() * 0.25))
          const day = 1 + Math.floor(r() * 27)
          const date = new Date(Date.UTC(y, m - 1, day))
          const segment = r() < 0.55 ? 'Consumer' : r() < 0.7 ? 'Corporate' : 'Small Business'
          rows.push([date, y, `Qtr ${Math.ceil(m / 3)}`, MONTHS[m - 1], m, region, country, state, cat, prod, channel, segment, amount, cost, units, target, new Date(Date.UTC(y, m - 1, 1))])
        }
      }
    }
  }
  const salesCols: ColumnDef[] = [
    col('Date', 'dateTime', { formatString: 'Short Date' }),
    col('Year', 'int64', { formatString: '0', summarizeBy: 'none' }),
    col('Quarter', 'string'),
    col('Month', 'string', { sortByColumn: 'MonthNo' }),
    col('MonthNo', 'int64', { isHidden: true, summarizeBy: 'none' }),
    col('Region', 'string'),
    col('Country', 'string', { dataCategory: 'Country' }),
    col('State', 'string', { dataCategory: 'StateOrProvince' }),
    col('Category', 'string'),
    col('Product', 'string'),
    col('Channel', 'string'),
    col('Segment', 'string'),
    col('Amount', 'double', { formatString: '\\$#,0;(\\$#,0);\\$#,0', summarizeBy: 'sum' }),
    col('Cost', 'double', { formatString: '\\$#,0', summarizeBy: 'sum' }),
    col('Units', 'int64', { formatString: '#,0', summarizeBy: 'sum' }),
    col('Target', 'double', { formatString: '\\$#,0', summarizeBy: 'sum' }),
    // first day of the month: a monthly continuous date axis (forecast fixtures)
    col('Month Start', 'dateTime', { formatString: 'mmm yyyy' })
  ]
  const sales: TableDef = {
    name: 'Sales',
    columns: salesCols,
    measures: [
      { name: 'Total Sales', expression: "SUM ( Sales[Amount] )", formatString: '\\$#,0' },
      { name: 'Total Cost', expression: "SUM ( Sales[Cost] )", formatString: '\\$#,0' },
      { name: 'Profit', expression: '[Total Sales] - [Total Cost]', formatString: '\\$#,0' },
      { name: 'Margin %', expression: 'DIVIDE ( [Profit], [Total Sales] )', formatString: '0.0%' },
      { name: 'Units Sold', expression: "SUM ( Sales[Units] )", formatString: '#,0' },
      { name: 'Sales Target', expression: "SUM ( Sales[Target] )", formatString: '\\$#,0' },
      { name: 'Avg Price', expression: 'DIVIDE ( [Total Sales], [Units Sold] )', formatString: '\\$#,0.00' },
      { name: 'Orders', expression: 'COUNTROWS ( Sales )', formatString: '#,0' }
    ],
    hierarchies: [
      {
        name: 'Date Hierarchy',
        levels: [
          { name: 'Year', column: 'Year', ordinal: 0 },
          { name: 'Quarter', column: 'Quarter', ordinal: 1 },
          { name: 'Month', column: 'Month', ordinal: 2 }
        ]
      }
    ],
    partitions: [{ name: 'Sales', sourceType: 'unknown' }]
  }
  const stages: Array<[string, number, number]> = [
    ['Leads', 1, 4200],
    ['Qualified', 2, 2650],
    ['Proposal', 3, 1480],
    ['Negotiation', 4, 760],
    ['Closed Won', 5, 410]
  ]
  const pipeline: TableDef = {
    name: 'Pipeline',
    columns: [col('Stage', 'string', { sortByColumn: 'StageOrder' }), col('StageOrder', 'int64', { isHidden: true }), col('Count', 'int64', { formatString: '#,0', summarizeBy: 'sum' })],
    measures: [{ name: 'Opportunities', expression: 'SUM ( Pipeline[Count] )', formatString: '#,0' }],
    hierarchies: [],
    partitions: [{ name: 'Pipeline', sourceType: 'unknown' }]
  }
  const model: SemanticModel = { name: 'Gallery', culture: 'en-US', tables: [sales, pipeline], relationships: [], expressions: [], roles: [] }
  const data: DataStore = { tables: new Map(), status: new Map() }
  data.tables.set(
    'Sales',
    tableFromRows(
      salesCols.map((c) => c.name),
      salesCols.map((c) => c.dataType),
      rows
    )
  )
  data.tables.set(
    'Pipeline',
    tableFromRows(
      ['Stage', 'StageOrder', 'Count'],
      ['string', 'int64', 'int64'],
      stages.map((s) => [s[0], s[1], s[2]])
    )
  )
  data.status.set('Sales', { state: 'loaded', source: 'synthetic', rowCount: rows.length })
  data.status.set('Pipeline', { state: 'loaded', source: 'synthetic', rowCount: stages.length })
  return { model, data }
}
