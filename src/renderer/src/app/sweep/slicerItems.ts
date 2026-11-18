/**
 * How many items a slicer offers under its live filter context, computed with the same loaders the slicer UI uses
 * (`visuals/slicers/slicerData.ts`), so the sweep sees what a user sees when opening the list or dropdown.
 * Pure of React / DOM: also usable from Node tests with a memory engine.
 */
import type { VisualDocument } from '@core/report/types'
import type { VisualHostContext } from '../../visuals/contract'
import { currentFilter, keyFieldFor, loadDomain, loadHierTuples, loadListItems, slicerProjections } from '../../visuals/slicers/slicerData'
import { parseListFilter } from '../../visuals/slicers/filterModel'
import { readSlicerFormat } from '../../visuals/slicers/slicerFormat'

export interface SlicerItems {
  /** list / dropdown / button items (hierarchy slicers: leaf items); range slicers: 1 when the range has bounds */
  items: number
  /** how the count was taken */
  kind: 'list' | 'hierarchy' | 'range'
  error?: string
}

const RANGE_MODES = new Set(['Between', 'Before', 'After', 'Single', 'RelativeDatePicker'])

/** Undefined for slicers that offer no items (text slicer, relative date) or have no field. */
export function slicerItems(visual: VisualDocument, ctx: VisualHostContext): SlicerItems | undefined {
  const json = visual.json
  const type = json?.visual?.visualType
  if (type === 'textSlicer') return undefined
  const fields = slicerProjections(json).map((p) => p.expr)
  if (!fields.length) return undefined
  if (fields.length > 1) {
    const r = loadHierTuples(ctx, fields)
    return { items: r.tuples.length, kind: 'hierarchy', error: r.error }
  }
  let dataType: string | undefined
  try {
    dataType = ctx.engine.describeField(fields[0])?.dataType
  } catch {
    dataType = undefined
  }
  const numeric = dataType === 'int64' || dataType === 'double' || dataType === 'decimal'
  const isDate = dataType === 'dateTime'
  if (type === 'slicer') {
    const mode = readSlicerFormat(json, ctx.theme).mode
    if ((mode === 'Relative' || mode === 'RelativeTime') && isDate) return undefined
    if (RANGE_MODES.has(mode) && (numeric || isDate)) {
      const d = loadDomain(ctx, fields[0])
      return { items: d.min !== undefined && d.max !== undefined ? 1 : 0, kind: 'range', error: d.error }
    }
  }
  const filter = currentFilter(json, ctx)
  const keyField = parseListFilter(filter, fields[0])?.keyField ?? keyFieldFor(ctx.engine, fields[0])
  const r = loadListItems(ctx, fields[0], '', keyField)
  return { items: r.items.length, kind: 'list', error: r.error }
}
