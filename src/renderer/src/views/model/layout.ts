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
import { arrange, suggestArrangement, tableInfo, type ArrangeInput } from './arrange'
import { cloneDeep } from '@core/clone'

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
  return parseLayout(model.sidecarFiles?.[LAYOUT_FILE])
}

/** Parse `diagramLayout.json` text (null when missing or not a diagram layout). */
export function parseLayout(raw: string | undefined | null): DiagramLayout | null {
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
 * Auto-layout of a diagram that stores no positions (no `diagramLayout.json`): the arrangement Auto arrange would
 * suggest for the model's shape (see ./arrange — star / snowflake for a few facts, layered for many, a grid without
 * relationships), with Power BI's default card size. Tables without relationships go in a block at the right.
 */
export function autoLayout(model: SemanticModel, gap = 60): DiagramNode[] {
  const tables = diagramTables(model)
  const names = new Set(tables.map((t) => t.name))
  const input: ArrangeInput = {
    tables: tables.map((t) => ({ name: t.name, width: DEFAULT_CARD_WIDTH, height: defaultCardHeight(t), info: tableInfo(t) })),
    links: model.relationships
      .filter((r) => names.has(r.fromTable) && names.has(r.toTable))
      .map((r) => ({ from: r.fromTable, to: r.toTable, fromMany: r.fromCardinality === 'many', toMany: r.toCardinality === 'many', both: r.crossFilteringBehavior === 'bothDirections' }))
  }
  const result = arrange(input, suggestArrangement(input), { gapX: gap, gapY: gap * 1.5 })
  return tables.map((t, i) => {
    const p = result.positions.get(t.name) ?? { x: 0, y: 0 }
    return { location: { x: p.x, y: p.y }, nodeIndex: t.name, nodeLineageTag: t.lineageTag, size: { height: defaultCardHeight(t), width: DEFAULT_CARD_WIDTH }, zIndex: i }
  })
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
  const base: DiagramLayout = layout ? cloneDeep(layout) : { version: '1.1.0', diagrams: [], selectedDiagram: diagramName, defaultDiagram: diagramName }
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
