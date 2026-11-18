/**
 * Griffin & Gecko Creature Care — simulation.
 *
 * Day by day per clinic: expected appointments (clinic type × weekday × season × growth) → visit type,
 * booking channel and creature class (with winter Ember Flu outbreaks, spring molting, summer wing
 * sprains) → patient → status (no-show / cancelled / seen) → diagnoses → billed lines (size-scaled
 * prices, care-plan discounts) → owner and insurer payments. Month end: payroll from the staff SCD2
 * history, operating expenses and balanced GL journals per cost center. Closing: GL monthly
 * snapshot with a budget planned from the prior fiscal year.
 *
 * Volumes: `small` ≈ 3 appointments per clinic-day (a quiet network); staff headcount, rents and
 * other costs scale with the same factor so margins stay realistic; `large` is ~30× busier.
 */
import type { Scalar } from '../../../../../src/core/model/data.ts'
import {
  addDays, annualCycle, dateKey, dateOnly, daysBetween, daysInMonth, eachDay, endOfMonth, fiscalMonth, fiscalYear, isoDate, isoDow, maxDate,
  minDate, monthKey, MONTH_NAMES, startOfMonth, ymd
} from '../../calendar.ts'
import {
  formatDate, injectCasing, injectDateFormats, injectDuplicates, injectFormattedNumbers, injectOutliers, injectWhitespace, landingDay
} from '../../chaos.ts'
import { clamp, round } from '../../prng.ts'
import { Scd2Index, scd2Rows } from '../../scd2.ts'
import type { Scd2Version } from '../../scd2.ts'
import type { Batch, BronzeFile, BronzeRow, GenContext, Row } from '../../schema.ts'
import { ADJECTIVES, email, NOUNS, personName, placeName, placeNames } from '../../words.ts'
import {
  ACCOUNTS, BREEDS, CHANNELS, CLASS_DRAGON, CLASS_GRIFFIN, CLASS_PHOENIX, CLASS_SEA, CLASS_WEIGHTS, DIAGNOSES, DX_EMBER_FLU, DX_ROUTINE, PAYERS,
  PET_NAMES, PROCEDURES, REGIONS, SIZE_PRICE, SIZE_RANK, SIZE_TIME, TYPE_ORDER, VISIT_TYPES
} from './reference.ts'
import type { BreedDef, ClinicType, DxDef, ProcDef } from './reference.ts'

interface Clinic {
  idx: number
  key: number
  code: string
  name: string
  type: ClinicType
  region: string
  district: string
  city: string
  opened: Date
  rooms: number
  flightDeck: boolean
  tankOpened: Date | null
  facing: boolean
}

interface Owner {
  key: number
  id: string
  name: string
  type: string
  city: string
  plan: string
  payer: number
  join: Date
  home: number
  email: string | null
  optIn: boolean
}

interface Patient {
  key: number
  id: string
  name: string
  breed: BreedDef
  breedKey: number
  owner: Owner
  home: number
  sex: string
  birth: Date
  weight: number
  temperament: string
  rune: boolean
  registered: Date
  propensity: number
}

interface Staff {
  id: string
  hire: Date
  termination: Date | null
  versions: Scd2Version[]
}

const ROLES: Record<string, { group: string; band: string; salary: [number, number]; tenure: number }> = {
  'Senior Veterinarian': { group: 'Veterinary', band: 'Band 7', salary: [165000, 195000], tenure: 5 },
  Veterinarian: { group: 'Veterinary', band: 'Band 6', salary: [105000, 140000], tenure: 3.2 },
  'Vet Nurse': { group: 'Nursing & Handling', band: 'Band 3', salary: [52000, 66000], tenure: 2.4 },
  'Creature Handler': { group: 'Nursing & Handling', band: 'Band 2', salary: [46000, 58000], tenure: 1.8 },
  Receptionist: { group: 'Admin', band: 'Band 1', salary: [38000, 45000], tenure: 1.6 },
  'Clinic Manager': { group: 'Admin', band: 'Band 4', salary: [78000, 95000], tenure: 4 },
  'Head Office': { group: 'Admin', band: 'Band 5', salary: [70000, 110000], tenure: 4 }
}

const POSITIONS: Record<ClinicType, Array<[string, number, number]>> = {
  'Creature Hospital': [['Senior Veterinarian', 1, 1], ['Veterinarian', 1, 1], ['Vet Nurse', 2, 1], ['Creature Handler', 1, 0], ['Receptionist', 1, 1], ['Clinic Manager', 1, 1]],
  Aerie: [['Veterinarian', 1, 1], ['Vet Nurse', 1, 1], ['Creature Handler', 1, 1], ['Receptionist', 1, 1], ['Clinic Manager', 1, 1]],
  'Aquatic Center': [['Veterinarian', 1, 1], ['Vet Nurse', 1, 1], ['Creature Handler', 1, 0], ['Receptionist', 1, 1], ['Clinic Manager', 1, 1]],
  'Creature Clinic': [['Veterinarian', 1, 1], ['Vet Nurse', 1, 1], ['Receptionist', 1, 1], ['Clinic Manager', 1, 1]],
  'Head Office': [['Head Office', 2, 1]]
}

/** Price level applied to the catalogue (fantastical patients need fantastical equipment). */
const PRICE_LEVEL = 1.8

const VET_ROLES = new Set(['Veterinarian', 'Senior Veterinarian'])
const NURSE_ROLES = new Set(['Vet Nurse', 'Creature Handler'])
const WAGE_ACCOUNT: Record<string, string> = { Veterinary: '6000', 'Nursing & Handling': '6010', Admin: '6020' }

const money = (v: number) => round(v, 2)

function attrsAt(e: Staff, d: Date): Record<string, Scalar> {
  let cur = e.versions[0].attrs
  for (const v of e.versions) if (v.from.getTime() <= d.getTime()) cur = v.attrs
  return cur
}

function* monthsOf(start: Date, end: Date): Generator<Date> {
  for (let d = startOfMonth(start); d.getTime() <= end.getTime(); d = ymd(d.getUTCFullYear(), d.getUTCMonth() + 2, 1)) yield d
}

const ym = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`

export function* generateGriffinGecko(ctx: GenContext): Generator<Batch> {
  const today = ctx.today
  const start = ctx.start
  const span = daysBetween(start, today)
  const F = ctx.scale.factor
  const at = (frac: number) => addDays(start, Math.floor(span * frac))
  const yearsFromStart = (d: Date) => Math.max(0, d.getUTCFullYear() - start.getUTCFullYear())
  const inflation = (d: Date) => Math.pow(1.05, yearsFromStart(d))

  // ---- clinics ---------------------------------------------------------------------------------
  const rc = ctx.rng('clinics')
  const types: ClinicType[] = ctx.tiny
    ? ['Creature Hospital', 'Creature Clinic']
    : ['Creature Hospital', 'Creature Clinic', 'Aerie', 'Aquatic Center', 'Creature Clinic', 'Creature Hospital', 'Creature Clinic', 'Creature Clinic']
  const towns = placeNames(rc, types.length + 1)
  const clinics: Clinic[] = types.map((type, i) => {
    const region = REGIONS[i % REGIONS.length]
    const city = towns[i]
    const name = type === 'Creature Hospital' ? `${city} Creature Hospital` : type === 'Aerie' ? `${city} Aerie` : type === 'Aquatic Center' ? `${city} Aquatic Center` : `${city} Creature Clinic`
    const opened = !ctx.tiny && i === 7 ? at(0.3) : addDays(start, -rc.int(400, 4000))
    const tankOpened = type === 'Aquatic Center' ? opened : i === (ctx.tiny ? 0 : 5) ? at(ctx.tiny ? 0.5 : 0.45) : null
    return {
      idx: i, key: i + 1, code: `GG-${String(i + 1).padStart(2, '0')}`, name: `Griffin & Gecko ${name}`, type, region: region.name,
      district: region.districts[rc.int(0, 1)], city, opened: dateOnly(opened),
      rooms: type === 'Creature Hospital' ? rc.int(8, 12) : type === 'Creature Clinic' ? rc.int(3, 5) : rc.int(4, 7),
      flightDeck: type === 'Creature Hospital' || type === 'Aerie', tankOpened: tankOpened ? dateOnly(tankOpened) : null, facing: true
    }
  })
  const hq: Clinic = {
    idx: clinics.length, key: clinics.length + 1, code: 'GG-HQ', name: 'Griffin & Gecko Head Office', type: 'Head Office', region: REGIONS[0].name,
    district: REGIONS[0].districts[0], city: towns[types.length], opened: addDays(start, -5000), rooms: 0, flightDeck: false, tankOpened: null, facing: false
  }
  const costCenters = [...clinics, hq]
  const hasTank = (c: Clinic, d: Date) => !!c.tankOpened && c.tankOpened.getTime() <= d.getTime()
  const isOpen = (c: Clinic, d: Date) => c.opened.getTime() <= d.getTime()
  const aerie = clinics.find((c) => c.type === 'Aerie')
  const slowClinic = clinics[Math.min(clinics.length - 1, 6)]
  const onlineClinic = clinics[Math.min(clinics.length - 1, 4)]
  const scorchClinic = clinics[0]

  // ---- owners & patients ---------------------------------------------------------------------
  const ro = ctx.rng('owners')
  const nOwners = ctx.n(2400, 40)
  const owners: Owner[] = []
  for (let i = 0; i < nOwners; i++) {
    const type = ro.weighted(['Household', 'Farm', 'Wizard Guild', 'Sanctuary', 'Royal Menagerie'], [0.82, 0.07, 0.05, 0.04, 0.02])
    const p = personName(ro)
    const place = placeName(ro)
    const name = type === 'Household' ? `${p.last} Household` : type === 'Farm' ? `${place} Farm` : type === 'Wizard Guild' ? `Order of the ${ro.pick(ADJECTIVES)} ${ro.pick(NOUNS)}` : type === 'Sanctuary' ? `${place} Creature Sanctuary` : `Royal Menagerie of ${place}`
    const before = ro.chance(0.4)
    const join = dateOnly(before ? addDays(start, -ro.int(30, 1500)) : addDays(start, Math.floor(span * Math.pow(ro.next(), 0.85))))
    const openClinics = clinics.filter((c) => c.opened.getTime() <= join.getTime())
    const home = (openClinics.length ? ro.pick(openClinics) : clinics[0]).idx
    owners.push({
      key: i + 1, id: `OW-${String(i + 1).padStart(6, '0')}`, name, type, city: ro.chance(0.7) ? clinics[home].city : place,
      plan: ro.weighted(['None', 'Hatchling Plan', 'Hoard Plan'], [0.62, 0.25, 0.13]), payer: ro.weighted([0, 1, 2, 3, 4], [0.45, 0.16, 0.14, 0.15, 0.1]),
      join, home, email: type === 'Household' && ro.chance(0.86) ? email(p.first, p.last, 'owlpost.example', ro) : type !== 'Household' ? `office@${place.toLowerCase()}.example` : null,
      optIn: ro.chance(0.6)
    })
  }
  const classes = Object.keys(CLASS_WEIGHTS)
  const breedsByClass = new Map<string, BreedDef[]>()
  for (const b of BREEDS) breedsByClass.set(b.cls, [...(breedsByClass.get(b.cls) ?? []), b])
  const breedKey = new Map(BREEDS.map((b, i) => [b.code, i + 1]))
  const tankClinics = clinics.filter((c) => c.tankOpened)
  const deckClinics = clinics.filter((c) => c.flightDeck)
  const patients: Patient[] = []
  for (const o of owners) {
    const n = 1 + ro.poisson(o.type === 'Royal Menagerie' ? 3 : o.type === 'Sanctuary' ? 2 : o.type === 'Household' ? 0.3 : 0.8)
    for (let k = 0; k < n; k++) {
      let cls = ro.weighted(classes, classes.map((c) => CLASS_WEIGHTS[c]))
      if (cls === CLASS_SEA && !tankClinics.length) cls = CLASS_DRAGON
      const list = breedsByClass.get(cls)!
      const breed = ro.weighted(list, list.map((b) => (b.size === 'Colossal' ? 0.3 : 1)))
      let home = o.home
      let registered = addDays(o.join, k === 0 ? 0 : ro.int(0, 700))
      if (breed.aquatic && !clinics[home].tankOpened) home = ro.pick(tankClinics).idx
      if (breed.flyer && (breed.size === 'Large' || breed.size === 'Colossal') && !clinics[home].flightDeck && ro.chance(0.6)) home = ro.pick(deckClinics).idx
      if (breed.aquatic) registered = maxDate(registered, clinics[home].tankOpened!)
      registered = maxDate(registered, clinics[home].opened)
      if (registered.getTime() > today.getTime()) continue
      const ageYears = ro.float(0.1, Math.max(0.5, breed.life * 0.35))
      patients.push({
        key: patients.length + 1, id: `PT-${String(patients.length + 1).padStart(6, '0')}`, name: ro.pick(PET_NAMES), breed, breedKey: breedKey.get(breed.code)!,
        owner: o, home, sex: ro.weighted(['Female', 'Male', 'Unknown'], [0.47, 0.47, 0.06]), birth: dateOnly(addDays(registered, -Math.round(ageYears * 365))),
        weight: round(breed.weight * ro.logNormal(1, 0.18), breed.weight < 1 ? 3 : 1), temperament: breed.fire ? ro.weighted(['Gentle', 'Skittish', 'Grumpy', 'Incendiary'], [0.3, 0.2, 0.25, 0.25]) : ro.weighted(['Gentle', 'Skittish', 'Grumpy'], [0.5, 0.3, 0.2]),
        rune: ro.chance(0.7), registered: dateOnly(registered), propensity: ro.logNormal(1, 0.6)
      })
    }
  }
  // pools per clinic × class, sorted by registration
  const pools = clinics.map(() => new Map<string, Patient[]>())
  for (const p of patients) {
    const m = pools[p.home]
    const list = m.get(p.breed.cls)
    if (list) list.push(p)
    else m.set(p.breed.cls, [p])
  }
  for (const m of pools) for (const list of m.values()) list.sort((a, b) => a.registered.getTime() - b.registered.getTime() || a.key - b.key)
  const maxProp = Math.max(...patients.map((p) => p.propensity), 1)

  // ---- staff (HR lifecycle → SCD2) ------------------------------------------------------------
  const rh = ctx.rng('staff')
  const staff: Staff[] = []
  const specialtyFor = (c: Clinic, role: string): string => {
    if (!VET_ROLES.has(role)) return 'n/a'
    if (c.type === 'Aerie') return 'Avian & Griffin'
    if (c.type === 'Aquatic Center') return 'Aquatic'
    if (c.type === 'Creature Hospital') return rh.chance(0.5) ? 'Draconic Medicine' : 'General'
    return rh.chance(0.3) ? 'Herpetology' : 'General'
  }
  for (const cc of costCenters) {
    for (const [role, base, min] of POSITIONS[cc.type]) {
      const count = role === 'Clinic Manager' ? 1 : Math.max(min, Math.round(base * F))
      for (let slot = 0; slot < count; slot++) {
        let hire = dateOnly(maxDate(addDays(cc.opened, -30), addDays(start, -rh.int(0, 1400))))
        while (hire.getTime() <= today.getTime()) {
          const def = ROLES[role]
          const tenure = Math.max(45, Math.round(rh.exponential(def.tenure * 365)))
          let termination: Date | null = addDays(hire, tenure)
          if (termination.getTime() > today.getTime()) termination = null
          const id = `ST-${String(staff.length + 1).padStart(4, '0')}`
          const n = personName(rh)
          const attrs: Record<string, Scalar> = {
            full_name: n.full, role, role_group: def.group, specialty: specialtyFor(cc, role), clinic_code: cc.code, clinic_name: cc.name, salary_band: def.band,
            annual_salary: Math.round(rh.float(def.salary[0], def.salary[1]) * Math.pow(1.03, hire.getUTCFullYear() - start.getUTCFullYear()) / 100) * 100,
            employment_status: 'Active', hire_date: hire
          }
          const last = termination ?? today
          const tenureDays = daysBetween(hire, last)
          const events: Array<{ at: Date; apply: (p: Record<string, Scalar>) => Record<string, Scalar> }> = []
          for (let y = hire.getUTCFullYear(); y <= last.getUTCFullYear(); y++) {
            const raise = ymd(y, 4, 1)
            if (raise.getTime() > hire.getTime() + 120 * 86_400_000 && raise.getTime() < last.getTime()) {
              const pct = rh.float(1.025, 1.05)
              events.push({ at: raise, apply: (p) => ({ ...p, annual_salary: Math.round(((p.annual_salary as number) * pct) / 100) * 100 }) })
            }
          }
          if (role === 'Veterinarian' && attrs.specialty === 'General' && tenureDays > 400 && rh.chance(0.35)) {
            const spec = rh.pick(['Draconic Medicine', 'Herpetology', 'Avian & Griffin'])
            events.push({ at: addDays(hire, rh.int(365, tenureDays - 1)), apply: (p) => ({ ...p, specialty: spec, annual_salary: Math.round(((p.annual_salary as number) * 1.06) / 100) * 100 }) })
          }
          if (role === 'Veterinarian' && tenureDays > 1100 && rh.chance(0.35)) {
            events.push({ at: addDays(hire, rh.int(1095, tenureDays - 1)), apply: (p) => ({ ...p, role: 'Senior Veterinarian', salary_band: 'Band 7', annual_salary: Math.round(((p.annual_salary as number) * 1.22) / 100) * 100 }) })
          }
          if (cc.facing && tenureDays > 200 && rh.chance(0.07)) {
            const when = addDays(hire, rh.int(150, tenureDays - 1))
            const dest = clinics.filter((o) => o.code !== cc.code && isOpen(o, when))
            if (dest.length) {
              const d = rh.pick(dest)
              events.push({ at: when, apply: (p) => ({ ...p, clinic_code: d.code, clinic_name: d.name }) })
            }
          }
          events.sort((a, b) => a.at.getTime() - b.at.getTime())
          if (termination) events.push({ at: termination, apply: (p) => ({ ...p, employment_status: 'Terminated' }) })
          const versions: Scd2Version[] = [{ from: hire, attrs }]
          for (const ev of events) versions.push({ from: dateOnly(ev.at), attrs: ev.apply(versions[versions.length - 1].attrs) })
          staff.push({ id, hire, termination: termination ? dateOnly(termination) : null, versions })
          if (!termination) break
          hire = addDays(termination, rh.int(10, 45))
        }
      }
    }
  }
  const staffRows = scd2Rows(staff.map((s) => ({ businessKey: s.id, versions: s.versions })), { skColumn: 'staff_sk', bkColumn: 'staff_id' })
  const scd = new Scd2Index(staffRows, 'staff_sk', 'staff_id')
  const rosterCache = new Map<string, { vets: Staff[]; nurses: Staff[] }>()
  const roster = (c: Clinic, d: Date) => {
    const k = `${c.code}|${monthKey(d)}`
    let r = rosterCache.get(k)
    if (!r) {
      const mid = minDate(ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, 15), today)
      const active = staff.filter((s) => {
        if (s.hire.getTime() > mid.getTime()) return false
        const a = attrsAt(s, mid)
        return a.clinic_code === c.code && a.employment_status === 'Active'
      })
      let vets = active.filter((s) => VET_ROLES.has(attrsAt(s, mid).role as string))
      if (!vets.length) vets = staff.filter((s) => s.versions[0].attrs.clinic_code === c.code && VET_ROLES.has(s.versions[0].attrs.role as string))
      if (!vets.length) vets = [staff[0]]
      let nurses = active.filter((s) => NURSE_ROLES.has(attrsAt(s, mid).role as string))
      if (!nurses.length) nurses = vets
      r = { vets, nurses }
      rosterCache.set(k, r)
    }
    return r
  }

  // ---- static batch ----------------------------------------------------------------------------
  const rb = ctx.rng('static-bronze')
  const T0: Record<string, Row[]> = {}
  const B0: BronzeFile[] = []
  const clinicRow = (c: Clinic) => ({
    clinic_code: c.code, clinic_name: c.name, clinic_type: c.type, region: c.region, district: c.district, city: c.city, opened_date: c.opened,
    exam_rooms: c.rooms, has_flight_deck: c.flightDeck, tank_wing_opened: c.tankOpened
  })
  T0.gold_dim_clinic = costCenters.map((c) => ({ clinic_key: c.key, ...clinicRow(c), has_tank_wing: hasTank(c, today), is_patient_facing: c.facing }))
  T0.silver_clinics = costCenters.map(clinicRow)
  T0.gold_dim_species = BREEDS.map((b, i) => ({
    species_key: i + 1, breed_code: b.code, creature_class: b.cls, species: b.species, breed: b.breed, size_class: b.size, size_rank: SIZE_RANK[b.size],
    typical_lifespan_years: b.life, is_aquatic: b.aquatic, is_flyer: b.flyer, is_fire_breathing: b.fire
  }))
  T0.silver_species = T0.gold_dim_species.map(({ species_key: _k, size_rank: _r, ...rest }) => (void _k, void _r, rest))
  const procKey = new Map(PROCEDURES.map((p, i) => [p.code, i + 1]))
  const procByCode = new Map(PROCEDURES.map((p) => [p.code, p]))
  T0.gold_dim_procedure = PROCEDURES.map((p, i) => ({
    procedure_key: i + 1, procedure_code: p.code, procedure_name: p.name, procedure_group: p.group, item_category: p.cat, revenue_account_code: p.account,
    base_price: money(p.price * PRICE_LEVEL * inflation(today)), cost_ratio: p.cost
  }))
  T0.silver_procedures = T0.gold_dim_procedure.map(({ procedure_key: _k, ...rest }) => (void _k, rest))
  const dxKey = new Map(DIAGNOSES.map((d, i) => [d.code, i + 1]))
  T0.gold_dim_diagnosis = DIAGNOSES.map((d, i) => ({ diagnosis_key: i + 1, diagnosis_code: d.code, diagnosis_name: d.name, diagnosis_group: d.group, severity: d.severity, is_seasonal: d.seasonal }))
  T0.silver_diagnoses = T0.gold_dim_diagnosis.map(({ diagnosis_key: _k, ...rest }) => (void _k, rest))
  const accountKey = new Map(ACCOUNTS.map((a, i) => [a.code, i + 1]))
  T0.gold_dim_account = ACCOUNTS.map((a, i) => ({
    account_key: i + 1, account_code: a.code, account_name: a.name, statement: a.statement, account_type: a.type, account_group: a.group, normal_balance: a.normal,
    pl_sign: a.type === 'Revenue' ? 1 : -1, sort_order: i + 1, type_order: TYPE_ORDER[a.type]
  }))
  T0.silver_accounts = ACCOUNTS.map((a) => ({ account_code: a.code, account_name: a.name, statement: a.statement, account_type: a.type, account_group: a.group, normal_balance: a.normal }))
  T0.gold_dim_payer = PAYERS.map((p, i) => ({ payer_key: i + 1, payer_code: p.code, payer_name: p.name, payer_type: p.type, coverage_pct: p.coverage, contract_days_to_pay: p.days }))
  T0.silver_payers = PAYERS.map((p) => ({ payer_code: p.code, payer_name: p.name, coverage_pct: p.coverage, contract_days_to_pay: p.days }))
  T0.gold_dim_appointment_type = []
  VISIT_TYPES.forEach((v, vi) => CHANNELS.forEach((ch, ci) => T0.gold_dim_appointment_type.push({ appointment_type_key: vi * CHANNELS.length + ci + 1, visit_type: v, booking_channel: ch, is_emergency: v === 'Emergency', is_scheduled: ch !== 'Walk-in' })))
  const apptTypeKey = (v: string, ch: string) => VISIT_TYPES.indexOf(v) * CHANNELS.length + CHANNELS.indexOf(ch) + 1

  // owners: placeholder e-mails & casing are decided here (truth nulls stay null in silver)
  const ownerBronze: BronzeRow[] = owners.map((o) => {
    let em: string | null = o.email
    if (em === null) {
      ctx.issue('GG12')
      em = rb.pick(['', 'NULL', 'n/a'])
    }
    return { owner_id: o.id, household: o.name, owner_type: o.type, town: o.city, email: em, plan: o.plan, insurer: PAYERS[o.payer].code, home_clinic: clinics[o.home].code, joined: o.join, opt_in: o.optIn ? 'Y' : 'N' }
  })
  injectCasing(ownerBronze, 'town', { rng: rb, sink: ctx, code: 'GG13', rate: 0.06, atLeast: 2 })
  B0.push({ source: 'owners', path: 'registry/owners.csv', format: 'csv', csv: { quoteAll: true, lineEnding: '\r\n' }, rows: injectDuplicates(ownerBronze, { rng: rb, sink: ctx, code: 'GG11', rate: 0.012, atLeast: 1 }) })
  T0.silver_owners = owners.map((o) => ({
    owner_id: o.id, household_name: o.name, owner_type: o.type, city: o.city, email: o.email, care_plan: o.plan, payer_code: PAYERS[o.payer].code,
    home_clinic_code: clinics[o.home].code, join_date: o.join, email_opt_in: o.optIn
  }))
  T0.gold_dim_owner = [
    { owner_key: -1, owner_id: 'GOOD-SAMARITAN', household_name: 'Good Samaritan (strays)', owner_type: 'Public', city: 'n/a', care_plan: 'None', payer_name: 'Self-Pay', join_date: null, home_clinic_key: null, email_opt_in: false },
    ...owners.map((o) => ({
      owner_key: o.key, owner_id: o.id, household_name: o.name, owner_type: o.type, city: o.city, care_plan: o.plan, payer_name: PAYERS[o.payer].name, join_date: o.join,
      home_clinic_key: clinics[o.home].key, email_opt_in: o.optIn
    }))
  ]
  // patients: weight sentinels are lossy → silver/gold weight null
  const sentinel = new Set<number>()
  for (const p of patients) if (p.breed.size === 'Colossal' || rb.chance(0.03)) sentinel.add(p.key)
  const patientBronze: BronzeRow[] = patients.map((p) => {
    const s = sentinel.has(p.key)
    if (s) ctx.issue('GG10')
    return {
      patient_id: p.id, name: p.name, breed: p.breed.code, owner: p.owner.id, sex: p.sex, birth_date: p.birth,
      weight_kg: s ? (p.breed.size === 'Colossal' ? 9999 : -1) : p.weight, temperament: p.temperament, rune_tag: p.rune, registered: p.registered
    }
  })
  injectDateFormats(patientBronze, 'birth_date', { rng: rb, sink: ctx, code: 'GG09', rate: 0.15, formats: ['us', 'eu', 'long', 'epoch'], atLeast: 2 })
  B0.push({ source: 'patients', path: 'registry/patients.ndjson', format: 'ndjson', rows: patientBronze })
  T0.silver_patients = patients.map((p) => ({
    patient_id: p.id, patient_name: p.name, breed_code: p.breed.code, owner_id: p.owner.id, sex: p.sex, birth_date: p.birth, weight_kg: sentinel.has(p.key) ? null : p.weight,
    temperament: p.temperament, is_rune_tagged: p.rune, registered_date: p.registered
  }))
  T0.gold_dim_patient = [
    { patient_key: -1, patient_id: 'STRAY', patient_name: 'Unregistered Stray', species_key: 1, owner_key: -1, sex: 'Unknown', birth_date: null, weight_kg: null, temperament: 'Unknown', is_rune_tagged: false, registered_date: null },
    ...patients.map((p) => ({
      patient_key: p.key, patient_id: p.id, patient_name: p.name, species_key: p.breedKey, owner_key: p.owner.key, sex: p.sex, birth_date: p.birth,
      weight_kg: sentinel.has(p.key) ? null : p.weight, temperament: p.temperament, is_rune_tagged: p.rune, registered_date: p.registered
    }))
  ]
  T0.gold_dim_staff = staffRows
  // reference API dumps
  const procRef: BronzeRow[] = PROCEDURES.map((p) => ({ code: p.code, name: p.name, group: p.group, category: p.cat, gl_account: p.account, price: money(p.price * PRICE_LEVEL * inflation(today)), cost_ratio: p.cost }))
  injectCasing(procRef, 'group', { rng: rb, sink: ctx, code: 'GG19', rate: 0.2, atLeast: 2 })
  const env = (what: string) => ({ api: `clawsoft-pms/v3/${what}`, generated: formatDate(today, 'iso_t'), page: 1 })
  B0.push(
    { source: 'pms_reference', path: 'pms/reference/procedures.json', format: 'json', rows: procRef, json: { envelope: env('procedures'), dataKey: 'results' } },
    { source: 'pms_reference', path: 'pms/reference/clinics.json', format: 'json', rows: T0.silver_clinics.map((r) => ({ ...r }) as BronzeRow), json: { envelope: env('clinics'), dataKey: 'results' } },
    { source: 'pms_reference', path: 'pms/reference/diagnoses.json', format: 'json', rows: DIAGNOSES.map((d) => ({ code: d.code, name: d.name, category: d.group, severity: d.severity, seasonal: d.seasonal })), json: { envelope: env('diagnoses'), dataKey: 'results' } },
    { source: 'pms_reference', path: 'pms/reference/species.json', format: 'json', rows: T0.silver_species.map((r) => ({ ...r }) as BronzeRow), json: { envelope: env('species'), dataKey: 'results' } },
    { source: 'gl', path: 'finance/gl/chart_of_accounts.csv', format: 'csv', rows: T0.silver_accounts.map((r) => ({ ...r }) as BronzeRow) }
  )
  yield { label: 'static', tables: T0, bronze: B0 }

  // ---- simulation --------------------------------------------------------------------------------
  const rng = ctx.rng('sim')
  const driftDate = at(0.55)
  const onlineLaunch = at(0.3)
  const bigFluSeason = start.getUTCFullYear() + 1
  const flu = (d: Date, c: Clinic) => {
    const m = d.getUTCMonth() + 1
    if (m !== 12 && m > 2) return 0
    const season = m === 12 ? d.getUTCFullYear() + 1 : d.getUTCFullYear()
    return season === bigFluSeason ? (c.region === 'Highlands' ? 3.2 : 1.6) : 0.7
  }
  let apptSeq = 0
  let invoiceSeq = 0
  let paySeq = 0
  let claimSeq = 0
  let firstFile = true
  let strayPlanted = false
  let driftLogged = false
  const pendingAppts = new Map<number, BronzeRow[]>()
  const receipts = new Map<string, number>() // `${ccIdx}|${monthKey}` → cash
  const pendingPayments = new Map<number, BronzeRow[]>()
  const pendingClaims = new Map<number, BronzeRow[]>()
  const prevAp = new Map<number, number>()
  const prevBenefits = new Map<number, number>()
  // GL accumulators: `${ccIdx}|${account}|${monthKey}` → [debit, credit]
  const gl = new Map<string, [number, number]>()
  const post = (cc: number, acct: string, mk: number, dr: number, cr: number) => {
    const k = `${cc}|${acct}|${mk}`
    const v = gl.get(k) ?? [0, 0]
    v[0] += dr
    v[1] += cr
    gl.set(k, v)
  }

  const dxCandidates = (cls: string, d: Date, c: Clinic, surgery: boolean): { list: DxDef[]; w: number[] } => {
    const m = d.getUTCMonth() + 1
    const list = DIAGNOSES.filter((x) => x.code !== DX_ROUTINE && (x.classes === 'all' || x.classes.includes(cls)) && (!surgery || x.surgery))
    const w = list.map((x) => {
      let wt = x.weight
      if (x.code === DX_EMBER_FLU) wt *= flu(d, c) > 0 ? 1 + 4 * flu(d, c) : 0.12
      if (x.name === 'Molting Complications') wt *= m >= 3 && m <= 5 ? 3 : 0.5
      if (x.name === 'Wing Sprain' || x.name === 'Feather Mites') wt *= m >= 6 && m <= 8 ? 2 : 0.8
      return wt
    })
    return { list, w }
  }

  for (const monthStart of monthsOf(start, today)) {
    const monthEnd = minDate(endOfMonth(monthStart), today)
    const mk = monthKey(monthStart)
    const T: Record<string, Row[]> = {
      gold_fact_appointment: [], gold_fact_treatment_line: [], gold_fact_clinic_day: [], gold_bridge_appointment_diagnosis: [],
      silver_appointments: [], silver_appointment_diagnoses: [], silver_invoice_lines: [], silver_payments: [], silver_insurance_claims: [],
      silver_staff_snapshots: [], silver_payroll_monthly: [], silver_gl_journal_lines: []
    }
    const bronze: BronzeFile[] = []
    const billingRows: BronzeRow[] = []
    const dxRows: BronzeRow[] = []
    const rev = costCenters.map(() => new Map<string, number>())
    const cogsMed = costCenters.map(() => 0)
    const cogsSvc = costCenters.map(() => 0)
    const fireVisits = costCenters.map(() => 0)

    for (const day of eachDay(monthStart, monthEnd)) {
      const dk = dateKey(day)
      const wd = isoDow(day)
      const progress = clamp(daysBetween(start, day) / Math.max(1, span), 0, 1)
      for (const c of clinics) {
        if (!isOpen(c, day)) continue
        const hospital = c.type === 'Creature Hospital'
        const sunday = wd === 7
        const open = !sunday
        const { vets, nurses } = roster(c, day)
        const vetsOnDuty = sunday ? (hospital ? 1 : 0) : wd === 6 ? Math.max(1, Math.ceil(vets.length / 2)) : vets.length
        const typeMult = hospital ? 1.35 : c.type === 'Aerie' ? 0.9 : c.type === 'Aquatic Center' ? 0.75 : 1
        const dowMult = sunday ? (hospital ? 0.3 : 0) : [1.05, 1, 1, 1, 1.05, 0.6][wd - 1]
        const ramp = Math.min(1, 0.5 + (0.5 * daysBetween(c.opened, day)) / 120)
        const lambda = 3.3 * F * typeMult * dowMult * annualCycle(day, 25, 0.06) * (1 + 0.07 * progress * ctx.scale.years) * ramp * (1 + 0.12 * flu(day, c))
        const n = rng.poisson(lambda)
        let appts = 0
        let seen = 0
        let noShows = 0
        let cancels = 0
        let emerg = 0
        let booked = 0
        let waitSum = 0
        let revenue = 0
        for (let a = 0; a < n; a++) {
          // visit type & channel
          let visit: string
          if (sunday) visit = 'Emergency'
          else {
            const w = hospital ? [0.3, 0.3, 0.18, 0.1, 0.12] : c.type === 'Aerie' ? [0.35, 0.3, 0.1, c === aerie && day.getTime() >= at(0.5).getTime() ? 0.16 : 0.07, 0.17] : c.type === 'Aquatic Center' ? [0.35, 0.32, 0.1, 0.06, 0.17] : [0.42, 0.33, 0.06, 0.04, 0.15]
            visit = rng.weighted(VISIT_TYPES, w)
          }
          const onlineShare = day.getTime() >= onlineLaunch.getTime() ? 0.15 + 0.35 * progress : 0
          const channel = visit === 'Emergency' ? rng.weighted(CHANNELS, [0.4, 0, 0.6, 0]) : visit === 'Surgery' ? rng.weighted(CHANNELS, [0.4, onlineShare * 0.5, 0, 0.4]) : rng.weighted(CHANNELS, [0.85 - onlineShare, onlineShare, 0.08, 0.04])
          // patient (or stray)
          const stray = !strayPlanted || rng.chance(visit === 'Emergency' ? 0.05 : 0.01)
          let patient: Patient | null = null
          let breed: BreedDef
          if (!stray) {
            const sick = visit === 'Sick Visit' || visit === 'Emergency'
            const fl = flu(day, c)
            const m = day.getUTCMonth() + 1
            const cw = classes.map((cl) => {
              const pool = pools[c.idx].get(cl)
              if (!pool || !pool.length || pool[0].registered.getTime() > day.getTime()) return 0
              let w = CLASS_WEIGHTS[cl] * Math.sqrt(pool.length)
              if (sick && cl === CLASS_PHOENIX) w *= 1 + 2 * fl
              if (sick && cl === CLASS_DRAGON) w *= 1 + 0.6 * fl
              if ((cl === CLASS_DRAGON || cl === CLASS_GRIFFIN) && m >= 3 && m <= 5) w *= 1.3
              if (cl === CLASS_SEA && !hasTank(c, day)) w = 0
              return w
            })
            if (cw.some((x) => x > 0)) {
              const pool = pools[c.idx].get(rng.weighted(classes, cw))!
              let hi = pool.length
              while (hi > 0 && pool[hi - 1].registered.getTime() > day.getTime()) hi--
              for (let tries = 0; tries < 15 && !patient; tries++) {
                const cand = pool[rng.int(0, hi - 1)]
                if (rng.next() < cand.propensity / maxProp + 0.2) patient = cand
              }
              if (!patient) patient = pool[rng.int(0, hi - 1)]
            }
          }
          if (patient) breed = patient.breed
          else {
            const cls = rng.weighted(classes, classes.map((cl) => (cl === CLASS_SEA && !hasTank(c, day) ? 0 : CLASS_WEIGHTS[cl])))
            breed = rng.pick(breedsByClass.get(cls)!)
            if (stray && !strayPlanted) strayPlanted = true
          }
          const isStray = !patient
          if (isStray) ctx.issue('GG05')
          const owner = patient ? patient.owner : null
          const payerIdx = owner ? owner.payer : 0
          const payer = PAYERS[payerIdx]
          // timing
          const hour = visit === 'Emergency' ? (hospital ? rng.weighted([...Array(24).keys()], [1, 1, 1, 1, 1, 1, 2, 3, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 3, 3, 2, 2]) : rng.int(8, 17)) : rng.weighted([8, 9, 10, 11, 12, 13, 14, 15, 16, 17], [5, 8, 9, 8, 5, 6, 8, 8, 6, 4])
          const scheduledAt = new Date(day.getTime() + hour * 3_600_000 + rng.pick([0, 15, 30, 45]) * 60_000)
          const lead = visit === 'Emergency' || channel === 'Walk-in' ? 0 : visit === 'Wellness' ? rng.int(5, 45) : visit === 'Surgery' ? rng.int(5, 25) : visit === 'Follow-up' ? rng.int(7, 21) : rng.int(0, 3)
          const bookedDate = addDays(day, -lead)
          // status
          let noShowP = visit === 'Emergency' ? 0 : 0.045 + (channel === 'Online' ? 0.04 : 0) + (visit === 'Wellness' ? 0.02 : 0)
          if (c === onlineClinic && channel === 'Online' && day.getTime() >= onlineLaunch.getTime()) noShowP += 0.14
          const cancelP = visit === 'Emergency' ? 0 : 0.05
          const r = rng.next()
          const status = r < cancelP ? 'Cancelled' : r < cancelP + noShowP ? 'No-Show' : 'Completed'
          const isSeen = status === 'Completed'
          const vet = visit === 'Surgery' ? (vets.find((v) => attrsAt(v, day).role === 'Senior Veterinarian') ?? rng.pick(vets)) : rng.pick(vets)
          const vetSk = scd.lookup(vet.id, day)!
          apptSeq++
          appts++
          const apptId = `AP-${dk}-${c.code.slice(3)}-${String(a + 1).padStart(3, '0')}`
          const telehealth = isSeen && visit === 'Follow-up' && day.getTime() >= driftDate.getTime() && rng.chance(0.25)
          let wait: number | null = null
          let duration = 0
          const dxRanks: string[] = []
          let invoiceAmount = 0
          let invoiceNo: string | null = null
          if (status === 'No-Show') noShows++
          if (status === 'Cancelled') cancels++
          if (isSeen) {
            seen++
            if (visit === 'Emergency') emerg++
            if (breed.fire) fireVisits[c.idx]++
            const slow = c === slowClinic && day.getTime() >= at(0.65).getTime() ? 2.2 : 1
            wait = telehealth ? 0 : Math.max(0, Math.round(rng.logNormal(visit === 'Emergency' ? 5 : 12, 0.55) * slow))
            const baseDur = { Wellness: 40, 'Sick Visit': 60, Emergency: 110, Surgery: 180, 'Follow-up': 30 }[visit]!
            duration = Math.max(10, Math.round(baseDur * SIZE_TIME[breed.size] * rng.float(0.8, 1.25)))
            booked += duration
            waitSum += wait
            // diagnoses
            if (visit === 'Wellness') {
              dxRanks.push(DX_ROUTINE)
              if (rng.chance(0.15)) {
                const cand = dxCandidates(breed.cls, day, c, false)
                if (cand.list.length) dxRanks.push(rng.weighted(cand.list, cand.w).code)
              }
            } else {
              const cand = dxCandidates(breed.cls, day, c, visit === 'Surgery')
              const fallback = visit === 'Surgery' && !cand.list.length ? dxCandidates(breed.cls, day, c, false) : cand
              const k = 1 + (visit === 'Follow-up' ? 0 : rng.poisson(0.35))
              for (let i = 0; i < k && fallback.list.length; i++) {
                const d = rng.weighted(fallback.list, fallback.w).code
                if (!dxRanks.includes(d)) dxRanks.push(d)
              }
              if (!dxRanks.length) dxRanks.push('DX-017')
            }
            // billed lines
            const lines: Array<{ p: ProcDef; qty: number; by: 'vet' | 'nurse' }> = []
            const add = (code: string, qty = 1, by: 'vet' | 'nurse' = 'vet') => {
              const existing = lines.find((l) => l.p.code === code)
              if (existing) existing.qty += qty
              else lines.push({ p: procByCode.get(code)!, qty, by })
            }
            const primary = DIAGNOSES.find((d) => d.code === dxRanks[0])!
            if (visit === 'Wellness') {
              add('PX-101')
              if (rng.chance(0.7)) {
                const vacc = breed.cls === CLASS_PHOENIX || breed.cls === CLASS_DRAGON ? 'PX-151' : breed.cls === CLASS_GRIFFIN ? 'PX-154' : breed.cls === CLASS_SEA ? 'PX-152' : rng.pick(['PX-152', 'PX-153'])
                add(vacc, 1, 'nurse')
              }
              if (rng.chance(0.4)) add('PX-405', 1, 'nurse')
              if ((breed.cls === CLASS_DRAGON || breed.cls === CLASS_GRIFFIN || breed.cls === CLASS_PHOENIX) && rng.chance(0.2)) add(breed.cls === CLASS_DRAGON ? 'PX-351' : 'PX-352')
            } else {
              add(telehealth ? 'PX-105' : visit === 'Emergency' ? 'PX-103' : visit === 'Follow-up' ? 'PX-104' : 'PX-102')
            }
            for (const code of dxRanks) {
              const d = DIAGNOSES.find((x) => x.code === code)!
              if (visit === 'Wellness' && code === DX_ROUTINE) continue
              for (const t of d.tests) if (!telehealth && rng.chance(visit === 'Follow-up' ? 0.2 : visit === 'Emergency' || visit === 'Surgery' ? 0.85 : 0.55)) add(t)
              for (const med of d.meds) if (rng.chance(0.8)) add(med, rng.int(1, 3), 'nurse')
              if (d.name === 'Overgrown Beak or Horn') add('PX-352')
            }
            const doSurgery = visit === 'Surgery' || (visit === 'Emergency' && rng.chance(0.25))
            if (doSurgery) {
              add(primary.surgery ?? 'PX-305')
              add('PX-306')
              if (rng.chance(visit === 'Surgery' ? 0.65 : 0.45)) {
                const nights = rng.int(1, 4)
                add(breed.aquatic ? 'PX-503' : breed.flyer && (breed.size === 'Large' || breed.size === 'Colossal') ? 'PX-502' : 'PX-501', nights, 'nurse')
              }
            }
            // price the invoice
            invoiceSeq++
            invoiceNo = `INV-${c.code.slice(3)}-${String(invoiceSeq).padStart(7, '0')}`
            const planPct = owner && owner.plan !== 'None' ? 0.1 : 0
            lines.forEach((l, li) => {
              const unit = money(l.p.price * PRICE_LEVEL * SIZE_PRICE[breed.size] * inflation(day))
              const gross = money(unit * l.qty)
              const disc = l.p.cat === 'Service' ? money(gross * planPct) : 0
              const net = money(gross - disc)
              const cost = money(gross * l.p.cost)
              const performer = l.by === 'nurse' && rng.chance(0.6) ? rng.pick(nurses) : vet
              const perfSk = scd.lookup(performer.id, day)!
              invoiceAmount += net
              rev[c.idx].set(l.p.account, (rev[c.idx].get(l.p.account) ?? 0) + net)
              if (l.p.cat === 'Medication') cogsMed[c.idx] += cost
              else cogsSvc[c.idx] += cost
              T.gold_fact_treatment_line.push({
                invoice_number: invoiceNo!, line_number: li + 1, appointment_key: apptSeq, service_date: day, date_key: dk, clinic_key: c.key,
                patient_key: patient ? patient.key : -1, owner_key: owner ? owner.key : -1, species_key: breedKey.get(breed.code)!, procedure_key: procKey.get(l.p.code)!,
                staff_sk: perfSk, payer_key: payerIdx + 1, quantity: l.qty, unit_price: unit, gross_amount: gross, discount_amount: disc, net_amount: net, cost_amount: cost
              })
              T.silver_invoice_lines.push({
                invoice_number: invoiceNo!, line_number: li + 1, appointment_id: apptId, service_date: day, clinic_code: c.code, procedure_code: l.p.code, staff_id: performer.id,
                quantity: l.qty, unit_price: unit, discount_amount: disc, line_total: net, cost_amount: cost
              })
              billingRows.push({ invoice: invoiceNo!, line: li + 1, appointment_id: apptId, service_date: day, clinic: c.code, procedure_code: l.p.code, staff_id: performer.id, qty: l.qty, unit_price: unit, discount: disc, line_total: net })
            })
            invoiceAmount = money(invoiceAmount)
            revenue += invoiceAmount
          }
          // payments
          let ownerPaid = 0
          let insurerPaid = 0
          let paidDate: Date | null = null
          if (isSeen && invoiceAmount > 0) {
            const insured = owner !== null && payer.coverage > 0
            const insurerPart = insured ? money(invoiceAmount * payer.coverage) : 0
            const ownerPart = money(invoiceAmount - insurerPart)
            const ownerDate = rng.chance(0.86) ? day : rng.chance(0.93) ? addDays(day, rng.int(5, 45)) : null
            let insurerDate: Date | null = null
            if (insured) {
              const submitted = addDays(day, 1)
              let lag = Math.max(3, Math.round(rng.normal(payer.days, 5)))
              if (payer.code === 'PY-03') lag += Math.round(35 * progress)
              insurerDate = rng.chance(0.97) ? addDays(submitted, lag) : null
              if (submitted.getTime() <= today.getTime()) {
                claimSeq++
                const claimPaid = insurerDate && insurerDate.getTime() <= today.getTime() ? insurerDate : null
                const claimId = `CL-${String(claimSeq).padStart(7, '0')}`
                T.silver_insurance_claims.push({ claim_id: claimId, appointment_id: apptId, payer_code: payer.code, submitted_date: submitted, claim_amount: insurerPart, paid_date: claimPaid, status: claimPaid ? 'Paid' : 'Pending' })
                const smk = monthKey(submitted)
                const list = pendingClaims.get(smk) ?? []
                list.push({ claim_id: claimId, appointment_id: apptId, payer: { code: payer.code, name: payer.name }, submitted, claim_amount: insurerPart, paid_on: claimPaid, status: claimPaid ? 'PAID' : 'PENDING' })
                pendingClaims.set(smk, list)
              } else insurerDate = null
            }
            const pay = (who: string, amount: number, when: Date | null) => {
              if (!when || when.getTime() > today.getTime() || amount <= 0) return false
              paySeq++
              const id = `PM-${String(paySeq).padStart(8, '0')}`
              T.silver_payments.push({ payment_id: id, appointment_id: apptId, clinic_code: c.code, payer_code: who, payment_date: when, amount })
              const key = `${c.idx}|${monthKey(when)}`
              receipts.set(key, (receipts.get(key) ?? 0) + amount)
              const pmk = monthKey(when)
              const list = pendingPayments.get(pmk) ?? []
              list.push({ payment_id: id, appointment_id: apptId, clinic: c.code, payer: who, received: when, amount })
              pendingPayments.set(pmk, list)
              return true
            }
            if (pay('SELF', ownerPart, ownerDate)) ownerPaid = ownerPart
            if (pay(payer.code, insurerPart, insurerDate)) insurerPaid = insurerPart
            if (ownerPaid + insurerPaid >= invoiceAmount - 0.001) paidDate = maxDate(ownerPart > 0 ? ownerDate! : day, insurerPart > 0 ? insurerDate! : day)
          }
          const outstanding = isSeen ? money(invoiceAmount - ownerPaid - insurerPaid) : 0
          T.gold_fact_appointment.push({
            appointment_key: apptSeq, appointment_id: apptId, appointment_date: day, appointment_date_key: dk,
            booked_date_key: bookedDate.getTime() >= start.getTime() ? dateKey(bookedDate) : null, invoice_date_key: isSeen ? dk : null,
            paid_date_key: paidDate ? dateKey(paidDate) : null, clinic_key: c.key, patient_key: patient ? patient.key : -1, owner_key: owner ? owner.key : -1,
            species_key: breedKey.get(breed.code)!, staff_sk: vetSk, appointment_type_key: apptTypeKey(visit, channel), payer_key: payerIdx + 1, appointment_hour: hour,
            status: !isSeen ? status : paidDate ? 'Paid' : 'Invoiced', is_no_show: status === 'No-Show', is_seen: isSeen, lead_time_days: lead, wait_minutes: wait,
            duration_minutes: isSeen ? duration : null, diagnosis_count: dxRanks.length, invoice_amount: isSeen ? invoiceAmount : null, owner_paid_amount: isSeen ? ownerPaid : null,
            insurer_paid_amount: isSeen ? insurerPaid : null, outstanding_amount: isSeen ? outstanding : null, days_to_pay: paidDate ? daysBetween(day, paidDate) : null
          })
          const patientId = patient ? patient.id : `STRAY-${String(apptSeq).padStart(6, '0')}`
          T.silver_appointments.push({
            appointment_id: apptId, clinic_code: c.code, patient_id: patientId, vet_id: vet.id, visit_type: visit, booking_channel: channel, booked_date: bookedDate,
            scheduled_at: scheduledAt, appointment_date: day, status, wait_minutes: wait, duration_minutes: isSeen ? duration : null, is_telehealth: telehealth
          })
          dxRanks.forEach((code, i) => {
            T.gold_bridge_appointment_diagnosis.push({ appointment_key: apptSeq, diagnosis_key: dxKey.get(code)!, appointment_date: day, is_primary: i === 0, diagnosis_rank: i + 1 })
            T.silver_appointment_diagnoses.push({ appointment_id: apptId, diagnosis_code: code, appointment_date: day, diagnosis_rank: i + 1 })
            dxRows.push({ appointment_id: apptId, dx_code: code, rank: i + 1, visit_date: day })
          })
          // bronze record lands today or late
          const drift = day.getTime() >= driftDate.getTime()
          const rec: BronzeRow = {
            appointment_id: apptId, clinic: c.code, patient_id: patientId, [drift ? 'clinician_id' : 'vet_id']: vet.id, visit_type: visit, channel,
            booked_on: bookedDate, scheduled_at: scheduledAt, status, wait_min: wait, duration_min: isSeen ? duration : null
          }
          if (drift) rec.telehealth = telehealth
          const land = minDate(landingDay(day, { rng, sink: ctx, code: 'GG02', rate: 0.015, maxDelay: 7 }), today)
          const lk = dateKey(land)
          const pend = pendingAppts.get(lk)
          if (pend) pend.push(rec)
          else pendingAppts.set(lk, [rec])
        }
        T.gold_fact_clinic_day.push({
          clinic_key: c.key, date_key: dk, is_open: open, vets_on_duty: vetsOnDuty, available_minutes: vetsOnDuty * 480, booked_minutes: booked, appointments: appts,
          visits_seen: seen, no_shows: noShows, cancellations: cancels, emergencies: emerg, total_wait_minutes: waitSum, revenue: money(revenue)
        })
      }
      // daily PMS page
      const landed = pendingAppts.get(dk) ?? []
      pendingAppts.delete(dk)
      if (landed.length) {
        if (day.getTime() >= driftDate.getTime() && !driftLogged) {
          ctx.issue('GG03')
          driftLogged = true
        }
        const o = { rng, sink: ctx }
        const rows = injectDuplicates(landed, { ...o, code: 'GG01', rate: 0.006, atLeast: firstFile ? 1 : 0 })
        injectCasing(rows, 'status', { ...o, code: 'GG04', rate: 0.03, atLeast: firstFile ? 1 : 0 })
        firstFile = false
        const y = day.getUTCFullYear()
        const mm = String(day.getUTCMonth() + 1).padStart(2, '0')
        const dd = String(day.getUTCDate()).padStart(2, '0')
        bronze.push({ source: 'pms_appointments', path: `pms/appointments/${y}/${mm}/${dd}/appointments_${dk}.json`, format: 'json', rows, json: { envelope: { api: `clawsoft-pms/${day.getTime() >= driftDate.getTime() ? 'v4' : 'v3'}/appointments`, date: isoDate(day), page: 1 }, dataKey: 'results' } })
      }
    }

    // ---- month end: HR snapshot, payroll, expenses, GL journals ---------------------------------
    const mEnd = endOfMonth(monthStart)
    const dim = daysInMonth(monthStart)
    const first = mk === monthKey(start)
    const payroll = costCenters.map(() => new Map<string, number>())
    const benefits = costCenters.map(() => 0)
    const ccIdx = new Map(costCenters.map((c) => [c.code, c.idx]))
    const payrollBronze: BronzeRow[] = []
    for (const s of staff) {
      const firstDay = maxDate(monthStart, s.hire)
      const lastDay = s.termination ? minDate(monthEnd, addDays(s.termination, -1)) : monthEnd
      if (lastDay.getTime() < firstDay.getTime()) continue
      const a = attrsAt(s, lastDay)
      const days = daysBetween(firstDay, lastDay) + 1
      const gross = money(((a.annual_salary as number) / 12) * (days / dim))
      const ben = money(gross * 0.22)
      const ci = ccIdx.get(a.clinic_code as string)!
      payroll[ci].set(a.role_group as string, (payroll[ci].get(a.role_group as string) ?? 0) + gross)
      benefits[ci] += ben
      T.silver_payroll_monthly.push({ pay_month: mEnd, staff_id: s.id, clinic_code: a.clinic_code, role_group: a.role_group, days_paid: days, gross_pay: gross, employer_benefits: ben })
      payrollBronze.push({ period: ym(monthStart), staff_id: s.id, cost_center: a.clinic_code as string, group: a.role_group as string, days, gross_pay: gross, benefits: ben })
    }
    for (const s of staff) {
      if (s.hire.getTime() > monthEnd.getTime()) continue
      if (s.termination && s.termination.getTime() < monthStart.getTime()) continue
      const a = attrsAt(s, monthEnd)
      T.silver_staff_snapshots.push({
        snapshot_date: mEnd, staff_id: s.id, full_name: a.full_name, role: a.role, specialty: a.specialty, clinic_code: a.clinic_code, salary_band: a.salary_band,
        annual_salary: a.annual_salary, employment_status: a.employment_status, hire_date: s.hire
      })
    }
    const hrBronze: BronzeRow[] = T.silver_staff_snapshots.map((r) => ({
      staff_id: r.staff_id as string, name: r.full_name as string, role: r.role as string, specialty: r.specialty as string, clinic: r.clinic_code as string,
      band: r.salary_band as string, salary: r.annual_salary as number, status: r.employment_status as string, hire_date: r.hire_date as Date
    }))
    // journals
    const glRows: BronzeRow[] = []
    let lineNo = 0
    const journal = (cc: Clinic, type: string, lines: Array<[string, number, number, string]>) => {
      const kept = lines.map(([acct, dr, cr, desc]) => [acct, money(dr), money(cr), desc] as [string, number, number, string]).filter(([, dr, cr]) => dr > 0 || cr > 0)
      if (!kept.length) return
      // force exact balance after rounding (difference goes to the last balancing line)
      const diff = money(kept.reduce((s, [, dr]) => s + dr, 0) - kept.reduce((s, [, , cr]) => s + cr, 0))
      if (diff !== 0) {
        const last = kept[kept.length - 1]
        if (last[2] > 0) last[2] = money(last[2] + diff)
        else last[1] = money(last[1] - diff)
      }
      const jid = `JE-${ym(monthStart)}-${cc.code.slice(3)}-${type}`
      lineNo = 0
      for (const [acct, dr, cr, desc] of kept) {
        lineNo++
        T.silver_gl_journal_lines.push({ journal_id: jid, line_number: lineNo, posting_date: monthEnd, journal_type: type, clinic_code: cc.code, account_code: acct, debit: dr, credit: cr, description: desc })
        glRows.push({ journal: jid, line: lineNo, posting_date: monthEnd, type, cost_center: cc.code, account: acct, debit: dr, credit: cr, memo: desc })
        post(cc.idx, acct, mk, dr, cr)
      }
    }
    const S = F
    const yearMult = inflation(monthStart)
    for (const cc of costCenters) {
      const opened = isOpen(cc, monthEnd)
      if (!opened && payroll[cc.idx].size === 0) continue
      const revLines = [...rev[cc.idx].entries()].sort((a, b) => a[0].localeCompare(b[0]))
      const totalRev = revLines.reduce((s, [, v]) => s + v, 0)
      if (totalRev > 0) journal(cc, 'REV', [['1100', totalRev, 0, 'Invoices raised'], ...revLines.map(([acct, v]) => [acct, 0, v, 'Revenue'] as [string, number, number, string])])
      const cash = receipts.get(`${cc.idx}|${mk}`) ?? 0
      if (cash > 0) journal(cc, 'CASH', [['1000', cash, 0, 'Receipts banked'], ['1100', 0, cash, 'Receipts applied']])
      const med = cogsMed[cc.idx]
      const svc = cogsSvc[cc.idx]
      if (med + svc > 0) journal(cc, 'COGS', [['5000', med, 0, 'Medications dispensed'], ['5100', svc, 0, 'Supplies used'], ['1200', 0, med + svc, 'Inventory relieved']])
      const purchases = money((med + svc) * rng.float(0.92, 1.1))
      // operating expenses (scaled with the network size)
      const t = cc.type
      const rent = money((t === 'Creature Hospital' ? 16000 : t === 'Aerie' ? 12000 : t === 'Aquatic Center' ? 14000 : t === 'Head Office' ? 7000 : 9000) * S * yearMult)
      const scorch = cc === scorchClinic && ((monthStart.getUTCMonth() === 11 && monthStart.getUTCFullYear() === bigFluSeason - 1) || (monthStart.getUTCMonth() <= 1 && monthStart.getUTCFullYear() === bigFluSeason)) ? 1.45 : 1
      const util = money(((t === 'Creature Hospital' ? 3200 : t === 'Aerie' ? 2200 : t === 'Aquatic Center' ? 4500 : t === 'Head Office' ? 800 : 1600) * S * annualCycle(monthStart, 15, 0.35) + fireVisits[cc.idx] * 35) * scorch)
      const repairs = money(rng.poisson(0.6) * rng.logNormal(1200, 0.7) * S)
      const marketing = money((t === 'Head Office' ? 6000 : 600) * S * (monthStart.getUTCMonth() === 8 ? 2 : 1) * rng.float(0.9, 1.1))
      const insurance = money((t === 'Creature Hospital' ? 2800 : t === 'Head Office' ? 1000 : 1600) * S * yearMult)
      const training = money((t === 'Head Office' ? 500 : 400) * S * (monthStart.getUTCMonth() === 9 ? 3 : 1))
      const wages = payroll[cc.idx]
      const wageTotal = [...wages.values()].reduce((s, v) => s + v, 0)
      if (wageTotal > 0) {
        journal(cc, 'PAYROLL', [
          ...(['Veterinary', 'Nursing & Handling', 'Admin'].filter((g) => wages.has(g)).map((g) => [WAGE_ACCOUNT[g], wages.get(g)!, 0, `${g} payroll`] as [string, number, number, string])),
          ['6100', benefits[cc.idx], 0, 'Employer taxes & benefits'],
          ['1000', 0, wageTotal, 'Net wages paid'],
          ['2100', 0, benefits[cc.idx], 'Benefits accrued']
        ])
      }
      const exp: Array<[string, number]> = opened ? [['6200', rent], ['6300', util], ['6400', repairs], ['6500', marketing], ['6600', insurance], ['6700', training]] : []
      const expTotal = exp.reduce((s, [, v]) => s + v, 0) + purchases
      if (expTotal > 0) journal(cc, 'EXPENSE', [...exp.map(([a, v]) => [a, v, 0, 'Supplier invoices'] as [string, number, number, string]), ['1200', purchases, 0, 'Medication & supply purchases'], ['2000', 0, expTotal, 'Payable to suppliers']])
      const apPay = prevAp.get(cc.idx) ?? 0
      const benPay = prevBenefits.get(cc.idx) ?? 0
      if (apPay + benPay > 0) journal(cc, 'PAYOUT', [['2000', apPay, 0, 'Suppliers paid'], ['2100', benPay, 0, 'Benefits remitted'], ['1000', 0, apPay + benPay, 'Bank payments']])
      prevAp.set(cc.idx, money(expTotal))
      prevBenefits.set(cc.idx, money(benefits[cc.idx]))
    }
    // bronze monthly files
    const mo = { rng, sink: ctx }
    injectFormattedNumbers(billingRows, 'line_total', { ...mo, code: 'GG06', rate: 0.05, atLeast: first ? 1 : 0 })
    injectWhitespace(billingRows, 'procedure_code', { ...mo, code: 'GG07', rate: 0.02, atLeast: first ? 1 : 0 })
    injectOutliers(billingRows, 'qty', { ...mo, code: 'GG08', rate: 0.002, mode: 'extreme', factor: 100, atLeast: first ? 1 : 0 })
    injectDateFormats(hrBronze, 'hire_date', { ...mo, code: 'GG14', rate: 0.15, formats: ['us', 'eu', 'long'], atLeast: first ? 1 : 0 })
    injectFormattedNumbers(payrollBronze, 'gross_pay', { ...mo, code: 'GG15', rate: 0.25, atLeast: first ? 1 : 0 })
    if (yearsFromStart(monthStart) === 0) injectDateFormats(glRows, 'posting_date', { ...mo, code: 'GG16', rate: 0.5, formats: ['eu'], atLeast: first ? 1 : 0 })
    const claimRows = pendingClaims.get(mk) ?? []
    pendingClaims.delete(mk)
    injectOutliers(claimRows, 'claim_amount', { ...mo, code: 'GG18', rate: 0.02, mode: 'negative', atLeast: first && claimRows.length ? 1 : 0 })
    const paymentRows = pendingPayments.get(mk) ?? []
    pendingPayments.delete(mk)
    const y = monthStart.getUTCFullYear()
    const tag = ym(monthStart)
    bronze.push(
      { source: 'billing', path: `billing/${y}/invoice_lines_${tag}.csv`, format: 'csv', rows: billingRows, columns: ['invoice', 'line', 'appointment_id', 'service_date', 'clinic', 'procedure_code', 'staff_id', 'qty', 'unit_price', 'discount', 'line_total'] },
      { source: 'diagnoses', path: `clinical/${y}/appointment_diagnoses_${tag}.csv`, format: 'csv', rows: dxRows, columns: ['appointment_id', 'dx_code', 'rank', 'visit_date'] },
      { source: 'payments', path: `billing/payments/${y}/payments_${tag}.csv`, format: 'csv', rows: paymentRows, columns: ['payment_id', 'appointment_id', 'clinic', 'payer', 'received', 'amount'] },
      { source: 'hr', path: `hr/staff/staff_${tag}.csv`, format: 'csv', rows: hrBronze },
      { source: 'payroll', path: `hr/payroll/${y}/payroll_${tag}.csv`, format: 'csv', rows: payrollBronze },
      { source: 'gl', path: `finance/gl/${y}/journal_lines_${tag}.csv`, format: 'csv', rows: glRows, columns: ['journal', 'line', 'posting_date', 'type', 'cost_center', 'account', 'debit', 'credit', 'memo'] }
    )
    if (claimRows.length) bronze.push({ source: 'claims', path: `insurance/${y}/claims_${tag}.ndjson`, format: 'ndjson', rows: claimRows })
    yield { label: `${y}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`, tables: T, bronze }
  }

  // ---- closing: GL monthly snapshot with budget ------------------------------------------------
  const rbud = ctx.rng('budget')
  const plAccounts = ACCOUNTS.filter((a) => a.statement === 'Profit & Loss')
  const months: Date[] = [...monthsOf(start, ctx.calendarEnd)]
  const todayMk = monthKey(today)
  const actual = (cc: number, a: (typeof ACCOUNTS)[number], mk: number): number => {
    const v = gl.get(`${cc}|${a.code}|${mk}`)
    if (!v) return 0
    return a.type === 'Revenue' ? v[1] - v[0] : v[0] - v[1]
  }
  // budget: planned at each fiscal-year start from the prior fiscal year (first year: planners' own estimate)
  const fyMonths = new Map<number, Date[]>()
  const lastFy = fiscalYear(ctx.calendarEnd, 4)
  for (let m = startOfMonth(start); fiscalYear(m, 4) <= lastFy; m = ymd(m.getUTCFullYear(), m.getUTCMonth() + 2, 1)) {
    const fy = fiscalYear(m, 4)
    const fl = fyMonths.get(fy)
    if (fl) fl.push(m)
    else fyMonths.set(fy, [m])
  }
  const budget = new Map<string, number>()
  const silverBudget: Row[] = []
  const workbooks: BronzeFile[] = []
  for (const [fy, list] of fyMonths) {
    const rows: BronzeRow[] = []
    for (const cc of costCenters) {
      for (const a of plAccounts) {
        const priorMonths = [...monthsOf(ymd(fy - 2, 4, 1), ymd(fy - 1, 3, 1))].filter((m) => m.getTime() >= startOfMonth(start).getTime() && monthKey(m) < todayMk)
        const ownMonths = list.filter((m) => monthKey(m) < todayMk)
        const basis = priorMonths.length >= 3 ? priorMonths : ownMonths.length ? ownMonths : priorMonths
        const values = basis.map((m) => actual(cc.idx, a, monthKey(m)))
        const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0
        const uplift = a.type === 'Revenue' ? 1.07 : 1.03
        const row: BronzeRow = { 'Cost Center': cc.code, Account: a.code, 'Account Name': a.name }
        for (let fm = 1; fm <= 12; fm++) {
          const monthDate = 3 + fm > 12 ? ymd(fy, 3 + fm - 12, 1) : ymd(fy - 1, 3 + fm, 1)
          const same = basis.find((b) => fiscalMonth(b, 4) === fm)
          const season = same && avg > 0 ? clamp(actual(cc.idx, a, monthKey(same)) / avg, 0.6, 1.6) : 1
          const value = Math.round(avg * uplift * (0.5 + 0.5 * season) * rbud.normal(1, 0.04))
          const label = MONTH_NAMES[monthDate.getUTCMonth()].slice(0, 3)
          row[label] = value === 0 ? null : value
          if (monthDate.getTime() < startOfMonth(start).getTime()) continue
          budget.set(`${cc.idx}|${a.code}|${monthKey(monthDate)}`, value)
          silverBudget.push({ fiscal_year: fy, clinic_code: cc.code, account_code: a.code, budget_month: endOfMonth(monthDate), budget_amount: value })
        }
        rows.push(row)
      }
    }
    injectWhitespace(rows, 'Account', { rng: rbud, sink: ctx, code: 'GG17', rate: 0.05, atLeast: 1 })
    workbooks.push({
      source: 'budget', path: `finance/budget/budget_FY${String(fy).slice(2)}.xlsx`, format: 'xlsx', rows,
      columns: ['Cost Center', 'Account', 'Account Name', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'],
      xlsx: { sheet: `FY${String(fy).slice(2)} Budget`, titleLines: ['Griffin & Gecko Creature Care — Operating Budget', `Fiscal year FY${String(fy).slice(2)} (April – March) · USD · natural sign`] }
    })
  }
  const glRowsOut: Row[] = []
  for (const cc of costCenters) {
    for (const a of ACCOUNTS) {
      let balance = 0
      for (const m of months) {
        const mk = monthKey(m)
        const future = mk > todayMk
        const v = gl.get(`${cc.idx}|${a.code}|${mk}`) ?? [0, 0]
        balance += v[0] - v[1]
        const pl = a.statement === 'Profit & Loss'
        glRowsOut.push({
          account_key: accountKey.get(a.code)!, clinic_key: cc.key, month_end_date_key: dateKey(endOfMonth(m)),
          debit_amount: future ? null : money(v[0]), credit_amount: future ? null : money(v[1]), net_change: future ? null : money(v[0] - v[1]),
          closing_balance: future || pl ? null : money(balance), actual_amount: future || !pl ? null : money(actual(cc.idx, a, mk)),
          budget_amount: pl ? (budget.get(`${cc.idx}|${a.code}|${mk}`) ?? 0) : null
        })
      }
    }
  }
  yield { label: 'closing', tables: { gold_fact_gl_month: glRowsOut, silver_budget: silverBudget }, bronze: workbooks }
}
