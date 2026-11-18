/**
 * Bronze data-quality "chaos": injectors that plant documented issues into raw rows, and detectors
 * that prove each documented issue is really present in the emitted bronze files (used by tests and
 * by the README's issue table).
 *
 * Injectors mutate/return `BronzeRow[]` and report how many instances they planted through
 * `sink.issue(code, n)`. Counts use stochastic rounding of `rate * rows`; pass `atLeast` to
 * guarantee presence in small files (tiny scale).
 */
import { addDays, dateOnly, isoDate, ymd } from './calendar.ts'
import type { Rng } from './prng.ts'
import type { BronzeFile, BronzeRow, BronzeValue, IssueDoc } from './schema.ts'

export interface IssueSink {
  issue(code: string, count?: number): void
}

export interface InjectOpts {
  rng: Rng
  sink: IssueSink
  code: string
  rate: number
  atLeast?: number
}

function howMany(n: number, o: InjectOpts): number {
  if (n === 0) return 0
  const exact = n * o.rate
  let k = Math.floor(exact)
  if (o.rng.next() < exact - k) k++
  return Math.min(n, Math.max(k, o.atLeast ?? 0))
}

function pickIndexes(rows: BronzeRow[], o: InjectOpts, filter?: (r: BronzeRow) => boolean): number[] {
  const candidates: number[] = []
  for (let i = 0; i < rows.length; i++) if (!filter || filter(rows[i])) candidates.push(i)
  const k = howMany(candidates.length, o)
  return o.rng.sample(candidates, k).sort((a, b) => a - b)
}

export function getPath(row: BronzeRow, path: string): BronzeValue | undefined {
  if (!path.includes('.')) return row[path]
  let cur: BronzeValue | undefined = row
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || Array.isArray(cur) || cur instanceof Date) return undefined
    cur = (cur as Record<string, BronzeValue>)[part]
  }
  return cur
}

export function setPath(row: BronzeRow, path: string, value: BronzeValue): void {
  if (!path.includes('.')) {
    row[path] = value
    return
  }
  const parts = path.split('.')
  let cur = row as Record<string, BronzeValue>
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]]
    if (next === null || typeof next !== 'object' || Array.isArray(next) || next instanceof Date) return
    cur = next as Record<string, BronzeValue>
  }
  cur[parts[parts.length - 1]] = value
}

/** Exact duplicate rows (re-sent records). Returns a new array with copies inserted right after originals. */
export function injectDuplicates(rows: BronzeRow[], o: InjectOpts): BronzeRow[] {
  const idx = new Set(pickIndexes(rows, o))
  if (idx.size === 0) return rows
  const out: BronzeRow[] = []
  for (let i = 0; i < rows.length; i++) {
    out.push(rows[i])
    if (idx.has(i)) out.push(structuredCloneRow(rows[i]))
  }
  o.sink.issue(o.code, idx.size)
  return out
}

function structuredCloneRow(r: BronzeRow): BronzeRow {
  const copy: BronzeRow = {}
  for (const [k, v] of Object.entries(r)) copy[k] = cloneValue(v)
  return copy
}

function cloneValue(v: BronzeValue): BronzeValue {
  if (v instanceof Date) return new Date(v.getTime())
  if (Array.isArray(v)) return v.map(cloneValue)
  if (v !== null && typeof v === 'object') {
    const o: Record<string, BronzeValue> = {}
    for (const [k, x] of Object.entries(v)) o[k] = cloneValue(x)
    return o
  }
  return v
}

/** Blank out a column (null, '' or a literal like 'NULL'). */
export function injectNulls(rows: BronzeRow[], column: string, o: InjectOpts & { blank?: null | string }): void {
  const idx = pickIndexes(rows, o, (r) => !isBlank(getPath(r, column)))
  for (const i of idx) setPath(rows[i], column, o.blank === undefined ? null : o.blank)
  o.sink.issue(o.code, idx.length)
}

/** Leading/trailing whitespace (and the odd tab) around string values. */
export function injectWhitespace(rows: BronzeRow[], column: string, o: InjectOpts): void {
  const idx = pickIndexes(rows, o, (r) => typeof getPath(r, column) === 'string')
  const pads = ['  ', ' ', '\t', '   ']
  for (const i of idx) {
    const v = getPath(rows[i], column) as string
    const mode = o.rng.int(0, 2)
    const pad = o.rng.pick(pads)
    setPath(rows[i], column, mode === 0 ? pad + v : mode === 1 ? v + pad : `${pad}${v}${pad}`)
  }
  o.sink.issue(o.code, idx.length)
}

/** Inconsistent casing: UPPER, lower or tItLe-ish variants of the same value. */
export function injectCasing(rows: BronzeRow[], column: string, o: InjectOpts): void {
  const idx = pickIndexes(rows, o, (r) => {
    const v = getPath(r, column)
    return typeof v === 'string' && v.toUpperCase() !== v.toLowerCase()
  })
  let n = 0
  for (const i of idx) {
    const v = getPath(rows[i], column) as string
    const variants = [v.toUpperCase(), v.toLowerCase(), v.replace(/\b\w/g, (ch) => ch.toLowerCase())].filter((x) => x !== v)
    if (variants.length === 0) continue
    setPath(rows[i], column, o.rng.pick(variants))
    n++
  }
  o.sink.issue(o.code, n)
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type DateFormatName = 'iso' | 'us' | 'eu' | 'slash_iso' | 'epoch' | 'long' | 'iso_t'

export function formatDate(d: Date, fmt: DateFormatName): string {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  const p = (n: number) => String(n).padStart(2, '0')
  const hasTime = d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0
  const time = hasTime ? ` ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` : ''
  switch (fmt) {
    case 'iso':
      return `${y}-${p(m)}-${p(day)}${time}`
    case 'iso_t':
      return `${y}-${p(m)}-${p(day)}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`
    case 'us':
      return `${m}/${day}/${y}${time}`
    case 'eu':
      return `${p(day)}.${p(m)}.${y}${time}`
    case 'slash_iso':
      return `${y}/${p(m)}/${p(day)}${time}`
    case 'epoch':
      return String(Math.floor(d.getTime() / 1000))
    case 'long':
      return `${MONTHS_SHORT[m - 1]} ${day}, ${y}${time}`
  }
}

/** Re-format some Date values in a column with alternative formats (the rest keep the default ISO). */
export function injectDateFormats(rows: BronzeRow[], column: string, o: InjectOpts & { formats?: DateFormatName[] }): void {
  const formats = o.formats ?? ['us', 'eu', 'slash_iso', 'long']
  const idx = pickIndexes(rows, o, (r) => getPath(r, column) instanceof Date)
  for (const i of idx) setPath(rows[i], column, formatDate(getPath(rows[i], column) as Date, o.rng.pick(formats)))
  o.sink.issue(o.code, idx.length)
}

/** Sentinel placeholders instead of real values (-999, 'N/A', 'TBD'...). */
export function injectSentinels(rows: BronzeRow[], column: string, o: InjectOpts & { sentinels: BronzeValue[] }): void {
  const idx = pickIndexes(rows, o)
  for (const i of idx) setPath(rows[i], column, o.rng.pick(o.sentinels))
  o.sink.issue(o.code, idx.length)
}

/** Numbers exported as display text: "$1,234.50", "1.234,50 €", "12,5". */
export function injectFormattedNumbers(rows: BronzeRow[], column: string, o: InjectOpts & { currency?: string; currencyCode?: string }): void {
  const idx = pickIndexes(rows, o, (r) => typeof getPath(r, column) === 'number')
  const cur = o.currency ?? '$'
  for (const i of idx) {
    const v = getPath(rows[i], column) as number
    const mode = o.rng.int(0, 2)
    const fixed = v.toFixed(2)
    const [ip, fp] = fixed.split('.')
    const grouped = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    setPath(rows[i], column, mode === 0 ? `${cur}${grouped}.${fp}` : mode === 1 ? `${grouped.replace(/,/g, '.')},${fp}` : `${fixed} ${o.currencyCode ?? 'USD'}`)
  }
  o.sink.issue(o.code, idx.length)
}

/** Outliers: sign flips (refunds keyed as negatives / sensor glitches) or fat-finger extremes. */
export function injectOutliers(rows: BronzeRow[], column: string, o: InjectOpts & { mode: 'negative' | 'extreme'; factor?: number }): void {
  const idx = pickIndexes(rows, o, (r) => {
    const v = getPath(r, column)
    return typeof v === 'number' && v > 0
  })
  for (const i of idx) {
    const v = getPath(rows[i], column) as number
    setPath(rows[i], column, o.mode === 'negative' ? -v : Math.round(v * (o.factor ?? o.rng.pick([100, 1000, 250])) * 100) / 100)
  }
  o.sink.issue(o.code, idx.length)
}

/** Replace foreign keys with values that do not exist in the reference set. */
export function injectOrphans(rows: BronzeRow[], column: string, o: InjectOpts & { make: (rng: Rng) => BronzeValue }): void {
  const idx = pickIndexes(rows, o)
  for (const i of idx) setPath(rows[i], column, o.make(o.rng))
  o.sink.issue(o.code, idx.length)
}

/**
 * Late-arriving records: returns the day a record *lands* in the bronze drop. Most land on their
 * event day; `rate` of them arrive 2..maxDelay days late (reported to the sink).
 */
export function landingDay(eventDay: Date, o: InjectOpts & { maxDelay?: number }): Date {
  if (o.rng.next() < o.rate) {
    o.sink.issue(o.code, 1)
    return addDays(dateOnly(eventDay), o.rng.int(2, Math.max(2, o.maxDelay ?? 6)))
  }
  return dateOnly(eventDay)
}

// ---------------------------------------------------------------------------------------------
// Detectors

function isBlank(v: BronzeValue | undefined): boolean {
  return v === null || v === undefined || (typeof v === 'string' && (v.trim() === '' || /^(null|n\/a|na|none|-)$/i.test(v.trim())))
}

function asNumber(v: BronzeValue | undefined): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v)
  return null
}

const DATE_PATTERNS: Array<[string, RegExp]> = [
  ['iso', /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/],
  ['iso_t', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?$/],
  ['us', /^\d{1,2}\/\d{1,2}\/\d{4}( \d{2}:\d{2}(:\d{2})?)?$/],
  ['eu', /^\d{2}\.\d{2}\.\d{4}( \d{2}:\d{2}(:\d{2})?)?$/],
  ['slash_iso', /^\d{4}\/\d{2}\/\d{2}( \d{2}:\d{2}(:\d{2})?)?$/],
  ['epoch', /^\d{9,10}$/],
  ['long', /^[A-Z][a-z]{2} \d{1,2}, \d{4}( \d{2}:\d{2}(:\d{2})?)?$/]
]

export function classifyDate(v: BronzeValue | undefined): string | null {
  if (v instanceof Date) return 'iso'
  if (typeof v !== 'string') return null
  for (const [name, re] of DATE_PATTERNS) if (re.test(v.trim())) return name
  return null
}

/** Parse any planted date format back to a Date (UTC wall clock). */
export function parseAnyDate(v: BronzeValue | undefined): Date | null {
  if (v instanceof Date) return v
  if (typeof v !== 'string') return null
  const s = v.trim()
  let m = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s)
  if (m) return ymd(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)
  if (m) return ymd(+m[3], +m[1], +m[2], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
  m = /^(\d{2})\.(\d{2})\.(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)
  if (m) return ymd(+m[3], +m[2], +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
  m = /^(\d{9,10})$/.exec(s)
  if (m) return new Date(+m[1] * 1000)
  m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)
  if (m) return ymd(+m[3], MONTHS_SHORT.indexOf(m[1]) + 1, +m[2], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
  return null
}

function fileDate(path: string): Date | null {
  const m = /(\d{4})[/-]?(\d{2})[/-]?(\d{2})(?!\d)/.exec(path)
  return m ? ymd(+m[1], +m[2], +m[3]) : null
}

export function fileColumns(f: BronzeFile): string[] {
  if (f.columns) return f.columns
  const seen = new Set<string>()
  for (const r of f.rows) for (const k of Object.keys(r)) seen.add(k)
  return [...seen]
}

function stableKey(v: BronzeValue): string {
  return JSON.stringify(v, (_k, x: unknown) => (x instanceof Date ? isoDate(x) + 'T' + x.toISOString().slice(11, 19) : x))
}

export interface DetectResult {
  code: string
  found: number
  detail: string
}

/**
 * Count instances of a documented issue in the bronze files of its source. `refValues` resolves
 * the reference set for orphan-key checks (normalised: trimmed + upper-cased strings).
 */
export function detectIssue(doc: IssueDoc, files: BronzeFile[], refValues?: (table: string, column: string) => Set<string>): DetectResult {
  const mine = files.filter((f) => f.source === doc.source)
  const col = doc.column ?? ''
  let found = 0
  let detail = ''
  const values = function* () {
    for (const f of mine) for (const r of f.rows) yield getPath(r, col)
  }
  switch (doc.kind) {
    case 'duplicates': {
      const seen = new Set<string>()
      for (const f of mine)
        for (const r of f.rows) {
          const k = stableKey(r)
          if (seen.has(k)) found++
          else seen.add(k)
        }
      detail = `${found} exact duplicate rows`
      break
    }
    case 'nulls':
      for (const v of values()) if (isBlank(v)) found++
      detail = `${found} blank values in ${col}`
      break
    case 'whitespace':
      for (const v of values()) if (typeof v === 'string' && /^\s|\s$/.test(v)) found++
      detail = `${found} values with stray whitespace`
      break
    case 'casing': {
      const groups = new Map<string, Set<string>>()
      for (const v of values()) {
        if (typeof v !== 'string') continue
        const t = v.trim()
        const k = t.toLowerCase()
        let g = groups.get(k)
        if (!g) groups.set(k, (g = new Set()))
        g.add(t)
      }
      for (const g of groups.values()) if (g.size > 1) found += g.size - 1
      if (found === 0) {
        // values seen once: count those whose case style (UPPER / lower) differs from the dominant style
        const style = (t: string) => (t === t.toUpperCase() ? 'upper' : t === t.toLowerCase() ? 'lower' : 'mixed')
        const styles = new Map<string, number>()
        for (const g of groups.values()) for (const t of g) if (t.toUpperCase() !== t.toLowerCase()) styles.set(style(t), (styles.get(style(t)) ?? 0) + 1)
        const sorted = [...styles.values()].sort((a, b) => b - a)
        found = sorted.slice(1).reduce((a, b) => a + b, 0)
      }
      detail = `${found} extra casing variants`
      break
    }
    case 'mixed_date_formats': {
      const kinds = new Map<string, number>()
      for (const v of values()) {
        const k = classifyDate(v)
        if (k) kinds.set(k, (kinds.get(k) ?? 0) + 1)
      }
      const sorted = [...kinds.entries()].sort((a, b) => b[1] - a[1])
      found = sorted.length > 1 ? sorted.slice(1).reduce((s, [, n]) => s + n, 0) : 0
      detail = sorted.map(([k, n]) => `${k}:${n}`).join(', ')
      break
    }
    case 'orphan_keys': {
      if (!doc.ref || !refValues) throw new Error(`orphan_keys issue ${doc.code} needs ref + resolver`)
      const ref = refValues(doc.ref.table, doc.ref.column)
      for (const v of values()) {
        if (isBlank(v)) continue
        if (!ref.has(String(v).trim().toUpperCase())) found++
      }
      detail = `${found} keys missing from ${doc.ref.table}.${doc.ref.column}`
      break
    }
    case 'outliers': {
      const nums: number[] = []
      for (const v of values()) {
        const n = asNumber(v)
        if (n !== null) nums.push(n)
      }
      if (doc.rule === 'negative') found = nums.filter((n) => n < 0).length
      else {
        const pos = nums.filter((n) => n > 0).sort((a, b) => a - b)
        const median = pos.length ? pos[Math.floor(pos.length / 2)] : 0
        found = nums.filter((n) => n > median * 10).length
      }
      detail = `${found} ${doc.rule ?? 'extreme'} values`
      break
    }
    case 'late_arriving': {
      const dc = doc.dateColumn ?? col
      for (const f of mine) {
        const fd = fileDate(f.path)
        if (!fd) continue
        for (const r of f.rows) {
          const d = parseAnyDate(getPath(r, dc))
          if (d && dateOnly(d).getTime() <= addDays(fd, -2).getTime()) found++
        }
      }
      detail = `${found} records landed ≥2 days after their event date`
      break
    }
    case 'schema_drift': {
      const shapes = new Set(mine.map((f) => fileColumns(f).join('|')))
      found = shapes.size > 1 ? shapes.size - 1 : 0
      detail = `${shapes.size} distinct header layouts`
      break
    }
    case 'sentinel_values': {
      const s = new Set((doc.sentinels ?? []).map((x) => String(x)))
      for (const v of values()) if (v !== null && v !== undefined && s.has(String(v).trim())) found++
      detail = `${found} sentinel placeholders`
      break
    }
    case 'formatted_numbers':
      for (const v of values()) if (typeof v === 'string' && /\d/.test(v) && (/[$€£]|[A-Z]{3}$/.test(v.trim()) || /^\d{1,3}(\.\d{3})*,\d+$/.test(v.trim()) || /^\d{1,3}(,\d{3})+\.\d+$/.test(v.trim()))) found++
      detail = `${found} numbers stored as formatted text`
      break
  }
  return { code: doc.code, found, detail }
}
