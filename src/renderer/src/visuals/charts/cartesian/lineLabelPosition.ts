/**
 * Data-label position of a line series point (format pane "Data labels > Position" on line, area and combo
 * charts). Power BI's default is "Auto".
 *
 * "Auto" is an approximation of Power BI's placement, read off Power BI Desktop renders of line / combo charts
 * (every label of a 12-point line followed it): the label goes above its point, except at a local minimum of the
 * line (the point is drawn no higher than its neighbours and lower than at least one; an end point has one
 * neighbour), where it goes below. A label that would leave the plot area on its preferred side, or that collides
 * with a label already placed there, takes the other side. Microsoft doesn't document the rule.
 */

export type LinePlacement = 'above' | 'below'

/**
 * Preferred side for point `i` given the points' pixel y (SVG: larger = lower on screen; `null` = no point).
 * Explicit positions: "Below" is below, every other non-Auto value (Above, and Center / Left / Right, which
 * Lumen draws above) is above.
 */
export function preferredLineLabelSide(position: string, ys: ReadonlyArray<number | null | undefined>, i: number): LinePlacement {
  const p = position.toLowerCase()
  if (p === 'below') return 'below'
  if (p !== 'auto') return 'above'
  const y = ys[i]
  if (y === null || y === undefined) return 'above'
  const neighbours: number[] = []
  for (let j = i - 1; j >= 0; j--) {
    const v = ys[j]
    if (v !== null && v !== undefined) {
      neighbours.push(v)
      break
    }
  }
  for (let j = i + 1; j < ys.length; j++) {
    const v = ys[j]
    if (v !== null && v !== undefined) {
      neighbours.push(v)
      break
    }
  }
  if (!neighbours.length) return 'above'
  const localMin = neighbours.every((n) => y >= n) && neighbours.some((n) => y > n)
  return localMin ? 'below' : 'above'
}

/**
 * Sides to try in order. Auto falls back to the other side when the preferred one leaves the plot band
 * [`plotTop`, `plotBottom`] (label box top / bottom computed by `boxTop`); explicit positions are tried alone.
 */
export function lineLabelSides(
  position: string,
  ys: ReadonlyArray<number | null | undefined>,
  i: number,
  boxTop: (side: LinePlacement) => number,
  height: number,
  plotTop: number,
  plotBottom: number
): LinePlacement[] {
  const first = preferredLineLabelSide(position, ys, i)
  if (position.toLowerCase() !== 'auto') return [first]
  const other: LinePlacement = first === 'above' ? 'below' : 'above'
  const fits = (side: LinePlacement) => {
    const top = boxTop(side)
    return top >= plotTop - 0.5 && top + height <= plotBottom + 0.5
  }
  if (!fits(first) && fits(other)) return [other, first]
  return [first, other]
}
