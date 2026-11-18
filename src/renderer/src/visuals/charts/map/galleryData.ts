/**
 * Neutral geography sample model for the map gallery entries (a per-entry engine, so the shared
 * sample model stays untouched). Fact table `Geo`: one row per store with US state / city / ZIP
 * code / coordinates, plus world rows with country / city / continent. Values are synthetic.
 */
import type { Scalar } from '@core/model/data'
import type { QueryEngine } from '@core/engine/api'
import { createMemoryEngine } from '../../common/memoryEngine'

type Row = Record<string, Scalar>

/** [city, state code, state name, ZIP, lat, lon] — approximate public coordinates. */
const US: Array<[string, string, string, string, number, number]> = [
  ['Seattle', 'WA', 'Washington', '98101', 47.61, -122.33],
  ['Portland', 'OR', 'Oregon', '97205', 45.52, -122.68],
  ['San Francisco', 'CA', 'California', '94103', 37.77, -122.42],
  ['Los Angeles', 'CA', 'California', '90012', 34.05, -118.24],
  ['San Diego', 'CA', 'California', '92101', 32.72, -117.16],
  ['Phoenix', 'AZ', 'Arizona', '85004', 33.45, -112.07],
  ['Denver', 'CO', 'Colorado', '80202', 39.74, -104.99],
  ['Salt Lake City', 'UT', 'Utah', '84111', 40.76, -111.89],
  ['Dallas', 'TX', 'Texas', '75201', 32.78, -96.8],
  ['Austin', 'TX', 'Texas', '78701', 30.27, -97.74],
  ['Houston', 'TX', 'Texas', '77002', 29.76, -95.37],
  ['Kansas City', 'MO', 'Missouri', '64105', 39.1, -94.58],
  ['Minneapolis', 'MN', 'Minnesota', '55401', 44.98, -93.27],
  ['Chicago', 'IL', 'Illinois', '60601', 41.88, -87.63],
  ['Detroit', 'MI', 'Michigan', '48226', 42.33, -83.05],
  ['Columbus', 'OH', 'Ohio', '43215', 39.96, -83.0],
  ['Nashville', 'TN', 'Tennessee', '37203', 36.16, -86.78],
  ['Atlanta', 'GA', 'Georgia', '30303', 33.75, -84.39],
  ['Miami', 'FL', 'Florida', '33131', 25.76, -80.19],
  ['Orlando', 'FL', 'Florida', '32801', 28.54, -81.38],
  ['Charlotte', 'NC', 'North Carolina', '28202', 35.23, -80.84],
  ['Raleigh', 'NC', 'North Carolina', '27601', 35.78, -78.64],
  ['Richmond', 'VA', 'Virginia', '23219', 37.54, -77.44],
  ['Washington', 'DC', 'District of Columbia', '20001', 38.91, -77.04],
  ['Baltimore', 'MD', 'Maryland', '21202', 39.29, -76.61],
  ['Philadelphia', 'PA', 'Pennsylvania', '19103', 39.95, -75.17],
  ['Pittsburgh', 'PA', 'Pennsylvania', '15222', 40.44, -80.0],
  ['New York', 'NY', 'New York', '10001', 40.75, -73.99],
  ['Boston', 'MA', 'Massachusetts', '02108', 42.36, -71.06],
  ['Anchorage', 'AK', 'Alaska', '99501', 61.22, -149.9],
  ['Honolulu', 'HI', 'Hawaii', '96813', 21.31, -157.86],
  ['Boise', 'ID', 'Idaho', '83702', 43.62, -116.2],
  ['Omaha', 'NE', 'Nebraska', '68102', 41.26, -95.93],
  ['Louisville', 'KY', 'Kentucky', '40202', 38.25, -85.76],
  ['New Orleans', 'LA', 'Louisiana', '70112', 29.95, -90.07],
  ['Milwaukee', 'WI', 'Wisconsin', '53202', 43.04, -87.91]
]

/** [city, country, continent] */
const WORLD: Array<[string, string, string]> = [
  ['Toronto', 'Canada', 'North America'],
  ['Vancouver', 'Canada', 'North America'],
  ['Montreal', 'Canada', 'North America'],
  ['Mexico City', 'Mexico', 'North America'],
  ['Monterrey', 'Mexico', 'North America'],
  ['Sao Paulo', 'Brazil', 'South America'],
  ['Buenos Aires', 'Argentina', 'South America'],
  ['Santiago', 'Chile', 'South America'],
  ['Bogota', 'Colombia', 'South America'],
  ['London', 'United Kingdom', 'Europe'],
  ['Manchester', 'United Kingdom', 'Europe'],
  ['Paris', 'France', 'Europe'],
  ['Lyon', 'France', 'Europe'],
  ['Berlin', 'Germany', 'Europe'],
  ['Munich', 'Germany', 'Europe'],
  ['Madrid', 'Spain', 'Europe'],
  ['Rome', 'Italy', 'Europe'],
  ['Amsterdam', 'Netherlands', 'Europe'],
  ['Stockholm', 'Sweden', 'Europe'],
  ['Warsaw', 'Poland', 'Europe'],
  ['Cairo', 'Egypt', 'Africa'],
  ['Lagos', 'Nigeria', 'Africa'],
  ['Nairobi', 'Kenya', 'Africa'],
  ['Johannesburg', 'South Africa', 'Africa'],
  ['Dubai', 'United Arab Emirates', 'Asia'],
  ['Mumbai', 'India', 'Asia'],
  ['Bangalore', 'India', 'Asia'],
  ['Singapore', 'Singapore', 'Asia'],
  ['Tokyo', 'Japan', 'Asia'],
  ['Osaka', 'Japan', 'Asia'],
  ['Seoul', 'South Korea', 'Asia'],
  ['Shanghai', 'China', 'Asia'],
  ['Sydney', 'Australia', 'Oceania'],
  ['Melbourne', 'Australia', 'Oceania'],
  ['Auckland', 'New Zealand', 'Oceania']
]

const CHANNELS = ['Online', 'Store', 'Partner']

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function geoRows(): Row[] {
  const r = rng(11)
  const rows: Row[] = []
  let id = 1
  const push = (base: Row, weight: number) => {
    for (const ch of CHANNELS) {
      if (r() < 0.2) continue
      const amount = Math.round(weight * (0.4 + r()) * (ch === 'Online' ? 1.3 : ch === 'Store' ? 1 : 0.6) * 1000)
      rows.push({ ...base, StoreId: id++, Channel: ch, Amount: amount, Margin: Math.round((0.12 + r() * 0.3) * 1000) / 1000 })
    }
  }
  US.forEach(([city, code, state, zip, lat, lon], i) => {
    push({ Country: 'United States', Continent: 'North America', State: state, StateCode: code, City: city, CityState: `${city}, ${code}`, PostalCode: zip, Latitude: lat, Longitude: lon }, 40 + ((i * 37) % 60))
  })
  WORLD.forEach(([city, country, continent], i) => {
    push({ Country: country, Continent: continent, State: null, StateCode: null, City: city, CityState: `${city}, ${country}`, PostalCode: null, Latitude: null, Longitude: null }, 20 + ((i * 53) % 70))
  })
  return rows
}

let engine: QueryEngine | undefined

export function geoEngine(): QueryEngine {
  engine ??= createMemoryEngine({
    factTable: 'Geo',
    fact: geoRows(),
    measures: [
      { table: 'Geo', name: 'Total Sales', formatString: '\\$#,0;(\\$#,0);\\$#,0', fn: (rows) => (rows.length ? rows.reduce((a, x) => a + (x.Amount as number), 0) : null) },
      { table: 'Geo', name: 'Stores', formatString: '#,0', fn: (rows) => (rows.length ? new Set(rows.map((x) => x.City)).size : null) },
      {
        table: 'Geo',
        name: 'Margin %',
        formatString: '0.0%',
        fn: (rows) => {
          const amt = rows.reduce((a, x) => a + (x.Amount as number), 0)
          return amt ? rows.reduce((a, x) => a + (x.Amount as number) * (x.Margin as number), 0) / amt : null
        }
      }
    ],
    columns: {
      'Geo.Country': { dataCategory: 'Country' },
      'Geo.Continent': { dataCategory: 'Continent' },
      'Geo.State': { dataCategory: 'StateOrProvince' },
      'Geo.StateCode': { dataCategory: 'StateOrProvince' },
      'Geo.City': { dataCategory: 'City' },
      'Geo.CityState': { dataCategory: 'City' },
      'Geo.PostalCode': { dataCategory: 'PostalCode' },
      'Geo.Latitude': { dataCategory: 'Latitude', dataType: 'double' },
      'Geo.Longitude': { dataCategory: 'Longitude', dataType: 'double' },
      'Geo.Amount': { dataType: 'double', formatString: '\\$#,0' }
    }
  })
  return engine
}
