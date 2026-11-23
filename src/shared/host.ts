/**
 * The host bridge exposed by the preload script as `window.wbi`. Everything the renderer needs
 * from the OS / network goes through here. Main-process implementations live in src/main/ipc/*.
 * All methods are async (IPC). Binary payloads are Uint8Array.
 */
import type { FileSystem } from '../core/io/fs'
import type { DataRequest } from '../core/m/host'

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface DialogOptions {
  title?: string
  defaultPath?: string
  filters?: FileFilter[]
  /** openFile only */
  multi?: boolean
}

export interface SqlAuth {
  /** 'azure-cli' | 'device-code' | 'interactive' use @azure/identity; 'sql' = user/password; 'token' = raw access token */
  kind: 'azure-default' | 'azure-cli' | 'device-code' | 'interactive' | 'sql' | 'token' | 'windows-unsupported'
  user?: string
  password?: string
  token?: string
  tenantId?: string
}

export interface SqlRequest {
  server: string
  database: string
  /** native query; or use schema+item for navigation */
  query?: string
  schema?: string
  item?: string
  auth: SqlAuth
  timeoutMs?: number
  maxRows?: number
  /** lets `connectors.cancel(cancelId)` stop this request (refresh Cancel) */
  cancelId?: string
}

export interface SqlResult {
  columns: Array<{ name: string; type: string }>
  rows: unknown[][]
}

export interface AuthPrompt {
  kind: 'device-code' | 'browser' | 'info'
  /** the message to show the user verbatim */
  message: string
  userCode?: string
  verificationUri?: string
  /** ms since epoch when the code expires */
  expiresOn?: number
  /** 'done' / 'failed' close a previously shown prompt */
  state?: 'pending' | 'done' | 'failed'
}

// ---------------------------------------------------------------------------------------------
// Connectors (PostgreSQL, MySQL, SQLite, Firestore, S3, network shares) and the credential store

/** M engine data requests answered by the main-process connectors (see src/core/m/host.ts). */
export type ConnectorRequest = Extract<DataRequest, { kind: 'db' | 'db-items' | 'db-databases' | 'firestore-collections' | 'firestore-query' | 's3-list' | 's3-object' }>

export type PrivacyLevel = 'None' | 'Public' | 'Organizational' | 'Private'

/** How a data source is accessed (Data source settings ▸ Edit Permissions). */
export type CredentialKind =
  | SqlAuth['kind']
  | 'anonymous'
  /** user name + password: databases (PostgreSQL, MySQL), HTTP Basic */
  | 'basic'
  /** an API key sent as a header or query parameter */
  | 'key'
  /** a fixed bearer token */
  | 'bearer'
  /** OAuth 2.0 (authorization code + PKCE through the system browser, or client credentials) */
  | 'oauth2'
  /** Google: service-account JSON key / application default credentials (gcloud) / emulator */
  | 'google-service-account'
  | 'google-adc'
  | 'google-api-key'
  /** AWS / S3-compatible: access key + secret, a named profile (~/.aws), or the default chain */
  | 'aws-keys'
  | 'aws-profile'
  | 'aws-default'

export interface CredentialAuth {
  kind: CredentialKind
  user?: string
  password?: string
  token?: string
  tenantId?: string
  /** databases: TLS mode (default 'prefer': TLS when the server offers it) */
  sslMode?: 'disable' | 'prefer' | 'require' | 'verify-full'
  /** 'key': name of the header / query parameter and where it goes */
  keyName?: string
  keyIn?: 'header' | 'query'
  keyValue?: string
  /** 'oauth2' */
  grant?: 'authorization-code' | 'client-credentials'
  authUrl?: string
  tokenUrl?: string
  clientId?: string
  clientSecret?: string
  scope?: string
  accessToken?: string
  refreshToken?: string
  /** ms since epoch */
  expiresAt?: number
  /** Google */
  serviceAccountJson?: string
  apiKey?: string
  /** AWS */
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  profile?: string
}

/** Fields of CredentialAuth that are secrets (encrypted at rest, never sent back to the renderer). */
export const SECRET_FIELDS = ['password', 'token', 'keyValue', 'clientSecret', 'accessToken', 'refreshToken', 'serviceAccountJson', 'apiKey', 'secretAccessKey', 'sessionToken'] as const

/** A stored credential as the renderer sees it: secrets removed, `secrets` lists the ones that are set. */
export interface CredentialInfo {
  /** data source key (src/core/data/queries.ts dataSourceKey) */
  key: string
  /** human label (server;database, URL, bucket…) */
  label: string
  auth: Omit<CredentialAuth, (typeof SECRET_FIELDS)[number]>
  secrets: string[]
  privacy: PrivacyLevel
  updatedAt: number
}

export interface CredentialInput {
  key: string
  label: string
  /** secrets left undefined keep their stored value; '' clears them */
  auth?: CredentialAuth
  privacy?: PrivacyLevel
}

export interface CredentialStoreStatus {
  /** secrets are encrypted at rest with the OS keyring (Electron safeStorage) */
  encrypted: boolean
  /** the keyring backend in use (e.g. 'gnome_libsecret', 'kwallet5', 'basic_text') */
  backend?: string
}

/** A mounted (or mountable) network location for Get data ▸ Network share. */
export interface ShareInfo {
  /** local path to read with Folder.Files / File.Contents */
  path: string
  /** smb://host/share, nfs://host/export, sftp://user@host/… (when known) */
  url?: string
  kind: 'smb' | 'nfs' | 'sftp' | 'webdav' | 'local' | 'other'
  host?: string
  share?: string
  /** where it was found */
  via: 'gvfs' | 'mount' | 'media'
  label: string
  /** false for fstab entries that aren't mounted */
  mounted?: boolean
}

export interface MountRequest {
  /** smb://host/share (also accepts \\host\share) */
  url: string
  user?: string
  domain?: string
  password?: string
  anonymous?: boolean
}

export interface HttpRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: Uint8Array | string
  timeoutMs?: number
  /** lets `connectors.cancel(cancelId)` stop this request (refresh Cancel) */
  cancelId?: string
}

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  body: Uint8Array
}

export interface PdfOptions {
  /** page size in inches */
  width: number
  height: number
  landscape?: boolean
  printBackground?: boolean
  /** use CSS @page size (recommended: renderer lays out each report page as one CSS page) */
  preferCSSPageSize?: boolean
}

export type MenuCommand =
  | 'file.new'
  | 'file.open'
  | 'file.openFolder'
  | 'file.save'
  | 'file.saveAs'
  | 'file.export.pdf'
  | 'file.export.pptx'
  | 'file.export.png'
  | 'file.export.html'
  | 'file.export.pbip'
  | 'file.close'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.copy'
  | 'edit.paste'
  | 'edit.delete'
  | 'edit.selectAll'
  | 'view.report'
  | 'view.data'
  | 'view.model'
  | 'view.dax'
  | 'view.powerquery'
  | 'view.toggleTheme'
  | 'help.about'
  | string

// ---------------------------------------------------------------------------------------------
// Publishing dashboards (src/main/ipc/publish, src/renderer/src/publish)

/** The publish files (lumen-publish.json, report.wbi; src/core/publish) and where they go; the viewer is added by main. */
export interface PublishFilesRequest {
  /** target folder (folder) or file (zip) */
  path: string
  files: Record<string, Uint8Array | string>
}

export type PublishResult =
  | { ok: true; location: string; files: number; bytes: number; url?: string }
  | { ok: false; reason: 'not-empty' | 'no-viewer' | 'failed'; message: string }

export type PublishDestinationKind = 'github-pages' | 'netlify' | 'cloudflare-pages' | 's3' | 'lumen-server'

/** A saved place to publish to (Publish dialog ▸ Add destination); secrets stay in the main process. */
export interface PublishDestination {
  id: string
  kind: PublishDestinationKind
  name: string
  /** non-secret settings of the kind (owner, repo, account id, bucket, server URL…) */
  settings: Record<string, string>
  /** names of the secrets that are set (token, secretAccessKey…) */
  secrets: string[]
  updatedAt: number
}

export interface PublishDestinationInput {
  /** absent: a new destination */
  id?: string
  kind: PublishDestinationKind
  name: string
  settings: Record<string, string>
  /** secrets left undefined keep their stored value; '' clears them */
  secrets?: Record<string, string | undefined>
}

export interface PublishDeployRequest {
  destinationId: string
  /** where the dashboard goes inside the destination: a folder (GitHub Pages, S3), a site or project name (Netlify,
   *  Cloudflare Pages) or a slug (Lumen Server) */
  site: string
  title: string
  files: Record<string, Uint8Array | string>
  /** Lumen Server only: who may open the dashboard (absent: keep what the server has, public for a new one) */
  access?: { mode: 'public' | 'password' | 'users'; password?: string }
}

export interface PublishProgress {
  message: string
  /** 0..1 when known */
  fraction?: number
}

export interface WbiHost {
  fs: FileSystem
  dialog: {
    openFile(opts?: DialogOptions): Promise<string[] | null>
    openDirectory(opts?: DialogOptions): Promise<string | null>
    saveFile(opts?: DialogOptions): Promise<string | null>
    message(opts: { type?: 'info' | 'warning' | 'error' | 'question'; title?: string; message: string; detail?: string; buttons?: string[] }): Promise<number>
  }
  app: {
    platform: string
    version: string
    getPath(name: 'home' | 'documents' | 'userData' | 'temp' | 'downloads' | 'desktop'): Promise<string>
    getRecent(): Promise<Array<{ path: string; name: string; openedAt: number }>>
    addRecent(path: string, name: string): Promise<void>
    openExternal(url: string): Promise<void>
    showItemInFolder(path: string): Promise<void>
    setTitle(title: string): Promise<void>
    /** paths passed on the command line (lumen file.pbix) */
    getLaunchFiles(): Promise<string[]>
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximizeChange(cb: (maximized: boolean) => void): () => void
    /** native menu → renderer commands */
    onMenuCommand(cb: (cmd: MenuCommand, arg?: unknown) => void): () => void
    /** ask before closing when dirty; renderer calls confirmClose(true) to allow */
    onCloseRequested(cb: () => void): () => void
    confirmClose(allow: boolean): Promise<void>
  }
  connectors: {
    sqlQuery(req: SqlRequest): Promise<SqlResult>
    sqlListItems(req: Omit<SqlRequest, 'query' | 'schema' | 'item'>): Promise<Array<{ schema: string; item: string; kind: 'Table' | 'View' }>>
    http(req: HttpRequest): Promise<HttpResponse>
    /**
     * Sign-in prompts raised while connecting (e.g. Microsoft Entra ID device code: "go to
     * https://microsoft.com/devicelogin and enter the code XXXX"). Additive — may be absent in old preloads.
     */
    onAuthPrompt?(cb: (prompt: AuthPrompt) => void): () => void
    /**
     * Stop an in-flight sqlQuery / sqlListItems / http request started with this `cancelId` (cancels the SQL
     * request or the pending Entra ID sign-in, aborts the HTTP fetch). Unknown ids are ignored. Additive.
     */
    cancel?(cancelId: string): Promise<void>
    /** Forget cached Entra ID credentials / tokens (all, or for one tenant). */
    clearCredentials?(tenantId?: string): Promise<void>
    /** PostgreSQL / MySQL / SQLite / Firestore / S3 requests of the M engine (credentials from the store). */
    request?(req: ConnectorRequest): Promise<unknown>
    /** Persistent credential store (encrypted with the OS keyring). */
    credentials?: {
      status(): Promise<CredentialStoreStatus>
      list(): Promise<CredentialInfo[]>
      set(input: CredentialInput): Promise<CredentialInfo>
      /** one key, or everything when omitted */
      clear(key?: string): Promise<void>
      /** OAuth 2.0 sign-in for a stored 'oauth2' credential (opens the system browser) */
      signIn(key: string): Promise<CredentialInfo>
      /** Connection test: performs a small request against the source with its stored credential. */
      test(req: ConnectorRequest | { kind: 'http'; url: string } | { kind: 'sql'; server: string; database: string; auth?: SqlAuth }): Promise<{ ok: boolean; message: string }>
    }
    /** Network shares (GVFS / NFS / CIFS mounts) */
    shares?: {
      list(): Promise<ShareInfo[]>
      /** `gio mount`; resolves to the mounted local path */
      mount(req: MountRequest): Promise<string>
      /** smb://host/share/x or \\host\share\x → local mounted path (null when not mounted) */
      resolve(path: string): Promise<string | null>
    }
  }
  /** Publish a dashboard (additive: absent in old preloads). */
  publish?: {
    status(): Promise<{ viewer: boolean }>
    /** write the site into a folder; a folder with other files is refused unless `replace` */
    toFolder(req: PublishFilesRequest & { replace?: boolean }): Promise<PublishResult>
    toZip(req: PublishFilesRequest): Promise<PublishResult>
    destinations: {
      list(): Promise<PublishDestination[]>
      set(input: PublishDestinationInput): Promise<PublishDestination>
      remove(id: string): Promise<void>
      /** sign-in / access check against the destination; `site` checks that one site too */
      test(id: string, site?: string): Promise<{ ok: boolean; message: string }>
    }
    /** Lumen Server "Sign in with Google": opens the browser and resolves with a publishing key for the destination */
    connectLumenServer?(url: string): Promise<{ ok: boolean; key?: string; email?: string; message?: string }>
    /** upload to a saved destination; `url` of the result is where the dashboard is live */
    deploy(req: PublishDeployRequest): Promise<PublishResult>
    onProgress(cb: (p: PublishProgress) => void): () => void
  }
  exporter: {
    /** print the current window contents to PDF bytes */
    printToPDF(opts: PdfOptions): Promise<Uint8Array>
    /** capture a region (CSS px of the window) as PNG bytes */
    capturePng(rect?: { x: number; y: number; width: number; height: number }): Promise<Uint8Array>
  }
}

declare global {
  interface Window {
    wbi: WbiHost
  }
}
