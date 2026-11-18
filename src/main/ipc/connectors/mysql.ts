/**
 * MySQL / MariaDB connector over `mysql2`.
 *
 * Every value is received as raw bytes (typeCast) and converted from MySQL's text protocol here:
 *   TINYINT(1) → boolean (like Connector/NET, which Power BI uses) · other integers → integer / bigint ·
 *   DECIMAL → decimal (JS double) · FLOAT/DOUBLE → double · DATE → date · DATETIME / TIMESTAMP → timestamp
 *   (wall clock; the session time zone is UTC, so TIMESTAMP values read as UTC) · TIME → time (values
 *   outside 00:00–23:59 stay text) · YEAR → integer · JSON → json text · BIT(1) → boolean, BIT(n) → integer ·
 *   binary strings / BLOB / GEOMETRY → binary · everything else → text (ENUM, SET, VARCHAR, TEXT, …).
 * TLS: as for PostgreSQL ('prefer' tries TLS first).
 */
import mysql from 'mysql2/promise'
import type { HostTable, SqlItem } from '../../../core/m/host'
import type { CredentialAuth } from '../../../shared/host'
import { ConnectorError, DEFAULT_MAX_ROWS, hostPort, type DbRunOptions } from './common'

const BINARY_CHARSET = 63

/** mysql2 column type codes (protocol constants). */
const T = {
  DECIMAL: 0,
  TINY: 1,
  SHORT: 2,
  LONG: 3,
  FLOAT: 4,
  DOUBLE: 5,
  NULL: 6,
  TIMESTAMP: 7,
  LONGLONG: 8,
  INT24: 9,
  DATE: 10,
  TIME: 11,
  DATETIME: 12,
  YEAR: 13,
  NEWDATE: 14,
  VARCHAR: 15,
  BIT: 16,
  JSON: 245,
  NEWDECIMAL: 246,
  ENUM: 247,
  SET: 248,
  TINY_BLOB: 249,
  MEDIUM_BLOB: 250,
  LONG_BLOB: 251,
  BLOB: 252,
  VAR_STRING: 253,
  STRING: 254,
  GEOMETRY: 255
}

export interface MysqlField {
  name: string
  columnType: number
  characterSet?: number
  columnLength?: number
}

/** Host logical type of a result column. */
export function mysqlHostType(f: MysqlField): string {
  const binary = f.characterSet === BINARY_CHARSET
  switch (f.columnType) {
    case T.TINY:
      return f.columnLength === 1 ? 'boolean' : 'integer'
    case T.SHORT:
    case T.LONG:
    case T.INT24:
    case T.YEAR:
      return 'integer'
    case T.LONGLONG:
      return 'bigint'
    case T.DECIMAL:
    case T.NEWDECIMAL:
      return 'decimal'
    case T.FLOAT:
    case T.DOUBLE:
      return 'double'
    case T.DATE:
    case T.NEWDATE:
      return 'date'
    case T.DATETIME:
    case T.TIMESTAMP:
      return 'timestamp'
    case T.TIME:
      return 'time'
    case T.JSON:
      return 'json'
    case T.BIT:
      return f.columnLength === 1 ? 'boolean' : 'bigint'
    case T.GEOMETRY:
      return 'binary'
    case T.TINY_BLOB:
    case T.MEDIUM_BLOB:
    case T.LONG_BLOB:
    case T.BLOB:
    case T.VAR_STRING:
    case T.STRING:
    case T.VARCHAR:
      return binary ? 'binary' : 'varchar'
    default:
      return 'varchar'
  }
}

/** Raw bytes of a value → host value for a column of `type` (see mysqlHostType). */
export function convertMysqlValue(raw: Buffer | null, type: string, f: MysqlField): unknown {
  if (raw === null) return null
  if (type === 'binary') return new Uint8Array(raw)
  if (f.columnType === T.BIT) {
    let n = 0
    for (const b of raw) n = n * 256 + b
    return type === 'boolean' ? n !== 0 : n
  }
  const s = raw.toString('utf8')
  switch (type) {
    case 'boolean':
      return s !== '0'
    case 'integer':
    case 'bigint':
    case 'decimal':
    case 'double':
      return Number(s)
    case 'date':
      return s.startsWith('0000') ? null : s
    case 'timestamp': {
      if (s.startsWith('0000')) return null
      const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?)?$/.exec(s)
      if (!m) return s
      return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0), m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0))
    }
    default:
      return s
  }
}

export interface MysqlTarget {
  server: string
  database: string
  auth?: CredentialAuth
}

const pools = new Map<string, Promise<mysql.Pool>>()

function poolKey(t: MysqlTarget): string {
  return JSON.stringify([t.server.toLowerCase(), t.database, t.auth?.user ?? '', t.auth?.password ?? '', t.auth?.sslMode ?? 'prefer'])
}

function makePool(t: MysqlTarget, ssl: undefined | { rejectUnauthorized: boolean }): mysql.Pool {
  const { host, port } = hostPort(t.server, 3306)
  const pool = mysql.createPool({
    host,
    port,
    user: t.auth?.user,
    password: t.auth?.password,
    database: t.database || undefined,
    ssl,
    connectionLimit: 4,
    idleTimeout: 60_000,
    connectTimeout: 20_000,
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: false,
    rowsAsArray: true,
    // raw bytes for everything: converted with the column metadata (mysqlHostType)
    typeCast: (field: { buffer(): Buffer | null }) => field.buffer()
  })
  // TIMESTAMP columns are read in the session time zone: make it UTC on every pooled connection
  ;(pool as unknown as { pool: { on(ev: 'connection', cb: (c: { query(sql: string): void }) => void): void } }).pool.on('connection', (c) => c.query("SET time_zone = '+00:00'"))
  return pool
}

async function openPool(t: MysqlTarget): Promise<mysql.Pool> {
  const mode = t.auth?.sslMode ?? 'prefer'
  const attempt = async (ssl: undefined | { rejectUnauthorized: boolean }) => {
    const pool = makePool(t, ssl)
    try {
      const c = await pool.getConnection()
      c.release()
      return pool
    } catch (e) {
      void pool.end().catch(() => undefined)
      throw e
    }
  }
  if (mode === 'disable') return attempt(undefined)
  if (mode === 'verify-full') return attempt({ rejectUnauthorized: true })
  if (mode === 'require') return attempt({ rejectUnauthorized: false })
  try {
    return await attempt({ rejectUnauthorized: false })
  } catch (e) {
    if (/SSL|TLS|HANDSHAKE_NO_SSL_SUPPORT|EPROTO/i.test(String((e as Error).message))) return attempt(undefined)
    throw e
  }
}

async function pool(t: MysqlTarget): Promise<mysql.Pool> {
  const key = poolKey(t)
  let p = pools.get(key)
  if (!p) {
    p = openPool(t)
    pools.set(key, p)
    p.catch(() => pools.delete(key))
  }
  return p
}

export async function closeMysqlPools(): Promise<void> {
  const all = [...pools.values()]
  pools.clear()
  await Promise.all(all.map((p) => p.then((x) => x.end()).catch(() => undefined)))
}

function explain(e: unknown, t: MysqlTarget): ConnectorError {
  const err = e as { message?: string; code?: string; errno?: number }
  const msg = err.message ?? String(e)
  const { host } = hostPort(t.server, 3306)
  if (err.code === 'ER_ACCESS_DENIED_ERROR' || err.errno === 1045) return new ConnectorError(`${msg}. We couldn't authenticate with the credentials provided (Data source settings ▸ Edit Permissions).`, 'credentials')
  if (err.code === 'ER_BAD_DB_ERROR' || err.code === 'ER_NO_SUCH_TABLE') return new ConnectorError(msg, 'notFound')
  if (/ENOTFOUND|getaddrinfo/.test(msg)) return new ConnectorError(`The server '${host}' was not found or was not accessible (${msg}).`)
  if (/ECONNREFUSED/.test(msg)) return new ConnectorError(`The server '${host}' refused the connection (is MySQL listening on that port?).`)
  return new ConnectorError(msg)
}

export async function mysqlQuery(t: MysqlTarget, sql: string, opts: DbRunOptions = {}): Promise<HostTable> {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS
  try {
    const p = await pool(t)
    const [rows, fields] = (await p.query({ sql, rowsAsArray: true, timeout: opts.timeoutMs ?? 30 * 60_000 })) as unknown as [(Buffer | null)[][], MysqlField[] | undefined]
    const fs = fields ?? []
    if (!Array.isArray(rows)) return { columns: [], rows: [] }
    if (rows.length > maxRows) throw new ConnectorError(`The query returned more than ${maxRows.toLocaleString()} rows (the row limit). Filter the source or raise the limit.`)
    const types = fs.map(mysqlHostType)
    return { columns: fs.map((f, i) => ({ name: f.name, type: types[i]! })), rows: rows.map((r) => r.map((v, i) => convertMysqlValue(v, types[i]!, fs[i]!))) }
  } catch (e) {
    throw e instanceof ConnectorError ? e : explain(e, t)
  }
}

const SYSTEM_SCHEMAS = "('mysql', 'information_schema', 'performance_schema', 'sys')"

export async function mysqlItems(t: MysqlTarget): Promise<SqlItem[]> {
  const where = t.database ? `TABLE_SCHEMA = ${mysql.escape(t.database)}` : `TABLE_SCHEMA NOT IN ${SYSTEM_SCHEMAS}`
  const r = await mysqlQuery(t, `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE ${where} ORDER BY TABLE_SCHEMA, TABLE_NAME`)
  return r.rows.map((x) => ({ schema: String(x[0]), item: String(x[1]), kind: String(x[2]).includes('VIEW') ? 'View' : 'Table' }))
}

export async function mysqlDatabases(t: MysqlTarget): Promise<string[]> {
  const r = await mysqlQuery({ ...t, database: '' }, `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ${SYSTEM_SCHEMAS} ORDER BY 1`)
  return r.rows.map((x) => String(x[0]))
}
