/**
 * Data-label position of a line series point (format pane "Data labels > Position" on line, area and combo
 * charts).
 *
 * "Below" draws the label under its point; every other value (Above, Auto, and Center / Left / Right, which Lumen
 * draws above) draws it above. A label that collides with one already placed is dropped.
 *
 * Power BI's own "Auto" placement is not documented. A rule read off a single Power BI render (labels below at
 * local minima of the line, the other side when the preferred one leaves the plot or collides) was tried and
 * withdrawn: one visual does not establish the behaviour, so Auto is drawn like Above (approximation).
 */

export type LinePlacement = 'above' | 'below'

/** Side of the label of point `i` (`ys`: the points' pixel y; unused while Auto is drawn like Above). */
export function preferredLineLabelSide(position: string, _ys: ReadonlyArray<number | null | undefined>, _i: number): LinePlacement {
  return position.toLowerCase() === 'below' ? 'below' : 'above'
}

/** Sides to try in order (a single side: a colliding label is dropped, not moved). */
export function lineLabelSides(position: string, ys: ReadonlyArray<number | null | undefined>, i: number): LinePlacement[] {
  return [preferredLineLabelSide(position, ys, i)]
}
