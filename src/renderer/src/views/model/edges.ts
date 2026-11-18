/**
 * Relationship line geometry for the model diagram: anchor points on the card edges (at the joined
 * column's row when visible), plus positions for the cardinality labels and the filter-direction arrow.
 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface EdgeGeometry {
  x1: number
  y1: number
  x2: number
  y2: number
  /** cardinality label positions near each end */
  l1: { x: number; y: number }
  l2: { x: number; y: number }
  /** middle of the line (direction arrow) and the line angle in degrees (from end 1 to end 2) */
  mid: { x: number; y: number }
  angle: number
  path: string
}

/**
 * `ay` / `by`: preferred y of the anchors (row of the joined column), clamped into the card.
 * Cards side by side connect left/right edges; vertically stacked cards connect bottom/top edges.
 */
export function edgeGeometry(a: Rect, ay: number | null, b: Rect, by: number | null): EdgeGeometry {
  const clampY = (r: Rect, y: number | null) => Math.min(r.y + r.height - 12, Math.max(r.y + 12, y ?? r.y + r.height / 2))
  let x1 = 0
  let y1 = 0
  let x2 = 0
  let y2 = 0
  let horizontal = true
  if (a.x + a.width <= b.x) {
    x1 = a.x + a.width
    x2 = b.x
  } else if (b.x + b.width <= a.x) {
    x1 = a.x
    x2 = b.x + b.width
  } else horizontal = false
  if (horizontal) {
    y1 = clampY(a, ay)
    y2 = clampY(b, by)
  } else {
    const cxA = a.x + a.width / 2
    const cxB = b.x + b.width / 2
    const overlapL = Math.max(a.x, b.x)
    const overlapR = Math.min(a.x + a.width, b.x + b.width)
    const x = overlapR > overlapL ? (overlapL + overlapR) / 2 : (cxA + cxB) / 2
    x1 = Math.min(a.x + a.width - 10, Math.max(a.x + 10, x))
    x2 = Math.min(b.x + b.width - 10, Math.max(b.x + 10, x))
    if (a.y + a.height <= b.y) {
      y1 = a.y + a.height
      y2 = b.y
    } else if (b.y + b.height <= a.y) {
      y1 = a.y
      y2 = b.y + b.height
    } else {
      // overlapping cards: connect centers
      x1 = cxA
      y1 = a.y + a.height / 2
      x2 = cxB
      y2 = b.y + b.height / 2
    }
  }
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.max(1, Math.hypot(dx, dy))
  const ux = dx / len
  const uy = dy / len
  // label offset: along the line + perpendicular
  const off = 14
  const perp = 9
  const l1 = { x: x1 + ux * off - uy * perp, y: y1 + uy * off + ux * perp }
  const l2 = { x: x2 - ux * off - uy * perp, y: y2 - uy * off + ux * perp }
  return { x1, y1, x2, y2, l1, l2, mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }, angle: (Math.atan2(dy, dx) * 180) / Math.PI, path: `M${x1},${y1} L${x2},${y2}` }
}

/** Bounding box of rects (null for none). */
export function bounds(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const r of rects) {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.width)
    y1 = Math.max(y1, r.y + r.height)
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** Zoom & pan that fit `content` into a viewport of `vw`×`vh` with padding. */
export function fitView(content: Rect | null, vw: number, vh: number, opts: { padding?: number; min?: number; max?: number } = {}): { zoom: number; panX: number; panY: number } {
  const pad = opts.padding ?? 40
  if (!content || vw <= 0 || vh <= 0) return { zoom: 1, panX: pad, panY: pad }
  const z = Math.min((vw - pad * 2) / Math.max(1, content.width), (vh - pad * 2) / Math.max(1, content.height))
  const zoom = Math.max(opts.min ?? 0.1, Math.min(opts.max ?? 1, z))
  const panX = (vw - content.width * zoom) / 2 - content.x * zoom
  const panY = Math.max(pad - content.y * zoom, (vh - content.height * zoom) / 2 - content.y * zoom)
  return { zoom, panX: zoom === z ? panX : pad - content.x * zoom, panY: zoom === z ? panY : pad - content.y * zoom }
}
