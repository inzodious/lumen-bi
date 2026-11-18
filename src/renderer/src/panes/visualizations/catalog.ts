/**
 * Visualizations-pane gallery catalog: PBI Desktop core visuals in gallery order, with fallback
 * field-well roles (PBIR role names) and 20×20 flat icons. The visual registry (VisualDefinition)
 * wins when a type is registered — this catalog only fills the gaps so the gallery and wells stay
 * complete while a visual is not implemented yet (the canvas then shows its placeholder).
 */
import type { DataRoleDef } from '../../visuals/contract'

export interface CatalogEntry {
  type: string
  displayName: string
  icon: string
  roles: DataRoleDef[]
  /** cartesian charts get the Analytics tab */
  analytics?: boolean
}

// ---------------------------------------------------------------------------------------------
// Icons (currentColor = main tone; opacity .45 = secondary tone; accent = #F2C811 sparingly)
// ---------------------------------------------------------------------------------------------

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="currentColor">${body}</svg>`
const r = (x: number, y: number, w: number, h: number, o?: number) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.5"${o !== undefined ? ` opacity="${o}"` : ''}/>`
const L = 0.45
const line = (pts: string, w = 1.6) => `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`
const axis = `<path d="M2 2v16h16" fill="none" stroke="currentColor" stroke-width="1" opacity=".55"/>`

export const ICONS: Record<string, string> = {
  stackedBarChart: svg(r(2, 3, 8, 4) + r(10, 3, 5, 4, L) + r(2, 8.5, 11, 4) + r(13, 8.5, 4, 4, L) + r(2, 14, 5, 4) + r(7, 14, 4, 4, L)),
  columnChart: svg(r(3, 9, 4, 9) + r(3, 5, 4, 4, L) + r(8, 6, 4, 12) + r(8, 2, 4, 4, L) + r(13, 12, 4, 6) + r(13, 8, 4, 4, L)),
  clusteredBarChart: svg(r(2, 2, 12, 2.6) + r(2, 4.8, 8, 2.6, L) + r(2, 8.6, 15, 2.6) + r(2, 11.4, 10, 2.6, L) + r(2, 15.2, 7, 2.6) + r(2, 18, 4, 0)),
  clusteredColumnChart: svg(r(2, 6, 2.6, 12) + r(4.8, 10, 2.6, 8, L) + r(8.6, 3, 2.6, 15) + r(11.4, 8, 2.6, 10, L) + r(15.2, 11, 2.6, 7)),
  hundredPercentStackedBarChart: svg(r(2, 3, 9, 4) + r(11, 3, 7, 4, L) + r(2, 8.5, 13, 4) + r(15, 8.5, 3, 4, L) + r(2, 14, 5, 4) + r(7, 14, 11, 4, L)),
  hundredPercentStackedColumnChart: svg(r(3, 8, 4, 10) + r(3, 2, 4, 6, L) + r(8, 5, 4, 13) + r(8, 2, 4, 3, L) + r(13, 12, 4, 6) + r(13, 2, 4, 10, L)),
  lineChart: svg(axis + line('4,14 8,9 12,11 17,4')),
  areaChart: svg(axis + `<path d="M3 17V12l4-5 4 3 6-6v13z" opacity=".55"/>` + line('3,12 7,7 11,10 17,4')),
  stackedAreaChart: svg(axis + `<path d="M3 17v-4l4-3 4 2 6-4v9z"/>` + `<path d="M3 13l4-3 4 2 6-4V4l-6 4-4-3-4 4z" opacity=".45"/>`),
  hundredPercentStackedAreaChart: svg(`<path d="M2 18v-8l5-2 5 3 6-3v10z"/>` + `<path d="M2 10l5-2 5 3 6-3V2H2z" opacity=".45"/>`),
  lineStackedColumnComboChart: svg(r(3, 10, 4, 8) + r(3, 6, 4, 4, L) + r(8, 8, 4, 10) + r(8, 5, 4, 3, L) + r(13, 12, 4, 6) + r(13, 9, 4, 3, L) + line('2,9 7,4 12,7 18,2')),
  lineClusteredColumnComboChart: svg(r(2.5, 9, 3, 9) + r(5.5, 12, 3, 6, L) + r(10, 7, 3, 11) + r(13, 11, 3, 7, L) + line('2,8 8,3 13,6 18,2')),
  ribbonChart: svg(r(2, 10, 4, 8) + r(8, 6, 4, 12) + r(14, 9, 4, 9) + `<path d="M6 10l2-4v12l-2 0z" opacity=".35"/><path d="M12 6l2 3v9h-2z" opacity=".35"/>`),
  waterfallChart: svg(r(2, 8, 3, 10) + r(6, 4, 3, 4, L) + r(10, 4, 3, 6) + r(14, 10, 3, 8, L)),
  funnel: svg(r(2, 2, 16, 3.6) + r(4, 6.2, 12, 3.6, L) + r(6, 10.4, 8, 3.6) + r(8, 14.6, 4, 3.4, L)),
  scatterChart: svg(axis + `<circle cx="6" cy="13" r="1.7"/><circle cx="9.5" cy="8.5" r="1.7" opacity=".55"/><circle cx="13" cy="11" r="1.7"/><circle cx="15.5" cy="5" r="1.7" opacity=".55"/><circle cx="7.5" cy="5.5" r="1.4"/>`),
  pieChart: svg(`<path d="M10 2a8 8 0 1 0 8 8h-8z" opacity=".45"/><path d="M11 1v8h8a8 8 0 0 0-8-8z"/>`),
  donutChart: svg(`<path d="M10 2a8 8 0 1 0 8 8h-3.5A4.5 4.5 0 1 1 10 5.5z" opacity=".45"/><path d="M11 1v3.6A5.5 5.5 0 0 1 15.4 9H19a9 9 0 0 0-8-8z"/>`),
  treemap: svg(r(2, 2, 9, 16) + r(12, 2, 6, 9, L) + r(12, 12, 6, 6)),
  map: svg(`<circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2 10h16M10 2c-3 3-3 13 0 16M10 2c3 3 3 13 0 16" fill="none" stroke="currentColor" stroke-width="1" opacity=".6"/><circle cx="7" cy="7" r="1.6" fill="#F2C811"/><circle cx="13" cy="12" r="2.1" fill="#F2C811"/>`),
  filledMap: svg(`<path d="M3 5l4-2 5 2 5-2v12l-5 2-5-2-4 2z" opacity=".45"/><path d="M7 3l5 2v12l-5-2z"/>`),
  azureMap: svg(`<path d="M10 2a5.5 5.5 0 0 0-5.5 5.5C4.5 12 10 18 10 18s5.5-6 5.5-10.5A5.5 5.5 0 0 0 10 2zm0 7.6a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2z"/>`),
  shapeMap: svg(`<path d="M3 4h6l1 3 6-1v9l-5 2-3-3-5 1z" opacity=".6"/>`),
  gauge: svg(`<path d="M2 15a8 8 0 0 1 16 0h-3a5 5 0 0 0-10 0z" opacity=".45"/><path d="M2 15a8 8 0 0 1 4.3-7.1l1.5 2.6A5 5 0 0 0 5 15z"/><path d="M10 15l4-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`),
  cardVisual: svg(`<rect x="1.5" y="4" width="17" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/>` + r(4, 7, 8, 3) + r(4, 11.5, 5, 1.6, L)),
  card: svg(`<text x="10" y="14" font-size="9" font-weight="700" text-anchor="middle" font-family="Segoe UI, Arial">123</text>`),
  multiRowCard: svg(r(2, 2.5, 7, 2.5) + r(2, 5.5, 12, 1.5, L) + r(2, 9, 7, 2.5) + r(2, 12, 12, 1.5, L) + r(2, 15.5, 7, 2.5)),
  kpi: svg(`<path d="M3 15l4-4 3 2 6-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 4h4v4z"/>`),
  slicer: svg(`<path d="M2 3h16l-6 7v6l-4 2v-8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>`),
  advancedSlicerVisual: svg(r(2, 3, 7, 6) + r(11, 3, 7, 6, L) + r(2, 11, 7, 6, L) + r(11, 11, 7, 6, L)),
  listSlicer: svg(`<rect x="2" y="3" width="3.5" height="3.5" rx=".6"/>` + r(7, 4, 10, 1.6, L) + `<rect x="2" y="8.3" width="3.5" height="3.5" rx=".6" fill="none" stroke="currentColor"/>` + r(7, 9.3, 8, 1.6, L) + `<rect x="2" y="13.6" width="3.5" height="3.5" rx=".6"/>` + r(7, 14.6, 9, 1.6, L)),
  textSlicer: svg(`<rect x="1.5" y="5" width="17" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/>` + r(4, 9, 1.2, 2) + r(6, 9.4, 7, 1.4, L)),
  tableEx: svg(`<rect x="2" y="3" width="16" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>` + r(2, 3, 16, 3.5) + `<path d="M2 10h16M2 13.5h16M8 3v14" stroke="currentColor" stroke-width=".9" opacity=".6"/>`),
  pivotTable: svg(`<rect x="2" y="3" width="16" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>` + r(2, 3, 16, 3.5) + r(2, 3, 5, 14, L) + `<path d="M2 10h16M2 13.5h16M12 3v14" stroke="currentColor" stroke-width=".9" opacity=".6"/>`),
  scriptVisual: svg(`<text x="10" y="15" font-size="13" font-weight="700" text-anchor="middle" font-family="Segoe UI, Arial">R</text>`),
  pythonVisual: svg(`<text x="10" y="14.5" font-size="10" font-weight="700" text-anchor="middle" font-family="Segoe UI, Arial">Py</text>`),
  keyDriversVisual: svg(r(8, 3, 10, 3) + r(8, 8.5, 7, 3, L) + r(8, 14, 4, 3, L) + `<circle cx="4" cy="6" r="2.5" fill="#F2C811"/><path d="M3 9.5h2v2H3z"/>`),
  decompositionTreeVisual: svg(r(2, 8, 4, 4) + r(13, 2.5, 5, 4, L) + r(13, 8, 5, 4) + r(13, 13.5, 5, 4, L) + `<path d="M6 10h3.5M9.5 4.5V15.5M9.5 4.5H13M9.5 10H13M9.5 15.5H13" fill="none" stroke="currentColor" stroke-width="1"/>`),
  qnaVisual: svg(`<path d="M3 3h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3v-3H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.3"/><text x="10" y="11.5" font-size="7" font-weight="700" text-anchor="middle" font-family="Segoe UI, Arial">Q&amp;A</text>`),
  aiNarratives: svg(r(2, 3, 16, 1.8) + r(2, 7, 12, 1.8, L) + r(2, 11, 15, 1.8) + r(2, 15, 9, 1.8, L)),
  paginatedReport: svg(`<path d="M5 2h7l4 4v12H5z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M12 2v4h4" fill="none" stroke="currentColor" stroke-width="1.2"/>` + r(7, 9, 7, 1.4, L) + r(7, 12, 7, 1.4, L)),
  scorecard: svg(`<circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="10" cy="10" r="4" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".6"/><circle cx="10" cy="10" r="1.4"/>`),
  generic: svg(`<rect x="2" y="2" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2"/>` + r(6, 9, 2, 6) + r(9, 6, 2, 9, L) + r(12, 11, 2, 4))
}

// ---------------------------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------------------------

const g = (name: string, displayName: string, extra: Partial<DataRoleDef> = {}): DataRoleDef => ({ name, displayName, kind: 'grouping', ...extra })
const m = (name: string, displayName: string, extra: Partial<DataRoleDef> = {}): DataRoleDef => ({ name, displayName, kind: 'measure', ...extra })
const tips = m('Tooltips', 'Tooltips')

const columnRoles = (catLabel: string, valLabel: string): DataRoleDef[] => [g('Category', catLabel, { drillable: true }), m('Y', valLabel), g('Series', 'Legend', { max: 1 }), tips]
const lineRoles: DataRoleDef[] = [g('Category', 'X-axis', { drillable: true }), m('Y', 'Y-axis'), m('Y2', 'Secondary y-axis'), g('Series', 'Legend', { max: 1 }), tips]
const comboRoles: DataRoleDef[] = [g('Category', 'X-axis', { drillable: true }), m('Y', 'Column y-axis'), m('Y2', 'Line y-axis'), g('Series', 'Column legend', { max: 1 }), tips]

const C = (type: string, displayName: string, roles: DataRoleDef[], analytics = false): CatalogEntry => ({ type, displayName, icon: ICONS[type] ?? ICONS.generic, roles, analytics })

export const CATALOG: CatalogEntry[] = [
  C('stackedBarChart', 'Stacked bar chart', columnRoles('Y-axis', 'X-axis'), true),
  C('columnChart', 'Stacked column chart', columnRoles('X-axis', 'Y-axis'), true),
  C('clusteredBarChart', 'Clustered bar chart', columnRoles('Y-axis', 'X-axis'), true),
  C('clusteredColumnChart', 'Clustered column chart', columnRoles('X-axis', 'Y-axis'), true),
  C('hundredPercentStackedBarChart', '100% Stacked bar chart', columnRoles('Y-axis', 'X-axis'), true),
  C('hundredPercentStackedColumnChart', '100% Stacked column chart', columnRoles('X-axis', 'Y-axis'), true),
  C('lineChart', 'Line chart', lineRoles, true),
  C('areaChart', 'Area chart', lineRoles, true),
  C('stackedAreaChart', 'Stacked area chart', lineRoles, true),
  C('hundredPercentStackedAreaChart', '100% Stacked area chart', lineRoles, true),
  C('lineStackedColumnComboChart', 'Line and stacked column chart', comboRoles, true),
  C('lineClusteredColumnComboChart', 'Line and clustered column chart', comboRoles, true),
  C('ribbonChart', 'Ribbon chart', [g('Category', 'X-axis', { drillable: true }), g('Series', 'Legend', { max: 1 }), m('Y', 'Y-axis'), tips]),
  C('waterfallChart', 'Waterfall chart', [g('Category', 'Category', { drillable: true }), g('Breakdown', 'Breakdown', { max: 1 }), m('Y', 'Y-axis', { max: 1 }), tips]),
  C('funnel', 'Funnel', [g('Category', 'Category', { drillable: true }), m('Y', 'Values'), tips]),
  C('scatterChart', 'Scatter chart', [g('Category', 'Values', { drillable: true }), g('Series', 'Legend', { max: 1 }), m('X', 'X-axis', { max: 1 }), m('Y', 'Y-axis', { max: 1 }), m('Size', 'Size', { max: 1 }), g('Play', 'Play axis', { max: 1 }), tips], true),
  C('pieChart', 'Pie chart', [g('Category', 'Legend', { drillable: true }), m('Y', 'Values'), g('Series', 'Details', { max: 1 }), tips]),
  C('donutChart', 'Donut chart', [g('Category', 'Legend', { drillable: true }), m('Y', 'Values'), g('Series', 'Details', { max: 1 }), tips]),
  C('treemap', 'Treemap', [g('Group', 'Category', { drillable: true }), g('Details', 'Details', { max: 1 }), m('Values', 'Values'), tips]),
  C('map', 'Map', [g('Category', 'Location', { drillable: true }), g('Series', 'Legend', { max: 1 }), m('Y', 'Latitude', { max: 1, kind: 'both' }), m('X', 'Longitude', { max: 1, kind: 'both' }), m('Size', 'Bubble size', { max: 1 }), tips]),
  C('filledMap', 'Filled map', [g('Category', 'Location', { drillable: true }), g('Series', 'Legend', { max: 1 }), m('Y', 'Latitude', { max: 1, kind: 'both' }), m('X', 'Longitude', { max: 1, kind: 'both' }), tips]),
  C('azureMap', 'Azure map', [g('Category', 'Location', { drillable: true }), g('Series', 'Legend', { max: 1 }), m('Y', 'Latitude', { max: 1, kind: 'both' }), m('X', 'Longitude', { max: 1, kind: 'both' }), m('Size', 'Size', { max: 1 }), tips]),
  C('gauge', 'Gauge', [m('Y', 'Value', { max: 1 }), m('MinValue', 'Minimum value', { max: 1 }), m('MaxValue', 'Maximum value', { max: 1 }), m('TargetValue', 'Target value', { max: 1 }), tips]),
  C('cardVisual', 'Card', [m('Data', 'Data', { kind: 'both' }), g('Rows', 'Categories', { max: 1 })]),
  C('card', 'Card (legacy)', [m('Values', 'Fields', { max: 1, kind: 'both' })]),
  C('multiRowCard', 'Multi-row card', [m('Values', 'Fields', { kind: 'both' })]),
  C('kpi', 'KPI', [m('Indicator', 'Value', { max: 1 }), g('TrendLine', 'Trend axis', { max: 1 }), m('Goal', 'Target', { max: 1 })]),
  C('slicer', 'Slicer', [g('Values', 'Field')]),
  C('advancedSlicerVisual', 'Button slicer', [g('Values', 'Field'), m('Data', 'Values', { max: 1 })]),
  C('listSlicer', 'List slicer', [g('Values', 'Field')]),
  C('textSlicer', 'Text slicer', [g('Values', 'Field', { max: 1 })]),
  C('tableEx', 'Table', [g('Values', 'Columns', { kind: 'both' })]),
  C('pivotTable', 'Matrix', [g('Rows', 'Rows', { drillable: true }), g('Columns', 'Columns', { drillable: true }), m('Values', 'Values')]),
  C('scriptVisual', 'R script visual', [g('Values', 'Values', { kind: 'both' })]),
  C('pythonVisual', 'Python visual', [g('Values', 'Values', { kind: 'both' })]),
  C('keyDriversVisual', 'Key influencers', [m('Target', 'Analyze', { max: 1, kind: 'both' }), g('Factors', 'Explain by', { kind: 'both' }), g('ExpandBy', 'Expand by')]),
  C('decompositionTreeVisual', 'Decomposition tree', [m('Analyze', 'Analyze', { max: 1 }), g('ExplainBy', 'Explain by')]),
  C('qnaVisual', 'Q&A', []),
  C('aiNarratives', 'Narrative', []),
  C('scorecard', 'Metrics', []),
  C('paginatedReport', 'Paginated report', [])
]

const BY_TYPE = new Map(CATALOG.map((c) => [c.type.toLowerCase(), c]))

export function catalogEntry(type: string): CatalogEntry | undefined {
  return BY_TYPE.get(type.toLowerCase())
}

const CARTESIAN = /(bar|column|line|area|combo|scatter|ribbon|waterfall)/i

/** Analytics tab applies to cartesian charts. */
export function supportsAnalytics(type: string): boolean {
  return catalogEntry(type)?.analytics ?? (CARTESIAN.test(type) && !/slicer/i.test(type))
}
