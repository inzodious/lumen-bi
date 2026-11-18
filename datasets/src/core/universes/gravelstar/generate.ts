/**
 * Gravelstar Mining Consortium — simulation.
 *
 * Daily per vessel: wear accumulates with operating hours (harder rock wears faster) → vibration,
 * bearing temperature and fault codes climb → planned maintenance resets wear, deferred maintenance
 * lets breakdown hazard explode. Rigs drill three shifts on their assigned claim; ore is assayed
 * (grades deplete as a claim is mined) and shuttled to the belt's refinery, which recovers each
 * mineral into stock. Freighters load refined product and deliver it to customers under fixed,
 * index-linked or spot contracts priced off a mean-reverting commodity index with planted shocks.
 * Crew rotate through vessels on tours of duty; safety incidents depend on wear, shift and a
 * planted decompression cluster.
 *
 * Volume: the fleet scales with --scale (small ≈ one operating division, large ≈ the whole
 * consortium); per-vessel physics stay identical, so rates and ratios do not depend on scale.
 */
import type { Scalar } from '../../../../../src/core/model/data.ts'
import {
  addDays, dateKey, dateOnly, daysBetween, eachDay, endOfMonth, maxDate, minDate, monthKey, startOfMonth, ymd
} from '../../calendar.ts'
import {
  formatDate, injectCasing, injectDateFormats, injectDuplicates, injectFormattedNumbers, injectOutliers, injectWhitespace, landingDay
} from '../../chaos.ts'
import { clamp, round } from '../../prng.ts'
import { Scd2Index, scd2Rows } from '../../scd2.ts'
import type { Scd2Version } from '../../scd2.ts'
import type { Batch, BronzeFile, BronzeRow, GenContext, Row } from '../../schema.ts'
import { personName } from '../../words.ts'

// ---------------------------------------------------------------------------------------------
// Reference data

interface MineralDef {
  code: string
  name: string
  group: string
  price: number
  grade: number
  sigma: number
}

export const MINERALS: MineralDef[] = [
  { code: 'NIFE', name: 'Nickel-Iron', group: 'Base Metals', price: 1.5, grade: 0.14, sigma: 0.012 },
  { code: 'CO', name: 'Cobalt', group: 'Base Metals', price: 30, grade: 0.006, sigma: 0.015 },
  { code: 'REE', name: 'Rare Earths', group: 'Base Metals', price: 60, grade: 0.003, sigma: 0.015 },
  { code: 'PT', name: 'Platinum', group: 'Precious Metals', price: 26000, grade: 0.00002, sigma: 0.012 },
  { code: 'IR', name: 'Iridium', group: 'Precious Metals', price: 45000, grade: 0.000008, sigma: 0.018 },
  { code: 'H2O', name: 'Water Ice', group: 'Volatiles', price: 1.1, grade: 0.15, sigma: 0.02 },
  { code: 'NH3', name: 'Ammonia Ice', group: 'Volatiles', price: 2.5, grade: 0.05, sigma: 0.02 },
  { code: 'LUM', name: 'Lumenite', group: 'Exotics', price: 12000, grade: 0.00003, sigma: 0.03 }
]

const CLASS_MIX: Record<string, string[]> = {
  'C-type': ['H2O', 'NH3', 'REE'],
  'S-type': ['NIFE', 'REE'],
  'M-type': ['NIFE', 'PT', 'CO', 'IR'],
  'X-type': ['LUM', 'IR', 'NIFE']
}

interface StationDef {
  code: string
  name: string
  type: string
  belt: string
  sector: string
  r: number
  bays: number
  pop: number
  owned: boolean
}

const STATIONS: StationDef[] = [
  { code: 'STN-01', name: 'Pebble Port', type: 'Habitat', belt: 'Inner Gravel Ring', sector: 'Sector 1 — Lantern Reach', r: 1.92, bays: 40, pop: 12400, owned: false },
  { code: 'STN-02', name: 'Anvil Refinery', type: 'Refinery', belt: 'Inner Gravel Ring', sector: 'Sector 2 — Cinder Arc', r: 2.05, bays: 18, pop: 1450, owned: true },
  { code: 'STN-03', name: 'Crucible Refinery', type: 'Refinery', belt: 'Middle Ring', sector: 'Sector 4 — Hollow Drift', r: 2.48, bays: 22, pop: 1900, owned: true },
  { code: 'STN-04', name: "Smelter's Rest Refinery", type: 'Refinery', belt: 'Outer Rubble Belt', sector: 'Sector 7 — Grumble Deep', r: 2.97, bays: 14, pop: 980, owned: true },
  { code: 'STN-05', name: 'Driftwood Depot', type: 'Depot', belt: 'Middle Ring', sector: 'Sector 5 — Tinker Gap', r: 2.6, bays: 10, pop: 320, owned: true },
  { code: 'STN-06', name: 'Ironhook Depot', type: 'Depot', belt: 'Outer Rubble Belt', sector: 'Sector 8 — Lastlight', r: 3.1, bays: 8, pop: 210, owned: true },
  { code: 'STN-07', name: 'Halcyon Drydock', type: 'Shipyard', belt: 'Inner Gravel Ring', sector: 'Sector 1 — Lantern Reach', r: 1.88, bays: 30, pop: 5200, owned: false },
  { code: 'STN-08', name: 'Orrery Fuel Depot', type: 'Fuel Depot', belt: 'Middle Ring', sector: 'Sector 4 — Hollow Drift', r: 2.41, bays: 26, pop: 760, owned: false },
  { code: 'STN-09', name: 'Bluefen Habitat', type: 'Habitat', belt: 'Outer Rubble Belt', sector: 'Sector 7 — Grumble Deep', r: 2.9, bays: 20, pop: 8800, owned: false }
]

const BELTS = [
  { belt: 'Inner Gravel Ring', sectors: ['Sector 1 — Lantern Reach', 'Sector 2 — Cinder Arc'], refinery: 'STN-02' },
  { belt: 'Middle Ring', sectors: ['Sector 4 — Hollow Drift', 'Sector 5 — Tinker Gap'], refinery: 'STN-03' },
  { belt: 'Outer Rubble Belt', sectors: ['Sector 7 — Grumble Deep', 'Sector 8 — Lastlight'], refinery: 'STN-04' }
]

const CUSTOMERS: Array<{ code: string; name: string; segment: string; station: string; terms: number; rating: string | null }> = [
  { code: 'CUS-01', name: 'Halcyon Drydock Shipyards', segment: 'Shipyard', station: 'STN-07', terms: 45, rating: 'AA' },
  { code: 'CUS-02', name: 'Orrery Fuel Authority', segment: 'Fuel Depot', station: 'STN-08', terms: 30, rating: 'AAA' },
  { code: 'CUS-03', name: 'Pebblebrook Colony Trust', segment: 'Habitat', station: 'STN-01', terms: 60, rating: 'A' },
  { code: 'CUS-04', name: 'Mistral Arc Fabricators', segment: 'Fabricator', station: 'STN-05', terms: 45, rating: null },
  { code: 'CUS-05', name: 'Bluefen Habitat Cooperative', segment: 'Habitat', station: 'STN-09', terms: 60, rating: 'BB' },
  { code: 'CUS-06', name: 'Tessellate Orbital Works', segment: 'Fabricator', station: 'STN-01', terms: 30, rating: 'A' },
  { code: 'CUS-07', name: 'Corvid Line Shipwrights', segment: 'Shipyard', station: 'STN-07', terms: 45, rating: null },
  { code: 'CUS-08', name: 'Stillwater Volatiles Exchange', segment: 'Fuel Depot', station: 'STN-08', terms: 30, rating: 'A' },
  { code: 'CUS-09', name: 'Amberdeep Reactor Supply', segment: 'Fabricator', station: 'STN-06', terms: 45, rating: 'BBB' },
  { code: 'CUS-10', name: 'Quillon Microfab', segment: 'Fabricator', station: 'STN-05', terms: 30, rating: null },
  { code: 'CUS-11', name: 'Juniper Station Commissary', segment: 'Habitat', station: 'STN-09', terms: 30, rating: 'B' },
  { code: 'CUS-12', name: 'Ninefold Optics Guild', segment: 'Fabricator', station: 'STN-01', terms: 45, rating: 'AA' },
  { code: 'CUS-13', name: 'Saltmarsh Terraforming Co.', segment: 'Habitat', station: 'STN-06', terms: 60, rating: 'BB' }
]
const EXCHANGE = { code: 'CUS-99', name: 'Belt Commodity Exchange', segment: 'Exchange', station: 'STN-01', terms: 15, rating: 'AAA' as string | null }
const LATE_PAYER = 'CUS-05'

const SEGMENT_DEMAND: Record<string, string[]> = {
  Shipyard: ['NIFE', 'CO', 'PT'],
  'Fuel Depot': ['H2O', 'NH3'],
  Fabricator: ['REE', 'PT', 'IR', 'CO', 'LUM'],
  Habitat: ['H2O', 'NIFE', 'NH3']
}

const ASTEROIDS = [
  'Grumbleton', 'Mossback', 'Old Crumble', 'The Biscuit', 'Tumbleweed', 'Big Sulk', 'Potato Prime', 'Little Lumpy', 'Gravel Gertie', 'Sir Rocksalot',
  'Pockmark', 'Bramblestone', 'Thimble', 'Snorehaven', 'Crumpet', 'Knuckle', 'Wobbler', 'Dusty Pete', 'Hollow Hank', 'Craggy', 'Pumice Pat', 'Moody Blue',
  'Cobblepot', 'Scree Louise', 'Nubbin', 'The Anvil', 'Lazy Susan', 'Grit Spinner', 'Pebbledash', 'Clod Hopper'
]
const RIG_NAMES = [
  'Old Rattler', 'Gravel Gertie II', 'Pocket Rocket', 'Dusty Margaret', 'Stubborn Mule', 'Clanker', 'Grit Expectations', 'Stone Cold Sober', 'Pickaxe Pete',
  'Miss Fortune', 'Tunnel Vision', 'Bedrock Betty', 'Crust Buster', 'Mother Lode', 'Drillbert', 'Rubble Trouble', 'Core Blimey', 'Heavy Petal', 'Sediment Al',
  'Quarry Fairy', 'Shale We Dance', 'Basalt Faulty', 'Feldspar Fanny', 'Nugget', 'Grindstone'
]
const FREIGHTER_NAMES = ['Slow Boat', 'Long Haul Linda', 'Freight Expectations', 'Haul of Fame', 'Bulk Bertha', 'Penny Dreadful', 'Steady Eddie', 'Big Tuna', 'Space Mule', 'Patience', 'Sluggard', 'Tortoise Express']
const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X']

export const SHIFTS = ['Alpha', 'Beta', 'Gamma']
export const MODES = ['Crewed', 'Autonomous']
export const INCIDENT_CATEGORIES = ['Decompression', 'Tether Failure', 'Equipment Strike', 'Radiation Exposure', 'Fire', 'Collision', 'Chemical']
export const SEVERITIES = ['Near Miss', 'First Aid', 'Lost Time', 'Major']

// ---------------------------------------------------------------------------------------------

interface Claim {
  key: number
  code: string
  name: string
  designation: string
  cls: string
  belt: string
  sector: string
  refinery: string
  minerals: Array<{ code: string; grade: number }>
  reserves: number
  hardness: number
  strip: number
  registered: Date
  mined: number
}

interface Vessel {
  id: string
  name: string
  cls: 'Drill Rig' | 'Freighter'
  hull: string
  commissioned: Date
  versions: Scd2Version[]
  baseRate: number
  power: number
  wearRate: number
  maintProb: number
  // runtime
  wear: number
  downtime: number
  pendingCost: number
}

interface Crew {
  key: number
  id: string
  name: string
  role: string
  cert: string
  certRank: number
  home: string
  hire: Date
  leave: Date | null
  freeFrom: number
}

interface Contract {
  key: number
  code: string
  customer: string
  mineral: string
  type: 'Fixed' | 'Index-Linked' | 'Spot'
  fixed: number | null
  premium: number | null
  volume: number
  start: Date
  end: Date
}

const money = (v: number) => round(v, 2)

function attrsAt(versions: Scd2Version[], d: Date): Record<string, Scalar> {
  let cur = versions[0].attrs
  for (const v of versions) if (v.from.getTime() <= d.getTime()) cur = v.attrs
  return cur
}

class MinHeap<T> {
  private items: Array<{ k: number; v: T }> = []
  get size(): number {
    return this.items.length
  }
  push(k: number, v: T): void {
    const a = this.items
    a.push({ k, v })
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p].k <= a[i].k) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop(): { k: number; v: T } | undefined {
    const a = this.items
    if (!a.length) return undefined
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l].k < a[m].k) m = l
        if (r < a.length && a[r].k < a[m].k) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}

function ym(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function* monthsOf(start: Date, end: Date): Generator<Date> {
  for (let d = startOfMonth(start); d.getTime() <= end.getTime(); d = ymd(d.getUTCFullYear(), d.getUTCMonth() + 2, 1)) yield d
}

// ---------------------------------------------------------------------------------------------

export function* generateGravelstar(ctx: GenContext): Generator<Batch> {
  const today = ctx.today
  const start = ctx.start
  const span = daysBetween(start, today)
  const DAY = 86_400_000
  const mineralByCode = new Map(MINERALS.map((m, i) => [m.code, { ...m, key: i + 1 }]))
  const stationByCode = new Map(STATIONS.map((s, i) => [s.code, { ...s, key: i + 1 }]))

  // ---- commodity price index (mean-reverting log price with planted shocks) ---------------
  const rpx = ctx.rng('prices')
  const price = new Map<string, Float64Array>()
  const irShock = Math.floor(span * 0.45)
  const iceCrash = Math.floor(span * 0.7)
  for (const m of MINERALS) {
    const arr = new Float64Array(span + 1)
    let x = rpx.normal(0, 0.05)
    for (let i = 0; i <= span; i++) {
      x = 0.985 * x + rpx.normal(0, m.sigma)
      let shock = 0
      if (m.code === 'IR' && i >= irShock) shock = 0.55 * Math.exp(-(i - irShock) / 70)
      if (m.code === 'H2O' && i >= iceCrash) shock = -0.4 * Math.exp(-(i - iceCrash) / 120)
      const trend = m.code === 'LUM' ? 0.25 * (i / Math.max(1, span)) : 0
      arr[i] = round(m.price * Math.exp(x + shock + trend), 2)
    }
    price.set(m.code, arr)
  }
  const priceOn = (code: string, d: Date) => price.get(code)![clamp(daysBetween(start, d), 0, span)]

  // ---- claims ------------------------------------------------------------------------------
  const rc = ctx.rng('claims')
  const nClaims = Math.max(3, ctx.n(16, 3))
  const claims: Claim[] = []
  for (let i = 0; i < nClaims; i++) {
    const belt = BELTS[i % BELTS.length]
    const jackpot = i === 2
    const cls = jackpot ? 'X-type' : rc.weighted(['C-type', 'S-type', 'M-type', 'X-type'], [0.32, 0.3, 0.3, 0.08])
    const mix = CLASS_MIX[cls]
    const k = cls === 'M-type' ? mix.length : Math.min(mix.length, rc.int(2, 3))
    const minerals = mix.slice(0, k).map((code, j) => ({ code, grade: mineralByCode.get(code)!.grade * rc.logNormal(1, 0.3) * (j === 0 ? 1 : 0.6) }))
    const registered = jackpot && !ctx.tiny ? addDays(start, Math.floor(span * 0.42)) : addDays(start, -rc.int(60, 2500))
    claims.push({
      key: i + 1,
      code: `CLM-${String(101 + i)}`,
      name: ASTEROIDS[i % ASTEROIDS.length] + ROMAN[Math.floor(i / ASTEROIDS.length) % ROMAN.length],
      designation: `${rc.int(1100, 99999)} ${String.fromCharCode(65 + rc.int(0, 25))}${String.fromCharCode(65 + rc.int(0, 25))}${rc.int(1, 99)}`,
      cls,
      belt: belt.belt,
      sector: rc.pick(belt.sectors),
      refinery: belt.refinery,
      minerals,
      reserves: round(rc.logNormal(4_000_000, 0.5), 0),
      hardness: round(cls === 'M-type' || cls === 'X-type' ? rc.float(1.4, 2) : rc.float(1, 1.5), 2),
      strip: rc.float(0.3, 1.2),
      registered: dateOnly(registered),
      mined: 0
    })
  }
  const jackpotClaim = claims[2]
  const claimByCode = new Map(claims.map((c) => [c.code, c]))
  const claimsOpenAt = (d: Date) => claims.filter((c) => c.registered.getTime() <= d.getTime())

  // ---- fleet (SCD2 versions planned up front) ----------------------------------------------
  const rv = ctx.rng('fleet')
  const nRigs = ctx.n(22, 2)
  const nFreighters = ctx.n(8, 1)
  const vessels: Vessel[] = []
  for (let i = 0; i < nRigs + nFreighters; i++) {
    const rig = i < nRigs
    const idx = rig ? i : i - nRigs
    const names = rig ? RIG_NAMES : FREIGHTER_NAMES
    const newBuild = !ctx.tiny && rig && i >= nRigs - 2
    const commissioned = dateOnly(newBuild ? addDays(start, Math.floor(span * rv.float(0.2, 0.6))) : addDays(start, -rv.int(150, 3000)))
    const id = rig ? `RIG-${String(idx + 1).padStart(2, '0')}` : `FRT-${String(idx + 1).padStart(2, '0')}`
    const firstClaim = rig ? rv.pick(claimsOpenAt(maxDate(commissioned, start)).filter((c) => c !== jackpotClaim || ctx.tiny)) : null
    const homeOf = (cl: Claim | null) => (cl ? cl.refinery : rv.pick(BELTS).refinery)
    const attrs: Record<string, Scalar> = {
      vessel_name: names[idx % names.length] + ROMAN[Math.floor(idx / names.length) % ROMAN.length],
      vessel_class: rig ? 'Drill Rig' : 'Freighter',
      hull_series: rig ? rv.pick(['Burrow-6', 'Burrow-8', 'Molehill-3']) : rv.pick(['Packhorse-2', 'Packhorse-4', 'Barge-9']),
      assigned_claim_code: firstClaim ? firstClaim.code : null,
      home_station: stationByCode.get(homeOf(firstClaim))!.name,
      drill_head: rig ? 'Mk II Augerhead' : 'n/a',
      cargo_capacity_t: rig ? round(rv.float(300, 600), 0) : round(rv.float(5000, 12000), 0),
      commissioned_date: commissioned
    }
    const events: Array<{ at: Date; apply: (p: Record<string, Scalar>) => Record<string, Scalar> }> = []
    const from = maxDate(commissioned, addDays(start, -400))
    const life = daysBetween(from, today)
    if (rig) {
      // claim reassignments (~1 per year)
      let t = 0
      for (;;) {
        t += rv.exponential(365)
        if (t >= life - 5) break
        const at = addDays(from, Math.floor(t))
        const cands = claimsOpenAt(at)
        const next = rv.pick(cands)
        events.push({ at, apply: (p) => ({ ...p, assigned_claim_code: next.code, home_station: stationByCode.get(next.refinery)!.name }) })
      }
      if (rv.chance(0.55)) {
        const at = addDays(from, rv.int(30, Math.max(31, life - 5)))
        events.push({ at, apply: (p) => ({ ...p, drill_head: 'Mk III Augerhead' }) })
      }
    } else if (rv.chance(0.35)) {
      const at = addDays(from, rv.int(30, Math.max(31, life - 5)))
      events.push({ at, apply: (p) => ({ ...p, cargo_capacity_t: round((p.cargo_capacity_t as number) * 1.25, 0), hull_series: `${p.hull_series as string}R` }) })
    }
    // the jackpot claim draws two rigs shortly after it is registered
    if (rig && !ctx.tiny && (idx === 3 || idx === 7) && jackpotClaim.registered.getTime() > commissioned.getTime()) {
      const at = addDays(jackpotClaim.registered, 20 + idx)
      events.push({ at, apply: (p) => ({ ...p, assigned_claim_code: jackpotClaim.code, home_station: stationByCode.get(jackpotClaim.refinery)!.name }) })
    }
    events.sort((a, b) => a.at.getTime() - b.at.getTime())
    const versions: Scd2Version[] = [{ from: commissioned, attrs }]
    for (const ev of events) {
      if (ev.at.getTime() <= commissioned.getTime()) continue
      versions.push({ from: dateOnly(ev.at), attrs: ev.apply(versions[versions.length - 1].attrs) })
    }
    vessels.push({
      id,
      name: attrs.vessel_name as string,
      cls: rig ? 'Drill Rig' : 'Freighter',
      hull: attrs.hull_series as string,
      commissioned,
      versions,
      baseRate: rv.float(70, 130),
      power: rv.float(3, 6),
      wearRate: i === 0 ? 0.058 : rig ? rv.float(0.03, 0.05) : rv.float(0.008, 0.014),
      // "Old Rattler" (RIG-01) has a crew that keeps deferring maintenance
      maintProb: i === 0 ? 0.02 : rv.float(0.2, 0.5),
      wear: rv.float(5, 50),
      downtime: 0,
      pendingCost: 0
    })
  }
  const vesselRows = scd2Rows(vessels.map((v) => ({ businessKey: v.id, versions: v.versions })), { skColumn: 'vessel_sk', bkColumn: 'vessel_id' })
  const vesselIdx = new Scd2Index(vesselRows, 'vessel_sk', 'vessel_id')
  const skVersions = new Map<string, Array<{ sk: number; from: number; to: number }>>()
  for (const r of vesselRows) {
    const list = skVersions.get(r.vessel_id as string) ?? []
    list.push({ sk: r.vessel_sk as number, from: (r.valid_from as Date).getTime(), to: (r.valid_to as Date).getTime() })
    skVersions.set(r.vessel_id as string, list)
  }

  // ---- crew & tours (heap of seats ordered by next tour start) -----------------------------
  const rcr = ctx.rng('crew')
  const crew: Crew[] = []
  const certs = ['Cadet', 'Certified', 'Senior', 'Master']
  const hire = (role: string, at: Date): Crew => {
    const n = personName(rcr)
    const certRank = rcr.weighted([1, 2, 3, 4], [0.2, 0.45, 0.25, 0.1])
    const leaveAfter = Math.round(rcr.exponential(5 * 365))
    const leave = addDays(at, Math.max(120, leaveAfter))
    const c: Crew = {
      key: crew.length + 1,
      id: `CR-${String(crew.length + 1).padStart(4, '0')}`,
      name: n.full,
      role,
      cert: certs[certRank - 1],
      certRank,
      home: rcr.pick(STATIONS.filter((s) => s.type === 'Refinery' || s.type === 'Habitat')).code,
      hire: dateOnly(at),
      leave: leave.getTime() <= today.getTime() ? leave : null,
      freeFrom: at.getTime()
    }
    crew.push(c)
    return c
  }
  const tours: Array<{ id: string; crew: Crew; vessel: Vessel; start: Date; end: Date }> = []
  const heap = new MinHeap<{ vessel: Vessel; role: string }>()
  for (const v of vessels) {
    const roles = v.cls === 'Drill Rig' ? ['Driller', 'Driller', 'Engineer', 'Geologist', 'Pilot', 'Medic'] : ['Pilot', 'Pilot', 'Engineer', 'Medic']
    const first = maxDate(v.commissioned, addDays(start, -rcr.int(0, 120)))
    for (const role of roles) heap.push(first.getTime() + rcr.int(0, 40) * DAY, { vessel: v, role })
  }
  const pool = new Map<string, Crew[]>()
  for (let item = heap.pop(); item; item = heap.pop()) {
    const t = item.k
    if (t > today.getTime()) continue
    const { vessel, role } = item.v
    const list = pool.get(role) ?? []
    pool.set(role, list)
    let who = list.find((cm) => cm.freeFrom <= t && (cm.leave === null || cm.leave.getTime() > t + 30 * DAY))
    if (!who) {
      who = hire(role, new Date(t - rcr.int(5, 30) * DAY))
      list.push(who)
    }
    const len = rcr.int(60, 150)
    let end = t + (len - 1) * DAY
    if (who.leave && who.leave.getTime() <= end) end = who.leave.getTime() - DAY
    if (end < t) end = t
    tours.push({ id: `TR-${String(tours.length + 1).padStart(5, '0')}`, crew: who, vessel, start: new Date(t), end: new Date(end) })
    who.freeFrom = end + rcr.int(10, 30) * DAY
    heap.push(end + DAY, { vessel, role })
  }
  const bridge = new Map<string, number>()
  for (const tr of tours) {
    for (const ver of skVersions.get(tr.vessel.id)!) {
      const a = Math.max(ver.from, tr.start.getTime())
      const b = Math.min(ver.to, tr.end.getTime(), today.getTime())
      if (b < a) continue
      const k = `${ver.sk}|${tr.crew.key}`
      bridge.set(k, (bridge.get(k) ?? 0) + Math.round((b - a) / DAY) + 1)
    }
  }

  // ---- customers & contracts -----------------------------------------------------------------
  const rk = ctx.rng('contracts')
  const customers = ctx.tiny ? CUSTOMERS.slice(0, 5) : CUSTOMERS
  const allCustomers = [...customers, EXCHANGE]
  const customerKey = new Map(allCustomers.map((c, i) => [c.code, i + 1]))
  const contracts: Contract[] = []
  const producedMinerals = new Set(claims.flatMap((c) => c.minerals.map((m) => m.code)))
  for (const cu of customers) {
    const wants = SEGMENT_DEMAND[cu.segment].filter((m) => producedMinerals.has(m))
    for (const mcode of rk.sample(wants, rk.int(1, Math.min(3, wants.length)))) {
      let s = addDays(start, -rk.int(30, 400))
      while (s.getTime() <= today.getTime()) {
        const months = rk.int(12, 24)
        const e = addDays(ymd(s.getUTCFullYear(), s.getUTCMonth() + 1 + months, s.getUTCDate()), -1)
        const type = rk.chance(0.35) ? 'Fixed' : 'Index-Linked'
        contracts.push({
          key: contracts.length + 1,
          code: `K-${s.getUTCFullYear()}-${String(contracts.length + 1).padStart(3, '0')}`,
          customer: cu.code,
          mineral: mcode,
          type,
          fixed: type === 'Fixed' ? money(priceOn(mcode, s) * rk.float(0.92, 1.05)) : null,
          premium: type === 'Index-Linked' ? round(rk.float(-0.03, 0.08), 3) : null,
          volume: round(rk.logNormal(400_000, 0.6) * (mineralByCode.get(mcode)!.price < 100 ? 50 : 0.01), 0),
          start: dateOnly(s),
          end: dateOnly(e)
        })
        s = addDays(e, 1)
      }
    }
  }
  for (const m of MINERALS) {
    contracts.push({ key: contracts.length + 1, code: `K-SPOT-${m.code}`, customer: EXCHANGE.code, mineral: m.code, type: 'Spot', fixed: null, premium: null, volume: 0, start: ymd(2000, 1, 1), end: ymd(2099, 12, 31) })
  }
  const spotContract = new Map(contracts.filter((c) => c.type === 'Spot').map((c) => [c.mineral, c]))

  // ---- static batch ----------------------------------------------------------------------------
  const T0: Record<string, Row[]> = {}
  const B0: BronzeFile[] = []
  const rb = ctx.rng('static-bronze')
  T0.gold_dim_station = STATIONS.map((s, i) => ({
    station_key: i + 1, station_code: s.code, station_name: s.name, station_type: s.type, belt: s.belt, sector: s.sector, orbit_radius_au: s.r,
    docking_bays: s.bays, population: s.pop, is_consortium_owned: s.owned
  }))
  T0.silver_stations = STATIONS.map((s) => ({ station_code: s.code, station_name: s.name, station_type: s.type, belt: s.belt, sector: s.sector, orbit_radius_au: s.r, docking_bays: s.bays, population: s.pop }))
  const assignedEver = new Set(vessels.flatMap((v) => v.versions.map((x) => x.attrs.assigned_claim_code)).filter((x) => x))
  T0.gold_dim_claim = claims.map((c) => ({
    claim_key: c.key, claim_code: c.code, asteroid_name: c.name, designation: c.designation, spectral_class: c.cls, belt: c.belt, sector: c.sector,
    primary_mineral: mineralByCode.get(c.minerals[0].code)!.name, estimated_reserves_t: c.reserves, hardness_index: c.hardness,
    refinery_name: stationByCode.get(c.refinery)!.name, registered_date: c.registered, claim_status: assignedEver.has(c.code) ? 'Active' : 'Prospecting'
  }))
  T0.silver_claims = claims.map((c) => ({
    claim_code: c.code, asteroid_name: c.name, designation: c.designation, spectral_class: c.cls, belt: c.belt, sector: c.sector, primary_mineral_code: c.minerals[0].code,
    estimated_reserves_t: c.reserves, hardness_index: c.hardness, refinery_code: c.refinery, registered_date: c.registered
  }))
  T0.silver_claim_minerals = claims.flatMap((c) => c.minerals.map((m, j) => ({ claim_code: c.code, mineral_code: m.code, mean_grade: round(m.grade, 8), is_primary: j === 0 })))
  T0.gold_dim_mineral = MINERALS.map((m, i) => ({ mineral_key: i + 1, mineral_code: m.code, mineral_name: m.name, mineral_group: m.group, base_price_usd_per_kg: m.price, typical_grade: m.grade }))
  T0.silver_minerals = MINERALS.map((m) => ({ mineral_code: m.code, mineral_name: m.name, mineral_group: m.group, base_price_usd_per_kg: m.price }))
  B0.push(
    { source: 'claims', path: 'claims/stations.csv', format: 'csv', rows: T0.silver_stations.map((r) => ({ ...r }) as BronzeRow) },
    { source: 'claims', path: 'claims/claims.csv', format: 'csv', rows: T0.silver_claims.map((r) => ({ ...r }) as BronzeRow) },
    { source: 'claims', path: 'claims/claim_minerals.csv', format: 'csv', rows: T0.silver_claim_minerals.map((r) => ({ ...r }) as BronzeRow) },
    { source: 'claims', path: 'claims/minerals.csv', format: 'csv', rows: T0.silver_minerals.map((r) => ({ ...r }) as BronzeRow) }
  )
  T0.gold_dim_vessel = vesselRows
  T0.gold_dim_crew = crew.map((c) => ({
    crew_key: c.key, crew_id: c.id, full_name: c.name, crew_role: c.role, certification_level: c.cert, certification_rank: c.certRank,
    home_station: stationByCode.get(c.home)!.name, hire_date: c.hire, is_active: c.leave === null
  }))
  T0.silver_crew = crew.map((c) => ({ crew_id: c.id, full_name: c.name, crew_role: c.role, certification_level: c.cert, home_station_code: c.home, hire_date: c.hire, leave_date: c.leave }))
  T0.silver_crew_tours = tours.map((t) => ({ tour_id: t.id, crew_id: t.crew.id, vessel_id: t.vessel.id, tour_start: dateOnly(t.start), tour_end: dateOnly(t.end) }))
  B0.push(
    { source: 'crew', path: 'hr/crew.csv', format: 'csv', rows: T0.silver_crew.map((r) => ({ ...r }) as BronzeRow) },
    { source: 'crew', path: 'hr/tours.csv', format: 'csv', rows: T0.silver_crew_tours.map((r) => ({ ...r }) as BronzeRow) }
  )
  T0.gold_bridge_vessel_crew = [...bridge].map(([k, days]) => {
    const [sk, ck] = k.split('|').map(Number)
    return { vessel_sk: sk, crew_key: ck, days_aboard: days }
  })
  T0.gold_dim_customer = allCustomers.map((c, i) => ({
    customer_key: i + 1, customer_code: c.code, customer_name: c.name, segment: c.segment, home_station: stationByCode.get(c.station)!.name, payment_terms_days: c.terms, credit_rating: c.rating
  }))
  T0.silver_customers = allCustomers.map((c) => ({ customer_code: c.code, customer_name: c.name, segment: c.segment, home_station_code: c.station, payment_terms_days: c.terms, credit_rating: c.rating }))
  const customerRows: BronzeRow[] = allCustomers.map((c) => {
    let rating: string | null = c.rating
    if (rating === null) {
      rating = rb.pick(['', 'N/A', null] as Array<string | null>)
      ctx.issue('GS12')
    }
    return { id: c.code, name: c.name, segment: c.segment, deliveryStation: c.station, terms: { netDays: c.terms }, creditRating: rating }
  })
  injectCasing(customerRows, 'segment', { rng: rb, sink: ctx, code: 'GS13', rate: 0.3, atLeast: 1 })
  B0.push({ source: 'customers', path: 'sales/customers.json', format: 'json', rows: customerRows, json: { envelope: { system: 'LedgerLoop', exportedAt: formatDate(today, 'iso_t') }, dataKey: 'customers' } })
  T0.gold_dim_contract = contracts.map((k) => {
    const cu = allCustomers.find((c) => c.code === k.customer)!
    return {
      contract_key: k.key, contract_code: k.code, customer_key: customerKey.get(k.customer)!, customer_name: cu.name, mineral_key: mineralByCode.get(k.mineral)!.key,
      mineral_name: mineralByCode.get(k.mineral)!.name, contract_type: k.type, fixed_price_usd_per_kg: k.fixed, index_premium_pct: k.premium,
      volume_commitment_kg: k.volume, start_date: k.start, end_date: k.end
    }
  })
  T0.silver_contracts = contracts.map((k) => ({
    contract_code: k.code, customer_code: k.customer, mineral_code: k.mineral, contract_type: k.type, fixed_price_usd_per_kg: k.fixed, index_premium_pct: k.premium,
    volume_commitment_kg: k.volume, start_date: k.start, end_date: k.end
  }))
  const contractRows: BronzeRow[] = T0.silver_contracts.map((r) => ({ ...r }) as BronzeRow)
  injectDateFormats(contractRows, 'start_date', { rng: rb, sink: ctx, code: 'GS14', rate: 0.3, atLeast: 1 })
  B0.push({ source: 'contracts', path: 'sales/contracts.csv', format: 'csv', rows: contractRows })
  T0.gold_dim_run_profile = []
  SHIFTS.forEach((s, si) => MODES.forEach((m, mi) => T0.gold_dim_run_profile.push({ run_profile_key: si * 2 + mi + 1, shift: s, shift_order: si + 1, operating_mode: m })))
  T0.gold_dim_incident_type = []
  INCIDENT_CATEGORIES.forEach((cat, ci) =>
    SEVERITIES.forEach((sev, si) => T0.gold_dim_incident_type.push({ incident_type_key: ci * 4 + si + 1, category: cat, severity: sev, severity_rank: si + 1, is_recordable: si >= 1 }))
  )
  yield { label: 'static', tables: T0, bronze: B0 }

  // ---- simulation --------------------------------------------------------------------------------
  const rng = ctx.rng('sim')
  const driftDate = addDays(start, Math.floor(span * 0.55))
  const clusterFrom = addDays(start, Math.floor(span * 0.62))
  const clusterTo = addDays(clusterFrom, 60)
  const clusterSector = 'Sector 7 — Grumble Deep'
  const refineryStock = new Map<string, Map<string, number>>(BELTS.map((b) => [b.refinery, new Map(MINERALS.map((m) => [m.code, 0]))]))
  const freighters = vessels.filter((v) => v.cls === 'Freighter')
  const rigs = vessels.filter((v) => v.cls === 'Drill Rig')
  const freighterFree = new Map<string, number>(freighters.map((f, i) => [f.id, start.getTime() + i * DAY]))
  const pendingTelemetry = new Map<number, BronzeRow[]>()
  let driftLogged = false
  let firstShift = true
  let firstTelemetry = true
  let firstWo = true
  let haulSeq = 0
  let woSeq = 0
  let incSeq = 0
  let assaySeq = 0
  let batchSeq = 0
  let priceRows: BronzeRow[] = []
  const incidentRowsAll: BronzeRow[] = []
  const transit = (a: string, b: string) => Math.max(1, Math.round(Math.abs(stationByCode.get(a)!.r - stationByCode.get(b)!.r) * 12 + 1.5))

  for (const monthStart of monthsOf(start, today)) {
    const monthEnd = minDate(endOfMonth(monthStart), today)
    const first = monthKey(monthStart) === monthKey(start)
    const T: Record<string, Row[]> = {
      gold_fact_extraction_run: [], gold_fact_equipment_day: [], gold_fact_cargo_haul: [], gold_fact_safety_incident: [],
      silver_extraction_runs: [], silver_ore_assays: [], silver_refinery_batches: [], silver_refinery_output: [], silver_equipment_telemetry: [],
      silver_work_orders: [], silver_commodity_prices: [], silver_cargo_manifests: [], silver_safety_incidents: [], silver_vessel_registry: []
    }
    const bronze: BronzeFile[] = []
    const assayRows: BronzeRow[] = []
    const refineryRows: BronzeRow[] = []
    const manifestRows: BronzeRow[] = []
    const woRows: BronzeRow[] = []

    const addIncident = (day: Date, vessel: Vessel | null, stationCode: string, severityBoost: number, forcedCategory?: string) => {
      const sev = Math.min(3, rng.weighted([0, 1, 2, 3], [0.5, 0.3, 0.15, 0.05]) + severityBoost)
      const cat = forcedCategory ?? rng.weighted(INCIDENT_CATEGORIES, [0.12, 0.18, 0.25, 0.1, 0.08, 0.12, 0.15])
      const injuries = sev === 0 ? 0 : sev === 1 ? 1 : sev === 2 ? rng.int(1, 2) : rng.int(1, 4)
      const lost = sev === 2 ? rng.int(2, 20) : sev === 3 ? rng.int(10, 60) : 0
      const cause = rng.weighted(['Equipment', 'Procedure', 'Human Factors', 'Environment'], vessel && vessel.wear > 70 ? [0.6, 0.15, 0.15, 0.1] : [0.25, 0.3, 0.3, 0.15])
      const id = `INC-${String(++incSeq).padStart(5, '0')}`
      const typeKey = INCIDENT_CATEGORIES.indexOf(cat) * 4 + sev + 1
      T.gold_fact_safety_incident.push({
        incident_id: id, incident_date: day, date_key: dateKey(day), vessel_sk: vessel ? vesselIdx.lookup(vessel.id, day) : null,
        station_key: stationByCode.get(stationCode)!.key, incident_type_key: typeKey, injuries, lost_time_days: lost, root_cause: cause
      })
      const summary = `${cat} — ${SEVERITIES[sev].toLowerCase()}${vessel ? ` aboard ${vessel.name}` : ` at ${stationByCode.get(stationCode)!.name}`}`
      T.silver_safety_incidents.push({
        incident_id: id, incident_date: day, vessel_id: vessel ? vessel.id : null, station_code: stationCode, category: cat, severity: SEVERITIES[sev],
        injuries, lost_time_days: lost, root_cause: cause, summary
      })
      let lostOut: BronzeValueLike = lost
      if (lost === 0) {
        lostOut = rng.pick(['', null] as Array<string | null>)
        ctx.issue('GS17')
      }
      incidentRowsAll.push({ ref: id, occurred: day, vessel: vessel ? vessel.id : null, station: stationCode, category: cat, severity: SEVERITIES[sev], injured: injuries, lost_time_days: lostOut, cause, summary })
    }

    for (const day of eachDay(monthStart, monthEnd)) {
      const dk = dateKey(day)
      const progress = clamp(daysBetween(start, day) / Math.max(1, span), 0, 1)
      // prices
      for (const m of MINERALS) {
        const p = priceOn(m.code, day)
        T.silver_commodity_prices.push({ mineral_code: m.code, price_date: day, index_price_usd_per_kg: p })
        priceRows.push({ Date: day, Mineral: m.code, 'Price (USD/kg)': p })
      }
      const feed = new Map<string, { ore: number; contained: Map<string, number> }>()
      const shiftRows: BronzeRow[] = []
      for (const v of vessels) {
        if (v.commissioned.getTime() > day.getTime()) continue
        const a = attrsAt(v.versions, day)
        const sk = vesselIdx.lookup(v.id, day)!
        const isRig = v.cls === 'Drill Rig'
        const claim = isRig ? claimByCode.get(a.assigned_claim_code as string)! : null
        const mk3 = a.drill_head === 'Mk III Augerhead'
        // maintenance decisions at start of day
        let failure = false
        let planned = false
        let cost = 0
        if (v.downtime <= 0) {
          const hazard = 0.0012 + 0.045 * Math.pow(Math.max(0, (v.wear - 62) / 38), 2)
          if (rng.chance(hazard)) {
            failure = true
            v.downtime = rng.float(30, 110)
            const parts = money(rng.float(60_000, 250_000) * (isRig ? 1 : 0.5))
            const labor = round(rng.float(40, 160), 1)
            cost = money(parts + labor * 140)
            const mode = v.wear > 85 ? rng.pick(['Bearing Seizure', 'Drill Head Fracture']) : rng.pick(['Gearbox Vibration', 'Reactor Coolant Leak', 'Bearing Seizure'])
            const id = `WO-${String(++woSeq).padStart(6, '0')}`
            const opened = new Date(day.getTime() + rng.int(0, 3) * 3_600_000)
            const closed = new Date(opened.getTime() + v.downtime * 3_600_000)
            T.silver_work_orders.push({ work_order_id: id, vessel_id: v.id, work_type: 'Breakdown', failure_mode: isRig ? mode : 'Thruster Failure', opened_at: opened, closed_at: closed.getTime() <= today.getTime() + DAY ? closed : null, downtime_hours: round(v.downtime, 1), parts_cost_usd: parts, labor_hours: labor, total_cost_usd: cost })
            woRows.push({ wo: id, asset: v.id, type: 'BREAKDOWN', failure_mode: isRig ? mode : 'Thruster Failure', opened, closed: closed.getTime() <= today.getTime() + DAY ? closed : null, downtime_h: round(v.downtime, 1), parts_usd: parts, labor_h: labor })
            if (rng.chance(isRig && v.wear > 85 ? 0.5 : 0.15)) addIncident(day, v, isRig ? claim!.refinery : (a.home_station ? stationOfName(a.home_station as string) : 'STN-02'), v.wear > 90 ? 2 : 1, 'Equipment Strike')
            v.wear = rng.float(2, 6)
          } else if (v.wear >= 68 && rng.chance(v.maintProb)) {
            planned = true
            v.downtime = rng.float(16, 30)
            const parts = money(rng.float(18_000, 40_000) * (isRig ? 1 : 0.6))
            const labor = round(rng.float(30, 60), 1)
            cost = money(parts + labor * 140)
            const id = `WO-${String(++woSeq).padStart(6, '0')}`
            const opened = new Date(day.getTime() + rng.int(0, 2) * 3_600_000)
            const closed = new Date(opened.getTime() + v.downtime * 3_600_000)
            T.silver_work_orders.push({ work_order_id: id, vessel_id: v.id, work_type: 'Planned', failure_mode: null, opened_at: opened, closed_at: closed.getTime() <= today.getTime() + DAY ? closed : null, downtime_hours: round(v.downtime, 1), parts_cost_usd: parts, labor_hours: labor, total_cost_usd: cost })
            woRows.push({ wo: id, asset: v.id, type: 'PLANNED', failure_mode: null, opened, closed: closed.getTime() <= today.getTime() + DAY ? closed : null, downtime_h: round(v.downtime, 1), parts_usd: parts, labor_h: labor })
            v.wear = rng.float(4, 10)
          }
        }
        const downToday = Math.min(24, Math.max(0, v.downtime))
        v.downtime -= downToday
        let opHours = 0
        if (isRig && claim) {
          SHIFTS.forEach((shift, s) => {
            const avail = clamp(8 - Math.max(0, downToday - 8 * s), 0, 8)
            if (avail < 3) return
            const drill = round(avail * rng.float(0.78, 0.95), 2)
            opHours += drill
            const autonomous = rng.chance(s === 2 ? 0.45 : 0.1)
            const rate = v.baseRate * (mk3 ? 1.12 : 1) * (1 - 0.35 * Math.pow(v.wear / 100, 2)) / claim.hardness
            const ore = round(rate * drill * rng.logNormal(1, 0.12), 1)
            const waste = round(ore * claim.strip * rng.logNormal(1, 0.15), 1)
            const energy = round(drill * v.power * (1 + v.wear / 200), 2)
            claim.mined += ore
            const depletion = 1 - 0.35 * Math.min(1, claim.mined / claim.reserves)
            const runId = `RUN-${v.id.replace('-', '')}-${dk}-${shift[0]}`
            const grades = claim.minerals.map((m, j) => {
              let g = m.grade * depletion * rng.logNormal(1, 0.25)
              if (claim === jackpotClaim && m.code === 'LUM' && day.getTime() >= addDays(jackpotClaim.registered, 45).getTime()) g *= 3
              return { code: m.code, grade: round(Math.min(0.6, g), 9), primary: j === 0 }
            })
            const prim = grades[0]
            const contained = round(ore * 1000 * prim.grade, 3)
            T.gold_fact_extraction_run.push({
              run_id: runId, run_date: day, date_key: dk, claim_key: claim.key, vessel_sk: sk, primary_mineral_key: mineralByCode.get(prim.code)!.key,
              run_profile_key: s * 2 + (autonomous ? 1 : 0) + 1, ore_tonnes: ore, waste_tonnes: waste, drill_hours: drill, energy_mwh: energy,
              primary_grade: prim.grade, contained_primary_kg: contained, estimated_value_usd: money(contained * priceOn(prim.code, day))
            })
            T.silver_extraction_runs.push({ run_id: runId, run_date: day, shift, operating_mode: autonomous ? 'Autonomous' : 'Crewed', vessel_id: v.id, claim_code: claim.code, ore_tonnes: ore, waste_tonnes: waste, drill_hours: drill, energy_mwh: energy })
            shiftRows.push({ run_id: runId, report_date: day, shift, mode: autonomous ? 'AUTO' : 'CREW', vessel_id: v.id, claim_code: claim.code, ore_t: ore, waste_t: waste, drill_h: drill, energy_mwh: energy })
            const f = feed.get(claim.refinery) ?? { ore: 0, contained: new Map<string, number>() }
            f.ore += ore
            for (const g of grades) {
              const id = `AS-${String(++assaySeq).padStart(8, '0')}`
              const at = new Date(day.getTime() + (8 * s + 8) * 3_600_000 + rng.int(4, 60) * 3_600_000)
              T.silver_ore_assays.push({ assay_id: id, run_id: runId, run_date: day, mineral_code: g.code, grade: g.grade, assayed_at: at, lab: claim.refinery === 'STN-03' ? 'Crucible Lab' : 'Field Lab' })
              assayRows.push({ assay_id: id, run_id: runId, mineral: g.code, grade_pct: round(g.grade * 100, 7), assayed_at: at, lab: claim.refinery === 'STN-03' ? 'Crucible Lab' : 'Field Lab' })
              f.contained.set(g.code, (f.contained.get(g.code) ?? 0) + ore * 1000 * g.grade)
            }
            feed.set(claim.refinery, f)
            // safety on crewed shifts
            if (!autonomous) {
              let hz = 0.0009 * (1 + v.wear / 50) * (s === 2 ? 1.4 : 1)
              if (claim.sector === clusterSector && day.getTime() >= clusterFrom.getTime() && day.getTime() < clusterTo.getTime()) hz *= 12
              if (rng.chance(hz)) addIncident(day, v, claim.refinery, 0, claim.sector === clusterSector && day.getTime() >= clusterFrom.getTime() && day.getTime() < clusterTo.getTime() && rng.chance(0.7) ? 'Decompression' : undefined)
            }
          })
          v.wear = Math.min(100, v.wear + opHours * v.wearRate * claim.hardness * (mk3 ? 0.8 : 1))
        } else if (!isRig) {
          // freighter: operating while on a haul
          const busyUntil = freighterFree.get(v.id)!
          opHours = busyUntil > day.getTime() ? Math.max(0, 18 - downToday) : Math.max(0, 4 - downToday)
          v.wear = Math.min(100, v.wear + opHours * v.wearRate)
          if (rng.chance(0.0015)) addIncident(day, v, stationOfName(a.home_station as string), 0)
          // load when idle and available
          if (busyUntil <= day.getTime() && downToday === 0) {
            const ref = [...refineryStock.entries()].map(([code, st]) => ({ code, value: [...st].reduce((s2, [mc, q]) => s2 + q * priceOn(mc, day), 0) })).sort((x, y) => y.value - x.value)[0]
            const stock = refineryStock.get(ref.code)!
            const capacity = (a.cargo_capacity_t as number) * 1000
            const ranked = [...stock].filter(([, q]) => q > 1).sort((x, y) => y[1] * priceOn(y[0], day) - x[1] * priceOn(x[0], day))
            if (ranked.length && ref.value > 50_000) {
              const topMineral = ranked[0][0]
              const active = contracts.filter((k) => k.type !== 'Spot' && k.mineral === topMineral && k.start.getTime() <= day.getTime() && k.end.getTime() >= day.getTime())
              const lead = active.length && rng.chance(0.75) ? rng.pick(active) : spotContract.get(topMineral)!
              const customer = allCustomers.find((cu) => cu.code === lead.customer)!
              const lines: Contract[] = [lead]
              for (const [mc] of ranked.slice(1, 4)) {
                if (lines.length >= 3) break
                const k2 = contracts.find((k) => k.customer === customer.code && k.mineral === mc && k.start.getTime() <= day.getTime() && k.end.getTime() >= day.getTime())
                if (k2) lines.push(k2)
              }
              const haulId = `HAUL-${String(++haulSeq).padStart(6, '0')}`
              const transitDays = transit(ref.code, customer.station) + (rng.chance(0.08) ? rng.int(1, 4) : 0)
              const delivered = addDays(day, transitDays)
              const isDelivered = delivered.getTime() <= today.getTime()
              const lateFactor = customer.code === LATE_PAYER ? 1 + 1.6 * Math.max(0, progress - 0.5) : 1
              const paid = addDays(delivered, Math.round(customer.terms * lateFactor) + rng.int(-4, 8))
              const isPaid = isDelivered && paid.getTime() <= today.getTime()
              let massLeft = capacity
              lines.forEach((k, li) => {
                const have = stock.get(k.mineral)!
                const qty = round(Math.min(have, massLeft / (lines.length - li)), 3)
                if (qty <= 0) return
                stock.set(k.mineral, have - qty)
                massLeft -= qty
                const breach = rng.chance(0.012)
                const loss = isDelivered ? round(breach ? qty * rng.float(0.02, 0.15) : 0, 3) : 0
                const deliveredKg = isDelivered ? round(qty - loss, 3) : null
                const pricingDate = k.type === 'Spot' ? delivered : day
                const idxPrice = priceOn(k.mineral, minDate(pricingDate, today))
                const unit = k.type === 'Fixed' ? k.fixed! : k.type === 'Index-Linked' ? money(idxPrice * (1 + k.premium!)) : isDelivered ? idxPrice : null
                const revenue = deliveredKg !== null && unit !== null ? money(deliveredKg * unit) : null
                const destKey = stationByCode.get(customer.station)!.key
                T.gold_fact_cargo_haul.push({
                  haul_id: haulId, manifest_line: li + 1, loaded_date: day, loaded_date_key: dk, delivered_date_key: isDelivered ? dateKey(delivered) : null,
                  paid_date_key: isPaid ? dateKey(paid) : null, origin_station_key: stationByCode.get(ref.code)!.key, destination_station_key: destKey,
                  vessel_sk: sk, customer_key: customerKey.get(customer.code)!, contract_key: k.key, mineral_key: mineralByCode.get(k.mineral)!.key,
                  loaded_kg: qty, delivered_kg: deliveredKg, transit_loss_kg: isDelivered ? loss : null, index_price_usd_per_kg: idxPrice, unit_price_usd_per_kg: unit,
                  revenue_usd: revenue, transit_days: isDelivered ? transitDays : null, days_to_pay: isPaid ? daysBetween(delivered, paid) : null,
                  status: isPaid ? 'Paid' : isDelivered ? 'Delivered' : 'In Transit'
                })
                T.silver_cargo_manifests.push({
                  haul_id: haulId, manifest_line: li + 1, vessel_id: v.id, origin_code: ref.code, destination_code: customer.station, contract_code: k.code, mineral_code: k.mineral,
                  loaded_date: day, delivered_date: isDelivered ? delivered : null, paid_date: isPaid ? paid : null, loaded_kg: qty, delivered_kg: deliveredKg,
                  unit_price_usd_per_kg: unit, revenue_usd: revenue
                })
                const adhoc = k.type === 'Spot' && rng.chance(0.5)
                if (adhoc) ctx.issue('GS18')
                manifestRows.push({
                  haul: haulId, line: li + 1, freighter: v.id, origin: ref.code, destination: customer.station, contract: adhoc ? 'SPOT-ADHOC' : k.code, mineral: k.mineral,
                  loaded: day, delivered: isDelivered ? delivered : null, paid: isPaid ? paid : null, loaded_kg: qty, delivered_kg: deliveredKg, unit_price: unit, revenue
                })
              })
              freighterFree.set(v.id, addDays(delivered, transit(customer.station, ref.code)).getTime())
            }
          }
        }
        // telemetry (4 readings) & equipment-day snapshot
        const readings: BronzeRow[] = []
        let vibSum = 0
        let vibN = 0
        let maxTemp: number | null = null
        let faults = 0
        let powerSum = 0
        for (let h = 0; h < 24; h += 6) {
          const at = new Date(day.getTime() + h * 3_600_000 + rng.int(0, 1800) * 1000)
          const running = opHours > 0
          const vib = round((running ? 1.6 : 0.4) + 0.03 * v.wear + 0.0007 * v.wear * v.wear + rng.normal(0, 0.35), 2)
          const temp = round((running ? 48 : 22) + 0.32 * v.wear + rng.normal(0, 2.5), 1)
          const pw = round(running ? v.power * (1 + v.wear / 200) * rng.float(0.9, 1.1) : rng.float(0.2, 0.5), 2)
          const fault = vib > 7.1 ? 'VIB-HI' : temp > 85 ? 'TEMP-HI' : rng.chance(0.004) ? rng.pick(['PWR-FLUX', 'COMM-LOSS']) : null
          const dropout = rng.chance(0.012) || (firstTelemetry && h === 6)
          if (dropout) ctx.issue('GS03')
          const hull = round(rng.normal(-35, 12), 1)
          if (fault) faults++
          vibSum += vib
          vibN++
          powerSum += pw
          if (!dropout) maxTemp = maxTemp === null ? temp : Math.max(maxTemp, temp)
          T.silver_equipment_telemetry.push({ vessel_id: v.id, reading_at: at, vibration_mm_s: vib, bearing_temp_c: dropout ? null : temp, power_draw_mw: pw, wear_pct: round(v.wear, 2), fault_code: fault, hull_temp_c: day.getTime() >= driftDate.getTime() ? hull : null })
          readings.push({ vessel: v.id, ts: at, vib_rms: vib, bearing_temp_c: dropout ? -9999 : temp, power_mw: pw, wear_est: round(v.wear, 2), fault, hull_temp_c: hull })
        }
        firstTelemetry = false
        const land = minDate(landingDay(day, { rng, sink: { issue: (code: string, n?: number) => ctx.issue(code, (n ?? 1) * readings.length) }, code: 'GS02', rate: 0.012, maxDelay: 9 }), today)
        const lk = dateKey(land)
        const pend = pendingTelemetry.get(lk) ?? []
        pend.push(...readings)
        pendingTelemetry.set(lk, pend)
        const seats = isRig ? 6 : 4
        T.gold_fact_equipment_day.push({
          vessel_id: v.id, snapshot_date: day, date_key: dk, vessel_sk: sk, operating_hours: round(opHours, 2), downtime_hours: round(downToday, 2),
          crew_hours: seats * 12, avg_vibration_mm_s: round(vibSum / vibN, 3), max_bearing_temp_c: maxTemp, drill_wear_pct: round(v.wear, 2),
          power_draw_mw: round(powerSum / 4, 3), fault_codes: faults, is_failure: failure, is_planned_maintenance: planned, maintenance_cost_usd: money(cost)
        })
      }
      // refinery batches
      for (const [refCode, f] of feed) {
        const id = `RB-${refCode.slice(-2)}-${dk}`
        batchSeq++
        const energy = round(f.ore * 0.05, 2)
        T.silver_refinery_batches.push({ batch_id: id, refinery_code: refCode, batch_date: day, feed_ore_tonnes: round(f.ore, 1), energy_mwh: energy })
        const outputs: BronzeRow[] = []
        const stock = refineryStock.get(refCode)!
        for (const [mc, kg] of f.contained) {
          const base = refCode === 'STN-04' ? 0.84 : refCode === 'STN-03' ? 0.91 : 0.88
          const rec = round(kg * clamp(base * rng.normal(1, 0.03), 0.6, 0.99), 3)
          const contained = round(kg, 3)
          T.silver_refinery_output.push({ batch_id: id, batch_date: day, refinery_code: refCode, mineral_code: mc, feed_contained_kg: contained, recovered_kg: rec })
          outputs.push({ mineral: mc, contained_kg: contained, recovered_kg: rec })
          stock.set(mc, stock.get(mc)! + rec)
        }
        refineryRows.push({ batchId: id, refinery: refCode, date: day, feed: { oreTonnes: round(f.ore, 1) }, energyMwh: energy, outputs })
      }
      // station incidents at refineries
      for (const b of BELTS) if (rng.chance(0.002)) addIncident(day, null, b.refinery, 0, rng.pick(['Fire', 'Chemical', 'Radiation Exposure']))
      // the Sector 7 decompression cluster also hits the outer refinery's docks
      if (day.getTime() >= clusterFrom.getTime() && day.getTime() < clusterTo.getTime() && rng.chance(ctx.tiny ? 0.05 : 0.25)) addIncident(day, null, 'STN-04', rng.chance(0.3) ? 1 : 0, 'Decompression')
      // daily bronze files
      const y = day.getUTCFullYear()
      const mm = String(day.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(day.getUTCDate()).padStart(2, '0')
      if (shiftRows.length) {
        const o = { rng, sink: ctx }
        const rows = injectDuplicates(shiftRows, { ...o, code: 'GS08', rate: 0.003, atLeast: firstShift ? 1 : 0 })
        injectCasing(rows, 'vessel_id', { ...o, code: 'GS05', rate: 0.03, atLeast: firstShift ? 1 : 0 })
        injectWhitespace(rows, 'claim_code', { ...o, code: 'GS06', rate: 0.02, atLeast: firstShift ? 1 : 0 })
        injectOutliers(rows, 'ore_t', { ...o, code: 'GS07', rate: 0.002, mode: 'extreme', factor: 1000, atLeast: firstShift ? 1 : 0 })
        firstShift = false
        bronze.push({ source: 'shift_reports', path: `operations/runs/${y}/${mm}/shift_reports_${dk}.csv`, format: 'csv', rows })
      }
      const landed = pendingTelemetry.get(dk) ?? []
      pendingTelemetry.delete(dk)
      if (landed.length) {
        const drift = day.getTime() >= driftDate.getTime()
        if (drift && !driftLogged) {
          ctx.issue('GS04')
          driftLogged = true
        }
        let rows: BronzeRow[] = landed.map((r) => {
          const { vib_rms, hull_temp_c, ...rest } = r
          return drift ? { ...rest, vibration_mm_s: vib_rms, hull_temp_c, fw: '4.2' } : { ...rest, vib_rms, fw: '4.1' }
        })
        rows = injectDuplicates(rows, { rng, sink: ctx, code: 'GS01', rate: 0.003, atLeast: first && dk === dateKey(monthStart) ? 1 : 0 })
        bronze.push({ source: 'telemetry', path: `telemetry/${y}/${mm}/${dd}/downlink_${dk}.ndjson`, format: 'ndjson', rows })
      }
    }

    // month end: registry snapshot, monthly bronze
    for (const v of vessels) {
      if (v.commissioned.getTime() > monthEnd.getTime()) continue
      const a = attrsAt(v.versions, monthEnd)
      T.silver_vessel_registry.push({
        snapshot_date: monthEnd, vessel_id: v.id, vessel_name: a.vessel_name, vessel_class: a.vessel_class, assigned_claim_code: a.assigned_claim_code,
        home_station_code: stationOfName(a.home_station as string), drill_head: a.drill_head, cargo_capacity_t: a.cargo_capacity_t
      })
    }
    const registryRows: BronzeRow[] = T.silver_vessel_registry.map((r) => ({ ...r }) as BronzeRow)
    injectWhitespace(registryRows, 'vessel_name', { rng, sink: ctx, code: 'GS16', rate: 0.05, atLeast: first ? 1 : 0 })
    // calibration samples with no run (orphans)
    const nCal = rng.int(1, 4)
    for (let i = 0; i < nCal; i++) {
      const at = addDays(monthStart, rng.int(0, Math.max(0, daysBetween(monthStart, monthEnd))))
      assayRows.push({ assay_id: `AS-CAL-${ym(monthStart)}-${i + 1}`, run_id: rng.chance(0.5) ? `CAL-${ym(monthStart)}-${i + 1}` : `RUN-TEST-${dateKey(at)}`, mineral: rng.pick(MINERALS).code, grade_pct: round(rng.float(0.001, 5), 4), assayed_at: new Date(at.getTime() + 10 * 3_600_000), lab: 'Crucible Lab' })
      ctx.issue('GS09')
    }
    injectDateFormats(assayRows, 'assayed_at', { rng, sink: ctx, code: 'GS10', rate: 0.1, formats: ['us', 'eu'], atLeast: first ? 1 : 0 })
    const woOut = injectDuplicates(woRows, { rng, sink: ctx, code: 'GS15', rate: 0.03, atLeast: firstWo && woRows.length ? 1 : 0 })
    if (woRows.length) firstWo = false
    const y = monthStart.getUTCFullYear()
    const tag = ym(monthStart)
    bronze.push(
      { source: 'fleet', path: `fleet/registry_${tag}.csv`, format: 'csv', rows: registryRows },
      { source: 'assays', path: `assay_lab/${y}/assays_${tag}.csv`, format: 'csv', rows: assayRows, csv: { delimiter: ';' } },
      { source: 'refinery', path: `refinery/${y}/batches_${tag}.json`, format: 'json', rows: refineryRows, json: { envelope: { api: 'smeltwise/v3/batches', month: tag, units: { feed: 't', outputs: 'kg' } }, dataKey: 'batches' } },
      { source: 'logistics', path: `logistics/${y}/manifests_${tag}.csv`, format: 'csv', rows: manifestRows, columns: ['haul', 'line', 'freighter', 'origin', 'destination', 'contract', 'mineral', 'loaded', 'delivered', 'paid', 'loaded_kg', 'delivered_kg', 'unit_price', 'revenue'] }
    )
    if (woOut.length) bronze.push({ source: 'maintenance', path: `maintenance/${y}/work_orders_${tag}.ndjson`, format: 'ndjson', rows: woOut })
    const yearEnd = monthStart.getUTCMonth() === 11 || monthEnd.getTime() === today.getTime()
    if (yearEnd) {
      injectFormattedNumbers(priceRows, 'Price (USD/kg)', { rng, sink: ctx, code: 'GS11', rate: 0.1, atLeast: 1 })
      bronze.push({ source: 'prices', path: `market/commodity_prices_${y}.xlsx`, format: 'xlsx', rows: priceRows, xlsx: { sheet: 'Index', titleLines: ['Belt Commodity Exchange — daily index (USD/kg)', `Calendar year ${y}`] } })
      priceRows = []
    }
    if (monthEnd.getTime() === today.getTime()) {
      bronze.push({ source: 'safety', path: 'safety/incident_reports.json', format: 'json', rows: incidentRowsAll, json: { envelope: { system: 'SafeOrbit', exportedAt: formatDate(today, 'iso_t') }, dataKey: 'reports' } })
    }
    yield { label: `${y}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`, tables: T, bronze }
  }
  void batchSeq
}

type BronzeValueLike = string | number | null

function stationOfName(name: string): string {
  return STATIONS.find((s) => s.name === name)?.code ?? 'STN-02'
}

