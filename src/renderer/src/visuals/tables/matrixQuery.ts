/**
 * Matrix data acquisition: maps the visual's Rows / Columns / Values wells (with drill level,
 * expansion state and field parameters) to the set of summarize calls the layout needs, and
 * returns a MatrixSpec for ./matrixModel.
 *
 * Calculation-group columns (e.g. a "Time Intelligence" group on Columns) are evaluated one
 * item at a time with an explicit `In` filter on the calc-group column, so each column shows
 * the measure transformed by that calculation item even when the engine's group-by over a
 * calc-group column doesn't apply the item.
 */
import type { Scalar } from '@core/model/data'
import { readExpansion, readToggledPaths, applyExpansion, setNodeExpanded, isExpanded as nodeExpanded, type ExpansionLevel, type ExpansionState } from '../common/expansion'
import type { SummarizeRequest } from '@core/engine/api'
import { fieldKey, literalExpr, type SQExpr, type SQFilter } from '@core/report/sq'
import type { DrillState, VisualHostContext } from '../contract'
import { collectColumnCF, fullRangeStats, rangeInputs, type ColumnCF, type RuleStats } from '../common/conditionalFormatting'
import { kpiAwareLabel } from './kpiLabel'
import { describe, expandParameters, getProjections, labelOf, sortSpecs, valueId, type Projection } from '../common/query'
import { asValueExpr, extraInputs } from './cellModel'
import { blockKey, pathKey, type MatrixBlock, type MatrixSort, type MatrixSpec } from './matrixModel'
import type { TableFormat } from './tableFormat'
import { seriesFromRows, sparklineFormatFor, sparklineLabel, sparklineSpec, type SparklineFormat, type SparklineSpec, type SparkPoint } from './sparklineModel'
import { COLUMN_GROUP_LIMIT, restrictFilters, restrictionBatches, ROW_WINDOW, shadowSensitive } from './windowQuery'
import { compareScalars } from '../common/sqEval'
import { evaluateCalcLattice, isVisualCalc } from '../common/visualCalcs'

function safeDescribe(ctx: VisualHostContext, p: Projection) {
  try {
    return describe(ctx, p)
  } catch {
    return undefined
  }
}

function fieldLabel(ctx: VisualHostContext, e: SQExpr): string {
  try {
    const d = ctx.engine.describeField(e)
    if (d?.displayName) return d.displayName
  } catch {
    /* fall through */
  }
  const f = (e as any)?.Measure ?? (e as any)?.Column ?? (e as any)?.Aggregation?.Expression?.Column
  return String(f?.Property ?? '')
}

export interface MatrixFieldInfo {
  proj: Projection
  label: string
  formatString?: string
  dataType?: string
  dataCategory?: string
  kpi?: { part: 'goal' | 'status' | 'trend'; statusGraphic?: string }
}

export interface MatrixData {
  spec: MatrixSpec
  rowFields: MatrixFieldInfo[]
  colFields: MatrixFieldInfo[]
  values: Array<MatrixFieldInfo & { cf?: ColumnCF; sparkline?: SparklineSpec; sparkFormat?: SparklineFormat }>
  /** sparkline series: value index → block key → sparkKey(row path ++ column path) → points */
  sparks: Map<number, Map<string, Map<string, SparkPoint[]>>>
  /** fieldKey → index into the value part of a block row (values then extras) */
  keyIndex: Map<string, number>
  /** first visible row level index within the Rows well (drill level) */
  rowOffset: number
  /** first visible column level index within the Columns well */
  colOffset: number
  allRowFields: Projection[]
  warnings: string[]
  /** data windowing: more row groups exist beyond the loaded window */
  hasMore: boolean
  /** row budget used for this load */
  window: number
  /** more column groups exist beyond the loaded column window (fetched on horizontal scroll) */
  columnsCapped: boolean
  /** column-group budget used for this load (multiples of COLUMN_GROUP_LIMIT) */
  columnWindow: number
  /**
   * Windowed loads: gradient / data-bar ranges over every group at (rowDepth × colDepth), from a
   * separate min/max query (fieldKey → stats), so CF colors don't depend on the loaded window.
   */
  fullStats?: { rowDepth: number; colDepth: number; stats: Map<string, RuleStats> }
}

export const MATRIX_ROW_LIMIT = 30000

/** Number of levels shown when nothing is toggled: 1 + the leading levels that are expanded by default. */
export function uniformDepth(levelExpanded: boolean[]): number {
  let d = levelExpanded.length ? 1 : 0
  for (let i = 0; i < levelExpanded.length - 1 && levelExpanded[i]; i++) d = i + 2
  return d
}

/** Deepest level that can be visible: a level shows when the one above is expanded by default or has toggled nodes. */
export function reachableDepth(levelExpanded: boolean[], toggled: Set<string>): number {
  const toggledAt = new Set<number>()
  for (const k of toggled) toggledAt.add(k.split('\u0001').length)
  let d = levelExpanded.length ? 1 : 0
  for (let i = 0; i < levelExpanded.length - 1 && (levelExpanded[i] || toggledAt.has(i + 1)); i++) d = i + 2
  return d
}

/** Path keys of the toggled nodes of a role (PBIR expansionStates; see ../common/expansion). */
export function readToggled(visualJson: any, role: 'Rows' | 'Columns' = 'Rows'): Set<string> {
  return new Set(readToggledPaths(visualJson, role).map(pathKey))
}

/** Saved expansion state of a role for the given (visible) levels; levels the file says nothing about follow the `active` flags. */
export function savedExpansion(visualJson: any, role: 'Rows' | 'Columns', queryRefs: string[]): ExpansionState {
  const ps: any[] = visualJson?.visual?.query?.queryState?.[role]?.projections ?? []
  const first = Math.max(0, ps.findIndex((p) => p?.queryRef === queryRefs[0]))
  let active = 0
  for (let i = first; i < ps.length && ps[i]?.active; i++) active++
  const hasFlags = ps.some((p) => p?.active !== undefined)
  return readExpansion(visualJson, role, queryRefs, (i) => (role === 'Columns' && !hasFlags) || i < active - 1)
}

/**
 * Toggle the expansion of a row (or column) node in PBIR expansionStates (mutates the visual JSON).
 * `effective` = the state currently shown when it differs from the saved one (run-time "expand all down one level").
 */
export function toggleExpansion(visualJson: any, path: Scalar[], queryRefs: string[], role: 'Rows' | 'Columns' = 'Rows', effective?: ExpansionState, levels?: ExpansionLevel[]): void {
  const state = effective ?? savedExpansion(visualJson, role, queryRefs)
  applyExpansion(visualJson, role, levels ?? queryRefs.map((queryRef) => ({ queryRef })), state, (e) => setNodeExpanded(e, path, !nodeExpanded(e.state, path)))
}

function calcGroupItems(ctx: VisualHostContext, p: Projection): string[] | undefined {
  if (p.info.kind !== 'column' || !p.info.table) return undefined
  const t = ctx.engine.model?.tables?.find((x) => x.name === p.info.table)
  const cg = t?.calculationGroup
  if (!cg?.items?.length) return undefined
  return [...cg.items].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)).map((i) => i.name)
}

/**
 * @param window row budget (PBI data windowing: 500 rows at a time, grown on scroll). Only the row
 *   nodes that are visible within the budget are queried (collapsed parents never fetch children);
 *   grand totals (block depth 0) are never restricted. See ./windowQuery.
 */
export function loadMatrix(visualJson: any, ctx: VisualHostContext, format: TableFormat, window: number = ROW_WINDOW, columnWindow: number = COLUMN_GROUP_LIMIT): MatrixData {
  const roles = getProjections(visualJson)
  const allRows = expandParameters(roles.Rows ?? [], ctx)
  const allCols = expandParameters(roles.Columns ?? [], ctx)
  const values = expandParameters(roles.Values ?? [], ctx)
  const warnings: string[] = []

  // Drill / expand: `active` marks the levels currently shown (PBIR). Drill-down moves the first active level.
  const firstActive = Math.max(0, allRows.findIndex((p) => p.active))
  const rowOffset = ctx.drill.level > 0 || ctx.drill.path.length ? Math.min(ctx.drill.level, Math.max(0, allRows.length - 1)) : allRows.some((p) => p.active) ? firstActive : 0
  const rowFields = allRows.slice(rowOffset)
  let activeCount = 0
  for (let i = rowOffset; i < allRows.length && allRows[i].active; i++) activeCount++
  // Expansion: PBIR `expansionStates` (per-level default + toggled nodes, see ../common/expansion). A file that
  // says nothing about a level falls back to the `active` flags (a level is expanded when the next one is active).
  // "Expand all down one level" (visual header) forces the first levels expanded at run time.
  const drill = ctx.drill
  const rowState = readExpansion(visualJson, 'Rows', rowFields.map((p) => p.queryRef), (i) => i < activeCount - 1)
  const forcedRows = drill.expandedLevel !== undefined ? drill.expandedLevel - rowOffset : 0
  const rowLevelExpanded = rowFields.map((_, i) => i < rowFields.length - 1 && (format.rowHeaders.autoExpand || i < forcedRows || rowState.levelExpanded[i]))
  const expandedDepth = uniformDepth(rowLevelExpanded)
  // Columns: same model as rows. `active` marks the shown levels; a drill on columns (PBI's
  // "Drill on: Columns", DrillState.target/columnLevel) moves the first visible level.
  const hasColFlags = allCols.some((p) => p.active !== undefined)
  const firstActiveCol = Math.max(0, allCols.findIndex((p) => p.active))
  const colOffset = drill.columnLevel !== undefined ? Math.min(drill.columnLevel, Math.max(0, allCols.length - 1)) : hasColFlags ? firstActiveCol : 0
  const colFields = allCols.slice(colOffset)
  let colActiveCount = 0
  for (let i = colOffset; i < allCols.length && allCols[i].active; i++) colActiveCount++
  const colState = readExpansion(visualJson, 'Columns', colFields.map((p) => p.queryRef), (i) => !hasColFlags || i < colActiveCount - 1)
  const forcedCols = drill.columnExpandedLevel !== undefined ? drill.columnExpandedLevel - colOffset : 0
  const colLevelExpanded = colFields.map((_, i) => i < colFields.length - 1 && (format.header.autoExpand || i < forcedCols || colState.levelExpanded[i]))
  const colExpandedDepth = uniformDepth(colLevelExpanded)

  const toggled = rowState.toggled
  const colToggled = colState.toggled
  const neededRowDepth = reachableDepth(rowLevelExpanded, toggled)
  const neededColDepth = reachableDepth(colLevelExpanded, colToggled)

  const cfs = collectColumnCF(visualJson, ctx.theme)
  const valueCFs = values.map((v) => cfs.get(v.queryRef))
  const available = new Set([...rowFields, ...colFields, ...values].map((p) => fieldKey(p.expr)))
  const extras = extraInputs(valueCFs, available)
  const keyIndex = new Map<string, number>()
  values.forEach((v, i) => keyIndex.set(fieldKey(v.expr), i))
  extras.forEach((e, i) => keyIndex.set(fieldKey(e), values.length + i))

  // sparkline values are evaluated separately (row/column groups + axis); their slots stay blank here
  const sparkSpecs = values.map((v) => sparklineSpec(v.expr))
  // visual calculations are filled from the visual-matrix lattice after the blocks are loaded (blank slots here)
  const calcValueIdx = values.map((v, i) => (isVisualCalc(v) ? i : -1)).filter((i) => i >= 0)
  const plainValueIdx = values.map((_, i) => i).filter((i) => !sparkSpecs[i] && !calcValueIdx.includes(i))
  const reqValues = [
    ...plainValueIdx.map((i) => ({ id: valueId(values[i]), expr: { kind: 'sq' as const, expr: values[i].expr } })),
    ...extras.map((e) => ({ id: `cf|${fieldKey(e)}`, expr: { kind: 'sq' as const, expr: asValueExpr(e) } }))
  ]

  // sort: a sort on a row field (asc/desc) or on a value
  let sort: MatrixSort
  const specs = sortSpecs(visualJson, rowFields, values)
  const first = specs[0]
  if (first) {
    if ('group' in first.target) sort = { kind: 'group', dir: first.direction }
    else {
      const vid = first.target.value
      const idx = values.findIndex((v) => valueId(v) === vid)
      if (idx >= 0 && !sparkSpecs[idx] && !calcValueIdx.includes(idx)) sort = { kind: 'value', index: idx, dir: first.direction }
    }
  }

  const blocks = new Map<string, MatrixBlock>()
  const calcItems = colFields.map((c) => calcGroupItems(ctx, c))
  // restricting the filter context to the window's groups is safe unless a value reads the shadow filter context (ALLSELECTED)
  const sensitive = shadowSensitive(ctx.engine, [...reqValues.map((v) => v.expr), ...(sort?.kind === 'value' ? [{ kind: 'sq' as const, expr: values[sort.index].expr }] : [])])
  const win = loadRowWindow(ctx, rowFields.map((p) => p.expr), neededRowDepth, rowLevelExpanded, toggled, sort, sort?.kind === 'value' ? values[sort.index].expr : undefined, window, sensitive)
  // column window: the first `columnWindow` deepest column groups; the visual grows it on horizontal scroll
  const cols = capColumns(ctx, colFields.map((p) => p.expr), neededColDepth, calcItems.slice(0, neededColDepth).some((x) => x), columnWindow)
  // CF ranges over the full result when only a window is loaded. Only for uniformly expanded rows /
  // columns (no per-node toggles), where "the lowest visible level" is a whole level; with mixed
  // expansion the loaded window's instance cells are used (approximation).
  let fullStats: MatrixData['fullStats']
  const statsRowDepth = Math.min(expandedDepth, rowFields.length)
  const statsColDepth = Math.min(colExpandedDepth, colFields.length)
  if ((win.hasMore || cols.capped) && !toggled.size && !colToggled.size && !calcItems.slice(0, statsColDepth).some((x) => x)) {
    const inputs = rangeInputs(values.map((v, i) => ({ cf: sparkSpecs[i] ? undefined : valueCFs[i], own: v.expr })))
    if (inputs.length)
      fullStats = {
        rowDepth: statsRowDepth,
        colDepth: statsColDepth,
        stats: fullRangeStats(ctx.engine, [...rowFields.slice(0, statsRowDepth), ...colFields.slice(0, statsColDepth)].map((p) => p.expr), ctx.filters, inputs, asValueExpr)
      }
  }
  /**
   * Restriction of a block (d row levels, e column levels) to the window: batches of `In` filters
   * (one query per batch, see restrictionBatches) + a post-filter to the exact window tuples.
   */
  const restriction = (d: number, e: number): { batches: SQFilter[][]; keep?: (row: Scalar[]) => boolean } => {
    const rowSet = d > 0 ? win.byDepth[d] : undefined
    const colSet = e > 0 && cols.allowed ? cols.prefixes[e] : undefined
    const colFilters = colSet && !sensitive ? restrictFilters(colFields.slice(0, e).map((p) => p.expr), colSet.tuples) : []
    const rowBatches = rowSet && !sensitive ? restrictionBatches(rowFields.slice(0, d).map((p) => p.expr), rowSet.tuples) : [[]]
    const batches = rowBatches.map((b) => [...b, ...colFilters])
    if (!rowSet && !colSet) return { batches }
    return {
      batches,
      keep: (row) => (!rowSet || rowSet.keys.has(pathKey(row.slice(0, d)))) && (!colSet || colSet.keys.has(pathKey(row.slice(d, d + e))))
    }
  }
  const runBatches = (groupExprs: SQExpr[], extra: SQFilter[], batches: SQFilter[][]) => {
    if (batches.length === 1) return run(groupExprs, [...extra, ...batches[0]])
    const parts = batches.map((b) => run(groupExprs, [...extra, ...b]))
    const anyFormats = parts.some((p) => p.formats)
    return { rows: parts.flatMap((p) => p.rows), formats: anyFormats ? parts.flatMap((p) => p.formats ?? p.rows.map(() => [])) : undefined }
  }
  const run = (groupExprs: SQExpr[], extraFilters: SQFilter[]): { rows: Scalar[][]; formats?: Array<Array<string | undefined>> } => {
    const req: SummarizeRequest = {
      groupBy: groupExprs.map((expr) => ({ kind: 'sq', expr })),
      values: reqValues,
      filters: [...ctx.filters, ...extraFilters],
      limit: MATRIX_ROW_LIMIT
    }
    if (!reqValues.length && !groupExprs.length) return { rows: [[...values.map(() => null)]] }
    const r = ctx.engine.summarize(req)
    if (r.truncated) warnings.push('Row limit reached; showing a sample.')
    if (r.warnings) warnings.push(...r.warnings)
    if (plainValueIdx.length === values.length) return { rows: r.rows, formats: r.formats }
    // re-insert blank slots for sparkline values so value indexes match `values`
    const g = groupExprs.length
    const widen = <T,>(part: T[], blank: T): T[] => {
      const out: T[] = values.map(() => blank)
      plainValueIdx.forEach((vi, j) => (out[vi] = part[j]))
      return [...out, ...part.slice(plainValueIdx.length)]
    }
    return {
      rows: r.rows.map((row) => [...row.slice(0, g), ...widen(row.slice(g), null as Scalar)]),
      formats: r.formats?.map((f) => widen(f, undefined as string | undefined))
    }
  }

  for (let d = 0; d <= neededRowDepth; d++) {
    for (let e = 0; e <= neededColDepth; e++) {
      const rowExprs = rowFields.slice(0, d).map((p) => p.expr)
      const cols = colFields.slice(0, e)
      const calcIdx = cols.map((_, i) => (calcItems[i] ? i : -1)).filter((i) => i >= 0)
      const rst = restriction(d, e)
      const rowSet = d > 0 ? win.byDepth[d] : undefined
      if (rowSet && !rowSet.tuples.length) {
        // no visible node at this depth (collapsed / outside the window): nothing to query
        blocks.set(blockKey(d, e), { rowDepth: d, colDepth: e, rows: [], formats: [] })
        continue
      }
      try {
        if (!calcIdx.length || !plainValueIdx.length) {
          const r = keepRows(runBatches([...rowExprs, ...cols.map((c) => c.expr)], [], rst.batches), rst.keep)
          blocks.set(blockKey(d, e), { rowDepth: d, colDepth: e, rows: r.rows, formats: r.formats })
          continue
        }
        // cartesian product over calc-group items, each evaluated under an explicit filter
        const combos: string[][] = calcIdx.reduce<string[][]>((acc, ci) => acc.flatMap((a) => calcItems[ci]!.map((it) => [...a, it])), [[]])
        const rows: Scalar[][] = []
        const formats: Array<Array<string | undefined>> = []
        const plainCols = cols.filter((_, i) => !calcIdx.includes(i))
        for (const combo of combos) {
          const filters: SQFilter[] = calcIdx.map((ci, j) => ({
            Version: 2,
            Where: [{ Condition: { In: { Expressions: [cols[ci].expr], Values: [[literalExpr(combo[j])]] } } }]
          }))
          const r = runBatches([...rowExprs, ...plainCols.map((c) => c.expr)], filters, restriction(d, 0).batches)
          r.rows.forEach((row, ri) => {
            if (rowSet && !rowSet.keys.has(pathKey(row.slice(0, d)))) return
            const rowPart = row.slice(0, d)
            const plain = row.slice(d, d + plainCols.length)
            const colPart: Scalar[] = []
            let pi = 0
            for (let i = 0; i < cols.length; i++) colPart.push(calcIdx.includes(i) ? combo[calcIdx.indexOf(i)] : plain[pi++])
            rows.push([...rowPart, ...colPart, ...row.slice(d + plainCols.length)])
            formats.push(r.formats?.[ri] ?? [])
          })
        }
        blocks.set(blockKey(d, e), { rowDepth: d, colDepth: e, rows, formats })
      } catch (err) {
        warnings.push(err instanceof Error ? err.message : String(err))
      }
    }
  }

  // visual calculations: one evaluation over the visual matrix (rows × columns, every level), whatever is loaded.
  // Cells fill the blank calc slots of every block (subtotals and totals are lattice cells too); with both axes,
  // densified combinations (no base data, non-blank calculation, PBI DENSIFY) are added with blank base values.
  if (calcValueIdx.length && !calcItems.some((x) => x)) {
    try {
      const lat = evaluateCalcLattice(
        ctx,
        rowFields,
        colFields,
        values.filter((_, i) => plainValueIdx.includes(i)),
        calcValueIdx.map((i) => values[i])
      )
      warnings.push(...lat.warnings)
      for (const b of blocks.values()) {
        const d = b.rowDepth
        const e = b.colDepth
        const present = new Set<string>()
        for (const row of b.rows) {
          const cv = lat.get(row.slice(0, d), row.slice(d, d + e))
          calcValueIdx.forEach((vi, k) => (row[d + e + vi] = cv?.[k] ?? null))
          present.add(pathKey(row.slice(0, d + e)))
        }
        const rst = restriction(d, e)
        for (const cell of lat.cellsAt(d, e)) {
          if (!cell.densified || cell.calcs.every((v) => v === null)) continue
          const keys = [...cell.rowKeys, ...cell.colKeys]
          if (present.has(pathKey(keys))) continue
          if (d > 0 && win.byDepth[d] && !win.byDepth[d]!.keys.has(pathKey(cell.rowKeys))) continue
          const row: Scalar[] = [...keys, ...values.map(() => null), ...extras.map(() => null)]
          calcValueIdx.forEach((vi, k) => (row[d + e + vi] = cell.calcs[k] ?? null))
          if (rst.keep && !rst.keep(row)) continue
          b.rows.push(row)
          b.formats?.push([])
        }
      }
    } catch (err) {
      warnings.push(err instanceof Error ? err.message : String(err))
    }
  }

  // sparkline series per block: group by the block's row + column groups and the axis
  const sparks = new Map<number, Map<string, Map<string, SparkPoint[]>>>()
  sparkSpecs.forEach((sp, vi) => {
    if (!sp) return
    const perBlock = new Map<string, Map<string, SparkPoint[]>>()
    for (const b of blocks.values()) {
      const cols = colFields.slice(0, b.colDepth)
      if (cols.some((_, i) => calcItems[i])) continue
      const groupExprs = [...rowFields.slice(0, b.rowDepth).map((p) => p.expr), ...cols.map((c) => c.expr)]
      if (b.rowDepth > 0 && !b.rows.length) continue
      try {
        const sparkSensitive = shadowSensitive(ctx.engine, [{ kind: 'sq', expr: sp.measure }])
        const batches = sparkSensitive ? [[]] : restriction(b.rowDepth, b.colDepth).batches
        const rows = batches.flatMap(
          (narrow) =>
            ctx.engine.summarize({
              groupBy: [...groupExprs, sp.axis].map((expr) => ({ kind: 'sq' as const, expr })),
              values: [{ id: 'spark', expr: { kind: 'sq', expr: sp.measure } }],
              filters: [...ctx.filters, ...narrow],
              orderBy: [{ target: { group: groupExprs.length }, direction: 'asc' }],
              limit: MATRIX_ROW_LIMIT * 4
            }).rows
        )
        perBlock.set(blockKey(b.rowDepth, b.colDepth), seriesFromRows(rows, groupExprs.length))
      } catch (err) {
        warnings.push(`Sparkline: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    sparks.set(vi, perBlock)
  })


  const st = format.subTotals
  const levelOn = (p: Projection | undefined, perLevel: boolean) => (p && perLevel ? format.subTotals.levelEnabled.get(p.queryRef) ?? true : true)
  const levelLabel = (fields: Projection[], depth: number, fallback: string) => (depth > 0 ? st.levelLabel.get(fields[depth - 1]?.queryRef ?? '') : undefined) ?? fallback
  const spec: MatrixSpec = {
    rowLevels: rowFields.length,
    colLevels: colFields.length,
    valueCount: values.length,
    blocks,
    expandedDepth,
    rowLevelExpanded,
    toggled,
    colExpandedDepth,
    colLevelExpanded,
    colToggled,
    rowTotalLabel: (depth) => levelLabel(rowFields, depth, st.label),
    colTotalLabel: (depth) => levelLabel(colFields, depth, st.columnLabel),
    blankRows: format.showBlankRows,
    // grand total (depth 0) follows the row subtotal switch; per-level overrides keyed by the level's field
    rowSubtotal: (depth) => st.rows && (depth === 0 ? true : levelOn(rowFields[depth - 1], st.perRowLevel)),
    rowSubtotalPosition: st.rowPosition,
    colSubtotal: (depth) => st.columns && (depth === 0 ? true : levelOn(colFields[depth - 1], st.perColumnLevel)),
    valuesOnRow: format.values.valuesOnRow && values.length > 0,
    sort
  }

  const info = (p: Projection): MatrixFieldInfo => {
    const sp = sparklineSpec(p.expr)
    if (sp) return { proj: p, label: p.displayName ?? sparklineLabel(fieldLabel(ctx, sp.measure), fieldLabel(ctx, sp.axis)) }
    const d = safeDescribe(ctx, p)
    return { proj: p, label: kpiAwareLabel(p.displayName, d, () => labelOf(ctx, p)), formatString: d?.formatString, dataType: d?.dataType, dataCategory: d?.dataCategory, kpi: d?.kpi }
  }
  return {
    spec,
    rowFields: rowFields.map(info),
    colFields: colFields.map(info),
    values: values.map((v, i) => ({
      ...info(v),
      cf: valueCFs[i],
      sparkline: sparkSpecs[i],
      sparkFormat: sparkSpecs[i] ? sparklineFormatFor(format.sparklines, v.queryRef, ctx.theme) : undefined
    })),
    sparks,
    keyIndex,
    rowOffset,
    colOffset,
    allRowFields: allRows,
    warnings,
    hasMore: win.hasMore,
    window,
    columnsCapped: cols.capped,
    columnWindow,
    fullStats
  }
}

function keepRows(r: { rows: Scalar[][]; formats?: Array<Array<string | undefined>> }, keep?: (row: Scalar[]) => boolean) {
  if (!keep) return r
  const rows: Scalar[][] = []
  const formats: Array<Array<string | undefined>> = []
  r.rows.forEach((row, i) => {
    if (!keep(row)) return
    rows.push(row)
    if (r.formats) formats.push(r.formats[i])
  })
  return { rows, formats: r.formats ? formats : undefined }
}

interface TupleSet {
  tuples: Scalar[][]
  keys: Set<string>
}

function tupleSet(tuples: Scalar[][]): TupleSet {
  return { tuples, keys: new Set(tuples.map((t) => pathKey(t))) }
}

export interface RowWindow {
  /** byDepth[d] (d ≥ 1): the row nodes at depth d inside the window; undefined = unrestricted */
  byDepth: Array<TupleSet | undefined>
  hasMore: boolean
}

/**
 * Pick the row nodes shown in the first `window` rows of the matrix, level by level, with
 * group-only probes (no measure evaluation unless the matrix is sorted by a value, whose sort
 * value is then evaluated for the candidate nodes — as Power BI's TOPN window query does).
 * Display order matches ./matrixModel: siblings by group (asc/desc) or by the sort value.
 */
export function loadRowWindow(
  ctx: VisualHostContext,
  rowExprs: SQExpr[],
  neededDepth: number,
  /** levels shown expanded by default: a depth (levels above it are expanded) or a per-level flag (index 0 = first level) */
  expandedDepth: number | boolean[],
  toggled: Set<string>,
  sort: MatrixSort,
  sortExpr: SQExpr | undefined,
  window: number,
  sensitive: boolean
): RowWindow {
  const byDepth: Array<TupleSet | undefined> = []
  if (!rowExprs.length || neededDepth < 1) return { byDepth, hasMore: false }
  const dir = sort?.dir ?? 'asc'
  const byValue = sort?.kind === 'value' && !!sortExpr
  const byDefault = (depth: number) => (typeof expandedDepth === 'number' ? depth < expandedDepth : !!expandedDepth[depth - 1])
  const isExpanded = (path: Scalar[]) => path.length < rowExprs.length && path.length < neededDepth && byDefault(path.length) !== toggled.has(pathKey(path))

  /** children (depth d) of the given parents (depth d - 1), in display order per parent */
  const probe = (d: number, parents: Scalar[][] | undefined, limit: number | undefined): { rows: Scalar[][]; more: boolean } => {
    const groupBy = rowExprs.slice(0, d).map((expr) => ({ kind: 'sq' as const, expr }))
    const filters = [...ctx.filters, ...(parents && !sensitive ? restrictFilters(rowExprs.slice(0, d - 1), parents) : [])]
    const r = ctx.engine.summarize({
      groupBy,
      values: byValue ? [{ id: 'sort', expr: { kind: 'sq', expr: sortExpr! } }] : [],
      filters,
      orderBy: byValue ? [{ target: { value: 'sort' }, direction: dir }] : groupBy.map((_, i) => ({ target: { group: i }, direction: dir })),
      limit: limit === undefined ? undefined : limit + 1,
      keepBlankRows: byValue ? true : undefined
    })
    const more = limit !== undefined && r.rows.length > limit
    const rows = (more ? r.rows.slice(0, limit) : r.rows).map((row) => (byValue ? row : row.slice(0, d)))
    return { rows, more }
  }

  // level 1: the first `window` nodes (sorted like the matrix)
  const top = probe(1, undefined, window)
  let hasMore = top.more
  interface N {
    path: Scalar[]
    children?: N[]
  }
  const roots: N[] = top.rows.map((r) => ({ path: r.slice(0, 1) }))
  let frontier: N[] = roots
  for (let d = 2; d <= neededDepth; d++) {
    const parents = frontier.filter((n) => isExpanded(n.path))
    if (!parents.length) break
    // children of the expanded parents (group-only scan); trimmed to the budget below
    const res = probe(d, parents.map((n) => n.path), undefined)
    const want = new Map(parents.map((n) => [pathKey(n.path), n]))
    const grouped = new Map<string, Array<{ path: Scalar[]; v: Scalar }>>()
    for (const row of res.rows) {
      const pk = pathKey(row.slice(0, d - 1))
      if (!want.has(pk)) continue
      const arr = grouped.get(pk) ?? []
      arr.push({ path: row.slice(0, d), v: byValue ? row[d] : null })
      grouped.set(pk, arr)
    }
    const next: N[] = []
    for (const p of parents) {
      const kids = grouped.get(pathKey(p.path)) ?? []
      if (byValue) {
        const idx = kids.map((k, i) => ({ k, i }))
        idx.sort((a, b) => (dir === 'desc' ? -compareScalars(a.k.v, b.k.v) : compareScalars(a.k.v, b.k.v)) || a.i - b.i)
        p.children = idx.map(({ k }) => ({ path: k.path }))
      } else p.children = kids.map((k) => ({ path: k.path }))
      next.push(...p.children)
    }
    frontier = next
  }

  // flatten in display order and keep the first `window` rows
  const kept: N[] = []
  let cut = false
  const walk = (nodes: N[]): boolean => {
    for (const n of nodes) {
      if (kept.length >= window) {
        cut = true
        return false
      }
      kept.push(n)
      if (n.children && !walk(n.children)) return false
    }
    return true
  }
  walk(roots)
  // an expanded node whose children all fell outside the window is shown with the next window
  while (cut && kept.length > 1) {
    const last = kept[kept.length - 1]
    if (last.children?.length && isExpanded(last.path)) kept.pop()
    else break
  }
  hasMore ||= cut
  for (let d = 1; d <= neededDepth; d++) byDepth[d] = tupleSet(kept.filter((n) => n.path.length === d).map((n) => n.path))
  return { byDepth, hasMore }
}

/**
 * Column groups at the deepest needed level, in the matrix's column order, limited to the column
 * window (`limit`, Power BI's "Top 100 grouping columns" per window). `capped` = more groups exist.
 * Column subtotals of a group whose children are only partly loaded stay exact: the restriction is on
 * the group's own prefix, not on the loaded children.
 */
export function capColumns(
  ctx: VisualHostContext,
  colExprs: SQExpr[],
  neededDepth: number,
  hasCalcGroup: boolean,
  limit: number = COLUMN_GROUP_LIMIT
): { capped: boolean; allowed: boolean; prefixes: Array<TupleSet | undefined> } {
  const prefixes: Array<TupleSet | undefined> = []
  if (!colExprs.length || neededDepth < 1 || hasCalcGroup) return { capped: false, allowed: false, prefixes }
  const groupBy = colExprs.slice(0, neededDepth).map((expr) => ({ kind: 'sq' as const, expr }))
  let rows: Scalar[][]
  try {
    rows = ctx.engine.summarize({ groupBy, values: [], filters: ctx.filters, orderBy: groupBy.map((_, i) => ({ target: { group: i }, direction: 'asc' as const })), limit: limit + 1 }).rows
  } catch {
    return { capped: false, allowed: false, prefixes }
  }
  if (rows.length <= limit) return { capped: false, allowed: false, prefixes }
  const tuples = rows.slice(0, limit).map((r) => r.slice(0, neededDepth))
  for (let e = 1; e <= neededDepth; e++) {
    const seen = new Map<string, Scalar[]>()
    for (const t of tuples) seen.set(pathKey(t.slice(0, e)), t.slice(0, e))
    prefixes[e] = { tuples: [...seen.values()], keys: new Set(seen.keys()) }
  }
  return { capped: true, allowed: true, prefixes }
}
