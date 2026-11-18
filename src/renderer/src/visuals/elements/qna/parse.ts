/**
 * Q&A question parser: question text → an interpretation (values, categories, filters, top N, sort,
 * visual type). Pure and synchronous; data access happens through the prebuilt schema / value index.
 *
 * This is a deliberately small, rule-based grammar — not Power BI's Q&A service. It understands:
 *   aggregations   total/sum, average/avg/mean, count/number of/how many, distinct count/unique, min, max, median
 *   grouping       by / per / for each / across / grouped by / broken down by / split by
 *   top N          top 5 <category> (by <measure>), bottom 3 …, best/worst N
 *   sorting        sorted by <field>, ascending/descending, highest first, alphabetically, a to z …
 *   filters        any column value ("for Europe", "in 2024", "not Bikes"), comparisons on numeric
 *                  columns and measures ("with quantity over 3", "products with total sales above 1000")
 *   visual type    "as (a) bar/column/line/area/pie/donut/table/matrix/card/treemap/funnel/scatter/gauge (chart)"
 * Anything else is reported as unrecognized (underlined in the Q&A box), like Power BI does.
 */
import type { Scalar } from '@core/model/data'
import { SQ_AGG } from '@core/report/sq'
import { isNumericType, isTimeField, isValueField, type QnaField, type QnaSchema, type QnaTable, type ValueIndex } from './schema'
import { numberWord, tokenize, type Token } from './text'

export type CompareOp = '>' | '>=' | '<' | '<=' | '='

export interface QValue {
  field: QnaField
  /** SQ aggregation function for columns (measures have none) */
  agg?: number
}

export interface QFilter {
  field: QnaField
  values: Scalar[]
  not?: boolean
}

export interface QCompare {
  target: QValue
  op: CompareOp
  value: number
}

export interface QTopN {
  n: number
  dir: 'top' | 'bottom'
  category?: QnaField
  by?: QValue
}

export interface QSort {
  /** 'category' index into categories, 'value' index into values */
  kind: 'category' | 'value'
  index: number
  dir: 'asc' | 'desc'
}

export type TokenRole = 'field' | 'value' | 'keyword' | 'stop' | 'unknown'

export interface TokenSpan {
  start: number
  end: number
  text: string
  role: TokenRole
}

export interface QnaInterpretation {
  values: QValue[]
  categories: QnaField[]
  filters: QFilter[]
  compares: QCompare[]
  topN?: QTopN
  sort?: QSort
  visualType?: string
  explicitVisual: boolean
  spans: TokenSpan[]
  unrecognized: string[]
  /** human readable restatement ("Total Sales by Region, Region is Europe") */
  restatement: string
}

// ---------------------------------------------------------------------------------------------
// Lexicon
// ---------------------------------------------------------------------------------------------

type Kw =
  | { k: 'agg'; fn: number | 'count' }
  | { k: 'group' }
  | { k: 'top'; dir: 'top' | 'bottom' }
  | { k: 'sortby' }
  | { k: 'dir'; dir: 'asc' | 'desc'; byCategory?: boolean }
  | { k: 'as' }
  | { k: 'chart'; type: string; strong: boolean }
  | { k: 'cmp'; op: CompareOp }
  | { k: 'not' }
  | { k: 'and' }
  | { k: 'stop' }

const KW = new Map<string, Kw>()
const kw = (phrases: string[], v: Kw) => {
  for (const p of phrases) KW.set(tokenize(p).map((t) => t.norm).join(' '), v)
}
kw(['total', 'sum', 'sum of', 'total of'], { k: 'agg', fn: SQ_AGG.Sum })
kw(['average', 'avg', 'mean', 'average of', 'avg of'], { k: 'agg', fn: SQ_AGG.Avg })
kw(['count', 'count of', 'number of', 'how many', 'no of', '#', '# of'], { k: 'agg', fn: 'count' })
kw(['distinct count', 'distinct count of', 'count of distinct', 'number of distinct', 'number of unique', 'unique', 'distinct', 'count of unique'], { k: 'agg', fn: SQ_AGG.Count })
kw(['min', 'minimum', 'min of', 'minimum of', 'smallest', 'lowest'], { k: 'agg', fn: SQ_AGG.Min })
kw(['max', 'maximum', 'max of', 'maximum of', 'largest', 'highest', 'biggest'], { k: 'agg', fn: SQ_AGG.Max })
kw(['median', 'median of'], { k: 'agg', fn: SQ_AGG.Median })
kw(['by', 'per', 'for each', 'each', 'across', 'grouped by', 'group by', 'broken down by', 'break down by', 'split by', 'for every', 'by each'], { k: 'group' })
kw(['top', 'best', 'first'], { k: 'top', dir: 'top' })
kw(['bottom', 'worst', 'last'], { k: 'top', dir: 'bottom' })
kw(['sorted by', 'sort by', 'order by', 'ordered by', 'sorted', 'sort', 'ordered', 'ranked by', 'rank by'], { k: 'sortby' })
kw(['ascending', 'asc', 'increasing', 'lowest first', 'smallest first', 'low to high', 'smallest to largest', 'least to most', 'in ascending order'], { k: 'dir', dir: 'asc' })
kw(['descending', 'desc', 'decreasing', 'highest first', 'largest first', 'high to low', 'largest to smallest', 'most to least', 'in descending order'], { k: 'dir', dir: 'desc' })
kw(['alphabetically', 'alphabetical', 'a to z', 'a-z', 'in alphabetical order'], { k: 'dir', dir: 'asc', byCategory: true })
kw(['z to a', 'z-a', 'reverse alphabetical'], { k: 'dir', dir: 'desc', byCategory: true })
kw(['as', 'as a', 'as an', 'in a', 'in an', 'using a', 'using', 'show as', 'shown as', 'displayed as', 'visualized as', 'with a', 'on a'], { k: 'as' })
kw(['over', 'above', 'greater than', 'more than', 'larger than', 'bigger than', 'higher than', 'exceeding', '>'], { k: 'cmp', op: '>' })
kw(['at least', 'greater than or equal to', 'no less than', '>='], { k: 'cmp', op: '>=' })
kw(['under', 'below', 'less than', 'fewer than', 'smaller than', 'lower than', '<'], { k: 'cmp', op: '<' })
kw(['at most', 'less than or equal to', 'no more than', '<='], { k: 'cmp', op: '<=' })
kw(['equal to', 'equals', 'equal', 'exactly', '='], { k: 'cmp', op: '=' })
kw(['not', 'excluding', 'except', 'without', 'other than', 'but not', 'exclude'], { k: 'not' })
kw(['and', 'or', 'plus', 'vs', 'versus', 'compared to', 'against'], { k: 'and' })
kw(
  [
    'show', 'me', 'show me', 'what', 'whats', 'what is', 'what are', 'is', 'are', 'was', 'were', 'the', 'a', 'an', 'of', 'list', 'give',
    'display', 'how', 'much', 'did', 'do', 'does', 'we', 'our', 'have', 'has', 'all', 'with', 'please', 'i', 'want', 'to', 'see', 'compare',
    'in', 'for', 'where', 'on', 'from', 'that', 'which', 'who', 'during', 'within', 'value', 'values', 'amount of', 'tell', 'can', 'you',
    'my', 'there', 'chart', 'graph', 'visual', 'it', 'its', 'only', 'just', 'when', 'whose', 'having', 'their', 'this', 'these', 'those', 'be', 'been', 'get', 'find'
  ],
  { k: 'stop' }
)

interface ChartWord {
  phrases: string[]
  type: string
}

const CHARTS: ChartWord[] = [
  { phrases: ['stacked bar chart', 'stacked bar'], type: 'barChart' },
  { phrases: ['bar chart', 'bar graph', 'bar', 'bars', 'horizontal bar chart', 'clustered bar chart'], type: 'clusteredBarChart' },
  { phrases: ['stacked column chart', 'stacked column'], type: 'columnChart' },
  { phrases: ['column chart', 'column graph', 'column', 'columns', 'clustered column chart', 'vertical bar chart', 'histogram'], type: 'clusteredColumnChart' },
  { phrases: ['line chart', 'line graph', 'line', 'lines', 'trend', 'trend line', 'time series'], type: 'lineChart' },
  { phrases: ['stacked area chart', 'stacked area'], type: 'stackedAreaChart' },
  { phrases: ['area chart', 'area graph', 'area'], type: 'areaChart' },
  { phrases: ['pie chart', 'pie'], type: 'pieChart' },
  { phrases: ['donut chart', 'donut', 'doughnut chart', 'doughnut', 'ring chart'], type: 'donutChart' },
  { phrases: ['table', 'list', 'grid'], type: 'tableEx' },
  { phrases: ['matrix', 'pivot table', 'pivot', 'crosstab', 'cross tab'], type: 'pivotTable' },
  { phrases: ['multi row card', 'multirow card', 'multi-row card'], type: 'multiRowCard' },
  { phrases: ['card', 'number', 'single number', 'big number', 'kpi card'], type: 'card' },
  { phrases: ['treemap', 'tree map'], type: 'treemap' },
  { phrases: ['funnel', 'funnel chart'], type: 'funnel' },
  { phrases: ['scatter chart', 'scatter plot', 'scatter', 'scatterplot', 'bubble chart'], type: 'scatterChart' },
  { phrases: ['gauge', 'gauge chart', 'dial'], type: 'gauge' },
  { phrases: ['ribbon chart', 'ribbon'], type: 'ribbonChart' },
  { phrases: ['waterfall chart', 'waterfall'], type: 'waterfallChart' }
]
const CHART = new Map<string, { type: string; strong: boolean }>()
for (const c of CHARTS) for (const p of c.phrases) CHART.set(tokenize(p).map((t) => t.norm).join(' '), { type: c.type, strong: /chart|graph|plot|matrix|treemap|tree map|scatter|funnel|donut|doughnut|pie/.test(p) })

export const VISUAL_LABELS: Record<string, string> = {
  barChart: 'stacked bar chart',
  clusteredBarChart: 'bar chart',
  columnChart: 'stacked column chart',
  clusteredColumnChart: 'column chart',
  lineChart: 'line chart',
  stackedAreaChart: 'stacked area chart',
  areaChart: 'area chart',
  pieChart: 'pie chart',
  donutChart: 'donut chart',
  tableEx: 'table',
  pivotTable: 'matrix',
  multiRowCard: 'multi-row card',
  card: 'card',
  treemap: 'treemap',
  funnel: 'funnel',
  scatterChart: 'scatter chart',
  gauge: 'gauge',
  ribbonChart: 'ribbon chart',
  waterfallChart: 'waterfall chart'
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

type Match =
  | { t: 'kw'; kw: Kw }
  | { t: 'chart'; type: string; strong: boolean }
  | { t: 'field'; field: QnaField }
  | { t: 'table'; table: QnaTable }
  | { t: 'value'; entries: Array<{ field: QnaField; value: Scalar }> }
  | { t: 'num'; n: number }

interface Lexeme {
  m: Match
  from: number
  to: number
}

export interface QnaLexicon {
  fields: Map<string, Array<{ field: QnaField; weight: number }>>
  tables: Map<string, QnaTable>
  values: ValueIndex
}

export function buildLexicon(schema: QnaSchema, values: ValueIndex = new Map()): QnaLexicon {
  const fields = new Map<string, Array<{ field: QnaField; weight: number }>>()
  for (const f of schema.fields)
    for (const t of f.terms) {
      const arr = fields.get(t.key) ?? []
      if (!arr.some((x) => x.field === f)) arr.push({ field: f, weight: t.weight })
      fields.set(t.key, arr)
    }
  for (const arr of fields.values()) arr.sort((a, b) => b.weight - a.weight || (a.field.kind === 'measure' ? -1 : 1))
  const tables = new Map<string, QnaTable>()
  for (const t of schema.tables) for (const term of t.terms) if (!tables.has(term.key)) tables.set(term.key, t)
  return { fields, tables, values }
}

const MAX_PHRASE = 6

function lex(tokens: Token[], lx: QnaLexicon): Lexeme[] {
  const out: Lexeme[] = []
  let i = 0
  let afterAs = false
  while (i < tokens.length) {
    let found: Lexeme | undefined
    for (let len = Math.min(MAX_PHRASE, tokens.length - i); len >= 1 && !found; len--) {
      const key = tokens
        .slice(i, i + len)
        .map((t) => t.stem)
        .join(' ')
      const normKey = tokens
        .slice(i, i + len)
        .map((t) => t.norm)
        .join(' ')
      const chart = CHART.get(normKey)
      // chart words only count after "as …" or when unambiguous ("bar chart", "pie")
      if (chart && (afterAs || chart.strong)) {
        found = { m: { t: 'chart', ...chart }, from: i, to: i + len }
        break
      }
      const k = KW.get(normKey)
      const multiKw = k && len > 1 && k.k !== 'stop'
      if (multiKw) {
        found = { m: { t: 'kw', kw: k }, from: i, to: i + len }
        break
      }
      const f = lx.fields.get(key)
      if (f?.length) {
        found = { m: { t: 'field', field: f[0].field }, from: i, to: i + len }
        break
      }
      const v = lx.values.get(key)
      if (v?.length) {
        found = { m: { t: 'value', entries: v.map((e) => ({ field: e.field, value: e.value })) }, from: i, to: i + len }
        break
      }
      const tb = lx.tables.get(key)
      if (tb) {
        found = { m: { t: 'table', table: tb }, from: i, to: i + len }
        break
      }
      if (k) {
        found = { m: { t: 'kw', kw: k }, from: i, to: i + len }
        break
      }
      if (len === 1) {
        const tok = tokens[i]
        const n = tok.num ?? numberWord(tok.norm)
        if (n !== undefined) found = { m: { t: 'num', n }, from: i, to: i + 1 }
      }
    }
    if (found) {
      out.push(found)
      afterAs = found.m.t === 'kw' && found.m.kw.k === 'as'
      i = found.to
    } else {
      out.push({ m: { t: 'kw', kw: { k: 'stop' } }, from: i, to: i + 1 })
      ;(out[out.length - 1] as any).unknown = true
      afterAs = false
      i++
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Interpretation
// ---------------------------------------------------------------------------------------------

function sameValue(a: QValue, b: QValue): boolean {
  return a.field === b.field && a.agg === b.agg
}

function countAgg(f: QnaField): number {
  // "count of <text column>" = number of distinct items (PBI Q&A semantics); other columns count rows
  return f.dataType === 'string' ? SQ_AGG.Count : SQ_AGG.CountNonNull
}

function defaultAgg(f: QnaField): number {
  switch (f.summarizeBy) {
    case 'average':
      return SQ_AGG.Avg
    case 'min':
      return SQ_AGG.Min
    case 'max':
      return SQ_AGG.Max
    case 'count':
      return SQ_AGG.CountNonNull
    case 'distinctCount':
      return SQ_AGG.Count
    default:
      return SQ_AGG.Sum
  }
}

export function interpret(question: string, lx: QnaLexicon): QnaInterpretation {
  const tokens = tokenize(question)
  const lexemes = lex(tokens, lx)
  const values: QValue[] = []
  const categories: QnaField[] = []
  const filters: QFilter[] = []
  const compares: QCompare[] = []
  let topN: QTopN | undefined
  let topTargetPending = false
  let sortTarget: { kind: 'field'; field: QnaField; agg?: number } | undefined
  let sortDir: 'asc' | 'desc' | undefined
  let sortByCategory = false
  let visualType: string | undefined
  let pendingAgg: number | 'count' | undefined
  let mode: 'value' | 'group' | 'sort' = 'value'
  let negate = false
  let pendingCmp: CompareOp | undefined
  let lastValue: QValue | undefined
  const spans: TokenSpan[] = []
  const unrecognized: string[] = []

  const addValue = (v: QValue) => {
    const hit = values.find((x) => sameValue(x, v))
    if (hit) return hit
    values.push(v)
    return v
  }
  const addCategory = (f: QnaField) => {
    if (!categories.includes(f)) categories.push(f)
  }
  const span = (lx: Lexeme, role: TokenRole) => {
    const a = tokens[lx.from]
    const b = tokens[lx.to - 1]
    spans.push({ start: a.start, end: b.end, text: question.slice(a.start, b.end), role })
  }

  for (let li = 0; li < lexemes.length; li++) {
    const L = lexemes[li]
    const m = L.m
    if ((L as any).unknown) {
      span(L, 'unknown')
      unrecognized.push(tokens[L.from].raw)
      continue
    }
    if (m.t === 'kw') {
      const k = m.kw
      span(L, k.k === 'stop' ? 'stop' : 'keyword')
      switch (k.k) {
        case 'agg':
          pendingAgg = k.fn
          break
        case 'group':
          mode = 'group'
          negate = false
          break
        case 'top': {
          const next = lexemes[li + 1]
          let n = 5 // "top products by sales" without a number: Power BI-like default of 5 (approximation)
          if (next?.m.t === 'num') {
            n = Math.max(1, Math.round(next.m.n))
            span(next, 'keyword')
            li++
          } else if (tokens[L.from].stem === 'first' || tokens[L.from].stem === 'last') {
            // "first"/"last" without a count are ordinary words ("first name"), not top N
            span(L, 'stop')
            break
          }
          topN = { n, dir: k.dir }
          topTargetPending = true
          break
        }
        case 'sortby':
          mode = 'sort'
          break
        case 'dir':
          sortDir = k.dir
          if (k.byCategory) sortByCategory = true
          break
        case 'cmp':
          pendingCmp = k.op
          break
        case 'not':
          negate = true
          break
        case 'and':
        case 'as':
        case 'stop':
          break
      }
      continue
    }
    if (m.t === 'chart') {
      span(L, 'keyword')
      visualType = m.type
      continue
    }
    if (m.t === 'num') {
      if (pendingCmp) {
        const target = lastValue
        if (target) {
          compares.push({ target, op: pendingCmp, value: m.n })
          // a numeric column used only as a filter ("orders with quantity over 3") isn't shown as a value
          if (target.field.kind === 'column' && target.agg === undefined) {
            const i = values.indexOf(target)
            if (i >= 0) values.splice(i, 1)
          }
          span(L, 'value')
        } else {
          span(L, 'unknown')
          unrecognized.push(tokens[L.from].raw)
        }
        pendingCmp = undefined
        continue
      }
      span(L, 'unknown')
      unrecognized.push(tokens[L.from].raw)
      continue
    }
    if (m.t === 'value') {
      span(L, 'value')
      // prefer the column of an existing category / filter when the value is ambiguous
      const pick = m.entries.find((e) => categories.includes(e.field) || filters.some((f) => f.field === e.field)) ?? m.entries[0]
      let fl = filters.find((f) => f.field === pick.field && !!f.not === negate)
      if (!fl) filters.push((fl = { field: pick.field, values: [], not: negate || undefined }))
      if (!fl.values.some((v) => v === pick.value)) fl.values.push(pick.value)
      continue
    }
    if (m.t === 'table') {
      span(L, 'field')
      const t = m.table
      if (pendingAgg !== undefined && t.firstColumn) {
        // "count of orders" where Orders is a table → count rows of its first column (approximates COUNTROWS)
        const f = findField(lx, t.name, t.firstColumn)
        if (f) lastValue = addValue({ field: f, agg: SQ_AGG.CountNonNull })
        pendingAgg = undefined
      } else if ((mode === 'group' || topTargetPending) && t.labelColumn) {
        const f = findField(lx, t.name, t.labelColumn)
        if (f) addCategory(f)
        if (topTargetPending && f && topN) topN.category = f
        topTargetPending = false
      }
      continue
    }
    // field
    span(L, 'field')
    const f = m.field
    negate = false
    if (pendingCmp === undefined && lexemes[li + 1]?.m.t === 'kw' && (lexemes[li + 1].m as any).kw.k === 'cmp') {
      // "quantity over 3": the field is the comparison target
      const v: QValue = f.kind === 'measure' ? { field: f } : { field: f, agg: pendingAgg !== undefined ? resolveAgg(pendingAgg, f) : undefined }
      lastValue = f.kind === 'measure' || v.agg !== undefined ? addValue(v) : v
      pendingAgg = undefined
      continue
    }
    if (f.kind === 'measure') {
      const v = addValue({ field: f })
      lastValue = v
      if (mode === 'sort') sortTarget = { kind: 'field', field: f }
      else if (topN && !topN.by && (mode === 'group' || topN.category)) topN.by = v
      pendingAgg = undefined
      continue
    }
    if (pendingAgg !== undefined) {
      const v = addValue({ field: f, agg: resolveAgg(pendingAgg, f) })
      lastValue = v
      if (mode === 'sort') sortTarget = { kind: 'field', field: f, agg: v.agg }
      else if (topN && !topN.by && topN.category) topN.by = v
      pendingAgg = undefined
      continue
    }
    if (mode === 'sort') {
      if (isValueField(f) && !categories.includes(f)) {
        const v = addValue({ field: f, agg: defaultAgg(f) })
        sortTarget = { kind: 'field', field: f, agg: v.agg }
      } else {
        addCategory(f)
        sortTarget = { kind: 'field', field: f }
      }
      continue
    }
    if (topTargetPending) {
      addCategory(f)
      if (topN) topN.category = f
      topTargetPending = false
      continue
    }
    if (mode === 'group' && !(topN?.category && isValueField(f))) {
      addCategory(f)
      continue
    }
    if (isValueField(f)) {
      const v = addValue({ field: f, agg: defaultAgg(f) })
      lastValue = v
      if (topN && !topN.by && topN.category) topN.by = v
      continue
    }
    addCategory(f)
  }

  if (topN) {
    if (!topN.category) topN.category = categories[0]
    if (!topN.by) topN.by = values[0]
    if (!topN.category || !topN.by) topN = undefined
  }

  // sort
  let sort: QSort | undefined
  if (sortTarget) {
    const ci = categories.indexOf(sortTarget.field)
    const vi = values.findIndex((v) => v.field === sortTarget!.field && (sortTarget!.agg === undefined || v.agg === sortTarget!.agg))
    if (vi >= 0 && ci < 0) sort = { kind: 'value', index: vi, dir: sortDir ?? 'desc' }
    else if (ci >= 0) sort = { kind: 'category', index: ci, dir: sortDir ?? 'asc' }
  } else if (sortDir) {
    if (sortByCategory && categories.length) sort = { kind: 'category', index: 0, dir: sortDir }
    else if (values.length) sort = { kind: 'value', index: 0, dir: sortDir }
    else if (categories.length) sort = { kind: 'category', index: 0, dir: sortDir }
  } else if (topN?.by) {
    sort = { kind: 'value', index: values.indexOf(topN.by), dir: topN.dir === 'top' ? 'desc' : 'asc' }
  }

  const explicitVisual = !!visualType
  const vt = visualType ?? chooseVisual(categories, values, !!topN)
  // default sort per visual (Power BI: bar/column/pie… sort by the value descending; time axes ascending)
  if (!sort && vt && values.length && categories.length) {
    const time = isTimeField(categories[0])
    if (!time && ['clusteredBarChart', 'barChart', 'clusteredColumnChart', 'columnChart', 'pieChart', 'donutChart', 'funnel', 'treemap'].includes(vt))
      sort = { kind: 'value', index: 0, dir: 'desc' }
  }

  const interp: QnaInterpretation = { values, categories, filters, compares, topN, sort, visualType: vt, explicitVisual, spans, unrecognized, restatement: '' }
  interp.restatement = restate(interp)
  return interp
}

function resolveAgg(a: number | 'count', f: QnaField): number {
  if (a === 'count') return countAgg(f)
  // sum/avg of a text column makes no sense: count it instead
  if (!isNumericType(f.dataType) && (a === SQ_AGG.Sum || a === SQ_AGG.Avg || a === SQ_AGG.Median)) return countAgg(f)
  return a
}

function findField(lx: QnaLexicon, table: string, column: string): QnaField | undefined {
  for (const arr of lx.fields.values()) for (const x of arr) if (x.field.kind === 'column' && x.field.table === table && x.field.name === column) return x.field
  return undefined
}

/** Visual type heuristic (approximates Power BI Q&A's choices). */
export function chooseVisual(categories: QnaField[], values: QValue[], hasTopN: boolean): string | undefined {
  const c = categories.length
  const v = values.length
  if (!c && !v) return undefined
  if (!v) return 'tableEx'
  if (!c) return v === 1 ? 'card' : 'multiRowCard'
  if (c === 1) return isTimeField(categories[0]) && !hasTopN ? 'lineChart' : 'clusteredBarChart'
  if (c === 2 && v === 1 && categories.some(isTimeField) && !hasTopN) return 'lineChart'
  if (c === 2) return 'pivotTable'
  return 'tableEx'
}

const AGG_LABEL: Record<number, string> = {
  [SQ_AGG.Sum]: 'Sum of',
  [SQ_AGG.Avg]: 'Average of',
  [SQ_AGG.Count]: 'Count of',
  [SQ_AGG.Min]: 'Min of',
  [SQ_AGG.Max]: 'Max of',
  [SQ_AGG.CountNonNull]: 'Count of',
  [SQ_AGG.Median]: 'Median of'
}

export function valueLabel(v: QValue): string {
  if (v.agg === undefined) return v.field.name
  return `${AGG_LABEL[v.agg] ?? 'Sum of'} ${v.field.name}${v.agg === SQ_AGG.Count ? ' (Distinct)' : ''}`
}

function fmtScalar(v: Scalar): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

function restate(q: QnaInterpretation): string {
  const parts: string[] = []
  const vals = q.values.map(valueLabel)
  let head = vals.join(' and ')
  if (q.topN?.category && q.topN.by) {
    const by = valueLabel(q.topN.by)
    const others = vals.filter((x) => x !== by)
    head = `${q.topN.dir} ${q.topN.n} ${q.topN.category.name} by ${by}${others.length ? ` with ${others.join(' and ')}` : ''}`
  }
  const cats = q.categories.filter((c) => c !== q.topN?.category).map((c) => c.name)
  if (head && cats.length) head += ` by ${cats.join(' and ')}`
  else if (!head) head = q.categories.map((c) => c.name).join(' and ')
  if (head) parts.push(head)
  for (const f of q.filters) parts.push(`${f.field.name} ${f.not ? 'is not' : 'is'} ${f.values.map(fmtScalar).join(' or ')}`)
  for (const c of q.compares) parts.push(`${valueLabel(c.target)} ${c.op} ${c.value}`)
  if (q.sort && !q.topN) {
    const name = q.sort.kind === 'value' ? valueLabel(q.values[q.sort.index]) : q.categories[q.sort.index]?.name
    if (name) parts.push(`sorted by ${name} ${q.sort.dir === 'asc' ? 'ascending' : 'descending'}`)
  }
  let s = parts.join(', ')
  if (s && q.explicitVisual && q.visualType) s += ` as ${VISUAL_LABELS[q.visualType] ?? q.visualType}`
  return s
}
