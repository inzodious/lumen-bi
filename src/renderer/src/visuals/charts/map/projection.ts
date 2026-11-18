/**
 * Projection fitting and pan / zoom math for the map visuals (pure).
 *
 * Bubble / filled maps use Web Mercator like Bing and Azure Maps, fitted to the data ("Auto zoom",
 * on by default) and never wrapped across the antimeridian. Shape maps of US states use an
 * Albers USA composite (Alaska / Hawaii insets), close to Power BI's built-in "USA: States" map.
 * The user's pan / zoom is a screen-space transform (`View`) applied on top of the fitted projection.
 */
import { geoAlbersUsa, geoBounds, geoEquirectangular, geoMercator, geoOrthographic, type GeoPermissibleObjects, type GeoProjection } from 'd3-geo'
import type { Feature, Geometry } from 'geojson'

/** Mercator explodes near the poles: fitted bounds are clamped to this latitude band. */
export const LAT_MIN = -56
export const LAT_MAX = 72

export interface View {
  k: number
  x: number
  y: number
}

export const IDENTITY_VIEW: View = { k: 1, x: 0, y: 0 }

export type Bounds = [[number, number], [number, number]]

/** Lower 48 states: fit target for "United States" (Alaska / Hawaii would zoom the map far out). */
export const LOWER48: Bounds = [
  [-125, 24.5],
  [-66.9, 49.4]
]

export const WORLD_BOUNDS: Bounds = [
  [-169.9, LAT_MIN],
  [179.9, LAT_MAX + 6]
]

/**
 * Longitude/latitude bounds of a geometry. Objects crossing the antimeridian keep their larger
 * side (Russia → east, Alaska → west, Fiji → east), so maps never wrap.
 */
export function objectBounds(o: GeoPermissibleObjects): Bounds {
  const [[a, b], [c, d]] = geoBounds(o as any)
  if (a <= c) return [[a, b], [c, d]]
  const east = 180 - a
  const west = c + 180
  return east >= west ? [[a, b], [180, d]] : [[-180, b], [c, d]]
}

/** Union of bounds (and points), latitude-clamped; undefined when empty. */
export function unionBounds(list: Bounds[], points: Array<[number, number]> = []): Bounds | undefined {
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const [[a, b], [c, d]] of list) {
    x0 = Math.min(x0, a)
    x1 = Math.max(x1, c)
    y0 = Math.min(y0, b)
    y1 = Math.max(y1, d)
  }
  for (const [lon, lat] of points) {
    x0 = Math.min(x0, lon)
    x1 = Math.max(x1, lon)
    y0 = Math.min(y0, lat)
    y1 = Math.max(y1, lat)
  }
  if (!Number.isFinite(x0)) return undefined
  y0 = Math.max(LAT_MIN, Math.min(y0, LAT_MAX))
  y1 = Math.min(LAT_MAX, Math.max(y1, LAT_MIN))
  if (x1 - x0 > 300) {
    x0 = WORLD_BOUNDS[0][0]
    x1 = WORLD_BOUNDS[1][0]
  }
  return [
    [x0, y0],
    [x1, y1]
  ]
}

/** Bounds as a winding-proof MultiPoint fit target. */
export function boundsFeature([[x0, y0], [x1, y1]]: Bounds): Feature<Geometry> {
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] } }
}

export interface Extent {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Web Mercator fitted to bounds inside the extent with `pad` pixels of margin. A single point or
 * a tiny area doesn't zoom in further than `maxScale` (≈ a metropolitan area for city data).
 */
export function fitMercator(bounds: Bounds | undefined, extent: Extent, pad: number, maxScale?: number): GeoProjection {
  const p = geoMercator()
  const b = bounds ?? WORLD_BOUNDS
  const padX = Math.min(pad, extent.w / 3)
  const padY = Math.min(pad, extent.h / 3)
  p.fitExtent(
    [
      [extent.x + padX, extent.y + padY],
      [extent.x + extent.w - padX, extent.y + extent.h - padY]
    ],
    boundsFeature(b)
  )
  const limit = maxScale ?? Math.min(extent.w, extent.h) * 40
  if (p.scale() > limit) {
    const center: [number, number] = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2]
    p.scale(limit).translate([0, 0])
    const c = p(center) ?? [0, 0]
    p.translate([extent.x + extent.w / 2 - c[0], extent.y + extent.h / 2 - c[1]])
  }
  return p
}

export type ShapeProjection = 'mercator' | 'equirectangular' | 'orthographic' | 'albersUsa'

/** Projection fitted to a GeoJSON object (shape maps show the whole map, not just the data). */
export function fitShape(kind: ShapeProjection, obj: GeoPermissibleObjects, extent: Extent, pad: number): GeoProjection {
  const p = kind === 'albersUsa' ? geoAlbersUsa() : kind === 'equirectangular' ? geoEquirectangular() : kind === 'orthographic' ? geoOrthographic() : geoMercator()
  const target: GeoPermissibleObjects = kind === 'mercator' || kind === 'equirectangular' ? boundsFeature(unionBounds([objectBounds(obj)]) ?? WORLD_BOUNDS) : obj
  p.fitExtent(
    [
      [extent.x + pad, extent.y + pad],
      [extent.x + extent.w - pad, extent.y + extent.h - pad]
    ],
    target as any
  )
  return p as GeoProjection
}

export function applyView(v: View, pt: [number, number]): [number, number] {
  return [pt[0] * v.k + v.x, pt[1] * v.k + v.y]
}

/** Zoom by `factor` keeping the screen point (px, py) fixed. */
export function zoomAt(v: View, factor: number, px: number, py: number, minK = 1, maxK = 64): View {
  const k = Math.max(minK, Math.min(maxK, v.k * factor))
  const f = k / v.k
  return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f }
}

export function panBy(v: View, dx: number, dy: number): View {
  return { k: v.k, x: v.x + dx, y: v.y + dy }
}

/**
 * Bubble radius. 'proportional' (Bing map): area ∝ value, r = rMax·√(v/max), floored at rMin.
 * 'range' (Azure Maps bubble layer min/max radius): r = rMin + (rMax − rMin)·√(v/max).
 */
export function bubbleRadius(value: number, max: number, rMin: number, rMax: number, mode: 'proportional' | 'range' = 'proportional'): number {
  if (!(max > 0) || !Number.isFinite(value)) return rMin
  const t = Math.min(1, Math.sqrt(Math.abs(value) / max))
  return mode === 'range' ? rMin + (rMax - rMin) * t : Math.max(rMin, rMax * t)
}

// ------------------------------------------------------------------------------------------------
// Saved map view (mapControls.centerLatitude / centerLongitude / zoomLevel (Bing) or zoom (Azure))
// ------------------------------------------------------------------------------------------------

/** Web Mercator zoom level z ↔ d3 scale: the world is 256·2^z px wide (2π·scale in d3 units). */
export function zoomLevelToScale(z: number): number {
  return (256 * 2 ** z) / (2 * Math.PI)
}

export function scaleToZoomLevel(scale: number): number {
  return Math.log2((scale * 2 * Math.PI) / 256)
}

/** Mercator projection centred on (lon, lat) at a Web Mercator zoom level, in the extent's centre. */
export function mercatorAt(lon: number, lat: number, zoomLevel: number, extent: Extent): GeoProjection {
  const p = geoMercator().scale(zoomLevelToScale(zoomLevel)).translate([0, 0])
  const c = p([lon, Math.max(-85, Math.min(85, lat))]) ?? [0, 0]
  p.translate([extent.x + extent.w / 2 - c[0], extent.y + extent.h / 2 - c[1]])
  return p
}

/** Centre (lon/lat) and Web Mercator zoom level currently shown: projection + user view transform. */
export function currentCenterZoom(p: GeoProjection, v: View, extent: Extent): { lon: number; lat: number; zoom: number } | null {
  const sx = (extent.x + extent.w / 2 - v.x) / v.k
  const sy = (extent.y + extent.h / 2 - v.y) / v.k
  const ll = p.invert?.([sx, sy])
  if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return null
  return { lon: ll[0], lat: ll[1], zoom: scaleToZoomLevel(p.scale() * v.k) }
}
