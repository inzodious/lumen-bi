/**
 * The async side of the M engine: performs `DataRequest`s (see src/core/m/host.ts) over the app host —
 * filesystem (incl. network shares: smb://host/share/… and \\host\share\… paths resolve to their mounted
 * location), SQL Server / HTTP / PostgreSQL / MySQL / SQLite / Firestore / S3 connectors (main process via
 * IPC; credentials come from the main-process store), xlsx / parquet decoding.
 */
import type { FileSystem } from '../io/fs'
import type { PrivacyLevel, SqlAuth, WbiHost } from '../../shared/host'
import type { SemanticModel } from '../model/types'
import { MError } from '../m/errors.ts'
import type { DataFetcher } from '../m/driver.ts'
import type { DataRequest, HostFileEntry, HostTable } from '../m/host.ts'
import { parseExpression } from '../m/parser.ts'
import { dataSourceLabel, dataSourcesOf, queryMap, type DataSourceRef } from './queries'

export interface RefreshHost {
  fs: FileSystem
  connectors: WbiHost['connectors']
  now(): Date
  /**
   * Credentials for a data source (Data source settings). Return undefined for the default:
   * Microsoft Entra ID through the Azure CLI login, falling back to a device-code sign-in.
   */
  credentials?(source: DataSourceRef): SqlAuth | undefined | Promise<SqlAuth | undefined>
  /** Row cap per SQL read (default 5,000,000). */
  maxRows?: number
  /** Offset of local time from UTC in minutes for DateTime.LocalNow (default: this machine's offset). */
  localOffsetMinutes?: number
  /** Privacy level of a data source (Data source settings). Undefined = not set. */
  privacy?(source: DataSourceRef): PrivacyLevel | undefined
}

// ---------------------------------------------------------------------------------------------
// Privacy levels

function identifiers(src: string): Set<string> {
  const out = new Set<string>()
  const walk = (e: unknown): void => {
    if (!e || typeof e !== 'object') return
    if (Array.isArray(e)) return e.forEach(walk)
    const n = e as { t?: string; name?: string }
    if (n.t === 'ident' && typeof n.name === 'string') out.add(n.name)
    for (const [k, v] of Object.entries(n)) if (k !== 'pos' && k !== 'span' && v && typeof v === 'object') walk(v)
  }
  try {
    walk(parseExpression(src))
  } catch {
    /* unparsable drafts: no sources */
  }
  return out
}

/** Data sources a query reads, following references to other queries. */
export function sourcesOfQuery(model: SemanticModel, source: string, queries: Record<string, string> = queryMap(model)): DataSourceRef[] {
  const seen = new Map<string, string>()
  const todo = [source]
  while (todo.length) {
    const src = todo.pop()!
    for (const id of identifiers(src)) {
      if (id in queries && !seen.has(id)) {
        seen.set(id, queries[id]!)
        todo.push(queries[id]!)
      }
    }
  }
  const synthetic: SemanticModel = { ...model, tables: [], expressions: [{ name: '\u0000self', kind: 'm', expression: source }, ...[...seen].map(([name, expression]) => ({ name, kind: 'm' as const, expression }))] }
  return dataSourcesOf(synthetic).filter((s) => s.kind !== 'other')
}

/**
 * Privacy levels (Power BI's formula firewall, simplified): when a query combines sources and one of them
 * is Private — or Organizational data meets a Public source — values computed from one source must not be
 * sent to another inside a folded query. Lumen then evaluates such filters locally (`foldComputed: false`)
 * instead of refusing the query, and says so. The direction of a flow isn't tracked, so Public data
 * folded into an Organizational source is kept local too: conservative (slower), never different numbers.
 */
export function privacyPlan(sources: DataSourceRef[], privacyOf: RefreshHost['privacy']): { foldComputed: boolean; warnings: string[] } {
  if (sources.length < 2 || !privacyOf) return { foldComputed: true, warnings: [] }
  const levels = sources.map((s) => ({ s, level: privacyOf(s) ?? 'None' }))
  const priv = levels.filter((x) => x.level === 'Private')
  const org = levels.filter((x) => x.level === 'Organizational')
  const pub = levels.filter((x) => x.level === 'Public')
  if (priv.length) {
    return {
      foldComputed: false,
      warnings: [`Privacy levels: ${priv.map((x) => dataSourceLabel(x.s)).join(', ')} ${priv.length > 1 ? 'are' : 'is'} Private, so values from ${priv.length > 1 ? 'them' : 'it'} are not sent to the other sources of this query; filters that use them are evaluated in Lumen.`]
    }
  }
  if (org.length && pub.length) {
    return {
      foldComputed: false,
      warnings: [`Privacy levels: Organizational data (${org.map((x) => dataSourceLabel(x.s)).join(', ')}) is not sent to Public sources (${pub.map((x) => dataSourceLabel(x.s)).join(', ')}); filters that combine them are evaluated in Lumen.`]
    }
  }
  return { foldComputed: true, warnings: [] }
}

export const DEFAULT_MAX_ROWS = 5_000_000

function sqlIdent(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`
}

/** The SELECT a (possibly folded) navigation read sends. */
export function sqlTextOf(req: Extract<DataRequest, { kind: 'sql' }>): string | undefined {
  if (req.query) return req.query
  if (!req.item) return undefined
  const cols = req.columns?.length ? req.columns.map(sqlIdent).join(', ') : '*'
  const from = `${req.schema ? `${sqlIdent(req.schema)}.` : ''}${sqlIdent(req.item)}`
  const top = req.top !== undefined && !req.skip ? `TOP (${req.top}) ` : ''
  let sql = `SELECT ${top}${cols} FROM ${from}${req.where ? ` WHERE ${req.where}` : ''}${req.orderBy ? ` ORDER BY ${req.orderBy}` : ''}`
  if (req.skip) sql += ` OFFSET ${req.skip} ROWS${req.top !== undefined ? ` FETCH NEXT ${req.top} ROWS ONLY` : ''}`
  return sql
}

const CONNECTOR_LABEL: Record<string, string> = { postgresql: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite', duckdb: 'DuckDB' }

function remoteMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}

/** A connector failure as the M error Power Query would raise. */
function connectorError(req: DataRequest, e: unknown): MError {
  if (e instanceof MError) return e
  const msg = remoteMessage(e)
  const kind = (e as { kind?: string }).kind
  const notFound = kind === 'notFound' || /couldn't find|doesn't exist|does not exist|NoSuchBucket|NOT_FOUND/i.test(msg)
  let label = ''
  let path = ''
  switch (req.kind) {
    case 'db':
    case 'db-items':
    case 'db-databases':
      label = CONNECTOR_LABEL[req.driver] ?? req.driver
      path = req.driver === 'sqlite' || req.driver === 'duckdb' ? req.server : `${req.server}${'database' in req && req.database ? `;${req.database}` : ''}`
      break
    case 'firestore-collections':
    case 'firestore-query':
      label = 'Firestore'
      path = req.project
      break
    case 's3-list':
    case 's3-object':
      label = 'Amazon S3'
      path = `s3://${req.bucket}/${req.kind === 's3-list' ? req.prefix : req.key}`
      break
  }
  const text = msg.startsWith(`${label}:`) ? msg : `${label}: ${msg}`
  return new MError(notFound ? 'DataSource.NotFound' : 'DataSource.Error', text, path)
}

const SHARE_RE = /^(smb|nfs):\/\/|^\\\\/i

/** `\\host\share\dir` → `smb://host/share/dir` (the form Lumen reports in Folder Path). */
export function shareUrlOf(path: string): string {
  if (!path.startsWith('\\\\')) return path.replace(/\/+$/, '')
  return `smb://${path.slice(2).replace(/\\/g, '/').replace(/\/+$/, '')}`
}

function fileError(path: string, e: unknown): MError {
  const msg = e instanceof Error ? e.message : String(e)
  if (/ENOENT|not found|no such file/i.test(msg)) return new MError('DataSource.NotFound', `File or Folder: We couldn't find the file '${path}'.`, path)
  if (/EACCES|EPERM|permission/i.test(msg)) return new MError('DataSource.Error', `File or Folder: Access to the path '${path}' is denied.`, path)
  return new MError('DataSource.Error', `File or Folder: ${msg}`, path)
}

function sqlError(server: string, database: string, e: unknown): MError {
  const msg = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
  return new MError('DataSource.Error', `Microsoft SQL: ${msg}`, `${server};${database}`)
}

async function listFolder(fs: FileSystem, path: string, recursive: boolean): Promise<HostFileEntry[]> {
  const out: HostFileEntry[] = []
  const entries = await fs.list(path)
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of entries) {
    if (e.isDirectory) {
      if (recursive) out.push(...(await listFolder(fs, e.path, true)))
      else out.push({ name: e.name, path: e.path, isFolder: true, modified: e.mtime })
    } else out.push({ name: e.name, path: e.path, isFolder: false, size: e.size, modified: e.mtime })
  }
  return out
}

/** Creates the fetcher used by refresh and previews. */
export function createFetcher(host: RefreshHost): DataFetcher {
  const auths = new Map<string, Promise<SqlAuth>>()
  const authFor = (server: string, database?: string): Promise<SqlAuth> => {
    const key = `${server.toLowerCase()};${(database ?? '').toLowerCase()}`
    let p = auths.get(key)
    if (!p) {
      p = Promise.resolve(host.credentials?.({ kind: 'sql', server, database })).then((a) => a ?? { kind: 'azure-default' })
      auths.set(key, p)
    }
    return p
  }
  const maxRows = host.maxRows ?? DEFAULT_MAX_ROWS

  /** Network share URL → mounted local path (cached per run). */
  const resolved = new Map<string, Promise<string>>()
  const localOf = (path: string): Promise<string> => {
    if (!SHARE_RE.test(path)) return Promise.resolve(path)
    const url = shareUrlOf(path)
    let p = resolved.get(url)
    if (!p) {
      const resolve = host.connectors.shares?.resolve
      p = (resolve ? resolve(url) : Promise.resolve(null)).then((local) => {
        if (!local) {
          throw new MError(
            'DataSource.Error',
            `File or Folder: The network share for '${url}' isn't mounted. Mount it in Get data ▸ Network share (or run: gio mount ${url.replace(/^(smb:\/\/[^/]+\/[^/]+).*$/, '$1')}).`,
            url
          )
        }
        return local
      })
      resolved.set(url, p)
      p.catch(() => resolved.delete(url))
    }
    return p
  }

  let seq = 0
  return async (req, signal) => {
    // connector requests carry a cancelId; aborting the refresh asks the host to stop them
    let cancelId: string | undefined
    if (signal && host.connectors.cancel) {
      const id = (cancelId = `r${Date.now().toString(36)}-${++seq}`)
      const cancel = host.connectors.cancel.bind(host.connectors)
      signal.addEventListener('abort', () => void cancel(id).catch(() => undefined), { once: true })
    }
    switch (req.kind) {
      case 'file': {
        const local = await localOf(req.path)
        try {
          return await host.fs.readFile(local)
        } catch (e) {
          throw fileError(req.path, e)
        }
      }
      case 'folder': {
        const local = await localOf(req.path)
        try {
          const entries = await listFolder(host.fs, local.replace(/\/+$/, '') || '/', req.recursive)
          if (local === req.path) return entries
          // report share paths, so the query (and the next file request) stays machine-independent
          const from = local.replace(/\/+$/, '')
          const to = shareUrlOf(req.path)
          return entries.map((e) => (e.path.startsWith(from) ? { ...e, path: to + e.path.slice(from.length) } : e))
        } catch (e) {
          throw fileError(req.path, e)
        }
      }
      case 'db':
      case 'db-items':
      case 'db-databases':
      case 'firestore-collections':
      case 'firestore-query':
      case 's3-list':
      case 's3-object': {
        if (!host.connectors.request) throw new MError('DataSource.Error', 'This connector needs the Lumen desktop app (no connector host is available).')
        try {
          return await host.connectors.request(req)
        } catch (e) {
          throw connectorError(req, e)
        }
      }
      case 'sql-items':
        try {
          return await host.connectors.sqlListItems({ server: req.server, database: req.database, auth: await authFor(req.server, req.database), cancelId })
        } catch (e) {
          throw sqlError(req.server, req.database, e)
        }
      case 'sql-databases':
        try {
          const r = await host.connectors.sqlQuery({ server: req.server, database: 'master', query: 'SELECT name FROM sys.databases ORDER BY name', auth: await authFor(req.server), cancelId })
          return r.rows.map((x) => String(x[0]))
        } catch (e) {
          throw sqlError(req.server, 'master', e)
        }
      case 'sql': {
        const query = sqlTextOf(req)
        if (!query) throw new MError('Expression.Error', 'Sql.Database: nothing to read (no item and no query).')
        try {
          const r = await host.connectors.sqlQuery({ server: req.server, database: req.database, query, auth: await authFor(req.server, req.database), maxRows, cancelId })
          return { columns: r.columns.map((c) => ({ name: c.name, type: c.type })), rows: r.rows } satisfies HostTable
        } catch (e) {
          throw sqlError(req.server, req.database, e)
        }
      }
      case 'http': {
        try {
          return await host.connectors.http({ url: req.url, method: req.method, headers: req.headers, body: req.body, cancelId })
        } catch (e) {
          throw new MError('DataSource.Error', `Web.Contents failed to get contents from '${req.url}': ${e instanceof Error ? e.message : String(e)}`, req.url)
        }
      }
      case 'decode': {
        if (req.format === 'xlsx') {
          const { decodeXlsx } = await import('./xlsx')
          return decodeXlsx(req.bytes)
        }
        const { decodeParquet } = await import('./parquet')
        return decodeParquet(req.bytes)
      }
      case 'lakehouse-contents':
        throw new MError(
          'DataSource.Error',
          'Lakehouse.Contents needs the Fabric workspace API, which Lumen does not call. Connect to the lakehouse\'s SQL analytics endpoint instead: Sql.Database("<endpoint>.datawarehouse.fabric.microsoft.com", "<lakehouse>") and navigate with Source{[Schema="dbo",Item="<table>"]}[Data].'
        )
      case 'sharepoint-files':
        throw new MError(
          'DataSource.Error',
          `SharePoint.Files isn't supported in Lumen (it needs SharePoint sign-in). Sync the library with OneDrive or download the files, then use Folder.Files("<local folder>") — the result has the same columns (Content, Name, Extension, Folder Path, …).`,
          req.url
        )
    }
  }
}
