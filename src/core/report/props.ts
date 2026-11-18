/**
 * Formatting property resolution for visuals.
 *
 * PBIR stores formatting as `visual.objects[objectName] = [{ properties: {...}, selector? }]`
 * and container formatting (title, background, border, shadow, header, padding...) as
 * `visual.visualContainerObjects[objectName]` with the same shape.
 * Property values are wrapped: { expr: { Literal: { Value: "9D" } } }, colors are
 * { solid: { color: { expr: ... } } }, and some are data-bound (Measure / FillRule / Conditional).
 *
 * Resolution order for a property:
 *   1. visual objects entry whose selector matches (or no selector for the default)
 *   2. theme.visualStyles[visualType]['*'][object][0][prop]
 *   3. theme.visualStyles['*']['*'][object][0][prop]
 *   4. caller default
 */
import type { Scalar } from '../model/data'
import { decodeLiteral, encodeLiteral } from './literal'
import { themeDataColor, type ResolvedTheme } from './theme'
import { writeEntryProp } from './entries'

export interface Selector {
  /** queryRef of a series/measure (`metadata` selector) */
  metadata?: string
  /** data-point scope selectors (raw PBIR) */
  data?: any[]
  /** named instance (e.g. `id: 'default'`, `id: 'selection:selected'`, button states `$id`) */
  id?: string
  [k: string]: any
}

export interface ObjectEntry {
  properties: Record<string, any>
  selector?: Selector
}

export type ObjectsBag = Record<string, ObjectEntry[]>

export interface PropContext {
  visualType: string
  objects?: ObjectsBag
  containerObjects?: ObjectsBag
  theme: ResolvedTheme
}

/** Is this a data-bound expression that needs evaluation by the visual (conditional formatting)? */
export function isDataBound(raw: any): boolean {
  const e = raw?.solid?.color?.expr ?? raw?.expr
  return !!(e && (e.Measure || e.Aggregation || e.FillRule || e.Conditional || e.Column || e.SelectRef))
}

/** Decode a raw property value into a JS value. Colors become '#RRGGBB' strings. Data-bound values are returned raw. */
export function decodeValue(raw: any, theme?: ResolvedTheme): any {
  if (raw === null || raw === undefined) return undefined
  if (typeof raw !== 'object') return raw
  if (raw.solid?.color !== undefined) {
    const c = raw.solid.color
    if (typeof c === 'string') return c
    return decodeValue(c, theme)
  }
  if (raw.expr) {
    const e = raw.expr
    if (e.Literal) return decodeLiteral(e.Literal.Value)
    if (e.ThemeDataColor && theme) return themeDataColor(theme, e.ThemeDataColor.ColorId, e.ThemeDataColor.Percent ?? 0)
    if (e.ResourcePackageItem) return { resource: e.ResourcePackageItem.ItemName, package: e.ResourcePackageItem.PackageName, packageType: e.ResourcePackageItem.PackageType }
    return raw // data-bound — caller evaluates
  }
  if (raw.Literal) return decodeLiteral(raw.Literal.Value)
  return raw
}

function matchSelector(entry: ObjectEntry, sel?: Selector): boolean {
  const s = entry.selector
  if (!sel) return !s || (!s.metadata && !s.data && (!s.id || s.id === 'default'))
  if (!s) return false
  if (sel.id !== undefined && s.id !== sel.id) return false
  if (sel.metadata !== undefined && s.metadata !== sel.metadata) return false
  if (sel.data !== undefined && JSON.stringify(s.data) !== JSON.stringify(sel.data)) return false
  return true
}

function themeProp(theme: ResolvedTheme, visualType: string, object: string, prop: string, sel?: Selector): any {
  for (const vt of [visualType, '*']) {
    const styles = theme.visualStyles?.[vt]?.['*']?.[object]
    if (!styles) continue
    const bag = sel?.id ? styles.find((b) => b.$id === sel.id) ?? styles[0] : styles.find((b) => !b.$id) ?? styles[0]
    if (bag && prop in bag) return bag[prop]
  }
  // '*' object wildcard
  const wild = theme.visualStyles?.['*']?.['*']?.['*']?.[0]
  if (wild && prop in wild) return wild[prop]
  return undefined
}

/** Raw (undecoded) property lookup following the resolution order. */
export function rawProp(ctx: PropContext, object: string, prop: string, sel?: Selector): any {
  for (const bag of [ctx.objects, ctx.containerObjects]) {
    const entries = bag?.[object]
    if (!entries) continue
    const hit = entries.find((e) => matchSelector(e, sel) && e.properties && prop in e.properties)
    if (hit) return hit.properties[prop]
    if (sel) {
      // selector-specific miss falls back to the default entry
      const def = entries.find((e) => matchSelector(e, undefined) && e.properties && prop in e.properties)
      if (def && !sel.metadata && !sel.data) return def.properties[prop]
    }
  }
  return themeProp(ctx.theme, ctx.visualType, object, prop, sel)
}

/**
 * Fallback recording. A visual's format resolution passes its default for every property it reads as the
 * `fallback` argument; while `recordFallbacks` runs, those defaults are reported to a sink. The Format pane uses
 * this to show the value a visual actually uses for a property that is set nowhere (renderer/…/effective.ts),
 * straight from the code that draws it instead of from a copied table. Readers with their own resolution
 * (e.g. the card visual's scoped CardProps) report through `noteFallback`.
 */
export type FallbackSink = (object: string, prop: string, fallback: unknown, sel?: Selector) => void
let fallbackSink: FallbackSink | undefined

/** Run `fn` while reporting every property fallback read through getProp / noteFallback to `sink`. */
export function recordFallbacks<T>(sink: FallbackSink, fn: () => T): T {
  const prev = fallbackSink
  fallbackSink = sink
  try {
    return fn()
  } finally {
    fallbackSink = prev
  }
}

/** Report the default a reader uses for `object.prop` (no-op unless recordFallbacks is running). */
export function noteFallback(object: string, prop: string, fallback: unknown, sel?: Selector): void {
  if (fallbackSink && fallback !== undefined && fallback !== null) fallbackSink(object, prop, fallback, sel)
}

/** Resolve and decode a property. */
export function getProp<T = any>(ctx: PropContext, object: string, prop: string, fallback: T, sel?: Selector): T {
  if (fallbackSink) noteFallback(object, prop, fallback, sel)
  const raw = rawProp(ctx, object, prop, sel)
  if (raw === undefined) return fallback
  const v = decodeValue(raw, ctx.theme)
  return (v === undefined || v === null ? fallback : v) as T
}

export function getColor(ctx: PropContext, object: string, prop: string, fallback: string, sel?: Selector): string {
  const v = getProp<any>(ctx, object, prop, fallback, sel)
  return typeof v === 'string' ? v : fallback
}

/** All entries of an object (e.g. per-series `dataPoint` fills keyed by selector.metadata). */
export function objectEntries(ctx: PropContext, object: string): ObjectEntry[] {
  return [...(ctx.objects?.[object] ?? []), ...(ctx.containerObjects?.[object] ?? [])]
}

export function makePropContext(visualJson: any, theme: ResolvedTheme): PropContext {
  const v = visualJson?.visual ?? visualJson?.visualGroup ?? {}
  return {
    visualType: v.visualType ?? (visualJson?.visualGroup ? 'group' : 'unknown'),
    objects: v.objects,
    containerObjects: v.visualContainerObjects,
    theme
  }
}

/** Build a literal-wrapped property value for writing back into PBIR objects. */
export function literalProp(value: Scalar): any {
  if (typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value)) return { solid: { color: { expr: { Literal: { Value: `'${value}'` } } } } }
  // dates as PBIR datetime literals (datetime'2024-01-31T00:00:00'), like Power BI writes date properties
  return { expr: { Literal: { Value: encodeLiteral(value) } } }
}

/** Set (or clear with undefined) a formatting property on a visual JSON (mutates). */
export function setObjectProp(visualJson: any, object: string, prop: string, value: Scalar | undefined, opts: { container?: boolean; selector?: Selector } = {}): void {
  const v = visualJson.visual ?? visualJson.visualGroup
  const key = opts.container ? 'visualContainerObjects' : 'objects'
  v[key] ??= {}
  // the entry readers use for this selector (`{ id: 'default' }` ≡ no selector; entries.ts)
  writeEntryProp(v[key], object, prop, value === undefined ? undefined : literalProp(value), opts.selector)
}
