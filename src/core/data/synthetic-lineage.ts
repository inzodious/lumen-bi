/**
 * Column lineage of calculated tables, for the synthetic-data generator.
 *
 * A calculated table such as
 *
 *   Combined = UNION (
 *     SELECTCOLUMNS ( 'Web Orders',   "key", 'Web Orders'[customer_key], "channel", "Web",   "score", 'Web Orders'[score] ),
 *     SELECTCOLUMNS ( 'Store Orders', "key", 'Store Orders'[cust],       "channel", "Store", "score", 'Store Orders'[stars] * 2 ) )
 *
 * is computed by the DAX engine from the generated rows of its source tables, so the generator never
 * writes it. But the model's relationships, measures and report filters usually refer to the
 * *calculated* table: `Combined[key] → Customer[key]`, `Combined[channel] = "Web"`. Without lineage those
 * relationships constrain nothing (keys of the sources and of the dimension disagree, the dimension key
 * is not even unique) and the mined value domains never reach a column that is generated.
 *
 * calculatedTableLineage() resolves, for every *branch* (one source table feeding rows into the
 * calculated table), what each output column is: a copy of a source column (optionally scaled by a
 * constant factor), a constant (literal or BLANK()), or something computed that cannot be traced.
 *
 * Understood shapes: table references (also to other calculated tables), VAR/RETURN, SELECTCOLUMNS,
 * ADDCOLUMNS, UNION (columns matched by position, as DAX does), FILTER / CALCULATETABLE / KEEPFILTERS /
 * DISTINCT / VALUES / ALL / ALLNOBLANKROW / ALLSELECTED (also their single-column forms), TOPN / SAMPLE,
 * SUMMARIZE (group-by columns of the summarized table). Anything else is opaque (undefined), which is
 * always safe: the generator then treats the table as before.
 */
import type { SemanticModel, TableDef } from '../model/types'
import { literalOf, tryParseDax, type DaxNode } from './synthetic-dax'

export interface LineageColumn {
  /** source-table column the values are copied from */
  source?: string
  /** factor applied to the source values (`t[c] * 2` → 2, `t[c] / 4` → 0.25); absent = 1 */
  scale?: number
  /** the column is the same literal on every row of the branch (`null` = BLANK()) */
  constant?: string | number | boolean | null
  isConstant?: boolean
}

export interface LineageBranch {
  /** the imported (non-calculated) table the rows come from, in the model's spelling */
  table: string
  /** model column name of the calculated table (lower case) → what it is in this branch */
  columns: Map<string, LineageColumn>
}

interface OutCol extends LineageColumn {
  name: string
}
interface Branch {
  table: string
  cols: OutCol[]
}

const PASS_THROUGH_FIRST = new Set(['FILTER', 'CALCULATETABLE', 'KEEPFILTERS', 'DISTINCT', 'VALUES', 'ALL', 'ALLNOBLANKROW', 'ALLSELECTED', 'NONVISUAL'])
const PASS_THROUGH_SECOND = new Set(['TOPN', 'SAMPLE'])
const MAX_DEPTH = 6

function isCalculated(t: TableDef): boolean {
  return t.partitions.some((p) => p.sourceType === 'calculated')
}

/** Output column name a model column of a calculated table is bound to (`[x]`, `T[x]`, or its own name). */
function boundName(sourceColumn: string | undefined, name: string): string {
  const s = (sourceColumn ?? '').trim()
  if (!s) return name
  const m = /\[((?:[^\]]|\]\])*)\]$/.exec(s)
  return m ? m[1].replace(/\]\]/g, ']') : s
}

class Resolver {
  private readonly tables = new Map<string, TableDef>()
  private readonly memo = new Map<string, Branch[] | undefined>()
  private readonly open = new Set<string>()

  constructor(model: SemanticModel) {
    for (const t of model.tables) this.tables.set(t.name.toLowerCase(), t)
  }

  /** Branches of a model table: itself when imported, its expression's when calculated. */
  ofTable(name: string, depth: number): Branch[] | undefined {
    const key = name.toLowerCase()
    const t = this.tables.get(key)
    if (!t) return undefined
    if (!isCalculated(t)) {
      return [{ table: t.name, cols: t.columns.filter((c) => c.kind !== 'calculated' && c.kind !== 'rowNumber').map((c) => ({ name: c.name, source: c.name })) }]
    }
    if (this.memo.has(key)) return this.memo.get(key)
    if (this.open.has(key) || depth > MAX_DEPTH) return undefined
    this.open.add(key)
    let out: Branch[] | undefined
    const expr = t.partitions.find((p) => p.sourceType === 'calculated')?.expression
    const node = expr && !/\bNAMEOF\s*\(/i.test(expr) ? tryParseDax(expr) : undefined
    const raw = node ? this.branches(node, new Map(), depth + 1) : undefined
    if (raw) {
      // rename the expression's output columns to the model's column names
      out = raw.map((b) => {
        const cols: OutCol[] = []
        for (const c of t.columns) {
          if (c.kind === 'calculated' || c.kind === 'rowNumber') continue
          const want = boundName(c.sourceColumn, c.name).toLowerCase()
          const hit = b.cols.find((x) => x.name.toLowerCase() === want) ?? b.cols.find((x) => x.name.toLowerCase() === c.name.toLowerCase())
          if (hit) cols.push({ ...hit, name: c.name })
        }
        return { table: b.table, cols }
      })
    }
    this.open.delete(key)
    this.memo.set(key, out)
    return out
  }

  private branches(node: DaxNode, env: Map<string, DaxNode>, depth: number): Branch[] | undefined {
    if (depth > MAX_DEPTH * 3) return undefined
    switch (node.k) {
      case 'tbl':
        return this.ofTable(node.name, depth)
      case 'id': {
        const bound = env.get(node.name.toLowerCase())
        if (bound) return this.branches(bound, env, depth + 1)
        return this.ofTable(node.name, depth)
      }
      case 'var': {
        const inner = new Map(env)
        for (const d of node.defs) inner.set(d.name.toLowerCase(), d.e)
        return this.branches(node.ret, inner, depth + 1)
      }
      case 'col': {
        // a bare column used as a table (inside DISTINCT / VALUES / ALL): one-column table
        if (!node.table) return undefined
        const base = this.ofTable(node.table, depth)
        return base?.map((b) => ({ table: b.table, cols: b.cols.filter((c) => c.name.toLowerCase() === node.column.toLowerCase()) })).filter((b) => b.cols.length > 0)
      }
      case 'call':
        return this.call(node, env, depth)
      default:
        return undefined
    }
  }

  private call(node: Extract<DaxNode, { k: 'call' }>, env: Map<string, DaxNode>, depth: number): Branch[] | undefined {
    const args = node.args
    const sub = (i: number): Branch[] | undefined => (args[i] ? this.branches(args[i]!, env, depth + 1) : undefined)
    if (PASS_THROUGH_FIRST.has(node.name)) return sub(0)
    if (PASS_THROUGH_SECOND.has(node.name)) return sub(1)
    if (node.name === 'SELECTCOLUMNS' || node.name === 'ADDCOLUMNS') {
      const base = sub(0)
      if (!base) return undefined
      return base.map((b) => {
        const added: OutCol[] = []
        for (let i = 1; i < args.length; ) {
          const a = args[i]
          const next = args[i + 1]
          if (a && a.k === 'str' && next !== undefined) {
            added.push({ name: a.v, ...this.value(next, b, env) })
            i += 2
          } else if (a && a.k === 'col') {
            // SELECTCOLUMNS ( T, T[a], T[b] ): unnamed column projections keep their name
            added.push({ name: a.column, ...this.value(a, b, env) })
            i += 1
          } else i += 1
        }
        return { table: b.table, cols: node.name === 'ADDCOLUMNS' ? [...b.cols.filter((c) => !added.some((x) => x.name.toLowerCase() === c.name.toLowerCase())), ...added] : added }
      })
    }
    if (node.name === 'UNION') {
      const first = sub(0)
      if (!first?.length) return undefined
      const names = first[0].cols.map((c) => c.name)
      const out = [...first]
      for (let i = 1; i < args.length; i++) {
        // UNION matches columns by position and keeps the first table's names; an untraceable argument just
        // contributes no branch (its rows cannot be attributed to a source column)
        for (const b of sub(i) ?? []) {
          if (b.cols.length !== names.length) continue
          out.push({ table: b.table, cols: b.cols.map((c, k) => ({ ...c, name: names[k] })) })
        }
      }
      return out
    }
    if (node.name === 'SUMMARIZE') {
      const base = sub(0)
      if (!base) return undefined
      return base.map((b) => {
        const cols: OutCol[] = []
        for (let i = 1; i < args.length; i++) {
          const a = args[i]
          if (!a) continue
          if (a.k === 'str') {
            cols.push({ name: a.v })
            i++
          } else if (a.k === 'col') cols.push({ name: a.column, ...this.value(a, b, env) })
        }
        return { table: b.table, cols }
      })
    }
    return undefined
  }

  /** What a column expression evaluated per row of `branch` is. */
  private value(node: DaxNode | null, branch: Branch, env: Map<string, DaxNode>, depth = 0): LineageColumn {
    if (!node || depth > 8) return {}
    if (node.k === 'col') {
      if (node.table && node.table.toLowerCase() !== branch.table.toLowerCase()) {
        // a column of the table expression being projected may be qualified with a *calculated* table's name
        const hit = branch.cols.find((c) => c.name.toLowerCase() === node.column.toLowerCase())
        const t = this.tables.get(node.table.toLowerCase())
        if (!hit || !t || !isCalculated(t)) return {}
        return lineageOf(hit)
      }
      const hit = branch.cols.find((c) => c.name.toLowerCase() === node.column.toLowerCase())
      return hit ? lineageOf(hit) : {}
    }
    if (node.k === 'id') {
      const bound = env.get(node.name.toLowerCase())
      return bound ? this.value(bound, branch, env, depth + 1) : {}
    }
    if (node.k === 'call' && node.name === 'BLANK' && node.args.length === 0) return { isConstant: true, constant: null }
    const lit = literalOf(node)
    if (lit !== undefined) return { isConstant: true, constant: lit }
    if (node.k === 'bin' && (node.op === '*' || node.op === '/')) {
      const ln = literalOf(node.l)
      const rn = literalOf(node.r)
      if (typeof rn === 'number' && rn !== 0) {
        const inner = this.value(node.l, branch, env, depth + 1)
        if (inner.source) return { source: inner.source, scale: (inner.scale ?? 1) * (node.op === '*' ? rn : 1 / rn) }
      }
      if (typeof ln === 'number' && ln !== 0 && node.op === '*') {
        const inner = this.value(node.r, branch, env, depth + 1)
        if (inner.source) return { source: inner.source, scale: (inner.scale ?? 1) * ln }
      }
    }
    return {}
  }
}

function lineageOf(c: OutCol): LineageColumn {
  const out: LineageColumn = {}
  if (c.source !== undefined) out.source = c.source
  if (c.scale !== undefined && c.scale !== 1) out.scale = c.scale
  if (c.isConstant) {
    out.isConstant = true
    out.constant = c.constant ?? null
  }
  return out
}

/** Lineage of every calculated table of the model that can be traced (keyed by lower-case table name). */
export function modelLineage(model: SemanticModel): Map<string, LineageBranch[]> {
  const r = new Resolver(model)
  const out = new Map<string, LineageBranch[]>()
  for (const t of model.tables) {
    if (!isCalculated(t)) continue
    const bs = r.ofTable(t.name, 0)
    if (!bs?.length) continue
    out.set(
      t.name.toLowerCase(),
      bs.map((b) => ({ table: b.table, columns: new Map(b.cols.map((c) => [c.name.toLowerCase(), lineageOf(c)])) }))
    )
  }
  return out
}

/** Lineage of one calculated table; undefined when it is not calculated or cannot be traced. */
export function calculatedTableLineage(table: TableDef, model: SemanticModel): LineageBranch[] | undefined {
  return modelLineage(model).get(table.name.toLowerCase())
}

// ---------------------------------------------------------------------------------------------
// Pushing mined values through the lineage
// ---------------------------------------------------------------------------------------------

type Mined = string | number | boolean | Date

interface LineageDomain {
  table: string
  column: string
  values: Mined[]
  contains: string[]
  linked: Mined[]
  lookupKey?: boolean
}
interface LineageConjunction {
  conds: Array<{ table: string; column: string; values: Mined[] }>
}
interface LineageImplication {
  table: string
  when: Array<{ column: string; values: Mined[] }>
  then: Array<{ column: string; value: Mined }>
}

function sameMined(a: Mined | null, b: Mined | null): boolean {
  if (a === null || b === null) return a === b
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase()
  return a === b
}

function unscale(v: Mined, scale: number | undefined): Mined | undefined {
  if (!scale || scale === 1) return v
  if (typeof v !== 'number') return undefined
  const x = v / scale
  // a scaled whole-number column only takes values that map back to whole numbers
  return Number.isInteger(v) && !Number.isInteger(x) ? undefined : x
}

const MAX_LINEAGE_CONJUNCTIONS = 1200

/**
 * Copy what was mined for calculated-table columns onto the source columns they are computed from, so
 * the generator (which only writes imported tables) sees it:
 *  - value domains: `Combined[status] = "Won"` becomes a domain of every source column feeding `status`;
 *  - conjunctions: per branch, conditions on a constant column select the branch (`channel = "Web"` keeps
 *    only the branch whose channel is the literal "Web") and the others are rewritten to its source columns;
 *  - implications: likewise, when every `when` condition can be traced.
 * The originals are kept (they are harmless: calculated tables are not generated).
 */
export function propagateLineage(
  model: SemanticModel,
  mined: { domains: Map<string, LineageDomain>; conjunctions: LineageConjunction[]; implications: LineageImplication[] },
  domainKey: (table: string, column: string) => string
): void {
  const lineage = modelLineage(model)
  if (!lineage.size) return
  const modelTable = (name: string): TableDef | undefined => model.tables.find((t) => t.name.toLowerCase() === name.toLowerCase())
  const spelling = (table: string, column: string): { table: string; column: string } | undefined => {
    const t = modelTable(table)
    const c = t?.columns.find((x) => x.name.toLowerCase() === column.toLowerCase())
    return t && c ? { table: t.name, column: c.name } : undefined
  }

  for (const d of [...mined.domains.values()]) {
    const branches = lineage.get(d.table.toLowerCase())
    if (!branches) continue
    for (const b of branches) {
      const lc = b.columns.get(d.column.toLowerCase())
      if (!lc?.source) continue
      const at = spelling(b.table, lc.source)
      if (!at) continue
      const key = domainKey(at.table, at.column)
      let target = mined.domains.get(key)
      if (!target) {
        target = { table: at.table, column: at.column, values: [], contains: [], linked: [] }
        mined.domains.set(key, target)
      }
      for (const v of d.values) {
        const sv = unscale(v, lc.scale)
        if (sv !== undefined && !target.values.some((x) => sameMined(x, sv))) target.values.push(sv)
      }
      for (const s of d.contains) if (!target.contains.includes(s)) target.contains.push(s)
    }
  }

  const extra: LineageConjunction[] = []
  for (const conj of mined.conjunctions) {
    if (extra.length >= MAX_LINEAGE_CONJUNCTIONS) break
    const calcTables = [...new Set(conj.conds.map((c) => c.table.toLowerCase()).filter((t) => lineage.has(t)))]
    if (calcTables.length !== 1) continue
    const calc = calcTables[0]
    const rest = conj.conds.filter((c) => c.table.toLowerCase() !== calc)
    const own = conj.conds.filter((c) => c.table.toLowerCase() === calc)
    for (const b of lineage.get(calc)!) {
      const mapped: LineageConjunction['conds'] = []
      let compatible = true
      for (const c of own) {
        const lc = b.columns.get(c.column.toLowerCase())
        if (!lc) continue // computed column: cannot be seeded, the other conditions still can
        if (lc.isConstant) {
          if (!c.values.some((v) => sameMined(v, lc.constant ?? null))) compatible = false
          continue
        }
        if (!lc.source) continue
        const at = spelling(b.table, lc.source)
        const values = c.values.map((v) => unscale(v, lc.scale)).filter((v): v is Mined => v !== undefined)
        if (!at || !values.length) {
          compatible = false
          continue
        }
        mapped.push({ table: at.table, column: at.column, values })
      }
      if (!compatible || !mapped.length) continue
      extra.push({ conds: [...rest, ...mapped] })
    }
  }
  mined.conjunctions.push(...extra)

  const moreImplications: LineageImplication[] = []
  for (const imp of mined.implications) {
    const branches = lineage.get(imp.table.toLowerCase())
    if (!branches) continue
    for (const b of branches) {
      const when: LineageImplication['when'] = []
      let ok = true
      for (const w of imp.when) {
        const lc = b.columns.get(w.column.toLowerCase())
        if (lc?.isConstant) {
          if (!w.values.some((v) => sameMined(v, lc.constant ?? null))) ok = false
          continue
        }
        const values = lc?.source ? w.values.map((v) => unscale(v, lc.scale)).filter((v): v is Mined => v !== undefined) : []
        if (!lc?.source || !values.length) {
          ok = false
          continue
        }
        when.push({ column: lc.source, values })
      }
      if (!ok || !when.length) continue
      const then: LineageImplication['then'] = []
      for (const t of imp.then) {
        const lc = b.columns.get(t.column.toLowerCase())
        const value = lc?.source ? unscale(t.value, lc.scale) : undefined
        if (lc?.source && value !== undefined) then.push({ column: lc.source, value })
      }
      const at = modelTable(b.table)
      if (then.length && at) moreImplications.push({ table: at.name, when, then })
    }
  }
  mined.implications.push(...moreImplications)
}
