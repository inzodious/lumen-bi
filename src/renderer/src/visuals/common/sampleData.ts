/**
 * Deterministic sample dataset ("Sales") for unit tests and the dev gallery of the non-chart
 * visuals. Fact table `Sales` with geography / product / calendar attributes and measures in `_m`.
 */
import type { Scalar } from '@core/model/data'
import { columnExpr, measureExpr, aggregationExpr, type SQExpr } from '@core/report/sq'
import { createMemoryEngine, type MemoryMeasure } from './memoryEngine'
import type { QueryEngine } from '@core/engine/api'

type Row = Record<string, Scalar>

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const GEO: Array<[string, string[]]> = [
  ['North America', ['United States', 'Canada', 'Mexico']],
  ['Europe', ['Germany', 'France', 'United Kingdom', 'Spain']],
  ['Asia Pacific', ['Japan', 'Australia', 'India']]
]
const PRODUCTS: Array<[string, string, string[]]> = [
  ['Bikes', 'Mountain', ['Summit 500', 'Ridge 300']],
  ['Bikes', 'Road', ['Velo 900', 'Aero 700']],
  ['Accessories', 'Helmets', ['Shield Pro', 'Urban Lite']],
  ['Accessories', 'Lights', ['Beam 2000']],
  ['Clothing', 'Jerseys', ['Classic Jersey', 'Team Jersey']]
]
const SEGMENTS = ['Consumer', 'Corporate', 'Small Business']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function sampleRows(count = 2400, seed = 7): Row[] {
  const r = rng(seed)
  const rows: Row[] = []
  for (let i = 0; i < count; i++) {
    const [region, countries] = GEO[Math.floor(r() * GEO.length)]
    const country = countries[Math.floor(r() * countries.length)]
    const [category, subcategory, products] = PRODUCTS[Math.floor(r() * PRODUCTS.length)]
    const product = products[Math.floor(r() * products.length)]
    const year = 2023 + Math.floor(r() * 2)
    const month = 1 + Math.floor(r() * 12)
    const day = 1 + Math.floor(r() * 28)
    const base = category === 'Bikes' ? 900 : category === 'Clothing' ? 60 : 35
    const qty = 1 + Math.floor(r() * 5)
    const amount = Math.round(base * qty * (0.7 + r() * 0.6) * 100) / 100
    rows.push({
      OrderId: 10000 + i,
      Region: region,
      Country: country,
      Category: category,
      Subcategory: subcategory,
      Product: product,
      Segment: SEGMENTS[Math.floor(r() * SEGMENTS.length)],
      Date: new Date(Date.UTC(year, month - 1, day)),
      Year: year,
      Quarter: `Qtr ${Math.ceil(month / 3)}`,
      Month: MONTH_NAMES[month - 1],
      MonthNo: month,
      Quantity: qty,
      Amount: amount,
      Cost: Math.round(amount * (0.55 + r() * 0.3) * 100) / 100,
      ProductUrl: `https://example.com/products/${encodeURIComponent(product)}`,
      // ImageUrl data category sample (inline SVG so galleries/tests work offline)
      ProductImage: productImage(category)
    })
  }
  return rows
}

const CATEGORY_COLORS: Record<string, string> = { Bikes: '#118DFF', Accessories: '#E66C37', Clothing: '#6B007B' }
function productImage(category: string): string {
  const c = CATEGORY_COLORS[category] ?? '#605E5C'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" rx="6" fill="${c}"/><text x="20" y="26" font-family="Segoe UI,sans-serif" font-size="16" fill="#fff" text-anchor="middle">${category[0]}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function sum(rows: Row[], col: string): number | null {
  let s = 0
  let any = false
  for (const r of rows) {
    const v = r[col]
    if (typeof v === 'number') {
      s += v
      any = true
    }
  }
  return any ? s : null
}

export const SAMPLE_MEASURES: MemoryMeasure[] = [
  { table: '_m', name: 'Total Sales', formatString: '\\$#,0;(\\$#,0);\\$#,0', fn: (rows) => sum(rows, 'Amount') },
  { table: '_m', name: 'Total Cost', formatString: '\\$#,0', fn: (rows) => sum(rows, 'Cost') },
  { table: '_m', name: 'Orders', formatString: '#,0', fn: (rows) => (rows.length ? rows.length : null) },
  { table: '_m', name: 'Units', formatString: '#,0', fn: (rows) => sum(rows, 'Quantity') },
  {
    table: '_m',
    name: 'Margin %',
    formatString: '0.0%',
    fn: (rows) => {
      const s = sum(rows, 'Amount')
      const c = sum(rows, 'Cost')
      return s ? (s - (c ?? 0)) / s : null
    }
  },
  {
    table: '_m',
    name: 'Sales vs LY %',
    formatString: '+0.0%;-0.0%;0.0%',
    fn: (rows) => {
      const cy = sum(rows.filter((r) => r.Year === 2024), 'Amount') ?? 0
      const ly = sum(rows.filter((r) => r.Year === 2023), 'Amount') ?? 0
      return ly ? (cy - ly) / ly : null
    }
  },
  {
    table: '_m',
    name: 'Margin Color',
    dataType: 'string',
    fn: (rows) => {
      const s = sum(rows, 'Amount')
      const c = sum(rows, 'Cost')
      if (!s) return null
      const m = (s - (c ?? 0)) / s
      return m >= 0.3 ? '#1AAB40' : m >= 0.25 ? '#D9B300' : '#D64554'
    }
  },
  {
    table: '_m',
    name: 'Sales Html',
    dataType: 'string',
    fn: (rows) => {
      const s = sum(rows, 'Amount') ?? 0
      const pct = Math.min(100, Math.round((s / 1_400_000) * 100))
      return (
        `<div style="font-family:Segoe UI;padding:6px">` +
        `<div style="font-size:12px;color:#605E5C">Sales to target</div>` +
        `<div style="font-size:22px;font-weight:600;color:#252423">$${(s / 1e6).toFixed(2)}M <span style="font-size:12px;color:#1AAB40">▲ ${pct}%</span></div>` +
        `<div style="height:6px;background:#E1DFDD;border-radius:3px;margin-top:6px"><div style="width:${pct}%;height:6px;background:#118DFF;border-radius:3px"></div></div>` +
        `</div>`
      )
    }
  }
]

export function createSampleEngine(rows: Row[] = sampleRows()): QueryEngine {
  return createMemoryEngine({
    factTable: 'Sales',
    fact: rows,
    measures: SAMPLE_MEASURES,
    columns: {
      'Sales.Month': { sortBy: 'MonthNo' },
      'Sales.Amount': { formatString: '\\$#,0.00', dataType: 'decimal' },
      'Sales.Cost': { formatString: '\\$#,0.00', dataType: 'decimal' },
      'Sales.Date': { formatString: 'M/d/yyyy', dataType: 'dateTime' },
      'Sales.Year': { formatString: '0', dataType: 'int64' },
      'Sales.ProductUrl': { dataCategory: 'WebUrl' },
      'Sales.ProductImage': { dataCategory: 'ImageUrl' }
    }
  })
}

/** SQ helpers for building gallery/test visual JSON against the sample model. */
export const S = {
  col: (c: string): SQExpr => columnExpr('Sales', c),
  m: (name: string): SQExpr => measureExpr('_m', name),
  sum: (c: string): SQExpr => aggregationExpr('Sales', c, 0)
}

/** Build a projection entry (queryState) for the sample model. */
export function proj(field: SQExpr, queryRef: string, extra: Record<string, unknown> = {}): any {
  return { field, queryRef, nativeQueryRef: queryRef.split('.').pop(), ...extra }
}
