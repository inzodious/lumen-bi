/** Format-pane cards of the waterfall chart (PBI object / property names). */
import type { FormatCardDef, FormatPropDef } from '../../contract'
import { categoryAxisCard, dataLabelsCard, legendCard, plotAreaCard, responsiveCard, valueAxisCard } from '../formatCards'
import { AXIS_STYLE_OPTIONS, lineCard } from '../scatter/scatterCards'
import { DEFAULT_MAX_BREAKDOWNS } from './waterfallMath'

function extend(card: FormatCardDef, extras: FormatPropDef[], drop: string[] = []): FormatCardDef {
  const names = new Set(card.properties.map((p) => p.name))
  return { ...card, properties: [...card.properties.filter((p) => !drop.includes(p.name)), ...extras.filter((p) => !names.has(p.name))] }
}

export function waterfallFormatCards(): FormatCardDef[] {
  return [
    legendCard(),
    extend(categoryAxisCard({ continuous: false }), [], ['concatenateLabels', 'gridlineShow', 'gridlineColor', 'gridlineThickness', 'gridlineStyle']),
    extend(
      valueAxisCard(),
      [
        { name: 'totalsEnabled', displayName: 'Total column', type: 'bool', default: true },
        { name: 'invertAxis', displayName: 'Invert range', type: 'bool', default: false },
        { name: 'switchAxisPosition', displayName: 'Switch axis position', type: 'bool', default: false },
        { name: 'axisStyle', displayName: 'Title style', type: 'enum', options: AXIS_STYLE_OPTIONS, default: 'showTitleOnly' },
        { name: 'gridlineTransparency', displayName: 'Gridline transparency', type: 'percent', min: 0, max: 100, default: 0 }
      ],
      ['axisScale', 'position']
    ),
    {
      object: 'sentimentColors',
      displayName: 'Columns',
      properties: [
        { name: 'increaseFill', displayName: 'Increase', type: 'color', default: '#1AAB40' },
        { name: 'decreaseFill', displayName: 'Decrease', type: 'color', default: '#D64554' },
        { name: 'totalFill', displayName: 'Total', type: 'color', default: '#118DFF' },
        { name: 'otherFill', displayName: 'Other', type: 'color', default: '#D9B300' }
      ]
    },
    { object: 'breakdown', displayName: 'Breakdown', properties: [{ name: 'maxBreakdowns', displayName: 'Max breakdowns', type: 'integer', min: 1, max: 28, default: DEFAULT_MAX_BREAKDOWNS }] },
    { ...dataLabelsCard('bar'), properties: dataLabelsCard('bar').properties.filter((p) => p.name !== 'showSeries') },
    plotAreaCard,
    lineCard('y1AxisReferenceLine', 'Y-axis constant line', [{ name: 'value', displayName: 'Value', type: 'number' }]),
    responsiveCard
  ]
}
