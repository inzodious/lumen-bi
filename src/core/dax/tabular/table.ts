import type { DataType } from '../../model/types.ts'
import type { Col, Tbl } from './model.ts'
import { tupleKey, type Scalar } from './values.ts'

export interface TCol {
  name: string
  /** model column this column carries the lineage of (filters on it apply to the model column) */
  lineage: Col | null
  /** declared or statically known type */
  dataType?: DataType
  /** named by the query (ADDCOLUMNS, SELECTCOLUMNS, ROW...): shown as [name] rather than table[column] */
  alias?: boolean
  /** table name for display / Var[col] references when there is no lineage */
  tableName?: string
  /** static format string (measure or column the values come from) */
  formatString?: string
}

/** A column's data: materialized values, or a projection of a model column over row ids. */
export type ColData = Scalar[] | { col: Col; ids: Int32Array }

const baseCols = new WeakMap<Tbl, TCol[]>()

export class TableValue {
  readonly kind = 'table' as const
  private lineageIdx: Map<Col, number> | null = null
  private nameIdx: Map<string, number> | null = null
  constructor(
    public cols: TCol[],
    public data: ColData[],
    public n: number,
    /** rows of a model table's expanded table (table reference, FILTER over it, ...) */
    public base?: { table: Tbl; ids: Int32Array }
  ) {}

  static fromRows(cols: TCol[], rows: Scalar[][]): TableValue {
    const data: Scalar[][] = cols.map(() => new Array(rows.length))
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]
      for (let c = 0; c < cols.length; c++) data[c][r] = row[c] ?? null
    }
    return new TableValue(cols, data, rows.length)
  }

  static fromBase(t: Tbl, ids: Int32Array): TableValue {
    // column descriptors are shared by every row set of the table (they are never mutated), which also keeps
    // per-shape caches (compiled row plans) cheap to key
    let cols = baseCols.get(t)
    if (!cols || cols.length !== t.cols.length || cols.some((c, j) => c.lineage !== t.cols[j] || c.dataType !== t.cols[j].dataType)) {
      cols = t.cols.map((c) => ({ name: c.name, lineage: c, dataType: c.dataType }))
      baseCols.set(t, cols)
    }
    return new TableValue(
      cols,
      t.cols.map((c) => ({ col: c, ids })),
      ids.length,
      { table: t, ids }
    )
  }

  static empty(cols: TCol[]): TableValue {
    return new TableValue(cols, cols.map(() => []), 0)
  }

  get(i: number, j: number): Scalar {
    const d = this.data[j]
    if (Array.isArray(d)) return d[i] ?? null
    return d.col.dict[d.col.codes[d.ids[i]]]
  }

  row(i: number): Scalar[] {
    const out = new Array<Scalar>(this.cols.length)
    for (let j = 0; j < this.cols.length; j++) out[j] = this.get(i, j)
    return out
  }

  rows(): Scalar[][] {
    const out = new Array<Scalar[]>(this.n)
    for (let i = 0; i < this.n; i++) out[i] = this.row(i)
    return out
  }

  column(j: number): Scalar[] {
    const d = this.data[j]
    if (Array.isArray(d)) return d
    const out = new Array<Scalar>(this.n)
    for (let i = 0; i < this.n; i++) out[i] = d.col.dict[d.col.codes[d.ids[i]]]
    return out
  }

  indexOfLineage(c: Col): number {
    if (!this.lineageIdx) {
      this.lineageIdx = new Map()
      this.cols.forEach((tc, i) => {
        if (tc.lineage && !this.lineageIdx!.has(tc.lineage)) this.lineageIdx!.set(tc.lineage, i)
      })
    }
    return this.lineageIdx.get(c) ?? -1
  }

  indexOfName(name: string): number {
    if (!this.nameIdx) {
      this.nameIdx = new Map()
      this.cols.forEach((tc, i) => {
        const k = tc.name.toLowerCase()
        if (!this.nameIdx!.has(k)) this.nameIdx!.set(k, i)
      })
    }
    return this.nameIdx.get(name.toLowerCase()) ?? -1
  }

  /** Subset of rows (keeps base lineage). */
  select(indices: ArrayLike<number>): TableValue {
    const n = indices.length
    const data: ColData[] = this.data.map((d) => {
      if (Array.isArray(d)) {
        const out = new Array<Scalar>(n)
        for (let i = 0; i < n; i++) out[i] = d[indices[i]]
        return out
      }
      const ids = new Int32Array(n)
      for (let i = 0; i < n; i++) ids[i] = d.ids[indices[i]]
      return { col: d.col, ids }
    })
    let base: TableValue['base']
    if (this.base) {
      const ids = new Int32Array(n)
      for (let i = 0; i < n; i++) ids[i] = this.base.ids[indices[i]]
      base = { table: this.base.table, ids }
    }
    return new TableValue(this.cols, data, n, base)
  }

  /** Append computed columns. */
  extend(cols: TCol[], values: Scalar[][]): TableValue {
    return new TableValue([...this.cols, ...cols], [...this.data, ...values], this.n, this.base)
  }

  /** Distinct rows (first occurrence wins). */
  distinct(): TableValue {
    const seen = new Set<string>()
    const keep: number[] = []
    for (let i = 0; i < this.n; i++) {
      const k = tupleKey(this.row(i))
      if (seen.has(k)) continue
      seen.add(k)
      keep.push(i)
    }
    return keep.length === this.n ? this : this.select(keep)
  }

  rowKey(i: number): string {
    return tupleKey(this.row(i))
  }
}

export function isTable(v: unknown): v is TableValue {
  return v instanceof TableValue
}
