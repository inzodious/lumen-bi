/**
 * Page selection for page-based report exports (PDF, PowerPoint, images, HTML).
 *
 * Pure model (no React, no store) so it is unit-testable; the dialog (dialogs/ExportPagesDialog.tsx) and the
 * exporters (export/index.ts, export/capture.ts) share it.
 *
 *   exportPageEntries(report)     every page in report order, with hidden / tooltip / drillthrough flags
 *   defaultSelection(pages)       every page except tooltip pages, hidden pages included
 *   quickSelection(kind, …)       All / None / Visible only / Current page
 *   selectionState(pages, sel)    tri-state of the "Select all" header checkbox
 *   rangeSelection(…)             shift-click range
 *   reconcileSelection(mem, …)    remembered selection kept valid after pages are added / removed / renamed
 *   orderedSelection(pages, sel)  selected page names in report order (what the exporters receive)
 *
 * Pages are identified by their PBIR `name` (stable id), never by display name, so a rename keeps the selection.
 */
import type { ReportDocument } from '@core/report/types'
import { orderedPages, pageInfo } from '../report/pbir'

export type ExportPageKind = 'normal' | 'tooltip' | 'drillthrough'

export interface ExportPageEntry {
  /** PBIR page name (id) */
  name: string
  displayName: string
  /** hidden in view mode (reachable only through navigation buttons, bookmarks, drillthrough…) */
  hidden: boolean
  kind: ExportPageKind
  /** page size in CSS px */
  width: number
  height: number
}

/** Options shared by every page-based export. */
export interface PageExportOptions {
  /** page names to export; they are always exported in report order. Default: defaultSelection(). */
  pages?: string[]
}

/** Every page of the report in report order. */
export function exportPageEntries(report: ReportDocument | null | undefined): ExportPageEntry[] {
  if (!report) return []
  return orderedPages(report).map((p) => {
    const i = pageInfo(p)
    return {
      name: p.name,
      displayName: String(i.displayName ?? p.name),
      hidden: i.hidden,
      kind: i.isTooltip ? 'tooltip' : i.isDrillthrough ? 'drillthrough' : 'normal',
      width: Number(i.width) || 1280,
      height: Number(i.height) || 720
    }
  })
}

/** Default: every page except tooltip pages; hidden pages included (reports often keep one visible landing page). */
export function defaultSelection(pages: readonly ExportPageEntry[]): string[] {
  return pages.filter((p) => p.kind !== 'tooltip').map((p) => p.name)
}

export type QuickSelection = 'all' | 'none' | 'visible' | 'current'

export function quickSelection(kind: QuickSelection, pages: readonly ExportPageEntry[], currentPage?: string | null): string[] {
  switch (kind) {
    case 'all':
      return pages.map((p) => p.name)
    case 'none':
      return []
    case 'visible':
      return pages.filter((p) => !p.hidden && p.kind !== 'tooltip').map((p) => p.name)
    case 'current':
      return currentPage && pages.some((p) => p.name === currentPage) ? [currentPage] : []
  }
}

/** Header checkbox: true (all), false (none), 'mixed' (some). */
export function selectionState(pages: readonly ExportPageEntry[], selected: ReadonlySet<string>): boolean | 'mixed' {
  const n = pages.filter((p) => selected.has(p.name)).length
  if (n === 0) return false
  return n === pages.length ? true : 'mixed'
}

/** Selected page names in report order (unknown names dropped). */
export function orderedSelection(pages: readonly ExportPageEntry[], selected: Iterable<string>): string[] {
  const set = selected instanceof Set ? (selected as Set<string>) : new Set(selected)
  return pages.filter((p) => set.has(p.name)).map((p) => p.name)
}

/** Toggle one page. */
export function toggleSelection(selected: ReadonlySet<string>, name: string, on = !selected.has(name)): Set<string> {
  const next = new Set(selected)
  if (on) next.add(name)
  else next.delete(name)
  return next
}

/** Shift-click: set every page between the anchor and the target (inclusive, report order) to `on`. */
export function rangeSelection(pages: readonly ExportPageEntry[], selected: ReadonlySet<string>, anchor: string | null, target: string, on: boolean): Set<string> {
  const ti = pages.findIndex((p) => p.name === target)
  const ai = anchor ? pages.findIndex((p) => p.name === anchor) : -1
  if (ti < 0) return new Set(selected)
  if (ai < 0) return toggleSelection(selected, target, on)
  const next = new Set(selected)
  for (let i = Math.min(ai, ti); i <= Math.max(ai, ti); i++) {
    if (on) next.add(pages[i].name)
    else next.delete(pages[i].name)
  }
  return next
}

/** A remembered selection: the chosen pages plus every page that existed when it was made. */
export interface RememberedSelection {
  selected: string[]
  known: string[]
}

/**
 * Re-apply a remembered selection to the current pages: removed pages drop out, renamed pages keep their state
 * (same id), and pages added since then follow the default (ticked unless they are tooltip pages).
 */
export function reconcileSelection(mem: RememberedSelection | undefined, pages: readonly ExportPageEntry[]): string[] {
  if (!mem) return defaultSelection(pages)
  const sel = new Set(mem.selected)
  const known = new Set(mem.known)
  return pages.filter((p) => (known.has(p.name) ? sel.has(p.name) : p.kind !== 'tooltip')).map((p) => p.name)
}

// ---- session memory (per report, this session only; the app has no per-report UI state file) ------------------

const memory = new Map<string, RememberedSelection>()

export function rememberSelection(reportKey: string, pages: readonly ExportPageEntry[], selected: Iterable<string>): void {
  memory.set(reportKey, { selected: orderedSelection(pages, selected), known: pages.map((p) => p.name) })
}

export function recallSelection(reportKey: string, pages: readonly ExportPageEntry[]): string[] {
  return reconcileSelection(memory.get(reportKey), pages)
}

/** Test helper. */
export function forgetSelections(): void {
  memory.clear()
}
