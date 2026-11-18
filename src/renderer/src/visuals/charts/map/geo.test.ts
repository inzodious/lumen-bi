import { describe, expect, it } from 'vitest'
import { COUNTRIES, findContinent, findCountry, findState, looksLikeStates, normalizeLocation, US_STATES } from './geo'
import { decodeCoord, findAdmin1, findPlaces, zip3Centroid } from './gazetteer'
import { findCity, geocodeCategories, geocodeValue, inferRole, roleFromDataCategory } from './geocode'
import { deriveMapQuery } from './mapQuery'
import { getAtlas } from './atlas'

const near = (m: { lat: number; lon: number } | undefined, lat: number, lon: number, tol = 0.6) => {
  expect(m).toBeDefined()
  expect(Math.abs(m!.lat - lat)).toBeLessThan(tol)
  expect(Math.abs(m!.lon - lon)).toBeLessThan(tol)
}

describe('normalizeLocation', () => {
  it('strips case, accents and punctuation', () => {
    expect(normalizeLocation("  Côte d'Ivoire ")).toBe('cote d ivoire')
    expect(normalizeLocation('U.S.A.')).toBe('u s a')
    expect(normalizeLocation('Bosnia & Herzegovina')).toBe('bosnia and herzegovina')
  })
})

describe('countries', () => {
  it('covers every Natural Earth admin-0 entity with unique alpha-3 codes', () => {
    expect(COUNTRIES.length).toBeGreaterThan(230)
    expect(new Set(COUNTRIES.map((c) => c.a3)).size).toBe(COUNTRIES.length)
  })
  it('matches names, aliases and ISO codes', () => {
    expect(findCountry('germany')?.a3).toBe('DEU')
    for (const a of ['USA', 'United States', 'U.S.A.', 'us', 'United States of America']) expect(findCountry(a)?.a3).toBe('USA')
    expect(findCountry('Great Britain')?.a3).toBe('GBR')
    expect(findCountry('Czech Republic')?.a3).toBe('CZE')
    expect(findCountry('Russian Federation')?.a3).toBe('RUS')
    expect(findCountry('Ivory Coast')?.a3).toBe('CIV')
    expect(findCountry('Democratic Republic of the Congo')?.a3).toBe('COD')
    expect(findCountry('Bosnia and Herzegovina')?.a3).toBe('BIH')
    expect(findCountry('DEU')?.a3).toBe('DEU')
    expect(findCountry('KOR')?.a3).toBe('KOR')
    expect(findCountry('GB')?.a3).toBe('GBR')
    expect(findCountry('GB', false)).toBeUndefined()
  })
  it('maps every world-atlas outline to a country code', () => {
    const atlas = getAtlas()
    for (const c of atlas.countries) expect(c.a3).toMatch(/^[A-Z]{3}$/)
    expect(atlas.countryByA3.get('MKD')).toBeDefined()
    expect(atlas.countryByA3.get('KOS')).toBeDefined()
  })
})

describe('US states', () => {
  it('has 50 states + DC with unique codes and FIPS', () => {
    expect(US_STATES).toHaveLength(51)
    expect(new Set(US_STATES.map((s) => s.code)).size).toBe(51)
    expect(new Set(US_STATES.map((s) => s.fips)).size).toBe(51)
  })
  it('has a us-atlas polygon for every state', () => {
    const atlas = getAtlas()
    for (const s of US_STATES) expect(atlas.stateByCode.get(s.code)?.feature.geometry).toBeTruthy()
    expect(atlas.states51.features).toHaveLength(51)
    expect(atlas.stateBorders.type).toBe('MultiLineString')
  })
  it('finds states by name, code and abbreviations', () => {
    expect(findState('texas')?.code).toBe('TX')
    expect(findState('NY')?.name).toBe('New York')
    expect(findState('Washington D.C.')?.code).toBe('DC')
    expect(findState('DELWARE')?.code).toBe('DE')
  })
  it('detects state columns', () => {
    expect(looksLikeStates(['California', 'Texas', 'NY'])).toBe(true)
    expect(looksLikeStates(['Germany', 'France'])).toBe(false)
    expect(looksLikeStates(['Germany'], 'StateOrProvince')).toBe(true)
    expect(looksLikeStates(['CA', 'TX'], 'Country')).toBe(false)
  })
})

describe('gazetteer', () => {
  it('decodes base-36 coordinates', () => {
    // (lat + 90) * 100 = 12000 → "998", (lon + 180) * 100 = 18000 → "dw0"? (3 chars: 18000 = "dvc")
    expect(decodeCoord((12000).toString(36).padStart(3, '0') + (18000).toString(36).padStart(3, '0'))).toEqual({ lat: 30, lon: 0 })
  })
  it('knows world cities and US places', () => {
    near(findPlaces('Paris').find((p) => p.country === 'FR'), 48.86, 2.35)
    near(findPlaces('Akron').find((p) => p.admin1 === 'OH'), 41.08, -81.52)
    expect(findPlaces('Belle Vernon').some((p) => p.admin1 === 'PA')).toBe(true)
    expect(findPlaces('Mexico City').some((p) => p.country === 'MX')).toBe(true)
  })
  it('knows aliases (St. / Saint, Ft. / Fort, consolidated cities)', () => {
    expect(findPlaces('St. Louis').some((p) => p.admin1 === 'MO')).toBe(true)
    expect(findPlaces('Ft. Oglethorpe').some((p) => p.admin1 === 'GA')).toBe(true)
    expect(findPlaces('Nashville').some((p) => p.admin1 === 'TN')).toBe(true)
    expect(findPlaces('Honolulu').some((p) => p.admin1 === 'HI')).toBe(true)
  })
  it('approximates admin-1 regions from their cities', () => {
    near(findAdmin1('Bayern', 'DE')[0], 48.6, 11.6, 1.5)
    near(findAdmin1('Ontario', 'CA')[0], 50, -86, 4)
    expect(findAdmin1('NSW')[0]?.country).toBe('AU')
  })
  it('places ZIP codes at their ZIP3 centroid', () => {
    near(zip3Centroid('15012'), 40.2, -79.8, 1)
    near(zip3Centroid('98052-1234'), 47.6, -122.1, 1.2)
    expect(zip3Centroid(2134)?.prefix).toBe('021')
    expect(zip3Centroid('ABCDE')).toBeUndefined()
    expect(zip3Centroid('00000')).toBeUndefined()
  })
})

describe('geocodeValue', () => {
  it('maps data categories to roles', () => {
    expect(roleFromDataCategory('StateOrProvince')).toBe('state')
    expect(roleFromDataCategory('PostalCode')).toBe('postal')
    expect(roleFromDataCategory('City')).toBe('city')
    expect(roleFromDataCategory('ImageUrl')).toBeUndefined()
  })
  it('disambiguates 2-letter codes and Georgia', () => {
    expect(geocodeValue('CA', 'auto')?.country).toBe('CAN')
    expect(geocodeValue('CA', 'auto', { preferStates: true })?.state).toBe('CA')
    expect(geocodeValue('CA', 'state')?.state).toBe('CA')
    expect(geocodeValue('IN', 'auto')?.country).toBe('IND')
    expect(geocodeValue('Georgia', 'auto')).toMatchObject({ kind: 'country', country: 'GEO' })
    expect(geocodeValue('Georgia', 'auto', { preferStates: true })).toMatchObject({ kind: 'state', state: 'GA' })
    expect(geocodeValue('Georgia', 'state')).toMatchObject({ kind: 'state', state: 'GA' })
    expect(geocodeValue('Texas', 'auto')).toMatchObject({ kind: 'state', state: 'TX' })
  })
  it('resolves "City, ST", "City ST", "City, Country" and "City, State, Country"', () => {
    expect(geocodeValue('Austin, TX', 'auto')).toMatchObject({ kind: 'city', state: 'TX' })
    expect(geocodeValue('Akron, OH', 'city')).toMatchObject({ kind: 'city', state: 'OH' })
    expect(geocodeValue('Cincinnati OH', 'city')).toMatchObject({ kind: 'city', state: 'OH' })
    expect(geocodeValue('Milwaukee, Wi', 'city')).toMatchObject({ kind: 'city', state: 'WI' })
    expect(geocodeValue('Mexico City, Mexico', 'city')).toMatchObject({ kind: 'city', country: 'MEX' })
    expect(geocodeValue('Springfield, IL, USA', 'city')).toMatchObject({ kind: 'city', state: 'IL' })
    const paris = geocodeValue('Paris, TX', 'city')
    expect(paris).toMatchObject({ kind: 'city', state: 'TX' })
    expect(geocodeValue('Paris', 'city')).toMatchObject({ kind: 'city', country: 'FRA' })
    expect(geocodeValue('London, Canada', 'city')?.country).toBe('CAN')
    expect(geocodeValue('Texas, USA', 'auto')).toMatchObject({ kind: 'state', state: 'TX' })
  })
  it('does not guess: unknown cities with qualifiers stay unlocated', () => {
    expect(geocodeValue('Atlantis, TX', 'city')).toBeUndefined()
    expect(geocodeValue('Xyzzyville', 'auto')).toBeUndefined()
    expect(geocodeValue(null, 'auto')).toBeUndefined()
    expect(geocodeValue('  ', 'auto')).toBeUndefined()
    expect(geocodeValue('Some County', 'county')).toBeUndefined()
  })
  it('geocodes postal codes (US, ZIP3 precision) and addresses with ZIPs', () => {
    expect(geocodeValue('15012', 'postal')).toMatchObject({ kind: 'postal', approx: true, country: 'USA' })
    expect(geocodeValue(15012, 'postal')?.kind).toBe('postal')
    expect(geocodeValue('15012', 'postal', { country: 'DEU' })).toBeUndefined()
    expect(geocodeValue('One Example Way, Redmond, WA 98052', 'address')).toMatchObject({ kind: 'city', state: 'WA' })
    expect(geocodeValue('1 Nowhere Rd, Nowhereville, WA 98052', 'address')).toMatchObject({ kind: 'postal' })
  })
  it('geocodes continents and admin-1 regions', () => {
    expect(geocodeValue('Europe', 'continent')).toMatchObject({ kind: 'continent', continent: 'Europe' })
    expect(geocodeValue('North America', 'auto')?.kind).toBe('continent')
    expect(findContinent('Australia')?.name).toBe('Oceania')
    expect(geocodeValue('Ontario', 'state', { country: 'CAN' })).toMatchObject({ kind: 'admin1', country: 'CAN', approx: true })
    expect(geocodeValue('Bayern', 'auto')).toMatchObject({ kind: 'admin1', country: 'DEU' })
    expect(geocodeValue('London, ON', 'city')?.country).toBe('CAN')
  })
  it('uses the context of coarser levels', () => {
    expect(findCity('Portland', { state: 'ME' })?.state).toBe('ME')
    expect(findCity('Portland', {})?.state).toBe('OR')
    expect(findCity('London', { country: 'CAN' })?.country).toBe('CAN')
    expect(findCity('Portland', { state: 'NV' })).toBeUndefined()
  })
})

describe('geocodeCategories', () => {
  it('infers roles from values', () => {
    expect(inferRole(['15012', '27604'])).toBe('postal')
    expect(inferRole(['CA', 'TX', 'NY'])).toBe('state')
    expect(inferRole(['Germany', 'France'])).toBe('country')
  })
  it('resolves hierarchies coarse → fine', () => {
    const r = geocodeCategories([
      { values: ['USA', 'USA', 'Canada'], dataCategory: 'Country' },
      { values: ['ME', 'OR', 'Ontario'], dataCategory: 'StateOrProvince' },
      { values: ['Portland', 'Portland', 'London'], dataCategory: 'City' }
    ])
    expect(r[0]?.state).toBe('ME')
    expect(r[1]?.state).toBe('OR')
    expect(r[2]?.country).toBe('CAN')
  })
  it('prefers the dominant country for unqualified city names', () => {
    const r = geocodeCategories([{ values: ['Akron, OH', 'Erie, PA', 'Toledo, OH', 'Birmingham'], dataCategory: 'City' }])
    expect(r[3]?.country).toBe('USA')
    const uk = geocodeCategories([{ values: ['Manchester', 'Leeds', 'Birmingham'], dataCategory: 'City' }])
    expect(uk[2]?.country).toBe('GBR')
  })
  it('treats state-code columns as US states', () => {
    const r = geocodeCategories([{ values: ['CA', 'IN', 'GA', 'DE'] }])
    expect(r.map((m) => m?.state)).toEqual(['CA', 'IN', 'GA', 'DE'])
  })
  it('applies drill-down context', () => {
    const r = geocodeCategories([{ values: ['Springfield'], dataCategory: 'City' }], { country: 'USA', state: 'MA' })
    expect(r[0]?.state).toBe('MA')
  })
})

describe('deriveMapQuery', () => {
  const colX = { Column: { Expression: { SourceRef: { Entity: 'Geo' } }, Property: 'Longitude' } }
  const colY = { Column: { Expression: { SourceRef: { Entity: 'Geo' } }, Property: 'Latitude' } }
  const m = { Measure: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: 'Total Sales' } }
  const json = (qs: any) => ({ visual: { visualType: 'map', query: { queryState: qs } } })
  it('moves coordinate columns into averaged Lon/Lat roles', () => {
    const d = deriveMapQuery(json({ X: { projections: [{ field: colX }] }, Y: { projections: [{ field: colY }] }, Size: { projections: [{ field: m }] } }), 'map')
    expect(d.coordRoles).toEqual(['Lon', 'Lat'])
    expect(d.json.visual.query.queryState.Lon.projections[0].field.Aggregation.Function).toBe(1)
    expect(d.json.visual.query.queryState.X).toBeUndefined()
    expect(d.valueRoles).not.toContain('Y')
  })
  it('queries the input of fx fill colors when no value is bound (hidden CF role)', () => {
    const fill = { dataPoint: [{ properties: { fill: { solid: { color: { expr: { FillRule: { Input: m, FillRule: { linearGradient2: {} } } } } } } } }] }
    const cat = { Column: { Expression: { SourceRef: { Entity: 'Geo' } }, Property: 'State' } }
    const d = deriveMapQuery({ visual: { visualType: 'filledMap', query: { queryState: { Category: { projections: [{ field: cat }] } } }, objects: fill } }, 'filledMap')
    expect(d.cfRoles).toEqual(['CF'])
    expect(d.json.visual.query.queryState.CF.projections[0].field).toEqual(m)
    const withValue = deriveMapQuery({ visual: { visualType: 'map', query: { queryState: { Category: { projections: [{ field: cat }] }, Size: { projections: [{ field: m }] } } }, objects: fill } }, 'map')
    expect(withValue.cfRoles).toEqual([])
  })
  it('adds a hidden per-legend count when a legend has no value (LG role)', () => {
    const cat = { Column: { Expression: { SourceRef: { Entity: 'Geo' } }, Property: 'State' } }
    const ser = { Column: { Expression: { SourceRef: { Entity: 'Geo' } }, Property: 'Channel' } }
    const d = deriveMapQuery({ visual: { visualType: 'filledMap', query: { queryState: { Category: { projections: [{ field: cat }] }, Series: { projections: [{ field: ser }] } } } } }, 'filledMap')
    expect(d.legendRoles).toEqual(['LG'])
    expect(d.json.visual.query.queryState.LG.projections[0].field.Aggregation.Expression).toEqual(cat)
  })
  it('keeps Y as a value when it is a measure', () => {
    const d = deriveMapQuery(json({ Y: { projections: [{ field: m }] } }), 'filledMap')
    expect(d.coordRoles).toEqual([])
    expect(d.valueRoles).toContain('Y')
  })
})
