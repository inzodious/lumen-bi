import { describe, expect, it } from 'vitest'
import { resolveTheme } from '@core/report/theme'
import type { ReportDocument, VisualDocument } from '@core/report/types'
import { mobileFormatVisual, mobileOverrides, mobileTarget, resetMobileFormatting, seedMobileObject } from '../format'
import { mobileVisualJson } from '../layout'
import { setRaw } from '../../../panes/visualizations/objects'

const lit = (v: string) => ({ expr: { Literal: { Value: v } } })

function visual(mobile = true): VisualDocument {
  return {
    name: 'v1',
    json: {
      name: 'v1',
      position: { x: 0, y: 0, z: 0, width: 300, height: 200 },
      visual: {
        visualType: 'clusteredColumnChart',
        visualContainerObjects: { title: [{ properties: { show: lit('true'), text: lit("'Desktop title'"), fontSize: lit('14D') } }] }
      }
    },
    ...(mobile ? { mobile: { $schema: 'x', position: { x: 0, y: 0, z: 0, width: 320, height: 200 } } } : {})
  } as VisualDocument
}

function report(v: VisualDocument): ReportDocument {
  return { origin: 'new', report: {}, pagesMeta: { pageOrder: ['p'] }, pages: [{ name: 'p', json: { name: 'p' }, visuals: [v] }], bookmarks: [], theme: {} } as unknown as ReportDocument
}

describe('mobile-only formatting', () => {
  it('first edit seeds the override from desktop; the desktop visual.json is untouched', () => {
    const v = visual()
    const r = report(v)
    const before = JSON.stringify(v.json)
    const t = mobileTarget('p', v, true, resolveTheme())
    const bag = t.locate(r)!
    t.beforeWrite!(r, bag, 'title')
    setRaw(bag, 'title', 'text', lit("'Phone title'"))
    expect(JSON.stringify(v.json)).toBe(before)
    const props = v.mobile.visualContainerObjects.title[0].properties
    expect(props.text).toEqual(lit("'Phone title'"))
    // other title properties keep the desktop values (object-level override)
    expect(props.fontSize).toEqual(lit('14D'))
    expect(mobileVisualJson(v).visual.visualContainerObjects.title[0].properties.text).toEqual(lit("'Phone title'"))
    expect(mobileOverrides(v)).toEqual([{ container: true, object: 'title' }])
  })

  it('resolves values from the merged (mobile over desktop) formatting', () => {
    const v = visual()
    seedMobileObject(v, true, 'title')
    v.mobile.visualContainerObjects.title[0].properties.text = lit("'Phone'")
    const t = mobileTarget('p', v, true, resolveTheme())
    expect(t.resolveRaw('title', 'text')).toEqual(lit("'Phone'"))
    expect(t.cf).toBeUndefined()
  })

  it('reset removes the override and empty containers (mobile.json back to positions only)', () => {
    const v = visual()
    const original = JSON.stringify(v.mobile)
    seedMobileObject(v, true, 'title')
    seedMobileObject(v, false, 'legend')
    expect(resetMobileFormatting(v, { container: true, object: 'title' })).toBe(true)
    expect(v.mobile.visualContainerObjects).toBeUndefined()
    expect(resetMobileFormatting(v)).toBe(true)
    expect(JSON.stringify(v.mobile)).toBe(original)
  })

  it('only visuals placed on the phone can be formatted for mobile', () => {
    const placed = visual()
    const notPlaced = { ...visual(false), name: 'v2' }
    const page = { name: 'p', json: {}, visuals: [placed, notPlaced] } as any
    expect(mobileFormatVisual(page, ['v1'])).toBe(placed)
    expect(mobileFormatVisual(page, ['v2'])).toBeUndefined()
    expect(mobileFormatVisual(page, ['v1', 'v2'])).toBeUndefined()
    expect(mobileTarget('p', notPlaced, false, resolveTheme()).locate(report(notPlaced))).toBeUndefined()
  })
})
