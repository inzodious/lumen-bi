/**
 * Get data ▸ connection dialogs for the connectors that run in the M engine + main-process connectors:
 * PostgreSQL, MySQL / MariaDB, Google Firestore, Amazon S3 / S3-compatible storage, lakehouse folders
 * (Delta), network shares (SMB / NFS / GVFS), OData, and the GraphQL / REST API templates.
 *
 * Each dialog stores the credentials it is given in the encrypted credential store (same entries as
 * Data source settings) and hands Navigator items to the Get data dialog.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowClockwiseRegular, FolderRegular, ServerRegular } from '@fluentui/react-icons'
import type { CredentialAuth, ShareInfo } from '@shared/host'
import { dataSourceKey, type DataSourceRef } from '@core/data/queries'
import { Button, Checkbox, Dropdown, Modal, Radio, Spinner, TextField, cx } from '../../app/ui'
import { credentialOf, saveCredential, signInCredential } from '../../views/powerquery/credentials'
import { DataSourceSettings } from '../../views/powerquery/dialogs/SourceDialogs'
import { dbItems, firestoreItems, folderUrlItems, graphqlM, lakehouseItems, mItem, odataItems, restM, s3Items, type DbKind, type Paging } from './mnav'
import type { NavItem } from './readers'
import './getdata.css'

export type Connected = (title: string, items: NavItem[]) => void

function errText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}

function ConnectModal({
  title,
  busy,
  error,
  ok,
  onOk,
  onBack,
  onCancel,
  width = 560,
  children,
  left
}: {
  title: string
  busy: string | null
  error: string | null
  ok: boolean
  onOk(): void
  onBack(): void
  onCancel(): void
  width?: number
  children: ReactNode
  left?: ReactNode
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width={width}
      onSubmit={() => ok && !busy && onOk()}
      footerLeft={busy ? <Spinner label={busy} /> : left}
      footer={
        <>
          <Button variant="primary" disabled={!ok || !!busy} onClick={onOk}>
            OK
          </Button>
          <Button onClick={onBack}>Back</Button>
          <Button onClick={onCancel}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-col" style={{ gap: 14 }}>
        {children}
        {error && <div className="wbi-dlg-error wbi-selectable">{error}</div>}
      </div>
    </Modal>
  )
}

/** Runs an async connect step with busy / error state. */
function useRunner(): { busy: string | null; error: string | null; run(label: string, f: () => Promise<void>): Promise<void>; setError(e: string | null): void } {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  return {
    busy,
    error,
    setError,
    async run(label, f) {
      setBusy(label)
      setError(null)
      try {
        await f()
      } catch (e) {
        setError(errText(e))
      } finally {
        setBusy(null)
      }
    }
  }
}

/** Secret inputs left empty keep the stored value. */
const secret = (v: string) => (v ? v : undefined)

// ---------------------------------------------------------------------------------------------
// PostgreSQL / MySQL

const DB_TITLES: Record<'postgresql' | 'mysql', string> = { postgresql: 'PostgreSQL database', mysql: 'MySQL database' }

export function DbConnectDialog({ kind, onConnected, onBack, onCancel }: { kind: 'postgresql' | 'mysql'; onConnected: Connected; onBack(): void; onCancel(): void }) {
  const [server, setServer] = useState('')
  const [database, setDatabase] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [query, setQuery] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [ssl, setSsl] = useState<NonNullable<CredentialAuth['sslMode']>>('prefer')
  const r = useRunner()
  const source: DataSourceRef = { kind, server: server.trim(), database: database.trim() || undefined }
  const stored = server.trim() ? credentialOf(source) : undefined
  useEffect(() => {
    if (stored?.auth.user && !user) setUser(stored.auth.user)
    if (stored?.auth.sslMode) setSsl(stored.auth.sslMode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored?.key])
  const needsDb = kind === 'postgresql' || !!query.trim()
  const ok = !!server.trim() && (!needsDb || !!database.trim()) && (!!user.trim() || !!stored)
  const go = () =>
    r.run('Connecting…', async () => {
      if (user.trim() && (password || !stored || stored.auth.user !== user.trim() || stored.auth.sslMode !== ssl)) {
        await saveCredential({ key: stored?.key ?? dataSourceKey({ kind, server: server.trim() }), label: stored?.label ?? server.trim(), auth: { kind: 'basic', user: user.trim(), password: secret(password), sslMode: ssl } })
      }
      const items = await dbItems(kind, server.trim(), database.trim(), query.trim() || undefined)
      if (!items.length) throw new Error('The database contains no tables or views that you can access.')
      onConnected(database.trim() || server.trim(), items)
    })
  return (
    <ConnectModal title={DB_TITLES[kind]} busy={r.busy} error={r.error} ok={ok} onOk={() => void go()} onBack={onBack} onCancel={onCancel}>
      <TextField label="Server" value={server} onChange={setServer} autoFocus placeholder={kind === 'postgresql' ? 'db.example.com:5432 (Supabase, Neon, Timescale…)' : 'db.example.com:3306'} />
      <TextField label={kind === 'postgresql' ? 'Database' : 'Database (optional)'} value={database} onChange={setDatabase} />
      <div className="wbi-gd-section">Credentials</div>
      <div className="wbi-dlg-grid2">
        <TextField label="User name" value={user} onChange={setUser} />
        <TextField label="Password" type="password" value={password} onChange={setPassword} hint={stored?.secrets.includes('password') ? 'Saved — leave empty to keep it.' : undefined} />
      </div>
      <Dropdown
        label="Encryption (SSL mode)"
        value={ssl}
        onChange={(v) => setSsl(v as typeof ssl)}
        options={[
          { value: 'prefer', label: 'Prefer — encrypt when the server supports it' },
          { value: 'require', label: 'Require — always encrypt (certificate not verified)' },
          { value: 'verify-full', label: 'Verify — encrypt and verify the certificate' },
          { value: 'disable', label: 'Disable — never encrypt' }
        ]}
      />
      <button type="button" className="wbi-link" style={{ alignSelf: 'flex-start' }} onClick={() => setAdvanced((a) => !a)}>
        {advanced ? '▾' : '▸'} Advanced options
      </button>
      {advanced && <TextField label="SQL statement (optional, requires a database)" value={query} onChange={setQuery} multiline rows={5} />}
      <div className="wbi-dlg-help">Import mode. Filters, column choices, sorting and row limits applied in Power Query are folded into the SQL sent to the server.</div>
    </ConnectModal>
  )
}

// ---------------------------------------------------------------------------------------------
// Firestore

type FsAuth = 'emulator' | 'google-service-account' | 'google-adc' | 'oauth2' | 'google-api-key'

export function FirestoreConnectDialog({ onConnected, onBack, onCancel }: { onConnected: Connected; onBack(): void; onCancel(): void }) {
  const [project, setProject] = useState('')
  const [database, setDatabase] = useState('(default)')
  const [auth, setAuth] = useState<FsAuth>('google-service-account')
  const [emulator, setEmulator] = useState('localhost:8080')
  const [json, setJson] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [group, setGroup] = useState('')
  const r = useRunner()
  const source: DataSourceRef = { kind: 'firestore', project: project.trim() }
  const stored = project.trim() ? credentialOf(source) : undefined
  const has = (field: string) => !!stored?.secrets.includes(field) && stored.auth.kind === auth
  const ok =
    !!project.trim() &&
    (auth === 'emulator' ? !!emulator.trim() : auth === 'google-service-account' ? !!json.trim() || has('serviceAccountJson') : auth === 'oauth2' ? !!clientId.trim() || stored?.auth.kind === 'oauth2' : auth === 'google-api-key' ? !!apiKey.trim() || has('apiKey') : true)
  const loadKey = async () => {
    const p = await window.wbi.dialog.openFile({ title: 'Service account key', filters: [{ name: 'JSON key files', extensions: ['json'] }] })
    if (!p?.[0]) return
    const text = await window.wbi.fs.readText(p[0])
    setJson(text)
    try {
      const pid = (JSON.parse(text) as { project_id?: string }).project_id
      if (pid && !project) setProject(pid)
    } catch {
      /* the field shows it; validation happens on connect */
    }
  }
  const go = () =>
    r.run('Connecting…', async () => {
      const key = dataSourceKey(source)
      if (auth !== 'emulator') {
        const a: CredentialAuth =
          auth === 'google-service-account'
            ? { kind: auth, serviceAccountJson: secret(json.trim()) }
            : auth === 'oauth2'
              ? { kind: 'oauth2', grant: 'authorization-code', clientId: clientId.trim() || stored?.auth.clientId, clientSecret: secret(clientSecret) }
              : auth === 'google-api-key'
                ? { kind: auth, apiKey: secret(apiKey.trim()) }
                : { kind: 'google-adc' }
        const info = await saveCredential({ key, label: project.trim(), auth: a })
        if (auth === 'oauth2' && !info.secrets.includes('refreshToken')) await signInCredential(key)
      }
      const items = await firestoreItems({ project: project.trim(), database: database.trim() || '(default)', emulator: auth === 'emulator' ? emulator.trim() : undefined }, group.trim() || undefined)
      if (!items.length) throw new Error('The database has no collections you can read.')
      onConnected(project.trim(), items)
    })
  return (
    <ConnectModal title="Google Firestore" busy={r.busy} error={r.error} ok={ok} onOk={() => void go()} onBack={onBack} onCancel={onCancel} width={600}>
      <div className="wbi-dlg-grid2">
        <TextField label="Project ID" value={project} onChange={setProject} autoFocus placeholder="my-firebase-project" />
        <TextField label="Database" value={database} onChange={setDatabase} />
      </div>
      <Dropdown
        label="Authentication"
        value={auth}
        onChange={(v) => setAuth(v as FsAuth)}
        options={[
          { value: 'google-service-account', label: 'Service account key (JSON)' },
          { value: 'google-adc', label: 'Application default credentials (gcloud)' },
          { value: 'oauth2', label: 'Google account (sign in with your browser)' },
          { value: 'google-api-key', label: 'API key (public data only)' },
          { value: 'emulator', label: 'Firestore emulator (no authentication)' }
        ]}
      />
      {auth === 'google-service-account' && (
        <>
          <TextField label="Service account key" multiline rows={4} value={json} onChange={setJson} placeholder='{ "type": "service_account", … }' hint={has('serviceAccountJson') ? 'Saved — leave empty to keep it.' : undefined} />
          <Button style={{ alignSelf: 'flex-start' }} onClick={() => void loadKey()}>
            Load key file…
          </Button>
        </>
      )}
      {auth === 'google-adc' && <div className="wbi-dlg-help">Uses the account of `gcloud auth application-default login` on this computer.</div>}
      {auth === 'oauth2' && (
        <>
          <div className="wbi-dlg-grid2">
            <TextField label="OAuth client ID" value={clientId} onChange={setClientId} placeholder={stored?.auth.clientId ?? 'xxxx.apps.googleusercontent.com'} />
            <TextField label="Client secret" type="password" value={clientSecret} onChange={setClientSecret} hint={has('clientSecret') ? 'Saved — leave empty to keep it.' : undefined} />
          </div>
          <div className="wbi-dlg-help">Create an OAuth client of type “Desktop app” in your Google Cloud project. Your browser opens to sign in; the token is refreshed automatically.</div>
        </>
      )}
      {auth === 'google-api-key' && <TextField label="Web API key" type="password" value={apiKey} onChange={setApiKey} hint={has('apiKey') ? 'Saved — leave empty to keep it.' : 'Only reads what your security rules allow without sign-in.'} />}
      {auth === 'emulator' && <TextField label="Emulator host" value={emulator} onChange={setEmulator} placeholder="localhost:8080" />}
      <TextField label="Collection group (optional)" value={group} onChange={setGroup} placeholder="orders — every collection named so, at any depth" />
      <div className="wbi-dlg-help">
        Documents become rows: nested maps are flattened to <code>field.sub</code> columns, arrays stay lists (Transform data ▸ Expand to New Rows), timestamps are UTC. Filters on fields and Keep Top Rows are sent to Firestore.
      </div>
    </ConnectModal>
  )
}

// ---------------------------------------------------------------------------------------------
// Amazon S3 / S3-compatible

const S3_PRESETS: Array<{ id: string; label: string; endpoint: string; region?: string; hint: string }> = [
  { id: 'aws', label: 'Amazon S3', endpoint: '', hint: 'Leave the endpoint empty; set the bucket region.' },
  { id: 'minio', label: 'MinIO / TrueNAS / Garage (self-hosted)', endpoint: 'http://truenas.local:9000', hint: 'The S3 API address of your server (MinIO console runs on another port).' },
  { id: 'r2', label: 'Cloudflare R2', endpoint: 'https://<account-id>.r2.cloudflarestorage.com', region: 'auto', hint: 'Region "auto".' },
  { id: 'b2', label: 'Backblaze B2', endpoint: 'https://s3.<region>.backblazeb2.com', hint: 'Use an application key ID and key.' },
  { id: 'other', label: 'Other S3-compatible service', endpoint: 'https://s3.example.com', hint: '' }
]

type S3Auth = 'aws-keys' | 'aws-profile' | 'aws-default' | 'anonymous'

function S3AuthFields({ source, value, onChange }: { source: DataSourceRef; value: { auth: S3Auth; keyId: string; secretKey: string; profile: string }; onChange(v: Partial<{ auth: S3Auth; keyId: string; secretKey: string; profile: string }>): void }) {
  const stored = credentialOf(source)
  return (
    <>
      <Dropdown
        label="Authentication"
        value={value.auth}
        onChange={(v) => onChange({ auth: v as S3Auth })}
        options={[
          { value: 'aws-keys', label: 'Access key and secret' },
          { value: 'aws-profile', label: 'Profile (~/.aws)' },
          { value: 'aws-default', label: 'Default credential chain (AWS only)' },
          { value: 'anonymous', label: 'Anonymous (public bucket)' }
        ]}
      />
      {value.auth === 'aws-keys' && (
        <div className="wbi-dlg-grid2">
          <TextField label="Access key ID" value={value.keyId} onChange={(keyId) => onChange({ keyId })} placeholder={stored?.auth.accessKeyId} />
          <TextField label="Secret access key" type="password" value={value.secretKey} onChange={(secretKey) => onChange({ secretKey })} hint={stored?.secrets.includes('secretAccessKey') ? 'Saved — leave empty to keep it.' : undefined} />
        </div>
      )}
      {value.auth === 'aws-profile' && <TextField label="Profile name" value={value.profile} onChange={(profile) => onChange({ profile })} placeholder="default" />}
    </>
  )
}

async function saveS3Credential(source: Extract<DataSourceRef, { kind: 's3' }>, v: { auth: S3Auth; keyId: string; secretKey: string; profile: string }): Promise<void> {
  const key = dataSourceKey({ kind: 's3', endpoint: source.endpoint })
  const stored = credentialOf(source)
  if (v.auth === 'aws-keys' && !v.keyId.trim() && stored?.auth.kind === 'aws-keys') return
  const auth: CredentialAuth =
    v.auth === 'aws-keys' ? { kind: 'aws-keys', accessKeyId: v.keyId.trim(), secretAccessKey: secret(v.secretKey) } : v.auth === 'aws-profile' ? { kind: 'aws-profile', profile: v.profile.trim() || 'default' } : { kind: v.auth }
  await saveCredential({ key, label: source.endpoint || 'Amazon S3', auth })
}

export function S3ConnectDialog({ onConnected, onBack, onCancel }: { onConnected: Connected; onBack(): void; onCancel(): void }) {
  const [preset, setPreset] = useState('minio')
  const [endpoint, setEndpoint] = useState('')
  const [region, setRegion] = useState('')
  const [bucket, setBucket] = useState('')
  const [prefix, setPrefix] = useState('')
  const [pathStyle, setPathStyle] = useState(true)
  const [cred, setCred] = useState({ auth: 'aws-keys' as S3Auth, keyId: '', secretKey: '', profile: '' })
  const r = useRunner()
  const p = S3_PRESETS.find((x) => x.id === preset)!
  const ep = preset === 'aws' ? '' : endpoint.trim().replace(/\/+$/, '')
  const source = { kind: 's3' as const, bucket: bucket.trim(), endpoint: ep || undefined }
  const stored = credentialOf(source)
  const ok = !!bucket.trim() && (preset === 'aws' || !!ep) && (cred.auth !== 'aws-keys' || !!cred.keyId.trim() || stored?.auth.kind === 'aws-keys')
  const go = () =>
    r.run('Connecting…', async () => {
      await saveS3Credential(source, cred)
      const items = await s3Items({ bucket: bucket.trim(), prefix: prefix.trim().replace(/^\/+/, ''), endpoint: ep || undefined, region: region.trim() || p.region, pathStyle })
      onConnected(bucket.trim(), items)
    })
  return (
    <ConnectModal title="Amazon S3 / S3-compatible storage" busy={r.busy} error={r.error} ok={ok} onOk={() => void go()} onBack={onBack} onCancel={onCancel} width={600}>
      <Dropdown label="Service" value={preset} onChange={setPreset} options={S3_PRESETS.map((x) => ({ value: x.id, label: x.label }))} />
      {preset !== 'aws' && <TextField label="Endpoint" value={endpoint} onChange={setEndpoint} placeholder={p.endpoint} hint={p.hint || undefined} autoFocus />}
      <div className="wbi-dlg-grid2">
        <TextField label="Bucket" value={bucket} onChange={setBucket} autoFocus={preset === 'aws'} />
        <TextField label="Region (optional)" value={region} onChange={setRegion} placeholder={p.region ?? 'us-east-1'} />
      </div>
      <TextField label="Folder / prefix (optional)" value={prefix} onChange={setPrefix} placeholder="lake/Tables/" />
      {preset !== 'aws' && <Checkbox checked={pathStyle} onChange={setPathStyle} label="Path-style addressing (http://endpoint/bucket/key — MinIO, TrueNAS)" />}
      <S3AuthFields source={source} value={cred} onChange={(v) => setCred((c) => ({ ...c, ...v }))} />
      <div className="wbi-dlg-help">Lists the objects like the Folder connector. Delta tables in the bucket and CSV / Parquet / JSON files are offered as tables; files of one kind can be combined.</div>
    </ConnectModal>
  )
}

// ---------------------------------------------------------------------------------------------
// Lakehouse folder (Delta)

export function LakehouseConnectDialog({ onConnected, onBack, onCancel }: { onConnected: Connected; onBack(): void; onCancel(): void }) {
  const [path, setPath] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [region, setRegion] = useState('')
  const [cred, setCred] = useState({ auth: 'aws-keys' as S3Auth, keyId: '', secretKey: '', profile: '' })
  const r = useRunner()
  const isS3 = /^s3:\/\//i.test(path.trim())
  const bucket = isS3 ? path.trim().slice(5).split('/')[0]! : ''
  const s3source = { kind: 's3' as const, bucket, endpoint: endpoint.trim().replace(/\/+$/, '') || undefined }
  const stored = isS3 ? credentialOf(s3source) : undefined
  const ok = !!path.trim() && (!isS3 || cred.auth !== 'aws-keys' || !!cred.keyId.trim() || stored?.auth.kind === 'aws-keys')
  const browse = async () => {
    const d = await window.wbi.dialog.openDirectory({ title: 'Lakehouse folder' })
    if (d) setPath(d)
  }
  const go = () =>
    r.run('Reading the lakehouse…', async () => {
      if (isS3) await saveS3Credential(s3source, cred)
      const items = await lakehouseItems(path.trim().replace(/[\\/]+$/, ''), isS3 ? { endpoint: s3source.endpoint, region: region.trim() || undefined } : undefined)
      if (!items.some((i) => i.kind === 'table')) throw new Error("No Delta tables were found under Tables/ (a lakehouse folder holds Tables/<table>/_delta_log and Files/).")
      onConnected(path.trim().split(/[\\/]/).filter(Boolean).pop() ?? 'Lakehouse', items)
    })
  return (
    <ConnectModal title="Lakehouse folder (Delta)" busy={r.busy} error={r.error} ok={ok} onOk={() => void go()} onBack={onBack} onCancel={onCancel} width={600}>
      <div className="wbi-row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <TextField label="Folder" value={path} onChange={setPath} autoFocus placeholder="/data/Starlite.Lakehouse · smb://nas/lake/Sales.Lakehouse · s3://bucket/lakehouse" className="wbi-grow" />
        <Button onClick={() => void browse()}>Browse…</Button>
      </div>
      {isS3 && (
        <>
          <div className="wbi-dlg-grid2">
            <TextField label="Endpoint (empty for AWS)" value={endpoint} onChange={setEndpoint} placeholder="http://truenas.local:9000" />
            <TextField label="Region (optional)" value={region} onChange={setRegion} placeholder="us-east-1" />
          </div>
          <S3AuthFields source={s3source} value={cred} onChange={(v) => setCred((c) => ({ ...c, ...v }))} />
        </>
      )}
      <div className="wbi-dlg-help">Like Fabric's lakehouse connector: every Delta table under Tables/ (also Tables/&lt;schema&gt;/&lt;table&gt;) and the Files/ folder. Works on local disks, mounted network shares and S3 buckets.</div>
    </ConnectModal>
  )
}

// ---------------------------------------------------------------------------------------------
// Network shares

function shareUrl(s: ShareInfo, local: string): string {
  if (!s.url || (s.kind !== 'smb' && s.kind !== 'nfs')) return local
  return `${s.url}${local.slice(s.path.length)}`
}

export function ShareConnectDialog({ onConnected, onBack, onCancel }: { onConnected: Connected; onBack(): void; onCancel(): void }) {
  const [shares, setShares] = useState<ShareInfo[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [mounting, setMounting] = useState(false)
  const [url, setUrl] = useState('')
  const [user, setUser] = useState('')
  const [domain, setDomain] = useState('')
  const [password, setPassword] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const r = useRunner()
  const api = window.wbi?.connectors.shares
  const refresh = () => void api?.list().then(setShares, (e) => r.setError(errText(e)))
  useEffect(refresh, [])
  const selected = shares?.find((s) => s.path === sel) ?? null
  const mount = () =>
    r.run('Mounting…', async () => {
      if (!api) throw new Error('Mounting shares needs the Lumen desktop app.')
      const path = await api.mount({ url: url.trim(), user: user.trim() || undefined, domain: domain.trim() || undefined, password: password || undefined, anonymous })
      const list = await api.list()
      setShares(list)
      setSel(path)
      setMounting(false)
      setPassword('')
    })
  const open = () =>
    r.run('Reading the folder…', async () => {
      if (!selected) return
      const dir = await window.wbi.dialog.openDirectory({ title: 'Folder on the share', defaultPath: selected.path })
      if (!dir) return
      if (!dir.startsWith(selected.path)) throw new Error('Choose a folder inside the selected share.')
      const location = shareUrl(selected, dir)
      onConnected(location.split('/').filter(Boolean).pop() ?? selected.label, folderUrlItems(location, location.split('/').filter(Boolean).pop() ?? selected.label))
    })
  if (mounting)
    return (
      <ConnectModal title="Mount SMB share" busy={r.busy} error={r.error} ok={!!url.trim()} onOk={() => void mount()} onBack={() => setMounting(false)} onCancel={onCancel}>
        <TextField label="Share" value={url} onChange={setUrl} autoFocus placeholder="smb://truenas.local/datasets  or  \\truenas\datasets" />
        <Checkbox checked={anonymous} onChange={setAnonymous} label="Connect as guest (anonymous)" />
        {!anonymous && (
          <>
            <div className="wbi-dlg-grid2">
              <TextField label="User name" value={user} onChange={setUser} />
              <TextField label="Domain / workgroup" value={domain} onChange={setDomain} placeholder="WORKGROUP" />
            </div>
            <TextField label="Password" type="password" value={password} onChange={setPassword} hint="Passed to GVfs (gio mount); your desktop keyring may remember it." />
          </>
        )}
      </ConnectModal>
    )
  return (
    <ConnectModal
      title="Network share (SMB / NFS)"
      busy={r.busy}
      error={r.error}
      ok={!!selected && selected.mounted !== false}
      onOk={() => void open()}
      onBack={onBack}
      onCancel={onCancel}
      width={640}
      left={
        <div className="wbi-row" style={{ gap: 8 }}>
          <Button onClick={() => setMounting(true)}>Mount SMB share…</Button>
          <Button variant="subtle" onClick={refresh} title="Refresh">
            <ArrowClockwiseRegular fontSize={16} />
          </Button>
        </div>
      }
    >
      <div className="wbi-dlg-help">Mounted network locations (GVfs, NFS / CIFS mounts, /mnt and /media). Pick one, then the folder to read. Queries use the share address (smb://server/share/…), which Lumen resolves to the mount.</div>
      <div className="wbi-gd-shares" role="listbox">
        {shares === null ? (
          <Spinner label="Looking for shares…" />
        ) : shares.length ? (
          shares.map((s) => (
            <div key={s.path} role="option" aria-selected={sel === s.path} className={cx('wbi-gd-share', sel === s.path && 'is-selected', s.mounted === false && 'is-off')} onClick={() => setSel(s.path)} onDoubleClick={() => void open()}>
              <span className="wbi-gd-share__icon">{s.kind === 'local' ? <FolderRegular fontSize={18} /> : <ServerRegular fontSize={18} />}</span>
              <span className="wbi-gd-share__text">
                <span className="wbi-gd-share__name">{s.label}</span>
                <span className="wbi-gd-share__sub">
                  {s.url ?? s.path} · {s.mounted === false ? 'in /etc/fstab, not mounted' : s.via === 'gvfs' ? 'GVfs' : s.via === 'mount' ? 'mounted' : 'local mount'}
                </span>
              </span>
            </div>
          ))
        ) : (
          <div className="wbi-pane__empty">No network shares are mounted. Use “Mount SMB share…”.</div>
        )}
      </div>
    </ConnectModal>
  )
}

// ---------------------------------------------------------------------------------------------
// OData, GraphQL, REST

function WebCredentialsLink({ url }: { url: string }) {
  const [open, setOpen] = useState(false)
  const valid = /^https?:\/\/\S+$/i.test(url.trim())
  return (
    <>
      <button type="button" className="wbi-link" style={{ alignSelf: 'flex-start' }} disabled={!valid} onClick={() => setOpen(true)}>
        Credentials (API key, bearer, OAuth 2.0)…
      </button>
      {open && <DataSourceSettings initial={{ kind: 'web', url: url.trim() }} onClose={() => setOpen(false)} />}
    </>
  )
}

export function ODataConnectDialog({ onConnected, onBack, onCancel }: { onConnected: Connected; onBack(): void; onCancel(): void }) {
  const [url, setUrl] = useState('')
  const r = useRunner()
  const ok = /^https?:\/\/\S+$/i.test(url.trim())
  const go = () => r.run('Connecting…', async () => onConnected(url.trim(), await odataItems(url.trim())))
  return (
    <ConnectModal title="OData feed" busy={r.busy} error={r.error} ok={ok} onOk={() => void go()} onBack={onBack} onCancel={onCancel}>
      <TextField label="URL" value={url} onChange={setUrl} autoFocus placeholder="https://services.odata.org/V4/Northwind/Northwind.svc" />
      <WebCredentialsLink url={url} />
    </ConnectModal>
  )
}

export function GraphQLConnectDialog({ onConnected, onBack, onCancel }: { onConnected: Connected; onBack(): void; onCancel(): void }) {
  const [url, setUrl] = useState('')
  const [query, setQuery] = useState('query {\n  items(first: 100) {\n    id\n    name\n  }\n}')
  const [variables, setVariables] = useState('')
  const [path, setPath] = useState('data.items')
  const r = useRunner()
  const vars = useMemo(() => {
    if (!variables.trim()) return { ok: true as const, value: undefined }
    try {
      return { ok: true as const, value: JSON.parse(variables) as unknown }
    } catch {
      return { ok: false as const, value: undefined }
    }
  }, [variables])
  const ok = /^https?:\/\/\S+$/i.test(url.trim()) && !!query.trim() && vars.ok
  const go = () =>
    r.run('Running the query…', async () => {
      const m = graphqlM({ url: url.trim(), query, variables: vars.value, path: path.trim() })
      const name = path.split('.').filter(Boolean).pop() || 'GraphQL'
      const item = mItem({ id: 'graphql', label: name, kind: 'query', tableName: name, m })
      await item.load!()
      onConnected(url.trim(), [item])
    })
  return (
    <ConnectModal title="From GraphQL" busy={r.busy} error={r.error ?? (vars.ok ? null : 'The variables are not valid JSON.')} ok={ok} onOk={() => void go()} onBack={onBack} onCancel={onCancel} width={640}>
      <TextField label="Endpoint" value={url} onChange={setUrl} autoFocus placeholder="https://api.example.com/graphql" />
      <TextField label="Query" value={query} onChange={setQuery} multiline rows={7} inputClassName="wbi-gd-code" />
      <div className="wbi-dlg-grid2">
        <TextField label="Variables (JSON, optional)" value={variables} onChange={setVariables} multiline rows={3} inputClassName="wbi-gd-code" />
        <TextField label="Rows at" value={path} onChange={setPath} hint="Path of the list in the response, e.g. data.items" />
      </div>
      <WebCredentialsLink url={url} />
      <div className="wbi-dlg-help">Generates a Power Query query (POST with Json.FromValue, GraphQL errors raised as M errors). For cursor pagination, edit it in Transform data with List.Generate.</div>
    </ConnectModal>
  )
}

export function RestConnectDialog({ onConnected, onBack, onCancel }: { onConnected: Connected; onBack(): void; onCancel(): void }) {
  const [url, setUrl] = useState('')
  const [itemsPath, setItemsPath] = useState('')
  const [kind, setKind] = useState<Paging['kind']>('none')
  const [param, setParam] = useState('page')
  const [start, setStart] = useState('1')
  const [sizeParam, setSizeParam] = useState('per_page')
  const [size, setSize] = useState('100')
  const [nextField, setNextField] = useState('next')
  const [offsetParam, setOffsetParam] = useState('offset')
  const [limitParam, setLimitParam] = useState('limit')
  const r = useRunner()
  const ok = /^https?:\/\/\S+$/i.test(url.trim())
  const paging = (): Paging =>
    kind === 'page'
      ? { kind, param: param.trim() || 'page', start: Number(start) || 0, sizeParam: sizeParam.trim() || undefined, size: Number(size) || undefined }
      : kind === 'next'
        ? { kind, field: nextField.trim() || 'next' }
        : kind === 'offset'
          ? { kind, offsetParam: offsetParam.trim() || 'offset', limitParam: limitParam.trim() || 'limit', limit: Number(size) || 100 }
          : { kind: 'none' }
  const go = () =>
    r.run('Reading the API…', async () => {
      const m = restM({ url: url.trim(), itemsPath: itemsPath.trim(), paging: paging() })
      let name = 'API'
      try {
        name = new URL(url.trim()).pathname.split('/').filter(Boolean).pop() || 'API'
      } catch {
        /* keep the default */
      }
      const item = mItem({ id: 'rest', label: name, kind: 'query', tableName: name, m })
      await item.load!()
      onConnected(url.trim(), [item])
    })
  return (
    <ConnectModal title="REST API (paged)" busy={r.busy} error={r.error} ok={ok} onOk={() => void go()} onBack={onBack} onCancel={onCancel} width={600}>
      <TextField label="URL" value={url} onChange={setUrl} autoFocus placeholder="https://api.example.com/v1/orders?status=open" />
      <TextField label="Rows at (optional)" value={itemsPath} onChange={setItemsPath} placeholder="data · results · items" hint="Path of the list of records in each response (empty when the response is the list)." />
      <Dropdown
        label="Pagination"
        value={kind}
        onChange={(v) => setKind(v as Paging['kind'])}
        options={[
          { value: 'none', label: 'None (one request)' },
          { value: 'page', label: 'Page number parameter' },
          { value: 'offset', label: 'Offset / limit parameters' },
          { value: 'next', label: 'Next-page link in the response' }
        ]}
      />
      {kind === 'page' && (
        <div className="wbi-dlg-grid2">
          <TextField label="Page parameter" value={param} onChange={setParam} />
          <TextField label="First page" value={start} onChange={setStart} />
          <TextField label="Page size parameter (optional)" value={sizeParam} onChange={setSizeParam} />
          <TextField label="Page size" value={size} onChange={setSize} />
        </div>
      )}
      {kind === 'offset' && (
        <div className="wbi-dlg-grid2">
          <TextField label="Offset parameter" value={offsetParam} onChange={setOffsetParam} />
          <TextField label="Limit parameter" value={limitParam} onChange={setLimitParam} />
          <TextField label="Page size" value={size} onChange={setSize} />
        </div>
      )}
      {kind === 'next' && <TextField label="Next link field" value={nextField} onChange={setNextField} placeholder="next · links.next · @odata.nextLink" />}
      <WebCredentialsLink url={url} />
      <div className="wbi-dlg-help">Generates the Power Query pattern (List.Generate over Web.Contents with Query options) — not a special function, so the query stays standard M.</div>
    </ConnectModal>
  )
}

// ---------------------------------------------------------------------------------------------
// DuckDB (a .duckdb file, or a lakehouse folder whose Delta tables become views)

export function DuckDbConnectDialog({ onConnected, onBack, onCancel }: { onConnected: Connected; onBack(): void; onCancel(): void }) {
  const [mode, setMode] = useState<'file' | 'folder'>('file')
  const [path, setPath] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [query, setQuery] = useState('')
  const r = useRunner()
  const browse = async () => {
    if (mode === 'folder') {
      const d = await window.wbi.dialog.openDirectory({ title: 'Lakehouse folder' })
      if (d) setPath(d)
      return
    }
    const p = await window.wbi.dialog.openFile({ title: 'Open', filters: [{ name: 'DuckDB databases', extensions: ['duckdb', 'db', 'ddb'] }, { name: 'All files', extensions: ['*'] }] })
    if (p?.[0]) setPath(p[0])
  }
  const go = () =>
    r.run('Opening the database…', async () => {
      const p = path.trim().replace(/[\\/]+$/, '')
      const items = await dbItems('duckdb', p, '', query.trim() || undefined)
      if (!items.length) throw new Error(mode === 'folder' ? 'No Delta tables were found in the folder (Tables/<table>/_delta_log).' : 'The database has no tables or views.')
      onConnected(p.split(/[\\/]/).filter(Boolean).pop() ?? 'DuckDB', items)
    })
  return (
    <ConnectModal title="DuckDB database" busy={r.busy} error={r.error} ok={!!path.trim()} onOk={() => void go()} onBack={onBack} onCancel={onCancel} width={600}>
      <div className="wbi-row" style={{ gap: 20 }}>
        <Radio checked={mode === 'file'} onChange={() => setMode('file')} label="Database file (.duckdb)" />
        <Radio checked={mode === 'folder'} onChange={() => setMode('folder')} label="Lakehouse folder" />
      </div>
      <div className="wbi-row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <TextField label={mode === 'folder' ? 'Folder' : 'File'} value={path} onChange={setPath} autoFocus placeholder={mode === 'folder' ? '/data/Starlite.Lakehouse' : '/data/analytics.duckdb'} className="wbi-grow" />
        <Button onClick={() => void browse()}>Browse…</Button>
      </div>
      <button type="button" className="wbi-link" style={{ alignSelf: 'flex-start' }} onClick={() => setAdvanced((a) => !a)}>
        {advanced ? '▾' : '▸'} Advanced options
      </button>
      {advanced && <TextField label="SQL statement (optional)" value={query} onChange={setQuery} multiline rows={5} inputClassName="wbi-gd-code" placeholder={mode === 'folder' ? "SELECT * FROM read_parquet('Files/raw/orders.parquet')" : 'SELECT …'} />}
      <div className="wbi-dlg-help">
        {mode === 'folder'
          ? 'Every Delta table of the lakehouse (Tables/<table>) becomes a view of its current snapshot; Parquet files are readable by their relative path in SQL statements.'
          : 'The file is opened read-only. Filters, column choices, sorting and row limits are folded into the SQL.'}
      </div>
    </ConnectModal>
  )
}

/** SQLite: a file picker, then the Navigator. */
export async function sqliteItems(): Promise<{ title: string; items: NavItem[] } | null> {
  const paths = await window.wbi.dialog.openFile({ title: 'Open', filters: [{ name: 'SQLite databases', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] }, { name: 'All files', extensions: ['*'] }] })
  const path = paths?.[0]
  if (!path) return null
  const items = await dbItems('sqlite' as DbKind, path, '')
  if (!items.length) throw new Error('The database has no tables or views.')
  return { title: path.split('/').pop() ?? path, items }
}
