/**
 * Funnel conversion math (pure).
 *
 * PBI: the conversion-rate label (`percentBarLabel`) shows 100% above the first stage and the last
 * stage as a percent of the first below the funnel; tooltips show "%First" and "%Previous"; data
 * labels (`labels.funnelLabelStyle`) can show the value, % of first, % of previous or a combination.
 */
import { formatFixed } from '../../common/units'

export type FunnelLabelStyle = 'Data' | 'Percent of first' | 'Percent of previous' | 'Data, percent of first' | 'Data, percent of previous'

/** Normalize funnelLabelStyle / legacy labelStyle values. */
export function normalizeFunnelLabelStyle(v: string | undefined): FunnelLabelStyle {
  switch (v) {
    case 'Percent of first':
    case 'Percent of previous':
    case 'Data, percent of first':
    case 'Data, percent of previous':
      return v
    case 'Both':
    case 'Data value, percent of first':
      return 'Data, percent of first'
    case 'Data value, percent of previous':
      return 'Data, percent of previous'
    default:
      return 'Data'
  }
}

/** value / first (null when the first stage is 0 / blank). */
export function percentOfFirst(values: Array<number | null>, i: number): number | null {
  const first = values[0]
  const v = values[i]
  if (first === null || first === undefined || first === 0 || v === null || v === undefined) return null
  return v / first
}

/** value / previous stage (the first stage is 100%). */
export function percentOfPrevious(values: Array<number | null>, i: number): number | null {
  const v = values[i]
  if (v === null || v === undefined) return null
  if (i === 0) return 1
  const prev = values[i - 1]
  if (prev === null || prev === undefined || prev === 0) return null
  return v / prev
}

/** "45.67%" (PBI trims nothing: fixed decimals, default 2 for funnel percentages). */
export function formatPercent(ratio: number | null, decimals = 2): string {
  if (ratio === null || !Number.isFinite(ratio)) return ''
  return formatFixed(ratio * 100, decimals) + '%'
}

/** Data label text for a stage. */
export function funnelLabelText(style: FunnelLabelStyle, valueText: string, values: Array<number | null>, i: number, pctDecimals = 2): string {
  const first = formatPercent(percentOfFirst(values, i), pctDecimals)
  const prev = formatPercent(percentOfPrevious(values, i), pctDecimals)
  switch (style) {
    case 'Percent of first':
      return first
    case 'Percent of previous':
      return prev
    case 'Data, percent of first':
      return first ? `${valueText} (${first})` : valueText
    case 'Data, percent of previous':
      return prev ? `${valueText} (${prev})` : valueText
    default:
      return valueText
  }
}

/** Conversion-rate label at the bottom: last stage as a percent of the first. */
export function conversionRate(values: Array<number | null>): number | null {
  return values.length ? percentOfFirst(values, values.length - 1) : null
}
