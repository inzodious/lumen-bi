/**
 * Basemap palettes approximating the Bing / Azure Maps styles offered by Power BI.
 *
 * APPROXIMATION: Power BI renders map tiles (roads, terrain, imagery, place labels). Lumen draws
 * vector country / US-state outlines only, colored to evoke each style; "aerial"/"satellite"
 * becomes a dark green-brown land on deep-blue water.
 */

export interface MapPalette {
  water: string
  land: string
  border: string
  /** interior US state borders */
  subBorder: string
  label: string
  labelHalo: string
  /** caption / control foreground */
  ui: string
  dark: boolean
}

const ROAD: MapPalette = { water: '#AAD3EE', land: '#F5F2EC', border: '#B7AFA6', subBorder: '#CFC8BF', label: '#6B6560', labelHalo: '#F5F2EC', ui: '#605E5C', dark: false }
const LIGHT: MapPalette = { water: '#D6E2EA', land: '#F8F8F6', border: '#C3C3C3', subBorder: '#D9D9D9', label: '#7A7A7A', labelHalo: '#F8F8F6', ui: '#605E5C', dark: false }
const GRAY: MapPalette = { water: '#CDD2D6', land: '#F2F2F2', border: '#B5B5B5', subBorder: '#CFCFCF', label: '#6E6E6E', labelHalo: '#F2F2F2', ui: '#605E5C', dark: false }
const DARK: MapPalette = { water: '#1E2226', land: '#3A3D40', border: '#5C6064', subBorder: '#4C5054', label: '#B4B4B4', labelHalo: '#3A3D40', ui: '#C8C6C4', dark: true }
const NIGHT: MapPalette = { water: '#0E1A2B', land: '#1F2A38', border: '#3C4B5E', subBorder: '#2F3C4D', label: '#9FB0C4', labelHalo: '#1F2A38', ui: '#C8C6C4', dark: true }
const AERIAL: MapPalette = { water: '#14304A', land: '#5E6B45', border: '#C9C3A6', subBorder: '#8E9070', label: '#F2F2F2', labelHalo: '#2E3524', ui: '#F3F2F1', dark: true }
const HC_DARK: MapPalette = { water: '#000000', land: '#1A1A1A', border: '#FFFFFF', subBorder: '#BFBFBF', label: '#FFFFFF', labelHalo: '#000000', ui: '#FFFFFF', dark: true }
const HC_LIGHT: MapPalette = { water: '#FFFFFF', land: '#F0F0F0', border: '#000000', subBorder: '#404040', label: '#000000', labelHalo: '#FFFFFF', ui: '#000000', dark: false }

/**
 * Palette for a `mapStyles.mapTheme` (Bing map / filled map: road, aerial, grayscale,
 * darkGrayscale, canvasLight, canvasDark) or an Azure Maps style name (road, grayscale_light,
 * grayscale_dark, night, road_shaded_relief, satellite, satellite_road_labels, high_contrast_*).
 */
export function mapPalette(theme: string | undefined): MapPalette {
  switch ((theme ?? 'road').replace(/[^a-z_]/gi, '').toLowerCase()) {
    case 'aerial':
    case 'satellite':
    case 'satellite_road_labels':
      return AERIAL
    case 'grayscale':
    case 'grayscale_light':
      return GRAY
    case 'darkgrayscale':
    case 'grayscale_dark':
    case 'canvasdark':
    case 'dark':
      return DARK
    case 'night':
      return NIGHT
    case 'canvaslight':
    case 'light':
      return LIGHT
    case 'high_contrast_dark':
      return HC_DARK
    case 'high_contrast_light':
      return HC_LIGHT
    default:
      return ROAD
  }
}

/** Shape map: no basemap, only shapes (PBI "Default colors": blank-area fill and borders). */
export const SHAPE_MAP_DEFAULTS = { blankFill: '#E6E6E6', border: '#FFFFFF', borderWidth: 1 }
