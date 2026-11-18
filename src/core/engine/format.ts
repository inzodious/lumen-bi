/**
 * Shared value formatter for UI code (no engine instance needed). Same semantics as the engine's
 * `format()` and DAX FORMAT(): .NET/VB custom & standard format strings, named formats, en-US.
 */
import type { DataType } from '../model/types'
import type { Scalar } from '../model/data'
import { formatGeneral, formatValue as fmt } from '../format'

/** Format a value the way Power BI displays it. Without a format string, uses the General display for the type. */
export function formatValue(value: Scalar, formatString?: string | null, dataType?: DataType): string {
  if (value === null || value === undefined) return ''
  if (!formatString) return formatGeneral(value, dataType)
  return fmt(value, formatString, { dataType })
}
