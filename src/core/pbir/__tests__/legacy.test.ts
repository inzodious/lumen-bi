import { describe, expect, it } from 'vitest'
import { convertLegacyLayout } from '../legacy'
import { pbirToFiles, readPbirFiles } from '../pbir'
import { findResource, mimeFromPath, resourceDataUrl, resourcePathForItem } from '../resources'

const col = (src: string, prop: string) => ({ Column: { Expression: { SourceRef: { Source: src } }, Property: prop } })
const msr = (src: string, prop: string) => ({ Measure: { Expression: { SourceRef: { Source: src } }, Property: prop } })

const chartConfig = {
  name: 'chart1',
  layouts: [
    { id: 0, position: { x: 10, y: 20, z: 1000, width: 400, height: 300, tabOrder: 1000 } },
    { id: 1, position: { x: 0, y: 0, z: 0, width: 320, height: 200 } }
  ],
  singleVisual: {
    visualType: 'clusteredColumnChart',
    projections: {
      Category: [{ queryRef: 'Product.Category', active: true }],
      Y: [{ queryRef: 'Sales.Total Sales' }, { queryRef: 'Sum(Sales.Qty)' }]
    },
    prototypeQuery: {
      Version: 2,
      From: [
        { Name: 'p', Entity: 'Product', Type: 0 },
        { Name: 's', Entity: 'Sales', Type: 0 }
      ],
      Select: [
        { ...col('p', 'Category'), Name: 'Product.Category', NativeReferenceName: 'Category' },
        { ...msr('s', 'Total Sales'), Name: 'Sales.Total Sales', NativeReferenceName: 'Total Sales' },
        { Aggregation: { Expression: col('s', 'Qty'), Function: 0 }, Name: 'Sum(Sales.Qty)', NativeReferenceName: 'Sum of Qty' }
      ],
      OrderBy: [{ Direction: 2, Expression: msr('s', 'Total Sales') }]
    },
    columnProperties: { 'Sales.Total Sales': { displayName: 'Revenue' } },
    drillFilterOtherVisuals: true,
    hasDefaultSort: true,
    objects: { labels: [{ properties: { show: { expr: { Literal: { Value: 'true' } } } } }] },
    vcObjects: { title: [{ properties: { text: { expr: { Literal: { Value: "'Sales by category'" } } } } }] },
    cachedFilterDisplayItems: []
  },
  parentGroupName: 'group1'
}

const layout = {
  id: 0,
  theme: 'Custom1234.json',
  filters: JSON.stringify([
    {
      name: 'Filter1',
      expression: { Column: { Expression: { SourceRef: { Entity: 'Product' } }, Property: 'Color' } },
      type: 'Categorical',
      howCreated: 1,
      isLockedInViewMode: true
    }
  ]),
  resourcePackages: [
    { resourcePackage: { name: 'SharedResources', type: 2, items: [{ type: 202, path: 'BaseThemes/CY24SU10.json', name: 'CY24SU10' }], disabled: false } },
    {
      resourcePackage: {
        name: 'RegisteredResources',
        type: 1,
        items: [
          { type: 201, path: 'Custom1234.json', name: 'Custom1234.json' },
          { type: 100, path: 'logo5678.png', name: 'logo5678.png' }
        ],
        disabled: false
      }
    }
  ],
  pods: [
    {
      name: 'Pod',
      boundSection: 'ReportSection2',
      parameters: JSON.stringify([{ name: 'Param_Filter9', boundFilter: 'Filter9', fieldExpr: { Column: { Expression: { SourceRef: { Entity: 'Product' } }, Property: 'Category' } } }]),
      config: '{}'
    }
  ],
  sections: [
    {
      name: 'ReportSection2',
      displayName: 'Details',
      ordinal: 1,
      displayOption: 1,
      width: 1280,
      height: 720,
      config: JSON.stringify({ type: 2 }),
      filters: JSON.stringify([
        { name: 'Filter9', expression: { Column: { Expression: { SourceRef: { Entity: 'Product' } }, Property: 'Category' } }, type: 'Categorical', howCreated: 5 }
      ]),
      visualContainers: []
    },
    {
      name: 'ReportSection1',
      displayName: 'Overview',
      ordinal: 0,
      displayOption: 2,
      width: 1280,
      height: 720,
      config: JSON.stringify({
        visibility: 1,
        objects: { background: [{ properties: { transparency: { expr: { Literal: { Value: '0D' } } } } }] },
        relationships: [{ source: 'chart1', target: 'card1', type: 3 }]
      }),
      filters: '[]',
      visualContainers: [
        { x: 10, y: 20, z: 1000, width: 400, height: 300, config: JSON.stringify(chartConfig), filters: JSON.stringify([{ name: 'F2', expression: msr('s', 'Total Sales'), type: 'Advanced', howCreated: 0 }]) },
        {
          x: 0,
          y: 0,
          z: 0,
          width: 500,
          height: 400,
          config: JSON.stringify({ name: 'group1', layouts: [{ id: 0, position: { x: 0, y: 0, z: 0, width: 500, height: 400 } }], singleVisualGroup: { displayName: 'Group', groupMode: 1, isHidden: true } })
        },
        {
          x: 600,
          y: 0,
          z: 2000,
          width: 200,
          height: 100,
          config: JSON.stringify({
            name: 'card1',
            layouts: [{ id: 0, position: { x: 600, y: 0, z: 2000, width: 200, height: 100 } }],
            singleVisual: {
              visualType: 'card',
              projections: { Values: [{ queryRef: 'Sales.Total Sales' }] },
              prototypeQuery: { Version: 2, From: [{ Name: 's', Entity: 'Sales', Type: 0 }], Select: [{ ...msr('s', 'Total Sales'), Name: 'Sales.Total Sales' }] },
              display: { mode: 'hidden' }
            }
          })
        }
      ]
    }
  ],
  config: JSON.stringify({
    version: '5.43',
    themeCollection: { baseTheme: { name: 'CY24SU10', version: { visual: '1.8.97', report: '2.0.97', page: '1.3.97' }, type: 2 }, customTheme: { name: 'Custom1234.json', version: '5.43', type: 1 } },
    activeSectionIndex: 1,
    defaultDrillFilterOtherVisuals: true,
    settings: { useStylableVisualContainerHeader: true, exportDataMode: 1, queryLimitOption: 6, useNewFilterPaneExperience: true },
    objects: { outspacePane: [{ properties: { expanded: { expr: { Literal: { Value: 'false' } } } } }] },
    bookmarks: [
      { displayName: 'Default view', name: 'Bookmark1', explorationState: { version: '1.3', activeSection: 'ReportSection1', sections: { ReportSection1: { visualContainers: {} } } }, options: { suppressData: true } },
      {
        displayName: 'Story',
        name: 'Group1',
        children: [{ displayName: 'Step 1', name: 'Bookmark2', explorationState: { version: '1.3', activeSection: 'ReportSection2', sections: {} } }]
      }
    ],
    modelExtensions: [{ name: 'extension', entities: [{ name: 'Sales', extends: 'Sales', measures: [{ name: 'Report Measure', dataType: 3, expression: 'SUM(Sales[Qty]) * 2', hidden: false }] }] }]
  }),
  layoutOptimization: 0
}

describe('legacy layout -> PBIR', () => {
  const conv = convertLegacyLayout(layout)

  it('converts report-level settings, theme, filters and resources', () => {
    const r = conv.report
    expect(r.themeCollection.baseTheme).toEqual({ name: 'CY24SU10', reportVersionAtImport: { visual: '1.8.97', report: '2.0.97', page: '1.3.97' }, type: 'SharedResources' })
    expect(r.themeCollection.customTheme).toEqual({ name: 'Custom1234.json', reportVersionAtImport: { visual: '1.8.79', report: '2.0.79', page: '1.3.79' }, type: 'RegisteredResources' })
    expect(r.filterConfig.filters).toEqual([
      { name: 'Filter1', field: { Column: { Expression: { SourceRef: { Entity: 'Product' } }, Property: 'Color' } }, type: 'Categorical', howCreated: 'User', isLockedInViewMode: true }
    ])
    expect(r.settings).toEqual({ useStylableVisualContainerHeader: true, exportDataMode: 'AllowSummarized', queryLimitOption: 'Auto', defaultDrillFilterOtherVisuals: true })
    expect(r.resourcePackages[1]).toEqual({
      name: 'RegisteredResources',
      type: 'RegisteredResources',
      items: [
        { name: 'Custom1234.json', path: 'Custom1234.json', type: 'CustomTheme' },
        { name: 'logo5678.png', path: 'logo5678.png', type: 'Image' }
      ]
    })
    expect(r.objects.outspacePane).toBeTruthy()
  })

  it('orders pages by ordinal and converts page properties', () => {
    expect(conv.pagesMeta.pageOrder).toEqual(['ReportSection1', 'ReportSection2'])
    expect(conv.pagesMeta.activePageName).toBe('ReportSection1')
    const [overview, details] = conv.pages.map((p) => p.json)
    expect(overview).toMatchObject({ displayName: 'Overview', displayOption: 'FitToWidth', visibility: 'HiddenInViewMode', visualInteractions: [{ source: 'chart1', target: 'card1', type: 'NoFilter' }] })
    expect(overview.objects.background).toBeTruthy()
    expect(details.type).toBe('Drillthrough')
    expect(details.filterConfig.filters[0].howCreated).toBe('Drillthrough')
    expect(details.pageBinding).toEqual({
      name: 'Pod',
      type: 'Drillthrough',
      parameters: [{ name: 'Param_Filter9', boundFilter: 'Filter9', fieldExpr: { Column: { Expression: { SourceRef: { Entity: 'Product' } }, Property: 'Category' } } }]
    })
  })

  it('converts visual containers', () => {
    const visuals = conv.pages[0].visuals
    const chart = visuals.find((v) => v.name === 'chart1')!
    expect(chart.json.position).toEqual({ x: 10, y: 20, z: 1000, height: 300, width: 400, tabOrder: 1000 })
    expect(chart.json.parentGroupName).toBe('group1')
    expect(chart.mobile?.position).toEqual({ x: 0, y: 0, z: 0, height: 200, width: 320 })
    const v = chart.json.visual
    expect(v.visualType).toBe('clusteredColumnChart')
    expect(v.query.queryState.Category.projections).toEqual([
      { field: { Column: { Expression: { SourceRef: { Entity: 'Product' } }, Property: 'Category' } }, queryRef: 'Product.Category', nativeQueryRef: 'Category', active: true }
    ])
    expect(v.query.queryState.Y.projections[0]).toEqual({
      field: { Measure: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: 'Total Sales' } },
      queryRef: 'Sales.Total Sales',
      nativeQueryRef: 'Total Sales',
      displayName: 'Revenue'
    })
    expect(v.query.queryState.Y.projections[1].field).toEqual({ Aggregation: { Expression: { Column: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: 'Qty' } }, Function: 0 } })
    expect(v.query.sortDefinition).toEqual({ sort: [{ field: { Measure: { Expression: { SourceRef: { Entity: 'Sales' } }, Property: 'Total Sales' } }, direction: 'Descending' }], isDefaultSort: true })
    expect(v.objects.labels).toBeTruthy()
    expect(v.visualContainerObjects.title).toBeTruthy()
    expect(v.drillFilterOtherVisuals).toBe(true)
    expect(chart.json.filterConfig.filters[0]).toMatchObject({ name: 'F2', type: 'Advanced', howCreated: 'Auto' })
    const group = visuals.find((x) => x.name === 'group1')!
    expect(group.json.visualGroup).toEqual({ displayName: 'Group', groupMode: 'ScrollMode' })
    expect(group.json.isHidden).toBe(true)
    expect(visuals.find((x) => x.name === 'card1')!.json.isHidden).toBe(true)
  })

  it('converts bookmarks and report-level measures', () => {
    expect(conv.bookmarksMeta?.items).toEqual([{ name: 'Bookmark1' }, { name: 'Group1', displayName: 'Story', children: ['Bookmark2'] }])
    expect(conv.bookmarks.map((b) => b.name)).toEqual(['Bookmark1', 'Bookmark2'])
    expect(conv.bookmarks[0].json).toMatchObject({ displayName: 'Default view', name: 'Bookmark1', options: { suppressData: true } })
    expect(conv.reportExtensions?.entities[0].measures[0]).toEqual({ name: 'Report Measure', dataType: 'Double', expression: 'SUM(Sales[Qty]) * 2', hidden: false })
  })

  it('round-trips through PBIR files', () => {
    const enc = new TextEncoder()
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const doc = readPbirFiles(
      {
        'report.json': enc.encode(JSON.stringify(layout)),
        'StaticResources/SharedResources/BaseThemes/CY24SU10.json': enc.encode('{"name":"CY24SU10"}'),
        'StaticResources/RegisteredResources/Custom1234.json': enc.encode('{"name":"Custom"}'),
        'StaticResources/RegisteredResources/logo5678.png': png
      },
      'pbir'
    )
    expect(doc.origin).toBe('pbix-legacy')
    expect(doc.theme).toEqual({ base: { name: 'CY24SU10' }, custom: { name: 'Custom' } })
    const ref = { PackageName: 'RegisteredResources', PackageType: 1, ItemName: 'logo5678.png' }
    expect(resourcePathForItem(doc, ref)).toBe('StaticResources/RegisteredResources/logo5678.png')
    const res = findResource(doc, ref)!
    expect(res.mime).toBe('image/png')
    expect(resourceDataUrl(res)).toBe('data:image/png;base64,iVBORw==')
    expect(mimeFromPath('a/b.SVG')).toBe('image/svg+xml')

    const files = pbirToFiles(doc)
    const bytes: Record<string, Uint8Array> = {}
    for (const [p, c] of Object.entries(files)) bytes[p] = typeof c === 'string' ? enc.encode(c) : c
    expect(Object.keys(bytes)).toContain('definition/pages/ReportSection1/visuals/chart1/mobile.json')
    expect(Object.keys(bytes)).toContain('definition/bookmarks/Bookmark2.bookmark.json')
    expect(Object.keys(bytes)).not.toContain('report.json')
    const again = readPbirFiles(bytes, 'pbir')
    expect(again.pages).toEqual(doc.pages)
    expect(again.report).toEqual(doc.report)
    expect(again.bookmarks).toEqual(doc.bookmarks)
    expect(again.bookmarksMeta).toEqual(doc.bookmarksMeta)
    expect(again.reportExtensions).toEqual(doc.reportExtensions)
  })
})

describe('legacy layout: oldest title / background settings', () => {
  const visual = (sv: object) => ({ name: 'v1', layouts: [{ id: 0, position: { x: 0, y: 0, z: 0, width: 100, height: 100 } }], singleVisual: sv })
  const conv = convertLegacyLayout({
    id: 0,
    sections: [
      {
        name: 'ReportSection1',
        displayName: 'P',
        ordinal: 0,
        visualContainers: [
          { config: JSON.stringify(visual({ visualType: 'columnChart', title: { show: true, text: "Sales by Region's month", fontColor: '#000000' }, background: { show: true, color: '#FF0000', transparency: '25' } })) },
          { config: JSON.stringify({ ...visual({ visualType: 'slicer', title: { show: true, text: 'District Manager' }, objects: { header: [{ properties: { show: { expr: { Literal: { Value: 'false' } } } } }] } }), name: 'v2' }) },
          { config: JSON.stringify({ ...visual({ visualType: 'pieChart', title: { show: false }, vcObjects: { title: [{ properties: { text: { expr: { Literal: { Value: "'Modern'" } } } } }] } }), name: 'v3' }) }
        ]
      }
    ]
  })
  const [chart, slicer, pie] = conv.pages[0].visuals.map((v) => v.json.visual)

  it('maps title/background to visualContainerObjects', () => {
    expect(chart.visualContainerObjects.title[0].properties).toEqual({
      show: { expr: { Literal: { Value: 'true' } } },
      text: { expr: { Literal: { Value: "'Sales by Region''s month'" } } },
      fontColor: { solid: { color: { expr: { Literal: { Value: "'#000000'" } } } } }
    })
    expect(chart.visualContainerObjects.background[0].properties.transparency).toEqual({ expr: { Literal: { Value: '25D' } } })
    // slicer: the old title stays a container title (the slicer's own header is off)
    expect(slicer.visualContainerObjects.title[0].properties.text).toEqual({ expr: { Literal: { Value: "'District Manager'" } } })
    expect(slicer.objects.header[0].properties.show).toEqual({ expr: { Literal: { Value: 'false' } } })
    // modern vcObjects win
    expect(pie.visualContainerObjects.title[0].properties.text.expr.Literal.Value).toBe("'Modern'")
    expect(conv.diagnostics.some((d) => /dropped visual settings (title|background)/.test(d))).toBe(false)
  })
})
