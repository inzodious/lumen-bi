/**
 * Data refresh: evaluate each import table's Power Query partition (with the model's shared expressions
 * and parameters in scope) through the fetch-and-replay driver, map the result columns to the model's
 * data columns by `sourceColumn`, coerce values to the column data types and load them into the DataStore.
 *
 * Like Power BI Desktop: tables refresh independently (one failure doesn't stop the others); a failed
 * table keeps the data it had; cells that evaluate to an error load as blank and are counted.
 *
 * Incremental refresh: a table with a `refreshPolicy` whose query filters on the RangeStart / RangeEnd
 * parameters loads only its rolling window, and — once it has data — only the incremental window
 * (the last N days / months / quarters / years), keeping the older rows it already has, as the Power BI
 * service does with partitions. (Power BI Desktop itself ignores the policy and loads the parameters'
 * values; Lumen applies it so large sources refresh quickly. Pass `incremental: false` to reload all.)
 */
import type { ProjectDocument } from '../project'
import type { ColumnDef, DataType, SemanticModel, TableDef } from '../model/types'
import type { Scalar, TableData } from '../model/data'
import { evaluateQuery, type ErrorInfo } from '../m/engine.ts'
import { DataCache, runWithData, type DataFetcher } from '../m/driver.ts'
import { MError } from '../m/errors.ts'
import { toDate, toDateTime, toLogical, toNumber, toText } from '../m/convert.ts'
import { Lazy, MBinary, MDate, MDateTime, MDateTimeZone, MDuration, MTable, MTime, MS_PER_DAY, kindOf, type Cell, type MValue } from '../m/values.ts'
import { mPartitionIndex, queryMap } from './queries'
import { createFetcher, privacyPlan, sourcesOfQuery, type RefreshHost } from './fetcher'
import { PREVIEW_ROW_LIMIT, QuerySession, type QueryPreview } from './preview'
import { LEGACY_SAMPLE_ANNOTATION, SAMPLE_ANNOTATION } from './sample-model'

export type { RefreshHost } from './fetcher'

export interface RefreshOptions {
  /** only these tables (default: all import tables with M / entity partitions) */
  tables?: string[]
  onProgress?: (table: string, state: 'running' | 'done' | 'error', detail?: string) => void
  signal?: AbortSignal
  /** shared fetch cache (e.g. the Power Query Editor's) */
  cache?: DataCache
  /** apply incremental refresh policies (default true) */
  incremental?: boolean
}

export interface RefreshResult {
  tables: Array<{ table: string; ok: boolean; rows?: number; error?: string; ms: number; errorCells?: number; skipped?: string; incremental?: string }>
}

// ---------------------------------------------------------------------------------------------
// Incremental refresh (refreshPolicy + RangeStart / RangeEnd)

export type PolicyGranularity = 'day' | 'month' | 'quarter' | 'year'

export interface IncrementalPolicy {
  incrementalGranularity: PolicyGranularity
  incrementalPeriods: number
  rollingWindowGranularity: PolicyGranularity
  rollingWindowPeriods: number
  /** M of the policy (service-published models keep it here instead of an M partition) */
  sourceExpression?: string
}

function granularity(v: unknown): PolicyGranularity | null {
  const g = String(v ?? '').toLowerCase()
  return g === 'day' || g === 'month' || g === 'quarter' || g === 'year' ? g : null
}

/** The table's incremental refresh policy, when it is a usable basic policy. */
export function incrementalPolicy(t: TableDef): IncrementalPolicy | null {
  const rp = t.refreshPolicy
  if (!rp) return null
  const ig = granularity(rp['incrementalGranularity'])
  const rg = granularity(rp['rollingWindowGranularity'])
  const ip = Number(rp['incrementalPeriods'])
  const rpN = Number(rp['rollingWindowPeriods'])
  if (!ig || !rg || !(ip > 0) || !(rpN > 0)) return null
  const src = rp['sourceExpression']
  return { incrementalGranularity: ig, incrementalPeriods: ip, rollingWindowGranularity: rg, rollingWindowPeriods: rpN, sourceExpression: Array.isArray(src) ? src.join('\n') : typeof src === 'string' ? src : undefined }
}

const MS_DAY = 86_400_000

function startOf(g: PolicyGranularity, ms: number): number {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  if (g === 'day') return Date.UTC(y, m, d.getUTCDate())
  if (g === 'month') return Date.UTC(y, m, 1)
  if (g === 'quarter') return Date.UTC(y, m - (m % 3), 1)
  return Date.UTC(y, 0, 1)
}

function addPeriods(g: PolicyGranularity, ms: number, n: number): number {
  const d = new Date(ms)
  if (g === 'day') return ms + n * MS_DAY
  const months = g === 'month' ? n : g === 'quarter' ? 3 * n : 12 * n
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate())
}

/**
 * Windows of a policy for a refresh at `wallNow` (ms of the local wall clock as UTC fields):
 * rolling window = the last N complete periods plus the current one; incremental window = the last N
 * periods including the current one; both end with the current incremental period.
 */
export function policyWindows(p: IncrementalPolicy, wallNow: number): { rollingStart: number; incrementalStart: number; end: number } {
  const cur = startOf(p.incrementalGranularity, wallNow)
  return {
    rollingStart: addPeriods(p.rollingWindowGranularity, startOf(p.rollingWindowGranularity, wallNow), -p.rollingWindowPeriods),
    incrementalStart: addPeriods(p.incrementalGranularity, cur, -(p.incrementalPeriods - 1)),
    end: addPeriods(p.incrementalGranularity, cur, 1)
  }
}

/** The source column filtered with RangeStart (`each [OrderDate] >= RangeStart and …`). */
export function rangeColumn(source: string): string | null {
  const m = /\[\s*([^\]]+?)\s*\]\s*>=?\s*RangeStart\b/.exec(source) ?? /\bRangeStart\s*<=?\s*\[\s*([^\]]+?)\s*\]/.exec(source)
  return m ? m[1]!.replace(/^#"(.*)"$/, '$1') : null
}

function mDateTime(ms: number): string {
  const d = new Date(ms)
  return `#datetime(${d.getUTCFullYear()}, ${d.getUTCMonth() + 1}, ${d.getUTCDate()}, 0, 0, 0) meta [IsParameterQuery=true, Type="DateTime", IsParameterQueryRequired=true]`
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Days between 1899-12-30 (Power BI's date origin, used for time-only values) and 1970-01-01. */
const OA_EPOCH_DAYS = 25569

/** M query text that loads a table, or null when the table isn't refreshable from Power Query. */
export function tableQuery(model: SemanticModel, t: TableDef): { source: string } | { error: string } | null {
  if (t.calculationGroup) return null
  const mi = mPartitionIndex(t)
  if (mi >= 0) return { source: t.partitions[mi]!.expression! }
  // published incremental-refresh tables: policyRange partitions + the policy's source expression
  const policy = incrementalPolicy(t)
  if (policy?.sourceExpression) return { source: policy.sourceExpression }
  const entity = t.partitions.find((p) => p.sourceType === 'entity')
  if (entity) {
    if (!entity.entityName) return { error: 'The entity partition has no entity name.' }
    const exprName = entity.expressionSource ?? 'DatabaseQuery'
    if (!model.expressions.some((e) => e.name === exprName)) return { error: `The partition's expression source '${exprName}' doesn't exist.` }
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`
    const ref = /^[A-Za-z_][A-Za-z0-9_]*$/.test(exprName) ? exprName : `#${q(exprName)}`
    // Direct Lake / entity partitions read the table from the expression source (usually Sql.Database on the SQL endpoint).
    return { source: `let\n    Source = ${ref},\n    Data = Source{[Schema=${q(entity.schemaName ?? 'dbo')},Item=${q(entity.entityName)}]}[Data]\nin\n    Data` }
  }
  if (t.partitions.some((p) => p.sourceType === 'query')) return { error: 'Native query (legacy provider) partitions are not supported; convert the partition to Power Query (Sql.Database with a Query option).' }
  return null
}

/** Tables refreshed by default. */
export function refreshableTables(model: SemanticModel): string[] {
  return model.tables.filter((t) => {
    const q = tableQuery(model, t)
    return q !== null
  }).map((t) => t.name)
}

function force(c: Cell): MValue {
  return c instanceof Lazy ? c.get() : c
}

/** M value → the model value contract (src/core/model/data.ts) for a column of `type`. */
export function coerceValue(v: MValue, type: DataType): Scalar {
  if (v === null) return null
  switch (type) {
    case 'string': {
      if (typeof v === 'string') return v
      if (v instanceof MBinary || v instanceof MTable || (typeof v === 'object' && !(v instanceof MDate) && !(v instanceof MDateTime) && !(v instanceof MDateTimeZone) && !(v instanceof MTime) && !(v instanceof MDuration))) {
        throw new MError('Expression.Error', `We cannot convert a value of type ${kindOf(v)} to type Text.`)
      }
      return toText(v)
    }
    case 'int64': {
      const n = toNumber(v)
      return n === null ? null : Math.round(n)
    }
    case 'double':
    case 'decimal': {
      if (v instanceof MDuration) return v.ms / MS_PER_DAY
      if (v instanceof MDate) return v.days + OA_EPOCH_DAYS
      if (v instanceof MDateTime) return v.ms / MS_PER_DAY + OA_EPOCH_DAYS
      const n = toNumber(v)
      return type === 'decimal' && n !== null ? Math.round(n * 10000) / 10000 : n
    }
    case 'boolean':
      return toLogical(v)
    case 'dateTime': {
      if (v instanceof MTime) return new Date((v.ms - OA_EPOCH_DAYS * MS_PER_DAY))
      if (v instanceof MDate) return new Date(v.days * MS_PER_DAY)
      if (v instanceof MDateTimeZone) return new Date(v.ms)
      const d = toDateTime(v)
      return d === null ? null : new Date(d.ms)
    }
    case 'binary':
      if (v instanceof MBinary) return v.bytes
      throw new MError('Expression.Error', `We cannot convert a value of type ${kindOf(v)} to type Binary.`)
    default:
      return natural(v)
  }
}

/** M value → Scalar without a target type. */
export function natural(v: MValue): Scalar {
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof MDate) return new Date(v.days * MS_PER_DAY)
  if (v instanceof MDateTime || v instanceof MDateTimeZone) return new Date(v.ms)
  if (v instanceof MTime) return new Date(v.ms - OA_EPOCH_DAYS * MS_PER_DAY)
  if (v instanceof MDuration) return v.ms / MS_PER_DAY
  if (v instanceof MBinary) return v.bytes
  throw new MError('Expression.Error', `We cannot convert a value of type ${kindOf(v)} to a column value.`)
}

/** DataType a model column should have for an M column type (used when creating tables from queries). */
export function dataTypeOfM(typeText: string): DataType {
  const t = typeText.replace(/^nullable /, '')
  if (t === 'text') return 'string'
  if (t === 'Int64.Type' || t === 'Int32.Type' || t === 'Int16.Type' || t === 'Int8.Type' || t === 'Byte.Type') return 'int64'
  if (t === 'Currency.Type' || t === 'Decimal.Type') return 'decimal'
  if (t === 'number' || t === 'Double.Type' || t === 'Single.Type' || t === 'Percentage.Type' || t === 'duration') return 'double'
  if (t === 'logical') return 'boolean'
  if (t === 'date' || t === 'datetime' || t === 'datetimezone' || t === 'time') return 'dateTime'
  if (t === 'binary') return 'binary'
  if (t === 'any') return 'string'
  return 'variant'
}

interface Loaded {
  data: TableData
  errorCells: number
}

/** Maps an evaluated M table to the model table's data columns. */
export function mapToModel(result: MTable, table: TableDef): Loaded {
  const dataCols = table.columns.filter((c) => c.kind === 'data')
  const lowerIndex = new Map(result.columns.map((c, i) => [c.toLowerCase(), i]))
  const missing: string[] = []
  const plan = dataCols.map((c: ColumnDef) => {
    const src = c.sourceColumn ?? c.name
    const idx = result.index.get(src) ?? lowerIndex.get(src.toLowerCase())
    if (idx === undefined) missing.push(src)
    return { col: c, idx: idx ?? -1 }
  })
  if (missing.length) {
    throw new MError('Expression.Error', `The ${missing.map((m) => `'${m}'`).join(', ')} column${missing.length > 1 ? 's do' : ' does'} not exist in the rowset.`, missing.join(', '))
  }
  const rows = result.rows
  let errorCells = 0
  const columns = plan.map(({ col, idx }) => {
    const values: Scalar[] = new Array(rows.length)
    for (let r = 0; r < rows.length; r++) {
      try {
        values[r] = coerceValue(force(rows[r]![idx]!), col.dataType)
      } catch (e) {
        if (!(e instanceof MError)) throw e
        values[r] = null
        errorCells++
      }
    }
    return { name: col.name, type: col.dataType, values }
  })
  return { data: { columns, rowCount: rows.length }, errorCells }
}

function errorText(e: ErrorInfo | unknown): string {
  if (e && typeof e === 'object' && 'reason' in e && 'message' in e) {
    const info = e as ErrorInfo
    return `${info.reason}: ${info.message}${info.detail && !info.message.includes(info.detail) ? ` Details: ${info.detail}` : ''}`
  }
  return e instanceof Error ? e.message : String(e)
}

async function evaluateTable(
  project: ProjectDocument,
  table: TableDef,
  source: string,
  fetch: DataFetcher,
  cache: DataCache,
  now: Date,
  offset: number,
  signal?: AbortSignal,
  overrides: Record<string, string> = {},
  foldComputed = true
): Promise<Loaded> {
  const queries = { ...queryMap(project.model), ...overrides }
  delete queries[table.name]
  return runWithData(
    (host) => {
      const ev = evaluateQuery(source, { host, queries, previewSteps: false })
      if (!ev.result.ok) throw Object.assign(new Error(errorText(ev.result.error)), { info: ev.result.error })
      const v = ev.result.value
      if (!(v instanceof MTable)) throw new Error(`Expression.Error: The query returns a ${ev.result.kind}, but only tables can be loaded to the model.`)
      try {
        return mapToModel(v, table)
      } catch (e) {
        if (e instanceof MError) throw new Error(errorText({ reason: e.reason, message: e.message, detail: typeof e.detail === 'string' ? e.detail : undefined }))
        throw e
      }
    },
    fetch,
    { cache, now, signal, localOffsetMinutes: offset, foldComputed }
  )
}

/** Mutates project.data (tables + status). Caller rebuilds the engine afterwards (`dataChanged`). */
export async function refreshProject(project: ProjectDocument, host: RefreshHost, opts: RefreshOptions = {}): Promise<RefreshResult> {
  const model = project.model
  const names = opts.tables ?? refreshableTables(model)
  const fetch = createFetcher(host)
  const cache = opts.cache ?? new DataCache()
  const now = host.now()
  const offset = host.localOffsetMinutes ?? -now.getTimezoneOffset()
  const out: RefreshResult = { tables: [] }
  for (const name of names) {
    if (opts.signal?.aborted) throw opts.signal.reason instanceof Error ? opts.signal.reason : new DOMException('Refresh cancelled', 'AbortError')
    const t0 = Date.now()
    const table = model.tables.find((t) => t.name === name)
    const fail = (message: string) => {
      out.tables.push({ table: name, ok: false, error: message, ms: Date.now() - t0 })
      if (!project.data.tables.get(name)?.rowCount) project.data.status.set(name, { state: 'error', message })
      opts.onProgress?.(name, 'error', message)
    }
    if (!table) {
      fail(`The table '${name}' doesn't exist in the model.`)
      continue
    }
    const q = tableQuery(model, table)
    if (!q) {
      fail(`The table '${name}' has no Power Query partition to refresh.`)
      continue
    }
    if ('error' in q) {
      fail(q.error)
      continue
    }
    opts.onProgress?.(name, 'running')
    project.data.status.set(name, { state: 'pending' })
    try {
      const plan = opts.incremental === false ? null : incrementalPlan(project, table, q.source, now, offset)
      const privacy = privacyPlan(sourcesOfQuery(model, q.source), host.privacy?.bind(host))
      let loaded = await evaluateTable(project, table, q.source, fetch, cache, now, offset, opts.signal, plan?.overrides, privacy.foldComputed)
      let incremental: string | undefined
      if (plan) {
        const merged = plan.merge(loaded.data)
        loaded = { data: merged.data, errorCells: loaded.errorCells }
        incremental = merged.note
      }
      const prev = project.data.tables.get(name)
      // Sample tables declare only their schema in M: keep their generated rows.
      if ((table.annotations?.[SAMPLE_ANNOTATION] === 'true' || table.annotations?.[LEGACY_SAMPLE_ANNOTATION] === 'true') && loaded.data.rowCount === 0 && prev && prev.rowCount > 0) {
        project.data.status.set(name, { state: 'loaded', source: 'import', rowCount: prev.rowCount })
        out.tables.push({ table: name, ok: true, rows: prev.rowCount, ms: Date.now() - t0, skipped: 'sample data kept' })
        opts.onProgress?.(name, 'done', `${prev.rowCount.toLocaleString()} sample rows kept`)
        continue
      }
      project.data.tables.set(name, loaded.data)
      project.data.status.set(name, { state: 'loaded', source: 'query', at: new Date().toISOString(), rowCount: loaded.data.rowCount })
      out.tables.push({ table: name, ok: true, rows: loaded.data.rowCount, ms: Date.now() - t0, errorCells: loaded.errorCells || undefined, incremental })
      opts.onProgress?.(name, 'done', `${loaded.data.rowCount.toLocaleString()} rows loaded${incremental ? ` — ${incremental}` : ''}${loaded.errorCells ? ` (${loaded.errorCells.toLocaleString()} errors loaded as blank)` : ''}`)
    } catch (e) {
      if (opts.signal?.aborted) {
        const prev = project.data.tables.get(name)
        if (prev) project.data.status.set(name, { state: 'loaded', source: 'query', rowCount: prev.rowCount })
        else project.data.status.set(name, { state: 'empty', reason: 'Refresh cancelled' })
        throw e
      }
      const prev = project.data.tables.get(name)
      if (prev) project.data.status.set(name, { state: 'loaded', source: 'query', rowCount: prev.rowCount })
      fail(e instanceof Error ? e.message : String(e))
    }
  }
  return out
}

interface IncrementalPlan {
  overrides: Record<string, string>
  merge(fresh: TableData): { data: TableData; note: string }
}

/**
 * How to refresh a table with an incremental policy: the RangeStart / RangeEnd values to evaluate with,
 * and how to merge the result with the rows already loaded. Null when the table has no usable policy.
 */
export function incrementalPlan(project: ProjectDocument, table: TableDef, source: string, now: Date, offsetMinutes: number): IncrementalPlan | null {
  const policy = incrementalPolicy(table)
  if (!policy) return null
  const params = new Set(project.model.expressions.map((e) => e.name))
  if (!params.has('RangeStart') || !params.has('RangeEnd') || !/\bRangeStart\b/.test(source)) return null
  const wallNow = now.getTime() + offsetMinutes * 60_000
  const w = policyWindows(policy, wallNow)
  const prev = project.data.tables.get(table.name)
  const srcCol = rangeColumn(source)
  const modelCol = srcCol ? table.columns.find((c) => c.kind === 'data' && (c.sourceColumn ?? c.name).toLowerCase() === srcCol.toLowerCase()) : undefined
  const prevCol = modelCol && prev ? prev.columns.find((c) => c.name === modelCol.name) : undefined
  const canMerge = !!prev && prev.rowCount > 0 && !!prevCol && prevCol.type === 'dateTime'
  const start = canMerge ? w.incrementalStart : w.rollingStart
  const overrides = { RangeStart: mDateTime(start), RangeEnd: mDateTime(w.end) }
  return {
    overrides,
    merge(fresh) {
      if (!canMerge || !prev || !prevCol) return { data: fresh, note: `rolling window ${isoDay(w.rollingStart)} – ${isoDay(w.end - MS_DAY)} loaded` }
      // keep the archived rows: inside the rolling window, before the refreshed incremental window
      const keep: number[] = []
      for (let r = 0; r < prev.rowCount; r++) {
        const v = prevCol.values[r]
        const ms = v instanceof Date ? v.getTime() : null
        if (ms !== null && ms >= w.rollingStart && ms < w.incrementalStart) keep.push(r)
      }
      const columns = fresh.columns.map((c) => {
        const old = prev.columns.find((x) => x.name === c.name)
        return { ...c, values: [...keep.map((r) => (old ? old.values[r]! : null)), ...c.values] }
      })
      return {
        data: { columns, rowCount: keep.length + fresh.rowCount },
        note: `incremental: ${isoDay(w.incrementalStart)} – ${isoDay(w.end - MS_DAY)} refreshed (${fresh.rowCount.toLocaleString()} rows), ${keep.length.toLocaleString()} archived rows kept`
      }
    }
  }
}

/** Refresh one table. */
export async function refreshTable(project: ProjectDocument, host: RefreshHost, table: string, opts: Omit<RefreshOptions, 'tables'> = {}): Promise<RefreshResult['tables'][number]> {
  const r = await refreshProject(project, host, { ...opts, tables: [table] })
  return r.tables[0]!
}

/** Preview any M query text of the project (one-off; the Power Query Editor keeps a QuerySession instead). */
export async function previewQuery(project: ProjectDocument, host: RefreshHost, source: string, opts: { name?: string; step?: string; rowLimit?: number; signal?: AbortSignal } = {}): Promise<QueryPreview> {
  return new QuerySession(project, host).preview({ source, name: opts.name, step: opts.step, rowLimit: opts.rowLimit ?? PREVIEW_ROW_LIMIT, signal: opts.signal })
}
