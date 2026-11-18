/**
 * A small in-memory QueryEngine for unit tests and the visuals dev gallery.
 *
 * It models a star schema: one fact table whose rows are JS objects, plus optional dimension
 * tables joined to the fact by a key column. Measures are JS reducers over the filtered fact
 * rows, so totals/subtotals are genuine re-evaluations (like DAX), not sums of cells.
 * It honors SQ filters (via ./sqEval), SUMMARIZECOLUMNS-style blank-row removal, sort, limit,
 * highlights, distinctValues with search and sort-by columns.
 *
 * Not a DAX engine: `evaluateScalar` understands only measure references (`[M]` / `'T'[M]`).
 */
import type { ColumnDef, DataType, SemanticModel, TableDef } from '@core/model/types'
import type { DataStore, Scalar } from '@core/model/data'
import { emptyDataStore } from '@core/model/data'
import type {
  DistinctValuesRequest,
  FieldDescription,
  GroupExpr,
  QueryEngine,
  SummarizeRequest,
  SummarizeResult,
  ValueExpr
} from '@core/engine/api'
import { fieldInfo, normalizeFilter, type SQExpr, type SQFilter } from '@core/report/sq'
import { formatNumber } from '@core/dax/format'
import { compareScalars, evalFilter } from './sqEval'

type Row = Record<string, Scalar>

export interface MemoryMeasure {
  table: string
  name: string
  formatString?: string
  dataType?: DataType
  /** evaluated over the fact rows in the current filter context */
  fn: (rows: Row[], ctx: { filters: SQFilter[] }) => Scalar
  /** per-row dynamic format string */
  dynamicFormat?: (rows: Row[]) => string | undefined
}

export interface MemoryDimension {
  name: string
  /** key column in the dimension and in the fact (same name) */
  key: string
  rows: Row[]
}

export interface MemoryEngineConfig {
  factTable: string
  fact: Row[]
  dimensions?: MemoryDimension[]
  measures?: MemoryMeasure[]
  /** column formats / types: `${table}.${column}` → info */
  columns?: Record<string, { dataType?: DataType; formatString?: string; sortBy?: string; dataCategory?: string }>
  /** hierarchy level → column: `${table}.${hierarchy}.${level}` → column name */
  hierarchyLevels?: Record<string, string>
}

const AGG_FNS: Record<number, (vals: Scalar[]) => Scalar> = {
  0: (v) => sumOf(v),
  1: (v) => {
    const n = v.filter((x) => typeof x === 'number') as number[]
    return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null
  },
  2: (v) => new Set(v.filter((x) => x !== null).map((x) => (x instanceof Date ? x.getTime() : x))).size || null,
  3: (v) => extreme(v, -1),
  4: (v) => extreme(v, 1),
  5: (v) => v.filter((x) => x !== null).length || null,
  6: (v) => {
    const n = (v.filter((x) => typeof x === 'number') as number[]).sort((a, b) => a - b)
    if (!n.length) return null
    const m = n.length >> 1
    return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2
  }
}

function sumOf(v: Scalar[]): Scalar {
  let s = 0
  let any = false
  for (const x of v)
    if (typeof x === 'number') {
      s += x
      any = true
    }
  return any ? s : null
}

function extreme(v: Scalar[], dir: 1 | -1): Scalar {
  let best: Scalar = null
  for (const x of v) {
    if (x === null) continue
    if (best === null || compareScalars(x, best) * dir > 0) best = x
  }
  return best
}

export function createMemoryEngine(cfg: MemoryEngineConfig): QueryEngine {
  const dims = new Map((cfg.dimensions ?? []).map((d) => [d.name, d]))
  const dimIndex = new Map<string, Map<string, Row>>()
  for (const d of dims.values()) {
    const idx = new Map<string, Row>()
    for (const r of d.rows) idx.set(String(r[d.key]), r)
    dimIndex.set(d.name, idx)
  }
  const measures = new Map((cfg.measures ?? []).map((m) => [`${m.table}.${m.name}`, m]))

  function columnOf(expr: SQExpr): { table: string; column: string } | undefined {
    const f = fieldInfo(expr)
    if (f.kind === 'column') return { table: f.table!, column: f.property! }
    if (f.kind === 'hierarchyLevel') {
      const col = cfg.hierarchyLevels?.[`${f.table}.${f.hierarchy}.${f.level}`] ?? f.level!
      return { table: f.table!, column: col }
    }
    return undefined
  }

  function cell(row: Row, table: string, column: string): Scalar {
    if (table === cfg.factTable || !dims.has(table)) return row[column] ?? null
    const d = dims.get(table)!
    const dr = dimIndex.get(table)!.get(String(row[d.key]))
    return dr ? dr[column] ?? null : null
  }

  function accessorFor(row: Row) {
    return (_key: string, expr: SQExpr): Scalar | undefined => {
      const c = columnOf(expr)
      if (c) return cell(row, c.table, c.column)
      return undefined
    }
  }

  function filterRows(rows: Row[], filters: SQFilter[] | undefined): Row[] {
    if (!filters?.length) return rows
    const norm = filters.map((f) => normalizeFilter(f))
    return rows.filter((r) => {
      const get = accessorFor(r)
      return norm.every((f) => evalFilter(f, get))
    })
  }

  function evalValue(expr: ValueExpr, rows: Row[], filters: SQFilter[]): Scalar {
    if (expr.kind === 'measure') return measures.get(`${expr.table}.${expr.measure}`)?.fn(rows, { filters }) ?? null
    if (expr.kind === 'aggregate') {
      const fnIdx = { sum: 0, avg: 1, distinctCount: 2, min: 3, max: 4, count: 5, countNonNull: 5, median: 6, stdev: 0, var: 0 }[expr.fn]
      return AGG_FNS[fnIdx](rows.map((r) => cell(r, expr.table, expr.column)))
    }
    if (expr.kind === 'dax') {
      const m = /^\s*(?:'?([^'[]*)'?)?\[([^\]]+)\]\s*$/.exec(expr.expression)
      if (m) {
        const hit = [...measures.values()].find((x) => x.name === m[2] && (!m[1] || x.table === m[1]))
        return hit ? hit.fn(rows, { filters }) : null
      }
      return null
    }
    const f = fieldInfo(expr.expr)
    if (f.kind === 'measure') return measures.get(`${f.table}.${f.property}`)?.fn(rows, { filters }) ?? null
    if (f.kind === 'aggregation') return AGG_FNS[f.aggregation ?? 0]?.(rows.map((r) => cell(r, f.table!, f.property!))) ?? null
    if (f.kind === 'column' || f.kind === 'hierarchyLevel') {
      // a bare column as a value → first value (PBI would show "First"/"Don't summarize" per row)
      const c = columnOf(expr.expr)!
      const vals = rows.map((r) => cell(r, c.table, c.column))
      return extreme(vals, -1)
    }
    return null
  }

  function groupColumn(g: GroupExpr): { table: string; column: string } {
    if ('kind' in g) return columnOf(g.expr) ?? { table: '?', column: '?' }
    return g
  }

  function sortKeyValue(table: string, column: string, value: Scalar, sample: Row | undefined): Scalar {
    const sb = cfg.columns?.[`${table}.${column}`]?.sortBy
    if (!sb || !sample) return value
    return cell(sample, table, sb)
  }

  function columnType(table: string, column: string, sampleVal: Scalar): DataType {
    const t = cfg.columns?.[`${table}.${column}`]?.dataType
    if (t) return t
    if (typeof sampleVal === 'number') return Number.isInteger(sampleVal) ? 'int64' : 'double'
    if (sampleVal instanceof Date) return 'dateTime'
    if (typeof sampleVal === 'boolean') return 'boolean'
    return 'string'
  }

  /**
   * Model metadata derived from the config (fact + dimension columns, measures) so model-driven
   * visuals (Q&A field lookup, field lists) work over the in-memory data. Hierarchies/partitions
   * are not modelled; relationships link each dimension key to the fact.
   */
  function buildModel(): SemanticModel {
    const tables = new Map<string, TableDef>()
    const tableOf = (name: string): TableDef => {
      let t = tables.get(name)
      if (!t) {
        t = { name, columns: [], measures: [], hierarchies: [], partitions: [] }
        tables.set(name, t)
      }
      return t
    }
    const addColumns = (table: string, rows: Row[]) => {
      const t = tableOf(table)
      const sample = rows[0]
      if (!sample) return
      for (const col of Object.keys(sample)) {
        if (t.columns.some((c) => c.name === col)) continue
        const info = cfg.columns?.[`${table}.${col}`]
        const firstVal = rows.find((r) => r[col] !== null && r[col] !== undefined)?.[col] ?? null
        const def: ColumnDef = { name: col, dataType: columnType(table, col, firstVal), kind: 'data', sourceColumn: col }
        if (info?.formatString) def.formatString = info.formatString
        if (info?.dataCategory) def.dataCategory = info.dataCategory
        if (info?.sortBy) def.sortByColumn = info.sortBy
        t.columns.push(def)
      }
    }
    addColumns(cfg.factTable, cfg.fact)
    for (const d of dims.values()) addColumns(d.name, d.rows)
    for (const m of cfg.measures ?? []) tableOf(m.table).measures.push({ name: m.name, expression: '', formatString: m.formatString, dataType: m.dataType })
    const relationships = [...dims.values()].map((d) => ({ name: `${cfg.factTable}_${d.name}`, fromTable: cfg.factTable, fromColumn: d.key, toTable: d.name, toColumn: d.key }))
    return { name: 'memory', tables: [...tables.values()], relationships, expressions: [], roles: [] } as unknown as SemanticModel
  }

  const engine: QueryEngine = {
    model: buildModel(),
    data: emptyDataStore() as DataStore,

    summarize(req: SummarizeRequest): SummarizeResult {
      const filters = req.filters ?? []
      const rows = filterRows(cfg.fact, filters)
      const gcols = req.groupBy.map(groupColumn)
      const groups = new Map<string, { keys: Scalar[]; rows: Row[] }>()
      if (gcols.length === 0) groups.set('', { keys: [], rows })
      else {
        const source = req.showItemsWithNoData ? cfg.fact : rows
        for (const r of source) {
          const keys = gcols.map((c) => cell(r, c.table, c.column))
          const k = keys.map((v) => (v instanceof Date ? 'd' + v.getTime() : JSON.stringify(v))).join('|')
          let g = groups.get(k)
          if (!g) groups.set(k, (g = { keys, rows: [] }))
          if (source === rows || rows.includes(r)) g.rows.push(r)
        }
      }
      const out: Scalar[][] = []
      const formats: Array<Array<string | undefined>> = []
      const samples: Row[] = []
      let anyDynamic = false
      const highlightRowsAll = req.highlightFilters ? filterRows(rows, req.highlightFilters) : undefined
      const highlights: Scalar[][] = []
      for (const g of groups.values()) {
        const vals = req.values.map((v) => evalValue(v.expr, g.rows, filters))
        if (gcols.length && req.values.length && !req.keepBlankRows && !req.showItemsWithNoData && vals.every((v) => v === null)) continue
        if (gcols.length && !req.values.length && !g.rows.length) continue
        out.push([...g.keys, ...vals])
        samples.push(g.rows[0] ?? cfg.fact.find((r) => gcols.every((c, i) => compareScalars(cell(r, c.table, c.column), g.keys[i]) === 0))!)
        formats.push(
          req.values.map((v) => {
            const f = v.expr.kind === 'sq' ? fieldInfo(v.expr.expr) : undefined
            const m = f?.kind === 'measure' ? measures.get(`${f.table}.${f.property}`) : undefined
            const d = m?.dynamicFormat?.(g.rows)
            if (d) anyDynamic = true
            return d
          })
        )
        if (highlightRowsAll) {
          const hr = g.rows.filter((r) => highlightRowsAll.includes(r))
          highlights.push(req.values.map((v) => (hr.length ? evalValue(v.expr, hr, filters) : null)))
        }
      }
      // sort
      const order = req.orderBy?.length ? req.orderBy : gcols.map((_, i) => ({ target: { group: i }, direction: 'asc' as const }))
      const idx = out.map((_, i) => i)
      idx.sort((a, b) => {
        for (const s of order) {
          let c = 0
          if ('group' in s.target) {
            const gi = s.target.group
            const col = gcols[gi]
            if (!col) continue
            c = compareScalars(sortKeyValue(col.table, col.column, out[a][gi], samples[a]), sortKeyValue(col.table, col.column, out[b][gi], samples[b]))
          } else {
            const vid = (s.target as { value: string }).value
            const vi = req.values.findIndex((v) => v.id === vid)
            if (vi < 0) continue
            c = compareScalars(out[a][gcols.length + vi], out[b][gcols.length + vi])
          }
          if (c) return s.direction === 'desc' ? -c : c
        }
        return 0
      })
      let sortedIdx = idx
      const truncated = req.limit !== undefined && idx.length > req.limit
      if (truncated) sortedIdx = idx.slice(0, req.limit)
      const sample0 = cfg.fact[0]
      const columns = [
        ...gcols.map((c, i) => ({
          id: `${c.table}.${c.column}`,
          kind: 'group' as const,
          dataType: columnType(c.table, c.column, out[0]?.[i] ?? (sample0 ? cell(sample0, c.table, c.column) : null)),
          formatString: cfg.columns?.[`${c.table}.${c.column}`]?.formatString,
          name: c.column
        })),
        ...req.values.map((v, i) => {
          const f = v.expr.kind === 'sq' ? fieldInfo(v.expr.expr) : undefined
          const m = f?.kind === 'measure' ? measures.get(`${f.table}.${f.property}`) : v.expr.kind === 'measure' ? measures.get(`${v.expr.table}.${v.expr.measure}`) : undefined
          const colFmt = f?.kind === 'aggregation' ? cfg.columns?.[`${f.table}.${f.property}`]?.formatString : undefined
          const sampleV = out[0]?.[gcols.length + i] ?? null
          return {
            id: v.id,
            kind: 'value' as const,
            dataType: m?.dataType ?? (typeof sampleV === 'string' ? 'string' : 'double') as DataType,
            formatString: m?.formatString ?? colFmt,
            name: m?.name ?? f?.property ?? v.id
          }
        })
      ]
      return {
        columns,
        rows: sortedIdx.map((i) => out[i]),
        formats: anyDynamic ? sortedIdx.map((i) => formats[i]) : undefined,
        highlights: highlightRowsAll ? sortedIdx.map((i) => highlights[i]) : undefined,
        truncated
      }
    },

    distinctValues(req: DistinctValuesRequest) {
      const c = groupColumn(req.column)
      const rows = filterRows(cfg.fact, req.filters)
      const seen = new Map<string, { v: Scalar; sample: Row; rows: Row[] }>()
      for (const r of rows) {
        const v = cell(r, c.table, c.column)
        const k = v instanceof Date ? 'd' + v.getTime() : JSON.stringify(v)
        let e = seen.get(k)
        if (!e) seen.set(k, (e = { v, sample: r, rows: [] }))
        e.rows.push(r)
      }
      let entries = [...seen.values()]
      if (req.search) {
        const s = req.search.toLowerCase()
        entries = entries.filter((e) => e.v !== null && String(e.v).toLowerCase().includes(s))
      }
      const sb = cfg.columns?.[`${c.table}.${c.column}`]?.sortBy
      entries.sort((a, b) => (sb ? compareScalars(a.sample[sb], b.sample[sb]) : compareScalars(a.v, b.v)))
      if (req.limit !== undefined) entries = entries.slice(0, req.limit)
      const first = entries.find((e) => e.v !== null)?.v ?? null
      return {
        values: entries.map((e) => e.v),
        measures: req.withMeasure ? entries.map((e) => evalValue(req.withMeasure!, e.rows, req.filters ?? [])) : undefined,
        dataType: columnType(c.table, c.column, first)
      }
    },

    evaluateScalar(expression: string, filters?: SQFilter[]) {
      const rows = filterRows(cfg.fact, filters)
      const value = evalValue({ kind: 'dax', expression }, rows, filters ?? [])
      const m = /\[([^\]]+)\]/.exec(expression)
      const meas = m ? [...measures.values()].find((x) => x.name === m[1]) : undefined
      return { value, formatString: meas?.formatString }
    },

    runDaxQuery() {
      return { tables: [], durationMs: 0 }
    },
    validateExpression() {
      return []
    },
    format: memoryFormat,
    processCalculated() {
      return []
    },
    invalidate() {},

    describeField(expr: SQExpr): FieldDescription | undefined {
      const f = fieldInfo(expr)
      if (f.kind === 'measure') {
        const m = measures.get(`${f.table}.${f.property}`)
        if (!m) return undefined
        return { kind: 'measure', table: m.table, name: m.name, displayName: m.name, dataType: m.dataType ?? 'double', formatString: m.formatString, isMeasure: true }
      }
      if (f.kind === 'aggregation') {
        const names: Record<number, string> = { 0: 'Sum', 1: 'Average', 2: 'Count', 3: 'Min', 4: 'Max', 5: 'Count', 6: 'Median' }
        const info = cfg.columns?.[`${f.table}.${f.property}`]
        return {
          kind: 'aggregation',
          table: f.table!,
          name: f.property!,
          displayName: `${f.aggregation === 2 ? 'Count of' : (names[f.aggregation ?? 0] ?? 'Sum') + ' of'} ${f.property}`,
          dataType: info?.dataType ?? 'double',
          formatString: f.aggregation === 2 || f.aggregation === 5 ? '0' : info?.formatString,
          isMeasure: true,
          column: { table: f.table!, column: f.property! }
        }
      }
      const c = columnOf(expr)
      if (!c) return undefined
      const info = cfg.columns?.[`${c.table}.${c.column}`]
      const sample = cfg.fact[0] ? cell(cfg.fact[0], c.table, c.column) : null
      return {
        kind: f.kind === 'hierarchyLevel' ? 'hierarchyLevel' : 'column',
        table: c.table,
        name: c.column,
        displayName: f.kind === 'hierarchyLevel' ? f.level! : c.column,
        dataType: columnType(c.table, c.column, sample),
        formatString: info?.formatString,
        isMeasure: false,
        sortBy: info?.sortBy ? { table: c.table, column: info.sortBy } : undefined,
        column: c,
        dataCategory: info?.dataCategory
      }
    },

    resolveFieldParameter() {
      return null
    }
  }
  return engine
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Formatter used by the memory engine: .NET-style number formats via the DAX FORMAT implementation. */
export function memoryFormat(value: Scalar, formatString?: string): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    if (formatString && /mmm/i.test(formatString)) return `${MONTHS[value.getUTCMonth()]} ${value.getUTCFullYear()}`
    return `${value.getUTCMonth() + 1}/${value.getUTCDate()}/${value.getUTCFullYear()}`
  }
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'number') {
    try {
      return formatNumber(value, formatString && !/^general/i.test(formatString) ? formatString : Number.isInteger(value) ? '0' : '0.##########')
    } catch {
      return String(value)
    }
  }
  if (value instanceof Uint8Array) return '(binary)'
  return String(value)
}
