import { app, ipcMain, safeStorage, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import { Connection, Request, type ConnectionConfiguration } from 'tedious'
import { AzureCliCredential, ChainedTokenCredential, DeviceCodeCredential, InteractiveBrowserCredential, type TokenCredential } from '@azure/identity'
import type { AuthPrompt, ConnectorRequest, CredentialInput, HttpRequest, MountRequest, SqlAuth, SqlRequest, SqlResult } from '../../shared/host'
import { explainSqlError, hostTypeOf, isAzureHost, normalizeSqlValue, parseServer } from '../../core/data/sqlconn'
import { CredentialStore, type Cipher } from './connectors/credstore'
import { createConnectorService, type ConnectorService, type TestRequest } from './connectors/service'

/**
 * Data connectors in the main process (network, native drivers).
 *
 * SQL Server / Azure SQL / Fabric SQL analytics endpoints & warehouses through `tedious`, with
 * Microsoft Entra ID tokens from `@azure/identity` (Azure CLI login, device code — the code is sent to
 * the renderer as a `conn:authPrompt` event —, interactive browser, raw token) or SQL logins.
 * Credentials are cached per kind + tenant for the session; connections are pooled per
 * server/database/credential and closed when idle.
 *
 * PostgreSQL / MySQL / SQLite / Firestore / S3 / network shares and the persistent credential store
 * live in ./connectors/* (Electron-free, see service.ts); this file wires them to IPC. Secrets are
 * encrypted with Electron safeStorage (the OS keyring) in userData/credentials.json.
 */

let service: ConnectorService | null = null

/** Created on first use (safeStorage needs the app to be ready). */
function connectors(): ConnectorService {
  if (service) return service
  const cipher: Cipher = {
    available: () => {
      try {
        return safeStorage.isEncryptionAvailable()
      } catch {
        return false
      }
    },
    backend: () => {
      try {
        return process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined
      } catch {
        return undefined
      }
    },
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data)
  }
  const store = new CredentialStore(join(app.getPath('userData'), 'credentials.json'), cipher)
  service = createConnectorService({ store, openExternal: (url) => shell.openExternal(url) })
  app.on('will-quit', () => void service?.close())
  return service
}

const SQL_SCOPE = 'https://database.windows.net/.default'
const DEFAULT_MAX_ROWS = 5_000_000
const IDLE_CLOSE_MS = 120_000

// ---------------------------------------------------------------------------------------------
// Entra ID credentials

const credentials = new Map<string, TokenCredential>()
/** where device-code prompts go (the renderer that started the request) */
let promptTarget: WebContents | null = null

function sendPrompt(p: AuthPrompt): void {
  if (promptTarget && !promptTarget.isDestroyed()) promptTarget.send('conn:authPrompt', p)
}

function deviceCode(tenantId?: string): DeviceCodeCredential {
  return new DeviceCodeCredential({
    tenantId,
    userPromptCallback: (info) => {
      sendPrompt({ kind: 'device-code', message: info.message, userCode: info.userCode, verificationUri: info.verificationUri, expiresOn: Date.now() + 15 * 60_000, state: 'pending' })
    }
  })
}

function credentialFor(auth: SqlAuth): TokenCredential {
  const key = `${auth.kind}|${auth.tenantId ?? ''}`
  let c = credentials.get(key)
  if (c) return c
  switch (auth.kind) {
    case 'azure-cli':
      c = new AzureCliCredential({ tenantId: auth.tenantId })
      break
    case 'device-code':
      c = deviceCode(auth.tenantId)
      break
    case 'interactive':
      c = new InteractiveBrowserCredential({ tenantId: auth.tenantId, redirectUri: 'http://localhost' })
      break
    default:
      // 'azure-default': the Azure CLI login when there is one, otherwise a device-code sign-in
      c = new ChainedTokenCredential(new AzureCliCredential({ tenantId: auth.tenantId }), deviceCode(auth.tenantId))
  }
  credentials.set(key, c)
  return c
}

async function accessToken(auth: SqlAuth): Promise<string> {
  if (auth.kind === 'token') {
    if (!auth.token) throw new Error('No access token was provided.')
    return auth.token
  }
  const cred = credentialFor(auth)
  try {
    const t = await cred.getToken(SQL_SCOPE)
    if (!t) throw new Error('Microsoft Entra ID returned no token.')
    if (auth.kind === 'device-code' || auth.kind === 'azure-default' || auth.kind === 'interactive') sendPrompt({ kind: 'info', message: 'Signed in.', state: 'done' })
    return t.token
  } catch (e) {
    sendPrompt({ kind: 'info', message: e instanceof Error ? e.message : String(e), state: 'failed' })
    credentials.delete(`${auth.kind}|${auth.tenantId ?? ''}`)
    throw e
  }
}

// ---------------------------------------------------------------------------------------------
// Connections

interface Pooled {
  conn: Connection
  queue: Promise<unknown>
  timer?: ReturnType<typeof setTimeout>
  closed: boolean
}

const pool = new Map<string, Promise<Pooled>>()

async function connect(server: string, database: string, auth: SqlAuth, timeoutMs?: number): Promise<Connection> {
  const addr = parseServer(server)
  if (auth.kind === 'windows-unsupported') throw new Error('Windows (integrated) authentication is not available on Linux. Use a SQL login or Microsoft Entra ID.')
  const authentication: ConnectionConfiguration['authentication'] =
    auth.kind === 'sql'
      ? { type: 'default', options: { userName: auth.user ?? '', password: auth.password ?? '' } }
      : { type: 'azure-active-directory-access-token', options: { token: await accessToken(auth) } }
  const config: ConnectionConfiguration = {
    server: addr.host,
    authentication,
    options: {
      database,
      port: addr.instanceName ? undefined : addr.port,
      instanceName: addr.instanceName,
      encrypt: isAzureHost(addr.host) ? true : auth.kind === 'sql' ? false : true,
      trustServerCertificate: !isAzureHost(addr.host),
      connectTimeout: 30_000,
      requestTimeout: timeoutMs ?? 30 * 60_000,
      useUTC: true,
      rowCollectionOnRequestCompletion: false,
      appName: 'Lumen'
    }
  }
  return new Promise<Connection>((resolve, reject) => {
    const conn = new Connection(config)
    conn.on('error', () => undefined)
    conn.connect((err) => (err ? reject(new Error(explainSqlError(err.message, addr.host))) : resolve(conn)))
  })
}

function poolKey(req: { server: string; database: string; auth: SqlAuth }): string {
  return JSON.stringify([req.server.toLowerCase(), req.database.toLowerCase(), req.auth.kind, req.auth.tenantId ?? '', req.auth.user ?? '', req.auth.token ? 't' : ''])
}

async function withConnection<T>(req: { server: string; database: string; auth: SqlAuth; timeoutMs?: number }, f: (c: Connection) => Promise<T>): Promise<T> {
  const key = poolKey(req)
  let entry = pool.get(key)
  if (!entry) {
    entry = connect(req.server, req.database, req.auth, req.timeoutMs).then((conn) => {
      const p: Pooled = { conn, queue: Promise.resolve(), closed: false }
      conn.on('end', () => {
        p.closed = true
        pool.delete(key)
      })
      return p
    })
    pool.set(key, entry)
    entry.catch(() => pool.delete(key))
  }
  const p = await entry
  if (p.closed) {
    pool.delete(key)
    return withConnection(req, f)
  }
  if (p.timer) clearTimeout(p.timer)
  const run = p.queue.then(() => f(p.conn))
  p.queue = run.catch(() => undefined)
  try {
    return await run
  } finally {
    p.timer = setTimeout(() => {
      p.conn.close()
      pool.delete(key)
    }, IDLE_CLOSE_MS)
  }
}

function runQuery(conn: Connection, sql: string, maxRows: number): Promise<SqlResult> {
  return new Promise<SqlResult>((resolve, reject) => {
    const columns: SqlResult['columns'] = []
    const rows: unknown[][] = []
    let types: string[] = []
    let tooMany = false
    const request = new Request(sql, (err) => {
      if (tooMany) return reject(new Error(`The query returned more than ${maxRows.toLocaleString()} rows (the row limit). Filter the source or raise the limit.`))
      if (err) return reject(err)
      resolve({ columns, rows })
    })
    request.on('columnMetadata', (meta: unknown) => {
      const list = (Array.isArray(meta) ? meta : Object.values(meta as Record<string, unknown>)) as Array<{ colName: string; type: { name: string } }>
      if (columns.length) return
      for (const c of list) columns.push({ name: c.colName, type: hostTypeOf(c.type.name) })
      types = columns.map((c) => c.type)
    })
    request.on('row', (cols: Array<{ value: unknown }>) => {
      if (rows.length >= maxRows) {
        if (!tooMany) {
          tooMany = true
          conn.cancel()
        }
        return
      }
      const r = new Array(cols.length)
      for (let i = 0; i < cols.length; i++) r[i] = normalizeSqlValue(cols[i]!.value, types[i] ?? 'varchar')
      rows.push(r)
    })
    conn.execSql(request)
  })
}

function navigationSql(req: SqlRequest): string {
  if (req.query) return req.query
  if (!req.item) throw new Error('SQL request has neither a query nor an item.')
  const q = (s: string) => `[${s.replace(/]/g, ']]')}]`
  return `SELECT * FROM ${req.schema ? `${q(req.schema)}.` : ''}${q(req.item)}`
}

async function sqlQuery(sender: WebContents, req: SqlRequest): Promise<SqlResult> {
  promptTarget = sender
  // passwords / tokens are kept in the credential store, not in the renderer
  req = { ...req, auth: connectors().sqlServerSecrets(req.server, req.database, req.auth) }
  return withConnection(req, (conn) => runQuery(conn, navigationSql(req), req.maxRows ?? DEFAULT_MAX_ROWS)).catch((e) => {
    throw new Error(explainSqlError(e instanceof Error ? e.message : String(e), parseServer(req.server).host))
  })
}

// ---------------------------------------------------------------------------------------------

export function registerConnectorIpc(): void {
  ipcMain.handle('conn:sqlQuery', (e, req: SqlRequest) => sqlQuery(e.sender, req))
  ipcMain.handle('conn:sqlListItems', async (e, req: SqlRequest) => {
    const r = await sqlQuery(e.sender, {
      ...req,
      query:
        "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA', 'queryinsights') ORDER BY TABLE_SCHEMA, TABLE_NAME"
    })
    return r.rows.map((row) => ({ schema: String(row[0]), item: String(row[1]), kind: String(row[2]) === 'VIEW' ? 'View' : 'Table' }))
  })
  ipcMain.handle('conn:clearCredentials', async (_e, tenantId?: string) => {
    for (const k of [...credentials.keys()]) if (!tenantId || k.endsWith(`|${tenantId}`)) credentials.delete(k)
    for (const [k, p] of [...pool.entries()]) {
      pool.delete(k)
      p.then((x) => x.conn.close()).catch(() => undefined)
    }
  })
  // Web.Contents: stored web credentials (API key, basic, bearer, OAuth 2.0) are applied by URL prefix
  ipcMain.handle('conn:http', (_e, req: HttpRequest) => connectors().http(req))
  ipcMain.handle('conn:request', (e, req: ConnectorRequest) => {
    promptTarget = e.sender
    return connectors().request(req)
  })
  ipcMain.handle('cred:status', () => connectors().credentials.status())
  ipcMain.handle('cred:list', () => connectors().credentials.list())
  ipcMain.handle('cred:set', (_e, input: CredentialInput) => connectors().credentials.set(input))
  ipcMain.handle('cred:clear', async (_e, key?: string) => {
    connectors().credentials.clear(key)
    for (const [k, p] of [...pool.entries()]) {
      pool.delete(k)
      p.then((x) => x.conn.close()).catch(() => undefined)
    }
  })
  ipcMain.handle('cred:signIn', (_e, key: string) => connectors().credentials.signIn(key))
  ipcMain.handle('cred:test', async (e, req: TestRequest | { kind: 'sql'; server: string; database: string; auth?: SqlAuth }) => {
    if (req.kind !== 'sql') return connectors().test(req)
    try {
      await sqlQuery(e.sender, { server: req.server, database: req.database || 'master', query: 'SELECT 1', auth: req.auth ?? { kind: 'azure-default' }, maxRows: 1 })
      return { ok: true, message: 'Connected.' }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('shares:list', () => connectors().shares.list())
  ipcMain.handle('shares:mount', (_e, req: MountRequest) => connectors().shares.mount(req))
  ipcMain.handle('shares:resolve', (_e, path: string) => connectors().shares.resolve(path))
}
