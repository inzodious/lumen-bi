/**
 * Snapping for points dragged in the model diagram (waypoints): alignment with other points of interest
 * (waypoints, card centres, the line's own ends) wins over the diagram grid; Alt turns both off.
 */
import type { Pt } from './routing'

/** Diagram grid (px in diagram coordinates). */
export const GRID = 10

export interface SnapOptions {
  /** false = no snapping at all (Alt held) */
  enabled?: boolean
  grid?: number
  /** x / y coordinates to align with */
  xs?: number[]
  ys?: number[]
  /** how close (diagram px) a coordinate must be to align; pass a screen distance divided by the zoom */
  threshold?: number
}

export interface SnapResult extends Pt {
  /** coordinates of the alignment guides to draw (undefined = that axis snapped to the grid or not at all) */
  guideX?: number
  guideY?: number
}

function nearest(v: number, candidates: number[] | undefined, threshold: number): number | undefined {
  let best: number | undefined
  let bd = threshold
  for (const c of candidates ?? []) {
    const d = Math.abs(c - v)
    if (d <= bd) {
      bd = d
      best = c
    }
  }
  return best
}

export function snapPoint(p: Pt, opts: SnapOptions = {}): SnapResult {
  if (opts.enabled === false) return { x: p.x, y: p.y }
  const grid = opts.grid ?? GRID
  const threshold = opts.threshold ?? 6
  const ax = nearest(p.x, opts.xs, threshold)
  const ay = nearest(p.y, opts.ys, threshold)
  const g = (v: number): number => (grid > 0 ? Math.round(v / grid) * grid : v)
  const out: SnapResult = { x: ax ?? g(p.x), y: ay ?? g(p.y) }
  if (ax !== undefined) out.guideX = ax
  if (ay !== undefined) out.guideY = ay
  return out
}

/** Snap a position along a card side (0…1) to the given fractions (side middle, the joined column's row). */
export function snapFraction(t: number, length: number, fractions: number[], thresholdPx: number, enabled = true): number {
  if (!enabled || length <= 0) return t
  let best = t
  let bd = thresholdPx
  for (const f of fractions) {
    const d = Math.abs(f - t) * length
    if (d <= bd) {
      bd = d
      best = f
    }
  }
  return best
}
