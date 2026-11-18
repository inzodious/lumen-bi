/**
 * Format-pane cards of the scatter chart (object / property names from Power BI's report-theme
 * schema for `scatterChart`). Built on the shared card builders, extended with the scatter-only
 * properties (log scale, invert, axis style, gridline width/transparency, markers, bubbles…).
 */
import type { FormatCardDef, FormatPropDef } from '../../contract'
import { categoryAxisCard, legendCard, plotAreaCard, responsiveCard, valueAxisCard } from '../formatCards'

const opt = (values: Array<[string, string]>) => values.map(([value, label]) => ({ value, label }))

export const AXIS_STYLE_OPTIONS = opt([
  ['showTitleOnly', 'Show title only'],
  ['showUnitOnly', 'Show unit only'],
  ['showBoth', 'Show both']
])

const LINE_STYLE_OPTIONS = opt([
  ['dashed', 'Dashed'],
  ['solid', 'Solid'],
  ['dotted', 'Dotted'],
  ['custom', 'Custom']
])

/** Extra numeric-axis properties PBI exposes for scatter axes. */
export function numericAxisExtras(): FormatPropDef[] {
  return [
    { name: 'logAxisScale', displayName: 'Logarithmic scale', type: 'bool', default: false },
    { name: 'invertAxis', displayName: 'Invert range', type: 'bool', default: false },
    { name: 'labelPrecision', displayName: 'Value decimal places', type: 'integer', min: 0, max: 15 },
    { name: 'axisStyle', displayName: 'Title style', type: 'enum', options: AXIS_STYLE_OPTIONS, default: 'showTitleOnly' },
    { name: 'gridlineTransparency', displayName: 'Gridline transparency', type: 'percent', min: 0, max: 100, default: 0 },
    { name: 'gridlineDashArray', displayName: 'Gridline dash array', type: 'text' }
  ]
}

function withExtras(card: FormatCardDef, extras: FormatPropDef[], drop: string[] = []): FormatCardDef {
  const names = new Set(card.properties.map((p) => p.name))
  return { ...card, properties: [...card.properties.filter((p) => !drop.includes(p.name)), ...extras.filter((p) => !names.has(p.name))] }
}

/** Analytics-style line card (shown in the Format pane too, so lines can be edited without the Analytics tab). */
export function lineCard(object: string, displayName: string, extra: FormatPropDef[] = [], withLabel = true): FormatCardDef {
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
      { name: 'style', displayName: 'Style', type: 'enum', options: LINE_STYLE_OPTIONS, default: 'dashed' },
      { name: 'width', displayName: 'Width', type: 'integer', min: 1, max: 10, default: 1 },
      ...(withLabel
        ? ([
            {
              name: 'position',
              displayName: 'Position',
              type: 'enum',
              options: opt([
                ['front', 'In front'],
                ['back', 'Behind']
              ]),
              default: 'front'
            },
            { name: 'dataLabelShow', displayName: 'Data label', type: 'bool', default: false },
            {
              name: 'dataLabelText',
              displayName: 'Label text',
              type: 'enum',
              options: opt([
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
              options: opt([
                ['left', 'Left'],
                ['right', 'Right']
              ]),
              default: 'left'
            },
            {
              name: 'dataLabelVerticalPosition',
              displayName: 'Vertical position',
              type: 'enum',
              options: opt([
                ['above', 'Above'],
                ['under', 'Under']
              ]),
              default: 'above'
            },
            { name: 'shadeShow', displayName: 'Shade area', type: 'bool', default: false },
            {
              name: 'shadeRegion',
              displayName: 'Shade region',
              type: 'enum',
              options: opt([
                ['before', 'Before'],
                ['after', 'After'],
                ['none', 'None']
              ]),
              default: 'none'
            },
            { name: 'shadeColor', displayName: 'Shade color', type: 'color' },
            { name: 'shadeTransparency', displayName: 'Shade transparency', type: 'percent', min: 0, max: 100, default: 60 }
          ] satisfies FormatPropDef[])
        : [])
    ]
  }
}

export function scatterFormatCards(): FormatCardDef[] {
  return [
    legendCard(),
    withExtras(categoryAxisCard({ continuous: true }), numericAxisExtras(), ['axisType', 'concatenateLabels', 'innerPadding', 'preferredCategoryWidth', 'maxMarginFactor']),
    withExtras(valueAxisCard(), [...numericAxisExtras(), { name: 'switchAxisPosition', displayName: 'Switch axis position', type: 'bool', default: false }], ['axisScale', 'position']),
    {
      object: 'dataPoint',
      displayName: 'Markers',
      properties: [
        { name: 'defaultColor', displayName: 'Default color', type: 'color' },
        { name: 'fill', displayName: 'Color', type: 'color', perSeries: true },
        { name: 'showAllDataPoints', displayName: 'Show all', type: 'bool', default: false }
      ]
    },
    {
      object: 'bubbles',
      displayName: 'Bubbles',
      properties: [
        { name: 'bubbleSize', displayName: 'Size', type: 'integer', min: -100, max: 100, default: -10 },
        {
          name: 'markerRangeType',
          displayName: 'Range scaling',
          type: 'enum',
          options: opt([
            ['auto', 'Auto'],
            ['magnitude', 'Magnitude'],
            ['dataRange', 'Data range']
          ]),
          default: 'auto'
        },
        {
          name: 'markerShape',
          displayName: 'Shape',
          type: 'enum',
          options: opt([
            ['circle', '●'],
            ['square', '■'],
            ['diamond', '◆'],
            ['triangle', '▲'],
            ['x', '✕'],
            ['shortDash', '-'],
            ['longDash', '—'],
            ['plus', '+']
          ]),
          default: 'circle'
        },
        { name: 'preventOverflow', displayName: 'Auto-fit markers', type: 'bool', default: false }
      ]
    },
    {
      object: 'markers',
      displayName: 'Marker border',
      properties: [
        { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100 },
        { name: 'borderShow', displayName: 'Border', type: 'bool', default: false },
        { name: 'borderColorMatchFill', displayName: 'Match marker color', type: 'bool', default: true },
        { name: 'borderColor', displayName: 'Border color', type: 'color' },
        { name: 'borderWidth', displayName: 'Border width', type: 'integer', min: 0, max: 10, default: 1 }
      ]
    },
    {
      object: 'categoryLabels',
      displayName: 'Category label',
      toggle: 'show',
      properties: [
        { name: 'show', displayName: 'Show', type: 'bool', default: false },
        { name: 'fontFamily', displayName: 'Font', type: 'fontFamily', default: 'Segoe UI' },
        { name: 'fontSize', displayName: 'Font size', type: 'fontSize', default: 9 },
        { name: 'bold', displayName: 'Bold', type: 'bool', default: false },
        { name: 'italic', displayName: 'Italic', type: 'bool', default: false },
        { name: 'color', displayName: 'Color', type: 'color', default: '#605E5C' },
        { name: 'enableBackground', displayName: 'Background', type: 'bool', default: false },
        { name: 'backgroundColor', displayName: 'Background color', type: 'color', default: '#FFFFFF' },
        { name: 'backgroundTransparency', displayName: 'Background transparency', type: 'percent', min: 0, max: 100, default: 90 }
      ]
    },
    {
      object: 'fillPoint',
      displayName: 'Fill point',
      properties: [
        {
          name: 'style',
          displayName: 'Style',
          type: 'enum',
          options: opt([
            ['Fill only', 'Fill only'],
            ['Border only', 'Border only']
          ])
        },
        { name: 'show', displayName: 'Fill point (legacy)', type: 'bool', default: true }
      ]
    },
    { object: 'colorBorder', displayName: 'Color border', toggle: 'show', properties: [{ name: 'show', displayName: 'Show', type: 'bool', default: false }] },
    { object: 'colorByCategory', displayName: 'Color by category', toggle: 'show', properties: [{ name: 'show', displayName: 'Show', type: 'bool', default: false }] },
    plotAreaCard,
    // analytics (also reachable from the Analytics tab)
    lineCard('xAxisReferenceLine', 'X-axis constant line', [{ name: 'value', displayName: 'Value', type: 'number' }]),
    lineCard('y1AxisReferenceLine', 'Y-axis constant line', [{ name: 'value', displayName: 'Value', type: 'number' }]),
    lineCard('ratioLine', 'Ratio line', [], false),
    lineCard('trend', 'Trend line', [{ name: 'combineSeries', displayName: 'Combine series', type: 'bool', default: true }], false),
    {
      object: 'plotAreaShading',
      displayName: 'Symmetry shading',
      toggle: 'show',
      properties: [
        { name: 'show', displayName: 'Show', type: 'bool', default: false },
        { name: 'upperShadingColor', displayName: 'Upper shading color', type: 'color', default: '#1AAB40' },
        { name: 'lowerShadingColor', displayName: 'Lower shading color', type: 'color', default: '#D64554' },
        { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 66 }
      ]
    },
    responsiveCard
  ]
}
