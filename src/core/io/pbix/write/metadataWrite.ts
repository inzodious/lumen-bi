/**
 * Writes measure edits into the source `metadata.sqlitedb` of a `DataModel` (stage D). The database is edited in place
 * with sql.js (the reader's SQLite), so every row Lumen does not own stays as it was; then the ABF is rebuilt with the
 * new database (abfwrite.ts) and framed like the source stream (XPress9, or bare ABF for 2017-era files).
 *
 * Rows written, mirroring rows of real files (all seven Microsoft samples and a November 2025 Desktop file show the
 * same shape for every measure: `State` 1, `IsSimpleMeasure` 0, `KPIID` / definition ids 0 when absent):
 *  - `Measure`: Name, TableID, Expression, FormatString, Description, DisplayFolder, IsHidden, DataCategory,
 *    LineageTag, State 1, ModifiedTime / StructureModifiedTime (FILETIME, now). New rows take ids above
 *    `DBPROPERTIES.MAXID` (and above every existing id), and MAXID is raised.
 *  - `Annotation` rows of the measure (ObjectType 8) replaced by the document's annotations.
 *  - `DBPROPERTIES`: MAXID; LASTCOMMITTED / LASTCUBESCHEMACHANGE / LASTMETADATACHANGEFORSYNCCOMMITTED moved just after
 *    the edit time, as real files keep them at or after their newest ModifiedTime.
 *  - deleting a measure also deletes the rows that refer to it: Annotation / ObjectTranslation / ExtendedProperty /
 *    ChangedProperty / FormatStringDefinition / DetailRowsDefinition rows of the measure, its KPI and its
 *    PerspectiveMeasure rows.
 * Approximation: Lumen does not evaluate a new or changed expression's result type; such measures are stored with
 * `DataType` 20 (Variant), a value real files use for measures that return several types. An unchanged expression
 * keeps its stored type.
 */
import { abfFileBytes, parseAbf } from '../datamodel/abf'
import { decompressDataModel, detectCompression } from '../datamodel/container'
import { getSqlJs } from '../datamodel/sqlite'
import { rebuildAbf } from './abfwrite'
import { compressDataModel } from './datamodelwrite'
import type { MeasureChange, MetadataEditResult, ModelChangeReport } from './metadataEdit'

type J = Record<string, any>
type SqlValue = number | string | Uint8Array | null

const MEASURE = 8
const VARIANT = 20

/** Time as a Windows FILETIME (100 ns ticks since 1601-01-01), the unit of the *ModifiedTime columns. */
export function fileTime(ms = Date.now()): number {
  return (ms + 11644473600000) * 10000
}

function text(v: unknown): string | null {
  if (v === undefined || v === null) return null
  return Array.isArray(v) ? v.join('\n') : String(v)
}

interface Db {
  exec(sql: string, params?: SqlValue[]): Array<{ columns: string[]; values: SqlValue[][] }>
  run(sql: string, params?: SqlValue[]): void
  export(): Uint8Array
  close(): void
}

function rows(db: Db, sql: string, params: SqlValue[] = []): J[] {
  const r = db.exec(sql, params)
  if (!r.length) return []
  return r[0].values.map((v) => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]])))
}

function columns(db: Db, table: string): Set<string> {
  return new Set(rows(db, `PRAGMA table_info([${table}])`).map((r) => String(r.name)))
}

function insert(db: Db, table: string, values: J, cols: Set<string>): void {
  const keys = Object.keys(values).filter((k) => cols.has(k))
  db.run(`INSERT INTO [${table}] (${keys.map((k) => `[${k}]`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => values[k] as SqlValue))
}

/** Apply measure changes to a `metadata.sqlitedb` image; returns the edited database bytes. */
export async function editMetadataDb(bytes: Uint8Array, changes: MeasureChange[], now = Date.now()): Promise<{ bytes: Uint8Array; diagnostics: string[] }> {
  const SQL = await getSqlJs()
  const db = new SQL.Database(bytes) as unknown as Db
  const diagnostics: string[] = []
  try {
    const ft = fileTime(now)
    const measureCols = columns(db, 'Measure')
    const annCols = columns(db, 'Annotation')
    let maxId = Number(rows(db, "SELECT VALUE FROM DBPROPERTIES WHERE NAME = 'MAXID'")[0]?.VALUE ?? 0)
    // never reuse an id at or below an existing row, whatever MAXID says
    for (const t of rows(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => String(r.name))) {
      if (!columns(db, t).has('ID')) continue
      maxId = Math.max(maxId, Number(rows(db, `SELECT MAX(ID) AS m FROM [${t}]`)[0]?.m ?? 0))
    }
    const nextId = (): number => ++maxId
    const tables = rows(db, 'SELECT * FROM [Table]')
    const tableId = (name: string): number | undefined => tables.find((t) => String(t.Name) === name && (Number(t.SystemFlags ?? 0) & 1) === 0)?.ID as number | undefined
    const measureRow = (table: string, name: string): J | undefined => {
      const tid = tableId(table)
      return tid === undefined ? undefined : rows(db, 'SELECT * FROM [Measure] WHERE TableID = ? AND Name = ?', [tid, name])[0]
    }
    const has = (t: string): boolean => columns(db, t).size > 0
    const deleteDependents = (id: number): void => {
      for (const t of ['Annotation', 'ObjectTranslation', 'ExtendedProperty', 'ChangedProperty', 'FormatStringDefinition', 'DetailRowsDefinition'])
        if (has(t) && columns(db, t).has('ObjectType')) db.run(`DELETE FROM [${t}] WHERE ObjectType = ? AND ObjectID = ?`, [MEASURE, id])
      if (has('KPI')) db.run('DELETE FROM [KPI] WHERE MeasureID = ?', [id])
      if (has('PerspectiveMeasure')) db.run('DELETE FROM [PerspectiveMeasure] WHERE MeasureID = ?', [id])
    }
    const writeAnnotations = (id: number, m: J): void => {
      db.run('DELETE FROM [Annotation] WHERE ObjectType = ? AND ObjectID = ?', [MEASURE, id])
      for (const a of (m.annotations ?? []) as J[]) insert(db, 'Annotation', { ID: nextId(), ObjectID: id, ObjectType: MEASURE, Name: a.name, Value: text(a.value), ModifiedTime: ft }, annCols)
    }
    const fields = (m: J): J => ({
      Name: m.name,
      Description: text(m.description),
      Expression: text(m.expression) ?? '',
      FormatString: m.formatString ?? null,
      IsHidden: m.isHidden ? 1 : 0,
      DisplayFolder: m.displayFolder ?? null,
      DataCategory: m.dataCategory ?? null,
      LineageTag: m.lineageTag ?? null
    })

    // deletions first, so a measure moved to another table or renamed onto a freed name never collides
    const ordered = [...changes.filter((c) => c.kind === 'measure-delete'), ...changes.filter((c) => c.kind !== 'measure-delete')]
    for (const c of ordered) {
      const where = `${c.table}[${c.name}]`
      if (c.kind === 'measure-delete') {
        const row = measureRow(c.table, c.name)
        if (!row) throw new Error(`Measure ${where} not found in the data model`)
        deleteDependents(row.ID as number)
        db.run('DELETE FROM [Measure] WHERE ID = ?', [row.ID as number])
      } else if (c.kind === 'measure-add') {
        const tid = tableId(c.table)
        if (tid === undefined) throw new Error(`Table ${c.table} not found in the data model`)
        const id = nextId()
        insert(
          db,
          'Measure',
          {
            ID: id,
            TableID: tid,
            ...fields(c.measure!),
            DataType: VARIANT,
            State: 1,
            ModifiedTime: ft,
            StructureModifiedTime: ft,
            KPIID: 0,
            IsSimpleMeasure: 0,
            ErrorMessage: null,
            DetailRowsDefinitionID: 0,
            FormatStringDefinitionID: 0,
            SourceLineageTag: null
          },
          measureCols
        )
        writeAnnotations(id, c.measure!)
      } else {
        const row = measureRow(c.table, c.name)
        if (!row) throw new Error(`Measure ${where} not found in the data model`)
        const exprChanged = text(c.before?.expression) !== text(c.measure!.expression)
        const set: J = { ...fields(c.measure!), ModifiedTime: ft }
        if (exprChanged) Object.assign(set, { DataType: VARIANT, StructureModifiedTime: ft, State: 1, ErrorMessage: null })
        const keys = Object.keys(set).filter((k) => measureCols.has(k))
        db.run(`UPDATE [Measure] SET ${keys.map((k) => `[${k}] = ?`).join(', ')} WHERE ID = ?`, [...keys.map((k) => set[k] as SqlValue), row.ID as number])
        if (JSON.stringify(c.before?.annotations ?? []) !== JSON.stringify(c.measure!.annotations ?? [])) writeAnnotations(row.ID as number, c.measure!)
      }
    }
    db.run("UPDATE DBPROPERTIES SET VALUE = ? WHERE NAME = 'MAXID'", [maxId])
    // commit markers: in every real file LASTCOMMITTED (and the metadata-sync marker) is at or after the newest
    // ModifiedTime, and current files move LASTCUBESCHEMACHANGE with each commit. Data is untouched: LASTCUBEDATACHANGE stays.
    db.run("UPDATE DBPROPERTIES SET VALUE = ? WHERE NAME = 'LASTMETADATACHANGEFORSYNCCOMMITTED'", [ft + 1])
    db.run("UPDATE DBPROPERTIES SET VALUE = ? WHERE NAME IN ('LASTCOMMITTED', 'LASTCUBESCHEMACHANGE')", [ft + 2])
    const check = rows(db, 'PRAGMA integrity_check')[0]
    if (check && Object.values(check)[0] !== 'ok') throw new Error(`metadata.sqlitedb integrity check failed: ${JSON.stringify(check)}`)
    return { bytes: db.export(), diagnostics }
  } finally {
    db.close()
  }
}

/** Measure edits of a `DataModel` stream; the stream keeps its framing (XPress9, or bare ABF for 2017-era files). */
export async function writeMeasureEdits(dataModel: Uint8Array, report: ModelChangeReport): Promise<MetadataEditResult> {
  const framing = detectCompression(dataModel)
  const abf = parseAbf(decompressDataModel(dataModel))
  const edited = await editMetadataDb(abfFileBytes(abf, 'metadata.sqlitedb'), report.changes)
  const rebuilt = rebuildAbf(abf, new Map([['metadata.sqlitedb', edited.bytes]]))
  return { dataModel: framing === 'uncompressed' ? rebuilt : compressDataModel(rebuilt), diagnostics: edited.diagnostics }
}
