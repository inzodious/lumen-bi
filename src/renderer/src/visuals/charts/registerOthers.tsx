/** Registers funnel / treemap / gauge / KPI / waterfall / scatter. */
import { registerVisual } from '../registry'
import type { DataRoleDef, VisualDefinition, VisualHostContext } from '../contract'
import type { VisualDocument } from '@core/report/types'
import { buildCategorical, categoricalTable } from '../common/categorical'
import { FormatReader } from '../common/fmtProps'
import { ICONS } from './icons'
import { Funnel } from './funnel/Funnel'
import { funnelFormatCards } from './funnel/funnelCards'
import { Treemap } from './treemap/Treemap'
import { treemapFormatCards } from './treemap/treemapCards'
import { Gauge, Kpi } from './gauge/Gauge'
import { gaugeFormatCards, kpiFormatCards } from './gauge/gaugeCards'
import { Waterfall } from './waterfall/Waterfall'
import { waterfallFormatCards } from './waterfall/waterfallCards'
import { ScatterChart, scatterTable } from './scatter/ScatterChart'
import { scatterFormatCards } from './scatter/scatterCards'

const tooltips: DataRoleDef = { name: 'Tooltips', displayName: 'Tooltips', kind: 'measure' }

function catData(opts: Parameters<typeof buildCategorical>[2] | ((visual: VisualDocument) => Parameters<typeof buildCategorical>[2])) {
  return (visual: VisualDocument, ctx: VisualHostContext) => {
    const o = typeof opts === 'function' ? opts(visual) : opts
    return categoricalTable(buildCategorical(visual.json, ctx, { ...o, fmt: new FormatReader(visual.json, ctx.theme) }))
  }
}

const hasRole = (visual: VisualDocument, role: string) => ((visual.json?.visual?.query?.queryState?.[role]?.projections ?? []) as unknown[]).length > 0

const defs: VisualDefinition[] = [
  {
    type: 'funnel',
    displayName: 'Funnel',
    category: 'chart',
    icon: ICONS.funnel,
    roles: [
      { name: 'Category', displayName: 'Category', kind: 'grouping', drillable: true },
      { name: 'Y', displayName: 'Values', kind: 'measure' },
      tooltips
    ],
    formatCards: funnelFormatCards(),
    component: Funnel,
    getData: catData({ splitRoles: ['Y'], defaultSort: 'measureDesc' }),
    supportsHighlight: true,
    supportsDrill: true
  },
  {
    type: 'treemap',
    displayName: 'Treemap',
    category: 'chart',
    icon: ICONS.treemap,
    roles: [
      { name: 'Group', displayName: 'Category', kind: 'grouping', drillable: true },
      { name: 'Details', displayName: 'Details', kind: 'grouping' },
      { name: 'Values', displayName: 'Values', kind: 'measure' },
      tooltips
    ],
    formatCards: treemapFormatCards(),
    component: Treemap,
    getData: catData((visual) => ({ categoryRole: 'Group', seriesRole: hasRole(visual, 'Details') ? 'Details' : undefined, splitRoles: ['Values'], defaultSort: 'measureDesc', maxSeries: 2000 })),
    supportsHighlight: true,
    supportsDrill: true
  },
  {
    type: 'gauge',
    displayName: 'Gauge',
    category: 'chart',
    icon: ICONS.gauge,
    roles: [
      { name: 'Y', displayName: 'Value', kind: 'measure', max: 1 },
      { name: 'MinValue', displayName: 'Minimum value', kind: 'measure', max: 1 },
      { name: 'MaxValue', displayName: 'Maximum value', kind: 'measure', max: 1 },
      { name: 'TargetValue', displayName: 'Target value', kind: 'measure', max: 1 },
      tooltips
    ],
    formatCards: gaugeFormatCards(),
    component: Gauge,
    getData: catData({ categoryRole: '__none', splitRoles: ['Y', 'MinValue', 'MaxValue', 'TargetValue'] }),
    supportsHighlight: true
  },
  {
    type: 'kpi',
    displayName: 'KPI',
    category: 'card',
    icon: ICONS.kpi,
    roles: [
      { name: 'Indicator', displayName: 'Value', kind: 'measure', max: 1 },
      { name: 'TrendLine', displayName: 'Trend axis', kind: 'grouping', max: 1 },
      { name: 'Goal', displayName: 'Target', kind: 'measure', max: 2 }
    ],
    formatCards: kpiFormatCards(),
    component: Kpi,
    getData: catData({ categoryRole: 'TrendLine', splitRoles: ['Indicator', 'Goal'], defaultSort: 'categoryAsc', tooltipRole: '' })
  },
  {
    type: 'waterfallChart',
    displayName: 'Waterfall chart',
    category: 'chart',
    icon: ICONS.waterfallChart,
    roles: [
      { name: 'Category', displayName: 'Category', kind: 'grouping', drillable: true },
      { name: 'Breakdown', displayName: 'Breakdown', kind: 'grouping', max: 1 },
      { name: 'Y', displayName: 'Y-axis', kind: 'measure', max: 1 },
      tooltips
    ],
    formatCards: waterfallFormatCards(),
    component: Waterfall,
    getData: catData({ seriesRole: 'Breakdown', splitRoles: ['Y'], defaultSort: 'categoryAsc', maxSeries: 1000 }),
    supportsDrill: true
  },
  {
    type: 'scatterChart',
    displayName: 'Scatter chart',
    category: 'chart',
    icon: ICONS.scatterChart,
    roles: [
      { name: 'Category', displayName: 'Values', kind: 'grouping', drillable: true },
      { name: 'X', displayName: 'X-axis', kind: 'measure', max: 1 },
      { name: 'Y', displayName: 'Y-axis', kind: 'measure', max: 1 },
      { name: 'Series', displayName: 'Legend', kind: 'grouping', max: 1 },
      { name: 'Size', displayName: 'Size', kind: 'measure', max: 1 },
      { name: 'Play', displayName: 'Play axis', kind: 'grouping', max: 1 },
      tooltips
    ],
    formatCards: scatterFormatCards(),
    component: ScatterChart,
    getData: (visual, ctx) => scatterTable(visual.json, ctx),
    supportsHighlight: true,
    supportsDrill: true
  }
]

export function registerOtherCharts(): void {
  for (const d of defs) registerVisual({ inGallery: true, defaultSize: { width: 400, height: 300 }, ...d })
}
