/**
 * In-code test fixture for the report canvas: a small sales table with data and a
 * PBIR report exercising pages (normal / drill-through / tooltip / hidden), slicers + sync groups,
 * visual interactions, groups, hidden visuals, unknown visual types, container chrome and filters.
 * Pure (no DOM) — used by unit tests and the `#/canvas-test` dev route. Neutral names only.
 */
import type { ProjectDocument } from '@core/project'
import type { SemanticModel, TableDef, ColumnDef } from '@core/model/types'
import { emptyDataStore, makeDate, tableFromRows, type Scalar } from '@core/model/data'
import type { ReportDocument, VisualDocument, PageDocument } from '@core/report/types'
import { columnExpr, measureExpr, inFilter, type SQExpr } from '@core/report/sq'
import { literalProp } from '@core/report/props'

const col = (name: string, dataType: ColumnDef['dataType']): ColumnDef => ({ name, dataType, kind: 'data', sourceColumn: name })

function table(name: string, columns: ColumnDef[], measures: Array<[string, string, string?]> = []): TableDef {
  return {
    name,
    columns,
    measures: measures.map(([n, e, f]) => ({ name: n, expression: e, formatString: f })),
    hierarchies: [],
    partitions: [{ name, sourceType: 'm', mode: 'import', expression: 'let Source = #table({}, {}) in Source' }]
  }
}

export function fixtureModel(): SemanticModel {
  return {
    name: 'Canvas Fixture',
    culture: 'en-US',
    tables: [
      table(
        'Sales',
        [col('OrderDate', 'dateTime'), col('Product', 'string'), col('Category', 'string'), col('Region', 'string'), col('Amount', 'double'), col('Quantity', 'int64')],
        [
          ['Total Sales', 'SUM(Sales[Amount])', '\\$#,0'],
          ['Total Quantity', 'SUM(Sales[Quantity])', '#,0'],
          ['Order Count', 'COUNTROWS(Sales)', '#,0']
        ]
      )
    ],
    relationships: [],
    expressions: [],
    roles: []
  }
}

const PRODUCTS: Array<[number, string, string]> = [
  [1, 'Road Bike', 'Bikes'],
  [2, 'Mountain Bike', 'Bikes'],
  [3, 'Helmet', 'Accessories'],
  [4, 'Bottle', 'Accessories'],
  [5, 'Jersey', 'Clothing'],
  [6, 'Gloves', 'Clothing'],
  [7, 'Pump', 'Accessories'],
  [8, 'Touring Bike', 'Bikes']
]
const REGIONS = ['North', 'South', 'East', 'West']

/** Deterministic pseudo-random generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function fixtureProject(): ProjectDocument {
  const data = emptyDataStore()
  const rand = rng(42)
  const salesRows: Scalar[][] = []
  for (let i = 0; i < 600; i++) {
    const p = PRODUCTS[Math.floor(rand() * PRODUCTS.length)]
    const price = p[2] === 'Bikes' ? 900 : p[2] === 'Clothing' ? 60 : 25
    const qty = 1 + Math.floor(rand() * 4)
    const month = Math.floor(rand() * 12) + 1
    salesRows.push([makeDate(2024, month, 1 + Math.floor(rand() * 28)), p[1], p[2], REGIONS[Math.floor(rand() * 4)], Math.round(price * qty * (0.8 + rand() * 0.4)), qty])
  }
  data.tables.set('Sales', tableFromRows(['OrderDate', 'Product', 'Category', 'Region', 'Amount', 'Quantity'], ['dateTime', 'string', 'string', 'string', 'double', 'int64'], salesRows))
  for (const t of ['Sales']) data.status.set(t, { state: 'loaded', source: 'synthetic', rowCount: data.tables.get(t)!.rowCount })
  return {
    id: 'canvas-fixture',
    name: 'Canvas Fixture',
    source: { kind: 'new' },
    model: fixtureModel(),
    data,
    report: fixtureReport(),
    diagnostics: [],
    dirty: false
  }
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

const lit = literalProp
const proj = (field: SQExpr, queryRef: string, extra: Record<string, unknown> = {}) => ({ field, queryRef, ...extra })
const CATEGORY = columnExpr('Sales', 'Category')
const PRODUCT = columnExpr('Sales', 'Product')
const REGION = columnExpr('Sales', 'Region')
const SALES = measureExpr('Sales', 'Total Sales')
const QTY = measureExpr('Sales', 'Total Quantity')

let counter = 0
function vname(prefix: string): string {
  counter++
  return (prefix + counter.toString(16)).padEnd(20, '0').slice(0, 20)
}

function visual(
  type: string,
  pos: { x: number; y: number; w: number; h: number; z?: number },
  queryState: Record<string, any[]> | null,
  extra: { title?: string; objects?: any; vco?: any; top?: any; visual?: any; name?: string } = {}
): VisualDocument {
  const name = extra.name ?? vname('a0')
  const vco: any = { ...(extra.vco ?? {}) }
  if (extra.title) vco.title = [{ properties: { show: lit(true), text: lit(extra.title) } }]
  const json: any = {
    $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.4.0/schema.json',
    name,
    position: { x: pos.x, y: pos.y, z: pos.z ?? 0, width: pos.w, height: pos.h, tabOrder: pos.z ?? 0 },
    visual: {
      visualType: type,
      ...(queryState ? { query: { queryState: Object.fromEntries(Object.entries(queryState).map(([k, v]) => [k, { projections: v }])) } } : {}),
      ...(extra.objects ? { objects: extra.objects } : {}),
      ...(Object.keys(vco).length ? { visualContainerObjects: vco } : {}),
      drillFilterOtherVisuals: true,
      ...(extra.visual ?? {})
    },
    ...(extra.top ?? {})
  }
  return { name, json }
}

function page(name: string, displayName: string, visuals: VisualDocument[], extra: Record<string, any> = {}): PageDocument {
  return {
    name,
    json: { $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.0.0/schema.json', name, displayName, displayOption: 'FitToPage', width: 1280, height: 720, ...extra },
    visuals
  }
}

export const FIXTURE = {
  overview: 'b0000000000000000001',
  details: 'b0000000000000000002',
  tooltip: 'b0000000000000000003',
  hidden: 'b0000000000000000004',
  regionSlicer: 'c0000000000000000001',
  categoryChart: 'c0000000000000000002',
  productTable: 'c0000000000000000003',
  card: 'c0000000000000000004',
  regionSlicer2: 'c0000000000000000005',
  detailsTable: 'c0000000000000000006',
  group: 'c0000000000000000007',
  hiddenVisual: 'c0000000000000000008',
  unknownVisual: 'c0000000000000000009',
  tooltipCard: 'c000000000000000000a',
  regionChart: 'c000000000000000000b'
}

export function fixtureReport(): ReportDocument {
  counter = 0
  const F = FIXTURE
  const card = (title: string) => ({
    title,
    vco: {
      background: [{ properties: { show: lit(true), color: lit('#FFFFFF') } }],
      border: [{ properties: { show: lit(true), color: lit('#E1DFDD'), radius: lit(8), width: lit(1) } }],
      dropShadow: [{ properties: { show: lit(true), preset: lit('BottomRight') } }],
      padding: [{ properties: { left: lit(8), right: lit(8), top: lit(6), bottom: lit(6) } }]
    }
  })

  const overview = page(
    F.overview,
    'Overview',
    [
      visual('slicer', { x: 24, y: 24, w: 220, h: 200, z: 1000 }, { Values: [proj(REGION, 'Sales.Region')] }, {
        name: F.regionSlicer,
        objects: { general: [{ properties: { filter: { filter: inFilter('Sales', 'Region', ['North', 'East']) } } }] },
        visual: { syncGroup: { groupName: 'Region', fieldChanges: true, filterChanges: true } }
      }),
      visual(
        'clusteredColumnChart',
        { x: 264, y: 24, w: 560, h: 320, z: 2000 },
        { Category: [proj(CATEGORY, 'Sales.Category', { active: true }), proj(PRODUCT, 'Sales.Product')], Y: [proj(SALES, 'Sales.Total Sales')] },
        { name: F.categoryChart, ...card('Sales by category'), vco: { ...card('').vco, visualTooltip: [{ properties: { show: lit(true), type: lit('Canvas'), section: lit(F.tooltip) } }] } }
      ),
      visual('card', { x: 844, y: 24, w: 200, h: 120, z: 3000 }, { Values: [proj(SALES, 'Sales.Total Sales')] }, { name: F.card, ...card('Total sales') }),
      visual(
        'tableEx',
        { x: 24, y: 364, w: 520, h: 330, z: 4000 },
        { Values: [proj(PRODUCT, 'Sales.Product'), proj(CATEGORY, 'Sales.Category'), proj(SALES, 'Sales.Total Sales'), proj(QTY, 'Sales.Total Quantity')] },
        { name: F.productTable, ...card('Products') }
      ),
      visual('clusteredBarChart', { x: 564, y: 364, w: 480, h: 330, z: 5000 }, { Category: [proj(REGION, 'Sales.Region')], Y: [proj(QTY, 'Sales.Total Quantity')] }, {
        name: F.regionChart,
        ...card('Quantity by region')
      }),
      // group with two children (positions relative to the group)
      {
        name: F.group,
        json: {
          name: F.group,
          position: { x: 1064, y: 24, z: 6000, width: 192, height: 120, tabOrder: 6000 },
          visualGroup: { displayName: 'Legend', groupMode: 'ScaleMode', objects: { background: [{ properties: { show: lit(true), color: lit('#DEEFFF') } }] } }
        }
      },
      visual('textbox', { x: 8, y: 8, w: 176, h: 50, z: 1000 }, null, {
        objects: { general: [{ properties: { paragraphs: [{ textRuns: [{ value: 'Grouped textbox' }] }] } }] },
        top: { parentGroupName: F.group }
      }),
      visual('shape', { x: 8, y: 66, w: 176, h: 46, z: 0 }, null, { top: { parentGroupName: F.group } }),
      visual('card', { x: 1064, y: 164, w: 192, h: 120, z: 7000 }, { Values: [proj(QTY, 'Sales.Total Quantity')] }, { name: F.hiddenVisual, title: 'Hidden card', top: { isHidden: true } }),
      visual('someCustomVisual0123456789ABCDEF0123456789ABCDEF', { x: 1064, y: 304, w: 192, h: 160, z: 8000 }, null, { name: F.unknownVisual, title: 'Custom visual' })
    ],
    {
      objects: { background: [{ properties: { color: lit('#F5F7FA'), transparency: lit(0) } }] },
      visualInteractions: [{ source: F.regionSlicer, target: F.card, type: 'NoFilter' }],
      filterConfig: { filters: [{ name: 'd0000000000000000001', field: CATEGORY, type: 'Categorical', howCreated: 'User' }] }
    }
  )

  const details = page(
    F.details,
    'Category details',
    [
      visual('slicer', { x: 24, y: 24, w: 220, h: 200, z: 1000 }, { Values: [proj(REGION, 'Sales.Region')] }, {
        name: F.regionSlicer2,
        objects: { general: [{ properties: { filter: { filter: inFilter('Sales', 'Region', ['North', 'East']) } } }] },
        visual: { syncGroup: { groupName: 'Region', fieldChanges: true, filterChanges: true } }
      }),
      visual('tableEx', { x: 264, y: 24, w: 600, h: 400, z: 2000 }, { Values: [proj(PRODUCT, 'Sales.Product'), proj(SALES, 'Sales.Total Sales')] }, { name: F.detailsTable, title: 'Products in category' })
    ],
    {
      pageBinding: { name: 'pb1', type: 'Drillthrough', parameters: [{ name: 'p1', boundFilter: 'd0000000000000000002' }] },
      filterConfig: { filters: [{ name: 'd0000000000000000002', field: CATEGORY, type: 'Categorical', howCreated: 'Drillthrough' }] },
      visibility: 'HiddenInViewMode'
    }
  )

  const tooltip = page(
    F.tooltip,
    'Category tooltip',
    [visual('card', { x: 10, y: 10, w: 300, h: 110, z: 1000 }, { Values: [proj(QTY, 'Sales.Total Quantity')] }, { name: F.tooltipCard, title: 'Units sold' })],
    { width: 320, height: 130, type: 'Tooltip', pageBinding: { name: 'pb2', type: 'Tooltip' }, visibility: 'HiddenInViewMode' }
  )

  const hidden = page(F.hidden, 'Notes', [visual('textbox', { x: 40, y: 40, w: 400, h: 80 }, null, { objects: { general: [{ properties: { paragraphs: [{ textRuns: [{ value: 'Hidden page' }] }] } }] } })], {
    visibility: 'HiddenInViewMode'
  })

  return {
    origin: 'new',
    report: {
      $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.0.0/schema.json',
      themeCollection: { baseTheme: { name: 'CY24SU10', type: 'SharedResources' } },
      settings: { useStylableVisualContainerHeader: true, defaultDrillFilterOtherVisuals: true },
      filterConfig: { filters: [{ name: 'd0000000000000000003', field: columnExpr('Sales', 'Amount'), type: 'Advanced', howCreated: 'User', filter: { Version: 2, From: [{ Name: 's', Entity: 'Sales', Type: 0 }], Where: [{ Condition: { Comparison: { ComparisonKind: 1, Left: { Column: { Expression: { SourceRef: { Source: 's' } }, Property: 'Amount' } }, Right: { Literal: { Value: '0D' } } } } }] } }] }
    },
    pagesMeta: { pageOrder: [F.overview, F.details, F.tooltip, F.hidden], activePageName: F.overview },
    pages: [overview, details, tooltip, hidden],
    bookmarks: [],
    bookmarksMeta: { items: [] },
    theme: {},
    resources: {},
    extraFiles: {},
    diagnostics: []
  }
}
