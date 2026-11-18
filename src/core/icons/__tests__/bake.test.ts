/**
 * Storing icons in PBIR (pure): the picture is handed in as a string (in the app it is the icon component's own
 * output, renderer/src/icons/picture.ts; here a stand-in that records the resolved colour).
 */
import { describe, expect, it } from 'vitest'
import { emptyReport, type ReportDocument } from '../../report/types'
import { resolveTheme, type ResolvedTheme } from '../../report/theme'
import { pbirToFiles, readPbirFiles } from '../../pbir/pbir'
import { decodeLiteral } from '../../report/literal'
import { ICON_ANNOTATION, ICON_RESOURCE_PREFIX, IMAGE_VISUAL_SLOT, activeIcon, bakeIcon, cardImageSlot, hasIconBindings, iconSetsInReport, imageVisualItem, pruneStaleIcons, readIconBindings, rebakeIcons, removeIcon, unbindIcon } from '../bake'
import { fingerprint } from '../hash'
import { parseIconRef, resolveRefColor, serializeIconRef } from '../ref'
import type { IconRef } from '../types'

const theme = resolveTheme()

/** Stand-in picture: what the renderer would draw, reduced to the resolved colour. */
const picture = (ref: IconRef, t: ResolvedTheme = theme) => `<svg xmlns="http://www.w3.org/2000/svg" data-icon="${ref.set}:${ref.name}" color="${resolveRefColor(ref, t) ?? 'own'}"/>`

function report(): ReportDocument {
  const r = emptyReport()
  r.report.resourcePackages = [{ name: 'SharedResources', type: 'SharedResources', items: [{ name: 'CY24SU10', path: 'BaseThemes/CY24SU10.json', type: 'BaseTheme' }] }]
  r.pages[0].visuals.push(
    { name: 'img1', json: { name: 'img1', position: { x: 0, y: 0, z: 0, width: 100, height: 100 }, visual: { visualType: 'image', drillFilterOtherVisuals: true } } },
    { name: 'card1', json: { name: 'card1', position: { x: 0, y: 0, z: 1, width: 200, height: 100 }, visual: { visualType: 'cardVisual', objects: { image: [{ properties: { position: { expr: { Literal: { Value: "'Left'" } } } } }] } } } }
  )
  return r
}

const visual = (r: ReportDocument, name: string) => r.pages[0].visuals.find((v) => v.name === name)!.json

/** Save to PBIR files and read them back (what reopening a saved PBIP does). */
function roundTrip(r: ReportDocument): ReportDocument {
  const out = pbirToFiles(r)
  const files: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(out)) files[k] = typeof v === 'string' ? new TextEncoder().encode(v) : v
  return readPbirFiles(files)
}

const lit = (raw: any) => decodeLiteral(raw.expr.Literal.Value)
const svgOf = (r: ReportDocument, item: string) => new TextDecoder().decode(r.resources[`StaticResources/RegisteredResources/${item}`].bytes)

const chart: IconRef = { set: 'lucide', name: 'chart-column', color: 'theme:2', strokeWidth: 1.5 }
const pie: IconRef = { set: 'fluent-color', name: 'data-pie' }

describe('icon references', () => {
  it('parse / serialise: what does not apply to a set is dropped, defaults are not written', () => {
    expect(parseIconRef({ set: 'lucide', name: 'chart-column', color: 'theme:2', strokeWidth: 1.5, padding: 50 })).toEqual({ ...chart, padding: 40 })
    // Fluent Color has fixed colours and no strokes
    expect(parseIconRef({ set: 'fluent-color', name: 'data-pie', color: '#FF0000', strokeWidth: 3 })).toEqual(pie)
    expect(serializeIconRef({ set: 'lucide', name: 'users', strokeWidth: 2 })).toEqual({ set: 'lucide', name: 'users' })
    expect(parseIconRef({ set: 'lucide', name: 'Bad Name' })).toBeUndefined()
    expect(parseIconRef({ set: 'iconpark', name: 'wallet' })).toBeUndefined()
  })
})

describe('baking icons into PBIR', () => {
  it('image visual: SVG registered resource + general.imageUrl ResourcePackageItem + Lumen_Icon annotation; survives save / reopen', () => {
    const r = report()
    bakeIcon(r, visual(r, 'img1'), IMAGE_VISUAL_SLOT, chart, picture(chart))
    const v = visual(r, 'img1')
    const item = imageVisualItem(v)!
    expect(item.startsWith(`${ICON_RESOURCE_PREFIX}lucide_chart-column_`)).toBe(true)
    expect(item.endsWith('.svg')).toBe(true)
    expect(v.visual.objects.general[0].properties.imageUrl).toEqual({ expr: { ResourcePackageItem: { PackageName: 'RegisteredResources', PackageType: 1, ItemName: item } } })
    const res = r.resources[`StaticResources/RegisteredResources/${item}`]
    expect(res.mime).toBe('image/svg+xml')
    expect(svgOf(r, item)).toBe(picture(chart))
    expect(r.report.resourcePackages.find((p: any) => p.name === 'RegisteredResources').items).toEqual([{ name: item, path: item, type: 'Image' }])
    // the annotation is a schema-shaped { name, value: string }
    expect(v.annotations).toHaveLength(1)
    expect(v.annotations[0].name).toBe(ICON_ANNOTATION)
    expect(typeof v.annotations[0].value).toBe('string')
    expect(JSON.parse(v.annotations[0].value)).toEqual({ version: 2, icons: [{ slot: { object: 'general', property: 'imageUrl', form: 'resource' }, icon: chart, bake: fingerprint(picture(chart)), resource: item }] })

    const back = roundTrip(r)
    expect(activeIcon(back, visual(back, 'img1'), IMAGE_VISUAL_SLOT)?.icon).toEqual(chart)
    expect(svgOf(back, item)).toBe(picture(chart))
    expect(hasIconBindings(back)).toBe(true)
    expect([...iconSetsInReport(back)]).toEqual(['lucide'])
  })

  it('keeps other annotations and the newer image.sourceFile shape when present', () => {
    const r = report()
    const v = visual(r, 'img1')
    v.annotations = [{ name: 'Note', value: 'keep me' }]
    v.visual.objects = { image: [{ properties: { sourceFile: { image: { name: { expr: { Literal: { Value: "'a.png'" } } }, url: { expr: { ResourcePackageItem: { PackageName: 'RegisteredResources', PackageType: 1, ItemName: 'a.png' } } } } } } }] }
    bakeIcon(r, v, IMAGE_VISUAL_SLOT, chart, picture(chart))
    expect(v.annotations.map((a: any) => a.name)).toEqual(['Note', ICON_ANNOTATION])
    expect(v.visual.objects.general).toBeUndefined()
    expect(v.visual.objects.image[0].properties.sourceFile.image.url.expr.ResourcePackageItem.ItemName.startsWith(ICON_RESOURCE_PREFIX)).toBe(true)
    expect(activeIcon(r, v, IMAGE_VISUAL_SLOT)).toBeDefined()
    unbindIcon(v, IMAGE_VISUAL_SLOT)
    expect(v.annotations).toEqual([{ name: 'Note', value: 'keep me' }])
  })

  it('new card callout image: data URI in image.imageUrl with imageType imageUrl; survives save / reopen', () => {
    const r = report()
    const slot = cardImageSlot('image')
    bakeIcon(r, visual(r, 'card1'), slot, pie, picture(pie))
    const props = visual(r, 'card1').visual.objects.image[0].properties
    expect(lit(props.imageType)).toBe('imageUrl')
    expect(lit(props.show)).toBe(true)
    expect(lit(props.position)).toBe('Left')
    const uri = lit(props.imageUrl) as string
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true)
    expect(atob(uri.slice('data:image/svg+xml;base64,'.length))).toBe(picture(pie))
    // no resource for data-URI slots
    expect(Object.keys(r.resources)).toEqual([])

    const back = roundTrip(r)
    expect(activeIcon(back, visual(back, 'card1'), slot)?.icon).toEqual(pie)
    // per-selector slots are independent
    expect(activeIcon(back, visual(back, 'card1'), cardImageSlot('image', { metadata: 'Sum(Sales.Amount)' }))).toBeUndefined()
  })

  it('a stale reference (image changed in Power BI) loses: not active, pruned on open', () => {
    const r = report()
    bakeIcon(r, visual(r, 'img1'), IMAGE_VISUAL_SLOT, chart, picture(chart))
    bakeIcon(r, visual(r, 'card1'), cardImageSlot('image'), pie, picture(pie))
    const back = roundTrip(r)
    // someone replaced the picture of the image visual with another upload, and typed a URL into the card
    visual(back, 'img1').visual.objects.general[0].properties.imageUrl = { expr: { ResourcePackageItem: { PackageName: 'RegisteredResources', PackageType: 1, ItemName: 'logo.png' } } }
    visual(back, 'card1').visual.objects.image[0].properties.imageUrl = { expr: { Literal: { Value: "'https://example.com/a.png'" } } }
    expect(activeIcon(back, visual(back, 'img1'), IMAGE_VISUAL_SLOT)).toBeUndefined()
    expect(activeIcon(back, visual(back, 'card1'), cardImageSlot('image'))).toBeUndefined()
    expect(pruneStaleIcons(back)).toEqual({ stale: 2, removed: 0, removedSets: [] })
    expect(visual(back, 'img1').annotations).toBeUndefined()
    expect(visual(back, 'card1').annotations).toBeUndefined()
    // the replacement images are untouched
    expect(lit(visual(back, 'card1').visual.objects.image[0].properties.imageUrl)).toBe('https://example.com/a.png')
  })

  it('same resource name but edited bytes is stale too', () => {
    const r = report()
    bakeIcon(r, visual(r, 'img1'), IMAGE_VISUAL_SLOT, chart, picture(chart))
    const item = imageVisualItem(visual(r, 'img1'))!
    r.resources[`StaticResources/RegisteredResources/${item}`].bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
    expect(activeIcon(r, visual(r, 'img1'), IMAGE_VISUAL_SLOT)).toBeUndefined()
  })

  it('a reference to a removed set (saved by an earlier build) is dropped on open; its picture stays as a plain image', () => {
    const r = report()
    // what an earlier build saved: a Tabler icon in the image visual, an IconPark icon on the card, a current icon too
    const oldSvg = '<svg xmlns="http://www.w3.org/2000/svg"><path stroke="#118DFF" d="M0 0h1"/></svg>'
    const item = 'LumenIcon_tabler_chart-bar_0123456789ab.svg'
    r.resources[`StaticResources/RegisteredResources/${item}`] = { path: `StaticResources/RegisteredResources/${item}`, bytes: new TextEncoder().encode(oldSvg), mime: 'image/svg+xml' }
    r.report.resourcePackages.push({ name: 'RegisteredResources', type: 'RegisteredResources', items: [{ name: item, path: item, type: 'Image' }] })
    const img = visual(r, 'img1')
    img.visual.objects = { general: [{ properties: { imageUrl: { expr: { ResourcePackageItem: { PackageName: 'RegisteredResources', PackageType: 1, ItemName: item } } } } }] }
    img.annotations = [{ name: ICON_ANNOTATION, value: JSON.stringify({ version: 1, icons: [{ slot: { object: 'general', property: 'imageUrl', form: 'resource' }, icon: { set: 'tabler', name: 'chart-bar', variant: 'outline', colors: ['theme:2'] }, bake: fingerprint(new TextEncoder().encode(oldSvg)), resource: item }] }) }]
    const card = visual(r, 'card1')
    const uri = `data:image/svg+xml;base64,${btoa(oldSvg)}`
    card.visual.objects.image[0].properties.imageUrl = { expr: { Literal: { Value: `'${uri}'` } } }
    card.visual.objects.image[0].properties.imageType = { expr: { Literal: { Value: "'imageUrl'" } } }
    bakeIcon(r, card, cardImageSlot('cardImage'), pie, picture(pie))
    const ann = JSON.parse(card.annotations[0].value)
    ann.icons.push({ slot: { object: 'image', property: 'imageUrl', form: 'dataUri' }, icon: { set: 'iconpark', name: 'wallet', variant: 'multi-color' }, bake: fingerprint(uri) })
    card.annotations[0].value = JSON.stringify(ann)
    // the removed-set entries are not usable bindings
    expect(readIconBindings(img)).toEqual([])
    expect(readIconBindings(card).map((b) => b.icon.set)).toEqual(['fluent-color'])

    const back = roundTrip(r)
    expect(pruneStaleIcons(back)).toEqual({ stale: 0, removed: 2, removedSets: ['iconpark', 'tabler'] })
    // reference gone, picture kept where Power BI and Lumen read it
    expect(visual(back, 'img1').annotations).toBeUndefined()
    expect(imageVisualItem(visual(back, 'img1'))).toBe(item)
    expect(svgOf(back, item)).toBe(oldSvg)
    expect(lit(visual(back, 'card1').visual.objects.image[0].properties.imageUrl)).toBe(uri)
    // the current icon on the same card is still an icon
    expect(readIconBindings(visual(back, 'card1')).map((b) => b.icon)).toEqual([pie])
    expect(activeIcon(back, visual(back, 'card1'), cardImageSlot('cardImage'))?.icon).toEqual(pie)
    // idempotent
    expect(pruneStaleIcons(back)).toEqual({ stale: 0, removed: 0, removedSets: [] })
  })

  it('re-bakes on a theme change: theme colours follow, literal and fixed colours do not; old baked resource released', () => {
    const r = report()
    bakeIcon(r, visual(r, 'img1'), IMAGE_VISUAL_SLOT, chart, picture(chart))
    const literal: IconRef = { set: 'lucide', name: 'users', color: '#123456' }
    bakeIcon(r, visual(r, 'card1'), cardImageSlot('image'), literal, picture(literal))
    bakeIcon(r, visual(r, 'card1'), cardImageSlot('cardImage'), pie, picture(pie))
    const oldItem = imageVisualItem(visual(r, 'img1'))!
    const oldCard = lit(visual(r, 'card1').visual.objects.image[0].properties.imageUrl)
    const ember = resolveTheme(undefined, { name: 'Ember', dataColors: ['#E66C37'] })
    let calls = 0
    const render = (ref: IconRef) => {
      calls++
      return picture(ref, ember)
    }
    const res = rebakeIcons(r, render)
    expect(res).toEqual({ rebaked: 1, missing: new Set() })
    // only theme-coloured icons are rendered again
    expect(calls).toBe(1)
    const newItem = imageVisualItem(visual(r, 'img1'))!
    expect(newItem).not.toBe(oldItem)
    expect(svgOf(r, newItem)).toContain('color="#E66C37"')
    expect(r.resources[`StaticResources/RegisteredResources/${oldItem}`]).toBeUndefined()
    expect(r.report.resourcePackages.find((p: any) => p.name === 'RegisteredResources').items.map((i: any) => i.name)).toEqual([newItem])
    expect(activeIcon(r, visual(r, 'img1'), IMAGE_VISUAL_SLOT)?.icon).toEqual(chart)
    expect(lit(visual(r, 'card1').visual.objects.image[0].properties.imageUrl)).toBe(oldCard)
    // idempotent
    expect(rebakeIcons(r, render).rebaked).toBe(0)
    // sets not loaded are reported; unknown icons keep their picture
    expect([...rebakeIcons(r, () => undefined).missing]).toEqual(['lucide'])
    expect(rebakeIcons(r, () => null)).toEqual({ rebaked: 0, missing: new Set() })
    expect(imageVisualItem(visual(r, 'img1'))).toBe(newItem)
  })

  it('the default colour of a single-colour set is a theme colour (follows a theme change)', () => {
    const r = report()
    const plain: IconRef = { set: 'lucide', name: 'target' }
    bakeIcon(r, visual(r, 'img1'), IMAGE_VISUAL_SLOT, plain, picture(plain))
    const dark = resolveTheme(undefined, { name: 'Ink', foreground: '#0B1F33' } as any)
    expect(rebakeIcons(r, (ref) => picture(ref, dark)).rebaked).toBe(1)
    expect(svgOf(r, imageVisualItem(visual(r, 'img1'))!)).toContain('color="#0B1F33"')
  })

  it('a resource still used elsewhere is not deleted; removeIcon clears the slot', () => {
    const r = report()
    bakeIcon(r, visual(r, 'img1'), IMAGE_VISUAL_SLOT, chart, picture(chart))
    // a copy of the visual (copy / paste) shares the resource
    r.pages[0].visuals.push({ name: 'img2', json: JSON.parse(JSON.stringify({ ...visual(r, 'img1'), name: 'img2' })) })
    const item = imageVisualItem(visual(r, 'img1'))!
    const black = { ...chart, color: '#000000' }
    bakeIcon(r, visual(r, 'img1'), IMAGE_VISUAL_SLOT, black, picture(black))
    expect(r.resources[`StaticResources/RegisteredResources/${item}`]).toBeDefined()
    removeIcon(r, visual(r, 'img2'), IMAGE_VISUAL_SLOT)
    expect(r.resources[`StaticResources/RegisteredResources/${item}`]).toBeUndefined()
    expect(visual(r, 'img2').annotations).toBeUndefined()
    expect(imageVisualItem(visual(r, 'img2'))).toBeUndefined()
  })

  it('ignores malformed annotations (and leaves an unreadable one alone)', () => {
    const v = { visual: {}, annotations: [{ name: ICON_ANNOTATION, value: '{nope' }] }
    expect(readIconBindings(v)).toEqual([])
    const v2 = { visual: {}, annotations: [{ name: ICON_ANNOTATION, value: JSON.stringify({ icons: [{ slot: { object: 'general', property: 'imageUrl', form: 'resource' }, icon: { set: 'x', name: 'y' }, bake: 'z' }] }) }] }
    expect(readIconBindings(v2)).toEqual([])
    const r = report()
    r.pages[0].visuals.push({ name: 'v2', json: v2 })
    expect(pruneStaleIcons(r)).toEqual({ stale: 0, removed: 0, removedSets: [] })
    expect(v2.annotations).toHaveLength(1)
    expect(fingerprint('a')).not.toBe(fingerprint('b'))
    expect(fingerprint('abc')).toMatch(/^[0-9a-f]{16}$/)
  })
})
