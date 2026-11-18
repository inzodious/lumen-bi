/**
 * Declarative schema for lakehouse tables (silver + gold), bronze sources, data-quality issues,
 * semantic-model metadata and the `Universe` contract every dataset implements.
 *
 * A universe is static metadata (tables, sources, issues, measures, report) plus a `generate`
 * function that yields `Batch`es: the first batch normally carries dimensions, then one batch per
 * simulated month carries fact rows and bronze files. Batches keep memory bounded at large scale.
 */
import type { DataType, SummarizeBy } from '../../../src/core/model/types.ts'
import type { Scalar, TableData } from '../../../src/core/model/data.ts'
import type { HolidayRule } from './calendar.ts'
import type { Rng } from './prng.ts'

// ---------------------------------------------------------------------------------------------
// Columns & tables

export type ColKind = 'string' | 'int' | 'double' | 'decimal' | 'bool' | 'date' | 'timestamp'

export interface ColumnModelOpts {
  /** Display name in the semantic model (default: `label(name)`). */
  label?: string
  format?: string
  summarize?: SummarizeBy
  /** Source column name of the sort-by column. */
  sortBy?: string
  folder?: string
  hidden?: boolean
  /** Power BI data category (City, Country, Latitude, Longitude, WebUrl, ImageUrl...). */
  category?: string
  /** Leave this column out of the semantic model. */
  exclude?: boolean
}

export interface ColumnSpec extends ColumnModelOpts {
  name: string
  kind: ColKind
  description: string
  /** default true */
  nullable?: boolean
}

export interface ForeignKey {
  column: string
  /** referenced table name (e.g. 'gold_dim_store') */
  table: string
  /** referenced column (default: the referenced table's first key column) */
  refColumn?: string
  /** role-playing name, e.g. 'Ship Date' — documentation only */
  role?: string
  /** create the model relationship as inactive (role-playing; use USERELATIONSHIP) */
  inactive?: boolean
  /** bidirectional cross-filter (bridge tables) */
  bidirectional?: boolean
  /** relationship cardinality when not many-to-one, e.g. one-to-one */
  oneToOne?: boolean
  /** skip in the semantic model (still validated for integrity) */
  noModel?: boolean
  /** the column may be null (no integrity violation for nulls) */
  nullable?: boolean
}

export interface HierarchySpec {
  name: string
  /** source column names, top to bottom */
  levels: string[]
}

export interface ModelTableOpts {
  /** table name in the semantic model, e.g. 'Store' */
  name: string
  description?: string
  hidden?: boolean
  hierarchies?: HierarchySpec[]
  /** marks the model table as the date table (dataCategory Time, key column = this) */
  dateColumn?: string
}

export type TableLayer = 'silver' | 'gold'
export type TableKind = 'dim' | 'fact' | 'bridge' | 'entity' | 'aggregate'
export type FactType = 'transaction' | 'periodic snapshot' | 'accumulating snapshot' | 'factless'

export interface Scd2Spec {
  businessKey: string
  from: string
  to: string
  current: string
}

export interface TableSpec {
  name: string
  layer: TableLayer
  kind: TableKind
  factType?: FactType
  description: string
  grain: string
  columns: ColumnSpec[]
  /** columns that uniquely identify a row (grain) */
  key: string[]
  fks?: ForeignKey[]
  /** Delta-partition by the year of this date/timestamp column (adds partition column `year`). */
  partitionByYearOf?: string
  scd2?: Scd2Spec
  /** gold tables only: include in the semantic model */
  model?: ModelTableOpts
}

/** Column helper: `c('store_key', 'int', 'Surrogate key of the store', { hidden: true })`. */
export function c(name: string, kind: ColKind, description: string, opts: Omit<ColumnSpec, 'name' | 'kind' | 'description'> = {}): ColumnSpec {
  return { name, kind, description, ...opts }
}

export function kindToDataType(kind: ColKind): DataType {
  switch (kind) {
    case 'string':
      return 'string'
    case 'int':
      return 'int64'
    case 'double':
      return 'double'
    case 'decimal':
      return 'decimal'
    case 'bool':
      return 'boolean'
    case 'date':
    case 'timestamp':
      return 'dateTime'
  }
}

const ACRONYMS: Record<string, string> = {
  id: 'ID', sku: 'SKU', nps: 'NPS', pos: 'POS', kpi: 'KPI', usd: 'USD', mw: 'MW', mwh: 'MWh', kwh: 'kWh', kw: 'kW',
  ppa: 'PPA', sla: 'SLA', mrr: 'MRR', arr: 'ARR', ltv: 'LTV', iso: 'ISO', ytd: 'YTD', eta: 'ETA', etd: 'ETD',
  gl: 'GL', hr: 'HR', vip: 'VIP', ev: 'EV', co2: 'CO2', ph: 'pH', ec: 'EC', ppm: 'PPM', led: 'LED', rpm: 'RPM',
  qa: 'QA', url: 'URL', ui: 'UI', dli: 'DLI', vpd: 'VPD', ar: 'AR', ap: 'AP', pct: '%', kg: 'kg', t: 't',
  rf: 'RF', ksi: 'kSI', mj: 'MJ', gj: 'GJ', kev: 'keV', ms: 'ms', au: 'AU', km: 'km', gpu: 'GPU', cpu: 'CPU', sqft: 'Sq Ft'
}

/** snake_case source column → Title Case model name ("net_amount" → "Net Amount", "nps_score" → "NPS Score"). */
export function label(name: string): string {
  return name
    .split('_')
    .filter((p) => p.length > 0)
    .map((p) => ACRONYMS[p] ?? (/^\d/.test(p) ? p : p[0].toUpperCase() + p.slice(1)))
    .join(' ')
}

export function modelColumnName(col: ColumnSpec): string {
  return col.label ?? label(col.name)
}

// ---------------------------------------------------------------------------------------------
// Bronze

export type BronzeValue = string | number | boolean | null | Date | BronzeValue[] | { [k: string]: BronzeValue }
export type BronzeRow = Record<string, BronzeValue>
export type BronzeFormat = 'csv' | 'json' | 'ndjson' | 'xlsx'

export interface CsvOptions {
  delimiter?: string
  bom?: boolean
  quoteAll?: boolean
  lineEnding?: '\n' | '\r\n'
  /** text written for null values (default: empty) */
  nullAs?: string
}

export interface BronzeFile {
  /** source id (matches a BronzeSourceDoc) */
  source: string
  /** path relative to `Files/bronze/` */
  path: string
  format: BronzeFormat
  rows: BronzeRow[]
  /** header order (csv/xlsx); default = union of row keys in first-seen order */
  columns?: string[]
  csv?: CsvOptions
  /** JSON: wrap rows in an API-style envelope; `rows` goes under `dataKey` */
  json?: { envelope?: Record<string, BronzeValue>; dataKey?: string; pretty?: boolean }
  /** XLSX: sheet name and optional title lines above the header row */
  xlsx?: { sheet: string; titleLines?: string[] }
}

export interface BronzeSourceDoc {
  id: string
  /** fictional upstream system, e.g. "OrbitPOS v3 till export" */
  system: string
  /** path pattern under Files/bronze, e.g. "pos/YYYY/MM/DD/transactions_YYYYMMDD.csv" */
  pattern: string
  format: BronzeFormat
  cadence: string
  description: string
}

export type IssueKind =
  | 'duplicates'
  | 'nulls'
  | 'whitespace'
  | 'casing'
  | 'mixed_date_formats'
  | 'orphan_keys'
  | 'outliers'
  | 'late_arriving'
  | 'schema_drift'
  | 'sentinel_values'
  | 'formatted_numbers'

export interface IssueDoc {
  code: string
  kind: IssueKind
  /** bronze source id */
  source: string
  column?: string
  description: string
  /** how to clean it (what silver does) */
  fix: string
  /** orphan_keys: the reference set (silver/gold table + column). Values are compared trimmed + upper-cased. */
  ref?: { table: string; column: string }
  /** sentinel_values: the sentinels planted */
  sentinels?: string[]
  /** outliers: 'negative' = values < 0; 'extreme' = values > 10x the column median */
  rule?: 'negative' | 'extreme'
  /** late_arriving: the event-date column compared with the file's partition date */
  dateColumn?: string
}

// ---------------------------------------------------------------------------------------------
// Semantic model & report

export interface MeasureSpec {
  name: string
  expr: string
  format?: string
  /** dynamic format string (DAX returning a format string) */
  formatExpr?: string
  folder?: string
  description?: string
  hidden?: boolean
}

export interface FieldParameterSpec {
  name: string
  /** label + DAX reference, e.g. { label: 'Region', ref: "'Store'[Region]" } */
  fields: Array<{ label: string; ref: string }>
}

export interface FieldRef {
  table: string
  column: string
}

export type VisualSpec =
  | { type: 'card'; measure: string; title?: string }
  | { type: 'column' | 'bar'; category: FieldRef; measures: string[]; title?: string }
  | { type: 'line'; category: FieldRef; measures: string[]; title?: string }
  | { type: 'matrix'; rows: FieldRef[]; columns?: FieldRef[]; measures: string[]; title?: string }
  | { type: 'table'; columns: FieldRef[]; measures: string[]; title?: string }
  | { type: 'slicer'; field: FieldRef; mode?: 'Dropdown' | 'Basic'; title?: string }

export interface ReportPageSpec {
  name: string
  visuals: VisualSpec[]
}

export interface AnalysisIdea {
  title: string
  question: string
  /** measures/visuals/technique hints */
  how: string
}

// ---------------------------------------------------------------------------------------------
// Generation

export type ScaleName = 'tiny' | 'small' | 'large'

export interface ScaleSpec {
  name: ScaleName
  /** years of history ending on `today` (start = Jan 1 of the first year) */
  years: number
  /** multiplier applied to "small" volumes */
  factor: number
}

export const SCALES: Record<ScaleName, ScaleSpec> = {
  tiny: { name: 'tiny', years: 1, factor: 0.1 },
  small: { name: 'small', years: 3, factor: 1 },
  large: { name: 'large', years: 3, factor: 30 }
}

export type Row = Record<string, Scalar>

export interface Batch {
  /** e.g. 'static', '2025-03', 'closing' */
  label: string
  tables: Record<string, Row[]>
  bronze?: BronzeFile[]
}

export interface GenContext {
  seed: number
  scale: ScaleSpec
  /** last day of history (inclusive) */
  today: Date
  /** first day of history (Jan 1) */
  start: Date
  /** dim_date range end (Dec 31 of today's year) */
  calendarEnd: Date
  /** true at `tiny` scale: universes shrink entity counts so total gold rows stay < 5k */
  tiny: boolean
  /** independent deterministic stream per label */
  rng(label: string): Rng
  /** scale a "small" volume: max(min, round(n * factor)) */
  n(small: number, min?: number): number
  /** record that `count` instances of a documented bronze issue were planted */
  issue(code: string, count?: number): void
}

export interface Universe {
  /** CLI id, lowercase, e.g. 'starlite' */
  id: string
  /** company name, e.g. 'Starlite Coffee Co.' */
  company: string
  /** PascalCase artifact base name, e.g. 'Starlite' → Starlite.Lakehouse / Starlite.SemanticModel */
  name: string
  tagline: string
  /** markdown: story & premise */
  premise: string
  /** analytic shapes this universe showcases (README gallery) */
  shapes: string[]
  fiscalYearStartMonth: number
  holidays: HolidayRule[]
  /** include gold_dim_time (15-minute grain) */
  timeDim?: boolean
  sources: BronzeSourceDoc[]
  issues: IssueDoc[]
  /** silver + gold tables (gold_dim_date / gold_dim_time are added by the framework) */
  tables: TableSpec[]
  measures: MeasureSpec[]
  fieldParameter?: FieldParameterSpec
  report: ReportPageSpec[]
  analyses: AnalysisIdea[]
  /** optional extra README markdown (appended after the analyses) */
  notes?: string
  generate(ctx: GenContext): Iterable<Batch>
  /**
   * Reconciliation invariants over the collected tables (line items sum to headers, stock
   * reconciles, budgets tie out...). Returns human-readable violations (empty = OK).
   */
  invariants?(tables: Map<string, TableData>): string[]
}
