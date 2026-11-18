/**
 * Map visuals drawn without tiles: filledMap / shapeMap (choropleth) and map / azureMap (bubbles).
 *
 *  - Geometry: world-atlas countries (1:110m) + us-atlas states (1:10m), bundled (./atlas.ts).
 *  - Geocoding: offline tables (./geocode.ts) for countries, US states, admin-1 regions, cities /
 *    US places, US ZIP codes (ZIP3 centroids) and continents; explicit latitude/longitude wins.
 *  - Projection: Web Mercator fitted to the data (Auto zoom) like Bing / Azure Maps; shape maps of
 *    US states use Albers USA with Alaska / Hawaii insets.
 *  - Interaction: wheel zoom, drag pan, double-click reset, optional zoom buttons, selection,
 *    cross-highlight, tooltips, drill.
 *
 * APPROXIMATION (shown in the UI as a subtle "Approximate basemap" caption with an explanatory
 * tooltip): Power BI renders Bing / Azure Maps tiles (roads, terrain, place labels) and geocodes
 * any address. Here the basemap is vector country / state outlines colored per map style, and
 * locations that the offline tables don't know are counted as "not located" instead of guessed.
 * Filled maps can only fill countries, US states and continents (no city / postal boundaries).
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { geoPath, type GeoPermissibleObjects, type GeoProjection } from 'd3-geo'
import { arc as d3arc, pie as d3pie } from 'd3-shape'
import type { VisualProps } from '../../contract'
import { buildCategorical, pointIdentity, type CategoricalData, type Series } from '../../common/categorical'
import { FormatReader, PBI } from '../../common/fmtProps'
import { Legend, measureLegend, readLegendStyle, type LegendItem } from '../../common/Legend'
import { makeInteractions } from '../../common/interaction'
import { pointTooltip } from '../../common/tooltip'
import { EmptyVisual, NoData, VisualError, useVisualQuery } from '../../common/VisualState'
import { approxWidth, fontAttrs, type FontSpec } from '../../common/text'
import { mixColor, rgba } from '../../common/color'
import { formatScalar } from '../../common/units'
import { getAtlas, type Atlas, type GeoFeature } from './atlas'
import { geocodeCategories, geocodeValue, narrowContext, roleFromDataCategory, type GeoContext, type GeoMatch } from './geocode'
import { countryByA3, US_STATES } from './geo'
import { majorPlaces } from './gazetteer'
import { deriveMapQuery, SATURATION_ROLES, type MapKind } from './mapQuery'
import { legacySaturationRule, saturationColors } from './mapColors'
import { applyView, bubbleRadius, currentCenterZoom, fitMercator, fitShape, IDENTITY_VIEW, LOWER48, mercatorAt, objectBounds, panBy, unionBounds, zoomAt, type Bounds, type Extent, type ShapeProjection, type View } from './projection'
import { setObjectProp } from '@core/report/props'
import { mapPalette, SHAPE_MAP_DEFAULTS, type MapPalette } from './styles'

const UI_FONT = "'Segoe UI', 'Selawik', 'Open Sans', sans-serif"

export function MapChart({ visual, width, height, ctx, kind, icon }: VisualProps & { kind: MapKind; icon: string }) {
  const json = visual.json
  const fmt = useMemo(() => new FormatReader(json, ctx.theme), [json, ctx.theme])
  const derived = useMemo(() => deriveMapQuery(json, kind), [json, kind])
  const q = useVisualQuery(derived.json, ctx, () =>
    buildCategorical(derived.json, ctx, {
      categoryRole: 'Category',
      seriesRole: 'Series',
      splitRoles: [...derived.valueRoles, ...derived.legendRoles],
      unsplitRoles: [...derived.coordRoles, ...derived.cfRoles],
      fmt,
      highlight: true,
      defaultSort: 'measureDesc',
      maxCategories: kind === 'shapeMap' ? 1500 : 3500
    })
  )

  if (!q.ok) return <VisualError error={q.error} height={height} />
  const qs = json?.visual?.query?.queryState ?? {}
  const hasLocation = (qs.Category?.projections ?? []).length > 0 || derived.coordRoles.length > 0
  if (!hasLocation) return <EmptyVisual icon={icon} width={width} height={height} />
  if (!q.data.categories.length) return <NoData height={height} />
  return <MapCanvas data={q.data} fmt={fmt} kind={kind} width={width} height={height} ctx={ctx} />
}

// ------------------------------------------------------------------------------------------------

interface Located {
  ci: number
  match?: GeoMatch
  /** explicit latitude / longitude */
  lon?: number
  lat?: number
}

interface Shape {
  key: string
  feature: GeoFeature
}

function numAt(s: Series | undefined, ci: number): number | undefined {
  const v = s?.values[ci]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function dedupeSeries(list: Series[]): Series[] {
  const seen = new Set<string>()
  return list.filter((s) => {
    if (seen.has(s.name)) return false
    seen.add(s.name)
    return true
  })
}

/** Geometry a match fills on a filled / shape map. */
function shapesFor(m: GeoMatch | undefined, atlas: Atlas): Shape[] {
  if (!m) return []
  if (m.kind === 'state' && m.state) {
    const s = atlas.stateByCode.get(m.state)
    return s ? [{ key: 's:' + s.code, feature: s.feature }] : []
  }
  if (m.kind === 'country' && m.country) {
    const c = atlas.countryByA3.get(m.country)
    return c ? [{ key: 'c:' + c.a3, feature: c.feature }] : []
  }
  if (m.kind === 'continent') return atlas.countries.filter((c) => c.continent === m.continent).map((c) => ({ key: 'c:' + c.a3, feature: c.feature }))
  return []
}

/** Fit bounds contributed by a filled shape (the USA fits the lower 48, like PBI's default view). */
function shapeBounds(sh: Shape): Bounds {
  return sh.key === 'c:USA' ? LOWER48 : objectBounds(sh.feature)
}

/** Context from drill-down filters (e.g. drilled into Country = France → cities resolve in France). */
function drillContext(ctx: VisualProps['ctx']): GeoContext {
  let g: GeoContext = {}
  for (const id of ctx.drill?.path ?? []) {
    for (const f of id.fields) {
      let dc: string | undefined
      try {
        dc = ctx.engine.describeField(f.expr)?.dataCategory
      } catch {
        dc = undefined
      }
      const role = roleFromDataCategory(dc) ?? 'auto'
      g = narrowContext(g, geocodeValue(f.value, role, g))
    }
  }
  return g
}

function MapCanvas({ data, fmt, kind, width, height, ctx }: { data: CategoricalData; fmt: FormatReader; kind: MapKind; width: number; height: number; ctx: VisualProps['ctx'] }) {
  const atlas = getAtlas()
  const inter = makeInteractions(ctx, { drillLevels: data.allLevels.length })
  const filled = kind === 'filledMap' || kind === 'shapeMap'
  const shape = kind === 'shapeMap'
  const azure = kind === 'azureMap'
  const valueSeries = data.series.filter((s) => s.role !== 'Lon' && s.role !== 'Lat' && s.role !== 'CF' && s.role !== 'LG')
  // legend-only maps: hidden per-legend-value counts give colors / pie slices, never sizes
  const lgSeries = data.series.filter((s) => s.role === 'LG')
  // per-location colors from fx conditional formatting evaluated over the hidden 'CF' query
  const cfSeries = data.series.filter((s) => s.role === 'CF')
  const cfColors = cfSeries[0]?.pointColors
  const lonS = data.series.find((s) => s.role === 'Lon')
  const latS = data.series.find((s) => s.role === 'Lat')
  const sizeSeries = valueSeries.filter((s) => s.role === 'Size' && !(filled && SATURATION_ROLES[kind].includes('Size')))
  const satSeries = valueSeries.filter((s) => !s.split && SATURATION_ROLES[kind].includes(s.role))
  const colorSeries = valueSeries.filter((s) => !sizeSeries.includes(s))
  const palette: MapPalette = mapPalette(fmt.optStr('mapStyles', 'mapTheme') ?? fmt.optStr('mapStyles', 'mapStyle'))

  // ---------------------------------------------------------------- legend
  const multi = !!data.seriesField
  const legendStyle = readLegendStyle(fmt, { show: multi, title: data.seriesField?.label ?? '' })
  const legendSeries = dedupeSeries([...valueSeries, ...lgSeries].filter((s) => s.split))
  const legendItems: LegendItem[] = legendSeries.map((s) => ({ key: s.key, label: s.name, color: s.color }))
  const lg = measureLegend(legendStyle, legendItems, width, height)
  let area: Extent = { x: 0, y: 0, w: width, h: height }
  let legendRect = { x: 0, y: 0, w: 0, h: 0 }
  if (lg.size) {
    const p = legendStyle.position
    if (p.startsWith('Top')) {
      legendRect = { x: 0, y: 0, w: width, h: lg.size }
      area = { x: 0, y: lg.size, w: width, h: height - lg.size }
    } else if (p.startsWith('Bottom')) {
      legendRect = { x: 0, y: height - lg.size, w: width, h: lg.size }
      area = { x: 0, y: 0, w: width, h: height - lg.size }
    } else if (p.startsWith('Left')) {
      legendRect = { x: 0, y: 0, w: lg.size, h: height }
      area = { x: lg.size, y: 0, w: width - lg.size, h: height }
    } else {
      legendRect = { x: width - lg.size, y: 0, w: lg.size, h: height }
      area = { x: 0, y: 0, w: width - lg.size, h: height }
    }
  }
  area = { ...area, w: Math.max(1, area.w), h: Math.max(1, area.h) }

  // ---------------------------------------------------------------- geocoding
  const drillKey = JSON.stringify(ctx.drill?.path ?? [])
  const located: Located[] = useMemo(() => {
    const levels = data.levels.map((l, li) => ({ values: data.categories.map((c) => c.values[li]), dataCategory: l.desc?.dataCategory }))
    const matches = levels.length ? geocodeCategories(levels, drillContext(ctx)) : []
    return data.categories.map((_, ci) => {
      const lon = numAt(lonS, ci)
      const lat = numAt(latS, ci)
      // filled maps need a Location to find a shape; lat/long only place bubbles
      if (!filled && lon !== undefined && lat !== undefined && lat >= -90 && lat <= 90) return { ci, lon, lat, match: matches[ci] }
      return { ci, match: matches[ci] }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, drillKey, filled])

  // shapes per category (filled / shape maps)
  const shapesByCi = new Map<number, Shape[]>()
  if (filled) for (const p of located) shapesByCi.set(p.ci, shapesFor(p.match, atlas))

  // shape maps: US states → Albers USA "USA: States" map; otherwise the world map
  const usStateMap = shape && (located.some((p) => p.match?.kind === 'state') || !located.some((p) => p.match?.kind === 'country' || p.match?.kind === 'continent'))

  // ---------------------------------------------------------------- sizes
  const sizeVals = data.categories.map((_, ci) => sizeSeries.reduce((a, s) => a + Math.abs(s.values[ci] ?? 0), 0))
  // scale over plotted locations only (a blank / unknown location must not shrink every bubble)
  const maxSize = Math.max(0, ...located.filter((p) => p.match || p.lon !== undefined).map((p) => sizeVals[p.ci]))
  const minSide = Math.min(area.w, area.h)
  let rMin: number
  let rMax: number
  let rFixed: number
  if (azure) {
    rMin = fmt.num('bubbleLayer', 'minBubbleRadius', 8)
    rMax = Math.max(rMin, fmt.num('bubbleLayer', 'maxRadius', 40))
    rFixed = fmt.num('bubbleLayer', 'bubbleRadius', 8)
  } else {
    // Bing map: area-proportional bubbles; bubbles.bubbleSize (−100..100, theme default −10) scales them
    const f = Math.max(0.1, 1 + fmt.num('bubbles', 'bubbleSize', 0) / 100)
    rMax = Math.max(5, Math.min(40, minSide * 0.055)) * f
    rMin = Math.max(3, 4 * f)
    rFixed = Math.max(3, Math.min(8, minSide * 0.02) * f)
  }
  const radius = (ci: number) => (sizeSeries.length && maxSize > 0 ? bubbleRadius(sizeVals[ci], maxSize, rMin, rMax, azure ? 'range' : 'proportional') : rFixed)

  // ---------------------------------------------------------------- projection
  // Auto zoom (default on) re-fits the map whenever the located data changes (filters, highlights).
  // Off: the map is fitted to the data once (first render at this size) and then stays put, like
  // Power BI, which keeps the view instead of following filter changes.
  const autoZoom = shape ? true : fmt.bool('mapControls', 'autoZoom', true)
  const dataKey = located.map((p) => (p.match ? p.match.kind + (p.match.country ?? '') + (p.match.state ?? '') + p.match.lon + ',' + p.match.lat : `${p.lon},${p.lat}`)).join(';')
  const layoutKey = [kind, area.x, area.y, area.w, area.h, usStateMap, fmt.optStr('shape', 'projectionEnum') ?? ''].join('|')
  const frozen = useRef<{ layoutKey: string; dataKey: string } | null>(null)
  if (autoZoom || !frozen.current || frozen.current.layoutKey !== layoutKey) frozen.current = { layoutKey, dataKey }
  const fitDataKey = frozen.current.dataKey
  // Saved view (Auto zoom off): PBI stores the map's centre and zoom level in mapControls
  // (centerLatitude / centerLongitude + zoomLevel for Bing maps, zoom for Azure Maps) and reopens there.
  const zoomProp = azure ? 'zoom' : 'zoomLevel'
  const savedLat = fmt.optNum('mapControls', 'centerLatitude')
  const savedLon = fmt.optNum('mapControls', 'centerLongitude')
  const savedZoom = fmt.optNum('mapControls', zoomProp)
  const savedView = !shape && !autoZoom && savedLat !== undefined && savedLon !== undefined && savedZoom !== undefined ? { lat: savedLat, lon: savedLon, zoom: savedZoom } : undefined
  const fitKey = layoutKey + '|' + fitDataKey + '|' + (savedView ? `${savedView.lon},${savedView.lat},${savedView.zoom}` : '')
  const fitBounds = useMemo((): Bounds | undefined => {
    const boxes: Bounds[] = []
    const pts: Array<[number, number]> = []
    for (const p of located) {
      if (filled) {
        for (const sh of shapesByCi.get(p.ci) ?? []) boxes.push(shapeBounds(sh))
      } else if (p.lon !== undefined && p.lat !== undefined) pts.push([p.lon, p.lat])
      else if (p.match?.kind === 'country' && p.match.country === 'USA') boxes.push(LOWER48)
      else if (p.match) pts.push([p.match.lon, p.match.lat])
    }
    return unionBounds(boxes, pts)
    // the bounds follow fitDataKey (frozen when auto zoom is off)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitDataKey, filled])
  const projection: GeoProjection = useMemo(() => {
    if (shape) {
      if (usStateMap) return fitShape('albersUsa', atlas.states51 as GeoPermissibleObjects, area, Math.max(4, minSide * 0.03))
      const pe = (fmt.optStr('shape', 'projectionEnum') ?? 'mercator') as ShapeProjection
      const world = { type: 'FeatureCollection', features: atlas.countries.map((c) => c.feature) } as GeoPermissibleObjects
      return fitShape(pe === 'equirectangular' || pe === 'orthographic' ? pe : 'mercator', world, area, Math.max(4, minSide * 0.03))
    }
    if (savedView) return mercatorAt(savedView.lon, savedView.lat, savedView.zoom, area)
    const pad = filled ? Math.max(6, minSide * 0.05) : Math.max(8, rMax + 4)
    // a lone city: show its metro area, not a street map
    return fitMercator(fitBounds, area, pad, minSide * 30)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, fitBounds])

  // ---------------------------------------------------------------- pan / zoom
  const [viewState, setViewState] = useState<{ key: string; view: View }>({ key: fitKey, view: IDENTITY_VIEW })
  const view = viewState.key === fitKey ? viewState.view : IDENTITY_VIEW
  const setView = (v: View) => {
    viewRef.current = v
    setViewState({ key: fitKey, view: v })
  }
  const viewRef = useRef(view)
  viewRef.current = view
  // the user can zoom out to the whole world, never beyond
  const minK = shape ? 1 : Math.min(1, area.w / (2 * Math.PI * projection.scale()))
  const maxK = 64
  const drag = useRef<{ x: number; y: number; v: View; moved: boolean } | null>(null)
  const clipSuffix = useMemo(() => Math.random().toString(36).slice(2, 9), [])
  const svgRef = useRef<SVGSVGElement | null>(null)
  const manualZoom = shape ? fmt.bool('zoom', 'manualZoom', true) : true
  // persist the view the user left the map at (only meaningful with Auto zoom off: with it on, PBI
  // re-fits the data on open). Wheel zooms are debounced so a scroll gesture is one undo step.
  const persistView = (v: View) => {
    if (shape || autoZoom) return
    const cz = currentCenterZoom(projection, v, area)
    if (!cz) return
    const r = (x: number) => Number(x.toFixed(6))
    ctx.updateVisual((j) => {
      setObjectProp(j, 'mapControls', 'centerLatitude', r(cz.lat))
      setObjectProp(j, 'mapControls', 'centerLongitude', r(cz.lon))
      setObjectProp(j, 'mapControls', zoomProp, Number(cz.zoom.toFixed(3)))
    })
  }
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const zoomRef = useRef({ minK, maxK, manualZoom, fitKey, persistView })
  zoomRef.current = { minK, maxK, manualZoom, fitKey, persistView }
  useEffect(() => () => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
  }, [])
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    // native, non-passive listener so the wheel zooms the map instead of scrolling the canvas
    const onWheel = (e: WheelEvent) => {
      const z = zoomRef.current
      if (!z.manualZoom) return
      e.preventDefault()
      const box = el.getBoundingClientRect()
      const factor = Math.pow(1.0018, -e.deltaY * (e.deltaMode === 1 ? 16 : 1))
      const next = zoomAt(viewRef.current, factor, e.clientX - box.left, e.clientY - box.top, z.minK, z.maxK)
      viewRef.current = next
      setViewState({ key: z.fitKey, view: next })
      if (persistTimer.current) clearTimeout(persistTimer.current)
      persistTimer.current = setTimeout(() => zoomRef.current.persistView(viewRef.current), 500)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ---------------------------------------------------------------- basemap (memoized per projection)
  const projKey = `${fitKey}|${projection.scale()}|${projection.translate().join(',')}`
  const path = useMemo(() => geoPath(projection), [projection])
  const base = useMemo(() => {
    const width = (f: GeoFeature) => {
      const b = path.bounds(f)
      return Number.isFinite(b[0][0]) ? b[1][0] - b[0][0] : 0
    }
    const stateList = shape && !usStateMap ? [] : atlas.states.filter((s) => !shape || US_STATES.some((u) => u.code === s.code))
    const states = stateList.map((s) => ({ key: 's:' + s.code, code: s.code, d: path(s.feature) ?? '', width: width(s.feature) }))
    const countryList = shape && usStateMap ? [] : atlas.countries
    const countries = countryList.map((c) => ({ key: 'c:' + c.a3, a3: c.a3, d: path(c.feature) ?? '', width: width(c.feature) }))
    const paths = new Map<string, string>()
    for (const x of [...states, ...countries]) paths.set(x.key, x.d)
    if (shape) return { land: usStateMap ? states : countries, states, countries, paths, stateBorders: '', usWidth: 0 }
    const sw = projection([LOWER48[0][0], 40])
    const se = projection([LOWER48[1][0], 40])
    const usWidth = sw && se ? Math.abs(se[0] - sw[0]) : 0
    return { land: countries, states, countries, paths, stateBorders: path(atlas.stateBorders) ?? '', usWidth }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projKey])
  const pathOf = (sh: Shape): string => base.paths.get(sh.key) ?? path(sh.feature) ?? ''

  // ---------------------------------------------------------------- colors
  const baseColor = (colorSeries[0] ?? sizeSeries[0])?.color || fmt.color('dataPoint', 'defaultColor', ctx.theme.dataColors[0])
  const satColors = useMemo(() => {
    const s = satSeries[0]
    if (!s || s.pointColors) return undefined
    return saturationColors(s.values, legacySaturationRule(fmt.pc), s.color || baseColor, ctx.theme)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, fmt])
  const colorOf = (ci: number): string | undefined => {
    if (multi) {
      for (const s of colorSeries.length ? colorSeries : sizeSeries.length ? sizeSeries : lgSeries) {
        if (!s.split || s.values[ci] === null) continue
        return s.pointColors?.[ci] ?? s.color
      }
      return undefined
    }
    for (const s of valueSeries) if (s.pointColors?.[ci]) return s.pointColors[ci]
    if (cfColors?.[ci]) return cfColors[ci]
    if (satColors) return satColors[ci] ?? (shape ? undefined : baseColor)
    return baseColor
  }
  const hl = data.hasHighlights
  const highlightRatio = (ci: number): number => {
    const ss = sizeSeries.length ? sizeSeries : colorSeries.length ? colorSeries : cfSeries.length ? cfSeries : lgSeries
    const tot = ss.reduce((a, s) => a + Math.abs(s.values[ci] ?? 0), 0)
    const h = ss.reduce((a, s) => a + Math.abs(s.highlights?.[ci] ?? 0), 0)
    return tot ? Math.min(1, h / tot) : 0
  }

  // ---------------------------------------------------------------- tooltips / handlers
  const tipSeries = (ci: number): Series | undefined => valueSeries.find((s) => s.split && s.values[ci] !== null) ?? valueSeries.find((s) => !s.split) ?? valueSeries[0] ?? lgSeries.find((s) => s.values[ci] !== null)
  const tooltip = (ci: number, s: Series | undefined) => {
    const extra = valueSeries
      .filter((o) => o !== s && !o.split && o.metadata !== s?.metadata)
      .map((o) => ({ label: o.measure.label, value: formatScalar(o.values[ci] ?? null, o.formats[ci] ?? o.measure.formatString, ctx.format) }))
    for (const c of [latS, lonS]) if (c) extra.push({ label: c.measure.label, value: formatScalar(c.values[ci] ?? null, c.formats[ci] ?? c.measure.formatString, ctx.format) })
    const items = pointTooltip(ctx, data, ci, s, extra)
    // the hidden legend count is not a field of the visual
    return s?.role === 'LG' ? items.filter((it) => it.label !== s.measure.label) : items
  }
  const handlers = (ci: number, s: Series | undefined) => {
    const id = pointIdentity(data.categories[ci], undefined)
    return {
      onClick: (e: ReactMouseEvent) => {
        if (drag.current?.moved) return
        inter.onPointClick(id, e)
      },
      onContextMenu: (e: ReactMouseEvent) => inter.onContextMenu(id, e),
      onMouseMove: (e: ReactMouseEvent) => inter.showTooltip(e, tooltip(ci, s), id),
      onMouseLeave: () => inter.hideTooltip(),
      style: { cursor: 'pointer' }
    }
  }

  // ---------------------------------------------------------------- layers
  const land: ReactNode[] = []
  const fills: ReactNode[] = []
  const filledKeys = new Set<string>()
  let shapeless = 0
  if (filled) {
    const blank = shape ? fmt.color('defaultColors', 'defaultColor', SHAPE_MAP_DEFAULTS.blankFill) : palette.land
    const borderC = shape ? fmt.color('defaultColors', 'borderColor', SHAPE_MAP_DEFAULTS.border) : '#FFFFFF'
    const borderW = shape ? fmt.num('defaultColors', 'borderThickness', SHAPE_MAP_DEFAULTS.borderWidth) : 0.75
    for (const p of located) {
      const shapes = shapesByCi.get(p.ci) ?? []
      if (p.match && !shapes.length) shapeless++
      const color = colorOf(p.ci)
      const id = pointIdentity(data.categories[p.ci], undefined)
      const op = hl ? (highlightRatio(p.ci) > 0 ? 1 : PBI.dimOpacity) : inter.opacityFor(id)
      for (const sh of shapes) {
        if (filledKeys.has(sh.key)) continue
        filledKeys.add(sh.key)
        fills.push(
          <path
            key={sh.key}
            d={pathOf(sh)}
            fill={color ?? blank}
            fillOpacity={(shape ? 1 : 0.9) * op}
            stroke={borderC}
            strokeWidth={borderW}
            strokeOpacity={op}
            vectorEffect="non-scaling-stroke"
            {...handlers(p.ci, tipSeries(p.ci))}
          />
        )
      }
    }
    if (shape)
      for (const l of base.land) if (!filledKeys.has(l.key)) land.push(<path key={l.key} d={l.d} fill={blank} stroke={borderC} strokeWidth={borderW} vectorEffect="non-scaling-stroke" />)
  }
  if (!shape) for (const l of base.land) land.push(<path key={l.key} d={l.d} fill={palette.land} stroke={palette.border} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />)
  const showStates = !shape && base.usWidth * view.k > 220

  const placed: Array<[number, number, number, number]> = []
  const collide = (x0: number, y0: number, x1: number, y1: number) => placed.some(([a, b, c, d]) => x0 < c && x1 > a && y0 < d && y1 > b)
  const inView = (x: number, y: number) => x > area.x && x < area.x + area.w && y > area.y && y < area.y + area.h

  // bubbles (screen space so they keep their pixel size while zooming, like Bing / Azure Maps)
  const bubbles: ReactNode[] = []
  const catLabels: ReactNode[] = []
  const catLabelsOn = shape ? fmt.bool('labels', 'show', false) : fmt.bool('categoryLabels', 'show', false) || fmt.bool('labels', 'show', false)
  const catObj = shape ? 'labels' : fmt.bool('categoryLabels', 'show', false) ? 'categoryLabels' : 'labels'
  const catStyle = fmt.text(catObj, {}, { size: PBI.dataLabelFontPt, color: PBI.dataLabelColor })
  const catBg = catObj === 'categoryLabels' && fmt.bool('categoryLabels', 'enableBackground', true)
  const catBgColor = rgba(fmt.color('categoryLabels', 'backgroundColor', '#FFFFFF'), 1 - fmt.num('categoryLabels', 'backgroundTransparency', 30) / 100)
  const catLabel = (ci: number, x: number, y: number, anchor: 'start' | 'middle') => {
    const text = data.categories[ci].label
    if (!text) return
    const w = approxWidth(text, catStyle.font)
    const h = catStyle.font.size + 4
    const x0 = anchor === 'middle' ? x - w / 2 - 3 : x - 3
    if (collide(x0, y - h / 2, x0 + w + 6, y + h / 2)) return
    placed.push([x0, y - h / 2, x0 + w + 6, y + h / 2])
    catLabels.push(
      <g key={'cl' + ci} pointerEvents="none">
        {catBg ? <rect x={x0} y={y - h / 2} width={w + 6} height={h} rx={2} fill={catBgColor} /> : null}
        <text x={x} y={y} dy="0.35em" textAnchor={anchor} {...fontAttrs(catStyle.font)} fill={catStyle.color} {...(catBg ? {} : { stroke: palette.dark ? '#000000' : '#FFFFFF', strokeWidth: 2.5, paintOrder: 'stroke' as const })}>
          {text}
        </text>
      </g>
    )
  }

  let unlocated = 0
  // Bing bubbles: translucent fill with a darker outline of the same hue; Azure: bubble layer settings
  const azureStroke = fmt.color('bubbleLayer', 'strokeColor', '#FFFFFF')
  const strokeOf = (color: string) => (azure ? azureStroke : mixColor(color, '#000000', 0.45))
  const strokeWidth = azure ? fmt.num('bubbleLayer', 'strokeWidth', 1) : 1
  const fillOpacity = azure ? 1 - fmt.num('bubbleLayer', 'transparency', 0) / 100 : 0.75
  for (const p of located) {
    const ci = p.ci
    const hasValue = data.categories[ci].values.some((v) => v !== null && v !== '')
    if (!p.match && p.lon === undefined) {
      if (hasValue) unlocated++
      continue
    }
    if (filled) continue
    const lon = p.lon ?? p.match!.lon
    const lat = p.lat ?? p.match!.lat
    const pt = projection([lon, lat])
    if (!pt) continue
    const [x, y] = applyView(view, pt as [number, number])
    const r = radius(ci)
    if (x < area.x - r || x > area.x + area.w + r || y < area.y - r || y > area.y + area.h + r) continue
    const id = pointIdentity(data.categories[ci], undefined)
    const op = hl ? 1 : inter.opacityFor(id)
    const splitSize = (sizeSeries.length ? sizeSeries : colorSeries.length ? colorSeries : lgSeries).filter((s) => s.split && (s.values[ci] ?? 0) !== 0)
    if (splitSize.length > 1) {
      // Power BI draws a pie in each bubble when a legend field is used
      const arcs = d3pie<Series>()
        .sort(null)
        .value((s) => Math.abs(s.values[ci] ?? 0))(splitSize)
      const a = d3arc<any>().innerRadius(0).outerRadius(r)
      bubbles.push(
        <g key={`b${ci}`} transform={`translate(${x},${y})`} opacity={op} {...handlers(ci, splitSize[0])}>
          {arcs.map((sl, k) => {
            const h = sl.data.highlights?.[ci]
            const dim = hl && !(typeof h === 'number' && h !== 0)
            return <path key={k} d={a(sl) ?? ''} fill={sl.data.pointColors?.[ci] ?? sl.data.color} fillOpacity={dim ? PBI.highlightBackOpacity : fillOpacity} stroke={azure ? azureStroke : '#FFFFFF'} strokeWidth={0.75} onMouseMove={(e) => inter.showTooltip(e, tooltip(ci, sl.data), { fields: [...id.fields, ...sl.data.scope] })} />
          })}
        </g>
      )
    } else {
      const color = colorOf(ci) ?? baseColor
      if (hl) {
        const ratio = highlightRatio(ci)
        bubbles.push(
          <g key={`b${ci}`} {...handlers(ci, tipSeries(ci))}>
            <circle cx={x} cy={y} r={r} fill={color} fillOpacity={PBI.highlightBackOpacity} stroke={strokeOf(color)} strokeOpacity={0.6} strokeWidth={strokeWidth} />
            {ratio > 0 ? <circle cx={x} cy={y} r={r * Math.sqrt(ratio)} fill={color} fillOpacity={fillOpacity} /> : null}
          </g>
        )
      } else bubbles.push(<circle key={`b${ci}`} cx={x} cy={y} r={r} fill={color} fillOpacity={fillOpacity * op} stroke={strokeOf(color)} strokeOpacity={op} strokeWidth={strokeWidth} {...handlers(ci, tipSeries(ci))} />)
    }
    if (catLabelsOn) catLabel(ci, x + r + 4, y, 'start')
  }
  if (filled && catLabelsOn)
    for (const p of located) {
      const m = p.match
      if (!m || !(shapesByCi.get(p.ci) ?? []).length) continue
      const pt = m.kind === 'continent' ? projection([m.lon, m.lat]) : path.centroid((shapesByCi.get(p.ci) ?? [])[0].feature)
      const anchor = m.kind === 'country' && m.country === 'USA' ? projection([-98.5, 39.5]) : m.kind === 'state' && usStateMap ? path.centroid(atlas.stateByCode.get(m.state ?? '')!.feature) : pt
      if (!anchor || !Number.isFinite(anchor[0])) continue
      const [x, y] = applyView(view, anchor as [number, number])
      if (inView(x, y)) catLabel(p.ci, x, y, 'middle')
    }

  // basemap labels (country / state / city names), screen space, placed after the category labels
  // (which win collisions), greedy collision avoidance. Bing-like: states in spaced capitals,
  // cities with a dot, the number of cities depending on the zoom.
  const baseLabels: ReactNode[] = []
  if (!shape && fmt.bool('mapStyles', 'showLabels', true)) {
    const font: FontSpec = { size: 10, family: 'Segoe UI', weight: 400 }
    const stateFont: FontSpec = { size: 9, family: 'Segoe UI', weight: 400 }
    const cand: Array<{ text: string; lon: number; lat: number; extent: number; kind: 'country' | 'state' | 'city' }> = []
    for (const c of base.countries) {
      const info = countryByA3(c.a3)
      // the US label gives way to state names once states are drawn
      if (!info || (showStates && c.a3 === 'USA')) continue
      cand.push({ text: info.name, lon: info.lon, lat: info.lat, extent: c.width * view.k, kind: 'country' })
    }
    if (showStates)
      for (const st of base.states) {
        const s = US_STATES.find((u) => u.code === st.code)
        if (!s) continue
        const ext = st.width * view.k
        const name = s.name.toUpperCase()
        cand.push({ text: ext > approxWidth(name, stateFont) * 1.15 + 6 ? name : s.code, lon: s.lon, lat: s.lat, extent: ext, kind: 'state' })
      }
    cand.sort((a, b) => b.extent - a.extent)
    // degrees of longitude visible → how many cities Bing would label
    const span = (area.w / (projection.scale() * view.k)) * (180 / Math.PI)
    const minRank = span > 150 ? 99 : span > 60 ? 13 : span > 30 ? 11 : span > 12 ? 10 : span > 5 ? 9 : span > 2 ? 8 : 6
    const x0 = projection.invert?.([(area.x - view.x) / view.k, (area.y + area.h / 2 - view.y) / view.k])
    const x1 = projection.invert?.([(area.x + area.w - view.x) / view.k, (area.y + area.h / 2 - view.y) / view.k])
    const cities = minRank < 99 && x0 && x1 ? majorPlaces(minRank).filter((c) => c.lon >= x0[0] - 1 && c.lon <= x1[0] + 1) : []
    let n = 0
    const tryLabel = (text: string, lon: number, lat: number, kind: 'country' | 'state' | 'city', extent: number) => {
      const f = kind === 'state' ? stateFont : font
      const w = approxWidth(text, f) * (kind === 'state' ? 1.15 : 1)
      if (kind !== 'city' && extent < w + 6) return
      const pt = projection([lon, lat])
      if (!pt) return
      const [x, y] = applyView(view, pt as [number, number])
      if (!inView(x, y)) return
      const lx = kind === 'city' ? x + 4 : x
      const box: [number, number, number, number] = kind === 'city' ? [x - 3, y - 7, lx + w + 2, y + 7] : [x - w / 2 - 2, y - 7, x + w / 2 + 2, y + 7]
      if (box[2] > area.x + area.w || collide(...box)) return
      placed.push(box)
      n++
      const common = { pointerEvents: 'none' as const, stroke: palette.labelHalo, strokeWidth: 2.5, paintOrder: 'stroke' as const, opacity: filled ? 0.85 : 1 }
      baseLabels.push(
        kind === 'city' ? (
          <g key={'bc' + text + lon} pointerEvents="none">
            <circle cx={x} cy={y} r={2} fill={palette.dark ? '#BDBDBD' : '#8A8886'} stroke={palette.labelHalo} strokeWidth={0.75} />
            <text x={lx} y={y} dy="0.35em" {...fontAttrs(font)} fill={palette.label} {...common}>
              {text}
            </text>
          </g>
        ) : (
          <text key={'bl' + text + lon} x={x} y={y} dy="0.35em" textAnchor="middle" {...fontAttrs(f)} letterSpacing={kind === 'state' ? 1 : undefined} fill={palette.label} {...common} fillOpacity={kind === 'state' ? 0.8 : 1}>
            {text}
          </text>
        )
      )
    }
    for (const c of cand) {
      if (n >= 60) break
      tryLabel(c.text, c.lon, c.lat, c.kind, c.extent)
    }
    for (const c of cities) {
      if (n >= 80) break
      tryLabel(c.name, c.lon, c.lat, 'city', 0)
    }
  }

  // ---------------------------------------------------------------- pointer handlers
  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || !manualZoom) return
    drag.current = { x: e.clientX, y: e.clientY, v: view, moved: false }
  }
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    if (!d.moved) {
      d.moved = true
      inter.hideTooltip()
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* pointer already released */
      }
    }
    setView(panBy(d.v, dx, dy))
  }
  const onUp = () => {
    if (drag.current?.moved) persistView(viewRef.current)
    // keep `moved` visible to the click handler that follows pointerup
    setTimeout(() => (drag.current = null), 0)
  }
  const zoomButtons = shape ? fmt.bool('zoom', 'zoomButtonsVisible', false) : fmt.bool('mapControls', 'zoomButtonsVisible', false)
  const zoomBy = (f: number) => {
    const next = zoomAt(view, f, area.x + area.w / 2, area.y + area.h / 2, minK, maxK)
    setView(next)
    persistView(next)
  }

  const clipId = `mapclip-${kind}-${clipSuffix}`
  const captionFont = { size: 9, family: 'Segoe UI', weight: 400 }
  const notes: string[] = []
  if (unlocated) notes.push(`${unlocated} not located`)
  if (shapeless) notes.push(`${shapeless} without shape`)
  const caption = shape ? (notes.length ? notes.join(' · ') : '') : ['Approximate basemap', ...notes].join(' · ')
  const captionTip = [
    shape
      ? 'Lumen draws shape maps from built-in US state (Albers USA) and world country outlines.'
      : 'Lumen draws maps without Bing / Azure Maps tiles: the basemap is country and US state outlines colored like the selected map style, and locations are geocoded offline (countries, US states, regions, cities, US ZIP codes by 3-digit prefix).',
    unlocated ? `${unlocated} location(s) could not be found in the built-in gazetteer and are not shown.` : '',
    shapeless ? `${shapeless} location(s) have no built-in boundary (only countries, US states and continents can be filled).` : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{ display: 'block', overflow: 'hidden', userSelect: 'none', touchAction: 'none', cursor: drag.current?.moved ? 'grabbing' : undefined }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onClick={(e) => {
        if (!drag.current?.moved) inter.onBackgroundClick(e)
      }}
      onDoubleClick={() => setView(IDENTITY_VIEW)}
      onContextMenu={(e) => inter.onContextMenu(undefined, e)}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={area.x} y={area.y} width={area.w} height={area.h} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {shape ? null : <rect x={area.x} y={area.y} width={area.w} height={area.h} fill={palette.water} />}
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {land}
          {showStates ? <path d={base.stateBorders} fill="none" stroke={palette.subBorder} strokeWidth={0.6} vectorEffect="non-scaling-stroke" pointerEvents="none" /> : null}
          {fills}
        </g>
        {baseLabels}
        {bubbles}
        {catLabels}
      </g>
      {lg.size > 0 ? (
        <Legend
          style={legendStyle}
          items={legendItems.map((it) => {
            const s = legendSeries.find((x) => x.key === it.key)
            return { ...it, dimmed: !!(s && inter.hasSelection && !inter.isSelected({ fields: s.scope })) }
          })}
          x={legendRect.x}
          y={legendRect.y}
          width={legendRect.w}
          height={legendRect.h}
          onItemClick={(key, e) => {
            const s = legendSeries.find((x) => x.key === key)
            if (s) inter.onPointClick({ fields: s.scope }, e)
          }}
        />
      ) : null}
      {zoomButtons ? <ZoomButtons x={area.x + area.w - 30} y={area.y + area.h - 64} dark={palette.dark && !shape} onZoom={zoomBy} /> : null}
      {caption ? (
        <text x={area.x + area.w - 4} y={area.y + area.h - 4} textAnchor="end" {...fontAttrs(captionFont)} fill={shape ? '#A19F9D' : palette.ui} fillOpacity={0.75} stroke={shape ? 'none' : palette.dark ? '#000000' : '#FFFFFF'} strokeOpacity={0.5} strokeWidth={2} paintOrder="stroke">
          <title>{captionTip}</title>
          {caption}
        </text>
      ) : null}
    </svg>
  )
}

/** Power BI map zoom buttons (+ / −), bottom-right. */
function ZoomButtons({ x, y, dark, onZoom }: { x: number; y: number; dark: boolean; onZoom(f: number): void }) {
  const bg = dark ? '#2B2B2B' : '#FFFFFF'
  const fg = dark ? '#F3F2F1' : '#323130'
  const btn = (dy: number, label: string, f: number, title: string) => (
    <g
      transform={`translate(${x},${y + dy})`}
      style={{ cursor: 'pointer' }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onZoom(f)
      }}
    >
      <title>{title}</title>
      <rect width={26} height={26} rx={2} fill={bg} stroke="#C8C6C4" strokeWidth={1} />
      <text x={13} y={13} dy="0.35em" textAnchor="middle" fontSize={16} fontFamily={UI_FONT} fill={fg}>
        {label}
      </text>
    </g>
  )
  return (
    <g>
      {btn(0, '+', 1.6, 'Zoom in')}
      {btn(30, '−', 1 / 1.6, 'Zoom out')}
    </g>
  )
}
