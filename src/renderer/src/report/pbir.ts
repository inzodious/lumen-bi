/**
 * Small, pure helpers over the PBIR report document (pages, visuals, groups, slicers, filter cards).
 * No React / DOM here so the logic is unit-testable and reusable by panes / exports.
 */
import type { PageDocument, ReportDocument, VisualDocument } from '@core/report/types'
import { fieldKey, type SQExpr, type SQFilter } from '@core/report/sq'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A filter card as stored in report.json / page.json / visual.json `filterConfig.filters[]`. */
export interface FilterCard {
  name: string
  field?: SQExpr
  type?: string
  filter?: SQFilter
  howCreated?: string
  isHiddenInViewMode?: boolean
  isLockedInViewMode?: boolean
  ordinal?: number
  objects?: any
  [k: string]: any
}

export interface PageInfo {
  name: string
  displayName: string
  hidden: boolean
  isTooltip: boolean
  isDrillthrough: boolean
  width: number
  height: number
}

/** PBI-style object name: 20 lowercase hex chars. */
export function newObjectName(): string {
  const bytes = new Uint8Array(10)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function visualTypeOf(v: VisualDocument | undefined): string {
  if (!v) return 'unknown'
  if (v.json?.visualGroup) return 'group'
  return v.json?.visual?.visualType ?? 'unknown'
}

export function isGroup(v: VisualDocument | undefined): boolean {
  return !!v?.json?.visualGroup
}

export function isHiddenVisual(v: VisualDocument): boolean {
  return v.json?.isHidden === true
}

/** Slicer-like visual types (native + common custom slicers). */
export function isSlicerType(visualType: string): boolean {
  return /slicer/i.test(visualType)
}

export function parentOf(v: VisualDocument): string | undefined {
  return v.json?.parentGroupName ?? undefined
}

export function positionOf(v: VisualDocument): Rect & { z: number; tabOrder: number } {
  const p = v.json?.position ?? {}
  return { x: p.x ?? 0, y: p.y ?? 0, width: p.width ?? 0, height: p.height ?? 0, z: p.z ?? 0, tabOrder: p.tabOrder ?? 0 }
}

/** Absolute (page-space) rect of a visual: group children are positioned relative to their parent group. */
export function absoluteRect(page: PageDocument, v: VisualDocument): Rect {
  const r = positionOf(v)
  let x = r.x
  let y = r.y
  let parent = parentOf(v)
  const seen = new Set<string>()
  while (parent && !seen.has(parent)) {
    seen.add(parent)
    const g = page.visuals.find((o) => o.name === parent)
    if (!g) break
    const gp = positionOf(g)
    x += gp.x
    y += gp.y
    parent = parentOf(g)
  }
  return { x, y, width: r.width, height: r.height }
}

/** Absolute origin of a group's coordinate space (sum of ancestor positions). */
export function groupOrigin(page: PageDocument, groupName: string | undefined): { x: number; y: number } {
  if (!groupName) return { x: 0, y: 0 }
  const g = page.visuals.find((o) => o.name === groupName)
  if (!g) return { x: 0, y: 0 }
  const r = absoluteRect(page, g)
  return { x: r.x, y: r.y }
}

/** Visual effectively hidden (itself or any ancestor group hidden). */
export function isEffectivelyHidden(page: PageDocument, v: VisualDocument): boolean {
  let cur: VisualDocument | undefined = v
  const seen = new Set<string>()
  while (cur && !seen.has(cur.name)) {
    if (isHiddenVisual(cur)) return true
    seen.add(cur.name)
    const p = parentOf(cur)
    cur = p ? page.visuals.find((o) => o.name === p) : undefined
  }
  return false
}

export function childrenOf(page: PageDocument, groupName: string | undefined): VisualDocument[] {
  return page.visuals.filter((v) => (parentOf(v) ?? undefined) === groupName || (!groupName && !page.visuals.some((g) => g.name === parentOf(v))))
}

/** All descendants (recursive) of a group. */
export function descendantsOf(page: PageDocument, groupName: string): VisualDocument[] {
  const out: VisualDocument[] = []
  const walk = (g: string) => {
    for (const v of page.visuals) {
      if (parentOf(v) === g) {
        out.push(v)
        if (isGroup(v)) walk(v.name)
      }
    }
  }
  walk(groupName)
  return out
}

/** Top-most ancestor group (or the visual itself) — what a click on the canvas selects in PBI. */
export function topAncestor(page: PageDocument, v: VisualDocument): VisualDocument {
  let cur = v
  const seen = new Set<string>()
  for (;;) {
    const p = parentOf(cur)
    if (!p || seen.has(p)) return cur
    seen.add(p)
    const g = page.visuals.find((o) => o.name === p)
    if (!g) return cur
    cur = g
  }
}

export function pageType(page: PageDocument): 'tooltip' | 'drillthrough' | 'normal' {
  const j = page.json ?? {}
  const bt = j.pageBinding?.type
  if (bt === 'Tooltip' || j.type === 'Tooltip') return 'tooltip'
  if (bt === 'Drillthrough' || j.type === 'Drillthrough') return 'drillthrough'
  if ((j.filterConfig?.filters ?? []).some((f: FilterCard) => f.howCreated === 'Drillthrough')) return 'drillthrough'
  return 'normal'
}

export function pageInfo(page: PageDocument): PageInfo {
  const t = pageType(page)
  return {
    name: page.name,
    displayName: page.json?.displayName ?? page.name,
    hidden: page.json?.visibility === 'HiddenInViewMode',
    isTooltip: t === 'tooltip',
    isDrillthrough: t === 'drillthrough',
    width: page.json?.width ?? 1280,
    height: page.json?.height ?? 720
  }
}

/** Pages in pages.json order (pages missing from the order list are appended). */
export function orderedPages(report: ReportDocument): PageDocument[] {
  const order = report.pagesMeta?.pageOrder ?? []
  const byName = new Map(report.pages.map((p) => [p.name, p]))
  const out: PageDocument[] = []
  for (const n of order) {
    const p = byName.get(n)
    if (p) {
      out.push(p)
      byName.delete(n)
    }
  }
  for (const p of report.pages) if (byName.has(p.name)) out.push(p)
  return out
}

export function findPage(report: ReportDocument | undefined, name: string | null | undefined): PageDocument | undefined {
  if (!report || !name) return undefined
  return report.pages.find((p) => p.name === name)
}

export function findVisual(page: PageDocument | undefined, name: string): VisualDocument | undefined {
  return page?.visuals.find((v) => v.name === name)
}

export function filterCards(json: any): FilterCard[] {
  return (json?.filterConfig?.filters ?? []) as FilterCard[]
}

/** Drill-through fields of a drillthrough target page (page filter cards created by "Drillthrough" or bound in pageBinding). */
export function drillthroughFields(page: PageDocument): Array<{ card: FilterCard; field: SQExpr; key: string }> {
  const bound = new Set<string>((page.json?.pageBinding?.parameters ?? []).map((p: any) => p.boundFilter).filter(Boolean))
  const out: Array<{ card: FilterCard; field: SQExpr; key: string }> = []
  for (const c of filterCards(page.json)) {
    if (!c.field) continue
    if (c.howCreated === 'Drillthrough' || bound.has(c.name)) out.push({ card: c, field: c.field, key: fieldKey(c.field) })
  }
  return out
}

/** "Keep all filters" toggle of a drillthrough page (PBIR `pageBinding.acceptsFilterContext`, default on). */
export function keepsAllFilters(page: PageDocument): boolean {
  return page.json?.pageBinding?.acceptsFilterContext !== 'None'
}

/** Saved slicer selection (`visual.objects.general[0].properties.filter.filter`). */
export function savedSlicerFilter(visualJson: any): SQFilter | undefined {
  const entries: any[] = visualJson?.visual?.objects?.general ?? []
  for (const e of entries) {
    const f = e?.properties?.filter
    if (f?.filter?.Where) return f.filter as SQFilter
  }
  return undefined
}

/** Write (or clear) the saved slicer selection into a visual JSON (mutates). */
export function writeSlicerFilter(visualJson: any, filter: SQFilter | undefined): void {
  const v = visualJson.visual
  if (!v) return
  v.objects ??= {}
  const general: any[] = (v.objects.general ??= [])
  let entry = general.find((e) => !e.selector)
  if (!entry) {
    entry = { properties: {} }
    general.push(entry)
  }
  entry.properties ??= {}
  if (filter) entry.properties.filter = { filter }
  else delete entry.properties.filter
}

export interface SyncGroup {
  groupName: string
  fieldChanges: boolean
  filterChanges: boolean
}

export function syncGroupOf(visualJson: any): SyncGroup | undefined {
  const s = visualJson?.visual?.syncGroup
  if (!s?.groupName) return undefined
  return { groupName: s.groupName, fieldChanges: s.fieldChanges !== false, filterChanges: s.filterChanges !== false }
}

/** Fields (SQ exprs) in a visual's field wells, in role order. */
export function visualFields(visualJson: any): Array<{ role: string; expr: SQExpr; queryRef: string; displayName?: string }> {
  const qs = visualJson?.visual?.query?.queryState ?? {}
  const out: Array<{ role: string; expr: SQExpr; queryRef: string; displayName?: string }> = []
  for (const [role, bucket] of Object.entries<any>(qs)) {
    for (const p of bucket?.projections ?? []) out.push({ role, expr: p.field, queryRef: p.queryRef, displayName: p.displayName })
  }
  return out
}

/** Report setting "cross-filter by default instead of cross-highlight". */
export function defaultInteractionIsFilter(report: ReportDocument | undefined): boolean {
  return report?.report?.settings?.defaultFilterActionIsDataFilter === true
}

/** Does drilling in this visual filter other visuals on the page? */
export function drillFiltersOthers(report: ReportDocument | undefined, visualJson: any): boolean {
  const own = visualJson?.visual?.drillFilterOtherVisuals
  if (typeof own === 'boolean') return own
  return report?.report?.settings?.defaultDrillFilterOtherVisuals !== false
}

/** Bookmark list flattened from bookmarks.json (groups → children). */
export function bookmarkList(report: ReportDocument | undefined): Array<{ name: string; displayName: string; group?: string }> {
  if (!report) return []
  const byName = new Map(report.bookmarks.map((b) => [b.name, b]))
  const out: Array<{ name: string; displayName: string; group?: string }> = []
  const seen = new Set<string>()
  for (const item of report.bookmarksMeta?.items ?? []) {
    if (Array.isArray(item.children)) {
      for (const c of item.children) {
        const b = byName.get(c)
        if (b && !seen.has(c)) {
          seen.add(c)
          out.push({ name: c, displayName: b.json?.displayName ?? c, group: item.displayName ?? item.name })
        }
      }
    } else if (item.name && byName.has(item.name) && !seen.has(item.name)) {
      seen.add(item.name)
      out.push({ name: item.name, displayName: byName.get(item.name)!.json?.displayName ?? item.name })
    }
  }
  for (const b of report.bookmarks) if (!seen.has(b.name)) out.push({ name: b.name, displayName: b.json?.displayName ?? b.name })
  return out
}
