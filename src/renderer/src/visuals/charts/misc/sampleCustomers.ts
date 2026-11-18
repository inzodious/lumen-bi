/**
 * Row-level sample for the key influencers gallery entries and tests (neutral, generated): one row per
 * customer of a subscription business, with planted effects so the analysis has known answers:
 *   churn ↑ with a Monthly contract, short tenure and many support tickets; ↓ with Premium plans;
 *   monthly charges ↑ with the plan tier and in the Pacific region.
 */
import type { ColumnDef, DataType, SemanticModel, TableDef } from '@core/model/types'
import { tableFromRows, type DataStore, type Scalar } from '@core/model/data'
import type { QueryEngine } from '@core/engine/api'
import { createEngine } from '@core/engine/engine'

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

const REGIONS = ['North', 'South', 'East', 'West', 'Pacific']
const PLANS: Array<[string, number]> = [
  ['Basic', 30],
  ['Standard', 60],
  ['Premium', 95]
]
const CONTRACTS = ['Monthly', 'One year', 'Two year']

function col(name: string, dataType: DataType, extra: Partial<ColumnDef> = {}): ColumnDef {
  return { name, dataType, kind: 'data', sourceColumn: name, ...extra }
}

export const CUSTOMER_ROWS = 1800

export function buildCustomerModel(): { model: SemanticModel; data: DataStore } {
  const r = rng(7)
  const rows: Scalar[][] = []
  for (let id = 1; id <= CUSTOMER_ROWS; id++) {
    const region = REGIONS[Math.floor(r() * REGIONS.length)]
    const pr = r()
    const [plan, price] = PLANS[pr < 0.45 ? 0 : pr < 0.8 ? 1 : 2]
    const cr = r()
    const contract = CONTRACTS[cr < 0.5 ? 0 : cr < 0.78 ? 1 : 2]
    const tenure = Math.max(1, Math.round(contract === 'Monthly' ? 2 + r() * 40 : 6 + r() * 66))
    const tickets = Math.min(9, Math.floor(-Math.log(1 - r() * 0.999) * 1.6))
    const charges = Math.round((price * (0.85 + r() * 0.3) + (region === 'Pacific' ? 8 : 0) + tickets * 1.5) * 100) / 100
    let p = 0.06
    if (contract === 'Monthly') p += 0.22
    if (tenure < 12) p += 0.12
    if (tickets >= 4) p += 0.18
    if (plan === 'Premium') p -= 0.04
    const churned = r() < p ? 'Yes' : 'No'
    rows.push([id, region, plan, contract, tenure, tickets, charges, churned])
  }
  const cols: ColumnDef[] = [
    col('Customer ID', 'int64', { summarizeBy: 'none' }),
    col('Region', 'string'),
    col('Plan', 'string'),
    col('Contract', 'string'),
    col('Tenure', 'int64', { formatString: '0', summarizeBy: 'sum' }),
    col('Support Tickets', 'int64', { formatString: '0', summarizeBy: 'sum' }),
    col('Monthly Charges', 'double', { formatString: '\\$#,0.00', summarizeBy: 'sum' }),
    col('Churned', 'string')
  ]
  const customers: TableDef = {
    name: 'Customers',
    columns: cols,
    measures: [
      { name: 'Customer Count', expression: 'COUNTROWS ( Customers )', formatString: '#,0' },
      { name: 'Avg Monthly Charges', expression: 'AVERAGE ( Customers[Monthly Charges] )', formatString: '\\$#,0.00' }
    ],
    hierarchies: [],
    partitions: [{ name: 'Customers', sourceType: 'unknown' }]
  }
  const model: SemanticModel = { name: 'Customers sample', culture: 'en-US', tables: [customers], relationships: [], expressions: [], roles: [] }
  const data: DataStore = { tables: new Map(), status: new Map() }
  data.tables.set(
    'Customers',
    tableFromRows(
      cols.map((c) => c.name),
      cols.map((c) => c.dataType),
      rows
    )
  )
  data.status.set('Customers', { state: 'loaded', source: 'synthetic', rowCount: rows.length })
  return { model, data }
}

let cached: QueryEngine | undefined

/** Shared engine over the customers sample (built lazily). */
export function customerEngine(): QueryEngine {
  if (!cached) {
    const { model, data } = buildCustomerModel()
    cached = createEngine(model, data)
    cached.processCalculated()
  }
  return cached
}
