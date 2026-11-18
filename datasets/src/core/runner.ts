/**
 * Runs a universe: builds the GenContext, prepends the framework's conformed date (and time)
 * dimensions, type-checks every row against its TableSpec and converts rows to the Lumen
 * `TableData` contract. `collectUniverse` materialises everything in memory (tiny/small scale,
 * tests, in-app samples); the Node writer streams batches instead.
 */
import type { ColumnData, Scalar, TableData } from '../../../src/core/model/data.ts'
import { dateDimRows, GENERIC_HOLIDAYS, timeDimRows, ymd } from './calendar.ts'
import { Rng } from './prng.ts'
import { c, kindToDataType, SCALES } from './schema.ts'
import type { Batch, BronzeFile, ColumnSpec, GenContext, Row, ScaleName, TableSpec, Universe } from './schema.ts'

export interface RunOptions {
  seed: number
  scale: ScaleName
  /** last day of history */
  today: Date
}

export const DEFAULT_TODAY = ymd(2026, 11, 30)

export function makeContext(u: Universe, o: RunOptions, issues: Map<string, number>): GenContext {
  const scale = SCALES[o.scale]
  const todayYear = o.today.getUTCFullYear()
  const root = new Rng(`${o.seed}:${u.id}:${o.scale}`)
  return {
    seed: o.seed,
    scale,
    today: o.today,
    start: ymd(todayYear - scale.years + 1, 1, 1),
    calendarEnd: ymd(todayYear, 12, 31),
    tiny: o.scale === 'tiny',
    rng: (label: string) => root.fork(label),
    n: (small: number, min = 1) => Math.max(min, Math.round(small * scale.factor)),
    issue: (code: string, count = 1) => {
      issues.set(code, (issues.get(code) ?? 0) + count)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Framework tables

export const DATE_TABLE = 'gold_dim_date'
export const TIME_TABLE = 'gold_dim_time'

export function dateDimSpec(): TableSpec {
  return {
    name: DATE_TABLE,
    layer: 'gold',
    kind: 'dim',
    description: 'Conformed calendar with fiscal periods, holidays and offsets relative to "today". Marked as the date table.',
    grain: 'One row per calendar day (full calendar years).',
    key: ['date_key'],
    columns: [
      c('date_key', 'int', 'Surrogate key yyyymmdd.', { hidden: true }),
      c('date', 'date', 'Calendar date.', { folder: 'Calendar' }),
      c('year', 'int', 'Calendar year.', { folder: 'Calendar', format: '0' }),
      c('quarter', 'int', 'Calendar quarter number 1-4.', { folder: 'Calendar', hidden: true }),
      c('quarter_label', 'string', 'Quarter label, e.g. "Q3".', { folder: 'Calendar', sortBy: 'quarter' }),
      c('year_quarter', 'string', 'Year and quarter, e.g. "2026 Q3".', { folder: 'Calendar', sortBy: 'year_quarter_key' }),
      c('year_quarter_key', 'int', 'Sortable year*10+quarter.', { hidden: true }),
      c('month', 'int', 'Month number 1-12.', { folder: 'Calendar', format: '0' }),
      c('month_name', 'string', 'Month name.', { folder: 'Calendar', sortBy: 'month' }),
      c('month_short', 'string', 'Three-letter month name.', { folder: 'Calendar', sortBy: 'month' }),
      c('year_month', 'string', 'Year-month, e.g. "2026-03".', { folder: 'Calendar', sortBy: 'year_month_key' }),
      c('year_month_key', 'int', 'Sortable year*100+month.', { hidden: true }),
      c('month_start', 'date', 'First day of the month (handy for monthly line charts).', { folder: 'Calendar' }),
      c('week_of_year', 'int', 'ISO week number.', { folder: 'Calendar', format: '0' }),
      c('iso_year', 'int', 'ISO week-numbering year.', { folder: 'Calendar', format: '0' }),
      c('week_start', 'date', 'Monday of the ISO week.', { folder: 'Calendar' }),
      c('day_of_month', 'int', 'Day of month.', { folder: 'Calendar', format: '0' }),
      c('day_of_year', 'int', 'Day of year 1-366.', { folder: 'Calendar', format: '0' }),
      c('day_of_week', 'int', 'ISO weekday 1 = Monday ... 7 = Sunday.', { folder: 'Calendar', format: '0' }),
      c('day_name', 'string', 'Weekday name.', { folder: 'Calendar', sortBy: 'day_of_week' }),
      c('day_short', 'string', 'Three-letter weekday name.', { folder: 'Calendar', sortBy: 'day_of_week' }),
      c('is_weekend', 'bool', 'Saturday or Sunday.', { folder: 'Flags' }),
      c('is_holiday', 'bool', 'Company holiday.', { folder: 'Flags' }),
      c('holiday_name', 'string', 'Holiday name (blank on ordinary days).', { folder: 'Flags' }),
      c('is_working_day', 'bool', 'Weekday that is not a holiday.', { folder: 'Flags' }),
      c('fiscal_year', 'int', 'Fiscal year number (named after the calendar year it ends in).', { folder: 'Fiscal', format: '0' }),
      c('fiscal_year_label', 'string', 'Fiscal year label, e.g. "FY27".', { folder: 'Fiscal', sortBy: 'fiscal_year' }),
      c('fiscal_quarter', 'int', 'Fiscal quarter 1-4.', { folder: 'Fiscal', format: '0' }),
      c('fiscal_quarter_label', 'string', 'Fiscal quarter label, e.g. "FY27 Q2".', { folder: 'Fiscal', sortBy: 'fiscal_quarter_key' }),
      c('fiscal_quarter_key', 'int', 'Sortable fiscal_year*10+fiscal_quarter.', { hidden: true }),
      c('fiscal_month', 'int', 'Fiscal month 1-12.', { folder: 'Fiscal', format: '0' }),
      c('is_past', 'bool', 'On or before "today" (the last day of generated history).', { folder: 'Flags' }),
      c('day_offset', 'int', 'Days relative to today (0 = today, -1 = yesterday).', { folder: 'Offsets', format: '0' }),
      c('month_offset', 'int', 'Months relative to the current month.', { folder: 'Offsets', format: '0' }),
      c('year_offset', 'int', 'Years relative to the current year.', { folder: 'Offsets', format: '0' })
    ],
    model: {
      name: 'Date',
      dateColumn: 'date',
      description: 'Calendar + fiscal date table (marked as date table).',
      hierarchies: [
        { name: 'Calendar', levels: ['year', 'year_quarter', 'year_month', 'date'] },
        { name: 'Fiscal', levels: ['fiscal_year_label', 'fiscal_quarter_label', 'year_month', 'date'] }
      ]
    }
  }
}

export function timeDimSpec(): TableSpec {
  return {
    name: TIME_TABLE,
    layer: 'gold',
    kind: 'dim',
    description: 'Time of day at 15-minute grain with day parts and peak flags.',
    grain: 'One row per 15-minute slot (96 rows).',
    key: ['time_key'],
    columns: [
      c('time_key', 'int', 'Surrogate key hhmm (e.g. 1345).', { hidden: true }),
      c('time_label', 'string', 'Slot start "HH:MM".', { sortBy: 'time_key' }),
      c('hour', 'int', 'Hour 0-23.', { format: '0' }),
      c('minute', 'int', 'Minute of the slot start (0, 15, 30, 45).', { format: '0' }),
      c('hour_label', 'string', 'Hour on a 12-hour clock, e.g. "7 AM".', { sortBy: 'hour' }),
      c('day_part', 'string', 'Night / Morning / Midday / Afternoon / Evening.'),
      c('is_peak', 'bool', 'Typical rush slot (07-10, 12-14, 17-19).')
    ],
    model: { name: 'Time', hierarchies: [{ name: 'Time of Day', levels: ['day_part', 'hour_label', 'time_label'] }] }
  }
}

export function allTables(u: Universe): TableSpec[] {
  const extra = [dateDimSpec()]
  if (u.timeDim) extra.push(timeDimSpec())
  return [...u.tables, ...extra]
}

function frameworkBatch(u: Universe, ctx: GenContext): Batch {
  const dateRows = dateDimRows({
    start: ctx.start,
    end: ctx.calendarEnd,
    today: ctx.today,
    fiscalStartMonth: u.fiscalYearStartMonth,
    holidays: u.holidays.length ? u.holidays : GENERIC_HOLIDAYS
  }).map((r) => ({ ...r, fiscal_quarter_key: (r.fiscal_year as number) * 10 + (r.fiscal_quarter as number) }))
  const tables: Record<string, Row[]> = { [DATE_TABLE]: dateRows }
  if (u.timeDim) tables[TIME_TABLE] = timeDimRows(15)
  return { label: 'calendar', tables }
}

// ---------------------------------------------------------------------------------------------
// Row checking & conversion

function checkValue(spec: TableSpec, col: ColumnSpec, v: Scalar): void {
  if (v === null || v === undefined) return
  const bad = (what: string) => {
    throw new Error(`${spec.name}.${col.name}: expected ${what}, got ${typeof v === 'object' ? Object.prototype.toString.call(v) : JSON.stringify(v)}`)
  }
  switch (col.kind) {
    case 'string':
      if (typeof v !== 'string') bad('string')
      break
    case 'int':
      if (typeof v !== 'number' || !Number.isInteger(v)) bad('integer')
      break
    case 'double':
    case 'decimal':
      if (typeof v !== 'number' || !Number.isFinite(v)) bad('finite number')
      break
    case 'bool':
      if (typeof v !== 'boolean') bad('boolean')
      break
    case 'date':
      if (!(v instanceof Date) || Number.isNaN(v.getTime())) bad('Date')
      else if (v.getUTCHours() !== 0 || v.getUTCMinutes() !== 0 || v.getUTCSeconds() !== 0) bad('date without time')
      break
    case 'timestamp':
      if (!(v instanceof Date) || Number.isNaN(v.getTime())) bad('Date')
      break
  }
}

/** Convert rows to TableData (columns in spec order). Throws on unknown columns or type mismatches. */
export function rowsToTable(spec: TableSpec, rows: Row[]): TableData {
  const known = new Set(spec.columns.map((c) => c.name))
  const columns: ColumnData[] = spec.columns.map((col) => ({ name: col.name, type: kindToDataType(col.kind), values: new Array<Scalar>(rows.length) }))
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    for (const k in row) if (!known.has(k)) throw new Error(`${spec.name}: unknown column "${k}"`)
    for (let i = 0; i < spec.columns.length; i++) {
      const col = spec.columns[i]
      let v = row[col.name]
      if (v === undefined) v = null
      if (col.kind === 'decimal' && typeof v === 'number') v = Math.round(v * 100) / 100
      checkValue(spec, col, v)
      if (v === null && col.nullable === false) throw new Error(`${spec.name}.${col.name}: null in non-nullable column`)
      columns[i].values[r] = v
    }
  }
  return { columns, rowCount: rows.length }
}

export function concatTables(spec: TableSpec, parts: TableData[]): TableData {
  if (parts.length === 1) return parts[0]
  const columns: ColumnData[] = spec.columns.map((col, i) => {
    const values: Scalar[] = []
    for (const p of parts) {
      const src = p.columns[i].values
      for (let k = 0; k < src.length; k++) values.push(src[k])
    }
    return { name: col.name, type: kindToDataType(col.kind), values }
  })
  return { columns, rowCount: columns[0]?.values.length ?? 0 }
}

export interface ConvertedBatch {
  label: string
  tables: Map<string, TableData>
  bronze: BronzeFile[]
}

/** Run a universe as a stream of type-checked batches (framework dims first). */
export function* runUniverse(u: Universe, o: RunOptions, issues: Map<string, number> = new Map()): Generator<ConvertedBatch> {
  const ctx = makeContext(u, o, issues)
  const specs = new Map(allTables(u).map((t) => [t.name, t]))
  const convert = (b: Batch): ConvertedBatch => {
    const tables = new Map<string, TableData>()
    for (const [name, rows] of Object.entries(b.tables)) {
      const spec = specs.get(name)
      if (!spec) throw new Error(`${u.id}: batch "${b.label}" has rows for undeclared table ${name}`)
      if (rows.length) tables.set(name, rowsToTable(spec, rows))
    }
    return { label: b.label, tables, bronze: b.bronze ?? [] }
  }
  yield convert(frameworkBatch(u, ctx))
  for (const b of u.generate(ctx)) yield convert(b)
}

export interface Collected {
  universe: Universe
  options: RunOptions
  specs: TableSpec[]
  tables: Map<string, TableData>
  bronze: BronzeFile[]
  issues: Map<string, number>
}

/** Materialise a whole universe in memory. */
export function collectUniverse(u: Universe, o: RunOptions): Collected {
  const issues = new Map<string, number>()
  const specs = allTables(u)
  const parts = new Map<string, TableData[]>()
  const bronze: BronzeFile[] = []
  for (const b of runUniverse(u, o, issues)) {
    for (const [name, t] of b.tables) {
      let list = parts.get(name)
      if (!list) parts.set(name, (list = []))
      list.push(t)
    }
    bronze.push(...b.bronze)
  }
  const tables = new Map<string, TableData>()
  for (const spec of specs) {
    const list = parts.get(spec.name)
    tables.set(spec.name, list ? concatTables(spec, list) : rowsToTable(spec, []))
  }
  return { universe: u, options: o, specs, tables, bronze, issues }
}
