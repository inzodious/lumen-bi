/**
 * Column-oriented data storage shared by every loader (M engine, VertiPaq reader, CSV import,
 * synthetic data generator) and consumed by the DAX engine.
 *
 * VALUE REPRESENTATION (the interchange contract — every component must respect it):
 *   BLANK / null      -> null
 *   string            -> string
 *   int64/double/decimal -> number (int64 beyond 2^53 loses precision; accepted)
 *   boolean           -> boolean
 *   dateTime          -> JS Date whose *UTC* fields carry the naive wall-clock value
 *                        (i.e. new Date(Date.UTC(y, m-1, d, hh, mm, ss))). Never use local-time getters.
 *   binary            -> Uint8Array
 */

import type { DataType } from './types'

export type Scalar = null | number | string | boolean | Date | Uint8Array

export interface ColumnData {
  name: string
  type: DataType
  values: Scalar[]
}

export interface TableData {
  columns: ColumnData[]
  rowCount: number
}

export type TableLoadStatus =
  | { state: 'loaded'; source: 'query' | 'cache' | 'pbix' | 'import' | 'synthetic' | 'calculated'; at?: string; rowCount: number }
  | { state: 'empty'; reason?: string }
  | { state: 'error'; message: string }
  | { state: 'pending' }

export interface DataStore {
  tables: Map<string, TableData>
  status: Map<string, TableLoadStatus>
  /**
   * Key matches of relationships as stored by the engine that produced the data (PBIX VertiPaq relationship
   * indexes), by relationship name: each "from" key value and the "to" key value it joins (null = no match).
   * Valid only while `fromData` / `toData` are the tables' current data objects (a refresh replaces them).
   */
  relationshipKeys?: Map<string, { fromData: TableData; toData: TableData; from: Scalar[]; to: Scalar[] }>
}

export function emptyDataStore(): DataStore {
  return { tables: new Map(), status: new Map() }
}

export function makeTable(columns: ColumnData[]): TableData {
  const rowCount = columns.length ? columns[0].values.length : 0
  return { columns, rowCount }
}

/** Build a TableData from row arrays. */
export function tableFromRows(names: string[], types: DataType[], rows: Scalar[][]): TableData {
  const columns: ColumnData[] = names.map((name, i) => ({ name, type: types[i] ?? 'unknown', values: new Array(rows.length) }))
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    for (let c = 0; c < columns.length; c++) columns[c].values[r] = row[c] ?? null
  }
  return { columns, rowCount: rows.length }
}

export function getColumn(table: TableData, name: string): ColumnData | undefined {
  const lower = name.toLowerCase()
  return table.columns.find((c) => c.name.toLowerCase() === lower)
}

export function makeDate(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0, ms = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, hh, mm, ss, ms))
}

export function isDate(v: unknown): v is Date {
  return v instanceof Date
}

/** Infer a DataType for a JS value (used by importers). */
export function inferType(v: Scalar): DataType {
  if (v === null) return 'unknown'
  if (typeof v === 'string') return 'string'
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'number') return Number.isInteger(v) ? 'int64' : 'double'
  if (v instanceof Date) return 'dateTime'
  if (v instanceof Uint8Array) return 'binary'
  return 'variant'
}
