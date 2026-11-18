/**
 * Navigator items for the connectors that are implemented in the M engine (PostgreSQL, MySQL, SQLite,
 * Firestore, S3, lakehouse folders, OData, GraphQL / REST templates): the navigation and every preview are
 * evaluated as M through the same fetch-and-replay driver as refresh, so what the Navigator shows is what
 * the generated query loads (previews fold to `LIMIT 50` / `limit: 50` at the source).
 */
import type { DataType } from '@core/model/types'
import type { Scalar } from '@core/model/data'
import { natural } from '@core/data/refresh'
import { createFetcher } from '@core/data/fetcher'
import { DataCache, runWithData } from '@core/m/driver.ts'
import { evaluateQuery } from '@core/m/engine.ts'
import { Lazy, MBinary, MDate, MDateTime, MDateTimeZone, MList, MRecord, MTable, MTime, type Cell, type MType, type MValue } from '@core/m/values.ts'
import { refreshHost } from '../../views/powerquery/credentials'
import { letExpr, mIdent, mString } from './mcode'
import type { ParsedTable } from './parsers'
import type { NavItem } from './readers'

/** One cache per Get data session: browsing the Navigator and loading don't refetch. */
let cache = new DataCache()

export function resetNavigatorCache(): void {
  cache = new DataCache()
}

function cleanMessage(m: string): string {
  return m.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}

/** Evaluates M and maps the value inside the final pass (lazy cells may still fetch). */
export async function evalM<T>(source: string, f: (v: MValue) => T, signal?: AbortSignal): Promise<T> {
  const fetch = createFetcher(refreshHost())
  return runWithData(
    (host) => {
      const ev = evaluateQuery(source, { host, previewSteps: false })
      if (!ev.result.ok) throw new Error(cleanMessage(`${ev.result.error.message}`))
      return f(ev.result.value)
    },
    fetch,
    { cache, signal, localOffsetMinutes: -new Date().getTimezoneOffset() }
  )
}

const force = (c: Cell): MValue => (c instanceof Lazy ? c.get() : c)

function dataTypeOf(t: MType, sample: MValue[]): DataType {
  switch (t.kind) {
    case 'number':
      return t.facet === 'Int64' ? 'int64' : t.facet === 'Currency' ? 'decimal' : 'double'
    case 'text':
      return 'string'
    case 'logical':
      return 'boolean'
    case 'date':
    case 'datetime':
    case 'datetimezone':
    case 'time':
      return 'dateTime'
    case 'binary':
      return 'binary'
  }
  const v = sample.find((x) => x !== null)
  if (typeof v === 'number') return sample.every((x) => x === null || (typeof x === 'number' && Number.isInteger(x))) ? 'int64' : 'double'
  if (typeof v === 'boolean') return 'boolean'
  if (v instanceof MDate || v instanceof MDateTime || v instanceof MDateTimeZone || v instanceof MTime) return 'dateTime'
  return 'string'
}

/** Nested values can't be model cells: the preview shows their kind, a load leaves them blank. */
function cellScalar(v: MValue, preview: boolean): Scalar {
  if (v instanceof MList) return preview ? '[List]' : null
  if (v instanceof MRecord) return preview ? '[Record]' : null
  if (v instanceof MTable) return preview ? '[Table]' : null
  if (v instanceof MBinary) return preview ? '[Binary]' : v.bytes
  try {
    return natural(v)
  } catch {
    return null
  }
}

/** An M table → the Navigator's / loader's ParsedTable. */
export function tableToParsed(t: MTable, opts: { limit?: number; preview?: boolean } = {}): ParsedTable {
  const all = t.rows
  const rows = opts.limit !== undefined ? all.slice(0, opts.limit) : all
  const values: MValue[][] = rows.map((r) =>
    r.map((c) => {
      try {
        return force(c)
      } catch {
        return null
      }
    })
  )
  const types = t.columns.map((_c, i) =>
    dataTypeOf(
      t.types[i]!,
      values.slice(0, 200).map((r) => r[i] ?? null)
    )
  )
  return {
    columns: [...t.columns],
    types,
    rows: values.map((r) => r.map((v) => cellScalar(v, !!opts.preview))),
    truncated: opts.limit !== undefined && all.length > opts.limit
  }
}

export const PREVIEW_ROWS = 50

/** Preview of an M table expression (folded FirstN). */
export function previewOf(expr: string): () => Promise<ParsedTable> {
  return () => evalM(`Table.FirstN(${expr}, ${PREVIEW_ROWS + 1})`, (v) => tableToParsed(asTable(v), { limit: PREVIEW_ROWS, preview: true }))
}

/** Every row (Load). */
export function fullOf(expr: string): () => Promise<ParsedTable> {
  return () => evalM(expr, (v) => tableToParsed(asTable(v)))
}

function asTable(v: MValue): MTable {
  if (v instanceof MTable) return v
  throw new Error(`The item is a ${v === null ? 'null' : (v.constructor.name.replace(/^M/, '') || typeof v).toLowerCase()}, not a table.`)
}

/** The `let … in` of a navigation item: `Source = <source>, <step> = <nav>`. */
function navM(sourceM: string, steps: Array<[string, string]>): string {
  return letExpr([['Source', sourceM], ...steps])
}

/** A Navigator item whose data is an M expression. */
export function mItem(o: { id: string; label: string; kind: NavItem['kind']; group?: string; tableName: string; m: string; expr?: string }): NavItem {
  // the item's table expression for previews: the query itself (a let … in expression is fine inside FirstN)
  const expr = o.expr ?? `(${o.m})`
  return { id: o.id, label: o.label, kind: o.kind, group: o.group, tableName: o.tableName, load: previewOf(expr), full: fullOf(expr), m: () => o.m }
}

// ---------------------------------------------------------------------------------------------
// Databases

export type DbKind = 'postgresql' | 'mysql' | 'sqlite' | 'duckdb'

export function dbSourceM(kind: DbKind, server: string, database: string, query?: string): string {
  const opts = query ? `, [Query=${mString(query)}]` : ''
  if (kind === 'sqlite') return `SQLite.Database(${mString(server)}${opts})`
  // a .duckdb file or a lakehouse folder (Delta tables as views)
  if (kind === 'duckdb') return `DuckDB.Database(${mString(server)}${opts})`
  return `${kind === 'postgresql' ? 'PostgreSQL' : 'MySQL'}.Database(${mString(server)}, ${mString(database)}${opts})`
}

export async function dbItems(kind: DbKind, server: string, database: string, query?: string): Promise<NavItem[]> {
  if (query) return [mItem({ id: 'query', label: 'Query1', kind: 'query', tableName: 'Query1', m: letExpr([['Source', dbSourceM(kind, server, database, query)]]) })]
  const src = dbSourceM(kind, server, database)
  const list = await evalM(`Table.SelectColumns(${src}, {"Schema", "Item", "Kind"})`, (v) =>
    asTable(v).rows.map((r) => ({ schema: String(force(r[0]!)), item: String(force(r[1]!)), kind: String(force(r[2]!)) }))
  )
  return list.map((it) => {
    const step = `${it.schema}_${it.item}`
    return mItem({
      id: `${it.schema}.${it.item}`,
      label: kind === 'mysql' ? it.item : `${it.schema}.${it.item}`,
      kind: it.kind === 'View' ? 'view' : 'table',
      group: kind === 'mysql' ? database : it.schema,
      tableName: it.item,
      m: navM(src, [[step, `Source{[Schema=${mString(it.schema)},Item=${mString(it.item)}]}[Data]`]])
    })
  })
}

// ---------------------------------------------------------------------------------------------
// Firestore

export interface FirestoreTarget {
  project: string
  database?: string
  emulator?: string
}

function firestoreOptions(t: FirestoreTarget, extra: string[] = []): string {
  const parts = [...(t.database && t.database !== '(default)' ? [`Database=${mString(t.database)}`] : []), ...(t.emulator ? [`EmulatorHost=${mString(t.emulator)}`] : []), ...extra]
  return parts.length ? `, [${parts.join(', ')}]` : ''
}

export async function firestoreItems(t: FirestoreTarget, collectionGroup?: string): Promise<NavItem[]> {
  const src = `Firestore.Collections(${mString(t.project)}${firestoreOptions(t)})`
  const items: NavItem[] = []
  if (collectionGroup) {
    const m = letExpr([['Source', `Firestore.Query(${mString(t.project)}, ${mString(collectionGroup)}${firestoreOptions(t, ['AllDescendants=true'])})`]])
    items.push(mItem({ id: `group:${collectionGroup}`, label: `${collectionGroup} (all collections named so)`, kind: 'table', group: 'Collection groups', tableName: collectionGroup, m }))
  }
  const names = await evalM(`Table.Column(${src}, "Name")`, (v) => (v as MList).values().map(String))
  for (const n of names) items.push(mItem({ id: n, label: n, kind: 'table', group: 'Collections', tableName: n, m: navM(src, [[n, `Source{[Name=${mString(n)}]}[Data]`]]) }))
  return items
}

// ---------------------------------------------------------------------------------------------
// S3, lakehouse folders

export interface S3Target {
  bucket: string
  prefix?: string
  endpoint?: string
  region?: string
  pathStyle?: boolean
}

function s3Options(t: S3Target, withPrefix: boolean): string {
  const parts: string[] = []
  if (t.endpoint) parts.push(`Endpoint=${mString(t.endpoint)}`)
  if (t.region) parts.push(`Region=${mString(t.region)}`)
  if (t.endpoint && t.pathStyle === false) parts.push('ForcePathStyle=false')
  if (withPrefix && t.prefix) parts.push(`Prefix=${mString(t.prefix)}`)
  return parts.length ? `, [${parts.join(', ')}]` : ''
}

export async function s3Items(t: S3Target): Promise<NavItem[]> {
  const src = `AmazonS3.Contents(${mString(t.bucket)}${s3Options(t, true)})`
  const files = await evalM(`Table.SelectColumns(${src}, {"Name", "Extension", "Folder Path"})`, (v) =>
    asTable(v).rows.map((r) => ({ name: String(force(r[0]!)), ext: String(force(r[1]!)).toLowerCase(), folder: String(force(r[2]!)) }))
  )
  const items: NavItem[] = [
    mItem({ id: 'list', label: `${t.bucket}${t.prefix ? `/${t.prefix}` : ''} (file list)`, kind: 'folder', tableName: t.bucket, m: letExpr([['Source', src]]), expr: `Table.SelectColumns(${src}, {"Name", "Extension", "Date modified", "Folder Path", "Attributes"})` })
  ]
  // Delta tables in the bucket (folders holding _delta_log/)
  const deltas = [...new Set(files.filter((f) => /\/_delta_log\/$/.test(f.folder)).map((f) => f.folder.replace(/_delta_log\/$/, '').replace(/\/$/, '')))].sort()
  for (const d of deltas) {
    const name = d.split('/').pop()!
    items.push(mItem({ id: `delta:${d}`, label: name, kind: 'table', group: 'Delta tables', tableName: name, m: letExpr([['Source', `DeltaLake.Table(${mString(d)}${s3Options(t, false)})`]]) }))
  }
  const plain = files.filter((f) => !deltas.some((d) => f.folder.startsWith(`${d}/`)))
  const combine = (ext: string, label: string, body: (rows: string) => Array<[string, string]>) => {
    const n = plain.filter((f) => f.ext === ext).length
    if (n < 2) return
    items.push(mItem({ id: `combine:${ext}`, label: `${label} (${n} files)`, kind: 'query', group: 'Combine files', tableName: `${t.bucket} ${ext.slice(1)}`, m: letExpr([['Source', src], ['Files', `Table.SelectRows(Source, each [Extension] = ${mString(ext)})`], ...body('Files')]) }))
  }
  combine('.csv', 'Combined CSV files', (f) => [
    ['Tables', `Table.AddColumn(${f}, "Data", each Table.PromoteHeaders(Csv.Document([Content], [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv]), [PromoteAllScalars=true]))`],
    ['Combined', 'Table.Combine(Tables[Data])']
  ])
  combine('.parquet', 'Combined Parquet files', (f) => [['Combined', `Table.Combine(List.Transform(${f}[Content], Parquet.Document))`]])
  for (const f of plain.slice(0, 300)) {
    const at = `Source{[Name=${mString(f.name)},#"Folder Path"=${mString(f.folder)}]}[Content]`
    const doc =
      f.ext === '.csv' || f.ext === '.tsv' || f.ext === '.txt'
        ? `Table.PromoteHeaders(Csv.Document(${at}, [Delimiter=${f.ext === '.tsv' ? '"#(tab)"' : '","'}, Encoding=65001, QuoteStyle=QuoteStyle.Csv]), [PromoteAllScalars=true])`
        : f.ext === '.parquet'
          ? `Parquet.Document(${at})`
          : f.ext === '.json'
            ? `Table.FromRecords(Json.Document(${at}))`
            : null
    if (!doc) continue
    const stem = f.name.replace(/\.[^.]+$/, '')
    items.push(mItem({ id: `file:${f.folder}${f.name}`, label: `${f.folder.replace(/^s3:\/\/[^/]+\//, '')}${f.name}`, kind: 'file', group: 'Files', tableName: stem, m: letExpr([['Source', src], [stem, doc]]) }))
  }
  return items
}

export async function lakehouseItems(path: string, s3?: Omit<S3Target, 'bucket' | 'prefix'>): Promise<NavItem[]> {
  const opts = s3 && /^s3:\/\//i.test(path) ? s3Options({ bucket: '', ...s3 }, false) : ''
  const src = `Lakehouse.Folder(${mString(path)}${opts})`
  const nav = await evalM(src, (v) =>
    asTable(v).rows.map((r) => {
      const id = String(force(r[0]!))
      const kind = String(force(r[2]!))
      const children = kind === 'Schema' ? asTable(force(r[3]!)).rows.map((x) => String(force(x[0]!))) : []
      return { id, kind, children }
    })
  )
  const items: NavItem[] = []
  for (const n of nav) {
    if (n.kind === 'Table') items.push(mItem({ id: n.id, label: n.id, kind: 'table', group: 'Tables', tableName: n.id, m: navM(src, [[n.id, `Source{[Id=${mString(n.id)},ItemKind="Table"]}[Data]`]]) }))
    else if (n.kind === 'Schema')
      for (const t of n.children)
        items.push(
          mItem({
            id: `${n.id}.${t}`,
            label: t,
            kind: 'table',
            group: n.id,
            tableName: t,
            m: navM(src, [[`${n.id}_${t}`, `Source{[Id=${mString(n.id)},ItemKind="Schema"]}[Data]{[Id=${mString(t)},ItemKind="Table"]}[Data]`]])
          })
        )
    else if (n.id === 'Files')
      items.push(mItem({ id: 'Files', label: 'Files', kind: 'folder', group: 'Files', tableName: 'Files', m: navM(src, [['Files', 'Source{[Id="Files",ItemKind="Folder"]}[Data]']]) }))
  }
  return items
}

// ---------------------------------------------------------------------------------------------
// Network shares (Folder.Files on smb:// URLs), OData, templates

export function folderUrlItems(url: string, label: string): NavItem[] {
  const src = `Folder.Files(${mString(url)})`
  return [mItem({ id: url, label, kind: 'folder', tableName: label || 'Folder', m: letExpr([['Source', src]]), expr: `Table.SelectColumns(${src}, {"Name", "Extension", "Date modified", "Folder Path"})` })]
}

export async function odataItems(url: string): Promise<NavItem[]> {
  const src = `OData.Feed(${mString(url)})`
  const names = await evalM(src, (v) => {
    const t = asTable(v)
    return t.columns.join(',') === 'Name,Data,Signature' ? t.rows.map((r) => String(force(r[0]!))) : null
  })
  if (!names) return [mItem({ id: url, label: url, kind: 'table', tableName: url.split('/').pop() || 'Feed', m: letExpr([['Source', src]]) })]
  return names.map((n) => mItem({ id: n, label: n, kind: 'table', tableName: n, m: navM(src, [[n, `Source{[Name=${mString(n)},Signature="table"]}[Data]`]]) }))
}

/** JSON (from the variables box) → M literal. */
export function jsonToMText(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return mString(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `{${v.map(jsonToMText).join(', ')}}`
  return `[${Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${mIdent(k)} = ${jsonToMText(x)}`)
    .join(', ')}]`
}

/** M field access for a dotted path ("data.items" → `[data][items]`). */
export function pathAccess(path: string): string {
  return path
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `[${/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) ? p : `#${mString(p)}`}]`)
    .join('')
}

/** "From GraphQL" template: POST {query, variables}, surface GraphQL errors, table from the records at `path`. */
export function graphqlM(o: { url: string; query: string; variables?: unknown; path: string }): string {
  const body = o.variables && typeof o.variables === 'object' && Object.keys(o.variables as object).length ? `[query = Query, variables = ${jsonToMText(o.variables)}]` : '[query = Query]'
  return letExpr([
    ['Query', mString(o.query)],
    ['Response', `Json.Document(Web.Contents(${mString(o.url)}, [Headers = [#"Content-Type" = "application/json", Accept = "application/json"], Content = Json.FromValue(${body})]))`],
    ['Checked', 'if Record.HasFields(Response, "errors") and Response[errors] <> null then error Error.Record("GraphQL", Text.Combine(List.Transform(Response[errors], each [message]), "; ")) else Response'],
    ['Items', `Checked${pathAccess(o.path || 'data')}`],
    ['Table', 'if Items is list then Table.FromRecords(Items) else Table.FromRecords({Items})']
  ])
}

export type Paging = { kind: 'none' } | { kind: 'page'; param: string; start: number; sizeParam?: string; size?: number } | { kind: 'next'; field: string } | { kind: 'offset'; offsetParam: string; limitParam: string; limit: number }

/**
 * "REST API (paged)" template — Power Query patterns with List.Generate: the base URL stays a constant
 * and paging goes through Query / RelativePath options, which keeps the query refreshable.
 */
export function restM(o: { url: string; itemsPath: string; paging: Paging }): string {
  const items = (r: string) => (o.itemsPath ? `${r}${pathAccess(o.itemsPath)}` : r)
  const u = (() => {
    try {
      const x = new URL(o.url)
      const q = [...x.searchParams.entries()]
      x.search = ''
      return { base: x.toString(), query: q }
    } catch {
      return { base: o.url, query: [] as [string, string][] }
    }
  })()
  const fixed = u.query.map(([k, v]) => `${mIdent(k)} = ${mString(v)}`)
  const queryRec = (extra: string[]) => {
    const all = [...fixed, ...extra]
    return all.length ? `, [Query = [${all.join(', ')}]]` : ''
  }
  switch (o.paging.kind) {
    case 'none':
      return letExpr([
        ['Source', `Json.Document(Web.Contents(${mString(u.base)}${queryRec([])}))`],
        ['Table', `Table.FromRecords(${items('Source')})`]
      ])
    case 'page': {
      const p = o.paging
      const extra = (n: string) => [`${mIdent(p.param)} = Text.From(${n})`, ...(p.sizeParam && p.size ? [`${mIdent(p.sizeParam)} = ${mString(String(p.size))}`] : [])]
      return letExpr([
        ['GetPage', `(page as number) => Json.Document(Web.Contents(${mString(u.base)}${queryRec(extra('page'))}))`],
        ['Pages', `List.Generate(() => [n = ${p.start}, r = GetPage(${p.start})], each List.Count(${items('[r]')}) > 0, each [n = [n] + 1, r = GetPage([n] + 1)], each ${items('[r]')})`],
        ['Table', 'Table.FromRecords(List.Combine(Pages))']
      ])
    }
    case 'offset': {
      const p = o.paging
      const extra = [`${mIdent(p.offsetParam)} = Text.From(offset)`, `${mIdent(p.limitParam)} = ${mString(String(p.limit))}`]
      return letExpr([
        ['GetPage', `(offset as number) => Json.Document(Web.Contents(${mString(u.base)}${queryRec(extra)}))`],
        ['Pages', `List.Generate(() => [o = 0, r = GetPage(0)], each List.Count(${items('[r]')}) > 0, each [o = [o] + ${p.limit}, r = GetPage([o] + ${p.limit})], each ${items('[r]')})`],
        ['Table', 'Table.FromRecords(List.Combine(Pages))']
      ])
    }
    case 'next': {
      const next = pathAccess(o.paging.field).replace(/\]$/, ']?').replace(/\]\[/g, ']?[')
      return letExpr([
        ['GetPage', '(url as text) => Json.Document(Web.Contents(url))'],
        ['Pages', `List.Generate(() => GetPage(${mString(o.url)}), each _ <> null, each let n = _${next} in if n = null or n = "" then null else GetPage(n), each ${items('_')})`],
        ['Table', 'Table.FromRecords(List.Combine(Pages))']
      ])
    }
  }
}
