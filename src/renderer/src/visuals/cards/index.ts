/** Registers the cards visuals: cardVisual (new card), card (legacy), multiRowCard. */
import { registerVisual } from '../registry'
import type { FormatCardDef, FormatPropDef, VisualDefinition, VisualHostContext } from '../contract'
import type { VisualDocument } from '@core/report/types'
import type { Scalar } from '@core/model/data'
import { CardVisualView, computeCardVisual } from './CardVisual'
import { LegacyCardView, MultiRowCardView, computeLegacyCard, computeMultiRow } from './LegacyCards'
import { cardVisualFormatDefaults } from './cardVisualModel'
import { buildLegacyCardModel, multiRowStyle } from './legacyCardModel'

const UNITS: FormatPropDef['options'] = [
  { value: 0, label: 'Auto' },
  { value: 1, label: 'None' },
  { value: 1000, label: 'Thousands' },
  { value: 1000000, label: 'Millions' },
  { value: 1000000000, label: 'Billions' },
  { value: 1000000000000, label: 'Trillions' }
]

const font = (prefix = ''): FormatPropDef[] => [
  { name: `${prefix}fontFamily`, displayName: 'Font', type: 'fontFamily' },
  { name: `${prefix}fontSize`, displayName: 'Font size', type: 'fontSize' },
  { name: `${prefix}fontColor`, displayName: 'Color', type: 'color' },
  { name: `${prefix}bold`, displayName: 'Bold', type: 'bool' },
  { name: `${prefix}italic`, displayName: 'Italic', type: 'bool' }
]

const padding = (object: string, displayName: string): FormatCardDef => ({
  object,
  displayName,
  properties: [
    { name: 'paddingIndividual', displayName: 'Customize sides', type: 'bool', default: false },
    { name: 'paddingUniform', displayName: 'Padding', type: 'integer', min: 0, max: 100 },
    { name: 'paddingTop', displayName: 'Top', type: 'integer' },
    { name: 'paddingRight', displayName: 'Right', type: 'integer' },
    { name: 'paddingBottom', displayName: 'Bottom', type: 'integer' },
    { name: 'paddingLeft', displayName: 'Left', type: 'integer' }
  ]
})

const ICON_NEW_CARD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none"><rect x="1.5" y="3.5" width="17" height="13" rx="2" stroke="#605E5C"/><rect x="4" y="6" width="5" height="4" rx="0.5" fill="#118DFF"/><rect x="11" y="6" width="5" height="4" rx="0.5" fill="#118DFF"/><rect x="4" y="12" width="5" height="1.5" fill="#605E5C"/><rect x="11" y="12" width="5" height="1.5" fill="#605E5C"/></svg>'
const ICON_CARD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none"><rect x="1.5" y="3.5" width="17" height="13" rx="1" stroke="#605E5C"/><text x="10" y="12.5" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="7" font-weight="700" fill="#118DFF">123</text><rect x="6" y="13.5" width="8" height="1" fill="#605E5C"/></svg>'
const ICON_MULTIROW =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none"><rect x="2" y="3" width="1.5" height="5" fill="#118DFF"/><rect x="5" y="3.5" width="11" height="1.5" fill="#605E5C"/><rect x="5" y="6.5" width="7" height="1" fill="#A19F9D"/><rect x="2" y="11" width="1.5" height="5" fill="#118DFF"/><rect x="5" y="11.5" width="11" height="1.5" fill="#605E5C"/><rect x="5" y="14.5" width="7" height="1" fill="#A19F9D"/></svg>'

function cardVisualData(visual: VisualDocument, ctx: VisualHostContext): { columns: string[]; rows: Scalar[][] } {
  const m = computeCardVisual(visual.json, ctx)
  const sections = m.sections ?? [{ title: undefined as string | undefined, callouts: m.callouts }]
  const columns: string[] = m.sections ? ['Category'] : []
  const first = sections[0]?.callouts ?? m.callouts
  for (const c of first) {
    columns.push(c.label.text)
    for (const r of c.refLabels) columns.push(r.title.text || r.id)
  }
  const rows: Scalar[][] = sections.map((s) => {
    const row: Scalar[] = m.sections ? [s.title ?? null] : []
    for (const c of s.callouts) {
      row.push(c.raw)
      for (const r of c.refLabels) row.push(r.value.raw)
    }
    return row
  })
  return { columns, rows: columns.length ? rows : [] }
}

const SIDES = ['Left', 'Right', 'Top', 'Bottom'].map((v) => ({ value: v, label: v }))
const LINE_STYLES = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' }
]
const FITS = [
  { value: 'Fit', label: 'Fit' },
  { value: 'Fill', label: 'Fill' },
  { value: 'Stretch', label: 'Stretch' },
  { value: 'Normal', label: 'Center' }
]
const corners = (): FormatPropDef[] => [
  { name: 'rectangleRoundedCurve', displayName: 'Rounded corners (px)', type: 'integer', min: 0, max: 100 },
  { name: 'rectangleRoundedCurveCustomStyle', displayName: 'Individual corners', type: 'bool' },
  { name: 'rectangleRoundedCurveLeftTop', displayName: 'Top left', type: 'integer', min: 0 },
  { name: 'rectangleRoundedCurveRightTop', displayName: 'Top right', type: 'integer', min: 0 },
  { name: 'rectangleRoundedCurveRightBottom', displayName: 'Bottom right', type: 'integer', min: 0 },
  { name: 'rectangleRoundedCurveLeftBottom', displayName: 'Bottom left', type: 'integer', min: 0 }
]
const OVERFLOW: FormatPropDef[] = [
  { name: 'overFlowStyle', displayName: 'Overflow style', type: 'enum', options: [{ value: 0, label: 'Continuous scroll' }, { value: 1, label: 'Paginate' }], default: 0 },
  { name: 'overFlowDirection', displayName: 'Overflow direction', type: 'enum', options: [{ value: 0, label: 'Vertical' }, { value: 1, label: 'Horizontal' }], default: 0 }
]
const ARRANGEMENT = [
  { value: 0, label: 'Horizontal' },
  { value: 1, label: 'Vertical' },
  { value: 2, label: 'Grid' }
]

const VALIGN = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' }
]

export const cardVisualDef: VisualDefinition = {
  type: 'cardVisual',
  displayName: 'Card',
  category: 'card',
  icon: ICON_NEW_CARD,
  roles: [
    { name: 'Data', displayName: 'Value', kind: 'both' },
    // "Categories" well (multi-category layout). The PBIR role name isn't publicly documented; 'Rows' assumed
    // (cardVisualModel also reads Category / Categories / SmallMultiple).
    { name: 'Rows', displayName: 'Categories', kind: 'grouping' }
  ],
  formatCards: [
    {
      object: 'layout',
      displayName: 'Multi-card layout',
      properties: [
        { name: 'orientation', displayName: 'Arrangement', type: 'enum', options: ARRANGEMENT, default: 0 },
        { name: 'maxTiles', displayName: 'Max cards shown', type: 'integer', min: 1, max: 30, default: 3 },
        { name: 'autoGrid', displayName: 'Fit to space', type: 'bool', default: true },
        { name: 'showFixedSize', displayName: 'Fixed size', type: 'bool', default: false },
        { name: 'fixedWidth', displayName: 'Card width (px)', type: 'integer', min: 20 },
        { name: 'fixedHeight', displayName: 'Card height (px)', type: 'integer', min: 20 },
        { name: 'columnCount', displayName: 'Columns', type: 'integer', min: 1 },
        { name: 'rowCount', displayName: 'Rows', type: 'integer', min: 1 },
        { name: 'cellPadding', displayName: 'Space between cards', type: 'integer', min: 0, default: 8 },
        { name: 'customizePadding', displayName: 'Customize spacing', type: 'bool' },
        { name: 'rowPadding', displayName: 'Space between rows', type: 'integer', min: 0 },
        { name: 'columnPadding', displayName: 'Space between columns', type: 'integer', min: 0 },
        { name: 'style', displayName: 'Style', type: 'enum', options: [{ value: 'Cards', label: 'Tiles' }, { value: 'Table', label: 'Table' }] },
        {
          name: 'alignment',
          displayName: 'Alignment',
          type: 'enum',
          options: [
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
            { value: 'top', label: 'Top (preview)' },
            { value: 'middle', label: 'Middle (preview)' },
            { value: 'bottom', label: 'Bottom (preview)' }
          ]
        },
        { name: 'calloutSize', displayName: 'Callout size (%)', type: 'number', min: 0, max: 100, default: 50 },
        {
          name: 'contentOrder',
          displayName: 'Order',
          type: 'enum',
          options: ['callout_referenceLabel_image', 'callout_image_referenceLabel', 'image_callout_referenceLabel', 'image_referenceLabel_callout', 'referenceLabel_callout_image', 'referenceLabel_image_callout'].map((v) => ({
            value: v,
            label: v
              .split('_')
              .map((x) => (x === 'referenceLabel' ? 'Reference label' : x[0].toUpperCase() + x.slice(1)))
              .join(', ')
          }))
        },
        { name: 'collage', displayName: 'Collage', type: 'enum', options: [{ value: 'None', label: 'None' }, { value: 'Default', label: 'Default' }, { value: 'Reverse', label: 'Reverse' }] },
        { name: 'backgroundShow', displayName: 'Background', type: 'bool' },
        { name: 'backgroundFillColor', displayName: 'Background color', type: 'color' },
        { name: 'customizeLines', displayName: 'Customize lines', type: 'bool' },
        { name: 'lineColor', displayName: 'Line color', type: 'color' },
        { name: 'lineWidth', displayName: 'Line width', type: 'integer', min: 0 },
        { name: 'lineStyle', displayName: 'Line style', type: 'enum', options: LINE_STYLES }
      ]
    },
    { object: 'overFlow', displayName: 'Overflow', properties: OVERFLOW },
    {
      object: 'value',
      displayName: 'Callout value',
      toggle: 'show',
      properties: [
        ...font(),
        { name: 'horizontalAlignment', displayName: 'Horizontal alignment', type: 'alignment', default: 'left' },
        { name: 'textWrap', displayName: 'Wrap text', type: 'bool', default: false },
        { name: 'labelDisplayUnits', displayName: 'Display units', type: 'displayUnits', options: UNITS },
        { name: 'labelPrecision', displayName: 'Value decimal places', type: 'integer', min: 0, max: 15 },
        { name: 'customFormatString', displayName: 'Format code', type: 'text' },
        { name: 'showBlankAs', displayName: 'Show blank as', type: 'text' }
      ]
    },
    {
      object: 'label',
      displayName: 'Category label',
      toggle: 'show',
      properties: [
        ...font(),
        { name: 'text', displayName: 'Text', type: 'text' },
        { name: 'position', displayName: 'Position', type: 'enum', options: [{ value: 'aboveValue', label: 'Above value' }, { value: 'belowValue', label: 'Below value' }], default: 'aboveValue' },
        { name: 'matchValueAlignment', displayName: 'Match value alignment', type: 'bool', default: true },
        { name: 'horizontalAlignment', displayName: 'Horizontal alignment', type: 'alignment' },
        { name: 'textWrap', displayName: 'Wrap text', type: 'bool', default: true }
      ]
    },
    { object: 'spacing', displayName: 'Callout spacing', properties: [{ name: 'verticalSpacing', displayName: 'Space between label and value', type: 'integer', min: 0 }] },
    {
      object: 'referenceLabelLayout',
      displayName: 'Reference labels layout',
      properties: [
        { name: 'position', displayName: 'Arrangement', type: 'enum', options: [{ value: 'below', label: 'Vertical (below callout)' }, { value: 'right', label: 'Horizontal (right of callout)' }] },
        { name: 'arrangement', displayName: 'Labels', type: 'enum', options: [{ value: 'rows', label: 'Rows' }, { value: 'columns', label: 'Columns' }] },
        { name: 'style', displayName: 'Style', type: 'enum', options: [{ value: 'tabular', label: 'Tabular' }, { value: 'sentence', label: 'Sentence' }] },
        { name: 'labelSpace', displayName: 'Space between labels', type: 'number' },
        { name: 'valueArea', displayName: 'Value area (%)', type: 'number', min: 0, max: 100 },
        { name: 'horizontalAlignment', displayName: 'Horizontal alignment', type: 'alignment' },
        { name: 'verticalAlignment', displayName: 'Vertical alignment', type: 'enum', options: VALIGN },
        { name: 'paddingBeforeDivider', displayName: 'Padding before divider', type: 'number' },
        { name: 'paddingAfterDivider', displayName: 'Padding after divider', type: 'number' }
      ]
    },
    {
      object: 'referenceLabelTitle',
      displayName: 'Reference label title',
      toggle: 'show',
      properties: [
        { name: 'titleContentType', displayName: 'Content', type: 'enum', options: [{ value: 'fieldName', label: 'Field name' }, { value: 'custom', label: 'Custom' }] },
        { name: 'titleText', displayName: 'Text', type: 'text' },
        { name: 'titleFontFamily', displayName: 'Font', type: 'fontFamily' },
        { name: 'titleFontSize', displayName: 'Font size', type: 'fontSize' },
        { name: 'titleFontColor', displayName: 'Color', type: 'color' },
        { name: 'titleBold', displayName: 'Bold', type: 'bool' },
        { name: 'textWrap', displayName: 'Wrap text', type: 'bool' }
      ]
    },
    {
      object: 'referenceLabelValue',
      displayName: 'Reference label value',
      toggle: 'show',
      properties: [
        { name: 'valueFontFamily', displayName: 'Font', type: 'fontFamily' },
        { name: 'valueFontSize', displayName: 'Font size', type: 'fontSize' },
        { name: 'valueFontColor', displayName: 'Color', type: 'color' },
        { name: 'valueBold', displayName: 'Bold', type: 'bool' },
        { name: 'valueDisplayUnits', displayName: 'Display units', type: 'displayUnits', options: UNITS },
        { name: 'valuePrecision', displayName: 'Value decimal places', type: 'integer', min: 0, max: 15 },
        { name: 'customFormatString', displayName: 'Format code', type: 'text' },
        { name: 'showBlankAs', displayName: 'Show blank as', type: 'text' }
      ]
    },
    {
      object: 'referenceLabelDetail',
      displayName: 'Reference label detail',
      toggle: 'show',
      properties: [
        { name: 'detailFontFamily', displayName: 'Font', type: 'fontFamily' },
        { name: 'detailFontSize', displayName: 'Font size', type: 'fontSize' },
        { name: 'detailFontColor', displayName: 'Color', type: 'color' },
        { name: 'detailBackgroundColor', displayName: 'Background', type: 'color' },
        { name: 'detailDisplayUnits', displayName: 'Display units', type: 'displayUnits', options: UNITS },
        { name: 'detailPrecision', displayName: 'Value decimal places', type: 'integer', min: 0, max: 15 }
      ]
    },
    {
      object: 'referenceLabel',
      displayName: 'Reference labels area',
      properties: [
        { name: 'backgroundShow', displayName: 'Background', type: 'bool', default: true },
        { name: 'backgroundColor', displayName: 'Background color', type: 'color' },
        { name: 'backgroundTransparency', displayName: 'Background transparency', type: 'percent', min: 0, max: 100 },
        ...padding('referenceLabel', '').properties,
        ...corners()
      ]
    },
    {
      object: 'fillCustom',
      displayName: 'Card background',
      toggle: 'show',
      properties: [
        { name: 'fillColor', displayName: 'Color', type: 'color' },
        { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100 },
        { name: 'imageShow', displayName: 'Add image', type: 'bool' },
        { name: 'imageUrl', displayName: 'Image URL', type: 'text' },
        { name: 'imageFit', displayName: 'Image fit', type: 'enum', options: FITS }
      ]
    },
    {
      object: 'outline',
      displayName: 'Card border',
      toggle: 'show',
      properties: [
        { name: 'show', displayName: 'Show', type: 'bool', default: true },
        { name: 'lineColor', displayName: 'Color', type: 'color' },
        { name: 'weight', displayName: 'Width', type: 'integer', min: 0, max: 20, default: 1 },
        { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100 }
      ]
    },
    {
      object: 'shapeCustomRectangle',
      displayName: 'Card shape',
      properties: [{ name: 'tileShape', displayName: 'Shape', type: 'enum', options: [{ value: 'rectangle', label: 'Rectangle' }, { value: 'rectangleRoundedByPixel', label: 'Rounded rectangle' }] }, ...corners()]
    },
    {
      object: 'accentBar',
      displayName: 'Accent bar',
      toggle: 'show',
      properties: [
        { name: 'color', displayName: 'Color', type: 'color' },
        { name: 'position', displayName: 'Position', type: 'enum', options: SIDES },
        { name: 'width', displayName: 'Width', type: 'integer', min: 1, max: 30, default: 6 },
        { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100 }
      ]
    },
    {
      object: 'shadowCustom',
      displayName: 'Card shadow',
      toggle: 'show',
      properties: [
        { name: 'color', displayName: 'Color', type: 'color' },
        { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 70 },
        { name: 'shadowPositionPreset', displayName: 'Preset', type: 'enum', options: ['bottomRight', 'bottom', 'bottomLeft', 'centerRight', 'center', 'centerLeft', 'topRight', 'top', 'topLeft', 'custom'].map((v) => ({ value: v, label: v })) },
        { name: 'position', displayName: 'Offset', type: 'enum', options: [{ value: 'Outer', label: 'Outside' }, { value: 'Inner', label: 'Inside' }] },
        { name: 'shadowBlur', displayName: 'Blur', type: 'number', min: 0 },
        { name: 'shadowDistance', displayName: 'Distance', type: 'number', min: 0 },
        { name: 'shadowSpread', displayName: 'Size', type: 'number', min: 0 },
        { name: 'angle', displayName: 'Angle', type: 'number', min: 0, max: 360 }
      ]
    },
    {
      object: 'glowCustom',
      displayName: 'Card glow',
      toggle: 'show',
      properties: [
        { name: 'color', displayName: 'Color', type: 'color' },
        { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100, default: 50 },
        { name: 'shadowBlur', displayName: 'Blur', type: 'number', min: 0 },
        { name: 'glowSpread', displayName: 'Size', type: 'number', min: 0 }
      ]
    },
    {
      object: 'divider',
      displayName: 'Divider',
      toggle: 'show',
      properties: [
        { name: 'dividerColor', displayName: 'Color', type: 'color' },
        { name: 'dividerWidth', displayName: 'Width', type: 'integer', min: 0, default: 1 },
        { name: 'dividerLineStyle', displayName: 'Line style', type: 'enum', options: LINE_STYLES },
        { name: 'dividerTransparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100 },
        { name: 'dividerIgnorePadding', displayName: 'Ignore padding', type: 'bool' }
      ]
    },
    {
      object: 'padding',
      displayName: 'Card padding',
      properties: [
        { name: 'paddingSelection', displayName: 'Size', type: 'enum', options: [{ value: 'Narrow', label: 'Narrow' }, { value: 'Normal', label: 'Normal' }, { value: 'Wide', label: 'Wide' }, { value: 'Custom', label: 'Custom' }], default: 'Normal' },
        { name: 'paddingUniform', displayName: 'Padding (Size: Custom)', type: 'integer', min: 0, max: 100 },
        { name: 'paddingIndividual', displayName: 'Individual padding', type: 'bool', default: false },
        { name: 'topMargin', displayName: 'Top', type: 'integer', min: 0 },
        { name: 'rightMargin', displayName: 'Right', type: 'integer', min: 0 },
        { name: 'bottomMargin', displayName: 'Bottom', type: 'integer', min: 0 },
        { name: 'leftMargin', displayName: 'Left', type: 'integer', min: 0 }
      ]
    },
    {
      object: 'cardCalloutArea',
      displayName: 'Callout area',
      properties: [
        { name: 'show', displayName: 'Background', type: 'bool' },
        { name: 'backgroundFillColor', displayName: 'Background color', type: 'color' },
        { name: 'backgroundTransparency', displayName: 'Background transparency', type: 'percent', min: 0, max: 100 },
        ...padding('cardCalloutArea', '').properties,
        ...corners()
      ]
    },
    {
      object: 'image',
      displayName: 'Callout image',
      toggle: 'show',
      properties: [
        { name: 'imageType', displayName: 'Image source', type: 'enum', options: [{ value: 'imageData', label: 'Select from data' }, { value: 'imageUrl', label: 'Image URL' }] },
        { name: 'imageUrl', displayName: 'URL', type: 'text' },
        { name: 'position', displayName: 'Position', type: 'enum', options: SIDES },
        { name: 'fit', displayName: 'Image fit', type: 'enum', options: FITS },
        { name: 'imageAreaSize', displayName: 'Image area size (%)', type: 'integer', min: 0, max: 100, default: 50 },
        { name: 'fixedSize', displayName: 'Fixed size', type: 'bool' },
        { name: 'size', displayName: 'Size (px)', type: 'integer', min: 1 },
        { name: 'padding', displayName: 'Space between image and callout', type: 'integer' },
        { name: 'transparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100 },
        { name: 'verticalAlignment', displayName: 'Vertical alignment', type: 'enum', options: VALIGN },
        { name: 'horizontalAlignment', displayName: 'Horizontal alignment', type: 'alignment' },
        ...corners()
      ]
    },
    {
      object: 'cardImage',
      displayName: 'Image',
      toggle: 'show',
      properties: [
        { name: 'imageType', displayName: 'Image source', type: 'enum', options: [{ value: 'imageUrl', label: 'Image URL' }, { value: 'imageData', label: 'Select from data' }] },
        { name: 'imageUrl', displayName: 'URL', type: 'text' },
        { name: 'imageUrlFit', displayName: 'Image fit', type: 'enum', options: FITS },
        { name: 'imageDataFit', displayName: 'Image fit (data)', type: 'enum', options: FITS },
        { name: 'imageHeight', displayName: 'Image height (px)', type: 'integer', min: 0 },
        { name: 'imageTransparency', displayName: 'Transparency', type: 'percent', min: 0, max: 100 },
        { name: 'addBackground', displayName: 'Add background', type: 'bool' },
        { name: 'backgroundFillColor', displayName: 'Background color', type: 'color' },
        ...padding('cardImage', '').properties,
        ...corners()
      ]
    },
    {
      object: 'smallMultiplesLayout',
      displayName: 'Multi-category layout',
      properties: [
        { name: 'orientation', displayName: 'Arrangement', type: 'enum', options: ARRANGEMENT, default: 1 },
        { name: 'autoGrid', displayName: 'Fit to space', type: 'bool', default: true },
        { name: 'columnCount', displayName: 'Columns', type: 'integer', min: 1 },
        { name: 'rowCount', displayName: 'Rows', type: 'integer', min: 1 },
        { name: 'cellPadding', displayName: 'Space between categories', type: 'integer', min: 0, default: 8 },
        { name: 'style', displayName: 'Style', type: 'enum', options: [{ value: 'Cards', label: 'Tiles' }, { value: 'Table', label: 'Table' }] },
        { name: 'headerPosition', displayName: 'Header position', type: 'enum', options: SIDES },
        { name: 'titleOrientation', displayName: 'Header orientation', type: 'enum', options: [{ value: 0, label: 'Horizontal' }, { value: 1, label: 'Vertical' }] },
        { name: 'maxHeaderSize', displayName: 'Maximum header size', type: 'integer', min: 0 },
        { name: 'concatenateCategories', displayName: 'Concatenate labels', type: 'bool', default: true }
      ]
    },
    {
      object: 'smallMultiplesHeader',
      displayName: 'Category header',
      properties: [
        ...font(),
        { name: 'horizontalAlignment', displayName: 'Horizontal alignment', type: 'alignment' },
        { name: 'verticalAlignment', displayName: 'Vertical alignment', type: 'enum', options: VALIGN },
        { name: 'backgroundShow', displayName: 'Background', type: 'bool' },
        { name: 'backgroundColor', displayName: 'Background color', type: 'color' },
        { name: 'textWrap', displayName: 'Wrap text', type: 'bool', default: true }
      ]
    },
    { object: 'smallMultiplesOverFlow', displayName: 'Multi-category overflow', properties: OVERFLOW },
    {
      object: 'smallMultiplesBorder',
      displayName: 'Category border',
      toggle: 'gridlineShow',
      properties: [
        { name: 'gridlineShow', displayName: 'Show', type: 'bool', default: false },
        { name: 'gridlineColor', displayName: 'Color', type: 'color' },
        { name: 'gridlineWidth', displayName: 'Width', type: 'integer', min: 0 },
        { name: 'gridlineStyle', displayName: 'Line style', type: 'enum', options: LINE_STYLES }
      ]
    },
    {
      object: 'smallMultiplesGrid',
      displayName: 'Category gridlines',
      toggle: 'gridlineShow',
      properties: [
        { name: 'gridlineShow', displayName: 'Show', type: 'bool' },
        { name: 'gridlineColor', displayName: 'Color', type: 'color' },
        { name: 'gridlineWidth', displayName: 'Width', type: 'integer', min: 0 },
        { name: 'gridlineStyle', displayName: 'Line style', type: 'enum', options: LINE_STYLES },
        {
          name: 'gridlineRegion',
          displayName: 'Gridlines',
          type: 'enum',
          options: [
            { value: 'all', label: 'All' },
            { value: 'inner', label: 'Inner' },
            { value: 'innerHorizontal', label: 'Inner horizontal' },
            { value: 'innerVertical', label: 'Inner vertical' }
          ]
        }
      ]
    }
  ],
  component: CardVisualView,
  inGallery: true,
  getData: cardVisualData,
  defaultSize: { width: 280, height: 160 },
  formatDefaults: cardVisualFormatDefaults
}

export const legacyCardDef: VisualDefinition = {
  type: 'card',
  // PBI renamed the legacy single card after the new card went GA (Nov 2025)
  displayName: 'Card (legacy)',
  category: 'card',
  icon: ICON_CARD,
  roles: [{ name: 'Values', displayName: 'Fields', kind: 'both', max: 1 }],
  formatDefaults: (json, theme) => buildLegacyCardModel(json, theme, (v) => String(v), '', { value: 1 }),
  formatCards: [
    {
      object: 'labels',
      displayName: 'Callout value',
      properties: [
        { name: 'color', displayName: 'Color', type: 'color' },
        { name: 'fontFamily', displayName: 'Font', type: 'fontFamily' },
        { name: 'fontSize', displayName: 'Font size', type: 'fontSize' },
        { name: 'bold', displayName: 'Bold', type: 'bool' },
        { name: 'italic', displayName: 'Italic', type: 'bool' },
        { name: 'underline', displayName: 'Underline', type: 'bool' },
        { name: 'labelDisplayUnits', displayName: 'Display units', type: 'displayUnits', options: UNITS },
        { name: 'labelPrecision', displayName: 'Value decimal places', type: 'integer', min: 0, max: 15 },
        { name: 'preserveWhitespace', displayName: 'Source spacing', type: 'bool' }
      ]
    },
    {
      object: 'categoryLabels',
      displayName: 'Category label',
      toggle: 'show',
      properties: [
        { name: 'show', displayName: 'Show', type: 'bool', default: true },
        { name: 'color', displayName: 'Color', type: 'color' },
        { name: 'fontFamily', displayName: 'Font', type: 'fontFamily' },
        { name: 'fontSize', displayName: 'Font size', type: 'fontSize', default: 12 },
        { name: 'bold', displayName: 'Bold', type: 'bool' },
        { name: 'italic', displayName: 'Italic', type: 'bool' },
        { name: 'underline', displayName: 'Underline', type: 'bool' },
        { name: 'preserveWhitespace', displayName: 'Source spacing', type: 'bool' }
      ]
    },
    { object: 'wordWrap', displayName: 'Word wrap', toggle: 'show', properties: [{ name: 'show', displayName: 'Show', type: 'bool', default: true }] }
  ],
  component: LegacyCardView,
  inGallery: true,
  getData: (visual, ctx) => {
    const m = computeLegacyCard(visual.json, ctx)
    return m ? { columns: [m.category.text], rows: [[m.raw]] } : undefined
  },
  defaultSize: { width: 220, height: 120 }
}

export const multiRowCardDef: VisualDefinition = {
  type: 'multiRowCard',
  displayName: 'Multi-row card',
  category: 'card',
  icon: ICON_MULTIROW,
  roles: [{ name: 'Values', displayName: 'Fields', kind: 'both' }],
  formatDefaults: (json, theme) => multiRowStyle(json, theme),
  formatCards: [
    {
      object: 'dataLabels',
      displayName: 'Callout values',
      properties: [
        { name: 'color', displayName: 'Color', type: 'color' },
        { name: 'fontFamily', displayName: 'Font', type: 'fontFamily' },
        { name: 'fontSize', displayName: 'Font size', type: 'fontSize' },
        { name: 'bold', displayName: 'Bold', type: 'bool' },
        { name: 'italic', displayName: 'Italic', type: 'bool' },
        { name: 'underline', displayName: 'Underline', type: 'bool' }
      ]
    },
    {
      object: 'categoryLabels',
      displayName: 'Category labels',
      toggle: 'show',
      properties: [
        { name: 'color', displayName: 'Color', type: 'color' },
        { name: 'fontFamily', displayName: 'Font', type: 'fontFamily' },
        { name: 'fontSize', displayName: 'Font size', type: 'fontSize' }
      ]
    },
    {
      object: 'cardTitle',
      displayName: 'Card title',
      toggle: 'show',
      properties: [
        { name: 'color', displayName: 'Color', type: 'color' },
        { name: 'fontFamily', displayName: 'Font', type: 'fontFamily' },
        { name: 'fontSize', displayName: 'Font size', type: 'fontSize' }
      ]
    },
    {
      object: 'card',
      displayName: 'Card',
      properties: [
        {
          name: 'outlineStyle',
          displayName: 'Outline',
          type: 'enum',
          options: ['None', 'Bottom only', 'Top only', 'Left only', 'Right only', 'Top + bottom', 'Left + right', 'Frame'].map((label, value) => ({ value, label })),
          default: 1
        },
        { name: 'outlineColor', displayName: 'Outline color', type: 'color' },
        { name: 'outlineWeight', displayName: 'Outline weight', type: 'integer', min: 1, max: 10 },
        { name: 'barShow', displayName: 'Show bar', type: 'bool', default: true },
        { name: 'barColor', displayName: 'Bar color', type: 'color' },
        { name: 'barWeight', displayName: 'Bar thickness', type: 'integer', min: 1, max: 20 },
        { name: 'cardPadding', displayName: 'Padding', type: 'integer' },
        { name: 'cardBackground', displayName: 'Background', type: 'color' }
      ]
    }
  ],
  component: MultiRowCardView,
  inGallery: true,
  getData: (visual, ctx) => {
    const { records, fields } = computeMultiRow(visual.json, ctx)
    if (!fields.length) return undefined
    const hasTitle = records.some((r) => r.title !== undefined)
    const columns = fields.map((f) => f.displayName ?? ctx.engine.describeField(f.expr)?.displayName ?? f.queryRef)
    return { columns, rows: records.map((r) => [...(hasTitle ? [r.title ?? null] : []), ...r.items.map((i) => i.text)]) }
  },
  defaultSize: { width: 300, height: 260 }
}

registerVisual(cardVisualDef)
registerVisual(legacyCardDef)
registerVisual(multiRowCardDef)
