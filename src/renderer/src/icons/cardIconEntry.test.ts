/**
 * Card icons on cards whose image settings live where current Power BI writes them: an entry with
 * `selector: { id: 'default' }`, the picture coming from data (`imageType 'imageData'` + a bound `imageData`).
 * The icon must land in that entry and be what the card model draws; removing it (or switching the source back)
 * must give the data binding back; an icon an earlier build put into a stray selector-less entry is moved on open.
 * Invented fixtures only.
 */
import { describe, expect, it } from 'vitest'
import { activeIcon, bakeIcon, cardImageSlot, pruneStaleIcons, readIconBindings, removeIcon, svgDataUriOf, ICON_ANNOTATION } from '@core/icons/bake'
import { fingerprint } from '@core/icons/hash'
import { aggregationExpr } from '@core/report/sq'
import { emptyReport, type ReportDocument } from '@core/report/types'
import { pbirToFiles, readPbirFiles } from '@core/pbir/pbir'
import { resolveTheme } from '@core/report/theme'
import type { IconRef } from '@core/icons/types'
import { S, proj } from '../visuals/common/sampleData'
import { memoryFormat } from '../visuals/common/memoryEngine'
import { buildCardVisualModel, cardFields, planCardQuery, type CardValues } from '../visuals/cards/cardVisualModel'
import { setRaw } from '../panes/visualizations/objects'

const theme = resolveTheme()
const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const rocket: IconRef = { set: 'lucide', name: 'rocket' }
const wallet: IconRef = { set: 'lucide', name: 'wallet' }
const svg = (ref: IconRef) => `<svg xmlns="http://www.w3.org/2000/svg" data-icon="${ref.set}:${ref.name}"/>`
const uriOf = (ref: IconRef) => svgDataUriOf(svg(ref))

/** An invented column holding image data, aggregated the way Power BI binds it (Function 3 = Min). */
const imageColumn = () => aggregationExpr('Products', 'Picture', 3)

/** The callout-image entry as current Power BI writes it for "Select from data". */
const dataEntry = () => ({
  properties: {
    show: lit('true'),
    imageType: lit("'imageData'"),
    imageData: { expr: imageColumn() },
    imageAreaSize: lit('15L'),
    padding: lit('0L'),
    verticalAlignment: lit("'top'")
  },
  selector: { id: 'default' }
})

function cardJson(objects: any, projections = [proj(S.m('Orders'), '_m.Orders')]) {
  return { name: 'card1', position: { x: 0, y: 0, z: 0, width: 200, height: 100 }, visual: { visualType: 'cardVisual', query: { queryState: { Data: { projections } } }, objects } }
}

function reportWith(json: any): ReportDocument {
  const r = emptyReport()
  r.pages[0].visuals.push({ name: 'card1', json })
  return r
}

const card = (r: ReportDocument) => r.pages[0].visuals[0].json

/** The card model as the canvas builds it: a bound value resolves to a photo, the callouts to 1. */
function model(json: any) {
  const fields = cardFields(json, (p) => p.queryRef, () => true)
  const plan = planCardQuery(json, theme, fields)
  const vals: CardValues = { get: (id) => (id.startsWith('b|') ? { value: PHOTO } : { value: 1 }) }
  return buildCardVisualModel(json, theme, memoryFormat, plan, vals)
}

function roundTrip(r: ReportDocument): ReportDocument {
  const files: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(pbirToFiles(r))) files[k] = typeof v === 'string' ? new TextEncoder().encode(v) : v
  return readPbirFiles(files)
}

describe('card icon in a `{ id: "default" }` entry with the image from data', () => {
  it('the fixture draws the data picture before', () => {
    expect(model(cardJson({ image: [dataEntry()] })).callouts[0].image?.src).toBe(PHOTO)
  })

  it('choosing an icon writes it into the entry the card reads, sets the binding aside, and the card draws it', () => {
    const r = reportWith(cardJson({ image: [dataEntry()] }))
    const slot = cardImageSlot('image')
    bakeIcon(r, card(r), slot, rocket, svg(rocket))
    const entries = card(r).visual.objects.image
    // no second, selector-less entry
    expect(entries).toHaveLength(1)
    expect(entries[0].selector).toEqual({ id: 'default' })
    expect(entries[0].properties).toEqual({
      show: lit('true'),
      imageType: lit("'imageUrl'"),
      imageUrl: lit(`'${uriOf(rocket)}'`),
      imageAreaSize: lit('15L'),
      padding: lit('0L'),
      verticalAlignment: lit("'top'")
    })
    const img = model(card(r)).callouts[0].image!
    expect(img.src).toBe(uriOf(rocket))
    // the stored position and box are untouched
    expect(img).toMatchObject({ position: 'right', verticalAlignment: 'top', areaSize: 15, gap: 0 })
    expect(activeIcon(r, card(r), slot)?.icon).toEqual(rocket)
    // what it replaced is kept in the binding
    expect(readIconBindings(card(r))[0].restore).toEqual({ imageType: lit("'imageData'"), imageUrl: null, imageData: { expr: imageColumn() } })
  })

  it('removing the icon / switching back to data restores the original entry exactly, also after save and reopen', () => {
    const original = dataEntry()
    const r = reportWith(cardJson({ image: [dataEntry()] }))
    const slot = cardImageSlot('image')
    bakeIcon(r, card(r), slot, rocket, svg(rocket))
    // another icon, then a re-bake: the first `restore` is kept
    bakeIcon(r, card(r), slot, wallet, svg(wallet))
    const back = roundTrip(r)
    expect(pruneStaleIcons(back)).toMatchObject({ stale: 0, moved: 0 })
    expect(activeIcon(back, card(back), slot)?.icon).toEqual(wallet)
    expect(model(card(back)).callouts[0].image?.src).toBe(uriOf(wallet))
    // Format pane: Image source ▸ Select from data (IconTypeRow: removeIcon, then the chosen type)
    removeIcon(back, card(back), slot)
    setRaw(card(back).visual.objects, 'image', 'imageType', lit("'imageData'"), slot.selector)
    expect(card(back).visual.objects.image).toEqual([original])
    expect(card(back).annotations).toBeUndefined()
    expect(model(card(back)).callouts[0].image?.src).toBe(PHOTO)
  })

  it('Remove icon alone also gives the data source back', () => {
    const r = reportWith(cardJson({ image: [dataEntry()] }))
    bakeIcon(r, card(r), cardImageSlot('image'), rocket, svg(rocket))
    removeIcon(r, card(r), cardImageSlot('image'))
    expect(card(r).visual.objects.image).toEqual([dataEntry()])
  })

  it('a hidden callout image is switched on; a measure-bound URL is replaced and comes back', () => {
    const measureUrl = { expr: S.m('Logo Url') }
    const entry = { properties: { show: lit('false'), imageType: lit("'imageUrl'"), imageUrl: measureUrl }, selector: { id: 'default' } }
    const r = reportWith(cardJson({ image: [JSON.parse(JSON.stringify(entry))] }))
    bakeIcon(r, card(r), cardImageSlot('image'), rocket, svg(rocket))
    const props = card(r).visual.objects.image[0].properties
    expect(props.show).toEqual(lit('true'))
    expect(props.imageUrl).toEqual(lit(`'${uriOf(rocket)}'`))
    expect(model(card(r)).callouts[0].image?.src).toBe(uriOf(rocket))
    removeIcon(r, card(r), cardImageSlot('image'))
    // the source comes back; the image stays switched on (the user turned it on by choosing an icon)
    expect(card(r).visual.objects.image).toEqual([{ ...entry, properties: { ...entry.properties, show: lit('true') } }])
  })

  it('card image area (`cardImage`) in a `{ id: "default" }` entry from data', () => {
    const entry = { properties: { show: lit('true'), imageType: lit("'imageData'"), imageData: { expr: imageColumn() }, imageHeight: lit('24L') }, selector: { id: 'default' } }
    const r = reportWith(cardJson({ cardImage: [JSON.parse(JSON.stringify(entry))] }))
    expect(model(card(r)).callouts[0].cardImage?.src).toBe(PHOTO)
    bakeIcon(r, card(r), cardImageSlot('cardImage'), rocket, svg(rocket))
    expect(card(r).visual.objects.cardImage).toHaveLength(1)
    expect(model(card(r)).callouts[0].cardImage).toMatchObject({ src: uriOf(rocket), height: 24 })
    removeIcon(r, card(r), cardImageSlot('cardImage'))
    expect(card(r).visual.objects.cardImage).toEqual([entry])
  })

  it('several callouts: an icon for one series goes to its own entry (or its `{ metadata, id: "default" }` entry); the others keep the data picture', () => {
    const projections = [proj(S.m('Orders'), '_m.Orders'), proj(S.m('Units'), '_m.Units')]
    const r = reportWith(cardJson({ image: [dataEntry()] }, projections))
    const units = cardImageSlot('image', { metadata: '_m.Units' })
    bakeIcon(r, card(r), units, rocket, svg(rocket))
    let m = model(card(r))
    expect(m.callouts.map((c) => c.image?.src)).toEqual([PHOTO, uriOf(rocket)])
    // the default entry is untouched
    expect(card(r).visual.objects.image[0]).toEqual(dataEntry())
    expect(card(r).visual.objects.image[1].selector).toEqual({ metadata: '_m.Units' })
    removeIcon(r, card(r), units)
    m = model(card(r))
    expect(m.callouts.map((c) => c.image?.src)).toEqual([PHOTO, PHOTO])

    // an existing per-series entry written with `id: 'default'` is the one used
    const r2 = reportWith(cardJson({ image: [dataEntry(), { properties: { imageAreaSize: lit('30L') }, selector: { metadata: '_m.Units', id: 'default' } }] }, projections))
    bakeIcon(r2, card(r2), units, rocket, svg(rocket))
    expect(card(r2).visual.objects.image).toHaveLength(2)
    expect(card(r2).visual.objects.image[1].selector).toEqual({ metadata: '_m.Units', id: 'default' })
    expect(model(card(r2)).callouts.map((c) => c.image?.src)).toEqual([PHOTO, uriOf(rocket)])
    expect(activeIcon(r2, card(r2), units)?.icon).toEqual(rocket)
  })

  it('multi-category layout (one section per category): every section draws the icon', () => {
    const json: any = cardJson({ image: [dataEntry()] })
    json.visual.query.queryState.Rows = { projections: [proj(S.col('Region'), 'Sales.Region')] }
    const r = reportWith(json)
    bakeIcon(r, card(r), cardImageSlot('image'), rocket, svg(rocket))
    expect(model(card(r)).callouts[0].image?.src).toBe(uriOf(rocket))
  })

  it('a slot recorded with `{ id: "default" }` and one without are the same slot', () => {
    const r = reportWith(cardJson({ image: [dataEntry()] }))
    bakeIcon(r, card(r), cardImageSlot('image', { id: 'default' }), rocket, svg(rocket))
    expect(activeIcon(r, card(r), cardImageSlot('image'))?.icon).toEqual(rocket)
    expect(card(r).visual.objects.image).toHaveLength(1)
  })
})

describe('icons stored by the earlier build in a stray selector-less entry', () => {
  /** What the first icons build saved: the icon in a new entry behind the `{ id: 'default' }` one, no `restore`. */
  function legacy(extra: Record<string, unknown> = {}) {
    const uri = uriOf(rocket)
    const json: any = cardJson({ image: [dataEntry(), { properties: { imageUrl: lit(`'${uri}'`), imageType: lit("'imageUrl'"), ...extra } }] })
    json.annotations = [
      { name: ICON_ANNOTATION, value: JSON.stringify({ version: 2, icons: [{ slot: { object: 'image', property: 'imageUrl', form: 'dataUri' }, icon: rocket, bake: fingerprint(uri) }] }) }
    ]
    return reportWith(json)
  }

  it('it did not show (the reproduction)', () => {
    expect(model(card(legacy())).callouts[0].image?.src).toBe(PHOTO)
  })

  it('on open it is moved onto the entry the card reads; the stray entry goes; the icon shows and stays editable', () => {
    const r = legacy()
    expect(pruneStaleIcons(r)).toEqual({ stale: 0, removed: 0, removedSets: [], moved: 1 })
    const entries = card(r).visual.objects.image
    expect(entries).toHaveLength(1)
    expect(entries[0].selector).toEqual({ id: 'default' })
    expect(entries[0].properties.imageData).toBeUndefined()
    expect(model(card(r)).callouts[0].image?.src).toBe(uriOf(rocket))
    expect(activeIcon(r, card(r), cardImageSlot('image'))?.icon).toEqual(rocket)
    // its data source can be switched back
    removeIcon(r, card(r), cardImageSlot('image'))
    expect(card(r).visual.objects.image).toEqual([dataEntry()])
    // idempotent
    expect(pruneStaleIcons(legacy()).moved).toBe(1)
  })

  it('a stray entry with other properties keeps them; only the icon properties move', () => {
    const r = legacy({ position: lit("'Left'") })
    expect(pruneStaleIcons(r).moved).toBe(1)
    expect(card(r).visual.objects.image).toHaveLength(2)
    expect(card(r).visual.objects.image[1].properties).toEqual({ position: lit("'Left'") })
    expect(model(card(r)).callouts[0].image?.src).toBe(uriOf(rocket))
  })

  it('a current save is left alone', () => {
    const r = reportWith(cardJson({ image: [dataEntry()] }))
    bakeIcon(r, card(r), cardImageSlot('image'), rocket, svg(rocket))
    const before = JSON.stringify(card(r))
    expect(pruneStaleIcons(r)).toMatchObject({ stale: 0, moved: 0 })
    expect(JSON.stringify(card(r))).toBe(before)
  })
})
