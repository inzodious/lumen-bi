/**
 * Built-in geography tables for the map visuals (pure, no DOM):
 *
 *  - Countries: every Natural Earth admin-0 entity (./countries.data.ts) with ISO 3166-1 alpha-2 /
 *    alpha-3 / numeric codes, alternate names and a label point, plus common informal aliases.
 *  - US states (+ DC): name, USPS code, FIPS code (= us-atlas geometry id) and an approximate
 *    centroid (used for bubbles and labels; polygons come from us-atlas, see ./atlas.ts).
 *  - Continents: names, aliases and a representative center.
 */
import { COUNTRY_TABLE } from './countries.data'

export interface UsState {
  name: string
  code: string
  /** 2-digit FIPS code (us-atlas `states-10m.json` geometry id) */
  fips: string
  lon: number
  lat: number
}

export const US_STATES: UsState[] = [
  { name: 'Alabama', code: 'AL', fips: '01', lon: -86.8, lat: 32.8 },
  { name: 'Alaska', code: 'AK', fips: '02', lon: -152.3, lat: 64.2 },
  { name: 'Arizona', code: 'AZ', fips: '04', lon: -111.7, lat: 34.3 },
  { name: 'Arkansas', code: 'AR', fips: '05', lon: -92.4, lat: 34.9 },
  { name: 'California', code: 'CA', fips: '06', lon: -119.4, lat: 37.2 },
  { name: 'Colorado', code: 'CO', fips: '08', lon: -105.5, lat: 39.0 },
  { name: 'Connecticut', code: 'CT', fips: '09', lon: -72.7, lat: 41.6 },
  { name: 'Delaware', code: 'DE', fips: '10', lon: -75.5, lat: 39.0 },
  { name: 'District of Columbia', code: 'DC', fips: '11', lon: -77.0, lat: 38.9 },
  { name: 'Florida', code: 'FL', fips: '12', lon: -81.7, lat: 28.6 },
  { name: 'Georgia', code: 'GA', fips: '13', lon: -83.4, lat: 32.7 },
  { name: 'Hawaii', code: 'HI', fips: '15', lon: -157.5, lat: 20.3 },
  { name: 'Idaho', code: 'ID', fips: '16', lon: -114.6, lat: 44.4 },
  { name: 'Illinois', code: 'IL', fips: '17', lon: -89.2, lat: 40.0 },
  { name: 'Indiana', code: 'IN', fips: '18', lon: -86.3, lat: 39.9 },
  { name: 'Iowa', code: 'IA', fips: '19', lon: -93.5, lat: 42.1 },
  { name: 'Kansas', code: 'KS', fips: '20', lon: -98.4, lat: 38.5 },
  { name: 'Kentucky', code: 'KY', fips: '21', lon: -85.3, lat: 37.5 },
  { name: 'Louisiana', code: 'LA', fips: '22', lon: -92.0, lat: 31.1 },
  { name: 'Maine', code: 'ME', fips: '23', lon: -69.2, lat: 45.4 },
  { name: 'Maryland', code: 'MD', fips: '24', lon: -76.8, lat: 39.0 },
  { name: 'Massachusetts', code: 'MA', fips: '25', lon: -71.8, lat: 42.3 },
  { name: 'Michigan', code: 'MI', fips: '26', lon: -84.7, lat: 43.7 },
  { name: 'Minnesota', code: 'MN', fips: '27', lon: -94.3, lat: 46.3 },
  { name: 'Mississippi', code: 'MS', fips: '28', lon: -89.7, lat: 32.7 },
  { name: 'Missouri', code: 'MO', fips: '29', lon: -92.5, lat: 38.4 },
  { name: 'Montana', code: 'MT', fips: '30', lon: -109.6, lat: 47.0 },
  { name: 'Nebraska', code: 'NE', fips: '31', lon: -99.8, lat: 41.5 },
  { name: 'Nevada', code: 'NV', fips: '32', lon: -116.6, lat: 39.3 },
  { name: 'New Hampshire', code: 'NH', fips: '33', lon: -71.6, lat: 43.7 },
  { name: 'New Jersey', code: 'NJ', fips: '34', lon: -74.7, lat: 40.2 },
  { name: 'New Mexico', code: 'NM', fips: '35', lon: -106.1, lat: 34.4 },
  { name: 'New York', code: 'NY', fips: '36', lon: -75.5, lat: 42.9 },
  { name: 'North Carolina', code: 'NC', fips: '37', lon: -79.4, lat: 35.6 },
  { name: 'North Dakota', code: 'ND', fips: '38', lon: -100.5, lat: 47.5 },
  { name: 'Ohio', code: 'OH', fips: '39', lon: -82.8, lat: 40.3 },
  { name: 'Oklahoma', code: 'OK', fips: '40', lon: -97.5, lat: 35.6 },
  { name: 'Oregon', code: 'OR', fips: '41', lon: -120.6, lat: 43.9 },
  { name: 'Pennsylvania', code: 'PA', fips: '42', lon: -77.8, lat: 40.9 },
  { name: 'Rhode Island', code: 'RI', fips: '44', lon: -71.5, lat: 41.7 },
  { name: 'South Carolina', code: 'SC', fips: '45', lon: -80.9, lat: 33.9 },
  { name: 'South Dakota', code: 'SD', fips: '46', lon: -100.2, lat: 44.4 },
  { name: 'Tennessee', code: 'TN', fips: '47', lon: -86.4, lat: 35.9 },
  { name: 'Texas', code: 'TX', fips: '48', lon: -99.3, lat: 31.5 },
  { name: 'Utah', code: 'UT', fips: '49', lon: -111.7, lat: 39.3 },
  { name: 'Vermont', code: 'VT', fips: '50', lon: -72.7, lat: 44.1 },
  { name: 'Virginia', code: 'VA', fips: '51', lon: -78.8, lat: 37.5 },
  { name: 'Washington', code: 'WA', fips: '53', lon: -120.4, lat: 47.4 },
  { name: 'West Virginia', code: 'WV', fips: '54', lon: -80.6, lat: 38.6 },
  { name: 'Wisconsin', code: 'WI', fips: '55', lon: -89.8, lat: 44.6 },
  { name: 'Wyoming', code: 'WY', fips: '56', lon: -107.6, lat: 43.0 }
]

/** US territories present in us-atlas (filled/shape maps can color them; never preferred over countries). */
export const US_TERRITORIES: UsState[] = [
  { name: 'Puerto Rico', code: 'PR', fips: '72', lon: -66.5, lat: 18.2 },
  { name: 'Guam', code: 'GU', fips: '66', lon: 144.8, lat: 13.4 },
  { name: 'United States Virgin Islands', code: 'VI', fips: '78', lon: -64.8, lat: 18.3 },
  { name: 'American Samoa', code: 'AS', fips: '60', lon: -170.7, lat: -14.3 },
  { name: 'Commonwealth of the Northern Mariana Islands', code: 'MP', fips: '69', lon: 145.7, lat: 15.2 }
]

/** Lowercase, strip diacritics/punctuation, collapse spaces. */
export function normalizeLocation(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// ------------------------------------------------------------------------------------------------
// US states
// ------------------------------------------------------------------------------------------------

const STATE_BY_KEY = new Map<string, UsState>()
for (const s of US_STATES) {
  STATE_BY_KEY.set(normalizeLocation(s.name), s)
  STATE_BY_KEY.set(normalizeLocation(s.code), s)
}
{
  const dc = US_STATES.find((s) => s.code === 'DC')!
  for (const k of ['washington dc', 'washington d c', 'd c', 'dist of columbia', 'dist columbia']) STATE_BY_KEY.set(k, dc)
  // common abbreviations / misspellings seen in real data
  const extra: Array<[string, string]> = [
    ['delware', 'DE'],
    ['calif', 'CA'],
    ['mass', 'MA'],
    ['penn', 'PA'],
    ['wash', 'WA'],
    ['tenn', 'TN'],
    ['n carolina', 'NC'],
    ['s carolina', 'SC'],
    ['n dakota', 'ND'],
    ['s dakota', 'SD'],
    ['w virginia', 'WV']
  ]
  for (const [k, c] of extra) STATE_BY_KEY.set(k, US_STATES.find((s) => s.code === c)!)
}
const STATE_BY_CODE = new Map(US_STATES.map((s) => [s.code, s]))
const TERRITORY_BY_KEY = new Map<string, UsState>()
for (const t of US_TERRITORIES) {
  TERRITORY_BY_KEY.set(normalizeLocation(t.name), t)
  TERRITORY_BY_KEY.set(normalizeLocation(t.code), t)
}
TERRITORY_BY_KEY.set('us virgin islands', US_TERRITORIES[2])
TERRITORY_BY_KEY.set('northern mariana islands', US_TERRITORIES[4])

/** US state (or DC) by name, USPS code or common abbreviation (normalized or raw text). */
export function findState(text: string): UsState | undefined {
  return STATE_BY_KEY.get(normalizeLocation(text))
}

export function stateByCode(code: string): UsState | undefined {
  return STATE_BY_CODE.get(code.toUpperCase())
}

/** US territory (Puerto Rico, Guam, ...) by name or code — only used for US-scoped columns. */
export function findTerritory(text: string): UsState | undefined {
  return TERRITORY_BY_KEY.get(normalizeLocation(text))
}

// ------------------------------------------------------------------------------------------------
// Countries
// ------------------------------------------------------------------------------------------------

export interface Country {
  a3: string
  a2: string
  n3: string
  /** Natural Earth / world-atlas name */
  name: string
  lat: number
  lon: number
  continent: string
}

export const COUNTRIES: Country[] = COUNTRY_TABLE.map((r) => {
  const [a3, a2, n3, name, lat, lon, continent] = r.split('|')
  return { a3, a2, n3, name, lat: Number(lat), lon: Number(lon), continent }
})

const COUNTRY_BY_A3 = new Map(COUNTRIES.map((c) => [c.a3, c]))
const COUNTRY_BY_A2 = new Map(COUNTRIES.filter((c) => c.a2).map((c) => [c.a2, c]))
const COUNTRY_BY_N3 = new Map(COUNTRIES.filter((c) => c.n3).map((c) => [c.n3, c]))

/** Informal names → ISO alpha-3 (keys normalized). Formal / long names come from Natural Earth. */
const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'USA',
  us: 'USA',
  'u s': 'USA',
  'u s a': 'USA',
  'united states': 'USA',
  'united states of america': 'USA',
  america: 'USA',
  uk: 'GBR',
  'u k': 'GBR',
  'great britain': 'GBR',
  britain: 'GBR',
  england: 'GBR',
  scotland: 'GBR',
  wales: 'GBR',
  'northern ireland': 'GBR',
  'russian federation': 'RUS',
  'czech republic': 'CZE',
  korea: 'KOR',
  'republic of korea': 'KOR',
  'korea republic of': 'KOR',
  'korea rep': 'KOR',
  'korea south': 'KOR',
  'korea north': 'PRK',
  dprk: 'PRK',
  holland: 'NLD',
  'the netherlands': 'NLD',
  'viet nam': 'VNM',
  'ivory coast': 'CIV',
  'dr congo': 'COD',
  drc: 'COD',
  'congo kinshasa': 'COD',
  'congo dr': 'COD',
  'republic of the congo': 'COG',
  'congo brazzaville': 'COG',
  'congo republic': 'COG',
  swaziland: 'SWZ',
  'east timor': 'TLS',
  burma: 'MMR',
  persia: 'IRN',
  'iran islamic republic of': 'IRN',
  'syrian arab republic': 'SYR',
  'lao pdr': 'LAO',
  'lao people s democratic republic': 'LAO',
  uae: 'ARE',
  'u a e': 'ARE',
  turkiye: 'TUR',
  'republic of ireland': 'IRL',
  eire: 'IRL',
  prc: 'CHN',
  'mainland china': 'CHN',
  'republic of china': 'TWN',
  'taiwan province of china': 'TWN',
  macao: 'MAC',
  'bolivia plurinational state of': 'BOL',
  'venezuela bolivarian republic of': 'VEN',
  'tanzania united republic of': 'TZA',
  'moldova republic of': 'MDA',
  'brunei darussalam': 'BRN',
  'cabo verde': 'CPV',
  'state of palestine': 'PSE',
  'holy see': 'VAT',
  vatican: 'VAT',
  'macedonia': 'MKD',
  'fyrom': 'MKD',
  'slovak republic': 'SVK',
  'kyrgyz republic': 'KGZ',
  'the bahamas': 'BHS',
  'the gambia': 'GMB',
  'micronesia federated states of': 'FSM',
  'st kitts and nevis': 'KNA',
  'st lucia': 'LCA',
  'st vincent and the grenadines': 'VCT'
}

const COUNTRY_BY_KEY = new Map<string, Country>()
for (const r of COUNTRY_TABLE) {
  const parts = r.split('|')
  const c = COUNTRY_BY_A3.get(parts[0])!
  for (const name of [parts[3], ...parts.slice(7)]) {
    const k = normalizeLocation(name)
    if (k && !COUNTRY_BY_KEY.has(k)) COUNTRY_BY_KEY.set(k, c)
  }
}
for (const [k, a3] of Object.entries(COUNTRY_ALIASES)) {
  const c = COUNTRY_BY_A3.get(a3)
  if (c) COUNTRY_BY_KEY.set(k, c)
}

/**
 * Country by name / alias / ISO code. Two-letter codes are only accepted when `allowAlpha2`
 * (they collide with US state codes; PBI's own docs recommend alpha-3 codes for that reason).
 */
export function findCountry(text: string, allowAlpha2 = true): Country | undefined {
  const k = normalizeLocation(text)
  if (!k) return undefined
  const named = COUNTRY_BY_KEY.get(k)
  if (named) return named
  if (/^[a-z]{3}$/.test(k)) return COUNTRY_BY_A3.get(k.toUpperCase())
  if (allowAlpha2 && /^[a-z]{2}$/.test(k)) return COUNTRY_BY_A2.get(k.toUpperCase())
  return undefined
}

export const countryByA3 = (a3: string): Country | undefined => COUNTRY_BY_A3.get(a3)
export const countryByA2 = (a2: string): Country | undefined => COUNTRY_BY_A2.get(a2)
export const countryByN3 = (n3: string): Country | undefined => COUNTRY_BY_N3.get(n3)
export const countryByName = (name: string): Country | undefined => COUNTRY_BY_KEY.get(normalizeLocation(name))

// ------------------------------------------------------------------------------------------------
// Continents
// ------------------------------------------------------------------------------------------------

export interface Continent {
  /** Natural Earth CONTINENT value */
  name: string
  lon: number
  lat: number
}

export const CONTINENTS: Continent[] = [
  { name: 'Africa', lon: 20, lat: 5 },
  { name: 'Asia', lon: 95, lat: 35 },
  { name: 'Europe', lon: 15, lat: 51 },
  { name: 'North America', lon: -100, lat: 45 },
  { name: 'South America', lon: -60, lat: -15 },
  { name: 'Oceania', lon: 140, lat: -25 },
  { name: 'Antarctica', lon: 0, lat: -80 }
]

const CONTINENT_KEYS: Record<string, string> = {
  africa: 'Africa',
  asia: 'Asia',
  europe: 'Europe',
  'north america': 'North America',
  'n america': 'North America',
  'south america': 'South America',
  's america': 'South America',
  'latin america': 'South America',
  oceania: 'Oceania',
  australia: 'Oceania',
  'australia and oceania': 'Oceania',
  antarctica: 'Antarctica'
}

/** Continent by name. Note "Australia" resolves as a country unless the column is a Continent column. */
export function findContinent(text: string): Continent | undefined {
  const name = CONTINENT_KEYS[normalizeLocation(text)]
  return name ? CONTINENTS.find((c) => c.name === name) : undefined
}

/** Decide if a column of locations is mostly US states (ambiguous codes then resolve as states). */
export function looksLikeStates(values: unknown[], dataCategory?: string): boolean {
  if (dataCategory && /state|province/i.test(dataCategory)) return true
  if (dataCategory && /country|continent/i.test(dataCategory)) return false
  const vals = values.filter((v) => v !== null && v !== undefined && v !== '').map((v) => normalizeLocation(String(v)))
  if (!vals.length) return false
  const hits = vals.filter((v) => STATE_BY_KEY.has(v)).length
  return hits / vals.length > 0.6
}
