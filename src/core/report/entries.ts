/**
 * Which entry of a PBIR objects bag (`{ [object]: [{ properties, selector? }] }`) a property edit goes to: the one
 * rule shared by every writer — the Format pane (renderer panes/visualizations/objects.ts `setRaw`), conditional
 * formatting (cf/target.ts), built-in icons (core/icons/bake.ts) and visuals that persist state (props.ts
 * `setObjectProp`).
 *
 * `selector: { id: 'default' }` names the default instance. Current Power BI writes it for the new card's (and other
 * new-format visuals') "all" formatting, older reports and Lumen leave the selector out, and every reader treats the
 * two alike (props.ts `matchSelector`, cards/cardProps.ts), taking the FIRST such entry in array order that holds the
 * property. A writer that matched selectors exactly would put an edit of a `{ id: 'default' }` report into a new
 * selector-less entry behind it, which no reader reaches for a property the first entry already holds: the edit
 * silently did nothing. So writes address the same group of entries the readers do:
 *
 *   - entries are grouped by their selector with `id: 'default'` dropped (`{ metadata: m, id: 'default' }` is the
 *     group of `{ metadata: m }`, `{ id: 'default' }` the group of no selector);
 *   - a value goes into the first entry of the group (the one readers reach first), or a new entry with the requested
 *     selector when the group is empty; copies of the property in later entries of the group are removed (they could
 *     only confuse; this also folds stray duplicate entries back together), and entries left empty are dropped;
 *   - clearing removes the property from every entry of the group (otherwise a later copy would show through).
 */
import type { ObjectEntry, ObjectsBag, Selector } from './props'

/** JSON with sorted keys at every level. */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? ''
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(',')}}`
}

/** The group key of a selector: '' for the default entry (no selector, empty, or only `id: 'default'`). */
export function entryGroupKey(sel: Selector | undefined): string {
  if (!sel) return ''
  const o: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(sel)) if (v !== undefined && !(k === 'id' && v === 'default')) o[k] = v
  return Object.keys(o).length ? stableJson(o) : ''
}

export function sameEntryGroup(a: Selector | undefined, b: Selector | undefined): boolean {
  return entryGroupKey(a) === entryGroupKey(b)
}

/** The entries of `object` in the group of `selector`, in array order. */
export function groupEntries(bag: ObjectsBag | undefined, object: string, selector?: Selector): ObjectEntry[] {
  const key = entryGroupKey(selector)
  return (bag?.[object] ?? []).filter((e) => entryGroupKey(e.selector) === key)
}

/** The entry edits of this group go to (first of the group); with `create`, a new one when the group is empty. */
export function primaryEntry(bag: ObjectsBag | undefined, object: string, selector?: Selector, create = false): ObjectEntry | undefined {
  const hit = groupEntries(bag, object, selector)[0]
  if (hit || !create || !bag) {
    if (hit && create) hit.properties ??= {}
    return hit
  }
  const e: ObjectEntry = { properties: {}, ...(selector && Object.keys(selector).length ? { selector } : {}) }
  ;(bag[object] ??= []).push(e)
  return e
}

/** The stored raw value readers see for this group (first entry holding the property), or undefined. */
export function readEntryProp(bag: ObjectsBag | undefined, object: string, prop: string, selector?: Selector): any {
  const e = groupEntries(bag, object, selector).find((x) => x.properties && prop in x.properties)
  return e ? e.properties[prop] : undefined
}

function dropIfEmpty(bag: ObjectsBag, object: string, e: ObjectEntry): void {
  const entries = bag[object]
  if (!entries) return
  if (!e.properties || !Object.keys(e.properties).length) {
    const i = entries.indexOf(e)
    if (i >= 0) entries.splice(i, 1)
  }
  if (!entries.length) delete bag[object]
}

/** Set (raw value) or clear (undefined) a property of the group of `selector` (see the module comment). Mutates. */
export function writeEntryProp(bag: ObjectsBag, object: string, prop: string, raw: any, selector?: Selector): void {
  const group = groupEntries(bag, object, selector)
  if (raw === undefined) {
    for (const e of group) {
      if (e.properties && prop in e.properties) delete e.properties[prop]
      dropIfEmpty(bag, object, e)
    }
    if (bag[object] && !bag[object].length) delete bag[object]
    return
  }
  const target = primaryEntry(bag, object, selector, true)!
  target.properties[prop] = raw
  for (const e of group) {
    if (e === target || !e.properties || !(prop in e.properties)) continue
    delete e.properties[prop]
    dropIfEmpty(bag, object, e)
  }
}
