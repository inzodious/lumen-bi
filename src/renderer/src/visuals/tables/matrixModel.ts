/**
 * Matrix (pivotTable) layout model — pure, engine-independent.
 *
 * Input is a set of "blocks": block (d, e) holds the summarize result grouped by the first d
 * row fields and the first e column fields (d = 0 → row grand total, e = 0 → column total).
 * Totals and subtotals are therefore real measure evaluations at a coarser grain, exactly like
 * Power BI's DAX queries (ROLLUPADDISSUBTOTAL), never sums of the displayed cells.
 *
 * From the blocks we build the row tree (with expand/collapse state), the column tree, the
 * flattened list of row items (nodes, bottom subtotals, grand total, values-on-rows rows) and
 * column leaves (column groups × values, with subtotal and grand-total columns), plus a cell
 * lookup that returns the value row for any (row item, column leaf) pair.
 */
import type { Scalar } from '@core/model/data'
import { compareScalars } from '../common/sqEval'

export interface MatrixBlock {
  rowDepth: number
  colDepth: number
  /** [rowGroups(rowDepth)..., colGroups(colDepth)..., values..., extras...] */
  rows: Scalar[][]
  formats?: Array<Array<string | undefined>>
}

export type MatrixSort = { kind: 'group'; dir: 'asc' | 'desc' } | { kind: 'value'; index: number; dir: 'asc' | 'desc' } | undefined

export interface MatrixSpec {
  rowLevels: number
  colLevels: number
  valueCount: number
  blocks: Map<string, MatrixBlock>
  /** number of row levels shown expanded by default (≥ 1 when there are row fields) */
  expandedDepth: number
  /** default state per row level (index 0 = first level); overrides `expandedDepth` (PBIR `expansionStates.levels[].isCollapsed`) */
  rowLevelExpanded?: boolean[]
  /** path keys of nodes whose expansion was toggled relative to the default */
  toggled: Set<string>
  /** row subtotal enabled at a given node depth (1-based path length); depth 0 = grand total row */
  rowSubtotal(depth: number): boolean
  rowSubtotalPosition: 'top' | 'bottom'
  /** column subtotal enabled at a given column depth; depth 0 = grand total column */
  colSubtotal(depth: number): boolean
  valuesOnRow: boolean
  sort?: MatrixSort
  /** column levels shown expanded by default (default: all loaded levels) */
  colExpandedDepth?: number
  /** default state per column level; overrides `colExpandedDepth` */
  colLevelExpanded?: boolean[]
  /** column path keys whose expansion was toggled relative to the default */
  colToggled?: Set<string>
  /** label of the row subtotal of a node at `depth` (1-based); depth 0 = grand total row */
  rowTotalLabel?(depth: number): string
  /** label of the column subtotal of a group at `depth`; depth 0 = grand total column */
  colTotalLabel?(depth: number): string
  /** insert a blank row between top-level row groups (blankRows.showBlankRows) */
  blankRows?: boolean
}

export interface RowNode {
  key: string
  path: Scalar[]
  depth: number
  children: RowNode[]
  canExpand: boolean
  expanded: boolean
}

export interface RowItem {
  kind: 'node' | 'subtotal' | 'grand' | 'value' | 'blank'
  /** visual indentation level */
  level: number
  /** path used for value lookup (empty for grand total) */
  path: Scalar[]
  label?: Scalar
  node?: RowNode
  /** does this row show values */
  showValues: boolean
  /** values on rows: which value this row shows */
  valueIndex?: number
  /** subtotal / grand-total styling */
  isTotal: boolean
  /** 'subtotal' (incl. collapsed parents above the lowest visible level) or 'grand' */
  totalKind?: 'subtotal' | 'grand'
}

export interface ColLeaf {
  path: Scalar[]
  isTotal: boolean
  /** 'subtotal' (subtotal column or collapsed group above the lowest visible level) or 'grand' */
  totalKind?: 'subtotal' | 'grand'
  /** a collapsed column group (values = the group's subtotal, no "Total" label) */
  collapsed?: boolean
  /** -1 when values are on rows */
  valueIndex: number
  key: string
}

export interface ColHeaderCell {
  label: Scalar
  kind: 'group' | 'total' | 'value'
  /** group headers: can be expanded / collapsed (+/- icon) */
  canExpand?: boolean
  expanded?: boolean
  /** group header above the lowest visible level (bold, in-line with its subtotal) */
  isSubtotalLevel?: boolean
  colSpan: number
  rowSpan: number
  /** first leaf index covered */
  start: number
  path: Scalar[]
  valueIndex?: number
}

export interface MatrixLayout {
  roots: RowNode[]
  items: RowItem[]
  leaves: ColLeaf[]
  headerRows: ColHeaderCell[][]
  showValueHeaders: boolean
  /** number of column-group header rows actually shown (deepest visible column level) */
  colHeaderLevels: number
  /** deepest visible row level (1-based; 0 without row fields) */
  maxRowDepth: number
  /** returns the value row (values + extras part) for a cell, or undefined when there is no data */
  lookup(rowPath: Scalar[], colPath: Scalar[]): { values: Scalar[]; formats?: Array<string | undefined> } | undefined
}

export function valueKey(v: Scalar): string {
  if (v instanceof Date) return 'd' + v.getTime()
  if (v instanceof Uint8Array) return 'b'
  return JSON.stringify(v)
}

export function pathKey(path: Scalar[]): string {
  return path.map(valueKey).join('\u0001')
}

export function blockKey(d: number, e: number): string {
  return `${d}:${e}`
}

interface BlockIndex {
  map: Map<string, number>
  block: MatrixBlock
}

export function buildMatrixLayout(spec: MatrixSpec): MatrixLayout {
  const indexCache = new Map<string, BlockIndex | null>()
  const indexOf = (d: number, e: number): BlockIndex | null => {
    const k = blockKey(d, e)
    if (indexCache.has(k)) return indexCache.get(k)!
    const block = spec.blocks.get(k)
    if (!block) {
      indexCache.set(k, null)
      return null
    }
    const map = new Map<string, number>()
    block.rows.forEach((r, i) => map.set(pathKey(r.slice(0, d)) + '\u0002' + pathKey(r.slice(d, d + e)), i))
    const bi = { map, block }
    indexCache.set(k, bi)
    return bi
  }
  const lookup = (rowPath: Scalar[], colPath: Scalar[]) => {
    const d = rowPath.length
    const e = colPath.length
    const bi = indexOf(d, e)
    if (!bi) return undefined
    const i = bi.map.get(pathKey(rowPath) + '\u0002' + pathKey(colPath))
    if (i === undefined) return undefined
    return { values: bi.block.rows[i].slice(d + e), formats: bi.block.formats?.[i] }
  }

  // ---------------- row tree ----------------
  const sortSiblings = (nodes: RowNode[]) => {
    const s = spec.sort
    if (!s) return nodes
    if (s.kind === 'group') return s.dir === 'desc' ? [...nodes].reverse() : nodes
    const val = (n: RowNode) => lookup(n.path, [])?.values[s.index] ?? null
    const sorted = nodes.map((n, i) => ({ n, i, v: val(n) }))
    sorted.sort((a, b) => {
      const c = compareScalars(a.v, b.v)
      return (s.dir === 'desc' ? -c : c) || a.i - b.i
    })
    return sorted.map((x) => x.n)
  }

  const childrenOf = (parent: Scalar[]): RowNode[] => {
    const d = parent.length + 1
    if (d > spec.rowLevels) return []
    const bi = indexOf(d, 0)
    if (!bi) return []
    const pk = pathKey(parent)
    const seen = new Set<string>()
    const out: RowNode[] = []
    for (const r of bi.block.rows) {
      const path = r.slice(0, d)
      if (d > 1 && pathKey(path.slice(0, d - 1)) !== pk) continue
      const key = pathKey(path)
      if (seen.has(key)) continue
      seen.add(key)
      const canExpand = d < spec.rowLevels
      const defaultExpanded = spec.rowLevelExpanded ? !!spec.rowLevelExpanded[d - 1] : d < spec.expandedDepth
      const expanded = canExpand && defaultExpanded !== spec.toggled.has(key)
      out.push({ key, path, depth: d, children: [], canExpand, expanded })
    }
    const sorted = sortSiblings(out)
    for (const n of sorted) if (n.expanded) n.children = childrenOf(n.path)
    // a node whose children block wasn't loaded (or is empty) can't expand
    for (const n of sorted) if (n.expanded && !n.children.length && !indexOf(n.depth + 1, 0)) n.expanded = false
    return sorted
  }
  const roots = spec.rowLevels > 0 ? childrenOf([]) : []

  // ---------------- row items ----------------
  // Power BI styles rows above the lowest *visible* level as subtotals (bold), including
  // collapsed parents in a mixed expand/collapse state (Learn: matrix format tips).
  let maxRowDepth = 0
  const depthOf = (nodes: RowNode[]) => {
    for (const n of nodes) {
      maxRowDepth = Math.max(maxRowDepth, n.depth)
      if (n.expanded) depthOf(n.children)
    }
  }
  depthOf(roots)
  const rowLabel = (depth: number) => spec.rowTotalLabel?.(depth) ?? 'Total'
  const colLabel = (depth: number) => spec.colTotalLabel?.(depth) ?? 'Total'

  const items: RowItem[] = []
  const pushWithValues = (item: RowItem) => {
    if (!spec.valuesOnRow || !item.showValues) {
      items.push(item)
      return
    }
    // values on rows: a header row for the node, then one row per value
    if (item.kind !== 'value' && (spec.rowLevels > 0 || item.kind !== 'grand')) items.push({ ...item, showValues: false })
    for (let v = 0; v < spec.valueCount; v++) {
      items.push({ kind: 'value', level: item.level + (spec.rowLevels > 0 ? 1 : 0), path: item.path, valueIndex: v, showValues: true, isTotal: item.isTotal, totalKind: item.totalKind })
    }
  }
  const walk = (n: RowNode) => {
    const level = n.depth - 1
    const label = n.path[n.path.length - 1]
    if (n.expanded && n.children.length) {
      const sub = spec.rowSubtotal(n.depth)
      const top = sub && spec.rowSubtotalPosition === 'top'
      pushWithValues({ kind: 'node', level, path: n.path, label, node: n, showValues: top, isTotal: top, totalKind: top ? 'subtotal' : undefined })
      for (const c of n.children) walk(c)
      if (sub && !top) pushWithValues({ kind: 'subtotal', level: level + 1, path: n.path, label: rowLabel(n.depth), node: n, showValues: true, isTotal: true, totalKind: 'subtotal' })
    } else {
      const aboveLowest = n.depth < maxRowDepth
      pushWithValues({ kind: 'node', level, path: n.path, label, node: n, showValues: true, isTotal: aboveLowest, totalKind: aboveLowest ? 'subtotal' : undefined })
    }
  }
  roots.forEach((r, i) => {
    walk(r)
    if (spec.blankRows && spec.rowLevels > 1 && i < roots.length - 1) items.push({ kind: 'blank', level: 0, path: [], showValues: false, isTotal: false })
  })
  if (spec.rowLevels === 0) {
    // no row fields: a single row of values (or one per value when values are on rows)
    pushWithValues({ kind: 'grand', level: 0, path: [], label: undefined, showValues: true, isTotal: false })
  } else if (spec.rowSubtotal(0) && roots.length) {
    if (spec.blankRows && spec.rowLevels > 1) items.push({ kind: 'blank', level: 0, path: [], showValues: false, isTotal: false })
    pushWithValues({ kind: 'grand', level: 0, path: [], label: rowLabel(0), showValues: true, isTotal: true, totalKind: 'grand' })
  }

  // ---------------- column tree / leaves ----------------
  interface ColNode {
    path: Scalar[]
    children: ColNode[]
    canExpand: boolean
    expanded: boolean
  }
  const colExpandedDepth = spec.colExpandedDepth ?? spec.colLevels
  const colToggled = spec.colToggled ?? new Set<string>()
  const colChildren = (parent: Scalar[]): ColNode[] => {
    const e = parent.length + 1
    if (e > spec.colLevels) return []
    const bi = indexOf(0, e)
    if (!bi) return []
    const pk = pathKey(parent)
    const seen = new Set<string>()
    const out: ColNode[] = []
    for (const r of bi.block.rows) {
      const path = r.slice(0, e)
      if (e > 1 && pathKey(path.slice(0, e - 1)) !== pk) continue
      const k = pathKey(path)
      if (seen.has(k)) continue
      seen.add(k)
      const canExpand = e < spec.colLevels
      const expanded = canExpand && (spec.colLevelExpanded ? !!spec.colLevelExpanded[e - 1] : e < colExpandedDepth) !== colToggled.has(k)
      out.push({ path, children: [], canExpand, expanded })
    }
    for (const n of out) {
      if (!n.expanded) continue
      n.children = colChildren(n.path)
      if (!n.children.length && !indexOf(0, n.path.length + 1)) n.expanded = false
    }
    return out
  }
  const colRoots = spec.colLevels > 0 ? colChildren([]) : []
  let colDepth = 0
  const colDepthOf = (nodes: ColNode[]) => {
    for (const n of nodes) {
      colDepth = Math.max(colDepth, n.path.length)
      if (n.expanded) colDepthOf(n.children)
    }
  }
  colDepthOf(colRoots)
  const showValueHeaders = !spec.valuesOnRow && (spec.valueCount > 1 || spec.colLevels === 0)
  const perValue = spec.valuesOnRow ? [-1] : Array.from({ length: Math.max(1, spec.valueCount) }, (_, i) => i)

  const leaves: ColLeaf[] = []
  const levelsInHeader = colDepth
  const headerRows: ColHeaderCell[][] = Array.from({ length: levelsInHeader + (showValueHeaders ? 1 : 0) }, () => [])
  const addValueHeaders = (start: number) => {
    if (!showValueHeaders) return
    perValue.forEach((v, i) => headerRows[levelsInHeader].push({ label: null, kind: 'value', colSpan: 1, rowSpan: 1, start: start + i, path: [], valueIndex: v }))
  }
  const pushLeaves = (path: Scalar[], isTotal: boolean, totalKind?: 'subtotal' | 'grand', collapsed?: boolean) => {
    const start = leaves.length
    for (const v of perValue) leaves.push({ path, isTotal, totalKind, collapsed, valueIndex: v, key: pathKey(path) + '|' + (isTotal ? 'T' : '') + (collapsed ? 'C' : '') + v })
    addValueHeaders(start)
    return start
  }
  const walkCols = (n: ColNode) => {
    const lvl = n.path.length - 1
    const start = leaves.length
    const aboveLowest = n.path.length < colDepth
    const cell: ColHeaderCell = { label: n.path[lvl], kind: 'group', colSpan: 0, rowSpan: 1, start, path: n.path, canExpand: n.canExpand, expanded: n.expanded, isSubtotalLevel: aboveLowest }
    headerRows[lvl].push(cell)
    if (n.expanded && n.children.length) {
      for (const c of n.children) walkCols(c)
      if (spec.colSubtotal(n.path.length)) {
        const s = pushLeaves(n.path, true, 'subtotal')
        headerRows[lvl + 1].push({ label: colLabel(n.path.length), kind: 'total', colSpan: perValue.length, rowSpan: levelsInHeader - lvl - 1, start: s, path: n.path })
      }
    } else {
      // leaf, or a collapsed group showing its subtotal (header spans down to the value row)
      pushLeaves(n.path, aboveLowest, aboveLowest ? 'subtotal' : undefined, n.canExpand && !n.expanded)
      cell.rowSpan = levelsInHeader - lvl
    }
    cell.colSpan = leaves.length - start
  }
  if (spec.colLevels > 0) {
    for (const r of colRoots) walkCols(r)
    if (spec.colSubtotal(0) && colRoots.length) {
      const s = pushLeaves([], true, 'grand')
      headerRows[0].push({ label: colLabel(0), kind: 'total', colSpan: perValue.length, rowSpan: levelsInHeader, start: s, path: [] })
    }
  } else pushLeaves([], false)

  return { roots, items, leaves, headerRows, showValueHeaders, lookup, colHeaderLevels: levelsInHeader, maxRowDepth }
}

/** Compare helper re-export for callers that sort node labels. */
export { compareScalars }

/**
 * Index of the first row of the trailing row grand total (its value rows too, with values on rows), or `items.length`
 * when there is none to pin. A matrix that is nothing but its grand total keeps it in the body.
 */
export function pinnedGrandTotalStart(items: RowItem[]): number {
  let i = items.length
  while (i > 0 && items[i - 1].totalKind === 'grand') i--
  return i === 0 ? items.length : i
}
