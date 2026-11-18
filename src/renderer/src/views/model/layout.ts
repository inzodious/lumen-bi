/**
 * Model diagram layout — Power BI's `diagramLayout.json` (PBIP sidecar) read/write + auto-layout.
 *
 *   { version: "1.1.0", diagrams: [{ ordinal, scrollPosition{x,y}, nodes: [{ location{x,y}, nodeIndex: <table>,
 *     nodeLineageTag?, size{height,width}, zIndex }], name: "All tables", zoomValue: 100, pinKeyFieldsToTop,
 *     showExtraHeaderInfo, hideKeyFieldsWhenCollapsed, tablesLocked }], selectedDiagram, defaultDiagram }
 *
 * Unknown properties are preserved on write.
 */
import type { SemanticModel, TableDef } from '@core/model/types'

export const LAYOUT_FILE = 'diagramLayout.json'
export const DEFAULT_CARD_WIDTH = 234
export const DEFAULT_CARD_HEIGHT = 300
export const HEADER_HEIGHT = 40
export const ROW_HEIGHT = 24

export interface DiagramNode {
  location: { x: number; y: number }
  nodeIndex: string
  nodeLineageTag?: string
  size: { height: number; width: number }
  zIndex?: number
  [k: string]: unknown
}

export interface Diagram {
  ordinal?: number
  scrollPosition?: { x: number; y: number }
  nodes: DiagramNode[]
  name: string
  zoomValue?: number
  pinKeyFieldsToTop?: boolean
  showExtraHeaderInfo?: boolean
  hideKeyFieldsWhenCollapsed?: boolean
  tablesLocked?: boolean
  [k: string]: unknown
}

export interface DiagramLayout {
  version: string
  diagrams: Diagram[]
  selectedDiagram?: string
  defaultDiagram?: string
  [k: string]: unknown
}

export function readLayout(model: SemanticModel): DiagramLayout | null {
  const raw = model.sidecarFiles?.[LAYOUT_FILE]
  if (!raw) return null
  try {
    const json = JSON.parse(raw) as Partial<DiagramLayout>
    if (!json || !Array.isArray(json.diagrams)) return null
    return {
      ...json,
      version: json.version ?? '1.1.0',
      diagrams: json.diagrams
        .filter((d): d is Diagram => !!d && typeof d === 'object')
        .map((d) => ({ ...d, name: d.name ?? 'All tables', nodes: Array.isArray(d.nodes) ? d.nodes.filter((n) => n && typeof n.nodeIndex === 'string') : [] }))
    }
  } catch {
    return null
  }
}

export function serializeLayout(layout: DiagramLayout): string {
  return JSON.stringify(layout, null, 2)
}

export function writeLayout(model: SemanticModel, layout: DiagramLayout): void {
  model.sidecarFiles = { ...(model.sidecarFiles ?? {}), [LAYOUT_FILE]: serializeLayout(layout) }
}

/** Visible tables shown in the diagram (PBI hides auto date tables / private tables). */
export function diagramTables(model: SemanticModel): TableDef[] {
  return model.tables.filter((t) => !t.isPrivate && !t.showAsVariationsOnly && !/^(LocalDateTable_|DateTableTemplate_)/.test(t.name))
}

/** Card height PBI uses by default: header + rows, capped (cards scroll internally). */
export function defaultCardHeight(t: TableDef): number {
  const rows = t.columns.filter((c) => c.kind !== 'rowNumber').length + t.measures.length + t.hierarchies.length
  return Math.min(DEFAULT_CARD_HEIGHT, HEADER_HEIGHT + Math.max(1, rows) * ROW_HEIGHT + 10)
}

/**
 * Auto-layout (star/snowflake aware): fact tables (on the many side, never on the one side) in the
 * middle band, their dimensions alternating above/below, deeper snowflake levels further out, and
 * unrelated tables (measure tables, parameters) in a grid to the right.
 */
export function autoLayout(model: SemanticModel, gap = 60): DiagramNode[] {
  const tables = diagramTables(model)
  const names = new Set(tables.map((t) => t.name))
  const rels = model.relationships.filter((r) => names.has(r.fromTable) && names.has(r.toTable))
  const oneSide = new Map<string, Set<string>>() // fact -> dims
  const isOne = new Set<string>()
  const isMany = new Set<string>()
  for (const r of rels) {
    const manyT = r.fromCardinality === 'one' && r.toCardinality === 'many' ? r.toTable : r.fromTable
    const oneT = manyT === r.fromTable ? r.toTable : r.fromTable
    isMany.add(manyT)
    isOne.add(oneT)
    if (!oneSide.has(manyT)) oneSide.set(manyT, new Set())
    oneSide.get(manyT)!.add(oneT)
  }
  const level = new Map<string, number>()
  const facts = tables.filter((t) => isMany.has(t.name) && !isOne.has(t.name)).map((t) => t.name)
  // tables in a pure cycle / many-many only: treat the many-est as facts
  if (!facts.length) for (const t of tables) if (isMany.has(t.name)) facts.push(t.name)
  for (const f of facts) level.set(f, 0)
  let frontier = [...facts]
  while (frontier.length) {
    const next: string[] = []
    for (const t of frontier) {
      for (const d of oneSide.get(t) ?? []) {
        if (!level.has(d)) {
          level.set(d, (level.get(t) ?? 0) + 1)
          next.push(d)
        }
      }
    }
    frontier = next
  }
  const byName = new Map(tables.map((t) => [t.name, t]))
  const w = DEFAULT_CARD_WIDTH
  const nodes: DiagramNode[] = []
  const place = (name: string, x: number, y: number) => {
    const t = byName.get(name)!
    nodes.push({ location: { x, y }, nodeIndex: name, nodeLineageTag: t.lineageTag, size: { height: defaultCardHeight(t), width: w }, zIndex: nodes.length })
  }
  // Facts form the middle column (stacked); dimensions alternate left/right of it, deeper snowflake
  // levels further out. Each side wraps into several columns so wide models stay compact.
  const colW = w + gap * 2
  const rowH = (t: string) => defaultCardHeight(byName.get(t)!) + gap
  const maxLevel = Math.max(0, ...level.values())
  const sides = new Map<number, string[]>() // column index: 0 = facts, -L left, +L right
  sides.set(0, [...facts])
  let flip = false
  for (let L = 1; L <= maxLevel; L++) {
    const atL = [...level.entries()].filter(([, l]) => l === L).map(([n]) => n)
    for (const n of atL) {
      const c = flip ? L : -L
      sides.set(c, [...(sides.get(c) ?? []), n])
      flip = !flip
    }
  }
  const factsHeight = facts.reduce((s, f) => s + rowH(f), 0)
  const perCol = Math.max(3, Math.ceil(Math.sqrt(tables.length)), Math.ceil(factsHeight / (DEFAULT_CARD_HEIGHT + gap)))
  // expand every logical column into physical sub-columns of at most perCol cards
  const physical: Array<{ key: number; list: string[] }> = []
  for (const key of [...sides.keys()].sort((a, b) => a - b)) {
    const list = sides.get(key)!
    const chunks: string[][] = []
    for (let i = 0; i < list.length; i += key === 0 ? Math.max(perCol, list.length) : perCol) chunks.push(list.slice(i, i + (key === 0 ? Math.max(perCol, list.length) : perCol)))
    // left side: outermost chunk furthest left
    if (key < 0) chunks.reverse()
    for (const c of chunks) physical.push({ key, list: c })
  }
  let maxRight = 0
  const heights = physical.map((p) => p.list.reduce((s, n) => s + rowH(n), 0))
  const tallest = Math.max(0, ...heights)
  physical.forEach((p, ci) => {
    let y = (tallest - heights[ci]) / 2
    const x = ci * colW
    for (const n of p.list) {
      place(n, x, Math.round(y))
      y += rowH(n)
    }
    maxRight = Math.max(maxRight, x + w)
  })
  const bandH = DEFAULT_CARD_HEIGHT + gap
  // unrelated tables: grid on the right
  const rest = tables.filter((t) => !level.has(t.name))
  const cols = Math.max(1, Math.ceil(Math.sqrt(rest.length)))
  const startX = nodes.length ? maxRight + gap * 2 : 0
  rest.forEach((t, i) => place(t.name, startX + (i % cols) * (w + gap), Math.floor(i / cols) * bandH))
  return nodes
}

/**
 * Resolve the nodes for a diagram: stored positions for known tables (by name, then lineage tag),
 * auto-layout positions for tables missing from the stored layout ("All tables" only).
 */
export function resolveNodes(model: SemanticModel, layout: DiagramLayout | null, diagramName: string): DiagramNode[] {
  const tables = diagramTables(model)
  const auto = autoLayout(model)
  const diagram = layout?.diagrams.find((d) => d.name === diagramName) ?? layout?.diagrams[0]
  if (!diagram || !diagram.nodes.length) return auto
  const byTag = new Map(tables.filter((t) => t.lineageTag).map((t) => [t.lineageTag!, t.name]))
  const known = new Set(tables.map((t) => t.name))
  const out: DiagramNode[] = []
  const seen = new Set<string>()
  for (const n of diagram.nodes) {
    const name = known.has(n.nodeIndex) ? n.nodeIndex : n.nodeLineageTag ? byTag.get(n.nodeLineageTag) : undefined
    if (!name || seen.has(name)) continue
    // nodes without a usable location (PBI sometimes writes `location: {}`) are placed like missing ones
    if (!Number.isFinite(n.location?.x) || !Number.isFinite(n.location?.y)) continue
    seen.add(name)
    out.push({ ...n, nodeIndex: name, size: { width: n.size?.width || DEFAULT_CARD_WIDTH, height: n.size?.height || DEFAULT_CARD_HEIGHT } })
  }
  const isAll = (diagram.ordinal ?? 0) === 0 || diagram.name === 'All tables'
  if (isAll) {
    const missing = tables.filter((t) => !seen.has(t.name))
    if (missing.length) {
      const maxX = Math.max(0, ...out.map((n) => n.location.x + n.size.width))
      missing.forEach((t, i) => {
        out.push({ location: { x: maxX + 80 + (i % 4) * (DEFAULT_CARD_WIDTH + 60), y: Math.floor(i / 4) * (DEFAULT_CARD_HEIGHT + 60) }, nodeIndex: t.name, nodeLineageTag: t.lineageTag, size: { width: DEFAULT_CARD_WIDTH, height: defaultCardHeight(t) }, zIndex: out.length })
      })
    }
  }
  return out
}

/**
 * Return an updated layout with the given node positions/sizes written into diagram `diagramName`
 * (created — as "All tables" with ordinal 0 — when the layout or diagram doesn't exist yet).
 */
export function updateLayoutNodes(layout: DiagramLayout | null, diagramName: string, nodes: DiagramNode[]): DiagramLayout {
  const base: DiagramLayout = layout ? structuredClone(layout) : { version: '1.1.0', diagrams: [], selectedDiagram: diagramName, defaultDiagram: diagramName }
  let d = base.diagrams.find((x) => x.name === diagramName)
  if (!d) {
    d = {
      ordinal: base.diagrams.length,
      scrollPosition: { x: 0, y: 0 },
      nodes: [],
      name: diagramName,
      zoomValue: 100,
      pinKeyFieldsToTop: false,
      showExtraHeaderInfo: false,
      hideKeyFieldsWhenCollapsed: false,
      tablesLocked: false
    }
    base.diagrams.push(d)
  }
  const byName = new Map(d.nodes.map((n) => [n.nodeIndex, n]))
  for (const n of nodes) {
    const existing = byName.get(n.nodeIndex)
    const valid = Number.isFinite(n.location?.x) && Number.isFinite(n.location?.y)
    const loc = valid ? { x: round(n.location.x), y: round(n.location.y) } : n.location
    if (existing) {
      existing.location = loc
      existing.size = { height: round(n.size.height), width: round(n.size.width) }
      if (n.nodeLineageTag && !existing.nodeLineageTag) existing.nodeLineageTag = n.nodeLineageTag
    } else {
      const node: DiagramNode = { location: loc, nodeIndex: n.nodeIndex, size: { height: round(n.size.height), width: round(n.size.width) }, zIndex: d.nodes.length }
      if (n.nodeLineageTag) node.nodeLineageTag = n.nodeLineageTag
      d.nodes.push(node)
      byName.set(n.nodeIndex, node)
    }
  }
  return base
}

const round = (v: number): number => Math.round(v * 1000) / 1000

/** Add a new custom layout ("Layout 1", …) containing the given tables. */
export function addDiagram(layout: DiagramLayout | null, name: string, nodes: DiagramNode[]): DiagramLayout {
  const next = updateLayoutNodes(layout, name, nodes)
  if (!layout) {
    // a fresh layout must keep "All tables" first
    next.diagrams.unshift({ ordinal: 0, scrollPosition: { x: 0, y: 0 }, nodes: [], name: 'All tables', zoomValue: 100, pinKeyFieldsToTop: false, showExtraHeaderInfo: false, hideKeyFieldsWhenCollapsed: false, tablesLocked: false })
    next.diagrams.forEach((d, i) => (d.ordinal = i))
    next.defaultDiagram = 'All tables'
  }
  next.selectedDiagram = name
  return next
}
