/**
 * Sunjar Fusion Labs — simulation.
 *
 * Devices run in campaigns (weekday run days, maintenance gaps). Each run day fires a Poisson
 * number of shots whose physics follows a per-device learning curve (perf rises over time, steps
 * up after the heating upgrade) and shot mode; outcomes depend on how hard the shot pushes. Q is
 * derived from the triple product n·T·τE and the fuel. Planted story: a magnet quench on Jarbelly-1
 * (6-week outage + jittery restart), a Thomson-scattering calibration drift, D-T operations after
 * the tritium licence, and one record D-T shot that crosses scientific breakeven (Q > 1).
 * Finance: budgets from fiscal-year workbooks (July start), actuals from GL lines with project
 * overruns; spend is charged to grants/partnerships or the latest equity round. Procurement: HTS
 * tape shortage, a supplier on probation. HR: SCD2 staff with hiring bursts after funding rounds.
 *
 * Volumes: `small` uses realistic shot cadences (tens of shots per run day per device); `large`
 * multiplies cadence ×30 (high-repetition-rate pulsed operation).
 */
import type { Scalar } from '../../../../../src/core/model/data.ts'
import {
  addDays, dateKey, dateOnly, daysBetween, eachDay, endOfMonth, fiscalYear, holidayMap, isoDow, isoDate, maxDate, minDate, monthKey, startOfMonth, timeKey, ymd, GENERIC_HOLIDAYS
} from '../../calendar.ts'
import {
  formatDate, injectCasing, injectDateFormats, injectDuplicates, injectFormattedNumbers, injectWhitespace, landingDay
} from '../../chaos.ts'
import { clamp, round } from '../../prng.ts'
import type { Rng } from '../../prng.ts'
import { Scd2Index, scd2Rows } from '../../scd2.ts'
import type { Scd2Version } from '../../scd2.ts'
import type { Batch, BronzeFile, BronzeRow, GenContext, Row } from '../../schema.ts'
import { orgNames, personName } from '../../words.ts'

// ---------------------------------------------------------------------------------------------
// Reference data

type DeviceType = 'Tokamak' | 'Spherical Tokamak' | 'Stellarator' | 'Z-Pinch' | 'Magnet Test Stand'

interface DeviceDef {
  code: string
  name: string
  type: DeviceType
  site: string
  building: string
  commissionFrac: number | null // null = before history
  rate: number // shots per run day at small scale
  radius: number | null
  field: number
  volume: number | null
  heating: Array<[string, number]>
  superconducting: boolean
  channels: Array<[string, string, string, string]> // suffix, diagnostic, quantity, unit
}

const PLASMA_CHANNELS: Array<[string, string, string, string]> = [
  ['TS', 'Thomson scattering', 'Electron temperature', 'keV'],
  ['IF', 'Interferometer', 'Line-averaged density', '1e20 m^-3'],
  ['NC', 'Neutron counter', 'Neutron yield', '1e12 n']
]

const DEVICES: DeviceDef[] = [
  { code: 'JB1', name: 'Jarbelly-1', type: 'Tokamak', site: 'Bellwether Ridge Campus', building: 'Hall A', commissionFrac: null, rate: 36, radius: 1.85, field: 12.2, volume: 18.5, heating: [['Ohmic', 0.1], ['Neutral Beam', 0.4], ['Ion Cyclotron', 0.2], ['Hybrid', 0.3]], superconducting: true, channels: PLASMA_CHANNELS },
  { code: 'LS2', name: 'Little Sun', type: 'Spherical Tokamak', site: 'Bellwether Ridge Campus', building: 'Hall B', commissionFrac: null, rate: 48, radius: 0.85, field: 3.1, volume: 4.2, heating: [['Ohmic', 0.3], ['Electron Cyclotron', 0.3], ['Neutral Beam', 0.4]], superconducting: true, channels: PLASMA_CHANNELS },
  { code: 'CK3', name: 'Corkscrew', type: 'Stellarator', site: 'Saltmarsh Annex', building: 'Stellarator Hall', commissionFrac: 0.3, rate: 26, radius: 2.4, field: 5.5, volume: 22, heating: [['Electron Cyclotron', 0.7], ['Ion Cyclotron', 0.3]], superconducting: true, channels: PLASMA_CHANNELS },
  { code: 'SD4', name: 'Snapdragon', type: 'Z-Pinch', site: 'Saltmarsh Annex', building: 'Pulsed Power Bay', commissionFrac: null, rate: 66, radius: null, field: 0, volume: 0.0004, heating: [['Capacitor Bank', 1]], superconducting: false, channels: [PLASMA_CHANNELS[0], PLASMA_CHANNELS[2], ['XR', 'X-ray spectrometer', 'Hard X-ray flux', 'a.u.']] },
  { code: 'M3T', name: 'Magnet Test Stand M3', type: 'Magnet Test Stand', site: 'Bellwether Ridge Campus', building: 'Magnet Lab', commissionFrac: null, rate: 10, radius: null, field: 20.1, volume: null, heating: [['Coil Ramp', 1]], superconducting: true, channels: [['HP', 'Hall probe', 'Field on axis', 'T'], ['CT', 'Cernox thermometer', 'Coil temperature', 'K'], ['SG', 'Strain gauge array', 'Hoop strain', 'microstrain']] }
]

const PHYS: Record<Exclude<DeviceType, 'Magnet Test Stand'>, { te: number; ne: number; tau: number; heat: number; dur: number }> = {
  Tokamak: { te: 5.5, ne: 0.9, tau: 140, heat: 16, dur: 4000 },
  'Spherical Tokamak': { te: 2.6, ne: 1.4, tau: 35, heat: 7, dur: 800 },
  Stellarator: { te: 2.2, ne: 0.7, tau: 110, heat: 5, dur: 12000 },
  'Z-Pinch': { te: 1.6, ne: 25, tau: 0.015, heat: 350, dur: 0.25 }
}

const HEATING = ['Ohmic', 'Neutral Beam', 'Ion Cyclotron', 'Electron Cyclotron', 'Hybrid', 'Capacitor Bank', 'Coil Ramp']
const FUELS = ['D-D', 'D-T', 'D-He3', 'None']
const MODES = ['Calibration', 'Scan', 'Performance', 'Record Attempt']
const MODE_MULT = [0.45, 0.8, 1, 1.2]
const MODE_DISRUPT = [0.02, 0.06, 0.12, 0.3]

const OUTCOMES: Array<[string, string, string]> = [
  ['Success', 'Good', 'None'],
  ['Partial', 'Degraded', 'Target Missed'],
  ['Disruption', 'Bad', 'Locked Mode'],
  ['Disruption', 'Bad', 'Vertical Displacement'],
  ['Disruption', 'Bad', 'Density Limit'],
  ['Disruption', 'Bad', 'Radiative Collapse'],
  ['Abort', 'Bad', 'Hardware Trip'],
  ['Abort', 'Bad', 'Interlock'],
  ['Quench', 'Bad', 'Magnet Quench']
]

const GOALS = ['H-mode access', 'Density limit scan', 'Divertor heat loads', 'Confinement scaling', 'Long-pulse endurance', 'Heating coupling', 'Edge stability', 'Fast-ion physics', 'Wall conditioning']

const ACCOUNTS: Array<[string, string, string, string]> = [
  ['6100', 'Salaries & Benefits', 'Personnel', 'Opex'],
  ['6200', 'Contract Engineering', 'Services', 'Opex'],
  ['6300', 'Materials & Consumables', 'Materials', 'Opex'],
  ['6400', 'Cryogens & Process Gases', 'Materials', 'Opex'],
  ['6500', 'Electricity', 'Facilities', 'Opex'],
  ['6600', 'Travel & Conferences', 'Travel', 'Opex'],
  ['6700', 'Compute & Software', 'Services', 'Opex'],
  ['1500', 'Lab Equipment', 'Equipment', 'Capex'],
  ['1600', 'Magnet Hardware', 'Equipment', 'Capex']
]

interface ProjectDef {
  code: string
  name: string
  program: string
  annual: number // $M
  startFrac: number | null
  years: number
  accounts: string[]
  magnet?: boolean
}

const PROJECTS: ProjectDef[] = [
  { code: 'PRJ-101', name: 'Jarbelly Performance Campaigns', program: 'Plasma Performance', annual: 7.5, startFrac: null, years: 6, accounts: ['6100', '6200', '6300', '6400', '6500', '6700'] },
  { code: 'PRJ-102', name: 'Breakeven Push', program: 'Plasma Performance', annual: 6, startFrac: 0.5, years: 2.5, accounts: ['6100', '6200', '6300', '6400', '6500', '1500'] },
  { code: 'PRJ-103', name: 'Corkscrew Stellarator Build-out', program: 'Plasma Performance', annual: 9, startFrac: null, years: 4, accounts: ['6100', '6200', '6300', '1500', '1600'], magnet: true },
  { code: 'PRJ-104', name: 'Snapdragon Pulsed Pinch Physics', program: 'Plasma Performance', annual: 3.5, startFrac: null, years: 5, accounts: ['6100', '6300', '6500', '6600', '1500'] },
  { code: 'PRJ-201', name: 'HTS Coil Program', program: 'Magnet Technology', annual: 12, startFrac: null, years: 6, accounts: ['6100', '6200', '6300', '6400', '1500', '1600'], magnet: true },
  { code: 'PRJ-202', name: 'Quench Protection Upgrade', program: 'Magnet Technology', annual: 2.5, startFrac: 0.42, years: 1.5, accounts: ['6100', '6200', '1600'], magnet: true },
  { code: 'PRJ-203', name: 'Magnet Test Stand Operations', program: 'Magnet Technology', annual: 3, startFrac: null, years: 6, accounts: ['6100', '6300', '6400', '6500'], magnet: true },
  { code: 'PRJ-301', name: 'Blanket Heat Loop', program: 'Power Conversion', annual: 4, startFrac: null, years: 4, accounts: ['6100', '6200', '6300', '1500'], magnet: true },
  { code: 'PRJ-302', name: 'Grid Interconnect Study', program: 'Power Conversion', annual: 1.5, startFrac: 0.6, years: 1.5, accounts: ['6100', '6200', '6600'] },
  { code: 'PRJ-401', name: 'Tritium Handling Facility', program: 'Tritium & Fuel Cycle', annual: 8, startFrac: null, years: 4, accounts: ['6100', '6200', '6300', '1500'] },
  { code: 'PRJ-402', name: 'Lithium Breeding Blanket', program: 'Tritium & Fuel Cycle', annual: 5, startFrac: 0.35, years: 3, accounts: ['6100', '6200', '6300', '6700'] },
  { code: 'PRJ-501', name: 'Pilot Plant Concept Design', program: 'Plant Design', annual: 6, startFrac: 0.6, years: 3, accounts: ['6100', '6200', '6600', '6700'] },
  { code: 'PRJ-502', name: 'Licensing & Safety Case', program: 'Plant Design', annual: 3, startFrac: null, years: 5, accounts: ['6100', '6200', '6600'] },
  { code: 'PRJ-503', name: 'Digital Twin & Data Platform', program: 'Plant Design', annual: 2.5, startFrac: null, years: 4, accounts: ['6100', '6700', '1500'] }
]
const TINY_PROJECTS = new Set(['PRJ-101', 'PRJ-102', 'PRJ-201', 'PRJ-202', 'PRJ-401', 'PRJ-501'])
const LEGACY_CODES = ['PRJ-000', 'PRJ-099', 'OH-LEGACY']

interface FundingDef {
  code: string
  name: string
  type: 'Equity Round' | 'Government Grant' | 'Strategic Partnership' | 'PPA Prepayment'
  closeOffset: number | null // days relative to start (when closeFrac null)
  closeFrac: number | null
  amount: number // $M
  preMoney: number | null // $M
  lead: string | null // fixed lead for non-equity
  leadType: string
  funds: string[] // project codes charged first
}

const FUNDING: FundingDef[] = [
  { code: 'FUND-SEED', name: 'Seed', type: 'Equity Round', closeOffset: -1460, closeFrac: null, amount: 8, preMoney: 22, lead: null, leadType: 'Venture Capital', funds: [] },
  { code: 'FUND-SERIES-A', name: 'Series A', type: 'Equity Round', closeOffset: -540, closeFrac: null, amount: 45, preMoney: 140, lead: null, leadType: 'Venture Capital', funds: [] },
  { code: 'FUND-GRANT-PFG', name: 'Plasma Frontier Grant', type: 'Government Grant', closeOffset: -200, closeFrac: null, amount: 25, preMoney: null, lead: 'National Fusion Futures Agency', leadType: 'Government', funds: ['PRJ-104', 'PRJ-203'] },
  { code: 'FUND-SERIES-B', name: 'Series B', type: 'Equity Round', closeOffset: null, closeFrac: 0.25, amount: 180, preMoney: 640, lead: null, leadType: 'Sovereign Fund', funds: [] },
  { code: 'FUND-GRANT-BHB', name: 'Bright Horizons Breeding Blanket Grant', type: 'Government Grant', closeOffset: null, closeFrac: 0.4, amount: 12, preMoney: null, lead: 'Office of Clean Starlight', leadType: 'Government', funds: ['PRJ-402'] },
  { code: 'FUND-PARTNER-TEU', name: 'Tallgrass Electric Union Partnership', type: 'Strategic Partnership', closeOffset: null, closeFrac: 0.6, amount: 30, preMoney: null, lead: 'Tallgrass Electric Union', leadType: 'Utility', funds: ['PRJ-302', 'PRJ-301'] },
  { code: 'FUND-SERIES-C', name: 'Series C', type: 'Equity Round', closeOffset: null, closeFrac: 0.78, amount: 420, preMoney: 2100, lead: null, leadType: 'Sovereign Fund', funds: [] },
  { code: 'FUND-PPA-PPL', name: 'Pebbleshore Power & Light PPA Prepayment', type: 'PPA Prepayment', closeOffset: null, closeFrac: 0.9, amount: 15, preMoney: null, lead: 'Pebbleshore Power & Light', leadType: 'Utility', funds: ['PRJ-501'] }
]

const SUPPLIERS: Array<{ code: string; name: string; specialty: string; country: string; lead: number; tier: string }> = [
  { code: 'SUP-01', name: 'Coldstream Superconductor Tapes', specialty: 'HTS tape', country: 'Norvania', lead: 75, tier: 'Approved' },
  { code: 'SUP-02', name: 'Anvilworks Precision Winding', specialty: 'Coil winding packs', country: 'Estrovia', lead: 120, tier: 'Preferred' },
  { code: 'SUP-03', name: 'Frostline Cryogenics', specialty: 'Cryostats & cryocoolers', country: 'Norvania', lead: 90, tier: 'Preferred' },
  { code: 'SUP-04', name: 'Quietcurrent Power Systems', specialty: 'Power supplies', country: 'Belmarca', lead: 60, tier: 'Approved' },
  { code: 'SUP-05', name: 'Glintwire Sensors', specialty: 'Diagnostics & sensors', country: 'Estrovia', lead: 30, tier: 'Preferred' },
  { code: 'SUP-06', name: 'Vesselcraft Fabrication', specialty: 'Vacuum vessel segments', country: 'Belmarca', lead: 150, tier: 'Probation' }
]

const COMPONENTS: Array<{ pn: string; name: string; type: string; uom: string; cost: number; crit: string; sup: string; qty: [number, number]; weight: number }> = [
  { pn: 'HTS-12', name: 'REBCO tape 12 mm', type: 'HTS Tape', uom: 'm', cost: 46, crit: 'A', sup: 'SUP-01', qty: [500, 6000], weight: 6 },
  { pn: 'HTS-04', name: 'REBCO tape 4 mm', type: 'HTS Tape', uom: 'm', cost: 19, crit: 'A', sup: 'SUP-01', qty: [500, 8000], weight: 4 },
  { pn: 'HTS-JNT', name: 'Tape joint kit', type: 'HTS Tape', uom: 'set', cost: 2400, crit: 'B', sup: 'SUP-01', qty: [2, 20], weight: 2 },
  { pn: 'WP-TF', name: 'Toroidal-field winding pack', type: 'Winding Pack', uom: 'each', cost: 850000, crit: 'A', sup: 'SUP-02', qty: [1, 2], weight: 1 },
  { pn: 'WP-PF', name: 'Poloidal-field coil pack', type: 'Winding Pack', uom: 'each', cost: 420000, crit: 'A', sup: 'SUP-02', qty: [1, 3], weight: 1 },
  { pn: 'WP-CS', name: 'Central solenoid module', type: 'Winding Pack', uom: 'each', cost: 610000, crit: 'A', sup: 'SUP-02', qty: [1, 2], weight: 0.6 },
  { pn: 'CRY-CC', name: 'Cryocooler head', type: 'Cryostat', uom: 'each', cost: 118000, crit: 'B', sup: 'SUP-03', qty: [1, 4], weight: 2 },
  { pn: 'CRY-TS', name: 'Thermal shield panel', type: 'Cryostat', uom: 'each', cost: 21000, crit: 'B', sup: 'SUP-03', qty: [2, 12], weight: 2 },
  { pn: 'CRY-VAL', name: 'Cryogenic valve set', type: 'Cryostat', uom: 'set', cost: 9400, crit: 'C', sup: 'SUP-03', qty: [1, 6], weight: 2 },
  { pn: 'PS-TF', name: 'TF coil power supply', type: 'Power Supply', uom: 'each', cost: 1150000, crit: 'A', sup: 'SUP-04', qty: [1, 1], weight: 0.5 },
  { pn: 'PS-QPS', name: 'Quench protection switch', type: 'Power Supply', uom: 'each', cost: 64000, crit: 'A', sup: 'SUP-04', qty: [1, 6], weight: 2 },
  { pn: 'PS-CAP', name: 'Capacitor bank module', type: 'Power Supply', uom: 'each', cost: 38000, crit: 'B', sup: 'SUP-04', qty: [2, 10], weight: 1.5 },
  { pn: 'SEN-HALL', name: 'Cryogenic Hall probe', type: 'Sensor', uom: 'each', cost: 1800, crit: 'C', sup: 'SUP-05', qty: [4, 40], weight: 3 },
  { pn: 'SEN-TC', name: 'Cryogenic thermometer', type: 'Sensor', uom: 'each', cost: 950, crit: 'C', sup: 'SUP-05', qty: [10, 80], weight: 3 },
  { pn: 'SEN-SG', name: 'Strain gauge array', type: 'Sensor', uom: 'set', cost: 4200, crit: 'C', sup: 'SUP-05', qty: [2, 12], weight: 2 },
  { pn: 'SEN-BOL', name: 'Bolometer camera', type: 'Sensor', uom: 'each', cost: 56000, crit: 'B', sup: 'SUP-05', qty: [1, 2], weight: 1 },
  { pn: 'VV-SEG', name: 'Vacuum vessel segment', type: 'Vessel', uom: 'each', cost: 290000, crit: 'A', sup: 'SUP-06', qty: [1, 2], weight: 1 },
  { pn: 'VV-PORT', name: 'Port extension', type: 'Vessel', uom: 'each', cost: 44000, crit: 'B', sup: 'SUP-06', qty: [1, 4], weight: 1 },
  { pn: 'VV-DIV', name: 'Divertor cassette', type: 'Vessel', uom: 'each', cost: 175000, crit: 'A', sup: 'SUP-06', qty: [1, 3], weight: 1 }
]

const PPA_PARTIES: Array<[string, string]> = [
  ['Pebbleshore Power & Light', 'Utility'],
  ['Tallgrass Electric Union', 'Utility'],
  ['Brightwater Grid Cooperative', 'Utility'],
  ['Ironvale Data Centers', 'Data Center'],
  ['Saltmarsh Municipal Utility', 'Utility'],
  ['Glimmerbay Aluminium Works', 'Industrial']
]

const TEAMS: Array<{ team: string; roles: Array<[string, number]>; weight: number }> = [
  { team: 'Plasma Ops', roles: [['Plasma Physicist', 0.6], ['Operator', 0.4]], weight: 4 },
  { team: 'Diagnostics', roles: [['Plasma Physicist', 0.4], ['Engineer', 0.3], ['Data Scientist', 0.3]], weight: 2 },
  { team: 'Heating', roles: [['Engineer', 0.6], ['Plasma Physicist', 0.4]], weight: 1.5 },
  { team: 'Magnets', roles: [['Engineer', 0.6], ['Technician', 0.4]], weight: 2.5 },
  { team: 'Cryogenics', roles: [['Engineer', 0.4], ['Technician', 0.6]], weight: 1.2 },
  { team: 'Safety', roles: [['Safety Officer', 1]], weight: 0.6 },
  { team: 'Plant Design', roles: [['Engineer', 0.7], ['Program Manager', 0.3]], weight: 1.5 },
  { team: 'Finance & Admin', roles: [['Program Manager', 1]], weight: 0.8 }
]
const SALARY: Record<string, number> = { 'Plasma Physicist': 128000, Engineer: 112000, Technician: 72000, 'Data Scientist': 118000, Operator: 84000, 'Safety Officer': 96000, 'Program Manager': 124000 }

const VENUES: Record<string, string[]> = {
  'Journal Article': ['Journal of Bottled Stars', 'Plasma Letters Quarterly', 'Annals of Magnetic Confinement'],
  'Conference Paper': ['Proceedings of the Fusion Engineering Symposium', 'Lantern Conference on Plasma Diagnostics'],
  Preprint: ['OpenPlasma Preprints'],
  Patent: ['Patent Office Filing']
}
const TITLE_A = ['Confinement scaling', 'Edge-localised mode control', 'Fast-ion losses', 'Density-limit disruptions', 'Heat exhaust', 'Quench detection', 'Neutron diagnostics', 'Turbulence suppression', 'Tritium retention', 'High-field operation', 'Machine-learning disruption prediction', 'Radiative divertor regimes']
const TITLE_B = ['in a compact high-field tokamak', 'on a spherical tokamak', 'in an optimised stellarator', 'in pulsed Z-pinch plasmas', 'for HTS magnet systems', 'across five devices', 'with real-time control']

interface Staff {
  id: string
  hire: Date
  departure: Date | null
  versions: Scd2Version[]
}

const money = (v: number) => round(v, 2)

function attrsAt(e: Staff, d: Date): Record<string, Scalar> {
  let cur = e.versions[0].attrs
  for (const v of e.versions) if (v.from.getTime() <= d.getTime()) cur = v.attrs
  return cur
}

function* monthsOf(start: Date, end: Date): Generator<Date> {
  for (let d = startOfMonth(start); d.getTime() <= end.getTime(); d = ymd(d.getUTCFullYear(), d.getUTCMonth() + 2, 1)) yield d
}

function ymLabel(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function splitAmount(rng: Rng, total: number, parts: number): number[] {
  const w = Array.from({ length: parts }, () => rng.float(0.3, 1.7))
  const sw = w.reduce((a, b) => a + b, 0)
  const out = w.map((x) => money((total * x) / sw))
  out[out.length - 1] = money(total - out.slice(0, -1).reduce((a, b) => a + b, 0))
  return out
}

// ---------------------------------------------------------------------------------------------

export function* generateSunjar(ctx: GenContext): Generator<Batch> {
  const { start, today } = ctx
  const span = daysBetween(start, today)
  const at = (frac: number) => addDays(start, Math.floor(span * frac))
  const factor = ctx.scale.factor
  const holidays = holidayMap(GENERIC_HOLIDAYS, start.getUTCFullYear(), today.getUTCFullYear())

  // ---- devices & campaigns ------------------------------------------------------------------
  const rd = ctx.rng('devices')
  const devices = (ctx.tiny ? DEVICES.filter((d) => d.code === 'JB1' || d.code === 'LS2') : DEVICES).map((d, i) => ({
    ...d,
    key: i + 1,
    commissioned: d.commissionFrac === null ? addDays(start, -rd.int(400, 2600)) : at(d.commissionFrac)
  }))
  type Device = (typeof devices)[number]
  const deviceByCode = new Map(devices.map((d) => [d.code, d]))
  const quenchDay = at(0.4)
  const quenchEnd = addDays(quenchDay, 42)
  const upgradeDay = at(0.55)
  const tritiumDay = at(0.7)
  const breakevenTarget = at(0.85)
  const driftFrom = at(0.62)
  const driftTo = addDays(driftFrom, 21)
  const v2Day = at(0.5)
  const shortageFrom = at(0.3)
  const shortageTo = at(0.5)

  interface Campaign { key: number; code: string; name: string; device: string; goal: string; start: Date; end: Date; status: string }
  const campaigns: Campaign[] = []
  for (const d of devices) {
    let t = maxDate(d.commissioned, addDays(start, -rd.int(10, 60)))
    let n = 1
    while (t.getTime() <= today.getTime()) {
      const len = rd.int(35, 70)
      const end = addDays(t, len - 1)
      let goal = d.type === 'Magnet Test Stand' ? rd.pick(['Coil qualification', 'Quench characterisation', 'Fatigue cycling', 'Joint resistance']) : rd.pick(GOALS)
      if (d.code === 'JB1' && t.getTime() >= tritiumDay.getTime()) goal = t.getTime() >= at(0.8).getTime() ? 'Breakeven push' : 'D-T readiness'
      if (d.code === 'CK3' && n === 1) goal = 'First-plasma commissioning'
      const aborted = d.code === 'JB1' && quenchDay.getTime() >= t.getTime() && quenchDay.getTime() <= end.getTime()
      campaigns.push({
        key: campaigns.length + 1,
        code: `${d.code}-C${String(n).padStart(2, '0')}`,
        name: `${d.name} C${n} — ${goal}`,
        device: d.code,
        goal,
        start: t,
        end,
        status: aborted ? 'Aborted' : end.getTime() < today.getTime() ? 'Completed' : 'In Progress'
      })
      t = addDays(end, rd.int(14, 35))
      n++
    }
  }
  const campaignOn = (code: string, day: Date) => campaigns.find((c) => c.device === code && day.getTime() >= c.start.getTime() && day.getTime() <= c.end.getTime()) ?? null

  // ---- staff (SCD2) ---------------------------------------------------------------------------
  const rh = ctx.rng('staff')
  const staff: Staff[] = []
  const seriesB = at(0.25)
  const seriesC = at(0.78)
  const teamPicker = () => rh.weighted(TEAMS, TEAMS.map((t) => t.weight))
  const hire = (hireDate: Date, forceRole?: string) => {
    let team = teamPicker()
    if (forceRole) team = TEAMS.find((t) => t.roles.some(([r]) => r === forceRole))!
    const role = forceRole ?? rh.weighted(team.roles.map(([r]) => r), team.roles.map(([, w]) => w))
    const grade = rh.weighted([1, 2, 3, 4, 5, 6], [0.15, 0.3, 0.27, 0.16, 0.08, 0.04])
    const tenure = Math.round(rh.exponential(4.5 * 365)) + 60
    let departure: Date | null = addDays(hireDate, tenure)
    if (departure.getTime() > today.getTime()) departure = null
    const n = personName(rh)
    const site = team.team === 'Cryogenics' || team.team === 'Magnets' || team.team === 'Plasma Ops' ? rh.weighted(['Bellwether Ridge Campus', 'Saltmarsh Annex'], [0.7, 0.3]) : rh.weighted(['Bellwether Ridge Campus', 'Saltmarsh Annex'], [0.55, 0.45])
    const yearsBefore = Math.max(0, start.getUTCFullYear() - hireDate.getUTCFullYear())
    const attrs: Record<string, Scalar> = {
      full_name: n.full,
      role,
      team: team.team,
      grade: `L${grade}`,
      grade_level: grade,
      annual_salary: Math.round((SALARY[role] * (0.85 + 0.17 * grade) * rh.float(0.94, 1.06)) / Math.pow(1.035, yearsBefore) / 100) * 100,
      site,
      employment_status: 'Active',
      hire_date: dateOnly(hireDate)
    }
    const last = departure ?? today
    const events: Array<{ at: Date; apply: (p: Record<string, Scalar>) => Record<string, Scalar> }> = []
    for (let y = hireDate.getUTCFullYear(); y <= last.getUTCFullYear(); y++) {
      const merit = ymd(y, 7, 1)
      if (merit.getTime() > hireDate.getTime() + 120 * 86_400_000 && merit.getTime() < last.getTime()) {
        const pct = rh.float(1.025, 1.045)
        events.push({ at: merit, apply: (p) => ({ ...p, annual_salary: Math.round(((p.annual_salary as number) * pct) / 100) * 100 }) })
      }
    }
    const tenureDays = daysBetween(hireDate, last)
    let tcur = 0
    for (;;) {
      tcur += Math.round(rh.exponential(2.6 * 365))
      if (tcur >= tenureDays) break
      if (tcur < 180) continue
      events.push({
        at: addDays(hireDate, tcur),
        apply: (p) => {
          const g = Math.min(6, (p.grade_level as number) + 1)
          return { ...p, grade: `L${g}`, grade_level: g, annual_salary: Math.round(((p.annual_salary as number) * 1.1) / 100) * 100 }
        }
      })
    }
    if (tenureDays > 200 && rh.chance(0.12) && role !== 'Safety Officer') {
      const nt = rh.pick(TEAMS.filter((t) => t.team !== team.team && t.roles.some(([r]) => r === role)).concat(team))
      events.push({ at: addDays(hireDate, rh.int(150, tenureDays - 1)), apply: (p) => ({ ...p, team: nt.team }) })
    }
    events.sort((a, b) => a.at.getTime() - b.at.getTime())
    if (departure) events.push({ at: departure, apply: (p) => ({ ...p, employment_status: 'Departed' }) })
    const versions: Scd2Version[] = [{ from: dateOnly(hireDate), attrs }]
    for (const ev of events) versions.push({ from: dateOnly(ev.at), attrs: ev.apply(versions[versions.length - 1].attrs) })
    staff.push({ id: `SJ-${String(staff.length + 1).padStart(4, '0')}`, hire: dateOnly(hireDate), departure: departure ? dateOnly(departure) : null, versions })
  }
  const initial = ctx.tiny ? 22 : 85
  for (let i = 0; i < initial; i++) hire(addDays(start, -rh.int(20, 2600)), i < (ctx.tiny ? 4 : 10) ? 'Plasma Physicist' : undefined)
  for (const m of monthsOf(start, today)) {
    const burst = (m.getTime() >= seriesB.getTime() && m.getTime() < addDays(seriesB, 180).getTime()) || (m.getTime() >= seriesC.getTime() && m.getTime() < addDays(seriesC, 180).getTime())
    const k = rh.poisson((ctx.tiny ? 0.5 : 1.3) + (burst ? (ctx.tiny ? 1 : 3.5) : 0))
    for (let i = 0; i < k; i++) {
      const d = addDays(m, rh.int(0, 27))
      if (d.getTime() <= today.getTime()) hire(d)
    }
  }
  const staffRows = scd2Rows(staff.map((s) => ({ businessKey: s.id, versions: s.versions })), { skColumn: 'staff_sk', bkColumn: 'staff_id' })
  const staffIdx = new Scd2Index(staffRows, 'staff_sk', 'staff_id')
  const activeOn = (s: Staff, d: Date) => s.hire.getTime() <= d.getTime() && (!s.departure || s.departure.getTime() > d.getTime())
  const physCache = new Map<number, Staff[]>()
  const physicists = (d: Date): Staff[] => {
    const k = monthKey(d)
    let list = physCache.get(k)
    if (!list) {
      const mid = minDate(ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, 15), today)
      list = staff.filter((s) => activeOn(s, mid) && attrsAt(s, mid).role === 'Plasma Physicist')
      if (!list.length) list = staff.filter((s) => activeOn(s, mid))
      if (!list.length) list = [staff[0]]
      physCache.set(k, list)
    }
    return list
  }

  // ---- projects, milestones, accounts, budgets --------------------------------------------------
  const rp = ctx.rng('projects')
  const projects = PROJECTS.filter((p) => !ctx.tiny || TINY_PROJECTS.has(p.code)).map((p, i) => {
    const s = p.startFrac === null ? addDays(start, -rp.int(100, 700)) : at(p.startFrac)
    return { ...p, key: i + 1, start: dateOnly(startOfMonth(s)), end: endOfMonth(addDays(s, Math.round(p.years * 365))), manager: personName(rp).full }
  })
  const projectByCode = new Map(projects.map((p) => [p.code, p]))
  const accountKey = new Map(ACCOUNTS.map(([code], i) => [code, i + 1]))
  const milestones: Row[] = []
  const msStats = new Map<string, { planned: number; done: number; slips: number[] }>()
  for (const p of projects) {
    const n = rp.int(4, 8)
    const st = { planned: n, done: 0, slips: [] as number[] }
    const length = daysBetween(p.start, p.end)
    for (let k = 1; k <= n; k++) {
      const baseline = addDays(p.start, Math.round((length * k) / (n + 1)))
      let slip = Math.round(rp.normal(12, 22))
      if ((p.code === 'PRJ-201' || p.code === 'PRJ-103') && baseline.getTime() > shortageFrom.getTime()) slip += rp.int(30, 90)
      if (p.code === 'PRJ-101' && baseline.getTime() > quenchDay.getTime() && baseline.getTime() < addDays(quenchDay, 200).getTime()) slip += 45
      const forecast = addDays(baseline, slip)
      const done = forecast.getTime() <= today.getTime()
      if (done) {
        st.done++
        st.slips.push(slip)
      }
      milestones.push({
        milestone_id: `${p.code}-M${k}`, project_code: p.code, milestone_name: `${p.name.split(' ')[0]} milestone ${k}: ${rp.pick(['design review', 'procurement complete', 'installation', 'commissioning', 'first results', 'safety sign-off', 'integrated test'])}`,
        baseline_date: baseline, forecast_date: forecast, completed_date: done ? forecast : null, slip_days: slip
      })
    }
    msStats.set(p.code, st)
  }
  const rb = ctx.rng('budget')
  const budget = new Map<string, number>() // project|account|monthKey
  const shares = new Map<string, Map<string, number>>()
  for (const p of projects) {
    const w = p.accounts.map((a) => (a === '6100' ? 3 : a === '1600' ? 2.5 : a === '1500' ? 1.5 : rb.float(0.4, 1.2)))
    const sw = w.reduce((x, y) => x + y, 0)
    shares.set(p.code, new Map(p.accounts.map((a, i) => [a, w[i] / sw])))
  }
  const fyFirst = fiscalYear(start, 7)
  const fyLast = fiscalYear(ctx.calendarEnd, 7)
  const fyStart = (fy: number) => ymd(fy - 1, 7, 1)
  for (let fy = fyFirst; fy <= fyLast; fy++) {
    for (const p of projects) {
      const growth = 1 + 0.05 * (fy - fyFirst)
      for (const a of p.accounts) {
        for (let m = 0; m < 12; m++) {
          const month = ymd(fy - 1, 7 + m, 1)
          if (month.getTime() < p.start.getTime() || month.getTime() > p.end.getTime()) continue
          const ramp = Math.min(1, 0.4 + daysBetween(p.start, month) / 240)
          const amt = Math.round((p.annual * 1e6 * shares.get(p.code)!.get(a)! * growth * ramp * rb.float(0.85, 1.15)) / 12 / 100) * 100
          budget.set(`${p.code}|${a}|${monthKey(month)}`, amt)
        }
      }
    }
  }

  // ---- funding ----------------------------------------------------------------------------------
  const rf = ctx.rng('funding')
  const investorPool = orgNames(rf, 24, ['Ventures', 'Capital', 'Partners', 'Fund', 'Family Office'])
  const investorType = new Map(investorPool.map((n) => [n, n.endsWith('Family Office') ? 'Family Office' : rf.weighted(['Venture Capital', 'Sovereign Fund', 'Corporate'], [0.65, 0.15, 0.2])]))
  const funding = FUNDING.map((f, i) => ({ ...f, key: i + 1, close: dateOnly(f.closeFrac !== null ? at(f.closeFrac) : addDays(start, f.closeOffset!)) }))
  const commitments: Row[] = []
  const investorCount = new Map<string, number>()
  for (const f of funding) {
    const total = f.amount * 1e6
    if (f.type !== 'Equity Round') {
      commitments.push({ funding_code: f.code, investor_name: f.lead!, investor_type: f.leadType, is_lead: true, amount: total })
      investorCount.set(f.code, 1)
      continue
    }
    const names = rf.sample(investorPool, rf.int(4, 8))
    const leadShare = rf.float(0.3, 0.45)
    const rest = splitAmount(rf, total * (1 - leadShare), names.length - 1)
    const leadAmt = money(total - rest.reduce((a, b) => a + b, 0))
    names.forEach((n, k) => commitments.push({ funding_code: f.code, investor_name: n, investor_type: k === 0 && f.leadType === 'Sovereign Fund' ? 'Sovereign Fund' : investorType.get(n)!, is_lead: k === 0, amount: k === 0 ? leadAmt : rest[k - 1] }))
    investorCount.set(f.code, names.length)
  }
  const leadOf = (code: string) => commitments.find((c) => c.funding_code === code && c.is_lead)!.investor_name as string
  const charged = new Map<string, number>()
  const fundingFor = (projectCode: string | null, monthEnd: Date, amount: number): number => {
    if (projectCode) {
      for (const f of funding) {
        if (!f.funds.includes(projectCode) || f.close.getTime() > monthEnd.getTime()) continue
        const used = charged.get(f.code) ?? 0
        if (used + amount <= f.amount * 1e6) {
          charged.set(f.code, used + amount)
          return f.key
        }
      }
    }
    const eq = funding.filter((f) => f.type === 'Equity Round' && f.close.getTime() <= monthEnd.getTime())
    const f = eq[eq.length - 1]
    charged.set(f.code, (charged.get(f.code) ?? 0) + amount)
    return f.key
  }

  // ---- suppliers, components, PPAs, publications ---------------------------------------------
  const supplierKey = new Map(SUPPLIERS.map((s, i) => [s.code, i + 1]))
  const componentKey = new Map(COMPONENTS.map((c, i) => [c.pn, i + 1]))
  const rppa = ctx.rng('ppa')
  const nPpa = ctx.tiny ? 3 : 6
  const ppas = PPA_PARTIES.slice(0, nPpa).map(([party, type], i) => {
    const signed = at(clamp(0.1 + (0.85 * (i + rppa.float(0, 0.8))) / nPpa, 0.02, 0.98))
    const confidential = rppa.chance(0.25) || i === 0
    return {
      key: i + 1, code: `PPA-${String(i + 1).padStart(3, '0')}`, party, type, signed: dateOnly(signed), deliveryStart: rppa.int(2033, 2036), term: rppa.pick([10, 12, 15, 20]),
      capacity: rppa.pick([25, 50, 75, 100, 150, 200]), price: confidential ? null : money(rppa.float(68, 112)), status: i === nPpa - 1 ? 'Conditional' : rppa.chance(0.12) ? 'Terminated' : 'Signed', confidential
    }
  })
  const rpub = ctx.rng('publications')
  const nPub = ctx.n(60, 8)
  const pubs: Array<{ key: number; id: string; title: string; venue: string; type: string; date: Date; citations: number; authors: Array<{ staff: Staff; pos: number; corr: boolean }> }> = []
  for (let i = 0; i < nPub; i++) {
    let date = dateOnly(addDays(start, rpub.int(0, span)))
    const breakevenPaper = i === nPub - 1
    if (breakevenPaper) date = dateOnly(minDate(today, addDays(breakevenTarget, rpub.int(30, 60))))
    const type = breakevenPaper ? 'Journal Article' : rpub.weighted(['Journal Article', 'Conference Paper', 'Preprint', 'Patent'], [0.45, 0.3, 0.17, 0.08])
    const pool = staff.filter((s) => activeOn(s, date))
    const phys = pool.filter((s) => ['Plasma Physicist', 'Data Scientist', 'Engineer'].includes(attrsAt(s, date).role as string))
    const k = Math.min(phys.length || pool.length, rpub.int(2, breakevenPaper ? 9 : 7))
    const chosen = rpub.sample(phys.length ? phys : pool, k)
    const age = daysBetween(date, today) / 365
    const quality = breakevenPaper ? 30 : rpub.logNormal(4, 0.8)
    pubs.push({
      key: i + 1,
      id: `SJ-PUB-${String(i + 1).padStart(4, '0')}`,
      title: breakevenPaper ? 'Scientific breakeven in a compact high-field tokamak' : `${rpub.pick(TITLE_A)} ${rpub.pick(TITLE_B)}`,
      venue: rpub.pick(VENUES[type]),
      type,
      date,
      citations: type === 'Patent' ? 0 : rpub.poisson(Math.max(0, age) * quality + (breakevenPaper ? 40 : 0)),
      authors: chosen.map((s, j) => ({ staff: s, pos: j + 1, corr: j === 0 }))
    })
  }
  pubs.sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id))

  // ---- static batch ----------------------------------------------------------------------------
  const T0: Record<string, Row[]> = {}
  const B0: BronzeFile[] = []
  T0.gold_dim_device = devices.map((d) => ({
    device_key: d.key, device_code: d.code, device_name: d.name, device_type: d.type, confinement_concept: d.type === 'Z-Pinch' ? 'Pulsed' : d.type === 'Magnet Test Stand' ? 'None' : 'Magnetic',
    site: d.site, building: d.building, commissioned_date: dateOnly(d.commissioned), major_radius_m: d.radius, max_field_tesla: d.field, plasma_volume_m3: d.volume,
    device_status: daysBetween(d.commissioned, today) < 90 ? 'Commissioning' : 'Operating'
  }))
  T0.silver_devices = devices.map((d) => ({ device_code: d.code, device_name: d.name, device_type: d.type, site: d.site, building: d.building, commissioned_date: dateOnly(d.commissioned), major_radius_m: d.radius, max_field_tesla: d.field, plasma_volume_m3: d.volume }))
  T0.gold_dim_campaign = [
    { campaign_key: -1, campaign_code: 'NONE', campaign_name: 'No Campaign', device_code: 'n/a', physics_goal: 'n/a', start_date: null, end_date: null, campaign_status: 'n/a' },
    ...campaigns.map((c) => ({ campaign_key: c.key, campaign_code: c.code, campaign_name: c.name, device_code: c.device, physics_goal: c.goal, start_date: c.start, end_date: c.end, campaign_status: c.status }))
  ]
  T0.silver_campaigns = campaigns.map((c) => ({ campaign_code: c.code, device_code: c.device, campaign_name: c.name, physics_goal: c.goal, start_date: c.start, end_date: c.end, campaign_status: c.status }))
  B0.push(
    { source: 'registry', path: 'operations/device_register.json', format: 'json', rows: T0.silver_devices.map((r) => ({ ...r }) as BronzeRow), json: { envelope: { system: 'run-planner', exported: formatDate(today, 'iso_t') }, dataKey: 'devices' } },
    { source: 'registry', path: 'operations/campaign_plan.json', format: 'json', rows: T0.silver_campaigns.map((r) => ({ ...r }) as BronzeRow), json: { envelope: { system: 'run-planner', exported: formatDate(today, 'iso_t') }, dataKey: 'campaigns' } }
  )
  const profileKey = (h: string, f: string, m: string) => HEATING.indexOf(h) * FUELS.length * MODES.length + FUELS.indexOf(f) * MODES.length + MODES.indexOf(m) + 1
  T0.gold_dim_shot_profile = []
  for (const h of HEATING) for (const f of FUELS) for (const m of MODES) T0.gold_dim_shot_profile.push({ profile_key: profileKey(h, f, m), heating_scheme: h, fuel: f, shot_mode: m, shot_mode_order: MODES.indexOf(m) + 1 })
  T0.gold_dim_shot_outcome = OUTCOMES.map(([o, g, t], i) => ({ outcome_key: i + 1, outcome: o, outcome_group: g, disruption_type: t }))
  T0.gold_dim_staff = staffRows
  T0.gold_dim_project = [
    { project_key: -1, project_code: 'UNALLOCATED', project_name: 'Unallocated Overhead', program: 'Overhead', project_manager: 'Finance', start_date: null, planned_end_date: null, project_status: 'Overhead', milestones_planned: 0, milestones_completed: 0, schedule_slip_days: null },
    ...projects.map((p) => {
      const st = msStats.get(p.code)!
      return {
        project_key: p.key, project_code: p.code, project_name: p.name, program: p.program, project_manager: p.manager, start_date: p.start, planned_end_date: p.end,
        project_status: p.end.getTime() < today.getTime() ? 'Completed' : p.start.getTime() > today.getTime() ? 'On Hold' : 'Active',
        milestones_planned: st.planned, milestones_completed: st.done, schedule_slip_days: st.slips.length ? Math.round(st.slips.reduce((a, b) => a + b, 0) / st.slips.length) : null
      }
    })
  ]
  T0.silver_projects = projects.map((p) => ({ project_code: p.code, project_name: p.name, program: p.program, project_manager: p.manager, start_date: p.start, planned_end_date: p.end }))
  T0.silver_milestones = milestones
  B0.push({
    source: 'pmo', path: 'pmo/projects.json', format: 'json',
    rows: projects.map((p) => ({ code: p.code, name: p.name, program: p.program, manager: p.manager, start: p.start, baselineEnd: p.end, milestones: milestones.filter((m) => m.project_code === p.code).map((m) => ({ id: m.milestone_id as string, name: m.milestone_name as string, baseline: m.baseline_date as Date, forecast: m.forecast_date as Date, done: m.completed_date !== null })) })),
    json: { envelope: { tool: 'pmo-portfolio', version: 3 }, dataKey: 'projects' }
  })
  T0.gold_dim_gl_account = ACCOUNTS.map(([code, name, group, cls], i) => ({ account_key: i + 1, account_code: code, account_name: name, account_group: group, account_class: cls }))
  T0.silver_gl_accounts = ACCOUNTS.map(([code, name, group, cls]) => ({ account_code: code, account_name: name, account_group: group, account_class: cls }))
  T0.gold_dim_funding_source = funding.map((f) => ({
    funding_source_key: f.key, funding_code: f.code, funding_name: f.name, source_type: f.type, lead_investor: leadOf(f.code), close_date: f.close,
    committed_amount: f.amount * 1e6, pre_money_valuation: f.preMoney === null ? null : f.preMoney * 1e6, investor_count: investorCount.get(f.code)!
  }))
  T0.silver_funding_sources = funding.map((f) => ({ funding_code: f.code, funding_name: f.name, source_type: f.type, close_date: f.close, committed_amount: f.amount * 1e6, pre_money_valuation: f.preMoney === null ? null : f.preMoney * 1e6 }))
  T0.silver_funding_commitments = commitments
  const fundRows: BronzeRow[] = funding.map((f) => ({
    code: f.code, name: f.name, source_type: f.type, closed: f.close, total_usd: f.amount * 1e6, pre_money_usd: f.preMoney === null ? null : f.preMoney * 1e6,
    commitments: commitments.filter((c) => c.funding_code === f.code).map((c) => ({ investor: c.investor_name as string, type: c.investor_type as string, lead: c.is_lead as boolean, usd: c.amount as number }))
  }))
  injectCasing(fundRows, 'source_type', { rng: rf, sink: ctx, code: 'SJ14', rate: 0.3, atLeast: 2 })
  B0.push({ source: 'funding', path: 'investor_relations/cap_table.json', format: 'json', rows: fundRows, json: { envelope: { company: 'Sunjar Fusion Labs', asOf: isoDate(today), currency: 'USD' }, dataKey: 'fundingSources' } })

  T0.gold_dim_supplier = SUPPLIERS.map((s, i) => ({ supplier_key: i + 1, supplier_code: s.code, supplier_name: s.name, specialty: s.specialty, country: s.country, contract_lead_time_days: s.lead, quality_tier: s.tier }))
  T0.silver_suppliers = SUPPLIERS.map((s) => ({ supplier_code: s.code, supplier_name: s.name, specialty: s.specialty, country: s.country, contract_lead_time_days: s.lead, quality_tier: s.tier }))
  const supName = new Map(SUPPLIERS.map((s) => [s.code, s.name]))
  T0.gold_dim_component = COMPONENTS.map((c, i) => ({ component_key: i + 1, part_number: c.pn, component_name: c.name, component_type: c.type, unit_of_measure: c.uom, standard_cost: c.cost, criticality: c.crit, supplier_name: supName.get(c.sup)! }))
  T0.silver_components = COMPONENTS.map((c) => ({ part_number: c.pn, component_name: c.name, component_type: c.type, unit_of_measure: c.uom, standard_cost: c.cost, criticality: c.crit, supplier_code: c.sup }))
  const semi = { delimiter: ';', bom: true, lineEnding: '\r\n' as const }
  B0.push(
    { source: 'procurement_master', path: 'procurement/suppliers.csv', format: 'csv', csv: semi, rows: T0.silver_suppliers.map((r) => ({ ...r }) as BronzeRow) },
    { source: 'procurement_master', path: 'procurement/components.csv', format: 'csv', csv: semi, rows: T0.silver_components.map((r) => ({ ...r }) as BronzeRow) }
  )

  T0.gold_dim_ppa = ppas.map((p) => ({ ppa_key: p.key, ppa_code: p.code, counterparty: p.party, counterparty_type: p.type, signed_date_key: dateKey(p.signed), delivery_start_year: p.deliveryStart, term_years: p.term, capacity_mw: p.capacity, price_per_mwh: p.price, ppa_status: p.status }))
  T0.silver_ppas = ppas.map((p) => ({ ppa_code: p.code, counterparty: p.party, counterparty_type: p.type, signed_date: p.signed, delivery_start_year: p.deliveryStart, term_years: p.term, capacity_mw: p.capacity, price_per_mwh: p.price, ppa_status: p.status }))
  B0.push({
    source: 'ppa', path: 'commercial/ppa_register.csv', format: 'csv',
    rows: ppas.map((p) => {
      if (p.confidential) ctx.issue('SJ17')
      return { contract: p.code, counterparty: p.party, segment: p.type, signed: p.signed, delivery_start: p.deliveryStart, term_years: p.term, capacity_mw: p.capacity, price_usd_mwh: p.confidential ? rppa.pick(['', 'N/A', null] as Array<string | null>) : p.price, status: p.status }
    })
  })

  T0.gold_dim_publication = pubs.map((p) => ({ publication_key: p.key, publication_id: p.id, title: p.title, venue: p.venue, publication_type: p.type, published_date: p.date, author_count: p.authors.length, citations: p.citations }))
  T0.silver_publications = pubs.map((p) => ({ publication_id: p.id, title: p.title, venue: p.venue, publication_type: p.type, published_date: p.date, citations: p.citations }))
  T0.gold_bridge_publication_author = []
  T0.silver_publication_authors = []
  for (const p of pubs) {
    for (const a of p.authors) {
      T0.gold_bridge_publication_author.push({ publication_key: p.key, staff_sk: staffIdx.lookup(a.staff.id, p.date)!, author_position: a.pos, is_corresponding: a.corr })
      T0.silver_publication_authors.push({ publication_id: p.id, staff_id: a.staff.id, author_position: a.pos, is_corresponding: a.corr })
    }
  }
  const pubRows: BronzeRow[] = pubs.map((p) => ({ id: p.id, title: p.title, venue: p.venue, type: p.type, published: p.date, citations: p.citations, authors: p.authors.map((a) => ({ staff_id: a.staff.id, position: a.pos, corresponding: a.corr })) }))
  B0.push({ source: 'publications', path: 'research/publications.json', format: 'json', rows: injectDuplicates(pubRows, { rng: rpub, sink: ctx, code: 'SJ16', rate: 0.06, atLeast: 1 }), json: { envelope: { exportedBy: 'BiblioJar', format: 'v2' }, dataKey: 'records' } })

  // budget workbooks (wide) + silver unpivot
  T0.silver_budget_monthly = []
  const monthCols = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
  for (let fy = fyFirst; fy <= fyLast; fy++) {
    const rows: BronzeRow[] = []
    for (const p of projects) {
      for (const a of p.accounts) {
        const vals: number[] = []
        for (let m = 0; m < 12; m++) {
          const month = ymd(fy - 1, 7 + m, 1)
          const v = budget.get(`${p.code}|${a}|${monthKey(month)}`) ?? 0
          vals.push(v)
          if (v) T0.silver_budget_monthly.push({ fiscal_year: fy, project_code: p.code, account_code: a, month_start: month, budget_amount: v })
        }
        if (vals.every((v) => v === 0)) continue
        const r: BronzeRow = { Project: p.code, 'Project Name': p.name, Account: a }
        monthCols.forEach((mc, i) => (r[mc] = vals[i]))
        r.Total = vals.reduce((x, y) => x + y, 0)
        rows.push(r)
      }
    }
    B0.push({ source: 'budget', path: `finance/budget/budget_FY${String(fy).slice(2)}.xlsx`, format: 'xlsx', rows, xlsx: { sheet: `FY${String(fy).slice(2)} Budget`, titleLines: [`Sunjar Fusion Labs — FY${String(fy).slice(2)} approved budget`, `Fiscal year ${isoDate(fyStart(fy))} to ${isoDate(addDays(fyStart(fy + 1), -1))} · USD`] } })
  }
  T0.silver_diagnostic_channels = []
  for (const d of devices) for (const [suf, diag, qty, unit] of d.channels) T0.silver_diagnostic_channels.push({ channel_code: `${d.code}-${suf}`, device_code: d.code, diagnostic: diag, quantity: qty, unit })
  yield { label: 'static', tables: T0, bronze: B0 }

  // ---- simulation state ------------------------------------------------------------------------
  const rng = ctx.rng('sim')
  const shotNo = new Map(devices.map((d) => [d.code, rd.int(8000, 40000)]))
  const bestTriple = new Map<string, number>()
  const perfAt = (d: Device, day: Date) => {
    const age = daysBetween(d.commissioned, day)
    let p = 0.75 + 0.45 * (1 - Math.exp(-age / 600))
    if (d.code === 'JB1' && day.getTime() >= upgradeDay.getTime()) p *= 1.18
    return p
  }
  for (const d of devices) if (d.type !== 'Magnet Test Stand') {
    const ph = PHYS[d.type as Exclude<DeviceType, 'Magnet Test Stand'>]
    const p = perfAt(d, start)
    bestTriple.set(d.code, ph.ne * Math.pow(p, 0.3) * ph.te * Math.pow(p, 0.8) * (ph.tau * Math.pow(p, 0.9)) / 1000 * 1.35)
  }
  let breakevenDone = false
  const pendingShots = new Map<string, BronzeRow[]>()
  let firstShotFile = true
  let firstDiagFile = true
  let driftLogged = false
  let orderSeq = 0
  let journalSeq = 0
  let inspSeq = 0
  const orderRate = 0.85 * clamp(factor, 0.3, 4)
  const rv = ctx.rng('orders')
  const ri = ctx.rng('inspections')
  const ra = ctx.rng('actuals')
  const vendors = orgNames(ra, 12, ['Services', 'Supply', 'Systems', 'Engineering', 'Logistics'])
  let tc0Planted = false
  let receivedPlanted = false

  for (const monthStart of monthsOf(start, today)) {
    const monthEnd = minDate(endOfMonth(monthStart), today)
    const ym = ymLabel(monthStart)
    const y = monthStart.getUTCFullYear()
    const T: Record<string, Row[]> = {
      gold_fact_shot: [], silver_shots: [], silver_diagnostic_readings: [], gold_fact_device_day: [], silver_device_ops_daily: [], silver_inspections: [],
      gold_fact_finance_month: [], silver_gl_lines: [], silver_staff_snapshots: [], gold_fact_component_order: [], silver_component_orders: []
    }
    const bronze: BronzeFile[] = []
    const opsRows: BronzeRow[] = []
    const inspRows: BronzeRow[] = []
    const orderRows: BronzeRow[] = []

    for (const day of eachDay(monthStart, monthEnd)) {
      const dk = dateKey(day)
      const weekday = isoDow(day) <= 5 && !holidays.has(dk)
      for (const d of devices) {
        if (day.getTime() < dateOnly(d.commissioned).getTime()) continue
        const camp = campaignOn(d.code, day)
        const outage = d.code === 'JB1' && day.getTime() >= quenchDay.getTime() && day.getTime() < quenchEnd.getTime()
        const quenchToday = d.code === 'JB1' && dk === dateKey(quenchDay)
        const running = !!camp && weekday && (!outage || quenchToday)
        const status = quenchToday ? 'Outage' : outage ? 'Outage' : running ? 'Running' : camp ? 'Idle' : 'Maintenance'
        const commissioning = daysBetween(d.commissioned, day) < 60
        let nShots = 0
        let good = 0
        let disr = 0
        let energyIn = 0
        let lastShotAt: Date | null = null
        if (running) {
          const leader = rng.pick(physicists(day))
          const leaderSk = staffIdx.lookup(leader.id, day)!
          let n = rng.poisson(d.rate * factor * (commissioning ? 0.4 : 1) * rng.float(0.7, 1.2))
          if (quenchToday) n = Math.max(3, Math.floor(n / 3))
          const forceBreakeven = d.code === 'JB1' && !breakevenDone && day.getTime() >= breakevenTarget.getTime()
          if (forceBreakeven) n = Math.max(n, 1)
          const times: Date[] = []
          for (let k = 0; k < n; k++) times.push(new Date(day.getTime() + (8 * 3600 + rng.int(0, 11 * 3600)) * 1000))
          times.sort((a, b) => a.getTime() - b.getTime())
          const ph = d.type === 'Magnet Test Stand' ? null : PHYS[d.type as Exclude<DeviceType, 'Magnet Test Stand'>]
          const perf = perfAt(d, day)
          const jitter = d.code === 'JB1' && day.getTime() >= quenchEnd.getTime() && day.getTime() < addDays(quenchEnd, 30).getTime() ? 2.5 : 1
          times.forEach((t, k) => {
            const num = shotNo.get(d.code)! + 1
            shotNo.set(d.code, num)
            const shotId = `${d.code}-${String(num).padStart(6, '0')}`
            const isBreakeven = forceBreakeven && k === times.length - 1
            let mi = commissioning ? 0 : rng.weighted([0, 1, 2, 3], [0.15, 0.4, 0.4, 0.05])
            if (isBreakeven) mi = 3
            const heating = rng.weighted(d.heating.map(([h]) => h), d.heating.map(([, w]) => w))
            const fuel = d.type === 'Magnet Test Stand' ? 'None' : isBreakeven || (d.code === 'JB1' && day.getTime() >= tritiumDay.getTime() && rng.chance(0.25)) ? 'D-T' : d.code === 'SD4' && rng.chance(0.05) ? 'D-He3' : 'D-D'
            const mode = MODES[mi]
            let outcomeIdx = 0
            let te: number | null = null
            let ne: number | null = null
            let tau: number | null = null
            let heat: number
            let dur: number
            let fusion: number | null = null
            let q: number | null = null
            let triple: number | null = null
            let neutrons: number | null = null
            if (!ph) {
              // magnet test stand: coil energisation
              heat = round(rng.float(2, 9), 2)
              dur = round(rng.logNormal(60000, 0.4), 1)
              outcomeIdx = rng.chance(0.03 * MODE_MULT[mi]) ? 8 : rng.chance(0.03) ? 6 : 0
              if (outcomeIdx === 8) dur = round(dur * rng.float(0.3, 0.9), 1)
            } else {
              const pm = perf * MODE_MULT[mi]
              te = ph.te * Math.pow(pm, 0.8) * rng.logNormal(1, 0.12)
              ne = ph.ne * Math.pow(pm, 0.3) * rng.logNormal(1, 0.15)
              tau = ph.tau * Math.pow(pm, 0.9) * rng.logNormal(1, 0.18)
              heat = ph.heat * (0.6 + 0.4 * pm) * rng.logNormal(1, 0.1)
              dur = ph.dur * rng.logNormal(1, 0.25) * (d.type === 'Stellarator' ? pm : 1)
              if (isBreakeven) {
                te = ph.te * 1.75
                ne = ph.ne * 1.15
                tau = (3.15 / (te * ne)) * 1000
                heat = ph.heat * 1.1
              }
              triple = (ne * te * tau) / 1000
              // nobody crosses breakeven before the planted record shot
              const ceiling = breakevenDone ? 3.6 : 2.7
              if (!isBreakeven && triple > ceiling) {
                tau *= (ceiling * rng.float(0.9, 1)) / triple
                triple = (ne * te * tau) / 1000
              }
              const fuelFactor = fuel === 'D-T' ? 1 : fuel === 'D-He3' ? 0.002 : 0.004
              q = Math.min(2, fuelFactor * Math.pow(triple / 3, 1.6))
              const pDisrupt = isBreakeven ? 0 : MODE_DISRUPT[mi] * jitter * (ne > ph.ne * 1.25 ? 1.8 : 1)
              const u = rng.next()
              if (u < pDisrupt) {
                outcomeIdx = ne > ph.ne * 1.25 && rng.chance(0.6) ? 4 : rng.weighted([2, 3, 5], [0.4, 0.35, 0.25])
                dur *= rng.float(0.15, 0.8)
              } else if (u < pDisrupt + 0.025) {
                outcomeIdx = rng.chance(0.6) ? 6 : 7
                dur *= rng.float(0.05, 0.3)
              } else if (!isBreakeven && rng.chance(0.12 + 0.1 * (mi === 3 ? 1 : 0))) outcomeIdx = 1
              if (quenchToday && k === times.length - 1) {
                outcomeIdx = 8
                dur *= 0.4
              }
              te = round(te, 3)
              ne = round(ne, 4)
              tau = round(tau, 5)
              triple = round((ne * te * tau) / 1000, 6)
              q = round(q, 6)
              heat = round(heat, 3)
              fusion = round(q * heat, 6)
              dur = round(dur, 4)
            }
            heat = round(heat, 3)
            q = q === null ? null : round(fusion! / heat, 6)
            const eIn = round((heat * dur) / 1000, 4)
            const eOut = fusion === null ? null : round((fusion * dur) / 1000, 6)
            neutrons = eOut === null ? null : round(eOut * (fuel === 'D-T' ? 355000 : fuel === 'D-He3' ? 6000 : 120000), 3)
            // τE sentinel (lossy) decided before silver/gold
            const sentinel = ph !== null && (rng.chance(0.025) || (firstShotFile && k === 0))
            if (sentinel) ctx.issue('SJ04')
            const tauOut = sentinel ? null : tau
            const tripleOut = sentinel ? null : triple
            let record = false
            if (tripleOut !== null && outcomeIdx <= 1) {
              const best = bestTriple.get(d.code) ?? 0
              if (tripleOut > best) {
                bestTriple.set(d.code, tripleOut)
                record = true
              }
            }
            if (isBreakeven) breakevenDone = true
            const isDisr = outcomeIdx >= 2 && outcomeIdx <= 5
            nShots++
            if (outcomeIdx === 0) good++
            if (isDisr) disr++
            energyIn += eIn
            lastShotAt = t
            const camp2 = camp!
            const [oc, , dtype] = OUTCOMES[outcomeIdx]
            T.gold_fact_shot.push({
              shot_id: shotId, shot_number: num, shot_date: day, date_key: dk, time_key: timeKey(t), device_key: d.key, campaign_key: camp2.key, profile_key: profileKey(heating, fuel, mode),
              outcome_key: outcomeIdx + 1, physicist_sk: leaderSk, duration_ms: dur, peak_temp_kev: te, density_1e20: ne, confinement_ms: tauOut, triple_product: tripleOut,
              heating_power_mw: heat, fusion_power_mw: fusion, q_factor: q, energy_in_mj: eIn, energy_out_mj: eOut, neutron_yield_1e12: neutrons, is_record: record, is_disruption: isDisr
            })
            T.silver_shots.push({
              shot_id: shotId, device_code: d.code, shot_time: t, shot_date: day, campaign_code: camp2.code, session_leader_id: leader.id, heating_scheme: heating, fuel, shot_mode: mode,
              outcome: oc, disruption_type: dtype, duration_ms: dur, peak_te_kev: te, density_1e20: ne, tau_e_ms: tauOut, heating_mw: heat, fusion_mw: fusion
            })
            const v2 = t.getTime() >= v2Day.getTime()
            const br: BronzeRow = { shot_id: shotId, device: d.code, shot_time: t, campaign: camp2.code, leader: leader.id, heating, mode, outcome: oc, disruption: dtype, duration_ms: dur }
            if (v2) {
              br.peak_te_kev = te
              br.ne_1e20 = ne
              br.tau_e_ms = sentinel ? -1 : tau
              br.p_heat_mw = heat
              br.fusion_mw = fusion
              br.fuel = fuel
            } else {
              br.te_kev = te
              br.ne_1e20 = ne
              br.tau_e_ms = sentinel ? -1 : tau
              br.heating_mw = heat
              br.fusion_mw = fusion
            }
            const land = minDate(landingDay(day, { rng, sink: ctx, code: 'SJ02', rate: 0.01, maxDelay: 5 }), today)
            const pk = `${d.code}|${dateKey(land)}`
            const list = pendingShots.get(pk) ?? []
            list.push(br)
            pendingShots.set(pk, list)
            // diagnostics readings (3 channels per shot)
            for (const [suf] of d.channels) {
              const ch = `${d.code}-${suf}`
              let peak: number
              if (!ph) peak = suf === 'HP' ? d.field * rng.float(0.5, 1) : suf === 'CT' ? rng.float(19.5, outcomeIdx === 8 ? 95 : 24) : rng.float(800, 2400)
              else if (suf === 'TS') peak = te! * rng.logNormal(1, 0.05) * (d.code === 'JB1' && day.getTime() >= driftFrom.getTime() && day.getTime() < driftTo.getTime() ? 1.12 : 1)
              else if (suf === 'IF') peak = ne! * rng.logNormal(1.1, 0.04)
              else if (suf === 'NC') peak = (neutrons ?? 0) * rng.logNormal(1, 0.08) + 0.001
              else peak = rng.logNormal(5, 0.4)
              const glitch = rng.chance(0.004) || (firstDiagFile && k === 0 && suf === d.channels[0][0])
              const missingMean = rng.chance(0.015) || (firstDiagFile && k === 0 && suf === d.channels[1][0])
              if (glitch) ctx.issue('SJ08')
              if (missingMean) ctx.issue('SJ07')
              const pv = round(peak, 4)
              const mean = round(peak * rng.float(0.55, 0.8), 4)
              const samples = Math.max(10, Math.round(Math.min(dur, 600000) * (d.type === 'Z-Pinch' ? 4000 : 2)))
              T.silver_diagnostic_readings.push({ shot_id: shotId, channel_code: ch, reading_date: day, peak_value: glitch ? null : pv, mean_value: missingMean ? null : mean, sample_count: samples, quality_flag: glitch ? 'SUSPECT' : 'OK' })
              const dk2 = `${d.code}|diag|${dk}`
              const dl = pendingShots.get(dk2) ?? []
              dl.push({ shot: shotId, channel: ch, values: { peak: glitch ? -round(rng.float(0.1, 5), 3) : pv, mean: missingMean ? null : mean }, samples, quality: glitch ? 'SUSPECT' : 'OK' })
              pendingShots.set(dk2, dl)
            }
          })
          if (nShots > 0) firstDiagFile = false
        }
        // daily diagnostics stream
        const diagKey = `${d.code}|diag|${dk}`
        const diag = pendingShots.get(diagKey)
        if (diag?.length) {
          pendingShots.delete(diagKey)
          bronze.push({ source: 'diagnostics', path: `diagnostics/${d.code}/${y}/${String(day.getUTCMonth() + 1).padStart(2, '0')}/${String(day.getUTCDate()).padStart(2, '0')}/stream_${d.code}_${dk}.ndjson`, format: 'ndjson', rows: diag })
        }
        // daily shotlog file (rows landing today)
        const pk = `${d.code}|${dk}`
        const landed = pendingShots.get(pk)
        if (landed?.length) {
          pendingShots.delete(pk)
          const v2 = day.getTime() >= v2Day.getTime()
          if (v2 && !driftLogged) {
            ctx.issue('SJ03')
            driftLogged = true
          }
          const o = { rng, sink: ctx }
          let rows = landed
          rows = injectDuplicates(rows, { ...o, code: 'SJ01', rate: 0.004, atLeast: firstShotFile ? 1 : 0 })
          injectCasing(rows, 'device', { ...o, code: 'SJ06', rate: 0.02, atLeast: firstShotFile ? 1 : 0 })
          const big = rows.filter((r) => typeof r.ne_1e20 === 'number')
          const nOut = Math.floor(big.length * 0.003 + rng.next()) + (firstShotFile && big.length ? 1 : 0)
          for (const r of rng.sample(big, Math.min(nOut, big.length))) r.ne_1e20 = round((r.ne_1e20 as number) * 100, 2)
          if (nOut && big.length) ctx.issue('SJ05', Math.min(nOut, big.length))
          firstShotFile = false
          const columns = v2
            ? ['shot_id', 'device', 'shot_time', 'campaign', 'leader', 'heating', 'mode', 'fuel', 'outcome', 'disruption', 'duration_ms', 'peak_te_kev', 'ne_1e20', 'tau_e_ms', 'p_heat_mw', 'fusion_mw']
            : ['shot_id', 'device', 'shot_time', 'campaign', 'leader', 'heating', 'mode', 'outcome', 'disruption', 'duration_ms', 'te_kev', 'ne_1e20', 'tau_e_ms', 'heating_mw', 'fusion_mw']
          bronze.push({ source: 'shotlog', path: `shotlog/${d.code}/${y}/${String(day.getUTCMonth() + 1).padStart(2, '0')}/${String(day.getUTCDate()).padStart(2, '0')}/shotlog_${d.code}_${dk}.csv`, format: 'csv', columns, rows })
        }
        // inspections & incidents
        let insp = 0
        let fMaj = 0
        let fMin = 0
        let incidents = 0
        const improve = 1 - 0.4 * clamp(daysBetween(start, day) / Math.max(1, span), 0, 1)
        const events: Array<{ type: string; authority: string; maj: number; min: number; outcome: string }> = []
        if (weekday && ri.chance(1 / 90)) {
          const afterQuench = d.code === 'JB1' && day.getTime() > quenchDay.getTime() && day.getTime() < addDays(quenchDay, 120).getTime()
          const maj = ri.poisson((afterQuench ? 1.6 : 0.35) * improve)
          const min = ri.poisson(1.8 * improve)
          events.push({ type: 'Regulatory Inspection', authority: 'Fusion Safety Regulator of Novaria', maj, min, outcome: maj > 1 ? 'Hold' : maj + min > 0 ? 'Pass with actions' : 'Pass' })
        }
        if (weekday && ri.chance(1 / 30)) {
          const min = ri.poisson(1.2 * improve)
          events.push({ type: 'Internal Audit', authority: 'Sunjar EHS team', maj: 0, min, outcome: min ? 'Pass with actions' : 'Pass' })
        }
        if (quenchToday || ri.chance(status === 'Running' ? 0.004 : 0.0015)) events.push({ type: 'Safety Incident', authority: 'Sunjar EHS team', maj: quenchToday ? 1 : 0, min: 0, outcome: quenchToday || ri.chance(0.4) ? 'Recordable' : 'Near Miss' })
        for (const ev of events) {
          const id = `INS-${String(++inspSeq).padStart(6, '0')}`
          insp += ev.type === 'Safety Incident' ? 0 : 1
          incidents += ev.type === 'Safety Incident' && ev.outcome === 'Recordable' ? 1 : 0
          fMaj += ev.maj
          fMin += ev.min
          T.silver_inspections.push({ inspection_id: id, device_code: d.code, event_date: day, event_type: ev.type, authority: ev.authority, findings_major: ev.maj, findings_minor: ev.min, outcome: ev.outcome })
          inspRows.push({ id, device_code: d.code, date: day, type: ev.type, authority: ev.authority, major: ev.maj, minor: ev.min, outcome: ev.outcome })
        }
        // ops & device-day
        const sc = d.superconducting
        const runHours = nShots > 0 && lastShotAt ? round(Math.min(14, (lastShotAt as Date).getUTCHours() - 7 + rng.float(0.5, 1.5)), 2) : 0
        const base = status === 'Running' ? 9 : status === 'Idle' ? 6 : status === 'Maintenance' ? 3 : 1.5
        const energy = round((sc ? base : base * 0.25) * (d.type === 'Magnet Test Stand' ? 0.5 : 1) + energyIn / 3600 / 0.35, 3)
        const cryo = sc ? round(status === 'Outage' ? rng.float(0.1, 0.4) : status === 'Maintenance' ? rng.float(0.45, 0.9) : rng.float(0.965, 1), 4) : null
        const coilT = sc ? round(quenchToday ? 96.4 : status === 'Outage' ? rng.float(120, 290) : status === 'Maintenance' ? rng.float(40, 290) : rng.float(19.6, 23.5), 2) : null
        T.gold_fact_device_day.push({
          device_key: d.key, date_key: dk, device_status: status, shots: nShots, good_shots: good, disruptions: disr, run_hours: runHours, energy_drawn_mwh: energy,
          cryo_uptime_pct: cryo, max_coil_temp_k: coilT, inspections: insp, findings_major: fMaj, findings_minor: fMin, safety_incidents: incidents
        })
        T.silver_device_ops_daily.push({ device_code: d.code, ops_date: day, device_status: status, run_hours: runHours, energy_drawn_mwh: energy, cryo_uptime_pct: cryo, max_coil_temp_k: coilT })
        opsRows.push({ device: d.code, date: day, status, runHours, gridMWh: energy, cryoUptime: cryo, maxCoilK: coilT })
      }
      // decommissioned prototype inspections (orphan device code)
      if (isoDow(day) === 3 && (ri.chance(1 / 16) || (!tc0Planted && daysBetween(start, day) > 14))) {
        tc0Planted = true
        const id = `INS-${String(++inspSeq).padStart(6, '0')}`
        const min = ri.poisson(0.8)
        ctx.issue('SJ15')
        T.silver_inspections.push({ inspection_id: id, device_code: 'TC0', event_date: day, event_type: 'Regulatory Inspection', authority: 'Fusion Safety Regulator of Novaria', findings_major: 0, findings_minor: min, outcome: min ? 'Pass with actions' : 'Pass' })
        inspRows.push({ id, device_code: 'TC0', date: day, type: 'Regulatory Inspection', authority: 'Fusion Safety Regulator of Novaria', major: 0, minor: min, outcome: min ? 'Pass with actions' : 'Pass' })
      }
      // component orders
      if (weekday) {
        const nOrders = rv.poisson(orderRate)
        for (let k = 0; k < nOrders; k++) {
          const candidates = projects.filter((p) => p.magnet && p.start.getTime() <= day.getTime() && p.end.getTime() >= day.getTime())
          if (!candidates.length) break
          const proj = rv.pick(candidates)
          const sup = rv.weighted(SUPPLIERS, SUPPLIERS.map((s) => (s.code === 'SUP-01' ? 3 : s.code === 'SUP-05' ? 2 : 1)))
          const parts = COMPONENTS.filter((c) => c.sup === sup.code)
          const lines = rv.sample(parts, Math.min(parts.length, 1 + rv.poisson(0.9)))
          const orderNo = `CPO-${dk}-${String(++orderSeq).padStart(5, '0')}`
          lines.forEach((c, li) => {
            const qty = c.uom === 'm' ? Math.round(rv.int(c.qty[0], c.qty[1]) / 50) * 50 : rv.int(c.qty[0], c.qty[1])
            const unitCost = money(c.cost * rv.float(0.92, 1.12) * Math.pow(1.03, day.getUTCFullYear() - start.getUTCFullYear()))
            const promised = addDays(day, Math.round(sup.lead * rv.float(0.8, 1.2)))
            const shortage = sup.code === 'SUP-01' && day.getTime() >= shortageFrom.getTime() && day.getTime() < shortageTo.getTime()
            const lateChance = sup.tier === 'Probation' ? 0.45 : shortage ? 0.85 : 0.2
            const late = rv.chance(lateChance) ? rv.int(3, shortage ? 90 : 30) : -rv.int(0, 5)
            const received = maxDate(addDays(day, 2), addDays(promised, late))
            const shipped = maxDate(addDays(day, 1), addDays(received, -rv.int(2, 10)))
            const installed = rv.chance(0.85) ? addDays(received, rv.int(7, 60)) : null
            const rejected = rv.chance(c.type === 'HTS Tape' ? 0.12 : 0.04) ? Math.max(1, Math.round(qty * rv.float(0.02, 0.15))) : 0
            const isShipped = shipped.getTime() <= today.getTime()
            const isReceived = received.getTime() <= today.getTime()
            const isInstalled = installed !== null && installed.getTime() <= today.getTime()
            const lead = daysBetween(day, received)
            const daysLate = Math.max(0, daysBetween(promised, received))
            T.gold_fact_component_order.push({
              order_number: orderNo, order_line: li + 1, supplier_key: supplierKey.get(sup.code)!, component_key: componentKey.get(c.pn)!, project_key: proj.key,
              order_date_key: dk, promised_date_key: dateKey(promised), shipped_date_key: isShipped ? dateKey(shipped) : null, received_date_key: isReceived ? dateKey(received) : null,
              installed_date_key: isInstalled ? dateKey(installed!) : null, ordered_qty: qty, received_qty: isReceived ? qty : 0, rejected_qty: isReceived ? rejected : 0,
              unit_cost: unitCost, line_amount: money(qty * unitCost), lead_time_days: isReceived ? lead : null, days_late: isReceived ? daysLate : null, is_on_time: isReceived ? daysLate === 0 : null,
              order_status: isInstalled ? 'Installed' : isReceived ? 'Received' : isShipped ? 'Shipped' : 'Ordered'
            })
            T.silver_component_orders.push({
              order_number: orderNo, order_line: li + 1, supplier_code: sup.code, part_number: c.pn, project_code: proj.code, order_date: day, promised_date: promised,
              shipped_date: isShipped ? shipped : null, received_date: isReceived ? received : null, installed_date: isInstalled ? installed : null,
              ordered_qty: qty, received_qty: isReceived ? qty : 0, rejected_qty: isReceived ? rejected : 0, unit_cost: unitCost
            })
            orderRows.push({
              po: orderNo, line: li + 1, supplier: sup.code, part: c.pn, project: proj.code, ordered: day, promised, shipped: isShipped ? shipped : null,
              received_date: isReceived ? received : null, installed: isInstalled ? installed : null, qty, qty_rejected: isReceived ? rejected : 0, unit_cost: unitCost
            })
          })
        }
      }
    }

    // ---- month-end: finance (budget vs actual), staff snapshots, monthly bronze ---------------
    const mk = monthKey(monthStart)
    const meKey = dateKey(endOfMonth(monthStart))
    const glRows: BronzeRow[] = []
    const postLines = (projectCode: string, account: string, amount: number, overhead: boolean) => {
      const n = account === '6100' ? 2 : 1 + ra.poisson(2.5)
      const parts = splitAmount(ra, amount, n)
      const jid = `JE-${ym}-${String(++journalSeq).padStart(5, '0')}`
      parts.forEach((amt, i) => {
        const post = addDays(monthStart, ra.int(0, daysBetween(monthStart, monthEnd)))
        const vendor = account === '6100' ? (i === 0 ? 'Payroll' : 'Benefits Provider') : account === '1600' || account === '1500' ? ra.pick(SUPPLIERS).name : ra.pick(vendors)
        const desc = overhead ? `Overhead allocation (${ACCOUNTS.find((a) => a[0] === account)![1]})` : `${ACCOUNTS.find((a) => a[0] === account)![1]} — ${projectCode}`
        T.silver_gl_lines.push({ journal_id: jid, line_number: i + 1, posting_date: post, project_code: projectCode, account_code: account, amount: amt, vendor, description: desc })
        glRows.push({ journal_id: jid, line: i + 1, posting_date: post, project_code: projectCode, account_code: account, amount: amt, vendor, description: desc, cost_center: overhead ? 'CC-900' : `CC-${projectCode.slice(4)}` })
      })
    }
    const progressOf = (d: Date) => clamp(daysBetween(start, d) / Math.max(1, span), 0, 1)
    const p = progressOf(monthStart)
    for (const proj of projects) {
      for (const a of proj.accounts) {
        const b = budget.get(`${proj.code}|${a}|${mk}`)
        if (b === undefined) continue
        let f = ra.logNormal(1, 0.12)
        if (proj.code === 'PRJ-102' && p > 0.66) f *= 1.25
        if (proj.code === 'PRJ-202' && monthStart.getTime() < addDays(quenchDay, 200).getTime()) f *= 1.6
        if (proj.code === 'PRJ-103') f *= p < 0.3 ? 0.75 : 1.15
        if (proj.code === 'PRJ-201') f *= monthStart.getTime() >= shortageFrom.getTime() && monthStart.getTime() < shortageTo.getTime() ? 0.7 : monthStart.getTime() >= shortageTo.getTime() && p < 0.65 ? 1.3 : 1
        const actual = money(b * f)
        postLines(proj.code, a, actual, false)
        T.gold_fact_finance_month.push({
          project_key: proj.key, account_key: accountKey.get(a)!, funding_source_key: fundingFor(proj.code, monthEnd, actual), month_end_date_key: meKey,
          budget_amount: b, actual_amount: actual, variance_amount: money(actual - b), journal_lines: a === '6100' ? 2 : 0
        })
      }
    }
    // overhead booked on legacy codes (orphans) → unallocated project -1
    const overheadByAccount = new Map<string, number>()
    const nOh = Math.max(1, ra.poisson(3))
    for (let k = 0; k < nOh; k++) {
      const a = ra.pick(['6200', '6500', '6700'])
      const amt = money(ra.logNormal(22000, 0.5))
      const code = ra.pick(LEGACY_CODES)
      ctx.issue('SJ11')
      postLines(code, a, amt, true)
      overheadByAccount.set(a, money((overheadByAccount.get(a) ?? 0) + amt))
    }
    for (const [a, amt] of overheadByAccount) {
      T.gold_fact_finance_month.push({ project_key: -1, account_key: accountKey.get(a)!, funding_source_key: fundingFor(null, monthEnd, amt), month_end_date_key: meKey, budget_amount: 0, actual_amount: amt, variance_amount: amt, journal_lines: 0 })
    }
    // journal line counts per project/account
    const lineCount = new Map<string, number>()
    for (const r of T.silver_gl_lines) {
      const pc = projectByCode.get(r.project_code as string)
      const k = `${pc ? pc.key : -1}|${accountKey.get(r.account_code as string)}`
      lineCount.set(k, (lineCount.get(k) ?? 0) + 1)
    }
    for (const r of T.gold_fact_finance_month) r.journal_lines = lineCount.get(`${r.project_key}|${r.account_key}`) ?? 0

    for (const s of staff) {
      if (s.hire.getTime() > monthEnd.getTime()) continue
      if (s.departure && s.departure.getTime() < monthStart.getTime()) continue
      const a = attrsAt(s, monthEnd)
      T.silver_staff_snapshots.push({
        snapshot_date: monthEnd, staff_id: s.id, full_name: a.full_name, role: a.role, team: a.team, grade: a.grade, annual_salary: a.annual_salary, site: a.site,
        employment_status: a.employment_status, hire_date: s.hire, departure_date: s.departure && s.departure.getTime() <= monthEnd.getTime() ? s.departure : null
      })
    }
    const hrRows: BronzeRow[] = T.silver_staff_snapshots.map((r) => ({
      staff_id: r.staff_id as string, name: r.full_name as string, role: r.role as string, team: r.team as string, grade: r.grade as string, salary: r.annual_salary as number,
      site: r.site as string, status: r.employment_status as string, hire_date: r.hire_date as Date, departure_date: r.departure_date as Date | null
    }))
    const first = mk === monthKey(start)
    const mo = { rng, sink: ctx }
    injectDateFormats(hrRows, 'hire_date', { ...mo, code: 'SJ09', rate: 0.12, atLeast: first ? 1 : 0 })
    injectFormattedNumbers(glRows, 'amount', { ...mo, code: 'SJ10', rate: 0.1, atLeast: first ? 1 : 0 })
    injectWhitespace(glRows, 'account_code', { ...mo, code: 'SJ12', rate: 0.05, atLeast: first ? 1 : 0 })
    const hasReceived = orderRows.some((r) => r.received_date instanceof Date)
    injectDateFormats(orderRows, 'received_date', { ...mo, code: 'SJ13', rate: 0.15, formats: ['eu'], atLeast: hasReceived && !receivedPlanted ? 1 : 0 })
    if (hasReceived) receivedPlanted = true
    bronze.push(
      { source: 'hr', path: `hr/staff_${ym}.csv`, format: 'csv', rows: hrRows },
      { source: 'finance_gl', path: `finance/gl/${y}/gl_lines_${ym}.csv`, format: 'csv', rows: glRows, columns: ['journal_id', 'line', 'posting_date', 'project_code', 'account_code', 'amount', 'vendor', 'description', 'cost_center'] },
      { source: 'operations', path: `operations/${y}/device_ops_${ym}.json`, format: 'json', rows: opsRows, json: { envelope: { source: 'ops-logbook', month: ym }, dataKey: 'records' } }
    )
    if (inspRows.length) bronze.push({ source: 'safety', path: `safety/${y}/inspections_${ym}.csv`, format: 'csv', rows: inspRows, columns: ['id', 'device_code', 'date', 'type', 'authority', 'major', 'minor', 'outcome'] })
    if (orderRows.length) bronze.push({ source: 'procurement', path: `procurement/${y}/component_orders_${ym}.json`, format: 'json', rows: orderRows, json: { envelope: { portal: 'supplier-portal', month: ym }, dataKey: 'orderLines' } })
    yield { label: `${y}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`, tables: T, bronze }
  }

  // ---- closing: budget-only months after today (rest of the calendar year) ----------------------
  const future: Row[] = []
  for (const m of monthsOf(addDays(endOfMonth(today), 1), ctx.calendarEnd)) {
    if (m.getTime() <= today.getTime()) continue
    for (const proj of projects) for (const a of proj.accounts) {
      const b = budget.get(`${proj.code}|${a}|${monthKey(m)}`)
      if (b === undefined) continue
      future.push({ project_key: proj.key, account_key: accountKey.get(a)!, funding_source_key: fundingFor(null, today, 0), month_end_date_key: dateKey(endOfMonth(m)), budget_amount: b, actual_amount: null, variance_amount: null, journal_lines: 0 })
    }
  }
  yield { label: 'closing', tables: { gold_fact_finance_month: future } }
  void deviceByCode
}
