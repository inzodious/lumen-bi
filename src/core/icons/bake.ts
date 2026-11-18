/**
 * Icons in reports: storing an icon's picture in a visual the way Power BI stores images, plus the editable Lumen
 * reference kept beside it. Pure: the picture itself (an SVG document) is produced by the renderer from the icon
 * library's React component (renderer/src/icons/picture.ts) and handed in here as a string.
 *
 * Power BI knows nothing about Lumen's icons, so every icon is **baked**: its picture is stored in the form Power BI
 * itself uses for that visual's image (a report saved by Lumen opens in Power BI Desktop and shows the same picture):
 *
 *   image visual         form 'resource': the SVG becomes a registered resource
 *                        (StaticResources/RegisteredResources/<item>.svg, listed in report.json
 *                        resourcePackages[RegisteredResources] as type Image) referenced by
 *                        `objects.general[0].properties.imageUrl = { expr: { ResourcePackageItem } }` — the form
 *                        Power BI writes for an uploaded image (every image visual in Microsoft's sample
 *                        reports, and Lumen's Insert ▸ Image) and the only image source this visual has. A visual
 *                        that already uses the newer `objects.image[0].properties.sourceFile` shape keeps it.
 *   new card (image /    form 'dataUri': the visual's "Image URL" literal (`imageType: 'imageUrl'`,
 *   cardImage objects)   `imageUrl: 'data:image/svg+xml;base64,…'`). The card's image slots take a URL or a
 *                        data-bound value only (no uploaded resource), so the SVG travels inline as a data URI.
 *                        Assumption (not verifiable without Power BI Desktop): its URL images accept data: URIs,
 *                        as they do when the URL comes from a measure ("Select from data" + Image URL category).
 *
 * The editable reference lives in the visual's `annotations` (visualContainer schema: an array of
 * `{ name, value }` strings that Power BI preserves and ignores), name `Lumen_Icon`, value a JSON string:
 *
 *   { "version": 2, "icons": [ { "slot": { "object": "general", "property": "imageUrl", "form": "resource" },
 *       "icon": { "set": "lucide", "name": "chart-column", "color": "theme:1" },
 *       "bake": "<fingerprint of the baked bytes / data URI>", "resource": "<item name>" } ] }
 *
 * On open (and before every save) a binding whose image no longer matches its fingerprint — the image was
 * changed in Power BI, or by an image edit in Lumen — is stale: the image wins and the binding is dropped
 * (pruneStaleIcons). So is a binding to a set Lumen no longer offers (REMOVED_ICON_SET_IDS): its picture stays as
 * a plain image. Bindings that use theme colours are re-baked when the theme changes (rebakeIcons).
 */
import type { ReportDocument } from '../report/types'
import type { ObjectEntry, Selector } from '../report/props'
import { decodeLiteral } from '../report/literal'
import { bytesToBase64, findResource } from '../pbir/resources'
import { fingerprint } from './hash'
import { parseIconRef, serializeIconRef, usesThemeColors } from './ref'
import { REMOVED_ICON_SET_IDS, type IconRef, type IconSetId } from './types'

export const ICON_ANNOTATION = 'Lumen_Icon'
/** Item names of baked icon resources start with this (only those are ever deleted by Lumen). */
export const ICON_RESOURCE_PREFIX = 'LumenIcon_'
const RESOURCE_DIR = 'StaticResources/RegisteredResources/'
/** Intrinsic size of baked pictures (they scale: every slot fits the image into its box). */
export const BAKE_SIZE = 256

export interface IconSlot {
  object: string
  property: string
  selector?: Selector
  /** how the baked SVG is stored (see the module comment) */
  form: 'resource' | 'dataUri'
}

export interface IconBinding {
  slot: IconSlot
  icon: IconRef
  /** fingerprint of what was baked (resource bytes, or the data URI string) */
  bake: string
  /** resource item name (form 'resource') */
  resource?: string
}

/** The image visual's single image slot. */
export const IMAGE_VISUAL_SLOT: IconSlot = { object: 'general', property: 'imageUrl', form: 'resource' }

/** A card image slot (`image` = callout image, `cardImage` = card image area). */
export function cardImageSlot(object: 'image' | 'cardImage', selector?: Selector): IconSlot {
  return { object, property: 'imageUrl', form: 'dataUri', ...(selector && Object.keys(selector).length ? { selector } : {}) }
}

// ---------------------------------------------------------------------------------------------
// Objects bag helpers (same semantics as the Format pane's: selector compared as sorted-key JSON)
// ---------------------------------------------------------------------------------------------

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

const selKey = (s: Selector | undefined) => (s && Object.keys(s).length ? stable(s) : '')

export function slotKey(slot: Pick<IconSlot, 'object' | 'property' | 'selector'>): string {
  return `${slot.object}.${slot.property}${selKey(slot.selector) ? '#' + selKey(slot.selector) : ''}`
}

function objectsOf(visualJson: any, create = false): Record<string, ObjectEntry[]> | undefined {
  const v = visualJson?.visual
  if (!v) return undefined
  if (create) v.objects ??= {}
  return v.objects
}

function entryOf(visualJson: any, object: string, selector: Selector | undefined, create = false): ObjectEntry | undefined {
  const bag = objectsOf(visualJson, create)
  if (!bag) return undefined
  const entries = bag[object] ?? (create ? (bag[object] = []) : undefined)
  if (!entries) return undefined
  let e = entries.find((x) => selKey(x.selector) === selKey(selector))
  if (!e && create) {
    e = { properties: {}, ...(selKey(selector) ? { selector } : {}) }
    entries.push(e)
  }
  if (e && create) e.properties ??= {}
  return e
}

const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
const strLit = (s: string) => lit(`'${s.replace(/'/g, "''")}'`)

function literalString(raw: any): string | undefined {
  const l = raw?.expr?.Literal?.Value
  if (typeof l !== 'string') return undefined
  const v = decodeLiteral(l)
  return typeof v === 'string' ? v : undefined
}

// ---------------------------------------------------------------------------------------------
// Annotation
// ---------------------------------------------------------------------------------------------

/** An annotation entry: a usable binding, a binding to a removed set, or something unreadable. */
interface RawBinding {
  binding?: IconBinding
  /** the entry references a set Lumen no longer offers */
  removedSet?: string
}

function readRawBindings(visualJson: any): RawBinding[] {
  const ann = (Array.isArray(visualJson?.annotations) ? visualJson.annotations : []).find((a: any) => a?.name === ICON_ANNOTATION)
  if (!ann || typeof ann.value !== 'string') return []
  let parsed: any
  try {
    parsed = JSON.parse(ann.value)
  } catch {
    return []
  }
  const out: RawBinding[] = []
  for (const b of Array.isArray(parsed?.icons) ? parsed.icons : []) {
    const set = b?.icon?.set
    if (typeof set === 'string' && REMOVED_ICON_SET_IDS.includes(set)) {
      out.push({ removedSet: set })
      continue
    }
    const icon = parseIconRef(b?.icon)
    const s = b?.slot
    if (!icon || !s || typeof s.object !== 'string' || typeof s.property !== 'string' || (s.form !== 'resource' && s.form !== 'dataUri') || typeof b.bake !== 'string') {
      out.push({})
      continue
    }
    const slot: IconSlot = { object: s.object, property: s.property, form: s.form, ...(s.selector && typeof s.selector === 'object' ? { selector: s.selector } : {}) }
    out.push({ binding: { slot, icon, bake: b.bake, ...(typeof b.resource === 'string' ? { resource: b.resource } : {}) } })
  }
  return out
}

/** Icon bindings stored on a visual (invalid entries and references to removed sets are skipped). */
export function readIconBindings(visualJson: any): IconBinding[] {
  return readRawBindings(visualJson).flatMap((r) => (r.binding ? [r.binding] : []))
}

/** Write (or remove, when empty) the visual's `Lumen_Icon` annotation; other annotations are kept in place. Mutates. */
export function writeIconBindings(visualJson: any, bindings: IconBinding[]): void {
  const list: any[] = Array.isArray(visualJson.annotations) ? visualJson.annotations : []
  const i = list.findIndex((a) => a?.name === ICON_ANNOTATION)
  if (!bindings.length) {
    if (i >= 0) list.splice(i, 1)
    if (!list.length) delete visualJson.annotations
    else visualJson.annotations = list
    return
  }
  const value = JSON.stringify({
    version: 2,
    icons: bindings.map((b) => ({ slot: { object: b.slot.object, property: b.slot.property, form: b.slot.form, ...(b.slot.selector ? { selector: b.slot.selector } : {}) }, icon: serializeIconRef(b.icon), bake: b.bake, ...(b.resource ? { resource: b.resource } : {}) }))
  })
  if (i >= 0) list[i] = { name: ICON_ANNOTATION, value }
  else list.push({ name: ICON_ANNOTATION, value })
  visualJson.annotations = list
}

// ---------------------------------------------------------------------------------------------
// What the slot holds now
// ---------------------------------------------------------------------------------------------

/** Resource item name of the image visual's picture (either PBIR shape), or undefined. */
export function imageVisualItem(visualJson: any): string | undefined {
  const objects = visualJson?.visual?.objects ?? {}
  const sf = objects.image?.[0]?.properties?.sourceFile?.image
  if (sf) return sf.url?.expr?.ResourcePackageItem?.ItemName ?? undefined
  if (literalString(objects.image?.[0]?.properties?.sourceUrl) || literalString(objects.image?.[0]?.properties?.imageUrl)) return undefined
  const raw = objects.general?.[0]?.properties?.imageUrl
  return raw?.expr?.ResourcePackageItem?.ItemName ?? literalString(raw)
}

/** Fingerprint of what the slot currently holds (undefined: nothing / not an image we could have baked). */
export function currentSlotFingerprint(report: ReportDocument, visualJson: any, binding: IconBinding): string | undefined {
  if (binding.slot.form === 'resource') {
    const item = imageVisualItem(visualJson)
    if (!item || item !== binding.resource) return undefined
    const file = findResource(report, { PackageName: 'RegisteredResources', PackageType: 1, ItemName: item })
    return file ? fingerprint(file.bytes) : undefined
  }
  const e = entryOf(visualJson, binding.slot.object, binding.slot.selector)
  const v = literalString(e?.properties?.[binding.slot.property])
  return v ? fingerprint(v) : undefined
}

export function isBindingCurrent(report: ReportDocument, visualJson: any, binding: IconBinding): boolean {
  return currentSlotFingerprint(report, visualJson, binding) === binding.bake
}

/** The icon shown in a slot, when the slot still holds the image baked from it. */
export function activeIcon(report: ReportDocument, visualJson: any, slot: Pick<IconSlot, 'object' | 'property' | 'selector'>): IconBinding | undefined {
  const key = slotKey(slot)
  const b = readIconBindings(visualJson).find((x) => slotKey(x.slot) === key)
  return b && isBindingCurrent(report, visualJson, b) ? b : undefined
}

// ---------------------------------------------------------------------------------------------
// Baking
// ---------------------------------------------------------------------------------------------

function svgBytes(svg: string): Uint8Array {
  return new TextEncoder().encode(svg)
}

export function svgDataUriOf(svg: string): string {
  return `data:image/svg+xml;base64,${bytesToBase64(svgBytes(svg))}`
}

function iconItemName(ref: IconRef, fp: string): string {
  return `${ICON_RESOURCE_PREFIX}${ref.set}_${ref.name.replace(/[^a-z0-9-]/g, '')}_${fp.slice(0, 12)}.svg`
}

/** Register an image item in report.json resourcePackages (RegisteredResources), like Power BI does for uploads. */
export function registerImageResource(report: ReportDocument, itemName: string): void {
  const rj = report.report
  rj.resourcePackages ??= []
  let pkg = rj.resourcePackages.find((p: any) => p.name === 'RegisteredResources')
  if (!pkg) {
    pkg = { name: 'RegisteredResources', type: 'RegisteredResources', items: [] }
    rj.resourcePackages.push(pkg)
  }
  pkg.items ??= []
  if (!pkg.items.some((i: any) => i.name === itemName)) pkg.items.push({ name: itemName, path: itemName, type: 'Image' })
}

/** Does anything in the report (visuals, mobile layouts, pages, bookmarks, report.json) still reference this item? */
function itemReferenced(report: ReportDocument, itemName: string): boolean {
  const needle = JSON.stringify(itemName)
  const has = (x: unknown) => x !== undefined && JSON.stringify(x).includes(needle)
  for (const p of report.pages) {
    if (has(p.json)) return true
    for (const v of p.visuals) if (has(v.json) || has(v.mobile)) return true
  }
  for (const b of report.bookmarks) if (has(b.json)) return true
  const { resourcePackages: _packages, ...rest } = report.report ?? {}
  return has(rest)
}

/** Remove a baked icon resource (only Lumen's own, and only when nothing references it any more). */
export function releaseIconResource(report: ReportDocument, itemName: string | undefined): void {
  if (!itemName || !itemName.startsWith(ICON_RESOURCE_PREFIX) || itemReferenced(report, itemName)) return
  delete report.resources[RESOURCE_DIR + itemName]
  const pkgs: any[] = report.report?.resourcePackages ?? []
  const pkg = pkgs.find((p) => p.name === 'RegisteredResources')
  if (pkg?.items) {
    pkg.items = pkg.items.filter((i: any) => i.name !== itemName)
    if (!pkg.items.length) report.report.resourcePackages = pkgs.filter((p) => p !== pkg)
    if (!report.report.resourcePackages.length) delete report.report.resourcePackages
  }
}

/** Store an SVG in the image visual's image slot (resource form). Returns the item name. */
function writeResourceImage(report: ReportDocument, visualJson: any, svg: string, ref: IconRef, fp: string): string {
  const item = iconItemName(ref, fp)
  const path = RESOURCE_DIR + item
  report.resources[path] = { path, bytes: svgBytes(svg), mime: 'image/svg+xml' }
  registerImageResource(report, item)
  const rpi = { expr: { ResourcePackageItem: { PackageName: 'RegisteredResources', PackageType: 1, ItemName: item } } }
  const objects = objectsOf(visualJson, true)!
  const imgProps = objects.image?.[0]?.properties
  if (imgProps?.sourceFile?.image) {
    // keep the newer PBIR shape when the visual already uses it
    imgProps.sourceFile.image.url = rpi
    imgProps.sourceFile.image.name = strLit(`${ref.name}.svg`)
  } else {
    if (imgProps) {
      delete imgProps.sourceUrl
      delete imgProps.imageUrl
      if (!Object.keys(imgProps).length) {
        objects.image!.splice(0, 1)
        if (!objects.image!.length) delete objects.image
      }
    }
    const e = entryOf(visualJson, 'general', undefined, true)!
    e.properties.imageUrl = rpi
  }
  return item
}

/**
 * Bake `ref` into `slot` of a visual (mutates the report draft): stores `svg` (the icon's picture, a standalone SVG
 * document rendered from the icon component) where Power BI reads the image, and the Lumen binding next to it.
 */
export function bakeIcon(report: ReportDocument, visualJson: any, slot: IconSlot, ref: IconRef, svg: string): void {
  const bindings = readIconBindings(visualJson)
  const key = slotKey(slot)
  const prev = bindings.find((b) => slotKey(b.slot) === key)
  let binding: IconBinding
  if (slot.form === 'resource') {
    const fp = fingerprint(svgBytes(svg))
    const item = writeResourceImage(report, visualJson, svg, ref, fp)
    binding = { slot, icon: ref, bake: fp, resource: item }
  } else {
    const uri = svgDataUriOf(svg)
    const e = entryOf(visualJson, slot.object, slot.selector, true)!
    e.properties[slot.property] = strLit(uri)
    // the slot shows its URL (not a data-bound image) and is switched on
    e.properties['imageType'] = strLit('imageUrl')
    if (!e.properties['show']) e.properties['show'] = lit('true')
    binding = { slot, icon: ref, bake: fingerprint(uri) }
  }
  writeIconBindings(visualJson, [...bindings.filter((b) => b !== prev), binding])
  if (prev?.resource && prev.resource !== binding.resource) releaseIconResource(report, prev.resource)
}

/** Fingerprint `svg` would get in `slot` (to tell whether a re-bake changes anything). */
export function bakeFingerprint(slot: Pick<IconSlot, 'form'>, svg: string): string {
  return slot.form === 'resource' ? fingerprint(svgBytes(svg)) : fingerprint(svgDataUriOf(svg))
}

/** Turn an icon slot back into a plain image slot: drop the binding (the baked image stays, as an ordinary image). */
export function unbindIcon(visualJson: any, slot: Pick<IconSlot, 'object' | 'property' | 'selector'>): void {
  const key = slotKey(slot)
  writeIconBindings(
    visualJson,
    readIconBindings(visualJson).filter((b) => slotKey(b.slot) !== key)
  )
}

/** Remove an icon from a slot entirely: binding, image reference and (when unused) the baked resource. */
export function removeIcon(report: ReportDocument, visualJson: any, slot: IconSlot): void {
  const b = activeIcon(report, visualJson, slot)
  unbindIcon(visualJson, slot)
  if (!b) return
  if (slot.form === 'resource') {
    const e = entryOf(visualJson, 'general', undefined)
    if (e) delete e.properties.imageUrl
    const sf = visualJson?.visual?.objects?.image?.[0]?.properties?.sourceFile
    if (sf?.image?.url?.expr?.ResourcePackageItem?.ItemName === b.resource) delete visualJson.visual.objects.image[0].properties.sourceFile
    releaseIconResource(report, b.resource)
  } else {
    const e = entryOf(visualJson, slot.object, slot.selector)
    if (e) delete e.properties[slot.property]
  }
}

// ---------------------------------------------------------------------------------------------
// Report-wide passes
// ---------------------------------------------------------------------------------------------

function* visualsOf(report: ReportDocument): Generator<{ json: any }> {
  for (const p of report.pages) for (const v of p.visuals) yield v
}

/** Sets referenced by the report's icon bindings (to load before re-baking). */
export function iconSetsInReport(report: ReportDocument): Set<IconSetId> {
  const out = new Set<IconSetId>()
  for (const v of visualsOf(report)) for (const b of readIconBindings(v.json)) out.add(b.icon.set)
  return out
}

/** True when any visual carries a Lumen icon annotation (cheap pre-check). */
export function hasIconBindings(report: ReportDocument): boolean {
  for (const v of visualsOf(report)) if (Array.isArray(v.json?.annotations) && v.json.annotations.some((a: any) => a?.name === ICON_ANNOTATION)) return true
  return false
}

export interface IconPruneResult {
  /** bindings whose picture was replaced outside Lumen */
  stale: number
  /** bindings to sets Lumen no longer offers (their pictures stay, as plain images) */
  removed: number
  /** those sets' ids (sorted) */
  removedSets: string[]
}

/**
 * Drop bindings whose image no longer matches (changed in Power BI, or replaced by an image edit): the image wins.
 * Also drops bindings to sets Lumen no longer offers, keeping their pictures as plain images. Mutates.
 */
export function pruneStaleIcons(report: ReportDocument): IconPruneResult {
  const res: IconPruneResult = { stale: 0, removed: 0, removedSets: [] }
  for (const v of visualsOf(report)) {
    const raw = readRawBindings(v.json)
    const all = raw.flatMap((r) => (r.binding ? [r.binding] : []))
    const removed = raw.filter((r) => r.removedSet)
    if (!all.length && !removed.length) {
      // an unreadable annotation is left alone (another tool's future version may own it)
      continue
    }
    const keep = all.filter((b) => isBindingCurrent(report, v.json, b))
    if (keep.length !== all.length || removed.length) {
      res.stale += all.length - keep.length
      res.removed += removed.length
      for (const r of removed) if (!res.removedSets.includes(r.removedSet!)) res.removedSets.push(r.removedSet!)
      writeIconBindings(v.json, keep)
    }
  }
  res.removedSets.sort()
  return res
}

/**
 * Re-bake every current binding that uses theme colours and whose picture under the current theme differs from what
 * is stored. `render(ref)` returns the icon's picture (renderer/src/icons/picture.ts, colours resolved through the
 * theme), undefined when the icon's set is not loaded yet (counted in `missing`), or null when it cannot be drawn
 * (unknown icon: the stored picture stays). Mutates; returns how many were re-baked.
 */
export function rebakeIcons(report: ReportDocument, render: (ref: IconRef) => string | null | undefined): { rebaked: number; missing: Set<IconSetId> } {
  const missing = new Set<IconSetId>()
  let rebaked = 0
  for (const v of visualsOf(report)) {
    for (const b of readIconBindings(v.json)) {
      if (!usesThemeColors(b.icon) || !isBindingCurrent(report, v.json, b)) continue
      const svg = render(b.icon)
      if (svg === undefined) {
        missing.add(b.icon.set)
        continue
      }
      if (svg === null || bakeFingerprint(b.slot, svg) === b.bake) continue
      bakeIcon(report, v.json, b.slot, b.icon, svg)
      rebaked++
    }
  }
  return { rebaked, missing }
}
