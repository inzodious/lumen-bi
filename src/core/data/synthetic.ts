/**
 * Schema-driven synthetic data so reports render meaningfully when the real source is unreachable.
 *
 * generateSyntheticData(project, opts) fills `project.data` for every import table that has no data:
 *  - deterministic (mulberry32 seeded per table/column — same seed → identical output, and adding a
 *    table does not perturb the values of the others);
 *  - relationship-consistent: key columns linked by relationships share one "key domain" (a value
 *    sequence). Tables on the one side take a prefix of that sequence as unique keys; many-side
 *    columns draw (Zipf-skewed) from the smallest one-side prefix, so every FK value exists in every
 *    related dimension (snowflakes, cycles, inactive and bidirectional relationships included);
 *  - date tables get a contiguous calendar (Jan 1 of Y-(years-1) … Dec 31 of Y) with derived columns
 *    (year, month name, quarter, fiscal_*, week, flags...) by name heuristics; fact dates are drawn
 *    with trend + seasonality + weekday dip and never lie after `today`;
 *  - non-key columns follow column-name/type heuristics (names, emails, places, statuses, money,
 *    counts, durations, rates, scores, flags, dates with created ≤ modified ordering...);
 *  - value domains mined from DAX and report filters (see ./synthetic-mine.ts) dominate the columns
 *    they refer to, so measures such as CALCULATE(SUM(f[amount]), f[stage] = "Won") are non-blank;
 *  - report-aware: mined date literals (slicers, filters, DAX DATE()) extend the calendar and get a
 *    realistic number of fact rows; mined *conjunctions* (one CALCULATE's filters, nested measure
 *    filters, report + page + slicer + visual filters around a visual's measures) are seeded so enough
 *    rows satisfy all conditions at once, across relationships (dimension rows are generated first);
 *  - periodic-snapshot facts (snapshot / as-of / report-date columns, snapshot-ish table names) get
 *    month-end (or weekly / daily) snapshot days, every mined snapshot date included, with one row per
 *    entity per day;
 *  - every dimension member referenced by a fact has fact rows (facts grow when a dimension is large);
 *  - calculated tables that combine imported tables (UNION / SELECTCOLUMNS / FILTER…, see
 *    ./synthetic-lineage.ts) are traced to their source columns: a relationship, a mined value or a
 *    conjunction on the calculated table applies to the imported columns it is computed from, so its keys
 *    match the dimensions it is related to. A "one"-side key is unique whatever its other end is;
 *  - survey-style columns are realistic: ratings / scores / likelihood-to-recommend answers are skewed to
 *    the top of their scale (surveyWeights), correlated within a row and drifting slowly over time; answer
 *    labels (Promoter / Detractor, Satisfied / Dissatisfied…) are mostly positive, and a promoter / passive /
 *    detractor group column follows the score of its row — net-promoter style measures come out positive
 *    and period-over-period variances stay sane;
 *  - a calendar whose M query stops at the current date ends today.
 *
 * Privacy: nothing is read but the model and report *definitions*. Values that come from them:
 *  (1) rows of "Enter data" tables and of DATATABLE / table-constructor calculated tables (the model's own
 *      embedded rows, verbatim); (2) literals that DAX or report filters / slicers / bookmarks compare a
 *      column to, when the column is a category, status, flag, number, threshold or date; (3) generic
 *      placeholders ("Unknown", "N/A"). Literals compared to name-like, id-like and free-text columns
 *      (people, organisations, e-mail, phone, address, ids, GUIDs, notes — isIdentifyingColumn) are never
 *      copied (an invented non-key value that happens to equal one is replaced), unless
 *      `identifyingLiterals: 'reuse'` is passed; the result lists the columns concerned (`withheld`,
 *      counts only).
 *
 * Skipped (see SyntheticResult.skipped): calculated tables (the DAX engine computes them in
 * processCalculated), calculation-group tables, tables without stored columns, calculated / rowNumber
 * columns. "Enter data" tables are decoded from their embedded rows instead of being invented (empty
 * ones such as measure-holder tables → 0 rows).
 *
 * Approximations (documented gaps): calculated date tables (CALENDAR(...)) are not evaluated here, so
 * fact dates related to them use the default range; key domains are shared per relationship
 * component, so two one-side tables of different sizes in one component nest (smaller ⊂ larger)
 * rather than being independent; cross-table value correlations (e.g. fact date ≥ dimension
 * created date) are not modelled; the size of each feed of a combined calculated table is a heuristic
 * (readLineageHints); a calculated table that cannot be traced (joins, GENERATE, SUMMARIZECOLUMNS over
 * several tables) constrains nothing.
 */
import type { ColumnDef, DataType, SemanticModel, TableDef } from '../model/types'
import { makeDate, type ColumnData, type Scalar, type TableData } from '../model/data'
import type { ProjectDocument } from '../project'
import {
  calculatedTableLiterals,
  domainKey,
  isCalculatedTable,
  isCalculationGroupTable,
  mineModel,
  type Conjunction,
  type Implication,
  type MinedDomain
} from './synthetic-mine'
import { decodeEnterDataTable, isEnterDataPartition } from './synthetic-enterdata'
import { modelLineage, type LineageBranch } from './synthetic-lineage'
import {
  CATEGORICAL_TOKENS,
  COMPANY_NAME_COUNT,
  singular,
  CATEGORY_POOLS,
  COUNTRIES,
  FREE_TEXT_TOKENS,
  ORG_TOKENS,
  PERSON_TOKENS,
  Rng,
  US_CITIES,
  US_STATES,
  WeightedSampler,
  addDays,
  calendarValue,
  coerceTo,
  isWeekEndName,
  companyName,
  dayDiff,
  entityOf,
  guidFrom,
  hash32,
  isPlaceholderLabel,
  loremSentence,
  normalCdf,
  npsBandOf,
  sentimentOf,
  surveyWeights,
  pad,
  personName,
  streetAddress,
  titleCase,
  tokensOf,
  zipfWeights,
  type CalendarContext
} from './synthetic-values'

export { mineValueDomains, mineModel, domainKey, type MinedDomain, type MinedValue, type MineOptions, type Conjunction, type Implication, type MineResult } from './synthetic-mine'

export interface SyntheticOptions {
  /** PRNG seed (default 1). Same seed + same model → identical data. */
  seed?: number
  /** approximate fact-table row count (default 20000; scaled down when there are more than 4 facts) */
  factRows?: number
  /** only tables without data (default true): tables whose status is `loaded` with rows are kept */
  onlyEmpty?: boolean
  /**
   * Which tables are (re)generated; overrides `onlyEmpty`:
   *  - 'empty'     tables without rows (= onlyEmpty: true);
   *  - 'synthetic' those, plus tables that hold sample rows from an earlier run ("Regenerate sample data":
   *                a new seed gives a different, equally consistent dataset; real data is never touched);
   *  - 'all'       every table, replacing real data too (= onlyEmpty: false).
   */
  replace?: 'empty' | 'synthetic' | 'all'
  /**
   * Literals that the model's DAX and the report's filters compare name-like, id-like and free-text columns
   * to (`customer_name = "…"`, an organisation id in a report filter):
   *  - 'never' (default): they are not copied into the data — it must not contain a real name or id; visuals
   *    filtered to such a literal then show no data;
   *  - 'reuse': they are copied like any other mined value (those visuals render, the names are real).
   */
  identifyingLiterals?: 'never' | 'reuse'
  /** "today" as a naive wall-clock date (UTC fields, per the DataStore contract). Default: local today. */
  today?: Date
  /** calendar span in whole years ending Dec 31 of today's year (default 3) */
  years?: number
  /** fixed row count for ordinary (non-lookup) dimension tables, overriding the name heuristics */
  dimRows?: number
  /** fiscal year start month 1..12 for fiscal_* calendar columns (default 7 = July; FY named by end year) */
  fiscalYearStartMonth?: number
  /** restrict generation to these tables (by name, case-insensitive) */
  tables?: string[]
  /** pre-computed value domains (default: mineModel(project).domains) */
  domains?: Map<string, MinedDomain>
  /** pre-computed conjunctions (default: mineModel(project).conjunctions; [] when only `domains` is given) */
  conjunctions?: Conjunction[]
  /** pre-computed ratio implications (default: mineModel(project).implications; [] when only `domains` is given) */
  implications?: Implication[]
}

// ---------------------------------------------------------------------------------------------
// Planning types
// ---------------------------------------------------------------------------------------------

type Role = 'date' | 'dim' | 'fact' | 'measure' | 'enterData' | 'single'

/** Why a table has no generated rows. */
export type SyntheticSkipReason =
  /** computed by the DAX engine from the generated rows (calculated table) */
  | 'calculated'
  /** calculation group: holds calculation items, never rows */
  | 'calculationGroup'
  /** holds measures only (an empty "Enter data" / placeholder table) */
  | 'measureTable'
  /** has no stored columns */
  | 'noColumns'
  /** already has rows that this run was asked to keep */
  | 'hasData'
  /** not in the `tables` option */
  | 'notRequested'

export interface SyntheticResult {
  /** tables written by this run (model order); includes decoded "Enter data" tables */
  tables: string[]
  /** tables this run did not write, with the reason (model order) */
  skipped: Array<{ table: string; reason: SyntheticSkipReason }>
  /** the seed that was used */
  seed: number
  /**
   * Columns for which literals of the definitions were *not* reused because they would identify a person,
   * organisation or record (see SyntheticOptions.identifyingLiterals), with the number of distinct literals.
   * `kind`: what the column holds — a name (person, organisation, e-mail, address…), an id, or free text.
   * The literals themselves are deliberately not returned.
   */
  withheld: Array<{ table: string; column: string; literals: number; kind: 'name' | 'id' | 'text' }>
}

/** A relationship as the generator sees it: calculated-table ends are replaced by the columns they are computed from. */
interface EffRel {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
  fromOne: boolean
  toOne: boolean
  active: boolean
}

interface TablePlan {
  def: TableDef
  cols: ColumnDef[]
  role: Role
  rows: number
  /** decoded Enter-data rows */
  fixed?: TableData
  /** for date tables: the column holding the date */
  dateCol?: ColumnDef
  isOneSide: boolean
  isManySide: boolean
  /** periodic snapshot fact: rows are grouped by snapshot day (calendar index), one entity per row per day */
  snapshot?: { col: ColumnDef; days: number[]; entity?: ColumnDef }
}

interface Member {
  table: TableDef
  col: ColumnDef
  plan?: TablePlan
  /** one side of at least one relationship in the component */
  one: boolean
  /** many side (or either side of a many-to-many) of at least one relationship */
  many: boolean
  /** known values when the table is not generated (loaded data / calculated-table literals) */
  fixed?: Scalar[]
  /** one-side members this (many-side) member must be a subset of */
  targets: Set<Member>
  /** many-side draw limit (domain prefix size) */
  limit: number
}

type DomainKind = 'date' | 'int' | 'string' | 'bool'
type StringStyle = 'guid' | 'code' | 'label'

interface Component {
  id: number
  members: Member[]
  kind: DomainKind
  style: StringStyle
  /** label generator for 'label' style */
  label?: (k: number) => string
  codePrefix: string
  values: Scalar[]
  seen: Set<string>
  next: number
  /** number of fixed + mined values at the start of the domain */
  seeded: number
  minedCount: number
  fixedCount: number
  /** largest many-side draw limit of the members */
  limit: number
  /** for 'date' kind: the date-table column whose derivation defines the value per day (undefined = the date itself) */
  dateDerive?: { col: ColumnDef }
  /** date kind backed by the generated calendar (index = day offset) */
  calendarBacked: boolean
  /** many-side samplers per draw limit */
  samplers: Map<number, { sampler: WeightedSampler; perm: Int32Array }>
}

const PERSON_ENTITY = PERSON_TOKENS
const ORG_ENTITY = ORG_TOKENS

function keyOf(table: string, column: string): string {
  return `${table.toLowerCase()}[${column.toLowerCase()}]`
}

function valueKey(v: Scalar): string {
  if (v instanceof Date) return 'd' + v.getTime()
  if (typeof v === 'string') return 's' + v.toLowerCase()
  return typeof v + String(v)
}

function isDataColumn(c: ColumnDef): boolean {
  return c.kind !== 'calculated' && c.kind !== 'rowNumber' && c.kind !== 'calculatedTableColumn'
}

function effectiveType(c: ColumnDef): DataType {
  return c.dataType === 'unknown' || c.dataType === 'variant' || !c.dataType ? 'string' : c.dataType
}

function round2(x: number): number {
  return Math.round(x * 100) / 100
}

// ---------------------------------------------------------------------------------------------
// Table classification
// ---------------------------------------------------------------------------------------------

const DATE_PART_TOKENS = new Set(['year', 'month', 'quarter', 'week', 'day', 'weekday', 'fiscal', 'weekend', 'dow', 'qtr', 'yr'])

function looksLikeDateTable(t: TableDef, cols: ColumnDef[], oneSideCols: Set<string>): ColumnDef | undefined {
  const dateCols = cols.filter((c) => effectiveType(c) === 'dateTime')
  if (!dateCols.length) return undefined
  const pickKey = (): ColumnDef =>
    dateCols.find((c) => oneSideCols.has(keyOf(t.name, c.name))) ??
    dateCols.find((c) => /^(date|day|calendar_?date|full_?date|dt)$/i.test(c.name)) ??
    dateCols.find((c) => tokensOf(c.name).includes('date')) ??
    dateCols[0]
  if (t.dataCategory?.toLowerCase() === 'time') return pickKey()
  const toks = tokensOf(t.name)
  if (isFactName(t.name)) return undefined
  if (toks.some((x) => ['calendar', 'date', 'dates', 'dimdate', 'datetable', 'calender'].includes(x)) || /^(dim_?)?date|calendar/i.test(t.name)) {
    const parts = cols.filter((c) => tokensOf(c.name).some((x) => DATE_PART_TOKENS.has(x))).length
    if (parts >= 1 || cols.length <= 2) return pickKey()
  }
  // a date column on the one side of relationships + several date-part columns
  const key = dateCols.find((c) => oneSideCols.has(keyOf(t.name, c.name)))
  if (key) {
    const parts = cols.filter((c) => tokensOf(c.name).some((x) => DATE_PART_TOKENS.has(x))).length
    if (parts >= 3) return key
  }
  return undefined
}

const FACT_TOKENS = new Set([
  'fact', 'fct', 'f', 'log', 'logs', 'history', 'event', 'events', 'transaction', 'transactions', 'session', 'sessions', 'call',
  'calls', 'survey', 'surveys', 'response', 'responses', 'activity', 'activities', 'snapshot', 'snapshots', 'sales', 'orders',
  'visits', 'tickets', 'interactions', 'payments', 'invoices', 'claims', 'entries', 'records', 'feedback', 'results'
])

function isFactName(name: string): boolean {
  const toks = tokensOf(name)
  if (['dim', 'd', 'lkp', 'lookup', 'ref', 'param', 'map', 'mapping'].includes(toks[0] ?? '')) return false
  return toks[0] === 'fact' || toks[0] === 'fct' || toks[0] === 'f' || toks.some((t) => FACT_TOKENS.has(t) && t !== 'f')
}

function dimensionSize(t: TableDef, opts: SyntheticOptions): number {
  const toks = tokensOf(t.name)
  const ent = entityOf(t.name)
  const all = new Set([...toks.map((x) => x.replace(/s$/, '')), ent])
  const has = (...xs: string[]): boolean => xs.some((x) => all.has(x))
  if (has('refresh', 'config', 'setting', 'parameter', 'param', 'info', 'metadata', 'version')) return 1
  if (has('state', 'province')) return 50
  if (has('country', 'nation')) return 20
  if (has('region', 'territory', 'division', 'zone')) return 5
  if (has('city')) return US_CITIES.length
  if (CATEGORY_POOLS[ent] && !has('product', 'service', 'program', 'team')) return CATEGORY_POOLS[ent].length
  if (has('status', 'stage', 'type', 'category', 'priority', 'scale', 'rating', 'metric', 'icon', 'flag', 'alias', 'mapping', 'map', 'bucket', 'band', 'tier', 'reason', 'outcome', 'segment', 'channel', 'source', 'level', 'class', 'kind', 'group'))
    return 8
  if (opts.dimRows !== undefined) return Math.max(1, opts.dimRows)
  if (has('user', 'owner', 'employee', 'agent', 'staff', 'counselor', 'counsellor', 'provider', 'rep', 'manager', 'specialist', 'salesperson', 'clinician', 'team'))
    return 40
  if (has('product', 'service', 'item', 'sku', 'plan', 'program', 'offering', 'package', 'department', 'industry')) return 30
  if (has('deal', 'opportunity', 'case', 'ticket', 'order', 'project', 'file', 'policy', 'claim', 'contract', 'session', 'call', 'invoice', 'enrollment'))
    return 1500
  if (has('contact', 'customer', 'member', 'patient', 'client', 'person', 'people', 'employee', 'student', 'lead')) return 500
  if (has('account', 'org', 'organization', 'organisation', 'company', 'broker', 'vendor', 'supplier', 'partner', 'employer', 'store', 'site', 'location', 'branch', 'facility'))
    return 300
  return 100
}

// ---------------------------------------------------------------------------------------------
// Column semantics
// ---------------------------------------------------------------------------------------------

type Sem =
  | 'idSeq'
  | 'idCode'
  | 'guid'
  | 'email'
  | 'phone'
  | 'url'
  | 'image'
  | 'zip'
  | 'address'
  | 'city'
  | 'state'
  | 'country'
  | 'lat'
  | 'lon'
  | 'firstName'
  | 'lastName'
  | 'person'
  | 'company'
  | 'entityName'
  | 'text'
  | 'category'
  | 'datePart'
  | 'flag'
  | 'money'
  | 'pct'
  | 'count'
  | 'population'
  | 'duration'
  | 'score'
  | 'nps'
  | 'age'
  | 'order'
  | 'sortDesc'
  | 'date'
  | 'generic'

interface ColumnSemantics {
  sem: Sem
  toks: string[]
  /** pool for 'category' */
  pool?: readonly string[]
  /** duration unit */
  unit?: 'seconds' | 'minutes' | 'hours' | 'days'
}

const GENERIC_POOL_KEYS = new Set(['group', 'type', 'category', 'class', 'kind', 'level', 'model', 'range', 'size', 'yes'])
const COUNT_TOKENS = new Set([
  'qty', 'quantity', 'count', 'cnt', 'num', 'sessions', 'visits', 'calls', 'participants', 'units', 'seats', 'attempts', 'used',
  'referrals', 'served', 'serviced', 'traffic', 'offered', 'answered', 'abandoned', 'handled', 'clicks', 'views', 'items',
  'children', 'child', 'members', 'employees', 'cases', 'tickets', 'orders', 'responses', 'total', 'sessions', 'days', 'nights',
  'touches', 'contacts', 'deals', 'leads', 'hits'
])
const MONEY_TOKENS = new Set([
  'amount', 'amt', 'revenue', 'sales', 'price', 'cost', 'value', 'fee', 'fees', 'commission', 'budget', 'spend',
  'income', 'salary', 'wage', 'profit', 'margin', 'discount', 'tax', 'balance', 'payment', 'paid', 'charge', 'charges', 'premium',
  'arr', 'mrr', 'acv', 'tcv', 'billing', 'billed', 'invoice', 'gross', 'net', 'refund', 'freight', 'subtotal', 'msrp', 'usd', 'dollars'
])
const PCT_TOKENS = new Set(['pct', 'percent', 'percentage', 'ratio', 'share', 'probability', 'prob', 'utilization', 'util', 'conversion', 'propensity', 'likelihood'])
/** string columns carrying numbers ("employee_count", "number_of_x", "probability", "duration_days") */
const NUMERIC_TEXT_TOKENS = new Set([
  'count', 'number', 'num', 'qty', 'quantity', 'duration', 'days', 'hours', 'minutes', 'seconds', 'probability', 'pct', 'percent',
  'percentage', 'population', 'employees', 'eligible', 'headcount', 'amount', 'revenue', 'score', 'age'
])
const FLAG_TOKENS = new Set(['is', 'has', 'flag', 'active', 'enabled', 'deleted', 'billable', 'valid', 'primary', 'exclude', 'excluded', 'hide', 'hidden', 'needs', 'show', 'can', 'should', 'was', 'did', 'billed', 'onsite', 'archived', 'approved', 'verified', 'required', 'renewed', 'optout', 'dynamic'])

export function columnSemantics(col: ColumnDef, table: TableDef): ColumnSemantics {
  const toks = tokensOf(col.name)
  const flat = col.name.toLowerCase().replace(/[^a-z0-9]/g, '')
  const type = effectiveType(col)
  const has = (...xs: string[]): boolean => xs.some((x) => toks.includes(x))
  const last = toks[toks.length - 1] ?? ''
  const first = toks[0] ?? ''
  const numeric = type === 'int64' || type === 'double' || type === 'decimal'

  if (type === 'dateTime') return { sem: 'date', toks }
  if (type === 'string' && (has('date', 'dt', 'timestamp', 'datetime') || /(modified|created|updated)on$/.test(flat) || (last === 'at' && toks.length > 1)) && !has('range', 'bucket', 'type', 'key', 'id', 'name'))
    return { sem: 'date', toks }
  if (type === 'boolean') return { sem: 'flag', toks }

  // flags first (is_*, has_*, *_flag) — any type
  if ((first === 'is' || first === 'has' || last === 'flag' || first === 'flag') && (numeric || type === 'string')) return { sem: 'flag', toks }
  // survey-style yes/no questions: are_you_currently_working, was_consent_given, do_you_...
  if (type === 'string' && toks.length >= 3 && ['are', 'was', 'were', 'do', 'does', 'did', 'have', 'can', 'will', 'would', 'should'].includes(first)) return { sem: 'flag', toks }
  if (numeric && toks.length <= 2 && toks.some((x) => FLAG_TOKENS.has(x)) && !has('date', 'count', 'rate', 'time', 'by', 'id', 'name', 'amount', 'days', 'hours', 'number', 'total')) {
    return { sem: 'flag', toks }
  }

  // ids
  if (has('oid', 'guid', 'uuid')) return { sem: type === 'string' ? 'guid' : 'idCode', toks }
  if (last === 'id' || last === 'key' || last === 'sk' || last === 'pk' || flat === 'id' || flat.endsWith('id') && toks.length === 1 && flat.length > 2) {
    if (flat === 'id' || col.isKey) return { sem: 'idSeq', toks }
    return { sem: 'idCode', toks }
  }
  if ((last === 'number' || last === 'no' || last === 'num' || last === 'code') && !has('phone', 'week', 'month', 'day', 'year', 'quarter')) {
    if (numeric || has('case', 'file', 'account', 'org', 'claim', 'policy', 'order', 'invoice', 'member', 'employee', 'ticket', 'access', 'system')) return { sem: 'idCode', toks }
  }

  // image columns (data category "Image URL"): visuals show them as pictures, so they need a renderable value
  if (type === 'string' && col.dataCategory?.toLowerCase() === 'imageurl') return { sem: 'image', toks }
  if (has('email', 'mail')) return { sem: 'email', toks }
  if (has('phone', 'fax', 'mobile', 'tel', 'telephone')) return { sem: 'phone', toks }
  if (has('url', 'website', 'link', 'href', 'uri')) return { sem: 'url', toks }
  if (has('zip', 'postal', 'postcode', 'zipcode')) return { sem: 'zip', toks }
  if (has('address', 'street', 'addr')) return { sem: 'address', toks }
  if (has('lat', 'latitude')) return { sem: 'lat', toks }
  if (has('lon', 'lng', 'long', 'longitude') && numeric) return { sem: 'lon', toks }
  if (type === 'string') {
    if (has('city', 'town')) return { sem: 'city', toks }
    if (has('state', 'province') && !has('status')) return { sem: 'state', toks }
    if (has('country', 'nation')) return { sem: 'country', toks }
  }

  if (numeric) {
    if (has('sort', 'order', 'rank', 'seq', 'sequence', 'position', 'ordinal', 'index', 'idx', 'step') && has('desc')) return { sem: 'sortDesc', toks }
    if (has('sort', 'order', 'rank', 'seq', 'sequence', 'position', 'ordinal', 'idx', 'step', 'indent')) return { sem: 'order', toks }
    if (has('year', 'month', 'quarter', 'week', 'weekday', 'fiscal', 'yyyy', 'yyyymm', 'yr', 'qtr') && !has('count', 'days', 'num', 'number', 'total', 'months', 'years', 'weeks', 'age')) return { sem: 'datePart', toks }
    if (has('nps', 'ltr', 'likelihood', 'recommend')) return { sem: 'nps', toks }
    if (has('rating', 'csat', 'stars', 'score', 'satisfaction', 'grade')) return { sem: 'score', toks }
    if (has('age') && !has('average', 'avg', 'percentage')) return { sem: 'age', toks }
    if (has('population', 'headcount', 'pop', 'eligible', 'lives', 'employees', 'enrollment', 'enrolled', 'census')) return { sem: 'population', toks }
    if (has('seconds', 'secs', 'sec')) return { sem: 'duration', toks, unit: 'seconds' }
    if (has('minutes', 'mins', 'min') && !has('minimum')) return { sem: 'duration', toks, unit: 'minutes' }
    if (has('hours', 'hrs', 'hour', 'hr')) return { sem: 'duration', toks, unit: 'hours' }
    if (has('duration', 'time', 'wait', 'handle', 'talk', 'hold', 'tenure', 'elapsed', 'latency', 'aht', 'asa')) return { sem: 'duration', toks, unit: has('wait', 'hold', 'asa') ? 'seconds' : 'minutes' }
    if (has('days', 'dso', 'aging', 'lag')) return { sem: 'duration', toks, unit: 'days' }
    if (has('rate') && !has('hourly', 'fee', 'price', 'bill', 'billing', 'pay')) return { sem: 'pct', toks }
    if (toks.some((x) => PCT_TOKENS.has(x))) return { sem: 'pct', toks }
    if (toks.some((x) => MONEY_TOKENS.has(x)) || has('rate')) return { sem: 'money', toks }
    if (toks.some((x) => COUNT_TOKENS.has(x))) return { sem: 'count', toks }
    if (has('tier', 'level', 'priority', 'grade', 'class', 'type', 'category', 'status', 'code', 'model', 'version')) return { sem: 'order', toks }
    return { sem: 'generic', toks }
  }

  // strings
  const ent = entityOf(table.name)
  const personCol = toks.some((x) => PERSON_TOKENS.has(x))
  const orgCol = toks.some((x) => ORG_TOKENS.has(x))
  if (has('first', 'fname', 'given', 'firstname') && (has('name') || has('fname', 'firstname'))) return { sem: 'firstName', toks }
  if (has('last', 'lname', 'surname', 'family', 'lastname') && (has('name') || has('lname', 'surname', 'lastname'))) return { sem: 'lastName', toks }
  if (toks.some((x) => FREE_TEXT_TOKENS.has(x)) && has('description', 'desc', 'notes', 'note', 'comment', 'comments', 'feedback', 'text', 'message', 'summary', 'body', 'remarks', 'subject'))
    return { sem: 'text', toks }
  if (has('full') && has('name')) return { sem: 'person', toks }
  // unpivoted (attribute / value) tables: `name` or `attribute` next to a `value` column names the attribute
  if (toks.length === 1 && (first === 'name' || first === 'attribute') && table.columns.some((c) => c !== col && /^(value|values|val)$/i.test(c.name))) return { sem: 'generic', toks }
  if (has('name') || toks.length === 1) {
    const other = toks.filter((x) => x !== 'name')
    if (other.length === 0 || (other.length === 1 && singular(other[0]) === ent && has('name'))) {
      if (PERSON_ENTITY.has(ent)) return { sem: 'person', toks }
      if (ORG_ENTITY.has(ent)) return { sem: 'company', toks }
      return { sem: 'entityName', toks }
    }
    if (other.some((x) => PERSON_TOKENS.has(x)) && !other.some((x) => ORG_TOKENS.has(x) && !PERSON_TOKENS.has(x))) return { sem: 'person', toks }
    if (other.some((x) => ORG_TOKENS.has(x))) return { sem: 'company', toks }
  }
  if (personCol && !has('type', 'status', 'group', 'category', 'segment', 'level', 'role', 'count', 'satisfaction', 'classification', 'job', 'title', 'state', 'city', 'zip', 'brand')) return { sem: 'person', toks }
  if (orgCol && has('name', 'company', 'employer', 'competitor', 'organization', 'org') && !has('type', 'status', 'size', 'category', 'segment', 'pattern', 'industry', 'brand'))
    return { sem: 'company', toks }
  if (has('year', 'month', 'quarter', 'week', 'weekday', 'fiscal', 'qtr') && !has('count', 'num', 'total', 'number', 'days', 'duration')) return { sem: 'datePart', toks }
  // numbers stored as text (employee_count, number_of_x, probability, duration_days...)
  if (
    toks.some((x) => NUMERIC_TEXT_TOKENS.has(x)) &&
    !has('range', 'bucket', 'band', 'group', 'category', 'type', 'class', 'tier', 'level', 'scale', 'status', 'segment', 'size', 'code', 'zone')
  ) {
    const asNumber = columnSemantics({ ...col, dataType: 'int64' }, table)
    if (['count', 'population', 'duration', 'pct', 'money', 'score', 'nps', 'age'].includes(asNumber.sem) && !(asNumber.sem === 'money' && has('payment', 'billing', 'currency', 'fee', 'type'))) return asNumber
  }
  // category pools: specific tokens (from the last) first, generic ones after
  for (const pass of [0, 1]) {
    for (let i = toks.length - 1; i >= 0; i--) {
      const tk = singularToken(toks[i])
      const pool = CATEGORY_POOLS[tk] ?? CATEGORY_POOLS[toks[i]]
      if (!pool) continue
      if (pass === 0 && GENERIC_POOL_KEYS.has(tk)) continue
      return { sem: 'category', toks, pool }
    }
  }
  if (has('title', 'subject', 'label', 'caption', 'name')) return { sem: 'entityName', toks }
  return { sem: 'generic', toks }
}

function singularToken(t: string): string {
  if (t.endsWith('ies')) return t.slice(0, -3) + 'y'
  if (t.endsWith('s') && !t.endsWith('ss') && t.length > 3) return t.slice(0, -1)
  return t
}

/**
 * Stand-in pictures for image-URL columns: the real images live in the source, so sample data shows a
 * neutral "picture" glyph (in a few tints) where the report would show the actual icon / photo.
 */
export const PLACEHOLDER_IMAGES: readonly string[] = ['#8A8886', '#605E5C', '#A19F9D', '#C8C6C4'].map(
  (c) =>
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M4 18l5-5 3.5 3.5L15 14l5 4"/></svg>`
    )
)

function isFreeForm(sem: Sem): boolean {
  return ['email', 'phone', 'url', 'image', 'zip', 'address', 'firstName', 'lastName', 'person', 'company', 'entityName', 'text', 'guid', 'idCode', 'idSeq'].includes(sem)
}

/**
 * Columns whose real values identify people, organisations or records (names, e-mail addresses, phone
 * numbers, addresses, ids, free text). Privacy rule: literals found in the model's DAX or in the report's
 * filters are never copied into them — the report may be shown to third parties with sample data, and a
 * filter such as `customer_name = "…"` holds a real name. Only generic placeholders ("Unknown", "N/A") and
 * rows of the model's own literal tables are kept. Name-like columns that are really categories
 * (`status_name`, `metric_label`, `customer_class`…) are not identifying.
 */
export function isIdentifyingColumn(s: ColumnSemantics): boolean {
  if (!isFreeForm(s.sem)) return false
  if (s.sem !== 'entityName' && s.sem !== 'person' && s.sem !== 'company') return true
  // `customer_class`, `account_tier`, `status_name`: a category about an entity, not the entity's name
  return !s.toks.some((t) => CATEGORICAL_TOKENS.has(t) && t !== 'name')
}

/** Points of the survey scale of a rating / score / likelihood column: defaults, widened by the literals it is compared to. */
function ordinalScale(sem: Sem, mined: Scalar[]): { lo: number; hi: number } {
  let lo = sem === 'nps' ? 0 : 1
  let hi = sem === 'nps' ? 10 : 5
  const nums = mined.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (nums.length) {
    const max = Math.max(...nums)
    const min = Math.min(...nums)
    if (max > hi) hi = [5, 7, 10, 100].find((x) => x >= max) ?? Math.ceil(max)
    if (min < lo && min >= 0) lo = Math.floor(min)
  }
  return { lo, hi }
}

/** Rank of each label on a worst → best sentiment scale (undefined entries are not sentiment labels); undefined when the labels are not a sentiment scale. */
function sentimentRanks(labels: Scalar[]): { order: number[]; others: number[] } | undefined {
  const scored: Array<{ i: number; s: number }> = []
  const others: number[] = []
  labels.forEach((v, i) => {
    const s = typeof v === 'string' ? sentimentOf(v) : undefined
    if (s === undefined) others.push(i)
    else scored.push({ i, s })
  })
  if (scored.length < 2 || scored.every((x) => x.s === scored[0].s)) return undefined
  if (others.length > scored.length) return undefined
  scored.sort((a, b) => a.s - b.s || a.i - b.i)
  return { order: scored.map((x) => x.i), others }
}

// ---------------------------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------------------------

interface RowHelpers {
  person(r: number): { first: string; last: string }
  company(r: number): string
  place(r: number): readonly [string, string, string]
  baseDay(r: number): number
  scale(r: number): number
  /**
   * The row's latent "how satisfied is this respondent" value (standard normal, plus a slow drift over time
   * on fact tables): rating, score and sentiment columns of one row are all drawn around it, so a happy
   * respondent rates everything high and period-over-period scores move a little instead of being flat.
   */
  latent(r: number): number
}

class SyntheticGenerator {
  readonly model: SemanticModel
  readonly seed: number
  readonly today: Date
  readonly calStart: Date
  readonly nDays: number
  readonly todayIdx: number
  /** first calendar index of the default activity window (random fact dates are drawn in [windowStart, today]) */
  readonly windowStart: number
  readonly cal: CalendarContext
  readonly domains: Map<string, MinedDomain>
  readonly conjunctions: Conjunction[]
  readonly implications: Implication[]
  /** generated tables so far (dimensions are generated before facts) */
  private readonly generated = new Map<string, TableData>()
  /** relationship edges many-side member → one-side member */
  private readonly edges: Array<{ from: Member; to: Member; active: boolean }> = []
  readonly plans = new Map<string, TablePlan>()
  readonly comps: Component[] = []
  readonly compOf = new Map<string, { comp: Component; member: Member }>()
  /** 1:1 relationship pairs */
  private readonly oneToOne: Array<[Member, Member]> = []
  private trendSampler!: WeightedSampler
  /** relationships between tables the generator writes or knows the values of (see buildRelationships) */
  private readonly rels: EffRel[] = []
  /** "one"-side key columns of relationships whose other end is computed by the engine: unique whatever happens */
  private readonly uniqueKeys = new Set<string>()
  private readonly lineage: Map<string, LineageBranch[]>
  /** source column → factor a calculated table multiplies it by while its sibling sources are taken as they are */
  private readonly scaleHints = new Map<string, number>()
  /** fact table → share of the default fact size (minor feeds of a combined table are smaller) */
  private readonly sizeFactors = new Map<string, number>()
  readonly skipped: SyntheticResult['skipped'] = []
  readonly withheld: SyntheticResult['withheld'] = []
  private readonly reuseIdentifying: boolean

  constructor(
    readonly project: ProjectDocument,
    readonly opts: SyntheticOptions
  ) {
    this.model = project.model
    this.reuseIdentifying = opts.identifyingLiterals === 'reuse'
    this.seed = (opts.seed ?? 1) >>> 0
    const t = opts.today
    if (t) this.today = makeDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
    else {
      const now = new Date()
      this.today = makeDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
    }
    const years = Math.max(1, Math.round(opts.years ?? 3))
    const y = this.today.getUTCFullYear()
    if (opts.domains) {
      this.domains = opts.domains
      this.conjunctions = opts.conjunctions ?? []
      this.implications = opts.implications ?? []
    } else {
      const mined = mineModel(project)
      this.domains = mined.domains
      this.conjunctions = opts.conjunctions ?? mined.conjunctions
      this.implications = opts.implications ?? mined.implications
    }
    // calendar: whole years, default (years) ending this year, extended to cover every mined date
    const defaultStart = makeDate(y - years + 1, 1, 1)
    let minY = y - years + 1
    let maxY = y
    for (const d of this.minedDateHints()) {
      const dy = d.getUTCFullYear()
      if (dy < y - 15 || dy > y + 5) continue
      minY = Math.min(minY, dy)
      maxY = Math.max(maxY, dy)
    }
    this.calStart = makeDate(minY, 1, 1)
    const calEnd = makeDate(maxY, 12, 31)
    this.nDays = dayDiff(this.calStart, calEnd) + 1
    this.todayIdx = dayDiff(this.calStart, this.today)
    this.windowStart = dayDiff(this.calStart, defaultStart)
    this.cal = { today: this.today, fiscalStartMonth: Math.min(12, Math.max(1, Math.round(opts.fiscalYearStartMonth ?? 7))), weekEndDow: this.minedWeekEndDow() }
    this.buildTrend()
    this.lineage = modelLineage(this.model)
    this.buildRelationships()
    this.readLineageHints()
  }

  /**
   * Relationships as constraints on generated tables. A relationship end on a calculated table without
   * literal rows (UNION / SELECTCOLUMNS / FILTER over imported tables, auto date/time tables, CALENDAR())
   * is replaced by the imported columns that table is computed from, so that e.g. `Combined[key] → Dim[key]`
   * makes every source of `Combined` draw its keys from `Dim`. When the calculated end cannot be traced the
   * relationship constrains nothing, except that a "one" end on a generated table still has to be unique.
   */
  private buildRelationships(): void {
    const tableByName = new Map(this.model.tables.map((t) => [t.name.toLowerCase(), t]))
    const opaque = (name: string): boolean => {
      const t = tableByName.get(name.toLowerCase())
      return !t || (isCalculatedTable(t) && !calculatedTableLiterals(t))
    }
    const seen = new Set<string>()
    const push = (r: EffRel): void => {
      if (r.fromTable.toLowerCase() === r.toTable.toLowerCase()) return
      const k = `${keyOf(r.fromTable, r.fromColumn)}>${keyOf(r.toTable, r.toColumn)}`
      if (seen.has(k)) return
      seen.add(k)
      this.rels.push(r)
    }
    for (const r of this.model.relationships) {
      const fromOne = r.fromCardinality === 'one'
      const toOne = r.toCardinality !== 'many'
      const active = r.isActive !== false
      const fo = opaque(r.fromTable)
      const to = opaque(r.toTable)
      if (!fo && !to) {
        push({ fromTable: r.fromTable, fromColumn: r.fromColumn, toTable: r.toTable, toColumn: r.toColumn, fromOne, toOne, active })
        continue
      }
      if (!fo && fromOne && tableByName.has(r.fromTable.toLowerCase())) this.uniqueKeys.add(keyOf(r.fromTable, r.fromColumn))
      if (!to && toOne && tableByName.has(r.toTable.toLowerCase())) this.uniqueKeys.add(keyOf(r.toTable, r.toColumn))
      if (fo && to) continue
      const calcTable = fo ? r.fromTable : r.toTable
      const calcColumn = (fo ? r.fromColumn : r.toColumn).toLowerCase()
      for (const b of this.lineage.get(calcTable.toLowerCase()) ?? []) {
        const lc = b.columns.get(calcColumn)
        if (!lc?.source || lc.scale) continue
        // rows of the calculated table are rows of its source, so the source column is a "many" end even when
        // the calculated table is the "one" side (a lookup made with DISTINCT / SUMMARIZE): the two columns then
        // simply share one key domain
        if (fo) push({ fromTable: b.table, fromColumn: lc.source, toTable: r.toTable, toColumn: r.toColumn, fromOne: false, toOne, active })
        else push({ fromTable: r.fromTable, fromColumn: r.fromColumn, toTable: b.table, toColumn: lc.source, fromOne, toOne: false, active })
      }
    }
  }

  /**
   * Hints read from calculated tables that combine several imported tables (UNION of SELECTCOLUMNS):
   *  - a source multiplied by a constant (`t[score] * 2`) while its siblings are copied as they are uses a
   *    scale that much smaller than theirs, so the generated values are divided accordingly;
   *  - a feed that fills only a few of the combined columns (the others are BLANK()) is a minor source in
   *    practice; it gets fewer rows (share = (its coverage / best coverage)², at least 8%), so ratios whose
   *    denominator counts every row of the combined table are not dominated by rows that lack the attribute.
   *    Heuristic: real volumes are unknown.
   */
  private readLineageHints(): void {
    for (const branches of this.lineage.values()) {
      const tables = new Set(branches.map((b) => b.table.toLowerCase()))
      if (tables.size < 2) continue
      const names = new Set<string>()
      for (const b of branches) for (const n of b.columns.keys()) names.add(n)
      for (const n of names) {
        const cols = branches.map((b) => b.columns.get(n)).filter((c) => c?.source)
        if (!cols.some((c) => !c!.scale)) continue
        for (const b of branches) {
          const c = b.columns.get(n)
          if (c?.source && c.scale && c.scale > 1) this.scaleHints.set(keyOf(b.table, c.source), c.scale)
        }
      }
      const coverage = branches.map((b) => [...b.columns.values()].filter((c) => c.source).length)
      const best = Math.max(...coverage)
      if (best <= 0) continue
      branches.forEach((b, i) => {
        const f = Math.max(0.08, Math.pow(coverage[i] / best, 2))
        const k = b.table.toLowerCase()
        this.sizeFactors.set(k, Math.max(this.sizeFactors.get(k) ?? 0, f))
      })
    }
  }

  /** Weekday the report's week-end literals fall on (e.g. a slicer saved on a Sunday-ending week); default Saturday. */
  private minedWeekEndDow(): number {
    const counts = new Array<number>(7).fill(0)
    for (const d of this.domains.values()) {
      if (!isWeekEndName(d.column)) continue
      for (const v of d.values) if (v instanceof Date) counts[v.getUTCDay()]++
    }
    const best = counts.indexOf(Math.max(...counts))
    return counts[best] > 0 ? best : 6
  }

  /** Dates the calendar must contain: mined Date literals, plus years / year-month labels mined on date-table columns. */
  private minedDateHints(): Date[] {
    const out: Date[] = []
    for (const d of this.domains.values()) {
      const t = this.model.tables.find((x) => x.name === d.table)
      const dateLike = !!t && (t.dataCategory?.toLowerCase() === 'time' || /calendar|date/i.test(t.name))
      const toks = tokensOf(d.column)
      for (const v of d.values) {
        if (v instanceof Date) out.push(v)
        else if (dateLike && typeof v === 'number' && Number.isInteger(v) && toks.some((x) => x === 'year' || x === 'yr') && v >= 1900 && v <= 2200) out.push(makeDate(v, 1, 1))
        else if (dateLike && typeof v === 'string') {
          const m = /^(?:FY)?(\d{4})(?:[-/ ]?(?:Q|P|W)?(\d{1,2}))?/i.exec(v.trim())
          if (m && +m[1] >= 1900 && +m[1] <= 2200) out.push(makeDate(+m[1], 1, 1))
        }
      }
    }
    return out
  }

  private rng(...parts: string[]): Rng {
    return new Rng(hash32(parts.join('\u0001'), this.seed ^ 0x5bd1e995))
  }

  private buildTrend(): void {
    const n = Math.max(1, this.todayIdx - this.windowStart + 1)
    const w = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const d = addDays(this.calStart, this.windowStart + i)
      const m = d.getUTCMonth()
      const dow = d.getUTCDay()
      const trend = 0.55 + 0.9 * (i / Math.max(1, n - 1))
      const season = 1 + 0.18 * Math.sin((2 * Math.PI * m) / 12 + 1.2)
      const weekday = dow === 0 || dow === 6 ? 0.45 : 1
      w[i] = trend * season * weekday
    }
    this.trendSampler = new WeightedSampler(w)
  }

  private readonly dayCache: Date[] = []

  /** Calendar day i (0 = calStart). Instances are shared between rows — values are immutable by contract. */
  dayAt(i: number): Date {
    if (i >= 0 && i < this.nDays) return (this.dayCache[i] ??= addDays(this.calStart, i))
    return addDays(this.calStart, i)
  }

  // --- planning -------------------------------------------------------------------------------

  plan(): void {
    const data = this.project.data
    const only = this.opts.tables?.map((t) => t.toLowerCase())
    const replace = this.opts.replace ?? (this.opts.onlyEmpty === false ? 'all' : 'empty')
    const oneSideCols = new Set<string>()
    const manySideTables = new Set<string>()
    const oneSideTables = new Set<string>()
    // relationships to calculated tables that cannot be traced to imported columns (auto date/time
    // LocalDateTable_*, CALENDAR tables) are not in this.rels: those tables are derived from the data afterwards
    for (const r of this.rels) {
      if (r.fromOne) {
        oneSideCols.add(keyOf(r.fromTable, r.fromColumn))
        oneSideTables.add(r.fromTable.toLowerCase())
      } else manySideTables.add(r.fromTable.toLowerCase())
      if (r.toOne) {
        oneSideCols.add(keyOf(r.toTable, r.toColumn))
        oneSideTables.add(r.toTable.toLowerCase())
      } else manySideTables.add(r.toTable.toLowerCase())
    }
    for (const k of this.uniqueKeys) {
      oneSideCols.add(k)
      oneSideTables.add(k.slice(0, k.indexOf('[')))
    }

    for (const t of this.model.tables) {
      if (isCalculationGroupTable(t)) {
        this.skipped.push({ table: t.name, reason: 'calculationGroup' })
        continue
      }
      if (isCalculatedTable(t)) {
        this.skipped.push({ table: t.name, reason: 'calculated' })
        continue
      }
      const cols = t.columns.filter(isDataColumn)
      if (!cols.length) {
        this.skipped.push({ table: t.name, reason: t.measures.length ? 'measureTable' : 'noColumns' })
        continue
      }
      if (only && !only.includes(t.name.toLowerCase())) {
        this.skipped.push({ table: t.name, reason: 'notRequested' })
        continue
      }
      if (replace !== 'all') {
        const st = data.status.get(t.name)
        const existing = data.tables.get(t.name)
        const hasRows = (st?.state === 'loaded' && (existing?.rowCount ?? st.rowCount) > 0) || (!st && !!existing && existing.rowCount > 0)
        const sample = st?.state === 'loaded' && st.source === 'synthetic'
        if (hasRows && !(replace === 'synthetic' && sample)) {
          this.skipped.push({ table: t.name, reason: 'hasData' })
          continue
        }
      }
      const lname = t.name.toLowerCase()
      const plan: TablePlan = { def: t, cols, role: 'dim', rows: 0, isOneSide: oneSideTables.has(lname), isManySide: manySideTables.has(lname) }
      const mPart = t.partitions.find((p) => p.sourceType === 'm')
      if (mPart && isEnterDataPartition(mPart.expression)) {
        const fixed = decodeEnterDataTable(t, cols)
        if (fixed) {
          plan.role = 'enterData'
          plan.fixed = fixed
          plan.rows = fixed.rowCount
          this.plans.set(lname, plan)
          if (fixed.rowCount === 0 && t.measures.length > 0) this.skipped.push({ table: t.name, reason: 'measureTable' })
          continue
        }
      }
      const emptyM = !!mPart?.expression && /Table\.FromRows\s*\(\s*\{\s*\}|#table\s*\([\s\S]*,\s*\{\s*\}\s*\)\s*(in\b|$)/.test(mPart.expression)
      const placeholderOnly = t.measures.length > 0 && cols.length <= 2 && cols.every((c) => /^(column\d*|placeholder|dummy|blank|value|x)$/i.test(c.name))
      if ((emptyM || placeholderOnly) && !plan.isOneSide && !plan.isManySide) {
        plan.role = 'measure'
        plan.rows = 0
        this.plans.set(lname, plan)
        this.skipped.push({ table: t.name, reason: 'measureTable' })
        continue
      }
      const dateCol = looksLikeDateTable(t, cols, oneSideCols)
      const nameToks = tokensOf(t.name)
      const single =
        nameToks.includes('refresh') ||
        (nameToks.some((x) => ['last', 'latest', 'max', 'current'].includes(x)) && nameToks.some((x) => ['date', 'refresh', 'update', 'updated', 'load', 'loaded', 'run'].includes(x)) && cols.length <= 3)
      if (single && !plan.isOneSide) {
        plan.role = 'single'
        plan.rows = 1
      } else if (dateCol) {
        plan.role = 'date'
        plan.dateCol = dateCol
        // a calendar whose query stops at the current date (`… <= DateTime.LocalNow()`) ends today, as it does when
        // refreshed: "latest date" logic (MAX of the calendar date) then lands on a day that has fact rows
        plan.rows = endsToday(mPart?.expression) ? Math.min(this.nDays, this.todayIdx + 1) : this.nDays
      } else if (isFactName(t.name) || (plan.isManySide && !plan.isOneSide) || (!plan.isOneSide && !plan.isManySide && looksFactual(cols))) {
        plan.role = 'fact'
      } else {
        plan.role = 'dim'
        plan.rows = dimensionSize(t, this.opts)
        if (plan.rows === 1) plan.role = 'single'
      }
      this.plans.set(lname, plan)
    }

    // fact sizes
    const facts = [...this.plans.values()].filter((p) => p.role === 'fact')
    const factRows = Math.max(1, Math.round(this.opts.factRows ?? 20000))
    const perFact = Math.max(Math.min(factRows, 500), Math.round(factRows * Math.min(1, 4 / Math.max(1, facts.length))))
    for (const p of facts) {
      const jitter = 0.85 + (hash32(p.def.name, this.seed) % 1000) / 1000 * 0.3
      const share = this.sizeFactors.get(p.def.name.toLowerCase()) ?? 1
      p.rows = Math.max(1, Math.round((facts.length === 1 ? perFact : perFact * jitter) * share))
    }
    // dimensions: at least as many rows as the largest mined categorical domain on their columns
    for (const p of this.plans.values()) {
      if (p.role !== 'dim') continue
      p.rows = Math.min(p.rows, factRows)
      for (const c of p.cols) {
        const d = this.domains.get(domainKey(p.def.name, c.name))
        if (d && d.values.length > p.rows && d.values.length <= 2000 && effectiveType(c) === 'string') p.rows = d.values.length
      }
    }
  }

  private fixedValuesOf(t: TableDef, c: ColumnDef): Scalar[] | undefined {
    const plan = this.plans.get(t.name.toLowerCase())
    if (plan) {
      if (plan.fixed) return plan.fixed.columns.find((x) => x.name === c.name)?.values
      return undefined
    }
    // data the engine *derived* (calculated tables such as auto date/time LocalDateTable_*, computed while the
    // model had no data) is recomputed from the generated rows afterwards: it must not seed key domains
    const derived = this.project.data.status.get(t.name)?.state === 'loaded' && (this.project.data.status.get(t.name) as { source?: string }).source === 'calculated'
    const loaded = derived ? undefined : this.project.data.tables.get(t.name)
    if (loaded && loaded.rowCount > 0) {
      const col = loaded.columns.find((x) => x.name.toLowerCase() === c.name.toLowerCase())
      if (col) return col.values
    }
    if (isCalculatedTable(t)) {
      const lit = calculatedTableLiterals(t)?.get(c.name)
      if (lit) return lit
    }
    return undefined
  }

  buildComponents(): void {
    const tables = new Map(this.model.tables.map((t) => [t.name.toLowerCase(), t]))
    const parent = new Map<string, string>()
    const find = (k: string): string => {
      let r = k
      while (parent.get(r) !== r) r = parent.get(r)!
      let x = k
      while (parent.get(x) !== r) {
        const nx = parent.get(x)!
        parent.set(x, r)
        x = nx
      }
      return r
    }
    const members = new Map<string, Member>()
    const getMember = (t: TableDef, c: ColumnDef): Member | undefined => {
      const k = keyOf(t.name, c.name)
      let m = members.get(k)
      if (m) return m
      const plan = this.plans.get(t.name.toLowerCase())
      const generated = !!plan && !plan.fixed && isDataColumn(c)
      const fixed = generated ? undefined : this.fixedValuesOf(t, c)
      if (!generated && !fixed) return undefined
      m = { table: t, col: c, plan: generated ? plan : undefined, one: false, many: false, fixed, targets: new Set(), limit: 0 }
      members.set(k, m)
      parent.set(k, k)
      return m
    }
    for (const r of this.rels) {
      const ft = tables.get(r.fromTable.toLowerCase())
      const tt = tables.get(r.toTable.toLowerCase())
      const fc = ft?.columns.find((c) => c.name.toLowerCase() === r.fromColumn.toLowerCase())
      const tc = tt?.columns.find((c) => c.name.toLowerCase() === r.toColumn.toLowerCase())
      if (!ft || !tt || !fc || !tc) continue
      // both ends must be known before either becomes a member: a lone member would be drawn like a foreign key
      const known = (t: TableDef, c: ColumnDef): boolean => {
        const plan = this.plans.get(t.name.toLowerCase())
        return (!!plan && !plan.fixed && isDataColumn(c)) || !!this.fixedValuesOf(t, c)
      }
      if (!known(ft, fc) || !known(tt, tc)) continue
      const fm = getMember(ft, fc)
      const tm = getMember(tt, tc)
      if (!fm || !tm) continue
      if (!fm.plan && !tm.plan) continue
      const fromOne = r.fromOne
      const toOne = r.toOne
      if (fromOne) fm.one = true
      else fm.many = true
      if (toOne) tm.one = true
      else tm.many = true
      if (!fromOne && toOne) {
        fm.targets.add(tm)
        this.edges.push({ from: fm, to: tm, active: r.active })
      } else if (fromOne && !toOne) {
        tm.targets.add(fm)
        this.edges.push({ from: tm, to: fm, active: r.active })
      }
      else if (fromOne && toOne) this.oneToOne.push([fm, tm])
      // many-to-one: the many side must be ⊂ one side; 1:1 and m:m share the domain too
      const a = find(keyOf(ft.name, fc.name))
      const b = find(keyOf(tt.name, tc.name))
      if (a !== b) parent.set(a, b)
    }
    // "one" ends whose other end is computed by the engine (an untraceable calculated table): unique keys
    for (const k of this.uniqueKeys) {
      const t = tables.get(k.slice(0, k.indexOf('[')))
      const c = t?.columns.find((x) => keyOf(t.name, x.name) === k)
      if (!t || !c) continue
      const plan = this.plans.get(t.name.toLowerCase())
      if (!plan || plan.fixed || !isDataColumn(c)) continue
      const m = getMember(t, c)
      if (m) m.one = true
    }
    const groups = new Map<string, Member[]>()
    for (const [k, m] of members) {
      const root = find(k)
      const g = groups.get(root)
      if (g) g.push(m)
      else groups.set(root, [m])
    }
    for (const ms of groups.values()) {
      if (!ms.some((m) => m.plan)) continue
      // a member that is only ever the one side keeps `many=false`; a key column can be both
      const comp = this.makeComponent(this.comps.length, ms)
      this.comps.push(comp)
      for (const m of ms) this.compOf.set(keyOf(m.table.name, m.col.name), { comp, member: m })
    }
  }

  private makeComponent(id: number, ms: Member[]): Component {
    const dateMember = ms.find((m) => m.plan?.role === 'date')
    const anyDate = ms.some((m) => effectiveType(m.col) === 'dateTime')
    const ones = ms.filter((m) => m.one)
    const ref = ones.find((m) => m.plan) ?? ones[0] ?? ms[0]
    let kind: DomainKind
    if (dateMember || anyDate) kind = 'date'
    else {
      const t = effectiveType(ref.col)
      kind = t === 'int64' || t === 'double' || t === 'decimal' ? 'int' : t === 'boolean' ? 'bool' : 'string'
    }
    // style for string keys
    let style: StringStyle = 'code'
    let label: ((k: number) => string) | undefined
    const refSem = columnSemantics(ref.col, ref.table)
    if (kind === 'string') {
      if (ms.some((m) => tokensOf(m.col.name).some((x) => x === 'oid' || x === 'guid' || x === 'uuid'))) style = 'guid'
      else if (refSem.sem !== 'idCode' && refSem.sem !== 'idSeq' && refSem.sem !== 'guid' && refSem.sem !== 'generic') {
        style = 'label'
        label = labelGenerator(refSem, ref.col, ref.table)
      } else if (refSem.sem === 'generic' && ms.some((m) => this.domains.get(domainKey(m.table.name, m.col.name))?.values.length)) {
        style = 'label'
        label = (k) => `${titleCase(ref.col.name.replace(/_/g, ' '))} ${k + 1}`
      }
    }
    const ent = entityOf(ref.table.name)
    const comp: Component = {
      id,
      members: ms,
      kind,
      style,
      label,
      codePrefix: (ent.replace(/[^a-z]/gi, '').slice(0, 3) || 'KEY').toUpperCase(),
      values: [],
      seen: new Set(),
      next: 1,
      seeded: 0,
      minedCount: 0,
      fixedCount: 0,
      limit: 0,
      calendarBacked: false,
      samplers: new Map()
    }
    if (kind === 'date') {
      const fixedDate = ms.find((m) => m.one && m.fixed)
      if (dateMember && !fixedDate) {
        comp.calendarBacked = true
        if (effectiveType(dateMember.col) !== 'dateTime') comp.dateDerive = { col: dateMember.col }
      } else if (fixedDate) {
        for (const v of fixedDate.fixed ?? []) this.pushValue(comp, v)
        comp.fixedCount = comp.values.length
        comp.seeded = comp.values.length
      } else {
        comp.calendarBacked = true
      }
      return comp
    }
    // fixed values first (non-generated one-side tables, then the rest), then mined literals
    const fixedMembers = [...ms.filter((m) => m.fixed && m.one), ...ms.filter((m) => m.fixed && !m.one)]
    for (const m of fixedMembers) for (const v of m.fixed ?? []) this.pushValue(comp, v)
    comp.fixedCount = comp.values.length
    // privacy: ids, codes and names used as keys are always invented; literals from DAX / report filters only
    // seed keys that are categories (a status or type used as a key), placeholders, or small whole numbers
    // (surrogate keys the generator would produce anyway)
    const identifying = !this.reuseIdentifying && kind === 'string' && (style !== 'label' || isIdentifyingColumn(refSem))
    const maxKey = Math.max(1000, ...ms.filter((m) => m.plan).map((m) => m.plan!.rows))
    for (const m of ms) {
      const d = this.domains.get(domainKey(m.table.name, m.col.name))
      if (!d) continue
      let dropped = 0
      for (const v of d.values) {
        const drop =
          (identifying && !(typeof v === 'string' && isPlaceholderLabel(v)) && !d.linked.includes(v)) ||
          (!this.reuseIdentifying && kind === 'int' && typeof v === 'number' && (v < 0 || v > maxKey))
        if (drop) dropped++
        else this.pushValue(comp, v)
      }
      if (dropped && m.plan) this.withheld.push({ table: m.table.name, column: m.col.name, literals: dropped, kind: kind === 'string' && style === 'label' ? 'name' : 'id' })
    }
    comp.minedCount = comp.values.length - comp.fixedCount
    comp.seeded = comp.values.length
    return comp
  }

  private pushValue(comp: Component, raw: Scalar): void {
    if (raw === null || raw === undefined) return
    const target: DataType = comp.kind === 'int' ? 'int64' : comp.kind === 'bool' ? 'boolean' : comp.kind === 'date' ? 'dateTime' : 'string'
    const v = coerceTo(raw, target)
    if (v === undefined || v === null) return
    if (typeof v === 'string' && !v.trim()) return
    const k = valueKey(v)
    if (comp.seen.has(k)) return
    comp.seen.add(k)
    comp.values.push(v)
  }

  /** Make sure the component's domain has at least n values. */
  private ensureDomain(comp: Component, n: number): void {
    if (comp.kind === 'date') return
    let guard = 0
    while (comp.values.length < n && guard++ < n * 4 + 1000) {
      let v: Scalar
      if (comp.kind === 'bool') {
        if (comp.values.length >= 2) return
        v = comp.values.length === 0 ? true : !comp.values[0]
      } else if (comp.kind === 'int') {
        v = comp.next++
      } else if (comp.style === 'guid') {
        v = guidFrom(this.seed ^ hash32('comp' + comp.id), comp.next++)
      } else if (comp.style === 'label' && comp.label) {
        v = comp.label(comp.next++ - 1)
      } else {
        v = `${comp.codePrefix}-${pad(comp.next++, 5)}`
      }
      const k = valueKey(v)
      if (comp.seen.has(k)) continue
      comp.seen.add(k)
      comp.values.push(v)
    }
  }

  /** Cap table sizes so unique key columns that are also FKs fit in their targets; compute draw limits. */
  resolveSizes(): void {
    // tiny lookup dimensions: exactly their mined/fixed label domain
    for (const comp of this.comps) {
      if (comp.kind !== 'string' || comp.style !== 'label' || comp.seeded === 0) continue
      for (const m of comp.members) {
        if (!m.one || !m.plan || m.plan.role !== 'dim') continue
        const others = m.plan.cols.filter((c) => c !== m.col && this.compOf.get(keyOf(m.table.name, c.name))?.member.one)
        if (others.length === 0 && m.plan.rows > comp.seeded) m.plan.rows = Math.max(1, comp.seeded)
        else if (m.plan.rows < comp.seeded && comp.seeded <= 2000) m.plan.rows = comp.seeded
      }
    }
    // 1:1 relationships between generated dimensions describe one entity split in two tables: same size
    for (const [a, b] of this.oneToOne) {
      if (a.plan && b.plan && a.plan.role === 'dim' && b.plan.role === 'dim') {
        const n = Math.max(a.plan.rows, b.plan.rows)
        a.plan.rows = n
        b.plan.rows = n
      }
    }
    const sizeOf = (m: Member): number => (m.plan ? m.plan.rows : (m.fixed?.filter((v) => v !== null).length ?? 0))
    // days a calendar-backed component can use: the shortest generated calendar among its members
    const calendarDays = (comp: Component): number => Math.min(this.nDays, ...comp.members.filter((m) => m.plan?.role === 'date' && m.one).map((m) => m.plan!.rows))
    for (let pass = 0; pass < 8; pass++) {
      let changed = false
      for (const comp of this.comps) {
        const sizes = comp.members.filter((m) => m.plan).map((m) => m.plan!.rows)
        const fallback = Math.max(comp.seeded, Math.min(200, Math.max(1, Math.round(Math.min(...sizes) / 4))))
        let compLimit = 0
        for (const m of comp.members) {
          let limit: number
          if (comp.kind === 'date') limit = comp.calendarBacked ? calendarDays(comp) : comp.values.length
          else if (m.targets.size) limit = Math.min(...[...m.targets].map(sizeOf))
          else if (m.one) limit = sizeOf(m)
          else limit = fallback
          if (comp.kind === 'bool') limit = Math.min(limit, 2)
          m.limit = Math.max(0, limit)
          compLimit = Math.max(compLimit, m.limit)
          // unique keys that are also foreign keys must fit inside their targets
          if (m.one && m.targets.size && m.plan && m.plan.role !== 'date' && m.plan.rows > m.limit && m.limit > 0) {
            m.plan.rows = m.limit
            changed = true
          }
        }
        comp.limit = compLimit
      }
      if (!changed) break
    }
    for (const comp of this.comps) {
      if (comp.kind === 'date') continue
      const need = Math.max(comp.limit, ...comp.members.filter((m) => m.one && m.plan).map((m) => m.plan!.rows))
      this.ensureDomain(comp, need)
      for (const m of comp.members) m.limit = Math.min(m.limit, comp.values.length)
      comp.limit = Math.min(comp.limit, comp.values.length)
    }
    // facts: enough rows that every dimension member they reference has fact rows
    const factRows = Math.max(1, Math.round(this.opts.factRows ?? 20000))
    const cap = Math.max(factRows * 10, 200000)
    for (const plan of this.plans.values()) {
      if (plan.role !== 'fact') continue
      for (const c of plan.cols) {
        const link = this.compOf.get(keyOf(plan.def.name, c.name))
        if (!link || link.comp.kind === 'date' || !link.member.many || link.member.one) continue
        if (link.member.limit > plan.rows) plan.rows = Math.min(cap, Math.ceil(link.member.limit * 1.15))
      }
    }
    for (const plan of this.plans.values()) if (plan.role === 'fact') this.planSnapshot(plan)
  }

  /** Detect a periodic-snapshot fact and choose its snapshot days. */
  private planSnapshot(plan: TablePlan): void {
    const tableToks = tokensOf(plan.def.name)
    const dateCols = plan.cols.filter((c) => effectiveType(c) === 'dateTime')
    if (!dateCols.length) return
    const isSnapCol = (c: ColumnDef): boolean => {
      const t = tokensOf(c.name)
      const flat = c.name.toLowerCase().replace(/[^a-z]/g, '')
      return t.includes('snapshot') || t.includes('asof') || (t.includes('as') && t.includes('of')) || ['reportdate', 'reportingdate', 'periodend', 'periodenddate', 'balancedate', 'censusdate', 'snapdate'].includes(flat)
    }
    let col = dateCols.find(isSnapCol)
    if (!col && tableToks.some((x) => ['snapshot', 'snapshots', 'daily', 'monthly', 'weekly', 'balance', 'balances', 'inventory', 'population', 'headcount', 'census'].includes(x))) {
      col = dateCols.find((c) => this.compOf.get(keyOf(plan.def.name, c.name))?.comp.kind === 'date') ?? dateCols.find((c) => tokensOf(c.name).includes('date')) ?? dateCols[0]
    }
    if (!col) return
    // cadence: daily / weekly when the names say so, month ends otherwise
    const daily = tableToks.includes('daily') || tableToks.includes('day')
    const weekly = tableToks.includes('weekly') || tableToks.includes('week')
    const set = new Set<number>()
    if (daily) for (let i = Math.max(this.windowStart, this.todayIdx - 179); i <= this.todayIdx; i++) set.add(i)
    else if (weekly) for (let i = this.todayIdx; i >= this.windowStart; i -= 7) set.add(i)
    else {
      for (let i = this.windowStart; i <= this.todayIdx; i++) {
        const d = this.dayAt(i)
        if (addDays(d, 1).getUTCDate() === 1) set.add(i)
      }
      set.add(this.todayIdx)
    }
    const lastDay = Math.min(this.nDays, this.compOf.get(keyOf(plan.def.name, col.name))?.member.limit || this.nDays)
    for (const d of this.minedDatesFor(plan.def, col)) {
      const i = dayDiff(this.calStart, d)
      if (i >= 0 && i < lastDay) set.add(i)
    }
    const days = [...set].sort((a, b) => a - b)
    // entity: the first many-side key column that is not a person / audit reference
    const entity = plan.cols.find((c) => {
      const link = this.compOf.get(keyOf(plan.def.name, c.name))
      if (!link || link.comp.kind === 'date' || !link.member.many || link.member.one) return false
      return !tokensOf(c.name).some((x) => PERSON_TOKENS.has(x) || ['created', 'modified', 'by', 'updated'].includes(x))
    })
    plan.rows = Math.max(plan.rows, days.length * 5)
    plan.snapshot = { col, days, entity }
  }

  /**
   * A text column without mined values borrows the mined labels of a same-named column in another table
   * (e.g. a category denormalised into both a dimension and a fact), so slicers and visuals on either agree.
   */
  private sameNameDomain(plan: TablePlan, col: ColumnDef): MinedDomain | undefined {
    if (effectiveType(col) !== 'string') return undefined
    const sem = columnSemantics(col, plan.def)
    if (isFreeForm(sem.sem)) return undefined
    const name = col.name.toLowerCase()
    let best: MinedDomain | undefined
    for (const d of this.domains.values()) {
      if (d.column.toLowerCase() !== name || d.table === plan.def.name) continue
      if (!d.values.some((v) => typeof v === 'string')) continue
      if (!best || d.values.length > best.values.length) best = d
    }
    return best ? { ...best, values: best.values.filter((v) => typeof v === 'string'), contains: [] } : undefined
  }

  /** Mined Date literals for a column, including those mined on other members of its key component. */
  private minedDatesFor(table: TableDef, col: ColumnDef): Date[] {
    const out: Date[] = []
    const add = (t: string, c: string): void => {
      for (const v of this.domains.get(domainKey(t, c))?.values ?? []) if (v instanceof Date) out.push(v)
    }
    add(table.name, col.name)
    const link = this.compOf.get(keyOf(table.name, col.name))
    if (link) for (const m of link.comp.members) if (m.col !== col) add(m.table.name, m.col.name)
    return out
  }

  /** Many-side value sampler for a key component. */
  private compSampler(comp: Component, limit: number): { sampler: WeightedSampler; perm: Int32Array } {
    const cached = comp.samplers.get(limit)
    if (cached) return cached
    const n = Math.max(1, limit)
    const rng = this.rng('comp', String(comp.id), comp.members.map((m) => keyOf(m.table.name, m.col.name)).sort().join(','))
    const perm = new Int32Array(n)
    for (let i = 0; i < n; i++) perm[i] = i
    // shuffle popularity order (keep it stable per component so all facts agree on "top" keys)
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1))
      const t = perm[i]
      perm[i] = perm[j]
      perm[j] = t
    }
    const seeded = Math.min(comp.seeded, n)
    const allSeeded = seeded >= n
    const w = zipfWeights(n, allSeeded ? 0.55 : n > 50 ? 0.85 : 0.7)
    // mined / fixed values (domain indices < seeded) get ~60% of the mass when mixed with generated keys
    if (seeded > 0 && !allSeeded) {
      let seededMass = 0
      let total = 0
      for (let rank = 0; rank < n; rank++) {
        total += w[rank]
        if (perm[rank] < seeded) seededMass += w[rank]
      }
      const target = 0.6
      const boost = seededMass > 0 ? ((target / (1 - target)) * (total - seededMass)) / seededMass : 1
      if (boost > 1) for (let rank = 0; rank < n; rank++) if (perm[rank] < seeded) w[rank] *= boost
    }
    const out = { sampler: new WeightedSampler(w), perm }
    comp.samplers.set(limit, out)
    return out
  }

  // --- generation -----------------------------------------------------------------------------

  generate(): string[] {
    const out: string[] = []
    const data = this.project.data
    // dimensions before facts: fact rows seeded for conjunctions look up dimension rows
    const order: Record<Role, number> = { measure: 0, enterData: 0, single: 1, date: 2, dim: 3, fact: 4 }
    const plans = [...this.plans.values()].sort((a, b) => order[a.role] - order[b.role])
    for (const plan of plans) {
      const table = plan.fixed ?? this.generateTable(plan)
      this.generated.set(plan.def.name.toLowerCase(), table)
      out.push(plan.def.name)
    }
    // model order in the store (dimension rows may have been adjusted by fact seeding)
    for (const plan of this.plans.values()) {
      const table = this.generated.get(plan.def.name.toLowerCase())!
      data.tables.set(plan.def.name, table)
      data.status.set(plan.def.name, { state: 'loaded', source: 'synthetic', rowCount: table.rowCount })
    }
    return [...this.plans.values()].map((p) => p.def.name).filter((n) => out.includes(n))
  }

  private rowHelpers(plan: TablePlan): RowHelpers {
    const name = plan.def.name
    const rows = plan.rows
    const rng = this.rng(name, '#rows')
    const ent = entityOf(name)
    const personOffset = hash32(name, this.seed) % 5000
    let persons: Array<{ first: string; last: string }> | undefined
    let companies: string[] | undefined
    let places: Array<readonly [string, string, string]> | undefined
    let days: Int32Array | undefined
    let scales: Float64Array | undefined
    let latents: Float64Array | undefined
    const perRowEntity = plan.role === 'dim' || plan.role === 'single'
    const helpers: RowHelpers = {
      person: (r) => {
        if (!persons) {
          persons = new Array(rows)
          const pool = perRowEntity && PERSON_ENTITY.has(ent) ? 0 : Math.min(rows, 35)
          for (let i = 0; i < rows; i++) persons[i] = personName(pool ? (personOffset + rng.int(0, pool - 1)) : personOffset + i)
        }
        return persons[r]
      },
      company: (r) => {
        if (!companies) {
          companies = new Array(rows)
          const pool = perRowEntity && ORG_ENTITY.has(ent) ? 0 : Math.min(rows, 80)
          for (let i = 0; i < rows; i++) companies[i] = companyName(pool ? rng.int(0, pool - 1) : i)
        }
        return companies[r]
      },
      place: (r) => {
        if (!places) {
          places = new Array(rows)
          const w = zipfWeights(US_CITIES.length, 0.6)
          const s = new WeightedSampler(w)
          for (let i = 0; i < rows; i++) places[i] = US_CITIES[s.draw(rng)]
        }
        return places[r]
      },
      baseDay: (r) => {
        if (!days) {
          days = new Int32Array(rows)
          const snap = plan.snapshot
          if (snap && snap.days.length) {
            // periodic snapshot: rows grouped by snapshot day, equal-sized groups in date order
            for (let i = 0; i < rows; i++) days[i] = snap.days[Math.min(snap.days.length - 1, Math.floor((i * snap.days.length) / rows))]
          } else for (let i = 0; i < rows; i++) days[i] = this.windowStart + this.trendSampler.draw(rng)
        }
        return days[r]
      },
      scale: (r) => {
        if (!scales) {
          scales = new Float64Array(rows)
          for (let i = 0; i < rows; i++) scales[i] = Math.exp(0.55 * rng.normal())
        }
        return scales[r]
      },
      latent: (r) => {
        if (!latents) {
          latents = new Float64Array(rows)
          const lr = this.rng(name, '#latent')
          const drift = plan.role === 'fact' ? this.moodDrift(name) : undefined
          for (let i = 0; i < rows; i++) latents[i] = lr.normal() + (drift ? drift(helpers.baseDay(i)) : 0)
        }
        return latents[r]
      }
    }
    return helpers
  }

  /**
   * Slow, seeded drift of satisfaction over time for one fact table (two long waves plus a small monthly
   * step, about ±0.1 standard deviations): enough for month / year comparisons to show plausible movement
   * (a few points of a net promoter score), never enough to flip its sign.
   */
  private moodDrift(table: string): (day: number) => number {
    const rng = this.rng(table, '#mood')
    const p1 = rng.next() * 2 * Math.PI
    const p2 = rng.next() * 2 * Math.PI
    const salt = hash32(table, this.seed ^ 0x2545f491)
    return (day) => {
      const d = this.dayAt(day)
      const month = d.getUTCFullYear() * 12 + d.getUTCMonth()
      const step = ((hash32(String(month), salt) % 2001) / 1000 - 1) * 0.04
      return 0.06 * Math.sin((2 * Math.PI * day) / 365 + p1) + 0.04 * Math.sin((2 * Math.PI * day) / 117 + p2) + step
    }
  }

  private readonly semCache = new Map<ColumnDef, ColumnSemantics>()

  /**
   * Privacy gate for every place that writes a literal taken from the definitions (DAX, report filters) into
   * a generated column: name-like, id-like and free-text columns only accept generic placeholders and rows of
   * the model's own literal tables (see isIdentifyingColumn), unless the caller opted into reuse.
   */
  private literalAllowed(table: TableDef, col: ColumnDef, v: unknown): boolean {
    if (this.reuseIdentifying) return true
    let sem = this.semCache.get(col)
    if (!sem) this.semCache.set(col, (sem = columnSemantics(col, table)))
    if (!isIdentifyingColumn(sem)) return true
    if (typeof v === 'string' && isPlaceholderLabel(v)) return true
    const linked = this.domains.get(domainKey(table.name, col.name))?.linked
    return !!linked?.some((x) => (x instanceof Date && v instanceof Date ? x.getTime() === v.getTime() : typeof x === 'string' && typeof v === 'string' ? x.toLowerCase() === v.toLowerCase() : x === v))
  }

  /** values each column must contain (at least n times), applied after conjunction seeding */
  private needs = new Map<string, Array<{ v: Scalar; n: number }>>()

  private addNeeds(col: ColumnDef, vals: Scalar[], n = 1): void {
    if (!vals.length) return
    const list = this.needs.get(col.name) ?? []
    for (const v of vals) if (v !== null && v !== undefined) list.push({ v, n })
    this.needs.set(col.name, list)
  }

  private generateTable(plan: TablePlan): TableData {
    const rows = plan.rows
    const helpers = this.rowHelpers(plan)
    const columns: ColumnData[] = []
    this.needs = new Map()
    for (const col of plan.cols) {
      const values = this.generateColumn(plan, col, helpers)
      columns.push({ name: col.name, type: col.dataType, values })
    }
    const table: TableData = { columns, rowCount: rows }
    const protect = new Uint8Array(rows)
    this.seedConjunctions(plan, table, protect)
    const rng = this.rng(plan.def.name, '#needs')
    for (const c of columns) {
      const needs = this.needs.get(c.name)
      if (needs) applyNeeds(c.values, needs, rng, protect)
    }
    this.applyImplications(plan, table)
    this.alignScoreGroups(plan, table, protect)
    this.applySortBy(plan, columns)
    return table
  }

  /**
   * Ratio implications (see Implication in ./synthetic-mine.ts): rows matching the numerator's filters get
   * the denominator's filter values too, so part/whole ratios stay ≤ 100%. Key columns are never rewritten.
   */
  private applyImplications(plan: TablePlan, table: TableData): void {
    const self = plan.def.name.toLowerCase()
    for (const imp of this.implications) {
      if (imp.table.toLowerCase() !== self) continue
      const colOf = (n: string) => table.columns.find((c) => c.name.toLowerCase() === n.toLowerCase())
      const when = imp.when.map((w) => {
        const col = colOf(w.column)
        const type = col ? (col.type as DataType) : 'string'
        return { col, keys: new Set(w.values.map((v) => coerceTo(v, type)).filter((v): v is Exclude<Scalar, undefined> => v !== undefined).map(valueKey)) }
      })
      if (when.some((w) => !w.col)) continue
      const then = imp.then
        .map((t) => {
          const col = colOf(t.column)
          if (!col || this.compOf.has(keyOf(plan.def.name, col.name))) return undefined
          const def = plan.cols.find((c) => c.name === col.name)
          if (def && !this.literalAllowed(plan.def, def, t.value)) return undefined
          const v = coerceTo(t.value, col.type as DataType)
          return v === undefined ? undefined : { col, v }
        })
        .filter((x): x is { col: ColumnData; v: Exclude<Scalar, undefined> } => !!x)
      if (!then.length) continue
      for (let r = 0; r < table.rowCount; r++) {
        if (!when.every((w) => w.keys.has(valueKey(w.col!.values[r])))) continue
        for (const t of then) t.col.values[r] = t.v
      }
    }
  }

  // --- conjunctions -------------------------------------------------------------------------------

  /**
   * Seed rows so that every mined conjunction (conditions that must hold together) is satisfied by a
   * realistic number of rows: conditions on this table's columns are written directly; conditions on
   * related dimensions (one or two relationship hops away) are met by pointing the row's foreign key
   * at a dimension row that satisfies them (adjusting a few dimension rows when none does).
   */
  private seedConjunctions(plan: TablePlan, table: TableData, protect: Uint8Array): void {
    const rows = table.rowCount
    if (!rows || !this.conjunctions.length || plan.role === 'date') return
    const self = plan.def.name.toLowerCase()
    type Applicable = { local: Array<{ col: ColumnData; vals: Scalar[] }>; remote: Array<{ col: ColumnData; keys: Scalar[] }> }
    const work: Applicable[] = []
    for (const conj of this.conjunctions) {
      const byTable = new Map<string, Conjunction['conds']>()
      for (const c of conj.conds) {
        const k = c.table.toLowerCase()
        byTable.set(k, [...(byTable.get(k) ?? []), c])
      }
      const local: Applicable['local'] = []
      for (const c of byTable.get(self) ?? []) {
        const col = table.columns.find((x) => x.name.toLowerCase() === c.column.toLowerCase())
        if (!col) continue
        const vals = this.allowedValues(plan, col, c.values)
        if (vals.length) local.push({ col, vals })
      }
      const remote: Applicable['remote'] = []
      if (plan.role === 'fact') {
        for (const [t, conds] of byTable) {
          if (t === self) continue
          const hit = this.foreignKeysFor(plan, table, t, conds)
          if (hit) remote.push(hit)
        }
      }
      if (local.length + remote.length >= 2 || (local.length >= 1 && remote.length >= 1)) work.push({ local, remote })
    }
    if (!work.length) return
    const rng = this.rng(plan.def.name, '#conj')
    // a fifth of the rows at most, a few percent per conjunction: enough for measures, not enough to distort distributions
    const budget = Math.floor(rows * 0.2)
    const perAll =
      plan.role === 'fact'
        ? Math.max(Math.min(rows, 3), Math.min(Math.ceil(rows * 0.025), Math.floor(budget / work.length)))
        : Math.max(1, Math.min(Math.ceil(rows * 0.02), Math.floor(budget / work.length)))
    let start = rng.int(0, rows - 1)
    const stride = strideFor(rows)
    let used = 0
    const dateGroups = plan.snapshot ? plan.snapshot.days.length : Math.max(1, Math.round((this.todayIdx - this.windowStart + 1) / 7))
    const perDated = Math.max(3, Math.min(perAll, Math.ceil((0.3 * rows) / dateGroups)))
    for (const w of work) {
      // a conjunction pinned to one date gets about a day's (snapshot's) worth of rows, not more
      const dated = w.local.some((l) => l.vals.some((v) => v instanceof Date)) || w.remote.some((m) => m.keys.length > 0 && m.keys.length <= 3 && m.keys.every((k) => k instanceof Date))
      const per = dated ? perDated : perAll
      // already satisfied often enough by the sampled rows? then leave the data alone
      const sets = [...w.local.map((l) => ({ col: l.col, set: new Set(l.vals.map(valueKey)) })), ...w.remote.map((m) => ({ col: m.col, set: new Set(m.keys.map(valueKey)) }))]
      // (sampled scan: at most ~4000 rows, extrapolated)
      const scanN = Math.min(rows, 4000)
      const scanStride = strideFor(rows)
      let have = 0
      for (let i = 0, r = 0; i < scanN && have < per; i++, r = (r + scanStride) % rows) if (sets.every((x) => x.col.values[r] !== null && x.set.has(valueKey(x.col.values[r])))) have++
      have = Math.floor((have * rows) / scanN)
      if (have >= per) continue
      if (used >= budget) break
      for (let k = have; k < per && used < budget; k++) {
        // next unprotected row
        let r = start
        let guard = 0
        while (protect[r] && guard++ < rows) r = (r + stride) % rows
        if (protect[r]) return
        start = (r + stride) % rows
        protect[r] = 1
        used++
        for (const l of w.local) l.col.values[r] = l.vals[k % l.vals.length]
        for (const m of w.remote) m.col.values[r] = m.keys[Math.floor(rng.next() * m.keys.length)]
      }
    }
  }

  private readonly allowedCache = new Map<string, Set<string>>()
  private readonly keyCache = new WeakMap<ColumnData, string[]>()

  /** valueKey of every cell of a (generated) column, cached until the column is adjusted. */
  private cellKeys(col: ColumnData): string[] {
    let ks = this.keyCache.get(col)
    if (!ks) {
      ks = col.values.map((v) => (v === null ? 'null' : valueKey(v)))
      this.keyCache.set(col, ks)
    }
    return ks
  }

  /** Condition values coerced to the column; for foreign keys only values inside the allowed key prefix. */
  private allowedValues(plan: TablePlan, col: ColumnData, values: unknown[]): Scalar[] {
    const def = plan.cols.find((c) => c.name === col.name)
    if (!def) return []
    const type = effectiveType(def)
    const out: Scalar[] = []
    const link = this.compOf.get(keyOf(plan.def.name, def.name))
    if (link?.member.one) return [] // unique keys are not rewritten
    let allowed: Set<string> | undefined
    if (link && link.comp.kind !== 'date') {
      const ck = keyOf(plan.def.name, def.name)
      allowed = this.allowedCache.get(ck)
      if (!allowed) {
        allowed = new Set(link.comp.values.slice(0, Math.min(link.member.limit, link.comp.values.length)).map((v) => valueKey(coerceTo(v, type) ?? null)))
        this.allowedCache.set(ck, allowed)
      }
    }
    for (const v of values) {
      const c = coerceTo(v as Scalar, type)
      if (c === undefined || c === null) continue
      if (!this.literalAllowed(plan.def, def, v)) continue
      if (c instanceof Date && link?.comp.kind === 'date' && link.comp.calendarBacked) {
        const i = dayDiff(this.calStart, c)
        if (i < 0 || i >= this.nDays) continue
      }
      if (allowed && !allowed.has(valueKey(c))) continue
      out.push(c)
    }
    return out
  }

  /**
   * Foreign-key values of `plan` that lead (one or two hops) to rows of `target` satisfying `conds`.
   * Prefers active relationships. Adjusts up to a few target rows when none matches.
   */
  private readonly fkMemo = new Map<string, { col: ColumnData; keys: Scalar[] } | undefined>()

  private foreignKeysFor(plan: TablePlan, table: TableData, target: string, conds: Conjunction['conds']): { col: ColumnData; keys: Scalar[] } | undefined {
    const memoKey = `${plan.def.name}|${target}|${conds.map((c) => `${c.column}=${c.values.map((v) => (v instanceof Date ? v.getTime() : String(v))).join(',')}`).join('&')}`
    if (this.fkMemo.has(memoKey)) return this.fkMemo.get(memoKey)
    const res = this.foreignKeysForUncached(plan, table, target, conds)
    this.fkMemo.set(memoKey, res)
    return res
  }

  private foreignKeysForUncached(plan: TablePlan, table: TableData, target: string, conds: Conjunction['conds']): { col: ColumnData; keys: Scalar[] } | undefined {
    const outEdges = (t: string): Array<{ from: Member; to: Member; active: boolean }> =>
      this.edges.filter((e) => e.from.table.name.toLowerCase() === t).sort((a, b) => Number(b.active) - Number(a.active))
    for (const e of outEdges(plan.def.name.toLowerCase())) {
      const col = table.columns.find((c) => c.name === e.from.col.name)
      if (!col) continue
      const dim = e.to.table.name.toLowerCase()
      let keys: Scalar[] | undefined
      if (dim === target) keys = this.matchingKeys(dim, e.to.col.name, conds)
      else {
        // two hops: plan → dim → target
        for (const e2 of outEdges(dim)) {
          if (e2.to.table.name.toLowerCase() !== target) continue
          const targetKeys = this.matchingKeys(target, e2.to.col.name, conds)
          if (!targetKeys?.length) continue
          keys = this.matchingKeys(dim, e.to.col.name, [], { column: e2.from.col.name, keys: targetKeys })
          if (keys?.length) break
        }
      }
      if (keys?.length) {
        const def = plan.cols.find((c) => c.name === col.name)!
        const allowed = this.allowedValues(plan, col, keys)
        if (allowed.length) return { col, keys: allowed }
        void def
      }
    }
    return undefined
  }

  /** Key values of generated table rows that satisfy `conds` (and optionally `fk ∈ keys`); seeds a few rows if none do. */
  private matchingKeys(tableName: string, keyCol: string, conds: Conjunction['conds'], fk?: { column: string; keys: Scalar[] }): Scalar[] | undefined {
    const data = this.generated.get(tableName) ?? this.project.data.tables.get(this.plans.get(tableName)?.def.name ?? '')
    if (!data || !data.rowCount) return undefined
    const key = data.columns.find((c) => c.name.toLowerCase() === keyCol.toLowerCase())
    if (!key) return undefined
    const checks: Array<{ col: ColumnData; set: Set<string>; vals: Scalar[] }> = []
    for (const c of conds) {
      const col = data.columns.find((x) => x.name.toLowerCase() === c.column.toLowerCase())
      if (!col) continue // calculated column: cannot be checked here
      const vals = c.values.map((v) => coerceTo(v as Scalar, col.type)).filter((v): v is Exclude<Scalar, undefined | null> => v !== undefined && v !== null)
      if (!vals.length) return undefined
      checks.push({ col, set: new Set(vals.map(valueKey)), vals })
    }
    if (fk) {
      const col = data.columns.find((x) => x.name.toLowerCase() === fk.column.toLowerCase())
      if (!col) return undefined
      checks.push({ col, set: new Set(fk.keys.map(valueKey)), vals: fk.keys })
    }
    const hits: Scalar[] = []
    const scan = (): void => {
      const keys = checks.map((c) => this.cellKeys(c.col))
      for (let r = 0; r < data.rowCount; r++) {
        let ok = true
        for (let i = 0; i < checks.length && ok; i++) ok = keys[i][r] !== 'null' && checks[i].set.has(keys[i][r])
        if (ok) hits.push(key.values[r])
      }
    }
    scan()
    if (!hits.length && this.plans.get(tableName)?.role === 'dim' && this.generated.has(tableName)) {
      // adjust a few rows of the (generated) dimension so the combination exists; keys stay untouched
      const plan = this.plans.get(tableName)!
      if (checks.some((c) => this.compOf.get(keyOf(plan.def.name, c.col.name))?.member.one)) return undefined
      // privacy: a dimension row is never rewritten with a literal its column must not hold
      if (checks.some((c) => { const def = plan.cols.find((d) => d.name === c.col.name); return !!def && c.vals.some((v) => !this.literalAllowed(plan.def, def, v)) })) return []
      // only rows whose current values also appear elsewhere, so no value disappears from the dimension
      const counts = checks.map((c) => {
        const m = new Map<string, number>()
        for (const v of c.col.values) {
          const k = v === null ? 'null' : valueKey(v)
          m.set(k, (m.get(k) ?? 0) + 1)
        }
        return m
      })
      const rng = this.rng(plan.def.name, '#adjust', String(conds.length))
      const n = Math.min(data.rowCount, Math.max(1, Math.round(data.rowCount * 0.05)), 25)
      const stride = strideFor(data.rowCount)
      let r = rng.int(0, data.rowCount - 1)
      let done = 0
      for (let step = 0; step < data.rowCount && done < n; step++, r = (r + stride) % data.rowCount) {
        const ok = checks.every((c, i) => {
          const v = c.col.values[r]
          return (counts[i].get(v === null ? 'null' : valueKey(v)) ?? 0) > 1
        })
        if (!ok) continue
        checks.forEach((c, i) => {
          const v = c.col.values[r]
          const k = v === null ? 'null' : valueKey(v)
          counts[i].set(k, (counts[i].get(k) ?? 1) - 1)
          const nv = c.vals[done % c.vals.length]
          c.col.values[r] = nv
          counts[i].set(valueKey(nv), (counts[i].get(valueKey(nv)) ?? 0) + 1)
        })
        done++
      }
      if (!done) return []
      this.applySortBy(plan, data.columns)
      for (const c of data.columns) this.keyCache.delete(c)
      scan()
    }
    return hits.filter((v) => v !== null)
  }

  /**
   * Sort-by-column consistency: Power BI rejects a sort column with more than one value per value of
   * the sorted column, so make the sort column a function of the sorted one (rank for numeric sort
   * columns, mined/literal order first; serial numbers for dates; first-seen value otherwise).
   */
  private applySortBy(plan: TablePlan, columns: ColumnData[]): void {
    if (plan.role === 'date') return
    const pairs: Array<[ColumnDef, string]> = plan.cols.filter((c) => c.sortByColumn).map((c) => [c, c.sortByColumn!])
    // implicit sort keys: order_stage / stage_order / sort_stage / stage_sort → stage
    const byName = new Map(plan.cols.map((c) => [c.name.toLowerCase(), c]))
    for (const y of plan.cols) {
      const t = effectiveType(y)
      if (t !== 'int64' && t !== 'double' && t !== 'decimal') continue
      const toks = tokensOf(y.name)
      if (!toks.some((x) => x === 'order' || x === 'sort' || x === 'rank')) continue
      const rest = toks.filter((x) => !['order', 'sort', 'rank', 'desc', 'asc', 'by', 'key', 'no', 'num'].includes(x))
      if (!rest.length) continue
      const names = [rest.join('_'), rest.filter((x) => x !== 'full').join('_'), rest.join('')]
      const target = names.map((n) => byName.get(n)).find((c) => c && c !== y)
      if (target && !pairs.some(([c, n]) => c === target || n.toLowerCase() === y.name.toLowerCase())) pairs.push([target, y.name])
    }
    for (const [col, sortName] of pairs) {
      const x = columns.find((c) => c.name === col.name)
      const y = columns.find((c) => c.name.toLowerCase() === sortName.toLowerCase())
      if (!x || !y || x === y) continue
      // never rewrite relationship keys
      if (this.compOf.has(keyOf(plan.def.name, y.name))) continue
      const yType = effectiveType(plan.cols.find((c) => c.name === y.name)!)
      const desc = tokensOf(y.name).includes('desc')
      const numericY = yType === 'int64' || yType === 'double' || yType === 'decimal'
      const map = new Map<string, Scalar>()
      if (numericY) {
        const distinct: Scalar[] = []
        const seen = new Set<string>()
        const minedOrder = this.domains.get(domainKey(plan.def.name, col.name))?.values ?? []
        for (const v of minedOrder) {
          const k = valueKey(v)
          if (!seen.has(k)) {
            seen.add(k)
            distinct.push(v)
          }
        }
        const rest: Scalar[] = []
        for (const v of x.values) {
          if (v === null) continue
          const k = valueKey(v)
          if (!seen.has(k)) {
            seen.add(k)
            rest.push(v)
          }
        }
        const pool = columnSemantics(col, plan.def).pool
        const poolIdx = (v: Scalar): number => (pool && typeof v === 'string' ? pool.findIndex((p) => v.startsWith(p)) : -1)
        rest.sort((a, b) => {
          const pa = poolIdx(a)
          const pb = poolIdx(b)
          if (pa !== pb) return (pa < 0 ? 1e9 : pa) - (pb < 0 ? 1e9 : pb)
          if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
          if (typeof a === 'number' && typeof b === 'number') return a - b
          return String(a).localeCompare(String(b))
        })
        const all = [...distinct, ...rest]
        all.forEach((v, i) => {
          const rank = v instanceof Date ? Math.round(v.getTime() / 86400000) + 25569 : i + 1
          map.set(valueKey(v), desc ? -rank : rank)
        })
      }
      for (let r = 0; r < x.values.length; r++) {
        const v = x.values[r]
        const k = v === null ? 'null' : valueKey(v)
        if (!map.has(k)) map.set(k, numericY && v === null ? null : y.values[r])
        y.values[r] = map.get(k) ?? null
      }
    }
  }

  private generateColumn(plan: TablePlan, col: ColumnDef, h: RowHelpers): Scalar[] {
    const rows = plan.rows
    const out = new Array<Scalar>(rows)
    const type = effectiveType(col)
    if (type === 'binary') {
      out.fill(null)
      return out
    }
    const rng = this.rng(plan.def.name, col.name)
    const key = keyOf(plan.def.name, col.name)
    const link = this.compOf.get(key)
    if (link) {
      this.fillKey(plan, col, link.comp, link.member, h, rng, out)
      return out
    }
    if (plan.role === 'date' && plan.dateCol) {
      const probe = calendarValue(col.name, type, this.calStart, this.cal)
      if (col === plan.dateCol || probe !== undefined) {
        for (let r = 0; r < rows; r++) {
          const d = this.dayAt(r)
          const v = col === plan.dateCol ? d : calendarValue(col.name, type, d, this.cal)
          out[r] = v === undefined ? null : v
        }
        return out
      }
    }
    const mined = this.domains.get(domainKey(plan.def.name, col.name)) ?? this.sameNameDomain(plan, col)
    const sem = columnSemantics(col, plan.def)
    // privacy: literals from DAX / report filters never land in name-like, id-like or free-text columns
    const identifying = !this.reuseIdentifying && isIdentifyingColumn(sem)
    const usable = (v: Scalar): boolean => this.literalAllowed(plan.def, col, v)
    /** literals that must not appear in this column, not even by coincidence */
    const withheld = new Set<string>()
    const numericType = type === 'int64' || type === 'double' || type === 'decimal'
    // survey scales keep their skew: literals only widen the scale (and are guaranteed to appear), they do not flatten it
    const ordinal = numericType && (sem.sem === 'score' || sem.sem === 'nps')
    const scale = ordinal ? ordinalScale(sem.sem, (mined?.values ?? []).map((v) => coerceTo(v, type) ?? null)) : undefined
    const rawBase = this.baseGenerator(plan, col, sem, h, rng, scale)
    const base: (r: number) => Scalar =
      type === 'string'
        ? (r) => {
            const v = rawBase(r)
            return typeof v === 'number' || typeof v === 'boolean' || v instanceof Date ? (coerceTo(v, 'string') as string) : v
          }
        : rawBase
    const minedVals = (mined?.values ?? [])
      .map((v) => coerceTo(v, type))
      .filter((v): v is Exclude<Scalar, undefined> => v !== undefined && v !== null && !(typeof v === 'string' && v === ''))
      .filter((v) => {
        if (usable(v)) return true
        withheld.add(valueKey(v))
        return false
      })
      .filter((v) => !scale || (typeof v === 'number' && v >= scale.lo && v <= scale.hi))
    const uniqMined: Scalar[] = []
    const seenMined = new Set<string>()
    for (const v of minedVals) {
      const k = valueKey(v)
      if (!seenMined.has(k)) {
        seenMined.add(k)
        uniqMined.push(v)
      }
    }
    let gen = base
    if (uniqMined.length && !ordinal && type !== 'boolean' && type !== 'dateTime') {
      const linkedOnly = mined && mined.linked.length > 0
      const categorical =
        type === 'string'
          ? linkedOnly || !isFreeForm(sem.sem) || sem.toks.some((t) => CATEGORICAL_TOKENS.has(t) && t !== 'name')
          : ['flag', 'order', 'datePart', 'score', 'nps', 'idCode', 'sortDesc'].includes(sem.sem) || uniqMined.every((v) => typeof v === 'number' && Number.isInteger(v) && Math.abs(v) < 1000) && sem.sem === 'generic'
      let share: number
      if (type === 'string') share = categorical ? (uniqMined.length === 1 ? 0.65 : 1) : 0.7
      else share = categorical ? 0.75 : 0.1
      const order = rng.shuffle(uniqMined.map((_, i) => i))
      const w = new Float64Array(uniqMined.length)
      const zw = zipfWeights(uniqMined.length, 0.5)
      for (let rank = 0; rank < order.length; rank++) w[order[rank]] = zw[rank]
      const sampler = new WeightedSampler(w)
      const perRowDim = (plan.role === 'dim' || plan.role === 'single') && rows <= uniqMined.length * 2
      const sentiment = type === 'string' && categorical ? sentimentRanks(uniqMined) : undefined
      if (share >= 1 && perRowDim) {
        // small dimension keyed by the mined labels: one row per value (cycled), in a stable shuffled order
        gen = (r) => uniqMined[order[r % order.length]]
      } else if (sentiment) {
        // answer labels of a satisfaction scale (Promoter / Passive / Detractor, Satisfied / Dissatisfied…):
        // mostly positive, like real survey data, and in line with the row's other ratings
        const pick = this.sentimentPicker(sentiment, h, rng)
        gen = (r) => uniqMined[pick(r)]
      } else gen = share >= 1 ? () => uniqMined[sampler.draw(rng)] : (r) => (rng.next() < share ? uniqMined[sampler.draw(rng)] : base(r))
    }
    for (let r = 0; r < rows; r++) out[r] = gen(r)
    const skippedContains = identifying ? (mined?.contains.length ?? 0) : 0
    if (withheld.size || skippedContains) {
      const kind = sem.sem === 'text' ? 'text' : sem.sem === 'idCode' || sem.sem === 'idSeq' || sem.sem === 'guid' ? 'id' : 'name'
      this.withheld.push({ table: plan.def.name, column: col.name, literals: withheld.size + skippedContains, kind })
      // an invented value that happens to equal a withheld literal is replaced by another invented one
      for (let r = 0; r < rows && withheld.size; r++) {
        let v = out[r]
        for (let k = 1; k <= 8 && v !== null && withheld.has(valueKey(v)); k++) v = gen((r + k * 7919) % rows)
        if (v !== null && withheld.has(valueKey(v))) v = typeof v === 'string' ? `${v} (${(r % 97) + 2})` : null
        out[r] = v
      }
    }
    if (mined?.lookupKey && plan.role !== 'fact' && type !== 'boolean') makeUnique(out, type === 'string' ? uniquePool(sem) : [])
    // CONTAINSSTRING / SEARCH targets: embed the searched text in a share of the values
    if (type === 'string' && mined?.contains.length && !skippedContains) {
      for (let r = 0; r < rows; r++) {
        if (rng.next() < 0.2) {
          const lit = mined.contains[rng.int(0, mined.contains.length - 1)]
          const v = out[r]
          out[r] = v === null || v === '' ? lit : `${v} - ${lit}`
        }
      }
      this.ensureContains(out, mined.contains, rng)
    }
    if (type === 'dateTime') {
      const active = Math.max(1, this.todayIdx - this.windowStart + 1)
      const k = Math.max(1, Math.min(Math.round((1.5 * rows) / active), Math.floor(rows / (4 * Math.max(1, uniqMined.length)))))
      this.addNeeds(col, uniqMined, plan.role === 'fact' ? Math.max(3, k) : 1)
    } else this.addNeeds(col, uniqMined)
    return out
  }

  /** Index picker over labels ranked worst → best: survey-skewed weights, correlated with the row's latent satisfaction. */
  private sentimentPicker(ranks: { order: number[]; others: number[] }, h: RowHelpers, rng: Rng): (r: number) => number {
    const w = surveyWeights(ranks.order.length)
    const cum = new Float64Array(w.length)
    let acc = 0
    for (let i = 0; i < w.length; i++) cum[i] = acc += w[i]
    // labels that are not part of the scale ("N/A", "No answer") take a small share
    const otherShare = Math.min(0.12, 0.03 * ranks.others.length)
    return (r) => {
      if (ranks.others.length && rng.next() < otherShare) return ranks.others[rng.int(0, ranks.others.length - 1)]
      const u = normalCdf(0.75 * h.latent(r) + 0.6614 * rng.normal())
      let i = 0
      while (i < cum.length - 1 && u > cum[i]) i++
      return ranks.order[i]
    }
  }

  /**
   * Values of an ordinal survey scale lo…hi (ratings, scores, likelihood to recommend), skewed to the top
   * (see surveyWeights) and correlated across the columns of a row through the row's latent satisfaction.
   * `divide` > 1: the column uses a scale that much smaller than the canonical one (0–10 answers stored 0–5).
   */
  private ordinalGenerator(lo: number, hi: number, h: RowHelpers, rng: Rng, divide = 1): (r: number) => number {
    const n = Math.round(hi - lo) + 1
    const draw = (r: number): number => normalCdf(0.6 * h.latent(r) + 0.8 * rng.normal())
    if (n > 12) return (r) => Math.round((lo + (hi - lo) * Math.pow(draw(r), 0.3)) / divide)
    const w = surveyWeights(n)
    const cum = new Float64Array(n)
    let acc = 0
    for (let i = 0; i < n; i++) cum[i] = acc += w[i]
    return (r) => {
      const u = draw(r)
      let i = 0
      while (i < n - 1 && u > cum[i]) i++
      return divide > 1 ? Math.round((lo + i) / divide) : lo + i
    }
  }

  /**
   * Net-promoter consistency: a group column whose labels are Promoter / Passive / Detractor follows the
   * likelihood-to-recommend score of the same row (9–10 promoter, 7–8 passive, 0–6 detractor, relative to the
   * scale in use), as the source system computes it. Rows seeded for a conjunction keep their group and get a
   * score inside its band instead.
   */
  private alignScoreGroups(plan: TablePlan, table: TableData, protect: Uint8Array): void {
    if (!table.rowCount) return
    const numeric = (c: ColumnDef): boolean => ['int64', 'double', 'decimal'].includes(effectiveType(c))
    const scoreDef = plan.cols.find((c) => numeric(c) && columnSemantics(c, plan.def).sem === 'nps' && !this.compOf.has(keyOf(plan.def.name, c.name)))
    const score = scoreDef && table.columns.find((c) => c.name === scoreDef.name)
    if (!score) return
    let hi = 0
    for (const v of score.values) if (typeof v === 'number' && v > hi) hi = v
    if (hi <= 0) return
    // the scale in use: 0–10 unless the values never exceed a smaller round maximum
    const top = hi > 5 ? 10 : hi > 3 ? 5 : hi
    const bandOf = (v: number): 'promoter' | 'passive' | 'detractor' => (v >= 0.9 * top ? 'promoter' : v >= 0.7 * top ? 'passive' : 'detractor')
    const rng = this.rng(plan.def.name, '#nps')
    for (const def of plan.cols) {
      if (effectiveType(def) !== 'string' || this.compOf.has(keyOf(plan.def.name, def.name))) continue
      const col = table.columns.find((c) => c.name === def.name)
      if (!col) continue
      const labels = new Map<string, string>()
      for (const v of col.values) {
        if (typeof v !== 'string') continue
        const band = npsBandOf(v)
        if (band && !labels.has(band)) labels.set(band, v)
        if (labels.size === 3) break
      }
      if (!labels.has('promoter') || !labels.has('detractor')) continue
      if (!labels.has('passive')) {
        // formulas usually only name promoters and detractors; the middle band exists in the data all the same
        const like = labels.get('promoter')!
        const word = /s$/i.test(like) ? 'Passives' : 'Passive'
        labels.set('passive', like === like.toUpperCase() ? word.toUpperCase() : like === like.toLowerCase() ? word.toLowerCase() : word)
      }
      const fallback = labels.get('passive')!
      for (let r = 0; r < table.rowCount; r++) {
        const s = score.values[r]
        const g = col.values[r]
        if (protect[r] && typeof g === 'string' && npsBandOf(g)) {
          const band = npsBandOf(g)!
          if (typeof s === 'number' && bandOf(s) === band) continue
          const lo = band === 'promoter' ? Math.ceil(0.9 * top) : band === 'passive' ? Math.ceil(0.7 * top) : 0
          const up = band === 'promoter' ? top : band === 'passive' ? Math.ceil(0.9 * top) - 1 : Math.ceil(0.7 * top) - 1
          score.values[r] = rng.int(Math.min(lo, up), Math.max(lo, up))
        } else if (typeof s === 'number') col.values[r] = labels.get(bandOf(s)) ?? fallback
      }
    }
  }

  private ensureContains(out: Scalar[], subs: string[], rng: Rng): void {
    const rows = out.length
    if (!rows) return
    for (const s of subs) {
      const l = s.toLowerCase()
      if (out.some((v) => typeof v === 'string' && v.toLowerCase().includes(l))) continue
      const r = rng.int(0, rows - 1)
      out[r] = typeof out[r] === 'string' && out[r] ? `${out[r]} - ${s}` : s
    }
  }

  private fillKey(plan: TablePlan, col: ColumnDef, comp: Component, member: Member, h: RowHelpers, rng: Rng, out: Scalar[]): void {
    const rows = plan.rows
    const type = effectiveType(col)
    const conv = (v: Scalar): Scalar => {
      const c = coerceTo(v, type)
      return c === undefined ? null : c
    }
    if (comp.kind === 'date') {
      const valueOfDay = (i: number): Scalar => {
        if (!comp.calendarBacked) return comp.values[i] ?? null
        const d = this.dayAt(i)
        if (comp.dateDerive) {
          const v = calendarValue(comp.dateDerive.col.name, effectiveType(comp.dateDerive.col), d, this.cal)
          return v === undefined ? null : conv(v)
        }
        return conv(d)
      }
      if (member.one && plan.role === 'date') {
        for (let r = 0; r < rows; r++) out[r] = valueOfDay(r)
        return
      }
      if (member.one && !member.many) {
        // unique dates on a non-calendar one side: consecutive days ending today
        const n = comp.calendarBacked ? Math.min(rows, this.todayIdx + 1) : Math.min(rows, comp.values.length)
        for (let r = 0; r < rows; r++) out[r] = r < n ? valueOfDay(comp.calendarBacked ? this.todayIdx - n + 1 + r : r) : null
        return
      }
      if (comp.calendarBacked) {
        const offset = plan.snapshot?.col === col ? 0 : dateOffsetDays(col)
        const max = plan.snapshot ? member.limit - 1 : Math.min(this.todayIdx, member.limit - 1)
        for (let r = 0; r < rows; r++) {
          let i = h.baseDay(r)
          if (offset > 0) i += Math.floor(rng.next() * offset)
          out[r] = valueOfDay(Math.max(0, Math.min(max, i)))
        }
        // mined dates (slicers, filters, DAX) get a realistic number of rows each
        const mined = this.minedDatesFor(plan.def, col)
          .map((d) => dayDiff(this.calStart, d))
          .filter((i) => i >= 0 && i < Math.min(this.nDays, Math.max(1, member.limit)))
        if (mined.length && plan.snapshot?.col !== col) {
          const active = Math.max(1, this.todayIdx - this.windowStart + 1)
          const k = Math.max(3, Math.min(Math.round((1.5 * rows) / active), Math.floor(rows / (4 * mined.length))))
          this.addNeeds(col, mined.map(valueOfDay), k)
        }
        return
      }
      const n = comp.values.length
      for (let r = 0; r < rows; r++) out[r] = n ? comp.values[Math.min(n - 1, Math.floor(rng.next() * n))] : null
      return
    }
    if (member.one) {
      // unique keys: domain prefix (first `rows` values)
      for (let r = 0; r < rows; r++) out[r] = r < comp.values.length ? conv(comp.values[r]) : null
      return
    }
    const n = Math.min(member.limit, comp.values.length)
    const { sampler, perm } = this.compSampler(comp, n)
    if (n <= 0) {
      out.fill(null)
      return
    }
    const snap = plan.snapshot
    if (snap && snap.entity === col && snap.days.length) {
      // periodic snapshot: within each snapshot day, consecutive entities (each at most once per day)
      const group = Math.max(1, Math.ceil(rows / snap.days.length))
      for (let r = 0; r < rows; r++) {
        const g = Math.floor(r / group)
        out[r] = conv(comp.values[perm[(r - g * group + g * 7) % n]])
      }
    } else {
      for (let r = 0; r < rows; r++) {
        const idx = perm[sampler.draw(rng)]
        out[r] = conv(comp.values[Math.min(idx, n - 1)])
      }
    }
    // every referenced dimension member has rows (when there are enough rows), mined literals appear
    if (rows >= n) this.addNeeds(col, comp.values.slice(0, n).map(conv))
    const mined = this.domains.get(domainKey(plan.def.name, col.name))
    if (mined?.values.length) {
      const allowed = new Set(comp.values.slice(0, n).map((v) => valueKey(conv(v))))
      const vals = mined.values.map((v) => coerceTo(v, type)).filter((v): v is Exclude<Scalar, undefined | null> => v !== undefined && v !== null && allowed.has(valueKey(v)))
      this.addNeeds(col, vals, Math.max(1, Math.min(10, Math.floor(rows / (20 * Math.max(1, vals.length))))))
    }
  }

  /**
   * Values of the key of the generated table an `x_id` column most likely points to (no relationship
   * in the model): exact entity match first (`customer_id` → dim_customers.id), person-ish references
   * (`owner_id`, `created_by_id`) → the users/employees table. Returns undefined when nothing fits.
   */
  private implicitKeyValues(refToks: string[], self: TablePlan, type: DataType): Scalar[] | undefined {
    if (!refToks.length) return undefined
    const want = singular(refToks[refToks.length - 1])
    const personRef = refToks.some((t) => PERSON_TOKENS.has(t) || ['created', 'modified', 'updated', 'by', 'assigned'].includes(t))
    const candidates: TablePlan[] = []
    for (const p of this.plans.values()) if (p.role === 'dim' && entityOf(p.def.name) === want) candidates.push(p)
    if (!candidates.length && personRef) {
      for (const pref of ['user', 'employee', 'owner', 'staff', 'agent', 'rep']) {
        for (const p of this.plans.values()) if (p.role === 'dim' && entityOf(p.def.name) === pref) candidates.push(p)
      }
    }
    for (const p of candidates) {
      for (const c of p.cols) {
        const n = c.name.toLowerCase()
        if (n !== 'id' && n !== `${want}_id` && n !== `${want}id`) continue
        const link = this.compOf.get(keyOf(p.def.name, c.name))
        if (!link || !link.member.one) continue
        const rows = p === self ? Math.max(1, Math.floor(p.rows / 3)) : p.rows
        const out: Scalar[] = []
        for (const v of link.comp.values.slice(0, rows)) {
          const cv = coerceTo(v, type)
          if (cv === undefined || cv === null) return undefined
          out.push(cv)
        }
        return out
      }
    }
    return undefined
  }

  private baseGenerator(plan: TablePlan, col: ColumnDef, s: ColumnSemantics, h: RowHelpers, rng: Rng, scale?: { lo: number; hi: number }): (r: number) => Scalar {
    const type = effectiveType(col)
    const rows = plan.rows
    const toks = s.toks
    const has = (...xs: string[]): boolean => xs.some((x) => toks.includes(x))
    const numeric = type === 'int64' || type === 'double' || type === 'decimal'
    const num = (x: number): number => (type === 'int64' ? Math.round(x) : type === 'decimal' ? round2(x) : round2(x))
    const asType = (v: Scalar): Scalar => {
      const c = coerceTo(v, type)
      return c === undefined ? null : c
    }
    const zipfPick = <T,>(pool: readonly T[], sk = 0.8): (() => T) => {
      const order = rng.shuffle(pool.map((_, i) => i))
      const w = new Float64Array(pool.length)
      const zw = zipfWeights(pool.length, sk)
      for (let rank = 0; rank < order.length; rank++) w[order[rank]] = zw[rank]
      const smp = new WeightedSampler(w)
      return () => pool[smp.draw(rng)]
    }
    const ent = entityOf(plan.def.name)
    const perRow = plan.role === 'dim' || plan.role === 'single'

    switch (s.sem) {
      case 'date':
        return this.dateGenerator(plan, col, h, rng)
      case 'flag': {
        const p = has('active', 'enabled', 'valid', 'current', 'billable', 'primary', 'show', 'approved', 'verified', 'complete', 'completed', 'session')
          ? 0.75
          : has('deleted', 'removed', 'cancelled', 'canceled', 'test', 'excluded', 'exclude', 'hide', 'hidden', 'error', 'terminated', 'future', 'archived', 'duplicate')
            ? 0.06
            : 0.35
        if (type === 'boolean') return () => rng.next() < p
        if (numeric) return () => (rng.next() < p ? 1 : 0)
        return () => (rng.next() < p ? 'Yes' : 'No')
      }
      case 'idSeq':
        if (type === 'string') return (r) => `${ent.slice(0, 3).toUpperCase() || 'ID'}-${pad(r + 1, 5)}`
        return (r) => r + 1
      case 'idCode': {
        const refToks = toks.filter((t) => !['id', 'key', 'code', 'number', 'no', 'num', 'sk', 'fk', 'ext', 'external'].includes(t))
        const refEnt = refToks.length ? singular(refToks[refToks.length - 1]) : ''
        // implicit foreign key: `account_id` → the generated table whose entity is "account"
        const selfRef = refEnt === ent && !has('parent', 'grandparent', 'manager', 'related', 'master', 'root', 'ultimate', 'previous', 'prior', 'duplicate', 'merged')
        const implicit = selfRef ? undefined : this.implicitKeyValues(refToks, plan, type)
        if (implicit && implicit.length) {
          const smp = new WeightedSampler(zipfWeights(implicit.length, 0.8))
          const order = rng.shuffle(implicit.map((_, i) => i))
          return () => implicit[order[smp.draw(rng)]]
        }
        const strongUnique = has('external', 'ext', 'number', 'no', 'num', 'legacy', 'source', 'system', 'guid', 'uuid', 'code')
        const pooledRef = refToks.some((t) => PERSON_TOKENS.has(t) || ['parent', 'grandparent', 'created', 'modified', 'updated', 'by', 'assigned', 'campaign', 'broker', 'vendor', 'partner', 'industry', 'region', 'territory', 'role', 'service', 'product', 'program', 'team', 'source', 'group', 'type', 'category', 'status'].includes(t))
        const unique = perRow && !pooledRef && (refToks.length === 0 || refEnt === ent || strongUnique || toks.length === 1)
        const prefix = (refToks.find((t) => t !== 'by') ?? ent).slice(0, 3).toUpperCase() || 'ID'
        const card = Math.max(1, Math.min(rows, pooledRef && refToks.some((t) => PERSON_TOKENS.has(t) || ['created', 'modified', 'updated', 'by', 'assigned'].includes(t)) ? 40 : 200))
        const pick = new WeightedSampler(zipfWeights(card, 0.8))
        const base = 1000 + (hash32(col.name, this.seed) % 9000)
        if (numeric) return unique ? (r) => base * 10 + r * 3 + 1 : () => pick.draw(rng) + 1
        if (s.toks.includes('oid') || s.toks.includes('guid')) return unique ? (r) => guidFrom(hash32(plan.def.name + col.name, this.seed), r) : () => guidFrom(hash32(col.name, this.seed), pick.draw(rng))
        return unique ? (r) => `${prefix}-${pad(base + r, 6)}` : () => `${prefix}-${pad(pick.draw(rng) + 1, 5)}`
      }
      case 'guid':
        return perRow ? (r) => guidFrom(hash32(plan.def.name + col.name, this.seed), r) : () => guidFrom(hash32(col.name, this.seed), rng.int(0, Math.max(0, Math.min(rows, 500) - 1)))
      case 'email': {
        const domains = ['example.com', 'contoso.com', 'fabrikam.com', 'northwind.com', 'mail.com', 'outlook.com']
        return (r) => {
          const p = h.person(r)
          const d = perRow ? domains[(r * 7) % domains.length] : rng.pick(domains)
          return `${p.first}.${p.last}${perRow && r >= 1000 ? r : ''}@${d}`.toLowerCase()
        }
      }
      case 'phone':
        return () => `(${rng.int(201, 989)}) 555-${pad(rng.int(100, 9999), 4)}`
      case 'url':
        return (r) => `https://www.${h.company(r).toLowerCase().replace(/[^a-z]+/g, '')}.com/${rng.pick(['about', 'contact', 'products', 'services', 'home'])}`
      case 'image':
        return (r) => PLACEHOLDER_IMAGES[r % PLACEHOLDER_IMAGES.length]
      case 'zip':
        return numeric ? (r) => Number(h.place(r)[2] + pad(rng.int(1, 99), 2)) : (r) => h.place(r)[2] + pad(rng.int(1, 99), 2)
      case 'address':
        return () => streetAddress(rng)
      case 'city':
        return (r) => h.place(r)[0]
      case 'state': {
        const full = has('name', 'full', 'long')
        // a dimension *of states* lists each state once, code and name aligned per row
        if (perRow && tokensOf(plan.def.name).some((t) => singular(t) === 'state')) return (r) => US_STATES[r % US_STATES.length][full ? 1 : 0]
        const byAbbr = new Map(US_STATES.map(([a, n]) => [a, n]))
        return (r) => {
          const a = h.place(r)[1]
          return full ? (byAbbr.get(a) ?? a) : a
        }
      }
      case 'country': {
        const pick = zipfPick(COUNTRIES, 1.6)
        const iso = has('code', 'iso', 'abbr')
        return () => {
          const c = rng.next() < 0.75 ? 'United States' : pick()
          return iso ? c.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase().padEnd(2, 'X') : c
        }
      }
      case 'lat':
        return (r) => num(25 + ((hash32(h.place(r)[0]) % 2300) / 100) + rng.next() * 0.2)
      case 'lon':
        return (r) => num(-122 + ((hash32(h.place(r)[0], 7) % 5000) / 100) + rng.next() * 0.2)
      case 'firstName':
        return (r) => h.person(r).first
      case 'lastName':
        return (r) => h.person(r).last
      case 'person': {
        if (perRow && (PERSON_ENTITY.has(ent) || toks.length === 1 || has('full'))) return (r) => `${h.person(r).first} ${h.person(r).last}`
        const off = hash32(col.name, this.seed) % 3000
        const size = Math.max(1, Math.min(rows, has('owner', 'manager', 'rep', 'agent', 'specialist', 'counselor', 'supervisor', 'am') ? 25 : 60))
        const smp = new WeightedSampler(zipfWeights(size, 0.7))
        const names = Array.from({ length: size }, (_, k) => {
          const p = personName(off + k)
          return `${p.first} ${p.last}`
        })
        return () => names[smp.draw(rng)]
      }
      case 'company': {
        if (perRow && ORG_ENTITY.has(ent)) {
          // parent / grandparent organisation of an organisation dimension: several rows share one parent, and
          // each level up is a smaller set of (different) names, so the hierarchy rolls up like a real one
          const level = has('great') ? 3 : has('grandparent', 'ultimate') ? 2 : has('parent', 'holding') ? 1 : 0
          if (level > 0) {
            const span = [4, 12, 36][level - 1]
            return (r) => companyName((rows + 17 + level * 131 + Math.floor(r / span)) % COMPANY_NAME_COUNT)
          }
          return (r) => h.company(r)
        }
        const off = hash32(col.name, this.seed) % 1000
        const size = Math.max(1, Math.min(rows, 80))
        const smp = new WeightedSampler(zipfWeights(size, 0.8))
        const names = Array.from({ length: size }, (_, k) => companyName(off + k))
        return () => names[smp.draw(rng)]
      }
      case 'entityName': {
        const gen = labelGenerator(s, col, plan.def)
        if (perRow) return (r) => gen(r)
        const size = Math.max(1, Math.min(rows, 50))
        const smp = new WeightedSampler(zipfWeights(size, 0.8))
        return () => gen(smp.draw(rng))
      }
      case 'text': {
        // a pool of sentences (free text repeats a lot in real data too; also keeps generation fast)
        const words = has('notes', 'comments', 'feedback', 'description') ? 9 : 5
        const pool = Array.from({ length: Math.max(1, Math.min(rows, 400)) }, () => loremSentence(rng, words))
        return () => (rng.next() < 0.15 ? null : pool[Math.floor(rng.next() * pool.length)])
      }
      case 'category': {
        const pool = s.pool ?? ['A', 'B', 'C']
        const sentiment = perRow ? undefined : sentimentRanks([...pool])
        if (sentiment) {
          const at = this.sentimentPicker(sentiment, h, rng)
          return (r) => asType(pool[at(r)])
        }
        const pick = zipfPick(pool)
        return () => asType(pick())
      }
      case 'datePart':
        return (r) => {
          const d = this.dayAt(h.baseDay(r))
          const v = calendarValue(col.name, type, d, this.cal)
          return v === undefined ? asType(d.getUTCFullYear()) : v
        }
      case 'money': {
        const median = has('annual', 'salary', 'income', 'arr', 'acv', 'tcv', 'contract')
          ? 60000
          : has('price', 'fee', 'fees', 'rate', 'hourly', 'cost', 'charge', 'premium', 'msrp')
              ? 120
              : has('commission', 'discount', 'tax', 'refund', 'freight')
                ? 400
                : has('budget')
                  ? 25000
                  : 2500
        const sigma = has('rate', 'hourly') ? 0.35 : 0.9
        return (r) => num(Math.max(0, median * h.scale(r) * Math.exp(sigma * 0.6 * rng.normal())))
      }
      case 'pct':
        if (type === 'int64') return () => Math.round(Math.pow(rng.next(), 1.2) * 100)
        if (type === 'string') return () => `${Math.round(Math.pow(rng.next(), 1.2) * 100)}%`
        return () => Math.round(Math.pow(rng.next(), 1.2) * 10000) / 10000
      case 'count':
        return (r) => asType(Math.max(0, Math.round(rng.lognormal(has('total', 'sessions', 'calls', 'traffic', 'offered', 'served', 'serviced', 'handled') ? 8 : 3, 0.8) * (0.5 + 0.5 * h.scale(r)))))
      case 'population':
        return () => asType(Math.max(1, Math.round(rng.lognormal(650, 1.3))))
      case 'duration': {
        const med = s.unit === 'seconds' ? 180 : s.unit === 'hours' ? 4 : s.unit === 'days' ? 12 : 25
        return () => {
          const v = rng.lognormal(med, 0.8)
          return type === 'int64' ? Math.max(0, Math.round(v)) : type === 'string' ? String(Math.round(v)) : Math.round(v * 10) / 10
        }
      }
      case 'score':
      case 'nps': {
        // a source that a calculated table multiplies by k (its siblings are copied as they are) stores answers
        // on a scale k times smaller
        const divide = this.scaleHints.get(keyOf(plan.def.name, col.name)) ?? 1
        const lo = scale?.lo ?? (s.sem === 'nps' ? 0 : 1)
        const hi = scale?.hi ?? (s.sem === 'nps' ? 10 : 5)
        const pick = this.ordinalGenerator(lo, hi, h, rng, divide)
        return (r) => asType(pick(r))
      }
      case 'age':
        return () => asType(Math.round(18 + Math.pow(rng.next(), 1.1) * 57))
      case 'order':
        if (perRow || plan.role === 'fact') return (r) => asType(has('tier', 'level', 'priority', 'grade', 'class', 'type', 'category', 'status', 'code', 'model', 'version') ? (r % 5) + 1 : r + 1)
        return (r) => asType(r + 1)
      case 'sortDesc':
        return (r) => asType(-(r + 1))
      case 'generic':
      default: {
        if (numeric) {
          if (type === 'int64') {
            const card = Math.max(1, Math.min(100, rows))
            const smp = new WeightedSampler(zipfWeights(card, 0.6))
            return () => smp.draw(rng) + 1
          }
          return (r) => num(rng.lognormal(100, 0.8) * (0.6 + 0.4 * h.scale(r)))
        }
        // unknown text attribute: a dozen distinct labels ("Ownership 3") rather than one per row
        const label = labelGenerator(s, col, plan.def)
        const card = Math.max(1, Math.min(rows, 12))
        const smp = new WeightedSampler(zipfWeights(card, 0.8))
        return () => label(smp.draw(rng))
      }
    }
  }

  private dateGenerator(plan: TablePlan, col: ColumnDef, h: RowHelpers, rng: Rng): (r: number) => Scalar {
    const toks = tokensOf(col.name)
    const flat = col.name.toLowerCase()
    const has = (...xs: string[]): boolean => xs.some((x) => toks.includes(x) || flat.includes(x))
    // PBI annotates the source type: UnderlyingDateTimeDataType = Date | DateTime | Time
    const udt = (col.annotations?.UnderlyingDateTimeDataType ?? '').toLowerCase()
    const nameSaysTime =
      /general date|hh|h:mm/i.test(col.formatString ?? '') ||
      toks.includes('at') ||
      toks.includes('ts') ||
      has('time', 'timestamp', 'datetime', 'utc', 'modifiedon', 'createdon')
    const wantsTime = udt === 'datetime' || (udt !== 'date' && nameSaysTime)
    const time = (d: Date): Date => (wantsTime ? new Date(d.getTime() + (rng.int(7, 19) * 3600 + rng.int(0, 59) * 60 + rng.int(0, 59)) * 1000) : d)
    if (has('dob', 'birth', 'birthday')) {
      return () => {
        const years = 18 + Math.floor(rng.next() * 57)
        return addDays(this.today, -(years * 365 + rng.int(0, 364)))
      }
    }
    if (has('refresh', 'loaded', 'load', 'etl', 'snapshot_ts') && (plan.role === 'single' || plan.rows <= 1)) {
      return () => (wantsTime ? new Date(this.today.getTime() + 6 * 3600000) : this.today)
    }
    if (plan.snapshot?.col === col) return (r) => this.dayAt(h.baseDay(r))
    if (isWeekEndName(col.name)) {
      // week-end dates fall on the calendar's week-end weekday; a dimension of weeks lists consecutive weeks
      // ending with the current one (so it lines up with calendar[week_end] values and measures comparing them)
      const wed = this.cal.weekEndDow ?? 6
      const snap = (d: Date): Date => addDays(d, (wed - d.getUTCDay() + 7) % 7)
      const current = snap(this.today)
      if (plan.role === 'dim' || plan.role === 'single') return (r) => addDays(current, -7 * (plan.rows - 1 - r))
      return (r) => snap(this.dayAt(Math.max(0, Math.min(this.todayIdx, h.baseDay(r)))))
    }
    const optional = has('termination', 'terminated', 'deleted', 'cancel', 'cancelled', 'canceled', 'churn', 'inactive', 'end_date', 'enddate', 'expir', 'deactivat')
    const offset = dateOffsetDays(col)
    const future = has('due', 'expected', 'renewal', 'expiration', 'expiry', 'scheduled', 'target', 'planned', 'forecast')
    const maxIdx = future ? Math.min(this.nDays - 1, this.todayIdx + 120) : this.todayIdx
    return (r) => {
      if (optional && rng.next() < 0.8) return null
      let i = h.baseDay(r)
      if (offset > 0) i += Math.floor(rng.next() * offset)
      i = Math.max(0, Math.min(maxIdx, i))
      return time(this.dayAt(i))
    }
  }
}

/** A stride coprime with n, for visiting rows in a scattered but deterministic order. */
function strideFor(n: number): number {
  if (n <= 2) return 1
  for (const p of [7919, 104729, 1299709, 15485863, 982451653]) if (n % p !== 0) return p % n || 1
  return 1
}

/**
 * Make each needed value appear at least `n` times, overwriting rows whose value is not needed (or is
 * over-represented). Protected rows (seeded conjunctions) are never touched. Best effort, O(rows).
 */
function applyNeeds(out: Scalar[], needs: Array<{ v: Scalar; n: number }>, rng: Rng, protect: Uint8Array): void {
  const rows = out.length
  if (!rows || !needs.length) return
  const req = new Map<string, { v: Scalar; n: number }>()
  for (const x of needs) {
    const k = valueKey(x.v)
    const prev = req.get(k)
    if (!prev || prev.n < x.n) req.set(k, { v: x.v, n: x.n })
  }
  const counts = new Map<string, number>()
  for (const v of out) {
    const k = v === null ? 'null' : valueKey(v)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  // deficits in round-robin order so every value gets its first row before any gets its second
  const deficits: Array<{ v: Scalar; k: string; d: number }> = []
  for (const [k, x] of req) {
    const d = x.n - (counts.get(k) ?? 0)
    if (d > 0) deficits.push({ v: x.v, k, d })
  }
  if (!deficits.length) return
  const fills: Array<{ v: Scalar; k: string }> = []
  let maxD = 0
  for (const x of deficits) maxD = Math.max(maxD, x.d)
  for (let round = 0; round < maxD && fills.length < rows; round++) for (const x of deficits) if (x.d > round) fills.push({ v: x.v, k: x.k })
  let fi = 0
  const stride = strideFor(rows)
  let r = rng.int(0, rows - 1)
  for (let step = 0; step < rows && fi < fills.length; step++, r = (r + stride) % rows) {
    if (protect[r]) continue
    const cur = out[r]
    const k = cur === null ? 'null' : valueKey(cur)
    const need = req.get(k)
    const c = counts.get(k) ?? 0
    if (need && c <= need.n) continue
    const f = fills[fi++]
    counts.set(k, c - 1)
    counts.set(f.k, (counts.get(f.k) ?? 0) + 1)
    out[r] = f.v
  }
}

/** Days a date column trails the row's base date (created ≤ … ≤ modified ordering). */
function dateOffsetDays(col: ColumnDef): number {
  const toks = tokensOf(col.name)
  const flat = col.name.toLowerCase()
  const has = (...xs: string[]): boolean => xs.some((x) => toks.includes(x) || flat.includes(x))
  if (has('created', 'create', 'open', 'opened', 'start', 'entry', 'received', 'submitted', 'inception', 'effective', 'begin', 'signup', 'hire', 'enrolled', 'registered', 'requested')) return 0
  if (has('closed', 'close', 'closing', 'resolved', 'completed', 'complete', 'end', 'modified', 'updated', 'last', 'termination', 'finished', 'paid', 'shipped', 'delivered', 'cancel'))
    return 75
  if (has('due', 'expected', 'implementation', 'scheduled', 'target', 'renewal', 'go_live', 'golive', 'billing')) return 45
  return 0
}

/**
 * A calendar query that stops at the current date: it mentions the clock (`DateTime.LocalNow()` …) and no
 * end-of-period / shifted bound (`Date.EndOfYear(…)`, `Date.AddYears(…)`), which would mean it runs past today.
 */
function endsToday(m: string | undefined): boolean {
  if (!m) return false
  return /\b(DateTime|DateTimeZone)\.(Fixed)?(Local|Utc)Now\b/.test(m) && !/\bDate\.(EndOf(Year|Quarter|Month)|AddYears|AddMonths|AddQuarters)\b/.test(m)
}

function looksFactual(cols: ColumnDef[]): boolean {
  let measures = 0
  let dates = 0
  for (const c of cols) {
    const t = effectiveType(c)
    if (t === 'dateTime') dates++
    if ((t === 'double' || t === 'decimal' || t === 'int64') && tokensOf(c.name).some((x) => MONEY_TOKENS.has(x) || COUNT_TOKENS.has(x))) measures++
  }
  return dates > 0 && measures > 0
}

/** k-th distinct label for a column's semantic kind (used for label-style keys and entity names). */
function labelGenerator(s: ColumnSemantics, col: ColumnDef, table: TableDef): (k: number) => string {
  const ent = entityOf(table.name)
  const suffix = (base: string, k: number, len: number): string => (k < len ? base : `${base} ${Math.floor(k / len) + 1}`)
  switch (s.sem) {
    case 'person':
    case 'firstName':
    case 'lastName':
      return (k) => {
        const p = personName(k)
        return s.sem === 'firstName' ? suffix(p.first, k, 120) : s.sem === 'lastName' ? suffix(p.last, k, 100) : `${p.first} ${p.last}`
      }
    case 'company':
      return (k) => companyName(k)
    case 'state': {
      const full = s.toks.includes('name')
      return (k) => suffix(US_STATES[k % US_STATES.length][full ? 1 : 0], k, US_STATES.length)
    }
    case 'city':
      return (k) => suffix(US_CITIES[k % US_CITIES.length][0], k, US_CITIES.length)
    case 'country':
      return (k) => suffix(COUNTRIES[k % COUNTRIES.length], k, COUNTRIES.length)
    case 'category': {
      const pool = s.pool ?? ['A']
      return (k) => suffix(pool[k % pool.length], k, pool.length)
    }
    case 'entityName': {
      const other = s.toks.filter((t) => t !== 'name' && t !== 'title' && t !== 'label')
      const base = titleCase(other.length ? other.join(' ') : ent)
      return (k) => `${base} ${k + 1}`
    }
    default: {
      // short label from the most specific token ("primary_presenting_concern" → "Concern 3")
      const stop = new Set(['the', 'of', 'a', 'an', 'what', 'which', 'is', 'are', 'primary', 'secondary', 'current', 'new', 'old', 'name', 'value', 'text', 'desc', 'raw', 'clean', 'cleaned', 'mapped'])
      const toks = tokensOf(col.name).filter((t) => !stop.has(t) && !/^\d+$/.test(t))
      const base = titleCase(toks[toks.length - 1] ?? 'Value')
      return (k) => `${base} ${k + 1}`
    }
  }
}

/**
 * Generate schema-driven synthetic data into `project.data` (mutates it) for every import table
 * without data. Returns the names of the tables that were filled.
 */
/** Finite value pools a unique column can draw fresh values from (states, cities, countries). */
function uniquePool(s: ColumnSemantics): Scalar[] {
  const has = (...w: string[]) => w.some((x) => s.toks.includes(x))
  if (s.sem === 'state') return US_STATES.map(([a, n]) => (has('name', 'full', 'long') ? n : a))
  if (s.sem === 'city') return US_CITIES.map(([c]) => c)
  if (s.sem === 'country') return [...COUNTRIES]
  return []
}

/**
 * LOOKUPVALUE search columns on dimension-like tables: LOOKUPVALUE fails ("A table of multiple values
 * was supplied…") when a searched value matches several rows, so repeated values are replaced by unused
 * pool values (a 50-row state table then lists each state once), else by numbered variants ("TX 2").
 * Blanks stay blank.
 */
function makeUnique(out: Scalar[], pool: Scalar[]): void {
  const seen = new Set<string>()
  const dupes: number[] = []
  for (let r = 0; r < out.length; r++) {
    const v = out[r]
    if (v === null || v === undefined) continue
    const k = valueKey(v)
    if (seen.has(k)) dupes.push(r)
    else seen.add(k)
  }
  let p = 0
  for (const r of dupes) {
    while (p < pool.length && seen.has(valueKey(pool[p]))) p++
    let next: Scalar
    if (p < pool.length) next = pool[p++]
    else {
      const v = out[r]!
      for (let n = 2; ; n++) {
        const c: Scalar = typeof v === 'number' ? v + n * out.length : v instanceof Date ? new Date(v.getTime() + n * 86400000) : `${String(v)} ${n}`
        if (!seen.has(valueKey(c))) {
          next = c
          break
        }
      }
    }
    seen.add(valueKey(next))
    out[r] = next
  }
}

export function generateSyntheticData(project: ProjectDocument, opts: SyntheticOptions = {}): SyntheticResult {
  const gen = new SyntheticGenerator(project, opts)
  gen.plan()
  gen.buildComponents()
  gen.resolveSizes()
  const tables = gen.generate()
  return { tables, skipped: gen.skipped, seed: gen.seed, withheld: gen.withheld }
}
