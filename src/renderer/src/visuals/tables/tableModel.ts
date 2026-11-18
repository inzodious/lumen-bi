/**
 * Table (tableEx) data model: Values-role projections → one summarize call (columns = group-by,
 * measures / aggregations = values, plus hidden conditional-formatting inputs) and a second
 * call without group-by for the totals row (a genuine measure evaluation, like Power BI).
 */
import type { Scalar } from '@core/model/data'
import type { DataType } from '@core/model/types'
import type { SortSpec, SummarizeRequest } from '@core/engine/api'
import { fieldKey, type DataPointIdentity, type SQExpr } from '@core/report/sq'
import type { VisualHostContext } from '../contract'
import { collectColumnCF, fullRangeStats, rangeInputs, type ColumnCF } from '../common/conditionalFormatting'
import { kpiAwareLabel } from './kpiLabel'
import { describe, expandParameters, getProjections, labelOf, sortSpecs, valueId, type Projection } from '../common/query'
import type { FieldAccessor } from '../common/sqEval'
import { asValueExpr, buildCell, columnStats, extraInputs, type CellModel, type ColumnStats } from './cellModel'
import { readTableFormat, type ColumnOverride, type TableFormat } from './tableFormat'
import { seriesFromRows, sparkKey, sparklineFormatFor, sparklineLabel, sparklineSpec, type SparklineSpec } from './sparklineModel'
import { restrictionBatches, ROW_WINDOW, shadowSensitive, windowedSummarize } from './windowQuery'
import { evaluateCalcLattice, isVisualCalc, type CalcLattice } from '../common/visualCalcs'

/** calculation values of a lattice cell, blank-padded to `n` */
export function padCalcs(v: Scalar[] | undefined, n: number): Scalar[] {
  return Array.from({ length: n }, (_, i) => v?.[i] ?? null)
}

export interface TableColumn {
  proj: Projection
  queryRef: string
  label: string
  isMeasure: boolean
  dataType?: DataType
  formatString?: string
  dataCategory?: string
  /** index into the summarize row */
  resultIndex: number
  align: 'left' | 'center' | 'right'
  sort?: 'asc' | 'desc'
  cf?: ColumnCF
  override?: ColumnOverride
  kpi?: { part: 'goal' | 'status' | 'trend'; statusGraphic?: string }
  /** sparkline column (SparklineData projection) */
  sparkline?: SparklineSpec
}

export interface TableModel {
  format: TableFormat
  columns: TableColumn[]
  rows: CellModel[][]
  identities: DataPointIdentity[]
  total?: CellModel[]
  truncated: boolean
  /** data windowing: more rows exist beyond the loaded window (fetched as the user scrolls) */
  hasMore: boolean
  /** rows requested for this model (the window size) */
  window: number
  warnings: string[]
  error?: string
}

export const TABLE_ROW_LIMIT = 30000
export { ROW_WINDOW }

const NUMERIC: DataType[] = ['int64', 'double', 'decimal']

export function defaultAlign(dt: DataType | undefined, isMeasure: boolean): 'left' | 'right' {
  if (dt && NUMERIC.includes(dt)) return 'right'
  if (!dt && isMeasure) return 'right'
  return 'left'
}

/**
 * @param window rows to load (Power BI's data windowing: 500 at a time, grown by the visual on scroll).
 *   Totals are a separate, unrestricted query; conditional-formatting min/max (auto) are computed over
 *   the loaded rows (approximation: PBI computes them over the whole visual data).
 */
export function buildTableModel(visualJson: any, ctx: VisualHostContext, window: number = ROW_WINDOW): TableModel {
  const format = readTableFormat(visualJson, ctx.theme)
  const roles = getProjections(visualJson)
  const allProjs = expandParameters(roles.Values ?? [], ctx)
  // sparklines are evaluated separately (one summarize over row groups + the axis)
  const projs = allProjs.filter((p) => !sparklineSpec(p.expr))
  const groups = projs.filter((p) => !p.isMeasure)
  // visual calculations: evaluated over the whole visual matrix (not the loaded window) and appended after the
  // model values / CF inputs of each row; their columns read those slots (see evaluateCalcLattice)
  const calcs = projs.filter((p) => isVisualCalc(p))
  const values = projs.filter((p) => p.isMeasure && !isVisualCalc(p))
  const cfs = collectColumnCF(visualJson, ctx.theme)

  const available = new Set(projs.map((p) => fieldKey(p.expr)))
  const extras = extraInputs(projs.map((p) => cfs.get(p.queryRef)), available)
  const extraIds = extras.map((e) => `cf|${fieldKey(e)}`)

  const calcBase = groups.length + values.length + extras.length
  const sorts = sortSpecs(visualJson, groups, values)
  const first = projs.find((p) => !isVisualCalc(p))
  const orderBy: SortSpec[] = sorts.length ? sorts : first ? (first.isMeasure ? [{ target: { value: valueId(first) }, direction: 'desc' }] : [{ target: { group: 0 }, direction: 'asc' }]) : []

  const columns: TableColumn[] = allProjs.map((p) => {
    const spark = sparklineSpec(p.expr)
    if (spark) return sparkColumn(ctx, p, spark)
    const d = describe(ctx, p)
    const gi = groups.indexOf(p)
    const vi = values.indexOf(p)
    const ki = calcs.indexOf(p)
    const ov = format.columnOverrides.get(p.queryRef)
    const sortEntry = (visualJson?.visual?.query?.sortDefinition?.sort ?? []).find((s: any) => fieldKey(s.field) === fieldKey(p.expr))
    return {
      proj: p,
      queryRef: p.queryRef,
      label: kpiAwareLabel(p.displayName, d, () => labelOf(ctx, p)),
      isMeasure: p.isMeasure,
      dataType: d?.dataType,
      formatString: d?.formatString,
      dataCategory: d?.dataCategory,
      kpi: d?.kpi,
      resultIndex: gi >= 0 ? gi : ki >= 0 ? calcBase + ki : groups.length + vi,
      align: ov?.alignment ?? defaultAlign(d?.dataType, p.isMeasure),
      sort: sortEntry ? (sortEntry.direction === 'Descending' ? 'desc' : 'asc') : undefined,
      cf: cfs.get(p.queryRef),
      override: ov
    }
  })

  const base: TableModel = { format, columns, rows: [], identities: [], truncated: false, hasMore: false, window, warnings: [] }
  if (!allProjs.length) return base
  if (!projs.length) {
    // sparklines only: a single row over the whole filter context
    const row = columns.map(() => ({ value: null, text: '' }) as CellModel)
    fillSparklines(ctx, format, columns, [], [[]], [row], base.warnings)
    return { ...base, rows: [row], identities: [{ fields: [] }] }
  }

  const req: SummarizeRequest = {
    groupBy: groups.map((g) => ({ kind: 'sq', expr: g.expr })),
    values: [...values.map((v) => ({ id: valueId(v), expr: { kind: 'sq' as const, expr: v.expr } })), ...extras.map((e, i) => ({ id: extraIds[i], expr: { kind: 'sq' as const, expr: asValueExpr(e) } }))],
    filters: ctx.filters,
    orderBy,
    showItemsWithNoData: visualJson?.visual?.query?.queryState?.Values?.showAll === true || projs.some((p) => (visualJson?.visual?.query?.queryState?.Values?.projections ?? []).find((x: any) => x.queryRef === p.queryRef)?.showAll)
  }
  let result
  let lattice: CalcLattice | undefined
  try {
    result = windowedSummarize(ctx.engine, req, Math.max(1, Math.min(window, TABLE_ROW_LIMIT)))
    if (calcs.length) {
      lattice = evaluateCalcLattice(ctx, groups, [], values, calcs)
      base.warnings.push(...lattice.warnings)
      const lat = lattice
      result = { ...result, rows: result.rows.map((r) => [...r.slice(0, calcBase), ...padCalcs(lat.get(r.slice(0, groups.length), []), calcs.length)]) }
    }
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) }
  }
  // refine types/format strings from the result columns
  for (const c of columns) {
    const rc = result.columns[c.resultIndex]
    if (rc) {
      c.dataType ??= rc.dataType
      c.formatString ??= rc.formatString
      if (!format.columnOverrides.get(c.queryRef)?.alignment) c.align = defaultAlign(c.dataType, c.isMeasure)
    }
  }

  const keyIndex = new Map<string, number>()
  columns.forEach((c) => !c.sparkline && keyIndex.set(fieldKey(c.proj.expr), c.resultIndex))
  extras.forEach((e, i) => keyIndex.set(fieldKey(e), groups.length + values.length + i))
  const accessor = (row: Scalar[]): FieldAccessor => (key) => {
    const i = keyIndex.get(key)
    return i === undefined ? undefined : row[i]
  }

  // windowed result: gradient / data-bar ranges come from a min/max query over every group
  const full = result.hasMore
    ? fullRangeStats(ctx.engine, groups.map((g) => g.expr), ctx.filters, rangeInputs(columns.filter((c) => !c.sparkline && !isVisualCalc(c.proj)).map((c) => ({ cf: c.cf, own: c.proj.expr }))), asValueExpr)
    : undefined
  const stats: ColumnStats[] = columns.map((c) => (c.sparkline ? {} : columnStats(c.cf, result.rows.map((r) => ({ get: accessor(r), own: r[c.resultIndex] })), full, fieldKey(c.proj.expr))))
  const formats = result.formats
  const rows = result.rows.map((r, ri) =>
    columns.map((c, ci) =>
      c.sparkline ? { value: null, text: '' } : buildCell(r[c.resultIndex], c, ctx, {
        get: accessor(r),
        stats: stats[ci],
        isTotal: false,
        dynamicFormat: c.isMeasure ? formats?.[ri]?.[c.resultIndex - groups.length] : undefined
      })
    )
  )
  const identities: DataPointIdentity[] = result.rows.map((r) => ({ fields: groups.map((g, gi) => ({ expr: identityExpr(g.expr), value: r[gi] })) }))
  fillSparklines(ctx, format, columns, groups.map((g) => g.expr), result.rows.map((r) => r.slice(0, groups.length)), rows, base.warnings, result.hasMore)

  let total: CellModel[] | undefined
  if (format.total.show && (values.length || calcs.length) && rows.length) {
    try {
      const tr = values.length || extras.length ? ctx.engine.summarize({ ...req, groupBy: [], orderBy: undefined, limit: undefined, showItemsWithNoData: false }) : { rows: [[]] as Scalar[][], formats: undefined }
      // the totals row is the matrix's total cell for visual calculations
      const trow = [...(tr.rows[0] ?? []).slice(0, values.length + extras.length), ...(lattice ? padCalcs(lattice.get([], []), calcs.length) : [])]
      const tAccessor: FieldAccessor = (key) => {
        const i = keyIndex.get(key)
        if (i === undefined || i < groups.length) return undefined
        return trow[i - groups.length]
      }
      total = columns.map((c, ci) => {
        if (!c.isMeasure || c.sparkline) return { value: null, text: '' }
        const vi = c.resultIndex - groups.length
        return buildCell(trow[vi] ?? null, c, ctx, { get: tAccessor, stats: stats[ci], isTotal: true, dynamicFormat: tr.formats?.[0]?.[vi] })
      })
      fillSparklines(ctx, format, columns, [], [[]], [total], base.warnings)
      const firstGroup = columns.findIndex((c) => !c.isMeasure && !c.sparkline)
      if (firstGroup === 0) total[0] = { value: null, text: format.total.label }
    } catch (e) {
      base.warnings.push(`Totals: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { ...base, rows, identities, total, truncated: !!result.truncated, hasMore: result.hasMore, warnings: [...base.warnings, ...(result.warnings ?? [])] }
}

function sparkColumn(ctx: VisualHostContext, p: Projection, spark: SparklineSpec): TableColumn {
  const name = (e: SQExpr) => {
    try {
      return ctx.engine.describeField(e)?.displayName
    } catch {
      return undefined
    }
  }
  const info = (e: SQExpr) => {
    const f = (e as any)?.Measure ?? (e as any)?.Column ?? (e as any)?.Aggregation?.Expression?.Column
    return f?.Property as string | undefined
  }
  const label = p.displayName ?? sparklineLabel(name(spark.measure) ?? info(spark.measure) ?? 'Value', name(spark.axis) ?? info(spark.axis) ?? 'Axis')
  return { proj: p, queryRef: p.queryRef, label, isMeasure: false, resultIndex: -1, align: 'center', sparkline: spark }
}

/**
 * Evaluate every sparkline column for the given row keys (values of `groupExprs`) and attach the
 * series to the cells. One summarize per sparkline column: group by row groups + axis.
 */
export function fillSparklines(
  ctx: VisualHostContext,
  format: TableFormat,
  columns: Array<Pick<TableColumn, 'sparkline' | 'queryRef'>>,
  groupExprs: SQExpr[],
  rowKeys: Scalar[][],
  rows: CellModel[][],
  warnings: string[],
  /** only the given row keys are shown (windowed): restrict the query to them when that can't change the values */
  restrict = false
): void {
  columns.forEach((c, ci) => {
    if (!c.sparkline) return
    try {
      const measure = { kind: 'sq' as const, expr: c.sparkline.measure }
      const narrow = restrict && groupExprs.length > 0 && rowKeys.length > 0 && !shadowSensitive(ctx.engine, [measure])
      const batches = narrow ? restrictionBatches(groupExprs, rowKeys) : [[]]
      const sparkRows = batches.flatMap(
        (b) =>
          ctx.engine.summarize({
            groupBy: [...groupExprs, c.sparkline!.axis].map((expr) => ({ kind: 'sq' as const, expr })),
            values: [{ id: 'spark', expr: measure }],
            filters: [...ctx.filters, ...b],
            orderBy: [{ target: { group: groupExprs.length }, direction: 'asc' }],
            limit: TABLE_ROW_LIMIT * 4
          }).rows
      )
      const series = seriesFromRows(sparkRows, groupExprs.length)
      const fmt = sparklineFormatFor(format.sparklines, c.queryRef, ctx.theme)
      rowKeys.forEach((k, ri) => {
        const pts = series.get(sparkKey(k))
        if (rows[ri]?.[ci]) rows[ri][ci] = { value: null, text: '', spark: { points: pts ?? [], format: fmt } }
      })
    } catch (e) {
      warnings.push(`Sparkline: ${e instanceof Error ? e.message : String(e)}`)
    }
  })
}

/** Identity expressions must be plain columns/levels (strip nothing for now; kept as hook for variations). */
function identityExpr(e: SQExpr): SQExpr {
  return e
}

/** Toggle the sort on a header click the way Power BI does (text asc first, numbers desc first). */
export function nextSort(visualJson: any, column: TableColumn): { field: SQExpr; direction: 'Ascending' | 'Descending' } {
  const current = column.sort
  const numeric = column.isMeasure || (column.dataType !== undefined && NUMERIC.includes(column.dataType))
  const direction = current ? (current === 'asc' ? 'Descending' : 'Ascending') : numeric ? 'Descending' : 'Ascending'
  void visualJson
  return { field: column.proj.expr, direction }
}

export function applySort(visualJson: any, sort: { field: SQExpr; direction: 'Ascending' | 'Descending' }): void {
  const v = visualJson.visual
  v.query ??= {}
  v.query.sortDefinition = { sort: [sort] }
}

export function tableData(model: TableModel): { columns: string[]; rows: Scalar[][] } {
  const cols = model.columns.map((c, i) => ({ c, i })).filter(({ c }) => !c.sparkline)
  return { columns: cols.map(({ c }) => c.label), rows: model.rows.map((r) => cols.map(({ i }) => r[i].value)) }
}
