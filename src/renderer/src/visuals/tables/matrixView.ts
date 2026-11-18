/**
 * Matrix view model: MatrixData + layout → display cells (text, CF, styles flags) for every
 * (row item × column leaf), header labels, and the flattened data used by getData / export.
 */
import type { Scalar } from '@core/model/data'
import type { DataType } from '@core/model/types'
import { fieldKey, type DataPointIdentity } from '@core/report/sq'
import type { VisualHostContext } from '../contract'
import type { FieldAccessor } from '../common/sqEval'
import { buildCell, columnStats, type CellModel, type ColumnStats } from './cellModel'
import { buildMatrixLayout, type ColLeaf, type MatrixLayout, type RowItem } from './matrixModel'
import { loadMatrix, type MatrixData } from './matrixQuery'
import { readTableFormat, type TableFormat } from './tableFormat'
import { sparkKey } from './sparklineModel'
import { COLUMN_GROUP_LIMIT, ROW_WINDOW } from './windowQuery'

export interface MatrixView {
  format: TableFormat
  data: MatrixData
  layout: MatrixLayout
  /** cells[itemIndex][leafIndex] */
  cells: CellModel[][]
  rowLabels: string[]
  leafLabels: string[]
  error?: string
}

export function formatLabel(ctx: VisualHostContext, v: Scalar, formatString?: string, dataType?: string): string {
  if (v === null || v === undefined || v === '') return '(Blank)'
  return ctx.format(v, formatString, dataType as DataType | undefined)
}

/**
 * @param window row budget (data windowing, see ./windowQuery)
 * @param columnWindow column-group budget (grown on horizontal scroll)
 */
export function buildMatrixView(visualJson: any, ctx: VisualHostContext, window: number = ROW_WINDOW, columnWindow: number = COLUMN_GROUP_LIMIT): MatrixView {
  const format = readTableFormat(visualJson, ctx.theme)
  let data: MatrixData
  try {
    data = loadMatrix(visualJson, ctx, format, window, columnWindow)
  } catch (e) {
    const layout = buildMatrixLayout({
      rowLevels: 0,
      colLevels: 0,
      valueCount: 0,
      blocks: new Map(),
      expandedDepth: 1,
      toggled: new Set(),
      rowSubtotal: () => false,
      rowSubtotalPosition: 'top',
      colSubtotal: () => false,
      valuesOnRow: false
    })
    return { format, data: undefined as unknown as MatrixData, layout, cells: [], rowLabels: [], leafLabels: [], error: e instanceof Error ? e.message : String(e) }
  }
  const layout = buildMatrixLayout(data.spec)
  const { values, keyIndex } = data
  const accessor = (vals: Scalar[]): FieldAccessor => (key) => {
    const i = keyIndex.get(key)
    return i === undefined ? undefined : vals[i]
  }

  // CF stats over instance cells = the lowest visible row level × lowest visible column level
  // (Learn: "For matrices, any Values options refer to the lowest visible level").
  const deepest = data.spec.blocks.get(`${layout.maxRowDepth}:${layout.colHeaderLevels}`)
  // windowed loads: ranges over every group of that level (separate min/max query)
  const fs = data.fullStats
  const full = fs && fs.rowDepth === layout.maxRowDepth && fs.colDepth === layout.colHeaderLevels ? fs.stats : undefined
  const stats: ColumnStats[] = values.map((v, vi) =>
    columnStats(
      v.cf,
      (deepest?.rows ?? []).map((r) => {
        const vals = r.slice(deepest!.rowDepth + deepest!.colDepth)
        return { get: accessor(vals), own: vals[vi] }
      }),
      full,
      fieldKey(v.proj.expr)
    )
  )

  const cells = layout.items.map((item) =>
    layout.leaves.map((leaf): CellModel => {
      if (!item.showValues) return { value: null, text: '' }
      const vi = data.spec.valuesOnRow ? item.valueIndex ?? 0 : leaf.valueIndex
      const v = values[vi]
      if (!v) return { value: null, text: '' }
      if (v.sparkline) {
        const series = data.sparks.get(vi)?.get(`${item.path.length}:${leaf.path.length}`)
        return { value: null, text: '', spark: { points: series?.get(sparkKey([...item.path, ...leaf.path])) ?? [], format: v.sparkFormat! } }
      }
      const hit = layout.lookup(item.path, leaf.path)
      const vals = hit?.values ?? []
      const totalKind = item.totalKind === 'grand' || leaf.totalKind === 'grand' ? 'grand' : item.totalKind ?? leaf.totalKind
      return buildCell(
        vals[vi] ?? null,
        { formatString: v.formatString, dataType: v.dataType as DataType | undefined, dataCategory: v.dataCategory, cf: v.cf, override: format.columnOverrides.get(v.proj.queryRef), kpi: v.kpi },
        ctx,
        { get: accessor(vals), stats: stats[vi], isTotal: item.isTotal || leaf.isTotal, totalKind, dynamicFormat: hit?.formats?.[vi] }
      )
    })
  )

  const rowLabels = layout.items.map((it) => itemLabel(ctx, data, it))
  const leafLabels = layout.leaves.map((l) => leafLabel(ctx, data, l))
  return { format, data, layout, cells, rowLabels, leafLabels }
}

export function itemLabel(ctx: VisualHostContext, data: MatrixData, it: RowItem): string {
  if (it.kind === 'blank') return ''
  if (it.kind === 'value') return data.values[it.valueIndex ?? 0]?.label ?? ''
  if (it.kind === 'grand') return it.label === undefined ? '' : String(it.label)
  if (it.kind === 'subtotal') return String(it.label ?? 'Total')
  const f = data.rowFields[it.path.length - 1]
  return formatLabel(ctx, it.label ?? null, f?.formatString, f?.dataType)
}

export function leafLabel(ctx: VisualHostContext, data: MatrixData, l: ColLeaf): string {
  const parts = l.path.map((v, i) => formatLabel(ctx, v, data.colFields[i]?.formatString, data.colFields[i]?.dataType))
  if (l.isTotal && !l.collapsed && l.totalKind !== 'subtotal') parts.push(data.spec.colTotalLabel?.(0) ?? 'Total')
  else if (l.isTotal && !l.collapsed && l.path.length) parts.push(data.spec.colTotalLabel?.(l.path.length) ?? 'Total')
  if (l.valueIndex >= 0 && (data.values.length > 1 || !data.colFields.length)) parts.push(data.values[l.valueIndex]?.label ?? '')
  return parts.join(' / ') || data.values[0]?.label || ''
}

/** Identity of a row item path (+ optional column path) for selection / drill. */
export function matrixIdentity(data: MatrixData, rowPath: Scalar[], colPath: Scalar[] = []): DataPointIdentity {
  return {
    fields: [
      ...rowPath.map((value, i) => ({ expr: data.rowFields[i].proj.expr, value })),
      ...colPath.map((value, i) => ({ expr: data.colFields[i].proj.expr, value }))
    ]
  }
}

export function matrixData(view: MatrixView): { columns: string[]; rows: Scalar[][] } {
  if (!view.data) return { columns: [], rows: [] }
  const rowCols = view.data.rowFields.map((f) => f.label)
  const columns = [...rowCols, ...(view.data.spec.valuesOnRow ? ['Value', ...view.leafLabels.map(() => '')] : view.leafLabels)]
  const rows = view.layout.items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it.showValues)
    .map(({ it, i }) => {
      const pathCells: Scalar[] = rowCols.map((_, li) => (li < it.path.length ? it.path[li] : it.kind === 'grand' && li === 0 ? view.rowLabels[i] || 'Total' : null))
      const vals = view.cells[i].map((c) => c.value)
      return view.data.spec.valuesOnRow ? [...pathCells, view.rowLabels[i], ...vals] : [...pathCells, ...vals]
    })
  return { columns, rows }
}
