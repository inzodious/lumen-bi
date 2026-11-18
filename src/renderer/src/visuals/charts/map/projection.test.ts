import { describe, expect, it } from 'vitest'
import { applyView, bubbleRadius, fitMercator, fitShape, LOWER48, objectBounds, panBy, unionBounds, zoomAt, LAT_MAX } from './projection'
import { getAtlas } from './atlas'
import { defaultGradient, legacySaturationRule, normalizeGradient, saturationColors } from './mapColors'
import { mapPalette } from './styles'
import { makePropContext } from '@core/report/props'
import { resolveTheme } from '@core/report/theme'

describe('bounds', () => {
  it('keeps the larger side of antimeridian-crossing shapes', () => {
    const atlas = getAtlas()
    const ak = objectBounds(atlas.stateByCode.get('AK')!.feature)
    expect(ak[0][0]).toBe(-180)
    expect(ak[1][0]).toBeLessThan(-125)
    const ru = objectBounds(atlas.countryByA3.get('RUS')!.feature)
    expect(ru[1][0]).toBe(180)
    expect(ru[0][0]).toBeGreaterThan(0)
  })
  it('unions bounds and points with a latitude clamp', () => {
    expect(unionBounds([])).toBeUndefined()
    const b = unionBounds([LOWER48], [[10, 85]])!
    expect(b[0][0]).toBe(-125)
    expect(b[1][0]).toBe(10)
    expect(b[1][1]).toBe(LAT_MAX)
  })
})

describe('projections', () => {
  const extent = { x: 0, y: 0, w: 400, h: 300 }
  it('fits Mercator bounds inside the extent', () => {
    const p = fitMercator(LOWER48, extent, 10)
    for (const pt of [[-125, 24.5], [-66.9, 49.4]] as Array<[number, number]>) {
      const [x, y] = p(pt)!
      expect(x).toBeGreaterThanOrEqual(9.5)
      expect(x).toBeLessThanOrEqual(390.5)
      expect(y).toBeGreaterThanOrEqual(9.5)
      expect(y).toBeLessThanOrEqual(290.5)
    }
  })
  it('caps the zoom for a single point and centers it', () => {
    const p = fitMercator([[-80, 40], [-80, 40]], extent, 10, 5000)
    expect(p.scale()).toBe(5000)
    const [x, y] = p([-80, 40])!
    expect(x).toBeCloseTo(200, 5)
    expect(y).toBeCloseTo(150, 5)
  })
  it('fits Albers USA with Alaska / Hawaii insets', () => {
    const p = fitShape('albersUsa', getAtlas().states51, extent, 5)
    const ak = p([-150, 64])
    const hi = p([-157.8, 21.3])
    expect(ak).not.toBeNull()
    expect(hi).not.toBeNull()
    expect(ak![1]).toBeGreaterThan(150) // inset drawn bottom-left
    expect(p([2.35, 48.86])).toBeNull()
  })
})

describe('view math', () => {
  it('zooms around a fixed point and pans', () => {
    const v = zoomAt({ k: 1, x: 0, y: 0 }, 2, 100, 50)
    expect(applyView(v, [100, 50])).toEqual([100, 50])
    expect(v.k).toBe(2)
    expect(zoomAt(v, 100, 0, 0, 1, 8).k).toBe(8)
    expect(zoomAt(v, 0.01, 0, 0, 1, 8).k).toBe(1)
    expect(panBy(v, 5, -5)).toEqual({ k: 2, x: v.x + 5, y: v.y - 5 })
  })
  it('sizes bubbles by area', () => {
    expect(bubbleRadius(100, 100, 2, 20)).toBe(20)
    expect(bubbleRadius(25, 100, 2, 20)).toBe(10)
    expect(bubbleRadius(0, 100, 2, 20)).toBe(2)
    expect(bubbleRadius(25, 100, 8, 40, 'range')).toBe(24)
    expect(bubbleRadius(5, 0, 3, 20)).toBe(3)
  })
})

describe('map colors', () => {
  const theme = resolveTheme()
  it('derives default saturation gradients from the data color', () => {
    const g = defaultGradient('#118DFF')
    expect(g.max).toBe('#118DFF')
    expect(g.min).not.toBe('#118DFF')
  })
  it('resolves minColor / maxColor placeholders of the legacy fillRule', () => {
    const rule = { linearGradient2: { min: { color: { expr: { Literal: { Value: "'minColor'" } } } }, max: { color: { expr: { Literal: { Value: "'maxColor'" } } } }, nullColoringStrategy: { strategy: { expr: { Literal: { Value: "'asZero'" } } } } } }
    const n = normalizeGradient(rule, '#118DFF', theme)
    expect(n.linearGradient2.max.color.Literal.Value).toBe("'#118DFF'")
    const cols = saturationColors([0, 50, 100, null], rule, '#118DFF', theme)
    expect(cols[2]?.toUpperCase()).toBe('#118DFF')
    expect(cols[0]).toBe(defaultGradient('#118DFF').min)
    expect(cols[3]).toBe(cols[0]) // asZero
  })
  it('evaluates explicit 3-color gradients', () => {
    const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
    const rule = { linearGradient3: { min: { color: lit("'#FF0000'") }, mid: { color: lit("'#FFFF00'") }, max: { color: lit("'#00FF00'") } } }
    const cols = saturationColors([0, 5, 10], rule, '#118DFF', theme)
    expect(cols.map((c) => c?.toUpperCase())).toEqual(['#FF0000', '#FFFF00', '#00FF00'])
  })
  it('finds the legacy rule in dataPoint objects', () => {
    const json = { visual: { visualType: 'filledMap', objects: { dataPoint: [{ properties: { fillRule: { linearGradient2: {} } } }] } } }
    expect(legacySaturationRule(makePropContext(json, theme))).toEqual({ linearGradient2: {} })
  })
  it('maps PBI / Azure style names to palettes', () => {
    expect(mapPalette('road').dark).toBe(false)
    expect(mapPalette('canvasDark').dark).toBe(true)
    expect(mapPalette('grayscale_dark')).toBe(mapPalette('darkGrayscale'))
    expect(mapPalette('satellite')).toBe(mapPalette('aerial'))
    expect(mapPalette(undefined)).toBe(mapPalette('road'))
  })
})

describe('saved map view (center + zoom level)', () => {
  it('zoom level ↔ scale round-trips (zoom 0 = 256 px world)', async () => {
    const { zoomLevelToScale, scaleToZoomLevel } = await import('./projection')
    expect(zoomLevelToScale(0) * 2 * Math.PI).toBeCloseTo(256)
    expect(scaleToZoomLevel(zoomLevelToScale(5.5))).toBeCloseTo(5.5)
  })
  it('mercatorAt centres the point; currentCenterZoom reads it back, including a user view', async () => {
    const { mercatorAt, currentCenterZoom, zoomAt, panBy, IDENTITY_VIEW } = await import('./projection')
    const ext = { x: 10, y: 20, w: 400, h: 300 }
    const p = mercatorAt(-98.5, 39.8, 4, ext)
    const c = p([-98.5, 39.8])!
    expect(c[0]).toBeCloseTo(210)
    expect(c[1]).toBeCloseTo(170)
    const r0 = currentCenterZoom(p, IDENTITY_VIEW, ext)!
    expect(r0.lon).toBeCloseTo(-98.5, 6)
    expect(r0.lat).toBeCloseTo(39.8, 6)
    expect(r0.zoom).toBeCloseTo(4, 6)
    // zoom in 2× around the centre and pan: zoom level +1, centre moves
    const v = panBy(zoomAt(IDENTITY_VIEW, 2, 210, 170), -50, 0)
    const r1 = currentCenterZoom(p, v, ext)!
    expect(r1.zoom).toBeCloseTo(5, 6)
    expect(r1.lon).toBeGreaterThan(-98.5)
    // restoring from the read-back view shows the same place
    const p2 = mercatorAt(r1.lon, r1.lat, r1.zoom, ext)
    const q1 = p2([-90, 35])!
    const q0 = p([-90, 35])!
    expect(q1[0]).toBeCloseTo(q0[0] * v.k + v.x, 4)
    expect(q1[1]).toBeCloseTo(q0[1] * v.k + v.y, 4)
  })
})
