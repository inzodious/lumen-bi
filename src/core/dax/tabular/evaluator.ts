/**
 * Tabular DAX evaluator: expressions, measures (with context transition and calculation groups),
 * CALCULATE filter semantics, variables and table values. The function library lives in fn-*.ts and
 * registers itself into the registry.
 */
import type { DataType } from '../../model/types.ts'
import { DaxError, unknownFunction } from './errors.ts'
import {
  colFilter,
  colMask,
  eqFilter,
  expandedIds,
  filterColumns,
  FilterContext,
  filterTouches,
  rowsFilter,
  tupleFilterFromCodes,
  valuesFilter,
  type ColFilter,
  type Filter,
  type RelConfig,
  type RelMode
} from './filters.ts'
import { parseCached, type CalcGroup, type CalcItem, type Col, type DaxModel, type Measure, type Rel, type Tbl } from './model.ts'
import type { CallNode, ColumnNode, FunctionDefinition, Node } from './parser.ts'
import { FN_META, FUNCTIONS, isTableFunction, scopeGet, type Binding, type CalcItemTrail, type Env, type EvalOptions, type RowCtx, type Scope, type Val } from './registry.ts'
import { isTable, TableValue, type TCol } from './table.ts'
import { arithmetic, compare, sameValue, toBool, toDate, toNumber, toText, tupleKey, valueDataType, vkey, type Scalar } from './values.ts'
import './fn-scalar.ts'
import './fn-aggregate.ts'
import './fn-table.ts'
import './fn-filter.ts'
import './fn-time.ts'
import './fn-window.ts'
import './visualcalc.ts'
import type { IterFusion } from './fusion.ts'

export type { Env, EvalOptions, Val } from './registry.ts'

/** Functions whose column arguments are not row-context references (they aggregate or filter). */
const NON_ROW_ARG_FUNCTIONS = new Set([
  'SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'COUNTBLANK', 'COUNTROWS', 'DISTINCTCOUNT', 'DISTINCTCOUNTNOBLANK', 'MEDIAN', 'PRODUCT',
  'MINA', 'MAXA', 'AVERAGEA', 'STDEV.S', 'STDEV.P', 'VAR.S', 'VAR.P', 'PERCENTILE.INC', 'PERCENTILE.EXC', 'CALCULATE', 'CALCULATETABLE', 'FILTER',
  'ALL', 'ALLSELECTED', 'ALLNOBLANKROW', 'ALLEXCEPT', 'ALLCROSSFILTERED', 'REMOVEFILTERS', 'VALUES', 'DISTINCT', 'SELECTEDVALUE', 'HASONEVALUE',
  'HASONEFILTER', 'ISFILTERED', 'ISCROSSFILTERED', 'ISINSCOPE', 'FILTERS', 'LOOKUPVALUE', 'TREATAS', 'FIRSTDATE', 'LASTDATE', 'FIRSTNONBLANK',
  'LASTNONBLANK', 'FIRSTNONBLANKVALUE', 'LASTNONBLANKVALUE', 'DATESYTD', 'DATESMTD', 'DATESQTD', 'SAMEPERIODLASTYEAR', 'DATEADD', 'DATESBETWEEN',
  'DATESINPERIOD', 'PARALLELPERIOD', 'PREVIOUSDAY', 'PREVIOUSMONTH', 'PREVIOUSQUARTER', 'PREVIOUSYEAR', 'NEXTDAY', 'NEXTMONTH', 'NEXTQUARTER',
  'NEXTYEAR', 'STARTOFMONTH', 'STARTOFQUARTER', 'STARTOFYEAR', 'ENDOFMONTH', 'ENDOFQUARTER', 'ENDOFYEAR', 'TOTALYTD', 'TOTALQTD', 'TOTALMTD',
  'OPENINGBALANCEMONTH', 'OPENINGBALANCEQUARTER', 'OPENINGBALANCEYEAR', 'CLOSINGBALANCEMONTH', 'CLOSINGBALANCEQUARTER', 'CLOSINGBALANCEYEAR',
  'SUMX', 'AVERAGEX', 'MINX', 'MAXX', 'COUNTX', 'COUNTAX', 'RANKX', 'CONCATENATEX', 'SUMMARIZE', 'SUMMARIZECOLUMNS', 'ADDCOLUMNS', 'SELECTCOLUMNS',
  'TOPN', 'GENERATE', 'GENERATEALL', 'CROSSJOIN', 'RELATEDTABLE', 'USERELATIONSHIP', 'CROSSFILTER', 'KEEPFILTERS', 'NAMEOF', 'CONTAINS',
  'CONTAINSROW', 'ISEMPTY', 'GROUPBY', 'ADDMISSINGITEMS', 'DETAILROWS', 'MEDIANX', 'PRODUCTX', 'STDEVX.S', 'STDEVX.P', 'VARX.S', 'VARX.P',
  'PERCENTILEX.INC', 'PERCENTILEX.EXC', 'GEOMEAN', 'GEOMEANX', 'EARLIEST', 'EARLIER', 'ISONORAFTER', 'INDEX', 'OFFSET', 'WINDOW', 'RANK',
  'ROWNUMBER', 'PARTITIONBY', 'ORDERBY', 'MATCHBY', 'DISTINCTCOUNTX', 'MAXA', 'APPROXIMATEDISTINCTCOUNT', 'CLOSINGBALANCEMONTH'
])

export class Evaluator {
  readonly queryMeasures = new Map<string, Measure>()
  readonly queryTables = new Map<string, TableValue>()
  queryScope: Scope | null = null
  /** measure value cache keyed by context object (valid for one top-level evaluation) */
  private measureCache = new WeakMap<FilterContext, Map<string, Scalar>>()
  private contentCache = new Map<string, Scalar>()
  private uniqueColCache = new Map<Tbl, Col | null>()
  /**
   * Home table of the measure / calculated column currently being evaluated. A bare [Name] that is not a measure
   * is a column reference resolved in this table first (DAX resolves unqualified columns against the measure's
   * home table / the calculated column's table), then as the unique column with that name in the model.
   */
  home: Tbl | null = null
  /** compiled row-expression plans (compile.ts), per AST node and iterated-table shape */
  readonly rowPlans = new Map<Node, Map<string, unknown>>()

  constructor(
    readonly model: DaxModel,
    readonly options: EvalOptions = {}
  ) {}

  rootEnv(ctx: FilterContext): Env {
    return { ctx, rows: [], scope: this.queryScope, applied: null, selMeasure: null, transitioned: 0, depth: 0 }
  }

  now(): Date {
    const d = (this.options.now ?? (() => new Date()))()
    // local wall clock as a naive UTC date
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()))
  }

  lookupMeasure(name: string): Measure | undefined {
    return this.queryMeasures.get(name.toLowerCase()) ?? this.model.measure(name)
  }

  measureAst(m: Measure): Node {
    try {
      return parseCached(m, m.expression)
    } catch (e) {
      throw new DaxError((e as DaxError).code ?? 'SYNTAX', `Measure '${m.name}': ${(e as Error).message}`)
    }
  }

  // ---------------------------------------------------------------------------------------------
  // core
  // ---------------------------------------------------------------------------------------------

  value(node: Node, env: Env): Val {
    switch (node.kind) {
      case 'number':
      case 'string':
      case 'bool':
        return node.value
      case 'column':
        return this.columnOrMeasure(node, env)
      case 'ident':
        return this.identValue(node, env)
      case 'param': {
        const p = this.options.params?.[node.name] ?? this.options.params?.[node.name.toLowerCase()]
        if (p === undefined) throw new DaxError('PARAM', `The query parameter @${node.name} has no value.`, node)
        return p
      }
      case 'call':
        return this.call(node, env)
      case 'binary':
        return this.binary(node, env)
      case 'unary': {
        const v = this.scalar(node.operand, env)
        if (node.op === 'NOT') return !toBool(v)
        if (v === null) return null
        if (node.op === '-') return v instanceof Date ? arithmetic('-', 0, v) : -toNumber(v)
        return v
      }
      case 'var': {
        // each declaration sees the previous ones (lazily evaluated in the defining environment); the block shares
        // one map, visibility by declaration index (a re-declared name starts a new level)
        let scope: Scope = { vars: new Map(), parent: env.scope }
        node.decls.forEach((d, k) => {
          const key = d.name.toLowerCase()
          if (scope.vars.has(key)) scope = { vars: new Map(), parent: scope }
          scope.vars.set(key, { node: d.expr, env: { ...env, scope: { vars: scope.vars, parent: scope.parent, limit: k } }, idx: k })
        })
        return this.value(node.body, { ...env, scope })
      }
      case 'tableCtor':
        return this.tableCtor(node, env)
      case 'tuple':
        throw new DaxError('SYNTAX', 'A row tuple ( ... ) can only be used inside a table constructor { } or on the left of IN.', node)
    }
  }

  scalar(node: Node, env: Env): Scalar {
    const v = this.value(node, env)
    return isTable(v) ? this.tableToScalar(v, node) : v
  }

  table(node: Node, env: Env, fn = 'This function'): TableValue {
    const v = this.value(node, env)
    if (!isTable(v)) throw new DaxError('TYPE', `${fn} needs a table expression, but the argument returns a single value.`, node)
    return v
  }

  tableToScalar(t: TableValue, node?: Node): Scalar {
    if (t.cols.length > 1) throw new DaxError('TYPE', 'The expression refers to multiple columns. Multiple columns cannot be converted to a scalar value.', node)
    if (t.n === 0) return null
    if (t.n > 1) {
      // a column of identical values still converts (e.g. VALUES over one value + blank row is 2 rows -> error)
      throw new DaxError('TYPE', 'A table of multiple values was supplied where a single value was expected.', node)
    }
    return t.get(0, 0)
  }

  private identValue(node: Extract<Node, { kind: 'ident' }>, env: Env): Val {
    const name = node.name
    if (name === '__missing__') return null
    const lower = name.toLowerCase()
    for (let s = env.scope; s; s = s.parent) {
      const b = scopeGet(s, lower)
      if (b) return this.bindingValue(b, name)
    }
    const qt = this.queryTables.get(lower)
    if (qt) return qt
    const t = this.model.findTable(name)
    if (t) return this.tableRef(t, env)
    if (!node.quoted && FUNCTIONS.has(name.toUpperCase())) throw new DaxError('SYNTAX', `The function ${name.toUpperCase()} must be called with parentheses.`, node)
    throw new DaxError('NAME', `Failed to resolve name '${name}'. It is not a valid table, variable, or function name.`, node)
  }

  bindingValue(b: Binding, name: string): Val {
    if (b.value === undefined) {
      if (b.busy) throw new DaxError('VAR', `The variable '${name}' refers to itself.`)
      b.busy = true
      const home = this.home
      if (b.env.home !== undefined) this.home = b.env.home
      try {
        const key = this.varMemoKey(b)
        const hit = key !== null ? this.varMemo.get(key) : undefined
        if (hit !== undefined) b.value = hit
        else {
          b.value = this.value(b.node, b.env)
          if (key !== null) {
            if (this.varMemo.size > 100_000) this.varMemo.clear()
            this.varMemo.set(key, b.value)
          }
        }
      } finally {
        b.busy = false
        this.home = home
      }
    }
    return b.value
  }

  /**
   * Variables of measures are re-evaluated for every cell, but often only depend on filters that do not change from
   * cell to cell (`VAR ids = CALCULATETABLE ( VALUES ( Org[id] ), FILTER ( ALL ( Org ), Org[parent] IN ctxIds ) )`).
   * Key of a variable's value: its expression, the filters reaching the tables it reads (footprint), the group-by
   * scope / ALLSELECTED shadow, and the values of the variables it refers to (tables by identity — VALUES results
   * are shared per visible set). Null = not memoizable (row context, calculation groups, unknown footprint...).
   */
  private varMemoKey(b: Binding): string | null {
    const env = b.env
    if (env.rows.length || env.applied || env.selMeasure || env.formatOf) return null
    const node = b.node
    if (node.kind === 'number' || node.kind === 'string' || node.kind === 'bool' || node.kind === 'ident') return null
    const fp = this.nodeFootprint(node, this.home)
    if (!fp) return null
    let parts = `${this.objId(node)}`
    for (const t of fp.tables) {
      const r = env.ctx.relevantKey(t)
      if (r === null) return null
      parts += '\u0003' + r
    }
    parts += '\u0003' + env.ctx.scopeShadowKey()
    let bad = false
    const names = new Set<string>()
    this.walkNodes(node, (x) => {
      if (x.kind === 'ident') names.add(x.name.toLowerCase())
      else if (x.kind === 'call') {
        const fn = x.name.toUpperCase()
        if (env.shadows?.length && (fn === 'ALLSELECTED' || fn === 'OFFSET' || fn === 'INDEX' || fn === 'WINDOW' || fn === 'RANK' || fn === 'ROWNUMBER')) bad = true
      }
    })
    if (bad) return null
    for (const n of [...names].sort()) {
      let found: Binding | undefined
      for (let sc = env.scope; sc && !found; sc = sc.parent) found = scopeGet(sc, n)
      if (!found) continue
      let v: Val
      try {
        v = this.bindingValue(found, n)
      } catch {
        return null
      }
      if (isTable(v)) parts += `\u0003${n}=t${this.objId(v as TableValue)}`
      else if (v instanceof Date) parts += `\u0003${n}=d${v.getTime()}`
      else parts += `\u0003${n}=${typeof v}:${String(v)}`
    }
    return parts
  }
  private varMemo = new Map<string, Val>()
  private objIds = new WeakMap<object, number>()
  private nextObjId = 1
  private objId(o: object): number {
    let id = this.objIds.get(o)
    if (id === undefined) {
      id = this.nextObjId++
      this.objIds.set(o, id)
    }
    return id
  }

  lookupVar(name: string, env: Env): Val | undefined {
    const lower = name.toLowerCase()
    for (let s = env.scope; s; s = s.parent) {
      const b = scopeGet(s, lower)
      if (b) return this.bindingValue(b, name)
    }
    return undefined
  }

  measureFor(node: ColumnNode): Measure | null {
    const m = this.lookupMeasure(node.name)
    if (!m) return null
    if (node.table === null) return m
    const t = this.model.findTable(node.table)
    if (t && t.column(node.name)) return null
    return m
  }

  /** Resolve a model column reference. */
  resolveColumn(node: Node, fn: string): Col {
    if (node.kind !== 'column') throw new DaxError('TYPE', `${fn} expects a column reference such as table[column].`, node)
    if (node.table === null) {
      const m = this.lookupMeasure(node.name)
      if (m) throw new DaxError('TYPE', `${fn} expects a column reference, but [${node.name}] is a measure.`, node)
      const c = this.unqualifiedColumn(node.name)
      if (c) return c
      throw new DaxError('REF', `Column [${node.name}] cannot be found. Write it with its table name, as table[${node.name}], in ${fn}.`, node)
    }
    const t = this.model.findTable(node.table)
    if (!t) throw new DaxError('REF', `Cannot find table '${node.table}'.`, node)
    const c = t.column(node.name)
    if (!c) {
      if (this.lookupMeasure(node.name)) throw new DaxError('TYPE', `${fn} expects a column reference, but '${node.table}'[${node.name}] is a measure.`, node)
      throw new DaxError('REF', `Column '${node.name}' in table '${node.table}' cannot be found or may not be used in this expression.`, node)
    }
    return c
  }

  /** Bare [Name] column reference: the home table's column, else the unique model column with that name. */
  unqualifiedColumn(name: string): Col | null {
    const own = this.home?.column(name)
    if (own) return own
    let hit: Col | null = null
    for (const t of this.model.tables) {
      const c = t.column(name)
      if (!c) continue
      if (hit) return null
      hit = c
    }
    return hit
  }

  tryColumn(node: Node): Col | null {
    if (node.kind !== 'column') return null
    if (node.table === null) return this.lookupMeasure(node.name) ? null : this.unqualifiedColumn(node.name)
    if (this.queryTables.has(node.table.toLowerCase())) return null
    const t = this.model.findTable(node.table)
    return t?.column(node.name) ?? null
  }

  private columnOrMeasure(node: ColumnNode, env: Env): Val {
    if (node.table === null) {
      // row-context column by name first when a row context has it (ADDCOLUMNS / table constructor columns)
      for (let i = env.rows.length - 1; i >= 0; i--) {
        const rc = env.rows[i]
        const idx = rc.t.indexOfName(node.name)
        if (idx >= 0 && !(rc.t.cols[idx].lineage && this.lookupMeasure(node.name))) return rc.t.get(rc.i, idx)
      }
      const m = this.lookupMeasure(node.name)
      if (m) return this.evalMeasure(m, env)
      throw new DaxError('REF', `The value for '${node.name}' cannot be determined. Either the column doesn't exist, or there is no current row for this column.`, node)
    }
    const qt = this.queryTables.get(node.table.toLowerCase())
    const varTable = qt ? undefined : this.lookupVarTable(node.table, env)
    if (qt || varTable) {
      for (let i = env.rows.length - 1; i >= 0; i--) {
        const rc = env.rows[i]
        const idx = rc.t.indexOfName(node.name)
        if (idx >= 0) return rc.t.get(rc.i, idx)
      }
      throw new DaxError('REF', `The value for '${node.table}'[${node.name}] cannot be determined: there is no current row for this column.`, node)
    }
    const t = this.model.findTable(node.table)
    if (t && !t.column(node.name)) {
      const m = this.lookupMeasure(node.name)
      if (m) return this.evalMeasure(m, env)
    }
    const col = this.resolveColumn(node, 'This expression')
    return this.rowValue(col, env, node)
  }

  private lookupVarTable(name: string, env: Env): TableValue | undefined {
    const lower = name.toLowerCase()
    for (let s = env.scope; s; s = s.parent) {
      const b = scopeGet(s, lower)
      if (b) {
        const v = this.bindingValue(b, name)
        return isTable(v) ? v : undefined
      }
    }
    return undefined
  }

  rowValue(col: Col, env: Env, node?: Node): Scalar {
    for (let i = env.rows.length - 1; i >= 0; i--) {
      const rc = env.rows[i]
      const idx = rc.t.indexOfLineage(col)
      if (idx >= 0) return rc.t.get(rc.i, idx)
    }
    // a column projected under another name (SELECTCOLUMNS) keeps no lineage; match by name + table as a fallback
    for (let i = env.rows.length - 1; i >= 0; i--) {
      const rc = env.rows[i]
      const idx = rc.t.indexOfName(col.name)
      if (idx >= 0 && !rc.t.cols[idx].lineage && rc.t.cols[idx].tableName?.toLowerCase() === col.table.name.toLowerCase()) return rc.t.get(rc.i, idx)
    }
    throw new DaxError(
      'SINGLE_VALUE',
      `A single value for column '${col.name}' in table '${col.table.name}' cannot be determined. This can happen when a measure formula refers to a column that contains many values without specifying an aggregation such as min, max, count, or sum to get a single result.`,
      node
    )
  }

  /** RELATED: follow many-to-one relationships from the current row's table. */
  related(col: Col, env: Env, node?: Node): Scalar {
    for (let i = env.rows.length - 1; i >= 0; i--) {
      const rc = env.rows[i]
      const own = rc.t.indexOfLineage(col)
      if (own >= 0) return rc.t.get(rc.i, own)
      // from any lineage column of the row, walk the expansion of that column's table
      const sources: Array<{ table: Tbl; row: number }> = []
      if (rc.t.base) sources.push({ table: rc.t.base.table, row: rc.t.base.ids[rc.i] })
      for (let j = 0; j < rc.t.cols.length && sources.length === 0; j++) {
        const lc = rc.t.cols[j].lineage
        const d = rc.t.data[j]
        if (lc && !Array.isArray(d)) sources.push({ table: lc.table, row: d.ids[rc.i] })
      }
      for (const src of sources) {
        const exp = env.ctx.expansion(src.table)
        const st = exp.stepOf.get(col.table)
        if (!st) continue
        if (st.path.length === 0) return col.value(src.row)
        const map = this.model.pathRowMap(st.path)!
        const x = map[src.row]
        return x < 0 ? null : col.value(x)
      }
      // row of a non-base table: use any lineage column that is a relationship key to the target
      for (let j = 0; j < rc.t.cols.length; j++) {
        const lc = rc.t.cols[j].lineage
        if (!lc) continue
        const exp = env.ctx.expansion(lc.table)
        const st = exp.stepOf.get(col.table)
        if (!st || st.path.length === 0) continue
        // find a row of lc.table with this value, then follow
        const code = lc.codeOf(rc.t.get(rc.i, j))
        if (code < 0) return null
        let r = -1
        for (let k = 0; k < lc.table.rowCount; k++)
          if (lc.codes[k] === code) {
            r = k
            break
          }
        if (r < 0) return null
        const x = this.model.pathRowMap(st.path)![r]
        return x < 0 ? null : col.value(x)
      }
    }
    throw new DaxError('REF', `The column '${col.table.name}'[${col.name}] either doesn't exist or doesn't have a relationship to any table available in the current context.`, node)
  }

  tableRef(t: Tbl, env: Env): TableValue {
    return TableValue.fromBase(t, env.ctx.visible(t))
  }

  // ---------------------------------------------------------------------------------------------
  // measures, calculation groups, context transition
  // ---------------------------------------------------------------------------------------------

  selectedCalcItem(g: CalcGroup, ctx: FilterContext): CalcItem | null {
    let touched = false
    for (const c of g.table.cols)
      if (ctx.isFiltered(c)) {
        touched = true
        break
      }
    if (!touched) return g.noSelection ?? null
    const vis = ctx.visible(g.table)
    if (vis.length === 1 && vis[0] < g.table.rowCount) {
      const name = g.column.value(vis[0])
      return g.items.find((it) => typeof name === 'string' && it.name.toLowerCase() === name.toLowerCase()) ?? null
    }
    return g.multipleOrEmpty ?? null
  }

  /** Absolute time (Date.now()) after which evaluation stops with a TIMEOUT error (query time budget). */
  deadline = 0
  private tick = 0

  checkDeadline(): void {
    if (this.deadline && (++this.tick & 63) === 0 && Date.now() > this.deadline)
      throw new DaxError('TIMEOUT', 'The query exceeded its time budget and was stopped.')
  }

  /** fused per-cell measure values for the SUMMARIZECOLUMNS cell being evaluated (fusion.ts, summarizeColumnsCore) */
  cellOverrides: { ctx: FilterContext; values: Map<Measure | Node, Scalar> } | null = null

  /** Active iteration fusion (fusion.ts iterationFusion), consulted by CALCULATE and measure references. */
  iterFusion: IterFusion | null = null
  /** Precomputed value of a transition site (CALCULATE node / measure) at the current row, or undefined. */
  iterOverride(key: Node | Measure, env: Env): Scalar | undefined {
    const f = this.iterFusion
    if (!f || env.ctx !== f.ctx || env.rows.length !== f.depth + 1 || env.rows[f.depth] !== f.rc || env.transitioned !== (f.transitioned ?? f.depth)) return undefined
    if (f.prefix) for (let k = 0; k < f.depth; k++) if (env.rows[k] !== f.prefix[k]) return undefined
    if (env.applied || env.selMeasure || env.formatOf) return undefined
    const k = f.sites.get(key)
    return k === undefined ? undefined : f.valueAt(k, f.rc.i)
  }

  evalMeasure(m: Measure, env: Env): Scalar {
    this.checkDeadline()
    if (this.iterFusion) {
      const v = this.iterOverride(m, env)
      if (v !== undefined) return v
    }
    const ov = this.cellOverrides
    if (ov && env.rows.length === env.transitioned && env.ctx === ov.ctx && !env.applied && !env.selMeasure && !env.formatOf) {
      const v = ov.values.get(m)
      if (v !== undefined) return v
    }
    if (env.depth > 120) throw new DaxError('CIRCULAR', `A circular dependency was detected while evaluating measure [${m.name}] (${stackNames(env.stack).slice(-6).join(' -> ')}).`)
    const ctx = this.transition(env, this.transitionSkips(env, this.footprint(m)))
    const home = this.home
    this.home = m.table
    try {
      return this.evalMeasureIn(m, env, ctx)
    } finally {
      this.home = home
    }
  }

  private evalMeasureIn(m: Measure, env: Env, ctx: FilterContext): Scalar {
    const refs = (env.cgRefs ?? 0) + (env.viaSelected ? 0 : 1)
    const base: Env = { ctx, rows: [], scope: this.queryScope, applied: env.applied, selMeasure: env.selMeasure, transitioned: 0, depth: env.depth + 1, formatOf: env.formatOf, stack: { name: m.name, prev: env.stack }, home: m.table, shadows: env.shadows, cgTrail: env.cgTrail, cgRefs: refs }
    for (const g of this.model.calcGroups) {
      const item = this.selectedCalcItem(g, ctx)
      if (!item) continue
      const filters = this.model.calcGroups.length ? cgFilters(ctx, g) : []
      // the item applied last for this group, still selected by the same filters: it stays applied (not re-applied)
      let cur: CalcItemTrail | undefined
      for (let t = env.cgTrail; t; t = t.prev) if (t.group === g) { cur = t; break }
      if (cur && cur.item === item && sameFilters(cur.filters, filters)) continue
      // an item applied earlier in the chain, selected again (CALCULATE filter on the calculation group)
      let earlier: CalcItemTrail | undefined
      for (let t = env.cgTrail; t; t = t.prev) if (t.item === item) { earlier = t; break }
      if (earlier) {
        // through a measure that filters the calculation group: DAX ignores the second application (sideways
        // recursion through measures); directly from calculation items (SELECTEDMEASURE): a circular dependency
        if (refs > earlier.refs) continue
        const path: string[] = [item.name]
        for (let t = env.cgTrail; t && t !== earlier.prev; t = t.prev) path.unshift(t.item.name)
        throw new DaxError('CIRCULAR', `A circular dependency was detected: calculation item '${item.name}' of calculation group '${g.table.name}' invokes itself (${path.join(' -> ')}). A calculation item cannot directly or indirectly invoke itself.`)
      }
      const applied = new Map(env.applied ?? [])
      applied.set(g, item)
      return this.scalar(this.itemAst(item, g), { ...base, applied, selMeasure: m, cgTrail: { group: g, item, filters, refs, prev: env.cgTrail } })
    }
    // memoize per (context content, measure) when no calculation group is involved: within one query, equal filter
    // contexts give equal results (evaluation is deterministic; RAND-like functions are rare in measures and DAX
    // itself caches them per storage-engine query)
    const cacheable = !env.applied && !env.selMeasure && !env.formatOf
    if (cacheable) {
      let cache = this.measureCache.get(ctx)
      let hit = cache?.get(m.name)
      if (hit !== undefined) return hit
      const ck = m.name + '\u0000' + this.measureKey(m, ctx) + (env.shadows?.length && this.usesShadow(m) ? '\u0000' + this.shadowId(env.shadows) : '')
      hit = this.contentCache.get(ck)
      if (hit === undefined) {
        hit = this.scalar(this.measureAst(m), base)
        if (this.contentCache.size > 500_000) this.contentCache.clear()
        this.contentCache.set(ck, hit)
      }
      if (!cache) {
        cache = new Map()
        this.measureCache.set(ctx, cache)
      }
      cache.set(m.name, hit)
      return hit
    }
    return this.scalar(this.measureAst(m), base)
  }

  /**
   * Cache key of a measure's value in a context: the full context content, or — when the measure's footprint (the
   * tables it reads, transitively) is known — only the filters that reach those tables, so cells that differ only by
   * filters the measure cannot see share the result (a denominator, a population, a total...).
   */
  private measureKey(m: Measure, ctx: FilterContext): string {
    const fp = this.footprint(m)
    if (!fp) return ctx.contentKey()
    let k = 'F'
    for (const t of fp.tables) {
      const r = ctx.relevantKey(t)
      if (r === null) return ctx.contentKey()
      k += '\u0003' + r
    }
    return k + '\u0003' + ctx.scopeShadowKey()
  }

  private footprints = new Map<Measure, { tables: Tbl[] } | null>()
  /** Tables a measure reads (columns, table references, through measure references); null = unknown / unsafe. */
  footprint(m: Measure): { tables: Tbl[] } | null {
    if (this.footprints.has(m)) return this.footprints.get(m)!
    this.footprints.set(m, null) // recursion guard
    let fp: { tables: Tbl[] } | null = null
    try {
      fp = this.nodeFootprint(this.measureAst(m), m.table)
    } catch {
      fp = null
    }
    this.footprints.set(m, fp)
    return fp
  }

  private nodeFootprints = new WeakMap<Node, { tables: Tbl[] } | null>()
  /**
   * Tables an expression reads: its column and table references, transitively through measures. Null when unknown or
   * when the expression can make other filters relevant (calculation groups, USERELATIONSHIP, CROSSFILTER other than
   * NONE, user-defined functions, query tables).
   */
  nodeFootprint(node: Node, home: Tbl | null): { tables: Tbl[] } | null {
    if (this.nodeFootprints.has(node)) return this.nodeFootprints.get(node)!
    if (this.model.calcGroups.length || this.queryTables.size) return null
    const tables = new Set<Tbl>()
    let ok = true
    this.walkNodes(node, (x) => {
      if (!ok) return
      if (x.kind === 'column') {
        const mm = this.measureFor(x)
        if (mm) {
          const sub = this.footprint(mm)
          if (!sub) ok = false
          else sub.tables.forEach((t) => tables.add(t))
          return
        }
        if (x.table !== null) {
          const t = this.model.findTable(x.table)
          if (t) tables.add(t)
          else ok = false // variable table: unknown lineage
        } else {
          const c = home?.column(x.name) ?? this.unqualifiedColumn(x.name)
          if (c) tables.add(c.table)
          else if (this.model.tables.some((t) => t.column(x.name))) ok = false // ambiguous: resolved by row context
        }
      } else if (x.kind === 'ident') {
        const t = this.model.findTable(x.name)
        if (t) tables.add(t)
      } else if (x.kind === 'call') {
        const fn = x.name.toUpperCase()
        if (fn === 'USERELATIONSHIP' || fn === 'CROSSFILTER' || fn === 'SELECTEDMEASURE' || fn === 'ISSELECTEDMEASURE' || fn === 'SELECTEDMEASURENAME' || fn === 'DETAILROWS') {
          // CROSSFILTER ( ..., NONE ) only removes paths: still safe
          const dir = x.args[2]
          if (!(fn === 'CROSSFILTER' && dir?.kind === 'ident' && dir.name.toUpperCase() === 'NONE')) ok = false
        } else if (!FUNCTIONS.has(fn)) ok = false // user-defined function or unknown
      } else if (x.kind === 'param') ok = false
    })
    const fp = ok && tables.size ? { tables: [...tables] } : null
    this.nodeFootprints.set(node, fp)
    return fp
  }

  /**
   * Row contexts whose context transition can be skipped for an expression reading `fp`, evaluated under relationship
   * configuration `cfg`: no filter the transition of that row would add (the row's columns) or remove (existing
   * filters on those columns) can reach the tables the expression reads, so the result is the same without it.
   * Saves one filter per row and per evaluation — e.g. iterating a dimension and computing a measure whose
   * relationship to it is disabled with CROSSFILTER ( ..., NONE ). Returns null when every row must be transitioned.
   */
  transitionSkips(env: Env, fp: { tables: Tbl[] } | null, cfg = env.ctx.cfg): Set<number> | null {
    if (!fp || env.rows.length <= env.transitioned) return null
    // memo: inner iterations ask the same question for every row (it depends on the row tables, not the rows)
    const m = this.lastSkips
    if (m && m.ctx === env.ctx && m.cfg === cfg && m.fp === fp && m.start === env.transitioned && m.tables.length === env.rows.length && m.tables.every((t, k) => t === env.rows[k].t)) return m.out
    const out = this.transitionSkipsNew(env, fp, cfg)
    this.lastSkips = { ctx: env.ctx, cfg, fp, start: env.transitioned, tables: env.rows.map((r) => r.t), out }
    return out
  }
  private lastSkips: { ctx: FilterContext; cfg: RelConfig; fp: object; start: number; tables: TableValue[]; out: Set<number> | null } | null = null

  private transitionSkipsNew(env: Env, fp: { tables: Tbl[] }, cfg: RelConfig): Set<number> | null {
    const ctx = cfg === env.ctx.cfg ? env.ctx : env.ctx.with({ cfg })
    const reach: Set<number>[] = []
    for (const f of fp.tables) {
      if (!ctx.noUphillFilters(f)) return null
      reach.push(expandedIds(ctx.expansion(f)))
    }
    const touchedOf: Set<number>[] = []
    let skips: Set<number> | null = null
    for (let k = env.transitioned; k < env.rows.length; k++) {
      const { t } = env.rows[k]
      const touched = new Set<number>()
      if (t.base) {
        for (const c of env.ctx.expandedColumns(t.base.table)) touched.add(c.id)
        if (ctx !== env.ctx) for (const c of ctx.expandedColumns(t.base.table)) touched.add(c.id)
      }
      for (const tc of t.cols) if (tc.lineage) touched.add(tc.lineage.id)
      touchedOf.push(touched)
      let relevant = false
      for (const ids of reach) {
        for (const id of touched)
          if (ids.has(id)) {
            relevant = true
            break
          }
        if (relevant) break
        for (const flt of env.ctx.filters)
          if (filterTouches(this.model, env.ctx.cfg, flt, touched) && filterTouches(this.model, cfg, flt, ids)) {
            relevant = true
            break
          }
        if (relevant) break
      }
      if (!relevant) (skips ??= new Set()).add(k)
    }
    if (!skips) return null
    // a skipped row must not share columns with a transitioned one (the innermost row wins on shared columns)
    for (const k of skips)
      for (let j = env.transitioned; j < env.rows.length; j++) {
        if (skips.has(j)) continue
        for (const id of touchedOf[k - env.transitioned]) if (touchedOf[j - env.transitioned].has(id)) return null
      }
    return skips
  }

  private shadowIds = new WeakMap<object, number>()
  private nextShadowId = 1
  private shadowId(frames: readonly object[]): string {
    return frames
      .map((f) => {
        let id = this.shadowIds.get(f)
        if (id === undefined) {
          id = this.nextShadowId++
          this.shadowIds.set(f, id)
        }
        return id
      })
      .join('.')
  }

  private shadowUse = new Map<Measure, boolean>()
  /** Whether a measure (transitively) reads shadow filter contexts (ALLSELECTED, window functions' default relation). */
  usesShadow(m: Measure): boolean {
    const hit = this.shadowUse.get(m)
    if (hit !== undefined) return hit
    this.shadowUse.set(m, false)
    let uses = this.model.calcGroups.length > 0
    if (!uses) {
      try {
        this.walkNodes(this.measureAst(m), (n) => {
          if (uses) return
          if (n.kind === 'call' && ['ALLSELECTED', 'OFFSET', 'INDEX', 'WINDOW', 'RANK', 'ROWNUMBER'].includes(n.name.toUpperCase())) uses = true
          else if (n.kind === 'column') {
            const r = this.measureFor(n)
            if (r && r !== m && this.usesShadow(r)) uses = true
          }
        })
      } catch {
        uses = true
      }
    }
    this.shadowUse.set(m, uses)
    return uses
  }

  itemAst(item: CalcItem, g: CalcGroup): Node {
    try {
      return parseCached(item, item.expression)
    } catch (e) {
      throw new DaxError('SYNTAX', `Calculation item '${g.table.name}'[${item.name}]: ${(e as Error).message}`)
    }
  }

  /** The format string a visual would use for measure `m` in this context (dynamic format strings, calc items). */
  formatStringFor(m: Measure, ctx: FilterContext): string | null {
    const env: Env = { ...this.rootEnv(ctx), formatOf: m }
    for (const g of this.model.calcGroups) {
      const item = this.selectedCalcItem(g, ctx)
      if (!item?.formatExpression) continue
      const ast = parseCached({ get ast() { return item.formatAst }, set ast(v) { item.formatAst = v } } as { ast?: Node | null }, item.formatExpression)
      const v = this.scalar(ast, { ...env, selMeasure: m, applied: new Map([[g, item]]) })
      if (v !== null) return toText(v)
    }
    return this.measureFormatString(m, ctx)
  }

  measureFormatString(m: Measure, ctx: FilterContext): string | null {
    if (m.formatExpression) {
      const ast = parseCached({ get ast() { return m.formatAst }, set ast(v) { m.formatAst = v } } as { ast?: Node | null }, m.formatExpression)
      const v = this.scalar(ast, { ...this.rootEnv(ctx), formatOf: m })
      if (v !== null) return toText(v)
    }
    return m.formatString ?? null
  }

  /** Identical-row set for context transition over a base table row. */
  identicalRows(t: Tbl, id: number): Int32Array {
    if (id >= t.rowCount) return Int32Array.of(id)
    let u = this.uniqueColCache.get(t)
    if (u === undefined) {
      u = t.cols.find((c) => c.dict.length - 1 === t.rowCount && c.codes.subarray(0, t.rowCount).every((x) => x !== 0)) ?? null
      this.uniqueColCache.set(t, u)
    }
    if (u) return Int32Array.of(id)
    // most selective column drives, then compare all columns
    let best = t.cols[0]
    for (const c of t.cols) if (c.dict.length > (best?.dict.length ?? 0)) best = c
    if (!best) return Int32Array.of(id)
    const post = this.model.postings('|' + best.id, best.codes, best.dict.length, t.fullCount)
    const code = best.codes[id]
    const out: number[] = []
    outer: for (let j = post.offsets[code]; j < post.offsets[code + 1]; j++) {
      const r = post.rows[j]
      for (const c of t.cols) if (c.codes[r] !== c.codes[id]) continue outer
      out.push(r)
    }
    return Int32Array.from(out)
  }

  /** Context transition: row contexts become filters on the lineage columns of their rows. */
  transition(env: Env, skips: ReadonlySet<number> | null = null): FilterContext {
    const start = env.transitioned
    if (env.rows.length <= start) return env.ctx
    if (skips && skips.size === env.rows.length - start) return env.ctx
    // the same rows over the same context transition to the same context (inner iterations repeat the outer rows)
    const memo = this.lastTransition
    if (memo && memo.ctx === env.ctx && memo.rows.length === env.rows.length - start - (skips?.size ?? 0)) {
      let same = true
      let q = 0
      for (let k = start; k < env.rows.length && same; k++) {
        if (skips?.has(k)) continue
        const r = env.rows[k]
        same = memo.rows[q] === r.t && memo.ids[q] === r.i
        q++
      }
      if (same) return memo.out
    }
    const covered = new Set<number>()
    const added: Filter[] = []
    const memoRows: TableValue[] = []
    const memoIds: number[] = []
    for (let k = start; k < env.rows.length; k++) {
      if (skips?.has(k)) continue
      memoRows.push(env.rows[k].t)
      memoIds.push(env.rows[k].i)
    }
    for (let k = env.rows.length - 1; k >= start; k--) {
      if (skips?.has(k)) continue
      const { t, i } = env.rows[k]
      if (t.base) {
        const bt = t.base.table
        if (!bt.cols.every((c) => covered.has(c.id))) {
          // the row of the expanded table: filters the base table's columns and those of its related one-side tables
          const f = rowsFilter(bt, this.identicalRows(bt, t.base.ids[i]), true)
          const removed = new Set<number>()
          const expCols = env.ctx.expandedColumns(bt)
          for (const c of expCols) if (covered.has(c.id)) removed.add(c.id)
          added.push(removed.size ? { ...f, removed } : f)
          for (const c of expCols) covered.add(c.id)
        }
      }
      for (let j = 0; j < t.cols.length; j++) {
        const c = t.cols[j].lineage
        if (!c || covered.has(c.id)) continue
        covered.add(c.id)
        const d = t.data[j]
        added.push(eqFilter(c, Array.isArray(d) ? c.codeOf(d[i]) : d.col === c ? c.codes[d.ids[i]] : c.codeOf(t.get(i, j))))
      }
    }
    const out = env.ctx.removeColumns(covered).with({}).addFilters(added, false)
    this.lastTransition = { ctx: env.ctx, rows: memoRows, ids: memoIds, out }
    return out
  }
  private lastTransition: { ctx: FilterContext; rows: TableValue[]; ids: number[]; out: FilterContext } | null = null

  // ---------------------------------------------------------------------------------------------
  // CALCULATE
  // ---------------------------------------------------------------------------------------------

  relationshipFor(a: Col, b: Col, fn: string): Rel {
    const rel = this.model.relationships.find((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a))
    if (!rel) throw new DaxError('REF', `${fn} needs the two columns of an existing relationship, but there is no relationship between ${a.label} and ${b.label}.`)
    return rel
  }

  /** Columns referenced as row-context references in a boolean filter expression. */
  collectFilterColumns(node: Node, out: Col[], env: Env): void {
    switch (node.kind) {
      case 'column': {
        if (node.table !== null && this.queryTables.has(node.table.toLowerCase())) return
        if (node.table !== null && this.lookupVar(node.table, env) !== undefined) return
        const c = this.tryColumn(node)
        if (!c && node.table !== null && !this.measureFor(node)) this.resolveColumn(node, 'A CALCULATE filter')
        if (c) {
          if (!out.includes(c)) out.push(c)
          return
        }
        if (node.table === null && !this.lookupMeasure(node.name)) {
          const hits = this.model.tables.filter((t) => t.column(node.name))
          if (hits.length === 1) {
            const cc = hits[0].column(node.name)!
            if (!out.includes(cc)) out.push(cc)
          }
        }
        return
      }
      case 'call': {
        const fn = node.name.toUpperCase()
        if (NON_ROW_ARG_FUNCTIONS.has(fn)) return
        if (fn === 'RELATED') return
        node.args.forEach((a) => this.collectFilterColumns(a, out, env))
        return
      }
      case 'binary':
        this.collectFilterColumns(node.left, out, env)
        this.collectFilterColumns(node.right, out, env)
        return
      case 'unary':
        this.collectFilterColumns(node.operand, out, env)
        return
      case 'tuple':
        node.items.forEach((a) => this.collectFilterColumns(a, out, env))
        return
      case 'var':
        node.decls.forEach((d) => this.collectFilterColumns(d.expr, out, env))
        this.collectFilterColumns(node.body, out, env)
        return
      case 'tableCtor':
        node.rows.forEach((r) => r.forEach((x) => this.collectFilterColumns(x, out, env)))
        return
      default:
        return
    }
  }

  /** True when `node` evaluates to the same value for every row of a boolean filter's column iteration. */
  private constantish(node: Node, env: Env): boolean {
    switch (node.kind) {
      case 'number':
      case 'string':
      case 'bool':
      case 'param':
        return true
      case 'ident':
        return node.name === '__missing__' || this.lookupVar(node.name, env) !== undefined
      case 'column':
        return false
      case 'call': {
        const fn = node.name.toUpperCase()
        if (fn === 'CALCULATE' || fn === 'CALCULATETABLE' || fn === 'EARLIER' || fn === 'EARLIEST' || fn === 'RELATED') return false
        if (['MIN', 'MAX', 'SUM', 'AVERAGE', 'COUNT', 'COUNTROWS', 'DISTINCTCOUNT', 'SELECTEDVALUE', 'FIRSTDATE', 'LASTDATE', 'COUNTA', 'MAXX', 'MINX', 'SUMX'].includes(fn)) {
          // aggregations ignore the boolean filter's row context unless they call measures (context transition)
          let measureRef = false
          for (const a of node.args) this.walkNodes(a, (n) => {
            if (n.kind === 'column' && this.measureFor(n)) measureRef = true
            if (n.kind === 'call' && (n.name.toUpperCase() === 'CALCULATE' || n.name.toUpperCase() === 'EARLIER')) measureRef = true
          })
          return !measureRef
        }
        return node.args.every((a) => this.constantish(a, env))
      }
      case 'binary':
        return this.constantish(node.left, env) && this.constantish(node.right, env)
      case 'unary':
        return this.constantish(node.operand, env)
      case 'tableCtor':
        return node.rows.every((r) => r.every((x) => this.constantish(x, env)))
      case 'tuple':
        return node.items.every((x) => this.constantish(x, env))
      default:
        return false
    }
  }

  walkNodes(n: Node, fn: (n: Node) => void): void {
    fn(n)
    switch (n.kind) {
      case 'call':
        n.args.forEach((a) => this.walkNodes(a, fn))
        break
      case 'binary':
        this.walkNodes(n.left, fn)
        this.walkNodes(n.right, fn)
        break
      case 'unary':
        this.walkNodes(n.operand, fn)
        break
      case 'var':
        n.decls.forEach((d) => this.walkNodes(d.expr, fn))
        this.walkNodes(n.body, fn)
        break
      case 'tableCtor':
        n.rows.forEach((r) => r.forEach((x) => this.walkNodes(x, fn)))
        break
      case 'tuple':
        n.items.forEach((x) => this.walkNodes(x, fn))
        break
    }
  }

  /** Compile a single-column boolean predicate to a JS test over the column's values (fast path). */
  private compilePredicate(node: Node, col: Col, env: Env): ((v: Scalar) => boolean) | null {
    const isCol = (n: Node) => n.kind === 'column' && this.tryColumn(n) === col
    if (node.kind === 'binary') {
      const op = node.op
      if (op === '&&' || op === '||') {
        const l = this.compilePredicate(node.left, col, env)
        const r = l && this.compilePredicate(node.right, col, env)
        if (!l || !r) return null
        return op === '&&' ? (v) => l(v) && r(v) : (v) => l(v) || r(v)
      }
      if (op === 'IN' && isCol(node.left) && this.constantish(node.right, env)) {
        const t = this.table(node.right, env, 'IN')
        if (t.cols.length !== 1) return null
        const keys = new Set(t.column(0).map((x) => vkey(x)))
        return (v) => keys.has(vkey(v))
      }
      if (['=', '==', '<>', '<', '>', '<=', '>='].includes(op)) {
        let k: Scalar
        let flip = false
        if (isCol(node.left) && this.constantish(node.right, env)) k = this.scalar(node.right, env)
        else if (isCol(node.right) && this.constantish(node.left, env)) {
          k = this.scalar(node.left, env)
          flip = true
        } else return null
        const cmp = (v: Scalar) => (flip ? compare(k, v) : compare(v, k))
        switch (op) {
          case '=':
            return (v) => cmp(v) === 0
          case '==':
            return (v) => sameValue(v, k)
          case '<>':
            return (v) => cmp(v) !== 0
          case '<':
            return (v) => cmp(v) < 0
          case '>':
            return (v) => cmp(v) > 0
          case '<=':
            return (v) => cmp(v) <= 0
          case '>=':
            return (v) => cmp(v) >= 0
        }
      }
      return null
    }
    if (node.kind === 'unary' && node.op === 'NOT') {
      const p = this.compilePredicate(node.operand, col, env)
      return p ? (v) => !p(v) : null
    }
    if (node.kind === 'call') {
      const fn = node.name.toUpperCase()
      if (fn === 'ISBLANK' && node.args.length === 1 && isCol(node.args[0])) return (v) => v === null
      if (fn === 'NOT' && node.args.length === 1) {
        const p = this.compilePredicate(node.args[0], col, env)
        return p ? (v) => !p(v) : null
      }
      if ((fn === 'AND' || fn === 'OR') && node.args.length === 2) {
        const l = this.compilePredicate(node.args[0], col, env)
        const r = l && this.compilePredicate(node.args[1], col, env)
        if (!l || !r) return null
        return fn === 'AND' ? (v) => l(v) && r(v) : (v) => l(v) || r(v)
      }
      if (fn === 'CONTAINSSTRING' && node.args.length === 2 && isCol(node.args[0]) && this.constantish(node.args[1], env)) {
        const needle = toText(this.scalar(node.args[1], env)).toLowerCase()
        return (v) => v !== null && toText(v).toLowerCase().includes(needle)
      }
    }
    return null
  }

  /** Boolean CALCULATE filter: FILTER ( ALL ( columns ), condition ). */
  booleanFilter(node: Node, env: Env): Filter {
    const cols: Col[] = []
    this.collectFilterColumns(node, cols, env)
    if (cols.length === 0) {
      throw new DaxError('FILTER', 'The True/False expression does not specify a column. Each True/False expression used as a table filter expression must refer to exactly one column.', node)
    }
    if (cols.some((c) => c.table !== cols[0].table)) {
      throw new DaxError('FILTER', 'The True/False expression uses columns from more than one table. A True/False filter can only use columns from a single table; use FILTER over a table instead.', node)
    }
    if (cols.length === 1) {
      const col = cols[0]
      const pred = this.compilePredicate(node, col, env)
      const keep: number[] = []
      if (pred) {
        for (let c = 0; c < col.dict.length; c++) if (pred(col.dict[c])) keep.push(c)
      } else {
        const t = new TableValue([{ name: col.name, lineage: col, dataType: col.dataType }], [col.dict], col.dict.length)
        for (let c = 0; c < col.dict.length; c++) {
          if (toBool(this.scalar(node, { ...env, rows: [...env.rows, { t, i: c }] }))) keep.push(c)
        }
      }
      return colFilter(col, keep)
    }
    const t0 = cols[0].table
    const seen = new Set<string>()
    const tuples: Int32Array[] = []
    for (let r = 0; r < t0.fullCount; r++) {
      const codes = Int32Array.from(cols.map((c) => c.codes[r]))
      const k = codes.join(',')
      if (seen.has(k)) continue
      seen.add(k)
      tuples.push(codes)
    }
    const t = new TableValue(
      cols.map((c) => ({ name: c.name, lineage: c, dataType: c.dataType })),
      cols.map((c, j) => tuples.map((tu) => c.dict[tu[j]])),
      tuples.length
    )
    const kept = tuples.filter((_, i) => toBool(this.scalar(node, { ...env, rows: [...env.rows, { t, i }] })))
    return tupleFilterFromCodes(cols, kept)
  }

  /** Convert an evaluated table into a filter (base-table rows filter their expanded table). */
  /** Filter of a table value used as a filter (memoized per table object: table values are immutable). */
  tableToFilter(t: TableValue): Filter | null {
    if (t.n < 64) return this.tableToFilterNew(t) // cheap; caching small tables costs more than it saves
    let f = this.tableFilters.get(t)
    if (f === undefined) {
      f = this.tableToFilterNew(t)
      this.tableFilters.set(t, f)
    }
    return f
  }
  private tableFilters = new WeakMap<TableValue, Filter | null>()
  /** TREATAS results per (table, target columns), so equal inputs give the same table (and filter) object. */
  treatAsCache = new WeakMap<TableValue, Map<string, TableValue>>()

  private tableToFilterNew(t: TableValue): Filter | null {
    if (t.base && t.cols.length >= t.base.table.cols.length) return rowsFilter(t.base.table, t.base.ids, true)
    const pos: number[] = []
    const cols: Col[] = []
    t.cols.forEach((c, i) => {
      if (c.lineage && !cols.includes(c.lineage)) {
        pos.push(i)
        cols.push(c.lineage)
      }
    })
    if (cols.length === 0) return null
    if (cols.length === 1) {
      const col = cols[0]
      const d = t.data[pos[0]]
      if (!Array.isArray(d) && d.col === col) {
        const codes = new Set<number>()
        for (let i = 0; i < t.n; i++) codes.add(col.codes[d.ids[i]])
        return colFilter(col, codes)
      }
      const codes: number[] = []
      for (let i = 0; i < t.n; i++) {
        const c = col.codeOf(t.get(i, pos[0]))
        if (c >= 0) codes.push(c)
      }
      return colFilter(col, codes)
    }
    const tuples: Scalar[][] = []
    for (let i = 0; i < t.n; i++) tuples.push(pos.map((p) => t.get(i, p)))
    return valuesFilter(cols, tuples)
  }

  isTableExpr(node: Node, env: Env): boolean {
    switch (node.kind) {
      case 'tableCtor':
        return true
      case 'call':
        return isTableFunction(node.name)
      case 'ident': {
        if (this.queryTables.has(node.name.toLowerCase())) return true
        const v = this.lookupVar(node.name, env)
        if (v !== undefined) return isTable(v)
        return !!this.model.findTable(node.name)
      }
      case 'var':
        return this.isTableExpr(node.body, env)
      default:
        return false
    }
  }

  tableTarget(a: Node[], fn: string, env: Env): 'all' | Col[] {
    if (a.length === 0) return 'all'
    const out: Col[] = []
    for (const x of a) {
      if (x.kind === 'ident') {
        const t = this.model.findTable(x.name)
        if (!t) throw new DaxError('REF', `${fn} expects a table or column reference, and '${x.name}' is not a table.`, x)
        out.push(...env.ctx.expandedColumns(t))
      } else out.push(this.resolveColumn(x, fn))
    }
    return out
  }

  /** Filter context of CALCULATE ( expr, args... ); `expr` (when given) lets an irrelevant transition be skipped. */
  calculateContext(args: Node[], env: Env, expr?: Node): FilterContext {
    type Op =
      | { k: 'filter'; f: Filter; keep: boolean }
      | { k: 'remove'; target: 'all' | Col[] }
      | { k: 'allselected'; target: 'all' | Col[] }
      | { k: 'userel'; rel: Rel }
      | { k: 'cross'; rel: Rel; mode: RelMode }
      | { k: 'none' }

    const classify = (node: Node, keep: boolean): Op => {
      if (node.kind === 'call' && !keep) {
        const fn = node.name.toUpperCase()
        if (fn === 'CROSSFILTER' || fn === 'USERELATIONSHIP') {
          // context-independent: resolved once per expression
          let op = this.relOps.get(node) as Op | undefined
          if (!op) {
            op = classifyNode(node, keep)
            this.relOps.set(node, op)
          }
          return op
        }
      }
      return classifyNode(node, keep)
    }
    const classifyNode = (node: Node, keep: boolean): Op => {
      if (node.kind === 'call') {
        const fn = node.name.toUpperCase()
        switch (fn) {
          case 'REMOVEFILTERS':
          case 'ALL':
          case 'ALLNOBLANKROW':
            return { k: 'remove', target: this.tableTarget(node.args, fn, env) }
          case 'ALLEXCEPT': {
            if (node.args.length < 2) throw new DaxError('ARG', 'ALLEXCEPT takes a table and at least one column.', node)
            const first = node.args[0]
            const t = first.kind === 'ident' ? this.model.findTable(first.name) : null
            if (!t) throw new DaxError('REF', 'ALLEXCEPT expects a table as its first argument.', first)
            const kept = new Set<number>()
            for (const x of node.args.slice(1)) {
              if (x.kind === 'ident') {
                const kt = this.model.findTable(x.name)
                if (kt) for (const c of kt.cols) kept.add(c.id)
              } else kept.add(this.resolveColumn(x, fn).id)
            }
            return { k: 'remove', target: env.ctx.expandedColumns(t).filter((c) => !kept.has(c.id)) }
          }
          case 'ALLCROSSFILTERED': {
            const t = node.args[0]?.kind === 'ident' ? this.model.findTable((node.args[0] as { name: string }).name) : null
            if (!t) throw new DaxError('ARG', 'ALLCROSSFILTERED expects a table.', node)
            // every filter that reaches the table: its expanded columns plus tables that expand to it
            const cols = new Set(env.ctx.expandedColumns(t))
            for (const o of this.model.tables) if (env.ctx.expansion(o).stepOf.has(t)) for (const c of o.cols) cols.add(c)
            for (const r of this.model.relationships) if (r.to.table === t || r.from.table === t) for (const c of [...r.from.table.cols, ...r.to.table.cols]) cols.add(c)
            return { k: 'remove', target: [...cols] }
          }
          case 'ALLSELECTED':
            return { k: 'allselected', target: this.tableTarget(node.args, fn, env) }
          case 'USERELATIONSHIP': {
            if (node.args.length !== 2) throw new DaxError('ARG', 'USERELATIONSHIP takes exactly two column references.', node)
            return { k: 'userel', rel: this.relationshipFor(this.resolveColumn(node.args[0], fn), this.resolveColumn(node.args[1], fn), fn) }
          }
          case 'CROSSFILTER': {
            if (node.args.length !== 3) throw new DaxError('ARG', 'CROSSFILTER takes two column references and a direction (NONE, BOTH, ONEWAY).', node)
            const a0 = this.resolveColumn(node.args[0], fn)
            const a1 = this.resolveColumn(node.args[1], fn)
            const rel = this.relationshipFor(a0, a1, fn)
            const dir = node.args[2]
            const d = dir.kind === 'ident' ? dir.name.toUpperCase() : dir.kind === 'number' ? String(dir.value) : ''
            let mode: RelMode
            if (d === 'NONE' || d === '0') mode = 'none'
            else if (d === 'BOTH' || d === '2') mode = 'both'
            else if (d === 'ONEWAY' || d === '1' || d === 'ONEWAY_RIGHTFILTERSLEFT' || d === 'ONEWAY_LEFTFILTERSRIGHT') mode = 'single'
            else throw new DaxError('ARG', 'The third argument of CROSSFILTER must be NONE, BOTH or ONEWAY.', dir)
            return { k: 'cross', rel, mode }
          }
          case 'KEEPFILTERS':
            if (node.args.length !== 1) throw new DaxError('ARG', 'KEEPFILTERS takes exactly one argument.', node)
            return classify(node.args[0], true)
        }
        if (isTableFunction(fn)) {
          const f = this.tableToFilter(this.table(node, env, fn))
          return f ? { k: 'filter', f, keep } : { k: 'none' }
        }
        return { k: 'filter', f: this.booleanFilter(node, env), keep }
      }
      if (node.kind === 'tableCtor') return { k: 'none' }
      if (node.kind === 'ident' || node.kind === 'var') {
        if (node.kind === 'ident' && node.name === '__missing__') return { k: 'none' }
        const v = this.value(node, env)
        if (isTable(v)) {
          const f = this.tableToFilter(v)
          return f ? { k: 'filter', f, keep } : { k: 'none' }
        }
        if (node.kind === 'ident') throw new DaxError('FILTER', `The variable '${node.name}' holds a single value, so it cannot be a CALCULATE filter.`, node)
      }
      return { k: 'filter', f: this.booleanFilter(node, env), keep }
    }

    const ops = args.map((a) => classify(a, false))
    let skips: Set<number> | null = null
    if (expr && env.rows.length > env.transitioned) {
      let cfg = env.ctx.cfg
      for (const op of ops) if (op.k === 'userel') cfg = cfg.useRelationship(op.rel)
      for (const op of ops) if (op.k === 'cross') cfg = cfg.crossFilter(op.rel, op.mode)
      skips = this.transitionSkips(env, this.nodeFootprint(expr, this.home), cfg)
    }
    let ctx = this.transition(env, skips)
    for (const op of ops) if (op.k === 'userel') ctx = ctx.with({ cfg: ctx.cfg.useRelationship(op.rel) })
    for (const op of ops) if (op.k === 'cross') ctx = ctx.with({ cfg: ctx.cfg.crossFilter(op.rel, op.mode) })
    for (const op of ops) {
      if (op.k === 'remove') ctx = op.target === 'all' ? ctx.removeAll() : ctx.removeColumns(new Set(op.target.map((c) => c.id)), true)
      else if (op.k === 'allselected') ctx = this.allSelected(ctx, op.target, env.shadows)
    }
    // a filter on a date-table key replaces every filter on the date table (marked date table, or a date column
    // on the one side of a relationship)
    for (const op of ops) {
      if (op.k !== 'filter') continue
      const key = this.dateKeyOf(op.f)
      if (key) ctx = ctx.removeColumns(new Set(key.table.cols.map((c) => c.id)))
    }
    const overridden = new Set<number>()
    for (const op of ops) if (op.k === 'filter' && !op.keep) for (const c of filterColumns(this.model, ctx.cfg, op.f)) overridden.add(c.id)
    if (overridden.size) ctx = ctx.removeColumns(overridden)
    const fs: Filter[] = []
    for (const op of ops) if (op.k === 'filter') fs.push(op.f)
    return ctx.addFilters(fs, false)
  }

  private relOps = new WeakMap<Node, object>()

  private dateKeyOf(f: Filter): Col | null {
    const cols = f.kind === 'col' ? [f.col] : f.kind === 'tuple' ? f.cols : []
    for (const c of cols) {
      if (c.dataType !== 'dateTime') continue
      if (c.table.dataCategory?.toLowerCase() === 'time' && (c.def?.isKey || c.table.cols.filter((x) => x.dataType === 'dateTime').length === 1)) return c
      if (this.model.relationships.some((r) => r.to === c && r.kind !== 'mm')) return c
    }
    return null
  }

  /**
   * ALLSELECTED: for each target column, restore the last shadow filter context that filters it (SQLBI, "The
   * definitive guide to ALLSELECTED"): the innermost running iteration whose table has that column, else the query's
   * outer filter context (the SUMMARIZECOLUMNS filters / slicers — `ctx.shadow`). Without arguments every column is
   * restored to the outer filters, then the columns of running iterations to their iteration's table.
   */
  allSelected(ctx: FilterContext, target: 'all' | Col[], frames: readonly import('./registry.ts').ShadowFrame[] = []): FilterContext {
    const shadow = ctx.shadow ?? []
    let out: FilterContext
    let cols: Col[]
    if (target === 'all') {
      out = ctx.with({ filters: [...shadow], scope: new Set() })
      cols = []
      for (const f of frames) for (const id of this.frameCols(f)) cols.push(this.colById(id)!)
      if (!cols.length) return out
    } else {
      out = ctx
      cols = target
    }
    // innermost frame per column
    const byFrame = new Map<number, Col[]>()
    const outer: Col[] = []
    for (const c of cols) {
      let k = -1
      for (let i = frames.length - 1; i >= 0; i--)
        if (this.frameCols(frames[i]).has(c.id)) {
          k = i
          break
        }
      if (k < 0) outer.push(c)
      else byFrame.set(k, [...(byFrame.get(k) ?? []), c])
    }
    if (outer.length) {
      const ids = new Set(outer.map((c) => c.id))
      const cleared = out.removeColumns(ids, true)
      out = cleared.with({ filters: [...cleared.filters, ...ctx.filtersOn(ids, shadow)] })
    }
    for (const [k, cs] of byFrame) {
      const ids = new Set(cs.map((c) => c.id))
      const f = this.frameFilter(frames[k])
      const cleared = out.removeColumns(ids, true)
      out = cleared.with({ filters: [...cleared.filters, ...(f ? ctx.filtersOn(ids, [f]) : [])] })
    }
    return out
  }

  private colIndex: Map<number, Col> | null = null
  private colById(id: number): Col | undefined {
    if (!this.colIndex) {
      this.colIndex = new Map()
      for (const t of this.model.tables) for (const c of t.cols) this.colIndex.set(c.id, c)
    }
    return this.colIndex.get(id)
  }
  private frameCols(f: import('./registry.ts').ShadowFrame): Set<number> {
    if (!f.cols) {
      const s = new Set<number>()
      if (f.t.base) for (const c of f.t.base.table.cols) s.add(c.id)
      for (const c of f.t.cols) if (c.lineage) s.add(c.lineage.id)
      f.cols = s
    }
    return f.cols
  }
  private frameFilter(f: import('./registry.ts').ShadowFrame): Filter | null {
    if (f.filter === undefined) {
      const t = f.t
      f.filter = t.base ? rowsFilter(t.base.table, Int32Array.from(new Set(t.base.ids)).sort(), false) : this.tableToFilter(t)
    }
    return f.filter
  }

  // ---------------------------------------------------------------------------------------------
  // operators
  // ---------------------------------------------------------------------------------------------

  private binary(node: Extract<Node, { kind: 'binary' }>, env: Env): Scalar {
    const op = node.op
    if (op === 'IN') return this.inOperator(node, env)
    if (op === '&&') {
      const a = this.scalar(node.left, env)
      if (a !== null && !toBool(a)) return false
      const b = this.scalar(node.right, env)
      return toBool(a) && toBool(b)
    }
    if (op === '||') {
      const a = this.scalar(node.left, env)
      if (toBool(a)) return true
      const b = this.scalar(node.right, env)
      return toBool(b)
    }
    const a = this.scalar(node.left, env)
    const b = this.scalar(node.right, env)
    try {
      switch (op) {
        case '=':
          return compareMixed(a, b) === 0
        case '==':
          return sameValue(a, b)
        case '<>':
          return compareMixed(a, b) !== 0
        case '<':
          return compareMixed(a, b) < 0
        case '>':
          return compareMixed(a, b) > 0
        case '<=':
          return compareMixed(a, b) <= 0
        case '>=':
          return compareMixed(a, b) >= 0
        case '&':
          return toText(a) + toText(b)
        default:
          return arithmetic(op, a, b)
      }
    } catch (e) {
      if (e instanceof DaxError && e.start === undefined) {
        e.start = node.s
        e.end = node.e
      }
      throw e
    }
  }

  private inOperator(node: Extract<Node, { kind: 'binary' }>, env: Env): boolean {
    const left = node.left.kind === 'tuple' ? node.left.items.map((i) => this.scalar(i, env)) : [this.scalar(node.left, env)]
    const t = this.table(node.right, env, 'IN')
    if (t.cols.length !== left.length) throw new DaxError('ARG', `The IN operator compares ${left.length} value(s) with a table of ${t.cols.length} column(s); they must match.`, node)
    return this.inTable(left, t)
  }

  /** `( left... ) IN t` (widths already checked). */
  inTable(left: Scalar[], t: TableValue): boolean {
    if (t.n <= 8) {
      for (let i = 0; i < t.n; i++) {
        let ok = true
        for (let j = 0; j < left.length && ok; j++) ok = inEqual(left[j], t.get(i, j))
        if (ok) return true
      }
      return false
    }
    // hashed: the same table is usually probed many times (FILTER ( ..., [x] IN variable ))
    let set = this.inIndexes.get(t)
    if (!set) {
      set = new Set()
      for (let i = 0; i < t.n; i++) {
        let k = ''
        for (let j = 0; j < t.cols.length; j++) k += (j ? '\u0002' : '') + inKey(t.get(i, j))
        set.add(k)
      }
      this.inIndexes.set(t, set)
    }
    // BLANK equals 0, "" and FALSE in IN (= semantics): try the equivalent keys
    let keys = ['']
    left.forEach((x, j) => {
      const alts = inAlternatives(x)
      const next: string[] = []
      for (const k of keys) for (const a of alts) next.push(k + (j ? '\u0002' : '') + a)
      keys = next
    })
    return keys.some((k) => set!.has(k))
  }
  private inIndexes = new WeakMap<TableValue, Set<string>>()

  private tableCtor(node: Extract<Node, { kind: 'tableCtor' }>, env: Env): TableValue {
    const width = node.rows[0]?.length ?? 1
    const rows = node.rows.map((r) => r.map((c) => this.scalar(c, env)))
    const cols: TCol[] =
      width === 1
        ? [{ name: 'Value', lineage: null, alias: true }]
        : Array.from({ length: width }, (_, i) => ({ name: `Value${i + 1}`, lineage: null, alias: true }))
    cols.forEach((c, j) => {
      c.dataType = ctorType(rows.map((r) => r[j]))
    })
    return TableValue.fromRows(cols, rows)
  }

  // ---------------------------------------------------------------------------------------------
  // dispatch & helpers
  // ---------------------------------------------------------------------------------------------

  private call(node: CallNode, env: Env): Val {
    const fn = node.name.toUpperCase()
    const impl = FUNCTIONS.get(fn)
    if (!impl) {
      const udf = this.lookupFunction(node.name)
      if (udf) return this.callUdf(udf, node, env)
      throw unknownFunction(node.name, node)
    }
    const meta = FN_META.get(fn)
    if (meta && (meta.min !== undefined || meta.max !== undefined)) this.arity(fn, node.args, meta.min ?? 0, meta.max ?? Infinity, node)
    try {
      return impl(this, node.args, env, node)
    } catch (e) {
      if (e instanceof DaxError && e.start === undefined) {
        e.start = node.s
        e.end = node.e
      }
      throw e
    }
  }

  lookupFunction(name: string): FunctionDefinition | undefined {
    return this.options.functions?.get(name.toLowerCase()) ?? this.model.userFunction(name) ?? this.options.functionSource?.userFunction(name)
  }

  private udfStack: string[] = []
  private udfBodies = new WeakMap<CallNode, Map<string, Node>>()

  /**
   * User-defined function call. `val` parameters are evaluated in the caller's context (row and filter context) and
   * converted to their type hint; `expr` parameters (and reference types) are substituted into the body, so they are
   * evaluated where the body uses them (inheriting the filter context there, e.g. inside CALCULATE or an iterator).
   * The body sees the filter context of the call, not the caller's row context. Recursion is an error, like in DAX.
   * Scoping is lexical: the body sees its parameters and the query-level definitions (DEFINE VAR) only, never the
   * caller's variables. Variables an `expr` argument refers to are bound to the caller's variables under hidden
   * names, so the argument keeps seeing them and the body's own variables cannot capture them.
   */
  private callUdf(udf: FunctionDefinition, node: CallNode, env: Env): Val {
    const lname = udf.name.toLowerCase()
    if (this.udfStack.includes(lname)) throw new DaxError('UDF', `Recursion is not supported in user-defined functions (${[...this.udfStack, lname].join(' -> ')}).`, node)
    const args = node.args
    const params = udf.params
    let minArgs = 0
    params.forEach((p, i) => {
      if (!p.default) minArgs = i + 1
    })
    if (args.length > params.length || args.length < minArgs) {
      throw new DaxError('ARG', `Function ${udf.name} takes ${minArgs === params.length ? params.length : `${minArgs} to ${params.length}`} argument(s); ${args.length} were passed.`, node)
    }
    const vars = new Map<string, Binding>()
    const subst = new Map<string, Node>()
    let captureKey = ''
    params.forEach((p, i) => {
      const a = args[i]
      const missingArg = !a || (a.kind === 'ident' && a.name === '__missing__')
      if (missingArg && !p.default) throw new DaxError('ARG', `Function ${udf.name}: the argument for parameter ${p.name} is missing.`, node)
      const argNode = missingArg ? p.default! : a
      if (p.mode === 'expr') {
        if (!missingArg) this.checkRefParam(udf, p, argNode)
        // the variables the argument refers to (the caller's; the definition's for a default), under hidden names
        // (hygienic substitution: the body's own variables cannot capture them)
        const rename = new Map<string, Node>()
        const from = missingArg ? this.udfScope(udf) : env.scope
        for (const name of referencedNames(argNode)) {
          const b = findBinding(from, name)
          if (!b) continue
          const hidden = `\u0001${i}.${name}`
          vars.set(hidden, b)
          rename.set(name, { kind: 'ident', name: hidden, quoted: false, s: argNode.s, e: argNode.e })
          captureKey += hidden + '\u0002'
        }
        const sub = rename.size ? substitute(argNode, rename) : argNode
        // SCALAR / TABLE expr parameters are type-checked (and cast) where the body references them
        const checked: Node =
          p.type === 'SCALAR' || p.type === 'TABLE'
            ? { kind: 'call', name: p.type === 'TABLE' ? '__UDFTABLE' : '__UDFSCALAR', args: [sub, { kind: 'string', value: `${udf.name}\u0001${p.name}\u0001${p.subtype ?? ''}`, s: sub.s, e: sub.e }], s: sub.s, e: sub.e }
            : sub
        subst.set(p.name.toLowerCase(), checked)
        return
      }
      const argEnv: Env = missingArg ? { ...env, scope: this.udfScope(udf) } : env
      const v = this.value(argNode, argEnv)
      vars.set(p.name.toLowerCase(), { node: argNode, env: argEnv, value: this.coerceParam(udf, p, v, argNode), dataType: SUBTYPE_DATATYPE[p.subtype ?? ''] })
    })
    let bodies = this.udfBodies.get(node)
    if (!bodies) this.udfBodies.set(node, (bodies = new Map()))
    let body = bodies.get(captureKey)
    if (!body) {
      body = subst.size ? substitute(udf.body, subst) : udf.body
      bodies.set(captureKey, body)
    }
    const scope: Scope = { vars, parent: this.udfScope(udf) }
    this.udfStack.push(lname)
    try {
      return this.value(body, { ...env, scope, rows: [], transitioned: 0 })
    } finally {
      this.udfStack.pop()
    }
  }

  /** Scope a function body is defined in: query functions see the query's DEFINE VARs, model functions nothing. */
  private udfScope(udf: FunctionDefinition): Scope | null {
    return this.options.functions?.get(udf.name.toLowerCase()) === udf ? this.queryScope : null
  }

  /** Reference parameters (COLUMNREF, MEASUREREF, TABLEREF, CALENDARREF) only accept references of that kind. */
  private checkRefParam(udf: FunctionDefinition, p: import('./parser.ts').FunctionParam, a: Node): void {
    const bad = (what: string) => new DaxError('TYPE', `Function ${udf.name}: parameter ${p.name} expects ${what}.`, a)
    switch (p.type) {
      case 'COLUMNREF':
        if (a.kind !== 'column' || this.measureFor(a) || !this.tryColumn(a)) throw bad('a column reference')
        return
      case 'MEASUREREF':
        if (a.kind !== 'column' || !this.measureFor(a)) throw bad('a measure reference')
        return
      case 'TABLEREF':
        if (a.kind !== 'ident' || (!this.model.findTable(a.name) && !this.queryTables.has(a.name.toLowerCase()))) throw bad('a table reference')
        return
      case 'CALENDARREF':
        if (a.kind !== 'ident') throw bad('a calendar reference')
        return
      case 'ANYREF':
        if (a.kind !== 'column' && a.kind !== 'ident') throw bad('a reference to a column, measure, table or calendar')
        return
    }
  }

  /** __UDFSCALAR / __UDFTABLE: type check (and cast) of a SCALAR / TABLE expr parameter where it is referenced. */
  udfExprArg(a: Node[], env: Env, table: boolean): Val {
    const [fn, param, subtype] = (a[1].kind === 'string' ? a[1].value : '').split('\u0001')
    const udf = this.lookupFunction(fn)
    const p = udf?.params.find((x) => x.name === param)
    const v = table ? this.table(a[0], env, fn) : this.value(a[0], env)
    if (!udf || !p) return v
    return this.coerceParam(udf, { ...p, subtype: subtype || undefined }, v, a[0])
  }

  /** Declared or static type of a scalar expression (UDF parameter hints, columns, measures, literals, CONVERT). */
  exprType(node: Node, env: Env): DataType | undefined {
    if (node.kind === 'ident') {
      const b = findBinding(env.scope, node.name.toLowerCase())
      if (b) return b.dataType ?? (b.node !== node ? this.exprType(b.node, b.env) : undefined)
    }
    if (node.kind === 'call' && node.name.toUpperCase() === '__UDFSCALAR') {
      const sub = node.args[1]?.kind === 'string' ? node.args[1].value.split('\u0001')[2] : ''
      return SUBTYPE_DATATYPE[sub] ?? this.exprType(node.args[0], env)
    }
    return this.staticType(node)
  }

  private coerceParam(udf: FunctionDefinition, p: import('./parser.ts').FunctionParam, v: Val, node: Node): Val {
    if (p.type === 'TABLE') {
      if (!isTable(v)) throw new DaxError('TYPE', `Function ${udf.name}: parameter ${p.name} expects a table.`, node)
      return v
    }
    if (p.type === 'SCALAR' || p.subtype) {
      const x = isTable(v) ? this.tableToScalar(v, node) : v
      if (x === null) return null
      switch (p.subtype) {
        case 'INT64': {
          const n = toNumber(x)
          return Math.sign(n) * Math.round(Math.abs(n))
        }
        case 'DOUBLE':
        case 'DECIMAL':
        case 'NUMERIC':
          return typeof x === 'number' ? x : toNumber(x)
        case 'STRING':
          return toText(x)
        case 'BOOLEAN':
          return toBool(x)
        case 'DATETIME': {
          const d = toDate(x)
          if (!d) throw new DaxError('TYPE', `Function ${udf.name}: parameter ${p.name} expects a date/time value.`, node)
          return d
        }
        default:
          return x
      }
    }
    return v
  }

  arity(name: string, args: Node[], min: number, max = min, node?: Node): void {
    if (args.length < min || args.length > max) {
      const want = min === max ? `${min}` : max === Infinity ? `at least ${min}` : `${min} to ${max}`
      throw new DaxError('ARG', `Too ${args.length < min ? 'few' : 'many'} arguments were passed to the ${name} function. It takes ${want} argument(s); you passed ${args.length}.`, node)
    }
  }

  withRow(env: Env, t: TableValue, i: number): Env {
    return { ...env, rows: [...env.rows, { t, i }] }
  }

  /** Iterate rows of a table with a row context (reuses one env object per row for speed). */
  each(t: TableValue, env: Env, fn: (rowEnv: Env, i: number) => void): void {
    const rc: RowCtx = { t, i: 0 }
    const rowEnv: Env = { ...env, rows: [...env.rows, rc], shadows: [...(env.shadows ?? []), { t }] }
    for (let i = 0; i < t.n; i++) {
      rc.i = i
      fn(rowEnv, i)
    }
  }

  /** Distinct visible codes of a column (blank code included when a visible row has it). */
  private codesCache = new WeakMap<Int32Array, Map<string, Int32Array>>()

  visibleCodes(col: Col, ctx: FilterContext, includeBlankRow = true): Int32Array {
    const vis = ctx.visible(col.table)
    let m = this.codesCache.get(vis)
    const key = col.id + (includeBlankRow ? '+' : '-')
    const hit = m?.get(key)
    if (hit) return hit
    const out = this.computeVisibleCodes(col, ctx, includeBlankRow)
    if (!m) {
      m = new Map()
      this.codesCache.set(vis, m)
    }
    m.set(key, out)
    return out
  }

  private computeVisibleCodes(col: Col, ctx: FilterContext, includeBlankRow: boolean): Int32Array {
    const t = col.table
    const vis = ctx.visible(t)
    if (vis.length === t.fullCount && (includeBlankRow || !t.hasBlankRow)) {
      // every value occurs; blank code only when present
      let hasBlank = t.hasBlankRow && includeBlankRow
      if (!hasBlank) for (let r = 0; r < t.rowCount; r++) if (col.codes[r] === 0) {
        hasBlank = true
        break
      }
      const out = new Int32Array(col.dict.length - (hasBlank ? 0 : 1))
      let k = 0
      if (hasBlank) out[k++] = 0
      for (let c = 1; c < col.dict.length; c++) out[k++] = c
      return out
    }
    const seen = new Uint8Array(col.dict.length)
    const out: number[] = []
    const blank = t.rowCount
    for (const r of vis) {
      if (!includeBlankRow && r === blank) continue
      const c = col.codes[r]
      if (!seen[c]) {
        seen[c] = 1
        out.push(c)
      }
    }
    return Int32Array.from(out)
  }

  /** VALUES / DISTINCT of a column as a one-column table with lineage. */
  valuesOf(col: Col, ctx: FilterContext, includeBlankRow: boolean): TableValue {
    const codes = this.visibleCodes(col, ctx, includeBlankRow)
    // shared per visible code set (table values are immutable): equal VALUES results are the same object
    const hit = this.valuesCache.get(codes)
    if (hit && hit.col === col) return hit.t
    const vals = new Array<Scalar>(codes.length)
    for (let i = 0; i < codes.length; i++) vals[i] = col.dict[codes[i]]
    const t = new TableValue([{ name: col.name, lineage: col, dataType: col.dataType }], [vals], vals.length)
    this.valuesCache.set(codes, { col, t })
    return t
  }
  private valuesCache = new WeakMap<Int32Array, { col: Col; t: TableValue }>()

  /** Visible values of a column on non-blank rows (for SUM/MIN/...), as an iterator over row values. */
  columnRows(col: Col, ctx: FilterContext): Int32Array {
    return ctx.visible(col.table)
  }

  /** Evaluate a table expression or a bare column reference (aggregators accept both). */
  colOrTable(node: Node, env: Env, fn: string): TableValue {
    const c = node.kind === 'column' ? this.tryColumn(node) : null
    if (c) return this.valuesOf(c, env.ctx, true)
    return this.table(node, env, fn)
  }

  staticType(node: Node, depth = 0): DataType | undefined {
    if (depth > 12) return undefined
    switch (node.kind) {
      case 'number':
        return Number.isInteger(node.value) ? 'int64' : 'double'
      case 'string':
        return 'string'
      case 'bool':
        return 'boolean'
      case 'column': {
        const m = this.measureFor(node)
        if (m) return m.dataType && m.dataType !== 'unknown' ? m.dataType : (() => {
          try {
            return this.staticType(this.measureAst(m), depth + 1)
          } catch {
            return undefined
          }
        })()
        return this.tryColumn(node)?.dataType
      }
      case 'binary':
        if (['=', '==', '<>', '<', '>', '<=', '>=', 'IN', '&&', '||'].includes(node.op)) return 'boolean'
        if (node.op === '&') return 'string'
        if (node.op === '/') return 'double'
        return undefined
      case 'unary':
        return node.op === 'NOT' ? 'boolean' : this.staticType(node.operand, depth + 1)
      case 'var':
        return this.staticType(node.body, depth + 1)
      case 'call': {
        const fn = node.name.toUpperCase()
        if (fn === 'CONVERT' && node.args[1]?.kind === 'ident') {
          const t = node.args[1].name.toUpperCase()
          return t === 'INTEGER' || t === 'INT64' ? 'int64' : t === 'CURRENCY' || t === 'DECIMAL' ? 'decimal' : SUBTYPE_DATATYPE[t]
        }
        if (['DIVIDE', 'AVERAGE', 'AVERAGEX'].includes(fn)) return 'double'
        if (['COUNTROWS', 'COUNT', 'COUNTA', 'COUNTX', 'COUNTAX', 'COUNTBLANK', 'DISTINCTCOUNT', 'YEAR', 'MONTH', 'DAY', 'DATEDIFF', 'LEN', 'RANKX', 'WEEKDAY', 'WEEKNUM', 'HOUR', 'MINUTE', 'SECOND', 'QUARTER', 'INT'].includes(fn)) return 'int64'
        if (['FORMAT', 'CONCATENATE', 'CONCATENATEX', 'UPPER', 'LOWER', 'LEFT', 'RIGHT', 'MID', 'SUBSTITUTE', 'TRIM', 'UNICHAR', 'NAMEOF', 'REPT', 'COMBINEVALUES', 'FIXED', 'SELECTEDMEASURENAME', 'USERPRINCIPALNAME', 'USERNAME'].includes(fn)) return 'string'
        if (['ISBLANK', 'AND', 'OR', 'NOT', 'HASONEVALUE', 'ISINSCOPE', 'ISFILTERED', 'ISCROSSFILTERED', 'CONTAINSSTRING', 'ISEMPTY', 'CONTAINS', 'ISERROR'].includes(fn)) return 'boolean'
        if (['DATE', 'EOMONTH', 'TODAY', 'NOW', 'EDATE', 'DATEVALUE', 'TIME', 'TIMEVALUE', 'UTCNOW', 'UTCTODAY'].includes(fn)) return 'dateTime'
        if (['SUM', 'MIN', 'MAX', 'SUMX', 'MINX', 'MAXX', 'SELECTEDVALUE', 'CALCULATE', 'ABS', 'COALESCE'].includes(fn)) {
          const arg = fn === 'SUMX' || fn === 'MINX' || fn === 'MAXX' ? node.args[1] : node.args[0]
          return arg ? this.staticType(arg, depth + 1) : undefined
        }
        if (fn === 'IF' || fn === 'SWITCH') {
          const branches = fn === 'IF' ? node.args.slice(1) : node.args.slice(2).filter((_, i, arr) => i % 2 === 0 || i === arr.length - 1)
          const types = branches.map((b) => this.staticType(b, depth + 1)).filter((x) => x)
          return types.length && types.every((t) => t === types[0]) ? types[0] : undefined
        }
        return undefined
      }
      default:
        return undefined
    }
  }
}

/** `=` comparison that tolerates number vs text like DAX's implicit conversion in equality with BLANK etc. */
function compareMixed(a: Scalar, b: Scalar): number {
  return compare(a, b)
}

/** IN hash key: case-insensitive text, numbers and dates by numeric value (DAX compare), BLANK apart. */
function inKey(v: Scalar): string {
  if (v === null) return 'z'
  if (typeof v === 'string') return 's' + v.toLowerCase()
  if (typeof v === 'boolean') return 'b' + v
  return 'n' + (typeof v === 'number' ? v : v.getTime() / 86_400_000 + 25_569)
}
function inAlternatives(v: Scalar): string[] {
  if (v === null) return ['z', 'n0', 's', 'bfalse']
  if (v === 0 || v === '' || v === false) return [inKey(v), 'z']
  return [inKey(v)]
}

function inEqual(a: Scalar, b: Scalar): boolean {
  // IN uses = semantics except that BLANK only matches BLANK... DAX: BLANK IN {0} is TRUE (= semantics).
  if (a === null || b === null) {
    if (a === null && b === null) return true
    const other = a === null ? b : a
    return other === 0 || other === '' || other === false
  }
  try {
    return compare(a, b) === 0
  } catch {
    return false
  }
}

function ctorType(values: Scalar[]): DataType | undefined {
  let t: DataType | undefined
  for (const v of values) {
    if (v === null) continue
    const vt = valueDataType(v)
    if (!t) t = vt
    else if (t !== vt) {
      if ((t === 'int64' && vt === 'double') || (t === 'double' && vt === 'int64')) t = 'double'
      else t = 'string'
    }
  }
  return t
}

export { colMask, eqFilter, tupleKey }
export type { ColFilter }

/** Replace references to `expr` parameters (identifiers, and Param[Column] when the argument is a table name). */
function substitute(n: Node, subst: ReadonlyMap<string, Node>, shadowed: ReadonlySet<string> = new Set()): Node {
  switch (n.kind) {
    case 'ident': {
      const k = n.name.toLowerCase()
      return subst.has(k) && !shadowed.has(k) ? subst.get(k)! : n
    }
    case 'column': {
      if (n.table === null) return n
      const k = n.table.toLowerCase()
      const arg = subst.get(k)
      if (arg && !shadowed.has(k) && arg.kind === 'ident') return { ...n, table: arg.name }
      return n
    }
    case 'call':
      return { ...n, args: n.args.map((a) => substitute(a, subst, shadowed)) }
    case 'binary':
      return { ...n, left: substitute(n.left, subst, shadowed), right: substitute(n.right, subst, shadowed) }
    case 'unary':
      return { ...n, operand: substitute(n.operand, subst, shadowed) }
    case 'tuple':
      return { ...n, items: n.items.map((x) => substitute(x, subst, shadowed)) }
    case 'tableCtor':
      return { ...n, rows: n.rows.map((r) => r.map((x) => substitute(x, subst, shadowed))) }
    case 'var': {
      const inner = new Set(shadowed)
      const decls = n.decls.map((d) => {
        const expr = substitute(d.expr, subst, inner)
        inner.add(d.name.toLowerCase())
        return { ...d, expr }
      })
      return { ...n, decls, body: substitute(n.body, subst, inner) }
    }
    default:
      return n
  }
}

/** Lower-case names an expression could use as variables (identifiers and table parts of column references). */
function referencedNames(n: Node, out = new Set<string>()): Set<string> {
  switch (n.kind) {
    case 'ident':
      if (n.name !== '__missing__') out.add(n.name.toLowerCase())
      break
    case 'column':
      if (n.table !== null) out.add(n.table.toLowerCase())
      break
    case 'call':
      n.args.forEach((a) => referencedNames(a, out))
      break
    case 'binary':
      referencedNames(n.left, out)
      referencedNames(n.right, out)
      break
    case 'unary':
      referencedNames(n.operand, out)
      break
    case 'tuple':
      n.items.forEach((x) => referencedNames(x, out))
      break
    case 'tableCtor':
      n.rows.forEach((r) => r.forEach((x) => referencedNames(x, out)))
      break
    case 'var':
      n.decls.forEach((d) => referencedNames(d.expr, out))
      referencedNames(n.body, out)
      break
  }
  return out
}

/** Data type of a UDF scalar subtype hint. */
const SUBTYPE_DATATYPE: Record<string, DataType | undefined> = { INT64: 'int64', DOUBLE: 'double', DECIMAL: 'decimal', STRING: 'string', BOOLEAN: 'boolean', DATETIME: 'dateTime' }

/** Filters of a context that touch a calculation group's table. */
function cgFilters(ctx: FilterContext, g: CalcGroup): Filter[] {
  const out: Filter[] = []
  for (const f of ctx.filters) {
    if (f.kind === 'col' ? f.col.table === g.table : f.kind === 'tuple' ? f.cols.some((c) => c.table === g.table) : f.table === g.table) out.push(f)
  }
  return out
}

function sameFilters(a: readonly Filter[], b: readonly Filter[]): boolean {
  return a.length === b.length && a.every((f, i) => f === b[i])
}

function findBinding(scope: Scope | null, name: string): Binding | undefined {
  for (let s = scope; s; s = s.parent) {
    const b = scopeGet(s, name)
    if (b) return b
  }
  return undefined
}

function stackNames(s: Env['stack']): string[] {
  const out: string[] = []
  for (let x = s; x; x = x.prev) out.unshift(x.name)
  return out
}
