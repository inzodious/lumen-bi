/** Registers the custom visuals: HTML Content, Deneb (matched by GUID-suffixed visualType prefix) and Power Automate. */
import { registerVisual } from '../registry'
import type { VisualHostContext } from '../contract'
import { svgIcon } from '../elements/util'
import { HtmlContentVisual, queryHtmlEntries } from './HtmlContent'
import { DenebVisual } from './Deneb'
import { runFieldQuery } from './fieldQuery'
import { POWER_AUTOMATE_TYPE, PowerAutomateVisual } from './PowerAutomate'
import type { Scalar } from '@core/model/data'

function tableOf(visualJson: any, ctx: VisualHostContext, roles: string[]): { columns: string[]; rows: Scalar[][] } {
  const q = runFieldQuery(visualJson, ctx, roles, { limit: 30000 })
  return { columns: q.fields.map((f) => f.label), rows: q.result.rows.map((r) => q.fields.map((f) => r[f.index] ?? null)) }
}

registerVisual({
  type: 'htmlContent443BE3AD55E043BF878BED274D3A6865',
  aliases: ['htmlContent'],
  displayName: 'HTML Content',
  category: 'custom',
  icon: svgIcon('<rect x="2.5" y="3.5" width="15" height="13" rx="1"/><path d="M7.5 8l-2.5 2 2.5 2M12.5 8l2.5 2-2.5 2M11 7.5l-2 5"/>'),
  roles: [
    { name: 'content', displayName: 'Values', kind: 'both' },
    { name: 'sampling', displayName: 'Granularity', kind: 'grouping' }
  ],
  formatCards: [
    {
      object: 'contentFormatting',
      displayName: 'Content formatting',
      properties: [
        { name: 'showRawHtml', displayName: 'Show raw HTML', type: 'bool' },
        { name: 'fontFamily', displayName: 'Default font family', type: 'fontFamily' },
        { name: 'fontSize', displayName: 'Default font size', type: 'fontSize' },
        { name: 'fontColor', displayName: 'Default font color', type: 'color' },
        {
          name: 'align',
          displayName: 'Alignment',
          type: 'enum',
          options: [
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
            { value: 'justify', label: 'Justify' }
          ]
        },
        { name: 'hyperlinks', displayName: 'Allow opening URLs', type: 'bool' },
        { name: 'userSelect', displayName: 'Allow text selection', type: 'bool' },
        { name: 'noDataMessage', displayName: 'No data message', type: 'text' }
      ]
    },
    { object: 'stylesheet', displayName: 'Stylesheet', properties: [{ name: 'stylesheet', displayName: 'Stylesheet', type: 'textarea' }] }
  ],
  component: HtmlContentVisual,
  defaultSize: { width: 320, height: 200 },
  getData(visual, ctx) {
    const d = queryHtmlEntries(visual.json, ctx)
    return { columns: ['Content'], rows: d.entries.map((e) => [e]) }
  }
})

registerVisual({
  type: 'deneb7E15AEF80B9E4D4F8E12924291ECE89A',
  aliases: ['deneb'],
  displayName: 'Deneb',
  category: 'custom',
  icon: svgIcon('<path d="M10 2.5l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 7.8l5-.7z"/>'),
  roles: [{ name: 'dataset', displayName: 'Values', kind: 'both' }],
  formatCards: [
    {
      object: 'vega',
      displayName: 'Specification',
      properties: [
        {
          name: 'provider',
          displayName: 'Provider',
          type: 'enum',
          options: [
            { value: 'vegaLite', label: 'Vega-Lite' },
            { value: 'vega', label: 'Vega' }
          ]
        },
        { name: 'jsonSpec', displayName: 'Specification (JSON)', type: 'textarea' },
        { name: 'jsonConfig', displayName: 'Config (JSON)', type: 'textarea' },
        { name: 'enableTooltips', displayName: 'Tooltips', type: 'bool' },
        {
          name: 'renderMode',
          displayName: 'Render mode',
          type: 'enum',
          options: [
            { value: 'svg', label: 'SVG' },
            { value: 'canvas', label: 'Canvas' }
          ]
        }
      ]
    }
  ],
  component: DenebVisual,
  defaultSize: { width: 400, height: 300 },
  getData(visual, ctx) {
    return tableOf(visual.json, ctx, ['dataset'])
  }
})

registerVisual({
  // GUID uses underscores, so the registry's 32-hex prefix match doesn't apply: register the exact type
  type: POWER_AUTOMATE_TYPE,
  aliases: ['powerAutomateVisual'],
  displayName: 'Power Automate for Power BI',
  category: 'custom',
  icon: svgIcon('<rect x="2.5" y="5.5" width="15" height="9" rx="1"/><path d="M8 8l4 2-4 2z"/>'),
  roles: [{ name: 'table', displayName: 'Power Automate data', kind: 'both' }],
  formatCards: [
    {
      object: 'buttonText',
      displayName: 'Button text',
      toggle: 'show',
      properties: [
        { name: 'show', displayName: 'Show', type: 'bool', default: true },
        { name: 'text', displayName: 'Button text', type: 'text', default: 'Run flow' },
        { name: 'fontColor', displayName: 'Font color', type: 'color' },
        { name: 'fontSize', displayName: 'Text size', type: 'fontSize' },
        { name: 'fontFamily', displayName: 'Font family', type: 'fontFamily' },
        { name: 'textPadding', displayName: 'Padding', type: 'integer', min: 0, max: 40 },
        { name: 'horizontalAlignment', displayName: 'Horizontal alignment', type: 'alignment' },
        {
          name: 'verticalAlignment',
          displayName: 'Vertical alignment',
          type: 'enum',
          options: [
            { value: 'top', label: 'Top' },
            { value: 'middle', label: 'Middle' },
            { value: 'bottom', label: 'Bottom' }
          ]
        }
      ]
    },
    {
      object: 'buttonFill',
      displayName: 'Fill',
      toggle: 'show',
      properties: [
        { name: 'show', displayName: 'Show', type: 'bool', default: true },
        { name: 'color', displayName: 'Background', type: 'color' }
      ]
    }
  ],
  component: PowerAutomateVisual,
  defaultSize: { width: 200, height: 60 },
  getData(visual, ctx) {
    return tableOf(visual.json, ctx, ['table'])
  }
})
