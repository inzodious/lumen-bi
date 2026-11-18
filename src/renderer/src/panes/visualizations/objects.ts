/**
 * Low-level helpers over PBIR "objects bags" (`visual.objects`, `visual.visualContainerObjects`,
 * page.json `objects`): `{ [object]: [{ properties: { [prop]: rawValue }, selector? }] }`.
 * Raw values are PBIR-wrapped (`{ expr: { Literal } }`, `{ solid: { color: { expr } } }`, ThemeDataColor…).
 * Pure (no React) — unit-tested in objects.test.ts.
 */
import { literalProp, type ObjectEntry, type ObjectsBag, type Selector } from '@core/report/props'
import type { Scalar } from '@core/model/data'

export type { Selector }

/** JSON with sorted keys at every level (a replacer key list would also drop nested keys like `dataViewWildcard`). */
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? ''
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`
}

function sameSelector(a: Selector | undefined, b: Selector | undefined): boolean {
  const norm = (s: Selector | undefined) => (s && Object.keys(s).length ? stable(s) : '')
  return norm(a) === norm(b)
}

/** Entry with exactly this selector (undefined = default entry without selector). */
export function findEntry(bag: ObjectsBag | undefined, object: string, selector?: Selector): ObjectEntry | undefined {
  return bag?.[object]?.find((e) => sameSelector(e.selector, selector))
}

/** Explicitly stored raw value (no theme fallback) or undefined. */
export function getRaw(bag: ObjectsBag | undefined, object: string, prop: string, selector?: Selector): any {
  const e = findEntry(bag, object, selector)
  return e?.properties && prop in e.properties ? e.properties[prop] : undefined
}

/** Set (raw value) or clear (undefined) a property; empty entries / objects are removed. Mutates the bag. */
export function setRaw(bag: ObjectsBag, object: string, prop: string, raw: any, selector?: Selector): void {
  const entries: ObjectEntry[] = (bag[object] ??= [])
  let entry = entries.find((e) => sameSelector(e.selector, selector))
  if (raw === undefined) {
    if (!entry) {
      if (!entries.length) delete bag[object]
      return
    }
    delete entry.properties[prop]
    if (!Object.keys(entry.properties).length) entries.splice(entries.indexOf(entry), 1)
    if (!entries.length) delete bag[object]
    return
  }
  if (!entry) {
    entry = { properties: {}, ...(selector && Object.keys(selector).length ? { selector } : {}) }
    entries.push(entry)
  }
  entry.properties ??= {}
  entry.properties[prop] = raw
}

/** Wrap a JS value as a PBIR raw property value (colors → solid color literal). */
export function wrapValue(value: Scalar): any {
  return literalProp(value)
}

/** ThemeDataColor raw color value (`{ solid: { color: { expr: { ThemeDataColor } } } }`). */
export function themeColorRaw(colorId: number, percent: number): any {
  return { solid: { color: { expr: { ThemeDataColor: { ColorId: colorId, Percent: percent } } } } }
}

/** The objects bag of a visual container (creating it when `create`). */
export function visualBag(visualJson: any, container: boolean, create = false): ObjectsBag | undefined {
  const v = visualJson?.visual ?? visualJson?.visualGroup
  if (!v) return undefined
  const key = container ? 'visualContainerObjects' : 'objects'
  if (create) v[key] ??= {}
  return v[key]
}

/** Page objects bag (page.json `objects`). */
export function pageBag(pageJson: any, create = false): ObjectsBag | undefined {
  if (!pageJson) return undefined
  if (create) pageJson.objects ??= {}
  return pageJson.objects
}

/** Remove every entry of an object whose selector `id` matches (analytics lines are keyed by id). */
export function removeEntriesById(bag: ObjectsBag | undefined, object: string, id: string): void {
  if (!bag?.[object]) return
  bag[object] = bag[object].filter((e) => e.selector?.id !== id)
  if (!bag[object].length) delete bag[object]
}

/** Next free numeric selector id for multi-instance objects (constant lines…). */
export function nextEntryId(bag: ObjectsBag | undefined, object: string): string {
  const ids = (bag?.[object] ?? []).map((e) => Number(e.selector?.id)).filter((n) => Number.isFinite(n))
  return String(ids.length ? Math.max(...ids) + 1 : 1)
}
