/**
 * Low-level helpers over PBIR "objects bags" (`visual.objects`, `visual.visualContainerObjects`,
 * page.json `objects`): `{ [object]: [{ properties: { [prop]: rawValue }, selector? }] }`.
 * Raw values are PBIR-wrapped (`{ expr: { Literal } }`, `{ solid: { color: { expr } } }`, ThemeDataColor…).
 * Pure (no React) — unit-tested in objects.test.ts.
 */
import { literalProp, type ObjectEntry, type ObjectsBag, type Selector } from '@core/report/props'
import { primaryEntry, readEntryProp, writeEntryProp } from '@core/report/entries'
import type { Scalar } from '@core/model/data'

export type { Selector }

/**
 * Entry with this selector, as edits address it: the first entry of the selector's group, where `{ id: 'default' }`
 * and no selector are the same group (core/report/entries.ts; undefined = the default entry).
 */
export function findEntry(bag: ObjectsBag | undefined, object: string, selector?: Selector): ObjectEntry | undefined {
  return primaryEntry(bag, object, selector)
}

/** Explicitly stored raw value (no theme fallback) or undefined: what readers see for this selector's group. */
export function getRaw(bag: ObjectsBag | undefined, object: string, prop: string, selector?: Selector): any {
  return readEntryProp(bag, object, prop, selector)
}

/**
 * Set (raw value) or clear (undefined) a property; empty entries / objects are removed. Mutates the bag. Writes go
 * to the entry the visual reads (core/report/entries.ts `writeEntryProp`, shared with icons and CF).
 */
export function setRaw(bag: ObjectsBag, object: string, prop: string, raw: any, selector?: Selector): void {
  writeEntryProp(bag, object, prop, raw, selector)
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
