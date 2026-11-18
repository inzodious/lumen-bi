/**
 * createEngine — the QueryEngine implementation over the tabular DAX engine (src/core/dax/tabular).
 *
 * The SemanticModel + DataStore are encoded into a columnar DaxModel (dictionary-encoded columns, virtual blank
 * rows, relationship row maps). SQ filters are translated into engine filters; visuals are SUMMARIZECOLUMNS
 * evaluations. Calculated columns/tables are computed by processCalculated() and written back into the DataStore.
 */
import type { DataType, SemanticModel } from '../model/types'
import type { DataStore, Scalar as DataScalar, TableData } from '../model/data'
import type { SQExpr, SQFilter } from '../report/sq'
import type {
  ColumnRef,
  DaxQueryResult,
  DistinctValuesRequest,
  ExpressionDiagnostic,
  FieldDescription,
  GroupExpr,
  QueryEngine,
  ResultColumn,
  SummarizeRequest,
  SummarizeResult,
  ValueExpr,
  VisualCalcRequest,
  VisualCalcResult
} from './api'
import { DaxError } from '../dax/tabular/errors'
import { Evaluator } from '../dax/tabular/evaluator'
import { colFilter, FilterContext, filterContentKey, rowsFilter, type Filter } from '../dax/tabular/filters'
import { buildModel, type Col, type DaxModel, type Measure, type Tbl } from '../dax/tabular/model'
import { parseExpression, type Node } from '../dax/tabular/parser'
import { calcGraph, calcItemKey, processCalculated as runCalculated, type CalcItem } from '../dax/tabular/process'
import { runQuery } from '../dax/tabular/query'
import type { EvalOptions } from '../dax/tabular/registry'
import { summarizeColumnsCore, type SummarizeExt } from '../dax/tabular/fn-table'
import { parseNameRef } from '../dax/tabular/fn-filter'
import { isTable, TableValue } from '../dax/tabular/table'
import { cleanScalar, inferDataType, sortCompare, toBool, valueDataType, type Scalar } from '../dax/tabular/values'
import { formatValue } from './format'
import { AGG_DAX, callNode, colNode, measureNode, SqResolver, valueNode, type Resolved } from './sqtranslate'
import { validateDax } from './validate'
import { columnRef, filterTable, printDax } from './daxquery'
import { densifyCells, evaluateVisualCalcs, VisualMatrix, type VisualCell } from '../dax/tabular/visualcalc'

export interface EngineOptions {
  /** clock for TODAY/NOW and relative date filters (default: system clock) */
  now?: () => Date
  /** USERPRINCIPALNAME() / USERNAME() */
  userPrincipalName?: string
  userName?: string
  /** max group combinations evaluated by summarize before switching to fact-driven auto-exist */
  maxCombos?: number
  /**
   * Time budget of one summarize / distinctValues / evaluateScalar call in ms (default 15000; 0 = none). When it is
   * exceeded the call returns the rows computed so far with `truncated` and a warning instead of blocking the UI.
   */
  queryBudgetMs?: number
}

/**
 * Calculated objects keep the values stored with the data (PBIX / cache / .wbi) until their definition or one of
 * their inputs changes, like Power BI, which only recomputes them on refresh (a TODAY()-based column keeps the value
 * of the last refresh). Each object's fingerprint covers its expression, the measures it references, the identity of
 * the data tables it reads and its calculated dependencies; the fingerprint of the values currently in a DataStore is
 * remembered per DataStore. The first engine that sees a DataStore accepts the stored values as up to date.
 */
const stampStores = new WeakMap<DataStore, Map<string, string>>()
const tableDataIds = new WeakMap<TableData, number>()
let nextTableDataId = 1
function dataId(td: TableData | undefined): string {
  if (!td) return '-'
  let id = tableDataIds.get(td)
  if (id === undefined) {
    id = nextTableDataId++
    tableDataIds.set(td, id)
  }
  return String(id)
}
const VOLATILE = /\b(TODAY|NOW|UTCNOW|UTCTODAY|RAND|RANDBETWEEN|USERNAME|USERPRINCIPALNAME|CUSTOMDATA)\s*\(/i

function stableKey(it: CalcItem): string {
  return it.kind === 'column' ? `c:${it.col.table.name.toLowerCase()}|${it.col.name.toLowerCase()}` : `t:${it.table.name.toLowerCase()}`
}

const AGG_FN: Record<string, string> = {
  sum: 'SUM',
  avg: 'AVERAGE',
  min: 'MIN',
  max: 'MAX',
  count: 'COUNTA',
  countNonNull: 'COUNTA',
  distinctCount: 'DISTINCTCOUNT',
  median: 'MEDIAN',
  stdev: 'STDEV.S',
  var: 'VAR.S'
}
const AGG_LABEL: Record<number, string> = { 0: 'Sum of', 1: 'Average of', 2: 'Count of', 3: 'Min of', 4: 'Max of', 5: 'Count of', 6: 'Median of', 7: 'Standard deviation of', 8: 'Variance of' }

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

class TabularEngine implements QueryEngine {
  private dm!: DaxModel
  private sq!: SqResolver
  private buildIssues: Array<{ table: string; column?: string; error: string }> = []
  private processed = false
  private rls: Filter[] = []
  private rlsRoles: string[] | null = null
  private sortKeyCache = new Map<Col, Map<number, Scalar>>()
  /** calculated objects whose values are missing or out of date (see stampStores) */
  private stale: CalcItem[] = []
  private fingerprints = new Map<string, string>()

  constructor(
    readonly model: SemanticModel,
    readonly data: DataStore,
    private readonly options: EngineOptions = {}
  ) {
    this.rebuild()
  }

  private rebuild(): void {
    this.buildIssues = []
    this.dm = buildModel(this.model, this.data, this.buildIssues)
    // calculated objects already present in the DataStore (stored in the file or written back by processCalculated)
    const stored = new Set<string>()
    for (const t of this.dm.tables) {
      if (t.expression && !t.calcGroup && this.data.tables.has(t.name)) stored.add(`t:${t.name.toLowerCase()}`)
      for (const c of t.cols) {
        if (c.kind !== 'calculated') continue
        const td = this.data.tables.get(t.name)
        const cd = td?.columns.find((x) => x.name.toLowerCase() === c.name.toLowerCase())
        if (cd && cd.values.length === t.rowCount) {
          c.setValues(cd.values.map((v) => (v instanceof Uint8Array ? null : v)))
          stored.add(`c:${t.name.toLowerCase()}|${c.name.toLowerCase()}`)
        }
      }
    }
    this.dm.computeBlankRows()
    this.computeStale(stored)
    this.processed = this.stale.length === 0
    this.sq = new SqResolver(this.dm, this.model)
    this.sortKeyCache.clear()
    if (this.rlsRoles) this.applyRoles(this.rlsRoles)
  }

  private computeStale(stored: Set<string>): void {
    const g = calcGraph(this.dm)
    const fps = new Map<string, string>()
    const allData = () => [...this.data.tables.entries()].filter(([n]) => !this.dm.findTable(n)?.expression).map(([, td]) => dataId(td)).join(',')
    const fp = (key: string, depth = 0): string => {
      const hit = fps.get(key)
      if (hit !== undefined) return hit
      if (depth > 200) return 'cycle'
      fps.set(key, 'cycle')
      const it = g.byKey.get(key)!
      const inp = g.inputs.get(key)
      const expr = it.kind === 'column' ? it.col.expression ?? '' : it.table.expression ?? ''
      const parts = [expr, ...(inp?.measures ?? []), ...(inp?.tables ?? []).map((t) => `${t.name}#${dataId(this.data.tables.get(t.name))}`)]
      if (VOLATILE.test(expr) || (inp?.measures ?? []).some((m) => VOLATILE.test(m))) parts.push('all#' + allData())
      for (const d of g.deps.get(key) ?? []) parts.push(fp(d, depth + 1))
      const v = hashText(parts.join('\u0000'))
      fps.set(key, v)
      return v
    }
    let stamps = stampStores.get(this.data)
    const first = !stamps
    if (!stamps) {
      stamps = new Map()
      stampStores.set(this.data, stamps)
    }
    this.fingerprints = new Map()
    const staleKeys = new Set<string>()
    for (const it of g.items) {
      const key = calcItemKey(it)
      const sk = stableKey(it)
      const f = fp(key)
      this.fingerprints.set(sk, f)
      if (!stored.has(sk)) staleKeys.add(key)
      else if (first) stamps.set(sk, f)
      else if (stamps.get(sk) !== f) staleKeys.add(key)
    }
    // dependents of stale objects are stale too
    let grew = true
    while (grew) {
      grew = false
      for (const it of g.items) {
        const key = calcItemKey(it)
        if (staleKeys.has(key)) continue
        if ((g.deps.get(key) ?? []).some((d) => staleKeys.has(d))) {
          staleKeys.add(key)
          grew = true
        }
      }
    }
    this.stale = g.items.filter((it) => staleKeys.has(calcItemKey(it)))
  }

  private ensureProcessed(): void {
    if (!this.processed) this.processCalculated()
  }

  private evalOptions(): EvalOptions {
    return { now: this.options.now, userPrincipalName: this.options.userPrincipalName, userName: this.options.userName }
  }

  private now(): Date {
    const d = (this.options.now ?? (() => new Date()))()
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()))
  }

  private evaluator(): Evaluator {
    const ev = new Evaluator(this.dm, this.evalOptions())
    const budget = this.options.queryBudgetMs ?? 15_000
    if (budget > 0) ev.deadline = Date.now() + budget
    return ev
  }

  // ---------------------------------------------------------------------------------------------
  // filters
  // ---------------------------------------------------------------------------------------------

  private context(filters: SQFilter[] | undefined, warnings: string[]): { ctx: FilterContext; measureConds: Node[] } {
    const ev = this.evaluator()
    const tr = this.sq.translate(filters ?? [], this.now(), (sub, outerAliases, done) => this.topN(ev, sub, outerAliases, done))
    warnings.push(...tr.warnings)
    const ctx = new FilterContext(this.dm, { filters: tr.filters, secure: this.rls })
    return { ctx: ctx.with({ shadow: ctx.filters }), measureConds: tr.measureConds }
  }

  private topN(ev: Evaluator, sub: any, outer: Record<string, string>, done: Filter[]): Filter | null {
    const q = sub?.Query
    if (!q) return null
    const aliases: Record<string, string> = { ...outer }
    for (const fr of q.From ?? []) if (fr.Entity) aliases[fr.Name] = fr.Entity
    const sel = this.sq.resolve(q.Select?.[0], aliases)
    if (!sel || sel.kind !== 'column') return null
    const order = q.OrderBy?.[0]
    const ordR = order ? this.sq.resolve(order.Expression, aliases) : null
    const n = Number(q.Top ?? 10)
    const values = callNode('VALUES', [colNode(sel.col)])
    const args: Node[] = [{ kind: 'number', value: n, s: 0, e: 0 }, values]
    if (ordR) args.push(valueNode(ordR), { kind: 'ident', name: Number(order.Direction) === 1 ? 'ASC' : 'DESC', quoted: false, s: 0, e: 0 })
    // the same TopN filter (report / page level) is evaluated by every visual of the page: cache it per
    // (subquery, filters it depends on, model version)
    const key = `${this.dm.version}|${JSON.stringify(sub)}|${JSON.stringify(outer)}|${done.map(filterContentKey).sort().join(';')}|${this.rls.map(filterContentKey).join(';')}`
    const cache = this.topNCache.dm === this.dm ? this.topNCache.map : (this.topNCache = { dm: this.dm, map: new Map() }).map
    const hit = cache.get(key)
    if (hit) return hit
    const ctx = new FilterContext(this.dm, { filters: done, secure: this.rls })
    const t = ev.table(callNode('TOPN', args), ev.rootEnv(ctx), 'TOPN')
    const f = colFilter(sel.col, t.column(0).map((v) => sel.col.codeOf(v)))
    if (cache.size > 200) cache.clear()
    cache.set(key, f)
    return f
  }
  private topNCache: { dm: unknown; map: Map<string, Filter> } = { dm: null, map: new Map() }

  private measureCondsPass(ev: Evaluator, ctx: FilterContext, conds: Node[], warnings: string[]): boolean {
    for (const c of conds) {
      try {
        if (!toBool(ev.scalar(c, ev.rootEnv(ctx)))) return false
      } catch (e) {
        warnings.push(`Measure filter failed: ${errMessage(e)}`)
        return false
      }
    }
    return true
  }

  // ---------------------------------------------------------------------------------------------
  // field resolution
  // ---------------------------------------------------------------------------------------------

  private groupCol(g: GroupExpr): Col {
    if ('kind' in g && g.kind === 'sq') {
      const r = this.sq.resolve(g.expr)
      if (!r || r.kind !== 'column') throw new DaxError('REF', `Cannot resolve the group-by field ${JSON.stringify(g.expr).slice(0, 160)}.`)
      return r.col
    }
    const ref = g as ColumnRef
    const c = this.dm.column(ref.table, ref.column)
    if (!c) throw new DaxError('REF', `Column '${ref.table}'[${ref.column}] cannot be found.`)
    return c
  }

  private valueExpr(v: ValueExpr): { node: Node; measure?: Measure; col?: Col; dataType?: DataType; formatString?: string; fn?: string } {
    switch (v.kind) {
      case 'measure': {
        const m = this.dm.measure(v.measure)
        if (!m) throw new DaxError('REF', `The measure '${v.table}'[${v.measure}] cannot be found.`)
        return { node: measureNode(m), measure: m, formatString: m.formatString }
      }
      case 'aggregate': {
        const c = this.dm.column(v.table, v.column)
        if (!c) throw new DaxError('REF', `Column '${v.table}'[${v.column}] cannot be found.`)
        const fn = AGG_FN[v.fn] ?? 'SUM'
        return { node: callNode(fn, [colNode(c)]), col: c, fn, formatString: /COUNT/.test(fn) ? undefined : c.formatString }
      }
      case 'dax':
        return { node: parseExpression(v.expression) }
      case 'sq': {
        const r = this.sq.resolve(v.expr)
        if (!r) throw new DaxError('REF', `Cannot resolve the field ${JSON.stringify(v.expr).slice(0, 160)}.`)
        return this.resolvedValue(r)
      }
    }
  }

  private resolvedValue(r: Resolved): { node: Node; measure?: Measure; col?: Col; fn?: string; formatString?: string } {
    if (r.kind === 'measure') return { node: valueNode(r), measure: r.measure, formatString: r.measure.formatString }
    if (r.kind === 'aggregation') {
      const fn = AGG_DAX[r.fn] ?? 'SUM'
      return { node: valueNode(r), col: r.col, fn, formatString: /COUNT/.test(fn) ? undefined : r.col.formatString }
    }
    if (r.kind === 'column') return { node: valueNode(r), col: r.col, formatString: r.col.formatString }
    return { node: r.node }
  }

  private sortKeys(c: Col): Map<number, Scalar> | null {
    if (!c.sortBy) return null
    let m = this.sortKeyCache.get(c)
    if (!m) {
      m = new Map()
      const s = c.sortBy
      for (let r = 0; r < c.table.rowCount; r++) {
        const code = c.codes[r]
        if (!m.has(code)) m.set(code, s.value(r))
      }
      this.sortKeyCache.set(c, m)
    }
    return m
  }

  private groupSortValue(c: Col, v: Scalar): Scalar {
    const keys = this.sortKeys(c)
    if (!keys) return v
    const code = c.codeOf(v)
    return keys.get(code) ?? v
  }

  // ---------------------------------------------------------------------------------------------
  // QueryEngine
  // ---------------------------------------------------------------------------------------------

  summarize(req: SummarizeRequest): SummarizeResult {
    this.ensureProcessed()
    const warnings: string[] = []
    const groupCols = req.groupBy.map((g) => this.groupCol(g))
    const values = req.values.map((v) => {
      try {
        return { id: v.id, ...this.valueExpr(v.expr), error: undefined as string | undefined }
      } catch (e) {
        warnings.push(`${v.id}: ${errMessage(e)}`)
        return { id: v.id, node: callNode('BLANK', []), error: errMessage(e) } as { id: string; node: Node; measure?: Measure; col?: Col; fn?: string; formatString?: string; error?: string }
      }
    })
    const { ctx, measureConds } = this.context(req.filters, warnings)
    const ev = this.evaluator()
    const exts: SummarizeExt[] = values.map((v) => ({ name: v.id, expr: v.node }))
    const errorsSeen = new Set<string>()
    const dynamic = values.map((v) => !!v.measure && (!!v.measure.formatExpression || this.dm.calcGroups.some((g) => g.items.some((i) => i.formatExpression))))
    const formats: Array<Array<string | undefined>> = []
    const keepRow = (rowCtx: FilterContext, row: Scalar[]): boolean => {
      if (measureConds.length && !this.measureCondsPass(ev, rowCtx, measureConds, warnings)) return false
      if (dynamic.some((x) => x)) {
        const f: Array<string | undefined> = values.map((v, j) => {
          if (!dynamic[j] || !v.measure) return undefined
          try {
            const s = ev.formatStringFor(v.measure, rowCtx)
            return s !== null && s !== (v.measure.formatString ?? null) ? s : undefined
          } catch (e) {
            return undefined
          }
        })
        ;(row as Scalar[] & { __fmt?: Array<string | undefined> }).__fmt = f
      }
      return true
    }
    let rows: Scalar[][]
    let timedOut = false
    try {
      rows = summarizeColumnsCore(ev, ev.rootEnv(ctx), groupCols, exts, {
        deadline: ev.deadline || undefined,
        onTimeout: () => {
          timedOut = true
        },
        keepBlankRows: req.keepBlankRows || req.showItemsWithNoData,
        showAll: req.showItemsWithNoData,
        maxCombos: this.options.maxCombos,
        onRow: keepRow,
        onError: (e, j) => {
          if (e instanceof DaxError && e.code === 'TIMEOUT') {
            timedOut = true
            return null
          }
          const msg = `${values[j].id}: ${errMessage(e)}`
          if (!errorsSeen.has(msg)) {
            errorsSeen.add(msg)
            warnings.push(msg)
          }
          return null
        }
      })
    } catch (e) {
      warnings.push(errMessage(e))
      rows = []
    }
    if (timedOut) {
      const b = this.options.queryBudgetMs ?? 15_000
      warnings.push(`The query exceeded its time budget (${b >= 1000 ? `${Math.round(b / 1000)} s` : `${b} ms`}) and was stopped; the results are partial.`)
    }
    // a visual without group-by always has one row (cards), even when the value is blank
    if (groupCols.length === 0 && rows.length === 0 && values.length && (!measureConds.length || this.measureCondsPass(ev, ctx, measureConds, warnings))) {
      rows = [values.map(() => null)]
    }
    // ordering
    const nG = groupCols.length
    const specs = req.orderBy?.length ? req.orderBy : groupCols.map((_, i) => ({ target: { group: i }, direction: 'asc' as const }))
    const sortVals = rows.map((r) =>
      specs.map((s) => ('group' in s.target ? this.groupSortValue(groupCols[s.target.group], r[s.target.group]) : r[nG + Math.max(0, req.values.findIndex((v) => v.id === (s.target as { value: string }).value))]))
    )
    const order = rows.map((_, i) => i)
    order.sort((a, b) => {
      for (let k = 0; k < specs.length; k++) {
        const c = sortCompare(sortVals[a][k], sortVals[b][k])
        if (c !== 0) return specs[k].direction === 'desc' ? -c : c
      }
      // tie-break on group columns
      for (let g = 0; g < nG; g++) {
        const c = sortCompare(this.groupSortValue(groupCols[g], rows[a][g]), this.groupSortValue(groupCols[g], rows[b][g]))
        if (c !== 0) return c
      }
      return a - b
    })
    let sorted = order.map((i) => rows[i])
    let truncated = false
    if (req.limit !== undefined && sorted.length > req.limit) {
      sorted = sorted.slice(0, req.limit)
      truncated = true
    }
    for (const r of sorted) formats.push((r as Scalar[] & { __fmt?: Array<string | undefined> }).__fmt ?? values.map(() => undefined))
    const outRows = sorted.map((r) => r.map(cleanScalar))
    // highlights: the same rows with the extra filters
    let highlights: Scalar[][] | undefined
    if (req.highlightFilters?.length) {
      const hw: string[] = []
      const extra = this.sq.translate(req.highlightFilters, this.now(), (sub, al, done) => this.topN(ev, sub, al, done))
      hw.push(...extra.warnings)
      const hctx = ctx.addFilters(extra.filters, false)
      highlights = outRows.map((r) => {
        const fs = groupCols.map((c, g) => colFilter(c, [c.codeOf(r[g])]))
        const cctx = hctx.addFilters(fs, false).with({ scope: new Set(groupCols.map((c) => c.id)) })
        return values.map((v) => {
          try {
            return cleanScalar(ev.scalar(v.node, ev.rootEnv(cctx)))
          } catch {
            return null
          }
        })
      })
      warnings.push(...hw)
    }
    const columns: ResultColumn[] = [
      ...groupCols.map((c) => ({ id: `${c.table.name}.${c.name}`, kind: 'group' as const, dataType: c.dataType, formatString: c.formatString, name: c.name.startsWith('\u0001') ? c.name.slice(c.name.lastIndexOf('.') + 1) : c.name })),
      ...values.map((v, j) => ({
        id: v.id,
        kind: 'value' as const,
        dataType: this.valueType(v, outRows.map((r) => r[nG + j]), ev),
        formatString: v.formatString,
        name: v.measure?.name ?? (v.col ? `${v.fn ?? ''} ${v.col.name}`.trim() : v.id)
      }))
    ]
    const result: SummarizeResult = { columns, rows: outRows }
    if (formats.some((f) => f.some((x) => x !== undefined))) result.formats = formats
    if (highlights) result.highlights = highlights
    if (truncated || timedOut) result.truncated = true
    if (warnings.length) result.warnings = warnings
    return result
  }

  private valueType(v: { measure?: Measure; col?: Col; fn?: string; node: Node }, vals: Scalar[], ev: Evaluator): DataType {
    if (v.fn) {
      if (/COUNT/.test(v.fn)) return 'int64'
      if (v.fn === 'AVERAGE' || v.fn === 'STDEV.S' || v.fn === 'VAR.S' || v.fn === 'MEDIAN') return 'double'
      if (v.col) return v.col.dataType
    }
    if (v.measure?.dataType && v.measure.dataType !== 'unknown') return v.measure.dataType
    const inferred = inferDataType(vals)
    if (inferred !== 'unknown') return inferred
    return ev.staticType(v.node) ?? 'double'
  }

  distinctValues(req: DistinctValuesRequest): { values: Scalar[]; measures?: Scalar[]; dataType: DataType } {
    this.ensureProcessed()
    const warnings: string[] = []
    const col = this.groupCol(req.column)
    const { ctx } = this.context(req.filters, warnings)
    const ev = this.evaluator()
    let codes = Array.from(ev.visibleCodes(col, ctx, true))
    // slicers cross-filter each other through fact tables: keep values that exist in facts filtered by other tables
    const own = new Set(ctx.expandedColumns(col.table).map((c) => c.id))
    const other = ctx.filters.filter((f) => !(f.kind === 'col' ? own.has(f.col.id) : f.kind === 'tuple' ? f.cols.every((c) => own.has(c.id)) : f.table === col.table))
    if (other.length) {
      const fctx = ctx.with({ filters: other })
      for (const F of this.dm.tables) {
        if (F === col.table) continue
        const st = fctx.expansion(F).stepOf.get(col.table)
        if (!st) continue
        const vis = fctx.visible(F)
        if (vis.length === F.fullCount) continue
        const via = this.dm.codesVia(st.path, col)
        const allow = new Uint8Array(col.dict.length)
        for (const r of vis) allow[via[r]] = 1
        codes = codes.filter((c) => allow[c])
      }
    }
    let vals = codes.map((c) => col.dict[c])
    if (req.search) {
      const s = req.search.toLowerCase()
      vals = vals.filter((v) => v !== null && formatValue(v as DataScalar, col.formatString, col.dataType).toLowerCase().includes(s))
    }
    vals.sort((a, b) => sortCompare(this.groupSortValue(col, a), this.groupSortValue(col, b)) || sortCompare(a, b))
    if (req.limit !== undefined) vals = vals.slice(0, req.limit)
    let measures: Scalar[] | undefined
    if (req.withMeasure) {
      const v = this.valueExpr(req.withMeasure)
      measures = vals.map((x) => {
        try {
          return cleanScalar(ev.scalar(v.node, ev.rootEnv(ctx.addFilters([colFilter(col, [col.codeOf(x)])], false))))
        } catch {
          return null
        }
      })
    }
    return measures ? { values: vals, measures, dataType: col.dataType } : { values: vals, dataType: col.dataType }
  }

  evaluateScalar(expression: string, filters?: SQFilter[]): { value: Scalar; formatString?: string } {
    this.ensureProcessed()
    const warnings: string[] = []
    const { ctx, measureConds } = this.context(filters, warnings)
    const ev = this.evaluator()
    const ast = parseExpression(expression)
    if (measureConds.length && !this.measureCondsPass(ev, ctx, measureConds, warnings)) return { value: null }
    const value = cleanScalar(ev.scalar(ast, ev.rootEnv(ctx)))
    let formatString: string | undefined
    if (ast.kind === 'column') {
      const m = ev.measureFor(ast)
      if (m) formatString = ev.formatStringFor(m, ctx) ?? undefined
    }
    return formatString ? { value, formatString } : { value }
  }

  runDaxQuery(query: string): DaxQueryResult {
    this.ensureProcessed()
    const t0 = Date.now()
    const tables = runQuery(this.dm, query, this.evalOptions())
    this.sortKeyCache.clear()
    return { tables: tables.map((t) => ({ columns: t.columns, rows: t.rows })), durationMs: Date.now() - t0 }
  }

  validateExpression(expression: string, context: { kind: 'measure' | 'calculatedColumn' | 'calculatedTable'; table?: string }): ExpressionDiagnostic[] {
    return validateDax(this.dm, expression, context)
  }

  format(value: Scalar, formatString?: string, dataType?: DataType): string {
    return formatValue(value as DataScalar, formatString, dataType)
  }

  processCalculated(): Array<{ table: string; column?: string; error: string }> {
    const stale = this.stale
    const only = { tables: new Set<string>(), columns: new Set<Col>() }
    for (const it of stale) {
      if (it.kind === 'table') only.tables.add(it.table.name.toLowerCase())
      else only.columns.add(it.col)
    }
    const issues = stale.length ? runCalculated(this.dm, { ...this.evalOptions(), keepStoredOnError: true }, only) : []
    const stamps = stampStores.get(this.data)
    const failed = new Set(issues.filter((i) => !(i as { kept?: boolean }).kept).map((i) => `${i.table.toLowerCase()}|${(i.column ?? '').toLowerCase()}`))
    for (const it of stale) {
      const sk = stableKey(it)
      const f = this.fingerprints.get(sk)
      const fk = it.kind === 'column' ? `${it.col.table.name.toLowerCase()}|${it.col.name.toLowerCase()}` : `${it.table.name.toLowerCase()}|`
      if (f && stamps && !failed.has(fk)) stamps.set(sk, f)
    }
    this.stale = []
    this.processed = true
    this.sortKeyCache.clear()
    this.writeBack()
    // re-apply RLS (row ids may have changed)
    if (this.rlsRoles) this.applyRoles(this.rlsRoles)
    return [...this.buildIssues, ...issues]
  }

  /** Store calculated tables / columns into the DataStore so the data view and exports see them. */
  private writeBack(): void {
    for (const t of this.dm.tables) {
      const isCalcTable = !!t.expression && !t.calcGroup
      const calcCols = t.cols.filter((c) => c.kind === 'calculated' && !c.name.startsWith('\u0001'))
      if (!isCalcTable && calcCols.length === 0) continue
      const values = (c: Col): DataScalar[] => {
        const out = new Array<DataScalar>(t.rowCount)
        for (let r = 0; r < t.rowCount; r++) out[r] = c.value(r)
        return out
      }
      if (isCalcTable) {
        const td: TableData = { columns: t.cols.filter((c) => !c.name.startsWith('\u0001')).map((c) => ({ name: c.name, type: c.dataType, values: values(c) })), rowCount: t.rowCount }
        this.data.tables.set(t.name, td)
        this.data.status.set(t.name, { state: 'loaded', source: 'calculated', rowCount: t.rowCount })
        continue
      }
      const td = this.data.tables.get(t.name)
      if (!td) continue
      for (const c of calcCols) {
        const existing = td.columns.findIndex((x) => x.name.toLowerCase() === c.name.toLowerCase())
        const cd = { name: c.name, type: c.dataType, values: values(c) }
        if (existing >= 0) td.columns[existing] = cd
        else td.columns.push(cd)
      }
    }
  }

  invalidate(): void {
    this.rebuild()
  }

  describeField(expr: SQExpr): FieldDescription | undefined {
    const r = this.sq.resolve(expr)
    if (!r) return undefined
    if (r.kind === 'measure') {
      const m = r.measure
      const d: FieldDescription = { kind: 'measure', table: m.table.name, name: m.name, displayName: m.name, dataType: m.dataType ?? this.measureType(m), formatString: m.formatString, isMeasure: true }
      if (m.kpiOf && m.kpiPart) d.kpi = { measure: m.kpiOf, part: m.kpiPart, statusGraphic: m.kpiGraphic, ...(m.kpiTrendGraphic ? { trendGraphic: m.kpiTrendGraphic } : {}) }
      return d
    }
    if (r.kind === 'aggregation') {
      const c = r.col
      let label = `${AGG_LABEL[r.fn] ?? 'Sum of'} ${c.name}`
      if (c.dataType === 'dateTime' && (r.fn === 3 || r.fn === 4)) label = `${r.fn === 3 ? 'Earliest' : 'Latest'} ${c.name}`
      if (c.dataType === 'string' && (r.fn === 3 || r.fn === 4)) label = `${r.fn === 3 ? 'First' : 'Last'} ${c.name}`
      const fn = AGG_DAX[r.fn] ?? 'SUM'
      return {
        kind: 'aggregation',
        table: c.table.name,
        name: c.name,
        displayName: label,
        dataType: /COUNT/.test(fn) ? 'int64' : fn === 'AVERAGE' ? 'double' : c.dataType,
        formatString: /COUNT/.test(fn) ? undefined : c.formatString,
        isMeasure: false,
        column: { table: c.table.name, column: c.name }
      }
    }
    if (r.kind === 'column') {
      const c = r.col
      const isLevel = !!expr?.HierarchyLevel
      const derived = c.name.startsWith('\u0001')
      const name = derived ? c.name.slice(c.name.lastIndexOf('.') + 1) : c.name
      return {
        kind: isLevel ? 'hierarchyLevel' : 'column',
        table: c.table.name,
        name,
        displayName: isLevel ? String(expr.HierarchyLevel.Level ?? name) : name,
        dataType: c.dataType,
        formatString: c.formatString,
        isMeasure: false,
        sortBy: c.sortBy ? { table: c.sortBy.table.name, column: c.sortBy.name } : undefined,
        column: { table: c.table.name, column: c.name },
        dataCategory: c.dataCategory,
        isFieldParameter: this.paramInfo(c.table) !== null || undefined
      }
    }
    return { kind: 'column', table: '', name: r.label, displayName: r.label, dataType: 'double', isMeasure: false }
  }

  private measureType(m: Measure): DataType {
    try {
      return this.evaluator().staticType(parseExpression(m.expression)) ?? 'double'
    } catch {
      return 'double'
    }
  }

  /** Field parameter table metadata: the fields column (NAMEOF strings), the label column and the order column. */
  private paramInfo(t: Tbl): { fields: Col; label: Col | null; order: Col | null } | null {
    const fields = t.cols.find((c) => {
      const ep = c.def?.extendedProperties
      return !!ep && Object.keys(ep).some((k) => k.toLowerCase() === 'parametermetadata')
    })
    if (!fields) return null
    const label =
      t.cols.find((c) => c !== fields && c.def?.extra && JSON.stringify(c.def.extra).includes('groupByColumn')) ??
      t.cols.find((c) => c !== fields && c.dataType === 'string' && c.sortBy && c.sortBy !== fields) ??
      t.cols.find((c) => c !== fields && c.dataType === 'string') ??
      null
    const order = label?.sortBy ?? fields.sortBy ?? t.cols.find((c) => c !== fields && c !== label && (c.dataType === 'int64' || c.dataType === 'double')) ?? null
    return { fields, label, order }
  }

  resolveFieldParameter(expr: SQExpr, filters?: SQFilter[]): Array<{ expr: SQExpr; displayName: string }> | null {
    this.ensureProcessed()
    const r = this.sq.resolve(expr)
    if (!r || r.kind !== 'column') return null
    const info = this.paramInfo(r.col.table)
    if (!info) return null
    const t = r.col.table
    const warnings: string[] = []
    // only filters on the parameter table itself decide the selection
    const own = (filters ?? []).filter((f) => JSON.stringify(f).includes(JSON.stringify(t.name)))
    const { ctx } = this.context(own, warnings)
    let ids = Array.from(ctx.visible(t)).filter((i) => i < t.rowCount)
    if (ids.length === 0) ids = Array.from(t.all()).filter((i) => i < t.rowCount)
    if (info.order) ids.sort((a, b) => sortCompare(info.order!.value(a), info.order!.value(b)) || a - b)
    const out: Array<{ expr: SQExpr; displayName: string }> = []
    const seen = new Set<string>()
    for (const i of ids) {
      const ref = info.fields.value(i)
      if (typeof ref !== 'string') continue
      const p = parseNameRef(ref)
      if (!p) continue
      const key = ref.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const display = info.label ? info.label.value(i) : p.name
      const tbl = p.table ? this.dm.findTable(p.table) : undefined
      const col = tbl?.column(p.name)
      let fexpr: SQExpr
      if (col) fexpr = { Column: { Expression: { SourceRef: { Entity: col.table.name } }, Property: col.name } }
      else {
        const m = this.dm.measure(p.name)
        if (!m) continue
        fexpr = { Measure: { Expression: { SourceRef: { Entity: m.table.name } }, Property: m.name } }
      }
      out.push({ expr: fexpr, displayName: display === null ? p.name : String(display) })
    }
    return out
  }

  toDaxQuery(req: SummarizeRequest): string {
    this.ensureProcessed()
    const groupCols = req.groupBy.map((g) => this.groupCol(g))
    const used = new Set<string>(groupCols.map((c) => c.name.toLowerCase()))
    const values = req.values.map((v) => {
      const r = this.valueExpr(v.expr)
      let name = r.measure?.name ?? (r.col && r.fn ? `${r.fn.replace(/[^A-Za-z]/g, '').replace(/^(\w)(\w*)$/, (_m, a: string, b: string) => a + b.toLowerCase())}${r.col.name}` : v.id)
      let k = 2
      const base = name
      while (used.has(name.toLowerCase())) name = `${base}${k++}`
      used.add(name.toLowerCase())
      // measure references: 'Table'[Measure] like Power BI ([Measure] when the table has a column of that name);
      // implicit measures (field-well aggregations) are wrapped in CALCULATE like Power BI does
      const text = printDax(r.node)
      return { name, text: r.measure || !r.fn ? text : `CALCULATE ( ${text} )`, id: v.id }
    })
    // Power BI groups by the sort-by column of a group column too (right after it) and orders by it
    const sortCols = groupCols.map((c) => (c.sortBy && c.sortBy !== c && !groupCols.includes(c.sortBy) ? c.sortBy : null))
    const groupArgs = groupCols.flatMap((c, i) => (sortCols[i] ? [columnRef(c), columnRef(sortCols[i]!)] : [columnRef(c)]))
    const groupOrder = (i: number) => (sortCols[i] ? [columnRef(sortCols[i]!), columnRef(groupCols[i])] : [columnRef(groupCols[i])])
    const ev = this.evaluator()
    const tr = this.sq.translate(req.filters ?? [], this.now(), (sub, al, done) => this.topN(ev, sub, al, done))
    const lines: string[] = ['// DAX Query', 'DEFINE']
    const filterVars: string[] = []
    tr.filters.forEach((f, i) => {
      const name = `__DS0FilterTable${i ? i + 1 : ''}`
      filterVars.push(name)
      lines.push(`\tVAR ${name} = `, `\t\t${filterTable(f)}`, '')
    })
    for (const w of tr.warnings) lines.push(`\t// ${w}`)
    const args = [...groupArgs, ...filterVars, ...values.map((v) => `"${v.name.replace(/"/g, '""')}", ${v.text}`)]
    lines.push('\tVAR __DS0Core = ', `\t\tSUMMARIZECOLUMNS (\n\t\t\t${args.join(',\n\t\t\t')}\n\t\t)`, '')
    let result = '__DS0Core'
    if (tr.measureConds.length) {
      // visual-level filters on measures: rows of the core table whose measure values pass (context transition)
      const cond = tr.measureConds.map((c) => printDax(c)).join(' && ')
      lines.push('\tVAR __DS0ValueFiltered = ', `\t\tFILTER ( __DS0Core, ${cond} )`, '')
      result = '__DS0ValueFiltered'
    }
    const specs = req.orderBy?.length ? req.orderBy : groupCols.map((_, i) => ({ target: { group: i }, direction: 'asc' as const }))
    const orderItems = specs.flatMap((s) => {
      const refs = 'group' in s.target ? groupOrder(s.target.group) : [`[${(values.find((v) => v.id === (s.target as { value: string }).value)?.name ?? '').replace(/]/g, ']]')}]`]
      return refs.map((ref) => ({ ref, desc: s.direction === 'desc' }))
    })
    if (req.limit !== undefined) {
      const keys = orderItems.map((o) => `${o.ref}, ${o.desc ? 0 : 1}`).join(', ')
      lines.push('\tVAR __DS0PrimaryWindowed = ', `\t\tTOPN ( ${req.limit}, ${result}${keys ? ', ' + keys : ''} )`, '')
      result = '__DS0PrimaryWindowed'
    }
    lines.push('EVALUATE', `\t${result}`)
    if (orderItems.length) lines.push('', 'ORDER BY', `\t${orderItems.map((o) => `${o.ref}${o.desc ? ' DESC' : ''}`).join(', ')}`)
    return lines.join('\n')
  }

  /**
   * The DAX query Power BI's Performance analyzer shows for a visual with visual calculations: the visual's
   * SUMMARIZECOLUMNS with ROLLUPADDISSUBTOTAL per axis (IsGrandTotalRowTotal / IsGrandTotalColumnTotal / IsDM<n>Total
   * flags, sort-by columns in ROLLUPGROUP), renamed to the visual's names, then TABLE '__DS0VisualCalcs' WITH VISUAL\n   * SHAPE (axes, levels, totals, order, DENSIFY) whose COLUMN definitions are the calculations, without the\n   * densified rows whose calculations are all blank. Runs with runDaxQuery. Approximation: Power BI numbers the\n   * IsDM<n>Total flags by its internal projection index; here n is the level's position among the projected columns.
   */
  toVisualCalcDaxQuery(req: VisualCalcRequest): string {
    this.ensureProcessed()
    const base = req.base
    const G = base.groupBy.length
    const R = Math.max(0, Math.min(req.rowFields, G))
    const groupCols = base.groupBy.map((g) => this.groupCol(g))
    const used = new Set<string>()
    const unique = (n: string) => {
      let name = n
      let k = 2
      while (used.has(name.toLowerCase())) name = `${n} (${k++})`
      used.add(name.toLowerCase())
      return name
    }
    const q = (n: string) => `"${n.replace(/"/g, '""')}"`
    const br = (n: string) => `[${n.replace(/]/g, ']]')}]`
    const groupNames = groupCols.map((c, j) => unique(req.names[j] || c.name))
    const sortCols = groupCols.map((c) => (c.sortBy && c.sortBy !== c && !groupCols.includes(c.sortBy) ? c.sortBy : null))
    const sortNames = sortCols.map((c) => (c ? unique(c.name) : null))
    // projection index of each level (group columns and their sort-by columns, in order)
    const dm: number[] = []
    let p = 0
    groupCols.forEach((_, j) => {
      dm.push(p)
      p += sortCols[j] ? 2 : 1
    })
    const flagName = (j: number) => (j === 0 ? 'IsGrandTotalRowTotal' : j === R ? 'IsGrandTotalColumnTotal' : `IsDM${dm[j]}Total`)
    const flags = groupCols.map((_, j) => unique(flagName(j)))
    const valueNames = base.values.map((v, j) => unique(req.names[G + j] || v.id))
    const coreNames = valueNames.map((n) => n.replace(/[^A-Za-z0-9_]/g, '_'))
    const values = base.values.map((v) => {
      const r = this.valueExpr(v.expr)
      const text = printDax(r.node)
      return r.measure || !r.fn ? text : `CALCULATE ( ${text} )`
    })
    const calcNames = req.calcs.map((c) => unique(c.name))
    const ev = this.evaluator()
    const tr = this.sq.translate(base.filters ?? [], this.now(), (sub, al, done) => this.topN(ev, sub, al, done))
    const lines: string[] = ['DEFINE']
    req.calcs.forEach((c, k) => lines.push(`\tCOLUMN '__DS0VisualCalcs'${br(calcNames[k])} = ${c.expression.replace(/\n/g, '\n\t\t')}`))
    if (req.calcs.length) lines.push('')
    const filterVars: string[] = []
    tr.filters.forEach((f, i) => {
      const name = `__DS0FilterTable${i ? i + 1 : ''}`
      filterVars.push(name)
      lines.push(`\tVAR ${name} = `, `\t\t${filterTable(f)}`, '')
    })
    for (const w of tr.warnings) lines.push(`\t// ${w}`)
    const level = (j: number) => (sortCols[j] ? `ROLLUPGROUP ( ${columnRef(groupCols[j])}, ${columnRef(sortCols[j]!)} )` : columnRef(groupCols[j]))
    const rollup = (from: number, to: number) => `ROLLUPADDISSUBTOTAL ( ${Array.from({ length: to - from }, (_, k) => `${level(from + k)}, ${q(flags[from + k])}`).join(', ')} )`
    const coreArgs: string[] = []
    if (R > 0) coreArgs.push(rollup(0, R))
    if (G > R) coreArgs.push(rollup(R, G))
    coreArgs.push(...filterVars, ...values.map((t, j) => `${q(coreNames[j])}, ${t}`))
    lines.push('\tVAR __DS0Core = ', `\t\tSUMMARIZECOLUMNS (\n\t\t\t${coreArgs.join(',\n\t\t\t')}\n\t\t)`, '')
    const sel: string[] = []
    groupCols.forEach((c, j) => {
      sel.push(`${q(groupNames[j])}, ${columnRef(c)}`)
      if (sortCols[j]) sel.push(`${q(sortNames[j]!)}, ${columnRef(sortCols[j]!)}`)
      sel.push(`${q(flags[j])}, ${br(flags[j])}`)
    })
    valueNames.forEach((n, j) => sel.push(`${q(n)}, ${br(coreNames[j])}`))
    lines.push('\tVAR __DS0VisualCalcsInput = ', `\t\tSELECTCOLUMNS (\n\t\t\t__DS0Core,\n\t\t\t${sel.join(',\n\t\t\t')}\n\t\t)`, '')
    const axis = (name: string, from: number, to: number) => {
      if (to <= from) return []
      const out = [`\t\tAXIS ${name}`]
      for (let j = from; j < to; j++) out.push(`\t\t\tGROUP ${br(groupNames[j])}${sortCols[j] ? `, ${br(sortNames[j]!)}` : ''} TOTAL ${br(flags[j])}`)
      const order: string[] = []
      for (let j = from; j < to; j++) {
        if (sortCols[j]) order.push(`${br(sortNames[j]!)} ASC`)
        order.push(`${br(groupNames[j])} ASC`)
      }
      out.push(`\t\t\tORDER BY ${order.join(', ')}`)
      return out
    }
    const densify = R > 0 && G > R
    lines.push("\tTABLE '__DS0VisualCalcs' = __DS0VisualCalcsInput", '\t\tWITH VISUAL SHAPE', ...axis('ROWS', 0, R), ...axis('COLUMNS', R, G))
    if (densify) lines.push('\t\tDENSIFY "IsDensifiedRow"')
    lines.push('')
    let result = "'__DS0VisualCalcs'"
    if (densify) {
      const keepCalc = calcNames.map((n) => ` || NOT ISBLANK ( ${br(n)} )`).join('')
      lines.push('\tVAR __DS0VisualCalcsFiltered = ', `\t\tFILTER ( '__DS0VisualCalcs', NOT [IsDensifiedRow]${keepCalc} )`, '')
      result = '__DS0VisualCalcsFiltered'
    }
    lines.push('EVALUATE', `\t${result}`, '', 'ORDER BY')
    const order: string[] = []
    groupCols.forEach((_, j) => {
      order.push(`${br(flags[j])} DESC`)
      if (sortCols[j]) order.push(br(sortNames[j]!))
      order.push(br(groupNames[j]))
    })
    lines.push(`\t${order.join(', ')}`)
    return ['// DAX Query', ...lines].join('\n')
  }

  evaluateVisualCalculations(req: VisualCalcRequest): VisualCalcResult {
    this.ensureProcessed()
    const base = req.base
    const G = base.groupBy.length
    const R = Math.max(0, Math.min(req.rowFields, G))
    const C = G - R
    const groupCols = base.groupBy.map((g) => this.groupCol(g))
    const result = this.summarize(base)
    const warnings = [...(result.warnings ?? [])]
    // the visual matrix: every (rows level, columns level) of the lattice, evaluated at that level
    const cells: VisualCell[] = []
    for (let rl = 0; rl <= R; rl++) {
      for (let cl = 0; cl <= C; cl++) {
        const idx = [...Array.from({ length: rl }, (_, j) => j), ...Array.from({ length: cl }, (_, j) => R + j)]
        const r = rl === R && cl === C && base.limit === undefined ? result : this.summarize({ ...base, groupBy: idx.map((j) => base.groupBy[j]), limit: undefined, orderBy: undefined, highlightFilters: undefined })
        for (const w of r.warnings ?? []) if (!warnings.includes(w)) warnings.push(w)
        for (const row of r.rows) {
          const keys: Scalar[] = new Array(G).fill(null)
          idx.forEach((j, k) => (keys[j] = row[k] as Scalar))
          cells.push({ rowLevel: rl, colLevel: cl, keys, values: row.slice(idx.length) as Scalar[] })
        }
      }
    }
    // densification: row members x column members at every level pair (Power BI's DENSIFY)
    cells.push(...densifyCells(cells, R, C).map((c) => ({ ...c, values: base.values.map(() => null) })))
    const names = req.names.slice(0, G + base.values.length)
    const vm = new VisualMatrix({
      groupNames: names.slice(0, G).map((n, j) => n || groupCols[j].name),
      groupTypes: groupCols.map((c) => c.dataType),
      rowFields: R,
      valueNames: base.values.map((v, j) => names[G + j] || v.id),
      valueTypes: result.columns.slice(G).map((c) => c.dataType),
      cells,
      sortValue: (j, v) => this.groupSortValue(groupCols[j], v)
    })
    const ev = new Evaluator(vm.model, { ...this.evalOptions(), functionSource: this.dm })
    const calcs = req.calcs.map((c) => {
      try {
        return { name: c.name, ast: parseExpression(c.expression) }
      } catch (e) {
        return { name: c.name, ast: null, error: errMessage(e) }
      }
    })
    const evaluated = evaluateVisualCalcs(ev, vm, calcs)
    // append the leaf values to the base rows
    const leafRows = result.rows.map((row) => {
      const i = vm.find(R, C, row.slice(0, G) as Scalar[])
      return [...row, ...evaluated.map((e) => (i >= 0 ? cleanScalar(e.values[i]) : null))]
    })
    // densified leaf combinations whose visual calculations are not blank are shown too (blank base values)
    let added = 0
    cells.forEach((c, i) => {
      if (!c.densified || c.rowLevel !== R || c.colLevel !== C) return
      const vals = evaluated.map((e) => cleanScalar(e.values[i]))
      if (vals.every((v) => v === null)) return
      leafRows.push([...c.keys, ...base.values.map(() => null), ...vals])
      added++
    })
    const out: SummarizeResult = {
      ...result,
      columns: [
        ...result.columns,
        ...req.calcs.map((c, k) => ({ id: c.id, kind: 'value' as const, dataType: inferDataType(evaluated[k].values) === 'unknown' ? ('double' as DataType) : inferDataType(evaluated[k].values), name: c.name }))
      ],
      rows: leafRows
    }
    if (result.formats) out.formats = [...result.formats.map((f) => [...f, ...req.calcs.map(() => undefined)]), ...Array.from({ length: added }, () => [...base.values, ...req.calcs].map(() => undefined))]
    if (result.highlights) out.highlights = [...result.highlights.map((h) => [...h, ...req.calcs.map(() => null)]), ...Array.from({ length: added }, () => [...base.values, ...req.calcs].map(() => null))]
    const errs = evaluated.map((e) => e.error)
    errs.forEach((e, k) => {
      if (e) warnings.push(`${req.calcs[k].name}: ${e}`)
    })
    if (warnings.length) out.warnings = warnings
    else delete out.warnings
    return {
      result: out,
      cells: cells.map((c, i) => ({ ...c, values: c.values.map(cleanScalar), calcs: evaluated.map((e) => cleanScalar(e.values[i])) })),
      errors: errs
    }
  }

  setViewAsRoles(roles: string[] | null): void {
    this.rlsRoles = roles && roles.length ? roles : null
    if (!this.rlsRoles) {
      this.rls = []
      return
    }
    this.applyRoles(this.rlsRoles)
  }

  private applyRoles(roleNames: string[]): void {
    const roles = this.model.roles.filter((r) => roleNames.some((n) => n.toLowerCase() === r.name.toLowerCase()))
    const perTable = new Map<Tbl, Set<number> | 'all'>()
    for (const t of this.dm.tables) {
      let union: Set<number> | 'all' | null = null
      for (const role of roles) {
        const perm = role.tablePermissions.find((p) => p.table.toLowerCase() === t.name.toLowerCase() && p.filterExpression?.trim())
        if (!perm) {
          union = 'all'
          break
        }
        const ev = this.evaluator()
        const ast = parseExpression(perm.filterExpression!)
        const tv = TableValue.fromBase(t, t.all().subarray(0, t.rowCount))
        const s: Set<number> = union === null ? new Set() : (union as Set<number>)
        ev.each(tv, ev.rootEnv(new FilterContext(this.dm)), (re, i) => {
          try {
            if (toBool(ev.scalar(ast, re))) s.add(i)
          } catch {
            /* row hidden on error */
          }
        })
        union = s
      }
      if (union && union !== 'all' && roles.length) perTable.set(t, union)
    }
    this.rls = [...perTable.entries()].map(([t, s]) => rowsFilter(t, Int32Array.from(s as Set<number>).sort(), false))
  }
}

/** FNV-1a (two lanes) over a string: short stable fingerprint. */
function hashText(s: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x5bd1e995)
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + ':' + s.length
}

export function createEngine(model: SemanticModel, data: DataStore, options: EngineOptions = {}): QueryEngine {
  return new TabularEngine(model, data, options)
}

export { formatValue } from './format'
export type { Scalar }
void valueDataType
