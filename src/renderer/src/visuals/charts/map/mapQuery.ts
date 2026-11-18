/**
 * Field-well interpretation for the map visuals.
 *
 * `map` / `azureMap` / `filledMap` use X = Longitude and Y = Latitude when those wells hold coordinate
 * columns (or lat/long-named measures); a column is queried as Average per location. Otherwise
 * Y is an ordinary value. The derived visual JSON moves coordinates into internal roles
 * 'Lon' / 'Lat' (never split by the legend) so the shared categorical builder can be used.
 */
import { fieldInfo } from '@core/report/sq'

export type MapKind = 'filledMap' | 'map' | 'azureMap' | 'shapeMap'

const VALUE_ROLES: Record<MapKind, string[]> = {
  filledMap: ['Y', 'Values', 'Gradient', 'Size'],
  shapeMap: ['Values', 'Value', 'Y', 'Gradient'],
  map: ['Size', 'Gradient', 'Values', 'Y'],
  azureMap: ['Size', 'Gradient', 'Values', 'Y']
}

/**
 * "Color saturation" roles: their measure drives a gradient (dataPoint.fillRule). Filled maps
 * saved by older Power BI versions keep the saturation measure in 'Size'; shape maps use 'Values'
 * (PBIX layouts may say 'Value').
 */
export const SATURATION_ROLES: Record<MapKind, string[]> = {
  filledMap: ['Gradient', 'Size'],
  shapeMap: ['Values', 'Value', 'Gradient'],
  map: ['Gradient'],
  azureMap: ['Gradient']
}

const LAT = /^(lat|latitude|.*[ _]lat|.*latitude.*)$/i
const LON = /^(lon|lng|long|longitude|.*[ _](lon|lng|long)|.*longitude.*)$/i

function coordProjection(p: any, re: RegExp): any | undefined {
  if (!p?.field) return undefined
  const info = fieldInfo(p.field)
  const named = re.test(info.property ?? '') || re.test(p.displayName ?? '')
  if (info.kind === 'column') return { ...p, field: { Aggregation: { Expression: p.field, Function: 1 } } }
  if ((info.kind === 'measure' || info.kind === 'aggregation') && named) return p
  return undefined
}

/**
 * Input field of a data-bound `dataPoint.fill` (fx: gradient / rules / field value), when no value
 * measure is in the field wells. Power BI evaluates it per location; the shared categorical builder
 * only evaluates conditional formatting over queried measures, so it is queried in the hidden
 * role 'CF' (never drawn, sized or shown in tooltips).
 */
function conditionalInput(json: any, queryState: Record<string, any>, valueRoles: string[]): any | undefined {
  if (valueRoles.some((r) => (queryState[r]?.projections ?? []).length)) return undefined
  for (const e of json?.visual?.objects?.dataPoint ?? []) {
    const expr = e?.properties?.fill?.solid?.color?.expr
    if (!expr) continue
    if (expr.FillRule?.Input) return expr.FillRule.Input
    if (expr.Measure || expr.Aggregation) return expr
    if (expr.Conditional) {
      for (const c of expr.Conditional.Cases ?? []) {
        const left = c?.Condition?.Comparison?.Left ?? c?.Condition?.And?.Left?.Comparison?.Left
        if (left) return left
      }
    }
  }
  return undefined
}

export function deriveMapQuery(json: any, kind: MapKind): { json: any; valueRoles: string[]; coordRoles: string[]; cfRoles: string[]; legendRoles: string[] } {
  const qs = json?.visual?.query?.queryState ?? {}
  const hasCoordWells = kind !== 'shapeMap'
  const x = hasCoordWells ? coordProjection(qs.X?.projections?.[0], LON) : undefined
  const y = hasCoordWells ? coordProjection(qs.Y?.projections?.[0], LAT) : undefined
  const coords = !!(x && y)
  const queryState: Record<string, any> = {}
  for (const [role, bucket] of Object.entries<any>(qs)) {
    if (coords && (role === 'X' || role === 'Y')) continue
    queryState[role] = bucket
  }
  if (coords) {
    queryState.Lon = { projections: [x] }
    queryState.Lat = { projections: [y] }
  }
  const valueRoles = VALUE_ROLES[kind].filter((r) => r !== 'X' && !(coords && r === 'Y'))
  const cf = conditionalInput(json, queryState, valueRoles)
  if (cf) queryState.CF = { projections: [{ field: cf, queryRef: 'cf.input' }] }
  // Legend without any value: Power BI still colors each location by its legend value. Query a
  // hidden count per location × legend value (role 'LG', split by the legend, never sized).
  const loc = queryState.Category?.projections?.[0]?.field
  const legendOnly = (queryState.Series?.projections ?? []).length > 0 && !valueRoles.some((r) => (queryState[r]?.projections ?? []).length) && loc
  if (legendOnly) queryState.LG = { projections: [{ field: { Aggregation: { Expression: loc, Function: 5 } }, queryRef: 'lg.count' }] }
  return {
    json: { ...json, visual: { ...json.visual, query: { ...json.visual?.query, queryState } } },
    valueRoles,
    coordRoles: coords ? ['Lon', 'Lat'] : [],
    cfRoles: cf ? ['CF'] : [],
    legendRoles: legendOnly ? ['LG'] : []
  }
}
