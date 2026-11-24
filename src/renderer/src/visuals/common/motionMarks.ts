/**
 * Data-mark tags for Lumen's visual animations (report/motion/animator.ts). A renderer spreads one of these onto the SVG
 * or HTML element that draws a data point; the animator then grows, reveals, sweeps, pops or counts it on entry and
 * morphs its geometry when the data changes. Untagged elements (axes, gridlines, legends) never move.
 */
type Mark = { 'data-wbi-mark': string }

/** A bar or column: grows from the axis (columns up, bars right; negative values the other way). */
export function barMark(vertical: boolean, negative: boolean): Mark {
  return { 'data-wbi-mark': vertical ? (negative ? 'grow-down' : 'grow-up') : negative ? 'grow-left' : 'grow-right' }
}

/** A funnel stage: widens from its center. */
export const WIDEN_MARK: Mark = { 'data-wbi-mark': 'grow-center' }

/** A line or area: revealed left to right. */
export const REVEAL_MARK: Mark = { 'data-wbi-mark': 'reveal' }

/** A marker or point: pops in from its center. */
export const POP_MARK: Mark = { 'data-wbi-mark': 'pop' }

/** An element whose only text is a formatted number: counts up to it. */
export const COUNT_MARK: Mark = { 'data-wbi-mark': 'count' }

/** A data label: fades in once its mark has arrived. */
export const LABEL_MARK: Mark = { 'data-wbi-mark': 'label' }

/** A shape that only fades in (treemap tiles, gauge arcs). */
export const FADE_MARK: Mark = { 'data-wbi-mark': 'fade' }

/** A pie or donut slice: sweeps in around the chart's center (cx, cy in the slice's own coordinates). */
export function sweepMark(cx: number, cy: number): Mark & { 'data-wbi-cx': number; 'data-wbi-cy': number } {
  return { 'data-wbi-mark': 'sweep', 'data-wbi-cx': Math.round(cx * 100) / 100, 'data-wbi-cy': Math.round(cy * 100) / 100 }
}
