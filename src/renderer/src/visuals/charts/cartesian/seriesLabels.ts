/**
 * Line-chart series labels (Format ▸ Series labels, PBIR object `seriesLabels`): the series name
 * drawn at the end (Right) or start (Left) of each line, in the series color by default, pushed
 * apart vertically so they never overlap (with leader lines when moved).
 */
import { ptToPx, measureText, lineHeight, fontWeightOf, type FontSpec } from '../../common/text'
import type { FormatReader } from '../../common/fmtProps'
import { PBI } from '../../common/fmtProps'
import type { Series } from '../../common/categorical'

export interface SeriesLabelStyle {
  show: boolean
  position: 'Left' | 'Right'
  font: FontSpec
  /** fixed color, or undefined = match series color */
  color?: string
  background?: string
  matchBackground: boolean
  backgroundOpacity: number
  /** horizontal room reserved for the labels */
  width: number
  maxWidth: number
  leaderLines: boolean
}

export function readSeriesLabels(fmt: FormatReader, series: Series[], kinds: string[]): SeriesLabelStyle {
  const show = fmt.bool('seriesLabels', 'show', false) && kinds.some((k) => k !== 'bar')
  const size = fmt.num('seriesLabels', 'textSize', fmt.num('seriesLabels', 'fontSize', PBI.dataLabelFontPt))
  const family = fmt.str('seriesLabels', 'seriesFontFamily', fmt.str('seriesLabels', 'fontFamily', PBI.fontFamily))
  const font: FontSpec = { size: ptToPx(size), family, weight: fontWeightOf(family, fmt.bool('seriesLabels', 'bold', false)), italic: fmt.bool('seriesLabels', 'italic', false) }
  const match = fmt.bool('seriesLabels', 'seriesMatchColor', true)
  const maxWidth = Math.max(20, fmt.num('seriesLabels', 'seriesMaximumWidth', 120))
  const names = series.filter((_, i) => kinds[i] !== 'bar').map((s) => s.name)
  const natural = Math.max(0, ...names.map((n) => measureText(n, font)))
  const leaderLines = fmt.bool('seriesLabels', 'leaderLines', true)
  return {
    show,
    position: fmt.str('seriesLabels', 'seriesPosition', 'Right') === 'Left' ? 'Left' : 'Right',
    font,
    color: match ? undefined : fmt.color('seriesLabels', 'seriesColor', PBI.labelColor),
    background: fmt.bool('seriesLabels', 'enableBackground', false) ? fmt.color('seriesLabels', 'backgroundColor', '#FFFFFF') : undefined,
    matchBackground: fmt.bool('seriesLabels', 'backgroundMatchColor', false),
    backgroundOpacity: 1 - fmt.num('seriesLabels', 'backgroundTransparency', 0) / 100,
    width: show ? Math.ceil(Math.min(natural, maxWidth)) + (leaderLines ? 14 : 6) : 0,
    maxWidth,
    leaderLines
  }
}

/**
 * Resolve vertical overlaps: items keep their order, are pushed down then up so each gets its
 * own line inside [top, bottom]. Returns the new centre y per item (same order as input).
 */
export function spreadLabels(ys: number[], heights: number[], top: number, bottom: number): number[] {
  const order = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b])
  const out = [...ys]
  let cursor = top
  for (const i of order) {
    out[i] = Math.max(out[i], cursor + heights[i] / 2)
    cursor = out[i] + heights[i] / 2
  }
  cursor = bottom
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]
    out[i] = Math.min(out[i], cursor - heights[i] / 2)
    cursor = out[i] - heights[i] / 2
  }
  return out
}

export { lineHeight }
