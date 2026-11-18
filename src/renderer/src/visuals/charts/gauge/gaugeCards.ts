/** Format-pane cards of the gauge and KPI visuals (PBI object / property names). */
import type { FormatCardDef, FormatPropDef } from '../../contract'
import { DISPLAY_UNIT_OPTIONS } from '../../common/units'

const opt = (values: Array<[string, string]>) => values.map(([value, label]) => ({ value, label }))
const font = (prefix = '', size = 9, withSize = true): FormatPropDef[] => [
  { name: prefix ? `${prefix}FontFamily` : 'fontFamily', displayName: 'Font', type: 'fontFamily', default: 'Segoe UI' },
  ...(withSize ? [{ name: 'fontSize', displayName: 'Font size', type: 'fontSize' as const, default: size }] : []),
  { name: 'bold', displayName: 'Bold', type: 'bool', default: false },
  { name: 'italic', displayName: 'Italic', type: 'bool', default: false }
]
const units = (prefix = 'label'): FormatPropDef[] => [
  { name: `${prefix}DisplayUnits`, displayName: 'Display units', type: 'displayUnits', options: DISPLAY_UNIT_OPTIONS, default: 0 },
  { name: `${prefix}Precision`, displayName: 'Value decimal places', type: 'integer', min: 0, max: 15 }
]

export function gaugeFormatCards(): FormatCardDef[] {
  return [
    { object: 'axis', displayName: 'Gauge axis', properties: [{ name: 'min', displayName: 'Min', type: 'number' }, { name: 'max', displayName: 'Max', type: 'number' }, { name: 'target', displayName: 'Target', type: 'number' }] },
    {
      object: 'dataPoint',
      displayName: 'Colors',
      properties: [
        { name: 'fill', displayName: 'Fill color', type: 'color', default: '#118DFF' },
        { name: 'background', displayName: 'Background', type: 'color', default: '#E6E6E6' },
        { name: 'target', displayName: 'Target color', type: 'color', default: '#605E5C' }
      ]
    },
    { object: 'labels', displayName: 'Data labels', toggle: 'show', properties: [{ name: 'show', displayName: 'Show', type: 'bool', default: true }, ...font(), { name: 'color', displayName: 'Color', type: 'color', default: '#605E5C' }, ...units()] },
    { object: 'target', displayName: 'Target label', toggle: 'show', properties: [{ name: 'show', displayName: 'Show', type: 'bool', default: true }, ...font(), { name: 'color', displayName: 'Color', type: 'color', default: '#605E5C' }, ...units()] },
    { object: 'calloutValue', displayName: 'Callout value', toggle: 'show', properties: [{ name: 'show', displayName: 'Show', type: 'bool', default: true }, ...font('', 45, false), { name: 'color', displayName: 'Color', type: 'color', default: '#252423' }, ...units()] }
  ]
}

export function kpiFormatCards(): FormatCardDef[] {
  return [
    {
      object: 'indicator',
      displayName: 'Callout value',
      properties: [
        ...font('', 45),
        { name: 'fontColor', displayName: 'Color', type: 'color', default: '#252423' },
        { name: 'indicatorDisplayUnits', displayName: 'Display units', type: 'displayUnits', options: DISPLAY_UNIT_OPTIONS, default: 0 },
        { name: 'indicatorPrecision', displayName: 'Value decimal places', type: 'integer', min: 0, max: 15 },
        {
          name: 'horizontalAlignment',
          displayName: 'Horizontal alignment',
          type: 'enum',
          options: opt([
            ['left', 'Left'],
            ['center', 'Center'],
            ['right', 'Right']
          ]),
          default: 'center'
        },
        {
          name: 'verticalAlignment',
          displayName: 'Vertical alignment',
          type: 'enum',
          options: opt([
            ['top', 'Top'],
            ['middle', 'Middle'],
            ['bottom', 'Bottom']
          ]),
          default: 'middle'
        },
        { name: 'showIcon', displayName: 'Icon', type: 'bool', default: true },
        { name: 'iconSize', displayName: 'Icon size', type: 'fontSize' }
      ]
    },
    { object: 'trendline', displayName: 'Trend axis', toggle: 'show', properties: [{ name: 'show', displayName: 'Show', type: 'bool', default: true }, { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 20 }] },
    {
      object: 'goals',
      displayName: 'Target label',
      properties: [
        { name: 'showGoal', displayName: 'Show target', type: 'bool', default: true },
        { name: 'goalText', displayName: 'Label', type: 'text', default: 'Goal' },
        { name: 'goalFontFamily', displayName: 'Font', type: 'fontFamily', default: 'Segoe UI' },
        { name: 'fontSize', displayName: 'Font size', type: 'fontSize', default: 9 },
        { name: 'bold', displayName: 'Bold', type: 'bool', default: false },
        { name: 'italic', displayName: 'Italic', type: 'bool', default: false },
        { name: 'goalFontColor', displayName: 'Color', type: 'color', default: '#605E5C' },
        { name: 'showDistance', displayName: 'Show distance', type: 'bool', default: true },
        {
          name: 'distanceLabel',
          displayName: 'Distance label',
          type: 'enum',
          options: opt([
            ['Percent', 'Percent'],
            ['Value', 'Value'],
            ['Value, percent', 'Value, percent']
          ]),
          default: 'Percent'
        },
        { name: 'labelPrecision', displayName: 'Distance decimal places', type: 'integer', min: 0, max: 15, default: 2 },
        { name: 'distanceFontFamily', displayName: 'Distance font', type: 'fontFamily', default: 'Segoe UI' },
        { name: 'distanceFontColor', displayName: 'Distance color', type: 'color' },
        {
          name: 'direction',
          displayName: 'Direction',
          type: 'enum',
          options: opt([
            ['High is good', 'High is good'],
            ['Low is good', 'Low is good']
          ])
        }
      ]
    },
    {
      object: 'status',
      displayName: 'Color coding',
      properties: [
        {
          name: 'direction',
          displayName: 'Direction',
          type: 'enum',
          options: opt([
            ['Positive', 'High is good'],
            ['Negative', 'Low is good']
          ]),
          default: 'Positive'
        },
        { name: 'goodColor', displayName: 'Good color', type: 'color', default: '#1AAB40' },
        { name: 'neutralColor', displayName: 'Neutral color', type: 'color', default: '#D9B300' },
        { name: 'badColor', displayName: 'Bad color', type: 'color', default: '#D64554' }
      ]
    },
    {
      object: 'lastDate',
      displayName: 'Date',
      toggle: 'show',
      properties: [
        { name: 'show', displayName: 'Show', type: 'bool', default: false },
        { name: 'lastDateFontFamily', displayName: 'Font', type: 'fontFamily', default: 'Segoe UI' },
        { name: 'fontSize', displayName: 'Font size', type: 'fontSize', default: 9 },
        { name: 'lastDateFontColor', displayName: 'Color', type: 'color', default: '#605E5C' }
      ]
    }
  ]
}
