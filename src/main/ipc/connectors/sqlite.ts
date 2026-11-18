/**
 * SQLite files (`SQLite.Database(path)`) through sql.js (SQLite compiled to WebAssembly — no native
 * module). The file is loaded into memory read-only (statements run on a private copy, so a native query
 * can never modify the file); the copy is reused until the file's size or modification time changes.
 *
 * SQLite columns are dynamically typed. Navigation reads use the declared column types (affinity rules
 * plus DATE / DATETIME / TIMESTAMP / BOOLEAN names); native queries infer each column from its values.
 */
import { readFile, stat } from 'node:fs/promises'
import type { HostTable, SqlItem } from '../../../core/m/host'
import { ConnectorError, DEFAULT_MAX_ROWS, type DbRunOptions } from './common'

type SqlJsDatabase = {
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>
  prepare(sql: string): { getColumnNames(): string[]; step(): boolean; get(): unknown[]; free(): void }
  close(): void
}
type SqlJs = { Database: new (data?: Uint8Array) => SqlJsDatabase }

let sqlJs: Promise<SqlJs> | null = null
function engine(): Promise<SqlJs> {
  sqlJs ??= import('sql.js').then((m) => (m.default as unknown as (cfg?: object) => Promise<SqlJs>)())
  return sqlJs
}

const open = new Map<string, { db: SqlJsDatabase; size: number; mtime: number }>()

async function database(path: string): Promise<SqlJsDatabase> {
  let st
  try {
    st = await stat(path)
  } catch (e) {
    throw new ConnectorError(`We couldn't find the file '${path}'.`, 'notFound')
  }
  const cur = open.get(path)
  if (cur && cur.size === st.size && cur.mtime === st.mtimeMs) return cur.db
  cur?.db.close()
  const bytes = await readFile(path)
  if (bytes.length >= 16 && bytes.subarray(0, 15).toString('latin1') !== 'SQLite format 3') throw new ConnectorError(`'${path}' isn't a SQLite database.`)
  const SQL = await engine()
  const db = new SQL.Database(new Uint8Array(bytes))
  // the copy is shared by later reads: refuse writes (a native query must not change what others see)
  db.exec('PRAGMA query_only = ON')
  open.set(path, { db, size: st.size, mtime: st.mtimeMs })
  return db
}

export function closeSqliteFiles(): void {
  for (const { db } of open.values()) db.close()
  open.clear()
}

/** Declared type → host type (SQLite affinity rules, https://sqlite.org/datatype3.html §3.1). */
export function sqliteDeclaredType(decl: string): string {
  const t = decl.toUpperCase()
  if (/BOOL/.test(t)) return 'boolean'
  if (/DATETIME|TIMESTAMP/.test(t)) return 'timestamp'
  if (/^DATE$|^DATE\b/.test(t)) return 'date'
  if (/^TIME\b/.test(t)) return 'time'
  if (/INT/.test(t)) return 'bigint'
  if (/CHAR|CLOB|TEXT/.test(t)) return 'varchar'
  if (/BLOB/.test(t) || t === '') return 'any'
  if (/REAL|FLOA|DOUB/.test(t)) return 'double'
  if (/DEC|NUMERIC|MONEY/.test(t)) return 'decimal'
  return 'any'
}

/** Column type from the values of a native query result. */
export function sqliteInferType(values: unknown[]): string {
  let kind: string | null = null
  for (const v of values) {
    if (v === null || v === undefined) continue
    const k = v instanceof Uint8Array ? 'binary' : typeof v === 'number' ? (Number.isInteger(v) ? 'bigint' : 'double') : typeof v === 'string' ? 'varchar' : 'any'
    if (kind === null) kind = k
    else if (kind !== k) kind = (kind === 'bigint' && k === 'double') || (kind === 'double' && k === 'bigint') ? 'double' : 'any'
  }
  return kind ?? 'varchar'
}

function convert(v: unknown, type: string): unknown {
  if (v === null || v === undefined) return null
  if (type === 'boolean' && typeof v === 'number') return v !== 0
  if (type === 'timestamp' && typeof v === 'number') return new Date(v * 1000) // unix epoch seconds
  if (v instanceof Uint8Array) return new Uint8Array(v)
  return v
}

const quote = (n: string) => `"${n.replace(/"/g, '""')}"`

export async function sqliteQuery(path: string, sql: string, table?: { schema: string; item: string }, opts: DbRunOptions = {}): Promise<HostTable> {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS
  const db = await database(path)
  let declared: Map<string, string> | null = null
  if (table) {
    try {
      const info = db.exec(`PRAGMA ${quote(table.schema || 'main')}.table_info(${quote(table.item)})`)[0]
      if (info) declared = new Map(info.values.map((r) => [String(r[1]), sqliteDeclaredType(String(r[2] ?? ''))]))
    } catch {
      declared = null
    }
  }
  let stmt
  try {
    stmt = db.prepare(sql)
  } catch (e) {
    throw new ConnectorError(String((e as Error).message ?? e), /no such table/i.test(String(e)) ? 'notFound' : 'error')
  }
  try {
    const columns = stmt.getColumnNames()
    const rows: unknown[][] = []
    while (stmt.step()) {
      if (rows.length >= maxRows) throw new ConnectorError(`The query returned more than ${maxRows.toLocaleString()} rows (the row limit).`)
      rows.push(stmt.get())
    }
    const types = columns.map((c, i) => declared?.get(c) ?? sqliteInferType(rows.map((r) => r[i])))
    return { columns: columns.map((name, i) => ({ name, type: types[i]! })), rows: rows.map((r) => r.map((v, i) => convert(v, types[i]!))) }
  } catch (e) {
    throw e instanceof ConnectorError ? e : new ConnectorError(String((e as Error).message ?? e))
  } finally {
    stmt.free()
  }
}

export async function sqliteItems(path: string): Promise<SqlItem[]> {
  const r = await sqliteQuery(path, "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
  return r.rows.map((x) => ({ schema: 'main', item: String(x[0]), kind: x[1] === 'view' ? 'View' : 'Table' }))
}
