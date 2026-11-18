/** Dev gallery entries for the element visuals (rendered against the sample engine + mock host). */
import { registerNonChartEntries } from '../gallery/entries-nonchart'
import type { NonChartGalleryEntry } from '../common/nonchartGallery'
import { S } from '../common/sampleData'
import { registerGalleryEntries } from '../gallery/registry'
import type { ReportInfo } from '../contract'
import { columnExpr, measureExpr } from '@core/report/sq'
import { smartNarrativeVisualJson } from './smartNarrative'

const L = (v: string | number | boolean) => ({
  expr: { Literal: { Value: typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : typeof v === 'number' ? (Number.isInteger(v) ? `${v}L` : `${v}D`) : String(v) } }
})
const C = (hex: string) => ({ solid: { color: L(hex) } })
const T = (id: number, pct = 0) => ({ solid: { color: { expr: { ThemeDataColor: { ColorId: id, Percent: pct } } } } })
const vis = (visualType: string, objects: Record<string, any>, extra: Record<string, any> = {}) => ({ name: visualType, visual: { visualType, objects, ...extra } })

const LOGO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 240 80"><rect x="4" y="14" width="52" height="52" rx="10" fill="#118DFF"/><path d="M18 52V30m10 22V24m10 28V36" stroke="#fff" stroke-width="6" stroke-linecap="round"/><text x="68" y="50" font-family="Segoe UI, Arial" font-size="26" font-weight="600" fill="#252423">Contoso</text></svg>'
  )

export const galleryEntries: NonChartGalleryEntry[] = [
  {
    id: 'textbox-rich',
    title: 'Text box — rich text, list, dynamic value',
    width: 320,
    height: 170,
    visualJson: vis('textbox', {
      general: [
        {
          properties: {
            paragraphs: [
              { textRuns: [{ value: 'Sales overview', textStyle: { fontFamily: 'Segoe UI Semibold', fontSize: '16pt', color: '#12239E' } }] },
              {
                textRuns: [
                  { value: 'Total sales this period: ', textStyle: { fontSize: '11pt', color: '#605E5C' } },
                  { value: '', valueExpr: S.m('Total Sales'), textStyle: { fontSize: '11pt', fontWeight: 'bold', color: '#118DFF' } }
                ]
              },
              { textRuns: [{ value: 'Bikes drive most revenue', textStyle: { fontSize: '10pt' } }], listType: 'bullet' },
              { textRuns: [{ value: 'Margins are stable', textStyle: { fontSize: '10pt' } }], listType: 'bullet' },
              { textRuns: [{ value: 'Europe ', textStyle: { fontSize: '10pt' } }, { value: 'grew fastest', textStyle: { fontSize: '10pt', fontStyle: 'italic' } }], listType: 'bullet', indent: 1 },
              { textRuns: [{ value: 'Open documentation', url: 'https://learn.microsoft.com/power-bi/', textStyle: { fontSize: '10pt', color: '#0078D4' } }], horizontalTextAlignment: 'right' }
            ]
          }
        }
      ]
    })
  },
  {
    id: 'shape-rounded',
    title: 'Shape — rounded rectangle with text & shadow',
    width: 240,
    height: 110,
    visualJson: vis('shape', {
      shape: [{ properties: { tileShape: L('rectangleRounded'), rectangleRoundedCurve: L(14) } }],
      fill: [{ properties: { show: L(true), fillColor: T(2, 0.6), transparency: L(0) } }],
      outline: [{ properties: { show: L(true), lineColor: T(2), weight: L(2) } }],
      text: [{ properties: { show: L(true), text: L('KPI panel'), fontSize: L(14), bold: L(true), fontColor: C('#12239E') } }],
      shadow: [{ properties: { show: L(true), color: C('#000000'), transparency: L(75), shadowDistance: L(4), shadowBlur: L(8) } }]
    })
  },
  ...(['oval', 'arrow', 'hexagon', 'chevron', 'speechBubble', 'heart', 'tabRoundTopCorners', 'line'] as const).map(
    (kind, i): NonChartGalleryEntry => ({
      id: `shape-${kind}`,
      title: `Shape — ${kind}`,
      width: 150,
      height: 100,
      visualJson: vis('shape', {
        shape: [{ properties: { tileShape: L(kind) } }],
        fill: [{ properties: { show: L(true), fillColor: T(2 + i) } }],
        outline: [{ properties: { show: L(kind === 'line'), lineColor: T(2 + i), weight: L(3) } }],
        rotation: [{ properties: { shapeAngle: L(kind === 'arrow' ? 0 : 0) } }]
      })
    })
  ),
  {
    id: 'image-logo',
    title: 'Image — Normal scaling',
    width: 240,
    height: 90,
    visualJson: vis('image', { general: [{ properties: { imageUrl: L(LOGO) } }], imageScaling: [{ properties: { imageScalingType: L('Normal') } }] })
  },
  {
    id: 'button-clear',
    title: 'Button — Clear all slicers',
    width: 160,
    height: 36,
    visualJson: vis(
      'actionButton',
      {
        icon: [
          { properties: { shapeType: L('clearAllSlicers'), placement: L('right'), lineColor: T(2), lineWeight: L(2), leftMargin: L(10) }, selector: { id: 'default' } },
          { properties: { show: L(true) } }
        ],
        text: [
          { properties: { show: L(true) } },
          { properties: { text: L('Clear filters'), horizontalAlignment: L('center'), fontColor: T(2), italic: L(true), topMargin: L(0) }, selector: { id: 'default' } }
        ],
        outline: [{ properties: { show: L(true), lineColor: T(2), roundEdge: L(6) } }]
      },
      { visualContainerObjects: { visualLink: [{ properties: { show: L(true), type: L('ClearAllSlicers'), tooltipPlaceholderText: L('Clear all slicers') } }] } }
    )
  },
  {
    id: 'button-back',
    title: 'Button — Back (icon only)',
    width: 48,
    height: 48,
    visualJson: vis('actionButton', { outline: [{ properties: { show: L(false) } }], fill: [{ properties: { show: L(false) } }] }, { visualContainerObjects: { visualLink: [{ properties: { show: L(true), type: L('Back') } }] } })
  },
  {
    id: 'button-nav',
    title: 'Button — Page navigation, filled',
    width: 170,
    height: 40,
    visualJson: vis(
      'actionButton',
      {
        icon: [{ properties: { shapeType: L('rightArrow'), placement: L('right'), lineColor: C('#FFFFFF') } }],
        text: [{ properties: { show: L(true), text: L('Go to details'), fontColor: C('#FFFFFF'), fontSize: L(11) } }],
        fill: [{ properties: { show: L(true), fillColor: T(2) } }, { properties: { fillColor: T(2, -0.3) }, selector: { id: 'hover' } }],
        outline: [{ properties: { show: L(false) } }],
        shape: [{ properties: { tileShape: L('rectangleRounded'), rectangleRoundedCurve: L(20) } }]
      },
      { visualContainerObjects: { visualLink: [{ properties: { show: L(true), type: L('PageNavigation'), navigationSection: L('p2') } }] } }
    )
  },
  {
    id: 'pagenav-vertical',
    title: 'Page navigator — vertical',
    width: 200,
    height: 140,
    visualJson: vis('pageNavigator', {
      layout: [{ properties: { orientation: L(1), cellPadding: L(5) } }],
      shape: [{ properties: { roundEdge: L(10) }, selector: { id: 'default' } }],
      text: [
        { properties: { fontFamily: L("'Segoe UI', wf_segoe-ui_normal, helvetica, arial, sans-serif"), horizontalAlignment: L('left'), leftMargin: L(20), fontColor: T(2, -0.5) }, selector: { id: 'default' } },
        { properties: { fontFamily: L("'Segoe UI Semibold', wf_segoe-ui_semibold, helvetica, arial, sans-serif"), fontColor: T(3) }, selector: { id: 'selected' } }
      ],
      fill: [{ properties: { show: L(true) } }, { properties: { fillColor: T(3, 0.6), transparency: L(64) }, selector: { id: 'selected' } }, { properties: { transparency: L(100) }, selector: { id: 'default' } }],
      outline: [{ properties: { show: L(true) } }, { properties: { lineColor: T(3), transparency: L(1) }, selector: { id: 'selected' } }, { properties: { transparency: L(100) }, selector: { id: 'default' } }],
      pages: [{ properties: { showHiddenPages: L(false) } }]
    })
  },
  {
    id: 'pagenav-horizontal',
    title: 'Page navigator — horizontal defaults',
    width: 420,
    height: 36,
    visualJson: vis('pageNavigator', { layout: [{ properties: { orientation: L(0), cellPadding: L(6) } }] })
  },
  {
    id: 'bookmarknav',
    title: 'Bookmark navigator',
    width: 300,
    height: 36,
    visualJson: vis('bookmarkNavigator', { shape: [{ properties: { roundEdge: L(18) } }], fill: [{ properties: { fillColor: C('#F3F2F1') } }] })
  },
  {
    id: 'shape-defaults',
    title: 'Shape — Power BI defaults (theme color 1)',
    width: 160,
    height: 90,
    visualJson: vis('shape', { shape: [{ properties: { tileShape: L('rectangle') } }] })
  },
  {
    id: 'textbox-defaults',
    title: 'Text box — unformatted (Segoe UI 10pt #252423)',
    width: 260,
    height: 70,
    visualJson: vis('textbox', { general: [{ properties: { paragraphs: [{ textRuns: [{ value: 'Quarterly results' }] }, { textRuns: [{ value: 'Plain text, no formatting applied.' }] }] } }] })
  },
  {
    id: 'button-blank-defaults',
    title: 'Button — Blank (defaults)',
    width: 120,
    height: 40,
    visualJson: vis('actionButton', {})
  },
  {
    id: 'button-defaults',
    title: 'Button — Back (defaults)',
    width: 60,
    height: 40,
    visualJson: vis('actionButton', { icon: [{ properties: { shapeType: L('back') } }] }, { visualContainerObjects: { visualLink: [{ properties: { show: L(true), type: L('Back') } }] } })
  }
]

registerNonChartEntries('Elements', galleryEntries)

/**
 * Entries that need the gallery's real engine over its sample model (Q&A reads the model schema) or a
 * custom ReportInfo (active bookmark, drill-through page fields) — registered directly.
 */
const DT_REPORT: ReportInfo = {
  pages: [
    { name: 'p1', displayName: 'Overview', hidden: false },
    { name: 'p2', displayName: 'Product details', hidden: true, isDrillthrough: true, drillthroughFields: [columnExpr('Sales', 'Product')] }
  ],
  activePage: 'p1',
  bookmarks: [
    { name: 'b1', displayName: 'Default view' },
    { name: 'b2', displayName: 'Top regions' },
    { name: 'b3', displayName: 'Margins' }
  ],
  activeBookmark: 'b2',
  resolveImage: () => undefined
}
const FORMATS: Record<string, string> = { 'Total Sales': '\\$#,0', Orders: '#,0' }
const smartNarrative = (name: string, category: string, measures: string[]) =>
  smartNarrativeVisualJson(name, { category: columnExpr('Sales', category), categoryName: category, measures: measures.map((m) => measureExpr('Sales', m)), measureNames: measures, formatStrings: measures.map((m) => FORMATS[m]) })
const qna = (question: string) => vis('qnaVisual', question ? { general: [{ properties: { question: L(question) } }] } : {})
const dtButton = vis(
  'actionButton',
  { text: [{ properties: { show: L(true), text: L('Product details') } }], icon: [{ properties: { show: L(false) } }] },
  { visualContainerObjects: { visualLink: [{ properties: { show: L(true), type: L('Drillthrough'), drillthroughSection: L('p2') } }] } }
)
registerGalleryEntries(
  [
    { id: 'qna-bar', title: 'Q&A — "top 5 products by total sales"', json: qna('top 5 products by total sales'), width: 440, height: 300 },
    { id: 'qna-line', title: 'Q&A — "total sales by month as line chart for europe"', json: qna('total sales by month as line chart for europe'), width: 440, height: 300 },
    { id: 'qna-matrix', title: 'Q&A — "margin % by region and channel"', json: qna('margin % by region and channel'), width: 440, height: 240 },
    { id: 'qna-card', title: 'Q&A — "average price for bikes" (+ unknown word)', json: qna('average price for bikes in narnia'), width: 360, height: 170, mode: 'edit' as const },
    { id: 'qna-empty', title: 'Q&A — empty (suggested questions)', json: qna(''), width: 440, height: 170, mode: 'edit' as const },
    { id: 'smartnarrative-edit', title: 'Smart narrative (text box) — Region × Total Sales, edit mode (values underlined)', json: smartNarrative('sn_region', 'Region', ['Total Sales']), width: 380, height: 220, mode: 'edit' as const },
    { id: 'smartnarrative-kpi', title: 'Smart narrative (text box) — Channel × Total Sales, Orders, reading view', json: smartNarrative('sn_channel', 'Channel', ['Total Sales', 'Orders']), width: 380, height: 220 },
    { id: 'bookmarknav-active', title: 'Bookmark navigator — applied bookmark (ReportInfo.activeBookmark)', json: vis('bookmarkNavigator', {}), width: 380, height: 36 },
    { id: 'button-drillthrough-off', title: 'Drill-through button — nothing selected (disabled)', json: dtButton, width: 160, height: 40 },
    {
      id: 'button-drillthrough-on',
      title: 'Drill-through button — product selected (enabled)',
      json: dtButton,
      width: 160,
      height: 40,
      pageSelection: [{ fields: [{ expr: columnExpr('Sales', 'Product'), value: 'Road-150' }] }]
    }
  ].map(({ pageSelection, ...e }: any) => ({
    ...e,
    id: `Elements:${e.id}`,
    section: 'Elements',
    width: e.width + 12,
    height: e.height + 32,
    // the gallery host has no page selection; a button falls back to its own ctx.selection
    selection: pageSelection,
    report: DT_REPORT
  }))
)
