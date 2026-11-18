/** Gallery fixtures for the chart visuals (neutral sample model: Sales, Pipeline). */
import { col, level, msr, props, registerGalleryEntries, scope, sum, visualJson, type GalleryEntry } from '../gallery/registry'
import { inFilter } from '@core/report/sq'
import { mapGalleryEntries } from './map/galleryEntries'
import { miscGalleryEntries } from './misc/galleryEntries'
import { otherGalleryEntries } from './otherGalleryEntries'

const S = 'Sales'
const sales = msr(S, 'Total Sales')
const profit = msr(S, 'Profit')
const margin = msr(S, 'Margin %')
const units = msr(S, 'Units Sold')
const target = msr(S, 'Sales Target')
const region = col(S, 'Region')
const category = col(S, 'Category')
const product = col(S, 'Product')
const channel = col(S, 'Channel')
const month = col(S, 'Month')
const year = col(S, 'Year')
const date = col(S, 'Date')
const country = col(S, 'Country')

const title = (t: string) => t

/** objects.forecast entry in PBI's shape (properties + transform { algorithm: 'Forecast', parameters }) */
function forecastObj(o: { length: number; confidence: number; ignoreLast?: number; seasonality?: number; unit?: number }, fmt: Record<string, any> = {}) {
  const lit = (v: number) => ({ Literal: { Value: `${v}D` } })
  const p = props({ show: true, displayName: 'Forecast', ...fmt }).properties
  return {
    properties: {
      ...p,
      transform: {
        algorithm: 'Forecast',
        parameters: [
          { ...lit(o.unit ?? 7), Name: 'Unit' },
          { ...lit(o.length), Name: 'ForecastLength' },
          { ...lit(o.ignoreLast ?? 0), Name: 'IgnoreLast' },
          { ...lit(o.confidence), Name: 'ConfidenceLevel' },
          { ...lit(o.seasonality ?? 0), Name: 'MaxSeasonality' }
        ]
      }
    },
    selector: { metadata: 'Sales.Total Sales', id: '1' }
  }
}
/** PBI's saved default sort: first measure descending (sortDefinition.isDefaultSort) */
const desc = (f: any) => [{ field: f, direction: 'Descending' as const }]

const entries: GalleryEntry[] = [
  // ------------------------------------------------------------------ columns
  {
    id: 'clusteredColumn',
    section: 'Column charts',
    title: title('Total Sales by Category'),
    json: visualJson('g_clusteredColumn', 'clusteredColumnChart', { Category: [category], Y: [sales] }, { sort: desc(sales) })
  },
  {
    id: 'clusteredColumnMulti',
    section: 'Column charts',
    title: title('Total Sales and Sales Target by Region'),
    json: visualJson('g_clusteredColumnMulti', 'clusteredColumnChart', { Category: [region], Y: [sales, target] }, { objects: { labels: [props({ show: true })] }, sort: desc(sales) })
  },
  {
    id: 'stackedColumn',
    section: 'Column charts',
    title: title('Total Sales by Year and Channel'),
    json: visualJson('g_stackedColumn', 'columnChart', { Category: [year], Y: [sales], Series: [channel] }, { objects: { labels: [props({ show: true })], totals: [props({ show: true })] }, sort: [{ field: year, direction: 'Ascending' }] })
  },
  {
    id: 'pctColumn',
    section: 'Column charts',
    title: title('Total Sales by Region and Category'),
    json: visualJson('g_pctColumn', 'hundredPercentStackedColumnChart', { Category: [region], Y: [sales], Series: [category] }, { objects: { labels: [props({ show: true })] }, sort: desc(sales) })
  },
  {
    id: 'columnMonths',
    section: 'Column charts',
    title: title('Units Sold by Product'),
    json: visualJson('g_columnMonths', 'clusteredColumnChart', { Category: [product], Y: [units] }, { objects: { dataPoint: [props({ fill: '#12239E' })], valueAxis: [props({ gridlineStyle: 'solid', gridlineColor: '#EDEBE9' })] }, sort: desc(units) })
  },
  {
    id: 'columnHighlight',
    section: 'Column charts',
    title: title('Cross-highlight (Channel = Online)'),
    json: visualJson('g_columnHighlight', 'clusteredColumnChart', { Category: [region], Y: [sales] }, { sort: desc(sales) }),
    highlightFilters: [inFilter(S, 'Channel', ['Online'])]
  },
  {
    id: 'columnDrill',
    section: 'Column charts',
    title: title('Total Sales by Year, Quarter, Month (hierarchy)'),
    json: visualJson('g_columnDrill', 'clusteredColumnChart', { Category: [level(S, 'Date Hierarchy', 'Year'), level(S, 'Date Hierarchy', 'Quarter'), level(S, 'Date Hierarchy', 'Month')], Y: [sales] }, {
      sort: [{ field: level(S, 'Date Hierarchy', 'Year'), direction: 'Ascending' }]
    }),
    drill: { level: 0, expandedLevel: 1 }
  },
  {
    id: 'smallMultiples',
    section: 'Column charts',
    title: title('Total Sales by Year and Channel, by Region'),
    json: visualJson('g_smallMultiples', 'columnChart', { Category: [year], Y: [sales], Series: [channel], Rows: [region] }, { sort: [{ field: year, direction: 'Ascending' }] }),
    width: 520,
    height: 340
  },
  // ------------------------------------------------------------------ bars
  {
    id: 'stackedBar',
    section: 'Bar charts',
    title: title('Total Sales by Country'),
    json: visualJson('g_stackedBar', 'barChart', { Category: [country], Y: [sales] }, { objects: { labels: [props({ show: true })] }, sort: desc(sales) })
  },
  {
    id: 'clusteredBar',
    section: 'Bar charts',
    title: title('Profit and Total Sales by Category'),
    json: visualJson('g_clusteredBar', 'clusteredBarChart', { Category: [category], Y: [sales, profit] }, { objects: { legend: [props({ position: 'TopCenter' })] }, sort: desc(sales) })
  },
  {
    id: 'stackedBarSeries',
    section: 'Bar charts',
    title: title('Total Sales by Region and Channel'),
    json: visualJson('g_stackedBarSeries', 'barChart', { Category: [region], Y: [sales], Series: [channel] }, { objects: { labels: [props({ show: true })], totals: [props({ show: true })] }, sort: desc(sales) }),
    selection: [{ fields: [{ expr: region, value: 'Europe' }] }]
  },
  {
    id: 'pctBar',
    section: 'Bar charts',
    title: title('Total Sales by Category and Segment'),
    json: visualJson('g_pctBar', 'hundredPercentStackedBarChart', { Category: [category], Y: [sales], Series: [col(S, 'Segment')] }, { sort: desc(sales) })
  },
  // ------------------------------------------------------------------ lines / areas
  {
    id: 'lineDate',
    section: 'Line & area charts',
    title: title('Total Sales by Date (continuous)'),
    json: visualJson('g_lineDate', 'lineChart', { Category: [date], Y: [sales] }),
    width: 520
  },
  {
    id: 'lineSeries',
    section: 'Line & area charts',
    title: title('Total Sales by Month and Region'),
    json: visualJson('g_lineSeries', 'lineChart', { Category: [month], Y: [sales], Series: [region] }, {
      sort: [{ field: month, direction: 'Ascending' }],
      objects: { lineStyles: [props({ showMarker: true }), props({ lineStyle: 'dashed', strokeWidth: 2 }, scope(S, 'Region', 'Pacific'))] }
    }),
    width: 520
  },
  {
    id: 'lineY2',
    section: 'Line & area charts',
    title: title('Total Sales and Margin % by Month'),
    json: visualJson('g_lineY2', 'lineChart', { Category: [month], Y: [sales], Y2: [margin] }, {
      sort: [{ field: month, direction: 'Ascending' }],
      objects: { labels: [props({ show: true })], averageLine: [props({ show: true, dataLabelShow: true, displayName: 'Average' }, { id: '1' })] }
    }),
    width: 520
  },
  {
    id: 'area',
    section: 'Line & area charts',
    title: title('Total Sales and Sales Target by Month'),
    json: visualJson('g_area', 'areaChart', { Category: [month], Y: [sales, target] }, { sort: [{ field: month, direction: 'Ascending' }] })
  },
  {
    id: 'stackedArea',
    section: 'Line & area charts',
    title: title('Total Sales by Month and Category'),
    json: visualJson('g_stackedArea', 'stackedAreaChart', { Category: [month], Y: [sales], Series: [category] }, { sort: [{ field: month, direction: 'Ascending' }] })
  },
  {
    id: 'pctArea',
    section: 'Line & area charts',
    title: title('Total Sales by Month and Channel'),
    json: visualJson('g_pctArea', 'hundredPercentStackedAreaChart', { Category: [month], Y: [sales], Series: [channel] }, { sort: [{ field: month, direction: 'Ascending' }] })
  },
  // ------------------------------------------------------------------ combos / ribbon
  {
    id: 'comboClustered',
    section: 'Combo & ribbon charts',
    title: title('Total Sales, Sales Target and Margin % by Month'),
    json: visualJson('g_comboClustered', 'lineClusteredColumnComboChart', { Category: [month], Y: [sales, target], Y2: [margin] }, { sort: [{ field: month, direction: 'Ascending' }] }),
    width: 520
  },
  {
    id: 'comboStacked',
    section: 'Combo & ribbon charts',
    title: title('Total Sales by Year and Channel, Units Sold'),
    json: visualJson('g_comboStacked', 'lineStackedColumnComboChart', { Category: [category], Y: [sales], Series: [channel], Y2: [units] }, { objects: { lineStyles: [props({ showMarker: true })] }, sort: desc(sales) })
  },
  {
    id: 'ribbon',
    section: 'Combo & ribbon charts',
    title: title('Total Sales by Quarter and Category'),
    json: visualJson('g_ribbon', 'ribbonChart', { Category: [col(S, 'Quarter')], Series: [category], Y: [sales] }, { sort: [{ field: col(S, 'Quarter'), direction: 'Ascending' }], objects: { labels: [props({ show: true })] } }),
    width: 520
  }
]

// ------------------------------------------------------------------ axes, analytics & line features
const fieldProp = (e: any) => ({ expr: e })
const cartesianFeatures: GalleryEntry[] = [
  {
    id: 'hierAxis',
    section: 'Axes & analytics',
    title: title('Hierarchical axis (concatenate labels off)'),
    json: visualJson('g_hierAxis', 'clusteredColumnChart', { Category: [level(S, 'Date Hierarchy', 'Year'), level(S, 'Date Hierarchy', 'Quarter')], Y: [sales] }, { sort: [{ field: level(S, 'Date Hierarchy', 'Year'), direction: 'Ascending' }] }),
    drill: { level: 0, expandedLevel: 1 },
    width: 520
  },
  {
    id: 'hierAxisBar',
    section: 'Axes & analytics',
    title: title('Bar chart: Region › Channel, inverted range, axis on top'),
    json: visualJson('g_hierAxisBar', 'clusteredBarChart', { Category: [region, channel], Y: [sales] }, { objects: { categoryAxis: [props({ invertAxis: true })], valueAxis: [props({ switchAxisPosition: true })] } }),
    drill: { level: 0, expandedLevel: 1 },
    height: 360
  },
  {
    id: 'zoomSlider',
    section: 'Axes & analytics',
    title: title('Zoom sliders (X and Y)'),
    json: visualJson('g_zoomSlider', 'clusteredColumnChart', { Category: [product], Y: [sales] }, { sort: desc(sales), objects: { zoom: [props({ show: true, showOnValueAxis: true })] } })
  },
  {
    id: 'zoomSliderSaved',
    section: 'Axes & analytics',
    title: title('Zoom slider reopened at its saved window (zoom.categoryMin/Max)'),
    json: visualJson('g_zoomSaved', 'lineChart', { Category: [col(S, 'Month Start')], Y: [sales] }, {
      objects: { zoom: [props({ show: true, showOnValueAxis: true, categoryMin: Date.UTC(2023, 9, 1), categoryMax: Date.UTC(2024, 5, 1), valueMin: 350000, valueMax: 550000 })] }
    }),
    width: 520
  },
  {
    id: 'secondaryAligned',
    section: 'Axes & analytics',
    title: title('Secondary axis aligned to gridlines, units in titles'),
    json: visualJson('g_secondaryAligned', 'lineClusteredColumnComboChart', { Category: [month], Y: [profit], Y2: [margin] }, { sort: [{ field: month, direction: 'Ascending' }], objects: { valueAxis: [props({ axisStyle: 'showBoth', labelDisplayUnits: 1000 })] } }),
    width: 520
  },
  {
    id: 'refLines',
    section: 'Axes & analytics',
    title: title('Constant line with shading, percentile, average, trend'),
    json: visualJson('g_refLines', 'clusteredColumnChart', { Category: [month], Y: [sales] }, {
      sort: [{ field: month, direction: 'Ascending' }],
      objects: {
        y1AxisReferenceLine: [props({ show: true, value: 500000, displayName: 'Goal', lineColor: '#D64554', style: 'solid', dataLabelShow: true, dataLabelText: 'ValueAndName', shadeShow: true, shadeRegion: 'after', shadeTransparency: 85 }, { id: '1' })],
        percentileLine: [props({ show: true, percentile: 90, dataLabelShow: true, dataLabelHorizontalPosition: 'left', lineColor: '#E66C37' }, { id: '1' })],
        averageLine: [props({ show: true, dataLabelShow: true, dataLabelText: 'Name' }, { id: '1' })],
        trend: [props({ show: true, lineColor: '#12239E' }, { id: '1' })]
      }
    }),
    width: 520
  },
  {
    id: 'lineFeatures',
    section: 'Axes & analytics',
    title: title('Series labels, step / dashed / smooth lines, shaded area'),
    json: visualJson('g_lineFeatures', 'lineChart', { Category: [month], Y: [sales], Series: [region] }, {
      sort: [{ field: month, direction: 'Ascending' }],
      objects: {
        seriesLabels: [props({ show: true })],
        lineStyles: [
          props({ lineChartType: 'step', interpolationStep: 'center' }, scope(S, 'Region', 'Europe')),
          props({ lineStyle: 'dashed' }, scope(S, 'Region', 'Pacific')),
          props({ lineChartType: 'smooth', areaShow: true }, scope(S, 'Region', 'North America')),
          props({ showMarker: true, markerShape: 'diamond' }, scope(S, 'Region', 'Latin America'))
        ]
      }
    }),
    width: 560
  },
  {
    id: 'errorBars',
    section: 'Axes & analytics',
    title: title('Error bars (upper: Sales Target, lower: Total Cost)'),
    json: visualJson('g_errorBars', 'clusteredColumnChart', { Category: [region], Y: [sales] }, {
      sort: desc(sales),
      objects: { error: [{ properties: { enabled: { expr: { Literal: { Value: 'true' } } }, errorRange: { kind: 'ErrorRange', explicit: { isRelative: { expr: { Literal: { Value: 'false' } } }, upperBound: fieldProp(target), lowerBound: fieldProp(msr(S, 'Total Cost')) } } }, selector: { metadata: 'Sales.Total Sales' } }] }
    })
  },
  {
    id: 'errorBand',
    section: 'Axes & analytics',
    title: title('Error band on a line'),
    json: visualJson('g_errorBand', 'lineChart', { Category: [month], Y: [sales] }, {
      sort: [{ field: month, direction: 'Ascending' }],
      objects: { error: [{ properties: { enabled: { expr: { Literal: { Value: 'true' } } }, shadeShow: { expr: { Literal: { Value: 'true' } } }, barShow: { expr: { Literal: { Value: 'false' } } }, markerShow: { expr: { Literal: { Value: 'false' } } }, errorRange: { kind: 'ErrorRange', explicit: { upperBound: fieldProp(target), lowerBound: fieldProp(msr(S, 'Total Cost')) } } }, selector: { metadata: 'Sales.Total Sales' } }] }
    })
  },
  {
    id: 'anomalies',
    section: 'Axes & analytics',
    title: title('Find anomalies (approximate detection)'),
    json: visualJson('g_anomalies', 'lineChart', { Category: [date], Y: [sales] }, { objects: { anomalyDetection: [props({ show: true })] } }),
    width: 560
  },
  {
    id: 'forecast',
    section: 'Axes & analytics',
    title: title('Forecast: 12 months, 95% (seasonality detected)'),
    json: visualJson('g_forecast', 'lineChart', { Category: [col(S, 'Month Start')], Y: [sales] }, {
      objects: { forecast: [forecastObj({ length: 12, confidence: 0.95 })] }
    }),
    width: 560
  },
  {
    id: 'forecastIgnoreLast',
    section: 'Axes & analytics',
    title: title('Forecast: ignore last 4, 80%, dashed with bound lines'),
    json: visualJson('g_forecastIgnore', 'lineChart', { Category: [col(S, 'Month Start')], Y: [sales] }, {
      objects: {
        forecast: [
          forecastObj({ length: 6, confidence: 0.8, ignoreLast: 4, seasonality: 12 }, { style: 'dashed', lineColor: '#E66C37', bandAreaTransparency: 85, bandLineShow: true, bandLinePattern: 'dotted' })
        ]
      }
    }),
    width: 560
  },
  {
    id: 'dataLabelFx',
    section: 'Axes & analytics',
    title: title('Data label color (fx rules: red below $300K)'),
    json: visualJson('g_dataLabelFx', 'clusteredColumnChart', { Category: [region], Y: [sales] }, {
      sort: desc(sales),
      objects: {
        labels: [
          { properties: { show: { expr: { Literal: { Value: 'true' } } } } },
          {
            properties: {
              color: {
                solid: {
                  color: {
                    expr: {
                      Conditional: {
                        Cases: [{ Condition: { Comparison: { ComparisonKind: 3, Left: sales, Right: { Literal: { Value: '300000D' } } } }, Value: { Literal: { Value: "'#D64554'" } } }],
                        DefaultValue: { Literal: { Value: "'#1AAB40'" } }
                      }
                    }
                  }
                }
              }
            },
            selector: { data: [{ dataViewWildcard: { matchingOption: 1 } }] }
          }
        ]
      }
    })
  },
  {
    id: 'smLine',
    section: 'Small multiples & pies',
    title: title('Line small multiples, independent y-axes, all gridlines'),
    json: visualJson('g_smLine', 'lineChart', { Category: [month], Y: [sales], Rows: [category] }, { sort: [{ field: month, direction: 'Ascending' }], objects: { valueAxis: [props({ sharedAxis: false })], smallMultiplesLayout: [props({ gridLineType: 'all', layoutType: 'custom', rowCount: 2, columnCount: 2 })] } }),
    width: 560,
    height: 360
  },
  {
    id: 'smBar',
    section: 'Small multiples & pies',
    title: title('Bar small multiples (shared axis)'),
    json: visualJson('g_smBar', 'clusteredBarChart', { Category: [channel], Y: [sales], Rows: [region] }, { sort: desc(sales) }),
    width: 560,
    height: 340
  },
  {
    id: 'smPie',
    section: 'Small multiples & pies',
    title: title('Donut small multiples by region'),
    json: visualJson('g_smPie', 'donutChart', { Category: [channel], Y: [sales], Rows: [region] }, { sort: desc(sales), objects: { labels: [props({ labelStyle: 'Percent of total' })] } }),
    width: 560,
    height: 340
  },
  {
    id: 'pieDetails',
    section: 'Small multiples & pies',
    title: title('Pie: Legend = Region, Details = Channel'),
    json: visualJson('g_pieDetails', 'pieChart', { Category: [region], Series: [channel], Y: [sales] }, { sort: desc(sales), objects: { labels: [props({ labelStyle: 'Category, data value, percent of total' })] } }),
    width: 480
  },
  {
    id: 'donutInside',
    section: 'Small multiples & pies',
    title: title('Donut: inside labels, rotated 90°, inner radius 65%'),
    json: visualJson('g_donutInside', 'donutChart', { Category: [category], Y: [sales] }, { sort: desc(sales), objects: { labels: [props({ position: 'inside', labelStyle: 'Percent of total' })], slices: [props({ startAngle: 90, innerRadiusRatio: 65 })] } })
  },
  {
    id: 'pieNarrow',
    section: 'Small multiples & pies',
    title: title('Narrow pie: labels wrap before truncating'),
    json: visualJson('g_pieNarrow', 'pieChart', { Category: [channel], Y: [sales] }, { objects: { legend: [props({ position: 'Right', showTitle: false })] } }),
    width: 300,
    height: 170
  }
]

const P = 'Pipeline'
const others: GalleryEntry[] = [
  // ------------------------------------------------------------------ pie / donut / funnel / treemap
  {
    id: 'pie',
    section: 'Pie, donut, funnel & treemap',
    title: title('Total Sales by Category'),
    json: visualJson('g_pie', 'pieChart', { Category: [category], Y: [sales] }, { sort: desc(sales) })
  },
  {
    id: 'donut',
    section: 'Pie, donut, funnel & treemap',
    title: title('Total Sales by Channel'),
    json: visualJson('g_donut', 'donutChart', { Category: [channel], Y: [sales] }),
    selection: [{ fields: [{ expr: channel, value: 'Retail' }] }]
  },
  {
    id: 'donutHighlight',
    section: 'Pie, donut, funnel & treemap',
    title: title('Total Sales by Region (highlighted: Bikes)'),
    json: visualJson('g_donutHighlight', 'donutChart', { Category: [region], Y: [sales] }, { objects: { legend: [props({ position: 'Bottom' })], labels: [props({ labelStyle: 'Category, percent of total' })] } }),
    highlightFilters: [inFilter(S, 'Category', ['Bikes'])]
  },
  {
    id: 'funnel',
    section: 'Pie, donut, funnel & treemap',
    title: title('Opportunities by Stage'),
    json: visualJson('g_funnel', 'funnel', { Category: [col(P, 'Stage')], Y: [msr(P, 'Opportunities')] }, { sort: [{ field: col(P, 'Stage'), direction: 'Ascending' }] })
  },
  {
    id: 'treemap',
    section: 'Pie, donut, funnel & treemap',
    title: title('Total Sales by Product'),
    json: visualJson('g_treemap', 'treemap', { Group: [product], Values: [sales] }, { objects: { labels: [props({ show: true })] } })
  },
  {
    id: 'treemapDetails',
    section: 'Pie, donut, funnel & treemap',
    title: title('Total Sales by Region and Category'),
    json: visualJson('g_treemapDetails', 'treemap', { Group: [region], Details: [category], Values: [sales] })
  },
  // ------------------------------------------------------------------ waterfall / scatter
  {
    id: 'waterfall',
    section: 'Waterfall & scatter',
    title: title('Profit by Quarter'),
    json: visualJson('g_waterfall', 'waterfallChart', { Category: [col(S, 'Quarter')], Y: [msr(S, 'Profit')] }, { objects: { labels: [props({ show: true })] } })
  },
  {
    id: 'waterfallBreakdown',
    section: 'Waterfall & scatter',
    title: title('Total Sales by Year and Region'),
    json: visualJson('g_waterfallBreakdown', 'waterfallChart', { Category: [year], Breakdown: [region], Y: [sales] }, { sort: [{ field: year, direction: 'Ascending' }] }),
    width: 520
  },
  {
    id: 'scatter',
    section: 'Waterfall & scatter',
    title: title('Total Sales and Margin % by Product'),
    json: visualJson('g_scatter', 'scatterChart', { Category: [product], Series: [category], X: [sales], Y: [margin] }, { objects: { categoryLabels: [props({ show: false })] } })
  },
  {
    id: 'bubble',
    section: 'Waterfall & scatter',
    title: title('Units, Avg Price and Sales by Product (play: Year)'),
    json: visualJson('g_bubble', 'scatterChart', { Category: [product], Series: [category], X: [units], Y: [msr(S, 'Avg Price')], Size: [sales], Play: [year] }, { objects: { valueAxis: [props({ axisScale: 'log' })] } }),
    width: 520
  },
  // ------------------------------------------------------------------ gauge / kpi
  {
    id: 'gauge',
    section: 'Gauge & KPI',
    title: title('Total Sales vs Target'),
    json: visualJson('g_gauge', 'gauge', { Y: [sales], TargetValue: [target] }),
    width: 300,
    height: 220
  },
  {
    id: 'gaugeMax',
    section: 'Gauge & KPI',
    title: title('Margin %'),
    json: visualJson('g_gaugeMax', 'gauge', { Y: [margin] }, { objects: { axis: [props({ min: 0, max: 1, target: 0.45 })] } }),
    width: 300,
    height: 220
  },
  {
    id: 'kpi',
    section: 'Gauge & KPI',
    title: title('Total Sales'),
    json: visualJson('g_kpi', 'kpi', { Indicator: [sales], TrendLine: [month], Goal: [target] }),
    width: 300,
    height: 220
  },
  {
    id: 'kpiBad',
    section: 'Gauge & KPI',
    title: title('Profit (goal: target)'),
    json: visualJson('g_kpiBad', 'kpi', { Indicator: [profit], TrendLine: [month], Goal: [target] }),
    width: 300,
    height: 220
  }
]

void sum
registerGalleryEntries(entries)
registerGalleryEntries(cartesianFeatures)
registerGalleryEntries(others)
registerGalleryEntries(mapGalleryEntries)
registerGalleryEntries(miscGalleryEntries)
registerGalleryEntries(otherGalleryEntries)
