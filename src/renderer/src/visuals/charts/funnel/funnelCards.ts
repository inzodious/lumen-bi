/** Format-pane cards of the funnel (PBI object / property names). */
import type { FormatCardDef } from '../../contract'
import { dataColorsCard, dataLabelsCard } from '../formatCards'

const opt = (values: Array<[string, string]>) => values.map(([value, label]) => ({ value, label }))
const textProps = (color: string): FormatCardDef['properties'] => [
  { name: 'fontFamily', displayName: 'Font', type: 'fontFamily', default: 'Segoe UI' },
  { name: 'fontSize', displayName: 'Font size', type: 'fontSize', default: 9 },
  { name: 'bold', displayName: 'Bold', type: 'bool', default: false },
  { name: 'italic', displayName: 'Italic', type: 'bool', default: false },
  { name: 'color', displayName: 'Color', type: 'color', default: color }
]

export function funnelFormatCards(): FormatCardDef[] {
  const labels = dataLabelsCard('bar')
  return [
    { ...dataColorsCard('Colors'), properties: dataColorsCard('Colors').properties.filter((p) => p.name !== 'fillTransparency') },
    {
      ...labels,
      properties: [
        ...labels.properties.filter((p) => p.name !== 'showSeries').map((p) => (p.name === 'show' ? { ...p, default: true } : p)),
        {
          name: 'funnelLabelStyle',
          displayName: 'Label contents',
          type: 'enum',
          options: opt([
            ['Data', 'Data value'],
            ['Percent of first', 'Percent of first'],
            ['Percent of previous', 'Percent of previous'],
            ['Data, percent of first', 'Data value, percent of first'],
            ['Data, percent of previous', 'Data value, percent of previous']
          ]),
          default: 'Data'
        },
        { name: 'percentageLabelPrecision', displayName: 'Percentage decimal places', type: 'integer', min: 0, max: 15, default: 2 }
      ]
    },
    { object: 'categoryAxis', displayName: 'Category labels', toggle: 'show', properties: [{ name: 'show', displayName: 'Show', type: 'bool', default: true }, ...textProps('#605E5C')] },
    { object: 'percentBarLabel', displayName: 'Conversion rate label', toggle: 'show', properties: [{ name: 'show', displayName: 'Show', type: 'bool', default: true }, ...textProps('#605E5C')] }
  ]
}
