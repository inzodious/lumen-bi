/**
 * Where users slice a report: the columns its slicers, filter-pane cards and cross-filtering visuals select on, with
 * the values of their saved selections. Used by the sample-data generator (./synthetic.ts) to make generated facts
 * dense where the report will be sliced: every member of a sliceable dimension has rows in every period of the grain
 * the report's date slicers select (see `SyntheticResult.coverage`).
 *
 * Reads only the report definition (field references and saved literals); nothing is written to the data from here.
 */
import type { SemanticModel, TableDef } from '../model/types'
import { decodeLiteral } from '../report/literal'
import type { MinedValue } from './synthetic-mine'

export interface SliceableField {
  /** model spelling */
  table: string
  column: string
  /**
   * `slicer`: a slicer's field; `filter`: a filter-pane card (report, page or visual level); `category`: a grouping
   * field of a visual (selecting a data point cross-filters the page, drilling filters the next level)
   */
  source: 'slicer' | 'filter' | 'category'
  /** a date hierarchy level (auto date/time variation or a user hierarchy): `year`, `quarter`, `month`, `day`… (lower case) */
  level?: string
  /** a range-style slicer (between / before / after / relative): it selects spans, not members */
  range?: boolean
  /** literals of saved selections on this field (slicer selections, filter-card conditions) */
  saved: MinedValue[]
}

type Json = any

const RANGE_MODES = new Set(['between', 'before', 'after', 'single', 'relative', 'relativedate', 'relativetime', 'relativedatepicker'])

interface Resolved {
  table: TableDef
  column: string
  level?: string
}

class SliceMiner {
  private readonly byKey = new Map<string, SliceableField>()
  private readonly tables = new Map<string, TableDef>()

  constructor(readonly model: SemanticModel) {
    for (const t of model.tables) this.tables.set(t.name.toLowerCase(), t)
  }

  get fields(): SliceableField[] {
    return [...this.byKey.values()]
  }

  /** Column / hierarchy-level expression → model column (aliases from a filter's `From`). */
  resolve(expr: Json, aliases: Record<string, string> = {}): Resolved | undefined {
    if (!expr || typeof expr !== 'object') return undefined
    const entityOf = (sr: Json): string | undefined => sr?.Entity ?? (sr?.Source !== undefined ? aliases[sr.Source] ?? sr.Source : undefined)
    if (expr.Column) {
      const t = this.tables.get(String(entityOf(expr.Column.Expression?.SourceRef) ?? '').toLowerCase())
      const c = t?.columns.find((x) => x.name.toLowerCase() === String(expr.Column.Property ?? '').toLowerCase())
      return t && c ? { table: t, column: c.name } : undefined
    }
    if (expr.HierarchyLevel) {
      const level = String(expr.HierarchyLevel.Level ?? '')
      const h = expr.HierarchyLevel.Expression?.Hierarchy
      if (!h) return undefined
      const pvs = h.Expression?.PropertyVariationSource
      if (pvs) {
        // auto date/time: Entity[Property] with a Year / Quarter / Month / Day level
        const t = this.tables.get(String(entityOf(pvs.Expression?.SourceRef) ?? '').toLowerCase())
        const c = t?.columns.find((x) => x.name.toLowerCase() === String(pvs.Property ?? '').toLowerCase())
        return t && c ? { table: t, column: c.name, level: level.toLowerCase() } : undefined
      }
      const t = this.tables.get(String(entityOf(h.Expression?.SourceRef) ?? '').toLowerCase())
      const hier = t?.hierarchies?.find((x) => x.name.toLowerCase() === String(h.Hierarchy ?? '').toLowerCase())
      const lv = hier?.levels.find((x) => x.name.toLowerCase() === level.toLowerCase())
      const c = lv && t?.columns.find((x) => x.name.toLowerCase() === lv.column.toLowerCase())
      return t && c ? { table: t, column: c.name } : undefined
    }
    if (expr.Aggregation) return this.resolve(expr.Aggregation.Expression, aliases)
    return undefined
  }

  add(r: Resolved, source: SliceableField['source'], range = false): SliceableField {
    const key = `${r.table.name.toLowerCase()}[${r.column.toLowerCase()}]${r.level ? '@' + r.level : ''}`
    let f = this.byKey.get(key)
    const rank = { slicer: 0, filter: 1, category: 2 }
    if (!f) this.byKey.set(key, (f = { table: r.table.name, column: r.column, source, saved: [], ...(r.level ? { level: r.level } : {}), ...(range ? { range } : {}) }))
    else {
      if (rank[source] < rank[f.source]) f.source = source
      if (!range) delete f.range
    }
    return f
  }

  /** Equality / In literals of a filter, by the field they compare. */
  savedValues(filter: Json): Array<{ r: Resolved; v: MinedValue }> {
    const out: Array<{ r: Resolved; v: MinedValue }> = []
    if (!filter || typeof filter !== 'object') return out
    const aliases: Record<string, string> = {}
    for (const f of filter.From ?? []) if (f && typeof f.Name === 'string' && typeof f.Entity === 'string') aliases[f.Name] = f.Entity
    const lit = (e: Json): MinedValue | undefined => {
      if (!e?.Literal) return undefined
      const v = decodeLiteral(e.Literal.Value)
      return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || (v instanceof Date && Number.isFinite(v.getTime())) ? v : undefined
    }
    const walk = (n: Json, depth: number): void => {
      if (!n || typeof n !== 'object' || depth > 40) return
      if (Array.isArray(n)) {
        for (const x of n) walk(x, depth + 1)
        return
      }
      if (n.Not) return // an exclusion selects everything else: no member is pinned
      if (n.In && Array.isArray(n.In.Expressions) && Array.isArray(n.In.Values)) {
        const cols = n.In.Expressions.map((e: Json) => this.resolve(e, aliases))
        for (const tuple of n.In.Values) {
          if (!Array.isArray(tuple)) continue
          tuple.forEach((l: Json, i: number) => {
            const v = lit(l)
            if (cols[i] && v !== undefined) out.push({ r: cols[i], v })
          })
        }
        return
      }
      if (n.Comparison) {
        const { Left, Right } = n.Comparison
        const lc = this.resolve(Left, aliases)
        const v = lit(Right)
        if (lc && v !== undefined && (n.Comparison.ComparisonKind ?? 0) === 0) out.push({ r: lc, v })
        else if (lc && v instanceof Date) out.push({ r: lc, v })
        return
      }
      if (n.Between) {
        const c = this.resolve(n.Between.Expression, aliases)
        for (const b of [n.Between.LowerBound, n.Between.UpperBound]) {
          const v = lit(b)
          if (c && v instanceof Date) out.push({ r: c, v })
        }
        return
      }
      for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v, depth + 1)
    }
    walk(filter.Where, 0)
    return out
  }

  card(card: Json): void {
    const r = this.resolve(card?.field)
    if (!r) return
    const f = this.add(r, 'filter')
    for (const s of this.savedValues(card.filter)) if (sameField(s.r, r)) pushUnique(f.saved, s.v)
  }

  visual(json: Json): void {
    const v = json?.visual
    const type = String(v?.visualType ?? '')
    const qs = v?.query?.queryState ?? {}
    for (const c of json?.filterConfig?.filters ?? []) this.card(c)
    if (/slicer/i.test(type)) {
      const lit = v?.objects?.data?.[0]?.properties?.mode?.expr?.Literal?.Value
      const mode = lit === undefined ? '' : String(decodeLiteral(lit) ?? '').toLowerCase()
      const range = RANGE_MODES.has(mode)
      const projs = (qs.Values ?? qs.Field ?? qs.Category)?.projections ?? []
      const fields: Array<{ r: Resolved; f: SliceableField }> = []
      for (const p of projs) {
        const r = this.resolve(p?.field)
        if (r) fields.push({ r, f: this.add(r, 'slicer', range) })
      }
      for (const g of v?.objects?.general ?? []) {
        const filter = g?.properties?.filter?.filter
        for (const s of this.savedValues(filter)) {
          const hit = fields.find((x) => sameField(x.r, s.r))
          if (hit) pushUnique(hit.f.saved, s.v)
        }
      }
      return
    }
    // grouping fields of other visuals: selecting a data point cross-filters the page
    for (const bucket of Object.values<Json>(qs)) {
      for (const p of bucket?.projections ?? []) {
        const r = this.resolve(p?.field)
        if (r && !p?.field?.Aggregation) this.add(r, 'category')
      }
    }
  }
}

function sameField(a: Resolved, b: Resolved): boolean {
  return a.table === b.table && a.column.toLowerCase() === b.column.toLowerCase() && (a.level ?? '') === (b.level ?? '')
}

function pushUnique(arr: MinedValue[], v: MinedValue): void {
  const k = (x: MinedValue): string => (x instanceof Date ? 'd' + x.getTime() : typeof x === 'string' ? 's' + x.toLowerCase() : typeof x + String(x))
  if (!arr.some((x) => k(x) === k(v))) arr.push(v)
}

/** Sliceable fields of a project's report (empty without a report). */
export function mineSliceable(project: { model: SemanticModel; report?: { report: Json; pages: Array<{ json: Json; visuals: Array<{ json: Json }> }> } | null }): SliceableField[] {
  const r = project.report
  if (!r) return []
  const m = new SliceMiner(project.model)
  for (const c of r.report?.filterConfig?.filters ?? []) m.card(c)
  for (const p of r.pages) {
    for (const c of p.json?.filterConfig?.filters ?? []) m.card(c)
    for (const v of p.visuals) m.visual(v.json)
  }
  return m.fields
}
