/**
 * Edits of the column-width formatting of a table / matrix, in the shape Power BI writes (pure; operate on
 * a PBIR objects bag, so they work for `visual.objects` and for the mobile-layout override alike):
 *
 *   columnWidth:   [{ properties: { value: 120D }, selector: { metadata: <queryRef> } }]     a column / a matrix value or row field
 *                  [{ properties: { value: 90D },  selector: { data: [{ scopeId: { Comparison } }] } }]   one matrix column header
 *                  [{ properties: { value: 90D },  selector: { data: [{ total: [<level expr>] }] } }]    a matrix total column
 *                  [{ properties: { value: 90D },  selector: { id: 'cornerColumn' } }]        matrix row-header column without a row field
 *   columnHeaders: [{ properties: { columnAdjustment: 'growToFit' | 'fitToContent' | 'fixedWidth',
 *                                   defaultColumnWidth: 100D, customColumnWidth: true,
 *                                   customColumnWidthGranularView: true } }]
 *
 * `columnAdjustment` / `customColumnWidth*` / `defaultColumnWidth` are the property names of Microsoft's report
 * theme schema (2.159). Power BI leaves the older `autoSizeColumnWidth` switch as it is when `columnAdjustment`
 * is written (`columnAdjustment` wins), and it does not write `customColumnWidth` when a column is dragged — the
 * stored widths themselves are the custom widths.
 */
import { encodeLiteral } from '@core/report/literal'
import type { Scalar } from '@core/model/data'
import type { ObjectEntry, ObjectsBag } from '@core/report/props'
import type { SQExpr } from '@core/report/sq'
import type { SizeBehavior } from './widths'

/** What a custom width applies to (the entry's PBIR selector). A plain string is a `metadata` queryRef. */
export interface WidthTarget {
  /** queryRef of the column / matrix value / row field */
  metadata?: string
  /** matrix: one column header (`scopeSelector`) or a total column (`totalSelector`) */
  data?: any[]
  /** 'cornerColumn': the matrix row-header column when it has no row field */
  id?: string
}

const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
const round = (n: number) => Math.round(n * 100) / 100

/** `visual.objects` of a visual.json (created when missing). */
export function visualObjects(visualJson: any): ObjectsBag {
  const v = visualJson.visual ?? visualJson.visualGroup
  v.objects ??= {}
  return v.objects
}

/** `data` selector of one matrix column header: the header's level field = its value. */
export function scopeSelector(expr: SQExpr, value: Scalar): any[] {
  return [{ scopeId: { Comparison: { ComparisonKind: 0, Left: expr, Right: { Literal: { Value: encodeLiteral(value) } } } } }]
}

/** `data` selector of a matrix total column: the column level that is totalled. */
export function totalSelector(levelExpr: SQExpr): any[] {
  return [{ total: [levelExpr] }]
}

const hasData = (e: ObjectEntry) => Array.isArray(e.selector?.data) && e.selector!.data!.length > 0
const asTarget = (t: string | WidthTarget): WidthTarget => (typeof t === 'string' ? { metadata: t } : t)
const sameTarget = (e: ObjectEntry, t: WidthTarget) =>
  (e.selector?.metadata ?? undefined) === (t.metadata ?? undefined) && (e.selector?.id ?? undefined) === (t.id ?? undefined) && JSON.stringify(hasData(e) ? e.selector!.data : []) === JSON.stringify(t.data ?? [])

function headerEntry(bag: ObjectsBag, create: boolean): ObjectEntry | undefined {
  let e = bag.columnHeaders?.find((x) => !x.selector || !Object.keys(x.selector).length)
  if (!e && create) {
    e = { properties: {} }
    ;(bag.columnHeaders ??= []).push(e)
  }
  return e
}

function setHeaderProp(bag: ObjectsBag, prop: string, raw: any): void {
  const e = headerEntry(bag, raw !== undefined)
  if (!e) return
  if (raw === undefined) {
    delete e.properties[prop]
    if (!Object.keys(e.properties).length) {
      bag.columnHeaders = bag.columnHeaders.filter((x) => x !== e)
      if (!bag.columnHeaders.length) delete bag.columnHeaders
    }
  } else e.properties[prop] = raw
}

function headerLiteral(bag: ObjectsBag, prop: string): string | undefined {
  const v = headerEntry(bag, false)?.properties?.[prop]?.expr?.Literal?.Value
  return typeof v === 'string' ? v : undefined
}

/** Set a custom width (drag of a header edge, "Set column width", a Custom widths input). */
export function setColumnWidth(bag: ObjectsBag, target: string | WidthTarget, width: number): void {
  const t = asTarget(target)
  const list = (bag.columnWidth ??= [])
  const entry = list.find((e) => sameTarget(e, t))
  const value = lit(`${round(Math.max(0, width))}D`)
  if (entry) entry.properties = { ...entry.properties, value }
  else list.push({ properties: { value }, selector: { ...(t.data?.length ? { data: t.data } : {}), ...(t.metadata !== undefined ? { metadata: t.metadata } : {}), ...(t.id !== undefined ? { id: t.id } : {}) } })
  // the same width in its legacy place
  if (t.metadata !== undefined && !t.data?.length) dropLegacyWidth(bag, t.metadata)
  // a width set by hand is a custom width: the Custom widths switch can't stay explicitly off
  if (headerLiteral(bag, 'customColumnWidth') === 'false') setHeaderProp(bag, 'customColumnWidth', undefined)
}

/** Remove a custom width (the column goes back to the auto-size behavior). */
export function resetColumnWidth(bag: ObjectsBag, target: string | WidthTarget): void {
  const t = asTarget(target)
  if (bag.columnWidth) {
    bag.columnWidth = bag.columnWidth.filter((e) => !sameTarget(e, t))
    if (!bag.columnWidth.length) delete bag.columnWidth
  }
  if (t.metadata !== undefined && !t.data?.length) dropLegacyWidth(bag, t.metadata)
}

/**
 * Remove the widths of single matrix column headers / total columns (`data` selectors): those of one value
 * (`metadata`), plus the ones stored for every value. Used when a uniform width replaces them.
 */
export function clearScopedWidths(bag: ObjectsBag, metadata?: string): void {
  if (!bag.columnWidth) return
  bag.columnWidth = bag.columnWidth.filter((e) => !(hasData(e) && (metadata === undefined || e.selector?.metadata === undefined || e.selector.metadata === metadata)))
  if (!bag.columnWidth.length) delete bag.columnWidth
}

/** Legacy `general.columnWidth` (selector = queryRef) of old `table` visuals. */
function dropLegacyWidth(bag: ObjectsBag, queryRef?: string): void {
  if (!bag.general) return
  for (const e of bag.general) if (e.selector?.metadata && (queryRef === undefined || e.selector.metadata === queryRef) && e.properties) delete e.properties.columnWidth
  bag.general = bag.general.filter((e) => !e.selector?.metadata || Object.keys(e.properties ?? {}).length > 0)
  if (!bag.general.length) delete bag.general
}

/** Remove every custom width. */
export function clearCustomWidths(bag: ObjectsBag): void {
  delete bag.columnWidth
  dropLegacyWidth(bag)
}

/** Custom widths switch. Power BI: "Turning off clears all custom widths." */
export function setCustomWidthsEnabled(bag: ObjectsBag, on: boolean): void {
  if (!on) clearCustomWidths(bag)
  setHeaderProp(bag, 'customColumnWidth', on ? lit('true') : undefined)
}

/** Matrix "More granular" switch. Switching it off drops the per-combination widths (the uniform width of the field stays). */
export function setGranularWidths(bag: ObjectsBag, on: boolean): void {
  if (!on) clearScopedWidths(bag)
  setHeaderProp(bag, 'customColumnWidthGranularView', on ? lit('true') : undefined)
}

/**
 * Auto-size behavior (`columnAdjustment`; Power BI leaves `autoSizeColumnWidth` alone).
 *
 * Leaving the legacy "Auto-size width: off" state (no `columnAdjustment` yet) for an auto-size behavior clears the
 * stored widths, as switching Auto-size width back on did in Power BI: those widths are the snapshot Power BI took of
 * every column when the switch was turned off, and they would keep every column from being auto-sized.
 */
export function setSizeBehavior(bag: ObjectsBag, behavior: SizeBehavior, was: { legacyManual: boolean }): void {
  if (was.legacyManual && behavior !== 'fixedWidth') clearCustomWidths(bag)
  setHeaderProp(bag, 'columnAdjustment', lit(`'${behavior}'`))
}

/** Default width of the Fixed width behavior (undefined clears it). */
export function setDefaultWidth(bag: ObjectsBag, width: number | undefined): void {
  setHeaderProp(bag, 'defaultColumnWidth', width === undefined ? undefined : lit(`${round(Math.max(1, width))}D`))
}
