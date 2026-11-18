/**
 * The connector service of the main process: answers the M engine's connector requests (PostgreSQL,
 * MySQL, SQLite, Firestore, S3), performs Web.Contents requests with the stored web credentials, manages
 * the credential store (incl. OAuth sign-in and connection tests) and network shares.
 *
 * It has no Electron dependency (the IPC wiring is in ../connectors.ts), so integration tests drive it
 * directly against real servers.
 */
import { GoogleAuth } from 'google-auth-library'
import { credentialKeysOf, dataSourceLabel, type DataSourceRef } from '../../../core/data/queries'
import type { CredentialAuth, CredentialInfo, CredentialInput, ConnectorRequest, HttpRequest, HttpResponse, MountRequest, ShareInfo } from '../../../shared/host'
import { ConnectorError, credentialsRequired } from './common'
import type { CredentialEntry, CredentialStore } from './credstore'
import { firestoreCollections, firestoreQuery, type Authorize, type FirestoreTarget } from './firestore'
import { closeMysqlPools, mysqlDatabases, mysqlItems, mysqlQuery } from './mysql'
import { authorizationCodeFlow, clientCredentials, refreshAccessToken, type OAuthConfig } from './oauth'
import { closePgPools, pgDatabases, pgItems, pgQuery } from './pg'
import { resetS3Clients, s3Get, s3List, type S3Target } from './s3'
import { listShares, mountShare, resolveSharePath, type ShareEnv } from './shares'
import { closeSqliteFiles, sqliteItems, sqliteQuery } from './sqlite'
import { closeDuckDbSources, duckdbItems, duckdbQuery } from './duckdb'

export interface ConnectorServiceOptions {
  store: CredentialStore
  /** opens the system browser (OAuth sign-in) */
  openExternal(url: string): Promise<void> | void
  maxRows?: number
  /** share discovery environment (tests) */
  shareEnv?: ShareEnv
}

const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore'
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

export type TestRequest = ConnectorRequest | { kind: 'http'; url: string }

/** The data source a connector request reads (credentials, privacy levels, labels). */
export function sourceOfRequest(req: ConnectorRequest): DataSourceRef {
  switch (req.kind) {
    case 'db':
    case 'db-items':
      return req.driver === 'sqlite' || req.driver === 'duckdb' ? { kind: req.driver, path: req.server } : { kind: req.driver, server: req.server, database: req.database || undefined }
    case 'db-databases':
      return req.driver === 'sqlite' || req.driver === 'duckdb' ? { kind: req.driver, path: req.server } : { kind: req.driver, server: req.server }
    case 'firestore-collections':
    case 'firestore-query':
      return { kind: 'firestore', project: req.project }
    case 's3-list':
    case 's3-object':
      return { kind: 's3', bucket: req.bucket, endpoint: req.endpoint }
  }
}

const LABELS: Record<string, string> = { postgresql: 'PostgreSQL', mysql: 'MySQL', firestore: 'Firestore', s3: 'Amazon S3' }

export function createConnectorService(opts: ConnectorServiceOptions) {
  const { store } = opts
  const googleClients = new Map<string, GoogleAuth>()

  function credentialFor(source: DataSourceRef): CredentialEntry | undefined {
    return store.find(credentialKeysOf(source))
  }

  /** A stored credential or "Credentials are required…" (PBI asks before the first connection). */
  function required(source: DataSourceRef): CredentialEntry {
    const e = credentialFor(source)
    if (!e) throw credentialsRequired(LABELS[source.kind] ?? source.kind, dataSourceLabel(source))
    return e
  }

  function oauthConfig(a: CredentialAuth, google = false): OAuthConfig {
    const tokenUrl = a.tokenUrl || (google ? GOOGLE_TOKEN_URL : '')
    if (!tokenUrl || !a.clientId) throw new ConnectorError('The OAuth credential needs a token URL and a client ID (Data source settings ▸ Edit Permissions).', 'credentials')
    return { authUrl: a.authUrl || (google ? GOOGLE_AUTH_URL : undefined), tokenUrl, clientId: a.clientId, clientSecret: a.clientSecret, scope: a.scope || (google ? FIRESTORE_SCOPE : undefined) }
  }

  /** A valid OAuth access token for a stored credential (refreshing / re-requesting it when expired). */
  async function oauthToken(e: CredentialEntry, google = false): Promise<string> {
    const a = e.auth
    if (a.accessToken && (!a.expiresAt || a.expiresAt > Date.now() + 60_000)) return a.accessToken
    const cfg = oauthConfig(a, google)
    let t
    if (a.grant === 'client-credentials') t = await clientCredentials(cfg)
    else if (a.refreshToken) t = await refreshAccessToken(cfg, a.refreshToken)
    else throw new ConnectorError('The OAuth sign-in has expired. Sign in again (Data source settings ▸ Edit Permissions ▸ Sign in).', 'credentials')
    store.update(e.key, { accessToken: t.accessToken, refreshToken: t.refreshToken ?? a.refreshToken, expiresAt: t.expiresAt })
    return t.accessToken
  }

  function firestoreAuthorize(req: { project: string; emulator?: string }): Authorize {
    return async (): Promise<{ headers: Record<string, string>; query?: Record<string, string> }> => {
      // the emulator accepts the "owner" token, which bypasses security rules
      if (req.emulator) return { headers: { authorization: 'Bearer owner' } }
      const e = required({ kind: 'firestore', project: req.project })
      const a = e.auth
      switch (a.kind) {
        case 'google-service-account':
        case 'google-adc': {
          let g = googleClients.get(e.key)
          if (!g) {
            let credentials: Record<string, unknown> | undefined
            if (a.kind === 'google-service-account') {
              try {
                credentials = JSON.parse(a.serviceAccountJson ?? '') as Record<string, unknown>
              } catch {
                throw new ConnectorError('The service account key isn\'t valid JSON (paste the whole key file downloaded from the Google Cloud console).', 'credentials')
              }
            }
            g = new GoogleAuth({ credentials, scopes: [FIRESTORE_SCOPE] })
            googleClients.set(e.key, g)
          }
          try {
            const token = await g.getAccessToken()
            if (!token) throw new Error('no token')
            return { headers: { authorization: `Bearer ${token}` } }
          } catch (err) {
            googleClients.delete(e.key)
            throw new ConnectorError(`Google sign-in failed (${(err as Error).message}).${a.kind === 'google-adc' ? ' Run `gcloud auth application-default login` first.' : ''}`, 'credentials')
          }
        }
        case 'oauth2':
          return { headers: { authorization: `Bearer ${await oauthToken(e, true)}` } }
        case 'google-api-key':
          return { headers: {}, query: { key: a.apiKey ?? '' } }
        case 'bearer':
          return { headers: { authorization: `Bearer ${a.token ?? ''}` } }
        case 'anonymous':
          return { headers: {} }
        default:
          throw new ConnectorError(`The credential type '${a.kind}' can't be used with Firestore.`, 'credentials')
      }
    }
  }

  function dbAuth(source: DataSourceRef): CredentialAuth {
    const a = required(source).auth
    if (a.kind !== 'basic' && a.kind !== 'sql' && a.kind !== 'anonymous') throw new ConnectorError(`The credential type '${a.kind}' can't be used with this database (use a user name and password).`, 'credentials')
    return a
  }

  function s3Target(req: { bucket: string; endpoint?: string; region?: string; forcePathStyle?: boolean }): S3Target {
    const source: DataSourceRef = { kind: 's3', bucket: req.bucket, endpoint: req.endpoint }
    const e = credentialFor(source)
    // S3-compatible endpoints need keys; AWS itself can use the SDK's default chain (env, ~/.aws, SSO, roles)
    if (!e && req.endpoint) throw credentialsRequired('Amazon S3', dataSourceLabel(source))
    return { bucket: req.bucket, endpoint: req.endpoint, region: req.region, forcePathStyle: req.forcePathStyle, auth: e?.auth ?? { kind: 'aws-default' } }
  }

  async function request(req: ConnectorRequest): Promise<unknown> {
    const run = { maxRows: opts.maxRows }
    switch (req.kind) {
      case 'db':
        if (req.driver === 'sqlite') return sqliteQuery(req.server, req.query, req.table, run)
        if (req.driver === 'duckdb') return duckdbQuery(req.server, req.query, req.table, run)
        if (req.driver === 'postgresql') return pgQuery({ server: req.server, database: req.database, auth: dbAuth(sourceOfRequest(req)) }, req.query, run)
        return mysqlQuery({ server: req.server, database: req.database, auth: dbAuth(sourceOfRequest(req)) }, req.query, run)
      case 'db-items':
        if (req.driver === 'sqlite') return sqliteItems(req.server)
        if (req.driver === 'duckdb') return duckdbItems(req.server)
        if (req.driver === 'postgresql') return pgItems({ server: req.server, database: req.database, auth: dbAuth(sourceOfRequest(req)) })
        return mysqlItems({ server: req.server, database: req.database, auth: dbAuth(sourceOfRequest(req)) })
      case 'db-databases':
        if (req.driver === 'sqlite' || req.driver === 'duckdb') return ['main']
        if (req.driver === 'postgresql') return pgDatabases({ server: req.server, database: '', auth: dbAuth(sourceOfRequest(req)) })
        return mysqlDatabases({ server: req.server, database: '', auth: dbAuth(sourceOfRequest(req)) })
      case 'firestore-collections': {
        const t: FirestoreTarget = { project: req.project, database: req.database, parent: req.parent, emulator: req.emulator }
        return firestoreCollections(t, firestoreAuthorize(req))
      }
      case 'firestore-query': {
        const t: FirestoreTarget = { project: req.project, database: req.database, parent: req.parent, emulator: req.emulator }
        return firestoreQuery(t, firestoreAuthorize(req), req, opts.maxRows)
      }
      case 's3-list':
        return s3List(s3Target(req), req.prefix, req.recursive)
      case 's3-object':
        return s3Get(s3Target(req), req.key)
    }
  }

  /** Web.Contents with the stored credential of the longest matching URL prefix. */
  async function http(req: HttpRequest, retried = false): Promise<HttpResponse> {
    const headers: Record<string, string> = { ...(req.headers ?? {}) }
    const has = (h: string) => Object.keys(headers).some((k) => k.toLowerCase() === h)
    let url = req.url
    const e = store.findWeb(req.url)
    const a = e?.auth
    if (e && a && !has('authorization')) {
      switch (a.kind) {
        case 'basic':
          headers['Authorization'] = `Basic ${Buffer.from(`${a.user ?? ''}:${a.password ?? ''}`).toString('base64')}`
          break
        case 'bearer':
          headers['Authorization'] = `Bearer ${a.token ?? ''}`
          break
        case 'oauth2':
          headers['Authorization'] = `Bearer ${await oauthToken(e)}`
          break
        case 'key':
          if (a.keyName && a.keyValue !== undefined) {
            if (a.keyIn === 'query') {
              const u = new URL(url)
              u.searchParams.set(a.keyName, a.keyValue)
              url = u.toString()
            } else headers[a.keyName] = a.keyValue
          }
          break
      }
    }
    const res = await fetch(url, { method: req.method ?? 'GET', headers, body: req.body as BodyInit | undefined, signal: AbortSignal.timeout(req.timeoutMs ?? 120_000) })
    // an access token revoked early: refresh once
    if (res.status === 401 && e && a?.kind === 'oauth2' && !retried && (a.refreshToken || a.grant === 'client-credentials')) {
      store.update(e.key, { accessToken: undefined, expiresAt: 0 })
      return http(req, true)
    }
    const out: Record<string, string> = {}
    res.headers.forEach((v, k) => (out[k] = v))
    return { status: res.status, headers: out, body: new Uint8Array(await res.arrayBuffer()) }
  }

  async function test(req: TestRequest): Promise<{ ok: boolean; message: string }> {
    try {
      if (req.kind === 'http') {
        const r = await http({ url: req.url, method: 'GET', timeoutMs: 30_000 })
        return r.status < 400 ? { ok: true, message: `Connected (HTTP ${r.status}).` } : { ok: false, message: `The server answered HTTP ${r.status}.` }
      }
      if (req.kind === 'db' || req.kind === 'db-items' || req.kind === 'db-databases') {
        const items = (await request({ kind: 'db-items', driver: req.driver, server: req.server, database: 'database' in req ? req.database : '' })) as unknown[]
        return { ok: true, message: `Connected: ${items.length} table${items.length === 1 ? '' : 's'} and view${items.length === 1 ? '' : 's'} visible.` }
      }
      if (req.kind === 'firestore-collections' || req.kind === 'firestore-query') {
        const ids = (await request({ kind: 'firestore-collections', project: req.project, database: req.database, emulator: req.emulator })) as string[]
        return { ok: true, message: `Connected: ${ids.length} collection${ids.length === 1 ? '' : 's'}.` }
      }
      const list = await s3List(s3Target(req), req.kind === 's3-list' ? req.prefix : '', false)
      return { ok: true, message: `Connected: ${list.length} item${list.length === 1 ? '' : 's'} at the top level of '${req.bucket}'.` }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }

  return {
    request,
    http,
    test,
    credentials: {
      status: () => store.status(),
      list: (): CredentialInfo[] => store.list(),
      set: (input: CredentialInput): CredentialInfo => {
        googleClients.delete(input.key)
        return store.set(input)
      },
      clear: (key?: string): void => {
        if (key) googleClients.delete(key)
        else googleClients.clear()
        store.clear(key)
      },
      async signIn(key: string): Promise<CredentialInfo> {
        const e = store.get(key)
        if (!e || e.auth.kind !== 'oauth2') throw new ConnectorError('Save an OAuth 2.0 credential for this source first.', 'credentials')
        const google = key.startsWith('firestore:')
        const cfg = oauthConfig(e.auth, google)
        const t = e.auth.grant === 'client-credentials' ? await clientCredentials(cfg) : await authorizationCodeFlow(cfg, opts.openExternal)
        store.update(key, { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt })
        return store.info(store.get(key)!)
      }
    },
    shares: {
      list: (): Promise<ShareInfo[]> => listShares(opts.shareEnv),
      mount: (req: MountRequest): Promise<string> => mountShare(req, opts.shareEnv),
      resolve: (path: string): Promise<string | null> => resolveSharePath(path, opts.shareEnv)
    },
    /** Fills the password / token of a SQL Server auth from the store when the renderer didn't send it. */
    sqlServerSecrets<A extends { kind: string; password?: string; token?: string }>(server: string, database: string, auth: A): A {
      if ((auth.kind === 'sql' && !auth.password) || (auth.kind === 'token' && !auth.token)) {
        const e = credentialFor({ kind: 'sql', server, database: database || undefined })
        if (e) return { ...auth, password: auth.password ?? e.auth.password, token: auth.token ?? e.auth.token }
      }
      return auth
    },
    async close(): Promise<void> {
      await Promise.all([closePgPools(), closeMysqlPools()])
      closeSqliteFiles()
      closeDuckDbSources()
      resetS3Clients()
    }
  }
}

export type ConnectorService = ReturnType<typeof createConnectorService>
