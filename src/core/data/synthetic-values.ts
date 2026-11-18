/**
 * Building blocks for the synthetic-data generator: seeded PRNG, name tokenization, label pools,
 * person / company / place generators, and calendar (date-table) column derivations.
 * Pure and deterministic — every random choice goes through an `Rng` created from a seed.
 */
import type { DataType } from '../model/types'
import { makeDate, type Scalar } from '../model/data'

// ---------------------------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------------------------

/** FNV-1a 32-bit hash of a string (stable seed derivation). */
export function hash32(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export class Rng {
  private s: number
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9
  }
  /** mulberry32: uniform in [0, 1) */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1))
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }
  chance(p: number): boolean {
    return this.next() < p
  }
  normal(): number {
    let u = 0
    while (u === 0) u = this.next()
    const v = this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  /** lognormal with the given median and sigma */
  lognormal(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.normal())
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const t = arr[i]
      arr[i] = arr[j]
      arr[j] = t
    }
    return arr
  }
}

/** Sampler over indices 0..n-1 with weights; O(log n) per draw. */
export class WeightedSampler {
  private readonly cdf: Float64Array
  constructor(weights: ArrayLike<number>) {
    this.cdf = new Float64Array(weights.length)
    let acc = 0
    for (let i = 0; i < weights.length; i++) {
      acc += Math.max(0, weights[i])
      this.cdf[i] = acc
    }
    if (acc <= 0) for (let i = 0; i < this.cdf.length; i++) this.cdf[i] = i + 1
  }
  get size(): number {
    return this.cdf.length
  }
  draw(rng: Rng): number {
    const n = this.cdf.length
    if (n <= 1) return 0
    const x = rng.next() * this.cdf[n - 1]
    let lo = 0
    let hi = n - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.cdf[mid] > x) hi = mid
      else lo = mid + 1
    }
    return lo
  }
}

/** Zipf-like weights 1/(k+1)^s. */
export function zipfWeights(n: number, s = 0.9): Float64Array {
  const w = new Float64Array(n)
  for (let k = 0; k < n; k++) w[k] = 1 / Math.pow(k + 1, s)
  return w
}

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

/** Split a column / table name into lowercase tokens: `MonthName` -> [month, name], `customer_guid` -> [customer, guid]. */
export function tokensOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/** Strip common table prefixes (dim_, fact_, d_, f_, tbl_) and pluralization: `dim_customers` -> `customer`. */
export function entityOf(tableName: string): string {
  const toks = tokensOf(tableName).filter((t) => !['dim', 'fact', 'fct', 'tbl', 'd', 'f', 'dw', 'stg', 'vw', 'lkp', 'lookup', 'ref', 'bridge'].includes(t))
  const last = toks[toks.length - 1] ?? tableName.toLowerCase()
  return singular(last)
}

export function singular(w: string): string {
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
  if (/(ses|xes|ches|shes)$/.test(w)) return w.slice(0, -2)
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1)
  return w
}

export function titleCase(s: string): string {
  return s
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

// ---------------------------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------------------------

export const FIRST_NAMES = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda', 'David', 'Elizabeth', 'William', 'Barbara',
  'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Lisa', 'Daniel', 'Nancy',
  'Matthew', 'Betty', 'Anthony', 'Sandra', 'Mark', 'Margaret', 'Donald', 'Ashley', 'Steven', 'Kimberly', 'Andrew', 'Emily',
  'Paul', 'Donna', 'Joshua', 'Michelle', 'Kenneth', 'Carol', 'Kevin', 'Amanda', 'Brian', 'Melissa', 'George', 'Deborah',
  'Timothy', 'Stephanie', 'Ronald', 'Rebecca', 'Jason', 'Sharon', 'Edward', 'Laura', 'Jeffrey', 'Cynthia', 'Ryan', 'Amy',
  'Jacob', 'Kathleen', 'Gary', 'Angela', 'Nicholas', 'Shirley', 'Eric', 'Brenda', 'Jonathan', 'Emma', 'Stephen', 'Anna',
  'Larry', 'Pamela', 'Justin', 'Nicole', 'Scott', 'Samantha', 'Brandon', 'Katherine', 'Benjamin', 'Christine', 'Samuel', 'Helen',
  'Gregory', 'Debra', 'Alexander', 'Rachel', 'Patrick', 'Carolyn', 'Frank', 'Janet', 'Raymond', 'Maria', 'Jack', 'Olivia',
  'Dennis', 'Heather', 'Jerry', 'Diane', 'Tyler', 'Julie', 'Aaron', 'Joyce', 'Jose', 'Victoria', 'Adam', 'Ruth', 'Nathan',
  'Virginia', 'Henry', 'Lauren', 'Zachary', 'Kelly', 'Douglas', 'Christina', 'Peter', 'Joan', 'Kyle', 'Evelyn', 'Noah', 'Judith'
] as const

export const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez',
  'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
  'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres',
  'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts',
  'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker', 'Cruz', 'Edwards', 'Collins', 'Reyes', 'Stewart', 'Morris', 'Morales',
  'Murphy', 'Cook', 'Rogers', 'Gutierrez', 'Ortiz', 'Morgan', 'Cooper', 'Peterson', 'Bailey', 'Reed', 'Kelly', 'Howard', 'Ramos',
  'Kim', 'Cox', 'Ward', 'Richardson', 'Watson', 'Brooks', 'Chavez', 'Wood', 'James', 'Bennett', 'Gray', 'Mendoza', 'Ruiz', 'Hughes',
  'Price', 'Alvarez', 'Castillo', 'Sanders', 'Patel', 'Myers', 'Long', 'Ross', 'Foster', 'Jimenez'
] as const

const COMPANY_A = [
  'Northwind', 'Contoso', 'Fabrikam', 'Tailspin', 'Adventure', 'Litware', 'Proseware', 'Woodgrove', 'Alpine', 'Blue Yonder',
  'Coho', 'Wingtip', 'Lucerne', 'Margie', 'Fourth Coffee', 'Trey', 'Humongous', 'Wide World', 'Graphic', 'Southridge',
  'Summit', 'Pinnacle', 'Riverbend', 'Lakeside', 'Granite', 'Evergreen', 'Silverline', 'Brightpath', 'Keystone', 'Harbor',
  'Redwood', 'Crescent', 'Meridian', 'Northstar', 'Bluewater', 'Ironwood', 'Clearview', 'Oakridge', 'Sterling', 'Horizon'
] as const
const COMPANY_B = [
  'Health', 'Industries', 'Group', 'Systems', 'Logistics', 'Partners', 'Holdings', 'Solutions', 'Manufacturing', 'Financial',
  'Energy', 'Foods', 'Retail', 'Labs', 'Analytics', 'Consulting', 'Insurance', 'Media', 'Motors', 'Pharma', 'Bank', 'Airlines',
  'Hospitality', 'Construction', 'Software', 'Telecom', 'Utilities', 'Education', 'Medical', 'Services'
] as const
const COMPANY_C = ['Inc.', 'LLC', 'Corp.', 'Co.', 'Ltd.', ''] as const

export const US_STATES: ReadonlyArray<[string, string]> = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'],
  ['CT', 'Connecticut'], ['DE', 'Delaware'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'],
  ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'],
  ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
  ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
  ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming']
]

/** [city, state abbr, zip prefix] */
export const US_CITIES: ReadonlyArray<[string, string, string]> = [
  ['New York', 'NY', '100'], ['Los Angeles', 'CA', '900'], ['Chicago', 'IL', '606'], ['Houston', 'TX', '770'],
  ['Phoenix', 'AZ', '850'], ['Philadelphia', 'PA', '191'], ['San Antonio', 'TX', '782'], ['San Diego', 'CA', '921'],
  ['Dallas', 'TX', '752'], ['Austin', 'TX', '787'], ['Jacksonville', 'FL', '322'], ['Columbus', 'OH', '432'],
  ['Charlotte', 'NC', '282'], ['Indianapolis', 'IN', '462'], ['Seattle', 'WA', '981'], ['Denver', 'CO', '802'],
  ['Boston', 'MA', '021'], ['Nashville', 'TN', '372'], ['Detroit', 'MI', '482'], ['Portland', 'OR', '972'],
  ['Las Vegas', 'NV', '891'], ['Memphis', 'TN', '381'], ['Louisville', 'KY', '402'], ['Baltimore', 'MD', '212'],
  ['Milwaukee', 'WI', '532'], ['Albuquerque', 'NM', '871'], ['Atlanta', 'GA', '303'], ['Kansas City', 'MO', '641'],
  ['Omaha', 'NE', '681'], ['Raleigh', 'NC', '276'], ['Miami', 'FL', '331'], ['Minneapolis', 'MN', '554'],
  ['Tampa', 'FL', '336'], ['New Orleans', 'LA', '701'], ['Cleveland', 'OH', '441'], ['Pittsburgh', 'PA', '152'],
  ['St. Louis', 'MO', '631'], ['Cincinnati', 'OH', '452'], ['Salt Lake City', 'UT', '841'], ['Richmond', 'VA', '232'],
  ['Buffalo', 'NY', '142'], ['Rochester', 'NY', '146'], ['Hartford', 'CT', '061'], ['Providence', 'RI', '029'],
  ['Birmingham', 'AL', '352'], ['Des Moines', 'IA', '503'], ['Boise', 'ID', '837'], ['Little Rock', 'AR', '722']
]

export const COUNTRIES = [
  'United States', 'Canada', 'United Kingdom', 'Germany', 'France', 'Mexico', 'Australia', 'Japan', 'India', 'Brazil',
  'Netherlands', 'Spain', 'Italy', 'Ireland', 'Sweden', 'Singapore', 'South Africa', 'New Zealand', 'Switzerland', 'Poland'
] as const

const STREETS = ['Main St', 'Oak Ave', 'Maple Dr', 'Cedar Ln', 'Park Blvd', 'Pine St', 'Elm St', 'Washington Ave', 'Lake Rd', 'Hill St', 'Market St', 'Broadway']

const LOREM = (
  'quick follow up requested by client regarding service scheduling and next steps review completed with positive ' +
  'outcome additional information needed before approval escalated to supervisor for resolution customer reported ' +
  'issue resolved after call notes updated pending documentation received referral provided program overview shared'
).split(' ')

/** Categorical label pools keyed by a column-name token. First match (in token order of the column) wins. */
export const CATEGORY_POOLS: Record<string, readonly string[]> = {
  status: ['Active', 'Inactive', 'Pending', 'Closed', 'Open', 'On Hold'],
  stage: ['Prospect', 'Qualified', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'],
  priority: ['Low', 'Medium', 'High', 'Critical'],
  severity: ['Low', 'Medium', 'High', 'Critical'],
  risk: ['Low', 'Moderate', 'High'],
  gender: ['Female', 'Male', 'Non-binary', 'Prefer not to say'],
  sex: ['Female', 'Male'],
  marital: ['Single', 'Married', 'Divorced', 'Widowed', 'Separated'],
  race: ['White', 'Black or African American', 'Asian', 'Hispanic or Latino', 'Two or More Races', 'Other'],
  ethnicity: ['Hispanic or Latino', 'Not Hispanic or Latino', 'Unknown'],
  region: ['Northeast', 'Southeast', 'Midwest', 'Southwest', 'West'],
  territory: ['North', 'South', 'East', 'West', 'Central'],
  segment: ['Enterprise', 'Mid Market', 'Small Business', 'Public Sector'],
  tier: ['Bronze', 'Silver', 'Gold', 'Platinum'],
  channel: ['Phone', 'Email', 'Web', 'Chat', 'In Person'],
  source: ['Referral', 'Website', 'Partner', 'Event', 'Outbound', 'Inbound Call'],
  industry: ['Healthcare', 'Manufacturing', 'Retail', 'Financial Services', 'Technology', 'Education', 'Government', 'Transportation', 'Energy', 'Hospitality'],
  department: ['Sales', 'Marketing', 'Finance', 'Operations', 'HR', 'IT', 'Customer Success', 'Legal'],
  team: ['Team A', 'Team B', 'Team C', 'Team D'],
  role: ['Analyst', 'Manager', 'Director', 'Specialist', 'Coordinator', 'Associate'],
  title: ['Analyst', 'Senior Analyst', 'Manager', 'Director', 'Vice President', 'Coordinator', 'Specialist'],
  product: ['Core', 'Premium', 'Basic', 'Plus', 'Enterprise', 'Starter'],
  service: ['Installation', 'Consultation', 'Support', 'Training', 'Maintenance', 'Repair'],
  payment: ['Credit Card', 'ACH', 'Invoice', 'Check', 'Wire'],
  outcome: ['Resolved', 'Referred', 'Escalated', 'No Action', 'Follow-up Scheduled'],
  disposition: ['Completed', 'Referred', 'Declined', 'No Show', 'Cancelled'],
  resolution: ['Resolved', 'Unresolved', 'Referred', 'Withdrawn'],
  reason: ['Price', 'Quality', 'Delivery', 'Service', 'Product Fit', 'Other'],
  language: ['English', 'Spanish', 'French', 'Chinese', 'Vietnamese'],
  platform: ['Web', 'iOS', 'Android', 'Desktop'],
  device: ['Desktop', 'Mobile', 'Tablet'],
  browser: ['Chrome', 'Edge', 'Safari', 'Firefox'],
  currency: ['USD', 'EUR', 'GBP', 'CAD'],
  frequency: ['Monthly', 'Quarterly', 'Annual', 'One-time'],
  contract: ['Annual', 'Multi-year', 'Month-to-month', 'Pilot'],
  plan: ['Basic', 'Standard', 'Premium'],
  employment: ['Full-time', 'Part-time', 'Contractor', 'Temporary'],
  occupation: ['Professional', 'Clerical', 'Technical', 'Management', 'Service', 'Labor'],
  age: ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'],
  size: ['Small', 'Medium', 'Large', 'Enterprise'],
  bucket: ['0-5', '6-15', '16-30', '31-60', '60+'],
  range: ['Low', 'Medium', 'High'],
  group: ['Group A', 'Group B', 'Group C', 'Group D', 'Group E'],
  category: ['Category A', 'Category B', 'Category C', 'Category D', 'Category E'],
  class: ['Class A', 'Class B', 'Class C'],
  type: ['Type A', 'Type B', 'Type C', 'Type D'],
  kind: ['Standard', 'Special', 'Other'],
  level: ['Level 1', 'Level 2', 'Level 3', 'Level 4'],
  brand: ['Brand A', 'Brand B', 'Brand C'],
  program: ['Program A', 'Program B', 'Program C', 'Program D'],
  model: ['Standard', 'Premium', 'Custom'],
  method: ['Online', 'Phone', 'Mail', 'In Person'],
  mode: ['Online', 'Offline', 'Hybrid'],
  direction: ['Inbound', 'Outbound'],
  result: ['Success', 'Failure', 'Partial'],
  satisfaction: ['Very Satisfied', 'Satisfied', 'Neutral', 'Dissatisfied', 'Very Dissatisfied'],
  nps: ['Promoter', 'Passive', 'Detractor'],
  forecast: ['Pipeline', 'Best Case', 'Commit', 'Closed'],
  queue: ['General', 'Billing', 'Clinical', 'Technical', 'Escalations'],
  location: ['Headquarters', 'Branch Office', 'Remote', 'Field'],
  answer: ['Yes', 'No', 'Not Sure'],
  zone: ['Eastern', 'Central', 'Mountain', 'Pacific'],
  timezone: ['Eastern', 'Central', 'Mountain', 'Pacific'],
  shift: ['Day', 'Evening', 'Night'],
  yes: ['Yes', 'No']
}

/** Tokens that mark a string column as categorical (a small set of labels). */
export const CATEGORICAL_TOKENS = new Set([
  ...Object.keys(CATEGORY_POOLS),
  'flag', 'code', 'label', 'bucket', 'band', 'class', 'stage', 'step', 'state', 'country', 'city', 'scale', 'metric',
  'icon', 'period', 'season', 'quarter', 'month', 'week', 'day', 'year', 'shift', 'status', 'selection',
  'option', 'answer', 'response', 'rating', 'score', 'grade', 'approved', 'active', 'pattern', 'style',
  'section', 'fmt', 'format', 'kpi', 'measure', 'name'
])

/** Tokens that mark free text / identifiers (never "categorical-only"). */
export const FREE_TEXT_TOKENS = new Set([
  'description', 'desc', 'notes', 'note', 'comment', 'comments', 'feedback', 'text', 'message', 'summary', 'body', 'remarks',
  'email', 'mail', 'phone', 'url', 'link', 'website', 'address', 'street', 'zip', 'postal', 'id', 'oid', 'guid', 'uuid', 'key',
  'number', 'no', 'num', 'first', 'last', 'full', 'html', 'svg', 'data', 'json', 'title', 'subject'
])

export const PERSON_TOKENS = new Set([
  'owner', 'user', 'employee', 'agent', 'manager', 'counselor', 'counsellor', 'provider', 'contact', 'rep', 'representative',
  'specialist', 'staff', 'supervisor', 'person', 'customer', 'member', 'patient', 'clinician', 'therapist', 'author', 'assignee',
  'creator', 'reviewer', 'approver', 'salesperson', 'seller', 'advisor', 'consultant', 'coordinator', 'worker', 'participant',
  'caller', 'requester', 'reporter', 'physician', 'doctor', 'nurse', 'student', 'teacher', 'instructor', 'am', 'csm',
  'sponsor'
])

export const ORG_TOKENS = new Set([
  'company', 'account', 'org', 'organization', 'organisation', 'employer', 'client', 'broker', 'vendor', 'supplier', 'partner',
  'customer', 'business', 'firm', 'carrier', 'payer', 'agency', 'parent', 'grandparent', 'competitor', 'group',
  'enterprise', 'tenant', 'store', 'branch', 'facility', 'site', 'hospital', 'clinic', 'school'
])

export function personName(k: number): { first: string; last: string } {
  const F = FIRST_NAMES.length
  const L = LAST_NAMES.length
  // k -> (first, last) bijection over F*L combinations (both coprime walk)
  const i = k % (F * L)
  return { first: FIRST_NAMES[i % F], last: LAST_NAMES[(i * 7 + Math.floor(i / F)) % L] }
}

/** Number of distinct company names before companyName() starts numbering them ("… 2"). */
export const COMPANY_NAME_COUNT = COMPANY_A.length * COMPANY_B.length

export function companyName(k: number): string {
  const A = COMPANY_A.length
  const B = COMPANY_B.length
  const i = k % (A * B)
  const a = COMPANY_A[i % A]
  const b = COMPANY_B[(i * 11 + Math.floor(i / A)) % B]
  const c = COMPANY_C[(k * 3) % COMPANY_C.length]
  const base = `${a} ${b}${c ? ' ' + c : ''}`
  const round = Math.floor(k / (A * B))
  return round ? `${base} ${round + 1}` : base
}

export function streetAddress(rng: Rng): string {
  return `${rng.int(10, 9999)} ${rng.pick(STREETS)}`
}

export function loremSentence(rng: Rng, words = 6): string {
  const n = Math.max(2, words + rng.int(-2, 3))
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(rng.pick(LOREM))
  const s = out.join(' ')
  return s[0].toUpperCase() + s.slice(1) + '.'
}

export function guidFrom(seed: number, k: number): string {
  const r = new Rng(hash32(String(k), seed))
  const hex = (n: number): string => {
    let s = ''
    for (let i = 0; i < n; i++) s += Math.floor(r.next() * 16).toString(16)
    return s
  }
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(r.next() * 4)]}${hex(3)}-${hex(12)}`
}

export function pad(n: number, w: number): string {
  return String(n).padStart(w, '0')
}

/** Convert a value to a column's data type (strictly). Returns undefined when impossible. */
export function coerceTo(v: Scalar, type: DataType): Scalar | undefined {
  if (v === null) return null
  switch (type) {
    case 'string':
      if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1, 2)}-${pad(v.getUTCDate(), 2)}`
      if (typeof v === 'boolean') return v ? 'True' : 'False'
      if (v instanceof Uint8Array) return undefined
      return String(v)
    case 'int64':
      if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v)
      if (typeof v === 'boolean') return v ? 1 : 0
      if (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v)) return Number(v)
      return undefined
    case 'double':
    case 'decimal':
      if (typeof v === 'number') return v
      if (typeof v === 'boolean') return v ? 1 : 0
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
      return undefined
    case 'boolean':
      if (typeof v === 'boolean') return v
      if (typeof v === 'number') return v !== 0
      if (typeof v === 'string') {
        const l = v.trim().toLowerCase()
        if (l === 'true' || l === 'yes' || l === '1') return true
        if (l === 'false' || l === 'no' || l === '0') return false
      }
      return undefined
    case 'dateTime':
      return v instanceof Date ? v : undefined
    default:
      return typeof v === 'object' && !(v instanceof Date) ? undefined : v
  }
}

// ---------------------------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------------------------

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_MS = 86400000

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS)
}

export function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS)
}

/** Excel / M serial number (days since 1899-12-30). */
export function serialOf(d: Date): number {
  return Math.round((d.getTime() - Date.UTC(1899, 11, 30)) / DAY_MS)
}

export function endOfMonth(d: Date): Date {
  return makeDate(d.getUTCFullYear(), d.getUTCMonth() + 2, 0)
}

export function startOfMonth(d: Date): Date {
  return makeDate(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}

/** WEEKNUM(d) with weeks starting Sunday (DAX return type 1). */
export function weekNum(d: Date): number {
  const jan1 = makeDate(d.getUTCFullYear(), 1, 1)
  return Math.floor((dayDiff(jan1, d) + jan1.getUTCDay()) / 7) + 1
}

export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const y1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - y1.getTime()) / DAY_MS + 1) / 7)
}

export interface CalendarContext {
  today: Date
  /** fiscal year start month (1..12); FY is named after the calendar year it ends in */
  fiscalStartMonth: number
  /** weekday weeks end on (0 = Sunday … 6 = Saturday; default 6). Mined from week-end date literals. */
  weekEndDow?: number
}

/** Column name means "end of week" (week_end, week_ending, eow…). */
export function isWeekEndName(colName: string): boolean {
  const toks = tokensOf(colName)
  return toks.includes('eow') || ((toks.includes('week') || toks.includes('wk')) && (toks.includes('end') || toks.includes('ending')))
}

/**
 * Derive a date-table column value from a date by column-name heuristics. Returns undefined when no
 * heuristic matches (the caller then uses a generic generator).
 */
export function calendarValue(colName: string, type: DataType, d: Date, ctx: CalendarContext): Scalar | undefined {
  const n = colName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const flat = n.replace(/_/g, '')
  const toks = tokensOf(colName)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  const dow = d.getUTCDay()
  const q = Math.floor((m - 1) / 3) + 1
  const fs = ctx.fiscalStartMonth
  const fm = ((m - fs + 12) % 12) + 1
  const fy = fs === 1 ? y : m >= fs ? y + 1 : y
  const fq = Math.floor((fm - 1) / 3) + 1
  const wed = ctx.weekEndDow ?? 6
  const weekEnd = addDays(d, (wed - dow + 7) % 7) // Saturday unless the report's week-end literals say otherwise
  const weekStart = addDays(weekEnd, -6)
  const today = ctx.today
  const has = (...t: string[]): boolean => t.every((x) => toks.includes(x))
  const any = (...t: string[]): boolean => t.some((x) => toks.includes(x))
  const isFiscal = any('fiscal', 'fy')
  const sortDesc = any('desc') && any('sort')

  if (type === 'dateTime') {
    if ((any('month', 'mon') && any('end', 'last')) || flat.includes('eomonth')) return endOfMonth(d)
    if ((any('month', 'mon') && any('start', 'begin', 'first')) || flat.includes('startofmonth')) return startOfMonth(d)
    if ((any('week', 'wk') && any('end', 'ending', 'last')) || any('eow')) return weekEnd
    if (any('eom')) return endOfMonth(d)
    if (any('eoq')) return endOfMonth(makeDate(y, q * 3, 1))
    if (any('eoy')) return makeDate(y, 12, 31)
    if (any('week', 'wk') && any('start', 'begin', 'beginning', 'first')) return weekStart
    if (any('quarter', 'qtr') && any('end')) return endOfMonth(makeDate(y, q * 3, 1))
    if (any('quarter', 'qtr') && any('start', 'begin')) return makeDate(y, q * 3 - 2, 1)
    if (any('year', 'yr') && any('end')) return makeDate(y, 12, 31)
    if (any('year', 'yr') && any('start', 'begin')) return makeDate(y, 1, 1)
    if (any('prior', 'previous', 'py', 'ly') || flat.includes('lastyear')) return makeDate(y - 1, m, Math.min(day, new Date(Date.UTC(y - 1, m, 0)).getUTCDate()))
    if (any('date', 'day', 'dt') || flat === 'date') return d
    return undefined
  }

  if (type === 'boolean') {
    if (any('weekend')) return dow === 0 || dow === 6
    if (any('weekday', 'workday', 'working', 'business')) return dow !== 0 && dow !== 6
    if (any('future')) return d.getTime() > today.getTime()
    if (any('past')) return d.getTime() < today.getTime()
    if (any('today')) return d.getTime() === today.getTime()
    if (any('holiday')) return (m === 1 && day === 1) || (m === 7 && day === 4) || (m === 12 && day === 25)
    if (any('complete', 'completed', 'full') && any('week')) return weekEnd.getTime() <= today.getTime()
    if (any('complete', 'completed', 'full') && any('month')) return endOfMonth(d).getTime() <= today.getTime()
    if (any('current', 'curr', 'this')) {
      if (any('month', 'mon')) return y === today.getUTCFullYear() && m === today.getUTCMonth() + 1
      if (any('year', 'yr')) return y === today.getUTCFullYear()
      if (any('week')) return dayDiff(weekStart, today) >= 0 && dayDiff(weekStart, today) < 7
      if (any('quarter', 'qtr')) return y === today.getUTCFullYear() && q === Math.floor(today.getUTCMonth() / 3) + 1
    }
    if (any('ytd')) return m < today.getUTCMonth() + 1 || (m === today.getUTCMonth() + 1 && day <= today.getUTCDate())
    if (any('month') && any('end', 'last')) return day === endOfMonth(d).getUTCDate()
    return undefined
  }

  const numeric = type === 'int64' || type === 'double' || type === 'decimal'
  // "<unit>_of_<container>": day_of_week, week_of_year, day_of_month, month_of_quarter...
  const ofAt = toks.indexOf('of')
  if ((numeric || type === 'string') && ofAt > 0 && ofAt < toks.length - 1 && !isFiscal) {
    const unit = toks[ofAt - 1]
    const container = toks[ofAt + 1]
    let v: number | undefined
    if (unit === 'day' && container === 'week') v = dow + 1
    else if (unit === 'day' && container === 'month') v = day
    else if (unit === 'day' && container === 'quarter') v = dayDiff(makeDate(y, q * 3 - 2, 1), d) + 1
    else if (unit === 'day' && container === 'year') v = dayDiff(makeDate(y, 1, 1), d) + 1
    else if (unit === 'week' && container === 'year') v = toks.includes('iso') ? isoWeek(d) : weekNum(d)
    else if (unit === 'week' && container === 'month') v = Math.floor((day - 1 + startOfMonth(d).getUTCDay()) / 7) + 1
    else if (unit === 'month' && container === 'quarter') v = ((m - 1) % 3) + 1
    else if (unit === 'month' && container === 'year') v = m
    else if (unit === 'quarter' && container === 'year') v = q
    if (v !== undefined) {
      if (numeric) return v
      if (unit === 'day' && container === 'week') return DAY_NAMES[dow]
      if (unit === 'month' && container === 'year') return MONTH_NAMES[m - 1]
      if (unit === 'quarter') return `Q${q}`
      if (unit === 'week') return `W${pad(v, 2)}`
      return String(v)
    }
  }
  if (numeric) {
    if (sortDesc) {
      if (any('month', 'mon') && any('end')) return -serialOf(endOfMonth(d))
      if (any('month', 'mon')) return -(y * 100 + m)
      if (any('year')) return -y
      if (any('week')) return -serialOf(weekEnd)
      return -serialOf(d)
    }
    if (any('serial')) return serialOf(d)
    if (has('date', 'key') || has('date', 'id') || flat === 'datekey' || flat === 'dateint' || has('day', 'key')) return y * 10000 + m * 100 + day
    if (any('offset', 'ago', 'relative', 'index') || (any('days') && any('from', 'since', 'to', 'until'))) {
      if (any('month', 'mon')) return (y - today.getUTCFullYear()) * 12 + (m - (today.getUTCMonth() + 1))
      if (any('year', 'yr')) return y - today.getUTCFullYear()
      if (any('week', 'wk')) return Math.floor(dayDiff(weekStart, addDays(today, -((today.getUTCDay() - ((wed + 1) % 7) + 7) % 7))) / -7)
      if (any('quarter', 'qtr')) return (y - today.getUTCFullYear()) * 4 + (q - (Math.floor(today.getUTCMonth() / 3) + 1))
      return dayDiff(today, d)
    }
    if (isFiscal) {
      if (any('month', 'period', 'mon')) return fm
      if (any('quarter', 'qtr')) return fq
      if (any('year', 'yr')) return fy
      if (any('week', 'wk')) return Math.floor(dayDiff(makeDate(fs === 1 ? fy : fy - 1, fs, 1), d) / 7) + 1
    }
    if ((any('year') || any('yr')) && any('month', 'mon')) return y * 100 + m
    if ((any('year') || any('yr')) && any('quarter', 'qtr')) return y * 10 + q
    if ((any('year') || any('yr')) && any('week', 'wk')) return y * 100 + weekNum(d)
    if (any('iso') && any('week')) return isoWeek(d)
    if (any('week', 'wk', 'weeknum')) {
      if (any('day')) return dow + 1
      return weekNum(d)
    }
    if (any('weekday', 'dow') || (any('day') && any('week'))) return dow + 1
    if (any('day', 'dd') && any('year', 'yr')) return dayDiff(makeDate(y, 1, 1), d) + 1
    if (any('day', 'dd') && any('quarter', 'qtr')) return dayDiff(makeDate(y, q * 3 - 2, 1), d) + 1
    if (any('days') && any('month', 'in')) return endOfMonth(d).getUTCDate()
    if (any('quarter', 'qtr', 'qtd')) return q
    if (any('month', 'mon', 'mm', 'mo')) return m
    if (any('half', 'semester')) return m <= 6 ? 1 : 2
    if (any('year', 'yr', 'yyyy')) return y
    if (any('day', 'dd')) return day
    if (any('weekend')) return dow === 0 || dow === 6 ? 1 : 0
    if (any('weekday', 'workday', 'working')) return dow !== 0 && dow !== 6 ? 1 : 0
    if (any('future')) return d.getTime() > today.getTime() ? 1 : 0
    return undefined
  }

  if (type === 'string') {
    const mn = MONTH_NAMES[m - 1]
    const ms = mn.slice(0, 3)
    if (isFiscal) {
      if (any('period', 'month') && any('year')) return `FY${fy}-P${pad(fm, 2)}`
      if (any('quarter', 'qtr') && any('year')) return `FY${fy}-Q${fq}`
      if (any('quarter', 'qtr')) return `FQ${fq}`
      if (any('period', 'month')) return `P${pad(fm, 2)}`
      if (any('year', 'yr')) return `FY${fy}`
    }
    const isName = any('name', 'long', 'full', 'text', 'label')
    const isShort = any('abbr', 'abbrev', 'short', 'abr', 'abv', 'mmm', 'code')
    if ((any('year', 'yr') && any('month', 'mon')) || flat === 'yearmonth' || flat === 'monthyear') {
      if (toks.indexOf('month') >= 0 && toks.indexOf('year') >= 0 && toks.indexOf('month') < toks.indexOf('year')) {
        return isShort || any('short') ? `${ms} ${y}` : `${mn} ${y}`
      }
      return `${y}-${pad(m, 2)}`
    }
    if (any('year', 'yr') && any('quarter', 'qtr')) {
      if (toks.indexOf('quarter') >= 0 && toks.indexOf('year') >= 0 && toks.indexOf('quarter') < toks.indexOf('year')) return `Q${q} ${y}`
      return `${y}-Q${q}`
    }
    if (any('year', 'yr') && any('week', 'wk')) return `${y}-W${pad(weekNum(d), 2)}`
    if (any('quarter', 'qtr')) return `Q${q}`
    if (any('month', 'mon')) {
      if (isShort) return ms
      if (any('number', 'num', 'no')) return pad(m, 2)
      return mn
    }
    if (any('day', 'weekday', 'dow')) {
      if (any('type') || (any('weekday') && any('weekend'))) return dow === 0 || dow === 6 ? 'Weekend' : 'Weekday'
      if (any('week') || any('weekday') || any('dow') || isName || isShort) return isShort ? DAY_NAMES[dow].slice(0, 3) : DAY_NAMES[dow]
      if (any('month') || any('of')) return String(day)
      return isShort ? DAY_NAMES[dow].slice(0, 3) : DAY_NAMES[dow]
    }
    if (any('week', 'wk')) return `W${pad(weekNum(d), 2)}`
    if (any('weekend')) return dow === 0 || dow === 6 ? 'Weekend' : 'Weekday'
    if (any('half', 'semester')) return m <= 6 ? 'H1' : 'H2'
    if (any('season')) return ['Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer', 'Summer', 'Summer', 'Fall', 'Fall', 'Fall', 'Winter'][m - 1]
    if (any('year', 'yr')) return String(y)
    if (any('date')) return `${y}-${pad(m, 2)}-${pad(day, 2)}`
    if (any('holiday')) return (m === 1 && day === 1) ? "New Year's Day" : (m === 7 && day === 4) ? 'Independence Day' : (m === 12 && day === 25) ? 'Christmas Day' : null
    return undefined
  }
  return undefined
}

// ---------------------------------------------------------------------------------------------
// Survey-style realism: skewed ordinal scales, sentiment labels, placeholders
// ---------------------------------------------------------------------------------------------

/** Φ(z): standard normal CDF (Abramowitz–Stegun 7.1.26, absolute error < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf)
}

/**
 * Weights of an ordinal survey scale with `n` points, lowest first. Real satisfaction / rating / likelihood-
 * to-recommend answers pile up at the top of the scale (most respondents are content, a small tail is not),
 * so the weights rise steeply: a 5-point scale has ~87% in the top two boxes, an 11-point (0–10) scale has
 * ~63% promoters (9–10), ~24% passives (7–8) and ~13% detractors (0–6), i.e. a net promoter score near +50.
 */
export function surveyWeights(n: number): Float64Array {
  const fixed: Record<number, number[]> = {
    2: [0.14, 0.86],
    3: [0.13, 0.24, 0.63],
    4: [0.05, 0.1, 0.33, 0.52],
    5: [0.02, 0.03, 0.08, 0.32, 0.55],
    11: [0.008, 0.004, 0.008, 0.012, 0.018, 0.035, 0.045, 0.09, 0.15, 0.26, 0.37]
  }
  if (fixed[n]) return Float64Array.from(fixed[n])
  const w = new Float64Array(Math.max(1, n))
  let sum = 0
  for (let i = 0; i < w.length; i++) {
    w[i] = Math.exp((3 * i) / Math.max(1, w.length - 1))
    sum += w[i]
  }
  for (let i = 0; i < w.length; i++) w[i] /= sum
  return w
}

const SENTIMENT: Array<[number, RegExp]> = [
  [2, /^(promoters?|(very|extremely|completely|highly|totally) (satisfied|likely|positive|happy|good|pleased|helpful)|strongly agree|excellent|outstanding|exceptional|exceeds? expectations|delighted|great|always)$/],
  [-2, /^(detractors?|(very|extremely|completely|highly|totally) (dissatisfied|unsatisfied|unlikely|negative|unhappy|bad|poor|unhelpful)|strongly disagree|terrible|awful|unacceptable|never)$/],
  [1, /^((somewhat |mostly |fairly )?(satisfied|likely|positive|happy|agree|pleased|helpful)|good|above average|meets? expectations|favou?rable|usually|often)$/],
  [-1, /^((somewhat |mostly |fairly )?(dissatisfied|unsatisfied|unlikely|negative|unhappy|disagree|unhelpful)|poor|bad|below average|below expectations|unfavou?rable|rarely|seldom)$/],
  [0, /^(passives?|neutral|neither.*|undecided|average|fair|ok|okay|mixed|sometimes|no opinion|indifferent)$/]
]

/** Sentiment of a survey answer label: +2 (best) … -2 (worst); undefined when the label is not a sentiment word. */
export function sentimentOf(label: string): number | undefined {
  const l = label.trim().toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!l) return undefined
  for (const [score, re] of SENTIMENT) if (re.test(l)) return score
  return undefined
}

/**
 * Net-promoter band of a label: 'promoter' | 'passive' | 'detractor', or undefined. Used to keep a group
 * column in line with the 0–10 likelihood-to-recommend score of the same row.
 */
export function npsBandOf(label: string): 'promoter' | 'passive' | 'detractor' | undefined {
  const l = label.trim().toLowerCase()
  if (/^promot/.test(l)) return 'promoter'
  if (/^detract/.test(l)) return 'detractor'
  if (/^(passive|neutral)/.test(l)) return 'passive'
  return undefined
}

/**
 * Generic placeholder labels ("Unknown", "N/A", "None"…): they identify nobody, so they may be copied from
 * the model's DAX / the report's filters even into name-like and id-like columns.
 */
export function isPlaceholderLabel(v: string): boolean {
  return /^(unknown|none|none provided|n\/?a|n\.a\.|na|null|blank|\(blank\)|other|others|all|tbd|tba|unassigned|unspecified|undefined|missing|no data|not (provided|available|applicable|specified|assigned|set|known|reported)|misc|miscellaneous|general|various|multiple|default|total|-+|\?+)$/i.test(v.trim())
}
