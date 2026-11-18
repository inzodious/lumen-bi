/**
 * Data source credentials and privacy levels (Data source settings ▸ Edit Permissions), shared by Get
 * data, the Power Query Editor and refresh.
 *
 * The store lives in the main process (src/main/ipc/connectors/credstore.ts): secrets are encrypted at
 * rest with the OS keyring and never come back to the renderer — this module keeps a cache of the
 * non-secret parts (auth kind, user, SSL mode, privacy level, which secrets are set) for synchronous
 * lookups, and connectors fill in the secrets in the main process.
 *
 * `refreshHost()` builds the `RefreshHost` every view should use for previews and refresh, so the
 * credentials and privacy levels chosen here apply everywhere.
 */
import type { CredentialAuth, CredentialInfo, CredentialInput, CredentialKind, PrivacyLevel, SqlAuth } from '@shared/host'
import type { RefreshHost } from '@core/data/fetcher'
import { credentialKeysOf, dataSourceKey, dataSourceLabel, type DataSourceRef } from '@core/data/queries'
import { useShell } from '../../app/shellState'

/** Credentials stored by older builds (auth kind / user per SQL source, secrets in memory only). */
const LEGACY_KEY = 'lumen.pq.credentials'

const infos = new Map<string, CredentialInfo>()
const listeners = new Set<() => void>()
let loading: Promise<void> | null = null

function api() {
  return typeof window !== 'undefined' ? window.wbi?.connectors?.credentials : undefined
}

function emit(): void {
  for (const l of listeners) l()
}

function replaceAll(list: CredentialInfo[]): void {
  infos.clear()
  for (const i of list) infos.set(i.key, i)
  emit()
}

async function migrateLegacy(): Promise<void> {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(LEGACY_KEY)
  } catch {
    return
  }
  if (!raw) return
  try {
    const legacy = JSON.parse(raw) as Record<string, Omit<SqlAuth, 'password' | 'token'>>
    for (const [key, auth] of Object.entries(legacy)) {
      if (infos.has(key) || !auth?.kind) continue
      const info = await api()!.set({ key, label: key.replace(/^sql:/, ''), auth: auth as CredentialAuth })
      infos.set(key, info)
    }
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    /* unreadable legacy entry: ignore */
  }
}

/** Loads the stored credentials (once; call again with `force` after another window changed them). */
export function loadCredentials(force = false): Promise<void> {
  const a = api()
  if (!a) return Promise.resolve()
  if (!loading || force) {
    loading = a
      .list()
      .then(async (list) => {
        replaceAll(list)
        await migrateLegacy()
        emit()
      })
      .catch(() => undefined)
  }
  return loading
}

void loadCredentials()

/** The stored credential of a data source key (no secrets). */
export function getCredential(key: string): CredentialInfo | undefined {
  return infos.get(key)
}

/** Most specific stored credential for a source (exact key, then server / endpoint level). */
export function credentialOf(source: DataSourceRef): CredentialInfo | undefined {
  for (const k of credentialKeysOf(source)) {
    const i = infos.get(k)
    if (i) return i
  }
  if (source.kind === 'web' || source.kind === 'odata') {
    let best: CredentialInfo | undefined
    for (const i of infos.values()) {
      if (!i.key.startsWith('web:')) continue
      const prefix = i.key.slice(4).replace(/\/+$/, '').toLowerCase()
      const url = source.url.toLowerCase()
      if ((url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`)) && (!best || i.key.length > best.key.length)) best = i
    }
    return best
  }
  return undefined
}

export async function saveCredential(input: CredentialInput): Promise<CredentialInfo> {
  const a = api()
  if (!a) throw new Error('Credentials can only be stored in the Lumen desktop app.')
  const info = await a.set(input)
  infos.set(info.key, info)
  emit()
  return info
}

export async function clearCredential(key: string): Promise<void> {
  await api()?.clear(key)
  infos.delete(key)
  emit()
}

export async function clearAllCredentials(): Promise<void> {
  await api()?.clear()
  infos.clear()
  emit()
}

export async function signInCredential(key: string): Promise<CredentialInfo> {
  const a = api()
  if (!a) throw new Error('Sign-in needs the Lumen desktop app.')
  const info = await a.signIn(key)
  infos.set(info.key, info)
  emit()
  return info
}

export function credentialList(): CredentialInfo[] {
  return [...infos.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/** Subscribe to credential changes (returns the unsubscribe function). */
export function onCredentialsChanged(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function privacyOf(source: DataSourceRef): PrivacyLevel | undefined {
  const p = credentialOf(source)?.privacy
  return p && p !== 'None' ? p : undefined
}

/** The user's default (Options ▸ Data source settings) when a SQL Server source has no stored credentials. */
function defaultAuth(): SqlAuth | undefined {
  try {
    const o = useShell.getState().options
    if (!o.sqlAuth || o.sqlAuth === 'azure-default') return o.sqlTenantId ? { kind: 'azure-default', tenantId: o.sqlTenantId } : undefined
    return { kind: o.sqlAuth, ...(o.sqlTenantId ? { tenantId: o.sqlTenantId } : {}) }
  } catch {
    return undefined
  }
}

const SQL_KINDS = new Set<CredentialKind>(['azure-default', 'azure-cli', 'device-code', 'interactive', 'sql', 'token', 'windows-unsupported'])

/**
 * SQL Server credentials for a source (the main process adds the stored password / token): exact key
 * first (server + database), then the server-level key, then the user default.
 */
export function credentialsFor(source: DataSourceRef): SqlAuth | undefined {
  if (source.kind !== 'sql') return undefined
  const c = credentialOf(source)
  if (c && SQL_KINDS.has(c.auth.kind)) return { kind: c.auth.kind as SqlAuth['kind'], user: c.auth.user, tenantId: c.auth.tenantId }
  return defaultAuth()
}

/** The host used by previews and refresh (filesystem + connectors over IPC, credentials from here). */
export function refreshHost(): RefreshHost {
  return {
    fs: window.wbi.fs,
    connectors: window.wbi.connectors,
    now: () => new Date(),
    credentials: async (s) => {
      await loadCredentials()
      return credentialsFor(s)
    },
    privacy: privacyOf
  }
}

/** Inverse of `dataSourceKey` (Global permissions lists stored keys). */
export function sourceFromKey(key: string): DataSourceRef {
  const i = key.indexOf(':')
  const kind = key.slice(0, i)
  const rest = key.slice(i + 1)
  const [a, b] = rest.split(';') as [string, string | undefined]
  switch (kind) {
    case 'sql':
    case 'postgresql':
    case 'mysql':
      return { kind, server: a, ...(b ? { database: b } : {}) } as DataSourceRef
    case 'file':
    case 'folder':
    case 'sqlite':
    case 'duckdb':
    case 'lakehouse':
      return { kind, path: rest } as DataSourceRef
    case 'web':
    case 'odata':
      return { kind, url: rest }
    case 'firestore':
      return { kind: 'firestore', project: rest }
    case 's3':
      return { kind: 's3', ...(a && a !== 'aws' ? { endpoint: a } : {}), ...(b ? { bucket: b } : {}) }
    default:
      return { kind: 'other', func: kind, detail: rest }
  }
}

export { dataSourceKey, dataSourceLabel }

export const AUTH_KINDS: Array<{ id: SqlAuth['kind']; label: string; description: string }> = [
  { id: 'azure-default', label: 'Microsoft account (default)', description: 'Uses your Azure CLI sign-in when available, otherwise asks you to sign in with a device code.' },
  { id: 'azure-cli', label: 'Microsoft account (Azure CLI)', description: 'Uses the account you are signed in with in the Azure CLI (az login).' },
  { id: 'device-code', label: 'Microsoft account (device code)', description: 'Sign in in your browser with a one-time code.' },
  { id: 'interactive', label: 'Microsoft account (browser)', description: 'Opens your browser to sign in.' },
  { id: 'sql', label: 'Database', description: 'SQL Server user name and password.' },
  { id: 'token', label: 'Access token', description: 'A raw Microsoft Entra ID access token for the database resource.' }
]

/** Authentication methods offered per source kind (PBI's credential dialog tabs). */
export function authKindsFor(source: DataSourceRef): Array<{ id: CredentialKind; label: string; description: string }> {
  switch (source.kind) {
    case 'sql':
      return AUTH_KINDS
    case 'postgresql':
    case 'mysql':
      return [{ id: 'basic', label: 'Database', description: 'User name and password of the database server. TLS is used when the server offers it (SSL mode).' }]
    case 'web':
    case 'odata':
      return [
        { id: 'anonymous', label: 'Anonymous', description: 'No credentials.' },
        { id: 'basic', label: 'Basic', description: 'User name and password (HTTP Basic authentication).' },
        { id: 'key', label: 'API key', description: 'A key sent as a request header or query parameter.' },
        { id: 'bearer', label: 'Bearer token', description: 'A fixed access token sent as "Authorization: Bearer …".' },
        { id: 'oauth2', label: 'OAuth 2.0', description: 'Sign in through your browser (authorization code with PKCE), or the client credentials grant. Tokens are refreshed automatically.' }
      ]
    case 'firestore':
      return [
        { id: 'google-service-account', label: 'Service account key', description: 'A service account JSON key file from the Google Cloud console (IAM ▸ Service accounts ▸ Keys).' },
        { id: 'google-adc', label: 'Application default credentials', description: 'The account of `gcloud auth application-default login` on this machine.' },
        { id: 'oauth2', label: 'Google account (sign in)', description: 'Sign in through your browser with an OAuth client ID of type "Desktop app" from your Google Cloud project.' },
        { id: 'google-api-key', label: 'API key', description: 'A Firebase web API key (only reads what your security rules allow without sign-in).' }
      ]
    case 's3':
      return [
        { id: 'aws-keys', label: 'Access key', description: 'Access key ID and secret access key (MinIO, TrueNAS, R2, Backblaze, AWS IAM).' },
        { id: 'aws-profile', label: 'Profile', description: 'A named profile from ~/.aws/credentials or ~/.aws/config (SSO profiles included).' },
        { id: 'aws-default', label: 'Default credential chain', description: 'Environment variables, the default profile, SSO or an instance role (AWS only).' },
        { id: 'anonymous', label: 'Anonymous', description: 'Public buckets (unsigned requests).' }
      ]
    default:
      return [{ id: 'anonymous', label: 'Anonymous', description: 'Files are read directly with your system permissions.' }]
  }
}

export function authLabel(info: CredentialInfo | undefined, source: DataSourceRef): string {
  if (!info) return source.kind === 'sql' ? 'Default (Microsoft account)' : source.kind === 'file' || source.kind === 'folder' || source.kind === 'sqlite' || source.kind === 'duckdb' || source.kind === 'lakehouse' ? 'Anonymous' : 'Not set'
  const k = authKindsFor(source).find((x) => x.id === info.auth.kind)?.label ?? info.auth.kind
  return info.auth.user ? `${k} — ${info.auth.user}` : k
}
