/**
 * Structures the engine derives from column data, written by Lumen so a `.pbix` it writes carries them like one saved
 * by Power BI Desktop: attribute hierarchies (`H$` system tables) and relationship indexes (`R$` system tables).
 *
 * Rules measured on every structure of the files on hand (seven Microsoft samples, 2017-2023, and a November 2025
 * Desktop file; reproduction counts in docs/developer/file-format-io.md):
 *
 * Attribute hierarchy of a hash-encoded column, table `H$<table> (<id>)$<column> (<id>)`, columns POS_TO_ID and
 * ID_TO_POS, one row per data id (`values + 3` rows), in segments of `n` rows (`n` = sort positions: distinct values,
 * plus one for BLANK when the column has BLANKs; the segment map records `RecordsPerSegment` = n):
 *  - POS_TO_ID[pos] = the data id at sort position `pos` (BLANK, id 2, first; then the values in sort order); the
 *    trailing rows hold 0.
 *  - ID_TO_POS[id] = the sort position of data id `id`; rows 0 and 2 (when there is no BLANK) hold 0, row 1 holds `n`.
 *  - Sort order: the values of the column's sort-by column when it has one, else the values themselves (text
 *    case-insensitively, as Power BI's default collation compares); ties by data id.
 *  - Storage: pure bit-packed segments of 32-bit values with one word more than the values need, `firstRunValue` 0.
 * Value-encoded columns carry only POS_TO_ID plus a `.hidx` hash index; Lumen hash-encodes every column, so neither is
 * written.
 *
 * Relationship index, table `R$<from table> (<id>)$<relationship storage name>`, column INDEX: one row per data id of
 * the relationship's from-column (ids 0 .. 2 + distinct values), holding `1 + row` of the to-table row with the same
 * key, or 0 when there is none (and for ids 0-2); pure bit-packed in the smallest width that holds the largest value,
 * no extra word, `firstRunValue` 0xFFFFFFFF.
 */
import { compareText } from './sort'
import { segmentRanges, writePackedStreams, XM_NULL_ID, type ColumnStreams } from './idf'

export interface HierarchyStreams {
  posToId: ColumnStreams
  idToPos: ColumnStreams
  /** sort positions (BLANK included) */
  distinct: number
  /** data ids in sort order */
  order: number[]
}

/**
 * Sort order of a hash-encoded column's data ids.
 * @param values distinct stored values (id = 3 + index)
 * @param sortKeys optional per-value sort keys (from the sort-by column)
 */
export function sortedIds(values: ReadonlyArray<string | number>, hasNulls: boolean, sortKeys?: ReadonlyArray<string | number | undefined>): number[] {
  const idx = values.map((_, i) => i)
  const cmp = (a: string | number | undefined, b: string | number | undefined): number => {
    if (a === b) return 0
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (typeof a === 'string' && typeof b === 'string') return compareText(a, b)
    if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0
    return typeof a === 'number' ? -1 : 1
  }
  idx.sort((a, b) => (sortKeys ? cmp(sortKeys[a], sortKeys[b]) : 0) || cmp(values[a], values[b]) || a - b)
  const order = idx.map((i) => i + 3)
  return hasNulls ? [XM_NULL_ID, ...order] : order
}

export function attributeHierarchyStreams(values: ReadonlyArray<string | number>, hasNulls: boolean, sortKeys?: ReadonlyArray<string | number | undefined>): HierarchyStreams {
  const order = sortedIds(values, hasNulls, sortKeys)
  const n = order.length
  // one row per data id (0 .. values + 2), in two segments: the n sort positions, then the rest
  const rows = values.length + 3
  const posToId = new Uint32Array(rows)
  posToId.set(order)
  const idToPos = new Uint32Array(rows)
  idToPos[1] = n
  order.forEach((id, pos) => (idToPos[id] = pos))
  const segments = segmentRanges(rows, Math.max(1, n))
  const opts = { width: 32, extraWord: true, sdos: true }
  return { posToId: writePackedStreams(posToId, segments, opts), idToPos: writePackedStreams(idToPos, segments, opts), distinct: n, order }
}

/**
 * Relationship INDEX column.
 * @param fromIdCount number of data ids of the from-column (3 + its distinct values)
 * @param toRowOfId to-table row (0-based) for a from data id, or undefined when no row matches
 */
export function relationshipIndexStreams(fromIdCount: number, toRowOfId: (id: number) => number | undefined): ColumnStreams {
  const vals = new Uint32Array(fromIdCount)
  for (let id = 3; id < fromIdCount; id++) {
    const row = toRowOfId(id)
    vals[id] = row === undefined ? 0 : row + 1
  }
  return writePackedStreams(vals, [[0, fromIdCount]], { firstRunValue: 0xffffffff, sdos: true })
}

export interface UserHierarchyStreams {
  multiLevelId: ColumnStreams
  parentPos: ColumnStreams
  firstChildPos: ColumnStreams
  childCount: ColumnStreams
  /** members (rows of the U$ table) */
  members: number
  /** position of each level's first member (HierarchyStorage.LevelDefinition) */
  levelStarts: number[]
}

/**
 * User hierarchy, table `U$<table> (<id>)$<hierarchy> (<id>)`, one row per member: the distinct paths of level values,
 * level by level (breadth first), each parent's children in their level column's attribute-hierarchy order. Columns:
 * MULTI_LEVEL_ID = the member's data id in its level column; PARENT_POS, FIRST_CHILD_POS, CHILD_COUNT stored as value
 * + 1 (0 = none: the root level's parent, a leaf's children). One segment, 32-bit values with an extra word;
 * `firstRunValue` 0 for MULTI_LEVEL_ID and 0xFFFFFFFF for the other three (real files).
 * `HierarchyStorage.LevelDefinition` lists each level's column storage name and first member position.
 *
 * @param levelIds data ids per level column (row-aligned)
 * @param levelRank sort position per data id, per level (from the level column's attribute hierarchy)
 */
export function userHierarchyStreams(levelIds: Uint32Array[], levelRank: ArrayLike<number>[], rows: number): UserHierarchyStreams {
  interface Node {
    id: number
    parent: number
    children: Node[]
    childIndex: Map<number, Node>
    pos: number
  }
  const root: Node = { id: 0, parent: -1, children: [], childIndex: new Map(), pos: -1 }
  for (let r = 0; r < rows; r++) {
    let node = root
    for (let l = 0; l < levelIds.length; l++) {
      const id = levelIds[l][r]
      let c = node.childIndex.get(id)
      if (!c) {
        c = { id, parent: -1, children: [], childIndex: new Map(), pos: -1 }
        node.childIndex.set(id, c)
        node.children.push(c)
      }
      node = c
    }
  }
  const levels: Node[][] = []
  let frontier = [root]
  for (let l = 0; l < levelIds.length; l++) {
    const next: Node[] = []
    for (const p of frontier) {
      p.children.sort((a, b) => levelRank[l][a.id] - levelRank[l][b.id] || a.id - b.id)
      next.push(...p.children)
    }
    levels.push(next)
    frontier = next
  }
  const levelStarts: number[] = []
  const all: Node[] = []
  for (const lv of levels) {
    levelStarts.push(all.length)
    for (const n of lv) {
      n.pos = all.length
      all.push(n)
    }
  }
  const m = all.length
  const ml = new Uint32Array(m)
  const pp = new Uint32Array(m)
  const fc = new Uint32Array(m)
  const cc = new Uint32Array(m)
  for (const lv of levels) for (const n of lv) for (const c of n.children) c.parent = n.pos
  for (const n of all) {
    ml[n.pos] = n.id
    pp[n.pos] = n.parent < 0 ? 0 : n.parent + 1
    fc[n.pos] = n.children.length ? n.children[0].pos + 1 : 0
    cc[n.pos] = n.children.length ? n.children.length + 1 : 0
  }
  const seg: Array<[number, number]> = [[0, m]]
  const base = { width: 32, extraWord: true, sdos: true }
  return {
    multiLevelId: writePackedStreams(ml, seg, base),
    parentPos: writePackedStreams(pp, seg, { ...base, firstRunValue: 0xffffffff }),
    firstChildPos: writePackedStreams(fc, seg, { ...base, firstRunValue: 0xffffffff }),
    childCount: writePackedStreams(cc, seg, { ...base, firstRunValue: 0xffffffff }),
    members: m,
    levelStarts
  }
}
