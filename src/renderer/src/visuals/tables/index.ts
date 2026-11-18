/** Registers the table visuals: Table (tableEx) and Matrix (pivotTable). */
import { registerVisual } from '../registry'
import type { FormatCardDef, FormatPropDef } from '../contract'
import { TableVisual } from './TableVisual'
import { MatrixVisual } from './MatrixVisual'
import { buildTableModel, tableData, TABLE_ROW_LIMIT } from './tableModel'
import { MATRIX_ROW_LIMIT } from './matrixQuery'
import { buildMatrixView, matrixData } from './matrixView'

const font = (prefix = ''): FormatPropDef[] => [
  { name: `${prefix}fontFamily`, displayName: 'Font', type: 'fontFamily', default: 'Segoe UI' },
  { name: `${prefix}fontSize`, displayName: 'Text size', type: 'fontSize', default: 10, min: 6, max: 60 },
  { name: 'bold', displayName: 'Bold', type: 'bool', default: false },
  { name: 'italic', displayName: 'Italic', type: 'bool', default: false },
  { name: 'underline', displayName: 'Underline', type: 'bool', default: false }
]

const OUTLINE_OPTIONS = ['None', 'BottomOnly', 'TopOnly', 'LeftOnly', 'RightOnly', 'TopBottom', 'LeftRight', 'Frame'].map((v) => ({
  value: v,
  label: v.replace(/([a-z])([A-Z])/g, '$1 $2').replace('Only', 'only')
}))

const gridCard: FormatCardDef = {
  object: 'grid',
  displayName: 'Grid',
  properties: [
    { name: 'gridHorizontal', displayName: 'Horizontal gridlines', type: 'bool', default: false },
    { name: 'gridHorizontalColor', displayName: 'Horizontal gridline color', type: 'color', default: '#E1DFDD' },
    { name: 'gridHorizontalWeight', displayName: 'Horizontal gridline width', type: 'integer', default: 1, min: 1, max: 10 },
    { name: 'gridVertical', displayName: 'Vertical gridlines', type: 'bool', default: false },
    { name: 'gridVerticalColor', displayName: 'Vertical gridline color', type: 'color', default: '#E1DFDD' },
    { name: 'gridVerticalWeight', displayName: 'Vertical gridline width', type: 'integer', default: 1, min: 1, max: 10 },
    { name: 'outlineColor', displayName: 'Border color', type: 'color' },
    { name: 'outlineWeight', displayName: 'Border width', type: 'integer', default: 1, min: 1, max: 10 },
    { name: 'rowPadding', displayName: 'Row padding', type: 'integer', default: 3, min: 0, max: 20 },
    { name: 'imageHeight', displayName: 'Image height', type: 'integer', default: 75, min: 10, max: 500 },
    { name: 'textSize', displayName: 'Global font size', type: 'fontSize' }
  ]
}

const valuesCard = (matrix: boolean): FormatCardDef => ({
  object: 'values',
  displayName: 'Values',
  properties: [
    ...font(),
    { name: 'fontColorPrimary', displayName: 'Text color', type: 'color' },
    { name: 'backColorPrimary', displayName: 'Background color', type: 'color' },
    { name: 'fontColorSecondary', displayName: 'Alternate text color', type: 'color' },
    { name: 'backColorSecondary', displayName: 'Alternate background color', type: 'color' },
    { name: 'wordWrap', displayName: 'Text wrap', type: 'bool', default: true },
    { name: 'outlineStyle', displayName: 'Border', type: 'enum', options: OUTLINE_OPTIONS },
    { name: 'urlIcon', displayName: 'URL icon', type: 'bool', default: false },
    ...(matrix
      ? ([
          { name: 'valuesOnRow', displayName: 'Switch values to rows', type: 'bool', default: false },
          { name: 'bandedRowHeaders', displayName: 'Banded row style', type: 'bool', default: true }
        ] as FormatPropDef[])
      : [])
  ]
})

const columnHeadersCard: FormatCardDef = {
  object: 'columnHeaders',
  displayName: 'Column headers',
  properties: [
    ...font(),
    { name: 'fontColor', displayName: 'Text color', type: 'color' },
    { name: 'backColor', displayName: 'Background color', type: 'color' },
    { name: 'alignment', displayName: 'Header alignment', type: 'alignment' },
    { name: 'titleAlignment', displayName: 'Title alignment', type: 'alignment' },
    { name: 'wordWrap', displayName: 'Text wrap', type: 'bool', default: true },
    { name: 'outlineStyle', displayName: 'Border', type: 'enum', options: OUTLINE_OPTIONS },
    { name: 'autoSizeColumnWidth', displayName: 'Auto-size width', type: 'bool', default: true },
    {
      name: 'columnAdjustment',
      displayName: 'Column adjustment',
      type: 'enum',
      options: [
        { value: 'growToFit', label: 'Grow to fit' },
        { value: 'fitToContent', label: 'Fit to content' },
        { value: 'fixedWidth', label: 'Fixed width' }
      ]
    },
    { name: 'defaultColumnWidth', displayName: 'Default column width', type: 'number', min: 10, max: 1000 }
  ]
}

const specificColumnCard: FormatCardDef = {
  object: 'columnFormatting',
  displayName: 'Specific column',
  properties: [
    { name: 'fontColor', displayName: 'Text color', type: 'color', perSeries: true },
    { name: 'backColor', displayName: 'Background color', type: 'color', perSeries: true },
    { name: 'alignment', displayName: 'Alignment', type: 'alignment', perSeries: true },
    { name: 'labelDisplayUnits', displayName: 'Display units', type: 'displayUnits', perSeries: true },
    { name: 'labelPrecision', displayName: 'Value decimal places', type: 'integer', min: 0, max: 15, perSeries: true },
    { name: 'styleHeader', displayName: 'Apply to header', type: 'bool', default: true, perSeries: true },
    { name: 'styleValues', displayName: 'Apply to values', type: 'bool', default: true, perSeries: true },
    { name: 'styleTotal', displayName: 'Apply to total', type: 'bool', default: false, perSeries: true }
  ]
}

const TABLE_ICON =
  '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="2.5" y="3.5" width="15" height="13" fill="none" stroke="#605E5C"/><rect x="2.5" y="3.5" width="15" height="3" fill="#605E5C"/><path d="M2.5 10h15M2.5 13.2h15M7.5 6.5v10M12.5 6.5v10" stroke="#605E5C" stroke-width="0.8"/></svg>'
const MATRIX_ICON =
  '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="2.5" y="3.5" width="15" height="13" fill="none" stroke="#605E5C"/><rect x="2.5" y="3.5" width="15" height="3" fill="#605E5C"/><rect x="2.5" y="6.5" width="4.5" height="10" fill="#C8C6C4"/><path d="M2.5 10h15M2.5 13.2h15M7 6.5v10M12.2 6.5v10" stroke="#605E5C" stroke-width="0.8"/></svg>'

registerVisual({
  type: 'tableEx',
  aliases: ['table'],
  displayName: 'Table',
  category: 'table',
  icon: TABLE_ICON,
  roles: [{ name: 'Values', displayName: 'Columns', kind: 'both' }],
  formatCards: [
    gridCard,
    valuesCard(false),
    columnHeadersCard,
    {
      object: 'total',
      displayName: 'Totals',
      toggle: 'totals',
      properties: [
        { name: 'totals', displayName: 'Values', type: 'bool', default: true },
        ...font(),
        { name: 'fontColor', displayName: 'Text color', type: 'color' },
        { name: 'backColor', displayName: 'Background color', type: 'color' },
        { name: 'totalText', displayName: 'Label', type: 'text', default: 'Total' },
        { name: 'outlineStyle', displayName: 'Border', type: 'enum', options: OUTLINE_OPTIONS }
      ]
    },
    specificColumnCard
  ],
  component: TableVisual,
  inGallery: true,
  supportsHighlight: false,
  // export / show as table: PBI exports up to 30,000 summarized rows (not just the loaded window)
  getData: (visual, ctx) => tableData(buildTableModel(visual.json, ctx, TABLE_ROW_LIMIT)),
  defaultSize: { width: 400, height: 300 }
})

registerVisual({
  type: 'pivotTable',
  aliases: ['matrix'],
  displayName: 'Matrix',
  category: 'table',
  icon: MATRIX_ICON,
  roles: [
    { name: 'Rows', displayName: 'Rows', kind: 'grouping', drillable: true },
    { name: 'Columns', displayName: 'Columns', kind: 'grouping', drillable: true },
    { name: 'Values', displayName: 'Values', kind: 'measure' }
  ],
  formatCards: [
    {
      object: 'general',
      displayName: 'Layout and style presets',
      properties: [
        {
          name: 'layout',
          displayName: 'Layout',
          type: 'enum',
          options: [
            { value: 'Compact', label: 'Compact' },
            { value: 'Outline', label: 'Outline' },
            { value: 'Tabular', label: 'Tabular' }
          ]
        }
      ]
    },
    gridCard,
    valuesCard(true),
    columnHeadersCard,
    {
      object: 'rowHeaders',
      displayName: 'Row headers',
      properties: [
        ...font(),
        { name: 'fontColor', displayName: 'Text color', type: 'color' },
        { name: 'backColor', displayName: 'Background color', type: 'color' },
        { name: 'alignment', displayName: 'Header alignment', type: 'alignment' },
        { name: 'wordWrap', displayName: 'Text wrap', type: 'bool', default: true },
        { name: 'steppedLayoutIndentation', displayName: 'Stepped layout indentation', type: 'integer', default: 10, min: 0, max: 100 },
        { name: 'showExpandCollapseButtons', displayName: '+/- icons', type: 'bool', default: true },
        { name: 'expandCollapseButtonsSize', displayName: '+/- icon size', type: 'fontSize' },
        { name: 'expandCollapseButtonsColor', displayName: '+/- icon color', type: 'color' }
      ]
    },
    {
      object: 'subTotals',
      displayName: 'Subtotals',
      properties: [
        { name: 'rowSubtotals', displayName: 'Row subtotals', type: 'bool', default: true },
        { name: 'columnSubtotals', displayName: 'Column subtotals', type: 'bool', default: true },
        {
          name: 'rowSubtotalsPosition',
          displayName: 'Row subtotal position',
          type: 'enum',
          options: [
            { value: 'Top', label: 'Top' },
            { value: 'Bottom', label: 'Bottom' }
          ]
        },
        { name: 'perRowLevel', displayName: 'Per row level', type: 'bool', default: false },
        { name: 'perColumnLevel', displayName: 'Per column level', type: 'bool', default: false },
        { name: 'levelSubtotalEnabled', displayName: 'Show subtotal (per level)', type: 'bool', default: true, perSeries: true }
      ]
    },
    {
      object: 'rowTotal',
      displayName: 'Row grand total',
      properties: [...font(), { name: 'fontColor', displayName: 'Text color', type: 'color' }, { name: 'backColor', displayName: 'Background color', type: 'color' }, { name: 'applyToHeaders', displayName: 'Apply to labels', type: 'bool', default: false }]
    },
    {
      object: 'columnTotal',
      displayName: 'Column grand total',
      properties: [...font(), { name: 'fontColor', displayName: 'Text color', type: 'color' }, { name: 'backColor', displayName: 'Background color', type: 'color' }, { name: 'applyToHeaders', displayName: 'Apply to labels', type: 'bool', default: false }]
    },
    { object: 'blankRows', displayName: 'Blank rows', properties: [{ name: 'showBlankRows', displayName: 'Show blank rows', type: 'bool', default: false }] },
    specificColumnCard
  ],
  component: MatrixVisual,
  inGallery: true,
  supportsDrill: true,
  getData: (visual, ctx) => matrixData(buildMatrixView(visual.json, ctx, MATRIX_ROW_LIMIT, MATRIX_ROW_LIMIT)),
  defaultSize: { width: 400, height: 300 }
})
