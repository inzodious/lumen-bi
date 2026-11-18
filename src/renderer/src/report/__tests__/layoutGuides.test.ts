import { describe, expect, it } from 'vitest'
import { LUMEN_LAYOUT_OBJECT, readLayoutGuides, writeLayoutGuides } from '../layoutGuides'

const baseReport = () => ({
  $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.0.0/schema.json',
  themeCollection: { baseTheme: { name: 'CY24SU10', type: 'SharedResources' } },
  settings: { useStylableVisualContainerHeader: true }
})

describe('layout guides in report.json', () => {
  it('absent → none; untouched report is not modified', () => {
    const r = baseReport()
    const before = JSON.stringify(r)
    expect(readLayoutGuides(r)).toEqual({ margin: 0, gutter: 0 })
    expect(writeLayoutGuides(r, { margin: 0, gutter: 0 })).toBe(false)
    expect(JSON.stringify(r)).toBe(before)
  })

  it('round-trips non-default values as a Lumen-only report object', () => {
    const r: any = baseReport()
    expect(writeLayoutGuides(r, { margin: 16, gutter: 8 })).toBe(true)
    expect(r.objects[LUMEN_LAYOUT_OBJECT]).toEqual([{ properties: { margin: { expr: { Literal: { Value: '16D' } } }, gutter: { expr: { Literal: { Value: '8D' } } } } }])
    expect(readLayoutGuides(r)).toEqual({ margin: 16, gutter: 8 })
    // same values again: no change
    expect(writeLayoutGuides(r, { margin: 16, gutter: 8 })).toBe(false)
    // only the non-zero property is stored
    writeLayoutGuides(r, { margin: 0, gutter: 12 })
    expect(Object.keys(r.objects[LUMEN_LAYOUT_OBJECT][0].properties)).toEqual(['gutter'])
    expect(readLayoutGuides(r)).toEqual({ margin: 0, gutter: 12 })
  })

  it('back to none restores the original JSON byte-for-byte (empty objects map removed)', () => {
    const r: any = baseReport()
    const before = JSON.stringify(r)
    writeLayoutGuides(r, { margin: 24, gutter: 16 })
    writeLayoutGuides(r, { margin: 0, gutter: 0 })
    expect(JSON.stringify(r)).toBe(before)
  })

  it('keeps other report objects when clearing', () => {
    const r: any = { ...baseReport(), objects: { section: [{ properties: { verticalAlignment: { expr: { Literal: { Value: "'Top'" } } } } }] } }
    writeLayoutGuides(r, { margin: 8, gutter: 8 })
    writeLayoutGuides(r, { margin: 0, gutter: 0 })
    expect(Object.keys(r.objects)).toEqual(['section'])
  })

  it('ignores malformed values', () => {
    expect(readLayoutGuides({ objects: { [LUMEN_LAYOUT_OBJECT]: [{ properties: { margin: { expr: { Literal: { Value: "'x'" } } }, gutter: {} } }] } })).toEqual({ margin: 0, gutter: 0 })
  })
})
