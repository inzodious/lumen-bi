/**
 * Treemap layout (pure): two-level (Group → Details) tiling with d3-hierarchy.
 *
 * Power BI uses a squarified layout ordered by value descending: the largest group sits at the
 * top-left and tiles are as square as possible. `layout.tilingMethod`:
 *   - stableSquarified (default) → squarify (d3 `treemapResquarify` keeps the topology stable
 *     between data updates; for a single layout it equals squarify)
 *   - binary → balanced binary split (`treemapBinary`)
 *   - alternating → slice / dice by depth (`treemapSliceDice`)
 * With Details, each group reserves a header strip at its top for the group label (when the group
 * is tall enough), and detail tiles fill the rest.
 */
import { hierarchy, treemap, treemapBinary, treemapResquarify, treemapSliceDice, treemapSquarify, type HierarchyRectangularNode } from 'd3-hierarchy'

export interface TreemapInputGroup {
  key: string
  /** leaf values (Details), or a single leaf when there are no details */
  children: Array<{ key: string; value: number }>
}

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface TreemapLayoutResult {
  groups: Array<{ key: string; rect: Rect; header: number }>
  leaves: Array<{ group: string; key: string; value: number; rect: Rect }>
}

export type TilingMethod = 'stableSquarified' | 'binary' | 'alternating' | 'squarified'

export interface TreemapLayoutOptions {
  width: number
  height: number
  tiling?: string
  /** px between tiles (PBI `layout.innerPadding`) */
  innerPadding?: number
  /** px around the whole treemap (PBI `layout.outerPadding`) */
  outerPadding?: number
  /** header strip height per group (0 = none) */
  groupHeader?: number
  /** groups smaller than this (px) get no header strip */
  minHeaderGroupHeight?: number
}

function tileOf(name: string | undefined) {
  switch (name) {
    case 'binary':
      return treemapBinary
    case 'alternating':
      return treemapSliceDice
    case 'squarified':
      return treemapSquarify
    default:
      return treemapResquarify
  }
}

interface Node {
  key: string
  value?: number
  children?: Node[]
}

export function layoutTreemap(groups: TreemapInputGroup[], opts: TreemapLayoutOptions): TreemapLayoutResult {
  const positive = groups.map((g) => ({ key: g.key, children: g.children.filter((c) => c.value > 0 && Number.isFinite(c.value)) })).filter((g) => g.children.length)
  if (!positive.length || opts.width <= 0 || opts.height <= 0) return { groups: [], leaves: [] }
  const outer = Math.max(0, opts.outerPadding ?? 0)
  const inner = Math.max(0, opts.innerPadding ?? 0)
  const header = Math.max(0, opts.groupHeader ?? 0)
  const minH = opts.minHeaderGroupHeight ?? header * 2.5
  const root = hierarchy<Node>({ key: '', children: positive.map((g) => ({ key: g.key, children: g.children.map((c) => ({ key: c.key, value: c.value })) })) })
    .sum((n) => n.value ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  // first pass without headers (group sizes), second pass with headers only for groups tall enough
  const make = () =>
    treemap<Node>()
      .tile(tileOf(opts.tiling))
      .size([opts.width, opts.height])
      .paddingInner(inner)
      .paddingTop((n) => (n.depth === 0 ? outer : 0))
      .paddingRight((n) => (n.depth === 0 ? outer : 0))
      .paddingBottom((n) => (n.depth === 0 ? outer : 0))
      .paddingLeft((n) => (n.depth === 0 ? outer : 0))
  const probe = make()(root.copy()) as HierarchyRectangularNode<Node>
  const tall = new Set((probe.children ?? []).filter((g) => g.y1 - g.y0 >= minH && g.x1 - g.x0 >= header * 2).map((g) => g.data.key))
  const laid = make()
    .paddingTop((n) => (n.depth === 1 && header > 0 && tall.has(n.data.key) ? header : n.depth === 0 ? outer : 0))(root) as HierarchyRectangularNode<Node>
  const out: TreemapLayoutResult = { groups: [], leaves: [] }
  for (const g of laid.children ?? []) {
    out.groups.push({ key: g.data.key, rect: { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 }, header: header > 0 && tall.has(g.data.key) ? header : 0 })
    for (const l of g.children ?? []) out.leaves.push({ group: g.data.key, key: l.data.key, value: l.value ?? 0, rect: { x0: l.x0, y0: l.y0, x1: Math.max(l.x0, l.x1), y1: Math.max(l.y0, l.y1) } })
  }
  return out
}
