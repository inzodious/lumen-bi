/**
 * Relationship line routing for the model diagram (pure geometry, no DOM).
 *
 *  - where a line attaches to a table card: automatically (the side facing the other end, at the joined
 *    column's row when the card is expanded) or at a manual anchor (`side` + position `t` along it);
 *  - the path through the user's pinch points (waypoints) in one of three styles:
 *      curved      a G1-continuous cubic spline through every waypoint, leaving/entering the cards
 *                  perpendicular to their edges (no kinks: the tangent direction is shared at each waypoint);
 *      orthogonal  horizontal/vertical legs with rounded corners (Power BI's look), passing through each waypoint;
 *      straight    a polyline;
 *  - a sampled polyline of the path for hit-testing ("which stretch of the line is under the cursor?") and for
 *    placing the cardinality markers and the filter-direction arrow along the line.
 */
import type { AnchorSide, LineStyle, RouteAnchor, RouteDef, RoutePoint } from '@core/io/diagramSidecar'
import type { Rect } from './edges'

export type Pt = RoutePoint

/** A resolved line end: the point on the card edge and the outward normal there. */
export interface End {
  point: Pt
  normal: Pt
  /** 'center' = overlapping cards (the line joins the card centres, no perpendicular departure) */
  side: AnchorSide | 'center'
  /** true when the user placed this end */
  manual: boolean
}

const NORMALS: Record<AnchorSide, Pt> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } }
const clamp = (v: number, lo: number, hi: number): number => (hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)))
const dist = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y)
const unit = (x: number, y: number): Pt => {
  const l = Math.hypot(x, y)
  return l < 1e-9 ? { x: 0, y: 0 } : { x: x / l, y: y / l }
}

/** Keep anchors off the rounded corners of a card. */
const EDGE_INSET = 10
const ROW_INSET = 12

export function sideNormal(side: AnchorSide): Pt {
  return NORMALS[side]
}

/** Point on the card edge for a manual anchor. */
export function anchorPoint(r: Rect, a: RouteAnchor): Pt {
  const t = clamp(a.t, 0, 1)
  if (a.side === 'left' || a.side === 'right') return { x: a.side === 'left' ? r.x : r.x + r.width, y: clamp(r.y + t * r.height, r.y + Math.min(EDGE_INSET, r.height / 2), r.y + r.height - Math.min(EDGE_INSET, r.height / 2)) }
  return { x: clamp(r.x + t * r.width, r.x + Math.min(EDGE_INSET, r.width / 2), r.x + r.width - Math.min(EDGE_INSET, r.width / 2)), y: a.side === 'top' ? r.y : r.y + r.height }
}

/** The anchor on the card's perimeter nearest to `p` (dragging a line end around its card). */
export function nearestAnchor(r: Rect, p: Pt): RouteAnchor {
  const tx = clamp((p.x - r.x) / Math.max(1, r.width), 0, 1)
  const ty = clamp((p.y - r.y) / Math.max(1, r.height), 0, 1)
  const inside = p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
  // distance from p to each side segment (inside the card: distance to the side's line)
  const d: Array<[AnchorSide, number]> = inside
    ? [
        ['left', p.x - r.x],
        ['right', r.x + r.width - p.x],
        ['top', p.y - r.y],
        ['bottom', r.y + r.height - p.y]
      ]
    : [
        ['left', Math.hypot(p.x - r.x, p.y - clamp(p.y, r.y, r.y + r.height))],
        ['right', Math.hypot(p.x - (r.x + r.width), p.y - clamp(p.y, r.y, r.y + r.height))],
        ['top', Math.hypot(p.x - clamp(p.x, r.x, r.x + r.width), p.y - r.y)],
        ['bottom', Math.hypot(p.x - clamp(p.x, r.x, r.x + r.width), p.y - (r.y + r.height))]
      ]
  let best = d[0]
  for (const c of d) if (c[1] < best[1] - 1e-9) best = c
  const side = best[0]
  return { side, t: side === 'left' || side === 'right' ? ty : tx }
}

function manualEnd(r: Rect, a: RouteAnchor): End {
  return { point: anchorPoint(r, a), normal: NORMALS[a.side], side: a.side, manual: true }
}

const rowYIn = (r: Rect, y: number | null): number => clamp(y ?? r.y + r.height / 2, r.y + Math.min(ROW_INSET, r.height / 2), r.y + r.height - Math.min(ROW_INSET, r.height / 2))

/**
 * Automatic end on `r` for a line heading to point `p`: the side facing `p`; on the left/right sides at the
 * joined column's row (`rowY`, absolute y; null when the card is collapsed), on top/bottom below/above `p`.
 */
export function autoEndToward(r: Rect, rowY: number | null, p: Pt): End {
  let side: AnchorSide
  if (p.x >= r.x + r.width) side = 'right'
  else if (p.x <= r.x) side = 'left'
  else if (p.y <= r.y) side = 'top'
  else if (p.y >= r.y + r.height) side = 'bottom'
  else side = nearestAnchor(r, p).side
  if (side === 'left' || side === 'right') return { point: { x: side === 'left' ? r.x : r.x + r.width, y: rowYIn(r, rowY) }, normal: NORMALS[side], side, manual: false }
  return { point: { x: clamp(p.x, r.x + EDGE_INSET, r.x + r.width - EDGE_INSET), y: side === 'top' ? r.y : r.y + r.height }, normal: NORMALS[side], side, manual: false }
}

/**
 * Automatic ends for a line directly between two cards: cards side by side connect left/right edges at the
 * joined columns' rows; vertically stacked cards connect bottom/top edges; overlapping cards join centres.
 */
export function autoEnds(a: Rect, ay: number | null, b: Rect, by: number | null): { from: End; to: End } {
  const mk = (point: Pt, side: AnchorSide): End => ({ point, normal: NORMALS[side], side, manual: false })
  if (a.x + a.width <= b.x) return { from: mk({ x: a.x + a.width, y: rowYIn(a, ay) }, 'right'), to: mk({ x: b.x, y: rowYIn(b, by) }, 'left') }
  if (b.x + b.width <= a.x) return { from: mk({ x: a.x, y: rowYIn(a, ay) }, 'left'), to: mk({ x: b.x + b.width, y: rowYIn(b, by) }, 'right') }
  const cxA = a.x + a.width / 2
  const cxB = b.x + b.width / 2
  const overlapL = Math.max(a.x, b.x)
  const overlapR = Math.min(a.x + a.width, b.x + b.width)
  const x = overlapR > overlapL ? (overlapL + overlapR) / 2 : (cxA + cxB) / 2
  const x1 = clamp(x, a.x + EDGE_INSET, a.x + a.width - EDGE_INSET)
  const x2 = clamp(x, b.x + EDGE_INSET, b.x + b.width - EDGE_INSET)
  if (a.y + a.height <= b.y) return { from: mk({ x: x1, y: a.y + a.height }, 'bottom'), to: mk({ x: x2, y: b.y }, 'top') }
  if (b.y + b.height <= a.y) return { from: mk({ x: x1, y: a.y }, 'top'), to: mk({ x: x2, y: b.y + b.height }, 'bottom') }
  const ca = { x: cxA, y: a.y + a.height / 2 }
  const cb = { x: cxB, y: b.y + b.height / 2 }
  const u = unit(cb.x - ca.x, cb.y - ca.y)
  const n = u.x === 0 && u.y === 0 ? { x: 1, y: 0 } : u
  return { from: { point: ca, normal: n, side: 'center', manual: false }, to: { point: cb, normal: { x: -n.x, y: -n.y }, side: 'center', manual: false } }
}

/**
 * Both ends of a relationship line: manual anchors where the user set them, otherwise automatic ones aimed at
 * the next point of the line (first/last waypoint, or the other end).
 */
export function resolveEnds(a: Rect, ay: number | null, b: Rect, by: number | null, route: RouteDef | undefined): { from: End; to: End } {
  const wps = route?.waypoints ?? []
  const mFrom = route?.from ? manualEnd(a, route.from) : null
  const mTo = route?.to ? manualEnd(b, route.to) : null
  if (!wps.length && !mFrom && !mTo) return autoEnds(a, ay, b, by)
  // (without waypoints at least one end is manual here, so the fallbacks below always have a point to aim at)
  const from = mFrom ?? autoEndToward(a, ay, wps[0] ?? mTo?.point ?? { x: b.x + b.width / 2, y: b.y + b.height / 2 })
  const to = mTo ?? autoEndToward(b, by, wps[wps.length - 1] ?? mFrom?.point ?? from.point)
  return { from, to }
}

// ---------------------------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------------------------

export interface Sample extends Pt {
  /** index of the stretch between control points: 0 = from-end → first waypoint, … (= where a new waypoint is inserted) */
  seg: number
  /** distance along the line from its start */
  len: number
}

export interface RouteGeometry {
  style: LineStyle
  /** SVG path data */
  d: string
  /** the path as a polyline (dense on curves) */
  samples: Sample[]
  length: number
  from: End
  to: End
  waypoints: Pt[]
}

const f = (v: number): string => String(Math.round(v * 100) / 100)

function finish(style: LineStyle, d: string, pts: Array<Pt & { seg: number }>, from: End, to: End, waypoints: Pt[]): RouteGeometry {
  const samples: Sample[] = []
  let len = 0
  pts.forEach((p, i) => {
    if (i) len += dist(pts[i - 1], p)
    samples.push({ x: p.x, y: p.y, seg: p.seg, len })
  })
  return { style, d, samples, length: len, from, to, waypoints }
}

function straightRoute(from: End, to: End, wps: Pt[]): RouteGeometry {
  const pts = [from.point, ...wps, to.point]
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)},${f(p.y)}`).join(' ')
  return finish('straight', d, pts.map((p, i) => ({ ...p, seg: Math.max(0, i - 1) })), from, to, wps)
}

const CURVE_STEPS = 24

/**
 * Cubic spline through the ends and waypoints. Each control point has ONE tangent direction, used by the
 * Bézier segment arriving at it and the one leaving it, so the curve has no kinks; the handle lengths scale
 * with the adjacent chord (a third of it), which keeps the curve from overshooting or looping. The ends leave
 * the cards along the edge normal.
 */
function curvedRoute(from: End, to: End, wps: Pt[]): RouteGeometry {
  const P = [from.point, ...wps, to.point]
  const n = P.length
  const dirs: Pt[] = P.map((p, i) => {
    if (i === 0) return from.normal
    if (i === n - 1) return { x: -to.normal.x, y: -to.normal.y }
    const a = unit(p.x - P[i - 1].x, p.y - P[i - 1].y)
    const b = unit(P[i + 1].x - p.x, P[i + 1].y - p.y)
    const s = unit(a.x + b.x, a.y + b.y)
    // a full reversal has no bisector: keep going the way we came
    return s.x === 0 && s.y === 0 ? a : s
  })
  let d = `M${f(P[0].x)},${f(P[0].y)}`
  const pts: Array<Pt & { seg: number }> = [{ ...P[0], seg: 0 }]
  for (let i = 0; i < n - 1; i++) {
    const p0 = P[i]
    const p3 = P[i + 1]
    const L = dist(p0, p3)
    // card ends get a longer handle so the line visibly departs perpendicular to the edge; at a waypoint the
    // handle is a third of the chord, but never much longer than the neighbouring stretch (a short stretch
    // next to a long one would otherwise be overshot)
    const endHandle = clamp(L * 0.45, Math.min(24, L / 2), 140)
    const h1 = i === 0 ? endHandle : Math.min(L / 3, dist(P[i - 1], p0) * 0.6)
    const h2 = i === n - 2 ? endHandle : Math.min(L / 3, dist(p3, P[i + 2]) * 0.6)
    const c1 = { x: p0.x + dirs[i].x * h1, y: p0.y + dirs[i].y * h1 }
    const c2 = { x: p3.x - dirs[i + 1].x * h2, y: p3.y - dirs[i + 1].y * h2 }
    d += ` C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(p3.x)},${f(p3.y)}`
    for (let k = 1; k <= CURVE_STEPS; k++) {
      const t = k / CURVE_STEPS
      const u = 1 - t
      pts.push({
        x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
        seg: i
      })
    }
  }
  return finish('curved', d, pts, from, to, wps)
}

const STUB = 18
const CORNER = 8
type Axis = 'h' | 'v'
const axisOf = (n: Pt): Axis => (Math.abs(n.x) >= Math.abs(n.y) ? 'h' : 'v')

/**
 * Orthogonal route: a short stub out of each card along the edge normal, then horizontal/vertical legs that
 * pass through every waypoint (one elbow between consecutive points; a Z/U/S shape when there are none).
 */
function orthogonalRoute(from: End, to: End, wps: Pt[]): RouteGeometry {
  const stubA = from.side === 'center' ? from.point : { x: from.point.x + from.normal.x * STUB, y: from.point.y + from.normal.y * STUB }
  const stubB = to.side === 'center' ? to.point : { x: to.point.x + to.normal.x * STUB, y: to.point.y + to.normal.y * STUB }
  const ctl = [stubA, ...wps, stubB]
  const last = ctl.length - 2
  const verts: Array<Pt & { seg: number }> = [{ ...from.point, seg: 0 }, { ...stubA, seg: 0 }]
  // direction of travel when arriving at ctl[i]
  let din: Pt = from.normal
  for (let i = 0; i <= last; i++) {
    const p = ctl[i]
    const q = ctl[i + 1]
    const push = (x: number, y: number): void => void verts.push({ x, y, seg: i })
    const startAxis = axisOf(from.normal)
    if (i === 0 && last === 0 && axisOf(to.normal) === startAxis) {
      // no waypoints, both ends on the same axis
      const h = startAxis === 'h'
      const pa = h ? p.x : p.y
      const qa = h ? q.x : q.y
      const na = h ? from.normal.x : from.normal.y
      const nb = h ? to.normal.x : to.normal.y
      if (na === nb) {
        // same side of both cards: U-shape around the further one
        const m = na > 0 ? Math.max(pa, qa) : Math.min(pa, qa)
        if (h) push(m, p.y), push(m, q.y)
        else push(p.x, m), push(q.x, m)
      } else if ((qa - pa) * na >= 0) {
        // facing each other: Z-shape through the middle
        const m = (pa + qa) / 2
        if (h) push(m, p.y), push(m, q.y)
        else push(p.x, m), push(q.x, m)
      } else {
        // facing away from each other: S-shape between the cards on the other axis
        const m = h ? (p.y + q.y) / 2 : (p.x + q.x) / 2
        if (h) push(p.x, m), push(q.x, m)
        else push(m, p.y), push(m, q.y)
      }
    } else {
      // One elbow between consecutive points, through either corner. Prefer the corner that keeps going the
      // way the line arrived and (on the last stretch) runs straight into the card's stub; never pick one
      // that doubles back over the previous leg or over the stub while the other does not.
      const turn = (a: Pt, b: Pt): number => {
        const d = a.x * b.x + a.y * b.y
        return d < -0.5 ? 10 : d < 0.5 ? 1 : 0
      }
      const cost = (c: Pt): number => {
        const l1 = unit(c.x - p.x, c.y - p.y)
        const l2 = unit(q.x - c.x, q.y - c.y)
        const leave = l1.x || l1.y ? l1 : l2
        const reach = l2.x || l2.y ? l2 : l1
        if (!leave.x && !leave.y) return 0
        return turn(leave, din) + (i === last ? turn(reach, { x: -to.normal.x, y: -to.normal.y }) : 0)
      }
      const a = { x: q.x, y: p.y }
      const b = { x: p.x, y: q.y }
      const c = cost(a) <= cost(b) ? a : b
      push(c.x, c.y)
    }
    push(q.x, q.y)
    // the last leg that has a length gives the arrival direction
    for (let k = verts.length - 1; k > 0; k--) {
      const u = unit(verts[k].x - verts[k - 1].x, verts[k].y - verts[k - 1].y)
      if (u.x || u.y) {
        din = u
        break
      }
    }
  }
  verts.push({ ...to.point, seg: last })
  // drop repeated points and merge collinear runs
  const pts: Array<Pt & { seg: number }> = []
  for (const v of verts) {
    const a = pts[pts.length - 1]
    if (a && Math.abs(a.x - v.x) < 0.01 && Math.abs(a.y - v.y) < 0.01) continue
    const b = pts[pts.length - 2]
    if (a && b) {
      const cross = (a.x - b.x) * (v.y - a.y) - (a.y - b.y) * (v.x - a.x)
      const dot = (a.x - b.x) * (v.x - a.x) + (a.y - b.y) * (v.y - a.y)
      if (Math.abs(cross) < 0.01 && dot > 0 && a.seg === v.seg) {
        pts[pts.length - 1] = { ...v }
        continue
      }
    }
    pts.push({ ...v })
  }
  // rounded corners
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`
  for (let i = 1; i < pts.length; i++) {
    const v = pts[i]
    if (i === pts.length - 1) {
      d += ` L${f(v.x)},${f(v.y)}`
      break
    }
    const a = pts[i - 1]
    const b = pts[i + 1]
    const r = Math.min(CORNER, dist(a, v) / 2, dist(v, b) / 2)
    const ua = unit(v.x - a.x, v.y - a.y)
    const ub = unit(b.x - v.x, b.y - v.y)
    const straight = Math.abs(ua.x * ub.y - ua.y * ub.x) < 1e-6
    if (r < 0.5 || straight) d += ` L${f(v.x)},${f(v.y)}`
    else d += ` L${f(v.x - ua.x * r)},${f(v.y - ua.y * r)} Q${f(v.x)},${f(v.y)} ${f(v.x + ub.x * r)},${f(v.y + ub.y * r)}`
  }
  return finish('orthogonal', d, pts, from, to, wps)
}

/** The line between two resolved ends through `waypoints`, in `style`. */
export function buildRoute(from: End, to: End, waypoints: Pt[], style: LineStyle): RouteGeometry {
  if (style === 'curved' && from.side !== 'center') return curvedRoute(from, to, waypoints)
  if (style === 'orthogonal' && from.side !== 'center') return orthogonalRoute(from, to, waypoints)
  const g = straightRoute(from, to, waypoints)
  return { ...g, style }
}

/** Position and direction (degrees, in travel direction from → to) at distance `len` along the line. */
export function pointAtLength(g: RouteGeometry, len: number): { x: number; y: number; angle: number } {
  const s = g.samples
  if (s.length < 2) return { x: s[0]?.x ?? 0, y: s[0]?.y ?? 0, angle: 0 }
  const l = clamp(len, 0, g.length)
  let i = 1
  while (i < s.length - 1 && s[i].len < l) i++
  // skip zero-length steps so the direction is defined
  let a = s[i - 1]
  const b = s[i]
  let j = i - 1
  while (j > 0 && b.len - a.len < 1e-9) a = s[--j]
  const span = b.len - a.len
  const t = span < 1e-9 ? 0 : (l - a.len) / span
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI }
}

/** Closest point of the line to `p`: its distance, the stretch it is on (`seg`) and how far along the line. */
export function nearestOnRoute(g: RouteGeometry, p: Pt): { x: number; y: number; dist: number; seg: number; len: number } {
  const s = g.samples
  let best = { x: s[0]?.x ?? 0, y: s[0]?.y ?? 0, dist: Infinity, seg: 0, len: 0 }
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]
    const b = s[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l2 = dx * dx + dy * dy
    const t = l2 < 1e-12 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1)
    const x = a.x + dx * t
    const y = a.y + dy * t
    const dd = Math.hypot(p.x - x, p.y - y)
    if (dd < best.dist) best = { x, y, dist: dd, seg: b.seg, len: a.len + (b.len - a.len) * t }
  }
  return best
}

export interface EdgeDecor {
  /** cardinality marker positions beside the line near the from / to ends */
  l1: Pt
  l2: Pt
  /** filter-direction arrow: position and the line's direction there (degrees, from → to) */
  mid: { x: number; y: number; angle: number }
}

/**
 * Where the cardinality markers and the direction arrow go. Markers sit a little way along the line from each
 * end, offset to its side, so they follow the line's direction in every style; the arrow sits at the middle of
 * the line — on polylines at the middle of the stretch that contains the midpoint (never on a corner).
 */
export function edgeDecor(g: RouteGeometry): EdgeDecor {
  const along = Math.min(14, g.length / 4)
  const perp = 9
  const a = pointAtLength(g, along)
  const b = pointAtLength(g, g.length - along)
  const side = (p: { x: number; y: number; angle: number }): Pt => {
    const r = (p.angle * Math.PI) / 180
    return { x: p.x - Math.sin(r) * perp, y: p.y + Math.cos(r) * perp }
  }
  let mid = pointAtLength(g, g.length / 2)
  if (g.style !== 'curved' && g.samples.length > 2) {
    const s = g.samples
    const half = g.length / 2
    let i = 1
    while (i < s.length - 1 && s[i].len < half) i++
    let lo = i - 1
    let hi = i
    if (s[hi].len - s[lo].len < 20) {
      // too short for the arrow: use the longest stretch instead
      for (let k = 1; k < s.length; k++) if (s[k].len - s[k - 1].len > s[hi].len - s[lo].len) (lo = k - 1), (hi = k)
    }
    mid = { x: (s[lo].x + s[hi].x) / 2, y: (s[lo].y + s[hi].y) / 2, angle: (Math.atan2(s[hi].y - s[lo].y, s[hi].x - s[lo].x) * 180) / Math.PI }
  }
  return { l1: side(a), l2: side(b), mid }
}

// ---------------------------------------------------------------------------------------------
// editing helpers
// ---------------------------------------------------------------------------------------------

/** `route` with a waypoint inserted on stretch `seg` (see `Sample.seg`). */
export function insertWaypoint(route: RouteDef | undefined, seg: number, p: Pt): RouteDef {
  const wps = [...(route?.waypoints ?? [])]
  const at = clamp(seg, 0, wps.length)
  wps.splice(at, 0, { x: p.x, y: p.y })
  return { ...(route ?? {}), waypoints: wps }
}

export function moveWaypoint(route: RouteDef, index: number, p: Pt): RouteDef {
  const wps = [...(route.waypoints ?? [])]
  if (index < 0 || index >= wps.length) return route
  wps[index] = { ...wps[index], x: p.x, y: p.y }
  return { ...route, waypoints: wps }
}

export function removeWaypoint(route: RouteDef, index: number): RouteDef {
  const wps = (route.waypoints ?? []).filter((_, i) => i !== index)
  const next: RouteDef = { ...route }
  if (wps.length) next.waypoints = wps
  else delete next.waypoints
  return next
}

/** `route` moved by (dx, dy): waypoints translate, anchors (relative to their cards) stay. */
export function translateRoute(route: RouteDef, dx: number, dy: number): RouteDef {
  if (!route.waypoints?.length) return route
  return { ...route, waypoints: route.waypoints.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) }
}
