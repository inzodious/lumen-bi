/**
 * Built-in "General" format cards (visual container formatting), present for every visual like in
 * PBI Desktop. Object/property names follow PBIR `visualContainerObjects`. Cards with the same
 * `group` render as sub-cards of one top-level card (Title ▸ Title / Subtitle / Divider / Spacing,
 * Effects ▸ Background / Visual border / Shadow, Header icons ▸ Colors / Icons).
 */
import type { FormatCardDef, FormatPropDef } from '../../visuals/contract'

export type GroupedCard = FormatCardDef & { group?: string }

const opts = (pairs: Array<[string | number | boolean, string]>) => pairs.map(([value, label]) => ({ value, label }))

const textStyle = (withText: boolean, defaults: { size: number }): FormatPropDef[] => [
  ...(withText ? [{ name: 'text', displayName: 'Text', type: 'text' as const }] : []),
  { name: 'fontFamily', displayName: 'Font', type: 'fontFamily', default: 'Segoe UI' },
  { name: 'fontSize', displayName: 'Font size', type: 'fontSize', default: defaults.size, min: 8, max: 60 },
  { name: 'bold', displayName: 'Bold', type: 'bool', default: false },
  { name: 'italic', displayName: 'Italic', type: 'bool', default: false },
  { name: 'underline', displayName: 'Underline', type: 'bool', default: false },
  { name: 'fontColor', displayName: 'Text color', type: 'color' }
]

export const CONTAINER_CARDS: GroupedCard[] = [
  {
    object: 'title',
    displayName: 'Title',
    group: 'Title',
    container: true,
    tab: 'general',
    toggle: 'show',
    properties: [
      { name: 'show', displayName: 'Show', type: 'bool', default: true },
      ...textStyle(true, { size: 14 }),
      { name: 'background', displayName: 'Background color', type: 'color' },
      { name: 'alignment', displayName: 'Horizontal alignment', type: 'alignment', default: 'left' },
      { name: 'titleWrap', displayName: 'Text wrap', type: 'bool', default: true },
      { name: 'heading', displayName: 'Heading level', type: 'enum', options: opts([['Normal', 'Normal'], ['Heading1', 'Heading 1'], ['Heading2', 'Heading 2'], ['Heading3', 'Heading 3']]), default: 'Normal' }
    ]
  },
  {
    object: 'subTitle',
    displayName: 'Subtitle',
    group: 'Title',
    container: true,
    tab: 'general',
    toggle: 'show',
    properties: [
      { name: 'show', displayName: 'Show', type: 'bool', default: false },
      ...textStyle(true, { size: 10 }),
      { name: 'alignment', displayName: 'Horizontal alignment', type: 'alignment', default: 'left' },
      { name: 'titleWrap', displayName: 'Text wrap', type: 'bool', default: true }
    ]
  },
  {
    object: 'divider',
    displayName: 'Divider',
    group: 'Title',
    container: true,
    tab: 'general',
    toggle: 'show',
    properties: [
      { name: 'show', displayName: 'Show', type: 'bool', default: false },
      { name: 'color', displayName: 'Color', type: 'color' },
      { name: 'style', displayName: 'Line style', type: 'enum', options: opts([['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']]), default: 'solid' },
      { name: 'width', displayName: 'Width', type: 'integer', min: 1, max: 10, default: 1 },
      { name: 'ignorePadding', displayName: 'Ignore padding', type: 'bool', default: true }
    ]
  },
  {
    object: 'spacing',
    displayName: 'Spacing',
    group: 'Title',
    container: true,
    tab: 'general',
    properties: [
      { name: 'customizeSpacing', displayName: 'Customize spacing', type: 'bool', default: false },
      { name: 'verticalSpacing', displayName: 'Space between title and content', type: 'integer', min: 0, max: 100 },
      { name: 'spaceBelowTitle', displayName: 'Space below title', type: 'integer', min: 0, max: 100 },
      { name: 'spaceBelowSubTitle', displayName: 'Space below subtitle', type: 'integer', min: 0, max: 100 },
      { name: 'spaceBelowTitleArea', displayName: 'Space below title area', type: 'integer', min: 0, max: 100 }
    ]
  },
  {
    object: 'background',
    displayName: 'Background',
    group: 'Effects',
    container: true,
    tab: 'general',
    toggle: 'show',
    properties: [
      { name: 'show', displayName: 'Show', type: 'bool', default: true },
      { name: 'color', displayName: 'Color', type: 'color', default: '#FFFFFF' },
      { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 0 }
    ]
  },
  {
    object: 'border',
    displayName: 'Visual border',
    group: 'Effects',
    container: true,
    tab: 'general',
    toggle: 'show',
    properties: [
      { name: 'show', displayName: 'Show', type: 'bool', default: false },
      { name: 'color', displayName: 'Color', type: 'color' },
      { name: 'radius', displayName: 'Rounded corners', type: 'integer', min: 0, max: 50, default: 0 },
      { name: 'width', displayName: 'Width', type: 'integer', min: 1, max: 10, default: 1 }
    ]
  },
  {
    object: 'dropShadow',
    displayName: 'Shadow',
    group: 'Effects',
    container: true,
    tab: 'general',
    toggle: 'show',
    properties: [
      { name: 'show', displayName: 'Show', type: 'bool', default: false },
      { name: 'color', displayName: 'Color', type: 'color', default: '#000000' },
      { name: 'position', displayName: 'Position', type: 'enum', options: opts([['Outer', 'Outside'], ['Inner', 'Inside']]), default: 'Outer' },
      {
        name: 'preset',
        displayName: 'Preset',
        type: 'enum',
        options: opts([['BottomRight', 'Bottom right'], ['Bottom', 'Bottom'], ['BottomLeft', 'Bottom left'], ['Right', 'Right'], ['Center', 'Center'], ['Left', 'Left'], ['TopRight', 'Top right'], ['Top', 'Top'], ['TopLeft', 'Top left'], ['Custom', 'Custom']]),
        default: 'BottomRight'
      },
      { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 70 },
      { name: 'shadowSpread', displayName: 'Size', type: 'integer', min: 0, max: 100, default: 0 },
      { name: 'shadowBlur', displayName: 'Blur', type: 'integer', min: 0, max: 100, default: 10 },
      { name: 'angle', displayName: 'Angle', type: 'integer', min: 0, max: 360, default: 45 },
      { name: 'shadowDistance', displayName: 'Distance', type: 'integer', min: 0, max: 100, default: 10 }
    ]
  },
  {
    object: 'visualHeader',
    displayName: 'Colors',
    group: 'Header icons',
    container: true,
    tab: 'general',
    toggle: 'show',
    properties: [
      { name: 'show', displayName: 'Show', type: 'bool', default: true },
      { name: 'background', displayName: 'Background', type: 'color' },
      { name: 'border', displayName: 'Border', type: 'color' },
      { name: 'foreground', displayName: 'Icon', type: 'color' },
      { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 0 }
    ]
  },
  {
    object: 'visualHeader',
    displayName: 'Icons',
    group: 'Header icons',
    container: true,
    tab: 'general',
    properties: [
      { name: 'showVisualInformationButton', displayName: 'Visual information', type: 'bool', default: true },
      { name: 'showVisualWarningButton', displayName: 'Visual warning', type: 'bool', default: true },
      { name: 'showVisualErrorButton', displayName: 'Visual error', type: 'bool', default: true },
      { name: 'showDrillRoleSelector', displayName: 'Drill on dropdown', type: 'bool', default: true },
      { name: 'showDrillUpButton', displayName: 'Drill up', type: 'bool', default: true },
      { name: 'showDrillToggleButton', displayName: 'Drill down', type: 'bool', default: true },
      { name: 'showDrillDownLevelButton', displayName: 'Go to next level', type: 'bool', default: true },
      { name: 'showDrillDownExpandButton', displayName: 'Expand to next level', type: 'bool', default: true },
      { name: 'showPinButton', displayName: 'Pin', type: 'bool', default: true },
      { name: 'showFocusModeButton', displayName: 'Focus mode', type: 'bool', default: true },
      { name: 'showFilterRestatementButton', displayName: 'Filter', type: 'bool', default: true },
      { name: 'showOptionsMenu', displayName: 'More options', type: 'bool', default: true },
      { name: 'showTooltipButton', displayName: 'Help tooltip', type: 'bool', default: false }
    ]
  },
  {
    object: 'visualHeaderTooltip',
    displayName: 'Help tooltip',
    group: 'Header icons',
    container: true,
    tab: 'general',
    properties: [
      { name: 'title', displayName: 'Title', type: 'text' },
      { name: 'text', displayName: 'Text', type: 'textarea' },
      { name: 'fontColor', displayName: 'Font color', type: 'color' },
      { name: 'background', displayName: 'Background', type: 'color' }
    ]
  },
  {
    object: 'visualTooltip',
    displayName: 'Options',
    group: 'Tooltips',
    container: true,
    tab: 'general',
    toggle: 'show',
    properties: [
      { name: 'show', displayName: 'Show', type: 'bool', default: true },
      { name: 'type', displayName: 'Type', type: 'enum', options: opts([['Default', 'Default'], ['Canvas', 'Report page']]), default: 'Default' },
      { name: 'section', displayName: 'Page', type: 'text' }
    ]
  },
  {
    object: 'general',
    displayName: 'Alt text',
    container: true,
    tab: 'general',
    properties: [{ name: 'altText', displayName: 'Alt text', type: 'textarea' }]
  }
]

/** Analytics objects — never shown in the Format tab (they live in the Analytics tab). */
export const ANALYTICS_OBJECTS = new Set(['y1AxisReferenceLine', 'y2AxisReferenceLine', 'xAxisReferenceLine', 'averageLine', 'minLine', 'maxLine', 'medianLine', 'percentileLine', 'trend', 'forecast', 'errorBars'])

/** PBI's font menu. */
export const FONT_FAMILIES = [
  'Segoe UI',
  'Segoe UI Bold',
  'Segoe UI Light',
  'Segoe UI Semibold',
  'DIN',
  'Arial',
  'Arial Black',
  'Calibri',
  'Cambria',
  'Candara',
  'Consolas',
  'Constantia',
  'Corbel',
  'Courier New',
  'Georgia',
  'Lucida Sans Unicode',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  'Wingdings'
]

/** PBIR font-family literal for a menu name (PBI writes CSS stacks for the Segoe variants). */
export function fontFamilyValue(name: string): string {
  switch (name) {
    case 'Segoe UI':
      return "'Segoe UI', wf_segoe-ui_normal, helvetica, arial, sans-serif"
    case 'Segoe UI Bold':
      return "'Segoe UI Bold', wf_segoe-ui_bold, helvetica, arial, sans-serif"
    case 'Segoe UI Light':
      return "'Segoe UI Light', wf_segoe-ui_light, helvetica, arial, sans-serif"
    case 'Segoe UI Semibold':
      return "'Segoe UI Semibold', wf_segoe-ui_semibold, helvetica, arial, sans-serif"
    case 'DIN':
      return "DIN, wf_din, helvetica, arial, sans-serif"
    default:
      return name
  }
}

/** Menu name for a stored PBIR font-family value. */
export function fontFamilyName(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  const first = value.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
  return FONT_FAMILIES.find((f) => f.toLowerCase() === first.toLowerCase()) ?? first
}

export const DISPLAY_UNITS = opts([
  [0, 'Auto'],
  [1, 'None'],
  [1000, 'Thousands'],
  [1000000, 'Millions'],
  [1000000000, 'Billions'],
  [1000000000000, 'Trillions']
])
