/**
 * Condition-aware value distributions for sample data.
 *
 * The miner (./synthetic-mine.ts) records every literal condition of the definitions with its operator, polarity and
 * site (`MinedCondition`). This module decides, per column, how often each literal is written so that the report's own
 * logic holds for (nearly) every member, from the whole set of conditions on that column in the project:
 *
 *  - A column the report never shows (not in a visual's field wells, a slicer, a filter card, a tooltip, a sort-by
 *    target, a relationship, a field parameter, or a calculated column that is shown) is **free**. When the positive
 *    filter conditions that measures put on it are compatible, every row satisfies them (`all-rows`); when measures need
 *    different values (one counts status A, another status B) the rows are split between those values, weighted towards
 *    the values that measures of entity-level tables need (`split`).
 *  - A column the report shows keeps a plausible spread, but the literal that positive measure conditions require
 *    dominates (`dominant`, DOMINANT_SHARE = 85%: about one member in seven keeps another value, so slicers and visuals
 *    still show variety). When a filter of the same project excludes that literal or requires another one, both are
 *    kept well represented (`balanced`, 60% / 40%) so measures and filters both leave data.
 *  - Literals that appear only in negative conditions (`<>`, NOT IN, exclude filters) and sentinels (`"null"`, `"none"`,
 *    `"n/a"`, `"unknown"`, `"(Blank)"`…) are never the common value: absent unless something tests for them, then rare.
 *
 * Decisions are deterministic (they depend only on the definitions) and are listed in `SyntheticResult.decisions`.
 * Only columns with literal conditions get one; others keep the generator's ordinary heuristics.
 *
 * Approximations: comparisons (`<`, `>`) and text searches are recorded but do not shape the distribution (the ordinary
 * generators and the existing CONTAINSSTRING embedding cover them); a measure displayed through SELECTEDVALUE does not
 * make the column "shown"; conditions on calculated columns are not pushed back to the columns they are computed from.
 */
import type { SemanticModel, TableDef } from '../model/types'
import type { ProjectDocument } from '../project'
import type { MinedCondition, MinedValue } from './synthetic-mine'
import { modelLineage } from './synthetic-lineage'

/** Share of rows a required literal takes in a column the report shows. */
export const DOMINANT_SHARE = 0.85
/** Share of rows the measures' literal takes when a filter of the project needs other values of a shown column. */
export const BALANCED_SHARE = 0.6
/** Share of each rare literal (a sentinel or exclusion something still tests for). */
export const RARE_SHARE = 0.015
/** At most this much of a column goes to rare literals together. */
const RARE_TOTAL = 0.05

export type DecisionRule = 'all-rows' | 'split' | 'dominant' | 'balanced' | 'spread'

export interface ColumnDecision {
  table: string
  column: string
  /** shown somewhere in the report or used as a relationship key */
  surfaced: boolean
  /** how many conditions of each kind were seen on the column */
  seen: { measureInclude: number; measureExclude: number; filterInclude: number; filterExclude: number; tests: number }
  rule: DecisionRule
  /**
   * Literal → share of rows. Shares add up to at most 1; the rest of the rows ("other") take the column's other mined
   * values (tests, lookups) or its ordinary generated values, never an `absent` literal.
   */
  shares: Array<{ value: MinedValue; share: number; why: 'required' | 'filter' | 'rare' }>
  /** literals kept out of the column (only negative conditions use them, or sentinels nothing tests for) */
  absent: MinedValue[]
  /** one sentence: why */
  note: string
}

const SENTINELS = new Set(['null', 'none', 'nan', 'nil', 'n/a', 'na', '#n/a', 'unknown', 'undefined', '(blank)', 'blank', '(none)', 'not available', 'not applicable', 'tbd', '-', '--', '—', '?'])

/** Placeholder literals that mean "no value": never the common value of a column. */
export function isSentinel(v: MinedValue): boolean {
  return typeof v === 'string' && (v.trim() === '' || SENTINELS.has(v.trim().toLowerCase()))
}

function lkey(table: string, column: string): string {
  return `${table}[${column}]`.toLowerCase()
}

export function valueKeyOf(v: MinedValue): string {
  return v instanceof Date ? 'd' + v.getTime() : typeof v === 'string' ? 's' + v.trim().toLowerCase() : typeof v + String(v)
}

type Json = any

/** Column references (`{ Column: { Expression: { SourceRef }, Property } }` and hierarchy levels) in a query-state / sort / filter-card object. */
function collectFieldColumns(node: Json, model: SemanticModel, out: Set<string>, depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 40) return
  if (Array.isArray(node)) {
    for (const x of node) collectFieldColumns(x, model, out, depth + 1)
    return
  }
  if (node.Column && typeof node.Column.Property === 'string') {
    const ent = node.Column.Expression?.SourceRef?.Entity
    if (typeof ent === 'string') out.add(lkey(ent, node.Column.Property))
  }
  if (node.HierarchyLevel) {
    const h = node.HierarchyLevel.Expression?.Hierarchy
    const pvs = h?.Expression?.PropertyVariationSource
    if (pvs && typeof pvs.Property === 'string' && typeof pvs.Expression?.SourceRef?.Entity === 'string') out.add(lkey(pvs.Expression.SourceRef.Entity, pvs.Property))
    const ent = h?.Expression?.SourceRef?.Entity
    const t = typeof ent === 'string' ? model.tables.find((x) => x.name.toLowerCase() === ent.toLowerCase()) : undefined
    const hier = t?.hierarchies?.find((x) => x.name.toLowerCase() === String(h?.Hierarchy ?? '').toLowerCase())
    const lv = hier?.levels.find((x) => x.name.toLowerCase() === String(node.HierarchyLevel.Level ?? '').toLowerCase())
    if (t && lv) out.add(lkey(t.name, lv.column))
  }
  for (const v of Object.values(node)) if (v && typeof v === 'object') collectFieldColumns(v, model, out, depth + 1)
}

/** `t[c]` / `'t'[c]` references in a DAX text (table-qualified ones only, plus bare `[c]` of the home table). */
function columnRefs(expr: string, home: TableDef, model: SemanticModel): string[] {
  const out: string[] = []
  const re = /(?:'([^']+)'|([A-Za-z_][\w.]*))?\s*\[([^\]]+)\]/g
  for (let m = re.exec(expr); m; m = re.exec(expr)) {
    const tn = m[1] ?? m[2]
    const t = tn ? model.tables.find((x) => x.name.toLowerCase() === tn.toLowerCase()) : home
    const c = t?.columns.find((x) => x.name.toLowerCase() === m![3].toLowerCase())
    if (t && c) out.push(lkey(t.name, c.name))
  }
  return out
}

/**
 * Columns the report shows or joins on (lower-case `table[column]` keys): field wells of every visual (tooltips and
 * slicers included), sort definitions, filter cards, relationship ends, sort-by targets of those columns, columns named
 * by field parameters (NAMEOF), the columns a shown calculated column is computed from, and the imported sources of
 * shown calculated-table columns. `undefined` when the project has no report (then every column counts as shown).
 */
export function surfacedColumns(project: Pick<ProjectDocument, 'model' | 'report'>): Set<string> | undefined {
  const model = project.model
  const r = project.report
  if (!r) return undefined
  const out = new Set<string>()
  const cards = (json: Json): void => {
    for (const f of json?.filterConfig?.filters ?? []) collectFieldColumns(f?.field, model, out)
  }
  cards(r.report)
  for (const p of r.pages) {
    cards(p.json)
    for (const v of p.visuals) {
      cards(v.json)
      collectFieldColumns(v.json?.visual?.query?.queryState, model, out)
      collectFieldColumns(v.json?.visual?.query?.sortDefinition, model, out)
      collectFieldColumns(v.json?.visual?.query?.Select, model, out)
    }
  }
  for (const rel of model.relationships) {
    out.add(lkey(rel.fromTable, rel.fromColumn))
    out.add(lkey(rel.toTable, rel.toColumn))
  }
  // field parameters: every column they can switch to is shown
  for (const t of model.tables) {
    for (const p of t.partitions) {
      if (p.sourceType !== 'calculated' || !/\bNAMEOF\s*\(/i.test(p.expression ?? '')) continue
      const re = /NAMEOF\s*\(\s*((?:'[^']+'|[A-Za-z_][\w.]*)\s*\[[^\]]+\])\s*\)/gi
      for (let m = re.exec(p.expression ?? ''); m; m = re.exec(p.expression ?? '')) for (const k of columnRefs(m[1], t, model)) out.add(k)
    }
  }
  // closure: sort-by targets, sources of shown calculated columns, imported sources of calculated-table columns
  const lineage = modelLineage(model)
  for (let round = 0; round < 4; round++) {
    const before = out.size
    for (const t of model.tables) {
      for (const c of t.columns) {
        if (!out.has(lkey(t.name, c.name))) continue
        if (c.sortByColumn) out.add(lkey(t.name, c.sortByColumn))
        if (c.kind === 'calculated' && c.expression) for (const k of columnRefs(c.expression, t, model)) out.add(k)
        for (const b of lineage.get(t.name.toLowerCase()) ?? []) {
          const lc = b.columns.get(c.name.toLowerCase())
          if (lc?.source) out.add(lkey(b.table, lc.source))
        }
      }
    }
    if (out.size === before) break
  }
  return out
}

/** Visual types that list one row per member of their grouping columns. */
const ENTITY_VISUALS = new Set(['tableEx', 'table', 'pivotTable', 'matrix'])

/**
 * Measures (lower-case names) that entity-level visuals show, directly or through the measures they reference: tables
 * and matrices whose grouping columns all come from one table that a slicer of the same page selects on.
 */
export function entityMeasures(project: Pick<ProjectDocument, 'model' | 'report'>): Set<string> {
  const out = new Set<string>()
  const r = project.report
  if (!r) return out
  for (const p of r.pages) {
    const slicedTables = new Set<string>()
    for (const v of p.visuals) {
      if (!/slicer/i.test(String(v.json?.visual?.visualType ?? ''))) continue
      const cols = new Set<string>()
      collectFieldColumns(v.json?.visual?.query?.queryState, project.model, cols)
      for (const k of cols) slicedTables.add(k.slice(0, k.indexOf('[')))
    }
    if (!slicedTables.size) continue
    for (const v of p.visuals) {
      if (!ENTITY_VISUALS.has(String(v.json?.visual?.visualType ?? ''))) continue
      const qs = v.json?.visual?.query?.queryState ?? {}
      const tables = new Set<string>()
      const measures: string[] = []
      for (const [role, bucket] of Object.entries<Json>(qs)) {
        for (const pr of bucket?.projections ?? []) {
          const f = pr?.field
          if (f?.Measure && typeof f.Measure.Property === 'string') measures.push(f.Measure.Property.toLowerCase())
          else if (f?.Column && role !== 'Tooltips') tables.add(String(f.Column.Expression?.SourceRef?.Entity ?? '').toLowerCase())
        }
      }
      if (tables.size === 1 && slicedTables.has([...tables][0])) for (const m of measures) out.add(m)
    }
  }
  // measures they reference
  const byName = new Map<string, string>()
  for (const t of project.model.tables) for (const m of t.measures) byName.set(m.name.toLowerCase(), m.expression ?? '')
  const queue = [...out]
  while (queue.length) {
    const m = queue.pop()!
    const expr = byName.get(m) ?? ''
    const re = /(?<![\w'\]])\[([^\]]+)\]/g
    for (let x = re.exec(expr); x; x = re.exec(expr)) {
      const n = x[1].toLowerCase()
      if (byName.has(n) && !out.has(n)) {
        out.add(n)
        queue.push(n)
      }
    }
  }
  return out
}

const MEASURE_SITES = new Set(['measure', 'calcItem', 'calcTable'])
const FILTER_SITES = new Set(['filter', 'slicer', 'bookmark', 'rls'])

export interface DecideOptions {
  /** may the literal be written into the column (privacy gate of the generator)? withheld literals are left out */
  allowed?(table: string, column: string, v: MinedValue): boolean
  /** columns of tables the generator writes (lower-case `table[column]`); default: every column */
  generated?: Set<string>
}

/** Decide the value distribution of every column with literal conditions (see the module comment). */
export function decideColumns(project: Pick<ProjectDocument, 'model' | 'report'>, conditions: MinedCondition[], opts: DecideOptions = {}): Map<string, ColumnDecision> {
  const surfaced = surfacedColumns(project)
  const entity = entityMeasures(project)
  const byCol = new Map<string, MinedCondition[]>()
  for (const c of conditions) {
    const k = lkey(c.table, c.column)
    if (opts.generated && !opts.generated.has(k)) continue
    const arr = byCol.get(k)
    if (arr) arr.push(c)
    else byCol.set(k, [c])
  }
  const out = new Map<string, ColumnDecision>()
  for (const [k, conds] of [...byCol.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const { table, column } = conds[0]
    const ok = (v: MinedValue): boolean => (opts.allowed ? opts.allowed(table, column, v) : true)
    const eq = conds.filter((c) => c.op === '=' || c.op === 'IN')
    const measureInc = eq.filter((c) => MEASURE_SITES.has(c.site) && c.use === 'filter' && c.polarity === 'positive')
    const measureExc = eq.filter((c) => MEASURE_SITES.has(c.site) && c.use === 'filter' && c.polarity === 'negative')
    const filterInc = eq.filter((c) => FILTER_SITES.has(c.site) && c.use === 'filter' && c.polarity === 'positive')
    const filterExc = eq.filter((c) => FILTER_SITES.has(c.site) && c.use === 'filter' && c.polarity === 'negative')
    const tests = eq.filter((c) => c.use === 'test')
    const isSurfaced = !surfaced || surfaced.has(k)
    const seen = { measureInclude: measureInc.length, measureExclude: measureExc.length, filterInclude: filterInc.length, filterExclude: filterExc.length, tests: tests.length }

    // every literal of the column, first spelling kept
    const lits = new Map<string, MinedValue>()
    for (const c of eq) for (const v of c.values) if (!lits.has(valueKeyOf(v))) lits.set(valueKeyOf(v), v)
    const positive = new Set<string>()
    for (const c of eq) if (c.polarity === 'positive') for (const v of c.values) positive.add(valueKeyOf(v))
    const negativeOnly = [...lits.entries()].filter(([vk]) => !positive.has(vk)).map(([, v]) => v)

    // what measures require: the intersection of their positive filter conditions (privacy: withheld literals are left to stand-ins)
    const sets = measureInc.map((c) => new Set(c.values.filter(ok).map(valueKeyOf))).filter((s) => s.size)
    let required: string[] = []
    let conflict = false
    if (sets.length) {
      required = [...sets[0]].filter((vk) => sets.every((s) => s.has(vk)))
      if (!required.length) {
        conflict = true
        required = [...new Set(sets.flatMap((s) => [...s]))]
      }
    }
    // a sentinel is never what most rows hold, even when a measure counts it
    const sentinelRequired = required.filter((vk) => isSentinel(lits.get(vk)!))
    required = required.filter((vk) => !isSentinel(lits.get(vk)!))
    const excludedByMeasure = new Set(measureExc.flatMap((c) => c.values.map(valueKeyOf)))
    const excludedByFilter = new Set(filterExc.flatMap((c) => c.values.map(valueKeyOf)))
    const filterWants = filterInc.map((c) => new Set(c.values.filter(ok).map(valueKeyOf)))

    /** weight of a required value: 3 when a measure of an entity-level table needs it, else 1, per condition */
    const weightOf = (vk: string): number =>
      measureInc.filter((c) => c.values.some((v) => valueKeyOf(v) === vk)).reduce((s, c) => s + (c.source && entity.has(c.source.toLowerCase()) ? 3 : 1), 0) || 1

    const shares: ColumnDecision['shares'] = []
    let rule: DecisionRule = 'spread'
    let note = ''
    const spreadOver = (vals: string[], total: number, why: 'required' | 'filter'): void => {
      const w = vals.map(weightOf)
      const sum = w.reduce((a, b) => a + b, 0)
      // each needed value keeps at least a tenth of the total
      let parts = w.map((x) => Math.max(0.1, x / sum))
      const ps = parts.reduce((a, b) => a + b, 0)
      parts = parts.map((x) => x / ps)
      vals.forEach((vk, i) => shares.push({ value: lits.get(vk)!, share: round4(total * parts[i]), why }))
    }
    if (required.length) {
      if (!isSurfaced) {
        const otherNeeded = required.some((vk) => excludedByMeasure.has(vk))
        if (conflict) {
          rule = 'split'
          spreadOver(required, otherNeeded ? 0.8 : 1, 'required')
          note = 'not shown; measures need different values: rows split between them, weighted towards entity-level measures'
        } else if (otherNeeded) {
          rule = 'split'
          spreadOver(required, 0.8, 'required')
          note = 'not shown; measures count rows with and without the literal: 80% hold it'
        } else {
          rule = 'all-rows'
          spreadOver(required, 1, 'required')
          note = 'not shown; every row satisfies what the measures filter on'
        }
      } else if (conflict) {
        rule = 'split'
        spreadOver(required, DOMINANT_SHARE, 'required')
        note = `shown; measures need different values: together ${Math.round(DOMINANT_SHARE * 100)}% of the rows, weighted towards entity-level measures`
      } else {
        const filterConflict = required.some((vk) => excludedByFilter.has(vk)) || filterWants.some((s) => s.size > 0 && !required.some((vk) => s.has(vk)))
        if (filterConflict) {
          rule = 'balanced'
          spreadOver(required, BALANCED_SHARE, 'required')
          const wanted = [...new Set(filterWants.flatMap((s) => [...s]))].filter((vk) => !required.includes(vk) && !isSentinel(lits.get(vk)!) && !excludedByFilter.has(vk))
          if (wanted.length) wanted.forEach((vk) => shares.push({ value: lits.get(vk)!, share: round4((1 - BALANCED_SHARE) / wanted.length), why: 'filter' }))
          note = `shown; a report filter needs other values: ${Math.round(BALANCED_SHARE * 100)}% hold what the measures need, the rest what the filter keeps`
        } else {
          rule = 'dominant'
          spreadOver(required, DOMINANT_SHARE, 'required')
          note = `shown; the literal measures filter on dominates (${Math.round(DOMINANT_SHARE * 100)}%), the rest keeps a plausible spread`
        }
      }
    }
    // rare and absent literals: sentinels and exclusions
    const taken = new Set(shares.map((s) => valueKeyOf(s.value)))
    const absent: MinedValue[] = []
    let rare = 0
    const rareOrAbsent = [...new Set([...negativeOnly.map(valueKeyOf), ...[...lits.keys()].filter((vk) => isSentinel(lits.get(vk)!))])].filter((vk) => !taken.has(vk))
    for (const vk of rareOrAbsent) {
      const v = lits.get(vk)!
      if (!ok(v)) continue
      const tested = positive.has(vk) || sentinelRequired.includes(vk)
      // all-rows columns have no room; otherwise a literal something tests for (or a shown column's exclusion) stays rare
      const keep = rule !== 'all-rows' && (tested || (isSurfaced && !isSentinel(v))) && rare + RARE_SHARE <= RARE_TOTAL
      if (keep) {
        shares.push({ value: v, share: RARE_SHARE, why: 'rare' })
        rare += RARE_SHARE
      } else absent.push(v)
    }
    if (rule === 'spread' && !shares.length && !absent.length) continue
    if (rule === 'spread') note = 'no measure requirement; sentinels and excluded literals are rare or absent'
    out.set(k, { table, column, surfaced: isSurfaced, seen, rule, shares, absent, note })
  }
  return out
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000
}

/**
 * Narrowest width (pixels) at which each column is shown in a table or matrix of the report (`objects.columnWidth`,
 * selected by query reference), lower-case `table[column]` keys: generated ids and codes are sized to fit it.
 */
export function columnWidths(project: Pick<ProjectDocument, 'report'>): Map<string, number> {
  const out = new Map<string, number>()
  for (const p of project.report?.pages ?? []) {
    for (const v of p.visuals) {
      const vis = v.json?.visual
      const widths = vis?.objects?.columnWidth
      if (!Array.isArray(widths)) continue
      const byRef = new Map<string, string>()
      for (const bucket of Object.values<Json>(vis?.query?.queryState ?? {})) {
        for (const pr of bucket?.projections ?? []) {
          const c = pr?.field?.Column
          const ent = c?.Expression?.SourceRef?.Entity
          if (typeof pr?.queryRef === 'string' && typeof ent === 'string' && typeof c.Property === 'string') byRef.set(pr.queryRef, lkey(ent, c.Property))
        }
      }
      for (const w of widths) {
        const ref = w?.selector?.metadata
        const lit = w?.properties?.value?.expr?.Literal?.Value
        const px = typeof lit === 'string' ? parseFloat(lit) : NaN
        const k = typeof ref === 'string' ? byRef.get(ref) : undefined
        if (k && Number.isFinite(px) && px > 0) out.set(k, Math.min(out.get(k) ?? Infinity, px))
      }
    }
  }
  return out
}

/** Shape of a literal: letters → `A` / `a`, digits → `9`, anything else kept (separators). */
export function shapeOf(v: string): string {
  return v.replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/[0-9]/g, '9')
}

const ID_NAME_TOKENS = new Set(['id', 'key', 'code', 'number', 'no', 'num', 'nbr', 'sk', 'pk', 'ref', 'identifier'])

/**
 * Writer of generated ids / codes for a text column, from general evidence: (1) the shape of the literals the definitions
 * compare it to (length, case, separators; letters are replaced by fixed invented ones, digits by the counter: never the
 * literal itself); (2) a name ending in an id-like word (code, number, id, key…) without such a literal: short digit
 * strings; (3) otherwise a short prefix and a counter. The width at which a table shows the column caps the length (in
 * digits only when a prefix would not fit). `count` is the expected number of distinct values; values are `n` = 1, 2…
 */
export function idWriter(opts: { names: string[]; prefix: string; count: number; widthPx?: number; literals?: string[]; salt: number }): (n: number) => string {
  const digitsFor = (x: number): number => Math.max(1, String(Math.max(1, Math.floor(x))).length)
  const need = digitsFor(opts.count + 1)
  const maxChars = opts.widthPx ? Math.max(need, Math.floor((opts.widthPx - 10) / 7)) : Infinity
  // (1) the most common shape of the literals, if it holds digits
  const shapes = new Map<string, number>()
  for (const l of opts.literals ?? []) {
    const sh = shapeOf(l.trim())
    if (/9/.test(sh) && sh.length <= 24) shapes.set(sh, (shapes.get(sh) ?? 0) + 1)
  }
  const template = [...shapes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
  if (template) {
    // invented letters, the same for every value (a prefix-like part), from the salt
    let h = opts.salt >>> 0
    const letter = (upper: boolean): string => {
      h = (Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0
      const c = String.fromCharCode(65 + (h % 26))
      return upper ? c : c.toLowerCase()
    }
    const fixed = [...template].map((ch) => (ch === 'A' ? letter(true) : ch === 'a' ? letter(false) : ch))
    const slots = fixed.map((ch, i) => (template[i] === '9' ? i : -1)).filter((i) => i >= 0)
    return (n) => {
      let digits = String(n).padStart(slots.length, '0')
      const out = [...fixed]
      if (digits.length > slots.length) {
        // more values than the shape holds: widen its last digit run
        const extra = digits.slice(0, digits.length - slots.length)
        digits = digits.slice(digits.length - slots.length)
        out[slots[0]] = extra + out[slots[0]]
      }
      slots.forEach((pos, i) => (out[pos] = (out[pos].length > 1 ? out[pos].slice(0, -1) : '') + digits[i]))
      return out.join('')
    }
  }
  const toks = opts.names.flatMap((n) => n.toLowerCase().split(/[^a-z0-9]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean))
  const lastToks = opts.names.map((n) => n.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).pop() ?? '')
  const idName = lastToks.some((t) => ID_NAME_TOKENS.has(t)) || toks.length === 0
  const prefix = opts.prefix.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'ID'
  // (2) digits: one more digit than the count needs (at least 4), within the width; start at 10…0 so all have one length
  const digitWriter = (): ((n: number) => string) => {
    const len = Math.min(Math.max(need + 1, 4), Math.max(need, Number.isFinite(maxChars) ? maxChars : 6), 9)
    const start = len > need ? 10 ** (len - 1) : 0
    return (n) => String(start + n).padStart(len, '0')
  }
  if (idName) return digitWriter()
  // (3) prefix + counter, when it fits
  const padLen = Math.max(need, 4)
  if (prefix.length + 1 + padLen <= maxChars) return (n) => `${prefix}-${String(n).padStart(padLen, '0')}`
  return digitWriter()
}
