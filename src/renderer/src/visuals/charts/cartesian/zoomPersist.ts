/**
 * Persisted zoom-slider windows (PBIR object `zoom`).
 *
 * Microsoft's report-theme schema lists `zoom.categoryMin / categoryMax / categorySize` and
 * `valueMin / valueMax / valueSize` (+ `valueSec*`) next to the slider toggles: Power BI saves the
 * slider positions there so a report reopens zoomed where it was left. Their exact semantics aren't
 * documented; we use the natural reading and note it here:
 *   - continuous category axis: categoryMin/Max are axis values (dates as epoch ms), categorySize the
 *     full axis span;
 *   - categorical axis: categoryMin/Max are 0-based category indices (inclusive), categorySize the
 *     number of categories when saved (indices are rescaled when the count changes);
 *   - value axis: valueMin/Max are axis values, valueSize the full axis span.
 * Lumen-written files round-trip exactly; files from PBI read correctly when PBI uses the same reading.
 */
import { decodeValue } from '@core/report/props'
import { setObjectProp } from '@core/report/props'
import type { ResolvedTheme } from '@core/report/theme'

export interface SavedZoom {
  categoryMin?: number
  categoryMax?: number
  categorySize?: number
  valueMin?: number
  valueMax?: number
  valueSize?: number
}

export function readSavedZoom(objects: any, theme: ResolvedTheme): SavedZoom {
  const p = (objects?.zoom ?? []).find((e: any) => !e?.selector)?.properties ?? {}
  const out: SavedZoom = {}
  for (const k of ['categoryMin', 'categoryMax', 'categorySize', 'valueMin', 'valueMax', 'valueSize'] as const) {
    const v = decodeValue(p[k], theme)
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return out
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

function window(a: number, b: number): [number, number] | undefined {
  const lo = clamp01(Math.min(a, b))
  const hi = clamp01(Math.max(a, b))
  if (!(hi - lo > 0) || (lo <= 0 && hi >= 1)) return undefined
  return [lo, hi]
}

/** Saved category window → fractions of the full axis (undefined = full range). */
export function savedCategoryWindow(z: SavedZoom, n: number, continuousDomain?: [number, number]): [number, number] | undefined {
  if (z.categoryMin === undefined || z.categoryMax === undefined) return undefined
  if (continuousDomain) {
    const [d0, d1] = continuousDomain
    if (!(d1 > d0)) return undefined
    return window((z.categoryMin - d0) / (d1 - d0), (z.categoryMax - d0) / (d1 - d0))
  }
  if (n <= 0) return undefined
  const size = z.categorySize && z.categorySize > 0 ? z.categorySize : n
  const k = n / size
  return window((z.categoryMin * k) / n, ((z.categoryMax + 1) * k) / n)
}

/** Saved value window → fractions of the full (unzoomed) value domain. */
export function savedValueWindow(z: SavedZoom, domain: [number, number]): [number, number] | undefined {
  if (z.valueMin === undefined || z.valueMax === undefined) return undefined
  const [d0, d1] = domain
  if (!(d1 > d0)) return undefined
  return window((z.valueMin - d0) / (d1 - d0), (z.valueMax - d0) / (d1 - d0))
}

/** Window fractions → the values written to the `zoom` object. */
export function categoryZoomProps(w: [number, number], n: number, continuousDomain?: [number, number]): Pick<SavedZoom, 'categoryMin' | 'categoryMax' | 'categorySize'> {
  if (continuousDomain) {
    const [d0, d1] = continuousDomain
    return { categoryMin: d0 + w[0] * (d1 - d0), categoryMax: d0 + w[1] * (d1 - d0), categorySize: d1 - d0 }
  }
  const lo = Math.max(0, Math.min(n - 1, Math.round(w[0] * n)))
  const hi = Math.max(lo, Math.min(n - 1, Math.round(w[1] * n) - 1))
  return { categoryMin: lo, categoryMax: hi, categorySize: n }
}

export function valueZoomProps(w: [number, number], domain: [number, number]): Pick<SavedZoom, 'valueMin' | 'valueMax' | 'valueSize'> {
  const [d0, d1] = domain
  return { valueMin: d0 + w[0] * (d1 - d0), valueMax: d0 + w[1] * (d1 - d0), valueSize: d1 - d0 }
}

/** Write (or clear, with undefined) the saved window of one axis into visual.json. */
export function writeZoom(visualJson: any, values: SavedZoom, axis: 'category' | 'value'): void {
  const keys = axis === 'category' ? (['categoryMin', 'categoryMax', 'categorySize'] as const) : (['valueMin', 'valueMax', 'valueSize'] as const)
  for (const k of keys) setObjectProp(visualJson, 'zoom', k, values[k] === undefined ? undefined : roundNice(values[k] as number))
}

/** keep saved numbers short (12 significant digits) */
function roundNice(x: number): number {
  return Number.isInteger(x) ? x : Number(x.toPrecision(12))
}
