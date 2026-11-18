/** Registers the cartesian chart family (column / bar / line / area / combo / ribbon). */
import { registerVisual } from '../../registry'
import type { DataRoleDef, FormatCardDef, VisualDefinition } from '../../contract'
import { buildCategorical, categoricalTable } from '../../common/categorical'
import { FormatReader } from '../../common/fmtProps'
import { ICONS } from '../icons'
import {
  analyticsCards,
  categoryAxisCard,
  dataColorsCard,
  dataLabelsCard,
  legendCard,
  linesCard,
  plotAreaCard,
  responsiveCard,
  smallMultiplesCard,
  smallMultiplesTitleCard,
  totalsCard,
  valueAxisCard,
  anomalyCard,
  errorBarsCard,
  seriesLabelsCard,
  xConstantLineCard,
  y2AxisCard,
  zoomCard
} from '../formatCards'
import { makeCartesianComponent, type CartesianConfig } from './CartesianChart'

interface Spec {
  type: string
  displayName: string
  config: Omit<CartesianConfig, 'icon'>
  roles: DataRoleDef[]
  cards: FormatCardDef[]
  size?: { width: number; height: number }
}

const tooltips: DataRoleDef = { name: 'Tooltips', displayName: 'Tooltips', kind: 'measure' }
const smallMultiples: DataRoleDef = { name: 'Rows', displayName: 'Small multiples', kind: 'grouping', max: 1 }
const legend: DataRoleDef = { name: 'Series', displayName: 'Legend', kind: 'grouping', max: 1 }

function colRoles(catName: string, valName: string): DataRoleDef[] {
  return [
    { name: 'Category', displayName: catName, kind: 'grouping', drillable: true },
    { name: 'Y', displayName: valName, kind: 'measure' },
    legend,
    smallMultiples,
    tooltips
  ]
}

const bar = () => 'bar' as const
const lineOrArea = (k: 'line' | 'area') => () => k

const columnCards = (stacked: boolean, horizontal: boolean): FormatCardDef[] => [
  legendCard(),
  smallMultiplesCard,
  smallMultiplesTitleCard,
  categoryAxisCard({ displayName: horizontal ? 'Y-axis' : 'X-axis' }),
  valueAxisCard({ displayName: horizontal ? 'X-axis' : 'Y-axis' }),
  dataColorsCard(horizontal ? 'Bars' : 'Columns'),
  dataLabelsCard('bar'),
  ...(stacked ? [totalsCard] : []),
  plotAreaCard,
  zoomCard,
  responsiveCard,
  ...analyticsCards,
  errorBarsCard
]

/** Line / area / combo cards (secondary axis, series labels, anomalies, error bars, X constant line). */
const lineCards = (opts: { area?: boolean; secondary?: boolean; columns?: boolean; totals?: boolean; analytics?: boolean }): FormatCardDef[] => [
  legendCard('Top', { lineStyles: true }),
  smallMultiplesCard,
  smallMultiplesTitleCard,
  categoryAxisCard(),
  valueAxisCard({ secondary: opts.secondary }),
  ...(opts.secondary ? [y2AxisCard] : []),
  ...(opts.columns ? [dataColorsCard('Columns')] : []),
  linesCard({ area: opts.area }),
  dataLabelsCard(opts.columns ? 'bar' : 'line'),
  ...(opts.totals ? [totalsCard] : []),
  seriesLabelsCard,
  plotAreaCard,
  zoomCard,
  responsiveCard,
  ...(opts.analytics !== false ? [...analyticsCards, xConstantLineCard, errorBarsCard, ...(opts.columns ? [] : [anomalyCard])] : [])
]

const SPECS: Spec[] = [
  {
    type: 'clusteredColumnChart',
    displayName: 'Clustered column chart',
    config: { orientation: 'vertical', stacking: 'clustered', kindOf: bar, splitRoles: ['Y'], defaultSort: 'measureDesc' },
    roles: colRoles('X-axis', 'Y-axis'),
    cards: columnCards(false, false)
  },
  {
    type: 'columnChart',
    displayName: 'Stacked column chart',
    config: { orientation: 'vertical', stacking: 'stacked', kindOf: bar, splitRoles: ['Y'], defaultSort: 'measureDesc' },
    roles: colRoles('X-axis', 'Y-axis'),
    cards: columnCards(true, false)
  },
  {
    type: 'hundredPercentStackedColumnChart',
    displayName: '100% stacked column chart',
    config: { orientation: 'vertical', stacking: 'percent', kindOf: bar, splitRoles: ['Y'], defaultSort: 'measureDesc' },
    roles: colRoles('X-axis', 'Y-axis'),
    cards: columnCards(false, false)
  },
  {
    type: 'clusteredBarChart',
    displayName: 'Clustered bar chart',
    config: { orientation: 'horizontal', stacking: 'clustered', kindOf: bar, splitRoles: ['Y'], defaultSort: 'measureDesc' },
    roles: colRoles('Y-axis', 'X-axis'),
    cards: columnCards(false, true)
  },
  {
    type: 'barChart',
    displayName: 'Stacked bar chart',
    config: { orientation: 'horizontal', stacking: 'stacked', kindOf: bar, splitRoles: ['Y'], defaultSort: 'measureDesc' },
    roles: colRoles('Y-axis', 'X-axis'),
    cards: columnCards(true, true)
  },
  {
    type: 'hundredPercentStackedBarChart',
    displayName: '100% stacked bar chart',
    config: { orientation: 'horizontal', stacking: 'percent', kindOf: bar, splitRoles: ['Y'], defaultSort: 'measureDesc' },
    roles: colRoles('Y-axis', 'X-axis'),
    cards: columnCards(false, true)
  },
  {
    type: 'lineChart',
    displayName: 'Line chart',
    config: { orientation: 'vertical', stacking: 'clustered', kindOf: lineOrArea('line'), splitRoles: ['Y'], unsplitRoles: ['Y2'], secondaryRoles: ['Y2'], defaultSort: 'categoryAsc', maxCategories: 3500 },
    roles: [
      { name: 'Category', displayName: 'X-axis', kind: 'grouping', drillable: true },
      { name: 'Y', displayName: 'Y-axis', kind: 'measure' },
      { name: 'Y2', displayName: 'Secondary y-axis', kind: 'measure' },
      legend,
      smallMultiples,
      tooltips
    ],
    cards: lineCards({ secondary: true })
  },
  {
    type: 'areaChart',
    displayName: 'Area chart',
    config: { orientation: 'vertical', stacking: 'clustered', kindOf: lineOrArea('area'), splitRoles: ['Y'], unsplitRoles: ['Y2'], secondaryRoles: ['Y2'], defaultSort: 'categoryAsc', maxCategories: 3500 },
    roles: [
      { name: 'Category', displayName: 'X-axis', kind: 'grouping', drillable: true },
      { name: 'Y', displayName: 'Y-axis', kind: 'measure' },
      { name: 'Y2', displayName: 'Secondary y-axis', kind: 'measure' },
      legend,
      smallMultiples,
      tooltips
    ],
    cards: lineCards({ area: true, secondary: true })
  },
  {
    type: 'stackedAreaChart',
    displayName: 'Stacked area chart',
    config: { orientation: 'vertical', stacking: 'stacked', kindOf: lineOrArea('area'), splitRoles: ['Y'], defaultSort: 'categoryAsc', maxCategories: 3500 },
    roles: colRoles('X-axis', 'Y-axis'),
    cards: lineCards({ area: true, totals: true, analytics: false })
  },
  {
    type: 'hundredPercentStackedAreaChart',
    displayName: '100% stacked area chart',
    config: { orientation: 'vertical', stacking: 'percent', kindOf: lineOrArea('area'), splitRoles: ['Y'], defaultSort: 'categoryAsc', maxCategories: 3500 },
    roles: colRoles('X-axis', 'Y-axis'),
    cards: lineCards({ area: true, analytics: false })
  },
  {
    type: 'lineClusteredColumnComboChart',
    displayName: 'Line and clustered column chart',
    config: { orientation: 'vertical', stacking: 'clustered', kindOf: (r) => (r === 'Y2' ? 'line' : 'bar'), splitRoles: ['Y'], unsplitRoles: ['Y2'], secondaryRoles: ['Y2'], defaultSort: 'measureDesc' },
    roles: [
      { name: 'Category', displayName: 'X-axis', kind: 'grouping', drillable: true },
      { name: 'Y', displayName: 'Column y-axis', kind: 'measure' },
      { name: 'Y2', displayName: 'Line y-axis', kind: 'measure' },
      { name: 'Series', displayName: 'Column legend', kind: 'grouping', max: 1 },
      smallMultiples,
      tooltips
    ],
    cards: lineCards({ secondary: true, columns: true })
  },
  {
    type: 'lineStackedColumnComboChart',
    displayName: 'Line and stacked column chart',
    config: { orientation: 'vertical', stacking: 'stacked', kindOf: (r) => (r === 'Y2' ? 'line' : 'bar'), splitRoles: ['Y'], unsplitRoles: ['Y2'], secondaryRoles: ['Y2'], defaultSort: 'measureDesc' },
    roles: [
      { name: 'Category', displayName: 'X-axis', kind: 'grouping', drillable: true },
      { name: 'Y', displayName: 'Column y-axis', kind: 'measure' },
      { name: 'Y2', displayName: 'Line y-axis', kind: 'measure' },
      { name: 'Series', displayName: 'Column legend', kind: 'grouping', max: 1 },
      smallMultiples,
      tooltips
    ],
    cards: lineCards({ secondary: true, columns: true, totals: true })
  },
  {
    type: 'ribbonChart',
    displayName: 'Ribbon chart',
    config: { orientation: 'vertical', stacking: 'stacked', kindOf: bar, splitRoles: ['Y'], ribbon: true, defaultSort: 'categoryAsc' },
    roles: [
      { name: 'Category', displayName: 'X-axis', kind: 'grouping', drillable: true },
      legend,
      { name: 'Y', displayName: 'Y-axis', kind: 'measure' },
      smallMultiples,
      tooltips
    ],
    cards: [legendCard(), categoryAxisCard({ continuous: false }), valueAxisCard(), dataColorsCard('Columns'), dataLabelsCard('bar'), totalsCard, plotAreaCard, responsiveCard]
  }
]

export function registerCartesianCharts(): void {
  for (const spec of SPECS) {
    const icon = ICONS[spec.type]
    const config: CartesianConfig = { ...spec.config, icon }
    const def: VisualDefinition = {
      type: spec.type,
      displayName: spec.displayName,
      category: 'chart',
      icon,
      roles: spec.roles,
      formatCards: spec.cards,
      component: makeCartesianComponent(config),
      inGallery: true,
      supportsHighlight: true,
      supportsDrill: true,
      defaultSize: spec.size ?? { width: 400, height: 300 },
      getData(visual, ctx) {
        const fmt = new FormatReader(visual.json, ctx.theme)
        const d = buildCategorical(visual.json, ctx, { seriesRole: 'Series', splitRoles: config.splitRoles, unsplitRoles: config.unsplitRoles, defaultSort: config.defaultSort, fmt })
        return categoricalTable(d)
      }
    }
    registerVisual(def)
  }
}
