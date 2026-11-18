/**
 * Table groups ("containers") in the model diagram — pure geometry: fitting a container around its member
 * cards, the collapsed chip, resize handles, marquee selection, and which group a dropped card belongs to.
 */
import type { GroupBounds, GroupColor } from '@core/io/diagramSidecar'
import { bounds, type Rect } from './edges'

/** Space between the member cards and the container edge; the label sits in the taller top band. */
export const GROUP_PAD = 16
export const GROUP_HEADER = 34
/** Collapsed container ("chip") size. */
export const CHIP_WIDTH = 220
export const CHIP_HEIGHT = 40

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const RESIZE_HANDLES: readonly ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

export function containsPoint(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height
}

export function union(a: Rect, b: Rect): Rect {
  return bounds([a, b])!
}

/** Smallest container around the member cards: padding all round plus the label band on top. Null without members. */
export function fitGroup(members: Rect[]): Rect | null {
  const b = bounds(members)
  if (!b) return null
  return { x: b.x - GROUP_PAD, y: b.y - GROUP_HEADER, width: b.width + GROUP_PAD * 2, height: b.height + GROUP_HEADER + GROUP_PAD }
}

/**
 * The container's rectangle: it always fits its members (so it grows and shrinks as they move) and extends
 * to the manual bounds the user dragged out with the resize handles.
 */
export function groupRect(members: Rect[], manual?: GroupBounds): Rect | null {
  const fit = fitGroup(members)
  if (!fit) return null
  return manual ? union(fit, manual) : fit
}

/** The compact chip shown for a collapsed container, at the container's top-left corner. */
export function chipRect(expanded: Rect): Rect {
  return { x: expanded.x, y: expanded.y, width: CHIP_WIDTH, height: CHIP_HEIGHT }
}

/**
 * Drag a resize handle by (dx, dy) from `start`. The result never gets smaller than `fit` (the members must
 * stay inside), so each dragged edge stops at the fitted edge.
 */
export function resizeGroup(start: Rect, handle: ResizeHandle, dx: number, dy: number, fit: Rect): Rect {
  let x0 = start.x
  let y0 = start.y
  let x1 = start.x + start.width
  let y1 = start.y + start.height
  if (handle.includes('w')) x0 = Math.min(start.x + dx, fit.x)
  if (handle.includes('e')) x1 = Math.max(start.x + start.width + dx, fit.x + fit.width)
  if (handle.includes('n')) y0 = Math.min(start.y + dy, fit.y)
  if (handle.includes('s')) y1 = Math.max(start.y + start.height + dy, fit.y + fit.height)
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** Manual bounds worth storing: undefined when they add nothing to the fitted rectangle. */
export function manualBounds(rect: Rect, fit: Rect): GroupBounds | undefined {
  const same = Math.abs(rect.x - fit.x) < 0.5 && Math.abs(rect.y - fit.y) < 0.5 && Math.abs(rect.width - fit.width) < 0.5 && Math.abs(rect.height - fit.height) < 0.5
  return same ? undefined : { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

/** Names of the cards a marquee rectangle touches. */
export function cardsInMarquee(rects: Iterable<[string, Rect]>, marquee: Rect): string[] {
  const out: string[] = []
  for (const [name, r] of rects) if (intersects(r, marquee)) out.push(name)
  return out
}

/** Rectangle spanned by two corner points (marquee). */
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): Rect {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) }
}

export interface DropGroup {
  id: string
  /** the container's rectangle when the drag started (it does not chase the dragged cards) */
  rect: Rect
  tables: string[]
  collapsed?: boolean
}

/**
 * Group membership of dragged cards at their current position:
 *  - a member stays in its group while its card still touches the container as it was when the drag started
 *    (nudging a card past the edge just makes the container grow), and leaves once it is entirely outside;
 *  - a card that is in no group (or just left one) joins the expanded container its centre is over
 *    (the smallest one when several overlap).
 * Returns table → group id (null = no group) for every moved card.
 */
export function membershipAfterDrop(groups: DropGroup[], moved: Array<{ table: string; rect: Rect }>): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const m of moved) {
    const current = groups.find((g) => g.tables.includes(m.table))
    if (current && (current.collapsed || intersects(m.rect, current.rect))) {
      out.set(m.table, current.id)
      continue
    }
    const cx = m.rect.x + m.rect.width / 2
    const cy = m.rect.y + m.rect.height / 2
    const over = groups.filter((g) => !g.collapsed && g !== current && containsPoint(g.rect, cx, cy)).sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0]
    out.set(m.table, over?.id ?? null)
  }
  return out
}

/** Muted container colours (fill / border / label), shared by the diagram and its image export. */
export const GROUP_PALETTE: Record<GroupColor, { fill: string; border: string; text: string }> = {
  gray: { fill: '#e2e1df', border: '#bfbdba', text: '#484644' },
  blue: { fill: '#dde8f5', border: '#a6c2e4', text: '#2b5797' },
  teal: { fill: '#d9ece8', border: '#9bc9c0', text: '#0c695a' },
  green: { fill: '#dfedda', border: '#a6c99c', text: '#3b6b2f' },
  amber: { fill: '#f6eac4', border: '#dfc777', text: '#7a5d00' },
  rose: { fill: '#f5dfe3', border: '#dea8b2', text: '#8f2c3d' },
  purple: { fill: '#e8e1f4', border: '#bcaadd', text: '#5c3d94' }
}
