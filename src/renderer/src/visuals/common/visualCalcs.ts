/**
 * Visual calculations in visual queries: projections whose field is a PBIR NativeVisualCalculation are not sent to
 * summarize; the engine evaluates them over the visual matrix (engine.evaluateVisualCalculations) and their values are
 * placed in the result rows at the projection's position, so visuals read them like any other value.
 *
 * Axes: group-by projections from the Columns / Series / Legend roles are on the COLUMNS axis, the others on ROWS
 * (as Power BI lays out the visual matrix for tables, matrices and charts).
 */
import type { SummarizeRequest, SummarizeResult, ResultColumn } from '@core/engine/api'
import type { Scalar } from '@core/model/data'
import { fieldInfo } from '@core/report/sq'
import type { VisualHostContext } from '../contract'
import { labelOf, type Projection } from './query'

const COLUMN_ROLES = new Set(['columns', 'series', 'legend', 'column'])

export function isVisualCalc(p: Projection): boolean {
  return !!p.expr?.NativeVisualCalculation
}

function displayName(ctx: VisualHostContext, p: Projection): string {
  return p.nativeQueryRef ?? p.displayName ?? (isVisualCalc(p) ? p.expr.NativeVisualCalculation.Name : labelOf(ctx, p))
}

/**
 * Summarize with visual calculations. `req.values` holds one entry per projection of `values` (in order); entries
 * of visual-calculation projections are ignored and replaced by the calculation results.
 */
export function summarizeWithVisualCalcs(ctx: VisualHostContext, req: SummarizeRequest, groups: Projection[], values: Projection[]): SummarizeResult {
  const engine = ctx.engine
  const calcIdx = values.map((p, i) => (isVisualCalc(p) ? i : -1)).filter((i) => i >= 0)
  const modelIdx = values.map((p, i) => (isVisualCalc(p) ? -1 : i)).filter((i) => i >= 0)
  const base: SummarizeRequest = {
    ...req,
    values: modelIdx.map((i) => req.values[i]),
    // sorting by a visual calculation is not supported by Power BI either; keep model sorts only
    orderBy: req.orderBy?.filter((s) => !('value' in s.target) || modelIdx.some((i) => req.values[i].id === (s.target as { value: string }).value))
  }
  if (!engine.evaluateVisualCalculations) {
    const r = engine.summarize(base)
    return spliceCalcs(r, groups.length, values, calcIdx, modelIdx, req, r.rows.map(() => calcIdx.map(() => null)), ['Visual calculations are not supported by this engine.'])
  }
  // ROWS axis first, then COLUMNS (leading groups from row roles)
  let rowFields = 0
  while (rowFields < groups.length && !COLUMN_ROLES.has(groups[rowFields].role.toLowerCase())) rowFields++
  const vc = engine.evaluateVisualCalculations({
    base,
    rowFields,
    names: [...groups.map((g) => displayName(ctx, g)), ...modelIdx.map((i) => displayName(ctx, values[i]))],
    calcs: calcIdx.map((i) => ({ id: req.values[i].id, name: displayName(ctx, values[i]), expression: String(values[i].expr.NativeVisualCalculation.Expression ?? '') }))
  })
  const g = groups.length
  const nModel = modelIdx.length
  const r = vc.result
  const baseResult: SummarizeResult = { ...r, rows: r.rows.map((row) => row.slice(0, g + nModel)), columns: r.columns.slice(0, g + nModel), formats: r.formats?.map((f) => f.slice(0, nModel)), highlights: r.highlights?.map((h) => h.slice(0, nModel)) }
  return spliceCalcs(baseResult, g, values, calcIdx, modelIdx, req, r.rows.map((row) => row.slice(g + nModel)), [], r.columns.slice(g + nModel))
}

/** Put calculation values back at their projection positions. */
function spliceCalcs(
  r: SummarizeResult,
  g: number,
  values: Projection[],
  calcIdx: number[],
  modelIdx: number[],
  req: SummarizeRequest,
  calcRows: Array<Array<unknown>>,
  extraWarnings: string[],
  calcCols?: ResultColumn[]
): SummarizeResult {
  // value position i -> index among model values (>= 0) or -(1 + index among calculations)
  const pos = (i: number): number => {
    const m = modelIdx.indexOf(i)
    return m >= 0 ? m : -1 - calcIdx.indexOf(i)
  }
  const columns: ResultColumn[] = [...r.columns.slice(0, g)]
  values.forEach((p, i) => {
    const at = pos(i)
    if (at >= 0) columns.push(r.columns[g + at])
    else columns.push(calcCols?.[-1 - at] ?? { id: req.values[i].id, kind: 'value', dataType: 'double', name: p.expr.NativeVisualCalculation.Name })
  })
  const rows = r.rows.map((row, k) => [
    ...row.slice(0, g),
    ...values.map((_, i) => {
      const at = pos(i)
      return at >= 0 ? row[g + at] : ((calcRows[k]?.[-1 - at] ?? null) as (typeof row)[number])
    })
  ])
  const out: SummarizeResult = { ...r, columns, rows }
  if (r.formats) out.formats = r.formats.map((f) => values.map((_, i) => (pos(i) >= 0 ? f[pos(i)] : undefined)))
  if (r.highlights) out.highlights = r.highlights.map((h) => values.map((_, i) => (pos(i) >= 0 ? h[pos(i)] : null)))
  const warnings = [...(r.warnings ?? []), ...extraWarnings]
  if (warnings.length) out.warnings = warnings
  return out
}

// ------------------------------------------------------------------------------------------------
// Visual-calculation lattice (tables / matrices): every cell of the visual matrix, totals included
// ------------------------------------------------------------------------------------------------

function scalarKey(v: unknown): string {
  if (v === null || v === undefined) return '\u0000'
  if (v instanceof Date) return 'd' + v.getTime()
  return typeof v + ':' + String(v)
}

export interface CalcLattice {
  /** calculation values of the cell at (row keys, column keys) — key lengths are the cell's levels */
  get(rowKeys: Scalar[], colKeys: Scalar[]): Scalar[] | undefined
  /** cells at the given levels (incl. PBI DENSIFY combinations without base data), in lattice order */
  cellsAt(rowLevel: number, colLevel: number): Array<{ rowKeys: Scalar[]; colKeys: Scalar[]; calcs: Scalar[]; densified: boolean }>
  warnings: string[]
}

/**
 * Evaluate the visual calculations `calcs` over the visual matrix ROWS = rowGroups × COLUMNS = colGroups with the
 * visual's model values. Totals and subtotals are cells at lower levels. Densified combinations (both axes present,
 * no base data, calculation non-blank) are returned with `densified: true`; base values there are blank.
 */
export function evaluateCalcLattice(
  ctx: VisualHostContext,
  rowGroups: Projection[],
  colGroups: Projection[],
  modelValues: Projection[],
  calcs: Projection[],
  filters = ctx.filters
): CalcLattice {
  const warnings: string[] = []
  const map = new Map<string, Scalar[]>()
  const byLevel = new Map<string, Array<{ rowKeys: Scalar[]; colKeys: Scalar[]; calcs: Scalar[]; densified: boolean }>>()
  const R = rowGroups.length
  const C = colGroups.length
  const keyOf = (rk: Scalar[], ck: Scalar[]) => `${rk.length}|${ck.length}|${rk.map(scalarKey).join('\u0001')}|${ck.map(scalarKey).join('\u0001')}`
  const empty: CalcLattice = { get: () => undefined, cellsAt: () => [], warnings }
  if (!calcs.length) return empty
  if (!ctx.engine.evaluateVisualCalculations) {
    warnings.push('Visual calculations are not supported by this engine.')
    return empty
  }
  const groups = [...rowGroups, ...colGroups]
  const base: SummarizeRequest = {
    groupBy: groups.map((g) => ({ kind: 'sq', expr: g.expr })),
    values: modelValues.map((v, i) => ({ id: `m${i}`, expr: { kind: 'sq', expr: v.expr } })),
    filters
  }
  const vc = ctx.engine.evaluateVisualCalculations({
    base,
    rowFields: R,
    names: [...groups.map((g) => displayName(ctx, g)), ...modelValues.map((v) => displayName(ctx, v))],
    calcs: calcs.map((c, i) => ({ id: `c${i}`, name: displayName(ctx, c), expression: String(c.expr.NativeVisualCalculation.Expression ?? '') }))
  })
  vc.errors.forEach((e, i) => e && warnings.push(`${displayName(ctx, calcs[i])}: ${e}`))
  for (const cell of vc.cells as Array<VisualCalcCell>) {
    const rk = cell.keys.slice(0, cell.rowLevel)
    const ck = cell.keys.slice(R, R + cell.colLevel)
    map.set(keyOf(rk, ck), cell.calcs)
    const lk = `${cell.rowLevel}|${cell.colLevel}`
    let list = byLevel.get(lk)
    if (!list) byLevel.set(lk, (list = []))
    list.push({ rowKeys: rk, colKeys: ck, calcs: cell.calcs, densified: !!cell.densified })
  }
  void C
  return {
    get: (rk, ck) => map.get(keyOf(rk, ck)),
    cellsAt: (r, c) => byLevel.get(`${r}|${c}`) ?? [],
    warnings
  }
}

type VisualCalcCell = { rowLevel: number; colLevel: number; keys: Scalar[]; values: Scalar[]; calcs: Scalar[]; densified?: boolean }

/**
 * `engine.summarize` for requests built without projections (cards): values whose SQ expression is a visual
 * calculation are evaluated over the visual matrix (all group-bys on ROWS). Names for the calculations' references
 * are the fields' own names (measure / column names).
 */
export function summarizeAny(ctx: VisualHostContext, req: SummarizeRequest): SummarizeResult {
  const isCalcExpr = (v: SummarizeRequest['values'][number]) => v.expr.kind === 'sq' && !!(v.expr.expr as any)?.NativeVisualCalculation
  if (!req.values.some(isCalcExpr)) return ctx.engine.summarize(req)
  const proj = (expr: any, id: string): Projection => {
    const info = fieldInfo(expr)
    return { role: '', expr, queryRef: id, nativeQueryRef: info.kind === 'visualCalc' ? undefined : (info.property ?? id), info, isMeasure: true }
  }
  const groups = req.groupBy.map((g, i) => proj('kind' in g && g.kind === 'sq' ? g.expr : undefined, `g${i}`))
  const values = req.values.map((v) => proj(v.expr.kind === 'sq' ? v.expr.expr : undefined, v.id))
  return summarizeWithVisualCalcs(ctx, req, groups, values)
}
