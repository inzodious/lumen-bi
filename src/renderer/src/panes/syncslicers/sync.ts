/**
 * Sync slicers (pure). PBIR: synced slicers on different pages share
 * `visual.syncGroup = { groupName, fieldChanges, filterChanges }`; a page that syncs but doesn't show
 * the slicer holds a hidden copy (`isHidden: true`) — the same thing PBI Desktop writes.
 * Tested in sync.test.ts.
 */
import type { PageDocument, ReportDocument, VisualDocument } from '@core/report/types'
import { fieldInfo } from '@core/report/sq'
import { findPage, findVisual, newObjectName, orderedPages, pageType, positionOf, syncGroupOf, visualFields } from '../../report/pbir'
import { cloneDeep } from '@core/clone'

export interface SyncRow {
  page: string
  displayName: string
  /** synced copy on this page (or the source slicer itself) */
  visual?: string
  synced: boolean
  visible: boolean
  isSource: boolean
}

export interface SyncState {
  groupName: string
  fieldChanges: boolean
  filterChanges: boolean
  hasGroup: boolean
  rows: SyncRow[]
}

/** PBI's default group name: the slicer field's name (made unique among other fields' groups). */
export function defaultGroupName(report: ReportDocument, visualJson: any): string {
  const f = visualFields(visualJson)[0]
  const info = f ? fieldInfo(f.expr) : undefined
  const base = info?.property ?? 'Slicer'
  const taken = new Set<string>()
  for (const p of report.pages) for (const v of p.visuals) {
    const g = syncGroupOf(v.json)
    if (g && v.json !== visualJson) taken.add(g.groupName)
  }
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`
}

function memberOn(page: PageDocument, groupName: string): VisualDocument | undefined {
  return page.visuals.find((v) => syncGroupOf(v.json)?.groupName === groupName)
}

export function syncState(report: ReportDocument, pageName: string, visualName: string): SyncState | undefined {
  const src = findVisual(findPage(report, pageName), visualName)
  if (!src) return undefined
  const sg = syncGroupOf(src.json)
  const groupName = sg?.groupName ?? defaultGroupName(report, src.json)
  const rows: SyncRow[] = []
  for (const p of orderedPages(report)) {
    if (pageType(p) === 'tooltip') continue
    const isSource = p.name === pageName
    const member = isSource ? src : sg ? memberOn(p, sg.groupName) : undefined
    rows.push({
      page: p.name,
      displayName: p.json?.displayName ?? p.name,
      visual: member?.name,
      synced: isSource ? !!sg : !!member,
      visible: !!member && member.json?.isHidden !== true,
      isSource
    })
  }
  return { groupName, fieldChanges: sg?.fieldChanges ?? true, filterChanges: sg?.filterChanges ?? true, hasGroup: !!sg, rows }
}

function ensureGroup(report: ReportDocument, src: VisualDocument): { groupName: string; fieldChanges: boolean; filterChanges: boolean } {
  const existing = syncGroupOf(src.json)
  if (existing) return existing
  const g = { groupName: defaultGroupName(report, src.json), fieldChanges: true, filterChanges: true }
  src.json.visual.syncGroup = { ...g }
  return g
}

function copyTo(page: PageDocument, src: VisualDocument, group: { groupName: string; fieldChanges: boolean; filterChanges: boolean }, hidden: boolean): string {
  const json = cloneDeep(src.json)
  const name = newObjectName()
  json.name = name
  delete json.parentGroupName
  const z = page.visuals.reduce((m, v) => Math.max(m, positionOf(v).z), -1000) + 1000
  const pw = Number(page.json?.width ?? 1280)
  const ph = Number(page.json?.height ?? 720)
  json.position = { ...json.position, z, tabOrder: z }
  if (json.position.x + json.position.width > pw) json.position.x = Math.max(0, pw - json.position.width)
  if (json.position.y + json.position.height > ph) json.position.y = Math.max(0, ph - json.position.height)
  json.visual.syncGroup = { ...group }
  if (hidden) json.isHidden = true
  else delete json.isHidden
  page.visuals.push({ name, json })
  return name
}

/** Sync checkbox for a page. */
export function setPageSync(report: ReportDocument, pageName: string, visualName: string, targetPage: string, sync: boolean): void {
  const src = findVisual(findPage(report, pageName), visualName)
  const target = findPage(report, targetPage)
  if (!src || !target) return
  if (targetPage === pageName) {
    if (sync) ensureGroup(report, src)
    else delete src.json.visual.syncGroup
    return
  }
  const group = ensureGroup(report, src)
  const member = memberOn(target, group.groupName)
  if (sync) {
    if (!member) copyTo(target, src, group, true)
  } else if (member) {
    if (member.json.isHidden) target.visuals = target.visuals.filter((v) => v !== member)
    else delete member.json.visual.syncGroup
  }
}

/** Visible checkbox for a page (making it visible on a new page also syncs it, like PBI). */
export function setPageVisible(report: ReportDocument, pageName: string, visualName: string, targetPage: string, visible: boolean): void {
  const src = findVisual(findPage(report, pageName), visualName)
  const target = findPage(report, targetPage)
  if (!src || !target) return
  if (targetPage === pageName) {
    if (visible) delete src.json.isHidden
    else src.json.isHidden = true
    return
  }
  const group = ensureGroup(report, src)
  const member = memberOn(target, group.groupName)
  if (!member) {
    if (visible) copyTo(target, src, group, false)
    return
  }
  if (visible) delete member.json.isHidden
  else member.json.isHidden = true
}

/** "Add and sync with all pages". */
export function syncAllPages(report: ReportDocument, pageName: string, visualName: string): void {
  for (const p of report.pages) {
    if (p.name === pageName || pageType(p) === 'tooltip') continue
    setPageVisible(report, pageName, visualName, p.name, true)
  }
  const src = findVisual(findPage(report, pageName), visualName)
  if (src) ensureGroup(report, src)
}

/** Advanced options: rename the group / toggle field & filter sync on every member. */
export function setGroupOptions(report: ReportDocument, pageName: string, visualName: string, patch: Partial<{ groupName: string; fieldChanges: boolean; filterChanges: boolean }>): void {
  const src = findVisual(findPage(report, pageName), visualName)
  if (!src) return
  const old = ensureGroup(report, src).groupName
  for (const p of report.pages)
    for (const v of p.visuals) {
      const g = v.json?.visual?.syncGroup
      if (g?.groupName !== old) continue
      if (patch.groupName !== undefined && patch.groupName.trim()) g.groupName = patch.groupName.trim()
      if (patch.fieldChanges !== undefined) g.fieldChanges = patch.fieldChanges
      if (patch.filterChanges !== undefined) g.filterChanges = patch.filterChanges
    }
}

/**
 * "Sync field changes to other slicers": after the fields of a synced slicer changed, copy its field wells (and sort)
 * to every other slicer of the same sync group that also syncs field changes. Their saved selection is cleared
 * when the field changed (a selection on the old field no longer applies). Returns the updated visuals' names.
 */
export function propagateSlicerFields(report: ReportDocument, pageName: string, visualName: string): string[] {
  const src = findVisual(findPage(report, pageName), visualName)
  const sg = src ? syncGroupOf(src.json) : undefined
  if (!src || !sg?.fieldChanges) return []
  const query = src.json.visual?.query
  const key = JSON.stringify(query?.queryState ?? {})
  const updated: string[] = []
  for (const p of report.pages) {
    for (const v of p.visuals) {
      if (v === src || (p.name === pageName && v.name === visualName)) continue
      const g = syncGroupOf(v.json)
      if (!g || g.groupName !== sg.groupName || !g.fieldChanges || !v.json.visual) continue
      if (JSON.stringify(v.json.visual.query?.queryState ?? {}) === key) continue
      v.json.visual.query = cloneDeep(query ?? {})
      const general = v.json.visual.objects?.general
      if (Array.isArray(general)) for (const e of general) if (e?.properties?.filter) delete e.properties.filter
      updated.push(v.name)
    }
  }
  return updated
}
