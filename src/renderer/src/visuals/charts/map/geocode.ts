/**
 * Offline geocoding for the map visuals (pure, no DOM, no network).
 *
 * Power BI sends the Location values (with their data category and the parent levels of a geo
 * hierarchy) to Bing / Azure Maps. Lumen resolves them against built-in tables instead:
 * countries, US states, continents, admin-1 regions (approximate centroids), ~21,000 cities /
 * places and US ZIP codes (ZIP3 centroids). Values that cannot be resolved are reported as
 * "not located" in the map caption rather than guessed.
 *
 * Disambiguation, like Bing's structured geocoding:
 *  - the column `dataCategory` (City, StateOrProvince, Country, PostalCode, Continent, Place, Address, County);
 *  - coarser hierarchy levels / drill-down context ("Country > State > City");
 *  - qualifiers inside the value ("Austin, TX", "London, Ontario", "Paris, France", "Cincinnati OH");
 *  - the dominant country of the column (a column of US cities resolves "Paris" to Paris, TX only
 *    when qualified; unqualified names prefer cities in the column's dominant country).
 */
import type { Scalar } from '@core/model/data'
import { countryByA2, countryByA3, findContinent, findCountry, findState, findTerritory, looksLikeStates, normalizeLocation, type UsState } from './geo'
import { findAdmin1, findPlaces, zip3Centroid, type Place } from './gazetteer'

export type GeoKind = 'country' | 'state' | 'admin1' | 'city' | 'postal' | 'continent'

export interface GeoMatch {
  kind: GeoKind
  /** display name of the matched place */
  name: string
  lon: number
  lat: number
  /** ISO alpha-3 of the country (for country matches: the country itself) */
  country?: string
  /** USPS code (US states, US places) */
  state?: string
  continent?: string
  /** placement is approximate (ZIP3 / admin-1 / continent centroid) */
  approx?: boolean
}

export type LocationRole = 'country' | 'state' | 'city' | 'postal' | 'county' | 'continent' | 'place' | 'address' | 'auto' | 'latitude' | 'longitude'

export interface GeoContext {
  /** ISO alpha-3 of the enclosing country */
  country?: string
  /** USPS code of the enclosing US state */
  state?: string
  /** enclosing admin-1 name (outside the US) */
  admin1?: string
  /** ambiguous 2-letter codes / "Georgia" resolve as US states */
  preferStates?: boolean
  /** dominant country (alpha-3) of the column: unqualified city names prefer it */
  preferCountry?: string
}

/** Map a model column `dataCategory` to a location role. */
export function roleFromDataCategory(dc: string | undefined): LocationRole | undefined {
  if (!dc) return undefined
  const k = dc.toLowerCase().replace(/[^a-z]/g, '')
  switch (k) {
    case 'country':
    case 'countryregion':
      return 'country'
    case 'stateorprovince':
    case 'state':
    case 'province':
      return 'state'
    case 'city':
      return 'city'
    case 'postalcode':
    case 'zipcode':
      return 'postal'
    case 'county':
      return 'county'
    case 'continent':
      return 'continent'
    case 'place':
      return 'place'
    case 'address':
      return 'address'
    case 'latitude':
      return 'latitude'
    case 'longitude':
      return 'longitude'
    default:
      return undefined
  }
}

const ZIP_RE = /^\d{5}(?:-?\d{4})?$/

/** Guess the role of an uncategorized column from its values. */
export function inferRole(values: Scalar[]): LocationRole {
  const vals = values.filter((v) => v !== null && v !== '').map((v) => String(v).trim())
  if (!vals.length) return 'auto'
  const share = (f: (s: string) => boolean) => vals.filter(f).length / vals.length
  if (share((s) => ZIP_RE.test(s)) > 0.8) return 'postal'
  if (looksLikeStates(vals)) return 'state'
  if (share((s) => !!findCountry(s, false)) > 0.6) return 'country'
  return 'auto'
}

function a2Of(a3: string | undefined): string | undefined {
  return a3 ? countryByA3(a3)?.a2 || undefined : undefined
}

function stateMatch(s: UsState): GeoMatch {
  return { kind: 'state', name: s.name, lon: s.lon, lat: s.lat, country: 'USA', state: s.code, continent: 'North America' }
}

function countryMatch(text: string, allowA2: boolean): GeoMatch | undefined {
  const c = findCountry(text, allowA2)
  return c ? { kind: 'country', name: c.name, lon: c.lon, lat: c.lat, country: c.a3, continent: c.continent } : undefined
}

function placeMatch(p: Place): GeoMatch {
  const c = countryByA2(p.country)
  return { kind: 'city', name: p.name, lon: p.lon, lat: p.lat, country: c?.a3, state: p.country === 'US' ? p.admin1 : undefined, continent: c?.continent }
}

/** Best city for a name within the context (undefined when the qualifiers rule every candidate out). */
export function findCity(name: string, ctx: GeoContext): GeoMatch | undefined {
  let cands = findPlaces(name)
  if (!cands.length) return undefined
  if (ctx.state) cands = cands.filter((p) => p.country === 'US' && p.admin1 === ctx.state)
  else if (ctx.country) {
    const a2 = a2Of(ctx.country)
    cands = cands.filter((p) => p.country === a2)
    if (ctx.admin1) {
      const k = normalizeLocation(ctx.admin1)
      const inA1 = cands.filter((p) => normalizeLocation(p.admin1) === k)
      if (inA1.length) cands = inA1
    }
  } else if (ctx.admin1) {
    const k = normalizeLocation(ctx.admin1)
    cands = cands.filter((p) => normalizeLocation(p.admin1) === k)
  }
  if (!cands.length) return undefined
  const pref = a2Of(ctx.preferCountry)
  const score = (p: Place) => p.rank + (pref && p.country === pref ? 4 : 0) + (p.capital ? 0.5 : 0)
  let best = cands[0]
  for (const p of cands) if (score(p) > score(best)) best = p
  return placeMatch(best)
}

function admin1Match(name: string, ctx: GeoContext): GeoMatch | undefined {
  const a2 = a2Of(ctx.country)
  const list = findAdmin1(name, a2)
  if (!list.length) return undefined
  const pref = a2Of(ctx.preferCountry)
  let best = list[0]
  for (const a of list) {
    const s = (x: typeof a) => Math.log2(x.weight) + (pref && x.country === pref ? 8 : 0)
    if (s(a) > s(best)) best = a
  }
  const c = countryByA2(best.country)
  return { kind: 'admin1', name: best.name, lon: best.lon, lat: best.lat, country: c?.a3, continent: c?.continent, approx: true }
}

function postalMatch(value: Scalar, ctx: GeoContext): GeoMatch | undefined {
  if (ctx.country && ctx.country !== 'USA') return undefined
  const z = zip3Centroid(typeof value === 'number' ? value : String(value))
  return z ? { kind: 'postal', name: String(value), lon: z.lon, lat: z.lat, country: 'USA', continent: 'North America', approx: true } : undefined
}

function stateOrAdmin1(text: string, ctx: GeoContext): GeoMatch | undefined {
  if (!ctx.country || ctx.country === 'USA') {
    const s = findState(text) ?? (ctx.country === 'USA' ? findTerritory(text) : undefined)
    if (s) return stateMatch(s)
  }
  return admin1Match(text, ctx)
}

/** A qualifier inside a compound value ("…, TX", "…, Ontario", "…, France", "…, WA 98052"). */
function applyQualifier(q: string, ctx: GeoContext): GeoContext | undefined {
  const t = q.replace(/\s+\d{5}(?:-?\d{4})?$/, '').trim()
  if (!t) return ctx
  const st = findState(t)
  // two-letter qualifiers are US states first ("Paris, TX"), then countries ("Paris, FR")
  if (st && (!ctx.country || ctx.country === 'USA')) return { ...ctx, country: 'USA', state: st.code }
  const c = findCountry(t, true)
  if (c) return { ...ctx, country: c.a3, state: c.a3 === 'USA' ? ctx.state : undefined }
  const a1 = admin1Match(t, ctx)
  if (a1) return { ...ctx, country: a1.country, admin1: a1.name }
  return undefined
}

/** Resolve one location value with its role and context. */
export function geocodeValue(value: Scalar, role: LocationRole, ctx: GeoContext = {}): GeoMatch | undefined {
  if (value === null || value === undefined || role === 'latitude' || role === 'longitude' || role === 'county') return undefined
  if (value instanceof Date || typeof value === 'boolean') return undefined
  const text = String(value).trim()
  if (!text) return undefined
  switch (role) {
    case 'postal':
      return postalMatch(value, ctx)
    case 'continent':
      return continentMatch(text)
    case 'country':
      return countryMatch(text, true) ?? continentMatch(text)
    case 'state':
      return stateOrAdmin1(text, ctx)
    case 'city':
      return compound(text, ctx, true) ?? (text.includes(',') ? undefined : single(text, ctx))
    case 'place':
    case 'address':
      return compound(text, ctx, true) ?? single(text, ctx)
    default:
      return single(text, ctx) ?? compound(text, ctx, false)
  }
}

function continentMatch(text: string): GeoMatch | undefined {
  const c = findContinent(text)
  return c ? { kind: 'continent', name: c.name, lon: c.lon, lat: c.lat, continent: c.name, approx: true } : undefined
}

/** A value without a role: country, US state, postal code, continent, city, admin-1 (in that order). */
function single(text: string, ctx: GeoContext): GeoMatch | undefined {
  const key = normalizeLocation(text)
  if (!key) return undefined
  const st = !ctx.country || ctx.country === 'USA' ? findState(text) : undefined
  const preferState = st && (ctx.preferStates || ctx.state !== undefined || ctx.country === 'USA' || key.length > 2)
  // "Georgia" (and other names shared with countries) is the country unless the column is about US states
  const countryToo = findCountry(text, !ctx.preferStates)
  if (st && preferState && !(countryToo && !ctx.preferStates && ctx.country !== 'USA' && key.length > 2)) return stateMatch(st)
  if (countryToo && !ctx.country) return countryMatch(text, !ctx.preferStates)
  if (st) return stateMatch(st)
  if (ZIP_RE.test(text)) return postalMatch(text, ctx)
  const cont = ctx.country ? undefined : continentMatch(text)
  if (cont) return cont
  return findCity(text, ctx) ?? admin1Match(text, ctx) ?? (ctx.country ? undefined : countryMatch(text, false))
}

/**
 * Compound values: "City, ST", "City, State, Country", "Street, City, ST 12345", "City ST".
 * `asCity`: the first resolvable part is a city/place (City / Place / Address roles).
 */
function compound(text: string, ctx: GeoContext, asCity: boolean): GeoMatch | undefined {
  const parts = text
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 1) {
    if (!asCity) return undefined
    const direct = findCity(parts[0], ctx)
    if (direct) return direct
    // "Cincinnati OH" / "Portland Oregon"
    const m = /^(.+?)\s+([A-Za-z.]+(?:\s[A-Za-z.]+)?)$/.exec(parts[0])
    if (m) {
      const q = applyQualifier(m[2], ctx)
      if (q) return findCity(m[1], q)
    }
    return undefined
  }
  // qualifiers from the right: "Springfield, IL, USA" → USA then IL
  for (let start = 0; start < parts.length - 1; start++) {
    let c: GeoContext | undefined = { ...ctx }
    for (let i = parts.length - 1; i > start && c; i--) c = applyQualifier(parts[i], c)
    if (!c) continue
    const head = parts[start]
    if (/^\d/.test(head) && !ZIP_RE.test(head)) continue // street address part
    // without a City category, "Texas, USA" is the state, not a township named Texas
    const region = asCity ? undefined : (c.state ? undefined : stateOrAdmin1(head, c)) ?? (c.country ? undefined : countryMatch(head, false))
    if (region) return region
    const city = findCity(head, c)
    if (city) return city
  }
  // "One Microsoft Way, Redmond, WA 98052": fall back to the postal code when present
  const zip = /\b(\d{5})(?:-\d{4})?\s*$/.exec(text)
  if (zip) return postalMatch(zip[1], ctx)
  return undefined
}

/** Fold a coarser level's match into the context of the finer levels. */
export function narrowContext(ctx: GeoContext, m: GeoMatch | undefined): GeoContext {
  if (!m) return ctx
  switch (m.kind) {
    case 'country':
      return { ...ctx, country: m.country }
    case 'state':
      return { ...ctx, country: 'USA', state: m.state }
    case 'admin1':
      return { ...ctx, country: m.country, admin1: m.name }
    default:
      return ctx
  }
}

export interface LevelInput {
  /** value of this level per category */
  values: Scalar[]
  dataCategory?: string
}

/**
 * Geocode categories whose location is described by one or more hierarchy levels (coarse → fine).
 * The finest level is the location; coarser levels only narrow the search. `base` carries
 * context from drill-down filters.
 */
export function geocodeCategories(levels: LevelInput[], base: GeoContext = {}): Array<GeoMatch | undefined> {
  if (!levels.length) return []
  const n = levels[0].values.length
  const roles = levels.map((l) => roleFromDataCategory(l.dataCategory) ?? inferRole(l.values))
  const fine = levels.length - 1
  const preferStates = base.preferStates ?? (roles[fine] === 'state' || looksLikeStates(levels[fine].values, levels[fine].dataCategory))
  const run = (preferCountry: string | undefined): Array<GeoMatch | undefined> => {
    const out: Array<GeoMatch | undefined> = []
    for (let i = 0; i < n; i++) {
      let ctx: GeoContext = { ...base, preferStates, preferCountry }
      for (let li = 0; li < fine; li++) ctx = narrowContext(ctx, geocodeValue(levels[li].values[i], roles[li], { ...ctx, preferStates: roles[li] === 'state' || ctx.preferStates }))
      out.push(geocodeValue(levels[fine].values[i], roles[fine], ctx))
    }
    return out
  }
  const first = run(base.preferCountry)
  const counts = new Map<string, number>()
  for (const m of first) if (m?.country) counts.set(m.country, (counts.get(m.country) ?? 0) + 1)
  let dominant: string | undefined
  let best = 0
  for (const [c, k] of counts) if (k > best) [dominant, best] = [c, k]
  // a clear majority country re-ranks unqualified city names (e.g. "Springfield" in a US column)
  if (!dominant || dominant === base.preferCountry || best < Math.max(2, first.filter(Boolean).length * 0.5)) return first
  return run(dominant)
}
