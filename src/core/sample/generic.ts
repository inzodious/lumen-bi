/**
 * Generic sample data for an empty visual that has no sample of its own: a small retail dataset (one year by month,
 * product, country and channel, plus a sales pipeline) and, for each visual type, the fields a Power BI author would
 * most likely put in it. Words in the visual's title pick the dimension and measure ("Profit by region" draws Profit
 * by Region; "Orders over time" draws Orders by Month), so a mockup reads like the report it stands in for.
 *
 * Deterministic: the same seed gives the same rows, so a report looks the same every time it opens.
 */
import { columnExpr, defaultQueryRef, measureExpr, type SQExpr } from '../report/sq'
import type { SampleDataset, SampleTable } from './dataset'

export const GENERIC_FACT = 'Sales'
export const GENERIC_PIPELINE = 'Pipeline'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const PRODUCTS: Array<[category: string, product: string, price: number, popularity: number]> = [
  ['Bikes', 'Mountain-200', 2100, 0.7],
  ['Bikes', 'Road-250', 1800, 0.8],
  ['Bikes', 'Touring-1000', 1500, 0.55],
  ['Components', 'HL Crankset', 400, 0.9],
  ['Components', 'ML Fork', 320, 0.75],
  ['Components', 'Headset', 160, 1.1],
  ['Clothing', 'Jersey', 70, 2.2],
  ['Clothing', 'Bib-Shorts', 60, 1.7],
  ['Clothing', 'Gloves', 30, 2.6],
  ['Accessories', 'Helmet', 45, 3.1],
  ['Accessories', 'Bottle Cage', 12, 3.6],
  ['Accessories', 'Tire Tube', 8, 4.2]
]

const GEO: Array<[region: string, country: string, weight: number]> = [
  ['North America', 'United States', 1.9],
  ['North America', 'Canada', 0.7],
  ['Europe', 'Germany', 1.1],
  ['Europe', 'United Kingdom', 0.9],
  ['Europe', 'France', 0.75],
  ['Pacific', 'Australia', 0.8],
  ['Latin America', 'Brazil', 0.5]
]

const CHANNELS: Array<[string, number]> = [
  ['Online', 1.15],
  ['Retail', 0.9],
  ['Partner', 0.45]
]

const SEGMENTS = ['Consumer', 'Corporate', 'Small Business']

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let cached: { seed: number; ds: SampleDataset } | undefined

/** The generic sample dataset (cached per seed). */
export function genericSampleDataset(seed = 20261123): SampleDataset {
  if (cached?.seed === seed) return cached.ds
  const r = rng(seed)
  const rows: SampleTable['rows'] = []
  for (let m = 0; m < 12; m++) {
    const season = 1 + 0.22 * Math.sin(((m - 2) / 12) * Math.PI * 2) + m * 0.018
    for (const [category, product, price, pop] of PRODUCTS) {
      for (const [region, country, gw] of GEO) {
        for (const [channel, cw] of CHANNELS) {
          const units = Math.max(1, Math.round(pop * gw * cw * season * 9 * (0.65 + r() * 0.7)))
          const amount = Math.round(units * price * (0.92 + r() * 0.16))
          const cost = Math.round(amount * (category === 'Bikes' ? 0.63 : category === 'Accessories' ? 0.4 : 0.52) * (0.9 + r() * 0.2))
          const orders = Math.max(1, Math.round(units / (1.2 + r() * 1.4)))
          const customers = Math.max(1, Math.round(orders * (0.7 + r() * 0.25)))
          const target = Math.round(amount * (0.88 + r() * 0.26))
          const segment = SEGMENTS[r() < 0.55 ? 0 : r() < 0.6 ? 1 : 2]
          const date = `2025-${String(m + 1).padStart(2, '0')}-01`
          rows.push([date, 2025, `Qtr ${Math.floor(m / 3) + 1}`, MONTHS[m], m + 1, region, country, category, product, channel, segment, amount, cost, units, orders, customers, target])
        }
      }
    }
  }
  const stages: Array<[string, number, number]> = [
    ['Leads', 1, 4200],
    ['Qualified', 2, 2650],
    ['Proposal', 3, 1480],
    ['Negotiation', 4, 760],
    ['Closed Won', 5, 410]
  ]
  const ds: SampleDataset = {
    $lumen: 'sampleData',
    version: 1,
    tables: [
      {
        name: GENERIC_FACT,
        columns: [
          { name: 'Date', type: 'dateTime', format: 'mmm yyyy' },
          { name: 'Year', type: 'int64' },
          { name: 'Quarter', type: 'string' },
          { name: 'Month', type: 'string', sortBy: 'MonthNo' },
          { name: 'MonthNo', type: 'int64', hidden: true },
          { name: 'Region', type: 'string' },
          { name: 'Country', type: 'string', category: 'Country' },
          { name: 'Category', type: 'string' },
          { name: 'Product', type: 'string' },
          { name: 'Channel', type: 'string' },
          { name: 'Segment', type: 'string' },
          { name: 'Amount', type: 'double', hidden: true },
          { name: 'Cost', type: 'double', hidden: true },
          { name: 'Units', type: 'int64', hidden: true },
          { name: 'OrderCount', type: 'int64', hidden: true },
          { name: 'CustomerCount', type: 'int64', hidden: true },
          { name: 'TargetAmount', type: 'double', hidden: true }
        ],
        rows
      },
      {
        name: GENERIC_PIPELINE,
        columns: [
          { name: 'Stage', type: 'string', sortBy: 'StageOrder' },
          { name: 'StageOrder', type: 'int64', hidden: true },
          { name: 'Count', type: 'int64', hidden: true }
        ],
        rows: stages
      }
    ],
    measures: [
      { table: GENERIC_FACT, name: 'Sales', expression: 'SUM(Sales[Amount])', format: '\\$#,0' },
      { table: GENERIC_FACT, name: 'Cost', expression: 'SUM(Sales[Cost])', format: '\\$#,0' },
      { table: GENERIC_FACT, name: 'Profit', expression: '[Sales] - [Cost]', format: '\\$#,0' },
      { table: GENERIC_FACT, name: 'Margin %', expression: 'DIVIDE([Profit], [Sales])', format: '0.0%' },
      { table: GENERIC_FACT, name: 'Units Sold', expression: 'SUM(Sales[Units])', format: '#,0' },
      { table: GENERIC_FACT, name: 'Orders', expression: 'SUM(Sales[OrderCount])', format: '#,0' },
      { table: GENERIC_FACT, name: 'Customers', expression: 'SUM(Sales[CustomerCount])', format: '#,0' },
      { table: GENERIC_FACT, name: 'Target', expression: 'SUM(Sales[TargetAmount])', format: '\\$#,0' },
      { table: GENERIC_FACT, name: 'Variance', expression: '[Sales] - [Target]', format: '\\$#,0;-\\$#,0' },
      { table: GENERIC_FACT, name: 'Avg Order Value', expression: 'DIVIDE([Sales], [Orders])', format: '\\$#,0.00' },
      { table: GENERIC_PIPELINE, name: 'Opportunities', expression: 'SUM(Pipeline[Count])', format: '#,0' }
    ]
  }
  cached = { seed, ds }
  return ds
}

// ---------------------------------------------------------------------------------------------
// Choosing fields
// ---------------------------------------------------------------------------------------------

type Dim = 'Month' | 'Quarter' | 'Region' | 'Country' | 'Category' | 'Product' | 'Channel' | 'Segment' | 'Stage'
type Measure = 'Sales' | 'Cost' | 'Profit' | 'Margin %' | 'Units Sold' | 'Orders' | 'Customers' | 'Target' | 'Variance' | 'Avg Order Value' | 'Opportunities'

const DIM_WORDS: Array<[RegExp, Dim]> = [
  [/\b(month|monthly|trend|over time|timeline|history|by date|daily|weekly|ytd|mtd)\b/, 'Month'],
  [/\b(quarter|quarterly|qtr)\b/, 'Quarter'],
  [/\b(country|countries|nation|map|world|global)\b/, 'Country'],
  [/\b(region|regions|regional|geo|geography|territor\w*|market|area|location|state)\b/, 'Region'],
  [/\b(category|categories|line|lines|department|type|types|family)\b/, 'Category'],
  [/\b(product|products|item|items|sku|top|best|leaderboard|brand|model)\b/, 'Product'],
  [/\b(channel|channels|source|sources|medium|platform)\b/, 'Channel'],
  [/\b(segment|segments|customer type|tier|plan|cohort)\b/, 'Segment'],
  [/\b(stage|stages|funnel|pipeline|conversion)\b/, 'Stage']
]

const MEASURE_WORDS: Array<[RegExp, Measure]> = [
  [/\b(margin|rate|ratio|percent|share|%)/, 'Margin %'],
  [/\b(profit|earnings|income|ebit\w*)\b/, 'Profit'],
  [/\b(cost|costs|spend|expense\w*)\b/, 'Cost'],
  [/\b(target|budget|goal|plan|forecast|quota)\b/, 'Target'],
  [/\b(variance|vs|versus|gap|delta|bridge)\b/, 'Variance'],
  [/\b(aov|average order|basket|avg|average|price)\b/, 'Avg Order Value'],
  [/\b(order|orders|transactions?|tickets?|bookings?)\b/, 'Orders'],
  [/\b(unit|units|quantity|qty|volume)\b/, 'Units Sold'],
  [/\b(customer|customers|user|users|client|clients|members?|accounts?|visitors?|people)\b/, 'Customers'],
  [/\b(opportunit\w*|deals?|leads?)\b/, 'Opportunities'],
  [/\b(sales|revenue|amount|turnover|value|gmv)\b/, 'Sales']
]

const DIM_TABLE: Record<Dim, string> = {
  Month: GENERIC_FACT,
  Quarter: GENERIC_FACT,
  Region: GENERIC_FACT,
  Country: GENERIC_FACT,
  Category: GENERIC_FACT,
  Product: GENERIC_FACT,
  Channel: GENERIC_FACT,
  Segment: GENERIC_FACT,
  Stage: GENERIC_PIPELINE
}

function found<T>(text: string, list: Array<[RegExp, T]>, except?: T): T[] {
  const out: T[] = []
  for (const [re, v] of list) if (v !== except && re.test(text) && !out.includes(v)) out.push(v)
  return out
}

const dimExpr = (d: Dim): SQExpr => columnExpr(DIM_TABLE[d], d)
const measureOf = (m: Measure): SQExpr => measureExpr(m === 'Opportunities' ? GENERIC_PIPELINE : GENERIC_FACT, m)

function projection(expr: SQExpr, active?: boolean): any {
  const queryRef = defaultQueryRef(expr)
  return { field: expr, queryRef, nativeQueryRef: queryRef.split('.').pop(), ...(active ? { active: true } : {}) }
}

const TIME_TYPES = new Set(['lineChart', 'areaChart', 'stackedAreaChart', 'hundredPercentStackedAreaChart', 'lineClusteredColumnComboChart', 'lineStackedColumnComboChart', 'ribbonChart', 'kpi'])
const STACKED = new Set(['columnChart', 'barChart', 'hundredPercentStackedColumnChart', 'hundredPercentStackedBarChart', 'stackedAreaChart', 'hundredPercentStackedAreaChart', 'ribbonChart'])

/**
 * The query an empty visual of `visualType` draws its generic sample with, or undefined when the type has none
 * (elements, custom visuals, AI visuals). `roles` are the visual's data role names; `hints` is text that names what the
 * visual is about (its title and subtitle).
 */
export function genericSampleQuery(visualType: string, roles: string[], hints = ''): any | undefined {
  const text = hints.toLowerCase()
  const has = (r: string) => roles.includes(r)
  const dims = found(text, DIM_WORDS)
  const measures = found(text, MEASURE_WORDS)
  const time = TIME_TYPES.has(visualType)
  const funnel = visualType === 'funnel' || dims.includes('Stage') || measures.includes('Opportunities')
  const pick = (fallback: Dim, avoid?: Dim): Dim => dims.find((d) => d !== avoid && d !== 'Stage' && d !== 'Month') ?? fallback
  const m1: Measure = funnel ? 'Opportunities' : (measures.find((m) => m !== 'Opportunities') ?? (dims.includes('Stage') ? 'Opportunities' : 'Sales'))
  const m2: Measure = measures.find((m) => m !== m1 && m !== 'Opportunities') ?? (m1 === 'Margin %' ? 'Sales' : m1 === 'Sales' ? 'Margin %' : 'Sales')
  const wells: Record<string, SQExpr[]> = {}
  let sort: { field: SQExpr; direction: 'Ascending' | 'Descending' } | undefined

  switch (visualType) {
    case 'lineChart':
    case 'areaChart':
    case 'stackedAreaChart':
    case 'hundredPercentStackedAreaChart':
    case 'ribbonChart': {
      wells.Category = [dimExpr(dims.includes('Quarter') ? 'Quarter' : 'Month')]
      wells.Y = [measureOf(m1)]
      const series = STACKED.has(visualType) ? pick('Channel') : dims.find((d) => d !== 'Month' && d !== 'Quarter' && d !== 'Stage')
      if (series) wells.Series = [dimExpr(series)]
      break
    }
    case 'lineClusteredColumnComboChart':
    case 'lineStackedColumnComboChart':
      wells.Category = [dimExpr(dims.includes('Quarter') ? 'Quarter' : dims.find((d) => d !== 'Month' && d !== 'Stage') ?? 'Month')]
      wells.Y = [measureOf(m1 === 'Margin %' ? 'Sales' : m1)]
      wells.Y2 = [measureOf(m1 === 'Margin %' || m2 === 'Margin %' ? 'Margin %' : m2)]
      break
    case 'clusteredColumnChart':
    case 'columnChart':
    case 'hundredPercentStackedColumnChart':
    case 'clusteredBarChart':
    case 'barChart':
    case 'hundredPercentStackedBarChart': {
      const bar = visualType.includes('Bar')
      const cat = funnel ? 'Stage' : dims.includes('Month') ? 'Month' : dims.includes('Quarter') ? 'Quarter' : pick(bar ? 'Product' : 'Category')
      wells.Category = [dimExpr(cat)]
      wells.Y = [measureOf(m1)]
      if (STACKED.has(visualType) && cat !== 'Stage') wells.Series = [dimExpr(pick(cat === 'Channel' ? 'Segment' : 'Channel', cat))]
      if (cat !== 'Month' && cat !== 'Quarter' && cat !== 'Stage') sort = { field: measureOf(m1), direction: 'Descending' }
      break
    }
    case 'pieChart':
    case 'donutChart':
      wells.Category = [dimExpr(funnel ? 'Stage' : pick('Region'))]
      wells.Y = [measureOf(m1 === 'Margin %' ? 'Sales' : m1)]
      break
    case 'funnel':
      wells.Category = [dimExpr('Stage')]
      wells.Y = [measureOf('Opportunities')]
      break
    case 'treemap':
      wells.Group = [dimExpr(pick('Category'))]
      wells.Values = [measureOf(m1 === 'Margin %' ? 'Sales' : m1)]
      break
    case 'waterfallChart':
      wells.Category = [dimExpr(dims.includes('Quarter') ? 'Quarter' : dims.find((d) => d !== 'Stage') ?? 'Month')]
      wells.Y = [measureOf(measures.length ? m1 : 'Variance')]
      break
    case 'scatterChart':
      wells.Category = [dimExpr(pick('Product'))]
      wells.X = [measureOf(m1 === 'Margin %' ? 'Sales' : m1)]
      wells.Y = [measureOf(m2 === m1 || m2 === 'Sales' ? 'Margin %' : m2)]
      wells.Size = [measureOf('Units Sold')]
      break
    case 'gauge':
      wells.Y = [measureOf(m1)]
      if (m1 === 'Sales') wells.TargetValue = [measureOf('Target')]
      break
    case 'kpi':
      wells.Indicator = [measureOf(m1)]
      wells.TrendLine = [dimExpr('Month')]
      if (m1 === 'Sales') wells.Goal = [measureOf('Target')]
      break
    case 'card':
      wells.Values = [measureOf(m1)]
      break
    case 'cardVisual':
      wells.Data = [measureOf(m1)]
      break
    case 'multiRowCard': {
      const list: Measure[] = [m1, ...(['Sales', 'Profit', 'Margin %', 'Orders'] as Measure[]).filter((x) => x !== m1)].slice(0, 4)
      wells.Values = list.map(measureOf)
      break
    }
    case 'tableEx': {
      const d = funnel ? 'Stage' : pick('Product')
      const list: Measure[] = funnel ? ['Opportunities'] : [m1, ...(['Sales', 'Orders', 'Margin %'] as Measure[]).filter((x) => x !== m1)].slice(0, 3)
      wells.Values = [dimExpr(d), ...list.map(measureOf)]
      if (!funnel) sort = { field: measureOf(list[0]), direction: 'Descending' }
      break
    }
    case 'pivotTable': {
      const rows = pick('Region')
      wells.Rows = [dimExpr(rows)]
      if (dims.includes('Month') || dims.includes('Quarter')) wells.Columns = [dimExpr(dims.includes('Quarter') ? 'Quarter' : 'Month')]
      else if (dims.length > 1) wells.Columns = [dimExpr(pick('Channel', rows))]
      wells.Values = wells.Columns ? [measureOf(m1)] : [measureOf(m1), measureOf(m2)]
      break
    }
    case 'slicer':
    case 'textSlicer':
    case 'advancedSlicerVisual':
      wells.Values = [dimExpr(dims[0] ?? 'Region')]
      break
    case 'listSlicer':
      wells.Field = [dimExpr(dims[0] ?? 'Region')]
      break
    case 'map':
    case 'azureMap':
      wells.Category = [dimExpr('Country')]
      wells.Size = [measureOf(m1 === 'Margin %' ? 'Sales' : m1)]
      break
    case 'filledMap':
    case 'shapeMap':
      wells.Category = [dimExpr('Country')]
      if (has('Values')) wells.Values = [measureOf(m1)]
      else wells.Tooltips = [measureOf(m1)]
      break
    default:
      return undefined
  }
  if (time && !wells.Category && !wells.TrendLine) return undefined
  const queryState: Record<string, any> = {}
  for (const [role, exprs] of Object.entries(wells)) {
    if (!has(role)) continue
    queryState[role] = { projections: exprs.map((e, i) => projection(e, (role === 'Category' || role === 'Rows') && i === 0)) }
  }
  if (!Object.keys(queryState).length) return undefined
  return { queryState, ...(sort ? { sortDefinition: { sort: [sort], isDefaultSort: true } } : {}) }
}
