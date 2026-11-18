/**
 * Time intelligence. Dates are handled as day numbers (days since 1970-01-01); results keep the lineage of the
 * date column and contain the column's actual values (date-times whose day matches are kept as they are).
 */
import { DaxError } from './errors.ts'
import type { Evaluator } from './evaluator.ts'
import type { Col, DaxModel } from './model.ts'
import type { CallNode, Node } from './parser.ts'
import { defineFn as register, type Env, type FnImpl, type FnMeta } from './registry.ts'
import { TableValue } from './table.ts'
import { dayNumber, fromDayNumber, makeDate, parseDateText, toDate, toNumber, toText, type Scalar } from './values.ts'

/**
 * Time-intelligence table functions over a plain date column with constant other arguments only depend on the
 * column's visible dates: their result is shared (same table object, so its filter conversion is cached too) by
 * every cell with the same visible dates — e.g. a YTD measure in a matrix whose rows do not filter the date table.
 */
function defineFn(names: string | string[], impl: FnImpl, meta: FnMeta = {}): void {
  register(names, meta.table ? memoizedByDates(impl) : impl, meta)
}

const timeMemo = new WeakMap<Evaluator, WeakMap<Node, WeakMap<Int32Array, TableValue>>>()

function memoizedByDates(impl: FnImpl): FnImpl {
  return (ev, a, env, node) => {
    const first = a[0]
    if (!first || first.kind !== 'column' || env.rows.length > env.transitioned || !a.slice(1).every((x) => constArg(ev, x, env))) return impl(ev, a, env, node)
    const col = ev.measureFor(first) ? null : ev.tryColumn(first)
    if (!col) return impl(ev, a, env, node)
    const codes = ev.visibleCodes(col, env.ctx, false)
    let byNode = timeMemo.get(ev)
    if (!byNode) timeMemo.set(ev, (byNode = new WeakMap()))
    let byCodes = byNode.get(node)
    if (!byCodes) byNode.set(node, (byCodes = new WeakMap()))
    const hit = byCodes.get(codes)
    if (hit) return hit
    const out = impl(ev, a, env, node)
    if (out instanceof TableValue) byCodes.set(codes, out)
    return out
  }
}

function constArg(ev: Evaluator, n: Node, env: Env): boolean {
  if (n.kind === 'number' || n.kind === 'string' || n.kind === 'bool') return true
  if (n.kind === 'unary') return constArg(ev, n.operand, env)
  if (n.kind === 'ident') return n.name === '__missing__' || ev.lookupVar(n.name, env) === undefined
  return false
}

type Period = 'YEAR' | 'QUARTER' | 'MONTH'
type Interval = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR'

const missing = (n: Node | undefined) => !n || (n.kind === 'ident' && n.name === '__missing__')

interface DayIndex {
  days: number[]
  set: Set<number>
  /** dictionary codes holding each day (several when values carry a time part) */
  codesOfDay: Map<number, number[]>
  /** day number of each dictionary code (NaN for blank / non-dates) */
  dayOfCode: Float64Array
  /** DATEADD-style shifts per "n|interval": source day -> target days (existing ones only) */
  shifts: Map<string, Map<number, number[]>>
}
const allDaysCache = new WeakMap<DaxModel, { version: number; map: Map<Col, DayIndex> }>()

function allDays(ev: Evaluator, col: Col): DayIndex {
  let c = allDaysCache.get(ev.model)
  if (!c || c.version !== ev.model.version) {
    c = { version: ev.model.version, map: new Map() }
    allDaysCache.set(ev.model, c)
  }
  let e = c.map.get(col)
  if (!e) {
    const set = new Set<number>()
    const codesOfDay = new Map<number, number[]>()
    const dayOfCode = new Float64Array(col.dict.length).fill(NaN)
    for (let i = 1; i < col.dict.length; i++) {
      const v = col.dict[i]
      const d = v instanceof Date ? dayNumber(v) : typeof v === 'number' ? dayNumber(toDate(v)!) : null
      if (d === null) continue
      if (v instanceof Date) dayOfCode[i] = d
      set.add(d)
      if (v instanceof Date) {
        const l = codesOfDay.get(d)
        if (l) l.push(i)
        else codesOfDay.set(d, [i])
      }
    }
    const days = [...set].sort((x, y) => x - y)
    e = { days, set, codesOfDay, dayOfCode, shifts: new Map() }
    c.map.set(col, e)
  }
  return e
}

function checkDateCol(col: Col, fn: string): void {
  if (col.dataType !== 'dateTime' && col.dataType !== 'unknown' && col.dataType !== 'variant')
    throw new DaxError('TYPE', `Function '${fn}' expects a date column, but ${col.label} has type ${col.dataType}.`)
}

/** Dates argument: a date column (visible values) or a one-column table of dates with lineage. */
function datesArg(ev: Evaluator, node: Node, env: Env, fn: string): { col: Col; days: number[] } {
  const ctx = ev.transition(env)
  if (node.kind === 'column') {
    const col = ev.resolveColumn(node, fn)
    checkDateCol(col, fn)
    const codes = ev.visibleCodes(col, ctx, false)
    const dayOfCode = allDays(ev, col).dayOfCode
    const out = new Float64Array(codes.length)
    let k = 0
    for (let i = 0; i < codes.length; i++) {
      const d = dayOfCode[codes[i]]
      if (d === d) out[k++] = d
    }
    const sorted = out.subarray(0, k).sort()
    const days: number[] = []
    for (let i = 0; i < sorted.length; i++) if (i === 0 || sorted[i] !== sorted[i - 1]) days.push(sorted[i])
    return { col, days }
  }
  const t = ev.table(node, { ...env, ctx, transitioned: env.rows.length }, fn)
  const col = t.cols.length === 1 ? t.cols[0].lineage : null
  if (!col) throw new DaxError('ARG', `${fn} needs a date column, or a one-column table of dates with lineage to a date column.`, node)
  const set = new Set<number>()
  for (const v of t.column(0)) if (v instanceof Date) set.add(dayNumber(v))
  return { col, days: [...set].sort((x, y) => x - y) }
}

/** Table of the column's values whose day is in `days` (ascending). */
function result(col: Col, days: Iterable<number>, ev?: Evaluator): TableValue {
  const vals: Scalar[] = []
  if (ev) {
    const idx = allDays(ev, col).codesOfDay
    const ds = [...days].sort((a, b) => a - b)
    for (const d of ds) {
      const codes = idx.get(d)
      if (!codes) continue
      if (codes.length === 1) vals.push(col.dict[codes[0]])
      else for (const c of [...codes].sort((a, b) => (col.dict[a] as Date).getTime() - (col.dict[b] as Date).getTime())) vals.push(col.dict[c])
    }
  } else {
    const want = days instanceof Set ? days : new Set(days)
    for (let i = 1; i < col.dict.length; i++) {
      const v = col.dict[i]
      if (v instanceof Date && want.has(dayNumber(v))) vals.push(v)
    }
    vals.sort((a, b) => (a as Date).getTime() - (b as Date).getTime())
  }
  return new TableValue([{ name: col.name, lineage: col, dataType: col.dataType }], [vals], vals.length)
}

function ymd(day: number): { y: number; m: number; d: number } {
  const dt = fromDayNumber(day)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}
function dayOf(y: number, m: number, d: number): number {
  return dayNumber(makeDate(y, m, d))
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Start of the period containing `day`; `yearEndMonth` shifts the fiscal year (12 = calendar). */
function periodStart(day: number, period: Period, yearEndMonth = 12): number {
  const { y, m } = ymd(day)
  if (period === 'MONTH') return dayOf(y, m, 1)
  if (period === 'QUARTER') {
    const startMonth = yearEndMonth % 3 + 1 // quarters aligned to the fiscal year end
    const off = (m - startMonth + 12) % 3
    return dayOf(y, m - off, 1)
  }
  const fyStartMonth = (yearEndMonth % 12) + 1
  const sy = m >= fyStartMonth ? y : y - 1
  return dayOf(fyStartMonth === 1 ? y : sy, fyStartMonth, 1)
}
function periodEnd(day: number, period: Period, yearEndMonth = 12): number {
  const start = ymd(periodStart(day, period, yearEndMonth))
  const months = period === 'YEAR' ? 12 : period === 'QUARTER' ? 3 : 1
  return dayOf(start.y, start.m + months, 0)
}

function yearEndArg(ev: Evaluator, n: Node | undefined, env: Env): number {
  if (missing(n)) return 12
  const v = ev.scalar(n!, env)
  if (v === null) return 12
  if (v instanceof Date) return v.getUTCMonth() + 1
  const s = toText(v).trim()
  const m = /^(\d{1,2})[/-](\d{1,2})$/.exec(s)
  if (m) {
    // month/day (en-US); day/month when the first number cannot be a month ("30/6")
    const a = Number(m[1])
    const b = Number(m[2])
    if (a >= 1 && a <= 12) return a
    if (b >= 1 && b <= 12) return b
  }
  const d = parseDateText(s) ?? parseDateText(`${s}/2000`)
  if (d) return d.getUTCMonth() + 1
  throw new DaxError('ARG', `The year-end date '${s}' is not valid.`)
}

function shiftDay(day: number, n: number, iv: Interval): number {
  if (iv === 'DAY') return day + n
  if (iv === 'WEEK') return day + 7 * n
  const { y, m, d } = ymd(day)
  const total = y * 12 + (m - 1) + n * (iv === 'MONTH' ? 1 : iv === 'QUARTER' ? 3 : 12)
  const ty = Math.floor(total / 12)
  const tm = (total % 12) + 1
  return dayOf(ty, tm, Math.min(d, daysInMonth(ty, tm)))
}

function parseInterval(n: Node | undefined, fn: string): Interval {
  const name = n && n.kind === 'ident' ? n.name.toUpperCase() : n && n.kind === 'string' ? n.value.toUpperCase() : ''
  if (name === 'DAY' || name === 'MONTH' || name === 'QUARTER' || name === 'YEAR' || name === 'WEEK') return name
  throw new DaxError('ARG', `${fn}: the interval must be DAY, MONTH, QUARTER or YEAR.`, n)
}

export function dateAddDays(visible: readonly number[], n: number, iv: Interval, all: Set<number>, index?: DayIndex): number[] {
  if (iv === 'DAY' || iv === 'WEEK') {
    const out: number[] = []
    for (const d of visible) {
      const x = d + (iv === 'WEEK' ? 7 * n : n)
      if (all.has(x)) out.push(x)
    }
    return out
  }
  const shifts = index ? shiftTable(index, n, iv) : null
  const out = new Set<number>()
  for (const day of visible) {
    const hit = shifts?.get(day)
    if (hit) {
      for (const x of hit) out.add(x)
      continue
    }
    for (const x of shiftOne(day, n, iv)) if (all.has(x)) out.add(x)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * Target days of one source day: the same day n intervals away (clamped to the month end); a month-end source day
 * maps to the whole tail of the target month (DATEADD ( ..., -1, MONTH ) of 28 Feb includes 28-31 Jan).
 */
function shiftOne(day: number, n: number, iv: Interval): number[] {
  const { y, m, d } = ymd(day)
  const start = shiftDay(day, n, iv)
  if (d !== daysInMonth(y, m)) return [start]
  const t = ymd(start)
  const end = dayOf(t.y, t.m, daysInMonth(t.y, t.m))
  const out: number[] = []
  for (let x = start; x <= end; x++) out.push(x)
  return out
}

function shiftTable(index: DayIndex, n: number, iv: Interval): Map<number, number[]> {
  const key = `${n}|${iv}`
  let m = index.shifts.get(key)
  if (!m) {
    m = new Map()
    for (const day of index.days) m.set(day, shiftOne(day, n, iv).filter((x) => index.set.has(x)))
    index.shifts.set(key, m)
  }
  return m
}

const inRange = (all: number[], from: number, to: number) => all.filter((d) => d >= from && d <= to)

// ---- DATESxTD / TOTALxTD --------------------------------------------------------------------------

function datesToDate(ev: Evaluator, a: Node[], env: Env, period: Period, fn: string): TableValue {
  const { col, days } = datesArg(ev, a[0], env, fn)
  if (days.length === 0) return result(col, [], ev)
  const ye = period === 'YEAR' ? yearEndArg(ev, a[1], env) : 12
  const last = days[days.length - 1]
  return result(col, inRange(allDays(ev, col).days, periodStart(last, period, ye), last), ev)
}
defineFn('DATESYTD', (ev, a, env) => datesToDate(ev, a, env, 'YEAR', 'DATESYTD'), { table: true, min: 1, max: 2, context: true })
defineFn('DATESQTD', (ev, a, env) => datesToDate(ev, a, env, 'QUARTER', 'DATESQTD'), { table: true, min: 1, max: 1, context: true })
defineFn('DATESMTD', (ev, a, env) => datesToDate(ev, a, env, 'MONTH', 'DATESMTD'), { table: true, min: 1, max: 1, context: true })

function call(name: string, args: Node[], at: CallNode): CallNode {
  return { kind: 'call', name, args, s: at.s, e: at.e }
}

for (const [fn, inner] of [
  ['TOTALYTD', 'DATESYTD'],
  ['TOTALQTD', 'DATESQTD'],
  ['TOTALMTD', 'DATESMTD']
] as const) {
  defineFn(
    fn,
    (ev, a, env, node) => {
      const filters: Node[] = []
      const dargs: Node[] = [a[1]]
      for (const x of a.slice(2)) {
        if (x.kind === 'string' && fn === 'TOTALYTD') dargs.push(x)
        else if (!missing(x)) filters.push(x)
      }
      return ev.scalar(call('CALCULATE', [a[0], call(inner, dargs, node), ...filters], node), env)
    },
    { min: 2, max: 4, context: true }
  )
}

// ---- shifting ------------------------------------------------------------------------------------

defineFn(
  'SAMEPERIODLASTYEAR',
  (ev, a, env) => {
    const { col, days } = datesArg(ev, a[0], env, 'SAMEPERIODLASTYEAR')
    return result(col, dateAddDays(days, -1, 'YEAR', allDays(ev, col).set, allDays(ev, col)), ev)
  },
  { table: true, min: 1, max: 1, context: true }
)
defineFn(
  'DATEADD',
  (ev, a, env) => {
    const { col, days } = datesArg(ev, a[0], env, 'DATEADD')
    const n = Math.trunc(toNumber(ev.scalar(a[1], env)))
    return result(col, dateAddDays(days, n, parseInterval(a[2], 'DATEADD'), allDays(ev, col).set, allDays(ev, col)), ev)
  },
  { table: true, min: 3, max: 3, context: true }
)
defineFn(
  'PARALLELPERIOD',
  (ev, a, env) => {
    const { col, days } = datesArg(ev, a[0], env, 'PARALLELPERIOD')
    if (days.length === 0) return result(col, [], ev)
    const n = Math.trunc(toNumber(ev.scalar(a[1], env)))
    const iv = parseInterval(a[2], 'PARALLELPERIOD')
    if (iv === 'DAY' || iv === 'WEEK') return result(col, dateAddDays(days, n, iv, allDays(ev, col).set), ev)
    const first = shiftDay(days[0], n, iv)
    const last = shiftDay(days[days.length - 1], n, iv)
    return result(col, inRange(allDays(ev, col).days, periodStart(first, iv), periodEnd(last, iv)), ev)
  },
  { table: true, min: 3, max: 3, context: true }
)
defineFn(
  'DATESBETWEEN',
  (ev, a, env) => {
    const col = ev.resolveColumn(a[0], 'DATESBETWEEN')
    checkDateCol(col, 'DATESBETWEEN')
    const all = allDays(ev, col).days
    const s = ev.scalar(a[1], env)
    const e = ev.scalar(a[2], env)
    const from = s === null ? -Infinity : dayNumber(toDate(s)!)
    const to = e === null ? Infinity : dayNumber(toDate(e)!)
    return result(col, inRange(all, from, to), ev)
  },
  { table: true, min: 3, max: 3, context: true }
)
defineFn(
  'DATESINPERIOD',
  (ev, a, env) => {
    const col = ev.resolveColumn(a[0], 'DATESINPERIOD')
    checkDateCol(col, 'DATESINPERIOD')
    const sv = ev.scalar(a[1], env)
    if (sv === null) return result(col, [], ev)
    const start = dayNumber(toDate(sv)!)
    const n = Math.trunc(toNumber(ev.scalar(a[2], env)))
    const iv = parseInterval(a[3], 'DATESINPERIOD')
    const end = shiftDay(start, n, iv)
    const all = allDays(ev, col).days
    return result(col, n >= 0 ? all.filter((d) => d >= start && d < end) : all.filter((d) => d > end && d <= start), ev)
  },
  { table: true, min: 4, max: 4, context: true }
)

// ---- previous / next -----------------------------------------------------------------------------

for (const period of ['DAY', 'MONTH', 'QUARTER', 'YEAR'] as const) {
  defineFn(
    `PREVIOUS${period}`,
    (ev, a, env) => {
      const { col, days } = datesArg(ev, a[0], env, `PREVIOUS${period}`)
      if (!days.length) return result(col, [], ev)
      const all = allDays(ev, col).days
      if (period === 'DAY') return result(col, inRange(all, days[0] - 1, days[0] - 1), ev)
      const ye = period === 'YEAR' ? yearEndArg(ev, a[1], env) : 12
      const prevEnd = periodStart(days[0], period, ye) - 1
      return result(col, inRange(all, periodStart(prevEnd, period, ye), prevEnd), ev)
    },
    { table: true, min: 1, max: 2, context: true }
  )
  defineFn(
    `NEXT${period}`,
    (ev, a, env) => {
      const { col, days } = datesArg(ev, a[0], env, `NEXT${period}`)
      if (!days.length) return result(col, [], ev)
      const all = allDays(ev, col).days
      const last = days[days.length - 1]
      if (period === 'DAY') return result(col, inRange(all, last + 1, last + 1), ev)
      const ye = period === 'YEAR' ? yearEndArg(ev, a[1], env) : 12
      const nextStart = periodEnd(last, period, ye) + 1
      return result(col, inRange(all, nextStart, periodEnd(nextStart, period, ye)), ev)
    },
    { table: true, min: 1, max: 2, context: true }
  )
}

for (const period of ['MONTH', 'QUARTER', 'YEAR'] as const) {
  defineFn(
    `STARTOF${period}`,
    (ev, a, env) => {
      const { col, days } = datesArg(ev, a[0], env, `STARTOF${period}`)
      if (!days.length) return result(col, [], ev)
      const ye = period === 'YEAR' ? yearEndArg(ev, a[1], env) : 12
      const start = periodStart(days[0], period, ye)
      const first = allDays(ev, col).days.find((d) => d >= start && d <= days[0])
      return result(col, first === undefined ? [] : [first], ev)
    },
    { table: true, min: 1, max: 2, context: true }
  )
  defineFn(
    `ENDOF${period}`,
    (ev, a, env) => {
      const { col, days } = datesArg(ev, a[0], env, `ENDOF${period}`)
      if (!days.length) return result(col, [], ev)
      const ye = period === 'YEAR' ? yearEndArg(ev, a[1], env) : 12
      const last = days[days.length - 1]
      const end = periodEnd(last, period, ye)
      const all = allDays(ev, col).days
      let pick: number | undefined
      for (const d of all) if (d >= last && d <= end) pick = d
      return result(col, pick === undefined ? [] : [pick], ev)
    },
    { table: true, min: 1, max: 2, context: true }
  )
  for (const kind of ['OPENINGBALANCE', 'CLOSINGBALANCE'] as const) {
    defineFn(
      `${kind}${period}`,
      (ev, a, env, node) => {
        const filters = a.slice(2).filter((x) => !(x.kind === 'string') && !missing(x))
        const yeArg = a.slice(2).find((x) => x.kind === 'string')
        const dates =
          kind === 'CLOSINGBALANCE'
            ? call(`ENDOF${period}`, yeArg ? [a[1], yeArg] : [a[1]], node)
            : call('PREVIOUSDAY', [call(`STARTOF${period}`, yeArg ? [a[1], yeArg] : [a[1]], node)], node)
        return ev.scalar(call('CALCULATE', [a[0], dates, ...filters], node), env)
      },
      { min: 2, max: 4, context: true }
    )
  }
}

defineFn(
  ['FIRSTDATE', 'LASTDATE'],
  (ev, a, env, node) => {
    const { col, days } = datesArg(ev, a[0], env, node.name.toUpperCase())
    if (!days.length) return result(col, [], ev)
    return result(col, [node.name.toUpperCase() === 'FIRSTDATE' ? days[0] : days[days.length - 1]], ev)
  },
  { table: true, min: 1, max: 1, context: true }
)
