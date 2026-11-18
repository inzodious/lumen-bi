/**
 * Data source settings (data sources of the current file, or every stored permission — "Global
 * permissions"; Edit Permissions / Clear Permissions) and the credentials dialog (authentication method
 * per kind of source, privacy level, connection test, OAuth sign-in), as in Power BI Desktop.
 *
 * Shared by the Power Query Editor (its dialog host), Get data and refresh: pass `onClose` / `onEdit`
 * to use them outside the editor. Credentials are kept by ../credentials (main-process store, secrets
 * encrypted with the OS keyring).
 */
import { useEffect, useMemo, useState } from 'react'
import { CloudRegular, DatabaseRegular, DocumentRegular, FolderRegular, GlobeRegular, KeyRegular, PlugConnectedRegular } from '@fluentui/react-icons'
import type { CredentialAuth, CredentialInfo, CredentialKind, PrivacyLevel, SqlAuth } from '@shared/host'
import type { SemanticModel } from '@core/model/types'
import { dataSourceKey, dataSourceLabel, dataSourcesOf, type DataSourceRef } from '@core/data/queries'
import { Button, Dropdown, MenuButton, Modal, Radio, SearchBox, Spinner, TextField, cx, toast } from '../../../app/ui'
import { useApp } from '../../../state/store'
import {
  authKindsFor,
  authLabel,
  clearAllCredentials,
  clearCredential,
  credentialList,
  credentialOf,
  getCredential,
  loadCredentials,
  onCredentialsChanged,
  saveCredential,
  signInCredential,
  sourceFromKey
} from '../credentials'
import { refreshPreview } from '../actions'
import { pqSession } from '../session'
import { closePqDialog, openPqDialog } from '../pqDialogs'
import { usePq } from '../pqStore'
import { Field } from './common'

type Source = DataSourceRef & { queries: string[] }

export function sourceIcon(s: DataSourceRef, size = 20) {
  switch (s.kind) {
    case 'sql':
    case 'postgresql':
    case 'mysql':
    case 'sqlite':
    case 'duckdb':
      return <DatabaseRegular fontSize={size} />
    case 'file':
      return <DocumentRegular fontSize={size} />
    case 'folder':
    case 'lakehouse':
      return <FolderRegular fontSize={size} />
    case 'web':
    case 'odata':
      return <GlobeRegular fontSize={size} />
    case 'firestore':
    case 's3':
      return <CloudRegular fontSize={size} />
    default:
      return <PlugConnectedRegular fontSize={size} />
  }
}

/** Data sources of the model plus those only in the editor's (unapplied) queries. */
function useFileSources(): Source[] {
  const model = useApp((s) => s.project?.model)
  const draft = usePq((s) => s.draft)
  return useMemo(() => {
    const out = new Map<string, Source>()
    if (model) for (const s of dataSourcesOf(model)) out.set(dataSourceKey(s), s)
    if (model) {
      const synthetic: SemanticModel = { ...model, tables: [], expressions: draft.queries.map((q) => ({ name: q.name, kind: 'm', expression: q.source })) }
      for (const s of dataSourcesOf(synthetic)) {
        const key = dataSourceKey(s)
        const cur = out.get(key)
        if (cur) cur.queries = [...new Set([...cur.queries, ...s.queries])]
        else out.set(key, s)
      }
    }
    return [...out.values()].sort((a, b) => dataSourceLabel(a).localeCompare(dataSourceLabel(b)))
  }, [model, draft])
}

function useCredentialsTick(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    void loadCredentials()
    return onCredentialsChanged(() => setTick((t) => t + 1))
  }, [])
  return tick
}

const afterChange = () => {
  pqSession()?.clearErrors()
  refreshPreview()
}

export function DataSourceSettingsDialog({ onClose, onEdit }: { onClose?(): void; onEdit?(s: DataSourceRef): void } = {}) {
  const close = onClose ?? closePqDialog
  const edit = onEdit ?? ((s: DataSourceRef) => openPqDialog({ id: 'credentials', source: s, returnTo: 'dataSources' }))
  const fileSources = useFileSources()
  const tick = useCredentialsTick()
  const [scope, setScope] = useState<'file' | 'global'>('file')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const sources: Source[] = useMemo(
    () => (scope === 'file' ? fileSources : credentialList().map((c) => ({ ...sourceFromKey(c.key), queries: [] }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, fileSources, tick]
  )
  const shown = sources.filter((s) => !q || dataSourceLabel(s).toLowerCase().includes(q.toLowerCase()))
  const selected = sources.find((s) => dataSourceKey(s) === sel) ?? null
  const clear = async (s: Source) => {
    const c = scope === 'global' ? getCredential(dataSourceKey(s)) : credentialOf(s)
    if (c) await clearCredential(c.key)
    afterChange()
    toast({ kind: 'success', message: `Permissions cleared for ${dataSourceLabel(s)}.` })
  }
  return (
    <Modal
      title="Data source settings"
      subtitle="Manage settings for data sources that you have connected to using Lumen."
      onClose={close}
      width={680}
      footerLeft={
        <div className="wbi-row">
          <Button disabled={!selected || selected.kind === 'other'} onClick={() => selected && edit(selected)}>
            Edit Permissions…
          </Button>
          <MenuButton
            className="wbi-btn wbi-btn--default"
            disabled={!sources.length}
            items={[
              { label: 'Clear Permissions', disabled: !selected, onClick: () => selected && void clear(selected) },
              {
                label: 'Clear All Permissions',
                onClick: () =>
                  void clearAllCredentials().then(() => {
                    afterChange()
                    toast({ kind: 'success', message: 'All data source permissions were cleared.' })
                  })
              }
            ]}
          >
            Clear Permissions ▾
          </MenuButton>
        </div>
      }
      footer={<Button onClick={close}>Close</Button>}
    >
      <div className="wbi-col" style={{ gap: 10 }}>
        <div className="wbi-row" style={{ gap: 16 }}>
          <Radio checked={scope === 'file'} onChange={() => setScope('file')} label="Data sources in current file" />
          <Radio checked={scope === 'global'} onChange={() => setScope('global')} label="Global permissions" />
        </div>
        <SearchBox value={q} onChange={setQ} placeholder="Search data source settings" />
        <div className="wbi-pq-dlg__list wbi-pq-dlg__sources" role="listbox">
          {shown.map((s) => {
            const key = dataSourceKey(s)
            const cred = scope === 'global' ? getCredential(key) : credentialOf(s)
            const privacy = cred?.privacy && cred.privacy !== 'None' ? ` · ${cred.privacy}` : ''
            return (
              <div
                key={key}
                role="option"
                aria-selected={sel === key}
                className={cx('wbi-pq-dlg__source', sel === key && 'is-selected')}
                onClick={() => setSel(key)}
                onDoubleClick={() => s.kind !== 'other' && edit(s)}
              >
                <span className="wbi-pq-dlg__source-icon">{sourceIcon(s)}</span>
                <span className="wbi-pq-dlg__source-text">
                  <span className="wbi-pq-dlg__source-name" title={dataSourceLabel(s)}>
                    {dataSourceLabel(s)}
                  </span>
                  <span className="wbi-pq-dlg__source-sub">
                    {s.kind === 'other' ? 'Not supported by Lumen' : `${authLabel(cred, s)}${privacy}`}
                    {s.queries.length ? ` · used by ${s.queries.join(', ')}` : ''}
                  </span>
                </span>
              </div>
            )
          })}
          {!shown.length && (
            <div className="wbi-pq-dlg__empty">{sources.length ? 'No data sources match your search.' : scope === 'file' ? 'This file has no data sources.' : 'No permissions are stored yet.'}</div>
          )}
        </div>
      </div>
    </Modal>
  )
}

const MICROSOFT_KINDS: Array<SqlAuth['kind']> = ['azure-default', 'azure-cli', 'device-code', 'interactive']
const PRIVACY: PrivacyLevel[] = ['None', 'Public', 'Organizational', 'Private']
const PRIVACY_HINT: Record<PrivacyLevel, string> = {
  None: 'Not set: data may be combined with any other source.',
  Public: 'Anyone can see this data (public websites, open data).',
  Organizational: 'Visible to a trusted group; not sent to Public sources.',
  Private: 'Confidential: never sent to other sources (filters that use it are evaluated in Lumen).'
}

const TITLES: Partial<Record<DataSourceRef['kind'], string>> = {
  sql: 'SQL Server database',
  postgresql: 'PostgreSQL database',
  mysql: 'MySQL database',
  firestore: 'Google Firestore',
  s3: 'Amazon S3 / S3-compatible storage',
  web: 'Web',
  odata: 'OData feed'
}

/** URL levels a web credential can apply to (PBI: "Select which level to apply these settings to"). */
function urlLevels(url: string): string[] {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    const out = [`${u.protocol}//${u.host}`]
    for (let i = 0; i < parts.length; i++) out.push(`${out[0]}/${parts.slice(0, i + 1).join('/')}`)
    return out
  } catch {
    return [url]
  }
}

/** A connection test request for a source (uses its stored credential). */
function testRequest(source: DataSourceRef, auth: CredentialAuth): Parameters<NonNullable<NonNullable<typeof window.wbi.connectors.credentials>['test']>>[0] | null {
  switch (source.kind) {
    case 'sql':
      return { kind: 'sql', server: source.server, database: source.database ?? '', auth: { kind: auth.kind as SqlAuth['kind'], user: auth.user, tenantId: auth.tenantId } }
    case 'postgresql':
    case 'mysql':
      return { kind: 'db-items', driver: source.kind, server: source.server, database: source.database ?? '' }
    case 'sqlite':
    case 'duckdb':
      return { kind: 'db-items', driver: source.kind, server: source.path, database: '' }
    case 'firestore':
      return { kind: 'firestore-collections', project: source.project, database: '(default)' }
    case 's3':
      return source.bucket ? { kind: 's3-list', bucket: source.bucket, prefix: '', recursive: false, endpoint: source.endpoint, forcePathStyle: source.endpoint ? true : undefined } : null
    case 'web':
    case 'odata':
      return { kind: 'http', url: source.url }
    default:
      return null
  }
}

type Form = Required<Pick<CredentialAuth, 'user' | 'tenantId' | 'keyName' | 'authUrl' | 'tokenUrl' | 'clientId' | 'scope' | 'accessKeyId' | 'profile'>> & {
  password: string
  token: string
  keyValue: string
  clientSecret: string
  serviceAccountJson: string
  apiKey: string
  secretAccessKey: string
  sessionToken: string
  sslMode: NonNullable<CredentialAuth['sslMode']>
  keyIn: NonNullable<CredentialAuth['keyIn']>
  grant: NonNullable<CredentialAuth['grant']>
}

function initialForm(info: CredentialInfo | undefined): Form {
  const a: Partial<CredentialInfo['auth']> = info?.auth ?? {}
  return {
    user: a.user ?? '',
    tenantId: a.tenantId ?? '',
    keyName: a.keyName ?? '',
    authUrl: a.authUrl ?? '',
    tokenUrl: a.tokenUrl ?? '',
    clientId: a.clientId ?? '',
    scope: a.scope ?? '',
    accessKeyId: a.accessKeyId ?? '',
    profile: a.profile ?? '',
    password: '',
    token: '',
    keyValue: '',
    clientSecret: '',
    serviceAccountJson: '',
    apiKey: '',
    secretAccessKey: '',
    sessionToken: '',
    sslMode: a.sslMode ?? 'prefer',
    keyIn: a.keyIn ?? 'header',
    grant: a.grant ?? 'authorization-code'
  }
}

export function CredentialsDialog({ source, returnTo, onClose, onSaved }: { source: DataSourceRef; returnTo?: 'dataSources'; onClose?(): void; onSaved?(info: CredentialInfo): void }) {
  const close = onClose ?? (() => (returnTo ? openPqDialog({ id: returnTo }) : closePqDialog()))
  useCredentialsTick()
  const kinds = authKindsFor(source)
  const isWeb = source.kind === 'web' || source.kind === 'odata'
  const levels = isWeb ? urlLevels(source.url) : []
  const existing = credentialOf(source)
  const [key, setKey] = useState(() => existing?.key ?? (isWeb ? `web:${levels[0]}` : dataSourceKey(source)))
  const current = getCredential(key)
  const [kind, setKind] = useState<CredentialKind>(() => (current && kinds.some((k) => k.id === current.auth.kind) ? current.auth.kind : kinds[0]!.id))
  const [privacy, setPrivacy] = useState<PrivacyLevel>(current?.privacy ?? 'None')
  const [f, setF] = useState<Form>(() => initialForm(current))
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [store, setStore] = useState<'keyring' | 'weak' | 'session' | null>(null)
  useEffect(() => {
    void window.wbi?.connectors.credentials?.status().then(
      (st) => setStore(!st.encrypted ? 'session' : st.backend === 'basic_text' ? 'weak' : 'keyring'),
      () => setStore(null)
    )
  }, [])
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setF((x) => ({ ...x, [k]: v }))
  const saved = (field: string) => !!current?.secrets.includes(field) && current.auth.kind === kind
  const secretHint = (field: string) => (saved(field) ? 'Saved — leave empty to keep it.' : undefined)
  const desc = kinds.find((k) => k.id === kind)?.description
  const isGoogle = source.kind === 'firestore'

  const has = (field: keyof Form) => !!String(f[field]).trim() || saved(field)
  const valid = (() => {
    switch (kind) {
      case 'sql':
      case 'basic':
        return !!f.user.trim() && (source.kind === 'postgresql' || source.kind === 'mysql' || has('password'))
      case 'token':
      case 'bearer':
        return has('token')
      case 'key':
        return !!f.keyName.trim() && has('keyValue')
      case 'oauth2':
        return (!!f.tokenUrl.trim() || isGoogle) && !!f.clientId.trim()
      case 'google-service-account':
        return has('serviceAccountJson')
      case 'google-api-key':
        return has('apiKey')
      case 'aws-keys':
        return !!f.accessKeyId.trim() && has('secretAccessKey')
      case 'aws-profile':
        return !!f.profile.trim()
      default:
        return true
    }
  })()

  const secret = (v: string) => (v === '' ? undefined : v)
  const authOf = (): CredentialAuth => {
    const a: CredentialAuth = { kind }
    switch (kind) {
      case 'sql':
        Object.assign(a, { user: f.user.trim(), password: secret(f.password) })
        break
      case 'basic':
        Object.assign(a, { user: f.user.trim(), password: secret(f.password) })
        if (source.kind === 'postgresql' || source.kind === 'mysql') a.sslMode = f.sslMode
        break
      case 'token':
      case 'bearer':
        a.token = secret(f.token.trim())
        break
      case 'key':
        Object.assign(a, { keyName: f.keyName.trim(), keyIn: f.keyIn, keyValue: secret(f.keyValue) })
        break
      case 'oauth2':
        Object.assign(a, { grant: isGoogle ? 'authorization-code' : f.grant, authUrl: f.authUrl.trim() || undefined, tokenUrl: f.tokenUrl.trim() || undefined, clientId: f.clientId.trim(), clientSecret: secret(f.clientSecret), scope: f.scope.trim() || undefined })
        break
      case 'google-service-account':
        a.serviceAccountJson = secret(f.serviceAccountJson.trim())
        break
      case 'google-api-key':
        a.apiKey = secret(f.apiKey.trim())
        break
      case 'aws-keys':
        Object.assign(a, { accessKeyId: f.accessKeyId.trim(), secretAccessKey: secret(f.secretAccessKey), sessionToken: secret(f.sessionToken) })
        break
      case 'aws-profile':
        a.profile = f.profile.trim()
        break
    }
    if (MICROSOFT_KINDS.includes(kind as SqlAuth['kind']) && f.tenantId.trim()) a.tenantId = f.tenantId.trim()
    return a
  }

  const persist = async (): Promise<CredentialInfo> => {
    const info = await saveCredential({ key, label: isWeb ? key.slice(4) : dataSourceLabel(source), auth: authOf(), privacy })
    afterChange()
    return info
  }
  const save = async () => {
    if (!valid) return
    setBusy('Saving…')
    try {
      const info = await persist()
      onSaved?.(info)
      close()
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }
  const test = async () => {
    const req = testRequest(source, authOf())
    const api = window.wbi?.connectors.credentials
    if (!req || !api) return
    setBusy('Testing the connection…')
    setResult(null)
    try {
      await persist()
      setResult(await api.test(req))
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }
  const signIn = async () => {
    setBusy('Waiting for the sign-in in your browser…')
    setResult(null)
    try {
      await persist()
      await signInCredential(key)
      setResult({ ok: true, message: 'Signed in.' })
    } catch (e) {
      setResult({ ok: false, message: (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '') })
    } finally {
      setBusy(null)
    }
  }
  const loadKeyFile = async () => {
    const p = await window.wbi.dialog.openFile({ title: 'Service account key', filters: [{ name: 'JSON key files', extensions: ['json'] }] })
    if (p?.[0]) set('serviceAccountJson')(await window.wbi.fs.readText(p[0]))
  }
  const canTest = !!testRequest(source, { kind }) && !!window.wbi?.connectors.credentials

  return (
    <Modal
      title={TITLES[source.kind] ?? 'Edit Permissions'}
      onClose={close}
      width={600}
      onSubmit={() => valid && void save()}
      footerLeft={
        busy ? (
          <Spinner label={busy} />
        ) : (
          <div className="wbi-row" style={{ gap: 8 }}>
            {canTest && (
              <Button disabled={!valid} onClick={() => void test()}>
                Test connection
              </Button>
            )}
            {kind === 'oauth2' && (
              <Button disabled={!valid} onClick={() => void signIn()}>
                {f.grant === 'client-credentials' && !isGoogle ? 'Get token' : 'Sign in'}
              </Button>
            )}
            {MICROSOFT_KINDS.includes(kind as SqlAuth['kind']) && window.wbi?.connectors.clearCredentials && (
              <Button
                variant="subtle"
                onClick={() =>
                  void window.wbi.connectors
                    .clearCredentials?.(f.tenantId.trim() || undefined)
                    .then(() => toast({ kind: 'success', message: 'Signed out of Microsoft accounts.' }))
                    .catch((e: unknown) => toast({ kind: 'error', message: e instanceof Error ? e.message : String(e) }))
                }
              >
                Sign out
              </Button>
            )}
          </div>
        )
      }
      footer={
        <>
          <Button variant="primary" disabled={!valid || !!busy} onClick={() => void save()}>
            Save
          </Button>
          <Button onClick={close}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-col" style={{ gap: 12 }}>
        <div className="wbi-pq-dlg__credsource">
          <KeyRegular fontSize={18} />
          <span title={dataSourceLabel(source)}>{dataSourceLabel(source)}</span>
        </div>
        {isWeb && levels.length > 1 && (
          <Dropdown label="Select which level to apply these settings to" value={key} options={levels.map((l) => ({ value: `web:${l}`, label: l }))} onChange={setKey} />
        )}
        {kinds.length > 1 && <Dropdown label="Authentication" value={kind} options={kinds.map((k) => ({ value: k.id, label: k.label }))} onChange={(k) => setKind(k as CredentialKind)} />}
        {desc && <div className="wbi-pq-dlg__hint">{desc}</div>}

        {(kind === 'sql' || kind === 'basic') && (
          <div className="wbi-dlg-grid2">
            <TextField label="User name" value={f.user} onChange={set('user')} autoFocus />
            <TextField label="Password" type="password" value={f.password} onChange={set('password')} hint={secretHint('password')} />
          </div>
        )}
        {kind === 'basic' && (source.kind === 'postgresql' || source.kind === 'mysql') && (
          <Dropdown
            label="Encryption (SSL mode)"
            value={f.sslMode}
            onChange={(v) => set('sslMode')(v as Form['sslMode'])}
            options={[
              { value: 'prefer', label: 'Prefer — encrypt when the server supports it' },
              { value: 'require', label: 'Require — always encrypt (certificate not verified)' },
              { value: 'verify-full', label: 'Verify — encrypt and verify the certificate' },
              { value: 'disable', label: 'Disable — never encrypt' }
            ]}
          />
        )}
        {(kind === 'token' || kind === 'bearer') && <TextField label={kind === 'token' ? 'Access token' : 'Token'} multiline rows={4} value={f.token} onChange={set('token')} hint={secretHint('token')} />}
        {kind === 'key' && (
          <>
            <div className="wbi-dlg-grid2">
              <TextField label="Key name" value={f.keyName} onChange={set('keyName')} placeholder="X-Api-Key or api_key" autoFocus />
              <Dropdown label="Send as" value={f.keyIn} onChange={(v) => set('keyIn')(v as Form['keyIn'])} options={[{ value: 'header', label: 'Request header' }, { value: 'query', label: 'Query parameter' }]} />
            </div>
            <TextField label="Key" type="password" value={f.keyValue} onChange={set('keyValue')} hint={secretHint('keyValue')} />
          </>
        )}
        {kind === 'oauth2' && (
          <>
            {!isGoogle && (
              <Dropdown
                label="Grant"
                value={f.grant}
                onChange={(v) => set('grant')(v as Form['grant'])}
                options={[
                  { value: 'authorization-code', label: 'Authorization code (sign in with a browser, PKCE)' },
                  { value: 'client-credentials', label: 'Client credentials (service account)' }
                ]}
              />
            )}
            {!isGoogle && f.grant === 'authorization-code' && <TextField label="Authorization URL" value={f.authUrl} onChange={set('authUrl')} placeholder="https://auth.example.com/oauth2/authorize" />}
            {!isGoogle && <TextField label="Token URL" value={f.tokenUrl} onChange={set('tokenUrl')} placeholder="https://auth.example.com/oauth2/token" />}
            <div className="wbi-dlg-grid2">
              <TextField label="Client ID" value={f.clientId} onChange={set('clientId')} />
              <TextField label="Client secret (optional)" type="password" value={f.clientSecret} onChange={set('clientSecret')} hint={secretHint('clientSecret')} />
            </div>
            <TextField label="Scope" value={f.scope} onChange={set('scope')} placeholder={isGoogle ? 'https://www.googleapis.com/auth/datastore' : 'read offline_access'} />
            <div className="wbi-pq-dlg__hint">
              The redirect URI is a loopback address (http://127.0.0.1:&lt;port&gt;/callback): register your app as a desktop / native client.{' '}
              {saved('refreshToken') || saved('accessToken') ? 'You are signed in.' : 'Save, then Sign in.'}
            </div>
          </>
        )}
        {kind === 'google-service-account' && (
          <>
            <TextField label="Service account key (JSON)" multiline rows={6} value={f.serviceAccountJson} onChange={set('serviceAccountJson')} hint={secretHint('serviceAccountJson')} placeholder='{ "type": "service_account", … }' />
            <Button style={{ alignSelf: 'flex-start' }} onClick={() => void loadKeyFile()}>
              Load key file…
            </Button>
          </>
        )}
        {kind === 'google-api-key' && <TextField label="API key" type="password" value={f.apiKey} onChange={set('apiKey')} hint={secretHint('apiKey')} />}
        {kind === 'aws-keys' && (
          <>
            <div className="wbi-dlg-grid2">
              <TextField label="Access key ID" value={f.accessKeyId} onChange={set('accessKeyId')} autoFocus />
              <TextField label="Secret access key" type="password" value={f.secretAccessKey} onChange={set('secretAccessKey')} hint={secretHint('secretAccessKey')} />
            </div>
            <TextField label="Session token (optional)" type="password" value={f.sessionToken} onChange={set('sessionToken')} hint={secretHint('sessionToken')} />
          </>
        )}
        {kind === 'aws-profile' && <TextField label="Profile name" value={f.profile} onChange={set('profile')} placeholder="default" />}
        {MICROSOFT_KINDS.includes(kind as SqlAuth['kind']) && <TextField label="Tenant ID (optional)" value={f.tenantId} onChange={set('tenantId')} placeholder="Directory (tenant) ID or domain" />}

        <Field label="Privacy level">
          <Dropdown value={privacy} options={PRIVACY.map((p) => ({ value: p, label: p }))} onChange={(v) => setPrivacy(v as PrivacyLevel)} />
        </Field>
        <div className="wbi-pq-dlg__hint">{PRIVACY_HINT[privacy]}</div>
        {result && <div className={result.ok ? 'wbi-gd-ok' : 'wbi-dlg-error'}>{result.message}</div>}
        <div className="wbi-pq-dlg__hint">
          {!window.wbi?.connectors.credentials
            ? 'Credentials need the Lumen desktop app.'
            : store === 'session'
              ? 'No system keyring is available: passwords, keys and tokens are kept for this session only. Install / unlock GNOME Keyring or KWallet to store them.'
              : store === 'weak'
                ? 'No system keyring was found: secrets are stored with Electron\'s weak fallback obfuscation. Install / unlock GNOME Keyring or KWallet for real encryption.'
                : 'Passwords, keys and tokens are stored encrypted with your system keyring.'}
        </div>
      </div>
    </Modal>
  )
}

/** Data source settings outside the Power Query Editor (Get data, refresh): list ⇄ edit in one host. */
export function DataSourceSettings({ onClose, initial }: { onClose(): void; initial?: DataSourceRef }) {
  const [editing, setEditing] = useState<DataSourceRef | null>(initial ?? null)
  if (editing) return <CredentialsDialog source={editing} onClose={() => (initial ? onClose() : setEditing(null))} />
  return <DataSourceSettingsDialog onClose={onClose} onEdit={setEditing} />
}
