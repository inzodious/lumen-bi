/**
 * Visual calculations (PBIR NativeVisualCalculation): DAX evaluated over the visual matrix.
 *
 * The visual matrix holds one row per cell of the visual's lattice: every combination of a ROWS level (0 = total ..
 * number of row fields) and a COLUMNS level, with the group keys present at that level and the values of the visual's
 * fields there (totals are real evaluations at the total level, like Power BI). It is materialized as the only table
 * of a small DaxModel, so visual calculations are ordinary DAX over that table:
 *  - each cell is evaluated with a row context on its row (so [Sales Amount] is the cell's value) and a filter
 *    context that selects exactly that cell (so SUM ( [Sales Amount] ), CALCULATE ( ..., RANGE ( ... ) ) work);
 *  - RUNNINGSUM, MOVINGAVERAGE, PREVIOUS, NEXT, FIRST, LAST, RANGE and the window functions ROWNUMBER, RANK, INDEX,
 *    OFFSET, WINDOW with an axis traverse the cells of the same level along the axis (ROWS, COLUMNS, ROWS COLUMNS,
 *    COLUMNS ROWS), in ascending order of the axis' group values, partitioned by the Reset level;
 *  - COLLAPSE / COLLAPSEALL evaluate at a parent / the total cell; EXPAND / EXPANDALL evaluate over the child /
 *    leaf cells (filter context only); LOOKUP / LOOKUPWITHTOTALS evaluate at the cell with the given values;
 *    ISATLEVEL tells whether a field is grouped at the current cell.
 * Visual calculations can reference the visual's fields and earlier visual calculations, not model objects.
 */
import type { DataType } from '../../model/types.ts'
import { DaxError } from './errors.ts'
import type { Evaluator } from './evaluator.ts'
import { eqFilter, FilterContext, type Filter } from './filters.ts'
import { DaxModel, type Col, type Tbl } from './model.ts'
import type { Node } from './parser.ts'
import { defineFn, type Env } from './registry.ts'
import { TableValue, type TCol } from './table.ts'
import { KahanSum, sortCompare, toBool, toNumber, type Scalar } from './values.ts'
import { parseOrderBy, windowCompare, type OrderItem } from './window-order.ts'

export interface VisualCell {
  rowLevel: number
  colLevel: number
  /** group keys in field order (row fields then column fields); null where the level does not group by the field */
  keys: Scalar[]
  values: Scalar[]
  /** added by densification (no data at this combination) */
  densified?: boolean
}

export interface VisualMatrixSpec {
  /** row-axis fields then column-axis fields */
  groupNames: string[]
  groupTypes: DataType[]
  rowFields: number
  valueNames: string[]
  valueTypes: DataType[]
  cells: VisualCell[]
  /** sort value of a group key (sort-by columns), defaults to the key */
  sortValue?: (field: number, v: Scalar) => Scalar
}

export interface VisualCtx {
  vm: VisualMatrix
  /** current cell (row context), or null inside EXPAND / LOOKUP over several cells */
  cell: number | null
}

const LEVEL_R = '\u0001RowLevel'
const LEVEL_C = '\u0001ColLevel'

export class VisualMatrix {
  readonly model = new DaxModel()
  readonly table: Tbl
  readonly groupCols: Col[]
  readonly rowFields: number
  readonly colFields: number
  private rl: Col
  private cl: Col
  private index = new Map<string, number>()
  readonly cells: VisualCell[]
  private sortValue: (field: number, v: Scalar) => Scalar
  private tv: TableValue | null = null

  constructor(spec: VisualMatrixSpec) {
    this.cells = spec.cells
    this.rowFields = spec.rowFields
    this.colFields = spec.groupNames.length - spec.rowFields
    this.sortValue = spec.sortValue ?? ((_f, v) => v)
    const t = this.model.addTable('Visual')
    t.rowCount = spec.cells.length
    const used = new Set<string>()
    const unique = (n: string) => {
      let name = n
      let k = 2
      while (used.has(name.toLowerCase())) name = `${n} (${k++})`
      used.add(name.toLowerCase())
      return name
    }
    const values = new Map<Col, Scalar[]>()
    this.groupCols = spec.groupNames.map((n, j) => {
      const c = t.addColumn(unique(n), spec.groupTypes[j] ?? 'unknown', 'data')
      values.set(c, spec.cells.map((x) => x.keys[j]))
      return c
    })
    spec.valueNames.forEach((n, j) => {
      const c = t.addColumn(unique(n), spec.valueTypes[j] ?? 'unknown', 'data')
      values.set(c, spec.cells.map((x) => x.values[j] ?? null))
    })
    this.rl = t.addColumn(LEVEL_R, 'int64', 'data')
    this.cl = t.addColumn(LEVEL_C, 'int64', 'data')
    values.set(this.rl, spec.cells.map((x) => x.rowLevel))
    values.set(this.cl, spec.cells.map((x) => x.colLevel))
    for (const c of t.cols) c.isHidden = c === this.rl || c === this.cl
    t.setRows(spec.cells.length, values)
    this.table = t
    this.model.computeBlankRows()
    spec.cells.forEach((c, i) => this.index.set(this.cellKey(c.rowLevel, c.colLevel, c.keys), i))
  }

  /** Add a computed visual calculation as a column (later calculations can reference it). */
  addColumn(name: string, values: Scalar[], dataType: DataType): Col {
    const c = this.table.addColumn(name, dataType, 'calculated')
    c.setValues(values)
    this.model.invalidateCaches()
    this.tv = null
    return c
  }

  get tableValue(): TableValue {
    if (!this.tv) this.tv = TableValue.fromBase(this.table, this.table.all().subarray(0, this.table.rowCount))
    return this.tv
  }

  private cellKey(rl: number, cl: number, keys: readonly Scalar[]): string {
    const parts: string[] = [String(rl), String(cl)]
    keys.forEach((k, j) => {
      const present = j < this.rowFields ? j < rl : j - this.rowFields < cl
      parts.push(present ? keyOf(k) : '*')
    })
    return parts.join('\u0002')
  }

  find(rl: number, cl: number, keys: readonly Scalar[]): number {
    return this.index.get(this.cellKey(rl, cl, keys)) ?? -1
  }

  /** Filter context selecting the cells of a level whose present keys equal `keys` (prefixes allowed). */
  levelCtx(rl: number, cl: number, keys: readonly Scalar[], fixed: (j: number) => boolean): FilterContext {
    const fs: Filter[] = [eqFilter(this.rl, this.rl.codeOf(rl)), eqFilter(this.cl, this.cl.codeOf(cl))]
    this.groupCols.forEach((c, j) => {
      if (fixed(j)) fs.push(eqFilter(c, c.codeOf(keys[j])))
    })
    return new FilterContext(this.model, { filters: fs })
  }

  cellCtx(i: number): FilterContext {
    const c = this.cells[i]
    return this.levelCtx(c.rowLevel, c.colLevel, c.keys, (j) => this.present(c, j))
  }

  present(c: VisualCell, j: number): boolean {
    return j < this.rowFields ? j < c.rowLevel : j - this.rowFields < c.colLevel
  }

  cellEnv(ev: Evaluator, base: Env, i: number): Env {
    return { ...base, ctx: this.cellCtx(i), rows: [{ t: this.tableValue, i }], transitioned: 1, visual: { vm: this, cell: i }, home: this.table, shadows: [] }
  }

  /** Cells of the same level as `i` along `axis`, partitioned by `reset`, in axis order (blanks per `blanks`). */
  siblings(i: number, axis: Axis, reset: Reset, blanks: Blanks): number[] {
    const me = this.cells[i]
    const R = this.rowFields
    const useRows = axis.includes('ROWS') && R > 0
    const useCols = axis.includes('COLUMNS') && this.colFields > 0
    if (!useRows && !useCols) return [i]
    const rowsFirst = !axis.startsWith('COLUMNS') || !useCols
    // partition: fields that must match the current cell
    const mustMatch = new Set<number>()
    if (!useRows) for (let j = 0; j < me.rowLevel; j++) mustMatch.add(j)
    if (!useCols) for (let j = 0; j < me.colLevel; j++) mustMatch.add(R + j)
    // reset partitions the (first) traversed hierarchy
    const hier = useRows && (rowsFirst || !useCols) ? 'rows' : 'cols'
    const level = hier === 'rows' ? me.rowLevel : me.colLevel
    const depth = hier === 'rows' ? R : this.colFields
    const keep = resetLevel(reset, level, depth, (c) => this.groupCols.indexOf(c) - (hier === 'rows' ? 0 : R))
    for (let j = 0; j < keep; j++) mustMatch.add(hier === 'rows' ? j : R + j)
    const out: number[] = []
    for (let k = 0; k < this.cells.length; k++) {
      const c = this.cells[k]
      if (c.rowLevel !== me.rowLevel || c.colLevel !== me.colLevel) continue
      let ok = true
      for (const j of mustMatch) if (!sameKey(c.keys[j], me.keys[j])) ok = false
      if (ok) out.push(k)
    }
    // order: traversed hierarchies, outer first (ROWS COLUMNS = down the rows, then the next column)
    const rowIdx = Array.from({ length: me.rowLevel }, (_, j) => j)
    const colIdx = Array.from({ length: me.colLevel }, (_, j) => R + j)
    const order = rowsFirst ? [...(useCols ? colIdx : []), ...(useRows ? rowIdx : [])] : [...(useRows ? rowIdx : []), ...(useCols ? colIdx : [])]
    const cmpKey = (x: Scalar, y: Scalar, j: number): number => {
      if (blanks !== 'DEFAULT' && blanks !== 'KEEP' && (x === null) !== (y === null)) return (x === null ? -1 : 1) * (blanks === 'FIRST' ? 1 : -1)
      return sortCompare(this.sortValue(j, x), this.sortValue(j, y)) || sortCompare(x, y)
    }
    out.sort((a, b) => {
      for (const j of order) {
        const c = cmpKey(this.cells[a].keys[j], this.cells[b].keys[j], j)
        if (c) return c
      }
      return a - b
    })
    return out
  }
}

function keyOf(v: Scalar): string {
  if (v === null) return '\u0003'
  if (typeof v === 'string') return 's' + v.toLowerCase()
  if (v instanceof Date) return 'd' + v.getTime()
  return typeof v + ':' + String(v)
}
function sameKey(a: Scalar, b: Scalar): boolean {
  return keyOf(a) === keyOf(b)
}

export type Axis = string
export type Blanks = 'DEFAULT' | 'KEEP' | 'FIRST' | 'LAST'
export type Reset = { kind: 'none' } | { kind: 'abs'; n: number } | { kind: 'rel'; n: number } | { kind: 'col'; col: Col }

/** Number of leading hierarchy levels that partition at `level` (Microsoft's absolute / relative reset tables). */
function resetLevel(reset: Reset, level: number, depth: number, indexOf: (c: Col) => number): number {
  if (level === 0) return 0
  switch (reset.kind) {
    case 'none':
      return 0
    case 'abs':
      return Math.min(Math.min(reset.n, depth), level)
    case 'col': {
      const k = indexOf(reset.col) + 1
      return k > 0 ? Math.min(k, level) : 0
    }
    case 'rel':
      // valid values are -1 .. -(N-1); lower values use -(N-1)
      return Math.max(0, level - Math.min(reset.n, Math.max(1, depth - 1)))
  }
}

// ------------------------------------------------------------------------------------------------
// argument parsing
// ------------------------------------------------------------------------------------------------

const AXIS_WORDS = /^(ROWS|COLUMNS|ROWPAGES)( (ROWS|COLUMNS|ROWPAGES))*$/

function vctx(env: Env, fn: string): VisualCtx {
  const v = env.visual
  if (!v) throw new DaxError('VISUALCALC', `${fn} can only be used in a visual calculation.`)
  return v
}

interface Opts {
  axis: Axis
  blanks: Blanks
  reset: Reset
  rest: Node[]
}

/** Optional trailing arguments: axis, blanks, reset (in that order, any omitted); other nodes are returned in `rest`. */
function trailing(ev: Evaluator, args: Node[], env: Env): Opts {
  const vm = env.visual!.vm
  const o: Opts = { axis: vm.rowFields > 0 ? 'ROWS' : 'COLUMNS', blanks: 'DEFAULT', reset: { kind: 'none' }, rest: [] }
  for (const a of args) {
    if (a.kind === 'ident') {
      const u = a.name.toUpperCase()
      if (u === '__MISSING__') continue
      if (AXIS_WORDS.test(u)) {
        o.axis = u
        continue
      }
      if (u === 'DEFAULT' || u === 'KEEP' || u === 'FIRST' || u === 'LAST') {
        o.blanks = u as Blanks
        continue
      }
      if (u === 'NONE') {
        o.reset = { kind: 'none' }
        continue
      }
      if (u === 'HIGHESTPARENT') {
        o.reset = { kind: 'abs', n: 1 }
        continue
      }
      if (u === 'LOWESTPARENT') {
        o.reset = { kind: 'rel', n: 1 }
        continue
      }
    }
    if (a.kind === 'column') {
      const c = vm.table.column(a.name)
      if (c && vm.groupCols.includes(c)) {
        o.reset = { kind: 'col', col: c }
        continue
      }
    }
    if (a.kind === 'number' || (a.kind === 'unary' && a.op === '-' && a.operand.kind === 'number')) {
      const n = Math.trunc(toNumber(ev.scalar(a, env)))
      o.reset = n === 0 ? { kind: 'none' } : n > 0 ? { kind: 'abs', n } : { kind: 'rel', n: -n }
      continue
    }
    o.rest.push(a)
  }
  return o
}

function evalAt(ev: Evaluator, expr: Node, env: Env, cell: number): Scalar {
  const vm = env.visual!.vm
  return ev.scalar(expr, vm.cellEnv(ev, env, cell))
}

function current(env: Env, fn: string): number {
  const v = vctx(env, fn)
  if (v.cell === null) throw new DaxError('VISUALCALC', `${fn} needs a single current cell of the visual matrix.`)
  return v.cell
}

// ------------------------------------------------------------------------------------------------
// functions
// ------------------------------------------------------------------------------------------------

defineFn(
  'RUNNINGSUM',
  (ev, a, env) => {
    const i = current(env, 'RUNNINGSUM')
    const o = trailing(ev, a.slice(1), env)
    const sib = env.visual!.vm.siblings(i, o.axis, o.reset, o.blanks)
    const pos = sib.indexOf(i)
    const k = new KahanSum()
    let any = false
    for (let q = 0; q <= pos; q++) {
      const v = evalAt(ev, a[0], env, sib[q])
      if (v === null) continue
      k.add(toNumber(v))
      any = true
    }
    return any ? k.sum : null
  },
  { min: 1, max: 5 }
)

defineFn(
  'MOVINGAVERAGE',
  (ev, a, env) => {
    const i = current(env, 'MOVINGAVERAGE')
    const w = Math.trunc(toNumber(ev.scalar(a[1], env)))
    if (w < 1) throw new DaxError('ARG', 'MOVINGAVERAGE: the window size must be at least 1.')
    let includeCurrent = true
    let rest = a.slice(2)
    if (rest[0] && (rest[0].kind === 'bool' || (rest[0].kind === 'call' && ['TRUE', 'FALSE'].includes(rest[0].name.toUpperCase())))) {
      includeCurrent = toBool(ev.scalar(rest[0], env))
      rest = rest.slice(1)
    }
    const o = trailing(ev, rest, env)
    const sib = env.visual!.vm.siblings(i, o.axis, o.reset, o.blanks)
    const pos = sib.indexOf(i)
    const from = includeCurrent ? pos - w + 1 : pos - w
    const to = includeCurrent ? pos : pos - 1
    const k = new KahanSum()
    let n = 0
    for (let q = Math.max(0, from); q <= to; q++) {
      const v = evalAt(ev, a[0], env, sib[q])
      if (v === null) continue
      k.add(toNumber(v))
      n++
    }
    return n ? k.sum / n : null
  },
  { min: 2, max: 6 }
)

for (const [name, dir] of [['PREVIOUS', -1], ['NEXT', 1]] as const) {
  defineFn(
    name,
    (ev, a, env) => {
      const i = current(env, name)
      let steps = 1
      let rest = a.slice(1)
      if (rest[0] && rest[0].kind === 'number') {
        steps = Math.trunc(rest[0].value)
        rest = rest.slice(1)
      }
      const o = trailing(ev, rest, env)
      const sib = env.visual!.vm.siblings(i, o.axis, o.reset, o.blanks)
      const pos = sib.indexOf(i) + dir * steps
      return pos >= 0 && pos < sib.length ? evalAt(ev, a[0], env, sib[pos]) : null
    },
    { min: 1, max: 5 }
  )
}

for (const [name, last] of [['FIRST', false], ['LAST', true]] as const) {
  defineFn(
    name,
    (ev, a, env) => {
      const i = current(env, name)
      const o = trailing(ev, a.slice(1), env)
      const sib = env.visual!.vm.siblings(i, o.axis, o.reset, o.blanks)
      return sib.length ? evalAt(ev, a[0], env, last ? sib[sib.length - 1] : sib[0]) : null
    },
    { min: 1, max: 4 }
  )
}

defineFn(
  'RANGE',
  (ev, a, env) => {
    const i = current(env, 'RANGE')
    const step = Math.trunc(toNumber(ev.scalar(a[0], env)))
    let includeCurrent = true
    let rest = a.slice(1)
    if (rest[0] && (rest[0].kind === 'bool' || (rest[0].kind === 'call' && ['TRUE', 'FALSE'].includes(rest[0].name.toUpperCase())))) {
      includeCurrent = toBool(ev.scalar(rest[0], env))
      rest = rest.slice(1)
    }
    const o = trailing(ev, rest, env)
    const vm = env.visual!.vm
    const sib = vm.siblings(i, o.axis, o.reset, o.blanks)
    const pos = sib.indexOf(i)
    const pick: number[] = []
    if (step < 0) for (let q = Math.max(0, pos + step); q < pos; q++) pick.push(sib[q])
    if (includeCurrent) pick.push(i)
    if (step > 0) for (let q = pos + 1; q <= Math.min(sib.length - 1, pos + step); q++) pick.push(sib[q])
    return vm.tableValue.select(pick)
  },
  { min: 1, max: 6, table: true }
)

/** Level of a COLLAPSE / EXPAND target: axis argument or explicit field references. */
function navTarget(ev: Evaluator, a: Node[], env: Env, fn: string): { rows: boolean; cols: boolean; fields: Col[] } {
  const vm = vctx(env, fn).vm
  let rows = false
  let cols = false
  const fields: Col[] = []
  for (const x of a) {
    if (x.kind === 'ident' && AXIS_WORDS.test(x.name.toUpperCase())) {
      const u = x.name.toUpperCase()
      rows ||= u.includes('ROWS')
      cols ||= u.includes('COLUMNS')
    } else if (x.kind === 'column') {
      const c = vm.table.column(x.name)
      if (!c || !vm.groupCols.includes(c)) throw new DaxError('VISUALCALC', `${fn}: [${x.name}] is not a grouping field of the visual.`, x)
      fields.push(c)
    } else if (!(x.kind === 'ident' && x.name === '__missing__')) throw new DaxError('ARG', `${fn} expects an axis (ROWS, COLUMNS) or fields of the visual.`, x)
  }
  if (!rows && !cols && !fields.length) {
    if (vm.rowFields > 0) rows = true
    else cols = true
  }
  return { rows, cols, fields }
}

for (const [name, all] of [['COLLAPSE', false], ['COLLAPSEALL', true]] as const) {
  defineFn(
    name,
    (ev, a, env) => {
      const i = current(env, name)
      const vm = env.visual!.vm
      const me = vm.cells[i]
      const t = navTarget(ev, a.slice(1), env, name)
      let rl = me.rowLevel
      let cl = me.colLevel
      if (t.fields.length) {
        for (const c of t.fields) {
          const j = vm.groupCols.indexOf(c)
          if (j < vm.rowFields) rl = Math.min(rl, j)
          else cl = Math.min(cl, j - vm.rowFields)
        }
      } else {
        if (t.rows) rl = all ? 0 : Math.max(0, rl - 1)
        if (t.cols) cl = all ? 0 : Math.max(0, cl - 1)
      }
      const target = vm.find(rl, cl, me.keys)
      return target < 0 ? null : evalAt(ev, a[0], env, target)
    },
    { min: 1 }
  )
}

for (const [name, all] of [['EXPAND', false], ['EXPANDALL', true]] as const) {
  defineFn(
    name,
    (ev, a, env) => {
      const i = current(env, name)
      const vm = env.visual!.vm
      const me = vm.cells[i]
      const t = navTarget(ev, a.slice(1), env, name)
      let rl = me.rowLevel
      let cl = me.colLevel
      if (t.fields.length) {
        for (const c of t.fields) {
          const j = vm.groupCols.indexOf(c)
          if (j < vm.rowFields) rl = Math.max(rl, j + 1)
          else cl = Math.max(cl, j - vm.rowFields + 1)
        }
      } else {
        if (t.rows) rl = all ? vm.rowFields : Math.min(vm.rowFields, rl + 1)
        if (t.cols) cl = all ? vm.colFields : Math.min(vm.colFields, cl + 1)
      }
      if (rl === me.rowLevel && cl === me.colLevel) return evalAt(ev, a[0], env, i)
      // children: cells of the target level under the current cell (filter context only)
      const ctx = vm.levelCtx(rl, cl, me.keys, (j) => vm.present(me, j))
      return ev.scalar(a[0], { ...env, ctx, rows: [], transitioned: 0, visual: { vm, cell: null } })
    },
    { min: 1 }
  )
}

for (const [name, totals] of [['LOOKUP', false], ['LOOKUPWITHTOTALS', true]] as const) {
  defineFn(
    name,
    (ev, a, env) => {
      const v = vctx(env, name)
      const vm = v.vm
      if ((a.length - 1) % 2 !== 0) throw new DaxError('ARG', `${name} takes an expression, then pairs of a field of the visual and a value.`)
      const me = v.cell !== null ? vm.cells[v.cell] : null
      const keys: Scalar[] = me ? [...me.keys] : vm.groupCols.map(() => null)
      const set = new Set<number>()
      for (let k = 1; k < a.length; k += 2) {
        const x = a[k]
        const c = x.kind === 'column' ? vm.table.column(x.name) : undefined
        if (!c || !vm.groupCols.includes(c)) throw new DaxError('VISUALCALC', `${name}: the field is not a grouping field of the visual.`, x)
        const j = vm.groupCols.indexOf(c)
        const val = ev.scalar(a[k + 1], env)
        const code = c.codeOf(val)
        keys[j] = code >= 0 ? c.dict[code] : val
        set.add(j)
      }
      let rl: number
      let cl: number
      if (totals || !me) {
        // unspecified fields are at their total: the level is the deepest specified field of each axis
        rl = 0
        cl = 0
        for (const j of set) {
          if (j < vm.rowFields) rl = Math.max(rl, j + 1)
          else cl = Math.max(cl, j - vm.rowFields + 1)
        }
      } else {
        rl = me.rowLevel
        cl = me.colLevel
        for (const j of set) {
          if (j < vm.rowFields) rl = Math.max(rl, j + 1)
          else cl = Math.max(cl, j - vm.rowFields + 1)
        }
      }
      const present = (j: number) => (j < vm.rowFields ? j < rl : j - vm.rowFields < cl)
      for (let j = 0; j < keys.length; j++) if (present(j) && !set.has(j) && (totals || !me || !vm.present(me, j))) keys[j] = null
      const target = vm.find(rl, cl, keys)
      if (target >= 0) return evalAt(ev, a[0], env, target)
      // fields above the specified ones without a value: evaluate over the matching cells (filter context only)
      const ctx = vm.levelCtx(rl, cl, keys, (j) => present(j) && (set.has(j) || (!totals && !!me && vm.present(me, j))))
      const cells = ctx.visible(vm.table)
      if (cells.length === 0) return null
      if (cells.length === 1) return evalAt(ev, a[0], env, cells[0])
      return ev.scalar(a[0], { ...env, ctx, rows: [], transitioned: 0, visual: { vm, cell: null } })
    },
    { min: 3 }
  )
}

defineFn(
  'ISATLEVEL',
  (_ev, a, env) => {
    const v = vctx(env, 'ISATLEVEL')
    const x = a[0]
    const c = x.kind === 'column' ? v.vm.table.column(x.name) : undefined
    if (!c || !v.vm.groupCols.includes(c)) throw new DaxError('VISUALCALC', 'ISATLEVEL expects a grouping field of the visual.', x)
    if (v.cell === null) return false
    return v.vm.present(v.vm.cells[v.cell], v.vm.groupCols.indexOf(c))
  },
  { min: 1, max: 1 }
)

/**
 * Window functions (ROWNUMBER, RANK, INDEX, OFFSET, WINDOW) in a visual calculation, when the relation is an axis
 * or omitted (Microsoft's "relation or axis" parameter):
 *  - the relation is the cells of the current level along the axis (default: the first axis of the visual),
 *    partitioned by the reset level (reset cannot be combined with ORDERBY / PARTITIONBY: error, like Power BI);
 *  - PARTITIONBY splits that relation further by the values of visual fields / expressions at each cell;
 *  - ORDERBY sorts each partition by expressions evaluated at each cell (direction and per-expression BLANKS
 *    override the function's <blanks>); without ORDERBY the order is the axis order (fields' sort order);
 *  - MATCHBY names the fields that identify the current cell: they must identify one cell of the partition.
 * When ORDERBY does not identify the rows uniquely, Power BI appends "the least number of additional columns"; here
 * ties keep the axis order (= appending the axis fields), which is the same result whenever the axis fields are
 * those columns. RANK keeps ties (SKIP / DENSE). Returns undefined when the relation is a table expression: the
 * regular window function applies.
 */
export function visualWindow(ev: Evaluator, fn: string, a: Node[], env: Env): Scalar | TableValue | undefined {
  const v = env.visual
  if (!v || v.cell === null) return undefined
  const vm = v.vm
  const i = v.cell
  const num = (x: Node) => Math.trunc(toNumber(ev.scalar(x, env)))
  const isMissing = (x: Node | undefined) => !x || (x.kind === 'ident' && x.name === '__missing__')
  const typeWord = (x: Node | undefined) => (x?.kind === 'ident' && ['ABS', 'REL'].includes(x.name.toUpperCase()) ? x.name.toUpperCase() : null)
  // leading arguments
  let rest: Node[]
  let ties: 'SKIP' | 'DENSE' = 'SKIP'
  let lead: { pos?: Node; from?: Node; fromType?: string; to?: Node; toType?: string } = {}
  switch (fn) {
    case 'OFFSET':
    case 'INDEX':
      lead = { pos: a[0] }
      rest = a.slice(1)
      break
    case 'WINDOW': {
      let k = 1
      const ft = typeWord(a[1])
      if (ft || isMissing(a[1])) k = 2
      const to = a[k]
      const tt = typeWord(a[k + 1])
      const k2 = tt || (isMissing(a[k + 1]) && a.length > k + 1) ? k + 2 : k + 1
      lead = { from: a[0], fromType: ft ?? 'REL', to, toType: tt ?? 'REL' }
      rest = a.slice(k2)
      break
    }
    case 'RANK':
      rest = a
      if (rest[0]?.kind === 'ident' && ['DENSE', 'SKIP'].includes(rest[0].name.toUpperCase())) {
        ties = rest[0].name.toUpperCase() as 'SKIP' | 'DENSE'
        rest = rest.slice(1)
      } else if (isMissing(rest[0]) && rest.length > 0) rest = rest.slice(1)
      break
    default:
      rest = a
  }
  // relation / axis, ORDERBY, blanks, PARTITIONBY, MATCHBY, reset (recognized by kind)
  let axis: Axis = vm.rowFields > 0 ? 'ROWS' : 'COLUMNS'
  let blanks: Blanks = 'DEFAULT'
  let reset: Reset | null = null
  const orderBy: OrderItem[] = []
  const partitionBy: Node[] = []
  const matchBy: Node[] = []
  for (const x of rest) {
    if (isMissing(x)) continue
    if (x.kind === 'ident') {
      const u = x.name.toUpperCase()
      if (AXIS_WORDS.test(u)) {
        axis = u
        continue
      }
      if (u === 'DEFAULT' || u === 'KEEP' || u === 'FIRST' || u === 'LAST') {
        blanks = u
        continue
      }
      if (u === 'NONE' || u === 'HIGHESTPARENT' || u === 'LOWESTPARENT') {
        reset = u === 'NONE' ? { kind: 'none' } : u === 'HIGHESTPARENT' ? { kind: 'abs', n: 1 } : { kind: 'rel', n: 1 }
        continue
      }
    }
    if (x.kind === 'call') {
      const u = x.name.toUpperCase()
      if (u === 'ORDERBY') {
        orderBy.push(...parseOrderBy(x.args))
        continue
      }
      if (u === 'PARTITIONBY') {
        partitionBy.push(...x.args)
        continue
      }
      if (u === 'MATCHBY') {
        matchBy.push(...x.args)
        continue
      }
    }
    if (x.kind === 'column') {
      const c = vm.table.column(x.name)
      if (!c || !vm.groupCols.includes(c)) throw new DaxError('VISUALCALC', `${fn}: the reset field [${x.name}] is not a grouping field of the visual.`, x)
      reset = { kind: 'col', col: c }
      continue
    }
    if (x.kind === 'number' || (x.kind === 'unary' && x.op === '-' && x.operand.kind === 'number')) {
      const n = num(x)
      reset = n === 0 ? { kind: 'none' } : n > 0 ? { kind: 'abs', n } : { kind: 'rel', n: -n }
      continue
    }
    return undefined // a table expression as relation: the regular window function
  }
  if (reset && reset.kind !== 'none' && (orderBy.length || partitionBy.length))
    throw new DaxError('VISUALCALC', `${fn}: the reset parameter cannot be used in combination with ORDERBY or PARTITIONBY.`)
  let part = vm.siblings(i, axis, reset ?? { kind: 'none' }, orderBy.length ? 'DEFAULT' : blanks)
  if (partitionBy.length) {
    const pk = (cell: number) => partitionBy.map((p) => keyOf(evalAt(ev, p, env, cell))).join('\u0002')
    const mine = pk(i)
    part = part.filter((c) => c === i || pk(c) === mine)
  }
  let cmp: ((x: number, y: number) => number) | null = null
  if (orderBy.length) {
    const keys = new Map<number, Scalar[]>()
    for (const c of part) keys.set(c, orderBy.map((o) => evalAt(ev, o.expr, env, c)))
    cmp = (x, y) => {
      const kx = keys.get(x)!
      const ky = keys.get(y)!
      for (let k = 0; k < orderBy.length; k++) {
        const c = windowCompare(kx[k], ky[k], orderBy[k].desc, orderBy[k].blanks ?? blanks)
        if (c) return c
      }
      return 0
    }
    const axisPos = new Map(part.map((c, k) => [c, k]))
    part = [...part].sort((x, y) => cmp!(x, y) || axisPos.get(x)! - axisPos.get(y)!)
  }
  let cur = part.indexOf(i)
  if (matchBy.length) {
    const mk = (cell: number) => matchBy.map((m) => keyOf(evalAt(ev, m, env, cell))).join('\u0002')
    const seen = new Set<string>()
    for (const c of part) {
      const k = mk(c)
      if (seen.has(k)) throw new DaxError('VISUALCALC', `${fn}: the MATCHBY columns cannot uniquely identify the rows of the relation.`)
      seen.add(k)
    }
    const mine = mk(i)
    cur = part.findIndex((c) => mk(c) === mine)
  }
  switch (fn) {
    case 'ROWNUMBER':
      return cur + 1
    case 'RANK': {
      if (!cmp) return cur + 1 // axis order: positions are distinct
      if (ties === 'SKIP') {
        let k = cur
        while (k > 0 && cmp(part[k - 1], part[cur]) === 0) k--
        return k + 1
      }
      let rank = 1
      for (let k = 1; k <= cur; k++) if (cmp(part[k - 1], part[k]) !== 0) rank++
      return rank
    }
    case 'INDEX': {
      const pos = num(lead.pos!)
      const k = pos > 0 ? pos - 1 : part.length + pos
      return vm.tableValue.select(pos !== 0 && k >= 0 && k < part.length ? [part[k]] : [])
    }
    case 'OFFSET': {
      const k = cur + num(lead.pos!)
      return vm.tableValue.select(k >= 0 && k < part.length ? [part[k]] : [])
    }
    case 'WINDOW': {
      const res = (x: number, t: string) => (t === 'ABS' ? (x > 0 ? x - 1 : part.length + x) : cur + x)
      const s = Math.max(0, res(num(lead.from!), lead.fromType!))
      const e = Math.min(part.length - 1, res(num(lead.to!), lead.toType!))
      return vm.tableValue.select(s <= e ? part.slice(s, e + 1) : [])
    }
  }
  return undefined
}

/** Evaluate visual calculations in order over the matrix; each result becomes a column usable by the next ones. */
export function evaluateVisualCalcs(
  ev: Evaluator,
  vm: VisualMatrix,
  calcs: Array<{ name: string; ast: Node | null; error?: string }>
): Array<{ values: Scalar[]; error: string | null }> {
  const out: Array<{ values: Scalar[]; error: string | null }> = []
  const root: Env = { ...ev.rootEnv(new FilterContext(vm.model)), home: vm.table }
  ev.home = vm.table
  for (const c of calcs) {
    const values = new Array<Scalar>(vm.cells.length).fill(null)
    let error: string | null = c.error ?? null
    if (c.ast && !error) {
      for (let i = 0; i < vm.cells.length; i++) {
        try {
          values[i] = ev.scalar(c.ast, vm.cellEnv(ev, root, i))
        } catch (e) {
          error ??= e instanceof Error ? e.message : String(e)
          values[i] = null
        }
      }
    }
    vm.addColumn(c.name, values, inferType(values))
    out.push({ values, error })
  }
  return out
}

function inferType(values: Scalar[]): DataType {
  for (const v of values) {
    if (v === null) continue
    if (typeof v === 'number') return 'double'
    if (typeof v === 'string') return 'string'
    if (typeof v === 'boolean') return 'boolean'
    if (v instanceof Date) return 'dateTime'
  }
  return 'double'
}

/**
 * Densification (Power BI's DENSIFY): with both a ROWS and a COLUMNS axis, every row member of a level is crossed
 * with every column member of a level, so visual calculations also run on the combinations without data (their base
 * values are blank). Returns the cells to add (marked `densified`), in lattice order.
 */
export function densifyCells(cells: VisualCell[], rowFields: number, colFields: number): VisualCell[] {
  if (rowFields === 0 || colFields === 0) return []
  const G = rowFields + colFields
  const rowMembers = new Map<number, Map<string, Scalar[]>>()
  const colMembers = new Map<number, Map<string, Scalar[]>>()
  const have = new Set<string>()
  const k = (v: Scalar) => keyOf(v)
  for (const c of cells) {
    const rk = c.keys.slice(0, c.rowLevel)
    const ck = c.keys.slice(rowFields, rowFields + c.colLevel)
    if (!rowMembers.has(c.rowLevel)) rowMembers.set(c.rowLevel, new Map())
    if (!colMembers.has(c.colLevel)) colMembers.set(c.colLevel, new Map())
    rowMembers.get(c.rowLevel)!.set(rk.map(k).join('\u0002'), rk)
    colMembers.get(c.colLevel)!.set(ck.map(k).join('\u0002'), ck)
    have.add(`${c.rowLevel}|${c.colLevel}|${rk.map(k).join('\u0002')}|${ck.map(k).join('\u0002')}`)
  }
  const out: VisualCell[] = []
  for (let rl = 0; rl <= rowFields; rl++) {
    for (let cl = 0; cl <= colFields; cl++) {
      for (const [rkey, rk] of rowMembers.get(rl) ?? []) {
        for (const [ckey, ck] of colMembers.get(cl) ?? []) {
          if (have.has(`${rl}|${cl}|${rkey}|${ckey}`)) continue
          const keys: Scalar[] = new Array(G).fill(null)
          rk.forEach((v, j) => (keys[j] = v))
          ck.forEach((v, j) => (keys[rowFields + j] = v))
          out.push({ rowLevel: rl, colLevel: cl, keys, values: [], densified: true })
        }
      }
    }
  }
  return out
}

/**
 * TABLE '<name>' = <input> WITH VISUAL SHAPE ... (Power BI's visual calculation queries): the input rows (one per
 * cell of the visual lattice, ROLLUPADDISSUBTOTAL total flags telling the level) become a visual matrix; the
 * visual calculations (COLUMN definitions on the table) are evaluated over it in order. The result has the input
 * columns, the DENSIFY flag column (densified combinations added when there are ROWS and COLUMNS axes) and one column
 * per calculation. ROWPAGES axes (small multiples) are not supported (error).
 */
export function visualShapeTable(
  input: TableValue,
  shape: import('./parser.ts').VisualShapeDef,
  calcs: Array<{ name: string; ast: Node }>,
  /** an evaluator over the visual matrix model (with the query's functions) */
  evaluatorFor: (m: DaxModel) => Evaluator
): TableValue {
  if (shape.axes.some((a) => a.axis === 'ROWPAGES')) throw new DaxError('VISUALCALC', 'Visual shapes with a ROWPAGES axis (small multiples) are not supported.')
  const idx = (name: string): number => {
    const j = input.indexOfName(name)
    if (j < 0) throw new DaxError('REF', `The visual shape refers to [${name}], which is not a column of its input table.`)
    return j
  }
  const rowsAxis = shape.axes.find((a) => a.axis === 'ROWS')
  const colsAxis = shape.axes.find((a) => a.axis === 'COLUMNS')
  const levels = [...(rowsAxis?.groups ?? []), ...(colsAxis?.groups ?? [])]
  const R = rowsAxis?.groups.length ?? 0
  const fieldIdx = levels.map((g) => idx(g.cols[0]))
  const totalIdx = levels.map((g) => (g.total ? idx(g.total) : -1))
  const used = new Set<number>([...fieldIdx, ...totalIdx.filter((j) => j >= 0), ...levels.flatMap((g) => g.cols.slice(1).map(idx))])
  const valueIdx = input.cols.map((_, j) => j).filter((j) => !used.has(j))
  // the level of a row on an axis: the first level whose total flag is set
  const levelOf = (i: number, from: number, to: number): number => {
    for (let g = from; g < to; g++) if (totalIdx[g] >= 0 && toBool(input.get(i, totalIdx[g]))) return g - from
    return to - from
  }
  const cells: VisualCell[] = []
  for (let i = 0; i < input.n; i++) {
    const rl = levelOf(i, 0, R)
    const cl = levelOf(i, R, levels.length)
    const keys = fieldIdx.map((j, g) => ((g < R ? g < rl : g - R < cl) ? input.get(i, j) : null))
    cells.push({ rowLevel: rl, colLevel: cl, keys, values: valueIdx.map((j) => input.get(i, j)) })
  }
  const base = cells.length
  if (shape.densify) cells.push(...densifyCells(cells, R, levels.length - R).map((c) => ({ ...c, values: valueIdx.map(() => null) })))
  // axis order: the ORDER BY columns of the level's group (sort-by / attribute columns), else the field itself
  const sortOf = levels.map((g, gi) => {
    const axis = gi < R ? rowsAxis! : colsAxis!
    const sortCol = axis.orderBy.find((o) => g.cols.some((c) => c.toLowerCase() === o.col.toLowerCase()))?.col
    if (!sortCol || sortCol.toLowerCase() === g.cols[0].toLowerCase()) return null
    const sj = idx(sortCol)
    const m = new Map<string, Scalar>()
    for (let i = 0; i < input.n; i++) m.set(keyOf(input.get(i, fieldIdx[gi])), input.get(i, sj))
    return m
  })
  const vm = new VisualMatrix({
    groupNames: levels.map((g) => g.cols[0]),
    groupTypes: fieldIdx.map((j) => input.cols[j].dataType ?? 'unknown'),
    rowFields: R,
    valueNames: valueIdx.map((j) => input.cols[j].name),
    valueTypes: valueIdx.map((j) => input.cols[j].dataType ?? 'unknown'),
    cells,
    sortValue: (f, v) => (sortOf[f] ? (sortOf[f]!.get(keyOf(v)) ?? v) : v)
  })
  const evaluated = evaluateVisualCalcs(evaluatorFor(vm.model), vm, calcs)
  for (let k = 0; k < evaluated.length; k++) if (evaluated[k].error) throw new DaxError('VISUALCALC', `${calcs[k].name}: ${evaluated[k].error}`)
  // output rows: the input rows, then the densified cells (attribute columns from a row of the same member)
  const outCols: TCol[] = [...input.cols, ...(shape.densify ? [{ name: shape.densify, lineage: null, dataType: 'boolean' as DataType, alias: true }] : []), ...calcs.map((c, k) => ({ name: c.name, lineage: null, dataType: inferType(evaluated[k].values), alias: true }))]
  const rows: Scalar[][] = []
  for (let i = 0; i < cells.length; i++) {
    let row: Scalar[]
    if (i < base) row = input.row(i)
    else {
      const c = cells[i]
      row = input.cols.map(() => null)
      fieldIdx.forEach((j, g) => (row[j] = c.keys[g]))
      levels.forEach((g, gi) => {
        const present = gi < R ? gi < c.rowLevel : gi - R < c.colLevel
        if (totalIdx[gi] >= 0) row[totalIdx[gi]] = !present
        if (present && g.cols.length > 1) {
          // attribute (sort-by) columns: from an input row with the same value of the field
          for (let r = 0; r < input.n; r++) {
            if (sameKey(input.get(r, fieldIdx[gi]), c.keys[gi])) {
              for (const name of g.cols.slice(1)) row[idx(name)] = input.get(r, idx(name))
              break
            }
          }
        }
      })
    }
    if (shape.densify) row.push(i >= base)
    for (const e of evaluated) row.push(e.values[i])
    rows.push(row)
  }
  return TableValue.fromRows(outCols, rows)
}
