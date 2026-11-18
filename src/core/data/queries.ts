/**
 * Power Query "queries" view of a semantic model, used by the Power Query Editor and by refresh.
 *
 * In Power BI Desktop every M partition of an import table is a query named after the table, and every
 * shared expression (expressions.tmdl) is a query too: a parameter (`"x" meta [IsParameterQuery=true, …]`),
 * a function (`(a) => …`) or a plain query that is not loaded to the model. Queries can reference each
 * other by name. This module lists them and finds the data sources they read.
 */
import type { NamedExpressionDef, SemanticModel, TableDef } from '../model/types'
import { parseExpression } from '../m/parser.ts'
import type { Expr } from '../m/ast.ts'

export type QueryKind = 'table' | 'parameter' | 'function' | 'query'

export interface ParameterInfo {
  /** PBI parameter Type ("Text", "Date", "Number", "Any", …) from the meta record */
  type?: string
  required?: boolean
  /** literal current value when it is a simple literal (text / number / logical / #date…) */
  valueText: string
  /** `List = {…}` suggested values (raw M text of each item) */
  allowedValues?: string[]
}

export interface QueryItem {
  /** query name: table name for table partitions, expression name for shared expressions */
  name: string
  kind: QueryKind
  /** query group ("Parameters", "Dimension", …) — partition.queryGroup / expression.queryGroup */
  group?: string
  /** M source text */
  source: string
  /** for kind 'table': the model table and the partition index holding the M */
  table?: string
  partitionIndex?: number
  /** loaded to the model (tables) — shared expressions are never loaded */
  loadEnabled: boolean
  description?: string
  parameter?: ParameterInfo
}

const PARAM_RE = /\bmeta\s*\[[^\]]*IsParameterQuery\s*=\s*true/i

function looksLikeFunction(src: string): boolean {
  try {
    const e = parseExpression(src)
    return e.t === 'func' || (e.t === 'meta' && e.expr.t === 'func')
  } catch {
    return /^\s*\(\s*[^)]*\)\s*(as\s+[\w.]+\s*)?=>/.test(src)
  }
}

/** `"value" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true, List={…}]` */
export function parameterInfo(src: string): ParameterInfo | undefined {
  if (!PARAM_RE.test(src)) return undefined
  const m = /\bmeta\s*\[/i.exec(src)
  const valueText = m ? src.slice(0, m.index).trim() : src.trim()
  const meta = m ? src.slice(m.index) : ''
  const type = /\bType\s*=\s*"([^"]*)"/i.exec(meta)?.[1]
  const required = /IsParameterQueryRequired\s*=\s*true/i.test(meta)
  const list = /\bList\s*=\s*\{([^}]*)\}/i.exec(meta)?.[1]
  const allowedValues = list ? splitTopLevel(list) : undefined
  return { type, required, valueText, allowedValues }
}

function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  let inStr = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (inStr) {
      cur += c
      if (c === '"') {
        if (s[i + 1] === '"') cur += s[++i]
        else inStr = false
      }
      continue
    }
    if (c === '"') inStr = true
    if (c === '(' || c === '[' || c === '{') depth++
    if (c === ')' || c === ']' || c === '}') depth--
    if (c === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

export function expressionKind(e: NamedExpressionDef): QueryKind {
  if (parameterInfo(e.expression)) return 'parameter'
  if (looksLikeFunction(e.expression)) return 'function'
  return 'query'
}

/** Tables whose data comes from Power Query (import/dual M partitions). */
export function mPartitionIndex(t: TableDef): number {
  if (t.calculationGroup) return -1
  return t.partitions.findIndex((p) => p.sourceType === 'm' && p.mode !== 'directLake' && typeof p.expression === 'string')
}

/** Every query of the model in Power Query Editor order: table queries then shared expressions (stable model order). */
export function listQueries(model: SemanticModel): QueryItem[] {
  const out: QueryItem[] = []
  for (const t of model.tables) {
    const i = mPartitionIndex(t)
    if (i < 0) continue
    const p = t.partitions[i]!
    out.push({ name: t.name, kind: 'table', group: p.queryGroup, source: p.expression ?? '', table: t.name, partitionIndex: i, loadEnabled: true, description: t.description })
  }
  for (const e of model.expressions) {
    if (e.kind !== 'm') continue
    const kind = expressionKind(e)
    out.push({ name: e.name, kind, group: e.queryGroup, source: e.expression, loadEnabled: false, description: e.description, parameter: kind === 'parameter' ? parameterInfo(e.expression) : undefined })
  }
  return out
}

/** name → M source of every query (for cross-query references during evaluation). */
export function queryMap(model: SemanticModel): Record<string, string> {
  const out: Record<string, string> = {}
  for (const q of listQueries(model)) out[q.name] = q.source
  return out
}

// ---------------------------------------------------------------------------------------------
// Data sources (Data source settings / credentials)

export type DataSourceRef =
  | { kind: 'sql'; server: string; database?: string }
  | { kind: 'file'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'web'; url: string }
  | { kind: 'odata'; url: string }
  | { kind: 'other'; func: string; detail?: string }
  // connectors (PostgreSQL.Database, MySQL.Database, SQLite.Database, Firestore.*, AmazonS3.Contents, Lakehouse.Folder)
  | { kind: 'postgresql' | 'mysql'; server: string; database?: string }
  | { kind: 'sqlite'; path: string }
  | { kind: 'duckdb'; path: string }
  | { kind: 'firestore'; project: string }
  | { kind: 's3'; bucket?: string; endpoint?: string }
  | { kind: 'lakehouse'; path: string }

export function dataSourceKey(s: DataSourceRef): string {
  switch (s.kind) {
    case 'sql':
      return `sql:${s.server.toLowerCase()}${s.database ? `;${s.database.toLowerCase()}` : ''}`
    case 'file':
    case 'folder':
      return `${s.kind}:${s.path}`
    case 'web':
    case 'odata':
      return `${s.kind}:${s.url}`
    case 'postgresql':
    case 'mysql':
      return `${s.kind}:${s.server.toLowerCase()}${s.database ? `;${s.database.toLowerCase()}` : ''}`
    case 'sqlite':
    case 'duckdb':
    case 'lakehouse':
      return `${s.kind}:${s.path}`
    case 'firestore':
      return `firestore:${s.project}`
    case 's3':
      return `s3:${(s.endpoint || 'aws').toLowerCase().replace(/\/+$/, '')}${s.bucket ? `;${s.bucket}` : ''}`
    default:
      return `other:${s.func}:${s.detail ?? ''}`
  }
}

export function dataSourceLabel(s: DataSourceRef): string {
  switch (s.kind) {
    case 'sql':
      return s.database ? `${s.server};${s.database}` : s.server
    case 'file':
    case 'folder':
      return s.path
    case 'web':
    case 'odata':
      return s.url
    case 'postgresql':
    case 'mysql':
      return s.database ? `${s.server};${s.database}` : s.server
    case 'sqlite':
    case 'duckdb':
    case 'lakehouse':
      return s.path
    case 'firestore':
      return s.project
    case 's3':
      return `${s.endpoint || 'Amazon S3'}${s.bucket ? `/${s.bucket}` : ''}`
    default:
      return s.detail ? `${s.func}(${s.detail})` : s.func
  }
}

/**
 * Keys under which credentials for a source are looked up, most specific first (PBI lets a credential
 * cover a whole server, bucket endpoint or URL prefix; web prefixes are matched by the credential store).
 */
export function credentialKeysOf(s: DataSourceRef): string[] {
  const keys = [dataSourceKey(s)]
  if ((s.kind === 'sql' || s.kind === 'postgresql' || s.kind === 'mysql') && s.database) keys.push(dataSourceKey({ ...s, database: undefined }))
  if (s.kind === 's3' && s.bucket) keys.push(dataSourceKey({ kind: 's3', endpoint: s.endpoint }))
  return keys
}

const SOURCE_FUNCS: Record<string, (args: string[]) => DataSourceRef | null> = {
  'Sql.Database': (a) => (a[0] ? { kind: 'sql', server: a[0], database: a[1] } : null),
  'Sql.Databases': (a) => (a[0] ? { kind: 'sql', server: a[0] } : null),
  'File.Contents': (a) => (a[0] ? { kind: 'file', path: a[0] } : null),
  'Folder.Files': (a) => (a[0] ? { kind: 'folder', path: a[0] } : null),
  'Folder.Contents': (a) => (a[0] ? { kind: 'folder', path: a[0] } : null),
  'Web.Contents': (a) => (a[0] ? { kind: 'web', url: a[0] } : null),
  'OData.Feed': (a) => (a[0] ? { kind: 'odata', url: a[0] } : null),
  'PostgreSQL.Database': (a) => (a[0] ? { kind: 'postgresql', server: a[0], database: a[1] } : null),
  'MySQL.Database': (a) => (a[0] ? { kind: 'mysql', server: a[0], database: a[1] } : null),
  'SQLite.Database': (a) => (a[0] ? { kind: 'sqlite', path: a[0] } : null),
  'DuckDB.Database': (a) => (a[0] ? { kind: 'duckdb', path: a[0] } : null),
  'Firestore.Collections': (a) => (a[0] ? { kind: 'firestore', project: a[0] } : null),
  'Firestore.Query': (a) => (a[0] ? { kind: 'firestore', project: a[0] } : null),
  'AmazonS3.Contents': (a) => (a[0] ? { kind: 's3', bucket: a[0].replace(/^s3:\/\//i, '').replace(/\/.*$/, '') } : null),
  'Lakehouse.Folder': (a) => (a[0] ? (/^s3:\/\//i.test(a[0]) ? { kind: 's3', bucket: a[0].slice(5).split('/')[0] } : { kind: 'lakehouse', path: a[0] }) : null),
  'DeltaLake.Table': (a) => (a[0] && /^s3:\/\//i.test(a[0]) ? { kind: 's3', bucket: a[0].slice(5).split('/')[0] } : a[0] ? { kind: 'folder', path: a[0] } : null)
}

/** `[Endpoint="…"]` of an options record argument (literal only). */
function endpointOption(e: Expr | undefined): string | undefined {
  if (!e || e.t !== 'record') return undefined
  const f = e.fields.find((x) => x.name === 'Endpoint')
  return f && f.expr.t === 'literal' && typeof f.expr.value === 'string' ? f.expr.value.replace(/\/+$/, '') : undefined
}

const OTHER_SOURCES = ['Lakehouse.Contents', 'Fabric.Warehouse', 'PowerBI.Dataflows', 'PowerPlatform.Dataflows', 'SharePoint.Files', 'SharePoint.Contents', 'SharePoint.Tables', 'AzureStorage.DataLake', 'AzureStorage.Blobs', 'Odbc.DataSource', 'OleDb.DataSource']

/**
 * Data sources referenced by the model's queries. Arguments that are parameter names are resolved to
 * the parameter's literal value when possible (`Sql.Database(p_server, p_db)`).
 */
export function dataSourcesOf(model: SemanticModel, only?: string[]): Array<DataSourceRef & { queries: string[] }> {
  const queries = listQueries(model)
  const params = new Map<string, string>()
  for (const q of queries) {
    if (q.kind !== 'parameter' || !q.parameter) continue
    const m = /^"((?:[^"]|"")*)"$/.exec(q.parameter.valueText)
    if (m) params.set(q.name, m[1]!.replace(/""/g, '"'))
  }
  const found = new Map<string, DataSourceRef & { queries: string[] }>()
  const add = (ref: DataSourceRef, query: string) => {
    const key = dataSourceKey(ref)
    const cur = found.get(key)
    if (cur) {
      if (!cur.queries.includes(query)) cur.queries.push(query)
    } else found.set(key, { ...ref, queries: [query] })
  }
  for (const q of queries) {
    if (only && !only.includes(q.name)) continue
    let expr: Expr
    try {
      expr = parseExpression(q.source)
    } catch {
      continue
    }
    visit(expr, (callee, args) => {
      const mk = SOURCE_FUNCS[callee]
      if (mk) {
        const vals = args.map((a) => (a.t === 'literal' && typeof a.value === 'string' ? a.value : a.t === 'ident' ? (params.get(a.name) ?? null) : null))
        if (vals[0] == null) return
        const ref = mk(vals.map((v) => v ?? ''))
        if (ref) {
          if (ref.kind === 's3') {
            const endpoint = endpointOption(args[1])
            if (endpoint) ref.endpoint = endpoint
          }
          if ((ref.kind === 'sql' || ref.kind === 'postgresql' || ref.kind === 'mysql') && !ref.database) delete ref.database
          add(ref, q.name)
        }
      } else if (OTHER_SOURCES.includes(callee)) add({ kind: 'other', func: callee }, q.name)
    })
  }
  return [...found.values()]
}

function visit(e: unknown, onCall: (callee: string, args: Expr[]) => void): void {
  if (!e || typeof e !== 'object') return
  if (Array.isArray(e)) {
    for (const x of e) visit(x, onCall)
    return
  }
  const node = e as Expr
  if (node.t === 'invoke' && node.callee.t === 'ident') onCall(node.callee.name, node.args)
  for (const [k, v] of Object.entries(node)) if (k !== 'pos' && k !== 'span' && v && typeof v === 'object') visit(v, onCall)
}
