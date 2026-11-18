/**
 * Pure IntelliSense logic (no CodeMirror / DOM): completion context detection, candidate building,
 * fuzzy ranking with common/recent/in-scope boosts, snippets. `completion.ts` adapts it to CodeMirror.
 */
import { DAX_FUNCTIONS, type DaxFunctionInfo } from './functions'
import type { DaxSchema } from './schema'
import { quoteColumn, tokenizeDax } from './tokenizer'
import { DATA_TYPE_LABEL } from './labels'

const typeLabel = (t: string | undefined): string | undefined => (t ? (DATA_TYPE_LABEL[t] ?? t) : undefined)

export type CandidateKind = 'function' | 'keyword' | 'table' | 'column' | 'measure' | 'variable' | 'snippet'

export interface Candidate {
  kind: CandidateKind
  /** shown in the list */
  label: string
  /** text the query is matched against (name without quotes/brackets) */
  match: string
  /** text inserted (functions: the bare name — `(` is added with auto-close by the editor) */
  insert: string
  /** static ranking bonus */
  boost: number
  detail?: string
  table?: string
  dataType?: string
  calculated?: boolean
  fn?: DaxFunctionInfo
  /** snippet template (CodeMirror snippet syntax) */
  template?: string
  /** stable key for recent-usage tracking */
  key: string
}

/** Functions people use most — they win ties (CALC → CALCULATE before CALCULATETABLE). */
export const COMMON_FUNCTIONS = new Map<string, number>(
  [
    'CALCULATE', 'SUM', 'DIVIDE', 'FILTER', 'ALL', 'IF', 'SWITCH', 'COUNTROWS', 'SUMX', 'VALUES', 'SELECTEDVALUE', 'DISTINCTCOUNT',
    'AVERAGE', 'MAX', 'MIN', 'RELATED', 'FORMAT', 'DATEADD', 'SAMEPERIODLASTYEAR', 'TOTALYTD', 'REMOVEFILTERS', 'KEEPFILTERS',
    'ALLSELECTED', 'ISBLANK', 'BLANK', 'COALESCE', 'AVERAGEX', 'COUNT', 'COUNTA', 'MAXX', 'MINX', 'RANKX', 'TOPN', 'ADDCOLUMNS',
    'SUMMARIZE', 'SUMMARIZECOLUMNS', 'USERELATIONSHIP', 'DATESYTD', 'DATESBETWEEN', 'HASONEVALUE', 'ISINSCOPE', 'CONCATENATEX',
    'LOOKUPVALUE', 'TREATAS', 'YEAR', 'MONTH', 'TODAY', 'DATE', 'EOMONTH', 'AND', 'OR', 'NOT', 'ROUND', 'ABS'
  ].map((n, i, a) => [n, a.length - i])
)

// ------------------------------------------------------------------ recent usage

const usage = new Map<string, number>()
export function recordUsage(key: string): void {
  usage.set(key, (usage.get(key) ?? 0) + 1)
}
export function usageCount(key: string): number {
  return usage.get(key) ?? 0
}
export function resetUsage(): void {
  usage.clear()
}

// ------------------------------------------------------------------ context

export type CompletionMode =
  /** inside `[` — optionally qualified by a table */
  | { kind: 'bracket'; table: string | null; query: string; from: number }
  /** inside `'` — table names */
  | { kind: 'quoted'; query: string; from: number }
  /** an identifier being typed */
  | { kind: 'word'; query: string; from: number }
  | { kind: 'none' }

/** Determine what is being completed from the text before the cursor (offset-relative to that text). */
export function completionContextAt(before: string): CompletionMode {
  const toks = tokenizeDax(before)
  const last = toks[toks.length - 1]
  if (!last) return { kind: 'none' }
  if (last.type === 'column' && !last.terminated) {
    const prev = toks[toks.length - 2]
    const table = prev && (prev.type === 'table' || prev.type === 'ident') && prev.terminated !== false ? unq(prev.text) : null
    return { kind: 'bracket', table, query: last.text.slice(1), from: last.start }
  }
  if (last.type === 'table' && !last.terminated) return { kind: 'quoted', query: last.text.slice(1), from: last.start }
  if (last.type === 'string' || last.type === 'comment' || last.type === 'number') return { kind: 'none' }
  if (last.type === 'ident' || last.type === 'keyword' || last.type === 'function') return { kind: 'word', query: last.text, from: last.start }
  return { kind: 'word', query: '', from: before.length }
}

const unq = (s: string) => (s.startsWith("'") ? s.slice(1, s.endsWith("'") && s.length > 1 ? -1 : undefined).replace(/''/g, "'") : s)

/** 'Table Name' — completion always inserts the quoted form (as Power BI does). */
export function quotedTable(name: string): string {
  return `'${name.replace(/'/g, "''")}'`
}

// ------------------------------------------------------------------ snippets

export interface DaxSnippet {
  label: string
  detail: string
  /** CodeMirror snippet template: ${n:placeholder} fields, ${} final cursor */
  template: string
}

export const DAX_SNIPPETS: DaxSnippet[] = [
  { label: 'var', detail: 'VAR … RETURN', template: 'VAR ${1:_value} = ${2}\nRETURN\n    ${3:_value}' },
  { label: 'sw', detail: 'SWITCH ( TRUE (), … )', template: 'SWITCH (\n    TRUE (),\n    ${1:condition}, ${2:result},\n    ${3:else}\n)' },
  { label: 'calc', detail: 'CALCULATE with a filter', template: 'CALCULATE (\n    ${1:[Measure]},\n    ${2:Table[Column]} = ${3:"value"}\n)' },
  { label: 'divide', detail: 'DIVIDE ( numerator, denominator )', template: 'DIVIDE ( ${1:numerator}, ${2:denominator} )' },
  { label: 'ytd', detail: 'Year-to-date (TOTALYTD)', template: "TOTALYTD ( ${1:[Measure]}, ${2:'Date'[Date]} )" },
  { label: 'py', detail: 'Same period last year', template: "CALCULATE ( ${1:[Measure]}, SAMEPERIODLASTYEAR ( ${2:'Date'[Date]} ) )" },
  {
    label: 'yoy',
    detail: 'Year-over-year % change',
    template: "VAR _current = ${1:[Measure]}\nVAR _previous =\n    CALCULATE ( _current, DATEADD ( ${2:'Date'[Date]}, -1, YEAR ) )\nRETURN\n    DIVIDE ( _current - _previous, _previous )"
  },
  { label: 'mtd', detail: 'Month-to-date (TOTALMTD)', template: "TOTALMTD ( ${1:[Measure]}, ${2:'Date'[Date]} )" },
  { label: 'rt', detail: 'Running total', template: "CALCULATE (\n    ${1:[Measure]},\n    FILTER ( ALLSELECTED ( ${2:'Date'[Date]} ), ${2:'Date'[Date]} <= MAX ( ${2:'Date'[Date]} ) )\n)" },
  { label: 'pct', detail: '% of total (ALLSELECTED)', template: 'DIVIDE ( ${1:[Measure]}, CALCULATE ( ${1:[Measure]}, ALLSELECTED ( ${2:Table} ) ) )' },
  { label: 'evaluate', detail: 'EVALUATE query', template: 'EVALUATE\n    SUMMARIZECOLUMNS ( ${1:Table[Column]}, "${2:Value}", ${3:[Measure]} )' }
]

/** Plain text a snippet expands to with its default placeholders (used for previews and tests). */
export function snippetText(template: string): string {
  let out = template
  // innermost first so nested fields resolve
  for (let i = 0; i < 5; i++) out = out.replace(/\$\{\d+:([^${}]*)\}/g, '$1')
  return out.replace(/\$\{\d*\}/g, '')
}

// ------------------------------------------------------------------ candidates

const KEYWORDS_EXPR = ['VAR', 'RETURN', 'IN', 'NOT', 'TRUE', 'FALSE', 'ASC', 'DESC']
const KEYWORDS_QUERY = ['DEFINE', 'EVALUATE', 'ORDER BY', 'START AT', 'MEASURE', 'COLUMN', 'TABLE']

/** VAR names declared in the text. */
export function declaredVars(text: string): string[] {
  const toks = tokenizeDax(text).filter((t) => t.type !== 'ws' && t.type !== 'newline' && t.type !== 'comment')
  const out = new Set<string>()
  for (let i = 0; i < toks.length - 1; i++) if (toks[i].type === 'keyword' && toks[i].text.toUpperCase() === 'VAR' && toks[i + 1].type === 'ident') out.add(toks[i + 1].text)
  return [...out]
}

export function buildCandidates(mode: CompletionMode, schema: DaxSchema, opts: { docBefore?: string; query?: boolean } = {}): Candidate[] {
  const out: Candidate[] = []
  const home = schema.homeTable?.toLowerCase()
  if (mode.kind === 'bracket') {
    if (mode.table !== null) {
      const t = schema.tables.find((x) => x.name.toLowerCase() === mode.table!.toLowerCase())
      if (!t) return []
      for (const c of t.columns) out.push({ kind: 'column', label: quoteColumn(c.name), match: c.name, insert: quoteColumn(c.name), boost: c.hidden ? -50 : 0, detail: typeLabel(c.dataType), table: t.name, dataType: c.dataType, calculated: c.calculated, key: `c:${t.name}:${c.name}` })
      for (const m of t.measures) out.push({ kind: 'measure', label: quoteColumn(m.name), match: m.name, insert: quoteColumn(m.name), boost: -10, detail: measureDetail(m.formatString, t.name), table: t.name, key: `m:${m.name}` })
      return out
    }
    for (const t of schema.tables) for (const m of t.measures) out.push({ kind: 'measure', label: quoteColumn(m.name), match: m.name, insert: quoteColumn(m.name), boost: (t.name.toLowerCase() === home ? 60 : 0) + (m.hidden ? -50 : 0), detail: measureDetail(m.formatString, t.name), table: t.name, key: `m:${m.name}` })
    const ht = home ? schema.tables.find((t) => t.name.toLowerCase() === home) : undefined
    if (ht) for (const c of ht.columns) out.push({ kind: 'column', label: quoteColumn(c.name), match: c.name, insert: quoteColumn(c.name), boost: 80, detail: typeLabel(c.dataType), table: ht.name, dataType: c.dataType, calculated: c.calculated, key: `c:${ht.name}:${c.name}` })
    return out
  }
  const tableCands = (withColumns: boolean) => {
    for (const t of schema.tables) {
      const q = quotedTable(t.name)
      out.push({ kind: 'table', label: q, match: t.name, insert: q, boost: (t.hidden ? -40 : 0) + (t.name.toLowerCase() === home ? 30 : 0), detail: 'table', table: t.name, key: `t:${t.name}` })
      if (withColumns)
        for (const c of t.columns)
          out.push({ kind: 'column', label: `${q}${quoteColumn(c.name)}`, match: `${t.name} ${c.name}`, insert: `${q}${quoteColumn(c.name)}`, boost: (c.hidden ? -60 : -20) + (t.name.toLowerCase() === home ? 20 : 0), detail: typeLabel(c.dataType), table: t.name, dataType: c.dataType, calculated: c.calculated, key: `c:${t.name}:${c.name}` })
    }
  }
  if (mode.kind === 'quoted') {
    tableCands(true)
    return out
  }
  if (mode.kind !== 'word') return out
  for (const f of DAX_FUNCTIONS) out.push({ kind: 'function', label: f.name, match: f.name, insert: f.name, boost: (COMMON_FUNCTIONS.get(f.name) ?? 0) * 3, detail: f.category, fn: f, key: `f:${f.name}` })
  for (const k of KEYWORDS_EXPR) out.push({ kind: 'keyword', label: k, match: k, insert: k, boost: k === 'VAR' || k === 'RETURN' ? 120 : 0, detail: 'keyword', key: `k:${k}` })
  if (opts.query) for (const k of KEYWORDS_QUERY) out.push({ kind: 'keyword', label: k, match: k, insert: k, boost: 100, detail: 'keyword', key: `k:${k}` })
  for (const v of declaredVars(opts.docBefore ?? '')) out.push({ kind: 'variable', label: v, match: v, insert: v, boost: 400, detail: 'variable', key: `v:${v}` })
  for (const s of DAX_SNIPPETS) out.push({ kind: 'snippet', label: s.label, match: s.label, insert: snippetText(s.template), boost: -250, detail: s.detail, template: s.template, key: `s:${s.label}` })
  for (const t of schema.tables) for (const m of t.measures) out.push({ kind: 'measure', label: quoteColumn(m.name), match: m.name, insert: quoteColumn(m.name), boost: (t.name.toLowerCase() === home ? 60 : 0) + (m.hidden ? -50 : 0), detail: measureDetail(m.formatString, t.name), table: t.name, key: `m:${m.name}` })
  tableCands(true)
  return out
}

function measureDetail(fmt: string | undefined, table: string): string {
  return fmt ? `${fmt} · ${table}` : table
}

// ------------------------------------------------------------------ ranking

/**
 * Match score of `query` against `text` (case-insensitive): exact > prefix > word-start prefix >
 * substring > subsequence (fuzzy). null = no match. Shorter candidates win among equals.
 */
export function matchScore(query: string, text: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (t === q) return 1000
  if (t.startsWith(q)) return 800 - Math.min(100, t.length - q.length)
  const words = t.split(/[\s_.\-[\]']+/)
  if (words.some((w) => w.startsWith(q))) return 600 - Math.min(100, t.length - q.length)
  const idx = t.indexOf(q)
  if (idx >= 0) return 450 - Math.min(100, idx * 2 + (t.length - q.length))
  // subsequence with gap penalty; initials ("tsy" → "Total Sales YTD") score well
  let ti = 0
  let gaps = 0
  let last = -1
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    if (last >= 0 && found > last + 1) gaps += found - last - 1
    last = found
    ti = found + 1
  }
  return Math.max(1, 250 - gaps * 4 - (t.length - q.length))
}

export interface RankedCandidate extends Candidate {
  score: number
}

/** Filter + order candidates for `query`. Recent usage and in-scope boosts apply on top of the match score. */
export function rankCandidates(cands: Candidate[], query: string, opts: { limit?: number } = {}): RankedCandidate[] {
  const out: RankedCandidate[] = []
  const seen = new Set<string>()
  for (const c of cands) {
    if (seen.has(c.kind + c.label)) continue
    const m = matchScore(query, c.match)
    if (m === null) continue
    // snippets and keywords only when the query looks like them (avoid noise on 1-letter queries)
    if ((c.kind === 'snippet' || c.kind === 'keyword') && query.length < 2 && !c.match.toLowerCase().startsWith(query.toLowerCase())) continue
    seen.add(c.kind + c.label)
    const recent = Math.min(300, usageCount(c.key) * 60)
    out.push({ ...c, score: m + c.boost + recent })
  }
  out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
  return opts.limit ? out.slice(0, opts.limit) : out
}

// ------------------------------------------------------------------ "did you mean"

export function editDistance(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  const dp = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= y.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[y.length]
}

/** Closest names (edit distance ≤ max(2, 30% of length)), best first. */
export function suggestNames(name: string, pool: string[], max = 3): string[] {
  const limit = Math.max(2, Math.round(name.length * 0.3))
  return pool
    .map((p) => ({ p, d: p.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(p.toLowerCase()) ? 1 : editDistance(name, p) }))
    .filter((x) => x.d <= limit)
    .sort((a, b) => a.d - b.d || a.p.length - b.p.length)
    .slice(0, max)
    .map((x) => x.p)
}
