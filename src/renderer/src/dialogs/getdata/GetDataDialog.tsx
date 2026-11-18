/**
 * PBI "Get Data" dialog: categories on the left, searchable source list, Connect. File sources open
 * the native file picker and then the Navigator; SQL / Web ask for connection details first. The
 * PostgreSQL / MySQL / SQLite / Firestore / S3 / lakehouse / network share / OData / GraphQL / REST
 * connectors (./ConnectorDialogs) evaluate their navigation as M, so the Navigator previews are the
 * generated queries' own results.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  DocumentTableRegular,
  DocumentTextRegular,
  BracesRegular,
  DatabaseRegular,
  FolderRegular,
  GlobeRegular,
  CodeRegular,
  TableEditRegular,
  CloudDatabaseRegular,
  DataBarVerticalRegular,
  ArrowFlowDiagonalUpRightRegular,
  DocumentDataRegular,
  ListRegular,
  CloudRegular,
  ServerRegular,
  DatabaseStack16Regular,
  BranchForkRegular,
  BoxRegular
} from '@fluentui/react-icons'
import { basename } from '@core/io/fs'
import { Button, Dropdown, Modal, Radio, SearchBox, Spinner, TextField } from '../../app/ui'
import { cx } from '../../app/ui/cx'
import { useShell } from '../../app/shellState'
import type { SqlAuth } from '@shared/host'
import { Navigator } from './Navigator'
import { csvItems, excelItems, folderItems, jsonItems, mColumns, parquetItems, sqlFullData, sqlItems, webItems, type NavItem, type SqlTarget } from './readers'
import { loadImportedTables, type ImportTable } from './loadTables'
import { blankQueryM } from './mcode'
import type { ParsedTable } from './parsers'
import { resetNavigatorCache } from './mnav'
import { DataSourceSettings } from '../../views/powerquery/dialogs/SourceDialogs'
import {
  DbConnectDialog,
  DuckDbConnectDialog,
  FirestoreConnectDialog,
  GraphQLConnectDialog,
  LakehouseConnectDialog,
  ODataConnectDialog,
  RestConnectDialog,
  S3ConnectDialog,
  ShareConnectDialog,
  sqliteItems
} from './ConnectorDialogs'

type Category = 'All' | 'File' | 'Database' | 'Microsoft Fabric' | 'Power Platform' | 'Azure' | 'Online Services' | 'Other'
const CATEGORIES: Category[] = ['All', 'File', 'Database', 'Microsoft Fabric', 'Power Platform', 'Azure', 'Online Services', 'Other']

interface SourceDef {
  id: string
  label: string
  category: Exclude<Category, 'All'>
  icon: ReactElement
  /** not supported in this build */
  disabled?: boolean
}

export const SOURCES: SourceDef[] = [
  { id: 'excel', label: 'Excel workbook', category: 'File', icon: <DocumentTableRegular fontSize={20} /> },
  { id: 'csv', label: 'Text/CSV', category: 'File', icon: <DocumentTextRegular fontSize={20} /> },
  { id: 'json', label: 'JSON', category: 'File', icon: <BracesRegular fontSize={20} /> },
  { id: 'parquet', label: 'Parquet', category: 'File', icon: <DocumentDataRegular fontSize={20} /> },
  { id: 'folder', label: 'Folder', category: 'File', icon: <FolderRegular fontSize={20} /> },
  { id: 'share', label: 'Network share (SMB / NFS)', category: 'File', icon: <ServerRegular fontSize={20} /> },
  { id: 'lakehouse', label: 'Lakehouse folder (Delta)', category: 'File', icon: <DatabaseStack16Regular fontSize={20} /> },
  { id: 'sql', label: 'SQL Server database', category: 'Database', icon: <DatabaseRegular fontSize={20} /> },
  { id: 'postgresql', label: 'PostgreSQL database', category: 'Database', icon: <DatabaseRegular fontSize={20} /> },
  { id: 'mysql', label: 'MySQL database', category: 'Database', icon: <DatabaseRegular fontSize={20} /> },
  { id: 'sqlite', label: 'SQLite database', category: 'Database', icon: <DatabaseRegular fontSize={20} /> },
  { id: 'duckdb', label: 'DuckDB database', category: 'Database', icon: <DatabaseRegular fontSize={20} /> },
  { id: 'fabricsql', label: 'SQL analytics endpoint', category: 'Microsoft Fabric', icon: <CloudDatabaseRegular fontSize={20} /> },
  { id: 'fabricwh', label: 'Warehouse', category: 'Microsoft Fabric', icon: <CloudDatabaseRegular fontSize={20} /> },
  { id: 'semanticmodel', label: 'Power BI semantic models', category: 'Power Platform', icon: <DataBarVerticalRegular fontSize={20} />, disabled: true },
  { id: 'dataflows', label: 'Dataflows', category: 'Power Platform', icon: <ArrowFlowDiagonalUpRightRegular fontSize={20} />, disabled: true },
  { id: 'azuresql', label: 'Azure SQL database', category: 'Azure', icon: <CloudDatabaseRegular fontSize={20} /> },
  { id: 'synapse', label: 'Azure Synapse Analytics SQL', category: 'Azure', icon: <CloudDatabaseRegular fontSize={20} /> },
  { id: 'sharepointlist', label: 'SharePoint Online list', category: 'Online Services', icon: <ListRegular fontSize={20} />, disabled: true },
  { id: 'firestore', label: 'Google Firestore', category: 'Online Services', icon: <CloudRegular fontSize={20} /> },
  { id: 's3', label: 'Amazon S3 / S3-compatible storage', category: 'Online Services', icon: <BoxRegular fontSize={20} /> },
  { id: 'web', label: 'Web', category: 'Other', icon: <GlobeRegular fontSize={20} /> },
  { id: 'odata', label: 'OData feed', category: 'Other', icon: <GlobeRegular fontSize={20} /> },
  { id: 'graphql', label: 'GraphQL API', category: 'Other', icon: <BranchForkRegular fontSize={20} /> },
  { id: 'rest', label: 'REST API (paged)', category: 'Other', icon: <GlobeRegular fontSize={20} /> },
  { id: 'enter', label: 'Enter data', category: 'Other', icon: <TableEditRegular fontSize={20} /> },
  { id: 'blank', label: 'Blank query', category: 'Other', icon: <CodeRegular fontSize={20} /> }
]

const FILE_FILTERS: Record<string, { name: string; extensions: string[] }[]> = {
  excel: [{ name: 'Excel workbooks', extensions: ['xlsx', 'xlsm'] }],
  csv: [{ name: 'Text/CSV files', extensions: ['csv', 'txt', 'tsv', 'prn'] }],
  json: [{ name: 'JSON files', extensions: ['json'] }],
  parquet: [{ name: 'Parquet files', extensions: ['parquet'] }]
}

const SQL_SOURCES = new Set(['sql', 'fabricsql', 'fabricwh', 'azuresql', 'synapse'])

/** Connectors with their own connection dialog (./ConnectorDialogs). */
type ConnectorDialog = 'postgresql' | 'mysql' | 'duckdb' | 'firestore' | 's3' | 'lakehouse' | 'share' | 'odata' | 'graphql' | 'rest'
const CONNECTOR_DIALOGS = new Set<string>(['postgresql', 'mysql', 'duckdb', 'firestore', 's3', 'lakehouse', 'share', 'odata', 'graphql', 'rest'])

type Step = { kind: 'pick' } | { kind: 'sql'; source: string } | { kind: 'web' } | { kind: 'connector'; id: ConnectorDialog } | { kind: 'nav'; title: string; items: NavItem[]; sql?: SqlTarget }

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** `#/?dialog=getData&getDataSource=postgresql` opens a connector directly (headless captures). */
function routeSource(): string | undefined {
  try {
    return new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('getDataSource') ?? undefined
  } catch {
    return undefined
  }
}

export function GetDataDialog({ source: sourceProp, onClose }: { source?: string; onClose(): void }) {
  const [source] = useState(() => sourceProp ?? routeSource())
  const [step, setStep] = useState<Step>({ kind: 'pick' })
  const [category, setCategory] = useState<Category>('All')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string>(source ?? 'excel')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const openDialog = useShell((s) => s.openDialog)
  const started = useRef(false)
  const [settings, setSettings] = useState(false)
  useEffect(() => resetNavigatorCache(), [])

  const connect = async (id: string) => {
    setError(null)
    const def = SOURCES.find((s) => s.id === id)
    if (!def || def.disabled) return
    if (id === 'enter') return openDialog({ id: 'enterData' })
    if (id === 'blank') {
      onClose()
      loadImportedTables([{ name: 'Query1', m: blankQueryM(), columns: [] }], { transform: true })
      return
    }
    if (SQL_SOURCES.has(id)) return setStep({ kind: 'sql', source: id })
    if (id === 'web') return setStep({ kind: 'web' })
    if (CONNECTOR_DIALOGS.has(id)) return setStep({ kind: 'connector', id: id as ConnectorDialog })
    try {
      if (id === 'sqlite') {
        setBusy('Reading the database…')
        const r = await sqliteItems()
        if (r) setStep({ kind: 'nav', title: r.title, items: r.items })
        return
      }
      if (id === 'folder') {
        const dir = await window.wbi.dialog.openDirectory({ title: 'Folder' })
        if (!dir) return
        setBusy('Reading folder…')
        setStep({ kind: 'nav', title: basename(dir), items: await folderItems(dir) })
        return
      }
      const paths = await window.wbi.dialog.openFile({ title: 'Open', filters: [...(FILE_FILTERS[id] ?? []), { name: 'All files', extensions: ['*'] }] })
      const path = paths?.[0]
      if (!path) return
      setBusy(`Reading ${basename(path)}…`)
      const bytes = await window.wbi.fs.readFile(path)
      const lower = path.toLowerCase()
      const kind = id === 'excel' || /\.xls[xm]$/.test(lower) ? 'excel' : id === 'parquet' || lower.endsWith('.parquet') ? 'parquet' : id === 'json' || lower.endsWith('.json') ? 'json' : 'csv'
      const items = kind === 'excel' ? await excelItems(path, bytes) : kind === 'parquet' ? await parquetItems(path, bytes) : kind === 'json' ? jsonItems(path, bytes) : csvItems(path, bytes)
      if (!items.length) throw new Error('No tables were found in this file.')
      setStep({ kind: 'nav', title: basename(path), items })
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(null)
    }
  }

  // opened from a ribbon shortcut (Excel workbook, SQL Server…): go straight to the source
  useEffect(() => {
    if (source && !started.current) {
      started.current = true
      void connect(source)
    }
  })

  const load = async (items: NavItem[], previews: Map<string, ParsedTable>, transform: boolean, sql?: SqlTarget) => {
    setBusy('Loading…')
    setError(null)
    try {
      const tables: ImportTable[] = []
      for (const it of items) {
        let data: ParsedTable | undefined = it.data
        if (!data && sql && it.mode !== 'directQuery') {
          setBusy(`Loading ${it.label}…`)
          data = await sqlFullData(sql, it)
        } else if (!data && it.full && !transform) {
          setBusy(`Loading ${it.label}…`)
          data = await it.full()
        }
        const shape = data ?? previews.get(it.id)
        const cols = shape ? mColumns(shape) : []
        tables.push({ name: it.tableName, m: it.m(cols), columns: cols.map((c) => ({ name: c.name, type: c.type })), data, mode: it.mode })
      }
      onClose()
      loadImportedTables(tables, { transform })
    } catch (e) {
      setError(errText(e))
      setBusy(null)
    }
  }

  if (step.kind === 'nav')
    return (
      <>
        <Navigator title={step.title} items={step.items} busy={busy} onCancel={onClose} onLoad={(items, previews, transform) => load(items, previews, transform, step.sql)} />
        {error && (
          <Modal title="Couldn't load the data" onClose={() => setError(null)} width={480} footer={<Button variant="primary" onClick={() => setError(null)}>OK</Button>}>
            <div className="wbi-dlg-error">{error}</div>
          </Modal>
        )}
      </>
    )
  if (step.kind === 'sql') return <SqlConnectDialog source={step.source} onCancel={onClose} onBack={() => setStep({ kind: 'pick' })} onConnected={(title, items, sql) => setStep({ kind: 'nav', title, items, sql })} />
  if (step.kind === 'web') return <WebConnectDialog onCancel={onClose} onConnected={(title, items) => setStep({ kind: 'nav', title, items })} />
  if (step.kind === 'connector') {
    const props = { onCancel: onClose, onBack: () => setStep({ kind: 'pick' }), onConnected: (title: string, items: NavItem[]) => setStep({ kind: 'nav', title, items }) }
    switch (step.id) {
      case 'postgresql':
      case 'mysql':
        return <DbConnectDialog kind={step.id} {...props} />
      case 'duckdb':
        return <DuckDbConnectDialog {...props} />
      case 'firestore':
        return <FirestoreConnectDialog {...props} />
      case 's3':
        return <S3ConnectDialog {...props} />
      case 'lakehouse':
        return <LakehouseConnectDialog {...props} />
      case 'share':
        return <ShareConnectDialog {...props} />
      case 'odata':
        return <ODataConnectDialog {...props} />
      case 'graphql':
        return <GraphQLConnectDialog {...props} />
      case 'rest':
        return <RestConnectDialog {...props} />
    }
  }
  if (settings) return <DataSourceSettings onClose={() => setSettings(false)} />

  const list = SOURCES.filter((s) => (category === 'All' || s.category === category) && (!q || s.label.toLowerCase().includes(q.toLowerCase())))
  return (
    <Modal
      title="Get Data"
      onClose={onClose}
      width={760}
      height={560}
      onSubmit={() => void connect(selected)}
      footerLeft={
        busy ? (
          <Spinner label={busy} />
        ) : error ? (
          <span className="wbi-dlg-error">{error}</span>
        ) : (
          <button type="button" className="wbi-link wbi-gd-footer-link" onClick={() => setSettings(true)}>
            Data source settings…
          </button>
        )
      }
      footer={
        <>
          <Button variant="primary" disabled={!!busy || !!SOURCES.find((s) => s.id === selected)?.disabled} onClick={() => void connect(selected)}>
            Connect
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-dlg-split">
        <div className="wbi-dlg-nav">
          <div className="wbi-gd-search">
            <SearchBox value={q} onChange={setQ} placeholder="Search" />
          </div>
          {CATEGORIES.map((c) => (
            <button key={c} type="button" className={cx('wbi-dlg-nav__item', category === c && 'is-active')} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="wbi-dlg-main">
          <div className="wbi-dlg-section-title">{category}</div>
          <div className="wbi-gd-list" role="listbox">
            {list.map((s) => (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={selected === s.id}
                disabled={s.disabled}
                title={s.disabled ? 'Not available in this build' : undefined}
                className={cx('wbi-gd-source', selected === s.id && 'is-selected')}
                onClick={() => setSelected(s.id)}
                onDoubleClick={() => void connect(s.id)}
              >
                <span className="wbi-gd-source__icon">{s.icon}</span>
                {s.label}
                {category === 'All' && <span className="wbi-gd-source__cat">{s.disabled ? 'Not available' : s.category}</span>}
              </button>
            ))}
            {!list.length && <div className="wbi-pane__empty">No connectors match your search.</div>}
          </div>
        </div>
      </div>
    </Modal>
  )
}

const SQL_TITLES: Record<string, string> = {
  sql: 'SQL Server database',
  fabricsql: 'SQL analytics endpoint',
  fabricwh: 'Warehouse',
  azuresql: 'Azure SQL database',
  synapse: 'Azure Synapse Analytics SQL'
}

function SqlConnectDialog({ source, onCancel, onBack, onConnected }: { source: string; onCancel(): void; onBack(): void; onConnected(title: string, items: NavItem[], sql: SqlTarget): void }) {
  const options = useShell((s) => s.options)
  const [server, setServer] = useState('')
  const [database, setDatabase] = useState('')
  const [mode, setMode] = useState<'import' | 'directQuery'>('import')
  const [advanced, setAdvanced] = useState(false)
  const [query, setQuery] = useState('')
  const [authKind, setAuthKind] = useState<SqlAuth['kind']>(options.sqlAuth)
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = server.trim() && (database.trim() || !query.trim())
  const go = async () => {
    if (!ok) return
    setBusy(true)
    setError(null)
    const auth: SqlAuth = { kind: authKind, tenantId: options.sqlTenantId || undefined, ...(authKind === 'sql' ? { user, password } : {}) }
    const target: SqlTarget = { server: server.trim(), database: database.trim(), query: query.trim() || undefined, mode, auth }
    try {
      const items = await sqlItems(target)
      if (!items.length) throw new Error('The database contains no tables or views that you can access.')
      onConnected(target.database || target.server, items, target)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={SQL_TITLES[source] ?? 'SQL Server database'}
      onClose={onCancel}
      width={560}
      onSubmit={() => void go()}
      footerLeft={busy ? <Spinner label="Connecting…" /> : null}
      footer={
        <>
          <Button variant="primary" disabled={!ok || busy} onClick={() => void go()}>
            OK
          </Button>
          <Button onClick={onBack}>Back</Button>
          <Button onClick={onCancel}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-col" style={{ gap: 14 }}>
        <TextField label="Server" value={server} onChange={setServer} autoFocus placeholder={source === 'sql' ? 'server\\instance' : 'xxxxxxxx.datawarehouse.fabric.microsoft.com'} />
        <TextField label="Database (optional)" value={database} onChange={setDatabase} />
        <div className="wbi-field">
          <span className="wbi-field__label">Data Connectivity mode</span>
          <div className="wbi-row" style={{ gap: 20 }}>
            <Radio checked={mode === 'import'} onChange={() => setMode('import')} label="Import" />
            <Radio checked={mode === 'directQuery'} onChange={() => setMode('directQuery')} label="DirectQuery" />
          </div>
        </div>
        <Dropdown
          label="Authentication"
          value={authKind}
          onChange={setAuthKind}
          options={[
            { value: 'azure-default', label: 'Microsoft account (default credential chain)' },
            { value: 'azure-cli', label: 'Microsoft account (Azure CLI sign-in)' },
            { value: 'device-code', label: 'Microsoft account (device code)' },
            { value: 'interactive', label: 'Microsoft account (browser sign-in)' },
            { value: 'sql', label: 'Database (user name and password)' }
          ]}
        />
        {authKind === 'sql' && (
          <div className="wbi-dlg-grid2">
            <TextField label="User name" value={user} onChange={setUser} />
            <TextField label="Password" type="password" value={password} onChange={setPassword} />
          </div>
        )}
        <button type="button" className="wbi-link" style={{ alignSelf: 'flex-start' }} onClick={() => setAdvanced((a) => !a)}>
          {advanced ? '▾' : '▸'} Advanced options
        </button>
        {advanced && <TextField label="SQL statement (optional, requires database)" value={query} onChange={setQuery} multiline rows={5} />}
        {mode === 'directQuery' && <div className="wbi-dlg-help">DirectQuery tables keep their M source but no rows are imported; visuals over them show no data until you switch the table to Import and refresh.</div>}
        {error && <div className="wbi-dlg-error">{error}</div>}
      </div>
    </Modal>
  )
}

function WebConnectDialog({ onCancel, onConnected }: { onCancel(): void; onConnected(title: string, items: NavItem[]): void }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = useMemo(() => /^https?:\/\/\S+$/i.test(url.trim()), [url])
  const go = async () => {
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      onConnected(url.trim(), await webItems(url.trim()))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="From Web"
      onClose={onCancel}
      width={560}
      onSubmit={() => void go()}
      footerLeft={busy ? <Spinner label="Connecting…" /> : null}
      footer={
        <>
          <Button variant="primary" disabled={!valid || busy} onClick={() => void go()}>
            OK
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-col" style={{ gap: 14 }}>
        <div className="wbi-row" style={{ gap: 20 }}>
          <Radio checked onChange={() => undefined} label="Basic" />
          <Radio checked={false} disabled label="Advanced" />
        </div>
        <TextField label="URL" value={url} onChange={setUrl} autoFocus placeholder="https://example.com/data.csv" type="url" />
        <div className="wbi-dlg-help">CSV, text and JSON resources are supported.</div>
        {error && <div className="wbi-dlg-error">{error}</div>}
      </div>
    </Modal>
  )
}
