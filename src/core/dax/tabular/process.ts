/**
 * Calculated columns and calculated tables (incl. field parameters, DATATABLE, CALENDAR), computed in
 * dependency order. Errors are collected per object; failed objects are left blank.
 */
import type { ColumnDef, DataType } from '../../model/types.ts'
import { DaxError } from './errors.ts'
import { rowFn } from './compile.ts'
import { Evaluator } from './evaluator.ts'
import { FilterContext } from './filters.ts'
import type { Col, DaxModel, Tbl } from './model.ts'
import { parseExpression, walk, type Node } from './parser.ts'
import type { EvalOptions } from './registry.ts'
import { isTable, TableValue } from './table.ts'
import { coerceTo, inferDataType, type Scalar } from './values.ts'

export interface ProcessIssue {
  table: string
  column?: string
  error: string
  /** the object could not be recomputed but its stored values were kept (a notice rather than an error) */
  kept?: boolean
}

type Item = { kind: 'column'; col: Col } | { kind: 'table'; table: Tbl }

function itemKey(it: Item): string {
  return it.kind === 'column' ? `c:${it.col.id}` : `t:${it.table.name.toLowerCase()}`
}

/** References of an expression: columns (qualified or same-table), tables, measures (transitively). */
function references(model: DaxModel, ast: Node, home: Tbl | null, seenMeasures = new Set<string>(), measureTexts: string[] = []): { cols: Set<Col>; tables: Set<Tbl> } {
  const cols = new Set<Col>()
  const tables = new Set<Tbl>()
  walk(ast, (n) => {
    if (n.kind === 'column') {
      if (n.table) {
        const t = model.findTable(n.table)
        const c = t?.column(n.name)
        if (c) cols.add(c)
        else if (t) {
          const m = model.measure(n.name)
          if (m) addMeasure(m.name)
        }
      } else {
        const c = home?.column(n.name)
        if (c) cols.add(c)
        else {
          const m = model.measure(n.name)
          if (m) addMeasure(m.name)
        }
      }
    } else if (n.kind === 'ident') {
      const t = model.findTable(n.name)
      if (t) tables.add(t)
    }
  })
  function addMeasure(name: string) {
    const key = name.toLowerCase()
    if (seenMeasures.has(key)) return
    seenMeasures.add(key)
    const m = model.measure(name)
    if (!m) return
    measureTexts.push(`${m.name}=${m.expression}`)
    try {
      const r = references(model, parseExpression(m.expression), m.table, seenMeasures, measureTexts)
      r.cols.forEach((c) => cols.add(c))
      r.tables.forEach((t) => tables.add(t))
    } catch {
      /* measure syntax errors surface when evaluated */
    }
  }
  return { cols, tables }
}

function sourceName(def?: ColumnDef): string | undefined {
  const s = def?.sourceColumn
  if (!s) return undefined
  return s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s
}

/** Fill a calculated table's model columns from an evaluated table value. */
export function assignTable(model: DaxModel, t: Tbl, v: TableValue): void {
  if (t.cols.length === 0) {
    for (const c of v.cols) {
      const col = t.addColumn(c.name, c.dataType ?? 'unknown', 'calculatedTableColumn')
      col.formatString = c.lineage?.formatString
    }
  }
  const map = new Map<Col, Scalar[]>()
  const used = new Set<number>()
  for (const col of t.cols) {
    if (col.kind === 'calculated') continue
    const src = sourceName(col.def)
    let j = -1
    const tryName = (name: string | undefined) => {
      if (!name || j >= 0) return
      const lower = name.toLowerCase()
      j = v.cols.findIndex((c, k) => !used.has(k) && c.name.toLowerCase() === lower)
      if (j < 0) {
        // qualified source: 'Table'[Column] or Table[Column]
        const m = /^'?(.*?)'?\[(.*)\]$/.exec(name)
        if (m) j = v.cols.findIndex((c, k) => !used.has(k) && c.name.toLowerCase() === m[2].toLowerCase() && (!c.lineage || c.lineage.table.name.toLowerCase() === m[1].toLowerCase()))
      }
    }
    tryName(src)
    tryName(col.name)
    if (j < 0) continue
    used.add(j)
    const vals = v.column(j)
    let dt: DataType = col.dataType
    if (dt === 'unknown' || dt === 'variant') {
      dt = v.cols[j].dataType && v.cols[j].dataType !== 'unknown' ? v.cols[j].dataType! : inferDataType(vals)
      col.dataType = dt
    }
    if (!col.formatString && v.cols[j].lineage?.formatString) col.formatString = v.cols[j].lineage!.formatString
    map.set(col, dt === 'unknown' || dt === 'variant' ? vals : vals.map((x) => safeCoerce(x, dt)))
  }
  t.setRows(v.n, map)
  // keep previously computed calculated columns' values aligned (they are recomputed after)
}

function safeCoerce(v: Scalar, t: DataType): Scalar {
  try {
    return coerceTo(v, t)
  } catch {
    return null
  }
}

export function computeColumn(model: DaxModel, col: Col, options: EvalOptions): void {
  const ast = parseExpression(col.expression ?? '')
  const t = col.table
  const ev = new Evaluator(model, options)
  const ctx = new FilterContext(model)
  const ids = t.all().subarray(0, t.rowCount)
  const tv = TableValue.fromBase(t, ids)
  const out = new Array<Scalar>(t.rowCount)
  const env = { ...ev.rootEnv(ctx), home: t }
  ev.home = t
  let firstError: unknown = null
  let errors = 0
  const f = rowFn(ev, ast, tv, env)
  for (let i = 0; i < tv.n; i++) {
    try {
      out[i] = f(i)
    } catch (e) {
      out[i] = null
      errors++
      firstError ??= e
    }
  }
  if (errors && errors === t.rowCount) throw firstError
  let dt = col.dataType
  if (dt === 'unknown' || dt === 'variant') {
    dt = ev.staticType(ast) ?? inferDataType(out)
    col.dataType = dt
  }
  col.setValues(dt === 'unknown' || dt === 'variant' ? out : out.map((x) => safeCoerce(x, dt)))
  if (firstError) throw new DaxError('PARTIAL', `${errors} of ${t.rowCount} rows failed: ${(firstError as Error).message}`)
}

export type CalcItem = Item

export interface CalcGraph {
  items: Item[]
  byKey: Map<string, Item>
  deps: Map<string, string[]>
  /** item key -> referenced measure expressions + data tables (inputs that are not calculated objects) */
  inputs: Map<string, { measures: string[]; tables: Tbl[] }>
}

export function calcItemKey(it: Item): string {
  return itemKey(it)
}

/** Calculated columns / tables and their dependencies (on other calculated objects, data tables and measures). */
export function calcGraph(model: DaxModel): CalcGraph {
  const items: Item[] = []
  for (const t of model.tables) {
    if (t.expression && !t.calcGroup) items.push({ kind: 'table', table: t })
    for (const c of t.cols) if (c.kind === 'calculated' && c.expression !== undefined) items.push({ kind: 'column', col: c })
  }
  const byKey = new Map(items.map((i) => [itemKey(i), i]))
  const deps = new Map<string, string[]>()
  const inputs = new Map<string, { measures: string[]; tables: Tbl[] }>()
  for (const it of items) {
    const key = itemKey(it)
    try {
      const ast = parseExpression(it.kind === 'column' ? it.col.expression ?? '' : it.table.expression ?? '')
      const measures: string[] = []
      const r = references(model, ast, it.kind === 'column' ? it.col.table : null, new Set(), measures)
      const d: string[] = []
      const dataTables = new Set<Tbl>()
      if (it.kind === 'column') dataTables.add(it.col.table)
      for (const c of r.cols) {
        if (c.kind === 'calculated' && byKey.has(`c:${c.id}`) && !(it.kind === 'column' && c === it.col)) d.push(`c:${c.id}`)
        if (byKey.has(`t:${c.table.name.toLowerCase()}`) && !(it.kind === 'table' && it.table === c.table)) d.push(`t:${c.table.name.toLowerCase()}`)
        dataTables.add(c.table)
      }
      for (const t of r.tables) {
        const tk = `t:${t.name.toLowerCase()}`
        if (byKey.has(tk) && !(it.kind === 'table' && it.table === t)) d.push(tk)
        // a calculated table that scans another table needs that table's calculated columns
        if (it.kind === 'table') for (const c of t.cols) if (c.kind === 'calculated' && byKey.has(`c:${c.id}`)) d.push(`c:${c.id}`)
        dataTables.add(t)
      }
      // a calculated column needs its own table's rows
      if (it.kind === 'column' && byKey.has(`t:${it.col.table.name.toLowerCase()}`)) d.push(`t:${it.col.table.name.toLowerCase()}`)
      deps.set(key, d)
      inputs.set(key, { measures, tables: [...dataTables].filter((t) => !(t.expression && !t.calcGroup)) })
    } catch (e) {
      deps.set(key, [])
      inputs.set(key, { measures: [], tables: [] })
    }
  }
  return { items, byKey, deps, inputs }
}

export function processCalculated(model: DaxModel, options: EvalOptions = {}, only?: { tables?: Set<string>; columns?: Set<Col> }): ProcessIssue[] {
  const issues: ProcessIssue[] = []
  const { items, byKey, deps } = calcGraph(model)
  const state = new Map<string, 'visiting' | 'done'>()
  const order: Item[] = []
  const cyclic = new Set<string>()
  const visit = (key: string, path: string[]) => {
    const s = state.get(key)
    if (s === 'done') return
    if (s === 'visiting') {
      for (const k of path.slice(path.indexOf(key))) cyclic.add(k)
      return
    }
    state.set(key, 'visiting')
    for (const d of deps.get(key) ?? []) visit(d, [...path, key])
    state.set(key, 'done')
    order.push(byKey.get(key)!)
  }
  for (const it of items) visit(itemKey(it), [])

  const label = (it: Item) => (it.kind === 'column' ? { table: it.col.table.name, column: it.col.name } : { table: it.table.name })
  for (const it of order) {
    if (only) {
      const inScope = it.kind === 'table' ? only.tables?.has(it.table.name.toLowerCase()) : only.columns?.has(it.col) || only.tables?.has(it.col.table.name.toLowerCase())
      if (!inScope) continue
    }
    if (cyclic.has(itemKey(it))) {
      issues.push({ ...label(it), error: 'A circular dependency was detected.' })
      continue
    }
    try {
      if (it.kind === 'table') {
        const ev = new Evaluator(model, options)
        const v = ev.value(parseExpression(it.table.expression ?? ''), ev.rootEnv(new FilterContext(model)))
        if (!isTable(v)) throw new DaxError('TYPE', 'The expression of a calculated table must return a table.')
        assignTable(model, it.table, v)
      } else {
        computeColumn(model, it.col, options)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const stored = it.kind === 'column' ? it.col.dict.length > 1 : it.table.rowCount > 0
      if (stored && !(e instanceof DaxError && e.code === 'PARTIAL') && options.keepStoredOnError) {
        // e.g. Power BI clustering (KMEANSCLUSTERING) columns: keep the values stored in the file
        issues.push({ ...label(it), error: `${message} The values stored in the file are kept.`, kept: true })
      } else {
        issues.push({ ...label(it), error: message })
        if (it.kind === 'column' && !(e instanceof DaxError && e.code === 'PARTIAL')) it.col.setValues([])
      }
    }
    model.invalidateCaches()
    if (it.kind === 'table') model.computeBlankRows()
  }
  model.computeBlankRows()
  return issues
}
