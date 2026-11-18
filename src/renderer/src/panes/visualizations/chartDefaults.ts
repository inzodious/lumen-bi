/**
 * Format-pane defaults of the charts that their card definitions cannot state as a constant: values that follow the
 * report theme (axis-title and callout text classes, the first data color) or the visual's own configuration (label
 * position of stacked vs clustered bars, legend shown when a legend field is bound). Each entry is built on the
 * constant / resolver the renderer itself uses, and effectiveDefaults.test.tsx renders every chart fixture with an
 * empty format definition and checks the pane against the fallbacks the renderer passed. Properties a chart computes
 * per render (label colors picked for contrast, axis ranges, decimal places, per-series colors of a multi-series
 * chart) are deliberately absent: the pane keeps showing "Auto" for them.
 */
import type { Scalar } from '@core/model/data'
import { decodeValue, makePropContext, rawProp } from '@core/report/props'
import type { ResolvedTheme } from '@core/report/theme'
import { CALLOUT_FALLBACK, axisTitleClass, labelDerivedClass, textClass } from '../../visuals/common/fmtProps'
import { LINE_LABEL_POSITION_DEFAULT, barLabelPositionDefault } from '../../visuals/charts/cartesian/CartesianChart'
import { cartesianConfig } from '../../visuals/charts/cartesian/register'
import { kpiDirection } from '../../visuals/charts/gauge/kpiMath'
import { treemapHasDetails } from '../../visuals/charts/treemap/Treemap'
import { PIE_LABELS_SHOWN, pieLabelPositionDefault } from '../../visuals/charts/pie/PieChart'
import { WATERFALL_LABEL_POSITION } from '../../visuals/charts/waterfall/Waterfall'
import { FUNNEL_LABEL_POSITION } from '../../visuals/charts/funnel/Funnel'
import { SCATTER_X_GRIDLINES } from '../../visuals/charts/scatter/ScatterChart'
import { getVisual } from '../../visuals/registry'

export type ChartDefault = Scalar | undefined | ((theme: ResolvedTheme, visualJson: any) => Scalar | undefined)
export type ChartDefaultTable = Record<string, ChartDefault>

const projections = (visualJson: any, role: string): any[] => visualJson?.visual?.query?.queryState?.[role]?.projections ?? []
const bound = (visualJson: any, role: string) => projections(visualJson, role).length > 0

/** Number of series a chart draws from its measure wells (no legend field). */
function measureCount(visualJson: any): number {
  const def = getVisual(visualJson?.visual?.visualType ?? '')
  return (def?.roles ?? []).filter((r) => r.kind === 'measure' && r.name !== 'Tooltips').reduce((n, r) => n + projections(visualJson, r.name).length, 0)
}

/**
 * The single color of a one-series chart: the theme's first data color (common/color.ts palette order). With a
 * legend field or several measures each series has its own color, so the "All" row stays automatic.
 */
const singleSeriesColor = (theme: ResolvedTheme, visualJson: any): Scalar | undefined => (!bound(visualJson, 'Series') && measureCount(visualJson) <= 1 ? theme.dataColors[0] : undefined)

/** Axis titles use the theme's `title` text class (CartesianChart / ScatterChart / Waterfall: axisTitleDefaults). */
const AXIS_TITLES: ChartDefaultTable = Object.fromEntries(
  ['categoryAxis', 'valueAxis'].flatMap((axis) => [
    [`${axis}.titleFontFamily`, (t: ResolvedTheme) => axisTitleClass(t).family],
    [`${axis}.titleFontSize`, (t: ResolvedTheme) => axisTitleClass(t).size],
    [`${axis}.titleColor`, (t: ResolvedTheme) => axisTitleClass(t).color]
  ])
)

/** Data-label position: bars by stacking, lines / areas "Above"; combos mix both, so they stay automatic. */
function labelPosition(_theme: ResolvedTheme, visualJson: any): Scalar | undefined {
  const cfg = cartesianConfig(visualJson?.visual?.visualType ?? '')
  if (!cfg) return undefined
  const kinds = new Set(['Y', 'Y2'].map((r) => cfg.kindOf(r)))
  if (kinds.size > 1) return undefined
  const barSeries = !bound(visualJson, 'Series') && measureCount(visualJson) <= 1 ? 1 : 2
  return kinds.has('bar') ? barLabelPositionDefault(cfg.stacking, barSeries) : LINE_LABEL_POSITION_DEFAULT
}

/** Axis label text: `lightLabel` (category axis) / `smallLightLabel` (value axis) classes (CartesianChart). */
const AXIS_LABELS: ChartDefaultTable = {
  'categoryAxis.fontSize': (t: ResolvedTheme) => labelDerivedClass(t, 'lightLabel').size,
  'categoryAxis.fontFamily': (t: ResolvedTheme) => labelDerivedClass(t, 'lightLabel').family,
  'valueAxis.fontSize': (t: ResolvedTheme) => labelDerivedClass(t, 'smallLightLabel').size,
  'valueAxis.fontFamily': (t: ResolvedTheme) => labelDerivedClass(t, 'smallLightLabel').family,
  'labels.fontFamily': (t: ResolvedTheme) => labelDerivedClass(t, 'smallLightLabel').family
}

const CARTESIAN: ChartDefaultTable = {
  ...AXIS_TITLES,
  ...AXIS_LABELS,
  'labels.labelPosition': labelPosition,
  'dataPoint.defaultColor': singleSeriesColor,
  'dataPoint.fill': singleSeriesColor
}

const callout = (t: ResolvedTheme) => textClass(t, 'callout', CALLOUT_FALLBACK)

/** Legend shown by default only with a legend field (ScatterChart: `!!seriesRef`, MapChart: `!!seriesField`). */
const legendWithSeries = (_t: ResolvedTheme, visualJson: any) => bound(visualJson, 'Series')

/** Pie / donut labels: on; position from the legacy `labelPosition` when present (PieChart.tsx). */
const PIE: ChartDefaultTable = {
  'labels.show': PIE_LABELS_SHOWN,
  'labels.position': (t, json) => {
    const raw = rawProp(makePropContext(json, t), 'labels', 'labelPosition')
    const legacy = raw === undefined ? undefined : decodeValue(raw, t)
    return pieLabelPositionDefault(typeof legacy === 'string' && legacy !== '' ? legacy : undefined)
  }
}

const MAP: ChartDefaultTable = { 'legend.show': legendWithSeries, 'dataPoint.defaultColor': (t) => t.dataColors[0] }

export const CHART_DEFAULTS: Record<string, ChartDefaultTable> = {
  ...Object.fromEntries(
    [
      'clusteredColumnChart',
      'columnChart',
      'hundredPercentStackedColumnChart',
      'clusteredBarChart',
      'barChart',
      'hundredPercentStackedBarChart',
      'lineChart',
      'areaChart',
      'stackedAreaChart',
      'hundredPercentStackedAreaChart',
      'lineClusteredColumnComboChart',
      'lineStackedColumnComboChart',
      'ribbonChart'
    ].map((type) => [type, CARTESIAN])
  ),
  // Waterfall: one color per kind (increase / decrease / total), label position "Auto" (Waterfall.tsx)
  waterfallChart: { ...AXIS_TITLES, 'labels.labelPosition': WATERFALL_LABEL_POSITION },
  scatterChart: {
    ...AXIS_TITLES,
    'legend.show': legendWithSeries,
    'dataPoint.defaultColor': singleSeriesColor,
    'dataPoint.fill': singleSeriesColor,
    'categoryAxis.gridlineShow': SCATTER_X_GRIDLINES
  },
  pieChart: PIE,
  donutChart: PIE,
  treemap: { 'legend.show': (_t, json) => treemapHasDetails(json) },
  funnel: { 'labels.labelPosition': FUNNEL_LABEL_POSITION, 'dataPoint.defaultColor': singleSeriesColor, 'dataPoint.fill': singleSeriesColor },
  gauge: {
    'calloutValue.fontFamily': (t) => callout(t).family,
    'calloutValue.color': (t) => callout(t).color
  },
  kpi: {
    'indicator.fontFamily': (t) => callout(t).family,
    'indicator.fontSize': (t) => callout(t).size,
    'indicator.fontColor': (t) => callout(t).color,
    // the target direction follows "Color coding" unless set (Gauge.tsx kpiDirection)
    'goals.direction': (t, json) => {
      const raw = rawProp(makePropContext(json, t), 'status', 'direction')
      const status = raw === undefined ? undefined : decodeValue(raw, t)
      return kpiDirection(undefined, typeof status === 'string' ? status : undefined) === 'low' ? 'Low is good' : 'High is good'
    }
  },
  map: MAP,
  filledMap: MAP,
  azureMap: MAP,
  shapeMap: { 'legend.show': legendWithSeries }
}
