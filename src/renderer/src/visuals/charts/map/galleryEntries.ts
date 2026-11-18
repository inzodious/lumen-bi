/** Gallery fixtures for the map visuals (own neutral geography model, see ./galleryData.ts). */
import { col, msr, props, visualJson, type GalleryEntry } from '../../gallery/registry'
import { geoEngine } from './galleryData'

const G = 'Geo'
const sales = msr(G, 'Total Sales')
const margin = msr(G, 'Margin %')
const stores = msr(G, 'Stores')
const country = col(G, 'Country')
const continent = col(G, 'Continent')
const state = col(G, 'State')
const stateCode = col(G, 'StateCode')
const city = col(G, 'City')
const cityState = col(G, 'CityState')
const zip = col(G, 'PostalCode')
const lat = col(G, 'Latitude')
const lon = col(G, 'Longitude')
const channel = col(G, 'Channel')

const lit = (v: string) => ({ Literal: { Value: v } })
const gradientFill = (input: any, min = '#DEEFFF', max = '#118DFF') => ({
  properties: {
    fill: {
      solid: {
        color: {
          expr: {
            FillRule: {
              Input: input,
              FillRule: { linearGradient2: { min: { color: lit(`'${min}'`) }, max: { color: lit(`'${max}'`) }, nullColoringStrategy: { strategy: lit("'asZero'") } } }
            }
          }
        }
      }
    }
  },
  selector: { data: [{ dataViewWildcard: { matchingOption: 1 } }] }
})

const engine = geoEngine()
const S = 'Maps'

export const mapGalleryEntries: GalleryEntry[] = [
  {
    id: 'filledMapStates',
    section: S,
    title: 'Total Sales by State (filled map, gradient)',
    json: visualJson('g_filledStates', 'filledMap', { Category: [state], Tooltips: [sales] }, { objects: { dataPoint: [gradientFill(sales)] } }),
    engine,
    width: 560,
    height: 340
  },
  {
    id: 'filledMapWorld',
    section: S,
    title: 'Total Sales by Country (filled map)',
    json: visualJson('g_filledWorld', 'filledMap', { Category: [country], Tooltips: [sales] }, { objects: { dataPoint: [gradientFill(sales, '#FDE7D8', '#E66C37')] } }),
    engine,
    width: 560,
    height: 340
  },
  {
    id: 'filledMapContinent',
    section: S,
    title: 'Stores by Continent (filled map, legend)',
    json: visualJson('g_filledContinent', 'filledMap', { Category: [continent], Series: [continent], Tooltips: [stores] }, { objects: { legend: [props({ show: true, position: 'Bottom' })], mapStyles: [props({ mapTheme: 'grayscale' })] } }),
    engine,
    width: 560,
    height: 340
  },
  {
    id: 'shapeMapStates',
    section: S,
    title: 'Margin % by State (shape map, color saturation)',
    json: visualJson('g_shapeStates', 'shapeMap', { Category: [stateCode], Values: [margin], Tooltips: [sales] }, { objects: { labels: [props({ show: false })] } }),
    engine,
    width: 520,
    height: 340
  },
  {
    id: 'bubbleMapCity',
    section: S,
    title: 'Total Sales by City (geocoded "City, ST")',
    json: visualJson('g_bubbleCity', 'map', { Category: [cityState], Size: [sales] }, { objects: { categoryLabels: [props({ show: true })], mapStyles: [props({ mapTheme: 'canvasLight' })] } }),
    engine,
    width: 620,
    height: 380
  },
  {
    id: 'bubbleMapSavedView',
    section: S,
    title: 'Saved view (Auto zoom off: mapControls center + zoom level)',
    json: visualJson('g_bubbleSaved', 'map', { Category: [cityState], Size: [sales] }, {
      objects: { mapControls: [props({ autoZoom: false, centerLatitude: 40.2, centerLongitude: -76.5, zoomLevel: 5.6, zoomButtonsVisible: true })], categoryLabels: [props({ show: true })] }
    }),
    engine,
    width: 560,
    height: 340
  },
  {
    id: 'bubbleMapLatLong',
    section: S,
    title: 'Total Sales by City (latitude / longitude)',
    json: visualJson('g_bubbleLatLong', 'map', { Category: [city], Y: [lat], X: [lon], Size: [sales] }),
    engine,
    width: 560,
    height: 340
  },
  {
    id: 'bubbleMapPies',
    section: S,
    title: 'Total Sales by State and Channel (legend pies)',
    json: visualJson('g_bubblePies', 'map', { Category: [stateCode], Series: [channel], Size: [sales] }, { objects: { legend: [props({ show: true, position: 'Top', showTitle: false })] } }),
    engine,
    width: 620,
    height: 380
  },
  {
    id: 'bubbleMapZip',
    section: S,
    title: 'Total Sales by Postal Code (ZIP3 approximation)',
    json: visualJson('g_bubbleZip', 'map', { Category: [zip], Series: [channel], Size: [sales] }, { objects: { legend: [props({ show: true, position: 'Top', showTitle: false })], mapStyles: [props({ mapTheme: 'canvasLight' })] } }),
    engine,
    width: 620,
    height: 380
  },
  {
    id: 'bubbleMapWorldHierarchy',
    section: S,
    title: 'Total Sales by Country › City (expanded hierarchy, aerial, zoom buttons)',
    json: visualJson('g_bubbleWorld', 'map', { Category: [country, city], Size: [sales] }, { objects: { mapStyles: [props({ mapTheme: 'aerial' })], mapControls: [props({ zoomButtonsVisible: true })] } }),
    engine,
    drill: { level: 0, expandedLevel: 1 },
    width: 620,
    height: 360
  },
  {
    id: 'azureMapCountry',
    section: S,
    title: 'Total Sales by Country (Azure map, highlight Online)',
    json: visualJson('g_azureMap', 'azureMap', { Category: [country], Size: [sales] }, { objects: { mapStyles: [props({ mapTheme: 'grayscale_dark' })] } }),
    engine,
    highlightFilters: [{ Version: 2, Where: [{ Condition: { In: { Expressions: [channel], Values: [[lit("'Online'")]] } } }] }],
    width: 560,
    height: 340
  }
]
