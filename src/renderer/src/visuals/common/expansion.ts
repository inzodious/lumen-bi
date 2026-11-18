/**
 * Expand / collapse state of hierarchies shown with +/- icons (matrix Rows and Columns, hierarchy slicer
 * Values), stored like Power BI stores it in `visual.expansionStates`:
 *
 *   [{ roles: ['Rows'],
 *      levels: [{ queryRefs: ['T.Level1'], isCollapsed: true, identityKeys: [<field expr>], isPinned: true }, …],
 *      root: { children: [{ identityValues: [{ Literal: { Value: "'A'" } }], isToggled: true, children: […] }] } }]
 *
 * A level is expanded by default unless it has `isCollapsed`; a node with `isToggled` is in the opposite
 * state of its level. A node's `identityValues` hold its own level's value (files written by earlier Lumen
 * versions hold the whole path — both are read). Power BI also keeps the `active` flag of the role's
 * projections in step: a level is active (queried) when something above it is expanded.
 *
 * Pure (no React / engine); the context-menu commands Expand ▸ / Collapse ▸ (Selection · Entire level · All)
 * and the +/- icons are implemented with these functions.
 */
import { decodeLiteral, encodeLiteral } from '@core/report/literal'
import type { Scalar } from '@core/model/data'

export type ExpansionRole = 'Rows' | 'Columns' | 'Values'

export interface ExpansionState {
  /** default state per level (index = level; the last level has no children) */
  levelExpanded: boolean[]
  /** path keys of the nodes whose state is the opposite of their level's default */
  toggled: Set<string>
}

/** Same key as the matrix / slicer models use for a node path. */
export function expansionPathKey(path: Scalar[]): string {
  return path.map((v) => (v instanceof Date ? 'd' + v.getTime() : v instanceof Uint8Array ? 'b' : JSON.stringify(v))).join('\u0001')
}

function stateOf(visualJson: any, role: ExpansionRole): any | undefined {
  const states: any[] = visualJson?.visual?.expansionStates ?? []
  return states.find((s) => (s?.roles ?? []).includes(role))
}

function decodeIdentityValue(iv: any): Scalar {
  const lit = iv?.Literal ?? iv?.expr?.Literal
  return lit ? decodeLiteral(lit.Value) : null
}

/** Paths of the toggled nodes. */
export function readToggledPaths(visualJson: any, role: ExpansionRole): Scalar[][] {
  const out: Scalar[][] = []
  const walk = (node: any, prefix: Scalar[]) => {
    for (const c of node?.children ?? []) {
      const vals: Scalar[] = (c.identityValues ?? []).map(decodeIdentityValue)
      // own value(s) (Power BI) or the whole path (earlier Lumen versions)
      const full = vals.length > prefix.length ? vals : [...prefix, ...vals]
      if (c.isToggled) out.push(full)
      walk(c, full)
    }
  }
  const st = stateOf(visualJson, role)
  if (st?.root) walk(st.root, [])
  return out
}

/**
 * Read the expansion state of a role. `fallback(level)` gives the default of a level the file says nothing
 * about (no `expansionStates` entry for the role, or the level isn't listed).
 */
export function readExpansion(visualJson: any, role: ExpansionRole, queryRefs: string[], fallback: (level: number) => boolean): ExpansionState {
  const st = stateOf(visualJson, role)
  const levels: any[] = st?.levels ?? []
  // Power BI marks collapsed levels (at least the last one); an entry without any `isCollapsed` is either a fully
  // expanded hierarchy or was written by an earlier Lumen version (which never wrote the flag): `fallback` decides.
  const explicit = levels.some((l) => l?.isCollapsed === true)
  const levelExpanded = queryRefs.map((ref, i) => {
    if (i >= queryRefs.length - 1) return false
    const l = explicit ? levels.find((x) => (x?.queryRefs ?? []).includes(ref)) : undefined
    return l ? l.isCollapsed !== true : fallback(i)
  })
  return { levelExpanded, toggled: new Set(readToggledPaths(visualJson, role).map(expansionPathKey)) }
}

/** Is the node at `path` expanded? */
export function isExpanded(state: ExpansionState, path: Scalar[]): boolean {
  const level = path.length - 1
  if (level < 0 || level >= state.levelExpanded.length - 1) return false
  return state.levelExpanded[level] !== state.toggled.has(expansionPathKey(path))
}

export interface ExpansionLevel {
  queryRef: string
  /** the level's field (written as `identityKeys`) */
  expr?: unknown
}

/**
 * Write an expansion state back into the visual JSON (mutates): `expansionStates` entry of the role and the
 * `active` flags of the role's projections from `firstLevel` on (the levels before it are drilled past and
 * keep their flags).
 */
export function writeExpansion(visualJson: any, role: ExpansionRole, levels: ExpansionLevel[], state: ExpansionState, toggledPaths: Scalar[][]): void {
  const v = visualJson.visual
  if (!v) return
  v.expansionStates ??= []
  let st = v.expansionStates.find((s: any) => (s?.roles ?? []).includes(role))
  if (!st) {
    st = { roles: [role], levels: [], root: {} }
    v.expansionStates.push(st)
  }
  const old: any[] = st.levels ?? []
  const wasExplicit = old.some((l) => l?.isCollapsed === true)
  const refs = new Set(levels.map((l) => l.queryRef))
  st.levels = [
    // levels of the role that aren't shown right now (drilled past) keep their entry
    ...old.filter((l) => !(l?.queryRefs ?? []).some((q: string) => refs.has(q))),
    ...levels.map((l, i) => {
      const prev = old.find((x) => (x?.queryRefs ?? []).includes(l.queryRef)) ?? {}
      const out: any = { ...prev, queryRefs: prev.queryRefs ?? [l.queryRef] }
      if (i < levels.length - 1) {
        if (state.levelExpanded[i]) delete out.isCollapsed
        else out.isCollapsed = true
      } else if (!(prev.queryRefs && wasExplicit)) out.isCollapsed = true // the last level has nothing to expand: keep what Power BI wrote
      if (l.expr !== undefined && out.identityKeys === undefined) out.identityKeys = [l.expr]
      out.isPinned = true
      return out
    })
  ]
  // toggled nodes as a tree; a node holds its own level's value
  const root: any = {}
  const keep = toggledPaths.filter((p) => p.length >= 1 && p.length < levels.length && state.toggled.has(expansionPathKey(p)))
  for (const path of keep) {
    let node = root
    for (let i = 0; i < path.length; i++) {
      node.children ??= []
      const id = JSON.stringify([{ Literal: { Value: encodeLiteral(path[i]) } }])
      let child = node.children.find((c: any) => JSON.stringify(c.identityValues) === id)
      if (!child) {
        child = { identityValues: [{ Literal: { Value: encodeLiteral(path[i]) } }] }
        node.children.push(child)
      }
      node = child
    }
    node.isToggled = true
  }
  st.root = root

  // `active`: a level is queried when the level above it is expanded by default or has an expanded node
  const projections: any[] = v.query?.queryState?.[role]?.projections ?? []
  const index = (ref: string) => projections.findIndex((p) => p?.queryRef === ref)
  let reachable = true
  levels.forEach((l, i) => {
    const p = projections[index(l.queryRef)]
    if (i > 0) {
      const above = i - 1
      const anyToggled = keep.some((t) => t.length === above + 1)
      // default-expanded: shown unless every node was collapsed by hand (unknown here: keep it queried);
      // default-collapsed: shown when a node was expanded by hand
      reachable = reachable && (state.levelExpanded[above] || anyToggled)
    }
    if (!p) return
    if (reachable) p.active = true
    else delete p.active
  })
}

/** Paths of `state.toggled` are needed to write the tree: keep them next to the keys. */
export interface ExpansionEdit {
  state: ExpansionState
  paths: Scalar[][]
}

export function beginEdit(state: ExpansionState, toggledPaths: Scalar[][]): ExpansionEdit {
  return { state: { levelExpanded: [...state.levelExpanded], toggled: new Set(state.toggled) }, paths: [...toggledPaths] }
}

function setToggled(e: ExpansionEdit, path: Scalar[], on: boolean): void {
  const k = expansionPathKey(path)
  if (on) {
    if (!e.state.toggled.has(k)) e.paths.push(path)
    e.state.toggled.add(k)
  } else {
    e.state.toggled.delete(k)
    e.paths = e.paths.filter((p) => expansionPathKey(p) !== k)
  }
}

/** Expand ▸ Selection / Collapse ▸ Selection (and the +/- icon): one node. */
export function setNodeExpanded(e: ExpansionEdit, path: Scalar[], expanded: boolean): void {
  const level = path.length - 1
  if (level < 0 || level >= e.state.levelExpanded.length - 1) return
  setToggled(e, path, e.state.levelExpanded[level] !== expanded)
}

/** Expand ▸ Entire level / Collapse ▸ Entire level: every node of one level (their individual toggles are dropped). */
export function setLevelExpanded(e: ExpansionEdit, level: number, expanded: boolean): void {
  if (level < 0 || level >= e.state.levelExpanded.length - 1) return
  e.state.levelExpanded[level] = expanded
  for (const p of [...e.paths]) if (p.length === level + 1) setToggled(e, p, false)
}

/** Expand ▸ All / Collapse ▸ All: every level. */
export function setAllExpanded(e: ExpansionEdit, expanded: boolean): void {
  for (let i = 0; i < e.state.levelExpanded.length - 1; i++) e.state.levelExpanded[i] = expanded
  e.state.toggled.clear()
  e.paths = []
}

/**
 * Apply an expand / collapse command to a visual JSON (mutates). `effective` is the state the visual shows
 * right now (it can differ from the saved one while "Expand all down one level" is forced at run time);
 * it is what the command starts from and what gets saved.
 */
export function applyExpansion(visualJson: any, role: ExpansionRole, levels: ExpansionLevel[], effective: ExpansionState, command: (e: ExpansionEdit) => void): void {
  const e = beginEdit(effective, readToggledPaths(visualJson, role))
  command(e)
  writeExpansion(visualJson, role, levels, e.state, e.paths)
}
