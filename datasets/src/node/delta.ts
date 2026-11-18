/**
 * Delta Lake table writer: Parquet data files + a single `_delta_log/00000000000000000000.json`
 * commit (commitInfo, protocol 1/2, metaData with Spark `schemaString`, one `add` per file with
 * size, partitionValues and JSON stats). Deterministic: ids and timestamps derive from the table
 * name and the configured "today".
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { TableData } from '../../../src/core/model/data.ts'
import { uuidFrom } from '../core/prng.ts'
import type { ColKind, ColumnSpec, TableSpec } from '../core/schema.ts'
import { computeStats, DECIMAL_PRECISION, DECIMAL_SCALE, writeParquet } from './parquet.ts'

export const PARTITION_COLUMN = 'year'

export function sparkType(kind: ColKind): string {
  switch (kind) {
    case 'string':
      return 'string'
    case 'int':
      return 'long'
    case 'double':
      return 'double'
    case 'decimal':
      return `decimal(${DECIMAL_PRECISION},${DECIMAL_SCALE})`
    case 'bool':
      return 'boolean'
    case 'date':
      return 'date'
    case 'timestamp':
      return 'timestamp'
  }
}

export function sparkSchemaString(spec: TableSpec): string {
  const fields = spec.columns.map((c) => ({
    name: c.name,
    type: sparkType(c.kind),
    nullable: c.nullable !== false,
    metadata: { comment: c.description }
  }))
  if (spec.partitionByYearOf) fields.push({ name: PARTITION_COLUMN, type: 'integer', nullable: true, metadata: { comment: `Partition: year of ${spec.partitionByYearOf}` } })
  return JSON.stringify({ type: 'struct', fields })
}

interface AddAction {
  path: string
  partitionValues: Record<string, string>
  size: number
  modificationTime: number
  dataChange: boolean
  stats: string
}

export class DeltaTableWriter {
  readonly spec: TableSpec
  readonly dir: string
  readonly timestamp: number
  private adds: AddAction[] = []
  private fileSeq = 0
  rows = 0
  bytes = 0

  constructor(spec: TableSpec, dir: string, timestamp: number) {
    this.spec = spec
    this.dir = dir
    this.timestamp = timestamp
  }

  /** Data columns written to Parquet (partition column is not stored in files, as in Spark). */
  get columns(): ColumnSpec[] {
    return this.spec.columns
  }

  /** Paths of the data files relative to the table folder (in commit order). */
  get files(): string[] {
    return this.adds.map((a) => a.path)
  }

  /** Rows buffered per partition value (partitioned tables coalesce batches into one file per year). */
  private pending = new Map<string, TableData[]>()
  private pendingRows = 0
  /** Flush a partition buffer once it holds this many rows (bounds memory at large scale). */
  maxBufferedRows = 250_000

  /** Rows currently buffered and not yet written. */
  get bufferedRows(): number {
    return this.pendingRows
  }

  /** Write every buffered partition now. */
  flushAll(): void {
    for (const y of [...this.pending.keys()].sort()) this.flush(y)
  }

  /**
   * Append a chunk of rows. Non-partitioned tables write one file per call (callers buffer them);
   * partitioned tables buffer rows per year and write one file per year (more if a year exceeds
   * `maxBufferedRows`). Batches arrive in chronological order, so older years are flushed as soon
   * as a later year shows up.
   */
  append(table: TableData): void {
    if (table.rowCount === 0) return
    if (!this.spec.partitionByYearOf) {
      this.writeFile(table, undefined, {})
      return
    }
    const dateCol = table.columns.find((c) => c.name === this.spec.partitionByYearOf)
    if (!dateCol) throw new Error(`${this.spec.name}: partition column ${this.spec.partitionByYearOf} missing`)
    const groups = new Map<string, number[]>()
    for (let r = 0; r < table.rowCount; r++) {
      const v = dateCol.values[r]
      const y = v instanceof Date ? String(v.getUTCFullYear()) : '__HIVE_DEFAULT_PARTITION__'
      let g = groups.get(y)
      if (!g) groups.set(y, (g = []))
      g.push(r)
    }
    const years = [...groups.keys()].sort()
    const latest = years[years.length - 1]
    for (const y of [...this.pending.keys()]) if (y < latest) this.flush(y)
    for (const y of years) {
      const rows = groups.get(y)!
      const slice: TableData = {
        rowCount: rows.length,
        columns: table.columns.map((c) => ({ name: c.name, type: c.type, values: rows.map((r) => c.values[r]) }))
      }
      const list = this.pending.get(y) ?? []
      list.push(slice)
      this.pending.set(y, list)
      this.pendingRows += rows.length
    }
    if (this.pendingRows >= this.maxBufferedRows) for (const y of [...this.pending.keys()]) this.flush(y)
  }

  private flush(year: string): void {
    const parts = this.pending.get(year)
    if (!parts?.length) return
    this.pending.delete(year)
    const merged: TableData = {
      rowCount: parts.reduce((n, p) => n + p.rowCount, 0),
      columns: parts[0].columns.map((c, i) => ({ name: c.name, type: c.type, values: parts.flatMap((p) => p.columns[i].values) }))
    }
    this.pendingRows -= merged.rowCount
    this.writeFile(merged, undefined, { [PARTITION_COLUMN]: year })
  }

  private writeFile(table: TableData, rows: number[] | undefined, partitionValues: Record<string, string>): void {
    const seq = this.fileSeq++
    const id = uuidFrom(`${this.spec.name}/${seq}`)
    const name = `part-${String(seq).padStart(5, '0')}-${id}-c000.snappy.parquet`
    const rel = partitionValues[PARTITION_COLUMN] !== undefined ? `${PARTITION_COLUMN}=${partitionValues[PARTITION_COLUMN]}/${name}` : name
    const bytes = writeParquet(this.columns, table, rows)
    const abs = join(this.dir, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, bytes)
    const stats = computeStats(this.columns, table, rows)
    this.adds.push({
      path: rel,
      partitionValues: { ...partitionValues },
      size: bytes.length,
      modificationTime: this.timestamp,
      dataChange: true,
      stats: JSON.stringify(stats)
    })
    this.rows += stats.numRecords
    this.bytes += bytes.length
  }

  /** Write the commit; returns the log text. Empty tables get one empty file so readers see the schema. */
  commit(emptyTable: () => TableData): string {
    for (const y of [...this.pending.keys()].sort()) this.flush(y)
    if (this.adds.length === 0) this.writeFile(emptyTable(), undefined, {})
    const partitionColumns = this.spec.partitionByYearOf ? [PARTITION_COLUMN] : []
    const lines: unknown[] = [
      {
        commitInfo: {
          timestamp: this.timestamp,
          operation: 'WRITE',
          operationParameters: { mode: 'Overwrite', partitionBy: JSON.stringify(partitionColumns) },
          isolationLevel: 'Serializable',
          isBlindAppend: false,
          operationMetrics: { numFiles: String(this.adds.length), numOutputRows: String(this.rows), numOutputBytes: String(this.bytes) },
          engineInfo: 'lumen-datasets/1.0',
          txnId: uuidFrom(`${this.spec.name}/txn`)
        }
      },
      { protocol: { minReaderVersion: 1, minWriterVersion: 2 } },
      {
        metaData: {
          id: uuidFrom(`${this.spec.name}/table`),
          name: this.spec.name,
          description: this.spec.description,
          format: { provider: 'parquet', options: {} },
          schemaString: sparkSchemaString(this.spec),
          partitionColumns,
          configuration: {},
          createdTime: this.timestamp
        }
      },
      ...this.adds.map((a) => ({ add: a }))
    ]
    const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
    const logDir = join(this.dir, '_delta_log')
    mkdirSync(logDir, { recursive: true })
    writeFileSync(join(logDir, '00000000000000000000.json'), text)
    this.bytes += Buffer.byteLength(text)
    return text
  }
}
