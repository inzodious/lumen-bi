/** Data access for slicers: fields, distinct values, hierarchy tuples, field-parameter identity columns. */
import type { Scalar } from '@core/model/data'
import type { QueryEngine } from '@core/engine/api'
import { columnExpr, fieldInfo, type SQExpr, type SQFilter } from '@core/report/sq'
import type { VisualHostContext } from '../contract'
import { getProjections, labelOf, type Projection } from '../common/query'
import { persistedFilter } from './filterModel'

export const BLANK_LABEL = '(Blank)'

/** Slicer field projections: `Values` (classic slicer) or `Field` (new list/button slicers). Field parameters are NOT expanded. */
export function slicerProjections(visualJson: any): Projection[] {
  const roles = getProjections(visualJson)
  return roles.Values ?? roles.Field ?? roles.Category ?? []
}

/** Current filter of the slicer: runtime/host state first, then the persisted visual.json filter. */
export function currentFilter(visualJson: any, ctx: VisualHostContext): SQFilter | undefined {
  return ctx.slicerFilter ?? persistedFilter(visualJson)
}

export interface ListItem {
  /** identity value (field-parameter key when known, else the label value) */
  key: Scalar
  /** displayed field value */
  value: Scalar
  text: string
}

export function formatItem(ctx: VisualHostContext, expr: SQExpr, v: Scalar): string {
  if (v === null || v === undefined || v === '') return BLANK_LABEL
  const d = safe(() => ctx.engine.describeField(expr))
  return ctx.format(v, d?.formatString, d?.dataType)
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}

export interface ListData {
  items: ListItem[]
  dataType?: string
  error?: string
}

export function loadListItems(ctx: VisualHostContext, field: SQExpr, search: string, keyField?: SQExpr, limit = 5000): ListData {
  try {
    const r = ctx.engine.distinctValues({ column: { kind: 'sq', expr: field }, filters: ctx.filters, search: search || undefined, limit })
    const keyMap = keyField ? loadKeyMap(ctx, field, keyField) : undefined
    return {
      dataType: r.dataType,
      items: r.values.map((v) => ({ key: keyMap?.get(mapKey(v)) ?? v, value: v, text: formatItem(ctx, field, v) }))
    }
  } catch (e) {
    return { items: [], error: e instanceof Error ? e.message : String(e) }
  }
}

function mapKey(v: Scalar): string {
  return v instanceof Date ? 'd' + v.getTime() : JSON.stringify(v)
}

/** display value → identity value via a summarize over both columns. */
export function loadKeyMap(ctx: VisualHostContext, field: SQExpr, keyField: SQExpr): Map<string, Scalar> | undefined {
  try {
    const r = ctx.engine.summarize({ groupBy: [{ kind: 'sq', expr: field }, { kind: 'sq', expr: keyField }], values: [], filters: ctx.filters })
    const m = new Map<string, Scalar>()
    for (const row of r.rows) m.set(mapKey(row[0]), row[1])
    return m
  } catch {
    return undefined
  }
}

/**
 * Identity (group-by) column of a column: field parameters filter on their hidden "Fields" column.
 * Looks at TMDL `relatedColumnDetails` / `groupByColumn` metadata preserved in the model.
 */
export function keyFieldFor(engine: QueryEngine, expr: SQExpr): SQExpr | undefined {
  const f = fieldInfo(expr)
  if (f.kind !== 'column' || !f.table) return undefined
  const table = engine.model?.tables?.find((t) => t.name === f.table)
  const col = table?.columns.find((c) => c.name === f.property)
  if (!col) return undefined
  const raw = JSON.stringify([col.extra ?? {}, col.extendedProperties ?? {}])
  const m = /groupByColumn[^A-Za-z0-9_']*'?([^'"\\]+?)'?(?:\\n|"|$)/.exec(raw)
  const name = m?.[1]?.trim()
  if (!name || name === col.name || !table!.columns.some((c) => c.name === name)) return undefined
  return columnExpr(f.table, name)
}

/**
 * Is the column a What-if parameter (PBI: a GENERATESERIES calculated table whose column carries
 * `ParameterMetadata`)? PBI renders such slicers as a single-value slider.
 */
export function isWhatIfColumn(engine: QueryEngine, expr: SQExpr): boolean {
  const f = fieldInfo(expr)
  if (f.kind !== 'column' || !f.table) return false
  const table = engine.model?.tables?.find((t) => t.name === f.table)
  const col = table?.columns.find((c) => c.name === f.property)
  if (!table || !col) return false
  const meta = JSON.stringify([col.extendedProperties ?? {}, (col as any).extra ?? {}])
  if (/ParameterMetadata/.test(meta) && !/"?kind"?\s*[:=]\s*2|Version"?\s*[:=]\s*3/i.test(meta)) return true
  return table.partitions.some((p) => p.sourceType === 'calculated' && /^\s*GENERATESERIES\s*\(/i.test(p.expression ?? ''))
}

/** Distinct values (for snapping a single-value slider to a What-if series); undefined when too many. */
export function loadSnapValues(ctx: VisualHostContext, field: SQExpr, max = 5000): number[] | undefined {
  try {
    const r = ctx.engine.distinctValues({ column: { kind: 'sq', expr: field }, filters: ctx.filters, limit: max + 1 })
    if (r.values.length > max) return undefined
    const nums = r.values.filter((v): v is number => typeof v === 'number').sort((a, b) => a - b)
    return nums.length ? nums : undefined
  } catch {
    return undefined
  }
}

/** All leaf tuples of a hierarchy slicer (rows sorted by each level's sort order). */
export function loadHierTuples(ctx: VisualHostContext, fields: SQExpr[], limit = 30000): { tuples: Scalar[][]; error?: string } {
  try {
    const r = ctx.engine.summarize({ groupBy: fields.map((expr) => ({ kind: 'sq' as const, expr })), values: [], filters: ctx.filters, limit })
    return { tuples: r.rows.map((row) => row.slice(0, fields.length)) }
  } catch (e) {
    return { tuples: [], error: e instanceof Error ? e.message : String(e) }
  }
}

/** DAX reference of a plain column projection ('T'[C]), undefined for hierarchy levels / other shapes. */
export function daxColumnRef(expr: SQExpr): string | undefined {
  const f = fieldInfo(expr)
  if (f.kind !== 'column' || !f.table || !f.property || !expr?.Column) return undefined
  return `'${f.table.replace(/'/g, "''")}'[${f.property.replace(/]/g, ']]')}]`
}

/**
 * Numeric/date domain of a range slicer: MIN/MAX of the column under the slicer's filter context
 * (PBI's range slicer shows the domain of the values that exist under the other filters).
 * Falls back to scanning distinct values for hierarchy levels / when the DAX route fails.
 */
export function loadDomain(ctx: VisualHostContext, field: SQExpr): { min?: number | Date; max?: number | Date; dataType?: string; integer: boolean; error?: string } {
  const ref = daxColumnRef(field)
  const desc = safe(() => ctx.engine.describeField(field))
  if (ref && desc?.dataType) {
    try {
      const lo = ctx.engine.evaluateScalar(`MIN ( ${ref} )`, ctx.filters).value
      const hi = ctx.engine.evaluateScalar(`MAX ( ${ref} )`, ctx.filters).value
      const ok = (v: Scalar) => typeof v === 'number' || v instanceof Date
      if (ok(lo) && ok(hi)) {
        const integer = desc.dataType === 'int64' || (typeof lo === 'number' && typeof hi === 'number' && Number.isInteger(lo) && Number.isInteger(hi) && desc.dataType !== 'double' && desc.dataType !== 'decimal')
        return { min: (lo ?? undefined) as number | Date | undefined, max: (hi ?? undefined) as number | Date | undefined, dataType: desc.dataType, integer }
      }
    } catch {
      /* fall through to the scan */
    }
  }
  try {
    const r = ctx.engine.distinctValues({ column: { kind: 'sq', expr: field }, filters: ctx.filters })
    let min: number | Date | undefined
    let max: number | Date | undefined
    let integer = true
    for (const v of r.values) {
      if (typeof v === 'number') {
        if (!Number.isInteger(v)) integer = false
        if (min === undefined || v < (min as number)) min = v
        if (max === undefined || v > (max as number)) max = v
      } else if (v instanceof Date) {
        if (min === undefined || v.getTime() < (min as Date).getTime()) min = v
        if (max === undefined || v.getTime() > (max as Date).getTime()) max = v
      }
    }
    return { min, max, dataType: r.dataType, integer }
  } catch (e) {
    return { integer: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Per-item row counts and/or a measure value (keyed like `itemKey`). */
export function loadItemStats(ctx: VisualHostContext, field: SQExpr, opts: { counts: boolean; measure?: SQExpr }): { counts?: Map<string, number | null>; measures?: Map<string, Scalar> } {
  const out: { counts?: Map<string, number | null>; measures?: Map<string, Scalar> } = {}
  const table = fieldInfo(field).table
  if (opts.counts && table) {
    try {
      let r = ctx.engine.distinctValues({ column: { kind: 'sq', expr: field }, filters: ctx.filters, withMeasure: { kind: 'dax', expression: `COUNTROWS ( '${table.replace(/'/g, "''")}' )` } })
      const prop = fieldInfo(field).property
      if (!r.measures?.some((m) => typeof m === 'number') && prop) {
        // engines without DAX (gallery / tests): count of the column's non-blank values per item
        r = ctx.engine.distinctValues({ column: { kind: 'sq', expr: field }, filters: ctx.filters, withMeasure: { kind: 'aggregate', table, column: prop, fn: 'count' } })
      }
      out.counts = new Map(r.values.map((v, i) => [itemKey(v), (r.measures?.[i] as number | null) ?? null]))
    } catch {
      /* counts are optional */
    }
  }
  if (opts.measure) {
    try {
      const r = ctx.engine.distinctValues({ column: { kind: 'sq', expr: field }, filters: ctx.filters, withMeasure: { kind: 'sq', expr: opts.measure } })
      out.measures = new Map(r.values.map((v, i) => [itemKey(v), r.measures?.[i] ?? null]))
    } catch {
      /* sort falls back to the default order */
    }
  }
  return out
}

/** Stable map key of an item value. */
export function itemKey(v: Scalar): string {
  return mapKey(v)
}

export function headerText(ctx: VisualHostContext, projs: Projection[]): string {
  if (!projs.length) return ''
  return labelOf(ctx, projs[0])
}
