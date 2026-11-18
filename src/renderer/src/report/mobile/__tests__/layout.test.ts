import { describe, expect, it } from 'vitest'
import type { PageDocument } from '@core/report/types'
import {
  MOBILE_MIN_HEIGHT,
  MOBILE_SCHEMA,
  MOBILE_WIDTH,
  addToMobile,
  autoCreateMobile,
  clampMobile,
  clearMobile,
  defaultMobileSize,
  groupChildrenRects,
  isPlaced,
  mobileCanvasHeight,
  mobileRect,
  mobileVisualJson,
  moveMobileBy,
  moveMobileRect,
  pageVisualItems,
  placedVisuals,
  removeFromMobile,
  reorderMobile,
  resizeMobile,
  setMobileRects,
  snap
} from '../layout'

function vis(name: string, x: number, y: number, width: number, height: number, extra: Record<string, any> = {}) {
  return { name, json: { name, position: { x, y, z: 0, width, height, tabOrder: 0 }, visual: { visualType: extra.type ?? 'card' }, ...extra.json }, ...(extra.mobile ? { mobile: extra.mobile } : {}) }
}

function page(): PageDocument {
  return {
    name: 'p1',
    json: { width: 1280, height: 720 },
    visuals: [
      vis('kpi1', 0, 0, 200, 100),
      vis('kpi2', 220, 0, 200, 100),
      vis('kpi3', 440, 0, 200, 100),
      vis('chart', 0, 120, 640, 300, { type: 'clusteredColumnChart' }),
      vis('table', 660, 120, 600, 300, { type: 'tableEx' }),
      vis('hiddenOne', 0, 500, 300, 100, { json: { isHidden: true } })
    ]
  }
}

describe('mobile layout ops', () => {
  it('snaps to the 5-unit fine grid', () => {
    expect(snap(12)).toBe(10)
    expect(snap(13)).toBe(15)
    expect(snap(-2)).toBe(-0)
  })

  it('clamps rects inside the phone width', () => {
    expect(clampMobile({ x: 300, y: -10, width: 100, height: 50 })).toEqual({ x: 220, y: 0, width: 100, height: 50 })
    expect(clampMobile({ x: 0, y: 0, width: 999, height: 3 })).toEqual({ x: 0, y: 0, width: MOBILE_WIDTH, height: 20 })
  })

  it('default size: narrow visuals get half the phone, wide ones the full width; height stays readable', () => {
    const p = page()
    // 640x300 chart: full width, max(0.75 * 300, aspect 150) = 225
    expect(defaultMobileSize(p, p.visuals[3])).toEqual({ width: 320, height: 225 })
    // 200x100 card (16% of the page): half width, max(75, 80) = 80
    expect(defaultMobileSize(p, p.visuals[0])).toEqual({ width: 160, height: 80 })
    // tiny button: quarter width
    p.visuals.push(vis('btn', 0, 0, 100, 40, { type: 'actionButton' }))
    expect(defaultMobileSize(p, p.visuals[6]).width).toBe(80)
  })

  it('adds a visual with a mobile.json position and stacks new ones below / on top', () => {
    const p = page()
    expect(addToMobile(p, 'chart')).toBe(true)
    expect(p.visuals[3].mobile.$schema).toBe(MOBILE_SCHEMA)
    expect(mobileRect(p.visuals[3])).toEqual({ x: 0, y: 0, width: 320, height: 225, z: 0 })
    addToMobile(p, 'kpi1')
    const k = mobileRect(p.visuals[0])!
    expect(k.y).toBe(225)
    expect(k.z).toBe(1000)
    addToMobile(p, 'kpi2', { x: 153, y: 7 })
    expect(mobileRect(p.visuals[1])).toMatchObject({ x: 155, y: 5 })
    expect(placedVisuals(p).map((v) => v.name)).toEqual(['chart', 'kpi1', 'kpi2'])
    expect(addToMobile(p, 'nope')).toBe(false)
  })

  it('moves / resizes placed visuals and ignores unplaced ones', () => {
    const p = page()
    addToMobile(p, 'chart', { x: 0, y: 0 })
    setMobileRects(p, { chart: { x: 12, y: 33, width: 200, height: 101 }, kpi1: { x: 0, y: 0, width: 50, height: 50 } })
    expect(mobileRect(p.visuals[3])).toMatchObject({ x: 10, y: 35, width: 200, height: 100 })
    expect(isPlaced(p.visuals[0])).toBe(false)
    moveMobileBy(p, ['chart'], 1, 2)
    expect(mobileRect(p.visuals[3])).toMatchObject({ x: 11, y: 37 })
    // can't leave the canvas
    moveMobileBy(p, ['chart'], 500, -500)
    expect(mobileRect(p.visuals[3])).toMatchObject({ x: 120, y: 0 })
  })

  it('moveMobileRect / resizeMobile snap only when asked and keep opposite edges', () => {
    expect(moveMobileRect({ x: 0, y: 0, width: 100, height: 50 }, 7, 13, true)).toEqual({ x: 5, y: 15, width: 100, height: 50 })
    expect(moveMobileRect({ x: 0, y: 0, width: 100, height: 50 }, 7, 13, false)).toEqual({ x: 7, y: 13, width: 100, height: 50 })
    const r = resizeMobile({ x: 20, y: 20, width: 100, height: 100 }, 'se', 13, 8, false, true)
    expect(r).toEqual({ x: 20, y: 20, width: 115, height: 110 })
    const w = resizeMobile({ x: 20, y: 20, width: 100, height: 100 }, 'w', -8, 0, false, true)
    expect(w.x + w.width).toBe(120)
    expect(w.x).toBe(10)
    // never wider than the phone
    expect(resizeMobile({ x: 200, y: 0, width: 100, height: 100 }, 'e', 500, 0, false, true).width).toBe(120)
    // Shift keeps the aspect ratio
    const a = resizeMobile({ x: 0, y: 0, width: 100, height: 50 }, 'se', 100, 0, true, true)
    expect(a.width / a.height).toBeCloseTo(2)
  })

  it('removes visuals from the phone canvas only (mobile.json deleted, desktop untouched)', () => {
    const p = page()
    addToMobile(p, 'chart')
    addToMobile(p, 'kpi1')
    const desk = structuredClone(p.visuals[3].json)
    removeFromMobile(p, ['chart'])
    expect(p.visuals[3].mobile).toBeUndefined()
    expect(p.visuals[3].json).toEqual(desk)
    expect(isPlaced(p.visuals[0])).toBe(true)
    clearMobile(p)
    expect(p.visuals.some((v) => v.mobile !== undefined)).toBe(false)
  })

  it('reorders layers', () => {
    const p = page()
    addToMobile(p, 'chart')
    addToMobile(p, 'kpi1')
    addToMobile(p, 'kpi2')
    reorderMobile(p, ['kpi2'], 'back')
    expect(placedVisuals(p).map((v) => v.name)).toEqual(['kpi2', 'chart', 'kpi1'])
    reorderMobile(p, ['kpi2'], 'front')
    expect(placedVisuals(p).map((v) => v.name)).toEqual(['chart', 'kpi1', 'kpi2'])
  })

  it('canvas height grows with content, at least one phone screen', () => {
    const p = page()
    expect(mobileCanvasHeight(p)).toBe(MOBILE_MIN_HEIGHT)
    addToMobile(p, 'chart', { x: 0, y: 600 })
    expect(mobileCanvasHeight(p)).toBeGreaterThanOrEqual(750 + 100)
  })

  it('auto-create flows rows in reading order, packing narrow visuals side by side, skipping hidden ones', () => {
    const p = page()
    addToMobile(p, 'hiddenOne')
    const names = autoCreateMobile(p)
    expect(names).toEqual(['kpi1', 'kpi2', 'kpi3', 'chart', 'table'])
    expect(isPlaced(p.visuals[5])).toBe(false)
    const r = (n: string) => mobileRect(p.visuals.find((v) => v.name === n))!
    // two half-width cards per row, the third wraps
    expect(r('kpi1')).toMatchObject({ x: 0, y: 0 })
    expect(r('kpi2')).toMatchObject({ x: 160, y: 0 })
    expect(r('kpi3')).toMatchObject({ x: 0, y: 80 })
    expect(r('chart')).toMatchObject({ x: 0, y: 160, width: 320 })
    expect(r('table').y).toBe(r('chart').y + r('chart').height)
    // no overlaps
    const rects = names.map(r)
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]
        const b = rects[j]
        expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false)
      }
  })

  it('auto-create keeps a decorative header shape as a backdrop behind its contents', () => {
    const p = page()
    for (const v of p.visuals) v.json.position.y += 100
    p.visuals.push(vis('band', 0, 0, 1280, 90, { type: 'shape' }))
    p.visuals.push(vis('title', 10, 10, 400, 40, { type: 'textbox' }))
    p.visuals.push(vis('slicer', 900, 10, 300, 60, { type: 'slicer' }))
    const names = autoCreateMobile(p)
    const r = (n: string) => mobileRect(p.visuals.find((v) => v.name === n))!
    expect(names.slice(0, 3)).toEqual(['title', 'slicer', 'band'])
    expect(r('band')).toMatchObject({ x: 0, y: 0, width: 320 })
    // backdrop covers its flowed contents and sits one layer below them
    for (const n of ['title', 'slicer']) {
      expect(r(n).y + r(n).height).toBeLessThanOrEqual(r('band').height)
      expect(r(n).z).toBeGreaterThan(r('band').z)
    }
    // the next band starts below the backdrop
    expect(r('kpi1').y).toBe(r('band').height)
  })

  it('lists only top-level items; groups scale their children into the mobile rect', () => {
    const p = page()
    p.visuals.push({ name: 'g', json: { name: 'g', position: { x: 100, y: 600, z: 0, width: 200, height: 100 }, visualGroup: { displayName: 'G', groupMode: 'ScaleMode' } } })
    p.visuals.push({ name: 'c1', json: { name: 'c1', parentGroupName: 'g', position: { x: 0, y: 0, z: 0, width: 100, height: 100 }, visual: { visualType: 'card' } } })
    p.visuals.push({ name: 'c2', json: { name: 'c2', parentGroupName: 'g', position: { x: 100, y: 0, z: 1000, width: 100, height: 100 }, visual: { visualType: 'card' } } })
    const items = pageVisualItems(p).map((v) => v.name)
    expect(items).toContain('g')
    expect(items).not.toContain('c1')
    expect(addToMobile(p, 'c1')).toBe(false)
    const kids = groupChildrenRects(p, p.visuals.find((v) => v.name === 'g')!, { x: 0, y: 0, width: 320, height: 160 })
    expect(kids.map((k) => k.rect)).toEqual([
      { x: 0, y: 0, width: 160, height: 160 },
      { x: 160, y: 0, width: 160, height: 160 }
    ])
  })

  it('applies mobile formatting overrides over visual.json objects', () => {
    const v = vis('a', 0, 0, 10, 10, {
      json: { visual: { visualType: 'card', objects: { labels: [{ properties: { fontSize: 1 } }], categoryLabels: [{ properties: { show: true } }] } } },
      mobile: { position: { x: 0, y: 0, z: 0, width: 10, height: 10 }, objects: { labels: [{ properties: { fontSize: 2 } }] }, visualContainerObjects: { title: [{ properties: { show: false } }] } }
    })
    const j = mobileVisualJson(v)
    expect(j.visual.objects.labels[0].properties.fontSize).toBe(2)
    expect(j.visual.objects.categoryLabels).toBeDefined()
    expect(j.visual.visualContainerObjects.title[0].properties.show).toBe(false)
    // desktop json untouched; no overrides → same object
    expect(v.json.visual.objects.labels[0].properties.fontSize).toBe(1)
    const plain = vis('b', 0, 0, 1, 1)
    expect(mobileVisualJson(plain)).toBe(plain.json)
  })
})

describe('mobile layout persistence', () => {
  it('pbirToFiles writes mobile.json for placed visuals only', async () => {
    const { pbirToFiles } = await import('@core/pbir/pbir')
    const { emptyReport } = await import('@core/report/types')
    const report = emptyReport()
    const p = page()
    report.pages = [p]
    report.pagesMeta.pageOrder = [p.name]
    addToMobile(p, 'chart')
    const files = pbirToFiles(report)
    const mobile = JSON.parse(files['definition/pages/p1/visuals/chart/mobile.json'] as string)
    expect(mobile.$schema).toBe(MOBILE_SCHEMA)
    expect(mobile.position).toMatchObject({ x: 0, y: 0, width: 320, height: 225 })
    expect(files['definition/pages/p1/visuals/kpi1/mobile.json']).toBeUndefined()
    removeFromMobile(p, ['chart'])
    expect(pbirToFiles(report)['definition/pages/p1/visuals/chart/mobile.json']).toBeUndefined()
  })
})
