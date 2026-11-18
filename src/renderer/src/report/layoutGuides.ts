/**
 * Layout guides (page margin + gutter between visuals) persisted per report.
 *
 * Stored in `definition/report.json` under the Lumen-only object `objects.lumenLayout` (PBI Desktop ignores unknown
 * report objects, like the slicer's `lumenSlicer`):
 *
 *   "objects": { "lumenLayout": [{ "properties": { "margin": { "expr": { "Literal": { "Value": "16D" } } },
 *                                                   "gutter": { "expr": { "Literal": { "Value": "16D" } } } } }] }
 *
 * Only non-default values are written; setting the guides back to none removes the object (and an `objects` map
 * that became empty), so untouched reports save byte-identically.
 */
import { useApp } from '../state/store'
import type { ReportDocument } from '@core/report/types'
import type { LayoutGuides } from './geometry'

export const LUMEN_LAYOUT_OBJECT = 'lumenLayout'
export const NO_LAYOUT_GUIDES: LayoutGuides = Object.freeze({ margin: 0, gutter: 0 }) as LayoutGuides

function num(raw: any): number {
  const v = raw?.expr?.Literal?.Value
  if (typeof v !== 'string') return 0
  const n = Number(v.replace(/[DLM]$/i, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Layout guides of a report (`report.json` object), none when absent. */
export function readLayoutGuides(reportJson: any): LayoutGuides {
  const p = reportJson?.objects?.[LUMEN_LAYOUT_OBJECT]?.[0]?.properties
  if (!p) return NO_LAYOUT_GUIDES
  return { margin: num(p.margin), gutter: num(p.gutter) }
}

/** Write (or clear) the layout guides into a mutable `report.json`. Returns true when something changed. */
export function writeLayoutGuides(reportJson: any, layout: LayoutGuides): boolean {
  if (!reportJson) return false
  const cur = readLayoutGuides(reportJson)
  const margin = Math.max(0, Math.round(layout.margin))
  const gutter = Math.max(0, Math.round(layout.gutter))
  if (cur.margin === margin && cur.gutter === gutter && (margin || gutter || !reportJson.objects?.[LUMEN_LAYOUT_OBJECT])) return false
  const lit = (n: number) => ({ expr: { Literal: { Value: `${n}D` } } })
  if (!margin && !gutter) {
    if (reportJson.objects) {
      delete reportJson.objects[LUMEN_LAYOUT_OBJECT]
      if (!Object.keys(reportJson.objects).length) delete reportJson.objects
    }
    return true
  }
  const properties: Record<string, unknown> = {}
  if (margin) properties.margin = lit(margin)
  if (gutter) properties.gutter = lit(gutter)
  reportJson.objects ??= {}
  reportJson.objects[LUMEN_LAYOUT_OBJECT] = [{ properties }]
  return true
}

/** Current report's layout guides (non-reactive read, for event handlers). */
export function currentLayoutGuides(report?: ReportDocument | null): LayoutGuides {
  return readLayoutGuides((report ?? useApp.getState().project?.report)?.report)
}

/** Reactive layout guides of the open report. */
export function useLayoutGuides(): LayoutGuides {
  const json = useApp((s) => s.project?.report?.report)
  const p = json?.objects?.[LUMEN_LAYOUT_OBJECT]?.[0]?.properties
  // memo by the two values so consumers get a stable object
  const m = num(p?.margin)
  const g = num(p?.gutter)
  return m || g ? cached(m, g) : NO_LAYOUT_GUIDES
}

let last: LayoutGuides = NO_LAYOUT_GUIDES
function cached(margin: number, gutter: number): LayoutGuides {
  if (last.margin !== margin || last.gutter !== gutter) last = { margin, gutter }
  return last
}

/** Undoable edit of the open report's layout guides (View ▸ Layout guides). */
export function setLayoutGuides(layout: LayoutGuides): void {
  useApp.getState().mutateReport('Layout guides', (r) => {
    writeLayoutGuides(r.report, layout)
  })
}
