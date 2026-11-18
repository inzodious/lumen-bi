/**
 * Group index: the rows of a (large) table grouped by the tuple of "key arrays" that the filter predicates of a
 * context read — dictionary codes of filtered columns (own or reached through relationships) and relationship row
 * maps (filters that arrive as row masks of a related table, e.g. FILTER ( ALL ( 'Date' ), ... ) in a rolling-window
 * measure). Every predicate of such a context is a function of the key tuple, so it can be evaluated once per group
 * instead of once per row, driven by per-key postings; simple aggregations (SUM, COUNT, COUNTROWS, MIN, MAX) read
 * per-group partial aggregates and never materialize the rows. This is what VertiPaq's storage engine does with a
 * group-by scan; here the grouping is built once per key-array combination and reused by every cell of a visual.
 *
 * An index is only kept when it compresses well (groups <= rows / 3); otherwise the caller scans rows.
 */
import type { Col, DaxModel, Tbl } from './model.ts'
import { KahanSum } from './values.ts'

export interface Comp {
  /** key array over the table's rows (codes, or related-row ids with -1 for "no row") */
  arr: Int32Array
  /** number of distinct key values after adding `offset` */
  domain: number
  /** 1 for row maps (shifts -1 to 0), 0 for codes */
  offset: number
}

export interface GroupIndex {
  table: Tbl
  comps: Comp[]
  /** group id of every row */
  groupOf: Int32Array
  G: number
  /** key value (raw, without offset) of each group, per component */
  keys: Int32Array[]
  /** rows of each group, ascending: rows[offsets[g] .. offsets[g+1]) */
  rowOffsets: Int32Array
  rows: Int32Array
  /** per-component postings: groups having key value v (with offset) */
  postings: Array<{ offsets: Int32Array; groups: Int32Array } | undefined>
  aggs: Map<string, unknown>
}

const arrIds = new WeakMap<Int32Array, number>()
let nextArrId = 1
function arrId(a: Int32Array): number {
  let id = arrIds.get(a)
  if (id === undefined) {
    id = nextArrId++
    arrIds.set(a, id)
  }
  return id
}

const caches = new WeakMap<DaxModel, { version: number; map: Map<Tbl, { indexes: GroupIndex[]; failed: Set<string> }> }>()

/** Minimum table size for which grouping is attempted. */
export const GROUP_MIN_ROWS = 40_000

let groupingEnabled = true
/** Tests: disable the group path to compare against the row path. */
export function setGroupingEnabled(on: boolean): void {
  groupingEnabled = on
}

/**
 * An index over (at least) the requested key arrays, with the position of each requested array in it. A cached
 * index over a superset of the arrays is reused (grouping by more keys is still exact); a new index is built over the
 * union with the table's largest index when that still compresses, so a visual converges to one or two indexes.
 */
export function groupIndex(model: DaxModel, t: Tbl, comps: Comp[]): { idx: GroupIndex; map: number[] } | null {
  if (!groupingEnabled) return null
  let c = caches.get(model)
  if (!c || c.version !== model.version) {
    c = { version: model.version, map: new Map() }
    caches.set(model, c)
  }
  let entry = c.map.get(t)
  if (!entry) {
    entry = { indexes: [], failed: new Set() }
    c.map.set(t, entry)
  }
  const mapInto = (idx: GroupIndex): number[] | null => {
    const out: number[] = []
    for (const x of comps) {
      const j = idx.comps.findIndex((y) => y.arr === x.arr)
      if (j < 0) return null
      out.push(j)
    }
    return out
  }
  // smallest cached index covering the request
  let best: { idx: GroupIndex; map: number[] } | null = null
  for (const idx of entry.indexes) {
    const m = mapInto(idx)
    if (m && (!best || idx.G < best.idx.G)) best = { idx, map: m }
  }
  if (best) return best
  const ids = comps.map((x) => arrId(x.arr)).sort((a, b) => a - b)
  const key = ids.join(',')
  if (entry.failed.has(key)) return null
  // grouping by more keys cannot compress better than a key set that already failed
  for (const f of entry.failed) {
    const fs = f.split(',').map(Number)
    if (fs.every((x) => ids.includes(x))) return null
  }
  const widest = entry.indexes.reduce<GroupIndex | null>((w, i) => (!w || i.comps.length > w.comps.length ? i : w), null)
  let idx: GroupIndex | null = null
  if (widest) {
    const union = [...widest.comps]
    for (const x of comps) if (!union.some((y) => y.arr === x.arr)) union.push(x)
    if (union.length <= 24) idx = build(t, union)
  }
  idx ??= build(t, comps)
  if (!idx) {
    entry.failed.add(key)
    return null
  }
  entry.indexes.push(idx)
  if (entry.indexes.length > 8) entry.indexes.shift()
  return { idx, map: mapInto(idx)! }
}

function build(t: Tbl, comps: Comp[]): GroupIndex | null {
  const n = t.fullCount
  let prod = 1
  for (const c of comps) prod *= c.domain
  if (!(prod < 2 ** 52)) return null
  const mult: number[] = []
  let m = 1
  for (let j = comps.length - 1; j >= 0; j--) {
    mult[j] = m
    m *= comps[j].domain
  }
  // cheap pre-check on a strided sample: nearly all-distinct keys mean the index will not compress (a failed full
  // build of a large table costs ~100 ms)
  if (n > 200_000) {
    const step = Math.floor(n / 16384)
    const seen = new Set<number>()
    let samples = 0
    for (let r = 0; r < n; r += step) {
      let key = 0
      for (let j = 0; j < comps.length; j++) key += (comps[j].arr[r] + comps[j].offset) * mult[j]
      seen.add(key)
      samples++
    }
    if (seen.size > samples * 0.8) return null
  }
  const groupOf = new Int32Array(n)
  // an index pays off when it compresses the table well (it is cached and reused across queries)
  const maxG = Math.floor(n / 8) + 1
  const sampleAt = Math.floor(n / 5)
  const keyVals: number[][] = comps.map(() => [])
  let G = 0
  const dense = prod <= 4_000_000 ? new Int32Array(prod).fill(-1) : null
  const sparse = dense ? null : new Map<number, number>()
  const k = comps.length
  for (let r = 0; r < n; r++) {
    let key = 0
    for (let j = 0; j < k; j++) key += (comps[j].arr[r] + comps[j].offset) * mult[j]
    let g = dense ? dense[key] : sparse!.get(key) ?? -1
    if (g < 0) {
      g = G++
      if (G > maxG) return null
      if (dense) dense[key] = g
      else sparse!.set(key, g)
      for (let j = 0; j < k; j++) keyVals[j].push(comps[j].arr[r])
    }
    groupOf[r] = g
    // early abort: after a fifth of the rows, a group count close to the row count will not compress
    if (r === sampleAt && G > r * 0.5) return null
  }
  // rows by group (counting sort keeps rows ascending within a group)
  const rowOffsets = new Int32Array(G + 1)
  for (let r = 0; r < n; r++) rowOffsets[groupOf[r] + 1]++
  for (let g = 0; g < G; g++) rowOffsets[g + 1] += rowOffsets[g]
  const pos = rowOffsets.slice(0, G)
  const rows = new Int32Array(n)
  for (let r = 0; r < n; r++) rows[pos[groupOf[r]]++] = r
  return { table: t, comps, groupOf, G, keys: keyVals.map((v) => Int32Array.from(v)), rowOffsets, rows, postings: comps.map(() => undefined), aggs: new Map() }
}

export function compPostings(idx: GroupIndex, j: number): { offsets: Int32Array; groups: Int32Array } {
  let p = idx.postings[j]
  if (p) return p
  const { domain, offset } = idx.comps[j]
  const keys = idx.keys[j]
  const offsets = new Int32Array(domain + 1)
  for (let g = 0; g < idx.G; g++) offsets[keys[g] + offset + 1]++
  for (let v = 0; v < domain; v++) offsets[v + 1] += offsets[v]
  const at = offsets.slice(0, domain)
  const groups = new Int32Array(idx.G)
  for (let g = 0; g < idx.G; g++) groups[at[keys[g] + offset]++] = g
  p = { offsets, groups }
  idx.postings[j] = p
  return p
}

/** Group-level predicate: single component with an allow mask over its (offset) values, or a tuple test. */
export type GroupPred =
  /** `vals`: the allowed values (with offset), when known — avoids scanning `allow` */
  | { k: 'one'; comp: number; allow: Uint8Array; vals?: ArrayLike<number> }
  | { k: 'tuple'; comps: number[]; test: (vals: Int32Array[], g: number) => boolean }

/** Groups whose key tuple passes every predicate. */
export function passingGroups(idx: GroupIndex, preds: GroupPred[]): Int32Array {
  // driver: the single-component predicate selecting the fewest groups
  let driver: Extract<GroupPred, { k: 'one' }> | null = null
  let best = idx.G
  let driverVals: number[] = []
  for (const p of preds) {
    if (p.k !== 'one') continue
    const post = compPostings(idx, p.comp)
    let est = 0
    const vals: number[] = []
    const allow = p.allow
    if (p.vals) {
      for (let q = 0; q < p.vals.length; q++) {
        const v = p.vals[q]
        const cnt = post.offsets[v + 1] - post.offsets[v]
        if (cnt) {
          est += cnt
          vals.push(v)
        }
      }
    } else {
      for (let v = 0; v < allow.length; v++) {
        if (!allow[v]) continue
        const cnt = post.offsets[v + 1] - post.offsets[v]
        if (cnt) {
          est += cnt
          vals.push(v)
        }
      }
    }
    if (est < best || !driver) {
      if (est <= best) {
        best = est
        driver = p
        driverVals = vals
      }
    }
  }
  let cand: Int32Array
  if (driver && best < idx.G * 0.7) {
    const post = compPostings(idx, driver.comp)
    cand = new Int32Array(best)
    let k = 0
    for (const v of driverVals) for (let q = post.offsets[v]; q < post.offsets[v + 1]; q++) cand[k++] = post.groups[q]
  } else {
    driver = null
    cand = new Int32Array(idx.G)
    for (let g = 0; g < idx.G; g++) cand[g] = g
  }
  const rest = preds.filter((p) => p !== driver)
  if (rest.length === 0) return cand
  const out = new Int32Array(cand.length)
  let k = 0
  const keys = idx.keys
  const comps = idx.comps
  for (let i = 0; i < cand.length; i++) {
    const g = cand[i]
    let ok = true
    for (let q = 0; q < rest.length && ok; q++) {
      const p = rest[q]
      if (p.k === 'one') ok = p.allow[keys[p.comp][g] + comps[p.comp].offset] === 1
      else ok = p.test(keys, g)
    }
    if (ok) out[k++] = g
  }
  return out.subarray(0, k)
}

/** Sorted rows of the given groups. */
export function rowsOfGroups(idx: GroupIndex, groups: Int32Array): Int32Array {
  let total = 0
  for (const g of groups) total += idx.rowOffsets[g + 1] - idx.rowOffsets[g]
  const n = idx.table.fullCount
  if (total > n / 8) {
    const mark = new Uint8Array(n)
    for (const g of groups) for (let q = idx.rowOffsets[g]; q < idx.rowOffsets[g + 1]; q++) mark[idx.rows[q]] = 1
    const out = new Int32Array(total)
    let k = 0
    for (let r = 0; r < n; r++) if (mark[r]) out[k++] = r
    return out
  }
  const out = new Int32Array(total)
  let k = 0
  for (const g of groups) for (let q = idx.rowOffsets[g]; q < idx.rowOffsets[g + 1]; q++) out[k++] = idx.rows[q]
  return groups.length > 1 ? out.sort() : out
}

export type AggKind = 'sum' | 'count' | 'rows' | 'min' | 'max'

interface SumAgg {
  sum: Float64Array
  comp: Float64Array
  cnt: Int32Array
}

function sumAgg(idx: GroupIndex, col: Col): SumAgg {
  const key = 's|' + col.id
  let a = idx.aggs.get(key) as SumAgg | undefined
  if (a) return a
  const sum = new Float64Array(idx.G)
  const comp = new Float64Array(idx.G)
  const cnt = new Int32Array(idx.G)
  const codes = col.codes
  const num = col.num
  const go = idx.groupOf
  for (let r = 0; r < go.length; r++) {
    const c = codes[r]
    if (c === 0) continue
    const g = go[r]
    // Kahan per group
    const y = num[c] - comp[g]
    const t = sum[g] + y
    comp[g] = t - sum[g] - y
    sum[g] = t
    cnt[g]++
  }
  a = { sum, comp, cnt }
  idx.aggs.set(key, a)
  return a
}

function minMaxAgg(idx: GroupIndex, col: Col, max: boolean): Int32Array {
  const key = (max ? 'M|' : 'm|') + col.id
  let a = idx.aggs.get(key) as Int32Array | undefined
  if (a) return a
  a = new Int32Array(idx.G).fill(-1)
  const codes = col.codes
  const num = col.num
  const go = idx.groupOf
  for (let r = 0; r < go.length; r++) {
    const c = codes[r]
    if (c === 0) continue
    const g = go[r]
    const b = a[g]
    if (b < 0 || (max ? num[c] > num[b] : num[c] < num[b])) a[g] = c
  }
  idx.aggs.set(key, a)
  return a
}

/**
 * Aggregate a numeric column (or count rows) over the given groups. Returns the dictionary code for min/max (-1 when
 * none), the sum / count otherwise; `any` = some non-blank value (sum) / some row (rows).
 */
export function aggregateGroups(idx: GroupIndex, groups: Int32Array, col: Col | null, kind: AggKind): { value: number; any: boolean } {
  if (kind === 'rows') {
    let n = 0
    for (const g of groups) n += idx.rowOffsets[g + 1] - idx.rowOffsets[g]
    return { value: n, any: n > 0 }
  }
  if (kind === 'sum' || kind === 'count') {
    const a = sumAgg(idx, col!)
    if (kind === 'count') {
      let n = 0
      for (const g of groups) n += a.cnt[g]
      return { value: n, any: n > 0 }
    }
    const k = new KahanSum()
    let any = false
    for (const g of groups) {
      if (a.cnt[g] === 0) continue
      any = true
      k.add(a.sum[g])
    }
    return { value: k.sum, any }
  }
  const a = minMaxAgg(idx, col!, kind === 'max')
  const num = col!.num
  let best = -1
  for (const g of groups) {
    const c = a[g]
    if (c < 0) continue
    if (best < 0 || (kind === 'max' ? num[c] > num[best] : num[c] < num[best])) best = c
  }
  return { value: best, any: best >= 0 }
}
