/**
 * Pixel Pagoda Arcades — simulation.
 *
 * Day by day per cabinet: venue trading hours → expected real plays (game popularity × venue type ×
 * weekday × season × campaigns × growth, plus a viral launch) → mechanical wear → error events and a
 * wear-driven breakdown hazard (a firmware release multiplies both) → maintenance tickets with
 * response/repair/parts delays → downtime overlapping trading hours → sampled plays (thinned while the
 * cabinet is down) with credits, scores, high scores and tickets → wallet top-ups, prize redemptions,
 * membership billing and tournament entry fees.
 *
 * Volumes: `small` samples ~1-in-50 of real plays (top-ups and redemptions follow); cabinet-days,
 * wear, breakdowns and maintenance are not sampled, so uptime/MTBF are realistic. `large` is ×30.
 */
import type { Scalar } from '../../../../../src/core/model/data.ts'
import {
  addDays, addHours, annualCycle, dateKey, dateOnly, daysBetween, eachDay, endOfMonth, isoDow, isoDate, maxDate, minDate, monthKey, startOfMonth, timeKey, ymd
} from '../../calendar.ts'
import {
  formatDate, injectCasing, injectDateFormats, injectDuplicates, injectFormattedNumbers, injectWhitespace, landingDay
} from '../../chaos.ts'
import { clamp, round, weightedPicker } from '../../prng.ts'
import type { Rng } from '../../prng.ts'
import { Scd2Index, scd2Rows } from '../../scd2.ts'
import type { Scd2Version } from '../../scd2.ts'
import type { Batch, BronzeFile, BronzeRow, BronzeValue, GenContext, Row } from '../../schema.ts'
import { email, personName, placeNames } from '../../words.ts'

// ---------------------------------------------------------------------------------------------
// Reference data

type Genre = 'Shooter' | 'Fighter' | 'Racer' | 'Platformer' | 'Puzzle' | 'Rhythm' | 'Pinball' | 'Redemption'

interface GameDef {
  code: string
  title: string
  genre: Genre
  group: 'Video' | 'Pinball' | 'Redemption'
  maker: string
  year: number
  players: number
  credits: number
  pop: number
  dur: number
  score: number
  tickets: number
  launchFrac?: number
}

const KK = 'Kitsune Kabinets'
const BW = 'Bitwave Amusements'
const NL = 'Neon Lotus Interactive'
const RF = 'Retroforge Works'
const MB = 'Moonbolt Games'

const G = (n: number, title: string, genre: Genre, maker: string, year: number, players: number, credits: number, pop: number, dur: number, score: number, tickets: number, extra: Partial<GameDef> = {}): GameDef => ({
  code: `G-${String(n).padStart(3, '0')}`,
  title,
  genre,
  group: genre === 'Pinball' ? 'Pinball' : genre === 'Redemption' ? 'Redemption' : 'Video',
  maker,
  year,
  players,
  credits,
  pop,
  dur,
  score,
  tickets,
  ...extra
})

const GAMES: GameDef[] = [
  G(1, 'Galaxy Gobbler', 'Shooter', BW, 1981, 2, 2, 1.0, 150, 40_000, 3),
  G(2, 'Neon Nunchucks', 'Fighter', KK, 1993, 2, 2, 1.1, 110, 120_000, 2),
  G(3, 'Turbo Tortoise Rally', 'Racer', RF, 1996, 4, 3, 1.2, 200, 80_000, 4),
  G(4, 'Pagoda Panic', 'Platformer', NL, 1984, 1, 2, 0.9, 180, 25_000, 3),
  G(5, 'Star Herder', 'Puzzle', MB, 1989, 1, 2, 0.7, 240, 60_000, 2),
  G(6, 'Mecha Mahjong Mayhem', 'Puzzle', KK, 1998, 2, 2, 0.6, 260, 90_000, 2),
  G(7, 'Pixel Paladin', 'Platformer', BW, 1991, 2, 2, 0.9, 200, 50_000, 3),
  G(8, 'Laser Lotus', 'Shooter', NL, 1987, 2, 2, 0.9, 140, 300_000, 3),
  G(9, 'Sky Serpent', 'Shooter', MB, 1995, 2, 2, 0.8, 160, 500_000, 3),
  G(10, 'Dragon Drift GT', 'Racer', RF, 2019, 4, 4, 1.4, 210, 95_000, 5),
  G(11, 'Bubble Bureau', 'Puzzle', BW, 1994, 2, 2, 0.7, 230, 70_000, 2),
  G(12, 'Robo Ramen Rush', 'Rhythm', KK, 2016, 2, 3, 1.0, 180, 850_000, 4),
  G(13, 'Ghost Garden', 'Platformer', MB, 1983, 1, 2, 0.6, 170, 20_000, 2),
  G(14, 'Kaiju Kitchen', 'Fighter', NL, 0, 4, 3, 1.25, 180, 150_000, 4, { launchFrac: 0.45 }),
  G(15, 'Thunder Tanuki', 'Fighter', RF, 2003, 2, 3, 1.0, 120, 200_000, 2),
  G(16, 'Beat Bonsai DX', 'Rhythm', BW, 2009, 2, 3, 1.1, 200, 900_000, 4),
  G(17, 'Hyper Hopscotch', 'Rhythm', MB, 2012, 2, 3, 0.8, 150, 400_000, 3),
  G(18, 'Pagoda Pinball Deluxe', 'Pinball', KK, 1992, 4, 4, 1.0, 330, 25_000_000, 6),
  G(19, 'Ninja Comet Pinball', 'Pinball', RF, 1997, 4, 4, 0.9, 300, 18_000_000, 6),
  G(20, 'Haunted Harbor Pinball', 'Pinball', NL, 2014, 4, 4, 0.8, 310, 40_000_000, 6),
  G(21, 'Lucky Lantern Coin Pusher', 'Redemption', MB, 2010, 1, 1, 1.3, 60, 120, 25),
  G(22, 'Crane of Fortune', 'Redemption', BW, 2015, 1, 2, 1.2, 45, 1, 15),
  G(23, 'Skee-Comet Alley', 'Redemption', RF, 1985, 1, 2, 1.1, 75, 300, 20),
  G(24, 'Wheel of Wonton', 'Redemption', KK, 2018, 1, 1, 1.0, 40, 50, 30)
]
const BUGGY = 'G-010'
const VIRAL = 'G-014'

type VenueType = 'Flagship Pagoda' | 'Mall Arcade' | 'Bar-cade' | 'Pop-up'

const VENUE_TYPE: Record<VenueType, { open: number; close: number; capacity: number; cabinets: number; mult: number; closed: number[]; suffix: string; weights: number[] }> = {
  // weights per trading hour from `open`
  'Flagship Pagoda': { open: 10, close: 24, capacity: 12, cabinets: 9, mult: 1.3, closed: [], suffix: 'Grand Pagoda', weights: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 9, 6] },
  'Mall Arcade': { open: 10, close: 21, capacity: 9, cabinets: 7, mult: 1.0, closed: [], suffix: 'Mall Arcade', weights: [3, 5, 8, 9, 9, 10, 11, 10, 8, 6, 4] },
  'Bar-cade': { open: 16, close: 24, capacity: 8, cabinets: 6, mult: 0.9, closed: [], suffix: 'Bar-cade', weights: [2, 3, 6, 9, 11, 13, 13, 10] },
  'Pop-up': { open: 12, close: 20, capacity: 5, cabinets: 4, mult: 0.8, closed: [1, 2], suffix: 'Pop-up', weights: [5, 7, 8, 9, 9, 8, 7, 5] }
}

const REGIONS = [
  { name: 'Neon Coast', lat: 33.9, lon: -118.1 },
  { name: 'Lantern Valley', lat: 36.6, lon: -121.6 },
  { name: 'Pixel Peaks', lat: 39.6, lon: -105.1 }
]

const TIERS = [
  { key: 1, name: 'Pixel', fee: 0, bonus: 0, mult: 1, paid: false },
  { key: 2, name: 'Sprite', fee: 4.99, bonus: 0.05, mult: 1.05, paid: true },
  { key: 3, name: 'Boss', fee: 9.99, bonus: 0.1, mult: 1.1, paid: true },
  { key: 4, name: 'Legend', fee: 19.99, bonus: 0.2, mult: 1.25, paid: true }
]
const tierByName = new Map(TIERS.map((t) => [t.name, t]))

interface PrizeDef {
  code: string
  name: string
  category: string
  tickets: number
  cost: number
}

const PZ = (n: string, name: string, category: string, tickets: number, cost: number): PrizeDef => ({ code: `PRZ-${n}`, name, category, tickets, cost: Math.round(cost * 150) / 100 })
const PRIZES: PrizeDef[] = [
  PZ('001', 'Pixel Gum Drops', 'Candy', 10, 0.05),
  PZ('002', 'Lantern Lollipop', 'Candy', 15, 0.08),
  PZ('003', 'Space Candy Tube', 'Candy', 30, 0.2),
  PZ('004', 'Bouncy Comet Ball', 'Toys', 20, 0.1),
  PZ('005', 'Glow Bracelet', 'Toys', 25, 0.12),
  PZ('006', 'Pagoda Sticker Pack', 'Toys', 40, 0.15),
  PZ('007', '8-Bit Eraser Set', 'Toys', 60, 0.25),
  PZ('008', 'Mini Kaiju Figure', 'Toys', 150, 0.9),
  PZ('009', 'Pagoda Keychain', 'Toys', 200, 1.1),
  PZ('010', 'Tanuki Plush (S)', 'Plush', 400, 2.4),
  PZ('011', 'Dragon Plush (M)', 'Plush', 900, 5.2),
  PZ('012', 'Mega Tanuki Plush', 'Plush', 2500, 14),
  PZ('013', 'Pixel Pagoda Cap', 'Apparel', 1200, 6.5),
  PZ('014', 'Retro Night Tee', 'Apparel', 1800, 7.8),
  PZ('015', 'Kaiju Kitchen Hoodie', 'Apparel', 4500, 18.5),
  PZ('016', 'LED Desk Lantern', 'Gadgets', 3000, 12),
  PZ('017', 'Pocket Pixel Handheld', 'Gadgets', 8000, 32),
  PZ('018', 'Neon Sign Kit', 'Gadgets', 12000, 48)
]
const RETIRED_PRIZES: PrizeDef[] = [PZ('R01', 'Retro Yo-Yo', 'Toys', 80, 0.4), PZ('R02', 'Lunar Pencil Topper', 'Toys', 12, 0.06), PZ('R03', 'Mini Arcade Magnet', 'Toys', 120, 0.6)]

const FAULTS = [
  { code: 'F01', name: 'Coin / card reader jam', category: 'Mechanical', severity: 'Low', hours: 1.0 },
  { code: 'F02', name: 'Joystick failure', category: 'Mechanical', severity: 'Medium', hours: 2.0 },
  { code: 'F03', name: 'Worn buttons', category: 'Mechanical', severity: 'Low', hours: 1.0 },
  { code: 'F04', name: 'Display fault', category: 'Display', severity: 'High', hours: 4.0 },
  { code: 'F05', name: 'Power supply failure', category: 'Electrical', severity: 'High', hours: 3.0 },
  { code: 'F06', name: 'Firmware crash loop', category: 'Software', severity: 'High', hours: 2.0 },
  { code: 'F07', name: 'Ticket dispenser jam', category: 'Redemption', severity: 'Medium', hours: 1.0 },
  { code: 'F08', name: 'Flipper coil burnout', category: 'Pinball', severity: 'Medium', hours: 2.5 },
  { code: 'F09', name: 'Overheating', category: 'Electrical', severity: 'Medium', hours: 2.0 },
  { code: 'F10', name: 'Sensor misalignment', category: 'Mechanical', severity: 'Low', hours: 1.5 },
  { code: 'F11', name: 'Telemetry link lost', category: 'Software', severity: 'Low', hours: 1.0 },
  { code: 'PM1', name: 'Preventive maintenance', category: 'Preventive', severity: 'Low', hours: 1.5 }
]
const faultIndex = new Map(FAULTS.map((f, i) => [f.code, i]))

const PAYMENT_METHODS = ['Card', 'Cash', 'Mobile Wallet', 'Gift Card']
const CHANNELS = ['Kiosk', 'Counter', 'App']
const ERROR_CODES = ['E-TEMP', 'E-IO', 'E-WATCHDOG', 'E-COIN', 'E-DISP']
const GAMER_A = ['Neon', 'Turbo', 'Pixel', 'Lunar', 'Hyper', 'Cosmic', 'Retro', 'Glitch', 'Mega', 'Shadow', 'Laser', 'Ramen']
const GAMER_B = ['Tanuki', 'Dragon', 'Kaiju', 'Ninja', 'Comet', 'Lotus', 'Wizard', 'Bandit', 'Panda', 'Phoenix', 'Gecko', 'Yeti']

// ---------------------------------------------------------------------------------------------
// Runtime entities

interface Venue {
  key: number
  code: string
  name: string
  type: VenueType
  city: string
  region: string
  lat: number
  lon: number
  opened: Date
}

interface MachineEvent {
  at: Date
  type: 'Installed' | 'Moved' | 'Firmware' | 'Retired'
  venue?: Venue
  fw?: string
}

interface Machine {
  id: string
  serial: string
  game: GameDef
  purchase: Date
  cost: number
  events: MachineEvent[]
  versions: Scd2Version[]
  vi: number
  wear: number
  nextPm: Date
  down: { ticket: Ticket; until: Date } | null
}

interface Ticket {
  id: string
  machine: Machine
  sk: number
  venueKey: number
  fault: number
  type: 'Breakdown' | 'Preventive'
  priority: string
  technician: string | null
  techBronze: string
  openedAt: Date
  assignedAt: Date
  resolvedAt: Date
  downtime: number
  parts: number
  labor: number
}

interface Member {
  key: number
  id: string
  tag: string
  home: number
  join: Date
  cancel: Date | null
  weight: number
  skill: number
  ageBand: string
  email: string | null
  optIn: boolean
  /** tier timeline: [from, tierName] sorted */
  tiers: Array<{ from: Date; tier: string }>
  tickets: number
}

interface Campaign {
  key: number
  code: string
  name: string
  type: string
  channel: string
  target: string
  theme: string
  start: Date
  end: Date
  budget: number
  priority: number
}

const money = (v: number) => round(v, 2)
const toSecond = (ms: number) => new Date(Math.floor(ms / 1000) * 1000)
const pad = (n: number, w = 2) => String(n).padStart(w, '0')

function tierAt(m: Member, d: Date): string {
  let t = m.tiers[0].tier
  for (const x of m.tiers) if (x.from.getTime() <= d.getTime()) t = x.tier
  return t
}

function overlapHours(a0: Date, a1: Date, b0: Date, b1: Date): number {
  const s = Math.max(a0.getTime(), b0.getTime())
  const e = Math.min(a1.getTime(), b1.getTime())
  return e > s ? (e - s) / 3_600_000 : 0
}

// ---------------------------------------------------------------------------------------------

export function* generatePixelPagoda(ctx: GenContext): Generator<Batch> {
  const today = ctx.today
  const start = ctx.start
  const span = daysBetween(start, today)
  const VOLUME = ctx.scale.factor / 50
  const BASE_REAL = 42
  const todayEnd = addDays(today, 1)
  const launchDate = addDays(start, Math.floor(span * (GAMES.find((g) => g.code === VIRAL)!.launchFrac ?? 0.45)))
  const bugDate = addDays(start, Math.floor(span * 0.3))
  const fixDate = addDays(bugDate, 90)
  const priceDate = addDays(start, Math.floor(span * 0.4))
  const driftDate = addDays(start, Math.floor(span * 0.62))
  const prizeRetireDate = addDays(start, Math.floor(span * 0.7))
  const gameLaunch = new Map<string, Date>()
  const rg = ctx.rng('games')
  for (const g of GAMES) gameLaunch.set(g.code, g.launchFrac !== undefined ? launchDate : addDays(start, -rg.int(200, 3000)))
  const gameYear = (g: GameDef) => (g.year || launchDate.getUTCFullYear())
  const era = (y: number) => (y < 1987 ? 'Golden Age' : y < 2000 ? '16-bit' : y < 2020 ? 'Modern Retro' : 'New Release')
  const gameKey = new Map(GAMES.map((g, i) => [g.code, i + 1]))

  // ---- venues ------------------------------------------------------------------------------
  const rv = ctx.rng('venues')
  const types: VenueType[] = ctx.tiny ? ['Flagship Pagoda', 'Bar-cade'] : ['Flagship Pagoda', 'Mall Arcade', 'Bar-cade', 'Mall Arcade', 'Pop-up', 'Flagship Pagoda', 'Bar-cade']
  const cities = placeNames(rv, types.length)
  const venues: Venue[] = types.map((type, i) => {
    const region = REGIONS[i % REGIONS.length]
    const opened = !ctx.tiny && i === 4 ? addDays(start, Math.floor(span * 0.35)) : addDays(start, -rv.int(300, 3000))
    return {
      key: i + 1,
      code: `PP-V${pad(i + 1)}`,
      name: `Pixel Pagoda ${cities[i]} ${VENUE_TYPE[type].suffix}`,
      type,
      city: cities[i],
      region: region.name,
      lat: round(region.lat + rv.normal(0, 0.5), 4),
      lon: round(region.lon + rv.normal(0, 0.6), 4),
      opened: dateOnly(opened)
    }
  })
  const venueByCode = new Map(venues.map((v) => [v.code, v]))
  const venueOpenOn = (v: Venue, d: Date) => d.getTime() >= v.opened.getTime() && !VENUE_TYPE[v.type].closed.includes(isoDow(d))

  // ---- cabinets (SCD2) ----------------------------------------------------------------------
  const rm = ctx.rng('machines')
  const machines: Machine[] = []
  const newMachine = (game: GameDef, venue: Venue, purchase: Date): Machine => {
    const id = `CAB-${pad(machines.length + 1, 4)}`
    const m: Machine = {
      id,
      serial: `${game.maker.split(' ')[0].slice(0, 3).toUpperCase()}-${rm.chars(6, '0123456789ABCDEF')}`,
      game,
      purchase: dateOnly(purchase),
      cost: round(game.group === 'Pinball' ? rm.float(6500, 9500) : game.group === 'Redemption' ? rm.float(3500, 7000) : game.year >= 2010 || !game.year ? rm.float(8000, 14000) : rm.float(1800, 4200), 0),
      events: [{ at: dateOnly(purchase), type: 'Installed', venue, fw: `${rm.int(1, 2)}.${rm.int(0, 9)}` }],
      versions: [],
      vi: 0,
      wear: rm.float(5, 60),
      nextPm: addDays(maxDate(purchase, start), rm.int(10, 120)),
      down: null
    }
    machines.push(m)
    return m
  }
  const pickGames = (v: Venue, n: number): GameDef[] => {
    const allowed = GAMES.filter((g) => g.launchFrac === undefined).filter((g) => (v.type === 'Bar-cade' ? g.group !== 'Redemption' : v.type === 'Pop-up' ? g.group === 'Video' : true))
    const chosen: GameDef[] = []
    if (v.type === 'Flagship Pagoda' || v.type === 'Mall Arcade') chosen.push(GAMES.find((g) => g.code === BUGGY)!)
    const pool = allowed.filter((g) => !chosen.includes(g))
    const weights = pool.map((g) => g.pop * (v.type === 'Mall Arcade' && g.group === 'Redemption' ? 2.5 : 1))
    while (chosen.length < n && pool.length) {
      const g = rm.weighted(pool, weights)
      const i = pool.indexOf(g)
      pool.splice(i, 1)
      weights.splice(i, 1)
      chosen.push(g)
    }
    return chosen
  }
  for (const v of venues) {
    const n = ctx.tiny ? (v.type === 'Flagship Pagoda' ? 4 : 3) : VENUE_TYPE[v.type].cabinets
    const purchase = (v.opened.getTime() > start.getTime() ? v.opened : addDays(start, -rm.int(60, 1500)))
    for (const g of pickGames(v, n)) newMachine(g, v, maxDate(purchase, v.opened))
  }
  // viral launch: a Kaiju Kitchen cabinet in every flagship and mall arcade
  for (const v of venues) if (v.type === 'Flagship Pagoda' || v.type === 'Mall Arcade') newMachine(GAMES.find((g) => g.code === VIRAL)!, v, launchDate)
  // firmware, moves, retirements (+ replacements)
  const initialCount = machines.length
  for (let i = 0; i < initialCount; i++) {
    const m = machines[i]
    const first = m.events[0]
    const fwMajor = Number(first.fw!.split('.')[0])
    let fwMinor = Number(first.fw!.split('.')[1])
    if (m.game.code === BUGGY) {
      m.events[0].fw = '2.2'
      if (bugDate.getTime() > m.purchase.getTime()) m.events.push({ at: bugDate, type: 'Firmware', fw: '2.3' })
      if (fixDate.getTime() > m.purchase.getTime() && fixDate.getTime() <= today.getTime()) m.events.push({ at: fixDate, type: 'Firmware', fw: '2.4' })
    } else {
      for (let y = start.getUTCFullYear(); y <= today.getUTCFullYear(); y++) {
        if (!rm.chance(0.55)) continue
        const at = ymd(y, rm.int(1, 12), rm.int(1, 28))
        if (at.getTime() <= m.purchase.getTime() || at.getTime() > today.getTime()) continue
        fwMinor++
        m.events.push({ at, type: 'Firmware', fw: `${fwMajor}.${fwMinor}` })
      }
    }
    if (!ctx.tiny && m.game.code !== BUGGY && rm.chance(0.12)) {
      const at = addDays(maxDate(start, m.purchase), rm.int(30, Math.max(31, daysBetween(maxDate(start, m.purchase), today) - 30)))
      const curVenue = first.venue!
      const dest = venues.filter((v) => v !== curVenue && v.opened.getTime() < at.getTime() && (v.type !== 'Pop-up' || m.game.group === 'Video'))
      if (dest.length) m.events.push({ at, type: 'Moved', venue: rm.pick(dest) })
    }
    if (!ctx.tiny && gameYear(m.game) < 1990 && m.game.group === 'Video' && rm.chance(0.3)) {
      const from = maxDate(addDays(start, 60), addDays(m.purchase, 60))
      const room = daysBetween(from, today) - 20
      if (room <= 0) continue
      const at = addDays(from, rm.int(0, room))
      m.events.push({ at, type: 'Retired' })
      m.events.sort((a, b) => a.at.getTime() - b.at.getTime())
      const venueAt = [...m.events].filter((e) => e.venue && e.at.getTime() <= at.getTime()).pop()!.venue!
      const present = new Set(machines.filter((x) => x.events.some((e) => e.venue === venueAt)).map((x) => x.game.code))
      const choices = GAMES.filter((g) => g.launchFrac === undefined && !present.has(g.code) && g.group === 'Video')
      if (choices.length) newMachine(rm.pick(choices), venueAt, addDays(at, rm.int(3, 10)))
    }
  }
  for (const m of machines) {
    m.events.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.type === 'Installed' ? -1 : 1))
    // drop events after a retirement
    const ri = m.events.findIndex((e) => e.type === 'Retired')
    if (ri >= 0) m.events = m.events.slice(0, ri + 1)
    let attrs: Record<string, Scalar> = {}
    for (const e of m.events) {
      if (e.type === 'Installed') {
        attrs = {
          serial_number: m.serial, game_code: m.game.code, game_title: m.game.title, venue_code: e.venue!.code, venue_name: e.venue!.name,
          firmware_version: e.fw!, cabinet_status: 'Active', purchase_date: m.purchase, purchase_cost: m.cost
        }
      } else if (e.type === 'Moved') attrs = { ...attrs, venue_code: e.venue!.code, venue_name: e.venue!.name }
      else if (e.type === 'Firmware') attrs = { ...attrs, firmware_version: e.fw! }
      else attrs = { ...attrs, cabinet_status: 'Retired' }
      m.versions.push({ from: dateOnly(e.at), attrs })
    }
  }
  const machineRows = scd2Rows(machines.map((m) => ({ businessKey: m.id, versions: m.versions })), { skColumn: 'machine_sk', bkColumn: 'machine_id' })
  const machineIndex = new Scd2Index(machineRows, 'machine_sk', 'machine_id')

  // ---- members & tiers ----------------------------------------------------------------------
  const rmb = ctx.rng('members')
  const nMembers = ctx.n(220, 25)
  const members: Member[] = []
  for (let i = 0; i < nMembers; i++) {
    const n = personName(rmb)
    const join = dateOnly(rmb.chance(0.25) ? addDays(start, -rmb.int(20, 700)) : addDays(start, Math.floor(span * Math.pow(rmb.next(), 0.85))))
    const home = rmb.int(0, venues.length - 1)
    const m: Member = {
      key: i + 1,
      id: `PX-${pad(i + 1, 5)}`,
      tag: `${rmb.pick(GAMER_A)}${rmb.pick(GAMER_B)}${rmb.int(1, 99)}`,
      home,
      join: maxDate(join, venues[home].opened),
      cancel: null,
      weight: rmb.logNormal(1, 0.9),
      skill: rmb.normalClamped(1, 0.25, 0.4, 1.8),
      ageBand: rmb.weighted(['13-17', '18-24', '25-34', '35-44', '45+'], [0.12, 0.3, 0.32, 0.17, 0.09]),
      email: rmb.chance(0.86) ? email(n.first, n.last, 'mail.example', rmb) : null,
      optIn: rmb.chance(0.55),
      tiers: [],
      tickets: 0
    }
    let tier = rmb.weighted(['Pixel', 'Sprite', 'Boss', 'Legend'], [0.7, 0.17, 0.09, 0.04])
    m.tiers.push({ from: m.join, tier })
    // monthly membership transitions
    for (let d = addDays(m.join, 30); d.getTime() <= today.getTime(); d = addDays(d, 30)) {
      const paid = tierByName.get(tier)!.paid
      const r = rmb.next()
      if (paid && r < 0.035) {
        if (rmb.chance(0.55)) {
          tier = 'Pixel'
          m.tiers.push({ from: d, tier })
        } else {
          m.cancel = d
          break
        }
      } else if (paid && r < 0.055 && tier !== 'Legend') {
        tier = tier === 'Sprite' ? 'Boss' : 'Legend'
        m.tiers.push({ from: d, tier })
      } else if (!paid && r < 0.012) {
        tier = rmb.weighted(['Sprite', 'Boss'], [0.7, 0.3])
        m.tiers.push({ from: d, tier })
      } else if (!paid && r < 0.027) {
        m.cancel = d
        break
      }
    }
    members.push(m)
  }
  const membersByVenue: Member[][] = venues.map(() => [])
  for (const m of members) membersByVenue[m.home].push(m)
  const maxWeight = Math.max(1, ...members.map((m) => m.weight))
  const memberActive = (m: Member, d: Date) => m.join.getTime() <= d.getTime() && (!m.cancel || d.getTime() < m.cancel.getTime())

  // ---- campaigns ----------------------------------------------------------------------------
  const rc = ctx.rng('campaigns')
  const campaigns: Campaign[] = []
  const addCampaign = (name: string, type: string, channel: string, theme: string, s: Date, e: Date, budget: number, priority: number) => {
    if (s.getTime() > today.getTime()) return
    campaigns.push({ key: campaigns.length + 1, code: `CMP-${s.getUTCFullYear()}-${pad(campaigns.length + 1, 3)}`, name, type, channel, target: 'All venues', theme, start: s, end: e, budget, priority })
  }
  const friday = (y: number, m: number, day: number) => {
    let d = ymd(y, m, day)
    while (isoDow(d) !== 5) d = addDays(d, 1)
    return d
  }
  for (let y = start.getUTCFullYear(); y <= today.getUTCFullYear(); y++) {
    addCampaign(`Retro Night Thursdays — Spring ${y}`, 'Retro Night', 'In-venue', 'Golden Age', ymd(y, 2, 1), ymd(y, 4, 30), 2500, 1)
    const lf = friday(y, 2, 10)
    addCampaign(`Lantern Festival Weekend ${y}`, 'Themed Weekend', 'Social', 'Puzzle', lf, addDays(lf, 2), 4000 + rc.int(0, 1500), 3)
    addCampaign(`Summer Neon Nights ${y}`, 'Seasonal', 'Influencer', 'Racer', ymd(y, 7, 1), ymd(y, 8, 15), 8000 + rc.int(0, 2000), 2)
    addCampaign(`Retro Night Thursdays — Autumn ${y}`, 'Retro Night', 'In-venue', 'Golden Age', ymd(y, 9, 1), ymd(y, 11, 30), 2500, 1)
    const sp = friday(y, 10, 24)
    addCampaign(`Spooky 8-Bit Weekend ${y}`, 'Themed Weekend', 'Social', 'Platformer', sp, addDays(sp, 2), 3500 + rc.int(0, 1000), 3)
    addCampaign(`Winter Pixel Fest ${y}`, 'Seasonal', 'Email', 'Rhythm', ymd(y, 12, 18), ymd(y, 12, 31), 6000 + rc.int(0, 1500), 2)
  }
  addCampaign('Kaiju Kitchen Launch Party', 'Launch', 'Influencer', 'Fighter', launchDate, addDays(launchDate, 13), 12000, 4)
  campaigns.sort((a, b) => a.start.getTime() - b.start.getTime())
  campaigns.forEach((cp, i) => {
    cp.key = i + 1
    cp.code = `CMP-${cp.start.getUTCFullYear()}-${pad(i + 1, 3)}`
  })

  // ---- tournaments (scheduled up front; depend only on members) ----------------------------
  const rt = ctx.rng('tournaments')
  interface Tournament {
    key: number
    code: string
    name: string
    format: string
    venue: Venue
    date: Date
    fee: number
    pool: number
    max: number
    games: GameDef[]
    entries: Array<{ id: string; playerId: string; member: Member | null; registered: Date; seed: number; placement: number }>
  }
  const tournaments: Tournament[] = []
  const tGenres: Genre[] = ['Fighter', 'Racer', 'Rhythm', 'Puzzle', 'Pinball', 'Shooter']
  for (let ms = startOfMonth(start); ms.getTime() <= today.getTime(); ms = ymd(ms.getUTCFullYear(), ms.getUTCMonth() + 2, 1)) {
    for (const v of venues) {
      const hosts = v.type === 'Flagship Pagoda' || (v.type === 'Bar-cade' && ms.getUTCMonth() % 2 === 0 && !ctx.tiny)
      if (!hosts) continue
      let date = ymd(ms.getUTCFullYear(), ms.getUTCMonth() + 1, rt.int(8, 21))
      while (isoDow(date) !== 6) date = addDays(date, 1)
      if (date.getTime() > today.getTime() || date.getTime() < v.opened.getTime() || date.getTime() < start.getTime()) continue
      const avail = GAMES.filter((g) => tGenres.includes(g.genre) && gameLaunch.get(g.code)!.getTime() <= date.getTime())
      const nGames = rt.weighted([1, 2, 3], [0.5, 0.35, 0.15])
      const games = rt.sample(avail, nGames)
      const max = ctx.tiny ? 8 : rt.weighted([8, 16, 32], [0.35, 0.45, 0.2])
      const fee = rt.weighted([0, 5, 10, 15], [0.2, 0.35, 0.3, 0.15])
      const fmt = rt.weighted(['Single Elimination', 'Double Elimination', 'Round Robin', 'Swiss'], [0.45, 0.3, 0.1, 0.15])
      const word = rt.pick(['Showdown', 'Open', 'Clash', 'Cup', 'Invitational'])
      const t: Tournament = {
        key: tournaments.length + 1,
        code: `TRN-${dateKey(date)}-${v.code.slice(-2)}`,
        name: `${games[0].title} ${word} — ${isoDate(date).slice(0, 7)}`,
        format: fmt,
        venue: v,
        date,
        fee,
        pool: 0,
        max,
        games,
        entries: []
      }
      const eligible = members.filter((m) => memberActive(m, addDays(date, -1)))
      const target = Math.min(max, Math.max(2, Math.round(max * rt.float(0.5, 1))))
      const chosen: Member[] = []
      const pool = [...eligible]
      while (chosen.length < Math.round(target * 0.85) && pool.length) {
        const w = pool.map((m) => m.weight * m.skill * (m.home === venues.indexOf(v) ? 3 : 1))
        const m = rt.weighted(pool, w)
        pool.splice(pool.indexOf(m), 1)
        chosen.push(m)
      }
      const players: Array<{ playerId: string; member: Member | null; skill: number }> = chosen.map((m) => ({ playerId: m.id, member: m, skill: m.skill }))
      while (players.length < target) players.push({ playerId: `WALKIN-${rt.chars(5)}`, member: null, skill: rt.normalClamped(0.9, 0.3, 0.3, 1.6) })
      const ranked = players.map((p) => ({ p, perf: p.skill * rt.logNormal(1, 0.3) })).sort((a, b) => b.perf - a.perf)
      const seeds = rt.shuffle(players.map((_, i) => i + 1))
      ranked.forEach((r, i) => {
        const earliest = maxDate(start, r.p.member ? r.p.member.join : addDays(date, -1))
        const reg = maxDate(earliest, addDays(date, -rt.int(0, 21)))
        t.entries.push({ id: `${t.code}-E${pad(i + 1)}`, playerId: r.p.playerId, member: r.p.member, registered: minDate(reg, date), seed: seeds[i], placement: i + 1 })
      })
      t.pool = money(fee * t.entries.length * 0.7 + rt.int(0, 4) * 50)
      tournaments.push(t)
    }
  }

  // ---- static batch --------------------------------------------------------------------------
  const tbl: Record<string, Row[]> = {}
  const sb: BronzeFile[] = []
  const rs = ctx.rng('static-bronze')
  tbl.gold_dim_venue = venues.map((v) => {
    const t = VENUE_TYPE[v.type]
    return {
      venue_key: v.key, venue_code: v.code, venue_name: v.name, venue_type: v.type, city: v.city, region: v.region, latitude: v.lat, longitude: v.lon,
      opened_date: v.opened, open_hour: t.open, close_hour: t.close, open_hours_per_day: t.close - t.open, closed_weekdays: t.closed.length ? 'Mon, Tue' : null,
      machine_capacity: t.capacity, is_21_plus: v.type === 'Bar-cade'
    }
  })
  tbl.silver_venues = tbl.gold_dim_venue.map((r) => ({
    venue_code: r.venue_code, venue_name: r.venue_name, venue_type: r.venue_type, city: r.city, region: r.region, latitude: r.latitude, longitude: r.longitude,
    opened_date: r.opened_date, open_hour: r.open_hour, close_hour: r.close_hour, closed_weekdays: r.closed_weekdays, machine_capacity: r.machine_capacity
  }))
  sb.push({ source: 'venues', path: 'venues/venues.json', format: 'json', rows: tbl.silver_venues.map((r) => ({ ...r }) as BronzeRow), json: { envelope: { service: 'venue-ops', version: 2 }, dataKey: 'venues' } })
  tbl.gold_dim_game = GAMES.map((g) => ({
    game_key: gameKey.get(g.code)!, game_code: g.code, title: g.title, genre: g.genre, genre_group: g.group, manufacturer: g.maker, release_year: gameYear(g),
    era: era(gameYear(g)), max_players: g.players, credits_per_play: g.credits, chain_launch_date: gameLaunch.get(g.code)!
  }))
  tbl.silver_games = tbl.gold_dim_game.map((r) => {
    const { game_key: _k, era: _e, ...rest } = r
    void _k
    void _e
    return rest
  })
  sb.push({ source: 'games', path: 'catalogue/games.csv', format: 'csv', rows: tbl.silver_games.map((r) => ({ ...r }) as BronzeRow) })
  tbl.gold_dim_machine = machineRows
  tbl.silver_cabinets = machines.map((m) => {
    const a = m.versions[m.versions.length - 1].attrs
    return { machine_id: m.id, serial_number: m.serial, game_code: m.game.code, venue_code: a.venue_code, firmware_version: a.firmware_version, cabinet_status: a.cabinet_status, purchase_date: m.purchase, purchase_cost: m.cost }
  })
  const registerRows: BronzeRow[] = tbl.silver_cabinets.map((r) => ({ ...r }) as BronzeRow)
  injectWhitespace(registerRows, 'serial_number', { rng: rs, sink: ctx, code: 'PP16', rate: 0.15, atLeast: 1 })
  sb.push({ source: 'assets', path: 'assets/cabinet_register.csv', format: 'csv', rows: registerRows })
  tbl.silver_cabinet_history = []
  for (const m of machines) {
    const seqByDay = new Map<number, number>()
    let venueCode = ''
    let fw = ''
    for (const e of m.events) {
      if (e.venue) venueCode = e.venue.code
      if (e.fw) fw = e.fw
      const k = dateKey(e.at)
      const seq = (seqByDay.get(k) ?? 0) + 1
      seqByDay.set(k, seq)
      tbl.silver_cabinet_history.push({ machine_id: m.id, effective_date: dateOnly(e.at), change_seq: seq, change_type: e.type, venue_code: venueCode, firmware_version: fw })
    }
  }
  const historyRows: BronzeRow[] = tbl.silver_cabinet_history.map((r) => ({ ...r }) as BronzeRow)
  injectDateFormats(historyRows, 'effective_date', { rng: rs, sink: ctx, code: 'PP13', rate: 0.2, atLeast: 1 })
  sb.push({ source: 'assets', path: 'assets/cabinet_history.csv', format: 'csv', rows: historyRows })

  tbl.gold_dim_member = [
    { member_key: -1, member_id: 'GUEST', gamer_tag: 'Guest', is_guest: true, current_tier: 'Guest', tier_rank: 0, membership_status: 'n/a', join_date: null, cancel_date: null, home_venue_code: null, age_band: 'Unknown', email_opt_in: false },
    ...members.map((m) => {
      const t = tierAt(m, today)
      return {
        member_key: m.key, member_id: m.id, gamer_tag: m.tag, is_guest: false, current_tier: t, tier_rank: tierByName.get(t)!.key, membership_status: m.cancel ? 'Cancelled' : 'Active',
        join_date: m.join, cancel_date: m.cancel, home_venue_code: venues[m.home].code, age_band: m.ageBand, email_opt_in: m.optIn
      }
    })
  ]
  tbl.gold_dim_tier = [
    { tier_key: -1, tier_name: 'Guest', tier_rank: 0, monthly_fee: 0, bonus_credit_pct: 0, ticket_multiplier: 1, is_paid: false },
    ...TIERS.map((t) => ({ tier_key: t.key, tier_name: t.name, tier_rank: t.key, monthly_fee: t.fee, bonus_credit_pct: t.bonus, ticket_multiplier: t.mult, is_paid: t.paid }))
  ]
  tbl.gold_dim_campaign = [
    { campaign_key: -1, campaign_code: 'NONE', campaign_name: 'No Campaign', campaign_type: 'None', channel: 'n/a', target_venue: 'n/a', theme_genre: 'n/a', start_date: null, end_date: null, budget_usd: 0 },
    ...campaigns.map((cp) => ({ campaign_key: cp.key, campaign_code: cp.code, campaign_name: cp.name, campaign_type: cp.type, channel: cp.channel, target_venue: cp.target, theme_genre: cp.theme, start_date: cp.start, end_date: cp.end, budget_usd: cp.budget }))
  ]
  tbl.silver_campaigns = campaigns.map((cp) => ({ campaign_code: cp.code, campaign_name: cp.name, campaign_type: cp.type, channel: cp.channel, target_venue: cp.target, theme_genre: cp.theme, start_date: cp.start, end_date: cp.end, budget_usd: cp.budget }))
  sb.push({ source: 'marketing', path: 'marketing/campaigns.csv', format: 'csv', csv: { delimiter: ';', bom: true, lineEnding: '\r\n' }, rows: tbl.silver_campaigns.map((r) => ({ ...r }) as BronzeRow) })
  tbl.gold_dim_tournament = [
    { tournament_key: -1, tournament_code: 'NONE', tournament_name: 'No Tournament', bracket_format: 'n/a', venue_code: null, venue_name: null, tournament_date: null, entry_fee: 0, prize_pool: 0, max_entrants: 0, entrants: 0 },
    ...tournaments.map((t) => ({
      tournament_key: t.key, tournament_code: t.code, tournament_name: t.name, bracket_format: t.format, venue_code: t.venue.code, venue_name: t.venue.name, tournament_date: t.date,
      entry_fee: t.fee, prize_pool: t.pool, max_entrants: t.max, entrants: t.entries.length
    }))
  ]
  tbl.silver_tournaments = tournaments.map((t) => ({ tournament_code: t.code, tournament_name: t.name, bracket_format: t.format, venue_code: t.venue.code, tournament_date: t.date, entry_fee: t.fee, prize_pool: t.pool, max_entrants: t.max }))
  tbl.gold_bridge_tournament_game = []
  tbl.silver_tournament_games = []
  for (const t of tournaments) {
    t.games.forEach((g, i) => {
      tbl.gold_bridge_tournament_game.push({ tournament_key: t.key, game_key: gameKey.get(g.code)!, is_final_game: i === 0 })
      tbl.silver_tournament_games.push({ tournament_code: t.code, game_code: g.code, is_final_game: i === 0 })
    })
  }
  sb.push({
    source: 'esports',
    path: 'esports/tournaments.json',
    format: 'json',
    rows: tournaments.map((t) => ({ code: t.code, name: t.name, format: t.format, venue: t.venue.code, date: t.date, entryFee: t.fee, prizePool: t.pool, bracketSize: t.max, games: t.games.map((g) => g.code) })),
    json: { envelope: { api: 'bracketbox/v1/events', organizer: 'Pixel Pagoda Esports' }, dataKey: 'events' }
  })
  const prizeKey = new Map(PRIZES.map((p, i) => [p.code, i + 1]))
  tbl.gold_dim_prize = [
    { prize_key: -1, prize_code: 'UNKNOWN', prize_name: 'Retired / Unknown Prize', prize_category: 'Unknown', ticket_cost: 0, unit_cost: 0 },
    ...PRIZES.map((p) => ({ prize_key: prizeKey.get(p.code)!, prize_code: p.code, prize_name: p.name, prize_category: p.category, ticket_cost: p.tickets, unit_cost: p.cost }))
  ]
  tbl.silver_prizes = PRIZES.map((p) => ({ prize_code: p.code, prize_name: p.name, prize_category: p.category, ticket_cost: p.tickets, unit_cost: p.cost }))
  const prizeRows: BronzeRow[] = PRIZES.map((p) => ({
    'Prize Code': p.code, 'Prize Name': p.name, Category: p.category, 'Ticket Cost': p.tickets >= 1000 ? p.tickets.toLocaleString('en-US') : p.tickets, 'Unit Cost': p.cost
  }))
  injectWhitespace(prizeRows, 'Prize Name', { rng: rs, sink: ctx, code: 'PP08', rate: 0.25, atLeast: 1 })
  sb.push({ source: 'prize_catalogue', path: 'catalogue/prize_catalogue.xlsx', format: 'xlsx', rows: prizeRows, xlsx: { sheet: 'Prizes', titleLines: ['Pixel Pagoda — Prize Counter Catalogue'] } })
  tbl.gold_dim_payment = [{ payment_key: -1, payment_method: 'n/a', sales_channel: 'n/a', is_digital: false }]
  PAYMENT_METHODS.forEach((pm, mi) => CHANNELS.forEach((ch, ci) => tbl.gold_dim_payment.push({ payment_key: mi * CHANNELS.length + ci + 1, payment_method: pm, sales_channel: ch, is_digital: ch === 'App' })))
  const paymentKey = (pm: string, ch: string) => PAYMENT_METHODS.indexOf(pm) * CHANNELS.length + CHANNELS.indexOf(ch) + 1
  tbl.gold_dim_fault = FAULTS.map((f, i) => ({ fault_key: i + 1, fault_code: f.code, fault_name: f.name, fault_category: f.category, severity: f.severity, typical_repair_hours: f.hours }))
  yield { label: 'static', tables: tbl, bronze: sb }

  // ---- simulation -----------------------------------------------------------------------------
  const rng = ctx.rng('sim')
  const techs = Array.from({ length: ctx.tiny ? 2 : 6 }, () => personName(rng).full)
  const records = new Map<string, number>()
  const pendingEvents = new Map<number, BronzeRow[]>()
  const entriesByMonth = new Map<number, Tournament[]>()
  for (const t of tournaments) {
    const k = monthKey(t.date)
    const list = entriesByMonth.get(k) ?? []
    list.push(t)
    entriesByMonth.set(k, list)
  }
  const feeRowsByMonth = new Map<number, Row[]>()
  let txnSeq = 0
  const nextTxn = () => `TX-${pad(++txnSeq, 8)}`
  for (const t of tournaments) {
    if (t.fee <= 0) continue
    for (const e of t.entries) {
      const at = new Date(e.registered.getTime() + rng.int(10, 20) * 3_600_000 + rng.int(0, 59) * 60_000)
      const m = e.member
      const tierName = m ? tierAt(m, e.registered) : null
      const k = monthKey(e.registered)
      const list = feeRowsByMonth.get(k) ?? []
      list.push({
        txn_id: nextTxn(), txn_date: dateOnly(at), date_key: dateKey(at), time_key: timeKey(at), venue_key: t.venue.key, member_key: m ? m.key : -1,
        tier_key: tierName ? tierByName.get(tierName)!.key : -1, payment_key: paymentKey(rng.chance(0.6) ? 'Card' : 'Mobile Wallet', m && rng.chance(0.7) ? 'App' : 'Counter'),
        prize_key: -1, tournament_key: t.key, txn_type: 'Tournament Entry', amount_usd: t.fee, credits_issued: 0, bonus_credits: 0, tickets_redeemed: 0, prize_quantity: 0, prize_cost: 0
      })
      feeRowsByMonth.set(k, list)
    }
  }
  let ticketSeq = 0
  let tbdPlanted = false
  let errSeq = 0
  let redSeq = 0
  let firstEventsFile = true
  let driftLogged = false
  let overflowPlanted = false
  let retiredPlanted = false
  let firstKiosk = true
  const openTickets: Ticket[] = []
  const finished: Ticket[] = []

  const popularity = (g: GameDef, d: Date): number => {
    const launch = gameLaunch.get(g.code)!
    if (d.getTime() < launch.getTime()) return 0
    if (g.code === VIRAL) {
      const t = daysBetween(launch, d)
      return g.pop * (1 + 3.5 * Math.exp(-t / 45))
    }
    const yrs = daysBetween(start, d) / 365
    return g.pop * (g.year < 1990 ? 1 + 0.05 * yrs : 1 - 0.02 * yrs)
  }

  const finalizeTicket = (t: Ticket, rows: Record<string, Row[]>, helpdesk: BronzeRow[] | null) => {
    const resolved = t.resolvedAt.getTime() <= todayEnd.getTime() && t.resolvedAt.getTime() <= addHours(today, 24).getTime()
    const assigned = t.assignedAt.getTime() < todayEnd.getTime()
    const f = FAULTS[t.fault]
    rows.gold_fact_maintenance_ticket.push({
      ticket_id: t.id, machine_sk: t.sk, venue_key: t.venueKey, game_key: gameKey.get(t.machine.game.code)!, fault_key: t.fault + 1,
      opened_date_key: dateKey(t.openedAt), assigned_date_key: assigned ? dateKey(t.assignedAt) : null, resolved_date_key: resolved ? dateKey(t.resolvedAt) : null,
      opened_at: t.openedAt, resolved_at: resolved ? t.resolvedAt : null, ticket_type: t.type, priority: t.priority, technician: t.technician ?? 'Unassigned',
      response_hours: assigned ? round((t.assignedAt.getTime() - t.openedAt.getTime()) / 3_600_000, 2) : null,
      repair_hours: resolved ? round((t.resolvedAt.getTime() - t.assignedAt.getTime()) / 3_600_000, 2) : null,
      downtime_hours: round(t.downtime, 4), parts_cost: resolved ? t.parts : null, labor_cost: resolved ? t.labor : null, status: resolved ? 'Resolved' : 'Open'
    })
    rows.silver_maintenance_tickets.push({
      ticket_id: t.id, machine_id: t.machine.id, fault_code: f.code, ticket_type: t.type, priority: t.priority, technician: t.technician, opened_at: t.openedAt,
      assigned_at: assigned ? t.assignedAt : null, resolved_at: resolved ? t.resolvedAt : null, parts_cost: resolved ? t.parts : null, labor_cost: resolved ? t.labor : null
    })
    helpdesk?.push({
      id: t.id, asset: t.machine.id, fault: f.code, kind: t.type, priority: t.priority, technician: t.techBronze, opened: t.openedAt,
      assigned: assigned ? t.assignedAt : null, resolved: resolved ? t.resolvedAt : null, cost: resolved ? { parts: t.parts, labor: t.labor } : null
    })
  }

  const newTicket = (m: Machine, sk: number, venue: Venue, type: 'Breakdown' | 'Preventive', at: Date, faultCode: string, r: Rng): Ticket => {
    const f = FAULTS[faultIndex.get(faultCode)!]
    const response = type === 'Preventive' ? 0 : r.gamma(2, 0.9) + (venue.type === 'Bar-cade' ? 1 : 0)
    const handsOn = f.hours * r.logNormal(1, 0.3)
    const partsWait = type === 'Breakdown' && f.category !== 'Software' && r.chance(0.14) ? r.int(20, 90) : 0
    const assignedAt = toSecond(addHours(at, response).getTime())
    const resolvedAt = toSecond(addHours(assignedAt, handsOn + partsWait).getTime())
    const tbd = !tbdPlanted || r.chance(0.06)
    tbdPlanted = true
    const tech = r.pick(techs)
    const t: Ticket = {
      id: `TKT-${pad(++ticketSeq, 6)}`,
      machine: m,
      sk,
      venueKey: venue.key,
      fault: faultIndex.get(faultCode)!,
      type,
      priority: type === 'Preventive' ? 'P3' : f.severity === 'High' ? 'P1' : f.severity === 'Medium' ? 'P2' : 'P3',
      technician: tbd ? null : tech,
      techBronze: tbd ? r.pick(['TBD', 'UNASSIGNED']) : tech,
      openedAt: at,
      assignedAt,
      resolvedAt,
      downtime: 0,
      parts: type === 'Preventive' || f.category === 'Software' ? 0 : money(r.logNormal(f.severity === 'High' ? 180 : 60, 0.5)),
      labor: money(handsOn * 38)
    }
    if (tbd) ctx.issue('PP14')
    return t
  }

  const faultFor = (m: Machine, buggy: boolean, r: Rng): string => {
    if (buggy && r.chance(0.7)) return 'F06'
    if (m.game.group === 'Pinball' && r.chance(0.45)) return 'F08'
    if (m.game.group === 'Redemption' && r.chance(0.5)) return 'F07'
    return r.weighted(['F01', 'F02', 'F03', 'F04', 'F05', 'F09', 'F10', 'F11'], [0.18, 0.15, 0.18, 0.08, 0.07, 0.1, 0.14, 0.1])
  }

  const hourPickers = new Map<VenueType, (r: Rng) => number>()
  for (const [t, d] of Object.entries(VENUE_TYPE) as Array<[VenueType, (typeof VENUE_TYPE)[VenueType]]>) hourPickers.set(t, weightedPicker(d.weights.map((_, i) => d.open + i), d.weights))
  const packages = (d: Date): Array<[number, number]> => (d.getTime() < priceDate.getTime() ? [[10, 40], [20, 85], [50, 225], [100, 480]] : [[10, 35], [20, 72], [50, 190], [100, 400]])
  const creditPrice = (d: Date) => (d.getTime() < priceDate.getTime() ? 0.25 : 0.3)

  for (let ms = startOfMonth(start); ms.getTime() <= today.getTime(); ms = ymd(ms.getUTCFullYear(), ms.getUTCMonth() + 2, 1)) {
    const me = minDate(endOfMonth(ms), today)
    const T: Record<string, Row[]> = {
      gold_fact_play: [], gold_fact_machine_day: [], gold_fact_maintenance_ticket: [], gold_fact_tournament_entry: [], gold_fact_wallet_txn: [],
      silver_plays: [], silver_cabinet_errors: [], silver_topups: [], silver_redemptions: [], silver_membership_billing: [], silver_tournament_entries: [], silver_maintenance_tickets: []
    }
    const bronze: BronzeFile[] = []
    const kioskRows: BronzeRow[] = []
    const redemptionRows: BronzeRow[] = []
    const billingRows: BronzeRow[] = []
    const helpdeskRows: BronzeRow[] = []
    const entryRows: BronzeRow[] = []

    for (const day of eachDay(ms, me)) {
      const dk = dateKey(day)
      const wd = isoDow(day)
      const progress = clamp(daysBetween(start, day) / Math.max(1, span), 0, 1)
      const holiday = (day.getUTCMonth() === 11 && day.getUTCDate() >= 20) || (day.getUTCMonth() === 0 && day.getUTCDate() <= 2) ? 1.35 : day.getUTCMonth() === 8 && day.getUTCDate() === 9 ? 1.6 : 1
      const dayCampaigns = campaigns.filter((cp) => day.getTime() >= cp.start.getTime() && day.getTime() <= cp.end.getTime())
      const venuePlays: Array<{ guestCredits: number; guestTickets: number; memberCredits: Map<Member, number> }> = venues.map(() => ({ guestCredits: 0, guestTickets: 0, memberCredits: new Map() }))
      const events: BronzeRow[] = []

      for (const m of machines) {
        while (m.vi + 1 < m.versions.length && m.versions[m.vi + 1].from.getTime() <= day.getTime()) m.vi++
        if (day.getTime() < m.purchase.getTime()) continue
        const attrs = m.versions[m.vi].attrs
        if (attrs.cabinet_status !== 'Active') continue
        const venue = venueByCode.get(attrs.venue_code as string)!
        if (!venueOpenOn(venue, day)) continue
        const vt = VENUE_TYPE[venue.type]
        const openStart = addHours(day, vt.open)
        const openEnd = addHours(day, vt.close)
        const openHours = vt.close - vt.open
        const sk = machineIndex.lookup(m.id, day)!
        const fw = attrs.firmware_version as string
        const buggy = m.game.code === BUGGY && fw === '2.3'
        const vi = venues.indexOf(venue)
        // demand
        const dow = venue.type === 'Bar-cade' ? [0.6, 0.65, 0.8, 1.0, 1.5, 1.6, 0.9][wd - 1] : [0.7, 0.72, 0.82, 0.92, 1.25, 1.55, 1.3][wd - 1]
        const summer = venue.type === 'Mall Arcade' && (day.getUTCMonth() === 6 || day.getUTCMonth() === 7) ? 1.1 : 1
        const ramp = Math.min(1, 0.5 + (0.5 * daysBetween(venue.opened, day)) / 60)
        let campaign: Campaign | null = null
        let lift = 1
        for (const cp of dayCampaigns) {
          if (cp.type === 'Retro Night' && wd !== 4) continue
          if (!campaign || cp.priority > campaign.priority) campaign = cp
        }
        if (campaign) {
          lift = campaign.type === 'Retro Night' ? (m.game.year < 1995 && m.game.year > 0 ? 1.35 : 1.1) : campaign.type === 'Launch' ? (m.game.code === VIRAL ? 1.5 : 1.05) : campaign.type === 'Themed Weekend' ? 1.25 : 1.12
        }
        const lambdaReal = BASE_REAL * popularity(m.game, day) * vt.mult * dow * annualCycle(day, 200, 0.1) * summer * holiday * (1 + 0.05 * progress * ctx.scale.years) * ramp * lift
        // preventive maintenance before opening
        if (!m.down && day.getTime() >= m.nextPm.getTime()) {
          const at = addHours(day, 8 + rng.int(0, 60) / 60)
          const t = newTicket(m, sk, venue, 'Preventive', at, 'PM1', rng)
          t.resolvedAt = minDate(t.resolvedAt, addHours(day, vt.open - 0.25))
          openTickets.push(t)
          m.wear *= 0.4
          m.nextPm = addDays(day, rng.int(100, 140))
        }
        // breakdown hazard
        const bugFactor = buggy ? 6 : 1
        if (!m.down) {
          const p = Math.min(0.5, (buggy ? 0.03 : 0) + (0.0025 + 0.06 * Math.pow(m.wear / 100, 3)) * bugFactor)
          if (rng.chance(p)) {
            const at = toSecond(openStart.getTime() + rng.next() * (openEnd.getTime() - openStart.getTime()))
            const t = newTicket(m, sk, venue, 'Breakdown', at, faultFor(m, buggy, rng), rng)
            openTickets.push(t)
            m.down = { ticket: t, until: t.resolvedAt }
            m.wear = rng.float(3, 15)
          }
        }
        let downtime = 0
        const downFrom = m.down ? m.down.ticket.openedAt : null
        const downUntil = m.down ? m.down.until : null
        if (m.down) {
          downtime = overlapHours(m.down.ticket.openedAt, m.down.until, openStart, openEnd)
          m.down.ticket.downtime += downtime
        }
        const isDown = (t: Date) => downFrom !== null && downUntil !== null && t.getTime() >= downFrom.getTime() && t.getTime() < downUntil.getTime()
        // errors (telemetry)
        const nErr = rng.poisson((0.03 + 1.5 * Math.pow(m.wear / 100, 2)) * (buggy ? 6 : 1))
        let errCount = 0
        for (let e = 0; e < nErr; e++) {
          const at = toSecond(openStart.getTime() + rng.next() * (openEnd.getTime() - openStart.getTime()))
          if (isDown(at)) continue
          errCount++
          const id = `ERR-${pad(++errSeq, 8)}`
          const code = buggy && rng.chance(0.6) ? 'E-WATCHDOG' : rng.pick(ERROR_CODES)
          T.silver_cabinet_errors.push({ error_id: id, machine_id: m.id, error_at: at, business_date: day, error_code: code, firmware_version: fw })
          events.push({ event: 'error', event_id: id, machine: m.id, ts: at, card: null, credits: null, duration_s: null, score: null, tickets: null, fw, code })
        }
        // plays (sampled)
        const n = rng.poisson(lambdaReal * VOLUME)
        let plays = 0
        let credits = 0
        let revenue = 0
        let ticketsOut = 0
        const recKey = `${venue.code}|${m.game.code}`
        if (!records.has(recKey)) records.set(recKey, m.game.score * 3)
        const times: Date[] = []
        for (let k = 0; k < n; k++) {
          const h = hourPickers.get(venue.type)!(rng)
          const at = new Date(day.getTime() + h * 3_600_000 + rng.int(0, 3599) * 1000)
          if (!isDown(at)) times.push(at)
        }
        times.sort((a, b) => a.getTime() - b.getTime())
        for (const at of times) {
          plays++
          let member: Member | null = null
          if (rng.chance(0.38 + 0.12 * progress)) {
            const pool = rng.chance(0.85) ? membersByVenue[vi] : members
            for (let tries = 0; tries < 10 && pool.length; tries++) {
              const cand = pool[rng.int(0, pool.length - 1)]
              if (!memberActive(cand, day)) continue
              if (rng.next() < cand.weight / maxWeight + 0.15) {
                member = cand
                break
              }
            }
          }
          const tier = member ? tierByName.get(tierAt(member, day))! : null
          const continues = m.game.group === 'Video' ? rng.poisson(0.3) : 0
          const cr = m.game.credits * (1 + continues)
          const rev = money(cr * creditPrice(day))
          const dur = Math.max(15, Math.round(rng.logNormal(m.game.dur, 0.35) * (1 + 0.6 * continues)))
          const overflow = !overflowPlanted || rng.chance(0.0008)
          overflowPlanted = true
          let score: number | null = Math.max(0, Math.round(rng.logNormal(m.game.score * (member ? member.skill : 0.9), 0.6)))
          if (overflow) {
            score = null
            ctx.issue('PP04')
          }
          let top = false
          if (score !== null && score > records.get(recKey)!) {
            top = true
            records.set(recKey, score)
          }
          let tix = rng.poisson(m.game.tickets * 2.5 * (tier ? tier.mult : 1))
          if (m.game.group === 'Redemption' && rng.chance(0.003)) tix += 500
          credits += cr
          revenue += rev
          ticketsOut += tix
          const playId = `${m.id}-${dk}-${pad(plays, 3)}`
          const camp = campaign && (campaign.type !== 'Retro Night' || at.getUTCHours() >= 17) ? campaign : null
          T.gold_fact_play.push({
            play_id: playId, play_date: day, date_key: dk, time_key: timeKey(at), venue_key: venue.key, machine_sk: sk, game_key: gameKey.get(m.game.code)!,
            member_key: member ? member.key : -1, campaign_key: camp ? camp.key : -1, credits: cr, revenue: rev, duration_sec: dur, score, tickets_won: tix, is_top_score: top
          })
          T.silver_plays.push({
            play_id: playId, machine_id: m.id, venue_code: venue.code, started_at: at, business_date: day, member_id: member ? member.id : null, credits: cr,
            duration_sec: dur, score, tickets_won: tix, campaign_code: camp ? camp.code : null
          })
          events.push({
            event: 'play_end', event_id: playId, machine: m.id, ts: at, card: member ? member.id : `GC-${rng.chars(6)}`, credits: cr, duration_s: dur,
            score: overflow ? 2147483647 : score, tickets: tix, fw, code: null
          })
          const vp = venuePlays[vi]
          if (member) {
            member.tickets += tix
            vp.memberCredits.set(member, (vp.memberCredits.get(member) ?? 0) + cr)
          } else {
            vp.guestCredits += cr
            vp.guestTickets += tix
          }
        }
        T.gold_fact_machine_day.push({
          machine_sk: sk, date_key: dk, snapshot_date: day, venue_key: venue.key, game_key: gameKey.get(m.game.code)!, open_hours: openHours,
          uptime_hours: round(openHours - downtime, 4), downtime_hours: round(downtime, 4), plays, credits, revenue: money(revenue), tickets_out: ticketsOut,
          error_events: errCount, is_down_at_close: downUntil !== null && downUntil.getTime() > openEnd.getTime(), wear_index: round(m.wear, 1)
        })
        m.wear += lambdaReal / 35
      }

      // wallet: top-ups & redemptions per venue
      venues.forEach((v, vi) => {
        if (!venueOpenOn(v, day)) return
        const vt = VENUE_TYPE[v.type]
        const vp = venuePlays[vi]
        const randTime = () => toSecond(day.getTime() + (vt.open + rng.next() * (vt.close - vt.open - 0.1)) * 3_600_000)
        const topup = (member: Member | null, wanted: number) => {
          const pk = packages(day)
          const choice = pk.find(([, cr]) => cr >= wanted) ?? pk[pk.length - 1]
          const tier = member ? tierByName.get(tierAt(member, day))! : null
          const bonus = tier ? Math.round(choice[1] * tier.bonus) : 0
          const ch = member && rng.chance(0.4) ? 'App' : rng.chance(0.7) ? 'Kiosk' : 'Counter'
          let method = rng.weighted(PAYMENT_METHODS, [0.5, ch === 'App' ? 0 : 0.18, 0.25, 0.07])
          if (ch === 'App' && method === 'Cash') method = 'Card'
          const at = randTime()
          const id = nextTxn()
          T.gold_fact_wallet_txn.push({
            txn_id: id, txn_date: day, date_key: dk, time_key: timeKey(at), venue_key: v.key, member_key: member ? member.key : -1, tier_key: tier ? tier.key : -1,
            payment_key: paymentKey(method, ch), prize_key: -1, tournament_key: -1, txn_type: 'Top-Up', amount_usd: choice[0], credits_issued: choice[1] + bonus,
            bonus_credits: bonus, tickets_redeemed: 0, prize_quantity: 0, prize_cost: 0
          })
          T.silver_topups.push({ txn_id: id, venue_code: v.code, sold_at: at, business_date: day, member_id: member ? member.id : null, payment_method: method, sales_channel: ch, amount_usd: choice[0], credits: choice[1], bonus_credits: bonus })
          kioskRows.push({ txn: id, venue: v.code, ts: at, card: member ? member.id : 'GUEST', method, channel: ch, amount: choice[0], credits: choice[1], bonus })
        }
        // cash topped up tracks credits consumed in expectation (an average top-up is ~$35)
        const want = () => Math.max(30, Math.round(rng.logNormal(80, 0.6)))
        const price = creditPrice(day)
        const nGuest = rng.poisson((vp.guestCredits * price * rng.float(0.95, 1.1)) / 35)
        for (let k = 0; k < nGuest; k++) topup(null, want())
        for (const [member, cr] of vp.memberCredits) if (rng.chance(Math.min(1, (cr * price) / 35))) topup(member, want())
        // redemptions
        const redeem = (member: Member | null, budget: number): number => {
          const catalogue = day.getTime() < prizeRetireDate.getTime() ? [...PRIZES, ...RETIRED_PRIZES] : PRIZES
          const affordable = catalogue.filter((p) => p.tickets <= budget)
          if (!affordable.length) return 0
          let prize = rng.weighted(affordable, affordable.map((p) => p.tickets * (p.code.startsWith('PRZ-R') ? 0.4 : 1)))
          if (!retiredPlanted && day.getTime() < prizeRetireDate.getTime()) {
            const r = RETIRED_PRIZES.filter((p) => p.tickets <= budget)
            if (r.length) prize = r[0]
          }
          const retired = prize.code.startsWith('PRZ-R')
          if (retired) {
            retiredPlanted = true
            ctx.issue('PP07')
          }
          const qty = prize.category === 'Candy' ? Math.max(1, Math.min(5, Math.floor(budget / prize.tickets / 2))) : 1
          const tickets = qty * prize.tickets
          const at = randTime()
          const id = `RD-${pad(++redSeq, 7)}`
          const tier = member ? tierByName.get(tierAt(member, day))! : null
          T.gold_fact_wallet_txn.push({
            txn_id: nextTxn(), txn_date: day, date_key: dk, time_key: timeKey(at), venue_key: v.key, member_key: member ? member.key : -1, tier_key: tier ? tier.key : -1,
            payment_key: -1, prize_key: retired ? -1 : prizeKey.get(prize.code)!, tournament_key: -1, txn_type: 'Prize Redemption', amount_usd: 0, credits_issued: 0,
            bonus_credits: 0, tickets_redeemed: tickets, prize_quantity: qty, prize_cost: money(qty * prize.cost)
          })
          T.silver_redemptions.push({ redemption_id: id, venue_code: v.code, redeemed_at: at, business_date: day, member_id: member ? member.id : null, prize_code: prize.code, quantity: qty, tickets })
          redemptionRows.push({ redemption_id: id, venue: v.code, ts: at, card: member ? member.id : 'GUEST', prize_code: prize.code, qty, tickets })
          return tickets
        }
        let guestBudget = Math.floor(vp.guestTickets * rng.float(0.45, 0.85))
        for (let k = 0; k < 2 && guestBudget >= 10; k++) {
          const spent = redeem(null, guestBudget)
          if (!spent) break
          guestBudget -= spent
        }
        for (const member of vp.memberCredits.keys()) {
          if (member.tickets >= 50 && rng.chance(0.3)) member.tickets -= redeem(member, member.tickets)
        }
      })

      // end of day: resolve tickets
      const nextMidnight = addDays(day, 1)
      for (let i = openTickets.length - 1; i >= 0; i--) {
        const t = openTickets[i]
        if (t.resolvedAt.getTime() <= nextMidnight.getTime()) {
          finalizeTicket(t, T, helpdeskRows)
          if (t.machine.down?.ticket === t) t.machine.down = null
          openTickets.splice(i, 1)
          finished.push(t)
        }
      }

      // cabinet telemetry file: events landing today (late uploads land later)
      for (const e of events) {
        const land = minDate(landingDay(day, { rng, sink: ctx, code: 'PP02', rate: 0.008, maxDelay: 7 }), today)
        const k = dateKey(land)
        const list = pendingEvents.get(k) ?? []
        list.push(e)
        pendingEvents.set(k, list)
      }
      const landed = pendingEvents.get(dk) ?? []
      pendingEvents.delete(dk)
      if (landed.length) {
        const drift = day.getTime() >= driftDate.getTime()
        let rows: BronzeRow[] = landed.map((r) => {
          if (!drift) return { ...r }
          const { duration_s, ...rest } = r
          return { ...rest, duration_ms: typeof duration_s === 'number' ? duration_s * 1000 : null, cabinet_temp_c: r.event === 'error' || rng.chance(0.5) ? round(rng.normal(41, 4), 1) : null }
        })
        if (drift && !driftLogged) {
          ctx.issue('PP03')
          driftLogged = true
        }
        rows = injectDuplicates(rows, { rng, sink: ctx, code: 'PP01', rate: 0.003, atLeast: firstEventsFile ? 1 : 0 })
        firstEventsFile = false
        const columns = drift
          ? ['event', 'event_id', 'machine', 'ts', 'card', 'credits', 'duration_ms', 'score', 'tickets', 'fw', 'code', 'cabinet_temp_c']
          : ['event', 'event_id', 'machine', 'ts', 'card', 'credits', 'duration_s', 'score', 'tickets', 'fw', 'code']
        const y = day.getUTCFullYear()
        bronze.push({ source: 'cabinet_events', path: `cabinets/${y}/${pad(day.getUTCMonth() + 1)}/${pad(day.getUTCDate())}/events_${dk}.ndjson`, format: 'ndjson', columns, rows })
      }
    }

    // membership billing for the month
    for (const m of members) {
      const bill = ymd(ms.getUTCFullYear(), ms.getUTCMonth() + 1, Math.min(28, m.join.getUTCDate()))
      if (bill.getTime() < start.getTime() || bill.getTime() > me.getTime() || !memberActive(m, bill) || bill.getTime() <= m.join.getTime()) continue
      const tier = tierByName.get(tierAt(m, bill))!
      if (!tier.paid) continue
      const at = addHours(bill, 3)
      T.gold_fact_wallet_txn.push({
        txn_id: nextTxn(), txn_date: bill, date_key: dateKey(bill), time_key: timeKey(at), venue_key: venues[m.home].key, member_key: m.key, tier_key: tier.key,
        payment_key: paymentKey('Card', 'App'), prize_key: -1, tournament_key: -1, txn_type: 'Membership Fee', amount_usd: tier.fee, credits_issued: 0, bonus_credits: 0,
        tickets_redeemed: 0, prize_quantity: 0, prize_cost: 0
      })
      T.silver_membership_billing.push({ member_id: m.id, billing_date: bill, tier: tier.name, fee: tier.fee, venue_code: venues[m.home].code })
      billingRows.push({ member: m.id, billed_on: bill, plan: tier.name, fee: tier.fee, home_venue: venues[m.home].code })
    }
    // tournament entries & fees
    for (const t of entriesByMonth.get(monthKey(ms)) ?? []) {
      for (const e of t.entries) {
        T.gold_fact_tournament_entry.push({
          entry_id: e.id, tournament_key: t.key, member_key: e.member ? e.member.key : -1, venue_key: t.venue.key, date_key: dateKey(t.date),
          registered_date_key: dateKey(e.registered), seed: e.seed, placement: e.placement, is_winner: e.placement === 1
        })
        T.silver_tournament_entries.push({ entry_id: e.id, tournament_code: t.code, player_id: e.playerId, registered_date: e.registered, seed: e.seed, placement: e.placement })
        entryRows.push({ entry_id: e.id, tournament: t.code, player_id: e.playerId, registered: e.registered, seed: e.seed, placement: e.placement })
        if (!e.member) ctx.issue('PP15')
      }
    }
    T.gold_fact_wallet_txn.push(...(feeRowsByMonth.get(monthKey(ms)) ?? []))

    const y = ms.getUTCFullYear()
    const ym = `${y}${pad(ms.getUTCMonth() + 1)}`
    injectFormattedNumbers(kioskRows, 'amount', { rng, sink: ctx, code: 'PP05', rate: 0.08, atLeast: firstKiosk && kioskRows.length ? 1 : 0 })
    injectCasing(kioskRows, 'method', { rng, sink: ctx, code: 'PP06', rate: 0.06, atLeast: firstKiosk && kioskRows.length ? 1 : 0 })
    if (kioskRows.length) firstKiosk = false
    if (kioskRows.length) bronze.push({ source: 'kiosk', path: `kiosk/${y}/topups_${ym}.csv`, format: 'csv', rows: kioskRows })
    if (redemptionRows.length) bronze.push({ source: 'prize_counter', path: `prize_counter/${y}/redemptions_${ym}.csv`, format: 'csv', rows: redemptionRows })
    if (billingRows.length) bronze.push({ source: 'membership', path: `billing/${y}/membership_billing_${ym}.csv`, format: 'csv', rows: billingRows })
    if (helpdeskRows.length) bronze.push({ source: 'helpdesk', path: `maintenance/${y}/tickets_resolved_${ym}.json`, format: 'json', rows: helpdeskRows, json: { envelope: { service: 'fixquest', month: ym }, dataKey: 'tickets' } })
    if (entryRows.length) bronze.push({ source: 'esports', path: `esports/${y}/entries_${ym}.csv`, format: 'csv', rows: entryRows })
    yield { label: `${y}-${pad(ms.getUTCMonth() + 1)}`, tables: T, bronze }
  }

  // ---- closing: open tickets, members, membership events -------------------------------------
  const closing: Record<string, Row[]> = { gold_fact_maintenance_ticket: [], silver_maintenance_tickets: [], silver_members: [], silver_membership_events: [] }
  const openRows: BronzeRow[] = []
  for (const t of openTickets) finalizeTicket(t, closing, openRows)
  const rl = ctx.rng('crm-bronze')
  const crmRows: BronzeRow[] = []
  for (const m of members) {
    const tier = tierAt(m, today)
    closing.silver_members.push({
      member_id: m.id, gamer_tag: m.tag, current_tier: tier, membership_status: m.cancel ? 'Cancelled' : 'Active', join_date: m.join, cancel_date: m.cancel,
      home_venue_code: venues[m.home].code, age_band: m.ageBand, email: m.email, email_opt_in: m.optIn
    })
    let em: BronzeValue = m.email
    if (em === null) {
      em = rl.pick(['', 'NULL', 'n/a', null] as Array<string | null>)
      ctx.issue('PP10')
    }
    crmRows.push({ member_id: m.id, gamer_tag: m.tag, tier, status: m.cancel ? 'cancelled' : 'active', joined: m.join, cancelled: m.cancel, home_venue: venues[m.home].code, age_band: m.ageBand, email: em, opt_in: m.optIn })
    let prev = ''
    const seqByDay = new Map<number, number>()
    m.tiers.forEach((x, i) => {
      const k = dateKey(x.from)
      const seq = (seqByDay.get(k) ?? 0) + 1
      seqByDay.set(k, seq)
      const type = i === 0 ? 'Join' : TIERS.findIndex((t) => t.name === x.tier) > TIERS.findIndex((t) => t.name === prev) ? 'Upgrade' : 'Downgrade'
      closing.silver_membership_events.push({ member_id: m.id, event_date: x.from, event_seq: seq, event_type: type, from_tier: i === 0 ? null : prev, to_tier: x.tier })
      prev = x.tier
    })
    if (m.cancel) {
      const k = dateKey(m.cancel)
      const seq = (seqByDay.get(k) ?? 0) + 1
      closing.silver_membership_events.push({ member_id: m.id, event_date: m.cancel, event_seq: seq, event_type: 'Cancel', from_tier: prev, to_tier: null })
    }
  }
  injectCasing(crmRows, 'tier', { rng: rl, sink: ctx, code: 'PP12', rate: 0.15, atLeast: 1 })
  injectDateFormats(crmRows, 'joined', { rng: rl, sink: ctx, code: 'PP11', rate: 0.2, formats: ['us', 'eu', 'epoch', 'long'], atLeast: 1 })
  const crmDup = injectDuplicates(crmRows, { rng: rl, sink: ctx, code: 'PP09', rate: 0.015, atLeast: 1 })
  const bronze: BronzeFile[] = [
    { source: 'crm', path: 'crm/members_export.json', format: 'json', rows: crmDup, json: { envelope: { api: 'pagoda-pass/v1/members', exportedAt: formatDate(today, 'iso_t'), pages: 1 }, dataKey: 'members' } },
    { source: 'membership', path: 'crm/membership_events.ndjson', format: 'ndjson', rows: closing.silver_membership_events.map((r) => ({ ...r }) as BronzeRow) }
  ]
  if (openRows.length) bronze.push({ source: 'helpdesk', path: 'maintenance/open_tickets.json', format: 'json', rows: openRows, json: { envelope: { service: 'fixquest', snapshot: isoDate(today) }, dataKey: 'tickets' } })
  yield { label: 'closing', tables: closing, bronze }
  void finished
}

