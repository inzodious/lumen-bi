/** Format-pane cards of the treemap (PBI object / property names). */
import type { FormatCardDef } from '../../contract'
import { DISPLAY_UNIT_OPTIONS } from '../../common/units'
import { legendCard } from '../formatCards'

const text = (size: number, color?: string): FormatCardDef['properties'] => [
  { name: 'fontFamily', displayName: 'Font', type: 'fontFamily', default: 'Segoe UI' },
  { name: 'fontSize', displayName: 'Font size', type: 'fontSize', default: size },
  { name: 'bold', displayName: 'Bold', type: 'bool', default: false },
  { name: 'italic', displayName: 'Italic', type: 'bool', default: false },
  { name: 'color', displayName: 'Color', type: 'color', ...(color ? { default: color } : {}) }
]

export function treemapFormatCards(): FormatCardDef[] {
  return [
    legendCard(),
    { object: 'dataPoint', displayName: 'Colors', properties: [{ name: 'fill', displayName: 'Color', type: 'color', perSeries: true }] },
    {
      object: 'labels',
      displayName: 'Data labels',
      toggle: 'show',
      properties: [
        { name: 'show', displayName: 'Show', type: 'bool', default: false },
        ...text(9),
        { name: 'labelDisplayUnits', displayName: 'Display units', type: 'displayUnits', options: DISPLAY_UNIT_OPTIONS, default: 0 },
        { name: 'labelPrecision', displayName: 'Value decimal places', type: 'integer', min: 0, max: 15 }
      ]
    },
    { object: 'categoryLabels', displayName: 'Category labels', toggle: 'show', properties: [{ name: 'show', displayName: 'Show', type: 'bool', default: true }, ...text(10)] },
    {
      object: 'layout',
      displayName: 'Layout',
      properties: [
        {
          name: 'tilingMethod',
          displayName: 'Tiling method',
          type: 'enum',
          options: [
            { value: 'stableSquarified', label: 'Squarified' },
            { value: 'binary', label: 'Binary' },
            { value: 'alternating', label: 'Alternating' }
          ],
          default: 'stableSquarified'
        },
        { name: 'innerPadding', displayName: 'Inner padding (px)', type: 'integer', min: 0, max: 20, default: 1 },
        { name: 'outerPadding', displayName: 'Outer padding (px)', type: 'integer', min: 0, max: 20, default: 0 }
      ]
    }
  ]
}
