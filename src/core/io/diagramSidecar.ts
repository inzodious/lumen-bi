/**
 * Lumen's own model-diagram data: `diagramLayout.lumen.json`, a sidecar stored beside Power BI's
 * `diagramLayout.json` in the `*.SemanticModel` folder (and therefore in `.wbi` bundles, which embed the PBIP
 * file map). Power BI Desktop neither reads nor rewrites the file, so the project stays valid there; Lumen
 * writes it only once the user customised a diagram, and removes it again when nothing custom is left, so an
 * untouched model keeps round-tripping byte-identically.
 *
 * Format (version 1) — one entry per diagram layout tab, matched to `diagramLayout.json` by `name`:
 *
 *   {
 *     "$lumen": "diagramLayout",
 *     "version": 1,
 *     "diagrams": [
 *       {
 *         "name": "All tables",
 *         "lineStyle": "curved",                     // layout default: curved | orthogonal | straight
 *         "routes": {
 *           "<relationship name>": {
 *             "style": "orthogonal",                 // per-relationship override (optional)
 *             "waypoints": [{ "x": 320, "y": 180 }], // pinch points, diagram coordinates, from → to order
 *             "from": { "side": "right", "t": 0.5 }, // manual attachment on the from-table card (optional)
 *             "to": { "side": "left", "t": 0.25 }    //   side + position along that side (0 = top/left, 1 = bottom/right)
 *           }
 *         },
 *         "groups": [
 *           {
 *             "id": "g1", "name": "Dimensions", "color": "gray",
 *             "tables": [{ "name": "Date", "lineageTag": "…" }],
 *             "collapsed": false,
 *             "bounds": { "x": 0, "y": 0, "width": 600, "height": 400 }   // only after a manual resize
 *           }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Unknown properties are preserved at every level (a newer Lumen's data survives an older one's save).
 * Stale references are tolerated on read (`resolveLumenDiagram`) and removed on the next write (`pruneLumenDiagram`);
 * in-app renames and deletions are followed immediately (`reconcileLumenSidecar`, called by the store).
 *
 * Pure TypeScript: no DOM, no Node APIs.
 */
import type { RelationshipDef, SemanticModel } from '../model/types'

export const LUMEN_LAYOUT_FILE = 'diagramLayout.lumen.json'
export const LUMEN_LAYOUT_VERSION = 1

export type LineStyle = 'curved' | 'orthogonal' | 'straight'
export const LINE_STYLES: readonly LineStyle[] = ['curved', 'orthogonal', 'straight']

export type AnchorSide = 'left' | 'right' | 'top' | 'bottom'
const SIDES: readonly AnchorSide[] = ['left', 'right', 'top', 'bottom']

/** Where a line attaches on a table card: a side and the position along it (0 = top/left … 1 = bottom/right). */
export interface RouteAnchor {
  side: AnchorSide
  t: number
}

export interface RoutePoint {
  x: number
  y: number
}

export interface RouteDef {
  style?: LineStyle
  /** pinch points in diagram coordinates, ordered from the relationship's from-table to its to-table */
  waypoints?: RoutePoint[]
  from?: RouteAnchor
  to?: RouteAnchor
  [k: string]: unknown
}

export const GROUP_COLORS = ['gray', 'blue', 'teal', 'green', 'amber', 'rose', 'purple'] as const
export type GroupColor = (typeof GROUP_COLORS)[number]

export interface GroupMember {
  name: string
  /** the table's lineage tag when it has one: lets a group follow a rename made outside Lumen */
  lineageTag?: string
}

export interface GroupBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface GroupDef {
  id: string
  name: string
  color?: GroupColor
  tables: GroupMember[]
  collapsed?: boolean
  /** manual extent (resize handles); the container is never smaller than its members need */
  bounds?: GroupBounds
  [k: string]: unknown
}

export interface LumenDiagram {
  name: string
  lineStyle?: LineStyle
  routes?: Record<string, RouteDef>
  groups?: GroupDef[]
  [k: string]: unknown
}

export interface LumenLayout {
  version: number
  diagrams: LumenDiagram[]
  [k: string]: unknown
}

// ---------------------------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Accepted spellings of a line style (older drafts of the format / hand-edited files). */
function lineStyle(v: unknown): LineStyle | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.toLowerCase()
  if (s === 'curved' || s === 'bezier' || s === 'smooth' || s === 'curve') return 'curved'
  if (s === 'orthogonal' || s === 'elbow' || s === 'step') return 'orthogonal'
  if (s === 'straight' || s === 'line' || s === 'direct') return 'straight'
  return undefined
}

function point(v: unknown): RoutePoint | undefined {
  if (Array.isArray(v) && num(v[0]) && num(v[1])) return { x: v[0], y: v[1] }
  if (isObj(v) && num(v['x']) && num(v['y'])) return { ...v, x: v['x'], y: v['y'] } as RoutePoint
  return undefined
}

function anchor(v: unknown): RouteAnchor | undefined {
  if (!isObj(v) || !SIDES.includes(v['side'] as AnchorSide)) return undefined
  const t = num(v['t']) ? Math.min(1, Math.max(0, v['t'])) : 0.5
  return { ...v, side: v['side'] as AnchorSide, t }
}

function route(v: unknown): RouteDef | undefined {
  if (!isObj(v)) return undefined
  const { style: _s, waypoints: _w, from: _f, to: _t, ...rest } = v
  const out: RouteDef = { ...rest }
  const st = lineStyle(v['style'])
  if (st) out.style = st
  const wps = Array.isArray(v['waypoints']) ? v['waypoints'].map(point).filter((p): p is RoutePoint => !!p) : []
  if (wps.length) out.waypoints = wps
  const from = anchor(v['from'])
  if (from) out.from = from
  const to = anchor(v['to'])
  if (to) out.to = to
  return out
}

function member(v: unknown): GroupMember | undefined {
  if (typeof v === 'string' && v) return { name: v }
  if (isObj(v) && typeof v['name'] === 'string' && v['name']) {
    const m: GroupMember = { ...v, name: v['name'] }
    if (typeof v['lineageTag'] !== 'string' || !v['lineageTag']) delete m.lineageTag
    return m
  }
  return undefined
}

function group(v: unknown, used: Set<string>): GroupDef | undefined {
  if (!isObj(v)) return undefined
  const { bounds: _b, color: _c, collapsed: _col, ...rest } = v
  let id = typeof v['id'] === 'string' && v['id'] ? v['id'] : ''
  if (!id || used.has(id)) id = nextGroupId(used)
  used.add(id)
  const seen = new Set<string>()
  const tables = (Array.isArray(v['tables']) ? v['tables'] : []).map(member).filter((m): m is GroupMember => !!m && !seen.has(m.name) && !!seen.add(m.name))
  const out: GroupDef = { ...rest, id, name: typeof v['name'] === 'string' && v['name'].trim() ? v['name'] : 'Group', tables }
  if (GROUP_COLORS.includes(v['color'] as GroupColor) && v['color'] !== 'gray') out.color = v['color'] as GroupColor
  if (v['collapsed'] === true) out.collapsed = true
  const b = v['bounds']
  if (isObj(b) && num(b['x']) && num(b['y']) && num(b['width']) && num(b['height']) && b['width'] > 0 && b['height'] > 0) out.bounds = { x: b['x'], y: b['y'], width: b['width'], height: b['height'] }
  return out
}

function nextGroupId(used: Set<string>): string {
  let n = 1
  while (used.has(`g${n}`)) n++
  return `g${n}`
}

function diagram(v: unknown, fallbackName?: string): LumenDiagram | undefined {
  if (!isObj(v)) return undefined
  const name = typeof v['name'] === 'string' && v['name'] ? v['name'] : fallbackName
  if (!name) return undefined
  const { lineStyle: _l, routes: _r, groups: _g, ...rest } = v
  const out: LumenDiagram = { ...rest, name }
  const st = lineStyle(v['lineStyle'])
  if (st) out.lineStyle = st
  if (isObj(v['routes'])) {
    const routes: Record<string, RouteDef> = {}
    for (const [k, r] of Object.entries(v['routes'])) {
      const parsed = route(r)
      if (parsed) routes[k] = parsed
    }
    if (Object.keys(routes).length) out.routes = routes
  }
  if (Array.isArray(v['groups'])) {
    const used = new Set<string>()
    const owned = new Set<string>()
    const groups: GroupDef[] = []
    for (const g of v['groups']) {
      const parsed = group(g, used)
      if (!parsed) continue
      // a table belongs to one group: the first one that lists it wins
      parsed.tables = parsed.tables.filter((m) => !owned.has(m.name) && !!owned.add(m.name))
      groups.push(parsed)
    }
    if (groups.length) out.groups = groups
  }
  return out
}

/**
 * Bring any accepted shape of the file to the current version. Returns null when the JSON is not a Lumen
 * diagram layout at all. Shapes understood:
 *   - version 1 (current);
 *   - version 0 (pre-release drafts): `diagrams` as an object keyed by diagram name, waypoints as `[x, y]` pairs,
 *     group tables as plain names, style aliases ("bezier", "elbow");
 *   - a higher version written by a newer Lumen: read best-effort, version number and unknown properties kept.
 */
export function migrateLumenLayout(json: unknown): LumenLayout | null {
  if (!isObj(json)) return null
  const raw = json['diagrams']
  let list: LumenDiagram[]
  if (Array.isArray(raw)) list = raw.map((d) => diagram(d)).filter((d): d is LumenDiagram => !!d)
  else if (isObj(raw)) list = Object.entries(raw).map(([name, d]) => diagram(isObj(d) ? { ...d, name } : d, name)).filter((d): d is LumenDiagram => !!d)
  else return null
  // one entry per diagram name (first wins)
  const names = new Set<string>()
  list = list.filter((d) => !names.has(d.name) && !!names.add(d.name))
  const version = num(json['version']) && json['version'] > LUMEN_LAYOUT_VERSION ? json['version'] : LUMEN_LAYOUT_VERSION
  return { ...json, version, diagrams: list }
}

/** Parse the sidecar text; null when missing, unparsable or not a Lumen diagram layout. */
export function parseLumenLayout(text: string | undefined | null): LumenLayout | null {
  if (!text) return null
  try {
    return migrateLumenLayout(JSON.parse(text))
  } catch {
    return null
  }
}

export function readLumenLayout(model: SemanticModel): LumenLayout | null {
  return parseLumenLayout(model.sidecarFiles?.[LUMEN_LAYOUT_FILE])
}

/** The entry for a diagram layout tab (an empty one when nothing is stored for it). */
export function lumenDiagram(layout: LumenLayout | null, name: string): LumenDiagram {
  return layout?.diagrams.find((d) => d.name === name) ?? { name }
}

// ---------------------------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------------------------

const round = (v: number): number => Math.round(v * 100) / 100

export function isRouteEmpty(r: RouteDef | undefined): boolean {
  if (!r) return true
  const { style, waypoints, from, to, ...rest } = r
  return !style && !waypoints?.length && !from && !to && !Object.keys(rest).length
}

function cleanRoute(r: RouteDef): RouteDef | undefined {
  if (isRouteEmpty(r)) return undefined
  const { style, waypoints, from, to, ...rest } = r
  const out: RouteDef = {}
  if (style) out.style = style
  if (waypoints?.length) out.waypoints = waypoints.map((p) => ({ ...p, x: round(p.x), y: round(p.y) }))
  if (from) out.from = { ...from, t: Math.round(from.t * 10000) / 10000 }
  if (to) out.to = { ...to, t: Math.round(to.t * 10000) / 10000 }
  return { ...out, ...rest }
}

function cleanDiagram(d: LumenDiagram): LumenDiagram | undefined {
  const { name, lineStyle: ls, routes, groups, ...rest } = d
  const out: LumenDiagram = { name }
  if (ls) out.lineStyle = ls
  const rs: Record<string, RouteDef> = {}
  for (const k of Object.keys(routes ?? {}).sort()) {
    const c = cleanRoute(routes![k])
    if (c) rs[k] = c
  }
  if (Object.keys(rs).length) out.routes = rs
  const gs = (groups ?? [])
    .filter((g) => g.tables.length)
    .map((g) => {
      const { id, name: gname, color, tables, collapsed, bounds, ...grest } = g
      const o: GroupDef = { id, name: gname, tables: tables.map((m) => {
        const { lineageTag, ...mrest } = m
        return lineageTag ? { ...mrest, lineageTag } : mrest
      }) }
      if (color && color !== 'gray') o.color = color
      if (collapsed) o.collapsed = true
      if (bounds) o.bounds = { x: round(bounds.x), y: round(bounds.y), width: round(bounds.width), height: round(bounds.height) }
      return { ...o, ...grest }
    })
  if (gs.length) out.groups = gs
  const full = { ...out, ...rest }
  return Object.keys(full).length > 1 ? full : undefined
}

/**
 * Sidecar text for `layout`, or null when nothing custom is left (the file is then removed, so the project
 * looks exactly like one Lumen never customised).
 */
export function serializeLumenLayout(layout: LumenLayout | null): string | null {
  if (!layout) return null
  const diagrams = layout.diagrams.map(cleanDiagram).filter((d): d is LumenDiagram => !!d)
  if (!diagrams.length) return null
  const { version, diagrams: _d, $lumen: _l, ...rest } = layout
  return JSON.stringify({ $lumen: 'diagramLayout', version: Math.max(LUMEN_LAYOUT_VERSION, version || 0), diagrams, ...rest }, null, 2)
}

/** A copy of `layout` with diagram `name` edited by `edit` (the entry is created when missing). */
export function updateLumenDiagram(layout: LumenLayout | null, name: string, edit: (d: LumenDiagram) => void): LumenLayout {
  const next: LumenLayout = layout ? structuredClone(layout) : { version: LUMEN_LAYOUT_VERSION, diagrams: [] }
  let d = next.diagrams.find((x) => x.name === name)
  if (!d) {
    d = { name }
    next.diagrams.push(d)
  }
  edit(d)
  return next
}

export function removeLumenDiagram(layout: LumenLayout | null, name: string): LumenLayout | null {
  if (!layout) return null
  return { ...layout, diagrams: layout.diagrams.filter((d) => d.name !== name) }
}

/** Next free group id / default name ("Group 1", "Group 2", …) in a diagram. */
export function newGroupIdentity(d: LumenDiagram): { id: string; name: string } {
  const ids = new Set((d.groups ?? []).map((g) => g.id))
  const names = new Set((d.groups ?? []).map((g) => g.name))
  let n = 1
  while (names.has(`Group ${n}`)) n++
  return { id: nextGroupId(ids), name: `Group ${n}` }
}

// ---------------------------------------------------------------------------------------------
// stale references
// ---------------------------------------------------------------------------------------------

/**
 * The diagram as it applies to `model` right now, without changing what is stored: routes of relationships
 * that no longer exist are left out; group members are matched by table name, then by lineage tag (a table
 * renamed outside Lumen keeps its place), and unknown ones are left out; empty groups disappear.
 */
export function resolveLumenDiagram(d: LumenDiagram, model: SemanticModel): LumenDiagram {
  const tables = new Set(model.tables.map((t) => t.name))
  const byTag = new Map(model.tables.filter((t) => t.lineageTag).map((t) => [t.lineageTag!, t.name]))
  const rels = new Set(model.relationships.map((r) => r.name))
  const out: LumenDiagram = { ...d }
  if (d.routes) {
    const routes: Record<string, RouteDef> = {}
    for (const [k, r] of Object.entries(d.routes)) if (rels.has(k)) routes[k] = r
    out.routes = routes
  }
  if (d.groups) {
    const owned = new Set<string>()
    out.groups = d.groups
      .map((g) => {
        const members: GroupMember[] = []
        for (const m of g.tables) {
          const name = tables.has(m.name) ? m.name : m.lineageTag ? byTag.get(m.lineageTag) : undefined
          if (!name || owned.has(name)) continue
          owned.add(name)
          members.push(name === m.name ? m : { ...m, name })
        }
        return { ...g, tables: members }
      })
      .filter((g) => g.tables.length)
  }
  return out
}

/** Drop stale entries for good (called before a write) and refresh the members' lineage tags. */
export function pruneLumenDiagram(d: LumenDiagram, model: SemanticModel): void {
  const r = resolveLumenDiagram(d, model)
  const tags = new Map(model.tables.map((t) => [t.name, t.lineageTag]))
  if (r.routes && Object.keys(r.routes).length) d.routes = r.routes
  else delete d.routes
  if (r.groups?.length)
    d.groups = r.groups.map((g) => ({
      ...g,
      tables: g.tables.map((m) => {
        const tag = tags.get(m.name)
        const next: GroupMember = { ...m }
        if (tag) next.lineageTag = tag
        else delete next.lineageTag
        return next
      })
    }))
  else delete d.groups
}

const endpoints = (r: RelationshipDef, rename: Map<string, string>): string => {
  const t = (n: string): string => rename.get(n) ?? n
  const a = `${t(r.fromTable)}\u0001${r.fromColumn}`
  const b = `${t(r.toTable)}\u0001${r.toColumn}`
  return a < b ? `${a}\u0002${b}` : `${b}\u0002${a}`
}

/**
 * What changed between two versions of a model that the diagram data refers to: tables renamed (matched by
 * lineage tag, else by position when exactly the name changed in place) or deleted, relationships deleted or
 * replaced by a new one over the same columns (edit dialogs may recreate them under a new name).
 */
export function diffModelRefs(prev: SemanticModel, next: SemanticModel): { tableRenames: Map<string, string>; tablesDeleted: Set<string>; relRenames: Map<string, string>; relsDeleted: Set<string> } {
  const tableRenames = new Map<string, string>()
  const tablesDeleted = new Set<string>()
  const relRenames = new Map<string, string>()
  const relsDeleted = new Set<string>()
  if (prev.tables !== next.tables) {
    const before = new Set(prev.tables.map((t) => t.name))
    const after = new Set(next.tables.map((t) => t.name))
    const added = next.tables.filter((t) => !before.has(t.name))
    const taken = new Set<string>()
    prev.tables.forEach((t, i) => {
      if (after.has(t.name)) return
      let target = t.lineageTag ? added.find((n) => n.lineageTag === t.lineageTag && !taken.has(n.name)) : undefined
      if (!target && prev.tables.length === next.tables.length) {
        const same = next.tables[i]
        if (same && !before.has(same.name) && !taken.has(same.name) && (!same.lineageTag || !t.lineageTag || same.lineageTag === t.lineageTag)) target = same
      }
      if (target) {
        taken.add(target.name)
        tableRenames.set(t.name, target.name)
      } else tablesDeleted.add(t.name)
    })
  }
  if (prev.relationships !== next.relationships) {
    const before = new Set(prev.relationships.map((r) => r.name))
    const after = new Set(next.relationships.map((r) => r.name))
    const added = next.relationships.filter((r) => !before.has(r.name))
    const taken = new Set<string>()
    for (const r of prev.relationships) {
      if (after.has(r.name)) continue
      const key = endpoints(r, tableRenames)
      const target = added.find((n) => !taken.has(n.name) && endpoints(n, new Map()) === key)
      if (target) {
        taken.add(target.name)
        relRenames.set(r.name, target.name)
      } else relsDeleted.add(r.name)
    }
  }
  return { tableRenames, tablesDeleted, relRenames, relsDeleted }
}

/**
 * Keep the sidecar in step with a model edit: renamed tables keep their group membership, renamed/recreated
 * relationships keep their routing, deleted ones are removed (a group left without tables goes too).
 * Returns the new sidecar text, `null` when the file should be removed, or `undefined` when nothing changes.
 */
export function reconcileLumenSidecar(prev: SemanticModel, next: SemanticModel): string | null | undefined {
  const text = next.sidecarFiles?.[LUMEN_LAYOUT_FILE]
  if (!text || (prev.tables === next.tables && prev.relationships === next.relationships)) return undefined
  const { tableRenames, tablesDeleted, relRenames, relsDeleted } = diffModelRefs(prev, next)
  if (!tableRenames.size && !tablesDeleted.size && !relRenames.size && !relsDeleted.size) return undefined
  const layout = parseLumenLayout(text)
  if (!layout) return undefined
  let changed = false
  for (const d of layout.diagrams) {
    if (d.routes) {
      for (const k of Object.keys(d.routes)) {
        if (relsDeleted.has(k)) {
          delete d.routes[k]
          changed = true
        } else if (relRenames.has(k)) {
          d.routes[relRenames.get(k)!] = d.routes[k]
          delete d.routes[k]
          changed = true
        }
      }
    }
    if (d.groups) {
      for (const g of d.groups) {
        const tables: GroupMember[] = []
        for (const m of g.tables) {
          if (tablesDeleted.has(m.name)) changed = true
          else if (tableRenames.has(m.name)) {
            tables.push({ ...m, name: tableRenames.get(m.name)! })
            changed = true
          } else tables.push(m)
        }
        g.tables = tables
      }
    }
  }
  if (!changed) return undefined
  return serializeLumenLayout(layout)
}

/**
 * `next` with its Lumen sidecar reconciled against the edit that turned `prev` into it (see
 * `reconcileLumenSidecar`); returns `next` itself when nothing the diagram data refers to changed.
 * Both models must be finished objects (not immer drafts): unchanged parts are recognised by identity.
 */
export function withReconciledSidecars(prev: SemanticModel, next: SemanticModel): SemanticModel {
  const r = reconcileLumenSidecar(prev, next)
  if (r === undefined) return next
  const sidecarFiles = { ...(next.sidecarFiles ?? {}) }
  if (r === null) delete sidecarFiles[LUMEN_LAYOUT_FILE]
  else sidecarFiles[LUMEN_LAYOUT_FILE] = r
  return { ...next, sidecarFiles }
}
