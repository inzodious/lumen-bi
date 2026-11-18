/**
 * Power BI DataModel reader: PBIX `DataModel` zip member / PBIP `.pbi/cache.abf` → SemanticModel + DataStore.
 *
 * Pipeline: XPress9 decompression (container.ts / xpress9.ts) → ABF backup parsing (abf.ts) →
 * `metadata.sqlitedb` via sql.js (sqlite.ts / metadata.ts) → VertiPaq column decoding
 * (vertipaq.ts / columns.ts). Pure TypeScript, no Node APIs: runs in Node, the renderer and workers.
 */

import { unzipSync } from 'fflate'
import type { ColumnData, DataStore, Scalar, TableData } from '../../../model/data'
import { emptyDataStore } from '../../../model/data'
import type { SemanticModel } from '../../../model/types'
import { abfFileBytes, parseAbf, type AbfArchive } from './abf'
import { dataIdDecoder, decodeColumn, relationshipIndexRows } from './columns'
import { decompressDataModel, detectCompression } from './container'
import { readMetadata, type MetadataResult } from './metadata'
import { XM_FIRST_DATA_ID } from './vertipaq'
import { MetadataDb, type SqlJsFactory } from './sqlite'

export { setSqlJsFactory, type SqlJsFactory } from './sqlite'
export { decompressDataModel, detectCompression } from './container'
export { parseAbf, abfFileBytes, type AbfArchive, type AbfFile } from './abf'

export interface ReadDataModelOptions {
  onProgress?(fraction: number, message: string): void
  /** Decode data only for these tables (the model always contains every table). */
  tables?: string[]
  /** Per-call sql.js factory override (see `setSqlJsFactory`). */
  sqlJs?: SqlJsFactory
}

export interface ReadDataModelResult {
  model: SemanticModel
  data: DataStore
  diagnostics: string[]
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

/** Extract the `DataModel` member when given a whole .pbix/.pbit zip; otherwise return as-is. */
export function extractDataModelStream(bytes: Uint8Array): Uint8Array {
  if (!isZip(bytes)) return bytes
  const files = unzipSync(bytes, { filter: (f) => f.name === 'DataModel' })
  const dm = files.DataModel
  if (!dm) throw new Error('The file has no embedded DataModel (live connection, template or report-only file)')
  return dm
}

function readDbXml(abf: AbfArchive): string | undefined {
  const f = abf.files.find((x) => /\.db\.xml$/i.test(x.fileName))
  if (!f) return undefined
  try {
    const b = abfFileBytes(abf, f.fileName)
    return new TextDecoder(b[1] === 0 ? 'utf-16le' : 'utf-8').decode(b)
  } catch {
    return undefined
  }
}

/**
 * Decode an embedded Power BI data model.
 * @param bytes a .pbix/.pbit zip, its `DataModel` member, or a PBIP `.pbi/cache.abf`
 */
export async function readDataModel(bytes: Uint8Array, opts: ReadDataModelOptions = {}): Promise<ReadDataModelResult> {
  const progress = opts.onProgress ?? (() => {})
  const diagnostics: string[] = []

  const stream = extractDataModelStream(bytes)
  const kind = detectCompression(stream)
  progress(0, kind === 'uncompressed' ? 'Reading data model' : 'Decompressing data model')
  const raw = decompressDataModel(stream, (f) => progress(0.3 * f, 'Decompressing data model'))
  progress(0.3, 'Reading backup directory')
  const abf = parseAbf(raw)
  if (!abf.byName.has('metadata.sqlitedb')) {
    throw new Error('Unsupported data model: no metadata.sqlitedb (pre-2017 XML-metadata model)')
  }

  progress(0.32, 'Reading model metadata')
  const db = await MetadataDb.open(abfFileBytes(abf, 'metadata.sqlitedb'), opts.sqlJs)
  let meta
  try {
    meta = readMetadata(db, readDbXml(abf))
  } finally {
    db.close()
  }
  diagnostics.push(...meta.diagnostics)
  const { model } = meta

  const data = emptyDataStore()
  const wanted = opts.tables ? new Set(opts.tables.map((t) => t.toLowerCase())) : undefined
  const tables = model.tables.filter((t) => !wanted || wanted.has(t.name.toLowerCase()))
  // weight progress by stored bytes
  const weight = (name: string): number => {
    let w = 1
    for (const info of meta.storage.get(name)?.values() ?? []) for (const idf of info.idfs) w += abf.byName.get(idf)?.size ?? 0
    return w
  }
  const weights = tables.map((t) => weight(t.name))
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1
  let done = 0

  for (let ti = 0; ti < tables.length; ti++) {
    const table = tables[ti]
    progress(0.35 + (0.65 * done) / totalWeight, `Loading ${table.name}`)
    const storage = meta.storage.get(table.name)
    const isDirectQuery = table.partitions.length > 0 && table.partitions.every((p) => p.mode === 'directQuery')
    const columns: ColumnData[] = []
    const pendingNull: ColumnData[] = []
    let rowCount = -1
    let failed = 0
    for (const col of table.columns) {
      if (col.kind === 'rowNumber') continue
      const info = storage?.get(col.name)
      const cd: ColumnData = { name: col.name, type: col.dataType, values: [] }
      columns.push(cd)
      if (!info || !info.idfs.length) {
        pendingNull.push(cd)
        continue
      }
      try {
        const dec = decodeColumn(abf, info, col.dataType)
        cd.values = dec.values
        if (rowCount < 0) rowCount = dec.rows
        else if (dec.rows !== rowCount) {
          diagnostics.push(`${table.name}[${col.name}]: ${dec.rows} rows, expected ${rowCount}`)
          if (dec.rows < rowCount) {
            const vals = cd.values
            for (let i = dec.rows; i < rowCount; i++) vals.push(null)
          } else cd.values.length = rowCount
        }
      } catch (e) {
        failed++
        diagnostics.push(`${table.name}[${col.name}]: ${e instanceof Error ? e.message : String(e)}`)
        pendingNull.push(cd)
      }
    }
    if (rowCount < 0) rowCount = meta.recordCounts.get(table.name) ?? 0
    for (const cd of pendingNull) cd.values = new Array(rowCount).fill(null)
    const td: TableData = { columns, rowCount }
    data.tables.set(table.name, td)
    if (isDirectQuery && rowCount === 0) {
      data.status.set(table.name, { state: 'empty', reason: 'DirectQuery table: no data stored in the file' })
    } else if (failed && failed === columns.length) {
      data.status.set(table.name, { state: 'error', message: `Could not decode ${failed} column(s); see diagnostics` })
    } else {
      data.status.set(table.name, { state: 'loaded', source: 'pbix', rowCount })
    }
    done += weights[ti]
  }
  // relationship indexes (R$<table>$<relationship> INDEX: from-column data id -> to-table row): the key matches the
  // engine computed, used instead of re-deriving them (exact for mixed-type keys, e.g. text vs whole number)
  try {
    readRelationshipKeys(abf, meta, data)
  } catch (e) {
    diagnostics.push(`relationship indexes: ${e instanceof Error ? e.message : String(e)}`)
  }
  progress(1, 'Done')
  return { model, data, diagnostics }
}

function readRelationshipKeys(abf: AbfArchive, meta: MetadataResult, data: DataStore): void {
  for (const r of meta.model.relationships) {
    if (!r.name) continue
    const tag = '$' + r.name.replace(/-/g, ' ') + ' ('
    const partOf = (n: string) => Number(/\.(\d+)\.idf$/.exec(n)?.[1] ?? 0)
    const files = abf.files
      .map((f) => f.fileName)
      .filter((n) => n.includes('R$') && n.includes(tag) && /\.INDEX\.\d+\.idf$/.test(n))
      .sort((a, b) => partOf(a) - partOf(b))
    if (!files.length) continue
    // the index belongs to the many side ("from" after normalizing one-to-many definitions)
    const fromFirst = (r.fromCardinality ?? 'many') !== 'one' || (r.toCardinality ?? 'one') !== 'many'
    const [ft, fc, tt, tc] = fromFirst ? [r.fromTable, r.fromColumn, r.toTable, r.toColumn] : [r.toTable, r.toColumn, r.fromTable, r.fromColumn]
    const fromData = data.tables.get(ft)
    const toData = data.tables.get(tt)
    const info = meta.storage.get(ft)?.get(fc)
    const toCol = toData?.columns.find((c) => c.name === tc)
    const fromDef = meta.model.tables.find((t) => t.name === ft)?.columns.find((c) => c.name === fc)
    if (!fromData || !toData || !info || !toCol || !fromDef) continue
    const decode = dataIdDecoder(abf, info, fromDef.dataType)
    const from: Scalar[] = []
    const to: Scalar[] = []
    let id = 0
    for (const f of files) {
      for (const row of relationshipIndexRows(abf, f)) {
        const pos = id++
        if (pos < XM_FIRST_DATA_ID) continue
        const v = decode(pos)
        if (v === null) continue
        from.push(v)
        to.push(row >= 0 && row < toData.rowCount ? toCol.values[row] : null)
      }
    }
    if (!from.length) continue
    if (!data.relationshipKeys) data.relationshipKeys = new Map()
    data.relationshipKeys.set(r.name, { fromData, toData, from, to })
  }
}
