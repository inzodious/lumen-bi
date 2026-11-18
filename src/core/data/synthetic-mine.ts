/**
 * Value-domain mining for synthetic data: find the literal values the model's DAX and the
 * report's SQ filters compare columns to, so generated data makes those filters/measures hit.
 *
 * Sources scanned:
 *  - DAX: measures, calculated columns, calculated tables, calculation items (+ their dynamic format
 *    strings), measure formatStringDefinitions, detail rows / KPI expressions, role filters.
 *    Patterns: `t[c] = "x"`, `"x" = t[c]`, `<>`, `==`, `t[c] IN { ... }`, SWITCH(<col-ish>, "a", .., "b", ..),
 *    SWITCH(TRUE(), _v = "a", ...) with `VAR _v = SELECTEDVALUE(t[c])`, CONTAINSSTRING / SEARCH / FIND,
 *    TREATAS({..}, t[c]), LOOKUPVALUE(.., t[c], "x"), FILTER(t, [c] = "x"), `t[flag] = TRUE()`.
 *  - Links (no literal, but values flow from a calculated table with literal rows): relationships
 *    between a data column and a DATATABLE / table-constructor column, TREATAS(VALUES(calc[c]), t[c]),
 *    LOOKUPVALUE(.., t[c], calc[c]), `t[c] IN VALUES(calc[c])`, `t[c] = calc[c]`.
 *  - PBIR report: every SQ filter (report/page/visual filterConfig, slicer `filter` objects,
 *    bookmarks, conditional-formatting comparisons): `In` values and `Comparison` (equality) / `Contains` /
 *    `StartsWith` / `EndsWith` literals, resolving `SourceRef.Source` through the nearest `From` aliases.
 *
 * Date literals (`DATE(2026,1,31)`, `datetime'2026-01-31T00:00:00'`) are kept: the generator extends its
 * calendar to cover them and makes sure facts have rows on those dates. Report range filters
 * (`Between`, `>=`/`<=` comparisons on dates) contribute their bounds.
 *
 * Besides per-column domains, the miner returns *conjunctions*: sets of equality conditions on several
 * columns that must hold together (all filter arguments of one CALCULATE, `&&` inside FILTER, conditions
 * accumulated through nested measure references, report + page + slicer + visual filters around the
 * measures a visual shows). The generator seeds rows that satisfy each conjunction at once.
 *
 * Besides the domains, every literal condition is recorded with its operator, polarity, site and use (`MinedCondition`:
 * `=` / IN / ISBLANK / comparisons / text search, negated by `<>`, NOT IN, NOT ( … ) and report Not filters; inside a
 * measure, calculated column / table, calculation item, role, report filter, slicer selection, bookmark or conditional
 * formatting; as a row filter or as a branch test), traced through VAR bindings, KEEPFILTERS, TREATAS, FILTER,
 * CALCULATE(TABLE), IF and SWITCH. ./synthetic-conditions.ts turns them into value distributions. Not traced: conditions
 * in expressions the tolerant parser rejects, conditions reached only through measure references inside a filter
 * argument, and conditions on calculated columns (not pushed back to their sources with their polarity).
 *
 * Calculated columns: values mined for a calculated column are pushed back to the data columns it is
 * computed from (`COALESCE(CALCULATE(MAX(t[c])), "N/A")`, `SWITCH(t[c], "a", "A", ...)` inverted,
 * `SWITCH(TRUE(), t[c] = "x", "X", ...)` / `IF(...)` conditions of the branch producing the value).
 *
 * Calculated tables: domains, conjunctions and implications mined for a calculated table's columns are
 * copied to the imported columns they are computed from (see ./synthetic-lineage.ts).
 */
import type { ColumnDef, SemanticModel, TableDef } from '../model/types'
import type { ProjectDocument } from '../project'
import { decodeLiteral } from '../report/literal'
import { makeDate } from '../model/data'
import { literalOf, literalTableOf, tokenizeDax, tryParseDax, type DaxNode, type LiteralTable } from './synthetic-dax'
import { modelLineage, propagateLineage } from './synthetic-lineage'

export type MinedValue = string | number | boolean | Date

/** A set of equality conditions that must hold on the same rows (e.g. one CALCULATE's filters). */
export interface Conjunction {
  conds: Array<{ table: string; column: string; values: MinedValue[] }>
}

/**
 * Row-level implication mined from ratio measures: DIVIDE([part], [whole]) where both are filtered
 * aggregations over the same table (e.g. `passed = CALCULATE(COUNTROWS(t), t[sla_passed] = 1)`,
 * `qualified = CALCULATE(COUNTROWS(t), t[sla_qualified] = 1)`). Real data has part ⊆ whole, so rows that
 * satisfy `when` also satisfy `then` — otherwise the synthetic ratio exceeds 100%.
 */
export interface Implication {
  table: string
  when: Array<{ column: string; values: MinedValue[] }>
  then: Array<{ column: string; value: MinedValue }>
}

export interface MineResult {
  domains: Map<string, MinedDomain>
  conjunctions: Conjunction[]
  implications: Implication[]
  /** every literal condition with its operator, polarity and where it is used (see MinedCondition) */
  conditions: MinedCondition[]
}

/**
 * Operator of a mined condition: `=` (one literal), `IN` (a list), `ISBLANK`, a comparison, or `CONTAINS` (CONTAINSSTRING,
 * SEARCH / FIND, report Contains / StartsWith / EndsWith). The negations (`<>`, `NOT IN`, `NOT ISBLANK`, does not contain)
 * are the same operators with `polarity: 'negative'`.
 */
export type CondOp = '=' | 'IN' | 'ISBLANK' | '<' | '<=' | '>' | '>=' | 'CONTAINS'

/**
 * Where a condition is written: a measure (also KPI, detail-rows and format-string expressions of measures), a
 * calculation item, a calculated column, a calculated table, a role (RLS), a report / page / visual filter, a slicer's
 * saved selection, a bookmark, or a conditional-formatting rule.
 */
export type CondSite = 'measure' | 'calcItem' | 'calcColumn' | 'calcTable' | 'rls' | 'filter' | 'slicer' | 'bookmark' | 'format'

/**
 * A literal condition on a column, as the definitions use it.
 *  - `use: 'filter'`: the condition restricts the rows a computation sees (a CALCULATE / CALCULATETABLE filter argument,
 *    a FILTER predicate, TREATAS, KEEPFILTERS, a report filter, a slicer selection, a role filter);
 *  - `use: 'test'`: a branch condition (IF / SWITCH), a comparison computed as a value, a conditional-formatting rule.
 * `polarity: 'negative'` for `<>`, NOT IN, NOT ISBLANK, NOT CONTAINSSTRING and report exclude (Not) filters; a
 * condition under NOT ( … ) flips. `source` names the measure / column / table / visual it comes from (model and
 * report object names; kept in memory only).
 */
export interface MinedCondition {
  table: string
  column: string
  op: CondOp
  polarity: 'positive' | 'negative'
  values: MinedValue[]
  site: CondSite
  use: 'filter' | 'test'
  source?: string
}

export interface MinedDomain {
  table: string
  column: string
  /** equality literals (ordered by first occurrence, unique) */
  values: MinedValue[]
  /** substrings the column is searched for (CONTAINSSTRING / SEARCH / report Contains filters) */
  contains: string[]
  /** values flowing in from calculated tables with literal rows (subset of `values`) */
  linked: MinedValue[]
  /**
   * The column is a LOOKUPVALUE search column: LOOKUPVALUE errors ("A table of multiple values was
   * supplied…") when a searched value matches several rows with different results, so the generator
   * keeps its values unique on dimension-like tables.
   */
  lookupKey?: boolean
}

/** Canonical domain key for a model column: `table[column]` using the model's spelling. */
export function domainKey(table: string, column: string): string {
  return `${table}[${column}]`
}

interface ColRef {
  table: TableDef
  column: ColumnDef
}

interface Guard {
  ref: ColRef
  values: MinedValue[]
}

interface Cond {
  ref: ColRef
  values: MinedValue[]
  /** substrings (CONTAINSSTRING / SEARCH) — used by calculated-column inversion only */
  contains?: string[]
}

const MAX_CONJUNCTIONS = 600
const MAX_CONDITIONS = 20000

/** `BLANK()` */
function isBlankCall(n: DaxNode | null): boolean {
  return !!n && n.k === 'call' && n.name === 'BLANK' && n.args.filter(Boolean).length === 0
}

class ModelIndex {
  readonly tables = new Map<string, TableDef>()
  readonly measureNames = new Set<string>()
  /** column name (lower) -> tables containing it */
  readonly columnOwners = new Map<string, TableDef[]>()

  constructor(readonly model: SemanticModel) {
    for (const t of model.tables) {
      this.tables.set(t.name.toLowerCase(), t)
      for (const m of t.measures) this.measureNames.add(m.name.toLowerCase())
      for (const c of t.columns) {
        const k = c.name.toLowerCase()
        const arr = this.columnOwners.get(k)
        if (arr) arr.push(t)
        else this.columnOwners.set(k, [t])
      }
    }
  }

  table(name: string | undefined): TableDef | undefined {
    return name === undefined ? undefined : this.tables.get(name.toLowerCase())
  }

  column(table: TableDef, name: string): ColumnDef | undefined {
    const l = name.toLowerCase()
    return table.columns.find((c) => c.name.toLowerCase() === l)
  }

  resolve(tableName: string | undefined, column: string, home: TableDef | undefined, rowTables: TableDef[]): ColRef | undefined {
    if (tableName !== undefined) {
      const t = this.table(tableName)
      const c = t && this.column(t, column)
      return t && c ? { table: t, column: c } : undefined
    }
    // bare [x]: a measure reference unless it resolves to a column in row context / the home table
    for (let i = rowTables.length - 1; i >= 0; i--) {
      const c = this.column(rowTables[i], column)
      if (c) return { table: rowTables[i], column: c }
    }
    if (home) {
      const c = this.column(home, column)
      if (c) return { table: home, column: c }
    }
    if (this.measureNames.has(column.toLowerCase())) return undefined
    const owners = this.columnOwners.get(column.toLowerCase())
    if (owners && owners.length === 1) {
      const c = this.column(owners[0], column)
      if (c) return { table: owners[0], column: c }
    }
    return undefined
  }
}

/** Calculated (DAX) table: partition sourceType 'calculated'. */
export function isCalculatedTable(t: TableDef): boolean {
  return t.partitions.some((p) => p.sourceType === 'calculated')
}

export function isCalculationGroupTable(t: TableDef): boolean {
  return !!t.calculationGroup || t.partitions.some((p) => p.sourceType === 'calculationGroup')
}

export function isFieldParameterTable(t: TableDef): boolean {
  return t.partitions.some((p) => p.sourceType === 'calculated' && /\bNAMEOF\s*\(/i.test(p.expression ?? ''))
}

/**
 * Literal rows of a calculated table (DATATABLE / table constructor), keyed by model column name.
 * Columns are matched by sourceColumn (`[stage]`, `[Value1]`) or by name / position.
 */
export function calculatedTableLiterals(t: TableDef): Map<string, Array<string | number | boolean | null>> | undefined {
  if (!isCalculatedTable(t) || isFieldParameterTable(t)) return undefined
  const expr = t.partitions.find((p) => p.sourceType === 'calculated')?.expression
  if (!expr) return undefined
  const lit: LiteralTable | undefined = literalTableOf(expr)
  if (!lit) return undefined
  const out = new Map<string, Array<string | number | boolean | null>>()
  const lowerCols = lit.columns.map((c) => c.toLowerCase())
  const dataCols = t.columns.filter((c) => c.kind !== 'calculated' && c.kind !== 'rowNumber')
  dataCols.forEach((col, pos) => {
    const src = (col.sourceColumn ?? col.name).replace(/^\[|\]$/g, '').toLowerCase()
    let idx = lowerCols.indexOf(src)
    if (idx < 0) idx = lowerCols.indexOf(col.name.toLowerCase())
    if (idx < 0 && dataCols.length === lit.columns.length) idx = pos
    if (idx < 0) return
    out.set(
      col.name,
      lit.rows.map((r) => (r[idx] === undefined ? null : r[idx]))
    )
  })
  return out
}

// ---------------------------------------------------------------------------------------------

type Env = Map<string, DaxNode>

const COLUMN_WRAPPERS = new Set([
  'SELECTEDVALUE',
  'MAX',
  'MIN',
  'VALUES',
  'DISTINCT',
  'FIRSTNONBLANK',
  'LASTNONBLANK',
  'RELATED',
  'LOWER',
  'UPPER',
  'TRIM',
  'ALL',
  'ALLSELECTED',
  'ALLNOBLANKROW',
  'FILTERS',
  'KEEPFILTERS',
  'CALCULATE',
  'CALCULATETABLE',
  'LOOKUPVALUE',
  'MAXX',
  'MINX',
  'CONCATENATEX'
])

/** Iterators / filter functions whose first argument provides a row context for later args. */
const ROW_CONTEXT_FNS = new Set([
  'FILTER',
  'SUMX',
  'AVERAGEX',
  'MINX',
  'MAXX',
  'COUNTX',
  'COUNTAX',
  'CONCATENATEX',
  'ADDCOLUMNS',
  'SELECTCOLUMNS',
  'RANKX',
  'PRODUCTX',
  'GENERATE',
  'TOPN',
  'MEDIANX',
  'STDEVX.P',
  'STDEVX.S'
])

class Miner {
  private readonly idx: ModelIndex
  readonly domains = new Map<string, MinedDomain>()
  /** links: target key -> source column refs (values copied from calc-table literals) */
  readonly links: Array<{ target: ColRef; source: ColRef; guards: Guard[] }> = []
  /** conditions of the enclosing SWITCH(TRUE(), cond, ...) / IF(cond, ...) branches */
  private guardStack: Guard[][] = []

  constructor(readonly model: SemanticModel) {
    this.idx = new ModelIndex(model)
  }

  private domain(ref: ColRef): MinedDomain {
    const key = domainKey(ref.table.name, ref.column.name)
    let d = this.domains.get(key)
    if (!d) {
      d = { table: ref.table.name, column: ref.column.name, values: [], contains: [], linked: [] }
      this.domains.set(key, d)
    }
    return d
  }

  addValue(ref: ColRef, v: unknown): void {
    if (v === null || v === undefined) return
    if (v instanceof Date) {
      if (!Number.isFinite(v.getTime())) return
    } else if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return
    if (typeof v === 'number' && !Number.isFinite(v)) return
    // `t[c] = ""` / `<> ""` are blank checks, not domain values
    if (typeof v === 'string' && v.trim() === '') return
    const d = this.domain(ref)
    if (!d.values.some((x) => sameValue(x, v))) d.values.push(v)
  }

  markLookupKey(ref: ColRef): void {
    this.domain(ref).lookupKey = true
  }

  addContains(ref: ColRef, s: unknown): void {
    if (typeof s !== 'string' || !s.trim()) return
    const d = this.domain(ref)
    if (!d.contains.includes(s)) d.contains.push(s)
  }

  addLink(target: ColRef, source: ColRef): void {
    if (target.table === source.table && target.column === source.column) return
    this.links.push({ target, source, guards: this.guardStack.flat() })
  }

  /** `t[c] = "x"` conjuncts of a branch condition (used to filter linked calculated-table rows). */
  private guardsOf(n: DaxNode | null, env: Env, home: TableDef | undefined, rowTables: TableDef[], depth = 0): Guard[] {
    if (!n || depth > 20) return []
    if (n.k === 'bin' && n.op === '&&') return [...this.guardsOf(n.l, env, home, rowTables, depth + 1), ...this.guardsOf(n.r, env, home, rowTables, depth + 1)]
    if (n.k === 'bin' && (n.op === '=' || n.op === '==')) {
      const lc = this.colOf(n.l, env, home, rowTables)
      const rv = this.litOf(n.r, env)
      if (lc && rv !== undefined) return [{ ref: lc, values: [rv] }]
      const rc = this.colOf(n.r, env, home, rowTables)
      const lv = this.litOf(n.l, env)
      if (rc && lv !== undefined) return [{ ref: rc, values: [lv] }]
    }
    if (n.k === 'bin' && n.op === 'IN') {
      const lc = this.colOf(n.l, env, home, rowTables)
      const rows = this.listOf(n.r, env)
      if (lc && rows) return [{ ref: lc, values: rows.map((r) => r[0]).filter((x) => x !== undefined) }]
    }
    return []
  }

  private visitGuarded(cond: DaxNode | null, body: DaxNode | null, env: Env, home: TableDef | undefined, rowTables: TableDef[], depth: number): void {
    this.guardStack.push(this.guardsOf(cond, env, home, rowTables))
    try {
      this.visit(body, env, home, rowTables, depth + 1)
    } finally {
      this.guardStack.pop()
    }
  }

  // --- DAX ---------------------------------------------------------------------------------

  scanDax(expr: string | undefined, home: TableDef | undefined): void {
    if (!expr || !expr.trim()) return
    const ast = tryParseDax(expr)
    if (ast) this.visit(ast, new Map(), home, [], 0)
    else this.scanTokens(expr, home)
  }

  /** Fallback when the parser gave up: token-window scan for `col op literal` / `col IN {..}`. */
  private scanTokens(expr: string, home: TableDef | undefined): void {
    const toks = tokenizeDax(expr)
    const colAt = (i: number): { ref?: ColRef; end: number } => {
      const t = toks[i]
      if (!t) return { end: i }
      if ((t.kind === 'ident' || t.kind === 'qtable') && toks[i + 1]?.kind === 'colref') {
        return { ref: this.idx.resolve(t.text, toks[i + 1].text, home, []), end: i + 2 }
      }
      if (t.kind === 'colref') return { ref: this.idx.resolve(undefined, t.text, home, []), end: i + 1 }
      return { end: i }
    }
    const litAt = (i: number): MinedValue | undefined => {
      const t = toks[i]
      if (!t) return undefined
      if (t.kind === 'str') return t.text
      if (t.kind === 'num') return Number(t.text)
      if (t.kind === 'ident' && /^(TRUE|FALSE)$/i.test(t.text)) return t.text.toUpperCase() === 'TRUE'
      return undefined
    }
    for (let i = 0; i < toks.length; i++) {
      const { ref, end } = colAt(i)
      if (ref) {
        const op = toks[end]
        if (op?.kind === 'op' && (op.text === '=' || op.text === '==' || op.text === '<>')) {
          const v = litAt(end + 1)
          if (v !== undefined) this.addValue(ref, v)
        } else if (op?.kind === 'ident' && op.text.toUpperCase() === 'IN' && toks[end + 1]?.text === '{') {
          for (let j = end + 2; j < toks.length && toks[j].text !== '}'; j++) {
            const v = litAt(j)
            if (v !== undefined) this.addValue(ref, v)
          }
        }
        continue
      }
      const v = litAt(i)
      const op = toks[i + 1]
      if (v !== undefined && op?.kind === 'op' && (op.text === '=' || op.text === '==' || op.text === '<>')) {
        const r = colAt(i + 2).ref
        if (r) this.addValue(r, v)
      }
    }
  }

  /** The column a scalar / single-column expression stands for (through VARs and wrappers). */
  private colOf(n: DaxNode | null, env: Env, home: TableDef | undefined, rowTables: TableDef[], depth = 0): ColRef | undefined {
    if (!n || depth > 12) return undefined
    switch (n.k) {
      case 'col':
        return this.idx.resolve(n.table, n.column, home, rowTables)
      case 'id': {
        const bound = env.get(n.name.toLowerCase())
        return bound ? this.colOf(bound, env, home, rowTables, depth + 1) : undefined
      }
      case 'call':
        if (COLUMN_WRAPPERS.has(n.name) && n.args.length > 0) {
          if ((n.name === 'MAXX' || n.name === 'MINX' || n.name === 'CONCATENATEX') && n.args.length > 1) {
            const t = this.tableOf(n.args[0], env)
            return this.colOf(n.args[1], env, home, t ? [...rowTables, t] : rowTables, depth + 1)
          }
          return this.colOf(n.args[0], env, home, rowTables, depth + 1)
        }
        return undefined
      default:
        return undefined
    }
  }

  /** A literal value through VAR bindings. */
  private litOf(n: DaxNode | null, env: Env, depth = 0): MinedValue | undefined {
    if (!n || depth > 12) return undefined
    const v = literalOf(n)
    if (v !== undefined) return v
    if (n.k === 'id') {
      const bound = env.get(n.name.toLowerCase())
      return bound ? this.litOf(bound, env, depth + 1) : undefined
    }
    if (n.k === 'call') return dateLiteralOf(n)
    return undefined
  }

  /** Literal values of a `{ ... }` list (or a VAR bound to one). */
  private listOf(n: DaxNode | null, env: Env, depth = 0): Array<MinedValue[]> | undefined {
    if (!n || depth > 12) return undefined
    if (n.k === 'id') {
      const bound = env.get(n.name.toLowerCase())
      return bound ? this.listOf(bound, env, depth + 1) : undefined
    }
    if (n.k !== 'list') return undefined
    const rows: Array<MinedValue[]> = []
    for (const it of n.items) {
      const cells = it.k === 'tuple' ? it.items : [it]
      rows.push(cells.map((c) => this.litOf(c, env)).filter((x): x is MinedValue => x !== undefined))
    }
    return rows
  }

  /** The table a table-valued argument refers to (for row contexts). */
  private tableOf(n: DaxNode | null, env: Env, depth = 0): TableDef | undefined {
    if (!n || depth > 12) return undefined
    if (n.k === 'tbl') return this.idx.table(n.name)
    if (n.k === 'id') {
      const t = this.idx.table(n.name)
      if (t) return t
      const bound = env.get(n.name.toLowerCase())
      return bound ? this.tableOf(bound, env, depth + 1) : undefined
    }
    if (n.k === 'call' && n.args.length > 0) {
      if (['ALL', 'ALLSELECTED', 'ALLNOBLANKROW', 'FILTER', 'CALCULATETABLE', 'RELATEDTABLE', 'KEEPFILTERS', 'TOPN', 'ADDCOLUMNS', 'VALUES', 'DISTINCT', 'ALLEXCEPT'].includes(n.name)) {
        return this.tableOf(n.name === 'TOPN' ? n.args[1] : n.args[0], env, depth + 1)
      }
    }
    return undefined
  }

  /** Columns whose values a table expression yields (positionally), for TREATAS / IN links. */
  private valueColumnsOf(n: DaxNode | null, env: Env, home: TableDef | undefined, depth = 0): ColRef[] {
    if (!n || depth > 12) return []
    switch (n.k) {
      case 'col': {
        const r = this.idx.resolve(n.table, n.column, home, [])
        return r ? [r] : []
      }
      case 'id': {
        const bound = env.get(n.name.toLowerCase())
        if (bound) return this.valueColumnsOf(bound, env, home, depth + 1)
        const t = this.idx.table(n.name)
        return t ? t.columns.map((c) => ({ table: t, column: c })) : []
      }
      case 'tbl': {
        const t = this.idx.table(n.name)
        return t ? t.columns.map((c) => ({ table: t, column: c })) : []
      }
      case 'call': {
        const a = n.args
        switch (n.name) {
          case 'VALUES':
          case 'DISTINCT':
          case 'ALL':
          case 'ALLSELECTED':
          case 'ALLNOBLANKROW':
          case 'KEEPFILTERS':
          case 'CALCULATETABLE':
          case 'FILTER':
          case 'UNION':
          case 'INTERSECT':
          case 'EXCEPT':
            return this.valueColumnsOf(a[0] ?? null, env, home, depth + 1)
          case 'TOPN':
            return this.valueColumnsOf(a[1] ?? null, env, home, depth + 1)
          case 'SUMMARIZE': {
            const out: ColRef[] = []
            for (let i = 1; i < a.length; i++) {
              const node = a[i]
              if (node && node.k === 'col') {
                const r = this.idx.resolve(node.table, node.column, home, [])
                if (r) out.push(r)
              } else break
            }
            return out
          }
          case 'SELECTCOLUMNS': {
            const t = this.tableOf(a[0] ?? null, env)
            const out: ColRef[] = []
            for (let i = 2; i < a.length; i += 2) {
              const r = this.colOf(a[i] ?? null, env, home, t ? [t] : [])
              if (r) out.push(r)
            }
            return out
          }
          default:
            return []
        }
      }
      default:
        return []
    }
  }

  private visit(n: DaxNode | null, env: Env, home: TableDef | undefined, rowTables: TableDef[], depth: number): void {
    if (!n || depth > 400) return
    switch (n.k) {
      case 'var': {
        const inner: Env = new Map(env)
        for (const d of n.defs) {
          this.visit(d.e, inner, home, rowTables, depth + 1)
          inner.set(d.name.toLowerCase(), d.e)
        }
        this.visit(n.ret, inner, home, rowTables, depth + 1)
        return
      }
      case 'bin': {
        const op = n.op
        if (op === '=' || op === '==' || op === '<>') {
          const lc = this.colOf(n.l, env, home, rowTables)
          const rc = this.colOf(n.r, env, home, rowTables)
          const lv = this.litOf(n.l, env)
          const rv = this.litOf(n.r, env)
          if (lc && rv !== undefined) this.addValue(lc, rv)
          if (rc && lv !== undefined) this.addValue(rc, lv)
          if (lc && rc) {
            this.addLink(lc, rc)
            this.addLink(rc, lc)
          }
        } else if (op === '<' || op === '>' || op === '<=' || op === '>=') {
          // date bounds: the calendar must cover them
          const lc = this.colOf(n.l, env, home, rowTables)
          const rv = this.litOf(n.r, env)
          if (lc && rv instanceof Date) this.addValue(lc, rv)
          const rc = this.colOf(n.r, env, home, rowTables)
          const lv = this.litOf(n.l, env)
          if (rc && lv instanceof Date) this.addValue(rc, lv)
        } else if (op === 'IN') {
          const lc = this.colOf(n.l, env, home, rowTables)
          if (lc) {
            const rows = this.listOf(n.r, env)
            if (rows) {
              for (const r of rows) if (r.length) this.addValue(lc, r[0])
            } else {
              for (const src of this.valueColumnsOf(n.r, env, home).slice(0, 1)) this.addLink(lc, src)
            }
          } else if (n.l.k === 'tuple') {
            // (t[a], t[b]) IN { ("x", 1), ... }
            const cols = n.l.items.map((it) => this.colOf(it, env, home, rowTables))
            const rows = this.listOf(n.r, env)
            if (rows) for (const r of rows) cols.forEach((c, i) => c && r[i] !== undefined && this.addValue(c, r[i]))
          }
        }
        this.visit(n.l, env, home, rowTables, depth + 1)
        this.visit(n.r, env, home, rowTables, depth + 1)
        return
      }
      case 'un':
        this.visit(n.e, env, home, rowTables, depth + 1)
        return
      case 'list':
      case 'tuple':
        for (const it of n.items) this.visit(it, env, home, rowTables, depth + 1)
        return
      case 'call': {
        const a = n.args
        if (n.name === 'SWITCH' && a.length > 2 && literalOf(a[0] ?? null) === true) {
          // SWITCH(TRUE(), cond1, r1, cond2, r2, ..., [else]) — results are visited under their condition
          for (let i = 1; i + 1 < a.length; i += 2) {
            this.visit(a[i] ?? null, env, home, rowTables, depth + 1)
            this.visitGuarded(a[i] ?? null, a[i + 1] ?? null, env, home, rowTables, depth)
          }
          if (a.length % 2 === 0) this.visit(a[a.length - 1] ?? null, env, home, rowTables, depth + 1)
          return
        }
        if (n.name === 'IF' && a.length >= 2) {
          this.visit(a[0] ?? null, env, home, rowTables, depth + 1)
          this.visitGuarded(a[0] ?? null, a[1] ?? null, env, home, rowTables, depth)
          this.visit(a[2] ?? null, env, home, rowTables, depth + 1)
          return
        }
        switch (n.name) {
          case 'SWITCH': {
            const subject = this.colOf(a[0] ?? null, env, home, rowTables)
            if (subject) {
              // SWITCH(x, v1, r1, v2, r2, ..., [else])
              for (let i = 1; i + 1 < a.length; i += 2) {
                const v = this.litOf(a[i] ?? null, env)
                if (v !== undefined) this.addValue(subject, v)
              }
            }
            break
          }
          case 'CONTAINSSTRING':
          case 'CONTAINSSTRINGEXACT': {
            const c = this.colOf(a[0] ?? null, env, home, rowTables)
            const v = this.litOf(a[1] ?? null, env)
            if (c && typeof v === 'string') this.addContains(c, v)
            break
          }
          case 'SEARCH':
          case 'FIND': {
            const c = this.colOf(a[1] ?? null, env, home, rowTables)
            const v = this.litOf(a[0] ?? null, env)
            if (c && typeof v === 'string') this.addContains(c, v)
            break
          }
          case 'TREATAS': {
            const targets = a.slice(1).map((x) => this.colOf(x, env, home, rowTables))
            const rows = this.listOf(a[0] ?? null, env)
            if (rows) {
              for (const r of rows) targets.forEach((t, i) => t && r[i] !== undefined && this.addValue(t, r[i]))
            } else {
              const sources = this.valueColumnsOf(a[0] ?? null, env, home)
              targets.forEach((t, i) => {
                const s = sources[i]
                if (t && s) this.addLink(t, s)
              })
            }
            break
          }
          case 'LOOKUPVALUE': {
            for (let i = 1; i + 1 < a.length; i += 2) {
              const sc = this.colOf(a[i] ?? null, env, home, rowTables)
              if (!sc) continue
              this.markLookupKey(sc)
              const v = this.litOf(a[i + 1] ?? null, env)
              if (v !== undefined) this.addValue(sc, v)
              const vc = this.colOf(a[i + 1] ?? null, env, home, rowTables)
              if (vc) {
                this.addLink(sc, vc)
                this.addLink(vc, sc)
              }
            }
            break
          }
          case 'CONTAINSROW': {
            const rows = this.listOf(a[0] ?? null, env)
            const t = this.valueColumnsOf(a[0] ?? null, env, home)
            if (!rows && t.length === 1) {
              const lc = this.colOf(a[1] ?? null, env, home, rowTables)
              if (lc) this.addLink(lc, t[0])
            }
            break
          }
          default:
            break
        }
        if (ROW_CONTEXT_FNS.has(n.name) && a.length > 1) {
          const t = this.tableOf(n.name === 'TOPN' ? (a[1] ?? null) : (a[0] ?? null), env)
          const inner = t ? [...rowTables, t] : rowTables
          a.forEach((x, i) => this.visit(x, env, home, i === 0 ? rowTables : inner, depth + 1))
        } else {
          for (const x of a) this.visit(x, env, home, rowTables, depth + 1)
        }
        return
      }
      default:
        return
    }
  }

  // --- conditions with polarity and site ---------------------------------------------------------

  /** condition key → condition (deduplicated) */
  readonly conditions = new Map<string, MinedCondition>()
  private condSite: CondSite = 'measure'
  private condSource = ''

  private addCondition(ref: ColRef, op: CondOp, values: MinedValue[], negative: boolean, use: 'filter' | 'test'): void {
    if (this.conditions.size >= MAX_CONDITIONS) return
    const vals = values.filter((v) => v !== null && v !== undefined)
    const key = [
      domainKey(ref.table.name, ref.column.name).toLowerCase(),
      op,
      negative ? '-' : '+',
      use,
      this.condSite,
      this.condSource.toLowerCase(),
      vals.map((v) => (v instanceof Date ? 'd' + v.getTime() : typeof v === 'string' ? 's' + v.toLowerCase() : typeof v + String(v))).sort().join('|')
    ].join('\u0001')
    if (this.conditions.has(key)) return
    this.conditions.set(key, {
      table: ref.table.name,
      column: ref.column.name,
      op,
      polarity: negative ? 'negative' : 'positive',
      values: vals,
      site: this.condSite,
      use,
      ...(this.condSource ? { source: this.condSource } : {})
    })
  }

  /** Record the literal conditions of one expression (see MinedCondition). Expressions the parser rejects are not traced. */
  scanConditions(expr: string | undefined, home: TableDef | undefined, site: CondSite, source: string): void {
    if (!expr || !expr.trim()) return
    const ast = tryParseDax(expr)
    if (!ast) return
    this.condSite = site
    this.condSource = source
    this.cv(ast, new Map(), home, [], 'value', false, 0)
  }

  /**
   * Condition walker. `ctx`: `filter` — the expression restricts rows (CALCULATE / FILTER argument); `test` — a branch
   * condition; `value` — anywhere else (a comparison there is a test computed as a value). `neg`: under NOT ( … ).
   */
  private cv(n: DaxNode | null, env: Env, home: TableDef | undefined, rowTables: TableDef[], ctx: 'filter' | 'test' | 'value', neg: boolean, depth: number): void {
    if (!n || depth > 300) return
    const use = ctx === 'filter' ? 'filter' : 'test'
    switch (n.k) {
      case 'var': {
        const inner: Env = new Map(env)
        for (const d of n.defs) {
          this.cv(d.e, inner, home, rowTables, 'value', false, depth + 1)
          inner.set(d.name.toLowerCase(), d.e)
        }
        this.cv(n.ret, inner, home, rowTables, ctx, neg, depth + 1)
        return
      }
      case 'id': {
        // a variable used as a condition: its definition is the condition (traced through VAR bindings)
        if (ctx === 'value') return
        const bound = env.get(n.name.toLowerCase())
        if (bound) this.cv(bound, env, home, rowTables, ctx, neg, depth + 1)
        return
      }
      case 'un':
        if (n.op === 'NOT') this.cv(n.e, env, home, rowTables, ctx === 'value' ? 'test' : ctx, !neg, depth + 1)
        else this.cv(n.e, env, home, rowTables, ctx, neg, depth + 1)
        return
      case 'bin': {
        const op = n.op
        if (op === '&&' || op === '||') {
          // a disjunction does not require either side (and NOT (a && b) is one): its parts are tests
          const conj = (op === '&&') !== neg
          const inner = ctx === 'filter' && !conj ? 'test' : ctx === 'value' ? 'test' : ctx
          this.cv(n.l, env, home, rowTables, inner, neg, depth + 1)
          this.cv(n.r, env, home, rowTables, inner, neg, depth + 1)
          return
        }
        if (op === '=' || op === '==' || op === '<>') {
          const flip = op === '<>' ? !neg : neg
          const lc = this.colOf(n.l, env, home, rowTables)
          const rc = this.colOf(n.r, env, home, rowTables)
          const blankL = isBlankCall(n.l)
          const blankR = isBlankCall(n.r)
          if (lc && blankR) this.addCondition(lc, 'ISBLANK', [], flip, use)
          else if (rc && blankL) this.addCondition(rc, 'ISBLANK', [], flip, use)
          else {
            const rv = this.litOf(n.r, env)
            const lv = this.litOf(n.l, env)
            if (lc && rv !== undefined) this.addCondition(lc, '=', [rv], flip, use)
            else if (rc && lv !== undefined) this.addCondition(rc, '=', [lv], flip, use)
          }
          this.cv(n.l, env, home, rowTables, 'value', false, depth + 1)
          this.cv(n.r, env, home, rowTables, 'value', false, depth + 1)
          return
        }
        if (op === '<' || op === '>' || op === '<=' || op === '>=') {
          const lc = this.colOf(n.l, env, home, rowTables)
          const rv = this.litOf(n.r, env)
          const rc = this.colOf(n.r, env, home, rowTables)
          const lv = this.litOf(n.l, env)
          const mirror: Record<string, CondOp> = { '<': '>', '>': '<', '<=': '>=', '>=': '<=' }
          if (lc && rv !== undefined && typeof rv !== 'boolean') this.addCondition(lc, op as CondOp, [rv], neg, use)
          else if (rc && lv !== undefined && typeof lv !== 'boolean') this.addCondition(rc, mirror[op], [lv], neg, use)
          this.cv(n.l, env, home, rowTables, 'value', false, depth + 1)
          this.cv(n.r, env, home, rowTables, 'value', false, depth + 1)
          return
        }
        if (op === 'IN') {
          const lc = this.colOf(n.l, env, home, rowTables)
          const rows = lc ? this.listOf(n.r, env) : undefined
          if (lc && rows) {
            const vals = rows.map((r) => r[0]).filter((x): x is MinedValue => x !== undefined)
            if (vals.length) this.addCondition(lc, vals.length === 1 ? '=' : 'IN', vals, neg, use)
          }
          this.cv(n.l, env, home, rowTables, 'value', false, depth + 1)
          this.cv(n.r, env, home, rowTables, 'value', false, depth + 1)
          return
        }
        this.cv(n.l, env, home, rowTables, 'value', false, depth + 1)
        this.cv(n.r, env, home, rowTables, 'value', false, depth + 1)
        return
      }
      case 'list':
      case 'tuple':
        for (const it of n.items) this.cv(it, env, home, rowTables, 'value', false, depth + 1)
        return
      case 'call': {
        const a = n.args
        switch (n.name) {
          case 'CALCULATE':
          case 'CALCULATETABLE':
            this.cv(a[0] ?? null, env, home, rowTables, 'value', false, depth + 1)
            for (let i = 1; i < a.length; i++) this.cv(a[i] ?? null, env, home, [], 'filter', false, depth + 1)
            return
          case 'FILTER': {
            const t = this.tableOf(a[0] ?? null, env)
            this.cv(a[0] ?? null, env, home, rowTables, ctx === 'filter' ? 'filter' : 'value', false, depth + 1)
            this.cv(a[1] ?? null, env, home, t ? [...rowTables, t] : rowTables, 'filter', false, depth + 1)
            return
          }
          case 'KEEPFILTERS':
            this.cv(a[0] ?? null, env, home, rowTables, ctx, neg, depth + 1)
            return
          case 'NOT':
            this.cv(a[0] ?? null, env, home, rowTables, ctx === 'value' ? 'test' : ctx, !neg, depth + 1)
            return
          case 'TREATAS': {
            const rows = this.listOf(a[0] ?? null, env)
            if (rows) {
              a.slice(1).forEach((x, i) => {
                const c = this.colOf(x, env, home, rowTables)
                const vals = rows.map((r) => r[i]).filter((v): v is MinedValue => v !== undefined)
                if (c && vals.length) this.addCondition(c, vals.length === 1 ? '=' : 'IN', vals, false, 'filter')
              })
            }
            for (const x of a) this.cv(x, env, home, rowTables, 'value', false, depth + 1)
            return
          }
          case 'ISBLANK': {
            const c = this.colOf(a[0] ?? null, env, home, rowTables)
            if (c) this.addCondition(c, 'ISBLANK', [], neg, use)
            this.cv(a[0] ?? null, env, home, rowTables, 'value', false, depth + 1)
            return
          }
          case 'CONTAINSSTRING':
          case 'CONTAINSSTRINGEXACT':
          case 'SEARCH':
          case 'FIND': {
            const search = n.name === 'SEARCH' || n.name === 'FIND'
            const c = this.colOf(a[search ? 1 : 0] ?? null, env, home, rowTables)
            const v = this.litOf(a[search ? 0 : 1] ?? null, env)
            if (c && typeof v === 'string' && v.trim()) this.addCondition(c, 'CONTAINS', [v], neg, search ? 'test' : use)
            for (const x of a) this.cv(x, env, home, rowTables, 'value', false, depth + 1)
            return
          }
          case 'IF':
          case 'IF.EAGER':
            this.cv(a[0] ?? null, env, home, rowTables, 'test', false, depth + 1)
            for (let i = 1; i < a.length; i++) this.cv(a[i] ?? null, env, home, rowTables, ctx === 'filter' ? 'test' : 'value', false, depth + 1)
            return
          case 'SWITCH': {
            if (literalOf(a[0] ?? null) === true) {
              for (let i = 1; i < a.length; i++) {
                const isCond = i % 2 === 1 && i + 1 < a.length
                this.cv(a[i] ?? null, env, home, rowTables, isCond ? 'test' : 'value', false, depth + 1)
              }
              return
            }
            const subject = this.colOf(a[0] ?? null, env, home, rowTables)
            if (subject) {
              for (let i = 1; i + 1 < a.length; i += 2) {
                const v = this.litOf(a[i] ?? null, env)
                if (v !== undefined) this.addCondition(subject, '=', [v], false, 'test')
              }
            }
            for (const x of a) this.cv(x, env, home, rowTables, 'value', false, depth + 1)
            return
          }
          default:
            break
        }
        if (ROW_CONTEXT_FNS.has(n.name) && a.length > 1) {
          const t = this.tableOf(n.name === 'TOPN' ? (a[1] ?? null) : (a[0] ?? null), env)
          const inner = t ? [...rowTables, t] : rowTables
          a.forEach((x, i) => this.cv(x, env, home, i === 0 ? rowTables : inner, 'value', false, depth + 1))
        } else for (const x of a) this.cv(x, env, home, rowTables, 'value', false, depth + 1)
        return
      }
      default:
        return
    }
  }

  /** Conditions of report SQ definitions (filters, slicer selections, bookmarks, conditional formatting). */
  scanReportConditions(node: unknown, site: CondSite, source: string): void {
    this.condSite = site
    this.condSource = source
    this.sqConds(node, {}, false, site === 'format' ? 'test' : 'filter', 0)
  }

  private sqConds(node: unknown, aliases: Record<string, string>, neg: boolean, use: 'filter' | 'test', depth: number): void {
    if (!node || typeof node !== 'object' || depth > 80) return
    if (Array.isArray(node)) {
      for (const x of node) this.sqConds(x, aliases, neg, use, depth + 1)
      return
    }
    const o = node as Record<string, any>
    let scope = aliases
    if (Array.isArray(o.From)) {
      scope = { ...aliases }
      for (const f of o.From) if (f && typeof f.Name === 'string' && typeof f.Entity === 'string') scope[f.Name] = f.Entity
    }
    if (o.Not && typeof o.Not === 'object') {
      this.sqConds(o.Not.Expression, scope, !neg, use, depth + 1)
      return
    }
    if (o.Or && typeof o.Or === 'object') {
      const inner = neg ? use : 'test'
      this.sqConds(o.Or.Left, scope, neg, inner, depth + 1)
      this.sqConds(o.Or.Right, scope, neg, inner, depth + 1)
      return
    }
    if (o.And && typeof o.And === 'object') {
      const inner = neg ? 'test' : use
      this.sqConds(o.And.Left, scope, neg, inner, depth + 1)
      this.sqConds(o.And.Right, scope, neg, inner, depth + 1)
      return
    }
    if (o.In && typeof o.In === 'object' && Array.isArray(o.In.Expressions) && Array.isArray(o.In.Values)) {
      const cols = o.In.Expressions.map((e: any) => this.sqColumn(e, scope))
      cols.forEach((c: ColRef | undefined, i: number) => {
        if (!c) return
        const vals = (o.In.Values as any[]).map((t) => (Array.isArray(t) ? this.sqLiteral(t[i]) : undefined)).filter((v): v is MinedValue => v !== undefined)
        const hasNull = (o.In.Values as any[]).some((t) => Array.isArray(t) && t[i]?.Literal && decodeLiteral(t[i].Literal.Value) === null)
        if (vals.length) this.addCondition(c, vals.length === 1 ? '=' : 'IN', vals, neg, use)
        if (hasNull) this.addCondition(c, 'ISBLANK', [], neg, use)
      })
      return
    }
    if (o.Comparison && typeof o.Comparison === 'object') {
      const kind = o.Comparison.ComparisonKind ?? 0
      const ops: CondOp[] = ['=', '>', '>=', '<=', '<']
      const lc = this.sqColumn(o.Comparison.Left, scope)
      const rv = this.sqLiteral(o.Comparison.Right)
      const isNull = o.Comparison.Right?.Literal && decodeLiteral(o.Comparison.Right.Literal.Value) === null
      if (lc && isNull && kind === 0) this.addCondition(lc, 'ISBLANK', [], neg, use)
      else if (lc && rv !== undefined && ops[kind]) this.addCondition(lc, ops[kind], [rv], neg, use)
      return
    }
    for (const kind of ['Contains', 'StartsWith', 'EndsWith']) {
      const cond = o[kind]
      if (cond && typeof cond === 'object') {
        const c = this.sqColumn(cond.Left, scope)
        const v = this.sqLiteral(cond.Right)
        if (c && typeof v === 'string' && v.trim()) this.addCondition(c, 'CONTAINS', [v], neg, use)
        return
      }
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') this.sqConds(v, scope, neg, use, depth + 1)
  }

  // --- report SQ ------------------------------------------------------------------------------

  scanReportJson(root: unknown): void {
    this.walkJson(root, {}, 0)
  }

  private sqColumn(expr: any, aliases: Record<string, string>): ColRef | undefined {
    const col = expr?.Column
    if (!col || typeof col.Property !== 'string') return undefined
    const sr = col.Expression?.SourceRef
    const entity: string | undefined = sr?.Entity ?? (sr?.Source !== undefined ? aliases[sr.Source] ?? sr.Source : undefined)
    if (!entity) return undefined
    const t = this.idx.table(entity)
    const c = t && this.idx.column(t, col.Property)
    return t && c ? { table: t, column: c } : undefined
  }

  private sqLiteral(expr: any): MinedValue | undefined {
    if (!expr || typeof expr !== 'object' || !expr.Literal) return undefined
    const v = decodeLiteral(expr.Literal.Value)
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
    if (v instanceof Date && Number.isFinite(v.getTime())) return v
    return undefined
  }

  private walkJson(node: unknown, aliases: Record<string, string>, depth: number): void {
    if (!node || typeof node !== 'object' || depth > 80) return
    if (Array.isArray(node)) {
      for (const x of node) this.walkJson(x, aliases, depth + 1)
      return
    }
    const o = node as Record<string, any>
    let scope = aliases
    if (Array.isArray(o.From)) {
      scope = { ...aliases }
      for (const f of o.From) if (f && typeof f.Name === 'string' && typeof f.Entity === 'string') scope[f.Name] = f.Entity
    }
    if (o.In && typeof o.In === 'object' && Array.isArray(o.In.Expressions) && Array.isArray(o.In.Values)) {
      const cols = o.In.Expressions.map((e: any) => this.sqColumn(e, scope))
      for (const tuple of o.In.Values) {
        if (!Array.isArray(tuple)) continue
        tuple.forEach((lit: any, i: number) => {
          const c = cols[i]
          const v = this.sqLiteral(lit)
          if (c && v !== undefined) this.addValue(c, v)
        })
      }
    }
    if (o.Comparison && typeof o.Comparison === 'object') {
      const kind = o.Comparison.ComparisonKind ?? 0
      const { Left, Right } = o.Comparison
      const lc = this.sqColumn(Left, scope)
      const rc = this.sqColumn(Right, scope)
      const lv = this.sqLiteral(Left)
      const rv = this.sqLiteral(Right)
      // equality: any literal; range comparisons: date bounds only (calendar coverage)
      if (lc && rv !== undefined && (kind === 0 || rv instanceof Date)) this.addValue(lc, rv)
      if (rc && lv !== undefined && (kind === 0 || lv instanceof Date)) this.addValue(rc, lv)
    }
    if (o.Between && typeof o.Between === 'object') {
      const c = this.sqColumn(o.Between.Expression, scope)
      for (const b of [o.Between.LowerBound, o.Between.UpperBound]) {
        const v = this.sqLiteral(b)
        if (c && v instanceof Date) this.addValue(c, v)
      }
    }
    for (const kind of ['Contains', 'StartsWith', 'EndsWith']) {
      const cond = o[kind]
      if (cond && typeof cond === 'object') {
        const c = this.sqColumn(cond.Left, scope)
        const v = this.sqLiteral(cond.Right)
        if (c && typeof v === 'string') this.addContains(c, v)
      }
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') this.walkJson(v, scope, depth + 1)
  }

  // --- conjunctions ----------------------------------------------------------------------------

  readonly conjunctions = new Map<string, Cond[]>()
  private readonly measureCache = new Map<string, { ast?: DaxNode; home: TableDef } | null>()
  private readonly expanded = new Set<string>()

  private measureAst(name: string): { ast?: DaxNode; home: TableDef } | null {
    const k = name.toLowerCase()
    if (this.measureCache.has(k)) return this.measureCache.get(k)!
    let hit: { ast?: DaxNode; home: TableDef } | null = null
    for (const t of this.model.tables) {
      const m = t.measures.find((x) => x.name.toLowerCase() === k)
      if (m) {
        hit = { ast: tryParseDax(m.expression), home: t }
        break
      }
    }
    this.measureCache.set(k, hit)
    return hit
  }

  private emitConj(conds: Cond[]): void {
    if (this.conjunctions.size >= MAX_CONJUNCTIONS) return
    const byCol = new Map<string, Cond>()
    for (const c of conds) {
      if (!c.values.length) continue
      const k = domainKey(c.ref.table.name, c.ref.column.name)
      const prev = byCol.get(k)
      if (!prev) byCol.set(k, { ref: c.ref, values: [...c.values] })
      else {
        const inter = prev.values.filter((v) => c.values.some((w) => sameValue(v, w)))
        if (!inter.length) return // contradictory (e.g. a visual filter outside the measure's filter) — nothing to seed
        prev.values = inter
      }
    }
    if (byCol.size < 2) return
    const key = [...byCol.entries()]
      .map(([k, c]) => `${k}=${c.values.map((v) => (v instanceof Date ? v.getTime() : String(v).toLowerCase())).sort().join('|')}`)
      .sort()
      .join('&')
    if (!this.conjunctions.has(key)) this.conjunctions.set(key, [...byCol.values()])
  }

  /** Equality conditions expressed by a filter argument (boolean expression or filter table). */
  condsOfFilter(n: DaxNode | null, env: Env, home: TableDef | undefined, rowTables: TableDef[], depth = 0): Cond[] {
    if (!n || depth > 16) return []
    switch (n.k) {
      case 'bin': {
        if (n.op === '&&') return [...this.condsOfFilter(n.l, env, home, rowTables, depth + 1), ...this.condsOfFilter(n.r, env, home, rowTables, depth + 1)]
        if (n.op === '=' || n.op === '==') {
          const lc = this.colOf(n.l, env, home, rowTables)
          const rv = this.litOf(n.r, env)
          if (lc && rv !== undefined) return [{ ref: lc, values: [rv] }]
          const rc = this.colOf(n.r, env, home, rowTables)
          const lv = this.litOf(n.l, env)
          if (rc && lv !== undefined) return [{ ref: rc, values: [lv] }]
          return []
        }
        if (n.op === 'IN') {
          const lc = this.colOf(n.l, env, home, rowTables)
          const rows = this.listOf(n.r, env)
          if (lc && rows) return [{ ref: lc, values: rows.map((r) => r[0]).filter((x) => x !== undefined) }]
        }
        return []
      }
      case 'id': {
        const bound = env.get(n.name.toLowerCase())
        return bound ? this.condsOfFilter(bound, env, home, rowTables, depth + 1) : []
      }
      case 'call': {
        const a = n.args
        switch (n.name) {
          case 'KEEPFILTERS':
            return this.condsOfFilter(a[0] ?? null, env, home, rowTables, depth + 1)
          case 'FILTER': {
            const t = this.tableOf(a[0] ?? null, env)
            return [...this.condsOfFilter(a[0] ?? null, env, home, rowTables, depth + 1), ...this.condsOfFilter(a[1] ?? null, env, home, t ? [...rowTables, t] : rowTables, depth + 1)]
          }
          case 'CALCULATETABLE': {
            const out: Cond[] = []
            for (let i = 1; i < a.length; i++) out.push(...this.condsOfFilter(a[i] ?? null, env, home, rowTables, depth + 1))
            return out
          }
          case 'TREATAS': {
            const rows = this.listOf(a[0] ?? null, env)
            if (!rows) return []
            const out: Cond[] = []
            a.slice(1).forEach((x, i) => {
              const c = this.colOf(x, env, home, rowTables)
              if (c) out.push({ ref: c, values: rows.map((r) => r[i]).filter((v) => v !== undefined) })
            })
            return out
          }
          case 'CONTAINSSTRING':
          case 'CONTAINSSTRINGEXACT': {
            const c = this.colOf(a[0] ?? null, env, home, rowTables)
            const v = this.litOf(a[1] ?? null, env)
            return c && typeof v === 'string' ? [{ ref: c, values: [], contains: [v] }] : []
          }
          case 'SEARCH':
          case 'FIND': {
            const c = this.colOf(a[1] ?? null, env, home, rowTables)
            const v = this.litOf(a[0] ?? null, env)
            return c && typeof v === 'string' ? [{ ref: c, values: [], contains: [v] }] : []
          }
          default:
            return []
        }
      }
      default:
        return []
    }
  }

  /**
   * Walk an expression collecting the filter conditions that hold together: CALCULATE filter args are
   * ANDed with the enclosing ones, measure references are expanded (bounded) under the current filters.
   */
  conj(n: DaxNode | null, env: Env, home: TableDef | undefined, outer: Cond[], measureDepth: number, depth = 0): void {
    if (!n || depth > 300 || this.conjunctions.size >= MAX_CONJUNCTIONS) return
    switch (n.k) {
      case 'var': {
        const inner: Env = new Map(env)
        for (const d of n.defs) {
          this.conj(d.e, inner, home, outer, measureDepth, depth + 1)
          inner.set(d.name.toLowerCase(), d.e)
        }
        this.conj(n.ret, inner, home, outer, measureDepth, depth + 1)
        return
      }
      case 'col': {
        if (n.table !== undefined || !outer.length || measureDepth >= 4) return
        if (this.idx.resolve(undefined, n.column, home, []) && !this.idx.measureNames.has(n.column.toLowerCase())) return
        const m = this.measureAst(n.column)
        if (!m?.ast) return
        const key = `${n.column.toLowerCase()}|${outer.map((c) => domainKey(c.ref.table.name, c.ref.column.name) + c.values.map(String).join(',')).join('&')}`
        if (this.expanded.has(key)) return
        this.expanded.add(key)
        this.conj(m.ast, new Map(), m.home, outer, measureDepth + 1, 0)
        return
      }
      case 'call': {
        const a = n.args
        if (n.name === 'CALCULATE' || n.name === 'CALCULATETABLE') {
          const conds = [...outer]
          for (let i = 1; i < a.length; i++) conds.push(...this.condsOfFilter(a[i] ?? null, env, home, []).filter((c) => c.values.length))
          if (conds.length > outer.length) this.emitConj(conds)
          this.conj(a[0] ?? null, env, home, conds, measureDepth, depth + 1)
          for (let i = 1; i < a.length; i++) this.conj(a[i] ?? null, env, home, outer, measureDepth, depth + 1)
          return
        }
        if (n.name === 'FILTER' && a.length >= 2) {
          const t = this.tableOf(a[0] ?? null, env)
          const conds = [...outer, ...this.condsOfFilter(a[1] ?? null, env, home, t ? [t] : []).filter((c) => c.values.length)]
          if (conds.length > outer.length) this.emitConj(conds)
          this.conj(a[0] ?? null, env, home, outer, measureDepth, depth + 1)
          return
        }
        for (const x of a) this.conj(x, env, home, outer, measureDepth, depth + 1)
        return
      }
      case 'bin':
        this.conj(n.l, env, home, outer, measureDepth, depth + 1)
        this.conj(n.r, env, home, outer, measureDepth, depth + 1)
        return
      case 'un':
        this.conj(n.e, env, home, outer, measureDepth, depth + 1)
        return
      case 'list':
      case 'tuple':
        for (const x of n.items) this.conj(x, env, home, outer, measureDepth, depth + 1)
        return
      default:
        return
    }
  }

  conjMeasure(name: string, outer: Cond[]): void {
    const m = this.measureAst(name)
    if (!m?.ast) return
    if (outer.length) {
      const key = `${name.toLowerCase()}|${outer.map((c) => domainKey(c.ref.table.name, c.ref.column.name) + c.values.map(String).join(',')).join('&')}`
      if (this.expanded.has(key)) return
      this.expanded.add(key)
    }
    this.conj(m.ast, new Map(), m.home, outer, outer.length ? 1 : 0)
  }

  // --- ratio implications ---------------------------------------------------------------------

  readonly implications = new Map<string, Implication>()

  /** `CALCULATE(COUNTROWS(T) | SUM/COUNT/DISTINCTCOUNT(T[c]) | [measure], filters…)` → the table and its equality filters. */
  private filteredAgg(n: DaxNode | null, env: Env, home: TableDef | undefined, depth = 0): { table: TableDef; conds: Cond[] } | undefined {
    if (!n || depth > 8) return undefined
    switch (n.k) {
      case 'id': {
        const b = env.get(n.name.toLowerCase())
        return b ? this.filteredAgg(b, env, home, depth + 1) : undefined
      }
      case 'var': {
        const inner: Env = new Map(env)
        for (const d of n.defs) inner.set(d.name.toLowerCase(), d.e)
        return this.filteredAgg(n.ret, inner, home, depth + 1)
      }
      case 'col': {
        if (n.table !== undefined || !this.idx.measureNames.has(n.column.toLowerCase())) return undefined
        const m = this.measureAst(n.column)
        return m?.ast ? this.filteredAgg(m.ast, new Map(), m.home, depth + 1) : undefined
      }
      case 'call': {
        const a = n.args
        if (n.name === 'CALCULATE') {
          const inner = this.filteredAgg(a[0] ?? null, env, home, depth + 1)
          if (!inner) return undefined
          const conds = [...inner.conds]
          for (let i = 1; i < a.length; i++) {
            const cs = this.condsOfFilter(a[i] ?? null, env, home, [])
            if (!cs.length) return undefined // a filter we can't read (ALL, dates…): no implication
            conds.push(...cs)
          }
          return { table: inner.table, conds }
        }
        if (n.name === 'COUNTROWS') {
          const t = this.tableOf(a[0] ?? null, env)
          return t ? { table: t, conds: [] } : undefined
        }
        if (['SUM', 'COUNT', 'COUNTA', 'DISTINCTCOUNT', 'DISTINCTCOUNTNOBLANK'].includes(n.name)) {
          const c = this.colOf(a[0] ?? null, env, home, [])
          return c ? { table: c.table, conds: [] } : undefined
        }
        return undefined
      }
      default:
        return undefined
    }
  }

  private ratio(num: DaxNode | null, den: DaxNode | null, env: Env, home: TableDef | undefined): void {
    const a = this.filteredAgg(num, env, home)
    const b = this.filteredAgg(den, env, home)
    if (!a || !b || a.table !== b.table || !a.conds.length || !b.conds.length) return
    const t = a.table
    if ([...a.conds, ...b.conds].some((c) => c.ref.table !== t || !c.values.length)) return
    const key = (c: Cond) => c.ref.column.name.toLowerCase()
    const when = new Map(a.conds.map((c) => [key(c), c]))
    const then: Implication['then'] = []
    for (const c of b.conds) {
      const w = when.get(key(c))
      if (w) {
        if (!w.values.some((v) => c.values.some((x) => sameValue(v, x)))) return // contradictory: part and whole disjoint
        continue
      }
      then.push({ column: c.ref.column.name, value: c.values[0] })
    }
    if (!then.length) return
    const imp: Implication = { table: t.name, when: [...when.values()].map((c) => ({ column: c.ref.column.name, values: c.values })), then }
    const k = JSON.stringify(imp, (_k, v) => (v instanceof Date ? v.getTime() : v))
    if (!this.implications.has(k)) this.implications.set(k, imp)
  }

  /** Find DIVIDE(a, b) and a / b in an expression. */
  scanRatios(n: DaxNode | null, env: Env, home: TableDef | undefined, depth = 0): void {
    if (!n || depth > 200 || this.implications.size >= MAX_CONJUNCTIONS) return
    switch (n.k) {
      case 'var': {
        const inner: Env = new Map(env)
        for (const d of n.defs) {
          this.scanRatios(d.e, inner, home, depth + 1)
          inner.set(d.name.toLowerCase(), d.e)
        }
        this.scanRatios(n.ret, inner, home, depth + 1)
        return
      }
      case 'call':
        if (n.name === 'DIVIDE' && n.args.length >= 2) this.ratio(n.args[0] ?? null, n.args[1] ?? null, env, home)
        for (const x of n.args) this.scanRatios(x, env, home, depth + 1)
        return
      case 'bin':
        if (n.op === '/') this.ratio(n.l, n.r, env, home)
        this.scanRatios(n.l, env, home, depth + 1)
        this.scanRatios(n.r, env, home, depth + 1)
        return
      case 'un':
        this.scanRatios(n.e, env, home, depth + 1)
        return
      default:
        return
    }
  }

  ratioMeasure(name: string): void {
    const m = this.measureAst(name)
    if (m?.ast) this.scanRatios(m.ast, new Map(), m.home)
  }

  /** Conditions of an SQ filter (`{ From, Where }`): In / equality Comparison / And. */
  condsOfSq(filter: any): Cond[] {
    if (!filter || typeof filter !== 'object' || !Array.isArray(filter.Where)) return []
    const aliases: Record<string, string> = {}
    for (const f of filter.From ?? []) if (f && typeof f.Name === 'string' && typeof f.Entity === 'string') aliases[f.Name] = f.Entity
    const out: Cond[] = []
    const walk = (c: any, depth: number): void => {
      if (!c || typeof c !== 'object' || depth > 20) return
      if (c.And) {
        walk(c.And.Left, depth + 1)
        walk(c.And.Right, depth + 1)
        return
      }
      if (c.In && Array.isArray(c.In.Expressions) && Array.isArray(c.In.Values)) {
        const cols = c.In.Expressions.map((e: any) => this.sqColumn(e, aliases))
        cols.forEach((ref: ColRef | undefined, i: number) => {
          if (!ref) return
          const values = (c.In.Values as any[]).map((t) => (Array.isArray(t) ? this.sqLiteral(t[i]) : undefined)).filter((v): v is MinedValue => v !== undefined)
          if (values.length) out.push({ ref, values })
        })
        return
      }
      if (c.Comparison && (c.Comparison.ComparisonKind ?? 0) === 0) {
        const lc = this.sqColumn(c.Comparison.Left, aliases)
        const rv = this.sqLiteral(c.Comparison.Right)
        if (lc && rv !== undefined) out.push({ ref: lc, values: [rv] })
      }
    }
    for (const w of filter.Where) walk(w?.Condition, 0)
    return out
  }

  /** Report-level conjunctions: report + page + slicer + visual filters around each visual's measures. */
  scanReportConjunctions(report: NonNullable<ProjectDocument['report']>): void {
    const filtersOf = (json: any): any[] => (Array.isArray(json?.filterConfig?.filters) ? json.filterConfig.filters.map((f: any) => f?.filter).filter(Boolean) : [])
    const reportConds = filtersOf(report.report).flatMap((f) => this.condsOfSq(f))
    for (const page of report.pages) {
      const pageConds = [...reportConds, ...filtersOf(page.json).flatMap((f) => this.condsOfSq(f))]
      for (const v of page.visuals) {
        const general = v.json?.visual?.objects?.general
        if (Array.isArray(general)) for (const g of general) pageConds.push(...this.condsOfSq(g?.properties?.filter?.filter))
      }
      for (const v of page.visuals) {
        const vconds = [...pageConds, ...filtersOf(v.json).flatMap((f) => this.condsOfSq(f))]
        const where = v.json?.visual?.query?.Where ?? v.json?.visual?.query?.queryState?.Where
        if (Array.isArray(where)) vconds.push(...this.condsOfSq({ From: v.json?.visual?.query?.From, Where: where }))
        const measures = new Set<string>()
        collectMeasureRefs(v.json?.visual, measures)
        if (vconds.length) this.emitConj(vconds)
        for (const m of measures) this.conjMeasure(m, vconds)
      }
    }
  }

  // --- calculated-column inversion ------------------------------------------------------------

  /** Push values mined for calculated columns back to the columns they are computed from. */
  propagateCalculated(): void {
    for (let round = 0; round < 3; round++) {
      let changed = false
      for (const t of this.model.tables) {
        for (const c of t.columns) {
          if (c.kind !== 'calculated' || !c.expression) continue
          const d = this.domains.get(domainKey(t.name, c.name))
          if (!d || (!d.values.length && !d.contains.length)) continue
          const ast = tryParseDax(c.expression)
          if (!ast) continue
          const before = this.domainSize()
          this.invert(ast, new Map(), t, d.values, d.contains, { table: t, column: c }, 0)
          if (this.domainSize() !== before) changed = true
        }
      }
      if (!changed) break
    }
  }

  private domainSize(): number {
    let n = 0
    for (const d of this.domains.values()) n += d.values.length + d.contains.length
    return n
  }

  private invert(n: DaxNode | null, env: Env, home: TableDef, vals: MinedValue[], contains: string[], self: ColRef, depth: number): void {
    if (!n || depth > 30) return
    const has = (v: MinedValue | undefined): boolean => v !== undefined && vals.some((x) => sameValue(x, v))
    const seedConds = (cond: DaxNode | null): void => {
      for (const c of this.condsOfFilter(cond, env, home, [])) {
        for (const v of c.values) this.addValue(c.ref, v)
        for (const s of c.contains ?? []) this.addContains(c.ref, s)
      }
    }
    switch (n.k) {
      case 'col': {
        const r = this.idx.resolve(n.table, n.column, home, [])
        if (!r || (r.table === self.table && r.column === self.column)) return
        for (const v of vals) this.addValue(r, v)
        for (const s of contains) this.addContains(r, s)
        return
      }
      case 'id': {
        const bound = env.get(n.name.toLowerCase())
        if (bound) this.invert(bound, env, home, vals, contains, self, depth + 1)
        return
      }
      case 'var': {
        const inner: Env = new Map(env)
        for (const d of n.defs) inner.set(d.name.toLowerCase(), d.e)
        this.invert(n.ret, inner, home, vals, contains, self, depth + 1)
        return
      }
      case 'call': {
        const a = n.args
        switch (n.name) {
          case 'COALESCE':
            for (const x of a) this.invert(x, env, home, vals, contains, self, depth + 1)
            return
          case 'IF': {
            const thenV = this.litOf(a[1] ?? null, env)
            if (has(thenV)) seedConds(a[0] ?? null)
            if (thenV === undefined) this.invert(a[1] ?? null, env, home, vals, contains, self, depth + 1)
            if (this.litOf(a[2] ?? null, env) === undefined) this.invert(a[2] ?? null, env, home, vals, contains, self, depth + 1)
            return
          }
          case 'SWITCH': {
            const subjectTrue = literalOf(a[0] ?? null) === true
            for (let i = 1; i + 1 < a.length; i += 2) {
              const r = this.litOf(a[i + 1] ?? null, env)
              if (r === undefined) this.invert(a[i + 1] ?? null, env, home, vals, contains, self, depth + 1)
              else if (has(r)) {
                if (subjectTrue) seedConds(a[i] ?? null)
                else {
                  const v = this.litOf(a[i] ?? null, env)
                  if (v !== undefined) this.invert(a[0] ?? null, env, home, [v], [], self, depth + 1)
                }
              }
            }
            if (a.length % 2 === 0 && this.litOf(a[a.length - 1] ?? null, env) === undefined) this.invert(a[a.length - 1] ?? null, env, home, vals, contains, self, depth + 1)
            return
          }
          case 'CALCULATE':
          case 'MAX':
          case 'MIN':
          case 'SELECTEDVALUE':
          case 'FIRSTNONBLANK':
          case 'LASTNONBLANK':
          case 'RELATED':
          case 'TRIM':
          case 'UPPER':
          case 'LOWER':
          case 'VALUES':
          case 'LOOKUPVALUE':
            this.invert(a[0] ?? null, env, home, vals, contains, self, depth + 1)
            return
          case 'MAXX':
          case 'MINX':
            this.invert(a[1] ?? null, env, home, vals, contains, self, depth + 1)
            return
          default:
            return
        }
      }
      default:
        return
    }
  }

  // --- links ------------------------------------------------------------------------------------

  /** Copy literal rows of calculated tables into linked columns (relationships + DAX links). */
  resolveLinks(): void {
    const literalCache = new Map<TableDef, Map<string, Array<string | number | boolean | null>> | undefined>()
    const literalsOf = (ref: ColRef): Array<string | number | boolean | null> | undefined => {
      if (!literalCache.has(ref.table)) literalCache.set(ref.table, calculatedTableLiterals(ref.table))
      return literalCache.get(ref.table)?.get(ref.column.name)
    }
    const pairs: Array<{ target: ColRef; source: ColRef; guards: Guard[] }> = [...this.links]
    for (const r of this.model.relationships) {
      const ft = this.idx.table(r.fromTable)
      const tt = this.idx.table(r.toTable)
      const fc = ft && this.idx.column(ft, r.fromColumn)
      const tc = tt && this.idx.column(tt, r.toColumn)
      if (!ft || !tt || !fc || !tc) continue
      pairs.push({ target: { table: ft, column: fc }, source: { table: tt, column: tc }, guards: [] })
      pairs.push({ target: { table: tt, column: tc }, source: { table: ft, column: fc }, guards: [] })
    }
    for (const { target, source, guards } of pairs) {
      if (isCalculatedTable(target.table)) continue
      const vals = literalsOf(source)
      if (!vals) continue
      // keep only the literal rows that satisfy the branch conditions on the same calculated table
      const rowGuards = guards
        .filter((g) => g.ref.table === source.table)
        .map((g) => ({ values: literalsOf(g.ref), accept: g.values }))
        .filter((g): g is { values: Array<string | number | boolean | null>; accept: MinedValue[] } => !!g.values)
      const d = this.domain(target)
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i]
        if (v === null || (typeof v === 'string' && v.trim() === '')) continue
        if (!rowGuards.every((g) => g.values[i] !== null && g.values[i] !== undefined && g.accept.some((a) => sameValue(a, g.values[i] as MinedValue)))) continue
        if (!d.values.some((x) => sameValue(x, v))) d.values.push(v)
        if (!d.linked.some((x) => sameValue(x, v))) d.linked.push(v)
      }
    }
  }
}

function collectMeasureRefs(node: unknown, out: Set<string>, depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 60) return
  if (Array.isArray(node)) {
    for (const x of node) collectMeasureRefs(x, out, depth + 1)
    return
  }
  const o = node as Record<string, any>
  if (o.Measure && typeof o.Measure.Property === 'string') out.add(o.Measure.Property)
  for (const v of Object.values(o)) if (v && typeof v === 'object') collectMeasureRefs(v, out, depth + 1)
}

function sameValue(a: MinedValue, b: MinedValue): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase()
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  return a === b
}

/** DATE(y, m, d) / DATEVALUE("yyyy-mm-dd") / DT"yyyy-mm-dd" style literal dates. */
function dateLiteralOf(n: DaxNode): Date | undefined {
  if (n.k !== 'call') return undefined
  if (n.name === 'DATE' && n.args.length === 3) {
    const parts = n.args.map((a) => literalOf(a))
    if (parts.every((x) => typeof x === 'number' && Number.isInteger(x))) {
      const [y, m, d] = parts as number[]
      if (y >= 1900 && y <= 2200) return makeDate(y, m, d)
    }
  }
  if ((n.name === 'DATEVALUE' || n.name === 'DT') && n.args.length === 1) {
    const s = literalOf(n.args[0])
    const m = typeof s === 'string' ? /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s.trim()) : null
    if (m) return makeDate(+m[1], +m[2], +m[3])
  }
  return undefined
}

export interface MineOptions {
  /** scan project.report (default true) */
  report?: boolean
}

/**
 * Mine value domains for every column referenced with literals in DAX expressions and report filters.
 * Keys: `domainKey(table, column)` with the model's spelling. String matching is case-insensitive
 * (DAX semantics), first spelling wins.
 */
export function mineValueDomains(project: Pick<ProjectDocument, 'model' | 'report'>, opts: MineOptions = {}): Map<string, MinedDomain> {
  return mineModel(project, opts).domains
}

/** Value domains + conjunctions (conditions that must hold together on the same rows). */
export function mineModel(project: Pick<ProjectDocument, 'model' | 'report'>, opts: MineOptions = {}): MineResult {
  const model = project.model
  const miner = new Miner(model)
  // conditions with polarity and site (what each literal is used for: see MinedCondition)
  for (const t of model.tables) {
    for (const m of t.measures) {
      for (const e of [m.expression, m.formatStringDefinition?.expression, m.detailRowsDefinition, m.kpi?.targetExpression, m.kpi?.statusExpression, m.kpi?.trendExpression]) miner.scanConditions(e, t, 'measure', m.name)
    }
    for (const c of t.columns) if (c.kind === 'calculated') miner.scanConditions(c.expression, t, 'calcColumn', `${t.name}[${c.name}]`)
    for (const p of t.partitions) if (p.sourceType === 'calculated' && !/\bNAMEOF\s*\(/i.test(p.expression ?? '')) miner.scanConditions(p.expression, t, 'calcTable', t.name)
    const cg = t.calculationGroup
    if (cg) {
      for (const it of cg.items) miner.scanConditions(it.expression, t, 'calcItem', it.name)
      miner.scanConditions(cg.noSelectionExpression, t, 'calcItem', t.name)
      miner.scanConditions(cg.multipleOrEmptySelectionExpression, t, 'calcItem', t.name)
    }
  }
  for (const role of model.roles ?? []) {
    for (const tp of role.tablePermissions) {
      const home = model.tables.find((t) => t.name.toLowerCase() === tp.table.toLowerCase())
      miner.scanConditions(tp.filterExpression, home, 'rls', role.name)
    }
  }
  if (opts.report !== false && project.report) {
    const r = project.report
    const filterCards = (json: any): unknown => json?.filterConfig
    miner.scanReportConditions(filterCards(r.report), 'filter', 'report')
    for (const p of r.pages) {
      miner.scanReportConditions(filterCards(p.json), 'filter', p.name)
      for (const v of p.visuals) {
        const vis = v.json?.visual
        miner.scanReportConditions(filterCards(v.json), 'filter', v.name)
        miner.scanReportConditions(vis?.query?.Where, 'filter', v.name)
        const general = Array.isArray(vis?.objects?.general) ? vis.objects.general : []
        for (const g of general) miner.scanReportConditions(g?.properties?.filter, 'slicer', v.name)
        // conditional formatting: rules anywhere else in the formatting objects
        const { general: _general, ...rest } = vis?.objects ?? {}
        void _general
        miner.scanReportConditions(rest, 'format', v.name)
        miner.scanReportConditions(vis?.visualContainerObjects, 'format', v.name)
      }
    }
    for (const b of r.bookmarks ?? []) miner.scanReportConditions(b.json, 'bookmark', b.name ?? 'bookmark')
    for (const ent of (r.reportExtensions as any)?.entities ?? []) {
      const home = model.tables.find((t) => t.name.toLowerCase() === String(ent?.name ?? '').toLowerCase())
      for (const m of ent?.measures ?? []) if (typeof m?.expression === 'string') miner.scanConditions(m.expression, home, 'measure', String(m.name ?? ''))
    }
  }
  for (const t of model.tables) {
    for (const m of t.measures) {
      miner.scanDax(m.expression, t)
      miner.scanDax(m.formatStringDefinition?.expression, t)
      miner.scanDax(m.detailRowsDefinition, t)
      if (m.kpi) {
        miner.scanDax(m.kpi.targetExpression, t)
        miner.scanDax(m.kpi.statusExpression, t)
        miner.scanDax(m.kpi.trendExpression, t)
      }
    }
    for (const c of t.columns) if (c.kind === 'calculated') miner.scanDax(c.expression, t)
    for (const p of t.partitions) if (p.sourceType === 'calculated' && !/\bNAMEOF\s*\(/i.test(p.expression ?? '')) miner.scanDax(p.expression, t)
    const cg = t.calculationGroup
    if (cg) {
      for (const it of cg.items) {
        miner.scanDax(it.expression, t)
        miner.scanDax(it.formatStringDefinition?.expression, t)
      }
      miner.scanDax(cg.noSelectionExpression, t)
      miner.scanDax(cg.multipleOrEmptySelectionExpression, t)
    }
  }
  for (const role of model.roles ?? []) {
    for (const tp of role.tablePermissions) {
      const home = model.tables.find((t) => t.name.toLowerCase() === tp.table.toLowerCase())
      miner.scanDax(tp.filterExpression, home)
    }
  }
  if (opts.report !== false && project.report) {
    const r = project.report
    miner.scanReportJson(r.report)
    for (const p of r.pages) {
      miner.scanReportJson(p.json)
      for (const v of p.visuals) miner.scanReportJson(v.json)
    }
    for (const b of r.bookmarks ?? []) miner.scanReportJson(b.json)
    if (r.reportExtensions) {
      miner.scanReportJson(r.reportExtensions)
      // report-level measures: { entities: [{ name, measures: [{ name, expression }] }] }
      for (const ent of (r.reportExtensions as any)?.entities ?? []) {
        const home = model.tables.find((t) => t.name.toLowerCase() === String(ent?.name ?? '').toLowerCase())
        for (const m of ent?.measures ?? []) if (typeof m?.expression === 'string') miner.scanDax(m.expression, home)
      }
    }
  }
  miner.propagateCalculated()
  miner.resolveLinks()
  // conjunctions: every measure on its own, then report filters around the measures visuals show
  for (const t of model.tables) for (const m of t.measures) miner.conjMeasure(m.name, [])
  for (const t of model.tables) for (const m of t.measures) miner.ratioMeasure(m.name)
  if (opts.report !== false && project.report) miner.scanReportConjunctions(project.report)
  // drop empty domains (a column may have been touched by a link with no literal rows)
  for (const [k, d] of miner.domains) if (!d.values.length && !d.contains.length && !d.lookupKey) miner.domains.delete(k)
  // conjunction values are domain values too (seeding writes them)
  const conjunctions: Conjunction[] = []
  for (const conds of miner.conjunctions.values()) {
    conjunctions.push({ conds: conds.map((c) => ({ table: c.ref.table.name, column: c.ref.column.name, values: c.values })) })
  }
  const result: MineResult = { domains: miner.domains, conjunctions, implications: [...miner.implications.values()], conditions: [...miner.conditions.values()] }
  // what was mined for calculated tables (UNION / SELECTCOLUMNS / FILTER over imported tables) also applies to
  // the imported columns those tables are computed from — the only ones the generator writes
  propagateLineage(model, result, domainKey)
  result.conditions.push(...conditionsThroughLineage(model, result.conditions))
  return result
}

/**
 * Conditions on columns of calculated tables that combine imported ones (UNION / SELECTCOLUMNS / FILTER…, see
 * ./synthetic-lineage.ts) also hold on the imported columns they are copied from (a scaled copy is not followed).
 */
function conditionsThroughLineage(model: SemanticModel, conds: MinedCondition[]): MinedCondition[] {
  const lineage = modelLineage(model)
  if (!lineage.size) return []
  const out: MinedCondition[] = []
  for (const c of conds) {
    for (const b of lineage.get(c.table.toLowerCase()) ?? []) {
      const lc = b.columns.get(c.column.toLowerCase())
      if (!lc?.source || lc.scale) continue
      const t = model.tables.find((x) => x.name.toLowerCase() === b.table.toLowerCase())
      const col = t?.columns.find((x) => x.name.toLowerCase() === lc.source!.toLowerCase())
      if (t && col) out.push({ ...c, table: t.name, column: col.name })
    }
  }
  return out
}
