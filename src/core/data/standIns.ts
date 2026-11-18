/**
 * Stand-ins for pinned literals in sample data.
 *
 * With the app's default privacy setting (`identifyingLiterals: 'never'`, see ./synthetic.ts) a name or id that a
 * report filter, a saved slicer selection or a formula compares a column to is never copied into the generated
 * rows: the report may be shown to third parties, and such a literal holds a real client, person or record.
 * Without more, every visual pinned to it is empty and the slicer shows a selection that matches nothing.
 *
 * Instead, the generator picks one *generated* value of that column per withheld literal (the most frequent one,
 * so the pinned visuals have rows) and records the pair here, in memory only (`DataStore.literalStandIns`). While
 * that sample table is loaded, queries read the pinned literal as its stand-in: the report definition is not
 * changed, no real value enters the data, and a refresh or a regeneration that replaces the table drops the pair.
 * Literals are kept as opaque keys (a hash), so the map itself does not list the real values.
 *
 * Applied to SQ filters (report / page / visual filters, slicer selections, bookmarks, drill-through) by the engine
 * and by the slicer UI (so the stand-in shows as selected, with a notice). Not applied to DAX formulas: a measure
 * that compares a column to a withheld literal stays blank (stated in the sample-data notice).
 */
import type { DataStore, LiteralStandIn, Scalar, TableData } from '../model/data'
import type { SQFilter } from '../report/sq'
import { decodeLiteral, encodeLiteral } from '../report/literal'
import { hash32 } from './synthetic-values'

/** Opaque key of a literal (case-insensitive for text, like Power BI's comparisons). */
export function literalKey(v: Scalar): string {
  const s = v instanceof Date ? 'd' + v.getTime() : typeof v === 'string' ? 's' + v.toLowerCase() : typeof v + String(v)
  return hash32(s).toString(36) + '.' + hash32(s, 0x9e3779b9).toString(36) + '.' + s.length.toString(36)
}

function valueKey(v: Scalar): string {
  return v instanceof Date ? 'd' + v.getTime() : typeof v === 'string' ? 's' + v.toLowerCase() : typeof v + String(v)
}

/**
 * Choose stand-ins for the withheld literals of one generated column: its distinct non-blank values ranked by
 * frequency (ties: first row first) or, with `rowWeight` (1 + how many fact rows reference the row), by that weight among
 * the referenced values, so a pinned page shows a busy member, skipping values that are themselves literals of the definitions (`avoid`, value keys),
 * assigned to the literals in order (cycled when the column has fewer values). With `rowOk`, only rows it accepts are
 * candidates (rows meeting the conditions the measures require on the table), when there are any. Undefined when the
 * column is empty.
 */
export function chooseStandIns(
  table: string,
  column: string,
  data: TableData,
  literals: Scalar[],
  avoid: ReadonlySet<string> = new Set(),
  rowWeight?: ArrayLike<number>,
  rowOk?: (row: number) => boolean
): LiteralStandIn | undefined {
  const col = data.columns.find((c) => c.name === column)
  if (!col || !literals.length) return undefined
  // rows that satisfy the conditions the report's measures put on this table (when any row does): a pinned member is not
  // one the measures exclude
  const okRows = rowOk && col.values.some((_, i) => rowOk(i)) ? rowOk : undefined
  const counts = new Map<string, { v: Scalar; n: number; first: number }>()
  col.values.forEach((v, i) => {
    if (v === null || v === undefined || v === '' || v instanceof Uint8Array) return
    if (okRows && !okRows(i)) return
    const k = valueKey(v)
    if (avoid.has(k)) return
    const w = rowWeight ? rowWeight[i] ?? 0 : 1
    const e = counts.get(k)
    if (e) e.n += w
    else counts.set(k, { v, n: w, first: i })
  })
  let ranked = [...counts.values()].sort((a, b) => b.n - a.n || a.first - b.first)
  if (!ranked.length) return undefined
  if (rowWeight) {
    // the busiest referenced members first: a page pinned to one member breaks it down by period and category, and only a
    // busy member keeps every period populated (a report pins a member because it matters; such members are rarely small)
    const referenced = ranked.filter((e) => e.n > 1)
    if (referenced.length) ranked = referenced
  }
  const values = new Map<string, Scalar>()
  let i = 0
  for (const lit of literals) {
    const k = literalKey(lit)
    if (values.has(k)) continue
    values.set(k, ranked[i % ranked.length].v)
    i++
  }
  return { table, column, data, values }
}

/** The stand-in of a literal compared to `table[column]`, while that column's sample table is still loaded. */
export function standInFor(data: DataStore | undefined, table: string, column: string, v: Scalar): Scalar | undefined {
  const list = data?.literalStandIns
  if (!list?.length || v === null || v === undefined) return undefined
  const t = table.toLowerCase()
  const c = column.toLowerCase()
  for (const s of list) {
    if (s.table.toLowerCase() !== t || s.column.toLowerCase() !== c) continue
    // stale once a refresh / regeneration replaced the table
    const current = [...data!.tables].find(([n]) => n.toLowerCase() === t)?.[1]
    if (current !== s.data) return undefined
    return s.values.get(literalKey(v))
  }
  return undefined
}

/** Text-match conditions: a searched text on an identifying column reads as the stand-in value (which contains itself). */
const TEXT_MATCH = ['Contains', 'StartsWith', 'EndsWith', 'DoesNotContain', 'DoesNotStartWith', 'DoesNotEndWith'] as const

export interface TranslatedFilters {
  filters: SQFilter[]
  /** literals read as their stand-in */
  translated: number
}

/** True when the store holds stand-ins (cheap pre-check for hot query paths). */
export function hasStandIns(data: DataStore | undefined): boolean {
  return !!data?.literalStandIns?.length
}

/**
 * Read the pinned literals of SQ filters as their stand-ins: `In` value lists, equality / comparison literals and
 * searched texts (Contains / StartsWith / EndsWith and their negations) against a plain column (hierarchy levels are
 * not resolved here). A searched text becomes the whole stand-in value, so it matches that member (approximation: the
 * real search may have matched several). Returns the input array itself when nothing changed.
 */
export function translateFilters(filters: SQFilter[] | undefined, data: DataStore | undefined): TranslatedFilters {
  const list = filters ?? []
  if (!hasStandIns(data) || !list.length) return { filters: list, translated: 0 }
  let translated = 0
  let changed = false
  const out = list.map((f) => {
    const r = translateFilter(f, data)
    if (r.filter !== f) changed = true
    translated += r.translated
    return r.filter
  })
  return { filters: changed ? out : list, translated }
}

export function translateFilter(filter: SQFilter, data: DataStore | undefined): { filter: SQFilter; translated: number } {
  if (!filter || !Array.isArray(filter.Where) || !hasStandIns(data)) return { filter, translated: 0 }
  const aliases: Record<string, string> = {}
  for (const fr of filter.From ?? []) if (fr?.Entity) aliases[fr.Name] = fr.Entity
  let translated = 0
  const columnOf = (e: any): { table: string; column: string } | undefined => {
    const c = e?.Column
    if (!c || typeof c.Property !== 'string') return undefined
    const ref = c.Expression?.SourceRef
    const table = ref?.Entity ?? (ref?.Source !== undefined ? aliases[ref.Source] : undefined)
    return table ? { table, column: c.Property } : undefined
  }
  const swap = (col: { table: string; column: string } | undefined, lit: any): any => {
    if (!col || !lit?.Literal) return lit
    const v = decodeLiteral(lit.Literal.Value)
    const s = standInFor(data, col.table, col.column, v)
    if (s === undefined) return lit
    translated++
    return { ...lit, Literal: { ...lit.Literal, Value: encodeLiteral(s) } }
  }
  const walk = (cond: any): any => {
    if (!cond || typeof cond !== 'object') return cond
    if (cond.And) return { ...cond, And: { Left: walk(cond.And.Left), Right: walk(cond.And.Right) } }
    if (cond.Or) return { ...cond, Or: { Left: walk(cond.Or.Left), Right: walk(cond.Or.Right) } }
    if (cond.Not) return { ...cond, Not: { ...cond.Not, Expression: walk(cond.Not.Expression) } }
    if (cond.In && Array.isArray(cond.In.Values) && !cond.In.Table) {
      const cols = (cond.In.Expressions ?? []).map(columnOf)
      if (!cols.some(Boolean)) return cond
      const before = translated
      const values = cond.In.Values.map((row: any[]) => (Array.isArray(row) ? row.map((lit, j) => swap(cols[j], lit)) : row))
      return translated === before ? cond : { ...cond, In: { ...cond.In, Values: values } }
    }
    for (const k of TEXT_MATCH) {
      if (!cond[k]) continue
      const before = translated
      const right = swap(columnOf(cond[k].Left), cond[k].Right)
      return translated === before ? cond : { ...cond, [k]: { ...cond[k], Right: right } }
    }
    if (cond.Comparison) {
      const { Left, Right } = cond.Comparison
      const before = translated
      const right = swap(columnOf(Left), Right)
      const left = swap(columnOf(Right), Left)
      return translated === before ? cond : { ...cond, Comparison: { ...cond.Comparison, Left: left, Right: right } }
    }
    return cond
  }
  const where = filter.Where.map((w) => {
    const c = walk(w?.Condition)
    return c === w?.Condition ? w : { ...w, Condition: c }
  })
  return translated ? { filter: { ...filter, Where: where }, translated } : { filter, translated: 0 }
}
