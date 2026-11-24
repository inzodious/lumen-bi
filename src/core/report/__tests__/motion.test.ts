import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REPORT_MOTION,
  MOTION_ANNOTATION,
  entranceDelay,
  isPinned,
  motionFamily,
  motionSummary,
  morphPairs,
  visualMatchKey,
  pageMotion,
  pageTransition,
  readingOrder,
  reportMotion,
  setPageMotion,
  setReportMotion,
  setVisualMotion,
  stripMotion,
  visualMotion
} from '../motion'

const annotated = (value: unknown) => ({ annotations: [{ name: MOTION_ANNOTATION, value: JSON.stringify(value) }] })

describe('report motion', () => {
  it('defaults to animated visuals and no page transition', () => {
    expect(reportMotion(undefined)).toEqual(DEFAULT_REPORT_MOTION)
    expect(reportMotion({})).toEqual({ animate: true, duration: 500, stagger: 0, transition: 'none', transitionDuration: 350, drillthrough: 'zoom', bookmarks: 'morph' })
  })

  it('reads, clamps and ignores invalid values', () => {
    expect(reportMotion(annotated({ animate: false, duration: 99999, stagger: -5, transition: 'spin', transitionDuration: 420.4, drillthrough: 'fly', bookmarks: 'none' }))).toEqual({
      animate: false,
      duration: 2000,
      stagger: 0,
      transition: 'none',
      transitionDuration: 420,
      drillthrough: 'zoom',
      bookmarks: 'none'
    })
    expect(reportMotion(annotated({ transition: 'circle', drillthrough: 'page' }))).toMatchObject({ transition: 'circle', drillthrough: 'page' })
    expect(reportMotion({ annotations: [{ name: MOTION_ANNOTATION, value: '{not json' }] })).toEqual(DEFAULT_REPORT_MOTION)
  })

  it('stores only what differs from the defaults and removes the annotation when nothing is left', () => {
    const json: any = { annotations: [{ name: 'Lumen_SampleData', value: 'on' }] }
    setReportMotion(json, { transition: 'fade', duration: 500 })
    expect(json.annotations).toEqual([{ name: 'Lumen_SampleData', value: 'on' }, { name: MOTION_ANNOTATION, value: '{"transition":"fade"}' }])
    setReportMotion(json, { transition: 'none' })
    expect(json.annotations).toEqual([{ name: 'Lumen_SampleData', value: 'on' }])
    const bare: any = {}
    setReportMotion(bare, { animate: true })
    expect(bare.annotations).toBeUndefined()
  })

  it('keeps keys written by a newer Lumen', () => {
    const json: any = annotated({ future: 1, stagger: 40 })
    setReportMotion(json, { stagger: 0 })
    expect(JSON.parse(json.annotations[0].value)).toEqual({ future: 1 })
  })
})

describe('page motion', () => {
  it('overrides the report default', () => {
    const report = annotated({ transition: 'slide' })
    const page: any = {}
    expect(pageTransition(report, page)).toBe('slide')
    setPageMotion(page, { transition: 'zoom' })
    expect(pageMotion(page)).toEqual({ transition: 'zoom' })
    expect(pageTransition(report, page)).toBe('zoom')
    setPageMotion(page, { transition: 'none' })
    expect(pageTransition(report, page)).toBe('none')
    setPageMotion(page, {})
    expect(page.annotations).toBeUndefined()
    expect(pageTransition(report, page)).toBe('slide')
  })
})

describe('visual motion', () => {
  it('reads and writes entrance and delay', () => {
    const v: any = {}
    expect(visualMotion(v)).toEqual({})
    setVisualMotion(v, { entrance: 'rise', delay: 120 })
    expect(visualMotion(v)).toEqual({ entrance: 'rise', delay: 120 })
    setVisualMotion(v, { delay: 99999 })
    expect(visualMotion(v)).toEqual({ entrance: 'rise', delay: 3000 })
    setVisualMotion(v, { entrance: 'auto', delay: 0 })
    expect(v.annotations).toBeUndefined()
  })

  it('adds the report stagger in reading order', () => {
    const m = { ...DEFAULT_REPORT_MOTION, stagger: 50 }
    expect(entranceDelay(m, {}, 0)).toBe(0)
    expect(entranceDelay(m, { delay: 100 }, 3)).toBe(250)
  })

  it('orders visuals by rows, then left to right', () => {
    const order = readingOrder([
      { name: 'right', x: 600, y: 10 },
      { name: 'below', x: 0, y: 300 },
      { name: 'left', x: 0, y: 25 }
    ])
    expect([...order.entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n)).toEqual(['left', 'right', 'below'])
  })

  it('classifies visual types', () => {
    expect(motionFamily('clusteredColumnChart')).toBe('marks')
    expect(motionFamily('donutChart')).toBe('marks')
    expect(motionFamily('cardVisual')).toBe('marks')
    expect(motionFamily('tableEx')).toBe('fade')
    expect(motionFamily('pivotTable')).toBe('fade')
    expect(motionFamily('slicer')).toBe('still')
    expect(motionFamily('textbox')).toBe('still')
    expect(motionFamily('actionButton')).toBe('still')
  })
})

describe('publishing', () => {
  const report = () => ({
    report: annotated({ transition: 'fade' }),
    pages: [
      { json: {}, visuals: [{ json: annotated({ entrance: 'zoom' }) }] },
      { json: annotated({ transition: 'slide' }), visuals: [] },
      { json: annotated({ transition: 'none' }), visuals: [] }
    ]
  })

  it('summarises what moves', () => {
    expect(motionSummary(report())).toEqual({ animate: true, transitions: ['fade', 'slide'] })
  })

  it('strips every setting and turns animations off', () => {
    const r: any = report()
    stripMotion(r)
    expect(reportMotion(r.report)).toMatchObject({ animate: false, drillthrough: 'page', bookmarks: 'none' })
    expect(motionSummary(r)).toEqual({ animate: false, transitions: [] })
    expect(r.pages.every((p: any) => !p.json.annotations && p.visuals.every((v: any) => !v.json.annotations))).toBe(true)
  })
})

describe('morph pairs', () => {
  const visual = (name: string, type: string, refs: string[], title?: string) => ({
    name,
    json: {
      visual: {
        visualType: type,
        query: { queryState: { Values: { projections: refs.map((queryRef) => ({ queryRef })) } } },
        ...(title ? { visualContainerObjects: { title: [{ properties: { text: { expr: { Literal: { Value: `'${title}'` } } } } }] } } : {})
      }
    }
  })

  it('matches visuals by type, fields and title', () => {
    expect(visualMatchKey(visual('a', 'card', ['m.Sales']).json)).toBe(visualMatchKey(visual('b', 'card', ['m.Sales']).json))
    expect(visualMatchKey(visual('a', 'card', ['m.Sales']).json)).not.toBe(visualMatchKey(visual('b', 'card', ['m.Cost']).json))
    expect(visualMatchKey(visual('a', 'card', ['m.Sales'], 'Sales').json)).not.toBe(visualMatchKey(visual('b', 'card', ['m.Sales']).json))
    expect(visualMatchKey({ visual: { visualType: 'shape' } })).toBeUndefined()
    expect(visualMatchKey(undefined)).toBeUndefined()
  })

  it('pairs keys found once on each page', () => {
    const from = [visual('k1', 'card', ['m.Sales']), visual('k2', 'card', ['m.Cost']), visual('d1', 'card', ['m.Units']), visual('d2', 'card', ['m.Units'])]
    const to = [visual('n1', 'card', ['m.Sales']), visual('n2', 'lineChart', ['m.Cost']), visual('n3', 'card', ['m.Units'])]
    expect([...morphPairs(from, to)]).toEqual([['k1', 'n1']])
  })
})

describe('pinned visuals', () => {
  it('reads, sets and clears the pinned switch, keeping the other settings', () => {
    const v: any = annotated({ entrance: 'rise', delay: 100 })
    setVisualMotion(v, { pinned: true })
    expect(visualMotion(v)).toEqual({ entrance: 'rise', delay: 100, pinned: true })
    setVisualMotion(v, { pinned: false })
    expect(visualMotion(v)).toEqual({ entrance: 'rise', delay: 100 })
    expect(visualMotion(annotated({ pinned: 'yes' }))).toEqual({})
  })

  it('pins the children of a pinned group', () => {
    const visuals = [
      { name: 'rail', json: { visualGroup: {}, ...annotated({ pinned: true }) } },
      { name: 'nav', json: { parentGroupName: 'rail', visual: {} } },
      { name: 'chart', json: { visual: {} } },
      { name: 'logo', json: { visual: {}, ...annotated({ pinned: true }) } }
    ]
    expect(visuals.map((v) => isPinned(visuals, v.name))).toEqual([true, true, false, true])
    expect(isPinned(visuals, 'missing')).toBe(false)
  })

  it('leaves pinned visuals out of morph pairs (they hold still)', () => {
    const card = (name: string, pinned = false) => ({ name, json: { visual: { visualType: 'card', query: { queryState: { Values: { projections: [{ queryRef: 'm.Sales' }] } } } }, ...(pinned ? annotated({ pinned: true }) : {}) } })
    expect([...morphPairs([card('a')], [card('b')])]).toEqual([['a', 'b']])
    expect([...morphPairs([card('a', true)], [card('b', true)])]).toEqual([])
  })
})
