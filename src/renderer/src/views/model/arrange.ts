/**
 * Auto arrange for the model diagram (Lumen addition; Power BI has a plain "auto-layout"). Pure TypeScript, no
 * DOM and no layout library.
 *
 *  1. Understand the model: every table is classified from its relationships (`classify`): fact-like (the many
 *     side of relationships and never the one side), dimension-like (the one side), bridge (a small table on the
 *     many side of two or more relationships, or with a both-directions filter, next to a real fact), and, for
 *     tables without relationships, measure table / parameter / calculation group / date / calculated / other.
 *     Connected components are laid out separately.
 *  2. Existing table groups are laid out as units: their members are packed in a small grid inside the container
 *     and the whole container takes part in the arrangement as one node.
 *  3. Arrangements (`Arrangement`):
 *      star     facts in a middle row, their dimensions in rows above and below, dimensions shared by several
 *               facts between them, snowflaked dimensions further out (the side of their parent);
 *      layered  dimensions in rows above (snowflake levels further up), facts in the bottom row;
 *      grid     everything in a compact grid, groups first, then tables alphabetically.
 *     Star and layered order each row with barycentre sweeps (a Sugiyama-style crossing-reduction heuristic) and
 *     then pull every node towards the centre of its neighbours without overlapping (two constrained sweeps,
 *     averaged). Wide rows are wrapped into interleaved sub-rows so the diagram stays compact.
 *  4. Tables without relationships go in a tidy block at the right, one column block per kind.
 *
 * The result is deterministic for the same input (every ordering has a name tie-breaker).
 */
import type { TableDef } from '@core/model/types'
import type { Rect } from './edges'
import { CHIP_HEIGHT, CHIP_WIDTH, GROUP_HEADER, GROUP_PAD } from './groups'

export type Arrangement = 'star' | 'layered' | 'grid'
export const ARRANGEMENTS: readonly Arrangement[] = ['star', 'layered', 'grid']
export const ARRANGEMENT_LABELS: Record<Arrangement, string> = { star: 'Star / snowflake', layered: 'Layered', grid: 'Compact grid' }

export type TableKind = 'fact' | 'dimension' | 'bridge' | 'measure' | 'parameter' | 'calcGroup' | 'date' | 'calculated' | 'other'
/** Kinds of tables without relationships, in the order of the side block. */
const LOOSE_KINDS: readonly TableKind[] = ['measure', 'parameter', 'calcGroup', 'date', 'calculated', 'other']

/** What the classifier needs to know about a table besides its relationships. */
export interface TableInfo {
  columns: number
  measures: number
  calculated: boolean
  parameter: boolean
  calcGroup: boolean
  date: boolean
}

export interface ArrangeTable {
  name: string
  width: number
  height: number
  info?: TableInfo
}

/** A relationship reduced to what the layout needs. */
export interface ArrangeLink {
  from: string
  to: string
  fromMany: boolean
  toMany: boolean
  both?: boolean
}

export interface ArrangeGroup {
  id: string
  name: string
  tables: string[]
  collapsed?: boolean
}

export interface ArrangeInput {
  tables: ArrangeTable[]
  links: ArrangeLink[]
  groups?: ArrangeGroup[]
}

export interface ArrangeOptions {
  /** horizontal space between cards */
  gapX?: number
  /** vertical space between rows */
  gapY?: number
}

export interface ArrangeResult {
  arrangement: Arrangement
  /** top-left corner of every table card (the input tables, all of them) */
  positions: Map<string, { x: number; y: number }>
  kinds: Map<string, TableKind>
}

// ---------------------------------------------------------------------------------------------
// classification
// ---------------------------------------------------------------------------------------------

/** Facts about a table the classifier uses (from the model definition). */
export function tableInfo(t: TableDef): TableInfo {
  const cols = t.columns.filter((c) => c.kind !== 'rowNumber')
  const calculated = t.partitions.some((p) => p.sourceType === 'calculated')
  const expr = t.partitions.map((p) => p.expression ?? '').join('\n')
  const parameter =
    cols.some((c) => c.extendedProperties && 'ParameterMetadata' in c.extendedProperties) ||
    (calculated && /\b(GENERATESERIES|NAMEOF)\s*\(/i.test(expr)) ||
    !!t.extra?.['parameterMetadata']
  const date = t.dataCategory === 'Time' || (calculated && /\bCALENDAR(AUTO)?\s*\(/i.test(expr))
  return { columns: cols.length, measures: t.measures.length, calculated, parameter, calcGroup: !!t.calculationGroup, date }
}

const manySideOf = (l: ArrangeLink): string | null => (l.fromMany && !l.toMany ? l.from : l.toMany && !l.fromMany ? l.to : null)
const oneSideOf = (l: ArrangeLink): string | null => (l.fromMany && !l.toMany ? l.to : l.toMany && !l.fromMany ? l.from : null)

function adjacency(names: Iterable<string>, links: ArrangeLink[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>()
  for (const n of names) adj.set(n, new Set())
  for (const l of links) {
    if (l.from === l.to || !adj.has(l.from) || !adj.has(l.to)) continue
    adj.get(l.from)!.add(l.to)
    adj.get(l.to)!.add(l.from)
  }
  return adj
}

/** Connected components (each sorted by name; components ordered by size, then first name). */
export function components(names: string[], links: ArrangeLink[]): string[][] {
  const adj = adjacency(names, links)
  const seen = new Set<string>()
  const out: string[][] = []
  for (const n of [...names].sort(cmp)) {
    if (seen.has(n)) continue
    const comp: string[] = []
    const stack = [n]
    seen.add(n)
    while (stack.length) {
      const x = stack.pop()!
      comp.push(x)
      for (const y of adj.get(x) ?? []) if (!seen.has(y)) (seen.add(y), stack.push(y))
    }
    out.push(comp.sort(cmp))
  }
  return out.sort((a, b) => b.length - a.length || cmp(a[0], b[0]))
}

function looseKind(info: TableInfo | undefined): TableKind {
  if (!info) return 'other'
  if (info.calcGroup) return 'calcGroup'
  if (info.parameter) return 'parameter'
  if (info.measures > 0 && info.columns <= 1) return 'measure'
  if (info.date) return 'date'
  if (info.calculated) return 'calculated'
  return 'other'
}

/** Classify every table from its relationships (and, without relationships, from its definition). */
export function classify(tables: ArrangeTable[], links: ArrangeLink[]): Map<string, TableKind> {
  const names = new Set(tables.map((t) => t.name))
  const valid = links.filter((l) => l.from !== l.to && names.has(l.from) && names.has(l.to))
  const many = new Map<string, number>()
  const one = new Map<string, number>()
  const both = new Set<string>()
  for (const l of valid) {
    const m = manySideOf(l)
    const o = oneSideOf(l)
    if (m) many.set(m, (many.get(m) ?? 0) + 1)
    if (o) one.set(o, (one.get(o) ?? 0) + 1)
    if (l.both && m) both.add(m)
  }
  const info = new Map(tables.map((t) => [t.name, t.info]))
  const kinds = new Map<string, TableKind>()
  for (const comp of components([...names], valid)) {
    if (comp.length === 1 && !valid.some((l) => l.from === comp[0] || l.to === comp[0])) {
      kinds.set(comp[0], looseKind(info.get(comp[0])))
      continue
    }
    const facts = comp.filter((n) => (many.get(n) ?? 0) >= 1 && !(one.get(n) ?? 0))
    if (!facts.length) {
      // no table is only ever on the many side (one-to-one / many-to-many / cycles): the best connected one leads
      const deg = (n: string) => valid.filter((l) => l.from === n || l.to === n).length + (many.get(n) ?? 0)
      facts.push([...comp].sort((a, b) => deg(b) - deg(a) || cmp(a, b))[0])
    }
    for (const n of comp) kinds.set(n, facts.includes(n) ? 'fact' : 'dimension')
    // bridges: small many-side-only tables between dimensions, next to a bigger fact
    if (facts.length > 1) {
      const size = (n: string) => (info.get(n)?.columns ?? 99) + (info.get(n)?.measures ?? 0) * 2
      const biggest = Math.max(...facts.map(size))
      for (const f of facts) {
        const i = info.get(f)
        const small = !!i && i.measures === 0 && i.columns <= 4 && size(f) < biggest
        if ((many.get(f) ?? 0) >= 2 && (both.has(f) || small)) kinds.set(f, 'bridge')
      }
    }
  }
  return kinds
}

/** The arrangement that suits the model's shape best. */
export function suggestArrangement(input: ArrangeInput): Arrangement {
  const kinds = classify(input.tables, input.links)
  const connected = [...kinds.values()].filter((k) => k === 'fact' || k === 'dimension' || k === 'bridge').length
  if (connected < 2) return 'grid'
  const facts = [...kinds.values()].filter((k) => k === 'fact').length
  if (facts <= 3) return 'star'
  return 'layered'
}

// ---------------------------------------------------------------------------------------------
// units (a table, or a whole group laid out as one node)
// ---------------------------------------------------------------------------------------------

interface Unit {
  id: string
  label: string
  members: string[]
  width: number
  height: number
  /** member offsets from the unit's top-left */
  offsets: Map<string, { x: number; y: number }>
  kind: TableKind
}

const KIND_ORDER: Record<TableKind, number> = { fact: 0, bridge: 1, dimension: 2, date: 3, measure: 4, parameter: 5, calcGroup: 6, calculated: 7, other: 8 }

/** Shelf packing of rectangles in the given order: rows up to `maxWidth` wide. Returns offsets and the extent. */
function shelf(items: Array<{ id: string; width: number; height: number }>, maxWidth: number, gapX: number, gapY: number): { at: Map<string, { x: number; y: number }>; width: number; height: number } {
  const at = new Map<string, { x: number; y: number }>()
  let x = 0
  let y = 0
  let rowH = 0
  let width = 0
  for (const it of items) {
    if (x > 0 && x + it.width > maxWidth) {
      x = 0
      y += rowH + gapY
      rowH = 0
    }
    at.set(it.id, { x, y })
    x += it.width + gapX
    rowH = Math.max(rowH, it.height)
    width = Math.max(width, x - gapX)
  }
  return { at, width, height: items.length ? y + rowH : 0 }
}

function buildUnits(input: ArrangeInput, kinds: Map<string, TableKind>, gapX: number): { units: Unit[]; unitOf: Map<string, Unit> } {
  const byName = new Map(input.tables.map((t) => [t.name, t]))
  const units: Unit[] = []
  const unitOf = new Map<string, Unit>()
  for (const g of input.groups ?? []) {
    const members = g.tables.filter((n) => byName.has(n) && !unitOf.has(n)).sort((a, b) => KIND_ORDER[kinds.get(a) ?? 'other'] - KIND_ORDER[kinds.get(b) ?? 'other'] || cmp(a, b))
    if (!members.length) continue
    const items = members.map((n) => ({ id: n, width: byName.get(n)!.width, height: byName.get(n)!.height }))
    const cols = Math.max(1, Math.ceil(Math.sqrt(members.length)))
    const rowW = Math.max(...items.map((i) => i.width)) * cols + gapX * (cols - 1)
    const packed = shelf(items, rowW, gapX / 2, gapX / 2)
    const offsets = new Map([...packed.at].map(([n, p]) => [n, { x: p.x + GROUP_PAD, y: p.y + GROUP_HEADER }]))
    const fullW = packed.width + GROUP_PAD * 2
    const fullH = packed.height + GROUP_HEADER + GROUP_PAD
    // a collapsed group occupies its chip (drawn at the container's top-left); its hidden members keep the grid
    const u: Unit = { id: `group:${g.id}`, label: g.name, members, width: g.collapsed ? CHIP_WIDTH : fullW, height: g.collapsed ? CHIP_HEIGHT : fullH, offsets, kind: unitKind(members, kinds) }
    units.push(u)
    for (const m of members) unitOf.set(m, u)
  }
  for (const t of input.tables) {
    if (unitOf.has(t.name)) continue
    const u: Unit = { id: t.name, label: t.name, members: [t.name], width: t.width, height: t.height, offsets: new Map([[t.name, { x: 0, y: 0 }]]), kind: kinds.get(t.name) ?? 'other' }
    units.push(u)
    unitOf.set(t.name, u)
  }
  return { units, unitOf }
}

function unitKind(members: string[], kinds: Map<string, TableKind>): TableKind {
  const ks = members.map((m) => kinds.get(m) ?? 'other')
  for (const k of ['fact', 'bridge', 'dimension'] as const) if (ks.includes(k)) return k
  return [...ks].sort((a, b) => KIND_ORDER[a] - KIND_ORDER[b])[0]
}

interface UnitEdge {
  a: Unit
  b: Unit
  /** many-side unit → one-side unit when the relationship has a direction (null for one-to-one / many-to-many) */
  down: { from: Unit; to: Unit } | null
}

function unitEdges(links: ArrangeLink[], unitOf: Map<string, Unit>): UnitEdge[] {
  const out: UnitEdge[] = []
  const seen = new Set<string>()
  for (const l of links) {
    const a = unitOf.get(l.from)
    const b = unitOf.get(l.to)
    if (!a || !b || a === b) continue
    const m = manySideOf(l)
    const key = [a.id, b.id].sort().join('\u0000') + (m ? `>${unitOf.get(m)!.id}` : '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ a, b, down: m ? { from: unitOf.get(m)!, to: m === l.from ? b : a } : null })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// layered core
// ---------------------------------------------------------------------------------------------

interface Placed {
  unit: Unit
  x: number
  y: number
}

/**
 * Lay out one connected component of units in rows. `rows` = logical rows top → bottom (each unordered),
 * `outward` = for each logical row the direction its wrapped sub-rows grow (-1 up, +1 down).
 */
function layoutRows(rows: Unit[][], outward: number[], neighbours: Map<Unit, Unit[]>, gapX: number, gapY: number, maxPerRow: number, bottomAlign: boolean[], level: Map<Unit, number>): Placed[] {
  // 1. order each row: barycentre sweeps over the row indices of all neighbours
  const order = rows.map((r) => [...r].sort((a, b) => cmp(a.id, b.id)))
  const pos = new Map<Unit, number>()
  const rowOf = new Map<Unit, number>()
  const reindex = () =>
    order.forEach((r, ri) =>
      r.forEach((u, i) => {
        pos.set(u, r.length > 1 ? i / (r.length - 1) : 0.5)
        rowOf.set(u, ri)
      })
    )
  reindex()
  const sweep = (ri: number, from: (ri2: number) => boolean) => {
    const r = order[ri]
    const bary = new Map<Unit, number>()
    for (const u of r) {
      const ns = (neighbours.get(u) ?? []).filter((n) => from(rowOf.get(n)!))
      bary.set(u, ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : pos.get(u)!)
    }
    r.sort((a, b) => bary.get(a)! - bary.get(b)! || pos.get(a)! - pos.get(b)! || cmp(a.id, b.id))
    r.forEach((u, i) => pos.set(u, r.length > 1 ? i / (r.length - 1) : 0.5))
  }
  for (let it = 0; it < 8; it++) {
    if (it % 2 === 0) for (let ri = 1; ri < order.length; ri++) sweep(ri, (x) => x < ri)
    else for (let ri = order.length - 2; ri >= 0; ri--) sweep(ri, (x) => x > ri)
  }
  for (let ri = 0; ri < order.length; ri++) sweep(ri, (x) => x !== ri)

  // 2. wrap wide rows into interleaved sub-rows (each sub-row still spans the whole width, order kept)
  const phys: Array<{ units: Unit[]; bottom: boolean }> = []
  order.forEach((r, ri) => {
    const k = Math.max(1, Math.ceil(r.length / maxPerRow))
    const subs: Unit[][] = Array.from({ length: k }, () => [])
    r.forEach((u, i) => subs[i % k].push(u))
    // sub-row 0 is next to the facts: rows above grow upwards
    if (outward[ri] < 0) subs.reverse()
    for (const s of subs) if (s.length) phys.push({ units: s, bottom: bottomAlign[ri] })
  })

  // 3. x: pack, then pull each unit towards its neighbours' centre without overlaps
  const cx = new Map<Unit, number>()
  for (const p of phys) {
    const total = p.units.reduce((s, u) => s + u.width, 0) + gapX * (p.units.length - 1)
    let x = -total / 2
    for (const u of p.units) {
      cx.set(u, x + u.width / 2)
      x += u.width + gapX
    }
  }
  const place = (units: Unit[]) => {
    const desired = units.map((u) => {
      // dimensions follow the tables nearer the facts (a snowflake hangs off its parent, not the other way round)
      const all = neighbours.get(u) ?? []
      const inner = all.filter((n) => level.get(n)! < level.get(u)!)
      const ns = inner.length ? inner : all
      return ns.length ? ns.reduce((s, n) => s + cx.get(n)!, 0) / ns.length : cx.get(u)!
    })
    const n = units.length
    const left: number[] = new Array(n)
    const right: number[] = new Array(n)
    for (let i = 0; i < n; i++) {
      const want = desired[i] - units[i].width / 2
      left[i] = i === 0 ? want : Math.max(want, left[i - 1] + units[i - 1].width + gapX)
    }
    for (let i = n - 1; i >= 0; i--) {
      const want = desired[i] - units[i].width / 2
      right[i] = i === n - 1 ? want : Math.min(want, right[i + 1] - units[i].width - gapX)
    }
    units.forEach((u, i) => cx.set(u, (left[i] + right[i]) / 2 + u.width / 2))
  }
  for (let it = 0; it < 10; it++) {
    const seq = it % 2 === 0 ? phys : [...phys].reverse()
    for (const p of seq) place(p.units)
  }

  // 4. y: rows stacked top → bottom
  const out: Placed[] = []
  let y = 0
  for (const p of phys) {
    const h = Math.max(...p.units.map((u) => u.height))
    for (const u of p.units) out.push({ unit: u, x: Math.round(cx.get(u)! - u.width / 2), y: Math.round(p.bottom ? y + h - u.height : y) })
    y += h + gapY
  }
  return out
}

/** Distance of every unit of a component from its facts, following many → one first, then any relationship. */
function levels(comp: Unit[], edges: UnitEdge[]): Map<Unit, number> {
  const inComp = new Set(comp)
  const es = edges.filter((e) => inComp.has(e.a) && inComp.has(e.b))
  const level = new Map<Unit, number>()
  let frontier = comp.filter((u) => u.kind === 'fact')
  if (!frontier.length) frontier = [comp[0]]
  for (const f of frontier) level.set(f, 0)
  const grow = (directed: boolean) => {
    let fr = [...level.keys()]
    while (fr.length) {
      const next: Unit[] = []
      for (const u of fr)
        for (const e of es) {
          let v: Unit | null = null
          if (directed) {
            if (e.down && e.down.from === u) v = e.down.to
          } else v = e.a === u ? e.b : e.b === u ? e.a : null
          if (v && !level.has(v) && v.kind !== 'fact') {
            level.set(v, level.get(u)! + 1)
            next.push(v)
          }
        }
      fr = next.sort((a, b) => cmp(a.id, b.id))
    }
  }
  grow(true)
  grow(false)
  // facts not reached (a second fact only joined through a dimension) sit in the facts row
  for (const u of comp) if (!level.has(u)) level.set(u, 0)
  return level
}

function layoutComponent(comp: Unit[], edges: UnitEdge[], arrangement: 'star' | 'layered', gapX: number, gapY: number): Placed[] {
  const inComp = new Set(comp)
  const neighbours = new Map<Unit, Unit[]>(comp.map((u) => [u, []]))
  for (const e of edges) {
    if (!inComp.has(e.a) || !inComp.has(e.b)) continue
    neighbours.get(e.a)!.push(e.b)
    neighbours.get(e.b)!.push(e.a)
  }
  for (const ns of neighbours.values()) ns.sort((a, b) => cmp(a.id, b.id))
  const level = levels(comp, edges)
  const maxLevel = Math.max(0, ...level.values())
  const facts = comp.filter((u) => level.get(u) === 0).sort((a, b) => neighbours.get(b)!.length - neighbours.get(a)!.length || cmp(a.id, b.id))
  const maxPerRow = Math.max(4, Math.ceil(Math.sqrt(comp.length) * 1.6))

  if (arrangement === 'layered' || comp.length <= 2) {
    // dimensions above (outermost snowflake level at the top), facts in the bottom row
    const rows: Unit[][] = []
    for (let L = maxLevel; L >= 1; L--) rows.push(comp.filter((u) => level.get(u) === L))
    rows.push(facts)
    const nonEmpty = rows.filter((r) => r.length)
    return layoutRows(nonEmpty, nonEmpty.map((_, i) => (i === nonEmpty.length - 1 ? 1 : -1)), neighbours, gapX, gapY, maxPerRow, nonEmpty.map((_, i) => i < nonEmpty.length - 1), level)
  }

  // star: each level-1 unit goes above or below the facts; shared dimensions above (between their facts),
  // the others alternate per fact so both sides stay balanced; deeper levels follow their parent's side.
  const side = new Map<Unit, -1 | 1>()
  const width = { [-1]: 0, [1]: 0 } as Record<-1 | 1, number>
  const put = (u: Unit, s: -1 | 1) => {
    side.set(u, s)
    width[s] += u.width + gapX
  }
  const lvl1 = comp.filter((u) => level.get(u) === 1)
  const factsOf = (u: Unit) => neighbours.get(u)!.filter((n) => level.get(n) === 0)
  for (const u of lvl1.filter((x) => factsOf(x).length > 1).sort((a, b) => cmp(a.id, b.id))) put(u, -1)
  for (const f of facts) {
    const own = lvl1.filter((u) => !side.has(u) && factsOf(u)[0] === f).sort((a, b) => neighbours.get(b)!.length - neighbours.get(a)!.length || cmp(a.id, b.id))
    for (const u of own) put(u, width[-1] <= width[1] ? -1 : 1)
  }
  for (const u of lvl1) if (!side.has(u)) put(u, width[-1] <= width[1] ? -1 : 1)
  for (let L = 2; L <= maxLevel; L++)
    for (const u of comp.filter((x) => level.get(x) === L).sort((a, b) => cmp(a.id, b.id))) {
      const parent = neighbours.get(u)!.find((n) => level.get(n) === L - 1 && side.has(n))
      put(u, parent ? side.get(parent)! : width[-1] <= width[1] ? -1 : 1)
    }
  const rows: Unit[][] = []
  const outward: number[] = []
  const bottom: boolean[] = []
  for (let L = maxLevel; L >= 1; L--) {
    const r = comp.filter((u) => level.get(u) === L && side.get(u) === -1)
    if (r.length) (rows.push(r), outward.push(-1), bottom.push(true))
  }
  rows.push(facts)
  outward.push(1)
  bottom.push(false)
  for (let L = 1; L <= maxLevel; L++) {
    const r = comp.filter((u) => level.get(u) === L && side.get(u) === 1)
    if (r.length) (rows.push(r), outward.push(1), bottom.push(false))
  }
  return layoutRows(rows, outward, neighbours, gapX, gapY, maxPerRow, bottom, level)
}

// ---------------------------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------------------------

/** Arrange the diagram. Every input table gets a position; the result's top-left corner is (0, 0). */
export function arrange(input: ArrangeInput, arrangement: Arrangement, opts: ArrangeOptions = {}): ArrangeResult {
  const gapX = opts.gapX ?? 60
  const gapY = opts.gapY ?? 90
  const names = new Set(input.tables.map((t) => t.name))
  const links = input.links.filter((l) => l.from !== l.to && names.has(l.from) && names.has(l.to))
  const kinds = classify(input.tables, links)
  const { units, unitOf } = buildUnits(input, kinds, gapX)
  const edges = unitEdges(links, unitOf)
  const placed: Placed[] = []

  if (arrangement === 'grid') {
    const ordered = [...units].sort((a, b) => Number(b.members.length > 1 || b.id.startsWith('group:')) - Number(a.members.length > 1 || a.id.startsWith('group:')) || cmp(a.label, b.label))
    const area = ordered.reduce((s, u) => s + (u.width + gapX) * (u.height + gapX), 0)
    const maxW = Math.max(Math.sqrt(area) * 1.4, ...ordered.map((u) => u.width))
    const packed = shelf(ordered, maxW, gapX, gapX)
    for (const u of ordered) placed.push({ unit: u, ...packed.at.get(u.id)! })
  } else {
    const connected = units.filter((u) => edges.some((e) => e.a === u || e.b === u))
    const loose = units.filter((u) => !connected.includes(u))
    // connected components, each laid out on its own, then packed in shelves (biggest first)
    const comps = components(
      connected.map((u) => u.id),
      edges.map((e) => ({ from: e.a.id, to: e.b.id, fromMany: false, toMany: false }))
    ).map((ids) => ids.map((id) => connected.find((u) => u.id === id)!))
    const blocks = comps.map((c) => {
      const p = layoutComponent(c, edges, arrangement, gapX, gapY)
      const b = extent(p)
      return { id: c[0].id, width: b.width, height: b.height, items: p.map((q) => ({ ...q, x: q.x - b.x, y: q.y - b.y })) }
    })
    const area = blocks.reduce((s, b) => s + b.width * b.height, 0)
    const packed = shelf(blocks, Math.max(Math.sqrt(area) * 1.6, ...blocks.map((b) => b.width)), gapX * 3, gapY * 1.5)
    let right = 0
    for (const b of blocks) {
      const o = packed.at.get(b.id)!
      for (const q of b.items) placed.push({ unit: q.unit, x: q.x + o.x, y: q.y + o.y })
      right = Math.max(right, o.x + b.width)
    }
    // tables without relationships: one block per kind, side by side at the right, each a column of up to 6 rows
    let x = placed.length ? right + gapX * 3 : 0
    for (const k of LOOSE_KINDS) {
      const of = loose.filter((u) => u.kind === k).sort((a, b) => cmp(a.label, b.label))
      if (!of.length) continue
      const perCol = 6
      const cols = Math.ceil(of.length / perCol)
      for (let c = 0; c < cols; c++) {
        const col = of.slice(c * perCol, (c + 1) * perCol)
        let y = 0
        for (const u of col) {
          placed.push({ unit: u, x, y })
          y += u.height + gapX / 2
        }
        x += Math.max(...col.map((u) => u.width)) + gapX / 2
      }
      x += gapX
    }
  }

  const b = extent(placed)
  const positions = new Map<string, { x: number; y: number }>()
  for (const p of placed) for (const [m, o] of p.unit.offsets) positions.set(m, { x: Math.round(p.x - b.x + o.x), y: Math.round(p.y - b.y + o.y) })
  return { arrangement, positions, kinds }
}

function extent(ps: Array<{ x: number; y: number; unit: { width: number; height: number } }>): Rect {
  if (!ps.length) return { x: 0, y: 0, width: 0, height: 0 }
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of ps) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x + p.unit.width)
    y1 = Math.max(y1, p.y + p.unit.height)
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

// ---------------------------------------------------------------------------------------------
// quality measures (tests, and the timings / crossing counts reported for real models)
// ---------------------------------------------------------------------------------------------

const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })

function segmentsCross(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }): boolean {
  const o = (p: typeof a, q: typeof a, r: typeof a) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
}

/** Pairs of relationship lines (drawn centre to centre) that cross; lines sharing a table never count. */
export function countCrossings(rects: ReadonlyMap<string, Rect>, links: ArrangeLink[]): number {
  const segs = links
    .filter((l) => l.from !== l.to && rects.has(l.from) && rects.has(l.to))
    .map((l) => ({ l, a: centre(rects.get(l.from)!), b: centre(rects.get(l.to)!) }))
  let n = 0
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i]
      const t = segs[j]
      if (s.l.from === t.l.from || s.l.from === t.l.to || s.l.to === t.l.from || s.l.to === t.l.to) continue
      if (segmentsCross(s.a, s.b, t.a, t.b)) n++
    }
  return n
}

/** Total length of the relationship lines (centre to centre). */
export function totalLinkLength(rects: ReadonlyMap<string, Rect>, links: ArrangeLink[]): number {
  let s = 0
  for (const l of links) {
    const a = rects.get(l.from)
    const b = rects.get(l.to)
    if (!a || !b || l.from === l.to) continue
    const p = centre(a)
    const q = centre(b)
    s += Math.hypot(q.x - p.x, q.y - p.y)
  }
  return s
}

/** Pairs of overlapping cards. */
export function countOverlaps(rects: ReadonlyMap<string, Rect>): number {
  const rs = [...rects.values()]
  let n = 0
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i]
      const b = rs[j]
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) n++
    }
  return n
}

/** Card rectangles of an arrangement result. */
export function resultRects(input: ArrangeInput, result: ArrangeResult): Map<string, Rect> {
  const m = new Map<string, Rect>()
  for (const t of input.tables) {
    const p = result.positions.get(t.name)
    if (p) m.set(t.name, { x: p.x, y: p.y, width: t.width, height: t.height })
  }
  return m
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
