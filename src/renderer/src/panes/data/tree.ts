/**
 * Data pane tree model (pure — tested in tree.test.ts): tables → display folders → fields,
 * PBI ordering (measure tables first, folders before fields, case-insensitive names), hidden
 * filtering, and search.
 */
import type { ColumnDef, HierarchyDef, HierarchyLevelDef, MeasureDef, SemanticModel, TableDef } from '@core/model/types'
import { isMeasureTable } from './icons'

export type TreeNode =
  | { kind: 'table'; key: string; table: TableDef; children: TreeNode[] }
  | { kind: 'folder'; key: string; name: string; table: string; children: TreeNode[] }
  | { kind: 'column'; key: string; table: string; column: ColumnDef }
  | { kind: 'measure'; key: string; table: string; measure: MeasureDef }
  | { kind: 'hierarchy'; key: string; table: string; hierarchy: HierarchyDef; children: TreeNode[] }
  | { kind: 'level'; key: string; table: string; hierarchy: string; level: HierarchyLevelDef; column?: ColumnDef }

export interface TreeOptions {
  search?: string
  showHidden?: boolean
}

const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })

/** Auto date/time infrastructure tables are never shown (PBI hides them even with "View hidden"). */
export function isInternalTable(t: TableDef): boolean {
  return !!t.isPrivate || /^(LocalDateTable_|DateTableTemplate_)/.test(t.name) || !!t.showAsVariationsOnly
}

function nodeName(n: TreeNode): string {
  switch (n.kind) {
    case 'table':
      return n.table.name
    case 'folder':
      return n.name
    case 'column':
      return n.column.name
    case 'measure':
      return n.measure.name
    case 'hierarchy':
      return n.hierarchy.name
    case 'level':
      return n.level.name
  }
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    const fa = a.kind === 'folder' ? 0 : 1
    const fb = b.kind === 'folder' ? 0 : 1
    return fa - fb || cmp(nodeName(a), nodeName(b))
  })
}

/** Folder paths an object appears in (`a\b;c` → [['a','b'], ['c']]). */
export function folderPaths(displayFolder: string | undefined): string[][] {
  if (!displayFolder?.trim()) return [[]]
  return displayFolder
    .split(';')
    .map((p) => p.split(/[\\/]/).map((s) => s.trim()).filter(Boolean))
    .filter((p) => p.length)
}

function insert(root: TreeNode[], table: string, path: string[], node: TreeNode): void {
  let level = root
  let key = `${table}`
  for (const seg of path) {
    key += `/${seg}`
    let f = level.find((n): n is Extract<TreeNode, { kind: 'folder' }> => n.kind === 'folder' && n.name === seg)
    if (!f) {
      f = { kind: 'folder', key: `fld:${key}`, name: seg, table, children: [] }
      level.push(f)
    }
    level = f.children
  }
  level.push(path.length ? { ...node, key: `${node.key}@${path.join('/')}` } : node)
}

function sortDeep(nodes: TreeNode[]): TreeNode[] {
  for (const n of nodes) if (n.kind === 'folder' || n.kind === 'hierarchy') sortDeep(n.children)
  return sortNodes(nodes)
}

function tableChildren(t: TableDef, showHidden: boolean): TreeNode[] {
  const out: TreeNode[] = []
  for (const c of t.columns) {
    if (c.kind === 'rowNumber' || (c.isHidden && !showHidden)) continue
    for (const p of folderPaths(c.displayFolder)) insert(out, t.name, p, { kind: 'column', key: `col:${t.name}.${c.name}`, table: t.name, column: c })
  }
  for (const m of t.measures) {
    if (m.isHidden && !showHidden) continue
    for (const p of folderPaths(m.displayFolder)) insert(out, t.name, p, { kind: 'measure', key: `msr:${t.name}.${m.name}`, table: t.name, measure: m })
  }
  for (const h of t.hierarchies) {
    if (h.isHidden && !showHidden) continue
    const levels: TreeNode[] = [...h.levels]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((l) => ({ kind: 'level', key: `lvl:${t.name}.${h.name}.${l.name}`, table: t.name, hierarchy: h.name, level: l, column: t.columns.find((c) => c.name === l.column) }))
    for (const p of folderPaths(h.displayFolder)) insert(out, t.name, p, { kind: 'hierarchy', key: `hier:${t.name}.${h.name}`, table: t.name, hierarchy: h, children: levels })
  }
  return sortDeep(out)
}

function filterNodes(nodes: TreeNode[], q: string): TreeNode[] {
  const out: TreeNode[] = []
  for (const n of nodes) {
    if (n.kind === 'folder') {
      const kids = filterNodes(n.children, q)
      if (kids.length) out.push({ ...n, children: kids })
    } else if (n.kind === 'hierarchy') {
      if (n.hierarchy.name.toLowerCase().includes(q)) out.push(n)
      else {
        const kids = n.children.filter((c) => nodeName(c).toLowerCase().includes(q))
        if (kids.length) out.push({ ...n, children: kids })
      }
    } else if (nodeName(n).toLowerCase().includes(q)) out.push(n)
  }
  return out
}

export function buildTree(model: SemanticModel | undefined, opts: TreeOptions = {}): TreeNode[] {
  if (!model) return []
  const showHidden = !!opts.showHidden
  const q = (opts.search ?? '').trim().toLowerCase()
  const tables = model.tables
    .filter((t) => !isInternalTable(t) && (showHidden || !t.isHidden))
    .sort((a, b) => {
      const ma = isMeasureTable(a) ? 0 : 1
      const mb = isMeasureTable(b) ? 0 : 1
      return ma - mb || cmp(a.name, b.name)
    })
  const out: TreeNode[] = []
  for (const t of tables) {
    const children = tableChildren(t, showHidden)
    if (!q) {
      out.push({ kind: 'table', key: `tbl:${t.name}`, table: t, children })
      continue
    }
    if (t.name.toLowerCase().includes(q)) out.push({ kind: 'table', key: `tbl:${t.name}`, table: t, children })
    else {
      const kids = filterNodes(children, q)
      if (kids.length) out.push({ kind: 'table', key: `tbl:${t.name}`, table: t, children: kids })
    }
  }
  return out
}

/** Keys of every expandable node (for "Expand all"). */
export function expandableKeys(nodes: TreeNode[]): string[] {
  const out: string[] = []
  const walk = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.kind === 'table' || n.kind === 'folder' || n.kind === 'hierarchy') {
        out.push(n.key)
        walk(n.children)
      }
    }
  }
  walk(nodes)
  return out
}
