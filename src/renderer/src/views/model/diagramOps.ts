/**
 * Edits of a diagram's Lumen data (line routing + table groups) — pure functions over `LumenDiagram`
 * (see @core/io/diagramSidecar). The view applies them to a copy inside one undoable store edit.
 */
import type { GroupBounds, GroupColor, GroupDef, GroupMember, LineStyle, LumenDiagram, RouteDef } from '@core/io/diagramSidecar'
import { isRouteEmpty, newGroupIdentity } from '@core/io/diagramSidecar'
import { translateRoute } from './routing'

/**
 * Built-in line style, used when neither the relationship, nor its layout, nor the user's preference
 * (diagramPrefs) says otherwise: straight lines, as the diagram drew them before line styles existed
 * (a project without the sidecar looks the same as before).
 */
export const DEFAULT_LINE_STYLE: LineStyle = 'straight'

export function groupOf(d: LumenDiagram, table: string): GroupDef | undefined {
  return d.groups?.find((g) => g.tables.some((m) => m.name === table))
}

const member = (name: string, tags: ReadonlyMap<string, string | undefined>): GroupMember => {
  const tag = tags.get(name)
  return tag ? { name, lineageTag: tag } : { name }
}

function dropEmptyGroups(d: LumenDiagram): void {
  if (!d.groups) return
  d.groups = d.groups.filter((g) => g.tables.length)
  if (!d.groups.length) delete d.groups
}

/**
 * Put `tables` into a new group (they leave the groups they were in; groups left empty disappear).
 * Returns the new group's id, or null when there is nothing to group.
 */
export function createGroup(d: LumenDiagram, tables: string[], tags: ReadonlyMap<string, string | undefined>, name?: string): string | null {
  const names = [...new Set(tables)]
  if (!names.length) return null
  const identity = newGroupIdentity(d)
  for (const g of d.groups ?? []) g.tables = g.tables.filter((m) => !names.includes(m.name))
  ;(d.groups ??= []).push({ id: identity.id, name: name?.trim() || identity.name, tables: names.map((n) => member(n, tags)) })
  dropEmptyGroups(d)
  return identity.id
}

/** Remove containers (their tables stay where they are). */
export function ungroup(d: LumenDiagram, ids: string[]): void {
  if (!d.groups) return
  d.groups = d.groups.filter((g) => !ids.includes(g.id))
  if (!d.groups.length) delete d.groups
}

/** Move tables between groups: table → group id (null = no group). Groups left empty disappear. */
export function setMembership(d: LumenDiagram, changes: ReadonlyMap<string, string | null>, tags: ReadonlyMap<string, string | undefined>): void {
  for (const [table, target] of changes) {
    const current = groupOf(d, table)
    if ((current?.id ?? null) === target) continue
    if (current) {
      current.tables = current.tables.filter((m) => m.name !== table)
      // a manual extent was drawn around the old membership: let the container fit again
      delete current.bounds
    }
    const g = target ? d.groups?.find((x) => x.id === target) : undefined
    if (g) g.tables.push(member(table, tags))
  }
  dropEmptyGroups(d)
}

export function patchGroup(d: LumenDiagram, id: string, patch: { name?: string; color?: GroupColor; collapsed?: boolean; bounds?: GroupBounds | null }): void {
  const g = d.groups?.find((x) => x.id === id)
  if (!g) return
  if (patch.name !== undefined && patch.name.trim()) g.name = patch.name.trim()
  if (patch.color !== undefined) {
    if (patch.color === 'gray') delete g.color
    else g.color = patch.color
  }
  if (patch.collapsed !== undefined) {
    if (patch.collapsed) g.collapsed = true
    else delete g.collapsed
  }
  if (patch.bounds !== undefined) {
    if (patch.bounds) g.bounds = patch.bounds
    else delete g.bounds
  }
}

/** Store (or, when empty, forget) the routing of one relationship. */
export function setRoute(d: LumenDiagram, relationship: string, route: RouteDef | undefined): void {
  if (!route || isRouteEmpty(route)) {
    if (d.routes) {
      delete d.routes[relationship]
      if (!Object.keys(d.routes).length) delete d.routes
    }
    return
  }
  ;(d.routes ??= {})[relationship] = route
}

/**
 * Layout default line style. A style equal to `fallback` (what the layout would use anyway: the user's
 * preferred default, else the built-in one) is not stored.
 */
export function setLineStyle(d: LumenDiagram, style: LineStyle, fallback: LineStyle = DEFAULT_LINE_STYLE): void {
  if (style === fallback) delete d.lineStyle
  else d.lineStyle = style
}

/** The style a relationship line is drawn in: its own override, else the layout default, else `fallback`. */
export function effectiveStyle(d: LumenDiagram, route: RouteDef | undefined, fallback: LineStyle = DEFAULT_LINE_STYLE): LineStyle {
  return route?.style ?? d.lineStyle ?? fallback
}

/**
 * What follows a set of cards moved together by (dx, dy):
 *  - waypoints of relationships whose BOTH tables move travel with them (a line keeps its shape when its two
 *    cards, a multi-selection or a whole group is moved). When only one end moves, the waypoints stay where
 *    the user put them and the line re-attaches to the moved card;
 *  - the manual extent of a group whose members all move.
 * Returns only the entries that change.
 */
export function followMove(d: LumenDiagram, moving: ReadonlySet<string>, dx: number, dy: number, relationships: ReadonlyArray<{ name: string; fromTable: string; toTable: string }>): { routes: Record<string, RouteDef>; bounds: Record<string, GroupBounds> } {
  const routes: Record<string, RouteDef> = {}
  const bounds: Record<string, GroupBounds> = {}
  if (dx === 0 && dy === 0) return { routes, bounds }
  for (const r of relationships) {
    const route = d.routes?.[r.name]
    if (route?.waypoints?.length && moving.has(r.fromTable) && moving.has(r.toTable)) routes[r.name] = translateRoute(route, dx, dy)
  }
  for (const g of d.groups ?? []) {
    if (g.bounds && g.tables.length && g.tables.every((m) => moving.has(m.name))) bounds[g.id] = { ...g.bounds, x: g.bounds.x + dx, y: g.bounds.y + dy }
  }
  return { routes, bounds }
}

/** Apply a `followMove` result to the diagram. */
export function applyFollow(d: LumenDiagram, follow: { routes: Record<string, RouteDef>; bounds: Record<string, GroupBounds> }): void {
  for (const [k, r] of Object.entries(follow.routes)) setRoute(d, k, r)
  for (const [id, b] of Object.entries(follow.bounds)) patchGroup(d, id, { bounds: b })
}
