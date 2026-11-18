/**
 * Column-oriented, dictionary-encoded in-memory model for the tabular DAX engine.
 *
 * Every column stores `codes` (row -> dictionary id) plus a dictionary of distinct values with id 0
 * reserved for BLANK. Tables on the one side of a relationship whose many side has unmatched keys get a
 * virtual blank row at index `rowCount` (all codes 0), exactly like VertiPaq.
 */
import type { CalculationGroupDef, ColumnDef, DataType, MeasureDef, RelationshipDef, SemanticModel, TableDef } from '../../model/types.ts'
import type { DataStore, Scalar as DataScalar } from '../../model/data.ts'
import { DaxError } from './errors.ts'
import { parseExpression, parseFunctionDefinition, type FunctionDefinition, type Node } from './parser.ts'
import { dayNumber, inferDataType, MS_PER_DAY, serialOf, vkey, type Scalar, type VKey } from './values.ts'

let nextColId = 1

export class Col {
  readonly id = nextColId++
  codes: Int32Array = new Int32Array(1)
  dict: Scalar[] = [null]
  /** numeric value per dictionary id (dates: OLE serial, booleans 0/1, text/blank NaN) */
  num: Float64Array = new Float64Array([NaN])
  private lookup: Map<VKey, number> | null = null
  private sortedCodesCache: Int32Array | null = null
  sortBy?: Col
  formatString?: string
  isHidden = false
  expression?: string
  ast?: Node | null
  dataCategory?: string
  /** declared type 'unknown' -> inferred after load */
  constructor(
    public table: Tbl,
    public index: number,
    public name: string,
    public dataType: DataType,
    public kind: ColumnDef['kind'] | 'calcGroup',
    public def?: ColumnDef
  ) {}

  get label(): string {
    return `'${this.table.name}'[${this.name}]`
  }

  /** Load values (length = table.rowCount). */
  setValues(values: ArrayLike<Scalar>): void {
    const n = this.table.rowCount
    const codes = new Int32Array(n + 1)
    const dict: Scalar[] = [null]
    const map = new Map<VKey, number>()
    map.set(null, 0)
    for (let r = 0; r < n; r++) {
      let v = r < values.length ? values[r] : null
      if (v === null || v === undefined) continue
      // the Power BI storage engine trims trailing spaces of text values (not leading ones) when it stores them, so
      // "a" and "a " are one value (Microsoft Learn, Data types in Power BI: "Leading and trailing spaces"); text is
      // case-insensitive and keeps the first variant loaded
      if (typeof v === 'string' && v.endsWith(' ')) v = trimTrailingSpaces(v)
      const k = vkey(v)
      let c = map.get(k)
      if (c === undefined) {
        c = dict.length
        dict.push(v)
        map.set(k, c)
      }
      codes[r] = c
    }
    this.codes = codes
    this.dict = dict
    this.lookup = map
    this.sortedCodesCache = null
    const num = new Float64Array(dict.length)
    num[0] = NaN
    for (let i = 1; i < dict.length; i++) {
      const v = dict[i]
      num[i] = typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : v instanceof Date ? serialOf(v) : NaN
    }
    this.num = num
    if (this.dataType === 'unknown' || this.dataType === 'variant') {
      const t = inferDataType(dict)
      if (t !== 'unknown') this.dataType = t
    }
  }

  /** Re-size the codes array after the table's blank row status/rowCount changed (keeps values). */
  value(row: number): Scalar {
    return this.dict[this.codes[row]]
  }

  /** Dictionary id of a value, or -1 when the value does not occur. Text matches case-insensitively. */
  codeOf(v: Scalar): number {
    if (v === null) return 0
    if (!this.lookup) {
      this.lookup = new Map()
      this.dict.forEach((d, i) => this.lookup!.set(vkey(d), i))
    }
    let c = this.lookup.get(vkey(typeof v === 'string' && v.endsWith(' ') ? trimTrailingSpaces(v) : v))
    if (c !== undefined) return c
    // cross-type lookups (filters coming from SQ literals / TREATAS with other lineage)
    if (typeof v === 'number' && (this.dataType === 'dateTime')) {
      c = this.lookup.get(vkey(new Date(Math.round((v - 25569) * MS_PER_DAY))))
    } else if (v instanceof Date && this.dataType !== 'dateTime') {
      c = this.lookup.get(serialOf(v))
    } else if (typeof v === 'string' && (this.dataType === 'int64' || this.dataType === 'double' || this.dataType === 'decimal')) {
      const n = Number(v)
      if (v.trim() !== '' && !Number.isNaN(n)) c = this.lookup.get(n)
    } else if (typeof v === 'number' && this.dataType === 'string') {
      c = this.lookup.get(String(v))
    } else if (typeof v === 'boolean' && this.dataType !== 'boolean') {
      c = this.lookup.get(v ? 1 : 0)
    }
    return c ?? -1
  }

  /** Dictionary ids ordered by value (blank first). */
  sortedCodes(): Int32Array {
    if (!this.sortedCodesCache) {
      const ids = Array.from({ length: this.dict.length }, (_, i) => i)
      const d = this.dict
      ids.sort((a, b) => cmpScalar(d[a], d[b]))
      this.sortedCodesCache = Int32Array.from(ids)
    }
    return this.sortedCodesCache
  }

  /** Number of non-blank distinct values. */
  get cardinality(): number {
    return this.dict.length - 1
  }
}

function cmpScalar(a: Scalar, b: Scalar): number {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  if (typeof a === 'string' && typeof b === 'string') {
    const x = a.toLowerCase()
    const y = b.toLowerCase()
    return x < y ? -1 : x > y ? 1 : 0
  }
  const na = typeof a === 'number' ? a : a instanceof Date ? a.getTime() : typeof a === 'boolean' ? (a ? 1 : 0) : NaN
  const nb = typeof b === 'number' ? b : b instanceof Date ? b.getTime() : typeof b === 'boolean' ? (b ? 1 : 0) : NaN
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  return typeof a === 'string' ? 1 : -1
}

export class Tbl {
  cols: Col[] = []
  private byName = new Map<string, Col>()
  rowCount = 0
  hasBlankRow = false
  calcGroup?: CalcGroup
  hierarchies: Array<{ name: string; levels: Array<{ name: string; column: Col }> }> = []
  /** DAX expression of a calculated table */
  expression?: string
  isHidden = false
  dataCategory?: string
  private allIds: Int32Array | null = null
  /** filters.ts cache: relationships that can carry filters uphill into this table without overrides */
  uphillCache?: { version: number; list: Rel[] }
  constructor(
    public name: string,
    public def?: TableDef
  ) {}

  get fullCount(): number {
    return this.rowCount + (this.hasBlankRow ? 1 : 0)
  }
  get blankIndex(): number {
    return this.hasBlankRow ? this.rowCount : -1
  }
  column(name: string): Col | undefined {
    return this.byName.get(name) ?? this.byName.get(name.toLowerCase())
  }
  addColumn(name: string, dataType: DataType, kind: Col['kind'], def?: ColumnDef): Col {
    const c = new Col(this, this.cols.length, name, dataType, kind, def)
    c.codes = new Int32Array(this.rowCount + 1)
    this.cols.push(c)
    this.byName.set(name.toLowerCase(), c)
    if (!this.byName.has(name)) this.byName.set(name, c)
    return c
  }
  removeColumn(c: Col): void {
    this.cols = this.cols.filter((x) => x !== c)
    this.cols.forEach((x, i) => (x.index = i))
    this.byName.delete(c.name.toLowerCase())
    if (this.byName.get(c.name) === c) this.byName.delete(c.name)
  }
  /** Replace all rows. `values[i]` aligns with `cols[i]`; missing columns become blank. */
  setRows(rowCount: number, columns: Map<Col, ArrayLike<Scalar>>): void {
    this.rowCount = rowCount
    this.allIds = null
    for (const c of this.cols) c.setValues(columns.get(c) ?? [])
  }
  all(): Int32Array {
    const n = this.fullCount
    if (!this.allIds || this.allIds.length !== n) {
      const a = new Int32Array(n)
      for (let i = 0; i < n; i++) a[i] = i
      this.allIds = a
    }
    return this.allIds
  }
}

export interface Measure {
  name: string
  table: Tbl
  expression: string
  formatString?: string
  formatExpression?: string
  def?: MeasureDef
  dataType?: DataType
  /** parsed lazily */
  ast?: Node | null
  formatAst?: Node | null
  parseError?: DaxError
  isHidden?: boolean
  displayFolder?: string
  /** KPI hidden measure (_<measure> Goal / Status / Trend) */
  kpiOf?: string
  kpiPart?: 'goal' | 'status' | 'trend'
  /** KPI status graphic name (e.g. "Traffic Light - Single") for the Status measure */
  kpiGraphic?: string
  /** the KPI's trend graphic (TOM trendGraphic), on its Trend measure */
  kpiTrendGraphic?: string
}

export interface CalcItem {
  name: string
  ordinal: number
  expression: string
  ast?: Node | null
  formatExpression?: string
  formatAst?: Node | null
}

export interface CalcGroup {
  table: Tbl
  column: Col
  ordinalColumn?: Col
  precedence: number
  items: CalcItem[]
  noSelection?: CalcItem
  multipleOrEmpty?: CalcItem
}

export interface Rel {
  id: string
  from: Col
  to: Col
  isActive: boolean
  /** 'single' = filters flow to -> from; 'both' = both directions */
  cross: 'single' | 'both'
  /** m1: regular many-to-one (expansion from -> to); 11: one-to-one; mm: weak many-to-many */
  kind: 'm1' | '11' | 'mm'
  datePartOnly: boolean
  def?: RelationshipDef
  /** key matches stored with the data (PBIX relationship index): from key value -> to key value (null = no match) */
  stored?: Map<VKey, Scalar>
}

export class DaxModel {
  tables: Tbl[] = []
  private tablesByName = new Map<string, Tbl>()
  measures = new Map<string, Measure>()
  relationships: Rel[] = []
  calcGroups: CalcGroup[] = []
  /** model-level user-defined functions (lower-case name -> source text, parsed on first use) */
  functions = new Map<string, { name: string; text: string; parsed?: FunctionDefinition; error?: DaxError }>()
  /** bumped whenever data/relationships change: invalidates caches keyed on the model */
  version = 0
  private relMapCache = new Map<string, Int32Array>()
  private viaCache = new Map<string, Int32Array>()
  private postingCache = new Map<string, { offsets: Int32Array; rows: Int32Array }>()

  findTable(name: string): Tbl | undefined {
    return this.tablesByName.get(name) ?? this.tablesByName.get(name.toLowerCase())
  }
  table(name: string): Tbl {
    const t = this.findTable(name)
    if (!t) throw new DaxError('REF', `Cannot find table '${name}'.`)
    return t
  }
  addTable(name: string, def?: TableDef): Tbl {
    const t = new Tbl(name, def)
    this.tables.push(t)
    this.tablesByName.set(name.toLowerCase(), t)
    this.tablesByName.set(name, t)
    return t
  }
  removeTable(t: Tbl): void {
    this.tables = this.tables.filter((x) => x !== t)
    this.tablesByName.delete(t.name.toLowerCase())
    this.tablesByName.delete(t.name)
  }
  /** A model user-defined function, parsed on first use (throws its syntax error when called). */
  userFunction(name: string): FunctionDefinition | undefined {
    const f = this.functions.get(name.toLowerCase())
    if (!f) return undefined
    if (f.error) throw f.error
    if (!f.parsed) {
      try {
        f.parsed = parseFunctionDefinition(f.name, f.text)
      } catch (e) {
        f.error = new DaxError((e as DaxError).code ?? 'SYNTAX', `Function ${f.name}: ${(e as Error).message}`)
        throw f.error
      }
    }
    return f.parsed
  }

  measure(name: string): Measure | undefined {
    return this.measures.get(name) ?? this.measures.get(name.toLowerCase())
  }
  column(table: string, column: string): Col | undefined {
    return this.findTable(table)?.column(column)
  }

  invalidateCaches(): void {
    this.version++
    this.relMapCache.clear()
    this.viaCache.clear()
    this.postingCache.clear()
  }

  /** Recompute blank rows from relationship key matching. Call after loading data / calculated columns. */
  computeBlankRows(): void {
    const before = new Map(this.tables.map((t) => [t, t.hasBlankRow]))
    for (const t of this.tables) t.hasBlankRow = false
    // iterate to a fixed point: a new blank row on a many side can itself be unmatched on a further one side
    for (let pass = 0; pass < 4; pass++) {
      let changed = false
      for (const r of this.relationships) {
        if (r.kind !== 'm1') continue
        if (r.to.table.hasBlankRow) continue
        const map = this.keyMatch(r)
        const from = r.from
        let unmatched = false
        const n = from.table.rowCount
        for (let i = 0; i < n; i++) {
          if (map[from.codes[i]] < 0) {
            unmatched = true
            break
          }
        }
        if (unmatched) {
          r.to.table.hasBlankRow = true
          changed = true
        }
      }
      if (!changed) break
    }
    void before
    this.invalidateCaches()
  }

  /** For relationship r: from-dictionary id -> to-row index (-1 = no matching row). */
  keyMatch(r: Rel): Int32Array {
    const key = `km|${r.id}`
    let m = this.relMapCache.get(key)
    if (m) return m
    const to = r.to
    const index = new Map<VKey, number>()
    const n = to.table.rowCount
    for (let i = 0; i < n; i++) {
      const v = to.dict[to.codes[i]]
      if (v === null) continue
      const k = r.datePartOnly && v instanceof Date ? dayNumber(v) : vkey(v)
      if (!index.has(k)) index.set(k, i)
    }
    const numeric = (t: string) => t === 'int64' || t === 'double' || t === 'decimal'
    const mixed = (r.from.dataType === 'string' && numeric(to.dataType)) || (numeric(r.from.dataType) && to.dataType === 'string')
    let numIndex: Map<number, number> | null = null
    if (mixed) {
      numIndex = new Map()
      for (let i = 0; i < n; i++) {
        const v = to.dict[to.codes[i]]
        const num = typeof v === 'string' ? keyNumber(v) : typeof v === 'number' ? v : null
        if (num !== null && !numIndex.has(num)) numIndex.set(num, i)
      }
    }
    m = new Int32Array(r.from.dict.length)
    for (let c = 0; c < r.from.dict.length; c++) {
      const v = r.from.dict[c]
      if (v === null) {
        m[c] = -1
        continue
      }
      let k: VKey = r.datePartOnly && v instanceof Date ? dayNumber(v) : vkey(v)
      // the key matches the engine stored with the data (PBIX relationship index) are authoritative
      if (r.stored?.has(k)) {
        const tv = r.stored.get(k)!
        const hit = tv === null ? undefined : index.get(r.datePartOnly && tv instanceof Date ? dayNumber(tv) : vkey(tv))
        m[c] = hit ?? -1
        continue
      }
      let hit = index.get(k)
      if (hit === undefined && mixed) {
        // text vs number keys: the text side converts to a number (VALUE-like: trimmed decimal / exponent notation;
        // empty or non-numeric text matches nothing), then keys compare as numbers — the matches Power BI stores
        // for the Microsoft samples' text/whole-number relationships
        const num = typeof v === 'string' ? keyNumber(v) : typeof v === 'number' ? v : null
        if (num !== null) hit = numIndex!.get(num)
      }
      if (hit === undefined && v instanceof Date && to.dataType === 'dateTime' && !r.datePartOnly) {
        k = vkey(v)
        hit = index.get(k)
      }
      m[c] = hit ?? -1
    }
    this.relMapCache.set(key, m)
    return m
  }

  /** Row map over a regular relationship: from-row -> to-row (blank row index when unmatched, -1 when no blank row). */
  relRowMap(r: Rel): Int32Array {
    const key = `rm|${r.id}`
    let m = this.relMapCache.get(key)
    if (m) return m
    const km = this.keyMatch(r)
    const n = r.from.table.fullCount
    const blank = r.to.table.blankIndex
    const codes = r.from.codes
    m = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      const t = km[codes[i]]
      m[i] = t >= 0 ? t : blank
    }
    this.relMapCache.set(key, m)
    return m
  }

  /** Composite row map along a path of relationships (each step from -> to). */
  pathRowMap(path: Rel[]): Int32Array | null {
    if (path.length === 0) return null
    if (path.length === 1) return this.relRowMap(path[0])
    const key = 'pm|' + path.map((r) => r.id).join('>')
    let m = this.relMapCache.get(key)
    if (m) return m
    const first = this.relRowMap(path[0])
    m = new Int32Array(first)
    for (let s = 1; s < path.length; s++) {
      const step = this.relRowMap(path[s])
      for (let i = 0; i < m.length; i++) {
        const x = m[i]
        m[i] = x < 0 ? -1 : step[x]
      }
    }
    this.relMapCache.set(key, m)
    return m
  }

  /** Codes of column `c` for every row of the table at the start of `path` (codes of blank for unmatched). */
  codesVia(path: Rel[], c: Col): Int32Array {
    if (path.length === 0) return c.codes
    const key = path.map((r) => r.id).join('>') + '|' + c.id
    let v = this.viaCache.get(key)
    if (v) return v
    const map = this.pathRowMap(path)!
    v = new Int32Array(map.length)
    const codes = c.codes
    for (let i = 0; i < map.length; i++) {
      const x = map[i]
      v[i] = x < 0 ? 0 : codes[x]
    }
    this.viaCache.set(key, v)
    return v
  }

  /** Posting lists (rows grouped by code) for a codes array identified by `key`. */
  postings(key: string, codes: Int32Array, dictSize: number, n: number): { offsets: Int32Array; rows: Int32Array } {
    let p = this.postingCache.get(key)
    if (p) return p
    const offsets = new Int32Array(dictSize + 1)
    for (let i = 0; i < n; i++) offsets[codes[i] + 1]++
    for (let c = 0; c < dictSize; c++) offsets[c + 1] += offsets[c]
    const pos = offsets.slice(0, dictSize)
    const rows = new Int32Array(n)
    for (let i = 0; i < n; i++) rows[pos[codes[i]]++] = i
    p = { offsets, rows }
    this.postingCache.set(key, p)
    return p
  }
}

// -------------------------------------------------------------------------------------------------
// Building a DaxModel from the app's SemanticModel + DataStore
// -------------------------------------------------------------------------------------------------

export function toEngineValue(v: DataScalar | undefined): Scalar {
  if (v === undefined || v === null) return null
  if (v instanceof Uint8Array) return null
  if (typeof v === 'number' && Number.isNaN(v)) return null
  return v
}

function normalizeType(t: DataType | undefined): DataType {
  if (!t || t === 'binary') return t === 'binary' ? 'binary' : 'unknown'
  return t
}

function coerceLoad(v: Scalar, t: DataType): Scalar {
  if (v === null) return null
  switch (t) {
    case 'int64':
    case 'double':
    case 'decimal':
      if (typeof v === 'number') return v
      if (typeof v === 'boolean') return v ? 1 : 0
      if (v instanceof Date) return serialOf(v)
      if (typeof v === 'string') {
        const n = Number(v)
        return v.trim() === '' || Number.isNaN(n) ? null : n
      }
      return v
    case 'string':
      if (typeof v === 'string') return v
      if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ')
      return String(v)
    case 'boolean':
      if (typeof v === 'boolean') return v
      if (typeof v === 'number') return v !== 0
      if (typeof v === 'string') return /^(true|1|yes)$/i.test(v.trim())
      return v
    case 'dateTime':
      if (v instanceof Date) return v
      if (typeof v === 'number') return new Date(Math.round((v - 25569) * MS_PER_DAY))
      if (typeof v === 'string') {
        const d = new Date(v.length <= 10 ? v + 'T00:00:00Z' : v.endsWith('Z') ? v : v + 'Z')
        return Number.isNaN(d.getTime()) ? null : d
      }
      return v
    default:
      return v
  }
}

function tableDataFor(data: DataStore, t: TableDef) {
  const direct = data.tables.get(t.name)
  if (direct) return direct
  const lower = t.name.toLowerCase()
  for (const [k, v] of data.tables) if (k.toLowerCase() === lower) return v
  return undefined
}

function sourceName(c: ColumnDef): string | undefined {
  const s = c.sourceColumn
  if (!s) return undefined
  return s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s
}

/** Load stored values for a model table's data columns (and calc-table columns if stored). */
export function loadTableData(t: Tbl, def: TableDef, data: DataStore): void {
  const td = tableDataFor(data, def)
  const values = new Map<Col, ArrayLike<Scalar>>()
  let rowCount = 0
  if (td) {
    rowCount = td.rowCount
    const byName = new Map(td.columns.map((c) => [c.name.toLowerCase(), c]))
    for (const c of t.cols) {
      if (c.kind === 'calculated' || c.kind === 'calcGroup') continue
      const src = (c.def && sourceName(c.def)) ?? c.name
      const cd = byName.get(c.name.toLowerCase()) ?? byName.get(src.toLowerCase())
      if (!cd) continue
      const arr = new Array<Scalar>(rowCount)
      const tt = c.dataType
      for (let i = 0; i < rowCount; i++) arr[i] = coerceLoad(toEngineValue(cd.values[i]), tt)
      values.set(c, arr)
    }
  }
  t.setRows(rowCount, values)
}

function relKind(r: RelationshipDef): Rel['kind'] {
  const f = r.fromCardinality ?? 'many'
  const to = r.toCardinality ?? 'one'
  if (f === 'many' && to === 'many') return 'mm'
  if (f === 'one' && to === 'one') return '11'
  return 'm1'
}

export interface BuildIssue {
  table: string
  column?: string
  error: string
}

/** Build the engine model (schema + stored data). Calculated columns/tables are computed later by the engine. */
export function buildModel(sm: SemanticModel, data: DataStore, issues: BuildIssue[] = []): DaxModel {
  const m = new DaxModel()
  for (const td of sm.tables) {
    if (m.findTable(td.name)) {
      issues.push({ table: td.name, error: `Duplicate table name '${td.name}'.` })
      continue
    }
    const t = m.addTable(td.name, td)
    t.isHidden = !!td.isHidden
    t.dataCategory = td.dataCategory
    const calcPart = td.partitions.find((p) => p.sourceType === 'calculated')
    if (calcPart?.expression) t.expression = calcPart.expression
    for (const cd of td.columns) {
      if (cd.kind === 'rowNumber') continue
      if (t.column(cd.name)) continue
      const c = t.addColumn(cd.name, normalizeType(cd.dataType), cd.kind, cd)
      c.formatString = cd.formatString
      c.isHidden = !!cd.isHidden
      c.dataCategory = cd.dataCategory
      if (cd.kind === 'calculated') c.expression = cd.expression
    }
    if (td.calculationGroup) buildCalcGroup(m, t, td.calculationGroup)
    else loadTableData(t, td, data)
    for (const md of td.measures) {
      const key = md.name.toLowerCase()
      if (m.measures.has(key)) {
        issues.push({ table: td.name, column: md.name, error: `Duplicate measure name '${md.name}'.` })
        continue
      }
      m.measures.set(key, {
        name: md.name,
        table: t,
        expression: md.expression,
        formatString: md.formatString,
        formatExpression: md.formatStringDefinition?.expression,
        def: md,
        dataType: md.dataType,
        isHidden: md.isHidden,
        displayFolder: md.displayFolder
      })
      // KPI: Analysis Services exposes the goal / status / trend as hidden measures named _<measure> Goal|Status|Trend
      // (that is how reports reference them); Value is the measure itself.
      const kpi = md.kpi
      if (kpi) {
        const parts: Array<[string, string | undefined, string | undefined]> = [
          ['Goal', kpi.targetExpression, md.formatString],
          ['Status', kpi.statusExpression, undefined],
          ['Trend', kpi.trendExpression, undefined]
        ]
        for (const [suffix, expr, fmt] of parts) {
          if (!expr?.trim()) continue
          const name = `_${md.name} ${suffix}`
          if (m.measures.has(name.toLowerCase())) continue
          m.measures.set(name.toLowerCase(), { name, table: t, expression: expr, formatString: fmt, isHidden: true, kpiOf: md.name, kpiPart: suffix.toLowerCase() as 'goal' | 'status' | 'trend', kpiGraphic: suffix === 'Status' ? kpi.statusGraphic : undefined, kpiTrendGraphic: suffix === 'Trend' ? kpi.trendGraphic : undefined })
        }
      }
    }
  }
  // sort-by and hierarchies need all columns
  for (const t of m.tables) {
    const td = t.def!
    for (const c of t.cols) {
      if (c.def?.sortByColumn) c.sortBy = t.column(c.def.sortByColumn)
    }
    for (const h of td.hierarchies ?? []) {
      const levels = [...h.levels]
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((l) => ({ name: l.name, column: t.column(l.column)! }))
        .filter((l) => l.column)
      t.hierarchies.push({ name: h.name, levels })
    }
  }
  for (const fd of sm.functions ?? []) {
    if (fd.name) m.functions.set(fd.name.toLowerCase(), { name: fd.name, text: fd.expression })
  }
  for (const rd of sm.relationships) {
    const from = m.column(rd.fromTable, rd.fromColumn)
    const to = m.column(rd.toTable, rd.toColumn)
    if (!from || !to) {
      issues.push({ table: rd.fromTable, column: rd.fromColumn, error: `Relationship '${rd.name}' refers to a missing column.` })
      continue
    }
    let kind = relKind(rd)
    let f = from
    let tt = to
    // TOM allows fromCardinality one / toCardinality many: normalize so `from` is the many side
    if ((rd.fromCardinality ?? 'many') === 'one' && (rd.toCardinality ?? 'one') === 'many') {
      f = to
      tt = from
      kind = 'm1'
    }
    const sk = rd.name ? data.relationshipKeys?.get(rd.name) : undefined
    let stored: Map<VKey, Scalar> | undefined
    if (sk && sk.fromData === data.tables.get(f.table.name) && sk.toData === data.tables.get(tt.table.name)) {
      stored = new Map()
      for (let k = 0; k < sk.from.length; k++) stored.set(vkey(typeof sk.from[k] === 'string' ? trimTrailingSpaces(sk.from[k] as string) : (sk.from[k] as Scalar)), sk.to[k] as Scalar)
    }
    m.relationships.push({
      stored,
      id: rd.name || `${rd.fromTable}.${rd.fromColumn}->${rd.toTable}.${rd.toColumn}`,
      from: f,
      to: tt,
      isActive: rd.isActive !== false,
      cross: rd.crossFilteringBehavior === 'bothDirections' || kind === '11' ? 'both' : 'single',
      kind,
      datePartOnly: rd.joinOnDateBehavior === 'datePartOnly',
      def: rd
    })
  }
  m.calcGroups.sort((a, b) => b.precedence - a.precedence)
  m.computeBlankRows()
  reportAmbiguousPaths(m, issues)
  return m
}

/**
 * Power BI refuses to activate a relationship that creates a second filter path between two tables (ambiguity),
 * so a model in that state is usually hand-edited; the engine then follows the first path found (breadth-first,
 * fewest hops). Report it instead of silently choosing.
 */
function reportAmbiguousPaths(m: DaxModel, issues: BuildIssue[]): void {
  for (const t of m.tables) {
    const reach = new Map<Tbl, string>()
    reach.set(t, '')
    const queue: Array<{ table: Tbl; path: string[] }> = [{ table: t, path: [] }]
    while (queue.length) {
      const cur = queue.shift()!
      for (const r of m.relationships) {
        if (r.kind === 'mm' || !r.isActive || r.from.table !== cur.table) continue
        const next = r.to.table
        const path = [...cur.path, r.id]
        if (reach.has(next)) {
          const other = reach.get(next)!
          if (other !== path.join(' > ') && next !== t) {
            issues.push({
              table: t.name,
              error: `Ambiguous relationship paths from '${t.name}' to '${next.name}' (${other || 'direct'} / ${path.join(' > ')}). Power BI does not allow both to be active; Lumen filters through the first (shortest) path.`
            })
          }
          continue
        }
        reach.set(next, path.join(' > '))
        queue.push({ table: next, path })
      }
    }
  }
}

function buildCalcGroup(m: DaxModel, t: Tbl, cg: CalculationGroupDef): void {
  const nameCol =
    t.cols.find((c) => /^name$/i.test((c.def && sourceName(c.def)) ?? '')) ?? t.cols.find((c) => c.dataType === 'string') ?? t.addColumn('Name', 'string', 'calcGroup')
  const ordCol = t.cols.find((c) => c !== nameCol && /^ordinal$/i.test((c.def && sourceName(c.def)) ?? '')) ?? t.cols.find((c) => c !== nameCol && (c.dataType === 'int64' || c.dataType === 'double'))
  nameCol.dataType = 'string'
  const items: CalcItem[] = cg.items.map((it, i) => ({
    name: it.name,
    ordinal: it.ordinal ?? i,
    expression: it.expression,
    formatExpression: it.formatStringDefinition?.expression
  }))
  const sorted = [...items].sort((a, b) => a.ordinal - b.ordinal)
  const values = new Map<Col, ArrayLike<Scalar>>()
  values.set(nameCol, sorted.map((i) => i.name))
  if (ordCol) {
    ordCol.dataType = 'int64'
    values.set(ordCol, sorted.map((i) => i.ordinal))
  }
  t.setRows(sorted.length, values)
  const group: CalcGroup = {
    table: t,
    column: nameCol,
    ordinalColumn: ordCol,
    precedence: cg.precedence ?? 0,
    items: sorted,
    noSelection: cg.noSelectionExpression ? { name: '(no selection)', ordinal: -1, expression: cg.noSelectionExpression } : undefined,
    multipleOrEmpty: cg.multipleOrEmptySelectionExpression ? { name: '(multiple selection)', ordinal: -1, expression: cg.multipleOrEmptySelectionExpression } : undefined
  }
  t.calcGroup = group
  m.calcGroups.push(group)
}

export function parseCached(holder: { ast?: Node | null; parseError?: DaxError }, text: string): Node {
  if (holder.ast) return holder.ast
  if (holder.parseError) throw holder.parseError
  try {
    holder.ast = parseExpression(text)
    return holder.ast
  } catch (e) {
    const err = e instanceof DaxError ? e : new DaxError('SYNTAX', String((e as Error).message ?? e))
    holder.parseError = err
    throw err
  }
}

/** Number of a text relationship key (trimmed decimal or exponent notation), or null. */
function keyNumber(s: string): number | null {
  const t = s.trim()
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Text as the storage engine keeps it: without trailing spaces (U+0020). */
export function trimTrailingSpaces(s: string): string {
  let e = s.length
  while (e > 0 && s.charCodeAt(e - 1) === 32) e--
  return e === s.length ? s : s.slice(0, e)
}
