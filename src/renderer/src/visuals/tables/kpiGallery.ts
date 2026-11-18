/**
 * Gallery entries for AS-style KPI status graphics (tables, matrix, cards): a tiny in-memory model
 * whose `_<graphic> Status` measures return the row's status value (-2..2) and are described by the
 * engine as KPI status parts with that graphic — the same shape `engine.describeField().kpi` has for
 * real TOM KPIs. The tables reproduce Power BI's "graphic × status value" grid.
 */
import type { QueryEngine } from '@core/engine/api'
import { columnExpr, fieldInfo, inFilter, measureExpr, type SQExpr, type SQFilter } from '@core/report/sq'
import { createMemoryEngine, type MemoryMeasure } from '../common/memoryEngine'
import { proj } from '../common/sampleData'
import { registerGalleryEntries } from '../gallery/registry'

export const KPI_GRAPHICS_3 = ['Shapes', 'Road Signs', 'Three Symbols Uncircled Colored', 'Traffic Light', 'Traffic Light - Single', 'Three Stars Colored', 'Thermometer']
export const KPI_GRAPHICS_5 = ['Five Bars Colored', 'Five Boxes Colored', 'Gauge - Ascending', 'Gauge - Descending', 'Standard Arrow', 'Status Arrow - Ascending', 'Three Flags Colored', 'Three Circles Colored']

const statusName = (g: string) => `_${g} Status`

/** In-memory engine: fact `Kpi` (one row per status value), one KPI status measure per graphic, plus a Revenue KPI. */
export function createKpiEngine(): QueryEngine {
  const fact = [-2, -1, 0, 1, 2].map((v, i) => ({ Status: v, Label: ['Far below', 'Below', 'On target', 'Above', 'Far above'][i], Order: i, Revenue: 1000 + 250 * v, Goal: 1000 }))
  const one = (rows: Array<Record<string, any>>, col: string) => (rows.length === 1 ? (rows[0][col] as number) : null)
  const measures: MemoryMeasure[] = [
    ...[...KPI_GRAPHICS_3, ...KPI_GRAPHICS_5].map((g) => ({ table: 'Kpi', name: statusName(g), formatString: '0', dataType: 'int64' as const, fn: (rows: any[]) => one(rows, 'Status') })),
    { table: 'Kpi', name: 'Revenue', formatString: '\\$#,0', fn: (rows) => rows.reduce((s, r) => s + (r.Revenue as number), 0) || null },
    { table: 'Kpi', name: '_Revenue Goal', formatString: '\\$#,0', fn: (rows) => rows.reduce((s, r) => s + (r.Goal as number), 0) || null },
    { table: 'Kpi', name: '_Revenue Status', formatString: '0', dataType: 'int64', fn: (rows) => (rows.length === 1 ? Math.max(-1, Math.min(1, rows[0].Status as number)) : 1) },
    { table: 'Kpi', name: '_Revenue Trend', formatString: '0', dataType: 'int64', fn: (rows) => (rows.length === 1 ? Math.max(-1, Math.min(1, rows[0].Status as number)) : 1) }
  ]
  const base = createMemoryEngine({ factTable: 'Kpi', fact, measures, columns: { 'Kpi.Label': { sortBy: 'Order' }, 'Kpi.Status': { dataType: 'int64', formatString: '0' } } })
  const describe = base.describeField.bind(base)
  base.describeField = (expr: SQExpr) => {
    const d = describe(expr)
    const f = fieldInfo(expr)
    const m = f.kind === 'measure' ? /^_(.+) (Status|Goal|Trend)$/.exec(f.property ?? '') : null
    if (!d || !m) return d
    const part = m[2].toLowerCase() as 'status' | 'goal' | 'trend'
    const graphic = m[1] === 'Revenue' ? 'Shapes' : m[1]
    return { ...d, kpi: { measure: m[1], part, statusGraphic: part === 'status' ? graphic : undefined } }
  }
  return base
}

let engine: QueryEngine | undefined
const kpiEngine = () => (engine ??= createKpiEngine())

const K = {
  col: (c: string) => columnExpr('Kpi', c),
  m: (n: string) => measureExpr('Kpi', n)
}

function container(name: string, visualType: string, queryState: Record<string, any[]>, objects: any = {}) {
  const qs: Record<string, any> = {}
  for (const [role, projections] of Object.entries(queryState)) qs[role] = { projections }
  return { name, position: { x: 0, y: 0, z: 0, width: 400, height: 300 }, visual: { visualType, query: { queryState: qs, sortDefinition: { sort: [{ field: K.col('Order'), direction: 'Ascending' }] } }, objects } }
}

function grid(id: string, graphics: string[]) {
  return container(id, 'tableEx', {
    Values: [proj(K.col('Status'), 'Kpi.Status', { displayName: 'Value' }), ...graphics.map((g) => proj(K.m(statusName(g)), `Kpi.${statusName(g)}`, { displayName: g }))]
  })
}

const entry = (id: string, title: string, json: any, width: number, height: number, filters?: SQFilter[]) => ({
  id: `Tables:${id}`,
  section: 'Tables',
  title,
  json,
  width: width + 12,
  height: height + 32,
  filters,
  get engine() {
    return kpiEngine()
  }
})

registerGalleryEntries([
  entry('kpi-graphics-3', 'KPI status graphics — three-state (−2…2, PBI draws nothing outside −1…1)', grid('kpi-graphics-3', KPI_GRAPHICS_3), 700, 230),
  entry('kpi-graphics-5', 'KPI status graphics — five-state (gauges, bars, boxes, arrows)', grid('kpi-graphics-5', KPI_GRAPHICS_5), 900, 230),
  entry(
    'kpi-matrix',
    'Matrix — KPI value, goal, status, trend',
    container('kpi-matrix', 'pivotTable', {
      Rows: [proj(K.col('Label'), 'Kpi.Label', { active: true })],
      Values: [proj(K.m('Revenue'), 'Kpi.Revenue'), proj(K.m('_Revenue Goal'), 'Kpi._Revenue Goal'), proj(K.m('_Revenue Status'), 'Kpi._Revenue Status'), proj(K.m('_Revenue Trend'), 'Kpi._Revenue Trend')]
    }),
    460,
    190
  ),
  entry('kpi-card', 'Card — KPI status (Gauge - Ascending, value 1)', container('kpi-card', 'card', { Values: [proj(K.m(statusName('Gauge - Ascending')), `Kpi.${statusName('Gauge - Ascending')}`)] }), 220, 140, [inFilter('Kpi', 'Status', [1])]),
  entry(
    'kpi-multirow',
    'Multi-row card — status and trend per row',
    container('kpi-multirow', 'multiRowCard', { Values: [proj(K.col('Label'), 'Kpi.Label'), proj(K.m('Revenue'), 'Kpi.Revenue'), proj(K.m('_Revenue Status'), 'Kpi._Revenue Status'), proj(K.m('_Revenue Trend'), 'Kpi._Revenue Trend')] }),
    360,
    300
  ),
  entry(
    'kpi-cardvisual',
    'Card (new) — KPI status callouts',
    container('kpi-cardvisual', 'cardVisual', { Data: [proj(K.m(statusName('Five Bars Colored')), `Kpi.${statusName('Five Bars Colored')}`), proj(K.m(statusName('Status Arrow - Ascending')), `Kpi.${statusName('Status Arrow - Ascending')}`), proj(K.m('Revenue'), 'Kpi.Revenue')] }),
    520,
    150,
    [inFilter('Kpi', 'Status', [-1])]
  )
])
