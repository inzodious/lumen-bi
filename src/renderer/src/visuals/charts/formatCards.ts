/**
 * Format-pane card definitions with Power BI's object/property names and display names.
 * Card builders are composed per visual type in ./index.ts.
 */
import type { FormatCardDef, FormatPropDef } from '../contract'
import { DISPLAY_UNIT_OPTIONS } from '../common/units'
import { PBI } from '../common/fmtProps'

const FONT_PROPS = (prefix = '', defaults: { size?: number } = {}): FormatPropDef[] => [
  { name: prefix ? `${prefix}FontFamily` : 'fontFamily', displayName: 'Font', type: 'fontFamily', default: 'Segoe UI' },
  { name: prefix ? `${prefix}FontSize` : 'fontSize', displayName: 'Font size', type: 'fontSize', default: defaults.size ?? 9 },
  { name: prefix ? `${prefix}Bold` : 'bold', displayName: 'Bold', type: 'bool', default: false },
  { name: prefix ? `${prefix}Italic` : 'italic', displayName: 'Italic', type: 'bool', default: false }
]

const enumOf = (values: Array<[string, string]>) => values.map(([value, label]) => ({ value, label }))

export const LEGEND_POSITIONS = enumOf([
  ['Top', 'Top left'],
  ['TopCenter', 'Top center'],
  ['Bottom', 'Bottom left'],
  ['BottomCenter', 'Bottom center'],
  ['Left', 'Left top'],
  ['LeftCenter', 'Left center'],
  ['Right', 'Right top'],
  ['RightCenter', 'Right center']
])

const GRIDLINE_PROPS = (defaultShow: boolean): FormatPropDef[] => [
  { name: 'gridlineShow', displayName: 'Gridlines', type: 'bool', default: defaultShow },
  { name: 'gridlineColor', displayName: 'Gridline color', type: 'color', default: '#C8C6C4' },
  { name: 'gridlineTransparency', displayName: 'Gridline transparency', type: 'percent', min: 0, max: 100, default: 0 },
  { name: 'gridlineThickness', displayName: 'Gridline width', type: 'integer', min: 1, max: 10, default: 1 },
  {
    name: 'gridlineStyle',
    displayName: 'Gridline style',
    type: 'enum',
    options: enumOf([
      ['dotted', 'Dotted'],
      ['dashed', 'Dashed'],
      ['solid', 'Solid'],
      ['custom', 'Custom']
    ]),
    default: 'dotted'
  },
  { name: 'gridlineDashArray', displayName: 'Dash array', type: 'text' }
]

const AXIS_STYLE: FormatPropDef = {
  name: 'axisStyle',
  displayName: 'Title style',
  type: 'enum',
  options: enumOf([
    ['showTitleOnly', 'Show title only'],
    ['showUnitOnly', 'Show unit only'],
    ['showBoth', 'Show both']
  ]),
  default: 'showTitleOnly'
}

export function legendCard(defaultPosition = 'Top', opts: { lineStyles?: boolean } = {}): FormatCardDef {
  return {
    object: 'legend',
    displayName: 'Legend',
    toggle: 'show',
    properties: [
      { name: 'show', displayName: 'Show', type: 'bool', default: true },
      { name: 'position', displayName: 'Position', type: 'enum', options: LEGEND_POSITIONS, default: defaultPosition },
      { name: 'showTitle', displayName: 'Title', type: 'bool', default: true },
      { name: 'titleText', displayName: 'Title text', type: 'text' },
      ...FONT_PROPS('', { size: 8 }),
      { name: 'labelColor', displayName: 'Color', type: 'color', default: '#605E5C' },
      ...(opts.lineStyles
        ? [
            {
              name: 'legendMarkerRendering',
              displayName: 'Style',
              type: 'enum' as const,
              options: enumOf([
                ['markerCircleDefault', 'Markers'],
                ['lineAndMarker', 'Line and markers'],
                ['lineOnly', 'Line'],
                ['markerOnly', 'Markers only']
              ]),
              default: 'markerCircleDefault'
            }
          ]
        : [])
    ]
  }
}

export function categoryAxisCard(opts: { displayName?: string; continuous?: boolean } = {}): FormatCardDef {
  return {
    object: 'categoryAxis',
    displayName: opts.displayName ?? 'X-axis',
    toggle: 'show',
    properties: [
      { name: 'show', displayName: 'Show', type: 'bool', default: true },
      ...(opts.continuous !== false
        ? [
            {
              name: 'axisType',
              displayName: 'Type',
              type: 'enum' as const,
              options: enumOf([
                ['Scalar', 'Continuous'],
                ['Categorical', 'Categorical']
              ])
            },
            { name: 'start', displayName: 'Minimum', type: 'number' as const },
            { name: 'end', displayName: 'Maximum', type: 'number' as const }
          ]
        : []),
      ...FONT_PROPS(),
      { name: 'labelColor', displayName: 'Color', type: 'color', default: '#605E5C' },
      { name: 'labelDisplayUnits', displayName: 'Display units', type: 'displayUnits', options: DISPLAY_UNIT_OPTIONS },
      { name: 'labelPrecision', displayName: 'Value decimal places', type: 'integer', min: 0, max: 15 },
      { name: 'invertAxis', displayName: 'Invert range', type: 'bool', default: false },
      { name: 'concatenateLabels', displayName: 'Concatenate labels', type: 'bool', default: false },
      {
        name: 'initialScrollPosition',
        displayName: 'Initial scroll position',
        type: 'enum',
        options: enumOf([
          ['start', 'Start'],
          ['end', 'End']
        ]),
        default: 'start'
      },
      { name: 'innerPadding', displayName: 'Inner padding', type: 'percent', min: 0, max: 50, default: 20 },
      { name: 'preferredCategoryWidth', displayName: 'Minimum category width', type: 'integer', min: 4, max: 200, default: 20 },
      { name: 'maxMarginFactor', displayName: 'Maximum height', type: 'percent', min: 10, max: 50, default: 25 },
      { name: 'showAxisTitle', displayName: 'Title', type: 'bool', default: true },
      { name: 'titleText', displayName: 'Title text', type: 'text' },
      { name: 'titleColor', displayName: 'Title color', type: 'color', default: '#252423' },
      ...FONT_PROPS('title', { size: 12 }),
      ...GRIDLINE_PROPS(false)
    ]
  }
}

export function valueAxisCard(opts: { displayName?: string; secondary?: boolean; percent?: boolean } = {}): FormatCardDef {
  const props: FormatPropDef[] = [
    { name: 'show', displayName: 'Show', type: 'bool', default: true },
    { name: 'switchAxisPosition', displayName: 'Switch axis position', type: 'bool', default: false },
    { name: 'invertAxis', displayName: 'Invert range', type: 'bool', default: false },
    {
      name: 'axisScale',
      displayName: 'Scale type',
      type: 'enum',
      options: enumOf([
        ['linear', 'Linear'],
        ['log', 'Log']
      ]),
      default: 'linear'
    },
    { name: 'start', displayName: 'Minimum', type: 'number' },
    { name: 'end', displayName: 'Maximum', type: 'number' },
    ...FONT_PROPS(),
    { name: 'labelColor', displayName: 'Color', type: 'color', default: '#605E5C' },
    { name: 'labelDisplayUnits', displayName: 'Display units', type: 'displayUnits', options: DISPLAY_UNIT_OPTIONS, default: 0 },
    { name: 'labelPrecision', displayName: 'Value decimal places', type: 'integer', min: 0, max: 15 },
    { name: 'showAxisTitle', displayName: 'Title', type: 'bool', default: true },
    { name: 'titleText', displayName: 'Title text', type: 'text' },
    AXIS_STYLE,
    { name: 'titleColor', displayName: 'Title color', type: 'color', default: '#252423' },
    ...FONT_PROPS('title', { size: 12 }),
    ...GRIDLINE_PROPS(true)
  ]
  if (opts.secondary)
    props.push(
      { name: 'secShow', displayName: 'Secondary y-axis', type: 'bool', default: true },
      { name: 'secStart', displayName: 'Secondary minimum', type: 'number' },
      { name: 'secEnd', displayName: 'Secondary maximum', type: 'number' },
      { name: 'secLabelColor', displayName: 'Secondary color', type: 'color', default: '#605E5C' },
      { name: 'secFontSize', displayName: 'Secondary font size', type: 'fontSize', default: 9 },
      { name: 'secLabelDisplayUnits', displayName: 'Secondary display units', type: 'displayUnits', options: DISPLAY_UNIT_OPTIONS },
      { name: 'secLabelPrecision', displayName: 'Secondary decimal places', type: 'integer', min: 0, max: 15 },
      { name: 'secShowAxisTitle', displayName: 'Secondary title', type: 'bool', default: true },
      { name: 'secTitleText', displayName: 'Secondary title text', type: 'text' }
    )
  return { object: 'valueAxis', displayName: opts.displayName ?? 'Y-axis', toggle: 'show', properties: props }
}

export function dataColorsCard(displayName = 'Columns', opts: { showAll?: boolean } = {}): FormatCardDef {
  return {
    object: 'dataPoint',
    displayName,
    properties: [
      { name: 'defaultColor', displayName: 'Default color', type: 'color' },
      { name: 'fill', displayName: 'Color', type: 'color', perSeries: true },
      ...(opts.showAll !== false ? [{ name: 'showAllDataPoints', displayName: 'Show all', type: 'bool' as const, default: false }] : []),
      { name: 'fillTransparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 0 }
    ]
  }
}

export function dataLabelsCard(kind: 'bar' | 'line' | 'pie' = 'bar'): FormatCardDef {
  const positions =
    kind === 'line'
      ? enumOf([
          ['Auto', 'Auto'],
          ['Above', 'Above'],
          ['Below', 'Below'],
          ['Center', 'Center'],
          ['Left', 'Left'],
          ['Right', 'Right']
        ])
      : kind === 'pie'
        ? enumOf([
            ['preferOutside', 'Prefer outside'],
            ['outside', 'Outside'],
            ['inside', 'Inside'],
            ['preferInside', 'Prefer inside']
          ])
        : enumOf([
            ['Auto', 'Auto'],
            ['InsideEnd', 'Inside end'],
            ['OutsideEnd', 'Outside end'],
            ['InsideCenter', 'Inside center'],
            ['InsideBase', 'Inside base']
          ])
  const props: FormatPropDef[] = [
    { name: 'show', displayName: 'Show', type: 'bool', default: false },
    { name: 'showSeries', displayName: 'Show for this series', type: 'bool', default: true, perSeries: true },
    { name: kind === 'pie' ? 'position' : 'labelPosition', displayName: 'Position', type: 'enum', options: positions },
    ...FONT_PROPS(),
    { name: 'color', displayName: 'Color', type: 'color' },
    { name: 'labelDisplayUnits', displayName: 'Display units', type: 'displayUnits', options: DISPLAY_UNIT_OPTIONS, default: 0 },
    { name: 'labelPrecision', displayName: 'Value decimal places', type: 'integer', min: 0, max: 15 },
    { name: 'enableBackground', displayName: 'Background', type: 'bool', default: false },
    { name: 'backgroundColor', displayName: 'Background color', type: 'color', default: '#FFFFFF' },
    { name: 'backgroundTransparency', displayName: 'Background transparency', type: 'percent', min: 0, max: 100, default: 90 }
  ]
  if (kind === 'line') props.push({ name: 'labelDensity', displayName: 'Label density', type: 'percent', min: 0, max: 100, default: 50 })
  if (kind === 'pie')
    props.push(
      {
        name: 'labelStyle',
        displayName: 'Label contents',
        type: 'enum',
        options: enumOf([
          ['Category', 'Category'],
          ['Data', 'Data value'],
          ['Percent of total', 'Percent of total'],
          ['Both', 'Category, data value'],
          ['Category, percent of total', 'Category, percent of total'],
          ['Data value, percent of total', 'Data value, percent of total'],
          ['Category, data value, percent of total', 'All detail labels']
        ]),
        default: 'Data value, percent of total'
      },
      { name: 'percentageLabelPrecision', displayName: 'Percentage decimal places', type: 'integer', min: 0, max: 15 },
      { name: 'overflow', displayName: 'Overflow text', type: 'bool', default: false },
      {
        name: 'background',
        displayName: 'Background',
        type: 'enum',
        options: enumOf([
          ['off', 'Off'],
          ['on', 'On'],
          ['auto', 'Auto']
        ]),
        default: 'off'
      }
    )
  return { object: 'labels', displayName: 'Data labels', toggle: 'show', properties: props }
}

export const totalsCard: FormatCardDef = {
  object: 'totals',
  displayName: 'Total labels',
  toggle: 'show',
  properties: [
    { name: 'show', displayName: 'Show', type: 'bool', default: false },
    ...FONT_PROPS(),
    // CartesianChart draws stacked totals in the data-label class
    { name: 'color', displayName: 'Color', type: 'color', default: PBI.dataLabelColor },
    { name: 'labelDisplayUnits', displayName: 'Display units', type: 'displayUnits', options: DISPLAY_UNIT_OPTIONS, default: 0 },
    { name: 'labelPrecision', displayName: 'Value decimal places', type: 'integer', min: 0, max: 15 }
  ]
}

export const plotAreaCard: FormatCardDef = {
  object: 'plotArea',
  displayName: 'Plot area background',
  properties: [
    { name: 'color', displayName: 'Color', type: 'color' },
    { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 0 }
  ]
}

export function linesCard(opts: { area?: boolean } = {}): FormatCardDef {
  return {
    object: 'lineStyles',
    displayName: 'Lines',
    properties: [
      { name: 'strokeWidth', displayName: 'Width', type: 'integer', min: 0, max: 20, default: 3, perSeries: true },
      {
        name: 'lineStyle',
        displayName: 'Line style',
        type: 'enum',
        perSeries: true,
        options: enumOf([
          ['solid', 'Solid'],
          ['dashed', 'Dashed'],
          ['dotted', 'Dotted'],
          ['custom', 'Custom']
        ]),
        default: 'solid'
      },
      { name: 'strokeDashArray', displayName: 'Dash array', type: 'text', perSeries: true },
      { name: 'strokeTransparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 0, perSeries: true },
      {
        name: 'lineChartType',
        displayName: 'Interpolation type',
        type: 'enum',
        perSeries: true,
        options: enumOf([
          ['linear', 'Linear'],
          ['smooth', 'Smooth'],
          ['step', 'Step']
        ]),
        default: 'linear'
      },
      {
        name: 'interpolationStep',
        displayName: 'Step position',
        type: 'enum',
        perSeries: true,
        options: enumOf([
          ['before', 'Before'],
          ['center', 'Center'],
          ['after', 'After']
        ]),
        default: 'center'
      },
      { name: 'areaShow', displayName: 'Shade area', type: 'bool', default: !!opts.area, perSeries: true },
      { name: 'areaMatchStrokeColor', displayName: 'Area: match line color', type: 'bool', default: true, perSeries: true },
      { name: 'areaColor', displayName: 'Area color', type: 'color', perSeries: true },
      { name: 'areaTransparency', displayName: 'Area transparency', type: 'percent', min: 0, max: 100, default: 60, perSeries: true },
      { name: 'showMarker', displayName: 'Markers', type: 'bool', default: false, perSeries: true },
      {
        name: 'markerShape',
        displayName: 'Marker shape',
        type: 'enum',
        perSeries: true,
        options: enumOf([
          ['circle', '●'],
          ['square', '■'],
          ['diamond', '◆'],
          ['triangle', '▲'],
          ['x', '✕'],
          ['shortDash', '–'],
          ['longDash', '—'],
          ['plus', '+']
        ]),
        default: 'circle'
      },
      { name: 'markerSize', displayName: 'Marker size', type: 'integer', min: 1, max: 30, default: 5, perSeries: true },
      { name: 'markerColor', displayName: 'Marker color', type: 'color', perSeries: true }
    ]
  }
}

export const responsiveCard: FormatCardDef = {
  object: 'general',
  displayName: 'Properties',
  tab: 'general',
  properties: [{ name: 'responsive', displayName: 'Responsive', type: 'bool', default: true }]
}

function refLineCard(object: string, displayName: string, extra: FormatPropDef[] = [], extraAfter: FormatPropDef[] = []): FormatCardDef {
  return {
    object,
    displayName,
    toggle: 'show',
    properties: [
      { name: 'show', displayName: 'Show', type: 'bool', default: false },
      { name: 'displayName', displayName: 'Name', type: 'text' },
      ...extra,
      { name: 'lineColor', displayName: 'Color', type: 'color', default: '#605E5C' },
      { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 0 },
      {
        name: 'style',
        displayName: 'Style',
        type: 'enum',
        options: enumOf([
          ['dashed', 'Dashed'],
          ['solid', 'Solid'],
          ['dotted', 'Dotted']
        ]),
        default: 'dashed'
      },
      {
        name: 'position',
        displayName: 'Position',
        type: 'enum',
        options: enumOf([
          ['front', 'In front'],
          ['behind', 'Behind']
        ]),
        default: 'front'
      },
      { name: 'width', displayName: 'Width', type: 'integer', min: 1, max: 10, default: 1 },
      { name: 'dashArray', displayName: 'Dash array', type: 'text' },
      { name: 'dataLabelShow', displayName: 'Data label', type: 'bool', default: false },
      {
        name: 'dataLabelText',
        displayName: 'Label text',
        type: 'enum',
        options: enumOf([
          ['Value', 'Value'],
          ['Name', 'Name'],
          ['ValueAndName', 'Name and value']
        ]),
        default: 'Value'
      },
      { name: 'dataLabelColor', displayName: 'Label color', type: 'color' },
      {
        name: 'dataLabelHorizontalPosition',
        displayName: 'Horizontal position',
        type: 'enum',
        options: enumOf([
          ['left', 'Left'],
          ['right', 'Right']
        ]),
        default: 'right'
      },
      {
        name: 'dataLabelVerticalPosition',
        displayName: 'Vertical position',
        type: 'enum',
        options: enumOf([
          ['above', 'Above'],
          ['under', 'Under']
        ]),
        default: 'above'
      },
      { name: 'dataLabelDisplayUnits', displayName: 'Display units', type: 'displayUnits', options: DISPLAY_UNIT_OPTIONS, default: 0 },
      { name: 'dataLabelDecimalPoints', displayName: 'Value decimal places', type: 'integer', min: 0, max: 15 },
      { name: 'shadeShow', displayName: 'Shade area', type: 'bool', default: false },
      {
        name: 'shadeRegion',
        displayName: 'Shade region',
        type: 'enum',
        options: enumOf([
          ['none', 'None'],
          ['before', 'Before'],
          ['after', 'After']
        ]),
        default: 'none'
      },
      { name: 'shadeColor', displayName: 'Shade color', type: 'color' },
      { name: 'shadeTransparency', displayName: 'Shade transparency', type: 'percent', min: 0, max: 100, default: 70 },
      ...extraAfter
    ]
  }
}

export const analyticsCards: FormatCardDef[] = [
  refLineCard('y1AxisReferenceLine', 'Y-axis constant line', [{ name: 'value', displayName: 'Value', type: 'number' }]),
  refLineCard('minLine', 'Min line'),
  refLineCard('maxLine', 'Max line'),
  refLineCard('averageLine', 'Average line'),
  refLineCard('medianLine', 'Median line'),
  refLineCard('percentileLine', 'Percentile line', [{ name: 'percentile', displayName: 'Percentile', type: 'percent', min: 0, max: 100, default: 50 }]),
  refLineCard('trend', 'Trend line', [], [
    { name: 'combineSeries', displayName: 'Combine series', type: 'bool', default: true },
    { name: 'useHighlightValues', displayName: 'Use highlight values', type: 'bool', default: false }
  ])
]

/** X-axis constant line (continuous X axes only). */
export const xConstantLineCard: FormatCardDef = refLineCard('xAxisReferenceLine', 'X-axis constant line', [{ name: 'value', displayName: 'Value', type: 'number' }])

/** Analytics ▸ Error bars (bounds are bound to measures in the Analytics pane). */
export const errorBarsCard: FormatCardDef = {
  object: 'error',
  displayName: 'Error bars',
  toggle: 'enabled',
  properties: [
    { name: 'enabled', displayName: 'Enabled', type: 'bool', default: false },
    { name: 'barShow', displayName: 'Bar', type: 'bool', default: true },
    { name: 'barMatchSeriesColor', displayName: 'Match series color', type: 'bool', default: false },
    { name: 'barColor', displayName: 'Bar color', type: 'color' },
    { name: 'barWidth', displayName: 'Bar width', type: 'integer', min: 1, max: 10, default: 1 },
    { name: 'barBorderSize', displayName: 'Border size', type: 'integer', min: 0, max: 10, default: 0 },
    { name: 'barBorderColor', displayName: 'Border color', type: 'color', default: '#FFFFFF' },
    { name: 'markerShow', displayName: 'Markers', type: 'bool', default: true },
    {
      name: 'markerShape',
      displayName: 'Marker shape',
      type: 'enum',
      options: enumOf([
        ['shortDash', 'Short dash'],
        ['longDash', 'Long dash'],
        ['circle', 'Circle'],
        ['square', 'Square'],
        ['diamond', 'Diamond'],
        ['triangle', 'Triangle'],
        ['x', 'X'],
        ['plus', 'Plus'],
        ['none', 'None']
      ]),
      default: 'shortDash'
    },
    { name: 'markerSize', displayName: 'Marker size', type: 'integer', min: 1, max: 30, default: 8 },
    { name: 'shadeShow', displayName: 'Error band', type: 'bool', default: false },
    {
      name: 'shadeBandStyle',
      displayName: 'Band style',
      type: 'enum',
      options: enumOf([
        ['fill', 'Fill'],
        ['line', 'Line'],
        ['fillLine', 'Fill and line']
      ]),
      default: 'fill'
    },
    { name: 'shadeTransparency', displayName: 'Band transparency', type: 'percent', min: 0, max: 100, default: 80 },
    { name: 'tooltipShow', displayName: 'Tooltip', type: 'bool', default: true },
    {
      name: 'tooltipFormat',
      displayName: 'Tooltip format',
      type: 'enum',
      options: enumOf([
        ['absolute', 'Absolute'],
        ['relativeNumeric', 'Relative (numeric)'],
        ['relativePercentage', 'Relative (percentage)'],
        ['range', 'Range']
      ]),
      default: 'absolute'
    }
  ]
}

/** Analytics ▸ Find anomalies (line charts). */
export const anomalyCard: FormatCardDef = {
  object: 'anomalyDetection',
  displayName: 'Find anomalies',
  toggle: 'show',
  properties: [
    { name: 'show', displayName: 'Show', type: 'bool', default: false },
    { name: 'sensitivity', displayName: 'Sensitivity', type: 'percent', min: 0, max: 100, default: 70 },
    { name: 'markerShow', displayName: 'Anomaly marker', type: 'bool', default: true },
    {
      name: 'markerShape',
      displayName: 'Marker shape',
      type: 'enum',
      options: enumOf([
        ['circle', 'Circle'],
        ['square', 'Square'],
        ['diamond', 'Diamond'],
        ['triangle', 'Triangle']
      ]),
      default: 'circle'
    },
    { name: 'markerShapeSize', displayName: 'Marker size', type: 'integer', min: 2, max: 20, default: 6 },
    { name: 'markerColor', displayName: 'Marker color', type: 'color', default: '#6B007B' },
    { name: 'confidenceBandShow', displayName: 'Expected range', type: 'bool', default: true },
    {
      name: 'confidenceBandStyle',
      displayName: 'Range style',
      type: 'enum',
      options: enumOf([
        ['fill', 'Fill'],
        ['line', 'Line'],
        ['none', 'None']
      ]),
      default: 'fill'
    },
    { name: 'confidenceBandColor', displayName: 'Range color', type: 'color' },
    { name: 'transparency', displayName: 'Range transparency', type: 'percent', min: 0, max: 100, default: 80 }
  ]
}

/** Format ▸ Zoom slider. */
export const zoomCard: FormatCardDef = {
  object: 'zoom',
  displayName: 'Zoom slider',
  toggle: 'show',
  properties: [
    { name: 'show', displayName: 'Show', type: 'bool', default: false },
    { name: 'showOnCategoryAxis', displayName: 'X axis', type: 'bool', default: true },
    { name: 'showOnValueAxis', displayName: 'Y axis', type: 'bool', default: false }
  ]
}

/** Format ▸ Series labels (line charts). */
export const seriesLabelsCard: FormatCardDef = {
  object: 'seriesLabels',
  displayName: 'Series labels',
  toggle: 'show',
  properties: [
    { name: 'show', displayName: 'Show', type: 'bool', default: false },
    {
      name: 'seriesPosition',
      displayName: 'Position',
      type: 'enum',
      options: enumOf([
        ['Right', 'Right'],
        ['Left', 'Left']
      ]),
      default: 'Right'
    },
    { name: 'seriesFontFamily', displayName: 'Font', type: 'fontFamily', default: 'Segoe UI' },
    { name: 'textSize', displayName: 'Font size', type: 'fontSize', default: 9 },
    { name: 'bold', displayName: 'Bold', type: 'bool', default: false },
    { name: 'italic', displayName: 'Italic', type: 'bool', default: false },
    { name: 'seriesMatchColor', displayName: 'Match series color', type: 'bool', default: true },
    { name: 'seriesColor', displayName: 'Color', type: 'color', default: '#605E5C' },
    { name: 'seriesMaximumWidth', displayName: 'Maximum width', type: 'integer', min: 20, max: 400, default: 120 },
    { name: 'leaderLines', displayName: 'Leader lines', type: 'bool', default: true },
    { name: 'enableBackground', displayName: 'Background', type: 'bool', default: false },
    { name: 'backgroundMatchColor', displayName: 'Background: match series color', type: 'bool', default: false },
    { name: 'backgroundColor', displayName: 'Background color', type: 'color', default: '#FFFFFF' },
    { name: 'backgroundTransparency', displayName: 'Background transparency', type: 'percent', min: 0, max: 100, default: 0 }
  ]
}

/** Secondary y-axis (current PBI object; older reports keep these as valueAxis.sec*). */
export const y2AxisCard: FormatCardDef = {
  object: 'y2Axis',
  displayName: 'Secondary y-axis',
  toggle: 'show',
  properties: [
    { name: 'show', displayName: 'Show', type: 'bool', default: true },
    { name: 'secStart', displayName: 'Minimum', type: 'number' },
    { name: 'secEnd', displayName: 'Maximum', type: 'number' },
    { name: 'secLogAxisScale', displayName: 'Logarithmic scale', type: 'bool', default: false },
    { name: 'secFontFamily', displayName: 'Font', type: 'fontFamily', default: 'Segoe UI' },
    { name: 'secFontSize', displayName: 'Font size', type: 'fontSize', default: 9 },
    { name: 'secLabelColor', displayName: 'Color', type: 'color', default: '#605E5C' },
    { name: 'secLabelDisplayUnits', displayName: 'Display units', type: 'displayUnits', options: DISPLAY_UNIT_OPTIONS },
    { name: 'secLabelPrecision', displayName: 'Value decimal places', type: 'integer', min: 0, max: 15 },
    { name: 'secShowAxisTitle', displayName: 'Title', type: 'bool', default: true },
    { name: 'secTitleText', displayName: 'Title text', type: 'text' },
    { ...AXIS_STYLE, name: 'secAxisStyle' }
  ]
}

export const smallMultiplesCard: FormatCardDef = {
  object: 'smallMultiplesLayout',
  displayName: 'Small multiples',
  properties: [
    {
      name: 'layoutType',
      displayName: 'Layout',
      type: 'enum',
      options: enumOf([
        ['auto', 'Auto grid'],
        ['custom', 'Custom']
      ]),
      default: 'auto'
    },
    { name: 'rowCount', displayName: 'Rows', type: 'integer', min: 1, max: 6, default: 2 },
    { name: 'columnCount', displayName: 'Columns', type: 'integer', min: 1, max: 6, default: 3 },
    { name: 'gridPadding', displayName: 'Padding', type: 'integer', min: 0, max: 40, default: 0 },
    { name: 'gridLineShow', displayName: 'Gridlines', type: 'bool', default: true },
    {
      name: 'gridLineType',
      displayName: 'Gridline type',
      type: 'enum',
      options: enumOf([
        ['inner', 'Inner'],
        ['all', 'All'],
        ['innerHorizontal', 'Inner horizontal'],
        ['innerVertical', 'Inner vertical']
      ]),
      default: 'inner'
    },
    { name: 'gridLineColor', displayName: 'Gridline color', type: 'color', default: '#E1DFDD' },
    { name: 'gridLineWidth', displayName: 'Gridline width', type: 'integer', min: 1, max: 10, default: 1 },
    {
      name: 'gridLineStyle',
      displayName: 'Gridline style',
      type: 'enum',
      options: enumOf([
        ['solid', 'Solid'],
        ['dashed', 'Dashed'],
        ['dotted', 'Dotted']
      ]),
      default: 'solid'
    },
    { name: 'backgroundColor', displayName: 'Background color', type: 'color' },
    { name: 'backgroundTransparency', displayName: 'Background transparency', type: 'percent', min: 0, max: 100, default: 0 }
  ]
}

/** Small multiples panel titles (PBIR object `subheader`). */
export const smallMultiplesTitleCard: FormatCardDef = {
  object: 'subheader',
  displayName: 'Small multiple title',
  toggle: 'show',
  properties: [
    { name: 'show', displayName: 'Show', type: 'bool', default: true },
    { name: 'fontFamily', displayName: 'Font', type: 'fontFamily', default: 'Segoe UI' },
    { name: 'fontSize', displayName: 'Font size', type: 'fontSize', default: 10 },
    { name: 'bold', displayName: 'Bold', type: 'bool', default: false },
    { name: 'italic', displayName: 'Italic', type: 'bool', default: false },
    { name: 'fontColor', displayName: 'Color', type: 'color', default: '#252423' },
    { name: 'alignment', displayName: 'Alignment', type: 'alignment', default: 'left' },
    {
      name: 'position',
      displayName: 'Position',
      type: 'enum',
      options: enumOf([
        ['top', 'Top'],
        ['bottom', 'Bottom']
      ]),
      default: 'top'
    }
  ]
}
