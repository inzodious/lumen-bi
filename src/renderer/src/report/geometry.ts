/**
 * Canvas geometry (pure): resize handles, snapping with alignment guides, align / distribute,
 * lasso hit-testing. All coordinates are page-space CSS px (unscaled).
 */
import type { Rect } from './pbir'

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export interface Guide {
  axis: 'x' | 'y'
  /** coordinate of the guide line */
  pos: number
  /** extent along the other axis */
  from: number
  to: number
}

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
export type DistributeAxis = 'horizontal' | 'vertical'
/**
 * Reference for Align with several visuals: the selection bounds (PBI Desktop's behavior), the key object (the first
 * selected visual — Figma/Illustrator style, stays put), or the page.
 */
export type AlignTo = 'selection' | 'keyObject' | 'page'

export const MIN_SIZE = 10

export function boundsOf(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 }
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const r of rects) {
    x1 = Math.min(x1, r.x)
    y1 = Math.min(y1, r.y)
    x2 = Math.max(x2, r.x + r.width)
    y2 = Math.max(y2, r.y + r.height)
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

export function containsRect(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
}

/** Normalized rect from two drag points. */
export function rectFromPoints(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }
}

/** Visuals touched by a lasso (PBI selects visuals the lasso intersects). */
export function lassoHits(lasso: Rect, items: Array<{ name: string; rect: Rect }>): string[] {
  return items.filter((i) => intersects(lasso, i.rect)).map((i) => i.name)
}

/** Apply a resize drag (dx, dy in page px) from `start` using `handle`. */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, opts: { lockAspect?: boolean; minSize?: number } = {}): Rect {
  const min = opts.minSize ?? MIN_SIZE
  let { x, y, width, height } = start
  if (handle.includes('e')) width = start.width + dx
  if (handle.includes('w')) {
    width = start.width - dx
    x = start.x + dx
  }
  if (handle.includes('s')) height = start.height + dy
  if (handle.includes('n')) {
    height = start.height - dy
    y = start.y + dy
  }
  if (opts.lockAspect && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height
    const horizontalOnly = handle === 'e' || handle === 'w'
    const verticalOnly = handle === 'n' || handle === 's'
    if (verticalOnly) width = height * ratio
    else if (horizontalOnly) height = width / ratio
    else if (Math.abs(width - start.width) / start.width > Math.abs(height - start.height) / start.height) height = width / ratio
    else width = height * ratio
    if (handle.includes('w')) x = start.x + start.width - width
    if (handle.includes('n')) y = start.y + start.height - height
  }
  if (width < min) {
    if (handle.includes('w')) x -= min - width
    width = min
  }
  if (height < min) {
    if (handle.includes('n')) y -= min - height
    height = min
  }
  return { x, y, width, height }
}

interface Candidate {
  value: number
  from: number
  to: number
}

/**
 * Equal-spacing measurement (Figma-style distance guide): a gap segment along `axis` from `from` to `to`, drawn at
 * the perpendicular coordinate `at`. `value` is the gap in page px (shown as a label).
 */
export interface SpacingGuide {
  axis: 'x' | 'y'
  from: number
  to: number
  at: number
  value: number
}

/** Match-size indicator: these rects share the resized rect's width/height. */
export interface SizeMatch {
  dim: 'width' | 'height'
  value: number
  rects: Rect[]
}

/** Page layout guides (Lumen extension, not a PBI feature): page margin and the gutter between visuals, page px; 0 = off. */
export interface LayoutGuides {
  margin: number
  gutter: number
}

export interface SnapResult {
  rect: Rect
  guides: Guide[]
  spacing: SpacingGuide[]
  sizes: SizeMatch[]
}

function edgesX(r: Rect): number[] {
  return [r.x, r.x + r.width / 2, r.x + r.width]
}

function bestSnap(moving: number[], cands: Candidate[], threshold: number): { delta: number; value: number } | null {
  let best: { delta: number; value: number } | null = null
  for (const m of moving) {
    for (const c of cands) {
      const d = c.value - m
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, value: c.value }
    }
  }
  return best
}

export interface SnapOptions {
  /** snap distance in page px */
  threshold?: number
  /** grid size (0/undefined = no grid snapping) */
  grid?: number
  /** snap to other visuals' edges/centers (alignment guides), equal spacing and sizes */
  objects?: boolean
  page?: { width: number; height: number }
  /** page margin / gutter guides */
  layout?: LayoutGuides
  /** snap to equal spacing between neighbors (default true) */
  equalSpacing?: boolean
  /** resize: snap to neighbors' width/height (default true) */
  matchSize?: boolean
}

// ---- axis transposition: every snap is computed along x; y reuses it on transposed rects -------------------

const tr = (r: Rect): Rect => ({ x: r.y, y: r.x, width: r.height, height: r.width })
const flip = (a: 'x' | 'y'): 'x' | 'y' => (a === 'x' ? 'y' : 'x')
const trGuide = (g: Guide): Guide => ({ ...g, axis: flip(g.axis) })
const trSpacing = (g: SpacingGuide): SpacingGuide => ({ ...g, axis: flip(g.axis) })

const right = (r: Rect) => r.x + r.width
const bottom = (r: Rect) => r.y + r.height
/** vertical overlap (rects share a "row" along x) */
const rowOverlap = (a: Rect, b: Rect) => Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y)

interface Gap {
  a: Rect
  b: Rect
  value: number
}

/** Gaps between horizontally adjacent rects that share a row (nearest right neighbor of each rect). */
export function rowGaps(rects: Rect[], maxGap = 600): Gap[] {
  const out: Gap[] = []
  for (const a of rects) {
    let best: Rect | undefined
    for (const b of rects) {
      if (b === a || rowOverlap(a, b) <= 0 || b.x < right(a) - 0.01) continue
      if (!best || b.x < best.x) best = b
    }
    if (best) {
      const value = best.x - right(a)
      if (value > 0.5 && value <= maxGap) out.push({ a, b: best, value })
    }
  }
  return out
}

function gapSegment(a: Rect, b: Rect): SpacingGuide {
  // a is left of b; draw at the middle of their shared row
  const top = Math.max(a.y, b.y)
  const bot = Math.min(bottom(a), bottom(b))
  return { axis: 'x', from: right(a), to: b.x, at: bot > top ? (top + bot) / 2 : (a.y + a.height / 2 + b.y + b.height / 2) / 2, value: b.x - right(a) }
}

interface PosCandidate {
  /** target x of the moving rect */
  x: number
  /** spacing guides to show if chosen (computed lazily with the final rect) */
  spacing(r: Rect): SpacingGuide[]
}

/** Equal-spacing / gutter position candidates for a rect moving along x. */
function spacingCandidates(rect: Rect, others: Rect[], opts: SnapOptions): PosCandidate[] {
  const out: PosCandidate[] = []
  const mates = others.filter((o) => rowOverlap(o, rect) > 0)
  const cx = rect.x + rect.width / 2
  const left = mates.filter((o) => right(o) <= cx).sort((a, b) => right(b) - right(a))[0]
  const rightN = mates.filter((o) => o.x >= cx).sort((a, b) => a.x - b.x)[0]
  if (opts.equalSpacing !== false) {
    const gaps = rowGaps(others)
    const uniq = [...new Set(gaps.map((g) => Math.round(g.value * 2) / 2))]
    // highlight the existing equal gaps of the same row only (Figma): both ends share the moving rect's row
    const same = (v: number) => (r: Rect): SpacingGuide[] =>
      gaps.filter((g) => Math.abs(g.value - v) < 0.6 && rowOverlap(g.a, r) > 0 && rowOverlap(g.b, r) > 0).map((g) => gapSegment(g.a, g.b))
    if (left && rightN && rightN.x - right(left) >= rect.width) {
      const x = (right(left) + rightN.x - rect.width) / 2
      out.push({ x, spacing: (r) => [gapSegment(left, r), gapSegment(r, rightN), ...same(r.x - right(left))(r)] })
    }
    for (const g of uniq) {
      if (left) out.push({ x: right(left) + g, spacing: (r) => [gapSegment(left, r), ...same(g)(r)] })
      if (rightN) out.push({ x: rightN.x - g - rect.width, spacing: (r) => [gapSegment(r, rightN), ...same(g)(r)] })
    }
  }
  const gutter = opts.layout?.gutter ?? 0
  if (gutter > 0) {
    if (left) out.push({ x: right(left) + gutter, spacing: (r) => [gapSegment(left, r)] })
    if (rightN) out.push({ x: rightN.x - gutter - rect.width, spacing: (r) => [gapSegment(r, rightN)] })
  }
  return out
}

function alignCandidatesX(others: Rect[], opts: SnapOptions, edges: 'all' | 'sides'): Candidate[] {
  const xs: Candidate[] = []
  if (opts.objects === false) return xs
  for (const o of others) for (const v of edges === 'all' ? edgesX(o) : [o.x, right(o)]) xs.push({ value: v, from: o.y, to: bottom(o) })
  if (opts.page) {
    const pw = opts.page.width
    const ph = opts.page.height
    for (const v of edges === 'all' ? [0, pw / 2, pw] : [0, pw]) xs.push({ value: v, from: 0, to: ph })
    const m = opts.layout?.margin ?? 0
    if (m > 0 && m * 2 < pw) xs.push({ value: m, from: 0, to: ph }, { value: pw - m, from: 0, to: ph })
  }
  return xs
}

function guidesAt(r: Rect, cands: Candidate[], movingEdges: number[]): Guide[] {
  const out: Guide[] = []
  const seen = new Set<number>()
  for (const e of movingEdges) {
    const hits = cands.filter((c) => Math.abs(c.value - e) < 0.5)
    if (!hits.length || seen.has(Math.round(e * 2))) continue
    seen.add(Math.round(e * 2))
    let from = r.y
    let to = bottom(r)
    for (const h of hits) {
      from = Math.min(from, h.from)
      to = Math.max(to, h.to)
    }
    out.push({ axis: 'x', pos: hits[0].value, from, to })
  }
  return out
}

/** Snap a moving rect along x only. */
function snapMoveX(rect: Rect, others: Rect[], opts: SnapOptions, threshold: number): { x: number; snapped: boolean; guides: Guide[]; spacing: SpacingGuide[] } {
  const cands = alignCandidatesX(others, opts, 'all')
  const offsets = [0, rect.width / 2, rect.width]
  let bestX: number | undefined
  let bestD = Infinity
  let bestSpacing: PosCandidate | undefined
  for (const o of offsets)
    for (const c of cands) {
      const d = Math.abs(c.value - o - rect.x)
      if (d <= threshold && d < bestD) {
        bestD = d
        bestX = c.value - o
        bestSpacing = undefined
      }
    }
  if (opts.objects !== false)
    for (const sc of spacingCandidates(rect, others, opts)) {
      const d = Math.abs(sc.x - rect.x)
      // alignment wins ties (strictly closer spacing only)
      if (d <= threshold && d < bestD - 0.01) {
        bestD = d
        bestX = sc.x
        bestSpacing = sc
      }
    }
  if (bestX === undefined) {
    const x = opts.grid ? Math.round(rect.x / opts.grid) * opts.grid : rect.x
    return { x, snapped: false, guides: [], spacing: [] }
  }
  const out = { ...rect, x: bestX }
  const guides = guidesAt(out, cands, edgesX(out))
  let spacing: SpacingGuide[] = []
  if (bestSpacing) spacing = bestSpacing.spacing(out)
  else {
    // an alignment snap can land on an equal spacing too (e.g. page center and the gap coincide): show it
    const sc = spacingCandidates(rect, others, opts).find((c) => Math.abs(c.x - bestX!) < 0.5)
    if (sc) spacing = sc.spacing(out)
  }
  return { x: bestX, snapped: true, guides, spacing: dedupeSpacing(spacing) }
}

function dedupeSpacing(list: SpacingGuide[]): SpacingGuide[] {
  const seen = new Set<string>()
  return list.filter((g) => {
    const k = `${g.axis}:${g.from.toFixed(1)}:${g.to.toFixed(1)}:${g.at.toFixed(1)}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * Snap a moving rect to other visuals' edges/centers, equal spacing between neighbors, page edges/center, page
 * margins and gutter, and the grid. Returns the guides to draw (alignment lines + spacing measurements).
 */
export function snapMove(rect: Rect, others: Rect[], opts: SnapOptions = {}): SnapResult {
  const threshold = opts.threshold ?? 6
  const sx = snapMoveX(rect, others, opts, threshold)
  const trOpts: SnapOptions = { ...opts, page: opts.page ? { width: opts.page.height, height: opts.page.width } : undefined }
  const sy = snapMoveX(tr(rect), others.map(tr), trOpts, threshold)
  const out = { ...rect, x: sx.x, y: sy.x }
  // recompute guide extents with the final rect on both axes
  const gx = sx.snapped ? guidesAt(out, alignCandidatesX(others, opts, 'all'), edgesX(out)) : []
  const gy = sy.snapped ? guidesAt(tr(out), alignCandidatesX(others.map(tr), trOpts, 'all'), edgesX(tr(out))).map(trGuide) : []
  return { rect: out, guides: [...gx, ...gy], spacing: [...sx.spacing, ...sy.spacing.map(trSpacing)], sizes: [] }
}

/** Snap the moving right edge (handle 'e') of a rect along x: edges, gutter, equal spacing, matching widths. */
function snapRightEdgeX(rect: Rect, others: Rect[], opts: SnapOptions, threshold: number): { width: number; guides: Guide[]; spacing: SpacingGuide[]; size?: SizeMatch } {
  const edge = right(rect)
  type C = { value: number; kind: 'align' | 'gap' | 'size'; spacing?: (r: Rect) => SpacingGuide[]; size?: number }
  const cands: C[] = []
  const align = alignCandidatesX(others, opts, 'sides')
  for (const c of align) cands.push({ value: c.value, kind: 'align' })
  if (opts.objects !== false) {
    const mates = others.filter((o) => rowOverlap(o, rect) > 0 && o.x >= edge - threshold - 0.01 && o.x > rect.x)
    const rightN = mates.sort((a, b) => a.x - b.x)[0]
    if (rightN) {
      const gaps = opts.equalSpacing === false ? [] : [...new Set(rowGaps(others).map((g) => Math.round(g.value * 2) / 2))]
      if ((opts.layout?.gutter ?? 0) > 0) gaps.push(opts.layout!.gutter)
      for (const g of gaps) cands.push({ value: rightN.x - g, kind: 'gap', spacing: (r) => [gapSegment(r, rightN)] })
    }
    if (opts.matchSize !== false) for (const o of others) cands.push({ value: rect.x + o.width, kind: 'size', size: o.width })
  }
  let best: C | undefined
  let bestD = Infinity
  // priority on ties: align > gap > size
  const rank = { align: 0, gap: 1, size: 2 }
  for (const c of cands) {
    const d = Math.abs(c.value - edge)
    if (d > threshold) continue
    if (d < bestD - 0.01 || (Math.abs(d - bestD) <= 0.01 && best && rank[c.kind] < rank[best.kind])) {
      bestD = d
      best = c
    }
  }
  if (!best) {
    const e = opts.grid ? Math.round(edge / opts.grid) * opts.grid : edge
    return { width: Math.max(MIN_SIZE, e - rect.x), guides: [], spacing: [] }
  }
  const width = Math.max(MIN_SIZE, best.value - rect.x)
  const out = { ...rect, width }
  const guides = guidesAt(out, align, [right(out)])
  const spacing = best.spacing ? best.spacing(out) : []
  const sizeRects = opts.matchSize === false || opts.objects === false ? [] : others.filter((o) => Math.abs(o.width - width) < 0.5)
  return { width, guides, spacing, size: sizeRects.length ? { dim: 'width', value: width, rects: sizeRects } : undefined }
}

/** Mirror helpers so the left edge reuses the right-edge logic. */
function mirrorX(r: Rect, pageW: number): Rect {
  return { ...r, x: pageW - r.x - r.width }
}

/** Snap the moving edges of a resize to other visuals, equal spacing, matching sizes, margins/gutter and the grid. */
export function snapResize(rect: Rect, handle: Handle, others: Rect[], opts: SnapOptions = {}): SnapResult {
  const threshold = opts.threshold ?? 6
  let { x, y, width, height } = rect
  const guides: Guide[] = []
  const spacing: SpacingGuide[] = []
  const sizes: SizeMatch[] = []
  const pw = opts.page?.width ?? 100000
  const ph = opts.page?.height ?? 100000
  if (handle.includes('e')) {
    const s = snapRightEdgeX({ x, y, width, height }, others, opts, threshold)
    width = s.width
    guides.push(...s.guides)
    spacing.push(...s.spacing)
    if (s.size) sizes.push(s.size)
  } else if (handle.includes('w')) {
    // mirror the page horizontally: the left edge becomes a right edge
    const mOpts: SnapOptions = { ...opts, grid: undefined }
    const s = snapRightEdgeX(mirrorX({ x, y, width, height }, pw), others.map((o) => mirrorX(o, pw)), mOpts, threshold)
    const r = x + width
    let nx = r - s.width
    if (s.width === width && opts.grid) nx = Math.min(Math.round(x / opts.grid) * opts.grid, r - MIN_SIZE)
    x = nx
    width = r - x
    guides.push(...s.guides.map((g) => ({ ...g, pos: pw - g.pos })))
    spacing.push(...s.spacing.map((g) => ({ ...g, from: pw - g.to, to: pw - g.from })))
    if (s.size) sizes.push({ ...s.size, rects: s.size.rects.map((o) => mirrorX(o, pw)) })
  }
  const trOpts: SnapOptions = { ...opts, page: opts.page ? { width: ph, height: pw } : undefined }
  if (handle.includes('s')) {
    const s = snapRightEdgeX(tr({ x, y, width, height }), others.map(tr), trOpts, threshold)
    height = s.width
    guides.push(...s.guides.map(trGuide))
    spacing.push(...s.spacing.map(trSpacing))
    if (s.size) sizes.push({ dim: 'height', value: s.size.value, rects: s.size.rects.map(tr) })
  } else if (handle.includes('n')) {
    const mOpts: SnapOptions = { ...trOpts, grid: undefined }
    const t = tr({ x, y, width, height })
    const s = snapRightEdgeX(mirrorX(t, ph), others.map((o) => mirrorX(tr(o), ph)), mOpts, threshold)
    const b = y + height
    let ny = b - s.width
    if (s.width === height && opts.grid) ny = Math.min(Math.round(y / opts.grid) * opts.grid, b - MIN_SIZE)
    y = ny
    height = b - y
    guides.push(...s.guides.map((g) => trGuide({ ...g, pos: ph - g.pos })))
    spacing.push(...s.spacing.map((g) => trSpacing({ ...g, from: ph - g.to, to: ph - g.from })))
    if (s.size) sizes.push({ dim: 'height', value: s.size.value, rects: s.size.rects.map((o) => tr(mirrorX(o, ph))) })
  }
  return { rect: { x, y, width, height }, guides, spacing: dedupeSpacing(spacing), sizes }
}

/**
 * Align rects like PBI's Format ▸ Align: with one rect, relative to the page; with several, relative to
 * the selection bounds. Returns new rects in the same order.
 */
export function alignRects(rects: Rect[], mode: AlignMode, page?: { width: number; height: number }, opts: { to?: AlignTo; keyIndex?: number } = {}): Rect[] {
  if (!rects.length) return rects
  const to = opts.to ?? 'selection'
  const pageRect = page ? { x: 0, y: 0, width: page.width, height: page.height } : undefined
  const key = opts.keyIndex !== undefined ? rects[opts.keyIndex] : undefined
  const b =
    (rects.length === 1 || to === 'page') && pageRect ? pageRect : to === 'keyObject' && key && rects.length > 1 ? key : boundsOf(rects)
  return rects.map((r) => {
    switch (mode) {
      case 'left':
        return { ...r, x: b.x }
      case 'center':
        return { ...r, x: b.x + (b.width - r.width) / 2 }
      case 'right':
        return { ...r, x: b.x + b.width - r.width }
      case 'top':
        return { ...r, y: b.y }
      case 'middle':
        return { ...r, y: b.y + (b.height - r.height) / 2 }
      case 'bottom':
        return { ...r, y: b.y + b.height - r.height }
    }
  })
}

/**
 * Distribute rects evenly (equal gaps) between the outermost ones. Needs ≥ 3 rects (2 → unchanged,
 * like PBI where the command is disabled). Returns new rects in the same order.
 */
export function distributeRects(rects: Rect[], axis: DistributeAxis): Rect[] {
  if (rects.length < 3) return rects
  const pos = axis === 'horizontal' ? 'x' : 'y'
  const size = axis === 'horizontal' ? 'width' : 'height'
  const order = rects.map((r, i) => ({ r, i })).sort((a, b) => a.r[pos] - b.r[pos])
  const first = order[0].r
  const last = order.reduce((m, o) => (o.r[pos] + o.r[size] > m[pos] + m[size] ? o.r : m), first)
  const span = last[pos] + last[size] - first[pos]
  const total = rects.reduce((s, r) => s + r[size], 0)
  const gap = (span - total) / (rects.length - 1)
  const out = rects.slice()
  let cursor = first[pos]
  for (const { r, i } of order) {
    out[i] = { ...r, [pos]: cursor }
    cursor += r[size] + gap
  }
  return out
}

/** Clamp a rect so it stays on the page (PBI lets visuals hang off the page only partially; we keep the origin on-page). */
export function clampToPage(r: Rect, page: { width: number; height: number }): Rect {
  return { ...r, x: Math.max(0, Math.min(r.x, page.width - Math.min(r.width, page.width))), y: Math.max(0, Math.min(r.y, page.height - Math.min(r.height, page.height))) }
}

/** Round to 1/1000 px like PBI's serialized positions do (keeps JSON tidy). */
export function tidy(n: number): number {
  return Math.round(n * 1000) / 1000
}

/**
 * Distribute with a fixed gap: keep the first rect (leftmost / topmost) in place and lay the others out in order with
 * exactly `gap` px between them. Works with 2+ rects.
 */
export function distributeWithGap(rects: Rect[], axis: DistributeAxis, gap: number): Rect[] {
  if (rects.length < 2) return rects
  const pos = axis === 'horizontal' ? 'x' : 'y'
  const size = axis === 'horizontal' ? 'width' : 'height'
  const order = rects.map((r, i) => ({ r, i })).sort((a, b) => a.r[pos] - b.r[pos] || a.i - b.i)
  const out = rects.slice()
  let cursor = order[0].r[pos]
  for (const { r, i } of order) {
    out[i] = { ...r, [pos]: cursor }
    cursor += r[size] + gap
  }
  return out
}

/** Median of the positive gaps between neighbors (used as the default spacing for tidy up). */
function medianGap(rects: Rect[]): number | undefined {
  const g = [...rowGaps(rects).map((x) => x.value), ...rowGaps(rects.map(tr)).map((x) => x.value)].sort((a, b) => a - b)
  return g.length ? g[Math.floor(g.length / 2)] : undefined
}

/** Cluster rects into rows (reading order): a rect joins the current row when its vertical center lies inside it. */
export function rowsOf(rects: Rect[]): number[][] {
  const order = rects.map((r, i) => ({ r, i })).sort((a, b) => a.r.y + a.r.height / 2 - (b.r.y + b.r.height / 2))
  const rows: Array<{ top: number; bottom: number; items: number[] }> = []
  for (const { r, i } of order) {
    const cy = r.y + r.height / 2
    const row = rows.find((w) => cy >= w.top && cy <= w.bottom)
    if (row) {
      row.items.push(i)
      row.top = Math.min(row.top, r.y)
      row.bottom = Math.max(row.bottom, bottom(r))
    } else rows.push({ top: r.y, bottom: bottom(r), items: [i] })
  }
  rows.sort((a, b) => a.top - b.top)
  return rows.map((w) => w.items.sort((a, b) => rects[a].x - rects[b].x))
}

/**
 * Tidy up (Figma-style): arrange rects into an even grid that keeps their rough reading order. Rows are detected from
 * vertical overlap; columns line up across rows (column width = widest cell, row height = tallest cell); every gap is
 * `gap` (default: the median of the current gaps, rounded; 16 when none). The grid starts at the selection's top-left.
 */
export function tidyUp(rects: Rect[], gap?: number): Rect[] {
  if (rects.length < 2) return rects
  const g = Math.max(0, Math.round(gap ?? medianGap(rects) ?? 16))
  const rows = rowsOf(rects)
  const cols = Math.max(...rows.map((r) => r.length))
  const colW = Array.from({ length: cols }, (_, c) => Math.max(0, ...rows.map((r) => (r[c] !== undefined ? rects[r[c]].width : 0))))
  const rowH = rows.map((r) => Math.max(...r.map((i) => rects[i].height)))
  const b = boundsOf(rects)
  const out = rects.slice()
  let y = b.y
  rows.forEach((row, ri) => {
    let x = b.x
    row.forEach((i, ci) => {
      out[i] = { ...rects[i], x, y }
      // single-row layouts pack by each item's own width (an even row of cards); grids use column widths
      x += (rows.length === 1 ? rects[i].width : colW[ci]) + g
    })
    y += rowH[ri] + g
  })
  return out
}

/** Make rects the same width / height / size as the reference rect (key object). */
export function matchSize(rects: Rect[], dim: 'width' | 'height' | 'both', refIndex = 0): Rect[] {
  const ref = rects[refIndex]
  if (!ref) return rects
  return rects.map((r) => ({ ...r, ...(dim !== 'height' ? { width: ref.width } : {}), ...(dim !== 'width' ? { height: ref.height } : {}) }))
}

/** Resize from the bottom-right corner by (dw, dh), keeping a minimum size (keyboard resize). */
export function resizeBy(r: Rect, dw: number, dh: number): Rect {
  return { ...r, width: Math.max(MIN_SIZE, r.width + dw), height: Math.max(MIN_SIZE, r.height + dh) }
}
