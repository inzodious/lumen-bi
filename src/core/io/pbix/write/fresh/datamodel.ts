/**
 * Stage E entry point: a `DataModel` stream for any supported model, written entirely by Lumen (no bytes of a source
 * file). model.ts builds the metadata rows and the column files, this module writes `metadata.sqlitedb` (sql.js, the
 * reader's SQLite) with the schema of schema.ts, the database's `.db.xml`, packs everything into an ABF (abf.ts) and
 * compresses it with XPress9 (../datamodelwrite.ts).
 *
 * Not written, by design (docs/developer/file-format-io.md lists the evidence):
 *  - `0.CryptKey.bin`: the database key file, a key container Lumen cannot create. Without it the backup log
 *    declares `SvrEncryptPwdFlag` false (see abf.ts): Power BI Desktop 2.159 rejected a backup that declared password
 *    encryption without the key file, and opened the same database with a key file. `cryptKey` embeds one.
 *  - `LinguisticMetadata` (Q&A synonyms): optional; Desktop generates it.
 */
import type { DataStore } from '../../../../model/data'
import type { SemanticModel } from '../../../../model/types'
import { getSqlJs } from '../../datamodel/sqlite'
import { compressDataModel } from '../datamodelwrite'
import { fileTime as toFileTime } from '../metadataWrite'
import { buildAbf, xmlEscape } from './abf'
import { buildFreshModel, freshModelSupport, type MetaRow } from './model'
import { METADATA_SCHEMA, METADATA_SCHEMA_VERSION } from './schema'

export interface FreshDataModelOptions {
  now?: number
  /** database key file to embed (tests; see the module comment) */
  cryptKey?: Uint8Array
  /** omit `DataSourceImpersonationInfo` from the `.db.xml` (test variants) */
  noImpersonationInfo?: boolean
  /** return the bare ABF instead of the XPress9 stream */
  uncompressed?: boolean
  onProgress?: (fraction: number, message: string) => void
}

export interface FreshDataModelResult {
  dataModel: Uint8Array
  diagnostics: string[]
  /** inner file count (metadata.sqlitedb included) */
  fileCount: number
}

export class UnsupportedModelError extends Error {
  constructor(readonly features: string[]) {
    super(`Lumen can't write this model's data into a .pbix yet: ${features.join('; ')}.`)
  }
}

function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  const h = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16))
  h[12] = '4'
  return `${h.slice(0, 8).join('')}-${h.slice(8, 12).join('')}-${h.slice(12, 16).join('')}-${h.slice(16, 20).join('')}-${h.slice(20).join('')}`
}

/** `<id>.0.db.xml`: the database object as the engine persists it (shape of the November 2025 file). */
export function databaseXml(databaseId: string, objectId: string, compatibilityLevel: number, created: Date, withCryptKey: boolean, impersonationInfo = true): string {
  const ts = created.toISOString().replace('Z', '').replace(/(\.\d{3})$/, '$1000').slice(0, 26)
  const ns = [
    ['', 'http://schemas.microsoft.com/analysisservices/2003/engine'],
    ['ddl2', 'http://schemas.microsoft.com/analysisservices/2003/engine/2'],
    ['ddl2_2', 'http://schemas.microsoft.com/analysisservices/2003/engine/2/2'],
    ['ddl100', 'http://schemas.microsoft.com/analysisservices/2008/engine/100'],
    ['ddl100_100', 'http://schemas.microsoft.com/analysisservices/2008/engine/100/100'],
    ['ddl200', 'http://schemas.microsoft.com/analysisservices/2010/engine/200'],
    ['ddl200_200', 'http://schemas.microsoft.com/analysisservices/2010/engine/200/200'],
    ['ddl300', 'http://schemas.microsoft.com/analysisservices/2011/engine/300'],
    ['ddl300_300', 'http://schemas.microsoft.com/analysisservices/2011/engine/300/300'],
    ['ddl400', 'http://schemas.microsoft.com/analysisservices/2012/engine/400'],
    ['ddl400_400', 'http://schemas.microsoft.com/analysisservices/2012/engine/400/400'],
    ['ddl500', 'http://schemas.microsoft.com/analysisservices/2013/engine/500'],
    ['ddl500_500', 'http://schemas.microsoft.com/analysisservices/2013/engine/500/500'],
    ['ddl800', 'http://schemas.microsoft.com/analysisservices/2018/engine/800'],
    ['ddl800_800', 'http://schemas.microsoft.com/analysisservices/2018/engine/800/800'],
    ['xsd', 'http://www.w3.org/2001/XMLSchema'],
    ['xsi', 'http://www.w3.org/2001/XMLSchema-instance']
  ]
    .map(([p, u]) => `xmlns${p ? ':' + p : ''}="${u}"`)
    .join(' ')
  return (
    `<Load ${ns}><ObjectDefinition><Database><Name>${databaseId}</Name><ID>${databaseId}</ID><CreatedTimestamp>${ts}</CreatedTimestamp>` +
    `<LastSchemaUpdate>${ts}</LastSchemaUpdate><ObjectVersion>0</ObjectVersion><ObjectID>${objectId}</ObjectID><Ordinal>1</Ordinal>` +
    `<PersistLocation>0</PersistLocation><System>false</System>${withCryptKey ? '<DataFileList>0.CryptKey.bin</DataFileList>' : ''}<Description/>` +
    `<ddl800:DbUniqueId>${uuid().toUpperCase()}</ddl800:DbUniqueId><AggregationPrefix/><Language>1033</Language><Collation/>` +
    '<ddl400:DefaultCollationVersion>100</ddl400:DefaultCollationVersion><Visible>true</Visible><MasterDataSourceID/><ProcessingPriority>0</ProcessingPriority>' +
    '<ddl200_200:StorageEngineUsed valuens="ddl500_500">TabularMetadata</ddl200_200:StorageEngineUsed>' +
    `<ddl200:CompatibilityLevel>${compatibilityLevel}</ddl200:CompatibilityLevel><Translations/>` +
    (impersonationInfo ? '<DataSourceImpersonationInfo><ImpersonationMode>Default</ImpersonationMode><Account/></DataSourceImpersonationInfo>' : '') +
    '<DataVersion>0</DataVersion>' +
    '</Database></ObjectDefinition></Load>'
  )
}

type SqlValue = number | string | null

/** Write the metadata rows into a new SQLite database with the Desktop schema. */
export async function writeMetadataDb(rows: Map<string, MetaRow[]>, maxId: number, ft: number): Promise<Uint8Array> {
  const SQL = await getSqlJs()
  const db = new SQL.Database() as unknown as {
    run(sql: string, params?: SqlValue[]): void
    exec(sql: string): Array<{ columns: string[]; values: SqlValue[][] }>
    prepare(sql: string): { run(params: SqlValue[]): void; free(): void }
    export(): Uint8Array
    close(): void
  }
  try {
    db.run('PRAGMA page_size = 4096')
    for (const ddl of METADATA_SCHEMA) db.run(ddl)
    db.run('BEGIN')
    const props: Array<[string, number]> = [
      ['MAXID', maxId],
      ['SCHEMAVERSION', METADATA_SCHEMA_VERSION],
      ['LASTSCHEMAVERSION', METADATA_SCHEMA_VERSION],
      ['DATABASEBLOCKINGSTATE', 0],
      ['RESTOREABFSOURCE', 0],
      ['LASTCUBEDATACHANGE', ft + 2],
      ['LASTCUBESCHEMACHANGE', ft + 2],
      ['DATASOURCEVERSION', 2],
      ['FEATURESTOUPGRADE', 0],
      ['LASTCOMMITTED', ft + 2],
      ['LASTMETADATACHANGEFORSYNCCOMMITTED', ft + 1],
      ['LASTPBIPUBLICXMLACOMMITTEDTIME', 0]
    ]
    for (const [k, v] of props) db.run('INSERT INTO DBPROPERTIES (NAME, VALUE) VALUES (?, ?)', [k, v])
    for (const [table, list] of rows) {
      const info = db.exec(`PRAGMA table_info([${table}])`)
      if (!info.length) throw new Error(`metadata.sqlitedb has no table ${table}`)
      const cols = info[0].values.map((v) => ({ name: String(v[1]), type: String(v[2]).toUpperCase() }))
      const names = new Set(cols.map((c) => c.name))
      for (const r of list) for (const k of Object.keys(r)) if (!names.has(k)) throw new Error(`metadata.sqlitedb: ${table} has no column ${k}`)
      const stmt = db.prepare(`INSERT INTO [${table}] (${cols.map((c) => `[${c.name}]`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      for (const r of list) {
        // columns a row does not set: 0 for numbers (real files' value for "none" ids, flags and counts), NULL for text
        stmt.run(cols.map((c) => (c.name in r ? r[c.name] : c.type === 'TEXT' || c.type === 'STRING' ? null : 0)))
      }
      stmt.free()
    }
    db.run('COMMIT')
    return db.export()
  } finally {
    db.close()
  }
}

/** Write a complete `DataModel` for `model` + `data`; throws UnsupportedModelError naming what cannot be written. */
export async function writeFreshDataModel(model: SemanticModel, data: DataStore, opts: FreshDataModelOptions = {}): Promise<FreshDataModelResult> {
  const unsupported = freshModelSupport(model, data)
  if (unsupported.length) throw new UnsupportedModelError(unsupported)
  const progress = opts.onProgress ?? (() => {})
  const now = opts.now ?? Date.now()
  const ft = toFileTime(now)
  progress(0.05, 'Encoding columns')
  const built = buildFreshModel(model, data, { fileTime: ft })
  progress(0.5, 'Writing model metadata')
  const meta = await writeMetadataDb(built.rows, built.maxId, ft)
  const databaseId = uuid()
  const compat = model.compatibilityLevel && model.compatibilityLevel >= 1500 ? model.compatibilityLevel : 1567
  const dbXml = databaseXml(databaseId, uuid().toUpperCase(), compat, new Date(now), !!opts.cryptKey, !opts.noImpersonationInfo)
  progress(0.6, 'Packing the data model')
  const abf = buildAbf({
    databaseId,
    backupObjectId: uuid().toUpperCase(),
    databaseObjectId: uuid().toUpperCase(),
    serverRoot: '\\\\?\\C:\\Lumen\\AnalysisServicesWorkspace\\Data',
    dbXml,
    files: [...built.files, { folder: '', name: 'metadata.sqlitedb', bytes: meta }],
    cryptKey: opts.cryptKey,
    fileTime: ft
  })
  const dataModel = opts.uncompressed ? abf : compressDataModel(abf, { onProgress: (f) => progress(0.6 + 0.4 * f, 'Compressing the data model') })
  progress(1, 'Done')
  return { dataModel, diagnostics: built.diagnostics, fileCount: built.files.length + 1 }
}

export { xmlEscape }
