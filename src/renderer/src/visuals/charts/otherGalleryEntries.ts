/**
 * Gallery fixtures for scatter / waterfall / funnel / treemap / gauge / KPI features
 * (registered by ./gallery.ts). Uses the neutral sample model (Sales, Pipeline).
 */
import { inFilter } from '@core/report/sq'
import { col, msr, props, visualJson, type GalleryEntry } from '../gallery/registry'

const S = 'Sales'
const P = 'Pipeline'
const sales = msr(S, 'Total Sales')
const cost = msr(S, 'Total Cost')
const profit = msr(S, 'Profit')
const margin = msr(S, 'Margin %')
const units = msr(S, 'Units Sold')
const target = msr(S, 'Sales Target')
const avgPrice = msr(S, 'Avg Price')
const region = col(S, 'Region')
const country = col(S, 'Country')
const category = col(S, 'Category')
const product = col(S, 'Product')
const channel = col(S, 'Channel')
const month = col(S, 'Month')
const quarter = col(S, 'Quarter')
const stage = col(P, 'Stage')
const opps = msr(P, 'Opportunities')

const lit = (v: string) => ({ Literal: { Value: v } })
const line = (values: Record<string, string | number | boolean>, id: string, metadata?: string) => ({ ...props(values), selector: metadata ? { id, metadata } : { id } })
const gradient = (input: any, min = '#DEEFFF', max = '#118DFF') => ({
  properties: { fill: { solid: { color: { expr: { FillRule: { Input: input, FillRule: { linearGradient2: { min: { color: lit(`'${min}'`) }, max: { color: lit(`'${max}'`) }, nullColoringStrategy: { strategy: lit("'asZero'") } } } } } } } } },
  selector: { data: [{ dataViewWildcard: { matchingOption: 1 } }] }
})
const rules = (input: any, below: number, lowColor: string, elseColor: string) => ({
  properties: {
    fill: {
      solid: {
        color: {
          expr: {
            Conditional: {
              Cases: [{ Condition: { Comparison: { ComparisonKind: 3, Left: input, Right: lit(`${below}D`) } }, Value: lit(`'${lowColor}'`) }],
              DefaultValue: lit(`'${elseColor}'`)
            }
          }
        }
      }
    }
  }
})

const SC = 'Scatter (features)'
const WF = 'Waterfall (features)'
const FU = 'Funnel (features)'
const TM = 'Treemap (features)'
const GK = 'Gauge & KPI (features)'

export const otherGalleryEntries: GalleryEntry[] = [
  // ------------------------------------------------------------------ scatter
  {
    id: 'scatterAnalytics',
    section: SC,
    title: 'Sales vs Margin % by Product: averages, constant lines, trend',
    json: visualJson(
      'g_scatterAnalytics',
      'scatterChart',
      { Category: [product], Series: [category], X: [sales], Y: [margin] },
      {
        objects: {
          averageLine: [line({ show: true, lineColor: '#E66C37', dataLabelShow: true, displayName: 'Avg sales', dataLabelText: 'ValueAndName', dataLabelVerticalPosition: 'under' }, '1', 'Sales.Total Sales'), line({ show: true, lineColor: '#E66C37', dataLabelShow: true }, '2', 'Sales.Margin %')],
          y1AxisReferenceLine: [line({ show: true, value: 0.5, lineColor: '#1AAB40', style: 'solid', shadeShow: true, shadeRegion: 'after', shadeTransparency: 85, dataLabelShow: true, dataLabelHorizontalPosition: 'right' }, '1')],
          trend: [line({ show: true, combineSeries: true, lineColor: '#605E5C' }, '1')]
        }
      }
    ),
    width: 520,
    height: 320
  },
  {
    id: 'scatterRatioSymmetry',
    section: SC,
    title: 'Cost vs Sales by Product: ratio line + symmetry shading',
    json: visualJson(
      'g_scatterRatio',
      'scatterChart',
      { Category: [product], X: [cost], Y: [sales] },
      {
        objects: {
          ratioLine: [props({ show: true, lineColor: '#12239E', style: 'solid', width: 2 })],
          plotAreaShading: [props({ show: true, transparency: 80 })],
          categoryLabels: [props({ show: true })]
        }
      }
    ),
    width: 460,
    height: 320
  },
  {
    id: 'scatterStats',
    section: SC,
    title: 'Min / max / median / 75th percentile lines (X and Y)',
    json: visualJson(
      'g_scatterStats',
      'scatterChart',
      { Category: [country], X: [units], Y: [profit] },
      {
        objects: {
          minLine: [line({ show: true, lineColor: '#D64554', dataLabelShow: true, displayName: 'Min' }, '1', 'Sales.Units Sold')],
          maxLine: [line({ show: true, lineColor: '#1AAB40', dataLabelShow: true, dataLabelHorizontalPosition: 'right' }, '1', 'Sales.Units Sold')],
          medianLine: [line({ show: true, lineColor: '#744EC2', style: 'dotted', dataLabelShow: true }, '1', 'Sales.Profit')],
          percentileLine: [line({ show: true, percentile: 75, lineColor: '#12239E', dataLabelShow: true, dataLabelText: 'ValueAndName', displayName: 'P75' }, '1', 'Sales.Profit')],
          xAxisReferenceLine: [line({ show: true, value: 9000, lineColor: '#E044A7', shadeShow: true, shadeRegion: 'before', shadeTransparency: 90 }, '1')]
        }
      }
    ),
    width: 520,
    height: 320
  },
  {
    id: 'scatterShapes',
    section: SC,
    title: 'Diamond markers, color border, labels with background, log Y',
    json: visualJson(
      'g_scatterShapes',
      'scatterChart',
      { Category: [product], Series: [category], X: [units], Y: [avgPrice] },
      {
        objects: {
          bubbles: [props({ markerShape: 'diamond', bubbleSize: 20 })],
          colorBorder: [props({ show: true })],
          valueAxis: [props({ logAxisScale: true, axisStyle: 'showBoth' })],
          categoryAxis: [props({ axisStyle: 'showBoth', labelDisplayUnits: 1000 })],
          categoryLabels: [props({ show: true, enableBackground: true, backgroundTransparency: 20, fontSize: 8 })],
          legend: [props({ position: 'Right' })]
        }
      }
    ),
    width: 520,
    height: 320
  },
  {
    id: 'scatterPlay',
    section: SC,
    title: 'Bubbles with play axis (Month); trail for selected Bikes',
    json: visualJson('g_scatterPlay', 'scatterChart', { Category: [category], X: [units], Y: [margin], Size: [sales], Play: [month] }, { sort: [{ field: month, direction: 'Ascending' }] }),
    selection: [{ fields: [{ expr: category, value: 'Bikes' }] }],
    width: 520,
    height: 340
  },
  {
    id: 'scatterConditional',
    section: SC,
    title: 'Conditional color (gradient on Profit), magnitude bubbles, border-only',
    json: visualJson(
      'g_scatterCF',
      'scatterChart',
      { Category: [country], X: [sales], Y: [margin], Size: [units] },
      { objects: { dataPoint: [gradient(profit, '#FFE0CC', '#C94F0F')], bubbles: [props({ markerRangeType: 'dataRange' })], fillPoint: [props({ style: 'Border only' })] } }
    ),
    width: 460,
    height: 320
  },
  {
    id: 'scatterDrill',
    section: SC,
    title: 'Drillable hierarchy (Region → Country), color by category',
    json: visualJson('g_scatterDrill', 'scatterChart', { Category: [region, country], X: [sales], Y: [profit] }, { objects: { colorByCategory: [props({ show: true })], categoryLabels: [props({ show: true })], valueAxis: [props({ invertAxis: false, gridlineStyle: 'solid', gridlineColor: '#EDEBE9' })] } }),
    width: 420,
    height: 300
  },
  // ------------------------------------------------------------------ waterfall
  {
    id: 'waterfallTop3',
    section: WF,
    title: 'Total Sales by Quarter, breakdown Product (top 3 + Other)',
    json: visualJson('g_waterfallTop3', 'waterfallChart', { Category: [quarter], Breakdown: [product], Y: [sales] }, { objects: { breakdown: [props({ maxBreakdowns: 3 })], labels: [props({ show: true, labelDisplayUnits: 1000000, labelPrecision: 2 })] }, sort: [{ field: quarter, direction: 'Ascending' }] }),
    width: 640,
    height: 320
  },
  {
    id: 'waterfallNoTotal',
    section: WF,
    title: 'Profit by Month: no total, custom colors, inside labels, constant line',
    json: visualJson(
      'g_waterfallNoTotal',
      'waterfallChart',
      { Category: [month], Y: [profit] },
      {
        objects: {
          valueAxis: [props({ totalsEnabled: false })],
          sentimentColors: [props({ increaseFill: '#12239E', decreaseFill: '#E66C37' })],
          labels: [props({ show: true, labelPosition: 'InsideCenter', labelDisplayUnits: 1000 })],
          y1AxisReferenceLine: [line({ show: true, value: 1500000, lineColor: '#D64554', dataLabelShow: true, displayName: 'Plan', dataLabelText: 'ValueAndName' }, '1')]
        },
        sort: [{ field: month, direction: 'Ascending' }]
      }
    ),
    width: 640,
    height: 320
  },
  // ------------------------------------------------------------------ funnel
  {
    id: 'funnelPrev',
    section: FU,
    title: 'Opportunities: value + % of previous',
    json: visualJson('g_funnelPrev', 'funnel', { Category: [stage], Y: [opps] }, { objects: { labels: [props({ funnelLabelStyle: 'Data, percent of previous', percentageLabelPrecision: 1 })] }, sort: [{ field: stage, direction: 'Ascending' }] })
  },
  {
    id: 'funnelHighlight',
    section: FU,
    title: 'Cross-highlighted (Leads, Proposal), outside labels',
    json: visualJson('g_funnelHl', 'funnel', { Category: [stage], Y: [opps] }, { objects: { labels: [props({ labelPosition: 'OutsideEnd', funnelLabelStyle: 'Percent of first' })] }, sort: [{ field: stage, direction: 'Ascending' }] }),
    highlightFilters: [inFilter(P, 'Stage', ['Leads', 'Proposal'])]
  },
  {
    id: 'funnelGradient',
    section: FU,
    title: 'Sales by Channel: gradient colors, label background',
    json: visualJson('g_funnelGradient', 'funnel', { Category: [channel], Y: [sales] }, { objects: { dataPoint: [gradient(sales)], labels: [props({ enableBackground: true, backgroundTransparency: 0, color: '#252423' })] } })
  },
  // ------------------------------------------------------------------ treemap
  {
    id: 'treemapGradient',
    section: TM,
    title: 'Sales by Country, colored by Margin % (gradient), data labels',
    json: visualJson('g_treemapGradient', 'treemap', { Group: [country], Values: [sales] }, { objects: { dataPoint: [gradient(margin, '#FFE0CC', '#C94F0F')], labels: [props({ show: true })] } }),
    width: 460
  },
  {
    id: 'treemapHighlight',
    section: TM,
    title: 'Category → Product, cross-highlighted by Channel = Online',
    json: visualJson('g_treemapHighlight', 'treemap', { Group: [category], Details: [product], Values: [sales] }),
    highlightFilters: [inFilter(S, 'Channel', ['Online'])],
    width: 460
  },
  {
    id: 'treemapBinary',
    section: TM,
    title: 'Binary tiling, legend right, padding 3',
    json: visualJson('g_treemapBinary', 'treemap', { Group: [region], Details: [channel], Values: [units] }, { objects: { layout: [props({ tilingMethod: 'binary', innerPadding: 3 })], legend: [props({ position: 'Right' })], labels: [props({ show: true })] } }),
    width: 460
  },
  // ------------------------------------------------------------------ gauge / kpi
  {
    id: 'gaugeFields',
    section: GK,
    title: 'Total Cost (max field: Total Sales, target: Profit)',
    json: visualJson('g_gaugeFields', 'gauge', { Y: [cost], MaxValue: [sales], TargetValue: [profit] }, { objects: { calloutValue: [props({ labelDisplayUnits: 1000000, labelPrecision: 1 })] } }),
    width: 300,
    height: 220
  },
  {
    id: 'gaugeDefault',
    section: GK,
    title: 'Units Sold (default max = 2 × value)',
    json: visualJson('g_gaugeDefault', 'gauge', { Y: [units] }),
    width: 300,
    height: 220
  },
  {
    id: 'gaugeRules',
    section: GK,
    title: 'Margin % with rule colors (< 50% orange) and axis target',
    json: visualJson('g_gaugeRules', 'gauge', { Y: [margin] }, { objects: { axis: [props({ min: 0, max: 1, target: 0.5 })], dataPoint: [rules(margin, 0.5, '#E66C37', '#1AAB40')], target: [props({ color: '#D64554' })] } }),
    width: 300,
    height: 220
  },
  {
    id: 'kpiLowGood',
    section: GK,
    title: 'Total Cost (low is good, value + percent distance)',
    json: visualJson('g_kpiLow', 'kpi', { Indicator: [cost], TrendLine: [month], Goal: [target] }, { objects: { goals: [props({ direction: 'Low is good', distanceLabel: 'Value, percent' })] }, sort: [{ field: month, direction: 'Ascending' }] }),
    width: 300,
    height: 220
  },
  {
    id: 'kpiTwoGoals',
    section: GK,
    title: 'Total Sales between two goals (neutral)',
    json: visualJson('g_kpiTwo', 'kpi', { Indicator: [sales], TrendLine: [month], Goal: [profit, target] }, { sort: [{ field: month, direction: 'Ascending' }] }),
    width: 300,
    height: 220
  },
  {
    id: 'kpiNoGoal',
    section: GK,
    title: 'Units Sold (no target, last date, left aligned)',
    json: visualJson('g_kpiNoGoal', 'kpi', { Indicator: [units], TrendLine: [month] }, { objects: { lastDate: [props({ show: true })], indicator: [props({ horizontalAlignment: 'left', indicatorDisplayUnits: 1000 })] }, sort: [{ field: month, direction: 'Ascending' }] }),
    width: 300,
    height: 220
  }
]
