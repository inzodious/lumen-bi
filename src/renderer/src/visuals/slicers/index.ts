/** Registers the slicer visuals: slicer, textSlicer, advancedSlicerVisual (button slicer), listSlicer. */
import { registerVisual } from '../registry'
import type { FormatCardDef, VisualDefinition, VisualHostContext } from '../contract'
import type { VisualDocument } from '@core/report/types'
import type { Scalar } from '@core/model/data'
import { SlicerVisual } from './SlicerVisual'
import { TextSlicerVisual } from './TextSlicer'
import { ButtonSlicerVisual } from './ButtonSlicer'
import { currentFilter, headerText, loadHierTuples, slicerProjections, formatItem } from './slicerData'
import { listGetData } from './ListSlicer'
import { readSlicerFormat } from './slicerFormat'
import { readButtonSlicerFormat } from './buttonSlicerModel'
import { buildHierTree, leafPaths, nodeState, parseContainsFilter, parseRangeFilter, parseRelativeFilter, pathKey, resolveRelativeFilter, selectedLeafKeys, wallClockNow } from './filterModel'

const FONT_PROPS = (size = 'textSize') => [
  { name: 'fontFamily', displayName: 'Font', type: 'fontFamily' as const },
  { name: size, displayName: 'Text size', type: 'fontSize' as const, min: 6, max: 72 },
  { name: 'bold', displayName: 'Bold', type: 'bool' as const },
  { name: 'italic', displayName: 'Italic', type: 'bool' as const },
  { name: 'underline', displayName: 'Underline', type: 'bool' as const },
  { name: 'fontColor', displayName: 'Font color', type: 'color' as const }
]

const OUTLINE_OPTIONS = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Bottom only' },
  { value: 2, label: 'Top only' },
  { value: 3, label: 'Left only' },
  { value: 4, label: 'Right only' },
  { value: 5, label: 'Top + bottom' },
  { value: 6, label: 'Left + right' },
  { value: 7, label: 'Frame' }
]

/** Lumen-only options (object `lumenSlicer`): defaults reproduce Power BI. */
const LUMEN_SLICER_CARD: FormatCardDef = {
  object: 'lumenSlicer',
  displayName: 'Lumen options',
  properties: [
    {
      name: 'summary',
      displayName: 'Dropdown summary',
      type: 'enum',
      options: [
        { value: 'pbi', label: 'Power BI ("Multiple selections")' },
        { value: 'list', label: 'Values ("A, B +3")' },
        { value: 'count', label: 'Count ("3 of 12 selected")' },
        { value: 'chips', label: 'Removable chips' }
      ],
      default: 'pbi'
    },
    { name: 'clearButton', displayName: 'Clear button in dropdown', type: 'bool', default: false },
    { name: 'popupWidth', displayName: 'Dropdown width (px, 0 = auto)', type: 'integer', min: 0, max: 1200, default: 0 },
    { name: 'popupMaxHeight', displayName: 'Dropdown max height (px, 0 = auto)', type: 'integer', min: 0, max: 1200, default: 0 },
    {
      name: 'sort',
      displayName: 'Sort items',
      type: 'enum',
      options: [
        { value: 'default', label: 'Model order' },
        { value: 'asc', label: 'A to Z' },
        { value: 'desc', label: 'Z to A' },
        { value: 'countDesc', label: 'Count, high to low' },
        { value: 'countAsc', label: 'Count, low to high' },
        { value: 'measureDesc', label: 'Measure, high to low' },
        { value: 'measureAsc', label: 'Measure, low to high' }
      ],
      default: 'default'
    },
    { name: 'sortMeasure', displayName: 'Sort by measure (Table[Measure])', type: 'text' },
    { name: 'selectedFirst', displayName: 'Show selected first', type: 'bool', default: false },
    { name: 'showCounts', displayName: 'Show value counts', type: 'bool', default: false },
    { name: 'datePresets', displayName: 'Date presets (date fields)', type: 'bool', default: false },
    { name: 'forceSelection', displayName: 'Force selection', type: 'bool', default: false }
  ]
}

const SLICER_CARDS: FormatCardDef[] = [
  {
    object: 'data',
    displayName: 'Slicer settings',
    properties: [
      {
        name: 'mode',
        displayName: 'Style',
        type: 'enum',
        options: [
          { value: 'Basic', label: 'Vertical list' },
          { value: 'Dropdown', label: 'Dropdown' },
          { value: 'RelativeDatePicker', label: 'Date picker' },
          { value: 'Between', label: 'Between' },
          { value: 'Before', label: 'Before / Less than or equal to' },
          { value: 'After', label: 'After / Greater than or equal to' },
          { value: 'Single', label: 'Single value' },
          { value: 'Relative', label: 'Relative date' },
          { value: 'RelativeTime', label: 'Relative time' }
        ],
        default: 'Basic'
      },
      { name: 'isInvertedSelectionMode', displayName: 'Inverted selection', type: 'bool', default: false }
    ]
  },
  {
    object: 'general',
    displayName: 'Options',
    properties: [
      {
        name: 'orientation',
        displayName: 'Orientation',
        type: 'enum',
        options: [
          { value: 0, label: 'Vertical' },
          { value: 1, label: 'Horizontal' }
        ],
        default: 0
      },
      { name: 'selfFilterEnabled', displayName: 'Search', type: 'bool', default: false },
      { name: 'responsive', displayName: 'Responsive', type: 'bool', default: true }
    ]
  },
  {
    object: 'selection',
    displayName: 'Selection',
    properties: [
      { name: 'strictSingleSelect', displayName: 'Single select', type: 'bool', default: false },
      { name: 'singleSelect', displayName: 'Multi-select with CTRL', type: 'bool', default: true },
      { name: 'selectAllCheckboxEnabled', displayName: 'Show "Select all" option', type: 'bool', default: false },
      { name: 'singleDate', displayName: 'Single date (date picker)', type: 'bool', default: false }
    ]
  },
  {
    object: 'header',
    displayName: 'Slicer header',
    toggle: 'show',
    properties: [
      { name: 'show', displayName: 'Show', type: 'bool', default: true },
      { name: 'text', displayName: 'Title text', type: 'text' },
      ...FONT_PROPS(),
      { name: 'background', displayName: 'Background', type: 'color' },
      { name: 'outline', displayName: 'Border', type: 'enum', options: OUTLINE_OPTIONS.map((o) => ({ ...o, value: o.label.replace(/[ +]/g, '') })) },
      { name: 'outlineColor', displayName: 'Border color', type: 'color' },
      { name: 'outlineWeight', displayName: 'Border width', type: 'integer', min: 1, max: 10 }
    ]
  },
  {
    object: 'items',
    displayName: 'Values',
    properties: [
      ...FONT_PROPS(),
      { name: 'background', displayName: 'Background', type: 'color' },
      { name: 'padding', displayName: 'Padding', type: 'integer', min: 0, max: 30, default: 4 },
      { name: 'outlineStyle', displayName: 'Border', type: 'enum', options: OUTLINE_OPTIONS, default: 0 },
      { name: 'outlineColor', displayName: 'Border color', type: 'color' },
      { name: 'steppedLayoutIndentation', displayName: 'Indentation (hierarchy)', type: 'integer', min: 0, max: 40, default: 10 },
      {
        name: 'expandCollapseToggleType',
        displayName: 'Expand / collapse icon',
        type: 'enum',
        options: [
          { value: 0, label: 'Chevron' },
          { value: 1, label: 'Plus/minus' }
        ],
        default: 0
      }
    ]
  },
  { object: 'selectionIcon', displayName: 'Selection icon', properties: [{ name: 'color', displayName: 'Color', type: 'color' }] },
  {
    object: 'slider',
    displayName: 'Slider',
    toggle: 'show',
    properties: [
      { name: 'show', displayName: 'Show', type: 'bool', default: true },
      { name: 'color', displayName: 'Color', type: 'color' },
      { name: 'secondaryLineColor', displayName: 'Track color', type: 'color' },
      { name: 'handleFillColor', displayName: 'Handle fill', type: 'color' },
      { name: 'handleBorderColor', displayName: 'Handle border', type: 'color' },
      { name: 'handleSize', displayName: 'Handle size', type: 'integer', min: 6, max: 30, default: 12 },
      { name: 'handleWidth', displayName: 'Handle width (responsive off)', type: 'integer', min: 2, max: 30, default: 7 },
      { name: 'handleHeight', displayName: 'Handle height (responsive off)', type: 'integer', min: 4, max: 40, default: 17 }
    ]
  },
  {
    object: 'dropdown',
    displayName: 'Dropdown',
    properties: [
      { name: 'borderColor', displayName: 'Border color', type: 'color' },
      { name: 'borderRadius', displayName: 'Rounded corners', type: 'integer', min: 0, max: 20, default: 0 },
      { name: 'iconColor', displayName: 'Icon color', type: 'color' },
      { name: 'accentBarShow', displayName: 'Accent bar', type: 'bool', default: false },
      { name: 'accentBarColor', displayName: 'Accent bar color', type: 'color' },
      {
        name: 'accentBarPosition',
        displayName: 'Accent bar position',
        type: 'enum',
        options: [
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
          { value: 'top', label: 'Top' },
          { value: 'bottom', label: 'Bottom' }
        ],
        default: 'left'
      },
      { name: 'accentBarWidth', displayName: 'Accent bar width', type: 'integer', min: 1, max: 10, default: 4 }
    ]
  },
  {
    object: 'searchBox',
    displayName: 'Search box',
    properties: [
      { name: 'background', displayName: 'Background', type: 'color' },
      { name: 'borderColor', displayName: 'Border color', type: 'color' }
    ]
  },
  {
    object: 'dateRange',
    displayName: 'Date range',
    properties: [
      { name: 'includeToday', displayName: 'Include today', type: 'bool', default: true },
      { name: 'anchorDate', displayName: 'Anchor date (yyyy-mm-dd)', type: 'text' }
    ]
  },
  {
    object: 'numericInputStyle',
    displayName: 'Numeric inputs',
    properties: [...FONT_PROPS(), { name: 'background', displayName: 'Background', type: 'color' }]
  },
  {
    object: 'date',
    displayName: 'Date inputs',
    properties: [...FONT_PROPS(), { name: 'background', displayName: 'Background', type: 'color' }, { name: 'hideDatePickerButton', displayName: 'Hide date picker button', type: 'bool', default: false }]
  },
  {
    object: 'calendarButton',
    displayName: 'Button (date picker)',
    properties: [
      { name: 'iconColor', displayName: 'Icon color', type: 'color' },
      { name: 'iconSize', displayName: 'Icon size', type: 'fontSize', min: 6, max: 40 },
      { name: 'iconTransparency', displayName: 'Icon transparency', type: 'percent', min: 0, max: 100, default: 0 },
      { name: 'backgroundShow', displayName: 'Background', type: 'bool', default: false },
      { name: 'backgroundColor', displayName: 'Background color', type: 'color' },
      { name: 'backgroundTransparency', displayName: 'Background transparency', type: 'percent', min: 0, max: 100, default: 0 },
      { name: 'strokeShow', displayName: 'Border', type: 'bool', default: true },
      { name: 'strokeColor', displayName: 'Border color', type: 'color' },
      { name: 'strokeWidth', displayName: 'Border width', type: 'integer', min: 0, max: 10, default: 1 },
      {
        name: 'strokePattern',
        displayName: 'Border style',
        type: 'enum',
        options: [
          { value: 'solid', label: 'Solid' },
          { value: 'dashed', label: 'Dashed' },
          { value: 'dotted', label: 'Dotted' }
        ],
        default: 'solid'
      },
      { name: 'cornerRadius', displayName: 'Rounded corners', type: 'integer', min: 0, max: 20, default: 4 }
    ]
  },
  {
    object: 'dateRangeText',
    displayName: 'Text — date range (date picker)',
    properties: [
      { name: 'fontFamily', displayName: 'Font', type: 'fontFamily' },
      { name: 'fontSize', displayName: 'Text size', type: 'fontSize', min: 6, max: 72 },
      { name: 'bold', displayName: 'Bold', type: 'bool' },
      { name: 'italic', displayName: 'Italic', type: 'bool' },
      { name: 'underline', displayName: 'Underline', type: 'bool' },
      { name: 'color', displayName: 'Color', type: 'color' },
      { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 0 }
    ]
  },
  {
    object: 'relativeText',
    displayName: 'Text — relative summary (date picker)',
    toggle: 'show',
    properties: [
      { name: 'show', displayName: 'Show', type: 'bool', default: true },
      { name: 'fontFamily', displayName: 'Font', type: 'fontFamily' },
      { name: 'fontSize', displayName: 'Text size', type: 'fontSize', min: 6, max: 72 },
      { name: 'bold', displayName: 'Bold', type: 'bool' },
      { name: 'italic', displayName: 'Italic', type: 'bool' },
      { name: 'underline', displayName: 'Underline', type: 'bool' },
      { name: 'color', displayName: 'Color', type: 'color' },
      { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 0 }
    ]
  },
  LUMEN_SLICER_CARD
]

const ICON_SLICER =
  '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="3" y="2.5" width="14" height="15" rx="1" fill="none" stroke="currentColor"/><rect x="5" y="5" width="3" height="3" fill="currentColor"/><path d="M9.5 6.5h5.5M9.5 10.5h5.5M9.5 14.5h5.5" stroke="currentColor"/><rect x="5.5" y="9.5" width="2" height="2" fill="none" stroke="currentColor"/><rect x="5.5" y="13.5" width="2" height="2" fill="none" stroke="currentColor"/></svg>'
const ICON_TEXT_SLICER =
  '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="2" y="6" width="16" height="8" rx="1" fill="none" stroke="currentColor"/><path d="M5 8.5v3M4 8.5h2M4 11.5h2" stroke="currentColor"/><path d="M2 15.5h16" stroke="currentColor" stroke-width="1.5"/></svg>'
const ICON_BUTTON_SLICER =
  '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="2" y="4" width="7" height="5" rx="1.5" fill="currentColor"/><rect x="11" y="4" width="7" height="5" rx="1.5" fill="none" stroke="currentColor"/><rect x="2" y="11" width="7" height="5" rx="1.5" fill="none" stroke="currentColor"/><rect x="11" y="11" width="7" height="5" rx="1.5" fill="none" stroke="currentColor"/></svg>'
const ICON_LIST_SLICER =
  '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="3" y="3" width="3" height="3" fill="currentColor"/><rect x="3.5" y="8.5" width="2" height="2" fill="none" stroke="currentColor"/><rect x="3.5" y="13.5" width="2" height="2" fill="none" stroke="currentColor"/><path d="M8 4.5h9M8 9.5h9M8 14.5h9" stroke="currentColor"/></svg>'

function slicerGetData(visual: VisualDocument, ctx: VisualHostContext): { columns: string[]; rows: Scalar[][] } | undefined {
  const json = visual.json
  const projs = slicerProjections(json)
  if (!projs.length) return undefined
  const fmt = readSlicerFormat(json, ctx.theme)
  const filter = currentFilter(json, ctx)
  const label = headerText(ctx, projs)
  const field = projs[0].expr
  if (json?.visual?.visualType === 'textSlicer') return { columns: [label, 'Search text'], rows: [[label, parseContainsFilter(filter) ?? null]] }
  if (fmt.mode === 'Relative' || fmt.mode === 'RelativeTime') {
    const r = parseRelativeFilter(filter, field)
    return { columns: ['Field', 'Relative period'], rows: [[label, r ? `${r.anchor} ${r.anchor === 'this' ? '' : r.n + ' '}${r.unit}${r.calendar ? ' (calendar)' : ''}` : null]] }
  }
  if (fmt.mode === 'RelativeDatePicker') {
    // relative selections are resolved to concrete dates (as of now), manual ones are ranges already
    const r = parseRangeFilter(resolveRelativeFilter(filter, wallClockNow()), field)
    if (r || filter === undefined) return { columns: ['Field', 'From', 'To'], rows: [[label, (r?.min ?? null) as Scalar, (r?.max ?? null) as Scalar]] }
  }
  if (['Between', 'Before', 'After', 'Single'].includes(fmt.mode)) {
    const r = parseRangeFilter(filter, field)
    if (r || !['Basic', 'Dropdown'].includes(fmt.mode)) return { columns: ['Field', 'From', 'To'], rows: [[label, (r?.min ?? null) as Scalar, (r?.max ?? null) as Scalar]] }
  }
  if (projs.length > 1) {
    const fields = projs.map((p) => p.expr)
    const root = buildHierTree(loadHierTuples(ctx, fields).tuples, fields.length)
    const sel = selectedLeafKeys(root, fields, filter, fmt.inverted)
    return {
      columns: [...projs.map((p) => p.displayName ?? p.info.property ?? p.queryRef), 'Selected'],
      rows: leafPaths(root).map((p) => [...p.map((v, i) => formatItem(ctx, fields[i], v)), sel.has(pathKey(p))])
    }
  }
  void nodeState
  return listGetData(ctx, field, filter, fmt.inverted, label)
}

const slicer: VisualDefinition = {
  type: 'slicer',
  displayName: 'Slicer',
  category: 'slicer',
  icon: ICON_SLICER,
  roles: [{ name: 'Values', displayName: 'Field', kind: 'grouping', drillable: true }],
  formatCards: SLICER_CARDS,
  formatDefaults: (json, theme) => readSlicerFormat(json, theme),
  component: SlicerVisual,
  inGallery: true,
  isSlicer: true,
  getData: slicerGetData,
  defaultSize: { width: 200, height: 240 }
}

const listSlicer: VisualDefinition = {
  ...slicer,
  type: 'listSlicer',
  displayName: 'List slicer',
  icon: ICON_LIST_SLICER,
  roles: [{ name: 'Field', displayName: 'Field', kind: 'grouping', drillable: true }],
  formatCards: [
    { object: 'data', displayName: 'Slicer settings', properties: [{ name: 'dropdownMode', displayName: 'Dropdown', type: 'bool', default: false }] },
    { object: 'general', displayName: 'Options', properties: [{ name: 'selfFilterEnabled', displayName: 'Search', type: 'bool', default: false }] },
    {
      object: 'selection',
      displayName: 'Selection',
      properties: [
        { name: 'singleSelect', displayName: 'Single select', type: 'bool', default: true },
        { name: 'strictSingleSelect', displayName: 'Force selection', type: 'bool', default: false },
        { name: 'selectAllCheckboxEnabled', displayName: 'Show "Select all" option', type: 'bool', default: false }
      ]
    },
    { object: 'value', displayName: 'Values', properties: FONT_PROPS('fontSize') },
    { object: 'pills', displayName: 'Selection pills', toggle: 'show', properties: [{ name: 'show', displayName: 'Show', type: 'bool', default: true }] },
    {
      object: 'dropdownMenu',
      displayName: 'Dropdown drawer',
      properties: [
        { name: 'width', displayName: 'Width (px, 0 = auto)', type: 'integer', min: 0, max: 1200, default: 0 },
        { name: 'maxHeight', displayName: 'Max height (px, 0 = auto)', type: 'integer', min: 0, max: 1200, default: 0 }
      ]
    },
    LUMEN_SLICER_CARD
  ],
  inGallery: false
}

const textSlicer: VisualDefinition = {
  type: 'textSlicer',
  displayName: 'Text slicer',
  category: 'slicer',
  icon: ICON_TEXT_SLICER,
  roles: [{ name: 'Values', displayName: 'Field', kind: 'grouping', max: 1 }],
  formatCards: [
    {
      object: 'inputTextBox',
      displayName: 'Input box',
      properties: [
        { name: 'placeholder', displayName: 'Placeholder text', type: 'text', default: 'Type here' },
        { name: 'placeholderFontSize', displayName: 'Placeholder text size', type: 'fontSize' },
        { name: 'placeholderColor', displayName: 'Placeholder color', type: 'color' },
        ...FONT_PROPS('fontSize'),
        { name: 'background', displayName: 'Background', type: 'color' },
        { name: 'borderColor', displayName: 'Border color', type: 'color' },
        { name: 'accentBarShow', displayName: 'Accent bar', type: 'bool', default: true },
        { name: 'accentBarColor', displayName: 'Accent bar color', type: 'color' },
        { name: 'accentBarWeight', displayName: 'Accent bar width', type: 'integer', min: 1, max: 10, default: 2 },
        { name: 'paddingTop', displayName: 'Padding top', type: 'integer', min: 0, max: 40, default: 4 },
        { name: 'paddingBottom', displayName: 'Padding bottom', type: 'integer', min: 0, max: 40, default: 4 },
        { name: 'paddingLeft', displayName: 'Padding left', type: 'integer', min: 0, max: 40, default: 4 },
        { name: 'paddingRight', displayName: 'Padding right', type: 'integer', min: 0, max: 40, default: 4 }
      ]
    }
  ],
  component: TextSlicerVisual,
  inGallery: true,
  isSlicer: true,
  getData: slicerGetData,
  defaultSize: { width: 240, height: 60 }
}

const buttonSlicer: VisualDefinition = {
  type: 'advancedSlicerVisual',
  displayName: 'Button slicer',
  category: 'slicer',
  icon: ICON_BUTTON_SLICER,
  roles: [
    { name: 'Values', displayName: 'Field', kind: 'grouping', max: 1 },
    { name: 'Data', displayName: 'Label', kind: 'measure', max: 1 }
  ],
  formatDefaults: (json, theme) => {
    readSlicerFormat(json, theme)
    readButtonSlicerFormat(json, theme)
  },
  formatCards: [
    {
      object: 'layout',
      displayName: 'Multi-button layout',
      properties: [
        {
          name: 'orientation',
          displayName: 'Arrangement',
          type: 'enum',
          options: [
            { value: 'grid', label: 'Grid' },
            { value: 'horizontal', label: 'Horizontal' },
            { value: 'vertical', label: 'Vertical' }
          ],
          default: 'grid'
        },
        { name: 'columnCount', displayName: 'Columns', type: 'integer', min: 1, max: 20, default: 3 },
        { name: 'rowCount', displayName: 'Rows (0 = auto)', type: 'integer', min: 0, max: 20, default: 0 },
        { name: 'autoGrid', displayName: 'Fit to space', type: 'bool', default: true },
        { name: 'showFixedSize', displayName: 'Fixed size', type: 'bool', default: false },
        { name: 'fixedWidth', displayName: 'Width', type: 'integer', min: 10, max: 800, default: 120 },
        { name: 'fixedHeight', displayName: 'Height', type: 'integer', min: 10, max: 800, default: 48 },
        { name: 'columnPadding', displayName: 'Column spacing', type: 'integer', min: 0, max: 60, default: 10 },
        { name: 'rowPadding', displayName: 'Row spacing', type: 'integer', min: 0, max: 60, default: 10 }
      ]
    },
    {
      object: 'overFlow',
      displayName: 'Overflow',
      properties: [
        {
          name: 'overFlowStyle',
          displayName: 'Style',
          type: 'enum',
          options: [
            { value: 0, label: 'Continuous scroll' },
            { value: 1, label: 'Pagination' }
          ],
          default: 0
        },
        {
          name: 'overFlowDirection',
          displayName: 'Direction',
          type: 'enum',
          options: [
            { value: 0, label: 'Vertical' },
            { value: 1, label: 'Horizontal' }
          ],
          default: 0
        }
      ]
    },
    { object: 'shapeCustomRectangle', displayName: 'Shape', properties: [{ name: 'rectangleRoundedCurve', displayName: 'Rounded corners', type: 'integer', min: 0, max: 40, default: 4 }] },
    {
      object: 'fillCustom',
      displayName: 'Button fill',
      toggle: 'show',
      properties: [
        { name: 'show', displayName: 'Show', type: 'bool', default: true },
        { name: 'fillColor', displayName: 'Color', type: 'color' },
        { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 0 }
      ]
    },
    {
      object: 'outline',
      displayName: 'Button border',
      toggle: 'show',
      properties: [
        { name: 'show', displayName: 'Show', type: 'bool', default: true },
        { name: 'lineColor', displayName: 'Color', type: 'color' },
        { name: 'weight', displayName: 'Width', type: 'integer', min: 0, max: 10, default: 1 },
        { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 0 }
      ]
    },
    {
      object: 'value',
      displayName: 'Callout values',
      toggle: 'show',
      properties: [
        { name: 'show', displayName: 'Show', type: 'bool', default: true },
        ...FONT_PROPS('fontSize'),
        {
          name: 'horizontalAlignment',
          displayName: 'Alignment',
          type: 'enum',
          options: [
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' }
          ],
          default: 'center'
        }
      ]
    },
    { object: 'label', displayName: 'Label', toggle: 'show', properties: [{ name: 'show', displayName: 'Show', type: 'bool', default: true }, ...FONT_PROPS('fontSize')] },
    {
      object: 'image',
      displayName: 'Image',
      toggle: 'show',
      properties: [
        { name: 'show', displayName: 'Show', type: 'bool', default: false },
        {
          name: 'sourceType',
          displayName: 'Source',
          type: 'enum',
          options: [
            { value: 'url', label: 'Image URL' },
            { value: 'imageFile', label: 'Image file' },
            { value: 'field', label: 'Field value' }
          ],
          default: 'url'
        },
        { name: 'url', displayName: 'Image URL', type: 'text' },
        { name: 'image', displayName: 'Image file', type: 'image' },
        {
          name: 'position',
          displayName: 'Position',
          type: 'enum',
          options: [
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' },
            { value: 'top', label: 'Top' },
            { value: 'bottom', label: 'Bottom' }
          ],
          default: 'left'
        },
        { name: 'imageAreaSize', displayName: 'Image area size (%)', type: 'integer', min: 5, max: 90, default: 30 },
        {
          name: 'imageFit',
          displayName: 'Image fit',
          type: 'enum',
          options: [
            { value: 'fit', label: 'Fit' },
            { value: 'fill', label: 'Fill' },
            { value: 'normal', label: 'Normal' }
          ],
          default: 'fit'
        },
        { name: 'padding', displayName: 'Padding', type: 'integer', min: 0, max: 40, default: 4 }
      ]
    },
    {
      object: 'accentBar',
      displayName: 'Accent bar',
      toggle: 'show',
      properties: [
        { name: 'show', displayName: 'Show', type: 'bool', default: false },
        { name: 'color', displayName: 'Color', type: 'color' },
        {
          name: 'position',
          displayName: 'Position',
          type: 'enum',
          options: [
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' },
            { value: 'top', label: 'Top' },
            { value: 'bottom', label: 'Bottom' }
          ],
          default: 'left'
        },
        { name: 'width', displayName: 'Width', type: 'integer', min: 1, max: 20, default: 4 }
      ]
    },
    {
      object: 'selectionIcon',
      displayName: 'Selection icon',
      toggle: 'show',
      properties: [
        { name: 'show', displayName: 'Show', type: 'bool', default: false },
        { name: 'color', displayName: 'Color', type: 'color' },
        { name: 'size', displayName: 'Size', type: 'integer', min: 6, max: 40, default: 12 }
      ]
    },
    {
      object: 'shadowCustom',
      displayName: 'Shadow',
      toggle: 'show',
      properties: [
        { name: 'show', displayName: 'Show', type: 'bool', default: false },
        { name: 'color', displayName: 'Color', type: 'color' },
        { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 70 },
        { name: 'shadowBlur', displayName: 'Blur', type: 'integer', min: 0, max: 40, default: 10 },
        { name: 'shadowDistance', displayName: 'Distance', type: 'integer', min: 0, max: 40, default: 3 }
      ]
    },
    {
      object: 'padding',
      displayName: 'Button padding',
      properties: [
        { name: 'topMargin', displayName: 'Top', type: 'integer', min: 0, max: 40, default: 4 },
        { name: 'bottomMargin', displayName: 'Bottom', type: 'integer', min: 0, max: 40, default: 4 },
        { name: 'leftMargin', displayName: 'Left', type: 'integer', min: 0, max: 40, default: 8 },
        { name: 'rightMargin', displayName: 'Right', type: 'integer', min: 0, max: 40, default: 8 }
      ]
    },
    {
      object: 'selection',
      displayName: 'Selection',
      properties: [
        // New slicers relabel PBI's internal names: singleSelect = "Single select" (Ctrl adds), strictSingleSelect = "Force selection"
        { name: 'singleSelect', displayName: 'Single select', type: 'bool', default: true },
        { name: 'strictSingleSelect', displayName: 'Force selection', type: 'bool', default: false },
        { name: 'selectAllCheckboxEnabled', displayName: 'Show "Select all" option', type: 'bool', default: false }
      ]
    },
    {
      ...LUMEN_SLICER_CARD,
      properties: LUMEN_SLICER_CARD.properties.filter((p) => ['sort', 'sortMeasure', 'selectedFirst'].includes(p.name))
    }
  ],
  component: ButtonSlicerVisual,
  inGallery: true,
  isSlicer: true,
  getData: slicerGetData,
  defaultSize: { width: 360, height: 120 }
}

registerVisual(slicer)
registerVisual(listSlicer)
registerVisual(textSlicer)
registerVisual(buttonSlicer)

export { slicer as slicerDefinition, textSlicer as textSlicerDefinition, buttonSlicer as buttonSlicerDefinition, listSlicer as listSlicerDefinition }
