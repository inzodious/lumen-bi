/**
 * PBIR report of the built-in sample project: three 1280×720 pages
 * ("Overview", "Products", "Customers & Regions") built from plain PBIR visual.json shapes —
 * exactly what Power BI Desktop writes (visualContainer schema, queryState projections with SQ
 * field expressions, objects / visualContainerObjects with SQ literals), so the report can be
 * saved as PBIP and opened in Power BI Desktop.
 */
import { emptyReport, type PageDocument, type ReportDocument, type VisualDocument } from '../report/types'
import { aggregationExpr, columnExpr, measureExpr, SQ_AGG, type SQExpr } from '../report/sq'
import { MEASURE_TABLE } from './sample-model'
import { hexId } from './sample-random'

const VISUAL_SCHEMA = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.4.0/schema.json'
const PAGE_SCHEMA = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.0.0/schema.json'
const PAGES_SCHEMA = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.0.0/schema.json'
const VERSION_SCHEMA = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json'

const PAGE_W = 1280
const PAGE_H = 720

const COLORS = {
  header: '#12239E',
  headerText: '#FFFFFF',
  headerSubText: '#C8D0F4',
  page: '#F3F4F7',
  visual: '#FFFFFF',
  border: '#E1E3EA',
  title: '#252423'
}

// ---------------------------------------------------------------------------------------------
// SQ literal helpers (encodings per src/core/report/literal.ts: 'text', 12L, 1.5D, true)
// ---------------------------------------------------------------------------------------------

const litS = (s: string) => ({ expr: { Literal: { Value: `'${s.replace(/'/g, "''")}'` } } })
const litD = (n: number) => ({ expr: { Literal: { Value: `${n}D` } } })
const litL = (n: number) => ({ expr: { Literal: { Value: `${Math.trunc(n)}L` } } })
const litB = (b: boolean) => ({ expr: { Literal: { Value: b ? 'true' : 'false' } } })
const solid = (hex: string) => ({ solid: { color: litS(hex) } })

/** One `objects`/`visualContainerObjects` entry: `{ name: [{ properties }] }`. */
type Props = Record<string, unknown>
const obj = (properties: Props, selector?: unknown) => [selector ? { properties, selector } : { properties }]

// ---------------------------------------------------------------------------------------------
// Fields and projections
// ---------------------------------------------------------------------------------------------

interface Field {
  expr: SQExpr
  queryRef: string
  nativeQueryRef: string
  /** projection-level rename ("Rename for this visual") */
  displayName?: string
}

const col = (table: string, column: string): Field => ({ expr: columnExpr(table, column), queryRef: `${table}.${column}`, nativeQueryRef: column })
const msr = (measure: string): Field => ({ expr: measureExpr(MEASURE_TABLE, measure), queryRef: `${MEASURE_TABLE}.${measure}`, nativeQueryRef: measure })
const sum = (table: string, column: string): Field => ({ expr: aggregationExpr(table, column, SQ_AGG.Sum), queryRef: `Sum(${table}.${column})`, nativeQueryRef: `Sum of ${column}` })
const level = (table: string, hierarchy: string, lvl: string): Field => ({
  expr: { HierarchyLevel: { Expression: { Hierarchy: { Expression: { SourceRef: { Entity: table } }, Hierarchy: hierarchy } }, Level: lvl } },
  queryRef: `${table}.${hierarchy}.${lvl}`,
  nativeQueryRef: lvl
})

/** Grouping roles get `active: true` (the levels currently shown), value roles don't. */
function projections(fields: Field[], active: boolean) {
  return {
    projections: fields.map((f) => ({
      field: f.expr,
      queryRef: f.queryRef,
      nativeQueryRef: f.nativeQueryRef,
      ...(f.displayName ? { displayName: f.displayName } : {}),
      ...(active ? { active: true } : {})
    }))
  }
}

const sortBy = (f: Field, direction: 'Ascending' | 'Descending') => ({ sort: [{ field: f.expr, direction }] })

// ---------------------------------------------------------------------------------------------
// Visual builders
// ---------------------------------------------------------------------------------------------

interface Box {
  x: number
  y: number
  w: number
  h: number
}

class PageBuilder {
  readonly visuals: VisualDocument[] = []

  constructor(private readonly pageKey: string) {}

  add(kind: string, box: Box, visual: Record<string, unknown>, extra: Record<string, unknown> = {}): void {
    const i = this.visuals.length
    const name = hexId(`sample/${this.pageKey}/${i}/${kind}`)
    const z = i * 1000
    this.visuals.push({
      name,
      json: {
        $schema: VISUAL_SCHEMA,
        name,
        position: { x: box.x, y: box.y, z, width: box.w, height: box.h, tabOrder: z },
        visual: { ...visual, drillFilterOtherVisuals: true },
        ...extra
      }
    })
  }
}

/** Card-style container chrome for data visuals: white background, light rounded border, title. */
function chrome(title?: string): Record<string, unknown> {
  return {
    title: obj(
      title
        ? { show: litB(true), text: litS(title), fontSize: litD(11), fontColor: solid(COLORS.title), fontFamily: litS("'Segoe UI Semibold', wf_segoe-ui_semibold, helvetica, arial, sans-serif") }
        : { show: litB(false) }
    ),
    background: obj({ show: litB(true), color: solid(COLORS.visual), transparency: litD(0) }),
    border: obj({ show: litB(true), color: solid(COLORS.border), radius: litD(6), width: litD(1) }),
    padding: obj({ top: litD(8), bottom: litD(8), left: litD(10), right: litD(10) })
  }
}

const transparentChrome = (): Record<string, unknown> => ({
  title: obj({ show: litB(false) }),
  background: obj({ show: litB(false) }),
  border: obj({ show: litB(false) }),
  visualHeader: obj({ show: litB(false) })
})

function header(p: PageBuilder, title: string, subtitle: string): void {
  p.add('shape', { x: 0, y: 0, w: PAGE_W, h: 64 }, {
    visualType: 'shape',
    objects: {
      shape: obj({ tileShape: litS('rectangle') }),
      rotation: obj({ shapeAngle: litL(0) }),
      fill: obj({ fillColor: solid(COLORS.header), transparency: litD(0) }, { id: 'default' }),
      outline: obj({ show: litB(false) })
    },
    visualContainerObjects: transparentChrome()
  }, { howCreated: 'InsertVisualButton' })
  p.add('textbox', { x: 16, y: 4, w: 560, h: 56 }, {
    visualType: 'textbox',
    objects: {
      general: obj({
        paragraphs: [
          { textRuns: [{ value: title, textStyle: { fontFamily: 'Segoe UI Semibold', fontSize: '18pt', color: COLORS.headerText } }] },
          { textRuns: [{ value: subtitle, textStyle: { fontFamily: 'Segoe UI', fontSize: '9pt', color: COLORS.headerSubText } }] }
        ]
      })
    },
    visualContainerObjects: transparentChrome()
  })
}

/** Dropdown slicer sitting on the header band (white header label, white dropdown box). */
function headerSlicer(p: PageBuilder, field: Field, x: number, w = 176): void {
  p.add('slicer', { x, y: 2, w, h: 60 }, {
    visualType: 'slicer',
    query: { queryState: { Values: projections([field], true) } },
    objects: {
      data: obj({ mode: litS('Dropdown') }),
      header: obj({ show: litB(true), fontColor: solid(COLORS.headerText), textSize: litD(9) }),
      items: obj({ background: solid(COLORS.visual), fontColor: solid(COLORS.title), textSize: litD(10) }),
      selection: obj({ selectAllCheckboxEnabled: litB(true), singleSelect: litB(false), strictSingleSelect: litB(false) })
    },
    visualContainerObjects: { ...transparentChrome(), padding: obj({ top: litD(2), bottom: litD(2), left: litD(0), right: litD(0) }) }
  })
}

function listSlicer(p: PageBuilder, field: Field, box: Box, opts: { horizontal?: boolean; search?: boolean } = {}): void {
  const general: Props = { ...(opts.horizontal ? { orientation: litD(1) } : {}), ...(opts.search ? { selfFilterEnabled: litB(true) } : {}) }
  p.add('slicer', box, {
    visualType: 'slicer',
    query: { queryState: { Values: projections([field], true) } },
    objects: {
      data: obj({ mode: litS('Basic') }),
      ...(Object.keys(general).length ? { general: obj(general) } : {}),
      header: obj({ show: litB(true), textSize: litD(10) }),
      selection: obj({ selectAllCheckboxEnabled: litB(!opts.horizontal), singleSelect: litB(true), strictSingleSelect: litB(false) })
    },
    visualContainerObjects: { ...chrome(), title: obj({ show: litB(false) }) }
  })
}

function card(p: PageBuilder, measure: string, box: Box): void {
  p.add('cardVisual', box, {
    visualType: 'cardVisual',
    query: { queryState: { Data: projections([msr(measure)], false) } },
    objects: {
      value: obj({ fontSize: litD(24), fontFamily: litS("'Segoe UI Semibold', wf_segoe-ui_semibold, helvetica, arial, sans-serif") }, { id: 'default' }),
      label: obj({ show: litB(true), fontSize: litD(10) }, { id: 'default' }),
      layout: obj({ alignment: litS('middle') })
    },
    visualContainerObjects: { ...chrome(), title: obj({ show: litB(false) }) }
  })
}

interface ChartSpec {
  type: string
  title: string
  category: Field[]
  values: Field[]
  series?: Field
  tooltips?: Field[]
  sort?: { field: Field; direction: 'Ascending' | 'Descending' }
  labels?: boolean
  legend?: 'Top' | 'Bottom' | 'Right'
  /** categoryAxis.preferredCategoryWidth ("Minimum category width"), px */
  minCategoryWidth?: number
}

function chart(p: PageBuilder, box: Box, spec: ChartSpec): void {
  const queryState: Record<string, unknown> = { Category: projections(spec.category, true), Y: projections(spec.values, false) }
  if (spec.series) queryState.Series = projections([spec.series], false)
  if (spec.tooltips) queryState.Tooltips = projections(spec.tooltips, false)
  const objects: Record<string, unknown> = {}
  if (spec.labels !== undefined) objects.labels = obj({ show: litB(spec.labels) })
  if (spec.legend) objects.legend = obj({ show: litB(true), position: litS(spec.legend), showTitle: litB(false) })
  if (spec.type !== 'donutChart' && spec.type !== 'pieChart') {
    objects.categoryAxis = obj({ showAxisTitle: litB(false), ...(spec.minCategoryWidth ? { preferredCategoryWidth: litD(spec.minCategoryWidth) } : {}) })
    objects.valueAxis = obj({ showAxisTitle: litB(false), gridlineStyle: litS('dotted') })
  }
  p.add(spec.type, box, {
    visualType: spec.type,
    query: { queryState, ...(spec.sort ? { sortDefinition: sortBy(spec.sort.field, spec.sort.direction) } : {}) },
    objects,
    visualContainerObjects: chrome(spec.title)
  })
}

function table(p: PageBuilder, box: Box, title: string, fields: Field[], sort?: { field: Field; direction: 'Ascending' | 'Descending' }): void {
  p.add('tableEx', box, {
    visualType: 'tableEx',
    query: { queryState: { Values: projections(fields, false) }, ...(sort ? { sortDefinition: sortBy(sort.field, sort.direction) } : {}) },
    objects: {
      columnHeaders: obj({ fontColor: solid(COLORS.title), bold: litB(true) }),
      total: obj({ totals: litB(true) })
    },
    visualContainerObjects: chrome(title)
  })
}

function matrix(p: PageBuilder, box: Box, title: string, rows: Field[], columns: Field[], values: Field[], opts: { columnTotals?: boolean } = {}): void {
  p.add('pivotTable', box, {
    visualType: 'pivotTable',
    query: {
      queryState: {
        Rows: projections(rows, true),
        ...(columns.length ? { Columns: projections(columns, true) } : {}),
        Values: projections(values, false)
      }
    },
    // Both row levels pinned/active = the matrix opens expanded to Subcategory (stepped layout).
    expansionStates: [{ roles: ['Rows'], levels: rows.map((r) => ({ queryRefs: [r.queryRef], isPinned: true })), root: {} }],
    objects: {
      rowHeaders: obj({ fontColor: solid(COLORS.title) }),
      subTotals: obj({ rowSubtotals: litB(true), ...(opts.columnTotals === false ? { columnSubtotals: litB(false) } : {}) })
    },
    visualContainerObjects: chrome(title)
  })
}

function multiRowCard(p: PageBuilder, box: Box, measures: string[]): void {
  p.add('multiRowCard', box, {
    visualType: 'multiRowCard',
    query: { queryState: { Values: projections(measures.map(msr), false) } },
    objects: {
      dataLabels: obj({ fontSize: litD(15) }),
      categoryLabels: obj({ fontSize: litD(9) })
    },
    visualContainerObjects: { ...chrome(), title: obj({ show: litB(false) }) }
  })
}

// ---------------------------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------------------------

const SUBTITLE = 'Fictional bike & outdoor retailer · sample data · 2023–2025'

function overviewPage(): PageBuilder {
  const p = new PageBuilder('overview')
  header(p, 'Sales Overview', SUBTITLE)
  headerSlicer(p, col('Date', 'Year'), 712)
  headerSlicer(p, col('Product', 'Category'), 900)
  headerSlicer(p, col('Region', 'Region'), 1088)

  const kpis = ['Total Sales', 'Margin %', 'Orders', 'Customers', 'Sales YTD']
  kpis.forEach((m, i) => card(p, m, { x: 16 + i * 252, y: 76, w: 240, h: 104 }))

  chart(p, { x: 16, y: 192, w: 828, h: 256 }, {
    type: 'lineChart',
    title: 'Total Sales vs last year by month',
    category: [col('Date', 'Year Month')],
    values: [msr('Total Sales'), msr('Sales LY')],
    tooltips: [msr('Sales YoY %')],
    sort: { field: col('Date', 'Year Month'), direction: 'Ascending' },
    minCategoryWidth: 12,
    legend: 'Top'
  })
  chart(p, { x: 856, y: 192, w: 408, h: 256 }, {
    type: 'donutChart',
    title: 'Sales by category',
    category: [col('Product', 'Category')],
    values: [msr('Total Sales')],
    legend: 'Right'
  })
  chart(p, { x: 16, y: 460, w: 404, h: 244 }, {
    type: 'clusteredColumnChart',
    title: 'Sales by year and channel',
    category: [col('Date', 'Year')],
    series: col('Sales', 'Channel'),
    values: [msr('Total Sales')],
    sort: { field: col('Date', 'Year'), direction: 'Ascending' },
    labels: true,
    legend: 'Top'
  })
  chart(p, { x: 432, y: 460, w: 404, h: 244 }, {
    type: 'barChart',
    title: 'Sales by country',
    category: [col('Region', 'Country')],
    values: [msr('Total Sales')],
    minCategoryWidth: 14,
    sort: { field: msr('Total Sales'), direction: 'Descending' }
  })
  table(p, { x: 848, y: 460, w: 416, h: 244 }, 'Stores', [col('Store', 'Store'), col('Store', 'Store Type'), msr('Total Sales'), msr('Margin %')], {
    field: msr('Total Sales'),
    direction: 'Descending'
  })
  return p
}

function productsPage(): PageBuilder {
  const p = new PageBuilder('products')
  header(p, 'Products', SUBTITLE)
  headerSlicer(p, col('Date', 'Year'), 900)
  headerSlicer(p, col('Sales', 'Channel'), 1088)

  listSlicer(p, col('Product', 'Category'), { x: 16, y: 76, w: 200, h: 180 })
  listSlicer(p, col('Product', 'Subcategory'), { x: 16, y: 268, w: 200, h: 436 }, { search: true })

  matrix(
    p,
    { x: 228, y: 76, w: 780, h: 360 },
    'Sales and margin by category and year',
    [level('Product', 'Product Hierarchy', 'Category'), level('Product', 'Product Hierarchy', 'Subcategory')],
    [col('Date', 'Year')],
    [msr('Total Sales'), msr('Margin %')],
    { columnTotals: false }
  )
  multiRowCard(p, { x: 1020, y: 76, w: 244, h: 128 }, ['Units', 'Avg Unit Price', 'Discount %', 'Avg Order Value'])
  chart(p, { x: 1020, y: 216, w: 244, h: 220 }, {
    type: 'donutChart',
    title: 'Sales by channel',
    category: [col('Sales', 'Channel')],
    values: [msr('Total Sales')],
    legend: 'Bottom'
  })
  chart(p, { x: 228, y: 448, w: 400, h: 256 }, {
    type: 'lineChart',
    title: 'Margin % by month and year',
    category: [col('Date', 'Month Short')],
    series: col('Date', 'Year'),
    values: [msr('Margin %')],
    sort: { field: col('Date', 'Month Short'), direction: 'Ascending' },
    legend: 'Top'
  })
  table(
    p,
    { x: 640, y: 448, w: 624, h: 256 },
    'Product details',
    [col('Product', 'Product'), msr('Total Sales'), msr('Units'), msr('Margin %'), msr('% of Total Sales')],
    { field: msr('Total Sales'), direction: 'Descending' }
  )
  return p
}

function customersPage(): PageBuilder {
  const p = new PageBuilder('customers')
  header(p, 'Customers & Regions', SUBTITLE)
  headerSlicer(p, col('Date', 'Year'), 900)
  headerSlicer(p, col('Sales', 'Channel'), 1088)

  listSlicer(p, col('Customer', 'Segment'), { x: 16, y: 76, w: 404, h: 104 }, { horizontal: true })
  ;['Customers', 'Sales per Customer', 'Avg Order Value', 'Orders'].forEach((m, i) => card(p, m, { x: 432 + i * 211, y: 76, w: 199, h: 104 }))

  chart(p, { x: 16, y: 192, w: 404, h: 256 }, {
    type: 'donutChart',
    title: 'Sales by segment',
    category: [col('Customer', 'Segment')],
    values: [msr('Total Sales')],
    legend: 'Bottom'
  })
  chart(p, { x: 432, y: 192, w: 404, h: 256 }, {
    type: 'clusteredColumnChart',
    title: 'Sales by region and segment',
    category: [col('Region', 'Region')],
    series: col('Customer', 'Segment'),
    values: [msr('Total Sales')],
    sort: { field: msr('Total Sales'), direction: 'Descending' },
    legend: 'Top'
  })
  chart(p, { x: 848, y: 192, w: 416, h: 256 }, {
    type: 'lineChart',
    title: 'Purchasing customers by month and year',
    category: [col('Date', 'Month Short')],
    series: col('Date', 'Year'),
    values: [msr('Customers')],
    sort: { field: col('Date', 'Month Short'), direction: 'Ascending' },
    legend: 'Top'
  })
  table(
    p,
    { x: 16, y: 460, w: 728, h: 244 },
    'Customers by sales',
    [col('Customer', 'Customer'), col('Customer', 'Segment'), col('Region', 'Country'), msr('Orders'), msr('Total Sales'), { ...sum('Sales', 'Discount'), displayName: 'Discounts' }],
    { field: msr('Total Sales'), direction: 'Descending' }
  )
  matrix(
    p,
    { x: 756, y: 460, w: 508, h: 244 },
    'Sales by geography',
    [col('Region', 'Region'), col('Region', 'Country')],
    [],
    [msr('Total Sales'), msr('Customers'), msr('Margin %')]
  )
  return p
}

function pageDoc(key: string, displayName: string, builder: PageBuilder, filters: SQExpr[] = []): PageDocument {
  const name = hexId(`sample/page/${key}`)
  const json: Record<string, unknown> = {
    $schema: PAGE_SCHEMA,
    name,
    displayName,
    displayOption: 'FitToPage',
    height: PAGE_H,
    width: PAGE_W,
    objects: { background: obj({ color: solid(COLORS.page), transparency: litD(0) }) }
  }
  if (filters.length) {
    json.filterConfig = { filters: filters.map((field, i) => ({ name: hexId(`sample/page/${key}/filter/${i}`), field, type: 'Categorical', howCreated: 'User' })) }
  }
  return { name, json, visuals: builder.visuals }
}

export function buildSampleReport(): ReportDocument {
  const report = emptyReport()
  const pages = [
    pageDoc('overview', 'Overview', overviewPage()),
    pageDoc('products', 'Products', productsPage(), [columnExpr('Product', 'Color')]),
    pageDoc('customers', 'Customers & Regions', customersPage(), [columnExpr('Region', 'Country'), columnExpr('Store', 'Store Type')])
  ]
  report.pages = pages
  report.pagesMeta = { $schema: PAGES_SCHEMA, pageOrder: pages.map((p) => p.name), activePageName: pages[0].name }
  report.version = { $schema: VERSION_SCHEMA, version: '2.0.0' }
  report.report.filterConfig = { filters: [{ name: hexId('sample/report/filter/0'), field: columnExpr('Product', 'Category'), type: 'Categorical', howCreated: 'User' }] }
  return report
}
