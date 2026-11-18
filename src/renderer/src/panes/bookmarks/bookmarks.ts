/**
 * Bookmarks pane document operations over `report.bookmarks` + `report.bookmarksMeta`
 * (PBIR bookmarks.json: `items: [{ name } | { name, displayName, children: [names] }]`).
 * Capture / apply / add / update / delete live in report/runtime.ts (canvas workstream); this module
 * only handles naming, grouping, ordering and options. Pure — tested in bookmarks.test.ts.
 */
import type { ReportDocument } from '@core/report/types'
import { newObjectName } from '../../report/pbir'

const META_SCHEMA = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/bookmarksMetadata/1.0.0/schema.json'

export type BookmarkNode =
  | { kind: 'bookmark'; name: string; displayName: string; group?: string }
  | { kind: 'group'; name: string; displayName: string; children: Array<{ kind: 'bookmark'; name: string; displayName: string; group: string }> }

function meta(report: ReportDocument): { items: any[] } {
  report.bookmarksMeta ??= { $schema: META_SCHEMA, items: [] }
  report.bookmarksMeta.items ??= []
  return report.bookmarksMeta
}

function displayNameOf(report: ReportDocument, name: string): string {
  return report.bookmarks.find((b) => b.name === name)?.json?.displayName ?? name
}

/** Tree in bookmarks.json order; bookmarks missing from the metadata are appended. */
export function bookmarkTree(report: ReportDocument | undefined): BookmarkNode[] {
  if (!report) return []
  const exists = new Set(report.bookmarks.map((b) => b.name))
  const seen = new Set<string>()
  const out: BookmarkNode[] = []
  for (const item of report.bookmarksMeta?.items ?? []) {
    if (Array.isArray(item.children)) {
      const children = (item.children as string[])
        .filter((c) => exists.has(c) && !seen.has(c))
        .map((c) => {
          seen.add(c)
          return { kind: 'bookmark' as const, name: c, displayName: displayNameOf(report, c), group: item.name as string }
        })
      out.push({ kind: 'group', name: item.name, displayName: item.displayName ?? item.name, children })
    } else if (item.name && exists.has(item.name) && !seen.has(item.name)) {
      seen.add(item.name)
      out.push({ kind: 'bookmark', name: item.name, displayName: displayNameOf(report, item.name) })
    }
  }
  for (const b of report.bookmarks) if (!seen.has(b.name)) out.push({ kind: 'bookmark', name: b.name, displayName: b.json?.displayName ?? b.name })
  return out
}

/** Flat play order (View mode / next-previous). */
export function playOrder(report: ReportDocument | undefined): string[] {
  return bookmarkTree(report).flatMap((n) => (n.kind === 'group' ? n.children.map((c) => c.name) : [n.name]))
}

export function renameBookmark(report: ReportDocument, name: string, displayName: string): void {
  const b = report.bookmarks.find((x) => x.name === name)
  if (b) {
    b.json = { ...b.json, displayName }
    return
  }
  const g = meta(report).items.find((i) => i.name === name && Array.isArray(i.children))
  if (g) g.displayName = displayName
}

export type BookmarkOption = 'data' | 'display' | 'currentPage' | 'allVisuals'

/** Read the PBI option checkboxes (Data / Display / Current page / All visuals vs Selected visuals). */
export function bookmarkOptions(report: ReportDocument, name: string): Record<BookmarkOption, boolean> & { targetVisualNames: string[] } {
  const o = report.bookmarks.find((b) => b.name === name)?.json?.options ?? {}
  return {
    data: !o.suppressData,
    display: !o.suppressDisplay,
    currentPage: !o.suppressActiveSection,
    allVisuals: !o.applyOnlyToTargetVisuals,
    targetVisualNames: o.targetVisualNames ?? []
  }
}

/** Toggle an option. `selectedVisuals` = names used when switching to "Selected visuals". */
export function setBookmarkOption(report: ReportDocument, name: string, option: BookmarkOption, on: boolean, selectedVisuals: string[] = []): void {
  const b = report.bookmarks.find((x) => x.name === name)
  if (!b) return
  const o: any = { ...(b.json?.options ?? {}) }
  if (option === 'data') on ? delete o.suppressData : (o.suppressData = true)
  if (option === 'display') on ? delete o.suppressDisplay : (o.suppressDisplay = true)
  if (option === 'currentPage') on ? delete o.suppressActiveSection : (o.suppressActiveSection = true)
  if (option === 'allVisuals') {
    if (on) {
      delete o.applyOnlyToTargetVisuals
      delete o.targetVisualNames
    } else {
      o.applyOnlyToTargetVisuals = true
      o.targetVisualNames = [...selectedVisuals]
    }
  }
  b.json = { ...b.json }
  if (Object.keys(o).length) b.json.options = o
  else delete b.json.options
}

/** Group bookmarks (top-level ones) into a new group placed where the first one was. Returns the group name. */
export function groupBookmarks(report: ReportDocument, names: string[], displayName = 'Group'): string | undefined {
  const m = meta(report)
  // make sure every bookmark has a top-level item so order is explicit
  for (const n of bookmarkTree(report)) if (n.kind === 'bookmark' && !m.items.some((i) => i.name === n.name)) m.items.push({ name: n.name })
  const idx = m.items.findIndex((i) => !Array.isArray(i.children) && names.includes(i.name))
  if (idx < 0) return undefined
  const picked = m.items.filter((i) => !Array.isArray(i.children) && names.includes(i.name)).map((i) => i.name as string)
  const name = newObjectName()
  const rest = m.items.filter((i) => Array.isArray(i.children) || !picked.includes(i.name))
  const at = m.items.slice(0, idx).filter((i) => Array.isArray(i.children) || !picked.includes(i.name)).length
  rest.splice(at, 0, { name, displayName, children: picked })
  m.items = rest
  return name
}

/** Ungroup: children return to the top level at the group's position. */
export function ungroupBookmarks(report: ReportDocument, groupName: string): void {
  const m = meta(report)
  const idx = m.items.findIndex((i) => i.name === groupName && Array.isArray(i.children))
  if (idx < 0) return
  const children = (m.items[idx].children as string[]).map((c) => ({ name: c }))
  m.items.splice(idx, 1, ...children)
}

/** Move a bookmark (or group) one step up/down among its siblings. */
export function moveBookmark(report: ReportDocument, name: string, dir: -1 | 1): void {
  const m = meta(report)
  for (const n of bookmarkTree(report)) if (n.kind === 'bookmark' && !n.group && !m.items.some((i) => i.name === n.name)) m.items.push({ name: n.name })
  const swap = (arr: any[], i: number) => {
    const j = i + dir
    if (i < 0 || j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  const top = m.items.findIndex((i) => i.name === name)
  if (top >= 0) return swap(m.items, top)
  for (const g of m.items) {
    if (!Array.isArray(g.children)) continue
    const k = g.children.indexOf(name)
    if (k >= 0) {
      g.children = [...g.children]
      return swap(g.children, k)
    }
  }
}
