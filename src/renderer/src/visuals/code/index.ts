/**
 * Registers the code visual (Lumen-only): HTML templates, CSS and optional JSX fed by field wells, rendered in a
 * sandboxed frame, interacting with the page like a native visual. See docs/developer/code-visual-internals.md.
 */
import { registerVisual } from '../registry'
import type { FormatCardDef, FormatPropDef } from '../contract'
import { svgIcon } from '../elements/util'
import { CODE_VISUAL_TYPE, FORMAT_OBJECT, PARAMS_OBJECT, readParamDefs } from '@core/codevisual/model'
import { CodeVisual } from './CodeVisual'
import { queryCodeData, readCodeFormat, ROWS_ROLE, TOOLTIPS_ROLE, VALUES_ROLE } from './codeModel'

export const CODE_VISUAL_NAME = 'Code visual'

const formatCards: FormatCardDef[] = [
  {
    object: FORMAT_OBJECT,
    displayName: 'Code',
    properties: [
      {
        name: 'overflow',
        displayName: 'Overflow',
        type: 'enum',
        options: [
          { value: 'hidden', label: 'Hidden' },
          { value: 'visible', label: 'Visible' },
          { value: 'auto', label: 'Scroll' }
        ]
      },
      {
        name: 'defaultSort',
        displayName: 'Default row order',
        type: 'enum',
        options: [
          { value: 'value', label: 'By first value, descending' },
          { value: 'category', label: 'By rows, ascending' }
        ]
      },
      { name: 'rowLimit', displayName: 'Row limit', type: 'integer', min: 1, max: 30000 },
      { name: 'rowTooltips', displayName: 'Row tooltips', type: 'bool' }
    ]
  }
]

/** The Parameters card: one row per parameter the code declares (editor ▸ Parameters). */
export function parameterCard(visualJson: any): FormatCardDef | undefined {
  const defs = readParamDefs(visualJson)
  if (!defs.length) return undefined
  return {
    object: PARAMS_OBJECT,
    displayName: 'Parameters',
    properties: defs.map((p): FormatPropDef => {
      switch (p.type) {
        case 'color':
          return { name: p.name, displayName: p.label, type: 'color', conditional: false }
        case 'number':
          return { name: p.name, displayName: p.label, type: 'number' }
        case 'toggle':
          return { name: p.name, displayName: p.label, type: 'bool' }
        default:
          return { name: p.name, displayName: p.label, type: 'text' }
      }
    })
  }
}

registerVisual({
  type: CODE_VISUAL_TYPE,
  aliases: ['lumenCodeVisual'],
  displayName: CODE_VISUAL_NAME,
  category: 'custom',
  icon: svgIcon('<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="M7.6 8.2 5.4 10l2.2 1.8M12.4 8.2 14.6 10l-2.2 1.8M10.9 7.3 9.1 12.7"/>'),
  roles: [
    { name: ROWS_ROLE, displayName: 'Rows', kind: 'grouping', drillable: true },
    { name: VALUES_ROLE, displayName: 'Values', kind: 'measure' },
    { name: TOOLTIPS_ROLE, displayName: 'Tooltips', kind: 'measure' }
  ],
  formatCards,
  formatCardsFor(visualJson) {
    const p = parameterCard(visualJson)
    return p ? [...formatCards, p] : formatCards
  },
  component: CodeVisual,
  inGallery: true,
  supportsHighlight: true,
  supportsDrill: true,
  defaultSize: { width: 400, height: 240 },
  getData(visual, ctx) {
    const q = queryCodeData(visual.json, ctx, readCodeFormat(visual.json, ctx.theme))
    return q.table
  },
  formatDefaults(visualJson, theme) {
    readCodeFormat(visualJson, theme)
  }
})
