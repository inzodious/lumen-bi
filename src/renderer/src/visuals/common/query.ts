/**
 * Shared "visual → engine query" helpers. Visuals read their field wells (PBIR queryState),
 * expand field parameters, map roles to group-by/value expressions, apply the visual's sort
 * definition and data-reduction limits, and call engine.summarize.
 *
 * Owned jointly by the visuals workstreams; extend rather than fork.
 */
import type { SummarizeRequest, SummarizeResult, ValueExpr, FieldDescription, SortSpec } from '@core/engine/api'
import { fieldInfo, fieldKey, type FieldInfo, type SQExpr, type SQFilter } from '@core/report/sq'
import type { VisualHostContext } from '../contract'
import { isVisualCalc, summarizeWithVisualCalcs } from './visualCalcs'

export interface Projection {
  role: string
  expr: SQExpr
  queryRef: string
  nativeQueryRef?: string
  /** user-renamed display name (visual-level rename) */
  displayName?: string
  /** hierarchy roles: which level is active (PBIR `active`) */
  active?: boolean
  info: FieldInfo
  isMeasure: boolean
  /** Set when this projection came from expanding a field parameter */
  fromParameter?: string
  /** raw PBIR projection JSON (e.g. `showAll` = "Show items with no data") */
  raw?: any
}

/** Read all projections per role from visual.json (`visual.query.queryState`). */
export function getProjections(visualJson: any): Record<string, Projection[]> {
  const qs = visualJson?.visual?.query?.queryState ?? {}
  const out: Record<string, Projection[]> = {}
  for (const [role, bucket] of Object.entries<any>(qs)) {
    out[role] = (bucket?.projections ?? []).map((p: any) => {
      const info = fieldInfo(p.field)
      return {
        role,
        expr: p.field,
        queryRef: p.queryRef,
        nativeQueryRef: p.nativeQueryRef,
        displayName: p.displayName,
        active: p.active,
        info,
        // visual calculations are values (evaluated over the visual matrix, see visualCalcs.ts)
        isMeasure: info.kind === 'measure' || info.kind === 'aggregation' || info.kind === 'visualCalc',
        raw: p
      } satisfies Projection
    })
  }
  return out
}

/** Expand field-parameter projections into the fields currently selected. */
export function expandParameters(projections: Projection[], ctx: VisualHostContext): Projection[] {
  const out: Projection[] = []
  for (const p of projections) {
    const expanded = p.info.kind === 'column' ? ctx.engine.resolveFieldParameter(p.expr, ctx.filters) : null
    if (!expanded) {
      out.push(p)
      continue
    }
    for (const f of expanded) {
      const info = fieldInfo(f.expr)
      out.push({
        role: p.role,
        expr: f.expr,
        queryRef: fieldKey(f.expr),
        displayName: f.displayName,
        info,
        // visual calculations are values (evaluated over the visual matrix, see visualCalcs.ts)
        isMeasure: info.kind === 'measure' || info.kind === 'aggregation' || info.kind === 'visualCalc',
        fromParameter: p.queryRef
      })
    }
  }
  return out
}

export function describe(ctx: VisualHostContext, p: Projection): FieldDescription | undefined {
  return ctx.engine.describeField(p.expr)
}

/** Header/legend label for a projection: visual rename > field display name > property. */
export function labelOf(ctx: VisualHostContext, p: Projection): string {
  return p.displayName ?? describe(ctx, p)?.displayName ?? p.info.property ?? p.queryRef
}

/** Unique value id within a query (same field may sit in several roles). */
export function valueId(p: Projection): string {
  return `${p.role}|${p.queryRef}`
}

export function valueExprOf(p: Projection): ValueExpr {
  return { kind: 'sq', expr: p.expr }
}

/** Translate the visual's sortDefinition into SortSpecs over the given group/value projections. */
export function sortSpecs(visualJson: any, groups: Projection[], values: Projection[]): SortSpec[] {
  const sorts: any[] = visualJson?.visual?.query?.sortDefinition?.sort ?? []
  const out: SortSpec[] = []
  for (const s of sorts) {
    const key = fieldKey(s.field)
    const direction = s.direction === 'Descending' ? 'desc' : 'asc'
    const gi = groups.findIndex((g) => fieldKey(g.expr) === key)
    if (gi >= 0) {
      out.push({ target: { group: gi }, direction })
      continue
    }
    const vi = values.findIndex((v) => fieldKey(v.expr) === key)
    if (vi >= 0) out.push({ target: { value: valueId(values[vi]) }, direction })
  }
  return out
}

export interface VisualQueryOptions {
  /** roles whose projections become group-by columns, in order (e.g. ['Category', 'Series']) */
  groupRoles: string[]
  /** roles whose projections become values (e.g. ['Y', 'Tooltips']) */
  valueRoles: string[]
  /** for hierarchical roles: only use projections up to this drill level (inclusive); default = all active */
  drillLevel?: Record<string, number>
  /** data reduction: max rows (charts ~ 1000 categories, tables 30000) */
  limit?: number
  extraFilters?: SQFilter[]
  /** compute cross-highlight values with ctx.highlightFilters */
  highlight?: boolean
  showItemsWithNoData?: boolean
  /** default sort when the visual has none */
  defaultSort?: SortSpec[]
}

export interface VisualQueryResult {
  groups: Projection[]
  values: Projection[]
  result: SummarizeResult
  /** column index of each group/value in result.rows */
  groupIndex: number[]
  valueIndex: number[]
}

/** Pick projections for a role given drill level (hierarchy roles show one level at a time unless expanded). */
export function projectionsForRole(all: Projection[], level: number | undefined): Projection[] {
  if (level === undefined) return all
  return all.slice(0, Math.max(1, level + 1)).slice(-1)
}

export function runVisualQuery(visualJson: any, ctx: VisualHostContext, opts: VisualQueryOptions): VisualQueryResult {
  const roles = getProjections(visualJson)
  const groups: Projection[] = []
  for (const r of opts.groupRoles) {
    const projs = expandParameters(roles[r] ?? [], ctx)
    groups.push(...projectionsForRole(projs, opts.drillLevel?.[r]))
  }
  const values: Projection[] = []
  for (const r of opts.valueRoles) values.push(...expandParameters(roles[r] ?? [], ctx))

  const req: SummarizeRequest = {
    groupBy: groups.map((g) => ({ kind: 'sq', expr: g.expr })),
    values: values.map((v) => ({ id: valueId(v), expr: valueExprOf(v) })),
    filters: [...ctx.filters, ...(opts.extraFilters ?? [])],
    orderBy: (() => {
      const s = sortSpecs(visualJson, groups, values)
      return s.length ? s : opts.defaultSort
    })(),
    limit: opts.limit,
    showItemsWithNoData: opts.showItemsWithNoData,
    highlightFilters: opts.highlight ? ctx.highlightFilters : undefined
  }
  // visual calculations (NativeVisualCalculation projections) are evaluated over the visual matrix (visualCalcs.ts)
  const result = values.some(isVisualCalc) ? summarizeWithVisualCalcs(ctx, req, groups, values) : ctx.engine.summarize(req)
  return {
    groups,
    values,
    result,
    groupIndex: groups.map((_, i) => i),
    valueIndex: values.map((_, i) => groups.length + i)
  }
}
