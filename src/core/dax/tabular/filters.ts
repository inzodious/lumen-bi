/**
 * Filter context: a set of filters (each a table of allowed tuples over model columns), the effective
 * relationship configuration (USERELATIONSHIP / CROSSFILTER overrides), the ALLSELECTED shadow filters and
 * the SUMMARIZECOLUMNS group-by scope (ISINSCOPE).
 *
 * Filters propagate along relationships with expanded-table semantics: a table sees every filter on a
 * column of its expanded table (itself + everything reachable over many-to-one relationships), plus
 * cross-filter restrictions from bidirectional / one-to-one / weak many-to-many relationships.
 *
 * Visible rows are computed with dictionary-code bitmaps and cached posting lists so that the most selective
 * filter drives the scan (per-group evaluation in a visual is O(rows in the group), not O(table)).
 */
import type { Col, DaxModel, Rel, Tbl } from './model.ts'
import type { Scalar } from './values.ts'
import { aggregateGroups, GROUP_MIN_ROWS, groupIndex, passingGroups, rowsOfGroups, type AggKind, type Comp, type GroupIndex, type GroupPred } from './groups.ts'

const maskVals = new WeakMap<Uint8Array, Int32Array>()
/** Positions set in a row mask, shifted by one (group-level values of a row-map component). */
function setPositionsPlusOne(mask: Uint8Array): Int32Array {
  let v = maskVals.get(mask)
  if (!v) {
    let n = 0
    for (let i = 0; i < mask.length; i++) if (mask[i]) n++
    v = new Int32Array(n)
    let k = 0
    for (let i = 0; i < mask.length; i++) if (mask[i]) v[k++] = i + 1
    maskVals.set(mask, v)
  }
  return v
}

export interface ColFilter {
  kind: 'col'
  col: Col
  /** allowed dictionary ids of `col`, sorted, unique */
  codes: Int32Array
  /** lazily built bitmap over the dictionary */
  mask?: Uint8Array
}

export function colMask(f: ColFilter): Uint8Array {
  if (!f.mask || f.mask.length !== f.col.dict.length) {
    const m = new Uint8Array(f.col.dict.length)
    for (const c of f.codes) m[c] = 1
    f.mask = m
  }
  return f.mask
}
export interface TupleFilter {
  kind: 'tuple'
  cols: Col[]
  /** distinct tuples of dictionary ids */
  tuples: Int32Array[]
  projections?: Map<string, Set<number> | Set<string>>
}
export interface RowsFilter {
  kind: 'rows'
  table: Tbl
  /** sorted row ids of `table` */
  ids: Int32Array
  /** expanded-table filter (table expression used as a filter) vs. own columns only (context transition, RLS) */
  expanded: boolean
  /** column ids removed by ALL/REMOVEFILTERS since creation */
  removed: ReadonlySet<number>
  mask?: Uint8Array
}
export type Filter = ColFilter | TupleFilter | RowsFilter

export type RelMode = 'none' | 'single' | 'both'

const EMPTY_SET: ReadonlySet<number> = new Set()

export class RelConfig {
  private keyCache: string | null = null
  constructor(
    readonly model: DaxModel,
    readonly overrides: ReadonlyMap<Rel, { active?: boolean; mode?: RelMode }> = new Map()
  ) {}
  get key(): string {
    if (this.keyCache === null) {
      const parts: string[] = []
      for (const [r, o] of this.overrides) parts.push(`${r.id}:${o.active === undefined ? '' : o.active ? 'a' : 'i'}${o.mode ?? ''}`)
      this.keyCache = parts.sort().join(',')
    }
    return this.keyCache
  }
  /** Whether an override can open an "uphill" path (CROSSFILTER BOTH, USERELATIONSHIP of a relationship). */
  get addsUphill(): boolean {
    if (this.uphill === null) {
      this.uphill = false
      for (const o of this.overrides.values()) if (o.mode === 'both' || o.active === true) this.uphill = true
    }
    return this.uphill
  }
  private uphill: boolean | null = null
  /** Candidate relationships for incoming filters into `s` under this configuration. */
  uphillCandidates(s: Tbl): Rel[] {
    return this.addsUphill ? incomingCandidates(this.model, s) : staticUphillCandidates(this.model, s)
  }
  active(r: Rel): boolean {
    return this.overrides.get(r)?.active ?? r.isActive
  }
  mode(r: Rel): RelMode {
    return this.overrides.get(r)?.mode ?? r.cross
  }
  /** effective: active and not disabled */
  effective(r: Rel): boolean {
    return this.active(r) && this.mode(r) !== 'none'
  }
  /** derived configurations, interned so per-configuration caches (expansions...) are shared across evaluations */
  private derived = new Map<string, RelConfig>()
  useRelationship(rel: Rel): RelConfig {
    const dk = 'u' + rel.id
    const hit = this.derived.get(dk)
    if (hit) return hit
    const out = this.useRelationshipNew(rel)
    this.derived.set(dk, out)
    return out
  }
  private useRelationshipNew(rel: Rel): RelConfig {
    const next = new Map(this.overrides)
    for (const other of this.model.relationships) {
      if (other === rel) continue
      const sameTables =
        (other.from.table === rel.from.table && other.to.table === rel.to.table) || (other.from.table === rel.to.table && other.to.table === rel.from.table)
      // activating a relationship deactivates the active one that links the same tables (and any other that would
      // make the path to the one side ambiguous)
      const sameTarget = other.from.table === rel.from.table && other.to.table === rel.to.table
      if ((sameTables || sameTarget) && this.active(other)) next.set(other, { ...next.get(other), active: false })
    }
    next.set(rel, { ...next.get(rel), active: true })
    return new RelConfig(this.model, next)
  }
  crossFilter(rel: Rel, mode: RelMode): RelConfig {
    const dk = 'c' + rel.id + mode
    const hit = this.derived.get(dk)
    if (hit) return hit
    const next = new Map(this.overrides)
    next.set(rel, { ...next.get(rel), mode })
    const out = new RelConfig(this.model, next)
    this.derived.set(dk, out)
    return out
  }
}

export interface Step {
  table: Tbl
  /** relationships from the root to this table (each from -> to) */
  path: Rel[]
}
export interface Expansion {
  table: Tbl
  steps: Step[]
  stepOf: Map<Tbl, Step>
  /** ids of every column of the expanded table (lazy) */
  colIds?: Set<number>
  /** every column of the expanded table (lazy) */
  cols?: Col[]
}

export function expandedIds(e: Expansion): Set<number> {
  if (!e.colIds) {
    const s = new Set<number>()
    for (const st of e.steps) for (const c of st.table.cols) s.add(c.id)
    e.colIds = s
  }
  return e.colIds
}

const expansionCaches = new WeakMap<DaxModel, { version: number; map: Map<string, Expansion> }>()

const cfgExpansions = new WeakMap<RelConfig, { version: number; map: Map<Tbl, Expansion> }>()

export function expansion(model: DaxModel, cfg: RelConfig, table: Tbl): Expansion {
  let fast = cfgExpansions.get(cfg)
  if (!fast || fast.version !== model.version) {
    fast = { version: model.version, map: new Map() }
    cfgExpansions.set(cfg, fast)
  }
  const hitFast = fast.map.get(table)
  if (hitFast) return hitFast
  let c = expansionCaches.get(model)
  if (!c || c.version !== model.version) {
    c = { version: model.version, map: new Map() }
    expansionCaches.set(model, c)
  }
  const key = cfg.key + '|' + table.name
  let e = c.map.get(key)
  if (e) {
    fast.map.set(table, e)
    return e
  }
  const steps: Step[] = [{ table, path: [] }]
  const stepOf = new Map<Tbl, Step>([[table, steps[0]]])
  for (let s = 0; s < steps.length; s++) {
    const cur = steps[s]
    for (const r of model.relationships) {
      if (r.kind === 'mm' || r.from.table !== cur.table || !cfg.effective(r)) continue
      if (stepOf.has(r.to.table)) continue // ambiguous paths are rejected by Power BI; first path wins
      const st = { table: r.to.table, path: [...cur.path, r] }
      steps.push(st)
      stepOf.set(r.to.table, st)
    }
  }
  e = { table, steps, stepOf }
  c.map.set(key, e)
  fast.map.set(table, e)
  return e
}

// ---------------------------------------------------------------------------------------------
// Filter constructors
// ---------------------------------------------------------------------------------------------

export function colFilter(col: Col, codes: Iterable<number>): ColFilter {
  const n = col.dict.length
  const arr: number[] = []
  for (const c of codes) if (c >= 0 && c < n) arr.push(c)
  arr.sort((a, b) => a - b)
  let k = 0
  for (let i = 0; i < arr.length; i++) if (i === 0 || arr[i] !== arr[i - 1]) arr[k++] = arr[i]
  arr.length = k
  return { kind: 'col', col, codes: Int32Array.from(arr) }
}

/** Single-value filter (group-by cells, context transition): no allocation proportional to the dictionary. */
export function eqFilter(col: Col, code: number): ColFilter {
  return { kind: 'col', col, codes: code >= 0 ? Int32Array.of(code) : new Int32Array(0) }
}

export function colFilterFromMask(col: Col, allow: Uint8Array): ColFilter {
  const arr: number[] = []
  for (let i = 0; i < allow.length; i++) if (allow[i]) arr.push(i)
  return { kind: 'col', col, codes: Int32Array.from(arr), mask: allow }
}

/** Filter over model columns from value tuples (values that do not occur in a column match nothing). */
export function valuesFilter(cols: Col[], tuples: Scalar[][]): Filter {
  if (cols.length === 1) {
    const col = cols[0]
    const codes: number[] = []
    for (const t of tuples) {
      const c = col.codeOf(t[0])
      if (c >= 0) codes.push(c)
    }
    return colFilter(col, codes)
  }
  const seen = new Set<string>()
  const out: Int32Array[] = []
  outer: for (const t of tuples) {
    const codes = new Int32Array(cols.length)
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i].codeOf(t[i])
      if (c < 0) continue outer
      codes[i] = c
    }
    const k = codes.join(',')
    if (seen.has(k)) continue
    seen.add(k)
    out.push(codes)
  }
  return { kind: 'tuple', cols, tuples: out }
}

export function tupleFilterFromCodes(cols: Col[], tuples: Int32Array[]): Filter {
  if (cols.length === 1) return colFilter(cols[0], tuples.map((t) => t[0]))
  const seen = new Set<string>()
  const out: Int32Array[] = []
  for (const t of tuples) {
    const k = t.join(',')
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return { kind: 'tuple', cols, tuples: out }
}

export function rowsFilter(table: Tbl, ids: Int32Array, expanded: boolean): RowsFilter {
  let sorted = true
  for (let i = 1; i < ids.length; i++) if (ids[i] <= ids[i - 1]) {
    sorted = false
    break
  }
  if (!sorted) ids = Int32Array.from(new Set(ids)).sort()
  return { kind: 'rows', table, ids, expanded, removed: EMPTY_SET }
}

function rowsMask(f: RowsFilter): Uint8Array {
  if (!f.mask || f.mask.length !== f.table.fullCount) {
    const m = new Uint8Array(f.table.fullCount)
    for (const id of f.ids) if (id < m.length) m[id] = 1
    f.mask = m
  }
  return f.mask
}

/** Columns a filter constrains (for ISFILTERED, KEEPFILTERS overrides, removal). */
export function filterColumns(model: DaxModel, cfg: RelConfig, f: Filter): Col[] {
  if (f.kind === 'col') return [f.col]
  if (f.kind === 'tuple') return f.cols
  const tables = f.expanded ? expansion(model, cfg, f.table).steps.map((s) => s.table) : [f.table]
  const out: Col[] = []
  for (const t of tables) for (const c of t.cols) if (!f.removed.has(c.id)) out.push(c)
  return out
}

export function filterTouches(model: DaxModel, cfg: RelConfig, f: Filter, ids: ReadonlySet<number>): boolean {
  if (f.kind === 'col') return ids.has(f.col.id)
  if (f.kind === 'tuple') return f.cols.some((c) => ids.has(c.id))
  const tables = f.expanded ? expansion(model, cfg, f.table).steps.map((st) => st.table) : [f.table]
  for (const t of tables) for (const c of t.cols) if (ids.has(c.id) && !f.removed.has(c.id)) return true
  return false
}

/** Remove columns from a filter (projection). Returns null when nothing remains. */
function projectOut(model: DaxModel, cfg: RelConfig, f: Filter, ids: ReadonlySet<number>): Filter | null {
  if (f.kind === 'col') return ids.has(f.col.id) ? null : f
  if (f.kind === 'tuple') {
    const keep: number[] = []
    f.cols.forEach((c, i) => {
      if (!ids.has(c.id)) keep.push(i)
    })
    if (keep.length === f.cols.length) return f
    if (keep.length === 0) return null
    return tupleFilterFromCodes(
      keep.map((i) => f.cols[i]),
      f.tuples.map((t) => Int32Array.from(keep.map((i) => t[i])))
    )
  }
  const cols = filterColumns(model, cfg, f)
  const hit = cols.filter((c) => ids.has(c.id))
  if (hit.length === 0) return f
  if (hit.length === cols.length) return null
  const removed = new Set(f.removed)
  for (const c of hit) removed.add(c.id)
  const projected: RowsFilter = { ...f, removed, mask: undefined }
  return rowLevelExact(model, cfg, projected) ? projected : rowsToTuple(model, cfg, projected)
}

const uniqueColCaches = new WeakMap<DaxModel, { version: number; map: Map<Tbl, Set<number>> }>()
/** Columns of t whose values identify a row (all distinct, none blank). */
function uniqueColumns(model: DaxModel, t: Tbl): Set<number> {
  let c = uniqueColCaches.get(model)
  if (!c || c.version !== model.version) {
    c = { version: model.version, map: new Map() }
    uniqueColCaches.set(model, c)
  }
  let s = c.map.get(t)
  if (!s) {
    s = new Set()
    for (const col of t.cols) {
      if (col.dict.length - 1 !== t.rowCount) continue
      let ok = true
      for (let r = 0; r < t.rowCount && ok; r++) if (col.codes[r] === 0) ok = false
      if (ok) s.add(col.id)
    }
    c.map.set(t, s)
  }
  return s
}

/**
 * A row filter with some columns removed means "the distinct remaining-column tuples of the filtered rows". Keeping
 * it as a row filter is exact only when every partially removed table still has a column that identifies its rows.
 */
function rowLevelExact(model: DaxModel, cfg: RelConfig, f: RowsFilter): boolean {
  const tables = f.expanded ? expansion(model, cfg, f.table).steps.map((s) => s.table) : [f.table]
  for (const t of tables) {
    let some = false
    let all = true
    for (const c of t.cols) {
      if (f.removed.has(c.id)) some = true
      else all = false
    }
    if (!some || all) continue
    const u = uniqueColumns(model, t)
    let kept = false
    for (const id of u) if (!f.removed.has(id)) kept = true
    if (!kept) return false
  }
  return true
}

/** Exact projection of a row filter onto its remaining columns as a tuple filter (value semantics). */
function rowsToTuple(model: DaxModel, cfg: RelConfig, f: RowsFilter): Filter | null {
  const exp = expansion(model, cfg, f.table)
  const steps = f.expanded ? exp.steps : exp.steps.slice(0, 1)
  const cols: Col[] = []
  const arrays: Int32Array[] = []
  for (const st of steps) {
    for (const c of st.table.cols) {
      if (f.removed.has(c.id)) continue
      cols.push(c)
      arrays.push(model.codesVia(st.path, c))
    }
  }
  if (cols.length === 0) return null
  const tuples: Int32Array[] = []
  for (const id of f.ids) {
    const tu = new Int32Array(cols.length)
    for (let j = 0; j < cols.length; j++) tu[j] = arrays[j][id]
    tuples.push(tu)
  }
  return tupleFilterFromCodes(cols, tuples)
}

// ---------------------------------------------------------------------------------------------
// FilterContext
// ---------------------------------------------------------------------------------------------

type Pred =
  | { k: 'codes'; codes: Int32Array; allowed: Int32Array; allow: Uint8Array | null; f: ColFilter | null; postKey: string; dictSize: number }
  | { k: 'mask'; map: Int32Array | null; mask: Uint8Array }
  | { k: 'tuple'; codes: Int32Array[]; radix: number[] | null; set: Set<number> | Set<string>; domains: number[] | null; offset: number }
  /** row-id filter on the table itself (context transition, table filters): drives the scan by its ids */
  | { k: 'rows'; f: RowsFilter }

function isFullyRemoved(t: Tbl, removed: ReadonlySet<number>): boolean {
  if (removed.size === 0) return false
  for (const c of t.cols) if (!removed.has(c.id)) return false
  return true
}

export interface ContextInit {
  filters?: readonly Filter[]
  cfg?: RelConfig
  shadow?: readonly Filter[] | null
  scope?: ReadonlySet<number>
  secure?: readonly Filter[]
}

export class FilterContext {
  readonly filters: readonly Filter[]
  readonly cfg: RelConfig
  readonly shadow: readonly Filter[] | null
  readonly scope: ReadonlySet<number>
  /** row-level security filters: always applied, never removed by ALL / REMOVEFILTERS */
  readonly secure: readonly Filter[]
  private visibleCache = new Map<Tbl, Int32Array>()
  private incomingCache = new Map<string, Uint8Array | null>()
  private sigCache: string | null = null

  constructor(
    readonly model: DaxModel,
    init: ContextInit = {}
  ) {
    this.filters = init.filters ?? []
    this.cfg = init.cfg ?? new RelConfig(model)
    this.shadow = init.shadow ?? null
    this.scope = init.scope ?? EMPTY_SET
    this.secure = init.secure ?? []
  }

  with(changes: ContextInit): FilterContext {
    return new FilterContext(this.model, {
      filters: changes.filters ?? this.filters,
      cfg: changes.cfg ?? this.cfg,
      shadow: changes.shadow !== undefined ? changes.shadow : this.shadow,
      scope: changes.scope ?? this.scope,
      secure: changes.secure ?? this.secure
    })
  }

  expansion(t: Tbl): Expansion {
    return expansion(this.model, this.cfg, t)
  }

  expandedColumns(t: Tbl): Col[] {
    const e = this.expansion(t)
    return (e.cols ??= e.steps.flatMap((s) => s.table.cols))
  }

  /** Key of the group-by scope (ISINSCOPE) and ALLSELECTED shadow. */
  scopeShadowKey(): string {
    if (this.scopeShadowCache === null) {
      this.scopeShadowCache = `${this.scope.size ? [...this.scope].sort((a, b) => a - b).join(',') : ''}|${this.shadow ? shadowKey(this.shadow) : '-'}`
    }
    return this.scopeShadowCache
  }
  private scopeShadowCache: string | null = null

  /**
   * Content key of the context: equal keys = equal filter contexts (same filters by value, relationship overrides,
   * group-by scope, ALLSELECTED shadow and RLS). Used to share measure results between cells that end up in the same
   * context (e.g. a rolling 12-month window evaluated for every day of a month).
   */
  contentKey(): string {
    if (this.contentKeyCache === null) {
      const fk = this.filters.map(filterContentKey).sort().join(';')
      const sk = this.shadow ? shadowKey(this.shadow) : '-'
      const sec = this.secure.length ? this.secure.map(filterContentKey).sort().join(';') : ''
      this.contentKeyCache = `${fk}|${this.cfg.key}|${[...this.scope].sort((a, b) => a - b).join(',')}|${sk}|${sec}`
    }
    return this.contentKeyCache
  }
  private contentKeyCache: string | null = null

  /** Stable-ish identity of the context for caches (filters by object identity). */
  signature(ids: (f: Filter) => number): string {
    if (this.sigCache === null) this.sigCache = this.filters.map(ids).join(',') + '|' + this.cfg.key + '|' + [...this.scope].join(',')
    return this.sigCache
  }

  // ---- modifications ------------------------------------------------------------------------------

  removeColumns(ids: ReadonlySet<number>, dropScope = false): FilterContext {
    if (ids.size === 0) return this
    const out: Filter[] = []
    let changed = false
    for (const f of this.filters) {
      if (!filterTouches(this.model, this.cfg, f, ids)) {
        out.push(f)
        continue
      }
      changed = true
      const p = projectOut(this.model, this.cfg, f, ids)
      if (p) out.push(p)
    }
    let scope = this.scope
    if (dropScope && [...scope].some((s) => ids.has(s))) {
      scope = new Set([...scope].filter((s) => !ids.has(s)))
      changed = true
    }
    let shadow = this.shadow
    return changed ? this.with({ filters: out, scope, shadow }) : this
  }

  removeAll(): FilterContext {
    return this.with({ filters: [], scope: EMPTY_SET })
  }

  /** Add filters; when `replace`, existing filters on the same columns are removed first (CALCULATE semantics). */
  addFilters(fs: readonly Filter[], replace: boolean): FilterContext {
    if (fs.length === 0) return this
    let base: FilterContext = this
    if (replace) {
      const ids = new Set<number>()
      for (const f of fs) for (const c of filterColumns(this.model, this.cfg, f)) ids.add(c.id)
      base = this.removeColumns(ids)
    }
    return base.with({ filters: [...base.filters, ...fs] })
  }

  isFiltered(col: Col): boolean {
    for (const f of this.filters) {
      if (f.kind === 'col') {
        if (f.col === col) return true
      } else if (f.kind === 'tuple') {
        if (f.cols.includes(col)) return true
      } else if (!f.removed.has(col.id)) {
        if (f.table === col.table) return true
        if (f.expanded && this.expansion(f.table).stepOf.has(col.table)) return true
      }
    }
    return false
  }

  /** Filters (projected) restricted to the given columns: used by ALLSELECTED and FILTERS. */
  filtersOn(ids: ReadonlySet<number>, source: readonly Filter[] = this.filters): Filter[] {
    const out: Filter[] = []
    for (const f of source) {
      if (!filterTouches(this.model, this.cfg, f, ids)) continue
      const other = new Set<number>()
      for (const c of filterColumns(this.model, this.cfg, f)) if (!ids.has(c.id)) other.add(c.id)
      const p = other.size ? projectOut(this.model, this.cfg, f, other) : f
      if (p) out.push(p)
    }
    return out
  }

  // ---- visibility -----------------------------------------------------------------------------------

  /** Sorted row ids of `t` visible in this context (may include the blank row, index rowCount). */
  visible(t: Tbl): Int32Array {
    const hit = this.visibleCache.get(t)
    if (hit) return hit
    // shared across contexts: the rows of t only depend on the filters that reach t
    const key = this.relevantKey(t)
    const shared = key !== null ? sharedVisible(this.model) : null
    let v = key !== null ? shared!.get(key) : undefined
    if (!v) {
      v = this.computeVisible(t)
      if (key !== null) {
        if (shared!.size > 4000) shared!.clear()
        shared!.set(key, v)
      }
    }
    this.visibleCache.set(t, v)
    return v
  }

  /**
   * Content key of what determines t's visible rows (filters on t's expanded table, relationship overrides, RLS), or
   * null when bidirectional / weak relationships make every filter potentially relevant.
   */
  relevantKey(t: Tbl): string | null {
    if (!this.noUphillFilters(t)) return null
    const ids = expandedIds(this.expansion(t))
    const parts: string[] = []
    for (const f of this.filters) if (filterTouches(this.model, this.cfg, f, ids)) parts.push(filterContentKey(f))
    for (const f of this.secure) parts.push('S' + filterContentKey(f))
    return `${t.name}|${this.cfg.key}|${parts.sort().join(';')}`
  }

  isUnfiltered(t: Tbl): boolean {
    return this.visible(t).length === t.fullCount
  }

  /** Whether some row of `t` is visible (cheap path for ISEMPTY / existence checks). */
  hasRows(t: Tbl): boolean {
    return this.visible(t).length > 0
  }

  /** Row predicates of `t` in this context; 'all' = unfiltered, 'none' = nothing visible. */
  private predsFor(t: Tbl): Pred[] | 'all' | 'none' {
    const exp = this.expansion(t)
    const preds: Pred[] = []
    for (const f of this.secure) this.addPred(f, t, exp, preds)
    for (const f of this.filters) this.addPred(f, t, exp, preds)
    for (const st of exp.steps) {
      const allowed = this.incoming(st.table, st.path[st.path.length - 1] ?? null)
      if (allowed) preds.push({ k: 'mask', map: st.path.length ? this.model.pathRowMap(st.path) : null, mask: allowed })
    }
    if (preds.length === 0) return 'all'
    for (const p of preds) {
      if (p.k === 'codes' && p.allowed.length === 0) return 'none'
    }
    return preds
  }

  /** Group-level form of the predicates (see groups.ts), or null when some predicate needs row identity. */
  private groupPlan(t: Tbl, preds: Pred[]): { idx: GroupIndex; gpreds: GroupPred[] } | null {
    const comps: Comp[] = []
    const compOf = new Map<Int32Array, number>()
    const comp = (arr: Int32Array, domain: number, offset: number): number => {
      let j = compOf.get(arr)
      if (j === undefined) {
        j = comps.length
        comps.push({ arr, domain, offset })
        compOf.set(arr, j)
      }
      return j
    }
    const pending: Array<(m: number[]) => GroupPred> = []
    for (const p of preds) {
      if (p.k === 'codes') {
        const j = comp(p.codes, p.dictSize, 0)
        const allow = p.allow ?? (p.allow = p.f ? colMask(p.f) : maskOf(p.allowed, p.dictSize))
        const vals = p.allowed
        pending.push((m) => ({ k: 'one', comp: m[j], allow, vals }))
      } else if (p.k === 'rows') {
        return null
      } else if (p.k === 'mask') {
        if (!p.map) return null
        const j = comp(p.map, p.mask.length + 1, 1)
        const mask = p.mask
        pending.push((m) => {
          const allow = new Uint8Array(mask.length + 1)
          allow.set(mask, 1)
          return { k: 'one', comp: m[j], allow, vals: setPositionsPlusOne(mask) }
        })
      } else {
        if (!p.domains) return null
        const js = p.codes.map((a, q) => comp(a, p.domains![q] + p.offset, p.offset))
        const radix = p.radix
        const set = p.set
        const vals = new Int32Array(js.length)
        pending.push((m) => {
          const mj = js.map((j) => m[j])
          return {
            k: 'tuple',
            comps: mj,
            test: (keys, g) => {
              for (let q = 0; q < mj.length; q++) vals[q] = keys[mj[q]][g]
              if (radix) {
                let v = 0
                for (let q = 0; q < mj.length; q++) v = v * radix[q] + vals[q]
                return (set as Set<number>).has(v)
              }
              return (set as Set<string>).has(vals.join(','))
            }
          }
        })
      }
    }
    const hit = groupIndex(this.model, t, comps)
    if (!hit) return null
    return { idx: hit.idx, gpreds: pending.map((f) => f(hit.map)) }
  }

  /**
   * Aggregate over the visible rows of `col.table` (or count rows of `t`) without materializing them, when a group
   * index applies (large table, every predicate a function of grouped keys). null = use the row path.
   */
  aggregate(t: Tbl, col: Col | null, kind: AggKind): { value: number; any: boolean } | null {
    if (t.fullCount < GROUP_MIN_ROWS || this.visibleCache.has(t)) return null
    const preds = this.predsFor(t)
    if (preds === 'all') return null
    if (preds === 'none') return { value: kind === 'min' || kind === 'max' ? -1 : 0, any: false }
    const plan = this.groupPlan(t, preds)
    if (!plan) return null
    return aggregateGroups(plan.idx, passingGroups(plan.idx, plan.gpreds), col, kind)
  }

  private computeVisible(t: Tbl): Int32Array {
    const pr = this.predsFor(t)
    if (pr === 'all') return t.all()
    if (pr === 'none') return EMPTY_IDS
    const preds = pr
    const n = t.fullCount
    // a row-id filter on t itself is the best driver when it is the most selective
    let rowsDriver: Extract<Pred, { k: 'rows' }> | null = null
    for (const p of preds) if (p.k === 'rows' && (!rowsDriver || p.f.ids.length < rowsDriver.f.ids.length)) rowsDriver = p
    if (rowsDriver && rowsDriver.f.ids.length < n / 4) {
      const rest = preds.filter((p) => p !== rowsDriver)
      return scanCandidates(rowsDriver.f.ids, rest)
    }
    // choose the most selective code predicate as driver
    let driver: Extract<Pred, { k: 'codes' }> | null = null
    let driverEst = n
    let driverPost: { offsets: Int32Array; rows: Int32Array } | null = null
    for (const p of preds) {
      if (p.k !== 'codes') continue
      if (p.allowed.length > p.dictSize / 2 && p.dictSize > 8) continue
      const post = this.model.postings(p.postKey, p.codes, p.dictSize, n)
      let est = 0
      for (const c of p.allowed) est += post.offsets[c + 1] - post.offsets[c]
      if (est < driverEst) {
        driverEst = est
        driver = p
        driverPost = post
      }
    }
    if (n >= GROUP_MIN_ROWS && (!driver || driverEst > 4096)) {
      const plan = this.groupPlan(t, preds)
      if (plan) return rowsOfGroups(plan.idx, passingGroups(plan.idx, plan.gpreds))
    }
    let candidates: Int32Array | null = null
    if (driver && driverPost && driverEst < n * 0.6) {
      if (driver.allowed.length === 1) {
        const code = driver.allowed[0]
        candidates = driverPost.rows.subarray(driverPost.offsets[code], driverPost.offsets[code + 1])
      } else {
        const buf = new Int32Array(driverEst)
        let k = 0
        for (const c of driver.allowed) {
          for (let j = driverPost.offsets[c]; j < driverPost.offsets[c + 1]; j++) buf[k++] = driverPost.rows[j]
        }
        candidates = buf.sort()
      }
      preds.splice(preds.indexOf(driver), 1)
      if (preds.length === 0) return candidates.slice()
    }
    return scanCandidates(candidates, preds, n)
  }

  private addPred(f: Filter, t: Tbl, exp: Expansion, preds: Pred[]): void {
    const model = this.model
    if (f.kind === 'col') {
      const st = exp.stepOf.get(f.col.table)
      if (!st) return
      const codes = model.codesVia(st.path, f.col)
      preds.push({ k: 'codes', codes, allowed: f.codes, allow: null, f, postKey: postKey(st.path, f.col), dictSize: f.col.dict.length })
      return
    }
    if (f.kind === 'tuple') {
      const pos: number[] = []
      f.cols.forEach((c, i) => {
        if (exp.stepOf.has(c.table)) pos.push(i)
      })
      if (pos.length === 0) return
      if (pos.length === 1) {
        const i = pos[0]
        const c = f.cols[i]
        const st = exp.stepOf.get(c.table)!
        const cf = colFilter(c, f.tuples.map((tu) => tu[i]))
        preds.push({ k: 'codes', codes: model.codesVia(st.path, c), allowed: cf.codes, allow: null, f: cf, postKey: postKey(st.path, c), dictSize: c.dict.length })
        return
      }
      const cols = pos.map((i) => f.cols[i])
      const codes = cols.map((c) => model.codesVia(exp.stepOf.get(c.table)!.path, c))
      const radix = radixFor(cols)
      const key = pos.join(',')
      f.projections ??= new Map()
      let set = f.projections.get(key + (radix ? '#' : '$'))
      if (!set) {
        if (radix) {
          const s = new Set<number>()
          for (const tu of f.tuples) {
            let v = 0
            for (let j = 0; j < pos.length; j++) v = v * radix[j] + tu[pos[j]]
            s.add(v)
          }
          set = s
        } else {
          const s = new Set<string>()
          for (const tu of f.tuples) s.add(pos.map((p) => tu[p]).join(','))
          set = s
        }
        f.projections.set(key + (radix ? '#' : '$'), set)
      }
      preds.push({ k: 'tuple', codes, radix, set, domains: cols.map((c) => c.dict.length), offset: 0 })
      return
    }
    // rows filter
    const F = f.table
    const fRemoved = isFullyRemoved(F, f.removed)
    if (!fRemoved) {
      const st = exp.stepOf.get(F)
      if (st) {
        if (st.path.length === 0) preds.push({ k: 'rows', f })
        else preds.push({ k: 'mask', map: model.pathRowMap(st.path), mask: rowsMask(f) })
        return
      }
    }
    if (!f.expanded) return
    const fexp = this.expansion(F)
    const common: Step[] = []
    for (const s of fexp.steps) {
      if (s.table === F) continue
      if (isFullyRemoved(s.table, f.removed)) continue
      if (exp.stepOf.has(s.table)) common.push(s)
    }
    if (common.length === 0) return
    // if t itself is in F's expansion, a mask over t's rows captures everything t can see
    const self = common.find((s) => s.table === t)
    const targets = self ? [self] : common
    if (targets.length === 1) {
      const s = targets[0]
      const fmap = model.pathRowMap(s.path)!
      const mask = new Uint8Array(s.table.fullCount)
      for (const id of f.ids) {
        const x = fmap[id]
        if (x >= 0) mask[x] = 1
      }
      const tst = exp.stepOf.get(s.table)!
      preds.push({ k: 'mask', map: tst.path.length ? model.pathRowMap(tst.path) : null, mask })
      return
    }
    // joint constraint over several shared tables: tuple of related row ids
    const fmaps = targets.map((s) => model.pathRowMap(s.path)!)
    let groupable = true
    const tmaps = targets.map((s) => {
      const tst = exp.stepOf.get(s.table)!
      if (!tst.path.length) groupable = false
      return tst.path.length ? model.pathRowMap(tst.path)! : t.all()
    })
    const set = new Set<string>()
    for (const id of f.ids) set.add(fmaps.map((m) => m[id]).join(','))
    preds.push({ k: 'tuple', codes: tmaps, radix: null, set, domains: groupable ? targets.map((s) => s.table.fullCount + 1) : null, offset: 1 })
  }

  /** True when no bidirectional / one-to-one / weak relationship can restrict any table of t's expanded table. */
  noUphillFilters(t: Tbl): boolean {
    // depends on the relationship configuration only
    let m = noUphillCache.get(this.cfg)
    if (!m || m.version !== this.model.version) noUphillCache.set(this.cfg, (m = { version: this.model.version, map: new Map() }))
    let v = m.map.get(t)
    if (v === undefined) {
      v = this.noUphillFiltersNew(t)
      m.map.set(t, v)
    }
    return v
  }
  private noUphillFiltersNew(t: Tbl): boolean {
    for (const st of this.expansion(t).steps) {
      const via = st.path[st.path.length - 1] ?? null
      for (const r of this.cfg.uphillCandidates(st.table)) {
        if (r === via || !this.cfg.active(r)) continue
        const mode = this.cfg.mode(r)
        if (mode === 'none') continue
        if (r.kind === 'mm' || mode === 'both') return false
      }
    }
    return true
  }

  /**
   * Restriction on rows of `s` coming from relationships whose filters flow "uphill" into it: bidirectional and
   * one-to-one relationships (from their many side) and weak many-to-many relationships. `via` is the
   * relationship through which the caller reached `s` (that path is already filtered) or null.
   */
  private incoming(s: Tbl, via: Rel | null): Uint8Array | null {
    const candidates = this.cfg.uphillCandidates(s)
    if (candidates.length === 0) return null
    const key = s.name + '|' + (via?.id ?? '')
    if (this.incomingCache.has(key)) return this.incomingCache.get(key)!
    // guard against re-entrance through cycles
    this.incomingCache.set(key, null)
    let allowed: Uint8Array | null = null
    const model = this.model
    for (const r of candidates) {
      if (r === via || !this.cfg.active(r)) continue
      const mode = this.cfg.mode(r)
      if (mode === 'none') continue
      if (r.kind === 'mm') {
        // weak relationship: filters flow to -> from, and from -> to when bidirectional
        let other: Col | null = null
        let mine: Col | null = null
        if (r.from.table === s) {
          other = r.to
          mine = r.from
        } else if (r.to.table === s && mode === 'both') {
          other = r.from
          mine = r.to
        }
        if (!other || !mine) continue
        const own = expandedIds(this.expansion(s))
        const relevant = this.filters.filter((f) => !filterTouches(model, this.cfg, f, own))
        const rkey = `mm|${r.id}|${s.name}|${this.cfg.key}|${relevant.map(filterId).join(',')}|${this.secure.map(filterId).join(',')}`
        const cache = restrictionCache(model)
        if (cache.has(rkey)) {
          const hit = cache.get(rkey)!
          if (hit) allowed = intersect(allowed, hit)
          continue
        }
        const nested = this.with({ filters: relevant, cfg: this.cfg.crossFilter(r, 'none'), secure: this.secure })
        const vis = nested.visible(other.table)
        if (vis.length === other.table.fullCount) {
          cache.set(rkey, null)
          continue
        }
        const otherCodes = new Uint8Array(other.dict.length)
        for (const id of vis) otherCodes[other.codes[id]] = 1
        const mineAllow = new Uint8Array(mine.dict.length)
        for (let c = 1; c < otherCodes.length; c++) {
          if (!otherCodes[c]) continue
          const mc = mine.codeOf(other.dict[c])
          if (mc >= 0) mineAllow[mc] = 1
        }
        const mask = new Uint8Array(s.fullCount)
        for (let i = 0; i < s.fullCount; i++) mask[i] = mineAllow[mine.codes[i]]
        cache.set(rkey, mask)
        allowed = intersect(allowed, mask)
        continue
      }
      if (r.to.table !== s || mode !== 'both') continue
      const many = r.from.table
      const own = expandedIds(this.expansion(s))
      const relevant = this.filters.filter((f) => !filterTouches(model, this.cfg, f, own))
      if (relevant.length === 0 && this.secure.length === 0) continue
      const rkey = `bi|${r.id}|${this.cfg.key}|${relevant.map(filterId).join(',')}|${this.secure.map(filterId).join(',')}`
      const cache = restrictionCache(model)
      if (cache.has(rkey)) {
        const hit = cache.get(rkey)!
        if (hit) allowed = intersect(allowed, hit)
        continue
      }
      const nested = this.with({ filters: relevant, cfg: this.cfg.crossFilter(r, 'single'), secure: this.secure })
      const vis = nested.visible(many)
      if (vis.length === many.fullCount) {
        cache.set(rkey, null)
        continue
      }
      const map = model.relRowMap(r)
      const mask = new Uint8Array(s.fullCount)
      for (const id of vis) {
        const x = map[id]
        if (x >= 0) mask[x] = 1
      }
      cache.set(rkey, mask)
      allowed = intersect(allowed, mask)
    }
    this.incomingCache.set(key, allowed)
    return allowed
  }
}

const EMPTY_IDS = new Int32Array(0)
const noUphillCache = new WeakMap<RelConfig, { version: number; map: Map<Tbl, boolean> }>()

const sharedVisibles = new WeakMap<DaxModel, { version: number; map: Map<string, Int32Array> }>()
function sharedVisible(model: DaxModel): Map<string, Int32Array> {
  let c = sharedVisibles.get(model)
  if (!c || c.version !== model.version) {
    c = { version: model.version, map: new Map() }
    sharedVisibles.set(model, c)
  }
  return c.map
}

/** Rows among `candidates` (all rows 0..n-1 when null) that pass every predicate. */
function scanCandidates(candidates: Int32Array | null, preds: Pred[], n = 0): Int32Array {
  for (const p of preds) {
    if (p.k === 'codes' && !p.allow) p.allow = p.f ? colMask(p.f) : maskOf(p.allowed, p.dictSize)
  }
  const total = candidates ? candidates.length : n
  if (preds.length === 0) return candidates ? candidates.slice() : Int32Array.from({ length: n }, (_, i) => i)
  const out = new Int32Array(total)
  let k = 0
  const np = preds.length
  for (let j = 0; j < total; j++) {
    const r = candidates ? candidates[j] : j
    let ok = true
    for (let q = 0; q < np && ok; q++) {
      const p = preds[q]
      if (p.k === 'codes') ok = p.allow![p.codes[r]] === 1
      else if (p.k === 'mask') {
        const x = p.map ? p.map[r] : r
        ok = x >= 0 && p.mask[x] === 1
      } else if (p.k === 'rows') ok = rowsMask(p.f)[r] === 1
      else ok = tupleOk(p, r)
    }
    if (ok) out[k++] = r
  }
  return out.slice(0, k)
}

/** 2 x 32-bit FNV-style hash of an int array (collision odds ~2^-64), plus its length. */
function hashInts(a: ArrayLike<number>): string {
  let h1 = 0x811c9dc5
  let h2 = 0x9747b28c
  for (let i = 0; i < a.length; i++) {
    const v = a[i]
    h1 = Math.imul(h1 ^ v, 0x01000193)
    h2 = Math.imul(h2 ^ (v + 0x9e3779b9), 0x5bd1e995)
    h2 ^= h2 >>> 15
  }
  return `${a.length}:${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`
}
function intsKey(a: ArrayLike<number>): string {
  return a.length <= 64 ? Array.prototype.join.call(a, ',') : hashInts(a)
}

const contentKeys = new WeakMap<Filter, string>()
export function filterContentKey(f: Filter): string {
  let k = contentKeys.get(f)
  if (k !== undefined) return k
  if (f.kind === 'col') k = `c${f.col.id}:${intsKey(f.codes)}`
  else if (f.kind === 'tuple') {
    // tuples as a set: order-independent combination of per-tuple hashes (tuples are distinct)
    let s1 = 0
    let s2 = 0
    for (const t of f.tuples) {
      let h1 = 0x811c9dc5
      let h2 = 0x9747b28c
      for (let i = 0; i < t.length; i++) {
        h1 = Math.imul(h1 ^ t[i], 0x01000193)
        h2 = Math.imul(h2 ^ (t[i] + 0x9e3779b9), 0x5bd1e995)
      }
      s1 = (s1 + (h1 >>> 0)) % 4294967291
      s2 = (s2 ^ (h2 >>> 0)) >>> 0
    }
    k = `t${f.cols.map((c) => c.id).join('.')}:${f.tuples.length}:${s1.toString(36)}${s2.toString(36)}`
  } else k = `r${f.table.name}:${f.expanded ? 1 : 0}:${[...f.removed].sort((a, b) => a - b).join('.')}:${intsKey(f.ids)}`
  contentKeys.set(f, k)
  return k
}
const shadowKeys = new WeakMap<readonly Filter[], string>()
function shadowKey(s: readonly Filter[]): string {
  let k = shadowKeys.get(s)
  if (k === undefined) {
    k = s.map(filterContentKey).sort().join(';')
    shadowKeys.set(s, k)
  }
  return k
}

let nextFilterId = 1
const filterIds = new WeakMap<Filter, number>()
function filterId(f: Filter): number {
  let id = filterIds.get(f)
  if (id === undefined) {
    id = nextFilterId++
    filterIds.set(f, id)
  }
  return id
}
const restrictionCaches = new WeakMap<DaxModel, { version: number; map: Map<string, Uint8Array | null> }>()
function restrictionCache(model: DaxModel): Map<string, Uint8Array | null> {
  let c = restrictionCaches.get(model)
  if (!c || c.version !== model.version) {
    c = { version: model.version, map: new Map() }
    restrictionCaches.set(model, c)
  }
  if (c.map.size > 20_000) c.map.clear()
  return c.map
}

const candidateCaches = new WeakMap<DaxModel, { version: number; map: Map<Tbl, Rel[]> }>()
/** Relationships through which filters could flow "uphill" into `s` (bidirectional / one-to-one / weak). */
function incomingCandidates(model: DaxModel, s: Tbl): Rel[] {
  let c = candidateCaches.get(model)
  if (!c || c.version !== model.version) {
    c = { version: model.version, map: new Map() }
    candidateCaches.set(model, c)
  }
  let list = c.map.get(s)
  if (!list) {
    // CROSSFILTER ( ..., BOTH ) can turn any regular relationship bidirectional, so every relationship whose
    // one side is `s` is a candidate; the effective mode is checked per context.
    list = model.relationships.filter((r) => (r.kind === 'mm' ? r.from.table === s || r.to.table === s : r.to.table === s))
    c.map.set(s, list)
  }
  return list
}

const staticCaches = new WeakMap<DaxModel, { version: number; map: Map<Tbl, Rel[]> }>()
/** Incoming candidates that are uphill without overrides: weak and bidirectional relationships. */
function staticUphillCandidates(model: DaxModel, s: Tbl): Rel[] {
  const own = s.uphillCache
  if (own && own.version === model.version) return own.list
  s.uphillCache = { version: model.version, list: staticUphillList(model, s) }
  return s.uphillCache.list
}
function staticUphillList(model: DaxModel, s: Tbl): Rel[] {
  let c = staticCaches.get(model)
  if (!c || c.version !== model.version) {
    c = { version: model.version, map: new Map() }
    staticCaches.set(model, c)
  }
  let list = c.map.get(s)
  if (!list) {
    list = incomingCandidates(model, s).filter((r) => r.kind === 'mm' || r.cross === 'both')
    c.map.set(s, list)
  }
  return list
}

function postKey(path: Rel[], c: Col): string {
  return path.map((r) => r.id).join('>') + '|' + c.id
}

function maskOf(codes: Int32Array, n: number): Uint8Array {
  const m = new Uint8Array(n)
  for (const c of codes) m[c] = 1
  return m
}

function radixFor(cols: Col[]): number[] | null {
  let prod = 1
  const r = cols.map((c) => c.dict.length)
  for (const x of r) prod *= x
  return prod < 2 ** 50 ? r : null
}

function tupleOk(p: Extract<Pred, { k: 'tuple' }>, r: number): boolean {
  if (p.radix) {
    let v = 0
    for (let j = 0; j < p.codes.length; j++) v = v * p.radix[j] + p.codes[j][r]
    return (p.set as Set<number>).has(v)
  }
  let s = ''
  for (let j = 0; j < p.codes.length; j++) s += (j ? ',' : '') + p.codes[j][r]
  return (p.set as Set<string>).has(s)
}

function intersect(a: Uint8Array | null, b: Uint8Array): Uint8Array {
  if (!a) return b
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] & b[i]
  return out
}
