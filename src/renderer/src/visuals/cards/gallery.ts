/** Dev-gallery entries for the card visuals (sample model: common/sampleData.ts). */
import { registerNonChartEntries } from '../gallery/entries-nonchart'
import type { NonChartGalleryEntry } from '../common/nonchartGallery'
import { S, proj } from '../common/sampleData'

const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
const color = (hex: string) => ({ solid: { color: lit(`'${hex}'`) } })
const themeColor = (id: number, pct = 0) => ({ solid: { color: { expr: { ThemeDataColor: { ColorId: id, Percent: pct } } } } })
const def = { id: 'default' }

function v(visualType: string, queryState: any, objects: any = {}, extra: any = {}) {
  return { name: `gallery-${visualType}`, visual: { visualType, query: { queryState, ...extra }, objects } }
}

const SALES_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#E8F3FF"/><path d="M6 15l4-4 3 3 5-6" stroke="#118DFF" stroke-width="2" fill="none" stroke-linecap="round"/></svg>')

const icon = (glyph: string, color: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="${color}" stroke-width="1.5"/><text x="12" y="17" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="13" font-weight="600" fill="${color}">${glyph}</text></svg>`
  )
const TREND = (stroke: string, fill = 'none') =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 50" preserveAspectRatio="xMidYMid meet"><path d="M4 40 L24 30 L44 34 L64 18 L84 22 L104 8 L116 12 L116 48 L4 48 Z" fill="${fill}" opacity="0.15"/><polyline points="4,40 24,30 44,34 64,18 84,22 104,8 116,12" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  )
const hover = { id: 'interaction:hover' }
const ms = (...names: string[]) => names.map((n) => proj(S.m(n), `_m.${n}`))

export const galleryEntries: NonChartGalleryEntry[] = [
  {
    id: 'cardVisual-default',
    title: 'Card (new) — defaults, single callout',
    width: 260,
    height: 140,
    visualJson: v('cardVisual', { Data: { projections: [proj(S.m('Total Sales'), '_m.Total Sales')] } })
  },
  {
    id: 'cardVisual-multi',
    title: 'Card (new) — three callouts, horizontal',
    width: 620,
    height: 140,
    visualJson: v(
      'cardVisual',
      { Data: { projections: [proj(S.m('Total Sales'), '_m.Total Sales'), proj(S.m('Orders'), '_m.Orders'), proj(S.m('Margin %'), '_m.Margin %')] } },
      {
        outline: [{ properties: { show: lit('true') }, selector: def }],
        shapeCustomRectangle: [{ properties: { rectangleRoundedCurve: lit('8L'), tileShape: lit("'rectangleRoundedByPixel'") }, selector: def }],
        value: [{ properties: { fontColor: { solid: { color: { expr: S.m('Margin Color') } } } }, selector: { metadata: '_m.Margin %' } }]
      }
    )
  },
  {
    id: 'cardVisual-reference',
    title: 'Card (new) — reference labels below (KPI style)',
    width: 320,
    height: 160,
    visualJson: v(
      'cardVisual',
      { Data: { projections: [proj(S.m('Total Sales'), '_m.Total Sales', { displayName: 'Revenue' })] } },
      {
        outline: [{ properties: { show: lit('false') }, selector: def }],
        layout: [{ properties: { alignment: lit("'top'"), calloutSize: lit('60D') } }],
        value: [{ properties: { horizontalAlignment: lit("'left'"), fontColor: color('#12239E') }, selector: def }],
        label: [{ properties: { fontSize: lit('10D'), fontColor: themeColor(1) }, selector: def }],
        padding: [{ properties: { paddingUniform: lit('5L'), paddingIndividual: lit('false'), topMargin: lit('0L') }, selector: def }],
        divider: [{ properties: { show: lit('false') }, selector: def }],
        image: [
          {
            properties: { show: lit('true'), imageType: lit("'imageUrl'"), imageUrl: lit(`'${SALES_ICON}'`), imageAreaSize: lit('15L'), verticalAlignment: lit("'top'"), padding: lit('0L') },
            selector: def
          }
        ],
        referenceLabelLayout: [{ properties: { position: lit("'below'"), arrangement: lit("'rows'"), style: lit("'tabular'"), labelSpace: lit('0D') }, selector: def }],
        referenceLabel: [
          { properties: { value: { expr: S.m('Sales vs LY %') } }, selector: { data: [{ dataViewWildcard: { matchingOption: 0 } }], metadata: '_m.Total Sales', id: 'field-1', order: 0 } },
          { properties: { value: { expr: S.m('Orders') } }, selector: { data: [{ dataViewWildcard: { matchingOption: 0 } }], metadata: '_m.Total Sales', id: 'field-2', order: 1 } },
          { properties: { backgroundShow: lit('false'), paddingUniform: lit('0L') }, selector: def }
        ],
        referenceLabelTitle: [
          { properties: { titleText: lit("'vs last year:'"), titleContentType: lit("'custom'") }, selector: { metadata: '_m.Total Sales', id: 'field-1' } },
          { properties: { titleText: lit("'Orders:'"), titleContentType: lit("'custom'") }, selector: { metadata: '_m.Total Sales', id: 'field-2' } },
          { properties: { titleFontSize: lit('11D') }, selector: def }
        ],
        referenceLabelValue: [
          { properties: { valueFontColor: { solid: { color: { expr: S.m('Margin Color') } } } }, selector: { metadata: '_m.Total Sales', id: 'field-1' } },
          { properties: { valueFontSize: lit('11D'), valueDisplayUnits: lit('1D') }, selector: def }
        ]
      }
    )
  },
  {
    id: 'cardVisual-grid',
    title: 'Card (new) — grid of tiles with accent bar',
    width: 640,
    height: 220,
    visualJson: v(
      'cardVisual',
      {
        Data: {
          projections: [
            proj(S.m('Total Sales'), '_m.Total Sales'),
            proj(S.m('Total Cost'), '_m.Total Cost'),
            proj(S.m('Orders'), '_m.Orders'),
            proj(S.m('Units'), '_m.Units'),
            proj(S.m('Margin %'), '_m.Margin %'),
            proj(S.m('Sales vs LY %'), '_m.Sales vs LY %')
          ]
        }
      },
      {
        layout: [{ properties: { autoGrid: lit('false'), orientation: lit('0D'), columnCount: lit('3L'), rowCount: lit('2L'), cellPadding: lit('12L'), style: lit("'Cards'") } }],
        value: [{ properties: { fontSize: lit('20D'), horizontalAlignment: lit("'left'"), fontColor: color('#12239E') }, selector: def }],
        label: [{ properties: { fontSize: lit('10D'), fontColor: color('#605E5C'), position: lit("'aboveValue'") }, selector: def }],
        fillCustom: [{ properties: { show: lit('true'), fillColor: color('#F7F9FC') }, selector: def }],
        outline: [{ properties: { show: lit('true'), lineColor: color('#E1E5EE') }, selector: def }],
        shapeCustomRectangle: [{ properties: { rectangleRoundedCurve: lit('8L') }, selector: def }],
        accentBar: [{ properties: { show: lit('true') }, selector: def }],
        padding: [{ properties: { paddingSelection: lit("'Custom'"), paddingUniform: lit('10L') }, selector: def }]
      }
    )
  },
  {
    id: 'cardVisual-categories',
    title: 'Card — categories (multi-category layout) with callout images',
    width: 520,
    height: 300,
    visualJson: v(
      'cardVisual',
      { Data: { projections: ms('Units', 'Total Sales') }, Rows: { projections: [proj(S.col('Region'), 'Sales.Region')] } },
      {
        image: [
          { properties: { show: lit('true'), imageType: lit("'imageUrl'"), imageUrl: lit(`'${icon('#', '#0078D4')}'`), fixedSize: lit('true'), size: lit('32L'), position: lit("'Left'"), fit: lit("'Normal'") }, selector: { metadata: '_m.Units' } },
          { properties: { show: lit('true'), imageType: lit("'imageUrl'"), imageUrl: lit(`'${icon('$', '#107C10')}'`), fixedSize: lit('true'), size: lit('32L'), position: lit("'Left'"), fit: lit("'Normal'") }, selector: { metadata: '_m.Total Sales' } }
        ],
        label: [{ properties: { position: lit("'aboveValue'"), fontSize: lit('10D') }, selector: def }],
        value: [{ properties: { fontSize: lit('20D') }, selector: def }]
      }
    )
  },
  {
    id: 'cardVisual-paginate',
    title: 'Card — 6 callouts, 3×1 page, paginate overflow',
    width: 560,
    height: 140,
    visualJson: v(
      'cardVisual',
      { Data: { projections: ms('Total Sales', 'Total Cost', 'Orders', 'Units', 'Margin %', 'Sales vs LY %') } },
      {
        layout: [{ properties: { orientation: lit('2D'), autoGrid: lit('false'), columnCount: lit('3L'), rowCount: lit('1L') }, selector: def }],
        overFlow: [{ properties: { overFlowStyle: lit('1D') }, selector: def }],
        value: [{ properties: { fontSize: lit('22D') }, selector: def }]
      }
    )
  },
  {
    id: 'cardVisual-scroll-horizontal',
    title: 'Card — fixed-size cards, horizontal continuous scroll',
    width: 560,
    height: 130,
    visualJson: v(
      'cardVisual',
      { Data: { projections: ms('Total Sales', 'Total Cost', 'Orders', 'Units', 'Margin %') } },
      {
        layout: [{ properties: { showFixedSize: lit('true'), fixedWidth: lit('160L'), fixedHeight: lit('100L') }, selector: def }],
        overFlow: [{ properties: { overFlowStyle: lit('0D'), overFlowDirection: lit('1D') }, selector: def }],
        value: [{ properties: { fontSize: lit('20D') }, selector: def }],
        accentBar: [{ properties: { show: lit('true'), position: lit("'Top'"), width: lit('4L') }, selector: def }]
      }
    )
  },
  {
    id: 'cardVisual-refs-detail',
    title: 'Card — reference labels right, sentence style with detail chips',
    width: 620,
    height: 120,
    visualJson: v(
      'cardVisual',
      { Data: { projections: ms('Units', 'Total Sales') } },
      {
        referenceLabelLayout: [{ properties: { position: lit("'right'"), style: lit("'sentence'"), horizontalAlignment: lit("'center'") }, selector: def }],
        referenceLabel: [
          { properties: { value: { expr: S.m('Orders') } }, selector: { data: [{ dataViewWildcard: { matchingOption: 0 } }], metadata: '_m.Units', id: 'field-1', order: 0 } },
          { properties: { value: { expr: S.m('Total Cost') } }, selector: { data: [{ dataViewWildcard: { matchingOption: 0 } }], metadata: '_m.Total Sales', id: 'field-2', order: 0 } },
          { properties: { backgroundShow: lit('false') }, selector: def }
        ],
        referenceLabelDetail: [
          { properties: { show: lit('true'), detailValue: { expr: S.m('Margin %') } }, selector: { metadata: '_m.Units', id: 'field-1' } },
          { properties: { show: lit('true'), detailValue: { expr: S.m('Sales vs LY %') } }, selector: { metadata: '_m.Total Sales', id: 'field-2' } },
          { properties: { detailFontColor: { solid: { color: { expr: S.m('Margin Color') } } } }, selector: { metadata: '_m.Units', id: 'field-1' } }
        ],
        divider: [{ properties: { show: lit('true') }, selector: def }],
        layout: [{ properties: { calloutSize: lit('45D') }, selector: def }]
      }
    )
  },
  {
    id: 'cardVisual-card-image',
    title: 'Card — card image area (collage), hover state, individual corners',
    width: 620,
    height: 170,
    visualJson: v(
      'cardVisual',
      { Data: { projections: ms('Total Sales', 'Units') } },
      {
        layout: [{ properties: { contentOrder: lit("'callout_image_referenceLabel'"), calloutSize: lit('40D'), collage: lit("'Default'") }, selector: def }],
        referenceLabelLayout: [{ properties: { position: lit("'right'") }, selector: def }],
        referenceLabel: [
          { properties: { value: { expr: S.m('Margin %') } }, selector: { data: [{ dataViewWildcard: { matchingOption: 0 } }], metadata: '_m.Total Sales', id: 'field-1', order: 0 } }
        ],
        cardImage: [
          { properties: { show: lit('true'), imageType: lit("'imageUrl'"), imageUrl: lit(`'${TREND('#118DFF')}'`), imageUrlFit: lit("'Fit'") }, selector: def },
          { properties: { imageUrl: lit(`'${TREND('#E66C37', '#E66C37')}'`) }, selector: hover }
        ],
        shapeCustomRectangle: [
          { properties: { rectangleRoundedCurveCustomStyle: lit('true'), rectangleRoundedCurveLeftTop: lit('16L'), rectangleRoundedCurveRightBottom: lit('16L'), rectangleRoundedCurveRightTop: lit('2L'), rectangleRoundedCurveLeftBottom: lit('2L') }, selector: def },
          { properties: { rectangleRoundedCurve: lit('2L') }, selector: hover }
        ],
        fillCustom: [{ properties: { fillColor: color('#F2F8FF') }, selector: hover }],
        outline: [{ properties: { lineColor: color('#118DFF') }, selector: hover }],
        shadowCustom: [{ properties: { show: lit('true'), transparency: lit('85D'), shadowBlur: lit('8D'), shadowDistance: lit('3D'), shadowSpread: lit('0D') }, selector: def }],
        value: [{ properties: { fontSize: lit('22D') }, selector: def }]
      }
    )
  },
  {
    id: 'cardVisual-table-style',
    title: 'Card — table style (shared gridlines), label above',
    width: 560,
    height: 150,
    visualJson: v(
      'cardVisual',
      { Data: { projections: ms('Total Sales', 'Total Cost', 'Orders', 'Units', 'Margin %', 'Sales vs LY %') } },
      {
        layout: [{ properties: { style: lit("'Table'"), orientation: lit('2D'), columnCount: lit('3L') }, selector: def }],
        outline: [{ properties: { show: lit('false') }, selector: def }],
        shapeCustomRectangle: [{ properties: { tileShape: lit("'rectangle'") }, selector: def }],
        label: [{ properties: { position: lit("'aboveValue'"), fontSize: lit('10D') }, selector: def }],
        value: [{ properties: { fontSize: lit('18D') }, selector: def }]
      }
    )
  },
  {
    id: 'card-legacy',
    title: 'Card (legacy) — auto-scaled callout',
    width: 220,
    height: 120,
    visualJson: v('card', { Values: { projections: [proj(S.m('Total Sales'), '_m.Total Sales')] } })
  },
  {
    id: 'card-legacy-units',
    title: 'Card (legacy) — thousands, 1 decimal, colored',
    width: 220,
    height: 120,
    visualJson: v('card', { Values: { projections: [proj(S.m('Units'), '_m.Units')] } }, { labels: [{ properties: { labelDisplayUnits: lit('1000D'), labelPrecision: lit('1L'), color: color('#118DFF'), fontSize: lit('32D') } }] })
  },
  {
    id: 'card-legacy-wrap',
    title: 'Card (legacy) — word-wrapped category label, custom font',
    width: 200,
    height: 120,
    visualJson: v(
      'card',
      { Values: { projections: [proj(S.m('Total Sales'), '_m.Total Sales', { displayName: 'Total sales across every region and segment' })] } },
      { labels: [{ properties: { fontFamily: lit("'Segoe UI Semibold'"), fontSize: lit("'24'"), color: themeColor(1) } }], categoryLabels: [{ properties: { fontSize: lit("'10'"), italic: lit('true') } }] }
    )
  },
  {
    id: 'multiRowCard-bars',
    title: 'Multi-row card — measures only, 6px theme bar, frame outline',
    width: 300,
    height: 150,
    visualJson: v(
      'multiRowCard',
      { Values: { projections: ms('Total Sales', 'Orders', 'Margin %') } },
      { card: [{ properties: { barWeight: lit('6D'), barColor: themeColor(2), outlineStyle: lit('7L'), outlineColor: color('#E1DFDD'), outlineWeight: lit('1D'), cardPadding: lit('10D') } }], dataLabels: [{ properties: { fontSize: lit('16D') } }] }
    )
  },
  {
    id: 'multiRowCard',
    title: 'Multi-row card — per region',
    width: 360,
    height: 240,
    visualJson: v(
      'multiRowCard',
      { Values: { projections: [proj(S.col('Region'), 'Sales.Region'), proj(S.m('Total Sales'), '_m.Total Sales'), proj(S.m('Orders'), '_m.Orders'), proj(S.m('Margin %'), '_m.Margin %')] } },
      { dataLabels: [{ properties: { fontSize: lit('14D') } }], categoryLabels: [{ properties: { fontSize: lit('9D') } }] },
      { sortDefinition: { sort: [{ field: S.m('Total Sales'), direction: 'Descending' }] } }
    )
  }
]

registerNonChartEntries('Cards', galleryEntries)
