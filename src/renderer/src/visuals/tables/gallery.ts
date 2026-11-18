/** Dev-gallery entries for the table and matrix visuals (sample model: common/sampleData.ts). */
import { registerNonChartEntries } from '../gallery/entries-nonchart'
import type { NonChartGalleryEntry } from '../common/nonchartGallery'
import { proj, S } from '../common/sampleData'
import './kpiGallery'

const L = (v: string) => ({ expr: { Literal: { Value: v } } })
const color = (c: string) => ({ solid: { color: { expr: { Literal: { Value: `'${c}'` } } } } })
const theme = (id: number, pct = 0) => ({ solid: { color: { expr: { ThemeDataColor: { ColorId: id, Percent: pct } } } } })

function visual(name: string, visualType: string, queryState: Record<string, any[]>, objects: any = {}, extra: any = {}) {
  const qs: Record<string, any> = {}
  for (const [role, projections] of Object.entries(queryState)) qs[role] = { projections }
  return { name, position: { x: 0, y: 0, z: 0, width: 400, height: 300 }, visual: { visualType, query: { queryState: qs, ...(extra.sort ? { sortDefinition: { sort: extra.sort } } : {}) }, objects, ...(extra.visual ?? {}) } }
}

const spark = (measure: any, axis: any) => ({ SparklineData: { Measure: measure, Groupings: [axis] } })
const toggled = (role: string, refs: string[], paths: string[][]) => ({
  roles: [role],
  levels: refs.map((q) => ({ queryRefs: [q], isPinned: true })),
  root: { children: paths.map((p) => ({ identityValues: p.map((v) => ({ Literal: { Value: v } })), isToggled: true })) }
})

const gradient = (input: any, min: string, max: string, mid?: string) => ({
  solid: {
    color: {
      expr: {
        FillRule: {
          Input: input,
          FillRule: mid
            ? { linearGradient3: { min: { color: { Literal: { Value: `'${min}'` } } }, mid: { color: { Literal: { Value: `'${mid}'` } } }, max: { color: { Literal: { Value: `'${max}'` } } }, nullColoringStrategy: { strategy: { Literal: { Value: "'asZero'" } } } } }
            : { linearGradient2: { min: { color: { Literal: { Value: `'${min}'` } } }, max: { color: { Literal: { Value: `'${max}'` } } }, nullColoringStrategy: { strategy: { Literal: { Value: "'asZero'" } } } } }
        }
      }
    }
  }
})

const iconRule = (input: any) => ({
  kind: 'Icon',
  layout: { Literal: { Value: "'Before'" } },
  verticalAlignment: { Literal: { Value: "'Middle'" } },
  value: {
    Conditional: {
      Cases: [
        { Condition: { Comparison: { ComparisonKind: 2, Left: input, Right: { Literal: { Value: '0.05D' } } } }, Value: { Literal: { Value: "'ArrowUpGreen'" } } },
        { Condition: { Comparison: { ComparisonKind: 2, Left: input, Right: { Literal: { Value: '-0.05D' } } } }, Value: { Literal: { Value: "'ArrowRightYellow'" } } }
      ],
      DefaultValue: { Literal: { Value: "'ArrowDownRed'" } }
    }
  }
})

export const galleryEntries: NonChartGalleryEntry[] = [
  {
    id: 'table-basic',
    title: 'Table — default style with totals',
    width: 460,
    height: 300,
    visualJson: visual('table-basic', 'tableEx', {
      Values: [proj(S.col('Region'), 'Sales.Region'), proj(S.col('Country'), 'Sales.Country'), proj(S.m('Total Sales'), '_m.Total Sales'), proj(S.m('Orders'), '_m.Orders'), proj(S.m('Margin %'), '_m.Margin %')]
    })
  },
  {
    id: 'table-cf',
    title: 'Table — conditional formatting (gradient, rules icons, field color, data bars, URL)',
    width: 620,
    height: 300,
    visualJson: visual(
      'table-cf',
      'tableEx',
      {
        Values: [
          proj(S.col('Product'), 'Sales.Product'),
          proj(S.col('ProductUrl'), 'Sales.ProductUrl', { displayName: 'Link' }),
          proj(S.m('Total Sales'), '_m.Total Sales'),
          proj(S.m('Units'), '_m.Units'),
          proj(S.m('Margin %'), '_m.Margin %'),
          proj(S.m('Sales vs LY %'), '_m.Sales vs LY %')
        ]
      },
      {
        values: [
          { properties: { urlIcon: L('true') } },
          { properties: { backColor: gradient(S.m('Total Sales'), '#F8696B', '#63BE7B', '#FFEB84') }, selector: { metadata: '_m.Total Sales', data: [{ dataViewWildcard: { matchingOption: 1 } }] } },
          { properties: { fontColor: { solid: { color: { expr: S.m('Margin Color') } } } }, selector: { metadata: '_m.Margin %', data: [{ dataViewWildcard: { matchingOption: 1 } }] } },
          { properties: { icon: iconRule(S.m('Sales vs LY %')) }, selector: { metadata: '_m.Sales vs LY %' } }
        ],
        columnFormatting: [
          { properties: { dataBars: { positiveColor: color('#5B9BD5'), negativeColor: color('#D64554'), axisColor: color('#252423'), reverseDirection: L('false'), hideText: L('false') } }, selector: { metadata: '_m.Units' } }
        ]
      },
      { sort: [{ field: S.m('Total Sales'), direction: 'Descending' }] }
    )
  },
  {
    id: 'table-big',
    title: 'Table — 2,400 rows (virtualized), gridlines, styled header',
    width: 460,
    height: 300,
    visualJson: visual(
      'table-big',
      'tableEx',
      {
        Values: [proj(S.col('OrderId'), 'Sales.OrderId'), proj(S.col('Date'), 'Sales.Date'), proj(S.col('Product'), 'Sales.Product'), proj(S.sum('Amount'), 'Sum(Sales.Amount)')]
      },
      {
        columnHeaders: [{ properties: { backColor: theme(3), fontColor: theme(0), fontFamily: L("'''Segoe UI Semibold'', wf_segoe-ui_semibold, helvetica, arial, sans-serif'"), wordWrap: L('true') } }],
        grid: [{ properties: { gridHorizontal: L('true'), gridHorizontalColor: color('#E1DFDD'), rowPadding: L('4D') } }],
        values: [{ properties: { backColorSecondary: color('#FFFFFF') } }]
      }
    )
  },
  {
    id: 'matrix-stepped',
    title: 'Matrix — stepped, expanded rows, Year columns, subtotals',
    width: 620,
    height: 320,
    visualJson: visual(
      'matrix-stepped',
      'pivotTable',
      {
        Rows: [proj(S.col('Region'), 'Sales.Region', { active: true }), proj(S.col('Country'), 'Sales.Country', { active: true })],
        Columns: [proj(S.col('Year'), 'Sales.Year', { active: true })],
        Values: [proj(S.m('Total Sales'), '_m.Total Sales'), proj(S.m('Margin %'), '_m.Margin %')]
      },
      { general: [{ properties: { layout: L("'Compact'") } }] }
    )
  },
  {
    id: 'matrix-collapsed',
    title: 'Matrix — collapsed with +/- (one node expanded), bottom subtotals',
    width: 420,
    height: 320,
    visualJson: visual(
      'matrix-collapsed',
      'pivotTable',
      {
        Rows: [proj(S.col('Category'), 'Sales.Category', { active: true }), proj(S.col('Subcategory'), 'Sales.Subcategory', { active: false }), proj(S.col('Product'), 'Sales.Product', { active: false })],
        Values: [proj(S.m('Total Sales'), '_m.Total Sales'), proj(S.m('Units'), '_m.Units')]
      },
      { subTotals: [{ properties: { rowSubtotalsPosition: L("'Bottom'") } }], rowHeaders: [{ properties: { steppedLayoutIndentation: L('16D') } }] },
      {
        visual: {
          expansionStates: [
            {
              roles: ['Rows'],
              levels: [{ queryRefs: ['Sales.Category'], isPinned: true }, { queryRefs: ['Sales.Subcategory'], isPinned: true }],
              root: { children: [{ identityValues: [{ Literal: { Value: "'Bikes'" } }], isToggled: true }] }
            }
          ]
        }
      }
    )
  },
  {
    id: 'matrix-values-on-rows',
    title: 'Matrix — values on rows, quarter columns',
    width: 520,
    height: 300,
    visualJson: visual(
      'matrix-values-on-rows',
      'pivotTable',
      {
        Rows: [proj(S.col('Segment'), 'Sales.Segment', { active: true })],
        Columns: [proj(S.col('Quarter'), 'Sales.Quarter', { active: true })],
        Values: [proj(S.m('Total Sales'), '_m.Total Sales'), proj(S.m('Orders'), '_m.Orders')]
      },
      { values: [{ properties: { valuesOnRow: L('true') } }], subTotals: [{ properties: { columnSubtotals: L('false') } }] }
    )
  },
  {
    id: 'matrix-cf',
    title: 'Matrix — themed headers, gridlines, gradient on values (incl. totals)',
    width: 620,
    height: 300,
    visualJson: visual(
      'matrix-cf',
      'pivotTable',
      {
        Rows: [proj(S.col('Category'), 'Sales.Category', { active: true })],
        Columns: [proj(S.col('Region'), 'Sales.Region', { active: true })],
        Values: [proj(S.m('Margin %'), '_m.Margin %')]
      },
      {
        columnHeaders: [{ properties: { backColor: theme(2, -0.5), fontColor: theme(0), bold: L('true'), alignment: L("'Center'") } }],
        rowHeaders: [{ properties: { fontSize: L('10D') } }],
        values: [
          { properties: { fontColorPrimary: theme(1), fontColorSecondary: theme(1) } },
          { properties: { backColor: gradient(S.m('Margin %'), '#FFFFFF', '#118DFF') }, selector: { metadata: '_m.Margin %', data: [{ dataViewWildcard: { matchingOption: 0 } }] } }
        ],
        grid: [{ properties: { gridVertical: L('true'), gridHorizontal: L('true'), rowPadding: L('5D') } }]
      }
    )
  },
  {
    id: 'table-sparklines',
    title: 'Table — sparklines (line with high/low markers, column), grow to fit',
    width: 560,
    height: 220,
    visualJson: visual(
      'table-sparklines',
      'tableEx',
      {
        Values: [
          proj(S.col('Region'), 'Sales.Region'),
          proj(S.m('Total Sales'), '_m.Total Sales'),
          { field: spark(S.m('Total Sales'), S.col('Month')), queryRef: 'SparklineData(_m.Total Sales_[Sales.Month])' },
          { field: spark(S.m('Orders'), S.col('Quarter')), queryRef: 'SparklineData(_m.Orders_[Sales.Quarter])' }
        ]
      },
      {
        columnHeaders: [{ properties: { columnAdjustment: L("'growToFit'") } }],
        sparklines: [
          { properties: { markers: L('6L'), markerColor: color('#D64554'), strokeWidth: L('1.5D') }, selector: { metadata: 'SparklineData(_m.Total Sales_[Sales.Month])' } },
          { properties: { chartType: L("'column'"), dataColor: theme(2) }, selector: { metadata: 'SparklineData(_m.Orders_[Sales.Quarter])' } }
        ]
      }
    )
  },
  {
    id: 'table-images-urls',
    title: 'Table — image URLs, URL icons, wrapped headers, custom total label',
    width: 520,
    height: 300,
    visualJson: visual(
      'table-images-urls',
      'tableEx',
      {
        Values: [
          proj(S.col('ProductImage'), 'Sales.ProductImage', { displayName: 'Image' }),
          proj(S.col('Product'), 'Sales.Product'),
          proj(S.col('ProductUrl'), 'Sales.ProductUrl', { displayName: 'Product page' }),
          proj(S.m('Total Sales'), '_m.Total Sales', { displayName: 'Total sales amount this period' }),
          proj(S.m('Units'), '_m.Units')
        ]
      },
      {
        grid: [{ properties: { imageHeight: L('28D'), imageWidth: L('28D') } }],
        values: [{ properties: { urlIcon: L('true') } }],
        columnHeaders: [{ properties: { wordWrap: L('true') } }],
        total: [{ properties: { label: L("'Grand total'") } }]
      }
    )
  },
  {
    id: 'matrix-column-expand',
    title: 'Matrix — +/- on rows and columns (2024 expanded), colored icons, column-field corner',
    width: 640,
    height: 300,
    visualJson: visual(
      'matrix-column-expand',
      'pivotTable',
      {
        Rows: [proj(S.col('Region'), 'Sales.Region', { active: true }), proj(S.col('Country'), 'Sales.Country', { active: false })],
        Columns: [proj(S.col('Year'), 'Sales.Year', { active: true }), proj(S.col('Quarter'), 'Sales.Quarter', { active: false })],
        Values: [proj(S.m('Total Sales'), '_m.Total Sales')]
      },
      {
        columnHeaders: [{ properties: { expandCollapseButtonsColor: color('#E66C37'), expandCollapseButtonsSize: L('12D') } }],
        rowHeaders: [{ properties: { expandCollapseButtonsColor: color('#12239E'), expandCollapseButtonsSize: L('12D') } }]
      },
      { visual: { expansionStates: [toggled('Rows', ['Sales.Region', 'Sales.Country'], [["'Europe'"]]), toggled('Columns', ['Sales.Year', 'Sales.Quarter'], [['2024L']])] } }
    )
  },
  {
    id: 'matrix-sparklines',
    title: 'Matrix — sparkline per row and per column group',
    width: 560,
    height: 220,
    visualJson: visual(
      'matrix-sparklines',
      'pivotTable',
      {
        Rows: [proj(S.col('Category'), 'Sales.Category', { active: true })],
        Columns: [proj(S.col('Year'), 'Sales.Year', { active: true })],
        Values: [proj(S.m('Total Sales'), '_m.Total Sales'), { field: spark(S.m('Total Sales'), S.col('Month')), queryRef: 'SparklineData(_m.Total Sales_[Sales.Month])', displayName: 'Trend' }]
      },
      { sparklines: [{ properties: { markers: L('24L') } }] }
    )
  },
  {
    id: 'matrix-subtotal-labels',
    title: 'Matrix — auto expand, bottom subtotals with custom labels, styled totals, blank rows',
    width: 460,
    height: 380,
    visualJson: visual(
      'matrix-subtotal-labels',
      'pivotTable',
      {
        Rows: [proj(S.col('Category'), 'Sales.Category', { active: true }), proj(S.col('Subcategory'), 'Sales.Subcategory', { active: false })],
        Values: [proj(S.m('Total Sales'), '_m.Total Sales'), proj(S.m('Units'), '_m.Units')]
      },
      {
        rowHeaders: [{ properties: { autoExpand: L('true') } }],
        subTotals: [{ properties: { rowSubtotalsPosition: L("'Bottom'"), rowSubtotalsLabel: L("'Subtotal'"), backColor: color('#F3F2F1'), applyToHeaders: L('true') } }],
        rowTotal: [{ properties: { backColor: theme(0, 0.8), applyToHeaders: L('true') } }],
        blankRows: [{ properties: { showBlankRows: L('true'), showBorder: L('true'), borderPosition: L("'Bottom'"), borderColor: color('#C8C6C4') } }],
        columnFormatting: [{ properties: { fontColor: color('#1AAB40'), styleSubtotals: L('true'), styleTotal: L('false') }, selector: { metadata: '_m.Units' } }]
      }
    )
  },
  {
    id: 'matrix-wide-columns',
    title: 'Matrix — 672 date columns: 100 at a time (scroll right loads more), gradient over all cells',
    width: 620,
    height: 220,
    visualJson: visual(
      'matrix-wide-columns',
      'pivotTable',
      {
        Rows: [proj(S.col('Region'), 'Sales.Region', { active: true })],
        Columns: [proj(S.col('Date'), 'Sales.Date', { active: true })],
        Values: [proj(S.m('Total Sales'), '_m.Total Sales')]
      },
      { values: [{ properties: { backColor: gradient(S.m('Total Sales'), '#FFFFFF', '#118DFF') }, selector: { metadata: '_m.Total Sales' } }] }
    )
  },
  {
    id: 'matrix-tabular-unfrozen',
    title: 'Matrix — tabular layout, unfrozen row headers, values on rows',
    width: 460,
    height: 260,
    visualJson: visual(
      'matrix-tabular-unfrozen',
      'pivotTable',
      {
        Rows: [proj(S.col('Region'), 'Sales.Region', { active: true }), proj(S.col('Segment'), 'Sales.Segment', { active: true })],
        Columns: [proj(S.col('Year'), 'Sales.Year', { active: true })],
        Values: [proj(S.m('Total Sales'), '_m.Total Sales'), proj(S.m('Margin %'), '_m.Margin %')]
      },
      { general: [{ properties: { layout: L("'Tabular'") } }], rowHeaders: [{ properties: { unfrozen: L('true') } }], values: [{ properties: { valuesOnRow: L('true') } }] }
    )
  }
]

registerNonChartEntries('Tables', galleryEntries)
