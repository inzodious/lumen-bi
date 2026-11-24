/**
 * PBIR -> legacy layout (toLegacy.ts) against the legacy reader (legacy.ts):
 *  - invented layouts and reports cover every mapped key;
 *  - with LUMEN_SAMPLES_DIR, every Microsoft sample's `Report/Layout` converts to PBIR, back to a layout and to PBIR
 *    again with an identical result, and an unchanged report written with its source layout as base reproduces the
 *    source layout exactly (parsed JSON equality, strings included).
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { convertLegacyLayout } from '../legacy'
import { reportToLegacyLayout } from '../toLegacy'
import { applyLegacy } from '../pbir'
import { emptyReport, type ReportDocument } from '../../report/types'
import { cloneDeep } from '../../clone'

function docFromLayout(layout: any): ReportDocument {
  const doc: ReportDocument = { ...emptyReport(), origin: 'pbix-legacy', diagnostics: [] }
  applyLegacy(doc, cloneDeep(layout))
  return doc
}

function conv(layout: any) {
  const c = convertLegacyLayout(cloneDeep(layout))
  return { report: c.report, pagesMeta: c.pagesMeta, pages: c.pages.map((p) => ({ ...p, visuals: [...p.visuals].sort((a, b) => (a.name < b.name ? -1 : 1)) })), bookmarks: c.bookmarks, bookmarksMeta: c.bookmarksMeta, reportExtensions: c.reportExtensions }
}

/** Parse every JSON-string member (config / filters / query / dataTransforms / parameters) for comparison. */
function deepParse(v: any): any {
  if (typeof v === 'string' && /^[[{]/.test(v)) {
    try {
      return deepParse(JSON.parse(v))
    } catch {
      return v
    }
  }
  if (Array.isArray(v)) return v.map(deepParse)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepParse(x)]))
  return v
}

const ref = (e: string, p: string, kind = 'Column') => ({ [kind]: { Expression: { SourceRef: { Source: e } }, Property: p } })

const LAYOUT = {
  id: 0,
  theme: 'Custom.json',
  filters: JSON.stringify([{ name: 'F0', expression: { Column: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: 'Region' } }, type: 'Categorical', howCreated: 1 }]),
  resourcePackages: [
    { resourcePackage: { name: 'SharedResources', type: 2, items: [{ type: 202, path: 'BaseThemes/CY24SU10.json', name: 'CY24SU10' }], disabled: false } },
    { resourcePackage: { name: 'RegisteredResources', type: 1, items: [{ type: 201, path: 'Custom.json', name: 'Custom.json' }], disabled: false } }
  ],
  sections: [
    {
      id: 0,
      name: 'ReportSection1',
      displayName: 'Overview',
      filters: '[]',
      ordinal: 0,
      visualContainers: [
        {
          x: 10,
          y: 20,
          z: 0,
          width: 300,
          height: 200,
          tabOrder: 0,
          config: JSON.stringify({
            name: 'v1',
            layouts: [{ id: 0, position: { x: 10, y: 20, z: 0, width: 300, height: 200, tabOrder: 0 } }],
            singleVisual: {
              visualType: 'clusteredColumnChart',
              projections: { Category: [{ queryRef: 'Sales.Region', active: true }], Y: [{ queryRef: 'Sales.Total' }] },
              prototypeQuery: {
                Version: 2,
                From: [{ Name: 's', Entity: 'Sales', Type: 0 }],
                Select: [
                  { ...ref('s', 'Region'), Name: 'Sales.Region', NativeReferenceName: 'Region' },
                  { ...ref('s', 'Total', 'Measure'), Name: 'Sales.Total' }
                ],
                OrderBy: [{ Direction: 2, Expression: ref('s', 'Total', 'Measure') }]
              },
              columnProperties: { 'Sales.Total': { displayName: 'Revenue' } },
              drillFilterOtherVisuals: true,
              hasDefaultSort: true,
              objects: { legend: [{ properties: { show: { expr: { Literal: { Value: 'true' } } } } }] },
              vcObjects: { title: [{ properties: { text: { expr: { Literal: { Value: "'Hello'" } } } } }] }
            }
          }),
          filters: '[]',
          query: '{"Commands":[]}',
          dataTransforms: '{}'
        },
        {
          x: 0,
          y: 0,
          z: 1,
          width: 50,
          height: 50,
          config: JSON.stringify({ name: 'g1', layouts: [{ id: 0, position: { x: 0, y: 0, z: 1, width: 50, height: 50 } }, { id: 1, position: { x: 1, y: 2, z: 0, width: 3, height: 4 } }], singleVisualGroup: { displayName: 'Group', groupMode: 1, isHidden: true } }),
          filters: '[]'
        }
      ],
      config: JSON.stringify({ relationships: [{ source: 'v1', target: 'g1', type: 3 }], visibility: 1 }),
      displayOption: 1,
      width: 1280,
      height: 720
    },
    { id: 1, name: 'ReportSection2', displayName: 'Details', filters: '[]', ordinal: 1, visualContainers: [], config: JSON.stringify({ type: 2 }), displayOption: 2, width: 1280, height: 720 }
  ],
  pods: [{ name: 'Pod', boundSection: 'ReportSection2', config: '{"acceptsFilterContext":1}', parameters: '[{"name":"P","boundFilter":"F","fieldExpr":{"Column":{"Expression":{"SourceRef":{"Entity":"Sales"}},"Property":"Region"}}}]', type: 1 }],
  config: JSON.stringify({
    version: '5.61',
    themeCollection: { baseTheme: { name: 'CY24SU10', version: '5.61', type: 2 }, customTheme: { name: 'Custom.json', version: '5.61', type: 1 } },
    activeSectionIndex: 1,
    bookmarks: [{ displayName: 'B1', name: 'Bookmark1', explorationState: { version: '1.3', activeSection: 'ReportSection1', sections: {} }, options: { targetVisualNames: [] } }],
    defaultDrillFilterOtherVisuals: true,
    linguisticSchemaSyncVersion: 2,
    settings: { useNewFilterPaneExperience: true, allowChangeFilterTypes: true, exportDataMode: 1, queryLimitOption: 6 },
    objects: { outspacePane: [{ properties: { expanded: { expr: { Literal: { Value: 'false' } } } } }] }
  }),
  layoutOptimization: 0,
  publicCustomVisuals: []
}

describe('reportToLegacyLayout', () => {
  it('round-trips an invented layout through PBIR', () => {
    const doc = docFromLayout(LAYOUT)
    const { layout, diagnostics } = reportToLegacyLayout(doc)
    expect(diagnostics).toEqual([])
    expect(conv(layout)).toEqual(conv(LAYOUT))
    // Desktop's enum numbers and string-typed members
    const v = JSON.parse(layout.sections[0].visualContainers.find((c: any) => JSON.parse(c.config).name === 'v1').config)
    expect(v.singleVisual.prototypeQuery.From).toEqual([{ Name: 's', Entity: 'Sales', Type: 0 }])
    expect(v.singleVisual.prototypeQuery.OrderBy[0].Direction).toBe(2)
    expect(JSON.parse(layout.filters)[0].howCreated).toBe(1)
    expect(layout.sections[1].displayOption).toBe(2)
    expect(JSON.parse(layout.config).settings.exportDataMode).toBe(1)
    expect(layout.resourcePackages[0].resourcePackage.type).toBe(2)
    // a new layout carries no cached queries
    expect(layout.sections[0].visualContainers.some((c: any) => c.query)).toBe(false)
  })

  it('reproduces an unchanged source layout exactly when given as base', () => {
    const doc = docFromLayout(LAYOUT)
    const { layout } = reportToLegacyLayout(doc, LAYOUT)
    expect(deepParse(layout)).toEqual(deepParse(LAYOUT))
    expect(layout.sections[0].visualContainers[0]).toBe(LAYOUT.sections[0].visualContainers[0])
  })

  it('rewrites only the edited visual and drops its stale cached query', () => {
    const doc = docFromLayout(LAYOUT)
    const v = doc.pages[0].visuals.find((x) => x.name === 'v1')!
    v.json.visual.visualContainerObjects.title[0].properties.text.expr.Literal.Value = "'Changed'"
    const { layout } = reportToLegacyLayout(doc, LAYOUT)
    const vc = layout.sections[0].visualContainers[0]
    expect(vc.query).toBeUndefined()
    expect(JSON.parse(vc.config).singleVisual.vcObjects.title[0].properties.text.expr.Literal.Value).toBe("'Changed'")
    expect(layout.sections[0].visualContainers[1]).toBe(LAYOUT.sections[0].visualContainers[1])
    expect(layout.sections[1]).toBe(LAYOUT.sections[1])
    expect(JSON.parse(layout.config).linguisticSchemaSyncVersion).toBe(2)
  })

  it('writes a new PBIR report (no base) with the current filter pane and a base theme', () => {
    const doc = emptyReport()
    doc.pages[0].visuals.push({
      name: 'card1',
      json: {
        name: 'card1',
        position: { x: 0, y: 0, z: 0, width: 100, height: 100 },
        visual: { visualType: 'card', query: { queryState: { Values: { projections: [{ field: { Measure: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: 'Total' } }, queryRef: 'Sales.Total' }] } } } }
      }
    })
    const { layout } = reportToLegacyLayout(doc)
    const cfg = JSON.parse(layout.config)
    expect(cfg.settings.useNewFilterPaneExperience).toBe(true)
    expect(cfg.themeCollection.baseTheme).toMatchObject({ name: 'CY24SU10', type: 2 })
    const back = conv(layout)
    expect(back.pages[0].visuals[0].json.visual).toEqual(doc.pages[0].visuals[0].json.visual)
  })
})

const DIR = process.env.LUMEN_SAMPLES_DIR
const samples = DIR && existsSync(DIR) ? readdirSync(DIR).filter((f) => /\.pbi[xt]$/i.test(f)).sort() : []

describe.skipIf(!samples.length)('reportToLegacyLayout on the Microsoft samples', () => {
  for (const f of samples) {
    it(`round-trips the layout of ${f}`, () => {
      const entries = unzipSync(new Uint8Array(readFileSync(join(DIR!, f))), { filter: (e) => e.name === 'Report/Layout' })
      const text = new TextDecoder('utf-16le').decode(entries['Report/Layout']).replace(/^﻿/, '')
      const source = JSON.parse(text)
      const doc = docFromLayout(source)
      const fresh = reportToLegacyLayout(doc)
      expect(conv(fresh.layout)).toEqual(conv(source))
      const based = reportToLegacyLayout(doc, source)
      expect(deepParse(based.layout)).toEqual(deepParse(source))
    })
  }
})
