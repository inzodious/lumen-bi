/**
 * Leafloft Vertical Farms — simulation.
 *
 * Production side (fixed size per scale): farms → rooms → racks (SCD2 configuration history: LED
 * retrofits, extra tiers, irrigation swaps), back-to-back grow batches per rack with crop-specific
 * timelines, yields driven by light generation and climate, 4-hourly room telemetry with a planted
 * HVAC failure (heat → failed / light batches) and a drifting CO2 sensor (readings rise, yields don't).
 *
 * Demand side (scales with --scale): veggie-box subscriptions with a monthly lifecycle (signups with
 * seasonality and a spring campaign, upgrades, downgrades, add-ons, pauses, churn, win-backs, a price
 * rise), exact MRR movement accounting in integer cents, and weekly / biweekly box deliveries.
 */
import type { Scalar } from '../../../../../src/core/model/data.ts'
import {
  addDays, annualCycle, dateKey, dateOnly, daysBetween, eachDay, endOfMonth, isoDow, isoDate, maxDate, minDate, monthKey, startOfMonth, ymd
} from '../../calendar.ts'
import { formatDate, injectCasing, injectDateFormats, injectDuplicates, injectFormattedNumbers, injectWhitespace, landingDay } from '../../chaos.ts'
import { clamp, round } from '../../prng.ts'
import { Scd2Index, scd2Rows } from '../../scd2.ts'
import type { Scd2Version } from '../../scd2.ts'
import type { Batch, BronzeFile, BronzeRow, GenContext, Row } from '../../schema.ts'
import { email, orgName, personName, placeNames } from '../../words.ts'

// ---------------------------------------------------------------------------------------------
// Reference data

type Category = 'Leafy Greens' | 'Herbs' | 'Microgreens' | 'Fruiting'
type RoomType = 'Microgreens' | 'Leafy & Herbs' | 'Fruiting'

interface CropDef {
  code: string
  variety: string
  crop: string
  category: Category
  germ: number
  grow: number
  yieldKgM2: number
  price: number
  heat: boolean
  failure: number
}

const CR = (n: number, variety: string, crop: string, category: Category, germ: number, grow: number, yieldKgM2: number, price: number, heat: boolean, failure: number): CropDef => ({
  code: `CR-${n}`, variety, crop, category, germ, grow, yieldKgM2, price, heat, failure
})

const CROPS: CropDef[] = [
  CR(101, 'Moonbutter', 'Lettuce', 'Leafy Greens', 3, 35, 3.2, 11, true, 0.025),
  CR(102, 'Skyline Cos', 'Lettuce', 'Leafy Greens', 3, 38, 3.4, 10, true, 0.025),
  CR(103, 'Copper Oak', 'Lettuce', 'Leafy Greens', 3, 34, 2.9, 12, true, 0.03),
  CR(104, 'Dino Dusk', 'Kale', 'Leafy Greens', 4, 40, 2.6, 14, false, 0.02),
  CR(105, 'Frill Storm', 'Kale', 'Leafy Greens', 4, 42, 2.7, 13, false, 0.02),
  CR(106, 'Baby Nimbus', 'Spinach', 'Leafy Greens', 4, 32, 2.2, 16, true, 0.035),
  CR(107, 'Pepper Breeze', 'Arugula', 'Leafy Greens', 3, 25, 1.8, 18, true, 0.03),
  CR(108, 'Pagoda Pak', 'Bok Choy', 'Leafy Greens', 3, 33, 3.4, 9, false, 0.02),
  CR(201, 'Loft Genovese', 'Basil', 'Herbs', 4, 30, 2.0, 28, false, 0.04),
  CR(202, 'Siam Spice', 'Basil', 'Herbs', 4, 32, 1.8, 30, false, 0.04),
  CR(203, 'Cool Current', 'Mint', 'Herbs', 6, 42, 1.9, 26, false, 0.03),
  CR(204, 'Coriander Cloud', 'Cilantro', 'Herbs', 7, 38, 1.5, 24, true, 0.08),
  CR(205, 'Flat Leaf Flare', 'Parsley', 'Herbs', 10, 50, 1.8, 20, false, 0.03),
  CR(206, 'Allium Arc', 'Chives', 'Herbs', 8, 55, 1.6, 30, false, 0.03),
  CR(301, 'Sunburst Shoots', 'Sunflower', 'Microgreens', 2, 10, 1.4, 40, false, 0.015),
  CR(302, 'Tendril Twist', 'Pea Shoots', 'Microgreens', 2, 12, 1.6, 36, false, 0.015),
  CR(303, 'Ruby Rush', 'Radish', 'Microgreens', 2, 9, 1.2, 45, false, 0.02),
  CR(401, 'Skyberry', 'Strawberry', 'Fruiting', 10, 75, 2.8, 22, true, 0.05),
  CR(402, 'Penthouse Cherry', 'Cherry Tomato', 'Fruiting', 7, 85, 4.5, 12, false, 0.05)
]

interface PlanDef {
  code: string
  name: string
  size: 'S' | 'M' | 'L' | 'XL'
  freq: 'Weekly' | 'Biweekly'
  price: number
}

const PLANS: PlanDef[] = [
  { code: 'PL-SPR-B', name: 'Sprout Biweekly', size: 'S', freq: 'Biweekly', price: 27 },
  { code: 'PL-SPR-W', name: 'Sprout Weekly', size: 'S', freq: 'Weekly', price: 24 },
  { code: 'PL-CAN-B', name: 'Canopy Biweekly', size: 'M', freq: 'Biweekly', price: 37 },
  { code: 'PL-CAN-W', name: 'Canopy Weekly', size: 'M', freq: 'Weekly', price: 33 },
  { code: 'PL-RAI-W', name: 'Rainforest Weekly', size: 'L', freq: 'Weekly', price: 45 },
  { code: 'PL-SKY-W', name: 'Skyfarm Office', size: 'XL', freq: 'Weekly', price: 88 }
]
const BOXES: Record<PlanDef['freq'], number> = { Weekly: 52 / 12, Biweekly: 26 / 12 }
const BOX_WEIGHT: Record<PlanDef['size'], number> = { S: 2.2, M: 3.4, L: 4.8, XL: 9.5 }
const BOX_ITEMS: Record<PlanDef['size'], number> = { S: 5, M: 7, L: 9, XL: 15 }

const ADDONS = [
  { code: 'AD-MIC', name: 'Microgreens Medley', category: 'Grown In-House', price: 18 },
  { code: 'AD-HRB', name: 'Herb Bundle', category: 'Grown In-House', price: 12 },
  { code: 'AD-BER', name: 'Skyberry Punnet', category: 'Grown In-House', price: 22 },
  { code: 'AD-FLW', name: 'Edible Flowers', category: 'Grown In-House', price: 15 },
  { code: 'AD-MSH', name: 'Mushroom Pack', category: 'Partner Product', price: 16 },
  { code: 'AD-EGG', name: 'Pasture Eggs', category: 'Partner Product', price: 14 }
]

const CHANNELS = ['Organic Search', 'Referral', 'Social Ads', 'Influencer', 'Farmers Market', 'Partner Grocery']
const REGIONS = ['Northshore', 'Riverbend Basin', 'High Plateau', 'Eastgate']
const CHURN_REASONS = ['Price', 'Too Much Food', 'Moved Away', 'Quality Issue', 'Switched to Grocery', 'Budget']
const SLOT_HOURS = [0, 4, 8, 12, 16, 20]
const LIGHT_FRAC = [0, 0.5, 1, 1, 1, 0.5]
const KW_PER_TIER: Record<string, number> = { 'LED Gen1': 0.64, 'LED Gen2': 0.52 }

// ---------------------------------------------------------------------------------------------
// Runtime types

interface Farm {
  key: number
  code: string
  name: string
  city: string
  region: string
  lat: number
  lon: number
  opened: Date
  area: number
  energy: string
  zones: string[]
  weight: number
  tariffBase: number
}

interface Room {
  key: number
  code: string
  name: string
  farm: Farm
  type: RoomType
  hvac: string
  setpoint: number
  racks: Rack[]
}

interface Rack {
  id: string
  name: string
  room: Room
  versions: Scd2Version[]
}

interface GrowBatch {
  id: string
  rack: Rack
  rackSk: number
  crop: CropDef
  cropKey: number
  seeded: Date
  germinated: Date
  transplanted: Date | null
  planned: Date
  harvest: Date | null
  failed: Date | null
  failureReason: string | null
  trays: number
  area: number
  targetKg: number
  harvestedKg: number
  status: 'Growing' | 'Harvested' | 'Failed'
  bins: number[]
}

interface Customer {
  key: number
  id: string
  name: string
  type: 'Household' | 'Office' | 'Restaurant'
  email: string
  phone: string | null
  zone: string
  farm: Farm
  channel: string
  signup: Date
}

interface AddonLink {
  addon: number
  added: Date
  removed: Date | null
}

interface Sub {
  key: number
  id: string
  customer: Customer
  plan: number
  addons: AddonLink[]
  status: 'Active' | 'Paused' | 'Churned'
  start: Date
  cohort: Date
  promo: string | null
  mrr: number // cents
  pausedMonths: number
  churnedAt: Date | null
  churnReason: string | null
  reactivations: number
  weekday: number
  parity: number
  deliveries: number
}

const money = (v: number) => round(v, 2)
const cents = (v: number) => Math.round(v * 100)

function versionAt(r: Rack, d: Date): Record<string, Scalar> {
  let cur = r.versions[0].attrs
  for (const v of r.versions) if (v.from.getTime() <= d.getTime()) cur = v.attrs
  return cur
}

function* monthsOf(start: Date, end: Date): Generator<Date> {
  for (let d = startOfMonth(start); d.getTime() <= end.getTime(); d = ymd(d.getUTCFullYear(), d.getUTCMonth() + 2, 1)) yield d
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

// ---------------------------------------------------------------------------------------------

export function* generateLeafloft(ctx: GenContext): Generator<Batch> {
  const today = ctx.today
  const start = ctx.start
  const span = daysBetween(start, today)
  const at = (frac: number) => addDays(start, Math.floor(span * frac))

  // ---- farms, rooms, racks ------------------------------------------------------------------
  const rf = ctx.rng('farms')
  const nFarms = ctx.tiny ? 1 : 4
  const cityNames = placeNames(rf, nFarms + nFarms * 3)
  const farms: Farm[] = []
  for (let i = 0; i < nFarms; i++) {
    const opened = i === 3 ? at(0.3) : addDays(start, -rf.int(400, 1500) - (i === 0 ? 800 : 0))
    farms.push({
      key: i + 1,
      code: `FM-${pad(i + 1)}`,
      name: `Leafloft ${cityNames[i]}`,
      city: cityNames[i],
      region: REGIONS[i],
      lat: round(40 + i * 1.7 + rf.normal(0, 0.3), 4),
      lon: round(-88 - i * 2.1 + rf.normal(0, 0.3), 4),
      opened: dateOnly(opened),
      area: rf.int(2400, 5200),
      energy: i % 2 === 0 ? 'Grid + Rooftop Solar' : 'Grid',
      zones: cityNames.slice(nFarms + i * 3, nFarms + i * 3 + 3),
      weight: i === 0 ? 1.6 : 1,
      tariffBase: rf.float(0.118, 0.156)
    })
  }
  const roomPlans: RoomType[][] = ctx.tiny
    ? [['Microgreens', 'Leafy & Herbs']]
    : [
        ['Microgreens', 'Leafy & Herbs', 'Leafy & Herbs', 'Fruiting'],
        ['Microgreens', 'Leafy & Herbs', 'Fruiting', 'Leafy & Herbs'],
        ['Microgreens', 'Leafy & Herbs', 'Leafy & Herbs'],
        ['Microgreens', 'Leafy & Herbs', 'Leafy & Herbs']
      ]
  const rooms: Room[] = []
  const racks: Rack[] = []
  const hvacModels = ['ClimaCube 40', 'ClimaCube 60', 'Polar Drift X2']
  for (const farm of farms) {
    const upgradeAt = addDays(at(0.35 + 0.1 * (farm.key - 1)), 0)
    roomPlans[farm.key - 1].forEach((type, ri) => {
      const room: Room = {
        key: rooms.length + 1,
        code: `${farm.code}-R${ri + 1}`,
        name: `${farm.city} ${type === 'Leafy & Herbs' ? 'Grow' : type} ${ri + 1}`,
        farm,
        type,
        hvac: rf.pick(hvacModels),
        setpoint: type === 'Fruiting' ? 23 : type === 'Microgreens' ? 21 : 21.5,
        racks: []
      }
      rooms.push(room)
      const nRacks = ctx.tiny ? 3 : type === 'Leafy & Herbs' ? 8 : 6
      for (let k = 0; k < nRacks; k++) {
        const tiers = type === 'Fruiting' ? 3 : rf.int(5, 7)
        const irrigation = type === 'Microgreens' ? 'Flood Tray' : type === 'Fruiting' ? 'Drip' : rf.pick(['NFT', 'Deep Water'])
        const attrs: Record<string, Scalar> = {
          room_code: room.code,
          farm_name: farm.name,
          room_name: room.name,
          rack_name: `Rack ${pad(k + 1)}`,
          light_type: 'LED Gen1',
          tiers,
          growing_area_m2: round(tiers * 2.6, 1),
          irrigation_system: irrigation,
          light_kw_per_tier: KW_PER_TIER['LED Gen1']
        }
        const versions: Scd2Version[] = [{ from: farm.opened, attrs }]
        const retrofit = addDays(upgradeAt, rf.int(0, 60))
        if (retrofit.getTime() <= today.getTime() && (!ctx.tiny || k < 2)) {
          const extraTier = type !== 'Fruiting' && rf.chance(0.3)
          const t2 = tiers + (extraTier ? 1 : 0)
          versions.push({ from: retrofit, attrs: { ...attrs, light_type: 'LED Gen2', light_kw_per_tier: KW_PER_TIER['LED Gen2'], tiers: t2, growing_area_m2: round(t2 * 2.6, 1) } })
        }
        if (type === 'Leafy & Herbs' && rf.chance(0.12)) {
          const when = addDays(maxDate(start, farm.opened), rf.int(30, Math.max(31, span - 30)))
          const prev = versions.filter((v) => v.from.getTime() <= when.getTime()).pop()!.attrs
          if (when.getTime() > versions[versions.length - 1].from.getTime()) versions.push({ from: when, attrs: { ...prev, irrigation_system: 'Aeroponic' } })
        }
        const rack: Rack = { id: `${room.code}-K${pad(k + 1)}`, name: `Rack ${pad(k + 1)}`, room, versions }
        room.racks.push(rack)
        racks.push(rack)
      }
    })
  }
  const rackRows = scd2Rows(racks.map((r) => ({ businessKey: r.id, versions: r.versions })), { skColumn: 'rack_sk', bkColumn: 'rack_id' })
  for (const r of rackRows) delete r.room_code
  const rackIndex = new Scd2Index(rackRows, 'rack_sk', 'rack_id')
  const farmOpenAt = (f: Farm, d: Date) => f.opened.getTime() <= d.getTime()

  // ---- planted incidents ----------------------------------------------------------------------
  const faultRoom = ctx.tiny ? rooms[1] : rooms.find((r) => r.farm.key === 2 && r.type === 'Leafy & Herbs')!
  let faultStart = ymd(at(0.4).getUTCFullYear(), 7, 10)
  if (faultStart.getTime() < at(0.3).getTime()) faultStart = ymd(faultStart.getUTCFullYear() + 1, 7, 10)
  if (faultStart.getTime() > addDays(today, -40).getTime()) faultStart = at(0.5)
  const faultEnd = addDays(faultStart, 17)
  const inFault = (room: Room, d: Date) => room === faultRoom && d.getTime() >= faultStart.getTime() && d.getTime() <= faultEnd.getTime()
  const driftRoom = ctx.tiny ? rooms[0] : rooms[2]
  const driftFrom = at(0.55)
  const co2Drift = (room: Room, d: Date) => (room === driftRoom && d.getTime() > driftFrom.getTime() ? (480 * daysBetween(driftFrom, d)) / Math.max(1, daysBetween(driftFrom, today)) : 0)
  const priceRise = startOfMonth(at(0.55))
  const campaignMonth = ymd(start.getUTCFullYear() + (ctx.scale.years > 1 ? 1 : 0), 3, 1)
  const firmware = at(0.5)

  // ---- grow batches (whole history, deterministic) ------------------------------------------
  const rb = ctx.rng('batches')
  const cropKey = new Map(CROPS.map((c, i) => [c.code, i + 1]))
  const cropsFor: Record<RoomType, CropDef[]> = {
    Microgreens: CROPS.filter((c) => c.category === 'Microgreens'),
    'Leafy & Herbs': CROPS.filter((c) => c.category === 'Leafy Greens' || c.category === 'Herbs'),
    Fruiting: CROPS.filter((c) => c.category === 'Fruiting')
  }
  const batches: GrowBatch[] = []
  let batchSeq = 0
  for (const rack of racks) {
    const room = rack.room
    const pool = cropsFor[room.type]
    const favourite = rb.sample(pool, Math.min(3, pool.length))
    let seed = addDays(maxDate(start, room.farm.opened), rb.int(0, 7))
    while (seed.getTime() <= today.getTime()) {
      const crop = rb.chance(0.7) ? rb.pick(favourite) : rb.pick(pool)
      const v = versionAt(rack, seed)
      const germinated = addDays(seed, crop.germ + rb.int(0, 1))
      const transplanted = crop.category === 'Microgreens' ? null : addDays(germinated, rb.int(7, 10))
      const planned = addDays(seed, crop.grow)
      const harvest = addDays(planned, rb.int(-1, 3))
      const overlap = Math.max(0, daysBetween(maxDate(seed, faultStart), minDate(harvest, faultEnd)) + 1)
      const faultFrac = room === faultRoom && harvest.getTime() >= faultStart.getTime() && seed.getTime() <= faultEnd.getTime() ? clamp(overlap / crop.grow, 0, 1) : 0
      const pFail = crop.failure + (faultFrac > 0 ? (crop.heat ? 0.45 : 0.12) * Math.min(1, faultFrac * 3) : 0)
      const fails = rb.chance(pFail)
      const failedAt = fails ? addDays(seed, Math.floor(crop.grow * rb.float(0.3, 0.9))) : null
      const area = v.growing_area_m2 as number
      const target = round(area * crop.yieldKgM2, 3)
      const gen2 = v.light_type === 'LED Gen2'
      const factor = rb.normalClamped(1, 0.07, 0.75, 1.25) * (gen2 ? 1.12 : 1) * (1 - (crop.heat ? 0.45 : 0.2) * faultFrac) * (1 + 0.03 * clamp(daysBetween(start, seed) / span, 0, 1))
      const status: GrowBatch['status'] = failedAt && failedAt.getTime() <= today.getTime() ? 'Failed' : !failedAt && harvest.getTime() <= today.getTime() ? 'Harvested' : 'Growing'
      const harvestedKg = status === 'Harvested' ? round(target * factor, 3) : 0
      const bins: number[] = []
      if (status === 'Harvested') {
        const n = clamp(Math.round(harvestedKg / 7) + rb.int(0, 2), 1, 12)
        const w = Array.from({ length: n }, () => rb.float(0.7, 1.3))
        const tot = w.reduce((a, b) => a + b, 0)
        let left = Math.round(harvestedKg * 1000)
        for (let i = 0; i < n - 1; i++) {
          const g = Math.round((harvestedKg * 1000 * w[i]) / tot)
          bins.push(g)
          left -= g
        }
        bins.push(left)
      }
      batchSeq++
      batches.push({
        id: `B-${String(seed.getUTCFullYear()).slice(2)}-${pad(batchSeq, 6)}`,
        rack,
        rackSk: rackIndex.lookup(rack.id, seed)!,
        crop,
        cropKey: cropKey.get(crop.code)!,
        seeded: seed,
        germinated,
        transplanted,
        planned,
        harvest: status === 'Harvested' ? harvest : null,
        failed: status === 'Failed' ? failedAt : null,
        failureReason: status === 'Failed' ? (faultFrac > 0 ? rb.pick(['Heat stress / bolting', 'Tip burn']) : rb.pick(['Pythium root rot', 'Germination failure', 'Pump failure', 'Contamination'])) : null,
        trays: (v.tiers as number) * 6,
        area,
        targetKg: target,
        harvestedKg,
        status,
        bins
      })
      const end = failedAt ?? harvest
      seed = addDays(end, rb.int(1, 3))
    }
  }
  const batchesBySeedMonth = new Map<number, GrowBatch[]>()
  const batchesByHarvestMonth = new Map<number, GrowBatch[]>()
  for (const b of batches) {
    const sk = monthKey(b.seeded)
    if (!batchesBySeedMonth.has(sk)) batchesBySeedMonth.set(sk, [])
    batchesBySeedMonth.get(sk)!.push(b)
    if (b.harvest) {
      const hk = monthKey(b.harvest)
      if (!batchesByHarvestMonth.has(hk)) batchesByHarvestMonth.set(hk, [])
      batchesByHarvestMonth.get(hk)!.push(b)
    }
  }

  // ---- tariffs ---------------------------------------------------------------------------------
  const tariff = new Map<string, number>()
  const tariffRows: Row[] = []
  const tariffBronze: BronzeRow[] = []
  const rt = ctx.rng('tariffs')
  let tariffFormatted = 0
  for (const farm of farms) {
    for (const m of monthsOf(start, today)) {
      if (endOfMonth(m).getTime() < farm.opened.getTime()) continue
      const yrs = (m.getUTCFullYear() - start.getUTCFullYear()) + m.getUTCMonth() / 12
      const rate = round(farm.tariffBase * (1 + 0.045 * yrs) * (m.getUTCMonth() === 6 || m.getUTCMonth() === 7 ? 1.12 : 1) * rt.float(0.98, 1.02), 4)
      tariff.set(`${farm.code}|${monthKey(m)}`, rate)
      tariffRows.push({ farm_code: farm.code, month_start: m, rate_per_kwh: rate })
      let text = rate.toFixed(4)
      if (rt.chance(0.35) || tariffFormatted === 0) {
        const mode = rt.int(0, 2)
        text = mode === 0 ? `$${rate.toFixed(4)}` : mode === 1 ? rate.toFixed(4).replace('.', ',') : `${rate.toFixed(4)} USD`
        tariffFormatted++
      }
      tariffBronze.push({ account: `UT-${farm.code}`, farm: farm.code, billing_month: `${m.getUTCFullYear()}-${pad(m.getUTCMonth() + 1)}`, rate: text })
    }
  }
  ctx.issue('LL18', tariffFormatted)

  // ---- static batch ----------------------------------------------------------------------------
  const T0: Record<string, Row[]> = {}
  const B0: BronzeFile[] = []
  T0.gold_dim_farm = farms.map((f) => ({
    farm_key: f.key, farm_code: f.code, farm_name: f.name, city: f.city, region: f.region, latitude: f.lat, longitude: f.lon, opened_date: f.opened,
    floor_area_m2: f.area, energy_source: f.energy, is_flagship: f.key === 1
  }))
  T0.silver_farms = farms.map((f) => ({
    farm_code: f.code, farm_name: f.name, city: f.city, region: f.region, latitude: f.lat, longitude: f.lon, opened_date: f.opened, floor_area_m2: f.area, energy_source: f.energy
  }))
  T0.gold_dim_room = rooms.map((r) => ({
    room_key: r.key, room_code: r.code, room_name: r.name, farm_key: r.farm.key, farm_name: r.farm.name, room_type: r.type, rack_count: r.racks.length,
    hvac_unit: r.hvac, temp_setpoint_c: r.setpoint
  }))
  T0.silver_rooms = rooms.map((r) => ({ room_code: r.code, farm_code: r.farm.code, room_name: r.name, room_type: r.type, hvac_unit: r.hvac, temp_setpoint_c: r.setpoint }))
  T0.gold_dim_rack = rackRows
  T0.silver_rack_config_history = []
  const rackBronze: BronzeRow[] = []
  for (const r of racks) {
    for (const v of r.versions) {
      T0.silver_rack_config_history.push({
        rack_id: r.id, room_code: r.room.code, effective_date: v.from, light_type: v.attrs.light_type, tiers: v.attrs.tiers,
        growing_area_m2: v.attrs.growing_area_m2, irrigation_system: v.attrs.irrigation_system
      })
      rackBronze.push({ rack_id: r.id, room: r.room.code, effective_date: v.from, light_type: v.attrs.light_type as string, tiers: v.attrs.tiers as number, area_m2: v.attrs.growing_area_m2 as number, irrigation: v.attrs.irrigation_system as string })
    }
  }
  const ra = ctx.rng('assets-bronze')
  injectCasing(rackBronze, 'light_type', { rng: ra, sink: ctx, code: 'LL13', rate: 0.12, atLeast: 1 })
  B0.push({
    source: 'assets', path: 'assets/rack_registry.json', format: 'json', rows: rackBronze,
    json: {
      envelope: {
        registry: 'RackTrack', exportedAt: formatDate(today, 'iso_t'),
        farms: farms.map((f) => ({ code: f.code, name: f.name, city: f.city, opened: isoDate(f.opened) })),
        rooms: rooms.map((r) => ({ code: r.code, farm: r.farm.code, name: r.name, type: r.type, hvac: r.hvac, setpoint_c: r.setpoint }))
      },
      dataKey: 'rack_configurations'
    }
  })
  T0.gold_dim_crop = CROPS.map((c, i) => ({
    crop_key: i + 1, crop_code: c.code, variety: c.variety, crop: c.crop, crop_category: c.category, germination_days: c.germ, grow_days: c.grow,
    target_yield_kg_m2: c.yieldKgM2, price_per_kg: c.price, heat_sensitive: c.heat
  }))
  T0.silver_crops = CROPS.map((c) => ({
    crop_code: c.code, variety: c.variety, crop: c.crop, crop_category: c.category, germination_days: c.germ, grow_days: c.grow, target_yield_kg_m2: c.yieldKgM2, price_per_kg: c.price
  }))
  const cropBronze: BronzeRow[] = CROPS.map((c) => ({
    Code: c.code, Variety: c.variety, Crop: c.crop, Category: c.category, 'Germination (d)': c.germ, 'Grow days': c.grow, 'Target kg/m²': c.yieldKgM2, 'Price / kg': c.price, 'Heat sensitive': c.heat ? 'yes' : 'no'
  }))
  const rc = ctx.rng('crop-bronze')
  injectFormattedNumbers(cropBronze, 'Price / kg', { rng: rc, sink: ctx, code: 'LL11', rate: 0.4, atLeast: 2 })
  injectWhitespace(cropBronze, 'Variety', { rng: rc, sink: ctx, code: 'LL12', rate: 0.2, atLeast: 1 })
  B0.push({ source: 'crop_plan', path: 'planning/crop_plan.xlsx', format: 'xlsx', rows: cropBronze, xlsx: { sheet: 'Crop Plan', titleLines: ['Leafloft Agronomy — Crop Plan', `Revision ${isoDate(today)} · targets per cycle`] } })

  const planPrice = (p: PlanDef, d: Date) => (d.getTime() >= priceRise.getTime() ? money(p.price * 1.08) : p.price)
  const planMonthlyCents = (pi: number, d: Date) => cents(planPrice(PLANS[pi], d) * BOXES[PLANS[pi].freq])
  T0.gold_dim_plan = PLANS.map((p, i) => ({
    plan_key: i + 1, plan_code: p.code, plan_name: p.name, plan_rank: i, box_size: p.size, frequency: p.freq, boxes_per_month: round(BOXES[p.freq], 4),
    launch_price_per_box: p.price, price_per_box: planPrice(p, today), monthly_price: planMonthlyCents(i, today) / 100
  }))
  T0.silver_plans = PLANS.map((p) => ({ plan_code: p.code, plan_name: p.name, box_size: p.size, frequency: p.freq, launch_price_per_box: p.price, price_per_box: planPrice(p, today), price_change_date: priceRise }))
  T0.gold_dim_addon = ADDONS.map((a, i) => ({ addon_key: i + 1, addon_code: a.code, addon_name: a.name, addon_category: a.category, monthly_price: a.price }))
  T0.silver_addons = ADDONS.map((a) => ({ addon_code: a.code, addon_name: a.name, addon_category: a.category, monthly_price: a.price }))
  B0.push(
    { source: 'catalog', path: 'catalog/plans.json', format: 'json', rows: PLANS.map((p) => ({ id: p.code, nickname: p.name, size: p.size, interval: p.freq.toLowerCase(), unit_amount_cents: cents(p.price), repriced_on: priceRise, repriced_unit_amount_cents: cents(planPrice(p, today)) })), json: { envelope: { object: 'list' }, dataKey: 'data' } },
    { source: 'catalog', path: 'catalog/addons.json', format: 'json', rows: ADDONS.map((a) => ({ id: a.code, name: a.name, category: a.category, monthly_amount_cents: cents(a.price) })), json: { envelope: { object: 'list' }, dataKey: 'data' } }
  )
  T0.silver_energy_tariffs = tariffRows
  B0.push({ source: 'utilities', path: 'utilities/energy_tariffs.csv', format: 'csv', rows: tariffBronze })
  yield { label: 'static', tables: T0, bronze: B0 }

  // ---- demand side state -----------------------------------------------------------------------
  const rs = ctx.rng('subscriptions')
  const customers: Customer[] = []
  const business: Customer[] = []
  let mesDatesPlanted = false
  let billingPlanted = false
  const subs: Sub[] = []
  const addonLinks: Array<{ sub: Sub; link: AddonLink }> = []
  let eventSeq = 0
  let deliverySeq = 0
  const pendingDeliveries = new Map<number, BronzeRow[]>()
  const pendingSensors = new Map<number, BronzeRow[]>()
  let firstSensorFile = true
  let firstDeliveryFile = true
  let driftLogged = false
  let sentinelPlanted = false
  let rolloverPlanted = false
  let orphanPlanted = false
  const rsens = ctx.rng('sensors')
  const rdel = ctx.rng('deliveries')
  const mrrOf = (s: Sub, d: Date) => planMonthlyCents(s.plan, d) + s.addons.filter((l) => !l.removed).reduce((a, l) => a + cents(ADDONS[l.addon].price), 0)

  const newCustomer = (d: Date, campaign: boolean): Customer => {
    const type = rs.weighted(['Household', 'Office', 'Restaurant'] as const, [0.85, 0.1, 0.05])
    const open = farms.filter((f) => farmOpenAt(f, d))
    const farm = rs.weighted(open, open.map((f) => f.weight))
    const p = personName(rs)
    const name = type === 'Household' ? p.full : orgName(rs, type === 'Office' ? ['Studios', 'Partners', 'Labs', 'Collective'] : ['Bistro', 'Kitchen', 'Canteen', 'Eatery'])
    const chW = campaign ? [0.15, 0.1, 0.4, 0.3, 0.03, 0.02] : [0.25, 0.2, 0.18, 0.08, 0.17, 0.12]
    const c: Customer = {
      key: customers.length + 1,
      id: `C-${pad(customers.length + 1, 6)}`,
      name,
      type,
      email: email(p.first, p.last, type === 'Household' ? 'mail.example' : 'work.example', rs),
      phone: rs.chance(0.74) ? `+1-555-01${pad(rs.int(0, 99))}-${pad(rs.int(0, 9999), 4)}` : null,
      zone: rs.pick(farm.zones),
      farm,
      channel: rs.weighted(CHANNELS, chW),
      signup: d
    }
    customers.push(c)
    return c
  }

  // ---- monthly simulation ------------------------------------------------------------------
  let prevFaultMonth = false
  for (const monthStart of monthsOf(start, today)) {
    const monthEnd = minDate(endOfMonth(monthStart), today)
    const mk = monthKey(monthStart)
    const nDays = daysBetween(monthStart, monthEnd) + 1
    const month = monthStart.getUTCMonth() + 1
    const isCampaign = monthKey(campaignMonth) === mk
    const T: Record<string, Row[]> = {
      gold_fact_room_env_day: [], silver_sensor_readings: [], gold_fact_delivery: [], silver_deliveries: [], gold_fact_subscription_month: [],
      silver_subscription_events: [], gold_fact_grow_batch: [], silver_grow_batches: [], silver_harvest_weighins: []
    }
    const bronze: BronzeFile[] = []
    const billing: BronzeRow[] = []
    // MRR movement accumulators (cents)
    const mv = new Map<Sub, { opening: number; nw: number; exp: number; react: number; contr: number; churn: number }>()
    const acc = (s: Sub) => {
      let m = mv.get(s)
      if (!m) mv.set(s, (m = { opening: s.status === 'Churned' ? 0 : s.mrr, nw: 0, exp: 0, react: 0, contr: 0, churn: 0 }))
      return m
    }
    for (const s of subs) if (s.status !== 'Churned') acc(s)

    const event = (s: Sub, d: Date, type: string, before: number, after: number, reason: string | null) => {
      const ts = new Date(d.getTime() + rs.int(7 * 3600, 22 * 3600) * 1000)
      const id = `EV-${pad(++eventSeq, 8)}`
      T.silver_subscription_events.push({
        event_id: id, subscription_id: s.id, event_type: type, occurred_at: ts, plan_code: PLANS[s.plan].code, mrr_before: before / 100, mrr_after: after / 100, reason
      })
      billing.push({ id, type, subscription: s.id, customer: s.customer.id, occurred_at: ts, plan: PLANS[s.plan].code, mrr_before_cents: before, mrr_after_cents: after, metadata: { reason } })
    }

    // schedule: day index → actions
    const schedule = new Map<number, Array<(d: Date) => void>>()
    const plan = (dayIdx: number, fn: (d: Date) => void) => {
      const list = schedule.get(dayIdx) ?? []
      list.push(fn)
      schedule.set(dayIdx, list)
    }
    const faultFarmHit = prevFaultMonth || (faultStart.getTime() <= monthEnd.getTime() && faultEnd.getTime() >= monthStart.getTime())
    prevFaultMonth = faultStart.getTime() <= monthEnd.getTime() && faultEnd.getTime() >= monthStart.getTime()
    const summer = month >= 6 && month <= 8
    const afterRise = monthKey(priceRise) === mk || monthKey(addDays(priceRise, 31)) === mk
    for (const s of subs) {
      const dayIdx = rs.int(0, nDays - 1)
      if (s.status === 'Active') {
        const tenure = (monthStart.getUTCFullYear() - s.cohort.getUTCFullYear()) * 12 + monthStart.getUTCMonth() - s.cohort.getUTCMonth()
        const quality = faultFarmHit && s.customer.farm === faultRoom.farm
        const pChurn = 0.03 * (tenure < 3 ? 1.6 : tenure > 12 ? 0.7 : 1) * (s.customer.channel === 'Influencer' ? 2 : 1) * (s.promo === 'SPRINGBLITZ' ? 1.6 : 1) *
          (summer ? 1.3 : 1) * (afterRise ? 2.2 : 1) * (quality ? 2.6 : 1) * (s.customer.type === 'Household' ? 1 : 0.6)
        const r = rs.next()
        let edge = pChurn
        if (r < edge) {
          const reason = quality && rs.chance(0.6) ? 'Quality Issue' : afterRise && rs.chance(0.5) ? 'Price' : rs.weighted(CHURN_REASONS, [0.15, 0.25, 0.15, 0.05, 0.2, 0.2])
          plan(dayIdx, (d) => {
            if (s.status !== 'Active') return
            const before = s.mrr
            acc(s).churn += before
            s.status = 'Churned'
            s.mrr = 0
            s.churnedAt = d
            s.churnReason = reason
            for (const l of s.addons) if (!l.removed) l.removed = d
            event(s, d, 'churn', before, 0, reason)
          })
          continue
        }
        edge += s.customer.type === 'Household' ? (summer ? 0.06 : 0.02) : 0
        if (r < edge) {
          plan(dayIdx, (d) => {
            if (s.status !== 'Active') return
            const before = s.mrr
            acc(s).contr += before
            s.status = 'Paused'
            s.mrr = 0
            s.pausedMonths = 0
            event(s, d, 'pause', before, 0, summer ? 'Vacation' : 'Temporary break')
          })
          continue
        }
        const maxRank = s.customer.type === 'Household' ? 4 : 5
        const options: Array<[string, number]> = [
          ['upgrade', s.plan < maxRank ? 0.025 : 0],
          ['downgrade', s.plan > 0 ? 0.018 : 0],
          ['addon_added', s.addons.filter((l) => !l.removed).length < ADDONS.length ? 0.03 : 0],
          ['addon_removed', s.addons.some((l) => !l.removed) ? 0.02 : 0]
        ]
        for (const [type, p] of options) {
          edge += p
          if (r >= edge) continue
          plan(dayIdx, (d) => {
            if (s.status !== 'Active') return
            const before = s.mrr
            if (type === 'upgrade') s.plan++
            else if (type === 'downgrade') s.plan--
            else if (type === 'addon_added') {
              const have = new Set(s.addons.filter((l) => !l.removed).map((l) => l.addon))
              const choice = rs.pick(ADDONS.map((_, i) => i).filter((i) => !have.has(i)))
              const link = { addon: choice, added: d, removed: null }
              if (s.addons.some((l) => l.addon === choice && l.added.getTime() === d.getTime())) return
              s.addons.push(link)
              addonLinks.push({ sub: s, link })
            } else {
              const live = s.addons.filter((l) => !l.removed)
              const l = rs.pick(live)
              if (l.added.getTime() === d.getTime()) return
              l.removed = d
            }
            s.mrr = mrrOf(s, d)
            const delta = s.mrr - before
            if (delta >= 0) acc(s).exp += delta
            else acc(s).contr += -delta
            event(s, d, type, before, s.mrr, null)
          })
          break
        }
      } else if (s.status === 'Paused') {
        s.pausedMonths++
        if (rs.chance(0.55) || s.pausedMonths >= 3) {
          const resume = s.pausedMonths < 3 || rs.chance(0.5)
          plan(dayIdx, (d) => {
            if (s.status !== 'Paused') return
            if (resume) {
              s.status = 'Active'
              s.mrr = mrrOf(s, d)
              acc(s).react += s.mrr
              event(s, d, 'resume', 0, s.mrr, null)
            } else {
              s.status = 'Churned'
              s.churnedAt = d
              s.churnReason = 'Did Not Resume'
              for (const l of s.addons) if (!l.removed) l.removed = d
              event(s, d, 'churn', 0, 0, 'Did Not Resume')
            }
          })
        }
      } else if (s.churnedAt && s.churnReason !== 'Moved Away' && daysBetween(s.churnedAt, monthStart) > 60 && rs.chance(0.015)) {
        plan(dayIdx, (d) => {
          if (s.status !== 'Churned') return
          const m = acc(s)
          s.status = 'Active'
          s.reactivations++
          s.mrr = mrrOf(s, d)
          m.react += s.mrr
          event(s, d, 'reactivate', 0, s.mrr, null)
        })
      }
    }
    // price rise (expansion for every paying subscription)
    if (monthKey(priceRise) === mk) {
      plan(0, (d) => {
        for (const s of subs) {
          if (s.status !== 'Active') continue
          const before = s.mrr
          s.mrr = mrrOf(s, d)
          if (s.mrr !== before) {
            acc(s).exp += s.mrr - before
            event(s, d, 'price_change', before, s.mrr, 'Annual price review')
          }
        }
      })
    }
    // signups
    const season = [1.5, 1.2, 1.1, 1, 1, 0.8, 0.75, 0.75, 1.15, 1.05, 0.9, 0.8][month - 1]
    const growth = 1 + 0.025 * Math.max(0, (monthStart.getUTCFullYear() - start.getUTCFullYear()) * 12 + monthStart.getUTCMonth())
    const nNew = rs.poisson(34 * ctx.scale.factor * season * growth * (isCampaign ? 2.2 : 1) * (nDays / 30))
    for (let i = 0; i < nNew; i++) {
      plan(rs.int(0, nDays - 1), (d) => {
        const customer = business.length && rs.chance(0.08) ? rs.pick(business) : newCustomer(d, isCampaign)
        if (customer.type !== 'Household' && !business.includes(customer)) business.push(customer)
        const planIdx = customer.type === 'Household' ? rs.weighted([0, 1, 2, 3, 4], [0.2, 0.2, 0.2, 0.25, 0.15]) : customer.type === 'Office' ? rs.weighted([4, 5], [0.3, 0.7]) : rs.weighted([4, 5], [0.4, 0.6])
        const s: Sub = {
          key: subs.length + 1, id: `S-${pad(subs.length + 1, 7)}`, customer, plan: planIdx, addons: [], status: 'Active', start: d, cohort: startOfMonth(d),
          promo: isCampaign && rs.chance(0.7) ? 'SPRINGBLITZ' : rs.chance(0.3) ? 'FIRSTBOX' : null, mrr: 0, pausedMonths: 0, churnedAt: null, churnReason: null,
          reactivations: 0, weekday: rs.int(1, 6), parity: rs.int(0, 1), deliveries: 0
        }
        for (let a = 0; a < ADDONS.length; a++) {
          if (rs.chance(0.12)) {
            const link = { addon: a, added: d, removed: null }
            s.addons.push(link)
            addonLinks.push({ sub: s, link })
          }
        }
        s.mrr = mrrOf(s, d)
        subs.push(s)
        acc(s).opening = 0
        acc(s).nw += s.mrr
        event(s, d, 'start', 0, s.mrr, null)
      })
    }

    let dayIdx = 0
    for (const day of eachDay(monthStart, monthEnd)) {
      const dk = dateKey(day)
      for (const fn of schedule.get(dayIdx) ?? []) fn(day)
      dayIdx++
      // ---- deliveries
      const weekIdx = Math.floor(daysBetween(start, day) / 7)
      const wd = isoDow(day)
      const deliveryRows: BronzeRow[] = []
      for (const s of subs) {
        if (s.status !== 'Active' || s.weekday !== wd || day.getTime() <= s.start.getTime()) continue
        const p = PLANS[s.plan]
        if (p.freq === 'Biweekly' && weekIdx % 2 !== s.parity) continue
        const r = rdel.next()
        const status = r < (summer ? 0.07 : 0.04) ? 'Skipped' : r < (summer ? 0.085 : 0.055) ? 'Failed' : 'Delivered'
        const winter = month === 12 || month <= 2
        const onTime = status === 'Delivered' && rdel.chance(0.955 - (winter ? 0.06 : 0) - (month === 12 && day.getUTCDate() > 15 ? 0.05 : 0))
        const boxValue = planPrice(p, day)
        const live = s.addons.filter((l) => !l.removed)
        const addonValue = money(live.reduce((a, l) => a + ADDONS[l.addon].price, 0) / BOXES[p.freq])
        const fee = p.size === 'S' || p.size === 'M' ? 3.99 : 0
        const discount = status === 'Delivered' && s.deliveries === 0 && s.promo ? money(boxValue * (s.promo === 'SPRINGBLITZ' ? 0.6 : 0.5)) : 0
        const net = status === 'Delivered' ? money(boxValue + addonValue + fee - discount) : 0
        if (status === 'Delivered') s.deliveries++
        const farm = farmOpenAt(s.customer.farm, day) ? s.customer.farm : farms[0]
        const weight = round(BOX_WEIGHT[p.size] * rdel.float(0.92, 1.08) + live.length * 0.35, 2)
        const items = BOX_ITEMS[p.size] + live.length
        const id = `D-${dk}-${pad(++deliverySeq, 7)}`
        const deliveredAt = status === 'Delivered' ? new Date(day.getTime() + rdel.int(8 * 3600, 19 * 3600) * 1000) : null
        T.gold_fact_delivery.push({
          delivery_id: id, delivery_date: day, delivery_date_key: dk, subscription_key: s.key, customer_key: s.customer.key, plan_key: s.plan + 1, farm_key: farm.key,
          status, is_on_time: onTime, box_value: boxValue, addon_value: addonValue, delivery_fee: fee, discount_amount: discount, net_amount: net, weight_kg: weight, items_count: items
        })
        T.silver_deliveries.push({
          delivery_id: id, subscription_id: s.id, customer_id: s.customer.id, plan_code: p.code, farm_code: farm.code, scheduled_date: day, delivered_at: deliveredAt, status,
          box_value: boxValue, addon_value: addonValue, delivery_fee: fee, discount_amount: discount, net_amount: net, weight_kg: weight, items_count: items
        })
        deliveryRows.push({
          manifest_id: id, sub_id: s.id, cust_id: s.customer.id, plan: p.code, hub: farm.code, scheduled_date: day, delivered_at: deliveredAt, status, box: boxValue,
          addons: addonValue, fee, discount, total: net, weight_kg: weight, items, on_time: onTime ? 'Y' : 'N'
        })
      }
      for (const row of deliveryRows) {
        const land = minDate(landingDay(day, { rng: rdel, sink: ctx, code: 'LL16', rate: 0.01, maxDelay: 5 }), today)
        const k = dateKey(land)
        const list = pendingDeliveries.get(k)
        if (list) list.push(row)
        else pendingDeliveries.set(k, [row])
      }
      const landedD = pendingDeliveries.get(dk) ?? []
      pendingDeliveries.delete(dk)
      if (landedD.length) {
        injectCasing(landedD, 'status', { rng: rdel, sink: ctx, code: 'LL17', rate: 0.03, atLeast: firstDeliveryFile ? 1 : 0 })
        firstDeliveryFile = false
        bronze.push({
          source: 'logistics', path: `logistics/${day.getUTCFullYear()}/${pad(month)}/deliveries_${dk}.csv`, format: 'csv', rows: landedD,
          columns: ['manifest_id', 'sub_id', 'cust_id', 'plan', 'hub', 'scheduled_date', 'delivered_at', 'status', 'box', 'addons', 'fee', 'discount', 'total', 'weight_kg', 'items', 'on_time']
        })
      }

      // ---- room telemetry
      const sensorRows: BronzeRow[] = []
      for (const room of rooms) {
        if (!farmOpenAt(room.farm, day)) continue
        const fault = inFault(room, day)
        const rackV = room.racks.map((r) => versionAt(r, day))
        const tiersTotal = rackV.reduce((a, v) => a + (v.tiers as number), 0)
        const lightKw = rackV.reduce((a, v) => a + (v.tiers as number) * (v.light_kw_per_tier as number), 0)
        const gen2Share = rackV.filter((v) => v.light_type === 'LED Gen2').length / rackV.length
        const season = annualCycle(day, 200, 1) - 1
        const temps: number[] = []
        const hums: number[] = []
        const co2s: number[] = []
        const ppfds: number[] = []
        const phs: number[] = []
        const ecs: number[] = []
        let kwhSum = 0
            let alerts = 0
        let missing = 0
        const ec0 = room.type === 'Microgreens' ? 1.2 : room.type === 'Fruiting' ? 2.4 : 1.8
        SLOT_HOURS.forEach((h, si) => {
          const lf = LIGHT_FRAC[si]
          const ts = new Date(day.getTime() + h * 3_600_000)
          const temp = round((lf > 0 ? room.setpoint : room.setpoint - 2.5) + rsens.normal(0, 0.45) + 0.6 * season + (fault ? 5.5 + 2 * lf : 0), 2)
          const hum = round(clamp(68 + rsens.normal(0, 2.5) - (fault ? 15 : 0), 30, 98), 1)
          const co2 = round((lf > 0 ? 950 : 620) + rsens.normal(0, 35) + co2Drift(room, day), 0)
          const ppfd = round(lf * (220 + 45 * gen2Share) + (lf > 0 ? rsens.normal(0, 4) : 0), 1)
          const ph = round(6 + rsens.normal(0, 0.12), 2)
          const ec = round(ec0 + rsens.normal(0, 0.1), 2)
          const hvacKw = (1.5 + 0.12 * tiersTotal) * (1 + 0.25 * season) * (fault ? 1.3 : 1)
          const kwh = round((lightKw * lf + hvacKw) * 4 * rsens.float(0.97, 1.03), 2)
          const sentinel = rsens.chance(0.004) || (!sentinelPlanted && day.getTime() >= addDays(start, 3).getTime())
          const rollover = rsens.chance(0.003) || (!rolloverPlanted && day.getTime() >= addDays(start, 5).getTime())
          if (sentinel) {
            sentinelPlanted = true
            ctx.issue('LL03')
          }
          if (rollover) {
            rolloverPlanted = true
            ctx.issue('LL05')
          }
          const vpd = round(0.6108 * Math.exp((17.27 * temp) / (temp + 237.3)) * (1 - hum / 100), 3)
          const newFw = ts.getTime() >= firmware.getTime()
          T.silver_sensor_readings.push({
            room_code: room.code, reading_ts: ts, temp_c: sentinel ? null : temp, humidity_pct: hum, co2_ppm: co2, ppfd, ph, ec, energy_kwh: rollover ? null : kwh, vpd_kpa: newFw ? vpd : null
          })
          const row: BronzeRow = {
            device_id: `CL-${room.code}`, room: room.code, ts, temp_c: sentinel ? rsens.pick([-999, 9999]) : temp, ...(newFw ? { humidity: hum } : { rh_pct: hum }),
            co2_ppm: co2, ppfd, ph, ec, kwh: rollover ? -round(rsens.float(800, 9000), 2) : kwh, ...(newFw ? { vpd_kpa: vpd } : {})
          }
          sensorRows.push(row)
          if (sentinel) missing++
          else {
            temps.push(temp)
            if (temp < 16 || temp > 26 || hum < 50 || hum > 85) alerts++
          }
          hums.push(hum)
          co2s.push(co2)
          ppfds.push(ppfd)
          phs.push(ph)
          ecs.push(ec)
          if (!rollover) {
            kwhSum += kwh
          }
        })
        const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
        const energy = round(kwhSum, 2)
        const rate = tariff.get(`${room.farm.code}|${mk}`) ?? 0
        T.gold_fact_room_env_day.push({
          room_key: room.key, date_key: dk, reading_date: day, readings_count: temps.length, missing_readings: missing,
          avg_temp_c: temps.length ? round(avg(temps)!, 3) : null, min_temp_c: temps.length ? Math.min(...temps) : null, max_temp_c: temps.length ? Math.max(...temps) : null,
          avg_humidity_pct: round(avg(hums)!, 2), avg_co2_ppm: round(avg(co2s)!, 1), avg_ppfd: round(avg(ppfds)!, 1), dli_mol_m2: round((ppfds.reduce((a, b) => a + b, 0) * 4 * 3600) / 1e6, 2),
          avg_ph: round(avg(phs)!, 3), avg_ec: round(avg(ecs)!, 3), energy_kwh: energy, energy_cost: money(energy * rate), alert_count: alerts, is_hvac_fault: fault
        })
      }
      for (const row of sensorRows) {
        const land = minDate(landingDay(day, { rng: rsens, sink: ctx, code: 'LL02', rate: 0.006, maxDelay: 4 }), today)
        const k = dateKey(land)
        const list = pendingSensors.get(k)
        if (list) list.push(row)
        else pendingSensors.set(k, [row])
      }
      const landedS = pendingSensors.get(dk) ?? []
      pendingSensors.delete(dk)
      if (landedS.length) {
        if (!driftLogged && day.getTime() >= firmware.getTime()) {
          ctx.issue('LL04')
          driftLogged = true
        }
        const rows = injectDuplicates(landedS, { rng: rsens, sink: ctx, code: 'LL01', rate: 0.004, atLeast: firstSensorFile ? 1 : 0 })
        firstSensorFile = false
        bronze.push({ source: 'sensors', path: `sensors/${day.getUTCFullYear()}/${pad(month)}/${pad(day.getUTCDate())}/telemetry_${dk}.ndjson`, format: 'ndjson', rows })
      }
    }

    // ---- month end: MRR snapshot -------------------------------------------------------------
    const snap = monthEnd
    for (const s of subs) {
      const m = mv.get(s)
      if (!m) continue
      const closing = s.status === 'Active' ? s.mrr : 0
      const churnedNow = s.status === 'Churned' && s.churnedAt !== null && s.churnedAt.getTime() >= monthStart.getTime()
      if (m.opening === 0 && closing === 0 && m.nw === 0 && m.churn === 0 && m.contr === 0 && m.react === 0 && m.exp === 0 && s.status !== 'Paused' && !churnedNow) continue
      if (m.opening + m.nw + m.exp + m.react - m.contr - m.churn !== closing) throw new Error(`leafloft: MRR bridge broken for ${s.id} in ${mk}`)
      const tenure = (snap.getUTCFullYear() - s.cohort.getUTCFullYear()) * 12 + snap.getUTCMonth() - s.cohort.getUTCMonth()
      T.gold_fact_subscription_month.push({
        subscription_key: s.key, customer_key: s.customer.key, plan_key: s.plan + 1, month_date_key: dateKey(snap), cohort_date_key: dateKey(s.cohort), snapshot_date: snap,
        tenure_month: tenure, opening_mrr: m.opening / 100, new_mrr: m.nw / 100, expansion_mrr: m.exp / 100, reactivation_mrr: m.react / 100, contraction_mrr: m.contr / 100,
        churned_mrr: m.churn / 100, closing_mrr: closing / 100, is_active_end: s.status === 'Active', status_end: s.status
      })
    }

    // ---- grow batches seeded this month (state as of today) & harvests this month -------------
    const mesRows: BronzeRow[] = []
    for (const b of batchesBySeedMonth.get(mk) ?? []) {
      const dk2 = (d: Date | null) => (d && d.getTime() <= today.getTime() ? dateKey(d) : null)
      const d2 = (d: Date | null) => (d && d.getTime() <= today.getTime() ? d : null)
      T.gold_fact_grow_batch.push({
        batch_id: b.id, rack_sk: b.rackSk, room_key: b.rack.room.key, crop_key: b.cropKey, seeded_date: b.seeded, seeded_date_key: dateKey(b.seeded),
        germinated_date_key: b.failed && b.failed.getTime() < b.germinated.getTime() ? null : dk2(b.germinated),
        transplanted_date_key: b.failed && b.transplanted && b.failed.getTime() < b.transplanted.getTime() ? null : dk2(b.transplanted),
        planned_harvest_date_key: dateKey(b.planned), harvest_date_key: b.harvest ? dateKey(b.harvest) : null, trays: b.trays, growing_area_m2: b.area, target_yield_kg: b.targetKg,
        harvested_kg: b.harvestedKg, yield_vs_target: b.status === 'Harvested' ? round(b.harvestedKg / b.targetKg, 4) : null,
        days_to_harvest: b.harvest ? daysBetween(b.seeded, b.harvest) : null, harvest_value: money(b.harvestedKg * b.crop.price), status: b.status, failure_reason: b.failureReason
      })
      const germ = b.failed && b.failed.getTime() < b.germinated.getTime() ? null : d2(b.germinated)
      const trans = b.failed && b.transplanted && b.failed.getTime() < b.transplanted.getTime() ? null : d2(b.transplanted)
      T.silver_grow_batches.push({
        batch_id: b.id, rack_id: b.rack.id, crop_code: b.crop.code, seeded_date: b.seeded, germinated_date: germ, transplanted_date: trans, planned_harvest_date: b.planned,
        harvest_date: b.harvest, trays: b.trays, status: b.status, failure_reason: b.failureReason, harvested_kg: b.harvestedKg
      })
      mesRows.push({
        batch_id: b.id, rack_id: b.rack.id, crop_code: b.crop.code, seeded: b.seeded, germinated: germ, transplanted: trans, planned_harvest: b.planned, harvest_date: b.harvest,
        trays: b.trays, status: b.status.toUpperCase(), failure_reason: b.failureReason ?? '', harvested_kg: b.harvestedKg
      })
    }
    const harvestRows: BronzeRow[] = []
    let binSeq = 0
    for (const b of batchesByHarvestMonth.get(mk) ?? []) {
      b.bins.forEach((g, i) => {
        const id = `BIN-${b.id.slice(2)}-${pad(i + 1)}`
        const atTs = new Date(b.harvest!.getTime() + (7 * 3600 + i * 420 + ++binSeq) * 1000)
        T.silver_harvest_weighins.push({ bin_id: id, batch_id: b.id, weighed_at: atTs, net_kg: g / 1000 })
        harvestRows.push({ bin_id: id, batch_id: b.id, scale_id: `SC-${b.rack.room.farm.code}-${(i % 3) + 1}`, weighed_at: atTs, net_g: g })
      })
    }
    const nOrphans = harvestRows.length ? rs.poisson(1) + (orphanPlanted ? 0 : 1) : 0
    for (let i = 0; i < nOrphans; i++) {
      orphanPlanted = true
      const base = harvestRows[rs.int(0, harvestRows.length - 1)]
      harvestRows.push({ ...base, bin_id: `BIN-TEST-${mk}-${i + 1}`, batch_id: rs.chance(0.5) ? `B-TEST-${pad(rs.int(1, 99), 4)}` : `B-XX-${pad(rs.int(0, 999999), 6)}`, net_g: rs.int(100, 900) })
    }
    ctx.issue('LL15', nOrphans)

    const y = monthStart.getUTCFullYear()
    const ym = `${y}${pad(month)}`
    const mo = { rng: rs, sink: ctx }
    const mesForce = !mesDatesPlanted && mesRows.some((r) => r.harvest_date instanceof Date)
    if (mesForce) mesDatesPlanted = true
    injectDateFormats(mesRows, 'harvest_date', { ...mo, code: 'LL14', rate: 0.1, formats: ['eu'], atLeast: mesForce ? 1 : 0 })
    const billForce = !billingPlanted && billing.length > 0
    if (billForce) billingPlanted = true
    injectCasing(billing, 'type', { ...mo, code: 'LL07', rate: 0.05, atLeast: billForce ? 1 : 0 })
    injectDateFormats(billing, 'occurred_at', { ...mo, code: 'LL08', rate: 0.06, formats: ['epoch', 'us'], atLeast: billForce ? 1 : 0 })
    const billingRows = injectDuplicates(billing, { ...mo, code: 'LL06', rate: 0.01, atLeast: billForce ? 1 : 0 })
    if (billingRows.length) bronze.push({ source: 'billing', path: `billing/${y}/subscription_events_${ym}.json`, format: 'json', rows: billingRows, json: { envelope: { object: 'list', url: '/v1/subscription_events', has_more: false }, dataKey: 'data' } })
    if (mesRows.length) bronze.push({ source: 'mes', path: `mes/${y}/grow_batches_${ym}.csv`, format: 'csv', rows: mesRows, csv: { delimiter: ';' } })
    if (harvestRows.length) bronze.push({ source: 'harvest', path: `harvest/${y}/weighins_${ym}.csv`, format: 'csv', rows: harvestRows })
    yield { label: `${y}-${pad(month)}`, tables: T, bronze }
  }

  // ---- closing: customers, subscriptions, add-on bridge ---------------------------------------
  const rcl = ctx.rng('crm-bronze')
  const crmRows: BronzeRow[] = customers.map((c) => {
    let phone: string | null = c.phone
    if (phone === null) {
      phone = rcl.pick(['', 'NULL', 'n/a', '-', null] as Array<string | null>)
      ctx.issue('LL10')
    }
    return { customer_id: c.id, full_name: c.name, type: c.type, email: c.email, phone, zone: c.zone, city: c.farm.city, channel: c.channel, signup_date: c.signup }
  })
  injectWhitespace(crmRows, 'full_name', { rng: rcl, sink: ctx, code: 'LL09', rate: 0.05, atLeast: 1 })
  const cohortKey = (d: Date) => d.getUTCFullYear() * 100 + d.getUTCMonth() + 1
  yield {
    label: 'closing',
    tables: {
      gold_dim_customer: customers.map((c) => ({
        customer_key: c.key, customer_id: c.id, customer_name: c.name, customer_type: c.type, delivery_zone: c.zone, city: c.farm.city, acquisition_channel: c.channel,
        signup_date: c.signup, cohort_month: `${c.signup.getUTCFullYear()}-${pad(c.signup.getUTCMonth() + 1)}`, cohort_month_key: cohortKey(c.signup)
      })),
      silver_customers: customers.map((c) => ({
        customer_id: c.id, customer_name: c.name, customer_type: c.type, email: c.email, phone: c.phone, delivery_zone: c.zone, city: c.farm.city, acquisition_channel: c.channel, signup_date: c.signup
      })),
      gold_dim_subscription: subs.map((s) => ({
        subscription_key: s.key, subscription_id: s.id, customer_id: s.customer.id, start_date: s.start, churn_date: s.status === 'Churned' ? s.churnedAt : null, status: s.status,
        current_plan: PLANS[s.plan].name, churn_reason: s.status === 'Churned' ? s.churnReason : null, signup_promo: s.promo, times_reactivated: s.reactivations
      })),
      silver_subscriptions: subs.map((s) => ({
        subscription_id: s.id, customer_id: s.customer.id, start_date: s.start, status: s.status, plan_code: PLANS[s.plan].code, current_mrr: s.status === 'Active' ? s.mrr / 100 : 0,
        churn_date: s.status === 'Churned' ? s.churnedAt : null, churn_reason: s.status === 'Churned' ? s.churnReason : null, signup_promo: s.promo
      })),
      gold_bridge_subscription_addon: addonLinks.map(({ sub, link }) => ({
        subscription_key: sub.key, addon_key: link.addon + 1, added_date: link.added, removed_date: link.removed, is_active: link.removed === null
      })),
      silver_subscription_addons: addonLinks.map(({ sub, link }) => ({ subscription_id: sub.id, addon_code: ADDONS[link.addon].code, added_date: link.added, removed_date: link.removed }))
    },
    bronze: [{ source: 'crm', path: 'crm/customers.csv', format: 'csv', rows: crmRows, csv: { quoteAll: true, lineEnding: '\r\n' } }]
  }
}

