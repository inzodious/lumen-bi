/**
 * Offline gazetteer: decodes ./gazetteer.data.ts (Natural Earth populated places and admin-1 label
 * points + US Census places and ZIP3 centroids, all public domain) into lookup indexes, lazily on
 * first use. Admin-1 regions not in the Natural Earth 1:50m table are placed at the
 * population-weighted mean of their known cities (approximate).
 *
 * APPROXIMATION: Power BI geocodes with Bing / Azure Maps (any address, street or postal code).
 * Lumen has no network geocoder; it knows ~6,500 world cities, ~15,000 US places with at least
 * 1,000 inhabitants, and US ZIP codes at 3-digit-prefix precision (ZIP3 centroid).
 */
import { ADMIN1, US_PLACES, US_ZIP3, WORLD_CITIES } from './gazetteer.data'
import { normalizeLocation } from './geo'

export interface Place {
  name: string
  lat: number
  lon: number
  /** population rank 0..14 (Natural Earth scale) */
  rank: number
  /** ISO alpha-2 country code */
  country: string
  /** admin-1: USPS code for US places, Natural Earth admin-1 name elsewhere */
  admin1: string
  capital: boolean
}

export interface Admin1 {
  name: string
  country: string
  lat: number
  lon: number
  /** summed population ranks of the member cities (used to rank ambiguous names) */
  weight: number
}

interface Index {
  byName: Map<string, Place[]>
  admin1: Map<string, Admin1[]>
}

let index: Index | undefined
let zip3: Map<string, { lat: number; lon: number }> | undefined

function b36(s: string): number {
  return parseInt(s, 36)
}

export function decodeCoord(s: string): { lat: number; lon: number } {
  const lat = b36(s.slice(0, 3)) / 100 - 90
  let lon = b36(s.slice(3, 6)) / 100 - 180
  if (lon >= 180) lon -= 360
  return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 }
}

function addPlace(idx: Index, p: Place, names: string[]): void {
  for (const n of names) {
    const k = normalizeLocation(n)
    if (!k) continue
    const list = idx.byName.get(k)
    if (list) {
      if (!list.includes(p)) list.push(p)
    } else idx.byName.set(k, [p])
  }
}

function build(): Index {
  const idx: Index = { byName: new Map(), admin1: new Map() }
  const a1acc = new Map<string, { name: string; country: string; lat: number; lon: number; w: number; n: number }>()
  for (const block of WORLD_CITIES) {
    let country = ''
    let admin1 = ''
    for (const rec of block.split(';')) {
      if (rec.startsWith('=')) {
        country = rec.slice(1)
        continue
      }
      if (rec.startsWith('~')) {
        admin1 = rec.slice(1)
        continue
      }
      const { lat, lon } = decodeCoord(rec)
      const rc = rec[6]
      const capital = rc !== rc.toLowerCase()
      const names = rec.slice(7).split('|')
      const p: Place = { name: names[0], lat, lon, rank: b36(rc.toLowerCase()), country, admin1, capital }
      addPlace(idx, p, names)
      if (admin1) {
        // admin-1 centroid approximated by the population-weighted mean of its cities
        const key = country + '|' + normalizeLocation(admin1)
        const w = Math.pow(2, p.rank)
        const a = a1acc.get(key) ?? { name: admin1, country, lat: 0, lon: 0, w: 0, n: 0 }
        a.lat += lat * w
        a.lon += lon * w
        a.w += w
        a.n++
        a1acc.set(key, a)
      }
    }
  }
  for (const block of US_PLACES) {
    let state = ''
    for (const rec of block.split(';')) {
      if (rec.startsWith('~')) {
        state = rec.slice(1)
        continue
      }
      const { lat, lon } = decodeCoord(rec)
      const names = rec.slice(7).split('|')
      addPlace(idx, { name: names[0], lat, lon, rank: b36(rec[6]), country: 'US', admin1: state, capital: false }, names)
    }
  }
  // Natural Earth admin-1 label points (English names, postal codes) take precedence
  const labelled = new Set<string>()
  for (const rec of ADMIN1) {
    const country = rec.slice(0, 2)
    const { lat, lon } = decodeCoord(rec.slice(2, 8))
    const names = rec.slice(8).split('|')
    const a: Admin1 = { name: names[0], country, lat, lon, weight: 2 ** 20 }
    for (const n of names) {
      const k = normalizeLocation(n)
      if (!k) continue
      labelled.add(country + '|' + k)
      const list = idx.admin1.get(k) ?? []
      if (!list.includes(a)) list.push(a)
      idx.admin1.set(k, list)
    }
  }
  for (const [key, a] of a1acc) {
    if (labelled.has(key)) continue
    const k = key.slice(key.indexOf('|') + 1)
    const list = idx.admin1.get(k) ?? []
    list.push({ name: a.name, country: a.country, lat: Math.round((a.lat / a.w) * 100) / 100, lon: Math.round((a.lon / a.w) * 100) / 100, weight: a.w })
    idx.admin1.set(k, list)
  }
  return idx
}

function getIndex(): Index {
  index ??= build()
  return index
}

let major: Place[] | undefined

/** Places with population rank >= minRank (>= 8, ~50,000 inhabitants), most populous first — basemap city labels. */
export function majorPlaces(minRank: number): Place[] {
  if (!major) {
    const set = new Set<Place>()
    for (const list of getIndex().byName.values()) for (const p of list) if (p.rank >= 8) set.add(p)
    major = [...set].sort((a, b) => b.rank - a.rank || Number(b.capital) - Number(a.capital))
  }
  const r = Math.max(8, minRank)
  return major.filter((p) => p.rank >= r)
}

/** All places whose name (or alias) matches. */
export function findPlaces(name: string): Place[] {
  return getIndex().byName.get(normalizeLocation(name)) ?? []
}

/** Admin-1 regions (outside the US) whose name matches, optionally within a country (ISO alpha-2). */
export function findAdmin1(name: string, country?: string): Admin1[] {
  const list = getIndex().admin1.get(normalizeLocation(name)) ?? []
  return country ? list.filter((a) => a.country === country) : list
}

/**
 * ZIP3 centroid of a US ZIP code ("15012", "15012-1234", or a number that lost its leading
 * zeros, e.g. 2134 → "02134"). APPROXIMATION: all ZIPs sharing the first 3 digits share a point.
 */
export function zip3Centroid(zip: string | number): { lat: number; lon: number; prefix: string } | undefined {
  const s = typeof zip === 'number' ? (Number.isInteger(zip) && zip >= 0 && zip < 100000 ? String(zip).padStart(5, '0') : '') : zip.trim()
  const m = /^(\d{5})(?:-?\d{4})?$/.exec(s)
  if (!m) return undefined
  if (!zip3) {
    zip3 = new Map()
    for (let i = 0; i + 9 <= US_ZIP3.length; i += 9) zip3.set(US_ZIP3.slice(i, i + 3), decodeCoord(US_ZIP3.slice(i + 3, i + 9)))
  }
  const prefix = m[1].slice(0, 3)
  const c = zip3.get(prefix)
  return c ? { ...c, prefix } : undefined
}
