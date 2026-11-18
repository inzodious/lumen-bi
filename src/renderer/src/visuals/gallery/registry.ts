/**
 * Gallery entry registry + helpers to build PBIR visual.json fixtures.
 *
 * Other visual workstreams add entries by creating `visuals/<family>/gallery.ts` that calls
 * `registerGalleryEntries([...])` — Gallery.tsx eagerly imports every such module.
 * Fixtures must use the neutral sample model (see sampleData.ts): tables Sales, Pipeline.
 */
import type { SQExpr, SQFilter, DataPointIdentity } from '@core/report/sq'
import { aggregationExpr, columnExpr, defaultQueryRef, measureExpr } from '@core/report/sq'
import { literalProp } from '@core/report/props'
import type { Scalar } from '@core/model/data'
import type { DrillState, ReportInfo } from '../contract'
import type { QueryEngine } from '@core/engine/api'

export interface GalleryEntry {
  id: string
  /** grouping heading */
  section: string
  title: string
  /** visual.json (visualContainer) */
  json: any
  width?: number
  height?: number
  /** simulate another visual cross-highlighting this one */
  highlightFilters?: SQFilter[]
  /** initial selection */
  selection?: DataPointIdentity[]
  drill?: Partial<DrillState>
  note?: string
  /** per-entry engine (non-chart families use their own sample model, common/sampleData.ts) */
  engine?: QueryEngine
  /** per-entry report info (pages/bookmarks for navigators) */
  report?: ReportInfo
  /** filters applied to the visual */
  filters?: SQFilter[]
  mode?: 'view' | 'edit'
}

const entries: GalleryEntry[] = []

export function registerGalleryEntries(list: GalleryEntry[]): void {
  for (const e of list) {
    const i = entries.findIndex((x) => x.id === e.id)
    if (i >= 0) entries[i] = e
    else entries.push(e)
  }
}

export function galleryEntries(): GalleryEntry[] {
  return entries
}

// ------------------------------------------------------------------------------------------------
// Fixture builders
// ------------------------------------------------------------------------------------------------

export const col = (table: string, column: string): SQExpr => columnExpr(table, column)
export const msr = (table: string, measure: string): SQExpr => measureExpr(table, measure)
export const sum = (table: string, column: string): SQExpr => aggregationExpr(table, column, 0)
export const level = (table: string, hierarchy: string, lvl: string): SQExpr => ({
  HierarchyLevel: { Expression: { Hierarchy: { Expression: { SourceRef: { Entity: table } }, Hierarchy: hierarchy } }, Level: lvl }
})

export type Wells = Record<string, Array<SQExpr | { expr: SQExpr; displayName?: string; active?: boolean }>>

/** Build a visual.json (visualContainer) for a visualType with field wells and formatting objects. */
export function visualJson(
  name: string,
  visualType: string,
  wells: Wells,
  opts: {
    objects?: Record<string, Array<{ properties: Record<string, any>; selector?: any }>>
    sort?: Array<{ field: SQExpr; direction: 'Ascending' | 'Descending' }>
    title?: string
    container?: Record<string, any>
  } = {}
): any {
  const queryState: Record<string, any> = {}
  for (const [role, list] of Object.entries(wells)) {
    queryState[role] = {
      projections: list.map((x, i) => {
        const p = 'expr' in (x as any) ? (x as { expr: SQExpr; displayName?: string; active?: boolean }) : { expr: x as SQExpr }
        return {
          field: p.expr,
          queryRef: defaultQueryRef(p.expr),
          nativeQueryRef: defaultQueryRef(p.expr).split('.').pop(),
          ...(p.displayName ? { displayName: p.displayName } : {}),
          ...(role === 'Category' || role === 'Rows' ? { active: p.active ?? i === 0 } : {})
        }
      })
    }
  }
  return {
    name,
    position: { x: 0, y: 0, z: 0, width: 400, height: 300 },
    visual: {
      visualType,
      query: { queryState, ...(opts.sort ? { sortDefinition: { sort: opts.sort } } : {}) },
      objects: opts.objects ?? {},
      visualContainerObjects: {
        ...(opts.title ? { title: [{ properties: { show: literalProp(true), text: literalProp(opts.title) } }] } : {}),
        ...(opts.container ?? {})
      }
    }
  }
}

/** objects helper: props({ show: true, fontSize: 9 }) → [{ properties: {...literal-wrapped} }] */
export function props(values: Record<string, Scalar>, selector?: any): { properties: Record<string, any>; selector?: any } {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(values)) out[k] = literalProp(v)
  return selector ? { properties: out, selector } : { properties: out }
}

/** data-scope selector for `table[column] = value` */
export function scope(table: string, column: string, value: Scalar): any {
  const enc = typeof value === 'string' ? `'${value.replace(/'/g, "''")}'` : typeof value === 'number' ? (Number.isInteger(value) ? `${value}L` : `${value}D`) : String(value)
  return { data: [{ scopeId: { Comparison: { ComparisonKind: 0, Left: columnExpr(table, column), Right: { Literal: { Value: enc } } } } }] }
}
