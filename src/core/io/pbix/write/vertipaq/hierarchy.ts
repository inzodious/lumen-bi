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
