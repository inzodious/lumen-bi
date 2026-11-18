/**
 * Q&A interpretation → PBIR visual.json (queryState projections, sortDefinition, visual-level
 * filterConfig cards in Power BI's shapes) and the filters used for the live preview.
 *
 * Filter cards written (same shapes Power BI Desktop saves):
 *   Categorical  In { Expressions: [col], Values: [[lit]…] }      (Not { In } for "not X")
 *   Advanced     Comparison { ComparisonKind, Left: col|measure|aggregation, Right: lit }
 *   TopN         From: [{ Name: 'subquery', Expression: { Subquery: { Query: { Select: [cat], OrderBy: [{ Direction, Expression: measure }], Top: n } } }, Type: 2 }]
 *                Where: In { Expressions: [cat], Table: { SourceRef: { Source: 'subquery' } } }
 */
import type { Scalar } from '@core/model/data'
import { aggregationExpr, columnExpr, fieldKey, literalExpr, measureExpr, normalizeFilter, SQ_AGG, type SQExpr, type SQFilter } from '@core/report/sq'
import type { QueryEngine } from '@core/engine/api'
import { VISUAL_LABELS, valueLabel, type CompareOp, type QnaInterpretation, type QValue } from './parse'
import type { QnaField } from './schema'
import { cloneDeep } from '@core/clone'

const AGG_REF: Record<number, string> = {
  [SQ_AGG.Sum]: 'Sum',
  [SQ_AGG.Avg]: 'Avg',
  [SQ_AGG.Count]: 'CountDistinct',
  [SQ_AGG.Min]: 'Min',
  [SQ_AGG.Max]: 'Max',
  [SQ_AGG.CountNonNull]: 'Count',
  [SQ_AGG.Median]: 'Median'
}

export function valueExpr(v: QValue): SQExpr {
  if (v.field.kind === 'measure') return measureExpr(v.field.table, v.field.name)
  if (v.agg === undefined) return columnExpr(v.field.table, v.field.name)
  return aggregationExpr(v.field.table, v.field.name, v.agg)
}

export function categoryExpr(f: QnaField): SQExpr {
  return columnExpr(f.table, f.name)
}

function valueProjection(v: QValue): any {
  const ref = `${v.field.table}.${v.field.name}`
  if (v.field.kind === 'measure' || v.agg === undefined) return { field: valueExpr(v), queryRef: ref, nativeQueryRef: v.field.name }
  return { field: valueExpr(v), queryRef: `${AGG_REF[v.agg] ?? 'Sum'}(${ref})`, nativeQueryRef: valueLabel(v) }
}

function categoryProjection(f: QnaField): any {
  return { field: categoryExpr(f), queryRef: `${f.table}.${f.name}`, nativeQueryRef: f.name, active: true }
}

/** Role buckets for a visual type. */
export function rolesFor(visualType: string, q: QnaInterpretation): Record<string, any[]> {
  const cats = q.categories.map(categoryProjection)
  const vals = q.values.map(valueProjection)
  switch (visualType) {
    case 'card':
      return { Values: vals.slice(0, 1) }
    case 'gauge':
      return { Y: vals.slice(0, 1) }
    case 'multiRowCard':
    case 'tableEx':
      return { Values: [...cats, ...vals] }
    case 'pivotTable':
      return { Rows: cats.slice(0, 1), Columns: cats.slice(1), Values: vals }
    case 'pieChart':
    case 'donutChart':
    case 'funnel':
      return { Category: cats.slice(0, 1), Y: vals.slice(0, 1) }
    case 'treemap':
      return { Group: cats.slice(0, 1), Details: cats.slice(1, 2), Values: vals.slice(0, 1) }
    case 'scatterChart':
      return { Category: cats.slice(0, 1), X: vals.slice(0, 1), Y: vals.slice(1, 2) }
    default: {
      // cartesian charts: time category on the axis, the other category as legend (single value only)
      let ordered = cats
      const timeIdx = q.categories.findIndex((c) => /date|year|month|quarter|week|day/i.test(c.name) || c.dataType === 'dateTime')
      if (visualType === 'lineChart' && timeIdx > 0) ordered = [cats[timeIdx], ...cats.filter((_, i) => i !== timeIdx)]
      const out: Record<string, any[]> = { Category: ordered.slice(0, 1), Y: vals }
      if (ordered.length > 1 && vals.length === 1) out.Series = ordered.slice(1, 2)
      return out
    }
  }
}

function hashId(s: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x12345678
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519) >>> 0
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + ((h1 ^ h2) >>> 0).toString(16).padStart(8, '0')).slice(0, 20)
}

/** Rewrite Entity SourceRefs to From aliases (PBI's saved form). */
function aliased(condition: any, extraFrom: any[] = []): SQFilter {
  const from: Array<{ Name: string; Entity: string; Type: number }> = []
  const names = new Map<string, string>()
  const alias = (entity: string) => {
    let a = names.get(entity)
    if (a) return a
    const base = (entity.match(/[A-Za-z]/)?.[0] ?? 't').toLowerCase()
    a = base
    for (let i = 1; from.some((f) => f.Name === a) || a === 'subquery'; i++) a = base + i
    names.set(entity, a)
    from.push({ Name: a, Entity: entity, Type: 0 })
    return a
  }
  const rw = (e: any): any => {
    if (Array.isArray(e)) return e.map(rw)
    if (!e || typeof e !== 'object') return e
    if (e.SourceRef?.Entity !== undefined && Object.keys(e).length === 1) return { SourceRef: { Source: alias(e.SourceRef.Entity) } }
    if (e.Subquery) return e // already aliased internally
    const o: any = {}
    for (const [k, v] of Object.entries(e)) o[k] = rw(v)
    return o
  }
  const cond = rw(condition)
  return { Version: 2, From: [...extraFrom, ...from], Where: [{ Condition: cond }] }
}

const CMP_KIND: Record<CompareOp, number> = { '=': 0, '>': 1, '>=': 2, '<': 3, '<=': 4 }

export interface FilterCard {
  name: string
  field: SQExpr
  type: 'Categorical' | 'Advanced' | 'TopN'
  filter: SQFilter
  howCreated?: string
}

function topNFilter(category: SQExpr, by: SQExpr, n: number, dir: 'top' | 'bottom'): SQFilter {
  const inner = aliased({ Select: category, By: by })
  const cond = inner.Where[0].Condition
  const query = {
    Version: 2,
    From: inner.From,
    Select: [{ ...cond.Select, Name: 'field' }],
    OrderBy: [{ Direction: dir === 'top' ? 2 : 1, Expression: cond.By }],
    Top: n
  }
  return aliased({ In: { Expressions: [category], Table: { SourceRef: { Source: 'subquery' } } } }, [{ Name: 'subquery', Expression: { Subquery: { Query: query } }, Type: 2 }])
}

export function filterCards(q: QnaInterpretation): FilterCard[] {
  const cards: FilterCard[] = []
  for (const f of q.filters) {
    const col = categoryExpr(f.field)
    const inCond = { In: { Expressions: [col], Values: f.values.map((v) => [literalExpr(v)]) } }
    cards.push({ name: '', field: col, type: 'Categorical', filter: aliased(f.not ? { Not: { Expression: inCond } } : inCond) })
  }
  for (const c of q.compares) {
    const left = valueExpr(c.target)
    cards.push({ name: '', field: left, type: 'Advanced', filter: aliased({ Comparison: { ComparisonKind: CMP_KIND[c.op], Left: left, Right: literalExpr(c.value) } }) })
  }
  if (q.topN?.category && q.topN.by) {
    const cat = categoryExpr(q.topN.category)
    cards.push({ name: '', field: cat, type: 'TopN', filter: topNFilter(cat, valueExpr(q.topN.by), q.topN.n, q.topN.dir) })
  }
  for (const c of cards) c.name = hashId(JSON.stringify(c.filter))
  return cards
}

export interface QnaVisualSpec {
  visualType: string
  /** visual.json fragment: `{ visual: {...}, filterConfig? }` */
  json: any
  cards: FilterCard[]
  restatement: string
}

export function buildVisual(q: QnaInterpretation, visualType = q.visualType): QnaVisualSpec | undefined {
  if (!visualType) return undefined
  const roles = rolesFor(visualType, q)
  const queryState: Record<string, any> = {}
  for (const [role, projections] of Object.entries(roles)) if (projections.length) queryState[role] = { projections }
  const query: any = { queryState }
  if (q.sort) {
    const field = q.sort.kind === 'value' ? valueExpr(q.values[q.sort.index]) : categoryExpr(q.categories[q.sort.index])
    // only sort by a field that is part of the visual
    const inVisual = Object.values(roles).some((ps) => ps.some((p) => fieldKey(p.field) === fieldKey(field)))
    if (inVisual) query.sortDefinition = { sort: [{ field, direction: q.sort.dir === 'asc' ? 'Ascending' : 'Descending' }], isDefaultSort: false }
  }
  const cards = filterCards(q)
  const json: any = { visual: { visualType, query, drillFilterOtherVisuals: true } }
  if (cards.length) json.filterConfig = { filters: cards }
  return { visualType, json, cards, restatement: q.restatement }
}

export function visualLabel(type: string): string {
  return VISUAL_LABELS[type] ?? type
}

/**
 * Filters for rendering the result inside the Q&A box. The TopN card is resolved to an explicit
 * In-list here (evaluated under the other filters, ties included like Power BI) so the preview works
 * with any QueryEngine; the saved visual keeps the real TopN filter.
 */
export function previewFilters(spec: QnaVisualSpec, q: QnaInterpretation, engine: QueryEngine, contextFilters: SQFilter[]): { filters: SQFilter[]; error?: string } {
  const base = spec.cards.filter((c) => c.type !== 'TopN').map((c) => normalizeFilter(c.filter))
  const all = [...contextFilters, ...base]
  if (!q.topN?.category || !q.topN.by) return { filters: all }
  try {
    const r = engine.summarize({ groupBy: [{ kind: 'sq', expr: categoryExpr(q.topN.category) }], values: [{ id: 'by', expr: { kind: 'sq', expr: valueExpr(q.topN.by) } }], filters: all })
    const rows = r.rows.filter((row) => typeof row[1] === 'number') as Array<[Scalar, number]>
    rows.sort((a, b) => (q.topN!.dir === 'top' ? b[1] - a[1] : a[1] - b[1]))
    const cut = rows[Math.min(q.topN.n, rows.length) - 1]?.[1]
    const keep = rows.filter((row, i) => i < q.topN!.n || row[1] === cut).map((row) => row[0])
    const inF: SQFilter = { Version: 2, Where: [{ Condition: { In: { Expressions: [categoryExpr(q.topN.category)], Values: keep.map((v) => [literalExpr(v)]) } } }] }
    return { filters: keep.length ? [...all, inF] : all }
  } catch (e) {
    return { filters: all, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * "Turn this Q&A result into a standard visual": rewrite a qnaVisual's visual.json in place into the
 * generated visual (type, query, visual-level filter cards). Position, name and container formatting stay.
 */
export function applyQnaResult(visualJson: any, spec: QnaVisualSpec): void {
  visualJson.visual ??= {}
  visualJson.visual.visualType = spec.visualType
  visualJson.visual.query = cloneDeep(spec.json.visual.query)
  delete visualJson.visual.objects
  visualJson.visual.drillFilterOtherVisuals = true
  if (spec.cards.length) {
    visualJson.filterConfig ??= {}
    visualJson.filterConfig.filters = [...(visualJson.filterConfig.filters ?? []), ...cloneDeep(spec.cards)]
  }
}
