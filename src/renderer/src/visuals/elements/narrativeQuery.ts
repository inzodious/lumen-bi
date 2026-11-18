/**
 * Dynamic values of text boxes / smart narratives ("+ Value" with a Q&A utterance).
 *
 * PBI stores each value in `objects.values` (selector `{ id: <name> }`, properties `expr` + optional
 * `formatString`), and text runs reference it with
 *   { value: { propertyIdentifier: { objectName: 'values', propertyName: 'expr' }, selector: { id } } }.
 * Q&A writes values like "Manager with highest close %" as an Aggregation over a column of a
 * Subquery: Aggregation(Function, Column(Subquery{ Select, Where (often a TopN In-subquery), OrderBy, Top }), Property=<select name>).
 * We evaluate that by running the inner query through engine.summarize (its Where becomes a filter —
 * the engine already understands TopN In-subquery filters) and aggregating the selected column.
 *
 * Smart narratives store their summaries as `Transform` subqueries: the input table (a category column with the
 * role PrimarySeriesColumnRole and measures with value roles) feeds an algorithm (HighPointLowPointSummary,
 * AggregateSummary, KPISummary) whose output roles V1…Vn and TemplateIdColumnRole the text runs reference.
 * evaluateTransform runs the input through engine.summarize and computes the outputs with the shared insight
 * engine (charts/misc/narrative/insights.ts) — the same code the Narrative visual phrases. Other algorithms
 * report `unsupported` so the text box can say so.
 */
import type { Scalar } from '@core/model/data'
import type { DataType } from '@core/model/types'
import type { SortSpec } from '@core/engine/api'
import type { SQExpr, SQFilter } from '@core/report/sq'
import type { VisualHostContext } from '../contract'
import { aggregateSummary, highLowSummary, kpiSummary, toPoints, type OutputValue, type SummaryResult } from '../charts/misc/narrative/insights'

export interface ValueRef {
  id: string
}

/** `{ propertyIdentifier: { objectName: 'values' }, selector: { id } }` → id. */
export function valueRefOf(v: unknown): ValueRef | undefined {
  const o = v as any
  if (!o || typeof o !== 'object' || !o.propertyIdentifier) return undefined
  const id = o.selector?.id
  return typeof id === 'string' ? { id } : undefined
}

export interface ValueDef {
  expr?: SQExpr
  formatString?: string
}

/** `objects.values` entries by selector id. */
export function valueDefs(visualJson: any): Map<string, ValueDef> {
  const m = new Map<string, ValueDef>()
  for (const e of visualJson?.visual?.objects?.values ?? []) {
    const id = e?.selector?.id
    if (typeof id !== 'string') continue
    const p = e.properties ?? {}
    // `{ expr }` (PBIR) or `{ propertyDefinitionKind: 'ExprContext', value: { expr } }` (some PBIX layouts)
    const expr = p.expr?.expr ?? p.expr?.value?.expr ?? p.expr
    const fs = p.formatString?.expr?.Literal?.Value
    m.set(id, { expr: expr && typeof expr === 'object' ? expr : undefined, formatString: typeof fs === 'string' ? fs.replace(/^'|'$/g, '').replace(/''/g, "'") : undefined })
  }
  return m
}

export type EvalResult = { value: Scalar; formatted: string } | { unsupported: string } | { error: string }

function hasTransform(e: any): boolean {
  if (!e || typeof e !== 'object') return false
  if (Array.isArray(e)) return e.some(hasTransform)
  if (e.Transform || e.TransformTableRef || e.TransformOutputRoleRef) return true
  return Object.values(e).some(hasTransform)
}

function aliasMap(q: any): Record<string, string> {
  const m: Record<string, string> = {}
  for (const f of q?.From ?? []) if (f?.Entity) m[f.Name] = f.Entity
  return m
}

function deAlias(e: any, aliases: Record<string, string>): any {
  if (Array.isArray(e)) return e.map((x) => deAlias(x, aliases))
  if (!e || typeof e !== 'object') return e
  if (e.SourceRef?.Source && aliases[e.SourceRef.Source]) return { SourceRef: { Entity: aliases[e.SourceRef.Source] } }
  const out: any = {}
  for (const [k, v] of Object.entries(e)) out[k] = deAlias(v, aliases)
  return out
}

function stripName(sel: any): SQExpr {
  const { Name: _n, ...rest } = sel
  return rest
}

const isGroup = (e: any) => !!(e?.Column || e?.HierarchyLevel)

export interface QueryRows {
  names: string[]
  rows: Scalar[][]
  formatStrings: Array<string | undefined>
  dataTypes: Array<string | undefined>
}

/** Run an SQ `Query` (Select/Where/OrderBy/Top, entity From) with the visual's filters. */
export function runSQQuery(ctx: VisualHostContext, q: any): QueryRows {
  const aliases = aliasMap(q)
  const sel: any[] = q.Select ?? []
  const groups: Array<{ name: string; expr: SQExpr }> = []
  const values: Array<{ name: string; expr: SQExpr }> = []
  for (const s of sel) {
    const expr = deAlias(stripName(s), aliases)
    ;(isGroup(expr) ? groups : values).push({ name: s.Name, expr })
  }
  const filters: SQFilter[] = [...ctx.filters]
  if (q.Where?.length) filters.push({ Version: q.Version ?? 2, From: q.From, Where: q.Where } as SQFilter)
  const orderBy: SortSpec[] = []
  const hidden: Array<{ id: string; expr: SQExpr }> = []
  for (const o of q.OrderBy ?? []) {
    const expr = deAlias(o.Expression, aliases)
    const key = JSON.stringify(expr)
    const direction = Number(o.Direction) === 2 ? 'desc' : 'asc'
    const gi = groups.findIndex((g) => JSON.stringify(g.expr) === key)
    const vi = values.findIndex((v) => JSON.stringify(v.expr) === key)
    if (gi >= 0) orderBy.push({ target: { group: gi }, direction })
    else if (vi >= 0) orderBy.push({ target: { value: 'v' + vi }, direction })
    else if (!isGroup(expr)) {
      const id = 'o' + hidden.length
      hidden.push({ id, expr })
      orderBy.push({ target: { value: id }, direction })
    }
  }
  const res = ctx.engine.summarize({
    groupBy: groups.map((g) => ({ kind: 'sq' as const, expr: g.expr })),
    values: [...values.map((v, i) => ({ id: 'v' + i, expr: { kind: 'sq' as const, expr: v.expr } })), ...hidden.map((h) => ({ id: h.id, expr: { kind: 'sq' as const, expr: h.expr } }))],
    filters,
    orderBy,
    limit: typeof q.Top === 'number' ? q.Top : undefined,
    keepBlankRows: groups.length === 0
  })
  const width = groups.length + values.length
  return {
    names: [...groups.map((g) => g.name), ...values.map((v) => v.name)],
    rows: res.rows.map((r) => r.slice(0, width)),
    formatStrings: res.columns.slice(0, width).map((c) => c.formatString),
    dataTypes: res.columns.slice(0, width).map((c) => c.dataType)
  }
}

/** SQ QueryAggregateFunction over a list of values (Sum, Avg, CountNonNull/DistinctCount, Min, Max, Count, Median). */
export function aggregateValues(fn: number, vals: Scalar[]): Scalar {
  const xs = vals.filter((v) => v !== null && v !== undefined && v !== '')
  const nums = xs.filter((v): v is number => typeof v === 'number')
  const cmp = (a: Scalar, b: Scalar) => (a instanceof Date && b instanceof Date ? a.getTime() - b.getTime() : typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)))
  switch (fn) {
    case 0:
      return nums.length ? nums.reduce((a, b) => a + b, 0) : null
    case 1:
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
    case 2:
      return new Set(xs.map((v) => (v instanceof Date ? v.getTime() : v))).size
    case 3:
      return xs.length ? [...xs].sort(cmp)[0] : null
    case 4:
      return xs.length ? [...xs].sort(cmp)[xs.length - 1] : null
    case 5:
      return xs.length
    case 6: {
      if (!nums.length) return null
      const s = [...nums].sort((a, b) => a - b)
      const m = s.length >> 1
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
    }
    default:
      return xs.length ? xs[0] : null
  }
}

/** Evaluate a dynamic value expression to a formatted string. */
export function evaluateDynamicValue(ctx: VisualHostContext, def: ValueDef | undefined, cache?: TransformCache): EvalResult {
  const expr: any = def?.expr
  if (!expr) return { error: 'missing value' }
  if (hasTransform(expr)) return evaluateTransformValue(ctx, expr, def?.formatString, cache)
  try {
    const sub = expr.Aggregation?.Expression?.Column?.Expression?.Subquery?.Query
    if (sub) {
      const prop = expr.Aggregation.Expression.Column.Property
      const r = runSQQuery(ctx, sub)
      const idx = r.names.indexOf(prop)
      if (idx < 0) return { error: `column ${prop} not in subquery` }
      const value = aggregateValues(Number(expr.Aggregation.Function ?? 0), r.rows.map((row) => row[idx]))
      const fs = def?.formatString ?? r.formatStrings[idx]
      return { value, formatted: value === null ? '' : ctx.format(value, fs, r.dataTypes[idx] as any) }
    }
    const res = ctx.engine.summarize({ groupBy: [], values: [{ id: 'v', expr: { kind: 'sq', expr } }], filters: ctx.filters, keepBlankRows: true })
    const value = res.rows[0]?.[0] ?? null
    const fs = def?.formatString ?? res.formats?.[0]?.[0] ?? res.columns[0]?.formatString
    return { value, formatted: value === null ? '' : ctx.format(value, fs, res.columns[0]?.dataType) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

// ------------------------------------------------------------------------------------------------
// Smart narrative transforms
// ------------------------------------------------------------------------------------------------

/** Algorithms evaluated by Lumen (outputs + template choice in insights.ts). */
export const NARRATIVE_ALGORITHMS = ['HighPointLowPointSummary', 'AggregateSummary', 'KPISummary'] as const

export interface TransformEval {
  result: SummaryResult
  category?: { formatString?: string; dataType?: DataType }
  measures: Array<{ formatString?: string; dataType?: DataType }>
}

/** Per-render cache: several value refs ("V1", "V2 (1)", …) share one transform. */
export type TransformCache = Map<string, TransformEval | { unsupported: string } | { error: string }>

function literalParam(t: any, name: string): unknown {
  const p = (t?.Input?.Parameters ?? []).find((x: any) => x?.Name === name)
  const raw = p?.Literal?.Value
  if (typeof raw !== 'string') return undefined
  const m = /^(-?\d+(?:\.\d+)?)[LDM]?$/.exec(raw)
  return m ? Number(m[1]) : raw.replace(/^'|'$/g, '')
}

/** Run a smart-narrative transform: input table → engine.summarize → insight outputs + template id. */
export function evaluateTransform(ctx: VisualHostContext, q: any): TransformEval | { unsupported: string } {
  const transforms: any[] = q?.Transform ?? []
  if (transforms.length !== 1) return { unsupported: 'smart narrative summary' }
  const tr = transforms[0]
  const algorithm = String(tr.Algorithm ?? '')
  if (!(NARRATIVE_ALGORITHMS as readonly string[]).includes(algorithm)) return { unsupported: `smart narrative summary (${algorithm || 'unknown'})` }
  const aliases = aliasMap(q)
  const cols: any[] = tr.Input?.Table?.Columns ?? []
  const series = cols.find((c) => /SeriesColumnRole$/.test(String(c?.Role)))
  const valueCols = cols.filter((c) => /ValueColumnRole$/.test(String(c?.Role)))
  if (!valueCols.length) return { unsupported: 'smart narrative summary (no value column)' }
  const filters: SQFilter[] = [...ctx.filters]
  if (q.Where?.length) filters.push({ Version: q.Version ?? 2, From: (q.From ?? []).filter((f: any) => f?.Entity), Where: q.Where } as SQFilter)
  const res = ctx.engine.summarize({
    groupBy: series ? [{ kind: 'sq' as const, expr: deAlias(series.Expression, aliases) }] : [],
    values: valueCols.map((c, i) => ({ id: 'v' + i, expr: { kind: 'sq' as const, expr: deAlias(c.Expression, aliases) } })),
    filters,
    orderBy: series ? [{ target: { group: 0 }, direction: 'asc' as const }] : undefined
  })
  const g = series ? 1 : 0
  const catCol = series ? res.columns[0] : undefined
  const raws = res.rows.map((r) => (series ? r[0] : null))
  const labels = raws.map((x) => (x === null || x === undefined ? '(Blank)' : catCol ? ctx.format(x, catCol.formatString, catCol.dataType) : String(x)))
  const num = (x: Scalar) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
  const measureVals = valueCols.map((_, i) => res.rows.map((r) => num(r[g + i])))
  const initial = Number(literalParam(tr, 'initialTemplateId'))
  let result: SummaryResult
  if (algorithm === 'HighPointLowPointSummary') result = highLowSummary(toPoints(labels, measureVals[0], raws), Number.isFinite(initial) ? initial : 10000)
  else if (algorithm === 'AggregateSummary') result = aggregateSummary(toPoints(labels, measureVals[0], raws))
  else result = kpiSummary(labels, measureVals, raws)
  return {
    result,
    category: catCol ? { formatString: catCol.formatString, dataType: catCol.dataType } : undefined,
    measures: valueCols.map((_, i) => ({ formatString: res.columns[g + i]?.formatString, dataType: res.columns[g + i]?.dataType }))
  }
}

function formatOutput(ctx: VisualHostContext, ev: TransformEval, o: OutputValue | undefined, formatString: string | undefined): string {
  if (!o || o.value === null || o.value === undefined) return ''
  switch (o.kind) {
    case 'category':
      return typeof o.value === 'string' && !ev.category ? o.value : ctx.format(o.value, formatString ?? ev.category?.formatString, ev.category?.dataType)
    case 'percent':
      return ctx.format(o.value, formatString ?? '0.00%', 'double')
    case 'count':
      return ctx.format(o.value, formatString ?? '#,0', 'int64')
    default: {
      const m = ev.measures[o.measure ?? 0] ?? ev.measures[0]
      return ctx.format(o.value, formatString ?? m?.formatString, m?.dataType)
    }
  }
}

/** One output column of a transform subquery (`Aggregation(Column(Subquery{ Transform }), Property)`). */
function evaluateTransformValue(ctx: VisualHostContext, expr: any, formatString: string | undefined, cache?: TransformCache): EvalResult {
  const column = expr?.Aggregation?.Expression?.Column
  const q = column?.Expression?.Subquery?.Query
  const prop = String(column?.Property ?? '')
  if (!q?.Transform) return { unsupported: 'smart narrative summary' }
  const key = JSON.stringify({ f: q.From, w: q.Where, t: q.Transform })
  let ev = cache?.get(key)
  if (!ev) {
    try {
      ev = evaluateTransform(ctx, q)
    } catch (e) {
      ev = { error: e instanceof Error ? e.message : String(e) }
    }
    cache?.set(key, ev)
  }
  if ('unsupported' in ev || 'error' in ev) return ev
  if (prop === 'TemplateIdColumnRole') return { value: ev.result.templateId, formatted: String(ev.result.templateId) }
  const o = ev.result.outputs[prop]
  return { value: o?.value ?? null, formatted: formatOutput(ctx, ev, o, formatString) }
}
