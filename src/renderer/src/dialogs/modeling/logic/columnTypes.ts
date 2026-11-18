/**
 * Effective data type of a model column.
 *
 * A model does not always declare it: the columns of a calculated table (and calculated columns) are
 * written without `dataType` in TMDL when Power BI inferred them, so the definition says 'unknown' until
 * the expression is evaluated. The engine infers the type when it computes the table and stores it with
 * the data (`ColumnData.type`); everything that needs a type for such a column — the relationship dialog,
 * the Table view's icons and alignment — must read it from there instead of the bare definition.
 */
import type { ColumnDef, DataType } from '@core/model/types'
import type { ColumnData, Scalar } from '@core/model/data'

const undeclared = (t: DataType | undefined): boolean => !t || t === 'unknown' || t === 'variant'

/** Type of the first values that are not blank (whole numbers only → int64; any fraction → double). */
export function inferTypeFromValues(values: Scalar[] | undefined, limit = 2000): DataType {
  if (!values) return 'unknown'
  let seen: DataType = 'unknown'
  let n = 0
  for (const v of values) {
    if (v === null || v === undefined) continue
    const t: DataType = v instanceof Date ? 'dateTime' : typeof v === 'number' ? (Number.isInteger(v) ? 'int64' : 'double') : typeof v === 'boolean' ? 'boolean' : v instanceof Uint8Array ? 'binary' : 'string'
    if (seen === 'unknown') seen = t
    else if (seen !== t) {
      if ((seen === 'int64' && t === 'double') || (seen === 'double' && t === 'int64')) seen = 'double'
      else return 'string' // mixed: text is what the storage engine would keep
    }
    if (++n >= limit) break
  }
  return seen
}

/** Declared type, else the type stored with the data, else the type of the values; 'unknown' only without any of them. */
export function effectiveDataType(def: Pick<ColumnDef, 'dataType'> | undefined, data?: Pick<ColumnData, 'type' | 'values'>): DataType {
  if (def && !undeclared(def.dataType)) return def.dataType
  if (data && !undeclared(data.type)) return data.type
  return inferTypeFromValues(data?.values)
}

export const isNumericType = (t: DataType): boolean => t === 'int64' || t === 'double' || t === 'decimal'

/** User-facing name of a data type, as Power BI Desktop's "Data type" drop-down spells it. */
export function dataTypeLabel(t: DataType): string {
  switch (t) {
    case 'string':
      return 'Text'
    case 'int64':
      return 'Whole number'
    case 'double':
      return 'Decimal number'
    case 'decimal':
      return 'Fixed decimal number'
    case 'dateTime':
      return 'Date/time'
    case 'boolean':
      return 'True/false'
    case 'binary':
      return 'Binary'
    default:
      return 'Unknown'
  }
}
