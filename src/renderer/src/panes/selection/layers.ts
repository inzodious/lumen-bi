/**
 * Pure helpers for the Selection pane: layer tree, display names, sibling reordering and tab order.
 * Unit-tested in layers.test.ts.
 */
import type { PageDocument, VisualDocument } from '@core/report/types'
import { decodeLiteral } from '@core/report/literal'
import { isGroup, parentOf, positionOf } from '../../report/pbir'

export interface LayerNode {
  visual: VisualDocument
  depth: number
  children: LayerNode[]
}

/** Layer tree: top of the stack first (highest z), children nested under their group. */
export function layerTree(page: PageDocument): LayerNode[] {
  const names = new Set(page.visuals.map((v) => v.name))
  const build = (parent: string | undefined, depth: number): LayerNode[] =>
    page.visuals
      .filter((v) => {
        const p = parentOf(v)
        return parent ? p === parent : !p || !names.has(p)
      })
      .sort((a, b) => positionOf(b).z - positionOf(a).z)
      .map((v) => ({ visual: v, depth, children: isGroup(v) ? build(v.name, depth + 1) : [] }))
  return build(undefined, 0)
}

/** Flatten a tree honoring collapsed groups. */
export function flattenTree(nodes: LayerNode[], collapsed: Set<string>): LayerNode[] {
  const out: LayerNode[] = []
  const walk = (ns: LayerNode[]) => {
    for (const n of ns) {
      out.push(n)
      if (n.children.length && !collapsed.has(n.visual.name)) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/** Selection-pane name: group display name → container title text → fallback (visual type display name). */
export function layerName(v: VisualDocument, fallback: (visualType: string) => string): string {
  if (v.json?.visualGroup) return v.json.visualGroup.displayName ?? 'Group'
  const titles: any[] = v.json?.visual?.visualContainerObjects?.title ?? []
  for (const t of titles) {
    const raw = t?.properties?.text?.expr?.Literal?.Value
    if (typeof raw === 'string') {
      const s = decodeLiteral(raw)
      if (typeof s === 'string' && s.trim()) return s
    }
  }
  return fallback(v.json?.visual?.visualType ?? 'visual')
}

/**
 * Rename a layer. Groups store `visualGroup.displayName`; PBIR visuals have no separate selection-pane
 * name, so the container title text is set (PBI Desktop does the same for visuals with a title).
 */
export function renameLayer(v: VisualDocument, name: string): void {
  if (v.json?.visualGroup) {
    v.json.visualGroup.displayName = name
    return
  }
  const vis = v.json?.visual
  if (!vis) return
  vis.visualContainerObjects ??= {}
  const titles: any[] = (vis.visualContainerObjects.title ??= [])
  let entry = titles.find((e) => !e.selector)
  if (!entry) {
    entry = { properties: {} }
    titles.push(entry)
  }
  entry.properties ??= {}
  entry.properties.text = { expr: { Literal: { Value: `'${name.replace(/'/g, "''")}'` } } }
}

/** Move `name` directly above `target` in the stack (same parent only). Rewrites sibling z in 1000 steps. */
export function moveLayerAbove(page: PageDocument, name: string, target: string): boolean {
  const a = page.visuals.find((v) => v.name === name)
  const b = page.visuals.find((v) => v.name === target)
  if (!a || !b || a === b || (parentOf(a) ?? '') !== (parentOf(b) ?? '')) return false
  const siblings = page.visuals.filter((v) => (parentOf(v) ?? '') === (parentOf(a) ?? '')).sort((x, y) => positionOf(x).z - positionOf(y).z)
  const order = siblings.filter((v) => v !== a)
  order.splice(order.indexOf(b) + 1, 0, a)
  order.forEach((v, i) => {
    v.json.position ??= {}
    v.json.position.z = i * 1000
  })
  return true
}

/** Visuals in tab order (ascending `position.tabOrder`, z as tie breaker). */
export function tabOrderList(page: PageDocument): VisualDocument[] {
  return page.visuals.slice().sort((a, b) => positionOf(a).tabOrder - positionOf(b).tabOrder || positionOf(a).z - positionOf(b).z)
}

/** Move a visual one step in tab order (dir -1 = earlier). Renumbers tabOrder 0,1000,2000… */
export function moveTabOrder(page: PageDocument, name: string, dir: -1 | 1): void {
  const list = tabOrderList(page)
  const i = list.findIndex((v) => v.name === name)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  list.forEach((v, k) => {
    v.json.position ??= {}
    v.json.position.tabOrder = k * 1000
  })
}
