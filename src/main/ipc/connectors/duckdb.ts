/**
 * DuckDB (`DuckDB.Database(path, [Query])`) through DuckDB-WASM's blocking Node build (no native module):
 *
 *  - a `.duckdb` file is read into memory and attached READ_ONLY (navigation = its schemas' tables and views,
 *    native queries run with it as the current database); the copy is reused until the file changes;
 *  - a folder is a lakehouse: every Delta table (`Tables/<name>/` or the folder itself when it has a `_delta_log`)
 *    becomes a view over its current snapshot (the log replayed here: checkpoint + commits, partition values,
 *    column mapping), and every Parquet file under the folder (`Files/…`) can be read by its relative path, e.g.
 *    `SELECT * FROM read_parquet('Files/raw/orders.parquet')`. Deletion vectors are refused (wrong rows otherwise).
 *
 * Native queries must be read-only statements (SELECT / WITH / FROM / VALUES / DESCRIBE / SHOW / SUMMARIZE /
 * PIVOT / UNPIVOT / TABLE / EXPLAIN): the attached file is read-only anyway, but a query could otherwise write files
 * through COPY / EXPORT. Values are normalized for the M engine (decimals and hugeints as doubles, dates and
 * timestamps as Date with UTC fields = wall clock, nested values as JSON text).
 */
import { createRequire } from 'node:module'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import type { HostTable, SqlItem } from '../../../core/m/host'
import { ConnectorError, DEFAULT_MAX_ROWS, type DbRunOptions } from './common'

interface ArrowField {
  name: string
  type: { typeId: number; toString(): string }
}
interface ArrowTable {
  numRows: number
  schema: { fields: ArrowField[] }
  getChildAt(i: number): { get(i: number): unknown } | null
}
interface Conn {
  query(sql: string): ArrowTable
  close(): void
}
interface Bindings {
  connect(): Conn
  registerFileBuffer(name: string, buffer: Uint8Array): void
  registerFileURL(name: string, url: string, proto: number, directIO: boolean): void
  dropFile(name: string): void
  reset(): void
}
interface DuckModule {
  createDuckDB(bundles: object, logger: object, runtime: object): Promise<Bindings & { instantiate(cb: () => void): Promise<unknown>; open(cfg: object): void }>
  VoidLogger: new () => object
  NODE_RUNTIME: object
  DuckDBDataProtocol: { NODE_FS: number }
}

const req: NodeRequire = typeof require === 'function' ? require : createRequire(import.meta.url)

let modulePromise: Promise<DuckModule> | null = null
function duckModule(): Promise<DuckModule> {
  modulePromise ??= Promise.resolve(req('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs') as DuckModule)
  return modulePromise
}

/** A fresh DuckDB instance (one per source: separate catalogs and file registrations). */
async function newDuckDB(): Promise<Bindings> {
  const duckdb = await duckModule()
  const dist = dirname(req.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'))
  const bundles = {
    mvp: { mainModule: join(dist, 'duckdb-mvp.wasm'), mainWorker: join(dist, 'duckdb-node-mvp.worker.cjs') },
    eh: { mainModule: join(dist, 'duckdb-eh.wasm'), mainWorker: join(dist, 'duckdb-node-eh.worker.cjs') }
  }
  const b = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME)
  await b.instantiate(() => {})
  // decimals and 64-bit integers as doubles (the M engine's numbers), timestamps as milliseconds
  b.open({ query: { castBigIntToDouble: true, castDecimalToDouble: true, castTimestampToDate: true } })
  return b
}

interface Source {
  db: Bindings
  conn: Conn
  /** file: size/mtime; folder: a signature of the Delta logs and Parquet files */
  version: string
  kind: 'file' | 'lakehouse'
  /** lakehouse: relative Parquet paths registered with DuckDB */
  files: string[]
}

const sources = new Map<string, Source>()
const MAX_SOURCES = 6

export function closeDuckDbSources(): void {
  for (const s of sources.values()) {
    try {
      s.conn.close()
      s.db.reset()
    } catch {
      /* already closed */
    }
  }
  sources.clear()
}

const q = (n: string) => `"${n.replace(/"/g, '""')}"`
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`

async function source(path: string): Promise<Source> {
  let st
  try {
    st = await stat(path)
  } catch {
    throw new ConnectorError(`We couldn't find the file or folder '${path}'.`, 'notFound')
  }
  if (st.isDirectory()) return lakehouseSource(path)
  const version = `${st.size}:${st.mtimeMs}`
  const cur = sources.get(path)
  if (cur && cur.version === version) return cur
  const bytes = new Uint8Array(await readFile(path))
  if (bytes.length >= 12 && new TextDecoder('latin1').decode(bytes.subarray(8, 12)) !== 'DUCK') throw new ConnectorError(`'${path}' isn't a DuckDB database file.`)
  const db = await newDuckDB()
  const conn = db.connect()
  db.registerFileBuffer('source.duckdb', bytes)
  // changes not yet checkpointed live in the write-ahead log next to the file
  try {
    db.registerFileBuffer('source.duckdb.wal', new Uint8Array(await readFile(`${path}.wal`)))
  } catch {
    /* no WAL */
  }
  try {
    conn.query("ATTACH 'source.duckdb' AS source (READ_ONLY)")
    conn.query('USE source')
  } catch (e) {
    conn.close()
    db.reset()
    throw new ConnectorError(`DuckDB couldn't open '${path}': ${(e as Error).message}`)
  }
  return remember(path, { db, conn, version, kind: 'file', files: [] }, cur)
}

function remember(path: string, s: Source, old?: Source): Source {
  if (old) {
    try {
      old.conn.close()
      old.db.reset()
    } catch {
      /* ignore */
    }
  }
  sources.delete(path)
  sources.set(path, s)
  while (sources.size > MAX_SOURCES) {
    const [k, v] = sources.entries().next().value as [string, Source]
    try {
      v.conn.close()
      v.db.reset()
    } catch {
      /* ignore */
    }
    sources.delete(k)
  }
  return s
}

// ---------------------------------------------------------------------------------------------
// lakehouse folders

interface Walked {
  rel: string
  abs: string
  size: number
  mtime: number
}

async function walk(root: string, dir = root, out: Walked[] = [], depth = 0): Promise<Walked[]> {
  if (depth > 12) return out
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const abs = join(dir, e.name)
    if (e.isDirectory()) await walk(root, abs, out, depth + 1)
    else if (e.isFile()) {
      const s = await stat(abs)
      out.push({ rel: relative(root, abs).split(sep).join('/'), abs, size: s.size, mtime: s.mtimeMs })
    }
  }
  return out
}

interface DeltaAction {
  add?: { path: string; partitionValues?: Record<string, string | null> | null; deletionVector?: unknown } | null
  remove?: { path: string } | null
  metaData?: { schemaString?: string; partitionColumns?: string[]; configuration?: Record<string, string | null> } | null
}

/** Views of the Delta tables and registrations of the Parquet files of a lakehouse folder. */
async function lakehouseSource(path: string): Promise<Source> {
  const files = await walk(path)
  const version = files.map((f) => `${f.rel}:${f.size}:${f.mtime}`).join('|')
  const cur = sources.get(path)
  if (cur && cur.version === version) return cur
  const db = await newDuckDB()
  const conn = db.connect()
  const proto = (await duckModule()).DuckDBDataProtocol.NODE_FS
  const parquet = files.filter((f) => /\.parquet$/i.test(f.rel))
  for (const f of parquet) db.registerFileURL(f.rel, f.abs, proto, false)
  // Delta tables: folders with a _delta_log (Tables/<name>/ in a Fabric lakehouse, or the folder itself)
  const roots = new Set<string>()
  for (const f of files) {
    const m = /^(.*?)_delta_log\/[^/]+$/.exec(f.rel)
    if (m) roots.add(m[1]!)
  }
  try {
    for (const root of [...roots].sort()) {
      const name = root === '' ? (path.split(/[\\/]/).filter(Boolean).pop() ?? 'table') : root.replace(/\/$/, '').split('/').pop()!
      const sql = await deltaViewSql(conn, root, files)
      conn.query(`CREATE OR REPLACE VIEW ${q(name)} AS ${sql}`)
    }
  } catch (e) {
    conn.close()
    db.reset()
    throw e instanceof ConnectorError ? e : new ConnectorError(String((e as Error).message ?? e))
  }
  return remember(path, { db, conn, version, kind: 'lakehouse', files: parquet.map((f) => f.rel) }, cur)
}

/** SELECT over the active files of the Delta table at `root` (relative, '' or ending with '/'). */
async function deltaViewSql(conn: Conn, root: string, files: Walked[]): Promise<string> {
  const logDir = `${root}_delta_log/`
  const log = files.filter((f) => f.rel.startsWith(logDir) && !f.rel.slice(logDir.length).includes('/'))
  const nameOf = (f: Walked) => f.rel.slice(logDir.length)
  const commits = log
    .filter((f) => /^\d{20}\.json$/.test(nameOf(f)))
    .map((f) => ({ v: Number(nameOf(f).slice(0, 20)), f }))
    .sort((a, b) => a.v - b.v)
  const checkpoints = new Map<number, Walked[]>()
  for (const f of log) {
    const m = /^(\d{20})\.checkpoint(?:\.\d{10}\.\d{10})?\.parquet$/.exec(nameOf(f))
    if (m) checkpoints.set(Number(m[1]), [...(checkpoints.get(Number(m[1])) ?? []), f])
  }
  let cp = checkpoints.size ? Math.max(...checkpoints.keys()) : -1
  const lastCp = log.find((f) => nameOf(f) === '_last_checkpoint')
  if (lastCp) {
    try {
      const v = (JSON.parse(await readFile(lastCp.abs, 'utf8')) as { version?: number }).version
      if (typeof v === 'number' && checkpoints.has(v)) cp = v
    } catch {
      /* torn _last_checkpoint: the files present decide */
    }
  }
  const where = root || '.'
  const actions: DeltaAction[] = []
  if (cp >= 0) {
    const parts = checkpoints.get(cp)!.map((f) => lit(f.rel)).join(', ')
    const t = conn.query(`SELECT CAST(to_json("add") AS VARCHAR), CAST(to_json("remove") AS VARCHAR), CAST(to_json("metaData") AS VARCHAR) FROM read_parquet([${parts}], union_by_name = true)`)
    const cols = [0, 1, 2].map((i) => t.getChildAt(i)!)
    const parse = (v: unknown) => (typeof v === 'string' && v !== 'null' ? JSON.parse(v) : null)
    for (let i = 0; i < t.numRows; i++) actions.push({ add: parse(cols[0]!.get(i)), remove: parse(cols[1]!.get(i)), metaData: parse(cols[2]!.get(i)) })
  } else if (!commits.length || commits[0]!.v !== 0) {
    throw new ConnectorError(`DuckDB: the Delta table '${where}' has neither a checkpoint nor its first commit; its history is incomplete.`)
  }
  const replay = commits.filter((c) => c.v > cp)
  for (let i = 1; i < replay.length; i++) if (replay[i]!.v !== replay[i - 1]!.v + 1) throw new ConnectorError(`DuckDB: commit ${replay[i - 1]!.v + 1} of the Delta table '${where}' is missing.`)
  for (const c of replay) {
    for (const line of (await readFile(c.f.abs, 'utf8')).split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        actions.push(JSON.parse(line) as DeltaAction)
      } catch {
        throw new ConnectorError(`DuckDB: the Delta commit '${c.f.rel}' isn't valid JSON.`)
      }
    }
  }
  const active = new Map<string, NonNullable<DeltaAction['add']>>()
  let meta: NonNullable<DeltaAction['metaData']> | null = null
  for (const a of actions) {
    if (a.metaData) meta = a.metaData
    if (a.add) active.set(decodeURIComponent(a.add.path), a.add)
    if (a.remove) active.delete(decodeURIComponent(a.remove.path))
  }
  type Field = { name: string; type: unknown; metadata?: Record<string, unknown> }
  let fields: Field[] = []
  try {
    fields = (JSON.parse(meta?.schemaString ?? '{}') as { fields?: Field[] }).fields ?? []
  } catch {
    fields = []
  }
  const mapping = meta?.configuration?.['delta.columnMapping.mode'] ?? 'none'
  const physicalOf = (f: Field) => (mapping !== 'none' && typeof f.metadata?.['delta.columnMapping.physicalName'] === 'string' ? (f.metadata['delta.columnMapping.physicalName'] as string) : f.name)
  const partitionCols = meta?.partitionColumns ?? []
  const typeOf = (t: unknown): string => {
    switch (t) {
      case 'string':
        return 'VARCHAR'
      case 'long':
        return 'BIGINT'
      case 'integer':
      case 'short':
      case 'byte':
        return 'INTEGER'
      case 'double':
        return 'DOUBLE'
      case 'float':
        return 'FLOAT'
      case 'boolean':
        return 'BOOLEAN'
      case 'date':
        return 'DATE'
      case 'timestamp':
      case 'timestamp_ntz':
        return 'TIMESTAMP'
      default:
        return typeof t === 'string' && /^decimal\(\d+,\s*\d+\)$/.test(t) ? t.toUpperCase() : 'VARCHAR'
    }
  }
  const known = new Set(files.map((f) => f.rel))
  // group the active files by partition values (constant columns of each group)
  const groups = new Map<string, { pv: Record<string, string | null>; files: string[] }>()
  for (const [p, add] of active) {
    if (add.deletionVector) throw new ConnectorError(`DuckDB: the Delta table '${where}' uses deletion vectors, which Lumen can't apply yet (the rows would include deleted ones). Purge them first (REORG TABLE … APPLY (PURGE), or OPTIMIZE in Fabric).`)
    const rel = `${root}${p}`
    if (!known.has(rel)) throw new ConnectorError(`DuckDB: the data file '${p}' listed in the Delta log of '${where}' is missing.`, 'notFound')
    const pv: Record<string, string | null> = Array.isArray(add.partitionValues)
      ? Object.fromEntries((add.partitionValues as Array<{ key: string; value: string | null }>).map((x) => [x.key, x.value]))
      : (add.partitionValues ?? {})
    const key = JSON.stringify(partitionCols.map((c) => pv[c] ?? null))
    const g = groups.get(key) ?? { pv, files: [] }
    g.files.push(rel)
    groups.set(key, g)
  }
  const dataFields = fields.filter((f) => !partitionCols.includes(f.name))
  const selectFor = (g: { pv: Record<string, string | null>; files: string[] }) => {
    const items = dataFields.length ? dataFields.map((f) => `${q(physicalOf(f))} AS ${q(f.name)}`) : ['*']
    for (const c of partitionCols) {
      const f = fields.find((x) => x.name === c)
      const raw = g.pv[c] ?? (f ? g.pv[physicalOf(f)] : undefined) ?? null
      items.push(`CAST(${raw === null ? 'NULL' : lit(raw)} AS ${typeOf(f?.type)}) AS ${q(c)}`)
    }
    return `SELECT ${items.join(', ')} FROM read_parquet([${g.files.map(lit).join(', ')}], union_by_name = true)`
  }
  if (!groups.size) {
    // an empty table: typed, no rows
    const cols = fields.length ? fields.map((f) => `CAST(NULL AS ${typeOf(f.type)}) AS ${q(f.name)}`).join(', ') : 'NULL AS "empty"'
    return `SELECT ${cols} WHERE FALSE`
  }
  return [...groups.values()].map(selectFor).join(' UNION ALL BY NAME ')
}

// ---------------------------------------------------------------------------------------------
// queries

const READ_ONLY = /^\s*(\(\s*)*(SELECT|WITH|FROM|VALUES|DESCRIBE|SHOW|SUMMARIZE|PIVOT|UNPIVOT|TABLE|EXPLAIN)\b/i

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
}

/** DuckDB type name → host type + the expression that converts the column to a JS-friendly Arrow type. */
function converter(name: string, type: string): { host: string; expr: string } {
  const c = q(name)
  const t = type.toUpperCase()
  if (t === 'BOOLEAN') return { host: 'boolean', expr: c }
  if (/^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT)$/.test(t)) return { host: 'bigint', expr: `CAST(${c} AS DOUBLE)` }
  if (/^(FLOAT|DOUBLE|REAL)$/.test(t)) return { host: 'double', expr: `CAST(${c} AS DOUBLE)` }
  if (t.startsWith('DECIMAL')) return { host: 'decimal', expr: `CAST(${c} AS DOUBLE)` }
  if (t === 'DATE') return { host: 'date', expr: `CAST(epoch_ms(CAST(${c} AS TIMESTAMP)) AS DOUBLE)` }
  if (t === 'TIMESTAMP WITH TIME ZONE' || t === 'TIMESTAMPTZ') return { host: 'timestamptz', expr: `CAST(epoch_ms(${c}) AS DOUBLE)` }
  if (t.startsWith('TIMESTAMP')) return { host: 'timestamp', expr: `CAST(epoch_ms(CAST(${c} AS TIMESTAMP)) AS DOUBLE)` }
  if (t.startsWith('TIME')) return { host: 'time', expr: `CAST(${c} AS VARCHAR)` }
  if (t === 'VARCHAR' || t.startsWith('ENUM')) return { host: 'varchar', expr: `CAST(${c} AS VARCHAR)` }
  if (t === 'UUID') return { host: 'uuid', expr: `CAST(${c} AS VARCHAR)` }
  if (t === 'BLOB' || t === 'BIT') return { host: t === 'BLOB' ? 'binary' : 'varchar', expr: t === 'BLOB' ? c : `CAST(${c} AS VARCHAR)` }
  if (t === 'JSON' || /[[\]]|^STRUCT|^MAP|^UNION|^LIST/.test(t)) return { host: 'json', expr: `CAST(to_json(${c}) AS VARCHAR)` }
  return { host: 'varchar', expr: `CAST(${c} AS VARCHAR)` }
}

function run(s: Source, sql: string, maxRows: number): HostTable {
  const body = stripComments(sql).trim().replace(/;\s*$/, '')
  if (!READ_ONLY.test(body)) throw new ConnectorError('DuckDB: native queries must be read-only (SELECT, WITH, FROM, VALUES, DESCRIBE, SHOW, SUMMARIZE, PIVOT, UNPIVOT, TABLE or EXPLAIN).')
  try {
    let described: Array<{ name: string; type: string }> | null = null
    try {
      const d = s.conn.query(`DESCRIBE ${body}`)
      const n = d.getChildAt(0)!
      const ty = d.getChildAt(1)!
      described = Array.from({ length: d.numRows }, (_, i) => ({ name: String(n.get(i)), type: String(ty.get(i)) }))
    } catch {
      described = null // e.g. SHOW / EXPLAIN: read the result as it comes
    }
    if (!described) return arrowToHost(s.conn.query(body), maxRows, null)
    const conv = described.map((c) => converter(c.name, c.type))
    const t = s.conn.query(`SELECT ${conv.map((c, i) => `${c.expr} AS ${q(described![i]!.name)}`).join(', ')} FROM (${body}) LIMIT ${maxRows + 1}`)
    return arrowToHost(t, maxRows, conv.map((c) => c.host))
  } catch (e) {
    if (e instanceof ConnectorError) throw e
    const msg = String((e as Error).message ?? e)
    throw new ConnectorError(msg.replace(/^Error:\s*/, ''), /does not exist|not found/i.test(msg) ? 'notFound' : 'error')
  }
}

function arrowToHost(t: ArrowTable, maxRows: number, hostTypes: string[] | null): HostTable {
  if (t.numRows > maxRows) throw new ConnectorError(`The query returned more than ${maxRows.toLocaleString()} rows (the row limit).`)
  const fields = t.schema.fields
  const types = hostTypes ?? fields.map(() => 'varchar')
  const rows: unknown[][] = Array.from({ length: t.numRows }, () => new Array(fields.length))
  fields.forEach((_, j) => {
    const v = t.getChildAt(j)!
    const ty = types[j]!
    for (let i = 0; i < t.numRows; i++) {
      let x = v.get(i) as unknown
      if (x === undefined) x = null
      if (x !== null) {
        if (ty === 'date' || ty === 'timestamp' || ty === 'timestamptz') x = new Date(Number(x))
        else if (typeof x === 'bigint') x = Number(x)
        else if (!hostTypes && typeof x !== 'string' && typeof x !== 'number' && typeof x !== 'boolean' && !(x instanceof Uint8Array)) x = String(x)
      }
      rows[i]![j] = x
    }
  })
  return { columns: fields.map((f, j) => ({ name: f.name, type: types[j]! })), rows }
}

/** A native query, or the read of a navigation item (`table`) — `sql` then selects from it. */
export async function duckdbQuery(path: string, sql: string, table?: { schema: string; item: string }, opts: DbRunOptions = {}): Promise<HostTable> {
  const s = await source(path)
  void table
  return run(s, sql, opts.maxRows ?? DEFAULT_MAX_ROWS)
}

export async function duckdbItems(path: string): Promise<SqlItem[]> {
  const s = await source(path)
  const t = run(s, "SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_catalog = current_database() ORDER BY table_schema, table_name", DEFAULT_MAX_ROWS)
  return t.rows.map((r) => ({ schema: String(r[0]), item: String(r[1]), kind: /VIEW/i.test(String(r[2])) ? 'View' : 'Table' }))
}
