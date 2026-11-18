/**
 * Row generator for the built-in sample project ("Sample - Sales"): a fictional bike & outdoor
 * retailer with stores in nine countries and an online shop.
 *
 * Everything is generated in code from a fixed seed (no I/O), so the sample is identical on every
 * run. The patterns are deliberately chart-friendly:
 *   - growth trend (~17 %/year in order volume) and a customer base that grows over time,
 *   - seasonality (spring/summer peak for bikes, holiday peak for clothing & accessories,
 *     a Black Friday promotion with deeper discounts — Margin % visibly dips in late November),
 *   - weekday pattern (weekends busier), online share growing every year,
 *   - category price ranges (bikes ~$750–4,000, accessories ~$6–400) and skewed popularity
 *     (cheap items sell more often; a few customers and products account for much of revenue),
 *   - costs rising faster than prices (gentle margin squeeze year over year),
 *   - new stores opening during the period.
 *
 * Values follow the DataStore contract (src/core/model/data.ts): dates are JS Dates whose UTC
 * fields carry the wall-clock date (makeDate); currency is a JS number rounded to cents.
 */
import type { DataType } from '../model/types'
import { makeDate, type Scalar } from '../model/data'
import { gaussian, mulberry32, pickOne, poisson, randInt, WeightedPicker, type Rng } from './sample-random'

export const SAMPLE_START_YEAR = 2023
export const SAMPLE_END_YEAR = 2025
const SEED = 20251117

export interface SampleTableRows {
  columns: Array<{ name: string; type: DataType }>
  rows: Scalar[][]
}

export interface SampleRows {
  Sales: SampleTableRows
  Date: SampleTableRows
  Product: SampleTableRows
  Customer: SampleTableRows
  Region: SampleTableRows
  Store: SampleTableRows
}

// ---------------------------------------------------------------------------------------------
// Reference data (all fictional)
// ---------------------------------------------------------------------------------------------

/** [RegionKey, Country, Region, Country Code, customer weight, cities] */
const COUNTRIES: Array<[number, string, string, string, number, string[]]> = [
  [1, 'United States', 'North America', 'US', 30, ['Seattle', 'Denver', 'Austin', 'Boston', 'Portland', 'Chicago']],
  [2, 'Canada', 'North America', 'CA', 10, ['Vancouver', 'Toronto', 'Calgary', 'Montreal']],
  [3, 'United Kingdom', 'Europe', 'GB', 12, ['London', 'Manchester', 'Bristol', 'Edinburgh']],
  [4, 'Germany', 'Europe', 'DE', 12, ['Berlin', 'Munich', 'Hamburg', 'Cologne']],
  [5, 'France', 'Europe', 'FR', 9, ['Paris', 'Lyon', 'Grenoble', 'Bordeaux']],
  [6, 'Netherlands', 'Europe', 'NL', 6, ['Amsterdam', 'Utrecht', 'Rotterdam']],
  [7, 'Australia', 'Asia Pacific', 'AU', 11, ['Sydney', 'Melbourne', 'Brisbane', 'Perth']],
  [8, 'New Zealand', 'Asia Pacific', 'NZ', 4, ['Auckland', 'Wellington', 'Christchurch']],
  [9, 'Japan', 'Asia Pacific', 'JP', 6, ['Tokyo', 'Osaka', 'Sapporo']]
]

/** [Store, Store Type, City, RegionKey, open date (y, m, d)] — StoreKey = index + 1. Key 1 is the online shop. */
const STORES: Array<[string, string, string | null, number | null, [number, number, number]]> = [
  ['Online Store', 'Online', null, null, [2019, 3, 1]],
  ['Seattle Flagship', 'Flagship', 'Seattle', 1, [2016, 4, 1]],
  ['Denver', 'Standard', 'Denver', 1, [2018, 6, 1]],
  ['Austin Outlet', 'Outlet', 'Austin', 1, [2020, 9, 1]],
  ['Boston', 'Standard', 'Boston', 1, [2024, 3, 15]],
  ['Vancouver', 'Standard', 'Vancouver', 2, [2017, 5, 1]],
  ['Toronto Outlet', 'Outlet', 'Toronto', 2, [2023, 9, 1]],
  ['London Flagship', 'Flagship', 'London', 3, [2015, 10, 1]],
  ['Manchester', 'Standard', 'Manchester', 3, [2024, 8, 1]],
  ['Berlin', 'Standard', 'Berlin', 4, [2019, 2, 1]],
  ['Munich Outlet', 'Outlet', 'Munich', 4, [2025, 4, 1]],
  ['Paris', 'Standard', 'Paris', 5, [2018, 3, 1]],
  ['Amsterdam', 'Standard', 'Amsterdam', 6, [2021, 5, 1]],
  ['Sydney Flagship', 'Flagship', 'Sydney', 7, [2017, 11, 1]],
  ['Melbourne', 'Standard', 'Melbourne', 7, [2023, 6, 1]],
  ['Auckland', 'Standard', 'Auckland', 8, [2020, 1, 15]],
  ['Tokyo', 'Standard', 'Tokyo', 9, [2022, 4, 1]]
]

/** [Category, Subcategory, model, list price, colors] — one product per color. */
const CATALOG: Array<[string, string, string, number, string[]]> = [
  ['Bikes', 'Mountain Bikes', 'Ridgeline 300', 1099, ['Black', 'Red']],
  ['Bikes', 'Mountain Bikes', 'Ridgeline 500', 1699, ['Black', 'Blue']],
  ['Bikes', 'Mountain Bikes', 'Ridgeline Pro', 2899, ['Black']],
  ['Bikes', 'Mountain Bikes', 'Trailhead 100', 749, ['Red', 'Silver']],
  ['Bikes', 'Road Bikes', 'Velocity 200', 1249, ['White', 'Red']],
  ['Bikes', 'Road Bikes', 'Velocity 600', 2199, ['Black', 'White']],
  ['Bikes', 'Road Bikes', 'Velocity Aero', 3499, ['Black']],
  ['Bikes', 'Touring Bikes', 'Wayfarer 1', 1149, ['Blue', 'Silver']],
  ['Bikes', 'Touring Bikes', 'Wayfarer 3', 1799, ['Silver']],
  ['Bikes', 'Electric Bikes', 'Volt City', 2299, ['White', 'Black']],
  ['Bikes', 'Electric Bikes', 'Volt Trail', 3999, ['Black']],
  ['Components', 'Wheels', 'Alloy Wheelset', 329, ['Black']],
  ['Components', 'Wheels', 'Carbon Wheelset', 1199, ['Black']],
  ['Components', 'Brakes', 'Hydraulic Disc Brakes', 189, ['Black']],
  ['Components', 'Brakes', 'Rim Brake Set', 69, ['Silver']],
  ['Components', 'Drivetrain', '12-Speed Groupset', 649, ['Silver']],
  ['Components', 'Drivetrain', 'Chain 11-Speed', 39, ['Silver']],
  ['Components', 'Drivetrain', 'Cassette 11-34', 89, ['Silver']],
  ['Components', 'Saddles', 'Comfort Saddle', 49, ['Black']],
  ['Components', 'Saddles', 'Race Saddle', 119, ['Black', 'White']],
  ['Components', 'Pedals', 'Clipless Pedals', 129, ['Black']],
  ['Components', 'Pedals', 'Flat Pedals', 59, ['Black', 'Red']],
  ['Clothing', 'Jerseys', 'Short-Sleeve Jersey', 69, ['Blue', 'Yellow', 'Black']],
  ['Clothing', 'Jerseys', 'Long-Sleeve Jersey', 89, ['Blue', 'Black']],
  ['Clothing', 'Shorts', 'Bib Shorts', 119, ['Black']],
  ['Clothing', 'Shorts', 'Trail Shorts', 79, ['Black', 'Green']],
  ['Clothing', 'Jackets', 'Rain Shell', 149, ['Yellow', 'Black']],
  ['Clothing', 'Jackets', 'Thermal Jacket', 199, ['Black']],
  ['Clothing', 'Gloves', 'Full-Finger Gloves', 35, ['Black']],
  ['Clothing', 'Gloves', 'Half-Finger Gloves', 25, ['Black', 'Red']],
  ['Clothing', 'Socks', 'Merino Socks', 18, ['Black', 'White']],
  ['Accessories', 'Helmets', 'Road Helmet', 139, ['White', 'Black']],
  ['Accessories', 'Helmets', 'Trail Helmet', 119, ['Green', 'Black']],
  ['Accessories', 'Helmets', 'Commuter Helmet', 69, ['Silver']],
  ['Accessories', 'Lights', 'Front Light 800', 59, ['Black']],
  ['Accessories', 'Lights', 'Rear Light', 29, ['Black']],
  ['Accessories', 'Bottles and Cages', 'Water Bottle', 9, ['Blue', 'White']],
  ['Accessories', 'Bottles and Cages', 'Bottle Cage', 15, ['Black']],
  ['Accessories', 'Locks', 'U-Lock', 54, ['Black']],
  ['Accessories', 'Locks', 'Cable Lock', 24, ['Black']],
  ['Accessories', 'Tires and Tubes', 'Trail Tire', 64, ['Black']],
  ['Accessories', 'Tires and Tubes', 'Road Tire', 54, ['Black']],
  ['Accessories', 'Tires and Tubes', 'Inner Tube', 9, ['NA']],
  ['Accessories', 'Tires and Tubes', 'Patch Kit', 6, ['NA']],
  ['Accessories', 'Bike Racks', 'Hitch Rack', 399, ['Black']],
  ['Accessories', 'Bike Racks', 'Wall Hook', 19, ['Black']]
]

/** Share of list price that is standard cost, per category. */
const COST_RATIO: Record<string, number> = { Bikes: 0.62, Components: 0.56, Clothing: 0.44, Accessories: 0.4 }

/** Monthly demand multipliers per category (Jan..Dec). */
const CATEGORY_SEASON: Record<string, number[]> = {
  Bikes: [0.55, 0.65, 0.95, 1.3, 1.45, 1.45, 1.35, 1.15, 0.95, 0.75, 0.85, 1.05],
  Components: [0.9, 0.9, 1.05, 1.15, 1.15, 1.1, 1.05, 1.0, 0.95, 0.9, 0.9, 0.95],
  Clothing: [1.05, 0.95, 0.95, 0.9, 0.9, 0.85, 0.85, 0.9, 1.0, 1.2, 1.35, 1.5],
  Accessories: [0.85, 0.85, 1.0, 1.1, 1.15, 1.15, 1.1, 1.05, 0.95, 0.95, 1.2, 1.45]
}

/** Overall order volume by month (Jan..Dec) and weekday (Mon..Sun). */
const MONTH_VOLUME = [0.72, 0.76, 0.95, 1.08, 1.2, 1.22, 1.16, 1.08, 0.98, 0.92, 1.08, 1.22]
const WEEKDAY_VOLUME = [0.88, 0.88, 0.93, 0.98, 1.06, 1.34, 1.15]

const FIRST_NAMES = [
  'Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie', 'Avery', 'Quinn', 'Rowan', 'Elena', 'Marco', 'Priya', 'Kenji',
  'Sofia', 'Liam', 'Noah', 'Emma', 'Olivia', 'Lucas', 'Mia', 'Hugo', 'Nina', 'Oscar', 'Clara', 'Felix', 'Ines', 'Theo', 'Maya',
  'Ivan', 'Leah', 'Samir', 'Anika', 'Daniel', 'Grace', 'Mateo', 'Hana', 'Erik', 'Zoe', 'Ruben', 'Freya', 'Tomas', 'Aiko', 'Lena'
]
const LAST_NAMES = [
  'Walker', 'Bennett', 'Hayes', 'Fischer', 'Moreau', 'Jansen', 'Tanaka', 'Novak', 'Silva', 'Brooks', 'Keller', 'Laurent', 'Patel',
  'Reed', 'Okafor', 'Lindqvist', 'Costa', 'Weber', 'Dubois', 'Bakker', 'Sato', 'Murphy', 'Schmidt', 'Rossi', 'Kowalski', 'Nguyen',
  'Andersen', 'Garcia', 'Hughes', 'Martin', 'Vogel', 'Petit', 'Visser', 'Ito', 'Campbell', 'Larsen', 'Moretti', 'Clarke', 'Hoffmann'
]
const COMPANY_A = ['Alpine', 'Blue Ridge', 'Cedar', 'Harbor', 'Summit', 'Riverside', 'Granite', 'Maple', 'Coastal', 'Prairie', 'Northfield', 'Redwood', 'Lakeside', 'Ironwood', 'Silver Creek', 'Highland', 'Westgate', 'Pinecrest', 'Stonebridge', 'Sunrise']
const COMPANY_B = ['Cycles', 'Outfitters', 'Sports', 'Trading', 'Adventures', 'Bike Works', 'Tours', 'Rentals', 'Couriers', 'Fitness', 'Supply', 'Mobility']
const COMPANY_C = ['', '', ' Co.', ' Group', ' Ltd', ' Inc']

const SEGMENTS: Array<[string, number, number]> = [
  // [segment, share of customers, purchase weight multiplier]
  ['Consumer', 0.62, 1],
  ['Small Business', 0.27, 1.7],
  ['Corporate', 0.11, 2.6]
]

const CUSTOMER_COUNT = 1400
const BASE_ORDERS_PER_DAY = 7.6
const ANNUAL_GROWTH = 1.17

const round2 = (x: number): number => Math.round(x * 100) / 100

// ---------------------------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------------------------

interface ProductInfo {
  key: number
  category: string
  subcategory: string
  name: string
  color: string
  listPrice: number
  stdCost: number
  popularity: number
}

function buildProducts(rng: Rng): ProductInfo[] {
  const out: ProductInfo[] = []
  for (const [category, subcategory, model, price, colors] of CATALOG) {
    colors.forEach((color, ci) => {
      const key = out.length + 1
      // Cheaper items sell more often; first color of a model is the best seller; a random
      // log-normal factor makes a few products clear winners.
      const popularity = Math.pow(price, -0.56) * (ci === 0 ? 1 : 0.55) * Math.exp(gaussian(rng) * 0.45)
      const stdCost = round2(price * COST_RATIO[category] * (0.94 + rng() * 0.12))
      out.push({ key, category, subcategory, name: colors.length > 1 ? `${model} - ${color}` : model, color, listPrice: price, stdCost, popularity })
    })
  }
  return out
}

interface CustomerInfo {
  key: number
  name: string
  segment: string
  city: string
  regionKey: number
  joinDay: number
  weight: number
}

function buildCustomers(rng: Rng, days: number): CustomerInfo[] {
  const countryPicker = new WeightedPicker(COUNTRIES.map((c) => c[4]))
  const segmentPicker = new WeightedPicker(SEGMENTS.map((s) => s[1]))
  const used = new Set<string>()
  const draft: Array<Omit<CustomerInfo, 'key'>> = []
  for (let i = 0; i < CUSTOMER_COUNT; i++) {
    const country = COUNTRIES[countryPicker.pick(rng)]
    const [segment, , segWeight] = SEGMENTS[segmentPicker.pick(rng)]
    let name = ''
    for (let attempt = 0; attempt < 50 && (!name || used.has(name)); attempt++) {
      name =
        segment === 'Consumer'
          ? `${pickOne(rng, FIRST_NAMES)} ${pickOne(rng, LAST_NAMES)}`
          : `${pickOne(rng, COMPANY_A)} ${pickOne(rng, COMPANY_B)}${attempt > 25 ? ` ${pickOne(rng, country[5])}` : pickOne(rng, COMPANY_C)}`
    }
    if (used.has(name)) name = `${name} ${i + 1}`
    used.add(name)
    // ~45 % existing customers at the start; the rest join over time, accelerating slightly.
    const joinDay = rng() < 0.45 ? 0 : Math.floor(Math.pow(rng(), 0.85) * (days - 30))
    const weight = Math.exp(gaussian(rng) * 0.85) * segWeight
    draft.push({ name, segment, city: pickOne(rng, country[5]), regionKey: country[0], joinDay, weight })
  }
  // Keys follow acquisition order (like an identity column); stable sort keeps ties deterministic.
  draft.sort((a, b) => a.joinDay - b.joinDay)
  return draft.map((c, i) => ({ ...c, key: i + 1 }))
}

// ---------------------------------------------------------------------------------------------
// Date table
// ---------------------------------------------------------------------------------------------

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** Monday-based weekday index 0..6 of a makeDate() value. */
function weekdayMon0(d: Date): number {
  return (d.getUTCDay() + 6) % 7
}

/** Week of year with weeks starting Monday and week 1 containing January 1 (DAX WEEKNUM(d, 2) / M Date.WeekOfYear(d, Day.Monday)). */
export function weekOfYearMonday(d: Date): number {
  const jan1 = makeDate(d.getUTCFullYear(), 1, 1)
  const dayOfYear = Math.round((d.getTime() - jan1.getTime()) / 86_400_000)
  return Math.floor((dayOfYear + weekdayMon0(jan1)) / 7) + 1
}

function buildDateRows(): SampleTableRows {
  const columns: SampleTableRows['columns'] = [
    { name: 'Date', type: 'dateTime' },
    { name: 'Year', type: 'int64' },
    { name: 'Quarter', type: 'string' },
    { name: 'Month Number', type: 'int64' },
    { name: 'Month', type: 'string' },
    { name: 'Month Short', type: 'string' },
    { name: 'Year Month', type: 'string' },
    { name: 'Year Month Number', type: 'int64' },
    { name: 'Week of Year', type: 'int64' },
    { name: 'Day of Week', type: 'string' },
    { name: 'Day of Week Number', type: 'int64' },
    { name: 'Is Weekend', type: 'boolean' }
  ]
  const rows: Scalar[][] = []
  const end = makeDate(SAMPLE_END_YEAR, 12, 31).getTime()
  for (let i = 0; ; i++) {
    const d = makeDate(SAMPLE_START_YEAR, 1, 1 + i)
    if (d.getTime() > end) break
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth() + 1
    const wd = weekdayMon0(d)
    const short = MONTH_NAMES[m - 1].slice(0, 3)
    rows.push([d, y, `Q${Math.floor((m - 1) / 3) + 1}`, m, MONTH_NAMES[m - 1], short, `${short} ${y}`, y * 100 + m, weekOfYearMonday(d), DAY_NAMES[wd], wd + 1, wd >= 5])
  }
  return { columns, rows }
}

// ---------------------------------------------------------------------------------------------
// Sales fact
// ---------------------------------------------------------------------------------------------

function buildSales(rng: Rng, products: ProductInfo[], customers: CustomerInfo[], dayCount: number): SampleTableRows {
  const columns: SampleTableRows['columns'] = [
    { name: 'OrderNumber', type: 'string' },
    { name: 'OrderLine', type: 'int64' },
    { name: 'OrderDate', type: 'dateTime' },
    { name: 'ProductKey', type: 'int64' },
    { name: 'CustomerKey', type: 'int64' },
    { name: 'StoreKey', type: 'int64' },
    { name: 'Channel', type: 'string' },
    { name: 'Quantity', type: 'int64' },
    { name: 'UnitPrice', type: 'decimal' },
    { name: 'Discount', type: 'decimal' },
    { name: 'SalesAmount', type: 'decimal' },
    { name: 'Cost', type: 'decimal' }
  ]
  const rows: Scalar[][] = []

  // One product picker per month: popularity x category seasonality.
  const monthPickers = Array.from({ length: 12 }, (_, m) => new WeightedPicker(products.map((p) => p.popularity * CATEGORY_SEASON[p.category][m])))
  const customerPicker = new WeightedPicker(customers.map((c) => c.weight))
  const storeOpen = STORES.map((s) => makeDate(s[4][0], s[4][1], s[4][2]).getTime())
  const linesPicker: Record<string, WeightedPicker> = {
    Consumer: new WeightedPicker([52, 28, 13, 7]),
    'Small Business': new WeightedPicker([40, 30, 18, 12]),
    Corporate: new WeightedPicker([30, 30, 22, 18])
  }

  let orderSeq = 43000
  let joined = 0
  for (let day = 0; day < dayCount; day++) {
    const date = makeDate(SAMPLE_START_YEAR, 1, 1 + day)
    const y = date.getUTCFullYear()
    const m = date.getUTCMonth()
    const dom = date.getUTCDate()
    const yearIdx = y - SAMPLE_START_YEAR
    const blackFriday = m === 10 && dom >= 22 && dom <= 30
    const holidayRush = m === 11 && dom >= 8 && dom <= 22
    while (joined < customers.length && customers[joined].joinDay <= day) joined++

    const lambda =
      BASE_ORDERS_PER_DAY * Math.pow(ANNUAL_GROWTH, day / 365.25) * MONTH_VOLUME[m] * WEEKDAY_VOLUME[weekdayMon0(date)] * (blackFriday ? 1.9 : holidayRush ? 1.3 : 1)
    const orders = poisson(rng, lambda)
    for (let o = 0; o < orders; o++) {
      const customer = customers[customerPicker.pick(rng, Math.max(1, joined))]
      const onlineShare = 0.27 + 0.07 * yearIdx + (customer.segment === 'Consumer' ? 0.06 : -0.04) + (customer.regionKey === 9 || customer.regionKey === 8 ? 0.08 : 0)
      let storeKey = 1
      if (rng() >= onlineShare) {
        const candidates: number[] = []
        STORES.forEach((s, i) => {
          if (s[3] === customer.regionKey && storeOpen[i] <= date.getTime()) candidates.push(i + 1)
        })
        if (candidates.length) storeKey = candidates[Math.floor(rng() * candidates.length)]
      }
      const channel = storeKey === 1 ? 'Online' : 'Store'
      const orderNumber = `SO${++orderSeq}`
      const lineCount = linesPicker[customer.segment].pick(rng) + 1
      const chosen = new Set<number>()
      for (let line = 0; line < lineCount; line++) {
        let pi = monthPickers[m].pick(rng)
        for (let retry = 0; retry < 4 && chosen.has(pi); retry++) pi = monthPickers[m].pick(rng)
        if (chosen.has(pi)) continue
        chosen.add(pi)
        const p = products[pi]

        let qty: number
        if (p.category === 'Bikes') qty = rng() < 0.92 ? 1 : 2
        else if (p.category === 'Components') qty = randInt(rng, 1, 2)
        else if (p.category === 'Clothing') qty = randInt(rng, 1, 3)
        else qty = randInt(rng, 1, 4)
        if (customer.segment === 'Corporate') qty *= randInt(rng, 1, 3)
        else if (customer.segment === 'Small Business' && rng() < 0.3) qty *= 2

        // Prices rise ~3 %/year (list price is the current one); costs rise ~4.5 %/year.
        const unitPrice = round2(p.listPrice / Math.pow(1.03, SAMPLE_END_YEAR - y))
        const unitCost = p.stdCost / Math.pow(1.045, SAMPLE_END_YEAR - y)

        let discountPct = 0
        const r = rng()
        if (blackFriday) discountPct = r < 0.7 ? [0.15, 0.2, 0.25][randInt(rng, 0, 2)] : 0
        else if (customer.segment === 'Corporate') discountPct = r < 0.55 ? 0.08 : 0
        else if (r < 0.11) discountPct = [0.05, 0.1, 0.15][randInt(rng, 0, 2)]

        const gross = qty * unitPrice
        const discount = round2(gross * discountPct)
        rows.push([orderNumber, line + 1, date, p.key, customer.key, storeKey, channel, qty, unitPrice, discount, round2(gross - discount), round2(qty * unitCost)])
      }
    }
  }
  return { columns, rows }
}

// ---------------------------------------------------------------------------------------------

/** Generate every table of the sample model (deterministic). */
export function generateSampleRows(): SampleRows {
  const rng = mulberry32(SEED)
  const date = buildDateRows()
  const products = buildProducts(mulberry32(SEED + 1))
  const customers = buildCustomers(mulberry32(SEED + 2), date.rows.length)
  const sales = buildSales(rng, products, customers, date.rows.length)

  const product: SampleTableRows = {
    columns: [
      { name: 'ProductKey', type: 'int64' },
      { name: 'Product', type: 'string' },
      { name: 'Subcategory', type: 'string' },
      { name: 'Category', type: 'string' },
      { name: 'Color', type: 'string' },
      { name: 'List Price', type: 'decimal' },
      { name: 'Standard Cost', type: 'decimal' }
    ],
    rows: products.map((p) => [p.key, p.name, p.subcategory, p.category, p.color, p.listPrice, p.stdCost])
  }
  const customer: SampleTableRows = {
    columns: [
      { name: 'CustomerKey', type: 'int64' },
      { name: 'Customer', type: 'string' },
      { name: 'Segment', type: 'string' },
      { name: 'City', type: 'string' },
      { name: 'RegionKey', type: 'int64' }
    ],
    rows: customers.map((c) => [c.key, c.name, c.segment, c.city, c.regionKey])
  }
  const region: SampleTableRows = {
    columns: [
      { name: 'RegionKey', type: 'int64' },
      { name: 'Country', type: 'string' },
      { name: 'Region', type: 'string' },
      { name: 'Country Code', type: 'string' }
    ],
    rows: COUNTRIES.map((c) => [c[0], c[1], c[2], c[3]])
  }
  const store: SampleTableRows = {
    columns: [
      { name: 'StoreKey', type: 'int64' },
      { name: 'Store', type: 'string' },
      { name: 'Store Type', type: 'string' },
      { name: 'City', type: 'string' },
      { name: 'Country', type: 'string' },
      { name: 'Open Date', type: 'dateTime' }
    ],
    rows: STORES.map((s, i) => [i + 1, s[0], s[1], s[2], s[3] === null ? null : COUNTRIES[s[3] - 1][1], makeDate(s[4][0], s[4][1], s[4][2])])
  }
  return { Sales: sales, Date: date, Product: product, Customer: customer, Region: region, Store: store }
}
