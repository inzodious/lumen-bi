/**
 * Map geometry, loaded synchronously (bundled with the map visuals, so maps never show a loading
 * state and headless captures render them in the first frame):
 *
 *  - world-atlas `countries-110m.json` (Natural Earth 1:110m admin-0, public domain): country outlines;
 *  - us-atlas `states-10m.json` (US Census cartographic boundaries 1:10m, public domain): US states
 *    + DC + territories, for filled / shape maps of states and as basemap detail.
 *
 * TopoJSON → GeoJSON conversion is done once, on first use.
 */
import { feature, mesh } from 'topojson-client'
import type { Feature, FeatureCollection, Geometry, MultiLineString } from 'geojson'
import worldTopo from 'world-atlas/countries-110m.json'
import usTopo from 'us-atlas/states-10m.json'
import { countryByN3, countryByName, US_STATES, US_TERRITORIES } from './geo'

export type GeoFeature = Feature<Geometry, { name: string }>

export interface AtlasCountry {
  a3: string
  name: string
  continent: string
  feature: GeoFeature
}

export interface AtlasState {
  code: string
  name: string
  feature: GeoFeature
}

export interface Atlas {
  countries: AtlasCountry[]
  countryByA3: Map<string, AtlasCountry>
  /** US states, DC and territories present in us-atlas */
  states: AtlasState[]
  stateByCode: Map<string, AtlasState>
  /** interior borders between US states (one path, for the basemap) */
  stateBorders: MultiLineString
  /** the 50 states + DC as one collection (shape map / Albers USA fitting) */
  states51: FeatureCollection<Geometry, { name: string }>
}

let atlas: Atlas | undefined

function build(): Atlas {
  const wt = worldTopo as any
  const fc = feature(wt, wt.objects.countries) as unknown as FeatureCollection<Geometry, { name: string }>
  const countries: AtlasCountry[] = []
  for (const f of fc.features) {
    const name = f.properties?.name ?? ''
    if (name === 'Antarctica' || name === 'Fr. S. Antarctic Lands') continue
    const c = (f.id !== undefined ? countryByN3(String(f.id)) : undefined) ?? countryByName(name)
    countries.push({ a3: c?.a3 ?? name, name, continent: c?.continent ?? '', feature: f })
  }
  const ut = usTopo as any
  const sfc = feature(ut, ut.objects.states) as unknown as FeatureCollection<Geometry, { name: string }>
  const byFips = new Map([...US_STATES, ...US_TERRITORIES].map((s) => [s.fips, s]))
  const states: AtlasState[] = []
  for (const f of sfc.features) {
    const s = byFips.get(String(f.id))
    if (s) states.push({ code: s.code, name: s.name, feature: f })
  }
  const stateBorders = mesh(ut, ut.objects.states, (a: unknown, b: unknown) => a !== b) as MultiLineString
  const fifty = new Set(US_STATES.map((s) => s.code))
  return {
    countries,
    countryByA3: new Map(countries.map((c) => [c.a3, c])),
    states,
    stateByCode: new Map(states.map((s) => [s.code, s])),
    stateBorders,
    states51: { type: 'FeatureCollection', features: states.filter((s) => fifty.has(s.code)).map((s) => s.feature) }
  }
}

/** The (lazily converted) atlas. Synchronous: the TopoJSON is part of the bundle. */
export function getAtlas(): Atlas {
  atlas ??= build()
  return atlas
}
