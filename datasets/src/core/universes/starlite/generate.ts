/**
 * Starlite Coffee Co. — simulation.
 *
 * Day by day per store: weather → expected traffic (format × weekday × season × growth × weather ×
 * promotions × events) → Poisson transactions with hourly profiles → baskets chosen by day part and
 * temperature → line amounts (yearly price increases, promotions, rewards) → ingredient usage via
 * recipes → stock, waste, weekly purchase orders with supplier lead times → labor, surveys, door counts.
 *
 * Volumes: `small` simulates a 1-in-30 slice of real traffic (labor and stock follow, so ratios stay
 * realistic); `large` is full volume. Lossy bronze issues (sentinels, blanks) are decided first and
 * silver/gold are derived from what a cleaning pipeline could recover.
 */
import type { Scalar } from '../../../../../src/core/model/data.ts'
import {
  addDays, annualCycle, dateKey, dateOnly, daysBetween, endOfMonth, eachDay, isoDow, isoDate, maxDate, minDate, monthKey, startOfMonth, timeKey, ymd
} from '../../calendar.ts'
import {
  formatDate, injectCasing, injectDateFormats, injectDuplicates, injectFormattedNumbers, injectOutliers, injectWhitespace, landingDay
} from '../../chaos.ts'
import { clamp, round, weightedPicker, zipfWeights } from '../../prng.ts'
import type { Rng } from '../../prng.ts'
import { Scd2Index, scd2Rows } from '../../scd2.ts'
import type { Scd2Entity, Scd2Version } from '../../scd2.ts'
import type { Batch, BronzeFile, BronzeRow, GenContext, Row } from '../../schema.ts'
import { personName, placeNames, email } from '../../words.ts'

// ---------------------------------------------------------------------------------------------
// Static reference data

type Temp = 'Hot' | 'Cold' | 'Food' | 'Merch'
type Category = 'Coffee' | 'Tea & Matcha' | 'Cold Drinks' | 'Bakery' | 'Diner Plates' | 'Merch'

interface ProductDef {
  sku: string
  name: string
  category: Category
  sub: string
  temp: Temp
  price: number
  costRatio: number
  caffeine: number
  months?: number[]
  launchFrac?: number
  recipe: Array<[string, number]>
}

const P = (sku: number, name: string, category: Category, sub: string, temp: Temp, price: number, costRatio: number, caffeine: number, recipe: Array<[string, number]>, extra: Partial<ProductDef> = {}): ProductDef => ({
  sku: `SKU-${sku}`, name, category, sub, temp, price, costRatio, caffeine, recipe, ...extra
})

const CUP: [string, number] = ['ING-023', 1]

const PRODUCTS: ProductDef[] = [
  P(1001, 'Supernova Latte', 'Coffee', 'Espresso Drinks', 'Hot', 5.25, 0.24, 130, [['ING-001', 0.018], ['ING-007', 0.25], CUP]),
  P(1002, 'Milky Way Mocha', 'Coffee', 'Espresso Drinks', 'Hot', 5.75, 0.27, 140, [['ING-001', 0.018], ['ING-007', 0.22], ['ING-012', 0.03], CUP]),
  P(1003, 'Caramel Comet Macchiato', 'Coffee', 'Espresso Drinks', 'Hot', 5.65, 0.27, 130, [['ING-001', 0.018], ['ING-007', 0.22], ['ING-011', 0.03], CUP]),
  P(1004, 'Cappuccino Corona', 'Coffee', 'Espresso Drinks', 'Hot', 4.95, 0.22, 130, [['ING-001', 0.018], ['ING-007', 0.18], CUP]),
  P(1005, 'Flat White Dwarf', 'Coffee', 'Espresso Drinks', 'Hot', 4.85, 0.23, 195, [['ING-001', 0.027], ['ING-007', 0.15], CUP]),
  P(1006, 'Big Bang Americano', 'Coffee', 'Espresso Drinks', 'Hot', 3.75, 0.16, 225, [['ING-001', 0.027], CUP]),
  P(1007, 'Event Horizon Espresso', 'Coffee', 'Espresso Drinks', 'Hot', 2.95, 0.14, 130, [['ING-001', 0.018], CUP]),
  P(1008, 'Starlite House Drip', 'Coffee', 'Brewed Coffee', 'Hot', 2.95, 0.15, 180, [['ING-001', 0.02], CUP]),
  P(1009, 'Dark Matter Roast', 'Coffee', 'Brewed Coffee', 'Hot', 3.25, 0.16, 200, [['ING-001', 0.022], CUP]),
  P(1010, 'Decaf Daydream', 'Coffee', 'Brewed Coffee', 'Hot', 2.95, 0.17, 5, [['ING-002', 0.02], CUP]),
  P(1011, 'Pumpkin Nebula Latte', 'Coffee', 'Seasonal', 'Hot', 6.15, 0.27, 130, [['ING-001', 0.018], ['ING-007', 0.25], ['ING-010', 0.04], CUP], { months: [9, 10, 11] }),
  P(1012, 'Peppermint Pulsar Mocha', 'Coffee', 'Seasonal', 'Hot', 6.25, 0.28, 140, [['ING-001', 0.018], ['ING-007', 0.22], ['ING-012', 0.04], CUP], { months: [11, 12] }),
  P(2001, 'Black Hole Cold Brew', 'Cold Drinks', 'Cold Coffee', 'Cold', 4.75, 0.2, 205, [['ING-003', 0.18], CUP]),
  P(2002, 'Nitro Nebula', 'Cold Drinks', 'Cold Coffee', 'Cold', 5.25, 0.2, 265, [['ING-003', 0.2], CUP], { launchFrac: 0.4 }),
  P(2003, 'Iced Orbit Latte', 'Cold Drinks', 'Cold Coffee', 'Cold', 5.25, 0.24, 130, [['ING-001', 0.018], ['ING-007', 0.22], CUP]),
  P(2004, 'Frappé Galactica', 'Cold Drinks', 'Blended', 'Cold', 6.25, 0.3, 95, [['ING-001', 0.012], ['ING-007', 0.2], ['ING-009', 0.05], ['ING-011', 0.03], CUP]),
  P(2005, 'Lunar Lemonade', 'Cold Drinks', 'Refreshers', 'Cold', 3.95, 0.18, 0, [['ING-013', 0.3], CUP]),
  P(2006, 'Meteor Berry Refresher', 'Cold Drinks', 'Refreshers', 'Cold', 4.45, 0.22, 45, [['ING-013', 0.2], ['ING-014', 0.05], CUP]),
  P(2007, 'Solar Flare Iced Tea', 'Cold Drinks', 'Refreshers', 'Cold', 3.45, 0.15, 30, [['ING-006', 0.004], CUP]),
  P(2008, 'Summer Solstice Spritz', 'Cold Drinks', 'Refreshers', 'Cold', 4.95, 0.21, 0, [['ING-013', 0.2], ['ING-014', 0.06], CUP], { months: [6, 7, 8] }),
  P(3001, 'Comet Tail Chai', 'Tea & Matcha', 'Tea Lattes', 'Hot', 4.75, 0.24, 70, [['ING-004', 0.12], ['ING-007', 0.15], CUP]),
  P(3002, 'Earl Grey Gravity', 'Tea & Matcha', 'Hot Tea', 'Hot', 3.45, 0.12, 40, [['ING-006', 0.004], CUP]),
  P(3003, 'Moonbeam Chamomile', 'Tea & Matcha', 'Hot Tea', 'Hot', 3.25, 0.12, 0, [['ING-006', 0.004], CUP]),
  P(3004, 'Nebula Matcha Latte', 'Tea & Matcha', 'Matcha', 'Hot', 5.45, 0.3, 80, [['ING-005', 0.004], ['ING-008', 0.25], CUP]),
  P(3005, 'Iced Aurora Matcha', 'Tea & Matcha', 'Matcha', 'Cold', 5.65, 0.3, 80, [['ING-005', 0.004], ['ING-008', 0.22], CUP]),
  P(4001, 'Asteroid Cookie', 'Bakery', 'Cookies & Donuts', 'Food', 2.75, 0.3, 0, [['ING-016', 0.07]]),
  P(4002, 'Space Dust Donut', 'Bakery', 'Cookies & Donuts', 'Food', 2.45, 0.28, 0, [['ING-015', 0.08]]),
  P(4003, 'Crescent Moon Croissant', 'Bakery', 'Pastries', 'Food', 3.45, 0.3, 0, [['ING-015', 0.09]]),
  P(4004, 'Blast-Off Blueberry Muffin', 'Bakery', 'Pastries', 'Food', 3.25, 0.3, 0, [['ING-015', 0.1], ['ING-014', 0.02]]),
  P(4005, 'Cinnamon Swirl Galaxy', 'Bakery', 'Pastries', 'Food', 3.95, 0.3, 0, [['ING-015', 0.12]]),
  P(4006, 'Orbit Bagel', 'Bakery', 'Bagels', 'Food', 2.95, 0.25, 0, [['ING-017', 1]]),
  P(4007, 'Everything Universe Bagel', 'Bakery', 'Bagels', 'Food', 3.25, 0.25, 0, [['ING-017', 1]]),
  P(5001, 'Galaxy Pancake Stack', 'Diner Plates', 'Breakfast', 'Food', 9.95, 0.26, 0, [['ING-019', 0.25], ['ING-018', 1]]),
  P(5002, 'Meteor Hash Browns', 'Diner Plates', 'Breakfast', 'Food', 4.25, 0.22, 0, [['ING-021', 0.2]]),
  P(5003, 'Sunrise Over Mars Skillet', 'Diner Plates', 'Breakfast', 'Food', 12.5, 0.3, 0, [['ING-021', 0.25], ['ING-018', 3]]),
  P(5004, 'Eggs Eclipse', 'Diner Plates', 'Breakfast', 'Food', 10.75, 0.28, 0, [['ING-018', 2], ['ING-015', 0.05]]),
  P(5005, 'Red Giant Burger', 'Diner Plates', 'Lunch & Dinner', 'Food', 13.95, 0.33, 0, [['ING-020', 1], ['ING-022', 1], ['ING-021', 0.2]]),
  P(5006, 'Saturn Rings', 'Diner Plates', 'Lunch & Dinner', 'Food', 5.95, 0.24, 0, [['ING-021', 0.18]]),
  P(5007, 'Rocket Fuel Chili', 'Diner Plates', 'Lunch & Dinner', 'Food', 8.95, 0.3, 0, [['ING-020', 0.5]]),
  P(5008, 'Cosmic Club Sandwich', 'Diner Plates', 'Lunch & Dinner', 'Food', 11.5, 0.32, 0, [['ING-022', 1], ['ING-018', 1]]),
  P(5009, 'Milky Way Shake', 'Diner Plates', 'Shakes', 'Cold', 6.5, 0.3, 0, [['ING-007', 0.3], ['ING-009', 0.1], CUP]),
  P(6001, 'Starlite Tumbler', 'Merch', 'Drinkware', 'Merch', 24, 0.35, 0, [['ING-024', 1]]),
  P(6002, 'Constellation Mug', 'Merch', 'Drinkware', 'Merch', 18, 0.35, 0, [['ING-024', 1]]),
  P(6003, 'Orbit Beans 1 lb Bag', 'Merch', 'Whole Bean', 'Merch', 16.5, 0.4, 0, [['ING-001', 0.454]])
]

/** Open-ring / test SKUs that exist on the tills but not in the menu master (orphan keys). */
const ORPHAN_SKUS = [
  { sku: 'SKU-9001', name: 'OPEN RING FOOD', price: 4.0 },
  { sku: 'SKU-9002', name: 'OPEN RING DRINK', price: 3.0 },
  { sku: 'SKU-0000', name: 'TEST ITEM', price: 0.01 }
]

interface IngredientDef {
  code: string
  name: string
  category: string
  unit: string
  cost: number
  pack: number
  shelf: number
  supplier: string
}

const I = (n: number, name: string, category: string, unit: string, cost: number, pack: number, shelf: number, supplier: number): IngredientDef => ({
  code: `ING-${String(n).padStart(3, '0')}`, name, category, unit, cost, pack, shelf, supplier: `SUP-0${supplier}`
})

const INGREDIENTS: IngredientDef[] = [
  I(1, 'Espresso Beans', 'Coffee & Tea', 'kg', 18.5, 5, 120, 1),
  I(2, 'Decaf Beans', 'Coffee & Tea', 'kg', 20, 2, 120, 1),
  I(3, 'Cold Brew Concentrate', 'Coffee & Tea', 'L', 6.4, 10, 21, 1),
  I(4, 'Chai Concentrate', 'Coffee & Tea', 'L', 7.2, 4, 60, 8),
  I(5, 'Matcha Powder', 'Coffee & Tea', 'kg', 64, 1, 180, 8),
  I(6, 'Loose Leaf Tea', 'Coffee & Tea', 'kg', 38, 1, 365, 8),
  I(7, 'Whole Milk', 'Dairy & Alt', 'L', 1.2, 12, 10, 2),
  I(8, 'Oat Milk', 'Dairy & Alt', 'L', 2.4, 12, 30, 2),
  I(9, 'Heavy Cream', 'Dairy & Alt', 'L', 4.1, 6, 14, 2),
  I(10, 'Vanilla Syrup', 'Syrups & Sauces', 'L', 9.5, 4, 365, 6),
  I(11, 'Caramel Sauce', 'Syrups & Sauces', 'L', 11, 4, 180, 6),
  I(12, 'Chocolate Sauce', 'Syrups & Sauces', 'L', 10.5, 4, 180, 6),
  I(13, 'Lemonade Base', 'Syrups & Sauces', 'L', 3.1, 10, 30, 7),
  I(14, 'Berry Purée', 'Syrups & Sauces', 'L', 8.8, 4, 21, 7),
  I(15, 'Pastry Dough', 'Bakery', 'kg', 6.2, 10, 7, 3),
  I(16, 'Cookie Dough', 'Bakery', 'kg', 7.4, 10, 14, 3),
  I(17, 'Bagels', 'Bakery', 'each', 0.45, 48, 5, 3),
  I(18, 'Eggs', 'Kitchen', 'each', 0.32, 180, 21, 7),
  I(19, 'Pancake Batter Mix', 'Kitchen', 'kg', 3.6, 10, 120, 3),
  I(20, 'Beef Patties', 'Kitchen', 'each', 1.35, 40, 5, 5),
  I(21, 'Potatoes', 'Kitchen', 'kg', 1.1, 20, 30, 7),
  I(22, 'Burger Buns', 'Kitchen', 'each', 0.38, 48, 6, 3),
  I(23, 'Cups & Lids', 'Packaging', 'each', 0.11, 1000, 730, 4),
  I(24, 'Merch Stock', 'Packaging', 'each', 7.5, 24, 3650, 4)
]

const SUPPLIERS = [
  { code: 'SUP-01', name: 'Nebula Bean Roasters', category: 'Coffee', terms: 30, lead: 3, rating: 4.6 },
  { code: 'SUP-02', name: 'Milky Way Dairy Co-op', category: 'Dairy', terms: 14, lead: 1, rating: 4.4 },
  { code: 'SUP-03', name: 'Gravity Mills Bakehouse', category: 'Bakery', terms: 21, lead: 2, rating: 4.1 },
  { code: 'SUP-04', name: 'Orbit Packaging Supply', category: 'Packaging & Merch', terms: 45, lead: 5, rating: 3.6 },
  { code: 'SUP-05', name: 'Red Dwarf Butchery', category: 'Meat', terms: 14, lead: 2, rating: 4.3 },
  { code: 'SUP-06', name: 'Aurora Syrup Works', category: 'Syrups', terms: 30, lead: 4, rating: 4.5 },
  { code: 'SUP-07', name: 'Comet Fields Produce', category: 'Produce', terms: 14, lead: 2, rating: 4.0 },
  { code: 'SUP-08', name: 'Kuiper Belt Tea Traders', category: 'Tea', terms: 30, lead: 6, rating: 4.7 }
]

const REGIONS = [
  { name: 'Orion Coast', districts: ['Orion North', 'Orion South'], lat: 41.2, lon: -95.4, climate: 1 },
  { name: 'Andromeda Valley', districts: ['Andromeda East', 'Andromeda West'], lat: 39.4, lon: -98.1, climate: 3 },
  { name: 'Cassiopeia Heights', districts: ['Cassiopeia Upper', 'Cassiopeia Lower'], lat: 44.6, lon: -93.2, climate: -3 },
  { name: 'Lyra Lakes', districts: ['Lyra Harbor', 'Lyra Pines'], lat: 43.1, lon: -89.7, climate: -1 }
]

type Format = 'Diner' | 'Café' | 'Kiosk' | 'Drive-In'

const FORMAT_MULT: Record<Format, number> = { Diner: 1.2, Café: 1, Kiosk: 0.75, 'Drive-In': 1.1 }
// hours 6..20
const HOURLY: Record<Format, number[]> = {
  Café: [5, 12, 14, 11, 8, 7, 9, 8, 6, 6, 5, 4, 3, 2, 1],
  Kiosk: [8, 16, 15, 9, 5, 6, 7, 5, 4, 5, 3, 2, 1, 1, 0.5],
  Diner: [3, 6, 8, 7, 6, 9, 11, 7, 4, 4, 6, 9, 8, 5, 3],
  'Drive-In': [6, 12, 12, 8, 6, 8, 10, 7, 5, 5, 6, 7, 6, 4, 2]
}
const LABOR_HOURS: Record<Format, number> = { Diner: 92, Café: 56, Kiosk: 24, 'Drive-In': 70 }
const HEADCOUNT: Record<Format, { barista: number; cook: number }> = {
  Diner: { barista: 5, cook: 3 },
  Café: { barista: 5, cook: 0 },
  Kiosk: { barista: 2, cook: 0 },
  'Drive-In': { barista: 5, cook: 2 }
}

const PAYMENT_METHODS = ['Card', 'Cash', 'Mobile Wallet', 'Starlite App', 'Gift Card']
const CHANNELS = ['Counter', 'Drive-Thru', 'Mobile Order', 'Delivery']

const PROMO_TEMPLATES = [
  { name: 'Supernova Saturdays', type: '% Off', pct: 0.2, category: 'Coffee' as Category, month: 2, days: 21 },
  { name: 'Pancake Eclipse', type: 'BOGO', pct: 0.5, category: 'Diner Plates' as Category, month: 3, days: 14 },
  { name: 'Matcha Moonrise', type: '% Off', pct: 0.2, category: 'Tea & Matcha' as Category, month: 4, days: 14 },
  { name: 'Comet Cold Brew Week', type: '% Off', pct: 0.25, category: 'Cold Drinks' as Category, month: 6, days: 10 },
  { name: 'Meteor Shower Madness', type: 'Double Stars', pct: 0, category: 'Coffee' as Category, month: 8, days: 7 },
  { name: 'Back-to-Orbit Bakery Bundle', type: 'Bundle', pct: 0.2, category: 'Bakery' as Category, month: 9, days: 21 },
  { name: 'Pumpkin Nebula Launch', type: 'Double Stars', pct: 0, category: 'Coffee' as Category, month: 10, days: 10 },
  { name: 'Holiday Galaxy Gifting', type: '% Off', pct: 0.15, category: 'Merch' as Category, month: 12, days: 18 }
]

// ---------------------------------------------------------------------------------------------
// Runtime entities

interface Store {
  key: number
  code: string
  name: string
  format: Format
  region: string
  district: string
  city: string
  lat: number
  lon: number
  opened: Date
  closed: Date | null
  seats: number
  sqft: number
  driveThru: boolean
  quality: number
  climate: number
}

interface Member {
  key: number
  id: string
  home: number
  join: Date
  weight: number
  tier: string
  tierRank: number
  channel: string
  ageBand: string
  birthMonth: number
  email: string | null
  optIn: boolean
}

interface Employee {
  id: string
  name: string
  hire: Date
  termination: Date | null
  versions: Scd2Version[]
}

interface Promo {
  key: number
  code: string
  name: string
  type: string
  pct: number
  category: Category
  start: Date
  end: Date
}

interface PendingReceipt {
  store: number
  ingredient: number
  qty: number
}

const money = (v: number) => round(v, 2)

function attrsAt(e: Employee, d: Date): Record<string, Scalar> {
  let cur = e.versions[0].attrs
  for (const v of e.versions) if (v.from.getTime() <= d.getTime()) cur = v.attrs
  return cur
}

// ---------------------------------------------------------------------------------------------

export function* generateStarlite(ctx: GenContext): Generator<Batch> {
  const today = ctx.today
  const start = ctx.start
  const span = daysBetween(start, today)
  const VOLUME = ctx.scale.factor / 30
  const BASE_TX = 112 * VOLUME

  // ---- stores ----------------------------------------------------------------------------
  const rs = ctx.rng('stores')
  const nStores = ctx.tiny ? 3 : 14
  const cities = placeNames(rs, nStores + 4)
  const formats: Format[] = ['Diner', 'Café', 'Kiosk', 'Drive-In']
  const stores: Store[] = []
  for (let i = 0; i < nStores; i++) {
    const region = REGIONS[i % REGIONS.length]
    const format = i < 4 ? formats[i] : rs.weighted(formats, [4, 5, 2, 3])
    const newStore = !ctx.tiny && i >= nStores - 3
    const opened = newStore ? addDays(start, Math.floor(span * rs.float(0.15, 0.75))) : addDays(start, -rs.int(200, 3200))
    const closed = !ctx.tiny && i === 5 ? addDays(start, Math.floor(span * 0.82)) : null
    const city = cities[i]
    stores.push({
      key: i + 1,
      code: `SL-${String(i + 1).padStart(3, '0')}`,
      name: `Starlite ${city} ${format}`,
      format,
      region: region.name,
      district: region.districts[rs.int(0, 1)],
      city,
      lat: round(region.lat + rs.normal(0, 0.6), 4),
      lon: round(region.lon + rs.normal(0, 0.9), 4),
      opened: dateOnly(opened),
      closed,
      seats: format === 'Diner' ? rs.int(60, 92) : format === 'Café' ? rs.int(24, 46) : format === 'Kiosk' ? rs.int(0, 6) : rs.int(18, 32),
      sqft: format === 'Diner' ? rs.int(2800, 4200) : format === 'Café' ? rs.int(1400, 2200) : format === 'Kiosk' ? rs.int(180, 420) : rs.int(1600, 2600),
      driveThru: format === 'Drive-In' || (format === 'Diner' && rs.chance(0.35)),
      quality: rs.normalClamped(1, 0.08, 0.82, 1.15),
      climate: region.climate
    })
  }
  const storeByCode = new Map(stores.map((s) => [s.code, s]))
  const isOpen = (s: Store, d: Date) => d.getTime() >= s.opened.getTime() && (!s.closed || d.getTime() < s.closed.getTime())

  // bronze stores (lossy: sq_ft blanks) → silver back-fill with format median
  const ri = ctx.rng('stores-bronze')
  const blankSqft = new Set<string>()
  for (const s of stores) if (ri.chance(0.18)) blankSqft.add(s.code)
  if (blankSqft.size === 0) blankSqft.add(stores[stores.length - 1].code)
  ctx.issue('SL09', blankSqft.size)
  const median = (xs: number[]) => {
    const a = [...xs].sort((x, y) => x - y)
    return a.length ? a[Math.floor(a.length / 2)] : 1500
  }
  const sqftClean = new Map<string, number>()
  for (const s of stores) {
    sqftClean.set(s.code, blankSqft.has(s.code) ? median(stores.filter((o) => o.format === s.format && !blankSqft.has(o.code)).map((o) => o.sqft)) : s.sqft)
  }
  const storeRows: BronzeRow[] = stores.map((s) => ({
    storeCode: s.code,
    name: s.name,
    format: s.format,
    region: s.region,
    district: s.district,
    city: s.city,
    geo: { lat: s.lat, lon: s.lon },
    opened: s.opened,
    closed: s.closed,
    seats: s.seats,
    sq_ft: blankSqft.has(s.code) ? null : s.sqft,
    driveThru: s.driveThru
  }))
  injectCasing(storeRows, 'region', { rng: ri, sink: ctx, code: 'SL10', rate: 0.3, atLeast: 1 })

  // ---- products / ingredients / suppliers ------------------------------------------------
  const rp = ctx.rng('products')
  const launch = new Map<string, Date>()
  for (const p of PRODUCTS) launch.set(p.sku, p.launchFrac !== undefined ? addDays(start, Math.floor(span * p.launchFrac)) : addDays(start, -rp.int(120, 2400)))
  const productKey = new Map(PRODUCTS.map((p, i) => [p.sku, i + 1]))
  const ingredientIndex = new Map(INGREDIENTS.map((g, i) => [g.code, i]))
  const yearsFromStart = (d: Date) => Math.max(0, d.getUTCFullYear() - start.getUTCFullYear())
  const inflation = (d: Date) => Math.pow(1.04, yearsFromStart(d))
  const priceAt = (p: ProductDef, d: Date) => money(p.price * inflation(d))
  const costAt = (p: ProductDef, d: Date) => money(p.price * p.costRatio * inflation(d))
  const ingCostAt = (g: IngredientDef, d: Date) => money(g.cost * Math.pow(1.05, yearsFromStart(d)))

  // ---- promotions ------------------------------------------------------------------------
  const rpr = ctx.rng('promotions')
  const promos: Promo[] = []
  for (let y = start.getUTCFullYear(); y <= today.getUTCFullYear(); y++) {
    for (const t of PROMO_TEMPLATES) {
      const s = ymd(y, t.month, rpr.int(1, 12))
      if (s.getTime() > today.getTime()) continue
      promos.push({ key: promos.length + 1, code: `PR-${y}-${String(t.month).padStart(2, '0')}`, name: t.name, type: t.type, pct: t.pct, category: t.category, start: s, end: addDays(s, t.days - 1) })
    }
  }

  // ---- loyalty members -------------------------------------------------------------------
  const rm = ctx.rng('members')
  const nMembers = ctx.n(2600, 40)
  const members: Member[] = []
  for (let i = 0; i < nMembers; i++) {
    const before = rm.chance(0.3)
    const join = before ? addDays(start, -rm.int(30, 900)) : addDays(start, Math.floor(span * Math.pow(rm.next(), 0.8)))
    const n = personName(rm)
    const weight = rm.logNormal(1, 0.9)
    const home = rm.int(0, stores.length - 1)
    members.push({
      key: i + 1,
      id: `M-${String(i + 1).padStart(6, '0')}`,
      home,
      join: dateOnly(maxDate(join, stores[home].opened)),
      weight,
      tier: '',
      tierRank: 0,
      channel: rm.weighted(['App', 'In-store', 'Web'], [0.55, 0.35, 0.1]),
      ageBand: rm.weighted(['18-24', '25-34', '35-44', '45-54', '55-64', '65+'], [0.18, 0.3, 0.22, 0.14, 0.1, 0.06]),
      birthMonth: rm.int(1, 12),
      email: rm.chance(0.88) ? email(n.first, n.last, 'mail.example', rm) : null,
      optIn: rm.chance(0.62)
    })
  }
  const byWeight = [...members].sort((a, b) => b.weight - a.weight)
  byWeight.forEach((m, i) => {
    const q = i / byWeight.length
    m.tier = q < 0.1 ? 'Supernova' : q < 0.4 ? 'Nova' : 'Comet'
    m.tierRank = q < 0.1 ? 3 : q < 0.4 ? 2 : 1
  })
  const membersByStore: Member[][] = stores.map(() => [])
  for (const m of members) membersByStore[m.home].push(m)
  for (const list of membersByStore) list.sort((a, b) => a.join.getTime() - b.join.getTime() || a.key - b.key)
  const maxWeight = Math.max(...members.map((m) => m.weight), 1)

  // ---- employees (HR lifecycle → SCD2) ---------------------------------------------------
  const rh = ctx.rng('hr')
  const employees: Employee[] = []
  const tenureYears: Record<string, number> = { Barista: 1.3, 'Line Cook': 1.5, 'Shift Lead': 2.6, 'Store Manager': 3.6 }
  const baseRate: Record<string, [number, number]> = { Barista: [15.5, 17.5], 'Line Cook': [17, 19.5], 'Shift Lead': [19, 21.5], 'Store Manager': [26, 31] }
  for (const s of stores) {
    const hc = HEADCOUNT[s.format]
    const positions = ['Store Manager', 'Shift Lead', 'Shift Lead', ...Array<string>(hc.barista).fill('Barista'), ...Array<string>(hc.cook).fill('Line Cook')]
    for (const role of positions) {
      let hire = maxDate(addDays(s.opened, -14), addDays(start, -rh.int(0, 1100)))
      const endLimit = s.closed ?? addDays(today, 1)
      while (hire.getTime() < endLimit.getTime() && hire.getTime() <= today.getTime()) {
        const tenure = Math.max(30, Math.round(rh.exponential(tenureYears[role] * 365)))
        let termination: Date | null = addDays(hire, tenure)
        if (termination.getTime() >= endLimit.getTime()) termination = s.closed ? s.closed : null
        if (termination && termination.getTime() > today.getTime()) termination = null
        const id = `E-${String(employees.length + 1).padStart(4, '0')}`
        const n = personName(rh)
        const [lo, hi] = baseRate[role]
        const attrs: Record<string, Scalar> = {
          full_name: n.full,
          role,
          store_code: s.code,
          store_name: s.name,
          hourly_rate: money(rh.float(lo, hi) * Math.pow(1.035, Math.max(0, hire.getUTCFullYear() - start.getUTCFullYear() + 3))),
          employment_type: role === 'Barista' || role === 'Line Cook' ? rh.weighted(['Part-time', 'Full-time'], [0.6, 0.4]) : 'Full-time',
          employment_status: 'Active',
          hire_date: dateOnly(hire)
        }
        const last = termination ?? today
        // change events: annual raises (April 1st), part-time → full-time conversion, store transfer, termination
        const events: Array<{ at: Date; apply: (prev: Record<string, Scalar>) => Record<string, Scalar> }> = []
        for (let y = hire.getUTCFullYear(); y <= last.getUTCFullYear(); y++) {
          const raise = ymd(y, 4, 1)
          if (raise.getTime() > hire.getTime() + 90 * 86_400_000 && raise.getTime() < last.getTime()) {
            const pct = rh.float(1.02, 1.055)
            events.push({ at: raise, apply: (prev) => ({ ...prev, hourly_rate: money((prev.hourly_rate as number) * pct) }) })
          }
        }
        const tenureDays = daysBetween(hire, last)
        if (attrs.employment_type === 'Part-time' && tenureDays > 75 && rh.chance(0.35)) {
          events.push({ at: addDays(hire, rh.int(60, tenureDays - 1)), apply: (prev) => ({ ...prev, employment_type: 'Full-time' }) })
        }
        if (tenureDays > 120 && rh.chance(0.08)) {
          const at = addDays(hire, rh.int(90, tenureDays - 1))
          const dest = stores.filter((o) => o.code !== s.code && isOpen(o, at))
          if (dest.length) {
            const d = rh.pick(dest)
            events.push({ at, apply: (prev) => ({ ...prev, store_code: d.code, store_name: d.name }) })
          }
        }
        events.sort((a, b) => a.at.getTime() - b.at.getTime())
        if (termination) events.push({ at: termination, apply: (prev) => ({ ...prev, employment_status: 'Terminated' }) })
        const versions: Scd2Version[] = [{ from: dateOnly(hire), attrs }]
        for (const ev of events) versions.push({ from: dateOnly(ev.at), attrs: ev.apply(versions[versions.length - 1].attrs) })
        employees.push({ id, name: n.full, hire: dateOnly(hire), termination: termination ? dateOnly(termination) : null, versions })
        if (!termination) break
        hire = addDays(termination, rh.int(5, 25))
      }
    }
  }
  const scdEntities: Scd2Entity[] = employees.map((e) => ({ businessKey: e.id, versions: e.versions }))
  const employeeRows = scd2Rows(scdEntities, { skColumn: 'employee_sk', bkColumn: 'employee_id' })
  const scdIndex = new Scd2Index(employeeRows, 'employee_sk', 'employee_id')
  const rosterCache = new Map<string, Employee[]>()
  const roster = (s: Store, d: Date): Employee[] => {
    const k = `${s.code}|${monthKey(d)}`
    let list = rosterCache.get(k)
    if (!list) {
      const mid = maxDate(minDate(ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, 15), today), s.opened)
      list = employees.filter((e) => {
        if (e.hire.getTime() > mid.getTime()) return false
        const a = attrsAt(e, mid)
        return a.store_code === s.code && a.employment_status === 'Active' && a.role !== 'Line Cook'
      })
      if (!list.length) list = employees.filter((e) => e.versions[0].attrs.store_code === s.code)
      if (!list.length) list = [employees[0]]
      rosterCache.set(k, list)
    }
    return list
  }

  // ---- static batch ------------------------------------------------------------------------
  const staticTables: Record<string, Row[]> = {}
  const staticBronze: BronzeFile[] = []
  staticTables.gold_dim_store = stores.map((s) => ({
    store_key: s.key, store_code: s.code, store_name: s.name, store_format: s.format, region: s.region, district: s.district, city: s.city,
    latitude: s.lat, longitude: s.lon, opened_date: s.opened, closed_date: s.closed, seats: s.seats, square_feet: sqftClean.get(s.code)!,
    has_drive_thru: s.driveThru, store_status: s.closed && s.closed.getTime() <= today.getTime() ? 'Closed' : 'Open'
  }))
  staticTables.silver_stores = stores.map((s) => ({
    store_code: s.code, store_name: s.name, store_format: s.format, region: s.region, district: s.district, city: s.city, latitude: s.lat, longitude: s.lon,
    opened_date: s.opened, closed_date: s.closed, seats: s.seats, square_feet: sqftClean.get(s.code)!, has_drive_thru: s.driveThru
  }))
  staticBronze.push({ source: 'stores', path: 'stores/stores_api_dump.json', format: 'json', rows: storeRows, json: { envelope: { api: 'starops/v2/stores', page: 1, pageSize: 100, exportedAt: formatDate(today, 'iso_t') }, dataKey: 'data' } })

  staticTables.gold_dim_product = [
    { product_key: -1, sku: 'UNKNOWN', product_name: 'Unknown / Open Ring', category: 'Unknown', subcategory: 'Unknown', temperature: 'Unknown', list_price: 0, unit_cost: 0, caffeine_mg: 0, is_seasonal: false, launch_date: null },
    ...PRODUCTS.map((p) => ({
      product_key: productKey.get(p.sku)!, sku: p.sku, product_name: p.name, category: p.category, subcategory: p.sub, temperature: p.temp,
      list_price: priceAt(p, today), unit_cost: costAt(p, today), caffeine_mg: p.caffeine, is_seasonal: !!p.months, launch_date: launch.get(p.sku)!
    }))
  ]
  staticTables.silver_menu_items = PRODUCTS.map((p) => ({
    sku: p.sku, product_name: p.name, category: p.category, subcategory: p.sub, temperature: p.temp, list_price: priceAt(p, today), unit_cost: costAt(p, today),
    caffeine_mg: p.caffeine, is_seasonal: !!p.months, launch_date: launch.get(p.sku)!
  }))
  const menuRows: BronzeRow[] = PRODUCTS.map((p) => ({
    SKU: p.sku, 'Item Name': p.name, Category: p.category, Subcategory: p.sub, Serve: p.temp, Price: priceAt(p, today), 'Std Cost': costAt(p, today),
    'Caffeine (mg)': p.caffeine, Seasonal: p.months ? 'Y' : 'N', Launched: launch.get(p.sku)!
  }))
  const rmenu = ctx.rng('menu-bronze')
  injectFormattedNumbers(menuRows, 'Price', { rng: rmenu, sink: ctx, code: 'SL08', rate: 0.35, atLeast: 2 })
  staticBronze.push({ source: 'menu', path: 'menu/menu_master.xlsx', format: 'xlsx', rows: menuRows, xlsx: { sheet: 'Menu', titleLines: ['Starlite Coffee Co. — Menu Master', `Exported ${isoDate(today)} by Marketing · prices in USD`] } })

  staticTables.gold_dim_supplier = SUPPLIERS.map((s, i) => ({
    supplier_key: i + 1, supplier_code: s.code, supplier_name: s.name, supplier_category: s.category, city: cities[nStores + (i % 4)],
    payment_terms_days: s.terms, contract_lead_time_days: s.lead, quality_rating: s.rating
  }))
  staticTables.silver_suppliers = staticTables.gold_dim_supplier.map((r) => {
    const { supplier_key: _k, ...rest } = r
    void _k
    return rest
  })
  staticBronze.push({ source: 'suppliers', path: 'procurement/suppliers.csv', format: 'csv', rows: staticTables.silver_suppliers.map((r) => ({ ...r }) as BronzeRow) })
  const supplierKey = new Map(SUPPLIERS.map((s, i) => [s.code, i + 1]))
  const supplierByCode = new Map(SUPPLIERS.map((s) => [s.code, s]))

  staticTables.gold_dim_ingredient = INGREDIENTS.map((g, i) => ({
    ingredient_key: i + 1, ingredient_code: g.code, ingredient_name: g.name, ingredient_category: g.category, unit_of_measure: g.unit,
    unit_cost: ingCostAt(g, today), pack_size: g.pack, shelf_life_days: g.shelf, is_perishable: g.shelf < 30, supplier_name: supplierByCode.get(g.supplier)!.name
  }))
  staticTables.silver_ingredients = INGREDIENTS.map((g) => ({
    ingredient_code: g.code, ingredient_name: g.name, ingredient_category: g.category, unit_of_measure: g.unit, unit_cost: ingCostAt(g, today),
    pack_size: g.pack, shelf_life_days: g.shelf, supplier_code: g.supplier
  }))
  const kitchenCsv = { delimiter: ';', bom: true, lineEnding: '\r\n' as const }
  staticBronze.push({ source: 'kitchen', path: 'kitchen/ingredients.csv', format: 'csv', csv: kitchenCsv, rows: staticTables.silver_ingredients.map((r) => ({ ...r }) as BronzeRow) })
  staticTables.gold_bridge_recipe = []
  staticTables.silver_recipes = []
  for (const p of PRODUCTS) {
    const merged = new Map<string, number>()
    for (const [code, q] of p.recipe) merged.set(code, (merged.get(code) ?? 0) + q)
    for (const [code, q] of merged) {
      staticTables.gold_bridge_recipe.push({ product_key: productKey.get(p.sku)!, ingredient_key: ingredientIndex.get(code)! + 1, quantity_per_unit: q })
      staticTables.silver_recipes.push({ sku: p.sku, ingredient_code: code, quantity_per_unit: q })
    }
  }
  staticBronze.push({ source: 'kitchen', path: 'kitchen/recipes.csv', format: 'csv', csv: kitchenCsv, rows: staticTables.silver_recipes.map((r) => ({ ...r, quantity_per_unit: String(r.quantity_per_unit).replace('.', ',') }) as BronzeRow) })

  staticTables.gold_dim_promotion = [
    { promotion_key: -1, promo_code: 'NONE', promotion_name: 'No Promotion', promotion_type: 'None', target_category: 'All', discount_pct: 0, start_date: null, end_date: null },
    ...promos.map((p) => ({ promotion_key: p.key, promo_code: p.code, promotion_name: p.name, promotion_type: p.type, target_category: p.category, discount_pct: p.pct, start_date: p.start, end_date: p.end }))
  ]
  staticTables.silver_promotions = promos.map((p) => ({ promo_code: p.code, promotion_name: p.name, promotion_type: p.type, target_category: p.category, discount_pct: p.pct, start_date: p.start, end_date: p.end }))
  staticBronze.push({ source: 'promotions', path: 'marketing/promotions.json', format: 'json', rows: staticTables.silver_promotions.map((r) => ({ ...r }) as BronzeRow) })

  staticTables.gold_dim_payment = []
  PAYMENT_METHODS.forEach((m, mi) =>
    CHANNELS.forEach((ch, ci) => staticTables.gold_dim_payment.push({ payment_key: mi * CHANNELS.length + ci + 1, payment_method: m, order_channel: ch, is_digital: ch === 'Mobile Order' || ch === 'Delivery' }))
  )
  const paymentKey = (m: string, ch: string) => PAYMENT_METHODS.indexOf(m) * CHANNELS.length + CHANNELS.indexOf(ch) + 1

  staticTables.gold_dim_member = [
    { member_key: -1, member_id: 'GUEST', is_guest: true, tier: 'Guest', tier_rank: 0, join_date: null, join_channel: 'n/a', age_band: 'Unknown', birth_month: null, home_store_key: null, email_opt_in: false },
    ...members.map((m) => ({
      member_key: m.key, member_id: m.id, is_guest: false, tier: m.tier, tier_rank: m.tierRank, join_date: m.join, join_channel: m.channel, age_band: m.ageBand,
      birth_month: m.birthMonth, home_store_key: stores[m.home].key, email_opt_in: m.optIn
    }))
  ]
  staticTables.gold_dim_employee = employeeRows
  yield { label: 'static', tables: staticTables, bronze: staticBronze }

  // ---- weather model -------------------------------------------------------------------------
  const rw = ctx.rng('weather')
  const weatherCities = [...new Set(stores.map((s) => s.city))]
  const cityClimate = new Map(stores.map((s) => [s.city, s.climate]))
  const anomaly = new Map<string, number>(weatherCities.map((c) => [c, 0]))
  const heatwaveStart = ymd(start.getUTCFullYear() + (ctx.scale.years > 1 ? 1 : 0), 7, rw.int(8, 18))

  // ---- simulation state ----------------------------------------------------------------------
  const rng = ctx.rng('sim')
  const roughStore = stores[Math.min(stores.length - 1, 2)]
  const roughFrom = startOfMonth(addDays(start, Math.floor(span * 0.55)))
  const roughTo = addDays(roughFrom, 95)
  const outageStore = stores[Math.min(stores.length - 1, 1)]
  const outageDay = addDays(start, Math.floor(span * 0.47))
  const driftDate = addDays(start, Math.floor(span * 0.6))
  const counterStart = addDays(today, -89)
  let driftLogged = false
  const nIng = INGREDIENTS.length
  const stock = stores.map(() => INGREDIENTS.map((g) => g.pack))
  const ema = stores.map(() => INGREDIENTS.map(() => 0))
  const pendingReceipts = new Map<number, PendingReceipt[]>()
  const pendingPos = new Map<number, BronzeRow[]>()
  let poSeq = 0
  let wasteSeq = 0
  let responseSeq = 0
  let firstPosFile = true
  let poDatesPlanted = false
  let orphanPlanted = false
  const productsByCategory = new Map<Category, ProductDef[]>()
  for (const p of PRODUCTS) {
    const list = productsByCategory.get(p.category) ?? []
    list.push(p)
    productsByCategory.set(p.category, list)
  }
  const categories: Category[] = ['Coffee', 'Tea & Matcha', 'Cold Drinks', 'Bakery', 'Diner Plates', 'Merch']
  const partWeights = (h: number): number[] => {
    if (h < 11) return [0.45, 0.08, 0.1, 0.25, 0.1, 0.02]
    if (h < 14) return [0.25, 0.07, 0.2, 0.1, 0.35, 0.03]
    if (h < 17) return [0.3, 0.1, 0.3, 0.2, 0.08, 0.02]
    return [0.12, 0.08, 0.2, 0.1, 0.48, 0.02]
  }
  const hourPickers = new Map<Format, (r: Rng) => number>()
  for (const f of formats) hourPickers.set(f, weightedPicker(HOURLY[f].map((_, i) => i + 6), HOURLY[f]))

  for (const monthStart of monthsOf(start, today)) {
    const monthEnd = minDate(endOfMonth(monthStart), today)
    const T: Record<string, Row[]> = {
      silver_pos_transactions: [], silver_pos_lines: [], gold_fact_sales_line: [], gold_fact_store_day: [], silver_weather_daily: [], silver_labor_daily: [],
      silver_waste_log: [], silver_survey_responses: [], silver_store_traffic_hourly: [], gold_fact_inventory_month: [], silver_employee_snapshots: [],
      silver_purchase_orders: [], gold_fact_po_line: []
    }
    const bronze: BronzeFile[] = []
    const weatherRows: BronzeRow[] = []
    const laborRows: BronzeRow[] = []
    const wasteRows: BronzeRow[] = []
    const surveyRows: BronzeRow[] = []
    const poRows: BronzeRow[] = []
    const monthAgg = stores.map(() => INGREDIENTS.map(() => ({ opening: 0, received: 0, used: 0, waste: 0, adj: 0 })))
    stores.forEach((_, si) => INGREDIENTS.forEach((__, gi) => (monthAgg[si][gi].opening = stock[si][gi])))

    for (const day of eachDay(monthStart, monthEnd)) {
      const dk = dateKey(day)
      const progress = clamp(daysBetween(start, day) / Math.max(1, span), 0, 1)
      // weather per city
      const weather = new Map<string, { hi: number; lo: number; precip: number; cond: string; sentinel: boolean }>()
      for (const city of weatherCities) {
        const a = 0.75 * anomaly.get(city)! + rw.normal(0, 2.2)
        anomaly.set(city, a)
        const heat = day.getTime() >= heatwaveStart.getTime() && day.getTime() < addDays(heatwaveStart, 9).getTime() ? 8 : 0
        const hi = round(15.5 + cityClimate.get(city)! + 13 * (annualCycle(day, 200, 1) - 1) + a + heat, 1)
        const lo = round(hi - rw.float(6, 12), 1)
        const wet = rw.chance(day.getUTCMonth() < 3 || day.getUTCMonth() > 9 ? 0.34 : 0.27)
        const precip = wet ? round(rw.exponential(6), 1) : 0
        const cond = precip > 0 && hi < 1.5 ? 'Snow' : precip > 18 ? 'Storm' : precip > 0 ? 'Rain' : hi >= 32 ? 'Heatwave' : rw.chance(0.55) ? 'Sunny' : 'Cloudy'
        const sentinel = rw.chance(0.012) || (dk === dateKey(start) && city === weatherCities[0])
        weather.set(city, { hi, lo, precip, cond, sentinel })
        if (sentinel) ctx.issue('SL15')
        weatherRows.push({ city, date: day, temp_max_c: sentinel ? -999 : hi, temp_min_c: lo, precip_mm: precip, conditions: cond })
        T.silver_weather_daily.push({ city, observation_date: day, temp_max_c: sentinel ? null : hi, temp_min_c: lo, precipitation_mm: precip, condition: cond })
      }
      const activePromos = promos.filter((p) => day.getTime() >= p.start.getTime() && day.getTime() <= p.end.getTime())
      const meteorNight = day.getUTCMonth() === 7 && day.getUTCDate() === 12

      for (let si = 0; si < stores.length; si++) {
        const s = stores[si]
        if (!isOpen(s, day)) continue
        const w = weather.get(s.city)!
        const wd = isoDow(day)
        const dowMult = s.format === 'Kiosk' ? (wd >= 6 ? 0.72 : 1.05) : [0.95, 0.93, 0.97, 1, 1.08, s.format === 'Diner' ? 1.25 : 1.12, 1.05][wd - 1]
        const weatherMult = w.cond === 'Snow' ? 0.72 : w.cond === 'Storm' ? 0.6 : w.cond === 'Rain' ? (s.driveThru ? 1.0 : 0.88) : w.cond === 'Heatwave' ? 0.93 : 1
        const ramp = Math.min(1, 0.55 + (0.45 * daysBetween(s.opened, day)) / 90)
        const rough = s === roughStore && day.getTime() >= roughFrom.getTime() && day.getTime() < roughTo.getTime() ? 0.88 : 1
        const lambda =
          BASE_TX * FORMAT_MULT[s.format] * s.quality * dowMult * annualCycle(day, 350, 0.07) * (1 + 0.065 * progress * ctx.scale.years) * weatherMult * ramp * rough *
          (activePromos.length ? 1.08 : 1) * (meteorNight ? 1.9 : 1)
        const outage = s === outageStore && dk === dateKey(outageDay)
        const nTx = outage ? 0 : rng.poisson(lambda)
        const temp = w.hi
        const usage = new Array<number>(nIng).fill(0)
        let dayNet = 0
        let dayTx = 0
        let dayItems = 0
        let respN = 0
        let promoters = 0
        let passives = 0
        let detractors = 0
        const hourlyTx = new Array<number>(24).fill(0)
        const crew = roster(s, day)
        const txList: Array<{ at: Date; id: string }> = []
        for (let t = 0; t < nTx; t++) {
          const hour = meteorNight && s.format === 'Diner' && rng.chance(0.4) ? rng.int(18, 20) : hourPickers.get(s.format)!(rng)
          txList.push({ at: new Date(day.getTime() + hour * 3_600_000 + rng.int(0, 3599) * 1000), id: '' })
        }
        txList.sort((a, b) => a.at.getTime() - b.at.getTime())
        const posRows: BronzeRow[] = []
        txList.forEach((tx, ti) => {
          tx.id = `${s.code.replace('-', '')}-${dk}-${String(ti + 1).padStart(4, '0')}`
          const hour = tx.at.getUTCHours()
          hourlyTx[hour]++
          // member
          let member: Member | null = null
          if (rng.chance(0.22 + 0.2 * progress)) {
            const pool = rng.chance(0.82) ? membersByStore[si] : membersByStore[rng.int(0, stores.length - 1)]
            for (let tries = 0; tries < 12 && pool.length; tries++) {
              const cand = pool[rng.int(0, pool.length - 1)]
              if (cand.join.getTime() > day.getTime()) continue
              if (rng.next() < cand.weight / maxWeight + 0.15) {
                member = cand
                break
              }
            }
          }
          // channel & payment
          const mobileShare = 0.04 + 0.14 * progress
          const channel = s.format === 'Drive-In' ? rng.weighted(CHANNELS, [0.45, 0.45, mobileShare, 0.04]) : s.driveThru ? rng.weighted(CHANNELS, [0.6, 0.25, mobileShare, 0.06]) : rng.weighted(CHANNELS, [0.85, 0, mobileShare, s.format === 'Diner' ? 0.07 : 0.01])
          let method = rng.weighted(PAYMENT_METHODS, [0.45, 0.12, 0.18, member ? 0.35 : 0, 0.05])
          if (channel === 'Mobile Order' && method === 'Cash') method = member ? 'Starlite App' : 'Card'
          const emp = rng.pick(crew)
          const empSk = scdIndex.lookup(emp.id, day)!
          // basket
          const nLines = Math.min(5, 1 + rng.poisson(s.format === 'Diner' ? 0.75 : 0.5))
          const catW = partWeights(hour).map((wgt, ci) => {
            const cat = categories[ci]
            if ((cat === 'Diner Plates') && s.format !== 'Diner' && s.format !== 'Drive-In') return 0
            if (cat === 'Coffee' || cat === 'Tea & Matcha') return wgt * clamp(1 - 0.02 * (temp - 15), 0.55, 1.3)
            if (cat === 'Cold Drinks') return wgt * clamp(1 + 0.045 * (temp - 15), 0.35, 2.2)
            return wgt
          })
          const chosen = new Set<string>()
          let lineNo = 0
          let txGross = 0
          let txDisc = 0
          let txNet = 0
          let promoCode: string | null = null
          const hasDrink = { v: false }
          const rewardRedeem = member !== null && rng.chance(0.05)
          for (let l = 0; l < nLines; l++) {
            const forceOrphan = !orphanPlanted
            const isOrphan = forceOrphan || rng.chance(0.0025)
            let sku: string
            let price: number
            let cost: number
            let pKey: number
            let prod: ProductDef | null = null
            if (isOrphan) {
              const o = rng.pick(ORPHAN_SKUS)
              sku = o.sku
              price = money(o.price * inflation(day))
              cost = money(price * 0.3)
              pKey = -1
              orphanPlanted = true
              ctx.issue('SL05')
            } else {
              const cat = rng.weighted(categories, catW)
              const avail = (productsByCategory.get(cat) ?? []).filter((p) => (!p.months || p.months.includes(day.getUTCMonth() + 1)) && launch.get(p.sku)!.getTime() <= day.getTime() && !chosen.has(p.sku))
              if (!avail.length) continue
              prod = rng.weighted(avail, zipfWeights(avail.length, 0.9).map((z, k) => (avail[k].launchFrac !== undefined ? z * 1.6 : z)))
              chosen.add(prod.sku)
              sku = prod.sku
              price = priceAt(prod, day)
              cost = costAt(prod, day)
              pKey = productKey.get(sku)!
              if (prod.temp === 'Hot' || prod.temp === 'Cold') hasDrink.v = true
            }
            let qty = rng.weighted([1, 2, 3], [0.86, 0.12, 0.02])
            let promo: Promo | null = null
            if (prod) {
              const cands = activePromos.filter((p) => p.category === prod!.category)
              if (cands.length && rng.chance(0.55)) promo = cands[0]
            }
            if (promo?.type === 'BOGO') qty = Math.max(qty, 2)
            const gross = money(qty * price)
            let disc = 0
            if (promo?.type === '% Off') disc = money(gross * promo.pct)
            else if (promo?.type === 'BOGO') disc = money(price * Math.floor(qty / 2))
            else if (promo?.type === 'Bundle' && hasDrink.v) disc = money(gross * promo.pct)
            else if (promo?.type === 'Bundle') promo = null
            if (rewardRedeem && lineNo === 0 && prod && (prod.temp === 'Hot' || prod.temp === 'Cold')) disc = money(Math.min(gross, price))
            const net = money(gross - disc)
            lineNo++
            const stars = member ? Math.floor(net * 2) * (promo?.type === 'Double Stars' ? 2 : 1) : 0
            if (promo) promoCode = promo.code
            txGross += gross
            txDisc += disc
            txNet += net
            dayItems += qty
            if (prod) for (const [code, q] of prod.recipe) usage[ingredientIndex.get(code)!] += q * qty
            const costAmt = money(cost * qty)
            T.gold_fact_sales_line.push({
              transaction_id: tx.id, line_number: lineNo, sale_date: day, date_key: dk, time_key: timeKey(tx.at), store_key: s.key, product_key: pKey,
              member_key: member ? member.key : -1, promotion_key: promo ? promo.key : -1, payment_key: paymentKey(method, channel), employee_sk: empSk,
              quantity: qty, unit_price: price, gross_amount: gross, discount_amount: disc, net_amount: net, cost_amount: costAmt, stars_earned: stars
            })
            T.silver_pos_lines.push({ transaction_id: tx.id, line_number: lineNo, business_date: day, sku, quantity: qty, unit_price: price, discount_amount: disc, net_amount: net })
            posRows.push({
              transaction_id: tx.id, store_code: s.code, sold_at: tx.at, line_no: lineNo, sku, qty, unit_price: price, discount: disc, line_total: net,
              member_id: member ? member.id : '', payment_method: method, channel, barista_id: emp.id, promo_code: promo ? promo.code : ''
            })
          }
          if (lineNo === 0) return
          dayTx++
          const tip = method !== 'Cash' && day.getTime() >= driftDate.getTime() && rng.chance(0.3) ? money(rng.float(0.5, 3)) : null
          dayNet += txNet
          T.silver_pos_transactions.push({
            transaction_id: tx.id, store_code: s.code, sold_at: tx.at, business_date: day, member_id: member ? member.id : null, employee_id: emp.id,
            payment_method: method, order_channel: channel, promo_code: promoCode, line_count: lineNo, gross_amount: money(txGross), discount_amount: money(txDisc),
            net_amount: money(txNet), tip_amount: tip
          })
          if (tip !== null) {
            for (const r of posRows) if (r.transaction_id === tx.id && r.line_no === 1) r.tip_amount = tip
          }
          // survey
          if (rng.chance(member ? 0.045 : 0.02)) {
            const rough2 = s === roughStore && day.getTime() >= roughFrom.getTime() && day.getTime() < roughTo.getTime() ? -2.6 : 0
            const score = Math.round(clamp(rng.normal(8.1 + (s.quality - 1) * 6 + rough2, 1.7), 0, 10))
            respN++
            if (score >= 9) promoters++
            else if (score >= 7) passives++
            else detractors++
            const id = `R-${String(++responseSeq).padStart(7, '0')}`
            const ch = member && rng.chance(0.6) ? 'App' : rng.weighted(['Receipt QR', 'Email'], [0.7, 0.3])
            const topic = rng.chance(0.5) ? (score <= 6 ? rng.weighted(['Speed', 'Friendliness', 'Cleanliness', 'Price'], [0.4, 0.25, 0.2, 0.15]) : rng.weighted(['Taste', 'Friendliness', 'Atmosphere', 'Speed'], [0.45, 0.3, 0.15, 0.1])) : null
            T.silver_survey_responses.push({ response_id: id, store_code: s.code, response_date: day, transaction_id: tx.id, nps_score: score, channel: ch, comment_topic: topic })
            surveyRows.push({ id, store: s.code, submitted: tx.at, txn: tx.id, channel: ch, answers: { nps: score, topic, comment: topic ? `${topic} feedback` : null } })
          }
        })
        // late landing per transaction, then today's file
        const byTx = new Map<string, BronzeRow[]>()
        for (const r of posRows) {
          const id = r.transaction_id as string
          const list = byTx.get(id) ?? []
          list.push(r)
          byTx.set(id, list)
        }
        for (const list of byTx.values()) {
          const land = minDate(landingDay(day, { rng, sink: ctx, code: 'SL02', rate: 0.012, maxDelay: 6 }), today)
          const k = dateKey(land)
          const pend = pendingPos.get(k) ?? []
          pend.push(...list)
          pendingPos.set(k, pend)
        }
        // labor
        const realHours = LABOR_HOURS[s.format] * (0.65 + 0.35 * Math.min(1.6, lambda / Math.max(1e-9, BASE_TX * FORMAT_MULT[s.format])))
        const hours = round(realHours * VOLUME * rng.float(0.92, 1.08), 2)
        const avgRate = crew.reduce((acc, e) => acc + (attrsAt(e, day).hourly_rate as number), 0) / crew.length
        const laborCost = money(hours * avgRate)
        const crewCount = Math.max(1, Math.round(realHours / 7.5))
        T.silver_labor_daily.push({ store_code: s.code, work_date: day, crew_on_shift: crewCount, labor_hours: hours, labor_cost: laborCost })
        laborRows.push({ store: s.code, date: day, crew: crewCount, hours, wages: laborCost })
        // waste
        let wasteCost = 0
        const nWaste = rng.poisson(0.7)
        for (let k = 0; k < nWaste; k++) {
          const perishable = INGREDIENTS.map((g, gi) => (g.shelf < 30 && ema[si][gi] > 0 ? ema[si][gi] : 0))
          if (perishable.every((v) => v === 0)) break
          const gi = rng.weighted(INGREDIENTS.map((_, i) => i), perishable)
          const g = INGREDIENTS[gi]
          const qty = round(Math.max(0.01, ema[si][gi] * rng.float(0.1, 0.6)), 3)
          const reason = g.category === 'Bakery' ? rng.weighted(['Unsold', 'Expired', 'Quality'], [0.6, 0.3, 0.1]) : g.category === 'Dairy & Alt' ? rng.weighted(['Expired', 'Spill'], [0.6, 0.4]) : rng.weighted(['Expired', 'Quality', 'Spill'], [0.6, 0.25, 0.15])
          const id = `W-${String(++wasteSeq).padStart(7, '0')}`
          T.silver_waste_log.push({ waste_id: id, store_code: s.code, waste_date: day, ingredient_code: g.code, quantity: qty, reason })
          wasteRows.push({ entry: id, store: s.code, date: day, ingredient: g.code, qty, reason })
          monthAgg[si][gi].waste += qty
          stock[si][gi] -= qty
          wasteCost += qty * ingCostAt(g, day)
        }
        // receipts due today, usage, emergency top-ups
        for (const r of pendingReceipts.get(dk) ?? []) {
          if (r.store !== si) continue
          stock[si][r.ingredient] += r.qty
          monthAgg[si][r.ingredient].received += r.qty
        }
        for (let gi = 0; gi < nIng; gi++) {
          stock[si][gi] -= usage[gi]
          monthAgg[si][gi].used += usage[gi]
          ema[si][gi] = ema[si][gi] === 0 ? usage[gi] : 0.92 * ema[si][gi] + 0.08 * usage[gi]
          if (stock[si][gi] < 0) {
            monthAgg[si][gi].adj += -stock[si][gi]
            stock[si][gi] = 0
          }
        }
        // weekly ordering on Mondays
        if (wd === 1 && (!s.closed || daysBetween(day, s.closed) > 21)) {
          const bySupplier = new Map<string, Array<{ gi: number; qty: number }>>()
          for (let gi = 0; gi < nIng; gi++) {
            const g = INGREDIENTS[gi]
            const sup = supplierByCode.get(g.supplier)!
            const need = ema[si][gi] * (7 + sup.lead + 4)
            if (need <= 0 || stock[si][gi] >= need) continue
            const packs = Math.max(1, Math.ceil((need * 1.4 - stock[si][gi]) / g.pack))
            const list = bySupplier.get(g.supplier) ?? []
            list.push({ gi, qty: packs * g.pack })
            bySupplier.set(g.supplier, list)
          }
          for (const [supCode, lines] of bySupplier) {
            const sup = supplierByCode.get(supCode)!
            const poNumber = `PO-${dk}-${String(++poSeq).padStart(5, '0')}`
            const expected = addDays(day, sup.lead)
            const degrading = supCode === 'SUP-04' && progress > 0.6 ? 0.35 : 0
            const lateDays = rng.chance(0.14 + degrading) ? rng.int(1, supCode === 'SUP-04' ? 6 : 3) : 0
            const received = maxDate(addDays(day, 1), addDays(expected, lateDays - (rng.chance(0.1) ? 1 : 0)))
            const paid = addDays(received, sup.terms + rng.int(-3, 6))
            lines.forEach((ln, li) => {
              const g = INGREDIENTS[ln.gi]
              const recQty = rng.chance(0.06) ? round(ln.qty * rng.float(0.8, 0.95), 2) : ln.qty
              const unitCost = ingCostAt(g, day)
              const isReceived = received.getTime() <= today.getTime()
              const isPaid = paid.getTime() <= today.getTime()
              if (isReceived) {
                const rk = dateKey(received)
                const list = pendingReceipts.get(rk) ?? []
                list.push({ store: si, ingredient: ln.gi, qty: recQty })
                pendingReceipts.set(rk, list)
              }
              const lead = daysBetween(day, received)
              const late = Math.max(0, daysBetween(expected, received))
              T.gold_fact_po_line.push({
                po_number: poNumber, po_line: li + 1, store_key: s.key, supplier_key: supplierKey.get(supCode)!, ingredient_key: ln.gi + 1,
                order_date_key: dk, expected_date_key: dateKey(expected), received_date_key: isReceived ? dateKey(received) : null, paid_date_key: isPaid ? dateKey(paid) : null,
                ordered_qty: ln.qty, received_qty: isReceived ? recQty : 0, unit_cost: unitCost, line_amount: money((isReceived ? recQty : ln.qty) * unitCost),
                lead_time_days: isReceived ? lead : null, days_late: isReceived ? late : null, is_on_time: isReceived ? late === 0 : null,
                status: isPaid ? 'Paid' : isReceived ? 'Received' : 'Ordered'
              })
              T.silver_purchase_orders.push({
                po_number: poNumber, po_line: li + 1, store_code: s.code, supplier_code: supCode, ingredient_code: g.code, order_date: day, expected_date: expected,
                received_date: isReceived ? received : null, paid_date: isPaid ? paid : null, ordered_qty: ln.qty, received_qty: isReceived ? recQty : 0, unit_cost: unitCost
              })
              poRows.push({
                po_number: poNumber, line: li + 1, store: s.code, supplier: supCode, item: g.code, order_date: day, expected_date: expected,
                received_date: isReceived ? received : null, paid_date: isPaid ? paid : null, qty_ordered: ln.qty, qty_received: isReceived ? recQty : 0, unit_cost: unitCost
              })
            })
          }
        }
        // door counters (pilot) & store-day snapshot
        const conv = s.format === 'Drive-In' ? 0.93 : s.format === 'Kiosk' ? 0.88 : 0.8
        let visitors = 0
        const hourVisitors: number[] = []
        for (let h = 6; h <= 20; h++) {
          const v = outage ? rng.poisson(lambda * (HOURLY[s.format][h - 6] / HOURLY[s.format].reduce((a, b) => a + b, 0)) / conv) : hourlyTx[h] + rng.poisson(hourlyTx[h] * (1 / conv - 1) + 0.05)
          hourVisitors.push(v)
          visitors += v
        }
        if (day.getTime() >= counterStart.getTime()) {
          const counterRows: BronzeRow[] = []
          hourVisitors.forEach((v, k) => {
            const at = new Date(day.getTime() + (k + 6) * 3_600_000)
            const glitch = rng.chance(0.01) || (dk === dateKey(counterStart) && si === 0 && k === 3)
            if (glitch) ctx.issue('SL18')
            counterRows.push({ store: s.code, hour_start: at, people_in: glitch ? -rng.int(1, 40) : v })
            T.silver_store_traffic_hourly.push({ store_code: s.code, count_hour: at, visitors: glitch ? null : v })
          })
          const y = day.getUTCFullYear()
          const mm = String(day.getUTCMonth() + 1).padStart(2, '0')
          const dd = String(day.getUTCDate()).padStart(2, '0')
          bronze.push({ source: 'traffic', path: `traffic/${y}/${mm}/${dd}/door_counts_${s.code}_${dk}.csv`, format: 'csv', rows: counterRows })
        }
        T.gold_fact_store_day.push({
          store_key: s.key, date_key: dk, visitors, transactions: dayTx,
          items_sold: dayItems, net_sales: money(dayNet), labor_hours: hours, labor_cost: laborCost, waste_cost: money(wasteCost), survey_responses: respN,
          promoters, passives, detractors, temp_high_c: w.sentinel ? null : w.hi, precipitation_mm: w.precip, weather_condition: w.cond, is_pos_outage: outage
        })
      }
      // daily POS file (lines landing today, incl. late ones)
      const landed = pendingPos.get(dk) ?? []
      pendingPos.delete(dk)
      if (landed.length) {
        const drift = day.getTime() >= driftDate.getTime()
        let rows = landed.map((r) => {
          if (!drift) {
            const { tip_amount: _t, ...rest } = r
            void _t
            return rest
          }
          const { barista_id, ...rest } = r
          return { ...rest, employee_id: barista_id, tip_amount: r.tip_amount ?? null }
        })
        if (drift && !driftLogged) {
          ctx.issue('SL07')
          driftLogged = true
        }
        const o = { rng, sink: ctx }
        rows = injectDuplicates(rows, { ...o, code: 'SL01', rate: 0.004, atLeast: firstPosFile ? 1 : 0 })
        injectCasing(rows, 'store_code', { ...o, code: 'SL03', rate: 0.02, atLeast: firstPosFile ? 1 : 0 })
        injectWhitespace(rows, 'sku', { ...o, code: 'SL04', rate: 0.01, atLeast: firstPosFile ? 1 : 0 })
        injectOutliers(rows, 'qty', { ...o, code: 'SL06', rate: 0.002, mode: 'extreme', factor: 100, atLeast: firstPosFile ? 1 : 0 })
        firstPosFile = false
        const columns = drift
          ? ['transaction_id', 'store_code', 'sold_at', 'line_no', 'sku', 'qty', 'unit_price', 'discount', 'line_total', 'member_id', 'payment_method', 'channel', 'employee_id', 'promo_code', 'tip_amount']
          : ['transaction_id', 'store_code', 'sold_at', 'line_no', 'sku', 'qty', 'unit_price', 'discount', 'line_total', 'member_id', 'payment_method', 'channel', 'barista_id', 'promo_code']
        const y = day.getUTCFullYear()
        const mm = String(day.getUTCMonth() + 1).padStart(2, '0')
        const dd = String(day.getUTCDate()).padStart(2, '0')
        bronze.push({ source: 'pos', path: `pos/${y}/${mm}/${dd}/pos_lines_${dk}.csv`, format: 'csv', columns, rows })
      }
    }

    // month-end: inventory snapshot, HR snapshot, monthly bronze files
    const mk = monthKey(monthStart)
    const snapKey = dateKey(monthEnd)
    const days = daysBetween(monthStart, monthEnd) + 1
    const stockRows: BronzeRow[] = []
    stores.forEach((s, si) => {
      if (!(s.opened.getTime() <= monthEnd.getTime() && (!s.closed || s.closed.getTime() > monthStart.getTime()))) return
      INGREDIENTS.forEach((g, gi) => {
        const a = monthAgg[si][gi]
        const shrink = round(stock[si][gi] * rng.float(0, 0.012), 3)
        stock[si][gi] -= shrink
        a.adj -= shrink
        const closing = round(stock[si][gi], 3)
        stock[si][gi] = closing
        const cost = ingCostAt(g, monthEnd)
        const usedPerDay = a.used / days
        T.gold_fact_inventory_month.push({
          store_key: s.key, ingredient_key: gi + 1, snapshot_date_key: snapKey, opening_qty: round(a.opening, 3), received_qty: round(a.received, 3),
          used_qty: round(a.used, 3), waste_qty: round(a.waste, 3), adjustment_qty: round(closing - (round(a.opening, 3) + round(a.received, 3) - round(a.used, 3) - round(a.waste, 3)), 3),
          closing_qty: closing, closing_value: money(closing * cost), used_value: money(a.used * cost), waste_value: money(a.waste * cost),
          days_of_cover: usedPerDay > 0 ? round(closing / usedPerDay, 1) : null
        })
        stockRows.push({ store: s.code, ingredient: g.code, count_date: monthEnd, counted_qty: closing, uom: g.unit })
      })
    })
    for (const e of employees) {
      if (e.hire.getTime() > monthEnd.getTime()) continue
      if (e.termination && e.termination.getTime() < monthStart.getTime()) continue
      const a = attrsAt(e, monthEnd)
      T.silver_employee_snapshots.push({
        snapshot_date: monthEnd, employee_id: e.id, full_name: a.full_name, role: a.role, store_code: a.store_code, hourly_rate: a.hourly_rate,
        employment_type: a.employment_type, employment_status: a.employment_status, hire_date: e.hire, termination_date: e.termination && e.termination.getTime() <= monthEnd.getTime() ? e.termination : null
      })
    }
    const hrRows: BronzeRow[] = T.silver_employee_snapshots.map((r) => ({
      emp_id: r.employee_id as string, name: r.full_name as string, role: r.role as string, store: r.store_code as string, rate: r.hourly_rate as number,
      type: r.employment_type as string, status: r.employment_status as string, hire_date: r.hire_date as Date, term_date: r.termination_date as Date | null
    }))
    const first = mk === monthKey(start)
    const mo = { rng, sink: ctx }
    injectDateFormats(hrRows, 'hire_date', { ...mo, code: 'SL11', rate: 0.12, atLeast: first ? 1 : 0 })
    const before = poDatesPlanted
    injectDateFormats(poRows, 'received_date', { ...mo, code: 'SL16', rate: 0.08, formats: ['eu'], atLeast: poDatesPlanted ? 0 : 1 })
    if (!before && poRows.some((r) => typeof r.received_date === 'string')) poDatesPlanted = true
    injectCasing(surveyRows, 'channel', { ...mo, code: 'SL17', rate: 0.15, atLeast: first && surveyRows.length ? 1 : 0 })
    const y = monthStart.getUTCFullYear()
    const ym = `${y}${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`
    bronze.push(
      { source: 'weather', path: `weather/${y}/weather_${ym}.json`, format: 'json', rows: weatherRows, json: { envelope: { provider: 'SkyLedger', units: 'metric', month: ym }, dataKey: 'observations' } },
      { source: 'labor', path: `hr/labor/labor_${ym}.csv`, format: 'csv', rows: laborRows },
      { source: 'hr', path: `hr/employees/employees_${ym}.csv`, format: 'csv', rows: hrRows },
      { source: 'inventory', path: `inventory/${y}/stock_counts_${ym}.csv`, format: 'csv', rows: stockRows },
      { source: 'inventory', path: `inventory/${y}/waste_log_${ym}.csv`, format: 'csv', rows: wasteRows, columns: ['entry', 'store', 'date', 'ingredient', 'qty', 'reason'] },
      { source: 'purchase_orders', path: `procurement/${y}/purchase_orders_${ym}.csv`, format: 'csv', rows: poRows, columns: ['po_number', 'line', 'store', 'supplier', 'item', 'order_date', 'expected_date', 'received_date', 'paid_date', 'qty_ordered', 'qty_received', 'unit_cost'] }
    )
    if (surveyRows.length) bronze.push({ source: 'surveys', path: `surveys/${y}/responses_${ym}.ndjson`, format: 'ndjson', rows: surveyRows })
    yield { label: `${y}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`, tables: T, bronze }
  }

  // ---- closing: loyalty export (as of today) & silver members ---------------------------------
  const rl = ctx.rng('loyalty-bronze')
  const memberRows: BronzeRow[] = members.map((m) => {
    let em: string | null = m.email
    if (em === null) {
      const placeholder = rl.pick(['', 'NULL', 'n/a', null] as Array<string | null>)
      ctx.issue('SL13')
      em = placeholder
    }
    return { member_id: m.id, tier: m.tier, join_date: m.join, channel: m.channel, age_band: m.ageBand, birth_month: m.birthMonth, home_store: stores[m.home].code, email: em, opt_in: m.optIn }
  })
  injectDateFormats(memberRows, 'join_date', { rng: rl, sink: ctx, code: 'SL14', rate: 0.2, formats: ['us', 'eu', 'epoch', 'long'], atLeast: 1 })
  const dupMembers = injectDuplicates(memberRows, { rng: rl, sink: ctx, code: 'SL12', rate: 0.01, atLeast: 1 })
  yield {
    label: 'closing',
    tables: {
      silver_members: members.map((m) => ({
        member_id: m.id, tier: m.tier, join_date: m.join, join_channel: m.channel, age_band: m.ageBand, birth_month: m.birthMonth, home_store_code: stores[m.home].code,
        email: m.email, email_opt_in: m.optIn
      }))
    },
    bronze: [{ source: 'loyalty', path: 'loyalty/members_export.ndjson', format: 'ndjson', rows: dupMembers }]
  }
  void storeByCode
}

function* monthsOf(start: Date, end: Date): Generator<Date> {
  for (let d = startOfMonth(start); d.getTime() <= end.getTime(); d = ymd(d.getUTCFullYear(), d.getUTCMonth() + 2, 1)) yield d
}
