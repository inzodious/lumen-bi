import { beforeAll, describe, expect, it } from 'vitest'
import { emptyReport, type ReportDocument } from '../../report/types'
import { resolveTheme } from '../../report/theme'
import { pbirToFiles, readPbirFiles } from '../../pbir/pbir'
import { decodeLiteral } from '../../report/literal'
import { loadIconSet, getLoadedIconSet } from '../registry'
import { ICON_ANNOTATION, ICON_RESOURCE_PREFIX, IMAGE_VISUAL_SLOT, activeIcon, bakeIcon, cardImageSlot, hasIconBindings, iconSetsInReport, imageVisualItem, pruneStaleIcons, readIconBindings, rebakeIcons, removeIcon, unbindIcon } from '../bake'
import { fingerprint } from '../hash'
import type { IconRef, IconSetData } from '../types'

const theme = resolveTheme()
let tabler: IconSetData
let iconpark: IconSetData
beforeAll(async () => {
  tabler = await loadIconSet('tabler')
  iconpark = await loadIconSet('iconpark')
})

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

const chart: IconRef = { set: 'tabler', name: 'chart-bar', variant: 'outline', colors: ['theme:2'] }
const wallet: IconRef = { set: 'iconpark', name: 'wallet', variant: 'multi-color', colors: ['theme:2', '#FFAA00', 'theme:1'] }

describe('baking icons into PBIR', () => {
  it('image visual: SVG registered resource + general.imageUrl ResourcePackageItem + Lumen_Icon annotation; survives save / reopen', () => {
    const r = report()
    expect(bakeIcon(r, visual(r, 'img1'), IMAGE_VISUAL_SLOT, chart, tabler, theme)).toBe(true)
    const v = visual(r, 'img1')
    const item = imageVisualItem(v)!
    expect(item.startsWith(ICON_RESOURCE_PREFIX)).toBe(true)
    expect(item.endsWith('.svg')).toBe(true)
    expect(v.visual.objects.general[0].properties.imageUrl).toEqual({ expr: { ResourcePackageItem: { PackageName: 'RegisteredResources', PackageType: 1, ItemName: item } } })
    const res = r.resources[`StaticResources/RegisteredResources/${item}`]
    expect(res.mime).toBe('image/svg+xml')
    expect(new TextDecoder().decode(res.bytes)).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"[^>]*>.*stroke="#118DFF"/)
    expect(r.report.resourcePackages.find((p: any) => p.name === 'RegisteredResources').items).toEqual([{ name: item, path: item, type: 'Image' }])
    // the annotation is a schema-shaped { name, value: string }
    expect(v.annotations).toHaveLength(1)
    expect(v.annotations[0].name).toBe(ICON_ANNOTATION)
    expect(typeof v.annotations[0].value).toBe('string')
    expect(JSON.parse(v.annotations[0].value)).toMatchObject({ version: 1, icons: [{ slot: { object: 'general', property: 'imageUrl', form: 'resource' }, icon: { set: 'tabler', name: 'chart-bar', variant: 'outline', colors: ['theme:2'] }, resource: item }] })

    const back = roundTrip(r)
    const b = activeIcon(back, visual(back, 'img1'), IMAGE_VISUAL_SLOT)
    expect(b?.icon).toEqual(chart)
    expect(back.resources[`StaticResources/RegisteredResources/${item}`]).toBeDefined()
    expect(hasIconBindings(back)).toBe(true)
    expect([...iconSetsInReport(back)]).toEqual(['tabler'])
  })

  it('keeps other annotations and the newer image.sourceFile shape when present', () => {
    const r = report()
    const v = visual(r, 'img1')
    v.annotations = [{ name: 'Note', value: 'keep me' }]
    v.visual.objects = { image: [{ properties: { sourceFile: { image: { name: { expr: { Literal: { Value: "'a.png'" } } }, url: { expr: { ResourcePackageItem: { PackageName: 'RegisteredResources', PackageType: 1, ItemName: 'a.png' } } } } } } }] }
    bakeIcon(r, v, IMAGE_VISUAL_SLOT, chart, tabler, theme)
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
    expect(bakeIcon(r, visual(r, 'card1'), slot, wallet, iconpark, theme)).toBe(true)
    const props = visual(r, 'card1').visual.objects.image[0].properties
    expect(lit(props.imageType)).toBe('imageUrl')
    expect(lit(props.show)).toBe(true)
    expect(lit(props.position)).toBe('Left')
    const uri = lit(props.imageUrl) as string
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true)
    const svg = atob(uri.slice('data:image/svg+xml;base64,'.length))
    for (const c of ['#118DFF', '#FFAA00', '#252423', '#FFFFFF']) expect(svg).toContain(c)
    // no resource for data-URI slots
    expect(Object.keys(r.resources)).toEqual([])

    const back = roundTrip(r)
    expect(activeIcon(back, visual(back, 'card1'), slot)?.icon).toEqual(wallet)
    // per-selector slots are independent
    expect(activeIcon(back, visual(back, 'card1'), cardImageSlot('image', { metadata: 'Sum(Sales.Amount)' }))).toBeUndefined()
  })

  it('a stale reference (image changed in Power BI) loses: not active, pruned on open', () => {
    const r = report()
    bakeIcon(r, visual(r, 'img1'), IMAGE_VISUAL_SLOT, chart, tabler, theme)
    bakeIcon(r, visual(r, 'card1'), cardImageSlot('image'), wallet, iconpark, theme)
    const back = roundTrip(r)
    // someone replaced the picture of the image visual with another upload, and typed a URL into the card
    visual(back, 'img1').visual.objects.general[0].properties.imageUrl = { expr: { ResourcePackageItem: { PackageName: 'RegisteredResources', PackageType: 1, ItemName: 'logo.png' } } }
    visual(back, 'card1').visual.objects.image[0].properties.imageUrl = { expr: { Literal: { Value: "'https://example.com/a.png'" } } }
    expect(activeIcon(back, visual(back, 'img1'), IMAGE_VISUAL_SLOT)).toBeUndefined()
    expect(activeIcon(back, visual(back, 'card1'), cardImageSlot('image'))).toBeUndefined()
    expect(pruneStaleIcons(back)).toBe(2)
    expect(visual(back, 'img1').annotations).toBeUndefined()
    expect(visual(back, 'card1').annotations).toBeUndefined()
    // the replacement images are untouched
    expect(lit(visual(back, 'card1').visual.objects.image[0].properties.imageUrl)).toBe('https://example.com/a.png')
  })

  it('same resource name but edited bytes is stale too', () => {
    const r = report()
    bakeIcon(r, visual(r, 'img1'), IMAGE_VISUAL_SLOT, chart, tabler, theme)
    const item = imageVisualItem(visual(r, 'img1'))!
    r.resources[`StaticResources/RegisteredResources/${item}`].bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
    expect(activeIcon(r, visual(r, 'img1'), IMAGE_VISUAL_SLOT)).toBeUndefined()
  })

  it('re-bakes on a theme change: theme colours follow, literal colours do not; old baked resource released', () => {
    const r = report()
    bakeIcon(r, visual(r, 'img1'), IMAGE_VISUAL_SLOT, chart, tabler, theme)
    bakeIcon(r, visual(r, 'card1'), cardImageSlot('image'), { ...wallet, colors: ['#123456', '#FFAA00', '#000000'] }, iconpark, theme)
    const oldItem = imageVisualItem(visual(r, 'img1'))!
    const oldCard = lit(visual(r, 'card1').visual.objects.image[0].properties.imageUrl)
    const dark = resolveTheme(undefined, { name: 'Dark', dataColors: ['#E66C37'] })
    const res = rebakeIcons(r, dark, getLoadedIconSet)
    expect(res.rebaked).toBe(1)
    expect(res.missing.size).toBe(0)
    const newItem = imageVisualItem(visual(r, 'img1'))!
    expect(newItem).not.toBe(oldItem)
    expect(new TextDecoder().decode(r.resources[`StaticResources/RegisteredResources/${newItem}`].bytes)).toContain('stroke="#E66C37"')
    expect(r.resources[`StaticResources/RegisteredResources/${oldItem}`]).toBeUndefined()
    expect(r.report.resourcePackages.find((p: any) => p.name === 'RegisteredResources').items.map((i: any) => i.name)).toEqual([newItem])
    expect(activeIcon(r, visual(r, 'img1'), IMAGE_VISUAL_SLOT)?.icon).toEqual(chart)
    expect(lit(visual(r, 'card1').visual.objects.image[0].properties.imageUrl)).toBe(oldCard)
    // idempotent
    expect(rebakeIcons(r, dark, getLoadedIconSet).rebaked).toBe(0)
    // sets not loaded are reported
    expect([...rebakeIcons(r, theme, () => undefined).missing]).toEqual(['tabler'])
  })

  it('a resource still used elsewhere is not deleted; removeIcon clears the slot', () => {
    const r = report()
    bakeIcon(r, visual(r, 'img1'), IMAGE_VISUAL_SLOT, chart, tabler, theme)
    // a copy of the visual (copy / paste) shares the resource
    r.pages[0].visuals.push({ name: 'img2', json: JSON.parse(JSON.stringify({ ...visual(r, 'img1'), name: 'img2' })) })
    const item = imageVisualItem(visual(r, 'img1'))!
    bakeIcon(r, visual(r, 'img1'), IMAGE_VISUAL_SLOT, { ...chart, colors: ['#000000'] }, tabler, theme)
    expect(r.resources[`StaticResources/RegisteredResources/${item}`]).toBeDefined()
    removeIcon(r, visual(r, 'img2'), IMAGE_VISUAL_SLOT)
    expect(r.resources[`StaticResources/RegisteredResources/${item}`]).toBeUndefined()
    expect(visual(r, 'img2').annotations).toBeUndefined()
    expect(imageVisualItem(visual(r, 'img2'))).toBeUndefined()
  })

  it('ignores malformed annotations', () => {
    const v = { visual: {}, annotations: [{ name: ICON_ANNOTATION, value: '{nope' }] }
    expect(readIconBindings(v)).toEqual([])
    const v2 = { visual: {}, annotations: [{ name: ICON_ANNOTATION, value: JSON.stringify({ icons: [{ slot: { object: 'general', property: 'imageUrl', form: 'resource' }, icon: { set: 'x', name: 'y' }, bake: 'z' }] }) }] }
    expect(readIconBindings(v2)).toEqual([])
    expect(fingerprint('a')).not.toBe(fingerprint('b'))
    expect(fingerprint('abc')).toMatch(/^[0-9a-f]{16}$/)
  })
})
