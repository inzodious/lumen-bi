/**
 * Generates docs/reference/connector-support.md from the Get data connector registry (`SOURCES` in
 * src/renderer/src/dialogs/getdata/GetDataDialog.tsx: id, label, category, availability) and the facts below.
 *
 *   npx vitest run --config scripts/docs/gen-dax-m-connector.vitest.config.ts gen-connector-support
 *
 * The registry is read from the source text (the dialog module needs a browser). Every connector of the registry
 * must have an entry in FACTS and vice versa, and every M function named here must be bound by the M engine,
 * otherwise the generator fails: the table cannot silently drift from the code.
 *
 * Where each fact comes from:
 *  - auth: the connection dialog's Authentication options (ConnectorDialogs.tsx, GetDataDialog.tsx) and
 *    Data source settings (views/powerquery/dialogs/SourceDialogs.tsx);
 *  - folding: src/core/m/lib/fold.ts, sources.ts (Sql.Database), connectors.ts (databases, Firestore);
 *  - cancel: src/main/ipc/connectors.ts — SQL Server queries (tedious attention packet) and HTTP requests are
 *    registered with `cancellable`; `conn:request` (PostgreSQL, MySQL, SQLite, DuckDB, Firestore, S3) is not, so a
 *    cancelled refresh stops waiting (src/core/m/driver.ts `abortable`) while that request runs to completion.
 */
import { it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createLibrary } from '../../src/core/m/lib/index.ts'
import { MFunction, noHost } from '../../src/core/m/index.ts'

const ROOT = resolve(import.meta.dirname, '../..')

type Cancel = 'stops' | 'abandons' | 'local' | 'none'
interface Fact {
  m: string[]
  auth: string
  folding: string
  cancel: Cancel
  notes: string
  /** how-to article (docs/connect-and-transform) */
  doc?: string
}

const SQL_AUTH = 'Microsoft account (default, Azure CLI, device code, browser sign-in); database user name and password; access token (Data source settings only)'
const SQL_FOLD = 'Column selection, row filters, sort, skip, top N, joins within one database'
const SQL_NOTES = 'Import or DirectQuery. DirectQuery tables load no rows. Optional native SQL statement. Windows authentication is not available.'
const S3_AUTH = 'Access key and secret; profile (~/.aws); default credential chain (AWS only); anonymous'
const WEB_AUTH = 'Anonymous; API key; Basic; bearer token; OAuth 2.0 (set in Data source settings)'

const FACTS: Record<string, Fact> = {
  excel: { m: ['Excel.Workbook', 'File.Contents'], auth: 'None (local file)', folding: 'None', cancel: 'local', notes: '.xlsx and .xlsm. Sheets and Excel tables.', doc: 'connect-to-files.md' },
  csv: { m: ['Csv.Document', 'File.Contents'], auth: 'None (local file)', folding: 'None', cancel: 'local', notes: '.csv, .txt, .tsv, .prn; delimiter and headers detected.', doc: 'connect-to-files.md' },
  json: { m: ['Json.Document', 'File.Contents'], auth: 'None (local file)', folding: 'None', cancel: 'local', notes: 'Arrays of records become tables.', doc: 'connect-to-files.md' },
  parquet: { m: ['Parquet.Document', 'File.Contents'], auth: 'None (local file)', folding: 'None', cancel: 'local', notes: 'Column types come from the file.', doc: 'connect-to-files.md' },
  folder: { m: ['Folder.Files'], auth: 'None (local folder)', folding: 'None', cancel: 'local', notes: 'Lists files with their attributes; combine them in Power Query.', doc: 'connect-to-files.md' },
  share: { m: ['Folder.Files'], auth: 'Guest, or user name, domain and password (passed to GVfs)', folding: 'None', cancel: 'local', notes: 'SMB / NFS shares mounted on the computer; queries keep the smb:// address.', doc: 'connect-to-network-shares.md' },
  lakehouse: { m: ['Lakehouse.Folder', 'DeltaLake.Table'], auth: 'None (local or mounted folder); S3 options for s3:// paths', folding: 'None', cancel: 'local', notes: 'Delta tables under Tables/ and the Files/ folder. Deletion vectors are refused.', doc: 'connect-to-a-lakehouse-folder-or-duckdb.md' },
  sql: { m: ['Sql.Database'], auth: SQL_AUTH, folding: SQL_FOLD, cancel: 'stops', notes: SQL_NOTES, doc: 'connect-to-sql-server-and-fabric.md' },
  postgresql: { m: ['PostgreSQL.Database'], auth: 'User name and password; SSL mode', folding: SQL_FOLD, cancel: 'abandons', notes: 'Import only. Optional native SQL statement.', doc: 'connect-to-postgresql-mysql-sqlite.md' },
  mysql: { m: ['MySQL.Database'], auth: 'User name and password; SSL mode', folding: 'Column selection, row filters, sort, skip, top N, inner / left / right joins', cancel: 'abandons', notes: 'Also MariaDB. Import only.', doc: 'connect-to-postgresql-mysql-sqlite.md' },
  sqlite: { m: ['SQLite.Database'], auth: 'None (local file)', folding: 'Column selection, row filters, sort, skip, top N, inner / left joins', cancel: 'abandons', notes: 'Lumen connector. The file is read into memory, read-only.', doc: 'connect-to-postgresql-mysql-sqlite.md' },
  duckdb: { m: ['DuckDB.Database'], auth: 'None (local file or folder)', folding: SQL_FOLD, cancel: 'abandons', notes: 'Lumen connector. A .duckdb file (read-only) or a lakehouse folder whose Delta tables become views.', doc: 'connect-to-a-lakehouse-folder-or-duckdb.md' },
  fabricsql: { m: ['Sql.Database'], auth: SQL_AUTH, folding: SQL_FOLD, cancel: 'stops', notes: SQL_NOTES, doc: 'connect-to-sql-server-and-fabric.md' },
  fabricwh: { m: ['Sql.Database'], auth: SQL_AUTH, folding: SQL_FOLD, cancel: 'stops', notes: SQL_NOTES, doc: 'connect-to-sql-server-and-fabric.md' },
  semanticmodel: { m: [], auth: '', folding: '', cancel: 'none', notes: 'Shown but not available.' },
  dataflows: { m: [], auth: '', folding: '', cancel: 'none', notes: 'Shown but not available. PowerBI.Dataflows raises an error that suggests reading the dataflow destination instead.' },
  azuresql: { m: ['Sql.Database'], auth: SQL_AUTH, folding: SQL_FOLD, cancel: 'stops', notes: SQL_NOTES, doc: 'connect-to-sql-server-and-fabric.md' },
  synapse: { m: ['Sql.Database'], auth: SQL_AUTH, folding: SQL_FOLD, cancel: 'stops', notes: SQL_NOTES, doc: 'connect-to-sql-server-and-fabric.md' },
  sharepointlist: { m: [], auth: '', folding: '', cancel: 'none', notes: 'Shown but not available. SharePoint.Tables raises an error.' },
  firestore: { m: ['Firestore.Collections', 'Firestore.Query'], auth: 'Service account key (JSON); application default credentials (gcloud); Google account (OAuth); API key; emulator', folding: 'Field filters (=, <, <=, >, >=, in, OR, not null), top N, some sorts', cancel: 'abandons', notes: 'Lumen connector. Documents become rows; nested maps are flattened.', doc: 'connect-to-firestore.md' },
  s3: { m: ['AmazonS3.Contents'], auth: S3_AUTH, folding: 'None', cancel: 'abandons', notes: 'Lumen connector. AWS S3, MinIO, Cloudflare R2, Backblaze B2 and other S3-compatible services. Lists objects like Folder.', doc: 'connect-to-s3-storage.md' },
  web: { m: ['Web.Contents'], auth: WEB_AUTH, folding: 'None', cancel: 'stops', notes: 'CSV, text and JSON resources. HTML pages are not supported.', doc: 'connect-to-web-and-apis.md' },
  odata: { m: ['OData.Feed'], auth: WEB_AUTH, folding: 'None', cancel: 'stops', notes: 'OData v4 JSON; follows next links.', doc: 'connect-to-web-and-apis.md' },
  graphql: { m: ['Web.Contents', 'Json.FromValue'], auth: WEB_AUTH, folding: 'None', cancel: 'stops', notes: 'Generates a standard M query (POST).', doc: 'connect-to-web-and-apis.md' },
  rest: { m: ['Web.Contents', 'List.Generate'], auth: WEB_AUTH, folding: 'None', cancel: 'stops', notes: 'Generates a standard M paging query (page number, offset / limit, next link).', doc: 'connect-to-web-and-apis.md' },
  enter: { m: ['Table.FromRows', 'Binary.Decompress'], auth: 'None', folding: 'None', cancel: 'none', notes: 'Rows are stored in the query itself.', doc: 'enter-data.md' },
  blank: { m: [], auth: 'None', folding: 'Depends on the query', cancel: 'none', notes: 'Opens a new query in the Power Query editor.', doc: 'write-m-in-the-advanced-editor.md' }
}

const CANCEL_TEXT: Record<Cancel, string> = {
  stops: 'Yes: the request is stopped',
  abandons: 'Partly: Lumen stops waiting; the request finishes in the background',
  local: 'Partly: Lumen stops waiting; a file read in progress completes',
  none: 'Not applicable'
}

const esc = (s: string) => s.replace(/\|/g, '\\|')

it('generates the connector support reference', () => {
  const src = readFileSync(join(ROOT, 'src/renderer/src/dialogs/getdata/GetDataDialog.tsx'), 'utf8')
  const block = src.slice(src.indexOf('export const SOURCES'), src.indexOf(']\n', src.indexOf('export const SOURCES')))
  const sources = [...block.matchAll(/\{ id: '([^']+)', label: '([^']+)', category: '([^']+)'([^\n]*)\}/g)].map((m) => ({ id: m[1]!, label: m[2]!, category: m[3]!, disabled: m[4]!.includes('disabled: true') }))
  if (sources.length < 20) throw new Error(`parsed only ${sources.length} connectors from GetDataDialog.tsx`)
  const ids = new Set(sources.map((s) => s.id))
  const missing = sources.filter((s) => !FACTS[s.id]).map((s) => s.id)
  const stale = Object.keys(FACTS).filter((k) => !ids.has(k))
  if (missing.length || stale.length) throw new Error(`connector registry and FACTS differ: missing ${missing.join(', ')}; stale ${stale.join(', ')}`)
  const { entries } = createLibrary({ call: () => null, host: noHost(), localOffsetMinutes: 0 })
  for (const s of sources) for (const f of FACTS[s.id]!.m) if (!(entries.get(f) instanceof MFunction)) throw new Error(`${s.id}: ${f} is not an M function`)

  const link = (s: (typeof sources)[number]) => (FACTS[s.id]!.doc ? `[${s.label}](../connect-and-transform/${FACTS[s.id]!.doc})` : s.label)
  let md = `<!-- Generated by scripts/docs/gen-connector-support.gen.ts. Do not edit by hand. -->\n\n# Connector support\n\n> **Applies to:** Analysts · Developers\n\n`
  md += `Every data source listed in Lumen's **Get Data** dialog, with the Power Query M function its queries use, how it authenticates, what it folds to the source and what **Cancel** in the **Refresh** dialog does to a request that is running.\n\n`
  md += `> [!NOTE]\n> This page is generated from the Get data connector list in the code (\`src/renderer/src/dialogs/getdata/GetDataDialog.tsx\`) and checked against the M engine. Regenerate it with \`npx vitest run --config scripts/docs/gen-dax-m-connector.vitest.config.ts gen-connector-support\`.\n\n`
  md += `## Connectors and authentication\n\n| Connector | Category | M function | Authentication |\n|---|---|---|---|\n`
  for (const s of sources) {
    const f = FACTS[s.id]!
    md += `| ${link(s)} | ${s.category} | ${s.disabled ? 'Not available' : f.m.map((x) => `\`${x}\``).join(', ') || '(any)'} | ${esc(f.auth) || 'Not available'} |\n`
  }
  md += `\n## Folding, cancel and notes\n\n| Connector | Folding | Refresh cancel | Notes |\n|---|---|---|---|\n`
  for (const s of sources) {
    const f = FACTS[s.id]!
    md += `| ${s.label} | ${esc(f.folding) || 'Not available'} | ${CANCEL_TEXT[f.cancel]} | ${esc(f.notes)} |\n`
  }
  md += `\n## What the columns mean\n\n- **Folding**: the Power Query steps Lumen turns into the source's own query language instead of running them in Lumen. Folding only continues while each step can be folded; see [Query folding](../connect-and-transform/query-folding.md).\n`
  md += `- **Refresh cancel**: *Yes* means Lumen tells the source or the network stack to stop. *Partly* means the **Refresh** dialog stops at once and the table keeps its previous data, but the database query, object download or file read that was already running is not interrupted; its result is discarded. See [Refresh data](../connect-and-transform/refresh-data.md).\n`
  md += `- **Lumen connector**: a connector Power BI Desktop does not have. A query that uses it does not refresh in Power BI Desktop.\n\n`
  md += `## Connectors that are not exercised for this documentation\n\nThe database and cloud connectors are covered by Lumen's integration tests, which run against Docker containers (PostgreSQL, MySQL, MinIO for S3, the Firestore emulator) when \`LUMEN_IT=1\` is set. SQL Server, Azure SQL, Fabric and Synapse have no live test. The how-to articles for these connectors are written from the code and the tests and say so.\n\n`
  md += `## Related content\n\n- [Get data overview](../connect-and-transform/get-data-overview.md)\n- [Credentials and privacy](../connect-and-transform/credentials-and-privacy.md)\n- [Query folding](../connect-and-transform/query-folding.md)\n- [M function support](m-function-support.md)\n`
  writeFileSync(join(ROOT, 'docs/reference/connector-support.md'), md)
})
