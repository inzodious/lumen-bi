/** Registers the pie and donut charts. */
import { registerVisual } from '../../registry'
import type { DataRoleDef, FormatCardDef, VisualDefinition, VisualHostContext } from '../../contract'
import type { VisualDocument } from '@core/report/types'
import { buildCategorical, categoricalTable } from '../../common/categorical'
import { FormatReader } from '../../common/fmtProps'
import { ICONS } from '../icons'
import { dataColorsCard, dataLabelsCard, legendCard, responsiveCard, smallMultiplesCard, smallMultiplesTitleCard } from '../formatCards'
import { makePieComponent } from './PieChart'

const tooltips: DataRoleDef = { name: 'Tooltips', displayName: 'Tooltips', kind: 'measure' }

function catData(opts: Parameters<typeof buildCategorical>[2]) {
  return (visual: VisualDocument, ctx: VisualHostContext) => categoricalTable(buildCategorical(visual.json, ctx, { ...opts, fmt: new FormatReader(visual.json, ctx.theme) }))
}

const slicesCard: FormatCardDef = {
  object: 'slices',
  displayName: 'Slices',
  properties: [
    { name: 'innerRadiusRatio', displayName: 'Inner radius', type: 'percent', min: 0, max: 90, default: 50 },
    { name: 'startAngle', displayName: 'Rotation', type: 'integer', min: 0, max: 360, default: 0 }
  ]
}

const rotationCard: FormatCardDef = {
  object: 'slices',
  displayName: 'Rotation',
  properties: [{ name: 'startAngle', displayName: 'Rotation', type: 'integer', min: 0, max: 360, default: 0 }]
}

const defs: VisualDefinition[] = [
  {
    type: 'pieChart',
    displayName: 'Pie chart',
    category: 'chart',
    icon: ICONS.pieChart,
    roles: [
      { name: 'Category', displayName: 'Legend', kind: 'grouping', drillable: true },
      { name: 'Y', displayName: 'Values', kind: 'measure' },
      { name: 'Series', displayName: 'Details', kind: 'grouping', max: 1 },
      { name: 'Rows', displayName: 'Small multiples', kind: 'grouping', max: 1 },
      tooltips
    ],
    formatCards: [legendCard('RightCenter'), rotationCard, dataColorsCard('Slices', { showAll: false }), dataLabelsCard('pie'), smallMultiplesCard, smallMultiplesTitleCard, responsiveCard],
    component: makePieComponent({ donut: false, icon: ICONS.pieChart }),
    getData: catData({ seriesRole: 'Series', splitRoles: ['Y'], defaultSort: 'measureDesc' }),
    supportsHighlight: true,
    supportsDrill: true
  },
  {
    type: 'donutChart',
    displayName: 'Donut chart',
    category: 'chart',
    icon: ICONS.donutChart,
    roles: [
      { name: 'Category', displayName: 'Legend', kind: 'grouping', drillable: true },
      { name: 'Y', displayName: 'Values', kind: 'measure' },
      { name: 'Series', displayName: 'Details', kind: 'grouping', max: 1 },
      { name: 'Rows', displayName: 'Small multiples', kind: 'grouping', max: 1 },
      tooltips
    ],
    formatCards: [legendCard('RightCenter'), slicesCard, dataColorsCard('Slices', { showAll: false }), dataLabelsCard('pie'), smallMultiplesCard, smallMultiplesTitleCard, responsiveCard],
    component: makePieComponent({ donut: true, icon: ICONS.donutChart }),
    getData: catData({ seriesRole: 'Series', splitRoles: ['Y'], defaultSort: 'measureDesc' }),
    supportsHighlight: true,
    supportsDrill: true
  },
]

export function registerPieCharts(): void {
  for (const d of defs) registerVisual({ inGallery: true, defaultSize: { width: 400, height: 300 }, ...d })
}
