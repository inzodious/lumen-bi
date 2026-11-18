/**
 * Parquet writing (hyparquet-writer) with Spark/Delta-compatible physical types:
 *   string → BYTE_ARRAY UTF8 · int → INT64 · double → DOUBLE · decimal → INT64 DECIMAL(18,2)
 *   bool → BOOLEAN · date → INT32 DATE · timestamp → INT64 TIMESTAMP(MICROS, UTC)
 * Also computes per-column statistics for Delta `add.stats`.
 */
import { parquetWriteBuffer } from 'hyparquet-writer'
import type { SchemaElement } from 'hyparquet'
import type { Scalar, TableData } from '../../../src/core/model/data.ts'
import type { ColKind, ColumnSpec } from '../core/schema.ts'

export const DECIMAL_PRECISION = 18
export const DECIMAL_SCALE = 2

export function parquetElement(col: ColumnSpec): SchemaElement {
  const repetition_type = col.nullable === false ? 'REQUIRED' : 'OPTIONAL'
  const name = col.name
  switch (col.kind) {
    case 'string':
      return { name, type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type }
    case 'int':
      return { name, type: 'INT64', repetition_type }
    case 'double':
      return { name, type: 'DOUBLE', repetition_type }
    case 'decimal':
      return { name, type: 'INT64', converted_type: 'DECIMAL', precision: DECIMAL_PRECISION, scale: DECIMAL_SCALE, repetition_type }
    case 'bool':
      return { name, type: 'BOOLEAN', repetition_type }
    case 'date':
      return { name, type: 'INT32', converted_type: 'DATE', repetition_type }
    case 'timestamp':
      return {
        name,
        type: 'INT64',
        converted_type: 'TIMESTAMP_MICROS',
        logical_type: { type: 'TIMESTAMP', isAdjustedToUTC: true, unit: 'MICROS' },
        repetition_type
      }
  }
}

function columnArray(kind: ColKind, values: Scalar[]): unknown[] {
  if (kind === 'int') return values.map((v) => (v === null ? null : BigInt(v as number)))
  return values
}

/** Serialise one table (or a slice of rows) to Parquet bytes. */
export function writeParquet(columns: ColumnSpec[], table: TableData, rows?: number[]): Uint8Array {
  const schema: SchemaElement[] = [{ name: 'spark_schema', num_children: columns.length }, ...columns.map(parquetElement)]
  const columnData = columns.map((col) => {
    const src = table.columns.find((c) => c.name === col.name)
    if (!src) throw new Error(`writeParquet: column ${col.name} missing`)
    const values = rows ? rows.map((r) => src.values[r]) : src.values
    return { name: col.name, data: columnArray(col.kind, values) as never }
  })
  const buf = parquetWriteBuffer({
    columnData,
    schema,
    rowGroupSize: 100_000,
    statistics: true,
    createdBy: 'lumen-datasets (hyparquet-writer)'
  })
  return new Uint8Array(buf)
}

// ---------------------------------------------------------------------------------------------
// Delta statistics

function statValue(kind: ColKind, v: Scalar): unknown {
  if (v instanceof Date) return kind === 'date' ? v.toISOString().slice(0, 10) : v.toISOString()
  return v
}

export interface FileStats {
  numRecords: number
  minValues: Record<string, unknown>
  maxValues: Record<string, unknown>
  nullCount: Record<string, number>
}

/** Delta-style stats (strings longer than 32 chars are left out of min/max, as allowed). */
export function computeStats(columns: ColumnSpec[], table: TableData, rows?: number[]): FileStats {
  const stats: FileStats = { numRecords: rows ? rows.length : table.rowCount, minValues: {}, maxValues: {}, nullCount: {} }
  for (const col of columns) {
    const src = table.columns.find((c) => c.name === col.name)!
    let min: Scalar = null
    let max: Scalar = null
    let nulls = 0
    let skip = col.kind === 'bool'
    const n = rows ? rows.length : table.rowCount
    for (let i = 0; i < n; i++) {
      const v = src.values[rows ? rows[i] : i]
      if (v === null) {
        nulls++
        continue
      }
      if (skip) continue
      if (typeof v === 'string' && v.length > 32) {
        skip = true
        continue
      }
      if (min === null || (v as number | string | Date) < (min as number | string | Date)) min = v
      if (max === null || (v as number | string | Date) > (max as number | string | Date)) max = v
    }
    stats.nullCount[col.name] = nulls
    if (!skip && min !== null) {
      stats.minValues[col.name] = statValue(col.kind, min)
      stats.maxValues[col.name] = statValue(col.kind, max)
    }
  }
  return stats
}
