/**
 * Moonwake Star Cruises — simulation.
 *
 * Demand is sailing-driven: every open sailing receives Poisson quote requests following a
 * lead-time curve (log-normal, median ~4 months, plus a last-minute bump) scaled to its demand
 * index. Each quote is priced dynamically (base rate × itinerary × season × load-factor curve ×
 * last-minute adjustment) and converts with a price elasticity and campaign quality; bookings
 * consume cabin-class inventory, pay deposits/final payments, cancel (fare-class dependent), and
 * sail. Daily booking-curve snapshots cover the final weeks before departure; folio charges are
 * generated when a ship sails.
 *
 * The simulation warms up 420 days before history starts so early sailings have realistic booking
 * curves; bookings taken before go-live are flagged `is_migrated` and their pre-go-live events are
 * stamped with the go-live date in gold (true dates kept in silver / original_booking_date).
 */
import type { Scalar } from '../../../../../src/core/model/data.ts'
import { addDays, annualCycle, dateKey, dateOnly, daysBetween, endOfMonth, isoDate, maxDate, minDate, monthKey, ymd } from '../../calendar.ts'
import { formatDate, injectCasing, injectDateFormats, injectDuplicates, injectFormattedNumbers, injectOutliers, injectWhitespace, landingDay } from '../../chaos.ts'
import { clamp, round } from '../../prng.ts'
import type { Rng } from '../../prng.ts'
import { Scd2Index, scd2Rows } from '../../scd2.ts'
import type { Scd2Version } from '../../scd2.ts'
import type { Batch, BronzeFile, BronzeRow, GenContext, Row } from '../../schema.ts'
import { ADJECTIVES, NOUNS, email, personName, placeNames } from '../../words.ts'

// ---------------------------------------------------------------------------------------------
// Reference data

interface CabinClass { code: string; name: string; tier: number; berths: number; window: boolean; deck: string; share: number; rate: number }
const CLASSES: CabinClass[] = [
  { code: 'INP', name: 'Interior Pod', tier: 1, berths: 2, window: false, deck: 'Lower', share: 0.32, rate: 180 },
  { code: 'PRT', name: 'Porthole Stateroom', tier: 2, berths: 2, window: true, deck: 'Mid', share: 0.3, rate: 240 },
  { code: 'SVB', name: 'Starview Balcony', tier: 3, berths: 2, window: true, deck: 'Upper', share: 0.24, rate: 340 },
  { code: 'ZGS', name: 'Zero-G Suite', tier: 4, berths: 3, window: true, deck: 'Upper', share: 0.11, rate: 620 },
  { code: 'CNS', name: "Captain's Nebula Suite", tier: 5, berths: 4, window: true, deck: 'Observation', share: 0.03, rate: 1150 }
]
const INP = 0
const ZGS = 3
const CNS = 4

interface PortDef { code: string; name: string; body: string; region: string; g: number; fee: number; highlight: string }
const P = (code: string, name: string, body: string, region: string, g: number, fee: number, highlight: string): PortDef => ({ code, name, body, region, g, fee, highlight })
const PORTS: PortDef[] = [
  P('VSH', 'Vashti Moon', 'Moon', 'Inner Ring', 0.17, 35, 'Moonwake Spaceport and the silver lagoons'),
  P('HLR', 'Halcyon Ring', 'Ring', 'Inner Ring', 0.9, 28, 'Spin-gravity boulevards'),
  P('KST', 'Kestrel Station', 'Station', 'Inner Ring', 0.6, 22, 'Duty-free arcades'),
  P('QHB', 'Quill Harbor', 'Moon', 'Inner Ring', 0.21, 30, 'Glass-dome vineyards'),
  P('NSP', 'Nimbus Spire', 'Station', 'Inner Ring', 0.5, 26, 'Cloud-top observatory'),
  P('MRD', 'Marrow Drift', 'Asteroid', 'Outer Belt', 0.02, 18, 'Zero-g canyon rafting'),
  P('EMA', 'Ember Atoll', 'Asteroid', 'Outer Belt', 0.03, 20, 'Ice-geyser fields'),
  P('CRV', 'Corvid Station', 'Station', 'Outer Belt', 0.7, 24, 'Night markets'),
  P('PLS', 'Pellucid Station', 'Station', 'Outer Belt', 0.8, 27, 'Crystal greenhouses'),
  P('JNP', 'Juniper Dock', 'Asteroid', 'Outer Belt', 0.04, 16, 'Mining-heritage museum'),
  P('ORR', "Orrin's Rest", 'Moon', 'Far Reach', 0.3, 45, 'Twin-sun eclipses'),
  P('TMS', 'Tamsin Reach', 'Ring', 'Far Reach', 0.95, 40, 'Aurora sailing'),
  P('LRG', 'Lorelei Gate', 'Station', 'Far Reach', 0.6, 38, 'Gateway nebula views'),
  P('SBL', 'Sable Moon', 'Moon', 'Far Reach', 0.14, 42, 'Black-sand dunes'),
  P('WRN', "Wren's Eyrie", 'Station', 'Far Reach', 0.5, 36, 'Comet watching'),
  P('AST', 'Aster Deep', 'Moon', 'Far Reach', 0.25, 50, 'Ice-cave diving')
]

interface ItinDef { code: string; name: string; region: string; nights: number; ports: string[]; pop: number; factor: number }
const ITINS: ItinDef[] = [
  { code: 'IR4', name: 'Halcyon Weekender', region: 'Inner Ring', nights: 4, ports: ['HLR', 'KST'], pop: 1.15, factor: 0.85 },
  { code: 'IR5', name: 'Honeymoon Halo', region: 'Inner Ring', nights: 5, ports: ['QHB', 'HLR'], pop: 1.05, factor: 1.0 },
  { code: 'IR7', name: 'Inner Ring Sampler', region: 'Inner Ring', nights: 7, ports: ['HLR', 'KST', 'QHB', 'NSP'], pop: 1.1, factor: 0.9 },
  { code: 'OB7', name: 'Asteroid Adventures', region: 'Outer Belt', nights: 7, ports: ['MRD', 'JNP', 'EMA'], pop: 0.95, factor: 1.0 },
  { code: 'OB10', name: 'Outer Belt Explorer', region: 'Outer Belt', nights: 10, ports: ['KST', 'MRD', 'EMA', 'CRV', 'PLS'], pop: 1.0, factor: 1.05 },
  { code: 'OB12', name: 'Geysers & Greenhouses', region: 'Outer Belt', nights: 12, ports: ['EMA', 'PLS', 'CRV', 'JNP', 'HLR'], pop: 0.85, factor: 1.1 },
  { code: 'FR10', name: 'Comet Coast', region: 'Far Reach', nights: 10, ports: ['LRG', 'WRN', 'AST'], pop: 0.9, factor: 1.25 },
  { code: 'FR14', name: 'Far Reach Odyssey', region: 'Far Reach', nights: 14, ports: ['NSP', 'LRG', 'ORR', 'TMS', 'SBL'], pop: 0.95, factor: 1.3 },
  { code: 'FR18', name: 'Twin Suns Grand Voyage', region: 'Far Reach', nights: 18, ports: ['LRG', 'ORR', 'WRN', 'AST', 'TMS', 'SBL'], pop: 0.8, factor: 1.4 }
]
const offersNebula = (it: ItinDef) => it.nights >= 10

interface FareDef { code: string; name: string; refundable: boolean; deposit: number; mult: number; cancel: number }
const FARES: FareDef[] = [
  { code: 'EO', name: 'Early Orbit', refundable: false, deposit: 0.25, mult: 0.85, cancel: 0.04 },
  { code: 'STD', name: 'Standard', refundable: false, deposit: 0.15, mult: 1.0, cancel: 0.08 },
  { code: 'FLX', name: 'Flex', refundable: true, deposit: 0.1, mult: 1.12, cancel: 0.15 },
  { code: 'LM', name: 'Last Minute', refundable: false, deposit: 1.0, mult: 0.95, cancel: 0.02 },
  { code: 'CF', name: 'Crew & Friends', refundable: false, deposit: 0.5, mult: 0.6, cancel: 0.1 }
]

const SPEND = [
  { category: 'Spa', venue: 'Nebula Spa', dept: 'Spa', median: 140 },
  { category: 'Spa', venue: 'Float Pods', dept: 'Spa', median: 95 },
  { category: 'Zero-G Casino', venue: 'Zero-G Casino Tables', dept: 'Casino', median: 110 },
  { category: 'Zero-G Casino', venue: 'Orbit Slots', dept: 'Casino', median: 60 },
  { category: 'Excursions', venue: 'Moonwalks', dept: 'Excursions', median: 190 },
  { category: 'Excursions', venue: 'Station Tours', dept: 'Excursions', median: 120 },
  { category: 'Dining', venue: 'The Observatory Grill', dept: 'Dining', median: 85 },
  { category: 'Dining', venue: 'Comet Sushi Bar', dept: 'Dining', median: 60 },
  { category: 'Bars', venue: 'Event Horizon Lounge', dept: 'Bars', median: 26 },
  { category: 'Bars', venue: 'Starlight Bar', dept: 'Bars', median: 21 },
  { category: 'Shop', venue: 'Duty-Free Bazaar', dept: 'Retail', median: 55 }
]
const SPEND_W = [0.07, 0.05, 0.08, 0.08, 0.08, 0.07, 0.11, 0.09, 0.17, 0.12, 0.08]

const POSITIONS: Array<[string, string]> = [
  ['Captain', 'Command'], ['First Officer', 'Command'], ['Purser', 'Hotel'], ['Spa Therapist', 'Spa'], ['Spa Therapist', 'Spa'],
  ['Croupier', 'Casino'], ['Croupier', 'Casino'], ['Excursion Guide', 'Excursions'], ['Excursion Guide', 'Excursions'],
  ['Chef de Cuisine', 'Dining'], ['Sommelier', 'Dining'], ['Bartender', 'Bars'], ['Bartender', 'Bars'], ['Shop Clerk', 'Retail']
]

const DEVICES = ['Web Desktop', 'Web Mobile', 'Moonwake App', 'Call Center', 'Travel Agent']
const WEB_DEVICES = DEVICES.slice(0, 3)
const PARTY_TYPES = ['Solo', 'Couple', 'Family', 'Group']
const WINDOWS = ['0-30 days', '31-90 days', '91-180 days', '181+ days']
const windowIndex = (lead: number) => (lead <= 30 ? 0 : lead <= 90 ? 1 : lead <= 180 ? 2 : 3)
const HOME_WORLDS = ['Vashti Moon', 'Halcyon Ring', 'Quill Harbor', 'Kestrel Station', 'Corvid Station', 'Pellucid Station', "Orrin's Rest", 'Tamsin Reach', 'Nimbus Spire']
const CANCEL_REASONS = ['Changed plans', 'Medical', 'Found a better fare', 'Work conflict', 'Transit permit issue']

const CAMPAIGN_TEMPLATES = [
  { abbr: 'WSL', name: 'Wave Season Launch', channel: 'Search', month: 1, days: 45, quality: 1.1, discount: 0.05, region: 'All', quoteRate: 0.045 },
  { abbr: 'ZGH', name: 'Zero-G Honeymoon', channel: 'Holo-Ads', month: 2, days: 30, quality: 2.2, discount: 0, region: 'Inner Ring', quoteRate: 0.07 },
  { abbr: 'BAS', name: 'Belt Adventure Social', channel: 'Social', month: 4, days: 30, quality: 1.0, discount: 0.07, region: 'Outer Belt', quoteRate: 0.03 },
  { abbr: 'FRD', name: 'Far Reach Dreamers', channel: 'Email', month: 6, days: 21, quality: 1.3, discount: 0.1, region: 'Far Reach', quoteRate: 0.06 },
  { abbr: 'HBB', name: 'Holo-Billboard Blitz', channel: 'Holo-Ads', month: 9, days: 30, quality: 0.45, discount: 0, region: 'All', quoteRate: 0.012 },
  { abbr: 'CSA', name: 'Comet Season Affiliates', channel: 'Affiliate', month: 11, days: 30, quality: 0.9, discount: 0.05, region: 'Far Reach', quoteRate: 0.04 }
]

// ---------------------------------------------------------------------------------------------
// Runtime types

interface Ship { key: number; code: string; name: string; cls: string; capacity: number; cabins: number[]; berths: number[]; decks: number; launch: number; gravity: boolean }
interface Sailing {
  key: number; code: string; ship: Ship; itin: ItinDef; dep: Date; ret: Date; caps: number[]; capacity: number
  demand: number; season: number; storm: boolean; lineCancelled: Date | null
  sold: number[]; soldTotal: number; revenue: number; active: number; cancellations: number; bookings: Booking[]
}
interface Campaign { key: number; code: string; name: string; channel: string; region: string; discount: number; budget: number; start: Date; end: Date; quality: number; quoteRate: number }
interface Household { key: number; id: string; name: string; world: string; segment: string; since: Date; email: string | null; optIn: boolean; sailings: number; bookings: number }
interface Booking {
  id: string; sailing: Sailing; cls: number; fare: number; household: Household; campaign: Campaign | null; campaignKey: number; device: string
  campCode: string | null; pax: number; partyType: string; insurance: boolean; booked: Date; bookedAt: Date; lead: number; price: number
  gross: number; discount: number; net: number; portFees: number; levy: number; ins: number; total: number; deposit: number
  depositDue: Date | null; finalDue: Date | null; depositPaid: Date | null; finalPaid: Date | null
  cancelDate: Date | null; cancelReason: string | null; cancelled: boolean; cancelFee: number; noShow: boolean; repeat: boolean; migrated: boolean
}
interface Crew { id: string; name: string; hire: Date; versions: Scd2Version[] }

const money = (v: number) => round(v, 2)

function attrsAt(e: Crew, d: Date): Record<string, Scalar> {
  let cur = e.versions[0].attrs
  for (const v of e.versions) if (v.from.getTime() <= d.getTime()) cur = v.attrs
  return cur
}

function without(r: Row, key: string): Row {
  const o: Row = {}
  for (const [k, v] of Object.entries(r)) if (k !== key) o[k] = v
  return o
}

function* daysFrom(a: Date, b: Date): Generator<Date> {
  for (let d = dateOnly(a); d.getTime() <= b.getTime(); d = addDays(d, 1)) yield d
}

// ---------------------------------------------------------------------------------------------

export function* generateMoonwake(ctx: GenContext): Generator<Batch> {
  const { start, today } = ctx
  const end = ctx.calendarEnd
  const span = daysBetween(start, today)
  const scaleName = ctx.scale.name
  const infl = (d: Date) => Math.pow(1.035, Math.max(0, d.getUTCFullYear() - start.getUTCFullYear()))
  const WINDOW = ctx.tiny ? 14 : scaleName === 'large' ? 60 : 50
  const MAX_LEAD = 420
  const CHARGE_RATE = 0.06

  // ---- fleet ----------------------------------------------------------------------------------
  const rs = ctx.rng('fleet')
  const shipDefs: Array<{ name: string; cls: string; cap: number }> = ctx.tiny
    ? [{ name: 'MSV Lantern Tide', cls: 'Skiff-class', cap: 34 }]
    : [
        { name: 'MSV Lantern Tide', cls: 'Skiff-class', cap: 130 },
        { name: 'MSV Velvet Comet', cls: 'Clipper-class', cap: 180 },
        { name: 'MSV Aurora Drift', cls: 'Galleon-class', cap: 230 }
      ]
  if (scaleName === 'large') {
    const used = new Set(shipDefs.map((s) => s.name))
    while (shipDefs.length < 18) {
      const n = `MSV ${rs.pick(ADJECTIVES)} ${rs.pick(NOUNS)}`
      if (used.has(n)) continue
      used.add(n)
      const cls = rs.weighted(['Skiff-class', 'Clipper-class', 'Galleon-class'], [0.3, 0.4, 0.3])
      shipDefs.push({ name: n, cls, cap: cls === 'Skiff-class' ? 150 : cls === 'Clipper-class' ? 210 : 260 })
    }
    for (const s of shipDefs) s.cap = Math.round(s.cap * 1.7)
  }
  const ships: Ship[] = shipDefs.map((d, i) => {
    const galleon = d.cls === 'Galleon-class'
    const shares = CLASSES.map((c, k) => (k === CNS ? (galleon ? c.share : 0) : k === ZGS && !galleon ? c.share + CLASSES[CNS].share : c.share))
    const berths = shares.map((sh, k) => (sh === 0 ? 0 : Math.max(CLASSES[k].berths, Math.round((d.cap * sh) / CLASSES[k].berths) * CLASSES[k].berths)))
    const cabins = berths.map((b, k) => b / CLASSES[k].berths)
    return {
      key: i + 1, code: `MSV-${String(i + 1).padStart(2, '0')}`, name: d.name, cls: d.cls, capacity: berths.reduce((a, b) => a + b, 0), cabins, berths,
      decks: d.cls === 'Skiff-class' ? 4 : d.cls === 'Clipper-class' ? 6 : 8, launch: start.getUTCFullYear() - rs.int(1, 14), gravity: d.cls !== 'Skiff-class'
    }
  })

  // ---- schedule & demand --------------------------------------------------------------------
  const rsch = ctx.rng('schedule')
  const sailings: Sailing[] = []
  for (const ship of ships) {
    const allowed = ITINS.filter((it) => (ship.cls === 'Skiff-class' ? it.nights <= 10 : ship.cls === 'Clipper-class' ? it.nights <= 14 : true))
    let dep = addDays(start, rsch.int(0, 9))
    const dock = addDays(start, rsch.int(Math.floor(span * 0.2), Math.floor(span * 0.8)))
    let docked = false
    while (dep.getTime() <= end.getTime()) {
      if (!docked && dep.getTime() >= dock.getTime() && ctx.scale.years > 1) {
        dep = addDays(dep, 21) // dry dock
        docked = true
        continue
      }
      const itin = rsch.weighted(allowed, allowed.map((it) => it.pop))
      const season = annualCycle(dep, 190, 0.12) + (dep.getUTCMonth() === 11 ? 0.08 : 0)
      const caps = ship.berths.map((b, k) => (k === CNS && !offersNebula(itin) ? 0 : b))
      sailings.push({
        key: 0, code: `${ship.code}-${dateKey(dep)}`, ship, itin, dep, ret: addDays(dep, itin.nights), caps, capacity: caps.reduce((a, b) => a + b, 0),
        demand: clamp(itin.pop * season * rsch.normal(1, 0.13), 0.5, 1.6), season, storm: false, lineCancelled: null,
        sold: caps.map(() => 0), soldTotal: 0, revenue: 0, active: 0, cancellations: 0, bookings: []
      })
      dep = addDays(dep, itin.nights + 1)
    }
  }
  sailings.sort((a, b) => a.dep.getTime() - b.dep.getTime() || a.ship.key - b.ship.key)
  sailings.forEach((s, i) => (s.key = i + 1))

  // solar storm, pricing mistake
  const announce = addDays(start, Math.floor(span * 0.45))
  const stormEnd = addDays(announce, 40)
  const affected = sailings.filter((s) => s.itin.region === 'Outer Belt' && s.dep.getTime() >= addDays(announce, 3).getTime() && s.dep.getTime() <= stormEnd.getTime())
  for (const s of affected) s.storm = true
  for (const s of affected.slice(0, 2)) s.lineCancelled = addDays(announce, 1)
  const mistakeStart = addDays(start, Math.floor(span * 0.3))
  const inMistake = (d: Date) => d.getTime() >= mistakeStart.getTime() && d.getTime() < addDays(mistakeStart, 3).getTime()

  // lead-time density
  const pdf = new Float64Array(MAX_LEAD + 1)
  let tot = 0
  for (let L = 1; L <= MAX_LEAD; L++) {
    pdf[L] = Math.exp(-Math.pow(Math.log(L / 120), 2) / (2 * 0.65 * 0.65)) / L
    tot += pdf[L]
  }
  for (let L = 1; L <= MAX_LEAD; L++) pdf[L] = (pdf[L] / tot) * 0.88 + (L <= 21 ? 0.12 / 21 : 0)

  const priceOf = (s: Sailing, cls: number, d: Date): number => {
    const load = s.soldTotal / s.capacity
    const lead = daysBetween(d, s.dep)
    const base = CLASSES[cls === ZGS && inMistake(d) ? INP : cls].rate
    let p = base * s.itin.factor * s.season * infl(d) * (0.82 + 0.65 * Math.pow(load, 1.6))
    if (lead <= 21) p *= load < 0.7 ? 0.85 : 1.1
    return Math.round(p)
  }
  const refPrice = (s: Sailing, cls: number, d: Date) => CLASSES[cls].rate * s.itin.factor * s.season * infl(d) * 1.05

  // ---- campaigns ----------------------------------------------------------------------------
  const rc = ctx.rng('campaigns')
  const campaigns: Campaign[] = []
  for (let y = start.getUTCFullYear(); y <= today.getUTCFullYear(); y++) {
    for (const t of CAMPAIGN_TEMPLATES) {
      const s = ymd(y, t.month, rc.int(1, 10))
      if (s.getTime() > today.getTime()) continue
      campaigns.push({
        key: campaigns.length + 1, code: `MW-${t.abbr}-${String(y).slice(2)}`, name: `${t.name} ${y}`, channel: t.channel, region: t.region, discount: t.discount,
        budget: money(rc.logNormal(42000, 0.35) * ctx.scale.factor), start: s, end: addDays(s, t.days - 1), quality: t.quality * rc.normal(1, 0.08), quoteRate: t.quoteRate
      })
    }
  }

  // ---- crew (SCD2) --------------------------------------------------------------------------
  const rh = ctx.rng('crew')
  const crews: Crew[] = []
  for (const ship of ships) {
    for (const [role, dept] of POSITIONS) {
      let hire = addDays(start, -rh.int(30, 1500))
      while (hire.getTime() <= today.getTime()) {
        const tenure = Math.max(60, Math.round(rh.exponential((dept === 'Command' ? 5 : 2.2) * 365)))
        let leave: Date | null = addDays(hire, tenure)
        if (leave.getTime() > today.getTime()) leave = null
        const id = `C-${String(crews.length + 1).padStart(4, '0')}`
        const n = personName(rh)
        const attrs: Record<string, Scalar> = {
          full_name: n.full, rank: role, department: dept, ship_code: ship.code, ship_name: ship.name,
          contract_type: dept === 'Command' || dept === 'Hotel' ? 'Permanent' : rh.chance(0.7) ? 'Rotational' : 'Permanent', employment_status: 'Active', hire_date: dateOnly(hire)
        }
        const last = leave ?? today
        const tenureDays = daysBetween(hire, last)
        const events: Array<{ at: Date; apply: (p: Record<string, Scalar>) => Record<string, Scalar> }> = []
        if (tenureDays > 400 && rh.chance(0.25) && dept !== 'Command') events.push({ at: addDays(hire, rh.int(365, tenureDays - 1)), apply: (p) => ({ ...p, rank: `Senior ${p.rank as string}` }) })
        if (ships.length > 1 && tenureDays > 200 && rh.chance(0.3)) {
          const dest = rh.pick(ships.filter((o) => o !== ship))
          events.push({ at: addDays(hire, rh.int(180, tenureDays - 1)), apply: (p) => ({ ...p, ship_code: dest.code, ship_name: dest.name }) })
        }
        events.sort((a, b) => a.at.getTime() - b.at.getTime())
        if (leave) events.push({ at: leave, apply: (p) => ({ ...p, employment_status: 'Departed' }) })
        const versions: Scd2Version[] = [{ from: dateOnly(hire), attrs }]
        for (const ev of events) versions.push({ from: dateOnly(ev.at), attrs: ev.apply(versions[versions.length - 1].attrs) })
        crews.push({ id, name: n.full, hire: dateOnly(hire), versions })
        if (!leave) break
        hire = addDays(leave, rh.int(10, 40))
      }
    }
  }
  const crewRows = scd2Rows(crews.map((c) => ({ businessKey: c.id, versions: c.versions })), { skColumn: 'crew_sk', bkColumn: 'crew_id' })
  const crewIndex = new Scd2Index(crewRows, 'crew_sk', 'crew_id')
  const rosterCache = new Map<string, Crew[]>()
  const roster = (ship: Ship, dept: string, d: Date): Crew[] => {
    const k = `${ship.code}|${dept}|${monthKey(d)}`
    let list = rosterCache.get(k)
    if (!list) {
      const mid = minDate(ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, 15), today)
      const onShip = crews.filter((c) => c.hire.getTime() <= mid.getTime() && attrsAt(c, mid).ship_code === ship.code && attrsAt(c, mid).employment_status === 'Active')
      list = onShip.filter((c) => attrsAt(c, mid).department === dept)
      if (!list.length) list = onShip
      if (!list.length) list = [crews[0]]
      rosterCache.set(k, list)
    }
    return list
  }

  // ---- static batch -------------------------------------------------------------------------
  const sT: Record<string, Row[]> = {}
  const sB: BronzeFile[] = []
  const rb = ctx.rng('static-bronze')
  sT.gold_dim_ship = ships.map((s) => ({
    ship_key: s.key, ship_code: s.code, ship_name: s.name, ship_class: s.cls, berth_capacity: s.capacity, cabin_count: s.cabins.reduce((a, b) => a + b, 0),
    decks: s.decks, launch_year: s.launch, home_port: 'Vashti Moon', has_gravity_ring: s.gravity
  }))
  sT.silver_ships = sT.gold_dim_ship.map((r) => without(r, 'ship_key'))
  sT.silver_ship_cabins = []
  const fleetRows: BronzeRow[] = []
  for (const s of ships) {
    CLASSES.forEach((cl, k) => {
      if (!s.berths[k]) return
      sT.silver_ship_cabins.push({ ship_code: s.code, class_code: cl.code, cabins: s.cabins[k], berths: s.berths[k] })
      fleetRows.push({ ship: { code: s.code, name: s.name, class: s.cls, decks: s.decks, launchYear: s.launch, homePort: 'Vashti Moon', gravityRing: s.gravity }, cabinClass: cl.code, cabins: s.cabins[k], berths: s.berths[k] })
    })
  }
  injectCasing(fleetRows, 'ship.class', { rng: rb, sink: ctx, code: 'MW12', rate: 0.25, atLeast: 1 })
  sB.push({ source: 'fleet', path: 'fleet/fleet_registry.json', format: 'json', rows: fleetRows, json: { envelope: { service: 'fleet-registry', version: '3.1', generatedAt: formatDate(today, 'iso_t') }, dataKey: 'cabinInventory' } })

  sT.gold_dim_cabin_class = CLASSES.map((cl, k) => ({ cabin_class_key: k + 1, class_code: cl.code, class_name: cl.name, class_tier: cl.tier, berths_per_cabin: cl.berths, has_window: cl.window, deck_band: cl.deck }))
  sT.gold_dim_port = PORTS.map((p, i) => ({ port_key: i + 1, port_code: p.code, port_name: p.name, body_type: p.body, system_region: p.region, surface_gravity_g: p.g, docking_fee_per_passenger: p.fee, highlight: p.highlight }))
  sT.silver_ports = sT.gold_dim_port.map((r) => without(r, 'port_key'))
  const portKey = new Map(PORTS.map((p, i) => [p.code, i + 1]))
  const portFee = new Map(PORTS.map((p) => [p.code, p.fee]))
  sT.silver_itineraries = ITINS.map((it) => ({ itinerary_code: it.code, itinerary_name: it.name, region: it.region, nights: it.nights, popularity_index: it.pop, offers_nebula_suite: offersNebula(it) }))
  const voyageDay = (it: ItinDef, i: number) => Math.max(1, Math.round(((i + 1) * it.nights) / (it.ports.length + 1)))
  sT.silver_itinerary_ports = ITINS.flatMap((it) => it.ports.map((p, i) => ({ itinerary_code: it.code, stop_sequence: i + 1, port_code: p, voyage_day: voyageDay(it, i) })))
  const portCallRows: BronzeRow[] = sT.silver_itinerary_ports.map((r) => ({ ...r }) as BronzeRow)
  injectWhitespace(portCallRows, 'port_code', { rng: rb, sink: ctx, code: 'MW13', rate: 0.1, atLeast: 1 })
  const statusOf = (s: Sailing) => (s.lineCancelled ? 'Cancelled' : s.ret.getTime() <= today.getTime() ? 'Completed' : s.dep.getTime() <= today.getTime() ? 'In Space' : 'Scheduled')
  sT.gold_dim_sailing = sailings.map((s) => ({
    sailing_key: s.key, sailing_code: s.code, ship_code: s.ship.code, ship_name: s.ship.name, itinerary_code: s.itin.code, itinerary_name: s.itin.name, region: s.itin.region,
    nights: s.itin.nights, departure_date: s.dep, return_date: s.ret, berth_capacity: s.capacity, sailing_status: statusOf(s), is_storm_affected: s.storm
  }))
  sT.silver_sailings = sailings.map((s) => ({ sailing_code: s.code, ship_code: s.ship.code, itinerary_code: s.itin.code, departure_date: s.dep, return_date: s.ret, berth_capacity: s.capacity, sailing_status: statusOf(s) }))
  sT.gold_bridge_sailing_port = sailings.flatMap((s) => s.itin.ports.map((p, i) => ({ sailing_key: s.key, port_key: portKey.get(p)!, stop_sequence: i + 1, voyage_day: voyageDay(s.itin, i) })))
  sB.push(
    { source: 'itineraries', path: 'itineraries/ports.csv', format: 'csv', rows: sT.silver_ports.map((r) => ({ ...r }) as BronzeRow) },
    { source: 'itineraries', path: 'itineraries/itineraries.csv', format: 'csv', rows: sT.silver_itineraries.map((r) => ({ ...r }) as BronzeRow) },
    { source: 'itineraries', path: 'itineraries/port_calls.csv', format: 'csv', rows: portCallRows },
    { source: 'itineraries', path: 'itineraries/sailings.csv', format: 'csv', rows: sT.silver_sailings.map((r) => ({ ...r }) as BronzeRow) }
  )
  sT.gold_dim_fare_class = FARES.map((f, i) => ({ fare_class_key: i + 1, fare_code: f.code, fare_name: f.name, is_refundable: f.refundable, deposit_pct: f.deposit, fare_multiplier: f.mult }))
  sT.gold_dim_campaign = [
    { campaign_key: -1, campaign_code: 'UNKNOWN', campaign_name: 'Unknown campaign code', channel: 'Unknown', target_region: 'All', offer_discount_pct: 0, budget: 0, start_date: null, end_date: null },
    { campaign_key: 0, campaign_code: 'ORGANIC', campaign_name: 'Organic / Direct', channel: 'Organic', target_region: 'All', offer_discount_pct: 0, budget: 0, start_date: null, end_date: null },
    ...campaigns.map((c) => ({ campaign_key: c.key, campaign_code: c.code, campaign_name: c.name, channel: c.channel, target_region: c.region, offer_discount_pct: c.discount, budget: c.budget, start_date: c.start, end_date: c.end }))
  ]
  sT.silver_campaigns = campaigns.map((c) => ({ campaign_code: c.code, campaign_name: c.name, channel: c.channel, target_region: c.region, offer_discount_pct: c.discount, budget: c.budget, start_date: c.start, end_date: c.end }))
  sB.push({ source: 'campaigns', path: 'marketing/campaigns.json', format: 'json', rows: sT.silver_campaigns.map((r) => ({ ...r }) as BronzeRow) })
  sT.gold_dim_spend_category = SPEND.map((s, i) => ({ spend_category_key: i + 1, category: s.category, venue: s.venue, department: s.dept }))
  sT.gold_dim_crew = crewRows
  sT.gold_dim_booking_profile = []
  const profileKey = (device: string, party: string, win: number, ins: boolean) => ((DEVICES.indexOf(device) * PARTY_TYPES.length + PARTY_TYPES.indexOf(party)) * WINDOWS.length + win) * 2 + (ins ? 1 : 0) + 1
  for (const dv of DEVICES) for (const pt of PARTY_TYPES) WINDOWS.forEach((w, wi) => [false, true].forEach((ins) => sT.gold_dim_booking_profile.push({ booking_profile_key: profileKey(dv, pt, wi, ins), booking_device: dv, party_type: pt, booking_window: w, booking_window_order: wi + 1, has_insurance: ins })))

  // fare sheets & space weather
  sT.silver_fare_rates = []
  for (let y = start.getUTCFullYear(); y <= today.getUTCFullYear(); y++) {
    const rows: BronzeRow[] = []
    for (const it of ITINS) {
      CLASSES.forEach((cl, k) => {
        const offered = k !== CNS || offersNebula(it)
        const rate = money(cl.rate * it.factor * Math.pow(1.035, y - start.getUTCFullYear()))
        if (offered) sT.silver_fare_rates.push({ fare_year: y, itinerary_code: it.code, class_code: cl.code, base_rate_per_berth_night: rate })
        else ctx.issue('MW07')
        rows.push({ Itinerary: it.code, 'Itinerary Name': it.name, 'Cabin Class': cl.code, Rate: offered ? rate : rb.pick(['N/A', -1]), Currency: 'STC' })
      })
    }
    sB.push({ source: 'fare_sheet', path: `pricing/fare_sheet_${y}.xlsx`, format: 'xlsx', rows, xlsx: { sheet: `Fares ${y}`, titleLines: [`Moonwake Star Cruises — base fare sheet ${y}`, 'Rates per berth-night in Star Credits (STC), before dynamic pricing'] } })
  }
  const adv: Row[] = []
  const rwx = ctx.rng('weather')
  for (let y = start.getUTCFullYear(); y <= today.getUTCFullYear(); y++) {
    for (let k = 0; k < 3; k++) {
      const at = ymd(y, rwx.int(1, 12), rwx.int(1, 28))
      if (at.getTime() > today.getTime()) continue
      adv.push({ advisory_id: '', issued_on: at, region: rwx.pick(['Inner Ring', 'Outer Belt', 'Far Reach']), level: 'Watch', valid_until: addDays(at, rwx.int(1, 4)), headline: 'Elevated solar wind — minor navigation delays possible' })
    }
  }
  if (announce.getTime() <= today.getTime()) {
    adv.push(
      { advisory_id: '', issued_on: addDays(announce, -3), region: 'Outer Belt', level: 'Watch', valid_until: announce, headline: 'Coronal mass ejection detected — monitoring' },
      { advisory_id: '', issued_on: announce, region: 'Outer Belt', level: 'Warning', valid_until: addDays(announce, 6), headline: 'Solar storm warning for the Outer Belt — consider postponing travel' },
      { advisory_id: '', issued_on: addDays(announce, 6), region: 'Outer Belt', level: 'Severe', valid_until: stormEnd, headline: 'Severe radiation storm — non-essential voyages suspended' }
    )
  }
  adv.sort((a, b) => (a.issued_on as Date).getTime() - (b.issued_on as Date).getTime())
  adv.forEach((a, i) => (a.advisory_id = `ADV-${String(i + 1).padStart(4, '0')}`))
  sT.silver_space_weather = adv
  sB.push({ source: 'space_weather', path: 'ops/space_weather_advisories.json', format: 'json', rows: adv.map((r) => ({ ...r }) as BronzeRow), json: { envelope: { feed: 'traffic-authority/space-weather', format: 'v1' }, dataKey: 'advisories' } })
  yield { label: 'static', tables: sT, bronze: sB }

  // ---- simulation -----------------------------------------------------------------------------
  const rng = ctx.rng('sim')
  const households: Household[] = []
  const hhKey = (h: Household) => h.key
  const driftDate = addDays(start, Math.floor(span * 0.55))
  const cancelQueue = new Map<number, Booking[]>()
  const payQueue = new Map<number, Array<{ b: Booking; type: 'Deposit' | 'Final' | 'Full' }>>()
  const pendingApi = new Map<number, BronzeRow[]>()
  const push = <T>(m: Map<number, T[]>, k: number, v: T) => {
    const l = m.get(k)
    if (l) l.push(v)
    else m.set(k, [v])
  }
  let bookingSeq = 0
  let quoteSeq = 0
  let paySeq = 0
  let chargeSeq = 0
  let lo = 0
  let snapLo = 0
  let firstApi = true
  let firstQuoteFile = true
  let firstSessionsFile = true
  let firstPayFile = true
  let firstFolio = true
  let deviceNullPlanted = false
  let orphanPlanted = false
  let driftLogged = false
  const legacyBookings: BronzeRow[] = []
  const legacyPayments: BronzeRow[] = []
  const depByKey = new Map<number, Sailing[]>()
  for (const s of sailings) push(depByKey, dateKey(s.dep), s)

  const newBatch = () => ({
    T: {
      gold_fact_booking: [], gold_fact_sailing_inventory: [], gold_fact_onboard_charge: [], gold_fact_quote: [], silver_bookings: [], silver_booking_fare_lines: [],
      silver_payments: [], silver_quotes: [], silver_web_sessions_daily: [], silver_onboard_charges: [], silver_crew_snapshots: []
    } as Record<string, Row[]>,
    B: [] as BronzeFile[],
    payRows: [] as BronzeRow[],
    sessionRows: [] as BronzeRow[]
  })
  let batch = newBatch()

  const fk = (d: Date | null) => (d ? dateKey(maxDate(d, start)) : null)
  const emitBooking = (b: Booking) => {
    const s = b.sailing
    const sailed = s.dep.getTime() <= today.getTime() && !b.cancelled && !s.lineCancelled
    const status = b.cancelled ? 'Cancelled' : sailed ? (b.noShow ? 'No-Show' : 'Sailed') : b.finalPaid ? 'Fully Paid' : b.depositPaid ? 'Deposit Paid' : 'Booked'
    batch.T.gold_fact_booking.push({
      booking_id: b.id, sail_date: s.dep, booking_date_key: fk(b.booked)!, deposit_date_key: fk(b.depositPaid), final_payment_date_key: fk(b.finalPaid), sail_date_key: dateKey(s.dep),
      cancel_date_key: b.cancelled ? fk(b.cancelDate) : null, original_booking_date: b.booked, sailing_key: s.key, ship_key: s.ship.key, cabin_class_key: b.cls + 1,
      fare_class_key: b.fare + 1, household_key: hhKey(b.household), campaign_key: b.campaignKey, booking_profile_key: profileKey(b.device, b.partyType, windowIndex(b.lead), b.insurance),
      passengers: b.pax, nights: s.itin.nights, berth_nights: b.pax * s.itin.nights, lead_time_days: b.lead, fare_per_berth_night: b.price, gross_fare: b.gross,
      discount_amount: b.discount, net_fare: b.net, port_fees: b.portFees, transit_levy: b.levy, insurance_amount: b.ins, total_amount: b.total, cancellation_fee: b.cancelFee,
      is_cancelled: b.cancelled, is_no_show: sailed && b.noShow, is_repeat_guest: b.repeat, is_migrated: b.migrated, status, cancellation_reason: b.cancelled ? b.cancelReason : null
    })
    batch.T.silver_bookings.push({
      booking_id: b.id, booked_at: b.bookedAt, departure_date: s.dep, sailing_code: s.code, class_code: CLASSES[b.cls].code, fare_code: FARES[b.fare].code, household_id: b.household.id,
      campaign_code: b.campCode, device: b.device, passengers: b.pax, has_insurance: b.insurance, total_amount: b.total,
      source_system: b.migrated ? 'legacy_migration' : b.booked.getTime() >= driftDate.getTime() ? 'booking_api_v2' : 'booking_api_v1', cancelled_on: b.cancelled ? b.cancelDate : null,
      cancellation_reason: b.cancelled ? b.cancelReason : null
    })
    const lines: Array<[string, number]> = [['Cruise Fare', b.gross], ['Discount', -b.discount], ['Port Fees', b.portFees], ['Transit Levy', b.levy]]
    if (b.ins > 0) lines.push(['Travel Insurance', b.ins])
    for (const [t, a] of lines) batch.T.silver_booking_fare_lines.push({ booking_id: b.id, departure_date: s.dep, line_type: t, amount: a })
  }

  const cancelBooking = (b: Booking, d: Date, reason: string, feeWaived: boolean) => {
    if (b.cancelled) return
    b.cancelled = true
    b.cancelDate = d
    b.cancelReason = reason
    const s = b.sailing
    s.sold[b.cls] -= b.pax
    s.soldTotal -= b.pax
    s.revenue -= b.net
    s.active--
    s.cancellations++
    const daysOut = daysBetween(d, s.dep)
    if (feeWaived || !b.depositPaid) b.cancelFee = 0
    else if (FARES[b.fare].refundable) b.cancelFee = daysOut > 14 ? 0 : money(b.net * 0.25)
    else b.cancelFee = money(Math.min(b.total, b.deposit + (daysOut <= 30 ? b.net * 0.5 : 0)))
  }

  const simStart = addDays(start, -MAX_LEAD)
  for (const d of daysFrom(simStart, today)) {
    const dk = dateKey(d)
    const live = d.getTime() >= start.getTime()
    // storm announcement
    if (dk === dateKey(announce)) {
      for (const s of affected) {
        for (const b of s.bookings) {
          if (b.cancelled) continue
          if (s.lineCancelled) {
            b.cancelDate = s.lineCancelled
            b.cancelReason = 'Sailing cancelled by Moonwake'
            push(cancelQueue, dateKey(s.lineCancelled), b)
          } else if (rng.chance(0.42)) {
            const at = addDays(announce, rng.int(0, 10))
            if (at.getTime() < s.dep.getTime() && (!b.cancelDate || at.getTime() < b.cancelDate.getTime())) {
              b.cancelDate = at
              b.cancelReason = 'Solar storm advisory'
              push(cancelQueue, dateKey(at), b)
            }
          }
        }
      }
    }
    // quotes & bookings
    while (lo < sailings.length && sailings[lo].dep.getTime() <= d.getTime()) lo++
    const active = campaigns.filter((c) => d.getTime() >= c.start.getTime() && d.getTime() <= c.end.getTime())
    const quoteCount = new Map<string, number>() // campaignCode|device → quotes (web devices)
    const quoteFile: BronzeRow[] = []
    for (let i = lo; i < sailings.length; i++) {
      const s = sailings[i]
      const L = daysBetween(d, s.dep)
      if (L > MAX_LEAD) break
      if (s.lineCancelled && d.getTime() >= s.lineCancelled.getTime()) continue
      const stormDamp = s.storm && d.getTime() >= announce.getTime() ? 0.3 : 1
      const lambda = ((s.capacity * s.demand * 1.08) / (2.3 * 0.5)) * pdf[L] * stormDamp
      const n = rng.poisson(lambda)
      for (let q = 0; q < n; q++) {
        // attribution
        let camp: Campaign | null = null
        let campKey = 0
        let campCode: string | null = null
        if (active.length && rng.chance(0.55)) {
          camp = rng.weighted(active, active.map((c) => (c.region === 'All' || c.region === s.itin.region ? 3 : 1)))
          campKey = camp.key
          campCode = camp.code
        }
        if (!camp && rng.chance(0.004) || (!orphanPlanted && live)) {
          camp = null
          campKey = -1
          campCode = `MW-${rng.pick(['ZGH', 'WSL', 'FRD'])}-${rng.int(10, 99)}X`
          orphanPlanted = true
          if (live) ctx.issue('MW09')
        }
        const device = camp ? rng.weighted(DEVICES, [0.4, 0.45, 0.15, 0, 0]) : rng.weighted(DEVICES, [0.3, 0.3, 0.12, 0.15, 0.13])
        const partyType = rng.weighted(PARTY_TYPES, [0.18, 0.45, 0.22, 0.15])
        const pax = partyType === 'Solo' ? 1 : partyType === 'Couple' ? 2 : partyType === 'Family' ? rng.int(3, 5) : rng.int(4, 6)
        const clsW = CLASSES.map((cl, k) => (s.caps[k] ? [0.34, 0.3, 0.22, 0.11, 0.03][k] * (cl.berths >= pax || k < ZGS ? 1 : 0.4) : 0))
        const cls = rng.weighted(CLASSES.map((_, k) => k), clsW)
        const price = priceOf(s, cls, d)
        const quotedAt = new Date(d.getTime() + rng.int(6 * 3600, 23 * 3600) * 1000)
        // conversion
        const quality = camp ? camp.quality : 1
        const pConv = clamp(0.5 * quality * Math.pow(refPrice(s, cls, d) / price, 1.4), 0.02, 0.95)
        const available = s.caps[cls] - s.sold[cls] >= pax
        let booking: Booking | null = null
        if (available && rng.chance(pConv)) {
          const repeat = households.length > 20 && rng.chance(0.3)
          let hh: Household
          if (repeat) hh = households[rng.int(0, households.length - 1)]
          else {
            const nm = personName(rng)
            hh = {
              key: households.length + 1, id: `H-${String(households.length + 1).padStart(7, '0')}`, name: nm.full, world: rng.pick(HOME_WORLDS), segment: partyType, since: d,
              email: rng.chance(0.88) ? email(nm.first, nm.last, 'mail.example', rng) : null, optIn: rng.chance(0.6), sailings: 0, bookings: 0
            }
            households.push(hh)
          }
          const fareIdx = rng.chance(0.02) ? 4 : L > 180 ? rng.weighted([0, 1, 2], [0.55, 0.35, 0.1]) : L > 21 ? rng.weighted([1, 2], [0.72, 0.28]) : rng.weighted([3, 1, 2], [0.7, 0.2, 0.1])
          const ppn = Math.round(price * FARES[fareIdx].mult)
          const gross = money(ppn * pax * s.itin.nights)
          const loyalty = hh.bookings >= 4 ? 0.05 : 0
          const discount = money(gross * ((camp ? camp.discount : 0) + loyalty))
          const net = money(gross - discount)
          const portFees = money(s.itin.ports.reduce((a, p) => a + portFee.get(p)!, 0) * pax * infl(d))
          const levy = money(net * 0.08)
          const insurance = rng.chance(partyType === 'Family' ? 0.5 : 0.33)
          const ins = insurance ? money(net * 0.06) : 0
          const total = money(gross - discount + portFees + levy + ins)
          const fare = FARES[fareIdx]
          const b: Booking = {
            id: `BK-${String(++bookingSeq).padStart(7, '0')}`, sailing: s, cls, fare: fareIdx, household: hh, campaign: camp, campaignKey: campKey, campCode, device, pax, partyType, insurance,
            booked: d, bookedAt: quotedAt, lead: L, price: ppn, gross, discount, net, portFees, levy, ins, total, deposit: money(total * (L <= 60 ? 1 : fare.deposit)),
            depositDue: null, finalDue: null, depositPaid: null, finalPaid: null, cancelDate: null, cancelReason: null, cancelled: false, cancelFee: 0,
            noShow: rng.chance(0.015), repeat: hh.bookings > 0, migrated: !live
          }
          hh.bookings++
          booking = b
          s.sold[cls] += pax
          s.soldTotal += pax
          s.revenue += net
          s.active++
          s.bookings.push(b)
          // lifecycle plan
          if (L > 14 && rng.chance(0.03)) {
            b.cancelDate = addDays(d, 7)
            b.cancelReason = 'Deposit not received'
          } else {
            if (L <= 60) {
              b.depositDue = d
              b.finalDue = d
              push(payQueue, dk, { b, type: 'Full' })
            } else {
              b.depositDue = addDays(d, rng.int(0, 2))
              b.finalDue = maxDate(addDays(b.depositDue, 1), addDays(s.dep, -60 - rng.int(0, 20)))
              push(payQueue, dateKey(b.depositDue), { b, type: 'Deposit' })
              push(payQueue, dateKey(b.finalDue), { b, type: 'Final' })
            }
            if (L > 2 && rng.chance(fare.cancel)) {
              b.cancelDate = addDays(d, rng.int(1, L - 1))
              b.cancelReason = rng.pick(CANCEL_REASONS)
            }
          }
          if (b.cancelDate) push(cancelQueue, dateKey(b.cancelDate), b)
          // bronze
          if (live) {
            const v2 = d.getTime() >= driftDate.getTime()
            const row: BronzeRow = {
              bookingRef: b.id, bookedAt: quotedAt, sailing: s.code, cabinClass: CLASSES[cls].code, [v2 ? 'fare_code' : 'fareClass']: fare.code,
              household: { id: hh.id, leadGuest: hh.name }, passengers: Array.from({ length: pax }, (_, k) => ({ seq: k + 1, ageBand: rng.pick(['0-12', '13-17', '18-34', '35-54', '55+']) })),
              channel: device, utm: campCode,
              amounts: { fare: gross, discount, portFees, levy, insurance: ins, total }
            }
            if (v2) row.insurance = insurance
            const land = minDate(landingDay(d, { rng, sink: ctx, code: 'MW02', rate: device === 'Travel Agent' ? 0.12 : 0.004, maxDelay: 8 }), today)
            push(pendingApi, dateKey(land), row)
          } else {
            legacyBookings.push({
              BOOKING_NO: b.id, BOOKED: isoDate(d), SAILING: s.code, CABIN: CLASSES[cls].code, FARE: fare.code, HOUSEHOLD: hh.id, PAX: pax, CHANNEL: device,
              TOTAL: total, INSURANCE: insurance ? 'Y' : 'N'
            })
          }
        }
        // quote rows
        if (live) {
          let dev = device
          if (WEB_DEVICES.includes(device)) {
            const k = `${campCode ?? 'ORGANIC'}|${device}`
            quoteCount.set(k, (quoteCount.get(k) ?? 0) + 1)
          }
          const missing = rng.chance(0.01) || !deviceNullPlanted
          if (missing) {
            deviceNullPlanted = true
            dev = 'Unknown'
            ctx.issue('MW10')
          }
          let hhq: Household | null = booking ? booking.household : null
          if (!hhq && (device === 'Moonwake App' || (device.startsWith('Web') && rng.chance(0.2))) && households.length) hhq = households[rng.int(0, households.length - 1)]
          const qid = `Q-${String(++quoteSeq).padStart(8, '0')}`
          batch.T.gold_fact_quote.push({
            quote_id: qid, quote_date: d, quote_date_key: dk, sailing_key: s.key, cabin_class_key: cls + 1, household_key: hhq ? hhq.key : -1, campaign_key: campKey, device: dev,
            booking_id: booking ? booking.id : null, is_converted: !!booking
          })
          batch.T.silver_quotes.push({
            quote_id: qid, quoted_at: quotedAt, quote_date: d, sailing_code: s.code, class_code: CLASSES[cls].code, party_size: pax, quoted_fare_per_berth_night: price,
            campaign_code: campCode, device: dev, household_id: hhq ? hhq.id : null, booking_id: booking ? booking.id : null
          })
          quoteFile.push({ event: 'quote_requested', quoteId: qid, ts: quotedAt, sailing: s.code, cabin: CLASSES[cls].code, party: pax, fare: price, utm_campaign: campCode, device: missing ? null : device, household: hhq ? hhq.id : null, bookingRef: booking ? booking.id : null })
        }
      }
    }
    // cancellations
    for (const b of cancelQueue.get(dk) ?? []) {
      if (b.cancelled || !b.cancelDate || dateKey(b.cancelDate) !== dk) continue
      cancelBooking(b, d, b.cancelReason ?? 'Changed plans', b.cancelReason === 'Sailing cancelled by Moonwake' || b.cancelReason === 'Solar storm advisory')
    }
    cancelQueue.delete(dk)
    // payments
    for (const { b, type } of payQueue.get(dk) ?? []) {
      if (b.cancelled) continue
      const amount = type === 'Final' ? money(b.total - b.deposit) : type === 'Full' ? b.total : b.deposit
      if (type === 'Deposit' || type === 'Full') b.depositPaid = d
      if (type === 'Final' || type === 'Full') b.finalPaid = d
      if (amount <= 0) continue
      const pid = `PAY-${String(++paySeq).padStart(8, '0')}`
      const row: BronzeRow = { payment_id: pid, booking_ref: b.id, paid_on: d, type, amount, method: rng.pick(['Card', 'Credit Transfer', 'Wallet']) }
      batch.T.silver_payments.push({ payment_id: pid, booking_id: b.id, paid_on: d, payment_type: type, amount })
      if (live) batch.payRows.push(row)
      else legacyPayments.push(row)
    }
    payQueue.delete(dk)
    // web sessions & quote file
    if (live) {
      const combos: Array<[string, number, string]> = [['ORGANIC', 0.06, ''], ...active.map((c) => [c.code, c.quoteRate, c.code] as [string, number, string])]
      for (const [code, rate] of combos) {
        for (const dev of WEB_DEVICES) {
          const qn = quoteCount.get(`${code}|${dev}`) ?? 0
          const sessions = Math.round(qn / rate) + rng.poisson(3 * ctx.scale.factor + 1)
          batch.T.silver_web_sessions_daily.push({ session_date: d, campaign_code: code, device: dev, sessions, quote_starts: qn })
          batch.sessionRows.push({ date: d, utm_campaign: code === 'ORGANIC' ? '(direct)' : code, device: dev, sessions, quote_starts: qn })
        }
      }
      // orphan-code quotes also produce web sessions under their own code
      for (const [k, qn] of quoteCount) {
        const [code, dev] = k.split('|')
        if (code === 'ORGANIC' || active.some((c) => c.code === code)) continue
        const sessions = Math.round(qn / 0.05) + rng.poisson(1)
        batch.T.silver_web_sessions_daily.push({ session_date: d, campaign_code: code, device: dev, sessions, quote_starts: qn })
        batch.sessionRows.push({ date: d, utm_campaign: code, device: dev, sessions, quote_starts: qn })
      }
      if (quoteFile.length) {
        injectCasing(quoteFile, 'utm_campaign', { rng, sink: ctx, code: 'MW08', rate: 0.03, atLeast: firstQuoteFile && quoteFile.some((r) => r.utm_campaign) ? 1 : 0 })
        if (quoteFile.some((r) => r.utm_campaign)) firstQuoteFile = false
        const y = d.getUTCFullYear()
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
        batch.B.push({ source: 'clickstream', path: `web/${y}/${mm}/${String(d.getUTCDate()).padStart(2, '0')}/quotes_${dk}.ndjson`, format: 'ndjson', rows: quoteFile })
      }
      // booking API daily file
      const landed = pendingApi.get(dk) ?? []
      pendingApi.delete(dk)
      if (landed.length) {
        let rows = landed
        if (d.getTime() >= driftDate.getTime() && !driftLogged) {
          ctx.issue('MW03')
          driftLogged = true
        }
        rows = injectDuplicates(rows, { rng, sink: ctx, code: 'MW01', rate: 0.006, atLeast: firstApi ? 1 : 0 })
        firstApi = false
        const y = d.getUTCFullYear()
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
        batch.B.push({ source: 'booking_api', path: `booking_api/${y}/${mm}/bookings_${dk}.json`, format: 'json', rows, json: { envelope: { api: 'starberth', version: d.getTime() >= driftDate.getTime() ? 'v2' : 'v1', date: isoDate(d), count: rows.length }, dataKey: 'bookings' } })
      }
      // booking-curve snapshot
      while (snapLo < sailings.length && sailings[snapLo].dep.getTime() < d.getTime()) snapLo++
      for (let i = snapLo; i < sailings.length; i++) {
        const s = sailings[i]
        const L = daysBetween(d, s.dep)
        if (L > WINDOW) break
        batch.T.gold_fact_sailing_inventory.push({
          sailing_key: s.key, ship_key: s.ship.key, snapshot_date: d, snapshot_date_key: dk, days_to_departure: L, berth_capacity: s.capacity, berths_sold: s.soldTotal,
          active_bookings: s.active, cancellations_to_date: s.cancellations, occupancy_pct: round(s.soldTotal / s.capacity, 4), revenue_on_books: money(s.revenue),
          lowest_fare_per_berth_night: priceOf(s, INP, d), revenue_per_available_berth: money(s.revenue / s.capacity)
        })
      }
    }
    // departures: onboard charges + booking rows
    for (const s of depByKey.get(dk) ?? []) {
      if (!s.lineCancelled) {
        const folio: BronzeRow[] = []
        for (const b of s.bookings) {
          if (b.cancelled || b.noShow) continue
          b.household.sailings++
          const nCharges = rng.poisson(b.pax * s.itin.nights * CHARGE_RATE)
          for (let k = 0; k < nCharges; k++) {
            const day = rng.int(0, s.itin.nights - 1)
            const at = new Date(addDays(s.dep, day).getTime() + rng.int(9 * 3600, 23 * 3600) * 1000)
            if (at.getTime() >= addDays(today, 1).getTime()) continue
            const vi = rng.weighted(SPEND.map((_, i) => i), SPEND_W)
            const v = SPEND[vi]
            const qty = v.category === 'Excursions' ? rng.int(1, b.pax) : rng.weighted([1, 2, 3], [0.7, 0.22, 0.08])
            const amount = money(rng.logNormal(v.median, 0.45) * qty * infl(at))
            const crew = rng.pick(roster(s.ship, v.dept, at))
            const cid = `CH-${String(++chargeSeq).padStart(8, '0')}`
            const cd = dateOnly(at)
            batch.T.gold_fact_onboard_charge.push({
              charge_id: cid, booking_id: b.id, charge_date: cd, charge_date_key: dateKey(cd), sailing_key: s.key, ship_key: s.ship.key, spend_category_key: vi + 1,
              household_key: b.household.key, crew_sk: crewIndex.lookup(crew.id, cd)!, voyage_day: day + 1, quantity: qty, amount
            })
            batch.T.silver_onboard_charges.push({ charge_id: cid, booking_id: b.id, sailing_code: s.code, charged_at: at, charge_date: cd, venue: v.venue, crew_id: crew.id, quantity: qty, amount })
            folio.push({ charge_id: cid, booking_ref: b.id, ts: at, venue: v.venue, crew_id: crew.id, qty, amount })
          }
        }
        if (folio.length) {
          injectOutliers(folio, 'amount', { rng, sink: ctx, code: 'MW17', rate: 0.01, mode: 'negative', atLeast: firstFolio ? 1 : 0 })
          firstFolio = false
          batch.B.push({ source: 'onboard', path: `onboard/${s.ship.code}/${s.dep.getUTCFullYear()}/folio_${s.code}.csv`, format: 'csv', rows: folio })
        }
      }
      for (const b of s.bookings) emitBooking(b)
    }

    // month end
    const isMonthEnd = dateKey(addDays(d, 1)) % 100 === 1 || dk === dateKey(today)
    if (live && isMonthEnd) {
      const ms = ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
      const me = minDate(endOfMonth(d), today)
      const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      // crew roster
      const crewBronze: BronzeRow[] = []
      for (const c of crews) {
        if (c.hire.getTime() > me.getTime()) continue
        const a = attrsAt(c, me)
        const departedOn = c.versions.find((v) => v.attrs.employment_status === 'Departed')?.from
        if (departedOn && departedOn.getTime() < ms.getTime()) continue
        batch.T.silver_crew_snapshots.push({ snapshot_date: me, crew_id: c.id, full_name: a.full_name, rank: a.rank, department: a.department, ship_code: a.ship_code, contract_type: a.contract_type, employment_status: a.employment_status, contract_start: c.hire })
        crewBronze.push({ crew_id: c.id, name: a.full_name as string, rank: a.rank as string, dept: a.department as string, ship: a.ship_code as string, contract: a.contract_type as string, status: a.employment_status as string, contract_start: c.hire })
      }
      const firstMonth = monthKey(ms) === monthKey(start)
      injectDateFormats(crewBronze, 'contract_start', { rng, sink: ctx, code: 'MW18', rate: 0.12, atLeast: firstMonth ? 1 : 0 })
      batch.B.push({ source: 'crew', path: `crew/crew_roster_${ym}.csv`, format: 'csv', rows: crewBronze })
      // payments
      if (batch.payRows.length) {
        injectDateFormats(batch.payRows, 'paid_on', { rng, sink: ctx, code: 'MW04', rate: 0.1, atLeast: firstPayFile ? 1 : 0 })
        injectFormattedNumbers(batch.payRows, 'amount', { rng, sink: ctx, code: 'MW05', rate: 0.15, currency: '₡', currencyCode: 'STC', atLeast: firstPayFile ? 1 : 0 })
        injectWhitespace(batch.payRows, 'booking_ref', { rng, sink: ctx, code: 'MW06', rate: 0.05, atLeast: firstPayFile ? 1 : 0 })
        firstPayFile = false
        batch.B.push({ source: 'payments', path: `payments/${d.getUTCFullYear()}/payments_${ym}.csv`, format: 'csv', rows: batch.payRows, columns: ['payment_id', 'booking_ref', 'paid_on', 'type', 'amount', 'method'] })
      }
      if (batch.sessionRows.length) {
        injectOutliers(batch.sessionRows, 'sessions', { rng, sink: ctx, code: 'MW11', rate: 0.003, mode: 'extreme', factor: 100, atLeast: firstSessionsFile ? 1 : 0 })
        firstSessionsFile = false
        batch.B.push({ source: 'web_sessions', path: `web/sessions/sessions_${ym}.csv`, format: 'csv', rows: batch.sessionRows })
      }
      if (firstMonth) {
        batch.B.push({ source: 'legacy', path: 'booking_api/legacy/legacy_bookings_export.csv', format: 'csv', rows: legacyBookings, csv: { delimiter: '|', quoteAll: true } })
        if (legacyPayments.length) batch.B.push({ source: 'payments', path: 'payments/legacy_payments.csv', format: 'csv', rows: legacyPayments, columns: ['payment_id', 'booking_ref', 'paid_on', 'type', 'amount', 'method'] })
      }
      yield { label: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, tables: batch.T, bronze: batch.B }
      batch = newBatch()
    }
  }

  // ---- closing: open bookings, households --------------------------------------------------
  for (const s of sailings) if (s.dep.getTime() > today.getTime()) for (const b of s.bookings) emitBooking(b)
  const tier = (n: number) => (n >= 5 ? ['Cosmos', 4] : n >= 3 ? ['Galaxy', 3] : n >= 2 ? ['Comet', 2] : ['Stardust', 1]) as [string, number]
  batch.T.gold_dim_household = [
    { household_key: -1, household_id: 'ANONYMOUS', lead_guest_name: 'Anonymous visitor', home_world: 'Unknown', segment: 'Unknown', loyalty_tier: 'Anonymous', tier_rank: 0, customer_since: null, email_opt_in: false },
    ...households.map((h) => ({ household_key: h.key, household_id: h.id, lead_guest_name: h.name, home_world: h.world, segment: h.segment, loyalty_tier: tier(h.sailings)[0], tier_rank: tier(h.sailings)[1], customer_since: h.since, email_opt_in: h.optIn }))
  ]
  batch.T.silver_households = households.map((h) => ({ household_id: h.id, lead_guest_name: h.name, home_world: h.world, segment: h.segment, loyalty_tier: tier(h.sailings)[0], customer_since: h.since, email: h.email, email_opt_in: h.optIn }))
  const rcrm = ctx.rng('crm')
  const crm: BronzeRow[] = households.map((h) => {
    let em: string | null = h.email
    if (em === null) {
      em = rcrm.pick(['', 'NULL', 'n/a', null] as Array<string | null>)
      ctx.issue('MW15')
    }
    return { household_id: h.id, lead_guest: h.name, home_world: h.world, segment: h.segment, tier: tier(h.sailings)[0], customer_since: h.since, email: em, opt_in: h.optIn }
  })
  injectDateFormats(crm, 'customer_since', { rng: rcrm, sink: ctx, code: 'MW16', rate: 0.2, formats: ['us', 'eu', 'epoch', 'long'], atLeast: 1 })
  batch.B.push({ source: 'crm', path: 'crm/households_export.ndjson', format: 'ndjson', rows: injectDuplicates(crm, { rng: rcrm, sink: ctx, code: 'MW14', rate: 0.01, atLeast: 1 }) })
  yield { label: 'closing', tables: batch.T, bronze: batch.B }
}
