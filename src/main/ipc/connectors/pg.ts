/**
 * PostgreSQL connector (also Supabase, Neon, Timescale, CockroachDB's PG wire, …) over `pg`.
 *
 * Values are received in PostgreSQL's text format and converted here, so the mapping is explicit and
 * independent of the session's DateStyle / TimeZone:
 *   bool → boolean · int2/int4 → integer · int8 → bigint (as a JS number: exact up to 2^53, like Parquet
 *   reads) · numeric → decimal (JS double — Power Query's Decimal has 28 digits: a documented gap) ·
 *   float4/8 → double (NaN/±Infinity kept) · money → money · date → date · timestamp → timestamp (wall
 *   clock) · timestamptz → datetimeoffset in UTC (the instant is exact; PBI loads it as UTC) · time/timetz →
 *   time (timetz's offset is dropped) · json/jsonb → json text · uuid → text · bytea → binary ·
 *   one-dimensional arrays → lists (elements converted by the same rules) · everything else → text.
 * TLS: sslMode 'prefer' (default) tries TLS and falls back to plain when the server doesn't offer it;
 * 'require' needs TLS without verifying the certificate; 'verify-full' verifies it and the host name.
 */
import pg from 'pg'
import type { HostTable, SqlItem } from '../../../core/m/host'
import type { CredentialAuth } from '../../../shared/host'
import { ConnectorError, DEFAULT_MAX_ROWS, hostPort, type DbRunOptions } from './common'

// ---------------------------------------------------------------------------------------------
// Text-format value conversion (pure, exported for tests)

/** Element / column OIDs → host logical type. */
const OID_TYPES: Record<number, string> = {
  16: 'boolean',
  17: 'binary',
  20: 'bigint',
  21: 'integer',
  23: 'integer',
  26: 'integer',
  700: 'double',
  701: 'double',
  790: 'money',
  1700: 'decimal',
  1082: 'date',
  1114: 'timestamp',
  1184: 'datetimeoffset',
  1083: 'time',
  1266: 'time',
  114: 'json',
  3802: 'json',
  2950: 'guid'
}

/** Array OID → element OID. */
const ARRAY_OIDS: Record<number, number> = {
  1000: 16,
  1001: 17,
  1005: 21,
  1007: 23,
  1016: 20,
  1021: 700,
  1022: 701,
  1231: 1700,
  1009: 25,
  1015: 1043,
  1014: 1042,
  1182: 1082,
  1115: 1114,
  1185: 1184,
  1183: 1083,
  2951: 2950,
  199: 114,
  3807: 3802,
  791: 790
}

export function pgHostType(oid: number): string {
  if (oid in ARRAY_OIDS) return 'list'
  return OID_TYPES[oid] ?? 'varchar'
}

const TS_RE = /^(\d{4,})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:([+-])(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?)?( BC)?$/

/** 'YYYY-MM-DD HH:MM:SS[.ffffff][±HH[:MM[:SS]]]' → epoch ms (naive values are taken as UTC wall clock). */
export function parsePgTimestamp(s: string): number | null {
  const m = TS_RE.exec(s)
  if (!m || m[12]) return null
  const frac = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0
  let ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + frac
  if (Number(m[1]) < 100) ms = new Date(ms).setUTCFullYear(Number(m[1]))
  if (m[8]) {
    const off = (Number(m[9]) * 3600 + Number(m[10] ?? 0) * 60 + Number(m[11] ?? 0)) * 1000
    ms -= m[8] === '-' ? -off : off
  }
  return ms
}

export function parsePgBytea(s: string): Uint8Array {
  if (s.startsWith('\\x')) return new Uint8Array(Buffer.from(s.slice(2), 'hex'))
  // legacy escape format
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') {
      if (s[i + 1] === '\\') {
        out.push(92)
        i++
      } else {
        out.push(parseInt(s.slice(i + 1, i + 4), 8))
        i += 3
      }
    } else out.push(s.charCodeAt(i))
  }
  return new Uint8Array(out)
}

/** Parses a PostgreSQL array literal ('{1,2,NULL}', '{"a b","c\\"d"}', nested '{{1,2},{3,4}}'). */
export function parsePgArray(s: string, element: (text: string) => unknown): unknown[] {
  let i = 0
  // optional dimension decoration: '[1:2]={…}'
  if (s[0] === '[') i = s.indexOf('=') + 1
  const parse = (): unknown[] => {
    if (s[i] !== '{') throw new Error(`Malformed array literal: ${s}`)
    i++
    const out: unknown[] = []
    if (s[i] === '}') {
      i++
      return out
    }
    for (;;) {
      if (s[i] === '{') out.push(parse())
      else if (s[i] === '"') {
        i++
        let v = ''
        while (i < s.length && s[i] !== '"') {
          if (s[i] === '\\') i++
          v += s[i++]
        }
        i++
        out.push(element(v))
      } else {
        let j = i
        while (j < s.length && s[j] !== ',' && s[j] !== '}') j++
        const raw = s.slice(i, j).trim()
        out.push(raw === 'NULL' ? null : element(raw))
        i = j
      }
      if (s[i] === ',') i++
      else if (s[i] === '}') {
        i++
        return out
      } else throw new Error(`Malformed array literal: ${s}`)
    }
  }
  return parse()
}

function num(s: string): number {
  if (s === 'NaN') return NaN
  if (s === 'Infinity') return Infinity
  if (s === '-Infinity') return -Infinity
  return Number(s)
}

/** Converts one text-format value of a column with the given OID to the host value shape. */
export function convertPgText(text: string | null, oid: number): unknown {
  if (text === null) return null
  const elem = ARRAY_OIDS[oid]
  if (elem !== undefined) return parsePgArray(text, (t) => convertPgText(t, elem))
  switch (OID_TYPES[oid]) {
    case 'boolean':
      return text === 't' || text === 'true'
    case 'binary':
      return parsePgBytea(text)
    case 'integer':
    case 'bigint':
    case 'double':
    case 'decimal':
      return num(text)
    case 'money': {
      const neg = /^-|\(.*\)$/.test(text.trim())
      const n = Number(text.replace(/[^0-9.]/g, ''))
      return Number.isNaN(n) ? null : neg ? -n : n
    }
    case 'date': {
      if (text === 'infinity' || text === '-infinity' || text.endsWith(' BC')) return null
      return text
    }
    case 'timestamp':
    case 'datetimeoffset': {
      const ms = parsePgTimestamp(text)
      return ms === null ? null : new Date(ms)
    }
    case 'time':
      // timetz: drop the offset (M's time has none)
      return text.replace(/[+-]\d{2}(:?\d{2})?(:?\d{2})?$/, '')
    default:
      return text
  }
}

// ---------------------------------------------------------------------------------------------
// Connections

export interface PgTarget {
  server: string
  database: string
  auth?: CredentialAuth
}

const pools = new Map<string, Promise<pg.Pool>>()

function poolKey(t: PgTarget): string {
  return JSON.stringify([t.server.toLowerCase(), t.database, t.auth?.user ?? '', t.auth?.password ?? '', t.auth?.sslMode ?? 'prefer'])
}

const rawText = { getTypeParser: () => (v: string) => v } as unknown as pg.CustomTypesConfig

function makePool(t: PgTarget, ssl: boolean | { rejectUnauthorized: boolean }, timeoutMs: number): pg.Pool {
  const { host, port } = hostPort(t.server, 5432)
  const pool = new pg.Pool({
    host,
    port,
    database: t.database || 'postgres',
    user: t.auth?.user,
    password: t.auth?.password,
    ssl,
    max: 4,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 20_000,
    query_timeout: timeoutMs,
    application_name: 'Lumen',
    types: rawText
  })
  pool.on('error', () => undefined)
  return pool
}

async function openPool(t: PgTarget, timeoutMs: number): Promise<pg.Pool> {
  const mode = t.auth?.sslMode ?? 'prefer'
  const attempt = async (ssl: boolean | { rejectUnauthorized: boolean }) => {
    const pool = makePool(t, ssl, timeoutMs)
    try {
      const c = await pool.connect()
      c.release()
      return pool
    } catch (e) {
      void pool.end().catch(() => undefined)
      throw e
    }
  }
  if (mode === 'disable') return attempt(false)
  if (mode === 'verify-full') return attempt({ rejectUnauthorized: true })
  if (mode === 'require') return attempt({ rejectUnauthorized: false })
  try {
    return await attempt({ rejectUnauthorized: false })
  } catch (e) {
    if (/does not support SSL|SSL off|ECONNRESET|EPROTO|wrong version number/i.test(String((e as Error).message))) return attempt(false)
    throw e
  }
}

async function pool(t: PgTarget, timeoutMs: number): Promise<pg.Pool> {
  const key = poolKey(t)
  let p = pools.get(key)
  if (!p) {
    p = openPool(t, timeoutMs)
    pools.set(key, p)
    p.catch(() => pools.delete(key))
  }
  return p
}

export async function closePgPools(): Promise<void> {
  const all = [...pools.values()]
  pools.clear()
  await Promise.all(all.map((p) => p.then((x) => x.end()).catch(() => undefined)))
}

function explain(e: unknown, t: PgTarget): ConnectorError {
  const err = e as { message?: string; code?: string }
  const msg = err.message ?? String(e)
  const { host } = hostPort(t.server, 5432)
  if (err.code === '28P01' || err.code === '28000') return new ConnectorError(`${msg}. We couldn't authenticate with the credentials provided (Data source settings ▸ Edit Permissions).`, 'credentials')
  if (err.code === '3D000') return new ConnectorError(msg, 'notFound')
  if (/ENOTFOUND|getaddrinfo/.test(msg)) return new ConnectorError(`The server '${host}' was not found or was not accessible (${msg}).`)
  if (/ECONNREFUSED/.test(msg)) return new ConnectorError(`The server '${host}' refused the connection (is PostgreSQL listening on that port?).`)
  if (/self[- ]signed|certificate|unable to verify/i.test(msg)) return new ConnectorError(`${msg} — the server's TLS certificate couldn't be verified. Use the SSL mode 'require' in Data source settings to encrypt without verifying.`)
  return new ConnectorError(msg)
}

export async function pgQuery(t: PgTarget, sql: string, opts: DbRunOptions = {}): Promise<HostTable> {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS
  try {
    const p = await pool(t, opts.timeoutMs ?? 30 * 60_000)
    const r = await p.query({ text: sql, rowMode: 'array' })
    const res = Array.isArray(r) ? (r[r.length - 1] as pg.QueryResult) : r
    const fields = res.fields ?? []
    if (res.rows.length > maxRows) throw new ConnectorError(`The query returned more than ${maxRows.toLocaleString()} rows (the row limit). Filter the source or raise the limit.`)
    const oids = fields.map((f) => f.dataTypeID)
    const rows = (res.rows as unknown as (string | null)[][]).map((row) => row.map((v, i) => convertPgText(v, oids[i]!)))
    return { columns: fields.map((f) => ({ name: f.name, type: pgHostType(f.dataTypeID) })), rows }
  } catch (e) {
    throw e instanceof ConnectorError ? e : explain(e, t)
  }
}

export async function pgItems(t: PgTarget): Promise<SqlItem[]> {
  const r = await pgQuery(
    t,
    `SELECT table_schema, table_name, table_type FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'pg_toast%' AND table_schema NOT LIKE 'pg_temp%'
     UNION ALL
     SELECT schemaname, matviewname, 'VIEW' FROM pg_matviews
     ORDER BY 1, 2`
  )
  return r.rows.map((x) => ({ schema: String(x[0]), item: String(x[1]), kind: String(x[2]) === 'BASE TABLE' ? 'Table' : 'View' }))
}

export async function pgDatabases(t: PgTarget): Promise<string[]> {
  const r = await pgQuery({ ...t, database: t.database || 'postgres' }, 'SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY 1')
  return r.rows.map((x) => String(x[0]))
}
